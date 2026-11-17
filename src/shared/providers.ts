// Provider catalog for the Provider Settings screen. Status values are
// deliberately conservative: "restricted" means terms are unclear or limit
// commercial use; "metered" means usage is billed to the customer's account.

import { KEYED_CAMERA_SYSTEMS, type KeyedCameraId } from './keyedCameras';

export type ProviderStatus = 'free' | 'free-key' | 'restricted' | 'metered';
export type ProviderId =
  | 'openfreemap'
  | 'esri-imagery'
  | 'mapbox'
  | 'eox'
  | 'ourairports'
  | 'nws'
  | 'dwd'
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
  | 'eumetsat'
  | 'caltrans'
  | 'fintraffic-cams'
  | 'mbta'
  | 'faa-sua'
  | 'census-geocoder'
  | 'aerodatabox'
  | 'google3d'
  | 'tomtom'
  | 'launchlibrary'
  | 'openai'
  | 'cesium-ion'
  | 'opensky'
  | 'ollama'
  | 'twelvedata'
  | 'alphavantage'
  | KeyedCameraId;

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

/** Provider ids of the keyed camera systems (shown on their own tab in Provider settings). */
export const CAMERA_KEY_PROVIDER_IDS: ReadonlySet<string> = new Set(KEYED_CAMERA_SYSTEMS.map((s) => s.id));

