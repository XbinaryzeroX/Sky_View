// Rooftop line of sight for protective planning: which mapped rooftops have a modelled clear line to the subject,
// and how much of a route is overlooked from mapped rooftops. Both reuse the coverage model (terrain plus
// OpenStreetMap building blocks): a straight sight line is the same in both directions, so "can a person on that
// roof see the subject" is computed as "can the subject see a person standing on that roof".
//
// Results are geometric estimates from mapped data. Trees, parapets, glazing, roof furniture and buildings missing
// from OpenStreetMap are not modelled, and a roof that is not listed is not shown to be safe. A person on a roof is
// placed at the roof edge facing the subject (someone at the parapet can look down past the wall below them).
import { BLOCKED, clipToSquare, computeViewshed, localSegment, toLocal, UNKNOWN, VISIBLE, type Grid } from './viewshed';

export interface SurfaceGrids {
  grid: Grid;
  ground: Float32Array;
  buildings: Float32Array;
  bases: Float32Array;
}

export const ROOF_NONE = 0;
export const ROOF_VISIBLE = 1;
export const ROOF_BLOCKED = 2;
export const ROOF_UNKNOWN = 3;

/** Neighbouring roof cells whose heights differ by more than this belong to different roofs (a tower beside its annex). */
export const ROOF_SPLIT_M = 3;

export interface Rooftop {
  /** Roof group index (stable for one geometry). */
  id: number;
  cells: number;
  visibleCells: number;
  unknownCells: number;
  /** Tallest mapped height above ground in the group. */
  heightM: number;
  /** Nearest roof cell with a clear modelled line to the subject. */
  lat: number;
  lon: number;
  distanceM: number;
  bearingDeg: number;
  /** Angle from the subject's eye up (positive) or down to the eye of a person on that roof cell. */
  elevationDeg: number;
  /** Terrain height under that cell (m above sea level). */
  groundM: number;
}

export interface RoofExposure {
  /** Roof groups with at least one cell that has a clear modelled line to the subject, nearest first. */
  rooftops: Rooftop[];
  /** Roof groups in range with no clear cell but at least one cell that could not be decided. */
  undetermined: number;
  /** Roof groups with any cell in range. */
  groupsInRange: number;
  /** Cells in range whose building data was unavailable (their roofs, if any, cannot be assessed). */
  unknownBuildingCells: number;
  /** ROOF_* per cell. */
  classes: Uint8Array;
  /** Height of the mapped building under the subject (it is then modelled on that roof); null on open ground. */
  subjectRoofM: number | null;
  error: string | null;
}

/** Labels connected roof cells (8-neighbour, similar height) as groups; -1 = no mapped roof. Returns the group count. */
export function roofGroups(grid: Grid, buildings: Float32Array, out: Int32Array): number {
  const n = grid.n;
  out.fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let k = 0; k < n * n; k++) {
    if (out[k] !== -1 || !(buildings[k] > 0)) continue;
    out[k] = next;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop()!;
      const r = Math.floor(c / n);
      const col = c % n;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          const kk = rr * n + cc;
          if (out[kk] !== -1 || !(buildings[kk] > 0) || Math.abs(buildings[kk] - buildings[c]) > ROOF_SPLIT_M) continue;
          out[kk] = next;
          stack.push(kk);
        }
    }
    next++;
  }
  return next;
}

/** Cells that hold a mapped roof or unknown building data (the cells a rooftop check needs). */
export function roofMask(buildings: Float32Array): Uint8Array {
  const m = new Uint8Array(buildings.length);
  for (let k = 0; k < buildings.length; k++) if (!(buildings[k] === 0)) m[k] = 1; // > 0 or NaN
  return m;
}

const M_PER_DEG = 111_320;
function cellLatLon(grid: Grid, k: number): { lat: number; lon: number; x: number; y: number } {
  const half = (grid.n - 1) / 2;
  const x = ((k % grid.n) - half) * grid.cellM;
  const y = (half - Math.floor(k / grid.n)) * grid.cellM;
  return { x, y, lat: grid.lat + y / M_PER_DEG, lon: grid.lon + x / (M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180)) };
}

/**
 * Mapped rooftops with a modelled clear line of sight to the subject.
 * `subjectHeightM`: the subject's eye height above the surface; `roofEyeM`: eye height of a person on a roof.
 */
