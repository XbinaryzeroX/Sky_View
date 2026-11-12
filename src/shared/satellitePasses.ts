// Geometric satellite passes, computed locally from the already connected TLE source.
// satellite.js: SGP4 -> Earth-fixed coordinates -> observer look angles (radians, kilometres).
// https://github.com/shashwatak/satellite-js
// Element-age policy follows the caution in https://rhodesmill.org/skyfield/earth-satellites.html
import { ecfToLookAngles, eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';

const DAY = 86400_000;
const DEG = 180 / Math.PI;
const STEP = 30_000;
const MAX_EVALUATIONS = 10000;

export interface PassObserver { lat: number; lon: number; heightM: number }
export interface SatellitePass {
  /** Null means the satellite was already above the threshold when the window began. */
  riseAt: string | null;
  /** Highest elevation within the displayed part of this pass, not necessarily the entire orbit. */
  peakAt: string;
  maxElevationDeg: number;
  peakAzimuthDeg: number;
  /** Null means the satellite is still above the threshold at the end of the window. */
  setAt: string | null;
}
export interface SatellitePassResult {
  startAt: string;
  endAt: string;
  elementEpoch: string;
  elementAgeDays: number;
  stale: boolean;
  thresholdDeg: number;
  observer: PassObserver;
  passes: SatellitePass[];
  evaluations: number;
}

function parseTle(tle: readonly [string, string]): SatRec {
  const [a, b] = tle;
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 69 || b.length !== 69 ||
      !/^1 [0-9A-Z]{5}/.test(a) || !/^2 [0-9A-Z]{5}/.test(b) || a.slice(2, 7) !== b.slice(2, 7)) {
    throw new Error('Orbital elements are missing or malformed. Reload the Satellites layer.');
  }
  const sat = twoline2satrec(a, b);
  if (![sat.jdsatepoch, sat.no, sat.ecco, sat.inclo, sat.nodeo, sat.argpo, sat.mo, sat.bstar].every(Number.isFinite) ||
      sat.no <= 0 || sat.ecco < 0 || sat.ecco >= 1 || sat.inclo < 0 || sat.inclo > Math.PI) {
    throw new Error('Orbital elements are invalid. Reload the Satellites layer.');
  }
  return sat;
}

function look(sat: SatRec, observer: PassObserver, ms: number): { elevation: number; azimuth: number } {
  const date = new Date(ms);
  const pv = propagate(sat, date);
  if (!pv || !pv.position || sat.error) throw new Error('The orbit cannot be propagated for this window (invalid or decayed elements). Reload the Satellites layer.');
  const angles = ecfToLookAngles({ latitude: observer.lat / DEG, longitude: observer.lon / DEG, height: observer.heightM / 1000 }, eciToEcf(pv.position, gstime(date)));
  if (![angles.elevation, angles.azimuth, angles.rangeSat].every(Number.isFinite) || angles.rangeSat <= 0) {
    throw new Error('The orbit calculation returned no usable position. Reload the Satellites layer.');
  }
  return { elevation: angles.elevation * DEG, azimuth: angles.azimuth * DEG };
}

/** Independent callers can inspect one geometric position; no sunlight, refraction or terrain model is applied. */
export function satelliteLookAngles(tle: readonly [string, string], observer: PassObserver, at: number): { elevation: number; azimuth: number } {
  validateObserver(observer);
  if (!Number.isFinite(at)) throw new Error('A valid prediction time is required.');
  return look(parseTle(tle), observer, at);
}

function validateObserver(observer: PassObserver): void {
  if (![observer.lat, observer.lon, observer.heightM].every(Number.isFinite) || Math.abs(observer.lat) > 90 ||
      Math.abs(observer.lon) > 180 || observer.heightM < -500 || observer.heightM > 10000) {
    throw new Error('Enter latitude −90 to 90, longitude −180 to 180 and observer elevation −500 to 10,000 m.');
  }
}

/**
 * One selected satellite, one observer, next 24 hours; fixed work and no network access.
 * Coarse samples locate local maxima, which are refined even below the threshold so brief grazing passes
 * are not lost merely because both 30-second samples are below it. Crossings are refined to 0.25 seconds;
 * this is numerical precision, not a promise of TLE or observed timing accuracy.
 */
