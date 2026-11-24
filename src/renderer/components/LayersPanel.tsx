import { Cable, Camera, Car, Waves, ChevronLeft, ChevronRight, Cloud, CloudSun, Leaf, Orbit, Pause, Plane, Play, Shield, Ship, TriangleAlert, Wind, Zap } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LAYER_GROUPS, LAYER_IDS, LAYERS, TEMPORAL_LABEL, type LayerGroup, type LayerId, type LayerSnapshot } from '../../shared/layers';
import type { ArchiveImage } from '../../shared/satelliteYears';
import { archiveCaption } from '../map/historicalImagery';
import type { Settings } from '../../shared/types';
import { compassPoint, sampleWind, WIND_SPEED_BANDS, windFromDeg, type WindField } from '../../shared/wind';
import { ReceiverCoverage } from './ReceiverCoverage';
import { SATELLITE_GROUPS, SATELLITE_SECTIONS, sectionColor } from '../../shared/satelliteGroups';
import { backLabel, clampBack, stepBack, WEATHER_MAX_BACK_MIN, WEATHER_STEP_MIN } from '../../shared/weatherTimeline';
import { api } from '../lib/api';
import { FRESHNESS_META, METAR_COLORS, METAR_UNKNOWN_COLOR, relativeTime } from '../lib/format';
import { clampDate, firstDate, GIBS_CATALOG_BUILT_AT, GIBS_CATEGORIES, GIBS_PRODUCTS, gibsProduct, imageryDates, latestDate, levelResolution, nextDate, playbackDates, productKey, shiftDate, type ImageryState } from '../map/imageryOverlay';
import { IMAGERY_DATES_TTL_MS } from '../../shared/imageryDates';
import { imageryHealth } from '../lib/imageryHealth';
import { VISUAL_MODE_LABEL, VISUAL_MODE_NOTE, type VisualMode } from '../map/visualModes';
import { DwdSourceStatus } from './DwdWarnings';
import { Time } from './common';

const GROUPS: readonly LayerGroup[] = LAYER_GROUPS;

interface Props {
  alertsContent?: React.ReactNode;
  airportsOn?: boolean;
  onAirports?(): void;
  settings: Settings;
  archived?: ArchiveImage | null;
  snaps: Partial<Record<LayerId, LayerSnapshot>>;
  playbackActive?: boolean;
  /** Show every category expanded at first (default: collapsed). */
  groupsOpen?: boolean;
  onPatch(p: Partial<Settings>): void;
  imagery: ImageryState;
  preserveImageryDates?: boolean;
  onImagery(s: ImageryState): void;
  wind?: WindState;
  viewCenter?(): { lat: number; lon: number } | null;
  /** Observed-weather history timeline (radar, lightning, satellites). */
  weather?: WeatherTimeState;
}

export interface WeatherTimeState { backMin: number; playing: boolean; onBack(backMin: number): void; onPlaying(on: boolean): void }

