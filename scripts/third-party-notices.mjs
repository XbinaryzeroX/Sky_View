// Generates THIRD_PARTY_NOTICES.md from the production dependency tree,
// including each package's license text. Run before packaging.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const seen = new Map();

function resolvePkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function walk(name, fromDir) {
  const dir = resolvePkgDir(name, fromDir);
  if (!dir) return;
  const p = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const key = `${p.name}@${p.version}`;
  if (seen.has(key)) return;
  const licFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  seen.set(key, {
    name: p.name,
    version: p.version,
    license: typeof p.license === 'string' ? p.license : (p.license?.type ?? 'UNKNOWN'),
    homepage: p.homepage ?? (typeof p.repository === 'string' ? p.repository : p.repository?.url) ?? '',
    text: licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : '',
  });
  for (const dep of Object.keys(p.dependencies ?? {})) walk(dep, dir);
}

for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, root);

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const out = [
  '# Third-party notices',
  '',
  'Atlas Watch includes the open-source software listed below. The Electron runtime (MIT) and the Chromium',
  'components it embeds are distributed with the packaged app. Their license files (`LICENSE.electron.txt`,',
  '`LICENSES.chromium.html`) sit next to the executable.',
  '',
  'CesiumJS bundles additional third-party components, which are listed in the CesiumJS license text below.',
  '',
  '## Data and map content',
  '',
  '| Content | Source | Terms |',
  '|---|---|---|',
  '| Weather alerts | U.S. National Weather Service / NOAA, api.weather.gov | U.S. government work; NWS says the data is free to use for any purpose. Rate limits apply. |',
  '| Earthquakes | U.S. Geological Survey Earthquake Hazards Program GeoJSON feeds | U.S. government work in the public domain. Credit: U.S. Geological Survey. |',
  '| Shaded-relief globe surface | Natural Earth II, bundled with CesiumJS | Natural Earth: public domain |',
  '| Country boundaries | Natural Earth via `world-atlas` | Data: public domain; package: ISC |',
  '| U.S. state boundaries | U.S. Census Bureau cartographic boundary files via `us-atlas` | Data: U.S. government work; package: ISC |',
  '| Global imagery tiles (fetched) | NASA GIBS (Blue Marble Shaded Relief + Bathymetry, VIIRS) | NASA open data; attribution requested |',
  '| U.S. imagery and topo tiles (fetched) | USGS The National Map | Public domain |',
  '| Streets, places, buildings (fetched) | OpenFreeMap vector tiles, OpenMapTiles schema | Data © OpenStreetMap contributors (ODbL 1.0); © OpenMapTiles; OpenFreeMap free incl. commercial use; attribution required |',
  '| Terrain (fetched) | Terrain Tiles on AWS (Mapzen/Tilezen) | Open data; attribution: USGS 3DEP/NED, SRTM, GMTED2010, ETOPO1, Copernicus EU-DEM (produced using Copernicus data funded by the EU), and others per https://github.com/tilezen/joerd/blob/master/docs/attribution.md |',
  '| Aircraft (fetched) | adsb.lol | ODbL 1.0 |',
  '| Vessels, Finnish cameras (fetched) | Fintraffic / digitraffic.fi | CC BY 4.0 |',
  '| Satellite elements (fetched) | CelesTrak | U.S. government-origin; CelesTrak usage policy |',
  '| Fires, perimeters, airspace, METAR, cyclones, radar, address search (fetched) | NASA FIRMS, NIFC WFIGS, FAA, NOAA AWC/NHC/nowCOAST, U.S. Census | Public domain / NASA open data |',
  '| California cameras (fetched) | Caltrans | Public agency publication |',
  '| Boston transit (fetched) | MBTA | MassDOT/MBTA developer license |',
  '| Bundled place names | Natural Earth populated places | Public domain |',
  '| Bundled airports | OurAirports (ourairports.com) | Public domain |',
  '| Optional imagery (customer credentials) | Esri World Imagery, Mapbox Satellite, EOX Sentinel-2 cloudless, Google Photorealistic 3D Tiles | Each provider’s terms; metered or licensed; never bundled |',
  '',
  '## Packages',
  '',
  '| Package | Version | License |',
  '|---|---|---|',
  ...entries.map((e) => `| ${e.name} | ${e.version} | ${e.license} |`),
  '',
  '## License texts',
  '',
  ...entries.flatMap((e) => [`### ${e.name}@${e.version} (${e.license})`, '', e.homepage ? `Source: ${e.homepage}` : '', '', '```', e.text || '(no license file shipped in package; see package metadata)', '```', '']),
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out.join('\n'));
const unusual = entries.filter((e) => !/^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|\(MPL-2\.0 OR Apache-2\.0\)|BlueOak-1\.0\.0)$/.test(e.license));
console.log(`wrote THIRD_PARTY_NOTICES.md with ${entries.length} packages`);
if (unusual.length) console.log('Review licenses:', unusual.map((e) => `${e.name}@${e.version}: ${e.license}`).join(', '));
