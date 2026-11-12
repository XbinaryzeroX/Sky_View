// Separate instrumented packaged-process test using Playwright's official Electron API.
// No production hooks, bootstrap, source changes, user profile, or security bypass flags.
// node scripts/check-packaged-playwright.mjs --phase before|after
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] === '--phase' ? process.argv[3] : 'before';
assert(['before', 'after'].includes(phase), 'Expected --phase before|after');
const dependencies = 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1110-778-0_26.1110.778.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules';
const runtimeRequire = createRequire(join(dependencies, 'playwright-core/package.json'));
const { _electron } = runtimeRequire('playwright-core');
const frameworkVersion = runtimeRequire('playwright-core/package.json').version;
const executable = join(root, 'release/win-unpacked/Atlas Watch.exe');
const archive = join(root, 'release/win-unpacked/resources/app.asar');
assert(existsSync(executable) && existsSync(archive), 'Build the actual packaged executable first.');
const archiveHash = () => createHash('sha256').update(readFileSync(archive)).digest('hex').toUpperCase();
const temporary = mkdtempSync(join(tmpdir(), `atlas-packaged-playwright-${phase}-`));
const profile = join(temporary, 'profile'); mkdirSync(profile);
const database = join(temporary, 'live.sqlite');
const screenshots = join(root, 'docs/screenshots/packaged-playwright'); mkdirSync(screenshots, { recursive: true });
const logPath = join(root, `docs/packaged-playwright-${phase}.log`);
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^ATLAS_WATCH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^NODE_INSPECT_RESUME_ON_START$|^ELECTRON_NO_SANDBOX$|^ELECTRON_DISABLE_SANDBOX$|^ELECTRON_EXTRA_LAUNCH_ARGS$/.test(key)) delete environment[key];
environment.ATLAS_WATCH_DB = database;
const report = { result: 'FAIL', phase, startedAt: new Date().toISOString(), executable, archive, archiveSha256: archiveHash(), framework: `playwright-core ${frameworkVersion}`, frameworkSource: 'bundled Codex runtime; no application dependency added', documentation: 'https://playwright.dev/docs/api/class-electron', chromiumSandbox: true, bypassCSP: false, ignoreHTTPSErrors: false, isolatedInstrumentedProcess: true, normalUninstrumentedLaunch: false, profile, database, genuineProfileAccessed: false, installerExecuted: false, nativePickerOperated: false, defaultBrowserOpened: false, checks: {}, screenshots: [], errors: [] };
let application, child, page;
let exit = null;
// Playwright's concurrent startup probes may reject after a failed child launch.
// Retain that framework failure as evidence rather than losing the whole report.
process.on('unhandledRejection', error => {
  report.frameworkStartupErrors ??= [];
  if (report.frameworkStartupErrors.length < 5) report.frameworkStartupErrors.push(String(error?.message ?? error).slice(0, 1000));
});
try {
  application = await _electron.launch({ executablePath: executable, chromiumSandbox: true, args: [`--user-data-dir=${profile}`], cwd: dirname(executable), env: environment, timeout: 45000 });
  child = application.process();
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  report.pid = child.pid;
  page = await application.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => { if (report.errors.length < 10) report.errors.push(String(error.message).slice(0, 600)); });
  const security = await application.evaluate(({ app, BrowserWindow }) => ({
    isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
    noSandbox: app.commandLine.hasSwitch('no-sandbox'), disableWebSecurity: app.commandLine.hasSwitch('disable-web-security'),
    ignoreCertificateErrors: app.commandLine.hasSwitch('ignore-certificate-errors'),
    testEnvironmentNames: Object.keys(process.env).filter(name => /^ATLAS_WATCH_/.test(name)),
    instrumentedArguments: process.argv.filter(arg => /inspect|remote-debugging|sandbox|user-data-dir/.test(arg)),
    windows: BrowserWindow.getAllWindows().map(window => {
      const preferences = window.webContents.getLastWebPreferences();
      return { contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity, url: window.webContents.getURL() };
    }),
  }));
  report.security = security;
  assert.equal(security.isPackaged, true); assert.equal(resolve(security.appPath), resolve(archive));
  assert.equal(resolve(security.userData).toLowerCase(), resolve(profile).toLowerCase());
  assert.equal(security.noSandbox, false); assert.equal(security.disableWebSecurity, false); assert.equal(security.ignoreCertificateErrors, false);
  assert.deepEqual(security.testEnvironmentNames, ['ATLAS_WATCH_DB']);
  assert(security.windows.length && security.windows.every(window => window.contextIsolation === true && window.sandbox === true && window.nodeIntegration === false && window.webSecurity === true));
  report.checks.packagedArchive = true; report.checks.isolatedProfile = true; report.checks.securityPreserved = true;
  await page.getByRole('button', { name: 'Data', exact: true }).waitFor({ state: 'visible' });
  report.renderer = await page.evaluate(() => {
    const smoke = window.__atlasSmoke;
    return { url: location.href, requireType: typeof window.require, processType: typeof window.process,
      passiveSmokeStatusPresent: !!smoke, smokeFunctionNames: smoke ? Object.keys(smoke).filter(key => typeof smoke[key] === 'function') : [],
      smokeStatusKeys: smoke ? Object.keys(smoke).slice(0, 20) : [] };
  });
  assert.equal(report.renderer.requireType, 'undefined'); assert.equal(report.renderer.processType, 'undefined'); assert.deepEqual(report.renderer.smokeFunctionNames, []);
  report.checks.noActiveSmokeActions = true;
  report.smokeHookLimit = 'The package exposes passive renderer status counters under __atlasSmoke; no callable actions were present. Main smoke/offline/script execution is guarded by app.isPackaged and no enabling environment variables were passed.';
  const initialShot = join(screenshots, `${phase}-data.png`);
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  await page.getByRole('button', { name: 'Briefing', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'visible' });
  report.checks.dataToBriefing = true;
  if (phase === 'before') {
    const preview = page.frameLocator('iframe[title="Briefing preview"]');
    await preview.locator('h1').waitFor({ state: 'visible' });
    report.locationBriefing = { heading: await preview.locator('h1').innerText(), excerpt: (await preview.locator('body').innerText()).slice(0, 1800), dialogTitle: await dialog.locator('h2').innerText() };
    assert.match(report.locationBriefing.heading, /location briefing/i);
    report.checks.renderedLocationReport = true;
    await page.screenshot({ path: initialShot }); report.screenshots.push(initialShot);
  } else {
    await dialog.getByRole('button', { name: 'Since last visit', exact: true }).click();
    const preview = dialog.getByRole('document', { name: 'Briefing preview', exact: true });
    await preview.getByRole('heading', { level: 1, name: /last.visit/i }).waitFor({ state: 'visible' });
    report.visitBriefing = { heading: await preview.locator('h1').innerText(), excerpt: (await preview.innerText()).slice(0, 3400) };
    assert.match(report.visitBriefing.excerpt, /first.*visit|no.*previous|no earlier|baseline|not available/i);
    assert.match(report.visitBriefing.excerpt, /not zero changes|Unknown change/i);
    report.checks.renderedVisitReport = true;
    const shot = join(screenshots, `${phase}-visit.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    await dialog.getByRole('button', { name: 'Location briefing', exact: true }).click();
    await dialog.getByText('Choose at least one location to preview, or use Since last visit.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await dialog.getByRole('button', { name: 'Export PDF…', exact: true }).isDisabled(), true);
    report.checks.emptyLocationModeExplicit = true;
    // Explicit manual test location in the fresh TEMP database, through normal validated IPC.
    // No source observations or production provider responses are substituted.
    report.manualTestLocation = await page.evaluate(async () => {
      const location = await window.atlas.createLocation({ name: 'QA packaged UI location — Washington', category: 'Manual isolated test fixture', notes: '', lat: 38.9, lon: -77.03, radiusKm: 1 });
      return { id: location.id, name: location.name, lat: location.lat, lon: location.lon, radiusKm: location.radiusKm, source: 'Manual local test setup; not a provider observation' };
    });
    await dialog.getByText(report.manualTestLocation.name, { exact: true }).waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'All', exact: true }).click();
    const locationPreview = dialog.getByRole('document', { name: 'Briefing preview', exact: true });
    await locationPreview.getByRole('heading', { level: 1, name: 'Atlas Watch location briefing', exact: true }).waitFor({ state: 'visible' });
    await locationPreview.getByRole('heading', { name: report.manualTestLocation.name, exact: true }).waitFor({ state: 'visible' });
    report.locationBriefing = { heading: await locationPreview.locator('h1').innerText(), excerpt: (await locationPreview.innerText()).slice(0, 3000), dialogTitle: await dialog.getByRole('heading', { name: 'Location briefing', exact: true }).innerText() };
    assert.match(report.locationBriefing.excerpt, /1 location\(s\)/);
    report.checks.renderedLocationReport = true;
    const sourceTable = locationPreview.getByRole('table').first();
    await sourceTable.scrollIntoViewIfNeeded();
    report.locationWordLayout = await sourceTable.evaluate(table => {
      const preview = table.closest('[role="document"]');
      const visible = preview.getBoundingClientRect(), bounds = table.getBoundingClientRect();
      const cells = [...table.querySelectorAll('th,td')].filter(cell => ['Status', 'Records', 'Current'].includes(cell.textContent.trim())).map(cell => {
        const nodes = [], walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) if (node.textContent.trim()) nodes.push(node);
        const range = document.createRange();
        range.setStart(nodes[0], 0); range.setEnd(nodes.at(-1), nodes.at(-1).textContent.length);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        const lines = new Set(rects.map(rect => Math.round(rect.top * 2) / 2));
        return { word: cell.textContent.trim(), lineCount: lines.size, visible: rects.length > 0 && rects.every(rect => rect.top >= visible.top && rect.bottom <= visible.bottom && rect.left >= visible.left && rect.right <= visible.right), rects: rects.map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) };
      });
      return { width: innerWidth, height: innerHeight, tableVisible: bounds.top >= visible.top && bounds.bottom <= visible.bottom, cells };
    });
    assert.equal(report.locationWordLayout.width, 1440, 'Check the unchanged default packaged window width.');
    assert.equal(report.locationWordLayout.height, 900, 'Check the unchanged default packaged window height.');
    assert.equal(report.locationWordLayout.tableVisible, true, 'Keep the complete source table in the visible preview.');
    assert.equal(report.locationWordLayout.cells.filter(cell => cell.word === 'Status').length, 1);
    assert.equal(report.locationWordLayout.cells.filter(cell => cell.word === 'Records').length, 1);
    assert.equal(report.locationWordLayout.cells.filter(cell => cell.word === 'Current').length, 2);
    assert(report.locationWordLayout.cells.every(cell => cell.lineCount === 1 && cell.visible), 'Status, Records and both Current cells must each occupy one visible text line.');
    report.checks.locationWordsStayWhole = true;
    const locationShot = join(screenshots, `${phase}-location.png`); await page.screenshot({ path: locationShot }); report.screenshots.push(locationShot);
  }
  assert.equal(report.errors.length, 0, 'Packaged renderer raised an exception.');
  report.result = 'PASS';
} catch (error) {
  report.failure = { name: error.name, message: String(error.message).slice(0, 5000) };
  if (page) { const shot = join(screenshots, `${phase}-failure.png`); try { await page.screenshot({ path: shot, timeout: 5000 }); report.screenshots.push(shot); } catch {} }
} finally {
  if (application) {
    try { await application.close(); report.closedByRunner = true; }
    catch (error) { report.closeError = String(error.message).slice(0, 1000); try { child?.kill(); } catch {} }
  }
  report.exit = exit;
  report.finishedAt = new Date().toISOString(); report.archiveStableDuringRun = report.archiveSha256 === archiveHash();
  if (!report.archiveStableDuringRun || !report.closedByRunner) report.result = 'FAIL';
  if (existsSync(database)) {
    let db;
    try {
      db = new DatabaseSync(database, { readOnly: true });
      report.localDatabase = { caches: db.prepare('SELECT feed,fetched_at,source_updated_at FROM feed_cache ORDER BY feed').all(), epochs: db.prepare('SELECT feed,COUNT(*) AS observations FROM timeline_epochs GROUP BY feed').all(), savedPlaces: Number(db.prepare('SELECT COUNT(*) AS n FROM locations').get().n), customerCredentialRows: Number(db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'secret:%'").get().n) };
    } catch (error) { report.databaseInspectionError = String(error.message).slice(0, 500); }
    finally { db?.close(); }
  }
  writeFileSync(logPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`PACKAGED_PLAYWRIGHT_RESULT ${JSON.stringify(report)}`);
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
