// Build-time key loading only. Never import this module from renderer/preload code.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const PROVIDERS = ['google3d', 'twelvedata', 'alphavantage'];

export function parseBuiltinKeys(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('Built-in keys file must contain a JSON object.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Built-in keys file must contain a JSON object.');
  }
  const keys = {};
  for (const id of PROVIDERS) {
    if (!Object.hasOwn(input, id)) continue;
    const value = input[id];
    if (typeof value !== 'string' || !/^[\x20-\x7e]{8,200}$/.test(value)) {
      throw new Error(`Invalid built-in credential for ${id}: expected 8–200 printable ASCII characters.`);
    }
    keys[id] = value;
  }
  return keys;
}

export async function loadBuiltinKeys(path = process.env.ATLAS_WATCH_BUILTIN_KEYS || join(homedir(), '.atlas-watch', 'builtin-keys.json')) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    // Do not echo paths or content; either could contain a credential.
    throw new Error('Could not read the built-in keys file.');
  }
  return parseBuiltinKeys(raw.replace(/^\uFEFF/, ''));
}

export function obfuscateBuiltinKeys(keys) {
  // Obfuscation, not security: anyone with a copy of the app can extract these keys.
  const bytes = Buffer.from(JSON.stringify(keys), 'utf8');
  const pad = randomBytes(bytes.length);
  const data = Buffer.from(bytes.map((value, index) => value ^ pad[index]));
  return JSON.stringify({ pad: pad.toString('base64'), data: data.toString('base64') });
}
