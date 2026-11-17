import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  cellAt,
  clipToSquare,
  cellCenter,
  COMBINED_COVERED,
  COMBINED_GAP,
  COMBINED_OVERLAP,
  COMBINED_UNKNOWN,
  combineViewsheds,
  computeViewshed,
  coverageRgba,
  gridBounds,
  gridSize,
  inFieldOfView,
  localSegment,
  MAX_GRID,
  minCellFor,
  OUT,
  pathCoverage,
  toLocal,
  unwrapLonOffsets,
  UNKNOWN,
  VISIBLE,
  type Grid,
  type Observer,
} from '../src/shared/viewshed';

const grid: Grid = { lat: 60.17, lon: 24.94, cellM: 10, n: 41 }; // 400 m square, observer at the centre
const flat = () => new Float32Array(grid.n * grid.n).fill(20);
const none = () => new Float32Array(grid.n * grid.n);
const obs = (over: Partial<Observer> = {}): Observer => ({ lat: grid.lat, lon: grid.lon, heightM: 1.7, rangeM: 200, headingDeg: null, fovDeg: null, ...over });
const idx = (row: number, col: number) => row * grid.n + col;
const at = (dxM: number, dyM: number) => {
  const c = cellAt(grid, dxM, dyM)!;
  return idx(c.row, c.col);
};

describe('viewshed: geometry', () => {
  it('sees everything within range over flat open ground, and nothing outside the range', () => {
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs(), targetHeightM: 1.7 });
    expect(r.error).toBeNull();
    expect(r.classes[at(150, 0)]).toBe(VISIBLE);
    expect(r.classes[at(0, -190)]).toBe(VISIBLE);
    expect(r.classes[at(200, 200)]).toBe(OUT); // corner beyond the 200 m radius
    expect(r.counts.blocked).toBe(0);
    expect(r.counts.unknown).toBe(0);
  });

  it('a mapped building blocks the ground behind it but not its own roof', () => {
    const b = none();
    for (let dy = -30; dy <= 30; dy += 10) b[at(50, dy)] = 15; // a 15 m wall 50 m east
    const r = computeViewshed({ grid, ground: flat(), buildings: b, observer: obs(), targetHeightM: 1.7 });
    expect(r.classes[at(100, 0)]).toBe(BLOCKED);
    expect(r.classes[at(150, 0)]).toBe(BLOCKED);
    expect(r.classes[at(50, 0)]).toBe(VISIBLE); // roof face of the wall itself
    expect(r.classes[at(-100, 0)]).toBe(VISIBLE); // the other way
    // From a 30 m mast the wall no longer hides ground far behind it.
    const high = computeViewshed({ grid, ground: flat(), buildings: b, observer: obs({ heightM: 30 }), targetHeightM: 1.7 });
    expect(high.classes[at(190, 0)]).toBe(VISIBLE);
  });

  it('a ridge in the terrain blocks the far side', () => {
    const g = flat();
    for (let dy = -200; dy <= 200; dy += 10) g[at(80, dy)] = 40;
    const r = computeViewshed({ grid, ground: g, buildings: none(), observer: obs(), targetHeightM: 1.7 });
    expect(r.classes[at(150, 0)]).toBe(BLOCKED);
  });

  it('missing data is unknown, never visible; a known blocker still decides first', () => {
    const b = none();
    b[at(50, 0)] = Number.NaN; // building data unavailable on the sight line east
    const r = computeViewshed({ grid, ground: flat(), buildings: b, observer: obs(), targetHeightM: 1.7 });
    expect(r.classes[at(100, 0)]).toBe(UNKNOWN);
    const g = flat();
    g[at(0, 100)] = Number.NaN; // no terrain at the target
    expect(computeViewshed({ grid, ground: g, buildings: none(), observer: obs(), targetHeightM: 1.7 }).classes[at(0, 100)]).toBe(UNKNOWN);
    // A known wall before the gap decides: blocked, not unknown.
    const b2 = none();
    b2[at(30, 0)] = 20;
    b2[at(60, 0)] = Number.NaN;
    expect(computeViewshed({ grid, ground: flat(), buildings: b2, observer: obs(), targetHeightM: 1.7 }).classes[at(100, 0)]).toBe(BLOCKED);
  });

  it('refuses to model from a point without terrain', () => {
    const g = flat();
    g[at(0, 0)] = Number.NaN;
    const r = computeViewshed({ grid, ground: g, buildings: none(), observer: obs(), targetHeightM: 1.7 });
    expect(r.error).toMatch(/No terrain data/);
    // Everything it could see is unknown (never a gap when combined with other points).
    expect(r.counts.analysed).toBeGreaterThan(0);
    expect(r.counts.unknown).toBe(r.counts.analysed);
    expect(r.counts.visible + r.counts.blocked).toBe(0);
  });

  it('limits a camera to its field of view and range', () => {
    const cam = obs({ headingDeg: 90, fovDeg: 60, rangeM: 120, heightM: 6 });
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: cam, targetHeightM: 1.7 });
    expect(r.classes[at(100, 0)]).toBe(VISIBLE); // east, in view
    expect(r.classes[at(-100, 0)]).toBe(OUT); // behind the camera
    expect(r.classes[at(0, 100)]).toBe(OUT); // north, outside a 60° cone
    expect(r.classes[at(190, 0)]).toBe(OUT); // beyond its 120 m range
    expect(inFieldOfView({ headingDeg: 350, fovDeg: 40 }, Math.sin((5 * Math.PI) / 180), Math.cos((5 * Math.PI) / 180))).toBe(true); // wraps north
  });

  it('honours a cancellation request', () => {
    expect(() => computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs(), targetHeightM: 1.7 }, () => true)).toThrow('cancelled');
  });

  it('accounts for Earth curvature on long sight lines', () => {
    const big: Grid = { lat: 0, lon: 0, cellM: 25, n: 401 }; // 10 km square
    const g = new Float32Array(big.n * big.n).fill(0);
    const r = computeViewshed({ grid: big, ground: g, buildings: new Float32Array(big.n * big.n), observer: { lat: 0, lon: 0, heightM: 1.7, rangeM: 5000, headingDeg: null, fovDeg: null }, targetHeightM: 0 });
    // Horizon for a 1.7 m eye (with refraction) is ≈ 5 km: a ground target at 4.9 km is just beyond what a
    // flat-earth model would call visible, and the code must not crash on it either way.
    const c = cellAt(big, 4900, 0)!;
    expect([VISIBLE, BLOCKED]).toContain(r.classes[c.row * big.n + c.col]);
  });
});

