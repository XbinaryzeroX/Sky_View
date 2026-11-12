import { publicAirlineCallsign, type RouteInfo } from '../../shared/route';
import { VehicleExtras } from './VehicleExtras';
import { FlightCard } from './FlightCard';
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
  const actions = (
    <div className="btn-row">
        <button className="btn" onClick={() => p.onFocus(footprint?.lat ?? r.lat, footprint?.lon ?? r.lon, footprint?.radiusKm ?? 30)} disabled={p.layer === 'satellites'}>
          Focus
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
        onEnablePhotos={() => p.onEnablePhotos?.()} onShowRoute={p.onShowRoute ?? ignoreRoute} onViewRoute={p.onViewRoute} onOpenProviders={() => p.onOpenProviders?.()}/> : <header className="details-head">
        <div className="eyebrow">{meta.name}</div>
        <h2>{r.label}</h2>
        <div className="tag-row">
          <span className={`tag temporal t-${meta.temporal}`}>{TEMPORAL_LABEL[meta.temporal]}</span>
          {r.category && <span className="tag">{r.category}</span>}
          {r.props.militaryFlag === true && <span className="tag sev-moderate">Military flag (unverified)</span>}
          {typeof r.props.emergency === 'string' && r.props.emergency !== 'none' && <span className="tag sev-extreme">Emergency: {r.props.emergency}</span>}
        </div>
      </header>}
      {!flightCard && actions}
      {!flightCard && (p.layer === 'aircraft' || p.layer === 'aircraftMil' || p.layer === 'vessels') && (
        <VehicleExtras key={`${p.layer}:${r.id}:${r.props.callsign ?? ''}`} layer={p.layer} r={r} photosEnabled={!!p.photosEnabled} onEnablePhotos={() => p.onEnablePhotos?.()} onShowRoute={p.onShowRoute ?? ignoreRoute} />
      )}
      <p className="muted small">{meta.temporalNote}</p>
      {perimeter && status && (status.state === 'error' || status.freshness !== 'fresh') && <p className="muted small">Last observed perimeter. Last successful refresh <Time iso={status.lastSuccessAt} />.{status.error && ` ${status.error}`}</p>}
      {p.tracked && movable && p.layer !== 'satellites' && <p className="muted small">The trail shows positions this app recorded while running (observed fixes joined by straight lines; not interpolated estimates).</p>}
      {p.orbitShown && <p className="muted small">The orbit line is a prediction from the orbital elements for about one revolution.</p>}
      {p.layer === 'satellites' && <SatellitePasses key={r.id} record={r} savedPlaces={p.savedPlaces} />}
      {flightCard ? <details className="flight-report"><summary>Full source report</summary>{sourceReport}</details> : sourceReport}
      {p.layer === 'cameras' ? <CameraPlayer key={r.id} media={cameraMedia(r)} title={r.label} /> : r.imageUrl && <CameraImage url={r.imageUrl} refreshMin={typeof r.props.updateFrequencyMin === 'number' ? r.props.updateFrequencyMin : null} />}
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
      <dl className="kvs">
        <div className="kv">
          <dt>Provider</dt>
          <dd>{r.source}</dd>
        </div>
        <div className="kv">
          <dt>{perimeter ? 'Dataset' : 'Record'}</dt>
          <dd>
            <ExternalLink url={r.sourceUrl}>Open source</ExternalLink>
          </dd>
        </div>
        <div className="kv">
          <dt>Record id</dt>
          <dd>
            <code className="wrap">{r.id}</code>
          </dd>
        </div>
        <div className="kv">
          <dt>Terms</dt>
          <dd>{meta.license}</dd>
        </div>
        <div className="kv">
          <dt>Coverage</dt>
          <dd>{meta.coverage}</dd>
        </div>
      </dl>
    </div>
  );
}
