// Location monitoring: actual spatial intersection for weather alerts and
// geodesic epicenter distance for earthquakes. Never infers alert coverage
// from distance to a polygon centre.

import { isAlertCountable } from './dedupe';
import { geodesicDistanceKm, pointInGeometry } from './geo';
import { zoneKeyFromUrl } from './normalize';
import { usgsMagnitudeFloor } from './usgsFeed';
import type {
  AppSnapshot,
  AlertMatch,
  Earthquake,
  FeedStatus,
  FeedCoverage,
  FeedId,
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
  const time = Date.parse(status.lastSuccessAt);
  const day = status.lastSuccessAt.slice(0, 10);
  const calendar = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(nowMs) || !Number.isFinite(time) || time > nowMs || !Number.isFinite(pollSeconds) || pollSeconds <= 0 ||
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(status.lastSuccessAt) ||
    !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) return 'unavailable';
  const age = nowMs - time;
  return age > staleAfterMs(pollSeconds) ? 'stale' : 'fresh';
}

export function readFeedCoverage(value: unknown): FeedCoverage {
  const unknown = (): FeedCoverage => ({ completeness: 'unknown', skippedRecords: null, note: 'Reply completeness was not recorded or is invalid; omitted observations cannot be ruled out.' });
  if (!value || typeof value !== 'object') return unknown();
  const v = value as Partial<FeedCoverage>;
  if (!['complete', 'partial', 'unknown'].includes(v.completeness ?? '') || !(v.skippedRecords === null || (Number.isSafeInteger(v.skippedRecords) && v.skippedRecords! >= 0)) || !(v.note === null || typeof v.note === 'string')) return unknown();
  if (v.completeness === 'complete' && v.skippedRecords !== 0) return unknown();
  return { completeness: v.completeness!, skippedRecords: v.skippedRecords!, note: v.note === null ? null : v.note!.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 600) };
}

/** A new normalized reply can establish completeness; a pre-upgrade cache cannot. */
export function replyFeedCoverage(skipped: unknown, coverage?: unknown): FeedCoverage {
  if (!Number.isSafeInteger(skipped) || (skipped as number) < 0) return readFeedCoverage(null);
  const count = skipped as number;
  const result = coverage === undefined ? { completeness: 'complete' as const, skippedRecords: 0, note: null } : readFeedCoverage(coverage);
  if (count > 0) {
    const omission = `Normalization omitted ${count} record(s); the reply may be incomplete.`;
    return { completeness: 'partial', skippedRecords: count, note: result.note?.includes(omission) ? result.note : [result.note, omission].filter(Boolean).join(' ') };
  }
  return result;
}

export interface MonitoringEvidence {
  state: 'current' | 'last-observed' | 'partial' | 'unknown';
  current: boolean;
  usable: boolean;
  complete: boolean;
  canAssertZero: boolean;
  reason: string;
  observedAt: string | null;
  scope: string | null;
}
export interface MonitoringCount {
  state: 'exact' | 'minimum' | 'unknown';
  /** Current source evidence only; historical observations do not bound the current total. */
  value: number | null;
  observedValue: number | null;
  label: string;
}

