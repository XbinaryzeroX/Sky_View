// Regional, oblique and offline optical-water verification on an isolated packaged profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Cartesian3, Matrix4, Transforms} from 'cesium';
import sharp from 'sharp';
import {boxAll,writeGlb} from '../src/renderer/map/glb.ts';
import {loadPlaywrightRuntime} from './qa-playwright-runtime.mjs';

const before=process.argv.includes('--before'),tag=before?'before':'after';
const exe=resolve(process.env.ATLAS_MAP_QA_EXE || 'release/win-unpacked/Atlas Watch.exe');
const dir=await mkdtemp(join(tmpdir(),'atlas-photo-water-')),images=resolve('docs/screenshots/optical-water');
await mkdir(images,{recursive:true});
const env={...process.env,ATLAS_WATCH_DB:join(dir,'water.sqlite')};
for(const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX','NODE_OPTIONS']) delete env[k];
const report={tag,utc:new Date().toISOString(),asar:createHash('sha256').update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'),stages:[],errors:[]};
const water=[];
const masks=new Map();
async function alpha(lat,lon){
  const gx=(lon+180)/360*8192,gy=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*4096;
  const key=Math.floor(gy/1024)+'/'+Math.floor(gx/1024);
  let mask=masks.get(key);
  if(!mask){mask=await sharp('public/optical-water/land/3/'+key+'.png').ensureAlpha().raw().toBuffer({resolveWithObject:true});masks.set(key,mask);}
  if(mask.info.width===1)return mask.data[3];
  return mask.data[4*((Math.floor(gy)%1024)*1024+Math.floor(gx)%1024)+3];
}
for(let j=0;j<20;j++) for(let i=0;i<22;i++){
  const lat=59.77+j*.031,lon=18.99+i*.032;
  if(await alpha(lat,lon)<4)water.push([lat,lon]);
}
// These straight water-only boundaries are in the original WorldCover RGBA tile 8/141/74.
// For each axis compare RGB on opposite sides, roughly 1.4 km apart, away from the shore.
const crossings = [
  ...[60.0744,60.0909,60.1073,60.1237,60.1401].map(lat=>[[lat,19.3826-.011],[lat,19.3826+.011]]),
  ...[19.4046,19.4376,19.4705,19.5035,19.5364,19.5694].map(lon=>[[60.0607-.006,lon],[60.0607+.006,lon]]),
].flat();
const origin=Cartesian3.fromDegrees(19.6,60.08,35);
const model=Buffer.from(writeGlb([{geometry:boxAll(0,0,0,42_000,4,45_000),material:0}],[{name:'Controlled legacy ocean',color:[0.18,0.31,0.65,1]}]));
const fixture={asset:{version:'1.1'},geometricError:2000,root:{transform:Matrix4.toArray(Transforms.eastNorthUpToFixedFrame(origin)),
  boundingVolume:{box:[0,0,0,21000,0,0,0,22500,0,0,0,15]},geometricError:0,content:{uri:'ocean.glb'}}};
function installProbe(){
  const canvas=document.querySelector('.cesium-widget canvas');let w;
  for(let el=canvas;el&&!w;el=el.parentElement){
    const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
    for(let f=el[key];f&&!w;f=f.return)for(let h=f.memoizedState;h;h=h.next){
      const r=h.memoizedState?.current;if(r?.scene?.postRender&&r.canvas===canvas){w=r;break;}
    }
  }
  if(!w)throw Error('Missing widget');
  window.__waterProbe={async nativeLand(lat,lon){
    const layers=Array.from({length:w.imageryLayers.length},(_,i)=>w.imageryLayers.get(i));
    const provider=layers.map(l=>l.imageryProvider).find(p=>p?.url?.includes('wmts.terrascope'));
    const z=12,x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*2**(z-1));
    const photo=await provider.requestImage(x,y,z),c=new OffscreenCanvas(256,256),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(photo,0,0);const pixels=ctx.getImageData(0,0,256,256).data;
    let opaque=0;const values=new Set();
    for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]===255)opaque++;values.add(pixels[i]);}
    return {lat,lon,x,y,z,opaque,redValues:values.size};
  },async landDetail(){
    const s=w.scene, sites=[[60.15,19.95],[60.23,19.94],[60.28,20.04]];
    const pos=sites.map(([lat,lon])=>s.cartesianToCanvasCoordinates(s.globe.ellipsoid.cartographicToCartesian({latitude:lat*Math.PI/180,longitude:lon*Math.PI/180,height:0})));
    return new Promise(done=>{const off=s.postRender.addEventListener(()=>{
      off();
      const width=s.drawingBufferWidth,height=s.drawingBufferHeight,rgba=s.context.readPixels({x:0,y:0,width,height});
      const details=pos.map(p=>{
        const cx=Math.round(p.x*width/w.canvas.clientWidth),cy=height-1-Math.round(p.y*height/w.canvas.clientHeight);
        let contrast=0,count=0;
        for(let y=cy-15;y<=cy+15;y++)for(let x=cx-15;x<=cx+15;x++){
          if(x<0||x>=width-1||y<0||y>=height-1)continue;
          const g=4*(y*width+x)+1;
          for(const offset of [4,4*width]){if(Math.abs(rgba[g]-rgba[g+offset])>=6)contrast++;count++;}
        }
        return contrast/Math.max(1,count);
      });
      done(details);
    });s.requestRender();});
  },async sample(coords){
    const s=w.scene;
    const pos=coords.map(([lat,lon])=>s.cartesianToCanvasCoordinates(s.globe.ellipsoid.cartographicToCartesian({longitude:lon*Math.PI/180,latitude:lat*Math.PI/180,height:1}))).filter(Boolean);
    return new Promise(done=>{const off=s.postRender.addEventListener(()=>{
      off();
      const width=s.drawingBufferWidth,height=s.drawingBufferHeight,rgba=s.context.readPixels({x:0,y:0,width,height});
      const samples=pos.map(p=>[Math.round(p.x*width/w.canvas.clientWidth),height-1-Math.round(p.y*height/w.canvas.clientHeight)])
        .filter(([x,y])=>x>2&&y>2&&x<width-2&&y<height-2)
        .map(([x,y])=>{const n=(y*width+x)*4;return [rgba[n],rgba[n+1],rgba[n+2]]});
      let mesh=null;
      for(let n=0;n<s.primitives.length;n++){const p=s.primitives.get(n);if(typeof p.getHeight==='function'&&p.tileLoad){mesh=p.show;break;}}
      const blue=samples.filter(([r,g,b])=>b>=45&&b-r>=18&&b-g>=12).length;
      const levels=w.scene.globe._surface._tilesToRender;
      const sentinel=levels.some(t=>t.data?.imagery?.some(b=>b.readyImagery?.level>=8 && b.readyImagery?.imageryLayer?.imageryProvider?.url?.includes('wmts.terrascope')));
      const optical=levels.some(t=>t.data?.imagery?.some(b=>b.readyImagery?.imageryLayer?.imageryProvider?.url?.includes('/optical-water/')));
      done({samples:samples.length,oldBluePixels:blue,blueFraction:blue/Math.max(samples.length,1),medianWater:samples.length?[0,1,2].map(k=>samples.map(c=>c[k]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]):null,
        colourSamples: samples.length===22 ? samples : undefined, regionalMesh:mesh,optical,sentinel,visibleTerrain:levels.length,level:window.__atlasDebug.diag().maxRenderedLevel,pending:window.__atlasDebug.diag().tilesPending});
    });s.requestRender()});
  }};
}
let app,page;
try{
  app=await loadPlaywrightRuntime().electron.launch({executablePath:exe,args:['--user-data-dir='+dir],env,chromiumSandbox:true});
  page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await app.evaluate(()=>{const fetchOriginal=globalThis.fetch;globalThis.fetch=(u,...rest)=>new URL(typeof u==='string'?u:u.url??String(u)).hostname.endsWith('.googleapis.com')?Promise.resolve(new Response('',{status:403})):fetchOriginal(u,...rest);});
  await page.route(/https:\/\/[^/]*googleapis\.com\//,r=>{const p=new URL(r.request().url()).pathname,headers={'Access-Control-Allow-Origin':'*'};
    if(p.endsWith('root.json'))return r.fulfill({json:fixture,headers});if(p.endsWith('ocean.glb'))return r.fulfill({body:model,headers,contentType:'model/gltf-binary'});return r.abort();});
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  const reload=page.waitForEvent('load');
  await page.evaluate(()=>window.atlas.setProviderCredential('google3d','AIza'+'Q'.repeat(35))).catch(error=>{
    if(!error.message.includes('Execution context was destroyed')) throw error;
  });
  await reload;
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  // Use the existing-profile settings from the report, including legacy simulated-water flags.
  await page.evaluate(()=>window.atlas.updateSettings({basemap:'google3d',renderQuality:'balanced',terrainEnabled:true,labelsOverlay:true,
    evenOcean:true,waterDetail:true,radarEnabled:false,layersEnabled:[],buildings3d:false,geoLabels:'off',reducedMotion:true}));
  await page.evaluate(installProbe);
  const setView=async(lat,lon,h,pitch)=>page.evaluate(p=>window.__atlasDebug.setView(...p),[lat,lon,h,pitch]);
  const freeze=/https:\/\/(?:wmts|titiler)\.terrascope\.be\//;let slow=true;let held=[];
  await page.route(freeze,async route=>{if(slow)await new Promise(r=>held.push(r));await route.continue().catch(()=>{});});
  async function capture(label,coords){
    const result=await page.evaluate(coords=>window.__waterProbe.sample(coords),coords);
    report.stages.push({label,...result});await page.screenshot({path:join(images,tag+'-'+label+'.png')});console.log(label,result);return result;
  }
  await setView(60.095,19.45,122000,-90);
  await delay(2200);
  let view=await capture('aland-loading',water);
  if(!before){assert(view.optical);assert(view.samples>50&&view.blueFraction<.05,'The offshore fallback should be optical before Sentinel arrives');}
  slow=false;held.forEach(r=>r());held=[];
  for(let n=0;n<45;n++){
    await delay(1000);
    const state=await page.evaluate(()=>window.__waterProbe.sample([]));
    if(state.sentinel && state.pending===0) break;
  }
  view=await capture('aland-regional',water);
  const transect=await page.evaluate(c=>window.__waterProbe.sample(c),crossings);
  assert.equal(transect.colourSamples?.length,22,'All registered ocean-edge pairs must be onscreen');
  const jumps=[];
  for(let n=0;n<22;n+=2)jumps.push(Math.max(...transect.colourSamples[n].map((c,k)=>Math.abs(c-transect.colourSamples[n+1][k]))));
  report.stages.at(-1).waterEdgeJumps = jumps;
  const inland=await page.evaluate(()=>window.__waterProbe.landDetail());
  report.stages.at(-1).inlandDetail=inland;
  console.log('Åland inland terrain detail',inland);
  console.log('Registered water-edge channel jumps',jumps);
  if(!before){
    assert(inland.filter(f=>f>.06).length>=2,'Åland inland photography must show resolvable detail across the three land samples');
    assert(view.sentinel && view.pending===0, 'The published imagery must have fully loaded before judging seams');
    for(const group of [jumps.slice(0,5),jumps.slice(5)]) {
      const median=[...group].sort((a,b)=>a-b)[Math.floor(group.length/2)];
      assert(median<=4 && Math.max(...group)<=12,'An original coverage edge is still visible in the rendered ocean');
    }
  }
  if(!before){assert(view.optical);assert(view.samples>50&&view.blueFraction<.05,'The settled sea must not contain blue bathymetric tile blocks');}
  await setView(60.02,19.68,18000,-29);await delay(4500);
  view=await capture('aland-oblique',water);
  if(!before){assert(view.optical);assert.equal(view.regionalMesh,false);assert(view.samples>6&&view.blueFraction<.07,'The regional coastal mesh must yield to observed water');}
  if(!before){
    let refused=0;
    await page.route('https://titiler.terrascope.be/wms?**', r=>{refused++;return r.abort('failed');});
    const native=await page.evaluate(()=>window.__waterProbe.nativeLand(48.86,2.35));
    report.wmsUnavailable={...native,wmsRequestsRefused:refused};
    assert(refused>0 && native.opaque>60000 && native.redValues>30,'Native land photos must survive an independent WMS failure');
  }
  await page.context().setOffline(true);
  await setView(26,-42,1400000,-90);await delay(2200);
  const atlantic=[];for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++)atlantic.push([26+j*.25,-42+i*.25]);
  view=await capture('atlantic-offline',atlantic);
  if(!before){assert(view.samples>60&&view.optical&&view.blueFraction<.05,'Offline Atlantic water should use the bundled optical observations');}
  await setView(47,-87.3,62000,-90);await delay(1700);
  view=await capture('superior-offline',[[47,-87.3],[47.1,-87.4],[47,-87.2],[47.05,-87.6]]);
  if(!before){assert(view.samples>0&&view.optical&&view.blueFraction<.1,'Inland lakes should retain the photographic fallback');}
  assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(e){report.failure=e.stack;process.exitCode=1;await page?.screenshot({path:join(dir,'failure.png')}).catch(()=>{});console.error(e);}
finally{await app?.close();await writeFile(resolve('docs/optical-water-'+tag+'.log'),JSON.stringify(report,null,2)+'\n');}
