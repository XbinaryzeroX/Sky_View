// Geometric line-of-sight ("viewshed") over a local grid, for protective planning.
//
// Inputs are what the app can actually model: a terrain height per cell (metres above sea level, NaN where the terrain
// source had no data) and an OpenStreetMap building height per cell (metres above ground; 0 = no mapped building;
// NaN = building data could not be loaded for that cell). Vegetation, walls, vehicles, glazing and buildings that are
// missing from OpenStreetMap are NOT modelled. A result is a geometric estimate from that data, never proof that a
// place is (or is not) seen.
//
// Classes: OUT (not analysed), VISIBLE, BLOCKED (known geometry blocks the sight line), UNKNOWN (data needed to decide
// is missing: no terrain at the target, or a sight line crossing cells whose terrain or building data is unavailable,
// with nothing known blocking it first). Unknown is never reported as visible or as safe.

export const OUT = 0;
export const VISIBLE = 1;
export const BLOCKED = 2;
export const UNKNOWN = 3;
export type CellClass = typeof OUT | typeof VISIBLE | typeof BLOCKED | typeof UNKNOWN;

/** Earth radius (m) and the standard refraction coefficient used for long sight lines. */
const EARTH_R = 6_371_008.8;
const REFRACTION_K = 0.13;
/** Largest grid side (cells); keeps one analysis well under a second in a worker. */
export const MAX_GRID = 401;
export const MIN_CELL_M = 2;
export const MAX_RADIUS_M = 5000;
/** Terrain and building sources are Web Mercator tiles, which end at about ±85.05°. */
export const MAX_SOURCE_LAT = 85.05;

export interface Grid {
  /** Centre of the grid. */
  lat: number;
  lon: number;
  cellM: number;
  /** Cells per side (odd); cell (0,0) is the north-west corner. */
  n: number;
}

export interface Observer {
  lat: number;
  lon: number;
  /** Eye or lens height above the surface under it (the roof, when it stands on a mapped building). */
  heightM: number;
  /** Analysis radius around this observer. */
  rangeM: number;
  /** Viewing direction (degrees clockwise from north) and field of view; null = all directions. */
  headingDeg: number | null;
  fovDeg: number | null;
}

export interface ViewshedInput {
  grid: Grid;
  /** Terrain height (m above sea level) per cell, row-major from the north-west corner; NaN = no data. */
  ground: Float32Array;
  /** Building height above ground per cell; 0 = none mapped; NaN = building data unavailable there. */
  buildings: Float32Array;
  /**
   * Lowest occupied height above ground of the mapped building parts in each cell (an elevated part such as a bridge
   * leaves a passage underneath). Absent or 0 = solid from the ground.
   */
  bases?: Float32Array;
  observer: Observer;
  /** Height of the target above the surface (e.g. 1.7 m for a standing person; on roofs, above the roof). */
  targetHeightM: number;
  /** Only cells with a non-zero entry are analysed (the rest stay OUT); absent = every cell in range. */
  mask?: Uint8Array;
  /**
   * Targets on roofs stand at the roof edge facing the observer instead of mid-cell, so a roof cell is not hidden by
   * its own wall (used for rooftop checks: someone at the parapet can look down).
   */
  edgeTargets?: boolean;
}

export interface ViewshedResult {
  classes: Uint8Array;
  counts: { visible: number; blocked: number; unknown: number; analysed: number };
  /** Set when nothing could be analysed (e.g. no terrain at the observer). */
  error: string | null;
}

/** Cells per side for a radius and cell size (odd, capped). */
export function gridSize(radiusM: number, cellM: number): number {
  const half = Math.ceil(radiusM / cellM);
  return Math.min(MAX_GRID, 2 * half + 1);
}

/** Smallest cell size that keeps a radius inside MAX_GRID. */
export function minCellFor(radiusM: number): number {
  return Math.max(MIN_CELL_M, Math.ceil(((2 * radiusM) / (MAX_GRID - 1)) * 10) / 10);
}

const M_PER_DEG = 111_320;

/** Local east/north metres of a point from the grid centre (equirectangular; fine for ≤ 5 km). */
export function toLocal(grid: Grid, lat: number, lon: number): { x: number; y: number } {
  // Shortest way round in longitude, so a site near the 180° meridian sees points just across it as near.
  const dLon = ((((lon - grid.lon + 180) % 360) + 360) % 360) - 180;
  return { x: dLon * M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180), y: (lat - grid.lat) * M_PER_DEG };
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * A segment in local metres: its second point follows the first the short way round in longitude (so a segment
 * crossing the 180° meridian stays short), and the whole segment is placed on the world copy nearest the grid.
 */
