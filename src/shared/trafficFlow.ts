// Road traffic flow from keyless public sources: measured speed or congestion per road segment or detector, never
// individual vehicles. Each source is normalized to one congestion scale with its own basis stated on the record.
//
// Sources (checked 2026-11-14):
// - New York City DOT real-time speeds (NYC Open Data i4gi-tjb9): ~125 segments, mph, every few minutes.
// - Fintraffic road weather/TMS stations (Finland, CC BY 4.0): speed as a share of free-flow speed, 5-minute sliding.
// - Hong Kong Transport Department strategic-road detectors (DATA.GOV.HK): lane speeds every 30 s.
// - Madrid city sensors (Ayuntamiento de Madrid, informo): level of service 0–3 every 5 minutes.
// - Paris permanent counters (opendata.paris.fr, ODbL): traffic state per arc, hourly and published about a day late.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText, toIso } from './normalize';

export type FlowState = 'free' | 'slow' | 'heavy' | 'stopped' | 'unknown';

export const FLOW_STATE_LABEL: Record<FlowState, string> = {
  free: 'Free flow', slow: 'Slow', heavy: 'Heavy / queuing', stopped: 'Stopped or nearly', unknown: 'Unknown',
};

export interface FlowSource {
  id: 'nyc' | 'finland' | 'hongkong' | 'madrid' | 'paris';
  name: string;
  lat: number;
  lon: number;
  /** Loaded when the view centre is within this distance (plus a view-sized margin). */
  radiusKm: number;
  license: string;
  licenseUrl: string;
  attribution: string;
  /** How long a reply is reused before asking again. */
  cacheMs: number;
}

export const FLOW_SOURCES: FlowSource[] = [
  { id: 'nyc', name: 'New York City DOT', lat: 40.71, lon: -73.95, radiusKm: 45, license: 'NYC Open Data Terms of Use', licenseUrl: 'https://opendata.cityofnewyork.us/overview/#termsofuse', attribution: 'NYC Department of Transportation via NYC Open Data', cacheMs: 4 * 60_000 },
  { id: 'finland', name: 'Fintraffic TMS stations', lat: 63, lon: 25.5, radiusKm: 700, license: 'CC BY 4.0', licenseUrl: 'https://www.digitraffic.fi/en/terms-of-service/', attribution: 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY', cacheMs: 4 * 60_000 },
  { id: 'hongkong', name: 'Hong Kong Transport Department', lat: 22.35, lon: 114.13, radiusKm: 45, license: 'DATA.GOV.HK Terms and Conditions', licenseUrl: 'https://data.gov.hk/en/terms-and-conditions', attribution: 'Transport Department, Hong Kong SAR (DATA.GOV.HK)', cacheMs: 2 * 60_000 },
  { id: 'madrid', name: 'Madrid city traffic sensors', lat: 40.42, lon: -3.69, radiusKm: 30, license: 'Ayuntamiento de Madrid open data terms (attribution)', licenseUrl: 'https://datos.madrid.es/egob/catalogo/aviso-legal', attribution: 'Origen de los datos: Ayuntamiento de Madrid', cacheMs: 5 * 60_000 },
  { id: 'paris', name: 'Paris permanent traffic counters', lat: 48.857, lon: 2.35, radiusKm: 20, license: 'ODbL 1.0', licenseUrl: 'https://opendata.paris.fr/explore/dataset/comptages-routiers-permanents/information/', attribution: 'Ville de Paris, comptages routiers permanents (ODbL)', cacheMs: 60 * 60_000 },
];

const KM_PER_DEG = 111.32;
const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLon = ((((bLon - aLon) % 360) + 540) % 360) - 180;
  return Math.hypot((bLat - aLat) * KM_PER_DEG, dLon * KM_PER_DEG * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)));
};

