// Read-only catalog benchmark. No provider/network calls or app/profile access.
// Node timings cover local index construction and lookup, not renderer startup,
// worker transport, DOM rendering, camera flight or UI interaction.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { buildSync } from 'esbuild';

const bytes = readFileSync('src/renderer/data/places.json');
const catalog = JSON.parse(bytes.toString('utf8'));
const code = buildSync({ entryPoints: ['src/renderer/lib/placeSearch.ts'], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22' }).outputFiles[0].text;
const { createPlaceSearchIndex, searchPlaces } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const queries = ['Tokyo', '東京', 'Dubai', 'دبي', 'Beijing', '北京', 'Москва', 'München', 'Munich', 'Osaka', 'Mumbai', 'Bombay', 'Sao Paulo', 'Sa\u0303o Paulo', 'Montre\u0301al', 'Anchorage', 'Paris, France', 'Paris, Texas', 'London, Ontario, Canada', 'Springfield, Illinois', 'Victoria, Seychelles', 'Washington, D.C.', 'san', 'sa', 'not a catalog city'];
// Exact prior SearchBox workflow: canonical-only lowercase prefix, first eight
// in existing population order. It has no aliases/Unicode/qualifier semantics.
const oldSearch = query => {
  const key = query.trim().toLowerCase(), found = [];
  if (key.length < 2) return found;
  for (let i = 0; i < catalog.places.length; i++) {
    const place = catalog.places[i];
    if (place[0].toLowerCase().startsWith(key)) {
      found.push({ place, index: i, matchedName: place[0], match: place[0].toLowerCase() === key ? 'exact' : 'prefix' });
      if (found.length === 8) break;
    }
  }
  return found;
};
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const coldMs = [];
let index;
for (let run = 0; run < 5; run++) {
  const start = performance.now(); index = createPlaceSearchIndex(catalog.places); coldMs.push(performance.now() - start);
}
for (let warm = 0; warm < 20; warm++) for (const query of queries) { oldSearch(query); searchPlaces(index, query); }
function measure(search) {
  const samples = []; let returned = 0;
  const start = performance.now();
  for (let round = 0; round < 250; round++) for (const query of queries) {
    const before = performance.now(); returned += search(query).length; samples.push(performance.now() - before);
  }
  return { queries: samples.length, totalMs: performance.now() - start, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), maxMs: Math.max(...samples), returnedResults: returned };
}
const oldTiming = measure(oldSearch), newTiming = measure(query => searchPlaces(index, query));
const summarize = matches => matches.map(({ place, index: row, matchedName, match }) => ({ row, name: place[0], admin1: place[1], country: place[2], lat: place[3], lon: place[4], matchedName, match }));
const legacyBytes = Buffer.from(JSON.stringify({ source: catalog.source, fields: catalog.fields.slice(0, 6), places: catalog.places.map(place => place.slice(0, 6)) }));
const report = {
  measuredAt: new Date().toISOString(), runtime: process.version, platform: process.platform, architecture: process.arch,
  hardware: { cpu: cpus()[0]?.model ?? null, logicalCpus: cpus().length },
  source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), rows: catalog.places.length, aliases: catalog.places.reduce((sum, row) => sum + (row[6]?.length ?? 0), 0),
    canonicalOnlyDocument: { bytes: legacyBytes.length, sha256: createHash('sha256').update(legacyBytes).digest('hex'), boundary: 'Reconstructed from unchanged original metadata and first six tuple fields; 432286-byte original was observed before alias update.' },
    matcherSha256: createHash('sha256').update(readFileSync('src/renderer/lib/placeSearch.ts')).digest('hex') },
  boundary: 'Same machine, catalog and query sequence. Old canonical-only first-eight prefix behavior versus new exact/alias/Unicode/qualifier behavior; results differ intentionally. Node only. JSON parse, TypeScript compilation, renderer/worker startup, DOM, map flight and network excluded.',
  coldIndex: { firstMs: coldMs[0], freshConstructionRunsMs: coldMs, medianMs: percentile(coldMs, 0.5), entries: index.entries.length },
  oldCanonicalPrefix: oldTiming, newIndexLookup: newTiming,
  queries: queries.map(query => ({ query, old: summarize(oldSearch(query)), current: summarize(searchPlaces(index, query)) })),
};
writeFileSync('docs/place-search-timing.log', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ source: report.source, coldIndex: report.coldIndex, oldCanonicalPrefix: oldTiming, newIndexLookup: newTiming, report: 'docs/place-search-timing.log' }));
