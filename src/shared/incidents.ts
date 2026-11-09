// Worldwide incident feed for the operations center and the Incidents layer.
//
// Sources (free, no key):
//   * GDACS – Global Disaster Alert and Coordination System (European Commission
//     JRC / UN OCHA): earthquakes, tropical cyclones, floods, volcanoes, droughts,
//     wildfires with GDACS' own Green/Orange/Red alert level.
//   * NASA EONET – Earth Observatory Natural Event Tracker: open natural events
//     with links to the originating agencies.
//
// Each record keeps the source's own classification. The app does not invent
// criticality or "verified" status. When a GDACS and an EONET event of the same
// type lie within 150 km and 3 days of each other, they are merged and both
// sources are listed ("reported by 2 sources"), which is corroboration of the
// report only, not independent verification of impact.

import type { GeoRecord } from './layers';

export type IncidentType = 'Earthquake' | 'Tropical cyclone' | 'Flood' | 'Volcano' | 'Drought' | 'Wildfire' | 'Severe storm' | 'Sea and lake ice' | 'Dust and haze' | 'Landslide' | 'Snow' | 'Temperature extreme' | 'Other';

const GDACS_TYPE: Record<string, IncidentType> = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };
const EONET_TYPE: Record<string, IncidentType> = {
  earthquakes: 'Earthquake',
  floods: 'Flood',
  volcanoes: 'Volcano',
  drought: 'Drought',
  wildfires: 'Wildfire',
  severeStorms: 'Severe storm',
  seaLakeIce: 'Sea and lake ice',
  dustHaze: 'Dust and haze',
  landslides: 'Landslide',
  snow: 'Snow',
  tempExtremes: 'Temperature extreme',
};

const s = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => {
  const t = s(v, 40);
  if (!t) return null;
  const d = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
  return Number.isFinite(d) ? new Date(d).toISOString() : null;
};

export function normalizeGdacs(body: unknown): { records: GeoRecord[]; skipped: number } {
  const feats = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(feats)) throw new Error('Unexpected GDACS response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const f of feats) {
    const ft = f as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };
    const p = ft.properties ?? {};
    const c = ft.geometry?.type === 'Point' ? (ft.geometry.coordinates as number[]) : null;
    const type = GDACS_TYPE[String(p.eventtype)];
    if (!c || !type || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) {
      skipped++;
      continue;
    }
    const url = (p.url ?? {}) as Record<string, unknown>;
    const level = s(p.alertlevel, 10);
    const sev = (p.severitydata ?? {}) as Record<string, unknown>;
    const report = s(url.report, 300);
    records.push({
      id: `gdacs-${String(p.eventtype)}-${String(p.eventid)}`,
      lat: c[1],
      lon: c[0],
      altM: null,
      heading: null,
      speedKts: null,
      label: s(p.name, 140) ?? `${type}`,
      category: type,
      observedAt: iso(p.datemodified) ?? iso(p.fromdate),
      sourceUrl: report && report.startsWith('https://www.gdacs.org/') ? report : 'https://www.gdacs.org/',
      source: 'GDACS',
      props: {
        incidentType: type,
        sourceSeverity: level ? `GDACS ${level} alert` : null,
        alertLevel: level,
        severityText: s(sev.severitytext, 120),
        country: s(p.country, 80),
        iso3: s(p.iso3, 3),
        startedAt: iso(p.fromdate),
        endedAt: iso(p.todate),
        updatedAt: iso(p.datemodified),
        current: String(p.iscurrent) === 'true',
        sources: 'GDACS',
        sourceLinks: report ?? null,
      },
    });
  }
  return { records, skipped };
}

export function normalizeEonet(body: unknown): { records: GeoRecord[]; skipped: number } {
  const evs = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(evs)) throw new Error('Unexpected EONET response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const e of evs) {
    const ev = e as Record<string, unknown>;
    const geoms = Array.isArray(ev.geometry) ? (ev.geometry as Record<string, unknown>[]) : [];
    // Latest point geometry (polygons are reduced to their first vertex ring centroid).
    const last = [...geoms].reverse().find((g) => g.type === 'Point' || g.type === 'Polygon');
    let lon: number | null = null;
    let lat: number | null = null;
    if (last?.type === 'Point') [lon, lat] = last.coordinates as number[];
    else if (last?.type === 'Polygon') {
      const ring = ((last.coordinates as number[][][])[0] ?? []) as number[][];
      if (ring.length) {
        lon = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      }
    }
    const cat = ((ev.categories as { id?: string; title?: string }[]) ?? [])[0];
    if (lon === null || lat === null || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      skipped++;
      continue;
    }
    const type = EONET_TYPE[String(cat?.id)] ?? 'Other';
    const srcs = ((ev.sources as { id?: string; url?: string }[]) ?? []).filter((x) => typeof x.url === 'string' && x.url.startsWith('http'));
    const mag = n(last?.magnitudeValue);
    records.push({
      id: `eonet-${s(ev.id, 30)}`,
      lat,
      lon,
      altM: null,
      heading: null,
      speedKts: null,
      label: s(ev.title, 140) ?? type,
      category: type,
      observedAt: iso(last?.date),
      sourceUrl: srcs[0]?.url ?? 'https://eonet.gsfc.nasa.gov/',
      source: 'NASA EONET',
      props: {
        incidentType: type,
        sourceSeverity: mag !== null ? `${mag} ${s(last?.magnitudeUnit, 20) ?? ''}`.trim() : null,
        alertLevel: null,
        severityText: null,
        country: null,
        iso3: null,
        startedAt: iso(geoms[0]?.date),
        endedAt: null,
        updatedAt: iso(last?.date),
        current: ev.closed === null || ev.closed === undefined,
        sources: `NASA EONET (${srcs.map((x) => x.id).join(', ') || 'no agency link'})`,
        sourceLinks: srcs.map((x) => x.url).join(' ') || null,
      },
    });
  }
  return { records, skipped };
}

function km(a: GeoRecord, b: GeoRecord): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Merges GDACS and EONET reports of the same event (same type, ≤150 km, ≤3 days apart). */
export function mergeIncidents(gdacs: GeoRecord[], eonet: GeoRecord[]): GeoRecord[] {
  const out = gdacs.map((g) => ({ ...g, props: { ...g.props } }));
  for (const e of eonet) {
    const t = Date.parse(e.observedAt ?? '') || 0;
    const m = out.find((g) => g.category === e.category && g.source === 'GDACS' && km(g, e) <= 150 && Math.abs((Date.parse(String(g.props.startedAt ?? g.observedAt)) || 0) - t) <= 3 * 86400_000 + 30 * 86400_000 * (e.category === 'Drought' ? 1 : 0));
    if (m) {
      m.props.sources = `GDACS + ${String(e.props.sources)}`;
      m.props.sourceLinks = [m.props.sourceLinks, e.props.sourceLinks].filter(Boolean).join(' ');
      m.props.reportedBy = 2;
    } else out.push({ ...e, props: { ...e.props, reportedBy: 1 } });
  }
  for (const r of out) if (r.props.reportedBy === undefined) r.props.reportedBy = 1;
  return out;
}
