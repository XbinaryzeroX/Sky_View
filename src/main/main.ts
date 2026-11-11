// Electron main process entry point.

import { MarketService } from './markets';
import { LemmyService } from './lemmy';
import { app, BrowserWindow, contentTracing, dialog, ipcMain, Menu, nativeTheme, safeStorage, screen, session } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBriefing } from '../shared/briefing';
import { IPC, ipcArgSchemas, type InvokeChannel } from '../shared/ipc';
import { AppCore } from './core';
import { FeedHttpError, fetchJson as realFetchJson, fetchText as realFetchText, type FetchJson, type FetchText } from './feeds/http';
import { AisStreamClient } from './layers/aisstream';
import { LayerManager } from './layers/manager';
import { makeAisTester, ProviderService } from './providerService';
import { SecretStore, redactSecrets } from './secrets';
import type { LayerId } from '../shared/layers';
import { buildUserAgent, NwsAlertSource, UsgsQuakeSource } from './feeds/sources';
import { createHandlers, type PlatformServices } from './handlers';
import {
  APP_ORIGIN,
  DEV_SERVER_URL,
  hardenWebContents,
  lockDownSession,
  getNetStats,
  openExternalSafely,
  registerAppScheme,
  rendererEntryUrl,
  serveAppProtocol,
  setRendererRemoteOptions,
} from './security';
import { AtlasStore } from './store';
import { loadMainGeoid } from './geoid';

const log = (m: string) => console.log(redactSecrets(m, []));

registerAppScheme();
app.enableSandbox();
// Development/test only: isolated profile so automated runs never collide with a user's running instance.
if (!app.isPackaged && process.env.ATLAS_WATCH_USER_DATA) app.setPath('userData', process.env.ATLAS_WATCH_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let core: AppCore | null = null;
let store: AtlasStore | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let layers: LayerManager | null = null;
const pendingLayerEmits = new Set<LayerId>();
let layerEmitTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleLayerEmit(id: LayerId): void {
  pendingLayerEmits.add(id);
  if (layerEmitTimer) return;
  layerEmitTimer = setTimeout(() => {
    layerEmitTimer = null;
    if (!layers || !mainWindow || mainWindow.isDestroyed()) return;
    for (const lid of pendingLayerEmits) mainWindow.webContents.send(IPC.layersUpdate, layers.snapshot(lid));
    pendingLayerEmits.clear();
  }, 150);
}

async function openTextFile(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const res = mainWindow ? await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters }) : await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (res.canceled || !res.filePaths[0]) return null;
  const st = await (await import('node:fs/promises')).stat(res.filePaths[0]);
  if (st.size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB.');
  return readFile(res.filePaths[0], 'utf8');
}

function scheduleStateEmit(): void {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    if (core && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.stateChanged, core.snapshot());
    }
  }, 200);
}

async function savePdfFromHtml(defaultName: string, html: string): Promise<string | null> {
  const parent = mainWindow ?? undefined;
  const res = parent
    ? await dialog.showSaveDialog(parent, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, await renderPdf(html));
  return res.filePath;
}

/** Renders HTML to PDF in a hidden, script-disabled, network-blocked window. */
async function renderPdf(html: string): Promise<Buffer> {
  const printSession = session.fromPartition('briefing-print');
  printSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith('data:') }));
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, partition: 'briefing-print' },
  });
  try {
    await printWin.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
    return await printWin.webContents.printToPDF({ pageSize: 'Letter', printBackground: true });
  } finally {
    printWin.destroy();
  }
}

async function saveTextFile(defaultName: string, filters: { name: string; extensions: string[] }[], content: string): Promise<string | null> {
  const res = mainWindow ? await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName, filters }) : await dialog.showSaveDialog({ defaultPath: defaultName, filters });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, content, 'utf8');
  return res.filePath;
}