export function rooftopExposure(
  s: SurfaceGrids,
  subject: { lat: number; lon: number; heightM: number },
  opts: { roofEyeM: number; rangeM: number; groups?: Int32Array },
): RoofExposure {
  const { grid } = s;
  const n = grid.n;
  const cells = n * n;
  const groups = opts.groups ?? new Int32Array(cells);
  if (!opts.groups) roofGroups(grid, s.buildings, groups);
  const r = computeViewshed({
    grid,
    ground: s.ground,
    buildings: s.buildings,
    bases: s.bases,
    mask: roofMask(s.buildings),
    edgeTargets: true,
    observer: { lat: subject.lat, lon: subject.lon, heightM: subject.heightM, rangeM: opts.rangeM, headingDeg: null, fovDeg: null },
    targetHeightM: opts.roofEyeM,
  });
  const classes = new Uint8Array(cells);
  const o = toLocal(grid, subject.lat, subject.lon);
  const half = (n - 1) / 2;
  const oc = { col: Math.round(o.x / grid.cellM + half), row: Math.round(half - o.y / grid.cellM) };
  const ok = oc.row >= 0 && oc.col >= 0 && oc.row < n && oc.col < n ? oc.row * n + oc.col : -1;
  const eye = ok >= 0 && Number.isFinite(s.ground[ok]) ? s.ground[ok] + (s.buildings[ok] > 0 ? s.buildings[ok] : 0) + subject.heightM : Number.NaN;
  const byGroup = new Map<number, Rooftop & { best: number }>();
  const touched = new Set<number>();
  let unknownBuildingCells = 0;
  for (let k = 0; k < cells; k++) {
    const c = r.classes[k];
    if (!c) continue;
    if (Number.isNaN(s.buildings[k])) {
      unknownBuildingCells++;
      classes[k] = ROOF_UNKNOWN;
      continue;
    }
    const g = groups[k];
    if (g < 0 || k === ok) continue; // the subject's own roof is not an overlooking roof
    touched.add(g);
    classes[k] = c === VISIBLE ? ROOF_VISIBLE : c === BLOCKED ? ROOF_BLOCKED : ROOF_UNKNOWN;
    let t = byGroup.get(g);
    if (!t) {
      t = { id: g, cells: 0, visibleCells: 0, unknownCells: 0, heightM: 0, lat: 0, lon: 0, distanceM: Infinity, bearingDeg: 0, elevationDeg: 0, groundM: 0, best: -1 };
      byGroup.set(g, t);
    }
    t.cells++;
    t.heightM = Math.max(t.heightM, s.buildings[k]);
    if (c === UNKNOWN) t.unknownCells++;
    if (c !== VISIBLE) continue;
    t.visibleCells++;
    const p = cellLatLon(grid, k);
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d < t.distanceM) {
      t.distanceM = d;
      t.best = k;
      t.lat = p.lat;
      t.lon = p.lon;
      t.bearingDeg = ((Math.atan2(p.x - o.x, p.y - o.y) * 180) / Math.PI + 360) % 360;
      t.groundM = s.ground[k];
      const roofEye = s.ground[k] + s.buildings[k] + opts.roofEyeM;
      t.elevationDeg = Number.isFinite(eye) ? (Math.atan2(roofEye - eye, Math.max(d, 0.01)) * 180) / Math.PI : 0;
    }
  }
  const rooftops: Rooftop[] = [];
  let undetermined = 0;
  for (const t of byGroup.values()) {
    if (t.visibleCells > 0) {
      const { best: _best, ...roof } = t;
      void _best;
      rooftops.push(roof);
    } else if (t.unknownCells > 0) undetermined++;
  }
  rooftops.sort((a, b) => a.distanceM - b.distanceM);
  const subjectRoofM = ok >= 0 && s.buildings[ok] > 0 ? s.buildings[ok] : null;
  return { rooftops, undetermined, groupsInRange: touched.size, unknownBuildingCells, classes, subjectRoofM, error: r.error };
}

