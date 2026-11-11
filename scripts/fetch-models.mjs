#!/usr/bin/env node
// Downloads the Sketchfab models listed in scripts/vehicle-models/shortlist.json.
//
//   node scripts/fetch-models.mjs [--only a320,b737] [--force]
//
// Needs the owner's own Sketchfab API token (sketchfab.com → Settings → Password & API):
//   %USERPROFILE%\.atlas-watch\sketchfab-token.txt   (or the SKETCHFAB_TOKEN environment variable)
// The token is sent only to api.sketchfab.com and is never printed. The signed download
// links Sketchfab returns are not printed either.
//
// Each model's licence is re-checked against Sketchfab before downloading: only CC0 and
// CC BY 4.0 are accepted. Files land outside the repository, in
//   %USERPROFILE%\.atlas-watch\models\raw\<uid>\   (model files + meta.json with the attribution)
// Then run scripts/import-models.mjs to convert them for the app.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanAuthor, downloadCapped, extractZip, redactSecret, sourceUrlFor, validToken } from './vehicle-models/safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shortlist = JSON.parse(fs.readFileSync(path.join(here, 'vehicle-models', 'shortlist.json'), 'utf8'));
const home = path.join(os.homedir(), '.atlas-watch');
const rawRoot = path.join(home, 'models', 'raw');
const API = 'https://api.sketchfab.com/v3';
const ACCEPTED = new Set(['cc0', 'by']);
const MAX_BYTES = 200 * 1024 * 1024;
const UA = 'AtlasWatch model fetch (desktop app build script)';

const args = process.argv.slice(2);
const only = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();
const force = args.includes('--force');

/** { token } when a valid token is saved, { missing } when none is, { invalid } when what is saved isn't one token. */
function readToken() {
  const env = process.env.SKETCHFAB_TOKEN;
  if (env?.trim()) return validToken(env) ? { token: validToken(env) } : { invalid: 'SKETCHFAB_TOKEN' };
  const file = path.join(home, 'sketchfab-token.txt');
  if (!fs.existsSync(file)) return { missing: true };
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return { missing: true };
  return validToken(raw) ? { token: validToken(raw) } : { invalid: file };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, token) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (token) headers.Authorization = `Token ${token}`;
  const where = new URL(url).pathname;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers, redirect: 'error' });
    } catch {
      // fetch errors can quote request headers (the token): report a fixed message instead.
      throw new Error(`request to ${where} failed (network error)`);
    }
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${where}`);
    try {
      return await res.json();
    } catch {
      throw new Error(`unexpected reply from ${where}`);
    }
  }
  throw new Error('rate limited by Sketchfab (HTTP 429), try again later');
}

async function main() {
  const saved = readToken();
  if (saved.invalid) {
    // Never print what was saved: it may be (or contain) the token.
    console.error(`The Sketchfab token in ${saved.invalid} isn't a single API token. It should be one line of letters and digits`);
    console.error('(sketchfab.com → Settings → Password & API → API token), with nothing else in the file.');
    process.exit(2);
  }
  const token = saved.token;
  if (!token) {
    console.error('No Sketchfab token. Save your own API token (sketchfab.com → Settings → Password & API) in');
    console.error('  ' + path.join(home, 'sketchfab-token.txt'));
    console.error('or set SKETCHFAB_TOKEN, then run this again.');
    process.exit(2);
  }
  fs.mkdirSync(rawRoot, { recursive: true });
  const list = shortlist.models.filter((m) => !only || only.has(m.id));
  let ok = 0;
  const failed = [];
  for (const m of list) {
    const dir = path.join(rawRoot, m.uid);
    if (!force && fs.existsSync(path.join(dir, 'meta.json'))) {
      console.log(`${m.id.padEnd(10)} already downloaded`);
      ok++;
      continue;
    }
    let created = null;
    try {
      // Public metadata (no token): licence, author, link.
      const meta = await getJson(`${API}/models/${m.uid}`);
      const slug = meta?.license?.slug ?? meta?.license?.label ?? '';
      if (!ACCEPTED.has(String(slug).toLowerCase())) throw new Error(`licence "${slug}" is not CC0 or CC BY`);
      if (meta.isDownloadable === false) throw new Error('model is no longer downloadable');
      const links = await getJson(`${API}/models/${m.uid}/download`, token);
      const pick = links?.glb?.url ? { kind: 'glb', url: links.glb.url } : links?.gltf?.url ? { kind: 'gltf', url: links.gltf.url } : null;
      if (!pick) throw new Error('no glTF download offered');
      const bytes = await downloadCapped(pick.url, { maxBytes: MAX_BYTES, userAgent: UA });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      created = dir;
      if (pick.kind === 'glb') fs.writeFileSync(path.join(dir, 'model.glb'), bytes);
      else if (!extractZip(bytes, dir)) throw new Error('empty archive');
      const license = String(slug).toLowerCase() === 'cc0' ? 'CC0 1.0' : 'CC BY 4.0';
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        JSON.stringify({
          id: m.id,
          uid: m.uid,
          name: String(meta.name ?? m.title).slice(0, 120),
          author: cleanAuthor(meta.user),
          authorUrl: typeof meta.user?.profileUrl === 'string' ? meta.user.profileUrl : null,
          license,
          licenseUrl: license === 'CC0 1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/4.0/',
          sourceUrl: sourceUrlFor(m.uid, meta.viewerUrl),
          fetchedAt: new Date().toISOString(),
          format: pick.kind,
          bytes: bytes.byteLength,
        }, null, 2),
      );
      console.log(`${m.id.padEnd(10)} ok  ${(bytes.byteLength / 1e6).toFixed(1)} MB  ${license}  by ${cleanAuthor(meta.user)}`);
      ok++;
    } catch (e) {
      // A partial download is removed (it has no meta.json, so it would not be imported anyway).
      if (created) fs.rmSync(created, { recursive: true, force: true });
      console.log(`${m.id.padEnd(10)} FAILED  ${redactSecret(String(e?.message ?? e), token).slice(0, 160)}`);
      failed.push(m.id);
    }
    await sleep(1200); // Be gentle with the API.
  }
  console.log(`\n${ok}/${list.length} models ready in ${rawRoot}`);
  if (failed.length) console.log('Failed: ' + failed.join(', '));
  console.log('Next: node scripts/import-models.mjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
