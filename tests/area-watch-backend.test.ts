import { describe, expect, it, vi } from 'vitest';
import { AppCore } from '../src/main/core';
import { MAX_ENABLED_WATCH_VERTICES } from '../src/main/areaWatches';
import { FeedHttpError } from '../src/main/feeds/http';
import { usgsFeedKey, type QuakeSource } from '../src/main/feeds/sources';
import { AtlasStore, MAX_AREA_WATCH_SEEN } from '../src/main/store';
import { MAX_AREA_WATCH_EVENTS } from '../src/shared/areaWatch';
import type { AnnotationDocument } from '../src/shared/geojsonAnnotations';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { Earthquake } from '../src/shared/types';
import { fixture, tempDbPath } from './helpers';

const sample = fixture<{ annotation: AnnotationDocument; quake: Earthquake }>('area-watch-backend.json');
const START = Date.parse('2026-11-11T16:00:00.000Z');
const quake = (over: Partial<Earthquake> = {}): Earthquake => ({ ...sample.quake, ...over, ids: over.ids ?? [over.id ?? sample.quake.id] });
const area = (over: Partial<AnnotationDocument> = {}): AnnotationDocument => ({ ...sample.annotation, ...over });

function harness(path = tempDbPath(), clock = { ms: START }) {
  const store = new AtlasStore(path);
  store.saveSettings({ ...DEFAULT_SETTINGS, quakeWindow: 'day', quakeMinMagnitude: 4, zoneLookupEnabled: false });
  const data: { quakes: Earthquake[]; generated?: string | null; fail?: Error } = { quakes: [] };
  const source: QuakeSource = { name: 'local test fixture', fetchRecent: vi.fn(async query => {
    if (data.fail) throw data.fail;
    return { quakes: data.quakes, skipped: 0, sourceUpdatedAt: data.generated === undefined ? new Date(clock.ms).toISOString() : data.generated, feedKey: usgsFeedKey(query) };
  }) };
  const core = new AppCore({ store, quakeSource: source, alertSource: { name: 'unused fixture', fetchActiveAlerts: async () => ({ alerts: [], skipped: 0, sourceUpdatedAt: null }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) }, now: () => new Date(clock.ms), zoneLookupGapMs: 0 });
  core.init();
  const advance = (ms = 2000) => { clock.ms += ms; };
  const iso = (offset = 0) => new Date(clock.ms + offset).toISOString();
  const enable = (minMagnitude = 2.5) => { if (!store.getAnnotation('watch-area')) core.putAnnotation(area()); core.putAreaWatch({ areaId: 'watch-area', minMagnitude, enabled: true }); };
  const state = () => core.snapshot().areaWatches;
  const close = () => { core.stop(); store.close(); };
  return { path, clock, store, core, data, source, advance, iso, enable, state, close };
}

