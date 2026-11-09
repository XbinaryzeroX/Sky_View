// Imagery stacks. Every provider is a real multiresolution tile pyramid;
// Cesium requests finer tiles as the camera descends, keeps parent tiles on
// screen while children load, and stops at each provider's maximum level.
//
// Global base: NASA Blue Marble Shaded Relief + Bathymetry. Its ocean color
// matches the low-zoom USGS tiles, so the old dark-ocean seam is gone.
// Regional high-detail layers (USGS) overlay this base; their no-data areas
// are transparent (see usgsProvider.ts) so the base shows through.

import {
  buildModuleUrl,
  Credit,
  GeographicTilingScheme,
  ImageryLayer,
  Rectangle,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  type ImageryProvider,
  Google2DImageryProvider,
  WebMercatorTilingScheme,
} from 'cesium';
import { GibsBaseProvider, OffshoreVeilProvider } from './gibsProvider';
import { UsgsImageryProvider, type UsgsService } from './usgsProvider';
import { createVectorImageryProvider } from './vectorTiles';

export type BasemapId = 'atlas' | 'streets' | 'usgsImageryTopo' | 'usgsTopo' | 'gibsDaily' | 'esri' | 'mapbox' | 'eox' | 'naturalEarth' | 'neutral' | 'google3d' | 'google2d';

export interface ImagerySourceInfo {
  id: string;
  name: string;
  provider: string;
  coverage: string;
  maxLevel: number;
  bestResolution: string;
  captureDate: string;
  terms: string;
  host: string | null;
  /** Inside this area the source is the detailed one; elsewhere a coarser layer applies. */
  regional?: boolean;
}

export interface BuildContext {
  date: string;
  keys: { esri: string | null; mapbox: string | null; google: string | null };
  eoxLicensed: boolean;
}

export interface BasemapDef {
  id: BasemapId;
  label: string;
  description: string;
  requires?: 'esri' | 'mapbox' | 'eox' | 'google3d';
  sources: ImagerySourceInfo[];
  build(ctx: BuildContext): ImageryLayer[];
}

const MERC = new WebMercatorTilingScheme();

/** U.S. coverage areas for USGS layers. Outside them USGS has no orthoimagery. */
export const US_RECTS = {
  conus: Rectangle.fromDegrees(-125.5, 24.0, -66.5, 49.6),
  alaska: Rectangle.fromDegrees(-179.99, 51.0, -129.5, 71.6),
  hawaii: Rectangle.fromDegrees(-160.6, 18.8, -154.6, 22.4),
  puertoRico: Rectangle.fromDegrees(-67.5, 17.8, -64.5, 18.6),
};

export const GLOBAL_BASE: ImagerySourceInfo = {
  id: 'gibs-bluemarble-shaded',
  name: 'Blue Marble Shaded Relief + Bathymetry',
  provider: 'NASA GIBS',
  coverage: 'Global',
  maxLevel: 8,
  bestResolution: '≈ 500 m/pixel',
  captureDate: 'Composite (Blue Marble 2004, SRTM/GEBCO relief); not current',
  terms: 'NASA open data; no restrictions; attribution requested',
  host: 'gibs.earthdata.nasa.gov',
};

const USGS_IMAGERY: ImagerySourceInfo = {
  id: 'usgs-imagery',
  name: 'USGS National Map orthoimagery',
  provider: 'USGS / USDA',
  coverage: 'United States (lower 48, Alaska, Hawaii, Puerto Rico)',
  maxLevel: 16,
  bestResolution: '≈ 2.4 m/pixel (zoom 16)',
  captureDate: 'Various years; service data refreshed June 2024 (per USGS metadata)',
  terms: 'U.S. public domain (USGS The National Map)',
  host: 'basemap.nationalmap.gov',
  regional: true,
};

const OSM_VECTOR: ImagerySourceInfo = {
  id: 'openfreemap',
  name: 'OpenStreetMap streets, water, places, buildings',
  provider: 'OpenFreeMap (OpenMapTiles schema)',
  coverage: 'Worldwide (as mapped in OpenStreetMap)',
  maxLevel: 14,
  bestResolution: 'Vector data to zoom 14, drawn sharp to zoom 19',
  captureDate: 'OpenStreetMap data, weekly planet build (version shown in the tile URL)',
  terms: 'ODbL data (© OpenStreetMap contributors), © OpenMapTiles; OpenFreeMap free incl. commercial use',
  host: 'tiles.openfreemap.org',
};