export interface RouteOverlook {
  /** Route length inside the analysis grid (m). */
  insideM: number;
  /** Shares of the route length inside the grid (0–1). */
  overlooked: number;
  clear: number;
  unknown: number;
  /** Share of the whole route outside the analysed area. */
  outside: number;
  /** Distinct roof groups with a clear line to any sampled point of the route. */
  rooftops: number;
  samples: number;
}

/**
 * How much of a route (lon/lat points) has a modelled clear line to at least one mapped rooftop within `rangeM`.
 * Sampled every `spacingM` metres inside the grid (at most `maxSamples` samples, evenly spread).
 */
export function routeOverlook(
  s: SurfaceGrids,
  points: readonly [number, number][],
  opts: { eyeM: number; roofEyeM: number; rangeM: number; spacingM: number; maxSamples: number; groups?: Int32Array },
  shouldStop?: () => boolean,
): RouteOverlook {
  const { grid } = s;
  const h = (grid.n * grid.cellM) / 2;
  const pieces: { ax: number; ay: number; bx: number; by: number; len: number }[] = [];
  let total = 0;
  let inside = 0;
  for (let i = 1; i < points.length; i++) {
    const { a, b } = localSegment(grid, points[i - 1], points[i]);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    total += len;
    const clip = clipToSquare(a.x, a.y, b.x, b.y, h * 0.999);
    if (!clip) continue;
    const [t0, t1] = clip;
    const ax = a.x + (b.x - a.x) * t0;
    const ay = a.y + (b.y - a.y) * t0;
    const bx = a.x + (b.x - a.x) * t1;
    const by = a.y + (b.y - a.y) * t1;
    pieces.push({ ax, ay, bx, by, len: len * (t1 - t0) });
    inside += len * (t1 - t0);
  }
  const empty: RouteOverlook = { insideM: inside, overlooked: 0, clear: 0, unknown: 0, outside: total ? 1 - inside / total : 1, rooftops: 0, samples: 0 };
  if (!(inside > 0)) return empty;
  const count = Math.max(1, Math.min(opts.maxSamples, Math.ceil(inside / opts.spacingM)));
  const step = inside / count;
  const groups = opts.groups ?? new Int32Array(grid.n * grid.n);
  if (!opts.groups) roofGroups(grid, s.buildings, groups);
  const mask = roofMask(s.buildings);
  const seen = new Set<number>();
  const tally = { overlooked: 0, clear: 0, unknown: 0 };
  const m2deg = (x: number, y: number) => ({ lat: grid.lat + y / M_PER_DEG, lon: grid.lon + x / (M_PER_DEG * Math.cos((grid.lat * Math.PI) / 180)) });
  let pi = 0;
  let acc = 0; // length consumed before pieces[pi]
  for (let si = 0; si < count; si++) {
    if (shouldStop?.()) throw new Error('cancelled');
    const at = (si + 0.5) * step;
    while (pi < pieces.length - 1 && acc + pieces[pi].len < at) acc += pieces[pi++].len;
    const p = pieces[pi];
    const t = p.len ? Math.min(1, Math.max(0, (at - acc) / p.len)) : 0;
    const ll = m2deg(p.ax + (p.bx - p.ax) * t, p.ay + (p.by - p.ay) * t);
    const r = computeViewshed({ grid, ground: s.ground, buildings: s.buildings, bases: s.bases, mask, edgeTargets: true, observer: { lat: ll.lat, lon: ll.lon, heightM: opts.eyeM, rangeM: opts.rangeM, headingDeg: null, fovDeg: null }, targetHeightM: opts.roofEyeM });
    let vis = false;
    let unk = !!r.error;
    for (let k = 0; k < r.classes.length; k++) {
      const c = r.classes[k];
      if (c === VISIBLE && groups[k] >= 0) {
        vis = true;
        seen.add(groups[k]);
      } else if (c === UNKNOWN) unk = true;
    }
    if (vis) tally.overlooked += step;
    else if (unk) tally.unknown += step;
    else tally.clear += step;
  }
  // Shares of a sum of floating-point steps: clamp so they stay within 0–1.
  const c01 = (v: number) => Math.min(1, Math.max(0, v));
  return { insideM: inside, overlooked: c01(tally.overlooked / inside), clear: c01(tally.clear / inside), unknown: c01(tally.unknown / inside), outside: total ? c01(1 - inside / total) : 0, rooftops: seen.size, samples: count };
}
