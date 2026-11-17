// Navigation-integrity cells from the position quality that ADS-B aircraft report about themselves (NIC, NACp, GPS loss).
// A cluster of low values is an anomaly; GNSS interference is one possible cause, not a detection. Avionics faults and
// manoeuvring military trainers also lower reported accuracy.
//
// Method ported from God's Eye View (src/layers/gnss/records.js, MIT, © 2026 Bilawal Sidhu): the per-aircraft rule
// is that project's (thresholds from 14 CFR 91.227(c), not a published jamming classifier); the cell score and bands are
// gpsjam.org's published formula (https://gpsjam.org/faq); the 30-minute window over visited views is that project's.

import type { Polygon } from 'geojson';
import type { GeoRecord } from './layers';

/** Positions can switch to MLAT after GPS loss; quality fields must still be the aircraft's own. */
const QUALIFYING_TYPES = new Set(['adsb_icao', 'mlat']);
/** Only DO-260A/B (version 1 and 2) quality fields are decoded consistently. */
const QUALIFYING_VERSIONS = new Set([1, 2]);
/** NIC below 7: containment radius of 0.2 NM or more. */
export const GNSS_NIC_THRESHOLD = 7;
/** NACp below 8: position uncertainty of 93 m or more. */
export const GNSS_NACP_THRESHOLD = 8;
const MAX_POSITION_AGE_S = 60;
/** About 55 km north-south. */
export const GNSS_CELL_DEG = 0.5;
export const GNSS_MIN_AIRCRAFT = 3;
export const GNSS_WINDOW_MS = 30 * 60_000;
export const GNSS_MEDIUM_PERCENT = 2;
export const GNSS_HIGH_PERCENT = 10;
/** Bounds the rolling store: about one dense continent of aircraft×cells. */
export const GNSS_STORE_LIMIT = 60_000;

