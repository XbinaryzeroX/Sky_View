// node tests/location-monitoring-benchmark.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const project = fileURLToPath(new URL('..', import.meta.url));
const modulePath = 'src/shared/monitoring.ts';
const baseline = 'a22dcb09ea6144d4899a373ab25c4f70931cd129';
const require = createRequire(import.meta.url);
// Compile the two implementations against identical local geospatial dependencies.
function load(source, filename) {
  const { outputFiles } = buildSync({
    stdin: { contents: source, resolveDir: dirname(filename), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node24',
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const filename = join(project, modulePath);
const previous = load(execFileSync('git', ['show', baseline + ':' + modulePath], { cwd: project, encoding: 'utf8' }), filename);
const current = load(readFileSync(filename, 'utf8'), filename);
const norm = load(readFileSync(join(project, 'src/shared/normalize.ts'), 'utf8'), join(project, 'src/shared/normalize.ts'));
const first = norm.normalizeNwsAlerts(JSON.parse(readFileSync(join(project, 'tests/fixtures/nws-alerts.json'), 'utf8'))).alerts[0];
const now = new Date('2026-11-09T12:00:00Z');
const code = (kind, n) => `${kind}/CO${kind === 'county' ? 'C' : 'Z'}${String(n).padStart(3, '0')}`;
const locations = Array.from({ length: 200 }, (_, index) => ({
  id: 'place-' + index, lat: 39.74, lon: -104.99, radiusKm: 25,
  zones: { status: 'resolved', zones: index % 2 ? [code('forecast', index)] : [code('forecast', index), code('county', index)] },
}));
const alerts = Array.from({ length: 400 }, (_, index) => ({
  ...first, id: 'alert-' + index, geometry: null, bbox: null,
  affectedZones: Array.from({ length: 6 }, (_, j) => 'https://api.weather.gov/zones/' + code(index < 200 ? 'forecast' : 'county', (index + j) % 200)),
}));
const input = { locations, alerts, quakes: [], superseded: new Set(), nwsFreshness: 'fresh', usgsFreshness: 'fresh', now };
const samples = { previous: [], current: [] };
const results = {};
for (let round = 0; round < 8; round++) {
  for (const [name, impl] of round % 2 ? [['current', current], ['previous', previous]] : [['previous', previous], ['current', current]]) {
    const start = performance.now();
    const evaluated = Object.values(impl.evaluateLocations(input));
    const elapsed = performance.now() - start;
    const counts = evaluated.reduce((r, loc) => ({
      inside: r.inside + loc.alertsInside.length, outside: r.outside + loc.alertsOutsideCount, unknown: r.unknown + loc.alertsUnknown.length,
    }), { inside: 0, outside: 0, unknown: 0 });
    if (round) samples[name].push(Number(elapsed.toFixed(2)));
    results[name] = counts;
  }
}
assert.equal(results.previous.inside, 1800);
assert.equal(results.current.inside, 1800);
assert.equal(results.previous.unknown, 0);
assert.equal(results.current.unknown, 20000);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ baseline, node: process.version, area: 'Pure saved-place spatial evaluation, no network or rendering.',
  locations: locations.length, alerts: alerts.length, zoneReferencesPerAlert: 6, results, samplesMs: samples,
  medianMs: { previous: median(samples.previous), current: median(samples.current) } }, null, 2));
