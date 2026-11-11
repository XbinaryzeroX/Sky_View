import { Camera, Cloud, CloudSun, MapPin, Orbit, Plane, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LAYER_IDS, LAYERS, TEMPORAL_LABEL, type LayerGroup, type LayerId, type LayerSnapshot } from '../../shared/layers';
import type { Settings } from '../../shared/types';
import { api } from '../lib/api';
import { FRESHNESS_META, relativeTime } from '../lib/format';
import { clampDate, GIBS_CATEGORIES, GIBS_PRODUCTS, gibsProduct, latestDate, levelResolution, productKey, shiftDate, type ImageryState } from '../map/imageryOverlay';
import { VISUAL_MODE_LABEL, VISUAL_MODE_NOTE, type VisualMode } from '../map/visualModes';

const GROUPS: LayerGroup[] = ['Movement', 'Space', 'Hazards', 'Weather', 'Cameras', 'Reference'];

interface Props {
  alertsContent?: React.ReactNode;
  airportsOn?: boolean;
  onAirports?(): void;
  settings: Settings;
  snaps: Partial<Record<LayerId, LayerSnapshot>>;
  onPatch(p: Partial<Settings>): void;
  imagery: ImageryState;
  onImagery(s: ImageryState): void;
}

type Tab = 'live' | 'imagery' | 'style';

