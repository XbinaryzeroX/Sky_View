// Under-water cable lines are drawn with rounded corners (requested 2026-11-23: smoother lines). Display only.
import { describe, expect, it } from 'vitest';
import { CABLE_CORNER_KM, smoothCableLine } from '../src/shared/cables';
import { geodesicDistanceKm } from '../src/shared/geo';

const near = (p: [number, number], q: [number, number]) => geodesicDistanceKm(p[1], p[0], q[1], q[0]);

describe('cable display smoothing', () => {
  it('keeps both ends and leaves two-point lines alone', () => {
    expect(smoothCableLine([[0, 0], [10, 0]])).toEqual([[0, 0], [10, 0]]);
    const out = smoothCableLine([[0, 0], [5, 0], [5, 5]]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([5, 5]);
    expect(out.length).toBeGreaterThan(3);
  });
  it('rounds a corner by at most the corner limit and passes close to the mapped vertex', () => {
    const out = smoothCableLine([[0, 0], [5, 0], [5, 5]]);
    const corner: [number, number] = [5, 0];
    const closest = Math.min(...out.map((p) => near(p, corner)));
    expect(closest).toBeLessThanOrEqual(CABLE_CORNER_KM / 2 + 0.01);
    // No drawn point strays further than the corner limit from the mapped vertex it replaces.
    const curve = out.slice(1, -1);
    for (const p of curve) expect(near(p, corner)).toBeLessThanOrEqual(CABLE_CORNER_KM + 0.01);
  });
  it('cuts short segments by at most a quarter so close vertices stay distinct', () => {
    const out = smoothCableLine([[0, 0], [0.04, 0], [0.04, 0.04]]); // ~4.4 km legs
    for (const p of out.slice(1, -1)) expect(near(p, [0.04, 0])).toBeLessThanOrEqual(4.5 / 4 + 0.01);
  });
  it('crosses the date line without a round-the-world jump', () => {
    const out = smoothCableLine([[179, 0], [-179.5, 1], [-178, 1]]);
    for (const [lon] of out) expect(lon >= -180 && lon <= 180).toBe(true);
    for (let i = 1; i < out.length; i++) expect(near(out[i - 1], out[i])).toBeLessThan(200);
  });
});
