// Read-only, headless Cesium construction/reconciliation benchmark. No release or app profile is opened.
// Reproduce: node tests/nifc-render-benchmark.mjs [--source path-to-captured-WFIGS-GeoJSON]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { CustomDataSource } = require('cesium');
const rendererPath = 'src/renderer/map/layerRender.ts';
const current = await readFile(join(root, rendererPath), 'utf8');
const commit = 'a22dcb09ea6144d4899a373ab25c4f70931cd129';
const prior = execFileSync('git', ['show', commit + ':' + rendererPath], { cwd: root, encoding: 'utf8' });
const hash = value => createHash('sha256').update(value).digest('hex');
assert(prior.includes("const ring = polys[0][0]"));
assert(prior.includes("if (existing && id !== 'satellites' && !r.geometry)"));
assert(current.includes("if (id === 'firePerimeters')"));
assert(current.includes('previous.geometry === record.geometry'));
async function moduleFrom(source, resolveDir) {
  const result = await build({ stdin: { contents: source, loader: 'ts', resolveDir }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} }; new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require); return module.exports;
}
const Old = (await moduleFrom(prior, join(root, 'src/renderer/map'))).LayerRenderer;
const Current = (await moduleFrom(current, join(root, 'src/renderer/map'))).LayerRenderer;
const { normalizeArcgisPolygons } = await moduleFrom(await readFile(join(root, 'src/shared/layerNormalize.ts'), 'utf8'), join(root, 'src/shared'));
const opts = { selectedLayer: null, selectedId: null, trackedId: null };
function harness(Renderer) {
  const renderer = Object.create(Renderer.prototype), source = new CustomDataSource('headless-perimeter-benchmark');
  Object.assign(renderer, {
    widget: { scene: { requestRender() {} } }, records: new Map(), sources: new Map([['firePerimeters', source]]),
    entities: new Map([['firePerimeters', new Map()]]), perimeterRenderCache: new Map(), bulk: new Map(),
    lastType: new Map(), labelModes: { aircraft: 'selected', vessel: 'selected' }, modelOpts: { enabled: false, budget: 0 },
  });
  return { renderer, source, dispose() { source.entities.removeAll(); renderer.entities.clear(); renderer.records.clear(); renderer.perimeterRenderCache.clear(); } };
}
const synthetic = [{ id: 'synthetic-two-parts-hole', label: 'Synthetic multipart perimeter', lat: 39.5, lon: -120.5,
  altM: null, heading: null, speedKts: null, category: 'Wildfire perimeter', observedAt: '2026-11-11T12:00:00.000Z',
  source: 'Explicit performance fixture', sourceUrl: null, props: {}, geometry: { type: 'MultiPolygon', coordinates: [
    [
      [[-121, 39], [-120, 39], [-120, 40], [-121, 40], [-121, 39]],
      [[-120.8, 39.2], [-120.8, 39.4], [-120.6, 39.4], [-120.6, 39.2], [-120.8, 39.2]],
    ],
    [[[-118, 37], [-117, 37], [-117, 38], [-118, 38], [-118, 37]]],
  ] } }];
