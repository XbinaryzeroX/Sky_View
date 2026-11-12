import type { VisitBriefing, VisitFeedBriefing } from '../../src/shared/visitBriefing';

export const VISIT_OLD = '2026-11-10T14:01:00.123Z';
export const VISIT_NOW = '2026-11-11T14:02:00.789Z';
export function visitFixture(): VisitBriefing {
  const source = (feed: 'nws' | 'usgs'): VisitFeedBriefing => ({
    feed, status: 'ready',
    baseline: { state: 'recorded', observedAt: VISIT_OLD, sourceUpdatedAt: VISIT_OLD, scope: feed === 'nws' ? 'active-us' : '2.5_day', validUntil: '2026-11-10T14:11:00.123Z', recordCount: 2, reason: null },
    current: { state: 'recorded', observedAt: VISIT_NOW, sourceUpdatedAt: VISIT_NOW, scope: feed === 'nws' ? 'active-us' : '2.5_day', validUntil: '2026-11-11T14:12:00.789Z', recordCount: 2, reason: null },
    new: { total: 1, examples: [{ id: `${feed}-new`, label: `${feed} new record`, url: feed === 'nws' ? 'https://api.weather.gov/alerts/nws-new' : 'https://earthquake.usgs.gov/earthquakes/eventpage/usgs-new' }], truncated: false },
    updated: { total: 1, examples: [{ id: `${feed}-revised`, label: `${feed} revised record`, url: null }], truncated: false },
    noLongerReturned: { total: 1, examples: [{ id: `${feed}-absent`, label: `${feed} absent record`, url: null }], truncated: false },
    limits: ['Only the two recorded endpoints are compared; changes while closed may be missed.'],
  });
  return { version: 1, generatedAt: VISIT_NOW, sessionStartedAt: '2026-11-11T14:00:00.000Z', previousStartedAt: '2026-11-10T14:00:00.000Z', error: null, feeds: { nws: source('nws'), usgs: source('usgs') } };
}
