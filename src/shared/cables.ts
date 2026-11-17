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
