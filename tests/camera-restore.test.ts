import { Camera as CesiumCamera, Cartesian3, Event, GeographicProjection, MapMode2D, Math as CMath, OrthographicOffCenterFrustum, SceneMode, type Scene } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { CameraRestorer, capturedCamera, validRestoreCamera, type CameraMode, type CameraRestoreAdapter } from '../src/renderer/map/cameraRestore';
import type { Camera } from '../src/renderer/lib/api';

const TOKYO: Camera = { lat: 35.681236, lon: 139.767125, heightM: 45_000, heading: 1.1, pitch: -0.8 };
const SOUTH: Camera = { lat: -33.86, lon: 151.21, heightM: 230_000, heading: 4.4, pitch: -1.2 };
function harness(mode: CameraMode = '3d', animated = false) {
  const event = new Event();
  let current: ReturnType<CameraRestoreAdapter['mode']> = mode;
  const pending: { complete(): void; cancel(): void }[] = [];
  const adapter: CameraRestoreAdapter = {
    mode: () => current,
    morphTo: vi.fn(() => { current = 'morphing'; }),
    onMorphComplete: callback => event.addEventListener(callback),
    cancelFlight: vi.fn(), report: vi.fn(),
    apply: vi.fn((_camera, animate, complete, cancel) => { if (animated && animate) pending.push({ complete, cancel }); else complete(); }),
  };
  return { adapter, pending, event, settle(next: CameraMode) { current = next; event.raiseEvent(); } };
}

