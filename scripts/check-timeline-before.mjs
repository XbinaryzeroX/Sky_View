// Runs untouched prior dist only. No build, source changes, synthetic observations or user profile access.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('docs/screenshots/timeline', { recursive: true });
const child = spawn(process.execPath, ['scripts/smoke.mjs', 'docs/screenshots/timeline/audit-timeline-before.png', '18000'], {
  cwd: process.cwd(), env: { ...process.env, ATLAS_WATCH_SMOKE_JS: resolve('scripts/qa-timeline-before.js') }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', chunk => log += chunk);
child.stderr.on('data', chunk => log += chunk);
const timer = setTimeout(() => child.kill(), 45000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
finally { clearTimeout(timer); }
await writeFile('docs/timeline-before-audit.log', log);
console.log(log);
assert.equal(code, 0, 'Before-state smoke failed');
const result = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? 'null');
assert.equal(result?.result, 'PASS');
assert.equal(result?.movementOnlyReplay, true);
assert.equal(result?.timelineRangeBridgePresent, false);
assert.deepEqual(result?.rendererErrors, []);
