// Live/reference data layers beyond NWS and USGS. Every layer declares what
// kind of data it is (live observation vs. calculated vs. periodic), where it
// comes from, its terms, coverage, and authentication — and the UI shows it.

import type { LineString, MultiPolygon, Polygon } from 'geojson';
import type { FeedState, Freshness } from './types';
import type { DwdWarning } from './dwd';

export type LayerId = 'aircraft' | 'aircraftMil' | 'vessels' | 'satellites' | 'fires' | 'firePerimeters' | 'metar' | 'cyclones' | 'cameras' | 'transit' | 'airspace' | 'incidents' | 'dwd' | 'gnss' | 'launches' | 'rail' | 'bikeshare' | 'wildlife' | 'airQuality' | 'conflicts' | 'streetPhotos' | 'datacenters' | 'dams' | 'cables' | 'landslides' | 'trafficFlow' | 'milSites' | 'alpr';

export const LAYER_IDS: LayerId[] = ['aircraft', 'aircraftMil', 'vessels', 'satellites', 'fires', 'firePerimeters', 'metar', 'cyclones', 'cameras', 'transit', 'airspace', 'incidents', 'dwd', 'gnss', 'launches', 'rail', 'bikeshare', 'wildlife', 'airQuality', 'conflicts', 'streetPhotos', 'datacenters', 'dams', 'cables', 'landslides', 'trafficFlow', 'milSites', 'alpr'];

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

