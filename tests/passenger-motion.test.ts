import { Cartesian3, DataSourceCollection, EntityCollection, Event, JulianDate, SceneMode, type CesiumWidget } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { passengerMotionEndMs, passengerPose, passengerVisualBank, updatePassengerMotion } from '../src/shared/aircraft';
import type { GeoRecord, LayerId } from '../src/shared/layers';

const start = Date.parse('2026-11-11T14:00:00Z');
const first: GeoRecord = {
  id: 'abc123', label: 'BAW117', lat: 45, lon: 179.99, altM: 10000, heading: 90, speedKts: 430,
  observedAt: new Date(start).toISOString(), source: 'fixture', sourceUrl: null, category: null,
  props: { callsign: 'BAW117', directionSource: 'ground-track', onGround: false },
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('passenger flight display motion', () => {
  it('banks only while the smoothed displayed direction turns and levels out afterwards', () => {
    const old = updatePassengerMotion(undefined, { ...first, heading: 350 }, passengerMotionEndMs(first)!, start);
    const next = { ...first, heading: 10, observedAt: new Date(start + 10000).toISOString() };
    const turn = updatePassengerMotion(old, next, passengerMotionEndMs(next)!, start + 10000);
    expect(passengerVisualBank(turn, turn.correction!.start)).toBe(0);
    expect(passengerVisualBank(turn, (turn.correction!.start + turn.correction!.end) / 2)).toBeGreaterThan(0);
    expect(passengerVisualBank(turn, turn.correction!.end)).toBe(0);
    expect(passengerVisualBank(undefined, start)).toBe(0);
  });
  it('moves between frames, crosses the date line, and freezes at the 45 s horizon', () => {
    const motion = updatePassengerMotion(undefined, first, passengerMotionEndMs(first)!, start);
    expect(passengerPose(motion, start - 3000)).toMatchObject({ lat: first.lat, lon: first.lon });
    expect(passengerPose(motion, start + 32).lon).toBeGreaterThan(passengerPose(motion, start + 16).lon);
    expect(passengerPose(motion, start + 8000).lon).toBeLessThan(-179.9);
    expect(passengerPose(motion, start + 45_000)).toEqual(passengerPose(motion, start + 1_000_000));
    expect(first.lon).toBe(179.99);
  });

  it('blends horizontal corrections, turning through north and reported altitude without restarting on duplicate polls', () => {
    const before = { ...first, heading: 352 };
    const old = updatePassengerMotion(undefined, before, passengerMotionEndMs(before)!, start);
    const receipt = start + 10_000;
    const prior = passengerPose(old, receipt);
    const corrected = { ...first, lon: -179.99, lat: prior.lat, altM: 10100, heading: 8,
      observedAt: new Date(receipt).toISOString() };
    const motion = updatePassengerMotion(old, corrected, passengerMotionEndMs(corrected)!, receipt);
    const atReceipt = passengerPose(motion, receipt);
    expect(atReceipt.lon).toBeCloseTo(prior.lon, 8);
    expect(atReceipt.lat).toBeCloseTo(prior.lat, 8);
    expect(atReceipt.heading).toBe(352);
    expect(atReceipt.altM).toBe(10000);
    expect(passengerPose(motion, receipt + 2000).heading).toBe(0);
    expect(passengerPose(motion, receipt + 2000).altM).toBe(10050);
    expect(Math.abs(passengerPose(motion, receipt + 2000).lon)).toBeGreaterThan(179.9);
    expect(updatePassengerMotion(motion, { ...corrected }, motion.endMs, receipt + 2000)).toBe(motion);
    expect(passengerPose(motion, receipt + 4000)).toEqual(passengerPose({ ...motion, correction: undefined }, receipt + 4000));
    expect(updatePassengerMotion(motion, before, old.endMs, receipt + 5000)).toBe(motion);
  });

  it('blends a new fix after a long outage or a large correction', () => {
    const old = updatePassengerMotion(undefined, first, passengerMotionEndMs(first)!, start);
    for (const [elapsed, lon] of [[120_000, first.lon], [10_000, -45]]) {
      const time = start + elapsed;
      const next = { ...first, observedAt: new Date(time).toISOString(), lon };
      const motion = updatePassengerMotion(old, next, passengerMotionEndMs(next)!, time);
      expect(motion.correction).toBeDefined();
      const prior = passengerPose(old, time);
      expect(passengerPose(motion, time).lat).toBeCloseTo(prior.lat, 8);
      expect(passengerPose(motion, time).lon).toBeCloseTo(prior.lon, 8);
      expect(motion.correction!.end - time).toBeLessThanOrEqual(30000);
    }
  });

  it('requires current reports with a usable ground track and speed', () => {
    const exclusions: GeoRecord['props'][] = [{ snapshot: true }, { onGround: true }, { directionSource: 'true-heading' }];
    const records = [
      { ...first, observedAt: 'invalid' }, { ...first, observedAt: null }, { ...first, speedKts: 20 },
      { ...first, heading: null }, { ...first, speedKts: null },
      ...exclusions.map(props => ({ ...first, props: { ...first.props, ...props } })),
    ];
    for (const record of records) expect(passengerMotionEndMs(record)).toBeNull();
    const eligible: GeoRecord['props'][] = [{callsign:'N123AB'}, {militaryFlag:true}, {callsign:null}];
    for (const props of eligible) {
      expect(passengerMotionEndMs({ ...first, props: { ...first.props, ...props } })).not.toBeNull();
    }
  });
});

function harness(batched: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  const scene = { mode: SceneMode.SCENE3D, preRender: new Event(), morphComplete: new Event(),
    requestRender: vi.fn(), primitives: { remove: vi.fn() } };
  const widget = { dataSources: new DataSourceCollection(), entities: new EntityCollection(), scene,
    camera: { positionWC: Cartesian3.fromDegrees(180, 45, 700_000), positionCartographic: { height: 700_000 } } };
  const renderer = new LayerRenderer(widget as unknown as CesiumWidget);
  const internals = renderer as unknown as {
    bulk: Map<string, object>; iconFor(): string; models: { move(key: string, position: Cartesian3, heading: number): void };
  };
  vi.spyOn(internals, 'iconFor').mockReturnValue('aircraft.png');
  const move = vi.spyOn(internals.models, 'move');
  // The Cesium entity, frame cadence, reports and positions are real. Only the GPU billboard collection is substituted.
  const filler = batched ? Array.from({ length: 1500 }, (_, n) =>
    ({ ...first, id: 'snapshot-' + n, props: { snapshot: true } })) : [];
  if (batched) internals.bulk.set('aircraft', {
    byId: new Map(), coll: { show: true, add: (billboard: object) => ({ ...billboard }), remove: vi.fn() },
  });
  const update = (record: GeoRecord, smooth = true, selected = false, layer: LayerId = 'aircraft') => renderer.update(layer, [record, ...filler], {
    selectedLayer: selected ? layer : null, selectedId: selected ? record.id : null, trackedId: null, smoothMotion: smooth,
  });
  const tick = (time: number) => { vi.setSystemTime(time); const next = frame; frame = undefined; next?.(time - start); };
  return { renderer, move, update, tick, entities: widget.entities, framePending: () => !!frame };
}

it('keeps recorded trail fixes intact while the dashed end follows the drawn aircraft and cleans up', () => {
  const h = harness(false);
  try {
    h.update(first);
    h.renderer.showTrail([{ lat: first.lat, lon: first.lon, altM: first.altM, onGround: false }], 'aircraft', { layer: 'aircraft', id: first.id });
    const link = h.entities.getById('trail|estimated')!;
    const now = JulianDate.now();
    const before = link.polyline!.positions!.getValue(now)!;
    h.tick(start + 1000);
    const after = link.polyline!.positions!.getValue(now)!;
    expect(after[0]).toEqual(before[0]);
    expect(Cartesian3.distance(after[1], before[1])).toBeGreaterThan(10);
    expect(after[1]).toEqual(h.renderer.positionFor('aircraft', first.id));
    h.renderer.showTrail(null, 'aircraft');
    expect(h.entities.getById('trail|estimated')).toBeUndefined();
  } finally { h.renderer.destroy(); }
});

it.each([false, true])('keeps the followed target, marker, and model together through frames and new reports (bulk=%s)', batched => {
  const h = harness(batched);
  try {
    h.update(first);
    const position = () => h.renderer.positionFor('aircraft', first.id)!;
    const origin = position();
    h.tick(start + 16);
    const next = position();
    expect(Cartesian3.distance(origin, next)).toBeGreaterThan(2);
    expect(h.move.mock.lastCall?.[1]).toEqual(next);
    // A selection redraw and a second fix on a different course cannot rewind or teleport the marker.
    h.update({ ...first }, true, true);
    expect(position()).toEqual(next);
    h.tick(start + 2000);
    const before = position();
    const fix = { ...first, lat: first.lat + .01, altM: 10100, heading: 40, observedAt: new Date(start + 2000).toISOString() };
    h.update(fix);
    expect(Cartesian3.distance(before, position())).toBeLessThan(.001);
    h.tick(start + 2016);
    expect(h.move.mock.lastCall?.[1]).toEqual(position());
    expect(Cartesian3.distance(before, position())).toBeLessThan(8);
    h.update({ ...first, heading: null });
    expect(h.renderer.recordFor('aircraft', first.id)).toEqual(fix);
    h.tick(start + 48_000);
    expect(h.framePending()).toBe(false);
    expect(h.renderer.recordFor('aircraft', first.id)?.lat).toBe(fix.lat);
    h.update(fix, false);
    expect(position()).toEqual(Cartesian3.fromDegrees(fix.lon, fix.lat, fix.altM));
  } finally { h.renderer.destroy(); }
});

it.each(['aircraft', 'aircraftMil'] as const)('smooths non-airline aircraft on the %s layer', layer => {
  const h = harness(false);
  const plane = { ...first, props: { ...first.props, callsign: 'N123AB' } };
  try {
    h.update(plane, true, false, layer);
    const before = h.renderer.positionFor(layer, plane.id)!;
    h.tick(start + 16);
    const moving = h.renderer.positionFor(layer, plane.id)!;
    expect(Cartesian3.distance(before, moving)).toBeGreaterThan(2);
    expect(h.move.mock.lastCall?.[1]).toEqual(moving);
    const report = { ...plane, lat: plane.lat + .003, observedAt: new Date(start + 16).toISOString() };
    h.update(report, true, false, layer);
    expect(Cartesian3.distance(moving, h.renderer.positionFor(layer, plane.id)!)).toBeLessThan(.001);
  } finally { h.renderer.destroy(); }
});

it('smooths a fresh position that omits speed and track, then holds it', () => {
  const h = harness(false);
  try {
    h.update(first);
    h.tick(start + 2000);
    const before = h.renderer.positionFor('aircraft', first.id)!;
    const report = { ...first, lat: first.lat + .002, speedKts: null, heading: null,
      observedAt: new Date(start + 2000).toISOString() };
    h.update(report);
    expect(Cartesian3.distance(before, h.renderer.positionFor('aircraft', first.id)!)).toBeLessThan(.001);
    h.tick(start + 6000);
    const held = h.renderer.positionFor('aircraft', first.id)!;
    expect(Cartesian3.distance(held, Cartesian3.fromDegrees(report.lon, report.lat, report.altM!))).toBeLessThan(.001);
    expect(h.framePending()).toBe(false);
  } finally { h.renderer.destroy(); }
});

it('blends successive position reports when neither includes a speed or track', () => {
  const h = harness(false);
  const initial = { ...first, speedKts: null, heading: null };
  try {
    h.update(initial);
    expect(h.framePending()).toBe(false);
    const before = h.renderer.positionFor('aircraft', first.id)!;
    const report = { ...initial, lat: initial.lat + .002, observedAt: new Date(start + 2000).toISOString() };
    vi.setSystemTime(start + 2000);
    h.update(report);
    expect(Cartesian3.distance(before, h.renderer.positionFor('aircraft', first.id)!)).toBeLessThan(.001);
    expect(h.framePending()).toBe(true);
    h.tick(start + 6000);
    expect(Cartesian3.distance(h.renderer.positionFor('aircraft', first.id)!, Cartesian3.fromDegrees(report.lon, report.lat, report.altM!))).toBeLessThan(.001);
  } finally { h.renderer.destroy(); }
});

it('finishes a visual correction even when the prediction horizon expires', () => {
  const original = updatePassengerMotion(undefined, first, passengerMotionEndMs(first)!, start);
  const now = start + 44000;
  const report = { ...first, lat: first.lat + .02, observedAt: new Date(start + 1000).toISOString() };
  const motion = updatePassengerMotion(original, report, passengerMotionEndMs(report)!, now);
  const atReceipt = passengerPose(motion, now);
  const before = passengerPose(original, now);
  expect(atReceipt.lat).toBeCloseTo(before.lat, 8);
  expect(motion.correction!.end).toBeGreaterThan(motion.endMs);
  expect(passengerPose(motion, motion.correction!.end)).toEqual(passengerPose({ ...motion, correction: undefined }, motion.correction!.end));
});

it('keeps the two aircraft layers independent when their identifiers overlap', () => {
  const h = harness(false);
  const military = { ...first, lon: -70, props: { ...first.props, militaryFlag: true } };
  try {
    h.update(first);
    h.update(military, true, false, 'aircraftMil');
    const civilBefore = h.renderer.positionFor('aircraft', first.id)!;
    const militaryBefore = h.renderer.positionFor('aircraftMil', military.id)!;
    h.tick(start + 16);
    expect(Cartesian3.distance(civilBefore, h.renderer.positionFor('aircraft', first.id)!)).toBeGreaterThan(2);
    expect(Cartesian3.distance(militaryBefore, h.renderer.positionFor('aircraftMil', military.id)!)).toBeGreaterThan(2);
    h.update({ ...first, observedAt: new Date(start + 16).toISOString() });
    h.tick(start + 32);
    expect(Cartesian3.distance(militaryBefore, h.renderer.positionFor('aircraftMil', military.id)!)).toBeGreaterThan(4);
  } finally { h.renderer.destroy(); }
});

it('holds a future-dated observation without scheduling animation and accepts the next valid fix', () => {
  const h = harness(false);
  try {
    const future = { ...first, lon: 130, observedAt: new Date(start + 86_400_000).toISOString() };
    h.update(future);
    expect(h.framePending()).toBe(false);
    expect(h.renderer.positionFor('aircraft', first.id)).toEqual(Cartesian3.fromDegrees(130, future.lat, future.altM!));
    h.update(first);
    expect(h.framePending()).toBe(true);
    expect(h.renderer.recordFor('aircraft', first.id)).toBe(first);
    expect(h.renderer.positionFor('aircraft', first.id)).toEqual(Cartesian3.fromDegrees(first.lon, first.lat, first.altM!));
  } finally { h.renderer.destroy(); }
});