/** Latitude beyond which the polar caps replace the Web Mercator base. */
export const POLAR_CAP_LAT = 78;

/**
 * Polar caps. Web Mercator tiles end at ±85.05°, which left a black disc over
 * both poles, and they are heavily stretched from ~80°. The same NASA product
 * is served in geographic projection (EPSG:4326, to ±90°) by the GIBS WMS, so
 * the caps match the base in color and resolution.
 */
function polarCaps(): ImageryLayer[] {
  const caps = [Rectangle.fromDegrees(-180, POLAR_CAP_LAT, 180, 90), Rectangle.fromDegrees(-180, -90, 180, -POLAR_CAP_LAT)];
  return caps.map(
    (rectangle) =>
      new ImageryLayer(
        new WebMapServiceImageryProvider({
          url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
          layers: 'BlueMarble_ShadedRelief_Bathymetry',
          parameters: { format: 'image/jpeg', transparent: false, styles: '' },
          tilingScheme: new GeographicTilingScheme(),
          rectangle,
          maximumLevel: 7,
          credit: new Credit('Imagery: NASA Blue Marble Shaded Relief + Bathymetry (GIBS)'),
        }),
        { rectangle },
      ),
  );
}

function globalBase(): ImageryLayer[] {
  return [
    new ImageryLayer(
      new GibsBaseProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
        tilingScheme: MERC,
        maximumLevel: 8,
        credit: new Credit('Imagery: NASA Blue Marble Shaded Relief + Bathymetry (GIBS)'),
      }),
    ),
    ...polarCaps(),
  ];
}

