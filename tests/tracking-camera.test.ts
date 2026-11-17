import { BoundingSphere, Cartesian3, EntityCluster, EntityCollection, Event, JulianDate, Math as CMath, Matrix4, OrthographicOffCenterFrustum, PointVisualizer, SceneMode, type CesiumWidget } from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import aircraft from './fixtures/aircraft-camera.json';
import type { GeoRecord } from '../src/shared/layers';
import { cockpitUnavailable } from '../src/shared/trackingCamera';
import { attachCockpit, attachPassengerFollow } from '../src/renderer/map/trackingCamera';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { normalizeAdsb } from '../src/shared/layerNormalize';
import { deadReckon } from '../src/shared/aircraft';

const NOW = Date.parse(aircraft.observedAt);
const record = (): GeoRecord => structuredClone(aircraft);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('cockpit data eligibility', () => {
  it('uses fresh airborne observations and rejects snapshots, absent attitude fields and stale reports', () => {
    expect(cockpitUnavailable('aircraft', record(), NOW)).toBeNull();
    expect(cockpitUnavailable('aircraftMil', record(), NOW)).toBeNull();
    const snapshot = record(); snapshot.props.snapshot = true;
    expect(cockpitUnavailable('aircraft', snapshot, NOW)).toMatch(/snapshots/);
    expect(cockpitUnavailable('aircraft', record(), NOW + 61000)).toMatch(/stale/);
    expect(cockpitUnavailable('aircraft', { ...record(), heading: null }, NOW)).toMatch(/direction/);
    expect(cockpitUnavailable('aircraft', { ...record(), altM: null }, NOW)).toMatch(/altitude/);
    expect(cockpitUnavailable('aircraft', { ...record(), observedAt: 'bad time' }, NOW)).toMatch(/time/);
    expect(cockpitUnavailable('aircraft', { ...record(), observedAt: new Date(NOW + 60000).toISOString() }, NOW)).toMatch(/time/);
    const grounded = record(); grounded.props.onGround = true;
    expect(cockpitUnavailable('aircraft', grounded, NOW)).toMatch(/airborne/);
    expect(cockpitUnavailable('vessels', record(), NOW)).toMatch(/aircraft/);
  });
});

function cameraHarness() {
  const originalPosition = Cartesian3.fromDegrees(10, 20, 30000);
  const controller = { enableInputs: true, minimumZoomDistance: 100, maximumTiltAngle: 1.4 };
  const camera = { positionWC: originalPosition, directionWC: Cartesian3.UNIT_X, upWC: Cartesian3.UNIT_Z,
    cancelFlight: vi.fn(), lookAtTransform: vi.fn(), setView: vi.fn() };
  const scene = { mode: SceneMode.SCENE3D, screenSpaceCameraController: controller, globe: { getHeight: vi.fn(() => 0) }, preRender: new Event(), requestRender: vi.fn() };
  const widget = { camera, scene, isDestroyed: () => false, trackedEntity: undefined } as unknown as CesiumWidget;
  const position = Cartesian3.fromDegrees(aircraft.lon, aircraft.lat, aircraft.altM);
  const source = { layer: 'aircraft' as const, record, position: () => position, hideOwnVehicle: vi.fn() };
  const unavailable = vi.fn();
  return { originalPosition, controller, camera, scene, widget, position, source, unavailable };
}