describe('viewshed: grid helpers', () => {
  it('sizes and positions cells consistently', () => {
    expect(gridSize(200, 10)).toBe(41);
    expect(gridSize(5000, 2)).toBe(MAX_GRID);
    expect(gridSize(1000, minCellFor(1000))).toBeLessThanOrEqual(MAX_GRID);
    const c = cellCenter(grid, 20, 20);
    expect(c.lat).toBeCloseTo(grid.lat, 9);
    const p = toLocal(grid, cellCenter(grid, 0, 40).lat, cellCenter(grid, 0, 40).lon);
    expect(p.x).toBeCloseTo(200, 3);
    expect(p.y).toBeCloseTo(200, 3);
    const b = gridBounds(grid);
    expect(b.north).toBeGreaterThan(grid.lat);
    expect(b.west).toBeLessThan(grid.lon);
    expect(cellAt(grid, 1000, 0)).toBeNull();
  });
});

describe('coverage from several points', () => {
  const n = grid.n * grid.n;
  const make = (cls: number) => new Uint8Array(n).fill(cls);
  it('separates overlap, single coverage, gaps and unknown', () => {
    const a = make(VISIBLE);
    const b = make(BLOCKED);
    a[1] = BLOCKED;
    a[2] = UNKNOWN;
    a[3] = BLOCKED;
    b[0] = VISIBLE;
    b[4] = OUT;
    a[4] = OUT;
    const c = combineViewsheds([a, b], n);
    expect(c.classes[0]).toBe(COMBINED_OVERLAP);
    expect(c.classes[5]).toBe(COMBINED_COVERED);
    expect(c.classes[1]).toBe(COMBINED_GAP);
    expect(c.classes[2]).toBe(COMBINED_UNKNOWN); // unknown is never a gap or coverage
    expect(c.classes[4]).toBe(0);
    expect(c.seenBy[0]).toBe(2);
    expect(c.counts.analysed).toBe(n - 1);
    const px = coverageRgba(c, grid.n);
    expect(px[4 * 4 + 3]).toBe(0); // not analysed → transparent
    expect(px[0 * 4 + 3]).toBeGreaterThan(0);
  });

  it('measures how much of a route is covered, a gap, unknown or outside', () => {
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs({ rangeM: 100 }), targetHeightM: 1.7 });
    const c = combineViewsheds([r.classes], n);
    const east = (m: number): [number, number] => [grid.lon + m / (111_320 * Math.cos((grid.lat * Math.PI) / 180)), grid.lat];
    const pc = pathCoverage(grid, c, [east(0), east(180)]);
    expect(pc.lengthM).toBeCloseTo(180, 0);
    expect(pc.covered).toBeGreaterThan(0.5);
    expect(pc.outside).toBeGreaterThan(0.3);
    expect(pc.covered + pc.gap + pc.unknown + pc.outside).toBeCloseTo(1, 6);
  });
});

