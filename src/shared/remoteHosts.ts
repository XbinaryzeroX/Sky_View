// The only remote locations the renderer may load directly: fixed map-tile
// and image publishers. All JSON data feeds go through the main process.

import { keyedCameraImagePrefixes } from './keyedCameras';

export interface RendererRemote {
  /** URL prefix (scheme + host + optional path). Requests must start with this. */
  prefix: string;
  purpose: string;
  /** Present only when an optional integration is configured. */
  optional?: 'google3d' | 'esri' | 'mapbox' | 'eox' | 'tomtom' | 'cesium';
}

export const RENDERER_REMOTES: RendererRemote[] = [
  { prefix: 'https://gibs.earthdata.nasa.gov/wmts/', purpose: 'NASA GIBS imagery tiles' },
  { prefix: 'https://gibs.earthdata.nasa.gov/legends/', purpose: 'NASA GIBS product legends (SVG)' },
  { prefix: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/', purpose: 'NASA GIBS polar caps (geographic projection, beyond the Web Mercator limit)' },
  { prefix: 'https://titiler.terrascope.be/wms', purpose: 'ESA WorldCover true-colour overview and imagery coverage (WMS)' },
  { prefix: 'https://wmts.terrascope.be/', purpose: 'ESA WorldCover Sentinel-2 2021 true-colour imagery (Terrascope WMTS)' },
  { prefix: 'https://basemap.nationalmap.gov/arcgis/rest/services/', purpose: 'USGS National Map tiles' },
  { prefix: 'https://s3.amazonaws.com/elevation-tiles-prod/', purpose: 'Terrain Tiles (AWS Open Data)' },
  { prefix: 'https://nowcoast.noaa.gov/geoserver/', purpose: 'NOAA nowCOAST radar (WMS)' },
  { prefix: 'https://view.eumetsat.int/geoserver/wms', purpose: 'EUMETSAT View Service: hourly Meteosat weather-satellite frames (WMS)' },
  { prefix: 'https://cwwp2.dot.ca.gov/data/', purpose: 'Caltrans published camera stills' },
  { prefix: 'https://weathercam.digitraffic.fi/', purpose: 'Fintraffic published weather-camera stills' },
  { prefix: 'https://wzmedia.dot.ca.gov/', purpose: 'Caltrans published live camera video (HLS)' },
  { prefix: 'https://webcams.nyctmc.org/api/cameras/', purpose: 'NYC DOT published traffic-camera stills' },
  { prefix: 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/', purpose: 'TfL JamCam stills (Powered by TfL Open Data)' },
  { prefix: 'https://tdcctv.data.one.gov.hk/', purpose: 'Hong Kong Transport Department traffic snapshot images (DATA.GOV.HK)' },
  { prefix: 'https://www.vegagerdin.is/vgdata/vefmyndavelar/', purpose: 'Iceland road camera stills (Vegagerðin, CC BY 4.0)' },
  { prefix: 'https://trafficcam.calgary.ca/', purpose: 'Calgary traffic camera stills (Open Government Licence – City of Calgary)' },
  { prefix: 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/', purpose: 'Toronto traffic camera stills (Open Government Licence – Toronto)' },
  { prefix: 'https://www.drivebc.ca/images/', purpose: 'DriveBC highway camera stills (Open Government Licence – British Columbia)' },
  { prefix: 'https://cdn.kartaview.org/pr:sharp/', purpose: 'KartaView street-level photos (CC BY-SA 4.0), when one is opened' },
  { prefix: 'https://panoramax.ign.fr/api/pictures/', purpose: 'Panoramax street-level photos (IGN instance), when one is opened' },
  { prefix: 'https://panoramax.openstreetmap.fr/derivates/', purpose: 'Panoramax street-level photos (OpenStreetMap France instance), when one is opened' },
  { prefix: 'https://panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net/derivates/', purpose: 'Panoramax street-level photos stored by OpenStreetMap France, when one is opened' },
  ...keyedCameraImagePrefixes().map((prefix) => ({ prefix, purpose: 'Stills of a camera system that needs your own key' })),
  { prefix: 'https://upload.wikimedia.org/wikipedia/commons/', purpose: 'Wikimedia Commons aircraft/ship photos (author and license shown; only when photos are on)' },
  { prefix: 'https://thumb.wikimedia.org/wikipedia/commons/', purpose: 'Wikimedia Commons photo thumbnails' },
  { prefix: 'https://image.airport-data.com/aircraft/', purpose: 'airport-data.com aircraft photos (photographer credited; only when photos are on)' },
  { prefix: 'https://airport-data.com/images/aircraft/', purpose: 'airport-data.com aircraft photo thumbnails' },
  { prefix: 'https://tiles.openfreemap.org/', purpose: 'OpenFreeMap vector tiles (OpenStreetMap streets, places, buildings)' },
  { prefix: 'https://tile.googleapis.com/', purpose: 'Google Photorealistic 3D Tiles (customer key)', optional: 'google3d' },
  { prefix: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/', purpose: 'Esri World Imagery (customer key)', optional: 'esri' },
  { prefix: 'https://api.mapbox.com/v4/mapbox.satellite/', purpose: 'Mapbox Satellite (customer token)', optional: 'mapbox' },
  { prefix: 'https://tiles.maps.eox.at/wmts/', purpose: 'EOX Sentinel-2 cloudless (customer license)', optional: 'eox' },
  { prefix: 'https://api.tomtom.com/traffic/map/4/tile/flow/', purpose: 'TomTom live traffic flow tiles (customer key)', optional: 'tomtom' },
  // Cesium ion (customer token): asset endpoint, ion-hosted terrain, and the Bing Maps tiles ion hands out for asset 2.
  { prefix: 'https://api.cesium.com/v1/assets/', purpose: 'Cesium ion asset endpoint (customer token)', optional: 'cesium' },
  { prefix: 'https://assets.ion.cesium.com/', purpose: 'Cesium World Terrain (customer token)', optional: 'cesium' },
  { prefix: 'https://dev.virtualearth.net/REST/v1/Imagery/Metadata/', purpose: 'Bing Maps imagery metadata via Cesium ion', optional: 'cesium' },
  ...[0, 1, 2, 3].map((n) => ({ prefix: `https://ecn.t${n}.tiles.virtualearth.net/tiles/`, purpose: 'Bing Maps aerial tiles via Cesium ion', optional: 'cesium' as const })),
];

export interface RemoteOptions {
  google3d: boolean;
  esri?: boolean;
  mapbox?: boolean;
  eox?: boolean;
  tomtom?: boolean;
  cesium?: boolean;
}

export function activeRemotes(opts: RemoteOptions): RendererRemote[] {
  return RENDERER_REMOTES.filter((r) => !r.optional || opts[r.optional] === true);
}

export function isAllowedRendererUrl(url: string, opts: RemoteOptions): boolean {
  return activeRemotes(opts).some((r) => url.startsWith(r.prefix));
}

/** Content Security Policy for the renderer. */
export function buildCsp(opts: RemoteOptions & { devOrigin?: string | null }): string {
  const remotes = activeRemotes(opts)
    .map((r) => r.prefix)
    .join(' ');
  const dev = opts.devOrigin ?? null;
  const devWs = dev ? dev.replace(/^http/, 'ws') : '';
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets CesiumJS compile its bundled WebAssembly; JavaScript eval stays blocked
    // (the Vite dev server alone additionally needs inline scripts and eval).
    dev ? `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' ${dev}` : "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${remotes}`,
    "font-src 'self' data:",
    // Live camera video: hls.js feeds segments into a MediaSource (blob:) from allow-listed publishers.
    // app://atlas/radio-stream/ is the app's own radio relay (named explicitly for the development server's origin).
    `media-src 'self' blob: app://atlas/radio-stream/ ${remotes}`,
    `connect-src 'self' data: blob: ${remotes}${dev ? ` ${dev} ${devWs}` : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' about:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
