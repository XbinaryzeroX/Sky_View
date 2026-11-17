// Two reference layers read from OpenStreetMap through the public Overpass API, one map area at a time:
// military sites (bases, airfields, ranges, barracks, naval bases, training areas, military land) and the locations
// of licence-plate reader cameras. Both are what volunteer mappers have tagged (© OpenStreetMap contributors, ODbL):
// incomplete, sometimes out of date, and an empty area means "nothing mapped", not "nothing there". The camera layer
// holds locations and tags only: no plate reads, no video, nothing about any vehicle or person.
//
// To respect Overpass fair use, the view is snapped to a fixed grid block; one query covers a block and the answer
// is cached, so moving the map inside a block asks nothing.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText } from './normalize';

export type OsmSiteKind = 'military' | 'alpr';

export interface OsmSiteSpec {
  /** Grid cell in degrees; a block is two cells on a side, centred on the grid corner nearest the view centre. */
  cellDeg: number;
  /** Above this camera height nothing is asked: the area would be too large for one polite query. */
  maxHeightM: number;
  /** Most elements Overpass may return for a block. */
  cap: number;
}

export const OSM_SITES: Record<OsmSiteKind, OsmSiteSpec> = {
  military: { cellDeg: 1.5, maxHeightM: 500_000, cap: 800 },
  alpr: { cellDeg: 0.15, maxHeightM: 80_000, cap: 2000 },
};

/** How long a block's answer is reused. Mapping changes slowly; a day keeps requests rare. */
export const OSM_SITE_CACHE_MS = 24 * 3600_000;
export const OSM_SITE_CACHE_BLOCKS = 24;

export interface OsmBlock { key: string; south: number; west: number; north: number; east: number }

/**
 * The block to load for a view, or null when the view is too high or not a valid position. Blocks never cross the
 * date line or pass 85° latitude: a block that would is cut at the edge on the side the view centre is on.
 */
export function osmBlock(kind: OsmSiteKind, lat: number, lon: number, heightM: number): OsmBlock | null {
  const spec = OSM_SITES[kind];
  if (!isValidLat(lat) || !isValidLon(lon) || !Number.isFinite(heightM) || heightM > spec.maxHeightM) return null;
  const c = spec.cellDeg;
  const round = (v: number) => Math.round(v / c) * c;
  const fix = (v: number) => Number(v.toFixed(4));
  const cLat = round(lat);
  const cLon = round(lon);
  let south = cLat - c;
  let north = cLat + c;
  let west = cLon - c;
  let east = cLon + c;
  south = Math.max(-85, south);
  north = Math.min(85, north);
  if (north <= south) return null;
  if (west < -180) { if (lon < 0) west = -180; else { west += 360; east = 180; } }
  if (east > 180) { if (lon > 0) east = 180; else { east -= 360; west = -180; } }
  if (east <= west) return null;
  const b = { south: fix(south), west: fix(west), north: fix(north), east: fix(east) };
  return { key: `${kind}:${b.south},${b.west},${b.north},${b.east}`, ...b };
}

/** The fixed Overpass query for a block. Built only from the block's numbers. */
export function osmSiteQuery(kind: OsmSiteKind, b: OsmBlock): string {
  const box = `(${b.south},${b.west},${b.north},${b.east})`;
  const cap = OSM_SITES[kind].cap;
  if (kind === 'military')
    return `[out:json][timeout:25];(nwr["military"~"^(airfield|naval_base|range|barracks|base|training_area)$"]${box};nwr["landuse"="military"]${box};);out center tags ${cap};`;
  return `[out:json][timeout:25];node["man_made"="surveillance"]["surveillance:type"="ALPR"]${box};out tags ${cap};`;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

function place(e: Obj): { type: string; id: number; lat: number; lon: number } | null {
  const type = e.type;
  const id = e.id;
  if ((type !== 'node' && type !== 'way' && type !== 'relation') || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  const at = type === 'node' ? e : obj(e.center);
  const lat = at.lat;
  const lon = at.lon;
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  return { type, id, lat, lon };
}

const MILITARY_KIND: Record<string, string> = {
  airfield: 'Military airfield', naval_base: 'Naval base', range: 'Range', barracks: 'Barracks', base: 'Base', training_area: 'Training area',
};

/** Military sites: one record per mapped object, placed at the node or at the centre Overpass gives for an area. */
export function normalizeMilitarySites(elements: unknown): Normalized {
  if (!Array.isArray(elements)) throw new Error('OpenStreetMap answer has no element list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of elements) {
    const e = obj(raw);
    const p = place(e);
    const tags = obj(e.tags);
    if (!p) { skipped++; continue; }
    const id = `${p.type[0]}${p.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const mil = cleanText(tags.military, 40);
    const kind = (mil && MILITARY_KIND[mil]) ?? (tags.landuse === 'military' ? 'Military land' : null);
    if (!kind) { skipped++; continue; }
    const name = cleanText(tags['name:en'], 160) ?? cleanText(tags.name, 160);
    records.push({
      id, lat: p.lat, lon: p.lon, altM: null, heading: null, speedKts: null,
      label: name ?? `${kind} (unnamed)`,
      category: kind,
      observedAt: null,
      sourceUrl: `https://www.openstreetmap.org/${p.type}/${p.id}`,
      source: 'OpenStreetMap contributors',
      props: {
        siteKind: kind,
        operator: cleanText(tags.operator, 160),
        branch: cleanText(tags.military_service, 80),
        access: cleanText(tags.access, 40),
        placedAt: p.type === 'node' ? 'mapped point' : 'centre of the mapped area',
      },
      geometry: null,
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Compass bearing from a direction tag: degrees, or a compass word (N, NE, …). Anything else is not stated. */
export function osmDirection(v: unknown): number | null {
  const s = cleanText(v, 20);
  if (!s) return null;
  if (/^\d{1,3}(\.\d+)?$/.test(s)) { const n = Number(s); return n >= 0 && n <= 360 ? n % 360 : null; }
  const words = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const i = words.indexOf(s.toUpperCase());
  return i < 0 ? null : i * 22.5;
}

/** Licence-plate reader camera locations: the mapped point and the tags describing the device. */
export function normalizeAlprSites(elements: unknown): Normalized {
  if (!Array.isArray(elements)) throw new Error('OpenStreetMap answer has no element list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of elements) {
    const e = obj(raw);
    const p = place(e);
    const tags = obj(e.tags);
    if (!p || p.type !== 'node' || tags.man_made !== 'surveillance' || tags['surveillance:type'] !== 'ALPR') { skipped++; continue; }
    const maker = cleanText(tags.manufacturer, 80) ?? cleanText(tags.brand, 80);
    const operator = cleanText(tags.operator, 160);
    const facing = osmDirection(tags['camera:direction'] ?? tags.direction);
    records.push({
      id: `n${p.id}`, lat: p.lat, lon: p.lon, altM: null, heading: null, speedKts: null,
      label: operator ? `Plate reader (${operator})` : 'Plate reader',
      category: 'ALPR',
      observedAt: null,
      sourceUrl: `https://www.openstreetmap.org/node/${p.id}`,
      source: 'OpenStreetMap contributors',
      props: {
        operator,
        manufacturer: maker,
        // As tagged by the mapper; many cameras have no direction tag.
        facingDeg: facing,
        zone: cleanText(tags['surveillance:zone'], 40),
        mount: cleanText(tags['camera:mount'], 40),
        mappedNote: 'Location mapped by volunteers. No plate reads, images or video are available here.',
      },
      geometry: null,
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}