export function predictSatellitePasses(tle: readonly [string, string], observer: PassObserver, startMs: number, thresholdDeg = 10): SatellitePassResult {
  validateObserver(observer);
  if (!Number.isFinite(startMs) || !Number.isFinite(thresholdDeg) || thresholdDeg < 0 || thresholdDeg > 85) throw new Error('Use a valid start time and an elevation threshold from 0° to 85°.');
  const sat = parseTle(tle);
  const epochMs = (sat.jdsatepoch - 2440587.5) * DAY;
  const endMs = startMs + DAY;
  if (!Number.isFinite(new Date(endMs).getTime())) throw new Error('A valid prediction time is required.');
  const ageDays = (startMs - epochMs) / DAY;
  if (Math.max(Math.abs(ageDays), Math.abs((endMs - epochMs) / DAY)) > 14) {
    throw new Error('Orbital elements are more than 14 days from this prediction window. Reload the Satellites layer before calculating passes.');
  }
  let evaluations = 0;
  type Sample = { t: number; elevation: number; azimuth: number };
  const at = (t: number): Sample => {
    if (++evaluations > MAX_EVALUATIONS) throw new Error('This orbit exceeded the calculation limit. No pass predictions are shown.');
    return { t, ...look(sat, observer, t) };
  };
  const samples: Sample[] = [];
  for (let t = startMs; t <= endMs; t += STEP) samples.push(at(t));

  // A bounded golden-section search over each sampled local-maximum bracket.
  const peaks: Sample[] = [];
  const ratio = (Math.sqrt(5) - 1) / 2;
  const brackets: [number, number][] = [[samples[0].t, samples[1].t], [samples.at(-2)!.t, samples.at(-1)!.t]];
  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    if (s.elevation < samples[i - 1].elevation || s.elevation < samples[i + 1].elevation ||
        (s.elevation === samples[i - 1].elevation && s.elevation === samples[i + 1].elevation)) continue;
    brackets.push([samples[i - 1].t, samples[i + 1].t]);
  }
  // The edge intervals need their own search: a short pass can fit between the window boundary and
  // its first/last coarse sample without producing a three-sample maximum inside the window.
  for (const bracket of brackets) {
    let [lo, hi] = bracket;
    let a = at(hi - ratio * (hi - lo));
    let b = at(lo + ratio * (hi - lo));
    while (hi - lo > 250) {
      if (a.elevation < b.elevation) { lo = a.t; a = b; b = at(lo + ratio * (hi - lo)); }
      else { hi = b.t; b = a; a = at(hi - ratio * (hi - lo)); }
    }
    peaks.push(a.elevation > b.elevation ? a : b);
  }
  const knots = [...samples, ...peaks].sort((a, b) => a.t - b.t);
  const crossing = (a: Sample, b: Sample): number => {
    const startsAbove = a.elevation >= thresholdDeg;
    let lo = a;
    let hi = b;
    while (hi.t - lo.t > 250) {
      const mid = at((lo.t + hi.t) / 2);
      if ((mid.elevation >= thresholdDeg) === startsAbove) lo = mid;
      else hi = mid;
    }
    return (lo.t + hi.t) / 2;
  };
  const iso = (t: number) => new Date(t).toISOString();
  const passes: SatellitePass[] = [];
  let open: { riseAt: string | null; peak: Sample } | null = knots[0].elevation >= thresholdDeg ? { riseAt: null, peak: knots[0] } : null;
  for (let i = 1; i < knots.length; i++) {
    const prev = knots[i - 1];
    const cur = knots[i];
    if (!open && cur.elevation >= thresholdDeg) open = { riseAt: iso(crossing(prev, cur)), peak: cur };
    if (!open) continue;
    if (cur.elevation > open.peak.elevation) open.peak = cur;
    if (cur.elevation < thresholdDeg) {
      passes.push({ riseAt: open.riseAt, peakAt: iso(open.peak.t), maxElevationDeg: open.peak.elevation, peakAzimuthDeg: open.peak.azimuth, setAt: iso(crossing(prev, cur)) });
      open = null;
    }
  }
  if (open) passes.push({ riseAt: open.riseAt, peakAt: iso(open.peak.t), maxElevationDeg: open.peak.elevation, peakAzimuthDeg: open.peak.azimuth, setAt: null });
  return { startAt: iso(startMs), endAt: iso(endMs), elementEpoch: iso(epochMs), elementAgeDays: ageDays, stale: Math.abs(ageDays) > 7, thresholdDeg, observer: { ...observer }, passes, evaluations };
}