function createWindow(): void {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Atlas Watch',
    backgroundColor: '#0d141c',
    // The app's own top bar is the title bar: no separate OS strip or menu row. Windows draws its
    // minimize / maximize / close buttons over the right end of the top bar in matching colors.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111a24', symbolColor: '#dce4ec', height: 46 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: app.isPackaged || process.env.ATLAS_WATCH_SMOKE !== '1',
    },
  });
  // Optional: open on a specific monitor (e.g. ATLAS_WATCH_WINDOW_DISPLAY=secondary or a monitor name).
  const want = process.env.ATLAS_WATCH_WINDOW_DISPLAY;
  if (want) {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const target = want === 'secondary' ? displays.find((d) => d.id !== primary.id) : displays.find((d) => d.label === want);
    if (target) mainWindow.setBounds({ ...target.workArea });
  }  hardenWebContents(mainWindow.webContents);
  // When a target monitor is requested (automated runs), show without taking keyboard focus.
  mainWindow.once('ready-to-show', () => (process.env.ATLAS_WATCH_WINDOW_DISPLAY ? mainWindow?.showInactive() : mainWindow?.show()));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(rendererEntryUrl());
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as Electron.MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// GPU use: prefer the discrete/high-performance GPU on dual-GPU machines, rasterize canvas and page
// content on the GPU, and let decoded images and video go to the GPU without extra copies. Video is
// hardware-decoded. Measured 2026-11-09 on Caltrans camera streams: playback quality depended on the
// publisher's stream at that moment (GPU 21 s and software 0 s of 60 s in back-to-back runs), not on
// the decoder, so the camera player handles damaged frames by reconnecting with backoff.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

