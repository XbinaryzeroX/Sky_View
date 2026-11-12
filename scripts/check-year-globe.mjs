// Check actual globe rendering for older and current archive years.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.env.ATLAS_MAP_QA_EXE || 'release/win-unpacked/Atlas Watch.exe');
const profile = await mkdtemp(join(tmpdir(), 'atlas-year-globe-'));
const env = { ...process.env, ATLAS_WATCH_DB: join(profile, 'qa.sqlite') };
for (const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS']) delete env[k];
const folder = resolve('docs/screenshots/year-globe');
await mkdir(folder, { recursive: true });
const report = { result: 'FAIL', archive: createHash('sha256').update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'), views: [], errors: [] };
let app;
try {
  app = await loadPlaywrightRuntime().electron.launch({ executablePath: exe, args: ['--user-data-dir=' + profile], env, chromiumSandbox: true });
  await app.context().route(/https:\/\/[^/]*googleapis\.com\//, route => route.abort());
  const page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(() => window.atlas.updateSettings({ basemap: 'atlas', layersEnabled: [], terrainEnabled: false, labelsOverlay: false, radarEnabled: false, geoLabels: 'off', buildings3d: false }));
  const close = page.getByRole('button', { name: /^Close Layers/i });
  if (await close.isVisible()) await close.click();
  const picker = page.getByRole('combobox', { name: 'Satellite imagery year' });
  for (const year of [2000, 2001, 2026]) {
    await picker.selectOption(String(year));
    await page.evaluate(() => window.__atlasDebug.setView(0, 110, 19000000, -90));
    await delay(6000);
    await page.waitForFunction(() => window.__atlasDebug.diag().tilesPending === 0, undefined, { timeout: 90000 });
    await delay(6000);
    const sources = await page.evaluate(() => window.__atlasDebug.diag().basemapSources);
    assert(sources.some(source => source.captureDate?.startsWith(String(year))), 'Selected year must match the displayed source');
    const screenshot = await page.screenshot({ path: join(folder, `${year}.png`) });
    const pixels = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let dark = 0, count = 0;
    for (let y = 0; y < pixels.info.height; y++) for (let x = 0; x < pixels.info.width; x++) {
      const dx = (x / pixels.info.width - .525) / .17;
      const dy = (y / pixels.info.height - .51) / .27;
      if (dx * dx + dy * dy > 1) continue;
      const i = (y * pixels.info.width + x) * 3;
      count++;
      if (Math.max(pixels.data[i], pixels.data[i+1], pixels.data[i+2]) < 8) dark++;
    }
    const darkFraction = dark / count;
    report.views.push({ year, sources, darkFraction });
    assert(darkFraction < .025, `Globe has black swath gaps or has not loaded (${darkFraction})`);
  }
  assert.deepEqual(report.errors, []);
  report.result = 'PASS';
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await app?.close();
  await writeFile(resolve('docs/year-globe.log'), JSON.stringify(report, null, 2) + '\n');
  console.log(report);
}