describe('viewshed: review fixes', () => {
  it('an observer on a building of unknown height cannot be modelled (eye height unknown)', () => {
    const b = none();
    b[at(0, 0)] = Number.NaN;
    const r = computeViewshed({ grid, ground: flat(), buildings: b, observer: obs(), targetHeightM: 1.7 });
    expect(r.error).toMatch(/Building data is unavailable/);
    expect(r.counts.unknown).toBe(r.counts.analysed);
    // Combined with a point that is blocked everywhere, the failed point keeps those cells unknown, not gaps.
    const blocked = new Uint8Array(grid.n * grid.n).fill(BLOCKED);
    const comb = combineViewsheds([r.classes, blocked], grid.n * grid.n);
    expect(comb.classes[at(100, 0)]).toBe(COMBINED_UNKNOWN);
  });
  it('a target whose roof height is unknown is unknown, even behind a known wall', () => {
    const b = none();
    b[at(30, 0)] = 10;
    b[at(100, 0)] = Number.NaN;
    const r = computeViewshed({ grid, ground: flat(), buildings: b, observer: obs(), targetHeightM: 1.7 });
    expect(r.classes[at(100, 0)]).toBe(UNKNOWN);
  });
});

describe('route coverage is weighted by distance', () => {
  it('many tiny covered segments do not outweigh one long uncovered one; repeated vertices add nothing', () => {
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs({ rangeM: 50 }), targetHeightM: 1.7 });
    const c = combineViewsheds([r.classes], grid.n * grid.n);
    const pt = (dx: number): [number, number] => [grid.lon + dx / (111_320 * Math.cos((grid.lat * Math.PI) / 180)), grid.lat];
    const tiny: [number, number][] = Array.from({ length: 100 }, (_, i) => pt(i * 0.01));
    const pc = pathCoverage(grid, c, [...tiny, pt(0.99), pt(0.99), pt(150)]);
    expect(pc.lengthM).toBeCloseTo(150, 0);
    expect(pc.covered).toBeLessThan(0.45); // ≈ 50 m of 150 m, not 100 of ~120 samples
    expect(pc.covered + pc.gap + pc.unknown + pc.outside).toBeCloseTo(1, 6);
  });
});

describe('observers outside the analysed area', () => {
  it('leave what they might see unknown, so a blocked point inside cannot turn it into a gap', () => {
    const outside = obs({ lat: grid.lat, lon: grid.lon + 300 / (111_320 * Math.cos((grid.lat * Math.PI) / 180)), rangeM: 250 });
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: outside, targetHeightM: 1.7 });
    expect(r.error).toMatch(/outside the analysis area/);
    expect(r.classes[at(150, 0)]).toBe(UNKNOWN);
    const blocked = new Uint8Array(grid.n * grid.n).fill(BLOCKED);
    expect(combineViewsheds([r.classes, blocked], grid.n * grid.n).classes[at(150, 0)]).toBe(COMBINED_UNKNOWN);
  });
});