/** Sources to load for a view: zoomed in to city or region scale, centre within reach. */
export function flowSourcesForView(lat: number, lon: number, heightM: number): FlowSource[] {
  if (heightM > 2_500_000) return [];
  const margin = heightM / 1000;
  return FLOW_SOURCES.filter((s) => distKm(lat, lon, s.lat, s.lon) <= s.radiusKm + margin);
}

/**
 * Speed bands for sources that publish no free-flow reference (New York, Hong Kong): the colour then says how fast
 * traffic moves, not how it compares with that road's normal speed.
 */
export function stateFromSpeedKmh(kmh: number | null): FlowState {
  if (kmh === null || !Number.isFinite(kmh) || kmh < 0) return 'unknown';
  return kmh >= 60 ? 'free' : kmh >= 40 ? 'slow' : kmh >= 20 ? 'heavy' : 'stopped';
}

/** Fintraffic: speed as a percentage of the free-flow speed (Fintraffic's own congestion basis). */
export function stateFromFreeFlowPercent(p: number | null): FlowState {
  if (p === null || !Number.isFinite(p) || p <= 0) return 'unknown';
  return p >= 90 ? 'free' : p >= 75 ? 'slow' : p >= 25 ? 'heavy' : 'stopped';
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const numOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const record = (id: string, lat: number, lon: number, label: string, state: FlowState, observedAt: string | null, src: FlowSource, props: GeoRecord['props'], line?: [number, number][]): GeoRecord => ({
  id: `${src.id}:${id}`.slice(0, 100),
  lat, lon, altM: null, heading: null, speedKts: null,
  label,
  category: state,
  observedAt,
  sourceUrl: src.licenseUrl,
  source: src.attribution,
  props: { state: FLOW_STATE_LABEL[state], source: src.name, ...props },
  geometry: line && line.length >= 2 ? { type: 'LineString', coordinates: line } : null,
});

// ---------------------------------------------------------------- New York

/** Google encoded polyline (precision 1e-5), returned as [lon, lat]. Backslashes are characters of the code, not escapes. */
export function decodePolyline(s: string, maxPoints = 2000): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < s.length && out.length < maxPoints) {
    const vals: number[] = [];
    for (let k = 0; k < 2; k++) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        if (i >= s.length) return out;
        b = s.charCodeAt(i++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32 && shift < 35);
      vals.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += vals[0];
    lon += vals[1];
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

export const NYC_URL = 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json?$select=link_id,speed,travel_time,status,data_as_of,encoded_poly_line,link_points,borough,link_name&$order=data_as_of%20DESC&$limit=1000';

/** Around the five boroughs and the bridges and approaches NYC DOT reports. */
const NYC_BOX = { s: 40.3, n: 41.2, w: -74.6, e: -73.4 };
const MAX_STEP_KM = 2;

const stepKm = (a: [number, number], b: [number, number]) => Math.hypot((b[1] - a[1]) * KM_PER_DEG, (b[0] - a[0]) * KM_PER_DEG * Math.cos((a[1] * Math.PI) / 180));
const inNyc = ([x, y]: [number, number]) => y >= NYC_BOX.s && y <= NYC_BOX.n && x >= NYC_BOX.w && x <= NYC_BOX.e;

/** The points up to the first that leaves the area or jumps more than MAX_STEP_KM. */
function soundPrefix(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    if (!inNyc(p) || (out.length && stepKm(out[out.length - 1], p) > MAX_STEP_KM)) break;
    out.push(p);
  }
  return out;
}

/**
 * NYC DOT publishes two shapes per link and both can be damaged: on 2026-11-14 the encoded line of 15 of 125 links
 * jumped hundreds to thousands of kilometres, and the plain point list is cut off at a fixed length. The encoded line
 * is used when every step is plausible; otherwise the point list up to its first bad point, marked partial; otherwise
 * the link is not drawn. A shape is never repaired or invented.
 */
