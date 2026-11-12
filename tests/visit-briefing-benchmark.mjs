// Run with node tests/visit-briefing-benchmark.mjs. Both reads use the same local SQLite archive.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'atlas-visit-timing-'));
let store;
try {
  const bundle = join(directory, 'store.cjs');
  buildSync({
    stdin: {
      resolveDir: root,
      contents: "export { AtlasStore } from './src/main/store'; export { normalizeNwsAlerts, normalizeUsgsFeed } from './src/shared/normalize';",
    },
    platform: 'node', bundle: true, format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  const { AtlasStore, normalizeNwsAlerts, normalizeUsgsFeed } = createRequire(import.meta.url)(bundle);
  const fixture = (name) => JSON.parse(readFileSync(join(root, 'tests/fixtures', name), 'utf8'));
  const alert = normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0];
  const quake = normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0];
  const database = join(directory, 'benchmark.sqlite');
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();
  const alerts = Array.from({ length: 500 }, (_, index) => ({ ...alert, id: 'alert-' + index }));
  const quakes = Array.from({ length: 10_000 }, (_, index) => ({ ...quake, id: 'quake-' + index, ids: ['quake-' + index] }));
  const record = (feed, records, offset) => store.recordTimelineObservation({
    feed, records, observedAt: at(offset), sourceUpdatedAt: at(offset), validForMs: 300_000,
    scope: feed === 'nws' ? 'active-US' : 'all_month',
  });
  store = new AtlasStore(database);
  store.saveSettings({ ...store.getSettings(), historyMaxRecords: 50_000 });
  store.beginVisit(at(0));
  record('nws', alerts, 1000);
  record('usgs', quakes, 1000);
  store.close();
  store = new AtlasStore(database);
  store.beginVisit(at(2000));
  record('nws', [...alerts.slice(1, -1), { ...alerts[0], headline: 'Revised headline' }, { ...alert, id: 'new-alert' }], 3000);
  record('usgs', [...quakes.slice(1, -1), { ...quakes[0], mag: 6.73 }, { ...quake, id: 'new-quake', ids: ['new-quake'] }], 3000);

  function fullFrameComparison() {
    const before = store.timelineFrame(at(1000));
    const after = store.timelineFrame(at(3000));
    return ['nws', 'usgs'].map(feed => {
      const prior = new Map(before[feed].records.map(row => [row.id, row]));
      const current = new Map(after[feed].records.map(row => [row.id, row]));
      let added = 0, changed = 0, removed = 0;
      for (const [id, row] of current) {
        if (!prior.has(id)) added++;
        else if (JSON.stringify(prior.get(id)) !== JSON.stringify(row)) changed++;
      }
      for (const id of prior.keys()) if (!current.has(id)) removed++;
      return [added, changed, removed];
    });
  }
  function visitComparison() {
    const { feeds } = store.visitBriefing(at(4000));
    return [feeds.nws, feeds.usgs].map(feed => [feed.new.total, feed.updated.total, feed.noLongerReturned.total]);
  }
  const stats = store.timelineStats();
  const samples = { fullFrameComparison: [], visitComparison: [] };
  for (let round = 0; round < 8; round++) {
    const runs = round % 2 ? [visitComparison, fullFrameComparison] : [fullFrameComparison, visitComparison];
    for (const run of runs) {
      const start = performance.now();
      const counts = run();
      const elapsed = performance.now() - start;
      assert.deepEqual(counts, [[1, 1, 1], [1, 1, 1]]);
      if (round) samples[run.name].push(Number(elapsed.toFixed(2)));
    }
  }
  assert.deepEqual(store.timelineStats(), stats);
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  console.log(JSON.stringify({
    scope: 'Local reads only. Full-frame comparison uses the existing Replay reader as a reference implementation. Excludes rendering, provider I/O and export.',
    node: process.version, fixture: { alerts: alerts.length, earthquakes: quakes.length, changesPerCategoryPerFeed: 1 },
    samplesMs: samples, medianMs: Object.fromEntries(Object.entries(samples).map(([name, list]) => [name, median(list)])),
  }, null, 2));
} finally {
  try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
}
