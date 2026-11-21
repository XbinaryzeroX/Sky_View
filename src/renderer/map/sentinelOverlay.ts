// A Sentinel-2 image cut to a box, draped over the terrain as one imagery layer. The image is decoded here from the
// PNG the main process made; nothing is fetched by the renderer.

import '../lib/cesiumBase';
import { Credit, Event, GeographicTilingScheme, ImageryLayer, Rectangle, type ImageryProvider } from 'cesium';
import { SENTINEL_CREDIT } from '../../shared/sentinel';

export interface SentinelOverlay {
  box: [number, number, number, number];
  bitmap: ImageBitmap;
  opacity: number;
}

export async function decodeSentinelPng(png: Uint8Array): Promise<ImageBitmap> {
  // The image is flipped for Cesium's texture upload, like every other custom imagery provider here.
  return createImageBitmap(new Blob([png.slice().buffer], { type: 'image/png' }), { imageOrientation: 'flipY' });
}

export function sentinelImageryLayer(o: SentinelOverlay): ImageryLayer {
  const rect = Rectangle.fromDegrees(...o.box);
  const tilingScheme = new GeographicTilingScheme({ rectangle: rect, numberOfLevelZeroTilesX: 1, numberOfLevelZeroTilesY: 1 });
  const provider = {
    tilingScheme,
    rectangle: rect,
    tileWidth: o.bitmap.width,
    tileHeight: o.bitmap.height,
    minimumLevel: 0,
    maximumLevel: 0,
    tileDiscardPolicy: undefined,
    errorEvent: new Event(),
    credit: new Credit(SENTINEL_CREDIT),
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => [],
    pickFeatures: () => undefined,
    requestImage: () => Promise.resolve(o.bitmap),
  };
  return new ImageryLayer(provider as unknown as ImageryProvider, { rectangle: rect, alpha: o.opacity });
}
