import { Cartesian3, DataSourceCollection, Event, SceneMode, type CesiumWidget } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { passengerMotionEndMs, passengerPose, updatePassengerMotion } from '../src/shared/aircraft';
import { normalizeAdsb } from '../src/shared/layerNormalize';
import type { GeoRecord } from '../src/shared/layers';

const start = Date.parse('2026-11-11T14:00:00Z');
const first: GeoRecord = {
  id: 'abc123', label: 'BAW117', lat: 45, lon: 179.99, altM: 10000, heading: 90, speedKts: 430,
  observedAt: new Date(start).toISOString(), source: 'fixture', sourceUrl: null, category: null,
  props: { callsign: 'BAW117', directionSource: 'ground-track', onGround: false },
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('passenger flight display motion', () => {
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

  it('reacquires at the provider fix after a long outage or a discontinuous relocation', () => {
    const old = updatePassengerMotion(undefined, first, passengerMotionEndMs(first)!, start);
    for (const [elapsed, lon] of [[120_000, first.lon], [10_000, -45]]) {
      const time = start + elapsed;
      const next = { ...first, observedAt: new Date(time).toISOString(), lon };
      const motion = updatePassengerMotion(old, next, passengerMotionEndMs(next)!, time);
      expect(motion.correction).toBeUndefined();
      expect(passengerPose(motion, time)).toMatchObject({ lat: next.lat, lon });
    }
  });

  it('requires current passenger reports with a usable track and speed', () => {
    const exclusions: GeoRecord['props'][] = [{ snapshot: true }, { militaryFlag: true }, { onGround: true },
      { callsign: 'N123AB' }, { directionSource: 'true-heading' }];
    const records = [
      { ...first, observedAt: 'invalid' }, { ...first, observedAt: null }, { ...first, speedKts: 20 },
      { ...first, heading: null }, { ...first, speedKts: null },
      ...exclusions.map(props => ({ ...first, props: { ...first.props, ...props } })),
      ...[4, 8].map(dbFlags => normalizeAdsb({ now: start, ac: [{ hex: first.id, lat: 45, lon: -70,
        flight: 'BAW117', track: 90, gs: 400, alt_baro: 30000, dbFlags }] }, 'fixture', start).records[0]),
    ];
    for (const record of records) expect(passengerMotionEndMs(record)).toBeNull();
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
  const widget = { dataSources: new DataSourceCollection(), scene,
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
  const update = (record: GeoRecord, smooth = true, selected = false) => renderer.update('aircraft', [record, ...filler], {
    selectedLayer: selected ? 'aircraft' : null, selectedId: selected ? record.id : null, trackedId: null, smoothMotion: smooth,
  });
  const tick = (time: number) => { vi.setSystemTime(time); const next = frame; frame = undefined; next?.(time - start); };
  return { renderer, move, update, tick, framePending: () => !!frame };
}

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
