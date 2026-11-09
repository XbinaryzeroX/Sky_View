// Desktop smoke test: launches the built app with a temporary database,
// waits for feeds to load, prints renderer/feed status, saves a screenshot.
// Usage: node scripts/smoke.mjs [screenshot.png] [waitMs]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const dir = mkdtempSync(join(tmpdir(), 'atlas-smoke-'));
const shot = resolve(process.argv[2] ?? join(dir, 'smoke.png'));
const waitMs = process.argv[3] ?? '25000';

const child = spawn(electron, ['.'], {
  env: {
    ...process.env,
    ATLAS_WATCH_SMOKE: '1',
    ATLAS_WATCH_SMOKE_MS: waitMs,
    ATLAS_WATCH_SMOKE_SHOT: shot,
    ATLAS_WATCH_DB: process.env.ATLAS_WATCH_DB ?? join(dir, 'smoke.sqlite'),
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
  console.log(lines.slice(0, 60).join('\n'));
  console.log(`exit=${code} screenshot=${shot}`);
  const result = /SMOKE_RESULT (.*)/.exec(out);
  let ok = false;
  try {
    const r = JSON.parse(result?.[1] ?? 'null');
    ok = !!r && r.globeReady === true;
  } catch {
    ok = false;
  }
  process.exit(ok ? 0 : 1);
});
