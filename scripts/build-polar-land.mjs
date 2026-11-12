// Mask the packaged NASA polar imagery to land, leaving the satellite ocean visible.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const land = require('world-atlas/land-10m.json');
const geometry = feature(land, land.objects.land).features[0].geometry;
const paths = geometry.coordinates.map(polygon => {
  const path = polygon.map(ring => ring.map(([lon, lat], i) =>
    `${i ? 'L' : 'M'}${((lon + 180) / 360 * 2048).toFixed(2)} ${((90 - lat) / 180 * 1024).toFixed(2)}`).join('') + 'Z').join('');
  return `<path d="${path}" fill-rule="evenodd"/>`;
}).join('');
for (const [name, top] of [['north',0],['south',1024 * 168 / 180]]) {
  // All points south of 84° S are on the Antarctic plateau. world-atlas omits
  // a narrow band next to its 85.22° S clipping boundary.
  const antarcticPlateau = name === 'south' ? '<rect x="0" y="989.85" width="2048" height="34.15"/>' : '';
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="128" viewBox="0 ${top} 2048 ${1024 * 12 / 180}" preserveAspectRatio="none"><g fill="white">${paths}${antarcticPlateau}</g></svg>`);
  const alpha = await sharp(svg).flatten({background:'black'}).greyscale().raw().toBuffer();
  const input = await readFile(`public/basemap-overview/polar/${name}.jpg`);
  await sharp(input).joinChannel(alpha,{raw:{width:2048,height:128,channels:1}})
    .webp({quality:95,alphaQuality:100}).toFile(`public/basemap-overview/polar/${name}-land.webp`);
}
