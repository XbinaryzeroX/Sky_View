// Builds src/renderer/data/gibsCatalog.json from NASA GIBS' WMTS capabilities
// (EPSG:3857 "best"). Only products listed below are included, and each entry's
// tile matrix set, format, time range and legend come from the capabilities
// document, not from hand-typed values.
//
// Usage: node scripts/build-gibs-catalog.mjs [path-to-WMTSCapabilities.xml]
// (without a path the document is downloaded from gibs.earthdata.nasa.gov).
import { readFileSync, writeFileSync } from 'node:fs';

const PRODUCTS = [
  ['True color', 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'Natural-color daily mosaic; clouds and swath gaps are visible as published.'],
  ['True color', 'MODIS_Terra_CorrectedReflectance_TrueColor', 'Natural-color daily mosaic (morning overpass).'],
  ['False color', 'MODIS_Terra_CorrectedReflectance_Bands721', 'Bands 7-2-1: burn scars red-brown, water dark, vegetation green, snow/ice cyan.'],
  ['False color', 'VIIRS_SNPP_CorrectedReflectance_BandsM11-I2-I1', 'Bands M11-I2-I1: similar to 7-2-1 at higher resolution.'],
  ['Nighttime', 'VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', 'Night-time light and moonlit clouds as observed by the Day/Night Band.'],
  ['Nighttime', 'VIIRS_Black_Marble', 'Annual composite of night lights (not a single night).'],
  ['Temperature', 'MODIS_Terra_Land_Surface_Temp_Day', 'Satellite-retrieved land surface (skin) temperature, daytime; not air temperature.'],
  ['Temperature', 'AIRS_L3_Surface_Air_Temperature_Daily_Day', 'Retrieved near-surface air temperature, daily daytime pass, coarse resolution.'],
  ['Temperature', 'MODIS_Terra_Cloud_Top_Temp_Day', 'Temperature at the top of clouds.'],
  ['Vegetation', 'MODIS_Terra_NDVI_8Day', 'Normalized Difference Vegetation Index, rolling 8-day composite.'],
  ['Vegetation', 'MODIS_Terra_EVI_8Day', 'Enhanced Vegetation Index, rolling 8-day composite.'],
  ['Atmosphere', 'MODIS_Terra_Aerosol', 'Aerosol optical depth (haze, smoke, dust) over land and ocean.'],
  ['Atmosphere', 'OMPS_Aerosol_Index', 'UV aerosol index: absorbing aerosols such as smoke and dust.'],
  ['Fire', 'MODIS_Terra_CorrectedReflectance_Bands721', 'Use with the Active fire detections data layer (FIRMS) for detections; burn scars appear red-brown here.'],
  ['Water / ice', 'MODIS_Terra_NDSI_Snow_Cover', 'Snow cover from the Normalized Difference Snow Index (daily; clouds hide the surface).'],
  ['Precipitation', 'IMERG_Precipitation_Rate', 'Satellite precipitation rate estimate (IMERG), half-hourly product shown per day.'],
  ['Land', 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', 'Annual land-cover classification (IGBP classes).'],
  ['Land', 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture', 'Model-assimilated root-zone soil moisture (analysis, not a direct observation).'],
  ['Ocean', 'GHRSST_L4_MUR_Sea_Surface_Temperature', 'Gap-filled analysis of sea surface temperature (L4).'],
  ['Ocean', 'MODIS_Aqua_L2_Chlorophyll_A', 'Ocean chlorophyll-a concentration (L2 swaths; gaps under clouds).'],
  ['Gravity', 'GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI', 'Monthly change in total water storage inferred from gravity (GRACE/GRACE-FO), relative to a 2004–2009 baseline; coarse (~300 km).'],
  ['Air quality', 'AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day', 'Carbon monoxide at 500 hPa (mid-troposphere), not ground-level air quality.'],
  ['Air quality', 'MODIS_Combined_Value_Added_AOD', 'Aerosol optical depth (combined Terra/Aqua); a proxy for particulate haze, not PM2.5.'],
];

const src = process.argv[2];
const xml = src ? readFileSync(src, 'utf8') : await (await fetch('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml')).text();
const layers = xml.split('<Layer>').slice(1);
const out = [];
for (const [category, id, note] of PRODUCTS) {
  const l = layers.find((s) => s.includes(`<ows:Identifier>${id}</ows:Identifier>`));
  if (!l) {
    console.warn('missing', id);
    continue;
  }
  const tms = l.match(/<TileMatrixSet>([^<]+)</)?.[1];
  const format = l.match(/<Format>([^<]+)</)?.[1];
  const title = l.match(/<ows:Title[^>]*>([^<]+)</)?.[1]?.trim();
  const def = l.match(/<Default>([^<]+)</)?.[1];
  const values = [...l.matchAll(/<Value>([^<]+)</g)].map((m) => m[1]);
  const legend = l.match(/xlink:href=['"](https:\/\/gibs\.earthdata\.nasa\.gov\/legends\/[^'"]+_H\.svg)['"]/)?.[1] ?? l.match(/xlink:href=['"](https:\/\/gibs\.earthdata\.nasa\.gov\/legends\/[^'"]+\.svg)['"]/)?.[1] ?? null;
  const maxLevel = Number(tms?.match(/Level(\d+)/)?.[1] ?? 6);
  const ext = format === 'image/jpeg' ? 'jpg' : format === 'image/png' ? 'png' : null;
  if (!ext || !tms) {
    console.warn('unsupported format', id, format);
    continue;
  }
  const first = values[0]?.split('/')[0] ?? null;
  const last = values.at(-1)?.split('/')[1] ?? def ?? null;
  const period = values[0]?.split('/')[2] ?? 'P1D';
  out.push({ id, category, title, note, tileMatrixSet: tms, maxLevel, ext, defaultDate: def, firstDate: first, lastDate: last, period, legend });
}
writeFileSync('src/renderer/data/gibsCatalog.json', JSON.stringify({ source: 'NASA GIBS WMTS capabilities (EPSG:3857, best)', builtAt: new Date().toISOString().slice(0, 10), products: out }, null, 1));
console.log(`wrote ${out.length} products`);
