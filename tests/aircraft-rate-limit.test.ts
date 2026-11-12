import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import type { ViewState } from '../src/shared/layers';
import { FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { FETCHERS, aircraftQueryPlan, type FetchContext, type SourceState } from '../src/main/layers/fetchers';
import { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { fixture, tempDbPath } from './helpers';

const BASE = Date.parse('2026-11-11T18:00:00Z');
let testNumber = 0;
let now = BASE;
const close: ViewState = { lat: 40, lon: -105, heightM: 200_000, bbox: [-106, 39, -104, 41] };
const wide: ViewState = { ...close, heightM: 4_000_000, bbox: [-150, 10, -60, 70] };
const stores: AtlasStore[] = [];
const managers: LayerManager[] = [];

function payload(hex: string, time = Date.now()) {
  const source = fixture<{ now: number; ac: Record<string, unknown>[] }>('layers/adsb.json');
  return { now: time, ac: [{ ...source.ac[0], hex, seen_pos: 0 }] };
}
function worldwide() {
  const body = fixture<{ time: number; states: unknown[][] }>('layers/opensky.json');
  body.time = Math.floor(Date.now() / 1000);
  body.states[0][3] = body.time; body.states[0][4] = body.time;
  return body;
}
function state(): SourceState { return { backoff: new Map(), cache: new Map() }; }
function context(fetchJson: FetchJson, over: Partial<FetchContext> = {}): FetchContext {
  return { view: wide, settings: { ...DEFAULT_SETTINGS, worldAircraft: false }, fetchJson, fetchText: async () => ({ status: 200, text: '' }),
    userAgent: 'test fixture', store: null as never, localReceiverUrl: null, now: new Date(Date.now()), clock: () => Date.now(), sources: state(), ...over };
}
function manager(fetchJson: FetchJson, options: { local?: string; settings?: Partial<Settings> } = {}) {
  const store = new AtlasStore(tempDbPath()); stores.push(store);
  const settings: Settings = { ...DEFAULT_SETTINGS, worldAircraft: false, layersEnabled: ['aircraft'], ...options.settings };
  const lm = new LayerManager({ store, fetchJson, fetchText: async () => ({ status: 200, text: '' }), getSettings: () => settings,
    userAgent: () => 'test fixture', localReceiverUrl: () => options.local ?? null, ais: null, aisConfigured: () => false, emit: () => {} });
  managers.push(lm);
  return { lm, settings, store };
}

beforeEach(() => { vi.useFakeTimers(); now = BASE + ++testNumber * 3_600_000; vi.setSystemTime(now); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { for (const lm of managers.splice(0)) lm.stop(); for (const store of stores.splice(0)) store.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('aircraft grid provider limits', () => {
  it.each([429, 503])('stops starting further grid batches on HTTP %s and preserves partial fixes and Retry-After', async (status) => {
    const calls: string[] = [];
    const ctx = context(async (url) => {
      calls.push(url);
      if (calls.length === 1) throw new FeedHttpError(`HTTP ${status}`, status, 120, 'http');
      return { status: 200, body: payload(`abc00${calls.length}`) };
    });
    expect(aircraftQueryPlan(wide).centers.length).toBeGreaterThan(3);
    const result = await FETCHERS.aircraft(ctx);
    expect(calls).toHaveLength(3); // Only the three requests already in flight may settle.
    expect(result.records).toHaveLength(2);
    expect(result.incomplete?.error).toContain(`HTTP ${status}`);
    expect(result.incomplete?.retryAt).toBe(now + 120_000);
    vi.setSystemTime(now + 30_000);
    const blocked = await FETCHERS.aircraft({ ...ctx, now: new Date(Date.now()) });
    expect(calls).toHaveLength(3);
    expect(blocked.incomplete?.retryAt).toBe(now + 120_000);
  });

  it('uses the oldest included source time, keeps the newest duplicate fix, and does not restamp cached areas', async () => {
    let publicCalls = 0;
    let localCalls = 0;
    const ctx = context(async (url) => {
      if (url.startsWith('http://192.168.')) {
        localCalls++;
        return { status: 200, body: payload('def456', localCalls === 1 ? now - 60_000 : Date.now()) };
      }
      return { status: 200, body: payload('abc123', now - 30_000 + publicCalls++ * 1000) };
    }, { localReceiverUrl: 'http://192.168.1.50/data/aircraft.json' });
    const first = await FETCHERS.aircraft(ctx);
    expect(first.sourceUpdatedAt).toBe(new Date(now - 60_000).toISOString());
    expect(first.records.find((r) => r.id === 'abc123')?.observedAt).toBe(new Date(now - 19_000).toISOString());
    vi.setSystemTime(now + 20_000);
    const cached = await FETCHERS.aircraft({ ...ctx, now: new Date(Date.now()) });
    expect(publicCalls).toBe(12);
    expect(localCalls).toBe(2);
    expect(cached.sourceUpdatedAt).toBe(new Date(now - 30_000).toISOString());
  });

  it('keeps the original cached observation time even when a provider payload has no source clock', async () => {
    let calls = 0;
    const ctx = context(async () => {
      calls++;
      const body = payload('abc123');
      return { status: 200, body: { ac: body.ac } };
    });
    const first = await FETCHERS.aircraft(ctx);
    vi.setSystemTime(now + 20_000);
    const next = await FETCHERS.aircraft({ ...ctx, now: new Date(Date.now()) });
    expect(calls).toBe(12);
    expect(next.sourceUpdatedAt).toBe(first.sourceUpdatedAt);
    expect(next.records[0].observedAt).toBe(first.records[0].observedAt);
  });

  it('starts Retry-After at receipt time rather than the earlier refresh start', async () => {
    const ctx = context(async () => { vi.setSystemTime(now + 10_000); throw new FeedHttpError('HTTP 429', 429, 120, 'http'); }, { view: close });
    const result = await FETCHERS.aircraft(ctx);
    expect(result.incomplete?.retryAt).toBe(now + 130_000);
  });

  it('does not erase a military-layer host limit when an already-started grid batch later succeeds', async () => {
    const pending: ((value: { status: number; body: unknown }) => void)[] = [];
    const shared = state();
    const ctx = context(async (url) => {
      if (url.endsWith('/mil')) throw new FeedHttpError('HTTP 429', 429, 120, 'http');
      return await new Promise((resolve) => pending.push(resolve));
    }, { sources: shared });
    const grid = FETCHERS.aircraft(ctx);
    expect(pending).toHaveLength(3);
    await FETCHERS.aircraftMil(ctx);
    pending.forEach((resolve, i) => resolve({ status: 200, body: payload(`abc00${i}`) }));
    const result = await grid;
    expect(result.records).toHaveLength(3);
    expect(result.incomplete?.retryAt).toBe(now + 120_000);
    expect(shared.backoff.get('api.adsb.lol')?.until).toBe(now + 120_000);
  });

  it('does not shorten a newer grid cooldown when an already-started military request gets a shorter Retry-After', async () => {
    let rejectMilitary: ((error: Error) => void) | null = null;
    const shared = state();
    const ctx = context(async (url) => {
      if (url.endsWith('/mil')) return await new Promise((_resolve, reject) => { rejectMilitary = reject; });
      throw new FeedHttpError('HTTP 429', 429, 600, 'http');
    }, { view: close, sources: shared });
    const military = FETCHERS.aircraftMil(ctx);
    await FETCHERS.aircraft(ctx);
    const reject = rejectMilitary as unknown as (error: Error) => void;
    reject(new FeedHttpError('HTTP 429', 429, 10, 'http'));
    const result = await military;
    expect(result.incomplete?.retryAt).toBe(now + 600_000);
    expect(shared.backoff.get('api.adsb.lol')).toEqual({ until: now + 600_000, strikes: 2 });
  });
});

describe('aircraft layer scheduling during incomplete coverage', () => {
  it('retains observed fixes, exposes partial failure, and makes force/pan/toggle/military requests respect cooldown', async () => {
    let phase: 'initial' | 'limited' | 'recover' = 'initial';
    let calls = 0;
    let limitedCalls = 0;
    const { lm, settings } = manager(async () => {
      calls++;
      if (phase === 'initial') return { status: 200, body: payload('abc123') };
      if (phase === 'limited') {
        if (++limitedCalls === 1) throw new FeedHttpError('HTTP 429', 429, 120, 'http');
        return { status: 200, body: payload(`def00${limitedCalls}`) };
      }
      return { status: 200, body: payload('abc999') };
    });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    const initial = lm.snapshot('aircraft');
    const successAt = initial.status.lastSuccessAt;
    expect(initial.records.map((r) => r.id)).toEqual(['abc123']);
    vi.setSystemTime(now + 1000);
    phase = 'limited'; lm.setView(wide); await lm.refresh('aircraft');
    const partial = lm.snapshot('aircraft');
    expect(partial.records.map((r) => r.id).sort()).toEqual(['abc123', 'def002', 'def003']);
    expect(partial.status).toMatchObject({ state: 'error', lastSuccessAt: successAt, sourceUpdatedAt: new Date(now).toISOString() });
    expect(partial.status.error).toContain('429');
    expect(partial.records.find((r) => r.id === 'abc123')?.observedAt).toBe(new Date(now).toISOString());
    const deadline = now + 121_000;
    expect(partial.status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    const before = calls;
    for (let i = 0; i < 5; i++) { lm.setView({ ...wide, lon: i * 30 }); await lm.refresh('aircraft'); await lm.refresh('aircraftMil'); }
    settings.layersEnabled = []; lm.syncEnabled(); settings.layersEnabled = ['aircraft', 'aircraftMil']; lm.syncEnabled();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(calls).toBe(before);
    phase = 'recover'; await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBeGreaterThan(before);
    expect(lm.snapshot('aircraft').status.state).toBe('ok');
    expect(lm.snapshot('aircraft').records.map((r) => r.id)).toEqual(['abc999']);
  });

  it('continues independent local-receiver updates while the shared public host is cooling down', async () => {
    let limited = false;
    let publicCalls = 0;
    let localCalls = 0;
    const { lm } = manager(async (url) => {
      if (url.startsWith('http://192.168.')) { localCalls++; return { status: 200, body: payload('def456') }; }
      publicCalls++;
      if (limited) throw new FeedHttpError('HTTP 503', 503, 180, 'http');
      return { status: 200, body: payload('abc123') };
    }, { local: 'http://192.168.1.50/data/aircraft.json' });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    limited = true; vi.setSystemTime(now + 1000); await lm.refresh('aircraft');
    const publicBefore = publicCalls;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(publicCalls).toBe(publicBefore);
    expect(localCalls).toBe(3);
    expect(lm.snapshot('aircraft').records.find((r) => r.id === 'def456')?.observedAt).toBe(new Date(Date.now()).toISOString());
    await lm.refresh('aircraft'); await lm.refresh('aircraftMil');
    expect(publicCalls).toBe(publicBefore);
    expect(localCalls).toBe(4);
    expect(lm.snapshot('aircraft').status.state).toBe('error');
    expect(lm.snapshot('aircraft').status.error).toContain('cooldown');
  });

  it('also respects a local receiver Retry-After without stopping the independent public source', async () => {
    let publicCalls = 0;
    let localCalls = 0;
    const { lm } = manager(async (url) => {
      if (url.startsWith('http://192.168.')) { localCalls++; throw new FeedHttpError('HTTP 503', 503, 180, 'http'); }
      publicCalls++; return { status: 200, body: payload('abc123') };
    }, { local: 'http://192.168.1.50/data/aircraft.json' });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(localCalls).toBe(1);
    expect(publicCalls).toBe(2);
    expect(lm.snapshot('aircraft').records[0].observedAt).toBe(new Date(Date.now()).toISOString());
  });

  it('allows an opted-in OpenSky snapshot after zooming out during an adsb.lol cooldown, but not another adsb.lol request', async () => {
    let adsb = 0;
    let openSky = 0;
    const { lm, settings } = manager(async (url) => {
      if (url.includes('opensky-network.org')) { openSky++; return { status: 200, body: worldwide() }; }
      adsb++; throw new FeedHttpError('HTTP 429', 429, 180, 'http');
    });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    expect(adsb).toBe(1);
    settings.worldAircraft = true; lm.setView(wide); await vi.advanceTimersByTimeAsync(1201);
    expect(openSky).toBe(1);
    expect(adsb).toBe(1);
    expect(lm.snapshot('aircraft').records[0].props.snapshot).toBe(true);
    lm.setView(close); await vi.advanceTimersByTimeAsync(1200); await lm.refresh('aircraft');
    expect(adsb).toBe(1);
  });

  it('changes to the independent worldwide source when only the opted-in setting changes at the same wide view', async () => {
    let adsb = 0;
    let openSky = 0;
    const { lm, settings } = manager(async (url) => {
      if (url.includes('opensky-network.org')) { openSky++; return { status: 200, body: worldwide() }; }
      adsb++; throw new FeedHttpError('HTTP 503', 503, 180, 'http');
    });
    lm.setView(wide); lm.start(); await vi.advanceTimersByTimeAsync(0);
    expect(adsb).toBe(3);
    settings.worldAircraft = true; lm.syncEnabled(); await vi.advanceTimersByTimeAsync(0);
    expect(openSky).toBe(1);
    expect(adsb).toBe(3);
  });

  it('queues an independent source switch while an earlier aircraft request is still in flight', async () => {
    let failOld: ((error: Error) => void) | null = null;
    let openSky = 0;
    const { lm, settings } = manager(async (url) => {
      if (url.includes('opensky-network.org')) { openSky++; return { status: 200, body: worldwide() }; }
      return await new Promise((_resolve, reject) => { failOld = reject; });
    });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    settings.worldAircraft = true; lm.setView(wide); await vi.advanceTimersByTimeAsync(1200);
    const reject = failOld as unknown as (error: Error) => void;
    reject(new FeedHttpError('HTTP 429', 429, 180, 'http'));
    await vi.waitFor(() => expect(openSky).toBe(1));
    expect(lm.snapshot('aircraft').records[0]?.source).toBe('OpenSky Network');
  });

  it('resumes an already-enabled military poll automatically after a shared host cooldown', async () => {
    let phase: 'ok' | 'limited' | 'recover' = 'ok';
    let military = 0;
    let publicCalls = 0;
    const { lm } = manager(async (url) => {
      if (url.endsWith('/mil')) military++;
      publicCalls++;
      if (phase === 'limited') throw new FeedHttpError('HTTP 429', 429, 120, 'http');
      return { status: 200, body: payload('abc123') };
    }, { settings: { layersEnabled: ['aircraft', 'aircraftMil'] } });
    lm.setView(close); lm.start(); await vi.advanceTimersByTimeAsync(0);
    expect(military).toBe(1);
    phase = 'limited'; await lm.refresh('aircraft');
    const before = publicCalls;
    await vi.advanceTimersByTimeAsync(119_999);
    expect(publicCalls).toBe(before);
    phase = 'recover'; await vi.advanceTimersByTimeAsync(1);
    expect(military).toBe(2);
    expect(lm.snapshot('aircraftMil').status.state).toBe('ok');
  });
});
