import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import type { ViewState } from '../src/shared/layers';
import { FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { FETCHERS, aircraftCoveredBy, aircraftQueryPlan, aircraftViewRadiusNm, type FetchContext } from '../src/main/layers/fetchers';
import { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { fixture, tempDbPath } from './helpers';

const BASE = Date.parse('2026-11-18T18:00:00Z');
let n = 0;
const stores: AtlasStore[] = [];
const managers: LayerManager[] = [];
const view = (lat: number, lon: number, heightM: number, half: number): ViewState => ({ lat, lon, heightM, bbox: [lon - half, lat - half, lon + half, lat + half] });

function adsb(hex: string, lat = 40, lon = -105) {
  const source = fixture<{ now: number; ac: Record<string, unknown>[] }>('layers/adsb.json');
  return { now: Date.now(), ac: [{ ...source.ac[0], hex, lat, lon, seen_pos: 0 }] };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(BASE + ++n * 3_600_000); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { for (const lm of managers.splice(0)) lm.stop(); for (const s of stores.splice(0)) s.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('aircraft query area while zooming', () => {
  it('covers a tilted view out to its visible edge, not just the camera height', () => {
    // 20 km up but looking 150 km out: the height rule alone asked for 25 nm and dropped the aircraft further out.
    expect(aircraftViewRadiusNm(view(51.47, -0.45, 20_000, 0.1))).toBe(25);
    expect(aircraftViewRadiusNm({ lat: 51.47, lon: -0.45, heightM: 20_000, bbox: [-2.5, 50.6, 1.6, 52.8] })).toBeGreaterThan(80);
    expect(aircraftViewRadiusNm(view(51.47, -0.45, 2_000_000, 30))).toBe(250);
    expect(aircraftQueryPlan(view(51.47, -0.45, 20_000, 0.1)).centers).toHaveLength(1);
  });

  it('treats a zoom into the loaded circle as covered, and a pan out of it as not', () => {
    const loaded = { lat: 40, lon: -105, radiusNm: 120 };
    expect(aircraftCoveredBy(loaded, { lat: 40.1, lon: -105, radiusNm: 30 })).toBe(true);
    expect(aircraftCoveredBy(loaded, { lat: 42, lon: -105, radiusNm: 30 })).toBe(false);
    expect(aircraftCoveredBy(loaded, { lat: 40, lon: -105, radiusNm: 200 })).toBe(false);
  });

  it('does not ask adsb.lol again when the user zooms into the area it just loaded', async () => {
    const calls: string[] = [];
    const fetchJson: FetchJson = async (url) => { calls.push(url); return { status: 200, body: adsb('abc001') }; };
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    const settings: Settings = { ...DEFAULT_SETTINGS, worldAircraft: false, layersEnabled: ['aircraft'] };
    const lm = new LayerManager({ store, fetchJson, fetchText: async () => ({ status: 200, text: '' }), getSettings: () => settings, userAgent: () => 'test', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: () => {} });
    managers.push(lm);
    lm.setView(view(40, -105, 250_000, 1.5));
    lm.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(1);
    // Four zoom steps within one 20 s poll interval: each would have been a new request before.
    for (const h of [120_000, 60_000, 25_000, 10_000]) { lm.setView(view(40.02, -105.01, h, h / 200_000)); await vi.advanceTimersByTimeAsync(3_500); }
    expect(calls).toHaveLength(1);
    lm.setView(view(44, -100, 250_000, 1.5));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(2);
  });
});

describe('aircraft while adsb.lol asks the app to wait', () => {
  function worldwide(lat: number, lon: number) {
    const body = fixture<{ time: number; states: unknown[][] }>('layers/opensky.json');
    body.time = Math.floor(Date.now() / 1000);
    body.states = [[...body.states[0]]];
    body.states[0][3] = body.time; body.states[0][4] = body.time; body.states[0][5] = lon; body.states[0][6] = lat;
    return body;
  }
  const ctx = (fetchJson: FetchJson, v: ViewState, worldAircraft: boolean): FetchContext => ({ view: v, settings: { ...DEFAULT_SETTINGS, worldAircraft }, fetchJson,
    fetchText: async () => ({ status: 200, text: '' }), userAgent: 'test', store: null as never, localReceiverUrl: null, now: new Date(Date.now()), clock: () => Date.now(), sources: { backoff: new Map(), cache: new Map() } });

  it('keeps showing the worldwide snapshot already held instead of an empty sky, labelled as such', async () => {
    const fetchJson: FetchJson = async (url) => {
      if (url.includes('opensky')) return { status: 200, body: worldwide(40.2, -105.1) };
      throw new FeedHttpError('HTTP 429', 429, 60, 'http');
    };
    const world = await FETCHERS.aircraft(ctx(fetchJson, view(40, -105, 12_000_000, 80), true));
    expect(world.records.length).toBeGreaterThan(0);
    const close = await FETCHERS.aircraft(ctx(fetchJson, view(40, -105, 200_000, 1), true));
    expect(close.incomplete?.error).toContain('429');
    expect(close.records.map((r) => r.id)).toEqual(world.records.map((r) => r.id));
    expect(close.records[0].props.snapshot).toBe(true);
    expect(close.note).toMatch(/OpenSky worldwide snapshot/);
    // Without the worldwide setting nothing is substituted.
    const off = await FETCHERS.aircraft(ctx(fetchJson, view(40, -105, 200_000, 1), false));
    expect(off.records).toEqual([]);
  });
});
