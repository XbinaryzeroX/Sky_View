// Isolated desktop integration proof for recorded civil hazards. Never builds/mutates dist.
// node scripts/check-timeline-ui.mjs [--out-dir docs/screenshots/timeline]
// Historical QA fixtures are seeded using actual AppCore in a separate Node process,
// then feed_cache is cleared. The built app's NWS/USGS providers are never replaced.
// The TEMP bootstrap can delay/reject a timeline IPC result for explicit race checks.
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
const outIndex = process.argv.indexOf('--out-dir');
assert(outIndex < 0 || process.argv[outIndex + 1], '--out-dir needs a directory');
const output = resolve(outIndex < 0 ? 'docs/screenshots/timeline' : process.argv[outIndex + 1]);
await mkdir(output, { recursive: true });
const session = await mkdtemp(join(tmpdir(), 'atlas-timeline-ui-'));
const db = join(session, 'qa.sqlite');
const fixturePath = join(session, 'historical-fixture.json');
const responsesPath = join(session, 'actual-source-responses.json');
const faultsPath = join(session, 'timeline-ipc-adapters.json');
const seedPath = join(session, 'seed.cjs');
const bootstrapPath = join(session, 'bootstrap.cjs');
const base = Math.floor(Date.now() / 1000) * 1000;
const iso = delta => new Date(base + delta).toISOString();
const fixture = {
  label: 'EXPLICIT SYNTHETIC HISTORICAL QA — never actual NWS/USGS observations',
  generatedAt: iso(0), firstNwsAt: iso(-5 * 3600_000), firstBothAt: iso(-5 * 3600_000 + 60_000),
  revisedAt: iso(-4 * 3600_000), emptyAt: iso(-3 * 3600_000), expiredAt: iso(-2.5 * 3600_000),
  partialAt: iso(-2 * 3600_000), failureAt: iso(-1.5 * 3600_000),
  oldAlertId: 'urn:oid:qa-replay-fixture-alert-v1', newAlertId: 'urn:oid:qa-replay-fixture-alert-v2', quakeId: 'qa-replay-fixture-quake',
  oldAlertRing: [[-123, 37], [-121, 37], [-121, 39], [-123, 39], [-123, 37]],
  newAlertRing: [[-157, 19], [-155, 19], [-155, 21], [-157, 21], [-157, 19]],
  oldQuake: { lat: 37.5, lon: -122, mag: 3.2 }, newQuake: { lat: 20, lon: -156, mag: 5.6 },
};
await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
await build({ stdin: { resolveDir: root, loader: 'ts', sourcefile: 'timeline-qa-historical-seed.ts', contents: `
import { AtlasStore } from ${JSON.stringify(join(root, 'src/main/store.ts'))};
import { AppCore } from ${JSON.stringify(join(root, 'src/main/core.ts'))};
import { normalizeNwsAlerts, normalizeUsgsFeed } from ${JSON.stringify(join(root, 'src/shared/normalize.ts'))};
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync } from 'node:fs';
void (async()=>{
const f=JSON.parse(readFileSync(${JSON.stringify(fixturePath)},'utf8'));
const store=new AtlasStore(${JSON.stringify(db)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,
  quakeWindow:'day',quakeMinMagnitude:-1,quakesNearLocationsOnly:false,nwsPollSeconds:180,usgsPollSeconds:300});
let clock=new Date(f.firstNwsAt),stage=1;
const alert=(revision)=>{const at=revision===1?f.firstNwsAt:f.revisedAt,id=revision===1?f.oldAlertId:f.newAlertId;
 return {type:'Feature',id:'https://api.weather.gov/alerts/'+id,geometry:{type:'Polygon',coordinates:[revision===1?f.oldAlertRing:f.newAlertRing]},properties:{
  id,event:'QA REPLAY FIXTURE weather revision '+revision,headline:'QA REPLAY FIXTURE alert revision '+revision,
  description:'Synthetic archived fixture. Never actual weather observations.',instruction:'QA fixture only.',areaDesc:'QA fixture region',
  sent:at,effective:at,onset:at,expires:new Date(Date.parse(f.generatedAt)-30*60000).toISOString(),ends:null,
  status:'Actual',messageType:revision===1?'Alert':'Update',category:'Met',severity:revision===1?'Moderate':'Severe',certainty:'Observed',urgency:'Immediate',
  senderName:'QA synthetic historical fixture',affectedZones:[],geocode:{UGC:[]},references:revision===1?[]:[{identifier:f.oldAlertId,sent:f.firstNwsAt,sender:'QA fixture'}]}};};
const quake=(revision)=>{const q=revision===1?f.oldQuake:f.newQuake,at=revision===1?f.firstBothAt:f.revisedAt;
 return {type:'Feature',id:f.quakeId,geometry:{type:'Point',coordinates:[q.lon,q.lat,8]},properties:{mag:q.mag,type:'earthquake',
 time:Date.parse(f.firstNwsAt)-60000,updated:Date.parse(at),ids:','+f.quakeId+',',status:'reviewed',
 place:'QA REPLAY FIXTURE earthquake revision '+revision,title:'QA REPLAY FIXTURE earthquake revision '+revision,
 url:'https://earthquake.usgs.gov/earthquakes/eventpage/'+f.quakeId}};};
const core=new AppCore({store,now:()=>clock,
 alertSource:{name:'separate Node historical fixture seed',fetchActiveAlerts:async()=>({...normalizeNwsAlerts({type:'FeatureCollection',updated:clock.toISOString(),features:stage===3?[]:stage===1?[alert(1)]:stage===2?[alert(1),alert(2)]:[alert(2)]}),...(stage===4?{skipped:1}:{})}),
 fetchPointZones:async()=>({status:'disabled',zones:[],checkedAt:null,error:null})},
 quakeSource:{name:'separate Node historical fixture seed',fetchRecent:async()=>{if(stage===5)throw new Error('Explicit historical QA failure marker');
 return {...normalizeUsgsFeed({type:'FeatureCollection',metadata:{generated:clock.getTime()},features:stage===3?[]:[quake(stage===1?1:2)]}),feedKey:'all_day'};}}});
core.init();await core.refresh('nws');clock=new Date(f.firstBothAt);await core.refresh('usgs');
clock=new Date(f.revisedAt);stage=2;await core.refresh('nws');await core.refresh('usgs');
clock=new Date(f.emptyAt);stage=3;await core.refresh('nws');await core.refresh('usgs');
clock=new Date(f.partialAt);stage=4;await core.refresh('nws');
clock=new Date(f.failureAt);stage=5;await core.refresh('usgs');core.stop();
const range=store.timelineRange();
const frames=Object.fromEntries(['firstNwsAt','firstBothAt','revisedAt','emptyAt','expiredAt','partialAt','failureAt'].map(key=>{const value=store.timelineFrame(f[key]);
 return [key,{nws:value.nws.state,nwsIds:value.nws.records.map(record=>record.id),usgs:value.usgs.state,quakes:value.usgs.records.map(({id,mag,lat,lon})=>({id,mag,lat,lon}))}];}));
writeFileSync(${JSON.stringify(join(session, 'seed-audit.json'))},JSON.stringify({range,frames,syntheticHistoricalFixturesOnly:true,liveFeedCacheCleared:true,pointCount:0},null,2));
store.close();const cleanup=new DatabaseSync(${JSON.stringify(db)});cleanup.exec('DELETE FROM feed_cache');cleanup.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
` }, bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: seedPath, logLevel: 'silent' });
execFileSync(process.execPath, [seedPath], { cwd: root, stdio: 'pipe' });
const seedAudit = JSON.parse(await readFile(join(session, 'seed-audit.json'), 'utf8'));
assert.equal(seedAudit.range.points, 0, 'Historical seed must prove hazard-only Replay');
assert(seedAudit.range.nwsFrames >= 3 && seedAudit.range.usgsFrames >= 3, 'Historical observations were not archived by actual core');
assert.equal(seedAudit.frames.firstNwsAt.nws, 'recorded'); assert.equal(seedAudit.frames.firstNwsAt.usgs, 'unknown');
assert.equal(seedAudit.frames.firstBothAt.quakes[0]?.mag, fixture.oldQuake.mag);
assert.equal(seedAudit.frames.revisedAt.quakes[0]?.mag, fixture.newQuake.mag);
assert.equal(seedAudit.frames.emptyAt.nws, 'recorded'); assert.equal(seedAudit.frames.emptyAt.usgs, 'recorded');
assert.deepEqual(seedAudit.frames.emptyAt.nwsIds, []); assert.deepEqual(seedAudit.frames.emptyAt.quakes, []);
assert.equal(seedAudit.frames.expiredAt.nws, 'gap'); assert.equal(seedAudit.frames.expiredAt.usgs, 'gap');
assert.equal(seedAudit.frames.partialAt.nws, 'partial'); assert.equal(seedAudit.frames.failureAt.usgs, 'gap');
if (process.argv.includes('--seed-only')) { console.log(JSON.stringify({ result: 'PASS', mode: 'synthetic historical seed only; no desktop or network', seedAudit, session }, null, 2)); process.exit(0); }

