// OpenStreetMap site information for protective planning, via the public Overpass API (free, no key; fair-use
// policy: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances). Queries are built only
// from validated coordinates and a bounded radius; answers are parsed field by field and never trusted as HTML.
// Data is community-mapped (© OpenStreetMap contributors, ODbL): coverage and currency vary, ownership is not part
// of it, and a missing building or facility is a gap in the map, not a negative result.
import { isValidLat, isValidLon } from '../shared/geo';
import { cleanText } from '../shared/normalize';
import { buildingInfoSchema, facilitiesSchema, FACILITY_KINDS, PLAN_LIMITS, type BuildingInfo, type Facilities, type Facility } from '../shared/protectivePlan';
import { FeedHttpError, type FetchJson } from './feeds/http';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Public instance listed on the OSM wiki, used only when the main one is overloaded or unreachable. */
export const OVERPASS_FALLBACK_URL = 'https://overpass.private.coffee/api/interpreter';
const BUILDING_SEARCH_M = 30;
const M_PER_DEG = 111_320;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, max = 200) => cleanText(v, max);

function coordsOk(lat: number, lon: number): void {
  if (!isValidLat(lat) || !isValidLon(lon)) throw new Error('Invalid coordinates.');
}

export async function overpass(fetchJson: FetchJson, query: string, userAgent: string): Promise<Obj[]> {
  try {
    return await overpassAt(OVERPASS_URL, fetchJson, query, userAgent);
  } catch (e) {
    const status = e instanceof FeedHttpError ? e.status : null;
    const busy = e instanceof FeedHttpError && (e.kind === 'timeout' || e.kind === 'network' || status === 429 || status === 502 || status === 503 || status === 504);
    if (!busy) throw e;
    try {
      return await overpassAt(OVERPASS_FALLBACK_URL, fetchJson, query, userAgent);
    } catch {
      throw new Error(`OpenStreetMap (Overpass) is busy or unreachable (${e instanceof Error ? e.message : 'request failed'}). Try again in a few minutes.`);
    }
  }
}

async function overpassAt(url: string, fetchJson: FetchJson, query: string, userAgent: string): Promise<Obj[]> {
  const res = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent, Accept: 'application/json' },
    body: `data=${encodeURIComponent(query)}`,
    timeoutMs: 40_000,
    maxBytes: 8 * 1024 * 1024,
    sameOrigin: true,
  });
  const body = obj(res.body);
  if (typeof body.remark === 'string' && /runtime error|timed out|out of memory/i.test(body.remark)) throw new Error('OpenStreetMap (Overpass) could not complete the query. Try again later.');
  if (!Array.isArray(body.elements)) throw new Error('OpenStreetMap (Overpass) returned an unexpected answer.');
  return body.elements.map(obj);
}

// ------------------------------------------------------------------ geometry helpers (local metres)

function local(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  return [(lon - lon0) * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * M_PER_DEG];
}

