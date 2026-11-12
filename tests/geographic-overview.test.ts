import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, it } from 'vitest';

it('aligns the global land image with land and major lakes', async () => {
  const image = await sharp(await readFile('public/basemap-overview/geographic-land.webp'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  function pixel(lat: number, lon: number) {
    const x = Math.floor((lon + 180) / 360 * image.info.width);
    const y = Math.floor((90 - lat) / 180 * image.info.height);
    return [...image.data.subarray((y * image.info.width + x) * 4, (y * image.info.width + x) * 4 + 4)];
  }
  expect(pixel(40, -100)[3]).toBeGreaterThan(240);
  expect(pixel(40, -100)[0]).toBeGreaterThan(30);
  expect(pixel(47.7, -87.5)[3]).toBeLessThan(20);
  expect(pixel(25, -40)[3]).toBeLessThan(20);
  // These Siberian latitudes intersect coastline rings that cross the date line.
  // Their edges must not cut transparent horizontal stripes through land.
  for (const lat of [65.0665, 68.9891, 70.9917]) {
    for (const lon of [85, 95, 105, 115, 125, 135]) {
      expect(pixel(lat, lon)[3]).toBeGreaterThan(240);
    }
  }
});

it('joins dark Arctic water at the date line without erasing nearby ice', async () => {
  const image = await sharp(await readFile('public/basemap-overview/polar/north-geographic.webp'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const y of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 30, 40, 50, 60]) {
    const left = y * image.info.width * 4;
    const right = (y * image.info.width + image.info.width - 1) * 4;
    for (let channel = 0; channel < 4; channel++) {
      expect(Math.abs(image.data[left + channel] - image.data[right + channel])).toBeLessThanOrEqual(1);
    }
  }
  // All longitudes converge at the pole; its image row must be continuous.
  const first = [...image.data.subarray(0, 3)];
  for (const x of [512, 1024, 2048, 3072, 4095]) {
    expect([...image.data.subarray(x * 4, x * 4 + 3)]).toEqual(first);
  }
  expect(image.data[(80 * image.info.width + 1161) * 4]).toBeGreaterThan(200);
});
