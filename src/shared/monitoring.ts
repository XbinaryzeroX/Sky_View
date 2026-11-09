// Location monitoring: actual spatial intersection for weather alerts and
// geodesic epicenter distance for earthquakes. Never infers alert coverage
// from distance to a polygon centre.

import { isAlertCountable } from './dedupe';
import { geodesicDistanceKm, pointInGeometry } from './geo';
import { zoneKeyFromUrl } from './normalize';
import type {
  AlertMatch,
  Earthquake,
  FeedStatus,
  Freshness,
  LocationEvaluation,
  QuakeMatch,
  SavedLocation,
  WeatherAlert,
} from './types';

export const MIN_STALE_MS = 10 * 60 * 1000;

/** Age after which a feed's data is considered stale. */
export function staleAfterMs(pollSeconds: number): number {
  return Math.max(pollSeconds * 3 * 1000, MIN_STALE_MS);
}

export function freshnessOf(status: FeedStatus, pollSeconds: number, nowMs: number): Freshness {
  if (!status.lastSuccessAt) return 'unavailable';
  const age = nowMs - Date.parse(status.lastSuccessAt);
  return age > staleAfterMs(pollSeconds) ? 'stale' : 'fresh';
}

/** Determines whether a single alert applies to a location. */
export function matchAlert(loc: SavedLocation, alert: WeatherAlert): AlertMatch {
  if (alert.geometry) {
    const inside = pointInGeometry(loc.lat, loc.lon, alert.geometry, alert.bbox);
    return { alertId: alert.id, status: inside ? 'inside' : 'outside', method: 'polygon' };
  }
  // No polygon: alerts are defined by NWS zones. Compare against the zones
  // NWS reports for this location, if we have them.
  if (loc.zones.status === 'resolved' && loc.zones.zones.length > 0 && alert.affectedZones.length > 0) {
    const locZones = new Set(loc.zones.zones);
    const hit = alert.affectedZones.some((z) => {
      const key = zoneKeyFromUrl(z);
      return key !== null && locZones.has(key);
    });
    return { alertId: alert.id, status: hit ? 'inside' : 'outside', method: 'zone' };
  }
  return { alertId: alert.id, status: 'unknown', method: 'none' };
}

function coverageNote(loc: SavedLocation, unknownCount: number, freshness: Freshness): string | null {
  const notes: string[] = [];
  if (freshness === 'unavailable') notes.push('Weather alert data is unavailable; alert status cannot be determined.');
  else if (freshness === 'stale') notes.push('Weather alert data is stale; results reflect the last successful retrieval.');
  if (unknownCount > 0) {
    switch (loc.zones.status) {
      case 'outside_coverage':
        notes.push('This location is outside NWS forecast-zone coverage; zone-based alerts cannot be evaluated.');
        break;
      case 'disabled':
        notes.push('NWS zone lookup is turned off; alerts without polygons cannot be evaluated.');
        break;
      case 'error':
        notes.push('NWS zone lookup failed for this location; alerts without polygons cannot be evaluated.');
        break;
      default:
        notes.push('NWS zones for this location are not yet known; alerts without polygons cannot be evaluated yet.');
    }
  }
  return notes.length ? notes.join(' ') : null;
}

export interface EvaluationInput {
  locations: SavedLocation[];
  alerts: WeatherAlert[];
  superseded: Set<string>;
  quakes: Earthquake[];
  nwsFreshness: Freshness;
  usgsFreshness: Freshness;
  now: Date;
}

export function evaluateLocations(input: EvaluationInput): Record<string, LocationEvaluation> {
  const nowMs = input.now.getTime();
  const evaluatedAt = input.now.toISOString();
  const countable = input.nwsFreshness === 'unavailable' ? [] : input.alerts.filter((a) => isAlertCountable(a, input.superseded, nowMs));
  const quakes = input.usgsFreshness === 'unavailable' ? [] : input.quakes;
  const out: Record<string, LocationEvaluation> = {};
  for (const loc of input.locations) {
    const inside: AlertMatch[] = [];
    const unknown: AlertMatch[] = [];
    let outside = 0;
    for (const a of countable) {
      const m = matchAlert(loc, a);
      if (m.status === 'inside') inside.push(m);
      else if (m.status === 'unknown') unknown.push(m);
      else outside++;
    }
    const near: QuakeMatch[] = [];
    for (const q of quakes) {
      const d = geodesicDistanceKm(loc.lat, loc.lon, q.lat, q.lon);
      if (d <= loc.radiusKm) near.push({ quakeId: q.id, distanceKm: Math.round(d * 10) / 10 });
    }
    near.sort((a, b) => a.distanceKm - b.distanceKm);
    out[loc.id] = {
      locationId: loc.id,
      evaluatedAt,
      alertsInside: inside,
      alertsUnknown: unknown,
      alertsOutsideCount: outside,
      nwsFreshness: input.nwsFreshness,
      alertCoverageNote: coverageNote(loc, unknown.length, input.nwsFreshness),
      quakesNearby: near,
      usgsFreshness: input.usgsFreshness,
    };
  }
  return out;
}

const SEVERITY_RANK: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

export function severityRank(s: string): number {
  return SEVERITY_RANK[s] ?? 0;
}
