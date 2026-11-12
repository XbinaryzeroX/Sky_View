import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from './helpers';
import { MAX_DATE_MS } from '../src/main/feeds/timing';
import { parseRetryAfter } from '../src/shared/retryAfter';

const sample = fixture<{ receivedAt: string; longSeconds: number; httpDate: string; obsoleteDate: string; asctimeDate: string; futureObsoleteDate: string; futureObsoleteIso: string; invalidHeaders: string[] }>('retry-after.json');
const receivedAt = Date.parse(sample.receivedAt);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(receivedAt);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('main HTTP publisher pauses', () => {
  it('interprets obsolete two-digit years with the HTTP fifty-year window', () => {
    expect(parseRetryAfter(sample.futureObsoleteDate, receivedAt)).toBe(Math.ceil((Date.parse(sample.futureObsoleteIso) - receivedAt) / 1000));
    expect(parseRetryAfter('Friday, 06-Nov-76 08:49:37 GMT', receivedAt)).toBeGreaterThan(49 * 365 * 86400);
    expect(parseRetryAfter('Saturday, 06-Nov-77 08:49:37 GMT', receivedAt)).toBe(0);
    expect(parseRetryAfter('Saturday, 06-Nov-00 08:49:37 GMT', Date.parse('2099-11-01T00:00:00Z'))).toBe(31_999_777);
  });
  it('keeps a multi-day delay and blocks other paths on the same origin until it ends', async () => {
    const network = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': String(sample.longSeconds) } }))
      .mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', network);
    const { fetchJson } = await import('../src/main/feeds/http');
    await expect(fetchJson('https://api.adsb.lol/v2/mil')).rejects.toMatchObject({ retryAfterSec: sample.longSeconds, status: 429 });
    vi.setSystemTime(receivedAt + 2 * 86400_000);
    await expect(fetchJson('https://api.adsb.lol/v2/point/40/-74/25')).rejects.toMatchObject({ status: 429 });
    expect(network).toHaveBeenCalledTimes(1);
    await expect(fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson')).resolves.toMatchObject({ body: {} });
    vi.setSystemTime(receivedAt + sample.longSeconds * 1000 - 1);
    await expect(fetchJson('https://api.adsb.lol/v2/mil')).rejects.toMatchObject({ retryAfterSec: 1 });
    vi.setSystemTime(receivedAt + sample.longSeconds * 1000);
    await expect(fetchJson('https://api.adsb.lol/v2/mil')).resolves.toMatchObject({ body: {} });
    expect(network).toHaveBeenCalledTimes(3);
  });

  it.each([sample.httpDate, sample.obsoleteDate, sample.asctimeDate])('honors HTTP-date form %s without rounding early', async (date) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503, headers: { 'retry-after': date } })));
    const { fetchJson } = await import('../src/main/feeds/http');
    await expect(fetchJson('https://api.weather.gov/alerts/active')).rejects.toMatchObject({ retryAfterSec: 172801 });
  });

  it.each(sample.invalidHeaders)('rejects malformed delay %s', async (header) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': header } })));
    const { fetchJson } = await import('../src/main/feeds/http');
    await expect(fetchJson('https://api.weather.gov/alerts/active')).rejects.toMatchObject({ retryAfterSec: null });
  });

  it('saturates enormous decimal waits without an invalid Date or unsafe numeric delay', async () => {
    const network = vi.fn().mockResolvedValue(new Response('', { status: 503, headers: { 'retry-after': '9'.repeat(400) } }));
    vi.stubGlobal('fetch', network);
    const { fetchJson, computeBackoffMs } = await import('../src/main/feeds/http');
    await expect(fetchJson('https://api.weather.gov/alerts/active')).rejects.toMatchObject({ retryAfterSec: MAX_DATE_MS / 1000 });
    await expect(fetchJson('https://api.weather.gov/points/40,-74')).rejects.toThrow('Provider cooldown until +275760-09-13');
    expect(network).toHaveBeenCalledTimes(1);
    expect(computeBackoffMs(1, Infinity)).toBe(MAX_DATE_MS);
    expect(computeBackoffMs(1, NaN, () => 0.5)).toBe(30_000);
    expect(computeBackoffMs(1, -1, () => 0.5)).toBe(30_000);
  });

  it('retains a longer concurrent pause after a shorter response arrives', async () => {
    let completeShort!: (value: Response) => void;
    const network = vi.fn().mockImplementationOnce(() => new Promise(resolve => { completeShort = resolve; }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7200' } }));
    vi.stubGlobal('fetch', network);
    const { fetchJson } = await import('../src/main/feeds/http');
    const pending = fetchJson('https://api.adsb.lol/v2/mil').catch(error => error);
    await expect(fetchJson('https://api.adsb.lol/v2/point/40/-74/25')).rejects.toMatchObject({ retryAfterSec: 7200 });
    completeShort(new Response('', { status: 429, headers: { 'retry-after': '10' } }));
    await pending;
    vi.setSystemTime(receivedAt + 3600_000);
    await expect(fetchJson('https://api.adsb.lol/v2/mil')).rejects.toMatchObject({ retryAfterSec: 3600 });
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('honors delayed redirects without fetching the destination early', async () => {
    const network = vi.fn().mockResolvedValueOnce(new Response('', { status: 302, headers: { location: '/ready', 'retry-after': '7200' } }))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', network);
    const { fetchJson } = await import('../src/main/feeds/http');
    await expect(fetchJson('https://api.weather.gov/alerts/active')).rejects.toMatchObject({ status: 302, retryAfterSec: 7200 });
    await expect(fetchJson('https://api.weather.gov/ready')).rejects.toThrow('Provider cooldown');
    expect(network).toHaveBeenCalledTimes(1);
    vi.setSystemTime(receivedAt + 7200_000);
    await expect(fetchJson('https://api.weather.gov/alerts/active')).resolves.toMatchObject({ body: {} });
  });

  it('retains waits conservatively when many distinct in-flight origins fill the bounded cache', async () => {
    const complete: ((value: Response) => void)[] = [];
    const network = vi.fn(() => new Promise<Response>(resolve => complete.push(resolve)));
    vi.stubGlobal('fetch', network);
    const { fetchJson } = await import('../src/main/feeds/http');
    const pending = Promise.allSettled(Array.from({ length: 260 }, (_, index) => fetchJson(`http://127.0.0.1:${20000 + index}/paused`)));
    for (const finish of complete) finish(new Response('', { status: 429, headers: { 'retry-after': '7200' } }));
    await pending;
    await expect(fetchJson('https://api.weather.gov/alerts/active')).rejects.toThrow('Provider pause capacity reached');
    expect(network).toHaveBeenCalledTimes(260);
  });
});
