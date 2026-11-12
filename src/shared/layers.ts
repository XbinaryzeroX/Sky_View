// Live/reference data layers beyond NWS and USGS. Every layer declares what
// kind of data it is (live observation vs. calculated vs. periodic), where it
// comes from, its terms, coverage, and authentication — and the UI shows it.

import type { LineString, MultiPolygon, Polygon } from 'geojson';
import type { FeedState, Freshness } from './types';
import type { DwdWarning } from './dwd';

export type LayerId = 'aircraft' | 'aircraftMil' | 'vessels' | 'satellites' | 'fires' | 'firePerimeters' | 'metar' | 'cyclones' | 'cameras' | 'transit' | 'airspace' | 'incidents' | 'dwd';

export const LAYER_IDS: LayerId[] = ['aircraft', 'aircraftMil', 'vessels', 'satellites', 'fires', 'firePerimeters', 'metar', 'cyclones', 'cameras', 'transit', 'airspace', 'incidents', 'dwd'];

export type Temporal = 'live' | 'delayed' | 'periodic' | 'forecast' | 'calculated' | 'interpolated' | 'simulated' | 'static';

export const TEMPORAL_LABEL: Record<Temporal, string> = {
  live: 'Live observation',
  delayed: 'Delayed observation',
  periodic: 'Periodically updated record',
  forecast: 'Forecast',
  calculated: 'Calculated position',
  interpolated: 'Interpolated position',
  simulated: 'Simulated visualization',
  static: 'Static reference data',
};

export type LayerGroup = 'Movement' | 'Space' | 'Hazards' | 'Weather' | 'Cameras' | 'Reference';

export interface LayerMeta {
  id: LayerId;
  name: string;
  group: LayerGroup;
  temporal: Temporal;
  temporalNote: string;
  source: string;
  sourceUrl: string;
  license: string;
  coverage: string;
  auth: string;
  pollSeconds: number;
  viewport: boolean;
}

