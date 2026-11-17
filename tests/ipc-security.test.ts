import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppCore } from '../src/main/core';
import { assertAllowedUrl, computeBackoffMs, type FetchJson } from '../src/main/feeds/http';
import { buildUserAgent, formatPointCoord, usgsFeedKey } from '../src/main/feeds/sources';
import { createHandlers, dispatch, type PlatformServices } from '../src/main/handlers';
import { getAiStatus, ollamaEndpoint } from '../src/main/ollama';
import { AtlasStore } from '../src/main/store';
import { IPC, ipcArgSchemas, IpcValidationError, validateIpcArgs } from '../src/shared/ipc';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { tempDbPath } from './helpers';

const good = { name: 'A', category: '', notes: '', lat: 10, lon: 10, radiusKm: 10 };

describe('IPC argument validation', () => {
  it.each([
    [IPC.locationCreate, [{ ...good, lat: 91 }]],
    [IPC.locationCreate, [{ ...good, lat: 'NaN' }]],
    [IPC.locationCreate, [{ ...good, radiusKm: 0 }]],
    [IPC.locationCreate, [{ ...good, name: '' }]],
    [IPC.locationCreate, [{ ...good, name: 'x'.repeat(121) }]],
    [IPC.locationCreate, []],
    [IPC.locationUpdate, ['../../etc', good]],
    [IPC.locationDelete, [{ id: 'x' }]],
    [IPC.areaWatchPut, [{ areaId: 'a', minMagnitude: 3, enabled: true, armedAt: '2020-01-01T00:00:00.000Z' }]],
    [IPC.areaWatchDelete, ['../../other']],
    [IPC.areaWatchRead, [[]]],
    [IPC.areaWatchRead, [Array(501).fill('match')]],
    [IPC.locationImport, [[{ input: good, action: 'drop', targetId: null }]]],
    [IPC.feedsRefresh, ['https://evil.example']],
    [IPC.settingsUpdate, [{ nwsPollSeconds: 5 }]],
    [IPC.settingsUpdate, [{ ollamaPort: 70000 }]],
    [IPC.settingsUpdate, [{ nwsContact: 'a\r\nX-Injected: 1' }]],
    [IPC.settingsUpdate, [{ unknownKey: true }]],
    [IPC.historyQuery, [{ limit: 100000 }]],
    [IPC.historyQuery, [{ text: 'x', sql: 'DROP TABLE' }]],
    [IPC.timelineRange, ['usgs']],
    [IPC.timelineFrame, []],
    [IPC.timelineFrame, ['2026-11-11T00:00:00Z']],
    [IPC.timelineFrame, ['2026-11-11T00:00:00.000+01:00']],
    [IPC.timelineFrame, [{ t: '2026-11-11T00:00:00.000Z' }]],
    [IPC.briefingExport, [[], 'html']],
    [IPC.briefingExport, [['a'], 'docx']],
    [IPC.aiAsk, [{ question: '', locationIds: [] }]],
    [IPC.aiAsk, [{ question: 'q', locationIds: [], url: 'http://x' }]],
    [IPC.stateGet, ['extra']],
    [IPC.weatherWind, ['now']],
    [IPC.weatherWind, [{}]],
    [IPC.tracksFlightPath, ['ABC123']],
    [IPC.tracksFlightPath, ['abc12']],
    [IPC.tracksFlightPath, ['~abc123']],
    [IPC.tracksFlightPath, ['abc123', 'x']],
    [IPC.tracksFlightPath, ['https://evil.example/']],
    [IPC.launchesTimeline, ['db3500ac-965b-4ad8-b417-cb8d8d00558']],
    [IPC.voiceTranscribe, ['not bytes', 'audio/webm']],
    [IPC.radioSearch, [{ query: 'x', kind: 'all', country: null, near: null, url: 'https://evil.example/' }]],
    [IPC.radioSearch, [{ query: 'x'.repeat(81), kind: 'all', country: null, near: null }]],
    [IPC.radioSearch, [{ query: '', kind: 'everything', country: null, near: null }]],
    [IPC.radioSearch, [{ query: '', kind: 'all', country: 'usa', near: null }]],
    [IPC.radioSearch, [{ query: '', kind: 'all', country: null, near: { lat: 91, lon: 0 } }]],
    [IPC.voiceTranscribe, [new Uint8Array(0), 'audio/webm']],
    [IPC.voiceTranscribe, [new Uint8Array(1_000_001), 'audio/webm']],
    [IPC.voiceTranscribe, [new Uint8Array(500), 'video/webm']],
    [IPC.voiceTranscribe, [new Uint8Array(500), 'audio/webm', 'https://evil.example/']],
    [IPC.launchesTimeline, ['DB3500AC-965B-4AD8-B417-CB8D8D005586']],
    [IPC.launchesTimeline, ['../previous']],
    [IPC.launchesTimeline, ['db3500ac-965b-4ad8-b417-cb8d8d005586', 'detailed']],
    [IPC.launchesTimeline, [{ id: 'db3500ac-965b-4ad8-b417-cb8d8d005586' }]],
    [IPC.windowControl, ['quit']],
    [IPC.windowControl, [true]],
    [IPC.windowControl, ['close', 'now']],
    [IPC.plansList, ['extra']],
    [IPC.plansPut, [{ id: 'p1', name: 'x' }]],
    [IPC.plansPut, ['{"version":1}']],
    [IPC.plansDelete, ['../../other']],
    [IPC.planExport, [{ plan: {}, annotations: [], routes: [], coverageImage: null }, 'html']],
    [IPC.siteBuilding, [91, 0]],
    [IPC.siteBuilding, ['60.17', 24.94]],
    [IPC.siteBuilding, [60.17, 24.94, 'https://evil.example']],
    [IPC.siteFacilities, [60.17, 24.94, 50]],
    [IPC.siteFacilities, [60.17, 24.94, 5001]],
    [IPC.siteFacilities, [60.17, 181, 1000]],
  ])('%s rejects %j', (channel, args) => {
    expect(() => validateIpcArgs(channel as keyof typeof ipcArgSchemas, args as unknown[])).toThrow(IpcValidationError);
  });

  it('accepts valid arguments', () => {
    expect(validateIpcArgs(IPC.locationCreate, [good])).toEqual([good]);
    expect(validateIpcArgs(IPC.areaWatchRead, [['saved-match']])).toEqual([['saved-match']]);
    expect(validateIpcArgs(IPC.settingsUpdate, [{ quakeWindow: 'day' }])).toEqual([{ quakeWindow: 'day' }]);
  });

  it('dispatch rejects unknown channels and invalid payloads before touching state', async () => {
    const store = new AtlasStore(tempDbPath());
    const noFetch: FetchJson = async () => {
      throw new Error('network not allowed in test');
    };
    const core = new AppCore({ store, alertSource: { name: 'x', fetchActiveAlerts: async () => ({ alerts: [], skipped: 0, sourceUpdatedAt: null }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) }, quakeSource: { name: 'x', fetchRecent: async () => ({ quakes: [], skipped: 0, sourceUpdatedAt: null, feedKey: 'k' }) }, zoneLookupGapMs: 0 });
    core.init();
    const platform: PlatformServices = { saveTextFile: async () => null, savePdfFromHtml: async () => null, openExternal: (u) => isAllowedExternalUrl(u), getNetStats: () => [], openTextFile: async () => null, setKiosk: () => true, captureScreenshot: async () => null, appVersion: 't' };
    const h = createHandlers(core, store, noFetch, platform);
    const cursor = '2026-01-01T12:00:00.001Z';
    await expect(dispatch(h, IPC.timelineRange, [])).resolves.toMatchObject({ points: 0, nwsFrames: 0, usgsFrames: 0 });
    await expect(dispatch(h, IPC.timelineFrame, [cursor])).resolves.toMatchObject({
      t: cursor, points: [], nws: { state: 'unknown', records: [] }, usgs: { state: 'unknown', records: [] },
    });
    await expect(dispatch(h, 'shell:exec', ['calc'])).rejects.toThrow(/unknown channel/);
    await expect(dispatch(h, IPC.locationCreate, [{ ...good, lat: 500 }])).rejects.toThrow(IpcValidationError);
    expect(store.listLocations()).toHaveLength(0);
    await expect(dispatch(h, IPC.historyGet, ['locations:1'])).rejects.toThrow(/bad key/);
    expect(await dispatch(h, IPC.openExternal, ['file:///C:/Windows/System32/calc.exe'])).toBe(false);
    expect(await dispatch(h, IPC.openExternal, ['https://earthquake.usgs.gov/earthquakes/eventpage/x'])).toBe(true);
    const created = (await dispatch(h, IPC.locationCreate, [good])) as { id: string };
    expect(store.listLocations()).toHaveLength(1);
    await expect(dispatch(h, IPC.aiAsk, [{ question: 'q', locationIds: [] }])).rejects.toThrow(/turned off/);
    await dispatch(h, IPC.locationDelete, [created.id]);
    expect(store.listLocations()).toHaveLength(0);
  });

  it('preload channel names match the IPC contract', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'preload', 'preload.ts'), 'utf8');
    for (const [key, value] of Object.entries(IPC)) {
      expect(src).toContain(`${key}: '${value}'`);
    }
  });
});

