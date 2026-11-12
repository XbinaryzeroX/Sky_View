// Packaged desktop check with the ordinary public aircraft feed and a fresh, isolated profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';
import { installFlightPoseProbe } from './qa-flight-pose.mjs';

const executable = resolve(process.env.ATLAS_FLIGHT_QA_EXE || 'release/win-unpacked/Atlas Watch.exe');
const profile = await mkdtemp(join(tmpdir(), 'atlas-airline-follow-live-'));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX'].includes(key)) delete env[key];
}
env.ATLAS_WATCH_DB = join(profile, 'live-check.sqlite');
const archive = await readFile(join(dirname(executable), 'resources', 'app.asar'));
const report = { startedAt: new Date().toISOString(), archiveSha256: createHash('sha256').update(archive).digest('hex'), result: 'FAIL' };
const { electron } = loadPlaywrightRuntime();
let app, page;
let stage = 'open packaged app';
async function poll(read, timeout) {
  const until = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await delay(500);
  } while (Date.now() < until);
  throw new Error('Timed out during ' + stage);
}
try {
  app = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], env, chromiumSandbox: true });
  assert(await app.evaluate(({ app }, dir) => app.isPackaged && app.getPath('userData').toLowerCase() === dir.toLowerCase(), profile));
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(async () => {
    await window.atlas.updateSettings({ layersEnabled: [], basemap: 'neutral', terrainEnabled: false, buildings3d: false,
      labelsOverlay: false, worldAircraft: false, aircraftPhotos: false, vehicleModels: true, smoothMotion: true });
    window.__atlasDebug.setView(40.65, -73.78, 100000);
  });
  await page.getByRole('textbox', { name: 'Find a layer' }).fill('Aircraft (ADS-B)');
  await page.locator('.layer-row').filter({ hasText: 'Aircraft (ADS-B)' }).getByRole('switch').click();
  stage = 'wait for a fresh public passenger observation';
  const flight = await poll(() => page.evaluate(async () => {
    const snap = (await window.atlas.getLayers()).find(s => s.status.id === 'aircraft');
    const candidate = snap?.records.find(r => /^(AAL|DAL|UAL|JBU|BAW|SWA)\d{1,4}[A-Z]?$/.test(r.props.callsign)
      && !r.props.militaryFlag && !r.props.restrictedTracking && !r.props.snapshot && !r.props.onGround
      && r.source.startsWith('adsb.lol') && r.props.directionSource === 'ground-track'
      && r.speedKts > 100 && r.altM > 1500 && Math.abs(Date.now() - Date.parse(r.observedAt)) < 15000);
    return candidate && { id: candidate.id, label: candidate.label, source: candidate.source, firstReportAt: candidate.observedAt };
  }), 65000);
  report.source = flight.source;
  report.callsign = flight.label;
  report.firstReportAt = flight.firstReportAt;
  stage = 'select flight and click Follow';
  await page.getByRole('button', { name: 'Track a flight', exact: true }).click();
  await page.getByPlaceholder('UAL123, a1b2c3, N123AB').fill(flight.label);
  await page.locator('.rec-item').filter({ hasText: flight.label }).first().click();
  const card = page.getByRole('article', { name: 'Selected flight' });
  await card.getByRole('button', { name: 'Follow', exact: true }).click();
  const controls = page.getByRole('region', { name: 'Tracking camera' });
  await controls.getByText('Following · ' + flight.label, { exact: true }).waitFor();
  stage = 'measure the displayed aircraft and camera';
  await page.evaluate(installFlightPoseProbe, flight.id);
  await page.waitForFunction(() => window.__qaFlightPose?.read()?.centerErrorPx < 15);
  const since = await page.evaluate(() => window.__qaFlightPose.mark());
  await delay(5000);
  const frames = await page.evaluate(start => window.__qaFlightPose.frames(start), since);
  assert(frames.length >= 4, 'too few rendered samples');
  const distance = (a, b, prefix = '') => Math.hypot(...['x', 'y', 'z'].map(k => a[prefix + k] - b[prefix + k]));
  const first = frames[0], last = frames.at(-1);
  const moved = frames.slice(1).filter((frame, i) => distance(frame, frames[i]) > 0.1);
  report.motion = { seconds: (last.time - first.time) / 1000, renderedFrames: frames.length, movingFrames: moved.length,
    aircraftMetres: Math.round(distance(first, last)), cameraMetres: Math.round(distance(first, last, 'c')),
    maxCenterErrorPx: Math.max(...frames.map(f => f.centerErrorPx)), drawnAs: [...new Set(frames.map(f => f.kind))] };
  assert(report.motion.aircraftMetres > 100 && report.motion.cameraMetres > 100, 'plane and camera must both move');
  assert(report.motion.maxCenterErrorPx < 15 && moved.length >= frames.length / 2, 'aircraft should advance smoothly and stay centered');
  stage = 'wait for the next source observation';
  report.nextReportAt = await poll(() => page.evaluate(async ({ id, firstReportAt }) => {
    const layers = await window.atlas.getLayers();
    const r = layers.find(s => s.status.id === 'aircraft')?.records.find(r => r.id === id);
    return r?.observedAt > firstReportAt && r.observedAt;
  }, flight), 55000);
  await delay(1500);
  const after = await page.evaluate(() => window.__qaFlightPose.read());
  assert(after && after.centerErrorPx < 15, 'camera lost flight on the next report');
  await controls.getByRole('button', { name: 'Stop tracking' }).click();
  await controls.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  report.result = 'PASS';
} catch (error) {
  report.failure = { stage, message: error.message };
  if (page) report.provider = await page.evaluate(async () => {
    const status = (await window.atlas.getLayers()).find(s => s.status.id === 'aircraft')?.status;
    return status && { state: status.state, lastSuccessAt: status.lastSuccessAt, note: status.note, error: status.error };
  }).catch(() => null);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const log = JSON.stringify(report, null, 2) + '\n';
  console.log(log);
  await writeFile(resolve('docs/flight-follow-live.log'), log);
}
