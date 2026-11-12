import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const profile = await mkdtemp(join(tmpdir(), 'atlas-auto-poles-'));
const dbPath = join(profile, 'atlas.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT INTO meta VALUES (?,?)').run('settings', JSON.stringify({ basemap:'atlas', imageryYear:null, buildings3d:false, radarEnabled:false, terrainEnabled:false, labelsOverlay:false, geoLabels:'off', layersEnabled:[] }));
db.close();
const env = { ...process.env, ATLAS_WATCH_DB:dbPath };
for (const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX']) delete env[key];
const app = await loadPlaywrightRuntime().electron.launch({executablePath:resolve(process.argv[2] ?? 'release/win-unpacked/Atlas Watch.exe'),args:['--user-data-dir='+profile],env,chromiumSandbox:true});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__atlasDebug?.setView);
  await page.waitForTimeout(10000);
  await mkdir('docs/screenshots/auto-poles',{recursive:true});
  for (const [name,lat,lon,height] of [['north',89,0,3500000],['north-close',89,0,350000],['south',-89,0,3500000]]) {
    await page.evaluate(([lat,lon,height]) => window.__atlasDebug.setView(lat,lon,height,-90),[lat,lon,height]);
    await page.waitForTimeout(12000);
    await page.screenshot({path:`docs/screenshots/auto-poles/${name}.png`});
    console.log(name, await page.evaluate(() => window.__atlasDebug.diag().tilesPending));
  }
} finally { await app.close(); }
