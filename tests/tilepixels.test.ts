import { describe, expect, it } from 'vitest';
import { clearWhiteFill, probeHasWhite } from '../src/shared/tilePixels';

function tile(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      d.set([r, g, b, 255], (y * w + x) * 4);
    }
  return d;
}
const alpha = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

describe('clearWhiteFill (USGS coverage-edge tiles)', () => {
  it('clears a flat white no-data half and its light ringing, keeping imagery', () => {
    const w = 64;
    const d = tile(w, w, (x) => (x < 30 ? [255, 255, 255] : x === 30 ? [215, 220, 210] : [60 + (x % 7), 90, 50]));
    const n = clearWhiteFill(d, w, w);
    expect(n).toBe(31 * 64);
    expect(alpha(d, w, 0, 0)).toBe(0);
    expect(alpha(d, w, 30, 10)).toBe(0); // ringing column
    expect(alpha(d, w, 40, 10)).toBe(255);
  });
  it('keeps small or textured bright areas (white roofs, snow)', () => {
    const w = 64;
    const roof = tile(w, w, (x, y) => (x >= 10 && x < 14 && y >= 10 && y < 14 ? [255, 255, 255] : [80, 80, 80]));
    expect(clearWhiteFill(roof, w, w)).toBe(0);
    const snow = tile(w, w, (x, y) => [246 + ((x * 3 + y) % 5), 247, 249]);
    expect(clearWhiteFill(snow, w, w)).toBe(0);
  });
  it('probe finds white only when present', () => {
    expect(probeHasWhite(tile(8, 8, () => [100, 120, 90]))).toBe(false);
    expect(probeHasWhite(tile(8, 8, (x) => (x < 2 ? [255, 255, 255] : [100, 120, 90])))).toBe(true);
  });
});

import { modelLine, parseAdsbdb, parseAirportData, parseCommons } from '../src/shared/vehicleInfo';

describe('vehicle identification parsers', () => {
  it('reads an adsbdb record and formats the model', () => {
    const m = parseAdsbdb({ response: { aircraft: { type: 'A321 231SL', icao_type: 'A321', manufacturer: 'Airbus', registration: 'N946JL', registered_owner: 'JetBlue Airways', registered_owner_country_name: 'United States' } } });
    expect(m?.owner).toBe('JetBlue Airways');
    expect(modelLine(m, null)).toBe('Airbus A321-231SL (ICAO A321)');
    expect(modelLine(parseAdsbdb({ response: { aircraft: { type: 'Citation CJ3+', icao_type: 'C25B', manufacturer: 'Textron Aviation' } } }), null)).toBe('Textron Aviation Citation CJ3+ (ICAO C25B)');
    expect(parseAdsbdb({ response: 'unknown aircraft' })).toBeNull();
  });
  it('takes the best-ranked Commons JPEG that names the registration, never a PNG diagram', () => {
    const page = (index: number, title: string, mime: string, url = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg') => ({ index, title, imageinfo: [{ thumburl: url, mime, descriptionurl: 'https://commons.wikimedia.org/wiki/' + title, extmetadata: { Artist: { value: '<a href="x">Anna Z</a>' }, LicenseShortName: { value: 'CC BY-SA 2.0' }, DateTimeOriginal: { value: '<time>2011-03-05</time> 14:02' } } }] });
    const body = { query: { pages: { a: page(2, 'File:Ship comparison.png', 'image/png'), b: page(3, 'File:JetBlue N946JL.jpg', 'image/jpeg'), c: page(1, 'File:Other plane.jpg', 'image/jpeg') } } };
    const p = parseCommons(body, 'registration', 'N946JL');
    expect(p?.title).toBe('JetBlue N946JL');
    expect(p?.author).toBe('Anna Z');
    expect(p?.license).toBe('CC BY-SA 2.0');
    expect(p?.year).toBe(2011);
    expect(parseCommons(body, 'IMO')?.title).toBe('Other plane');
    expect(parseCommons({ query: { pages: { a: page(1, 'File:x.jpg', 'image/jpeg', 'https://evil.example/x.jpg') } } }, 'IMO')).toBeNull();
  });
  it('maps airport-data thumbnails to the full photo and rejects other hosts', () => {
    const p = parseAirportData({ data: [{ image: 'https://airport-data.com/images/aircraft/thumbnails/001/790/001790936.jpg', link: 'https://airport-data.com/aircraft/photo/001790936', photographer: 'Mark Kalfas' }] });
    expect(p?.url).toBe('https://image.airport-data.com/aircraft/001790936.jpg');
    expect(p?.author).toBe('Mark Kalfas');
    expect(parseAirportData({ data: [{ image: 'https://evil.example/a.jpg', link: 'https://airport-data.com/aircraft/photo/1' }] })).toBeNull();
  });
});