export const LAYER_GROUPS = ['Air traffic', 'Sea and ground traffic', 'Space', 'Weather', 'Hazards', 'Cameras', 'Infrastructure', 'Military and surveillance', 'Nature'] as const;
export type LayerGroup = (typeof LAYER_GROUPS)[number];

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
    group: 'Air traffic',
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
    group: 'Air traffic',
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
    group: 'Sea and ground traffic',
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
    temporalNote: 'Latest advisory positions, past tracks, forecast tracks and forecast cones, issued every 3–12 hours by the regional centres. Forecast positions and cones are predictions.',
    source: 'NOAA National Hurricane Center; GDACS (EC JRC, UN OCHA) for all basins',
    sourceUrl: 'https://www.gdacs.org/',
    license: 'NHC: U.S. public domain. GDACS: free use with attribution to GDACS.',
    coverage: 'Worldwide (GDACS); NHC adds official advisories for the Atlantic and eastern/central North Pacific',
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
    source: 'Caltrans CCTV with live video (California) · NYC DOT (New York City) · Fintraffic weather cameras (Finland) · TfL JamCams (London) · Hong Kong Transport Department · DriveBC (British Columbia) · Québec 511 · Vegagerðin (Iceland) · City of Calgary · City of Toronto',
    sourceUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
    license: 'Caltrans: public agency data · Fintraffic: CC BY 4.0 · Powered by TfL Open Data · Hong Kong: DATA.GOV.HK terms · DriveBC: Open Government Licence – British Columbia · Québec 511: CC BY 4.0 · Vegagerðin: CC BY 4.0 · Calgary and Toronto: their Open Government Licences',
    coverage: 'California state highways; New York City; Finnish road network; London; Hong Kong; British Columbia; Québec; Iceland; Calgary; Toronto city streets. More US states, Canadian provinces, New South Wales and Sweden with your own free keys (Provider settings → Camera keys)',
    auth: 'None (optional free keys add more systems)',
    pollSeconds: 21600,
    viewport: false,
  },
  transit: {
    id: 'transit',
    name: 'Buses, trams and ferries (live, 37 operators)',
    group: 'Sea and ground traffic',
    temporal: 'live',
    temporalNote: 'Each dot is one real vehicle at the position its operator last reported (GTFS-Realtime), usually 10–60 seconds old; each shows its report time. Positions older than 10 minutes are left out. Some feeds mix buses with trams or metro without saying which a vehicle is; those are labelled Transit.',
    source: 'Operator GTFS-Realtime feeds; MBTA V3 API',
    sourceUrl: 'https://www.mbta.com/developers/v3-api',
    license: 'Per operator, shown on each vehicle (CC BY, Open Government Licences, operator developer terms; review before commercial use)',
    coverage: 'Boston, Austin, Denver, Helsinki, the Netherlands, Norway, South East Queensland, Toronto and eight other Ontario systems, Edmonton, Halifax, Victoria, Rio de Janeiro, Prague, Szczecin, Poznań, Gdańsk, Rzeszów, Bordeaux, Montpellier, Rouen, Toulon, Le Havre, Tours, Venice, Sendai, Johor Bahru and Kota Bharu. Loaded for the area in view, below about 1,500 km. Subways that publish no positions are absent.',
    auth: 'None',
    pollSeconds: 20,
    viewport: true,
  },
  airspace: {
    id: 'airspace',
    name: 'Prohibited & restricted airspace',
    group: 'Air traffic',
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
  gnss: {
    id: 'gnss',
    name: 'GPS accuracy anomalies (ADS-B)',
    group: 'Air traffic',
    temporal: 'calculated',
    temporalNote: 'Calculated from the position accuracy aircraft report about themselves (NIC, NACp, GPS-loss flag) over the last 30 minutes of views you visited, in 0.5° cells with at least 3 aircraft. Medium and high cells show low reported accuracy: interference is one possible cause, not a detection, and avionics faults or military manoeuvres also lower it. Blank areas have too few aircraft, not “no interference”.',
    source: 'adsb.lol (aircraft-reported quality) · cell score and bands after gpsjam.org · method from God’s Eye View (MIT)',
    sourceUrl: 'https://gpsjam.org/faq',
    license: 'adsb.lol data: ODbL 1.0',
    coverage: '250 nm around the view center, where adsb.lol feeders receive aircraft. Areas you visit accumulate for 30 minutes.',
    auth: 'None',
    pollSeconds: 120,
    viewport: true,
  },
  launches: {
    id: 'launches',
    name: 'Space launches (30 days back, 14 ahead)',
    group: 'Space',
    temporal: 'periodic',
    temporalNote: 'Launch records placed at the launch pad: past launches with the status the source reports, upcoming ones with their scheduled time and its precision. Schedules change; this is not live telemetry.',
    source: 'The Space Devs Launch Library 2',
    sourceUrl: 'https://thespacedevs.com/llapi',
    license: 'The Space Devs terms (free use with courtesy attribution; may be incomplete)',
    coverage: 'Worldwide orbital launch attempts',
    auth: 'None (anonymous limit: 15 requests per hour)',
    pollSeconds: 3600,
    viewport: false,
  },
  rail: {
    id: 'rail',
    name: 'Trains (live, selected operators)',
    group: 'Sea and ground traffic',
    temporal: 'live',
    temporalNote: 'Train positions reported by each operator’s realtime feed. Most report GPS positions with their own time; Renfe gives only the feed time, which the details say. Positions older than 15 minutes are not shown.',
    source: 'MTA (Metro-North, LIRR) · SEPTA · MARC · Translink Queensland · Fintraffic (Finland) · Renfe · Entur (Vy, Go-Ahead, Flytoget) · KTMB · Toyama tramways',
    sourceUrl: 'https://gtfs.org/documentation/realtime/',
    license: 'Per operator: MTA, SEPTA and MDOT terms; CC BY 4.0 (Translink, Fintraffic, Renfe, KTMB); NLOD 2.0 (Entur); CC0 (Toyama)',
    coverage: 'Only these operators’ networks, loaded when the view is over them. Many countries and operators are not covered.',
    auth: 'None',
    pollSeconds: 30,
    viewport: true,
  },
  bikeshare: {
    id: 'bikeshare',
    name: 'Bike-share stations',
    group: 'Sea and ground traffic',
    temporal: 'periodic',
    temporalNote: 'Bikes and free docks at each station as the operator last reported them (GBFS). A station without a status report shows unknown counts, never zero.',
    source: 'Operator GBFS feeds: Citi Bike, Divvy, Capital Bikeshare, Bay Wheels, Bluebikes (Lyft); Oslo, Bergen and Trondheim Bysykkel; AMBici (Barcelona)',
    sourceUrl: 'https://gbfs.org/',
    license: 'Lyft systems: each system’s Data License Agreement; Norway: NLOD 2.0; AMBici: CC0',
    coverage: 'These nine systems only, loaded when you zoom in over their city.',
    auth: 'None',
    pollSeconds: 120,
    viewport: true,
  },
  wildlife: {
    id: 'wildlife',
    name: 'Wildlife sightings (iNaturalist)',
    group: 'Nature',
    temporal: 'delayed',
    temporalNote: 'Community observations of birds, mammals, reptiles, amphibians, fish and invertebrates from the last 7 days, with the time each was observed. Only openly licensed records (CC0, CC BY, CC BY-SA) are shown, which is a minority. Sensitive species and private records are placed at a randomised spot within about 20 km by iNaturalist. Not a census.',
    source: 'iNaturalist contributors',
    sourceUrl: 'https://www.inaturalist.org/',
    license: 'Per record: CC0, CC BY 4.0 or CC BY-SA 4.0 (credit the observer)',
    coverage: 'The current view when zoomed in (up to 200 most recent records).',
    auth: 'None',
    pollSeconds: 900,
    viewport: true,
  },
  airQuality: {
    id: 'airQuality',
    name: 'Air quality (Canada, AQHI)',
    group: 'Hazards',
    temporal: 'delayed',
    temporalNote: 'Hourly Air Quality Health Index observations on the 1–10+ health-risk scale: 1–3 low, 4–6 moderate, 7–10 high, above 10 very high. Each station shows its observation hour.',
    source: 'Environment and Climate Change Canada (MSC GeoMet)',
    sourceUrl: 'https://eccc-msc.github.io/open-data/msc-data/aqhi/readme_aqhi_en/',
    license: 'ECCC Data Servers End-use Licence (open, attribution required)',
    coverage: 'Canada only: about 120–200 AQHI stations.',
    auth: 'None',
    pollSeconds: 1800,
    viewport: false,
  },
  conflicts: {
    id: 'conflicts',
    name: 'Violence in the news (GDELT)',
    group: 'Hazards',
    temporal: 'delayed',
    temporalNote: 'Machine-coded from news reports (CAMEO codes 18–20: assault, fighting, mass violence), one point per article, at the place the coder found. Coding is often wrong: a building fire or a court case can be coded as fighting, and places can be a country centre. A report, not a confirmed event.',
    source: 'The GDELT Project, events 2.0',
    sourceUrl: 'https://www.gdeltproject.org/',
    license: 'GDELT terms: free for any use with citation of the GDELT Project; linked articles belong to their publishers',
    coverage: 'Worldwide news in GDELT’s sources. Starts with the last 3 hours and keeps up to 24 hours while the layer is on.',
    auth: 'None',
    pollSeconds: 900,
    viewport: false,
  },
  streetPhotos: {
    id: 'streetPhotos',
    name: 'Street-level photos',
    group: 'Cameras',
    temporal: 'static',
    temporalNote: 'Community street-level photos with the date each was taken; faces and plates are blurred by the services. Points show where photos exist within 500 m of the view centre when zoomed in.',
    source: 'KartaView · Panoramax',
    sourceUrl: 'https://panoramax.fr/',
    license: 'KartaView: CC BY-SA 4.0; Panoramax: per picture (shown on each)',
    coverage: 'Where volunteers have taken photos; patchy outside Europe and North America. Mapillary is not included (it needs a token).',
    auth: 'None',
    pollSeconds: 600,
    viewport: true,
  },
  datacenters: {
    id: 'datacenters',
    name: 'Data centres (OpenStreetMap)',
    group: 'Infrastructure',
    temporal: 'static',
    temporalNote: 'Buildings and sites tagged as data centres by OpenStreetMap contributors, bundled with the app. Each is one point at the centre of its mapped outline. Names and operators are as mapped; many sites are untagged or unnamed.',
    source: 'OpenStreetMap contributors (extract via God’s Eye View; the extraction date was not recorded)',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL 1.0 (attribution; share-alike for the database)',
    coverage: 'Worldwide where mapped: 4,352 sites. Incomplete by nature; absence on the map is not absence on the ground.',
    auth: 'None (bundled; no requests)',
    pollSeconds: 86400,
    viewport: false,
  },
  milSites: {
    id: 'milSites',
    name: 'Military sites (OpenStreetMap)',
    group: 'Military and surveillance',
    temporal: 'static',
    temporalNote: 'Bases, airfields, naval bases, ranges, barracks, training areas and military land as tagged by OpenStreetMap volunteers. Incomplete by nature and sometimes out of date: an empty area means nothing is mapped there, not that nothing is there. Each site is placed at its mapped point or at the centre of its mapped area; outlines are not drawn. Loaded for the area in view and reused for a day.',
    source: 'OpenStreetMap contributors (Overpass API)',
    sourceUrl: 'https://wiki.openstreetmap.org/wiki/Key:military',
    license: 'ODbL 1.0 (attribution; share-alike for the database)',
    coverage: 'The area in view when zoomed in below about 500 km (a block about 3° on a side; up to 800 mapped objects).',
    auth: 'None',
    pollSeconds: 3600,
    viewport: true,
  },
  alpr: {
    id: 'alpr',
    name: 'Plate-reader camera locations (OpenStreetMap)',
    group: 'Military and surveillance',
    temporal: 'static',
    temporalNote: 'Locations of automatic licence-plate reader cameras as tagged by OpenStreetMap volunteers (surveillance:type=ALPR), with the operator, maker and facing direction where mapped. Locations and tags only: the app has no plate reads, images or video, and tracks no vehicle or person. Mapping is uneven: dense in some cities, absent in others, and a mapped camera may have been removed.',
    source: 'OpenStreetMap contributors (Overpass API)',
    sourceUrl: 'https://wiki.openstreetmap.org/wiki/Tag:surveillance:type%3DALPR',
    license: 'ODbL 1.0 (attribution; share-alike for the database)',
    coverage: 'The area in view when zoomed in below about 80 km (a block about 0.3° on a side; up to 2,000 mapped cameras).',
    auth: 'None',
    pollSeconds: 3600,
    viewport: true,
  },
  landslides: {
    id: 'landslides',
    name: 'Landslide estimates after earthquakes (USGS)',
    group: 'Hazards',
    temporal: 'calculated',
    temporalNote: 'For significant earthquakes of the last 30 days, the USGS Ground Failure model estimates whether shaking is likely to have set off landslides: an alert level, the area likely affected and how many people live there. These are model estimates published within hours, not reports of landslides that happened; rain-triggered landslides are not included. The marker is the epicentre.',
    source: 'USGS Ground Failure (Nowicki Jessee et al. 2018 model)',
    sourceUrl: 'https://earthquake.usgs.gov/data/ground-failure/',
    license: 'U.S. government work (public domain)',
    coverage: 'Worldwide, for the earthquakes USGS runs the model on (usually magnitude 5.5 and above, or felt events).',
    auth: 'None',
    pollSeconds: 3600,
    viewport: false,
  },
  cables: {
    id: 'cables',
    name: 'Internet and telecom cables (OpenStreetMap)',
    group: 'Infrastructure',
    temporal: 'static',
    temporalNote: 'Telecommunication cables under water and under ground, as mapped by OpenStreetMap volunteers. This is a small part of the world\u2019s cables: most submarine systems are mapped only near the coast or not at all, and buried land cables are mapped in a few countries. Lines are as drawn in OpenStreetMap (often traced from charts or drawn schematically), not surveyed positions. An empty sea or region means nothing is mapped there, not that no cable runs there.',
    source: 'OpenStreetMap contributors (bundled extract)',
    sourceUrl: 'https://wiki.openstreetmap.org/wiki/Tag:communication%3Dline',
    license: 'ODbL 1.0 (attribution; share-alike for the database)',
    coverage: 'Worldwide where mapped; densest around Europe. Bundled with the app, so it shows the map as of the build date.',
    auth: 'None',
    pollSeconds: 86400,
    viewport: false,
  },
  dams: {
    id: 'dams',
    name: 'Dams and hydropower plants (sample)',
    group: 'Infrastructure',
    temporal: 'static',
    temporalNote: 'A bundled sample of 703 dam and hydropower sites from OpenStreetMap via Open Infrastructure Map, with name, operator, start date and output where mapped. Not every dam: OpenStreetMap maps far more.',
    source: 'OpenStreetMap contributors via Open Infrastructure Map (extract via God’s Eye View; the extraction date was not recorded)',
    sourceUrl: 'https://openinframap.org/',
    license: 'ODbL 1.0 (attribution; share-alike for the database)',
    coverage: 'Worldwide sample of 703 sites, mostly hydropower plants.',
    auth: 'None (bundled; no requests)',
    pollSeconds: 86400,
    viewport: false,
  },
  trafficFlow: {
    id: 'trafficFlow',
    name: 'Traffic flow (selected cities and Finland)',
    group: 'Sea and ground traffic',
    temporal: 'delayed',
    temporalNote: 'Measured traffic per road segment or roadside sensor, never individual vehicles. Finland compares speed with free-flow speed; Madrid and Paris publish their own congestion level; New York and Hong Kong publish speeds only, so their colours are speed bands. Each record shows its measurement time: Hong Kong about 1 minute old, Finland and Madrid about 5, New York often 1–2 hours, Paris hourly and about a day behind.',
    source: 'NYC DOT · Fintraffic · Hong Kong Transport Department · Ayuntamiento de Madrid · Ville de Paris',
    sourceUrl: 'https://www.digitraffic.fi/en/road-traffic/',
    license: 'NYC Open Data terms; CC BY 4.0 (Fintraffic); DATA.GOV.HK terms; Madrid open data terms; ODbL (Paris)',
    coverage: 'New York City, Finland, Hong Kong, Madrid and Paris only, loaded when the view is over them. Elsewhere there is no free public traffic-flow feed this app can use.',
    auth: 'None',
    pollSeconds: 120,
    viewport: true,
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