export function nycLinkGeometry(r: Record<string, unknown>): { line: [number, number][]; kind: 'as published' | 'partial (as published)' | null } {
  const enc = typeof r.encoded_poly_line === 'string' ? decodePolyline(r.encoded_poly_line) : [];
  if (enc.length >= 2 && soundPrefix(enc).length === enc.length) return { line: enc, kind: 'as published' };
  const pts = typeof r.link_points === 'string'
    ? r.link_points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite)).map(([lat, lon]) => [lon, lat] as [number, number])
    : [];
  const prefix = soundPrefix(pts);
  return prefix.length >= 2 ? { line: prefix, kind: 'partial (as published)' } : { line: [], kind: null };
}

/** NYC timestamps are local (America/New_York) without an offset; converted with the offset in force at that time. */
export function nycLocalToIso(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return null;
  const naive = Date.parse(v.slice(0, 19) + 'Z');
  if (!Number.isFinite(naive)) return null;
  // Eastern time: UTC−4 between the second Sunday of March and the first Sunday of November (02:00 local), else UTC−5.
  const y = Number(v.slice(0, 4));
  const nthSunday = (month: number, n: number) => { const d = new Date(Date.UTC(y, month, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + (n - 1) * 7; };
  const dstStart = Date.UTC(y, 2, nthSunday(2, 2), 2);
  const dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 2);
  const offsetH = naive >= dstStart && naive < dstEnd ? 4 : 5;
  return new Date(naive + offsetH * 3_600_000).toISOString();
}

export function normalizeNycSpeeds(body: unknown, src: FlowSource): Normalized {
  if (!Array.isArray(body)) throw new Error('NYC speed reply is not a list');
  const latest = new Map<string, Record<string, unknown>>();
  let skipped = 0;
  for (const raw of body) {
    const r = obj(raw);
    const id = cleanText(r?.link_id, 20);
    if (!r || !id || !/^\d+$/.test(id)) { skipped++; continue; }
    const prev = latest.get(id);
    if (!prev || String(r.data_as_of ?? '') > String(prev.data_as_of ?? '')) latest.set(id, r);
  }
  const records: GeoRecord[] = [];
  let newest: string | null = null;
  for (const [id, r] of latest) {
    const geom = nycLinkGeometry(r);
    const line = geom.line;
    // A link without a reading comes back as status -101 with speed 0 and travel time 0: that is unknown, not a jam
    // (42 of 125 links on 2026-11-14).
    const reported = String(r.status ?? '0') === '0' && !(numOf(r.speed) === 0 && numOf(r.travel_time) === 0);
    const mph = reported ? numOf(r.speed) : null;
    if (line.length < 2) { skipped++; continue; }
    const kmh = mph === null ? null : mph * 1.609344;
    const at = nycLocalToIso(r.data_as_of);
    if (at && (!newest || at > newest)) newest = at;
    const mid = line[Math.floor(line.length / 2)];
    records.push(record(id, mid[1], mid[0], cleanText(r.link_name, 120) ?? `Link ${id}`, stateFromSpeedKmh(kmh), at, src,
      { speedKmh: kmh === null ? null : Math.round(kmh), speedMph: mph === null ? null : Math.round(mph), travelTimeS: reported ? numOf(r.travel_time) : null, statusCode: cleanText(r.status, 8), geometry: geom.kind, basis: 'measured speed band (no free-flow reference published)', borough: cleanText(r.borough, 40) }, line));
  }
  return { records, skipped, sourceUpdatedAt: newest };
}

// ---------------------------------------------------------------- Finland

export const FINLAND_STATIONS_URL = 'https://tie.digitraffic.fi/api/tms/v1/stations';
export const FINLAND_DATA_URL = 'https://tie.digitraffic.fi/api/tms/v1/stations/data';

export function normalizeFinlandTms(stations: unknown, data: unknown, src: FlowSource): Normalized {
  const feats = obj(stations)?.features;
  const list = obj(data)?.stations;
  if (!Array.isArray(feats) || !Array.isArray(list)) throw new Error('Fintraffic TMS reply is incomplete');
  const where = new Map<number, { lat: number; lon: number; name: string | null }>();
  for (const f of feats) {
    const o = obj(f);
    const c = obj(o?.geometry)?.coordinates;
    const id = numOf(o?.id);
    if (id !== null && Array.isArray(c) && isValidLon(c[0]) && isValidLat(c[1])) where.set(id, { lat: c[1] as number, lon: c[0] as number, name: cleanText(obj(o?.properties)?.name, 60) });
  }
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of list) {
    const s = obj(raw);
    const id = numOf(s?.id);
    const pos = id === null ? undefined : where.get(id);
    const values = Array.isArray(s?.sensorValues) ? (s!.sensorValues as unknown[]).map(obj).filter((v): v is Record<string, unknown> => !!v) : [];
    const get = (name: string) => values.find((v) => v.name === name);
    if (!pos || id === null) { skipped++; continue; }
    const dirs = [1, 2].map((d) => ({
      pct: numOf(get(`KESKINOPEUS_5MIN_LIUKUVA_SUUNTA${d}_VVAPAAS${d}`)?.value),
      kmh: numOf(get(`KESKINOPEUS_5MIN_LIUKUVA_SUUNTA${d}`)?.value),
      flow: numOf(get(`OHITUKSET_5MIN_LIUKUVA_SUUNTA${d}`)?.value),
      at: toIso(get(`KESKINOPEUS_5MIN_LIUKUVA_SUUNTA${d}`)?.measuredTime),
    }));
    if (dirs.every((d) => d.pct === null && d.kmh === null)) { skipped++; continue; }
    // The slower direction sets the colour; both are in the details.
    const states = dirs.map((d) => stateFromFreeFlowPercent(d.pct));
    const order: FlowState[] = ['stopped', 'heavy', 'slow', 'free', 'unknown'];
    const state = order.find((o) => states.includes(o)) ?? 'unknown';
    const at = dirs.map((d) => d.at).filter((x): x is string => !!x).sort().at(-1) ?? null;
    records.push(record(String(id), pos.lat, pos.lon, pos.name ? `TMS ${pos.name}` : `TMS station ${id}`, state, at, src, {
      dir1SpeedKmh: dirs[0].kmh, dir1FreeFlowPercent: dirs[0].pct, dir1VehiclesPerHour: dirs[0].flow,
      dir2SpeedKmh: dirs[1].kmh, dir2FreeFlowPercent: dirs[1].pct, dir2VehiclesPerHour: dirs[1].flow,
      basis: 'speed as a share of free-flow speed (Fintraffic), slower direction',
    }));
  }
  return { records, skipped, sourceUpdatedAt: toIso(obj(data)?.dataUpdatedTime) };
}

