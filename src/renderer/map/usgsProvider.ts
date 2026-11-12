import { profAdd } from '../lib/prof';
// USGS National Map tiles with correct no-data handling.
//
// Diagnosis (2026-11-09): outside its U.S. orthoimagery coverage the USGS
// service does not return 404 or transparent tiles. It returns either
//   (a) PNG tiles that are opaque WHITE with a few transparent pixels, or
//   (b) uniform white JPEG tiles (~2.4 KB),
// which produced the white sheets and dark wedges over the Gulf of California.
// Real imagery tiles are JPEGs of ~20–40 KB. This provider makes no-data
// pixels transparent so the global base shows through, leaving imagery as is.
//
// Orientation: Cesium decodes its own imagery bitmaps with imageOrientation
// 'flipY' (Chromium ignores UNPACK_FLIP_Y for ImageBitmap), so every bitmap
// returned here is created flipped the same way.

import { UrlTemplateImageryProvider, type Request } from 'cesium';
import { oceanMask } from './vectorTiles';

export type UsgsService = 'USGSImageryOnly' | 'USGSImageryTopo' | 'USGSTopo';

import { BLANK_JPEG_MAX_BYTES, BLANK_WHITE_FRACTION, clearNoDataPixels, clearWhiteFill, probeHasWhite, whiteFraction } from '../../shared/tilePixels';

export const usgsStats = { noDataTiles: 0, blankTiles: 0, imageryTiles: 0, mixedWhiteTiles: 0 };

// Coverage-edge tiles (2026-11-09, Kingston ON): JPEGs of 5-11 KB that are part imagery, part flat white
// no-data. They pass the size test, so each imagery JPEG is probed on a 32×32 copy (≈4 KB readback) and only
// tiles with white in the probe get the full-resolution white-fill clearing.
const PROBE = 32;

// Use neighbouring masks so the transition is continuous across imagery tile edges.
// A failed water lookup leaves the original USGS photograph untouched.
const waterMasks = new Map<string, Promise<OffscreenCanvas | null>>();
function waterMask(level: number, x: number, y: number) {
  const width = 2 ** level;
  if (y < 0 || y >= width) return Promise.resolve(null);
  x = ((x % width) + width) % width;
  const key = `${level}/${x}/${y}`;
  let mask = waterMasks.get(key);
  if (!mask) {
    mask = oceanMask(level, x, y, true).catch(() => null);
    waterMasks.set(key, mask);
    void mask.then(value => { if (!value && waterMasks.get(key) === mask) waterMasks.delete(key); });
    if (waterMasks.size > 256) waterMasks.delete(waterMasks.keys().next().value!);
  }
  return mask;
}

async function blendShore(source: ImageBitmap | OffscreenCanvas, level: number, x: number, y: number) {
  const size = 256;
  const masks = await Promise.all(Array.from({length: 9}, (_, i) => waterMask(level, x + i % 3 - 1, y + Math.floor(i / 3) - 1)));
  if (masks.some(mask => !mask)) return createImageBitmap(source, { imageOrientation: 'flipY' });
  const land = new OffscreenCanvas(size * 3, size * 3);
  const lg = land.getContext('2d')!;
  lg.fillStyle = '#fff';
  lg.fillRect(0, 0, land.width, land.height);
  lg.globalCompositeOperation = 'destination-out';
  masks.forEach((mask, i) => lg.drawImage(mask!, (i % 3) * size, Math.floor(i / 3) * size));

  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + .5) / 2 ** level)));
  const metresPerPixel = 2 * Math.PI * 6378137 * Math.cos(lat) / (size * 2 ** level);
  const radius = Math.max(2, Math.min(24, 200 / metresPerPixel));
  const blurred = new OffscreenCanvas(size * 3, size * 3);
  const bg = blurred.getContext('2d')!;
  bg.filter = `blur(${radius}px)`;
  bg.drawImage(land, 0, 0);
  const crop = new OffscreenCanvas(size, size), cg = crop.getContext('2d', {willReadFrequently:true})!;
  cg.drawImage(blurred, size, size, size, size, 0, 0, size, size);
  const alpha = cg.getImageData(0, 0, size, size);
  // Raise the land influence before inverting it so the full USGS photograph
  // extends into the nearshore water, followed by a short smooth transition.
  for (let i = 3; i < alpha.data.length; i += 4) alpha.data[i] = 255 - Math.min(255, alpha.data[i] * 4);
  cg.putImageData(alpha, 0, 0);
  cg.globalCompositeOperation = 'destination-in';
  cg.drawImage(masks[4]!, 0, 0);
  const result = new OffscreenCanvas(size, size), rg = result.getContext('2d')!;
  rg.drawImage(source, 0, 0, size, size);
  rg.globalCompositeOperation = 'destination-out';
  rg.drawImage(crop, 0, 0);
  return createImageBitmap(result, { imageOrientation: 'flipY' });
}