describe('network restrictions', () => {
  it('only allows fixed feed hosts and the loopback address', () => {
    expect(() => assertAllowedUrl('https://api.weather.gov/alerts/active')).not.toThrow();
    expect(() => assertAllowedUrl('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')).not.toThrow();
    expect(() => assertAllowedUrl('http://127.0.0.1:11434/api/tags')).not.toThrow();
    expect(() => assertAllowedUrl('https://evil.example/')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('http://api.weather.gov/alerts')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://api.weather.gov:8443/alerts')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('http://localhost:11434/')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('http://192.168.1.10:11434/')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://api.weather.gov.evil.example/')).toThrow(/Blocked/);
    // OpenStreetMap Overpass (protective planning): the two listed public instances only, https, default port.
    expect(() => assertAllowedUrl('https://overpass-api.de/api/interpreter')).not.toThrow();
    expect(() => assertAllowedUrl('https://overpass.private.coffee/api/interpreter')).not.toThrow();
    expect(() => assertAllowedUrl('http://overpass-api.de/api/interpreter')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://overpass-api.de.evil.example/api/interpreter')).toThrow(/Blocked/);
  });

  it('Ollama endpoint is always loopback', async () => {
    expect(ollamaEndpoint(11434)).toBe('http://127.0.0.1:11434');
    expect(() => ollamaEndpoint(0)).toThrow();
    const seen: string[] = [];
    const fake: FetchJson = async (url) => {
      seen.push(url);
      return { status: 200, body: { models: [{ name: 'llama3.2:3b' }, { name: 42 }] } };
    };
    const s = await getAiStatus(fake, true, 11500);
    expect(seen).toEqual(['http://127.0.0.1:11500/api/tags']);
    expect(s.models).toEqual(['llama3.2:3b']);
    expect((await getAiStatus(fake, false, 11434)).reachable).toBe(false);
  });

  it('validates external links', () => {
    expect(isAllowedExternalUrl('https://www.weather.gov/x')).toBe(true);
    expect(isAllowedExternalUrl('https://api.weather.gov/alerts/urn:oid:1')).toBe(true);
    expect(isAllowedExternalUrl('http://www.weather.gov/x')).toBe(false);
    expect(isAllowedExternalUrl('https://weather.gov.evil.example/')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pw@usgs.gov/')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('feed request details', () => {
  it('builds an identifying User-Agent', () => {
    expect(buildUserAgent('0.1.0', '')).toBe('AtlasWatch/0.1.0 (desktop monitoring app)');
    expect(buildUserAgent('0.1.0', 'ops@example.com')).toBe('AtlasWatch/0.1.0 (ops@example.com)');
  });
  it('formats /points coordinates without trailing zeros', () => {
    expect(formatPointCoord(39.7)).toBe('39.7');
    expect(formatPointCoord(-104.990312)).toBe('-104.9903');
  });
  it('chooses the smallest USGS feed that covers the magnitude filter', () => {
    expect(usgsFeedKey({ window: 'week', minMagnitude: 2.5 })).toBe('2.5_week');
    expect(usgsFeedKey({ window: 'day', minMagnitude: 3 })).toBe('2.5_day');
    expect(usgsFeedKey({ window: 'hour', minMagnitude: 0.5 })).toBe('all_hour');
    expect(usgsFeedKey({ window: 'month', minMagnitude: 5 })).toBe('4.5_month');
  });
  it('backs off exponentially, caps, and honors Retry-After', () => {
    const mid = () => 0.5;
    expect(computeBackoffMs(1, null, mid)).toBe(30_000);
    expect(computeBackoffMs(3, null, mid)).toBe(120_000);
    expect(computeBackoffMs(20, null, mid)).toBe(30 * 60_000);
    expect(computeBackoffMs(1, 120, mid)).toBe(120_000);
    expect(computeBackoffMs(1, 0, mid)).toBe(5_000);
  });
});

describe('new provider keys', () => {
  it('accepts the four new provider ids and only the tile-service browser keys', () => {
    for (const id of ['tomtom', 'launchlibrary', 'openai', 'cesium-ion']) expect(() => validateIpcArgs(IPC.providersSetCredential, [id, 'k'])).not.toThrow();
    expect(() => validateIpcArgs(IPC.providersBrowserKey, ['tomtom'])).not.toThrow();
    expect(() => validateIpcArgs(IPC.providersBrowserKey, ['cesium-ion'])).not.toThrow();
    // Server-side keys never go to the map view.
    expect(() => validateIpcArgs(IPC.providersBrowserKey, ['openai'])).toThrow();
    expect(() => validateIpcArgs(IPC.providersBrowserKey, ['launchlibrary'])).toThrow();
  });
});
