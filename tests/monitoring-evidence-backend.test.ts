import { describe, expect, it, vi } from 'vitest';
import type { Polygon, MultiPolygon } from 'geojson';
import { AppCore } from '../src/main/core';
import { AtlasStore } from '../src/main/store';
import { NwsAlertSource, UsgsQuakeSource, usgsFeedKey } from '../src/main/feeds/sources';
import type { FetchJson } from '../src/main/feeds/http';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { freshnessOf, matchAlert, monitoringCount, monitoringEvidence, readFeedCoverage, replyFeedCoverage } from '../src/shared/monitoring';
import { geometryBbox, pointInGeometry } from '../src/shared/geo';
import { normalizeNwsAlerts, normalizePointZones, normalizeUsgsFeed } from '../src/shared/normalize';
import type { FeedStatus, WeatherAlert } from '../src/shared/types';
import { fixture, loc, tempDbPath } from './helpers';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const at = (offset = 0) => new Date(NOW + offset).toISOString();
const a0 = normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0];
const q0 = normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0];
const square: Polygon = { type: 'Polygon', coordinates: [[[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]] };
const complete = { completeness: 'complete' as const, skippedRecords: 0, note: null };
const partial = { completeness: 'partial' as const, skippedRecords: 0, note: 'A next page was not retrieved.' };
const alert = (extra: Partial<WeatherAlert> = {}): WeatherAlert => ({ ...a0, id: 'controlled-alert', geometry: square, bbox: geometryBbox(square), references: [], status: 'Actual', messageType: 'Alert', sent: at(-1000), ends: null, expires: at(3600000), ...extra });

function harness(path = tempDbPath(), offset = 0) {
  const store = new AtlasStore(path);
  if (!store.getMeta('settings')) store.saveSettings({ ...DEFAULT_SETTINGS, zoneLookupEnabled: false });
  const clock = { ms: NOW + offset };
  const data = { alerts: [alert()], quakes: [{ ...q0, id: 'controlled-quake', ids: ['controlled-quake'], lat: 0, lon: 0 }], skippedNws: 0, skippedUsgs: 0, coverageNws: complete as typeof complete | typeof partial, coverageUsgs: complete as typeof complete | typeof partial, fail: false };
  const core = new AppCore({ store, now: () => new Date(clock.ms),
    alertSource: { name: 'controlled source fixture', fetchActiveAlerts: vi.fn(async () => { if (data.fail) throw new Error('controlled offline'); return { alerts: data.alerts, skipped: data.skippedNws, coverage: data.coverageNws, sourceUpdatedAt: at() }; }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) },
    quakeSource: { name: 'controlled source fixture', fetchRecent: vi.fn(async query => { if (data.fail) throw new Error('controlled offline'); return { quakes: data.quakes, skipped: data.skippedUsgs, coverage: data.coverageUsgs, sourceUpdatedAt: at(), feedKey: usgsFeedKey(query) }; }) },
  });
  core.init();
  const location = store.listLocations()[0] ?? core.createLocation({ name: 'Controlled saved-location fixture', category: '', notes: '', lat: 0, lon: 0, radiusKm: 5 });
  const refresh = async () => { await core.refresh('nws'); await core.refresh('usgs'); };
  const close = () => { core.stop(); store.close(); };
  return { path, store, core, clock, data, location, refresh, close };
}

describe('retrieval clocks and saved-location count evidence', () => {
  const status: FeedStatus = { feed: 'nws', state: 'ok', lastAttemptAt: at(), lastSuccessAt: at(), sourceUpdatedAt: at(), fromCache: false, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: 0, skippedRecords: 0, coverage: complete, scope: 'active-US' };
  it.each(['not-time', '2026-02-30T00:00:00Z', '2026-11-09', at(1), at(86400000)])('rejects malformed/future successful retrieval %s', lastSuccessAt => {
    expect(freshnessOf({ ...status, lastSuccessAt }, 180, NOW)).toBe('unavailable');
  });
  it('keeps valid offset/legacy ISO timestamps and exact threshold semantics', () => {
    expect(freshnessOf({ ...status, lastSuccessAt: '2026-11-09T12:00:00+00:00' }, 180, NOW)).toBe('fresh');
    expect(freshnessOf({ ...status, lastSuccessAt: at(-600000) }, 180, NOW)).toBe('fresh');
    expect(freshnessOf({ ...status, lastSuccessAt: at(-600001) }, 180, NOW)).toBe('stale');
  });
  it('independently rejects invalid/future times even if a caller claims freshness', async () => {
    const h = harness(); await h.refresh(); const snap = h.core.snapshot();
    for (const lastSuccessAt of ['invalid', at(1)]) {
      const evidence = monitoringEvidence({ ...snap, feeds: { ...snap.feeds, nws: { ...snap.feeds.nws, lastSuccessAt } } }, 'nws', h.location);
      expect(evidence.usable).toBe(false); expect(monitoringCount(evidence, 0).value).toBeNull();
    } h.close();
  });
  it('requires an actual per-location evaluation for both feeds', async () => {
    const h = harness(); await h.refresh(); const snap = { ...h.core.snapshot(), evaluations: {} };
    for (const feed of ['nws', 'usgs'] as const) { const ev = monitoringEvidence(snap, feed, h.location); expect(ev.usable).toBe(false); expect(monitoringCount(ev, 0)).toMatchObject({ state: 'unknown', value: null }); } h.close();
  });
  it('supports zero in a current complete empty reply without requiring unused zone lookup', async () => {
    const h = harness(); h.data.alerts = []; h.data.quakes = []; await h.refresh();
    for (const feed of ['nws', 'usgs'] as const) { const ev = monitoringEvidence(h.core.snapshot(), feed, h.location); expect(ev).toMatchObject({ current: true, usable: true, complete: true, canAssertZero: true }); expect(monitoringCount(ev, 0)).toMatchObject({ state: 'exact', value: 0, label: '0' }); } h.close();
  });
  it('retains positive subsets and never turns an incomplete zero into a negative result', async () => {
    const h = harness(); h.data.coverageNws = partial; h.data.coverageUsgs = partial; await h.refresh();
    const snap = h.core.snapshot(); expect(snap.evaluations[h.location.id].alertsInside).toHaveLength(1); expect(snap.evaluations[h.location.id].quakesNearby).toHaveLength(1);
    for (const feed of ['nws', 'usgs'] as const) { const ev = monitoringEvidence(snap, feed, h.location); expect(ev).toMatchObject({ current: true, usable: true, complete: false, canAssertZero: false }); expect(monitoringCount(ev, 1)).toMatchObject({ state: 'minimum', value: 1 }); expect(monitoringCount(ev, 0).value).toBeNull(); } h.close();
  });
  it('qualifies cached/stale/failed positives as past observations, not a lower bound on current totals', async () => {
    const h = harness(); h.data.coverageNws = partial; await h.refresh(); h.clock.ms += 3600000; h.data.fail = true; await h.refresh();
    const ev = monitoringEvidence(h.core.snapshot(), 'nws', h.location);
    expect(ev).toMatchObject({ current: false, usable: true, complete: false, state: 'partial' });
    expect(ev.reason).toMatch(/stale/); expect(ev.reason).toMatch(/failed/);
    expect(monitoringCount(ev, 1)).toMatchObject({ state: 'unknown', value: null, observedValue: 1, label: '≥1 in last reply; current unknown' });
    const quakeEvidence = monitoringEvidence(h.core.snapshot(), 'usgs', h.location);
    expect(monitoringCount(quakeEvidence, 0)).toMatchObject({ value: null, observedValue: 0, label: '0 last observed; current unknown' }); h.close();
  });
  it('preserves failure evidence when a new request changes transport state to loading', async () => {
    const h = harness(); await h.refresh(); h.data.fail = true; await h.refresh();
    const snap = h.core.snapshot(); snap.feeds.usgs = { ...snap.feeds.usgs, state: 'loading' };
    const ev = monitoringEvidence(snap, 'usgs', h.location);
    expect(ev.current).toBe(false); expect(ev.reason).toMatch(/completed refresh failed/); expect(ev.reason).toMatch(/in progress/); expect(monitoringCount(ev, 1).value).toBeNull(); h.close();
  });
  it('evaluates retained historical NWS lifecycle at retrieval time, separate from wall-clock evaluation', async () => {
    const h = harness(); h.data.alerts = [alert({ expires: at(5 * 60000) })]; await h.refresh();
    h.clock.ms += 20 * 60000; h.core.reevaluate(); const snap = h.core.snapshot(); const ev = snap.evaluations[h.location.id];
    expect(ev.alertsInside).toHaveLength(1); expect(ev).toMatchObject({ evaluatedAt: at(20 * 60000), nwsObservedAt: at(), nwsLifecycleAt: at(), nwsHistorical: true });
    expect(monitoringCount(monitoringEvidence(snap, 'nws', h.location), ev.alertsInside.length)).toMatchObject({ value: null, observedValue: 1, label: '1 last observed; current unknown' }); h.close();
  });
  it('respects live expiry, and refuses to relabel an old wall-clock zero as a retrieval-time zero', async () => {
    const h = harness(); h.data.alerts = [alert({ expires: at(5 * 60000) })]; await h.refresh();
    h.clock.ms += 6 * 60000; h.core.reevaluate();
    expect(h.core.snapshot().evaluations[h.location.id].alertsInside).toHaveLength(0);
    expect(monitoringCount(monitoringEvidence(h.core.snapshot(), 'nws', h.location), 0)).toMatchObject({ value: 0, state: 'exact' });
    h.clock.ms += 14 * 60000; // snapshot freshness changes before the next evaluation.
    const drifted = monitoringEvidence(h.core.snapshot(), 'nws', h.location);
    expect(drifted.usable).toBe(false); expect(drifted.reason).toMatch(/awaits recomputation/); expect(monitoringCount(drifted, 0).observedValue).toBeNull();
    h.core.reevaluate(); const snap = h.core.snapshot(); expect(snap.evaluations[h.location.id].alertsInside).toHaveLength(1);
    expect(monitoringCount(monitoringEvidence(snap, 'nws', h.location), 1).label).toBe('1 last observed; current unknown'); h.close();
  });
  it('retains alerts active at the cached reply time even if they expire before a fresh-aged cache reload', async () => {
    const h = harness(); h.data.alerts = [alert({ expires: at(5 * 60000) })]; await h.refresh(); const path = h.path; h.close();
    const reopened = harness(path, 6 * 60000); const ev = reopened.core.snapshot().evaluations[reopened.location.id];
    expect(reopened.core.freshness().nws).toBe('fresh'); expect(ev.nwsHistorical).toBe(true); expect(ev.alertsInside).toHaveLength(1);
    expect(monitoringCount(monitoringEvidence(reopened.core.snapshot(), 'nws', reopened.location), 1).label).toContain('last observed'); reopened.close();
  });
  it('uses the same source receipt time in cache, live status, archive and evaluation despite later local processing', async () => {
    const h = harness(); const ingest = h.store.ingestAlerts.bind(h.store);
    vi.spyOn(h.store, 'ingestAlerts').mockImplementation((alerts, observedAt) => { h.clock.ms += 2000; return ingest(alerts, observedAt); });
    await h.core.refresh('nws');
    expect(h.core.feeds.nws.lastSuccessAt).toBe(at()); expect(h.store.getFeedCache('nws')!.fetchedAt).toBe(at()); expect(h.store.timelineFrame(at()).nws.observedAt).toBe(at());
    expect(h.core.snapshot().evaluations[h.location.id]).toMatchObject({ evaluatedAt: at(2000), nwsObservedAt: at(), nwsLifecycleAt: at(2000), nwsHistorical: false }); h.close();
  });
});

describe('complete/partial cache persistence and selected source scope', () => {
  it('persists independent completeness/skips without replacing legacy payload shapes', async () => {
    const h = harness(); h.data.skippedNws = 2; h.data.coverageUsgs = partial; await h.refresh();
    expect(Array.isArray(h.store.getFeedCache('nws')!.payload)).toBe(true);
    const path = h.path; h.close(); const reopened = harness(path, 60000);
    expect(reopened.core.feeds.nws).toMatchObject({ fromCache: true, skippedRecords: 2, coverage: { completeness: 'partial', skippedRecords: 2 } });
    expect(reopened.core.feeds.usgs).toMatchObject({ fromCache: true, skippedRecords: 0, coverage: { completeness: 'partial' } });
    for (const feed of ['nws', 'usgs'] as const) { const ev = monitoringEvidence(reopened.core.snapshot(), feed, reopened.location); expect(ev).toMatchObject({ usable: true, current: false, complete: false }); expect(monitoringCount(ev, 1).label).toContain('current unknown'); } reopened.close();
  });
  it('treats absent/damaged pre-upgrade coverage as unknown, retaining usable observations', () => {
    const path = tempDbPath(); const store = new AtlasStore(path);
    store.setFeedCache('nws', { fetchedAt: at(), sourceUpdatedAt: at(), payload: [alert()] }); store.close();
    const h = harness(path, 60000); expect(h.core.feeds.nws.coverage?.completeness).toBe('unknown'); expect(h.core.snapshot().evaluations[h.location.id].alertsInside).toHaveLength(1);
    h.store.db.prepare("UPDATE feed_cache SET coverage = ? WHERE feed = 'nws'").run('{malformed'); h.close();
    const reopened = harness(path, 120000); expect(reopened.core.feeds.nws.coverage?.completeness).toBe('unknown'); expect(monitoringCount(monitoringEvidence(reopened.core.snapshot(), 'nws', reopened.location), 0).value).toBeNull(); reopened.close();
  });
  it('verifies existing mismatched USGS cache guard without calling old data current or a known empty query', () => {
    const path = tempDbPath(); const store = new AtlasStore(path);
    store.setFeedCache('usgs', { fetchedAt: at(), sourceUpdatedAt: at(), payload: { feedKey: 'all_hour', quakes: [q0] }, coverage: complete }); store.close();
    const h = harness(path); expect(h.core.freshness().usgs).toBe('unavailable'); expect(h.core.snapshot().quakes).toEqual([]);
    expect(h.core.feeds.usgs.lastSuccessAt).toBeNull(); expect(h.core.feeds.usgs.error).toMatch(/selected query/);
    expect(monitoringCount(monitoringEvidence(h.core.snapshot(), 'usgs', h.location), 0)).toMatchObject({ value: null, label: 'Unknown' }); h.close();
  });
  it('never loads a future cache as fresh and recovers through a real successful reply', async () => {
    const path = tempDbPath(); const store = new AtlasStore(path); store.setFeedCache('nws', { fetchedAt: at(60000), sourceUpdatedAt: at(), payload: [alert()], coverage: complete }); store.close();
    const h = harness(path); expect(h.core.freshness().nws).toBe('unavailable'); await h.core.refresh('nws'); expect(h.core.freshness().nws).toBe('fresh'); expect(h.core.feeds.nws.fromCache).toBe(false); h.close();
  });
  it('uses positive omission evidence even if a status contradictorily claims complete coverage', async () => {
    const h = harness(); await h.refresh(); const snap = h.core.snapshot(); snap.feeds.usgs.skippedRecords = 1;
    expect(monitoringEvidence(snap, 'usgs', h.location).complete).toBe(false); expect(monitoringCount(monitoringEvidence(snap, 'usgs', h.location), 0).value).toBeNull();
    expect(replyFeedCoverage(1, complete).completeness).toBe('partial'); expect(readFeedCoverage(undefined).completeness).toBe('unknown'); h.close();
  });
});

describe('actual adapter source completeness and archive/visit truth', () => {
  const nwsBody = fixture<{ features: unknown[]; updated?: string }>('nws-alerts.json');
  const usgsBody = fixture<{ features: unknown[]; metadata?: Record<string, unknown> }>('usgs-week.json');
  it('retains NWS pagination as partial without following an untrusted next page', async () => {
    const fetch = vi.fn<FetchJson>(async () => ({ status: 200, body: { ...nwsBody, features: [nwsBody.features[0]], pagination: { next: 'https://unretrieved.example/next' } } }));
    const source = new NwsAlertSource(fetch, () => 'controlled adapter fixture'); const result = await source.fetchActiveAlerts();
    expect(result.skipped).toBe(0); expect(result.coverage).toMatchObject({ completeness: 'partial', skippedRecords: 0, note: expect.stringContaining('not retrieved') }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('checks USGS count against original features before skipped normalization or alias dedup', async () => {
    const fetch = vi.fn<FetchJson>(async () => ({ status: 200, body: { ...usgsBody, features: [usgsBody.features[0], usgsBody.features[0]], metadata: { count: 2 } } }));
    const source = new UsgsQuakeSource(fetch, () => 'controlled adapter fixture');
    const good = await source.fetchRecent({ window: 'day', minMagnitude: 0 }); expect(good.quakes).toHaveLength(2); expect(good.coverage.completeness).toBe('complete');
    fetch.mockResolvedValueOnce({ status: 200, body: { ...usgsBody, features: [usgsBody.features[0]], metadata: { count: 2 } } });
    const incomplete = await source.fetchRecent({ window: 'day', minMagnitude: 0 }); expect(incomplete.skipped).toBe(0); expect(incomplete.coverage.completeness).toBe('partial');
  });
  it('archives actual pagination/count coverage as partial with zero invented skips and blocks visit difference totals', async () => {
    const first = harness(); await first.refresh(); const path = first.path; first.close();
    const second = harness(path, 60000); second.data.coverageNws = partial; second.data.coverageUsgs = partial; await second.refresh();
    expect(second.core.feeds.nws.skippedRecords).toBe(0); expect(second.store.timelineFrame(at(60000)).nws).toMatchObject({ state: 'partial', reason: 'A next page was not retrieved.' });
    expect(second.store.timelineFrame(at(60000)).usgs.state).toBe('partial');
    for (const feed of Object.values(second.core.visitBriefing().feeds)) { expect(feed.current.state).toBe('partial'); expect(feed.new.total).toBeNull(); expect(feed.noLongerReturned.total).toBeNull(); } second.close();
  });
});

describe('NWS point-zone and exact date-line boundary negatives', () => {
  it('does not turn unestablished point-zone types into outside, while retaining positive matches', () => {
    const partialPoint = normalizePointZones({ properties: { forecastZone: 'https://api.weather.gov/zones/forecast/OKZ060' } }, at());
    const location = loc({ zones: partialPoint });
    expect(matchAlert(location, alert({ geometry: null, affectedZones: ['https://api.weather.gov/zones/county/OKC143'] })).status).toBe('unknown');
    expect(matchAlert(location, alert({ geometry: null, affectedZones: ['https://api.weather.gov/zones/forecast/OKZ060', 'https://api.weather.gov/zones/county/OKC143'] })).status).toBe('inside');
    expect(matchAlert(location, alert({ geometry: null, affectedZones: ['https://api.weather.gov/zones/forecast/OKZ061'] })).status).toBe('outside');
    expect(matchAlert(location, alert({ geometry: null, affectedZones: ['not-an-NWS-zone'] })).status).toBe('unknown');
  });
  it('preserves omitted malformed/truncated zone-reference evidence through normalization and prepared matching', () => {
    const body = fixture<{ features: { properties: Record<string, unknown> }[] }>('nws-alerts.json');
    const normalize = (zones: unknown[]) => normalizeNwsAlerts({ features: [{ ...body.features[0], geometry: null, properties: { ...body.features[0].properties, affectedZones: zones } }] }).alerts[0];
    const malformed = normalize(['https://api.weather.gov/zones/forecast/OKZ061', 'https://evil.example/zones/forecast/OKZ060']);
    expect(malformed.zoneCoverageIncomplete).toBe(true); expect(malformed.affectedZones).toEqual(['https://api.weather.gov/zones/forecast/OKZ061']);
    const point = loc({ zones: { status: 'resolved', zones: ['forecast/OKZ060'], checkedAt: at(), error: null } });
    expect(matchAlert(point, malformed).status).toBe('unknown');
    const positive = normalize(['https://api.weather.gov/zones/forecast/OKZ060', null]); expect(matchAlert(point, positive).status).toBe('inside');
    expect(normalize(Array(2001).fill('https://api.weather.gov/zones/forecast/OKZ061')).zoneCoverageIncomplete).toBe(true);
  });
  it('retains independent polygon positives after point-service404 and shows its coverage limitation even with no unknown alerts', async () => {
    const h = harness(); await h.refresh(); const snap = h.core.snapshot(); const outside = { ...h.location, zones: { status: 'outside_coverage' as const, zones: [], checkedAt: at(), error: null } };
    expect(matchAlert(outside, alert()).status).toBe('inside');
    expect(monitoringEvidence(snap, 'nws', outside)).toMatchObject({ usable: true, complete: false, reason: expect.stringContaining('outside NWS zone-service coverage') }); h.close();
  });
  it.each([-180, 180])('recognizes longitude %s on either spelling of a touching polygon boundary', longitude => {
    for (const edge of [-180, 180]) {
      const a = edge < 0 ? -180 : 179, b = edge < 0 ? -179 : 180;
      const polygon: Polygon = { type: 'Polygon', coordinates: [[[a, 50], [b, 50], [b, 52], [a, 52], [a, 50]]] };
      expect(pointInGeometry(51, longitude, polygon, geometryBbox(polygon))).toBe(true);
      expect(pointInGeometry(51, 0, polygon)).toBe(false); expect(pointInGeometry(49, longitude, polygon)).toBe(false);
    }
  });
  it('preserves holes and disjoint multipolygons at the date line', () => {
    const polygon: Polygon = { type: 'Polygon', coordinates: [[[179, 50], [-179, 50], [-179, 52], [179, 52], [179, 50]], [[179.5, 50.5], [-179.5, 50.5], [-179.5, 51.5], [179.5, 51.5], [179.5, 50.5]]] };
    for (const longitude of [-180, 180]) { expect(pointInGeometry(51, longitude, polygon)).toBe(false); expect(pointInGeometry(50.1, longitude, polygon)).toBe(true); }
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [polygon.coordinates, [[[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]]] };
    expect(pointInGeometry(0.5, 10.5, multi)).toBe(true); expect(pointInGeometry(51, 0, multi)).toBe(false);
  });
});
