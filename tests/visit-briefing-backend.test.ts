import { describe, expect, it } from 'vitest';
import { AppCore } from '../src/main/core';
import { AtlasStore } from '../src/main/store';
import { usgsFeedKey } from '../src/main/feeds/sources';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import { VISIT_EXAMPLES_PER_CHANGE, visitSourceUrl } from '../src/shared/visitBriefing';
import type { Earthquake, WeatherAlert } from '../src/shared/types';
import { fixture, tempDbPath } from './helpers';

const START = Date.parse('2026-11-11T12:00:00.000Z');
const iso = (offset = 0) => new Date(START + offset).toISOString();
const a0 = normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0];
const q0 = normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0];
const alert = (id: string, patch: Partial<WeatherAlert> = {}): WeatherAlert => ({ ...a0, id, headline: `Fixture alert ${id}`, sourceUrl: `https://api.weather.gov/alerts/${id}`, ...patch });
const quake = (id: string, patch: Partial<Earthquake> = {}): Earthquake => ({ ...q0, id, ids: [id], title: `Fixture quake ${id}`, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, ...patch });

function run(path = tempDbPath(), offset = 0) {
  const store = new AtlasStore(path);
  if (!store.getMeta('settings')) store.saveSettings({ ...DEFAULT_SETTINGS, zoneLookupEnabled: false, quakeWindow: 'day', quakeMinMagnitude: 0 });
  let clock = offset;
  const data: { alerts: WeatherAlert[]; quakes: Earthquake[]; nwsSkip: number; usgsSkip: number; nwsFail: boolean; usgsFail: boolean } = { alerts: [], quakes: [], nwsSkip: 0, usgsSkip: 0, nwsFail: false, usgsFail: false };
  const core = new AppCore({ store, now: () => new Date(START + clock), alertSource: {
    name: 'controlled visit fixture', fetchActiveAlerts: async () => { if (data.nwsFail) throw new Error('controlled unavailable reply'); return { alerts: data.alerts, skipped: data.nwsSkip, sourceUpdatedAt: iso(clock) }; },
    fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }),
  }, quakeSource: { name: 'controlled visit fixture', fetchRecent: async query => { if (data.usgsFail) throw new Error('controlled unavailable reply'); return { quakes: data.quakes, skipped: data.usgsSkip, sourceUpdatedAt: iso(clock), feedKey: usgsFeedKey(query) }; } } });
  core.init();
  return { path, core, store, data, advance: (ms: number) => { clock += ms; }, refresh: async () => { await core.refresh('nws'); await core.refresh('usgs'); }, close: () => { core.stop(); store.close(); } };
}

