// Live packaged UI, its real market IPC and an isolated watchlist.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.argv[2] || 'release/win-unpacked/Atlas Watch.exe');
const profile = await mkdtemp(join(tmpdir(), 'atlas-markets-'));
const output = resolve('docs/screenshots/trending-markets');
await mkdir(output, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX', 'NODE_OPTIONS'].includes(key)) delete env[key];
}
env.ATLAS_WATCH_DB = join(profile, 'markets.sqlite');
const report = { time: new Date().toISOString(), result: 'FAIL', asar: createHash('sha256')
  .update(await readFile(join(dirname(exe), 'resources/app.asar'))).digest('hex'), assetsChecked: [], errors: [] };
let app, page;
try {
  const { electron } = loadPlaywrightRuntime();
  app = await electron.launch({ executablePath: exe, args: ['--user-data-dir=' + profile], env, chromiumSandbox: true });
  page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.getByRole('button', { name: 'Markets', exact: true }).waitFor();
  const saved = ['IBM'];
  await page.evaluate(symbols => window.atlas.updateSettings({ marketWatchlist: symbols }), saved);
  // Observe the final OS handoff without starting a browser. Main's ordinary URL validation remains active.
  await app.evaluate(({ shell }) => {
    globalThis.marketQaOpened = [];
    shell.openExternal = async url => { globalThis.marketQaOpened.push(url); };
  });
  await page.getByRole('button', { name: 'Markets', exact: true }).click();
  const controls = page.getByRole('group', { name: 'Market view' });
  assert.equal(await controls.getByRole('button', { name: 'Trending' }).getAttribute('aria-pressed'), 'true');
  const rows = page.locator('.market-ranking button');
  await rows.first().waitFor({ timeout: 45000 });
  const ranking = await page.evaluate(() => window.atlas.marketsTrending());
  const symbols = await rows.evaluateAll(buttons => buttons.map(button => button.dataset.symbol));
  assert.deepEqual(symbols, ranking.items.map(item => item.symbol));
  assert(symbols.length > 0 && symbols.length <= 10);
  assert(ranking.items.every((item, index) => !index || item.volume <= ranking.items[index - 1].volume));
  report.ranking = { source: ranking.source, retrieved: ranking.fetchedAt, symbols };
  await page.screenshot({ path: join(output, 'ranking.png') });
  // Some genuine ticker feeds have no summaries. Check the next ranked asset if necessary.
  for (const [index, symbol] of symbols.entries()) {
    await rows.nth(index).click();
    const detail = page.getByRole('region', { name: 'Market details for ' + symbol });
    await detail.getByRole('heading', { name: 'Related news' }).waitFor();
    await detail.getByRole('status').waitFor({ state: 'hidden', timeout: 45000 });
    const articles = detail.locator('.market-news li');
    const card = articles.filter({ has: page.locator('.market-article-summary') }).first();
    report.assetsChecked.push({ symbol, articles: await articles.count(), error: await detail.getByRole('alert').allTextContents() });
    if (await card.count()) {
      const link = card.getByRole('link');
      const url = await link.getAttribute('href');
      const preview = await card.locator('.market-article-summary').innerText();
      assert(preview.trim() && preview !== await card.getByRole('heading').innerText());
      assert(await card.evaluate(element => {
        const link = element.querySelector('a'), preview = element.querySelector('.market-article-summary');
        return preview.getBoundingClientRect().height > 0 && (preview.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      }));
      assert.deepEqual(await app.evaluate(() => globalThis.marketQaOpened), []);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, 'article-preview.png') });
      await link.click();
      const handoff = await app.evaluate(async () => {
        for (let attempt = 0; !globalThis.marketQaOpened.length && attempt < 50; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        return globalThis.marketQaOpened;
      });
      assert.deepEqual(handoff, [url]);
      report.selected = { symbol, summaryCharacters: preview.length, destination: new URL(url).hostname, externalHandoff: 'captured after main validation' };
    }
    await detail.getByRole('button', { name: 'Back to trending' }).click();
    await rows.nth(index).waitFor();
    assert(await rows.nth(index).evaluate(button => document.activeElement === button));
    if (report.selected) break;
  }
  assert(report.selected, 'The tested ranking returned no publisher summary');
  assert.deepEqual(await page.evaluate(async () => (await window.atlas.getState()).settings.marketWatchlist), saved);
  const configured = await page.evaluate(async () => {
    const provider = (await window.atlas.getState()).settings.marketProvider;
    return (await window.atlas.listProviders()).some(row => row.id === provider && row.configured);
  });
  // Keep this ranking test from issuing a credentialed quote in a package with a built-in provider key.
  if (configured) await page.evaluate(() => window.atlas.updateSettings({ marketWatchlist: [] }));
  await controls.getByRole('button', { name: 'Watchlist' }).click();
  await page.getByRole('heading', { name: 'Market watchlist', exact: true }).waitFor();
  if (configured) await page.getByRole('textbox', { name: 'Search symbols' }).waitFor();
  else await page.getByText('Saved symbols · IBM', { exact: true }).waitFor();
  report.watchlist = { preservedDuringTrending: true, providerConfigured: configured, opened: true };
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.failure = error.message;
  report.visibleError = await page?.locator('.wide-page [role="alert"]').allTextContents().catch(() => []);
  process.exitCode = 1;
} finally {
  await app?.close();
  await writeFile(resolve('docs/trending-markets-packaged.log'), JSON.stringify(report, null, 2) + '\n');
  console.log(report);
}
