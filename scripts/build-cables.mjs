// Builds src/main/data/cables.json (telecommunication cables mapped in OpenStreetMap) from one Overpass API reply.
// Usage: node scripts/build-cables.mjs <overpass reply .json>
//
// The reply comes from this query, sent once to https://overpass-api.de/api/interpreter (ODbL 1.0 data):
//   [out:json][timeout:240][maxsize:536870912];
//   (way["communication"="line"]["submarine"="yes"];
//    way["communication"="line"]["location"~"^(underwater|underground)$"];
//    way["seamark:type"="cable_submarine"]["seamark:cable_submarine:category"~"fibre|optic|telephone|telegraph"];);
//   out tags geom;
//
// Each way keeps its OSM id, whether it is under water or under ground, its name, operator and medium, and its mapped
// vertices rounded to five decimals (about 1 m). Every other tag is dropped. Nothing is added: a cable that
// OpenStreetMap maps only near the shore stays that short. The output is a derived database under ODbL 1.0; keep
// src/main/data/INFRASTRUCTURE_ATTRIBUTION.txt with it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/build-cables.mjs <overpass reply .json>');
const raw = readFileSync(input);
const reply = JSON.parse(raw.toString('utf8'));

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : null);
const round = (v) => Math.round(v * 1e5) / 1e5;

const cables = [];
let skipped = 0;
const counts = { submarine: 0, underground: 0 };
for (const el of reply.elements ?? []) {
  if (el?.type !== 'way' || !Number.isSafeInteger(el.id) || !Array.isArray(el.geometry)) { skipped++; continue; }
  const t = el.tags ?? {};
  const kind = t.submarine === 'yes' || t.location === 'underwater' || t['seamark:type'] === 'cable_submarine' ? 'submarine' : 'underground';
  const flat = [];
  for (const p of el.geometry) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    const lon = round(p.lon), lat = round(p.lat);
    if (flat.length >= 2 && flat[flat.length - 2] === lon && flat[flat.length - 1] === lat) continue;
    flat.push(lon, lat);
  }
  if (flat.length < 4) { skipped++; continue; }
  counts[kind]++;
  cables.push([el.id, kind, text(t.name) ?? text(t['seamark:cable_submarine:name']) ?? text(t['seamark:name']), text(t.operator), text(t['telecom:medium']) ?? text(t['seamark:cable_submarine:category']), flat]);
}
cables.sort((a, b) => a[0] - b[0]);

const out = {
  built: new Date().toISOString().slice(0, 10),
  osmBase: typeof reply.osm3s?.timestamp_osm_base === 'string' ? reply.osm3s.timestamp_osm_base : null,
  source: { sha256: createHash('sha256').update(raw).digest('hex'), ways: (reply.elements ?? []).length, skipped, ...counts },
  fields: ['osmWayId', 'kind', 'name', 'operator', 'medium', 'lonLatPairs'],
  cables,
};
writeFileSync(new URL('../src/main/data/cables.json', import.meta.url), JSON.stringify(out));
console.log(`cables.json: ${cables.length} ways (${counts.submarine} under water, ${counts.underground} under ground), ${skipped} skipped, OSM data as of ${out.osmBase}`);
