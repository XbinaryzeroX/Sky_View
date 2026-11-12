// Read real publisher reports via the packaged Events page, then repeat with a controlled network outage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const executable = resolve(process.env.ATLAS_CONFLICT_QA_EXE || 'release/flight-card/win-unpacked/Atlas Watch.exe');
const temp = await mkdtemp(join(tmpdir(), 'atlas-conflict-status-'));
const profile = join(temp, 'profile'), dbFile = join(temp, 'isolated.sqlite');
const output = resolve('docs/screenshots/conflict-updates');
const archive = await readFile(join(dirname(executable), 'resources/app.asar'));
const result = { result: 'FAIL', startedAt: new Date().toISOString(), archiveSha256: createHash('sha256').update(archive).digest('hex'), checks: [] };
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX'].includes(key)) delete env[key];
}
env.ATLAS_WATCH_DB = dbFile;
const { electron } = loadPlaywrightRuntime();
await mkdir(output, { recursive: true });
let app;
let stage = 'launch';
const errors = [];

async function events(offline) {
  app = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], env, chromiumSandbox: true });
  assert(await app.evaluate(({ app }, path) => app.isPackaged && app.getPath('userData').toLowerCase() === path.toLowerCase(), profile));
  if (offline) await app.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      if (['www.cfr.org', 'reliefweb.int', 'news.un.org'].includes(url.hostname)) return Promise.resolve(new Response('Outage fixture', { status: 503 }));
      return originalFetch(input, init);
    };
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('button', { name: 'Conflict updates', exact: true }).click();
  return page;
}

try {
  const page = await events(false);
  stage = 'live humanitarian publications';
  const reportsRegion = page.getByRole('region', { name: 'Humanitarian reports', exact: true });
  const reports = await page.evaluate(() => window.atlas.conflictReports());
  assert.equal(reports.error, null, reports.error || '');
  assert(reports.checkedAt);
  await reportsRegion.locator('time[datetime="' + reports.checkedAt + '"]').waitFor();
  result.reports = { source: reports.source, coverage: reports.coverage, lastSuccessfulCheck: reports.checkedAt, reportCount: reports.reports.length,
    countries: [...new Set(reports.reports.map(r => r.country))], publishedBy: [...new Set(reports.reports.map(r => r.source))],
    postedFrom: reports.reports.at(-1)?.publishedAt ?? null, postedThrough: reports.reports[0]?.publishedAt ?? null };
  if (reports.reports.length) {
    const first = reports.reports[0];
    await reportsRegion.getByRole('combobox', { name: 'Country or territory' }).selectOption(first.country);
    const link = reportsRegion.getByRole('link', { name: first.title, exact: true });
    assert.equal(await link.getAttribute('href'), first.url);
    await reportsRegion.getByText(first.summary, { exact: true }).first().waitFor();
    await reportsRegion.locator('time[datetime="' + first.publishedAt + '"]').first().waitFor();
    result.checks.push('Country selection showed the publisher title, original report URL, subject digest and posting time.');
  } else await reportsRegion.getByText(/No matching reports/).waitFor();
  await page.screenshot({ path: join(output, 'live-reports.png') });
  stage = 'live CFR assessments';
  await page.getByRole('button', { name: 'CFR assessments', exact: true }).click();
  const assessmentsRegion = page.getByRole('region', { name: 'Conflict assessments', exact: true });
  const assessments = await page.evaluate(() => window.atlas.conflictAssessments());
  assert.equal(assessments.error, null, assessments.error || '');
  assert(assessments.items.length > 0 && assessments.checkedAt);
  await assessmentsRegion.locator('.conflict-assessments li').first().waitFor();
  assert.equal(await assessmentsRegion.locator('.conflict-assessments li').count(), assessments.items.length);
  const selected = assessments.items.find(r => r.region === 'Sub-Saharan Africa') ?? assessments.items[0];
  await assessmentsRegion.getByRole('combobox', { name: 'Region', exact: true }).selectOption(selected.region);
  assert.equal(await assessmentsRegion.locator('.conflict-assessments li').count(), assessments.items.filter(r => r.region === selected.region).length);
  const item = assessmentsRegion.getByRole('listitem').filter({ has: page.getByRole('heading', { name: selected.title, exact: true }) });
  assert.match(await item.innerText(), new RegExp(selected.status));
  assert.equal(await item.getByRole('link', { name: selected.title, exact: true }).getAttribute('href'), 'https://www.cfr.org/global-conflict-tracker/conflict/' + selected.id);
  assert.equal(await assessmentsRegion.getByRole('link', { name: 'CFR Global Conflict Tracker' }).getAttribute('href'), 'https://www.cfr.org/global-conflict-tracker/dashboard');
  result.assessments = { lastSuccessfulCheck: assessments.checkedAt, situations: assessments.items.length,
    regions: [...new Set(assessments.items.map(r => r.region))],
    statuses: Object.fromEntries([...new Set(assessments.items.map(r => r.status))].map(status => [status, assessments.items.filter(r => r.status === status).length])) };
  await page.screenshot({ path: join(output, 'live-assessments.png') });
  result.checks.push('Verified the live CFR count, region filter, assessed trend, dashboard link and exact situation overview.');
  await assessmentsRegion.getByRole('combobox', { name: 'Region', exact: true }).selectOption('');
  const countryLink = assessmentsRegion.getByRole('button', { name: /^Humanitarian reports for / }).first();
  if (await countryLink.count()) {
    const country = (await countryLink.innerText()).replace(/^Humanitarian reports for /, '');
    await countryLink.click();
    assert.equal(await reportsRegion.getByRole('combobox', { name: 'Country or territory' }).inputValue(), country);
    assert.equal(await reportsRegion.locator('.conflict-country').count(), 1);
    result.checks.push('Selected a monitored situation and opened humanitarian reporting filed under ' + country + '.');
  }
  await app.close(); app = undefined;
  stage = 'retained last check after restart and publisher outage';
  const db = new DatabaseSync(dbFile);
  try {
    const change = db.prepare("UPDATE meta SET value=json_set(value, '$.nextCheckAt', '2000-01-01T00:00:00Z') WHERE key IN ('conflict_reports_rss_v1','conflict_news_rss_v1','conflicts:cfr-assessments:v1')").run();
    assert(change.changes >= 2);
  } finally { db.close(); }
  const offline = await events(true);
  const retainedReports = await offline.evaluate(() => window.atlas.conflictReports());
  assert(retainedReports.error); assert.equal(retainedReports.checkedAt, reports.checkedAt);
  assert.deepEqual(retainedReports.reports, reports.reports);
  await offline.getByText(/Showing the last successful check/).waitFor();
  await offline.getByRole('button', { name: 'CFR assessments', exact: true }).click();
  const retainedCfr = await offline.evaluate(() => window.atlas.conflictAssessments());
  assert(retainedCfr.error); assert.equal(retainedCfr.checkedAt, assessments.checkedAt);
  assert.deepEqual(retainedCfr.items, assessments.items);
  await offline.getByText(/Showing the last successful check/).waitFor();
  result.checks.push('Controlled HTTP 503 responses after restart preserved both original successful check times and both complete lists.');
  assert.deepEqual(errors, []);
  result.result = 'PASS';
} catch (error) {
  result.failure = { stage, message: error.message };
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  result.rendererErrors = errors;
  const text = JSON.stringify(result, null, 2) + '\n';
  await writeFile(resolve('docs/conflict-updates-packaged.log'), text);
  console.log(text);
}
