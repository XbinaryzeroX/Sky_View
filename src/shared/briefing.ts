// Deterministic location briefing (no AI). Produces a standalone HTML
// document with no scripts and no remote resources.

import { monitoringCount, monitoringEvidence, severityRank, type MonitoringEvidence } from './monitoring';
import { escapeHtml } from './sanitize';
import type { AppSnapshot, Earthquake, FeedId, SavedLocation, WeatherAlert } from './types';
import { VISIT_EXAMPLES_PER_CHANGE, visitSourceUrl, type VisitBriefing, type VisitChanges, type VisitEndpoint } from './visitBriefing';

export type BriefingMode = 'locations' | 'visit';
export type BriefingRequest = { mode: 'locations'; locationIds: string[] } | { mode: 'visit' };
export interface BriefingPreview {
  previewId: string | null;
  mode: BriefingMode;
  generatedAt: string;
  html: string;
  /** Large location documents can explicitly use the legacy regenerate-at-export path. */
  exportPolicy: 'frozen' | 'current-locations';
  locationCount: number;
  byteLength: number;
}
export interface BriefingExportRequest { previewId: string }

export interface BriefingReference {
  kind: 'alert' | 'quake';
  id: string;
  url: string | null;
}

export interface Briefing {
  html: string;
  references: BriefingReference[];
  locationCount: number;
}

const FEED_LABEL: Record<FeedId, string> = {
  nws: 'National Weather Service — active alerts (api.weather.gov)',
  usgs: 'USGS Earthquake Hazards Program — GeoJSON summary feed',
};

export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const local = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
  const utc = d.toISOString().replace('T', ' ').slice(0, 16);
  return `${local} (${utc} UTC)`;
}

function link(url: string | null, text: string): string {
  const safe = briefingSourceUrl(url);
  if (!safe) return escapeHtml(text);
  return `<a href="${escapeHtml(safe)}">${escapeHtml(text)}</a>`;
}

/** Only retained NWS/USGS publisher record pages become active document links. */
export function briefingSourceUrl(value: unknown): string | null {
  return visitSourceUrl('nws', value) ?? visitSourceUrl('usgs', value);
}

function evidenceText(evidence: MonitoringEvidence, timeZone?: string): string {
  const label = evidence.state === 'current' ? 'Current' : evidence.state === 'last-observed' ? 'Last observed' : evidence.state === 'partial' ? `Partial evidence${!evidence.current ? ' · last observed' : ''}` : 'Unknown';
  return `${label}${evidence.observedAt ? ` · retrieved ${formatTime(evidence.observedAt, timeZone)}` : ''}${evidence.scope ? ` · scope ${evidence.scope}` : ''}. ${evidence.reason}`;
}

function evidenceCount(evidence: MonitoringEvidence, count: number): string {
  return monitoringCount(evidence, count).label;
}

const STYLE = `
body{font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:#1b2430;margin:32px auto;max-width:880px;padding:0 24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #ccd3dc;padding-bottom:4px}
h3{font-size:15px;margin:16px 0 6px}.muted{color:#5b6675}.small{font-size:12px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}th,td{border:1px solid #d5dbe3;padding:5px 7px;text-align:left;vertical-align:top;font-size:13px}
th{background:#eef2f6}.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:12px;font-weight:600;border:1px solid #9aa5b3}
.sev-Extreme,.sev-Severe{border-color:#b3261e;color:#8c1d18}.sev-Moderate{border-color:#a86b00;color:#7a4e00}
.note{background:#f6f3e8;border-left:3px solid #c49a2c;padding:6px 10px;margin:8px 0;font-size:13px}
.loc{page-break-inside:avoid}a{color:#0b5f8a}
li,.small.muted,td .muted{overflow-wrap:anywhere}
@page{size:Letter;margin:14mm}
@media print{
body{font-size:12px;line-height:1.4;margin:0;padding:0;max-width:none;overflow-wrap:anywhere;orphans:2;widows:2}
h1{font-size:18px;margin:0 0 4pt}h2{font-size:14px;margin:14pt 0 5pt;padding-bottom:3pt}h3{font-size:13px;margin:9pt 0 4pt}
h1,h2,h3{break-after:avoid-page;page-break-after:avoid}
p{margin:5pt 0 7pt}table{margin:4pt 0 8pt}th,td{font-size:11.5px;line-height:1.35;padding:4px 6px;min-width:7ch;overflow-wrap:anywhere}th{overflow-wrap:normal}
.small{font-size:10.5px}.note{font-size:11.5px;line-height:1.35;padding:5px 8px;margin:6px 0;break-inside:avoid;page-break-inside:avoid}
body>h2:first-of-type+table th:last-child,body>h2:first-of-type+table td:last-child{min-width:9ch}
ul,ol{margin:6px 0;padding-left:18px}.loc{break-inside:auto;page-break-inside:auto}
section>h2+p{break-after:avoid-page;page-break-after:avoid}
section>h2+p+table{break-before:avoid-page;page-break-before:avoid;break-inside:avoid;page-break-inside:avoid}
tr,li{break-inside:avoid;page-break-inside:avoid}table tr:first-child{break-after:avoid-page;page-break-after:avoid}
}
`;

