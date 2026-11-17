// Gathers the geometry a coverage analysis can honestly use for one site: terrain heights from the app's own
// terrain source (sampled independently of the terrain display setting, strict: a missing tile is "no data", never
// sea level) and OpenStreetMap building heights from the same vector tiles that draw the 3D buildings. Google
// Photorealistic tiles are not used: their mesh is display-only here.
import { Cartographic, sampleTerrain } from 'cesium';
import { classifyRings } from '@mapbox/vector-tile';
import { gridTiles, rasterizeFootprints, resolveBelowSeaLevel, tilePointToLonLat, type Footprint } from '../../shared/siteRaster';
import { cellCenter, MAX_SOURCE_LAT, type Grid } from '../../shared/viewshed';
import { SOURCES } from '../../shared/protectivePlan';
import { createTerrariumTerrain } from './terrain';
import { loadVectorTile } from './vectorTiles';

const BUILDING_Z = 14;
const TERRAIN_BATCH = 4000;

let sampler: ReturnType<typeof createTerrariumTerrain>['provider'] | null = null;

export interface SiteGeometry {
  grid: Grid;
  ground: Float32Array;
  buildings: Float32Array;
  /** Lowest occupied height of the building parts per cell (see ViewshedInput.bases). */
  bases: Float32Array;
  /** Per cell, the index in `footprints` of the part that sets the roof (-1 = none or unknown). */
  ids: Int32Array;
  /** Outer rings ([lon, lat]) and heights of the mapped building parts that were loaded, for drawing outlines. */
  footprints: { ring: [number, number][]; heightM: number; rings: [number, number][][]; minHeightM: number }[];
  info: {
    terrain: { source: string; level: number; missingCells: number };
    buildings: { source: string; tilesLoaded: number; tilesFailed: number; buildingCells: number };
  };
}

export interface LoadProgress {
  stage: 'terrain' | 'buildings';
  done: number;
  total: number;
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
}

/** Terrain height (m) at a point from the analysis terrain source, or null when it is unavailable there. */
export async function groundHeightAt(lat: number, lon: number): Promise<number | null> {
  if (Math.abs(lat) > MAX_SOURCE_LAT) return null;
  try {
    // The same surface the analysis uses (a one-cell grid): mapped sea is sea level, not the sea floor; anything
    // else below sea level, or without data, is unavailable.
    const geo = await loadSiteGeometry({ lat, lon, cellM: 2, n: 1 });
    return Number.isFinite(geo.ground[0]) ? geo.ground[0] : null;
  } catch {
    return null;
  }
}

/** Geographic terrain level: ~10 m post spacing at 15, ~5 m (resampled from the zoom-15 source) at 16. */
export function terrainLevelFor(cellM: number): number {
  return cellM < 7 ? 16 : 15;
}

