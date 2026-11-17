// Builds src/renderer/data/airportFrequencies.json from OurAirports airport-frequencies.csv (public domain),
// keeping only air-traffic-control frequencies for the airports already in airports.json.
// Usage: node scripts/build-airport-frequencies.mjs <airport-frequencies.csv>
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';

// Tower, ground, approach, departure, clearance, ATIS, and the uncontrolled-field equivalents.
const KEEP = new Set(['TWR', 'GND', 'APP', 'DEP', 'CLD', 'ATIS', 'CTAF', 'A/D', 'AFIS']);
const ORDER = ['TWR', 'GND', 'APP', 'DEP', 'CLD', 'ATIS', 'CTAF', 'A/D', 'AFIS'];

const idents = new Set(JSON.parse(readFileSync('src/renderer/data/airports.json', 'utf8')).airports.map((a) => a[0]));
const rows = Papa.parse(readFileSync(process.argv[2], 'utf8'), { header: true, skipEmptyLines: true }).data;
const out = {};
let kept = 0;
for (const r of rows) {
  const type = String(r.type ?? '').toUpperCase();
  if (!KEEP.has(type) || !idents.has(r.airport_ident)) continue;
  const mhz = Number(r.frequency_mhz);
  // Aviation VHF voice band; OurAirports has a few typos (kHz values, HF entries).
  if (!Number.isFinite(mhz) || mhz < 108 || mhz > 137) continue;
  const desc = String(r.description ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
  const list = (out[r.airport_ident] ??= []);
  if (list.some(([t, , f]) => t === type && f === mhz)) continue;
  list.push([type, desc, Math.round(mhz * 1000) / 1000]);
  kept++;
}
for (const list of Object.values(out)) list.sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || a[2] - b[2]);
writeFileSync('src/renderer/data/airportFrequencies.json', JSON.stringify({ source: 'OurAirports (public domain), ourairports.com', fields: ['type', 'description', 'mhz'], frequencies: out }));
console.log(`wrote ${kept} frequencies for ${Object.keys(out).length} airports`);
