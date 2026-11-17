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
  '| German weather warnings (fetched) | [Deutscher Wetterdienst](https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/) | © Deutscher Wetterdienst, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original German bulletin text. Atlas Watch converts CAP coordinates and exclusions to GeoJSON and selects unexpired public warnings. |',
  '| Earthquakes | U.S. Geological Survey Earthquake Hazards Program GeoJSON feeds | U.S. government work in the public domain. Credit: U.S. Geological Survey. |',
  '| Shaded-relief globe surface | Natural Earth II, bundled with CesiumJS | Natural Earth: public domain |',
  '| Country boundaries | Natural Earth via `world-atlas` | Data: public domain; package: ISC |',
  '| U.S. state boundaries | U.S. Census Bureau cartographic boundary files via `us-atlas` | Data: U.S. government work; package: ISC |',
  '| Global imagery tiles (bundled overview and fetched imagery) | [Blue Marble, August 2004, Shaded Relief and Bathymetry](https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/BlueMarble_ShadedRelief_Bathymetry.json), MODIS / NASA Earth Observatory via NASA GIBS. VIIRS imagery is fetched separately. | [NASA imagery usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). The packaged overview is reprojected, tiled and downsampled for display. |',
  '| U.S. imagery and topo tiles (fetched) | USGS The National Map | Public domain |',
  '| Streets, places, buildings (fetched) | OpenFreeMap vector tiles, OpenMapTiles schema | Data © OpenStreetMap contributors (ODbL 1.0); © OpenMapTiles; OpenFreeMap free incl. commercial use; attribution required |',
  '| Terrain (fetched) | Terrain Tiles on AWS (Mapzen/Tilezen) | Open data; attribution: USGS 3DEP/NED, SRTM, GMTED2010, ETOPO1, Copernicus EU-DEM (produced using Copernicus data funded by the EU), and others per https://github.com/tilezen/joerd/blob/master/docs/attribution.md |',
  '| Continental terrain (bundled) | [NOAA ETOPO1](https://doi.org/10.7289/V5C8276M) via the [Mapzen Terrain Tiles dataset](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md) | Zoom-2 Terrarium elevations have been decoded and rounded to metres. The original source and checksum are recorded in terrain/ATTRIBUTION.txt. |',
  '| Coastal satellite imagery (fetched) | [ESA WorldCover Sentinel-2 annual true-colour composites](https://esa-worldcover.org/en/data-access) | © ESA WorldCover project 2020 and 2021. Contains modified Copernicus Sentinel data from the respective year processed by the ESA WorldCover consortium. CC BY 4.0. |',
  '| Ocean imagery (bundled) | [ESA Ocean Colour Climate Change Initiative](https://www.oceancolour.org/), NASA GIBS Terra/MODIS | Atlas Watch composites the 2020 and 2021 optical observations for display. Source URLs, observation dates, producer acknowledgements and checksums are in optical-water/SOURCES.json. |',
  '| City lights (bundled and fetched) | [NASA Black Marble, Earth at Night](https://science.nasa.gov/earth/earth-observatory/earth-at-night/) | NASA Earth Observatory, VIIRS on Suomi NPP, 2016 composite. The night view uses the selected time to control illumination. |',
  '| Star background (bundled) | [Yale Bright Star Catalog, Hoffleit and Warren, via NASA HEASARC](https://heasarc.gsfc.nasa.gov/W3Browse/catalog/bsc5p.html) | Atlas Watch rendered measured positions, magnitudes and approximate colours. See star-sky/ATTRIBUTION.txt. |',
  '| Aircraft (fetched) | adsb.lol | ODbL 1.0 |',
  '| Aircraft type designators and geometry categories (bundled) | [FAA Order JO 7360.1K, Appendix A](https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf) | Federal Aviation Administration. The app uses designator and configuration data to select representative geometry. |',
  '| Aircraft and vessel 3D artwork (bundled) | [Sketchfab](https://sketchfab.com/) | Individual creators and source pages are listed in the renderer’s vehicle-models/ATTRIBUTION.txt and on each licensed preview. The bundled models use CC BY 4.0. |',
  '| Conflict assessments and humanitarian reports (fetched) | [Council on Foreign Relations](https://www.cfr.org/global-conflict-tracker/dashboard), [ReliefWeb](https://reliefweb.int/) and [UN News](https://news.un.org/) | Assessments and publications are attributed and linked to the publisher. Publication and retrieval times are shown where provided. |',
  '| Aircraft type photographs (bundled) | [Air Nostrum CRJ1000 EC-MJQ](https://commons.wikimedia.org/wiki/File:EC-MJQ_CRJ1000_Air_Nostrum_MAD.jpg) by Bene Riobó and [Lufthansa A320neo](https://commons.wikimedia.org/wiki/File:Lufthansa_Airbus_A320neo.jpg) by Paul Schmid | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The included photographs were resized and encoded as WebP. These versions use the same license. |',
  '| Vessels, Finnish cameras (fetched) | Fintraffic / digitraffic.fi | CC BY 4.0 |',
  '| Satellite elements (fetched) | CelesTrak | U.S. government-origin; CelesTrak usage policy |',
  '| Fire perimeters (fetched) | [NIFC WFIGS Current Interagency Fire Perimeters](https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824). Contributors include DOI/IRWIN, USDA Forest Service, NPS, USFWS, BIA, BLM, NASF, USFA and NWCG. | Public dataset. NIFC identifies limits on accuracy, completeness and legal use. The app requests generalized geometry for display. |',
  '| Fire detections, airspace, METAR, cyclones, radar, lightning density, address search (fetched) | NASA FIRMS, FAA, NOAA AWC/NHC/nowCOAST, U.S. Census | Public domain / NASA open data |',
  '| Weather-satellite frames, Europe, Africa, Indian Ocean (fetched) | EUMETSAT View Service (Meteosat 0° and IODC), hourly frames | © EUMETSAT; hourly imagery not subject to licensing per EUMETSAT |',
  '| Traffic flow (fetched) | NYC DOT (NYC Open Data); Fintraffic / digitraffic.fi; Transport Department, Hong Kong SAR (DATA.GOV.HK); Ayuntamiento de Madrid; Ville de Paris | NYC Open Data terms; CC BY 4.0; DATA.GOV.HK terms; Madrid open data terms; ODbL 1.0 |',
  '| Wind forecast (fetched) | NOAA Global Forecast System via the NOAA Open Data Dissemination program on AWS | U.S. government work, public domain |',
  '| Space launches (fetched) | The Space Devs Launch Library 2 | Free use with courtesy attribution; no guarantee of completeness |',
  '| GPS accuracy cells (calculated) | Aircraft-reported quality fields from adsb.lol; cell score after gpsjam.org | adsb.lol: ODbL 1.0 |',
  '| Flight paths on request (fetched) | OpenSky Network | OpenSky terms of use (non-commercial without an agreement) |',
  '| Train positions (fetched) | MTA, SEPTA, MDOT MTA, Translink Queensland, Fintraffic, Renfe, Entur, KTMB (data.gov.my), Toyama tramways (gtfs-data.jp) | Operator terms; CC BY 4.0, NLOD 2.0 or CC0 where stated |',
  '| Bike-share stations (fetched) | Citi Bike, Divvy, Capital Bikeshare, Bay Wheels, Bluebikes (Lyft); Oslo, Bergen, Trondheim Bysykkel; AMBici | Lyft Data License Agreements; NLOD 2.0; CC0 |',
  '| Wildlife sightings (fetched) | iNaturalist contributors | CC0, CC BY 4.0 or CC BY-SA 4.0 per record (only these are requested) |',
  '| Air quality, Canada (fetched) | Environment and Climate Change Canada | ECCC Data Servers End-use Licence |',
  '| News-reported violence (fetched) | The GDELT Project | Free use with citation; linked articles belong to their publishers |',
  '| Street-level photos (fetched) | KartaView contributors; Panoramax contributors | KartaView CC BY-SA 4.0; Panoramax per picture |',
  '| Data centres, dams and hydropower plants (bundled) | © OpenStreetMap contributors; dams via Open Infrastructure Map; extract from God’s Eye View | ODbL 1.0. The bundled infrastructure.json is a derived database under ODbL 1.0 (share-alike applies to it). |',
  '| California cameras (fetched) | Caltrans | Public agency publication |',
  '| Boston transit (fetched) | MBTA | MassDOT/MBTA developer license |',
  '| Bundled place names | Natural Earth populated places | Public domain |',
  '| Bundled airports | OurAirports (ourairports.com) | Public domain |',
  '| Transit vehicle positions (fetched) | 36 operators listed in `src/shared/transitFeeds.ts` and the README sources table; feed list adapted from the God’s Eye View project (MIT) | Per operator (CC BY 4.0, CC0, ODbL, Licence Ouverte 2.0, NLOD, Open Government Licences, operator developer terms) |',
  '| Bundled ATC frequencies | OurAirports (ourairports.com) | Public domain |',
  '| Optional passenger flight status | [AeroDataBox direct API](https://aerodatabox.com/api-spec) | [Subscription terms](https://aerodatabox.com/terms). Customer key, one explicit Tier 2 query. No provider status data is bundled. |',
  '| Passenger airline callsign routes | [Virtual Radar Server standing data](https://github.com/vradarserver/standing-data/tree/57c9d605a36ef1ec5d6e0f48c2d0700002e582d2/routes) with [OurAirports](https://github.com/davidmegginson/ourairports-data/tree/97afc8b3ee4711d70199fda73bdd66df9fd58cb8) scheduled-service airports | [CC0 1.0](https://github.com/vradarserver/standing-data/blob/57c9d605a36ef1ec5d6e0f48c2d0700002e582d2/LICENSE) (Virtual Radar Server), public domain (OurAirports) |',
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
  '## Adapted source code',
  '',
  '### God’s Eye View (MIT)',
  '',
  'Source: https://github.com/bilawalsidhu/gods-eye-view (src/layers/gnss/records.js). The GPS accuracy classifier, cell window and',
  'aggregation in src/shared/gnssIntegrity.ts are ported from it to TypeScript. No name, logo, artwork or data from that project is used.',
  '',
  '```',
  'MIT License',
  '',
  'Copyright (c) 2026 Bilawal Sidhu',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software and associated documentation files (the "Software"), to deal',
  'in the Software without restriction, including without limitation the rights',
  'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
  'copies of the Software, and to permit persons to whom the Software is',
  'furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included in all',
  'copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
  'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
  'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
  'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  'SOFTWARE.',
  '```',
  '',
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out.join('\n'));
const unusual = entries.filter((e) => !/^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|\(MPL-2\.0 OR Apache-2\.0\)|BlueOak-1\.0\.0)$/.test(e.license));
console.log(`wrote THIRD_PARTY_NOTICES.md with ${entries.length} packages`);
if (unusual.length) console.log('Review licenses:', unusual.map((e) => `${e.name}@${e.version}: ${e.license}`).join(', '));
