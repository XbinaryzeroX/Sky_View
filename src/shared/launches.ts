// Space launches from The Space Devs Launch Library 2 (v2.3): the last 30 days and the next 14, placed at the launch pad.
// Launch times are scheduled or reported times, not telemetry; status words are the source's own.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText, toIso } from './normalize';

export const LAUNCH_PAST_DAYS = 30;
export const LAUNCH_AHEAD_DAYS = 14;
/** LL2 pages hold at most 100 results; a 44-day window has about 40 orbital attempts. */
export const LAUNCH_PAGE_LIMIT = 100;

/** The fixed query for the rolling window ending `aheadDays` after `now`. */
export function launchesUrl(now: Date): string {
  const day = 86_400_000;
  const from = new Date(Math.floor((now.getTime() - LAUNCH_PAST_DAYS * day) / 3_600_000) * 3_600_000).toISOString().replace('.000', '');
  const to = new Date(Math.floor((now.getTime() + LAUNCH_AHEAD_DAYS * day) / 3_600_000) * 3_600_000).toISOString().replace('.000', '');
  return `https://ll.thespacedevs.com/2.3.0/launches/?net__gte=${from}&net__lte=${to}&ordering=net&limit=${LAUNCH_PAGE_LIMIT}&mode=normal`;
}

/** Display grouping of the LL2 status abbreviation. Anything unrecognised is 'other', never a success. */
export type LaunchPhase = 'upcoming' | 'inflight' | 'success' | 'failure' | 'other';

export function launchPhase(abbrev: string | null): LaunchPhase {
  switch ((abbrev ?? '').toLowerCase()) {
    case 'go':
    case 'tbc':
    case 'tbd':
    case 'hold':
      return 'upcoming';
    case 'in flight':
      return 'inflight';
    case 'success':
    case 'deployed':
      return 'success';
    case 'failure':
    case 'partial failure':
      return 'failure';
    default:
      return 'other';
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function normalizeLaunches(body: unknown): Normalized {
  const results = obj(body)?.results;
  if (!Array.isArray(results)) throw new Error('Launch response has no results list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  let newest: string | null = null;
  for (const raw of results) {
    const l = obj(raw);
    const pad = obj(l?.pad);
    const lat = typeof pad?.latitude === 'string' ? Number(pad.latitude) : pad?.latitude;
    const lon = typeof pad?.longitude === 'string' ? Number(pad.longitude) : pad?.longitude;
    const id = cleanText(l?.id, 64);
    const net = toIso(l?.net);
    if (!l || !id || !/^[A-Za-z0-9-]+$/.test(id) || !net || !isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }
    const status = obj(l.status);
    const abbrev = cleanText(status?.abbrev, 40);
    const mission = obj(l.mission);
    const orbit = obj(mission?.orbit);
    const rocket = obj(obj(l.rocket)?.configuration);
    const provider = obj(l.launch_service_provider);
    const updated = toIso(l.last_updated);
    if (updated && (!newest || updated > newest)) newest = updated;
    const name = cleanText(l.name, 160) ?? 'Launch';
    records.push({
      id,
      lat,
      lon,
      altM: null,
      heading: null,
      speedKts: null,
      label: name,
      category: launchPhase(abbrev),
      observedAt: updated,
      // LL2 has no human-readable page per launch; the layer links the service.
      sourceUrl: 'https://thespacedevs.com/llapi',
      source: 'The Space Devs Launch Library 2',
      props: {
        launchTime: net,
        launchTimePrecision: cleanText(obj(l.net_precision)?.name, 40),
        windowStart: toIso(l.window_start),
        windowEnd: toIso(l.window_end),
        status: cleanText(status?.name, 80),
        statusAbbrev: abbrev,
        failReason: cleanText(l.failreason, 400),
        provider: cleanText(provider?.name, 120),
        rocket: cleanText(rocket?.full_name, 120) ?? cleanText(rocket?.name, 120),
        mission: cleanText(mission?.name, 160),
        missionType: cleanText(mission?.type, 80),
        missionDescription: cleanText(mission?.description, 800),
        orbit: cleanText(orbit?.name, 80),
        pad: cleanText(pad?.name, 160),
        site: cleanText(obj(pad?.location)?.name, 160),
        country: cleanText(obj(pad?.country)?.alpha_2_code, 3),
        webcastLive: l.webcast_live === true,
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: newest };
}