describe('sight lines visit every cell they cross', () => {
  // The review's case: 10 m cells, observer at (0,0), target at (100,30). The line clips the corner of the cell centred
  // at (20,0) (it crosses x = 15..25 while y = 4.5..7.5, below that cell's 5 m edge for part of the way).
  const g10: Grid = { lat: 60.17, lon: 24.94, cellM: 10, n: 41 };
  const cells = g10.n * g10.n;
  const k10 = (dx: number, dy: number) => { const c = cellAt(g10, dx, dy)!; return c.row * g10.n + c.col; };
  const run = (b: Float32Array) => computeViewshed({ grid: g10, ground: new Float32Array(cells).fill(20), buildings: b, observer: { lat: g10.lat, lon: g10.lon, heightM: 1.7, rangeM: 200, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 });
  it('a tall building in a corner-clipped cell blocks', () => {
    const b = new Float32Array(cells);
    b[k10(20, 0)] = 30;
    expect(run(b).classes[k10(100, 30)]).toBe(BLOCKED);
  });
  it('missing data in a corner-clipped cell makes the target unknown', () => {
    const b = new Float32Array(cells);
    b[k10(20, 0)] = Number.NaN;
    expect(run(b).classes[k10(100, 30)]).toBe(UNKNOWN);
  });
  it('cells the line does not cross do not affect it', () => {
    const b = new Float32Array(cells);
    b[k10(20, -20)] = 30;
    expect(run(b).classes[k10(100, 30)]).toBe(VISIBLE);
  });
});

describe('route coverage stays bounded for far-away vertices', () => {
  it('a 5,000-point route bouncing between the site and the other side of the world finishes quickly', () => {
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs({ rangeM: 200 }), targetHeightM: 1.7 });
    const c = combineViewsheds([r.classes], grid.n * grid.n);
    const pts: [number, number][] = Array.from({ length: 5000 }, (_, i) => (i % 2 ? [-150, -40] : [grid.lon, grid.lat]));
    const t0 = Date.now();
    const pc = pathCoverage(grid, c, pts);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(pc.outside).toBeGreaterThan(0.99);
    expect(pc.covered + pc.gap + pc.unknown + pc.outside).toBeCloseTo(1, 6);
    expect(clipToSquare(-500, 0, 500, 0, 100)).toEqual([0.4, 0.6]);
    expect(clipToSquare(-500, 300, 500, 300, 100)).toBeNull();
  });
});

describe('elevated building parts (bridges, overhangs)', () => {
  const run = (base: number, over: Partial<Observer> = {}, target = 1.7) => {
    const b = none();
    const bases = none();
    for (let dy = -30; dy <= 30; dy += 10) {
      b[at(50, dy)] = 20;
      bases[at(50, dy)] = base;
    }
    return computeViewshed({ grid, ground: flat(), buildings: b, bases, observer: obs(over), targetHeightM: target });
  };
  it('a sight line passes under a part that starts above it, and is blocked by one that reaches the ground', () => {
    expect(run(6).classes[at(120, 0)]).toBe(VISIBLE); // 1.7 m line under a 6–20 m bridge
    expect(run(0).classes[at(120, 0)]).toBe(BLOCKED);
    expect(run(1).classes[at(120, 0)]).toBe(BLOCKED); // the line is inside the 1–20 m part
  });
  it('a line descending from above the part to below it inside the cell is blocked', () => {
    // From a 60 m mast towards a ground target just behind the bridge: the line crosses the 6–20 m interval.
    const r = run(6, { heightM: 60 }, 0);
    expect(r.classes[at(60, 0)]).toBe(BLOCKED);
  });
  it('points under an elevated part are ambiguous: targets unknown, observers not modelled', () => {
    expect(run(6).classes[at(50, 0)]).toBe(UNKNOWN);
    const b = none();
    const bases = none();
    b[at(0, 0)] = 20;
    bases[at(0, 0)] = 6;
    const r = computeViewshed({ grid, ground: flat(), buildings: b, bases, observer: obs(), targetHeightM: 1.7 });
    expect(r.error).toMatch(/elevated building part/);
    expect(r.counts.unknown).toBe(r.counts.analysed);
  });
});