export const LAYERS: Record<LayerId, LayerMeta> = {
  aircraft: {
    id: 'aircraft',
    name: 'Aircraft (ADS-B)',
    group: 'Movement',
    temporal: 'live',
    temporalNote: 'Positions reported by aircraft transponders and received by volunteer feeders; each record shows its age. Coverage gaps are common.',
    source: 'adsb.lol (plus your local receiver, if configured)',
    sourceUrl: 'https://www.adsb.lol/docs/open-data/api/',
    license: 'ODbL 1.0 (attribution; share-alike for derived databases)',
    coverage: 'Worldwide where feeders exist; 250 nm around the view center, or up to 12 such areas when zoomed out',
    auth: 'None',
    pollSeconds: 20,
    viewport: true,
  },
  aircraftMil: {
    id: 'aircraftMil',
    name: 'Military-flagged aircraft',
    group: 'Movement',
    temporal: 'live',
    temporalNote: 'Aircraft flagged as military in the adsb.lol aircraft database. The flag can be incomplete or wrong; many military aircraft do not broadcast.',
    source: 'adsb.lol /v2/mil',
    sourceUrl: 'https://www.adsb.lol/docs/open-data/api/',
    license: 'ODbL 1.0',
    coverage: 'Worldwide where feeders exist',
    auth: 'None',
    pollSeconds: 60,
    viewport: false,
  },
  vessels: {
    id: 'vessels',
    name: 'Vessels (AIS)',
    group: 'Movement',
    temporal: 'live',
    temporalNote: 'AIS position reports. Keyless coverage is Finnish/Baltic waters (Fintraffic); add an AISStream key for your view area.',
    source: 'Fintraffic Digitraffic Marine (keyless) · AISStream (optional key)',
    sourceUrl: 'https://www.digitraffic.fi/en/marine-traffic/',
    license: 'Digitraffic: CC BY 4.0 · AISStream: free beta, no formal terms',
    coverage: 'Finland and the northern Baltic (keyless); view area with AISStream',
    auth: 'None (optional AISStream key)',
    pollSeconds: 60,
    viewport: false,
  },
  satellites: {
    id: 'satellites',
    name: 'Satellites',
    group: 'Space',
    temporal: 'calculated',
    temporalNote: 'Positions are calculated with SGP4 from published orbital elements (TLEs). They are predictions, not live measurements; accuracy degrades with element age.',
    source: 'CelesTrak GP data',
    sourceUrl: 'https://celestrak.org/NORAD/elements/',
    license: 'U.S. government-origin data, no published license; CelesTrak usage policy (download at most once per 2 hours)',
    coverage: 'Global (selected groups: space stations, brightest, GNSS, weather)',
    auth: 'None',
    pollSeconds: 7200,
    viewport: false,
  },
  fires: {
    id: 'fires',
    name: 'Active fire detections',
    group: 'Hazards',
    temporal: 'delayed',
    temporalNote: 'Satellite thermal-anomaly detections (VIIRS NOAA-20), last 24 hours, typically available within about 3 hours of the overpass. A detection is a hot pixel, not a confirmed wildfire.',
    source: 'NASA FIRMS',
    sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/',
    license: 'NASA open data (no restrictions; citation requested)',
    coverage: 'U.S. (contiguous, Hawaii, Alaska) by default; global optional',
    auth: 'None',
    pollSeconds: 1800,
    viewport: false,
  },
  firePerimeters: {
    id: 'firePerimeters',
    name: 'Wildfire perimeters',
    group: 'Hazards',
    temporal: 'periodic',
    temporalNote: 'Incident teams update perimeters at irregular intervals. Boundaries are simplified for display.',
    source: 'NIFC WFIGS Interagency Perimeters (Current)',
    sourceUrl: 'https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824',
    license: 'Public data under NIFC’s published terms',
    coverage: 'United States. NIFC publishes boundaries for some wildfires and prescribed fires.',
    auth: 'None',
    pollSeconds: 900,
    viewport: false,
  },
  metar: {
    id: 'metar',
    name: 'Weather observations (METAR)',
    group: 'Weather',
    temporal: 'delayed',
    temporalNote: 'Airport surface observations, usually issued hourly; each shows its observation time.',
    source: 'NOAA Aviation Weather Center Data API',
    sourceUrl: 'https://aviationweather.gov/data/api/',
    license: 'U.S. public domain',
    coverage: 'Worldwide airports; current view when zoomed in, up to 400 observations per query box (two boxes across the date line)',
    auth: 'None',
    pollSeconds: 600,
    viewport: true,
  },
  dwd: {
    id: 'dwd',
    name: 'Weather warnings (Germany · DWD)',
    group: 'Weather',
    temporal: 'periodic',
    temporalNote: 'Official warnings in the original German. Each bulletin shows its issue time and the validity supplied by DWD.',
    source: 'Deutscher Wetterdienst (DWD)',
    sourceUrl: 'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/',
    license: '© Deutscher Wetterdienst, CC BY 4.0. Warning polygons converted from CAP to GeoJSON.',
    coverage: 'Germany and the marine warning areas included by DWD. Some warnings identify named areas only.',
    auth: 'None',
    pollSeconds: 300,
    viewport: false,
  },
  cyclones: {
    id: 'cyclones',
    name: 'Tropical cyclones',
    group: 'Weather',
    temporal: 'periodic',
    temporalNote: 'Latest advisory positions and intensities from NHC/CPHC, issued every 3–6 hours. Forecast tracks and cones are linked to NHC products.',
    source: 'NOAA National Hurricane Center',
    sourceUrl: 'https://www.nhc.noaa.gov/',
    license: 'U.S. public domain',
    coverage: 'Atlantic and eastern/central North Pacific',
    auth: 'None',
    pollSeconds: 1800,
    viewport: false,
  },
  incidents: {
    id: 'incidents',
    name: 'Disaster & natural-event incidents',
    group: 'Hazards',
    temporal: 'periodic',
    temporalNote: 'Event reports from GDACS (with its Green/Orange/Red alert level) and NASA EONET (open natural events), merged when both describe the same event. Each record shows its source and last update; the app does not assign its own severity.',
    source: 'GDACS (EC JRC / UN OCHA) · NASA EONET',
    sourceUrl: 'https://www.gdacs.org/',
    license: 'GDACS: free public information with attribution; NASA EONET: U.S. government work',
    coverage: 'Worldwide (GDACS: latest 100 events; EONET: open events of the last 30 days)',
    auth: 'None',
    pollSeconds: 900,
    viewport: false,
  },
  cameras: {
    id: 'cameras',
    name: 'Public traffic & weather cameras',
    group: 'Cameras',
    temporal: 'periodic',
    temporalNote: 'Publisher-listed HLS video, periodically refreshed still images and official viewer links. Availability is checked when opened; camera aim, capture time and delay are the publisher’s.',
    source: 'Caltrans CCTV with live video (California) · NYC DOT (New York City) · Fintraffic weather cameras (Finland) · TfL JamCams (London) · Hong Kong Transport Department · DriveBC (British Columbia) · Québec 511',
    sourceUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
    license: 'Caltrans: public agency data · Fintraffic: CC BY 4.0 · Powered by TfL Open Data · Hong Kong: DATA.GOV.HK terms · DriveBC: Open Government Licence – British Columbia · Québec 511: CC BY 4.0',
    coverage: 'California state highways; New York City; Finnish road network; London; Hong Kong; British Columbia; Québec. More US states, Canadian provinces, New South Wales and Sweden with your own free keys (Provider settings → Camera keys)',
    auth: 'None (optional free keys add more systems)',
    pollSeconds: 21600,
    viewport: false,
  },
  transit: {
    id: 'transit',
    name: 'Transit vehicles (Boston MBTA)',
    group: 'Movement',
    temporal: 'live',
    temporalNote: 'Vehicle positions reported by MBTA (GTFS-Realtime via the V3 API); each shows its update time.',
    source: 'MBTA V3 API',
    sourceUrl: 'https://www.mbta.com/developers/v3-api',
    license: 'MassDOT/MBTA developer license (review before commercial use)',
    coverage: 'Greater Boston',
    auth: 'None (rate-limited without a key)',
    pollSeconds: 20,
    viewport: false,
  },
  airspace: {
    id: 'airspace',
    name: 'Prohibited & restricted airspace',
    group: 'Reference',
    temporal: 'static',
    temporalNote: 'FAA special-use airspace (P and R) boundaries. Informational only — not for flight planning.',
    source: 'FAA Aeronautical Data (Special Use Airspace)',
    sourceUrl: 'https://adds-faa.opendata.arcgis.com/',
    license: 'U.S. public domain',
    coverage: 'United States',
    auth: 'None',
    pollSeconds: 86400,
    viewport: false,
  },
};

