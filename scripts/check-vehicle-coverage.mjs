// Exercise real Cesium globe picks and rotating previews in a packaged app and a disposable profile.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.env.ATLAS_FLIGHT_QA_EXE || 'release/flight-card/win-unpacked/Atlas Watch.exe');
const profile = await mkdtemp(join(tmpdir(), 'atlas-vehicle-models-'));
const screenshots = resolve('docs/screenshots/vehicle-coverage');
await mkdir(screenshots, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX'].includes(key)) delete env[key];
}
env.ATLAS_WATCH_DB = join(profile, 'qa.sqlite');
const live = process.argv.includes('--live');
const report = { startedAt: new Date().toISOString(), result: 'FAIL', source: live ? 'Live public Fintraffic AIS' : 'Controlled aircraft and AIS replies',
  archiveSha256: digest(await readFile(join(dirname(exe), 'resources/app.asar'))), checks: [], errors: [] };
const planes = [
  { hex: 'aaaa01', flight: 'FIXEXACT', t: 'EC35', lat: 43.03, lon: 4.11, category: 'A7' },
  { hex: 'aaaa02', flight: 'FIXROTOR', t: 'ZZZZ', lat: 43.19, lon: 4.32, category: 'A7' },
  { hex: 'aaaa03', flight: 'FIXUNKN', lat: 43.37, lon: 4.53 },
].map(p => ({ ...p, alt_baro: 1200, gs: 0, track: 90, seen_pos: 0 }));
const ships = [
  { mmsi: 111000001, name: 'QA TANKER', shipType: 80, lat: 58.41, lon: 19.1 },
  { mmsi: 111000002, name: 'QA CARGO', shipType: 70, lat: 58.59, lon: 19.8 },
  { mmsi: 111000003, name: 'QA OTHER', shipType: 0, lat: 58.81, lon: 20.3 },
].map(s => ({ ...s, referencePointA: 120, referencePointB: 36, referencePointC: 12, referencePointD: 12 }));
async function waitFor(fn, name, timeout = 25000) {
  const until = Date.now() + timeout;
  do { const v = await fn(); if (v) return v; await delay(120); } while (Date.now() < until);
  throw new Error('Timed out waiting for ' + name);
}
let app, page, stage = 'open app';
try {
  const { electron } = loadPlaywrightRuntime();
  app = await electron.launch({ executablePath: exe, args: ['--user-data-dir=' + profile], env, chromiumSandbox: true });
  assert(await app.evaluate(({ app }, dir) => app.isPackaged && app.getPath('userData').toLowerCase() === dir.toLowerCase(), profile));
  if (!live) await app.evaluate((_, { planes, ships }) => {
    globalThis.fetch = async input => {
      const u = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      let body = { type: 'FeatureCollection', features: [] };
      if (u.host === 'api.adsb.lol' && u.pathname.startsWith('/v2/point/')) body = { now: Date.now(), ac: planes };
      if (u.host === 'meri.digitraffic.fi' && u.pathname.endsWith('/vessels')) body = ships;
      if (u.host === 'meri.digitraffic.fi' && u.pathname.endsWith('/locations')) body = { dataUpdatedTime: new Date().toISOString(), features: ships.map(s => ({
        mmsi: s.mmsi, geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { sog: 0, heading: 0, timestampExternal: Date.now() } })) };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { planes, ships });
  page = await app.firstWindow();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(() => window.atlas.updateSettings({ layersEnabled: [], basemap: 'neutral', terrainEnabled: false,
    buildings3d: false, smoothMotion: false, aircraftPhotos: false, reducedMotion: true, vehicleModels: true }));
  const readRecords = layer => page.evaluate(l => window.__atlasDebug.records(l), layer);
  async function enable(name) {
    await page.getByRole('textbox', { name: 'Find a layer' }).fill(name);
    await page.locator('.layer-row').filter({ hasText: name }).getByRole('switch').click();
  }
  async function pick(point, expected, slug, verifyRotation) {
    stage = 'select ' + slug;
    await page.evaluate(p => window.__atlasDebug.setView(p.lat, p.lon, 2600), point);
    await waitFor(async () => {
      const c = await page.evaluate(() => window.__atlasDebug.camera());
      return c && Math.abs(c.lat - point.lat) < .00005 && Math.abs(c.lon - point.lon) < .00005;
    }, 'camera focus');
    await delay(500);
    const canvas = page.locator('section.center > .globe-wrap .cesium-widget canvas').first();
    const bounds = await (await canvas.count() ? canvas : page.locator('.cesium-widget canvas').first()).boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const pane = page.locator('.data-panel');
    const preview = pane.locator('.flight-preview');
    const rotate = preview.getByRole('button', { name: 'Rotate model right' });
    await rotate.waitFor();
    const caption = await pane.locator('.flight-visual .flight-credit').first().innerText();
    assert.match(caption, expected);
    await preview.scrollIntoViewIfNeeded();
    const before = digest(await preview.locator('canvas').screenshot());
    await preview.screenshot({ path: join(screenshots, (live ? 'live-' : 'controlled-') + slug + '.png') });
    if (verifyRotation) {
      await rotate.click();
      await waitFor(async () => digest(await preview.locator('canvas').screenshot()) !== before, 'visible rotation');
    }
    report.checks.push({ case: slug, caption, rotationTested: verifyRotation });
    await pane.getByRole('button', { name: /^Close (Flight details|Data)$/ }).click();
  }
  if (!live) {
    await enable('Aircraft (ADS-B)');
    await waitFor(async () => (await readRecords('aircraft')).length === planes.length, 'aircraft fixtures');
    await pick(planes[0], /Sketchfab/, 'ec135', true);
    await pick(planes[1], /Representative 3D shape.*Helicopter/i, 'rotorcraft', true);
    await pick(planes[2], /Representative 3D shape/i, 'unidentified-aircraft', false);
  }
  await enable('Vessels (AIS)');
  const data = await waitFor(async () => {
    const loaded = await readRecords('vessels');
    return loaded.some(s => s.shipType >= 80 && s.shipType <= 89) && loaded;
  }, 'Fintraffic tanker', live ? 60000 : 20000);
  await pick(data.find(s => s.shipType >= 80 && s.shipType <= 89), /Representative vessel model.*Sketchfab/, 'tanker', true);
  await pick(data.find(s => s.shipType >= 70 && s.shipType <= 79), /Representative vessel model.*Sketchfab/, 'cargo', true);
  if (!live) await pick(ships[2], /Representative 3D shape/, 'unidentified-vessel', false);
  assert.equal(await page.evaluate(() => window.__atlasDebug.diag().renderErrors), 0);
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.failure = { stage, message: error.message };
  if (page) await page.screenshot({ path: join(profile, 'failure.png') }).catch(() => {});
  console.error('Test profile:', profile);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(resolve('docs/vehicle-coverage-' + (live ? 'live' : 'packaged') + '.log'), json);
  console.log(json);
}
