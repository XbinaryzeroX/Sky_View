// Builds src/main/data/infrastructure.json (data centres; dams and hydropower plants) from the OpenStreetMap-derived
// extracts published in God's Eye View's repository (src/data/local_data/{datacenters,dams}/, ODbL 1.0).
// Usage: node scripts/build-infrastructure.mjs <path to that local_data folder>
//
// Each feature is reduced to its OSM identity, one point (the centre of its mapped outline, or the point itself) and a
// few descriptive tags. Contact details, notes, fixme and every other tag are dropped. The output remains a derived
// database under ODbL 1.0: keep the attribution in src/main/data/INFRASTRUCTURE_ATTRIBUTION.txt with it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/build-infrastructure.mjs <local_data folder>');

const KEEP = {
  datacenter: ['name', 'operator', 'owner', 'start_date', 'building:levels', 'height'],
  dam: ['name', 'operator', 'start_date', 'height', 'plant:source', 'plant:output:electricity', 'waterway', 'power'],
};

/** Area-weighted centre of the outer ring(s); the vertex mean for lines; the point itself for points. */
function centre(g) {
  const ringCentre = (ring) => {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) < 1e-18) return { lon: ring.reduce((s, p) => s + p[0], 0) / ring.length, lat: ring.reduce((s, p) => s + p[1], 0) / ring.length, w: 0 };
    return { lon: x / (3 * a), lat: y / (3 * a), w: Math.abs(a) };
  };
  const mean = (pts) => ({ lon: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length });
  switch (g?.type) {
    case 'Point': return { lon: g.coordinates[0], lat: g.coordinates[1] };
    case 'Polygon': return ringCentre(g.coordinates[0]);
    case 'MultiPolygon': {
      const parts = g.coordinates.map((p) => ringCentre(p[0]));
      const w = parts.reduce((s, p) => s + p.w, 0);
      return w ? { lon: parts.reduce((s, p) => s + p.lon * p.w, 0) / w, lat: parts.reduce((s, p) => s + p.lat * p.w, 0) / w } : parts[0];
    }
    case 'LineString': return mean(g.coordinates);
    case 'MultiLineString': return mean(g.coordinates.flat());
    default: return null;
  }
}

const out = { built: new Date().toISOString().slice(0, 10), source: {}, fields: ['osmType', 'osmId', 'lat', 'lon', 'tags'], datacenter: [], dam: [] };
for (const [kind, file] of [['datacenter', 'datacenters/datacenters.geojsonl'], ['dam', 'dams/dams.geojsonl']]) {
  const text = readFileSync(join(root, file), 'utf8');
  out.source[kind] = { file, sha256: createHash('sha256').update(text).digest('hex') };
  let skipped = 0;
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    const c = centre(f.geometry);
    const id = Number(f.properties?.osm_id ?? f.id);
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180 || !Number.isSafeInteger(id) || id === 0) { skipped++; continue; }
    // Negative ids in these extracts are OSM relations (PostGIS convention); positive ids are ways or nodes.
    const osmType = id < 0 ? 'relation' : f.geometry.type === 'Point' ? 'node' : 'way';
    const key = `${osmType}/${Math.abs(id)}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const tags = {};
    for (const k of KEEP[kind]) {
      const v = f.properties?.tags?.[k];
      if (typeof v === 'string' && v.trim() && !/@|\+?\d[\d\s()-]{7,}/.test(v)) tags[k] = v.trim().slice(0, 120);
    }
    out[kind].push([osmType, Math.abs(id), Math.round(c.lat * 1e5) / 1e5, Math.round(c.lon * 1e5) / 1e5, tags]);
  }
  out.source[kind].count = out[kind].length;
  out.source[kind].skipped = skipped;
}
mkdirSync('src/main/data', { recursive: true });
writeFileSync('src/main/data/infrastructure.json', JSON.stringify(out));
console.log(`wrote ${out.datacenter.length} data centres, ${out.dam.length} dams (skipped ${out.source.datacenter.skipped} + ${out.source.dam.skipped})`);
