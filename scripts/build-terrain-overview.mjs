// Build the local world relief used while viewing continents. The same Terrarium source supplies city terrain.
// Run manually to refresh the bundled grid. Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const output = fileURLToPath(new URL('../public/terrain/', import.meta.url));
const side = 1024;
const grid = Buffer.alloc(8 + side * side * 2);
grid.write('AWDEMZ02');
for (let y = 0; y < 4; y++) {
  await Promise.all(Array.from({ length: 4 }, async (_, x) => {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/2/${x}/${y}.png`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    const png = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== 256 || info.height !== 256 || info.channels !== 3) throw new Error('Unexpected Terrarium tile');
    for (let row = 0; row < 256; row++) {
      for (let col = 0; col < 256; col++) {
        const i = (row * 256 + col) * 3;
        const height = Math.round(data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768);
        grid.writeInt16LE(height, 8 + ((y * 256 + row) * side + x * 256 + col) * 2);
      }
    }
  }));
}
await mkdir(output, { recursive: true });
await writeFile(join(output, 'overview-z2.bin'), grid);
console.log('overview-z2.bin', grid.length, 'bytes, SHA-256', createHash('sha256').update(grid).digest('hex'));