// ---------------------------------------------------------------- Hong Kong

export const HK_RAW_URL = 'https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml';
export const HK_INFO_URL = 'https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/traffic_speed_volume_occ_info.csv';

/** Detector locations from the published info CSV (AID_ID_Number, …, Road_EN, …, Latitude, Longitude, Direction, …). */
export function parseHkDetectorInfo(csv: string): Map<string, { lat: number; lon: number; road: string }> {
  const out = new Map<string, { lat: number; lon: number; road: string }>();
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = lines[0].split(',');
  const col = (name: string) => head.indexOf(name);
  const [iId, iRoad, iLat, iLon] = [col('AID_ID_Number'), col('Road_EN'), col('Latitude'), col('Longitude')];
  if (iId < 0 || iLat < 0 || iLon < 0) throw new Error('Hong Kong detector list has unexpected columns');
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (c[iId] && /^[A-Z0-9]{4,12}$/.test(c[iId]) && isValidLat(lat) && isValidLon(lon)) out.set(c[iId], { lat, lon, road: (cleanText(c[iRoad], 120) ?? c[iId]).trim() });
  }
  return out;
}

const tag = (block: string, name: string): string | null => {
  const m = new RegExp(`<${name.replace(/\./g, '\\.')}>([^<]*)</${name.replace(/\./g, '\\.')}>`).exec(block);
  return m ? m[1].trim() : null;
};

