import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { FetchJson } from '../src/main/feeds/http';
import type { FetchContext } from '../src/main/layers/fetchers';
import type { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { tempDbPath } from './helpers';
import type { ViewState } from '../src/shared/layers';

const NOW = Date.parse('2026-11-11T18:00:00Z');
const crossing: ViewState = { lat: -18, lon: 180, heightM: 200_000, bbox: [175.123456, -22.123456, -170.987654, -14.123456] };
let FETCHERS: typeof import('../src/main/layers/fetchers').FETCHERS;
let FeedHttpError: typeof import('../src/main/feeds/http').FeedHttpError;
const managers: LayerManager[] = [];
const stores: AtlasStore[] = [];
const report = (icaoId: string, lon: number, ageSeconds = 0) => ({ icaoId, lat: -18, lon, obsTime: (NOW / 1000) - ageSeconds, temp: 25, rawOb: `METAR ${icaoId}` });
function context(fetchJson: FetchJson, view = crossing): FetchContext {
  return { view, settings: DEFAULT_SETTINGS, fetchJson, fetchText: async () => ({ status: 204, text: '' }),
    userAgent: 'Atlas Watch METAR fixture', store: null as never, localReceiverUrl: null, now: new Date(NOW), clock: Date.now };
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  ({ FETCHERS } = await import('../src/main/layers/fetchers'));
  ({ FeedHttpError } = await import('../src/main/feeds/http'));
});
afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  for (const store of stores.splice(0)) store.close();
  vi.useRealTimers();
});

describe('NOAA METAR date-line view', () => {
  it('queries both ordinary boxes in documented order/precision with at least 600ms between starts', async () => {
    const calls: { bbox: string | null; at: number }[] = [];
    const pending = FETCHERS.metar(context(async (raw) => {
      calls.push({ bbox: new URL(raw).searchParams.get('bbox'), at: Date.now() });
      return { status: 200, body: [report(calls.length === 1 ? 'NFFN' : 'NFTF', calls.length === 1 ? 177.443 : -175.15)] };
    }));
    await vi.advanceTimersByTimeAsync(599);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(calls).toEqual([
      { bbox: '-22.123,175.123,-14.123,180.000', at: NOW },
      { bbox: '-22.123,-180.000,-14.123,-170.988', at: NOW + 600 },
    ]);
    expect(result.records.map((record) => record.id)).toEqual(['NFFN', 'NFTF']);
    expect(result.note).toBeNull();
  });

  it('uses one ordinary query without date-line crossing and deduplicates newest station observations', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => ({ status: 200, body: [report('NFFN', 177.4, 600), report('NFFN', 177.4, 0), report('NFFN', 177.4, 1200)] }));
    const result = await FETCHERS.metar(context(fetchJson, { ...crossing, bbox: [175, -22, 179, -14] }));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].observedAt).toBe(new Date(NOW).toISOString());
  });

  it('deduplicates date-line boundary stations across boxes and sums invalid skips', async () => {
    let count = 0;
    const pending = FETCHERS.metar(context(async () => ({ status: 200, body: ++count === 1
      ? [report('EDGE', 180, 600), { icaoId: 'BAD' }]
      : [report('EDGE', -180), { icaoId: 'BAD2' }, report('NFTF', -175.15)] })));
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.records).toHaveLength(2);
    expect(result.records.find((record) => record.id === 'EDGE')?.observedAt).toBe(new Date(NOW).toISOString());
    expect(result.skipped).toBe(2);
  });

  it.each([false, true])('treats a 204 first half as empty and continues the second (both empty: %s)', async (bothEmpty) => {
    let count = 0;
    const pending = FETCHERS.metar(context(async () => ++count === 1 || bothEmpty
      ? { status: 204, body: null } : { status: 200, body: [report('NFTF', -175.15)] }));
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(count).toBe(2);
    expect(result.records).toHaveLength(bothEmpty ? 0 : 1);
    expect(result.skipped).toBe(0);
  });

  it('detects truncation per raw response before station deduplication or invalid-row skips', async () => {
    let count = 0;
    const limited = Array.from({ length: 399 }, () => report('NFFN', 177.4));
    const pending = FETCHERS.metar(context(async () => ({ status: 200, body: ++count === 1 ? [...limited, { icaoId: 'BAD' }] : [report('NFTF', -175.15)] })));
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.records).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.note).toContain('400-observation limit in 1 of 2 query boxes');
    expect(result.note).toContain('may be truncated');
  });

  it('paces separate forced refreshes too', async () => {
    const starts: number[] = [];
    const ctx = context(async () => { starts.push(Date.now()); return { status: 204, body: null }; }, { ...crossing, bbox: [175, -22, 179, -14] });
    await FETCHERS.metar(ctx);
    const next = FETCHERS.metar(ctx);
    await vi.advanceTimersByTimeAsync(599); expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await next;
    expect(starts).toEqual([NOW, NOW + 600]);
  });

  it('keeps monotonic request spacing when the system clock jumps forward', async () => {
    const starts: number[] = [];
    const ctx = context(async () => { starts.push(performance.now()); return { status: 204, body: null }; }, { ...crossing, bbox: [175, -22, 179, -14] });
    await FETCHERS.metar(ctx);
    vi.setSystemTime(NOW + 100 * 365 * 86_400_000);
    const next = FETCHERS.metar(ctx);
    await vi.advanceTimersByTimeAsync(599); expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await next;
    expect(starts[1] - starts[0]).toBe(600);
  });

  it('propagates first-half Retry-After unchanged and never starts the second half', async () => {
    const error = new FeedHttpError('NOAA HTTP 429', 429, 120, 'http');
    const fetchJson = vi.fn<FetchJson>(async () => { throw error; });
    await expect(FETCHERS.metar(context(fetchJson))).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed second half atomically and preserves manager records/cooldown across force, pan and toggles', async () => {
    const { LayerManager: Manager } = await import('../src/main/layers/manager');
    const settings = { ...DEFAULT_SETTINGS, layersEnabled: ['metar'] };
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    let calls = 0;
    const fetchJson: FetchJson = async () => {
      calls++;
      if (calls === 3) throw new FeedHttpError('NOAA HTTP 503', 503, 120, 'http');
      return { status: 200, body: [report(calls === 1 ? 'LAST' : 'NEW', 177.4)] };
    };
    const manager = new Manager({ store, fetchJson, fetchText: async () => ({ status: 204, text: '' }), getSettings: () => settings,
      userAgent: () => 'fixture', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: () => {} });
    managers.push(manager);
    manager.setView({ ...crossing, bbox: [175, -22, 179, -14] });
    manager.start(); await vi.advanceTimersByTimeAsync(0);
    expect(manager.snapshot('metar').records[0].id).toBe('LAST');
    manager.setView(crossing);
    const pending = manager.refresh('metar'); await vi.advanceTimersByTimeAsync(1200); await pending;
    const failed = manager.snapshot('metar');
    expect(calls).toBe(3);
    expect(failed.status.state).toBe('error');
    expect(failed.records.map((record) => record.id)).toEqual(['LAST']);
    expect(failed.status.lastSuccessAt).toBe(new Date(NOW).toISOString());
    const deadline = Date.parse(failed.status.nextAttemptAt!);
    expect(deadline).toBeGreaterThanOrEqual(NOW + 121_200);
    await manager.refresh('metar');
    manager.setView({ ...crossing, lat: -10 }); await vi.advanceTimersByTimeAsync(1201);
    settings.layersEnabled = []; manager.syncEnabled(); settings.layersEnabled = ['metar']; manager.syncEnabled();
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(calls).toBe(3);
  });
});