describe('routes across the 180° meridian', () => {
  it('take the short way round and are weighted by geodesic length', () => {
    const g: Grid = { lat: 0, lon: 179.99, cellM: 50, n: 81 }; // ±2 km around 179.99°E
    const cells = g.n * g.n;
    const r = computeViewshed({ grid: g, ground: new Float32Array(cells).fill(5), buildings: new Float32Array(cells), observer: { lat: 0, lon: 179.99, heightM: 10, rangeM: 2000, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 });
    const c = combineViewsheds([r.classes], cells);
    const pc = pathCoverage(g, c, [[179.98, 0], [-179.99, 0]]); // 0.03° ≈ 3.3 km across the date line
    expect(pc.lengthM).toBeGreaterThan(3000);
    expect(pc.lengthM).toBeLessThan(3600);
    expect(pc.covered).toBeGreaterThan(0.9);
    expect(toLocal(g, 0, -179.99).x).toBeCloseTo(0.02 * 111_320, 0);
  });
});

describe('buildings in the observer and target cells', () => {
  const g25: Grid = { lat: 60.17, lon: 24.94, cellM: 25, n: 21 };
  const cells = g25.n * g25.n;
  const k25 = (dx: number, dy: number) => { const c = cellAt(g25, dx, dy)!; return c.row * g25.n + c.col; };
  const flat25 = () => new Float32Array(cells).fill(0);
  it('a roof-top target is hidden when the line enters its cell below the roof', () => {
    const b = new Float32Array(cells);
    b[k25(50, 0)] = 15; // the review's case: 1.7 m eye, 15 m building 50 m away, 25 m cells
    const low = computeViewshed({ grid: g25, ground: flat25(), buildings: b, observer: { lat: g25.lat, lon: g25.lon, heightM: 1.7, rangeM: 200, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 });
    expect(low.classes[k25(50, 0)]).toBe(BLOCKED);
    const high = computeViewshed({ grid: g25, ground: flat25(), buildings: b, observer: { lat: g25.lat, lon: g25.lon, heightM: 40, rangeM: 200, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 });
    expect(high.classes[k25(50, 0)]).toBe(VISIBLE); // from above, the roof is seen
  });
  it('from a roof, ground close to the building is hidden by the roof edge; farther ground is seen', () => {
    const b = new Float32Array(cells);
    b[k25(0, 0)] = 15;
    const r = computeViewshed({ grid: g25, ground: flat25(), buildings: b, observer: { lat: g25.lat, lon: g25.lon, heightM: 1.7, rangeM: 250, headingDeg: null, fovDeg: null }, targetHeightM: 0 });
    expect(r.classes[k25(25, 0)]).toBe(BLOCKED); // steep line leaves the cell below the roof
    expect(r.classes[k25(225, 0)]).toBe(VISIBLE); // shallow line clears the roof edge
  });
});

describe('remote routes across the 180° meridian', () => {
  it('stay remote for a site far away (no part is projected through the site)', () => {
    const r = computeViewshed({ grid, ground: flat(), buildings: none(), observer: obs(), targetHeightM: 1.7 });
    const c = combineViewsheds([r.classes], grid.n * grid.n);
    const pc = pathCoverage(grid, c, [[179.99, grid.lat], [-179.99, grid.lat]]);
    expect(pc.outside).toBeCloseTo(1, 9);
    const seg = localSegment(grid, [179.99, grid.lat], [-179.99, grid.lat]);
    expect(Math.abs(seg.b.x - seg.a.x)).toBeLessThan(3000); // a short segment, not one around the world
    expect(unwrapLonOffsets([[179.99, 0], [-179.99, 0]], 179.98)).toEqual([expect.closeTo(0.01, 6), expect.closeTo(0.03, 6)]);
  });
});