export class UsgsImageryProvider extends UrlTemplateImageryProvider {
  private readonly service: UsgsService;

  constructor(options: ConstructorParameters<typeof UrlTemplateImageryProvider>[0], service: UsgsService) {
    super(options);
    this.service = service;
  }

  override requestImage(x: number, y: number, level: number, _request?: Request): Promise<ImageBitmap> {
    const url = `https://basemap.nationalmap.gov/arcgis/rest/services/${this.service}/MapServer/tile/${level}/${y}/${x}`;
    return (async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const isPng = (res.headers.get('content-type') ?? '').includes('png');
      // The topo service legitimately uses white map background; only imagery services are cleared.
      const clearable = this.service !== 'USGSTopo';
      // Real imagery (JPEG > 4 KB): decoded off the main thread by createImageBitmap. Black no-data fill is
      // removed on the GPU (colorToAlpha on the layer, see basemaps.ts), so no pixel readback is needed.
      if (!isPng && (!clearable || blob.size > BLANK_JPEG_MAX_BYTES)) {
        usgsStats.imageryTiles++;
        if (clearable) {
          const dec = await createImageBitmap(blob);
          const pc = new OffscreenCanvas(PROBE, PROBE);
          const pg = pc.getContext('2d', { willReadFrequently: true })!;
          pg.drawImage(dec, 0, 0, PROBE, PROBE);
          if (probeHasWhite(pg.getImageData(0, 0, PROBE, PROBE).data)) {
            const t0 = performance.now();
            const c = new OffscreenCanvas(dec.width, dec.height);
            const g = c.getContext('2d', { willReadFrequently: true })!;
            g.drawImage(dec, 0, 0);
            const img = g.getImageData(0, 0, dec.width, dec.height);
            if (clearWhiteFill(img.data, dec.width, dec.height) > 0) {
              usgsStats.mixedWhiteTiles++;
              g.putImageData(img, 0, 0);
              profAdd('usgs.white', performance.now() - t0);
              dec.close();
              return this.service === 'USGSImageryOnly' ? blendShore(c, level, x, y) : createImageBitmap(c, { imageOrientation: 'flipY' });
            }
          }
          if (this.service === 'USGSImageryOnly') {
            const result = await blendShore(dec, level, x, y);
            dec.close();
            return result;
          }
          dec.close();
        }
        return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      }
      // No-data tiles (white PNGs, tiny blank JPEGs): rare, small, cleared on the CPU.
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const t0 = performance.now();
      const img = g.getImageData(0, 0, bmp.width, bmp.height);
      if (isPng) {
        usgsStats.noDataTiles++;
        if (clearable) clearNoDataPixels(img.data);
      } else if (whiteFraction(img.data) >= BLANK_WHITE_FRACTION) {
        usgsStats.blankTiles++;
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0;
      } else {
        // Small JPEG that is mostly white with a corner of imagery: clear the white part only.
        usgsStats.imageryTiles++;
        if (clearable && clearWhiteFill(img.data, bmp.width, bmp.height) > 0) usgsStats.mixedWhiteTiles++;
      }
      g.putImageData(img, 0, 0);
      profAdd('usgs.pixels', performance.now() - t0);
      return this.service === 'USGSImageryOnly' ? blendShore(c, level, x, y) : createImageBitmap(c, { imageOrientation: 'flipY' });
    })();
  }
}
