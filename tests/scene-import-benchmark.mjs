// Compare the two import workflows on identical v1 inputs using real main-process handlers and fresh temporary databases.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'atlas-scene-timing-'));
const at = '2026-11-11T12:00:00.000Z';
const camera = { lat: -16.3, lon: 179.8, heightM: 500_000, heading: 0, pitch: -1.3 };
const scene = {
  format: 'atlas-watch-scene', version: 1, createdAt: at, basemap: 'neutral', terrainEnabled: false,
  layersEnabled: [], visualMode: 'normal', camera,
  annotations: Array.from({ length: 500 }, (_, i) => ({ kind: 'pin', id: 'pin-' + i,
    name: '測定点 ' + i, color: '#ffd166', points: [[-179 + i % 359, -80 + i % 160]], visible: true, createdAt: at })),
  views: Array.from({ length: 50 }, (_, i) => ({ id: 'view-' + i, name: 'View ' + i, camera,
    basemap: 'neutral', layersEnabled: [], createdAt: at })),
};
const offline = () => { throw new Error('Unexpected provider call in local scene benchmark'); };

try {
  const bundle = join(temp, 'main-handlers.cjs');
  buildSync({ stdin: { contents: "export {AtlasStore} from './src/main/store'; export {AppCore} from './src/main/core'; export {createHandlers,dispatch} from './src/main/handlers'; export {IPC} from './src/shared/ipc';", resolveDir: root },
    outfile: bundle, platform: 'node', format: 'cjs', bundle: true, logLevel: 'silent' });
  const { AppCore, AtlasStore, createHandlers, dispatch, IPC } = createRequire(import.meta.url)(bundle);
  async function measure(route, round) {
    const store = new AtlasStore(join(temp, route + round + '.sqlite'));
    try {
      const core = new AppCore({ store, now: () => new Date(at),
        alertSource: { name: 'unused', fetchActiveAlerts: offline, fetchPointZones: offline },
        quakeSource: { name: 'unused', fetchRecent: offline } });
      core.init();
      const handlers = createHandlers(core, store, offline, {});
      const start = performance.now();
      let annotations, views;
      if (route === 'perRow') {
        await dispatch(handlers, IPC.settingsUpdate, [{ basemap: scene.basemap, terrainEnabled: false, layersEnabled: [], visualMode: scene.visualMode }]);
        for (const annotation of scene.annotations) await dispatch(handlers, IPC.annotationsPut, [annotation]);
        for (const view of scene.views) await dispatch(handlers, IPC.viewsPut, [view]);
        annotations = await dispatch(handlers, IPC.annotationsList, []);
        views = await dispatch(handlers, IPC.viewsList, []);
      } else {
        ({ annotations, views } = await dispatch(handlers, IPC.sceneApply, [scene]));
      }
      const elapsed = performance.now() - start;
      assert.equal(annotations.length, scene.annotations.length);
      assert.equal(views.length, scene.views.length);
      assert.equal(core.settings.basemap, scene.basemap);
      return Math.round(elapsed * 100) / 100;
    } finally { store.close(); }
  }
  const samples = { perRow: [], atomic: [] };
  for (let round = 0; round < 6; round++) {
    for (const route of round % 2 === 0 ? ['perRow', 'atomic'] : ['atomic', 'perRow']) {
      const ms = await measure(route, round);
      if (round) samples[route].push(ms);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ node: process.version, date: new Date().toISOString(),
    scope: 'Local dispatch, validation and SQLite only. Both routes use current handlers. Excludes native file picker, Electron transport, rendering and provider traffic.',
    fixture: { pins: 500, views: 50, sceneVersion: 1, bytes: Buffer.byteLength(JSON.stringify(scene)) },
    dispatches: { perRow: 553, atomic: 1 }, samplesMs: samples,
    medianMs: { perRow: median(samples.perRow), atomic: median(samples.atomic) } }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
