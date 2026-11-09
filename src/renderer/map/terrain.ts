import { terrainPool } from './workerPool';
import { profAdd } from '../lib/prof';
// Keyless global terrain from the Terrain Tiles dataset on the AWS Registry
// of Open Data (Mapzen/Tilezen "terrarium" PNG encoding). Real elevation
// to zoom 15; deeper levels resample the zoom-15 ancestor (no invented detail).
//
// Tiling (2026-11-09): the source is Web Mercator, which ends at ±85.05°.
// Serving terrain in that scheme left the globe with no surface over either
// pole (a black disc in Antarctica and the Arctic). Terrain is now served in
// Cesium's geographic scheme, which reaches ±90°: each heightmap is resampled
// from the Mercator source tiles. Beyond ±85.05° there is no source data, so
// the last source row is extended to the pole (display only; see
// MERCATOR_MAX_LAT).
//
// Sea surface (2026-11-09): the source carries ocean-floor depths (ETOPO1), so
// the sea was drawn as a bumpy seabed at its true depth. Tilted views showed
// blurry 500 m imagery draped over underwater ridges. Samples inside
// OpenStreetMap ocean polygons are now drawn at sea level. Each tile also gets
// a water mask, so Cesium renders its standard animated water surface (a
// rendering effect, not observed waves). If the ocean outline is unavailable
// for a tile, its heights are left unchanged.

import { Credit, CustomHeightmapTerrainProvider, GeographicTilingScheme, HeightmapTerrainData, Math as CesiumMath, type Request, type TerrainData } from 'cesium';
import { oceanMask } from './vectorTiles';
import { mercatorPixel, MERCATOR_MAX_LAT, sourceZoomFor } from '../../shared/mercator';

export const TERRAIN_INFO = {
  name: 'Terrain Tiles (terrarium)',
  provider: 'Mapzen/Tilezen via AWS Open Data',
  coverage: 'Global',
  maxLevel: 15,
  bestResolution: '≈ 5–10 m in the U.S. (3DEP); ≈ 30–90 m elsewhere (SRTM, GMTED, ETOPO1 in oceans)',
  terms: 'Open data with per-source attribution (USGS 3DEP, SRTM, GMTED2010, ETOPO1, Copernicus EU-DEM and others)',
  host: 's3.amazonaws.com/elevation-tiles-prod',
};

const SIZE = 65;
const SOURCE_MAX = 15;
// Decoding runs in workers (workerPool.ts), so more requests can be in flight without blocking the map.
const MAX_IN_FLIGHT = 12;
/** Water mask resolution per terrain tile (square, rows north to south). */
const MASK = 128;
const MASK_TIMEOUT_MS = 6000;

export const seaStats = { maskedTiles: 0, maskUnavailable: 0 };

const alphaCache = new Map<string, Promise<Uint8Array | null>>();
/** Ocean coverage (0–255 per pixel) of a 256-px Web Mercator tile from OSM ocean polygons; null if unavailable. */
function oceanAlpha(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const key = `${z}/${x}/${y}`;
  const hit = alphaCache.get(key);
  if (hit) return hit;
  const p = Promise.race([
    oceanMask(z, x, y).then((c) => {
      if (!c) return null;
      // Pixel readback happens in a worker; the mask is handed over as a GPU-backed bitmap.
      const pool = terrainPool();
      if (pool) {
        // Transfer (not copy) the bitmap: copying a GPU-backed bitmap forces a synchronous GPU readback on this thread.
        const bitmap = c.transferToImageBitmap();
        return pool.run<Uint8Array>({ kind: 'alpha', bitmap }, [bitmap]).catch(() => null);
      }
      const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, 256, 256).data;
      const a = new Uint8Array(256 * 256);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      return a;
    }),
    new Promise<null>((r) => setTimeout(() => r(null), MASK_TIMEOUT_MS)),
  ]).catch(() => null);
  p.then((v) => v === null && alphaCache.delete(key));
  alphaCache.set(key, p);
  if (alphaCache.size > 300) alphaCache.delete(alphaCache.keys().next().value!);
  return p;
}

interface SeaTile {
  heights: Float32Array;
  water: Uint8Array | null;
}

