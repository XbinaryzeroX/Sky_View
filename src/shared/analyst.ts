// Deterministic analyst: turns common questions into ordinary filters over the
// data already loaded in the app. It never invents objects; every result row
// points at a real record. Unrecognized questions return null so the UI can
// offer the optional local AI (which only explains computed results).

import { aircraftClass, specialCode } from './aircraft';
import { isAlertCountable } from './dedupe';
import type { GeoRecord, LayerId } from './layers';
import type { AppSnapshot } from './types';

export interface AnalystRow {
  label: string;
  detail: string;
  layer: LayerId | 'alert' | 'quake' | 'location';
  id: string;
  lat: number;
  lon: number;
}

export interface AnalystAnswer {
  title: string;
  rows: AnalystRow[];
  note: string;
}

export interface AnalystData {
  snap: AppSnapshot;
  layers: Partial<Record<LayerId, { records: GeoRecord[]; lastSuccessAt: string | null; freshness: string }>>;
  /** [west, south, east, north] when the question is limited to the current view. */
  viewBbox: [number, number, number, number] | null;
}

function inBox(lat: number, lon: number, b: [number, number, number, number] | null): boolean {
  if (!b) return true;
  const [w, s, e, n] = b;
  const lonOk = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
  return lat >= s && lat <= n && lonOk;
}

function freshnessNote(d: AnalystData, ids: LayerId[]): string {
  const parts = ids.map((id) => {
    const l = d.layers[id];
    if (!l) return `${id}: layer off (no data loaded)`;
    return `${id}: ${l.records.length} loaded, ${l.freshness}${l.lastSuccessAt ? `, fetched ${l.lastSuccessAt.slice(11, 19)}Z` : ''}`;
  });
  return `Computed from data currently loaded in the app (${parts.join('; ')}). Coverage depends on each provider; objects outside coverage are not counted.`;
}

const num = (s: string) => Number(s.replace(/,/g, ''));