export interface BriefingOptions {
  locationIds: string[];
  now: Date;
  timeZone?: string;
  appVersion: string;
}

export function buildBriefing(snap: AppSnapshot, opts: BriefingOptions): Briefing {
  const tz = opts.timeZone;
  const references: BriefingReference[] = [];
  const refSeen = new Set<string>();
  const addRef = (r: BriefingReference) => {
    const k = `${r.kind}:${r.id}`;
    if (!refSeen.has(k)) {
      refSeen.add(k);
      references.push({ ...r, url: briefingSourceUrl(r.url) });
    }
  };
  const alertsById = new Map<string, WeatherAlert>(snap.alerts.map((a) => [a.id, a]));
  const quakesById = new Map<string, Earthquake>(snap.quakes.map((q) => [q.id, q]));
  const wanted = new Set(opts.locationIds);
  const locations: SavedLocation[] = snap.locations.filter((l) => wanted.has(l.id));

  const parts: string[] = [];
  parts.push(`<h1>Sky_View location briefing</h1>`);
  if (snap.settings.orgName) parts.push(`<div class="muted">Prepared for ${escapeHtml(snap.settings.orgName)}</div>`);
  parts.push(`<div class="muted">Generated ${escapeHtml(formatTime(opts.now.toISOString(), tz))} · ${locations.length} location(s) · Sky_View ${escapeHtml(opts.appVersion)}</div>`);
  parts.push(`<div class="note">This briefing summarizes public data retrieved by Sky_View. It is not an official warning product and may be incomplete or delayed. For emergencies, follow official alerts from the National Weather Service and local authorities.</div>`);

  // Feed freshness
  parts.push('<h2>Data sources and freshness</h2><table><tr><th>Source</th><th>Status</th><th>Last successful retrieval</th><th>Source-reported update</th><th>Records</th></tr>');
  for (const feed of ['nws', 'usgs'] as FeedId[]) {
    const s = snap.feeds[feed];
    const fr = snap.freshness[feed];
    const evidence = monitoringEvidence(snap, feed);
    const statusText = !evidence.usable ? 'Unknown' : evidence.state === 'partial' ? 'Partial evidence' : fr === 'stale' ? 'Stale' : evidence.state === 'last-observed' ? 'Last observed' : 'Current';
    const cached = s.fromCache ? ' (loaded from local cache)' : '';
    const previous = evidence.usable && !evidence.current && statusText !== 'Last observed' ? ' · last observed' : '';
    const err = s.error ? `<div class="small muted">Last error: ${escapeHtml(s.error)}</div>` : '';
    parts.push(
      `<tr><td>${escapeHtml(FEED_LABEL[feed])}</td><td>${statusText}${cached}${previous}${err}<div class="small muted">${escapeHtml(evidence.reason)}</div></td><td>${escapeHtml(formatTime(s.lastSuccessAt, tz))}</td><td>${escapeHtml(formatTime(s.sourceUpdatedAt, tz))}</td><td>${escapeHtml(evidenceCount(evidence, s.recordCount))}</td></tr>`,
    );
  }
  parts.push('</table>');

  // Summary table
  parts.push('<h2>Summary</h2><table><tr><th>Location</th><th>Weather alerts (confirmed)</th><th>Alerts not determinable</th><th>Earthquakes within radius</th></tr>');
  for (const loc of locations) {
    const ev = snap.evaluations[loc.id];
    const nws = monitoringEvidence(snap, 'nws', loc), usgs = monitoringEvidence(snap, 'usgs', loc);
    parts.push(
      `<tr><td>${escapeHtml(loc.name)}</td><td>${ev ? escapeHtml(evidenceCount(nws, ev.alertsInside.length)) : 'Unknown'}</td><td>${ev ? escapeHtml(evidenceCount(nws, ev.alertsUnknown.length)) : 'Unknown'}</td><td>${ev ? escapeHtml(evidenceCount(usgs, ev.quakesNearby.length)) : 'Unknown'} (≤ ${loc.radiusKm} km)</td></tr>`,
    );
  }
  parts.push('</table>');

  // Per-location detail
  for (const loc of locations) {
    const ev = snap.evaluations[loc.id];
    parts.push(`<div class="loc"><h2>${escapeHtml(loc.name)}</h2>`);
    parts.push(
      `<div class="small muted">${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)} · ${escapeHtml(loc.category || 'Uncategorized')} · Monitoring radius ${loc.radiusKm} km${ev ? ` · Evaluated ${escapeHtml(formatTime(ev.evaluatedAt, tz))}` : ''}</div>`,
    );
    if (loc.notes) parts.push(`<div class="small">Notes: ${escapeHtml(loc.notes)}</div>`);
    if (!ev) {
      parts.push('<div class="note">This location has not been evaluated yet. Weather alerts and earthquakes are unknown.</div></div>');
      continue;
    }
    const nws = monitoringEvidence(snap, 'nws', loc), usgs = monitoringEvidence(snap, 'usgs', loc);
    parts.push('<h3>Weather alerts</h3>');
    parts.push(`<p class="small muted">NWS: ${escapeHtml(evidenceText(nws, tz))}</p>`);
    if (ev.alertCoverageNote) parts.push(`<div class="note">${escapeHtml(ev.alertCoverageNote)}</div>`);
    const inside = (nws.usable ? ev.alertsInside : [])
      .map((m) => ({ m, a: alertsById.get(m.alertId) }))
      .filter((x): x is { m: typeof x.m; a: WeatherAlert } => !!x.a)
      .sort((x, y) => severityRank(y.a.severity) - severityRank(x.a.severity));
    if (inside.length === 0) {
      parts.push(
        !nws.canAssertZero
          ? '<p>Weather alert status unknown. This evidence does not establish that no alerts apply.</p>'
          : '<p>No active alerts confirmed for this point.</p>',
      );
    } else {
      parts.push('<table><tr><th>Event</th><th>Severity / urgency</th><th>Onset → ends</th><th>Basis</th><th>Source</th></tr>');
      for (const { m, a } of inside) {
        addRef({ kind: 'alert', id: a.id, url: a.sourceUrl });
        parts.push(
          `<tr><td><strong>${escapeHtml(a.event)}</strong>${a.headline ? `<div class="small">${escapeHtml(a.headline)}</div>` : ''}${a.areaDesc ? `<div class="small muted">${escapeHtml(a.areaDesc)}</div>` : ''}</td>` +
            `<td><span class="tag sev-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span> ${escapeHtml(a.urgency)}</td>` +
            `<td class="small">${escapeHtml(formatTime(a.onset ?? a.effective, tz))}<br>→ ${escapeHtml(formatTime(a.ends ?? a.expires, tz))}</td>` +
            `<td class="small">${m.method === 'polygon' ? 'Point inside alert polygon' : 'Location is in an affected NWS zone'}</td>` +
            `<td class="small">${link(a.sourceUrl, a.senderName ?? 'NWS record')}<div class="muted">${escapeHtml(a.id)}</div></td></tr>`,
        );
        if (a.instruction) parts.push(`<tr><td colspan="5" class="small"><strong>Instructions:</strong> ${escapeHtml(a.instruction)}</td></tr>`);
      }
      parts.push('</table>');
    }

    parts.push(`<h3>Earthquakes within ${loc.radiusKm} km (distance to epicenter)</h3>`);
    parts.push(`<p class="small muted">USGS: ${escapeHtml(evidenceText(usgs, tz))}</p>`);
    if (!usgs.usable || (ev.quakesNearby.length === 0 && !usgs.canAssertZero)) parts.push('<p>Earthquake count unknown. This evidence does not establish that no earthquakes occurred within the radius.</p>');
    else if (ev.quakesNearby.length === 0) parts.push(`<p>No earthquakes in the selected feed window within ${loc.radiusKm} km.</p>`);
    else {
      if (ev.usgsFreshness === 'stale') parts.push('<div class="note">Earthquake data is stale; results reflect the last successful retrieval.</div>');
      parts.push('<table><tr><th>Magnitude</th><th>Location</th><th>Time</th><th>Depth</th><th>Distance to epicenter</th><th>Source</th></tr>');
      for (const qm of ev.quakesNearby.slice(0, 50)) {
        const q = quakesById.get(qm.quakeId);
        if (!q) continue;
        addRef({ kind: 'quake', id: q.id, url: q.url });
        parts.push(
          `<tr><td>${q.mag === null ? '—' : `M${q.mag.toFixed(1)}`}${q.magType ? ` <span class="muted small">${escapeHtml(q.magType)}</span>` : ''}</td><td>${escapeHtml(q.place ?? '—')}</td>` +
            `<td class="small">${escapeHtml(formatTime(q.time, tz))}</td><td>${q.depthKm === null ? '—' : `${q.depthKm.toFixed(1)} km`}</td>` +
            `<td>${qm.distanceKm.toFixed(1)} km</td><td class="small">${link(q.url, 'USGS event page')}<div class="muted">${escapeHtml(q.id)}</div></td></tr>`,
        );
      }
      parts.push('</table>');
      if (ev.quakesNearby.length > 50) parts.push(`<p class="small muted">${ev.quakesNearby.length - 50} additional earthquakes omitted.</p>`);
    }
    parts.push('</div>');
  }

  parts.push(`<h2>Coverage limitations</h2><ul class="small">
<li>Weather alert intersection uses the alert polygon when NWS supplies one. Alerts without a polygon are matched using the NWS forecast, county, and fire-weather zones reported for the location. If zones are unknown, the alert is reported as not determinable rather than as not affecting the location.</li>
<li>Earthquake distance is the geodesic distance from the location to the reported epicenter. It is not an estimate of shaking, damage, or personal danger.</li>
<li>Earthquakes are limited to the selected USGS summary feed window and minimum magnitude.</li>
<li>Data reflects the last successful retrieval shown above and may be delayed, revised, or incomplete. Sky_View only observes records while it is running.</li>
<li>A point outside the NWS zone service has unknown overall NWS alert coverage. Supplied polygons are still tested and confirmed intersections are retained; a missing zone match is not evidence of no alerts.</li>
</ul>`);
  parts.push(`<h2>Attribution</h2><p class="small">Weather alerts: National Weather Service / NOAA (public domain). Earthquakes: U.S. Geological Survey Earthquake Hazards Program (public domain). Generated by Sky_View from deterministic templates; no AI was used to produce this document.</p>`);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sky_View briefing — ${escapeHtml(opts.now.toISOString().slice(0, 10))}</title><style>${STYLE}</style></head><body>${parts.join('\n')}</body></html>`;
  return { html, references, locationCount: locations.length };
}

/** Frozen endpoint evidence, rather than an inferred event log for the time the app was closed. */
export function buildVisitBriefing(visit: VisitBriefing, opts: Omit<BriefingOptions, 'locationIds'> & { organization?: string }): Briefing {
  const parts: string[] = ['<h1>Sky_View — Since last visit</h1>'];
  const references: BriefingReference[] = [];
  const seen = new Set<string>();
  const exactTime = (value: string | null): string => {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
    const local = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }).format(new Date(value));
    return `${escapeHtml(local)}<br><span class="small muted">${escapeHtml(new Date(value).toISOString())}</span>`;
  };
  if (opts.organization) parts.push(`<div class="muted">Prepared for ${escapeHtml(opts.organization)}</div>`);
  parts.push(`<div class="muted">Generated ${escapeHtml(formatTime(opts.now.toISOString(), opts.timeZone))} · Sky_View ${escapeHtml(opts.appVersion)}</div>`);
  parts.push('<div class="note">This compares recorded source replies from two visits. It is not a complete log of events while Sky_View was closed, an official warning, or an estimate of shaking, damage or safety.</div>');
  parts.push(`<p class="small">Current visit started: ${exactTime(visit.sessionStartedAt)}<br>Previous visit started: ${exactTime(visit.previousStartedAt)}<br>Comparison data generated: ${exactTime(visit.generatedAt)}</p>`);
  if (!visit.previousStartedAt) parts.push('<div class="note">No previous visit baseline is available. Unknown change totals are not zero changes.</div>');
  if (visit.error) parts.push(`<div class="note">Comparison unavailable: ${escapeHtml(visit.error)}</div>`);
  const total = (change: VisitChanges) => change.total === null ? 'Unknown' : change.total;
  parts.push('<h2>Recorded endpoint changes</h2><table><tr><th>Source</th><th>New</th><th>Updated</th><th>No longer returned</th></tr>');
  for (const feed of ['nws', 'usgs'] as const) {
    const source = visit.feeds[feed];
    parts.push(`<tr><td>${feed === 'nws' ? 'NWS active alerts' : 'USGS earthquakes'}</td><td>${total(source.new)}</td><td>${total(source.updated)}</td><td>${total(source.noLongerReturned)}</td></tr>`);
  }
  parts.push('</table><p class="small muted">Totals compare distinct source IDs in two recorded replies, not every intervening revision. Unknown is not zero: missing, partial, pruned or differently scoped evidence can prevent comparison. Expired endpoints may support qualified endpoint counts, not continuous coverage. Per-source status and limits below apply to these counts.</p>');
  const endpointState = (endpoint: VisitEndpoint) => `${escapeHtml(endpoint.state)}${endpoint.reason ? `<div class="small">${escapeHtml(endpoint.reason)}</div>` : ''}`;
  const endpointRows = (baseline: VisitEndpoint, current: VisitEndpoint) => [
    ['State', endpointState(baseline), endpointState(current)],
    ['App observation', exactTime(baseline.observedAt), exactTime(current.observedAt)],
    ['Source update', exactTime(baseline.sourceUpdatedAt), exactTime(current.sourceUpdatedAt)],
    ['Scope', escapeHtml(baseline.scope ?? 'Unknown'), escapeHtml(current.scope ?? 'Unknown')],
    ['Reply members', baseline.recordCount === null ? 'Unknown' : baseline.recordCount, current.recordCount === null ? 'Unknown' : current.recordCount],
    ['Frame validity limit', exactTime(baseline.validUntil), exactTime(current.validUntil)],
  ].map(([label, prior, latest]) => `<tr><td>${label}</td><td>${prior}</td><td>${latest}</td></tr>`).join('');
  for (const feed of ['nws', 'usgs'] as const) {
    const source = visit.feeds[feed];
    const qualified = source.status === 'ready' ? 'Comparable recorded endpoints' : source.status === 'limited' ? 'Recorded endpoint evidence — coverage limited' : 'Comparison unavailable';
    parts.push(`<section><h2>${escapeHtml(FEED_LABEL[feed])}</h2><p><strong>${qualified}</strong></p>`);
    parts.push('<table><tr><th>Evidence</th><th>Baseline</th><th>Current</th></tr>');
    parts.push(endpointRows(source.baseline, source.current), '</table>');
    const groups: { label: string; change: VisitChanges }[] = [
      { label: 'New in current recorded reply', change: source.new },
      { label: 'Updated since baseline', change: source.updated },
      { label: 'No longer returned in current reply', change: source.noLongerReturned },
    ];
    if (source.limits.length) parts.push(`<ul class="small">${source.limits.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`);
    for (const { label, change } of groups) {
      if (change.total === null || change.total === 0 || change.examples.length === 0) continue;
      parts.push(`<h3>${label} — ${change.total}</h3>`);
      const examples = change.examples.slice(0, VISIT_EXAMPLES_PER_CHANGE);
      parts.push('<ul>');
      for (const example of examples) {
        const url = visitSourceUrl(feed, example.url);
        const key = `${feed}:${example.id}`;
        if (!seen.has(key)) { seen.add(key); references.push({ kind: feed === 'nws' ? 'alert' : 'quake', id: example.id, url }); }
        parts.push(`<li>${link(url, example.label)}<div class="small muted">Source ID: ${escapeHtml(example.id)}</div></li>`);
      }
      parts.push('</ul>');
      if (change.truncated || change.total > examples.length) parts.push(`<p class="small muted">Showing ${examples.length} of ${change.total} source identifiers; remaining examples omitted.</p>`);
    }
    parts.push('</section>');
  }
  parts.push('<h2>Interpretation and sources</h2><p>No longer returned means only absent from the current recorded reply. It does not establish that an event ended, was cancelled or resolved, or that conditions are safe. Rolling feed windows and source revisions can remove identifiers.</p>');
  parts.push('<p>USGS coverage follows the recorded summary window and magnitude bucket. NWS active-alert coverage is the United States and its territories. The app may have missed changes between observations or while closed; only successful recorded replies support current endpoint evidence.</p>');
  parts.push('<p class="small">Weather alerts: National Weather Service / NOAA. Earthquakes: USGS Earthquake Hazards Program. Publisher record links appear with retained examples when available. Deterministic templates; no AI was used.</p>');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sky_View — Since last visit</title><style>${STYLE}</style></head><body>${parts.join('\n')}</body></html>`;
  return { html, references, locationCount: 0 };
}
