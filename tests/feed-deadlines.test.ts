import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { LAYERS } from '../src/shared/layers';
import { FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { MAX_DATE_MS, MAX_TIMEOUT_MS } from '../src/main/feeds/timing';
import { FETCHERS, type FetchContext, type SourceState } from '../src/main/layers/fetchers';
import nswCamera from './fixtures/layers/deadline-nsw-camera.json';

const NOW = Date.parse('2026-11-11T18:00:00Z');
const sourceState = (): SourceState => ({ backoff: new Map(), cache: new Map() });
function context(fetchJson: FetchJson, sources = sourceState()): FetchContext {
  return {
    view: { lat: 40, lon: -105, heightM: 200000, bbox: [-106, 39, -104, 41] },
    settings: { ...DEFAULT_SETTINGS, worldAircraft: false }, sources,
    fetchJson, fetchText: async () => { throw new FeedHttpError('HTTP 429 fixture', 429, Infinity, 'http'); },
    userAgent: 'deadline test fixture', store: null as never, localReceiverUrl: null,
    now: new Date(NOW), clock: () => Date.now(),
  };
}
function expectSerializableDeadline(deadline: number | null | undefined): void {
  expect(deadline).toBeTypeOf('number');
  expect(Number.isFinite(deadline)).toBe(true);
  expect(deadline!).toBeGreaterThan(NOW + MAX_TIMEOUT_MS);
  expect(deadline!).toBeLessThanOrEqual(MAX_DATE_MS);
  expect(() => new Date(deadline!).toISOString()).not.toThrow();
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('large publisher cooldowns through actual layer fetch paths', () => {
  it.each([
    ['aircraft', Number.MAX_VALUE], ['aircraft', Infinity],
    ['aircraftMil', Number.MAX_VALUE], ['aircraftMil', Infinity],
  ] as const)('%s keeps Retry-After %s finite and suppresses later same-host queries', async (layer, retryAfter) => {
    const fetch = vi.fn<FetchJson>(async () => { throw new FeedHttpError('HTTP 429 fixture', 429, retryAfter, 'http'); });
    const ctx = context(fetch);
    const first = await FETCHERS[layer](ctx);
    const deadline = first.incomplete?.retryAt;
    expectSerializableDeadline(deadline);
    expect(ctx.sources!.backoff.get('api.adsb.lol')?.until).toBe(deadline);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 86400_000);
    // Both aircraft modes share a provider limit; notes must still format the extended date safely.
    const next = await FETCHERS[layer === 'aircraft' ? 'aircraftMil' : 'aircraft']({ ...ctx, now: new Date(Date.now()) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(next.incomplete?.retryAt).toBe(deadline);
    expect(next.incomplete?.error).toContain('cooldown until');
    expect(next.incomplete?.error).not.toContain('Invalid Date');
  });

  it('does not shorten a concurrent maximum-date host cooldown when an in-flight request receives a shorter one', async () => {
    let reject!: (error: Error) => void;
    const shared = sourceState();
    const ctx = context(async () => await new Promise((_resolve, fail) => { reject = fail; }), shared);
    const pending = FETCHERS.aircraftMil(ctx);
    // Another in-flight aircraft query has established a longer host wait while this request was outstanding.
    shared.backoff.set('api.adsb.lol', { until: MAX_DATE_MS, strikes: 4 });
    reject(new FeedHttpError('HTTP 503 fixture', 503, 120, 'http'));
    const result = await pending;
    expect(result.incomplete?.retryAt).toBe(MAX_DATE_MS);
    expect(shared.backoff.get('api.adsb.lol')).toEqual({ until: MAX_DATE_MS, strikes: 5 });
    expectSerializableDeadline(result.incomplete?.retryAt);
  });

  it.each([Number.MAX_VALUE, Infinity])('camera catalogs keep an enormous Retry-After %s without invalid refresh timestamps or repeated host requests', async (retryAfter) => {
    const seen: string[] = [];
    const fail = async (url: string): Promise<never> => {
      seen.push(new URL(url).host);
      throw new FeedHttpError('HTTP 503 fixture', 503, retryAfter, 'http');
    };
    const ctx = context(fail);
    ctx.fetchText = fail;
    const result = await FETCHERS.cameras(ctx);
    expectSerializableDeadline(result.refreshAt);
    expect(seen.filter((host) => host === 'cwwp2.dot.ca.gov')).toHaveLength(1);
    for (const { until } of ctx.sources!.backoff.values()) expectSerializableDeadline(until);
    const before = seen.length;
    vi.setSystemTime(NOW + 86400_000);
    const next = await FETCHERS.cameras({ ...ctx, now: new Date(Date.now()) });
    expect(seen).toHaveLength(before);
    expect(next.refreshAt).toBe(result.refreshAt);
    expect(next.failure).toContain('All camera catalogs failed');
  });

  it.each([307, 403])('aircraft pauses respect an explicit Retry-After on HTTP %s', async (status) => {
    const fetch = vi.fn<FetchJson>(async () => { throw new FeedHttpError(`HTTP ${status} fixture`, status, 180, 'http'); });
    const ctx = context(fetch);
    const result = await FETCHERS.aircraft(ctx);
    expect(result.incomplete?.retryAt).toBe(NOW + 180000);
    const military = await FETCHERS.aircraftMil(ctx);
    expect(military.incomplete?.retryAt).toBe(NOW + 180000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('military requests preserve an explicit redirect pause while ordinary 403 errors stay access errors', async () => {
    const paused = context(async () => { throw new FeedHttpError('HTTP 307 fixture', 307, 180, 'http'); });
    expect((await FETCHERS.aircraftMil(paused)).incomplete?.retryAt).toBe(NOW + 180000);
    const denied = context(async () => { throw new FeedHttpError('HTTP 403 fixture', 403, null, 'http'); });
    await expect(FETCHERS.aircraftMil(denied)).rejects.toMatchObject({ status: 403, retryAfterSec: null });
    expect(denied.sources!.backoff.size).toBe(0);
    expect((await FETCHERS.aircraft(denied)).incomplete?.retryAt).toBeNull();
    expect(denied.sources!.backoff.size).toBe(0);
  });

  it.each([null, 180])('a rejected camera key drops its cached catalog, with Retry-After %s independently controlling host pause', async (retryAfter) => {
    let rejected = false;
    const ctx = context(async (url) => {
      if (!url.startsWith('https://api.transport.nsw.gov.au/')) throw new FeedHttpError('Network fixture', null, null, 'network');
      if (rejected) throw new FeedHttpError('HTTP 403 fixture', 403, retryAfter, 'http');
      return { status: 200, body: nswCamera };
    });
    ctx.fetchText = async () => { throw new FeedHttpError('Network fixture', null, null, 'network'); };
    ctx.cameraKey = (id) => id === 'cam-nsw' ? 'fixture-key-12345' : null;
    expect((await FETCHERS.cameras(ctx)).records).toHaveLength(1);
    expect(ctx.sources!.cache.size).toBe(1);
    rejected = true;
    vi.setSystemTime(NOW + LAYERS.cameras.pollSeconds * 1000);
    const result = await FETCHERS.cameras({ ...ctx, now: new Date(Date.now()) });
    expect(result.records).toEqual([]);
    expect(result.failure).toContain('key rejected');
    expect(ctx.sources!.cache.size).toBe(0);
    expect(ctx.sources!.backoff.has('api.transport.nsw.gov.au')).toBe(retryAfter !== null);
    if (retryAfter !== null) expect(result.refreshAt).toBe(Date.now() + retryAfter * 1000);
  });
});
