// Aircraft helpers: altitude color bands, special-squawk labels, filters,
// staleness, and bounded dead reckoning. Estimates are never presented as
// observations: callers receive the estimate age so the UI can label it.

import type { GeoRecord } from './layers';
import { geodesicDistanceKm } from './geo';

export const STALE_AFTER_S = 60;
export const EXPIRE_AFTER_S = 300;
export const MAX_EXTRAPOLATION_S = 45;

/** Altitude ramp (feet) used for markers and the legend: ground → FL400+. */
export const ALTITUDE_STOPS: { ft: number; color: string; label: string }[] = [
  { ft: 0, color: '#9aa7b4', label: 'GND' },
  { ft: 1000, color: '#3fbf5f', label: '1k' },
  { ft: 5000, color: '#b5d13a', label: '5k' },
  { ft: 10000, color: '#f2c94c', label: '10k' },
  { ft: 20000, color: '#f2994a', label: 'FL200' },
  { ft: 30000, color: '#eb5757', label: 'FL300' },
  { ft: 40000, color: '#bb6bd9', label: 'FL400' },
];

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export function altitudeColor(altFt: number | null, onGround: boolean): string {
  if (onGround || altFt === null) return ALTITUDE_STOPS[0].color;
  const s = ALTITUDE_STOPS;
  if (altFt >= s[s.length - 1].ft) return s[s.length - 1].color;
  for (let i = 1; i < s.length; i++) {
    if (altFt <= s[i].ft) {
      const t = (altFt - s[i - 1].ft) / (s[i].ft - s[i - 1].ft);
      const a = hex(s[i - 1].color);
      const b = hex(s[i].color);
      const m = a.map((v, k) => Math.round(v + (b[k] - v) * t));
      return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return s[s.length - 1].color;
}

const SQUAWKS: Record<string, string> = {
  '7500': 'Squawk 7500 reported (unlawful interference code)',
  '7600': 'Squawk 7600 reported (radio failure code)',
  '7700': 'Squawk 7700 reported (general emergency code)',
};
const EMERGENCY: Record<string, string> = {
  general: 'Emergency status reported: general',
  lifeguard: 'Emergency status reported: lifeguard/medical',
  minfuel: 'Emergency status reported: minimum fuel',
  nordo: 'Emergency status reported: no radio',
  unlawful: 'Emergency status reported: unlawful interference',
  downed: 'Emergency status reported: downed aircraft',
  reserved: 'Emergency status reported: reserved code',
};

export interface SpecialCode {
  code: string;
  label: string;
}

/** Factual description of a reported special code; null if none. Never a confirmed incident. */
export function specialCode(r: GeoRecord): SpecialCode | null {
  const sq = typeof r.props.squawk === 'string' ? r.props.squawk : null;
  const em = typeof r.props.emergency === 'string' ? r.props.emergency : null;
  if (em && em !== 'none' && EMERGENCY[em]) return { code: em, label: EMERGENCY[em] };
  if (sq && SQUAWKS[sq]) return { code: sq, label: SQUAWKS[sq] };
  return null;
}

export type AircraftClass = 'airliner' | 'light' | 'rotorcraft' | 'military' | 'ground' | 'other';

export function aircraftClass(r: GeoRecord): AircraftClass {
  if (r.props.militaryFlag === true) return 'military';
  if (r.props.onGround === true) return 'ground';
  const c = typeof r.props.emitterCategory === 'string' ? r.props.emitterCategory : '';
  if (c === 'A7') return 'rotorcraft';
  if (c === 'A3' || c === 'A4' || c === 'A5') return 'airliner';
  if (c === 'A1' || c === 'A2' || c === 'B1' || c === 'B4') return 'light';
  return 'other';
}

export interface AircraftFilter {
  minFt: number;
  maxFt: number;
  classes: AircraftClass[];
  specialOnly: boolean;
}

export const DEFAULT_AIRCRAFT_FILTER: AircraftFilter = { minFt: 0, maxFt: 60000, classes: ['airliner', 'light', 'rotorcraft', 'military', 'ground', 'other'], specialOnly: false };

export function passesFilter(r: GeoRecord, f: AircraftFilter): boolean {
  if (f.specialOnly && !specialCode(r)) return false;
  const cls = aircraftClass(r);
  if (!f.classes.includes(cls)) return false;
  const ft = typeof r.props.altitudeFt === 'number' ? r.props.altitudeFt : r.props.onGround ? 0 : null;
  if (ft === null) return f.minFt <= 0;
  return ft >= f.minFt && ft <= f.maxFt;
}

export function ageSeconds(r: GeoRecord, nowMs: number): number | null {
  const observed = r.observedAt ? Date.parse(r.observedAt) : NaN;
  return Number.isFinite(observed) ? Math.max(0, (nowMs - observed) / 1000) : null;
}

export type TrackState = 'fresh' | 'stale' | 'expired';
export function trackState(r: GeoRecord, nowMs: number): TrackState {
  const a = ageSeconds(r, nowMs);
  if (a === null) return 'stale';
  const maxAge = typeof r.props.maxAgeS === 'number' ? r.props.maxAgeS : EXPIRE_AFTER_S;
  if (a > maxAge) return 'expired';
  if (r.props.snapshot === true) return 'stale';
  if (a > STALE_AFTER_S) return 'stale';
  return 'fresh';
}

/**
 * Dead-reckoned position from the last report using ground speed and track,
 * for at most MAX_EXTRAPOLATION_S. Returns the estimate age in seconds (0 = the
 * reported position itself). Aircraft on the ground are not extrapolated.
 */
export function deadReckon(r: GeoRecord, nowMs: number): { lat: number; lon: number; estimatedS: number } {
  const age = ageSeconds(r, nowMs);
  if (age === null || age <= 0 || !canExtrapolate(r)) return { lat: r.lat, lon: r.lon, estimatedS: 0 };
  return projectTrack(r, Math.min(age, MAX_EXTRAPOLATION_S));
}

function canExtrapolate(r: GeoRecord): boolean {
  return r.props.onGround !== true && r.props.snapshot !== true && r.props.directionSource !== 'true-heading'
    && Number.isFinite(r.heading) && r.speedKts !== null && Number.isFinite(r.speedKts) && r.speedKts >= 30;
}

function projectTrack(r: GeoRecord, t: number): { lat: number; lon: number; estimatedS: number } {
  const distM = r.speedKts! * 0.514444 * t;
  const brg = (r.heading! * Math.PI) / 180;
  const R = 6371008.8;
  const lat1 = (r.lat * Math.PI) / 180;
  const lon1 = (r.lon * Math.PI) / 180;
  const d = distM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI + 540) % 360) - 180), estimatedS: Math.round(t) };
}

