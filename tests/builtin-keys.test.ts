import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseBuiltinKeys, loadBuiltinKeys, obfuscateBuiltinKeys } from '../scripts/builtin-keys.mjs';
import { CredentialService, decodeBuiltinKeys, BUILTIN_ALLOWANCES, type BuiltinKeys } from '../src/main/credentials';
import { SecretStore, redactSecrets } from '../src/main/secrets';
import { MarketService } from '../src/main/markets';
import type { AtlasStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { moveSummary, normalizeCandles, parseGdelt } from '../src/shared/markets';
import { redactCredentialText } from '../src/shared/sanitize';
import fixture from './fixtures/markets.json';

function setup(keys: BuiltinKeys = {}) {
  const data = new Map<string, string>();
  const store = {
    getMeta: (key: string) => data.get(key) ?? null,
    setMeta: (key: string, value: string) => { data.set(key, value); },
    deleteMeta: (key: string) => { data.delete(key); },
  };
  const secrets = new SecretStore(store as unknown as AtlasStore, {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value),
    decryptString: value => value.toString(),
  });
  return { store, secrets, credentials: new CredentialService(secrets, store, keys) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('built-in build inputs', () => {
  it('accepts known optional printable strings and ignores unknown fields', () => {
    expect(parseBuiltinKeys(JSON.stringify({ google3d: 'fixture-google', ignored: 42 }))).toEqual({ google3d: 'fixture-google' });
    expect(parseBuiltinKeys('{}')).toEqual({});
  });
  it.each([
    'null', '[]', 'broken', '{"google3d":123}', '{"twelvedata":"short"}',
    JSON.stringify({ alphavantage: 'x'.repeat(201) }), JSON.stringify({ google3d: 'line\nbreak' }),
    JSON.stringify({ google3d: 'non-ascii-☃' }),
  ])('rejects invalid input %s', value => expect(() => parseBuiltinKeys(value)).toThrow());
  it('accepts a missing file', async () => {
    await expect(loadBuiltinKeys(join(__dirname, 'fixtures', 'missing-builtin-input.json'))).resolves.toEqual({});
  });
  it('randomizes obfuscation and round-trips without plaintext', () => {
    const keys = { google3d: 'fixture-google', twelvedata: 'fixture-twelve' };
    const blob = obfuscateBuiltinKeys(keys);
    expect(blob).not.toContain(keys.google3d);
    expect(blob).not.toEqual(obfuscateBuiltinKeys(keys));
    expect(decodeBuiltinKeys(blob)).toEqual(keys);
  });
  it('injects only into main and has no blob identifier in renderer/shared/preload sources', () => {
    const script = readFileSync(join(__dirname, '..', 'scripts', 'build-main.mjs'), 'utf8');
    expect(script).toContain("define: builtinDefine, entryPoints: ['src/main/main.ts']");
    expect(script).not.toMatch(/define: builtinDefine, entryPoints: \['src\/preload/);
    const inspect = (path: string) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, entry.name);
        if (entry.isDirectory()) inspect(file);
        else if (/\.(ts|tsx)$/.test(file)) expect(readFileSync(file, 'utf8')).not.toContain('__ATLAS_BUILTIN_KEYS__');
      }
    };
    for (const tree of ['renderer', 'shared', 'preload']) inspect(join(__dirname, '..', 'src', tree));
  });
});

describe('credential resolution and allowances', () => {
  it('prefers the user and restores the included key after removal', () => {
    const { secrets, credentials } = setup({ twelvedata: 'fixture-included-twelve' });
    expect(credentials.credentialFor('twelvedata')?.source).toBe('builtin');
    secrets.set('twelvedata', 'fixture-user-twelve');
    expect(credentials.credentialFor('twelvedata')).toEqual({ value: 'fixture-user-twelve', source: 'user' });
    secrets.set('twelvedata', null);
    expect(credentials.credentialFor('twelvedata')?.source).toBe('builtin');
    expect(credentials.credentialFor('alphavantage')).toBeNull();
  });
  it('does not retry a rejected user key with the included key', async () => {
    const { secrets, credentials, store } = setup({ twelvedata: 'fixture-included-twelve' });
    secrets.set('twelvedata', 'fixture-user-twelve');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ status: 'error', message: 'Rejected user key' }));
    }));
    const markets = new MarketService(secrets, () => DEFAULT_SETTINGS, store, credentials);
    await expect(markets.quote('AAPL')).rejects.toThrow('Rejected user key');
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get('apikey')).toBe('fixture-user-twelve');
    expect(credentials.remaining('twelvedata')).toBe(200);
  });
  it.each(['google3d', 'twelvedata', 'alphavantage'] as const)('persists and resets the %s allowance', id => {
    const keys = { [id]: 'fixture-included-key' };
    const { credentials, secrets, store } = setup(keys);
    for (let index = 0; index < BUILTIN_ALLOWANCES[id]; index++) credentials.reserveBuiltin(id);
    expect(credentials.remaining(id)).toBe(0);
    const restarted = new CredentialService(secrets, store, keys);
    expect(() => restarted.reserveBuiltin(id)).toThrow(/Today's built-in allowance.*Add your own key/);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 86400000));
    expect(restarted.remaining(id)).toBe(BUILTIN_ALLOWANCES[id]);
  });
  it('treats an undecryptable saved key as unavailable without throwing or falling back', () => {
    const { store, credentials } = setup({ google3d: 'fixture-included-google' });
    store.setMeta('secret:google3d', 'not-decryptable');
    const broken = new CredentialService(new SecretStore(store as unknown as AtlasStore, {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value),
      decryptString: () => { throw new Error('wrong user'); },
    }), store, { google3d: 'fixture-included-google' });
    expect(() => broken.credentialFor('google3d')).toThrow(/could not be decrypted/);
    expect(broken.available('google3d')).toBe(false);
    expect(credentials.available('alphavantage')).toBe(false);
  });
  it('limits the included Google key to Photoreal 3D (not Satellite 2D or geocoding)', () => {
    const { credentials, secrets } = setup({ google3d: 'fixture-included-google' });
    expect(credentials.browserKey('google2d')).toBeNull();
    expect(credentials.userKey('google3d')).toBeNull();
    expect(credentials.remaining('google3d')).toBe(30);
    expect(credentials.browserKey('google3d')).toBe('fixture-included-google');
    secrets.set('google3d', 'fixture-user-google');
    expect(credentials.browserKey('google2d')).toBe('fixture-user-google');
    expect(credentials.userKey('google3d')).toBe('fixture-user-google');
  });
  it('counts Google browser-key requests, excludes other built-ins, and allows a user key after exhaustion', () => {
    const { credentials, secrets } = setup({ google3d: 'fixture-included-google', twelvedata: 'fixture-included-twelve' });
    for (let index = 0; index < 30; index++) expect(credentials.browserKey('google3d')).toBe('fixture-included-google');
    expect(() => credentials.browserKey('google3d')).toThrow(/allowance/);
    expect(credentials.browserKey('twelvedata' as 'google3d')).toBeNull();
    secrets.set('google3d', 'fixture-user-google');
    expect(credentials.browserKey('google3d')).toBe('fixture-user-google');
    expect(credentials.remaining('google3d')).toBe(0);
  });
  it('counts uncached market attempts and stops before the built-in daily cap', async () => {
    const { secrets, credentials, store } = setup({ alphavantage: 'fixture-included-alpha' });
    const fetch = vi.fn(async () => new Response(JSON.stringify(fixture.alphaQuote)));
    vi.stubGlobal('fetch', fetch);
    const markets = new MarketService(secrets, () => ({ ...DEFAULT_SETTINGS, marketProvider: 'alphavantage' }), store, credentials);
    await markets.quote('IBM');
    await markets.quote('IBM');
    expect(credentials.remaining('alphavantage')).toBe(9);
    for (let index = 0; index < 9; index++) credentials.reserveBuiltin('alphavantage');
    await expect(markets.quote('OTHER')).rejects.toThrow(/Today's built-in allowance/);
    expect(fetch).toHaveBeenCalledTimes(1);
    secrets.set('alphavantage', 'fixture-user-alpha');
    await markets.quote('OTHER');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('redacts included credentials in plain text, URLs and encoded form', () => {
    setup({ google3d: 'fixture-google+redaction' });
    expect(redactSecrets('failure fixture-google+redaction', [])).toBe('failure [redacted]');
    expect(redactSecrets('failure fixture-google%2Bredaction', [])).toBe('failure [redacted]');
    expect(redactCredentialText('https://tile.test/?key=fixture-google')).toContain('key=[redacted]');
  });
});

describe('market data regression fixes', () => {
  it('labels movement derived from weekly history without claiming daily session precision', () => {
    const summary = moveSummary(normalizeCandles(fixture.alphaCandles, 'alphavantage'), 'week');
    expect(summary).toContain('Last available weekly bar');
    expect(summary).toContain('cannot resolve individual session moves');
    expect(summary).not.toContain('Largest single-session move');
  });
  it('keeps the latest intraday session on a weekend', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T15:00:00Z'));
    const { secrets, credentials, store } = setup();
    secrets.set('twelvedata', 'fixture-user-twelve');
    const values = ['15:30:00', '15:35:00'].map(time => ({ datetime: '2026-11-06 ' + time, open: '100', high: '102', low: '99', close: '101' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ values }))));
    const markets = new MarketService(secrets, () => DEFAULT_SETTINGS, store, credentials);
    expect((await markets.candles('AAPL', '1D')).data).toHaveLength(2);
  });
  it.each(['1M', '6M', '1Y', '5Y'] as const)('uses free Alpha Vantage history for %s', async range => {
    const { secrets, credentials, store } = setup();
    secrets.set('alphavantage', 'fixture-user-alpha');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify(fixture.alphaCandles));
    }));
    const markets = new MarketService(secrets, () => ({ ...DEFAULT_SETTINGS, marketProvider: 'alphavantage' }), store, credentials);
    await markets.candles('IBM', range);
    const url = new URL(urls[0]);
    expect(url.searchParams.get('function')).toBe(range === '1M' ? 'TIME_SERIES_DAILY' : 'TIME_SERIES_WEEKLY');
    expect(url.searchParams.get('outputsize')).toBe(range === '1M' ? 'compact' : null);
  });
  it('skips malformed articles and rejects a malformed list', () => {
    const good = fixture.gdelt.articles[0];
    expect(parseGdelt(JSON.stringify({ articles: [{ ...good, url: 'invalid' }, { ...good, seendate: 'invalid' }, null, good] }))).toHaveLength(1);
    expect(() => parseGdelt('{"articles":{}}')).toThrow(/Invalid GDELT/);
  });
});
