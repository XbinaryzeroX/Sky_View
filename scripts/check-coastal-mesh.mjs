// Instrumented packaged GPU check. Real OpenStreetMap ocean outlines, local mesh with gaps.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Cartesian3, Matrix4, Transforms } from 'cesium';
import { boxAll, merge, writeGlb } from '../src/renderer/map/glb.ts';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const before = process.argv.includes('--before'), tag = before ? 'before' : 'after';
const exe = resolve(process.env.ATLAS_MAP_QA_EXE || 'release/win-unpacked/Atlas Watch.exe');
const dir = await mkdtemp(join(tmpdir(),'atlas-coastal-mesh-'));
const images = resolve('docs/screenshots/coastal-mesh');
await mkdir(images,{recursive:true});
const env = {...process.env, ATLAS_WATCH_DB:join(dir,'fixture.sqlite')};
for (const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS']) delete env[k];
const land = {lon:24.938,lat:60.173,z:-22}, sea = {lon:26.9797,lat:60.0214,z:5};
const result = {tag,utc:new Date().toISOString(),result:'FAIL',asar:createHash('sha256').update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'),
  source:'Synthetic slotted 3D mesh, public OSM mask. All Google requests intercepted.',stages:[],errors:[]};
const boxes = Array.from({length:21},(_,i)=>boxAll((i-10)*240,-1,0,175,2,7000));
const model = Buffer.from(writeGlb([{geometry:merge(...boxes),material:0}],[{name:'Fixture surface',color:[0.63,0.23,0.09,1]}]));
const children = [land,sea].map(p=>({
  transform:Matrix4.toArray(Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(p.lon,p.lat,p.z))),
  boundingVolume:{box:[0,0,-1,2700,0,0,0,3500,0,0,0,2]},geometricError:0,content:{uri:'slotted.glb'},
}));
const root = {asset:{version:'1.1'}, geometricError:10000,root:{
  boundingVolume:{region:[24*Math.PI/180,59*Math.PI/180,28*Math.PI/180,61*Math.PI/180,-30,10]},geometricError:10000,refine:'ADD',children}};

