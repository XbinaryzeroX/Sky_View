// Exercise the committed v0.7.0 store and the working store against copies of an isolated database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const session = await mkdtemp(join(tmpdir(), 'atlas-store-upgrade-'));
const baseline = 'a22dcb09ea6144d4899a373ab25c4f70931cd129';
const require = createRequire(import.meta.url);
const at = '2026-11-09T12:00:00.000Z';

async function loadStore(previous) {
  const outfile = join(session, previous ? 'previous.cjs' : 'current.cjs');
  await build({
    absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', outfile,
    stdin: { contents: "export {AtlasStore} from './src/main/store'; export {normalizeUsgsFeed, normalizeNwsAlerts} from './src/shared/normalize'" +
      (previous ? '' : "; export {AppCore} from './src/main/core'"), resolveDir: root },
    plugins: previous ? [{ name: 'committed-atlas-source', setup(build) {
      build.onLoad({ filter: /\.ts$/ }, (args) => {
        const path = relative(root, args.path).split(sep).join('/');
        if (!path.startsWith('src/')) return;
        const contents = execFileSync('git', ['show', baseline + ':' + path], { cwd: root, encoding: 'utf8', windowsHide: true });
        return { contents, loader: 'ts', resolveDir: dirname(args.path) };
      });
    } }] : [],
  });
  return require(outfile);
}

const previous = await loadStore(true);
const current = await loadStore(false);
const original = join(session, 'original.sqlite');
const copy = join(session, 'upgrade-copy.sqlite');
const old = new previous.AtlasStore(original);
const area = { id: 'saved-shore', name: 'Shore', kind: 'area', color: '#ffd166', visible: false,
  points: [[-124, 37], [-122, 37], [-123, 39]], createdAt: at };
old.createLocation({ name: 'Previous location', category: 'Office', notes: 'Fixture note', lat: 38, lon: -123, radiusKm: 35 },
  at, { status: 'disabled', zones: [], checkedAt: at, error: null });
old.saveSettings({ ...old.getSettings(), quakeWindow: 'day', zoneLookupEnabled: false, terrainEnabled: false, favoriteCameras: ['fixture-camera'] });
old.setMeta('watchlist', JSON.stringify([{ kind: 'vessel', id: 'fixture', label: 'Fixture', addedAt: at }]));
old.putDoc('annotations', area.id, area, at);
old.putDoc('boards', 'board1', { id: 'board1', name: 'Previous board', cards: [], createdAt: at }, at);
old.putDoc('saved_views', 'view1', { id: 'view1', name: 'Previous view', camera: { lat: 37, lon: -122, heightM: 5000, heading: 0, pitch: -1 }, basemap: 'atlas', layersEnabled: [], createdAt: at }, at);
old.putDoc('people', 'contact1', { id: 'contact1', name: 'Fixture contact', createdAt: at }, at);
old.addTrackPoints('transit', [{ rid: 'fixture-bus', t: at, lat: 37, lon: -122, alt: null, heading: 270 }]);
const fixture = JSON.parse(await readFile(join(root, 'tests/fixtures/usgs-week.json'), 'utf8'));
const { quakes, sourceUpdatedAt } = previous.normalizeUsgsFeed(fixture);
old.ingestQuakes(quakes, at);
old.setFeedCache('usgs', { fetchedAt: at, sourceUpdatedAt, payload: { feedKey: '2.5_day', quakes } });
const nwsFixture = JSON.parse(await readFile(join(root, 'tests/fixtures/nws-alerts.json'), 'utf8'));
const nws = previous.normalizeNwsAlerts(nwsFixture);
assert.ok(nws.alerts.length > 0);
old.ingestAlerts(nws.alerts, at);
old.setFeedCache('nws', { fetchedAt: at, sourceUpdatedAt: nws.sourceUpdatedAt, payload: nws.alerts });

