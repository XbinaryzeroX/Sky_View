// Exercise the historical surface picker on the real desktop map, including a cold archived startup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { loadPlaywrightRuntime } from './qa-playwright-runtime.mjs';

const exe = resolve(process.argv[2] || 'release/win-unpacked/Atlas Watch.exe');
const maskOffline = process.argv.includes('--mask-offline');
const runName = maskOffline ? 'satellite-years-mask-offline' : 'satellite-years';
const folder = resolve('docs/screenshots',runName);
await mkdir(folder, {recursive:true});
const profile = await mkdtemp(join(tmpdir(), 'atlas-satellite-year-'));
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith('ATLAS_WATCH_') || ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_NO_SANDBOX','ELECTRON_DISABLE_SANDBOX'].includes(key)) delete env[key];
}
env.ATLAS_WATCH_DB = join(profile, 'years.sqlite');
const db = new DatabaseSync(env.ATLAS_WATCH_DB);
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.prepare('INSERT INTO meta VALUES (?,?)').run('settings', JSON.stringify({
  basemap:'google3d', imageryYear:2001, buildings3d:true, radarEnabled:true, terrainEnabled:false,
  labelsOverlay:false, geoLabels:'off', layersEnabled:[],
}));
db.close();
const report = { time:new Date().toISOString(), result:'FAIL', asar:createHash('sha256')
  .update(await readFile(join(dirname(exe),'resources/app.asar'))).digest('hex'), views:[], errors:[], paidRequests:0, blockedMaskRequests:0 };