describe('saved-camera lifecycle coordinator', () => {
  it('queues before mount, copies the saved camera, and reports the applied view', async () => {
    const restore = new CameraRestorer('3d'), scene = harness();
    const camera = { ...TOKYO };
    const result = restore.restore(camera, { animate: false });
    camera.lon = -90;
    expect(scene.adapter.apply).not.toHaveBeenCalled();
    restore.attach(scene.adapter);
    expect(await result).toBe(true);
    expect(scene.adapter.apply).toHaveBeenCalledWith(TOKYO, false, expect.any(Function), expect.any(Function));
    expect(scene.adapter.report).toHaveBeenCalledTimes(1);
    expect(camera.lon).toBe(-90); // The coordinator never mutates its caller's object.
  });

  it('waits for the target mode, including an older React mode commit, before applying', async () => {
    const restore = new CameraRestorer('2d'), scene = harness('2d');
    restore.attach(scene.adapter);
    const result = restore.restore(TOKYO, { mode: '3d', animate: false });
    restore.setMode('2d'); // Older props may commit before the requested 3D mode.
    expect(scene.adapter.morphTo).toHaveBeenCalledTimes(1);
    expect(scene.adapter.apply).not.toHaveBeenCalled();
    restore.setMode('3d'); scene.settle('3d');
    expect(await result).toBe(true);
    expect(scene.adapter.apply).toHaveBeenCalledTimes(1);
  });

  it('applies only the latest rapid restore when its mode requires another morph', async () => {
    const restore = new CameraRestorer('3d'), scene = harness();
    restore.attach(scene.adapter);
    const first = restore.restore(TOKYO, { mode: '2d', animate: false });
    const latest = restore.restore(SOUTH, { mode: '3d', animate: false });
    expect(await first).toBe(false);
    scene.settle('2d');
    expect(scene.adapter.apply).not.toHaveBeenCalled();
    expect(scene.adapter.morphTo).toHaveBeenCalledTimes(2);
    scene.settle('3d');
    expect(await latest).toBe(true);
    expect(scene.adapter.apply).toHaveBeenCalledWith(SOUTH, false, expect.any(Function), expect.any(Function));
  });

  it('cancels an owned animation and ignores its late completion after a newer restore', async () => {
    const restore = new CameraRestorer('3d'), scene = harness('3d', true);
    restore.attach(scene.adapter);
    const first = restore.restore(TOKYO), latest = restore.restore(SOUTH);
    expect(await first).toBe(false);
    scene.pending[0].complete();
    expect(scene.adapter.report).not.toHaveBeenCalled();
    scene.pending[1].complete();
    expect(await latest).toBe(true);
    expect(scene.adapter.report).toHaveBeenCalledTimes(1);
  });

  it('does not let invalid input move or cancel the current user camera operation', async () => {
    const restore = new CameraRestorer('3d'), scene = harness('3d', true);
    restore.attach(scene.adapter);
    const valid = restore.restore(TOKYO);
    const cancellations = vi.mocked(scene.adapter.cancelFlight).mock.calls.length;
    for (const camera of [{ ...TOKYO, lat: NaN }, { ...TOKYO, lon: 180.000001 }, { ...TOKYO, heightM: 0 }, { ...TOKYO, pitch: -90 }]) {
      expect(await restore.restore(camera)).toBe(false);
    }
    expect(scene.adapter.cancelFlight).toHaveBeenCalledTimes(cancellations);
    scene.pending[0].complete(); expect(await valid).toBe(true);
  });

  it('detaches listeners, resolves outstanding work false, and ignores old morph events', async () => {
    const restore = new CameraRestorer('3d'), scene = harness();
    restore.attach(scene.adapter);
    const result = restore.restore(TOKYO, { mode: '2d' });
    expect(scene.event.numberOfListeners).toBe(1);
    restore.detach(scene.adapter);
    expect(await result).toBe(false);
    expect(scene.event.numberOfListeners).toBe(0);
    scene.settle('2d'); expect(scene.adapter.apply).not.toHaveBeenCalled();
    const remount = harness('3d'); restore.attach(remount.adapter);
    expect(remount.adapter.morphTo).not.toHaveBeenCalled();
    expect(await restore.restore(SOUTH, { animate: false })).toBe(true);
  });

  it('treats explicit user navigation or a changed mode as cancellation', async () => {
    const restore = new CameraRestorer('3d'), scene = harness('3d', true);
    restore.attach(scene.adapter);
    const navigation = restore.restore(TOKYO); restore.cancel();
    expect(await navigation).toBe(false);
    scene.pending[0].complete(); expect(scene.adapter.report).not.toHaveBeenCalled();
    const mode = restore.restore(TOKYO, { mode: '2d' });
    restore.setMode('2d'); restore.setMode('3d');
    expect(await mode).toBe(false);
    scene.settle('2d'); scene.settle('3d');
    expect(scene.adapter.apply).toHaveBeenCalledTimes(1); // The earlier cancelled animation only.
  });

  it('settles failed initialization and allows a later real attachment', async () => {
    const restore = new CameraRestorer('3d');
    const pending = restore.restore(TOKYO); restore.fail();
    expect(await pending).toBe(false);
    expect(await restore.restore(SOUTH)).toBe(false);
    const scene = harness(); restore.attach(scene.adapter);
    expect(await restore.restore(SOUTH, { animate: false })).toBe(true);
  });

  it('never strands a successful camera promise when a viewport observer fails', async () => {
    const restore = new CameraRestorer('3d'), scene = harness();
    scene.adapter.report = () => { throw new Error('Observer no longer available'); };
    restore.attach(scene.adapter);
    expect(await restore.restore(TOKYO, { animate: false })).toBe(true);
  });
});

function nativeCamera(mode: CameraMode = '3d') {
  const scene = { mapProjection: new GeographicProjection(), drawingBufferWidth: 1024, drawingBufferHeight: 768, mapMode2D: MapMode2D.INFINITE_SCROLL };
  // SceneTransitioner uses these native engine members; public Camera typings omit update.
  const camera = new CesiumCamera(scene as Scene) as CesiumCamera & { update(mode: number): void };
  if (mode === '2d') {
    (camera as unknown as { frustum: OrthographicOffCenterFrustum }).frustum = new OrthographicOffCenterFrustum({ left: -100_000, right: 100_000, top: 75_000, bottom: -75_000, near: 1, far: 500_000_000 });
    camera.update(SceneMode.SCENE2D);
  }
  return camera;
}

