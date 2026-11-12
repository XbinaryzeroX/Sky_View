// Real packaged place-search acceptance in an isolated local profile.
// Usage: node scripts/check-place-search-packaged.mjs before|after [focused|live-census]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import asar from '@electron/asar';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';
import { checkControlledGeocoding, checkLiveCensus, checkCensusDiagnostics } from './qa-place-geocoding.mjs';

const phase = process.argv[2];
assert(['before', 'after'].includes(phase), 'Choose before or after');
const focused = process.argv[3] === 'focused';
const censusOnly = process.argv[3] === 'live-census';
assert(!focused || phase === 'after', 'Focused acceptance requires after');
assert(!censusOnly || phase === 'after', 'Live Census acceptance requires after');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { electron, version } = loadPlaywrightRuntime();
const temporary = await mkdtemp(join(tmpdir(), 'atlas-place-search-' + phase + '-'));
const profile = join(temporary, 'profile');
const database = join(temporary, 'qa.sqlite');
const output = join(root, 'docs/screenshots/place-search');
const executable = join(root, 'release/win-unpacked/Atlas Watch.exe');
const archive = join(root, 'release/win-unpacked/resources/app.asar');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = digest(await readFile(archive));
const bundles = asar.listPackage(archive).map(path => path.replaceAll('\\', '/').replace(/^\/+/, ''))
  .filter(path => path.startsWith('dist/renderer/assets/index-') && /\.(?:js|css)$/.test(path)
    || path.includes('/placeSearchWorker-') && path.endsWith('.js'))
  .map(path => {
    const bytes = asar.extractFile(archive, path.replaceAll('/', sep));
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  });
let reusedOfflineEvidence;
if (focused) {
  const earlier = JSON.parse(await readFile(join(root, 'docs/place-search-initial-bundle-hashes.log'), 'utf8'));
  assert.deepEqual(bundles, earlier.files, 'Renderer/worker changed; focused evidence cannot reuse the full offline workflow');
  const offline = JSON.parse(await readFile(join(root, 'docs/place-search-offline-audit.log'), 'utf8'));
  assert.equal(offline.result, 'PASS_OFFLINE_SCOPE');
  assert.equal(offline.archiveSha256, earlier.archiveSha256);
  reusedOfflineEvidence = { path: 'docs/place-search-offline-audit.log', archiveSha256: offline.archiveSha256,
    completedFlights: offline.flights.length, rendererWorkerBytesIdentical: true };
}
const catalogBytes = await readFile(join(root, 'src/renderer/data/places.json'));
const catalog = JSON.parse(catalogBytes);
await mkdir(profile);
await mkdir(output, { recursive: true });

