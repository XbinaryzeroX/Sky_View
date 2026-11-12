import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderService } from '../src/main/providerService';
import { AtlasStore } from '../src/main/store';
import { SecretStore, type Cipher } from '../src/main/secrets';
import { FeedHttpError, type FetchJson, type FetchText } from '../src/main/feeds/http';

const stores: AtlasStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
function harness(body: unknown) {
  const store = new AtlasStore(':memory:'); stores.push(store);
  const cipher: Cipher = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error('No test credentials'); }, decryptString: () => { throw new Error('No test credentials'); } };
  const fetchJson = vi.fn<FetchJson>().mockResolvedValue({ status: 200, body });
  const fetchText = vi.fn<FetchText>();
  const provider = new ProviderService(store, new SecretStore(store, cipher), fetchJson, fetchText, () => 'AtlasWatch/NIFC-test', async () => { throw new Error('Unexpected socket'); });
  return { provider, fetchJson, fetchText };
}

describe('existing NIFC connection diagnostic', () => {
  it.each([0, 42])('accepts a legitimate publisher count of %s and stores the same successful diagnostic', async (count) => {
    const { provider, fetchJson, fetchText } = harness({ count });
    const result = await provider.test('nifc');
    expect(result).toEqual({ ok: true, message: `Connected. ${count} current perimeters.` });
    expect(provider.list().find(p => p.id === 'nifc')!.lastTest).toMatchObject(result);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [rawUrl, options] = fetchJson.mock.calls[0], url = new URL(rawUrl);
    expect(url.hostname).toBe('services3.arcgis.com');
    expect(url.pathname).toBe('/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query');
    expect(url.searchParams.get('returnCountOnly')).toBe('true');
    expect(url.searchParams.get('where')).toBe('1=1');
    expect(url.searchParams.has('outFields')).toBe(false);
    expect(options?.headers?.['User-Agent']).toBe('AtlasWatch/NIFC-test');
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('rejects an ArcGIS HTTP-200 application error even if a count is also present', async () => {
    const { provider } = harness({ count: 0, error: { code: 400, message: 'Unable to complete operation.', details: ['Invalid query'] } });
    const result = await provider.test('nifc');
    expect(result).toEqual({ ok: false, message: 'NIFC ArcGIS error (code 400): Unable to complete operation.' });
    expect(result.message).not.toContain('Connected');
    expect(provider.list().find(p => p.id === 'nifc')!.lastTest).toMatchObject(result);
  });

  it.each([null, [], {}, { features: [] }, { count: null }, { count: '0' }, { count: -1 }, { count: 1.5 }, { count: NaN }, { count: Infinity }, { count: Number.MAX_SAFE_INTEGER + 1 }])('reports malformed count response %j as failure, not a zero or successful connection', async (body) => {
    const { provider } = harness(body);
    const result = await provider.test('nifc');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('valid'); expect(result.message).toContain('perimeter count');
    expect(result.message).not.toContain('Connected');
    expect(provider.list().find(p => p.id === 'nifc')!.lastTest).toMatchObject(result);
  });

  it.each(['service unavailable', false, [], { message: 1 }])('reports an unexpected ArcGIS error value as failure without trusting the count', async (error) => {
    expect(await harness({ error, count: 5 }).provider.test('nifc')).toEqual({ ok: false, message: 'NIFC ArcGIS error.' });
  });

  it('bounds provider error text and preserves the existing HTTP failure/rate-limit path', async () => {
    const { provider, fetchJson } = harness({ error: { message: 'X'.repeat(50_000) } });
    const result = await provider.test('nifc');
    expect(result.ok).toBe(false); expect(result.message.length).toBeLessThan(300);
    fetchJson.mockRejectedValueOnce(new FeedHttpError('HTTP 429', 429, 600, 'http'));
    const limited = await provider.test('nifc');
    expect(limited).toEqual({ ok: false, message: 'Rate limited by provider (HTTP 429). Try again later.' });
    expect(provider.list().find(p => p.id === 'nifc')!.lastTest).toMatchObject(limited);
  });
});
