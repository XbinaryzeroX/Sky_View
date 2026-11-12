import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageryHealth, observeImageryRequests } from '../src/renderer/lib/imageryHealth';
afterEach(() => { imageryHealth.selection(null, []); vi.useRealTimers(); });

describe('actual imagery raster request health', () => {
  it('keeps view-change cancellations separate from publisher failures', async () => {
    vi.useFakeTimers();
    const health = imageryHealth.selection('test-product', ['2026-11-11']);
    const run = observeImageryRequests((_request: { cancelled: boolean }) => Promise.reject(undefined), health.observer('2026-11-11'), (args) => args[0].cancelled);
    await expect(run({ cancelled: true })).rejects.toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(imageryHealth.snapshot().dates[0]).toMatchObject({ requested: 1, cancelled: 1, failed: 0 });
  });
  it('does not count scheduler-deferred requests as failures and preserves successful image payloads', async () => {
    vi.useFakeTimers();
    const health = imageryHealth.selection('test-product', ['2026-11-11']);
    expect(observeImageryRequests(() => undefined, health.observer('2026-11-11'))()).toBeUndefined();
    const pixels = { width: 256, height: 256 };
    expect(await observeImageryRequests(() => Promise.resolve(pixels), health.observer('2026-11-11'))()).toBe(pixels);
    vi.advanceTimersByTime(500);
    expect(imageryHealth.snapshot().dates[0]).toMatchObject({ requested: 1, loaded: 1, failed: 0 });
  });

  it('shows source-advertised dates whose raster service rejects requests, without hiding the error', async () => {
    vi.useFakeTimers();
    const health = imageryHealth.selection('test-product', ['2022-12-01']);
    const error = { statusCode: 404 };
    await expect(observeImageryRequests(() => Promise.reject(error), health.observer('2022-12-01'))()).rejects.toBe(error);
    vi.advanceTimersByTime(500);
    expect(imageryHealth.snapshot().dates[0]).toMatchObject({ requested: 1, loaded: 0, failed: 1, lastError: 'HTTP 404' });
  });

  it('keeps comparison-date counters separate and ignores results from a closed or changed selection', async () => {
    vi.useFakeTimers();
    const first = imageryHealth.selection('old-product', ['2026-02-01', '2026-08-01']);
    const one = first.observer('2026-02-01'); one.started(); one.loaded();
    const two = first.observer('2026-08-01'); two.started(); two.failed({ statusCode: 503 });
    vi.advanceTimersByTime(500);
    expect(imageryHealth.snapshot().dates.map((row) => [row.loaded, row.failed])).toEqual([[1, 0], [0, 1]]);
    const current = imageryHealth.selection('new-product', ['2026-11-11']);
    one.failed({ statusCode: 404 });
    vi.advanceTimersByTime(1000);
    expect(imageryHealth.snapshot()).toEqual({ product: 'new-product', dates: [{ date: '2026-11-11', requested: 0, loaded: 0, failed: 0, cancelled: 0, lastError: null }] });
    current.dispose();
    current.observer('2026-11-11').started();
    expect(vi.getTimerCount()).toBe(0);
  });
});
