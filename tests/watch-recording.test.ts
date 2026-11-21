import { afterEach, describe, expect, it } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { AreaRecorder } from '../src/main/layers/areaRecorder';
import { tempDbPath } from './helpers';
import { WATCH_AREA_IDS, WATCH_AREAS, inBox, watchArea, watchAreaBox, type WatchArea } from '../src/shared/watchAreas';
import { DEFAULT_SETTINGS, annotationSchema, settingsPatchSchema } from '../src/shared/ipc';
import { cleanSourceUrl, eventIsoFromLocal } from '../src/renderer/components/EventFields';
import type { GeoRecord } from '../src/shared/layers';
import type { Settings } from '../src/shared/types';

const stores: AtlasStore[] = [];
afterEach(() => { while (stores.length) stores.pop()!.close(); });
const rec = (id: string, lat: number, lon: number, extra: Partial<GeoRecord> = {}): GeoRecord => ({ id, lat, lon, altM: 10000, heading: 90, speedKts: 400, label: id, category: 'medium', observedAt: '2026-11-18T10:00:00.000Z', sourceUrl: null, source: 'test', props: {}, ...extra });

describe('Watch-area boxes and settings', () => {
  it('lists the same ids as the areas, and boxes handle the date line', () => {
    expect([...WATCH_AREA_IDS]).toEqual(WATCH_AREAS.map((a) => a.id));
    const h = watchAreaBox(watchArea('hormuz')!);
    expect(inBox(h, 26.5, 56.3)).toBe(true);
    expect(inBox(h, 35.7, 51.4)).toBe(false); // Tehran lies outside the box around the strait
    const dateLine: WatchArea = { id: 'x', name: 'x', lat: 0, lon: 179.5, radiusKm: 200, coverageNote: 'test' };
    const b = watchAreaBox(dateLine);
    expect(b[0]).toBeGreaterThan(b[2]);
    expect(inBox(b, 0, -179.5)).toBe(true);
    expect(inBox(b, 0, 170)).toBe(false);
  });
  it('keeps recording off by default and accepts only known areas', () => {
    expect(DEFAULT_SETTINGS.recordAreaId).toBeNull();
    expect(settingsPatchSchema.safeParse({ recordAreaId: 'hormuz' }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ recordAreaId: null }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ recordAreaId: 'tehran' }).success).toBe(false);
  });
});

