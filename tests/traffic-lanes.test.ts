// Simulated traffic sits on the visible road surface and spreads across lanes (reported 2026-11-23: dots floated above
// the photoreal roads and ran in one file down the centre line). Lane spread is simulated; no source publishes lanes.
import { Cartesian3, Cartographic } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import type { GeoRecord } from '../src/shared/layers';
import { ASSUMED_LANES, LANE_WIDTH_M, laneOf, laneOffsetM, MAX_LANES, simRoad } from '../src/shared/trafficSim';
import { TrafficSim } from '../src/renderer/map/trafficSim';
vi.mock('../src/renderer/lib/cesiumBase', () => ({})); // sets window.CESIUM_BASE_URL; there is no window in node

const road = (props: Record<string, unknown> = {}): GeoRecord => ({ id: 'nyc|link-1', lat: 40.7, lon: -74, altM: null, heading: null, speedKmh: undefined, speedKts: null, label: 'BQE', category: 'slow', observedAt: null, sourceUrl: null, source: 's', props: { speedKmh: 25, ...props }, geometry: { type: 'LineString', coordinates: [[-74, 40.7], [-74.002, 40.7]] } } as unknown as GeoRecord);

describe('simulated lanes', () => {
  it('assumes two lanes unless the source publishes a count, and says which', () => {
    expect(simRoad(road())).toMatchObject({ lanes: ASSUMED_LANES, laneBasis: 'assumed' });
    expect(simRoad(road({ lanes: 3 }))).toMatchObject({ lanes: 3, laneBasis: 'published' });
    expect(simRoad(road({ lanes: 40 }))?.lanes).toBe(MAX_LANES);
    expect(simRoad(road({ lanes: 0 }))?.laneBasis).toBe('assumed');
  });
  it('centres lanes on the drawn line and keeps each dot in a stable lane', () => {
    expect(laneOffsetM(0, 1)).toBe(0);
    expect(laneOffsetM(0, 2)).toBe(-LANE_WIDTH_M / 2);
    expect(laneOffsetM(1, 2)).toBe(LANE_WIDTH_M / 2);
    expect(laneOffsetM(1, 3)).toBe(0);
    const lanes = Array.from({ length: 200 }, (_, i) => laneOf('nyc|link-1', i, 3));
    expect(new Set(lanes)).toEqual(new Set([0, 1, 2]));
    expect(laneOf('nyc|link-1', 17, 3)).toBe(lanes[17]);
  });
});

function harness(surfaceH: number | undefined, terrainH: number | undefined) {
  const sim = Object.create(TrafficSim.prototype) as TrafficSim;
  Object.assign(sim, {
    widget: { scene: { globe: { getHeight: () => terrainH } } },
    surface: surfaceH === undefined ? null : { getHeight: () => surfaceH },
    carto: new Cartographic(), scratch: new Cartesian3(), side: new Cartesian3(),
    roads: [], tags: { show: false }, tagged: [],
  });
  return sim as unknown as { seatPoint3(lon: number, lat: number, seated: Uint8Array, i: number): Cartesian3; rebuildRight(r: unknown): void; place(dt: number): void; roads: unknown[] };
}
const heightOf = (p: Cartesian3) => Cartographic.fromCartesian(p).height;

describe('simulated traffic on the road surface', () => {
  it('takes its height from the photoreal mesh when it shows, not the terrain or the ellipsoid', () => {
    const seated = new Uint8Array(1);
    // New York streets lie about 30 m below the ellipsoid; the old code put dots at 0 m where terrain was not loaded.
    const p = harness(-28, undefined).seatPoint3(-74, 40.7, seated, 0);
    expect(heightOf(p)).toBeCloseTo(-27.4, 1);
    expect(seated[0]).toBe(2);
    const t = harness(undefined, -30).seatPoint3(-74, 40.7, seated, 0);
    expect(heightOf(t)).toBeCloseTo(-29.4, 1);
    expect(seated[0]).toBe(1);
  });
  it('places dots across lanes, sideways from the line by the lane offset', () => {
    const sim = harness(0, 0);
    const a = Cartesian3.fromDegrees(-74, 40.7, 0), b = Cartesian3.fromDegrees(-74.002, 40.7, 0);
    // Like a Cesium PointPrimitive, the position setter copies the value (place() reuses one scratch vector).
    const dot = () => { let p = new Cartesian3(); return { get position() { return p; }, set position(v: Cartesian3) { p = Cartesian3.clone(v); } }; };
    const dots = [dot(), dot()];
    const r = { id: 'x', pts: [a, b], cum: new Float64Array([0, Cartesian3.distance(a, b)]), length: Cartesian3.distance(a, b), speed: 0, offsets: [50, 50], lane: [-1.6, 1.6], dots, right: [] as Cartesian3[] };
    sim.rebuildRight(r);
    sim.roads = [r];
    sim.place(0);
    expect(Cartesian3.distance(dots[0].position, dots[1].position)).toBeCloseTo(3.2, 2);
    // Both stay at road height.
    expect(Math.abs(heightOf(dots[0].position))).toBeLessThan(0.01);
  });
});