/** The prediction horizon for an aircraft with a usable reported ground track. */
export function passengerMotionEndMs(r: GeoRecord): number | null {
  if (!canExtrapolate(r)) return null;
  const observed = r.observedAt ? Date.parse(r.observedAt) : NaN;
  return Number.isFinite(observed) ? observed + MAX_EXTRAPOLATION_S * 1000 : null;
}

export interface FlightDisplayPose { lat: number; lon: number; altM: number | null; heading: number }
export interface PassengerMotion {
  report: GeoRecord;
  endMs: number;
  fallbackHeading?: number;
  correction?: { start: number; end: number; lat: number; lon: number; altM: number; heading: number };
}

const shortestAngle = (degrees: number) => ((degrees % 360 + 540) % 360) - 180;

/** Sample a visual pose only. Altitude blends between reported heights and is never forecast. */
export function passengerPose(motion: PassengerMotion, now: number): FlightDisplayPose {
  const r = motion.report;
  const age = Math.max(0, Math.min(MAX_EXTRAPOLATION_S, MAX_EXTRAPOLATION_S + (now - motion.endMs) / 1000));
  const observed = r.observedAt ? Date.parse(r.observedAt) : NaN;
  const point = age > 0 && Number.isFinite(observed) && canExtrapolate(r) ? projectTrack(r, age) : r;
  const pose = { lat: point.lat, lon: point.lon, altM: r.altM, heading: r.heading ?? motion.fallbackHeading ?? 0 };
  const c = motion.correction;
  if (!c || now >= c.end) return pose;
  const u = Math.max(0, (now - c.start) / (c.end - c.start));
  const remaining = 1 - u * u * (3 - 2 * u);
  pose.lat = Math.min(90, Math.max(-90, pose.lat + c.lat * remaining));
  pose.lon = shortestAngle(pose.lon + c.lon * remaining);
  if (pose.altM !== null) pose.altM += c.altM * remaining;
  pose.heading = (pose.heading + c.heading * remaining + 360) % 360;
  return pose;
}

