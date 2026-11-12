// Measure tile levels actually drawn at the camera center in an isolated packaged desktop app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.env.ATLAS_MAP_QA_EXE || 'release/flight-card/win-unpacked/Atlas Watch.exe');
const run = process.argv.includes('--before') ? 'before' : 'after';
const offline = process.argv.includes('--offline');
const radar = process.argv.includes('--radar');
const stalled = process.argv.includes('--stalled-overlays');
const tag = run + (offline ? '-offline' : '') + (radar ? '-radar' : '') + (stalled ? '-stalled' : '');
const output = resolve('docs/screenshots/basemap-loading');
const profile = await mkdtemp(join(tmpdir(), 'atlas-basemap-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('ATLAS_WATCH_') || ['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX'].includes(key)) delete env[key];
env.ATLAS_WATCH_DB = join(profile, 'private.sqlite');
if (radar) {
  const db = new DatabaseSync(env.ATLAS_WATCH_DB);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('settings',JSON.stringify({radarEnabled:true}));
  db.close();
}
const report = { startedAt: new Date().toISOString(), mode: offline ? 'Chromium offline' : 'Live public network', result:'FAIL',
  asar: createHash('sha256').update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'), views: [], errors: [] };
await mkdir(output, {recursive:true});

// Inspect Cesium's quadtree in the test renderer only, as the flight-follow acceptance probe does.
function installProbe() {
  performance.setResourceTimingBufferSize(12000);
  const canvas = document.querySelector('.cesium-widget canvas');
  let w;
  for (let el = canvas; el && !w; el = el.parentElement) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    for (let f = el[key]; f && !w; f = f.return) {
      for (let hook = f.memoizedState; hook; hook = hook.next) {
        const ref = hook.memoizedState?.current;
        if (ref?.scene?.postRender && ref?.dataSources && ref.canvas === canvas) { w=ref; break; }
      }
    }
  }
  if (!w) throw new Error('Cesium widget unavailable');
  window.__qaBasemap = () => {
    const s = w.scene, globe = s.globe, cam = w.camera.positionCartographic;
    const covers = r => r && r.south <= cam.latitude && r.north >= cam.latitude && (r.west <= r.east ? r.west <= cam.longitude && r.east >= cam.longitude : r.west <= cam.longitude || r.east >= cam.longitude);
    const tiles = globe._surface._tilesToRender;
    const t = tiles.find(tile=>covers(tile.rectangle));
    const layers = [];
    for (const binding of t?.data?.imagery ?? []) {
      const i = binding.readyImagery;
      if (!i || !covers(i.rectangle) || (i.imageryLayer.rectangle && !covers(i.imageryLayer.rectangle))) continue;
      const p = i.imageryLayer.imageryProvider;
      // Only path and host of keyless providers; no query strings or credentials.
      const raw = p.url ?? p._resource?.url ?? p._url ?? p.credit?.html ?? p.constructor.name;
      const url = String(raw).split('?')[0].replace(/<[^>]*>/g,'').slice(0,190);
      const texture = i.textureWebMercator ?? i.texture;
      const layer = {slot:w.imageryLayers.indexOf(i.imageryLayer), level:i.level, x:i.x, y:i.y,
        textureWidth:texture?.width??null, textureHeight:texture?.height??null, source:url};
      if (!layers.some(l=>l.slot===layer.slot && l.level===layer.level)) layers.push(layer);
    }
    const d = window.__atlasDebug.diag();
    return {terrainLevel:t?.level??null, layers, visible:tiles.length, pending:d.tilesPending,
      renderedMax:d.maxRenderedLevel, imageryErrors:d.imageryErrors, lastError:d.lastImageryError, renderErrors:d.renderErrors,
      terrain:d.terrain?{requested:d.terrain.requested,loaded:d.terrain.loaded,failed:d.terrain.failed}:null};
  };
}

const root = performance.now(), ms = () => Math.round(performance.now()-root);
let app, page;
const events = [];
const held = [];
try {
  const {electron}=loadPlaywrightRuntime();
  const args=['--user-data-dir='+profile];
  if (offline) args.push('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost');
  app=await electron.launch({executablePath:exe,args,env,chromiumSandbox:true});
  if(stalled) await app.context().route(/^https:\/\/(?:tiles\.openfreemap\.org|nowcoast\.noaa\.gov)\//,route=>{held.push(route);});
  assert(await app.evaluate(({app},p)=>app.isPackaged&&app.getPath('userData').toLowerCase()===p.toLowerCase(),profile));
  page=await app.firstWindow();
  if(offline) await page.context().setOffline(true);
  page.on('pageerror',e=>report.errors.push(e.message));
  for (const type of ['response','requestfailed']) page.on(type,item=>{
    const url=new URL(item.url());
    if (!['https:','app:'].includes(url.protocol)) return;
    const key=url.host+url.pathname;
    if (!/bluemarble|nationalmap|gibs|terrarium|openfreemap|nowcoast|NaturalEarthII|\/basemap-overview\//i.test(key)) return;
    events.push({at:ms(),host:url.host,path:url.pathname,status:type==='response'?item.status():item.failure()?.errorText??'failed'});
  });
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  report.globeReadyMs=ms();
  await page.evaluate(installProbe);
  const settings=await page.evaluate(()=>window.atlas.getState().then(s=>s.settings));
  if(settings) report.settings=Object.fromEntries(['basemap','renderQuality','terrainEnabled','labelsOverlay','radarEnabled'].map(k=>[k,settings[k]]));
  if(radar) assert.equal(report.settings.radarEnabled,true);
  const views=[['us',38.4,-99,5_200_000,16000]];
  if (!radar && !offline) views.push(['regional',39,-106,350_000,12000],['city',39.74,-104.99,18_000,16000]);
  for(const [label,lat,lon,heightM,limit] of views) {
    await page.evaluate(({lat,lon,heightM})=>window.__atlasDebug.setView(lat,lon,heightM),{lat,lon,heightM});
    const start=ms(), v={label,lat,lon,heightM,samples:[]};
    report.views.push(v);
    let shot=false,last='',lastSeen=-1e8;
    while(ms()-start<limit) {
      const s=await page.evaluate(()=>window.__qaBasemap());
      const elapsedMs=ms()-start, key=JSON.stringify([s.terrainLevel,s.layers.map(l=>[l.slot,l.level,l.textureWidth])]);
      if(last!==key || elapsedMs-lastSeen>=3000) {v.samples.push({elapsedMs,...s});last=key;lastSeen=elapsedMs;}
      if(!shot&&elapsedMs>=1400) {
        v.earlyScreenshotStartMs=ms()-start;
        await page.screenshot({path:join(output,tag+'-'+label+'-early.png')});shot=true;
        v.earlyScreenshotEndMs=ms()-start;
      }
      await sleep(160);
    }
    await page.screenshot({path:join(output,tag+'-'+label+'-final.png')});
    v.final=await page.evaluate(()=>window.__qaBasemap());
    v.bundledOverviewResources=await page.evaluate(()=>performance.getEntriesByType('resource')
      .filter(r=>r.name.startsWith('app://atlas/basemap-overview/')).length);
    const activity=events.filter(e=>e.at>=start);
    const counts={};
    for(const e of activity) {const key=e.host+' '+e.status; counts[key]=(counts[key]??0)+1;}
    v.responses=counts;
    v.localOverviewResponses=activity.filter(e=>e.host==='atlas'&&e.path.startsWith('/basemap-overview/')&&e.status===200).length;
    v.firstLocalOverviewMs=(activity.find(e=>e.host==='atlas'&&e.path.startsWith('/basemap-overview/')&&e.status===200)?.at??NaN)-start;
    v.firstResponses=Object.values(activity.reduce((byHost,e)=>{const k=e.host+' '+e.status;byHost[k]??={atMs:e.at-start,path:e.path,status:e.status};return byHost},{}));
    assert.equal(v.final.renderErrors,0);
    if (run==='after'&&label==='us') {
      const landBase = layer => layer.source.includes('BlueMarble') || layer.source.includes('basemap-overview');
      assert(v.final.layers.some(l=>landBase(l)&&l.level>=3&&l.textureWidth>=256),'Detailed land base reached the U.S. overview');
      // Playwright's request interception can hide app:// protocol response events. The
      // overview's 1024px textures are unique to the packaged tiles (the remote WMTS uses 256px).
      const drewPackagedOverview=v.samples.some(s=>s.layers.some(l=>landBase(l)&&l.level<=3&&l.textureWidth===1024));
      assert(v.bundledOverviewResources>0 || events.some(e=>e.host==='atlas'&&e.path.startsWith('/basemap-overview/')&&e.status===200)
        || (stalled&&drewPackagedOverview),'Packaged local basemap loaded');
    }
    if (!offline && !stalled) {
      if(label==='us') assert(v.final.layers.some(l=>(l.source.includes('BlueMarble') || l.source.includes('basemap-overview'))&&l.level>=4),'U.S. overview reached detailed imagery');
      if(label==='city') assert(v.final.layers.some(l=>l.source.includes('nationalmap')&&l.level>=11),'Detailed U.S. orthoimagery reached the city center');
    }
    console.log(label,JSON.stringify({response:counts,firstLayers:v.samples.find(s=>s.layers.length),final:v.final}));
  }
  if(stalled) {
    report.heldRequests = held.map(r=>new URL(r.request().url()).hostname)
      .reduce((counts,host)=>{counts[host]=(counts[host]??0)+1;return counts;},{});
    assert(held.length>0,'Optional map requests were held open during observation');
  }
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
} catch(e) {
  process.exitCode=1;
  report.failure=String(e?.stack??e);
} finally {
  if(app) await app.close();
  await writeFile(resolve('docs/basemap-loading-'+tag+'.log'), JSON.stringify(report,null,2)+'\n');
  console.log(report.result,report.failure??'',report.globeReadyMs,report.asar);
}
