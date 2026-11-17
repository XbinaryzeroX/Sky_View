// Navigation pages (left rail). Each page works on real loaded data or real
// locally persisted content, with empty/loading/unavailable states. Features
// that need a licensed source or a shared backend say so instead of pretending.

import { PlanningPanel, type PlanningPanelProps } from './PlanningPanel';
import { Globe, Camera, LayoutDashboard, Flag, Sparkles, Crosshair, PenLine, LayoutGrid, Plane, MapPin, Star, History, ScrollText, Users, ChartCandlestick, MessagesSquare, Building2, CircleHelp, ShieldCheck, Radio, type LucideIcon } from 'lucide-react';
import { MarketsPage } from './MarketsPage';
import { RadioPage } from './RadioPage';
import { CommunityPage } from './CommunityPage';
import { useEffect, useMemo, useState } from 'react';
import { CameraPlayer, cameraMedia } from './CameraPlayer';
import { CameraBoard } from './CameraBoard';
import { DwdSourceStatus, dwdView, dwdWarningTiming } from './DwdWarnings';
import { ConflictUpdates } from './ConflictUpdates';
import { boardCameraIds, CAMERA_BOARD_LIMITS, pinBoardCameras, type BoardDocument } from '../../shared/cameraBoards';
import { filterCameras, type CameraMediaFilter } from '../../shared/cameraDirectory';
import { aircraftClass, classifyAircraftQuery, elevationAngleDeg, specialCode, trackState } from '../../shared/aircraft';
import { answerQuestion, ANALYST_EXAMPLES, type AnalystAnswer } from '../../shared/analyst';
import { isAlertCountable } from '../../shared/dedupe';
import { geodesicDistanceKm } from '../../shared/geo';
import { LAYER_IDS, LAYERS, type GeoRecord, type LayerId, type LayerSnapshot } from '../../shared/layers';
import { TRACK_MAX_RETENTION_HOURS, TRACK_STORAGE_MAX_MB, TRACK_STORAGE_MIN_MB, TRACK_THIN_AFTER_HOURS, trackPointBudget } from '../../shared/timeline';
import type { AppSnapshot, Settings } from '../../shared/types';
import { fmtAltitudeM, fmtDistanceKm, fmtSpeedKts } from '../../shared/units';
import { AIRPORTS } from '../data/airports';
export { AIRPORTS } from '../data/airports';
import { api, errorText, type WatchItem } from '../lib/api';
import { FRESHNESS_META, relativeTime } from '../lib/format';
import { Empty, ExternalLink, SeverityTag, Time } from './common';

export type PageId =
  | 'globe'
  | 'ops'
  | 'events'
  | 'discover'
  | 'near'
  | 'track'
  | 'airports'
  | 'cameras'
  | 'watchlist'
  | 'replays'
  | 'boards'
  | 'people'
  | 'analyst'
  | 'bulletins'
  | 'markets'
  | 'social'
  | 'org'
  | 'help'
  | 'planning'
  | 'radio';

/** `short` is the rail label (one word); `label` is the full name used for tooltips, headings and screen readers. */
/** Rail groups in priority order. `NAV_UTILITY_GROUP` is rendered apart from the feature groups, with Providers and Settings. */
export const NAV_GROUPS = ['Monitor', 'Understand', 'Plan & track', 'Workspace'] as const;
export const NAV_UTILITY_GROUP = 'Settings & help';

export const NAV: { id: PageId; label: string; short: string; icon: LucideIcon; group: string; wide?: boolean }[] = [
  { id: 'globe', label: 'Globe', short: 'Globe', icon: Globe, group: 'Monitor' },
  { id: 'cameras', label: 'Cameras', short: 'Cameras', icon: Camera, group: 'Monitor' },
  { id: 'ops', label: 'Ops center', short: 'Ops', icon: LayoutDashboard, group: 'Monitor' },
  { id: 'radio', label: 'Radio', short: 'Radio', icon: Radio, group: 'Monitor' },
  { id: 'events', label: 'Events', short: 'Events', icon: Flag, group: 'Understand' },
  { id: 'discover', label: 'Discover', short: 'Discover', icon: Sparkles, group: 'Understand' },
  { id: 'near', label: 'Near me / overhead', short: 'Overhead', icon: Crosshair, group: 'Understand' },
  { id: 'bulletins', label: 'Official bulletins', short: 'Bulletins', icon: ScrollText, group: 'Understand' },
  { id: 'analyst', label: 'Analyst', short: 'Analyst', icon: PenLine, group: 'Understand' },
  { id: 'planning', label: 'Protective planning', short: 'Plan', icon: ShieldCheck, group: 'Plan & track' },
  { id: 'track', label: 'Track a flight', short: 'Flights', icon: Plane, group: 'Plan & track' },
  { id: 'airports', label: 'Airports', short: 'Airports', icon: MapPin, group: 'Plan & track' },
  { id: 'watchlist', label: 'Watchlist', short: 'Watch', icon: Star, group: 'Plan & track' },
  { id: 'replays', label: 'Replays', short: 'Replays', icon: History, group: 'Plan & track' },
  { id: 'boards', label: 'Boards', short: 'Boards', icon: LayoutGrid, group: 'Plan & track' },
  { id: 'markets', label: 'Markets', short: 'Markets', icon: ChartCandlestick, wide: true, group: 'Workspace' },
  { id: 'social', label: 'Community', short: 'Community', icon: MessagesSquare, wide: true, group: 'Workspace' },
  { id: 'people', label: 'Team directory', short: 'Team', icon: Users, group: 'Workspace' },
  { id: 'org', label: 'Organization', short: 'Org', icon: Building2, group: 'Workspace' },
  { id: 'help', label: 'Help & resources', short: 'Help', icon: CircleHelp, group: NAV_UTILITY_GROUP },
];

export interface PageCtx {
  playbackActive?: boolean;
  snap: AppSnapshot;
  layerSnaps: Partial<Record<LayerId, LayerSnapshot>>;
  patch(p: Partial<Settings>): void;
  selectRecord(layer: LayerId, id: string): void;
  selectEvent(kind: 'alert' | 'quake' | 'location', id: string): void;
  focus(lat: number, lon: number, radiusKm?: number): void;
  viewCenter(): { lat: number; lon: number } | null;
  viewBbox(): [number, number, number, number] | null;
  watchlist: WatchItem[];
  setWatchlist(items: WatchItem[]): void;
  openPlayback(): void;
  openAi(): void;
  openVisitBriefing(): void;
  openSettings(): void;
  openProviders(): void;
  toast(msg: string): void;
  enableLayers(ids: LayerId[]): void;
  /** Protective planning workspace (state lives in App so it survives page switches). */
  planningPanel?: PlanningPanelProps;
}


function Row({ onClick, tag, title, meta, warningId }: { onClick?: () => void; tag?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; warningId?: string }) {
  return (
    <li data-dwd-warning-id={warningId}>
      <button className="rec-item" onClick={onClick} disabled={!onClick}>
        {tag ?? <span />}
        <span className="rec-title">{title}</span>
        {meta && <span className="rec-meta">{meta}</span>}
      </button>
    </li>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      {sub && <p className="muted small">{sub}</p>}
    </div>
  );
}

const allAircraft = (ctx: PageCtx): GeoRecord[] => [...new Map([...(ctx.layerSnaps.aircraft?.records ?? []), ...(ctx.layerSnaps.aircraftMil?.records ?? [])].map((r) => [r.id, r])).values()];

// ---------------- Ops center ----------------
interface IncidentRow {
  key: string;
  type: string;
  title: string;
  country: string;
  when: string | null;
  sev: string;
  rank: number;
  source: string;
  link: string | null;
  lat: number | null;
  lon: number | null;
  reportedBy: number;
}

const SEV_RANK: Record<string, number> = { Red: 3, Orange: 2, Extreme: 3, Severe: 2, Green: 1, Moderate: 1 };

