import { useMemo } from 'react';
import { isAlertCountable } from '../../shared/dedupe';
import { geodesicDistanceKm } from '../../shared/geo';
import { matchAlert, severityRank } from '../../shared/monitoring';
import type { AppSnapshot, Earthquake, HistoryRecordDetail, SavedLocation, WeatherAlert } from '../../shared/types';
import { quakeClass, SEVERITY_META } from '../lib/format';
import { Empty, ExternalLink, SeverityTag, Time } from './common';

export type Selection =
  | { kind: 'location'; id: string }
  | { kind: 'alert'; id: string }
  | { kind: 'quake'; id: string }
  | { kind: 'history'; record: HistoryRecordDetail };

interface Props {
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
      return 'Outside NWS coverage';
    case 'disabled':
      return 'Lookup turned off';
    case 'error':
      return `Lookup failed${loc.zones.error ? ` (${loc.zones.error})` : ''}`;
  }
}

function LocationDetails({ snap, loc, p }: { snap: AppSnapshot; loc: SavedLocation; p: Props }) {
  const ev = snap.evaluations[loc.id];
  const alertsById = useMemo(() => new Map(snap.alerts.map((a) => [a.id, a])), [snap.alerts]);
  const quakesById = useMemo(() => new Map(snap.quakes.map((q) => [q.id, q])), [snap.quakes]);
  const inside = (ev?.alertsInside ?? [])
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
      {ev?.alertCoverageNote && (
        <div className="note" role="note">
          {ev.alertCoverageNote}
        </div>
      )}
      {!ev || ev.nwsFreshness === 'unavailable' ? (
        <p className="muted">Unknown — weather alert data is unavailable.</p>
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
      {ev && ev.nwsFreshness !== 'unavailable' && (
        <p className="muted small">
          {ev.alertsOutsideCount} active alert(s) confirmed not to include this point
          {ev.alertsUnknown.length > 0 ? `; ${ev.alertsUnknown.length} could not be determined` : ''}.
        </p>
      )}

      <h3 className="sub">Earthquakes within {loc.radiusKm} km</h3>
      <p className="muted small">Distance is to the reported epicenter, not an estimate of shaking or damage.</p>
      {!ev || ev.usgsFreshness === 'unavailable' ? (
        <p className="muted">Unknown — earthquake data is unavailable.</p>
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
    </div>
  );
}

function AlertDetails({ snap, alert, p, historical }: { snap: AppSnapshot; alert: WeatherAlert; p: Props; historical?: HistoryRecordDetail }) {
  const superseded = snap.supersededAlertIds.includes(alert.id);
  const countable = isAlertCountable(alert, new Set(snap.supersededAlertIds), Date.now());
  const inCurrent = snap.alerts.some((a) => a.id === alert.id);
  const affected = snap.locations.map((l) => ({ l, m: matchAlert(l, alert) })).filter((x) => x.m.status !== 'outside');
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">{historical ? 'Weather alert · history record' : 'Weather alert'}</div>
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
        <Row label="Geometry">{alert.geometry ? 'Polygon supplied (drawn on globe)' : 'No polygon supplied — zone-based alert, not drawn on the globe'}</Row>
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
                  <button className="rec-item" onClick={() => p.onSelect({ kind: 'location', id: l.id })}>
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

function QuakeDetails({ snap, quake, p, historical }: { snap: AppSnapshot; quake: Earthquake; p: Props; historical?: HistoryRecordDetail }) {
  const c = quakeClass(quake.mag);
  const near = snap.locations
    .map((l) => ({ l, d: geodesicDistanceKm(l.lat, l.lon, quake.lat, quake.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);
  return (
    <div className="details">
      <header className="details-head">
        <div className="eyebrow">{historical ? 'Earthquake · history record' : 'Earthquake'}</div>
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
                <button className="rec-item" onClick={() => p.onSelect({ kind: 'location', id: l.id })}>
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

function Overview({ snap, p }: { snap: AppSnapshot; p: Props }) {
  const alertsById = new Map(snap.alerts.map((a) => [a.id, a]));
  const superseded = new Set(snap.supersededAlertIds);
  const now = Date.now();
  const active = snap.alerts.filter((a) => isAlertCountable(a, superseded, now));
  const withPolygon = active.filter((a) => a.geometry).length;
  const affected = snap.locations
    .map((l) => ({ l, ev: snap.evaluations[l.id] }))
    .filter((x) => x.ev && x.ev.alertsInside.length > 0)
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
          {snap.freshness.nws === 'unavailable' ? 'Unavailable' : `${active.length} (${withPolygon} with polygons, ${active.length - withPolygon} zone-based)`}
        </Row>
        <Row label="Earthquakes in feed">{snap.freshness.usgs === 'unavailable' ? 'Unavailable' : `${snap.quakes.length} (past ${snap.settings.quakeWindow}, M${snap.settings.quakeMinMagnitude}+)`}</Row>
        <Row label="Saved locations">{snap.locations.length}</Row>
      </dl>
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
            <p className="ok-text">None of your saved locations are inside an active alert.</p>
          ) : (
            <ul className="rec-list">
              {affected.map(({ l, ev, top }) => (
                <li key={l.id}>
                  <button className="rec-item" onClick={() => p.onSelect({ kind: 'location', id: l.id })}>
                    <span className={`tag ${SEVERITY_META[top].cls}`}>
                      <span aria-hidden="true">{SEVERITY_META[top].icon}</span> {top}
                    </span>
                    <span className="rec-title">{l.name}</span>
                    <span className="rec-meta">{ev!.alertsInside.length} alert(s)</span>
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
    body = a ? <AlertDetails snap={snap} alert={a} p={p} /> : <Empty>This alert is no longer in the active feed. Look it up in Event history.</Empty>;
  } else if (selection.kind === 'quake') {
    const q = snap.quakes.find((x) => x.id === selection.id);
    body = q ? <QuakeDetails snap={snap} quake={q} p={p} /> : <Empty>This earthquake is no longer in the current feed window.</Empty>;
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
      {body}
    </aside>
  );
}
