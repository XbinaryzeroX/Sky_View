import { describe, expect, it } from 'vitest';
import { ROOF_BLOCKED, ROOF_UNKNOWN, ROOF_VISIBLE, roofGroups, roofMask, rooftopExposure, routeOverlook, type SurfaceGrids } from '../src/shared/overwatch';
import { cellAt, computeViewshed, OUT, VISIBLE, type Grid } from '../src/shared/viewshed';
import { rasterizeFootprints } from '../src/shared/siteRaster';

const grid: Grid = { lat: 51.5, lon: -0.12, cellM: 4, n: 101 }; // 404 m square, subject at the centre
const N = grid.n * grid.n;
const M_LAT = 111_320;
const M_LON = 111_320 * Math.cos((grid.lat * Math.PI) / 180);
const ll = (eastM: number, northM: number) => ({ lat: grid.lat + northM / M_LAT, lon: grid.lon + eastM / M_LON });
const k = (eastM: number, northM: number) => {
  const c = cellAt(grid, eastM, northM)!;
  return c.row * grid.n + c.col;
};
/** Flat 10 m terrain with box buildings: [east0, north0, east1, north1, height]. */
function surface(boxes: [number, number, number, number, number][]): SurfaceGrids {
  const ground = new Float32Array(N).fill(10);
  const buildings = new Float32Array(N);
  for (const [e0, n0, e1, n1, h] of boxes)
    for (let e = e0; e <= e1; e += grid.cellM) for (let n = n0; n <= n1; n += grid.cellM) buildings[k(e, n)] = h;
  return { grid, ground, buildings, bases: new Float32Array(N) };
}
const subject = { ...ll(0, 0), heightM: 1.7 };

describe('rooftop line of sight to the subject', () => {
  it('lists a clear roof with its distance, direction and angle', () => {
    const s = surface([[60, -8, 80, 8, 20]]);
    const r = rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 });
    expect(r.rooftops).toHaveLength(1);
    const t = r.rooftops[0];
    expect(t.distanceM).toBeGreaterThan(55);
    expect(t.distanceM).toBeLessThan(65);
    expect(t.bearingDeg).toBeGreaterThan(80);
    expect(t.bearingDeg).toBeLessThan(100);
    expect(t.elevationDeg).toBeGreaterThan(10); // 20 m roof at 60 m: looking up
    expect(t.heightM).toBe(20);
    expect(r.classes[k(60, 0)]).toBe(ROOF_VISIBLE);
  });

  it('does not list a roof hidden behind a taller building, and marks it blocked', () => {
    const s = surface([[40, -12, 48, 12, 40], [80, -8, 100, 8, 15]]);
    const r = rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 });
    expect(r.rooftops).toHaveLength(1); // only the near tall block, seen from its edge
    expect(r.rooftops[0].distanceM).toBeLessThan(50);
    expect(r.classes[k(92, 0)]).toBe(ROOF_BLOCKED);
  });

  it('reports a roof as undetermined, not clear or safe, when terrain on the way is missing', () => {
    const s = surface([[80, -8, 100, 8, 15]]);
    for (let e = 30; e <= 50; e += grid.cellM) for (let n = -60; n <= 60; n += grid.cellM) s.ground[k(e, n)] = Number.NaN;
    const r = rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 });
    expect(r.rooftops).toHaveLength(0);
    expect(r.undetermined).toBe(1);
    expect(r.classes[k(80, 0)]).toBe(ROOF_UNKNOWN); // the front edge: the line crosses the missing terrain
  });

  it('counts cells whose building data is unavailable separately', () => {
    const s = surface([]);
    s.buildings[k(40, 40)] = Number.NaN;
    const r = rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 });
    expect(r.unknownBuildingCells).toBe(1);
    expect(r.rooftops).toHaveLength(0);
  });

  it('says when the subject marker stands on a mapped building (modelled on its roof)', () => {
    expect(rooftopExposure(surface([[-8, -8, 8, 8, 12]]), subject, { roofEyeM: 1.5, rangeM: 300 }).subjectRoofM).toBe(12);
    expect(rooftopExposure(surface([]), subject, { roofEyeM: 1.5, rangeM: 300 }).subjectRoofM).toBeNull();
  });

  it('ignores roofs beyond the range', () => {
    const s = surface([[150, -8, 170, 8, 20]]);
    expect(rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 100 }).rooftops).toHaveLength(0);
    expect(rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 }).rooftops).toHaveLength(1);
  });
});

