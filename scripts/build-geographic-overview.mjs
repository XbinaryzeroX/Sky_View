// Build an offline geographic land overview and polar reference from NASA's
// cloud-free July 2004 Blue Marble composite and Natural Earth shorelines.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import sharp from 'sharp';

const source = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg';
const response = await fetch(source);
if (!response.ok) throw new Error(`NASA imagery HTTP ${response.status}`);
const photo = Buffer.from(await response.arrayBuffer());
const width = 5400, height = 2700;
const require = createRequire(import.meta.url);
const land = require('world-atlas/land-10m.json');
const geometry = feature(land, land.objects.land).features[0].geometry;
function path(polygon) {
  const rings = polygon.map(ring => {
    let previous = ring[0][0];
    return ring.map(([lon, lat], index) => {
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      previous = lon;
      return [lon, lat];
    });
  });
  return [-360, 0, 360].map(shift => '<path fill-rule="evenodd" d="' + rings.map(ring => ring.map(([lon, lat], index) =>
    `${index ? 'L' : 'M'}${((lon + shift + 180) / 360 * width).toFixed(2)} ${((90 - lat) / 180 * height).toFixed(2)}`).join('') + 'Z').join('') + '"/>').join('');
}
const lakePaths = [];
for (const name of ['lakes', 'lakes_europe', 'lakes_north_america', 'lakes_australia']) {
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_' + name + '.geojson';
  const cached = join(tmpdir(), 'atlas-public-optical-observations-v1', createHash('sha256').update(url).digest('hex'));
  let bytes;
  try { bytes = await readFile(cached); } catch {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Lake polygons HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  for (const item of JSON.parse(bytes.toString('utf8')).features) {
    const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
    for (const polygon of polygons) {
      lakePaths.push(path(polygon));
    }
  }
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="white">${geometry.coordinates.map(path).join('')}</g><g fill="black">${lakePaths.join('')}</g></svg>`);
const alpha = await sharp(svg).flatten({background:'black'}).greyscale().raw().toBuffer();
const landImage = await sharp(photo).joinChannel(alpha, {raw:{width,height,channels:1}}).png().toBuffer();
await sharp(landImage).resize(4096,2048).webp({quality:90,alphaQuality:100}).toFile('public/basemap-overview/geographic-land.webp');
// The wider Arctic reference covers the source swaths around the polar cap.
for (const [name, top, rows, outputRows] of [['north', 0, 450, 341], ['south', height - 240, 240, 182]]) {
  const pixels = await sharp(photo).extract({left:0,top,width,height:rows}).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < rows; y++) {
    const edgeDistance = name === 'north' ? rows - 1 - y : y;
    const opacity = Math.round(255 * Math.min(1, edgeDistance / 30));
    for (let x = 0; x < width; x++) {
      const water = name === 'north' && y >= 240 ? 255 - alpha[(top + y) * width + x] : 255;
      pixels[(y * width + x) * 4 + 3] = Math.round(opacity * water / 255);
    }
  }
  const resized = await sharp(pixels,{raw:{width,height:rows,channels:4}}).resize(4096,outputRows).raw().toBuffer();
  if (name === 'north') {
    // The source has a bright strip at the antimeridian in otherwise dark ocean.
    // Join the two sides only where both neighboring areas are dark water.
    const tileWidth = 4096;
    // Near the pole the bright strip extends farther inside the source image.
    // The open-water samples on either side give a continuous date-line join.
    for (let y = 0; y < 12; y++) {
      const left = (y * tileWidth + 8) * 4;
      const right = (y * tileWidth + tileWidth - 96) * 4;
      if (Math.max(...resized.subarray(left, left + 3), ...resized.subarray(right, right + 3)) >= 45) continue;
      for (let x = 0; x < 96; x++) {
        const destination = (y * tileWidth + tileWidth - 96 + x) * 4;
        const blend = x / 95;
        for (let channel = 0; channel < 3; channel++) {
          resized[destination + channel] = Math.round(resized[right + channel] * (1 - blend) + resized[left + channel] * blend);
        }
      }
      for (let x = 0; x < 8; x++) {
        const destination = (y * tileWidth + x) * 4;
        for (let channel = 0; channel < 3; channel++) resized[destination + channel] = resized[left + channel];
      }
    }
    // Every longitude meets at the same pole. Smooth the first four rows
    // toward the observed central-ocean pixel to avoid a radiating wedge.
    for (let y = 0; y < 4; y++) {
      const reference = (y * tileWidth + tileWidth / 2) * 4;
      const blend = y / 4;
      for (let x = 0; x < tileWidth; x++) {
        const destination = (y * tileWidth + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          resized[destination + channel] = Math.round(resized[reference + channel] * (1 - blend) + resized[destination + channel] * blend);
        }
      }
    }
    for (let y = 0; y < outputRows; y++) {
      const left = (y * tileWidth + 8) * 4, right = (y * tileWidth + tileWidth - 9) * 4;
      if (resized[left + 3] !== 255 || resized[right + 3] !== 255 ||
          Math.max(...resized.subarray(left, left + 3), ...resized.subarray(right, right + 3)) >= 45) continue;
      for (let x = 0; x < 6; x++) {
        const a = (y * tileWidth + x) * 4, b = (y * tileWidth + tileWidth - 1 - x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const edge = (resized[left + channel] + resized[right + channel]) / 2;
          const blend = x / 6;
          resized[a + channel] = Math.round(edge * (1 - blend) + resized[left + channel] * blend);
          resized[b + channel] = Math.round(edge * (1 - blend) + resized[right + channel] * blend);
        }
      }
    }
  }
  await sharp(resized,{raw:{width:4096,height:outputRows,channels:4}}).webp({lossless:true}).toFile(`public/basemap-overview/polar/${name}-geographic.webp`);
}
console.log('NASA source SHA-256', createHash('sha256').update(photo).digest('hex'));
