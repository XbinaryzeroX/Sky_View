// An aircraft's path for its current flight, as OpenSky Network reports it (GET /api/tracks/all, experimental).
// These are OpenSky's own recorded waypoints, not app fixes: they are shown as a separate line and never written to
// history. OpenSky keeps waypoints only when the course changes, so straight segments have few points.

import { isValidLat, isValidLon } from './geo';
import { cleanText } from './normalize';
import type { TrackPoint } from './layers';

export interface FlightPath {
  icao24: string;
  callsign: string | null;
  /** First and last waypoint times reported by OpenSky (UTC ISO). */
  startTime: string | null;
  endTime: string | null;
  points: TrackPoint[];
  /** Waypoints dropped as malformed. */
  skipped: number;
  /** When the app received it (UTC ISO). */
  retrievedAt: string;
  source: 'OpenSky Network';
}

/** OpenSky caps a track at the current flight; this bounds what one reply can grow to. */
export const FLIGHT_PATH_MAX_POINTS = 5000;

const iso = (s: unknown): string | null => (typeof s === 'number' && Number.isFinite(s) && s > 0 ? new Date(s * 1000).toISOString() : null);

/** Normalizes `{icao24, callsign, startTime, endTime, path: [[time, lat, lon, baroAltM, trueTrack, onGround], …]}`. */
export function normalizeOpenSkyTrack(body: unknown, icao24: string, retrievedAt: string): FlightPath {
  const b = body as { icao24?: unknown; callsign?: unknown; startTime?: unknown; endTime?: unknown; path?: unknown } | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.path)) throw new Error('OpenSky track reply has no path');
  if (typeof b.icao24 === 'string' && b.icao24.toLowerCase() !== icao24) throw new Error('OpenSky track reply is for a different aircraft');
  const points: TrackPoint[] = [];
  let skipped = 0;
  let lastT = -Infinity;
  for (const raw of b.path.slice(0, FLIGHT_PATH_MAX_POINTS)) {
    if (!Array.isArray(raw)) { skipped++; continue; }
    const [t, lat, lon, alt, track, ground] = raw as unknown[];
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= lastT || !isValidLat(lat) || !isValidLon(lon)) { skipped++; continue; }
    lastT = t;
    points.push({
      t: new Date(t * 1000).toISOString(),
      lat,
      lon,
      altM: typeof alt === 'number' && Number.isFinite(alt) && alt > -500 && alt < 30000 ? alt : null,
      heading: typeof track === 'number' && Number.isFinite(track) ? ((track % 360) + 360) % 360 : null,
      onGround: typeof ground === 'boolean' ? ground : null,
    });
  }
  skipped += Math.max(0, b.path.length - FLIGHT_PATH_MAX_POINTS);
  return {
    icao24,
    callsign: cleanText(b.callsign, 12),
    startTime: iso(b.startTime),
    endTime: iso(b.endTime),
    points,
    skipped,
    retrievedAt,
    source: 'OpenSky Network',
  };
}
