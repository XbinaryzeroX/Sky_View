// Compare rendered tile boundaries in an isolated Windows build, using real elevation and imagery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const before = process.argv.includes('--before');
const exe = resolve(process.env.ATLAS_MAP_QA_EXE || 'release/flight-card/win-unpacked/Atlas Watch.exe');
const profile = await mkdtemp(join(tmpdir(), 'atlas-oblique-'));
const folder = resolve('docs/screenshots/oblique-terrain');
await mkdir(folder, { recursive: true });
const tag = before ? 'before' : 'after';
const log = { startedAt: new Date().toISOString(), packageSha256: createHash('sha256').update(await readFile(join(dirname(exe), 'resources/app.asar'))).digest('hex'),
  views: [], errors: [], result: 'FAIL' };
const env = { ...process.env, ATLAS_WATCH_DB: join(profile, 'isolated.sqlite') };
for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_SANDBOX', 'ELECTRON_DISABLE_SANDBOX', 'NODE_OPTIONS']) delete env[k];

function installProbe() {
  const canvas = document.querySelector('.cesium-widget canvas');
  let widget;
  for (let el = canvas; el && !widget; el = el.parentElement) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    for (let fiber = el[key]; fiber && !widget; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const ref = hook.memoizedState?.current;
        if (ref?.scene?.postRender && ref?.dataSources && ref.canvas === canvas) { widget = ref; break; }
      }
    }
  }
  if (!widget) throw new Error('Globe not found');
  const scene = widget.scene;
  const sky = scene.skyBox.show, atmosphere = scene.skyAtmosphere.show, background = scene.backgroundColor;
  window.obliqueProbe = {
    async sample(hideTerrain = false) {
      // A distinctive sky color reveals missing geometry even where the real sea texture is almost black.
      scene.skyBox.show = false; scene.skyAtmosphere.show = false;
      const showGlobe = scene.globe.show;
      const primitives = scene.primitives.show, groundPrimitives = scene.groundPrimitives.show;
      if (hideTerrain) {
        scene.globe.show = false;
        scene.primitives.show = false;
        scene.groundPrimitives.show = false;
      }
      scene.backgroundColor = new background.constructor(1, 0, 1, 1);
      const holes = await new Promise(done => {
        const off = scene.postRender.addEventListener(() => {
          off();
          const { drawingBufferWidth: width, drawingBufferHeight: height } = scene;
          const strip = Math.floor(height * .4);
          const bytes = scene.context.readPixels({ x: 0, y: 0, width, height: strip });
          let missing = 0;
          for (let i = 0; i < bytes.length; i += 4) if (bytes[i] > 250 && bytes[i+1] < 5 && bytes[i+2] > 250) missing++;
          done({ probedPixels: width * strip, missing });
        });
        scene.requestRender();
      });
      scene.backgroundColor = background; scene.skyBox.show = sky; scene.skyAtmosphere.show = atmosphere; scene.globe.show = showGlobe;
      scene.primitives.show = primitives; scene.groundPrimitives.show = groundPrimitives; scene.requestRender();
      const tiles = scene.globe._surface._tilesToRender.filter(t => t.data?.mesh && t.data?.terrainData?._mesh);
      let samePairs = 0, mixedPairs = 0, worstSame = 0, worstMixed = 0, aboveSkirt = 0;
      const worst = {};
      for (let i = 0; i < tiles.length; i++) for (let j = i+1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j], ar = a.rectangle, br = b.rectangle;
        const close = (x,y) => Math.abs(x-y) < 1e-10;
        const vertical = close(ar.east,br.west) || close(br.east,ar.west);
        const horizontal = close(ar.north,br.south) || close(br.north,ar.south);
        if (!vertical && !horizontal) continue;
        const lo = vertical ? Math.max(ar.south,br.south) : Math.max(ar.west,br.west);
        const hi = vertical ? Math.min(ar.north,br.north) : Math.min(ar.east,br.east);
        if (hi-lo < 1e-10) continue;
        if (a.level === b.level) samePairs++; else mixedPairs++;
        for (let k = 0; k <= 64; k++) {
          const position = lo + (hi-lo)*k/64;
          const lon = vertical ? (close(ar.east,br.west) ? ar.east : br.east) : position;
          const lat = vertical ? position : (close(ar.north,br.south) ? ar.north : br.north);
          const ah = a.data.terrainData.interpolateHeight(ar,lon,lat), bh = b.data.terrainData.interpolateHeight(br,lon,lat);
          const dz = Math.abs(ah-bh);
          const category = a.level===b.level ? 'same' : 'mixed';
          if (!worst[category] || worst[category].dz < dz) worst[category] = {
            dz, a: [a.x,a.y,a.level],b:[b.x,b.y,b.level],ha:ah,hb:bh,lat:lat*180/Math.PI,lon:lon*180/Math.PI,
            au:a.data.terrainData.wasCreatedByUpsampling(),bu:b.data.terrainData.wasCreatedByUpsampling() };
          if (a.level === b.level) worstSame = Math.max(worstSame,dz); else worstMixed = Math.max(worstMixed,dz);
          aboveSkirt = Math.max(aboveSkirt,dz-(ah>bh?a:b).data.terrainData._skirtHeight);
        }
      }
      const meters = n => Math.round(n*100)/100;
      return { ...holes, rendered:tiles.length, samePairs, mixedPairs, worstSameMeters:meters(worstSame),
        worstMixedMeters:meters(worstMixed), exceedsSkirtMeters:meters(aboveSkirt), worst, skirts:scene.globe.showSkirts };
    }
  };
}

