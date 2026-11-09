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
// Coastal water (2026-11-09): USGS orthoimagery stops a few km offshore in
// ragged, tile-shaped patches with smeared edge pixels, so the sea looked
// "detailed only near land". Imagery over OpenStreetMap ocean that is more
// than NEARSHORE_KEEP_M (1.5 km) from land is now faded out, so the open sea is
// drawn by one consistent global source. Harbors, rivers, bays, lakes and
// beaches keep their real USGS imagery. If vector tiles are unavailable the
// tile is shown unmasked.
//
// Orientation: Cesium decodes its own imagery bitmaps with imageOrientation
// 'flipY' (Chromium ignores UNPACK_FLIP_Y for ImageBitmap), so every bitmap
// returned here is created flipped the same way.

import { UrlTemplateImageryProvider, type Request } from 'cesium';

export type UsgsService = 'USGSImageryOnly' | 'USGSImageryTopo' | 'USGSTopo';

import { BLANK_JPEG_MAX_BYTES, BLANK_WHITE_FRACTION, clearNoDataPixels, whiteFraction } from '../../shared/tilePixels';
import { offshoreMask } from './vectorTiles';

export const usgsStats = { noDataTiles: 0, blankTiles: 0, imageryTiles: 0, oceanMasked: 0, maskUnavailable: 0 };

export class UsgsImageryProvider extends UrlTemplateImageryProvider {
  private readonly service: UsgsService;
  private readonly maskOcean: boolean;

  constructor(options: ConstructorParameters<typeof UrlTemplateImageryProvider>[0], service: UsgsService, maskOcean = true) {
    super(options);
    this.service = service;
    this.maskOcean = maskOcean;
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
      const maskP = clearable && this.maskOcean ? offshoreMask(level, x, y) : Promise.resolve(null);
      // Real imagery (JPEG > 4 KB): decoded off the main thread by createImageBitmap. Black no-data fill is
      // removed on the GPU (colorToAlpha on the layer, see basemaps.ts), so no pixel readback is needed.
      if (!isPng && (!clearable || blob.size > BLANK_JPEG_MAX_BYTES)) {
        usgsStats.imageryTiles++;
        const mask = await maskP;
        if (mask === null || mask === 'none') {
          if (mask === null && clearable && this.maskOcean) usgsStats.maskUnavailable++;
          return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
        }
        // Offshore water present: one GPU canvas composite (no readback).
        usgsStats.oceanMasked++;
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        bmp.close();
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(mask, 0, 0, c.width, c.height);
        return createImageBitmap(c, { imageOrientation: 'flipY' });
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
      } else usgsStats.imageryTiles++;
      g.putImageData(img, 0, 0);
      profAdd('usgs.pixels', performance.now() - t0);
      const m = await maskP;
      if (m && m !== 'none') {
        usgsStats.oceanMasked++;
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(m, 0, 0, bmp.width, bmp.height);
      }
      return createImageBitmap(c, { imageOrientation: 'flipY' });
    })();
  }
}
