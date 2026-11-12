import { describe, expect, it, vi } from 'vitest';
import { geocodingMatches } from '../src/main/geocoding';
import { createHandlers, dispatch, type PlatformServices } from '../src/main/handlers';
import { CredentialService } from '../src/main/credentials';
import type { SecretStore } from '../src/main/secrets';
import type { ProviderService } from '../src/main/providerService';
import type { AppCore } from '../src/main/core';
import type { AtlasStore } from '../src/main/store';
import type { FetchJson } from '../src/main/feeds/http';
import { DEFAULT_SETTINGS, IPC, IpcValidationError } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';

const providers = ['Google', 'Census'] as const;
type Provider = typeof providers[number];
const row = (provider: Provider, ...values: unknown[]) => {
  const lat = values.length > 0 ? values[0] : 0, lon = values.length > 1 ? values[1] : 0, label = values.length > 2 ? values[2] : 'Test address';
  return provider === 'Google' ? { formatted_address: label, geometry: { location: { lat, lng: lon } } }
    : { matchedAddress: label, coordinates: { y: lat, x: lon } };
};
const reply = (provider: Provider, rows: unknown) => provider === 'Google' ? { status: 'OK', results: rows } : { result: { addressMatches: rows } };

describe('provider geocoding response evidence', () => {
  it.each(providers)('%s preserves actual zero ordinates and WGS84 range boundaries', provider => {
    expect(geocodingMatches(provider, reply(provider, [row(provider, 0, 0), row(provider, 90, 180), row(provider, -90, -180)]))).toEqual([
      { label: 'Test address', lat: 0, lon: 0 }, { label: 'Test address', lat: 90, lon: 180 }, { label: 'Test address', lat: -90, lon: -180 },
    ]);
  });
  it.each(providers)('%s never coerces null, boolean, blank/string or nonfinite ordinates into a map position', provider => {
    for (const value of [null, undefined, true, false, '', ' ', '0', '12.5', NaN, Infinity, -Infinity, {}, [], new Number(0)]) {
      expect(() => geocodingMatches(provider, reply(provider, [row(provider, value, 0)]))).toThrow(/without a usable address and map position/);
      expect(() => geocodingMatches(provider, reply(provider, [row(provider, 0, value)]))).toThrow(/without a usable address and map position/);
    }
  });
  it.each(providers)('%s rejects out-of-range coordinates rather than clamping or wrapping', provider => {
    for (const [lat, lon] of [[90.001, 0], [-90.001, 0], [0, 180.001], [0, -180.001]])
      expect(() => geocodingMatches(provider, reply(provider, [row(provider, lat, lon)]))).toThrow(/without a usable address and map position/);
  });
  it.each(providers)('%s distinguishes a real empty list from a missing or malformed result list', provider => {
    expect(geocodingMatches(provider, reply(provider, []))).toEqual([]);
    for (const value of [undefined, null, {}, '', false])
      expect(() => geocodingMatches(provider, reply(provider, value))).toThrow(/incomplete geocoding response/);
    for (const value of [null, undefined, {}, [], true]) expect(() => geocodingMatches(provider, value)).toThrow();
    for (const value of [null, {}, false, [], row(provider, 0, 0, ''), row(provider, 0, 0, '  '), row(provider, 0, 0, null)])
      expect(() => geocodingMatches(provider, reply(provider, [value]))).toThrow(/without a usable address and map position/);
  });
  it.each(providers)('%s keeps valid positive evidence among malformed rows and bounds returned matches', provider => {
    const rows = [null, row(provider, null, null), ...Array.from({ length: 8 }, (_, i) => row(provider, i, -i, 'Address ' + i))];
    const result = geocodingMatches(provider, reply(provider, rows));
    expect(result).toHaveLength(5); expect(result[0]).toEqual({ label: 'Address 0', lat: 0, lon: -0 });
    expect(result.map(r => r.label)).toEqual(['Address 0', 'Address 1', 'Address 2', 'Address 3', 'Address 4']);
  });
  it('accepts the explicit Google ZERO_RESULTS status as empty evidence', () => {
    expect(geocodingMatches('Google', { status: 'ZERO_RESULTS', results: [] })).toEqual([]);
    expect(geocodingMatches('Google', { status: 'ZERO_RESULTS' })).toEqual([]);
  });
  it.each([
    ['REQUEST_DENIED', /refused.*permissions/], ['OVER_QUERY_LIMIT', /usage limit.*quota/], ['OVER_DAILY_LIMIT', /usage limit.*quota/],
  ] as const)('reports Google %s instead of silently returning zero results or echoing publisher secrets', (status, message) => {
    let error: unknown;
    try { geocodingMatches('Google', { status, results: [], error_message: 'PRIVATE_PROVIDER_ERROR_fixture-key' }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toMatch(message);
    expect((error as Error).message).not.toContain('PRIVATE_PROVIDER_ERROR'); expect((error as Error).message).not.toContain('fixture-key');
  });
  it.each(['UNKNOWN_ERROR', 'INVALID_REQUEST', '', undefined, null, false])('rejects unsupported Google status %s even if result coordinates look valid', status => {
    expect(() => geocodingMatches('Google', { status, results: [row('Google')] })).toThrow(/could not complete/);
  });
});

function harness(basemap: Settings['basemap'], customerKey: string | null = null, savedKeyPresent = customerKey !== null) {
  const core = { settings: { ...DEFAULT_SETTINGS, basemap } } as AppCore;
  const fetch = vi.fn<FetchJson>();
  const metadata = new Map<string, string>();
  const store = { getMeta: (key: string) => metadata.get(key) ?? null, setMeta: (key: string, value: string) => metadata.set(key, value) } as unknown as AtlasStore;
  const secrets = { has: vi.fn(() => savedKeyPresent), get: vi.fn(() => customerKey) } as unknown as SecretStore;
  // Explicit fictitious included key proves that a fallback is available but cannot be used by these IPC handlers.
  const credentials = new CredentialService(secrets, store, { google3d: 'INCLUDED_ONLY_DO_NOT_USE_FIXTURE' });
  const userKey = vi.spyOn(credentials, 'userKey'), resolvedCredential = vi.spyOn(credentials, 'credentialFor');
  const platform: PlatformServices = { appVersion: 'fixture', saveTextFile: vi.fn(async () => null), openTextFile: vi.fn(async () => null),
    savePdfFromHtml: vi.fn(async () => null), openExternal: vi.fn(() => false), getNetStats: vi.fn(() => []), setKiosk: vi.fn(() => true), captureScreenshot: vi.fn(async () => null) };
  const handlers = createHandlers(core, store, fetch, platform, { layers: null, providers: { credentials } as ProviderService });
  return { core, fetch, handlers, userKey, resolvedCredential, secrets, credentials };
}

describe('actual geocoding IPC destination and customer-key policy', () => {
  it.each(['google2d', 'google3d'] as const)('blocks Census on %s before credentials or network access', async basemap => {
    const h = harness(basemap, 'CUSTOMER_ONLY_FIXTURE');
    await expect(dispatch(h.handlers, IPC.geocodeAddress, ['1600 Synthetic Street'])).rejects.toThrow(/non-Google basemap/);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.userKey).not.toHaveBeenCalled(); expect(h.resolvedCredential).not.toHaveBeenCalled();
  });
  it.each(['neutral', 'atlas', 'streets', 'esri', 'mapbox', 'eox', 'naturalEarth', 'gibsDaily', 'usgsTopo', 'usgsImageryTopo'] as const)('blocks Google on %s before consulting any key or network', async basemap => {
    const h = harness(basemap, 'CUSTOMER_ONLY_FIXTURE');
    await expect(dispatch(h.handlers, IPC.geocodeGoogle, ['Paris'])).rejects.toThrow(/Select Google imagery/);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.userKey).not.toHaveBeenCalled(); expect(h.resolvedCredential).not.toHaveBeenCalled();
  });
  it.each(['google2d', 'google3d'] as const)('never falls back to an included key on %s when no customer key exists or saved decryption yielded null', async basemap => {
    for (const hasSaved of [false, true]) {
      const h = harness(basemap, null, hasSaved);
      await expect(dispatch(h.handlers, IPC.geocodeGoogle, ['Tokyo'])).rejects.toThrow(/Add your Google Maps API key/);
      expect(h.userKey).toHaveBeenCalledWith('google3d'); expect(h.resolvedCredential).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    }
  });
  it.each(['google2d', 'google3d'] as const)('uses only the customer key and finite validated Google reply on %s', async basemap => {
    const customerKey = 'CUSTOMER_FIXTURE:+/?&=', h = harness(basemap, customerKey);
    h.fetch.mockResolvedValue({ status: 200, body: reply('Google', [row('Google', 0, 0, 'Zero coordinate address')]) });
    const matches = await dispatch(h.handlers, IPC.geocodeGoogle, ['  São Paulo & rua/1  ']);
    expect(matches).toEqual([{ label: 'Zero coordinate address', lat: 0, lon: 0 }]);
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.userKey).toHaveBeenCalledWith('google3d'); expect(h.resolvedCredential).not.toHaveBeenCalled();
    const [rawUrl, options] = h.fetch.mock.calls[0], url = new URL(rawUrl);
    expect(url.origin).toBe('https://maps.googleapis.com'); expect(url.pathname).toBe('/maps/api/geocode/json');
    expect(url.searchParams.get('address')).toBe('São Paulo & rua/1'); expect(url.searchParams.get('key')).toBe(customerKey);
    expect(rawUrl).not.toContain('INCLUDED_ONLY'); expect(options).toMatchObject({ timeoutMs: 15000 });
    expect(JSON.stringify(matches)).not.toContain(customerKey);
  });
  it('uses the keyless fixed Census endpoint only in non-Google mode and returns valid zero coordinates', async () => {
    const h = harness('neutral'); h.fetch.mockResolvedValue({ status: 200, body: reply('Census', [row('Census')]) });
    expect(await dispatch(h.handlers, IPC.geocodeAddress, ['  1600 Test St & Unit #5  '])).toEqual([{ label: 'Test address', lat: 0, lon: 0 }]);
    const [rawUrl, options] = h.fetch.mock.calls[0], url = new URL(rawUrl);
    expect(url.origin).toBe('https://geocoding.geo.census.gov'); expect(url.pathname).toBe('/geocoder/locations/onelineaddress');
    expect(url.searchParams.get('address')).toBe('1600 Test St & Unit #5'); expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
    expect(url.searchParams.get('format')).toBe('json'); expect(url.searchParams.has('key')).toBe(false); expect(options).toMatchObject({ timeoutMs: 15000 });
    expect(h.userKey).not.toHaveBeenCalled(); expect(h.resolvedCredential).not.toHaveBeenCalled();
  });
  it('checks the current basemap at invocation rather than the mode that created the handlers', async () => {
    const h = harness('neutral', 'CUSTOMER_ONLY_FIXTURE'); h.core.settings.basemap = 'google3d';
    await expect(dispatch(h.handlers, IPC.geocodeAddress, ['1600 Synthetic Street'])).rejects.toThrow(/non-Google/);
    h.core.settings.basemap = 'neutral';
    await expect(dispatch(h.handlers, IPC.geocodeGoogle, ['Tokyo'])).rejects.toThrow(/Google imagery/);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.userKey).not.toHaveBeenCalled();
  });
  it.each([IPC.geocodeAddress, IPC.geocodeGoogle] as const)('%s rejects malformed renderer arguments before network/key access', async channel => {
    const h = harness(channel === IPC.geocodeGoogle ? 'google2d' : 'neutral', 'CUSTOMER_ONLY_FIXTURE');
    for (const args of [[], [null], [{}], [''], ['x'], ['a'.repeat(201)], ['valid query', 'extra']])
      await expect(dispatch(h.handlers, channel, args)).rejects.toBeInstanceOf(IpcValidationError);
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.userKey).not.toHaveBeenCalled(); expect(h.resolvedCredential).not.toHaveBeenCalled();
  });
  it.each([
    ['Census', 'neutral', IPC.geocodeAddress], ['Google', 'google3d', IPC.geocodeGoogle],
  ] as const)('%s IPC reports a malformed position rather than a successful empty search', async (provider, basemap, channel) => {
    const h = harness(basemap, 'CUSTOMER_ONLY_FIXTURE'); h.fetch.mockResolvedValue({ status: 200, body: reply(provider, [row(provider, null, 0)]) });
    await expect(dispatch(h.handlers, channel, ['Synthetic address'])).rejects.toThrow(/without a usable address and map position/);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