describe('persistent app-visit boundaries and recorded endpoints', () => {
  it('counts each source ID once when a reply repeats an identical record', async () => {
    const first = run();
    first.data.alerts = [alert('same'), alert('same')];
    await first.refresh();
    first.close();
    const second = run(first.path, 60_000);
    second.data.alerts = [alert('same'), alert('mixed'), alert('mixed', { headline: 'Conflicting revision' })];
    await second.refresh();
    const report = second.core.visitBriefing().feeds.nws;
    expect(report.baseline.recordCount).toBe(2);
    expect(report.updated.total).toBe(0);
    expect(report.new).toMatchObject({ total: 1, examples: [{ id: 'mixed', label: 'Multiple revisions returned for this identifier', url: null }] });
    second.close();
  });
  it('first visit does not manufacture changes from legacy history/cache or old unassigned archive rows', async () => {
    const path = tempDbPath(); const old = new AtlasStore(path);
    old.ingestAlerts([alert('legacy')], iso(-1000));
    old.setFeedCache('nws', { fetchedAt: iso(-1000), sourceUpdatedAt: iso(-1000), payload: [alert('legacy')] });
    old.recordTimelineObservation({ feed: 'nws', observedAt: iso(-1000), sourceUpdatedAt: iso(-1000), scope: 'active-US', validForMs: 600000, records: [alert('legacy')] }); old.close();
    const h = run(path);
    expect(h.core.feeds.nws.fromCache).toBe(true);
    expect(h.core.visitBriefing()).toMatchObject({ sessionStartedAt: iso(), previousStartedAt: null, feeds: { nws: { status: 'unavailable', new: { total: null }, current: { state: 'unavailable' } } } });
    h.data.alerts = [alert('fresh')]; await h.refresh();
    expect(h.core.visitBriefing().feeds.nws.current).toMatchObject({ state: 'recorded', recordCount: 1, observedAt: iso() });
    expect(h.core.visitBriefing().feeds.nws.new.total).toBeNull(); h.close();
  });

  it('rotates on startup even when a previous visit had no data or no normal shutdown', async () => {
    const first = run(); const path = first.path; first.store.close(); // No stop/shutdown hook is required.
    const second = run(path, 60000); second.data.alerts = [alert('second')]; await second.refresh();
    expect(second.core.visitBriefing()).toMatchObject({ previousStartedAt: iso(), feeds: { nws: { baseline: { state: 'unavailable' }, new: { total: null } } } }); second.close();
    const third = run(path, 120000); third.data.alerts = [alert('third')]; await third.refresh();
    expect(third.core.visitBriefing()).toMatchObject({ previousStartedAt: iso(60000), feeds: { nws: { baseline: { observedAt: iso(60000) }, new: { total: 1 }, noLongerReturned: { total: 1 } } } }); third.close();
  });

  it('uses the latest reply from the previous app run and freezes it across current-run refreshes', async () => {
    const first = run(); first.data.alerts = [alert('first')]; await first.refresh();
    first.advance(60000); first.data.alerts = [alert('last-prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 120000); second.data.alerts = [alert('current')]; await second.refresh();
    const one = second.core.visitBriefing().feeds.nws;
    expect(one.baseline.observedAt).toBe(iso(60000)); expect(one.noLongerReturned.examples[0].id).toBe('last-prior');
    second.advance(60000); second.data.alerts = [alert('last-prior')]; await second.refresh();
    const two = second.core.visitBriefing().feeds.nws;
    expect(two.baseline).toEqual(one.baseline); expect(two.new.total).toBe(0); expect(two.noLongerReturned.total).toBe(0);
    expect(two.current.observedAt).toBe(iso(180000));
    const before = second.store.timelineStats(); second.core.visitBriefing(); second.core.visitBriefing(); expect(second.store.timelineStats()).toEqual(before); second.close();
  });

  it('does not count cached-only or failed-only current visits, preserving exact last-failure limits', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000);
    expect(second.core.feeds.nws.fromCache).toBe(true); expect(second.core.visitBriefing().feeds.nws.new.total).toBeNull();
    second.data.nwsFail = true; await second.core.refresh('nws');
    expect(second.core.visitBriefing().feeds.nws).toMatchObject({ status: 'unavailable', current: { state: 'unavailable', reason: expect.stringContaining('controlled unavailable') }, new: { total: null } }); second.close();
    const third = run(path, 120000); third.data.nwsFail = true; await third.core.refresh('nws');
    const brief = third.core.visitBriefing().feeds.nws;
    expect(brief.baseline.reason).toContain('controlled unavailable'); expect(brief.current.reason).toContain('controlled unavailable');
    const epochs = third.store.timelineStats().epochs; await third.core.refresh('nws'); expect(third.store.timelineStats().epochs).toBe(epochs); third.close();
  });

  it('keeps NWS and USGS independent and distinguishes successful empty replies from unknown', async () => {
    const first = run(); await first.core.refresh('nws'); const path = first.path; first.close();
    const second = run(path, 60000); await second.refresh();
    const brief = second.core.visitBriefing();
    expect(brief.feeds.nws).toMatchObject({ status: 'ready', baseline: { recordCount: 0 }, current: { recordCount: 0 }, new: { total: 0 }, updated: { total: 0 }, noLongerReturned: { total: 0 } });
    expect(brief.feeds.usgs).toMatchObject({ status: 'unavailable', baseline: { state: 'unavailable' }, current: { recordCount: 0 }, new: { total: null } }); second.close();
  });
});

