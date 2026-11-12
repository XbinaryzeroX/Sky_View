// Controlled acceptance only: synthetic DWD HTTP responses in an isolated packaged process.
// The shipped executable, transport, bounded reader/parser, SQLite, IPC and renderer remain real.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { build } from 'esbuild';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { electron, version } = loadPlaywrightRuntime();
const executable = join(root, 'release/win-unpacked/Atlas Watch.exe');
const archive = join(root, 'release/win-unpacked/resources/app.asar');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = digest(await readFile(archive));
const temporary = await mkdtemp(join(tmpdir(), 'atlas-dwd-conditions-'));
const output = join(root, 'docs/screenshots/dwd'); await mkdir(output, { recursive: true });
const logPath = join(root, 'docs/dwd-conditions.log');
const sourceUrl = 'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/Z_CAP_C_EDZW_LATEST_PVW_STATUS_PREMIUMDWD_COMMUNEUNION_DE.zip';
const report = { result: 'FAIL', startedAt: new Date().toISOString(), executable, archive, archiveSha256, temporary, scriptSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  framework: 'playwright-core ' + version, instrumentedPackagedProcess: true, chromiumSandbox: true,
  syntheticDwdProviderResponses: true, genuineDwdNetworkVerification: false,
  unchangedProductionHttpReaderParserCacheIpcUi: true, extraServicesStarted: false, globalClockChanged: false,
  genuineProfileAccessed: false, installerExecuted: false, nativePickerOperated: false, defaultBrowserOpened: false,
  fixtures: ['tests/fixtures/dwd-source/area.xml', 'tests/fixtures/dwd-source/named.xml'], phases: [] };
