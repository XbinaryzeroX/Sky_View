// Run in a separate packaged profile. The elevation fixture exercises actual rendered Cesium tiles.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';
import { Cartesian3, Matrix4, Transforms } from 'cesium';
import { boxAll, writeGlb } from '../src/renderer/map/glb.ts';

const live = process.argv.includes('--live'), baseline = process.argv.includes('--baseline');
const photoreal = process.argv.includes('--photoreal');
const mode = photoreal ? 'controlled-3d-tiles' : live ? 'live' : baseline ? 'before' : 'after';
const exe = resolve(process.env.ATLAS_FLIGHT_QA_EXE ?? (baseline ? 'release/flight-card/win-unpacked/Atlas Watch.exe' : 'release/win-unpacked/Atlas Watch.exe'));
const dir = await mkdtemp(join(tmpdir(), 'atlas-waterline-')), images = resolve('docs/screenshots/vessel-waterline');
await mkdir(images, { recursive: true });
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX'].includes(k)) delete env[k];
env.ATLAS_WATCH_DB = join(dir, 'qa.sqlite');
const { electron } = loadPlaywrightRuntime();
const evidence = { result: 'FAIL', mode, at: new Date().toISOString(), asar: createHash('sha256').update(await readFile(join(dirname(exe), 'resources/app.asar'))).digest('hex'),
  source: photoreal ? 'Synthetic local 3D tileset, synthetic AIS and isolated test credential. All Google API requests intercepted.' :
    live ? 'Live public Fintraffic AIS and displayed terrain' : 'Synthetic AIS, synthetic flat lake elevation, real renderer and pick path', stages: [], errors: [] };
