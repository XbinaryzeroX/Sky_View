// Actual built Electron/main/preload/renderer, isolated TEMP profile and database.
// node scripts/check-area-watch-ui.mjs [--fixture] [--out-dir <directory>]
// The live run seeds only user annotations/rules through real AtlasStore/AppCore at
// an explicitly earlier injected QA clock. No provider data or live clock is replaced.
// --fixture is a separately labelled test-only fetch adapter; it makes no live claim.
// This runner never builds/mutates dist. Build the current production source first.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureOnly = process.argv.includes('--fixture');
const outIndex = process.argv.indexOf('--out-dir');
assert(outIndex < 0 || process.argv[outIndex + 1], '--out-dir needs a directory');
const session = await mkdtemp(join(tmpdir(), 'atlas-area-watch-ui-'));
const output = outIndex < 0 ? session : resolve(process.argv[outIndex + 1]);
await mkdir(output, { recursive: true });
const mode = fixtureOnly ? 'fixture' : 'live';
const db = join(session, 'qa.sqlite');
const activation = '2020-01-01T00:00:00.000Z';
const seedPath = join(session, 'seed.cjs');
const manifestPath = join(session, 'seed.json');
const baselinePath = join(session, 'baseline.json');
const responsesPath = join(session, 'usgs-responses.json');
const bootstrapPath = join(session, 'bootstrap.cjs');
const fixturePath = join(session, 'explicit-test-only-usgs.json');
const environmentNow = new Date().toISOString();
const regions = [
  { id: 'qa-watch-california', name: 'QA California region', points: [[-126, 30], [-114, 30], [-114, 43], [-126, 43]] },
  { id: 'qa-watch-hawaii', name: 'QA Hawaii region', points: [[-161, 17], [-154, 17], [-154, 24], [-161, 24]] },
  { id: 'qa-watch-alaska', name: 'QA Alaska and Aleutians region', points: [[170, 50], [-125, 50], [-125, 73], [170, 73]] },
];
const newArea = { ...regions[0], id: 'qa-watch-created-in-ui', name: 'QA new watch — no backfill' };

