import { describe, expect, it, vi } from 'vitest';
import { AppCore } from '../src/main/core';
import { AtlasStore } from '../src/main/store';
import { TimelineArchive, TIMELINE_LIMITS } from '../src/main/timeline';
import { usgsFeedKey, type AlertSource, type QuakeSource } from '../src/main/feeds/sources';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import type { Earthquake, FeedId, WeatherAlert } from '../src/shared/types';
import { fixture, tempDbPath } from './helpers';

const START = Date.parse('2026-11-11T12:00:00.000Z');
const at = (ms = 0) => new Date(START + ms).toISOString();
const alertBase = normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0];
const quakeBase = normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0];
const alert = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({ ...alertBase, ...over });
const quake = (over: Partial<Earthquake> = {}): Earthquake => ({ ...quakeBase, ...over });
function record(store: AtlasStore, feed: FeedId, time: string, records: (WeatherAlert | Earthquake)[], options: { scope?: string; skipped?: number; source?: string | null; validForMs?: number } = {}) {
  store.recordTimelineObservation({ feed, observedAt: time, records, scope: options.scope ?? (feed === 'nws' ? 'active-US' : 'all_day'), sourceUpdatedAt: options.source === undefined ? time : options.source, skippedRecords: options.skipped ?? 0, validForMs: options.validForMs ?? 600_000 });
}