export function LayersPanel(p: Props) {
  const [tab, setTab] = useState<Tab>('live');
  const activeCount = p.settings.layersEnabled.length + (p.settings.radarEnabled ? 1 : 0) + (p.settings.geoSatEnabled ? 1 : 0);
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
            ['imagery', `Imagery${p.imagery.product ? ' •' : ''}`],
            ['style', 'Style'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`btn small-btn ${tab === id ? 'primary' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'live' ? <LiveTab {...p} /> : tab === 'imagery' ? <ImageryTab imagery={p.imagery} onImagery={p.onImagery} /> : <StyleTab settings={p.settings} onPatch={p.onPatch} />}
    </section>
  );
}

function LiveTab({ settings, snaps, onPatch, alertsContent, airportsOn, onAirports }: Props) {
  const on = new Set(settings.layersEnabled);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: LayerId) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPatch({ layersEnabled: LAYER_IDS.filter(layer => next.has(layer)) });
  };
  const needle = query.trim().toLowerCase();
  const matches = (id: LayerId) => !needle || [LAYERS[id].name, LAYERS[id].source, LAYERS[id].group].join(' ').toLowerCase().includes(needle);
  const icons = { Movement: Plane, Space: Orbit, Hazards: TriangleAlert, Weather: Cloud, Cameras: Camera, Reference: MapPin };
  return (
    <>
      <input className="view-name layer-search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Find a layer" aria-label="Find a layer" />
      {alertsContent && (!needle || 'alerts earthquakes weather boundaries saved locations'.includes(needle)) && (
        <details className="layer-group alert-layer-group" open>
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
      {(on.size > 0 || settings.radarEnabled || settings.geoSatEnabled) && (
        <button className="link-btn small" onClick={() => onPatch({ layersEnabled: [], radarEnabled: false, geoSatEnabled: false })}>Turn all live feeds off</button>
      )}
      <p className="muted small">Counts describe the loaded area or catalog, not the whole world.</p>
      {GROUPS.map(group => {
        const ids = LAYER_IDS.filter(id => LAYERS[id].group === group && matches(id));
        const radar = group === 'Weather' && (!needle || 'weather radar nowcoast'.includes(needle));
        const geoSat = group === 'Weather' && (!needle || 'weather satellite clouds goes himawari infrared geocolor'.includes(needle));
        if (!ids.length && !radar && !geoSat) return null;
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
              const freshness = status && enabled ? FRESHNESS_META[status.freshness] : null;
              return (
                <div key={id} className={'layer-row ' + (enabled ? 'on' : '')}>
                  <label className="layer-toggle">
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span className="layer-name">{meta.name}</span>
                    <input className="layer-switch" role="switch" type="checkbox" checked={enabled} onChange={() => toggle(id)} />
                  </label>
                  <details className="layer-info">
                    <summary>{TEMPORAL_LABEL[meta.temporal]} · Source &amp; coverage{enabled && status ? ' · ' + status.recordCount.toLocaleString() : ''}</summary>
                    <div className="layer-status small">
                      <p>{meta.temporalNote}</p>
                      <p className="muted">Source: {meta.source} · Coverage: {meta.coverage} · Terms: {meta.license} · Auth: {meta.auth}</p>
                      {enabled && status && <>
                        <p>{status.state === 'loading' ? 'Loading…' : freshness?.label} · {status.recordCount.toLocaleString()} records</p>
                        <p className="muted">Fetched {relativeTime(status.lastSuccessAt)} · {status.note}</p>
                        {status.error && <p className="err-text">Last refresh failed: {status.error}{status.lastSuccessAt ? ' (showing previous data)' : ''}</p>}
                        <button className="link-btn small" onClick={() => void api.refreshLayer(id)}>Refresh</button>
                      </>}
                      {enabled && id === 'fires' && (
                        <select aria-label="Fire detection region" value={settings.firmsRegion}
                          onChange={event => onPatch({ firmsRegion: event.target.value as Settings['firmsRegion'] })}>
                          <option value="us">U.S. (CONUS, HI, AK)</option><option value="global">Global (≈5 MB per refresh)</option>
                        </select>
                      )}
                      {enabled && id === 'satellites' && (
                        <div className="sat-groups small">
                          {(['stations', 'visual', 'gnss', 'weather', 'science', 'starlink'] as const).map(satelliteGroup => (
                            <label key={satelliteGroup}>
                              <input type="checkbox" checked={settings.satelliteGroups.includes(satelliteGroup)} onChange={event => onPatch({
                                satelliteGroups: event.target.checked ? [...settings.satelliteGroups, satelliteGroup]
                                  : settings.satelliteGroups.filter(value => value !== satelliteGroup),
                              })} />{satelliteGroup === 'starlink' ? 'Starlink (≈8,000)' : satelliteGroup}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
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
                <details className="layer-info"><summary>Observed · NOAA GOES, JMA Himawari via NASA GIBS</summary>
                  <p className="small muted">The newest full-disk frame from GOES-West, GOES-East and Himawari-9, checked every 10 minutes; frames are usually 30–60 minutes old (the time is in the credits). About 2 km per pixel (infrared) or 1 km (true colour): clouds, storms, smoke and dust, not ground detail. Covers the Americas, the Pacific, East Asia and Australia; Europe, Africa and the Indian Ocean are not covered (Meteosat is not in NASA GIBS). Not drawn over Google Photoreal 3D.</p>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ImageryTab({ imagery, onImagery }: { imagery: ImageryState; onImagery(s: ImageryState): void }) {
  const p = gibsProduct(imagery.product);
  const [playing, setPlaying] = useState(false);
  const ref = useRef(imagery);
  ref.current = imagery;
  const set = (patch: Partial<ImageryState>) => onImagery({ ...ref.current, ...patch });
  const daily = p?.period === 'P1D';
  // Time animation: steps one day forward through the 14 days ending at the latest available date.
  useEffect(() => {
    if (!playing || !p || !daily) return;
    const end = latestDate(p);
    const start = shiftDate(end, -13);
    const t = setInterval(() => {
      const cur = ref.current.date;
      set({ date: cur >= end || cur < start ? start : shiftDate(cur, 1) });
    }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, p?.id, daily]);
  const jump = (days: number | 'latest') => p && set({ date: days === 'latest' ? latestDate(p) : clampDate(p, shiftDate(latestDate(p), days)) });
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
          <div className="field-row">
            <label className="field">
              <span>{imagery.compare ? 'Left date' : 'Date (UTC)'}</span>
              <input type="date" value={imagery.date} min={p.firstDate?.slice(0, 10)} max={latestDate(p)} onChange={(e) => e.target.value && set({ date: clampDate(p, e.target.value) })} />
            </label>
            {daily && (
              <button className="btn small-btn" onClick={() => setPlaying((x) => !x)} aria-pressed={playing} title="Animate the last 14 available days">
                {playing ? '❚❚ Pause' : '▶ Play 14 days'}
              </button>
            )}
          </div>
          <div className="btn-row">
            <button className="btn small-btn" onClick={() => jump('latest')}>
              Latest
            </button>
            {daily && (
              <>
                <button className="btn small-btn" onClick={() => set({ date: clampDate(p, shiftDate(imagery.date, -1)) })}>
                  −1 d
                </button>
                <button className="btn small-btn" onClick={() => set({ date: clampDate(p, shiftDate(imagery.date, 1)) })}>
                  +1 d
                </button>
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
          <label className="check small">
            <input type="checkbox" checked={imagery.compare} onChange={(e) => set({ compare: e.target.checked, compareDate: clampDate(p, imagery.compareDate || shiftDate(imagery.date, -30)) })} /> Compare two dates (drag the
            divider on the map)
          </label>
          {imagery.compare && (
            <label className="field">
              <span>Right date</span>
              <input type="date" value={imagery.compareDate} min={p.firstDate?.slice(0, 10)} max={latestDate(p)} onChange={(e) => e.target.value && set({ compareDate: clampDate(p, e.target.value) })} />
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
                {p.firstDate?.slice(0, 10)} – {latestDate(p)} ({p.period === 'P1D' ? 'daily' : p.period === 'P1Y' ? 'yearly' : p.period === 'P1M' ? 'monthly' : p.period})
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
      <p className="muted small">News cards: unavailable. No licensed news source is connected (see Official bulletins for agency notices). Alert callouts: use the 🔔 notifications, which come from your watchlist and saved places.</p>
    </div>
  );
}