describe('passenger flight follow', () => {
  function followHarness() {
    const entities = new EntityCollection();
    const scene = { mode: SceneMode.SCENE3D, postRender: new Event(), morphComplete: new Event(), requestRender: vi.fn() };
    const camera = { transform: Matrix4.clone(Matrix4.IDENTITY), cancelFlight: vi.fn(), lookAt: vi.fn(), heading: 0,
      frustum: new OrthographicOffCenterFrustum({ left: -4500, right: 4500, top: 3000, bottom: -3000 }) };
    const widget = { entities, scene, camera, isDestroyed: () => false, trackedEntity: undefined } as unknown as CesiumWidget;
    return { entities, scene, camera, widget };
  }

  it('supplies a Cesium visualizer bounding sphere at every new drawn position', () => {
    const h = followHarness();
    const visualizer = new PointVisualizer(new EntityCluster(), h.entities);
    const now = JulianDate.now();
    const bounds = new BoundingSphere();
    let position = Cartesian3.fromDegrees(-1, 52, 8000);
    const reportView = vi.fn();
    const stop = attachPassengerFollow(h.widget, () => position, reportView, vi.fn());
    const anchor = h.widget.trackedEntity!;
    expect(h.entities.contains(anchor)).toBe(true);
    expect(h.camera.cancelFlight).toHaveBeenCalledOnce();
    h.scene.postRender.raiseEvent();
    expect(reportView).not.toHaveBeenCalled();
    for (const lon of [-1, -0.99, -0.98]) {
      position = Cartesian3.fromDegrees(lon, 52, 8000);
      visualizer.update(now);
      // The installed CesiumWidget requires this visualizer result to advance its camera after the first tick.
      Reflect.get(visualizer, 'getBoundingSphere').call(visualizer, anchor, bounds);
      expect(bounds.center).toEqual(position);
      h.camera.transform = Matrix4.fromTranslation(bounds.center);
      h.scene.postRender.raiseEvent();
    }
    expect(reportView).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(20_000);
    h.scene.postRender.raiseEvent();
    expect(reportView).toHaveBeenCalledTimes(2);
    stop();
    expect(h.entities.values).toHaveLength(0);
    expect(h.widget.trackedEntity).toBeUndefined();
    expect(h.scene.postRender.numberOfListeners).toBe(0);
    visualizer.destroy();
  });

  it('reacquires after a scene morph and releases the anchor when the visible target disappears', () => {
    const h = followHarness();
    let position: Cartesian3 | undefined = Cartesian3.fromDegrees(-1, 52, 8000);
    const unavailable = vi.fn();
    const stop = attachPassengerFollow(h.widget, () => position, vi.fn(), unavailable);
    const anchor = h.widget.trackedEntity!;
    h.scene.mode = SceneMode.MORPHING;
    h.widget.trackedEntity = undefined; // Cesium clears its target on morphStart.
    h.scene.postRender.raiseEvent();
    expect(unavailable).not.toHaveBeenCalled();
    h.scene.mode = SceneMode.SCENE2D;
    h.scene.morphComplete.raiseEvent();
    expect(h.widget.trackedEntity).toBe(anchor);
    expect(h.camera.lookAt).toHaveBeenCalledWith(position, expect.objectContaining({ range: 9000 }));
    position = undefined;
    h.scene.postRender.raiseEvent();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(h.scene.morphComplete.numberOfListeners).toBe(0);
    expect(h.widget.trackedEntity).toBeUndefined();
    stop();
    expect(h.entities.values).toHaveLength(0);
  });
});

