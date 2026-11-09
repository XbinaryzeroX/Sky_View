// Customer credentials, encrypted with the OS credential store via Electron
// safeStorage (DPAPI on Windows). Plaintext is never written to disk, logs,
// exports, or sent to the renderer (except a browser key the user explicitly
// configured for a browser-side service, which is not secret by design).

import type { AtlasStore } from './store';

export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}

export class SecretStore {
  constructor(
    private readonly store: AtlasStore,
    private readonly cipher: Cipher,
  ) {}

  private key(id: string) {
    return `secret:${id}`;
  }

  has(id: string): boolean {
    return this.store.getMeta(this.key(id)) !== null;
  }

  set(id: string, value: string | null): void {
    if (value === null || value === '') {
      this.store.deleteMeta(this.key(id));
      return;
    }
    if (!this.cipher.isEncryptionAvailable()) throw new Error('The operating system credential store is unavailable, so the key was not saved.');
    this.store.setMeta(this.key(id), this.cipher.encryptString(value).toString('base64'));
  }

  get(id: string): string | null {
    const v = this.store.getMeta(this.key(id));
    if (!v) return null;
    try {
      return this.cipher.decryptString(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }
}

/** Removes anything that looks like a credential from text before it is shown or logged. */
export function redactSecrets(text: string, secrets: (string | null)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out.replace(/([?&](?:key|apikey|api_key|token)=)[^&\s"']+/gi, '$1[redacted]');
}