let app;
try {
  app = await loadPlaywrightRuntime().electron.launch({ executablePath:exe,args:['--user-data-dir='+profile],env,chromiumSandbox:true });
  assert(await app.evaluate(({app},dir)=>app.isPackaged&&app.getPath('userData').toLowerCase()===dir.toLowerCase(),profile));
  const page = await app.firstWindow();
  page.on('pageerror',e=>log.errors.push(e.message));
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(()=>window.atlas.updateSettings({ basemap:'atlas',terrainEnabled:true,renderQuality:'balanced',labelsOverlay:false,buildings3d:false,
    layersEnabled:[],geoLabels:'off',streetLabels:false,reducedMotion:true }));
  await page.evaluate(installProbe);
  for (const view of [{name:'baltic-coast',lat:60.104,lon:24.947,h:700,pitch:-16},{name:'rainier',lat:46.752,lon:-121.76,h:6500,pitch:-18}]) {
    await page.evaluate(v=>window.__atlasDebug.setView(v.lat,v.lon,v.h,v.pitch),view);
    const entry = { ...view, samples:[] };
    log.views.push(entry);
    await delay(1200);
    let settled = 0;
    for (let t=0;t<24;t++) {
      const diag = await page.evaluate(()=>window.__atlasDebug.diag());
      if (t===0 || t===2 || settled===1 || t===23) {
        entry.samples.push({ ...await page.evaluate(()=>window.obliqueProbe.sample()),pending:diag.tilesPending,elapsedTick:t });
      }
      settled = diag.tilesPending===0 ? settled+1 : 0;
      if (settled>=2) break;
      await delay(1000);
    }
    await page.screenshot({path:join(folder,`${tag}-${view.name}.png`)});
    const last = entry.samples.at(-1);
    assert(last.samePairs>0 && last.mixedPairs>0,'Both equal and mixed LOD edges must be exercised');
    assert(last.probedPixels>100000 && last.skirts,'Probe must cover terrain with Cesium skirts active');
    if (!before) {
      assert.equal(last.missing,0,'Visible globe background in the lower part of the settled view');
      assert(last.worstSameMeters < 1,'Adjacent same-level surface heights should agree within mesh quantization');
      assert.equal(last.exceedsSkirtMeters,0,'Neighbor heights must overlap the visible edge skirt');
    }
  }
  log.negativeControl = await page.evaluate(()=>window.obliqueProbe.sample(true));
  assert(log.negativeControl.missing / log.negativeControl.probedPixels > .95,
    'The same pixel probe must detect the exposed sky when the globe is deliberately hidden');
  assert.deepEqual(log.errors,[]);
  log.result='PASS';
} catch(e) { log.error=e.message; process.exitCode=1; }
finally {
  if(app) await app.close();
  const out=JSON.stringify(log,null,2)+'\n';
  await writeFile(resolve(`docs/oblique-terrain-${tag}.log`),out);
  console.log(out);
}
