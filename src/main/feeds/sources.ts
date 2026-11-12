// Feed adapters. Each adapter builds requests from fixed templates and
// returns normalized records. To add a server-side cache later, implement
// the same interfaces against the cache's base URL; the UI is unaffected.

import { normalizeNwsAlerts, normalizePointZones, normalizeUsgsFeed, type NormalizedAlerts, type NormalizedQuakes } from '../../shared/normalize';
import type { FeedCoverage, LocationZones, QuakeQuery } from '../../shared/types';
import { replyFeedCoverage } from '../../shared/monitoring';
import { usgsMagnitudeFloor } from '../../shared/usgsFeed';
import { FeedHttpError, type FetchJson } from './http';

export interface AlertSource {
  readonly name: string;
  fetchActiveAlerts(): Promise<NormalizedAlerts & { coverage?: FeedCoverage }>;
  fetchPointZones(lat: number, lon: number, now: string): Promise<LocationZones>;
}

export interface QuakeSource {
  readonly name: string;
  fetchRecent(query: QuakeQuery): Promise<NormalizedQuakes & { feedKey: string; coverage?: FeedCoverage }>;
}

export function buildUserAgent(appVersion: string, contact: string): string {
  const c = contact.trim();
  return c ? `AtlasWatch/${appVersion} (${c})` : `AtlasWatch/${appVersion} (desktop monitoring app)`;
}

/** Formats a coordinate with at most 4 decimals and no trailing zeros, as NWS /points expects. */
export function formatPointCoord(v: number): string {
  return String(Number(v.toFixed(4)));
}

export class NwsAlertSource implements AlertSource {
  readonly name = 'National Weather Service';
  constructor(
    private readonly fetchJson: FetchJson,
    private readonly userAgent: () => string,
  ) {}

  private headers() {
    return { 'User-Agent': this.userAgent(), Accept: 'application/geo+json' };
  }

  async fetchActiveAlerts(): Promise<NormalizedAlerts & { coverage: FeedCoverage }> {
    const res = await this.fetchJson('https://api.weather.gov/alerts/active?status=actual', { headers: this.headers(), timeoutMs: 30000 });
    const normalized = normalizeNwsAlerts(res.body);
    const body = res.body as { pagination?: { next?: unknown } | null };
    const next = body.pagination?.next;
    const note = next !== undefined && next !== null && next !== '' ? 'NWS indicates another page; that page was not retrieved, so this reply may omit alerts.' : null;
    const coverage = replyFeedCoverage(normalized.skipped, note ? { completeness: 'partial', skippedRecords: normalized.skipped, note } : undefined);
    return { ...normalized, coverage };
  }

  async fetchPointZones(lat: number, lon: number, now: string): Promise<LocationZones> {
    const url = `https://api.weather.gov/points/${formatPointCoord(lat)},${formatPointCoord(lon)}`;
    try {
      const res = await this.fetchJson(url, { headers: this.headers(), timeoutMs: 15000 });
      return normalizePointZones(res.body, now);
    } catch (e) {
      if (e instanceof FeedHttpError && e.status === 404) {
        return { status: 'outside_coverage', zones: [], checkedAt: now, error: null };
      }
      throw e;
    }
  }
}

export function usgsFeedKey(q: QuakeQuery): string {
  const level = usgsMagnitudeFloor(q.minMagnitude)?.toFixed(1) ?? 'all';
  return `${level}_${q.window}`;
}

export class UsgsQuakeSource implements QuakeSource {
  readonly name = 'USGS Earthquake Hazards Program';
  constructor(
    private readonly fetchJson: FetchJson,
    private readonly userAgent: () => string,
  ) {}

  async fetchRecent(query: QuakeQuery) {
    const feedKey = usgsFeedKey(query);
    const res = await this.fetchJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feedKey}.geojson`, {
      headers: { 'User-Agent': this.userAgent(), Accept: 'application/geo+json, application/json' },
      timeoutMs: 30000,
    });
    const normalized = normalizeUsgsFeed(res.body);
    const body = res.body as { metadata?: { count?: unknown }; features: unknown[] };
    const count = body.metadata?.count;
    const note = count !== undefined && (!Number.isSafeInteger(count) || (count as number) < 0 || count !== body.features.length)
      ? 'USGS reported count does not match the original returned feature count; source completeness cannot be established.' : null;
    const coverage = replyFeedCoverage(normalized.skipped, note ? { completeness: 'partial', skippedRecords: normalized.skipped, note } : undefined);
    return { ...normalized, feedKey, coverage };
  }
}
