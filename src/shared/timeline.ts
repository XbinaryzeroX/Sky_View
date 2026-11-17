import type { LayerId } from './layers';
import type { Earthquake, WeatherAlert } from './types';

export interface TimelineRange {
  oldest: string | null;
  newest: string | null;
  points: number;
  nwsFrames: number;
  usgsFrames: number;
}

export interface RecordedFeed<T> {
  state: 'recorded' | 'partial' | 'gap' | 'unknown';
  /** When this app retrieved the source observation. All timestamps are UTC. */
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  scope: string | null;
  validUntil: string | null;
  reason: string | null;
  records: T[];
}

export interface TimelineHazards {
  nws: RecordedFeed<WeatherAlert>;
  usgs: RecordedFeed<Earthquake>;
}

export const REPLAY_LAYERS = ['aircraft', 'aircraftMil', 'vessels', 'transit', 'rail'] as const satisfies readonly LayerId[];
export const REPLAY_FIX_WINDOW_MS = 5 * 60_000;

/** Recorded movement can be kept up to 30 days. */
export const TRACK_MAX_RETENTION_HOURS = 720;
/** Measured on 2026-11-14: 168 bytes per fix in SQLite with its primary key and time index (300,000 aircraft fixes, 50.4 MB). */
export const TRACK_BYTES_PER_POINT = 170;
export const TRACK_STORAGE_MIN_MB = 20;
export const TRACK_STORAGE_MAX_MB = 4000;
/**
 * Fixes older than this are thinned to the first fix per object per minute. Replay looks back REPLAY_FIX_WINDOW_MS
 * (5 minutes) for each object's latest fix, so thinned periods still replay without gaps.
 */
export const TRACK_THIN_AFTER_HOURS = 6;

/** Local wall-clock value for a datetime-local input (minute precision). */
export function localInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Number of fixes the storage budget allows. */
export function trackPointBudget(storageMB: number): number {
  const mb = Math.min(TRACK_STORAGE_MAX_MB, Math.max(TRACK_STORAGE_MIN_MB, Number.isFinite(storageMB) ? storageMB : 250));
  return Math.floor((mb * 1_000_000) / TRACK_BYTES_PER_POINT);
}

export interface TimelineFrame extends TimelineHazards {
  t: string;
  points: {
    layer: LayerId;
    rid: string;
    t: string;
    lat: number;
    lon: number;
    altM: number | null;
    heading: number | null;
    onGround: boolean | null;
  }[];
}

/** Map entities and detail links share a source identifier. Keep the newest
 * publisher version per identifier on screen while the archive retains every member. */
export function replayDisplayRecords<T extends { id: string }>(records: T[], published: (record: T) => string | null): T[] {
  const byId = new Map<string, T>();
  for (const record of records) {
    const previous = byId.get(record.id);
    if (!previous || (published(record) ?? '') > (published(previous) ?? '')) byId.set(record.id, record);
  }
  return byId.size === records.length ? records : [...byId.values()];
}