app.whenReady().then(async () => {
  const rendererRoot = join(__dirname, '../renderer');
  serveAppProtocol(rendererRoot);
  loadMainGeoid(rendererRoot, log);
  lockDownSession(log);
  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));

  // Development-only test hooks (ignored in packaged builds).
  const devHooks = !app.isPackaged;
  const fetchJson: FetchJson =
    devHooks && process.env.ATLAS_WATCH_SIMULATE_OFFLINE === '1'
      ? async () => {
          throw new FeedHttpError('Network error: simulated offline (development test)', null, null, 'network');
        }
      : realFetchJson;
  const fetchText: FetchText =
    devHooks && process.env.ATLAS_WATCH_SIMULATE_OFFLINE === '1'
      ? async () => {
          throw new FeedHttpError('Network error: simulated offline (development test)', null, null, 'network');
        }
      : realFetchText;
  const dbPath = process.env.ATLAS_WATCH_DB ?? join(app.getPath('userData'), 'atlas-watch.sqlite');
  store = new AtlasStore(dbPath);
  const version = app.getVersion();
  const ua = () => buildUserAgent(version, core?.settings.nwsContact ?? '');
  core = new AppCore({
    store,
    alertSource: new NwsAlertSource(fetchJson, ua),
    quakeSource: new UsgsQuakeSource(fetchJson, ua),
    onChange: scheduleStateEmit,
    log,
  });
  core.init();

  const secrets = new SecretStore(store, safeStorage);
  const providers = new ProviderService(store, secrets, fetchJson, fetchText, ua, makeAisTester());
  const markets = new MarketService(secrets, () => core!.settings, store, providers.credentials);
  providers.marketService = markets;
  const lemmy = new LemmyService(secrets, () => core!.settings);
  const remoteOptions = () => ({ google3d: providers.credentials.available('google3d'), esri: secrets.has('esri-imagery'), mapbox: secrets.has('mapbox'), eox: providers.ackGiven('eox') });
  setRendererRemoteOptions(remoteOptions());
  const ais = new AisStreamClient(() => secrets.get('aisstream'), () => scheduleLayerEmit('vessels'));
  layers = new LayerManager({
    store,
    fetchJson,
    fetchText,
    getSettings: () => core!.settings,
    userAgent: ua,
    localReceiverUrl: () => providers.localReceiverUrl(),
    openskyClient: () => secrets.get('opensky'),
    cameraKey: (id) => (secrets.has(id) ? secrets.get(id) : null),
    ais,
    aisConfigured: () => secrets.has('aisstream'),
    emit: scheduleLayerEmit,
    log,
  });

  const platform: PlatformServices = {
    saveTextFile,
    savePdfFromHtml,
    openExternal: openExternalSafely,
    getNetStats,
    openTextFile,
    setKiosk: (on) => {
      mainWindow?.setFullScreen(on);
      return on;
    },
    captureScreenshot: async () => {
      if (!mainWindow) return null;
      const img = await mainWindow.webContents.capturePage();
      const res = await dialog.showSaveDialog(mainWindow, { defaultPath: `atlas-watch-view-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (res.canceled || !res.filePath) return null;
      await writeFile(res.filePath, img.toPNG());
      return res.filePath;
    },
    appVersion: version,
  };
  const handlers = createHandlers(core, store, fetchJson, platform, { layers, providers, markets, lemmy, userAgent: ua });
  const baseSetCredential = handlers[IPC.providersSetCredential];
  handlers[IPC.providersSetCredential] = async (args) => {
    const before = JSON.stringify(remoteOptions());
    const r = await baseSetCredential(args);
    const after = remoteOptions();
    setRendererRemoteOptions(after);
    // The page's Content-Security-Policy is fixed when it loads, so a newly allowed (or removed)
    // imagery host only takes effect after a reload. Settings and data live in the main process.
    if (JSON.stringify(after) !== before) setTimeout(() => mainWindow?.webContents.reload(), 400);
    return r;
  };
  for (const channel of Object.keys(ipcArgSchemas) as InvokeChannel[]) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      // Only accept requests from our own top-level frame.
      const frameUrl = event.senderFrame?.url ?? '';
      const trusted = frameUrl.startsWith(`${APP_ORIGIN}/`) || (DEV_SERVER_URL !== '' && frameUrl.startsWith(DEV_SERVER_URL));
      if (!trusted || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender');
      try {
        return await handlers[channel](args);
      } catch (error) {
        throw new Error(redactSecrets((error as Error).message, []));
      }
    });
  }

  buildMenu();
  createWindow();
  core.start();
  layers.start();

  if (devHooks && process.env.ATLAS_WATCH_SMOKE_VIEWS) {
    // Map validation: visit each view, wait for tiles to finish loading, capture and log diagnostics.
    const views = JSON.parse((await readFile(process.env.ATLAS_WATCH_SMOKE_VIEWS, 'utf8').catch(() => '[]')) || '[]') as { name: string; lat: number; lon: number; h: number; pitch?: number; wait?: number; js?: string }[];
    const outDir = process.env.ATLAS_WATCH_SMOKE_OUT ?? '.';
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents;
        // Optional Chromium trace of the whole view run (development only).
        // Optional V8 CPU profile of the renderer (development only), aggregated by function self time.
        const cpuProfile = process.env.ATLAS_WATCH_SMOKE_CPUPROFILE;
        if (cpuProfile) {
          wc.debugger.attach('1.3');
          await wc.debugger.sendCommand('Profiler.enable');
          await wc.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 1000 });
          await wc.debugger.sendCommand('Profiler.start');
        }
        if (process.env.ATLAS_WATCH_SMOKE_TRACE) await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'v8.execute', 'disabled-by-default-devtools.timeline', 'gpu', 'blink'] });
        for (const v of views) {
          await wc.executeJavaScript(`window.__atlasDebug.setView(${v.lat}, ${v.lon}, ${v.h}, ${v.pitch ?? -90})`);
          let settled = 0;
          const t0 = Date.now();
          let diag: Record<string, unknown> | null = null;
          while (Date.now() - t0 < 60000) {
            await new Promise((r) => setTimeout(r, 700));
            diag = await wc.executeJavaScript('JSON.parse(JSON.stringify(window.__atlasDebug.diag()))');
            const terr = diag?.terrain as { inFlight?: number } | null;
            const busy = Number(diag?.tilesPending ?? 1) > 0 || Number(terr?.inFlight ?? 0) > 0;
            settled = busy ? 0 : settled + 1;
            if (settled >= 3) break;
          }
          if (v.wait) await new Promise((r) => setTimeout(r, v.wait));
          if (v.js) log(`SMOKE_VIEWJS ${v.name} ${JSON.stringify(await wc.executeJavaScript(v.js, true))}`);
          await new Promise((r) => setTimeout(r, 800));
          wc.invalidate();
          const img = await wc.capturePage();
          await writeFile(join(outDir, `${v.name}.png`), img.toPNG());
          const d = diag ?? {};
          log(`SMOKE_VIEW ${v.name} settledMs=${Date.now() - t0} ${JSON.stringify({ h: d.cameraHeightM, level: d.maxRenderedLevel, maxHere: d.imageryMaxLevelHere, atLimit: d.imageryAtLimit, pending: d.tilesPending, errors: d.imageryErrors, lastErr: d.lastImageryError, renderErrors: d.renderErrors, lastRenderError: d.lastRenderError, terrain: d.terrain ? { loaded: (d.terrain as Record<string, unknown>).loaded, failed: (d.terrain as Record<string, unknown>).failed, deepest: (d.terrain as Record<string, unknown>).deepestLevelRequested } : null })}`);
        }
        log(`SMOKE_NET ${JSON.stringify(getNetStats())}`);
        if (cpuProfile) {
          const { profile } = (await wc.debugger.sendCommand('Profiler.stop')) as { profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] } };
          await writeFile(cpuProfile, JSON.stringify(profile));
          const byId = new Map(profile.nodes.map((n) => [n.id, n]));
          const self = new Map<string, number>();
          profile.samples.forEach((id, i) => {
            const n = byId.get(id);
            if (!n) return;
            const key = `${n.callFrame.functionName || '(anonymous)'} @${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
            self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
          });
          log(`SMOKE_CPUPROFILE ${JSON.stringify([...self].sort((x, y) => y[1] - x[1]).slice(0, 30).map(([k, v]) => [k, Math.round(v)]))}`);
          wc.debugger.detach();
        }
        if (process.env.ATLAS_WATCH_SMOKE_TRACE) log(`SMOKE_TRACE ${await contentTracing.stopRecording(process.env.ATLAS_WATCH_SMOKE_TRACE)}`);
        // Performance: CPU seconds per process type since launch, GPU feature status, renderer main-thread blocking.
        const cpu: Record<string, number> = {};
        for (const m of app.getAppMetrics()) cpu[m.type] = Math.round(((cpu[m.type] ?? 0) + (m.cpu.cumulativeCPUUsage ?? 0)) * 10) / 10;
        const lt = await wc.executeJavaScript('JSON.stringify(window.__atlasLongTasks ?? null)').catch(() => 'null');
        log(`SMOKE_PROF ${await wc.executeJavaScript('JSON.stringify(window.__atlasProf ?? null)').catch(() => 'null')}`);
        const gpu = app.getGPUFeatureStatus() as unknown as Record<string, string>;
        log(`SMOKE_PERF ${JSON.stringify({ cpuSeconds: cpu, longTasks: JSON.parse(lt), gpu: { gpu_compositing: gpu.gpu_compositing, rasterization: gpu.rasterization, video_decode: gpu.video_decode, webgl2: gpu.webgl2, canvas_oop: gpu.canvas_oop_rasterization } })}`);
        app.quit();
      }, 4000);
    });
  }

  if (devHooks && process.env.ATLAS_WATCH_SMOKE === '1') {
    if (process.env.ATLAS_WATCH_SMOKE_JS) {
      const scriptPath = process.env.ATLAS_WATCH_SMOKE_JS;
      mainWindow?.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const out = await mainWindow?.webContents.executeJavaScript(await readFile(scriptPath, 'utf8'));
            log(`SMOKE_SCRIPT ${JSON.stringify(out ?? null)}`);
            if (process.env.ATLAS_WATCH_SMOKE_SHOT && mainWindow) {
              mainWindow.showInactive();
              mainWindow.webContents.invalidate();
              await new Promise((r) => setTimeout(r, 1500));
              const img = await mainWindow.webContents.capturePage();
              await writeFile(process.env.ATLAS_WATCH_SMOKE_SHOT.replace(/.png$/, '-scenario.png'), img.toPNG());
            }
          } catch (e) {
            log(`SMOKE_SCRIPT_ERROR ${(e as Error).message}`);
          }
        }, 3000);
      });
    }
    // Automated smoke test: report renderer status and exit.
    setTimeout(async () => {
      try {
        const wc = mainWindow?.webContents;
        const info = wc ? await wc.executeJavaScript('JSON.stringify(window.__atlasSmoke ?? null)') : 'null';
        log(`SMOKE_RESULT ${info}`);
        if (process.env.ATLAS_WATCH_SMOKE_BRIEFING && core) {
          const ids = core.locations.map((l) => l.id);
          const b = buildBriefing(core.snapshot(), { locationIds: ids, now: new Date(), appVersion: version });
          await writeFile(`${process.env.ATLAS_WATCH_SMOKE_BRIEFING}.html`, b.html, 'utf8');
          await writeFile(`${process.env.ATLAS_WATCH_SMOKE_BRIEFING}.pdf`, await renderPdf(b.html));
          log(`SMOKE_BRIEFING refs=${b.references.length} locations=${b.locationCount}`);
        }
        log(`SMOKE_FEEDS ${JSON.stringify({ nws: core?.feeds.nws.state, nwsCount: core?.feeds.nws.recordCount, usgs: core?.feeds.usgs.state, usgsCount: core?.feeds.usgs.recordCount, nwsErr: core?.feeds.nws.error, usgsErr: core?.feeds.usgs.error })}`);
        if (process.env.ATLAS_WATCH_SMOKE_SHOT && wc) {
          const img = await wc.capturePage();
          await writeFile(process.env.ATLAS_WATCH_SMOKE_SHOT, img.toPNG());
        }
      } finally {
        app.quit();
      }
    }, Number(process.env.ATLAS_WATCH_SMOKE_MS ?? 25000));
  }
});

app.on('window-all-closed', () => {
  layers?.stop();
  core?.stop();
  store?.close();
  app.quit();
});
