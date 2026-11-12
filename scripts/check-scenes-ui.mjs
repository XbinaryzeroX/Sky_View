// Actual built desktop Scenes/investigation QA. TEMP profile; real public NWS/USGS,
// then an offline restart. No dist/build/package mutation or installer execution.
// Native file dialog results are adapted only in a TEMP bootstrap, not production.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const session = await mkdtemp(join(tmpdir(), 'atlas-scenes-ui-'));
const output = join(root, 'docs/screenshots/scenes');
await mkdir(output, { recursive: true });
const db = join(session, 'qa.sqlite'), seedPath = join(session, 'seed.cjs'), bootstrapPath = join(session, 'bootstrap.cjs');
const exportedPath = join(session, 'investigation-v2.json'), v1Path = join(session, 'legacy-v1.json');
const baselinePath = join(session, 'baseline.json'), sourcesPath = join(session, 'actual-responses.json');
const rendererRequestsPath = join(session, 'gibs-renderer-requests.json');
const now = new Date().toISOString();
const camera = { lat: -33.9249, lon: 18.4241, heightM: 500000, heading: 0.3, pitch: -1.2 };
const legacy = { id: 'qa-scenes-legacy', name: 'QA legacy camera view', camera, basemap: 'neutral', layersEnabled: [], createdAt: now };
const v1 = { format: 'atlas-watch-scene', version: 1, createdAt: now,
  camera: { lat: 51.5, lon: -0.12, heightM: 750000, heading: 0, pitch: -Math.PI / 2 }, basemap: 'neutral', terrainEnabled: false,
  layersEnabled: [], visualMode: 'normal',
  annotations: [{ id: 'qa-scenes-v1-pin', kind: 'pin', name: 'QA v1 compatible pin', color: '#123456', points: [[-0.12, 51.5]], visible: true, createdAt: now }], views: [legacy] };
await writeFile(v1Path, JSON.stringify(v1));
const catalog = JSON.parse(await readFile(join(root, 'src/renderer/data/gibsCatalog.json'), 'utf8'));
const product = catalog.products.find(product => product.id === 'MODIS_Terra_CorrectedReflectance_TrueColor');
assert(product, 'The existing public GIBS product is missing');
const imagery = { product: product.category + '|' + product.id, date: '2020-07-01', compare: true, compareDate: '2020-07-08', opacity: 0.55, split: 0.34 };
await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
import {AtlasStore} from ${JSON.stringify(join(root, 'src/main/store.ts'))};
const store=new AtlasStore(${JSON.stringify(db)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,
 quakeWindow:'day',quakeMinMagnitude:-1,quakesNearLocationsOnly:false,nwsPollSeconds:3600,usgsPollSeconds:3600});
store.putDoc('saved_views',${JSON.stringify(legacy.id)},${JSON.stringify(legacy)},${JSON.stringify(now)});
store.createLocation({name:'QA_PRIVATE_LOCATION_NOT_EXPORTED',category:'QA privacy guard',notes:'QA_PRIVATE_NOTES_NOT_EXPORTED',lat:52.5,lon:13.4,radiusKm:1},
 ${JSON.stringify(now)},{status:'disabled',zones:[],checkedAt:null,error:null});
store.setMeta('qa-scenes-private','QA_PRIVATE_META_NOT_EXPORTED');store.close();
` }, bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: seedPath, logLevel: 'silent' });
execFileSync(process.execPath, [seedPath], { cwd: root, stdio: 'pipe' });

await writeFile(bootstrapPath, `
const {app,dialog}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');
const responses=[],gibsRequests=[];let chooser=0;const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{const raw=typeof input==='string'?input:input.url??String(input);const response=await nativeFetch(input,options);
 if(/^https:\\/\\/(?:earthquake\\.usgs\\.gov\\/earthquakes\\/feed\\/v1\\.0\\/summary\\/|api\\.weather\\.gov\\/alerts\\/active)/.test(raw)){
  const text=await response.clone().text();let body;try{body=JSON.parse(text);}catch{body={parseError:true};}
  responses.push({requestUrl:raw,httpStatus:response.status,responseDate:response.headers.get('date'),receivedAt:new Date().toISOString(),body});
  await fs.writeFile(${JSON.stringify(sourcesPath)},JSON.stringify(responses));}return response;};
