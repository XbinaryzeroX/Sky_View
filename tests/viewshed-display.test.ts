import { describe, expect, it } from 'vitest';
import { addObserverToDisplay, cellAt, computeViewshed, displayAccumulator, displayRgba, type Grid, type ViewshedInput } from '../src/shared/viewshed';

const grid: Grid = { lat: 51.5, lon: -0.12, cellM: 4, n: 101 }; // 404 m square
const N = grid.n * grid.n;
const k = (e: number, n: number) => {
  const c = cellAt(grid, e, n)!;
  return c.row * grid.n + c.col;
};
function scene(boxes: [number, number, number, number, number][]): ViewshedInput {
  const ground = new Float32Array(N).fill(10);
  const buildings = new Float32Array(N);
  for (const [e0, n0, e1, n1, h] of boxes) for (let e = e0; e <= e1; e += grid.cellM) for (let n = n0; n <= n1; n += grid.cellM) buildings[k(e, n)] = h;
  return { grid, ground, buildings, bases: new Float32Array(N), observer: { lat: grid.lat, lon: grid.lon, heightM: 1.7, rangeM: 190, headingDeg: null, fovDeg: null }, targetHeightM: 1.7 };
}
function picture(input: ViewshedInput) {
  const cells = computeViewshed(input).classes;
  const acc = displayAccumulator(grid, 808); // 8 pixels per cell, 0.5 m each
  addObserverToDisplay(acc, input, cells);
  const S = acc.size;
  const span = grid.n * grid.cellM;
  /** 'v' clear, 'b' blocked, 'u' unknown, '.' not analysed, at local metres (east, north). */
  const at = (e: number, n: number) => {
    const px = Math.floor(((e + span / 2) / span) * S);
    const py = Math.floor(((span / 2 - n) / span) * S);
    const i = py * S + px;
    return acc.state[i] === 0 ? '.' : acc.seen[i] > 0 ? 'v' : acc.state[i] === 2 ? 'u' : 'b';
  };
  return { acc, at, cells };
}

describe('fine coverage picture', () => {
  it('draws a shadow edge along the straight line from the observer past the building corner', () => {
    // A tall block east of the observer: its north-west corner is near (40, 12). The shadow's north edge follows the
    // line through that corner, so at 80 m east it is near 24 m north and at 160 m east near 48 m north.
    const p = picture(scene([[40, -40, 52, 12, 60]]));
    const edgeAt = (east: number) => {
      for (let n = 0; n < 120; n += 0.25) if (p.at(east, n) === 'v') return n;
      return Number.NaN;
    };
    const e80 = edgeAt(80);
    const e160 = edgeAt(160);
    // The edge lies on one straight line through the observer (slope within a quarter cell over 80 m), not on steps.
    expect(e160 / 160).toBeCloseTo(e80 / 80, 1);
    expect(Math.abs(e160 - 2 * e80)).toBeLessThan(2);
    expect(e80).toBeGreaterThan(20);
    expect(e80).toBeLessThan(30);
  });

  it('agrees with the cell figures at cell centres', () => {
    const input = scene([[40, -40, 52, 12, 60], [-60, 30, -40, 50, 25], [-20, -80, 20, -70, 8]]);
    const p = picture(input);
    let same = 0;
    let total = 0;
    for (let e = -180; e <= 180; e += grid.cellM)
      for (let n = -180; n <= 180; n += grid.cellM) {
        const c = p.cells[k(e, n)];
        if (!c || e * e + n * n > 185 * 185) continue;
        total++;
        const want = c === 1 ? 'v' : c === 2 ? 'b' : 'u';
        if (p.at(e + 0.1, n + 0.1) === want) same++;
      }
    expect(total).toBeGreaterThan(5000);
    expect(same / total).toBeGreaterThan(0.97);
  });

  it('draws the range as a circle and keeps unknown terrain unknown', () => {
    const input = scene([]);
    for (let e = 60; e <= 80; e += grid.cellM) for (let n = -200; n <= 200; n += grid.cellM) input.ground[k(e, n)] = Number.NaN;
    const p = picture(input);
    expect(p.at(189, 0.3)).toBe('u'); // past the missing strip
    expect(p.at(0, 189.5)).toBe('v');
    expect(p.at(0, 191)).toBe('.');
    expect(p.at(135, 135)).toBe('.'); // 190.9 m away diagonally: just outside the 190 m range
    expect(p.at(133, 133)).not.toBe('.');
    expect(p.at(-30, 0)).toBe('v');
  });

  it('respects a camera field of view exactly', () => {
    const input = scene([]);
    input.observer = { ...input.observer, headingDeg: 90, fovDeg: 60 };
    const p = picture(input);
    expect(p.at(100, 0)).toBe('v');
    expect(p.at(100, 55)).toBe('v'); // 28.8° off the heading: inside
    expect(p.at(100, 60)).toBe('.'); // 31° off: outside
    expect(p.at(-50, 0)).toBe('.');
  });

  it('falls back to the cell result when nothing can be traced from the point', () => {
    const input = scene([]);
    input.ground[k(0, 0)] = Number.NaN;
    const p = picture(input);
    expect(p.at(50, 50)).toBe('u');
    const rgba = displayRgba(p.acc);
    expect(rgba.length).toBe(p.acc.size * p.acc.size * 4);
  });
});

