#!/usr/bin/env node
// Builds public/geoid/egm96-30.bin, the sea-level (geoid) grid the app uses to place ships and parked
// aircraft on Google Photorealistic 3D tiles (which are at true WGS84 ellipsoid heights).
//
//   node scripts/make-geoid.mjs [path/to/us_nga_egm96_15.tif]
//
// Source: EGM96 geoid undulation, 15' grid, "Derived from work by NGA. Public Domain", as published by the
// PROJ project (https://cdn.proj.org/us_nga_egm96_15.tif). Default location of the downloaded file:
// %USERPROFILE%\.atlas-watch\geoid\us_nga_egm96_15.tif (the download is not kept in the repository).
//
// Output format "AWGEOID1" (little-endian): 48-byte header
//   0 magic 'AWGEOID1' | 8 u32 width | 12 u32 height | 16 f64 lon0 | 24 f64 lat0 | 32 f64 step (degrees)
//   40 f32 scale (metres per unit) | 44 u32 reserved (0)
// then width × height int16 values, row-major: rows from lat0 southwards, columns from lon0 eastwards;
// columns wrap around (width × step = 360°). Value × scale = geoid height N in metres
// (ellipsoid height = height above mean sea level + N). Read by src/shared/geoid.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || path.join(os.homedir(), '.atlas-watch', 'geoid', 'us_nga_egm96_15.tif');
const out = path.join(here, '..', 'public', 'geoid', 'egm96-30.bin');
const FACTOR = 2; // 15' → 30'
const SCALE = 0.01; // centimetres

// ------------------------------------------------------------------ minimal GeoTIFF reader (one float32 band)

function readTiff(buf) {
  const order = buf.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF file');
  const le = order === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('not a classic TIFF (BigTIFF is not supported)');
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 11: 4, 12: 8, 16: 8 };
  const ifd = u32(4);
  const count = u16(ifd);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), n = u32(e + 4);
    const bytes = (SIZE[type] ?? 1) * n;
    const off = bytes <= 4 ? e + 8 : u32(e + 8);
    if (off + bytes > buf.length) throw new Error(`tag ${tag} points outside the file`);
    const read = (k) => (type === 3 ? u16(off + 2 * k) : type === 4 ? u32(off + 4 * k) : type === 12 ? f64(off + 8 * k) : buf[off + k]);
    tags.set(tag, type === 2 ? buf.toString('latin1', off, off + n) : Array.from({ length: n }, (_, k) => read(k)));
  }
  const one = (t, d) => (tags.has(t) ? tags.get(t)[0] : d);
  const width = one(256), height = one(257);
  if (one(258) !== 32 || one(339, 1) !== 3) throw new Error('expected one 32-bit float band');
  if (one(277, 1) !== 1) throw new Error('expected one sample per pixel');
  const compression = one(259, 1);
  const predictor = one(317, 1);
  if (![1, 8, 32946].includes(compression)) throw new Error(`unsupported compression ${compression}`);
  if (![1, 3].includes(predictor)) throw new Error(`unsupported predictor ${predictor}`);
  const tiled = tags.has(322);
  const tw = tiled ? one(322) : width;
  const th = tiled ? one(323) : one(278, height);
  const offsets = tiled ? tags.get(324) : tags.get(273);
  const counts = tiled ? tags.get(325) : tags.get(279);
  const across = Math.ceil(width / tw);
  const data = new Float32Array(width * height);
  offsets.forEach((offset, k) => {
    let raw = buf.subarray(offset, offset + counts[k]);
    if (compression !== 1) raw = zlib.inflateSync(raw);
    const rowBytes = tw * 4;
    if (raw.length < rowBytes * th) throw new Error(`tile ${k} is truncated`);
    const tx = (k % across) * tw;
    const ty = Math.floor(k / across) * th;
    for (let r = 0; r < th && ty + r < height; r++) {
      const row = Buffer.from(raw.subarray(r * rowBytes, (r + 1) * rowBytes));
      let view;
      if (predictor === 3) {
        // Floating-point predictor: undo byte differencing, then regroup byte planes (most significant first).
        for (let i = 1; i < row.length; i++) row[i] = (row[i] + row[i - 1]) & 255;
        view = Buffer.alloc(rowBytes);
        for (let j = 0; j < tw; j++) for (let b = 0; b < 4; b++) view[j * 4 + b] = row[b * tw + j];
      } else view = row;
      for (let c = 0; c < tw && tx + c < width; c++)
        data[(ty + r) * width + tx + c] = predictor === 3 ? view.readFloatBE(c * 4) : le ? view.readFloatLE(c * 4) : view.readFloatBE(c * 4);
    }
  });
  const scale = tags.get(33550);
  const tie = tags.get(33922);
  const keys = tags.get(34735) ?? [];
  let rasterType = 1; // area unless the GeoKey says point
  for (let i = 4; i + 3 < keys.length; i += 4) if (keys[i] === 1025) rasterType = keys[i + 3];
  if (!scale || !tie) throw new Error('missing georeferencing tags');
  const half = rasterType === 2 ? 0 : 0.5;
  return { width, height, data, lon0: tie[3] + half * scale[0], lat0: tie[4] - half * scale[1], stepX: scale[0], stepY: scale[1], copyright: tags.get(33432) ?? '' };
}

