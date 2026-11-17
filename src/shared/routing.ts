// Route options between two points over the road and path network drawn on the map (OpenMapTiles "transportation"
// lines from OpenStreetMap, zoom 14). Runs entirely on this computer; no routing service is contacted.
//
// Limits, said wherever routes are shown: map-tile geometry is generalised, turn restrictions, access rules, closures,
// traffic and signals are not modelled, roads that cross without a shared vertex (bridges, tunnels) are not connected,
// and times are estimates from a fixed speed per road class.
import { geodesicDistanceKm } from './geo';

/** Great-circle metres; fast enough for every edge of a city network (pieces are a few metres to a few hundred). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const ROUTE_Z = 14;
export const ROUTE_EXTENT = 4096;
const WORLD = 2 ** ROUTE_Z * ROUTE_EXTENT;
/** Straight-line distance limit between the two ends (keeps the tile count and the graph bounded). */
export const MAX_ROUTE_SPAN_M = 12_000;

export type TravelMode = 'walk' | 'drive';

/** One road or path piece in global zoom-14 tile units (x east, y south; 4096 per tile). */
export interface RoadLine {
  cls: string;
  subclass: string | null;
  /** 1 = one way along the geometry, -1 = against it, 0 = both. */
  oneway: -1 | 0 | 1;
  name: string | null;
  pts: [number, number][];
}

export function unitsToLonLat(x: number, y: number): [number, number] {
  const lon = (x / WORLD) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / WORLD))) * 180) / Math.PI;
  return [lon, lat];
}
export function lonLatToUnits(lon: number, lat: number): [number, number] {
  const la = Math.max(-85.05, Math.min(85.05, lat));
  const r = (la * Math.PI) / 180;
  return [((lon + 180) / 360) * WORLD, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD];
}

/**
 * Clips a tile-local line to the tile square [0, extent]². Tiles carry a buffer beyond their edge; clipping both
 * neighbours at the shared edge makes them meet at the same point, so the pieces join into one network.
 */