describe('fine coverage picture with building outlines', () => {
  it('casts a shadow edge from the real corner of a rotated building, not from its 4 m cells', async () => {
    const { fineBuildings, rasterizeFootprints } = await import('../src/shared/siteRaster');
    const M_LAT = 111_320;
    const M_LON = 111_320 * Math.cos((grid.lat * Math.PI) / 180);
    const ll = (e: number, n: number): [number, number] => [grid.lon + e / M_LON, grid.lat + n / M_LAT];
    // A tall diamond east of the observer; its northern tip is at (50, 13): the shadow's north edge is the line
    // from the observer through that tip, slope 13/50.
    const footprint = { rings: [[ll(40, 0), ll(50, 13), ll(60, 0), ll(50, -13), ll(40, 0)]], heightM: 80 };
    const input = scene([]);
    rasterizeFootprints(grid, [footprint], input.buildings, input.bases);
    const fine = fineBuildings(grid, input.buildings, [footprint]);
    const cells = computeViewshed(input).classes;
    const acc = displayAccumulator(grid, 808);
    addObserverToDisplay(acc, input, cells, fine);
    const S = acc.size;
    const span = grid.n * grid.cellM;
    const clear = (e: number, n: number) => {
      const i = Math.floor(((span / 2 - n) / span) * S) * S + Math.floor(((e + span / 2) / span) * S);
      return acc.seen[i] > 0;
    };
    const edgeAt = (east: number) => {
      for (let n = 0; n < 120; n += 0.1) if (clear(east, n)) return n;
      return Number.NaN;
    };
    // A straight line through the observer: the same slope at every distance (to within one 0.5 m pixel at 180 m).
    const slopes = [100, 150, 180].map((east) => edgeAt(east) / east);
    for (const sl of slopes) expect(Math.abs(sl - slopes[0])).toBeLessThan(0.005);
    // Through the corner to within the 1 m raster: the tip is reached within a metre (13 m north at 50 m east).
    expect(Math.abs(slopes[2] * 50 - 13)).toBeLessThan(1);
  });
});

describe('terrain between cell centres', () => {
  it('does not block lines along an even slope with the steps of flat-topped cells', () => {
    // A steady 45° slope rising to the north. Every line from a standing observer to a standing target uphill runs
    // 1.7 m above the slope; flat-topped 4 m cells would put 2 m steps in its way.
    const input = scene([]);
    for (let row = 0; row < grid.n; row++)
      for (let col = 0; col < grid.n; col++) input.ground[row * grid.n + col] = 100 + ((grid.n - 1) / 2 - row) * grid.cellM;
    const r = computeViewshed(input);
    for (const n of [20, 60, 120, 180]) expect(r.classes[k(0, n)]).toBe(1);
    for (const e of [-40, 40]) expect(r.classes[k(e, 120)]).toBe(1);
  });
});

