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

import { BLANK_JPEG_MAX_BYTES, BLANK_WHITE_FRACTION, clearBlackFill, clearNoDataPixels, whiteFraction } from '../../shared/tilePixels';
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
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const isPng = (res.headers.get('content-type') ?? '').includes('png');
      // The topo service legitimately uses white map background; only imagery services are cleared.
      const clearable = this.service !== 'USGSTopo';
      const mask = clearable && this.maskOcean ? offshoreMask(level, x, y) : Promise.resolve(null);
      if (!isPng && !clearable) {
        usgsStats.imageryTiles++;
        return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
      }
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const img = g.getImageData(0, 0, bmp.width, bmp.height);
      if (isPng) {
        usgsStats.noDataTiles++;
        if (clearable) clearNoDataPixels(img.data);
      } else if (blob.size <= BLANK_JPEG_MAX_BYTES && whiteFraction(img.data) >= BLANK_WHITE_FRACTION) {
        usgsStats.blankTiles++;
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0;
      } else {
        usgsStats.imageryTiles++;
        clearBlackFill(img.data);
      }
      g.putImageData(img, 0, 0);
      const m = await mask;
      if (m) {
        usgsStats.oceanMasked++;
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(m, 0, 0, bmp.width, bmp.height);
        g.globalCompositeOperation = 'source-over';
      } else if (clearable && this.maskOcean) {
        usgsStats.maskUnavailable++;
      }
      return createImageBitmap(c, { imageOrientation: 'flipY' });
    })();
  }
}
