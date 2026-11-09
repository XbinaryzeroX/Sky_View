// Navigation pages (left rail). Each page works on real loaded data or real
// locally persisted content, with empty/loading/unavailable states. Features
// that need a licensed source or a shared backend say so instead of pretending.

import { useEffect, useMemo, useState } from 'react';
import { aircraftClass, classifyAircraftQuery, elevationAngleDeg, specialCode, trackState } from '../../shared/aircraft';
import { answerQuestion, ANALYST_EXAMPLES, type AnalystAnswer } from '../../shared/analyst';
import { isAlertCountable } from '../../shared/dedupe';
import { geodesicDistanceKm } from '../../shared/geo';
import { LAYER_IDS, LAYERS, type GeoRecord, type LayerId, type LayerSnapshot } from '../../shared/layers';
import type { AppSnapshot, Settings } from '../../shared/types';
import { fmtAltitudeM, fmtDistanceKm, fmtSpeedKts } from '../../shared/units';
import airportsData from '../data/airports.json';
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
  | 'help';

/** `short` is the rail label (one word); `label` is the full name used for tooltips, headings and screen readers. */
export const NAV: { id: PageId; label: string; short: string; icon: string; group: string }[] = [
  { id: 'globe', label: 'Globe', short: 'Globe', icon: '◍', group: 'Live' },
  { id: 'cameras', label: 'Cameras', short: 'Cameras', icon: '▣', group: 'Live' },
  { id: 'ops', label: 'Ops center', short: 'Ops', icon: '▦', group: 'Live' },
  { id: 'events', label: 'Events', short: 'Events', icon: '⚑', group: 'Intelligence' },
  { id: 'discover', label: 'Discover', short: 'Discover', icon: '✦', group: 'Intelligence' },
  { id: 'near', label: 'Near me / overhead', short: 'Overhead', icon: '⌖', group: 'Intelligence' },
  { id: 'analyst', label: 'Analyst', short: 'Analyst', icon: '✎', group: 'Intelligence' },
  { id: 'boards', label: 'Boards', short: 'Boards', icon: '▤', group: 'Boards' },
  { id: 'track', label: 'Track a flight', short: 'Flights', icon: '✈', group: 'Tools' },
  { id: 'airports', label: 'Airports', short: 'Airports', icon: '⊕', group: 'Tools' },
  { id: 'watchlist', label: 'Watchlist', short: 'Watch', icon: '★', group: 'Tools' },
  { id: 'replays', label: 'Replays', short: 'Replays', icon: '⟲', group: 'Tools' },
  { id: 'bulletins', label: 'Official bulletins', short: 'Bulletins', icon: '☰', group: 'Tools' },
  { id: 'people', label: 'Team directory', short: 'Team', icon: '☺', group: 'Organization' },
  { id: 'markets', label: 'Markets', short: 'Markets', icon: '$', group: 'Organization' },
  { id: 'social', label: 'Feed / community / chat', short: 'Social', icon: '✉', group: 'Organization' },
  { id: 'org', label: 'Organization', short: 'Org', icon: '⚙', group: 'Organization' },
  { id: 'help', label: 'Help & resources', short: 'Help', icon: '?', group: 'Organization' },
];

export interface PageCtx {
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
  openSettings(): void;
  openProviders(): void;
  toast(msg: string): void;
  enableLayers(ids: LayerId[]): void;
}

type Airport = [string, string, string, number, number, number | null, string, string, 'L' | 'M'];
export const AIRPORTS = (airportsData as unknown as { airports: Airport[] }).airports;

