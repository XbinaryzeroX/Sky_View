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
// a water mask. Decorative wave shading is disabled by default for map readability;
// the sea-level geometry remains. If the ocean outline is unavailable
// for a tile, its heights are left unchanged.

import { Credit, CustomHeightmapTerrainProvider, GeographicTilingScheme, HeightmapTerrainData, Math as CesiumMath, type Request, type TerrainData } from 'cesium';
import { oceanMask } from './vectorTiles';
import { mercatorPixel, MERCATOR_MAX_LAT, sourceZoomFor } from '../../shared/mercator';
import { LAST_OVERVIEW_LEVEL, loadTerrainOverview, overviewTerrainTile } from './terrainOverview';

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
// Generous: a timed-out mask used to leave the tile at sea-floor depth (dark rectangles, 2026-11-09).
const MASK_TIMEOUT_MS = 20000;
/** Fallback coastline when OSM ocean data is unavailable: elevation below this is sea (-10 m keeps polders as land). */
const SEA_BELOW_M = -10;

export const seaStats = { maskedTiles: 0, maskUnavailable: 0, unavailableTiles: [] as string[], reasons: {} as Record<string, number> };
const why = (r: string) => (seaStats.reasons[r] = (seaStats.reasons[r] ?? 0) + 1);

const alphaCache = new Map<string, Promise<Uint8Array | null>>();
/** Ocean coverage (0–255 per pixel) of a 256-px Web Mercator tile from OSM ocean polygons; null if unavailable. */
function oceanAlpha(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const key = `${z}/${x}/${y}`;
  const hit = alphaCache.get(key);
  if (hit) return hit;
  let done = false;
  const p = Promise.race([
    oceanMask(z, x, y).then((c) => {
      if (!c) {
        why('vector tile unavailable');
        return null;
      }
      // Pixel readback happens in a worker; the mask is handed over as a GPU-backed bitmap.
      const pool = terrainPool();
      if (pool) {
        // Transfer (not copy) the bitmap: copying a GPU-backed bitmap forces a synchronous GPU readback on this thread.
        const bitmap = c.transferToImageBitmap();
        return pool.run<Uint8Array>({ kind: 'alpha', bitmap }, [bitmap]).catch((e) => {
          why(`worker: ${(e as Error).message}`);
          return null;
        });
      }
      const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, 256, 256).data;
      const a = new Uint8Array(256 * 256);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      return a;
    }),
    new Promise<null>((r) =>
      setTimeout(() => {
        if (!done) why('timeout');
        r(null);
      }, MASK_TIMEOUT_MS),
    ),
  ]).catch((e) => {
    why(`error: ${(e as Error).message}`);
    return null;
  });
  p.then((v) => {
    done = true;
    if (v === null) alphaCache.delete(key);
  });
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
  /** Display meshes sampled from the bundled z2 overview, with no remote terrain or coast requests. */
  overviewTiles: number;
  requested: number;
  loaded: number;
  failed: number;
  inFlight: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  deepestLevelRequested: number;
}

/**
 * `strict` (ground-height sampling): the source elevations as they are. A missing source tile (HTTP 404) fails
 * instead of being filled with sea level, and no ocean mask or sea flattening is applied (a valid elevation below
 * sea level stays negative). The globe keeps both display adjustments (no data = sea, oceans flattened to 0 m).
 */
