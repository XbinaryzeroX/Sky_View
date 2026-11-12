import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const profile = await mkdtemp(join(tmpdir(), 'atlas-arctic-line-'));
const db = new DatabaseSync(join(profile, 'state.sqlite'));
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT INTO meta VALUES (?,?)').run('settings',JSON.stringify({basemap:'atlas',imageryYear:null,terrainEnabled:false,labelsOverlay:false,geoLabels:'off',layersEnabled:[],buildings3d:false,radarEnabled:false}));
db.close();
const env={...process.env,ATLAS_WATCH_DB:join(profile,'state.sqlite')};
for(const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS']) delete env[k];
const app=await loadPlaywrightRuntime().electron.launch({executablePath:resolve(process.env.ATLAS_MAP_QA_EXE || 'release/arctic-lines/win-unpacked/Atlas Watch.exe'),args:['--user-data-dir='+profile],env,chromiumSandbox:true});
try {
  const page=await app.firstWindow();
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  const camera = { lat:Number(process.env.ATLAS_LINE_LAT ?? 89), height:Number(process.env.ATLAS_LINE_HEIGHT ?? 3500000) };
  await page.evaluate(camera=>window.__atlasDebug.setView(camera.lat,0,camera.height,-90),camera);
  await page.waitForFunction(camera=>Math.abs(window.__atlasDebug.diag().cameraLat-camera.lat)<.1 && Math.abs(window.__atlasDebug.diag().cameraHeightM-camera.height)<camera.height*.1,camera);
  await page.waitForTimeout(5000);
  const layers=await page.evaluate(()=>{
    const canvas=document.querySelector('.cesium-widget canvas');let w;
    for(let el=canvas;el&&!w;el=el.parentElement){const k=Object.keys(el).find(key=>key.startsWith('__reactFiber$'));for(let f=el[k];f&&!w;f=f.return)for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState?.current;if(v?.canvas===canvas&&v.scene?.postRender){w=v;break;}}}
    if(!w)throw Error('Map widget unavailable');window.__lineWidget=w;
    return Array.from({length:w.imageryLayers.length},(_,i)=>({i,url:String(w.imageryLayers.get(i).imageryProvider?.url||'')}));
  });
  await mkdir('docs/screenshots/arctic-line',{recursive:true});
  async function shot(name){await page.evaluate(()=>{const w=window.__lineWidget;return new Promise(done=>{const off=w.scene.postRender.addEventListener(()=>{off();done();});w.scene.requestRender();});});await page.screenshot({path:`docs/screenshots/arctic-line/${name}.png`});}
  await shot('baseline');
  await page.evaluate(()=>{const w=window.__lineWidget;for(let i=0;i<w.scene.primitives.length;i++)w.scene.primitives.get(i).show=false;});
  await shot('without-primitives');
  for(const i of [0,1,2,3]) {
    await page.evaluate(i=>{const w=window.__lineWidget;w.imageryLayers.get(i).show=false;},i);
    await shot('without-'+i);
    await page.evaluate(i=>{const w=window.__lineWidget;w.imageryLayers.get(i).show=true;},i);
  }
  await writeFile('docs/arctic-line-layers.json',JSON.stringify(layers,null,2));
  console.log(layers);
} finally {await app.close();}