const tables = ['meta', 'locations', 'feed_cache', 'events', 'annotations', 'saved_views', 'boards', 'people', 'track_points'];
function rows(store) {
  return Object.fromEntries(tables.map(table => [table, store.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
}
const expected = rows(old);
assert.ok(Object.values(expected).every(value => value.length > 0));
old.close();
// The migration adds exactly one nullable column to the original cache rows.
// Preserve every old value and verify that no completeness was assigned retroactively.
for (const entry of expected.feed_cache) entry.coverage = null;
await copyFile(original, copy);
const migrated = new current.AtlasStore(copy);
assert.deepEqual(rows(migrated), expected);
const emptyTimeline = { epochs: 0, revisions: 0, intervals: 0, payloadBytes: 0 };
function assertNoTimelineBackfill(store) {
  assert.deepEqual(store.timelineStats(), emptyTimeline);
  assert.deepEqual(store.timelineRange(), { oldest: at, newest: at, points: 1, nwsFrames: 0, usgsFrames: 0 });
  for (const time of [at, quakes[0].time, new Date(Date.parse(at) + 60_000).toISOString()]) {
    const frame = store.timelineFrame(time);
    for (const feed of ['nws', 'usgs']) {
      assert.equal(frame[feed].state, 'unknown');
      assert.deepEqual(frame[feed].records, []);
      assert.equal(frame[feed].observedAt, null);
    }
  }
  const movement = store.trackSnapshot('transit', at, 5 * 60_000);
  assert.equal(movement.length, 1);
  assert.equal(movement[0].rid, 'fixture-bus');
  assert.equal(movement[0].t, at);
}
assertNoTimelineBackfill(migrated);
assert.deepEqual(migrated.areaWatchState().rules, []);
assert.deepEqual(migrated.areaWatchState().events, []);
const core = new current.AppCore({ store: migrated, now: () => new Date(at) });
core.init();
assert.equal(core.snapshot().feeds.nws.fromCache, true);
assert.equal(core.snapshot().feeds.usgs.fromCache, true);
for (const feed of ['nws', 'usgs']) {
  assert.equal(core.snapshot().feeds[feed].coverage.completeness, 'unknown');
  assert.equal(core.snapshot().feeds[feed].coverage.skippedRecords, null);
}
const firstVisit = core.visitBriefing();
assert.equal(firstVisit.previousStartedAt, null);
assert.equal(firstVisit.sessionStartedAt, at);
for (const feed of ['nws', 'usgs']) {
  assert.equal(firstVisit.feeds[feed].current.observedAt, null);
  assert.equal(firstVisit.feeds[feed].new.total, null);
}
assertNoTimelineBackfill(migrated);
core.putAreaWatch({ areaId: area.id, enabled: true, minMagnitude: 3 });
const [rule] = core.snapshot().areaWatches.rules;
assert.equal(rule.areaId, area.id);
migrated.close();
const reopened = new current.AtlasStore(copy);
assert.deepEqual(reopened.areaWatchState().rules, [rule]);
assertNoTimelineBackfill(reopened);
function assertOriginalRows(store) {
  const actual = rows(store);
  const oldKeys = new Set(expected.meta.map(row => row.key));
  const added = actual.meta.filter(row => !oldKeys.has(row.key)).map(row => row.key).sort();
  assert.deepEqual(added, ['area_watch_evaluation', 'timeline_visit_v1']);
  actual.meta = actual.meta.filter(row => oldKeys.has(row.key));
  assert.deepEqual(actual, expected);
}
assertOriginalRows(reopened);
assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
// An explicit new fixture observation may start recording; it still cannot turn
// legacy event/cache rows into an earlier full-feed frame.
const recordedAt = new Date(Date.parse(at) + 60_000).toISOString();
reopened.recordTimelineObservation({ feed: 'usgs', observedAt: recordedAt, sourceUpdatedAt,
  scope: '2.5_day', validForMs: 10 * 60_000, records: quakes });
assert.equal(reopened.timelineFrame(recordedAt).usgs.state, 'recorded');
assert.deepEqual(reopened.timelineFrame(recordedAt).usgs.records.map(q => q.id).sort(), quakes.map(q => q.id).sort());
assert.equal(reopened.timelineFrame(recordedAt).nws.state, 'unknown');
assert.equal(reopened.timelineFrame(at).usgs.state, 'unknown');
assert.deepEqual(reopened.timelineFrame(at).usgs.records, []);
reopened.close();
const final = new current.AtlasStore(copy);
assert.equal(final.timelineFrame(recordedAt).usgs.state, 'recorded');
assert.equal(final.timelineFrame(at).usgs.state, 'unknown');
assert.equal(final.timelineFrame(at).nws.state, 'unknown');
const timelineAfterExplicitObservation = final.timelineStats();
const nextLaunch = new Date(Date.parse(recordedAt) + 60_000);
const nextCore = new current.AppCore({ store: final, now: () => nextLaunch });
nextCore.init();
const nextVisit = nextCore.visitBriefing();
assert.equal(nextVisit.previousStartedAt, at);
assert.equal(nextVisit.feeds.usgs.baseline.observedAt, recordedAt);
assert.equal(nextVisit.feeds.usgs.current.observedAt, null);
assert.equal(nextVisit.feeds.usgs.new.total, null);
assert.equal(nextVisit.feeds.nws.baseline.observedAt, null);
assertOriginalRows(final);
assert.deepEqual(final.db.prepare('PRAGMA foreign_key_check').all(), []);
final.close();
console.log(JSON.stringify({ result: 'PASS', baseline, method: 'Prior v0.7.0 source wrote synthetic local data. Current source opened a closed-file copy three times; no provider requests.',
  preservedRows: Object.fromEntries(tables.map(table => [table, expected[table].length])), migratedWatchPersisted: true, foreignKeyErrors: 0,
  originalFeedCacheColumnsPreserved: true, legacyFeedCacheCompletenessUnknown: true,
  legacyFeedCachesNotBackfilled: true, legacyEventHistoryNotBackfilled: true, legacyMovementStillReplayable: true,
  timelineAfterMigrationAndCachedCoreInit: emptyTimeline, timelineAfterExplicitObservation,
  explicitNewObservationPersisted: true, earlierFeedFramesRemainUnknown: true,
  firstUpgradedVisitUsesNoLegacyBaseline: true, secondVisitBaselineIsExplicitObservation: true, cachedOnlyRestartYieldsUnknownChanges: true,
  userProfileAccessed: false, installerExecuted: false }, null, 2));
