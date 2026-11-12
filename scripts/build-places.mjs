// Natural Earth populated places (public domain), with an explicit local-only alias build.
// Original base build: node scripts/build-places.mjs <ne_10m_populated_places_simple.geojson>
// Verified aliases: node scripts/build-places.mjs --aliases <downloaded-5.1.2-full.zip> [--check]
// The checked-in source manifest gives a fresh-fetch/hash-check command; no vendored ZIP is required.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, unzipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'src/renderer/data/places.json');
const manifestPath = join(root, 'scripts/places-source-manifest.json');
const SOURCE_URL = 'https://naturalearth.s3.amazonaws.com/5.1.2/10m_cultural/ne_10m_populated_places.zip';
const SOURCE_SHA256 = 'cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b';
const FIRST_SIX_SHA256 = '04d508accdcc587d1f813bbad75d9be7196fe180507759586a80f9b92616c146';
const BASE_FIELDS = ['name', 'admin1', 'country', 'lat', 'lon', 'population'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

if (process.argv[2] === '--aliases') {
  const path = process.argv[3]; assert(path, 'Supply the archived official Natural Earth5.1.2 full ZIP. No download occurs in this generator.');
  const bytes = readFileSync(path); assert(bytes.length <= 4 * 1024 * 1024 && hash(bytes) === SOURCE_SHA256, 'Input does not match the reviewed official Natural Earth5.1.2 archive hash.');
  const zip = unzipSync(bytes), stem = 'ne_10m_populated_places';
  const text = name => new TextDecoder('utf-8', { fatal: true }).decode(zip[stem + name]);
  assert(text('.VERSION.txt').trim() === '5.1.2', 'Unexpected Natural Earth version.');
  assert(text('.cpg').trim().toUpperCase() === 'UTF-8', 'Expected publisher-declared UTF-8.');
  assert(text('.prj').includes('WGS_1984'), 'Unexpected source coordinate reference system.');
  const dbf = Buffer.from(zip[stem + '.dbf']), shp = Buffer.from(zip[stem + '.shp']);
  const { records, fields } = readDbf(dbf), points = readPointShapefile(shp);
  assert(records.length === 7342 && points.length === records.length, 'Expected all7,342 publisher point records.');
  const languageFields = fields.filter(name => /^NAME_[A-Z]+$/.test(name));
  assert(languageFields.length === 26, 'Unexpected multilingual field set; re-review before generating.');
  const aliasFields = ['NAMEPAR', 'NAMEALT', 'NAMEASCII', ...languageFields];
  const sourceRows = new Map(), neIds = new Set();
  for (let i = 0; i < records.length; i++) {
    const row = records[i], point = points[i];
    const neId = Number(row.NE_ID); assert(Number.isSafeInteger(neId) && neId > 0 && !neIds.has(neId), 'Publisher NE_ID missing or duplicated.'); neIds.add(neId);
    // The original catalog generator consumed six-decimal GeoJSON and then rounded to four.
    // Match the actual SHP geometry, not the separate legacy LATITUDE/LONGITUDE attributes.
    const tuple = [row.NAME, row.ADM1NAME, row.ADM0NAME, catalogCoordinate(point.lat), catalogCoordinate(point.lon), Number(row.POP_MAX) || 0];
    const key = JSON.stringify(tuple); assert(!sourceRows.has(key), 'Ambiguous exact publisher identity/coordinate tuple.');
    sourceRows.set(key, { row, point, neId });
  }
  const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
  const firstSix = previous.places.map(row => row.slice(0, 6));
  assert(firstSix.length === 7342 && hash(JSON.stringify(firstSix)) === FIRST_SIX_SHA256, 'Existing names/admin/countries/coordinates/populations/order changed; refusing positional or fuzzy matching.');
  const rowNeIds = [], counts = Object.fromEntries(aliasFields.map(field => [field, 0]));
  let directCoordinateMatches = 0, geoJsonQuantizationMatches = 0, excludedMissingSentinels = 0;
  const places = firstSix.map(tuple => {
    const match = sourceRows.get(JSON.stringify(tuple)); assert(match, `No exact publisher match for ${tuple[0]}, ${tuple[1]}, ${tuple[2]}.`);
    rowNeIds.push(match.neId);
    if (roundFour(match.point.lat) === tuple[3] && roundFour(match.point.lon) === tuple[4]) directCoordinateMatches++;
    else geoJsonQuantizationMatches++;
    const aliases = [], seen = new Set([tuple[0]]);
    for (const field of aliasFields) {
      const name = match.row[field];
      if (!name || seen.has(name)) continue;
      if (/^-99(?:\.0+)?$|^null$/i.test(name)) { excludedMissingSentinels++; continue; }
      assert(!/\p{Cc}/u.test(name), `Unexpected control characters in ${field}.`);
      seen.add(name); aliases.push(name); counts[field]++;
    }
    return aliases.length ? [...tuple, aliases] : tuple;
  });
  assert(new Set(rowNeIds).size === 7342, 'More than one catalog row resolved to one publisher feature.');
  assert(JSON.stringify(places.map(row => row.slice(0, 6))) === JSON.stringify(firstSix), 'Base tuple values/order changed.');
  const catalog = { source: previous.source, fields: [...BASE_FIELDS, 'aliases'], places,
    aliasSource: { version: '5.1.2', url: SOURCE_URL, sha256: SOURCE_SHA256 } };
  const output = JSON.stringify(catalog), outputBytes = Buffer.from(output);
  const manifest = {
    source: 'Natural Earth1:10m populated places, full dataset', version: '5.1.2', url: SOURCE_URL,
    productPage: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/',
    license: 'Public domain', terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
    archive: { sha256: SOURCE_SHA256, bytes: bytes.length, lastModified: '2022-05-13T23:16:31.000Z' },
    files: Object.fromEntries(['.dbf', '.shp', '.cpg', '.prj', '.VERSION.txt'].map(extension => [stem + extension, { bytes: zip[stem + extension].length, sha256: hash(zip[stem + extension]) }])),
    generation: { command: 'node scripts/build-places.mjs --aliases <downloaded-5.1.2-full.zip>', checkCommand: 'node scripts/build-places.mjs --aliases <downloaded-5.1.2-full.zip> --check',
      freshFetchAndCheckPowerShell: [
        "$placeArchive = Join-Path ([IO.Path]::GetTempPath()) 'ne_10m_populated_places-5.1.2.zip'",
        `Invoke-WebRequest -Uri '${SOURCE_URL}' -OutFile $placeArchive`,
        `if ((Get-FileHash -LiteralPath $placeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${SOURCE_SHA256}') { throw 'Natural Earth source hash mismatch' }`,
        'node scripts/build-places.mjs --aliases $placeArchive --check',
      ],
      bootstrap: 'The checked-in catalog supplies the original six-field rows. Its protected tuple hash is verified before any alias generation; a separate base-catalog input, existing TEMP file or record-position guess is not needed.',
      scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))) },
    matching: { rows: firstSix.length, directCoordinateMatches, exactSixThenFourDecimalMatches: geoJsonQuantizationMatches, unmatched: 0, ambiguous: 0,
      firstSixTupleSha256: FIRST_SIX_SHA256, rule: 'Exact NAME, ADM1NAME, ADM0NAME, population and actual SHP geometry rounded6→4decimals; no nearest-coordinate or row-order join. All first six existing values and their order are retained.',
      dbfGeometryAssociation: 'Point SHP record number aligns with its DBF attribute record by the shapefile format. Catalog association is then an exact tuple join, not that record position.',
      geometryNote: 'DBF LATITUDE/LONGITUDE can differ from actual SHP points and are not used to match or move catalog coordinates.' },
    aliases: { fields: aliasFields, languageFields: languageFields.length, excludedMissingSentinels, policy: 'Publisher strings retained verbatim after DBF padding trim, exact-string duplicates and the primary name omitted. Missing-value -99/null sentinels are omitted; control characters fail generation. No generated translations, transliterations, folding, country/admin aliases or punctuation splitting. Compound NAMEALT remains one publisher string.',
      rowsWithAliases: places.filter(row => row.length === 7).length, total: places.reduce((n, row) => n + (row[6]?.length ?? 0), 0), maxPerRow: Math.max(...places.map(row => row[6]?.length ?? 0)), firstContributingFieldCounts: counts },
    output: { path: 'src/renderer/data/places.json', fields: catalog.fields, bytes: outputBytes.length, gzipBytes: gzipSync(outputBytes).length, sha256: hash(outputBytes) },
    rowNeIds,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    assert(readFileSync(outputPath, 'utf8') === output, 'Generated catalog differs from the checked-in output.');
    assert(readFileSync(manifestPath, 'utf8') === manifestText, 'Generated source manifest differs from the checked-in evidence.');
    console.log(`verified ${places.length} unchanged base rows and ${manifest.aliases.total} original publisher aliases`);
  } else {
    writeFileSync(outputPath, output); writeFileSync(manifestPath, manifestText);
    console.log(JSON.stringify({ rows: places.length, aliases: manifest.aliases.total, bytes: outputBytes.length, gzipBytes: manifest.output.gzipBytes, unmatched: 0, ambiguous: 0, sha256: manifest.output.sha256 }));
  }
} else {
  // Preserve the original explicit base-catalog generation workflow.
  const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const f of src.features) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  if (!p.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  out.push([String(p.name), String(p.adm1name ?? ''), String(p.adm0name ?? ''), Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, Number(p.pop_max) || 0]);
}
out.sort((a, b) => b[5] - a[5]);
writeFileSync(outputPath, JSON.stringify({ source: 'Natural Earth 10m populated places (public domain), naturalearthdata.com', fields: BASE_FIELDS, places: out }));
console.log(`wrote ${out.length} places`);
}

