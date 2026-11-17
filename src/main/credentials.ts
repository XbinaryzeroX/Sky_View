// Main-process credential resolution. Included keys are obfuscated, not secured:
// anyone possessing the application bundle can extract them.
import type { ProviderId } from '../shared/providers';
import type { AtlasStore } from './store';
import { registerProtectedSecrets, type SecretStore } from './secrets';

export const BUILTIN_ALLOWANCES = { google3d: 30, twelvedata: 200, alphavantage: 10 } as const;
export type BuiltinProvider = keyof typeof BUILTIN_ALLOWANCES;
export type BuiltinKeys = Partial<Record<BuiltinProvider, string>>;
export interface Credential {
  value: string;
  source: 'user' | 'builtin';
}

declare const __ATLAS_BUILTIN_KEYS__: string;

export function decodeBuiltinKeys(blob: string): BuiltinKeys {
  const envelope = JSON.parse(blob) as { pad: string; data: string };
  const pad = Buffer.from(envelope.pad, 'base64');
  const data = Buffer.from(envelope.data, 'base64');
  if (pad.length !== data.length) throw new Error('Invalid built-in credential bundle.');
  const input = JSON.parse(Buffer.from(data.map((value, index) => value ^ pad[index])).toString('utf8')) as BuiltinKeys;
  const keys: BuiltinKeys = {};
  for (const id of Object.keys(BUILTIN_ALLOWANCES) as BuiltinProvider[]) {
    if (input[id] === undefined) continue;
    if (typeof input[id] !== 'string' || !/^[\x20-\x7e]{8,200}$/.test(input[id]!)) throw new Error('Invalid built-in credential bundle.');
    keys[id] = input[id];
  }
  return keys;
}

function bundledKeys(): BuiltinKeys {
  return typeof __ATLAS_BUILTIN_KEYS__ === 'undefined' ? {} : decodeBuiltinKeys(__ATLAS_BUILTIN_KEYS__);
}

export class CredentialService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly store: Pick<AtlasStore, 'getMeta' | 'setMeta'>,
    private readonly builtin: BuiltinKeys = bundledKeys(),
  ) {
    registerProtectedSecrets(Object.values(builtin));
  }

  credentialFor(id: ProviderId): Credential | null {
    if (this.secrets.has(id)) {
      const value = this.secrets.get(id);
      if (!value) throw new Error('Your saved credential could not be decrypted. Replace or remove it in Providers.');
      return { value, source: 'user' };
    }
    const value = this.builtin[id as BuiltinProvider];
    return value ? { value, source: 'builtin' } : null;
  }

  private counter(id: BuiltinProvider): string {
    return `builtin-allowance:${id}:${new Date().toISOString().slice(0, 10)}`;
  }

  remaining(id: BuiltinProvider): number {
    const used = Number(this.store.getMeta(this.counter(id))) || 0;
    return Math.max(0, BUILTIN_ALLOWANCES[id] - used);
  }

  reserveBuiltin(id: BuiltinProvider): void {
    if (this.remaining(id) === 0) {
      const name = { google3d: 'Google 3D', twelvedata: 'Twelve Data', alphavantage: 'Alpha Vantage' }[id];
      throw new Error(`Today's built-in allowance for ${name} is used up. Add your own key in Providers for more.`);
    }
    this.store.setMeta(this.counter(id), String(BUILTIN_ALLOWANCES[id] - this.remaining(id) + 1));
  }

  /**
   * Whether a usable credential resolves. A saved credential that cannot be decrypted counts as none
   * (never a fallback to the included key); Providers reports it on that provider's row.
   */
  available(id: ProviderId): boolean {
    try {
      return !!this.credentialFor(id);
    } catch {
      return false;
    }
  }

  /** The user's own saved key only; never the included key. */
  userKey(id: ProviderId): string | null {
    return this.secrets.has(id) ? this.secrets.get(id) : null;
  }

  /**
   * Key for a renderer-side service. The included Google key is for Photorealistic 3D only:
   * 'google2d' (Google satellite tiles, a separately billed product) resolves to the user's own key.
   */
  browserKey(id: 'google3d' | 'google2d' | 'esri-imagery' | 'mapbox' | 'tomtom' | 'cesium-ion'): string | null {
    const credential = this.credentialFor(id === 'google2d' ? 'google3d' : id);
    if (credential?.source === 'builtin') {
      if (id !== 'google3d') return null;
      this.reserveBuiltin('google3d');
    }
    return credential?.value ?? null;
  }
}
