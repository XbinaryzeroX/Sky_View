// Render the measured J2000 star directions into six lossless faces for Cesium's inertial sky.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';

const source = 'https://heasarc.gsfc.nasa.gov/FTP/heasarc/dbase/tdat_files/heasarc_bsc5p.tdat.gz';
const checksum = '122628cde2d8bedf7e16ddf5f888167ac58c04b5592d6155408ce297f3073931';
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error('Bright Star Catalog HTTP ' + response.status);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum, 'Check the schema of the changed catalogue');
const [header, data] = gunzipSync(bytes).toString().split('<DATA>');
const columns = [...header.matchAll(/^field\[(\w+)\]/gm)].map(m => m[1]);
const indexes = ['ra', 'dec', 'vmag', 'bv_color'].map(name => {
  assert(columns.includes(name), 'Missing field ' + name);
  return columns.indexOf(name);
});
const stars = [];
for (const row of data.split('</DATA>')[0].trim().split('\n')) {
  const fields = row.split('|');
  const [ra, dec, magnitude, bv] = indexes.map(i => fields[i]?.trim() ? Number(fields[i]) : null);
  if (ra === null || dec === null || magnitude === null) continue;
  const radians = Math.PI / 180, cosDec = Math.cos(dec * radians);
  stars.push({ x: cosDec * Math.cos(ra * radians), y: cosDec * Math.sin(ra * radians),
    z: Math.sin(dec * radians), magnitude, bv });
}
assert(stars.length > 9000 && stars.length <= 9110);

const size = 2048, half = size / 2;
const output = new URL('../public/star-sky/', import.meta.url);
await mkdir(output, { recursive: true });
// WebGL cube-face projection, with the image row direction accounting for Cesium's flipY upload.
const faces = {
  px: (x,y,z) => [x,-z,y], mx: (x,y,z) => [-x,z,y],
  py: (x,y,z) => [y,x,-z], my: (x,y,z) => [-y,x,z],
  pz: (x,y,z) => [z,x,y], mz: (x,y,z) => [-z,-x,y],
};
const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
for (const [name, project] of Object.entries(faces)) {
  const pixels = Buffer.alloc(size * size * 3, Buffer.from([3,5,8]));
  for (const star of stars) {
    const [forward,right,down] = project(star.x,star.y,star.z);
    if (forward < 0.55) continue;
    const cx = (1 + right / forward) * half - 0.5, cy = (1 + down / forward) * half - 0.5;
    const brightness = clamp(44 * 10 ** (-0.166 * (star.magnitude - 5)), 16, 247);
    const sigma = 0.64 + 0.22 * Math.max(0, 5.5 - star.magnitude);
    const halo = star.magnitude < 2 ? 0.065 : 0;
    // Bound a small footprint in this face. Evaluate its width in angular space so a
    // star crossing two face edges has the same profile on both sides of the seam.
    const radius = Math.ceil((halo ? 8 : 4) * sigma / (forward * forward));
    const warmth = clamp(((star.bv ?? 0.55) + 0.3) / 1.9, 0, 1);
    const tint = [Math.min(1, 0.78 + 0.52 * warmth), 0.9 + 0.09 * (1 - Math.abs(2 * warmth - 1)), Math.min(1, 1.19 - 0.49 * warmth)];
    for (let y = Math.max(0,Math.floor(cy - radius)); y <= Math.min(size - 1, Math.ceil(cy + radius)); y++) {
      const v = (y + 0.5) / half - 1;
      for (let x = Math.max(0,Math.floor(cx - radius)); x <= Math.min(size - 1,Math.ceil(cx + radius)); x++) {
        const u = (x + 0.5) / half - 1;
        const cosine = (forward + right * u + down * v) / Math.sqrt(1 + u*u + v*v);
        const distance = Math.max(0,1 - cosine) * half * half / (sigma * sigma);
        const glow = brightness * (Math.exp(-distance) + halo * Math.exp(-distance / 7));
        const index = (y * size + x) * 3;
        for (let c=0; c<3; c++) pixels[index+c] = Math.min(255, pixels[index+c] + Math.round(glow * tint[c]));
      }
    }
  }
  await writeFile(new URL(name + '.webp', output), await sharp(pixels, { raw: { width:size, height:size, channels:3 } })
    .webp({ lossless:true, effort:5 }).toBuffer());
}
await writeFile(new URL('ATTRIBUTION.txt', output),
  "Yale Bright Star Catalog, 5th Revised Edition (preliminary), D. Hoffleit and W. H. Warren Jr. (1991).\n" +
  "NASA HEASARC BSC5P archive: https://heasarc.gsfc.nasa.gov/W3Browse/catalog/bsc5p.html\n" +
  source + "\nArchive SHA-256: " + checksum + "\n" +
  stars.length + " entries with J2000 coordinates and visual magnitudes. Atlas Watch plotted the positions, scaled the points by visual magnitude and approximated their colour from B−V when available.\n");
console.log(stars.length + ' catalogue stars, six ' + size + '-pixel faces');
