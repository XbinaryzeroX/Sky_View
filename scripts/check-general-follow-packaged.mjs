// Drive the ordinary UI with two controlled general-aviation position reports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installFlightPoseProbe } from './qa-flight-pose.mjs';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { electron } = loadPlaywrightRuntime();
const executable = resolve(process.env.ATLAS_FLIGHT_QA_EXE ?? join(root, 'release/win-unpacked/Atlas Watch.exe'));
const baseline = process.argv.includes('--baseline');
const temp = await mkdtemp(join(tmpdir(), 'atlas-follow-'));
const profile = join(temp, 'profile');
const database = join(temp, 'fixture.sqlite');
const seed = join(temp, 'seed.cjs');
const log = resolve(root, process.env.ATLAS_FLIGHT_QA_LOG ?? (baseline ? 'docs/flight-follow-before.log' : 'docs/flight-follow-packaged-audit.log'));
const archive = await readFile(join(dirname(executable), 'resources/app.asar'));
const report = { result: 'FAIL', baseline, startedAt: new Date().toISOString(), executable,
  archiveSha256: createHash('sha256').update(archive).digest('hex'),
  source: 'Two synthetic general-aviation ADS-B observations in an isolated profile. Production rendering, selection, provider adapter and tracking. No subscription or external aircraft source is used.', errors: [] };