describe('shares from the traced picture', () => {
  it('counts each pixel once per observer and combines observers like the cell model', async () => {
    const { displayCombined } = await import('../src/shared/viewshed');
    const input = scene([[40, -40, 52, 12, 60]]);
    const acc = displayAccumulator(grid, 404);
    expect(acc.size % 2).toBe(1); // a centred grid of its own
    expect(acc.pictureGrid.n).toBe(acc.size);
    expect(acc.pictureGrid.cellM * acc.size).toBeCloseTo(grid.cellM * grid.n, 6);
    const a = addObserverToDisplay(acc, input, computeViewshed(input).classes);
    const second = { ...input, observer: { ...input.observer, lat: input.observer.lat + 60 / 111_320 } };
    const b = addObserverToDisplay(acc, second, computeViewshed(second).classes);
    expect(a.visible + a.blocked + a.unknown).toBe(a.analysed);
    const c = displayCombined(acc);
    expect(c.counts.covered + c.counts.overlap + c.counts.gap + c.counts.unknown).toBe(c.counts.analysed);
    expect(c.counts.overlap).toBeGreaterThan(0);
    expect(c.counts.analysed).toBeLessThanOrEqual(a.analysed + b.analysed);
    expect(c.counts.analysed).toBeGreaterThanOrEqual(Math.max(a.analysed, b.analysed));
  });
});

describe('site view picture', () => {
  it('lights only what is seen, draws the limit of view in magenta, and hatches unknown', async () => {
    const { displayRgbaGlow } = await import('../src/shared/viewshed');
    const input = scene([[40, -40, 52, 12, 60]]);
    for (let e = -120; e <= -100; e += grid.cellM) for (let n = -20; n <= 20; n += grid.cellM) input.ground[k(e, n)] = Number.NaN;
    const acc = displayAccumulator(grid, 404);
    addObserverToDisplay(acc, input, computeViewshed(input).classes);
    const rgba = displayRgbaGlow(acc, [{ x: 0, y: 0, rangeM: 190 }]);
    const S = acc.size;
    const span = grid.n * grid.cellM;
    const px = (e: number, n: number) => {
      const i = Math.floor(((span / 2 - n) / span) * S) * S + Math.floor(((e + span / 2) / span) * S);
      return [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3], acc.seen[i], acc.state[i]];
    };
    const near = px(5, -20);
    expect(near[3]).toBeGreaterThan(100); // lit
    expect(near[1]).toBeGreaterThan(200); // near white
    const far = px(-20, -170);
    expect(far[1]).toBeLessThan(near[1]); // fading to pink with distance
    expect(px(120, 0)[3]).toBe(0); // in the building's shadow: unlit
    expect(px(0, 195)[3]).toBe(0); // beyond the range
    // Somewhere along the shadow's north edge a magenta edge pixel exists.
    let edge = 0;
    for (let n = 15; n < 45; n += 0.25) {
      const p = px(120, n);
      if (p[0] === 255 && p[1] === 43 && p[2] === 214) edge++;
    }
    expect(edge).toBeGreaterThan(0);
    // Unknown (behind missing terrain) is hatched grey, never lit.
    let hatched = 0;
    let lit = 0;
    for (let e = -160; e < -140; e += 0.5) {
      const p = px(e, 2);
      if (p[0] === 160 && p[3] === 90) hatched++;
      if (p[4] > 0) lit++;
    }
    expect(hatched).toBeGreaterThan(0);
    expect(lit).toBe(0);
  });

  it('spaces range rings at round distances, about four across the radius', async () => {
    const { ringStepM } = await import('../src/renderer/map/planningOverlay');
    expect(ringStepM(400)).toBe(100);
    expect(ringStepM(250)).toBe(100);
    expect(ringStepM(150)).toBe(50);
    expect(ringStepM(5000)).toBe(2000);
  });
});
