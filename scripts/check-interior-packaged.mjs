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
const log = resolve(root, process.env.ATLAS_FLIGHT_QA_LOG ?? 'docs/aircraft-interior-audit.log');
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
  stage='cockpit view and drag';
  let modelLoadStart = Date.now();
  await controls.getByRole('button', {name:'Cockpit',exact:true}).click();
  await controls.getByText(/Cockpit view/).waitFor();
  const canvas = page.locator('.globe .cesium-widget canvas');
  const box = await canvas.boundingBox();
  const interiorState = () => page.evaluate(() => {
    const canvas = document.querySelector('.globe .cesium-widget canvas');
    for (let el = canvas; el; el = el.parentElement) {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      for (let fiber = key && el[key]; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const widget = hook.memoizedState?.current;
          if (!widget?.scene?.postRender || widget.canvas !== canvas) continue;
          const primitives = widget.scene.primitives;
          for (let i = 0; i < primitives.length; i++) {
            const p = primitives.get(i), id = p.geometryInstances?.[0]?.id;
            if (typeof id !== 'string' || !id.startsWith('interior|')) continue;
            const m = p.modelMatrix, local = id.includes('cockpit') ? [4.5, 0, .75] : [0, -3.35, 1.42];
            const pt = {x:m[0]*local[0]+m[4]*local[1]+m[8]*local[2]+m[12], y:m[1]*local[0]+m[5]*local[1]+m[9]*local[2]+m[13], z:m[2]*local[0]+m[6]*local[1]+m[10]*local[2]+m[14]};
            const screen = widget.scene.cartesianToCanvasCoordinates(pt);
            let supplied = null;
            for (let j = 0; j < primitives.length; j++) { const candidate = primitives.get(j); if (typeof candidate.id === 'string' && candidate.id.startsWith('interior-model|')) supplied = { id: candidate.id, ready: candidate.ready, backFaceCulling: candidate.backFaceCulling }; }
            const camera = widget.camera.positionWC;
            return { id, supplied, camera: [camera.x,camera.y,camera.z], offset: [camera.x-m[12],camera.y-m[13],camera.z-m[14]], heading: widget.camera.heading, rotation: [m[0],m[1],m[2],m[4],m[5],m[6],m[8],m[9],m[10]], screen: screen ? [screen.x,screen.y] : null };
          }
        }
      }
    }
    return null;
  });
  async function checkInterior(mode) {
    const found = await until(interiorState, mode + ' 3D geometry');
    assert(found.id.startsWith('interior|' + mode));
    await until(async () => { const state = await interiorState(); return state?.supplied?.id === 'interior-model|' + mode && state.supplied.ready; }, mode + ' supplied model ready', 60000);
    report[mode + 'GeometryMs'] = Date.now() - modelLoadStart;
    await until(() => controls.getByText(/Loading (757 cockpit|passenger cabin) model/).count().then(n => n === 0), mode + ' textured status', 60000);
    report[mode + 'LoadMs'] = Date.now() - modelLoadStart;
    const before = await interiorState();
    assert.equal(before.supplied.backFaceCulling, false, 'Interior faces must render from inside');
    await page.screenshot({path: join(root, 'tmp', 'cabin3d-' + mode + '.png')});
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * .55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .68, box.y + box.height * .6, {steps: 5});
    await page.mouse.up();
    await delay(200);
    const after = await interiorState();
    assert(Math.abs(Math.atan2(Math.sin(after.heading-before.heading), Math.cos(after.heading-before.heading))) > .1, 'Camera did not turn');
    assert(before.rotation.every((v,i) => Math.abs(v-after.rotation[i]) < .0001), 'The cabin rotated with the camera');
    assert(before.screen && after.screen && Math.hypot(before.screen[0]-after.screen[0],before.screen[1]-after.screen[1]) > 10, 'The cabin stayed fixed on screen');
    await page.screenshot({path: join(temp, mode + '.png')});
    return {before,after};
  }
  report.cockpit = await checkInterior('cockpit');
  stage='passenger view and escape';
  modelLoadStart = Date.now();
  await controls.getByRole('button', {name:'Passenger',exact:true}).click();
  await controls.getByText(/Passenger view/).waitFor();
  report.passenger = await checkInterior('passenger');
  const seatBefore = await interiorState();
  await page.getByRole('button', {name:'Seat 4A'}).click();
  await delay(300);
  const seatAfter = await interiorState();
  assert(Math.hypot(...seatBefore.offset.map((v,i)=>v-seatAfter.offset[i])) > .5, 'Selecting a seat did not move the camera within the aircraft');
  assert.equal(await page.getByRole('button', {name:'Seat 4A'}).getAttribute('aria-pressed'), 'true');
  await page.screenshot({path: join(root, 'tmp', 'cabin3d-seat-4A.png')});
  await page.keyboard.press('Escape');
  await controls.getByText(/Following.*N123AB/).waitFor();
  assert.equal(await interiorState(), null);
  report.interiors = 'Both 3D cabins stayed in the aircraft frame while changing position on screen as the camera turned; Escape removed the geometry. Synthetic flight only.';
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