const ship = { mmsi: 111000001, name: 'QA LAKE CARGO', shipType: 70, lat: 61.1714, lon: 28.0085, referencePointA: 120, referencePointB: 45, referencePointC: 12, referencePointD: 12 };
let app, page;
try {
  app = await electron.launch({ executablePath: exe, args: ['--user-data-dir=' + dir], env, chromiumSandbox:true });
  assert(await app.evaluate(({ app }, d) => app.isPackaged && app.getPath('userData').toLowerCase() === d.toLowerCase(), dir));
  if (!live) await app.evaluate((_, ship) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      const u = new URL(typeof input === 'string' ? input : input.url ?? String(input));
      if (u.hostname.endsWith('.googleapis.com')) return new Response('Blocked in QA', { status: 403 });
      if (u.host !== 'meri.digitraffic.fi') return original(input, options);
      const body = u.pathname.endsWith('/vessels') ? [ship] : { dataUpdatedTime: new Date().toISOString(), features: [{ mmsi: ship.mmsi,
        geometry: { type: 'Point', coordinates: [ship.lon, ship.lat] }, properties: { sog: 0, heading: 90, timestampExternal: Date.now() } }] };
      return Response.json(body);
    };
  }, ship);
  page = await app.firstWindow();
  if (photoreal) {
    const mesh = Buffer.from(writeGlb([{ geometry:boxAll(0,-1,0,4800,2,4800), material:0 }], [{name:'Synthetic lake',color:[0.18,0.32,0.45,1]}]));
    const transform = Matrix4.toArray(Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(ship.lon,ship.lat,183)));
    const root = { asset:{version:'1.1'}, geometricError:4000, root:{ transform, boundingVolume:{box:[0,0,-1,2400,0,0,0,2400,0,0,0,2]}, geometricError:0, refine:'REPLACE', content:{uri:'synthetic-lake.glb'} } };
    evidence.intercepted=[];
    await page.route(/https:\/\/[^/]*googleapis\.com\//, async route=>{
      const u=new URL(route.request().url());
      evidence.intercepted.push(u.hostname+u.pathname);
      if (u.hostname==='tile.googleapis.com' && u.pathname.endsWith('root.json')) {
        return route.fulfill({json:root,headers:{'Access-Control-Allow-Origin':'*'}});
      }
      if (u.hostname==='tile.googleapis.com' && u.pathname.endsWith('synthetic-lake.glb')) {
        return route.fulfill({body:mesh,contentType:'model/gltf-binary',headers:{'Access-Control-Allow-Origin':'*'}});
      }
      return route.abort('blockedbyclient');
    });
  }
  page.on('pageerror', e => evidence.errors.push(e.message));
  await page.waitForFunction(() => window.__atlasDebug?.diag()?.globeShown);
  if (photoreal) {
    const reload = page.waitForEvent('load');
    await page.evaluate(()=>window.atlas.setProviderCredential('google3d','AIza'+'Q'.repeat(35)));
    await reload; // Granting the synthetic local credential reloads CSP for the isolated renderer.
    await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  }
  await page.evaluate(live => window.atlas.updateSettings({ basemap:live?'atlas':'neutral', waterDetail:true, terrainEnabled:true, buildings3d:false, labelsOverlay:false, radarEnabled:false, vehicleModels:true, layersEnabled:[] }),live);
  const name = 'Vessels (AIS)';
  await page.getByRole('textbox', { name:'Find a layer' }).fill(name);
  await page.locator('.layer-row').filter({ hasText:name }).getByRole('switch').click();
  await page.waitForFunction(() => window.__atlasDebug.records('vessels').some(r => r.shipType >= 60 && r.shipType < 90), undefined, { timeout:60000 });
  const point = await page.evaluate(isLive => {
    const rows = window.__atlasDebug.records('vessels').filter(r => r.shipType >= 60 && r.shipType < 90);
    return (isLive && rows.find(r => r.lat > 61.1 && r.lat < 63.8 && r.lon > 26.7 && r.lon < 30.2)) || rows[0];
  }, live);
  evidence.ship = { id:point.id, reportedType:point.shipType };
  await page.evaluate(p => window.__atlasDebug.setView(p.lat,p.lon,1600),point);
  await page.waitForFunction(p => Math.abs(window.__atlasDebug.camera().lat-p.lat) < 0.001,point);
  await page.evaluate(point => {
    const canvas = document.querySelector('.cesium-widget canvas');
    let w;
    for (let el = canvas; el && !w; el = el.parentElement) {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      for (let fiber = el[key]; fiber && !w; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const ref = hook.memoizedState?.current;
          if (ref?.scene?.postRender && ref?.dataSources && ref.canvas === canvas) { w=ref; break; }
        }
      }
    }
    if (!w) throw new Error('Map widget unavailable');
    const scene = w.scene, C3 = w.camera.position.constructor, ellipsoid = scene.globe.ellipsoid;
    let loc = w.camera.positionCartographic.constructor.fromDegrees(point.lon,point.lat);
    const Heightmap = Object.getPrototypeOf(Object.getPrototypeOf(w.terrainProvider)).constructor;
    const tilingScheme = w.terrainProvider.tilingScheme;
    let key = 'rec|vessels|' + point.id;
    function target(next) { point=next; key='rec|vessels|'+next.id; loc=w.camera.positionCartographic.constructor.fromDegrees(next.lon,next.lat); }
    function setSurface(z) {
      w.terrainProvider = new Heightmap({ width:65, height:65, tilingScheme, callback:()=>new Float32Array(65*65).fill(z) });
      scene.requestRender();
    }
    function face(z,range,pitch) {
      w.camera.lookAt(C3.fromDegrees(point.lon,point.lat,z),{heading:0.35,pitch:pitch*Math.PI/180,range});
      scene.requestRender();
    }
    function inspect(pick=false) {
      let m;
      for (let i = 0; i < scene.primitives.length; i++) {
        const p=scene.primitives.get(i);
        if (p.id===key && p.ready && p.show) {m=p;break;}
      }
      let terrain = scene.globe.getHeight(loc);
      for(let i=0;i<scene.primitives.length;i++) {
        const p=scene.primitives.get(i);
        if(p.isCesium3DTileset && p.show) terrain=p.getHeight(loc,scene) ?? terrain;
      }
      if (!m) return { terrain,ready:false };
      const mx=m._clampedModelMatrix ?? m.modelMatrix;
      const origin=new C3(mx[12],mx[13],mx[14]);
      const position=ellipsoid.cartesianToCartographic(origin);
      const screen=scene.cartesianToCanvasCoordinates(m.boundingSphere.center);
      let hit=false;
      if (pick && screen) {
        const Coord=screen.constructor;
        for (const y of [0,-6,6,-12,12]) for (const x of [0,-6,6,-12,12]) {
          if (hit) break;
          const p=scene.pick(new Coord(screen.x+x,screen.y+y),3,3);
          hit=p?.primitive===m;
        }
      }
      return { terrain, ready:true, hullWaterline:position.height, heightReference:m.heightReference, meshPicked:hit, testPoint:screen && [screen.x,screen.y] };
    }
    window.__qaHull = { setSurface, face, inspect, target, globeShown:()=>scene.globe.show, tilesLoaded:()=>scene.globe.tilesLoaded };
  }, point);
  async function check(label, z, range, pitch) {
    await page.evaluate(({z,range,pitch})=>window.__qaHull.face(z,range,pitch),{z,range,pitch});
    await page.waitForFunction(({live,z})=>{
      const r=window.__qaHull.inspect();
      return r.ready && Number.isFinite(r.terrain) && (live || Math.abs(r.terrain-z)<1.5);
    },{live,z},{timeout:60000});
    if (live && range < 300) {
      await page.waitForFunction(()=>window.__qaHull.tilesLoaded() && window.__atlasDebug.diag().maxRenderedLevel >= 14,undefined,{timeout:90000});
      evidence.closeView={rangeM:range,tilesLoaded:true,level:await page.evaluate(()=>window.__atlasDebug.diag().maxRenderedLevel)};
    }
    if (!baseline) {
      // A first tile can momentarily match while finer terrain is still arriving. Require a stable rendered
      // surface for one second, and check the exact measured frame again below.
      await page.evaluate(()=>{window.__qaStableHull=null;});
      await page.waitForFunction(()=>{
        const r=window.__qaHull.inspect(), prev=window.__qaStableHull;
        if (!r.ready || !Number.isFinite(r.terrain) || Math.abs(r.hullWaterline-r.terrain)>1) {window.__qaStableHull=null;return false;}
        if (!prev || Math.abs(r.terrain-prev.height)>0.5) {window.__qaStableHull={height:r.terrain,at:performance.now()};return false;}
        return performance.now()-prev.at>=1000;
      },undefined,{timeout:45000});
    } else await delay(400);
    const r=await page.evaluate(()=>window.__qaHull.inspect(true));
    evidence.stages.push({ label,...r });
    await page.screenshot({path:join(images,mode+'-'+label+'.png')});
    if(baseline) assert(Math.abs(r.terrain-r.hullWaterline)>60,'Expected to reproduce the lake-height error.');
    else {
      assert(Math.abs(r.hullWaterline-r.terrain)<=1.5,label+' hull must be at the displayed surface');
      assert(r.meshPicked,label+' hull must be directly pickable in 3D');
    }
  }
  if (photoreal) {
    await page.evaluate(async()=> {
      window.__qaHull.setSurface(0);
      await window.atlas.updateSettings({basemap:'google3d'});
    });
    await check('covered',183,1000,-30);
    await page.evaluate(p=>window.__atlasDebug.setView(p.lat,p.lon+0.22,1800),point);
    await page.waitForFunction(p=>Math.abs(window.__atlasDebug.camera().lon-(p.lon+0.22))<0.01 && window.__qaHull.globeShown(),point);
    evidence.stages.push({label:'outside supplied mesh',globeShown:true});
    await page.evaluate(p=>window.__atlasDebug.setView(p.lat,p.lon,1800),point);
    await page.waitForFunction(()=>Math.abs(window.__qaHull.inspect().terrain-183)<1.5);
    evidence.stages.push({label:'returned to coverage',globeShown:await page.evaluate(()=>window.__qaHull.globeShown())});
  } else if (live) {
    await page.waitForFunction(()=>window.__qaHull.inspect().ready,undefined,{timeout:60000});
    const surface=await page.evaluate(()=>window.__qaHull.inspect().terrain ?? 0);
    await check('oblique',surface,1200,-27);
    const coastal = await page.evaluate(async()=>{
      const snap=(await window.atlas.getLayers()).find(s=>s.status.id==='vessels');
      const cargo=(snap?.records ?? []).filter(r=>r.props.shipType>=70 && r.props.shipType<=79 && r.lat>59.5 && r.lat<60.05 && r.lon>23 && r.lon<27.5);
      // Prefer anchored cargo in the Gulf of Finland so a second AIS report won't move the target out of this close-up.
      const row=cargo.sort((a,b)=>(a.speedKts ?? 20)-(b.speedKts ?? 20))[0];
      return row && {id:row.id,lat:row.lat,lon:row.lon,shipType:row.props.shipType};
    });
    assert(coastal,'No reported cargo ship in the inspection area');
    evidence.coastalShip={id:coastal.id,reportedType:coastal.shipType};
    await page.evaluate(p=>{window.__qaHull.target(p);window.__atlasDebug.setView(p.lat,p.lon,900);},coastal);
    await page.waitForFunction(()=>window.__qaHull.inspect().ready,undefined,{timeout:60000});
    await check('close-cargo',await page.evaluate(()=>window.__qaHull.inspect().terrain ?? 0),240,-30);
    const xy = evidence.stages.at(-1).testPoint;
    const canvas = await page.locator('.cesium-widget canvas').first().boundingBox();
    await page.mouse.click(canvas.x+xy[0],canvas.y+xy[1]);
    await page.locator('.data-panel .veh-model').waitFor();
    evidence.closeView.card=await page.locator('.data-panel .veh-model').innerText();
  } else {
    await page.evaluate(()=>window.__qaHull.setSurface(78));
    await check('lake',78,1600,-30);
    // Swap an already rendered surface to a different height with the same ship, camera and observation.
    await page.evaluate(()=>window.__qaHull.setSurface(183));
    await check('refined-lake',183,800,-21);
  }
  assert.deepEqual(evidence.errors,[]);
  evidence.result='PASS';
} catch(e) {
  evidence.failure=e.message;
  if (page) {
    evidence.state = await page.evaluate(()=>window.__qaHull?.inspect()).catch(()=>null);
    await page.screenshot({ path:join(dir,'failure.png'),timeout:3000 }).catch(()=>{});
  }
  console.error('QA profile',dir);
  process.exitCode=1;
} finally {
  if (app) await app.close();
  await writeFile(resolve('docs/vessel-waterline-'+mode+'.log'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