export interface GnssRow {
  hex: string;
  lat: number;
  lon: number;
  nic: number | null;
  nacp: number | null;
  gpsLost: boolean;
  degraded: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const HEX = /^~?[0-9a-f]{6}$/;

/** The integrity facts of one adsb.lol / readsb snapshot (no identity beyond the ICAO address used for counting). */
export function normalizeGnssAircraft(body: unknown): GnssRow[] {
  const list = (body as { ac?: unknown })?.ac;
  if (!Array.isArray(list)) throw new Error('Aircraft response has no aircraft list');
  const rows: GnssRow[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const hex = typeof a.hex === 'string' ? a.hex.toLowerCase() : '';
    if (!HEX.test(hex) || seen.has(hex)) continue;
    if (!QUALIFYING_TYPES.has(String(a.type)) || !QUALIFYING_VERSIONS.has(a.version as number)) continue;
    if (a.alt_baro === 'ground' || !finite(a.alt_baro)) continue;
    const derived = (field: string) => (Array.isArray(a.tisb) && a.tisb.includes(field)) || (Array.isArray(a.mlat) && a.mlat.includes(field));
    const nic = finite(a.nic) && !derived('nic') ? a.nic : null;
    const nacp = finite(a.nac_p) && !derived('nac_p') ? a.nac_p : null;
    let lat = a.lat;
    let lon = a.lon;
    if (!finite(lat) || Math.abs(lat) > 90 || !finite(lon) || Math.abs(lon) > 180) continue;
    const age = a.seen_pos;
    if (!finite(age) || age < 0 || age > MAX_POSITION_AGE_S) continue;
    // readsb keeps gpsOkBefore while GPS is lost; place that evidence at the last good GNSS position.
    const gpsLost = finite(a.gpsOkBefore) && a.gpsOkBefore > 0;
    if (nic === null && nacp === null && !gpsLost) continue;
    if (gpsLost && finite(a.gpsOkLat) && Math.abs(a.gpsOkLat) <= 90 && finite(a.gpsOkLon) && Math.abs(a.gpsOkLon) <= 180) {
      lat = a.gpsOkLat;
      lon = a.gpsOkLon;
    }
    seen.add(hex);
    rows.push({
      hex,
      lat: lat as number,
      lon: lon as number,
      nic,
      nacp,
      gpsLost,
      degraded: gpsLost || (nacp !== null && nacp < GNSS_NACP_THRESHOLD) || (nic !== null && nic < GNSS_NIC_THRESHOLD && !(nic === 0 && nacp !== null && nacp >= 10)),
    });
  }
  return rows;
}

export function gnssCellKey(lat: number, lon: number, cellDeg = GNSS_CELL_DEG): string {
  const row = Math.floor((Math.min(lat, 89.999999) + 90) / cellDeg);
  const col = Math.floor((Math.min(lon, 179.999999) + 180) / cellDeg);
  return `${row}:${col}`;
}

export interface GnssObservation { cell: string; seenAt: number; degradedAt: number | null }
export type GnssStore = Map<string, GnssObservation>;

/**
 * Folds one snapshot into the rolling store, dated by when the snapshot was observed. Each aircraft counts once per cell
 * per window; a degraded report keeps that aircraft degraded in the cell for one window after the report.
 */
export function accumulateGnss(store: GnssStore, rows: GnssRow[], nowMs: number, observedAt = nowMs, windowMs = GNSS_WINDOW_MS): GnssStore {
  const at = Number.isFinite(observedAt) ? Math.min(observedAt, nowMs) : NaN;
  if (Number.isFinite(at) && nowMs - at <= windowMs) {
    for (const r of rows) {
      const cell = gnssCellKey(r.lat, r.lon);
      const key = `${r.hex}|${cell}`;
      const prev = store.get(key);
      store.delete(key); // re-insert so iteration order is oldest-touched first (eviction below)
      store.set(key, {
        cell,
        seenAt: Math.max(prev?.seenAt ?? at, at),
        degradedAt: r.degraded ? Math.max(prev?.degradedAt ?? at, at) : prev?.degradedAt ?? null,
      });
    }
  }
  return pruneGnss(store, nowMs, windowMs);
}

export function pruneGnss(store: GnssStore, nowMs: number, windowMs = GNSS_WINDOW_MS): GnssStore {
  for (const [key, e] of store) {
    if (nowMs - e.seenAt > windowMs) store.delete(key);
    else if (e.degradedAt !== null && nowMs - e.degradedAt > windowMs) store.set(key, { ...e, degradedAt: null });
  }
  while (store.size > GNSS_STORE_LIMIT) store.delete(store.keys().next().value!);
  return store;
}

export type GnssLevel = 'low' | 'medium' | 'high';

/** gpsjam.org cell score: one degraded aircraft is discounted, then <2% low, 2–10% medium, >10% high. */
export function gnssLevel(total: number, degraded: number): { percent: number; level: GnssLevel } {
  const percent = total > 0 ? (100 * Math.max(0, degraded - 1)) / total : 0;
  return { percent, level: percent > GNSS_HIGH_PERCENT ? 'high' : percent >= GNSS_MEDIUM_PERCENT ? 'medium' : 'low' };
}

function cellPolygon(key: string): { geometry: Polygon; lat: number; lon: number } {
  const [row, col] = key.split(':').map(Number);
  const s = row * GNSS_CELL_DEG - 90;
  const w = col * GNSS_CELL_DEG - 180;
  const n = Math.min(90, s + GNSS_CELL_DEG);
  const e = Math.min(180, w + GNSS_CELL_DEG);
  return { geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, lat: (s + n) / 2, lon: (w + e) / 2 };
}

/** Cells with at least GNSS_MIN_AIRCRAFT aircraft in the window. Empty or sparse cells are left out: blank is "no data", not "clear". */
export function gnssCells(store: GnssStore, nowIso: string): GeoRecord[] {
  const cells = new Map<string, { total: number; degraded: number }>();
  for (const e of store.values()) {
    const c = cells.get(e.cell) ?? { total: 0, degraded: 0 };
    c.total++;
    if (e.degradedAt !== null) c.degraded++;
    cells.set(e.cell, c);
  }
  const out: GeoRecord[] = [];
  for (const [key, c] of cells) {
    if (c.total < GNSS_MIN_AIRCRAFT) continue;
    const { percent, level } = gnssLevel(c.total, c.degraded);
    const { geometry, lat, lon } = cellPolygon(key);
    out.push({
      id: `cell-${key.replace(':', '-')}`,
      lat,
      lon,
      altM: null,
      heading: null,
      speedKts: null,
      label: level === 'low' ? `${c.total} aircraft, accuracy normal` : `Low accuracy: ${c.degraded} of ${c.total} aircraft`,
      category: level,
      observedAt: nowIso,
      sourceUrl: null,
      source: 'adsb.lol (ODbL) · aggregation after gpsjam.org',
      props: { aircraft: c.total, degraded: c.degraded, scorePercent: Math.round(percent * 10) / 10, level, windowMinutes: GNSS_WINDOW_MS / 60_000 },
      geometry,
    });
  }
  return out;
}