export function localSegment(grid: Grid, p0: readonly [number, number], p1: readonly [number, number]): { a: { x: number; y: number }; b: { x: number; y: number } } {
  let ax = wrap180(p0[0] - grid.lon);
  let bx = ax + wrap180(p1[0] - p0[0]);
  const shift = -360 * Math.round((ax + bx) / 2 / 360);
  ax += shift;
  bx += shift;
  const k = M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180);
  return { a: { x: ax * k, y: (p0[1] - grid.lat) * M_PER_DEG }, b: { x: bx * k, y: (p1[1] - grid.lat) * M_PER_DEG } };
}

/** Longitude offsets (degrees) of a path from `lon0`, continuous along the path, starting on the nearest world copy. */
export function unwrapLonOffsets(points: readonly (readonly [number, number])[], lon0: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) out.push(i === 0 ? wrap180(points[0][0] - lon0) : out[i - 1] + wrap180(points[i][0] - points[i - 1][0]));
  return out;
}

/** Great-circle distance in metres (the same model the route length uses). */
function geodesicM(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6_371_008.8;
  const p1 = (a[1] * Math.PI) / 180;
  const p2 = (b[1] * Math.PI) / 180;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Latitude/longitude of a cell centre. */
export function cellCenter(grid: Grid, row: number, col: number): { lat: number; lon: number } {
  const half = (grid.n - 1) / 2;
  const x = (col - half) * grid.cellM;
  const y = (half - row) * grid.cellM;
  return { lat: grid.lat + y / M_PER_DEG, lon: grid.lon + x / (M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180)) };
}

/** Outer edges of the grid (for draping the result image). */
export function gridBounds(grid: Grid): { west: number; south: number; east: number; north: number } {
  const halfM = (grid.n * grid.cellM) / 2;
  const dLat = halfM / M_PER_DEG;
  const dLon = halfM / (M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180));
  return { west: grid.lon - dLon, south: grid.lat - dLat, east: grid.lon + dLon, north: grid.lat + dLat };
}

/** Row/column of the cell containing local metres (x east, y north), or null outside the grid. */
export function cellAt(grid: Grid, x: number, y: number): { row: number; col: number } | null {
  const half = (grid.n - 1) / 2;
  const col = Math.round(x / grid.cellM + half);
  const row = Math.round(half - y / grid.cellM);
  return row >= 0 && col >= 0 && row < grid.n && col < grid.n ? { row, col } : null;
}

/** Curvature drop with refraction over a distance (m). */
function drop(d: number): number {
  return ((1 - REFRACTION_K) * d * d) / (2 * EARTH_R);
}

/** Whether a direction (degrees from north, x east / y north) is inside an observer's field of view. */
export function inFieldOfView(o: Pick<Observer, 'headingDeg' | 'fovDeg'>, x: number, y: number): boolean {
  if (o.headingDeg === null || o.fovDeg === null || o.fovDeg >= 360) return true;
  const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  let diff = Math.abs(bearing - (((o.headingDeg % 360) + 360) % 360));
  if (diff > 180) diff = 360 - diff;
  return diff <= o.fovDeg / 2;
}

/** Marks every cell in an observer's range and field of view as UNKNOWN (used when nothing can be modelled from it). */
function unknownArea(grid: Grid, observer: Observer, classes: Uint8Array, counts: ViewshedResult['counts'], error: string): ViewshedResult {
  const o = toLocal(grid, observer.lat, observer.lon);
  const half = (grid.n - 1) / 2;
  const range2 = observer.rangeM * observer.rangeM;
  for (let row = 0; row < grid.n; row++)
    for (let col = 0; col < grid.n; col++) {
      const x = (col - half) * grid.cellM - o.x;
      const y = (half - row) * grid.cellM - o.y;
      if (x * x + y * y > range2 || !inFieldOfView(observer, x, y)) continue;
      classes[row * grid.n + col] = UNKNOWN;
      counts.analysed++;
      counts.unknown++;
    }
  return { classes, counts, error };
}

