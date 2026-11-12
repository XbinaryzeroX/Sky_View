import { Credit, GeographicTilingScheme, ImageryLayer, WebMapServiceImageryProvider, type Request } from 'cesium';
import type { ArchiveImage } from '../../shared/satelliteYears';
import { oceanColourLayer, sentinelLayer, type BasemapDef, type ImagerySourceInfo } from './basemaps';
import { GIBS_PRODUCTS } from './imageryOverlay';

export const archiveProduct = GIBS_PRODUCTS.find(product => product.id === 'MODIS_Terra_CorrectedReflectance_TrueColor')!;

// NASA encodes missing orbital swaths as opaque black. Clear these before the GPU
// interpolates the tile, so the edge doesn't leave a dark fringe on the image below.
class SwathImageryProvider extends WebMapServiceImageryProvider {
  override requestImage(x: number, y: number, level: number, request?: Request) {
    const pending = super.requestImage(x, y, level, request);
    if (!pending) return undefined;
    return pending.then(async image => {
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image as CanvasImageSource, 0, 0, 256, 256);
      const pixels = ctx.getImageData(0, 0, 256, 256);
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) <= 8) pixels.data[i + 3] = 0;
      }
      ctx.putImageData(pixels, 0, 0);
      // Cesium's WMS decoder already prepares ImageBitmap rows for its texture upload.
      return createImageBitmap(canvas);
    });
  }
}

/** Same-year observations fill gaps in the selected day's orbital swaths. */
export function archiveDates(image: ArchiveImage, today = new Date().toISOString().slice(0, 10)): string[] {
  if (!image.date) return [];
  const dates = [1, 4, 10, 12].map(month => `${image.year}-${String(month).padStart(2, '0')}-15`);
  const selected = Date.parse(`${image.date}T00:00:00Z`);
  for (const offset of [-2, 2]) {
    dates.push(new Date(selected + offset * 86400_000).toISOString().slice(0, 10));
  }
  return [...new Set(dates.filter(date => date.startsWith(`${image.year}-`) && date <= today && date !== image.date)), image.date];
}

export function archiveCaption(image: ArchiveImage): string {
  const products: string[] = [];
  if (image.sentinelYear) products.push('ESA Sentinel-2 and Ocean Colour CCI annual composites · NASA Terra/MODIS multi-date overview, ' + image.sentinelYear);
  if (image.date) products.push('NASA Terra/MODIS ' + image.date + ' UTC, with other ' + image.year + ' observations filling gaps');
  return products.join(' · ') || 'No published imagery available for ' + image.year;
}

export function historicalBasemap(image: ArchiveImage): BasemapDef {
  const sources: ImagerySourceInfo[] = [];
  if (image.date) sources.push({
    id: archiveProduct.id, name: 'Terra/MODIS true colour', provider: 'NASA GIBS',
    coverage: 'Daylight swaths, with additional same-year observations filling gaps', captureDate: image.date + ' UTC',
    maxLevel: 9, bestResolution: '250–500 m', terms: 'NASA open data', host: 'gibs.earthdata.nasa.gov',
  });
  if (image.sentinelYear) sources.push({
    id: 'optical-water', name: 'Optical Earth overview', provider: 'ESA Ocean Colour CCI / NASA Terra MODIS',
    coverage: 'Global optical observations where available', captureDate: image.sentinelYear + ' ocean composite and selected MODIS passes',
    maxLevel: 2, bestResolution: '1/12° overview (approximately 9 km at the equator)', terms: 'ESA Ocean Colour Climate Change Initiative / NASA', host: null,
  }, {
    id: 'worldcover-s2-rgb', name: 'Sentinel-2 true colour', provider: 'ESA WorldCover / Terrascope',
    coverage: 'Land and coastal observations from 60° S to 83° N', captureDate: image.sentinelYear + ' annual composite',
    maxLevel: 14, bestResolution: '10 m', terms: 'CC BY 4.0', host: 'wmts.terrascope.be',
  });
  return {
    id: 'atlas', label: 'Satellite imagery · ' + image.year, description: archiveCaption(image), sources,
    build() {
      const layers: ImageryLayer[] = [];
      for (const date of archiveDates(image)) layers.push(new ImageryLayer(new SwathImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
        layers: archiveProduct.id, parameters: { time: date, format: 'image/png', transparent: true, styles: '' },
        tilingScheme: new GeographicTilingScheme(), maximumLevel: date === image.date ? 9 : 3, enablePickFeatures: false,
        credit: new Credit('NASA Terra/MODIS true colour · ' + date + ' UTC'),
      })));
      if (image.sentinelYear) layers.push(oceanColourLayer(image.sentinelYear), sentinelLayer(image.sentinelYear));
      return layers;
    },
  };
}