const seed = join(temporary, 'seed.cjs');
await build({
  stdin: {
    loader: 'ts', resolveDir: root,
    contents: `
      import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
      const store = new AtlasStore(${JSON.stringify(database)});
      store.saveSettings({ ...store.getSettings(), basemap:'neutral', terrainEnabled:false,
        labelsOverlay:false, buildings3d:false, layersEnabled:[], zoneLookupEnabled:false,
        nwsPollSeconds:3600, usgsPollSeconds:3600, reducedMotion:${phase === 'after'} });
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
  result: 'FAIL', phase, startedAt: new Date().toISOString(), executable, archive, archiveSha256,
  acceptanceScope: focused ? 'Final ASAR focused repeat plus remaining remote/provider workflows; identical renderer/worker proof reuses the completed19-flight offline scope.' : 'Full before/after workflow',
  bundles, reusedOfflineEvidence,
  reducedMotion: phase === 'after', independentLiveCensusProcess: censusOnly,
  temporary, profile, database, framework: 'playwright-core ' + version,
  catalog: { source: catalog.source, rows: catalog.places.length, sha256: digest(catalogBytes) },
  syntheticPlaceData: false, genuineProfileAccessed: false, installerExecuted: false,
  providerBoundary: 'Bundled place/coordinate workflow; passive geocoding HTTP observation. Other core startup feeds are unrelated and are not used as place-search evidence.',
  queries: [], flights: [], screenshots: [], errors: [],
};
let app, page, input;

async function until(read, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise(resume => setTimeout(resume, 75));
  }
  throw new Error('Timed out: ' + label);
}
async function settle() {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
async function capture(name) {
  const path = join(output, `audit-place-search-${focused ? 'final' : phase}-${name}.png`);
  await page.screenshot({ path });
  report.screenshots.push(path);
}
async function failureState() {
  return {
    main: await app.evaluate(() => ({
      controlled: globalThis.__placeQaControlled ? { requests: globalThis.__placeQaControlled.requests,
        pending: globalThis.__placeQaControlled.pending.length, deferredType: typeof globalThis.__placeQaControlled.defer,
        deferred: typeof globalThis.__placeQaControlled.defer === 'boolean' ? globalThis.__placeQaControlled.defer : 'invalid type',
        blockedTiles: globalThis.__placeQaControlled.blockedTiles } : null,
      censusDiagnostic: globalThis.__placeQaDiagnostic ?? null,
    })).catch(error => ({ unavailable: error.message })),
    renderer: await page.evaluate(async () => ({
      basemap: (await window.atlas.getState()).settings.basemap,
      google: (await window.atlas.listProviders()).filter(provider => provider.id === 'google3d')
        .map(provider => ({ configured: provider.configured, userConfigured: provider.userConfigured,
          credentialSource: provider.credentialSource, credentialError: provider.credentialError })),
      input: { value: document.querySelector('input.search')?.value,
        focused: document.activeElement === document.querySelector('input.search'),
        expanded: document.querySelector('input.search')?.getAttribute('aria-expanded') },
      popup: document.querySelector('#search-results')?.textContent?.slice(0, 8000),
    })).catch(error => ({ unavailable: error.message })),
  };
}
async function query(text) {
  await input.fill(text);
  await settle();
  if (phase === 'after') await until(async () => !await page.locator('#search-results [role="status"]')
    .filter({ hasText: 'Searching bundled places' }).count(), 'bundled place worker reply');
  const options = await page.locator('#search-results > li[role="option"]').evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector('button span:first-child')?.textContent,
    detail: node.querySelector('button span:nth-child(2)')?.textContent,
    selected: node.getAttribute('aria-selected'),
  })));
  const result = { text, codePoints: Array.from(text).map(character => character.codePointAt(0).toString(16)),
    expanded: await input.getAttribute('aria-expanded'), options };
  report.queries.push(result);
  return result;
}
function expectedPlace(name, country, admin) {
  const row = catalog.places.find(row => row[0] === name && row[2] === country && (!admin || row[1] === admin));
  assert(row, 'Expected source catalog place missing: ' + [name, country, admin].join(', '));
  return { name: row[0], admin: row[1], country: row[2], lat: row[3], lon: row[4] };
}
async function pick(text, expected, keyboard = false) {
  const result = await query(text);
  const index = result.options.findIndex(option => (option.label === expected.name || option.label?.endsWith(` (${expected.name})`))
    && (!expected.country || option.detail.includes(expected.country))
    && (!expected.admin || option.detail.includes(expected.admin)));
  assert(index >= 0, 'Expected result absent for ' + text);
  if (phase === 'after') assert.equal(index, 0, 'Exact city/qualified result did not outrank partial airport suggestions for ' + text);
  if (keyboard) {
    for (let step = 0; step < index; step++) await input.press('ArrowDown');
    await input.press('Enter');
  } else await page.locator('#search-results > li[role="option"]').nth(index).getByRole('button').click();
  const started = performance.now();
  const camera = await until(async () => {
    const camera = await page.evaluate(() => window.__atlasDebug?.camera());
    return camera && Math.abs(camera.lat - expected.lat) < 0.0001
      && Math.abs((camera.lon - expected.lon + 540) % 360 - 180) < 0.0001
      && Math.abs(camera.heightM - (phase === 'after' ? 30000 : 120000)) < 2 ? camera : null;
  }, 'actual camera flight to ' + text, 20000);
  await until(async () => await input.getAttribute('aria-expanded') === 'false', 'search closes after selection');
  report.flights.push({ query: text, expected, inputMethod: keyboard ? 'keyboard Enter' : 'actual result click', camera,
    observedFlightWaitMs: performance.now() - started, geocodingRequests: await app.evaluate(() => globalThis.__placeQaGeocodingRequests.length) });
  if (phase === 'after') {
    assert(Math.abs(camera.heightM - 30000) < 2, 'City flight did not reach the intended30km view');
    await until(async () => {
      const text = await page.locator('.hud').innerText();
      return text.includes(expected.lat.toFixed(4)) && text.includes(expected.lon.toFixed(4)) && text.includes('ALT 30.0 km');
    }, 'visible camera readout agrees with actual city camera');
    assert((await page.locator('.toast').allTextContents()).some(label => label.includes(expected.name)),
      'City selection did not display its destination');
  }
}

try {
  app = await electron.launch({ executablePath: executable, chromiumSandbox: true,
    args: ['--user-data-dir=' + profile], cwd: dirname(executable), env: environment, timeout: 45000 });
  report.pid = app.process().pid;
  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch;
    globalThis.__placeQaGeocodingRequests = [];
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      let entry;
      if (url.hostname === 'geocoding.geo.census.gov' || url.hostname === 'maps.googleapis.com' && url.pathname.includes('/geocode/')) {
        // Only host/path are captured, so a future configured key can never enter a QA log.
        entry = { host: url.hostname, path: url.pathname, at: new Date().toISOString() };
        globalThis.__placeQaGeocodingRequests.push(entry);
      }
      try {
        const response = await nativeFetch(input, options);
        if (entry) {
          entry.status = response.status;
          entry.receivedAt = new Date().toISOString();
          const bytes = await response.clone().arrayBuffer();
          if (bytes.byteLength <= 1024 * 1024) entry.responseText = Buffer.from(bytes).toString('utf8');
          else entry.inspectionError = 'Geocoding reply exceeds1MiB QA inspection bound';
        }
        return response;
      } catch (error) {
        if (entry) entry.error = error.message;
        throw error;
      }
    };
  });
  page = await app.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(12000);
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
  assert(report.security.isPackaged && !report.security.noSandbox && !report.security.ignoreCertificateErrors);
  assert.equal(resolve(report.security.appPath), resolve(archive));
  assert.equal(resolve(report.security.userData).toLowerCase(), profile.toLowerCase());
  assert(report.security.windows.every(options => options.contextIsolation && options.sandbox && !options.nodeIntegration && options.webSecurity));
  input = page.getByRole('combobox', { name: 'Search places, coordinates, U.S. addresses, saved locations and history', exact: true });
  await input.waitFor({ state: 'visible' });
  await until(() => page.evaluate(() => !!window.__atlasDebug?.camera()), 'globe camera ready');

  if (!censusOnly) {
  const variants = focused ? ['東京', 'London, Ontario'] : ['São Paulo', 'Sao Paulo', 'Sa\u0303o Paulo', '東京', 'دبي', 'Tokyo, Japan', 'London, Ontario'];
  for (const text of variants) {
    const result = await query(text);
    if (phase === 'before') {
      const expectedPresent = text === 'São Paulo';
      assert.equal(result.options.length > 0, expectedPresent, 'Previous-build baseline differs for ' + text);
    } else assert(result.options.length, 'No bundled result for supported spelling ' + text);
    if (['Sao Paulo', 'Sa\u0303o Paulo', '東京', 'دبي'].includes(text)) {
      await capture(text === '東京' ? 'tokyo-native' : text === 'دبي' ? 'dubai-native' : text === 'Sao Paulo' ? 'sao-ascii' : 'sao-decomposed');
    }
  }
  await pick(focused ? '東京' : 'Tokyo', expectedPlace('Tokyo', 'Japan'), true);
  await capture('tokyo-flight');

  if (!focused) {
  const targets = [
    ['New York', 'United States of America'], ['London', 'United Kingdom'], ['Frankfurt', 'Germany'],
    ['Dubai', 'United Arab Emirates'], ['Tokyo', 'Japan'], ['Singapore', 'Singapore'],
    ['Sydney', 'Australia'], ['Cape Town', 'South Africa'], ['São Paulo', 'Brazil'],
    ['Anchorage', 'United States of America'],
  ];
  for (const [name, country] of targets) {
    if (phase === 'after') {
      await pick(name, expectedPlace(name, country), name === 'London');
      if (['London', 'Sydney', 'Cape Town', 'Anchorage'].includes(name)) await capture(name.toLowerCase().replaceAll(' ', '-') + '-flight');
    }
    else {
      const result = await query(name);
      assert(result.options.some(option => option.label === name && option.detail.includes(country)));
    }
  }
  if (phase === 'after') {
    await pick('東京', expectedPlace('Tokyo', 'Japan'), true);
    await pick('دبي', expectedPlace('Dubai', 'United Arab Emirates'));
    await pick('Sao Paulo', expectedPlace('São Paulo', 'Brazil'));
    await pick('Sa\u0303o Paulo', expectedPlace('São Paulo', 'Brazil'), true);
    await pick('London, Ontario', expectedPlace('London', 'Canada', 'Ontario'));
    await pick('London, United Kingdom', expectedPlace('London', 'United Kingdom'), true);
    const coordinates = await query('-17, 180');
    const option = coordinates.options.findIndex(option => /WGS84/.test(option.detail ?? ''));
    assert(option >= 0, 'Date-line coordinates are absent from normal search');
    await page.locator('#search-results > li[role="option"]').nth(option).getByRole('button').click();
    const camera = await until(async () => {
      const camera = await page.evaluate(() => window.__atlasDebug.camera());
      return camera && Math.abs(camera.lat + 17) < 0.0001 && Math.abs(Math.abs(camera.lon) - 180) < 0.0001
        && Math.abs(camera.heightM - 10000) < 2 ? camera : null;
    }, 'date-line camera flight');
    assert(Math.abs(camera.heightM - 10000) < 2);
    report.flights.push({ query: '-17, 180', expected: { lat: -17, lon: 180, heightM: 10000 }, camera, inputMethod: 'actual coordinate result click' });
    await capture('date-line-flight');
  }
  await query('London');
  await input.press('ArrowDown');
  report.keyboard = { afterArrowDown: await page.locator('#search-results > li[role="option"]').allTextContents(),
    selectedIndex: await page.locator('#search-results > li[role="option"]').evaluateAll(nodes => nodes.findIndex(node => node.getAttribute('aria-selected') === 'true')) };
  await input.press('Escape');
  assert.equal(await input.getAttribute('aria-expanded'), 'false');
  report.keyboard.escapeClosedPopup = true;
  if (phase === 'after') {
    const before = await page.evaluate(() => window.__atlasDebug.camera());
    await input.press('Enter');
    await settle();
    assert.equal(await input.getAttribute('aria-expanded'), 'false', 'Closed popup Enter reopened or chose a stale option');
    const after = await page.evaluate(() => window.__atlasDebug.camera());
    assert(Math.abs(before.lat - after.lat) < 0.00001 && Math.abs(before.lon - after.lon) < 0.00001);
    report.keyboard.closedEnterDidNotFly = true;
    await input.press('ArrowDown');
    await until(async () => await input.getAttribute('aria-expanded') === 'true', 'ArrowDown opens closed suggestions');
    const active = await input.getAttribute('aria-activedescendant');
    assert(active && await page.locator('[id=' + JSON.stringify(active) + ']').count(), 'Combobox active descendant does not exist');
    report.keyboard.activeDescendant = active;
    await input.press('Escape');
    await query('Tokyo');
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true });
    await settle();
    assert.equal(await input.getAttribute('aria-expanded'), 'true', 'IME confirmation Enter selected a city');
    await input.dispatchEvent('compositionend', { data: '京' });
    await settle();
    report.keyboard.compositionEnterDidNotChoose = true;
    await input.press('Escape');
    await page.getByRole('button', { name: 'Discover', exact: true }).click();
    await pick('Tokyo', expectedPlace('Tokyo', 'Japan'));
    assert.equal(await page.getByRole('button', { name: 'Globe', exact: true }).getAttribute('aria-current'), 'page');
    report.nonGlobePlaceSelectionReturnsToGlobe = true;
    await capture('from-discover-flight');
    const missing = await query('zzqa-no-such-place');
    assert.equal(missing.options.length, 0);
    report.emptySearchNotice = await page.locator('#search-results').innerText();
    assert(/No matching bundled place\./.test(report.emptySearchNotice) && /Natural Earth.*offline/i.test(report.emptySearchNotice),
      'Empty local search omitted the bounded-catalog disclaimer');
    await capture('catalog-limit');
  }
  } else {
    await pick('London, Ontario', expectedPlace('London', 'Canada', 'Ontario'), true);
    await capture('qualified-london-flight');
  }
  report.geocodingRequests = await app.evaluate(() => globalThis.__placeQaGeocodingRequests);
  assert.deepEqual(report.geocodingRequests, [], 'Bundled typing/selection sent an external geocoding request');
  }
  if (phase === 'after') {
    if (censusOnly) {
      report.liveCensus = await checkLiveCensus({ app, page, input, until, settle, capture,
        retainRaw: async text => {
          const path = join(temporary, 'actual-census-response.json');
          await writeFile(path, text);
          return { path, bytes: Buffer.byteLength(text), sha256: digest(text) };
        } });
    } else {
      try {
        report.censusDiagnostics = await checkCensusDiagnostics({ app, page, input, until, capture,
          onProgress: partial => { report.censusDiagnostics = partial; } });
      } catch (error) {
        report.censusDiagnostics = { ...report.censusDiagnostics, result: 'FAIL', failure: error.message,
          expectedUi: 'malformed reply rejected; legitimate empty explicitly qualified', state: await failureState() };
      }
      try {
        report.controlledGeocoding = await checkControlledGeocoding({ app, page, input, until, settle, capture,
          onProgress: partial => { report.controlledGeocoding = partial; } });
      } catch (error) {
        report.controlledGeocoding = { ...report.controlledGeocoding, result: 'FAIL', failure: error.message,
          expectedUi: 'explicit Google action resolves the controlled match; provider transition preserves query/focus', state: await failureState() };
        await page.screenshot({ path: join(temporary, 'controlled-geocoding-failure.png') }).catch(() => {});
      }
    }
  }
  report.diagnostics = await page.evaluate(() => window.__atlasDebug.diag());
  assert.equal(report.diagnostics.renderErrors, 0);
  assert.equal(report.errors.length, 0);
  report.result = phase === 'before' ? 'BASELINE_CONFIRMED_PREFIX_ONLY_UNICODE_FAILURES'
    : censusOnly ? report.liveCensus.result === 'PASS' ? 'PASS' : 'PARTIAL_LIVE_CENSUS_FAILED'
      : report.censusDiagnostics.result === 'PASS' && report.controlledGeocoding.result === 'PASS' ? 'PASS' : 'PARTIAL_CONTROLLED_FAILURE';
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  if (page) await page.screenshot({ path: join(temporary, 'failure.png') }).catch(() => {});
} finally {
  if (app) { await app.close(); report.closedByRunner = true; }
  report.finishedAt = new Date().toISOString();
  report.archiveStableDuringRun = digest(await readFile(archive)) === archiveSha256;
  if (!report.archiveStableDuringRun) report.result = 'FAIL';
  const reportPath = report.result === 'FAIL' ? join(temporary, 'place-search-failure.log')
    : join(root, 'docs', `place-search-${censusOnly ? 'live-census' : focused ? 'final' : phase}-audit.log`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, reportPath, temporary, archiveSha256,
    queries: report.queries.map(query => ({ text: query.text, options: query.options })), flights: report.flights,
    geocodingRequests: report.geocodingRequests, failure: report.failure }, null, 2));
}
process.exitCode = report.result.startsWith('FAIL') || report.result.startsWith('PARTIAL') ? 1 : 0;
