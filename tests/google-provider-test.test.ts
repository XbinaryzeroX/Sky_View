// The Google provider test explains a 404 (Map Tiles API not enabled or no billing) and never shows the key.
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderService } from '../src/main/providerService';
import { AtlasStore } from '../src/main/store';
import { SecretStore, type Cipher } from '../src/main/secrets';
import { FeedHttpError, type FetchJson, type FetchText } from '../src/main/feeds/http';

const stores: AtlasStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

it('turns a Google 404 into the Map Tiles API / billing explanation', async () => {
  const store = new AtlasStore(':memory:'); stores.push(store);
  const cipher: Cipher = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
  const fetchJson = vi.fn<FetchJson>().mockRejectedValue(new FeedHttpError('HTTP 404 Not Found', 404, null, 'http'));
  const provider = new ProviderService(store, new SecretStore(store, cipher), fetchJson, vi.fn<FetchText>(), () => 'ua', async () => { throw new Error('no socket'); });
  provider.setCredential('google3d', 'AIzaFIXTURE0000000000');
  const r = await provider.test('google3d');
  expect(r.ok).toBe(false);
  expect(r.message).toMatch(/Map Tiles API is not enabled, or billing is not active/);
  expect(r.message).not.toContain('AIzaFIXTURE');
  expect(String(fetchJson.mock.calls[0][0])).toMatch(/^https:\/\/tile\.googleapis\.com\/v1\/3dtiles\/root\.json\?key=/);
});
