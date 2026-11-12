import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adjacentImageryDate, availableImageryDate, imageryDatesUrl, ImageryDatesClient, IMAGERY_DATES_MAX_BYTES, IMAGERY_DATES_TIMEOUT_MS, IMAGERY_DATES_TTL_MS, parseImageryDates, validImageryDate } from '../src/shared/imageryDates';
import { isAllowedRendererUrl } from '../src/shared/remoteHosts';
import { archiveImage, archiveYears, imageryYearSchema } from '../src/shared/satelliteYears';
import { archiveDates } from '../src/renderer/map/historicalImagery';
import { placeSearchMode } from '../src/shared/geocoding';

// Actual NASA GIBS DescribeDomains responses, retrieved 2026-11-11; fixtures are never production fallback data.
const terra = readFileSync(join(__dirname, 'fixtures/layers/gibs-terra-dates.xml'), 'utf8');
const grace = readFileSync(join(__dirname, 'fixtures/layers/gibs-grace-dates.xml'), 'utf8');
const product = { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', tileMatrixSet: 'GoogleMapsCompatible_Level9' };
const TODAY = '2026-11-11';
const NOW = Date.parse(`${TODAY}T15:00:00Z`);
const domain = (value: string) => `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>${value}</Domain></DimensionDomain></Domains>`;

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('satellite basemap acquisition years', () => {
  it('fills daily swath gaps with other dates from the selected year only', () => {
    const image = { year: 2001, date: '2001-07-03', sentinelYear: null };
    const dates = archiveDates(image, '2026-11-12');
    expect(dates.at(-1)).toBe(image.date);
    expect(dates).toContain('2001-01-15');
    expect(dates).toContain('2001-12-15');
    expect(dates.every(date => date.startsWith('2001-'))).toBe(true);
    const current = archiveDates({ year: 2026, date: '2026-01-01', sentinelYear: null }, '2026-01-02');
    expect(current.every(date => date >= '2026-01-01' && date <= '2026-01-02')).toBe(true);
  });
  it('offers years with a source and skips the real June–July 2001 Terra data gap', () => {
    const all = parseImageryDates(terra);
    expect(archiveYears(all, TODAY)).toEqual(Array.from({ length: 27 }, (_, i) => 2026 - i));
    expect(archiveImage(2001, all, TODAY)).toEqual({year:2001, date:'2001-07-03', sentinelYear:null});
    expect(archiveImage(2020, all, TODAY)).toEqual({year:2020, date:null, sentinelYear:2020});
    expect(archiveImage(2001, null, TODAY).date).toBe('2001-07-03');
  });
  it('cannot borrow an observation from another year or after the reference date', () => {
    const sparse = parseImageryDates(domain('2018-12-31,2022-01-03,2024-01-07'));
    expect(archiveYears(sparse, '2024-01-05')).toEqual([2022,2021,2020,2018]);
    expect(archiveImage(2019, sparse, TODAY)).toEqual({year:2019, date:null, sentinelYear:null});
    expect(archiveImage(2020, sparse, TODAY)).toEqual({year:2020, date:null, sentinelYear:2020});
    expect(archiveImage(2024, sparse, '2024-01-05').date).toBeNull();
  });
  it('validates the setting and confines geocoding to the currently displayed surface', () => {
    for (const input of [null, 2000, 2020]) expect(imageryYearSchema.safeParse(input).success).toBe(true);
    for (const input of [1999, '2020', 2020.5, new Date().getUTCFullYear() + 1]) expect(imageryYearSchema.safeParse(input).success).toBe(false);
    expect(placeSearchMode('google3d', true, 2020)).toBe('offline');
    expect(placeSearchMode('google3d', true, null)).toBe('google');
  });
});

describe('actual GIBS date domains', () => {
  it('reaches a newly listed date beyond the bundled catalog while preserving source gaps', () => {
    const dates = parseImageryDates(terra);
    expect(dates.ranges).toHaveLength(11);
    expect(availableImageryDate(dates, TODAY, 'before', TODAY)).toBe('2026-11-11');
    expect(availableImageryDate(dates, '2025-11-09', 'before', TODAY)).toBe('2025-11-08');
    expect(availableImageryDate(dates, '2025-11-09', 'after', TODAY)).toBe('2025-11-10');
    expect(adjacentImageryDate(dates, '2025-11-08', 1, TODAY)).toBe('2025-11-10');
    expect(adjacentImageryDate(dates, '2025-11-10', -1, TODAY)).toBe('2025-11-08');
  });

  it('keeps GRACE historical rather than inventing a current date and discloses its malformed source range', () => {
    const dates = parseImageryDates(grace);
    expect(dates.skipped).toBe(1); // NASA lists one reversed range (2020-01-20/2020-01-10).
    expect(dates.ranges).toHaveLength(63);
    expect(availableImageryDate(dates, TODAY, 'before', TODAY)).toBe('2022-12-01');
    expect(adjacentImageryDate(dates, '2002-05-02', 1, TODAY)).toBe('2002-08-01');
    expect(adjacentImageryDate(dates, '2022-12-01', 1, TODAY)).toBeNull();
  });

  it('honors each cadence, overlapping intervals, leap years and the exact latest attainable date', () => {
    const dates = parseImageryDates(domain('2024-01-31/2024-05-31/P1M,2025-01-01/2025-01-10/P3D,2020-02-29/2028-02-29/P1Y'));
    expect(availableImageryDate(dates, '2024-02-29', 'nearest', TODAY)).toBe('2024-02-29');
    expect(availableImageryDate(dates, '2024-02-15', 'before', TODAY)).toBe('2024-01-31');
    expect(availableImageryDate(dates, '2024-02-15', 'after', TODAY)).toBe('2024-02-29');
    expect(availableImageryDate(dates, '2025-01-08', 'nearest', TODAY)).toBe('2025-01-07');
    expect(availableImageryDate(dates, '2025-03-01', 'before', TODAY)).toBe('2025-02-28');
    expect(availableImageryDate(parseImageryDates(domain('2025-01-01/2025-01-09/P3D')), '2026-01-01', 'before', TODAY)).toBe('2025-01-07');
  });

  it('distinguishes a valid empty domain from an error and refuses malformed dates/periods', () => {
    expect(parseImageryDates(domain(''))).toEqual({ ranges: [], skipped: 0 });
    expect(validImageryDate('2024-02-29')).toBe(true);
    expect(validImageryDate('2025-02-29')).toBe(false);
    expect(validImageryDate('2025-02-30')).toBe(false);
    expect(() => parseImageryDates('<html>error</html>')).toThrow();
    expect(() => parseImageryDates(terra.slice(0, -5))).toThrow();
    expect(() => parseImageryDates(domain('2025-02-30,../evil,2020-01-02/2020-01-01/P1D'))).toThrow();
    expect(parseImageryDates(domain('2020-01-01,2020-01-02/2020-01-03/PT1M')).skipped).toBe(1);
    expect(availableImageryDate(parseImageryDates(domain('2030-01-01')), TODAY, 'before', TODAY)).toBeNull();
  });

  it('uses the documented per-product endpoint within the existing renderer allowlist', () => {
    expect(imageryDatesUrl(product)).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/MODIS_Terra_CorrectedReflectance_TrueColor/default/GoogleMapsCompatible_Level9/all/all.xml');
    expect(isAllowedRendererUrl(imageryDatesUrl(product), { google3d: false })).toBe(true);
    expect(() => imageryDatesUrl({ ...product, id: '../x' })).toThrow();
    expect(() => imageryDatesUrl({ ...product, tileMatrixSet: 'https://other.test' })).toThrow();
  });
});

describe('GIBS date request lifecycle', () => {
  it('keeps the Window receiver required by native renderer fetch', async () => {
    const nativeLikeFetch = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(terra));
    };
    const client = new ImageryDatesClient(nativeLikeFetch as typeof fetch, () => NOW);
    await client.load(product);
    expect(client.snapshot(product).state).toBe('ready');
  });

  it('coalesces a product shared by categories and caches the result for an hour', async () => {
    let now = NOW;
    const fetcher = vi.fn(async () => new Response(terra));
    const client = new ImageryDatesClient(fetcher as typeof fetch, () => now);
    const changed = vi.fn();
    const unsubscribe = client.subscribe(changed);
    const first = client.load(product);
    expect(client.load({ ...product })).toBe(first);
    await first;
    expect(client.snapshot(product).state).toBe('ready');
    expect(changed).toHaveBeenCalled();
    await client.load(product);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += IMAGERY_DATES_TTL_MS + 1;
    unsubscribe(); changed.mockClear();
    await client.load(product);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps last checked dates during failure and honors publisher Retry-After before manual retry', async () => {
    let now = NOW;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(terra)).mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } })).mockResolvedValue(new Response(terra));
    const client = new ImageryDatesClient(fetcher, () => now);
    await client.load(product);
    const known = client.snapshot(product).data;
    now += 61_000;
    await client.load(product, true);
    expect(client.snapshot(product)).toMatchObject({ state: 'error', data: known, checkedAt: new Date(NOW).toISOString() });
    now += 119_000;
    await client.load(product, true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += 1001;
    await client.load(product, true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(client.snapshot(product).state).toBe('ready');
  });

  it('pauses all NASA date products on 429/503 so product changes cannot bypass Retry-After', async () => {
    for (const status of [429, 503]) {
      let now = NOW;
      const fetcher = vi.fn().mockResolvedValueOnce(new Response('paused', { status, headers: { 'retry-after': '120' } })).mockResolvedValue(new Response(terra));
      const client = new ImageryDatesClient(fetcher, () => now);
      const other = { ...product, id: 'another_product' };
      await client.load(product);
      await client.load(other, true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(client.snapshot(other)).toMatchObject({ state: 'error', data: null });
      expect(client.snapshot(other).error).toContain('NASA GIBS date checks paused until');
      now += 119_000;
      await client.load(other, true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      now += 1001;
      await client.load(other, true);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(client.snapshot(other).state).toBe('ready');
    }
  });

  it('preserves a cached product during another product rate limit', async () => {
    let now = NOW;
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(terra)).mockResolvedValueOnce(new Response('paused', { status: 429 }));
    const client = new ImageryDatesClient(fetcher, () => now);
    await client.load(product);
    const cached = client.snapshot(product).data;
    now += 61_000;
    await client.load({ ...product, id: 'other_product' });
    await client.load(product, true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.snapshot(product)).toMatchObject({ state: 'error', data: cached });
  });

  it.each(['9'.repeat(400), '8640000000000'])('keeps an enormous publisher pause across product changes (%s)', async (header) => {
    let now = NOW;
    const fetcher = vi.fn().mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': header } }));
    const client = new ImageryDatesClient(fetcher, () => now);
    await client.load(product);
    now += 2 * 86400_000;
    const other = { ...product, id: 'other_product' };
    await client.load(other, true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.snapshot(other).error).toContain('+275760-09-13');
  });

  it('enforces the body cap before parsing an oversized response', async () => {
    const fetcher = vi.fn(async () => new Response(terra, { headers: { 'content-length': String(IMAGERY_DATES_MAX_BYTES + 1) } }));
    const client = new ImageryDatesClient(fetcher as typeof fetch, () => NOW);
    await client.load(product);
    expect(client.snapshot(product)).toMatchObject({ state: 'error', data: null, error: 'Response too large' });
  });

  it('times out a stalled response body and clears the timeout when finished', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<Domains>')); } })));
    const client = new ImageryDatesClient(fetcher as typeof fetch);
    const request = client.load(product);
    await vi.advanceTimersByTimeAsync(IMAGERY_DATES_TIMEOUT_MS + 1);
    await request;
    expect(client.snapshot(product)).toMatchObject({ state: 'error', data: null, error: 'GIBS date availability timed out' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the session cache even after many selections', async () => {
    const client = new ImageryDatesClient((async () => new Response(terra)) as typeof fetch, () => NOW);
    const products = Array.from({ length: 40 }, (_, i) => ({ ...product, id: `product_${i}` }));
    for (const p of products) await client.load(p);
    expect(products.filter((p) => client.snapshot(p).data !== null)).toHaveLength(32);
    expect(client.snapshot(products[0]).state).toBe('idle');
  });
});
