// Domain types shared by the main process, preload bridge, and renderer.
// All timestamps are ISO-8601 strings in UTC unless noted otherwise.

import type { MultiPolygon, Polygon } from 'geojson';
import type { AreaWatchState } from './areaWatch';
import type { RenderScale } from './renderScale';

export type FeedId = 'nws' | 'usgs';

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface WeatherAlert {
  /** NWS alert identifier (URN), e.g. urn:oid:2.49.0.1.840.0.xxx */
  id: string;
  /** API URL for the record (feature id). */
  sourceUrl: string;
  event: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  status: string;
  messageType: string;
  category: string | null;
  sent: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  senderName: string | null;
  areaDesc: string | null;
  /** Zone URLs the alert applies to (forecast, county, fire, marine...). */
  affectedZones: string[];
  /** Some raw zone references were malformed or exceeded the normalization limit. */
  zoneCoverageIncomplete?: boolean;
  ugc: string[];
  same: string[];
  /** Identifiers of earlier alerts this one updates or replaces. */
  references: string[];
  geometry: Polygon | MultiPolygon | null;
  /** [minLon, minLat, maxLon, maxLat] of geometry, if present. */
  bbox: [number, number, number, number] | null;
}

export interface Earthquake {
  /** USGS preferred event id. */
  id: string;
  /** All associated ids across networks (includes id). */
  ids: string[];
  mag: number | null;
  magType: string | null;
  place: string | null;
  title: string | null;
  time: string; // ISO UTC
  updated: string; // ISO UTC
  lat: number;
  lon: number;
  depthKm: number | null;
  url: string | null;
  status: string | null;
  tsunami: boolean;
  sig: number | null;
  alert: string | null;
  eventType: string | null;
}

export type ZoneLookupStatus = 'pending' | 'resolved' | 'outside_coverage' | 'error' | 'disabled';

export interface LocationZones {
  status: ZoneLookupStatus;
  /** Normalized zone keys, e.g. "forecast/KSZ039", "county/KSC005", "fire/KSZ039". */
  zones: string[];
  checkedAt: string | null;
  error: string | null;
}

export interface SavedLocation {
  id: string;
  name: string;
  category: string;
  notes: string;
  lat: number;
  lon: number;
  radiusKm: number;
  createdAt: string;
  updatedAt: string;
  zones: LocationZones;
}