export function normalizeHkDetectors(xml: string, info: Map<string, { lat: number; lon: number; road: string }>, src: FlowSource): Normalized {
  if (!/<raw_speed_volume_list[\s>]/.test(xml)) throw new Error('Hong Kong detector reply is not the expected list');
  const date = tag(xml, 'date');
  // The newest period in the file (each detector is reported once per 30 s period).
  const periods = [...xml.matchAll(/<period>([\s\S]*?)<\/period>/g)].map((m) => m[1]);
  const period = periods.at(-1) ?? '';
  const to = tag(period, 'period_to');
  const at = date && to ? new Date(`${date}T${to}+08:00`).toISOString() : null;
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const m of period.matchAll(/<detector>([\s\S]*?)<\/detector>/g)) {
    const block = m[1];
    const id = tag(block, 'detector_id');
    const pos = id ? info.get(id) : undefined;
    if (!id || !pos) { skipped++; continue; }
    const lanes = [...block.matchAll(/<lane>([\s\S]*?)<\/lane>/g)].map((l) => ({ speed: numOf(tag(l[1], 'speed')), volume: numOf(tag(l[1], 'volume')), valid: tag(l[1], 'valid') === 'Y' }));
    const ok = lanes.filter((l) => l.valid && l.speed !== null);
    // A lane with no vehicles in the period still carries a speed value (70 with volume 0 in the sample): that is not a
    // measurement, so speed is averaged over lanes that counted vehicles, weighted by how many.
    const counted = ok.filter((l) => (l.volume ?? 0) > 0);
    const vehicles = counted.reduce((s, l) => s + (l.volume ?? 0), 0);
    const speed = vehicles > 0 ? counted.reduce((s, l) => s + (l.speed ?? 0) * (l.volume ?? 0), 0) / vehicles : null;
    const volume = ok.reduce((s, l) => s + (l.volume ?? 0), 0);
    records.push(record(id, pos.lat, pos.lon, pos.road, stateFromSpeedKmh(speed), at, src, {
      speedKmh: speed === null ? null : Math.round(speed), vehiclesIn30s: ok.length ? volume : null, validLanes: ok.length, lanes: lanes.length, direction: tag(block, 'direction'),
      basis: 'measured speed band (no free-flow reference published)',
    }));
  }
  return { records, skipped, sourceUpdatedAt: at };
}

// ---------------------------------------------------------------- Madrid

export const MADRID_URL = 'https://informo.madrid.es/informo/tmadrid/pm.xml';

