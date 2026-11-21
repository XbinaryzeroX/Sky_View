// Tropical cyclone tracks and forecast cones worldwide from GDACS (EU Joint Research Centre and UN OCHA).
// GDACS republishes the advisories of the regional centres (NHC, JTWC, JMA, IMD, Météo-France La Réunion, BoM …)
// for every basin. One geometry file per storm advisory ("episode") holds the advisory positions as small circles
// labelled "16/11 18:00 UTC", line segments between them, and one "Uncertainty Cones" polygon.
// Positions after the advisory time (the event's `todate`) are forecasts; the rest are the storm's past positions.
// API: https://www.gdacs.org/gdacsapi/swagger/index.html (read 2026-11-17).

import type { LineString, Polygon, Position } from 'geojson';
import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText } from './normalize';

/** Storms whose geometry is fetched per refresh. Each storm costs one request per new advisory. */
export const GDACS_TC_MAX_STORMS = 8;
export const GDACS_TC_SOURCE = 'GDACS (EC JRC, UN OCHA)';

export interface GdacsStorm {
  eventId: number;
  episodeId: number;
  name: string;
  alertLevel: string | null;
  /** Time of the advisory: positions after it are forecasts. */
  advisoryAt: string;
  fromDate: string | null;
  lat: number;
  lon: number;
  severity: string | null;
  countries: string | null;
  reportUrl: string;
  geometryUrl: string;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e9 ? v : null);
/** GDACS writes times without a zone; they are UTC. */
function utc(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const t = Date.parse(v + 'Z');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function gdacsTcListUrl(now: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=green;orange;red&fromDate=${day(new Date(now.getTime() - 14 * 86_400_000))}&toDate=${day(now)}`;
}

export function gdacsTcGeometryUrl(eventId: number, episodeId: number): string {
  return `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${eventId}&episodeid=${episodeId}`;
}

/** Current storms from the GDACS event list, newest advisory first. Ended storms are left out. */
export function parseGdacsTcList(body: unknown): { storms: GdacsStorm[]; skipped: number } {
  const b = obj(body);
  if (!b || !Array.isArray(b.features)) throw new Error('Unexpected GDACS event list');
  const storms: GdacsStorm[] = [];
  let skipped = 0;
  for (const f of b.features) {
    const p = obj(obj(f)?.properties);
    const g = obj(obj(f)?.geometry);
    if (!p || p.eventtype !== 'TC') { skipped++; continue; }
    if (p.iscurrent !== true && p.iscurrent !== 'true') continue;
    const eventId = int(p.eventid), episodeId = int(p.episodeid);
    const coords = Array.isArray(g?.coordinates) ? (g!.coordinates as unknown[]) : [];
    const lon = coords[0], lat = coords[1];
    const advisoryAt = utc(p.todate);
    if (!eventId || !episodeId || !advisoryAt || !isValidLat(lat) || !isValidLon(lon)) { skipped++; continue; }
    const sev = cleanText(obj(p.severitydata)?.severitytext, 120);
    storms.push({
      eventId,
      episodeId,
      name: cleanText(p.eventname, 60) ?? cleanText(p.name, 80) ?? `Storm ${eventId}`,
      alertLevel: cleanText(p.alertlevel, 12),
      advisoryAt,
      fromDate: utc(p.fromdate),
      lat,
      lon,
      severity: sev,
      countries: cleanText(p.country, 200),
      reportUrl: `https://www.gdacs.org/report.aspx?eventid=${eventId}&episodeid=${episodeId}&eventtype=TC`,
      geometryUrl: gdacsTcGeometryUrl(eventId, episodeId),
    });
  }
  storms.sort((a, b2) => b2.advisoryAt.localeCompare(a.advisoryAt));
  return { storms, skipped };
}

/** "17/11 12:00 UTC" with the year taken from the storm's start, rolling over at the new year. */
export function gdacsLabelTime(label: string, reference: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2}) (\d{2}):(\d{2})/.exec(label.trim());
  const ref = Date.parse(reference);
  if (!m || !Number.isFinite(ref)) return null;
  const refDate = new Date(ref);
  let year = refDate.getUTCFullYear();
  const month = Number(m[2]);
  if (month < refDate.getUTCMonth() + 1 - 6) year += 1; // advisories in January for a storm that started in December
  const t = Date.UTC(year, month - 1, Number(m[1]), Number(m[3]), Number(m[4]));
  const d = new Date(t);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== Number(m[1])) return null;
  return d.toISOString();
}

function ringCentre(ring: Position[]): [number, number] | null {
  const pts = ring.filter((p) => isValidLon(p[0]) && isValidLat(p[1]));
  if (pts.length < 3) return null;
  // Unwrap across the date line before averaging.
  const base = pts[0][0];
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { let dx = x - base; if (dx > 180) dx -= 360; if (dx < -180) dx += 360; sx += base + dx; sy += y; }
  let lon = sx / pts.length;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return [lon, sy / pts.length];
}