export interface LocationInput {
  name: string;
  category: string;
  notes: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

export type FeedState = 'idle' | 'loading' | 'ok' | 'error';

export interface FeedStatus {
  feed: FeedId;
  state: FeedState;
  /** Last time a request was attempted. */
  lastAttemptAt: string | null;
  /** Last time a request succeeded (data in memory was retrieved at this time). */
  lastSuccessAt: string | null;
  /** Source-reported generation/update time of the current dataset, if supplied. */
  sourceUpdatedAt: string | null;
  /** True when the current dataset was loaded from the on-disk cache rather than fetched this session. */
  fromCache: boolean;
  error: string | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  recordCount: number;
  skippedRecords: number;
  /** Completeness of the retrieved reply, independent of age and transport status. */
  coverage?: FeedCoverage;
  /** Actual successfully retrieved source scope, never inferred from an empty array. */
  scope?: string | null;
}

export interface FeedCoverage {
  completeness: 'complete' | 'partial' | 'unknown';
  skippedRecords: number | null;
  note: string | null;
}

export type Freshness = 'fresh' | 'stale' | 'unavailable';

export type AlertMatchStatus = 'inside' | 'outside' | 'unknown';
export type AlertMatchMethod = 'polygon' | 'zone' | 'none';

export interface AlertMatch {
  alertId: string;
  status: AlertMatchStatus;
  method: AlertMatchMethod;
}

export interface QuakeMatch {
  quakeId: string;
  distanceKm: number;
}

export interface LocationEvaluation {
  locationId: string;
  evaluatedAt: string;
  /** Alerts confirmed to contain the location. */
  alertsInside: AlertMatch[];
  /** Alerts for which intersection could not be determined. */
  alertsUnknown: AlertMatch[];
  /** Number of active alerts confirmed NOT to contain the location. */
  alertsOutsideCount: number;
  nwsFreshness: Freshness;
  /** Lifecycle time used for these NWS matches, distinct from wall-clock evaluatedAt. */
  nwsLifecycleAt?: string;
  nwsObservedAt?: string | null;
  nwsHistorical?: boolean;
  /** Explains why alert coverage may be incomplete (null when complete). */
  alertCoverageNote: string | null;
  quakesNearby: QuakeMatch[];
  usgsFreshness: Freshness;
}

export interface FeedDiff {
  feed: FeedId;
  at: string;
  added: string[];
  updated: string[];
  removed: string[];
  previousAt: string | null;
  /** A pair of replies can exist without supporting complete change totals. */
  unavailableReason?: string;
}

export interface QuakeQuery {
  window: 'hour' | 'day' | 'week' | 'month';
  minMagnitude: number;
}

export interface Settings {
  marketProvider: 'twelvedata' | 'alphavantage';
  marketWatchlist: string[];
  lemmyInstance: string;
  lemmyDefaultCommunity: string;
  lemmyShowNsfw: boolean;
  nwsContact: string;
  nwsPollSeconds: number;
  usgsPollSeconds: number;
  quakeWindow: QuakeQuery['window'];
  quakeMinMagnitude: number;
  /** When true, only earthquakes within a saved location's radius are drawn on the globe. */
  quakesNearLocationsOnly: boolean;
  historyRetentionDays: number;
  historyMaxRecords: number;
  zoneLookupEnabled: boolean;
  basemap: 'atlas' | 'streets' | 'usgsImageryTopo' | 'usgsTopo' | 'gibsDaily' | 'esri' | 'mapbox' | 'eox' | 'naturalEarth' | 'neutral' | 'google3d' | 'google2d' | 'ionBing';
  /** Selected acquisition year. Null uses the configured ordinary basemap. */
  imageryYear: number | null;
  labelsOverlay: boolean;
  buildings3d: boolean;
  units: 'metric' | 'imperial' | 'nautical';
  smoothMotion: boolean;
  /** App-built 3D models for the aircraft and ships nearest the camera (icons further away). */
  vehicleModels: boolean;
  /** Smooth the coarse NASA background wherever more detailed imagery has no coverage. */
  evenOcean: boolean;
  waterDetail: boolean;
  /** Decorative window grids on OSM building walls (generated, not the real building). */
  buildingFacades: boolean;
  /** Geographic (place/water) label level. */
  geoLabels: 'off' | 'minimal' | 'standard' | 'detailed';
  streetLabels: boolean;
  labelDensity: 'low' | 'medium' | 'high';
  labelSize: 'small' | 'medium' | 'large';
  labelLanguage: 'english' | 'local';
  /** Callsign/name labels on vehicles: only the selected one, also the one under the mouse, or all visible. */
  aircraftLabels: 'selected' | 'hovered' | 'all';
  vesselLabels: 'selected' | 'hovered' | 'all';
  /** Camera record ids the user starred (stored locally). */
  favoriteCameras: string[];
  /** Opt-in: exact aircraft model and photos of the exact aircraft/ship (adsbdb.com, Wikimedia Commons, airport-data.com). */
  aircraftPhotos: boolean;
  /** Opt-in: worldwide aircraft snapshot from OpenSky Network when zoomed out past the live-query limit. */
  worldAircraft: boolean;
  /** 'maximum' = sharpest tiles, MSAA, full device resolution, larger caches and building radius. */
  renderQuality: 'balanced' | 'maximum';
  /** Share of full resolution the globe is drawn at, per side; below 1 the image is stretched and sharpened. */
  renderScale: RenderScale;
  homeLat: number | null;
  homeLon: number | null;
  orgName: string;
  terrainEnabled: boolean;
  layersEnabled: string[];
  firmsRegion: 'us' | 'global';
  satelliteGroups: string[];
  trackRetentionHours: number;
  /** Disk budget for recorded movement fixes, in MB (converted to a point count with TRACK_BYTES_PER_POINT). */
  trackStorageMB: number;
  radarEnabled: boolean;
  /** NOAA nowCOAST lightning strike density (15-minute, about 8 km). */
  lightningEnabled: boolean;
  /** Highlight rivers and canals mapped in OpenStreetMap (OpenFreeMap vector tiles). */
  riversEnabled: boolean;
  /** TomTom live congestion tiles over the map (customer key, metered). */
  tomtomTraffic: boolean;
  /** Cesium World Terrain instead of the keyless terrain (customer Cesium ion token). */
  ionTerrain: boolean;
  /** Animated NOAA GFS 10 m wind forecast. */
  windEnabled: boolean;
  /** Colour the wind animation by speed band instead of plain white. */
  windColorBySpeed: boolean;
  /** Simulated vehicles moving along traffic-flow roads (an illustration from measured flow, not tracked cars). */
  trafficSimEnabled: boolean;
  /** Geostationary weather-satellite overlay (NASA GIBS, newest 10-minute frame). */
  geoSatEnabled: boolean;
  geoSatProduct: 'infrared' | 'color';
  visualMode: 'normal' | 'crt' | 'nvg' | 'thermal' | 'anime' | 'noir' | 'snow';
  reducedMotion: boolean;
  aiEnabled: boolean;
  /** Local bridge for AI agents (MCP) over a named pipe; off by default. */
  mcpEnabled: boolean;
  /** Watch area recorded in the background for replay (aircraft, ships, GPS cells, conflict reports); null when off. */
  recordAreaId: string | null;
  ollamaPort: number;
  ollamaModel: string;
}

export interface AppSnapshot {
  areaWatches: AreaWatchState;
  locations: SavedLocation[];
  alerts: WeatherAlert[];
  /** Alert ids superseded by a newer revision in the current dataset. */
  supersededAlertIds: string[];
  quakes: Earthquake[];
  feeds: Record<FeedId, FeedStatus>;
  freshness: Record<FeedId, Freshness>;
  evaluations: Record<string, LocationEvaluation>;
  diffs: Partial<Record<FeedId, FeedDiff>>;
  settings: Settings;
  generatedAt: string;
}

export type HistoryKind = 'alert' | 'quake';

export interface HistoryRecord {
  key: string;
  kind: HistoryKind;
  sourceId: string;
  title: string;
  severity: string | null;
  magnitude: number | null;
  eventTime: string | null;
  sourceUpdated: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  supersededBy: string | null;
  sourceUrl: string | null;
  lat: number | null;
  lon: number | null;
}

export interface HistoryRecordDetail extends HistoryRecord {
  payload: WeatherAlert | Earthquake;
}

export interface HistoryQuery {
  text?: string;
  kind?: HistoryKind | 'all';
  severity?: AlertSeverity | 'all';
  minMagnitude?: number | null;
  since?: string | null;
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
}

export interface HistoryPage {
  records: HistoryRecord[];
  total: number;
  storedTotal: number;
  oldestObservedAt: string | null;
}

export type DuplicateMode = 'skip' | 'update' | 'keep';

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

export interface AiStatus {
  enabled: boolean;
  reachable: boolean;
  models: string[];
  error: string | null;
  endpoint: string;
}

export interface AiAnswer {
  model: string;
  answer: string;
  generatedAt: string;
  contextRecordIds: string[];
}
