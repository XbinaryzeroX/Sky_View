// Regenerate the packaged NASA overview with Node 24 and the project's sharp dependency.
// A 2048-pixel WMS image at XYZ zoom 2 spans exactly eight native zoom-5 tiles per side.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { repairRightEdge } from '../src/shared/tilePixels.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'public', 'basemap-overview');
const layer = 'BlueMarble_ShadedRelief_Bathymetry';
const nasa = 'https://gibs.earthdata.nasa.gov';
const metadata = nasa + '/layer-metadata/v1.0/' + layer + '.json';
const half = Math.PI * 6378137;
const tileSize = 1024;
const pageSize = 2048;
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const jpg = image => image.removeAlpha().jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
const assets = new Map();
const sources = [];
const pixelsPerSide = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
const smaller = [new Map(), new Map()];

function mapUrl(epsg, bbox, width, height) {
  const params = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer,
    STYLES: '', SRS: 'EPSG:' + epsg, BBOX: bbox.join(','), WIDTH: String(width), HEIGHT: String(height), FORMAT: 'image/png' });
  return nasa + '/wms/epsg' + epsg + '/best/wms.cgi?' + params;
}

async function imageBytes(url, format, width, height) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
  assert.equal(response.status, 200, url);
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/' + format, url);
  const data = Buffer.from(await response.arrayBuffer());
  assert(data.length > 0 && data.length <= 32 * 1024 * 1024);
  const info = await sharp(data).metadata();
  assert(info.width === width && info.height === height && info.format === format, url);
  return data;
}

async function mercatorPage(x, y) {
  const width = 2 * half / 4;
  const bounds = [-half + x * width, half - (y + 1) * width, -half + (x + 1) * width, half - y * width];
  const url = mapUrl(3857, bounds, pageSize, pageSize);
  const data = await imageBytes(url, 'png', pageSize, pageSize);
  const pixels = await sharp(data).ensureAlpha().raw().toBuffer();
  const raw = { width: pageSize, height: pageSize, channels: 4 };
  const correctedColumns = x === 3 ? repairRightEdge(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), pageSize, pageSize) : 0;
  sources.push({ url, sha256: digest(data), correctedColumns });
  const page = () => sharp(pixels, { raw });
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const crop = page().extract({ left: col * tileSize, top: row * tileSize, width: tileSize, height: tileSize });
    assets.set('3/' + (2 * y + row) + '/' + (2 * x + col) + '.jpg', await jpg(crop));
  }
  assets.set('2/' + y + '/' + x + '.jpg', await jpg(page().resize(tileSize, tileSize)));
  // Build both smaller levels from the same original pixels. Each output is JPEG-encoded only once.
  for (const z of [0, 1]) smaller[z].set(y * 4 + x, await page().resize(tileSize * 2 ** z / 4).removeAlpha().png().toBuffer());
}

// Keep network and decode concurrency bounded on both the source server and the build machine.
for (let i = 0; i < pixelsPerSide.length; i += 2) await Promise.all(pixelsPerSide.slice(i, i + 2).map(({x, y}) => mercatorPage(x, y)));
for (const z of [0, 1]) {
  const perSide = 2 ** z, block = 4 / perSide, subSize = tileSize / block;
  for (let y = 0; y < perSide; y++) for (let x = 0; x < perSide; x++) {
    const overlays = [];
    for (let row = 0; row < block; row++) for (let col = 0; col < block; col++) {
      overlays.push({ input: smaller[z].get((y * block + row) * 4 + x * block + col), left: col * subSize, top: row * subSize });
    }
    const canvas = sharp({ create: { width: tileSize, height: tileSize, channels: 3, background: 'black' } });
    assets.set(z + '/' + y + '/' + x + '.jpg', await jpg(canvas.composite(overlays)));
  }
}

// Geographic rows run north to south and columns west to east, including both geographic poles.
for (const [zone, south, north] of [['north', 78, 90], ['south', -90, -78]]) {
  const url = mapUrl(4326, [-180, south, 180, north], 2048, 128);
  const data = await imageBytes(url, 'png', 2048, 128);
  sources.push({ url, sha256: digest(data) });
  assets.set('polar/' + zone + '.jpg', await jpg(sharp(data)));
}

// Independent XYZ samples verify location, orientation and actual zoom-5 detail in the WMS-derived pixels.
const checks = [];
for (const [x, y] of [[6, 12], [9, 18], [28, 12]]) {
  const url = nasa + '/wmts/epsg3857/best/' + layer + '/default/GoogleMapsCompatible_Level8/5/' + y + '/' + x + '.jpeg';
  const reference = await imageBytes(url, 'jpeg', 256, 256);
  const input = assets.get('3/' + (y >> 2) + '/' + (x >> 2) + '.jpg');
  const crop = { left: (x % 4) * 256, top: (y % 4) * 256, width: 256, height: 256 };
  const gold = await sharp(reference).greyscale().raw().toBuffer();
  const comparable = await sharp(input).extract(crop).greyscale().raw().toBuffer();
  let totalError = 0, flippedError = 0, referenceEdges = 0, outputEdges = 0;
  for (let row = 0; row < 256; row++) for (let col = 1; col < 256; col++) {
    const i = row * 256 + col;
    totalError += Math.abs(comparable[i] - gold[i]);
    flippedError += Math.abs(comparable[i] - gold[(255 - row) * 256 + col]);
    outputEdges += Math.abs(comparable[i] - comparable[i - 1]);
    referenceEdges += Math.abs(gold[i] - gold[i - 1]);
  }
  const meanAbsoluteError = totalError / (256 * 255), nativeEdgeRatio = outputEdges / referenceEdges;
  assert(meanAbsoluteError < 18 && totalError < 0.72 * flippedError && nativeEdgeRatio > 0.72 && nativeEdgeRatio < 1.35,
    JSON.stringify({ url, meanAbsoluteError, flippedError: flippedError / (256 * 255), nativeEdgeRatio }));
  checks.push({ url, sha256: digest(reference), meanAbsoluteError, nativeEdgeRatio });
}

assert.equal(assets.size, 87);
const files = Object.fromEntries([...assets.keys()].sort().map(file => [file, digest(assets.get(file))]));
const manifest = { product: layer, title: 'Blue Marble (August 2004, Shaded Relief and Bathymetry)', metadata,
  credits: 'MODIS / NASA Earth Observatory, served by NASA GIBS', sources: sources.sort((a, b) => a.url.localeCompare(b.url)),
  coverage: { mercator: { epsg: 3857, tileSize, zooms: [0, 1, 2, 3], xyzOrder: 'zoom/row/column', nativeWorldWidth: 8192 },
    polar: { epsg: 4326, size: [2048, 128], north: [-180, 78, 180, 90], south: [-180, -90, 180, -78] } },
  generator: 'node scripts/build-basemap-overview.mjs', checks, files };
for (const [file, buffer] of assets) {
  const target = join(out, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
}
await writeFile(join(root, 'scripts', 'basemap-overview-source.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ files: assets.size, bytes: [...assets.values()].reduce((sum, b) => sum + b.length, 0), checks,
  antimeridianCorrections: sources.filter(s => s.correctedColumns > 0).length }, null, 2));