let app, page;
const { electron } = loadPlaywrightRuntime();
function inspect() {
  const canvas = document.querySelector('.cesium-widget canvas');
  let w;
  for(let el=canvas; el && !w; el=el.parentElement) {
    const id=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));
    for(let f=el[id];f&&!w;f=f.return) for(let h=f.memoizedState;h;h=h.next) {
      const ref=h.memoizedState?.current;
      if(ref?.canvas===canvas && ref?.scene?.globe) { w=ref;break; }
    }
  }
  if (!w) throw Error('Missing viewer');
  window.__yearLayers = () => {
    const at=w.camera.positionCartographic;
    const covers=r=>r && r.west<=at.longitude && r.east>=at.longitude && r.south<=at.latitude && r.north>=at.latitude;
    const tiles=w.scene.globe._surface._tilesToRender.filter(tile=>covers(tile.rectangle));
    const seen=new Set();
    for(const tile of tiles) for(const s of tile.data?.imagery??[]) {
      const i=s.readyImagery;
      if (i && covers(i.rectangle) && i.level>=1) seen.add(i.level + ' · ' + i.imageryLayer.imageryProvider?.credit?.html);
    }
    return [...seen].filter(Boolean);
  };
}
async function launch() {
  app = await electron.launch({executablePath:exe,args:['--user-data-dir='+profile],env,chromiumSandbox:true});
  await app.context().route(/https:\/\/[^/]*googleapis\.com\//, route => { report.paidRequests++; return route.abort(); });
  if (maskOffline) await app.context().route('https://titiler.terrascope.be/wms?**', route => {
    report.blockedMaskRequests++;
    return route.abort();
  });
  page = await app.firstWindow();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.waitForFunction(()=>window.__atlasDebug?.diag()?.globeShown);
  await page.evaluate(inspect);
}
const picker = () => page.getByRole('combobox',{name:'Satellite imagery year'});
async function checkYear(year, expectedDate) {
  if (expectedDate) {
    await page.waitForFunction(date => window.__atlasDebug.diag().basemapSources.some(s=>s.captureDate===date+' UTC'),expectedDate);
    await page.waitForFunction(date=>window.__yearLayers().some(c=>Number.parseInt(c)>=4 && c.includes(date)),expectedDate,{timeout:90000});
  } else {
    await page.waitForFunction(y=>window.__yearLayers().some(c=>Number.parseInt(c)>=12 && c.includes('WorldCover') && c.includes(y)),String(year),{timeout:90000});
  }
  await page.waitForFunction(() => window.__atlasDebug.diag().tilesPending === 0, undefined, {timeout:90000});
  const state=await page.evaluate(()=>({drawn:window.__yearLayers(), sources:window.__atlasDebug.diag().basemapSources.map(s=>s.name),
    buildings:window.__atlasDebug.diag().buildings.enabled, photoreal:window.__atlasDebug.diag().photorealLoaded}));
  assert.equal(state.buildings,false);
  assert.equal(state.photoreal,false);
  assert(!state.drawn.some(c=>/USGS|Blue Marble|Google Photoreal|nowCOAST/i.test(c)));
  report.views.push({year,...state});
}
try {
  await launch();
  assert.equal(await picker().inputValue(),'2001');
  await page.evaluate(()=>window.__atlasDebug.setView(56,19,1400000,-90));
  await checkYear(2001,'2001-07-03');
  await page.screenshot({path:join(folder,'terra-2001.png')});
  await page.evaluate(()=>window.__atlasDebug.setView(60.095,19.93,13500,-90));
  const crops = [];
  for(const year of [2020,2021]) {
    await picker().selectOption(String(year));
    await checkYear(year,null);
    const screenshot = await page.screenshot({path:join(folder,'baltic-'+year+'.png')});
    const { width, height } = await sharp(screenshot).metadata();
    crops.push(await sharp(screenshot).extract({left:Math.round(width*.52),top:Math.round(height*.46),width:200,height:150})
      .removeAlpha().raw().toBuffer());
  }
  report.harbourEdgeFractions = crops.map(photo => {
    let edges = 0;
    for (let row = 0; row < 150; row++) for (let col = 1; col < 200; col++) {
      const i = (row * 200 + col) * 3;
      if (Math.abs(photo[i]-photo[i-3])+Math.abs(photo[i+1]-photo[i-2])+Math.abs(photo[i+2]-photo[i-1]) > 12) edges++;
    }
    return edges / (150*199);
  });
  assert(report.harbourEdgeFractions.every(fraction => fraction > .025), 'Both years must show actual harbour detail, including when WMS masks are unavailable');
  let changed=0;
  for(let i=0;i<crops[0].length;i+=3) {
    if (Math.abs(crops[0][i]-crops[1][i])+Math.abs(crops[0][i+1]-crops[1][i+1])+Math.abs(crops[0][i+2]-crops[1][i+2])>12) changed++;
  }
  report.changedPixelFraction = changed/(200*150);
  assert(report.changedPixelFraction>.1,'The same terrain should show different observed imagery when its year changes');
  await app.close(); app=undefined;
  await launch();
  assert.equal(await picker().inputValue(),'2021');
  const before=await page.evaluate(()=>window.atlas.getState().then(s=>s.settings));
  assert.equal(before.basemap,'google3d');
  assert.equal(before.buildings3d,true);
  assert.equal(before.radarEnabled,true);
  await picker().selectOption('');
  await page.waitForFunction(()=>window.__atlasDebug.diag().basemapSources.some(s=>s.provider.startsWith('Google')));
  await page.waitForFunction(()=>window.__atlasDebug.diag().buildings.enabled);
  assert.equal((await page.evaluate(()=>window.atlas.getState())).settings.imageryYear,null);
  assert.equal(report.paidRequests,0);
  if(maskOffline) assert(report.blockedMaskRequests > 0);
  assert.deepEqual(report.errors,[]);
  report.result='PASS';
} catch(e) {
  report.failure=e.stack;process.exitCode=1;
  report.drawn=await page?.evaluate(()=>window.__yearLayers?.()).catch(()=>null);
} finally {
  await app?.close();
  await writeFile(resolve('docs',runName+'-packaged.log'),JSON.stringify(report,null,2)+'\n');
  console.log(report);
}