describe('source-ID and revision comparisons with explicit limits', () => {
  it('compares actual same-ID revision hashes, including changed geometry/magnitude and publisher record updates', async () => {
    const first = run(); first.data.alerts = [alert('keep'), alert('revise'), alert('gone')]; first.data.quakes = [quake('keep'), quake('revise'), quake('gone')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000);
    second.data.alerts = [alert('keep'), alert('revise', { headline: 'Revised source headline', geometry: { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [0, 0]]] } }), alert('new')];
    second.data.quakes = [quake('keep'), quake('revise', { mag: 6.4, lat: -30, updated: iso(1000) }), quake('new')]; await second.refresh();
    for (const feed of Object.values(second.core.visitBriefing().feeds)) {
      expect(feed.status).toBe('ready'); expect(feed.new).toMatchObject({ total: 1, examples: [{ id: 'new' }], truncated: false });
      expect(feed.updated).toMatchObject({ total: 1, examples: [{ id: 'revise' }] }); expect(feed.noLongerReturned).toMatchObject({ total: 1, examples: [{ id: 'gone' }] });
    }
    second.close();
  });

  it('does not count whole-feed generation timestamps as member revisions, and retains exact source-ID/alias semantics', async () => {
    const first = run(); first.data.quakes = [quake('stable'), quake('old-preferred')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.quakes = [quake('stable'), quake('new-preferred', { ids: ['old-preferred', 'new-preferred'] })]; await second.refresh();
    expect(second.core.visitBriefing().feeds.usgs).toMatchObject({ new: { total: 1 }, updated: { total: 0 }, noLongerReturned: { total: 1 } }); second.close();
  });

  it('reports bounded examples and full distinct-ID totals without duplicating evidence payloads', async () => {
    const first = run(); first.data.alerts = Array.from({ length: 20 }, (_, i) => alert(`old-${i}`)); await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = Array.from({ length: 20 }, (_, i) => alert(`new-${i}`, { headline: 'x'.repeat(1000) })); await second.refresh();
    const before = second.store.timelineStats(); const brief = second.core.visitBriefing().feeds.nws;
    expect(brief.new.total).toBe(20); expect(brief.noLongerReturned.total).toBe(20);
    expect(brief.new.examples).toHaveLength(VISIT_EXAMPLES_PER_CHANGE); expect(brief.new.truncated).toBe(true); expect(brief.noLongerReturned.truncated).toBe(true);
    expect(brief.new.examples.every(example => example.label.length <= 240)).toBe(true); expect(second.store.timelineStats()).toEqual(before);
    expect(second.store.getMeta('timeline_visit_v1')!.length).toBeLessThan(1500); second.close();
  });

  it.each(['baseline', 'current'] as const)('does not claim complete membership changes for a partial %s reply', async partial => {
    const first = run(); first.data.alerts = [alert('old')]; if (partial === 'baseline') first.data.nwsSkip = 1; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = [alert('new')]; if (partial === 'current') second.data.nwsSkip = 1; await second.refresh();
    const brief = second.core.visitBriefing().feeds.nws;
    expect(brief[partial].state).toBe('partial'); expect(brief.new.total).toBeNull(); expect(brief.noLongerReturned.total).toBeNull(); expect(brief.limits.join(' ')).toContain('incomplete'); second.close();
  });

  it('does not compare different configured scopes or a source switch awaiting its first actual reply', async () => {
    const first = run(); first.data.quakes = [quake('same')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.quakes = [quake('same')]; await second.refresh();
    second.core.updateSettings({ quakeWindow: 'hour' });
    expect(second.core.visitBriefing().feeds.usgs.new.total).toBeNull();
    await second.core.refresh('usgs');
    const brief = second.core.visitBriefing().feeds.usgs;
    expect(brief.baseline.scope).toBe('all_day'); expect(brief.current.scope).toBe('all_hour'); expect(brief.new.total).toBeNull(); expect(brief.limits.join(' ')).toMatch(/different source scopes/); second.close();
  });

  it('retains factual overnight endpoint changes with expiry limits, without claiming interval observations', async () => {
    const first = run(); first.data.alerts = [alert('old')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 12 * 3600000); second.data.alerts = [alert('new')]; await second.refresh();
    let brief = second.core.visitBriefing().feeds.nws;
    expect(brief.status).toBe('limited'); expect(brief.baseline.state).toBe('expired'); expect(brief.new.total).toBe(1); expect(brief.noLongerReturned.total).toBe(1);
    expect(brief.limits.join(' ')).toMatch(/freshness window.*endpoint differences/);
    second.advance(3600000); brief = second.core.visitBriefing().feeds.nws;
    expect(brief.current.state).toBe('expired'); expect(brief.new.total).toBe(1); second.close();
  });

  it('keeps later failed refreshes explicit while comparing the actual received endpoints', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); first.advance(1000); first.data.nwsFail = true; await first.core.refresh('nws'); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = [alert('current')]; await second.refresh(); second.advance(1000); second.data.nwsFail = true; await second.core.refresh('nws');
    const brief = second.core.visitBriefing().feeds.nws;
    expect(brief.status).toBe('limited'); expect(brief.baseline.state).toBe('gap'); expect(brief.current.state).toBe('gap'); expect(brief.new.total).toBe(1); expect(brief.current.observedAt).toBe(iso(60000)); expect(brief.limits.join(' ')).toContain('followed by an unavailable refresh'); second.close();
  });
});

