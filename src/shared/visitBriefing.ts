import type { FeedId } from './types';

export const VISIT_EXAMPLES_PER_CHANGE = 5;

export interface VisitEndpoint {
  state: 'recorded' | 'partial' | 'gap' | 'expired' | 'unavailable';
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  scope: string | null;
  validUntil: string | null;
  /** Reply members, including duplicates; change counts below use distinct source IDs. */
  recordCount: number | null;
  reason: string | null;
}

export interface VisitExample {
  id: string;
  label: string;
  url: string | null;
}

export interface VisitChanges {
  /** null means a comparison cannot be established; it must never be rendered as zero. */
  total: number | null;
  examples: VisitExample[];
  truncated: boolean;
}

export interface VisitFeedBriefing {
  feed: FeedId;
  status: 'ready' | 'limited' | 'unavailable';
  baseline: VisitEndpoint;
  current: VisitEndpoint;
  new: VisitChanges;
  updated: VisitChanges;
  /** Absence from a reply does not establish cancellation, resolution or safety. */
  noLongerReturned: VisitChanges;
  limits: string[];
}

export interface VisitBriefing {
  version: 1;
  generatedAt: string;
  sessionStartedAt: string | null;
  previousStartedAt: string | null;
  error: string | null;
  feeds: { nws: VisitFeedBriefing; usgs: VisitFeedBriefing };
}

/** Publisher links only, validated again when evidence leaves main-process storage. */
export function visitSourceUrl(feed: FeedId, value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (feed === 'nws' && url.hostname === 'api.weather.gov' && url.pathname.startsWith('/alerts/')) return url.href;
    if (feed === 'usgs' && url.hostname === 'earthquake.usgs.gov' && url.pathname.startsWith('/earthquakes/eventpage/')) return url.href;
  } catch { /* Unavailable or untrusted source links stay plain identifiers. */ }
  return null;
}