dialog.showSaveDialog=async(...args)=>{if(!args.at(-1).filters?.some(filter=>filter.name==='Atlas Watch scene'))throw new Error('Unexpected save dialog');
 return {canceled:false,filePath:${JSON.stringify(exportedPath)}};};
dialog.showOpenDialog=async(...args)=>{if(!args.at(-1).filters?.some(filter=>filter.name==='Atlas Watch scene'))throw new Error('Unexpected open dialog');
 return {canceled:false,filePaths:[++chooser===1?${JSON.stringify(exportedPath)}:${JSON.stringify(v1Path)}]};};
app.on('web-contents-created',(_event,contents)=>contents.once('did-finish-load',async()=>{
 const restart=process.env.ATLAS_SCENES_QA_PHASE==='restart';const baseline=restart?JSON.parse(await fs.readFile(${JSON.stringify(baselinePath)},'utf8')):null;
 await contents.executeJavaScript('window.__atlasScenesQa='+JSON.stringify({restart,baseline,legacy:${JSON.stringify(legacy)},v1:${JSON.stringify(v1)},imagery:${JSON.stringify(imagery)}}));
 contents.debugger.attach('1.3');await contents.debugger.sendCommand('Network.enable');
 contents.debugger.on('message',(_event,method,params)=>{if(method==='Network.requestWillBeSent'&&params.request.url.includes('gibs.earthdata.nasa.gov')){
  gibsRequests.push({url:params.request.url,at:new Date().toISOString()});void fs.writeFile(${JSON.stringify(rendererRequestsPath)},JSON.stringify(gibsRequests));}});
 let busy=false,lastCapture='',done=false;const poll=setInterval(async()=>{if(busy||contents.isDestroyed())return;busy=true;
  try{const label=await contents.executeJavaScript('window.__atlasScenesQaCapture??null');
   if(label&&label!==lastCapture&&/^[a-z-]+$/.test(label)){lastCapture=label;await new Promise(resolve=>setTimeout(resolve,350));
    await fs.writeFile(path.join(${JSON.stringify(output)},'audit-scenes-'+label+'.png'),(await contents.capturePage()).toPNG());
    await contents.executeJavaScript('window.__atlasScenesQaCaptured='+JSON.stringify(label));}
   if(!done&&await contents.executeJavaScript('window.__atlasScenesQaDone===true')){done=true;clearInterval(poll);
    await new Promise(resolve=>setTimeout(resolve,2500));
    console.log('SMOKE_RESULT '+await contents.executeJavaScript('JSON.stringify(window.__atlasSmoke??null)'));
    console.log('SCENES_GIBS_REQUESTS '+gibsRequests.length);await fs.writeFile(${JSON.stringify(rendererRequestsPath)},JSON.stringify(gibsRequests));app.quit();}
  }catch(error){if(!contents.isDestroyed())console.error('SCENES_QA_ADAPTER_ERROR',error.stack);}finally{busy=false;}
 },100);app.once('before-quit',()=>{clearInterval(poll);if(contents.debugger.isAttached())contents.debugger.detach();});
}));require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});
`);
execFileSync(process.execPath, ['--check', bootstrapPath], { stdio: 'pipe' });
const html = await readFile(join(root, 'dist/renderer/index.html'), 'utf8');
const assetPaths = ['dist/main/main.cjs', 'dist/preload/preload.cjs', 'dist/renderer/index.html', ...Array.from(html.matchAll(/(?:src|href)="\/(assets\/[^\"]+)"/g), match => 'dist/renderer/' + match[1])];
const hashes = async () => Object.fromEntries(await Promise.all(assetPaths.map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])));
const initialHashes = await hashes();

async function run(restart) {
  const child = spawn(require('electron'), [bootstrapPath], { cwd: root, env: { ...process.env,
    ATLAS_WATCH_SMOKE: '1', ATLAS_WATCH_SMOKE_MS: '120000', ATLAS_WATCH_DB: db, ATLAS_WATCH_USER_DATA: join(session, 'profile'),
    ATLAS_WATCH_SIMULATE_OFFLINE: restart ? '1' : '0', ATLAS_SCENES_QA_PHASE: restart ? 'restart' : 'initial',
    ATLAS_WATCH_SMOKE_JS: join(root, 'scripts/qa-scenes.js'),
    ATLAS_WATCH_SMOKE_SHOT: join(output, 'audit-scenes-' + (restart ? 'restart' : 'initial') + '.png'), ELECTRON_ENABLE_LOGGING: '1',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const collect = chunk => { log += chunk; if (log.includes('SMOKE_SCRIPT_ERROR') || log.includes('SCENES_QA_ADAPTER_ERROR')) child.kill(); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const timer = setTimeout(() => child.kill(), 140000);
  let code;
  try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearTimeout(timer); }
  await writeFile(join(output, 'scenes-' + (restart ? 'restart' : 'initial') + '.log'), log);
  console.log(log.split(/\r?\n/).filter(line => /SMOKE_|SCENES_/.test(line) && !/^SMOKE_SCRIPT /.test(line)).join('\n'));
  assert.equal(code, 0, 'Scenes desktop phase failed; inspect phase log'); assert(!log.includes('SMOKE_SCRIPT_ERROR') && !log.includes('SCENES_QA_ADAPTER_ERROR'));
  const result = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? 'null');
  const renderer = JSON.parse(/^SMOKE_RESULT (.+)$/m.exec(log)?.[1] ?? 'null');
  assert.equal(result?.result, 'PASS'); assert.equal(renderer?.globeReady, true); assert.deepEqual(renderer?.errors, []);
  assert.deepEqual(JSON.parse(await readFile(rendererRequestsPath, 'utf8')), [], 'Dated GIBS imagery was requested while Replay should keep it hidden');
  console.log('SCENES_PHASE '+JSON.stringify({result:result.result,restart,checks:result.checks}));
  return result;
}
console.log(JSON.stringify({status:'STARTING',session,providers:'actual public NWS/USGS only; offline restart',imagery:'public catalog configuration, hidden during Replay',output}));
const first = await run(false); await writeFile(baselinePath, JSON.stringify(first));
const exported = JSON.parse(await readFile(exportedPath, 'utf8'));
assert.equal(exported.version, 2); assert.equal(exported.investigation.clock.mode, 'recorded');
assert(!/QA_PRIVATE_|"payload"|"sourceUrl"|"records"|"apiKey"|"credentials"/.test(JSON.stringify(exported)), 'Scene file leaked private/storage/provider payload fields');
const responses = JSON.parse(await readFile(sourcesPath, 'utf8'));
for (const selected of first.selectedRecords) {
  const match = responses.some(response => response.httpStatus === 200 && response.body.features?.some(feature => selected.kind === 'quake'
    ? (feature.id === selected.id || String(feature.properties?.ids ?? '').split(',').includes(selected.id)) && feature.properties?.mag === selected.mag && feature.geometry?.coordinates?.[0] === selected.lon && feature.geometry?.coordinates?.[1] === selected.lat
    : (feature.properties?.id === selected.id || feature.id === selected.id) && new Date(feature.properties?.sent).toISOString() === selected.sent));
  assert(match, 'Selected restored record is absent from actual captured source replies');
}
const restarted = await run(true); assert.deepEqual(await hashes(), initialHashes, 'Built assets changed during Scenes QA');
const sourceAudit = responses.map(response => ({requestUrl:response.requestUrl,httpStatus:response.httpStatus,responseDate:response.responseDate,receivedAt:response.receivedAt,
 sourceUpdatedAt:response.body.updated?new Date(response.body.updated).toISOString():response.body.metadata?.generated?new Date(response.body.metadata.generated).toISOString():null,
 sourceTimestampField:response.body.updated?'NWS updated':'USGS metadata.generated',featureCount:response.body.features?.length??null,
 payloadSha256:createHash('sha256').update(JSON.stringify(response.body)).digest('hex')}));
const audit = {result:'PASS',initial:first,restarted,nativeFileDialogInteraction:false,fileDialogAdapter:'TEMP chooser/save results only',
 publicGibsProduct:imagery,rendererGibsRequests:0,actualSourceSelectionValuesVerified:true,sourceAudit,builtAssetsUnchanged:true,assetSha256:initialHashes,
 exportVersion:exported.version,exportSha256:createHash('sha256').update(await readFile(exportedPath)).digest('hex'),session,output};
await writeFile(join(root,'docs/scenes-audit.log'),JSON.stringify(audit,null,2));
await writeFile(join(output,'scenes-audit.log'),JSON.stringify(audit,null,2));
console.log(JSON.stringify(audit,null,2));