export function monitoringEvidence(snap: Pick<AppSnapshot, 'feeds' | 'freshness' | 'settings' | 'evaluations'> & Partial<Pick<AppSnapshot, 'generatedAt'>>, feed: FeedId, loc?: SavedLocation): MonitoringEvidence {
  const status = snap.feeds[feed];
  const expected = feed === 'nws' ? 'active-US' : `${usgsMagnitudeFloor(snap.settings.quakeMinMagnitude)?.toFixed(1) ?? 'all'}_${snap.settings.quakeWindow}`;
  const scope = status.scope ?? null;
  const checkedFreshness = freshnessOf(status, feed === 'nws' ? snap.settings.nwsPollSeconds : snap.settings.usgsPollSeconds, snap.generatedAt === undefined ? Date.now() : Date.parse(snap.generatedAt));
  const evaluation = loc ? snap.evaluations[loc.id] : undefined;
  const sourceUsable = snap.freshness[feed] !== 'unavailable' && checkedFreshness !== 'unavailable' && scope === expected;
  const sourceCurrent = sourceUsable && snap.freshness[feed] === 'fresh' && checkedFreshness === 'fresh' && status.state === 'ok' && !status.fromCache && !status.error;
  const lifecycleMatches = !loc || (evaluation && (feed !== 'nws' || (evaluation.nwsObservedAt === status.lastSuccessAt && evaluation.nwsHistorical === !sourceCurrent)));
  const usable = sourceUsable && (!loc || !!evaluation) && !!lifecycleMatches;
  const current = usable && sourceCurrent;
  const coverage = replyFeedCoverage(status.skippedRecords, readFeedCoverage(status.coverage));
  let complete = usable && coverage.completeness === 'complete';
  const notes: string[] = [];
  if (!usable) notes.push(loc && !evaluation ? 'This saved location has no computed evaluation yet.' : sourceUsable && !lifecycleMatches ? 'This location result awaits recomputation for the source observation and lifecycle time; it is not a last-observed count yet.' : scope !== expected ? 'No compatible reply establishes the selected source scope.' : 'A valid retrieval time and usable source reply are unavailable.');
  else if (!current) notes.push(`Last observed reply${status.fromCache ? ' loaded from local cache' : ''}${snap.freshness[feed] === 'stale' || checkedFreshness === 'stale' ? ' is stale' : ''}${status.state === 'error' || status.error ? '; the latest completed refresh failed' : ''}${status.state === 'loading' ? '; a new refresh is in progress' : ''}; current conditions are unknown.`);
  if (coverage.completeness !== 'complete') notes.push(coverage.note ?? 'Reply completeness is unknown or partial.');
  if (feed === 'nws' && loc) {
    if (loc.zones.status === 'outside_coverage') {
      complete = false;
      notes.push('This point is outside NWS zone-service coverage; independent polygon matches remain observed evidence. This does not establish the absence of weather hazards.');
    }
    if (!evaluation || evaluation.alertsUnknown.length) { complete = false; notes.push('Some alert intersections at this point cannot be determined.'); }
  }
  if (usable && current && complete) notes.push('Current complete reply for the selected source scope.');
  return { state: !usable ? 'unknown' : !complete ? 'partial' : current ? 'current' : 'last-observed', current, usable, complete, canAssertZero: current && complete, reason: notes.join(' '), observedAt: status.lastSuccessAt, scope };
}

export function monitoringCount(evidence: MonitoringEvidence, observedCount: number): MonitoringCount {
  if (!evidence.usable || !Number.isSafeInteger(observedCount) || observedCount < 0) return { state: 'unknown', value: null, observedValue: null, label: 'Unknown' };
  if (!evidence.current) return { state: 'unknown', value: null, observedValue: observedCount, label: !evidence.complete && observedCount === 0 ? 'Unknown; last reply incomplete' : `${evidence.complete ? '' : '≥'}${observedCount} ${evidence.complete ? 'last observed' : 'in last reply'}; current unknown` };
  if (!evidence.complete) return observedCount > 0 ? { state: 'minimum', value: observedCount, observedValue: observedCount, label: `≥${observedCount} in retrieved subset` } : { state: 'unknown', value: null, observedValue: 0, label: 'Unknown' };
  return { state: 'exact', value: observedCount, observedValue: observedCount, label: String(observedCount) };
}

function pointZones(loc: SavedLocation) {
  if (loc.zones.status !== 'resolved') return null;
  const keys = new Set<string>();
  const types = new Set<string>();
  for (const value of loc.zones.zones) {
    const key = zoneKeyFromUrl(`https://api.weather.gov/zones/${value}`);
    if (!key) continue;
    keys.add(key);
    types.add(key.slice(0, key.indexOf('/')));
  }
  return { keys, types };
}

function alertZones(alert: WeatherAlert) {
  if (alert.geometry) return null;
  const keys = alert.affectedZones.map(zoneKeyFromUrl);
  const types = new Set(keys.map(key => key ? key.slice(0, key.indexOf('/')) : null));
  return { keys, types };
}

