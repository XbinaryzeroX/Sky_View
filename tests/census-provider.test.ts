import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '../src/main/providerService';
import { AtlasStore } from '../src/main/store';
import { SecretStore, type Cipher } from '../src/main/secrets';
import { FeedHttpError, type FetchJson, type FetchText } from '../src/main/feeds/http';

const stores: AtlasStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const match = (x: unknown = 0, y: unknown = 0, matchedAddress: unknown = 'SYNTHETIC TEST ADDRESS') => ({ matchedAddress, coordinates: { x, y } });
const body = (addressMatches: unknown) => ({ result: { addressMatches } });
function harness(reply: unknown) {
  const store = new AtlasStore(':memory:'); stores.push(store);
  const cipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('No fixture credentials'); }, decryptString: () => { throw new Error('No fixture credentials'); } };
  const fetchJson = vi.fn<FetchJson>().mockResolvedValue({ status: 200, body: reply }), fetchText = vi.fn<FetchText>();
  const provider = new ProviderService(store, new SecretStore(store, cipher), fetchJson, fetchText, () => 'AtlasWatch/Census-fixture', async () => { throw new Error('Unexpected socket'); });
  return { provider, fetchJson, fetchText };
}

describe('existing Census connection diagnostic', () => {
  it('validates an actual numeric zero position and keeps the existing keyless test request', async () => {
    const { provider, fetchJson, fetchText } = harness(body([match()]));
    const result = await provider.test('census-geocoder');
    expect(result).toEqual({ ok: true, message: 'Connected. Validated 1 usable test-address match(es) with WGS84 coordinates.' });
    expect(provider.list().find(p => p.id === 'census-geocoder')!.lastTest).toMatchObject(result);
    expect(fetchJson).toHaveBeenCalledTimes(1); const [raw, options] = fetchJson.mock.calls[0], url = new URL(raw);
    expect(url.origin).toBe('https://geocoding.geo.census.gov'); expect(url.pathname).toBe('/geocoder/locations/onelineaddress');
    expect(url.searchParams.get('address')).toBe('1600 Pennsylvania Ave NW Washington DC');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current'); expect(url.searchParams.get('format')).toBe('json'); expect(url.searchParams.has('key')).toBe(false);
    expect(options).toMatchObject({ timeoutMs: 15000, headers: { 'User-Agent': 'AtlasWatch/Census-fixture' } }); expect(fetchText).not.toHaveBeenCalled();
  });
  it('reports a legitimate empty service reply without claiming a successful navigation fix', async () => {
    const { provider } = harness(body([])); const result = await provider.test('census-geocoder');
    expect(result).toEqual({ ok: true, message: 'Connected. Census returned a valid empty address-match list; no navigation position was verified.' });
    expect(provider.list().find(p => p.id === 'census-geocoder')!.lastTest).toMatchObject(result);
  });
  it.each([
    null, undefined, {}, [], false, { result: null }, { result: {} }, body(null), body(false), body(''), body({ length: 0 }),
    { errors: ['Synthetic invalid benchmark error'] },
  ])('rejects malformed reply %j instead of presenting connected with zero matches', async reply => {
    const { provider } = harness(reply), result = await provider.test('census-geocoder');
    expect(result.ok).toBe(false); expect(result.message).toContain('incomplete geocoding response'); expect(result.message).toContain('Retry the Census connection test');
    expect(result.message).not.toContain('Connected'); expect(result.message).not.toContain('returned 0');
    expect(provider.list().find(p => p.id === 'census-geocoder')!.lastTest).toMatchObject(result);
  });
  it.each([
    match(null, 0), match(0, null), match(true, 0), match(0, false), match('', 0), match(0, '0'), match(NaN, 0), match(0, Infinity),
    match(181, 0), match(0, 91), match(0, 0, ''), {}, null,
  ])('rejects a nonempty unusable match %j instead of reporting a valid address fix', async invalid => {
    const { provider } = harness(body([invalid])), result = await provider.test('census-geocoder');
    expect(result.ok).toBe(false); expect(result.message).toContain('without a usable address and map position'); expect(result.message).toContain('Retry the Census connection test');
    expect(provider.list().find(p => p.id === 'census-geocoder')!.lastTest).toMatchObject(result);
  });
  it('uses the shared bounded validator for mixed valid and malformed rows', async () => {
    const { provider } = harness(body([null, match(null, null), ...Array.from({ length: 8 }, (_, i) => match(i, i))]));
    expect(await provider.test('census-geocoder')).toEqual({ ok: true, message: 'Connected. Validated 5 usable test-address match(es) with WGS84 coordinates.' });
  });
  it('replaces a previous successful diagnostic with the current failed response', async () => {
    const { provider, fetchJson } = harness(body([match()]));
    expect((await provider.test('census-geocoder')).ok).toBe(true);
    fetchJson.mockResolvedValueOnce({ status: 200, body: {} });
    const failed = await provider.test('census-geocoder'); expect(failed.ok).toBe(false);
    expect(provider.list().find(p => p.id === 'census-geocoder')!.lastTest).toMatchObject(failed);
  });
  it('retains existing network and rate-limit failure handling without adding fallback requests', async () => {
    const { provider, fetchJson } = harness(body([]));
    fetchJson.mockRejectedValueOnce(new FeedHttpError('HTTP 429', 429, 600, 'http'));
    expect(await provider.test('census-geocoder')).toEqual({ ok: false, message: 'Rate limited by provider (HTTP 429). Try again later.' });
    fetchJson.mockRejectedValueOnce(new FeedHttpError('unavailable', null, null, 'network'));
    expect(await provider.test('census-geocoder')).toEqual({ ok: false, message: 'Could not reach the provider (network unavailable or blocked).' });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
