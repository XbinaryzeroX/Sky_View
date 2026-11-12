// Manual bounded-backend benchmark. Uses local fixtures, never provider observations.
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(join(tmpdir(), 'atlas-timeline-benchmark-'));
const bundle = join(directory, 'backend.cjs');
buildSync({ stdin: { contents: "export { AtlasStore } from './src/main/store'; export { DEFAULT_SETTINGS } from './src/shared/ipc'; export { normalizeNwsAlerts, normalizeUsgsFeed } from './src/shared/normalize';", resolveDir: project }, platform: 'node', bundle: true, format: 'cjs', outfile: bundle, logLevel: 'silent' });
const { AtlasStore, DEFAULT_SETTINGS, normalizeNwsAlerts, normalizeUsgsFeed } = createRequire(import.meta.url)(bundle);
const fixture = name => JSON.parse(readFileSync(join(project, 'tests', 'fixtures', name), 'utf8'));
const firstAlert = normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0];
const firstQuake = normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0];
const alerts = Array.from({ length: 500 }, (_, i) => ({ ...firstAlert, id: `benchmark-alert-${i}` }));
const quakes = Array.from({ length: 10_000 }, (_, i) => ({ ...firstQuake, id: `benchmark-quake-${i}`, ids: [`benchmark-quake-${i}`] }));
const path = join(directory, 'timeline.sqlite');
const store = new AtlasStore(path);
store.saveSettings({ ...DEFAULT_SETTINGS, historyMaxRecords: 50_000 });
const start = Date.parse('2026-11-11T12:00:00.000Z');
const time = offset => new Date(start + offset).toISOString();
const record = (feed, records, offset) => store.recordTimelineObservation({ feed, records, scope: feed === 'nws' ? 'active-US' : 'all_month', observedAt: time(offset), sourceUpdatedAt: time(offset), validForMs: 600_000 });
const measured = operation => { const began = performance.now(); const result = operation(); return { ms: Number((performance.now() - began).toFixed(2)), result }; };
const cold = measured(() => { record('nws', alerts, 0); record('usgs', quakes, 0); });
const original = store.timelineStats();
const stable = [];
for (let i = 1; i <= 5; i++) stable.push(measured(() => { record('nws', alerts, i * 1000); record('usgs', quakes, i * 1000); }).ms);
const unchanged = store.timelineStats();
if (unchanged.revisions !== original.revisions || unchanged.intervals !== original.intervals) throw new Error('Unchanged replies rewrote stored record memberships.');
const revised = quakes.map((quake, i) => i === 0 ? { ...quake, mag: 5.6, lat: 21.3, lon: -157.8 } : quake);
const revision = measured(() => record('usgs', revised, 6000));
const historical = measured(() => store.timelineFrame(time(0)));
const current = measured(() => store.timelineFrame(time(6000)));
if (historical.result.nws.records.length !== 500 || historical.result.usgs.records.length !== 10_000 || current.result.usgs.records.length !== 10_000) throw new Error('Recorded membership count changed.');
// Membership ordering is not provider reply ordering; locate the changed identity explicitly.
const old = historical.result.usgs.records.find(q => q.id === 'benchmark-quake-0');
const next = current.result.usgs.records.find(q => q.id === 'benchmark-quake-0');
if (!old || !next || old.mag === next.mag) throw new Error('Revision-preserving frame query failed.');
const sizes = {};
for (const suffix of ['', '-wal', '-shm']) { try { sizes[suffix || 'database'] = statSync(path + suffix).size; } catch { /* No WAL after an automatic checkpoint. */ } }
console.log(JSON.stringify({ input: 'synthetic local fixtures; no provider verification', node: process.version, records: { nws: 500, usgs: 10_000 }, serializedReplyBytes: Buffer.byteLength(JSON.stringify(alerts)) + Buffer.byteLength(JSON.stringify(quakes)), coldWriteMs: cold.ms, stableTwoFeedWriteMs: stable, oneRevisionWriteMs: revision.ms, oldFrameMs: historical.ms, latestFrameMs: current.ms, firstStats: original, stableStats: unchanged, finalStats: store.timelineStats(), sqliteBytes: sizes, outputDirectory: directory }, null, 2));
store.close();