function inside(pt: [number, number], ring: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function area(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(s) / 2;
}

/**
 * Closed rings of a multipolygon from its member ways (Overpass `out geom`): closed members are rings as they are,
 * open members are joined end to end. Null when any ring cannot be closed (the caller then reports only a bounds match).
 */
export function assembleRings(members: unknown): { outer: [number, number][][]; inner: [number, number][][] } | null {
  if (!Array.isArray(members)) return null;
  const out = { outer: [] as [number, number][][], inner: [] as [number, number][][] };
  for (const role of ['outer', 'inner'] as const) {
    const parts: [number, number][][] = [];
    for (const m of members.map(obj)) {
      if (m.type !== 'way' || (m.role || 'outer') !== role || !Array.isArray(m.geometry)) continue;
      const pts = m.geometry.map(obj).filter((g) => isValidLat(g.lat) && isValidLon(g.lon)).map((g) => [g.lon as number, g.lat as number] as [number, number]);
      if (pts.length >= 2) parts.push(pts);
    }
    const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
    while (parts.length) {
      let ring = parts.shift()!;
      let guard = 0;
      while (!same(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
        const end = ring[ring.length - 1];
        const i = parts.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
        if (i < 0) return null;
        const next = parts.splice(i, 1)[0];
        ring = ring.concat((same(next[0], end) ? next : [...next].reverse()).slice(1));
      }
      if (ring.length < 4 || !same(ring[0], ring[ring.length - 1])) return null;
      out[role].push(ring);
    }
  }
  return out.outer.length ? out : null;
}

// ------------------------------------------------------------------ tags

/** OSM height: plain metres, "12 m", or feet ("40'" / "40 ft"); anything else is not a usable height. */
export function parseHeight(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(m|meters?|metres?)?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*(ft|feet|')$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 0.3048 * 10) / 10;
  m = /^(\d+)'\s*(\d+)"?$/.exec(s);
  if (m) return Math.round((Number(m[1]) * 12 + Number(m[2])) * 0.0254 * 10) / 10;
  return null;
}

function intTag(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : null;
}

function addressOf(t: Obj): string | null {
  const line1 = [str(t['addr:housenumber'], 20), str(t['addr:street'], 120)].filter(Boolean).join(' ');
  const line2 = [str(t['addr:postcode'], 20), str(t['addr:city'], 80)].filter(Boolean).join(' ');
  const out = [line1 || str(t['addr:place'], 120), line2].filter(Boolean).join(', ');
  return out || null;
}

function useOf(t: Obj): string | null {
  const parts = [
    ['amenity', t.amenity],
    ['shop', t.shop],
    ['office', t.office],
    ['tourism', t.tourism],
    ['building use', t['building:use']],
  ]
    .map(([k, v]) => (str(v, 60) ? `${k}: ${str(v, 60)}` : null))
    .filter((v): v is string => !!v);
  return parts.length ? parts.join(' · ').slice(0, 200) : null;
}

// ------------------------------------------------------------------ building at a point

export function parseBuildingAt(elements: Obj[], lat: number, lon: number, now: Date): BuildingInfo | null {
  const p: [number, number] = [0, 0];
  let best: { el: Obj; ll: [number, number][] | null; match: 'inside' | 'nearest' | 'bounds'; d: number; a: number } | null = null;
  const rank = { inside: 0, bounds: 1, nearest: 2 } as const;
  for (const el of elements) {
    const type = el.type;
    if ((type !== 'way' && type !== 'relation') || typeof el.id !== 'number' || !Number.isInteger(el.id) || el.id <= 0) continue;
    const t = obj(el.tags);
    if (typeof t.building !== 'string' || t.building === 'no') continue;
    // Outer and inner rings: a way is one ring; a multipolygon relation is assembled from its member ways.
    let outer: [number, number][][] = [];
    let inner: [number, number][][] = [];
    if (type === 'way' && Array.isArray(el.geometry)) {
      const ll = el.geometry.map(obj).filter((g) => isValidLat(g.lat) && isValidLon(g.lon)).map((g) => [g.lon as number, g.lat as number] as [number, number]);
      if (ll.length >= 4) outer = [ll];
    } else if (type === 'relation') {
      const rings = assembleRings(el.members);
      if (rings) ({ outer, inner } = rings);
    }
    let match: 'inside' | 'nearest' | 'bounds';
    let d: number;
    let a = Infinity;
    let ll: [number, number][] | null = null;
    if (outer.length) {
      const toLocal = (r: [number, number][]) => r.map(([x, y]) => local(lat, lon, y, x));
      const lo = outer.map(toLocal);
      const li = inner.map(toLocal);
      a = lo.reduce((s, r) => s + area(r), 0) - li.reduce((s, r) => s + area(r), 0);
      // Inside an outer ring and not in a courtyard (inner ring).
      match = lo.some((r) => inside(p, r)) && !li.some((r) => inside(p, r)) ? 'inside' : 'nearest';
      d = match === 'inside' ? 0 : Math.min(...[...lo, ...li].flatMap((r) => r.slice(1).map((q, i) => segDist(p, r[i], q))));
      ll = outer.reduce((big, r) => (r.length > big.length ? r : big), outer[0]);
    } else {
      // Footprint geometry could not be assembled: only its bounding box is known, and that is all we claim.
      const b = obj(el.bounds);
      if (![b.minlat, b.maxlat].every(isValidLat) || ![b.minlon, b.maxlon].every(isValidLon)) continue;
      const cx = Math.max(b.minlon as number, Math.min(lon, b.maxlon as number));
      const cy = Math.max(b.minlat as number, Math.min(lat, b.maxlat as number));
      const q = local(lat, lon, cy, cx);
      d = Math.hypot(q[0], q[1]);
      match = 'bounds';
    }
    if (d > BUILDING_SEARCH_M) continue;
    // Prefer a footprint containing the point (the smallest, for nested parts), then a bounds-only match, then the nearest.
    const better = !best || rank[match] < rank[best.match] || (match === best.match && (match === 'inside' ? a < best.a : d < best.d));
    if (better) best = { el, ll, match, d, a };
  }
  if (!best) return null;
  const t = obj(best.el.tags);
  const levels = intTag(t['building:levels'], 0, 300);
  const reported = parseHeight(t.height);
  const height = reported !== null && reported > 0 && reported < 1000 ? { value: reported, source: 'reported' as const } : levels ? { value: levels * 3, source: 'estimated-from-levels' as const } : null;
  const edited = typeof best.el.timestamp === 'string' && Number.isFinite(Date.parse(best.el.timestamp)) ? new Date(best.el.timestamp).toISOString() : null;
  const info: BuildingInfo = {
    osmType: best.el.type as 'way' | 'relation',
    osmId: best.el.id as number,
    match: best.match,
    distanceM: Math.round(best.d * 10) / 10,
    name: str(t.name),
    buildingType: str(t.building, 80) === 'yes' ? null : str(t.building, 80),
    use: useOf(t),
    address: addressOf(t),
    height,
    levels,
    minLevel: intTag(t['building:min_level'], -20, 300),
    startDate: str(t.start_date, 40),
    operator: str(t.operator),
    footprint: best.ll ? best.ll.slice(0, 2000) : null,
    footprintAreaM2: Number.isFinite(best.a) ? Math.round(best.a) : null,
    lastEditedAt: edited,
    fetchedAt: now.toISOString(),
  };
  return buildingInfoSchema.parse(info);
}

export async function buildingAt(fetchJson: FetchJson, userAgent: string, lat: number, lon: number, now = new Date()): Promise<BuildingInfo | null> {
  coordsOk(lat, lon);
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  // Footprints near the point, plus any building whose area contains it (a large hall's edges can be far away).
  const q = `[out:json][timeout:25];is_in(${at})->.a;(way(around:${BUILDING_SEARCH_M},${at})["building"];relation(around:${BUILDING_SEARCH_M},${at})["building"];way(pivot.a)["building"];relation(pivot.a)["building"];);out tags geom meta 60;`;
  return parseBuildingAt(await overpass(fetchJson, q, userAgent), lat, lon, now);
}

// ------------------------------------------------------------------ emergency facilities

export function parseFacilities(elements: Obj[], radiusM: number, now: Date): Facilities {
  const items: Facility[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const type = el.type;
    if ((type !== 'node' && type !== 'way' && type !== 'relation') || typeof el.id !== 'number' || !Number.isInteger(el.id) || el.id <= 0) continue;
    const t = obj(el.tags);
    const kind = FACILITY_KINDS.find((k) => t.amenity === k || t.emergency === k);
    if (!kind) continue;
    const c = type === 'node' ? el : obj(el.center);
    if (!isValidLat(c.lat) || !isValidLon(c.lon)) continue;
    const key = `${type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ osmType: type, osmId: el.id, kind, name: str(t.name), lat: c.lat as number, lon: c.lon as number, emergency: kind === 'hospital' ? (t.emergency === 'yes' ? true : t.emergency === 'no' ? false : null) : null });
  }
  const truncated = items.length > PLAN_LIMITS.facilities;
  return facilitiesSchema.parse({ fetchedAt: now.toISOString(), radiusM, items: items.slice(0, PLAN_LIMITS.facilities), truncated });
}

export async function facilitiesNear(fetchJson: FetchJson, userAgent: string, lat: number, lon: number, radiusM: number, now = new Date()): Promise<Facilities> {
  coordsOk(lat, lon);
  if (!Number.isFinite(radiusM) || radiusM < 100 || radiusM > 5000) throw new Error('Radius must be 100–5000 m.');
  const r = Math.round(radiusM);
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const q = `[out:json][timeout:30];(nwr(around:${r},${at})["amenity"~"^(hospital|clinic|police|fire_station)$"];nwr(around:${r},${at})["emergency"~"^(ambulance_station|assembly_point)$"];);out tags center ${PLAN_LIMITS.facilities + 1};`;
  return parseFacilities(await overpass(fetchJson, q, userAgent), r, now);
}