function roundFour(value) { return Math.round(value * 1e4) / 1e4; }
function catalogCoordinate(value) { return Math.round(Math.round(value * 1e6) / 1e6 * 1e4) / 1e4; }
function readDbf(bytes) {
  assert(bytes.length >= 33, 'Truncated DBF header.');
  const count = bytes.readUInt32LE(4), header = bytes.readUInt16LE(8), width = bytes.readUInt16LE(10);
  assert(count === 7342 && header + count * width <= bytes.length, 'Invalid DBF record bounds.');
  const fields = []; let offset = 1;
  for (let at = 32; at < header && bytes[at] !== 13; at += 32) {
    const name = bytes.subarray(at, at + 11).toString('ascii').replace(/\0.*$/s, '');
    const length = bytes[at + 16]; assert(/^[A-Z0-9_]+$/.test(name) && length > 0, 'Unsupported DBF field.');
    fields.push({ name, offset, length }); offset += length;
  }
  assert(offset === width, 'DBF field widths do not match the record width.');
  const decoder = new TextDecoder('utf-8', { fatal: true }), records = [];
  for (let i = 0; i < count; i++) {
    const start = header + i * width; assert(bytes[start] === 32, 'Deleted or unsupported DBF record.');
    const row = {};
    for (const field of fields) row[field.name] = decoder.decode(bytes.subarray(start + field.offset, start + field.offset + field.length)).trim();
    records.push(row);
  }
  return { records, fields: fields.map(field => field.name) };
}
function readPointShapefile(bytes) {
  assert(bytes.length >= 100 && bytes.readInt32BE(0) === 9994 && bytes.readInt32BE(24) * 2 === bytes.length && bytes.readInt32LE(28) === 1000 && bytes.readInt32LE(32) === 1, 'Invalid Point shapefile header.');
  const points = [];
  for (let at = 100; at < bytes.length;) {
    assert(at + 28 <= bytes.length && bytes.readInt32BE(at) === points.length + 1 && bytes.readInt32BE(at + 4) === 10 && bytes.readInt32LE(at + 8) === 1, 'Unsupported point record.');
    const lon = bytes.readDoubleLE(at + 12), lat = bytes.readDoubleLE(at + 20);
    assert(Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90, 'Invalid WGS84 point geometry.');
    points.push({ lon, lat }); at += 28;
  }
  return points;
}