describe('recorded civil-feed membership and revisions', () => {
  it('does not backfill from legacy latest rows or caches, and unions independent movement coverage', () => {
    const store = new AtlasStore(tempDbPath());
    store.ingestAlerts([alert()], at());
    store.setFeedCache('nws', { fetchedAt: at(), sourceUpdatedAt: at(), payload: [alert()] });
    expect(store.timelineRange()).toEqual({ oldest: null, newest: null, points: 0, nwsFrames: 0, usgsFrames: 0 });
    expect(store.timelineFrame(at()).nws.state).toBe('unknown');
    store.addTrackPoints('aircraft', [{ rid: 'real-recorded-fix', t: at(-1000), lat: 1, lon: 2, alt: 100, heading: 90 }]);
    record(store, 'nws', at(), []);
    expect(store.timelineRange()).toEqual({ oldest: at(-1000), newest: at(), points: 1, nwsFrames: 1, usgsFrames: 0 });
    expect(store.trackSnapshot('aircraft', at(), 300_000)[0].t).toBe(at(-1000));
    store.close();
  });

  it('preserves same-ID NWS text/geometry and USGS magnitude/coordinates as they were observed', () => {
    const store = new AtlasStore(tempDbPath());
    const firstAlert = alert({ id: 'same-alert', headline: 'First text', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,1],[0,0]]] } });
    const secondAlert = alert({ ...firstAlert, headline: 'Revised text', geometry: { type: 'Polygon', coordinates: [[[10,10],[11,10],[10,11],[10,10]]] } });
    const firstQuake = quake({ id: 'same-quake', mag: 2, lat: 1, lon: 2 });
    const secondQuake = quake({ ...firstQuake, mag: 5, lat: 30, lon: 40 });
    record(store, 'nws', at(), [firstAlert]); record(store, 'usgs', at(), [firstQuake]);
    record(store, 'nws', at(60_000), [secondAlert]); record(store, 'usgs', at(60_000), [secondQuake]);
    store.ingestAlerts([secondAlert], at(60_000)); store.ingestQuakes([secondQuake], at(60_000));
    expect(store.timelineFrame(at()).nws.records).toEqual([firstAlert]);
    expect(store.timelineFrame(at()).usgs.records).toEqual([firstQuake]);
    expect(store.timelineFrame(at(60_000)).nws.records).toEqual([secondAlert]);
    expect(store.timelineFrame(at(60_000)).usgs.records).toEqual([secondQuake]);
    expect(store.getHistory('alert:same-alert')!.payload).toEqual(secondAlert);
    expect(store.timelineStats()).toMatchObject({ epochs: 4, revisions: 4, intervals: 4 });
    store.close();
  });

  it('distinguishes exact successful emptiness, unknown coverage, explicit failure and expired validity', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), []);
    expect(store.timelineFrame(at()).nws).toMatchObject({ state: 'recorded', records: [], observedAt: at(), validUntil: at(600_000) });
    expect(store.timelineFrame(at()).usgs.state).toBe('unknown');
    expect(store.timelineFrame(at(600_000)).nws.state).toBe('recorded');
    expect(store.timelineFrame(at(600_001)).nws).toMatchObject({ state: 'gap', records: [], observedAt: null });
    store.recordTimelineGap('nws', at(60_000), 'active-US', 'Network failure');
    expect(store.timelineFrame(at(59_999)).nws).toMatchObject({ state: 'recorded', validUntil: at(60_000) });
    expect(store.timelineFrame(at(60_000)).nws).toMatchObject({ state: 'gap', observedAt: null, records: [] });
    store.recordTimelineGap('nws', at(120_000), 'active-US', 'Network failure');
    expect(store.timelineStats().epochs).toBe(2); // repeated failures retain the first gap boundary.
    store.close();
  });

  it('records different USGS scopes and never carries the earlier scope through a selection gap', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'usgs', at(), [quake()], { scope: 'all_day' });
    store.recordTimelineGap('usgs', at(60_000), '4.5_week', 'Selected query changed');
    record(store, 'usgs', at(120_000), [], { scope: '4.5_week' });
    expect(store.timelineFrame(at()).usgs.scope).toBe('all_day');
    expect(store.timelineFrame(at(60_000)).usgs).toMatchObject({ state: 'gap', scope: '4.5_week', records: [] });
    expect(store.timelineFrame(at(120_000)).usgs).toMatchObject({ state: 'recorded', scope: '4.5_week', records: [] });
    store.close();
  });

  it('stores identical replies once, retains reappearing members, and preserves repeated-member multiplicity', () => {
    const store = new AtlasStore(tempDbPath()); const value = alert();
    record(store, 'nws', at(), [value, value]); record(store, 'nws', at(1000), [value]);
    record(store, 'nws', at(2000), []); record(store, 'nws', at(3000), [value]); record(store, 'nws', at(4000), [value]);
    expect(store.timelineFrame(at()).nws.records).toEqual([value, value]);
    expect(store.timelineFrame(at(1000)).nws.records).toEqual([value]);
    expect(store.timelineFrame(at(2000)).nws.records).toEqual([]);
    expect(store.timelineFrame(at(4000)).nws.records).toEqual([value]);
    expect(store.timelineStats()).toMatchObject({ epochs: 5, revisions: 1, intervals: 3 });
    store.close();
  });

  it('marks source omissions and bounded-archive omissions as partial instead of known empty', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), [alert()], { skipped: 2, source: null });
    expect(store.timelineFrame(at()).nws).toMatchObject({ state: 'partial', sourceUpdatedAt: null, records: [alert()] });
    expect(store.timelineFrame(at()).nws.reason).toMatch(/2 malformed/);
    record(store, 'nws', at(1000), [alert({ description: 'x'.repeat(TIMELINE_LIMITS.bytesPerRevision + 1) })]);
    expect(store.timelineFrame(at(1000)).nws).toMatchObject({ state: 'partial', records: [] });
    expect(store.timelineFrame(at(1000)).nws.reason).toMatch(/payload limit/);
    expect(store.timelineFrame(at()).nws.records).toEqual([alert()]);
    store.close();
  });

  it('caps frame record/aggregate bytes and exposes the reason without truncating an apparently complete set', () => {
    const store = new AtlasStore(tempDbPath()); store.saveSettings({ ...DEFAULT_SETTINGS, historyMaxRecords: 20_000 });
    record(store, 'usgs', at(), Array.from({ length: 10_001 }, (_, i) => quake({ id: `q-${i}` })));
    expect(store.timelineFrame(at()).usgs).toMatchObject({ state: 'partial', records: [] });
    expect(store.timelineFrame(at()).usgs.reason).toMatch(/10001.*10000/);
    const long = 'x'.repeat(180 * 1024);
    record(store, 'nws', at(1000), Array.from({ length: 60 }, (_, i) => alert({ id: `a-${i}`, description: long })));
    expect(store.timelineFrame(at(1000)).nws).toMatchObject({ state: 'partial', records: [] });
    expect(store.timelineStats().payloadBytes).toBe(0);
    store.close();
  });

  it('returns a deterministic last reply at identical cursor milliseconds and rejects noncanonical/backward times', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), [alert({ headline: 'first' })]); record(store, 'nws', at(), [alert({ headline: 'last' })]);
    expect(store.timelineFrame(at()).nws.records[0].headline).toBe('last');
    expect(() => store.timelineFrame('2026-11-11')).toThrow(/canonical/);
    expect(() => record(store, 'nws', at(-1), [])).toThrow(/clock moved backwards/);
    store.close();
  });
});

