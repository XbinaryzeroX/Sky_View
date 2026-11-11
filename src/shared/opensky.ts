// OpenSky Network worldwide aircraft snapshot (/api/states/all).
//
// Used only when the user turns on "Worldwide aircraft" and the camera is zoomed
// out beyond the adsb.lol area-query limit. Quotas (OpenSky REST docs): a
// worldwide request costs 4 credits; anonymous clients get 400 credits/day
// (→ one refresh per 15 min), a free account's API client 4,000/day (→ ~90 s).
// OpenSky's free API is intended for non-commercial use; the setting says so.

import type { GeoRecord } from './layers';

export const OPENSKY_REFRESH_ANON_S = 15 * 60;
export const OPENSKY_REFRESH_AUTH_S = 90;

// OpenSky "category" index → ADS-B emitter category code.
const CAT = ['', '', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'B1', 'B2', 'B3', 'B4', '', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'C5'];

const s = (v: unknown, max = 20) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normalizes /states/all. `maxAgeS` tells the map how long a snapshot position may be shown. */
/**
 * `geoid` (optional): height of sea level above the WGS84 ellipsoid. Altitudes are kept above sea level (the
 * barometric reference); a state with only the geometric altitude (GNSS, above the ellipsoid) is converted with it.
 * Without it, the geometric altitude is used as reported.
 */
export function normalizeOpenSky(body: unknown, maxAgeS: number, geoid?: (lat: number, lon: number) => number | null): { records: GeoRecord[]; skipped: number; time: string | null } {
  const b = body as { time?: unknown; states?: unknown };
  if (!Array.isArray(b?.states)) throw new Error('Unexpected OpenSky response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of b.states) {
    const a = raw as unknown[];
    const hex = s(a?.[0], 6)?.toLowerCase();
    const lon = n(a?.[5]);
    const lat = n(a?.[6]);
    if (!hex || !/^[0-9a-f]{6}$/.test(hex) || lon === null || lat === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    const onGround = a[8] === true;
    const baroM = n(a[7]);
    const geoM = n(a[13]);
    const altM = onGround ? 0 : baroM !== null ? baroM : geoM !== null ? geoM - (geoid?.(lat, lon) ?? 0) : null;
    const tPos = n(a[3]) ?? n(a[4]);
    const cs = s(a[1], 12);
    const cat = CAT[n(a[17]) ?? 0] || null;
    const ms = n(a[9]);
    records.push({
      id: hex,
      lat,
      lon,
      altM,
      heading: n(a[10]),
      speedKts: ms === null ? null : ms * 1.943844,
      label: cs ?? hex.toUpperCase(),
      category: null,
      observedAt: tPos === null ? null : new Date(tPos * 1000).toISOString(),
      sourceUrl: `https://opensky-network.org/aircraft-profile?icao24=${hex}`,
      source: 'OpenSky Network',
      props: {
        icao24: hex,
        callsign: cs,
        originCountry: s(a[2], 60),
        altitudeFt: altM === null ? null : Math.round(altM / 0.3048),
        onGround,
        squawk: s(a[14], 4),
        emitterCategory: cat,
        verticalRateFpm: n(a[11]) === null ? null : Math.round((n(a[11]) as number) * 196.85),
        maxAgeS,
        snapshot: true,
      },
    });
  }
  const t = n(b.time);
  return { records, skipped, time: t === null ? null : new Date(t * 1000).toISOString() };
}
