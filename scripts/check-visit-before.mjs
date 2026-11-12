// Untouched previous-build Briefing evidence. TEMP DB/profile, neutral map and fully offline.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
// Preserve the evidence when somebody reruns this baseline check after upgrading dist.
const { assetSha256: previousAssets } = JSON.parse(await readFile(join(root, 'docs/scenes-audit.log'), 'utf8'));
for (const [name, expected] of Object.entries(previousAssets)) {
  const actual = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  assert.equal(actual, expected, 'This check requires the preceding Scenes distribution: ' + name);
}
const session=await mkdtemp(join(tmpdir(),'atlas-visit-before-')),output=join(root,'docs/screenshots/visit');
await mkdir(output,{recursive:true});
const db=join(session,'qa.sqlite'),seed=join(session,'seed.cjs'),bootstrap=join(session,'bootstrap.cjs');
await build({stdin:{loader:'ts',resolveDir:root,contents:`import{AtlasStore}from${JSON.stringify(join(root,'src/main/store.ts'))};
const store=new AtlasStore(${JSON.stringify(db)});store.saveSettings({...store.getSettings(),basemap:'neutral',terrainEnabled:false,labelsOverlay:false,buildings3d:false,layersEnabled:[],zoneLookupEnabled:false});store.close();`},bundle:true,platform:'node',format:'cjs',target:'node24',outfile:seed,logLevel:'silent'});
execFileSync(process.execPath,[seed],{cwd:root,stdio:'pipe'});
await writeFile(bootstrap, `
const { app } = require('electron');
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('Offline before QA forbids provider traffic'); };
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', ({ message }) => {
    if (/frame-src|frame-ancestors|framing .*violates/i.test(message ?? '')) console.log('VISIT_BEFORE_FRAME_POLICY ' + message);
  });
  contents.on('did-fail-load', (_event, code, message, url, isMain) => {
    if (!isMain) console.log('VISIT_BEFORE_SUBFRAME_FAILURE ' + JSON.stringify({ code, message, url }));
  });
  contents.debugger.attach('1.3');
  void contents.debugger.sendCommand('Log.enable');
  contents.debugger.on('message', (_event, method, params) => {
    if (method === 'Log.entryAdded' && /frame|policy/i.test(params.entry.text)) console.log('VISIT_BEFORE_BROWSER_LOG ' + params.entry.text);
  });
  const timer = setInterval(async () => {
    if (contents.isDestroyed()) { clearInterval(timer); return; }
    try {
      const ready = await contents.executeJavaScript("document.querySelector('iframe.briefing-preview')?.srcdoc.includes('Atlas Watch location briefing')");
      if (!ready) return;
      clearInterval(timer);
      const snap = await contents.debugger.sendCommand('DOMSnapshot.captureSnapshot', { computedStyles: [] });
      const frames = snap.documents.map(doc => ({
        url: snap.strings[doc.documentURL],
        headingElements: doc.nodes.nodeName.filter(i => snap.strings[i] === 'H1').length,
        briefingHeadingPainted: doc.layout.text.some(i => i >= 0 && snap.strings[i].includes('Atlas Watch location briefing')),
        textBoxes: doc.textBoxes.layoutIndex.length,
      }));
      console.log('VISIT_BEFORE_RENDERED_FRAMES ' + JSON.stringify(frames));
    } catch (error) { clearInterval(timer); console.log('VISIT_BEFORE_FRAME_OBSERVATION ' + String(error)); }
  }, 800);
  contents.once('destroyed', () => clearInterval(timer));
});
app.on('before-quit', () => console.log('VISIT_BEFORE_PROVIDER_FETCHES ' + calls));
require(${JSON.stringify(join(root, 'dist/main/main.cjs'))});`);
const child=spawn(require('electron'),[bootstrap],{cwd:root,env:{...process.env,ATLAS_WATCH_DB:db,ATLAS_WATCH_USER_DATA:join(session,'profile'),ATLAS_WATCH_SIMULATE_OFFLINE:'1',ATLAS_WATCH_SMOKE:'1',ATLAS_WATCH_SMOKE_MS:'15000',ATLAS_WATCH_SMOKE_JS:join(root,'scripts/qa-visit-before.js'),ATLAS_WATCH_SMOKE_SHOT:join(output,'audit-visit-before.png')},stdio:['ignore','pipe','pipe']});
let log='';const collect=chunk=>{log+=chunk;if(log.includes('SMOKE_SCRIPT_ERROR'))child.kill();};child.stdout.on('data',collect);child.stderr.on('data',collect);
const timer=setTimeout(()=>child.kill(),35000);let code;try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}finally{clearTimeout(timer);}
await writeFile(join(root,'docs/visit-before-audit.log'),log);console.log(log.split(/\r?\n/).filter(line=>/SMOKE_|VISIT_BEFORE/.test(line)).join('\n'));
assert.equal(code,0);assert(!log.includes('SMOKE_SCRIPT_ERROR'));const result=JSON.parse(/^SMOKE_SCRIPT (.+)$/m.exec(log)?.[1]??'null');assert.equal(result?.result,'PASS');assert.deepEqual(result?.rendererErrors,[]);assert(log.includes('VISIT_BEFORE_PROVIDER_FETCHES 0'));
console.log(JSON.stringify({result:'PASS',providerTraffic:0,session,output}));
