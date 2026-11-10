// Provider catalog for the Provider Settings screen. Status values are
// deliberately conservative: "restricted" means terms are unclear or limit
// commercial use; "metered" means usage is billed to the customer's account.

export type ProviderStatus = 'free' | 'free-key' | 'restricted' | 'metered';
export type ProviderId =
  | 'openfreemap'
  | 'esri-imagery'
  | 'mapbox'
  | 'eox'
  | 'ourairports'
  | 'nws'
  | 'usgs-quakes'
  | 'usgs-basemap'
  | 'nasa-gibs'
  | 'terrain-tiles'
  | 'adsblol'
  | 'local-adsb'
  | 'digitraffic'
  | 'aisstream'
  | 'celestrak'
  | 'firms'
  | 'nifc'
  | 'awc'
  | 'nhc'
  | 'nowcoast'
  | 'caltrans'
  | 'fintraffic-cams'
  | 'mbta'
  | 'faa-sua'
  | 'census-geocoder'
  | 'google3d'
  | 'opensky'
  | 'ollama'
  | 'twelvedata'
  | 'alphavantage';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  purpose: string;
  status: ProviderStatus;
  statusNote: string;
  docsUrl: string;
  signupUrl: string | null;
  /** 'secret' fields are encrypted with the OS credential store and never returned to the UI. */
  credential: { kind: 'secret' | 'browser-key' | 'url' | 'ack'; label: string; placeholder: string } | null;
  capabilities: string[];
  limits: string;
  testable: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'twelvedata', name: 'Twelve Data', purpose: 'Stock, forex and crypto prices', status: 'free-key', statusNote: 'Included key when supplied by the publisher, or your own key. Delayed or EOD depending on exchange and plan; check your data rights.', docsUrl: 'https://twelvedata.com/docs', signupUrl: 'https://twelvedata.com/register', credential: { kind: 'secret', label: 'API key', placeholder: 'Paste your Twelve Data key' }, capabilities: ['Quotes', 'Charts', 'Symbol search'], limits: '800 API credits/day, 8/minute; cached on demand', testable: true },
  { id: 'alphavantage', name: 'Alpha Vantage', purpose: 'Market prices', status: 'free-key', statusNote: 'Included key when supplied by the publisher, or your own key. Some intervals require a premium plan; provider errors are displayed.', docsUrl: 'https://www.alphavantage.co/documentation/', signupUrl: 'https://www.alphavantage.co/support/#api-key', credential: { kind: 'secret', label: 'API key', placeholder: 'Paste your Alpha Vantage key' }, capabilities: ['Quotes', 'Charts', 'Symbol search'], limits: '25 requests/day, app caps at 5/minute; cached on demand', testable: true },
  { id: 'openfreemap', name: 'OpenFreeMap (OpenStreetMap vector tiles)', purpose: 'Worldwide streets, water, place names, building footprints and heights', status: 'free', statusNote: 'Free, commercial use allowed, no key, no request limits (OpenFreeMap FAQ). Data ODbL © OpenStreetMap contributors, © OpenMapTiles; attribution required.', docsUrl: 'https://openfreemap.org/', signupUrl: null, credential: null, capabilities: ['Street map (worldwide)', 'Label overlay', '3D buildings (extruded)'], limits: 'Bulk/offline downloads limited by OpenFreeMap terms; tiles fetched only for the view', testable: true },
  { id: 'esri-imagery', name: 'Esri World Imagery (ArcGIS Location Platform)', purpose: 'Worldwide high-resolution satellite/aerial imagery', status: 'metered', statusNote: 'Requires your ArcGIS Location Platform API key. Free tier, then billed to your Esri account. Key is used in the map view, so restrict it to basemap services.', docsUrl: 'https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/', signupUrl: 'https://location.arcgis.com/sign-up/', credential: { kind: 'browser-key', label: 'ArcGIS API key (basemap access)', placeholder: 'AAPK… / AAPT…' }, capabilities: ['Worldwide imagery to zoom 19'], limits: 'Esri free tier limits, then metered', testable: true },
  { id: 'mapbox', name: 'Mapbox Satellite', purpose: 'Worldwide satellite/aerial imagery', status: 'metered', statusNote: 'Requires your Mapbox public access token. Free tier, then billed to your Mapbox account.', docsUrl: 'https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/', signupUrl: 'https://account.mapbox.com/auth/signup/', credential: { kind: 'browser-key', label: 'Mapbox public token (pk.…)', placeholder: 'pk.eyJ…' }, capabilities: ['Worldwide imagery to zoom 19'], limits: 'Mapbox free tier, then metered', testable: true },
  { id: 'eox', name: 'EOX Sentinel-2 cloudless', purpose: 'Worldwide 10 m cloud-free imagery mosaic', status: 'restricted', statusNote: 'Non-commercial use only (CC BY-NC-SA 4.0) unless you hold an EOX commercial license. Confirm only if your organization has one.', docsUrl: 'https://cloudless.eox.at/documentation/license', signupUrl: 'https://cloudless.eox.at/pricing', credential: { kind: 'ack', label: 'My organization holds an EOX commercial license for Sentinel-2 cloudless', placeholder: '' }, capabilities: ['Worldwide 10 m imagery'], limits: 'Per your EOX license', testable: true },
  { id: 'ourairports', name: 'OurAirports', purpose: 'Airport names, codes and locations (bundled)', status: 'free', statusNote: 'Public domain', docsUrl: 'https://ourairports.com/data/', signupUrl: null, credential: null, capabilities: ['Airports (5,282 large/medium, offline)'], limits: 'Bundled snapshot (Nov 2026)', testable: false },
  { id: 'nws', name: 'National Weather Service API', purpose: 'Active weather alerts, NWS zones', status: 'free', statusNote: 'U.S. government data, free for any purpose', docsUrl: 'https://www.weather.gov/documentation/services-web-api', signupUrl: null, credential: null, capabilities: ['Weather alerts', 'Zone lookup'], limits: 'Unpublished “generous” rate limit; User-Agent required', testable: true },
  { id: 'usgs-quakes', name: 'USGS earthquake feeds', purpose: 'Recent earthquakes', status: 'free', statusNote: 'Public domain', docsUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php', signupUrl: null, credential: null, capabilities: ['Earthquakes'], limits: 'Feeds update every minute', testable: true },
  { id: 'usgs-basemap', name: 'USGS The National Map basemaps', purpose: 'U.S. orthoimagery and topo tiles to zoom 16', status: 'free', statusNote: 'Public domain', docsUrl: 'https://apps.nationalmap.gov/services/', signupUrl: null, credential: null, capabilities: ['Imagery (U.S.)', 'Topo map (U.S.)'], limits: 'Tiles cached 24 h by HTTP headers', testable: false },
  { id: 'nasa-gibs', name: 'NASA GIBS', purpose: 'Global Blue Marble and daily VIIRS imagery', status: 'free', statusNote: 'NASA open data, attribution requested', docsUrl: 'https://nasa-gibs.github.io/gibs-api-docs/', signupUrl: null, credential: null, capabilities: ['Global imagery', 'Daily satellite imagery'], limits: 'Zoom 8–9 maximum', testable: false },
  { id: 'terrain-tiles', name: 'Terrain Tiles (AWS Open Data)', purpose: '3D terrain', status: 'free', statusNote: 'Open data; attribution of sources required', docsUrl: 'https://registry.opendata.aws/terrain-tiles/', signupUrl: null, credential: null, capabilities: ['Terrain'], limits: 'Zoom 15 maximum', testable: false },
  { id: 'adsblol', name: 'adsb.lol', purpose: 'Live aircraft positions, military-flagged aircraft', status: 'free', statusNote: 'ODbL 1.0 data; attribution and share-alike on derived databases', docsUrl: 'https://www.adsb.lol/docs/open-data/api/', signupUrl: 'https://www.adsb.lol/docs/open-data/api/', credential: null, capabilities: ['Aircraft', 'Military-flagged aircraft'], limits: 'Rate limits unpublished; queries limited to 250 nm radius; polled every 20–60 s only while the layer is on', testable: true },
  { id: 'local-adsb', name: 'Local ADS-B receiver (readsb/dump1090)', purpose: 'Aircraft from your own receiver on your network', status: 'free', statusNote: 'Your own hardware', docsUrl: 'https://github.com/wiedehopf/readsb', signupUrl: null, credential: { kind: 'url', label: 'aircraft.json URL (private IP only)', placeholder: 'http://192.168.1.50/tar1090/data/aircraft.json' }, capabilities: ['Aircraft (local coverage)'], limits: 'Literal private IPv4 addresses only', testable: true },
  { id: 'digitraffic', name: 'Fintraffic Digitraffic Marine', purpose: 'AIS vessel positions (Finland/Baltic)', status: 'free', statusNote: 'CC BY 4.0, commercial use allowed with attribution', docsUrl: 'https://www.digitraffic.fi/en/marine-traffic/', signupUrl: null, credential: null, capabilities: ['Vessels (regional)'], limits: 'Polled every 60 s while the layer is on', testable: true },
  { id: 'opensky', name: 'OpenSky Network (worldwide aircraft)', purpose: 'Worldwide aircraft snapshot when zoomed out (Settings → Worldwide aircraft)', status: 'restricted', statusNote: 'Free API intended for non-commercial use; commercial use needs an agreement with OpenSky. Without a client the app uses anonymous access (one worldwide refresh per 15 min). With your free API client (client_id:client_secret) it refreshes about every 90 s.', docsUrl: 'https://openskynetwork.github.io/opensky-api/rest.html', signupUrl: 'https://opensky-network.org/index.php?option=com_users&view=registration', credential: { kind: 'secret', label: 'API client (client_id:client_secret), optional', placeholder: 'my-client-id:my-client-secret' }, capabilities: ['Worldwide aircraft positions (snapshot)'], limits: 'Anonymous 400 credits/day; account 4,000 credits/day; worldwide request = 4 credits', testable: true },
  { id: 'aisstream', name: 'AISStream.io', purpose: 'AIS vessels in your view area', status: 'restricted', statusNote: 'Free beta with no formal terms of service. Review before commercial use.', docsUrl: 'https://aisstream.io/documentation', signupUrl: 'https://aisstream.io/authenticate', credential: { kind: 'secret', label: 'API key', placeholder: 'Paste your AISStream API key' }, capabilities: ['Vessels (view area, worldwide)'], limits: 'One WebSocket per key; bounding box updated as you move', testable: true },
  { id: 'celestrak', name: 'CelesTrak', purpose: 'Satellite orbital elements', status: 'free', statusNote: 'No published license; usage policy limits downloads to once per 2 hours per dataset', docsUrl: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php', signupUrl: null, credential: null, capabilities: ['Satellites (calculated positions)'], limits: 'Cached locally; refreshed at most every 2 hours', testable: false },
  { id: 'firms', name: 'NASA FIRMS', purpose: 'Satellite fire detections', status: 'free', statusNote: 'NASA open data (citation requested)', docsUrl: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', signupUrl: null, credential: null, capabilities: ['Fire detections (24 h)'], limits: 'Refreshed every 30 minutes', testable: true },
  { id: 'nifc', name: 'NIFC WFIGS', purpose: 'Wildfire perimeters', status: 'free', statusNote: 'Public domain', docsUrl: 'https://data-nifc.opendata.arcgis.com/', signupUrl: null, credential: null, capabilities: ['Fire perimeters'], limits: 'Refreshed every 15 minutes', testable: true },
  { id: 'awc', name: 'NOAA Aviation Weather Center', purpose: 'METAR observations', status: 'free', statusNote: 'Public domain', docsUrl: 'https://aviationweather.gov/data/api/', signupUrl: null, credential: null, capabilities: ['Weather observations'], limits: '100 requests/minute; 400 stations per request', testable: true },
  { id: 'nhc', name: 'NOAA National Hurricane Center', purpose: 'Active tropical cyclones', status: 'free', statusNote: 'Public domain', docsUrl: 'https://www.nhc.noaa.gov/', signupUrl: null, credential: null, capabilities: ['Cyclone advisories'], limits: 'Refreshed every 30 minutes', testable: true },
  { id: 'nowcoast', name: 'NOAA nowCOAST', purpose: 'Observed weather radar mosaic', status: 'free', statusNote: 'Public domain', docsUrl: 'https://nowcoast.noaa.gov/', signupUrl: null, credential: null, capabilities: ['Radar (U.S.)'], limits: 'Refreshed every 5 minutes while on', testable: false },
  { id: 'caltrans', name: 'Caltrans CCTV', purpose: 'Published highway camera stills', status: 'free', statusNote: 'Published openly by Caltrans; review Caltrans terms for redistribution', docsUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm', signupUrl: null, credential: null, capabilities: ['Cameras (California)'], limits: 'Catalog refreshed every 6 hours; images load only when you open a camera', testable: true },
  { id: 'fintraffic-cams', name: 'Fintraffic weather cameras', purpose: 'Published road-weather camera stills', status: 'free', statusNote: 'CC BY 4.0', docsUrl: 'https://www.digitraffic.fi/en/road-traffic/', signupUrl: null, credential: null, capabilities: ['Cameras (Finland)'], limits: 'Catalog refreshed every 6 hours', testable: true },
  { id: 'mbta', name: 'MBTA V3 API', purpose: 'Boston transit vehicle positions', status: 'free', statusNote: 'MassDOT developer license. Review before commercial use.', docsUrl: 'https://www.mbta.com/developers/v3-api', signupUrl: 'https://api-v3.mbta.com/', credential: null, capabilities: ['Transit (Boston)'], limits: '20 requests/minute without a key; polled every 20 s while on', testable: true },
  { id: 'faa-sua', name: 'FAA Special Use Airspace', purpose: 'Prohibited and restricted airspace', status: 'free', statusNote: 'Public domain', docsUrl: 'https://adds-faa.opendata.arcgis.com/', signupUrl: null, credential: null, capabilities: ['Airspace'], limits: 'Refreshed daily', testable: true },
  { id: 'census-geocoder', name: 'U.S. Census Geocoder', purpose: 'U.S. street-address search', status: 'free', statusNote: 'Public domain', docsUrl: 'https://geocoding.geo.census.gov/geocoder/', signupUrl: null, credential: null, capabilities: ['Address search (U.S.)'], limits: 'Requests sent only when you search an address', testable: true },
  { id: 'google3d', name: 'Google Maps Platform (Photoreal 3D + Satellite)', purpose: 'Photorealistic 3D cities and worldwide satellite imagery (Map Tiles API); place search via Geocoding API while these are on', status: 'metered', statusNote: 'Billed to your Google Cloud account (Map Tiles API). Google terms restrict caching and require Google attribution.', docsUrl: 'https://developers.google.com/maps/documentation/tile/3d-tiles', signupUrl: 'https://console.cloud.google.com/google/maps-apis/overview', credential: { kind: 'browser-key', label: 'Google Maps API key (browser key, restrict to Map Tiles API)', placeholder: 'AIza…' }, capabilities: ['Photorealistic 3D cities', 'Worldwide satellite imagery (2D tiles)', 'Google place search while Google imagery is on'], limits: 'Metered per root-tile session; included key allowance or your own key', testable: true },
  { id: 'ollama', name: 'Ollama (local AI)', purpose: 'Optional local language model', status: 'free', statusNote: 'Runs on your computer; each model has its own license', docsUrl: 'https://ollama.com/', signupUrl: null, credential: null, capabilities: ['AI explanations'], limits: 'Requires suitable hardware; configure in Settings', testable: false },
];

export interface ProviderState {
  id: ProviderId;
  configured: boolean;
  credentialSource?: 'user' | 'builtin' | null;
  /** Set when the saved credential exists but cannot be read (replace or remove it). */
  credentialError?: string | null;
  builtinRemaining?: number | null;
  userConfigured?: boolean;
  /** For URL-type config only (not secret). */
  configValue: string | null;
  lastTest: { ok: boolean; message: string; at: string } | null;
}
