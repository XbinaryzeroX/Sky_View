// Air-traffic-control listening help for a selected aircraft: the nearest airports with their published
// frequencies, and a link to each airport's LiveATC.net page. Aircraft do not broadcast which frequency they
// are tuned to, so this can only suggest the airports a flight is likely talking to, never confirm it.
// LiveATC's terms forbid an app that plays their streams directly without their consent, so the app opens
// their airport page in the system browser (their own player) instead of streaming audio itself.
import { geodesicDistanceKm } from './geo';

/** Airport tuple as in the bundled catalog: icao, iata, name, lat, lon, elevationFt, country, city, size. */
export type AtcAirport = readonly [string, string, string, number, number, number | null, string, string, string];
/** Frequency tuple: type (TWR, GND, APP, …), description as published, MHz. */
export type AtcFrequency = readonly [string, string, number];

export interface AtcSuggestion {
  icao: string;
  name: string;
  distanceKm: number;
  frequencies: AtcFrequency[];
  liveAtcUrl: string | null;
}

export const ATC_SEARCH_KM = 80;
export const LIVEATC_HOME = 'https://www.liveatc.net/';

const TYPE_LABEL: Record<string, string> = {
  TWR: 'Tower', GND: 'Ground', APP: 'Approach', DEP: 'Departure', CLD: 'Clearance', ATIS: 'ATIS (recorded information)',
  CTAF: 'Common traffic (no tower)', 'A/D': 'Aerodrome', AFIS: 'Flight information',
};
export const atcTypeLabel = (type: string) => TYPE_LABEL[type] ?? type;

/** LiveATC's public airport page for an ICAO code, or null for codes LiveATC cannot have (local identifiers). */
export function liveAtcUrl(icao: string): string | null {
  return /^[A-Z]{4}$/.test(icao) ? `${LIVEATC_HOME}search/?icao=${icao}` : null;
}

/**
 * Up to `limit` airports within ATC_SEARCH_KM that publish ATC frequencies, nearest first.
 * Positions that are missing or not finite give no suggestions rather than a guess.
 */
export function nearestAtc(lat: number, lon: number, airports: readonly AtcAirport[], frequencies: Readonly<Record<string, readonly AtcFrequency[]>>, limit = 3): AtcSuggestion[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return [];
  // A cheap box first: 80 km is under 0.75° of latitude; longitude degrees shrink towards the poles.
  const dLat = ATC_SEARCH_KM / 110;
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = Math.min(180, ATC_SEARCH_KM / (111 * cos));
  const out: AtcSuggestion[] = [];
  for (const a of airports) {
    const f = frequencies[a[0]];
    if (!f?.length || Math.abs(a[3] - lat) > dLat) continue;
    const dl = Math.abs((((a[4] - lon) % 360) + 540) % 360 - 180);
    if (dl > dLon) continue;
    const distanceKm = geodesicDistanceKm(lat, lon, a[3], a[4]);
    if (distanceKm > ATC_SEARCH_KM) continue;
    out.push({ icao: a[0], name: a[2], distanceKm, frequencies: [...f], liveAtcUrl: liveAtcUrl(a[0]) });
  }
  return out.sort((x, y) => x.distanceKm - y.distanceKm).slice(0, limit);
}

/** Which frequency types are most likely in use, from height above the airport. A hint, stated as one. */
export function likelyAtcTypes(altM: number | null, onGround: boolean, airportElevationFt: number | null, distanceKm: number): string[] {
  if (onGround) return ['GND', 'TWR', 'CLD'];
  if (altM === null) return [];
  const aglFt = altM / 0.3048 - (airportElevationFt ?? 0);
  if (aglFt < 3000 && distanceKm < 20) return ['TWR', 'CTAF', 'A/D', 'AFIS'];
  if (aglFt < 18000) return ['APP', 'DEP'];
  return [];
}
