import { useMemo, useState } from 'react';
import { isAlertCountable, supersededAlertIds } from '../../shared/dedupe';
import type { TimelineFrame } from '../../shared/timeline';
import type { LayerSnapshot } from '../../shared/layers';
import { DwdPlaceWarnings } from './DwdWarnings';
import { geodesicDistanceKm } from '../../shared/geo';
import { matchAlert, monitoringCount, monitoringEvidence, severityRank, type MonitoringEvidence } from '../../shared/monitoring';
import type { AppSnapshot, Earthquake, HistoryRecordDetail, SavedLocation, WeatherAlert } from '../../shared/types';
import { quakeClass, SEVERITY_META } from '../lib/format';
import { Empty, ExternalLink, SeverityTag, Time } from './common';

export type Selection =
  | { kind: 'location'; id: string }
  | { kind: 'alert'; id: string }
  | { kind: 'quake'; id: string }
  | { kind: 'areaMatch'; id: string }
  | { kind: 'history'; record: HistoryRecordDetail };

interface Props {
  includeOverview?: boolean;
  dwdSnapshot?: LayerSnapshot;
  dwdEnabled?: boolean;
  onSelectDwd?(id: string): void;
  snap: AppSnapshot;
  selection: Selection | null;
  onSelect(s: Selection | null): void;
  onEdit(loc: SavedLocation): void;
  onDelete(loc: SavedLocation): void;
  onFocus(lat: number, lon: number, radiusKm?: number): void;
  onBriefing(ids: string[]): void;
}

