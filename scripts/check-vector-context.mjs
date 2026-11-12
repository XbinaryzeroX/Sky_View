// Real Chromium pixel regression for context fills over marine protected areas.
// Run: node scripts/check-vector-context.mjs (uses the existing Electron/esbuild dependencies).
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'atlas-vector-pixels-'));
await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { drawTile } from './src/renderer/map/vectorTiles.ts';
      const point = (x, y) => ({x, y});
      const ring = (x0,y0,x1,y1) => [point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1),point(x0,y0)];
      const polygon = (properties, rings) => ({type:3,properties,loadGeometry:()=>rings});
      const layer = features => ({extent:4096,length:features.length,feature:i=>features[i]});
      // Synthetic fixtures only: a park crosses ocean, with an island hole and a road over the water.
      const vt = {layers:{
        park:layer([polygon({class:'conservation',name:'Marine protected area'},[ring(0,0,4096,4096)])]),
        water:layer([polygon({class:'ocean'},[ring(0,0,2048,4096),ring(512,1536,1024,2560)])]),
        transportation:layer([{type:2,properties:{class:'primary'},loadGeometry:()=>[[point(0,1024),point(4096,1024)]]}])
      }};
      (async()=>{
        const bitmap = await drawTile(vt,'context',12,{ox:0,oy:0,scale:1});
        const canvas = new OffscreenCanvas(256,256);
        const ctx = canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bitmap,0,0); bitmap.close();
        const alpha = (x,y) => ctx.getImageData(x,y,1,1).data[3];
        const results = {
          oceanTransparent:alpha(16,128)===0,
          landContextPreserved:alpha(200,128)>0,
          islandHolePreserved:alpha(48,128)>0,
          roadOverWaterPreserved:Math.max(alpha(16,63),alpha(16,64),alpha(16,191),alpha(16,192))>0
        };
        window.__pixelResult={ok:Object.values(results).every(Boolean),results};
      })().catch(e=>window.__pixelResult={ok:false,error:String(e)});
    `,
  },
  bundle: true, format: 'iife', platform: 'browser', outfile: join(dir, 'pixels.js'), logLevel: 'silent',
});
await writeFile(join(dir, 'pixels.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'\"><script src="pixels.js" defer></script>');
await writeFile(join(dir, 'runner.cjs'), `
  const {app,BrowserWindow}=require('electron');
  app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
    await win.loadFile(${JSON.stringify(join(dir, 'pixels.html'))});
    const until=Date.now()+20000;
    let result;
    do {
      result=await win.webContents.executeJavaScript('window.__pixelResult ?? null');
      if(!result) await new Promise(r=>setTimeout(r,50));
    } while(!result && Date.now()<until);
    console.log('VECTOR_CONTEXT_PIXELS '+JSON.stringify(result));
    app.exit(result?.ok?0:1);
  }).catch(e=>{console.error(e);app.exit(1)});
`);
const require = createRequire(import.meta.url);
const child = spawn(require('electron'), [join(dir, 'runner.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', d => { output += d; });
child.stderr.on('data', d => { output += d; });
const timeout = setTimeout(() => child.kill(), 30000);
child.on('exit', code => {
  clearTimeout(timeout);
  const result = output.split(/\r?\n/).find(line => line.startsWith('VECTOR_CONTEXT_PIXELS '));
  console.log(result ?? output.slice(-2000));
  process.exitCode = code === 0 && result ? 0 : 1;
});
