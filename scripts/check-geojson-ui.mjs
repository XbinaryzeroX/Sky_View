// Runs the actual built main/preload/renderer with controlled native-dialog/shell adapters in a TEMP bootstrap.
// Production assets are unchanged. This verifies integration after the Windows helper could not operate its picker;
// it does NOT establish native picker interaction, default-browser opening or Google panorama availability.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const session = await mkdtemp(join(tmpdir(), 'atlas-geojson-ui-'));
const exportPath = join(session, 'annotations.geojson');
const bootstrap = join(session, 'bootstrap.cjs');
const previewShot = join(root, 'docs/screenshots/audit-geojson-preview.png');
const shellLog = join(session, 'shell-links.json');
const previewCheckbox = '[role="dialog"][aria-label="Import GeoJSON annotations"] input[type="checkbox"]';
await writeFile(bootstrap, `
const { app, dialog, BrowserWindow, shell } = require('electron');
const fs = require('node:fs/promises');
const sentLinks = [];
dialog.showOpenDialog = async (...args) => {
  const options = args.at(-1);
  if (!options.filters?.some(f => f.name === 'GeoJSON annotations')) throw new Error('Unexpected open dialog');
  return { canceled: false, filePaths: [${JSON.stringify(join(root, 'tests/fixtures/geojson-annotations.json'))}] };
};
dialog.showSaveDialog = async (...args) => {
  if (!args.at(-1).filters?.some(f => f.name === 'GeoJSON')) throw new Error('Unexpected save dialog');
  return { canceled: false, filePath: ${JSON.stringify(exportPath)} };
};
shell.openExternal = async url => { sentLinks.push(url); await fs.writeFile(${JSON.stringify(shellLog)}, JSON.stringify(sentLinks)); };
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', async () => {
  await contents.executeJavaScript('window.__atlasQaAdapter = {fileDialogs: true, browserHandoff: true}');
  if (process.env.ATLAS_GEOJSON_RESTART === '1') return;
  let inspecting = false;
  const poll = setInterval(async () => {
    if (inspecting || contents.isDestroyed()) return;
    inspecting = true;
    try {
      const ready = await contents.executeJavaScript(${JSON.stringify(`!!document.querySelector(${JSON.stringify(previewCheckbox)})`)});
      if (!ready) { inspecting = false; return; }
      clearInterval(poll);
      await new Promise(resolve => setTimeout(resolve, 600));
      await fs.writeFile(${JSON.stringify(previewShot)}, (await contents.capturePage()).toPNG());
      await contents.executeJavaScript(${JSON.stringify(`document.querySelector(${JSON.stringify(previewCheckbox)}).click()`)});
    } catch (error) { console.error('QA_ADAPTER_ERROR', error); clearInterval(poll); }
  }, 200);
}));
require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});
`);
execFileSync(process.execPath, ['--check', bootstrap], { stdio: 'pipe' });

async function run(restart) {
  const child = spawn(electron, [bootstrap], { cwd: root, env: { ...process.env,
    ATLAS_WATCH_SMOKE: '1', ATLAS_WATCH_SMOKE_MS: restart ? '10000' : '28000',
    ATLAS_WATCH_DB: join(session, 'qa.sqlite'), ATLAS_WATCH_USER_DATA: join(session, 'profile'),
    ATLAS_WATCH_SMOKE_JS: join(root, restart ? 'scripts/qa-geojson-restart.js' : 'scripts/qa-geojson.js'),
    ATLAS_WATCH_SMOKE_SHOT: join(root, `docs/screenshots/audit-geojson-${restart ? 'restart' : 'adapter'}.png`),
    ATLAS_GEOJSON_RESTART: restart ? '1' : '0', ELECTRON_ENABLE_LOGGING: '1',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  const timeout = setTimeout(() => child.kill(), 65000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  console.log(output.split(/\r?\n/).filter(line => /SMOKE_|QA_ADAPTER_ERROR/.test(line)).join('\n'));
  assert.equal(code, 0, 'Electron did not exit cleanly');
  assert(!output.includes('SMOKE_SCRIPT_ERROR') && !output.includes('QA_ADAPTER_ERROR'), 'Desktop scenario failed');
  const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(output)?.[1] ?? 'null');
  const renderer = JSON.parse(/^SMOKE_RESULT (.+)$/m.exec(output)?.[1] ?? 'null');
  assert.equal(scenario?.result, 'PASS', 'Scenario did not report PASS');
  assert.equal(renderer?.globeReady, true);
  assert.deepEqual(renderer?.errors, []);
  return scenario;
}
const imported = await run(false);
const exported = JSON.parse(await readFile(exportPath, 'utf8'));
assert.equal(exported.type, 'FeatureCollection');
assert.equal(exported.features.length, 4);
assert(!/source-secret|private-source-note|apiKey|token|existing-id|qa-existing-annotation/.test(JSON.stringify(exported)));
const links = JSON.parse(await readFile(shellLog, 'utf8'));
assert.equal(links.length, 1);
const url = new URL(links[0]);
assert.equal(url.origin, 'https://www.google.com');
assert.equal(url.searchParams.get('map_action'), 'pano');
assert.equal(url.searchParams.get('viewpoint'), `${Number(imported.streetViewTarget.tiltedCenter.lat.toFixed(6))},${Number(imported.streetViewTarget.tiltedCenter.lon.toFixed(6))}`);
const restarted = await run(true);
console.log(JSON.stringify({ result: 'PASS', adapters: 'file chooser/save results and shell dispatch only',
  nativePickerInteraction: 'unverified: Windows helper could not operate controls', browserOpened: false,
  publicImageryCopied: false, exportFeatures: exported.features.length, restarted, session, previewShot }, null, 2));