/** ETRS89 / UTM zone 30N (Madrid's st_x, st_y) to latitude/longitude (GRS80; WGS84 within centimetres here). */
export function utm30nToLatLon(x: number, y: number): { lat: number; lon: number } {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lon0 = (-3 * Math.PI) / 180;
  const xx = x - 500000;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = xx / (n1 * k0);
  const lat = phi1 - ((n1 * Math.tan(phi1)) / r1) * (d * d / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = lon0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** "14/11/2026 20:35:02" in Madrid local time (CET/CEST) to UTC. */
export function madridLocalToIso(v: string | null): string | null {
  const m = v ? /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(v.trim()) : null;
  if (!m) return null;
  const naive = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  // EU summer time: last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC.
  const y = +m[3];
  const lastSunday = (month: number) => { const d = new Date(Date.UTC(y, month + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const start = Date.UTC(y, 2, lastSunday(2), 1);
  const end = Date.UTC(y, 9, lastSunday(9), 1);
  // Within an hour of a change the local time is ambiguous; the winter offset is assumed there.
  const asWinter = naive - 3_600_000;
  const offsetH = asWinter >= start && asWinter < end ? 2 : 1;
  return new Date(naive - offsetH * 3_600_000).toISOString();
}

const MADRID_LEVEL: FlowState[] = ['free', 'slow', 'heavy', 'stopped'];

export function normalizeMadrid(xml: string, src: FlowSource): Normalized {
  if (!/<pms[\s>]/.test(xml)) throw new Error('Madrid reply is not the expected sensor list');
  const at = madridLocalToIso(tag(xml, 'fecha_hora'));
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const m of xml.matchAll(/<pm>([\s\S]*?)<\/pm>/g)) {
    const b = m[1];
    const id = tag(b, 'idelem');
    const x = numOf(tag(b, 'st_x'));
    const y = numOf(tag(b, 'st_y'));
    if (!id || !/^\d+$/.test(id) || x === null || y === null || x < 300000 || x > 600000 || y < 4300000 || y > 4600000) { skipped++; continue; }
    const { lat, lon } = utm30nToLatLon(x, y);
    const level = numOf(tag(b, 'nivelServicio'));
    const error = tag(b, 'error') === 'S';
    const state: FlowState = error || level === null ? 'unknown' : MADRID_LEVEL[Math.round(level)] ?? 'unknown';
    records.push(record(id, lat, lon, cleanText(tag(b, 'descripcion'), 160) ?? `Sensor ${id}`, state, at, src, {
      levelOfService: level, loadPercent: numOf(tag(b, 'carga')), vehiclesPerHour: numOf(tag(b, 'intensidad')), occupancyPercent: numOf(tag(b, 'ocupacion')),
      basis: 'level of service published by the city (0 free flow – 3 congestion)',
    }));
  }
  return { records, skipped, sourceUpdatedAt: at };
}

// ---------------------------------------------------------------- Paris

export const PARIS_BASE = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents';
export const PARIS_LATEST_URL = `${PARIS_BASE}/records?select=max(t_1h)%20as%20t`;
export function parisHourUrl(hourIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(\+00:00|Z)$/.test(hourIso)) throw new Error('Unexpected Paris hour');
  return `${PARIS_BASE}/exports/json?select=iu_ac,libelle,t_1h,q,k,etat_trafic,geo_shape&where=t_1h%3Ddate'${encodeURIComponent(hourIso)}'`;
}

const PARIS_STATE: Record<string, FlowState> = { Fluide: 'free', 'Pré-saturé': 'slow', Saturé: 'heavy', Bloqué: 'stopped', Inconnu: 'unknown' };

export function normalizeParis(body: unknown, src: FlowSource): Normalized {
  if (!Array.isArray(body)) throw new Error('Paris reply is not a list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  let at: string | null = null;
  for (const raw of body.slice(0, 10000)) {
    const r = obj(raw);
    const id = cleanText(r?.iu_ac, 12);
    const coords = obj(obj(r?.geo_shape)?.geometry)?.coordinates;
    const line = Array.isArray(coords) ? (coords as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && isValidLon(p[0]) && isValidLat(p[1])).slice(0, 500) : [];
    if (!r || !id || line.length < 2) { skipped++; continue; }
    const t = toIso(r.t_1h);
    if (t && (!at || t > at)) at = t;
    const state = PARIS_STATE[String(r.etat_trafic)] ?? 'unknown';
    const mid = line[Math.floor(line.length / 2)];
    records.push(record(id, mid[1], mid[0], (cleanText(r.libelle, 120) ?? `Arc ${id}`).replace(/_/g, ' '), state, t, src, {
      vehiclesPerHour: numOf(r.q), occupancyPercent: numOf(r.k), stateReported: cleanText(r.etat_trafic, 20),
      basis: 'traffic state published by the city, hourly (about a day behind)',
    }, line));
  }
  return { records, skipped, sourceUpdatedAt: at };
}