/** Bilinear value at (lat, lon) on a global grid whose columns wrap. */
function sample(g, lat, lon) {
  const x = ((((lon - g.lon0) / g.stepX) % g.width) + g.width) % g.width;
  const y = Math.min(g.height - 1, Math.max(0, (g.lat0 - lat) / g.stepY));
  const i0 = Math.floor(x), j0 = Math.floor(y);
  const i1 = (i0 + 1) % g.width, j1 = Math.min(g.height - 1, j0 + 1);
  const fx = x - i0, fy = y - j0;
  const v = (i, j) => g.data[j * g.width + i];
  return (v(i0, j0) * (1 - fx) + v(i1, j0) * fx) * (1 - fy) + (v(i0, j1) * (1 - fx) + v(i1, j1) * fx) * fy;
}

// NGA's published EGM96 test points (lat, lon, N in metres).
const NGA_TESTS = [
  [38.628155, 269.779155, -31.628],
  [-14.621217, 305.021114, -2.969],
  [46.874319, 102.448729, -43.575],
  [-23.617446, 133.874712, 15.871],
  [38.625473, 359.9995, 50.066],
  [-0.466744, 0.0023, 17.329],
];

const buf = fs.readFileSync(src);
const g = readTiff(buf);
console.log(`source: ${g.width}×${g.height}, origin ${g.lon0},${g.lat0}, step ${g.stepX}°, ${g.copyright.replace(/\0/g, '')}`);
if (Math.abs(g.width * g.stepX - 360) > 1e-9 || g.lat0 !== 90 || Math.abs(g.lat0 - (g.height - 1) * g.stepY + 90) > 1e-9) throw new Error('expected a global grid from 90° to −90° with wrapping columns');
let min = Infinity, max = -Infinity;
for (const v of g.data) {
  if (!Number.isFinite(v)) throw new Error('grid contains non-finite values');
  min = Math.min(min, v);
  max = Math.max(max, v);
}
console.log(`range ${min.toFixed(2)} … ${max.toFixed(2)} m`);

const w = g.width / FACTOR;
const h = (g.height - 1) / FACTOR + 1;
const q = new Int16Array(w * h);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) q[j * w + i] = Math.round(g.data[j * FACTOR * g.width + i * FACTOR] / SCALE);
const coarse = { width: w, height: h, data: Float32Array.from(q, (v) => v * SCALE), lon0: g.lon0, lat0: g.lat0, stepX: g.stepX * FACTOR, stepY: g.stepY * FACTOR };

let worst = 0;
for (const [lat, lon, want] of NGA_TESTS) {
  const fine = sample(g, lat, lon);
  const c = sample(coarse, lat, lon);
  worst = Math.max(worst, Math.abs(c - want));
  console.log(`test ${lat.toFixed(3)},${lon.toFixed(3)}: NGA ${want.toFixed(3)}  15' ${fine.toFixed(3)}  30' ${c.toFixed(3)}`);
}
// Interpolation error of the 30' grid at the source nodes it dropped.
let sq = 0, n = 0, maxErr = 0, maxAt = null;
for (let j = 0; j < g.height; j++)
  for (let i = 0; i < g.width; i++) {
    if (j % FACTOR === 0 && i % FACTOR === 0) continue;
    const lat = g.lat0 - j * g.stepY, lon = g.lon0 + i * g.stepX;
    const e = Math.abs(sample(coarse, lat, lon) - g.data[j * g.width + i]);
    sq += e * e;
    n++;
    if (e > maxErr) [maxErr, maxAt] = [e, [lat, lon]];
  }
console.log(`30' grid vs 15' source at dropped nodes: RMS ${Math.sqrt(sq / n).toFixed(3)} m, max ${maxErr.toFixed(2)} m at ${maxAt}`);
if (worst > 1) throw new Error(`30' grid misses an NGA test point by ${worst.toFixed(2)} m`);

const header = Buffer.alloc(48);
header.write('AWGEOID1', 0, 'latin1');
header.writeUInt32LE(w, 8);
header.writeUInt32LE(h, 12);
header.writeDoubleLE(coarse.lon0, 16);
header.writeDoubleLE(coarse.lat0, 24);
header.writeDoubleLE(coarse.stepX, 32);
header.writeFloatLE(SCALE, 40);
const body = Buffer.alloc(q.length * 2);
q.forEach((v, k) => body.writeInt16LE(v, k * 2));
fs.mkdirSync(path.dirname(out), { recursive: true });
const file = Buffer.concat([header, body]);
fs.writeFileSync(out, file);
console.log(`wrote ${out} (${w}×${h}, ${(file.length / 1024).toFixed(0)} KB, sha256 ${crypto.createHash('sha256').update(file).digest('hex').slice(0, 16)}…)`);
