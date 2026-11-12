import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe=resolve(process.env.ATLAS_MAP_QA_EXE ?? 'release/win-unpacked/Atlas Watch.exe');
const profile=await mkdtemp(join(tmpdir(),'atlas-earth-lighting-'));
const folder=resolve('docs/screenshots/earth-lighting');
await mkdir(folder,{recursive:true});
const env={...process.env};
for(const k of Object.keys(env)) if(k.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS'].includes(k)) delete env[k];
env.ATLAS_WATCH_DB=join(profile,'private.sqlite');
const report={time:new Date().toISOString(),asar:createHash('sha256').update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'),
  result:'FAIL', errors:[], network:{bundled:0,gibs:0},samples:[]};
function probe(){
  const canvas=document.querySelector('.cesium-widget canvas');let w;
  for(let e=canvas;e&&!w;e=e.parentElement){
    const key=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));
    for(let fiber=e[key];fiber&&!w;fiber=fiber.return) for(let hook=fiber.memoizedState;hook;hook=hook.next){
      if(hook.memoizedState?.current?.canvas===canvas&&hook.memoizedState.current.scene?.globe){w=hook.memoizedState.current;break;}
    }
  }
  if(!w)throw Error('Missing widget');
  const lights=()=>Array.from({length:w.imageryLayers.length},(_,i)=>w.imageryLayers.get(i)).filter(l=>/City lights:|Black Marble/.test(l.imageryProvider?.credit?.html));
  window.__lightingQA={
    state:()=>({clock:w.clock.currentTime.toString(), direction:w.scene.light.direction,
      mode:w.scene.mode,layers:lights().length,ready:w.scene.globe._surface._tilesToRender.some(t=>t.data.imagery.some(b=>b.readyImagery?.imageryLayer===lights()[0])),
      detail:w.scene.globe._surface._tilesToRender.some(t=>t.data.imagery.some(b=>b.readyImagery?.imageryLayer===lights()[1]&&b.readyImagery.level>=4))}),
    show:value=>{for(const layer of lights())layer.show=value;w.scene.requestRender();},
    at:(lon,lat)=>{const earth=w.scene.globe.ellipsoid.cartographicToCartesian({longitude:lon*Math.PI/180,latitude:lat*Math.PI/180,height:0});
      const px=w.scene.cartesianToCanvasCoordinates(earth);const r=canvas.getBoundingClientRect();return {x:r.x+px.x,y:r.y+px.y};}
  };
}
let app,page;
const brightness = data => data.reduce((a,b)=>a+b,0)/data.length;
try{
  app=await loadPlaywrightRuntime().electron.launch({executablePath:exe,args:['--user-data-dir='+profile],env,chromiumSandbox:true});
  page=await app.firstWindow();
  page.on('pageerror', e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.ok()&&r.url().includes('/black-marble-2016.jpg'))report.network.bundled++;if(r.ok()&&r.url().includes('/VIIRS_Black_Marble/'))report.network.gibs++;});
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(()=>window.atlas.updateSettings({basemap:'atlas',labelsOverlay:false,radarEnabled:false,geoSatEnabled:false,geoLabels:'off',layersEnabled:[],buildings3d:false,terrainEnabled:true}));
  await page.evaluate(probe);
  // Use the ordinary layer switches so the photographic light contrast is measurable without markers.
  for(const name of [/Weather alert polygons/i,/^Earthquakes$/,/state.*country boundaries/i,/^Airports$/]) {
    const sw=page.getByRole('switch',{name});
    if(await sw.isVisible() && await sw.isChecked()) await sw.uncheck();
  }
  await page.getByRole('button',{name:'Day/night',exact:true}).click();
  await page.getByRole('button',{name:'Choose time',exact:true}).click();
  await page.getByLabel('Lighting date (UTC)',{exact:true}).fill('2025-06-21');
  await page.getByLabel('Lighting time (UTC)',{exact:true}).fill('04:00');
  const clockBefore=await page.evaluate(()=>window.__lightingQA.state().clock);
  for(const mode of ['3D','2D']){
    await page.getByRole('button',{name:mode,exact:true}).click();
    await page.waitForFunction(mode=>window.__lightingQA.state().mode===mode,mode==='3D'?3:2);
    await page.evaluate(()=>window.__atlasDebug.setView(40.7,-74.0,1_900_000,-90));
    await page.getByLabel('Lighting time (UTC)',{exact:true}).fill('04:00');
    await page.waitForFunction(()=>window.__lightingQA.state().ready);
    await delay(1600);
    const at=await page.evaluate(()=>window.__lightingQA.at(-74.0,40.7));
    const clip={x:Math.round(at.x-100),y:Math.round(at.y-72),width:200,height:144};
    const capture=async()=>sharp(await page.screenshot({clip})).removeAlpha().raw().toBuffer();
    const night=await capture();
    await page.screenshot({path:join(folder,mode.toLowerCase()+'-night.png')});
    const state=await page.evaluate(()=>window.__lightingQA.state());
    await page.evaluate(()=>window.__lightingQA.show(false));await delay(550);
    const dark=await capture();
    await page.evaluate(()=>window.__lightingQA.show(true));
    await page.getByLabel('Lighting time (UTC)',{exact:true}).fill('16:00');
    await page.waitForFunction(()=>window.__lightingQA.state().ready);await delay(650);
    const day=await capture();await page.screenshot({path:join(folder,mode.toLowerCase()+'-day.png')});
    await page.evaluate(()=>window.__lightingQA.show(false));await delay(400);
    const dayWithout=await capture();
    await page.evaluate(()=>window.__lightingQA.show(true));
    const delta=(a,b)=>a.reduce((sum,n,i)=>sum+Math.abs(n-b[i]),0)/a.length;
    const s={mode,night:brightness(night),unlitTerrain:brightness(dark),day:brightness(day),nightLightsDelta:delta(night,dark),dayLightsDelta:delta(day,dayWithout),
      layers:state.layers,loadedFineTiles:state.detail, clockUnchanged:clockBefore===state.clock};
    report.samples.push(s);
    assert(s.clockUnchanged && s.layers===2,'Preserve application clock and use both published night sources');
    // City centres can be brighter at night. Compare the same terrain without emitted city light.
    assert(s.day>s.unlitTerrain*1.5&&s.nightLightsDelta>2,'Night-darkened terrain and actual city lights');
    assert(s.dayLightsDelta<1,'The lights must be absent from the day side');
  }
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await page.waitForFunction(()=>window.__lightingQA.state().mode===3);
  await page.evaluate(()=>window.__atlasDebug.setView(30,-86,15_000_000,-90));
  await page.getByLabel('Lighting date (UTC)',{exact:true}).fill('2025-03-20');
  await page.getByLabel('Lighting time (UTC)',{exact:true}).fill('00:00');
  await page.waitForFunction(()=>window.__lightingQA.state().ready);
  await delay(1400);
  await page.screenshot({path:join(folder,'terminator-and-city-lights.png')});
  const year=page.getByLabel('Satellite imagery year',{exact:true});
  await year.selectOption('2021');
  await page.waitForFunction(()=>[...document.querySelectorAll('span[title]')].some(el=>
    el.title.includes('City lights: NASA Black Marble, 2016') && el.title.includes('2021')));
  report.archivedDaylightWith2016Lights=await page.evaluate(()=>window.__lightingQA.state().layers===2);
  assert(report.archivedDaylightWith2016Lights);
  await year.selectOption('');
  await page.getByRole('button',{name:'Playback / History',exact:true}).click();
  await page.getByRole('button',{name:'Replay recorded data',exact:true}).click();
  const replay=page.getByRole('region',{name:'Playback',exact:true});
  await replay.waitFor();
  await page.waitForFunction(()=>['ready','empty'].includes(document.querySelector('[data-playback-phase]')?.dataset.playbackPhase));
  const before=await replay.getAttribute('data-playback-cursor');
  if(!await page.getByRole('button',{name:'Current sunlight',exact:true}).isVisible())await page.getByRole('button',{name:'Day/night',exact:true}).click();
  await page.getByRole('button',{name:'Current sunlight',exact:true}).click();
  await page.getByRole('button',{name:'Daylight',exact:true}).click();
  const after=await replay.getAttribute('data-playback-cursor');
  assert.equal(before,after);
  report.replay={before,after,active:await page.evaluate(()=>window.__atlasDebug.replayMap().active)};
  assert(report.replay.active);
  await page.waitForFunction(()=>!window.__lightingQA.state().layers);
  await page.getByRole('button',{name:'Choose time',exact:true}).click();
  await page.getByLabel('Lighting date (UTC)',{exact:true}).fill('2025-03-20');
  await page.getByLabel('Lighting time (UTC)',{exact:true}).fill('00:00');
  // Start a fresh renderer with all HTTPS imagery requests blocked. Local overview still draws
  // and restoring a custom UTC date must not depend on a live satellite response.
  await page.route(/^https:\/\//, route=>route.abort('internetdisconnected'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(probe);
  await page.getByRole('button',{name:'Day/night',exact:true}).click();
  assert.equal(await page.getByLabel('Lighting date (UTC)',{exact:true}).inputValue(),'2025-03-20');
  assert.equal(await page.getByLabel('Lighting time (UTC)',{exact:true}).inputValue(),'00:00');
  await page.waitForFunction(()=>window.__lightingQA.state().ready,undefined,{timeout:30000});
  report.restoredOfflineOverview=true;
  assert(report.network.bundled>0 && report.network.gibs>0);
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
}catch(e){report.failure=e.stack;process.exitCode=1;await page?.screenshot({path:join(profile,'failure.png')}).catch(()=>{});console.error('Test profile:',profile);}
finally{await app?.close();await writeFile(resolve('docs/earth-lighting-packaged.log'),JSON.stringify(report,null,2)+'\n');console.log(report);}
