import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const profile = await mkdtemp(join(tmpdir(), 'atlas-building-check-'));
const env = { ...process.env, ATLAS_WATCH_DB: join(profile, 'test.sqlite') };
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_SANDBOX', 'NODE_OPTIONS']) delete env[key];
const app = await loadPlaywrightRuntime().electron.launch({
  executablePath: resolve(process.env.ATLAS_MAP_QA_EXE ?? 'release/imagery-update/win-unpacked/Atlas Watch.exe'),
  args: ['--user-data-dir=' + profile], env, chromiumSandbox: true,
});
const result = { errors: [] };
try {
  await app.context().route(/https:\/\/[^/]*googleapis\.com\//, route => route.abort());
  const page = await app.firstWindow();
  page.on('pageerror', error => result.errors.push(error.message));
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(() => window.atlas.updateSettings({basemap:'atlas', buildings3d:true, imageryYear:null, terrainEnabled:false, radarEnabled:false, layersEnabled:[]}));
  await page.evaluate(() => window.__atlasDebug.setView(40.7128, -74.006, 3000, -40));
  await delay(5000);
  result.atlas = await page.evaluate(() => window.__atlasDebug.diag().buildings);
  assert.equal(result.atlas.visible, true, 'OSM buildings should remain available on the Atlas surface');
  await page.evaluate(() => window.atlas.updateSettings({basemap:'google3d'}));
  await page.reload();
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await delay(3000);
  await page.evaluate(() => window.__atlasDebug.setView(40.7128, -74.006, 3100, -40));
  await delay(1000);
  result.photoreal = await page.evaluate(() => window.__atlasDebug.diag().buildings);
  assert.equal(result.photoreal.visible, false, 'OSM buildings must be hidden in Photoreal 3D mode');
  await page.evaluate(() => window.atlas.updateSettings({basemap:'atlas'}));
  await page.reload();
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  await delay(3000);
  await page.evaluate(() => window.__atlasDebug.setView(40.7128, -74.006, 3000, -40));
  await delay(1000);
  result.restored = await page.evaluate(() => window.__atlasDebug.diag().buildings);
  assert.equal(result.restored.visible, true, 'OSM buildings should return on the Atlas surface');
  await page.evaluate(() => window.__atlasDebug.setView(39, -98, 19000000, -90));
  await delay(4000);
  await page.screenshot({path:resolve('docs/screenshots/imagery-restored.png')});
  assert.deepEqual(result.errors, []);
  result.result = 'PASS';
} finally {
  await app.close();
  await writeFile(resolve('docs/photoreal-buildings-check.log'), JSON.stringify(result, null, 2));
  console.log(result);
}