await mkdir(profile);
await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
  import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
  const store = new AtlasStore(${JSON.stringify(database)});
  store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,buildings3d:false,labelsOverlay:false,
    worldAircraft:false,layersEnabled:[],aircraftPhotos:false,smoothMotion:true,vehicleModels:true,
    zoneLookupEnabled:false,reducedMotion:true,nwsPollSeconds:3600,usgsPollSeconds:3600});
  store.close();` }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: seed, logLevel: 'silent' });
execFileSync(process.execPath, [seed], { cwd: root, stdio: 'pipe' });
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX'].includes(key) || key.startsWith('ATLAS_WATCH_')) delete env[key];
}
env.ATLAS_WATCH_DB = database;

const aircraft = { hex: 'aaaa01', flight: 'N123AB', r: 'N123AB', t: 'C172', category: 'A1',
  lat: 50.38, lon: -4.16, alt_baro: 5200, gs: 220, baro_rate: 0, track: 90, seen_pos: 0 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const cameraTravel = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy, a.cz - b.cz);
const round = x => Math.round(x * 100) / 100;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, description, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const value = await read(); if (value) return value; await delay(100); } while (Date.now() < end);
  throw new Error('Timeout waiting for ' + description);
}
function summarize(frames) {
  assert(frames.length >= 2, 'At least two real Cesium renders expected');
  const first = frames[0], last = frames.at(-1);
  const moving = [];
  let previous = first;
  for (const frame of frames.slice(1)) {
    const meters = distance(previous, frame);
    if (meters > 0.05) {
      const seconds = (frame.time - previous.time) / 1000;
      moving.push({ meters, seconds, speed: meters / seconds });
      previous = frame;
    }
  }
  return { frames: frames.length, changedPoses: moving.length, elapsedSec: round((last.time - first.time) / 1000),
    planeTravelM: round(distance(first, last)), cameraTravelM: round(cameraTravel(first, last)),
    peakStepM: round(Math.max(0, ...moving.map(s => s.meters))),
    maxReportedFrameGapMs: round(Math.max(0, ...frames.slice(1).map((f, i) => f.time - frames[i].time))),
    maxCenterErrorPixels: round(Math.max(...frames.map(f => f.centerErrorPx))),
    kinds: [...new Set(frames.map(f => f.kind))] };
}
function checkFollowing(summary, multiReport = false) {
  assert(summary.planeTravelM >= 120, 'The aircraft did not move far enough between reports');
  assert(summary.changedPoses >= 6 && summary.changedPoses / summary.elapsedSec >= 3, 'The aircraft moved in discrete polling steps');
  assert(Math.abs(summary.cameraTravelM - summary.planeTravelM) < 35, 'Camera displacement did not match the moving plane');
  assert(summary.maxCenterErrorPixels < 12, 'The actual rendered aircraft left the Follow camera center');
  if (multiReport) {
    // A deliberate 440 m correction must not be applied in one frame. Allow the flown distance
    // during a slow machine's measured frame gap in addition to normal correction movement.
    assert(summary.peakStepM < 65 + summary.maxReportedFrameGapMs * 0.26, 'The second report teleported the aircraft');
  }
}
let app, page;
let stage = 'start packaged app';
try {
  app = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], chromiumSandbox: true, env, cwd: dirname(executable) });
  await app.evaluate(({ app, BrowserWindow }, setup) => {
    if (!app.isPackaged || app.getPath('userData').toLowerCase() !== setup.profile.toLowerCase()) throw new Error('Wrong profile or binary');
    for (const win of BrowserWindow.getAllWindows()) {
      const p = win.webContents.getLastWebPreferences();
      if (!p.contextIsolation || !p.sandbox || p.nodeIntegration) throw new Error('Renderer isolation disabled');
    }
    const state = globalThis.__qaFlightSource = { firstAt: 0, second: false, secondAt: 0, requests: 0, secondReports: 0 };
    globalThis.fetch = async input => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url.hostname === 'api.adsb.lol' && url.pathname.startsWith('/v2/point/')) {
        state.requests++;
        state.firstAt ||= Date.now();
        const ac = { ...setup.aircraft };
        let at = state.firstAt;
        if (state.second) {
          state.secondAt ||= Date.now();
          at = state.secondAt;
          const elapsed = (at - state.firstAt) / 1000;
          ac.lon += elapsed * ac.gs * 0.514444 / (111320 * Math.cos(ac.lat * Math.PI / 180));
          ac.lat += 440 / 111320;
          state.secondReports++;
        }
        return json({ now: at, ac: [ac] });
      }
      return json({ type: 'FeatureCollection', features: [] });
    };
  }, { profile, aircraft });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route(/^https?:\/\//, route => route.abort());
  await until(() => page.evaluate(() => window.__atlasDebug?.diag()?.globeShown), 'globe ready');
  await page.evaluate(a => window.__atlasDebug.setView(a.lat, a.lon, 20000), aircraft);
  await page.getByRole('textbox', { name: 'Find a layer' }).fill('Aircraft (ADS-B)');
  await page.locator('.layer-row').filter({ hasText: 'Aircraft (ADS-B)' }).getByRole('switch').click();
  await until(() => page.evaluate(() => window.__atlasDebug.records('aircraft').find(r => r.id === 'aaaa01')), 'provider fixture in actual layer');
  await page.evaluate(installFlightPoseProbe, aircraft.hex);
  const pose = () => page.evaluate(() => window.__qaFlightPose.read());
  const sampleStart = () => page.evaluate(() => window.__qaFlightPose.mark());
  const samples = since => page.evaluate(t => window.__qaFlightPose.frames(t), since);
  const controls = page.getByRole('region', {name:'Tracking camera'});
  stage = 'select general aviation aircraft and click Track';
  await page.evaluate(() => window.__atlasDebug.select('aircraft','aaaa01'));
  await page.locator('.details').getByRole('button',{name:'Track',exact:true}).click();
  await controls.getByText(/Following.*N123AB/).waitFor();
  await delay(1000);
  const firstAt=await sampleStart();
  await delay(2500);
  report.first=summarize(await samples(firstAt));
  checkFollowing(report.first);
  stage='smooth a subsequent report';
  const secondAt=await sampleStart();
  await app.evaluate(()=>{globalThis.__qaFlightSource.second=true;});
  await page.evaluate(()=>window.atlas.refreshLayer('aircraft'));
  await until(()=>page.evaluate(lat=>window.__atlasDebug.records('aircraft')[0]?.lat>lat+.0035,aircraft.lat),'updated fix');
  await delay(5000);
  report.second=summarize(await samples(secondAt));
  checkFollowing(report.second,true);
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
} catch (error) {
  report.failure={stage,message:error.message};
} finally {
  if(app)await app.close();
  report.finishedAt=new Date().toISOString();
  await writeFile(log,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.result!=='PASS')process.exitCode=1;
}