export function computeViewshed(input: ViewshedInput, shouldStop?: () => boolean): ViewshedResult {
  const { grid, ground, buildings, observer } = input;
  const n = grid.n;
  const classes = new Uint8Array(n * n);
  const counts = { visible: 0, blocked: 0, unknown: 0, analysed: 0 };
  if (ground.length !== n * n || buildings.length !== n * n) throw new Error('Height grids do not match the analysis grid.');
  const o = toLocal(grid, observer.lat, observer.lon);
  const oc = cellAt(grid, o.x, o.y);
  if (!oc) return unknownArea(grid, observer, classes, counts, 'The observation point is outside the analysis area, so its sight lines were not sampled; enlarge the radius or move the point.');
  const ok = oc.row * n + oc.col;
  // A point that cannot be modelled leaves everything it might see as unknown (never as a gap for other points).
  if (!Number.isFinite(ground[ok])) return unknownArea(grid, observer, classes, counts, 'No terrain data at the observation point; nothing can be modelled from it.');
  // Standing on a mapped roof puts the eye above the roof. Unknown building data there means the eye height itself is
  // unknown, so nothing can be modelled from this point.
  if (!Number.isFinite(buildings[ok])) return unknownArea(grid, observer, classes, counts, 'Building data is unavailable at the observation point, so its height is unknown; nothing can be modelled from it.');
  const baseAt = (kk: number) => {
    const v = input.bases ? input.bases[kk] : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  // Under or on an elevated part (a bridge, an overhang) the standing height is ambiguous.
  if (buildings[ok] > 0 && baseAt(ok) > 0) return unknownArea(grid, observer, classes, counts, 'The observation point is under an elevated building part (bridge or overhang), so whether it stands below or on top is ambiguous.');
  const eye = ground[ok] + buildings[ok] + observer.heightM;
  const half = (n - 1) / 2;
  /** Terrain at a point in cell coordinates (column, row), bilinear between cell centres; the cell's own value where a neighbour has no data. */
  const groundBetween = (col: number, row: number, own: number): number => {
    const c0 = Math.min(n - 2, Math.max(0, Math.floor(col)));
    const r0 = Math.min(n - 2, Math.max(0, Math.floor(row)));
    const tx = Math.min(1, Math.max(0, col - c0));
    const ty = Math.min(1, Math.max(0, row - r0));
    const v = (ground[r0 * n + c0] * (1 - tx) + ground[r0 * n + c0 + 1] * tx) * (1 - ty) + (ground[(r0 + 1) * n + c0] * (1 - tx) + ground[(r0 + 1) * n + c0 + 1] * tx) * ty;
    return Number.isFinite(v) ? v : own;
  };
  const range2 = observer.rangeM * observer.rangeM;
  for (let row = 0; row < n; row++) {
    if (shouldStop?.()) throw new Error('cancelled');
    for (let col = 0; col < n; col++) {
      const k = row * n + col;
      if (input.mask && !input.mask[k]) continue; // OUT: not asked for
      const x = (col - half) * grid.cellM - o.x;
      const y = (half - row) * grid.cellM - o.y;
      const d2 = x * x + y * y;
      if (d2 > range2 || !inFieldOfView(observer, x, y)) continue; // OUT
      counts.analysed++;
      if (k === ok) {
        classes[k] = VISIBLE;
        counts.visible++;
        continue;
      }
      const tg = ground[k];
      const tb = buildings[k];
      // No terrain, or a target whose roof height is unknown (an unknown roof could rise above any blocker): unknown.
      // ... and a target under an elevated part is ambiguous (below it or on it).
      if (!Number.isFinite(tg) || !Number.isFinite(tb) || (tb > 0 && baseAt(k) > 0)) {
        classes[k] = UNKNOWN;
        counts.unknown++;
        continue;
      }
      const D = Math.sqrt(d2);
      const target = tg + tb + input.targetHeightM - drop(D);
      const targetSlope = (target - eye) / D;
      let blocked = false;
      let unknown = false;
      // Walk every cell the sight line passes through (grid traversal, so cells clipped at a corner are not skipped)
      // and test each over the part of the line inside it: the cell blocks if its surface rises above the line to the
      // target anywhere in that interval (checked at both ends, where the elevation angle is largest).
      const ox = o.x / grid.cellM + half;
      const oy = half - o.y / grid.cellM;
      const dx = col - ox;
      const dy = row - oy;
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      let cx = oc.col;
      let cy = oc.row;
      let tMaxX = stepX ? (cx + 0.5 * stepX - ox) / dx : Infinity;
      let tMaxY = stepY ? (cy + 0.5 * stepY - oy) / dy : Infinity;
      const tDeltaX = stepX ? Math.abs(1 / dx) : Infinity;
      const tDeltaY = stepY ? Math.abs(1 / dy) : Infinity;
      let tEnter = 0;
      for (let guard = 0; guard < 4 * n + 4; guard++) {
        const tExit = Math.min(tMaxX, tMaxY, 1);
        const kk = cy * n + cx;
        if (kk === k) {
          // The target cell: a target on a roof is hidden when the line enters the cell below the roof (through the
          // building's own wall). Terrain is not tested here: within one cell it is a single height.
          if (tb > 0 && !input.edgeTargets) {
            const d = Math.max(tEnter * D, 1e-6);
            if (eye + targetSlope * d + drop(d) < tg + tb) blocked = true;
          }
          break;
        }
        if (kk === ok) {
          // The observer cell: from a roof, a line that leaves the cell below the roof edge passes through the
          // building under the observer.
          if (buildings[ok] > 0) {
            const d = Math.max(tExit * D, 1e-6);
            if (eye + targetSlope * d + drop(d) < ground[ok] + buildings[ok]) {
              blocked = true;
              break;
            }
          }
        } else {
          if (cy < 0 || cx < 0 || cy >= n || cx >= n) unknown = true;
          else {
            const g = ground[kk];
            const b = buildings[kk];
            if (!Number.isFinite(g)) unknown = true;
            else {
              // Occupied vertical interval of the cell: terrain up to the ground, and the building from its base to
              // its top (a base above 0 is an open passage). The line is blocked where it is inside either one, or
              // where it crosses the building interval from above to below (or back) inside the cell.
              const bTop = Number.isFinite(b) ? b : 0;
              const bBase = bTop > 0 ? baseAt(kk) : 0;
              const side: number[] = [];
              for (const t of [tEnter, tExit]) {
                const d = Math.max(t * D, 1e-6);
                const ray = eye + targetSlope * d + drop(d); // line height relative to the curved surface
                // Open ground between cell centres is interpolated, so a line grazing a slope is not blocked by the
                // step a flat-topped cell would make. Building cells keep their own ground (the building stands on it).
                const gH = bTop > 0 ? g : groundBetween(ox + dx * t, oy + dy * t, g);
                const top = g + bTop;
                const base = g + bBase;
                if (ray < gH || (bTop > 0 && ray < top && ray > base)) {
                  blocked = true;
                  break;
                }
                side.push(bTop > 0 ? (ray >= top ? 1 : ray <= base ? -1 : 0) : 1);
              }
              if (!blocked && side.length === 2 && side[0] * side[1] < 0) blocked = true;
              if (blocked) break;
              if (!Number.isFinite(b)) unknown = true;
            }
          }
        }
        if (tExit >= 1) break;
        if (tMaxX < tMaxY) {
          cx += stepX;
          tEnter = tMaxX;
          tMaxX += tDeltaX;
        } else {
          cy += stepY;
          tEnter = tMaxY;
          tMaxY += tDeltaY;
        }
      }
      const cls = blocked ? BLOCKED : unknown ? UNKNOWN : VISIBLE;
      classes[k] = cls;
      if (cls === VISIBLE) counts.visible++;
      else if (cls === BLOCKED) counts.blocked++;
      else counts.unknown++;
    }
  }
  return { classes, counts, error: null };
}

export interface CombinedResult {
  /** Per cell: 0 = not analysed by any observer; otherwise COMBINED_* below. */
  classes: Uint8Array;
  /** Number of observers that can see each cell. */
  seenBy: Uint8Array;
  counts: { covered: number; overlap: number; gap: number; unknown: number; analysed: number };
}
export const COMBINED_OUT = 0;
export const COMBINED_COVERED = 1;
export const COMBINED_OVERLAP = 2;
export const COMBINED_GAP = 3;
export const COMBINED_UNKNOWN = 4;

/**
 * Coverage from several observation points: covered (seen by one), overlap (two or more), gap (analysed, every
 * observer is blocked there by known geometry) and unknown (no observer sees it and at least one lacks the data to
 * decide). A gap is a modelled blind spot, not a statement that the place is safe or unsafe.
 */
export function combineViewsheds(results: readonly Uint8Array[], cells: number): CombinedResult {
  const classes = new Uint8Array(cells);
  const seenBy = new Uint8Array(cells);
  const counts = { covered: 0, overlap: 0, gap: 0, unknown: 0, analysed: 0 };
  for (let k = 0; k < cells; k++) {
    let seen = 0;
    let unknown = false;
    let analysed = false;
    for (const r of results) {
      const c = r[k];
      if (c === OUT) continue;
      analysed = true;
      if (c === VISIBLE) seen++;
      else if (c === UNKNOWN) unknown = true;
    }
    if (!analysed) continue;
    counts.analysed++;
    seenBy[k] = Math.min(255, seen);
    if (seen >= 2) {
      classes[k] = COMBINED_OVERLAP;
      counts.overlap++;
    } else if (seen === 1) {
      classes[k] = COMBINED_COVERED;
      counts.covered++;
    } else if (unknown) {
      classes[k] = COMBINED_UNKNOWN;
      counts.unknown++;
    } else {
      classes[k] = COMBINED_GAP;
      counts.gap++;
    }
  }
  return { classes, seenBy, counts };
}

/** Colour-blind-safe palette (Okabe–Ito) with alpha, RGBA 0–255. Unknown is drawn as a grey checker. */
export const COVERAGE_COLORS: Record<number, [number, number, number, number]> = {
  [COMBINED_COVERED]: [86, 180, 233, 140],
  [COMBINED_OVERLAP]: [0, 114, 178, 170],
  [COMBINED_GAP]: [230, 159, 0, 150],
  [COMBINED_UNKNOWN]: [160, 160, 160, 120],
};

/** RGBA pixels (one per cell) for the combined result. */
export function coverageRgba(c: CombinedResult, n: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const cls = c.classes[k];
    if (cls === COMBINED_OUT) continue;
    const [r, g, b, a] = COVERAGE_COLORS[cls];
    // Unknown: checker pattern, so it reads as "no data" rather than as a colour class.
    const row = Math.floor(k / n);
    const col = k % n;
    const alpha = cls === COMBINED_UNKNOWN ? ((row + col) % 2 === 0 ? a : Math.round(a / 3)) : a;
    out.set([r, g, b, alpha], k * 4);
  }
  return out;
}

