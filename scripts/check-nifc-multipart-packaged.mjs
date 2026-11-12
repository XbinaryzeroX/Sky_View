// Actual packaged app, isolated profile. Controlled source bytes are explicitly labelled.
// Usage: node scripts/check-nifc-multipart-packaged.mjs before|after [fixture|live]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const stage = process.argv[2];
assert(['before', 'after'].includes(stage), 'Choose before or after');
const sourceMode = process.argv[3] ?? 'fixture';
assert(['fixture', 'live'].includes(sourceMode), 'Choose fixture or live');
assert(stage === 'after' || sourceMode === 'fixture', 'Before uses the preserved deterministic fixture');
const suffix = sourceMode === 'live' ? '-live' : '';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { electron, version } = loadPlaywrightRuntime();
const temporary = await mkdtemp(join(tmpdir(), 'atlas-nifc-' + stage + '-'));
const profile = join(temporary, 'profile');
const database = join(temporary, 'qa.sqlite');
const output = join(root, 'docs/screenshots/nifc');
const executable = join(root, 'release/win-unpacked/Atlas Watch.exe');
const archive = join(root, 'release/win-unpacked/resources/app.asar');
const fixturePath = join(root, 'scripts/fixtures/nifc-multipart-qa.geojson');
let sourceText = sourceMode === 'fixture' ? await readFile(fixturePath, 'utf8') : null;
let source = sourceText ? JSON.parse(sourceText) : null;
let feature = source?.features[0];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = digest(await readFile(archive));
await mkdir(profile);
await mkdir(output, { recursive: true });

// This uses the application's actual store only to prepare an isolated local profile.
const seed = join(temporary, 'seed.cjs');
await build({
  stdin: {
    loader: 'ts', resolveDir: root,
    contents: `
      import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
      const store = new AtlasStore(${JSON.stringify(database)});
      store.saveSettings({ ...store.getSettings(), basemap:'neutral', terrainEnabled:false,
        labelsOverlay:false, buildings3d:false, layersEnabled:[], zoneLookupEnabled:false,
        nwsPollSeconds:3600, usgsPollSeconds:3600 });
      store.close();
    `,
  },
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: seed, logLevel: 'silent',
});
execFileSync(process.execPath, [seed], { cwd: root, stdio: 'pipe' });

const environment = { ...process.env, ATLAS_WATCH_DB: database };
for (const key of Object.keys(environment)) {
  if (/^(?:ELECTRON_RUN_AS_NODE|NODE_OPTIONS|ELECTRON_NO_SANDBOX|ELECTRON_DISABLE_SANDBOX)$/.test(key)
      || /^ATLAS_WATCH_/.test(key) && key !== 'ATLAS_WATCH_DB') delete environment[key];
}

const report = {
  result: 'FAIL', stage, startedAt: new Date().toISOString(), executable, archive, archiveSha256,
  temporary, profile, database, framework: 'playwright-core ' + version,
  sourceKind: sourceMode === 'fixture' ? 'explicit controlled GeoJSON fixture; not a NIFC observation' : 'actual official NIFC HTTPS replies, passively observed',
  sourcePath: sourceMode === 'fixture' ? 'scripts/fixtures/nifc-multipart-qa.geojson' : null,
  sourceBytes: sourceText ? Buffer.byteLength(sourceText) : null, sourceSha256: sourceText ? digest(sourceText) : null,
  providerResponsesReplaced: sourceMode === 'fixture', genuineProfileAccessed: false, installerExecuted: false,
  screenshots: [], errors: [], checks: [],
};

async function until(read, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out: ' + label);
}

