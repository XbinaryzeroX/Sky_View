// Deterministic location briefing (no AI). Produces a standalone HTML
// document with no scripts and no remote resources.

import { severityRank } from './monitoring';
import { escapeHtml } from './sanitize';
import type { AppSnapshot, Earthquake, FeedId, SavedLocation, WeatherAlert } from './types';

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
  if (!url) return escapeHtml(text);
  return `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;
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
      references.push(r);
    }
  };
  const alertsById = new Map<string, WeatherAlert>(snap.alerts.map((a) => [a.id, a]));
  const quakesById = new Map<string, Earthquake>(snap.quakes.map((q) => [q.id, q]));
  const wanted = new Set(opts.locationIds);
  const locations: SavedLocation[] = snap.locations.filter((l) => wanted.has(l.id));

  const parts: string[] = [];
  parts.push(`<h1>Atlas Watch location briefing</h1>`);
  if (snap.settings.orgName) parts.push(`<div class="muted">Prepared for ${escapeHtml(snap.settings.orgName)}</div>`);
  parts.push(`<div class="muted">Generated ${escapeHtml(formatTime(opts.now.toISOString(), tz))} · ${locations.length} location(s) · Atlas Watch ${escapeHtml(opts.appVersion)}</div>`);
  parts.push(`<div class="note">This briefing summarizes public data retrieved by Atlas Watch. It is not an official warning product and may be incomplete or delayed. For emergencies, follow official alerts from the National Weather Service and local authorities.</div>`);

  // Feed freshness
  parts.push('<h2>Data sources and freshness</h2><table><tr><th>Source</th><th>Status</th><th>Last successful retrieval</th><th>Source-reported update</th><th>Records</th></tr>');
  for (const feed of ['nws', 'usgs'] as FeedId[]) {
    const s = snap.feeds[feed];
    const fr = snap.freshness[feed];
    const statusText = fr === 'unavailable' ? 'Unavailable' : fr === 'stale' ? 'Stale' : 'Current';
    const cached = s.fromCache ? ' (loaded from local cache)' : '';
    const err = s.error ? `<div class="small muted">Last error: ${escapeHtml(s.error)}</div>` : '';
    parts.push(
      `<tr><td>${escapeHtml(FEED_LABEL[feed])}</td><td>${statusText}${cached}${err}</td><td>${escapeHtml(formatTime(s.lastSuccessAt, tz))}</td><td>${escapeHtml(formatTime(s.sourceUpdatedAt, tz))}</td><td>${s.recordCount}</td></tr>`,
    );
  }
  parts.push('</table>');

  // Summary table
  parts.push('<h2>Summary</h2><table><tr><th>Location</th><th>Weather alerts (confirmed)</th><th>Alerts not determinable</th><th>Earthquakes within radius</th></tr>');
  for (const loc of locations) {
    const ev = snap.evaluations[loc.id];
    parts.push(
      `<tr><td>${escapeHtml(loc.name)}</td><td>${ev ? ev.alertsInside.length : '—'}</td><td>${ev ? ev.alertsUnknown.length : '—'}</td><td>${ev ? ev.quakesNearby.length : '—'} (≤ ${loc.radiusKm} km)</td></tr>`,
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
      parts.push('<div class="note">This location has not been evaluated yet.</div></div>');
      continue;
    }
    parts.push('<h3>Weather alerts</h3>');
    if (ev.alertCoverageNote) parts.push(`<div class="note">${escapeHtml(ev.alertCoverageNote)}</div>`);
    const inside = ev.alertsInside
      .map((m) => ({ m, a: alertsById.get(m.alertId) }))
      .filter((x): x is { m: typeof x.m; a: WeatherAlert } => !!x.a)
      .sort((x, y) => severityRank(y.a.severity) - severityRank(x.a.severity));
    if (inside.length === 0) {
      parts.push(
        ev.nwsFreshness === 'unavailable'
          ? '<p>Weather alert status unknown (data unavailable).</p>'
          : `<p>No active alerts confirmed for this point${ev.alertsUnknown.length ? `; ${ev.alertsUnknown.length} alert(s) could not be evaluated` : ''}.</p>`,
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
    if (ev.usgsFreshness === 'unavailable') parts.push('<p>Earthquake data unavailable.</p>');
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
<li>Data reflects the last successful retrieval shown above and may be delayed, revised, or incomplete. Atlas Watch only observes records while it is running.</li>
<li>Locations outside NWS coverage (outside the U.S. and its territories) cannot be evaluated for NWS alerts.</li>
</ul>`);
  parts.push(`<h2>Attribution</h2><p class="small">Weather alerts: National Weather Service / NOAA (public domain). Earthquakes: U.S. Geological Survey Earthquake Hazards Program (public domain). Generated by Atlas Watch from deterministic templates; no AI was used to produce this document.</p>`);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Watch briefing — ${escapeHtml(opts.now.toISOString().slice(0, 10))}</title><style>${STYLE}</style></head><body>${parts.join('\n')}</body></html>`;
  return { html, references, locationCount: locations.length };
}
