// Desktop smoke test: launches the built app with a temporary database,
// waits for feeds to load, prints renderer/feed status, saves a screenshot.
// Usage: node scripts/smoke.mjs [screenshot.png] [waitMs]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const dir = mkdtempSync(join(tmpdir(), 'atlas-smoke-'));
const shot = resolve(process.argv[2] ?? join(dir, 'smoke.png'));
const waitMs = process.argv[3] ?? '25000';
const expectedViews = process.env.ATLAS_WATCH_SMOKE_VIEWS
  ? JSON.parse(readFileSync(process.env.ATLAS_WATCH_SMOKE_VIEWS, 'utf8')).length : 0;

const child = spawn(electron, ['.'], {
  env: {
    ...process.env,
    ATLAS_WATCH_SMOKE: '1',
    ATLAS_WATCH_SMOKE_MS: waitMs,
    ATLAS_WATCH_SMOKE_SHOT: shot,
    ATLAS_WATCH_DB: process.env.ATLAS_WATCH_DB ?? join(dir, 'smoke.sqlite'),
    ATLAS_WATCH_USER_DATA: process.env.ATLAS_WATCH_USER_DATA ?? join(dir, 'profile'),
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const timer = setTimeout(() => child.kill(), Number(waitMs) + 60000);
child.on('exit', (code) => {
  clearTimeout(timer);
  const lines = out.split(/\r?\n/).filter((l) => /SMOKE_|\[feeds\]|\[security\]|Uncaught|Error|CSP|Content Security Policy|Refused/i.test(l));
  // Always retain scenario/view evidence even when a publisher emits many tile errors.
  const evidence = lines.filter((line) => /SMOKE_/.test(line));
  const diagnostics = lines.filter((line) => !/SMOKE_/.test(line)).slice(0, 60);
  console.log([...diagnostics, ...evidence].join('\n'));
  console.log(`exit=${code} screenshot=${shot}`);
  const result = /SMOKE_RESULT (.*)/.exec(out);
  let ok = false;
  try {
    const r = JSON.parse(result?.[1] ?? 'null');
    ok = code === 0 && !!r && r.globeReady === true && Array.isArray(r.errors) && r.errors.length === 0;
    if (!r && expectedViews > 0) {
      const views = [...out.matchAll(/^SMOKE_VIEW .+? settledMs=\d+ (.+)$/gm)].map((m) => JSON.parse(m[1]));
      ok = code === 0 && views.length === expectedViews && views.every((v) => v.renderErrors === 0) && out.includes('SMOKE_NET ');
    }
    if (process.env.ATLAS_WATCH_SMOKE_JS) ok = ok && /^SMOKE_SCRIPT /m.test(out) && !out.includes('SMOKE_SCRIPT_ERROR');
  } catch {
    ok = false;
  }
  process.exit(ok ? 0 : 1);
});