const scenes = [{ name: 'synthetic-two-parts-and-one-hole', records: synthetic, coldIterations: 100, tickIterations: 1000 }];
const sourceIndex = process.argv.indexOf('--source');
if (sourceIndex !== -1) {
  assert(process.argv[sourceIndex + 1], '--source requires a local captured JSON path');
  const path = resolve(process.argv[sourceIndex + 1]), bytes = await readFile(path), body = JSON.parse(bytes.toString('utf8'));
  const normalized = normalizeArcgisPolygons(body, 'perimeter'); assert.equal(normalized.skipped, 0);
  scenes.push({ name: 'captured-publisher-geometry', records: normalized.records, coldIterations: 2, tickIterations: 20, capture: { path, sha256: hash(bytes), features: body.features.length } });
}
function measure(Renderer, scene) {
  let coldMs = 0;
  for (let i = 0; i < scene.coldIterations; i++) {
    const h = harness(Renderer); const start = performance.now(); h.renderer.update('firePerimeters', scene.records, opts); coldMs += performance.now() - start; h.dispose();
  }
  const h = harness(Renderer); h.renderer.update('firePerimeters', scene.records, opts);
  const initial = [...h.source.entities.values];
  const start = performance.now(); for (let i = 0; i < scene.tickIterations; i++) h.renderer.update('firePerimeters', scene.records, opts); const tickMs = performance.now() - start;
  const retainedEntities = initial.filter(entity => h.source.entities.getById(entity.id) === entity).length;
  const entities = h.source.entities.values.length; h.dispose();
  return { coldMsPerScene: coldMs / scene.coldIterations, coldUsPerRecord: coldMs * 1000 / scene.coldIterations / scene.records.length,
    unchangedUpdateMsPerScene: tickMs / scene.tickIterations, unchangedUpdateUsPerRecord: tickMs * 1000 / scene.tickIterations / scene.records.length,
    entities, retainedEntities };
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = { result: 'FAIL', measuredAt: new Date().toISOString(), node: process.version, cesium: require('cesium/package.json').version,
  machine: { platform: platform(), release: release(), arch: process.arch, cpu: cpus()[0]?.model },
  prior: { gitCommit: commit, path: rendererPath, sha256: hash(prior), qualification: 'Renderer from the pinned baseline commit. Its first-part perimeter construction and update branch match the source inspected before the repair. Both builds use the same Cesium installation.' },
  current: { path: rendererPath, sha256: hash(current), perimeterHelperSha256: hash(await readFile(join(root, 'src/renderer/map/perimeterGeometry.ts'))) },
  method: 'Same process, same Cesium version, same record/geometry objects, no selected record. Actual unmodified LayerRenderer.update methods, real CustomDataSource/EntityCollection/Entity/Cartesian geometry. Prototype-only minimal widget avoids constructor/WebGL/network; harness setup and disposal excluded. Three warm-up pairs then nine paired samples, alternated execution order. Cold samples use empty per-layer caches/collections; unchanged-update samples repeat identical objects after one initial update.',
  limits: [
    'Construction includes coordinate conversion, Entity creation and collection reconciliation, but not GPU upload, primitive tessellation, render frames, app startup, network or IPC.',
    'Old code draws only the first part of each record. Current cold construction does more correct work; timings do not compare equal rendered output.',
    'An unchanged update here reuses the same geometry references. A fresh IPC payload can contain new geometry objects and may rebuild; this does not benchmark an unchanged network refresh.',
    'This is a CPU microbenchmark on this machine; medians reduce but do not eliminate JIT/garbage collection/other-process noise. Packaging is free to continue; no release artifact is opened or changed.',
  ], scenes: [] };
for (const scene of scenes) {
  for (let i = 0; i < 3; i++) { measure(Old, scene); measure(Current, scene); }
  const old = [], current = [];
  for (let i = 0; i < 9; i++) {
    if (i % 2) { current.push(measure(Current, scene)); old.push(measure(Old, scene)); }
    else { old.push(measure(Old, scene)); current.push(measure(Current, scene)); }
  }
  const parts = scene.records.reduce((n, r) => n + (r.geometry.type === 'Polygon' ? 1 : r.geometry.coordinates.length), 0);
  assert(old.every(s => s.entities === scene.records.length && s.retainedEntities === 0));
  assert(current.every(s => s.entities === parts && s.retainedEntities === parts));
  const summarize = samples => Object.fromEntries(['coldMsPerScene', 'coldUsPerRecord', 'unchangedUpdateMsPerScene', 'unchangedUpdateUsPerRecord'].map(key => [key, +median(samples.map(s => s[key])).toFixed(6)]));
  report.scenes.push({ name: scene.name, records: scene.records.length, suppliedPolygonParts: parts, capture: scene.capture,
    coldIterationsPerSample: scene.coldIterations, unchangedUpdatesPerSample: scene.tickIterations,
    priorEntities: old[0].entities, currentEntities: current[0].entities, priorUnchangedEntityRetention: 0, currentUnchangedEntityRetention: current[0].retainedEntities,
    priorMedian: summarize(old), currentMedian: summarize(current), rawPairedSamples: old.map((before, i) => ({ prior: before, current: current[i] })) });
}
assert.equal(hash(await readFile(join(root, rendererPath), 'utf8')), report.current.sha256, 'Frozen renderer changed during timing');
report.result = 'PASS'; report.finishedAt = new Date().toISOString();
await writeFile(join(root, 'docs/nifc-render-timing.log'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ result: report.result, prior: report.prior.gitCommit, scenes: report.scenes.map(({ rawPairedSamples, ...scene }) => scene) }, null, 2));