/** Incident register rows from connected sources. Severity labels are the sources' own. */
function incidentRows(ctx: PageCtx): IncidentRow[] {
  const rows: IncidentRow[] = [];
  for (const r of ctx.layerSnaps.incidents?.records ?? [])
    rows.push({
      key: r.id,
      type: String(r.props.incidentType ?? r.category ?? 'Other'),
      title: r.label,
      country: String(r.props.country ?? '—'),
      when: (r.props.updatedAt as string | null) ?? r.observedAt,
      sev: String(r.props.sourceSeverity ?? 'No level given'),
      rank: SEV_RANK[String(r.props.alertLevel)] ?? 0,
      source: String(r.props.sources ?? r.source),
      link: r.sourceUrl ?? null,
      lat: r.lat,
      lon: r.lon,
      reportedBy: Number(r.props.reportedBy ?? 1),
    });
  const now = Date.now();
  const sup = new Set(ctx.snap.supersededAlertIds);
  for (const a of ctx.snap.alerts)
    if ((a.severity === 'Extreme' || a.severity === 'Severe') && isAlertCountable(a, sup, now))
      rows.push({ key: `nws-${a.id}`, type: 'Weather warning (U.S.)', title: a.event + (a.areaDesc ? ` · ${a.areaDesc.slice(0, 80)}` : ''), country: 'United States', when: a.sent ?? null, sev: `NWS ${a.severity}`, rank: SEV_RANK[a.severity] ?? 0, source: 'NWS', link: null, lat: null, lon: null, reportedBy: 1 });
  for (const q of ctx.snap.quakes)
    if ((q.mag ?? 0) >= 5)
      rows.push({ key: `usgs-${q.id}`, type: 'Earthquake', title: q.place ?? 'Earthquake', country: (q.place ?? '').split(',').pop()?.trim() || '—', when: q.time, sev: `M${(q.mag ?? 0).toFixed(1)} (USGS)`, rank: (q.mag ?? 0) >= 7 ? 3 : (q.mag ?? 0) >= 6 ? 2 : 1, source: 'USGS', link: q.url ?? null, lat: q.lat, lon: q.lon, reportedBy: 1 });
  return rows;
}