export async function loadSiteGeometry(grid: Grid, opts: { signal?: AbortSignal; onProgress?: (p: LoadProgress) => void } = {}): Promise<SiteGeometry> {
  const cells = grid.n * grid.n;
  const ground = new Float32Array(cells).fill(Number.NaN);
  const buildings = new Float32Array(cells);
  const level = terrainLevelFor(grid.cellM);
  sampler ??= createTerrariumTerrain({ strict: true }).provider;

  // Terrain, in batches so progress and cancellation stay responsive.
  const cartos: Cartographic[] = [];
  for (let row = 0; row < grid.n; row++)
    for (let col = 0; col < grid.n; col++) {
      const c = cellCenter(grid, row, col);
      cartos.push(Cartographic.fromDegrees(c.lon, c.lat));
    }
  // Cells beyond the sources' coverage stay unknown (the terrain provider would otherwise extend its last row).
  const covered = (k: number) => Math.abs(cellCenter(grid, Math.floor(k / grid.n), k % grid.n).lat) <= MAX_SOURCE_LAT;
  for (let i = 0; i < cartos.length; i += TERRAIN_BATCH) {
    check(opts.signal);
    const batch = cartos.slice(i, i + TERRAIN_BATCH);
    let sampled: Cartographic[] = [];
    try {
      sampled = await sampleTerrain(sampler, level, batch);
    } catch {
      sampled = []; // the whole batch stays "no data"
    }
    sampled.forEach((c, j) => {
      if (c && Number.isFinite(c.height) && covered(i + j)) ground[i + j] = c.height;
    });
    opts.onProgress?.({ stage: 'terrain', done: Math.min(cartos.length, i + TERRAIN_BATCH), total: cartos.length });
  }
  let missingCells = 0;

  check(opts.signal);
  // Buildings: a tile that cannot be loaded makes its cells "unknown", not "no buildings".
  const { tiles, cellTile } = gridTiles(grid, BUILDING_Z);
  const failed = new Set<string>();
  const footprints: Footprint[] = [];
  const waterAreas: Footprint[] = [];
  let done = 0;
  await Promise.all(
    tiles.map(async (key) => {
      const [tx, ty] = key.split('/').map(Number);
      try {
        const vt = await loadVectorTile(BUILDING_Z, tx, ty);
        check(opts.signal);
        const layer = vt.layers.building;
        if (layer)
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            if (f.type !== 3 || f.properties.hide_3d === true) continue;
            const raw = Number(f.properties.render_height);
            // A mapped building without a usable height is unknown, never open ground.
            const h = Number.isFinite(raw) && raw > 0 ? raw : Number.NaN;
            const min = Number(f.properties.render_min_height);
            for (const poly of classifyRings(f.loadGeometry())) {
              const rings = poly.map((ring) => ring.map((p) => tilePointToLonLat(BUILDING_Z, tx, ty, p.x, p.y, layer.extent)));
              if (rings[0].length >= 4) footprints.push({ rings, heightM: h, minHeightM: Number.isFinite(min) && min > 0 ? min : 0 });
            }
          }
        // Mapped sea (OpenMapTiles water class "ocean"): its surface is sea level, not the sea floor the terrain
        // source reports. Lakes and rivers are not used: their surface height is not known from this data.
        const water = vt.layers.water;
        if (water)
          for (let i = 0; i < water.length; i++) {
            const f = water.feature(i);
            if (f.type !== 3 || f.properties.class !== 'ocean') continue;
            for (const poly of classifyRings(f.loadGeometry())) {
              const rings = poly.map((ring) => ring.map((p) => tilePointToLonLat(BUILDING_Z, tx, ty, p.x, p.y, water.extent)));
              if (rings[0].length >= 4) waterAreas.push({ rings, heightM: 1 });
            }
          }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        failed.add(key);
      } finally {
        opts.onProgress?.({ stage: 'buildings', done: ++done, total: tiles.length });
      }
    }),
  );
  check(opts.signal);
  for (let k = 0; k < cells; k++) if (failed.has(cellTile[k]) || !covered(k)) buildings[k] = Number.NaN;
  const bases = new Float32Array(cells);
  const ids = new Int32Array(cells).fill(-1);
  const buildingCells = rasterizeFootprints(grid, footprints, buildings, bases, ids);
  // The terrain source keeps sea-floor depths. Below sea level: inside the mapped sea the surface is sea level;
  // elsewhere (inland water or land below sea level, or sea data unavailable) the surface cannot be established from
  // this data, so it is unknown.
  const water = new Float32Array(cells);
  for (let k = 0; k < cells; k++) if (failed.has(cellTile[k]) || !covered(k)) water[k] = Number.NaN;
  rasterizeFootprints(grid, waterAreas, water);
  resolveBelowSeaLevel(ground, water);
  missingCells = 0;
  for (let k = 0; k < cells; k++) if (!Number.isFinite(ground[k])) missingCells++;
  return {
    grid,
    ground,
    bases,
    buildings,
    ids,
    footprints: footprints.map((f) => ({ ring: f.rings[0], heightM: f.heightM, rings: f.rings, minHeightM: f.minHeightM ?? 0 })),
    info: {
      terrain: { source: SOURCES.terrain, level, missingCells },
      buildings: { source: SOURCES.buildings, tilesLoaded: tiles.length - failed.size, tilesFailed: failed.size, buildingCells },
    },
  };
}
