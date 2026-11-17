// Fetches OpenSky's path for one aircraft's current flight, on request only (one aircraft the user selected).
// Anonymous OpenSky calls spend about 4 of 400 daily credits each, so replies are cached per aircraft for 5 minutes
// and concurrent asks for the same aircraft share one request.

import { normalizeOpenSkyTrack, type FlightPath } from '../shared/flightPath';
import { FeedHttpError, type FetchJson } from './feeds/http';

const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 100;

export function createFlightPathLookup(fetchJson: FetchJson, userAgent: () => string, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; path: FlightPath }>();
  const inflight = new Map<string, Promise<FlightPath>>();
  return async (icao24: string): Promise<FlightPath> => {
    const hit = cache.get(icao24);
    if (hit && now() - hit.at < CACHE_MS) return hit.path;
    const pending = inflight.get(icao24);
    if (pending) return pending;
    const run = (async () => {
      try {
        const res = await fetchJson(`https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`, {
          headers: { 'User-Agent': userAgent() }, timeoutMs: 20000, maxBytes: 4 * 1024 * 1024,
        });
        const path = normalizeOpenSkyTrack(res.body, icao24, new Date(now()).toISOString());
        if (!path.points.length) throw new Error('OpenSky has no path for this flight.');
        cache.delete(icao24);
        cache.set(icao24, { at: now(), path });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        return path;
      } catch (e) {
        if (e instanceof FeedHttpError && e.status === 404) throw new Error('OpenSky has no path for this flight (it may not be in OpenSky’s coverage).');
        if (e instanceof FeedHttpError && (e.status === 429 || e.status === 503)) throw new Error('OpenSky asked the app to wait (its daily anonymous allowance may be used up). Try again later.');
        throw e;
      } finally {
        inflight.delete(icao24);
      }
    })();
    inflight.set(icao24, run);
    return run;
  };
}
