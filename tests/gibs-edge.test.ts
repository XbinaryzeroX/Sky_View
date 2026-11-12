import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { repairRightEdge } from '../src/shared/tilePixels';

/** Raw public NASA fixture: BlueMarble_ShadedRelief_Bathymetry / GoogleMapsCompatible_Level8 / 5/17/31.jpeg,
 * retrieved 2026-11-11. The last column has an abrupt dark drop in 254/256 rows. No detail is invented. */
describe('NASA antimeridian source edge', () => {
  it('repairs the real half-dark final column without altering any other source pixel', async () => {
    const { data, info } = await sharp(readFileSync(join(__dirname, 'fixtures/layers/gibs-east-edge-z5.jpeg'))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const before = new Uint8ClampedArray(data);
    const fixed = new Uint8ClampedArray(data);
    expect(repairRightEdge(fixed, info.width, info.height)).toBe(1);
    for (let y = 0; y < info.height; y++) {
      const start = y * info.width * 4;
      const last = start + (info.width - 1) * 4;
      expect(fixed.subarray(start, last)).toEqual(before.subarray(start, last));
      expect(fixed.subarray(last, last + 4)).toEqual(before.subarray(last - 4, last));
    }
  });

  it('keeps gradual ocean shading and localized coastlines at the edge', () => {
    const width = 64;
    const make = (value: (x: number, y: number) => number) => {
      const pixels = new Uint8ClampedArray(width * width * 4);
      for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) pixels.set([value(x, y), value(x, y), value(x, y), 255], (y * width + x) * 4);
      return pixels;
    };
    const gradient = make((x) => 150 - x);
    const coast = make((x, y) => x === width - 1 && y < 20 ? 70 : 120);
    expect(repairRightEdge(gradient, width, width)).toBe(0);
    expect(repairRightEdge(coast, width, width)).toBe(0);
  });
});