/** Visual bank from the rate of the smoothed direction correction, not a reported roll angle. */
export function passengerVisualBank(motion: PassengerMotion | undefined, now: number): number {
  const c = motion?.correction;
  const speed = motion?.report.speedKts;
  if (!c || typeof speed !== 'number' || !Number.isFinite(speed) || speed < 40 || now <= c.start || now >= c.end || c.end <= c.start) return 0;
  const u = (now - c.start) / (c.end - c.start);
  const turnRate = -c.heading * Math.PI / 180 * 6 * u * (1 - u) / ((c.end - c.start) / 1000);
  return Math.max(-Math.PI / 7.2, Math.min(Math.PI / 7.2, Math.atan((speed * 0.514444 * turnRate) / 9.80665)));
}

/** Reconcile a fresh fix with the pose already on screen. Duplicated polls keep the blend in progress. */
export function updatePassengerMotion(previous: PassengerMotion | undefined, r: GeoRecord, endMs: number, now: number): PassengerMotion {
  const next: PassengerMotion = { report: r, endMs };
  if (!previous) return next;
  if (r.heading === null) next.fallbackHeading = passengerPose(previous, now).heading;
  if (previous.endMs - MAX_EXTRAPOLATION_S * 1000 > now) return next;
  const old = previous.report;
  if (endMs < previous.endMs) return previous;
  if (endMs === previous.endMs && old.lat === r.lat && old.lon === r.lon && old.altM === r.altM &&
      old.heading === r.heading && old.speedKts === r.speedKts) return previous;
  if (now < endMs - MAX_EXTRAPOLATION_S * 1000) return next;
  const from = passengerPose(previous, now);
  const to = passengerPose(next, now);
  const distanceKm = geodesicDistanceKm(from.lat, from.lon, to.lat, to.lon);
  // Larger corrections take longer, so a delayed report does not move the
  // displayed aircraft and its following camera instantaneously.
  const correctionMs = Math.min(30000, Math.max(4000, distanceKm * 2000));
  next.correction = {
    start: now, end: now + correctionMs,
    lat: from.lat - to.lat, lon: shortestAngle(from.lon - to.lon),
    altM: from.altM !== null && to.altM !== null ? from.altM - to.altM : 0,
    heading: shortestAngle(from.heading - to.heading),
  };
  return next;
}

/**
 * Where a vehicle is drawn at `nowMs`: with motion smoothing on, aircraft move along their last reported track
 * (deadReckon); snapshots always stay at their reported position, in both entity and bulk rendering.
 * Every re-placement of a vehicle uses this, so a height change never moves it sideways.
 */
export function drawnPosition(r: GeoRecord, nowMs: number, o: { aircraft: boolean; smooth: boolean; snapshotsStay: boolean }): { lat: number; lon: number } {
  if (!o.aircraft || !o.smooth || r.props.snapshot === true) return { lat: r.lat, lon: r.lon };
  const p = deadReckon(r, nowMs);
  return { lat: p.lat, lon: p.lon };
}

/** Elevation angle (degrees above the horizon) of an aircraft seen from an observer, flat-earth approximation with curvature drop. */
export function elevationAngleDeg(distanceKm: number, aircraftAltM: number, observerAltM = 0): number {
  const dropM = (distanceKm * 1000) ** 2 / (2 * 6371000);
  return (Math.atan2(aircraftAltM - observerAltM - dropM, distanceKm * 1000) * 180) / Math.PI;
}

/** Validates a flight-search query for the provider lookup endpoints. */
export function classifyAircraftQuery(q: string): { kind: 'hex' | 'callsign' | 'reg'; value: string } | null {
  const v = q.trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(v)) return { kind: 'hex', value: v.toLowerCase() };
  if (/^[A-Z]{1,2}-[A-Z0-9]{2,5}$/.test(v) || /^N[0-9]{1,5}[A-Z]{0,2}$/.test(v)) return { kind: 'reg', value: v };
  if (/^[A-Z0-9]{2,8}$/.test(v)) return { kind: 'callsign', value: v };
  return null;
}