describe('native Cesium camera units and WGS84 boundary math', () => {
  it.each([TOKYO, SOUTH, { ...TOKYO, lat: -12, lon: -77 }, { ...TOKYO, lat: 10, lon: 180 }, { ...TOKYO, lat: -10, lon: -180 }])('preserves $lat/$lon coordinates and radian orientation', (saved) => {
    const camera = nativeCamera();
    camera.setView({ destination: Cartesian3.fromDegrees(saved.lon, saved.lat, saved.heightM), orientation: { heading: saved.heading, pitch: saved.pitch, roll: 0 } });
    expect(CMath.toDegrees(camera.positionCartographic.latitude)).toBeCloseTo(saved.lat, 8);
    expect(CMath.toDegrees(camera.positionCartographic.longitude)).toBeCloseTo(saved.lon, 8);
    expect(camera.positionCartographic.height).toBeCloseTo(saved.heightM, 5);
    expect(camera.heading).toBeCloseTo(saved.heading, 8); expect(camera.pitch).toBeCloseTo(saved.pitch, 8);
    expect(validRestoreCamera(saved)).toEqual(saved);
  });

  it('reproduces native MORPHING setView no-op, then applies after actual camera mode settles', async () => {
    const camera = nativeCamera(), old = Cartesian3.clone(camera.positionWC), event = new Event();
    camera.update(SceneMode.MORPHING);
    const apply = () => camera.setView({ destination: Cartesian3.fromDegrees(SOUTH.lon, SOUTH.lat, SOUTH.heightM), orientation: { heading: SOUTH.heading, pitch: SOUTH.pitch, roll: 0 } });
    apply(); expect(camera.positionWC).toEqual(old);
    let morphing = true;
    const restore = new CameraRestorer('3d');
    restore.attach({ mode: () => morphing ? 'morphing' : '3d', morphTo: () => {}, onMorphComplete: callback => event.addEventListener(callback), cancelFlight: () => camera.cancelFlight(),
      apply: (_saved, _animate, complete) => { apply(); complete(); }, report: () => {} });
    const pending = restore.restore(SOUTH, { animate: false });
    expect(camera.positionWC).toEqual(old);
    camera.update(SceneMode.SCENE3D); morphing = false; event.raiseEvent();
    expect(await pending).toBe(true);
    expect(CMath.toDegrees(camera.positionCartographic.latitude)).toBeCloseTo(SOUTH.lat, 8);
    expect(camera.heading).toBeCloseTo(SOUTH.heading, 8);
  });

  it('restores native 2D projected coordinates and apparent frustum height without treating radians as degrees', () => {
    const camera = nativeCamera('2d');
    camera.setView({ destination: Cartesian3.fromDegrees(-179.8, -16, 150_000) });
    expect(CMath.toDegrees(camera.positionCartographic.latitude)).toBeCloseTo(-16, 8);
    expect(CMath.toDegrees(camera.positionCartographic.longitude)).toBeCloseTo(-179.8, 8);
    expect(camera.positionCartographic.height).toBeCloseTo(150_000, 5);
  });

  it('preserves both antimeridian signs and canonicalizes only captured infinite-scroll world wraps', () => {
    expect(capturedCamera({ ...TOKYO, lon: 180 })?.lon).toBe(180);
    expect(capturedCamera({ ...TOKYO, lon: -180 })?.lon).toBe(-180);
    expect(capturedCamera({ ...TOKYO, lon: 181 })?.lon).toBe(-179);
    expect(capturedCamera({ ...TOKYO, lon: -181 })?.lon).toBe(179);
    expect(validRestoreCamera({ ...TOKYO, lon: 181 })).toBeNull();
    expect(capturedCamera({ ...TOKYO, lon: Infinity })).toBeNull();
  });
});