describe('visit integrity, rollback and retention', () => {
  it('clears baseline references truthfully and starts after a nonresetting high-water mark', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.store.clearHistory(); second.data.alerts = [alert('after-clear')]; await second.refresh();
    expect(second.core.visitBriefing().feeds.nws).toMatchObject({ baseline: { state: 'unavailable', reason: expect.stringMatching(/no longer retained/) }, current: { recordCount: 1 }, new: { total: null } }); second.close();
    const third = run(path, 120000); third.data.alerts = [alert('third')]; await third.refresh();
    expect(third.core.visitBriefing().feeds.nws).toMatchObject({ baseline: { observedAt: iso(60000) }, new: { total: 1 }, noLongerReturned: { examples: [{ id: 'after-clear' }] } }); third.close();
  });

  it('does not resurrect a pruned endpoint or replace it with earlier latest-event rows', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 3 * 86400000); second.store.pruneHistory(1, 5000, new Date(START + 3 * 86400000)); second.data.alerts = [alert('new')]; await second.refresh();
    expect(second.core.visitBriefing().feeds.nws).toMatchObject({ baseline: { state: 'unavailable' }, new: { total: null } }); second.close();
  });

  it('detects valid-JSON payload tampering against the stored revision digest before reporting changes', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = [alert('new')]; await second.refresh();
    second.store.db.prepare("UPDATE timeline_revisions SET payload = ? WHERE feed = 'nws' AND json_extract(payload, '$.id') = 'prior'").run(JSON.stringify(alert('forged')));
    expect(second.core.visitBriefing().feeds.nws).toMatchObject({ baseline: { state: 'partial' }, new: { total: null }, noLongerReturned: { total: null } }); second.close();
  });

  it('does not turn an archive transaction failure into a successful current checkpoint', async () => {
    const first = run(); first.data.alerts = [alert('prior')]; await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = [alert('reject')];
    second.store.db.exec("CREATE TRIGGER visit_archive_abort BEFORE INSERT ON timeline_revisions WHEN json_extract(NEW.payload, '$.id') = 'reject' BEGIN SELECT RAISE(ABORT, 'fixture archive rollback'); END;");
    await second.core.refresh('nws');
    expect(second.core.feeds.nws.state).toBe('ok');
    expect(second.core.visitBriefing().feeds.nws).toMatchObject({ current: { state: 'unavailable', reason: expect.stringContaining('could not be retained') }, new: { total: null } }); second.close();
  });

  it('atomically preserves the previous marker if startup tracking fails, and exposes the local failure', async () => {
    const first = run(); const path = first.path; const marker = first.store.getMeta('timeline_visit_v1'); first.close();
    const db = new AtlasStore(path); db.db.exec("CREATE TRIGGER visit_marker_abort BEFORE INSERT ON meta WHEN NEW.key = 'timeline_visit_v1' BEGIN SELECT RAISE(ABORT, 'fixture marker rollback'); END;"); db.close();
    const second = run(path, 60000);
    expect(second.store.getMeta('timeline_visit_v1')).toBe(marker); expect(second.core.visitBriefing().error).toMatch(/could not be initialized/); expect(second.core.visitBriefing().feeds.nws.new.total).toBeNull(); second.close();
  });

  it('does not trust malformed marker fields or let metadata replace output evidence', () => {
    const path = tempDbPath(); const db = new AtlasStore(path); db.setMeta('timeline_visit_v1', JSON.stringify({ version: 1, current: { id: 'bad', startedAt: 'not-time', startEpoch: -1 }, feeds: { nws: { new: { total: 999 } } } })); db.close();
    const h = run(path); expect(h.core.visitBriefing().error).toMatch(/marker is invalid/); expect(h.core.visitBriefing().feeds.nws.new.total).toBeNull(); h.close();
  });

  it('never attributes a run with failed tracking initialization to an older persisted app visit', async () => {
    const first = run(); first.data.alerts = [alert('first')]; await first.refresh(); const path = first.path; first.close();
    const setup = new AtlasStore(path); setup.db.exec("CREATE TRIGGER visit_marker_abort BEFORE INSERT ON meta WHEN NEW.key = 'timeline_visit_v1' BEGIN SELECT RAISE(ABORT, 'fixture marker rollback'); END;"); setup.close();
    const untracked = run(path, 60000); untracked.data.alerts = [alert('untracked-actual-reply')]; await untracked.refresh();
    expect(untracked.store.timelineFrame(iso(60000)).nws.records[0].id).toBe('untracked-actual-reply');
    expect(untracked.core.visitBriefing().error).toMatch(/could not be initialized/); untracked.store.db.exec('DROP TRIGGER visit_marker_abort'); untracked.close();
    const next = run(path, 120000); next.data.alerts = [alert('next')]; await next.refresh();
    expect(next.core.visitBriefing()).toMatchObject({ previousStartedAt: null, error: expect.stringContaining('reliable run ownership'), feeds: { nws: { new: { total: null } } } });
    expect(next.store.getMeta('timeline_visit_untracked_v1')).toBeNull(); next.close();
  });

  it('validates official publisher links at the output boundary and leaves unsafe URLs unavailable', async () => {
    expect(visitSourceUrl('nws', 'https://api.weather.gov/alerts/urn:oid:fixture')).toContain('/alerts/');
    expect(visitSourceUrl('usgs', 'https://earthquake.usgs.gov/earthquakes/eventpage/fixture')).toContain('/eventpage/');
    for (const value of ['javascript:alert(1)', 'https://evil.example/alerts/a', 'https://user:secret@api.weather.gov/alerts/a', 'https://api.weather.gov:444/alerts/a', 'https://api.weather.gov/other', 'https://api.weather.gov.evil.example/alerts/a']) expect(visitSourceUrl('nws', value)).toBeNull();
    const first = run(); await first.refresh(); const path = first.path; first.close();
    const second = run(path, 60000); second.data.alerts = [alert('new', { sourceUrl: 'https://evil.example/steal', headline: 'Untrusted\u0000 text' })]; await second.refresh();
    const example = second.core.visitBriefing().feeds.nws.new.examples[0]; expect(example.url).toBeNull(); expect(example.label).not.toContain('\u0000'); second.close();
  });
});