export function createTerrariumTerrain(options: { strict?: boolean } = {}): { provider: CustomHeightmapTerrainProvider; stats: TerrainStats } {
  const strict = options.strict === true;
  const stats: TerrainStats = { overviewTiles: 0, requested: 0, loaded: 0, failed: 0, inFlight: 0, lastSuccessAt: null, lastError: null, deepestLevelRequested: 0 };
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
          const out = await pool.run<Float32Array>({ kind: 'height', url, strict });
          stats.loaded++;
          stats.lastSuccessAt = new Date().toISOString();
          return out;
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (res.status === 404) {
          if (strict) throw new Error('no terrain data for this tile');
          return new Float32Array(256 * 256); // no source data: sea level
        }
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
    seaCallback: async (x, y, level) => {
      if (level > stats.deepestLevelRequested) stats.deepestLevelRequested = level;
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = CesiumMath.toDegrees(rect.west);
      const east = CesiumMath.toDegrees(rect.east);
      const north = CesiumMath.toDegrees(rect.north);
      const south = CesiumMath.toDegrees(rect.south);
      if (!strict && level <= LAST_OVERVIEW_LEVEL) {
        const grid = await loadTerrainOverview();
        if (grid) {
          stats.overviewTiles++;
          return overviewTerrainTile(grid, west, east, north, south, SIZE);
        }
      }
      const z = Math.min(SOURCE_MAX, sourceZoomFor(level, (north + south) / 2));
      // Pixel positions of every sample, then the set of source tiles they need.
      const lons = Array.from({ length: SIZE }, (_, c) => west + ((east - west) * c) / (SIZE - 1));
      const lats = Array.from({ length: SIZE }, (_, r) => north - ((north - south) * r) / (SIZE - 1));
      // Terrarium samples lie at pixel centers. Both sides of a shared edge need the full
      // 2×2 interpolation kernel, even when a contributor belongs to the next source tile.
      const px = lons.map((lon) => mercatorPixel(lon, 0, z).x - 0.5);
      const py = lats.map((lat) => mercatorPixel(0, Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)), z).y - 0.5);
      const n = 1 << z;
      const world = n * 256;
      const wrapX = (p: number) => (p + world) % world;
      const clampY = (p: number) => Math.max(0, Math.min(world - 1, p));
      const sourceColumns = new Set(px.flatMap(v => [Math.floor(wrapX(Math.floor(v)) / 256), Math.floor(wrapX(Math.floor(v) + 1) / 256)]));
      const sourceRows = new Set(py.flatMap(v => [Math.floor(clampY(Math.floor(v)) / 256), Math.floor(clampY(Math.floor(v) + 1) / 256)]));
      const keys = [...sourceRows].flatMap(row => [...sourceColumns].map(col => ({ col, row, id: row * n + col })));
      const terrainJobs = keys.map(k => decodeTile(z, k.col, k.row));
      // Ocean coverage for the same source tiles (OSM vector data stops at zoom 14; deeper zooms use a sub-area).
      // Strict (ground-height sampling): no ocean data and no sea flattening, only the source elevations.
      const oceanJobs = strict
        ? []
        : keys.map(k => oceanAlpha(z, k.col, k.row));
      // Water-mask sample grid (finer than the height grid).
      const mpx = Array.from({ length: MASK }, (_, c) => mercatorPixel(west + ((east - west) * (c + 0.5)) / MASK, 0, z).x);
      const mpy = Array.from({ length: MASK }, (_, r) => mercatorPixel(0, Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, north - ((north - south) * (r + 0.5)) / MASK)), z).y);
      return Promise.all([Promise.all(terrainJobs), Promise.all(oceanJobs)]).then(([tiles, oceans]) => {
        const byKey = new Map(keys.map((k, i) => [k.id, tiles[i]]));
        const oceanKnown = oceans.every((o) => o !== null);
        const seaByKey = new Map(keys.map((k, i) => [k.id, oceans[i]]));
        const sourceId = (cx: number, cy: number) => Math.floor(cy / 256) * n + Math.floor(cx / 256);
        const sea = (gx: number, gy: number) => {
          const cx = wrapX(Math.floor(gx)), cy = clampY(Math.floor(gy));
          const mask = seaByKey.get(sourceId(cx, cy));
          return mask ? mask[(cy % 256) * 256 + (cx % 256)] / 255 : null;
        };
        const at = (gx: number, gy: number) => {
          const cx = wrapX(Math.floor(gx)), cy = clampY(Math.floor(gy));
          return byKey.get(sourceId(cx, cy))![(cy % 256) * 256 + (cx % 256)];
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
            const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
            const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
            const h = a * (1 - ty) + b * ty;
            // Inside OSM ocean: sea level (blended across the coastline pixel).
            // Without OSM ocean data, the elevation itself marks the sea, so the tile matches its neighbours.
            // Use mask availability at the point, so an unrelated missing coast tile cannot change a shared edge.
            const waterFraction = strict ? 0 : sea(fx + 0.5, fy + 0.5) ?? Number(h < SEA_BELOW_M);
            out[r * SIZE + c] = h * (1 - waterFraction);
          }
        }
        profAdd('terrain.resample', performance.now() - tRes);
        if (!oceanKnown) {
          seaStats.maskUnavailable++;
          seaStats.unavailableTiles.push(`${level}/${x}/${y}`);
          if (seaStats.unavailableTiles.length > 50) seaStats.unavailableTiles.shift();
        }
        if (strict) return { heights: out, water: null };
        const water = new Uint8Array(MASK * MASK);
        let any = 0;
        let all = 255;
        for (let r = 0; r < MASK; r++)
          for (let c = 0; c < MASK; c++) {
            const v = Math.round((sea(mpx[c], mpy[r]) ?? Number(at(mpx[c], mpy[r]) < SEA_BELOW_M)) * 255);
            water[r * MASK + c] = v;
            any |= v;
            all &= v === 255 ? 255 : 0;
          }
        if (oceanKnown) seaStats.maskedTiles++;
        return { heights: out, water: any === 0 ? new Uint8Array([0]) : all === 255 ? new Uint8Array([255]) : water };
      });
    },
  });
  return { provider, stats };
}