export interface GeoRecord {
  id: string;
  lat: number;
  lon: number;
  altM: number | null;
  heading: number | null;
  speedKts: number | null;
  label: string;
  category: string | null;
  /** Observation/publication time of this record (UTC ISO). */
  observedAt: string | null;
  sourceUrl: string | null;
  source: string;
  props: Record<string, string | number | boolean | null>;
  geometry?: Polygon | MultiPolygon | LineString | null;
  /** Two-line orbital elements for calculated satellite positions. */
  tle?: [string, string];
  /** Image URL published by a camera operator. */
  imageUrl?: string | null;
}

export interface LayerStatus {
  id: LayerId;
  enabled: boolean;
  state: FeedState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sourceUpdatedAt: string | null;
  error: string | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  recordCount: number;
  skippedRecords: number;
  freshness: Freshness;
  /** Explains coverage gaps, e.g. "zoom in to load". */
  note: string | null;
}

export interface LayerSnapshot {
  status: LayerStatus;
  records: GeoRecord[];
  /** Includes named areas without a map polygon. Absent until a complete DWD snapshot is available. */
  dwdWarnings?: DwdWarning[];
}

export interface ViewState {
  lat: number;
  lon: number;
  heightM: number;
  /** [west, south, east, north] degrees, clamped. */
  bbox: [number, number, number, number];
}

export interface TrackPoint {
  t: string;
  lat: number;
  lon: number;
  altM: number | null;
  heading: number | null;
  /** Aircraft reported on the ground at this point; null when unknown (older recordings, other layers). */
  onGround: boolean | null;
}
