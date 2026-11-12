import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import type { LayerId, ViewState } from '../src/shared/layers';
import { FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { MAX_DATE_MS, MAX_TIMEOUT_MS } from '../src/main/feeds/timing';
import { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { fixture, tempDbPath } from './helpers';

const NOW = Date.parse('2026-11-11T18:00:00Z');
const DAY = 86_400_000;
const WAIT = 35 * DAY;
const VIEW: ViewState = { lat: 40, lon: -105, heightM: 100_000, bbox: [-106, 39, -104, 41] };
const managers: LayerManager[] = [];
const stores: AtlasStore[] = [];

function harness(layer: LayerId, fetchJson: FetchJson) {
  const settings: Settings = { ...DEFAULT_SETTINGS, worldAircraft: false, layersEnabled: [layer] };
  const store = new AtlasStore(tempDbPath()); stores.push(store);
  const manager = new LayerManager({ store, fetchJson, fetchText: async () => ({ status: 200, text: '' }), getSettings: () => settings,
    userAgent: () => 'test fixture', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: () => {} });
  managers.push(manager);
  manager.setView(VIEW);
  return { manager, settings };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { for (const manager of managers.splice(0)) manager.stop(); for (const store of stores.splice(0)) store.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('layer deadlines beyond the Node timeout range', () => {
  it.each([429, 503, 307])('keeps a real 35-day Retry-After from HTTP %s visible and sends no early requests across timer hops, pans, manual refreshes or toggles', async (status) => {
    let recover = false;
    const fetchJson = vi.fn<FetchJson>(async () => {
      if (!recover) throw new FeedHttpError(`HTTP ${status}`, status, WAIT / 1000, 'http');
      return { status: 200, body: [] }; // Valid empty METAR response.
    });
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { manager, settings } = harness('metar', fetchJson);
    manager.start(); await vi.advanceTimersByTimeAsync(0);
    const deadline = NOW + WAIT;
    expect(manager.snapshot('metar').status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    expect(timers.mock.calls.every((call) => Number(call[1]) <= MAX_TIMEOUT_MS)).toBe(true);
    expect(timers.mock.calls.some((call) => call[1] === MAX_TIMEOUT_MS)).toBe(true);
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 2000);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(manager.snapshot('metar').status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    await manager.refresh('metar');
    manager.setView({ ...VIEW, lon: 20 }); await vi.advanceTimersByTimeAsync(1201);
    settings.layersEnabled = []; manager.syncEnabled(); settings.layersEnabled = ['metar']; manager.syncEnabled();
    expect(manager.snapshot('metar').status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    recover = true; await vi.advanceTimersByTimeAsync(1);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(manager.snapshot('metar').status.state).toBe('ok');
  });

  it('also chunks structured aircraft host cooldowns and automatically releases the shared military layer at the actual deadline', async () => {
    let recover = false;
    const fixtureBody = fixture<{ now: number; ac: Record<string, unknown>[] }>('layers/adsb.json');
    const calls: string[] = [];
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { manager, settings } = harness('aircraft', async (url) => {
      calls.push(url);
      if (!recover) throw new FeedHttpError('HTTP 503', 503, WAIT / 1000, 'http');
      return { status: 200, body: { now: Date.now(), ac: [{ ...fixtureBody.ac[0], seen_pos: 0 }] } };
    });
    manager.start(); await vi.advanceTimersByTimeAsync(0);
    settings.layersEnabled = ['aircraft', 'aircraftMil']; manager.syncEnabled();
    const deadline = NOW + WAIT;
    await manager.refresh('aircraft'); await manager.refresh('aircraftMil');
    expect(manager.snapshot('aircraft').status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    expect(manager.snapshot('aircraftMil').status.nextAttemptAt).toBe(new Date(deadline).toISOString());
    expect(timers.mock.calls.every((call) => Number(call[1]) <= MAX_TIMEOUT_MS)).toBe(true);
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 2000);
    expect(calls).toHaveLength(1);
    manager.setView({ ...VIEW, lon: 170 }); await vi.advanceTimersByTimeAsync(1201);
    await manager.refresh('aircraft'); await manager.refresh('aircraftMil');
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(calls).toHaveLength(1);
    recover = true; await vi.advanceTimersByTimeAsync(1);
    expect(calls.filter((url) => url.endsWith('/mil'))).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(manager.snapshot('aircraft').status.state).toBe('ok');
    expect(manager.snapshot('aircraftMil').status.state).toBe('ok');
  });

  it('caps only the representable Date boundary while still passing bounded delays to Node', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const { manager } = harness('metar', async () => { throw new FeedHttpError('HTTP 429', 429, MAX_DATE_MS / 1000, 'http'); });
    manager.start(); await vi.advanceTimersByTimeAsync(0);
    expect(manager.snapshot('metar').status.nextAttemptAt).toBe(new Date(MAX_DATE_MS).toISOString());
    expect(timers.mock.calls.every((call) => Number(call[1]) <= MAX_TIMEOUT_MS)).toBe(true);
    expect(timers.mock.calls.some((call) => call[1] === MAX_TIMEOUT_MS)).toBe(true);
  });
});