function installProbe() {
  const canvas = document.querySelector('.cesium-widget canvas');
  let w;
  for(let el=canvas;el&&!w;el=el.parentElement) {
    const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
    for(let f=el[key];f&&!w;f=f.return) for(let h=f.memoizedState;h;h=h.next) {
      const r=h.memoizedState?.current;
      if(r?.scene?.postRender && r?.canvas===canvas && r.dataSources) {w=r;break;}
    }
  }
  if(!w) throw new Error('Map widget unavailable');
  const s=w.scene,C3=w.camera.position.constructor;
  window.__coast={
    face(p) { w.camera.lookAt(C3.fromDegrees(p.lon,p.lat,p.z),{heading:0,pitch:-3*Math.PI/180,range:1700}); s.requestRender(); },
    state(p) {
      const loc=w.camera.positionCartographic.constructor.fromDegrees(p.lon,p.lat);
      let mesh;
      for(let i=0;i<s.primitives.length;i++) if(s.primitives.get(i).isCesium3DTileset) mesh=s.primitives.get(i);
      return {globe:s.globe.show,meshVisible:mesh?.show,meshHeight:mesh?.show?mesh.getHeight(loc,s):null,
        cameraAltitude:w.camera.positionCartographic.height,pitch:w.camera.pitch*180/Math.PI};
    },
    async sample() {
      const sky=s.skyBox.show, atmosphere=s.skyAtmosphere.show, color=s.backgroundColor;
      s.skyBox.show=false; s.skyAtmosphere.show=false; s.backgroundColor=new color.constructor(1,0,1,1);
      const value=await new Promise(done=>{
        const off=s.postRender.addEventListener(()=>{
          off();
          const width=s.drawingBufferWidth,height=Math.floor(s.drawingBufferHeight*0.35);
          const bytes=s.context.readPixels({x:0,y:0,width,height});let holes=0,meshPixels=0;
          for(let i=0;i<bytes.length;i+=4){
            if(bytes[i]>250 && bytes[i+1]<8 && bytes[i+2]>250) holes++;
            if(bytes[i]>bytes[i+1]*1.3 && bytes[i+1]>bytes[i+2]*1.24 && bytes[i]>70) meshPixels++;
          }
          done({pixels:width*height,skyThroughGround:holes,rustMeshPixels:meshPixels});
        });
        s.requestRender();
      });
      s.skyBox.show=sky;s.skyAtmosphere.show=atmosphere;s.backgroundColor=color;s.requestRender();
      return value;
    },
  };
}
let app;
try {
  app=await loadPlaywrightRuntime().electron.launch({executablePath:exe,args:['--user-data-dir='+dir],env,chromiumSandbox:true});
  assert(await app.evaluate(({app},path)=>app.isPackaged&&app.getPath('userData').toLowerCase()===path.toLowerCase(),dir));
  await app.evaluate(()=>{
    const original=globalThis.fetch;
    globalThis.fetch=(input,opts)=>new URL(typeof input==='string'?input:input.url??String(input)).hostname.endsWith('.googleapis.com') ?
      Promise.resolve(new Response('QA blocked',{status:403})):original(input,opts);
  });
  const page=await app.firstWindow();
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.route(/https:\/\/[^/]*googleapis\.com\//,route=>{
    const path=new URL(route.request().url()).pathname,headers={'Access-Control-Allow-Origin':'*'};
    if(path.endsWith('root.json')) return route.fulfill({json:root,headers});
    if(path.endsWith('slotted.glb')) return route.fulfill({body:model,contentType:'model/gltf-binary',headers});
    return route.abort('blockedbyclient');
  });
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  const reloaded=page.waitForEvent('load');
  await page.evaluate(()=>window.atlas.setProviderCredential('google3d','AIza'+'Q'.repeat(35)));
  await reloaded;
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(()=>window.atlas.updateSettings({basemap:'google3d',terrainEnabled:false,labelsOverlay:false,evenOcean:false,
    radarEnabled:false,geoLabels:'off',layersEnabled:[],buildings3d:false,reducedMotion:true}));
  await page.evaluate(installProbe);
  for(const [place,p] of [['land',land],['sea',sea],['back on land',land]]){
    await page.evaluate(p=>window.__coast.face(p),p);
    const entry={place,...p}; result.stages.push(entry);
    const meshExpected=before||place!=='sea';
    await page.waitForFunction(({p,meshExpected,before})=>{
      const s=window.__coast.state(p);
      return meshExpected ? s.meshVisible && Math.abs(s.meshHeight-p.z)<2 && s.globe===!before : s.meshVisible===false&&s.globe;
    },{p,meshExpected,before},{timeout:60000});
    await delay(850);
    Object.assign(entry,await page.evaluate(p=>window.__coast.state(p),p),await page.evaluate(()=>window.__coast.sample()));
    if(place!=='back on land') await page.screenshot({path:join(images,tag+'-'+place+'.png')});
    assert(entry.pixels>100000);
    assert(before?entry.skyThroughGround>100:entry.skyThroughGround===0,'Missing geometry in below-horizon viewport');
    if(meshExpected) assert(entry.rustMeshPixels>1000,'Covered mesh should remain visible including below the ellipsoid');
    else assert.equal(entry.rustMeshPixels,0,'Opaque mesh should yield to coastal imagery');
  }
  if (!before) {
    // Exercise the user's actual terrain setting with the same coastal focus and live public sources.
    await page.evaluate(()=>window.atlas.updateSettings({terrainEnabled:true}));
    await page.evaluate(p=>window.__coast.face(p),sea);
    await page.waitForFunction(p=>window.__coast.state(p).meshVisible===false && window.__atlasDebug.diag().maxRenderedLevel>=14,sea,{timeout:90000});
    const entry={place:'sea with public terrain',...sea};result.stages.push(entry);
    const samples=[];
    for(let i=0;i<20;i++){
      const diag=await page.evaluate(()=>window.__atlasDebug.diag());
      samples.push({pending:diag.tilesPending,level:diag.maxRenderedLevel});
      if(i>=2 && samples.slice(-2).every(s=>s.pending===0)) break;
      await delay(600);
    }
    Object.assign(entry,await page.evaluate(p=>window.__coast.state(p),sea),await page.evaluate(()=>window.__coast.sample()),{refinement:samples});
    await page.screenshot({path:join(images,'after-sea-terrain.png')});
    assert.equal(entry.skyThroughGround,0,'Foreground should stay covered with real terrain');
  }
  assert.deepEqual(result.errors,[]);result.result='PASS';
} catch(e){ result.error=e.message;process.exitCode=1; } finally {
  if(app) await app.close();
  await writeFile(resolve('docs/coastal-mesh-'+tag+'.log'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
