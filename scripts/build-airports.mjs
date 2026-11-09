// Builds src/renderer/data/airports.json from OurAirports airports.csv (public domain).
// Usage: node scripts/build-airports.mjs <airports.csv>
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
const rows = Papa.parse(readFileSync(process.argv[2], 'utf8'), { header: true, skipEmptyLines: true }).data;
const out = [];
for (const r of rows) {
  if (r.type !== 'large_airport' && r.type !== 'medium_airport') continue;
  const lat = Number(r.latitude_deg), lon = Number(r.longitude_deg);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  out.push([r.ident, r.iata_code || '', r.name, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, r.elevation_ft ? Number(r.elevation_ft) : null, r.iso_country, r.municipality || '', r.type === 'large_airport' ? 'L' : 'M']);
}
writeFileSync('src/renderer/data/airports.json', JSON.stringify({ source: 'OurAirports (public domain), ourairports.com', fields: ['icao', 'iata', 'name', 'lat', 'lon', 'elevationFt', 'country', 'city', 'size'], airports: out }));
console.log(`wrote ${out.length} airports`);
