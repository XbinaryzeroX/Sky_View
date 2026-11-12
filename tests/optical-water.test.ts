import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/** The land stencil prevents the old ocean and lake colours covering the optical observations. */
async function landOpacity(lon: number, lat: number, level: number): Promise<number> {
  const n = 2 ** level;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const path = join('public','optical-water','land',String(level),String(Math.floor(y)),Math.floor(x) + '.png');
  const tile = sharp(path);
  const { width, height } = await tile.metadata();
  const pixel = await tile.extract({ left:Math.floor((x%1)*width), top:Math.floor((y%1)*height), width:1, height:1 })
    .ensureAlpha().raw().toBuffer();
  return pixel[3];
}

describe('packaged optical water', () => {
  it('exposes satellite water on the Atlantic, Åland Sea and major inland lakes at every overview level', async () => {
    for (const [lon,lat] of [[-30,0],[19.32,60.04],[-87,43.5],[-87,47.5],[33,-1.3],[108,53.5]]) {
      for (const level of [0,1,2,3]) expect(await landOpacity(lon,lat,level)).toBeLessThan(5);
    }
    for (const level of [0,1,2,3]) expect(await landOpacity(-99,39,level)).toBe(255);
  });
});