function Row({ onClick, tag, title, meta }: { onClick?: () => void; tag?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <li>
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
function OpsPage({ ctx }: { ctx: PageCtx }) {
  const { snap } = ctx;
  const sup = new Set(snap.supersededAlertIds);
  const activeAlerts = snap.alerts.filter((a) => isAlertCountable(a, sup, Date.now())).length;
  const affected = snap.locations.filter((l) => (snap.evaluations[l.id]?.alertsInside.length ?? 0) > 0).length;
  const specials = allAircraft(ctx).filter((r) => specialCode(r)).length;
  const rows: { name: string; on: boolean; fresh: string; n: number; last: string | null; err: string | null }[] = [
    { name: 'NWS alerts (U.S.)', on: true, fresh: snap.freshness.nws, n: snap.feeds.nws.recordCount, last: snap.feeds.nws.lastSuccessAt, err: snap.feeds.nws.error },
    { name: 'USGS earthquakes', on: true, fresh: snap.freshness.usgs, n: snap.quakes.length, last: snap.feeds.usgs.lastSuccessAt, err: snap.feeds.usgs.error },
    ...LAYER_IDS.map((id) => {
      const st = ctx.layerSnaps[id]?.status;
      return { name: LAYERS[id].name, on: !!st?.enabled, fresh: st?.freshness ?? 'unavailable', n: st?.recordCount ?? 0, last: st?.lastSuccessAt ?? null, err: st?.error ?? null };
    }),
  ];
  return (
    <>
      <Head title="Operations center" sub="Feed health and the current picture, computed from loaded data." />
      <div className="stat-grid">
        <div className="stat">
          <b>{activeAlerts}</b>
          <span>active NWS alerts</span>
        </div>
        <div className="stat">
          <b>{affected}</b>
          <span>saved places in alerts</span>
        </div>
        <div className="stat">
          <b>{specials}</b>
          <span>special squawks</span>
        </div>
        <div className="stat">
          <b>{ctx.watchlist.length}</b>
          <span>watched objects</span>
        </div>
      </div>
      <table className="mini-table">
        <thead>
          <tr>
            <th>Feed</th>
            <th>State</th>
            <th>Records</th>
            <th>Last success</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={r.on ? '' : 'dim'}>
              <td>{r.name}</td>
              <td>{r.on ? <span className={`mini-chip ${FRESHNESS_META[r.fresh as 'fresh'].cls}`}>{FRESHNESS_META[r.fresh as 'fresh'].label}</span> : <span className="muted">off</span>}</td>
              <td>{r.on ? r.n.toLocaleString() : '—'}</td>
              <td title={r.err ?? ''}>
                {r.on ? relativeTime(r.last) : '—'}
                {r.err && r.on ? <span className="err-text"> ⚠</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------- Events ----------------
function EventsPage({ ctx }: { ctx: PageCtx }) {
  const [kind, setKind] = useState<'all' | 'alert' | 'quake' | 'fire' | 'cyclone' | 'squawk'>('all');
  const { snap } = ctx;
  const sup = new Set(snap.supersededAlertIds);
  const items = useMemo(() => {
    const out: { t: string; kind: string; title: string; meta: string; go(): void }[] = [];
    for (const a of snap.alerts.filter((x) => isAlertCountable(x, sup, Date.now())).slice(0, 300))
      out.push({ t: a.sent ?? '', kind: 'alert', title: `${a.event}`, meta: `${a.severity} · ${a.areaDesc?.slice(0, 80) ?? ''}`, go: () => ctx.selectEvent('alert', a.id) });
    for (const q of snap.quakes.slice(0, 200)) out.push({ t: q.time, kind: 'quake', title: `M${q.mag?.toFixed(1) ?? '?'} ${q.place ?? ''}`, meta: 'USGS', go: () => ctx.selectEvent('quake', q.id) });
    for (const c of ctx.layerSnaps.cyclones?.records ?? []) out.push({ t: c.observedAt ?? '', kind: 'cyclone', title: c.label, meta: 'NHC advisory', go: () => ctx.selectRecord('cyclones', c.id) });
    for (const f of [...(ctx.layerSnaps.fires?.records ?? [])].sort((a, b) => Number(b.props.frpMW ?? 0) - Number(a.props.frpMW ?? 0)).slice(0, 50))
      out.push({ t: f.observedAt ?? '', kind: 'fire', title: f.label, meta: `${f.lat.toFixed(2)}, ${f.lon.toFixed(2)} · FIRMS`, go: () => ctx.selectRecord('fires', f.id) });
    for (const r of allAircraft(ctx).filter((x) => specialCode(x))) out.push({ t: r.observedAt ?? '', kind: 'squawk', title: `${r.label}: ${specialCode(r)!.label}`, meta: 'Transponder report (not a confirmed incident)', go: () => ctx.selectRecord('aircraft', r.id) });
    return out.filter((i) => kind === 'all' || i.kind === kind).sort((a, b) => b.t.localeCompare(a.t));
  }, [snap, ctx.layerSnaps, kind]);
  return (
    <>
      <Head title="Events" sub="Current alerts, earthquakes, cyclones, strongest fire detections and special squawks from loaded feeds. Turn layers on to include them." />
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Event type">
        <option value="all">All types</option>
        <option value="alert">Weather alerts (U.S.)</option>
        <option value="quake">Earthquakes</option>
        <option value="cyclone">Cyclones</option>
        <option value="fire">Fire detections</option>
        <option value="squawk">Special squawks</option>
      </select>
      {items.length === 0 ? (
        <Empty>No events of this type in the loaded data.</Empty>
      ) : (
        <ul className="rec-list">
          {items.slice(0, 300).map((i, k) => (
            <Row key={k} onClick={i.go} tag={<span className="tag">{i.kind}</span>} title={i.title} meta={<>{i.t ? <Time iso={i.t} relative /> : '—'} · {i.meta}</>} />
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- Discover ----------------
function DiscoverPage({ ctx }: { ctx: PageCtx }) {
  const { snap } = ctx;
  const ac = allAircraft(ctx);
  const highest = [...ac].filter((r) => typeof r.props.altitudeFt === 'number').sort((a, b) => Number(b.props.altitudeFt) - Number(a.props.altitudeFt))[0];
  const fastest = [...ac].filter((r) => r.speedKts !== null).sort((a, b) => (b.speedKts ?? 0) - (a.speedKts ?? 0))[0];
  const biggestQuake = [...snap.quakes].sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))[0];
  const fire = [...(ctx.layerSnaps.fires?.records ?? [])].sort((a, b) => Number(b.props.frpMW ?? 0) - Number(a.props.frpMW ?? 0))[0];
  const perim = [...(ctx.layerSnaps.firePerimeters?.records ?? [])].sort((a, b) => Number(b.props.acres ?? 0) - Number(a.props.acres ?? 0))[0];
  const ves = ctx.layerSnaps.vessels?.records ?? [];
  const cards: { title: string; value: string; go?: () => void }[] = [
    biggestQuake && { title: 'Largest earthquake in feed', value: `M${biggestQuake.mag?.toFixed(1)} ${biggestQuake.place ?? ''}`, go: () => ctx.selectEvent('quake', biggestQuake.id) },
    highest && { title: 'Highest loaded aircraft', value: `${highest.label} · ${Number(highest.props.altitudeFt).toLocaleString()} ft`, go: () => ctx.selectRecord('aircraft', highest.id) },
    fastest && { title: 'Fastest loaded aircraft (ground speed)', value: `${fastest.label} · ${Math.round(fastest.speedKts ?? 0)} kt`, go: () => ctx.selectRecord('aircraft', fastest.id) },
    fire && { title: 'Strongest fire detection', value: fire.label, go: () => ctx.selectRecord('fires', fire.id) },
    perim && { title: 'Largest wildfire perimeter', value: `${perim.label} · ${Number(perim.props.acres ?? 0).toLocaleString()} acres`, go: () => ctx.selectRecord('firePerimeters', perim.id) },
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
  const [q, setQ] = useState('');
  const [pub, setPub] = useState('all');
  const list = cams.filter((c) => (pub === 'all' || c.source.startsWith(pub)) && (!q || c.label.toLowerCase().includes(q.toLowerCase())));
  if (!on)
    return (
      <>
        <Head title="Cameras" sub="Authorized public camera stills published by transportation agencies." />
        <button className="btn primary" onClick={() => ctx.enableLayers(['cameras'])}>
          Load camera catalogs
        </button>
      </>
    );
  return (
    <>
      <Head title="Cameras" sub={`${cams.length.toLocaleString()} published cameras (Caltrans, Fintraffic). Images load only when you open one.`} />
      <div className="btn-row">
        <input className="view-name" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Road, place…" />
        <select value={pub} onChange={(e) => setPub(e.target.value)} aria-label="Publisher">
          <option value="all">All publishers</option>
          <option value="Caltrans">Caltrans (California)</option>
          <option value="Fintraffic">Fintraffic (Finland)</option>
        </select>
      </div>
      {list.length === 0 ? (
        <Empty>{cams.length === 0 ? 'Camera catalogs are loading or unavailable.' : 'No cameras match.'}</Empty>
      ) : (
        <ul className="rec-list">
          {list.slice(0, 200).map((c) => (
            <Row
              key={c.id}
              onClick={() => {
                ctx.focus(c.lat, c.lon, 2);
                ctx.selectRecord('cameras', c.id);
              }}
              tag={<span className="tag">{c.source.startsWith('Caltrans') ? 'CA' : 'FI'}</span>}
              title={c.label}
              meta={String(c.props.county ?? c.props.publisher ?? '')}
            />
          ))}
        </ul>
      )}
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
interface Board {
  id: string;
  name: string;
  notes: string;
  items: { kind: string; id: string; label: string }[];
  createdAt: string;
}
function BoardsPage({ ctx }: { ctx: PageCtx }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    void api.listDocs<Board>('boards').then(setBoards);
  }, []);
  const save = (b: Board) => {
    setBoards((prev) => (prev.some((x) => x.id === b.id) ? prev.map((x) => (x.id === b.id ? b : x)) : [...prev, b]));
    void api.putDoc('boards', b as never);
  };
  return (
    <>
      <Head title="Boards" sub="Local working boards: notes plus pinned watchlist items. Stored on this computer only." />
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
            <button className="btn small-btn" disabled={ctx.watchlist.length === 0} onClick={() => save({ ...b, items: [...b.items, ...ctx.watchlist.filter((w) => !b.items.some((i) => i.id === w.id)).map((w) => ({ kind: w.kind, id: w.id, label: w.label }))] })}>
              Pin watchlist items
            </button>
          </div>
          <ul className="small">
            {b.items.map((i) => (
              <li key={i.id}>
                {i.kind}: {i.label}{' '}
                <button className="link-btn small" onClick={() => save({ ...b, items: b.items.filter((x) => x.id !== i.id) })}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
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
      <Head title="Team directory" sub="An opt-in contact list for your own team (for example, who to call about a property). Stored locally. Atlas Watch does not locate or track people." />
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
          <ul className="rec-list">
            {ans.rows.map((r) => (
              <Row
                key={`${r.layer}-${r.id}`}
                onClick={() => {
                  ctx.focus(r.lat, r.lon, 30);
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
  const sup = new Set(ctx.snap.supersededAlertIds);
  const severe = ctx.snap.alerts.filter((a) => isAlertCountable(a, sup, Date.now()) && (a.severity === 'Extreme' || a.severity === 'Severe')).sort((a, b) => (b.sent ?? '').localeCompare(a.sent ?? ''));
  const sig = ctx.snap.quakes.filter((q) => (q.mag ?? 0) >= 5).sort((a, b) => b.time.localeCompare(a.time));
  return (
    <>
      <Head title="Official bulletins" sub="Breaking news needs a licensed news source, which is not included. This page lists official government bulletins already loaded: severe NWS warnings, M5+ USGS earthquakes and NHC cyclone advisories, each linked to its source." />
      <h3 className="sub">Severe / extreme NWS alerts ({severe.length})</h3>
      <ul className="rec-list">
        {severe.slice(0, 50).map((a) => (
          <Row key={a.id} onClick={() => ctx.selectEvent('alert', a.id)} tag={<SeverityTag severity={a.severity} />} title={a.headline ?? a.event} meta={<Time iso={a.sent} relative />} />
        ))}
      </ul>
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
function MarketsPage() {
  return (
    <>
      <Head title="Markets" />
      <div className="note">
        Not available. Market prices need a licensed data feed with redistribution rights and timestamps, and no free commercially licensed source is included. This can be added later as an optional integration
        using your organization’s market-data license.
      </div>
    </>
  );
}
function SocialPage({ ctx }: { ctx: PageCtx }) {
  return (
    <>
      <Head title="Feed, community and chat" />
      <div className="note">
        Not available in this version. Shared feeds, community posts and chat need a server with user accounts, access control and moderation. Atlas Watch is currently a single-user desktop app. Your existing
        server could host this later. Until then, use Boards (local notes) and export scene files or briefings to share views.
      </div>
      <button className="btn small-btn" onClick={ctx.openSettings}>
        Settings
      </button>
    </>
  );
}

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
          <span>Track recording retention (hours)</span>
          <input type="number" min={1} max={72} value={s.trackRetentionHours} onChange={(e) => ctx.patch({ trackRetentionHours: Math.max(1, Math.min(72, Number(e.target.value) || 6)) })} />
        </label>
      </div>
      <h3 className="sub">Data providers</h3>
      <p className="muted small">Optional and metered providers stay off until configured with your organization’s own credentials. Atlas Watch never falls back to the vendor’s keys.</p>
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
      <Head title="Flight & vessel replays" sub="Replays use only positions this app recorded while running (aircraft, vessels, transit). Nothing is reconstructed, and nothing was recorded while the app was closed." />
      <button className="btn primary" onClick={ctx.openPlayback}>
        Open playback timeline
      </button>
      <p className="muted small">To build history for an area, turn on Aircraft or Vessels and leave Atlas Watch running. Retention: {ctx.snap.settings.trackRetentionHours} hours (change in Organization).</p>
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
      return <MarketsPage />;
    case 'social':
      return <SocialPage ctx={ctx} />;
    case 'org':
      return <OrgPage ctx={ctx} />;
    case 'help':
      return <HelpPage ctx={ctx} />;
    default:
      return null;
  }
}