function validRing(v: unknown): Position[] | null {
  if (!Array.isArray(v) || v.length < 4 || v.length > 20_000) return null;
  const out: Position[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || !isValidLon(p[0]) || !isValidLat(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * One storm's advisory as map records: its current position, the past track (observed), the forecast track and the
 * forecast positions (predictions), and the uncertainty cone. Nothing is drawn that the file does not contain.
 */
export function normalizeGdacsTcGeometry(body: unknown, storm: GdacsStorm): Normalized {
  const b = obj(body);
  if (!b || !Array.isArray(b.features)) throw new Error('Unexpected GDACS storm geometry');
  const advisory = Date.parse(storm.advisoryAt);
  const positions: { t: string; lon: number; lat: number }[] = [];
  let cone: Polygon | null = null;
  let skipped = 0;
  for (const f of b.features) {
    const p = obj(obj(f)?.properties);
    const g = obj(obj(f)?.geometry);
    const cls = typeof p?.Class === 'string' ? p.Class : '';
    if (!p || !g) { skipped++; continue; }
    if (cls === 'Poly_Cones' && g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const ring = validRing(g.coordinates[0]);
      if (ring) cone = { type: 'Polygon', coordinates: [ring] }; else skipped++;
    } else if (cls.startsWith('Point_Polygon_Point_') && g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      const ring = validRing(g.coordinates[0]);
      const c = ring && ringCentre(ring);
      const t = typeof p.polygonlabel === 'string' ? gdacsLabelTime(p.polygonlabel, storm.fromDate ?? storm.advisoryAt) : null;
      if (c && t) positions.push({ t, lon: c[0], lat: c[1] }); else skipped++;
    }
  }
  positions.sort((a, c) => a.t.localeCompare(c.t));
  const past = positions.filter((q) => Date.parse(q.t) <= advisory);
  const future = positions.filter((q) => Date.parse(q.t) > advisory);
  const id = `gdacs-${storm.eventId}`;
  const common = { altM: null, heading: null, speedKts: null, sourceUrl: storm.reportUrl, source: GDACS_TC_SOURCE };
  const name = storm.name.replace(/-\d{2}$/, '');
  const now = past[past.length - 1] ?? { lon: storm.lon, lat: storm.lat, t: storm.advisoryAt };
  const records: GeoRecord[] = [{
    ...common,
    id,
    lat: now.lat,
    lon: now.lon,
    label: `${(storm.severity?.split(' (')[0] ?? 'Tropical cyclone').replace(' > 74 mph', '').replace('Hurricane/Typhoon', 'Hurricane or typhoon')} ${name}`,
    category: 'storm',
    observedAt: storm.advisoryAt,
    props: { kind: 'storm', alertLevel: storm.alertLevel, intensity: storm.severity, countries: storm.countries, advisory: storm.advisoryAt, firstSeen: storm.fromDate, pastPositions: past.length, forecastPositions: future.length },
  }];
  const line = (coords: Position[]): LineString => ({ type: 'LineString', coordinates: coords });
  if (past.length >= 2) records.push({ ...common, id: `${id}-track`, lat: past[0].lat, lon: past[0].lon, label: `${name} past track`, category: 'track', observedAt: storm.advisoryAt, props: { kind: 'track', from: past[0].t, to: now.t }, geometry: line(past.map((q) => [q.lon, q.lat])) });
  if (future.length >= 1) {
    records.push({ ...common, id: `${id}-forecast`, lat: now.lat, lon: now.lon, label: `${name} forecast track`, category: 'forecast', observedAt: storm.advisoryAt, props: { kind: 'forecast', issued: storm.advisoryAt, until: future[future.length - 1].t }, geometry: line([[now.lon, now.lat], ...future.map((q): Position => [q.lon, q.lat])]) });
    future.forEach((q, i) => records.push({ ...common, id: `${id}-fc${i}`, lat: q.lat, lon: q.lon, label: q.t.slice(5, 16).replace('T', ' ').replace(/^(\d{2})-(\d{2})/, '$2/$1') + ' UTC', category: 'forecastPoint', observedAt: storm.advisoryAt, props: { kind: 'forecastPoint', storm: name, forecastFor: q.t, issued: storm.advisoryAt } }));
  }
  if (cone) records.push({ ...common, id: `${id}-cone`, lat: now.lat, lon: now.lon, label: `${name} forecast cone`, category: 'cone', observedAt: storm.advisoryAt, props: { kind: 'cone', issued: storm.advisoryAt, meaning: 'Likely area of the storm centre; impacts reach beyond it' }, geometry: cone });
  return { records, skipped, sourceUpdatedAt: storm.advisoryAt };
}

/** NHC and GDACS both list Atlantic and East Pacific storms: keep the NHC point and drop the GDACS duplicate point. */
export function dropDuplicateStormPoints(nhc: GeoRecord[], gdacs: GeoRecord[]): GeoRecord[] {
  const names = new Set(nhc.map((r) => r.label.split(' ').pop()?.toUpperCase()).filter(Boolean));
  return gdacs.filter((r) => r.props.kind !== 'storm' || !names.has(r.label.split(' ').pop()?.toUpperCase()));
}