function usgsLayers(service: UsgsService): ImageryLayer[] {
  return Object.values(US_RECTS).map(
    (rectangle) =>
      new ImageryLayer(
        new UsgsImageryProvider({ url: `https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, tilingScheme: MERC, maximumLevel: 16, rectangle, credit: new Credit('USGS The National Map') }, service),
        // Used from level 9 down; above that the global base is shown, so there is no seam at globe scale.
        { rectangle, minimumTerrainLevel: 9 },
      ),
  );
}

export function previousUtcDay(now = new Date()): string {
  return new Date(now.getTime() - 86400_000).toISOString().slice(0, 10);
}

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  atlas: {
    id: 'atlas',
    label: 'Atlas imagery (keyless)',
    description: 'NASA global base worldwide; USGS orthoimagery to ≈2 m over the U.S. Add the street/label overlay for worldwide city context.',
    sources: [GLOBAL_BASE, USGS_IMAGERY],
    build: () => [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
  streets: {
    id: 'streets',
    label: 'Street map (worldwide, keyless)',
    description: 'OpenStreetMap streets, water, land use, places and building footprints for the whole world (OpenFreeMap).',
    sources: [OSM_VECTOR],
    // Vector tiles stop at the Web Mercator limit (±85°); polar caps fill the rest.
    build: () => [...polarCaps(), new ImageryLayer(createVectorImageryProvider('map'))],
  },
  usgsImageryTopo: {
    id: 'usgsImageryTopo',
    label: 'Imagery + US Topo labels (U.S.)',
    description: 'USGS orthoimagery with US Topo roads and names; NASA global base elsewhere',
    sources: [GLOBAL_BASE, { ...USGS_IMAGERY, id: 'usgs-imagerytopo', name: 'USGS orthoimagery + US Topo' }],
    build: () => [...globalBase(), ...usgsLayers('USGSImageryTopo')],
  },
  usgsTopo: {
    id: 'usgsTopo',
    label: 'Topographic map (U.S.)',
    description: 'USGS topographic base map; NASA global base elsewhere',
    sources: [GLOBAL_BASE, { ...USGS_IMAGERY, id: 'usgs-topo', name: 'USGS topographic map', captureDate: 'Map data, not imagery' }],
    build: () => [...globalBase(), ...usgsLayers('USGSTopo')],
  },
  gibsDaily: {
    id: 'gibsDaily',
    label: 'Daily satellite (yesterday, global)',
    description: 'NASA VIIRS true color from the previous UTC day: clouds, smoke and snow as observed',
    sources: [{ ...GLOBAL_BASE, id: 'gibs-viirs', name: 'VIIRS NOAA-20 corrected reflectance', maxLevel: 9, bestResolution: '≈ 250–375 m/pixel', captureDate: 'Previous UTC day (date in attribution)', coverage: 'Global; gaps between orbit swaths are normal' }],
    build: (ctx) => [
      ...globalBase(),
      new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${ctx.date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
          tilingScheme: MERC,
          maximumLevel: 9,
          credit: new Credit(`Imagery: NASA VIIRS NOAA-20, ${ctx.date} (GIBS)`),
        }),
      ),
    ],
  },
  esri: {
    id: 'esri',
    label: 'Esri World Imagery (your ArcGIS key)',
    description: 'Worldwide sub-meter to 15 m imagery. Requires your ArcGIS Location Platform key; free tier then metered on your account.',
    requires: 'esri',
    sources: [GLOBAL_BASE, { id: 'esri-world-imagery', name: 'Esri World Imagery', provider: 'Esri (Maxar, Earthstar Geographics, and others)', coverage: 'Worldwide; detail varies by area', maxLevel: 19, bestResolution: '≈ 0.3–1 m in many cities; coarser elsewhere', captureDate: 'Varies by area (not live)', terms: 'ArcGIS Location Platform terms; customer key; free tier then metered', host: 'ibasemaps-api.arcgis.com' }],
    build: (ctx) =>
      ctx.keys.esri
        ? [
            ...globalBase(),
            new ImageryLayer(
              new UrlTemplateImageryProvider({
                url: `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ctx.keys.esri)}`,
                tilingScheme: MERC,
                maximumLevel: 19,
                credit: new Credit('Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community'),
              }),
            ),
          ]
        : [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
  mapbox: {
    id: 'mapbox',
    label: 'Mapbox Satellite (your token)',
    description: 'Worldwide satellite/aerial imagery. Requires your Mapbox access token; free tier then metered on your account.',
    requires: 'mapbox',
    sources: [GLOBAL_BASE, { id: 'mapbox-satellite', name: 'Mapbox Satellite', provider: 'Mapbox (Maxar and others)', coverage: 'Worldwide; detail varies', maxLevel: 19, bestResolution: 'Sub-meter in many cities', captureDate: 'Varies (not live)', terms: 'Mapbox terms; customer token; metered', host: 'api.mapbox.com' }],
    build: (ctx) =>
      ctx.keys.mapbox
        ? [
            ...globalBase(),
            new ImageryLayer(
              new UrlTemplateImageryProvider({
                url: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${encodeURIComponent(ctx.keys.mapbox)}`,
                tilingScheme: MERC,
                maximumLevel: 19,
                credit: new Credit('© Mapbox © Maxar'),
              }),
            ),
          ]
        : [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
  eox: {
    id: 'eox',
    label: 'Sentinel-2 cloudless (EOX license required)',
    description: 'Worldwide 10 m cloud-free mosaic (2024). Commercial use requires an EOX commercial license; enable only if you hold one.',
    requires: 'eox',
    sources: [GLOBAL_BASE, { id: 'eox-s2cloudless', name: 'Sentinel-2 cloudless 2024', provider: 'EOX IT Services', coverage: 'Worldwide land', maxLevel: 15, bestResolution: '≈ 10 m (Sentinel-2)', captureDate: '2024 annual mosaic', terms: 'Non-commercial: CC BY-NC-SA 4.0; commercial: EOX license', host: 'tiles.maps.eox.at' }],
    build: (ctx) =>
      ctx.eoxLicensed
        ? [
            ...globalBase(),
            new ImageryLayer(
              new UrlTemplateImageryProvider({
                url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
                tilingScheme: MERC,
                maximumLevel: 15,
                credit: new Credit('EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)'),
              }),
            ),
          ]
        : [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
  naturalEarth: {
    id: 'naturalEarth',
    label: 'Offline relief (bundled)',
    description: 'Works without internet; very low resolution',
    sources: [{ ...GLOBAL_BASE, id: 'naturalearth', name: 'Natural Earth II relief (bundled)', provider: 'Natural Earth via CesiumJS', maxLevel: 2, bestResolution: '≈ 20 km/pixel', captureDate: 'Static cartographic relief', terms: 'Public domain', host: null }],
    build: () => [ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')), { brightness: 0.8 })],
  },
  neutral: {
    id: 'neutral',
    label: 'Neutral (outlines only)',
    description: 'No imagery; boundaries only',
    sources: [],
    build: () => [],
  },
  google2d: {
    id: 'google2d',
    label: 'Google Satellite (your key, metered)',
    description: 'Worldwide high-resolution satellite and aerial imagery from Google Map Tiles API (2D tiles), using your Google key. Billed per tile to your Google account.',
    requires: 'google3d',
    sources: [GLOBAL_BASE, { id: 'google2d', name: 'Google Satellite (2D Tiles)', provider: 'Google Map Tiles API', coverage: 'Worldwide; detail varies by area', maxLevel: 22, bestResolution: 'Sub-meter in many cities; coarser elsewhere', captureDate: 'Varies by area (not live)', terms: 'Google Maps Platform terms (metered, customer key; no caching beyond terms)', host: 'tile.googleapis.com' }],
    build: (ctx) =>
      ctx.keys.google
        ? [...globalBase(), ImageryLayer.fromProviderAsync(Google2DImageryProvider.fromUrl({ key: ctx.keys.google, mapType: 'satellite' } as never) as unknown as Promise<ImageryProvider>)]
        : [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
  google3d: {
    id: 'google3d',
    label: 'Google Photorealistic 3D (your key, metered)',
    description: 'Requires your Google Maps key; each session is billed to your Google account. Falls back to Atlas imagery when not configured.',
    requires: 'google3d',
    sources: [GLOBAL_BASE, USGS_IMAGERY, { id: 'google3d', name: 'Google Photorealistic 3D Tiles', provider: 'Google Map Tiles API', coverage: 'Many cities worldwide (Google coverage)', maxLevel: 0, bestResolution: 'Varies by city', captureDate: 'Varies; not live', terms: 'Google Maps Platform terms (metered, customer key)', host: 'tile.googleapis.com' }],
    build: () => [...globalBase(), ...usgsLayers('USGSImageryOnly')],
  },
};

/**
 * Street/label overlay for imagery basemaps (worldwide place names, roads, boundaries).
 * With `context`, areas without high-resolution imagery also get translucent OSM
 * fills (lakes and rivers, parks, built-up areas, building footprints), so cities
 * outside the U.S. are readable on the ~500 m keyless base. Inside U.S. coverage
 * the plain overlay is used, so real imagery is never covered.
 */
export function labelsOverlayLayer(context = false): ImageryLayer {
  return new ImageryLayer(context ? createVectorImageryProvider('context', Object.values(US_RECTS)) : createVectorImageryProvider('overlay'), { minimumTerrainLevel: 3 });
}

/** The even-ocean veil (see OffshoreVeilProvider), for customer imagery basemaps. */
export function oceanVeilLayer(): ImageryLayer {
  return new ImageryLayer(
    new OffshoreVeilProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
      tilingScheme: MERC,
      credit: new Credit('Offshore sea: NASA Blue Marble (GIBS)'),
    }),
    { minimumTerrainLevel: 9 },
  );
}

/** Customer imagery basemaps that are active (their key or license is present). */
export function isCustomerImagery(id: BasemapId, keys: BuildContext['keys'], eoxLicensed: boolean): boolean {
  return (id === 'esri' && !!keys.esri) || (id === 'mapbox' && !!keys.mapbox) || (id === 'google2d' && !!keys.google) || (id === 'eox' && eoxLicensed);
}

/** Basemaps whose detail outside the U.S. is only the ~500 m NASA base (when their key is missing, too). */
export function needsContextFills(id: BasemapId, keys: BuildContext['keys'], eoxLicensed: boolean): boolean {
  if (id === 'esri') return !keys.esri;
  if (id === 'mapbox') return !keys.mapbox;
  if (id === 'google2d') return !keys.google;
  if (id === 'eox') return !eoxLicensed;
  return id === 'atlas' || id === 'usgsImageryTopo' || id === 'gibsDaily' || id === 'naturalEarth' || id === 'google3d';
}

export function isBasemapId(v: unknown): v is BasemapId {
  return typeof v === 'string' && v in BASEMAPS;
}