describe('cockpit camera lifecycle', () => {
  it('keeps the 3D interior attached to the aircraft while the camera looks around, then removes it', () => {
    const h = cameraHarness();
    const handlers = new Map<string, (event: PointerEvent) => void>();
    let interior: { modelMatrix: Matrix4 } | undefined;
    const remove = vi.fn();
    Object.assign(h.scene, { canvas: { addEventListener: (type: string, fn: (event: PointerEvent) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type), setPointerCapture: vi.fn() },
      primitives: { add: (p: { modelMatrix: Matrix4 }) => { interior = p; return p; }, remove } });
    const stop = attachCockpit(h.widget, h.source, h.unavailable);
    const original = Matrix4.clone(interior!.modelMatrix);
    handlers.get('pointerdown')!({ button: 0, pointerId: 1, clientX: 100, clientY: 100 } as PointerEvent);
    handlers.get('pointermove')!({ pointerId: 1, clientX: 150, clientY: 125 } as PointerEvent);
    vi.advanceTimersByTime(20); h.scene.preRender.raiseEvent();
    expect(Matrix4.equals(interior!.modelMatrix, original)).toBe(true);
    expect(h.camera.setView.mock.lastCall?.[0].orientation.heading).toBeCloseTo(CMath.PI_OVER_TWO + .2);
    stop();
    expect(remove).toHaveBeenCalledWith(interior);
  });
  it('looks out of the passenger side and responds to dragging, then removes its handlers', () => {
    const h = cameraHarness();
    const handlers = new Map<string, (event: PointerEvent) => void>();
    const canvas = { addEventListener: (type: string, fn: (event: PointerEvent) => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type), setPointerCapture: vi.fn() };
    Object.assign(h.scene, { canvas });
    const stop = attachCockpit(h.widget, { ...h.source, heading: () => 80 }, h.unavailable, 'passenger');
    expect(h.camera.setView.mock.lastCall?.[0].orientation.heading).toBeCloseTo(CMath.toRadians(170));
    handlers.get('pointerdown')!({ button: 0, pointerId: 1, clientX: 100, clientY: 100 } as PointerEvent);
    handlers.get('pointermove')!({ pointerId: 1, clientX: 150, clientY: 125 } as PointerEvent);
    vi.advanceTimersByTime(20);
    h.scene.preRender.raiseEvent();
    expect(h.camera.setView.mock.lastCall?.[0].orientation.heading).toBeCloseTo(CMath.toRadians(170) + 0.2);
    handlers.get('pointermove')!({ pointerId: 1, clientX: 10000, clientY: 10000 } as PointerEvent);
    vi.advanceTimersByTime(20); h.scene.preRender.raiseEvent();
    expect(h.camera.setView.mock.lastCall?.[0].orientation.heading).toBeCloseTo(CMath.toRadians(170) + CMath.negativePiToPi(39.6));
    expect(h.camera.setView.mock.lastCall?.[0].orientation.pitch).toBeCloseTo(CMath.toRadians(-85));
    stop();
    expect(handlers.size).toBe(0);
  });
  it('smoothly adds simulated climb and bank to the view without changing the camera position', () => {
    const h = cameraHarness();
    const stop = attachCockpit(h.widget, { ...h.source, attitude: () => ({ pitch: 0.15, bank: 0.2 }) }, h.unavailable);
    vi.advanceTimersByTime(1000); h.scene.preRender.raiseEvent();
    const view = h.camera.setView.mock.lastCall![0];
    expect(view.destination).toEqual(h.position);
    expect(view.orientation.roll).toBeCloseTo(0.2);
    expect(view.orientation.pitch).toBeGreaterThan(CMath.toRadians(-5));
    expect(view.orientation.pitch).toBeLessThan(CMath.toRadians(-5) + 0.15);
    stop();
  });
  it('never calls a forbidden camera transform during a scene morph', () => {
    const h = cameraHarness();
    attachCockpit(h.widget, h.source, h.unavailable);
    h.scene.mode = SceneMode.MORPHING;
    h.camera.lookAtTransform.mockImplementation(() => { throw new Error('transform forbidden while morphing'); });
    expect(() => h.scene.preRender.raiseEvent()).not.toThrow();
    expect(h.controller.enableInputs).toBe(true);
    expect(h.scene.preRender.numberOfListeners).toBe(0);
    const start = cameraHarness(); start.scene.mode = SceneMode.MORPHING;
    attachCockpit(start.widget, start.source, start.unavailable);
    expect(start.camera.lookAtTransform).not.toHaveBeenCalled();
    expect(start.source.hideOwnVehicle).not.toHaveBeenCalled();
  });
  it('aligns to reported ground track, then restores the original camera and inputs exactly once', () => {
    const h = cameraHarness();
    const dispose = attachCockpit(h.widget, h.source, h.unavailable);
    expect(h.controller.enableInputs).toBe(false);
    expect(h.source.hideOwnVehicle).toHaveBeenCalledWith(true);
    expect(h.camera.setView).toHaveBeenCalledWith({ destination: h.position, orientation: { heading: CMath.PI_OVER_TWO, pitch: CMath.toRadians(-5), roll: 0 } });
    dispose(); dispose();
    expect(h.controller).toEqual({ enableInputs: true, minimumZoomDistance: 100, maximumTiltAngle: 1.4 });
    expect(h.camera.setView.mock.lastCall?.[0].destination).toEqual(h.originalPosition);
    expect(h.source.hideOwnVehicle.mock.calls).toEqual([[true], [false]]);
    expect(h.scene.preRender.numberOfListeners).toBe(0);
  });

  it('automatically exits on stale data and cannot continue after cleanup', () => {
    const h = cameraHarness();
    attachCockpit(h.widget, h.source, h.unavailable);
    vi.setSystemTime(NOW + 61000);
    h.scene.preRender.raiseEvent();
    expect(h.unavailable).toHaveBeenCalledOnce();
    expect(h.unavailable.mock.lastCall?.[0]).toMatch(/stale/);
    expect(h.controller.enableInputs).toBe(true);
    const calls = h.camera.setView.mock.calls.length;
    h.scene.preRender.raiseEvent();
    expect(h.camera.setView).toHaveBeenCalledTimes(calls);
  });

  it('exits for a filtered-out target, non-3D scene or terrain intersecting the report', () => {
    const missing = cameraHarness();
    attachCockpit(missing.widget, { ...missing.source, position: () => undefined }, missing.unavailable);
    expect(missing.unavailable.mock.lastCall?.[0]).toMatch(/filtered out/);
    expect(missing.controller.enableInputs).toBe(true);
    const flat = cameraHarness(); flat.scene.mode = SceneMode.SCENE2D;
    attachCockpit(flat.widget, flat.source, flat.unavailable);
    expect(flat.unavailable.mock.lastCall?.[0]).toMatch(/3D/);
    const terrain = cameraHarness(); terrain.scene.globe.getHeight.mockReturnValue(10020);
    attachCockpit(terrain.widget, terrain.source, terrain.unavailable);
    expect(terrain.unavailable.mock.lastCall?.[0]).toMatch(/terrain/);
  });
});

