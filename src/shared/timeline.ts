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

export const REPLAY_LAYERS = ['aircraft', 'aircraftMil', 'vessels', 'transit'] as const satisfies readonly LayerId[];
export const REPLAY_FIX_WINDOW_MS = 5 * 60_000;

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