describe('USGS area-watch admission and source truth', () => {
  it('arms without backfill/network changes and matches source records hidden by the display magnitude filter', async () => {
    const h = harness(); h.enable();
    expect(h.source.fetchRecent).not.toHaveBeenCalled();
    expect(h.core.quakeQuery()).toEqual({ window: 'day', minMagnitude: 4 });
    h.data.quakes = [quake({ id: 'before', time: h.iso(-1) }), quake({ id: 'exact-activation', time: h.iso() })];
    h.advance(); await h.core.refresh('usgs');
    expect(h.state().events).toEqual([]);
    h.data.quakes.push(quake({ id: 'new', time: h.iso(-1), url: 'https://earthquake.usgs.gov/earthquakes/eventpage/new' }));
    await h.core.refresh('usgs');
    expect(h.core.filteredQuakes()).toEqual([]); // M3 is in the real 2.5 bucket, below the display minimum 4.
    expect(h.state().events).toHaveLength(1);
    expect(h.state().events[0]).toMatchObject({ quakeId: 'new', magnitude: 3, minMagnitude: 2.5, quakeTime: h.iso(-1), detectedAt: h.iso(), lat: 0, lon: 0, read: false, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/new' });
    expect(h.state().lastEvaluatedAt).toBe(h.iso()); expect(h.state().error).toBeNull();
    h.close();
  });

  it('skips other/unknown types, null magnitude, invalid/future times and events outside the configured window', async () => {
    const h = harness(); h.enable(-2); h.advance(3 * 86400_000);
    h.data.quakes = [
      quake({ id: 'blast', eventType: 'quarry blast', time: h.iso(-1) }), quake({ id: 'unknown-type', eventType: null, time: h.iso(-1) }),
      quake({ id: 'unknown-mag', mag: null, time: h.iso(-1) }), quake({ id: 'bad-time', time: 'not-a-date' }),
      quake({ id: 'future', time: h.iso(1) }), quake({ id: 'old-window', time: h.iso(-2 * 86400_000) }),
      quake({ id: 'outside', lon: 50, time: h.iso(-1) }), quake({ id: 'good', mag: -1, time: h.iso(-1) }),
    ];
    await h.core.refresh('usgs');
    expect(h.state().events.map(e => e.quakeId)).toEqual(['good']);
    h.close();
  });

  it.each(['stale', 'future', 'missing'] as const)('leaves a successful provider retrieval separate from %s generation metadata', async kind => {
    const h = harness(); h.enable(); h.advance();
    h.data.generated = kind === 'missing' ? null : h.iso(kind === 'stale' ? -15 * 60_000 - 1 : 2 * 60_000 + 1);
    h.data.quakes = [quake({ time: h.iso(-1) })];
    await h.core.refresh('usgs');
    expect(h.core.feeds.usgs.state).toBe('ok'); expect(h.state().events).toEqual([]);
    expect(h.state().lastEvaluatedAt).toBeNull(); expect(h.state().error).toMatch(/generation time/);
    h.close();
  });

  it('does not evaluate cached loads, repeated renderer reevaluation or failed retrievals', async () => {
    const h = harness(); h.enable(); h.advance(); h.data.quakes = [quake({ time: h.iso(-1) })];
    await h.core.refresh('usgs'); const before = h.state();
    h.core.reevaluate(); h.core.reevaluate();
    expect(h.state()).toBe(before); // immutable state cache, no repeated JSON reads.
    h.data.fail = new FeedHttpError('offline', null, null, 'network'); h.advance(); await h.core.refresh('usgs');
    expect(h.state()).toBe(before); expect(h.core.feeds.usgs.state).toBe('error');
    h.close();
  });

  it('does not generate a new match from a fresh-looking cached payload at startup', () => {
    const h = harness(); h.enable(); h.advance();
    h.store.setFeedCache('usgs', { fetchedAt: h.iso(), sourceUpdatedAt: h.iso(), payload: { feedKey: '2.5_day', quakes: [quake({ id: 'cached-only', time: h.iso(-1) })] } });
    h.close();
    const reopened = harness(h.path, h.clock);
    expect(reopened.core.feeds.usgs.fromCache).toBe(true);
    expect(reopened.state().events).toEqual([]); expect(reopened.state().lastEvaluatedAt).toBeNull();
    reopened.core.reevaluate(); expect(reopened.state().events).toEqual([]);
    reopened.close();
  });

  it('does not overwrite a valid cache or emit from an incompatible response when the query changes in flight', async () => {
    const h = harness(); h.enable(); h.advance();
    h.data.quakes = [quake({ id: 'old-valid', time: h.iso(-1) })]; await h.core.refresh('usgs');
    const cached = h.store.getFeedCache('usgs');
    let finish!: (value: Awaited<ReturnType<QuakeSource['fetchRecent']>>) => void;
    h.source.fetchRecent = vi.fn(() => new Promise<Awaited<ReturnType<QuakeSource['fetchRecent']>>>(resolve => { finish = resolve; }));
    const pending = h.core.refresh('usgs');
    h.core.updateSettings({ quakeWindow: 'week' });
    finish({ quakes: [quake({ id: 'wrong-scope', time: h.iso(-1) })], feedKey: '2.5_day', skipped: 0, sourceUpdatedAt: h.iso() });
    await pending;
    expect(h.store.getFeedCache('usgs')).toEqual(cached);
    expect(h.core.filteredQuakes()).toEqual([]);
    expect(h.core.feeds.usgs.lastSuccessAt).toBeNull(); expect(h.core.feeds.usgs.state).toBe('idle');
    expect(h.state().events.map(e => e.quakeId)).toEqual(['old-valid']); expect(h.state().error).toMatch(/query changed/);
    h.close();
  });
});

describe('persisted watch epochs, evidence and read lifecycle', () => {
  it('deduplicates revisions/aliases across refresh and restart, preserving read state and evidence', async () => {
    const h = harness(); h.enable(); h.advance(); h.data.quakes = [quake({ id: 'first', time: h.iso(-1) })];
    await h.core.refresh('usgs'); const evidence = h.state().events[0];
    h.core.readAreaWatchEvents([evidence.id]);
    h.data.quakes = [quake({ id: 'preferred', ids: ['preferred', 'first'], time: h.iso(-1), mag: 3.5 })]; await h.core.refresh('usgs');
    h.data.quakes = [quake({ id: 'preferred', ids: ['preferred'], time: h.iso(-1) })]; await h.core.refresh('usgs');
    expect(h.state().events).toEqual([{ ...evidence, read: true }]);
    h.close();
    const reopened = harness(h.path, h.clock);
    expect(reopened.core.feeds.usgs.fromCache).toBe(true);
    expect(reopened.state().events).toEqual([{ ...evidence, read: true }]);
    reopened.data.quakes = h.data.quakes; await reopened.core.refresh('usgs');
    expect(reopened.state().events).toEqual([{ ...evidence, read: true }]);
    reopened.close();
  });

  it('re-arms on enable, threshold or geometry change while name/color/visibility edits preserve the epoch', async () => {
    const h = harness(); h.enable(); const firstArm = h.state().rules[0].armedAt;
    h.advance(); h.core.putAnnotation(area({ name: 'Renamed', visible: false, color: '#123456' }));
    expect(h.state().rules[0].armedAt).toBe(firstArm);
    h.core.putAreaWatch({ areaId: 'watch-area', minMagnitude: 2.5, enabled: false });
    h.data.quakes = [quake({ time: h.iso(-1) })]; await h.core.refresh('usgs'); expect(h.state().events).toEqual([]);
    h.advance(); h.core.putAreaWatch({ areaId: 'watch-area', minMagnitude: 2.5, enabled: true });
    await h.core.refresh('usgs'); expect(h.state().events).toEqual([]);
    h.data.quakes = [quake({ time: h.iso(1), mag: 6 })]; h.advance(); await h.core.refresh('usgs');
    expect(h.state().events).toHaveLength(1);
    h.advance(); h.core.putAreaWatch({ areaId: 'watch-area', minMagnitude: 5, enabled: true });
    await h.core.refresh('usgs'); expect(h.state().events).toHaveLength(1);
    h.advance(); h.core.putAnnotation(area({ points: [[-3,-3],[3,-3],[3,3],[-3,3]] }));
    expect(h.state().rules[0].armedAt).toBe(h.iso());
    await h.core.refresh('usgs'); expect(h.state().events).toHaveLength(1);
    h.close();
  });

  it('disables a watch atomically when its area becomes invalid, and cascades non-area/deleted annotations', async () => {
    const h = harness(); h.enable(); h.advance(); h.data.quakes = [quake({ time: h.iso(-1), mag: 5 })]; await h.core.refresh('usgs');
    h.core.putAnnotation(area({ points: [[0,0]] }));
    expect(h.store.getAnnotation('watch-area')!.points).toEqual([[0,0]]);
    expect(h.state().rules[0].enabled).toBe(false); expect(h.state().error).toMatch(/disabled/);
    expect(h.state().events).toHaveLength(1);
    h.core.putAnnotation(area({ kind: 'pin', points: [[0,0]] }));
    expect(h.state().rules).toEqual([]); expect(h.state().events).toEqual([]);
    h.core.putAnnotation(area()); h.enable(); h.advance(); h.data.quakes = [quake({ id: 'second', time: h.iso(-1), mag: 5 })]; await h.core.refresh('usgs');
    const history = h.store.queryHistory({ includeSuperseded: true }).storedTotal;
    expect(history).toBeGreaterThan(0);
    expect(h.core.deleteAnnotation('watch-area')).toBe(true);
    expect(h.state().rules).toEqual([]); expect(h.state().events).toEqual([]);
    expect(h.store.areaWatchSeenKeys().size).toBe(0);
    expect(h.store.queryHistory({ includeSuperseded: true }).storedTotal).toBe(history);
    h.close();
  });

  it('retains only 500 newest evidence rows but keeps dedup beyond event pruning; removal clears only that watch', async () => {
    const h = harness(); h.enable(); h.advance(10_000);
    h.data.quakes = Array.from({ length: 600 }, (_, i) => quake({ id: `q-${i}`, time: h.iso(-i - 1) }));
    await h.core.refresh('usgs');
    expect(h.state().events).toHaveLength(MAX_AREA_WATCH_EVENTS); expect(h.store.areaWatchSeenKeys().size).toBe(600);
    const before = h.state().events;
    await h.core.refresh('usgs'); expect(h.state().events).toEqual(before);
    h.core.readAreaWatchEvents(before.map(e => e.id)); expect(h.state().events.every(e => e.read)).toBe(true);
    expect(h.core.deleteAreaWatch('watch-area')).toBe(true);
    expect(h.state().events).toEqual([]); expect(h.store.getAnnotation('watch-area')).not.toBeNull();
    h.close();
  });

  it('does not let meta properties replace rules/events and reports damaged evaluation status', () => {
    const h = harness(); h.enable();
    h.store.setMeta('area_watch_evaluation', JSON.stringify({ rules: ['forged'], events: ['forged'], lastEvaluatedAt: 'bad-date', error: null }));
    const direct = h.store.areaWatchState(); expect(direct.rules).toHaveLength(1); expect(direct.events).toEqual([]); expect(direct.error).toMatch(/invalid/);
    h.close();
  });
});

describe('atomic and bounded local evaluation', () => {
  it('rolls back event and dedup writes after a later insertion fails without failing the USGS feed', async () => {
    const h = harness(); h.enable(); h.advance();
    h.store.db.exec("CREATE TRIGGER watch_failure BEFORE INSERT ON area_watch_events WHEN json_extract(NEW.data, '$.quakeId') = 'reject' BEGIN SELECT RAISE(ABORT, 'local fixture abort'); END;");
    h.data.quakes = [quake({ id: 'first', time: h.iso(-1) }), quake({ id: 'reject', time: h.iso(-1) })];
    await h.core.refresh('usgs');
    expect(h.core.feeds.usgs.state).toBe('ok'); expect(h.state().events).toEqual([]); expect(h.store.areaWatchSeenKeys().size).toBe(0);
    expect(h.state().lastEvaluatedAt).toBeNull(); expect(h.state().error).toMatch(/could not be committed/);
    h.close();
  });

  it('reports poll work truncation explicitly rather than a complete empty evaluation', async () => {
    const h = harness(); h.enable(); h.advance();
    h.data.quakes = Array.from({ length: 10_001 }, (_, i) => quake({ id: `far-${i}`, lon: 80, time: h.iso(-1) }));
    await h.core.refresh('usgs');
    expect(h.state().events).toEqual([]); expect(h.state().lastEvaluatedAt).toBeNull(); expect(h.state().error).toMatch(/partial.*10,000/);
    h.close();
  });

  it('skips baseline records before charging pair work and reports a real candidate-pair limit', async () => {
    const h = harness();
    for (let i = 0; i < 11; i++) {
      h.core.putAnnotation(area({ id: `a-${i}` }));
      h.core.putAreaWatch({ areaId: `a-${i}`, minMagnitude: 2.5, enabled: true });
    }
    h.advance();
    h.data.quakes = Array.from({ length: 10_000 }, (_, i) => quake({ id: `old-${i}`, lon: 80, time: new Date(START - 1).toISOString() }));
    await h.core.refresh('usgs');
    expect(h.state().error).toBeNull(); expect(h.state().lastEvaluatedAt).toBe(h.iso());
    const previous = h.state().lastEvaluatedAt;
    h.advance(); h.data.quakes = h.data.quakes.map(q => ({ ...q, time: h.iso(-1) }));
    await h.core.refresh('usgs');
    expect(h.state().error).toMatch(/partial.*100,000/); expect(h.state().lastEvaluatedAt).toBe(previous);
    h.close();
  });

  it('keeps real partial matches while explicitly stopping the vertex-work budget', async () => {
    const h = harness();
    const points: [number, number][] = Array.from({ length: 5000 }, (_, i) => [Math.cos(i * 2 * Math.PI / 5000), Math.sin(i * 2 * Math.PI / 5000)]);
    h.core.putAnnotation(area({ points })); h.enable(); h.advance();
    h.data.quakes = Array.from({ length: 401 }, (_, i) => quake({ id: `inside-${i}`, time: h.iso(-1) }));
    await h.core.refresh('usgs');
    expect(h.state().events).toHaveLength(400); expect(h.state().error).toMatch(/partial.*2,000,000/);
    expect(h.state().lastEvaluatedAt).toBeNull();
    await h.core.refresh('usgs');
    expect(h.state().events).toHaveLength(401); expect(h.state().error).toBeNull(); expect(h.state().lastEvaluatedAt).toBe(h.iso());
    h.close();
  });

  it('caps active geometry across rules and never reads unrelated stored annotation documents', () => {
    const h = harness();
    // A corrupt unrelated route proves watch lookup is by watched IDs, not a full annotation JSON scan.
    h.store.db.prepare('INSERT INTO annotations VALUES (?, ?, ?)').run('unrelated-route', '{invalid-json', h.iso());
    const points: [number, number][] = Array.from({ length: 5000 }, (_, i) => [Math.cos(i * 2 * Math.PI / 5000), Math.sin(i * 2 * Math.PI / 5000)]);
    for (let i = 0; i < MAX_ENABLED_WATCH_VERTICES / 5000; i++) {
      h.core.putAnnotation(area({ id: `area-${i}`, points }));
      h.core.putAreaWatch({ areaId: `area-${i}`, minMagnitude: 2.5, enabled: true });
    }
    h.core.putAnnotation(area({ id: 'too-many', points }));
    expect(() => h.core.putAreaWatch({ areaId: 'too-many', minMagnitude: 2.5, enabled: true })).toThrow(/20,000/);
    expect(h.state().rules).toHaveLength(4); h.close();
  });

  it('does not prune and replay dedup state when the local clock goes backwards', async () => {
    const h = harness(); h.enable(); h.advance(); h.data.quakes = [quake({ time: h.iso(-1) })]; await h.core.refresh('usgs');
    const before = h.state().events; h.clock.ms--;
    await h.core.refresh('usgs'); expect(h.state().events).toEqual(before); expect(h.state().error).toMatch(/clock moved backwards/);
    h.close();
  });

  it('fails conservatively at the dedup cap without dropping active identities or committing partial evidence', async () => {
    const h = harness(); h.enable(); h.advance();
    h.store.db.exec('BEGIN');
    const insert = h.store.db.prepare('INSERT INTO area_watch_seen VALUES (?, ?, ?)');
    for (let i = 0; i < MAX_AREA_WATCH_SEEN; i++) insert.run('watch-area', `old-${i}`, h.iso(-1));
    h.store.db.exec('COMMIT');
    h.data.quakes = [quake({ id: 'overflow', time: h.iso(-1) })]; await h.core.refresh('usgs');
    expect(h.state().events).toEqual([]); expect(h.store.areaWatchSeenKeys().size).toBe(MAX_AREA_WATCH_SEEN);
    expect(h.state().error).toMatch(/deduplication capacity/); h.close();
  });
});
