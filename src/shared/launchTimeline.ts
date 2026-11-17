// The event sequence of one launch (propellant load, liftoff, Max-Q, stage separation, landing, deployment) as
// published by The Space Devs Launch Library 2 in its detailed launch record, and the rules for replaying it on a
// clock. These are the times the source lists for the mission's sequence, relative to liftoff; they are not telemetry
// and Launch Library publishes no trajectory, so the replay moves a clock through the events and nothing on the map.

import { cleanText, toIso } from './normalize';

export interface LaunchEvent {
  /** Seconds relative to liftoff (negative before). */
  tSec: number;
  name: string;
  description: string | null;
}

export interface LaunchTimeline {
  launchId: string;
  name: string | null;
  /** Launch time (NET) the source gives, UTC ISO; null when absent. */
  net: string | null;
  events: LaunchEvent[];
  retrievedAt: string;
}

export const LAUNCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LAUNCH_EVENTS_MAX = 150;
/** Events more than three days from liftoff are left out (a malformed duration, not a launch event). */
const MAX_OFFSET_S = 3 * 86_400;

export function launchDetailUrl(id: string): string {
  if (!LAUNCH_ID.test(id)) throw new Error('Invalid launch id.');
  return `https://ll.thespacedevs.com/2.3.0/launches/${id}/?mode=detailed`;
}

/** Seconds in an ISO 8601 duration such as "-PT35M33S", "PT1H17M40S" or "P0D"; null for anything else. */
export function isoDurationSeconds(v: unknown): number | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const m = /^(-)?P(?:(\d{1,3})D)?(?:T(?:(\d{1,3})H)?(?:(\d{1,4})M)?(?:(\d{1,5}(?:\.\d{1,3})?)S)?)?$/.exec(v);
  if (!m || (m[2] === undefined && m[3] === undefined && m[4] === undefined && m[5] === undefined)) return null;
  const s = Number(m[2] ?? 0) * 86_400 + Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return m[1] ? -s : s;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Reads a detailed launch record. An absent or empty timeline gives an empty list: "not published", not an error. */
export function normalizeLaunchTimeline(body: unknown, id: string, retrievedAt: string): LaunchTimeline {
  const l = obj(body);
  if (!l || l.id !== id) throw new Error('Launch Library returned a different record than the one asked for.');
  const raw = Array.isArray(l.timeline) ? l.timeline : [];
  const events: LaunchEvent[] = [];
  for (const item of raw) {
    const e = obj(item);
    const type = obj(e?.type);
    const tSec = isoDurationSeconds(e?.relative_time);
    const name = cleanText(type?.abbrev, 80);
    if (tSec === null || !name || Math.abs(tSec) > MAX_OFFSET_S) continue;
    events.push({ tSec, name, description: cleanText(type?.description, 300) });
  }
  // Stable order: by time, source order within the same second.
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tSec - b.e.tSec || a.i - b.i).map((x) => x.e).slice(0, LAUNCH_EVENTS_MAX);
  return { launchId: id, name: cleanText(l.name, 160), net: toIso(l.net), events: sorted, retrievedAt };
}

/** The clock range a replay covers: from 10 s before the first event at or after T-60 s, to the last event. */
export function replayRange(events: readonly LaunchEvent[]): { start: number; end: number } | null {
  if (!events.length) return null;
  const end = events[events.length - 1].tSec;
  const near = events.find((e) => e.tSec >= -60) ?? events[0];
  const start = Math.min(near.tSec - 10, end - 1);
  return { start, end };
}

/** Index of the latest event at or before a clock time; -1 before the first. */
export function eventIndexAt(events: readonly LaunchEvent[], tSec: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tSec <= tSec) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at;
}

/** "T-00:35:33", "T+01:17:40"; days are folded into hours. */
export function tClock(tSec: number): string {
  const s = Math.abs(Math.trunc(tSec));
  const two = (n: number) => String(n).padStart(2, '0');
  return `T${tSec < 0 ? '-' : '+'}${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

export const REPLAY_SPEEDS = [1, 10, 60, 600] as const;