function OpsPage({ ctx }: { ctx: PageCtx }) {
  const { snap } = ctx;
  const incOn = snap.settings.layersEnabled.includes('incidents');
  const all = incidentRows(ctx);
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [country, setCountry] = useState('all');
  const [hours, setHours] = useState(72);
  const [sort, setSort] = useState<'time' | 'sev'>('time');
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now();
  const inWindow = (r: IncidentRow) => !r.when || now - Date.parse(r.when) <= hours * 3600_000;
  const needle = q.trim().toLocaleLowerCase();
  const rows = all
    .filter((r) => inWindow(r) && (type === 'all' || r.type === type) && (country === 'all' || r.country === country) && (!needle || `${r.title} ${r.country} ${r.type}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (sort === 'sev' ? b.rank - a.rank : 0) || (Date.parse(b.when ?? '') || 0) - (Date.parse(a.when ?? '') || 0));
  const windowed = all.filter(inWindow);
  const types = [...new Set(all.map((r) => r.type))].sort();
  const countries = [...new Set(all.map((r) => r.country).filter((c) => c !== '—'))].sort();
  const lastHour = windowed.filter((r) => r.when && now - Date.parse(r.when) <= 3600_000).length;
  const multi = windowed.filter((r) => r.reportedBy > 1).length;
  // Trends: incidents per 6-hour bucket over the window, by source level.
  const buckets = Math.min(16, Math.max(4, Math.round(hours / 6)));
  const span = (hours * 3600_000) / buckets;
  const series = Array.from({ length: buckets }, (_, i) => {
    const t0 = now - hours * 3600_000 + i * span;
    const inB = windowed.filter((r) => r.when && Date.parse(r.when) >= t0 && Date.parse(r.when) < t0 + span);
    return { t0, hi: inB.filter((r) => r.rank >= 2).length, lo: inB.filter((r) => r.rank < 2).length };
  });
  const maxB = Math.max(1, ...series.map((b) => b.hi + b.lo));
  const byCountry = [...windowed.reduce((m, r) => (r.country !== '—' ? m.set(r.country, [...(m.get(r.country) ?? []), r]) : m), new Map<string, IncidentRow[]>())]
    .map(([c, list]) => ({ c, n: list.length, top: Math.max(...list.map((r) => r.rank)), types: [...new Set(list.map((r) => r.type))].join(', ') }))
    .sort((a, b) => b.top - a.top || b.n - a.n)
    .slice(0, 20);
  const feedRows: { name: string; on: boolean; fresh: string; n: number; last: string | null; err: string | null; cov: string }[] = [
    { name: 'NWS alerts', on: true, fresh: snap.freshness.nws, n: snap.feeds.nws.recordCount, last: snap.feeds.nws.lastSuccessAt, err: snap.feeds.nws.error, cov: 'United States' },
    { name: 'USGS earthquakes', on: true, fresh: snap.freshness.usgs, n: snap.quakes.length, last: snap.feeds.usgs.lastSuccessAt, err: snap.feeds.usgs.error, cov: 'Worldwide' },
    ...LAYER_IDS.map((id) => {
      const st = ctx.layerSnaps[id]?.status;
      return { name: LAYERS[id].name, on: !!st?.enabled, fresh: st?.freshness ?? 'unavailable', n: st?.recordCount ?? 0, last: st?.lastSuccessAt ?? null, err: st?.error ?? null, cov: LAYERS[id].coverage };
    }),
  ];
  const sevCls = (r: IncidentRow) => (r.rank >= 3 ? 'sev-extreme' : r.rank === 2 ? 'sev-severe' : r.rank === 1 ? 'sev-minor' : '');
  return (
    <>
      <Head title="Operations center" sub="Incidents from connected sources (GDACS, NASA EONET, NWS severe/extreme warnings, USGS M5+). Severity labels are each source’s own; the app adds no risk score." />
      {!incOn && (
        <button className="btn primary" onClick={() => ctx.enableLayers(['incidents'])}>
          Load worldwide incidents (GDACS, NASA EONET)
        </button>
      )}
      <div className="stat-grid ops-stats">
        <div className="stat">
          <b>{windowed.length}</b>
          <span>incidents, last {hours} h</span>
        </div>
        <div className="stat">
          <b>{windowed.filter((r) => r.rank >= 3).length}</b>
          <span>highest source level (Red / Extreme / M7+)</span>
        </div>
        <div className="stat">
          <b>{windowed.filter((r) => r.rank === 2).length}</b>
          <span>second level (Orange / Severe / M6+)</span>
        </div>
        <div className="stat">
          <b>{lastHour}</b>
          <span>updated in the last hour</span>
        </div>
        <div className="stat">
          <b>{new Set(windowed.map((r) => r.country).filter((c) => c !== '—')).size}</b>
          <span>countries named</span>
        </div>
        <div className="stat">
          <b>{multi}</b>
          <span>reported by 2 sources</span>
        </div>
      </div>

      <h3 className="sub">Incident register</h3>
      <div className="btn-row">
        <input className="view-name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search incidents" aria-label="Search incidents" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Time window">
          <option value={24}>24 h</option>
          <option value={72}>3 days</option>
          <option value={168}>7 days</option>
          <option value={720}>30 days</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'time' | 'sev')} aria-label="Sort">
          <option value="time">Newest first</option>
          <option value="sev">Source level first</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <Empty>{incOn || all.length ? 'No incidents match.' : 'Load the incident sources to fill the register.'}</Empty>
      ) : (
        <ul className="rec-list incident-list">
          {rows.slice(0, 150).map((r) => (
            <li key={r.key} className="incident">
              <button className="rec-item" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
                <span className={`tag ${sevCls(r)}`}>{r.sev}</span>
                <strong className="incident-title">{r.title}</strong>
                <span className="muted small">
                  {r.type} · {r.country} · {r.when ? `${relativeTime(r.when)} (${new Date(r.when).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : 'time not given'}
                </span>
              </button>
              {open === r.key && (
                <div className="incident-more small">
                  <div>Source: {r.source}{r.reportedBy > 1 ? ' (the same event reported by two sources)' : ''}</div>
                  <div className="btn-row">
                    {r.lat !== null && r.lon !== null && (
                      <button className="btn small-btn" onClick={() => ctx.focus(r.lat!, r.lon!, 300)}>
                        Show on map
                      </button>
                    )}
                    {r.link && (
                      <a className="btn small-btn" href={r.link} target="_blank" rel="noreferrer">
                        Source report
                      </a>
                    )}
                  </div>
                  {r.lat === null && <div className="muted">No single coordinate (area warning); not drawn as a point.</div>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="sub">Trends · last {hours} h</h3>
      <div className="trend" role="img" aria-label={`Incidents per ${Math.round(span / 3600_000)}-hour interval over the last ${hours} hours`}>
        {series.map((b, i) => (
          <div key={i} className="trend-bar" title={`${new Date(b.t0).toISOString().slice(5, 16).replace('T', ' ')} UTC: ${b.hi + b.lo}`}>
            <span className="hi" style={{ height: `${(b.hi / maxB) * 100}%` }} />
            <span className="lo" style={{ height: `${(b.lo / maxB) * 100}%` }} />
          </div>
        ))}
      </div>
      <p className="muted small">
        Bars: incidents by last update per {Math.round(span / 3600_000)} h. Dark = top two source levels, light = lower or no level. By type: {types.map((t) => `${t} ${windowed.filter((r) => r.type === t).length}`).join(' · ') || '—'}.
      </p>

      <h3 className="sub">Countries</h3>
      {byCountry.length === 0 ? (
        <Empty>No country-tagged incidents in this window.</Empty>
      ) : (
        <table className="mini-table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Incidents</th>
              <th>Types</th>
            </tr>
          </thead>
          <tbody>
            {byCountry.map((c) => (
              <tr key={c.c}>
                <td>
                  <button className="linkish" onClick={() => setCountry(c.c)}>
                    {c.c}
                  </button>
                </td>
                <td>{c.n}</td>
                <td className="small">{c.types}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Countries are as named by the sources and sorted by the highest source level, then count. This is not a country risk rating, and travel advisories are not connected.</p>

      <h3 className="sub">Source monitor</h3>
      <table className="mini-table">
        <thead>
          <tr>
            <th>Source</th>
            <th>State</th>
            <th>Records</th>
            <th>Last success</th>
          </tr>
        </thead>
        <tbody>
          {feedRows.map((r) => (
            <tr key={r.name} className={r.on ? '' : 'dim'} title={`Coverage: ${r.cov}${r.err ? `\nLast error: ${r.err}` : ''}`}>
              <td>{r.name}</td>
              <td>{r.on ? <span className={`mini-chip ${FRESHNESS_META[r.fresh as 'fresh'].cls}`}>{FRESHNESS_META[r.fresh as 'fresh'].label}</span> : <span className="muted">off</span>}</td>
              <td>{r.on ? r.n.toLocaleString() : '—'}</td>
              <td>
                {r.on ? relativeTime(r.last) : '—'}
                {r.err && r.on ? <span className="err-text" title={r.err}> ⚠</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Hover a row for coverage and the last error. Refresh intervals are set per source (Settings and each layer’s note).</p>
    </>
  );
}

// ---------------- Events ----------------
function EventsPage({ ctx }: { ctx: PageCtx }) {
  const [section, setSection] = useState<'incidents' | 'conflicts'>('incidents');
  const [kind, setKind] = useState<'all' | 'alert' | 'dwd' | 'quake' | 'fire' | 'cyclone' | 'squawk'>('all');
  const [limit, setLimit] = useState(300);
  const { snap } = ctx;
  const items = useMemo(() => {
    const out: { t: string; kind: string; title: string; meta: string; dwdId?: string; go(): void }[] = [];
    if (section === 'conflicts') return out;
    const sup = new Set(snap.supersededAlertIds);
    for (const a of snap.alerts.filter((x) => isAlertCountable(x, sup, Date.now())).slice(0, 300))
      out.push({ t: a.sent ?? '', kind: 'alert', title: `${a.event}`, meta: `NWS · ${a.severity} · ${a.areaDesc?.slice(0, 80) ?? ''}`, go: () => ctx.selectEvent('alert', a.id) });
    for (const q of snap.quakes.slice(0, 200)) out.push({ t: q.time, kind: 'quake', title: `M${q.mag?.toFixed(1) ?? '?'} ${q.place ?? ''}`, meta: 'USGS', go: () => ctx.selectEvent('quake', q.id) });
    for (const warning of dwdView(ctx.layerSnaps.dwd, snap.settings.layersEnabled.includes('dwd'), ctx.playbackActive).warnings)
      out.push({ t: warning.sent, kind: 'dwd', dwdId: warning.id, title: warning.headline ?? warning.event, meta: `DWD · Germany · ${warning.severity} · ${warning.areaDesc} · ${dwdWarningTiming(warning)}${!warning.geometry ? ' · no supplied map geometry' : warning.geometryStatus === 'partial' ? ' · partial map geometry' : ''}`, go: () => ctx.selectRecord('dwd', warning.id) });
    for (const c of ctx.layerSnaps.cyclones?.records ?? []) out.push({ t: c.observedAt ?? '', kind: 'cyclone', title: c.label, meta: 'NHC advisory', go: () => ctx.selectRecord('cyclones', c.id) });
    for (const f of [...(ctx.layerSnaps.fires?.records ?? [])].sort((a, b) => Number(b.props.frpMW ?? 0) - Number(a.props.frpMW ?? 0)).slice(0, 50))
      out.push({ t: f.observedAt ?? '', kind: 'fire', title: f.label, meta: `${f.lat.toFixed(2)}, ${f.lon.toFixed(2)} · FIRMS`, go: () => ctx.selectRecord('fires', f.id) });
    for (const r of allAircraft(ctx).filter((x) => specialCode(x))) out.push({ t: r.observedAt ?? '', kind: 'squawk', title: `${r.label}: ${specialCode(r)!.label}`, meta: 'Transponder report (not a confirmed incident)', go: () => ctx.selectRecord('aircraft', r.id) });
    return out.filter((i) => kind === 'all' || i.kind === kind).sort((a, b) => b.t.localeCompare(a.t));
  }, [snap, ctx.layerSnaps, kind, ctx.playbackActive, section]);
  return (
    <>
      <Head title="Events" sub={section === 'incidents' ? 'Current alerts, earthquakes, cyclones, strongest fire detections and special squawks from loaded feeds. Turn layers on to include them.' : 'Published updates on how armed conflicts affect civilians.'} />
      <div className="btn-row" role="group" aria-label="Event coverage">
        <button type="button" className={`btn ${section === 'incidents' ? 'primary' : ''}`} aria-pressed={section === 'incidents'} onClick={() => setSection('incidents')}>Incident feeds</button>
        <button type="button" className={`btn ${section === 'conflicts' ? 'primary' : ''}`} aria-pressed={section === 'conflicts'} onClick={() => setSection('conflicts')}>Conflict updates</button>
      </div>
      {section === 'conflicts' ? (
        ctx.playbackActive ? <Empty>Conflict updates cover the latest published reports. Exit Replay to read them.</Empty> : <ConflictUpdates />
      ) : <>
      <button className="link-btn" onClick={ctx.openPlayback}>Replay recorded alerts and earthquakes</button>
      {(kind === 'dwd' || (kind === 'all' && snap.settings.layersEnabled.includes('dwd'))) && <DwdSourceStatus snapshot={ctx.layerSnaps.dwd} enabled={snap.settings.layersEnabled.includes('dwd')} replayActive={ctx.playbackActive} onEnable={() => ctx.enableLayers(['dwd'])} compact />}
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Event type">
        <option value="all">All types</option>
        <option value="alert">Weather alerts (U.S.)</option>
        <option value="dwd">DWD warnings (Germany)</option>
        <option value="quake">Earthquakes</option>
        <option value="cyclone">Cyclones</option>
        <option value="fire">Fire detections</option>
        <option value="squawk">Special squawks</option>
      </select>
      {items.length === 0 ? (
        <Empty>No events of this type in the loaded data.</Empty>
      ) : (
        <ul className="rec-list">
          {items.slice(0, limit).map((i, k) => (
            <Row key={k} warningId={i.dwdId} onClick={i.go} tag={<span className="tag">{i.kind === 'dwd' ? 'DWD' : i.kind}</span>} title={i.dwdId ? <span lang="de">{i.title}</span> : i.title} meta={<>{i.t ? <Time iso={i.t} relative /> : '—'} · {i.meta}</>} />
          ))}
        </ul>
      )}
      {items.length > limit && <button className="btn small-btn" onClick={() => setLimit(value => value + 300)}>Show more events ({limit} of {items.length})</button>}
      </>}
    </>
  );
}

// ---------------- Discover ----------------
function largestPerimeterCard(ctx: PageCtx) {
  const snapshot = ctx.layerSnaps.firePerimeters;
  if (ctx.playbackActive || !ctx.snap.settings.layersEnabled.includes('firePerimeters') || !snapshot?.status.lastSuccessAt) return null;
  let largest: { record: GeoRecord; acres: number } | null = null;
  for (const record of snapshot.records) {
    const acres = record.props.gisAcres;
    if (typeof acres === 'number' && Number.isFinite(acres) && acres >= 0 && (!largest || acres > largest.acres)) largest = { record, acres };
  }
  if (!largest) return null;
  const { record, acres } = largest;
  const lastObserved = snapshot.status.state === 'error' || snapshot.status.freshness !== 'fresh';
  return {
    title: `Largest reported map area among loaded NIFC perimeters · ${lastObserved ? 'last successful refresh' : 'fetched'} ${relativeTime(snapshot.status.lastSuccessAt)}`,
    value: `${record.label} · ${acres.toLocaleString(undefined, { maximumSignificantDigits: 8 })} acres`,
    go: () => ctx.selectRecord('firePerimeters', record.id),
  };
}

function DiscoverPage({ ctx }: { ctx: PageCtx }) {
  const { snap } = ctx;
  const ac = allAircraft(ctx);
  const highest = [...ac].filter((r) => typeof r.props.altitudeFt === 'number').sort((a, b) => Number(b.props.altitudeFt) - Number(a.props.altitudeFt))[0];
  const fastest = [...ac].filter((r) => r.speedKts !== null).sort((a, b) => (b.speedKts ?? 0) - (a.speedKts ?? 0))[0];
  const biggestQuake = [...snap.quakes].sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))[0];
  const fire = [...(ctx.layerSnaps.fires?.records ?? [])].sort((a, b) => Number(b.props.frpMW ?? 0) - Number(a.props.frpMW ?? 0))[0];
  const ves = ctx.layerSnaps.vessels?.records ?? [];
  const cards: { title: string; value: string; go?: () => void }[] = [
    biggestQuake && { title: 'Largest earthquake in feed', value: `M${biggestQuake.mag?.toFixed(1)} ${biggestQuake.place ?? ''}`, go: () => ctx.selectEvent('quake', biggestQuake.id) },
    highest && { title: 'Highest loaded aircraft', value: `${highest.label} · ${Number(highest.props.altitudeFt).toLocaleString()} ft`, go: () => ctx.selectRecord('aircraft', highest.id) },
    fastest && { title: 'Fastest loaded aircraft (ground speed)', value: `${fastest.label} · ${Math.round(fastest.speedKts ?? 0)} kt`, go: () => ctx.selectRecord('aircraft', fastest.id) },
    fire && { title: 'Strongest fire detection', value: fire.label, go: () => ctx.selectRecord('fires', fire.id) },
    largestPerimeterCard(ctx),
    ves.length > 0 && { title: 'Vessels by type (loaded)', value: Object.entries(ves.reduce<Record<string, number>>((m, v) => ({ ...m, [v.category ?? 'Unknown']: (m[v.category ?? 'Unknown'] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(' · ') },
  ].filter(Boolean) as { title: string; value: string; go?: () => void }[];
  return (
    <>
      <Head title="Discover" sub="Notable items computed from currently loaded data. Turn on more layers for more." />
      {cards.length === 0 ? (
        <Empty>Nothing to show yet. Turn on aircraft, fires or vessels in Data layers.</Empty>
      ) : (
        <ul className="rec-list">
          {cards.map((c) => (
            <Row key={c.title} onClick={c.go} title={c.value} meta={c.title} />
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- Near me / overhead ----------------
function NearPage({ ctx }: { ctx: PageCtx }) {
  const s = ctx.snap.settings;
  const home = s.homeLat !== null && s.homeLon !== null ? { lat: s.homeLat, lon: s.homeLon } : null;
  const [useHome, setUseHome] = useState(!!home);
  const origin = useHome && home ? home : ctx.viewCenter();
  const [radius, setRadius] = useState(25);
  const [air, setAir] = useState<GeoRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (!origin) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await api.aircraftNear(origin.lat, origin.lon, Math.min(100, Math.max(5, Math.round(radius / 1.852))));
        if (alive) {
          setAir(r);
          setErr(null);
          setAt(new Date().toISOString());
        }
      } catch (e) {
        if (alive) setErr(errorText(e));
      }
    };
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [origin?.lat.toFixed(3), origin?.lon.toFixed(3), radius]);
  if (!origin) return <Empty>Move the globe or set a home location in Settings.</Empty>;
  const overhead = (air ?? [])
    .map((r) => {
      const d = geodesicDistanceKm(origin.lat, origin.lon, r.lat, r.lon);
      return { r, d, elev: r.altM !== null && !r.props.onGround ? elevationAngleDeg(d, r.altM) : null };
    })
    .filter((x) => x.d <= radius)
    .sort((a, b) => a.d - b.d);
  const quakes = ctx.snap.quakes.map((q) => ({ q, d: geodesicDistanceKm(origin.lat, origin.lon, q.lat, q.lon) })).filter((x) => x.d <= 300).sort((a, b) => a.d - b.d);
  return (
    <>
      <Head title="Near me / what's overhead" sub="Aircraft from adsb.lol around the chosen point (refreshed every 20 s), plus loaded events nearby." />
      <div className="btn-row">
        <label className="check small">
          <input type="radio" checked={useHome && !!home} disabled={!home} onChange={() => setUseHome(true)} /> Home{!home && ' (set in Settings)'}
        </label>
        <label className="check small">
          <input type="radio" checked={!useHome || !home} onChange={() => setUseHome(false)} /> View center
        </label>
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius">
          {[10, 25, 50, 100].map((r) => (
            <option key={r} value={r}>
              {fmtDistanceKm(r, s.units)}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Point {origin.lat.toFixed(3)}, {origin.lon.toFixed(3)} · fetched {relativeTime(at)}
        {err && <span className="err-text"> · {err}</span>}
      </p>
      <h3 className="sub">Aircraft ({overhead.length})</h3>
      {air === null ? (
        <p className="muted small">Loading…</p>
      ) : overhead.length === 0 ? (
        <Empty>No aircraft reported within this radius. Coverage depends on volunteer receivers.</Empty>
      ) : (
        <ul className="rec-list">
          {overhead.slice(0, 60).map(({ r, d, elev }) => (
            <Row
              key={r.id}
              onClick={() => {
                ctx.enableLayers(['aircraft']);
                ctx.focus(r.lat, r.lon, 20);
                ctx.selectRecord('aircraft', r.id);
              }}
              tag={<span className="tag">{elev !== null ? `${Math.round(elev)}° up` : 'GND'}</span>}
              title={r.label}
              meta={`${fmtDistanceKm(d, s.units)} · ${fmtAltitudeM(r.altM, s.units)} · ${fmtSpeedKts(r.speedKts, s.units)}${r.props.type ? ` · ${r.props.type}` : ''}`}
            />
          ))}
        </ul>
      )}
      <h3 className="sub">Earthquakes within 300 km (feed window)</h3>
      {quakes.length === 0 ? (
        <p className="muted small">None.</p>
      ) : (
        <ul className="rec-list">
          {quakes.slice(0, 20).map(({ q, d }) => (
            <Row key={q.id} onClick={() => ctx.selectEvent('quake', q.id)} title={`M${q.mag?.toFixed(1)} ${q.place ?? ''}`} meta={`${fmtDistanceKm(d, s.units)} to epicenter`} />
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- Track a flight ----------------
function TrackPage({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<GeoRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return allAircraft(ctx).filter((r) => r.id.includes(t) || r.label.toLowerCase().includes(t) || String(r.props.registration ?? '').toLowerCase().includes(t)).slice(0, 20);
  }, [q, ctx.layerSnaps]);
  async function search() {
    const c = classifyAircraftQuery(q);
    if (!c) {
      setErr('Enter a callsign (UAL123), ICAO hex (a1b2c3) or registration (N123AB, G-ABCD).');
      return;
    }
    setBusy(true);
    try {
      setRes(await api.lookupAircraft(q.trim()));
      setErr(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const go = (r: GeoRecord) => {
    ctx.enableLayers(['aircraft']);
    ctx.focus(r.lat, r.lon, 30);
    ctx.selectRecord('aircraft', r.id);
  };
  const watch = (r: GeoRecord) => {
    if (ctx.watchlist.some((w) => w.kind === 'aircraft' && w.id === r.id)) return;
    ctx.setWatchlist([...ctx.watchlist, { kind: 'aircraft', id: r.id, label: r.label, addedAt: new Date().toISOString() }]);
    ctx.toast(`Watching ${r.label}`);
  };
  const list = res ?? local;
  return (
    <>
      <Head title="Track a flight" sub="Search loaded aircraft, or look up worldwide on adsb.lol by callsign, ICAO hex or registration. Routes, origin and destination are not provided by this source." />
      <div className="btn-row">
        <input className="view-name" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="UAL123, a1b2c3, N123AB" maxLength={12} />
        <button className="btn small-btn primary" onClick={() => void search()} disabled={busy}>
          {busy ? 'Searching…' : 'Look up'}
        </button>
      </div>
      {err && <div className="error-line">{err}</div>}
      {res && res.length === 0 && <Empty>No aircraft with that identifier is currently reported by adsb.lol (it may not be airborne or not in feeder coverage).</Empty>}
      <ul className="rec-list">
        {list.map((r) => (
          <li key={r.id} className="row-actions">
            <button className="rec-item" onClick={() => go(r)}>
              <span className={`tag ${specialCode(r) ? 'sev-extreme' : ''}`}>{aircraftClass(r)}</span>
              <span className="rec-title">{r.label}</span>
              <span className="rec-meta">
                hex {r.id} · {r.props.registration ?? '—'} · {r.props.type ?? '—'} · {typeof r.props.altitudeFt === 'number' ? `${r.props.altitudeFt.toLocaleString()} ft` : r.props.onGround ? 'ground' : '—'} · seen {relativeTime(r.observedAt)}
              </span>
            </button>
            <button className="icon-btn" title="Add to watchlist" onClick={() => watch(r)}>
              ☆
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------- Airports ----------------
function AirportsPage({ ctx, selected }: { ctx: PageCtx; selected: string | null }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(selected);
  const [near, setNear] = useState<GeoRecord[] | null>(null);
  useEffect(() => setSel(selected), [selected]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return AIRPORTS.filter((a) => a[8] === 'L').slice(0, 40);
    return AIRPORTS.filter((a) => a[0].toLowerCase() === t || a[1].toLowerCase() === t || a[2].toLowerCase().includes(t) || a[7].toLowerCase().includes(t)).slice(0, 60);
  }, [q]);
  const ap = sel ? AIRPORTS.find((a) => a[0] === sel) : null;
  useEffect(() => {
    if (!ap) return;
    setNear(null);
    void api
      .aircraftNear(ap[3], ap[4], 15)
      .then(setNear)
      .catch(() => setNear([]));
  }, [ap?.[0]]);
  const s = ctx.snap.settings;
  return (
    <>
      <Head title="Airports" sub="5,282 large and medium airports from OurAirports (public domain), bundled offline." />
      <input className="view-name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ICAO, IATA, name or city" aria-label="Search airports" />
      {ap && (
        <div className="airport-card">
          <h3 className="sub">
            {ap[2]} ({ap[1] || '—'} / {ap[0]})
          </h3>
          <p className="muted small">
            {ap[7]}, {ap[6]} · elevation {ap[5] ?? '—'} ft · {ap[3].toFixed(4)}, {ap[4].toFixed(4)}
          </p>
          <h3 className="sub">Low aircraft within 15 nm, below 12,000 ft</h3>
          <p className="muted small">From adsb.lol at the time of opening. These are nearby low-altitude aircraft, not confirmed arrivals or departures.</p>
          {near === null ? (
            <p className="muted small">Loading…</p>
          ) : (
            <ul className="rec-list">
              {near
                .filter((r) => r.props.onGround || (typeof r.props.altitudeFt === 'number' && r.props.altitudeFt < 12000))
                .slice(0, 30)
                .map((r) => (
                  <Row
                    key={r.id}
                    onClick={() => {
                      ctx.enableLayers(['aircraft']);
                      ctx.selectRecord('aircraft', r.id);
                    }}
                    tag={<span className="tag">{r.props.onGround ? 'GND' : `${r.props.altitudeFt} ft`}</span>}
                    title={r.label}
                    meta={`${fmtDistanceKm(geodesicDistanceKm(ap[3], ap[4], r.lat, r.lon), s.units)} · ${r.props.type ?? ''}`}
                  />
                ))}
              {near.length === 0 && <Empty>No aircraft reported nearby.</Empty>}
            </ul>
          )}
        </div>
      )}
      <ul className="rec-list">
        {list.map((a) => (
          <Row
            key={a[0]}
            onClick={() => {
              setSel(a[0]);
              ctx.focus(a[3], a[4], 8);
            }}
            tag={<span className="tag">{a[1] || a[0]}</span>}
            title={a[2]}
            meta={`${a[7]}, ${a[6]}`}
          />
        ))}
      </ul>
    </>
  );
}

// ---------------- Cameras ----------------
function CamerasPage({ ctx }: { ctx: PageCtx }) {
  const cams = ctx.layerSnaps.cameras?.records ?? [];
  const on = ctx.snap.settings.layersEnabled.includes('cameras');
  const favs = ctx.snap.settings.favoriteCameras;
  const [q, setQ] = useState('');
  const [pub, setPub] = useState('all');
  const [media, setMedia] = useState<CameraMediaFilter>('all');
  const [inView, setInView] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardDocument[]>([]);
  const [boardId, setBoardId] = useState('');
  const [boardName, setBoardName] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [cameraBoard, setCameraBoard] = useState<{ title: string; ids: string[]; labels?: Record<string, string> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.listDocs<BoardDocument>('boards').then((docs) => { if (!cancelled) setBoards(docs); }).catch((e) => { if (!cancelled) setBoardError(errorText(e)); });
    return () => { cancelled = true; };
  }, []);
  const bbox = inView ? ctx.viewBbox() : null;
  const list = filterCameras(cams, { country: pub, media, favorites: favs, query: q, bbox });
  const countries = [...new Set(cams.map((c) => String(c.props.country ?? 'Unknown')))].sort();
  const videoCount = cams.filter((c) => c.props.mediaType === 'hls').length;
  const stillCount = cams.filter((c) => c.props.mediaType === 'still').length;
  const viewerCount = cams.filter((c) => c.props.mediaType === 'viewer').length;
  const publishers = [...new Set(cams.map((c) => c.source))].sort();
  const idx = openId ? list.findIndex((c) => c.id === openId) : -1;
  const open = idx >= 0 ? list[idx] : openId ? cams.find((c) => c.id === openId) : undefined;
  const toggleFav = (id: string) => ctx.patch({ favoriteCameras: favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id].slice(-500) });
  const chosenBoard = boards.find((b) => b.id === boardId);
  const saveBoard = async (board: BoardDocument) => {
    setBoardBusy(true);
    setBoardError(null);
    try {
      await api.putDoc('boards', { ...board });
      setBoards((prev) => prev.some((b) => b.id === board.id) ? prev.map((b) => b.id === board.id ? board : b) : [...prev, board]);
      setBoardId(board.id);
      setBoardName('');
    } catch (e) { setBoardError(`Board was not saved: ${errorText(e)}`); }
    finally { setBoardBusy(false); }
  };
  const openBoard = (title: string, ids: string[], labels?: Record<string, string>) => {
    setOpenId(null); // A board never runs alongside the single-camera player.
    setCameraBoard({ title, ids, labels });
  };
  if (!on)
    return (
      <>
        <Head title="Cameras" sub="Public traffic and weather cameras published by transportation agencies: live video where the publisher streams it, otherwise refreshed still images." />
        <button className="btn primary" onClick={() => ctx.enableLayers(['cameras'])}>
          Load camera catalogs
        </button>
      </>
    );
  return (
    <>
      <Head
        title="Cameras"
        sub={`${cams.length.toLocaleString()} published cameras in ${countries.length} countries/regions: ${videoCount.toLocaleString()} list video streams, ${stillCount.toLocaleString()} publish still images, ${viewerCount.toLocaleString()} link to official viewers. Stream availability is checked when played.`}
      />
      <details className="board" aria-label="Camera boards">
        <summary>Camera boards{chosenBoard ? ` · ${chosenBoard.name}` : ''}</summary>
        <p className="muted small">Group up to {CAMERA_BOARD_LIMITS.cameras} cameras in an existing local board. Four cameras and two video streams run at once.</p>
        <div className="btn-row">
          <select aria-label="Camera board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">Choose a board</option>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name} ({boardCameraIds(b).length} cameras)</option>)}
          </select>
          <button className="btn small-btn" disabled={!chosenBoard || boardCameraIds(chosenBoard).length === 0} onClick={() => chosenBoard && openBoard(chosenBoard.name, boardCameraIds(chosenBoard), Object.fromEntries(chosenBoard.items.filter((i) => i.kind === 'camera').map((i) => [i.id, i.label])))}>Open camera board</button>
          <button className="btn small-btn" disabled={!chosenBoard || !favs.length || boardBusy} onClick={() => chosenBoard && void saveBoard(pinBoardCameras(chosenBoard, favs.map((id) => ({ id, label: cams.find((c) => c.id === id)?.label ?? id }))))}>Pin favorites to board</button>
        </div>
        <div className="btn-row">
          <input className="view-name" aria-label="New camera board name" maxLength={80} value={boardName} onChange={(e) => setBoardName(e.target.value)} placeholder="New camera board name" />
          <button className="btn small-btn" disabled={!boardName.trim() || boardBusy} onClick={() => void saveBoard({ id: crypto.randomUUID().replace(/-/g, ''), name: boardName.trim(), notes: '', items: [], createdAt: new Date().toISOString() })}>Create camera board</button>
        </div>
        {chosenBoard && boardCameraIds(chosenBoard).length >= CAMERA_BOARD_LIMITS.cameras && <p className="small muted">This board has reached its {CAMERA_BOARD_LIMITS.cameras}-camera limit. Remove cameras from Boards to make room.</p>}
        {boardError && <p className="error" role="alert">{boardError}</p>}
      </details>
      <div className="btn-row"><button className="btn small-btn" disabled={!favs.length} onClick={() => openBoard('Favorites', favs, Object.fromEntries(cams.map((c) => [c.id, c.label])))}>Open favorite cameras</button></div>
      {open && (
        <section className="cam-open">
          <div className="cam-open-head">
            <strong>{open.label}</strong>
            <span className="muted small">{[open.props.locality, open.props.country].filter(Boolean).join(' · ')}</span>
          </div>
          <CameraPlayer key={open.id} media={cameraMedia(open)} title={open.label} />
          <div className="btn-row">
            <button className="btn" disabled={idx <= 0} onClick={() => setOpenId(list[idx - 1].id)}>
              ‹ Prev
            </button>
            <button className="btn" disabled={idx < 0 || idx >= list.length - 1} onClick={() => setOpenId(list[idx + 1].id)}>
              Next ›
            </button>
            <button
              className="btn"
              onClick={() => {
                ctx.focus(open.lat, open.lon, 2);
                ctx.selectRecord('cameras', open.id);
              }}
            >
              Show on map
            </button>
            <button className="btn" onClick={() => toggleFav(open.id)} aria-pressed={favs.includes(open.id)}>
              {favs.includes(open.id) ? '★ Favorite' : '☆ Favorite'}
            </button>
            <button className="btn" disabled={!chosenBoard || boardBusy} onClick={() => chosenBoard && void saveBoard(pinBoardCameras(chosenBoard, [open]))}>Pin camera to board</button>
            <button className="btn" onClick={() => setOpenId(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      <div className="btn-row">
        <input className="view-name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="City, road, area, camera…" aria-label="Search cameras" />
        <select value={pub} onChange={(e) => setPub(e.target.value)} aria-label="Country">
          <option value="all">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={media} onChange={(e) => setMedia(e.target.value as typeof media)} aria-label="Media type">
          <option value="all">All media types</option>
          <option value="hls">Live video listed</option>
          <option value="still">Still images</option>
          <option value="viewer">Official viewer links</option>
          <option value="fav">Favorites ({favs.length})</option>
        </select>
        <label className="check small">
          <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} /> In map view
        </label>
      </div>
      <p className="muted small">
        {list.length.toLocaleString()} match{list.length > 200 ? ' (first 200 shown)' : ''}.
      </p>
      {cameraBoard && <CameraBoard title={cameraBoard.title} ids={cameraBoard.ids} labels={cameraBoard.labels} records={cams} onClose={() => setCameraBoard(null)} onMap={(c) => { ctx.focus(c.lat, c.lon, 2); ctx.selectRecord('cameras', c.id); }} />}
      {list.length === 0 ? (
        <Empty>{cams.length === 0 ? 'Camera catalogs are loading or unavailable.' : 'No cameras match.'}</Empty>
      ) : (
        <ul className="rec-list">
          {list.slice(0, 200).map((c) => (
            <Row
              key={c.id}
              onClick={() => {
                setOpenId(c.id);
                ctx.focus(c.lat, c.lon, 2);
              }}
              tag={<span className={`tag ${c.props.mediaType === 'hls' ? 'tag-live' : ''}`}>{c.props.mediaType === 'hls' ? 'VIDEO' : c.props.mediaType === 'viewer' ? 'VIEWER' : 'STILL'}</span>}
              title={`${favs.includes(c.id) ? '★ ' : ''}${c.label}`}
              meta={[c.props.locality, c.props.country, c.props.publisher].filter(Boolean).join(' · ')}
            />
          ))}
        </ul>
      )}
      <p className="muted small">
        {publishers.length ? `Loaded publishers: ${publishers.join('; ')}.` : 'No camera catalogs loaded. Check the Cameras layer status for source errors and Providers → Camera keys for optional systems.'}
      </p>
    </>
  );
}

// ---------------- Watchlist ----------------
function WatchlistPage({ ctx }: { ctx: PageCtx }) {
  const now = Date.now();
  const air = new Map(allAircraft(ctx).map((r) => [r.id, r]));
  const ves = new Map((ctx.layerSnaps.vessels?.records ?? []).map((r) => [r.id, r]));
  return (
    <>
      <Head title="Watchlist" sub="Aircraft and vessels you follow. Status reflects currently loaded data; objects outside the queried area show as not in view." />
      {ctx.watchlist.length === 0 ? (
        <Empty>Add aircraft or vessels with ☆ from their details or from Track a flight.</Empty>
      ) : (
        <ul className="rec-list">
          {ctx.watchlist.map((w) => {
            const r = w.kind === 'aircraft' ? air.get(w.id) : ves.get(w.id);
            const st = r ? (w.kind === 'aircraft' ? trackState(r, now) : 'fresh') : null;
            return (
              <li key={`${w.kind}-${w.id}`} className="row-actions">
                <button
                  className="rec-item"
                  onClick={() => {
                    if (r) {
                      ctx.focus(r.lat, r.lon, 30);
                      ctx.selectRecord(w.kind === 'aircraft' ? 'aircraft' : 'vessels', w.id);
                    } else ctx.toast(`${w.label} is not in the loaded data right now.`);
                  }}
                >
                  <span className={`tag ${r && specialCode(r) ? 'sev-extreme' : st === 'fresh' ? 'ok-badge' : 'muted-badge'}`}>{r ? (specialCode(r) ? 'Special code' : st) : 'not in view'}</span>
                  <span className="rec-title">{w.label}</span>
                  <span className="rec-meta">
                    {w.kind} {w.id}
                    {r ? ` · seen ${relativeTime(r.observedAt)}` : ''}
                  </span>
                </button>
                <button className="icon-btn" title="Remove" onClick={() => ctx.setWatchlist(ctx.watchlist.filter((x) => !(x.kind === w.kind && x.id === w.id)))}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------------- Boards & people (local documents) ----------------
type Board = BoardDocument;
function BoardsPage({ ctx }: { ctx: PageCtx }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openBoard, setOpenBoard] = useState<Board | null>(null);
  useEffect(() => {
    void api.listDocs<Board>('boards').then(setBoards).catch((e) => setError(errorText(e)));
  }, []);
  const save = (b: Board) => {
    setBoards((prev) => (prev.some((x) => x.id === b.id) ? prev.map((x) => (x.id === b.id ? b : x)) : [...prev, b]));
    void api.putDoc('boards', { ...b }).catch((e) => setError(`Board was not saved: ${errorText(e)}`));
  };
  return (
    <>
      <Head title="Boards" sub="Local working boards: notes, pinned watchlist items and camera groups. Stored on this computer only." />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="btn-row">
        <input className="view-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New board name" />
        <button className="btn small-btn primary" disabled={!name.trim()} onClick={() => (save({ id: crypto.randomUUID().replace(/-/g, ''), name: name.trim(), notes: '', items: [], createdAt: new Date().toISOString() }), setName(''))}>
          Create
        </button>
      </div>
      {boards.length === 0 && <Empty>No boards yet.</Empty>}
      {boards.map((b) => (
        <div key={b.id} className="board">
          <div className="diag-head">
            <strong>{b.name}</strong>
            <button
              className="link-btn small"
              onClick={() => {
                setBoards((p) => p.filter((x) => x.id !== b.id));
                void api.deleteDoc('boards', b.id);
              }}
            >
              Delete
            </button>
          </div>
          <textarea className="board-notes" value={b.notes} maxLength={5000} onChange={(e) => save({ ...b, notes: e.target.value })} placeholder="Notes" rows={3} />
          <div className="btn-row">
            <button className="btn small-btn" disabled={ctx.watchlist.length === 0} onClick={() => save({ ...b, items: [...b.items, ...ctx.watchlist.filter((w) => !b.items.some((i) => i.id === w.id && i.kind === w.kind)).map((w) => ({ kind: w.kind, id: w.id, label: w.label }))] })}>
              Pin watchlist items
            </button>
            {boardCameraIds(b).length > 0 && <button className="btn small-btn" onClick={() => { if (!ctx.snap.settings.layersEnabled.includes('cameras')) ctx.enableLayers(['cameras']); setOpenBoard(b); }}>Open cameras ({boardCameraIds(b).length})</button>}
          </div>
          <ul className="small">
            {b.items.map((i) => (
              <li key={`${i.kind}:${i.id}`}>
                {i.kind}: {i.label}{' '}
                <button className="link-btn small" onClick={() => save({ ...b, items: b.items.filter((x) => x.id !== i.id || x.kind !== i.kind) })}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {openBoard && <CameraBoard title={openBoard.name} ids={boardCameraIds(openBoard)} labels={Object.fromEntries(openBoard.items.filter((i) => i.kind === 'camera').map((i) => [i.id, i.label]))} records={ctx.layerSnaps.cameras?.records ?? []} onClose={() => setOpenBoard(null)} onMap={(c) => { ctx.focus(c.lat, c.lon, 2); ctx.selectRecord('cameras', c.id); }} />}
    </>
  );
}

interface Person {
  id: string;
  name: string;
  role: string;
  contact: string;
  createdAt: string;
}
function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [p, setP] = useState({ name: '', role: '', contact: '' });
  useEffect(() => {
    void api.listDocs<Person>('people').then(setPeople);
  }, []);
  return (
    <>
      <Head title="Team directory" sub="An opt-in contact list for your own team (for example, who to call about a property). Stored locally. Sky_View does not locate or track people." />
      <div className="field-row">
        <input className="view-name" placeholder="Name" maxLength={80} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        <input className="view-name" placeholder="Role" maxLength={80} value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} />
        <input className="view-name" placeholder="Phone / email" maxLength={120} value={p.contact} onChange={(e) => setP({ ...p, contact: e.target.value })} />
        <button
          className="btn small-btn primary"
          disabled={!p.name.trim()}
          onClick={() => {
            const doc = { id: crypto.randomUUID().replace(/-/g, ''), ...p, createdAt: new Date().toISOString() };
            setPeople([...people, doc]);
            void api.putDoc('people', doc);
            setP({ name: '', role: '', contact: '' });
          }}
        >
          Add
        </button>
      </div>
      {people.length === 0 ? (
        <Empty>No team members added.</Empty>
      ) : (
        <ul className="rec-list">
          {people.map((x) => (
            <li key={x.id} className="row-actions">
              <div className="rec-item">
                <span className="tag">{x.role || '—'}</span>
                <span className="rec-title">{x.name}</span>
                <span className="rec-meta">{x.contact}</span>
              </div>
              <button
                className="icon-btn"
                onClick={() => {
                  setPeople(people.filter((y) => y.id !== x.id));
                  void api.deleteDoc('people', x.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- Analyst ----------------
function AnalystPage({ ctx }: { ctx: PageCtx }) {
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<AnalystAnswer | null | 'none'>(null);
  const run = (question: string) => {
    setQ(question);
    const layers: Parameters<typeof answerQuestion>[1]['layers'] = {};
    for (const id of LAYER_IDS) {
      const s = ctx.layerSnaps[id];
      if (s?.status.enabled) layers[id] = { records: s.records, lastSuccessAt: s.status.lastSuccessAt, freshness: s.status.freshness };
    }
    const r = answerQuestion(question, { snap: ctx.snap, layers, viewBbox: ctx.viewBbox() });
    setAns(r ?? 'none');
  };
  return (
    <>
      <Head title="Analyst" sub="Questions are answered by ordinary code over loaded data. Every row links to a real record. Say “in this area” to limit to the current view." />
      <div className="btn-row">
        <input className="view-name" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run(q)} placeholder="Ask about loaded data…" />
        <button className="btn small-btn primary" onClick={() => run(q)} disabled={!q.trim()}>
          Ask
        </button>
      </div>
      <div className="btn-row">
        {ANALYST_EXAMPLES.map((e) => (
          <button key={e} className="btn small-btn" onClick={() => run(e)}>
            {e}
          </button>
        ))}
      </div>
      {ans === 'none' && (
        <div className="note">
          That question isn’t one the built-in analyst can compute. You can ask the optional local AI to explain loaded results.{' '}
          <button className="link-btn" onClick={ctx.openAi}>
            Open local AI
          </button>
        </div>
      )}
      {ans && ans !== 'none' && (
        <>
          <h3 className="sub">{ans.title}</h3>
          <p className="muted small">{ans.note}</p>
          {ans.openVisitBriefing && <button className="btn" onClick={ctx.openVisitBriefing}>Open visit briefing</button>}
          <ul className="rec-list">
            {ans.rows.map((r) => (
              <Row
                key={JSON.stringify([r.layer, r.id, r.sourceId])}
                onClick={() => {
                  if (r.lat !== null && r.lon !== null) ctx.focus(r.lat, r.lon, 30);
                  if (r.layer === 'alert' || r.layer === 'quake' || r.layer === 'location') ctx.selectEvent(r.layer, r.id);
                  else ctx.selectRecord(r.layer, r.id);
                }}
                title={r.label}
                meta={r.detail}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---------------- Official bulletins (news alternative) ----------------
function BulletinsPage({ ctx }: { ctx: PageCtx }) {
  const [dwdLimit, setDwdLimit] = useState(50);
  const dwd = dwdView(ctx.layerSnaps.dwd, ctx.snap.settings.layersEnabled.includes('dwd'), ctx.playbackActive);
  const sup = new Set(ctx.snap.supersededAlertIds);
  const severe = ctx.snap.alerts.filter((a) => isAlertCountable(a, sup, Date.now()) && (a.severity === 'Extreme' || a.severity === 'Severe')).sort((a, b) => (b.sent ?? '').localeCompare(a.sent ?? ''));
  const sig = ctx.snap.quakes.filter((q) => (q.mag ?? 0) >= 5).sort((a, b) => b.time.localeCompare(a.time));
  return (
    <>
      <Head title="Official bulletins" sub="Official government bulletins already loaded: severe NWS warnings, optional DWD German weather warnings, M5+ USGS earthquakes and NHC cyclone advisories. Each retains its own source and coverage." />
      <h3 className="sub">Severe / extreme NWS alerts ({severe.length})</h3>
      <ul className="rec-list">
        {severe.slice(0, 50).map((a) => (
          <Row key={a.id} onClick={() => ctx.selectEvent('alert', a.id)} tag={<SeverityTag severity={a.severity} />} title={a.headline ?? a.event} meta={<Time iso={a.sent} relative />} />
        ))}
      </ul>
      <h3 className="sub">DWD warnings — Germany</h3>
      <DwdSourceStatus snapshot={ctx.layerSnaps.dwd} enabled={ctx.snap.settings.layersEnabled.includes('dwd')} replayActive={ctx.playbackActive} onEnable={() => ctx.enableLayers(['dwd'])} compact />
      <ul className="rec-list">{dwd.warnings.slice(0, dwdLimit).map(warning => <Row key={warning.id} warningId={warning.id} onClick={() => ctx.selectRecord('dwd', warning.id)} tag={<SeverityTag severity={warning.severity} />} title={<span lang={warning.language}>{warning.headline ?? warning.event}</span>} meta={<>{warning.areaDesc} · {dwdWarningTiming(warning)} · {!warning.geometry ? 'No supplied map geometry' : warning.geometryStatus === 'partial' ? 'Partial map geometry' : 'Supplied map geometry'}</>} />)}</ul>
      {dwd.warnings.length > dwdLimit && <button className="btn small-btn" onClick={() => setDwdLimit(value => value + 50)}>Show more DWD warnings ({dwdLimit} of {dwd.warnings.length})</button>}
      <h3 className="sub">M5+ earthquakes ({sig.length})</h3>
      <ul className="rec-list">
        {sig.map((q) => (
          <Row key={q.id} onClick={() => ctx.selectEvent('quake', q.id)} title={q.title ?? q.id} meta={<Time iso={q.time} relative />} />
        ))}
      </ul>
      <h3 className="sub">Cyclone advisories</h3>
      {(ctx.layerSnaps.cyclones?.records ?? []).length === 0 ? (
        <p className="muted small">{ctx.snap.settings.layersEnabled.includes('cyclones') ? 'No active storms.' : 'Turn on the Tropical cyclones layer.'}</p>
      ) : (
        <ul className="rec-list">
          {(ctx.layerSnaps.cyclones?.records ?? []).map((c) => (
            <li key={c.id}>
              <span className="small">
                {c.label} · <ExternalLink url={c.sourceUrl}>NHC advisory</ExternalLink>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- Unavailable-by-design pages ----------------
// ---------------- Organization / enterprise ----------------
function OrgPage({ ctx }: { ctx: PageCtx }) {
  const s = ctx.snap.settings;
  return (
    <>
      <Head title="Organization" sub="Settings that apply to how your organization uses this installation." />
      <label className="field">
        <span>Organization name (shown on briefings)</span>
        <input value={s.orgName} maxLength={120} onChange={(e) => ctx.patch({ orgName: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Event history retention (days)</span>
          <input type="number" min={1} max={365} value={s.historyRetentionDays} onChange={(e) => ctx.patch({ historyRetentionDays: Math.max(1, Math.min(365, Number(e.target.value) || 30)) })} />
        </label>
        <label className="field">
          <span>Track recording retention (hours, up to {TRACK_MAX_RETENTION_HOURS} = 30 days)</span>
          <input type="number" min={1} max={TRACK_MAX_RETENTION_HOURS} value={s.trackRetentionHours} onChange={(e) => ctx.patch({ trackRetentionHours: Math.max(1, Math.min(TRACK_MAX_RETENTION_HOURS, Number(e.target.value) || 6)) })} />
        </label>
        <label className="field">
          <span>Track storage limit (MB)</span>
          <input type="number" min={TRACK_STORAGE_MIN_MB} max={TRACK_STORAGE_MAX_MB} step={50} value={s.trackStorageMB} onChange={(e) => ctx.patch({ trackStorageMB: Math.max(TRACK_STORAGE_MIN_MB, Math.min(TRACK_STORAGE_MAX_MB, Math.round(Number(e.target.value) || 250))) })} />
        </label>
      </div>
      <p className="muted small">
        Up to about {(trackPointBudget(s.trackStorageMB) / 1e6).toFixed(1)} million recorded aircraft, ship, transit and train fixes. Whichever limit is reached first wins: when the storage is full, the oldest fixes are removed even if they are inside the retention period, so check the oldest recorded time in Playback.
        Fixes older than {TRACK_THIN_AFTER_HOURS} hours are kept at one per object per minute. Only what this app recorded while it was running, for the layers you had on and the areas you viewed, can be replayed.
      </p>
      <h3 className="sub">Data providers</h3>
      <p className="muted small">Providers shows whether a credential comes from your organization or this build's optional included allowance. Your saved key takes priority; a failed saved key is never retried using an included key. Check the provider's billing and redistribution terms before use.</p>
      <button className="btn small-btn" onClick={ctx.openProviders}>
        Open provider settings
      </button>
      <h3 className="sub">Not included</h3>
      <p className="muted small">Single sign-on, multi-user roles, central policy management and license management need a server component and are not part of this desktop build.</p>
    </>
  );
}

function HelpPage({ ctx }: { ctx: PageCtx }) {
  return (
    <>
      <Head title="Help & resources" />
      <ul className="small help-list">
        <li>
          <b>/</b> focus search · <b>Esc</b> clear selection / cancel tool · <b>Ctrl+Shift+D</b> map diagnostics · arrows rotate, <b>+/−</b> zoom (globe focused)
        </li>
        <li>Search accepts places, coordinates, geo: URIs, U.S. addresses, airports (ICAO/IATA), loaded aircraft (callsign/hex/registration) and vessels (name/MMSI/IMO).</li>
        <li>Each data layer is labeled live, delayed, periodic, calculated or static. Hover a layer for its source, terms and coverage.</li>
        <li>Imagery resolution is not recency: imagery dates are shown in Diagnostics.</li>
        <li>
          Data sources: <ExternalLink url="https://www.weather.gov/documentation/services-web-api">NWS</ExternalLink> · <ExternalLink url="https://earthquake.usgs.gov/earthquakes/feed/">USGS</ExternalLink> ·{' '}
          <ExternalLink url="https://www.adsb.lol/docs/open-data/api/">adsb.lol</ExternalLink> · <ExternalLink url="https://www.digitraffic.fi/en/marine-traffic/">Digitraffic</ExternalLink> ·{' '}
          <ExternalLink url="https://openfreemap.org/">OpenFreeMap</ExternalLink> · <ExternalLink url="https://nasa-gibs.github.io/gibs-api-docs/">NASA GIBS</ExternalLink>
        </li>
      </ul>
      <div className="btn-row">
        <button className="btn small-btn" onClick={ctx.openProviders}>
          Providers & connection tests
        </button>
        <button className="btn small-btn" onClick={ctx.openSettings}>
          Settings
        </button>
        <button className="btn small-btn" onClick={ctx.openPlayback}>
          Playback
        </button>
      </div>
    </>
  );
}

function ReplaysPage({ ctx }: { ctx: PageCtx }) {
  return (
    <>
      <Head title="Recorded replays" sub="Review recorded NWS alerts, USGS earthquakes and movement fixes on the same timeline. Coverage depends on what Sky_View retrieved and retained." />
      <button className="btn primary" onClick={ctx.openPlayback}>
        Open playback timeline
      </button>
      <p className="muted small">Sky_View records successful NWS and USGS refreshes while running. Open Data during playback to inspect the recorded alerts and earthquakes. History keeps up to {ctx.snap.settings.historyRetentionDays} days. Enabled movement layers retain fixes for {ctx.snap.settings.trackRetentionHours} hours.</p>
    </>
  );
}

export function PageView({ page, ctx, airport }: { page: PageId; ctx: PageCtx; airport: string | null }) {
  switch (page) {
    case 'ops':
      return <OpsPage ctx={ctx} />;
    case 'events':
      return <EventsPage ctx={ctx} />;
    case 'discover':
      return <DiscoverPage ctx={ctx} />;
    case 'near':
      return <NearPage ctx={ctx} />;
    case 'track':
      return <TrackPage ctx={ctx} />;
    case 'airports':
      return <AirportsPage ctx={ctx} selected={airport} />;
    case 'cameras':
      return <CamerasPage ctx={ctx} />;
    case 'watchlist':
      return <WatchlistPage ctx={ctx} />;
    case 'radio':
      return <RadioPage viewCenter={ctx.viewCenter} focus={ctx.focus} />;
    case 'replays':
      return <ReplaysPage ctx={ctx} />;
    case 'boards':
      return <BoardsPage ctx={ctx} />;
    case 'people':
      return <PeoplePage />;
    case 'analyst':
      return <AnalystPage ctx={ctx} />;
    case 'bulletins':
      return <BulletinsPage ctx={ctx} />;
    case 'markets':
      return <MarketsPage ctx={ctx} />;
    case 'social':
      return <CommunityPage ctx={ctx} />;
    case 'org':
      return <OrgPage ctx={ctx} />;
    case 'help':
      return <HelpPage ctx={ctx} />;
    case 'planning':
      return ctx.planningPanel ? <PlanningPanel {...ctx.planningPanel} /> : null;
    default:
      return null;
  }
}
