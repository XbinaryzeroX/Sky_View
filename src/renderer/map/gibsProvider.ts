// NASA GIBS global base (Blue Marble Shaded Relief + Bathymetry). Its native
// maximum is zoom 8, about 600 m per pixel at the equator.
//
// 1. Antimeridian defect (2026-11-09). Tiles in the easternmost column
//    (x = 2^z − 1, ending at 180°E) end in a 2–9 px band of near-black pixels,
//    including JPEG noise. On the globe this showed as a black vertical stripe
//    at 180°, for example east of Fiji. For those tiles only, the band is
//    filled row by row from the nearest valid column. No detail is added.
//
// 2. Smoother close-ups (2026-11-09). Beyond zoom 8, Cesium used to stretch the
//    native tiles with bilinear GPU filtering, and the ocean showed blocky
//    squares. Levels 9–11 are now built from the native zoom-8 tile with
//    high-quality (bicubic) resampling. Pixels inside OpenStreetMap ocean
//    polygons are replaced by a blur of nearby water pixels only (see
//    smoothOcean), which removes block and JPEG artifacts from the bathymetry
//    shading without smearing coastline pixels into the sea. No detail is added: no free global source
//    has finer open-ocean imagery.

import { UrlTemplateImageryProvider, type Request } from 'cesium';
import { repairRightEdge } from '../../shared/tilePixels';
import { oceanMask, oceanMaskFine, offshoreMask } from './vectorTiles';

export const NATIVE_MAX = 8;
export const SMOOTHED_MAX = 11;
const TILE = 256;

export const gibsStats = { native: 0, smoothed: 0, edgeRepaired: 0 };

/**
 * Replaces ocean pixels with a normalized blur of nearby *water* pixels only.
 * Blue Marble's ~600 m coastline pixels are land-colored, and many fall inside
 * the more precise OSM ocean polygons. A plain blur smeared them into a dark
 * halo around islands. Here, only pixels that are both inside the ocean mask
 * and blue-dominant contribute (weight = alpha). Canvas blur on premultiplied
 * alpha followed by un-premultiplied readback gives sum(c·w) / sum(w).
 */
/**
 * Blue Marble's own shallow coastal water tone, used only where OSM marks ocean
 * and the source tile has no water-colored pixel to borrow from (e.g. inner
 * San Francisco Bay at zoom 8, where every source pixel is land-colored).
 */
const BLUE_MARBLE_COASTAL_WATER: [number, number, number] = [24, 62, 114];

/** Fraction of a mask's pixels that are ocean (sampled every 4th pixel). */
function oceanCoverage(mask: OffscreenCanvas): number {
  const a = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, TILE, TILE).data;
  let n = 0;
  let t = 0;
  for (let i = 3; i < a.length; i += 16) {
    t++;
    if (a[i] > 127) n++;
  }
  return n / t;
}

const isWater = (d: Uint8ClampedArray, i: number) => d[i + 2] > d[i] + 12 && d[i + 2] >= d[i + 1];