await writeFile(bootstrapPath, `
const {app,ipcMain}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');
const responses=[],faultLog=[];const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options)=>{const raw=typeof input==='string'?input:input.url??String(input);const response=await nativeFetch(input,options);
 if(/^https:\\/\\/(?:earthquake\\.usgs\\.gov\\/earthquakes\\/feed\\/v1\\.0\\/summary\\/|api\\.weather\\.gov\\/alerts\\/active)/.test(raw)){
  const text=await response.clone().text();let body;try{body=JSON.parse(text);}catch{body={parseError:true};}
  responses.push({requestUrl:raw,httpStatus:response.status,responseDate:response.headers.get('date'),receivedAt:new Date().toISOString(),body});
  await fs.writeFile(${JSON.stringify(responsesPath)},JSON.stringify(responses));}return response;};
let pendingFault=null;const nativeHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>nativeHandle(channel,channel==='timeline:frame'?async(event,...args)=>{
 const result=await listener(event,...args);const fault=pendingFault;
 if(fault&&fault.t===args[0]){pendingFault=null;faultLog.push({...fault,requestedAt:new Date().toISOString()});
  await fs.writeFile(${JSON.stringify(faultsPath)},JSON.stringify(faultLog));
  if(fault.delayMs)await new Promise(resolve=>setTimeout(resolve,fault.delayMs));
  if(fault.error)throw new Error('Explicit timeline QA IPC failure (not a provider response)');}
 return result;}:listener);
app.on('web-contents-created',(_event,contents)=>contents.once('did-finish-load',async()=>{
 await contents.executeJavaScript('window.__atlasTimelineQa='+JSON.stringify({fixture:${JSON.stringify(fixture)},seedAudit:${JSON.stringify(seedAudit)}}));
 let busy=false,lastCapture='',lastControl=0,lastClick=0;
 const poll=setInterval(async()=>{if(busy||contents.isDestroyed())return;busy=true;
  try{const control=await contents.executeJavaScript('window.__atlasTimelineQaControl??null');
   if(control&&control.id!==lastControl){lastControl=control.id;pendingFault=control.fault;await contents.executeJavaScript('window.__atlasTimelineQaControlled='+JSON.stringify(control.id));}
   const click=await contents.executeJavaScript('window.__atlasTimelineQaClick??null');
   if(click&&click.id!==lastClick){lastClick=click.id;contents.sendInputEvent({type:'mouseMove',x:Math.round(click.x),y:Math.round(click.y)});
    contents.sendInputEvent({type:'mouseDown',x:Math.round(click.x),y:Math.round(click.y),button:'left',clickCount:1});
    contents.sendInputEvent({type:'mouseUp',x:Math.round(click.x),y:Math.round(click.y),button:'left',clickCount:1});
    await contents.executeJavaScript('window.__atlasTimelineQaClicked='+JSON.stringify(click.id));}
   const label=await contents.executeJavaScript('window.__atlasTimelineQaCapture??null');
   if(label&&label!==lastCapture&&/^[a-z-]+$/.test(label)){lastCapture=label;await new Promise(resolve=>setTimeout(resolve,350));
    await fs.writeFile(path.join(${JSON.stringify(output)},'audit-timeline-'+label+'.png'),(await contents.capturePage()).toPNG());
    await contents.executeJavaScript('window.__atlasTimelineQaCaptured='+JSON.stringify(label));}
  }catch(error){if(!contents.isDestroyed())console.error('TIMELINE_QA_ADAPTER_ERROR',error.stack);}finally{busy=false;}
 },100);app.once('before-quit',()=>clearInterval(poll));
}));
require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});
`);
execFileSync(process.execPath, ['--check', bootstrapPath], { stdio: 'pipe' });
const html = await readFile(join(root, 'dist/renderer/index.html'), 'utf8');
const assetPaths = ['dist/main/main.cjs', 'dist/preload/preload.cjs', 'dist/renderer/index.html', ...Array.from(html.matchAll(/(?:src|href)="\/(assets\/[^\"]+)"/g), match => 'dist/renderer/' + match[1])];
const hashes = async () => Object.fromEntries(await Promise.all(assetPaths.map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])));
const initialHashes = await hashes();
console.log(JSON.stringify({ status: 'STARTING', providers: 'actual NWS and USGS, no provider adapters', historical: 'explicit synthetic QA fixture', seedAudit, session, output }));
const child = spawn(require('electron'), [bootstrapPath], { cwd: root, env: { ...process.env,
  ATLAS_WATCH_SMOKE: '1', ATLAS_WATCH_SMOKE_MS: '120000', ATLAS_WATCH_DB: db, ATLAS_WATCH_USER_DATA: join(session, 'profile'),
  ATLAS_WATCH_SMOKE_JS: join(root, 'scripts/qa-timeline.js'), ATLAS_WATCH_SMOKE_SHOT: join(output, 'audit-timeline-overview.png'), ELECTRON_ENABLE_LOGGING: '1',
}, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const collect = chunk => { log += chunk; if (log.includes('SMOKE_SCRIPT_ERROR') || log.includes('TIMELINE_QA_ADAPTER_ERROR')) child.kill(); };
child.stdout.on('data', collect); child.stderr.on('data', collect);
const timer = setTimeout(() => child.kill(), 145000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
finally { clearTimeout(timer); }
await writeFile(join(output, 'timeline-desktop.log'), log);
console.log(log.split(/\r?\n/).filter(line => /SMOKE_|TIMELINE_QA/.test(line) && !/^SMOKE_SCRIPT /.test(line)).join('\n'));
assert.equal(code, 0, 'Desktop Replay scenario failed; inspect phase log');
assert(!log.includes('SMOKE_SCRIPT_ERROR') && !log.includes('TIMELINE_QA_ADAPTER_ERROR'));
const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? 'null');
const renderer = JSON.parse(/^SMOKE_RESULT (.+)$/m.exec(log)?.[1] ?? 'null');
assert.equal(scenario?.result, 'PASS'); assert.equal(renderer?.globeReady, true); assert.deepEqual(renderer?.errors, []);
assert.deepEqual(await hashes(), initialHashes, 'Built assets changed during QA');
const responses = JSON.parse(await readFile(responsesPath, 'utf8'));
assert(responses.some(response => response.requestUrl.includes('api.weather.gov/') && response.httpStatus === 200));
assert(responses.some(response => response.requestUrl.includes('earthquake.usgs.gov/') && response.httpStatus === 200));
for (const q of scenario.liveVerificationRecords.usgs) assert(responses.some(response => response.body.features?.some(feature =>
  (feature.id === q.id || String(feature.properties?.ids ?? '').split(',').includes(q.id)) && feature.properties?.mag === q.mag &&
  feature.geometry?.coordinates?.[0] === q.lon && feature.geometry?.coordinates?.[1] === q.lat && new Date(feature.properties?.updated).toISOString() === q.updated)), 'Archived live USGS record absent from actual response');
for (const a of scenario.liveVerificationRecords.nws) assert(responses.some(response => response.body.features?.some(feature =>
  (feature.properties?.id === a.id || feature.id === a.id) && (a.sent === null ? feature.properties?.sent == null : new Date(feature.properties?.sent).toISOString() === a.sent))), 'Archived live NWS record absent from actual response');
const sourceAudit = responses.map(response => ({ requestUrl: response.requestUrl, httpStatus: response.httpStatus, responseDate: response.responseDate, receivedAt: response.receivedAt,
  sourceUpdatedAt: response.body.updated ?? (response.body.metadata?.generated ? new Date(response.body.metadata.generated).toISOString() : null),
  sourceTimestampField: response.body.updated ? 'NWS updated' : response.body.metadata?.generated ? 'USGS metadata.generated' : null,
  featureCount: response.body.features?.length ?? null, payloadSha256: createHash('sha256').update(JSON.stringify(response.body)).digest('hex') }));
const { liveVerificationRecords, ...compact } = scenario;
const audit = { ...compact, actualProviderValuesVerified: { nws: liveVerificationRecords.nws.length, usgs: liveVerificationRecords.usgs.length },
  adapters: 'TEMP historical fixture seed; real timeline IPC result timing/error injection only; actual native Electron canvas mouse input',
  syntheticProviderFallbackUsed: false, builtAssetsUnchanged: true, assetSha256: initialHashes, sourceAudit,
  ipcAdapterCalls: JSON.parse(await readFile(faultsPath, 'utf8')), session, output };
await writeFile(join(output, 'timeline-audit.log'), JSON.stringify(audit, null, 2));
await writeFile(join(root, 'docs/timeline-audit.log'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