process.on('unhandledRejection', error => {
  report.frameworkErrors ??= []; if (report.frameworkErrors.length < 5) report.frameworkErrors.push(String(error?.message ?? error).slice(0, 1000));
});
const persist = () => writeFile(logPath, JSON.stringify(report, null, 2));
const waitFor = async (read, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Controlled DWD condition timed out');
};
async function profile(name) {
  const directory = join(temporary, name), userData = join(directory, 'profile'), database = join(directory, 'qa.sqlite');
  await mkdir(userData, { recursive: true });
  const seed = join(directory, 'seed.cjs');
  await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
import {AtlasStore} from ${JSON.stringify(join(root, 'src/main/store.ts'))};
const store = new AtlasStore(${JSON.stringify(database)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,nwsPollSeconds:3600,usgsPollSeconds:3600});
store.close();
` }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: seed, logLevel: 'silent' });
  execFileSync(process.execPath, [seed], { cwd: root, stdio: 'pipe' });
  return { userData, database };
}
const noPrior = await profile('no-prior'), noPrior304 = await profile('no-prior-304'), retained = await profile('retained');
function environment(database) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^ELECTRON_NO_SANDBOX$|^ELECTRON_DISABLE_SANDBOX$|^ELECTRON_EXTRA_LAUNCH_ARGS$/.test(key)) delete env[key];
  env.ATLAS_WATCH_DB = database; return env;
}
const readLayer = page => page.evaluate(async () => (await window.atlas.getLayers()).find(layer => layer.status.id === 'dwd'));
async function openLayers(page) {
  await page.getByRole('button', { name: 'Globe', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Find a layer', exact: true });
  if (!await search.isVisible()) await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await search.fill('DWD');
  return page.locator('.layer-row').filter({ hasText: 'Weather warnings (Germany · DWD)' });
}
async function events(page) {
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  const panel = page.locator('.page-panel[aria-label="Events"]');
  await panel.getByRole('combobox', { name: 'Event type', exact: true }).selectOption('dwd');
  return { panel, status: panel.getByRole('status', { name: 'DWD warning source', exact: true }), rows: panel.locator('li[data-dwd-warning-id]') };
}
async function run(phase, target, reply, check) {
  const value = { phase, result: 'FAIL', startedAt: new Date().toISOString(), profile: target.userData, database: target.database, rendererErrors: [], screenshots: [] };
  let app, page, child;
  try {
    app = await electron.launch({ executablePath: executable, chromiumSandbox: true, args: ['--user-data-dir=' + target.userData], cwd: dirname(executable), env: environment(target.database), timeout: 45000 });
    child = app.process(); value.pid = child.pid;
    // Layer is off on disk at each start. This adaptation exists only in this process, not in shipped code.
    await app.evaluate((_, { sourceUrl, reply }) => {
      const native = globalThis.fetch.bind(globalThis); globalThis.__dwdConditionRequests = [];
      globalThis.fetch = async (input, options) => {
        const url = typeof input === 'string' ? input : input.url ?? String(input);
        if (url !== sourceUrl) return native(input, options);
        const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
        globalThis.__dwdConditionRequests.push({ url, at: new Date().toISOString(), method: options?.method ?? 'GET', redirect: options?.redirect,
          validators: { etag: headers.get('if-none-match'), modifiedSince: headers.get('if-modified-since') }, replyStatus: reply.status });
        return new Response(reply.status === 304 ? null : reply.base64 ? Buffer.from(reply.base64, 'base64') : reply.text ?? 'Synthetic controlled provider failure', { status: reply.status, headers: reply.headers ?? {} });
      };
    }, { sourceUrl, reply });
    page = await app.firstWindow({ timeout: 30000 }); page.setDefaultTimeout(20000);
    page.on('pageerror', error => value.rendererErrors.push(error.message.slice(0, 1000)));
    value.security = await app.evaluate(({ app, BrowserWindow }) => ({ isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
      noSandbox: app.commandLine.hasSwitch('no-sandbox'), disableWebSecurity: app.commandLine.hasSwitch('disable-web-security'), ignoreCertificateErrors: app.commandLine.hasSwitch('ignore-certificate-errors'),
      windows: BrowserWindow.getAllWindows().map(window => { const p = window.webContents.getLastWebPreferences(); return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity }; }) }));
    assert(value.security.isPackaged); assert.equal(resolve(value.security.appPath), resolve(archive));
    assert.equal(resolve(value.security.userData).toLowerCase(), resolve(target.userData).toLowerCase());
    assert(!value.security.noSandbox && !value.security.disableWebSecurity && !value.security.ignoreCertificateErrors);
    assert(value.security.windows.every(w => w.contextIsolation && w.sandbox && !w.nodeIntegration && w.webSecurity));
    await page.getByRole('button', { name: 'Globe', exact: true }).waitFor({ state: 'visible' });
    const before = await page.evaluate(() => window.atlas.getState()); assert.deepEqual(before.settings.layersEnabled, []);
    const layer = await openLayers(page); await layer.getByRole('switch').click();
    await waitFor(async () => (await page.evaluate(() => window.atlas.getState())).settings.layersEnabled.includes('dwd'));
    const snapshot = await waitFor(async () => { const s = await readLayer(page); return s?.status.enabled && ['ok', 'error'].includes(s.status.state) ? s : null; });
    const view = await events(page);
    value.snapshot = { status: snapshot.status, warnings: snapshot.dwdWarnings?.map(w => ({ id: w.id, capIdentifier: w.capIdentifier, sent: w.sent, expires: w.expires })), mapped: snapshot.records.length };
    const capture = async name => {
      const path = join(output, 'audit-dwd-controlled-' + phase + '-' + name + '.png');
      await view.status.scrollIntoViewIfNeeded(); await page.screenshot({ path }); value.screenshots.push(path);
    };
    await check({ app, page, value, snapshot, view, capture });
    value.requests = await app.evaluate(() => globalThis.__dwdConditionRequests);
    assert(value.requests.every(r => r.url === sourceUrl && r.method === 'GET' && r.redirect === 'manual'));
    value.ui = { state: await view.status.getAttribute('data-dwd-state'), text: (await view.status.innerText()).slice(0, 5000), rows: await view.rows.count() };
    await capture('final');
    const off = await openLayers(page); await off.getByRole('switch').click();
    await waitFor(async () => !(await page.evaluate(() => window.atlas.getState())).settings.layersEnabled.includes('dwd'));
    assert.equal((await readLayer(page)).records.length, 0); assert.equal(value.rendererErrors.length, 0);
    value.result = 'PASS';
  } catch (error) {
    value.failure = { name: error.name, message: error.message, stack: error.stack?.slice(0, 4000) };
    if (app) { try { value.requests = await app.evaluate(() => globalThis.__dwdConditionRequests); } catch {} }
    if (page) { try { const path = join(output, 'audit-dwd-controlled-' + phase + '-failure.png'); await page.screenshot({ path }); value.screenshots.push(path); } catch {} }
  } finally {
    if (app) { try { await app.close(); value.closedByRunner = true; } catch (error) { value.closeError = error.message; child?.kill(); } }
    value.finishedAt = new Date().toISOString(); report.phases.push(value); await persist();
  }
  assert.equal(value.result, 'PASS', value.failure?.message); assert(value.closedByRunner);
  console.log('DWD_CONTROLLED_PHASE ' + JSON.stringify({ phase, result: value.result, status: value.snapshot.status.state, warnings: value.snapshot.warnings?.length ?? null, uiState: value.ui.state, rows: value.ui.rows, requests: value.requests.length }));
  return value;
}
let original, conditional, sourceTime, expiresAt;
try {
  await run('no-prior-503', noPrior, { status: 503, headers: { 'retry-after': '120' } }, async ({ snapshot, view, app, value }) => {
    assert.equal(snapshot.status.state, 'error'); assert.equal(snapshot.status.lastSuccessAt, null); assert.equal(snapshot.dwdWarnings, undefined);
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'error'); assert.equal(await view.rows.count(), 0);
    const text = await view.status.innerText(); assert(text.includes('A missing reply does not mean no warnings.')); assert(!text.includes('last complete snapshot contains no'));
    assert.equal((await app.evaluate(() => globalThis.__dwdConditionRequests)).length, 1);
    value.checks = { noSnapshotIsUnknownNotZero: true, http503Visible: text.includes('DWD refresh failed:') };
    assert(value.checks.http503Visible);
  });
  await run('no-prior-pause-restart', noPrior, { status: 304 }, async ({ snapshot, view, app, value }) => {
    assert.equal(snapshot.status.state, 'error'); assert.equal(snapshot.status.lastSuccessAt, null); assert.equal(snapshot.dwdWarnings, undefined);
    assert.equal((await app.evaluate(() => globalThis.__dwdConditionRequests)).length, 0, 'Persisted publisher pause was ignored');
    assert((await view.status.innerText()).includes('pause')); assert.equal(await view.status.getAttribute('data-dwd-state'), 'error');
    value.checks = { pausePersistsAcrossRestart: true, noSourceEvidenceInvented: true };
  });
  await run('no-prior-unmatched-304', noPrior304, { status: 304 }, async ({ snapshot, view, app, value }) => {
    assert.equal(snapshot.status.state, 'error'); assert.equal(snapshot.status.lastSuccessAt, null); assert.equal(snapshot.dwdWarnings, undefined);
    assert.equal((await app.evaluate(() => globalThis.__dwdConditionRequests)).length, 1);
    const text = await view.status.innerText(); assert(text.includes('304 without a matching complete local archive'));
    assert(text.includes('A missing reply does not mean no warnings.')); assert.equal(await view.status.getAttribute('data-dwd-state'), 'error');
    value.checks = { unmatched304DoesNotInventEmptyArchive: true, noSourceEvidenceInvented: true };
  });
  const base = Date.now(); expiresAt = new Date(base + 90_000).toISOString(); sourceTime = new Date(Math.floor((base - 30_000) / 1000) * 1000).toISOString();
  const mapTimes = { '2026-11-11T12:00:00Z': new Date(base - 120_000).toISOString(), '2026-11-11T12:01:00Z': new Date(base - 60_000).toISOString(),
    '2026-11-11T12:03:00Z': new Date(base - 10_000).toISOString(), '2026-11-11T12:01:30Z': new Date(base - 20_000).toISOString(), '2026-11-11T12:08:00Z': expiresAt };
  const texts = await Promise.all(['area.xml', 'named.xml'].map(async file => {
    let text = await readFile(join(root, 'tests/fixtures/dwd-source', file), 'utf8');
    for (const [old, replacement] of Object.entries(mapTimes)) text = text.replaceAll(old, replacement);
    return [file, strToU8(text)];
  }));
  const zip = zipSync(Object.fromEntries(texts));
  report.syntheticFixture = { createdAt: new Date(base).toISOString(), expiresAt, sourceTime, archiveSha256: digest(zip), zipBytes: zip.length,
    qualification: 'Original explicit test XML fixtures; all source times deliberately shifted relative to this run. Not actual DWD observations.' };
  original = await run('complete-200', retained, { status: 200, base64: Buffer.from(zip).toString('base64'), headers: { etag: '"controlled-cap-v1"', 'last-modified': new Date(sourceTime).toUTCString(), 'content-type': 'application/zip' } }, async ({ snapshot, view, value }) => {
    assert.equal(snapshot.status.state, 'ok'); assert.equal(snapshot.status.sourceUpdatedAt, sourceTime); assert.equal(snapshot.dwdWarnings.length, 2); assert.equal(snapshot.records.length, 1);
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'current'); assert.equal(await view.rows.count(), 2);
    value.checks = { syntheticCompleteArchiveThroughPackagedHttpAndParser: true, twoWarningsOneSuppliedGeometry: true };
  });
  conditional = await run('restart-304', retained, { status: 304, headers: { etag: '"controlled-cap-v1"' } }, async ({ snapshot, view, app, value }) => {
    assert.equal(snapshot.status.state, 'ok'); assert.equal(snapshot.status.sourceUpdatedAt, sourceTime);
    assert.deepEqual(snapshot.dwdWarnings.map(w => ({ id: w.id, capIdentifier: w.capIdentifier, sent: w.sent, expires: w.expires })), original.snapshot.warnings);
    const calls = await app.evaluate(() => globalThis.__dwdConditionRequests); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].validators, { etag: '"controlled-cap-v1"', modifiedSince: new Date(sourceTime).toUTCString() });
    assert(snapshot.status.lastSuccessAt > original.snapshot.status.lastSuccessAt);
    assert(snapshot.status.note.includes(original.snapshot.status.lastSuccessAt), '304 replaced original full-copy receipt time');
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'current');
    value.checks = { originalArchiveRestoredFromSqlite: true, validatorsSent: true, sourceAndMessageAndReceiptClocksPreserved: true, conditionalCheckClockAdvanced: true };
  });
  const outage = await run('retained-failure-expiry', retained, { status: 500, headers: { 'retry-after': '90' } }, async ({ snapshot, view, app, value, capture }) => {
    assert.equal(snapshot.status.state, 'error'); assert.equal(snapshot.status.sourceUpdatedAt, sourceTime);
    assert.equal(snapshot.status.lastSuccessAt, conditional.snapshot.status.lastSuccessAt);
    assert.deepEqual(snapshot.dwdWarnings.map(w => ({ id: w.id, capIdentifier: w.capIdentifier, sent: w.sent, expires: w.expires })), original.snapshot.warnings);
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'last-observed'); assert.equal(await view.rows.count(), 2);
    assert((await view.status.innerText()).includes('current warning coverage is unknown'));
    await capture('retained-before-expiry');
    // Observe the real local repaint timer without getLayers polling; no simulated wall clock.
    await waitFor(async () => await view.rows.count() === 1, Math.max(5000, Date.parse(expiresAt) - Date.now() + 15000));
    const expired = await readLayer(view.panel.page());
    assert.equal(expired.status.state, 'error'); assert.equal(expired.dwdWarnings.length, 1); assert.equal(expired.records.length, 0);
    assert.equal(expired.dwdWarnings[0].capIdentifier, 'atlas-test-named.DEU'); assert.equal(expired.dwdWarnings[0].expires, null);
    assert.equal((await app.evaluate(() => globalThis.__dwdConditionRequests)).length, 1, 'Local expiry incorrectly triggered provider polling');
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'last-observed');
    value.afterExpiry = { status: expired.status, warningIds: expired.dwdWarnings.map(w => w.capIdentifier), mapped: expired.records.length, at: new Date().toISOString() };
    value.checks = { failedRefreshRetainsEvidenceAndClocks: true, failureNeverReportsCurrentAllClear: true, actualLocalExpiryRepaintsWithoutNewRequest: true, openEndedWarningNotSilentlyExpired: true };
  });
  // Honor, rather than editing/bypassing, the actual persisted publisher pause before the next case.
  const pausedUntil = Date.parse(outage.snapshot.status.nextAttemptAt);
  assert(Number.isFinite(pausedUntil));
  await waitFor(() => Date.now() >= pausedUntil + 1500, Math.max(5000, pausedUntil - Date.now() + 10000));
  report.outagePauseHonoredUntil = new Date().toISOString();
  const emptyZip = zipSync({}), emptyTime = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const empty = await run('complete-empty-200', retained, { status: 200, base64: Buffer.from(emptyZip).toString('base64'), headers: { etag: '"controlled-empty"', 'last-modified': new Date(emptyTime).toUTCString() } }, async ({ snapshot, view, value }) => {
    assert.equal(snapshot.status.state, 'ok'); assert.equal(snapshot.status.sourceUpdatedAt, emptyTime); assert.deepEqual(snapshot.dwdWarnings, []); assert.deepEqual(snapshot.records, []);
    assert.equal(await view.status.getAttribute('data-dwd-state'), 'current'); assert((await view.status.innerText()).includes('last complete snapshot contains no remaining unexpired German warnings'));
    value.checks = { validCompleteEmptyReplacesPriorReply: true, zeroQualifiedToReturnedSnapshot: true };
  });
  await run('empty-restart-304', retained, { status: 304, headers: { etag: '"controlled-empty"' } }, async ({ snapshot, view, app, value }) => {
    assert.equal(snapshot.status.state, 'ok'); assert.equal(snapshot.status.sourceUpdatedAt, emptyTime); assert.deepEqual(snapshot.dwdWarnings, []); assert.equal(snapshot.records.length, 0);
    const calls = await app.evaluate(() => globalThis.__dwdConditionRequests); assert.equal(calls.length, 1); assert.equal(calls[0].validators.etag, '"controlled-empty"');
    assert(snapshot.status.note.includes(empty.snapshot.status.lastSuccessAt)); assert.equal(await view.status.getAttribute('data-dwd-state'), 'current');
    value.checks = { emptyArchiveSurvivesRestartAndConditionalValidation: true, emptyDistinguishedFromMissingReply: true };
  });
  assert.equal(digest(await readFile(archive)), archiveSha256); report.archiveStableDuringRun = true;
  assert.equal(report.frameworkErrors?.length ?? 0, 0, 'Detached framework errors prevent acceptance');
  assert(report.phases.every(phase => phase.result === 'PASS' && phase.closedByRunner && phase.rendererErrors.length === 0 && Object.values(phase.checks).every(Boolean)));
  report.result = 'PASS';
} catch (error) { report.failure = { name: error.name, message: error.message, stack: error.stack?.slice(0, 4000) }; process.exitCode = 1; }
report.finishedAt = new Date().toISOString(); await persist();
console.log(JSON.stringify({ result: report.result, archiveSha256, phases: report.phases.length, temporary, failure: report.failure }, null, 2));