// Independent planar oracle for these small non-wrapping test rectangles.
function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
function contains(part, point) {
  return inRing(part[0], point) && !part.slice(1).some(hole => inRing(hole, point));
}
function parts(geometry) {
  return geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
}
function sourceIdentity(feature) {
  const properties = feature.properties ?? {};
  const raw = typeof properties.GlobalID === 'string' ? properties.GlobalID.replace(/^\{|\}$/g, '').toLowerCase() : '';
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw)) return 'wfigs:global:' + raw;
  const objectId = properties.OBJECTID ?? feature.id;
  assert(Number.isSafeInteger(Number(objectId)) && Number(objectId) >= 0, 'Missing stable source feature identity');
  return 'wfigs:object:' + Number(objectId);
}
function sourceAcres(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function sourceTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function bounds(ring) {
  const xs = ring.map(point => point[0]), ys = ring.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function edgeDistance(point, ring) {
  const scale = Math.cos(point[1] * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - point[0]) * scale, ay = ring[i - 1][1] - point[1];
    const bx = (ring[i][0] - point[0]) * scale, by = ring[i][1] - point[1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy) * 111000);
  }
  return best;
}
function interior(part, accept) {
  const [w, s, e, n] = bounds(part[0]);
  if (e - w > 180) return null;
  let best = null;
  for (let x = 1; x < 16; x++) for (let y = 1; y < 16; y++) {
    const point = [w + (e - w) * x / 16, s + (n - s) * y / 16];
    if (!contains(part, point) || !accept(point)) continue;
    const clearanceM = Math.min(...part.map(ring => edgeDistance(point, ring)));
    if (!best || clearanceM > best.clearanceM) best = { point, clearanceM };
  }
  return best;
}
function chooseLiveChecks(features, records) {
  const pairs = [];
  for (const record of records) {
    const sourceFeature = features.find(candidate => sourceIdentity(candidate) === record.id);
    assert(sourceFeature, 'Normalized geometry does not exactly match any actual source feature');
    assert.deepEqual(record.geometry, sourceFeature.geometry, 'Main parser changed supplied polygon coordinates/holes');
    const properties = sourceFeature.properties;
    assert.equal(record.props.gisAcres, sourceAcres(properties.poly_GISAcres));
    assert.equal(record.props.incidentAcres, sourceAcres(properties.attr_IncidentSize));
    assert.equal(record.observedAt, sourceTime(properties.poly_DateCurrent) ?? sourceTime(properties.poly_PolygonDateTime));
    if (record.geometry.type !== 'MultiPolygon') continue;
    const polygons = parts(record.geometry);
    const candidates = polygons.slice(0, 500).map((part, partIndex) => {
      const chosen = interior(part, () => true);
      if (!chosen || polygons.some((other, index) => index !== partIndex && contains(other, chosen.point))
          || records.some(other => other.id !== record.id && parts(other.geometry).some(part => contains(part, chosen.point)))) return null;
      return { ...chosen, part: partIndex, record, sourceFeature };
    }).filter(Boolean).sort((a, b) => b.clearanceM - a.clearanceM);
    if (candidates.length > 1) pairs.push(candidates.slice(0, 2));
  }
  pairs.sort((a, b) => Number(b[0].record.props.incidentType === 'WF') - Number(a[0].record.props.incidentType === 'WF')
    || Math.min(...b.map(point => point.clearanceM)) - Math.min(...a.map(point => point.clearanceM)));
  assert(pairs.length, 'Actual reply has no suitable two-component test case');
  const pair = pairs[0];
  const checks = pair.map((chosen, index) => ({ ...chosen, name: `real-part-${index + 1}`, expected: true, polygonContainsPoint: true }));
  const holes = [];
  for (const record of records) for (const [partIndex, polygon] of parts(record.geometry).entries()) {
    for (const [holeIndex, hole] of polygon.slice(1).entries()) {
      const chosen = interior([hole], point => !records.some(other => parts(other.geometry).some(part => contains(part, point)))
        && records.every(other => Math.hypot((other.lon - point[0]) * Math.cos(point[1] * Math.PI / 180), other.lat - point[1]) * 111000 > 250));
      if (chosen) holes.push({ ...chosen, record, part: partIndex, hole: holeIndex,
        sourceFeature: features.find(candidate => sourceIdentity(candidate) === record.id) });
    }
  }
  holes.sort((a, b) => b.clearanceM - a.clearanceM);
  if (holes.length) checks.push({ ...holes[0], name: 'real-source-hole', expected: false, polygonContainsPoint: false });
  return checks;
}