function matchPreparedAlert(loc: SavedLocation, alert: WeatherAlert, point: ReturnType<typeof pointZones>, area: ReturnType<typeof alertZones>): AlertMatch {
  if (alert.geometry) {
    const inside = pointInGeometry(loc.lat, loc.lon, alert.geometry, alert.bbox);
    return { alertId: alert.id, status: inside ? 'inside' : 'outside', method: 'polygon' };
  }
  if (point && area?.keys.length) {
    if (area.keys.some(key => key !== null && point.keys.has(key))) return { alertId: alert.id, status: 'inside', method: 'zone' };
    if (alert.zoneCoverageIncomplete) return { alertId: alert.id, status: 'unknown', method: 'none' };
    for (const type of area.types) {
      if (type === null || !point.types.has(type)) return { alertId: alert.id, status: 'unknown', method: 'none' };
    }
    return { alertId: alert.id, status: 'outside', method: 'zone' };
  }
  return { alertId: alert.id, status: 'unknown', method: 'none' };
}

/** Determines whether a single alert applies to a location. */
export function matchAlert(loc: SavedLocation, alert: WeatherAlert): AlertMatch {
  return matchPreparedAlert(loc, alert, alert.geometry ? null : pointZones(loc), alertZones(alert));
}

function coverageNote(loc: SavedLocation, unknownCount: number, freshness: Freshness, coverage?: FeedCoverage, historicalAt?: string): string | null {
  const notes: string[] = [];
  if (freshness === 'unavailable') notes.push('Weather alert data is unavailable; alert status cannot be determined.');
  else if (freshness === 'stale') notes.push('Weather alert data is stale; results reflect the last successful retrieval.');
  if (historicalAt) notes.push(`Matches use the retained reply at ${historicalAt}; current conditions are unknown.`);
  if (coverage && coverage.completeness !== 'complete') notes.push(coverage.note ?? 'The retrieved alert reply is partial or its completeness is unknown.');
  if (loc.zones.status === 'outside_coverage') notes.push('This point is outside NWS zone-service coverage; polygon evidence is independent and weather hazards are not ruled out.');
  if (unknownCount > 0) {
    switch (loc.zones.status) {
      case 'outside_coverage':
        notes.push('Zone-based alerts cannot be fully evaluated at this point.');
        break;
      case 'disabled':
        notes.push('NWS zone lookup is turned off; alerts without polygons cannot be evaluated.');
        break;
      case 'error':
        notes.push('NWS zone lookup failed for this location; alerts without polygons cannot be evaluated.');
        break;
      case 'resolved':
        notes.push('Available point-zone data does not establish every zone type or reference required by the returned alerts.');
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
  nwsObservedAt?: string | null;
  nwsHistorical?: boolean;
  nwsCoverage?: FeedCoverage;
  usgsFreshness: Freshness;
  now: Date;
}

export function evaluateLocations(input: EvaluationInput): Record<string, LocationEvaluation> {
  const nowMs = input.now.getTime();
  const evaluatedAt = input.now.toISOString();
  const observedMs = input.nwsObservedAt ? Date.parse(input.nwsObservedAt) : NaN;
  const historical = input.nwsHistorical === true && Number.isFinite(observedMs) && observedMs <= nowMs;
  const lifecycleMs = historical ? observedMs : nowMs;
  const countable = input.nwsFreshness === 'unavailable' ? [] : input.alerts.filter((a) => isAlertCountable(a, input.superseded, lifecycleMs));
  const quakes = input.usgsFreshness === 'unavailable' ? [] : input.quakes;
  const out: Record<string, LocationEvaluation> = {};
  const areas = countable.map(alert => ({ alert, zones: alertZones(alert) }));
  for (const loc of input.locations) {
    const point = pointZones(loc);
    const inside: AlertMatch[] = [];
    const unknown: AlertMatch[] = [];
    let outside = 0;
    for (const area of areas) {
      const m = matchPreparedAlert(loc, area.alert, point, area.zones);
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
      nwsObservedAt: input.nwsObservedAt ?? null,
      nwsLifecycleAt: new Date(lifecycleMs).toISOString(),
      nwsHistorical: historical,
      alertCoverageNote: coverageNote(loc, unknown.length, input.nwsFreshness, input.nwsCoverage, historical ? input.nwsObservedAt! : undefined),
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
