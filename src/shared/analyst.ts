// Deterministic analyst: turns common questions into ordinary filters over the
// data already loaded in the app. It never invents objects; every result row
// points at a real record. Unrecognized questions return null so the UI can
// offer the optional local AI (which only explains computed results).

import { aircraftClass, specialCode } from './aircraft';
import { describeFeedDiff, isAlertCountable } from './dedupe';
import type { GeoRecord, LayerId } from './layers';
import { monitoringCount, monitoringEvidence } from './monitoring';
import type { AppSnapshot, FeedId } from './types';

export interface AnalystRow {
  label: string;
  detail: string;
  layer: LayerId | 'alert' | 'quake' | 'location';
  id: string;
  /** Separate source matches can open the same saved place. */
  sourceId?: string;
  lat: number | null;
  lon: number | null;
}

export interface AnalystAnswer {
  title: string;
  rows: AnalystRow[];
  note: string;
  openVisitBriefing?: boolean;
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

interface MagnitudeFilter { value: number; strict: boolean }

function matchesMagnitude(magnitude: number | null, filter?: MagnitudeFilter): boolean {
  if (!filter) return true;
  return magnitude !== null && (filter.strict ? magnitude > filter.value : magnitude >= filter.value);
}

function savedPlaceMatches(snap: AppSnapshot, feed: FeedId, box: AnalystData['viewBbox'], magnitude?: MagnitudeFilter): AnalystAnswer {
  const places = snap.locations.filter((place) => inBox(place.lat, place.lon, box));
  const source = monitoringEvidence(snap, feed);
  const name = feed.toUpperCase();
  const note = [source.reason];
  if (source.observedAt) note.push(`Reply received at ${source.observedAt}.`);
  if (!places.length) return { title: box ? 'No saved places in this view' : 'No saved places to evaluate', note: note.join(' '), rows: [] };
  const alerts = new Map(snap.alerts.map((a) => [a.id, a]));
  const quakes = new Map(snap.quakes.map((q) => [q.id, q]));
  const rows: AnalystRow[] = [];
  let matched = 0;
  let incomplete = 0;
  let totalMatches = 0;
  for (const place of places) {
    const ev = snap.evaluations[place.id];
    const evidence = monitoringEvidence(snap, feed, place);
    if (!ev || !evidence.canAssertZero) incomplete++;
    if (!ev || !evidence.usable) continue;
    const before = totalMatches;
    const add = (sourceId: string, detail: string) => {
      totalMatches++;
      if (rows.length < 200) rows.push({ layer: 'location', id: place.id, sourceId, label: place.name, detail, lat: place.lat, lon: place.lon });
    };
    if (feed === 'nws') {
      for (const match of ev.alertsInside) {
        const alert = alerts.get(match.alertId);
        if (alert) add(alert.id, `${alert.event} (${alert.severity}) · ${match.method === 'zone' ? 'in affected zone' : 'inside polygon'} · ${alert.id}`);
      }
    } else {
      for (const match of ev.quakesNearby) {
        const quake = quakes.get(match.quakeId);
        if (quake && matchesMagnitude(quake.mag, magnitude)) {
          add(quake.id, `${quake.mag === null ? 'Magnitude unknown' : `M${quake.mag}`} · ${match.distanceKm} km to epicenter · ${quake.time} · ${quake.id}`);
        }
      }
    }
    if (totalMatches > before) matched++;
  }
  if (feed === 'usgs') note.push(`Each place uses its saved radius and the selected USGS ${snap.settings.quakeWindow} feed, M${snap.settings.quakeMinMagnitude}+.`);
  if (incomplete) note.push(`Coverage is incomplete or out of date for ${incomplete} of ${places.length} saved places.`);
  if (totalMatches > rows.length) note.push(`Showing ${rows.length} of ${totalMatches} observed matches.`);
  const subject = feed === 'nws' ? 'alerts' : 'nearby earthquakes';
  const title = !matched && incomplete
    ? `Saved places with ${subject}: unknown`
    : `${incomplete && matched < places.length ? 'At least ' : ''}${matched} saved place${matched === 1 ? '' : 's'} with ${subject} in the ${source.current ? '' : 'last observed '}${name} reply`;
  return { title, rows, note: note.join(' ') };
}

export function answerQuestion(q: string, d: AnalystData): AnalystAnswer | null {
  const t = q.toLowerCase();
  if (/\b(?:last|previous|prior)\s+(?:visit|session)\b|\bsince i last (?:opened|used|checked|visited)\b/.test(t)) {
    return {
      title: 'Since your last visit',
      rows: [],
      note: 'The visit briefing compares recorded NWS weather alerts and USGS earthquakes across two app launches. It covers each source’s full recorded query.',
      openVisitBriefing: true,
    };
  }
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
    const rows = uniqAircraft.filter((r) => aircraftClass(r) === 'military' || aircraftClass(r) === 'fighter');
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
  const savedPlaces = /\b(?:saved|my) (?:places?|locations?|properties|sites?)\b/.test(t);
  if (savedPlaces && /\balerts?\b/.test(t)) return savedPlaceMatches(d.snap, 'nws', box);
  if (/\b(?:earth)?quakes?\b/.test(t)) {
    const threshold = /\b(?:earth)?quakes?\b.*?(?:(above|over|at least|>=?)\s*(?:magnitude\s*|m\s*)?|\b(?:magnitude|m)\s*)(-?\d+(?:\.\d+)?)/.exec(t);
    const magnitude = threshold ? { value: Number(threshold[2]), strict: ['above', 'over', '>'].includes(threshold[1]) } : undefined;
    if (savedPlaces) return savedPlaceMatches(d.snap, 'usgs', box, magnitude);
    const source = monitoringEvidence(d.snap, 'usgs');
    const rows = source.usable ? d.snap.quakes.filter((q2) => matchesMagnitude(q2.mag, magnitude) && inBox(q2.lat, q2.lon, box)).sort((a, b) => (b.mag ?? -Infinity) - (a.mag ?? -Infinity)) : [];
    const count = monitoringCount(source, rows.length);
    const thresholdText = magnitude ? ` ${magnitude.strict ? 'above' : 'at least'} M${magnitude.value}` : '';
    return { title: `Earthquakes${thresholdText} in the feed window${scopeText}: ${count.label}`, rows: rows.slice(0, 100).map((q2) => ({ label: `M${q2.mag?.toFixed(1) ?? '?'} ${q2.place ?? ''}`, detail: `${q2.time.slice(0, 16).replace('T', ' ')}Z · ${q2.id}`, layer: 'quake', id: q2.id, lat: q2.lat, lon: q2.lon })), note: `USGS feed (${d.snap.settings.quakeWindow}, M${d.snap.settings.quakeMinMagnitude}+). ${source.reason}${source.observedAt ? ` Reply received at ${source.observedAt}.` : ''}` };
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
      if (a && isAlertCountable(a, new Set(d.snap.supersededAlertIds), Date.now())) rows.push({ label: `New alert: ${a.event}`, detail: `${a.areaDesc ?? ''} · ${a.id}`.slice(0, 200), layer: 'alert', id, lat: a.bbox ? (a.bbox[1] + a.bbox[3]) / 2 : null, lon: a.bbox ? (a.bbox[0] + a.bbox[2]) / 2 : null });
    }
    for (const id of usgs?.added ?? []) {
      const q2 = quakes.get(id);
      if (q2) rows.push({ label: `New earthquake M${q2.mag ?? '?'}`, detail: `${q2.place ?? ''} · ${q2.id}`, layer: 'quake', id, lat: q2.lat, lon: q2.lon });
    }
    const summaries = [describeFeedDiff(nws), describeFeedDiff(usgs)].filter(Boolean);
    const observations = (['nws', 'usgs'] as const).map((feed) => {
      const diff = d.snap.diffs[feed];
      if (diff?.unavailableReason) return `${feed.toUpperCase()} change counts are unknown. ${diff.unavailableReason}`;
      return diff?.previousAt
        ? `${feed.toUpperCase()} compared replies received at ${diff.previousAt} and ${diff.at}.`
        : `${feed.toUpperCase()} has no comparable previous reply.`;
    });
    return { title: summaries.join(' · ') || 'Waiting for comparable replies', rows, note: observations.join(' ') };
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
  'What changed since my last visit?',
];
