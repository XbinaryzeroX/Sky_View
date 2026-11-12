// Test-only source replies, an isolated profile, and real pointer input on the packaged globe.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { electron, version } = loadPlaywrightRuntime();
const temp = await mkdtemp(join(tmpdir(), 'atlas-flight-card-'));
const profile = join(temp, 'profile');
const database = join(temp, 'qa.sqlite');
const executable = process.env.ATLAS_FLIGHT_QA_EXE
  ? resolve(process.env.ATLAS_FLIGHT_QA_EXE) : join(root, 'release/win-unpacked/Atlas Watch.exe');
const archive = join(dirname(executable), 'resources/app.asar');
const output = join(root, 'docs/screenshots/flight-card');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = digest(await readFile(archive));
await mkdir(profile);
await mkdir(output, { recursive: true });

// These ICAO addresses, registrations, positions, times and aircraft assignments are fixtures.
// BAW117 is an actual entry in the separately published standing route catalog.
const records = [
  { hex: 'aaaa01', flight: 'BAW117', lat: 50.38, lon: -4.16, t: 'A20N', r: 'G-QAAA', year: '2018', ownOp: 'QA fixture airline', category: 'A3' },
  { hex: 'aaaa02', flight: 'ANE1234', lat: 50.5, lon: -3.55, t: 'CRJX', r: 'EC-QAA', year: '2012', ownOp: 'QA fixture airline', category: 'A3' },
  { hex: 'aaaa03', lat: 50.15, lon: -4.6 },
].map(r => ({ alt_baro: 5200, gs: 220, baro_rate: 300, track: 90, seen_pos: 0, ...r }));
const nowMinute = Math.floor(Date.now() / 60000) * 60000;
const fixtureTime = offset => new Date(nowMinute + offset * 60000).toISOString();
const syntheticKey = 'QA_ONLY_NO_AERODATABOX_SUBSCRIPTION';
function movement(icao, iata, city, lat, lon, scheduled, revised, terminal, gate) {
  return { airport: { icao, iata, name: city + ' fixture airport', municipalityName: city, location: { lat, lon } },
    scheduledTime: { utc: fixtureTime(scheduled) }, revisedTime: { utc: fixtureTime(revised) },
    terminal, gate, quality: ['Live'] };
}
const dated = {
  BAW117: { callSign: 'BAW117', number: 'BA117', codeshareStatus: 'IsOperator', isCargo: false, status: 'EnRoute',
    airline: { icao: 'BAW', iata: 'BA', name: 'British Airways' }, aircraft: { modeS: 'aaaa01', reg: 'G-QAAA' },
    departure: movement('EGLL', 'LHR', 'London', 51.47, -0.45, -100, -55, '5', 'B42'),
    arrival: { ...movement('KEWR', 'EWR', 'Newark', 40.69, -74.17, 160, 190, 'B', 'B09'), predictedTime: { utc: fixtureTime(195) } }, lastUpdatedUtc: fixtureTime(-1) },
  ANE1234: { callSign: 'ANE1234', number: 'YW1234', codeshareStatus: 'IsOperator', isCargo: false, status: 'Diverted',
    airline: { icao: 'ANE', iata: 'YW', name: 'Air Nostrum' }, aircraft: { modeS: 'aaaa02', reg: 'EC-QAA' },
    departure: movement('LEMD', 'MAD', 'Madrid', 40.47, -3.56, -100, -80, '4', 'J08'),
    arrival: movement('LFBO', 'TLS', 'Toulouse', 43.63, 1.36, 40, 90, 'A', 'R02'), lastUpdatedUtc: fixtureTime(-2) },
};
const seed = join(temp, 'seed.cjs');
await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
  import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
  const store = new AtlasStore(${JSON.stringify(database)});
  store.saveSettings({ ...store.getSettings(), basemap:'neutral', terrainEnabled:false, buildings3d:false,
    labelsOverlay:false, layersEnabled:[], aircraftPhotos:true, smoothMotion:false, vehicleModels:true,
    zoneLookupEnabled:false, reducedMotion:true, nwsPollSeconds:3600, usgsPollSeconds:3600 });
  store.close();` }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: seed, logLevel: 'silent' });
execFileSync(process.execPath, [seed], { cwd: root, stdio: 'pipe' });
const env = { ...process.env, ATLAS_WATCH_DB: database };
for (const key of Object.keys(env)) {
  if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX'].includes(key)
      || key.startsWith('ATLAS_WATCH_') && key !== 'ATLAS_WATCH_DB') delete env[key];
}
const report = { result: 'FAIL', startedAt: new Date().toISOString(), archiveSha256: sha, framework: version,
  source: 'Synthetic aircraft reports, registry replies and dated schedules in an isolated app. Standing route and packaged visual assets are the production copies. No paid provider was contacted.',
  executable, profile, checks: [], screenshots: [], errors: [] };
let app, page;
let stage = 'launch';
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitFor(read, name, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const value = await read(); if (value) return value; await sleep(90); } while (Date.now() < end);
  throw new Error('Timed out waiting for ' + name);
}
async function shot(name) {
  const path = join(output, 'controlled-' + name + '.png');
  await page.screenshot({ path });
  report.screenshots.push(path);
}
async function pick(record, height = 60000) {
  await page.evaluate(({ lat, lon, height }) => window.__atlasDebug.setView(lat, lon, height), { ...record, height });
  await waitFor(async () => {
    const c = await page.evaluate(() => window.__atlasDebug.camera());
    return c && Math.abs(c.lat - record.lat) < 0.00005 && Math.abs(c.lon - record.lon) < 0.00005;
  }, 'globe camera on fixture');
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const bounds = await page.locator('.cesium-widget canvas').first().boundingBox();
  assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const card = page.getByRole('article', { name: 'Selected flight' });
  await card.waitFor();
  if (record.r) await card.getByText(record.r, { exact: true }).first().waitFor();
  return card;
}
const routeLegs = () => page.evaluate(() => window.__atlasDebug.diag()?.routeLegCount);
const datedCount = () => app.evaluate(() => globalThis.__flightQa.datedRequests.length);
async function setStatusCredential(value) {
  const dialog = page.getByRole('dialog', { name: 'Provider settings' });
  if (!await dialog.isVisible()) await page.getByRole('button', { name: 'Providers', exact: true }).click();
  const provider = dialog.locator('section.provider').filter({ has: page.getByText('AeroDataBox', { exact: true }) });
  if (value !== null) {
    await provider.locator('input.cred-input').fill(value);
    await provider.getByRole('button', { name: 'Save', exact: true }).click();
  } else await provider.getByRole('button', { name: 'Remove', exact: true }).click();
  await waitFor(() => page.evaluate(enabled => window.atlas.listProviders().then(items =>
    items.find(p => p.id === 'aerodatabox')?.userConfigured === enabled), value !== null), 'temporary profile credential change');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
try {
  app = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], chromiumSandbox: true, env, cwd: dirname(executable) });
  await app.evaluate(({ app, BrowserWindow }, config) => {
    if (!app.isPackaged || app.getPath('userData').toLowerCase() !== config.profile.toLowerCase()) throw new Error('Wrong packaged app or profile');
    for (const window of BrowserWindow.getAllWindows()) {
      const prefs = window.webContents.getLastWebPreferences();
      if (!prefs.contextIsolation || !prefs.sandbox || prefs.nodeIntegration || !prefs.webSecurity) throw new Error('Unexpected browser options');
    }
    globalThis.__flightQa = { counts: {}, paidRequestsBlocked: 0, datedRequests: [] };
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      const state = globalThis.__flightQa;
      const key = url.host + url.pathname;
      state.counts[key] = (state.counts[key] ?? 0) + 1;
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.hostname === 'api.aerodatabox.com') {
        const name = url.pathname.split('/').pop();
        const expected = '/flights/callsign/' + name + '?withAircraftImage=false&withLocation=false&withFlightPlan=false';
        const sameKey = new Headers(options?.headers).get('X-Api-Key') === config.syntheticKey;
        state.datedRequests.push({ endpoint: url.pathname + url.search, testKeyReceived: sameKey, realProviderContacted: false });
        const f = config.dated[name];
        if (!f || url.pathname + url.search !== expected || !sameKey) return json([], 403);
        return json([{ ...f, aircraft: { ...f.aircraft, modeS: 'aaaa09' }, number: f.airline.iata + '99' }, f]);
      }
      if (url.hostname === 'api.adsb.lol' && url.pathname.startsWith('/v2/point/')) return json({ now: Date.now(), ac: config.records });
      if (url.hostname === 'api.adsbdb.com') {
        const record = config.records.find(r => r.hex === url.pathname.split('/').pop());
        if (!record?.t) return json({ response: 'unknown aircraft' }, 404);
        const isAirbus = record.t === 'A20N';
        return json({ response: { aircraft: { type: isAirbus ? 'A320 251N' : 'CRJ 1000 NG', icao_type: record.t,
          mode_s: record.hex, manufacturer: isAirbus ? 'Airbus' : 'Bombardier', registration: record.r, registered_owner: record.ownOp } } });
      }
      if (url.hostname === 'commons.wikimedia.org') return json({ query: { pages: {} } });
      if (url.hostname === 'airport-data.com') return json({ data: [] });
      if (url.hostname.endsWith('googleapis.com')) state.paidRequestsBlocked++;
      return json({ type: 'FeatureCollection', features: [] });
    };
  }, { profile, records, dated, syntheticKey });
  page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.route(/^https?:\/\//, route => route.abort());
  const glb = [];
  page.on('response', r => { if (/\.glb(?:\?|$)/i.test(r.url())) glb.push({ url: r.url(), status: r.status() }); });
  // Listen to Cesium's actual native loader. Custom app:// responses are not always surfaced by CDP.
  await page.evaluate(() => {
    window.__flightQaGlb = [];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...options) {
      const resolved = new URL(url, document.baseURI);
      if (resolved.href === 'app://atlas/vehicle-models/a320.glb') this.addEventListener('load', async () => {
        const bytes = this.response;
        if (!(bytes instanceof ArrayBuffer)) return;
        const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        window.__flightQaGlb.push({ url: resolved.href, status: this.status, bytes: bytes.byteLength,
          sha256: Array.from(sum, n => n.toString(16).padStart(2, '0')).join('') });
      }, { once: true });
      return open.call(this, method, url, ...options);
    };
  });
  stage = 'ordinary layer enable';
  await waitFor(() => page.evaluate(() => window.__atlasDebug?.diag()?.globeShown), 'Globe ready');
  const closeUp = 2000;
  await page.evaluate(({lat, lon, height}) => window.__atlasDebug.setView(lat, lon, height), { ...records[0], height: closeUp });
  const layerFilter = page.getByRole('textbox', { name: 'Find a layer' });
  await layerFilter.fill('Aircraft (ADS-B)');
  await page.locator('.layer-row').filter({ hasText: 'Aircraft (ADS-B)' }).getByRole('switch').click();
  await waitFor(async () => (await page.evaluate(() => window.__atlasDebug.records('aircraft'))).length === 3, 'three fixture records in normal aircraft layer');
  stage = 'A320neo globe model before selection';
  report.globeModel = await waitFor(() => page.evaluate(() => {
    const stats = window.__atlasDebug.diag()?.models, resource = window.__flightQaGlb[0];
    if (!stats || stats.shown !== 1 || !resource) return null;
    return { ...resource, shown: stats.shown, loaded: stats.loaded, failed: stats.failed, pack: stats.pack.state };
  }), 'the isolated A320neo globe primitive processes its packed Sketchfab GLB', 25000);
  assert.equal(report.globeModel.status, 200);
  assert.equal(report.globeModel.failed, 0);
  assert.equal(report.globeModel.pack, 'ready');
  assert.equal(report.globeModel.sha256, digest(await readFile(join(root, 'public/vehicle-models/a320.glb'))));
  assert.equal(await page.getByRole('article', { name: 'Selected flight' }).count(), 0);
  await shot('a320neo-globe-model');
  stage = 'A320neo map pick, route and model preview';
  const airbus = await pick(records[0], closeUp);
  await airbus.getByRole('heading', { name: /London.*to.*New York/i }).waitFor();
  await airbus.getByRole('heading', { name: /Airbus A320-251N/i }).waitFor();
  report.checks.push('A20N loaded the verified a320.glb into the globe before selection; exactly one globe model shown and clicking it opened its own flight');
  await waitFor(async () => await routeLegs() === 1, 'dashed route entity');
  const scrollTop = () => page.locator('.data-panel .floating-panel-body').evaluate(n => n.scrollTop);
  assert.equal(await scrollTop(), 0, 'Flight card opened below the top');
  assert.match(await airbus.innerText(), /2018 · about \d+ years old/);
  assert.match(await airbus.innerText(), /British Airways/i);
  assert.match(await airbus.innerText(), /LHR/);
  assert.match(await airbus.innerText(), /JFK/);
  const rotate = airbus.getByRole('button', { name: 'Rotate model right' });
  await rotate.waitFor({ timeout: 25000 });
  const canvas = airbus.locator('.flight-preview-canvas canvas');
  const initialPreview = digest(await canvas.screenshot());
  await rotate.click();
  await page.mouse.move(12, 12);
  await waitFor(async () => digest(await canvas.screenshot()) !== initialPreview, 'rendered model changes after rotation');
  const localModel = await page.evaluate(async () => {
    const base = new URL('vehicle-models/', document.baseURI);
    const index = await (await fetch(new URL('index.json', base))).json();
    const model = index.models.find(m => m.kind === 'aircraft' && m.icao?.includes('A20N'));
    const url = new URL(model.file, base).href;
    const reply = await fetch(url);
    const bytes = await reply.arrayBuffer();
    return { url, asset: model.file, title: model.title, source: model.sourceUrl, bytes: bytes.byteLength, status: reply.status,
      magic: String.fromCharCode(...new Uint8Array(bytes, 0, 4)),
      digest: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('') };
  });
  assert(localModel.url.startsWith('app://atlas/vehicle-models/') && localModel.status === 200 && localModel.magic === 'glTF');
  assert.equal(localModel.digest, digest(await readFile(join(root, 'public/vehicle-models', localModel.asset))));
  await shot('a320neo-3d');
  await airbus.getByRole('button', { name: 'Photo', exact: true }).click();
  assert(await airbus.getByRole('img', { name: /Lufthansa A320neo/ }).evaluate(img => img.complete && img.naturalWidth > 0));
  await shot('a320neo-photo');
  await airbus.getByRole('button', { name: '3D', exact: true }).click();
  await rotate.waitFor();
  report.checks.push('Real map pick, registry variant, route header and endpoints, build year, local GLB load, rotation and photo toggle');
  report.model = { ...localModel, observedBrowserResponses: glb };
  const specs = airbus.getByRole('region', { name: 'Aircraft type specifications' });
  await specs.scrollIntoViewIfNeeded();
  assert.match(await specs.innerText(), /Wingspan|Span with winglets/);
  assert.match(await specs.innerText(), /150–180/);
  await shot('a320neo-specifications');
  stage = 'explicit dated status for selected flight';
  const statusPanel = airbus.getByRole('region', { name: 'Dated flight status' });
  await statusPanel.getByRole('button', { name: 'Set up flight status in Providers' }).click();
  assert.equal(await datedCount(), 0);
  await setStatusCredential(syntheticKey);
  const statusClick = statusPanel.getByRole('button', { name: 'Check dated flight status', exact: true });
  await statusClick.waitFor();
  assert.equal(await datedCount(), 0);
  await statusClick.click();
  await statusPanel.getByText('BA117 · En route', { exact: true }).waitFor();
  await airbus.getByRole('heading', { name: /London.*to.*Newark/i }).waitFor();
  const departure = statusPanel.getByRole('region', { name: 'Departure', exact: true });
  const arrival = statusPanel.getByRole('region', { name: 'Arrival', exact: true });
  const rows = async section => Object.fromEntries(await section.locator('dl > div').evaluateAll(items =>
    items.map(n => [n.querySelector('dt').textContent, n.querySelector('dd').textContent])));
  const dep = await rows(departure), arr = await rows(arrival);
  const displayTime = iso => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  assert.equal(dep.Scheduled, displayTime(dated.BAW117.departure.scheduledTime.utc));
  assert.equal(dep.Actual, displayTime(dated.BAW117.departure.revisedTime.utc) + ' · 45 min late');
  assert.equal(dep.Terminal, '5'); assert.equal(dep.Gate, 'B42');
  assert.equal(arr.Scheduled, displayTime(dated.BAW117.arrival.scheduledTime.utc));
  assert.equal(arr.Estimated, displayTime(dated.BAW117.arrival.revisedTime.utc) + ' · 30 min late');
  assert.equal(arr.Predicted, displayTime(dated.BAW117.arrival.predictedTime.utc));
  assert.equal(arr.Terminal, 'B'); assert.equal(arr.Gate, 'B09');
  assert.equal(await datedCount(), 1);
  assert.equal(await routeLegs(), 1);
  report.dated = { departure: dep, arrival: arr, noAutomaticRequests: true, syntheticMatchedCallsign: 'BAW117' };
  await statusPanel.scrollIntoViewIfNeeded();
  await shot('dated-flight-status');
  stage = 'selection change to regional airliner';
  const crj = await pick(records[1]);
  await crj.getByRole('heading', { name: /Bombardier CRJ[- ]?1000 NG/i }).waitFor();
  await waitFor(async () => await routeLegs() === 0, 'previous route cleared');
  assert.equal(await scrollTop(), 0);
  assert.match(await crj.innerText(), /2012 · about \d+ years old/);
  assert.match(await crj.innerText(), /Air Nostrum seating/);
  assert.match(await crj.innerText(), /39\.1 m/);
  assert.doesNotMatch(await crj.innerText(), /BA117 · En route|B42|Newark/);
  await shot('crj1000');
  const diverted = crj.getByRole('region', { name: 'Dated flight status' });
  assert.equal(await datedCount(), 1);
  await diverted.getByRole('button', { name: 'Check dated flight status', exact: true }).click();
  await diverted.getByText('YW1234 · Diverted', { exact: true }).waitFor();
  await crj.getByRole('heading', { name: 'Diverted', exact: true }).waitFor();
  assert.match(await crj.getByRole('region', { name: 'Journey and flight path' }).innerText(), /route projection is hidden/);
  await waitFor(async () => await routeLegs() === 0, 'diverted dated schedule does not draw a continuing path');
  assert.equal(await crj.getByRole('button', { name: 'View route on map' }).count(), 0);
  await diverted.scrollIntoViewIfNeeded();
  await shot('diverted-flight-status');
  assert.equal(await datedCount(), 2);
  report.checks.push('No automatic paid requests, two explicit synthetic dated lookups, matching airframe and endpoints, actual/estimated/predicted UTC times, schedule differences, terminals/gates and diverted-route suppression');
  report.checks.push('Second map click resets scroll and removes the previous route; CRJ1000 type dimensions and individual age');
  stage = 'close and unidentified record';
  await pick(records[0]);
  await waitFor(async () => await routeLegs() === 1, 'selected route visible again');
  await airbus.getByRole('heading', { name: /London.*to.*New York/i }).waitFor();
  assert.doesNotMatch(await airbus.innerText(), /BA117 · En route|Newark|B42|YW1234 · Diverted/);
  await airbus.getByRole('button', { name: 'View route on map' }).click();
  const overview = await waitFor(async () => {
    const camera = await page.evaluate(() => window.__atlasDebug.camera());
    return camera && camera.lon < -20 && camera.lon > -60 && camera.heightM > 1000000 ? camera : null;
  }, 'route camera fits London and New York');
  report.routeOverview = overview;
  assert.equal(await routeLegs(), 1);
  await shot('usual-route-overview');
  await page.getByRole('button', { name: 'Close Flight details' }).click();
  await waitFor(async () => await routeLegs() === 0, 'route removed on close');
  const unknown = await pick(records[2]);
  await unknown.getByRole('heading', { name: 'Aircraft type unavailable' }).waitFor();
  assert.match(await unknown.innerText(), /Build year \/ age\s+Not reported/);
  assert.equal(await unknown.locator('.flight-spec').count(), 0);
  await unknown.getByText(/Representative 3D shape.*type unknown/i).waitFor();
  await unknown.getByRole('button', { name: 'Rotate model right' }).waitFor();
  assert.equal(await routeLegs(), 0);
  assert.doesNotMatch(await unknown.innerText(), /YW1234|Diverted|B42|Newark/);
  await setStatusCredential(null);
  assert.equal(await datedCount(), 2);
  report.checks.push('Closing details removes the route line. An unknown airframe shows a labeled representative shape and has no assigned exact type, build year or specifications.');
  report.transport = await app.evaluate(() => globalThis.__flightQa);
  assert(report.transport.datedRequests.every(request => request.testKeyReceived && !request.realProviderContacted));
  assert.equal(report.transport.paidRequestsBlocked, 0);
  assert.equal((await page.evaluate(() => window.__atlasDebug.diag())).renderErrors, 0);
  assert.equal(report.errors.length, 0);
  report.result = 'PASS';
} catch (e) {
  report.failure = { stage, message: e.message };
  if (page) {
    await page.screenshot({ path: join(temp, 'failure.png') }).catch(() => {});
    report.failure.card = await page.locator('.flight-card').innerText({ timeout: 800 }).catch(() => null);
  }
} finally {
  if (app) { await app.close(); report.closedByRunner = true; }
  report.archiveStable = sha === digest(await readFile(archive));
  if (!report.archiveStable) report.result = 'FAIL';
  report.finishedAt = new Date().toISOString();
  await writeFile(join(root, 'docs/flight-card-packaged-audit.log'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, stage, failure: report.failure?.message, temp, checks: report.checks }));
  if (report.result !== 'PASS') process.exitCode = 1;
}