/** NWS text is hard-wrapped at ~70 columns; join single line breaks for readability, keep paragraphs. */
function unwrap(t: string): string {
  return t.replace(/([^\n])\n(?![\n*-])/g, '$1 ');
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function zoneText(loc: SavedLocation): string {
  switch (loc.zones.status) {
    case 'resolved':
      return loc.zones.zones.join(', ');
    case 'pending':
      return 'Looking up…';
    case 'outside_coverage':
      return 'Outside NWS zone-service coverage';
    case 'disabled':
      return 'Lookup turned off';
    case 'error':
      return `Lookup failed${loc.zones.error ? ` (${loc.zones.error})` : ''}`;
  }
}

function EvidenceNote({ source, evidence }: { source: string; evidence: MonitoringEvidence }) {
  const state = evidence.state === 'partial' && !evidence.current ? 'partial, last observed' : evidence.state === 'last-observed' ? 'last observed' : evidence.state;
  return <p className="muted small" data-monitoring-source={source} data-monitoring-state={evidence.state}>
    <strong>{source}: {state}</strong>{evidence.observedAt && <> · retrieved <Time iso={evidence.observedAt} /></>}{evidence.scope && <> · scope {evidence.scope}</>}. {evidence.reason}
  </p>;
}

function LocationDetails({ snap, loc, p }: { snap: AppSnapshot; loc: SavedLocation; p: Props }) {
  const ev = snap.evaluations[loc.id];
  const nws = monitoringEvidence(snap, 'nws', loc), usgs = monitoringEvidence(snap, 'usgs', loc);
  const alertsById = useMemo(() => new Map(snap.alerts.map((a) => [a.id, a])), [snap.alerts]);
  const quakesById = useMemo(() => new Map(snap.quakes.map((q) => [q.id, q])), [snap.quakes]);
  const inside = (nws.usable ? ev?.alertsInside ?? [] : [])
    .map((m) => ({ m, a: alertsById.get(m.alertId) }))
    .filter((x): x is { m: (typeof x)['m']; a: WeatherAlert } => !!x.a)
    .sort((x, y) => severityRank(y.a.severity) - severityRank(x.a.severity));
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">Saved location</div>
        <h2>{loc.name}</h2>
        <div className="muted small">
          {loc.category || 'Uncategorized'} · {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
        </div>
      </header>
      <div className="btn-row">
        <button className="btn" onClick={() => p.onFocus(loc.lat, loc.lon, loc.radiusKm)}>
          Focus
        </button>
        <button className="btn" onClick={() => p.onEdit(loc)}>
          Edit
        </button>
        <button className="btn" onClick={() => p.onBriefing([loc.id])}>
          Briefing
        </button>
        <button className="btn danger" onClick={() => p.onDelete(loc)}>
          Delete
        </button>
      </div>
      <dl className="kvs">
        <Row label="Monitoring radius">{loc.radiusKm} km</Row>
        <Row label="NWS zones">{zoneText(loc)}</Row>
        <Row label="Last evaluated">
          <Time iso={ev?.evaluatedAt} />
        </Row>
        {loc.notes && <Row label="Notes">{loc.notes}</Row>}
      </dl>

      <h3 className="sub">Weather alerts at this point</h3>
      <EvidenceNote source="NWS" evidence={nws} />
      {ev?.alertCoverageNote && (
        <div className="note" role="note">
          {ev.alertCoverageNote}
        </div>
      )}
      {inside.length > 0 && <p className="muted small">Known NWS matches: {monitoringCount(nws, inside.length).label}.</p>}
      {(!ev || !nws.usable || (inside.length === 0 && !nws.canAssertZero)) ? (
        <p className="muted">Unknown — this evidence does not establish that no alerts apply.</p>
      ) : inside.length === 0 ? (
        <p className="ok-text">No active alerts confirmed for this point.</p>
      ) : (
        <ul className="rec-list">
          {inside.map(({ m, a }) => (
            <li key={a.id}>
              <button className="rec-item" onClick={() => p.onSelect({ kind: 'alert', id: a.id })}>
                <SeverityTag severity={a.severity} />
                <span className="rec-title">{a.event}</span>
                <span className="rec-meta">
                  {m.method === 'polygon' ? 'Inside polygon' : 'Affected zone'} · ends <Time iso={a.ends ?? a.expires} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ev && nws.usable && (
        <p className="muted small">
          Known alerts not including this point: {monitoringCount(nws, ev.alertsOutsideCount).label}
          {ev.alertsUnknown.length > 0 ? `; ${monitoringCount(nws, ev.alertsUnknown.length).label} could not be determined` : ''}.
        </p>
      )}

      <h3 className="sub">Earthquakes within {loc.radiusKm} km</h3>
      <EvidenceNote source="USGS" evidence={usgs} />
      <p className="muted small">Distance is to the reported epicenter, not an estimate of shaking or damage.</p>
      {ev && usgs.usable && ev.quakesNearby.length > 0 && <p className="muted small">Known USGS matches: {monitoringCount(usgs, ev.quakesNearby.length).label}.</p>}
      {!ev || !usgs.usable || (ev.quakesNearby.length === 0 && !usgs.canAssertZero) ? (
        <p className="muted">Unknown — this evidence does not establish that no earthquakes occurred within the radius.</p>
      ) : ev.quakesNearby.length === 0 ? (
        <p className="muted">None in the current feed window ({snap.settings.quakeWindow}, M{snap.settings.quakeMinMagnitude}+).</p>
      ) : (
        <ul className="rec-list">
          {ev.quakesNearby.slice(0, 100).map((qm) => {
            const q = quakesById.get(qm.quakeId);
            if (!q) return null;
            const c = quakeClass(q.mag);
            return (
              <li key={q.id}>
                <button className="rec-item" onClick={() => p.onSelect({ kind: 'quake', id: q.id })}>
                  <span className={`tag ${c.cls}`}>{c.label}</span>
                  <span className="rec-title">{q.place ?? q.id}</span>
                  <span className="rec-meta">
                    {qm.distanceKm.toFixed(1)} km to epicenter · <Time iso={q.time} relative />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {p.dwdEnabled && <DwdPlaceWarnings place={loc} snapshot={p.dwdSnapshot} enabled onSelect={p.onSelectDwd} />}
    </div>
  );
}

interface ReplayClock {
  cursor: string;
  observedAt: string | null;
}

function AlertDetails({ snap, alert, p, historical, replay }: {
  snap: Pick<AppSnapshot, 'alerts' | 'supersededAlertIds' | 'locations'>; alert: WeatherAlert;
  p?: Pick<Props, 'onSelect'>; historical?: HistoryRecordDetail; replay?: ReplayClock;
}) {
  const superseded = snap.supersededAlertIds.includes(alert.id);
  const countable = isAlertCountable(alert, new Set(snap.supersededAlertIds), replay ? Date.parse(replay.cursor) : Date.now());
  const inCurrent = snap.alerts.some((a) => a.id === alert.id);
  const affected = snap.locations.map((l) => ({ l, m: matchAlert(l, alert) })).filter((x) => x.m.status !== 'outside');
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">{replay ? 'Recorded weather alert' : historical ? 'Weather alert · history record' : 'Weather alert'}</div>
        <h2>{alert.event}</h2>
        <div className="tag-row">
          <SeverityTag severity={alert.severity} />
          <span className="tag">Urgency: {alert.urgency}</span>
          <span className="tag">Certainty: {alert.certainty}</span>
          {alert.messageType !== 'Alert' && <span className="tag">{alert.messageType}</span>}
          {superseded && <span className="tag sev-unknown">Superseded by newer revision</span>}
          {!countable && !superseded && inCurrent && <span className="tag sev-unknown">Not counted (expired/cancelled)</span>}
          {historical && !inCurrent && <span className="tag sev-unknown">No longer in active feed</span>}
        </div>
      </header>
      {alert.headline && <p className="headline">{alert.headline}</p>}
      <dl className="kvs">
        {replay && <Row label="Recorded by Atlas Watch"><Time iso={replay.observedAt} /></Row>}
        <Row label="Onset">
          <Time iso={alert.onset ?? alert.effective} />
        </Row>
        <Row label="Ends">
          <Time iso={alert.ends} />
        </Row>
        <Row label="Message expires">
          <Time iso={alert.expires} />
        </Row>
        <Row label="Sent">
          <Time iso={alert.sent} />
        </Row>
        <Row label="Issued by">{alert.senderName ?? '—'}</Row>
        <Row label="Area">{alert.areaDesc ?? '—'}</Row>
        <Row label="Geometry">{alert.geometry ? 'Polygon supplied' : 'Zone-based alert without a polygon'}</Row>
        {historical && (
          <>
            <Row label="First observed">
              <Time iso={historical.firstObservedAt} />
            </Row>
            <Row label="Last observed">
              <Time iso={historical.lastObservedAt} />
            </Row>
          </>
        )}
      </dl>
      {snap.locations.length > 0 && (
        <>
          <h3 className="sub">Saved locations</h3>
          {affected.length === 0 ? (
            <p className="muted small">Confirmed not to include any saved location.</p>
          ) : (
            <ul className="rec-list">
              {affected.map(({ l, m }) => (
                <li key={l.id}>
                  <button className="rec-item" onClick={() => p?.onSelect({ kind: 'location', id: l.id })}>
                    <span className={`tag ${m.status === 'inside' ? 'sev-severe' : 'sev-unknown'}`}>{m.status === 'inside' ? 'Inside' : 'Unknown'}</span>
                    <span className="rec-title">{l.name}</span>
                    <span className="rec-meta">{m.method === 'polygon' ? 'polygon test' : m.method === 'zone' ? 'zone match' : 'cannot determine (zones unknown)'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {alert.description && (
        <>
          <h3 className="sub">Description</h3>
          <p className="pre">{unwrap(alert.description)}</p>
        </>
      )}
      {alert.instruction && (
        <>
          <h3 className="sub">Instructions</h3>
          <p className="pre">{unwrap(alert.instruction)}</p>
        </>
      )}
      <h3 className="sub">Source</h3>
      <dl className="kvs">
        <Row label="Provider">National Weather Service</Row>
        <Row label="Record">
          <ExternalLink url={alert.sourceUrl}>api.weather.gov record</ExternalLink>
        </Row>
        <Row label="Identifier">
          <code className="wrap">{alert.id}</code>
        </Row>
        {alert.references.length > 0 && <Row label="Updates">{alert.references.length} earlier revision(s)</Row>}
        {alert.ugc.length > 0 && <Row label="UGC zones">{alert.ugc.slice(0, 40).join(', ') + (alert.ugc.length > 40 ? '…' : '')}</Row>}
      </dl>
      <p className="muted small">Not an official warning product. Follow official NWS and local alerts in an emergency.</p>
    </div>
  );
}

function QuakeDetails({ snap, quake, p, historical, replay }: {
  snap: Pick<AppSnapshot, 'locations'>; quake: Earthquake; p: Pick<Props, 'onFocus'> & Partial<Pick<Props, 'onSelect'>>;
  historical?: HistoryRecordDetail; replay?: ReplayClock;
}) {
  const c = quakeClass(quake.mag);
  const near = snap.locations
    .map((l) => ({ l, d: geodesicDistanceKm(l.lat, l.lon, quake.lat, quake.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">{replay ? 'Recorded earthquake' : historical ? 'Earthquake · history record' : 'Earthquake'}</div>
        <h2>{quake.title ?? quake.place ?? quake.id}</h2>
        <div className="tag-row">
          <span className={`tag ${c.cls}`}>
            {c.label} {quake.magType ?? ''}
          </span>
          {quake.status && <span className="tag">{quake.status === 'reviewed' ? 'Reviewed' : quake.status === 'automatic' ? 'Automatic (preliminary)' : quake.status}</span>}
          {quake.eventType && quake.eventType !== 'earthquake' && <span className="tag">{quake.eventType}</span>}
          {quake.tsunami && <span className="tag sev-severe">Tsunami flag set</span>}
        </div>
      </header>
      <div className="btn-row">
        <button className="btn" onClick={() => p.onFocus(quake.lat, quake.lon, 100)}>
          Focus
        </button>
      </div>
      <dl className="kvs">
        {replay && <Row label="Recorded by Atlas Watch"><Time iso={replay.observedAt} /></Row>}
        <Row label="Origin time">
          <Time iso={quake.time} />
        </Row>
        <Row label="Depth">{quake.depthKm === null ? '—' : `${quake.depthKm.toFixed(1)} km`}</Row>
        <Row label="Epicenter">
          {quake.lat.toFixed(4)}, {quake.lon.toFixed(4)}
        </Row>
        <Row label="Source updated">
          <Time iso={quake.updated} />
        </Row>
        {historical && (
          <>
            <Row label="First observed">
              <Time iso={historical.firstObservedAt} />
            </Row>
            <Row label="Last observed">
              <Time iso={historical.lastObservedAt} />
            </Row>
          </>
        )}
      </dl>
      {quake.tsunami && <p className="muted small">The USGS tsunami flag indicates the event is in an oceanic region and above a magnitude threshold. It does not mean a tsunami exists. Check official tsunami warning centers.</p>}
      {near.length > 0 && (
        <>
          <h3 className="sub">Distance from saved locations to epicenter</h3>
          <ul className="rec-list">
            {near.map(({ l, d }) => (
              <li key={l.id}>
                <button className="rec-item" onClick={() => p.onSelect?.({ kind: 'location', id: l.id })}>
                  <span className={`tag ${d <= l.radiusKm ? 'sev-moderate' : ''}`}>{d <= l.radiusKm ? 'Within radius' : 'Outside radius'}</span>
                  <span className="rec-title">{l.name}</span>
                  <span className="rec-meta">{d.toFixed(1)} km</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Proximity to an epicenter is not an estimate of shaking, damage, or personal danger.</p>
        </>
      )}
      <h3 className="sub">Source</h3>
      <dl className="kvs">
        <Row label="Provider">U.S. Geological Survey</Row>
        <Row label="Event page">
          <ExternalLink url={quake.url}>earthquake.usgs.gov</ExternalLink>
        </Row>
        <Row label="Event id">
          <code>{quake.id}</code>
        </Row>
        {quake.ids.length > 1 && <Row label="Associated ids">{quake.ids.join(', ')}</Row>}
      </dl>
    </div>
  );
}

export type ReplaySelection = { kind: 'alert' | 'quake'; id: string };

export function ReplayDetails({ frame, selection, onSelect, onFocus }: {
  frame: TimelineFrame | null; selection: ReplaySelection | null; onSelect(value: ReplaySelection | null): void;
  onFocus: Props['onFocus'];
}) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const rows = useMemo(() => {
    if (!frame || selection) return [];
    const term = search.trim().toLowerCase();
    const alerts = frame.nws.records.map(alert => ({
      kind: 'alert' as const, id: alert.id, title: alert.headline || alert.event, at: alert.sent,
      source: alert.geometry ? 'NWS' : 'NWS · zone alert',
    }));
    const quakes = frame.usgs.records.map(quake => ({
      kind: 'quake' as const, id: quake.id, title: quake.title || quake.place || quake.id, at: quake.time, source: 'USGS',
    }));
    return [...alerts, ...quakes].filter(row => !term || (row.title + ' ' + row.id + ' ' + row.source).toLowerCase().includes(term))
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id));
  }, [frame, search, selection]);
  if (!frame) return <p className="muted small">Recorded data will appear here when a frame is available.</p>;
  const alert = selection?.kind === 'alert' && frame.nws.records.find(record => record.id === selection.id);
  const quake = selection?.kind === 'quake' && frame.usgs.records.find(record => record.id === selection.id);
  const coverage = selection?.kind === 'alert' ? frame.nws : frame.usgs;
  return <aside className="panel right-panel" aria-label="Recorded observation details">
    {selection && <button className="link-btn back" onClick={() => onSelect(null)}>← Recorded observations</button>}
    {alert ? <AlertDetails alert={alert} snap={{ alerts: frame.nws.records, locations: [], supersededAlertIds: [...supersededAlertIds(frame.nws.records)] }}
      replay={{ cursor: frame.t, observedAt: frame.nws.observedAt }} />
      : quake ? <QuakeDetails quake={quake} p={{ onFocus }} snap={{ locations: [] }} replay={{ cursor: frame.t, observedAt: frame.usgs.observedAt }} />
      : selection ? <p className="muted small">{coverage.state === 'recorded'
        ? 'The recorded reply at this time contains no record with this identifier.'
        : coverage.state === 'partial' ? 'Only part of this reply was recorded. The selected record is unavailable.'
        : 'There is no valid recorded reply for this source at the selected time.'} <code className="wrap">{selection.id}</code></p>
      : <>
        <label className="field">Find a recorded alert or earthquake
          <input type="search" value={search} onChange={e => { setSearch(e.target.value); setLimit(30); }} placeholder="Title, source or ID" />
        </label>
        <p className="small muted">{rows.length} matching records · latest alert issue or earthquake origin first</p>
        <ul className="rec-list">{rows.slice(0, limit).map(row => <li key={row.kind + row.id}>
          <button className="rec-item" onClick={() => onSelect({ kind: row.kind, id: row.id })}>
            <span className="tag">{row.source}</span><span className="rec-title">{row.title}</span>
            <span className="rec-meta"><Time iso={row.at} /></span>
          </button>
        </li>)}</ul>
        {rows.length > limit && <button className="link-btn" onClick={() => setLimit(n => n + 30)}>Show more records</button>}
      </>}
  </aside>;
}

function Overview({ snap, p }: { snap: AppSnapshot; p: Props }) {
  const nws = monitoringEvidence(snap, 'nws'), usgs = monitoringEvidence(snap, 'usgs');
  const alertsById = new Map(snap.alerts.map((a) => [a.id, a]));
  const superseded = new Set(snap.supersededAlertIds);
  const lifecycleAt = Date.parse(nws.current ? snap.generatedAt : nws.observedAt ?? '');
  const active = nws.usable ? snap.alerts.filter((a) => isAlertCountable(a, superseded, lifecycleAt)) : [];
  const withPolygon = active.filter((a) => a.geometry).length;
  const affected = snap.locations
    .map((l) => ({ l, ev: snap.evaluations[l.id] }))
    .filter((x) => x.ev && monitoringEvidence(snap, 'nws', x.l).usable && x.ev.alertsInside.length > 0)
    .map((x) => ({
      ...x,
      top: x.ev!.alertsInside.map((m) => alertsById.get(m.alertId)?.severity ?? 'Unknown').sort((a, b) => severityRank(b) - severityRank(a))[0],
    }));
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">Overview</div>
        <h2>What is happening around your places</h2>
      </header>
      <dl className="kvs">
        <Row label="Active weather alerts">
          {monitoringCount(nws, active.length).label}{nws.usable && active.length > 0 && ` (${withPolygon} with polygons, ${active.length - withPolygon} without polygons)`}
        </Row>
        <Row label="Earthquakes in feed">{monitoringCount(usgs, snap.quakes.length).label} (selected: past {snap.settings.quakeWindow}, M{snap.settings.quakeMinMagnitude}+)</Row>
        <Row label="Saved locations">{snap.locations.length}</Row>
      </dl>
      <EvidenceNote source="NWS" evidence={nws} />
      <EvidenceNote source="USGS" evidence={usgs} />
      {snap.locations.length === 0 ? (
        <Empty>
          <p>
            <strong>Get started:</strong> add a location with “+ Add”, pick a point on the globe, or import a CSV of properties.
          </p>
          <p className="small">Atlas Watch will show which saved locations fall inside active NWS weather alerts and which recent earthquakes are within each location’s radius.</p>
        </Empty>
      ) : (
        <>
          <h3 className="sub">Locations with confirmed alerts</h3>
          {affected.length === 0 ? (
            snap.locations.every(location => snap.evaluations[location.id] && monitoringEvidence(snap, 'nws', location).canAssertZero)
              ? <p className="ok-text">No active alerts confirmed at your saved locations.</p>
              : <p className="muted">Unknown — saved-location alert coverage is incomplete or based on an earlier observation.</p>
          ) : (
            <ul className="rec-list">
              {affected.map(({ l, ev, top }) => (
                <li key={l.id}>
                  <button className="rec-item" onClick={() => p.onSelect({ kind: 'location', id: l.id })}>
                    <span className={`tag ${SEVERITY_META[top].cls}`}>
                      <span aria-hidden="true">{SEVERITY_META[top].icon}</span> {top}
                    </span>
                    <span className="rec-title">{l.name}</span>
                    <span className="rec-meta">NWS alerts: {monitoringCount(monitoringEvidence(snap, 'nws', l), ev!.alertsInside.length).label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="muted small">Select a location, alert polygon, or earthquake marker for details and source records.</p>
    </div>
  );
}

export function DetailsPanel(p: Props) {
  const { snap, selection } = p;
  let body: React.ReactNode;
  if (!selection) body = <Overview snap={snap} p={p} />;
  else if (selection.kind === 'location') {
    const loc = snap.locations.find((l) => l.id === selection.id);
    body = loc ? <LocationDetails snap={snap} loc={loc} p={p} /> : <Empty>This location no longer exists.</Empty>;
  } else if (selection.kind === 'alert') {
    const a = snap.alerts.find((x) => x.id === selection.id);
    body = a ? <AlertDetails snap={snap} alert={a} p={p} /> : <Empty>This alert is unavailable in the loaded feed. Look up <code className="wrap">{selection.id}</code> in Event history.</Empty>;
  } else if (selection.kind === 'quake') {
    const q = snap.quakes.find((x) => x.id === selection.id);
    body = q ? <QuakeDetails snap={snap} quake={q} p={p} /> : <Empty>Earthquake <code className="wrap">{selection.id}</code> is unavailable in the loaded feed window.</Empty>;
  } else if (selection.kind === 'areaMatch') {
    const event = snap.areaWatches.events.find((match) => match.id === selection.id);
    const current = event && snap.quakes.find((quake) => quake.id === event.quakeId || quake.ids.includes(event.quakeId));
    body = event ? (
      <div className="details">
        <header className="details-head">
          <div className="eyebrow">Saved earthquake match</div>
          <h2>{event.areaName}</h2>
        </header>
        <p>USGS reported a magnitude {event.magnitude} earthquake with its epicenter inside this area or on its boundary.</p>
        <dl className="kvs">
          <Row label="Rule at detection">M{event.minMagnitude} or greater</Row>
          <Row label="Origin time"><Time iso={event.quakeTime} /></Row>
          <Row label="Detected by Atlas Watch"><Time iso={event.detectedAt} /></Row>
          <Row label="Reported epicenter">{event.lat.toFixed(4)}, {event.lon.toFixed(4)}</Row>
          <Row label="USGS event ID"><code>{event.quakeId}</code></Row>
          {event.url && <Row label="Source"><ExternalLink url={event.url}>USGS event page</ExternalLink></Row>}
        </dl>
        <div className="btn-row">
          <button className="btn" onClick={() => p.onFocus(event.lat, event.lon, 50)}>Focus on recorded epicenter</button>
          {current && <button className="btn" onClick={() => p.onSelect({ kind: 'quake', id: current.id })}>View current USGS record</button>}
        </div>
      </div>
    ) : <Empty>This area match is no longer saved.</Empty>;
  } else {
    const r = selection.record;
    body = r.kind === 'alert' ? <AlertDetails snap={snap} alert={r.payload as WeatherAlert} p={p} historical={r} /> : <QuakeDetails snap={snap} quake={r.payload as Earthquake} p={p} historical={r} />;
  }
  return (
    <aside className="panel right-panel" aria-label="Details">
      {selection && (
        <button className="link-btn back" onClick={() => p.onSelect(null)}>
          ← Overview
        </button>
      )}
      {p.includeOverview && selection && selection.kind !== 'areaMatch' && <Overview snap={snap} p={p} />}
      {body}
    </aside>
  );
}
