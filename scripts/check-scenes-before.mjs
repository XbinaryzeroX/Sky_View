// Before-state proof from prior dist. Isolated synthetic historical fixture, fully offline.
// No production build, user profile, installer, live provider or paid imagery requests.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const session = await mkdtemp(join(tmpdir(), 'atlas-scenes-before-'));
const output = join(root, 'docs/screenshots/scenes');
await mkdir(output, { recursive: true });
const db = join(session, 'qa.sqlite');
const seed = join(session, 'seed.cjs');
const bootstrap = join(session, 'bootstrap.cjs');
const at = new Date(Math.floor((Date.now() - 3600_000) / 1000) * 1000).toISOString();
await build({ stdin: { loader: 'ts', resolveDir: root, contents: `
import {AtlasStore} from ${JSON.stringify(join(root, 'src/main/store.ts'))};
import {normalizeUsgsFeed} from ${JSON.stringify(join(root, 'src/shared/normalize.ts'))};
const store=new AtlasStore(${JSON.stringify(db)});
store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false,
 quakeWindow:'day',quakeMinMagnitude:-1});
const at=${JSON.stringify(at)};
const payload=normalizeUsgsFeed({type:'FeatureCollection',metadata:{generated:Date.parse(at)-10000},features:[{type:'Feature',id:'qa-scenes-before-quake',
 geometry:{type:'Point',coordinates:[-122,37.5,8]},properties:{mag:3.2,time:Date.parse(at)-60000,updated:Date.parse(at)-10000,ids:',qa-scenes-before-quake,',
 type:'earthquake',title:'QA SCENES BEFORE — synthetic historical fixture',place:'Synthetic historical fixture',url:null}}]});
store.recordTimelineObservation({feed:'usgs',observedAt:at,sourceUpdatedAt:payload.sourceUpdatedAt,scope:'all_day',validForMs:900000,records:payload.quakes});
store.close();
` }, bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: seed, logLevel: 'silent' });
execFileSync(process.execPath, [seed], { cwd: root, stdio: 'pipe' });
await writeFile(bootstrap, `
const {app}=require('electron');const fs=require('node:fs/promises');let providerFetches=0;
globalThis.fetch=async()=>{providerFetches++;throw new Error('Offline before-state QA forbids provider fetches');};
app.on('web-contents-created',(_event,contents)=>contents.once('did-finish-load',async()=>{
 await contents.executeJavaScript('window.__atlasScenesBefore='+JSON.stringify({at:${JSON.stringify(at)}}));
 let busy=false,last='';const poll=setInterval(async()=>{if(busy||contents.isDestroyed())return;busy=true;
 try{const label=await contents.executeJavaScript('window.__atlasScenesBeforeCapture??null');if(label&&label!==last&&/^[a-z-]+$/.test(label)){
 last=label;await new Promise(resolve=>setTimeout(resolve,350));await fs.writeFile(${JSON.stringify(output)}+'/audit-scenes-before-'+label+'.png',(await contents.capturePage()).toPNG());
 await contents.executeJavaScript('window.__atlasScenesBeforeCaptured='+JSON.stringify(label));}}
 catch(error){if(!contents.isDestroyed())console.error('SCENES_BEFORE_ADAPTER_ERROR',error.message);}finally{busy=false;}},100);
 app.once('before-quit',()=>{clearInterval(poll);console.log('SCENES_BEFORE_PROVIDER_FETCHES '+providerFetches);});
}));require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});
`);
const child = spawn(require('electron'), [bootstrap], { cwd: root, env: { ...process.env,
  ATLAS_WATCH_SIMULATE_OFFLINE: '1', ATLAS_WATCH_SMOKE: '1', ATLAS_WATCH_SMOKE_MS: '25000',
  ATLAS_WATCH_DB: db, ATLAS_WATCH_USER_DATA: join(session, 'profile'), ATLAS_WATCH_SMOKE_JS: join(root, 'scripts/qa-scenes-before.js'),
  ATLAS_WATCH_SMOKE_SHOT: join(output, 'audit-scenes-before-overview.png'), ELECTRON_ENABLE_LOGGING: '1',
}, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const collect = chunk => { log += chunk; if (log.includes('SMOKE_SCRIPT_ERROR') || log.includes('SCENES_BEFORE_ADAPTER_ERROR')) child.kill(); };
child.stdout.on('data', collect); child.stderr.on('data', collect);
const timer = setTimeout(() => child.kill(), 45000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
finally { clearTimeout(timer); }
await writeFile(join(root, 'docs/scenes-before-audit.log'), log);
console.log(log.split(/\r?\n/).filter(line => /SMOKE_|SCENES_BEFORE_/.test(line)).join('\n'));
assert.equal(code, 0); assert(!log.includes('SMOKE_SCRIPT_ERROR') && !log.includes('SCENES_BEFORE_ADAPTER_ERROR'));
const scenario = JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1] ?? 'null');
assert.equal(scenario?.result, 'PASS'); assert.equal(scenario?.savedHasInvestigation, false); assert.equal(scenario?.restoredReplay, false);
assert.deepEqual(scenario?.rendererErrors, []); assert(log.includes('SCENES_BEFORE_PROVIDER_FETCHES 0'));
console.log(JSON.stringify({ result: 'PASS', providerTraffic: 0, fixture: 'synthetic historical record only', session, output }));
