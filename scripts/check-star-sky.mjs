// Compare the old and current offline sky on the packaged renderer at the same orbital viewpoint.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.env.ATLAS_MAP_QA_EXE || 'release/win-unpacked/Atlas Watch.exe');
const before = process.argv.includes('--before'), tag = before ? 'before' : 'after';
const profile = await mkdtemp(join(tmpdir(),'atlas-sky-'));
const env = { ...process.env, ATLAS_WATCH_DB:join(profile,'sky.sqlite') };
for (const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS']) delete env[k];
const folder = resolve('docs/screenshots/star-sky');
await mkdir(folder,{recursive:true});
const report = { at:new Date().toISOString(), result:'FAIL', errors:[], archive:createHash('sha256')
  .update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex') };
let app;
try {
  const { electron } = loadPlaywrightRuntime();
  app = await electron.launch({executablePath:exe,args:['--user-data-dir='+profile,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],env,chromiumSandbox:true});
  const page = await app.firstWindow();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(()=>window.atlas.updateSettings({basemap:'atlas',layersEnabled:[],terrainEnabled:false,labelsOverlay:false,
    radarEnabled:false,geoLabels:'off',buildings3d:false}));
  const close = page.getByRole('button',{name:/^Close Layers/i});
  if (await close.isVisible()) await close.click();
  await page.evaluate(()=>{
    const canvas = document.querySelector('.cesium-widget canvas');
    let widget;
    for(let el=canvas;el&&!widget;el=el.parentElement){
      const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
      for(let f=el[key];f&&!widget;f=f.return) for(let hook=f.memoizedState;hook;hook=hook.next){
        const w=hook.memoizedState?.current;
        if(w?.canvas===canvas && w.scene?.globe) {widget=w;break;}
      }
    }
    if (!widget) throw new Error('Cesium widget unavailable');
    window.__skyProbe=()=>({
      size:widget.scene.skyBox._panorama._cubeMap?.width,
      files:Object.values(widget.scene.skyBox.sources),
      height:Math.round(widget.camera.positionCartographic.height),
    });
    widget.clock.currentTime=widget.clock.currentTime.constructor.fromIso8601('2026-11-12T02:00:00Z');
    window.__atlasDebug.setView(34,-44,39000000,-90);
    widget.scene.requestRender();
  });
  await page.waitForFunction(()=>window.__skyProbe().size && window.__skyProbe().height>36000000);
  await delay(750);
  report.sky=await page.evaluate(()=>window.__skyProbe());
  assert.equal(report.sky.size,before?1024:2048);
  if(!before) assert(report.sky.files.every(f=>f.startsWith('/star-sky/')));
  await page.screenshot({path:join(folder,tag+'.png')});
  const bounds=await page.locator('.cesium-widget canvas').boundingBox();
  const crop={x:Math.round(bounds.x+bounds.width*.73),y:Math.round(bounds.y+bounds.height*.23),
    width:Math.round(bounds.width*.16),height:Math.round(bounds.height*.34)};
  const pixels=await sharp(await page.screenshot({clip:crop})).removeAlpha().raw().toBuffer();
  const histogram=new Uint32Array(256);
  for(let i=0;i<pixels.length;i+=3) histogram[Math.max(pixels[i],pixels[i+1],pixels[i+2])]++;
  const mode=histogram.indexOf(Math.max(...histogram)), n=pixels.length/3;
  report.skyCrop={pixels:n,backgroundLevel:mode,backgroundFraction:histogram.slice(Math.max(0,mode-1),mode+2).reduce((a,b)=>a+b,0)/n,
    starPixels:histogram.slice(40).reduce((a,b)=>a+b,0)};
  if(!before) {
    assert(report.skyCrop.backgroundFraction>.80,'Background should be clear around the stars');
    assert(report.skyCrop.starPixels>12,'Catalogue stars must be visible offline');
  }
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
} catch(error) {
  report.failure=error.stack; process.exitCode=1;
} finally {
  await app?.close();
  await writeFile(resolve('docs/star-sky-'+tag+'.log'),JSON.stringify(report,null,2)+'\n');
  console.log(report);
}
