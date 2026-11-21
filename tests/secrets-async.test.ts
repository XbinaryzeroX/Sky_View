// Saved keys with Electron's async safeStorage (the sync calls are deprecated in Electron 45), and the stack line
// written when the window stops responding.
import { afterEach, describe, expect, it } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { SecretStore, type Cipher } from '../src/main/secrets';
import { stackSummary } from '../src/main/crashRecovery';
import { tempDbPath } from './helpers';

const stores: AtlasStore[] = [];
afterEach(() => { while (stores.length) stores.pop()!.close(); });

/** Reversible stand-in for DPAPI: base64 of the reversed text. Async calls resolve on a later tick. */
function asyncCipher(calls: string[], opts: { reEncrypt?: boolean; slowEncrypt?: () => Promise<void> } = {}): Cipher {
  const enc = (s: string) => Buffer.from([...s].reverse().join(''));
  const dec = (b: Buffer) => [...b.toString()].reverse().join('');
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => { calls.push('sync-encrypt'); return enc(s); },
    decryptString: (b) => { calls.push('sync-decrypt'); return dec(b); },
    encryptStringAsync: async (s) => { calls.push('async-encrypt'); await opts.slowEncrypt?.(); return enc(s); },
    decryptStringAsync: async (b) => { calls.push('async-decrypt'); return { result: dec(b), shouldReEncrypt: !!opts.reEncrypt }; },
  };
}

describe('saved keys with async safeStorage', () => {
  it('reads keys saved by the older sync calls, and never calls the deprecated ones', async () => {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    // A key written by the previous version (same DPAPI format).
    store.setMeta('secret:google', Buffer.from([...'old-key-123'].reverse().join('')).toString('base64'));
    const calls: string[] = [];
    const s = new SecretStore(store, asyncCipher(calls));
    await s.load();
    expect(s.get('google')).toBe('old-key-123');
    expect(s.has('google')).toBe(true);
    s.set('aisstream', 'new-key-456');
    expect(s.get('aisstream')).toBe('new-key-456');
    await s.flush();
    const again = new SecretStore(store, asyncCipher(calls));
    await again.load();
    expect(again.get('aisstream')).toBe('new-key-456');
    expect(calls.filter((c) => c.startsWith('sync'))).toEqual([]);
    expect(store.metaKeys('secret:')).toEqual(['secret:aisstream', 'secret:google']);
  });

  it('lets a removal win over an older save that is still encrypting', async () => {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = new SecretStore(store, asyncCipher([], { slowEncrypt: () => gate }));
    await s.load();
    s.set('lemmy', 'token-abc');
    s.set('lemmy', null);
    release();
    await s.flush();
    expect(s.get('lemmy')).toBeNull();
    expect(s.has('lemmy')).toBe(false);
    expect(store.getMeta('secret:lemmy')).toBeNull();
  });

  it('re-encrypts a key when the credential store asks for it', async () => {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    store.setMeta('secret:x', Buffer.from('cba').toString('base64'));
    const calls: string[] = [];
    const s = new SecretStore(store, asyncCipher(calls, { reEncrypt: true }));
    await s.load();
    await s.flush();
    expect(s.get('x')).toBe('abc');
    expect(calls).toContain('async-encrypt');
  });
});

describe('stack recorded when the window stops responding', () => {
  it('keeps function, file, line and column only, and caps the length', () => {
    const raw = [
      'Error',
      '    at computeTileVisibility (app://atlas/assets/index-C18HIiEF.js:12870:34330)',
      '    at app://atlas/assets/index-C18HIiEF.js?lat=40.7&note=home:17469:11020',
      '    at Object.<anonymous> (C:\\Users\\someone\\x.js:1:2)',
      'not a frame 40.7128,-74.0060',
    ].join('\n');
    expect(stackSummary(raw)).toBe('stack=computeTileVisibility@index-C18HIiEF.js:12870:34330 < (anon)@index-C18HIiEF.js:17469:11020 < Object.<anonymous>@x.js:1:2');
    expect(stackSummary(undefined)).toBe('stack=unavailable');
    const long = Array.from({ length: 40 }, (_, i) => `    at f${i} (app://atlas/a.js:${i}:1)`).join('\n');
    expect(stackSummary(long).split(' < ')).toHaveLength(14);
  });
});