export interface PathCoverage {
  lengthM: number;
  /** Shares of the sampled path (0–1). */
  covered: number;
  gap: number;
  unknown: number;
  outside: number;
}

/** How much of a path (lon/lat points) lies in covered, gap, unknown or unanalysed cells. */
/** Parameter range [t0, t1] of segment a→b inside the square |x|,|y| ≤ h, or null when it misses the square. */
export function clipToSquare(ax: number, ay: number, bx: number, by: number, h: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [[-dx, ax + h], [dx, h - ax], [-dy, ay + h], [dy, h - ay]] as [number, number][]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t1 > t0 ? [t0, t1] : null;
}

export function pathCoverage(grid: Grid, combined: CombinedResult, points: readonly [number, number][]): PathCoverage {
  // Shares of length, not of sample counts: each sample stands for its piece of the segment.
  const tally = { covered: 0, gap: 0, unknown: 0, outside: 0 };
  let lengthM = 0;
  for (let i = 1; i < points.length; i++) {
    const { a, b } = localSegment(grid, points[i - 1], points[i]);
    // Lengths are geodesic; the local projection only decides which part of the segment lies in which cells.
    const seg = geodesicM(points[i - 1], points[i]);
    if (!(seg > 0) || !(Math.hypot(b.x - a.x, b.y - a.y) > 0)) continue; // repeated vertices add nothing
    lengthM += seg;
    // Clip to the grid square (Liang–Barsky): work is bounded by the grid, however far a vertex lies.
    const clip = clipToSquare(a.x, a.y, b.x, b.y, (grid.n * grid.cellM) / 2);
    if (!clip) {
      tally.outside += seg;
      continue;
    }
    const [t0, t1] = clip;
    tally.outside += seg * (1 - (t1 - t0));
    const inside = seg * (t1 - t0);
    const parts = Math.max(1, Math.ceil(inside / (grid.cellM / 2)));
    const w = inside / parts;
    for (let s = 0; s < parts; s++) {
      const t = t0 + ((s + 0.5) / parts) * (t1 - t0);
      const cell = cellAt(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      const cls = cell ? combined.classes[cell.row * grid.n + cell.col] : COMBINED_OUT;
      if (cls === COMBINED_COVERED || cls === COMBINED_OVERLAP) tally.covered += w;
      else if (cls === COMBINED_GAP) tally.gap += w;
      else if (cls === COMBINED_UNKNOWN) tally.unknown += w;
      else tally.outside += w;
    }
  }
  const share = (v: number) => (lengthM ? v / lengthM : 0);
  return { lengthM, covered: share(tally.covered), gap: share(tally.gap), unknown: share(tally.unknown), outside: share(tally.outside) };
}

// ------------------------------------------------------------------ fine display image
//
// Coverage results (picture, shares and route shares) are traced as a fan of sight lines from each observer, at a
// quarter-cell step along each ray and a spacing between rays no wider than that at the edge of the range, against
// terrain interpolated between cell centres and buildings rasterised at a quarter cell from their outlines. A shadow's
// side edge then runs along the actual line from the observer past the blocking corner, not along a staircase of whole
// cells, and the range circle and field-of-view edges are exact. Measured in central Helsinki, the cell model above
// called 15.1% of the area clear where this trace finds 19.1%: a line that only clips the corner of a 4 m cell counts
// there as blocked by the whole cell. Where a ray passes an elevated building part (a bridge or overhang), or nothing
// can be traced from the point, the cell result is used instead.

export interface DisplayAccumulator {
  grid: Grid;
  /** The picture as a grid of its own (odd pixels per side, same centre and extent), for path shares. */
  pictureGrid: Grid;
  /** Pixels per side of the image covering the whole grid. */
  size: number;
  /** Observers with a clear line to each pixel (capped at 255). */
  seen: Uint8Array;
  /** 1 = analysed by some observer; 2 = also unknown for at least one. */
  state: Uint8Array;
}

export function displayAccumulator(grid: Grid, maxPixels = 1200): DisplayAccumulator {
  // An odd factor keeps the pixel count odd, so the picture is itself a centred grid.
  let factor = Math.max(1, Math.floor(maxPixels / grid.n));
  if (factor % 2 === 0) factor--;
  const size = grid.n * factor;
  return { grid, pictureGrid: { lat: grid.lat, lon: grid.lon, cellM: grid.cellM / factor, n: size }, size, seen: new Uint8Array(size * size), state: new Uint8Array(size * size) };
}

/** Upper bounds on rays and samples per ray for one observer (memory and time stay bounded at 5 km). */
const MAX_RAYS = 8192;
const MAX_STEPS = 1600;

/**
 * Traces one observer's sight lines as a fan of rays and adds them to the display image. `cells` is this observer's
 * cell-grid result (used where a ray passes an elevated building part, and when nothing can be traced from the point).
 */
export function addObserverToDisplay(acc: DisplayAccumulator, input: ViewshedInput, cells: Uint8Array, fine?: { grid: Grid; buildings: Float32Array; bases: Float32Array }): ViewshedResult['counts'] {
  const counts = { visible: 0, blocked: 0, unknown: 0, analysed: 0 };
  const { grid, ground, buildings, observer } = input;
  const n = grid.n;
  const nf = fine?.grid.n ?? 0;
  const halfC = (n - 1) / 2;
  /**
   * Surface at a point: terrain interpolated between cell centres (no steps on slopes; NaN when a neighbour has no
   * data) and the building from the fine raster when there is one, else from the cell.
   */
  const surface = (x: number, y: number, k: number): { g: number; b: number; base: number } => {
    const fx = x / grid.cellM + halfC;
    const fy = halfC - y / grid.cellM;
    const c0 = Math.min(n - 2, Math.max(0, Math.floor(fx)));
    const r0 = Math.min(n - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - c0));
    const ty = Math.min(1, Math.max(0, fy - r0));
    const g00 = ground[r0 * n + c0];
    const g01 = ground[r0 * n + c0 + 1];
    const g10 = ground[(r0 + 1) * n + c0];
    const g11 = ground[(r0 + 1) * n + c0 + 1];
    let g = (g00 * (1 - tx) + g01 * tx) * (1 - ty) + (g10 * (1 - tx) + g11 * tx) * ty;
    if (!Number.isFinite(g)) g = ground[k];
    if (fine) {
      const fc = cellAt(fine.grid, x, y);
      if (fc) {
        const fk = fc.row * nf + fc.col;
        const fb = fine.bases[fk];
        return { g, b: fine.buildings[fk], base: Number.isFinite(fb) && fb > 0 ? fb : 0 };
      }
    }
    return { g, b: buildings[k], base: baseAt(k) };
  };
  const o = toLocal(grid, observer.lat, observer.lon);
  const oc = cellAt(grid, o.x, o.y);
  const baseAt = (k: number) => {
    const v = input.bases ? input.bases[k] : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const ok = oc ? oc.row * n + oc.col : -1;
  const traceable = ok >= 0 && Number.isFinite(ground[ok]) && Number.isFinite(buildings[ok]) && !(buildings[ok] > 0 && baseAt(ok) > 0);
  const range = observer.rangeM;
  const step = grid.cellM / 4;
  const steps = Math.max(1, Math.min(MAX_STEPS, Math.floor(range / step)));
  const rStep = range / steps;
  const rays = Math.max(360, Math.min(MAX_RAYS, Math.ceil((2 * Math.PI * range) / rStep)));
  const polar = traceable ? new Uint8Array(rays * steps) : null;
  if (polar) {
    const eye = ground[ok] + buildings[ok] + observer.heightM;
    for (let a = 0; a < rays; a++) {
      const th = (2 * Math.PI * a) / rays;
      const sx = Math.sin(th);
      const sy = Math.cos(th);
      if (!inFieldOfView(observer, sx, sy)) continue;
      let maxSlope = -Infinity;
      let unknown = false;
      let passage = false;
      for (let s = 1; s <= steps; s++) {
        const d = s * rStep;
        const c = cellAt(grid, o.x + sx * d, o.y + sy * d);
        const at = a * steps + s - 1;
        if (!c) {
          // Beyond the grid the data is not loaded: unknown, as on the cell grid.
          polar.fill(UNKNOWN, at, a * steps + steps);
          break;
        }
        const k = c.row * n + c.col;
        const { g, b, base } = surface(o.x + sx * d, o.y + sy * d, k);
        const dd = drop(d);
        let cls: number;
        if (!Number.isFinite(g) || !Number.isFinite(b) || (b > 0 && base > 0)) cls = UNKNOWN;
        else {
          const slope = (g + b + input.targetHeightM - dd - eye) / d;
          cls = slope < maxSlope ? BLOCKED : passage ? cells[k] || UNKNOWN : unknown ? UNKNOWN : VISIBLE;
        }
        polar[at] = cls;
        // This point's surface now stands between the observer and everything further out on the ray.
        if (!Number.isFinite(g)) unknown = true;
        else if (b > 0 && base > 0) passage = true;
        else {
          maxSlope = Math.max(maxSlope, (g + (Number.isFinite(b) ? b : 0) - dd - eye) / d);
          if (!Number.isFinite(b)) unknown = true;
        }
      }
    }
  }
  const S = acc.size;
  const span = n * grid.cellM;
  const range2 = range * range;
  for (let py = 0; py < S; py++) {
    const y = span / 2 - ((py + 0.5) / S) * span;
    for (let px = 0; px < S; px++) {
      const x = ((px + 0.5) / S) * span - span / 2;
      const dx = x - o.x;
      const dy = y - o.y;
      const r2 = dx * dx + dy * dy;
      if (r2 > range2 || !inFieldOfView(observer, dx, dy)) continue;
      let cls: number;
      if (!polar) {
        const c = cellAt(grid, x, y);
        cls = c ? cells[c.row * n + c.col] : UNKNOWN;
        if (!cls) continue;
      } else {
        const r = Math.sqrt(r2);
        if (r < rStep / 2) cls = VISIBLE;
        else {
          let th = Math.atan2(dx, dy);
          if (th < 0) th += 2 * Math.PI;
          const a = Math.round((th / (2 * Math.PI)) * rays) % rays;
          const s = Math.min(steps, Math.max(1, Math.round(r / rStep)));
          cls = polar[a * steps + s - 1];
          if (!cls) continue;
        }
      }
      const i = py * S + px;
      counts.analysed++;
      if (cls === VISIBLE) counts.visible++;
      else if (cls === BLOCKED) counts.blocked++;
      else counts.unknown++;
      if (cls === VISIBLE) acc.seen[i] = Math.min(255, acc.seen[i] + 1);
      if (cls === UNKNOWN) acc.state[i] = 2;
      else if (!acc.state[i]) acc.state[i] = 1;
    }
  }
  return counts;
}

/** Combined coverage per picture pixel (same classes and rules as combineViewsheds), on `acc.pictureGrid`. */
export function displayCombined(acc: DisplayAccumulator): CombinedResult {
  const cells = acc.size * acc.size;
  const classes = new Uint8Array(cells);
  const counts = { covered: 0, overlap: 0, gap: 0, unknown: 0, analysed: 0 };
  for (let i = 0; i < cells; i++) {
    const st = acc.state[i];
    if (!st) continue;
    counts.analysed++;
    const seen = acc.seen[i];
    const cls = seen >= 2 ? COMBINED_OVERLAP : seen === 1 ? COMBINED_COVERED : st === 2 ? COMBINED_UNKNOWN : COMBINED_GAP;
    classes[i] = cls;
    if (cls === COMBINED_OVERLAP) counts.overlap++;
    else if (cls === COMBINED_COVERED) counts.covered++;
    else if (cls === COMBINED_UNKNOWN) counts.unknown++;
    else counts.gap++;
  }
  return { classes, seenBy: acc.seen, counts };
}

/** RGBA for the display image, with the same classes and colours as the cell image. */
export function displayRgba(acc: DisplayAccumulator): Uint8ClampedArray {
  const S = acc.size;
  const out = new Uint8ClampedArray(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const st = acc.state[i];
    if (!st) continue;
    const seen = acc.seen[i];
    const cls = seen >= 2 ? COMBINED_OVERLAP : seen === 1 ? COMBINED_COVERED : st === 2 ? COMBINED_UNKNOWN : COMBINED_GAP;
    const [r, g, b, a] = COVERAGE_COLORS[cls];
    // Unknown: diagonal hatching, so it reads as "no data" rather than as a colour class.
    const alpha = cls === COMBINED_UNKNOWN ? ((((i % S) + Math.floor(i / S)) >> 2) % 2 === 0 ? a : Math.round(a / 3)) : a;
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/**
 * The "site view" picture: only what is seen is lit. Clear sight lines glow white near the observer, fading to pink at
 * the edge of its range (brighter where two or more points see the same place), with fine diagonal hatching; the limit
 * of view is a dashed magenta edge; unknown is a faint grey hatch. Blocked ground is left unlit, so the dark map shows
 * through. Range rings drawn with it mark how far was analysed.
 */
export function displayRgbaGlow(acc: DisplayAccumulator, observers: readonly { x: number; y: number; rangeM: number }[]): Uint8ClampedArray {
  const S = acc.size;
  const out = new Uint8ClampedArray(S * S * 4);
  const span = acc.grid.n * acc.grid.cellM;
  const seenAt = (px: number, py: number) => px >= 0 && py >= 0 && px < S && py < S && acc.seen[py * S + px] > 0;
  for (let py = 0; py < S; py++) {
    const y = span / 2 - ((py + 0.5) / S) * span;
    for (let px = 0; px < S; px++) {
      const i = py * S + px;
      const st = acc.state[i];
      if (!st) continue;
      const seen = acc.seen[i];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (seen > 0) {
        if (!seenAt(px - 1, py) || !seenAt(px + 1, py) || !seenAt(px, py - 1) || !seenAt(px, py + 1) || !seenAt(px - 2, py) || !seenAt(px + 2, py) || !seenAt(px, py - 2) || !seenAt(px, py + 2)) {
          // Limit of view: dashed magenta, two pixels wide so it reads at street scale.
          r = 255;
          g = 43;
          b = 214;
          a = ((px + py) >> 2) % 2 === 0 ? 255 : 110;
        } else {
          const x = ((px + 0.5) / S) * span - span / 2;
          let t = 1;
          for (const o of observers) t = Math.min(t, Math.hypot(x - o.x, y - o.y) / Math.max(1, o.rangeM));
          r = 255;
          g = Math.round(255 - 150 * t);
          b = Math.round(255 - 40 * t);
          a = Math.round((seen >= 2 ? 175 : 140) - 70 * t);
          if ((px - py + S * 8) % 7 === 0) a = Math.min(255, a + 40);
        }
      } else if (st === 2 && (px + py) % 6 < 2) {
        r = g = b = 160;
        a = 90;
      }
      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = a;
    }
  }
  return out;
}
