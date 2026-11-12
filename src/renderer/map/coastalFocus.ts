import { Math as CMath, type Cartographic } from 'cesium';
import { MERCATOR_MAX_LAT, mercatorPixel } from '../../shared/mercator';
import { oceanMask } from './vectorTiles';

// At this scale the OSM mask resolves the coast to about 5 m in the Gulf of Finland.
const LEVEL = 14;
const masks = new Map<string, Promise<OffscreenCanvas | null>>();

export function oceanFocusPixel(point: Cartographic) {
  const lat = CMath.toDegrees(point.latitude);
  if (Math.abs(lat) > MERCATOR_MAX_LAT) return null;
  const size = 256 * 2 ** LEVEL;
  const p = mercatorPixel(CMath.toDegrees(point.longitude), lat, LEVEL);
  return { x: ((Math.floor(p.x) % size) + size) % size, y: Math.min(size - 1, Math.max(0, Math.floor(p.y))) };
}

// A view several km across can look at a town with sea on either side. Use the same
// packaged land outline as the imagery compositor, without issuing network mask requests.
type Pixel = { x: number; y: number };
const landTiles = new Map<string, Promise<CanvasRenderingContext2D>>();
export async function regionalWater(pixels: Pixel[]): Promise<boolean | null> {
  const scale = 2 ** (LEVEL - 3) / 4; // 1024 px packaged tiles at zoom 3
  const results = await Promise.all(pixels.map(async pixel => {
    const x = Math.floor(pixel.x / scale), y = Math.floor(pixel.y / scale);
    const key = Math.floor(y / 1024) + '/' + Math.floor(x / 1024);
    let tile = landTiles.get(key);
    if (!tile) {
      tile = fetch('/optical-water/land/3/' + key + '.png').then(async response => {
        if (!response.ok) throw new Error('Coastline unavailable');
        const image = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0); image.close();
        return ctx;
      });
      landTiles.set(key, tile);
      void tile.catch(() => landTiles.delete(key));
      if (landTiles.size > 8) landTiles.delete(landTiles.keys().next().value!);
    }
    const ctx = await tile;
    return ctx.canvas.width === 1 || ctx.getImageData(x % 1024, y % 1024, 1, 1).data[3] < 192;
  }));
  // Keep the city mesh for mixed coastal views. Switch to imagery only when
  // every sampled point is water.
  return results.every(Boolean);
}

export async function isMappedWater(pixel: { x: number; y: number }): Promise<boolean | null> {
  const x = Math.floor(pixel.x / 256), y = Math.floor(pixel.y / 256), key = x + '/' + y;
  let pending = masks.get(key);
  if (!pending) {
    pending = oceanMask(LEVEL, x, y, true);
    masks.set(key, pending);
    if (masks.size > 12) masks.delete(masks.keys().next().value!);
  }
  const mask = await pending;
  if (!mask) {
    if (masks.get(key) === pending) masks.delete(key);
    return null;
  }
  // Require a complete ocean pixel. Mixed coastal pixels retain their photographed land mesh.
  return mask.getContext('2d')!.getImageData(pixel.x % 256, pixel.y % 256, 1, 1).data[3] === 255;
}