describe('Timed event markers', () => {
  const base = { id: 'e1', kind: 'pin', name: 'Reported strike', color: '#d55e00', points: [[56.3, 27.1]], visible: true, createdAt: '2026-11-18T10:00:00.000Z' };
  it('stores the event time, kind and an https source only', () => {
    expect(annotationSchema.safeParse({ ...base, eventAt: '2026-11-18T09:12:00.000Z', eventKind: 'strike', sourceUrl: 'https://example.org/report' }).success).toBe(true);
    expect(annotationSchema.safeParse({ ...base, sourceUrl: 'http://example.org/report' }).success).toBe(false);
    expect(annotationSchema.safeParse({ ...base, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(annotationSchema.safeParse({ ...base, eventKind: 'airstrike' }).success).toBe(false);
    expect(annotationSchema.safeParse(base).success).toBe(true); // older drawings still load
  });
  it('turns local input into UTC and refuses bad links', () => {
    const iso = eventIsoFromLocal('2026-11-18T09:12')!;
    expect(new Date(iso).getMinutes()).toBe(12);
    expect(eventIsoFromLocal('yesterday')).toBeNull();
    expect(cleanSourceUrl(' https://example.org/a ')).toBe('https://example.org/a');
    expect(cleanSourceUrl('ftp://example.org')).toBeNull();
    expect(cleanSourceUrl('')).toBeNull();
  });
});

describe('Recorded area snapshots', () => {
  it('replays the snapshot standing at a time, extends unchanged ones and says when nothing was recorded', () => {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    expect(store.layerFrame('gnss', '2026-11-18T10:00:00.000Z').state).toBe('unknown');
    const cells = [rec('c1', 26.5, 56.5, { category: 'high' })];
    expect(store.recordLayerFrame('gnss', 'hormuz', '2026-11-18T10:00:00.000Z', cells, 24)).toBe(true);
    expect(store.recordLayerFrame('gnss', 'hormuz', '2026-11-18T10:03:00.000Z', cells, 24)).toBe(true);
    const f = store.layerFrame('gnss', '2026-11-18T10:05:00.000Z');
    expect(f).toMatchObject({ state: 'recorded', observedAt: '2026-11-18T10:00:00.000Z', lastSeenAt: '2026-11-18T10:03:00.000Z', area: 'hormuz' });
    expect(f.records.map((r) => r.id)).toEqual(['c1']);
    // Ten minutes after it was last seen, the snapshot no longer stands for the area.
    expect(store.layerFrame('gnss', '2026-11-18T10:14:00.000Z').state).toBe('unknown');
    expect(store.layerFrame('gnss', '2026-11-18T09:59:00.000Z').state).toBe('unknown');
    store.recordLayerFrame('gnss', 'hormuz', '2026-11-18T10:06:00.000Z', [], 24);
    expect(store.layerFrame('gnss', '2026-11-18T10:07:00.000Z')).toMatchObject({ state: 'recorded', records: [] });
    expect(store.recordLayerFrame('conflicts', 'hormuz', '2026-11-18T10:00:00.000Z', Array.from({ length: 5001 }, (_, i) => rec('x' + i, 26, 56)), 24)).toBe(false);
  });
});

describe('Watch-area recorder', () => {
  function setup(over: { ais?: GeoRecord[] | null; adsbWaitUntil?: number } = {}) {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    const settings = { ...DEFAULT_SETTINGS, recordAreaId: 'hormuz' } as Settings;
    const backoff = new Map<string, { until: number; strikes: number }>();
    if (over.adsbWaitUntil) backoff.set('api.adsb.lol', { until: over.adsbWaitUntil, strikes: 1 });
    const calls: string[] = [];
    const r = new AreaRecorder({
      store,
      fetchJson: (() => { throw new Error('no network in tests'); }) as never,
      fetchText: (() => { throw new Error('no network in tests'); }) as never,
      getSettings: () => settings, userAgent: () => 'test', sources: () => ({ backoff, cache: new Map() }),
      isLayerOn: () => false, liveRecords: () => [], aisRecords: () => over.ais ?? null, onChange: () => {},
      now: () => new Date('2026-11-18T10:00:30.000Z'),
      fetchers: {
        aircraft: async (ctx) => { calls.push(`aircraft ${ctx.view!.lat},${ctx.view!.lon}`); return { records: [rec('a-in', 26.6, 56.2), rec('a-far', 48.8, 2.3)], skipped: 0, sourceUpdatedAt: null, note: null }; },
        gnss: async () => ({ records: [rec('cell-in', 26.0, 56.0, { category: 'high' }), rec('cell-far', 10, 10)], skipped: 0, sourceUpdatedAt: null, note: null }),
      },
    });
    return { r, store, calls, area: watchArea('hormuz')! };
  }

  it('stores only what lies in the area: aircraft fixes and a GPS-cell snapshot', async () => {
    const { r, store, calls, area } = setup();
    await r.run('aircraft', area);
    await r.run('gnss', area);
    expect(calls).toEqual(['aircraft 26.45,56.4']);
    expect(store.trackSnapshot('aircraft', '2026-11-18T10:01:00.000Z', 5 * 60_000).map((p) => p.rid)).toEqual(['a-in']);
    expect(store.layerFrame('gnss', '2026-11-18T10:02:00.000Z').records.map((c) => c.id)).toEqual(['cell-in']);
    expect(r.status.tasks.aircraft).toMatchObject({ ok: true, count: 1 });
  });

  it('waits while adsb.lol asks to, and says ships need a key', async () => {
    const { r, calls, area } = setup({ adsbWaitUntil: Date.parse('2026-11-18T10:05:00.000Z') });
    await r.run('aircraft', area);
    await r.run('vessels', area);
    expect(calls).toEqual([]);
    expect(r.status.tasks.aircraft).toMatchObject({ ok: false });
    expect(r.status.tasks.vessels?.error).toMatch(/AISStream key/);
  });

  it('reports an incomplete reply with no aircraft as not recorded, not as an empty sky', async () => {
    const { r, store, area } = setup();
    (r as unknown as { d: { fetchers: Record<string, unknown> } }).d.fetchers.aircraft = async () => ({ records: [], skipped: 0, sourceUpdatedAt: null, note: null, incomplete: { error: 'adsb.lol: HTTP 429', retryAt: null } });
    await r.run('aircraft', area);
    expect(r.status.tasks.aircraft).toMatchObject({ ok: false, error: 'adsb.lol: HTTP 429' });
    expect(store.trackSnapshot('aircraft', '2026-11-18T10:01:00.000Z', 5 * 60_000)).toEqual([]);
  });

  it('records ships from the AISStream socket inside the area', async () => {
    const { r, store, area } = setup({ ais: [rec('ship-in', 26.4, 56.6, { altM: null }), rec('ship-far', 60, 25)] });
    await r.run('vessels', area);
    expect(store.trackSnapshot('vessels', '2026-11-18T10:01:00.000Z', 5 * 60_000).map((p) => p.rid)).toEqual(['ship-in']);
  });
});