let app, page;
async function capture(name) {
  const path = join(output, `audit-nifc-${stage}${suffix}-${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}
async function inspectDetails(record, fetchedAt) {
  const rows = await page.locator('.data-panel .kv').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const title = node.querySelector('dt')?.textContent;
    const value = node.querySelector('dd');
    return [title, { text: value?.textContent?.trim(), time: value?.querySelector('time')?.dateTime ?? null }];
  })));
  for (const [title, expected] of [['Mapped perimeter area', record.props.gisAcres], ['Reported incident size', record.props.incidentAcres]]) {
    assert(rows[title], 'Missing ordinary Details row: ' + title);
    if (expected === null || expected === undefined) assert.equal(rows[title].text, 'Not provided by NIFC');
    else {
      assert(rows[title].text.endsWith(' acres'));
      const displayed = Number(rows[title].text.replace(/,/g, '').replace(/ acres$/, ''));
      assert(Math.abs(displayed - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-7), 'Displayed acreage differs from source: ' + title);
    }
  }
  assert.equal(rows['Polygon captured'].time, record.props.polygonDateTime ?? null);
  assert.equal(rows['Polygon record last edited'].time, record.props.dateCurrent ?? null);
  assert.equal(rows.Fetched.time, fetchedAt);
  return rows;
}

try {
  app = await electron.launch({
    executablePath: executable, chromiumSandbox: true,
    args: ['--user-data-dir=' + profile], cwd: dirname(executable), env: environment, timeout: 45000,
  });
  report.pid = app.process().pid;
  // Intercept only the existing fixed NIFC endpoint, before the normal layer enable action.
  await app.evaluate(({ app: electronApp, BrowserWindow }, config) => {
    const nativeFetch = globalThis.fetch;
    globalThis.__nifcQaRequests = [];
    globalThis.fetch = async (input, options) => {
      const url = typeof input === 'string' ? input : input.url ?? String(input);
      const parsed = new URL(url);
      if (parsed.origin === 'https://services3.arcgis.com'
          && parsed.pathname === '/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query') {
        const entry = { url, at: new Date().toISOString(), controlled: config.sourceMode === 'fixture' };
        globalThis.__nifcQaRequests.push(entry);
        if (config.sourceMode === 'fixture') {
          entry.status = 200;
          return new Response(config.sourceText, { status: 200, headers: { 'content-type': 'application/geo+json' } });
        }
        const response = await nativeFetch(input, options);
        entry.status = response.status;
        entry.receivedAt = new Date().toISOString();
        entry.lastModified = response.headers.get('last-modified');
        entry.date = response.headers.get('date');
        const bytes = await response.clone().arrayBuffer();
        assertSize(bytes.byteLength);
        entry.text = Buffer.from(bytes).toString('utf8');
        return response;
      }
      return nativeFetch(input, options);
    };
    function assertSize(size) {
      if (size > 60 * 1024 * 1024) throw new Error('Actual NIFC reply exceeds QA bound');
    }
  }, { sourceMode, sourceText });
  page = await app.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  report.security = await app.evaluate(({ app: electronApp, BrowserWindow }) => ({
    isPackaged: electronApp.isPackaged, version: electronApp.getVersion(),
    appPath: electronApp.getAppPath(), userData: electronApp.getPath('userData'),
    noSandbox: electronApp.commandLine.hasSwitch('no-sandbox'),
    ignoreCertificateErrors: electronApp.commandLine.hasSwitch('ignore-certificate-errors'),
    windows: BrowserWindow.getAllWindows().map(window => {
      const options = window.webContents.getLastWebPreferences();
      return { contextIsolation: options.contextIsolation, sandbox: options.sandbox,
        nodeIntegration: options.nodeIntegration, webSecurity: options.webSecurity };
    }),
  }));
  assert(report.security.isPackaged);
  assert.equal(resolve(report.security.appPath), resolve(archive));
  assert.equal(resolve(report.security.userData).toLowerCase(), profile.toLowerCase());
  assert(!report.security.noSandbox && !report.security.ignoreCertificateErrors);
  assert(report.security.windows.every(options => options.contextIsolation && options.sandbox
    && !options.nodeIntegration && options.webSecurity));

  const search = page.getByRole('textbox', { name: 'Find a layer', exact: true });
  await search.waitFor({ state: 'visible' });
  await search.fill('Wildfire perimeters');
  const layer = page.locator('.layer-row').filter({ hasText: 'Wildfire perimeters' });
  async function openSourceInfo() {
    const info = layer.locator('details.layer-info');
    if (!await info.evaluate(node => node.open)) await info.locator('summary').click();
  }
  await layer.getByRole('switch').click();
  await until(() => layer.getByRole('switch').isChecked(), 'normal layer enabled');
  const snapshot = await until(async () => {
    const snapshots = await page.evaluate(() => window.atlas.getLayers());
    const snapshot = snapshots.find(item => item.status.id === 'firePerimeters');
    if (snapshot?.status.state === 'error') throw new Error(snapshot.status.error);
    return snapshot?.status.state === 'ok' && snapshot.records.length ? snapshot : null;
  }, 'controlled source committed');
  const rawRequests = await app.evaluate(() => globalThis.__nifcQaRequests);
  if (sourceMode === 'live') {
    assert(rawRequests.every(reply => reply.status === 200 && reply.text), 'Actual NIFC source did not return complete HTTP200 replies');
    sourceText = rawRequests.map(reply => reply.text).join('\n');
    source = { type: 'FeatureCollection', features: rawRequests.flatMap(reply => JSON.parse(reply.text).features) };
    assert.equal(snapshot.records.length, source.features.length, 'Live normalized feature count differs from source count');
    report.sourceBytes = Buffer.byteLength(sourceText);
    report.sourceSha256 = digest(sourceText);
    report.rawSourcePath = join(temporary, 'actual-nifc-replies.json');
    await writeFile(report.rawSourcePath, JSON.stringify(rawRequests, null, 2));
  }
  report.requests = rawRequests.map(({ text, ...reply }) => ({ ...reply, bytes: text ? Buffer.byteLength(text) : report.sourceBytes, sha256: text ? digest(text) : report.sourceSha256 }));
  let record = snapshot.records[0];
  let points;
  if (sourceMode === 'fixture') {
    assert.equal(snapshot.records.length, 1);
    const expectedId = stage === 'before' ? feature.properties.attr_UniqueFireIdentifier : sourceIdentity(feature);
    assert.equal(record.id, expectedId);
    assert.deepEqual(record.geometry, feature.geometry, 'Main parser lost source parts or holes');
    points = [
      { name: 'first-part', part: 0, point: [-120.9, 39.1], expected: true },
      { name: 'second-part', part: 1, point: [-119.7, 39.1], expected: stage === 'after' },
      { name: 'first-hole', part: 0, point: [-120.7, 39.3], expected: false },
      { name: 'second-hole', part: 1, point: [-119.5, 39.3], expected: false },
    ].map(check => ({ ...check, record, sourceFeature: feature, clearanceM: 4000 }));
  } else {
    points = chooseLiveChecks(source.features, snapshot.records);
    record = points[0].record;
    feature = points[0].sourceFeature;
    report.sourceGeometry = {
      features: source.features.length, normalizedRecords: snapshot.records.length,
      multiPolygons: source.features.filter(item => item.geometry?.type === 'MultiPolygon').length,
      sourceParts: source.features.reduce((count, item) => count + parts(item.geometry).length, 0),
      sourceHoles: source.features.reduce((count, item) => count + parts(item.geometry).reduce((sum, part) => sum + part.length - 1, 0), 0),
      sourceCoordinates: source.features.reduce((count, item) => count + parts(item.geometry).reduce((sum, part) => sum + part.reduce((vertices, ring) => vertices + ring.length, 0), 0), 0),
      normalizedGeometryExactlyMatches: snapshot.records.length,
      verifiedFields: ['publisher feature identity', 'every polygon coordinate', 'every hole', 'polygon timestamp', 'mapped GIS acreage', 'reported incident acreage'],
    };
    report.verifiedSourceRecords = snapshot.records.map(record => ({ id: record.id, label: record.label,
      observedAt: record.observedAt, gisAcres: record.props.gisAcres, incidentAcres: record.props.incidentAcres,
      incidentType: record.props.incidentType, parts: parts(record.geometry).length,
      holes: parts(record.geometry).reduce((sum, part) => sum + part.length - 1, 0) }));
  }
  report.normalized = record;
  if (stage === 'after') {
    await openSourceInfo();
    const sourceStatus = page.getByRole('status', { name: 'NIFC perimeter source', exact: true });
    await until(async () => await sourceStatus.getAttribute('data-nifc-state') === 'current', 'truthful current source status');
    report.sourceStatus = { state: await sourceStatus.getAttribute('data-nifc-state'), text: await sourceStatus.innerText() };
    await capture('source');
  }
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await until(() => page.evaluate(() => window.__atlasDebug?.diag()?.globeShown), 'actual globe ready');

  async function setCamera(point, heightM) {
    await page.evaluate(({ point, heightM }) => window.__atlasDebug.setView(point[1], point[0], heightM), { point, heightM });
    await until(async () => {
      const diag = await page.evaluate(() => window.__atlasDebug.diag());
      return diag && Math.abs(diag.cameraLat - point[1]) < 0.00001
        && Math.abs(diag.cameraLon - point[0]) < 0.00001 && Math.abs(diag.cameraHeightM - heightM) < 1;
    }, 'camera settled');
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await until(async () => {
      const text = await page.locator('.hud').innerText();
      const altitude = heightM >= 100000 ? `${Math.round(heightM / 1000).toLocaleString()} km`
        : heightM >= 1000 ? `${(heightM / 1000).toFixed(1)} km` : `${Math.round(heightM)} m`;
      return text.includes(point[1].toFixed(4)) && text.includes(point[0].toFixed(4)) && text.includes('ALT ' + altitude);
    }, 'displayed camera readout caught up');
  }
  async function clearSelection() {
    const back = page.locator('.data-panel').getByRole('button', { name: '← Overview', exact: true });
    if (await back.isVisible()) await back.click();
    await until(async () => !await page.locator('.data-panel h2').filter({ hasText: record.label }).count(), 'clear prior record');
  }
  await setCamera([-120.1, 39.3], 300000);
  report.scene = { point: [-120.1, 39.3], heightM: 300000, camera: await page.evaluate(() => window.__atlasDebug.camera()) };
  await capture('same-scene');

  for (const check of points) {
    record = check.record;
    const polygonContainsPoint = contains(parts(check.sourceFeature.geometry)[check.part], check.point);
    assert.equal(polygonContainsPoint, !check.name.includes('hole'));
    await clearSelection();
    const heightM = sourceMode === 'fixture' ? 120000 : Math.max(1500, Math.min(120000, check.clearanceM * 20));
    await setCamera(check.point, heightM);
    const canvas = await page.locator('.cesium-widget canvas').boundingBox();
    assert(canvas);
    const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    await page.mouse.click(center.x, center.y);
    // Let the real Cesium pick event and React selection commit finish.
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const picked = await page.locator('.data-panel h2').filter({ hasText: record.label }).count() > 0;
    report.checks.push({ name: check.name, part: check.part, hole: check.hole, point: check.point,
      expected: check.expected, recordId: record.id, label: record.label, observedAt: record.observedAt,
      category: record.category, incidentType: record.props.incidentType,
      clearanceM: check.clearanceM, heightM, polygonContainsPoint, picked, center });
    await capture(check.name);
    assert.equal(picked, check.expected, check.name + ': unexpected actual map selection');
    if (picked) {
      const text = await page.locator('.data-panel').innerText();
      assert(text.includes(record.id), 'Details lost the selected provider feature ID');
      assert(text.includes('NIFC WFIGS'));
      if (stage === 'after') {
        const heading = page.locator('.data-panel h2').filter({ hasText: record.label });
        const headingBox = await heading.boundingBox();
        const panelBox = await page.locator('.data-panel').boundingBox();
        assert(headingBox && panelBox && headingBox.y >= panelBox.y && headingBox.y + headingBox.height <= panelBox.y + panelBox.height,
          'Selected incident headline is below the visible Data panel');
        assert(text.includes('Mapped perimeter area') && text.includes('Reported incident size'));
        report.checks.at(-1).headlineVisible = true;
        report.checks.at(-1).displayedSourceFields = await inspectDetails(record, snapshot.status.lastSuccessAt);
      }
    }
  }
  if (stage === 'after') {
    const target = points[1];
    record = target.record;
    await clearSelection();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await search.fill('Wildfire perimeters');
    await layer.getByRole('switch').click();
    await until(async () => {
      const snapshots = await page.evaluate(() => window.atlas.getLayers());
      const snapshot = snapshots.find(item => item.status.id === 'firePerimeters');
      if (snapshot && !snapshot.status.enabled) {
        report.retainedRecordsWhileDisabled = snapshot.records.length;
        return true;
      }
      return false;
    }, 'layer disabled');
    await openSourceInfo();
    await until(async () => await page.getByRole('status', { name: 'NIFC perimeter source', exact: true })
      .getAttribute('data-nifc-state') === 'disabled', 'renderer committed disabled source state');
    report.disabledSourceStatus = await page.getByRole('status', { name: 'NIFC perimeter source', exact: true }).getAttribute('data-nifc-state');
    assert.equal(report.disabledSourceStatus, 'disabled');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await setCamera(target.point, 120000);
    const canvas = await page.locator('.cesium-widget canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(await page.locator('.data-panel h2').filter({ hasText: record.label }).count(), 0,
      'Disabled layer left a selectable perimeter entity');
    await capture('off');
    report.offRemovesSelection = true;
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await search.fill('Wildfire perimeters');
    await layer.getByRole('switch').click();
    await until(async () => {
      const snapshots = await page.evaluate(() => window.atlas.getLayers());
      const snapshot = snapshots.find(item => item.status.id === 'firePerimeters');
      return snapshot?.status.enabled && snapshot.records.some(item => item.id === record.id);
    }, 'layer re-enabled');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await setCamera(target.point, Math.max(1500, Math.min(120000, target.clearanceM * 20)));
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await until(() => page.locator('.data-panel h2').filter({ hasText: record.label }).count(), 'second part selectable after re-enable');
    report.reenableRestoresSecondPart = true;
    await capture('reenabled-second-part');
    // Use the actual Discover card and independently rank the latest loaded source features.
    const current = (await page.evaluate(() => window.atlas.getLayers())).find(item => item.status.id === 'firePerimeters');
    let discoveryFeatures = source.features;
    let discoverySourceSha256 = report.sourceSha256;
    if (sourceMode === 'live') {
      const latestReplies = await app.evaluate(() => globalThis.__nifcQaRequests);
      const lastStart = latestReplies.findLastIndex(reply => new URL(reply.url).searchParams.get('resultOffset') === '0');
      const currentReplies = latestReplies.slice(lastStart);
      discoveryFeatures = currentReplies.flatMap(reply => JSON.parse(reply.text).features);
      discoverySourceSha256 = digest(currentReplies.map(reply => reply.text).join('\n'));
      await writeFile(report.rawSourcePath, JSON.stringify(latestReplies, null, 2));
      report.requests = latestReplies.map(({ text, ...reply }) => ({ ...reply, bytes: Buffer.byteLength(text), sha256: digest(text) }));
    }
    const rankedSource = discoveryFeatures.filter(item => sourceAcres(item.properties?.poly_GISAcres) !== null)
      .sort((a, b) => b.properties.poly_GISAcres - a.properties.poly_GISAcres);
    await page.getByRole('button', { name: 'Discover', exact: true }).click();
    const card = page.locator('button.rec-item').filter({ hasText: 'Largest reported map area among loaded NIFC perimeters' });
    if (rankedSource.length) {
      const sourceLargest = rankedSource[0];
      const expected = current.records.find(item => item.id === sourceIdentity(sourceLargest));
      assert(expected, 'Largest source feature is absent from the loaded snapshot');
      assert.equal(expected.props.gisAcres, sourceLargest.properties.poly_GISAcres);
      await card.waitFor({ state: 'visible' });
      const cardText = await card.innerText();
      assert(cardText.includes(expected.label));
      await capture('discover');
      const clickStarted = performance.now();
      await card.click();
      await until(() => page.locator('.data-panel h2').filter({ hasText: expected.label }).count(), 'Discover opens original perimeter details');
      const text = await page.locator('.data-panel').innerText();
      assert(text.includes(expected.id), 'Discover opened the wrong publisher feature ID');
      report.discover = { recordId: expected.id, label: expected.label, mappedAcres: expected.props.gisAcres,
        reportedIncidentAcres: expected.props.incidentAcres, cardText, clickToDetailMs: performance.now() - clickStarted,
        independentRanking: 'highest actual poly_GISAcres', sourceSha256: discoverySourceSha256,
        timingScope: 'one local UI action; not general map performance',
        rows: await inspectDetails(expected, current.status.lastSuccessAt) };
      await capture('discover-details');
    } else {
      assert.equal(await card.count(), 0, 'Discover invented a mapped acreage when the source omitted it');
      report.discover = { unavailableBecauseNoSourceMappedAcreage: true };
    }
  }
  report.diagnostics = await page.evaluate(() => window.__atlasDebug.diag());
  assert.equal(report.diagnostics.renderErrors, 0);
  assert.equal(report.errors.length, 0);
  report.result = stage === 'before' ? 'BASELINE_CONFIRMED_MISSING_SECOND_PART' : 'PASS';
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  if (page) await page.screenshot({ path: join(temporary, 'failure.png') }).catch(() => {});
} finally {
  if (app) {
    await app.close();
    report.closedByRunner = true;
  }
  report.archiveStableDuringRun = digest(await readFile(archive)) === archiveSha256;
  if (!report.archiveStableDuringRun) report.result = 'FAIL';
  report.finishedAt = new Date().toISOString();
  const reportPath = report.result === 'FAIL' ? join(temporary, 'nifc-failure.log')
    : join(root, 'docs', `nifc-${stage}${suffix}-audit.log`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, reportPath, temporary, archiveSha256,
    sourceSha256: report.sourceSha256, checks: report.checks, failure: report.failure }, null, 2));
}
process.exitCode = report.result === 'FAIL' ? 1 : 0;