describe('tracking the existing large-layer renderer', () => {
  it('keeps true heading distinct from ground track and does not use heading alone to extrapolate movement', () => {
    const report = { hex: 'abc123', lat: 51.5, lon: -0.1, alt_baro: 32000, gs: 400, true_heading: 80, seen_pos: 0 };
    const headingOnly = normalizeAdsb({ now: NOW, ac: [report] }, 'fixture', NOW).records[0];
    expect(headingOnly.heading).toBe(80);
    expect(headingOnly.props).toMatchObject({ directionSource: 'true-heading', groundTrackDeg: null, trueHeadingDeg: 80 });
    expect(deadReckon(headingOnly, NOW + 30000)).toEqual({ lat: report.lat, lon: report.lon, estimatedS: 0 });
    const tracked = normalizeAdsb({ now: NOW, ac: [{ ...report, track: 90 }] }, 'fixture', NOW).records[0];
    expect(tracked.heading).toBe(90);
    expect(tracked.props.directionSource).toBe('ground-track');
    expect(deadReckon(tracked, NOW + 30000).estimatedS).toBe(30);
  });
  it('resolves batched positions, survives a switch to entities and stops when hidden or expired', () => {
    const r = record();
    const position = Cartesian3.fromDegrees(r.lon, r.lat, r.altM!);
    const layer = Object.create(LayerRenderer.prototype) as LayerRenderer;
    const sources = new Map([['aircraft', { show: true }]]);
    const bulk = new Map([['aircraft', { coll: { show: true }, byId: new Map([[r.id, { position }]]) }]]);
    const entities = new Map();
    Object.assign(layer, { sources, bulk, entities, records: new Map([['aircraft', new Map([[r.id, r]])]]) });
    expect(layer.entityFor('aircraft', r.id)).toBeUndefined(); // the prior follow implementation lost this target
    expect(layer.positionFor('aircraft', r.id)).toEqual(position);
    bulk.clear();
    entities.set('aircraft', new Map([[r.id, { position: { getValue: () => position } }]]));
    expect(layer.positionFor('aircraft', r.id)).toEqual(position);
    sources.get('aircraft')!.show = false;
    expect(layer.positionFor('aircraft', r.id)).toBeUndefined();
    sources.get('aircraft')!.show = true;
    expect(layer.positionFor('aircraft', r.id, NOW + 301000)).toBeUndefined();
  });
});
