import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppCore } from '../src/main/core';
import { FeedHttpError } from '../src/main/feeds/http';
import { MAX_DATE_MS, MAX_TIMEOUT_MS } from '../src/main/feeds/timing';
import { AtlasStore } from '../src/main/store';
import { fixture, tempDbPath } from './helpers';

const sample = fixture<{ receivedAt: string; longSeconds: number }>('retry-after.json');
const cores: AppCore[] = [];
afterEach(() => { for (const core of cores.splice(0)) core.stop(); vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(delaySec: number, status = 429) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(sample.receivedAt));
  const fetchActiveAlerts = vi.fn().mockRejectedValueOnce(new FeedHttpError('Publisher pause', status, delaySec, 'http'))
    .mockResolvedValue({ alerts: [], skipped: 0, sourceUpdatedAt: null });
  const core = new AppCore({ store: new AtlasStore(tempDbPath()),
    alertSource: { name: 'fixture', fetchActiveAlerts, fetchPointZones: vi.fn() },
    quakeSource: { name: 'fixture', fetchRecent: vi.fn().mockResolvedValue({ quakes: [], skipped: 0, sourceUpdatedAt: null, feedKey: 'all_day' }) },
    zoneLookupGapMs: 0 });
  cores.push(core);
  core.init();
  return { core, fetchActiveAlerts };
}

describe('core long publisher deadlines', () => {
  it('hops safely through the timeout limit and resumes once at the true deadline', async () => {
    const { core, fetchActiveAlerts } = setup(sample.longSeconds);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    core.start();
    await vi.advanceTimersByTimeAsync(0);
    const deadline = Date.now() + sample.longSeconds * 1000;
    expect(core.feeds.nws.nextAttemptAt).toBe(new Date(deadline).toISOString());
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(1);
    expect(core.feeds.nws.nextAttemptAt).toBe(new Date(deadline).toISOString());
    core.updateSettings({ nwsPollSeconds: 60 });
    await core.refresh('nws');
    core.stop();
    core.start();
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(2);
    expect(core.feeds.nws.state).toBe('ok');
    expect(timer.mock.calls.every(call => Number(call[1]) <= MAX_TIMEOUT_MS)).toBe(true);
  });

  it('keeps an explicit Retry-After on another HTTP status across manual refresh', async () => {
    const { core, fetchActiveAlerts } = setup(7200, 403);
    core.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3600_000);
    await core.refresh('nws');
    core.updateSettings({ nwsPollSeconds: 60 });
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(2);
  });

  it('serializes a huge wait without overflowing timers, and stop cancels the scheduled hop', async () => {
    const { core, fetchActiveAlerts } = setup(Number.MAX_VALUE);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    core.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(core.feeds.nws.nextAttemptAt).toBe(new Date(MAX_DATE_MS).toISOString());
    expect(timer.mock.calls.every(call => Number(call[1]) <= MAX_TIMEOUT_MS)).toBe(true);
    core.stop();
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS * 2);
    expect(fetchActiveAlerts).toHaveBeenCalledTimes(1);
  });
});