function smoothOcean(c: OffscreenCanvas, mask: OffscreenCanvas, nearPx: number, onlyLandColored: boolean, fallback: [number, number, number] | null = null): [number, number, number] | null {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, TILE, TILE);
  const m = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, TILE, TILE).data;
  const d = img.data;
  const water = new ImageData(TILE, TILE);
  const w = water.data;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sn = 0;
  for (let i = 0; i < d.length; i += 4) {
    const blue = isWater(d, i);
    if (m[i + 3] > 127 && blue) {
      w[i] = d[i];
      w[i + 1] = d[i + 1];
      w[i + 2] = d[i + 2];
      w[i + 3] = 255;
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
      sn++;
    }
  }
  const mean: [number, number, number] | null = sn > 0 ? [sr / sn, sg / sn, sb / sn] : fallback;
  const src = new OffscreenCanvas(TILE, TILE);
  src.getContext('2d')!.putImageData(water, 0, 0);
  const out = new OffscreenCanvas(TILE, TILE);
  const og = out.getContext('2d', { willReadFrequently: true })!;
  // Two radii: the small one keeps bathymetry gradients; the large one fills gaps next to land.
  og.filter = `blur(${nearPx.toFixed(1)}px)`;
  og.drawImage(src, 0, 0);
  const near = og.getImageData(0, 0, TILE, TILE).data;
  og.clearRect(0, 0, TILE, TILE);
  og.filter = 'blur(24px)';
  og.drawImage(src, 0, 0);
  const far = og.getImageData(0, 0, TILE, TILE).data;
  for (let i = 0; i < d.length; i += 4) {
    const a = m[i + 3] / 255;
    if (a === 0 || (onlyLandColored && isWater(d, i))) continue;
    const s = near[i + 3] > 24 ? near : far[i + 3] > 4 ? far : null;
    // Last resort (e.g. a harbor far from any blue source pixel): the mean water color of this or the parent tile.
    const r = s ? s[i] : mean?.[0];
    if (r === undefined) continue;
    const gg = s ? s[i + 1] : mean![1];
    const b = s ? s[i + 2] : mean![2];
    d[i] = d[i] * (1 - a) + r * a;
    d[i + 1] = d[i + 1] * (1 - a) + gg * a;
    d[i + 2] = d[i + 2] * (1 - a) + b * a;
  }
  g.putImageData(img, 0, 0);
  return mean;
}

export class GibsBaseProvider extends UrlTemplateImageryProvider {
  private readonly template: string;
  private readonly nativeCache = new Map<string, Promise<ImageBitmap>>();
  private readonly smoothCache = new Map<string, Promise<{ canvas: OffscreenCanvas; water: [number, number, number] | null }>>();

  constructor(options: ConstructorParameters<typeof UrlTemplateImageryProvider>[0] & { url: string }) {
    super({ ...options, maximumLevel: SMOOTHED_MAX });
    this.template = options.url;
  }

