// Real Cesium + Chromium regression for cockpit cleanup across scene morphs.
// No live provider is used. The clearly named fixture lives separately under tests/fixtures/.
// Run: node scripts/check-tracking-camera.mjs (existing Electron, Cesium and esbuild dependencies only).
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Optional test-of-the-test: bypass only the cleanup guard in a temporary esbuild input, never the source file.
const negativeControl = process.argv.includes('--negative-control');
const dir = await mkdtemp(join(tmpdir(), 'atlas-camera-engine-'));
const cesiumRoot = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const fixture = JSON.parse(await readFile(join(root, 'tests', 'fixtures', 'tracking-camera-engine.json'), 'utf8'));
await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { Cartesian3, CesiumWidget, Color, EllipsoidTerrainProvider, Matrix4, PointPrimitiveCollection, SceneMode } from 'cesium';
      import { attachCockpit } from './src/renderer/map/trackingCamera.ts';
      window.CESIUM_BASE_URL = '/cesium/';
      const errors = [];
      window.addEventListener('error', e => errors.push('window: ' + e.message));
      window.addEventListener('unhandledrejection', e => errors.push('promise: ' + String(e.reason)));
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (test, label) => {
        const until = performance.now() + 8000;
        while (performance.now() < until) {
          const panel=document.querySelector('.cesium-widget-errorPanel');
          if(panel) throw new Error('Actual Cesium render loop stopped: '+panel.textContent);
          if (test()) return;
          if (errors.length) throw new Error(errors.join('; '));
          await delay(25);
        }
        throw new Error('Timed out: ' + label);
      };
      const assert = (value, description) => { if (!value) throw new Error(description); };
      (async () => {
        const widget = new CesiumWidget('view', {
          baseLayer:false, terrainProvider:new EllipsoidTerrainProvider(), skyBox:false, skyAtmosphere:false,
          requestRenderMode:false, shouldAnimate:false, showRenderLoopErrors:true,
        });
        const scene = widget.scene;
        scene.globe.showWaterEffect = false;
        scene.renderError.addEventListener((_scene, error) => errors.push('render: ' + String(error)));
        let frames = 0;
        scene.postRender.addEventListener(() => frames++);
        const record = { ...${JSON.stringify(fixture)}, observedAt:new Date().toISOString() };
        const position = Cartesian3.fromDegrees(record.lon, record.lat, record.altM);
        const points = scene.primitives.add(new PointPrimitiveCollection());
        const target = points.add({position,color:Color.YELLOW,pixelSize:10});
        widget.camera.setView({ destination:Cartesian3.fromDegrees(-75,40,100000) });
        await waitFor(() => frames >= 3, 'initial actual Cesium render');
        const controller = scene.screenSpaceCameraController;
        const original = {inputs:controller.enableInputs,minimum:controller.minimumZoomDistance,tilt:controller.maximumTiltAngle};
        const inputsRestored = () => controller.enableInputs === original.inputs && controller.minimumZoomDistance === original.minimum && controller.maximumTiltAngle === original.tilt;
        const hidden = [];
        const unavailable = [];
        const source = {layer:'aircraft',record:()=>record,position:()=>position,hideOwnVehicle:value=>{hidden.push(value);target.show=!value;}};
        const dispose = attachCockpit(widget,source,reason=>unavailable.push(reason));
        assert(controller.enableInputs===false && target.show===false,'Cockpit must disable inputs and hide its real target primitive');
        assert(Cartesian3.distance(widget.camera.positionWC,position)<1,'Actual camera must move to the 10 km fixture');
        await delay(150);

        // Real Cesium throws DeveloperError if lookAtTransform is called in this mode. Do not mock that API.
        let actualMorphGuard=false;
        // Scene.mode changes immediately, while Camera's internal mode updates during the render.
        // Probe after a real morph frame, at the engine stage that the old preRender cleanup hit.
        const removeGuard=scene.postRender.addEventListener(()=>{
          if(actualMorphGuard || scene.mode!==SceneMode.MORPHING) return;
          try { widget.camera.lookAtTransform(Matrix4.IDENTITY); }
          catch(error) { actualMorphGuard=/morph/i.test(String(error)); }
        });
        scene.morphTo2D(1);
        assert(scene.mode===SceneMode.MORPHING,'Actual scene must enter MORPHING');
        const hiddenBeforeRefusal=hidden.length;
        const refused=[];
        const refusedDispose=attachCockpit(widget,source,reason=>refused.push(reason));
        refusedDispose();
        assert(refused.length===1 && hidden.length===hiddenBeforeRefusal,'Starting during a real morph must refuse without hiding the target');
        await waitFor(()=>scene.mode===SceneMode.SCENE2D,'real 3D to 2D morph');
        removeGuard();
        assert(actualMorphGuard,'This actual Cesium build must enforce the lookAtTransform MORPHING guard');
        assert(inputsRestored() && target.show===true,'Morph exit must restore all input limits and target visibility');
        assert(unavailable.length===1 && /3D/.test(unavailable[0]),'Active cockpit must report one 3D-mode exit');
        const hiddenAfterMorph=hidden.length;
        dispose(); dispose();
        assert(hidden.length===hiddenAfterMorph,'Disposed morph session must not run cleanup again');

        scene.morphTo3D(0.4);
        assert(scene.mode===SceneMode.MORPHING,'Actual scene must morph back to 3D');
        const refusedBack=[];
        attachCockpit(widget,source,reason=>refusedBack.push(reason))();
        assert(refusedBack.length===1,'Starting during the reverse morph must also refuse');
        await waitFor(()=>scene.mode===SceneMode.SCENE3D,'real 2D to 3D morph');
        assert(inputsRestored() && target.show===true,'Reverse morph must keep cleanup state intact');

        const originalCamera={position:Cartesian3.clone(widget.camera.positionWC),direction:Cartesian3.clone(widget.camera.directionWC),up:Cartesian3.clone(widget.camera.upWC)};
        record.observedAt=new Date().toISOString();
        const afterMorph=[];
        const stop=attachCockpit(widget,source,reason=>afterMorph.push(reason));
        assert(!controller.enableInputs && !target.show,'Cockpit must attach again after a completed morph');
        await delay(150);
        stop(); stop();
        assert(inputsRestored() && target.show && afterMorph.length===0,'Normal explicit disposal must restore inputs and target');
        assert(Cartesian3.distance(widget.camera.positionWC,originalCamera.position)<1 && Cartesian3.distance(widget.camera.directionWC,originalCamera.direction)<1e-6 && Cartesian3.distance(widget.camera.upWC,originalCamera.up)<1e-6,'Normal disposal must restore the actual 3D camera pose');

        const stale=[];
        record.observedAt=new Date().toISOString();
        const stopStale=attachCockpit(widget,source,reason=>stale.push(reason));
        record.observedAt=new Date(Date.now()-61000).toISOString();
        await waitFor(()=>stale.length>0,'stale-data exit from actual render callback');
        assert(/stale/.test(stale[0]) && inputsRestored() && target.show,'Stale reports must exit with controls/visibility restored');
        stopStale();
        const frameAtEnd=frames;
        await waitFor(()=>frames>=frameAtEnd+3,'render loop remains alive after all cleanup');
        assert(errors.length===0,'Real engine must not throw render or window errors');
        const result={ok:true,fixtureOnly:true,network:'loopback assets only',frames,results:{actualCesiumWidget:true,actualMorphGuardEnforced:actualMorphGuard,actualMorphTo2D:true,actualMorphBackTo3D:true,morphStartRefused:true,inputsRestored:inputsRestored(),targetVisibilityRestored:target.show,cameraPoseRestored:true,staleExit:true,renderLoopAlive:true},errors};
        widget.destroy();
        window.__trackingCameraResult=result;
      })().catch(error=>window.__trackingCameraResult={ok:false,fixtureOnly:true,error:String(error),errors});
    `,
  },
  bundle: true, format: 'iife', platform: 'browser', outfile: join(dir, 'case.js'), logLevel: 'silent',
  plugins: negativeControl ? [{
    name:'temporary-old-morph-defect',
    setup(build) {
      build.onLoad({filter:/renderer[\\/]map[\\/]trackingCamera\.ts$/},async ({path})=>{
        const source=await readFile(path,'utf8');
        const guard='if (scene.mode === SceneMode.SCENE3D) {';
        if(source.split(guard).length!==2) throw new Error('Negative control could not identify exactly one cleanup guard');
        return {contents:source.replace(guard,'if (true) {'),loader:'ts'};
      });
    },
  }] : [],
});
await writeFile(join(dir, 'case.html'), `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:"><style>html,body,#view{width:100%;height:100%;margin:0;overflow:hidden}</style><div id="view"></div><script src="case.js" defer></script>`);

