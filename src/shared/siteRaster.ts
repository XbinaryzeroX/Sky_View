// Turns OpenStreetMap building footprints into the per-cell building heights the viewshed uses, and works out which
// web-map tiles a grid needs (so a tile that failed to load can be marked as unknown rather than as "no buildings").
import { cellCenter, toLocal, type Grid } from './viewshed';

/** Parts whose base is within this of the top below them count as stacked (OSM heights are rarely exact). */
const STACK_TOLERANCE_M = 0.5;

export interface Footprint {
  /** Outer ring first, then holes; [lon, lat]. */
  rings: [number, number][][];
  heightM: number;
  /** Height above ground where the part starts (OSM min_height): > 0 for bridges, overhangs and upper parts. */
  minHeightM?: number;
}

/**
 * Even-odd scanline fill of each footprint into `out` (row-major from the north-west corner): a cell belongs to a
 * footprint when its centre is inside it. The tallest building wins where footprints overlap. Cells whose value is NaN
 * (data unavailable) are left as they are. A mapped footprint without a usable height (heightM NaN) makes its cells
 * unknown rather than open ground.
 *
 * With `bases`, each cell keeps one occupied height interval [base, top]. Parts that touch or overlap in height are
 * merged (a tower on a podium is solid from the ground). Parts separated by open space (say 0–3 m and 10–20 m) cannot
 * be expressed as one interval, so that cell becomes unknown instead of an invented solid block.
 */
export function rasterizeFootprints(grid: Grid, footprints: readonly Footprint[], out: Float32Array, bases?: Float32Array, ids?: Int32Array): number {
  const n = grid.n;
  const half = (n - 1) / 2;
  let filled = 0;
  // Lowest parts first, so a part is compared with everything below it: it either continues the stack or leaves a gap.
  // ids (optional): per cell, the index in `footprints` of the part that sets the cell's top (-1 = none or unknown).
  const order = footprints.map((_, i) => i);
  if (bases) order.sort((a, b) => (footprints[a].minHeightM ?? 0) - (footprints[b].minHeightM ?? 0));
  for (const fi of order) {
    const f = footprints[fi];
    if (!f.rings.length || (!Number.isNaN(f.heightM) && !(f.heightM > 0))) continue;
    const rings = f.rings.map((r) => r.map(([lon, lat]) => {
      const p = toLocal(grid, lat, lon);
      return [p.x / grid.cellM + half, half - p.y / grid.cellM] as [number, number]; // [col, row] in cell units
    }));
    let minR = Infinity;
    let maxR = -Infinity;
    for (const [, r] of rings[0]) {
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    // Rows whose centre line crosses the footprint.
    const r0 = Math.max(0, Math.ceil(minR));
    const r1 = Math.min(n - 1, Math.floor(maxR));
    for (let row = r0; row <= r1; row++) {
      const xs: number[] = [];
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [ci, ri] = ring[i];
          const [cj, rj] = ring[j];
          if (ri > row !== rj > row) xs.push(ci + ((row - ri) * (cj - ci)) / (rj - ri));
        }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Columns whose centre lies between the two crossings.
        const c0 = Math.max(0, Math.ceil(xs[k]));
        const c1 = Math.min(n - 1, Math.floor(xs[k + 1]));
        for (let col = c0; col <= c1; col++) {
          const idx = row * n + col;
          const cur = out[idx];
          if (Number.isNaN(cur)) continue;
          if (Number.isNaN(f.heightM)) {
            out[idx] = Number.NaN;
            if (ids) ids[idx] = -1;
            continue;
          }
          const minH = Math.max(0, Math.min(f.minHeightM ?? 0, f.heightM));
          if (bases) {
            if (cur === 0) bases[idx] = minH;
            else if (minH > cur + STACK_TOLERANCE_M) {
              // Open space between this part and the ones below it: one interval cannot describe the cell.
              out[idx] = Number.NaN;
              if (ids) ids[idx] = -1;
              filled--;
              continue;
            }
          }
          if (cur === 0) filled++;
          if (f.heightM > cur) {
            out[idx] = f.heightM;
            if (ids) ids[idx] = fi;
          }
        }
      }
    }
  }
  return filled;
}

/**
 * The terrain source keeps sea-floor depths. For every cell below sea level: inside the mapped sea (`sea` > 0, ocean
 * polygons only) the surface is sea level; anywhere else (inland water or land below sea level, or sea data
 * unavailable = NaN) the surface cannot be established and the cell becomes unknown. Returns the number of sea cells.
 */
export function resolveBelowSeaLevel(ground: Float32Array, sea: Float32Array): number {
  let seaCells = 0;
  for (let k = 0; k < ground.length; k++) {
    if (!(ground[k] < 0)) continue;
    if (sea[k] > 0) {
      ground[k] = 0;
      seaCells++;
    } else ground[k] = Number.NaN;
  }
  return seaCells;
}

/** Web-map tile (x, y) containing a point at zoom z. */
export function tileOf(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const r = (lat * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
  return [x, y];
}

/** Every tile the grid's cells fall in, and the tile of each cell (as "x/y"). */
export function gridTiles(grid: Grid, z: number): { tiles: string[]; cellTile: string[] } {
  const cellTile: string[] = new Array(grid.n * grid.n);
  const tiles = new Set<string>();
  for (let row = 0; row < grid.n; row++)
    for (let col = 0; col < grid.n; col++) {
      const c = cellCenter(grid, row, col);
      const key = tileOf(c.lat, c.lon, z).join('/');
      cellTile[row * grid.n + col] = key;
      tiles.add(key);
    }
  return { tiles: [...tiles], cellTile };
}

/** Longitude/latitude of a point inside a vector tile (tile-local pixel coordinates). */
export function tilePointToLonLat(z: number, tx: number, ty: number, px: number, py: number, extent: number): [number, number] {
  const n = 2 ** z;
  const lon = ((tx + px / extent) / n) * 360 - 180;
  const yy = (ty + py / extent) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
  return [lon, lat];
}

/**
 * Building heights on a grid four times finer than `grid` (same centre and extent between outer cell centres), from
 * the footprints, for drawing the coverage picture: shadow edges then follow building outlines to about a metre
 * instead of the analysis cell size. Where the coarse grid has no building data (a tile that failed), the fine cells
 * are unknown too.
 */
export function fineBuildings(grid: Grid, coarse: Float32Array, footprints: readonly Footprint[]): { grid: Grid; buildings: Float32Array; bases: Float32Array } {
  const f = 4;
  const fineGrid: Grid = { lat: grid.lat, lon: grid.lon, cellM: grid.cellM / f, n: f * (grid.n - 1) + 1 };
  const nf = fineGrid.n;
  const buildings = new Float32Array(nf * nf);
  const bases = new Float32Array(nf * nf);
  const half = (grid.n - 1) / 2;
  const halfF = (nf - 1) / 2;
  for (let row = 0; row < nf; row++)
    for (let col = 0; col < nf; col++) {
      // The coarse cell containing this fine cell's centre.
      const cr = Math.round(half + (row - halfF) / f);
      const cc = Math.round(half + (col - halfF) / f);
      if (Number.isNaN(coarse[cr * grid.n + cc])) buildings[row * nf + col] = Number.NaN;
    }
  rasterizeFootprints(fineGrid, footprints, buildings, bases);
  return { grid: fineGrid, buildings, bases };
}