export const PROVIDERS: ProviderInfo[] = [
  { id: 'aerodatabox', name: 'AeroDataBox', purpose: 'Dated status and times for a selected passenger flight', status: 'metered',
    statusNote: 'A direct AeroDataBox subscription is required. Use and billing follow your subscription.',
    docsUrl: 'https://aerodatabox.com/api-spec', signupUrl: 'https://aerodatabox.com/pricing',
    credential: { kind: 'secret', label: 'Direct API key', placeholder: 'Paste your AeroDataBox direct API key' },
    capabilities: ['Passenger flight status', 'Scheduled and revised times', 'Airports, terminals and gates'],
    limits: 'One Tier 2 status request per explicit lookup. Coverage and available fields vary.', testable: false },
  { id: 'dwd', name: 'Deutscher Wetterdienst (DWD)', purpose: 'Official weather warnings for Germany and DWD marine areas', status: 'free',
    statusNote: '© Deutscher Wetterdienst, CC BY 4.0. Sky_View converts published CAP polygons to GeoJSON.',
    docsUrl: 'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/', signupUrl: null, credential: null,
    capabilities: ['German-language warnings', 'Published warning areas'], limits: 'One complete status check every five minutes while enabled. The connection test shares this cache.', testable: true },
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
  { id: 'nasa-gibs', name: 'NASA GIBS', purpose: 'Global Blue Marble, daily VIIRS imagery and 10-minute weather-satellite frames (GOES, Himawari)', status: 'free', statusNote: 'NASA open data, attribution requested', docsUrl: 'https://nasa-gibs.github.io/gibs-api-docs/', signupUrl: null, credential: null, capabilities: ['Global imagery', 'Daily satellite imagery', 'Weather satellite (10-min)'], limits: 'Zoom 8–9 maximum', testable: false },
  { id: 'terrain-tiles', name: 'Terrain Tiles (AWS Open Data)', purpose: '3D terrain', status: 'free', statusNote: 'Open data; attribution of sources required', docsUrl: 'https://registry.opendata.aws/terrain-tiles/', signupUrl: null, credential: null, capabilities: ['Terrain'], limits: 'Zoom 15 maximum', testable: false },
  { id: 'adsblol', name: 'adsb.lol', purpose: 'Live aircraft positions, military-flagged aircraft', status: 'free', statusNote: 'ODbL 1.0 data; attribution and share-alike on derived databases', docsUrl: 'https://www.adsb.lol/docs/open-data/api/', signupUrl: 'https://www.adsb.lol/docs/open-data/api/', credential: null, capabilities: ['Aircraft', 'Military-flagged aircraft'], limits: 'Rate limits unpublished; queries limited to 250 nm radius; polled every 20–60 s only while the layer is on', testable: true },
  { id: 'local-adsb', name: 'Local ADS-B receiver (readsb/dump1090)', purpose: 'Aircraft from your own receiver on your network', status: 'free', statusNote: 'Your own hardware', docsUrl: 'https://github.com/wiedehopf/readsb', signupUrl: null, credential: { kind: 'url', label: 'aircraft.json URL (private IP only)', placeholder: 'http://192.168.1.50/tar1090/data/aircraft.json' }, capabilities: ['Aircraft (local coverage)'], limits: 'Literal private IPv4 addresses only', testable: true },
  { id: 'digitraffic', name: 'Fintraffic Digitraffic Marine', purpose: 'AIS vessel positions (Finland/Baltic)', status: 'free', statusNote: 'CC BY 4.0, commercial use allowed with attribution', docsUrl: 'https://www.digitraffic.fi/en/marine-traffic/', signupUrl: null, credential: null, capabilities: ['Vessels (regional)'], limits: 'Polled every 60 s while the layer is on', testable: true },
  { id: 'opensky', name: 'OpenSky Network (worldwide aircraft)', purpose: 'Worldwide aircraft snapshot when zoomed out (Settings → Worldwide aircraft)', status: 'restricted', statusNote: 'Free API intended for non-commercial use; commercial use needs an agreement with OpenSky. Without a client the app uses anonymous access (one worldwide refresh per 15 min). With your free API client (client_id:client_secret) it refreshes about every 90 s.', docsUrl: 'https://openskynetwork.github.io/opensky-api/rest.html', signupUrl: 'https://opensky-network.org/index.php?option=com_users&view=registration', credential: { kind: 'secret', label: 'API client (client_id:client_secret), optional', placeholder: 'my-client-id:my-client-secret' }, capabilities: ['Worldwide aircraft positions (snapshot)'], limits: 'Anonymous 400 credits/day; account 4,000 credits/day; worldwide request = 4 credits', testable: true },
  { id: 'aisstream', name: 'AISStream.io', purpose: 'AIS vessels in your view area', status: 'restricted', statusNote: 'Free beta with no formal terms of service. Review before commercial use.', docsUrl: 'https://aisstream.io/documentation', signupUrl: 'https://aisstream.io/authenticate', credential: { kind: 'secret', label: 'API key', placeholder: 'Paste your AISStream API key' }, capabilities: ['Vessels (view area, worldwide)'], limits: 'One WebSocket per key; bounding box updated as you move', testable: true },
  { id: 'celestrak', name: 'CelesTrak', purpose: 'Satellite orbital elements', status: 'free', statusNote: 'No published license; usage policy limits downloads to once per 2 hours per dataset', docsUrl: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php', signupUrl: null, credential: null, capabilities: ['Satellites (calculated positions)'], limits: 'Cached locally; refreshed at most every 2 hours', testable: false },
  { id: 'firms', name: 'NASA FIRMS', purpose: 'Satellite fire detections', status: 'free', statusNote: 'NASA open data (citation requested)', docsUrl: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', signupUrl: null, credential: null, capabilities: ['Fire detections (24 h)'], limits: 'Refreshed every 30 minutes', testable: true },
  { id: 'nifc', name: 'NIFC WFIGS', purpose: 'Wildfire perimeters', status: 'free', statusNote: 'Public data · NIFC terms apply', docsUrl: 'https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824', signupUrl: null, credential: null, capabilities: ['Fire perimeters'], limits: 'The app checks every 15 minutes while the layer is enabled', testable: true },
  { id: 'awc', name: 'NOAA Aviation Weather Center', purpose: 'METAR observations', status: 'free', statusNote: 'Public domain', docsUrl: 'https://aviationweather.gov/data/api/', signupUrl: null, credential: null, capabilities: ['Weather observations'], limits: '100 requests/minute; 400 stations per request', testable: true },
  { id: 'nhc', name: 'NOAA National Hurricane Center', purpose: 'Active tropical cyclones', status: 'free', statusNote: 'Public domain', docsUrl: 'https://www.nhc.noaa.gov/', signupUrl: null, credential: null, capabilities: ['Cyclone advisories'], limits: 'Refreshed every 30 minutes', testable: true },
  { id: 'eumetsat', name: 'EUMETSAT View Service', purpose: 'Hourly Meteosat weather-satellite frames over Europe, Africa and the Indian Ocean', status: 'free', statusNote: 'Hourly imagery not subject to licensing (EUMETSAT); credit © EUMETSAT', docsUrl: 'https://view.eumetsat.int/', signupUrl: null, credential: null, capabilities: ['Weather satellite (hourly, Meteosat)'], limits: 'Hourly frames only; 15-minute frames under 3 hours old are licensed for non-commercial use', testable: false },
  { id: 'nowcoast', name: 'NOAA nowCOAST', purpose: 'Observed weather radar mosaic', status: 'free', statusNote: 'Public domain', docsUrl: 'https://nowcoast.noaa.gov/', signupUrl: null, credential: null, capabilities: ['Radar (U.S.)'], limits: 'Refreshed every 5 minutes while on', testable: false },
  { id: 'caltrans', name: 'Caltrans CCTV', purpose: 'Published highway camera stills', status: 'free', statusNote: 'Published openly by Caltrans; review Caltrans terms for redistribution', docsUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm', signupUrl: null, credential: null, capabilities: ['Cameras (California)'], limits: 'Catalog refreshed every 6 hours; images load only when you open a camera', testable: true },
  { id: 'fintraffic-cams', name: 'Fintraffic weather cameras', purpose: 'Published road-weather camera stills', status: 'free', statusNote: 'CC BY 4.0', docsUrl: 'https://www.digitraffic.fi/en/road-traffic/', signupUrl: null, credential: null, capabilities: ['Cameras (Finland)'], limits: 'Catalog refreshed every 6 hours', testable: true },
  { id: 'mbta', name: 'MBTA V3 API', purpose: 'Boston transit vehicle positions', status: 'free', statusNote: 'MassDOT developer license. Review before commercial use.', docsUrl: 'https://www.mbta.com/developers/v3-api', signupUrl: 'https://api-v3.mbta.com/', credential: null, capabilities: ['Transit (Boston)'], limits: '20 requests/minute without a key; polled every 20 s while on', testable: true },
  { id: 'faa-sua', name: 'FAA Special Use Airspace', purpose: 'Prohibited and restricted airspace', status: 'free', statusNote: 'Public domain', docsUrl: 'https://adds-faa.opendata.arcgis.com/', signupUrl: null, credential: null, capabilities: ['Airspace'], limits: 'Refreshed daily', testable: true },
  { id: 'census-geocoder', name: 'U.S. Census Geocoder', purpose: 'U.S. street-address search', status: 'free', statusNote: 'Public domain', docsUrl: 'https://geocoding.geo.census.gov/geocoder/', signupUrl: null, credential: null, capabilities: ['Address search (U.S.)'], limits: 'Requests sent only when you search an address', testable: true },
  { id: 'google3d', name: 'Google Maps Platform (Photoreal 3D + Satellite)', purpose: 'Photorealistic 3D cities and worldwide satellite imagery (Map Tiles API); place search via Geocoding API while these are on', status: 'metered', statusNote: 'Billed to your Google Cloud account (Map Tiles API). Google terms restrict caching and require Google attribution.', docsUrl: 'https://developers.google.com/maps/documentation/tile/3d-tiles', signupUrl: 'https://console.cloud.google.com/google/maps-apis/overview', credential: { kind: 'browser-key', label: 'Google Maps API key (browser key, restrict to Map Tiles API)', placeholder: 'AIza…' }, capabilities: ['Photorealistic 3D cities', 'Worldwide satellite imagery (2D tiles)', 'Google place search while Google imagery is on'], limits: 'Metered per root-tile session; included key allowance or your own key', testable: true },
  { id: 'tomtom', name: 'TomTom Traffic', purpose: 'Live road congestion worldwide (Traffic Flow tiles), drawn over the map', status: 'metered', statusNote: 'Requires your TomTom API key. TomTom counts every map tile; its free tier is for evaluation, then billed to your TomTom account. The key is used in the map view, so restrict it to the Traffic API.', docsUrl: 'https://developer.tomtom.com/traffic-api/documentation/traffic-flow/raster-flow-tiles', signupUrl: 'https://developer.tomtom.com/user/register', credential: { kind: 'browser-key', label: 'TomTom API key', placeholder: 'Your TomTom key' }, capabilities: ['Live congestion colours on roads worldwide, relative to free-flow speed'], limits: 'TomTom free tier, then metered per tile', testable: true },
  { id: 'launchlibrary', name: 'Launch Library 2 (The Space Devs)', purpose: 'Higher request allowance for the launches layer and launch event replay', status: 'metered', statusNote: 'Optional. Without a token the app uses the anonymous allowance of 15 requests an hour. Tokens come with a paid supporter plan from The Space Devs.', docsUrl: 'https://ll.thespacedevs.com/docs/', signupUrl: 'https://thespacedevs.com/llapi', credential: { kind: 'secret', label: 'Launch Library 2 API token', placeholder: 'Token from The Space Devs' }, capabilities: ['Launch list and event timelines above the anonymous limit'], limits: 'Per your plan', testable: true },
  { id: 'openai', name: 'OpenAI (voice control)', purpose: 'Speech-to-text for voice commands: hold the microphone button and say a place or a layer', status: 'metered', statusNote: 'Requires your OpenAI API key. Each spoken command sends that recording to OpenAI for transcription and is billed to your OpenAI account. Nothing is sent until you hold the microphone button.', docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text', signupUrl: 'https://platform.openai.com/signup', credential: { kind: 'secret', label: 'OpenAI API key', placeholder: 'sk-…' }, capabilities: ['Voice commands: go to a place, turn layers on or off, switch the map surface'], limits: 'Billed per minute of audio; up to 15 seconds per command', testable: true },
  { id: 'cesium-ion', name: 'Cesium ion (Bing aerial + world terrain)', purpose: 'Bing Maps aerial imagery and Cesium World Terrain, alongside the other surfaces; Google Photoreal 3D stays available', status: 'restricted', statusNote: 'Requires your Cesium ion access token. The free Community plan is for non-commercial use with monthly limits; commercial use needs a paid plan. The token is used in the map view, so give it only the assets you use.', docsUrl: 'https://cesium.com/learn/ion/', signupUrl: 'https://ion.cesium.com/signup/', credential: { kind: 'browser-key', label: 'Cesium ion access token', placeholder: 'eyJ…' }, capabilities: ['Bing Maps aerial imagery (worldwide)', 'Cesium World Terrain'], limits: 'Per your Cesium ion plan', testable: true },
  { id: 'ollama', name: 'Ollama (local AI)', purpose: 'Optional local language model', status: 'free', statusNote: 'Runs on your computer; each model has its own license', docsUrl: 'https://ollama.com/', signupUrl: null, credential: null, capabilities: ['AI explanations'], limits: 'Requires suitable hardware; configure in Settings', testable: false },
  // Camera systems that need the customer's own free key (one per publisher; see keyedCameras.ts).
  ...KEYED_CAMERA_SYSTEMS.map((s): ProviderInfo => ({
    id: s.id,
    name: s.name,
    purpose: `Traffic camera stills (${s.region}, ${s.country})`,
    status: 'free-key',
    statusNote: s.termsNote,
    docsUrl: s.docsUrl,
    signupUrl: s.signupUrl,
    credential: { kind: 'secret', label: s.kind === 'wsdot' ? 'Access code' : s.kind === '511' ? 'Developer key' : 'API key', placeholder: `Paste your ${s.name} key` },
    capabilities: [`Cameras (${s.region})`],
    limits: 'One catalog request every 6 hours; images load only when you open a camera',
    testable: true,
  })),
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