describe('roof edges', () => {
  it('counts a person at the roof edge, who can look down past the wall below them', () => {
    // A 40 m block 30 m away: from the ground the line to mid-cell would pass through the wall; to the edge it does not.
    const s = surface([[30, -8, 50, 8, 40]]);
    const r = rooftopExposure(s, subject, { roofEyeM: 1.5, rangeM: 300 });
    expect(r.rooftops).toHaveLength(1);
    expect(r.classes[k(30, 0)]).toBe(ROOF_VISIBLE);
    expect(r.classes[k(50, 0)]).toBe(ROOF_BLOCKED); // the far side of the same roof is behind its front edge
  });
});

describe('roof groups', () => {
  it('joins touching roof cells of similar height and splits a tower from its annex', () => {
    const s = surface([[40, 0, 60, 20, 12], [64, 0, 72, 20, 30]]);
    const g = new Int32Array(N);
    const count = roofGroups(grid, s.buildings, g);
    expect(count).toBe(2);
    expect(g[k(40, 0)]).toBe(g[k(60, 20)]);
    expect(g[k(40, 0)]).not.toBe(g[k(68, 8)]);
    expect(g[k(0, 0)]).toBe(-1);
  });

  it('marks roofs and unknown building data for the masked analysis', () => {
    const b = new Float32Array([0, 5, Number.NaN, 0]);
    expect([...roofMask(b)]).toEqual([0, 1, 1, 0]);
  });
});

describe('viewshed mask', () => {
  it('leaves masked-out cells unanalysed', () => {
    const s = surface([]);
    const mask = new Uint8Array(N);
    mask[k(20, 0)] = 1;
    const r = computeViewshed({ ...s, mask, observer: { ...ll(0, 0), heightM: 1.7, rangeM: 200, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 });
    expect(r.counts.analysed).toBe(1);
    expect(r.classes[k(20, 0)]).toBe(VISIBLE);
    expect(r.classes[k(40, 0)]).toBe(OUT);
  });
});

describe('route overlook', () => {
  const line = (pts: [number, number][]) => pts.map(([e, n]) => { const p = ll(e, n); return [p.lon, p.lat] as [number, number]; });
  const opts = { eyeM: 1.7, roofEyeM: 1.5, rangeM: 120, spacingM: 10, maxSamples: 60 };

  it('measures the share of a route with a clear line to a mapped roof', () => {
    const s = surface([[60, -8, 80, 8, 20]]);
    const r = routeOverlook(s, line([[-180, 0], [180, 0]]), opts);
    expect(r.rooftops).toBe(1);
    expect(r.overlooked).toBeGreaterThan(0.4);
    expect(r.overlooked + r.clear + r.unknown).toBeCloseTo(1, 5);
    expect(r.outside).toBeCloseTo(0, 2);
  });

  it('is clear where no roof is in range, and counts the part outside the grid as outside', () => {
    const s = surface([[150, 150, 170, 170, 20]]);
    const r = routeOverlook(s, line([[-100, -150], [-100, 0], [-100, 400]]), opts);
    expect(r.rooftops).toBe(0);
    expect(r.overlooked).toBe(0);
    expect(r.clear).toBeCloseTo(1, 5);
    expect(r.outside).toBeGreaterThan(0.3);
  });

  it('keeps every share within 0–1 however the samples add up (saved plans reject anything else)', () => {
    const s = surface([[60, -8, 80, 8, 20]]);
    for (const spacingM of [3, 7, 9.3, 11]) {
      const r = routeOverlook(s, line([[-180, 0], [180, 0]]), { ...opts, spacingM, maxSamples: 500 });
      for (const v of [r.overlooked, r.clear, r.unknown, r.outside]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns nothing measured for a route entirely outside the grid', () => {
    const r = routeOverlook(surface([]), line([[600, 600], [700, 700]]), opts);
    expect(r.samples).toBe(0);
    expect(r.outside).toBe(1);
  });
});

describe('footprint ids', () => {
  it('records which footprint sets each roof', () => {
    const out = new Float32Array(N);
    const ids = new Int32Array(N).fill(-1);
    const sq = (e0: number, n0: number, e1: number, n1: number) => [ll(e0, n0), ll(e1, n0), ll(e1, n1), ll(e0, n1), ll(e0, n0)].map((p) => [p.lon, p.lat] as [number, number]);
    rasterizeFootprints(grid, [{ rings: [sq(20, 20, 40, 40)], heightM: 10 }, { rings: [sq(30, 30, 50, 50)], heightM: 25 }], out, new Float32Array(N), ids);
    expect(ids[k(24, 24)]).toBe(0);
    expect(ids[k(36, 36)]).toBe(1); // overlap: the taller part sets the roof
    expect(ids[k(0, 0)]).toBe(-1);
  });
});