  /** Native tile, unflipped, with the antimeridian band repaired. Cached and shared by child levels. */
  private native(x: number, y: number, level: number): Promise<ImageBitmap> {
    const key = `${level}/${x}/${y}`;
    const hit = this.nativeCache.get(key);
    if (hit) {
      this.nativeCache.delete(key);
      this.nativeCache.set(key, hit);
      return hit;
    }
    const p = (async () => {
      const url = this.template.replace('{z}', String(level)).replace('{y}', String(y)).replace('{x}', String(x));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob());
      if (x !== 2 ** level - 1) return bmp;
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const img = g.getImageData(0, 0, bmp.width, bmp.height);
      if (repairRightEdge(img.data, bmp.width, bmp.height) > 0) gibsStats.edgeRepaired++;
      g.putImageData(img, 0, 0);
      return createImageBitmap(c);
    })();
    p.catch(() => this.nativeCache.delete(key));
    this.nativeCache.set(key, p);
    if (this.nativeCache.size > 48) this.nativeCache.delete(this.nativeCache.keys().next().value!);
    return p;
  }

  override requestImage(x: number, y: number, level: number, request?: Request) {
    if (level === NATIVE_MAX) {
      // Same smoothed canvas the deeper levels crop from, so zoom 8 and zoom 9–11 tiles match side by side.
      gibsStats.native++;
      return this.smoothParent(x, y).then((p) => createImageBitmap(p.canvas, { imageOrientation: 'flipY' })) as never;
    }
    if (level < NATIVE_MAX) {
      gibsStats.native++;
      if (x !== 2 ** level - 1) return super.requestImage(x, y, level, request);
      // Cesium expects bitmaps flipped at creation (see usgsProvider.ts).
      return this.native(x, y, level).then((b) => createImageBitmap(b, { imageOrientation: 'flipY' })) as never;
    }
    return this.smoothed(x, y, level) as never;
  }

  /**
   * The native tile with its ocean smoothed once, using the zoom-8 ocean mask.
   * Child tiles crop from this shared canvas, so no seams appear between them.
   */
  private smoothParent(px: number, py: number): Promise<{ canvas: OffscreenCanvas; water: [number, number, number] | null }> {
    const key = `${px}/${py}`;
    const hit = this.smoothCache.get(key);
    if (hit) return hit;
    const p = (async () => {
      const [src, coarse] = await Promise.all([this.native(px, py, NATIVE_MAX), oceanMask(NATIVE_MAX, px, py)]);
      // Coastal tiles only: redraw the outline from zoom-10 vector tiles, because the zoom-8 outline is too
      // generalized for harbors and estuaries. All-sea and all-land tiles (most of the globe) skip the 16 requests.
      const coverage = coarse ? oceanCoverage(coarse) : 0;
      const mask = coarse && coverage > 0 && coverage < 1 ? ((await oceanMaskFine(NATIVE_MAX, px, py, 2)) ?? coarse) : coverage > 0 ? coarse : null;
      const c = new OffscreenCanvas(TILE, TILE);
      c.getContext('2d')!.drawImage(src, 0, 0);
      const water = mask ? smoothOcean(c, mask, 2.2, false, BLUE_MARBLE_COASTAL_WATER) : null;
      return { canvas: c, water };
    })();
    p.catch(() => this.smoothCache.delete(key));
    this.smoothCache.set(key, p);
    if (this.smoothCache.size > 32) this.smoothCache.delete(this.smoothCache.keys().next().value!);
    return p;
  }

  protected async smoothed(x: number, y: number, level: number): Promise<ImageBitmap> {
    const shift = level - NATIVE_MAX;
    const px = x >> shift;
    const py = y >> shift;
    const span = TILE >> shift;
    const sx = (x - (px << shift)) * span;
    const sy = (y - (py << shift)) * span;
    const [parent, mask] = await Promise.all([this.smoothParent(px, py), oceanMask(level, x, y)]);
    const src = parent.canvas;
    const c = new OffscreenCanvas(TILE, TILE);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const k = TILE / span;
    // One source pixel of margin, where available, keeps resampling continuous across tile edges.
    const x0 = Math.max(0, sx - 1);
    const y0 = Math.max(0, sy - 1);
    const x1 = Math.min(TILE, sx + span + 1);
    const y1 = Math.min(TILE, sy + span + 1);
    g.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    // Coast fix at this level: land-colored source pixels inside the finer OSM ocean outline take nearby water color.
    if (mask) smoothOcean(c, mask, Math.min(12, 2 + 0.9 * k), true);
    gibsStats.smoothed++;
    return createImageBitmap(c, { imageOrientation: 'flipY' });
  }
}

/**
 * "Even ocean" veil for customer imagery (Google, Esri, Mapbox, EOX). Those
 * sources show detailed dark water near coasts and a much coarser sea further
 * out, so islands sit in dark blobs. This layer draws the same smoothed NASA
 * sea used by the keyless map *on top*, only where OSM ocean is more than
 * NEARSHORE_KEEP_M from land, fading in from the coast. The customer imagery
 * itself is not altered; switch off in Settings to see it unobscured.
 */
export class OffshoreVeilProvider extends GibsBaseProvider {
  override requestImage(x: number, y: number, level: number) {
    if (level < 9) return createImageBitmap(new ImageData(1, 1)) as never;
    return (async () => {
      const [img, mask] = await Promise.all([this.smoothed(x, y, level), offshoreMask(level, x, y)]);
      if (!mask) return createImageBitmap(new ImageData(1, 1));
      const c = new OffscreenCanvas(TILE, TILE);
      const cg = c.getContext('2d')!;
      // `img` is already flipped for Cesium; flip the mask the same way before combining.
      cg.drawImage(img, 0, 0);
      cg.globalCompositeOperation = 'destination-in';
      cg.translate(0, TILE);
      cg.scale(1, -1);
      cg.drawImage(mask, 0, 0);
      return createImageBitmap(c);
    })() as never;
  }
}
