import { publicAirlineCallsign, type RouteInfo } from '../../shared/route';
import { VehicleExtras } from './VehicleExtras';
import { FlightCard } from './FlightCard';
import { AtcListen } from './AtcListen';
import { LaunchReplay } from './LaunchReplay';
import { Building2, Cable, Camera, Clock, Cloud, Compass, Crosshair, Gauge, Globe2, Hash, Info, Leaf, Link2, MapPin, Mountain, Orbit, Plane, Scale, Shield, Ship, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { LayerGroup } from '../../shared/layers';

/** One icon per layer category, shown in the details header so the kind of record reads at a glance. */
const GROUP_ICON: Record<LayerGroup, LucideIcon> = { 'Air traffic': Plane, 'Sea and ground traffic': Ship, Space: Orbit, Weather: Cloud, Hazards: TriangleAlert, Cameras: Camera, Infrastructure: Cable, 'Military and surveillance': Shield, Nature: Leaf };

/** A key fact: icon, small label, bold value. */
function Fact({ icon: Icon, label, children, wide }: { icon: LucideIcon; label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`fact${wide ? ' wide' : ''}`}>
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" className="fact-icon" />
      <span className="fact-label">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}
import { nearestRecord } from '../../shared/nearest';

const NEAREST_CAMERA_LAYERS = new Set<string>(['aircraft', 'aircraftMil', 'vessels', 'fires', 'firePerimeters', 'transit', 'rail', 'trafficFlow', 'incidents']);
const NEAREST_CAMERA_KM = 50;
import { SatellitePasses } from './SatellitePasses';
import type { DwdWarning } from '../../shared/dwd';
import { DwdWarningDetails } from './DwdWarnings';
import type { SavedLocation } from '../../shared/types';
import { useEffect, useMemo, useState } from 'react';
import { CameraPlayer, cameraMedia } from './CameraPlayer';
import { geodesicDistanceKm, geometryBbox } from '../../shared/geo';
import { LAYERS, TEMPORAL_LABEL, type GeoRecord, type LayerId, type LayerSnapshot } from '../../shared/layers';
import { relativeTime } from '../lib/format';
import { Empty, ExternalLink, Time } from './common';
import { api } from '../lib/api';
import type { FlightPath } from '../../shared/flightPath';

/** Loads OpenSky's path for the selected aircraft's current flight, on request (each request uses OpenSky's free daily allowance). */
function FlightPathControl({ icao24, path, onPath }: { icao24: string; path: FlightPath | null; onPath(path: FlightPath | null): void }) {
  const [state, setState] = useState<{ for: string; busy: boolean; error: string | null }>({ for: icao24, busy: false, error: null });
  const current = state.for === icao24 ? state : { for: icao24, busy: false, error: null };
  const load = () => {
    setState({ for: icao24, busy: true, error: null });
    api.flightPath(icao24).then(
      (p) => { setState((s) => (s.for === icao24 ? { ...s, busy: false } : s)); if (p.icao24 === icao24) onPath(p); },
      (e: unknown) => setState((s) => (s.for === icao24 ? { for: icao24, busy: false, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'OpenSky did not answer.' } : s)),
    );
  };
  const shown = path && path.icao24 === icao24 ? path : null;
  return (
    <div className="flight-path">
      {shown ? (
        <>
          <p className="small">Flight path from OpenSky Network: {shown.points.length} waypoints{shown.startTime && <> from <Time iso={shown.startTime} /></>}{shown.endTime && <> to <Time iso={shown.endTime} /></>}. Drawn as a dashed amber line, apart from this app’s own recorded trail.</p>
          <p className="small muted">OpenSky’s recorded waypoints for the current flight only (not earlier flights). It keeps a point only where the course changes, so straight stretches are straight lines.</p>
          <button className="btn" onClick={() => onPath(null)}>Hide OpenSky path</button>
        </>
      ) : (
        <>
          <button className="btn" onClick={load} disabled={current.busy}>{current.busy ? 'Asking OpenSky…' : 'Show this flight’s path since takeoff'}</button>
          <p className="small muted">One request to OpenSky Network (free, about 100 per day without an account).</p>
          {current.error && <p className="small error-line" role="alert">{current.error}</p>}
        </>
      )}
    </div>
  );
}

interface Props {
  layer: LayerId;
  record: GeoRecord | null;
  dwdWarning?: DwdWarning | null;
  layerEnabled?: boolean;
  snaps: Partial<Record<LayerId, LayerSnapshot>>;
  tracked: boolean;
  orbitShown: boolean;
  onTrack(on: boolean): void;
  onOrbit(on: boolean): void;
  onSelect(layer: LayerId, id: string): void;
  onFocus(lat: number, lon: number, radiusKm?: number): void;
  watched?: boolean;
  onWatch?(on: boolean): void;
  photosEnabled?: boolean;
  onEnablePhotos?(): void;
  onShowRoute?(route: RouteInfo | null): void;
  onViewRoute?(route: RouteInfo): void;
  onOpenProviders?(): void;
  savedPlaces?: SavedLocation[];
  /** OpenSky's reported path for this aircraft's flight, when loaded. */
  flightPath?: FlightPath | null;
  onFlightPath?(path: FlightPath | null): void;
}

const PROP_LABEL: Record<string, string> = {
  icao24: 'ICAO address',
  groundTrackDeg: 'Ground track (°)',
  trueHeadingDeg: 'True heading (°)',
  directionSource: 'Map direction source',
  originCountry: 'Country of registration',
  streamUrl: 'Live stream (HLS)',
  mediaType: 'Media type',
  country: 'Country',
  locality: 'Locality',
  cityQuadrant: 'City quadrant (address grid, not camera direction)',
  roadClass: 'Road class',
  incidentType: 'Incident type',
  sourceSeverity: 'Source level',
  alertLevel: 'GDACS alert level',
  severityText: 'Severity (source)',
  startedAt: 'Started',
  updatedAt: 'Last update',
  endedAt: 'Ended',
  current: 'Current',
  sources: 'Reported by',
  sourceLinks: 'Source links',
  reportedBy: 'Number of sources',
  iso3: 'Country code',
  callsign: 'Callsign',
  registration: 'Registration',
  airframeYear: 'Airframe build year',
  ownerOperator: 'Reported owner / operator',
  type: 'Aircraft type',
  description: 'Type description',
  emitterCategory: 'Emitter category code',
  altitudeFt: 'Altitude (ft, barometric)',
  onGround: 'On ground',
  squawk: 'Squawk',
  emergency: 'Emergency status',
  militaryFlag: 'Military flag (database)',
  positionAgeS: 'Position age at fetch (s)',
  verticalRateFpm: 'Vertical rate (ft/min)',
  mmsi: 'MMSI',
  callSign: 'Call sign',
  destination: 'Reported destination',
  shipType: 'AIS ship type code',
  navStatus: 'Navigation status',
  courseDeg: 'Course over ground (°)',
  noradId: 'NORAD catalog #',
  elementEpoch: 'Orbital element epoch',
  group: 'CelesTrak group',
  satellite: 'Satellite',
  instrument: 'Instrument',
  confidence: 'Detection confidence',
  frpMW: 'Fire radiative power (MW)',
  brightnessK: 'Brightness temp. I4 (K)',
  region: 'FIRMS file',
  acres: 'Size (acres)',
  percentContained: 'Contained (%)',
  discovered: 'Discovered',
  state: 'State',
  incidentId: 'Incident ID',
  irwinId: 'IRWIN incident ID',
  globalId: 'NIFC feature GlobalID',
  objectId: 'NIFC feature OBJECTID',
  upper: 'Upper limit',
  lower: 'Lower limit',
  timesOfUse: 'Times of use',
  controllingAgency: 'Controlling agency',
  station: 'Station',
  tempC: 'Temperature (°C)',
  dewpointC: 'Dew point (°C)',
  windDir: 'Wind direction (°)',
  windKt: 'Wind (kt)',
  gustKt: 'Gust (kt)',
  visibility: 'Visibility (sm)',
  altimeterHpa: 'Altimeter (hPa)',
  weather: 'Present weather',
  flightCategory: 'Flight category',
  raw: 'Raw METAR',
  intensityKt: 'Max sustained wind (kt)',
  pressureMb: 'Min pressure (mb)',
  movementMph: 'Movement speed (mph)',
  route: 'Route',
  direction: 'Direction',
  county: 'County',
  nearbyPlace: 'Nearby place',
  updateFrequencyMin: 'Publisher refresh (min)',
  publisher: 'Publisher',
  catalogRecordUpdated: 'Catalog entry updated',
  presets: 'Camera presets',
  status: 'Status',
  imo: 'IMO number',
  destinationReported: 'Destination (reported)',
  etaReported: 'ETA (reported)',
  lengthM: 'Length (m)',
  beamM: 'Beam (m)',
  draughtM: 'Draught (m)',
  headingDeg: 'Heading (°)',
  siteKind: 'Kind of site',
  cableKind: 'Where it runs',
  landslideAlert: 'USGS landslide alert (estimate)',
  hazardAreaKm2: 'Area likely affected (km², modelled)',
  populationExposed: 'People living there (modelled)',
  modelledArea: 'Area the model covered',
  estimateUpdatedAt: 'Estimate updated',
  medium: 'Medium',
  mappedLengthKm: 'Mapped length (km, calculated)',
  manufacturer: 'Maker (as mapped)',
  branch: 'Service branch',
  access: 'Access (as mapped)',
  placedAt: 'Marker placed at',
  facingDeg: 'Facing (°, as mapped)',
  zone: 'Watches (as mapped)',
  mount: 'Mounted on',
  mappedNote: 'About this record',
  launchTime: 'Launch time (NET)',
  launchTimePrecision: 'Time precision',
  windowStart: 'Window opens',
  windowEnd: 'Window closes',
  statusAbbrev: 'Status (short)',
  failReason: 'Failure reason (reported)',
  provider: 'Provider',
  rocket: 'Rocket',
  mission: 'Mission',
  missionType: 'Mission type',
  missionDescription: 'Mission description',
  orbit: 'Target orbit',
  pad: 'Launch pad',
  site: 'Launch site',
  webcastLive: 'Webcast live',
  aircraft: 'Aircraft in cell (30 min)',
  degraded: 'Aircraft reporting low accuracy',
  scorePercent: 'Cell score (%, gpsjam.org formula)',
  level: 'Level',
  windowMinutes: 'Window (min)',
  system: 'System',
  bikesAvailable: 'Bikes available',
  docksAvailable: 'Free docks',
  capacity: 'Capacity',
  renting: 'Renting',
  installed: 'Installed',
  scientificName: 'Scientific name',
  observer: 'Observer',
  qualityGrade: 'iNaturalist quality grade',
  license: 'Licence',
  locationObscured: 'Location obscured by iNaturalist',
  positionalAccuracyM: 'Reported accuracy (m)',
  observedDateOnly: 'Date only (no time given)',
  aqhi: 'AQHI (exact)',
  aqhiShown: 'AQHI',
  band: 'Health-risk band',
  notes: 'Notes',
  cameoCode: 'CAMEO event code',
  place: 'Place (as coded)',
  newsSource: 'News source',
  mentions: 'Mentions in the update',
  placement: 'Placed at',
  author: 'Author',
  privacyBlur: 'Privacy',
  operator: 'Operator',
  serviceArea: 'Service area',
  vehicle: 'Vehicle',
  mode: 'Vehicle type',
  trip: 'Trip',
  nextStopId: 'Stop id',
  timeFrom: 'Time from',
  trainNumber: 'Train number',
  gpsFix: 'GPS position',
  owner: 'Owner (as mapped)',
  opened: 'Opened (as mapped)',
  levels: 'Building levels',
  heightTag: 'Height (as mapped)',
  plantSource: 'Power source',
  outputTag: 'Electrical output (as mapped)',
  position: 'Point placed at',
  speedKmh: 'Speed (km/h)',
  speedMph: 'Speed (mph)',
  travelTimeS: 'Travel time (s)',
  basis: 'Colour basis',
  borough: 'Borough',
  dir1SpeedKmh: 'Direction 1 speed (km/h)',
  dir1FreeFlowPercent: 'Direction 1, % of free-flow speed',
  dir1VehiclesPerHour: 'Direction 1 vehicles per hour',
  dir2SpeedKmh: 'Direction 2 speed (km/h)',
  dir2FreeFlowPercent: 'Direction 2, % of free-flow speed',
  dir2VehiclesPerHour: 'Direction 2 vehicles per hour',
  vehiclesIn30s: 'Vehicles in the last 30 s',
  validLanes: 'Lanes reporting',
  lanes: 'Lanes',
  levelOfService: 'Level of service (0–3)',
  loadPercent: 'Load (%)',
  vehiclesPerHour: 'Vehicles per hour',
  occupancyPercent: 'Occupancy (%)',
  stateReported: 'State (as published)',
  statusCode: 'Source status code',
  geometry: 'Road shape',
};

/** Identifier-like keys are shown without digit grouping (IMO 9401556, not 9,401,556). */
const ID_KEYS = /^(mmsi|imo|icao24|squawk|id|year|airframeYear|noradId|catalogNumber|objectId)$/i;
const ignoreRoute = (_route: RouteInfo | null) => {};

const perimeterFields = new Set(['gisAcres', 'incidentAcres', 'acres', 'dateCurrent', 'polygonDateTime']);

function perimeterArea(value: GeoRecord['props'][string]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString(undefined, { maximumSignificantDigits: 8 })} acres` : 'Not provided by NIFC';
}

function fmt(v: string | number | boolean | null, key = ''): string {
  if (v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? (ID_KEYS.test(key) ? String(v) : v.toLocaleString()) : v.toFixed(2);
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString();
  return v;
}

/** A street-level photo as published (no refresh): the service's own blurred copy, with its date and credit. */
function StreetPhoto({ url, taken, credit }: { url: string; taken: string | null; credit: string }) {
  const [err, setErr] = useState(false);
  return (
    <figure className="cam">
      {err ? <Empty>The photo could not be loaded from the service.</Empty> : <img src={url} alt="Street-level photo at this point" onError={() => setErr(true)} />}
      <figcaption className="muted small">Taken {taken ? new Date(taken).toLocaleDateString() : 'on an unknown date'}; it shows the street then, not now. {credit}.</figcaption>
    </figure>
  );
}

function CameraImage({ url, refreshMin }: { url: string; refreshMin: number | null }) {
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), Math.max(60, (refreshMin ?? 2) * 60) * 1000);
    return () => clearInterval(t);
  }, [refreshMin]);
  const src = `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 60000)}-${tick}`;
  return (
    <figure className="cam">
      {err ? (
        <Empty>The publisher’s image could not be loaded (camera offline or image unavailable).</Empty>
      ) : (
        <img
          src={src}
          alt="Latest published camera still"
          onLoad={() => {
            setErr(false);
            setLoadedAt(new Date().toISOString());
          }}
          onError={() => setErr(true)}
        />
      )}
      <figcaption className="muted small">Published still image. Loaded {relativeTime(loadedAt)}; the capture time is set by the publisher and may lag.</figcaption>
    </figure>
  );
}

export function RecordDetails(p: Props) {
  const meta = LAYERS[p.layer];
  const r = p.record;
  const status = p.snaps[p.layer]?.status;
  const perimeter = p.layer === 'firePerimeters';
  const footprint = useMemo(() => {
    const geometry = r?.geometry;
    if (!perimeter || !geometry || geometry.type === 'LineString') return null;
    const [west, south, east, north] = geometryBbox(geometry);
    const lon = ((west + east) / 2 + 540) % 360 - 180;
    const lat = (south + north) / 2;
    const radiusKm = Math.max(1, geodesicDistanceKm(lat, lon, north, east), geodesicDistanceKm(lat, lon, south, east));
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return { lat, lon, radiusKm, parts: parts.length, holes: parts.reduce((total, rings) => total + rings.length - 1, 0) };
  }, [perimeter, r?.geometry]);
  const nearby = useMemo(() => {
    if (!r || (p.layer !== 'aircraft' && p.layer !== 'aircraftMil' && p.layer !== 'vessels')) return [];
    const pool = [...(p.snaps.aircraft?.records ?? []).map((x) => ({ l: 'aircraft' as LayerId, x })), ...(p.snaps.vessels?.records ?? []).map((x) => ({ l: 'vessels' as LayerId, x }))];
    return pool
      .filter(({ x }) => x.id !== r.id)
      .map(({ l, x }) => ({ l, x, d: geodesicDistanceKm(r.lat, r.lon, x.lat, x.lon) }))
      .filter((o) => o.d <= 250)
      .sort((a, b) => a.d - b.d)
      .slice(0, 25);
  }, [r, p.snaps.aircraft, p.snaps.vessels, p.layer]);

  const nearestCamera = useMemo(() => {
    if (!r || !NEAREST_CAMERA_LAYERS.has(p.layer)) return null;
    return nearestRecord(r.lat, r.lon, p.snaps.cameras?.records ?? [], NEAREST_CAMERA_KM);
  }, [r, p.layer, p.snaps.cameras]);

  if (p.layer === 'dwd') return <DwdWarningDetails warning={p.dwdWarning ?? null} snapshot={p.snaps.dwd} enabled={p.layerEnabled ?? p.snaps.dwd?.status.enabled ?? false} record={r} onFocus={p.onFocus} />;
  if (perimeter && p.layerEnabled === false) return <Empty>Wildfire perimeters are turned off. Enable the layer in Hazards to view NIFC records.</Empty>;
  if (perimeter && !r && !status?.lastSuccessAt) return <Empty>{status?.state === 'loading' ? 'Loading the NIFC perimeter data…' : 'NIFC perimeter data is unavailable.'}</Empty>;
  if (!r) return <Empty>This record is no longer in the latest {meta.name.toLowerCase()} data (it may have left the coverage area or the view).</Empty>;
  const movable = p.layer === 'aircraft' || p.layer === 'aircraftMil' || p.layer === 'vessels' || p.layer === 'transit' || p.layer === 'satellites';
  const flightCard = p.layer === 'aircraft' && r.props.militaryFlag !== true;
  const sourceReport = (
    <dl className="kvs">
        {perimeter && <>
          <div className="kv"><dt>Mapped perimeter area</dt><dd>{perimeterArea(r.props.gisAcres)}</dd></div>
          <div className="kv"><dt>Reported incident size</dt><dd>{perimeterArea(r.props.incidentAcres)}</dd></div>
          <div className="kv"><dt>Polygon captured</dt><dd><Time iso={typeof r.props.polygonDateTime === 'string' ? r.props.polygonDateTime : null} /></dd></div>
          <div className="kv"><dt>Polygon record last edited</dt><dd><Time iso={typeof r.props.dateCurrent === 'string' ? r.props.dateCurrent : null} /></dd></div>
          {footprint && <div className="kv"><dt>Supplied footprint</dt><dd>{footprint.parts} polygon {footprint.parts === 1 ? 'part' : 'parts'} · {footprint.holes} interior {footprint.holes === 1 ? 'ring' : 'rings'}</dd></div>}
        </>}
        {p.layer !== 'satellites' && (
          <div className="kv">
            <dt>{perimeter ? 'Map focus coordinates' : 'Position'}</dt>
            <dd>
              {(footprint?.lat ?? r.lat).toFixed(4)}, {(footprint?.lon ?? r.lon).toFixed(4)}
            </dd>
          </div>
        )}
        {r.altM !== null && p.layer !== 'metar' && (
          <div className="kv">
            <dt>Altitude</dt>
            <dd>
              {Math.round(r.altM).toLocaleString()} m ({Math.round(r.altM / 0.3048).toLocaleString()} ft)
            </dd>
          </div>
        )}
        {r.heading !== null && p.layer !== 'metar' && (
          <div className="kv">
            <dt>Heading / course</dt>
            <dd>{Math.round(r.heading)}°</dd>
          </div>
        )}
        {r.speedKts !== null && p.layer !== 'metar' && (
          <div className="kv">
            <dt>Speed</dt>
            <dd>{r.speedKts.toFixed(1)} kt</dd>
          </div>
        )}
        {!perimeter && <div className="kv">
          <dt>{meta.temporal === 'calculated' ? 'Element epoch' : meta.temporal === 'static' ? 'Published' : p.layer === 'cameras' ? 'Image time' : 'Observed'}</dt>
          <dd>
            {r.observedAt ? (
              <>
                <Time iso={r.observedAt} /> <span className="muted">({relativeTime(r.observedAt)})</span>
              </>
            ) : p.layer === 'cameras' ? (
              <span className="muted">Set by the publisher; not provided in the catalog</span>
            ) : (
              '—'
            )}
          </dd>
        </div>}
        <div className="kv">
          <dt>Fetched</dt>
          <dd>
            <Time iso={status?.lastSuccessAt} />
          </dd>
        </div>
        {r.props.snapshot === true && (
          <div className="kv">
            <dt>Data type</dt>
            <dd>Worldwide snapshot (OpenSky Network), not a live track; position shown until the next refresh</dd>
          </div>
        )}
        {Object.entries(r.props)
          .filter(([k, v]) => v !== null && v !== '' && k !== 'snapshot' && k !== 'maxAgeS' && !(perimeter && perimeterFields.has(k)))
          .map(([k, v]) => (
            <div className="kv" key={k}>
              <dt>{PROP_LABEL[k] ?? k}</dt>
              <dd className={k === 'raw' ? 'mono' : ''}>{fmt(v, k)}</dd>
            </div>
          ))}
      </dl>
  );
  const timeLabel = meta.temporal === 'calculated' ? 'Element epoch' : meta.temporal === 'static' ? 'Published' : p.layer === 'cameras' ? 'Image time' : 'Observed';
  const keyFacts = (
    <div className="facts" aria-label="Key facts">
      {perimeter ? null : r.observedAt
        ? <Fact icon={Clock} label={timeLabel}><b>{relativeTime(r.observedAt)}</b> <span className="muted"><Time iso={r.observedAt} /></span></Fact>
        : <Fact icon={Clock} label={timeLabel}><span className="muted">{p.layer === 'cameras' ? 'Set by the publisher' : 'Not provided'}</span></Fact>}
      {p.layer !== 'satellites' && <Fact icon={MapPin} label={perimeter ? 'Map focus' : 'Position'}><span className="mono">{(footprint?.lat ?? r.lat).toFixed(4)}, {(footprint?.lon ?? r.lon).toFixed(4)}</span></Fact>}
      {r.altM !== null && p.layer !== 'metar' && <Fact icon={Mountain} label="Altitude"><b>{Math.round(r.altM / 0.3048).toLocaleString()} ft</b> <span className="muted">{Math.round(r.altM).toLocaleString()} m</span></Fact>}
      {r.speedKts !== null && p.layer !== 'metar' && <Fact icon={Gauge} label="Speed"><b>{r.speedKts.toFixed(0)} kt</b> <span className="muted">{Math.round(r.speedKts * 1.852)} km/h</span></Fact>}
      {r.heading !== null && p.layer !== 'metar' && <Fact icon={Compass} label="Heading"><b>{Math.round(r.heading)}°</b> <span className="muted">{['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((r.heading % 360) + 360) % 360 / 45) % 8]}</span></Fact>}
    </div>
  );
  const moreRows = (
    <dl className="kvs">
      {perimeter && <>
        <div className="kv"><dt>Mapped perimeter area</dt><dd>{perimeterArea(r.props.gisAcres)}</dd></div>
        <div className="kv"><dt>Reported incident size</dt><dd>{perimeterArea(r.props.incidentAcres)}</dd></div>
        <div className="kv"><dt>Polygon captured</dt><dd><Time iso={typeof r.props.polygonDateTime === 'string' ? r.props.polygonDateTime : null} /></dd></div>
        <div className="kv"><dt>Polygon record last edited</dt><dd><Time iso={typeof r.props.dateCurrent === 'string' ? r.props.dateCurrent : null} /></dd></div>
        {footprint && <div className="kv"><dt>Supplied footprint</dt><dd>{footprint.parts} polygon {footprint.parts === 1 ? 'part' : 'parts'} · {footprint.holes} interior {footprint.holes === 1 ? 'ring' : 'rings'}</dd></div>}
      </>}
      <div className="kv"><dt>Fetched</dt><dd><Time iso={status?.lastSuccessAt} /></dd></div>
      {r.props.snapshot === true && <div className="kv"><dt>Data type</dt><dd>Worldwide snapshot (OpenSky Network), not a live track; position shown until the next refresh</dd></div>}
      {Object.entries(r.props)
        .filter(([k, v]) => v !== null && v !== '' && k !== 'snapshot' && k !== 'maxAgeS' && k !== 'mappedNote' && !(perimeter && perimeterFields.has(k)))
        .map(([k, v]) => (
          <div className="kv" key={k}>
            <dt>{PROP_LABEL[k] ?? k}</dt>
            <dd className={k === 'raw' ? 'mono' : ''}>{fmt(v, k)}</dd>
          </div>
        ))}
    </dl>
  );
  const HeadIcon = GROUP_ICON[meta.group] ?? Info;
  const actions = (
    <div className="btn-row">
        <button className="btn" onClick={() => p.onFocus(footprint?.lat ?? r.lat, footprint?.lon ?? r.lon, footprint?.radiusKm ?? 30)} disabled={p.layer === 'satellites'}>
          <Crosshair size={15} aria-hidden="true" /> Focus
        </button>
        {movable && (
          <button className={`btn ${p.tracked ? 'primary' : ''}`} onClick={() => p.onTrack(!p.tracked)} aria-pressed={p.tracked}>
            {p.tracked ? 'Stop tracking' : publicAirlineCallsign(p.layer, r) ? 'Follow' : 'Track'}
          </button>
        )}
        {p.onWatch && (p.layer === 'aircraft' || p.layer === 'aircraftMil' || p.layer === 'vessels') && (
          <button className={`btn ${p.watched ? 'primary' : ''}`} onClick={() => p.onWatch!(!p.watched)} aria-pressed={p.watched}>
            {p.watched ? '★ Watching' : '☆ Watch'}
          </button>
        )}
        {p.layer === 'satellites' && (
          <button className={`btn ${p.orbitShown ? 'primary' : ''}`} onClick={() => p.onOrbit(!p.orbitShown)} aria-pressed={p.orbitShown}>
            {p.orbitShown ? 'Hide predicted orbit' : 'Show predicted orbit'}
          </button>
        )}
      </div>
  );
  return (
    <div className="details">
      {flightCard ? <FlightCard key={`${r.id}:${r.props.callsign ?? ''}:${r.props.registration ?? ''}:${r.props.snapshot === true}:${r.observedAt?.slice(0,10) ?? ''}`} record={r} actions={actions} photosEnabled={!!p.photosEnabled}
        onEnablePhotos={() => p.onEnablePhotos?.()} onShowRoute={p.onShowRoute ?? ignoreRoute} onViewRoute={p.onViewRoute} onOpenProviders={() => p.onOpenProviders?.()}/> : <header className="details-head details-head-icon">
        <span className="details-badge" aria-hidden="true"><HeadIcon size={20} strokeWidth={1.8} /></span>
        <div className="eyebrow">{meta.name}</div>
        <h2>{r.label}</h2>
        <div className="tag-row">
          <span className={`tag temporal t-${meta.temporal}`}>{TEMPORAL_LABEL[meta.temporal]}</span>
          {r.category && <span className="tag">{r.category}</span>}
          {r.props.militaryFlag === true && <span className="tag sev-moderate">Military flag (unverified)</span>}
          {typeof r.props.emergency === 'string' && r.props.emergency !== 'none' && <span className="tag sev-extreme">Emergency: {r.props.emergency}</span>}
        </div>
      </header>}
      {!flightCard && p.layer === 'cameras' && <CameraPlayer key={r.id} media={cameraMedia(r)} title={r.label} />}
      {!flightCard && keyFacts}
      {!flightCard && typeof r.props.mappedNote === 'string' && <p className="details-note"><Info size={14} aria-hidden="true" /> {r.props.mappedNote}</p>}
      {!flightCard && actions}
      {!flightCard && (p.layer === 'aircraft' || p.layer === 'aircraftMil' || p.layer === 'vessels') && (
        <VehicleExtras key={`${p.layer}:${r.id}:${r.props.callsign ?? ''}`} layer={p.layer} r={r} photosEnabled={!!p.photosEnabled} onEnablePhotos={() => p.onEnablePhotos?.()} onShowRoute={p.onShowRoute ?? ignoreRoute} />
      )}
      {flightCard ? <p className="muted small">{meta.temporalNote}</p> : <details className="details-about"><summary><Info size={14} aria-hidden="true" /> About this data · <b>{TEMPORAL_LABEL[meta.temporal]}</b></summary><p className="muted small">{meta.temporalNote}</p></details>}
      {perimeter && status && (status.state === 'error' || status.freshness !== 'fresh') && <p className="muted small">Last observed perimeter. Last successful refresh <Time iso={status.lastSuccessAt} />.{status.error && ` ${status.error}`}</p>}
      {p.tracked && movable && p.layer !== 'satellites' && <p className="muted small">The solid trail joins positions recorded while the app was running. For aircraft, the dashed end follows the displayed position, which can be estimated between reports.</p>}
      {p.orbitShown && <p className="muted small">The orbit line is a prediction from the orbital elements for about one revolution.</p>}
      {(p.layer === 'aircraft' || p.layer === 'aircraftMil') && /^[0-9a-f]{6}$/.test(r.id) && p.onFlightPath && <FlightPathControl icao24={r.id} path={p.flightPath ?? null} onPath={p.onFlightPath} />}
      {NEAREST_CAMERA_LAYERS.has(p.layer) && (
        <div className="nearest-camera">
          {nearestCamera ? (
            <button className="btn" onClick={() => p.onSelect('cameras', nearestCamera.record.id)}>
              <Camera size={16} strokeWidth={1.75} aria-hidden="true" /> Nearest camera: {nearestCamera.record.label} · {nearestCamera.distanceKm.toFixed(1)} km
            </button>
          ) : (
            <p className="small muted">{p.snaps.cameras?.status.enabled ? `No loaded camera within ${NEAREST_CAMERA_KM} km. Cameras load for covered regions only.` : 'Turn on Traffic cameras in Layers to find the nearest public camera.'}</p>
          )}
          {nearestCamera && <p className="small muted">The nearest loaded public camera, not one aimed at this record; it may not show it.</p>}
        </div>
      )}
      {(p.layer === 'aircraft' || p.layer === 'aircraftMil') && <AtcListen record={r} />}
      {p.layer === 'launches' && <LaunchReplay record={r} />}
      {p.layer === 'satellites' && <SatellitePasses key={r.id} record={r} savedPlaces={p.savedPlaces} />}
      {flightCard ? <details className="flight-report"><summary>Full source report</summary>{sourceReport}</details> : <><h3 className="sub">Details</h3>{moreRows}</>}
      {p.layer === 'streetPhotos' && r.imageUrl ? <StreetPhoto key={r.id} url={r.imageUrl} taken={r.observedAt} credit={r.source} /> : p.layer === 'cameras' ? null : r.imageUrl && <CameraImage url={r.imageUrl} refreshMin={typeof r.props.updateFrequencyMin === 'number' ? r.props.updateFrequencyMin : null} />}
      {nearby.length > 0 && (
        <>
          <h3 className="sub">Nearby contacts (≤ 250 km)</h3>
          <ul className="rec-list">
            {nearby.map(({ l, x, d }) => (
              <li key={`${l}-${x.id}`}>
                <button className="rec-item" onClick={() => p.onSelect(l, x.id)}>
                  <span className="tag">{l === 'vessels' ? 'Vessel' : 'Aircraft'}</span>
                  <span className="rec-title">{x.label}</span>
                  <span className="rec-meta">
                    {d.toFixed(1)} km{x.altM !== null && l !== 'vessels' ? ` · ${Math.round(x.altM / 0.3048).toLocaleString()} ft` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="sub">Source</h3>
      <ul className="source-list">
        <li><Building2 size={14} aria-hidden="true" /><span className="muted">Provider</span><b>{r.source}</b></li>
        <li><Link2 size={14} aria-hidden="true" /><span className="muted">{perimeter ? 'Dataset' : 'Record'}</span><ExternalLink url={r.sourceUrl}>Open source</ExternalLink></li>
        <li><Hash size={14} aria-hidden="true" /><span className="muted">Record id</span><code className="wrap">{r.id}</code></li>
        <li><Scale size={14} aria-hidden="true" /><span className="muted">Terms</span><span>{meta.license}</span></li>
        <li><Globe2 size={14} aria-hidden="true" /><span className="muted">Coverage</span><span>{meta.coverage}</span></li>
      </ul>
    </div>
  );
}