/** Heightmap terrain with a water mask (CustomHeightmapTerrainProvider reports none). */
class SeaLevelTerrainProvider extends CustomHeightmapTerrainProvider {
  private readonly seaCallback: (x: number, y: number, level: number) => Promise<SeaTile>;
  private readonly size: number;
  constructor(options: ConstructorParameters<typeof CustomHeightmapTerrainProvider>[0] & { seaCallback: (x: number, y: number, level: number) => Promise<SeaTile> }) {
    super(options);
    this.seaCallback = options.seaCallback;
    this.size = options.width;
    Object.defineProperty(this, 'hasWaterMask', { get: () => true });
  }
  override requestTileGeometry(x: number, y: number, level: number, _request?: Request): Promise<TerrainData> | undefined {
    const size = this.size;
    return this.seaCallback(x, y, level).then(
      (t) => new HeightmapTerrainData({ buffer: t.heights, width: size, height: size, waterMask: t.water ?? new Uint8Array([0]) }),
    );
  }
}

export interface TerrainStats {
  requested: number;
  loaded: number;
  failed: number;
  inFlight: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  deepestLevelRequested: number;
}

export function createTerrariumTerrain(): { provider: CustomHeightmapTerrainProvider; stats: TerrainStats } {
  const stats: TerrainStats = { requested: 0, loaded: 0, failed: 0, inFlight: 0, lastSuccessAt: null, lastError: null, deepestLevelRequested: 0 };
  const cache = new Map<string, Promise<Float32Array>>(); // decoded 256x256 source tiles
  const queue: (() => void)[] = [];

  const acquire = () =>
    new Promise<void>((resolve) => {
      if (stats.inFlight < MAX_IN_FLIGHT) {
        stats.inFlight++;
        resolve();
      } else queue.push(() => {
        stats.inFlight++;
        resolve();
      });
    });
  const release = () => {
    stats.inFlight--;
    queue.shift()?.();
  };

  async function decodeTile(z: number, x: number, y: number): Promise<Float32Array> {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      await acquire();
      stats.requested++;
      try {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
        const pool = terrainPool();
        if (pool) {
          const out = await pool.run<Float32Array>({ kind: 'height', url });
          stats.loaded++;
          stats.lastSuccessAt = new Date().toISOString();
          return out;
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (res.status === 404) return new Float32Array(256 * 256); // no source data: sea level
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        const tDec = performance.now();
        const px = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        profAdd('terrain.decode', performance.now() - tDec);
        stats.loaded++;
        stats.lastSuccessAt = new Date().toISOString();
        return out;
      } catch (e) {
        stats.failed++;
        stats.lastError = e instanceof Error ? e.message : String(e);
        cache.delete(key);
        throw e;
      } finally {
        release();
      }
    })();
    cache.set(key, p);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
    return p;
  }

  const tilingScheme = new GeographicTilingScheme();
  const provider = new SeaLevelTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme,
    credit: new Credit('Terrain: Mapzen Terrain Tiles on AWS (3DEP, SRTM, GMTED2010, ETOPO1, Copernicus EU-DEM, others)'),
    callback: () => undefined as never,
    seaCallback: (x, y, level) => {
      if (level > stats.deepestLevelRequested) stats.deepestLevelRequested = level;
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = CesiumMath.toDegrees(rect.west);
      const east = CesiumMath.toDegrees(rect.east);
      const north = CesiumMath.toDegrees(rect.north);
      const south = CesiumMath.toDegrees(rect.south);
      const z = Math.min(SOURCE_MAX, sourceZoomFor(level, (north + south) / 2));
      // Pixel positions of every sample, then the set of source tiles they need.
      const lons = Array.from({ length: SIZE }, (_, c) => west + ((east - west) * c) / (SIZE - 1));
      const lats = Array.from({ length: SIZE }, (_, r) => north - ((north - south) * r) / (SIZE - 1));
      const px = lons.map((lon) => mercatorPixel(lon, 0, z).x);
      const py = lats.map((lat) => mercatorPixel(0, Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)), z).y);
      const n = 1 << z;
      const need = new Map<string, Promise<Float32Array>>();
      const tileOf = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v / 256)));
      for (const yy of py) for (const xx of px) {
        const k = `${tileOf(xx)}/${tileOf(yy)}`;
        if (!need.has(k)) need.set(k, decodeTile(z, tileOf(xx), tileOf(yy)));
      }
      const keys = [...need.keys()];
      // Ocean coverage for the same source tiles (OSM vector data stops at zoom 14; deeper zooms use a sub-area).
      const oceanJobs = keys.map((k) => {
        const [tx, ty] = k.split('/').map(Number);
        return oceanAlpha(z, tx, ty);
      });
      // Water-mask sample grid (finer than the height grid).
      const mpx = Array.from({ length: MASK }, (_, c) => mercatorPixel(west + ((east - west) * (c + 0.5)) / MASK, 0, z).x);
      const mpy = Array.from({ length: MASK }, (_, r) => mercatorPixel(0, Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, north - ((north - south) * (r + 0.5)) / MASK)), z).y);
      return Promise.all([Promise.all(need.values()), Promise.all(oceanJobs)]).then(([tiles, oceans]) => {
        const byKey = new Map(keys.map((k, i) => [k, tiles[i]]));
        const oceanKnown = oceans.every((o) => o !== null);
        const seaByKey = new Map(keys.map((k, i) => [k, oceans[i]]));
        const sea = (gx: number, gy: number) => {
          const cx = Math.min(n * 256 - 1, Math.max(0, gx));
          const cy = Math.min(n * 256 - 1, Math.max(0, gy));
          const t = seaByKey.get(`${tileOf(cx)}/${tileOf(cy)}`);
          if (!t) return 0;
          return t[(Math.floor(cy) % 256) * 256 + (Math.floor(cx) % 256)] / 255;
        };
        const at = (gx: number, gy: number) => {
          const cx = Math.min(n * 256 - 1, Math.max(0, gx));
          const cy = Math.min(n * 256 - 1, Math.max(0, gy));
          const t = byKey.get(`${tileOf(cx)}/${tileOf(cy)}`);
          if (!t) return 0;
          return t[(Math.floor(cy) % 256) * 256 + (Math.floor(cx) % 256)];
        };
        const tRes = performance.now();
        const out = new Float32Array(SIZE * SIZE);
        for (let r = 0; r < SIZE; r++) {
          const fy = py[r];
          const y0 = Math.floor(fy);
          const ty = fy - y0;
          for (let c = 0; c < SIZE; c++) {
            const fx = px[c];
            const x0 = Math.floor(fx);
            const tx = fx - x0;
            // Bilinear within the source; neighbours outside the fetched set fall back to the nearest fetched pixel.
            const a = at(x0, y0) * (1 - tx) + (byKey.has(`${tileOf(x0 + 1)}/${tileOf(y0)}`) ? at(x0 + 1, y0) : at(x0, y0)) * tx;
            const b = (byKey.has(`${tileOf(x0)}/${tileOf(y0 + 1)}`) ? at(x0, y0 + 1) : at(x0, y0)) * (1 - tx) + (byKey.has(`${tileOf(x0 + 1)}/${tileOf(y0 + 1)}`) ? at(x0 + 1, y0 + 1) : at(x0, y0)) * tx;
            const h = a * (1 - ty) + b * ty;
            // Inside OSM ocean: sea level (blended across the coastline pixel).
            out[r * SIZE + c] = oceanKnown ? h * (1 - sea(fx, fy)) : h;
          }
        }
        profAdd('terrain.resample', performance.now() - tRes);
        if (!oceanKnown) {
          seaStats.maskUnavailable++;
          return { heights: out, water: null };
        }
        const water = new Uint8Array(MASK * MASK);
        let any = 0;
        let all = 255;
        for (let r = 0; r < MASK; r++)
          for (let c = 0; c < MASK; c++) {
            const v = Math.round(sea(mpx[c], mpy[r]) * 255);
            water[r * MASK + c] = v;
            any |= v;
            all &= v === 255 ? 255 : 0;
          }
        seaStats.maskedTiles++;
        return { heights: out, water: any === 0 ? new Uint8Array([0]) : all === 255 ? new Uint8Array([255]) : water };
      });
    },
  });
  return { provider, stats };
}
