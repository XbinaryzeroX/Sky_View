// Bundled telecommunication cables as mapped in OpenStreetMap (built by scripts/build-cables.mjs). Read like any
// external input: malformed rows are counted and skipped. Routes are the mapped lines, which are often traced from
// charts or drawn schematically; they are not surveyed positions, and most of the world's cables are not mapped.

import { geodesicDistanceKm, isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText } from './normalize';

export interface CablesFile {
  built: string;
  osmBase: string | null;
  cables: unknown[];
}

export type CableKind = 'submarine' | 'underground';

export const CABLE_KIND_LABEL: Record<CableKind, string> = {
  submarine: 'Under water',
  underground: 'Under ground',
};

/** Okabe–Ito colours; the two kinds also differ in line width and are named in the details. */
export const CABLE_STYLE: Record<CableKind, { color: string; width: number }> = {
  submarine: { color: '#56B4E9', width: 2.5 },
  underground: { color: '#E69F00', width: 1.5 },
};

const MAX_POINTS = 5000;

export function cableRecords(file: CablesFile): Normalized {
  const rows = Array.isArray(file?.cables) ? file.cables : [];
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) { skipped++; continue; }
    const [id, kind, rawName, rawOperator, rawMedium, flat] = row as unknown[];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || (kind !== 'submarine' && kind !== 'underground') || !Array.isArray(flat) || flat.length % 2 !== 0 || flat.length > MAX_POINTS * 2) { skipped++; continue; }
    const coordinates: [number, number][] = [];
    let bad = false;
    for (let i = 0; i < flat.length; i += 2) {
      const lon = flat[i], lat = flat[i + 1];
      if (!isValidLon(lon) || !isValidLat(lat)) { bad = true; break; }
      coordinates.push([lon, lat]);
    }
    if (bad || coordinates.length < 2) { skipped++; continue; }
    let lengthKm = 0;
    for (let i = 1; i < coordinates.length; i++) lengthKm += geodesicDistanceKm(coordinates[i - 1][1], coordinates[i - 1][0], coordinates[i][1], coordinates[i][0]);
    const name = cleanText(rawName, 120);
    const operator = cleanText(rawOperator, 120);
    const mid = coordinates[Math.floor(coordinates.length / 2)];
    records.push({
      id: `way-${id}`,
      lat: mid[1], lon: mid[0], altM: null, heading: null, speedKts: null,
      label: name ?? operator ?? (kind === 'submarine' ? 'Submarine cable (unnamed)' : 'Underground cable (unnamed)'),
      category: kind,
      observedAt: null,
      sourceUrl: `https://www.openstreetmap.org/way/${id}`,
      source: '© OpenStreetMap contributors (ODbL)',
      props: {
        cableKind: CABLE_KIND_LABEL[kind],
        operator,
        medium: cleanText(rawMedium, 60),
        mappedLengthKm: Math.round(lengthKm * 10) / 10,
        mappedNote: 'Length and route of this mapped piece only. The line is as drawn in OpenStreetMap, not a surveyed position, and the cable may continue where it is not mapped.',
      },
      geometry: { type: 'LineString', coordinates },
    });
  }
  return { records, skipped, sourceUpdatedAt: typeof file?.osmBase === 'string' ? file.osmBase : null };
}

/** Largest distance a rounded corner may cut from a mapped vertex, km. */
export const CABLE_CORNER_KM = 12;
const KM_PER_DEG = 111.32;

/**
 * Display smoothing for under-water routes: each interior corner becomes a short curve through points at most
 * CABLE_CORNER_KM (and a quarter of the adjoining segment) from the mapped vertex, so the line passes within that
 * distance of every vertex and keeps both ends. Mapped routes are often schematic, drawn as straight runs with sharp
 * corners that looked jagged at ocean scale (2026-11-23). This is a visual change only; details keep the mapped points.
 * Longitudes are unwrapped across ±180° and returned in −180…180.
 */
export function smoothCableLine(coords: readonly [number, number][], cornerKm = CABLE_CORNER_KM, steps = 4): [number, number][] {
  if (coords.length < 3) return coords.map(([x, y]) => [x, y]);
  const pts: [number, number][] = [[coords[0][0], coords[0][1]]];
  for (let i = 1; i < coords.length; i++) {
    let lon = coords[i][0];
    const prev = pts[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    pts.push([lon, coords[i][1]]);
  }
  const km = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * KM_PER_DEG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), (b[1] - a[1]) * KM_PER_DEG);
  const toward = (from: [number, number], to: [number, number], d: number): [number, number] => {
    const len = km(from, to);
    const f = len > 0 ? Math.min(1, d / len) : 0;
    return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
  };
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const p1 = toward(b, a, Math.min(cornerKm, km(a, b) / 4));
    const p2 = toward(b, c, Math.min(cornerKm, km(b, c) / 4));
    // Quadratic curve p1 → p2 with the mapped vertex as its control point.
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push([u * u * p1[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * b[1] + t * t * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out.map(([x, y]) => [((((x + 180) % 360) + 360) % 360) - 180, y]);
}
