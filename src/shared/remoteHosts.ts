// The only remote locations the renderer may load directly: fixed map-tile
// and image publishers. All JSON data feeds go through the main process.

export interface RendererRemote {
  /** URL prefix (scheme + host + optional path). Requests must start with this. */
  prefix: string;
  purpose: string;
  /** Present only when an optional integration is configured. */
  optional?: 'google3d' | 'esri' | 'mapbox' | 'eox';
}

export const RENDERER_REMOTES: RendererRemote[] = [
  { prefix: 'https://gibs.earthdata.nasa.gov/wmts/', purpose: 'NASA GIBS imagery tiles' },
  { prefix: 'https://gibs.earthdata.nasa.gov/legends/', purpose: 'NASA GIBS product legends (SVG)' },
  { prefix: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/', purpose: 'NASA GIBS polar caps (geographic projection, beyond the Web Mercator limit)' },
  { prefix: 'https://basemap.nationalmap.gov/arcgis/rest/services/', purpose: 'USGS National Map tiles' },
  { prefix: 'https://s3.amazonaws.com/elevation-tiles-prod/', purpose: 'Terrain Tiles (AWS Open Data)' },
  { prefix: 'https://nowcoast.noaa.gov/geoserver/', purpose: 'NOAA nowCOAST radar (WMS)' },
  { prefix: 'https://cwwp2.dot.ca.gov/data/', purpose: 'Caltrans published camera stills' },
  { prefix: 'https://weathercam.digitraffic.fi/', purpose: 'Fintraffic published weather-camera stills' },
  { prefix: 'https://wzmedia.dot.ca.gov/', purpose: 'Caltrans published live camera video (HLS)' },
  { prefix: 'https://webcams.nyctmc.org/api/cameras/', purpose: 'NYC DOT published traffic-camera stills' },
  { prefix: 'https://upload.wikimedia.org/wikipedia/commons/', purpose: 'Wikimedia Commons aircraft/ship photos (author and license shown; only when photos are on)' },
  { prefix: 'https://thumb.wikimedia.org/wikipedia/commons/', purpose: 'Wikimedia Commons photo thumbnails' },
  { prefix: 'https://image.airport-data.com/aircraft/', purpose: 'airport-data.com aircraft photos (photographer credited; only when photos are on)' },
  { prefix: 'https://airport-data.com/images/aircraft/', purpose: 'airport-data.com aircraft photo thumbnails' },
  { prefix: 'https://tiles.openfreemap.org/', purpose: 'OpenFreeMap vector tiles (OpenStreetMap streets, places, buildings)' },
  { prefix: 'https://tile.googleapis.com/', purpose: 'Google Photorealistic 3D Tiles (customer key)', optional: 'google3d' },
  { prefix: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/', purpose: 'Esri World Imagery (customer key)', optional: 'esri' },
  { prefix: 'https://api.mapbox.com/v4/mapbox.satellite/', purpose: 'Mapbox Satellite (customer token)', optional: 'mapbox' },
  { prefix: 'https://tiles.maps.eox.at/wmts/', purpose: 'EOX Sentinel-2 cloudless (customer license)', optional: 'eox' },
];

export interface RemoteOptions {
  google3d: boolean;
  esri?: boolean;
  mapbox?: boolean;
  eox?: boolean;
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
    `media-src 'self' blob: ${remotes}`,
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