describe('timeline retention, integrity and atomicity', () => {
  it('survives restart and clears with event history without clearing tracks or unrelated saved data', () => {
    const path = tempDbPath(); const store = new AtlasStore(path);
    record(store, 'nws', at(), [alert()]); store.ingestAlerts([alert()], at());
    store.addTrackPoints('vessels', [{ rid: 'v', t: at(), lat: 1, lon: 2, alt: null, heading: null }]);
    store.putDoc('boards', 'keep', { id: 'keep', notes: 'saved user notes' }, at()); store.close();
    const reopened = new AtlasStore(path); expect(reopened.timelineFrame(at()).nws.records).toEqual([alert()]);
    expect(reopened.clearHistory()).toBe(1);
    expect(reopened.timelineStats()).toEqual({ epochs: 0, revisions: 0, intervals: 0, payloadBytes: 0 });
    expect(reopened.timelineFrame(at()).nws.state).toBe('unknown'); expect(reopened.trackRange().points).toBe(1);
    expect(reopened.listDocs('boards')).toEqual([{ id: 'keep', notes: 'saved user notes' }]); reopened.close();
  });

  it('honors age/revision retention by removing whole observations and collecting unreachable payloads', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), [alert({ headline: 'old' })]);
    record(store, 'nws', at(2 * 86400_000), [alert({ headline: 'new' })]);
    store.pruneHistory(1, 5000, new Date(at(2 * 86400_000)));
    expect(store.timelineFrame(at()).nws.state).toBe('unknown'); expect(store.timelineStats().revisions).toBe(1);
    record(store, 'nws', at(2 * 86400_000 + 1000), [alert({ headline: 'newer' })]);
    store.pruneHistory(30, 1, new Date(at(2 * 86400_000 + 1000)));
    expect(store.timelineStats().revisions).toBeLessThanOrEqual(1);
    expect(store.timelineFrame(at(2 * 86400_000 + 1000)).nws.records[0].headline).toBe('newer'); store.close();
  });

  it('rolls back epoch, revision and membership writes when a later revision insert fails', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), [alert()]); const before = store.timelineStats();
    store.db.exec("CREATE TRIGGER archive_abort BEFORE INSERT ON timeline_revisions WHEN json_extract(NEW.payload, '$.id') = 'reject' BEGIN SELECT RAISE(ABORT, 'archive fixture abort'); END;");
    expect(() => record(store, 'nws', at(1000), [alert({ id: 'new' }), alert({ id: 'reject' })])).toThrow(/archive fixture abort/);
    expect(store.timelineStats()).toEqual(before); expect(store.timelineFrame(at()).nws.records).toEqual([alert()]); store.close();
  });

  it('marks missing or malformed retained data incomplete and never substitutes latest history', () => {
    const store = new AtlasStore(tempDbPath()); record(store, 'nws', at(), [alert()]);
    store.ingestAlerts([alert({ headline: 'not historical' })], at());
    store.db.prepare('UPDATE timeline_revisions SET payload = ?').run('{invalid');
    expect(store.timelineFrame(at()).nws).toMatchObject({ state: 'partial', records: [] });
    expect(store.timelineFrame(at()).nws.reason).toMatch(/missing or malformed/); store.close();
  });

  it('bounds epoch and revision storage while unchanged feeds add no repeated memberships', () => {
    const store = new AtlasStore(tempDbPath()); const archive = new TimelineArchive(store.db);
    record(store, 'nws', at(), [alert()]);
    const insert = store.db.prepare('INSERT INTO timeline_epochs(feed,observed_at,source_updated_at,scope,valid_until,state,reason,expected_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    store.db.exec('BEGIN');
    for (let i = 1; i <= TIMELINE_LIMITS.epochs; i++) insert.run('nws', at(i), at(i), 'active-US', at(i + 600_000), 'recorded', null, 1);
    store.db.exec('COMMIT');
    archive.prune({ days: 30, maxRecords: 5000 }, at(TIMELINE_LIMITS.epochs));
    expect(store.timelineStats()).toMatchObject({ epochs: TIMELINE_LIMITS.epochs, revisions: 1, intervals: 1 });
    expect(store.timelineFrame(at(TIMELINE_LIMITS.epochs)).nws.records).toEqual([alert()]); store.close();
  });
});

