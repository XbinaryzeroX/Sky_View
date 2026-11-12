// Public evidence for the aircraft library. This reads model listings, never geometry or credentials.
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { namedAircraftTypes } from '../src/shared/icaoTypes.ts';

const fromRoot = path => new URL('../' + path, import.meta.url);
const readJson = async path => JSON.parse(await readFile(fromRoot(path), 'utf8'));
const profiles = await readJson('src/shared/airlinerCharacteristics.json');
const references = await readJson('src/shared/aircraftSketchfabReferences.json');
const shortlist = await readJson('scripts/vehicle-models/shortlist.json');
const types = Object.fromEntries(Object.entries(profiles).map(([code, row]) => [code, row.model]));
types.CRJX = 'Bombardier CRJ-1000';
for (const [code, reference] of Object.entries(references)) types[code] ??= reference.title;
const excludedMilitaryTypes = new Set('A400 K35R P8 E3TF C17 KC46 C390 C130 C30J P3 H60 H47 V22 F16 F18H F35 EUFI T38 B52 R135 E6'.split(' '));
for (const [code, name] of Object.entries(namedAircraftTypes)) {
  if (!excludedMilitaryTypes.has(code)) types[code] ??= name;
}
const reportPath = 'docs/airliner-sketchfab-catalog.log';
// Expand a completed audit with new types without repeating the original public requests.
const prior = process.argv.includes('--extend') ? await readJson(reportPath) : null;
const approved = new Set(shortlist.models.filter(m => m.kind === 'aircraft' && m.forward && m.up).flatMap(m => m.icao));
const audit = {
  startedAt: prior?.startedAt ?? new Date().toISOString(),
  source: 'https://api.sketchfab.com/v3/search',
  scope: 'One public relevance-ranked page per aircraft type. Results can include partial matches, model parts and different variants. Counts describe this page only. Reviewed source pages and locally approved meshes are listed separately.',
  excludedMilitaryTypeCodes: [...excludedMilitaryTypes].sort(),
  unreportedType: 'An aircraft without a type designation cannot be matched to a public model.',
  rows: {},
};
for (const [code, query] of Object.entries(types).sort(([a], [b]) => a.localeCompare(b))) {
  const previous = prior?.rows[code];
  if (previous?.query === query) {
    audit.rows[code] = { ...previous, checkedBy: previous.checkedBy ?? prior.finishedAt };
    continue;
  }
  const url = new URL(audit.source);
  url.search = new URLSearchParams({ type: 'models', q: query, count: '12' });
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Sketchfab returned HTTP ' + response.status + ' for ' + code + '. Search stopped.');
  const { results } = await response.json();
  if (!Array.isArray(results)) throw new Error('Missing model results for ' + code);
  audit.rows[code] = {
    query,
    checkedBy: new Date().toISOString(),
    resultsOnPage: results.length,
    downloadableOnPage: results.filter(model => model.isDownloadable === true).length,
    reviewedPage: references[code] ? 'https://sketchfab.com/3d-models/' + references[code].page : null,
    approvedLocalMesh: approved.has(code),
  };
  await wait(300);
}
audit.finishedAt = new Date().toISOString();
audit.counts = {
  searchedTypes: Object.keys(audit.rows).length,
  namedCivilTypes: Object.keys(namedAircraftTypes).filter(code => !excludedMilitaryTypes.has(code)).length,
  militaryTypesExcluded: excludedMilitaryTypes.size,
  commercialProfilesCovered: Object.keys(profiles).length + 1,
  withReviewedPage: Object.values(audit.rows).filter(row => row.reviewedPage).length,
  withApprovedLocalMesh: Object.values(audit.rows).filter(row => row.approvedLocalMesh).length,
  withoutResultsOnFirstPage: Object.values(audit.rows).filter(row => !row.resultsOnPage).length,
};
await writeFile(fromRoot(reportPath), JSON.stringify(audit, null, 2) + '\n');
console.log(audit.counts);