export function answerQuestion(q: string, d: AnalystData): AnalystAnswer | null {
  const t = q.toLowerCase();
  const scoped = /\b(here|this area|in view|visible|this region|on screen)\b/.test(t);
  const box = scoped ? d.viewBbox : null;
  const scopeText = scoped ? ' in the current view' : '';
  const aircraft = [...(d.layers.aircraft?.records ?? []), ...(d.layers.aircraftMil?.records ?? [])];
  const uniqAircraft = [...new Map(aircraft.map((r) => [r.id, r])).values()].filter((r) => inBox(r.lat, r.lon, box));
  const aRow = (r: GeoRecord, layer: LayerId = 'aircraft'): AnalystRow => ({
    label: r.label,
    detail: `${typeof r.props.altitudeFt === 'number' ? `${r.props.altitudeFt.toLocaleString()} ft` : r.props.onGround ? 'on ground' : 'altitude n/a'}${r.props.type ? ` · ${r.props.type}` : ''} · hex ${r.id}`,
    layer,
    id: r.id,
    lat: r.lat,
    lon: r.lon,
  });

  let m = /(aircraft|planes?|flights?|jets?).*?(above|over|higher than|>)\s*(fl\s*)?([\d,]+)/.exec(t);
  if (m) {
    const ft = m[3] ? num(m[4]) * 100 : num(m[4]);
    const rows = uniqAircraft.filter((r) => typeof r.props.altitudeFt === 'number' && r.props.altitudeFt > ft).sort((a, b) => Number(b.props.altitudeFt) - Number(a.props.altitudeFt));
    return { title: `${rows.length} aircraft above ${ft.toLocaleString()} ft${scopeText}`, rows: rows.slice(0, 200).map((r) => aRow(r)), note: freshnessNote(d, ['aircraft', 'aircraftMil']) };
  }
  m = /(aircraft|planes?|flights?).*?(below|under|lower than|<)\s*([\d,]+)/.exec(t);
  if (m) {
    const ft = num(m[3]);
    const rows = uniqAircraft.filter((r) => typeof r.props.altitudeFt === 'number' && r.props.altitudeFt < ft && !r.props.onGround);
    return { title: `${rows.length} airborne aircraft below ${ft.toLocaleString()} ft${scopeText}`, rows: rows.slice(0, 200).map((r) => aRow(r)), note: freshnessNote(d, ['aircraft']) };
  }
  if (/(emergenc|squawk|7700|7600|7500|nordo)/.test(t)) {
    const rows = uniqAircraft.filter((r) => specialCode(r));
    return {
      title: `${rows.length} aircraft reporting a special code${scopeText}`,
      rows: rows.map((r) => ({ ...aRow(r), detail: `${specialCode(r)!.label} · reported ${r.observedAt?.slice(11, 19) ?? '?'}Z` })),
      note: `${freshnessNote(d, ['aircraft', 'aircraftMil'])} A reported code is not a confirmed incident.`,
    };
  }
  if (/military/.test(t)) {
    const rows = uniqAircraft.filter((r) => aircraftClass(r) === 'military');
    return { title: `${rows.length} military-flagged aircraft${scopeText}`, rows: rows.slice(0, 200).map((r) => aRow(r, 'aircraftMil')), note: `${freshnessNote(d, ['aircraftMil'])} The flag comes from a database and may be wrong.` };
  }
  m = /(cargo|tanker|passenger|fishing|tug|pilot)\s*(vessel|ship|boat)?s?/.exec(t);
  if (m && /(vessel|ship|boat|cargo|tanker)/.test(t)) {
    const want = m[1];
    const rows = (d.layers.vessels?.records ?? []).filter((r) => (r.category ?? '').toLowerCase().startsWith(want) && inBox(r.lat, r.lon, box));
    return {
      title: `${rows.length} ${want} vessels${scopeText}`,
      rows: rows.slice(0, 200).map((r) => ({ label: r.label, detail: `${r.category} · ${r.speedKts !== null ? `${r.speedKts.toFixed(1)} kn` : 'speed n/a'}${r.props.destinationReported ? ` · reported destination ${r.props.destinationReported}` : ''} · MMSI ${r.id}`, layer: 'vessels', id: r.id, lat: r.lat, lon: r.lon })),
      note: `${freshnessNote(d, ['vessels'])} Vessel type is self-reported over AIS.`,
    };
  }
  if (/(saved|my) (places|locations|properties|sites).*alert|alert.*(saved|my) (places|locations)/.test(t)) {
    const alerts = new Map(d.snap.alerts.map((a) => [a.id, a]));
    const rows: AnalystRow[] = [];
    for (const l of d.snap.locations) {
      const ev = d.snap.evaluations[l.id];
      for (const mm of ev?.alertsInside ?? []) {
        const a = alerts.get(mm.alertId);
        if (a) rows.push({ label: l.name, detail: `${a.event} (${a.severity}) · ${mm.method === 'polygon' ? 'inside polygon' : 'in affected zone'} · ${a.id}`, layer: 'location', id: l.id, lat: l.lat, lon: l.lon });
      }
    }
    const unknown = d.snap.locations.reduce((n, l) => n + (d.snap.evaluations[l.id]?.alertsUnknown.length ? 1 : 0), 0);
    return { title: `${new Set(rows.map((r) => r.id)).size} saved places inside active alerts`, rows, note: `NWS alerts (U.S. only), ${d.snap.freshness.nws}. ${unknown} place(s) have alerts that could not be evaluated.` };
  }
  m = /(earthquake|quake)s?.*?(above|over|magnitude|m|>=?)\s*(\d(\.\d)?)/.exec(t);
  if (m || /(earthquake|quake)/.test(t)) {
    const min = m ? Number(m[3]) : 0;
    const rows = d.snap.quakes.filter((q2) => (q2.mag ?? -9) >= min && inBox(q2.lat, q2.lon, box)).sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0));
    return { title: `${rows.length} earthquakes M${min}+ in the feed window${scopeText}`, rows: rows.slice(0, 100).map((q2) => ({ label: `M${q2.mag?.toFixed(1) ?? '?'} ${q2.place ?? ''}`, detail: `${q2.time.slice(0, 16).replace('T', ' ')}Z · ${q2.id}`, layer: 'quake', id: q2.id, lat: q2.lat, lon: q2.lon })), note: `USGS feed (${d.snap.settings.quakeWindow}, M${d.snap.settings.quakeMinMagnitude}+), ${d.snap.freshness.usgs}.` };
  }
  if (/fire/.test(t)) {
    const rows = (d.layers.fires?.records ?? []).filter((r) => inBox(r.lat, r.lon, box)).sort((a, b) => Number(b.props.frpMW ?? 0) - Number(a.props.frpMW ?? 0));
    return { title: `${rows.length} satellite fire detections${scopeText} (strongest first)`, rows: rows.slice(0, 100).map((r) => ({ label: r.label, detail: `${r.observedAt?.slice(0, 16).replace('T', ' ')}Z · ${r.props.satellite}`, layer: 'fires', id: r.id, lat: r.lat, lon: r.lon })), note: `${freshnessNote(d, ['fires'])} A detection is a hot pixel, not a confirmed wildfire.` };
  }
  if (/(what changed|changes|since (the )?(last|previous) refresh|new alerts|ended)/.test(t)) {
    const rows: AnalystRow[] = [];
    const alerts = new Map(d.snap.alerts.map((a) => [a.id, a]));
    const quakes = new Map(d.snap.quakes.map((q2) => [q2.id, q2]));
    const nws = d.snap.diffs.nws;
    const usgs = d.snap.diffs.usgs;
    for (const id of nws?.added ?? []) {
      const a = alerts.get(id);
      if (a && isAlertCountable(a, new Set(d.snap.supersededAlertIds), Date.now())) rows.push({ label: `New alert: ${a.event}`, detail: `${a.areaDesc ?? ''} · ${a.id}`.slice(0, 200), layer: 'alert', id, lat: a.bbox ? (a.bbox[1] + a.bbox[3]) / 2 : 0, lon: a.bbox ? (a.bbox[0] + a.bbox[2]) / 2 : 0 });
    }
    for (const id of usgs?.added ?? []) {
      const q2 = quakes.get(id);
      if (q2) rows.push({ label: `New earthquake M${q2.mag ?? '?'}`, detail: `${q2.place ?? ''} · ${q2.id}`, layer: 'quake', id, lat: q2.lat, lon: q2.lon });
    }
    return {
      title: `Since the previous refresh: ${nws?.added.length ?? 0} new / ${nws?.removed.length ?? 0} ended alerts, ${usgs?.added.length ?? 0} new / ${usgs?.updated.length ?? 0} updated earthquakes`,
      rows,
      note: nws?.previousAt || usgs?.previousAt ? `Compared with the refresh at ${(nws?.previousAt ?? usgs?.previousAt ?? '').slice(11, 19)}Z.` : 'No previous refresh in this session yet, so no changes can be reported.',
    };
  }
  return null;
}

export const ANALYST_EXAMPLES = [
  'Which aircraft are above 30,000 feet?',
  'Show cargo vessels in this area',
  'Which of my saved places intersect an active alert?',
  'Any emergency squawks?',
  'Earthquakes above magnitude 4.5',
  'What changed since the last refresh?',
];