describe('successful-refresh archive integration', () => {
  function coreHarness() {
    const store = new AtlasStore(tempDbPath()), clock = { ms: START };
    const data: { alerts: WeatherAlert[]; quakes: Earthquake[]; fail?: Error; skipped: number } = { alerts: [alert()], quakes: [quake()], skipped: 0 };
    const alertSource: AlertSource = { name: 'fixture', fetchActiveAlerts: vi.fn(async () => { if (data.fail) throw data.fail; return { alerts: data.alerts, skipped: data.skipped, sourceUpdatedAt: at(clock.ms - START) }; }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) };
    const quakeSource: QuakeSource = { name: 'fixture', fetchRecent: vi.fn(async query => ({ quakes: data.quakes, feedKey: usgsFeedKey(query), skipped: 0, sourceUpdatedAt: at(clock.ms - START) })) };
    const core = new AppCore({ store, alertSource, quakeSource, now: () => new Date(clock.ms), zoneLookupGapMs: 0 });
    return { store, core, clock, data };
  }
  it('archives accepted replies including empty/source-skipped records, errors become gaps, and cached/init never creates epochs', async () => {
    const h = coreHarness(); h.store.setFeedCache('nws', { fetchedAt: at(-1000), sourceUpdatedAt: at(-1000), payload: [alert()] });
    h.core.init(); expect(h.store.timelineStats().epochs).toBe(0);
    await h.core.refresh('nws'); expect(h.store.timelineFrame(at()).nws.records).toEqual([alert()]);
    h.clock.ms += 1000; h.data.fail = new Error('offline'); await h.core.refresh('nws');
    expect(h.store.timelineFrame(at(1000)).nws.state).toBe('gap');
    h.clock.ms += 60_000; h.data.fail = undefined; h.data.alerts = []; await h.core.refresh('nws');
    expect(h.store.timelineFrame(at(61_000)).nws).toMatchObject({ state: 'recorded', records: [] });
    h.clock.ms += 1000; h.data.skipped = 1; await h.core.refresh('nws');
    expect(h.store.timelineFrame(at(62_000)).nws.state).toBe('partial'); h.core.stop(); h.store.close();
  });

  it('keeps archive failure separate from live retrieval and marks that cursor as a gap', async () => {
    const h = coreHarness(); h.core.init();
    h.store.db.exec("CREATE TRIGGER timeline_insert_failure BEFORE INSERT ON timeline_revisions BEGIN SELECT RAISE(ABORT, 'local archive failure'); END;");
    await h.core.refresh('nws');
    expect(h.core.feeds.nws.state).toBe('ok'); expect(h.core.alerts).toEqual([alert()]);
    expect(h.store.timelineFrame(at()).nws).toMatchObject({ state: 'gap', records: [] }); h.core.stop(); h.store.close();
  });

  it('archives the actual USGS normalized reply scope rather than the current display filter', async () => {
    const h = coreHarness(); h.core.init(); h.core.updateSettings({ quakeMinMagnitude: 4 });
    h.data.quakes = [quake({ mag: 3, id: 'below-display' })]; await h.core.refresh('usgs');
    expect(h.core.filteredQuakes()).toEqual([]);
    expect(h.store.timelineFrame(at()).usgs).toMatchObject({ scope: '2.5_week', records: h.data.quakes });
    h.core.reevaluate(); expect(h.store.timelineStats().epochs).toBe(1); h.core.stop(); h.store.close();
  });
});