await build({ stdin: { contents: `
import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
import { AppCore } from ${JSON.stringify(join(root, 'src/main/core.ts'))};
import { writeFileSync } from 'node:fs';
const store = new AtlasStore(${JSON.stringify(db)});
store.saveSettings({ ...store.getSettings(), basemap: 'neutral', terrainEnabled: false, labelsOverlay: false,
  buildings3d: false, layersEnabled: [], zoneLookupEnabled: false, usgsPollSeconds: 3600, nwsPollSeconds: 3600,
  quakeWindow: 'day', quakeMinMagnitude: -1, quakesNearLocationsOnly: false });
const core = new AppCore({ store, now: () => new Date(${JSON.stringify(activation)}),
  alertSource: { name: 'unused seed dependency', fetchActiveAlerts: async () => { throw new Error('Seed must not fetch'); }, fetchPointZones: async () => { throw new Error('Seed must not fetch'); } },
  quakeSource: { name: 'unused seed dependency', fetchRecent: async () => { throw new Error('Seed must not fetch'); } } });
core.init();
const regions = ${JSON.stringify(regions)};
for (const area of [...regions, ${JSON.stringify(newArea)}]) core.putAnnotation({ ...area, kind: 'area', color: '#5fd0e6', visible: true, createdAt: ${JSON.stringify(activation)} });
for (const area of regions) core.putAreaWatch({ areaId: area.id, minMagnitude: -2, enabled: true });
writeFileSync(${JSON.stringify(manifestPath)}, JSON.stringify({ activationClock: ${JSON.stringify(activation)}, seededThrough: 'actual AtlasStore/AppCore', providerRecordsSeeded: 0,
  areaNames: regions.map(area => area.name), rules: core.snapshot().areaWatches.rules }, null, 2));
core.stop(); store.close();
`, resolveDir: root, sourcefile: 'area-watch-qa-seed.ts', loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: seedPath, logLevel: 'silent' });
execFileSync(process.execPath, [seedPath], { cwd: root, stdio: 'pipe' });
const seed = JSON.parse(await readFile(manifestPath, 'utf8'));
assert(seed.rules.length === 3 && seed.rules.every(rule => rule.armedAt === activation));

if (fixtureOnly) {
  const now = Date.now();
  const features = [
    ['qa-fixture-california', -120, 36, 3.1], ['qa-fixture-hawaii', -156, 20, 4.2], ['qa-fixture-alaska', 179, 55, 2.6],
  ].map(([id, lon, lat, mag]) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat, 10] },
    properties: { mag, time: now - 4 * 3600_000, updated: now - 3 * 3600_000, ids: ',' + id + ',', type: 'earthquake',
      place: 'Explicit controlled desktop QA fixture', title: 'Test-only earthquake fixture', status: 'reviewed', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/' + id } }));
  await writeFile(fixturePath, JSON.stringify({ type: 'FeatureCollection', metadata: { generated: now, title: 'TEST ONLY — not a live USGS response' }, features }));
}

await writeFile(bootstrapPath, `
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const nativeFetch = globalThis.fetch;
const observations = [];
globalThis.fetch = async (input, options) => {
  const raw = typeof input === 'string' ? input : input.url ?? String(input);
  const isUsgs = /^https:\\/\\/earthquake\\.usgs\\.gov\\/earthquakes\\/feed\\/v1\\.0\\/summary\\//.test(raw);
  if (${JSON.stringify(fixtureOnly)} && !isUsgs) throw new Error('Explicit fixture-only QA adapter blocks other main-process fetches');
  const response = ${JSON.stringify(fixtureOnly)}
    ? new Response(await fs.readFile(${JSON.stringify(fixturePath)}, 'utf8'), { status: 200, headers: { 'Content-Type': 'application/geo+json' } })
    : await nativeFetch(input, options);
  if (isUsgs) {
    const text = await response.clone().text();
    let body; try { body = JSON.parse(text); } catch { body = { parseError: true }; }
    observations.push({ mode: ${JSON.stringify(mode)}, requestUrl: raw, receivedAt: new Date().toISOString(), httpStatus: response.status,
      responseDate: response.headers.get('date'), body });
    await fs.writeFile(${JSON.stringify(responsesPath)}, JSON.stringify(observations));
  }
  return response;
};
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', async () => {
  const restart = process.env.ATLAS_AREA_WATCH_QA_PHASE === 'restart';
  const baseline = restart ? JSON.parse(await fs.readFile(${JSON.stringify(baselinePath)}, 'utf8')) : null;
  await contents.executeJavaScript('window.__atlasAreaWatchQa = ' + JSON.stringify({ mode: ${JSON.stringify(mode)}, seed: ${JSON.stringify(seed)}, environmentNow: ${JSON.stringify(environmentNow)}, restart, baseline }));
  let busy = false, last = '';
  const poll = setInterval(async () => {
    if (busy || contents.isDestroyed()) return;
    busy = true;
    try {
      const label = await contents.executeJavaScript('window.__atlasAreaWatchQaCapture ?? null');
      if (label && label !== last && /^[a-z-]+$/.test(label)) {
        last = label;
        await new Promise(resolve => setTimeout(resolve, 500));
        await fs.writeFile(path.join(${JSON.stringify(output)}, 'audit-area-watch-${mode}-' + label + '.png'), (await contents.capturePage()).toPNG());
        await contents.executeJavaScript('window.__atlasAreaWatchQaCaptured = ' + JSON.stringify(label));
      }
    } catch (error) { if (!contents.isDestroyed()) console.error('AREA_WATCH_QA_CAPTURE_ERROR', error.message); }
    finally { busy = false; }
  }, 150);
  app.once('before-quit', () => clearInterval(poll));
}));
require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});
`);
execFileSync(process.execPath, ['--check', bootstrapPath], { stdio: 'pipe' });

async function run(restart) {
  const child = spawn(require('electron'), [bootstrapPath], { cwd: root, env: { ...process.env,
    ATLAS_WATCH_SMOKE: '1', ATLAS_WATCH_SMOKE_MS: restart ? '45000' : '85000',
    ATLAS_WATCH_DB: db, ATLAS_WATCH_USER_DATA: join(session, 'profile'),
    ATLAS_WATCH_SMOKE_JS: join(root, 'scripts/qa-area-watch.js'),
    ATLAS_WATCH_SMOKE_SHOT: join(output, `audit-area-watch-${mode}-${restart ? 'restart' : 'overview'}.png`),
    ATLAS_AREA_WATCH_QA_PHASE: restart ? 'restart' : 'initial', ELECTRON_ENABLE_LOGGING: '1',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const collect = chunk => {
    log += chunk;
    // Retain a concrete failure promptly instead of waiting out the screenshot deadline.
    if (log.includes('SMOKE_SCRIPT_ERROR') || log.includes('AREA_WATCH_QA_CAPTURE_ERROR')) child.kill();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => child.kill(), restart ? 65000 : 105000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearTimeout(timer); }
  await writeFile(join(output, `area-watch-${mode}-${restart ? 'restart' : 'initial'}.log`), log);
  console.log(log.split(/\r?\n/).filter(line => /SMOKE_|AREA_WATCH_QA/.test(line) && !/^SMOKE_SCRIPT /.test(line)).join('\n'));
  assert.equal(code, 0, 'Electron did not exit cleanly');
  assert(!log.includes('SMOKE_SCRIPT_ERROR') && !log.includes('AREA_WATCH_QA_CAPTURE_ERROR'), 'Desktop scenario failed; inspect the phase log');
  const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? 'null');
  const renderer = JSON.parse(/^SMOKE_RESULT (.+)$/m.exec(log)?.[1] ?? 'null');
  assert(scenario?.result === 'PASS' || (!fixtureOnly && scenario?.result === 'LIVE_NO_QUALIFYING_MATCHES'), 'Scenario did not report success or an honest live no-match result');
  assert.equal(renderer?.globeReady, true);
  assert.deepEqual(renderer?.errors, []);
  console.log('AREA_WATCH_QA_PHASE ' + JSON.stringify({ ...scenario,
    ...(scenario.initialEvents ? { initialEvents: scenario.initialEvents.length, finalEvents: scenario.finalEvents.length } : {}) }));
  return scenario;
}

console.log(JSON.stringify({ status: 'STARTING', mode, providerData: fixtureOnly ? 'explicit test-only adapter' : 'actual USGS network response', activation: 'simulated prior activation using real AppCore clock injection', seed, session, output }));
const first = await run(false);
await writeFile(baselinePath, JSON.stringify(first));
const initialResponses = JSON.parse(await readFile(responsesPath, 'utf8'));
assert(initialResponses.length > 0 && initialResponses.some(response => response.httpStatus === 200), 'No actual or explicit fixture USGS response captured');
// Independently compare retained evidence against the captured upstream feature values.
for (const event of first.initialEvents) {
  const matched = initialResponses.some(response => response.body.features?.some(feature =>
    (feature.id === event.quakeId || String(feature.properties?.ids ?? '').split(',').includes(event.quakeId)) &&
    feature.properties?.mag === event.magnitude && feature.geometry?.coordinates?.[0] === event.lon &&
    feature.geometry?.coordinates?.[1] === event.lat && new Date(feature.properties?.time).toISOString() === event.quakeTime));
  assert(matched, `Saved evidence ${event.id} has no matching captured upstream feature`);
}
const restarted = await run(true);
const restartResponses = JSON.parse(await readFile(responsesPath, 'utf8'));
const sourceAudit = [...initialResponses, ...restartResponses].map(response => ({
  mode: response.mode, requestUrl: response.requestUrl, httpStatus: response.httpStatus, responseDate: response.responseDate,
  receivedAt: response.receivedAt, sourceGeneratedAt: response.body.metadata?.generated ? new Date(response.body.metadata.generated).toISOString() : null,
  featureCount: response.body.features?.length ?? null, payloadSha256: createHash('sha256').update(JSON.stringify(response.body)).digest('hex'),
}));
await writeFile(join(output, `area-watch-${mode}-source-audit.json`), JSON.stringify(sourceAudit, null, 2));
const result = { result: first.result, mode, fixtureOnly, liveProviderVerified: !fixtureOnly,
  simulated: ['prior rule activation clock and local QA area annotations', ...(fixtureOnly ? ['USGS response adapter and event records'] : [])],
  initial: first, restarted, upstreamEvidenceValuesVerified: first.initialEvents.length, sourceAudit, session, output };
await writeFile(join(output, `area-watch-${mode}-summary.json`), JSON.stringify(result, null, 2));
const audit = { ...result, initial: { ...first, initialEvents: first.initialEvents.length, finalEvents: first.finalEvents.length } };
await writeFile(join(output, `area-watch-${mode}-audit.log`), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
process.exitCode = first.result === 'PASS' ? 0 : 2;
