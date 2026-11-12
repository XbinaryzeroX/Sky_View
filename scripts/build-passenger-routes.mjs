// Regenerate the bundled passenger airline callsign routes from one immutable CC0 source revision.
// Run with: node scripts/build-passenger-routes.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import Papa from 'papaparse';

const revision = '57c9d605a36ef1ec5d6e0f48c2d0700002e582d2';
const published = '2026-11-11';
const base = 'https://raw.githubusercontent.com/vradarserver/standing-data/' + revision;
const airportRevision = '97afc8b3ee4711d70199fda73bdd66df9fd58cb8';
const destination = new URL('../src/renderer/data/', import.meta.url);
// Scheduled passenger operators. Route rows must belong to the operator's own code.
const carriers = `
AAL ACA AFR AIC AIZ AMX ANA ANE ANZ ARG ASA ASH AUA AVA AXB AZU
BAW BEL BTA BTI CAL CCA CEB CES CFE CHH CLH CMP CPA CSN CTN
DAL DLH EIN ELY ENY ETD ETH EVA EWG EZS EZY FDB FFT FIN FJI FLI
GFA GIA GLO HAL HVN IBE IBS ICE IGO ISR ITY JAL JBU JJA JST
KAL KLM KQA LAN LRC LOT LPE MAS MDA MEA MSR NAX
OAL OMA PAL PGT PIA POE QFA QJE QTR RAM RJA
ROT RPA RWD RYR SAA SAS SBI SCX SEJ SIA SKW SWA SWR TAP
TAM THA THY TOM TRA TSC UAE UAL UZB VIR VIV VJC VLG
VOI VOZ WEN WIF WJA WMT WZZ`.trim().split(/\s+/);

async function csv(path, optional = false) {
  const response = await fetch(path.startsWith('https:') ? path : base + '/' + path, { signal: AbortSignal.timeout(30000) });
  if (optional && response.status === 404) return [];
  assert(response.ok, path + ' returned HTTP ' + response.status);
  const result = Papa.parse(await response.text(), { header: true, skipEmptyLines: 'greedy' });
  assert.equal(result.errors.length, 0, path + ' could not be parsed');
  return result.data;
}

const operators = await csv('airlines/schema-01/airlines.csv');
const directory = await csv('https://raw.githubusercontent.com/davidmegginson/ourairports-data/' + airportRevision + '/airports.csv');
const publicAirports = new Map(directory.filter(a => a.scheduled_service === 'yes' && a.type !== 'closed')
  .map(a => [a.icao_code || a.ident, a]));
const bundledCodes = new Set(JSON.parse(await readFile(new URL('airports.json', destination), 'utf8')).airports.map(a => a[0]));
const names = {};
const rows = new Map();
const ambiguous = new Set();
async function readOperator(code) {
  const operator = operators.find(row => row.Code === code && row.ICAO === code);
  if (!operator) return;
  const prefix = 'routes/schema-01/' + code[0] + '/' + code + '-';
  let records = await csv(prefix + 'all.csv', true);
  if (!records.length) {
    records = [];
    for (let digit = 0; digit <= 9; digit++) records.push(...await csv(prefix + digit + '.csv', true));
  }
  const exceptions = [operator.PositioningFlightPattern, operator.CharterFlightPattern]
    .filter(Boolean).map(pattern => new RegExp(pattern, 'i'));
  for (const row of records) {
    if (row.Code !== code || row.AirlineCode !== code || row.Callsign !== code + row.Number) continue;
    if (!/^\d[\dA-Z]{0,3}$/.test(row.Number) || exceptions.some(re => re.test(row.Number) || re.test(row.Callsign))) continue;
    if (!/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,9}$/.test(row.AirportCodes)) continue;
    const stops = row.AirportCodes.split('-');
    if (new Set(stops).size < 2 || !stops.every(code => publicAirports.has(code))) continue;
    if (rows.has(row.Callsign) && rows.get(row.Callsign) !== row.AirportCodes) ambiguous.add(row.Callsign);
    rows.set(row.Callsign, row.AirportCodes);
    names[code] = operator.Name;
  }
}
// Bound simultaneous requests to the source archive.
for (let i = 0; i < carriers.length; i += 5) await Promise.all(carriers.slice(i, i + 5).map(readOperator));
for (const key of ambiguous) rows.delete(key);
const sorted = [...rows].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
assert(sorted.length > 10000, 'The published passenger route catalog is incomplete');
await writeFile(new URL('passenger-routes.txt', destination), '\n' + sorted.map(([id, airports]) => id + ',' + airports).join('\n') + '\n');
// Keep the app's original airport catalog. Supplement only missing scheduled-service stops in these routes.
const extraCodes = [...new Set(sorted.flatMap(([, path]) => path.split('-')).filter(code => !bundledCodes.has(code)))].sort();
const extraAirports = extraCodes.map(code => {
  const a = publicAirports.get(code);
  const lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
  assert(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180);
  return [code, a.iata_code, a.name, lat, lon, a.iso_country, a.municipality];
});
await writeFile(new URL('passenger-route-airports.json', destination), JSON.stringify(extraAirports) + '\n');
const manifest = { source: 'Virtual Radar Server', revision, published, airportRevision, count: sorted.length,
  carriers: Object.fromEntries(Object.entries(names).sort(([left], [right]) => left.localeCompare(right))) };
await writeFile(new URL('../../shared/passengerCarriers.json', destination), JSON.stringify(manifest, null, 2) + '\n');
console.log(sorted.length + ' usual routes for ' + Object.keys(names).length + ' passenger operators. Source revision ' + revision);