export function clipLineToTile(pts: readonly [number, number][], extent = ROUTE_EXTENT): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const inside = (p: readonly [number, number]) => p[0] >= 0 && p[0] <= extent && p[1] >= 0 && p[1] <= extent;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let miss = false;
    for (const [p, q] of [[-dx, a[0]], [dx, extent - a[0]], [-dy, a[1]], [dy, extent - a[1]]] as [number, number][]) {
      if (p === 0) {
        if (q < 0) miss = true;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (miss || t1 < t0) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const pa: [number, number] = t0 > 0 ? [a[0] + dx * t0, a[1] + dy * t0] : [a[0], a[1]];
    const pb: [number, number] = t1 < 1 ? [a[0] + dx * t1, a[1] + dy * t1] : [b[0], b[1]];
    if (!cur.length) cur.push(pa);
    cur.push(pb);
    if (t1 < 1 || !inside(b)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** km/h per road class when driving; classes not listed are not driven on. */
export const DRIVE_KMH: Record<string, number> = { motorway: 100, trunk: 80, primary: 60, secondary: 50, tertiary: 40, minor: 30, service: 15, track: 15 };
/** Classes not walked on. */
const NO_WALK = new Set(['motorway', 'rail', 'transit', 'ferry', 'aerialway', 'raceway', 'bus_guideway', 'busway']);
export const WALK_KMH = 4.8;
const STEPS_KMH = 2.5;
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']);

export function speedKmh(cls: string, subclass: string | null, mode: TravelMode): number | null {
  if (mode === 'drive') return DRIVE_KMH[cls] ?? null;
  if (NO_WALK.has(cls)) return null;
  return subclass === 'steps' ? STEPS_KMH : WALK_KMH;
}

export interface RoadGraph {
  mode: TravelMode;
  lon: Float64Array;
  lat: Float64Array;
  nodeCount: number;
  /** CSR adjacency: edges of node i are first[i] .. first[i+1]-1. */
  first: Int32Array;
  to: Int32Array;
  lengthM: Float64Array;
  seconds: Float64Array;
  /** Undirected segment id (both directions of a two-way road share it). */
  seg: Int32Array;
  /** Index into `classes` / `names` per edge. */
  cls: Uint16Array;
  name: Int32Array;
  classes: string[];
  names: string[];
  /** Number of distinct road segments meeting at each node. */
  degree: Uint16Array;
}

/** Road ends within this distance (tile units, about 0.3–0.6 m each) of another road's line are joined to it. */
export const JUNCTION_SNAP_UNITS = 3;

/**
 * Repairs T-junctions lost in map-tile generalisation: zoom-14 tiles simplify long roads and can drop the vertex where
 * a side road joins, so the side road's end lies on the main road's line without sharing a vertex. Each line end that
 * lies within JUNCTION_SNAP_UNITS of another line is moved onto it and a vertex is added there. Only ends are joined;
 * roads crossing mid-line (bridges, tunnels, or a lost crossing) stay unconnected. Returns new point arrays.
 */
export function joinTJunctions(lines: readonly { pts: readonly [number, number][] }[], snap = JUNCTION_SNAP_UNITS): [number, number][][] {
  const pts = lines.map((l) => l.pts.map((p) => [p[0], p[1]] as [number, number]));
  const CELL = 64;
  const grid = new Map<string, [number, number][]>(); // cell → [line, segment]
  for (let li = 0; li < pts.length; li++)
    for (let si = 1; si < pts[li].length; si++) {
      const [ax, ay] = pts[li][si - 1];
      const [bx, by] = pts[li][si];
      for (let cx = Math.floor((Math.min(ax, bx) - snap) / CELL); cx <= Math.floor((Math.max(ax, bx) + snap) / CELL); cx++)
        for (let cy = Math.floor((Math.min(ay, by) - snap) / CELL); cy <= Math.floor((Math.max(ay, by) + snap) / CELL); cy++) {
          const key = `${cx},${cy}`;
          let l = grid.get(key);
          if (!l) grid.set(key, (l = []));
          l.push([li, si]);
        }
    }
  const inserts = new Map<string, { t: number; p: [number, number] }[]>(); // "line,segment" → points to add
  for (let li = 0; li < pts.length; li++) {
    const line = pts[li];
    if (line.length < 2) continue;
    for (const end of [0, line.length - 1]) {
      const p = line[end];
      const cand = grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? [];
      let best: { d: number; lj: number; sj: number; t: number; q: [number, number] } | null = null;
      for (const [lj, sj] of cand) {
        if (lj === li) continue;
        const a = pts[lj][sj - 1];
        const b = pts[lj][sj];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        const q: [number, number] = [a[0] + dx * t, a[1] + dy * t];
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= snap && (!best || d < best.d)) best = { d, lj, sj, t, q };
      }
      if (!best || best.d === 0) {
        if (best && best.t > 0 && best.t < 1) (inserts.get(`${best.lj},${best.sj}`) ?? inserts.set(`${best.lj},${best.sj}`, []).get(`${best.lj},${best.sj}`)!).push({ t: best.t, p: [p[0], p[1]] });
        continue;
      }
      const len = Math.hypot(pts[best.lj][best.sj][0] - pts[best.lj][best.sj - 1][0], pts[best.lj][best.sj][1] - pts[best.lj][best.sj - 1][1]);
      // Near a vertex of the other line: join that vertex. Otherwise add a vertex on its segment.
      if (best.t * len <= snap) line[end] = [...pts[best.lj][best.sj - 1]];
      else if ((1 - best.t) * len <= snap) line[end] = [...pts[best.lj][best.sj]];
      else {
        line[end] = best.q;
        const key = `${best.lj},${best.sj}`;
        (inserts.get(key) ?? inserts.set(key, []).get(key)!).push({ t: best.t, p: best.q });
      }
    }
  }
  if (!inserts.size) return pts;
  return pts.map((line, li) => {
    const out: [number, number][] = [line[0]];
    for (let si = 1; si < line.length; si++) {
      const add = inserts.get(`${li},${si}`);
      if (add) for (const x of add.sort((a, b) => a.t - b.t)) out.push(x.p);
      out.push(line[si]);
    }
    return out;
  });
}

/** Builds a directed graph for a travel mode from road lines (shared vertices, to 1/8 tile unit, join lines). */
export function buildRoadGraph(input: readonly RoadLine[], mode: TravelMode): RoadGraph {
  const usable = input.filter((l) => speedKmh(l.cls, l.subclass, mode));
  const joined = joinTJunctions(usable);
  const lines = usable.map((l, i) => ({ ...l, pts: joined[i] }));
  const ids = new Map<string, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const node = (p: readonly [number, number]) => {
    const key = `${Math.round(p[0] * 8)},${Math.round(p[1] * 8)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = xs.length;
      ids.set(key, id);
      xs.push(p[0]);
      ys.push(p[1]);
    }
    return id;
  };
  const classes: string[] = [];
  const classIdx = new Map<string, number>();
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const ef: number[] = [];
  const et: number[] = [];
  const el: number[] = [];
  const es: number[] = [];
  const eseg: number[] = [];
  const ecls: number[] = [];
  const ename: number[] = [];
  const segKeys = new Set<string>();
  const segTouch: number[][] = [];
  let segs = 0;
  for (const line of lines) {
    const kmh = speedKmh(line.cls, line.subclass, mode);
    if (!kmh) continue;
    let ci = classIdx.get(line.cls);
    if (ci === undefined) classIdx.set(line.cls, (ci = classes.push(line.cls) - 1));
    let ni = -1;
    if (line.name) {
      const found = nameIdx.get(line.name);
      ni = found ?? names.push(line.name) - 1;
      if (found === undefined) nameIdx.set(line.name, ni);
    }
    for (let i = 1; i < line.pts.length; i++) {
      const a = node(line.pts[i - 1]);
      const b = node(line.pts[i]);
      if (a === b) continue;
      // The same piece can arrive twice (a road drawn in two overlapping features): keep one.
      const sk = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (segKeys.has(sk)) continue;
      segKeys.add(sk);
      const [lonA, latA] = unitsToLonLat(xs[a], ys[a]);
      const [lonB, latB] = unitsToLonLat(xs[b], ys[b]);
      const len = haversineM(latA, lonA, latB, lonB);
      const sec = len / ((kmh * 1000) / 3600);
      const seg = segs++;
      (segTouch[a] ??= []).push(seg);
      (segTouch[b] ??= []).push(seg);
      const fwd = mode === 'walk' || line.oneway !== -1;
      const back = mode === 'walk' || line.oneway !== 1;
      if (fwd) {
        ef.push(a); et.push(b); el.push(len); es.push(sec); eseg.push(seg); ecls.push(ci); ename.push(ni);
      }
      if (back) {
        ef.push(b); et.push(a); el.push(len); es.push(sec); eseg.push(seg); ecls.push(ci); ename.push(ni);
      }
    }
  }
  const nodeCount = xs.length;
  const first = new Int32Array(nodeCount + 1);
  for (const f of ef) first[f + 1]++;
  for (let i = 0; i < nodeCount; i++) first[i + 1] += first[i];
  const fill = first.slice(0, nodeCount);
  const m = ef.length;
  const to = new Int32Array(m);
  const lengthM = new Float64Array(m);
  const seconds = new Float64Array(m);
  const seg = new Int32Array(m);
  const cls = new Uint16Array(m);
  const name = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const at = fill[ef[i]]++;
    to[at] = et[i];
    lengthM[at] = el[i];
    seconds[at] = es[i];
    seg[at] = eseg[i];
    cls[at] = ecls[i];
    name[at] = ename[i];
  }
  const lon = new Float64Array(nodeCount);
  const lat = new Float64Array(nodeCount);
  const degree = new Uint16Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    const [lo, la] = unitsToLonLat(xs[i], ys[i]);
    lon[i] = lo;
    lat[i] = la;
    degree[i] = Math.min(65535, segTouch[i]?.length ?? 0);
  }
  return { mode, lon, lat, nodeCount, first, to, lengthM, seconds, seg, cls, name, classes, names, degree };
}

/** Nodes with at least one outgoing edge, nearest first (up to `max`, within `withinM`). */
export function nearestNodes(g: RoadGraph, lat: number, lon: number, max = 6, withinM = 400): { node: number; distM: number }[] {
  const k = 111_320 * Math.cos((lat * Math.PI) / 180);
  const best: { node: number; distM: number }[] = [];
  for (let i = 0; i < g.nodeCount; i++) {
    if (g.first[i + 1] === g.first[i]) continue;
    const dx = (g.lon[i] - lon) * k;
    const dy = (g.lat[i] - lat) * 111_320;
    const d = Math.hypot(dx, dy);
    if (d > withinM) continue;
    if (best.length < max || d < best[best.length - 1].distM) {
      best.push({ node: i, distM: d });
      best.sort((a, b) => a.distM - b.distM);
      if (best.length > max) best.pop();
    }
  }
  return best;
}

/** Binary-heap Dijkstra on seconds × penalty per segment. Returns the edge indices of the path, or null. */
export function shortestPath(g: RoadGraph, from: number, to: number, penalty?: Float64Array): number[] | null {
  const n = g.nodeCount;
  const dist = new Float64Array(n).fill(Infinity);
  const via = new Int32Array(n).fill(-1);
  const heapN: number[] = [];
  const heapD: number[] = [];
  const push = (node: number, d: number) => {
    heapN.push(node);
    heapD.push(d);
    let i = heapN.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= heapD[i]) break;
      [heapN[p], heapN[i]] = [heapN[i], heapN[p]];
      [heapD[p], heapD[i]] = [heapD[i], heapD[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heapN[0], heapD[0]];
    const ln = heapN.pop()!;
    const ld = heapD.pop()!;
    if (heapN.length) {
      heapN[0] = ln;
      heapD[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heapN.length && heapD[l] < heapD[s]) s = l;
        if (r < heapN.length && heapD[r] < heapD[s]) s = r;
        if (s === i) break;
        [heapN[s], heapN[i]] = [heapN[i], heapN[s]];
        [heapD[s], heapD[i]] = [heapD[i], heapD[s]];
        i = s;
      }
    }
    return top;
  };
  dist[from] = 0;
  push(from, 0);
  while (heapN.length) {
    const [u, d] = pop();
    if (d > dist[u]) continue;
    if (u === to) break;
    for (let e = g.first[u]; e < g.first[u + 1]; e++) {
      const v = g.to[e];
      const nd = d + g.seconds[e] * (penalty ? penalty[g.seg[e]] : 1);
      if (nd < dist[v]) {
        dist[v] = nd;
        via[v] = e;
        push(v, nd);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const edges: number[] = [];
  // Walk back from the end: the edge into v starts at the node whose edge range contains it.
  let v = to;
  const fromOf = (e: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (g.first[mid] <= e) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  while (v !== from) {
    const e = via[v];
    if (e < 0) return null;
    edges.push(e);
    v = fromOf(e);
    if (edges.length > n) return null;
  }
  return edges.reverse();
}

export interface RouteOption {
  points: [number, number][];
  lengthM: number;
  /** Estimate at fixed class speeds, without traffic, signals or turns. */
  minutes: number;
  /** Share of the length on motorway, trunk, primary or secondary roads. */
  majorShare: number;
  /** Junctions passed (nodes where three or more mapped road pieces meet). */
  junctions: number;
  /** Most-used street names, longest first (up to three). */
  via: string[];
  /** Distance from the requested ends to where the route joins the network. */
  startGapM: number;
  endGapM: number;
  /** Turn-by-turn steps along the mapped road lines (names as mapped; unnamed roads are described by class). */
  steps: RouteStep[];
}

export type Maneuver = 'depart' | 'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'u-turn' | 'arrive';

export interface RouteStep {
  maneuver: Maneuver;
  /** Street the step follows (mapped name), or null for an unnamed road. */
  name: string | null;
  /** Road class of the step, used to describe unnamed roads. */
  roadClass: string;
  /** Where the maneuver happens. */
  lat: number;
  lon: number;
  /** Length of road followed after the maneuver, to the next step. */
  distanceM: number;
  /** Plain-language instruction, e.g. "Turn left onto Unioninkatu". */
  text: string;
}

/** Initial bearing in degrees (0 = north), spherical; ample for the short spans routes cover. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dl = (lon2 - lon1) * r;
  const y = Math.sin(dl) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dl);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Steps shorter than this are folded into a neighbour (a jog across a junction is not an instruction). */
export const STEP_MIN_M = 25;

/** Signed change of direction, -180..180 (positive = right). */
export function turnAngle(inDeg: number, outDeg: number): number {
  return ((outDeg - inDeg + 540) % 360) - 180;
}

export function maneuverFor(angle: number): Maneuver {
  const a = Math.abs(angle);
  if (a < 20) return 'straight';
  if (a >= 165) return 'u-turn';
  const side = angle > 0 ? 'right' : 'left';
  if (a < 50) return side === 'right' ? 'slight-right' : 'slight-left';
  if (a < 125) return side;
  return side === 'right' ? 'sharp-right' : 'sharp-left';
}

const MANEUVER_TEXT: Record<Maneuver, string> = {
  depart: 'Start', straight: 'Continue', 'slight-left': 'Bear left', 'slight-right': 'Bear right', left: 'Turn left', right: 'Turn right',
  'sharp-left': 'Turn sharp left', 'sharp-right': 'Turn sharp right', 'u-turn': 'Make a U-turn', arrive: 'Arrive',
};

const CLASS_TEXT: Record<string, string> = { motorway: 'the motorway', trunk: 'the main road', primary: 'the main road', secondary: 'the road', tertiary: 'the road', minor: 'the street', service: 'the service road', track: 'the track', path: 'the path' };

/** Bearing over roughly the first or last 25 m of a run of points (short wiggles at junctions would mislead). */
function sideBearing(points: [number, number][], fromEnd: boolean): number {
  const pts = fromEnd ? [...points].reverse() : points;
  const [lon0, lat0] = pts[0];
  let k = 1;
  while (k < pts.length - 1 && geodesicDistanceKm(lat0, lon0, pts[k][1], pts[k][0]) * 1000 < 25) k++;
  const b = bearingDeg(lat0, lon0, pts[k][1], pts[k][0]);
  return fromEnd ? (b + 180) % 360 : b;
}

/**
 * Groups the path into steps: a new step starts where the street name changes, or at a junction where the route
 * turns by 45° or more on the same street. Consecutive legs with the same name and no turn are merged.
 */
export function routeSteps(g: RoadGraph, from: number, edges: number[]): RouteStep[] {
  if (!edges.length) return [];
  interface Leg { name: number; cls: string; nodeFrom: number; pts: [number, number][]; lengthM: number }
  const legs: Leg[] = [];
  let prev = from;
  for (const e of edges) {
    const v = g.to[e];
    const last = legs.at(-1);
    const pt: [number, number] = [g.lon[v], g.lat[v]];
    let split = !last || last.name !== g.name[e];
    if (!split && last && g.degree[prev] >= 3 && last.pts.length >= 2) {
      const inB = sideBearing(last.pts, true);
      const outB = bearingDeg(g.lat[prev], g.lon[prev], g.lat[v], g.lon[v]);
      if (Math.abs(turnAngle(inB, outB)) >= 45) split = true;
    }
    if (split) legs.push({ name: g.name[e], cls: g.classes[g.cls[e]], nodeFrom: prev, pts: [[g.lon[prev], g.lat[prev]], pt], lengthM: g.lengthM[e] });
    else { last!.pts.push(pt); last!.lengthM += g.lengthM[e]; }
    prev = v;
  }
  // Mapped footpaths zig-zag through parks and squares: fold jogs shorter than STEP_MIN_M into a neighbouring step, then
  // rejoin pieces of the same street that now meet at a gentle angle, so the list reads like directions.
  const merge = (into: Leg, from: Leg) => { into.pts.push(...from.pts.slice(1)); into.lengthM += from.lengthM; };
  for (let i = 0; legs.length > 1 && i < legs.length; ) {
    if (legs[i].lengthM >= STEP_MIN_M) { i++; continue; }
    if (i === 0) {
      const next = legs[1];
      next.pts = [...legs[0].pts, ...next.pts.slice(1)];
      next.lengthM += legs[0].lengthM;
      next.nodeFrom = legs[0].nodeFrom;
      legs.splice(0, 1);
    } else {
      merge(legs[i - 1], legs[i]);
      legs.splice(i, 1);
    }
    i = Math.max(0, i - 1);
  }
  for (let i = 1; i < legs.length; ) {
    const a = legs[i - 1];
    const b = legs[i];
    const same = a.name === b.name && (a.name >= 0 || a.cls === b.cls);
    if (same && Math.abs(turnAngle(sideBearing(a.pts, true), sideBearing(b.pts, false))) < 45) { merge(a, b); legs.splice(i, 1); }
    else i++;
  }
  const label = (l: Leg) => (l.name >= 0 ? g.names[l.name] : null);
  const onto = (l: Leg) => label(l) ?? CLASS_TEXT[l.cls] ?? 'the road';
  const steps: RouteStep[] = legs.map((l, i) => {
    let maneuver: Maneuver = 'depart';
    if (i > 0) maneuver = maneuverFor(turnAngle(sideBearing(legs[i - 1].pts, true), sideBearing(l.pts, false)));
    const name = label(l);
    const text = i === 0 ? `Start on ${onto(l)}` : maneuver === 'straight' ? `Continue onto ${onto(l)}` : `${MANEUVER_TEXT[maneuver]} onto ${onto(l)}`;
    return { maneuver, name, roadClass: l.cls, lat: g.lat[l.nodeFrom], lon: g.lon[l.nodeFrom], distanceM: l.lengthM, text };
  });
  steps.push({ maneuver: 'arrive', name: null, roadClass: legs.at(-1)!.cls, lat: g.lat[prev], lon: g.lon[prev], distanceM: 0, text: 'Arrive at the end point' });
  return steps;
}

function describe(g: RoadGraph, from: number, edges: number[], startGapM: number, endGapM: number): RouteOption {
  const points: [number, number][] = [[g.lon[from], g.lat[from]]];
  let lengthM = 0;
  let seconds = 0;
  let major = 0;
  let junctions = 0;
  const byName = new Map<string, number>();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const v = g.to[e];
    points.push([g.lon[v], g.lat[v]]);
    lengthM += g.lengthM[e];
    seconds += g.seconds[e];
    if (MAJOR.has(g.classes[g.cls[e]])) major += g.lengthM[e];
    if (g.name[e] >= 0) byName.set(g.names[g.name[e]], (byName.get(g.names[g.name[e]]) ?? 0) + g.lengthM[e]);
    if (i < edges.length - 1 && g.degree[v] >= 3) junctions++;
  }
  const via = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  return { points, lengthM, minutes: seconds / 60, majorShare: lengthM ? major / lengthM : 0, junctions, via, startGapM, endGapM, steps: routeSteps(g, from, edges) };
}

/** Share of `a`'s length on segments that `b` also uses. */
function overlap(g: RoadGraph, a: number[], b: number[]): number {
  const bs = new Set(b.map((e) => g.seg[e]));
  let shared = 0;
  let total = 0;
  for (const e of a) {
    total += g.lengthM[e];
    if (bs.has(g.seg[e])) shared += g.lengthM[e];
  }
  return total ? shared / total : 1;
}

export type RouteSearch =
  | { ok: true; options: RouteOption[] }
  | { ok: false; reason: 'no-start' | 'no-end' | 'no-path' | 'too-far' };

/**
 * Up to `k` distinct routes: the quickest, then alternatives found by penalising the segments of routes already
 * found (each kept only if at most `maxOverlap` of its length is shared with an earlier option).
 */
export function routeOptions(g: RoadGraph, a: { lat: number; lon: number }, b: { lat: number; lon: number }, k = 3, maxOverlap = 0.7): RouteSearch {
  if (geodesicDistanceKm(a.lat, a.lon, b.lat, b.lon) * 1000 > MAX_ROUTE_SPAN_M) return { ok: false, reason: 'too-far' };
  const starts = nearestNodes(g, a.lat, a.lon);
  const ends = nearestNodes(g, b.lat, b.lon);
  if (!starts.length) return { ok: false, reason: 'no-start' };
  if (!ends.length) return { ok: false, reason: 'no-end' };
  // The nearest node can sit on a fragment cut off from the network (a footway stub, a car park): try a few pairs,
  // closest to the requested ends first (ties: the closer start), never a start and end on the same node.
  const pairs = starts.slice(0, 4).flatMap((s) => ends.slice(0, 4).map((t) => ({ s, t }))).filter((p) => p.s.node !== p.t.node);
  pairs.sort((x, y) => x.s.distM + x.t.distM - (y.s.distM + y.t.distM) || x.s.distM - y.s.distM);
  for (const { s, t } of pairs) {
      const firstPath = shortestPath(g, s.node, t.node);
      if (!firstPath) continue;
      const paths = [firstPath];
      const penalty = new Float64Array(g.seg.reduce((m, x) => Math.max(m, x), 0) + 1).fill(1);
      for (let iter = 0; iter < 8 && paths.length < k; iter++) {
        for (const p of paths) for (const e of p) penalty[g.seg[e]] *= 1.5;
        const next = shortestPath(g, s.node, t.node, penalty);
        if (!next) break;
        if (paths.every((p) => overlap(g, next, p) <= maxOverlap && overlap(g, p, next) <= maxOverlap)) paths.push(next);
      }
      return { ok: true, options: paths.map((p) => describe(g, s.node, p, s.distM, t.distM)) };
    }
  return { ok: false, reason: 'no-path' };
}