/** Step back, play and "newest" for the observed-weather overlays that are on. One timeline for all of them. */
function WeatherTimeline({ weather, reducedMotion }: { weather: WeatherTimeState; reducedMotion: boolean }) {
  const { backMin, playing } = weather;
  return (
    <div className="weather-time" role="group" aria-label="Observed weather history">
      <div className="weather-time-row">
        <button className="icon-btn" title="Older frame" aria-label="Older frame" disabled={backMin >= WEATHER_MAX_BACK_MIN} onClick={() => weather.onBack(stepBack(backMin, 1))}><ChevronLeft size={16} aria-hidden="true" /></button>
        <input type="range" aria-label="Minutes before the newest frames" min={-WEATHER_MAX_BACK_MIN} max={0} step={WEATHER_STEP_MIN} value={-backMin}
          aria-valuetext={backLabel(backMin)} onChange={(event) => weather.onBack(clampBack(-Number(event.target.value)))} />
        <button className="icon-btn" title="Newer frame" aria-label="Newer frame" disabled={backMin === 0} onClick={() => weather.onBack(stepBack(backMin, -1))}><ChevronRight size={16} aria-hidden="true" /></button>
        <button className="btn small" aria-pressed={playing} disabled={reducedMotion} title={reducedMotion ? 'Playing is off while reduced motion is on; step through the frames instead.' : 'Play the last four hours in a loop'}
          onClick={() => weather.onPlaying(!playing)}>{playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{playing ? 'Pause' : 'Play'}</button>
        <button className="btn small" disabled={backMin === 0 && !playing} onClick={() => weather.onBack(0)}>Newest</button>
      </div>
      <p className="small muted" role="status">{backLabel(backMin)}{backMin > 0 ? ' (observed then, not now)' : ''}. Radar and lightning show the publisher's frame nearest that time; hourly Meteosat steps once an hour.</p>
    </div>
  );
}

export interface WindState { field: WindField | null; staleReason: string | null; error: string | null; loading: boolean }

/** Forecast wind at the map centre, refreshed every 2 s while shown. */
function WindReading({ field, center }: { field: WindField; center(): { lat: number; lon: number } | null }) {
  const [at, setAt] = useState(center());
  useEffect(() => {
    const t = setInterval(() => setAt(center()), 2000);
    return () => clearInterval(t);
  }, [center]);
  const w = at ? sampleWind(field, at.lat, at.lon) : null;
  if (!at || !w) return <p className="small muted">Point the map at the ground to read the wind at its centre.</p>;
  const speed = Math.hypot(w.u, w.v);
  const from = windFromDeg(w.u, w.v);
  return (
    <p className="small">At the map centre: <strong>{speed.toFixed(1)} m/s</strong> ({(speed * 1.94384).toFixed(0)} kt) from the {compassPoint(from)} ({Math.round(from)}°), forecast for <Time iso={field.validTime} />.</p>
  );
}

type Tab = 'live' | 'imagery' | 'style';

function nifcReply(snapshot: LayerSnapshot | undefined) {
  const status = snapshot?.status;
  const received = status?.lastSuccessAt ? Date.parse(status.lastSuccessAt) : NaN;
  const loaded = Number.isFinite(received) && received <= Date.now();
  const current = loaded && status?.state === 'ok' && status.freshness === 'fresh' && !status.error;
  const partial = !!status && status.skippedRecords > 0;
  return { status, loaded, current, partial };
}

function NifcLayerStatus({ snapshot, enabled, replayActive }: { snapshot?: LayerSnapshot; enabled: boolean; replayActive?: boolean }) {
  const { status, loaded, current, partial } = nifcReply(snapshot);
  const state = replayActive ? 'replay' : !enabled ? 'disabled' : !loaded ? status?.state === 'loading' ? 'loading' : status?.error ? 'error' : 'unknown' : current ? partial ? 'partial' : 'current' : 'last-observed';
  return <div role="status" aria-label="NIFC perimeter source" data-nifc-state={state}>
    {replayActive ? <p>NIFC wildfire perimeters are not recorded in Replay. Live perimeter features are hidden.</p> : !enabled ? <p>NIFC wildfire perimeters are off.</p> : <>
      {!loaded ? <p>{status?.state === 'loading' ? 'Loading NIFC wildfire perimeters…' : 'No successful NIFC perimeter reply is available.'} Current perimeter coverage is unknown.</p> : <>
        <p><strong>{current ? partial ? 'Latest successful reply, partial' : 'Latest successful reply' : 'Last observed reply; current perimeter coverage is unknown'}</strong> · {status!.recordCount.toLocaleString()} perimeter features{partial ? ' in the retrieved subset' : ''}.</p>
        {status!.recordCount === 0 && <p>{current && !partial ? 'The complete reply returned no perimeter features. This does not establish no fires.' : 'No perimeter features were retained in that reply; this does not establish current absence.'}</p>}
        {partial && <p>{status!.skippedRecords.toLocaleString()} source features were skipped. The retrieved subset cannot establish complete coverage or absence.</p>}
        <p>Last successful reply received <Time iso={status!.lastSuccessAt} />. Boundary update times are supplied separately on each feature.</p>
        {status!.state === 'loading' && <p>Refreshing NIFC… Showing the last observed reply until a complete refresh succeeds.</p>}
        {status!.note && <p className="muted">{status!.note}</p>}
      </>}
      {status?.error && <p className="err-text">Last refresh failed: {status.error}</p>}
      {status?.nextAttemptAt && <p className="muted">Next scheduled check <Time iso={status.nextAttemptAt} />.</p>}
      <p className="muted">Features are published boundaries for some wildfires and prescribed fires, not a count of distinct incidents or every fire.</p>
      <button className="link-btn small" disabled={status?.state === 'loading'} onClick={() => void api.refreshLayer('firePerimeters')}>Refresh</button>
    </>}
  </div>;
}

export function LayersPanel(p: Props) {
  const [tab, setTab] = useState<Tab>('live');
  const activeCount = p.settings.layersEnabled.length + (p.settings.radarEnabled ? 1 : 0) + (p.settings.lightningEnabled ? 1 : 0) + (p.settings.windEnabled ? 1 : 0) + (p.settings.geoSatEnabled ? 1 : 0);
  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Layers</h2>
        <span className="count">{activeCount} on</span>
      </div>
      <div className="seg tabs" role="tablist" aria-label="Layer panel">
        {(
          [
            ['live', `Live data${activeCount ? ` (${activeCount})` : ''}`],
            ['imagery', `Imagery${p.imagery.product || p.archived ? ' •' : ''}`],
            ['style', 'Style'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`btn small-btn ${tab === id ? 'primary' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'live' && <LiveTab {...p} />}
      {tab === 'style' && <StyleTab settings={p.settings} onPatch={p.onPatch} />}
      {tab === 'imagery' && (p.archived ? <div className="imagery-tab">
        <h3>Satellite imagery · {p.archived.year}</h3>
        <p>{archiveCaption(p.archived)}</p>
        <p className="muted small">{p.archived.sentinelYear ? 'Sentinel-2 covers land and coasts at 10 m where available.' : 'The NASA pass nearest July 1 can show clouds and gaps.'} Map labels and tracked objects have their own dates.</p>
        <button className="btn small-btn" onClick={() => p.onPatch({ imageryYear: null })}>Return to automatic imagery</button>
      </div> : <ImageryTab imagery={p.imagery} onImagery={p.onImagery} preserveImageryDates={p.preserveImageryDates} />)}
    </section>
  );
}

function LiveTab({ settings, snaps, onPatch, alertsContent, airportsOn, onAirports, playbackActive, wind, viewCenter, weather, groupsOpen }: Props) {
  const on = new Set(settings.layersEnabled);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set(groupsOpen ? [] : GROUPS)); // Collapsed by default; a search still shows matches inside them.
  const toggle = (id: LayerId) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPatch({ layersEnabled: LAYER_IDS.filter(layer => next.has(layer)) });
  };
  const needle = query.trim().toLowerCase();
  const matches = (id: LayerId) => !needle || [LAYERS[id].name, LAYERS[id].source, LAYERS[id].group].join(' ').toLowerCase().includes(needle);
  const icons: Record<LayerGroup, typeof Plane> = { 'Air traffic': Plane, 'Sea and ground traffic': Ship, Space: Orbit, Weather: Cloud, Hazards: TriangleAlert, Cameras: Camera, Infrastructure: Cable, 'Military and surveillance': Shield, Nature: Leaf };
  return (
    <>
      <input className="view-name layer-search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Find a layer" aria-label="Find a layer" />
      {alertsContent && (!needle || 'alerts earthquakes weather boundaries saved locations'.includes(needle)) && (
        <details className="layer-group alert-layer-group" open={groupsOpen}>
          <summary>Alerts &amp; earthquakes</summary>
          {alertsContent}
        </details>
      )}
      {onAirports && (!needle || 'airports reference'.includes(needle)) && (
        <label className="layer-toggle">
          <Plane size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="layer-name">Airports</span>
          <input className="layer-switch" role="switch" type="checkbox" checked={!!airportsOn} onChange={onAirports} />
        </label>
      )}
      {(on.size > 0 || settings.radarEnabled || settings.lightningEnabled || settings.windEnabled || settings.geoSatEnabled) && (
        <button className="link-btn small" onClick={() => onPatch({ layersEnabled: [], radarEnabled: false, lightningEnabled: false, windEnabled: false, geoSatEnabled: false })}>Turn all live feeds off</button>
      )}
      <p className="muted small">Counts describe the loaded area or catalog, not the whole world.</p>
      {GROUPS.map(group => {
        const ids = LAYER_IDS.filter(id => LAYERS[id].group === group && matches(id));
        const radar = group === 'Weather' && (!needle || 'weather radar nowcoast'.includes(needle));
        const windRow = group === 'Weather' && (!needle || 'weather wind gfs forecast particles'.includes(needle));
        const lightning = group === 'Weather' && (!needle || 'weather lightning strikes thunderstorm'.includes(needle));
        const geoSat = group === 'Weather' && (!needle || 'weather satellite clouds goes himawari infrared geocolor'.includes(needle));
        const riversRow = group === 'Nature' && (!needle || 'nature rivers water canals waterways'.includes(needle));
        const tomtomRow = group === 'Sea and ground traffic' && (!needle || 'traffic tomtom congestion live roads'.includes(needle));
        if (!ids.length && !radar && !lightning && !windRow && !geoSat && !riversRow && !tomtomRow) return null;
        const isClosed = closed.has(group) && !needle;
        const Icon = icons[group];
        return (
          <div key={group} className="layer-group">
            <button className="layer-group-title group-toggle" aria-expanded={!isClosed} onClick={() => {
              const next = new Set(closed);
              if (next.has(group)) next.delete(group);
              else next.add(group);
              setClosed(next);
            }}>{isClosed ? '\u25b8' : '\u25be'} {group} <span className="muted">{ids.filter(id => on.has(id)).length || ''}</span></button>
            {!isClosed && ids.map(id => {
              const meta = LAYERS[id];
              const status = snaps[id]?.status;
              const enabled = on.has(id);
              const replayDwd = id === 'dwd' && playbackActive;
              const freshness = status && enabled ? FRESHNESS_META[status.freshness] : null;
              const nifc = id === 'firePerimeters' ? nifcReply(snaps.firePerimeters) : null;
              const nifcSummary = !nifc || !enabled || playbackActive ? '' : nifc.loaded
                ? ` · ${nifc.current ? 'Latest reply' : 'Last observed'}: ${status!.recordCount.toLocaleString()} perimeter features${nifc.partial ? ' (partial)' : ''}`
                : ' · Coverage unknown';
              return (
                <div key={id} className={'layer-row ' + (enabled ? 'on' : '')}>
                  <label className="layer-toggle">
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span className="layer-name">{meta.name}</span>
                    <input className="layer-switch" role="switch" type="checkbox" checked={enabled} onChange={() => toggle(id)} />
                  </label>
                  {enabled && id === 'trafficFlow' && (
                    <label className="layer-sub-toggle small">
                      <input type="checkbox" checked={settings.trafficSimEnabled} onChange={event => onPatch({ trafficSimEnabled: event.target.checked })} />
                      Simulated cars moving on the roads (illustration, not real vehicles)
                    </label>
                  )}
                  <details className="layer-info">
                    <summary>{TEMPORAL_LABEL[meta.temporal]} · Source &amp; coverage{nifc ? nifcSummary : enabled && status && !replayDwd ? ' · ' + status.recordCount.toLocaleString() : ''}</summary>
                    <div className="layer-status small">
                      <p>{meta.temporalNote}</p>
                      {id === 'dwd' && <DwdSourceStatus snapshot={snaps.dwd} enabled={enabled} replayActive={playbackActive} />}
                      {id === 'firePerimeters' && <NifcLayerStatus snapshot={snaps.firePerimeters} enabled={enabled} replayActive={playbackActive} />}
                      {id === 'metar' && <>
                        <p>Station colors show the flight category reported for the observation. Numbered clusters group nearby stations.</p>
                        <div className="legend-row" aria-label="Reported METAR flight categories">
                          {[...METAR_COLORS, ['Unknown', METAR_UNKNOWN_COLOR]].map(([category, color]) => (
                            <span className="legend-item" key={category}><span className="dot" aria-hidden="true" style={{ background: color }} />{category}</span>
                          ))}
                        </div>
                      </>}
                      <p className="muted">Source: {meta.source} · Coverage: {meta.coverage} · Terms: {meta.license} · Auth: {meta.auth}</p>
                      {enabled && status && !replayDwd && id !== 'firePerimeters' && <>
                        <p>{status.state === 'loading' ? 'Loading…' : freshness?.label} · {status.recordCount.toLocaleString()} records</p>
                        <p className="muted">Fetched {relativeTime(status.lastSuccessAt)} · {status.note}</p>
                        {status.error && <p className="err-text">Last refresh failed: {status.error}{status.lastSuccessAt ? ' (showing previous data)' : ''}</p>}
                        <button className="link-btn small" onClick={() => void api.refreshLayer(id)}>Refresh</button>
                      </>}
                      {enabled && id === 'trafficFlow' && <p className="muted">Simulated traffic: moving dots on the New York and Paris roads (the sources that publish road shapes). Each dot is invented; its speed is the road’s measured speed (Paris: assumed from the published state) and the number of dots follows the published flow count where there is one, otherwise a typical density for the state. Direction of travel is not published, so dots follow the line’s drawn order. Dots are spread across two assumed lanes; no source here publishes per-lane counts or speeds, so every lane moves at the road’s one speed. Roads with unknown readings get none. Shown when zoomed in below about 60 km; still with reduced motion.</p>}
                      {enabled && id === 'aircraft' && <ReceiverCoverage records={snaps.aircraft?.records ?? []} />}
                      {enabled && id === 'fires' && (
                        <select aria-label="Fire detection region" value={settings.firmsRegion}
                          onChange={event => onPatch({ firmsRegion: event.target.value as Settings['firmsRegion'] })}>
                          <option value="us">U.S. (CONUS, HI, AK)</option><option value="global">Global (≈5 MB per refresh)</option>
                        </select>
                      )}
                      {enabled && id === 'satellites' && (
                        <div className="sat-groups small">
                          {SATELLITE_SECTIONS.map(section => (
                            <fieldset key={section} className="sat-section">
                              <legend><span className="sat-swatch" style={{ background: sectionColor(section) }} aria-hidden="true" />{section}</legend>
                              {SATELLITE_GROUPS.filter(group => group.section === section).map(group => (
                                <label key={group.id}>
                                  <input type="checkbox" checked={settings.satelliteGroups.includes(group.id)} onChange={event => onPatch({
                                    satelliteGroups: event.target.checked ? [...settings.satelliteGroups, group.id]
                                      : settings.satelliteGroups.filter(value => value !== group.id),
                                  })} />{group.label} <span className="muted">≈{group.approx.toLocaleString()}</span>
                                </label>
                              ))}
                            </fieldset>
                          ))}
                          <p className="muted">Each group is one CelesTrak download at most every 2 hours. Positions are calculated from orbital elements. Groups overlap; each satellite is shown once.</p>
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
            {!isClosed && group === 'Weather' && weather && (settings.radarEnabled || settings.lightningEnabled || settings.geoSatEnabled) && (
              <WeatherTimeline weather={weather} reducedMotion={settings.reducedMotion} />
            )}
            {!isClosed && radar && (
              <div className="layer-row">
                <label className="layer-toggle"><Cloud size={16} aria-hidden="true" /><span className="layer-name">Weather radar (U.S.)</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.radarEnabled}
                    onChange={event => onPatch({ radarEnabled: event.target.checked })} />
                </label>
                <details className="layer-info"><summary>Observed · NOAA nowCOAST</summary>
                  <p className="small muted">U.S. radar reflectivity, typically 5–10 minutes old; refreshed every 5 minutes while on. Public domain.</p>
                </details>
              </div>
            )}
            {!isClosed && windRow && (
              <div className="layer-row">
                <label className="layer-toggle"><Wind size={16} aria-hidden="true" /><span className="layer-name">Wind (animated forecast)</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.windEnabled}
                    onChange={event => onPatch({ windEnabled: event.target.checked })} />
                </label>
                {settings.windEnabled && (
                  <label className="layer-sub-toggle small">
                    <input type="checkbox" checked={settings.windColorBySpeed} onChange={event => onPatch({ windColorBySpeed: event.target.checked })} />
                    Colour by speed
                  </label>
                )}
                {settings.windEnabled && settings.windColorBySpeed && (
                  <ul className="wind-legend small" aria-label="Wind speed colours">
                    {WIND_SPEED_BANDS.map((b) => <li key={b.label}><span className="wind-swatch" style={{ background: b.color }} aria-hidden="true" />{b.label}</li>)}
                  </ul>
                )}
                {settings.windEnabled && wind && (
                  <>
                    {wind.loading && !wind.field && <p className="small muted" role="status">Loading the latest NOAA GFS run…</p>}
                    {wind.error && <p className="small error-line" role="alert">Wind unavailable: {wind.error}</p>}
                    {wind.staleReason && <p className="small muted">{wind.staleReason}</p>}
                    {wind.field && (
                      <>
                        <p className="small muted">GFS run of <Time iso={wind.field.runTime} />, {wind.field.forecastHours} h forecast, valid <Time iso={wind.field.validTime} />.</p>
                        {viewCenter && <WindReading field={wind.field} center={viewCenter} />}
                      </>
                    )}
                  </>
                )}
                <details className="layer-info"><summary>Forecast · NOAA GFS</summary>
                  <p className="small muted">Wind 10 m above the ground from the NOAA Global Forecast System on a 1° grid (about 110 km), from the newest published run (every 6 hours, usually 4–5 hours old), at the 3-hour step closest to now. A model forecast, not measured wind; local gusts, valleys and coasts are smoothed out. The moving streaks show the direction and relative strength of the forecast flow (brighter is stronger); they are not tracked air. Drawn over the map and 3D buildings. With reduced motion, still arrows are shown instead. U.S. public domain; read from the NOAA Open Data registry on AWS.</p>
                </details>
              </div>
            )}
            {!isClosed && tomtomRow && (
              <div className="layer-row">
                <label className="layer-toggle"><Car size={16} aria-hidden="true" /><span className="layer-name">Live congestion (TomTom, your key)</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.tomtomTraffic}
                    onChange={event => onPatch({ tomtomTraffic: event.target.checked })} />
                </label>
                <details className="layer-info"><summary>Live · TomTom Traffic Flow</summary>
                  <p className="small muted">Road colours by current speed compared with free-flow speed (green free, orange slower, red slow, dark red queuing), worldwide where TomTom has probe data, refreshed every 2 minutes while on. Needs your TomTom key in Providers; every map tile counts against your TomTom allowance. It shows congestion on roads, not individual vehicles.</p>
                </details>
              </div>
            )}
            {!isClosed && riversRow && (
              <div className="layer-row">
                <label className="layer-toggle"><Waves size={16} aria-hidden="true" /><span className="layer-name">Rivers and canals</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.riversEnabled}
                    onChange={event => onPatch({ riversEnabled: event.target.checked })} />
                </label>
                <details className="layer-info"><summary>Static reference · OpenStreetMap</summary>
                  <p className="small muted">Rivers and canals as mapped by OpenStreetMap volunteers (OpenFreeMap vector tiles, ODbL), drawn as a bright line; streams appear when zoomed in close. This is the mapped course, not water level or flow, and small or seasonal channels may be missing.</p>
                </details>
              </div>
            )}
            {!isClosed && lightning && (
              <div className="layer-row">
                <label className="layer-toggle"><Zap size={16} aria-hidden="true" /><span className="layer-name">Lightning density</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.lightningEnabled}
                    onChange={event => onPatch({ lightningEnabled: event.target.checked })} />
                </label>
                <details className="layer-info"><summary>Observed · NOAA nowCOAST</summary>
                  <p className="small muted">Lightning strikes per area over the latest 15 minutes on an 8 km grid, from the U.S. National Lightning Detection Network and the global GLD360 network; refreshed every 5 minutes while on. Covers 25° S to 80° N from 110° E eastward across the Pacific and the Americas to 0° (not Europe, Africa or most of Asia). No colour means no strikes reported or outside coverage. Public domain.</p>
                </details>
              </div>
            )}
            {!isClosed && geoSat && (
              <div className="layer-row">
                <label className="layer-toggle"><CloudSun size={16} aria-hidden="true" /><span className="layer-name">Weather satellite (10-min)</span>
                  <input className="layer-switch" role="switch" type="checkbox" checked={settings.geoSatEnabled}
                    onChange={event => onPatch({ geoSatEnabled: event.target.checked })} />
                </label>
                {settings.geoSatEnabled && (
                  <select aria-label="Weather satellite imagery" value={settings.geoSatProduct} onChange={event => onPatch({ geoSatProduct: event.target.value === 'color' ? 'color' : 'infrared' })}>
                    <option value="infrared">Infrared clouds (day and night)</option>
                    <option value="color">True colour (GOES GeoColor; Himawari visible, daylight)</option>
                  </select>
                )}
                <details className="layer-info"><summary>Observed · NOAA GOES, EUMETSAT Meteosat, JMA Himawari</summary>
                  <p className="small muted">GOES-West, GOES-East and Himawari-9: the newest full-disk frame from NASA GIBS, checked every 10 minutes, usually 30–60 minutes old. Europe, Africa and the Indian Ocean: Meteosat from EUMETSAT, hourly frames only (on the hour, up to about 80 minutes old), because EUMETSAT licenses its more frequent recent images for non-commercial use. Each frame’s time is in the credits, so neighbouring areas can be from different times. About 2–3 km per pixel: clouds, storms, smoke and dust, not ground detail. Meteosat infrared shows clouds only (warm ground is left clear). Above about 81° north or south no geostationary satellite sees the surface. Not drawn over Google Photoreal 3D.</p>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ImageryTab({ imagery, onImagery, preserveImageryDates }: { imagery: ImageryState; onImagery(s: ImageryState): void; preserveImageryDates?: boolean }) {
  const p = gibsProduct(imagery.product);
  const [playing, setPlaying] = useState(false);
  const ref = useRef(imagery);
  ref.current = imagery;
  const dateRevision = useSyncExternalStore(imageryDates.subscribe, imageryDates.revision);
  const availability = p ? imageryDates.snapshot(p) : null;
  const tileHealth = useSyncExternalStore(imageryHealth.subscribe, imageryHealth.snapshot);
  const imageDates = tileHealth.product === imagery.product ? tileHealth.dates : [];
  const set = (patch: Partial<ImageryState>) => onImagery({ ...ref.current, ...patch });
  const daily = p?.period === 'P1D';
  useEffect(() => {
    if (!p) return;
    void imageryDates.load(p).catch(() => {});
    const poll = setInterval(() => { void imageryDates.load(p).catch(() => {}); }, IMAGERY_DATES_TTL_MS);
    return () => clearInterval(poll);
  }, [p?.id]);
  useEffect(() => {
    if (!p || !availability?.data || preserveImageryDates) return;
    const current = ref.current;
    const date = clampDate(p, current.date);
    const compareDate = clampDate(p, current.compareDate);
    if (date !== current.date || compareDate !== current.compareDate) set({ date, compareDate });
    // Source availability can change while a date remains selected; use the current state, not a stale request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, dateRevision, preserveImageryDates]);
  // Animate real source dates, skipping gaps. No tiles are fabricated for missing acquisition days.
  useEffect(() => {
    if (!playing || !p || !daily) return;
    const frames = playbackDates(p);
    if (frames.length < 2) { setPlaying(false); return; }
    const t = setInterval(() => {
      const cur = ref.current.date;
      const index = frames.indexOf(cur);
      set({ date: frames[(index + 1) % frames.length] });
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, p?.id, daily, dateRevision]);
  const jump = (days: number | 'latest') => p && set({ date: days === 'latest' ? latestDate(p) : clampDate(p, shiftDate(latestDate(p), days)) });
  const hasDates = !!p && !!latestDate(p);
  return (
    <div className="imagery-tab">
      <label className="field">
        <span>Product (NASA GIBS)</span>
        <select
          value={imagery.product ?? ''}
          onChange={(e) => {
            const np = gibsProduct(e.target.value || null);
            setPlaying(false);
            onImagery({ ...imagery, product: e.target.value || null, date: np ? clampDate(np, imagery.date || latestDate(np)) : imagery.date, compareDate: np ? clampDate(np, imagery.compareDate) : imagery.compareDate });
          }}
        >
          <option value="">None (base map only)</option>
          {GIBS_CATEGORIES.map((c) => (
            <optgroup key={c} label={c}>
              {GIBS_PRODUCTS.filter((x) => x.category === c).map((x) => (
                <option key={productKey(x)} value={productKey(x)}>
                  {x.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {p && (
        <>
          <p className="muted small">{p.note}</p>
          <p className="muted small" role="status">
            {availability?.state === 'loading' ? 'Checking dates with NASA GIBS… ' : ''}
            {availability?.checkedAt ? `Availability checked ${relativeTime(availability.checkedAt)}. ` : `Bundled availability snapshot: ${GIBS_CATALOG_BUILT_AT}; gaps have not yet been checked. `}
            {availability?.error ? `${availability.error}. ${availability.data ? 'Keeping the last checked availability.' : 'Keeping the bundled date bounds.'} ` : ''}
            {availability?.data?.skipped ? `${availability.data.skipped} malformed source period(s) were ignored. ` : ''}
            {preserveImageryDates ? 'Restored dates are kept exactly until you choose a different date or product. ' :
              availability?.data && hasDates ? 'Dates snap to the nearest listed acquisition; navigation and playback skip gaps. ' : ''}
            {!hasDates ? 'No source dates are currently available to draw. ' : ''}
            {latestDate(p) === new Date().toISOString().slice(0, 10) ? 'The newest UTC day is still in progress; coverage may be incomplete. ' : ''}
          </p>
          <button className="btn small-btn" disabled={availability?.state === 'loading'} onClick={() => { void imageryDates.load(p, true).catch(() => {}); }} title="At most one check per minute; publisher backoff is respected">
            Check date availability
          </button>
          {hasDates && <>
          <div className="field-row">
            <label className="field">
              <span>{imagery.compare ? 'Left date' : 'Date (UTC)'}</span>
              <input type="date" value={imagery.date} min={firstDate(p)} max={latestDate(p)} onChange={(e) => e.target.value && set({ date: clampDate(p, e.target.value) })} />
            </label>
            {daily && (
              <button className="btn small-btn" disabled={!availability?.data} onClick={() => setPlaying((x) => !x)} aria-pressed={playing} title="Check source availability before animating up to 14 dates; gaps are skipped">
                {playing ? '❚❚ Pause' : '▶ Play 14 dates'}
              </button>
            )}
          </div>
          <div className="btn-row">
            <button className="btn small-btn" onClick={() => jump('latest')}>
              Latest
            </button>
            <button className="btn small-btn" disabled={!availability?.data || nextDate(p, imagery.date, -1) === imagery.date} onClick={() => set({ date: nextDate(p, imagery.date, -1) })}>
              Previous date
            </button>
            <button className="btn small-btn" disabled={!availability?.data || nextDate(p, imagery.date, 1) === imagery.date} onClick={() => set({ date: nextDate(p, imagery.date, 1) })}>
              Next date
            </button>
            {daily && (
              <>
                <button className="btn small-btn" onClick={() => jump(-7)}>
                  −7 d
                </button>
                <button className="btn small-btn" onClick={() => jump(-30)}>
                  −30 d
                </button>
              </>
            )}
            <button className="btn small-btn" onClick={() => jump(-365)}>
              −1 y
            </button>
          </div>
          <section className="note small" data-imagery-health aria-label="Image tile availability">
            <div>Listed dates do not guarantee imagery in this view. Loaded tiles can still be blank or cloudy.</div>
            {imageDates.length === 0 ? <div>No image tile requests yet.</div> : imageDates.map((row) => (
              <div key={row.date} data-imagery-date={row.date} data-imagery-loaded={row.loaded} data-imagery-failed={row.failed}>
                <strong>{row.date}</strong>: {row.loaded} loaded · {row.failed} failed · {Math.max(0, row.requested - row.loaded - row.failed - row.cancelled)} pending
                {row.failed > 0 && <div>The source did not serve some requested tiles{row.lastError ? ` (${row.lastError})` : ''}. This date or view may be unavailable; try another listed date or view.</div>}
              </div>
            ))}
          </section>
          <label className="check small">
            <input type="checkbox" checked={imagery.compare} onChange={(e) => set({ compare: e.target.checked, compareDate: clampDate(p, imagery.compareDate || shiftDate(imagery.date, -30)) })} /> Compare two dates (drag the
            divider on the map)
          </label>
          {imagery.compare && (
            <label className="field">
              <span>Right date</span>
              <input type="date" value={imagery.compareDate} min={firstDate(p)} max={latestDate(p)} onChange={(e) => e.target.value && set({ compareDate: clampDate(p, e.target.value) })} />
            </label>
          )}
          <label className="field">
            <span>Opacity {Math.round(imagery.opacity * 100)}%</span>
            <input type="range" min={0.2} max={1} step={0.05} value={imagery.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} />
          </label>
          {p.legend && <img className="gibs-legend" src={p.legend} alt={`Legend for ${p.title}`} />}
          <dl className="kvs small">
            <div className="kv">
              <dt>Available</dt>
              <dd>
                {firstDate(p)} – {latestDate(p)} {availability?.data ? `(${availability.data.ranges.length} listed period${availability.data.ranges.length === 1 ? '' : 's'}; cadence may vary)` : `(${p.period}, bundled bounds)`}
              </dd>
            </div>
            <div className="kv">
              <dt>Best resolution</dt>
              <dd>{levelResolution(p.maxLevel)} per pixel (tile level {p.maxLevel})</dd>
            </div>
            <div className="kv">
              <dt>Valid time</dt>
              <dd>{p.period === 'P1D' ? 'Composite of overpasses during the UTC day; not a single instant.' : 'Composite over the product period.'}</dd>
            </div>
            <div className="kv">
              <dt>Source</dt>
              <dd>NASA GIBS · {p.id}</dd>
            </div>
          </dl>
          <p className="muted small">Clouds, night, swath gaps and dates without an observation show as published (often blank). This is archived satellite imagery, not a live camera.</p>
          </>}
        </>
      )}
      {!p && <p className="muted small">{GIBS_PRODUCTS.length} dated products in {GIBS_CATEGORIES.length} categories, from NASA’s Global Imagery Browse Services (free, no key). Pick one to draw it over the globe.</p>}
    </div>
  );
}

function StyleTab({ settings, onPatch }: { settings: Settings; onPatch(p: Partial<Settings>): void }) {
  return (
    <div className="style-tab">
      <div className="style-grid">
        {(Object.keys(VISUAL_MODE_LABEL) as VisualMode[]).map((m) => (
          <button key={m} className={`btn ${settings.visualMode === m ? 'primary' : ''}`} aria-pressed={settings.visualMode === m} onClick={() => onPatch({ visualMode: m })}>
            {VISUAL_MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="muted small">{VISUAL_MODE_NOTE[settings.visualMode as VisualMode]}</p>
      <p className="muted small">Display styles only change how the screen looks. They are not thermal, night-vision or snow measurements, and legends and data-age labels stay unfiltered.</p>
      <h3 className="sub">On the map</h3>
      <p className="muted small">Global news cards on the map are not connected. Markets already has source-linked GDELT context; Official bulletins shows agency notices. Alert callouts: use the 🔔 notifications from your watchlist and saved places.</p>
    </div>
  );
}
