// Customer credentials, encrypted with the OS credential store via Electron
// safeStorage (DPAPI on Windows). Plaintext is never written to disk, logs,
// exports, or sent to the renderer (except a browser key the user explicitly
// configured for a browser-side service, which is not secret by design).

import type { AtlasStore } from './store';

export interface Cipher {
  isEncryptionAvailable(): boolean;
  /** Synchronous forms: kept for tests and as a fallback; Electron 45 deprecates them on safeStorage. */
  encryptString?(s: string): Buffer;
  decryptString?(b: Buffer): string;
  encryptStringAsync?(s: string): Promise<Buffer>;
  decryptStringAsync?(b: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/**
 * Keys are decrypted once at startup (`load`, async safeStorage) and then served from memory, so every caller can
 * stay synchronous. Writes update memory at once and reach the database when encryption finishes; a newer write or
 * a removal of the same key always wins over an older encryption still in flight.
 */
export class SecretStore {
  private readonly cache = new Map<string, string | null>();
  private readonly gen = new Map<string, number>();
  private readonly pending = new Set<Promise<void>>();
  private loaded = false;

  constructor(
    private readonly store: AtlasStore,
    private readonly cipher: Cipher,
  ) {}

  private key(id: string) {
    return `secret:${id}`;
  }

  private bump(id: string): number {
    const g = (this.gen.get(id) ?? 0) + 1;
    this.gen.set(id, g);
    return g;
  }

  /** Decrypts every stored key into memory. Keys that cannot be decrypted (another Windows account) read as absent. */
  async load(): Promise<void> {
    if (this.cipher.decryptStringAsync) {
      for (const k of this.store.metaKeys('secret:')) {
        const id = k.slice('secret:'.length);
        if (this.cache.has(id)) continue;
        const v = this.store.getMeta(k);
        if (!v) continue;
        try {
          const { result, shouldReEncrypt } = await this.cipher.decryptStringAsync(Buffer.from(v, 'base64'));
          if (this.cache.has(id)) continue; // set or removed while decrypting
          this.cache.set(id, result);
          if (shouldReEncrypt) this.set(id, result);
        } catch {
          // Unreadable here: treated as not configured, the stored value is left untouched.
        }
      }
    }
    this.loaded = true;
  }

  /** Resolves when every write started so far has reached the database. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  has(id: string): boolean {
    if (this.cache.has(id)) return this.cache.get(id) !== null;
    return this.store.getMeta(this.key(id)) !== null;
  }

  set(id: string, value: string | null): void {
    const g = this.bump(id);
    if (value === null || value === '') {
      this.cache.set(id, null);
      this.store.deleteMeta(this.key(id));
      return;
    }
    if (!this.cipher.isEncryptionAvailable()) throw new Error('The operating system credential store is unavailable, so the key was not saved.');
    if (this.cipher.encryptStringAsync) {
      this.cache.set(id, value);
      const p = this.cipher.encryptStringAsync(value)
        .then((buf) => { if (this.gen.get(id) === g) this.store.setMeta(this.key(id), buf.toString('base64')); })
        .catch(() => { if (this.gen.get(id) === g) this.cache.delete(id); })
        .finally(() => this.pending.delete(p));
      this.pending.add(p);
      return;
    }
    if (!this.cipher.encryptString) throw new Error('The operating system credential store is unavailable, so the key was not saved.');
    this.store.setMeta(this.key(id), this.cipher.encryptString(value).toString('base64'));
    this.cache.set(id, value);
  }

  get(id: string): string | null {
    if (this.cache.has(id)) return this.cache.get(id) ?? null;
    // Loaded with the async API: anything not in memory could not be decrypted.
    if (this.loaded && this.cipher.decryptStringAsync) return null;
    const v = this.store.getMeta(this.key(id));
    if (!v || !this.cipher.decryptString) return null;
    try {
      return this.cipher.decryptString(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }
}

const protectedSecrets = new Set<string>();
/** Register main-process bundled credentials once, including their URL-encoded forms. */
export function registerProtectedSecrets(values: string[]): void {
  for (const value of values) {
    protectedSecrets.add(value);
    protectedSecrets.add(encodeURIComponent(value));
  }
}

/** Removes anything that looks like a credential from text before it is shown or logged. */
export function redactSecrets(text: string, secrets: (string | null)[]): string {
  let out = text;
  for (const s of [...protectedSecrets, ...secrets]) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(/([?&](?:key|apikey|api_key|token)=)[^&\s"']+/gi, '$1[redacted]');
}
