// Builds src/renderer/data/places.json from Natural Earth populated places
// (public domain). Usage: node scripts/build-places.mjs <ne_10m_populated_places_simple.geojson>
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const f of src.features) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  out.push([String(p.name), String(p.adm1name ?? ''), String(p.adm0name ?? ''), Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, Number(p.pop_max) || 0]);
}
out.sort((a, b) => b[5] - a[5]);
writeFileSync('src/renderer/data/places.json', JSON.stringify({ source: 'Natural Earth 10m populated places (public domain), naturalearthdata.com', fields: ['name', 'admin1', 'country', 'lat', 'lon', 'population'], places: out }));
console.log(`wrote ${out.length} places`);
