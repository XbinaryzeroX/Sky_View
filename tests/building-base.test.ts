import { describe, expect, it } from 'vitest';

describe('building ground heights', () => {
  it('samples the centre and four points inside the footprint bounds', async () => {
    const { footprintSamplePoints } = await import('../src/renderer/map/buildings');
    const pts = footprintSamplePoints([[10, 50], [10.001, 50], [10.001, 50.001], [10, 50.001], [10, 50]]);
    expect(pts).toHaveLength(5);
    expect(pts[0][0]).toBeCloseTo(10.0005, 9);
    expect(pts[0][1]).toBeCloseTo(50.0005, 9);
    for (const [lo, la] of pts.slice(1)) {
      // 70% of the way from the centre to the corners: inside the footprint's bounds.
      expect(lo).toBeGreaterThan(10);
      expect(lo).toBeLessThan(10.001);
      expect(la).toBeGreaterThan(50);
      expect(la).toBeLessThan(50.001);
      expect(Math.abs(lo - 10.0005)).toBeCloseTo(0.00035, 9);
    }
  });

  it('stands a building on the lowest ground under it, so its downhill wall reaches the ground', async () => {
    const { buildingBase } = await import('../src/renderer/map/buildings');
    expect(buildingBase([42, 38.5, 45, 40, 39], 0)).toEqual({ base: 38.5, fallback: false });
  });

  it('ignores failed samples and falls back to the tile height only when every sample failed', async () => {
    const { buildingBase } = await import('../src/renderer/map/buildings');
    expect(buildingBase([Number.NaN, 12, undefined as unknown as number], 99)).toEqual({ base: 12, fallback: false });
    expect(buildingBase([Number.NaN, Number.NaN], 99)).toEqual({ base: 99, fallback: true });
    expect(buildingBase([], 7)).toEqual({ base: 7, fallback: true });
  });
});