const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg', '.xml':'application/xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const base = pathname.startsWith('/cesium/') ? cesiumRoot : dir;
    const relative = pathname.startsWith('/cesium/') ? pathname.slice('/cesium/'.length) : pathname === '/' ? 'case.html' : pathname.slice(1);
    const target = resolve(base, relative);
    if (!target.startsWith(base + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, {'Content-Type':mime[extname(target)] ?? 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(dir,'runner.cjs'), `
  const {app,BrowserWindow,session}=require('electron');
  app.setPath('userData',${JSON.stringify(join(dir,'profile'))});
  app.whenReady().then(async()=>{
    const blocked=[];
    const origin=${JSON.stringify(origin)};
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
      const allowed=details.url.startsWith(origin+'/') || /^(blob:|data:|about:)/.test(details.url);
      if(!allowed) blocked.push(details.url);
      callback({cancel:!allowed});
    });
    const win=new BrowserWindow({width:800,height:600,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    await win.loadURL(origin+'/');
    const until=Date.now()+35000;
    let result;
    do {result=await win.webContents.executeJavaScript('window.__trackingCameraResult ?? null');if(!result)await new Promise(r=>setTimeout(r,50));}while(!result&&Date.now()<until);
    result={...(result??{ok:false,error:'Harness timed out'}),blockedRequests:blocked};
    if(blocked.length)result.ok=false;
    console.log('TRACKING_CAMERA_ENGINE '+JSON.stringify(result));
    app.exit(result.ok?0:1);
  }).catch(error=>{console.error(error);app.exit(1)});
`);
const require=createRequire(import.meta.url);
const child=spawn(require('electron'),[join(dir,'runner.cjs')],{stdio:['ignore','pipe','pipe']});
let output='';
child.stdout.on('data',data=>output+=data);
child.stderr.on('data',data=>output+=data);
const timeout=setTimeout(()=>child.kill(),45000);
const code=await new Promise(resolve=>child.on('exit',resolve));
clearTimeout(timeout);
await new Promise(resolve=>server.close(resolve));
const line=output.split(/\r?\n/).find(line=>line.startsWith('TRACKING_CAMERA_ENGINE '));
if(negativeControl && line) {
  const result=JSON.parse(line.slice('TRACKING_CAMERA_ENGINE '.length));
  const detected=result.ok===false && /lookAtTransform[^]*morph/i.test(JSON.stringify(result));
  console.log('TRACKING_CAMERA_NEGATIVE_CONTROL '+JSON.stringify({ok:detected,fixtureOnly:true,temporaryGuardBypass:true,expectedDefectDetected:detected,errors:result.errors,error:result.error}));
  process.exitCode=detected?0:1;
} else {
  console.log(line??output.slice(-3000));
  process.exitCode=code===0&&line?0:1;
}
