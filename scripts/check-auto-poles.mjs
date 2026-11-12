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
  for (const [name,lat,lon,height] of [['north-wide',89,0,8000000],['north',89,0,3500000],['north-close',89,0,350000],['south',-89,0,3500000]]) {
    await page.evaluate(([lat,lon,height]) => window.__atlasDebug.setView(lat,lon,height,-90),[lat,lon,height]);
    await page.waitForFunction(({lat,height}) => {
      const view = window.__atlasDebug.diag();
      return Math.abs(view.cameraLat-lat) < 0.1 && Math.abs(view.cameraHeightM-height) < height * 0.1;
    }, {lat,height}, {timeout:30000});
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const canvas = document.querySelector('.cesium-widget canvas');
      let widget;
      for (let el = canvas; el && !widget; el = el.parentElement) {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        for (let fiber = el[key]; fiber && !widget; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const candidate = hook.memoizedState?.current;
          if (candidate?.canvas === canvas && candidate?.scene?.postRender) { widget = candidate; break; }
        }
      }
      if (!widget) throw new Error('Map widget unavailable');
      return new Promise(resolve => {
        const remove = widget.scene.postRender.addEventListener(() => { remove(); resolve(); });
        widget.scene.requestRender();
      });
    });
    await page.screenshot({path:`docs/screenshots/auto-poles/${name}.png`});
    console.log(name, await page.evaluate(() => window.__atlasDebug.diag().tilesPending));
  }
} finally { await app.close(); }
