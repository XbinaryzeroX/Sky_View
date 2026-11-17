// Normalizers and fixed request builders for four keyless layers: bike-share stations (GBFS), wildlife sightings
// (iNaturalist), Canadian air quality (ECCC AQHI) and news-reported violence (GDELT 2.0 events). Remote payloads are
// untrusted: fields are type-checked and length-limited, malformed records are counted and skipped.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText, toIso } from './normalize';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KM_PER_DEG = 111.32;
const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLon = ((((bLon - aLon) % 360) + 540) % 360) - 180;
  return Math.hypot((bLat - aLat) * KM_PER_DEG, dLon * KM_PER_DEG * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)));
};

// ---------------------------------------------------------------- bike share (GBFS)

export interface BikeSystem {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  /** Stations load when the view centre is within this distance. */
  radiusKm: number;
  infoUrl: string;
  statusUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  /** Urban Sharing asks every client to name itself in this header. */
  clientIdHeader?: boolean;
}

const LYFT = (id: string, name: string, city: string, lat: number, lon: number, path: string, licenseUrl: string): BikeSystem => ({
  id, name, city, lat, lon, radiusKm: 60,
  infoUrl: `https://gbfs.lyft.com/gbfs/2.3/${path}/en/station_information.json`,
  statusUrl: `https://gbfs.lyft.com/gbfs/2.3/${path}/en/station_status.json`,
  license: `${name} Data License Agreement (Lyft)`, licenseUrl, attribution: `${name} (Lyft)`,
});
const URBAN = (id: string, name: string, city: string, lat: number, lon: number, system: string, licenseUrl: string): BikeSystem => ({
  id, name, city, lat, lon, radiusKm: 40,
  infoUrl: `https://gbfs.urbansharing.com/${system}/station_information.json`,
  statusUrl: `https://gbfs.urbansharing.com/${system}/station_status.json`,
  license: 'NLOD 2.0', licenseUrl, attribution: `${name}, NLOD 2.0`, clientIdHeader: true,
});

/** Systems whose published terms were read and allow this use (2026-11-14). Feeds with no licence are not included. */
export const BIKE_SYSTEMS: BikeSystem[] = [
  LYFT('nyc-citibike', 'Citi Bike', 'New York, NY', 40.7484, -73.9967, 'bkn', 'https://citibikenyc.com/data-sharing-policy'),
  LYFT('chicago-divvy', 'Divvy', 'Chicago, IL', 41.8781, -87.6298, 'chi', 'https://divvybikes.com/data-license-agreement'),
  LYFT('dc-cabi', 'Capital Bikeshare', 'Washington, DC', 38.9072, -77.0369, 'dca-cabi', 'https://capitalbikeshare.com/data-license-agreement'),
  LYFT('sf-baywheels', 'Bay Wheels', 'San Francisco Bay Area, CA', 37.7749, -122.4194, 'bay', 'https://www.lyft.com/bikes/bay-wheels/data-license-agreement'),
  {
    id: 'boston-bluebikes', name: 'Bluebikes', city: 'Boston, MA', lat: 42.3601, lon: -71.0589, radiusKm: 50,
    infoUrl: 'https://gbfs.bluebikes.com/gbfs/en/station_information.json', statusUrl: 'https://gbfs.bluebikes.com/gbfs/en/station_status.json',
    license: 'Bluebikes Data License Agreement (Lyft)', licenseUrl: 'https://bluebikes.com/data-license-agreement', attribution: 'Bluebikes (Lyft)',
  },
  URBAN('oslo-bysykkel', 'Oslo Bysykkel', 'Oslo, Norway', 59.9139, 10.7522, 'oslobysykkel.no', 'https://oslobysykkel.no/en/open-data/realtime'),
  URBAN('bergen-bysykkel', 'Bergen Bysykkel', 'Bergen, Norway', 60.3913, 5.3221, 'bergenbysykkel.no', 'https://bergenbysykkel.no/en/apne-data/sanntid'),
  URBAN('trondheim-bysykkel', 'Trondheim Bysykkel', 'Trondheim, Norway', 63.4305, 10.3951, 'trondheimbysykkel.no', 'https://trondheimbysykkel.no/en/open-data/realtime'),
  {
    id: 'barcelona-ambici', name: 'AMBici', city: 'Barcelona metropolitan area, Spain', lat: 41.37, lon: 2.07, radiusKm: 40,
    infoUrl: 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bs/en/station_information.json',
    statusUrl: 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bs/en/station_status.json',
    license: 'CC0 1.0 (stated in the feed)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: 'AMBici, Àrea Metropolitana de Barcelona, operated by nextbike',
  },
];

/** Systems to load for a view: centre within reach of the system, and zoomed in enough to see stations. */
export function bikeSystemsForView(lat: number, lon: number, heightM: number): BikeSystem[] {
  if (heightM > 400_000) return [];
  return BIKE_SYSTEMS.filter((s) => distKm(lat, lon, s.lat, s.lon) <= s.radiusKm + heightM / 1000);
}

export function normalizeGbfs(info: unknown, status: unknown, system: BikeSystem, nowMs: number): Normalized {
  const stations = obj(obj(info)?.data)?.stations;
  const statuses = obj(obj(status)?.data)?.stations;
  if (!Array.isArray(stations) || !Array.isArray(statuses)) throw new Error(`${system.name}: GBFS reply has no station list`);
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of statuses) { const o = obj(s); const id = cleanText(o?.station_id, 80); if (o && id) byId.set(id, o); }
  const updatedSec = num(obj(status)?.last_updated);
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of stations.slice(0, 5000)) {
    const s = obj(raw);
    const id = cleanText(s?.station_id, 80);
    if (!s || !id || !isValidLat(s.lat) || !isValidLon(s.lon)) { skipped++; continue; }
    const st = byId.get(id);
    const bikes = num(st?.num_bikes_available);
    const docks = num(st?.num_docks_available);
    const reportedSec = num(st?.last_reported);
    // A station without a status record is shown with unknown counts, never as empty.
    const installed = st ? st.is_installed !== false && st.is_installed !== 0 : null;
    const renting = st ? st.is_renting !== false && st.is_renting !== 0 : null;
    records.push({
      id: `${system.id}:${id}`.slice(0, 100),
      lat: s.lat,
      lon: s.lon,
      altM: null, heading: null, speedKts: null,
      label: cleanText(s.name, 120) ?? id,
      category: !st ? 'unknown' : installed === false || renting === false ? 'closed' : bikes === null ? 'unknown' : bikes === 0 ? 'empty' : 'available',
      observedAt: reportedSec && reportedSec * 1000 <= nowMs + 60_000 ? new Date(reportedSec * 1000).toISOString() : updatedSec ? new Date(updatedSec * 1000).toISOString() : null,
      sourceUrl: system.licenseUrl,
      source: system.attribution,
      props: { system: system.name, bikesAvailable: bikes, docksAvailable: docks, capacity: num(s.capacity), renting, installed },
    });
  }
  return { records, skipped, sourceUpdatedAt: updatedSec ? new Date(updatedSec * 1000).toISOString() : null };
}

// ---------------------------------------------------------------- wildlife (iNaturalist)

/** Wildlife groups only (plants and fungi are left to dedicated tools). */
export const WILDLIFE_TAXA = ['Aves', 'Mammalia', 'Reptilia', 'Amphibia', 'Actinopterygii', 'Mollusca', 'Arachnida', 'Insecta'];
export const WILDLIFE_DAYS = 7;
/** Only openly licensed observations, so the layer stays usable in a commercial product (most iNaturalist records are CC BY-NC). */
export const WILDLIFE_LICENSES = ['cc0', 'cc-by', 'cc-by-sa'];

export function wildlifeUrl(bbox: [number, number, number, number], now: Date): string {
  const [w, s, e, n] = bbox.map((x) => Math.round(x * 1e4) / 1e4);
  const d1 = new Date(now.getTime() - WILDLIFE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const fields = 'id,location,obscured,geoprivacy,taxon_geoprivacy,time_observed_at,observed_on,quality_grade,license_code,uri,positional_accuracy,taxon.name,taxon.preferred_common_name,taxon.iconic_taxon_name,user.login';
  return `https://api.inaturalist.org/v2/observations?nelat=${n}&nelng=${e}&swlat=${s}&swlng=${w}&d1=${d1}&verifiable=true&license=${WILDLIFE_LICENSES.join(',')}&iconic_taxa=${WILDLIFE_TAXA.join(',')}&per_page=200&order_by=observed_on&order=desc&fields=${fields}`;
}

export function normalizeInaturalist(body: unknown): Normalized & { total: number | null } {
  const results = obj(body)?.results;
  if (!Array.isArray(results)) throw new Error('iNaturalist reply has no results');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of results) {
    const o = obj(raw);
    const loc = typeof o?.location === 'string' ? o.location.split(',').map(Number) : [];
    const id = num(o?.id);
    const license = cleanText(o?.license_code, 20);
    // The query asks for open licences; anything else that slips through is dropped, not shown.
    if (!o || id === null || loc.length !== 2 || !isValidLat(loc[0]) || !isValidLon(loc[1]) || !license || !WILDLIFE_LICENSES.includes(license)) { skipped++; continue; }
    const taxon = obj(o.taxon);
    const obscured = o.obscured === true || (typeof o.geoprivacy === 'string' && o.geoprivacy !== 'open') || (typeof o.taxon_geoprivacy === 'string' && o.taxon_geoprivacy !== 'open');
    const common = cleanText(taxon?.preferred_common_name, 120);
    const sci = cleanText(taxon?.name, 120);
    records.push({
      id: `inat-${id}`,
      lat: loc[0],
      lon: loc[1],
      altM: null, heading: null, speedKts: null,
      label: common ?? sci ?? 'Unidentified',
      category: cleanText(taxon?.iconic_taxon_name, 40),
      observedAt: toIso(o.time_observed_at) ?? toIso(o.observed_on),
      sourceUrl: typeof o.uri === 'string' && /^https:\/\/www\.inaturalist\.org\/observations\/\d+$/.test(o.uri) ? o.uri : `https://www.inaturalist.org/observations/${id}`,
      source: 'iNaturalist',
      props: {
        scientificName: sci, observer: cleanText(obj(o.user)?.login, 60), qualityGrade: cleanText(o.quality_grade, 20), license: license.toUpperCase(),
        // Obscured locations are placed somewhere in a 0.2° cell by iNaturalist; the true spot is withheld.
        locationObscured: obscured, positionalAccuracyM: num(o.positional_accuracy), observedDateOnly: !o.time_observed_at,
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: null, total: num(obj(body)?.total_results) };
}

// ---------------------------------------------------------------- air quality (ECCC AQHI, Canada)

export const AQHI_URL = 'https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&latest=true&limit=1000';

/** AQHI health-risk bands: 1–3 low, 4–6 moderate, 7–10 high, above 10 very high. */
export function aqhiBand(v: number): 'low' | 'moderate' | 'high' | 'very-high' {
  const r = Math.round(v);
  return r <= 3 ? 'low' : r <= 6 ? 'moderate' : r <= 10 ? 'high' : 'very-high';
}

export function normalizeAqhi(body: unknown): Normalized {
  const features = obj(body)?.features;
  if (!Array.isArray(features)) throw new Error('AQHI reply has no features');
  const records: GeoRecord[] = [];
  let skipped = 0;
  let newest: string | null = null;
  for (const raw of features.slice(0, 2000)) {
    const f = obj(raw);
    const p = obj(f?.properties);
    const c = obj(f?.geometry)?.coordinates;
    const value = num(p?.aqhi);
    const id = cleanText(p?.location_id, 20);
    if (!p || !id || !Array.isArray(c) || !isValidLon(c[0]) || !isValidLat(c[1]) || value === null || value < 0 || value > 100) { skipped++; continue; }
    const at = toIso(p.observation_datetime);
    if (at && (!newest || at > newest)) newest = at;
    const shown = Math.round(value) > 10 ? '10+' : String(Math.max(1, Math.round(value)));
    records.push({
      id: `aqhi-${id}`,
      lat: c[1] as number,
      lon: c[0] as number,
      altM: null, heading: null, speedKts: null,
      label: `${cleanText(p.location_name_en, 80) ?? id} · AQHI ${shown}`,
      category: aqhiBand(value),
      observedAt: at,
      sourceUrl: 'https://weather.gc.ca/airquality/pages/index_e.html',
      source: 'Environment and Climate Change Canada',
      props: { aqhi: Math.round(value * 100) / 100, aqhiShown: shown, band: aqhiBand(value), station: cleanText(p.location_name_en, 80), notes: cleanText(p.special_notes_en, 300) },
    });
  }
  return { records, skipped, sourceUpdatedAt: newest };
}

// ---------------------------------------------------------------- news-reported violence (GDELT 2.0 events)

/** CAMEO root codes for physical violence: 18 assault, 19 fight, 20 unconventional mass violence. */
export const CONFLICT_ROOTS: Record<string, string> = { '18': 'Assault', '19': 'Fighting', '20': 'Mass violence' };
export const CONFLICT_WINDOW_MS = 24 * 3_600_000;

/** Names of the 15-minute export files, newest first, starting `lagSlots` slots before the current one. */
export function gdeltExportUrls(nowMs: number, count: number, lagSlots = 1): string[] {
  const slot = 15 * 60_000;
  const start = Math.floor(nowMs / slot) * slot - lagSlots * slot;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start - i * slot).toISOString();
    return `https://data.gdeltproject.org/gdeltv2/${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${d.slice(11, 13)}${d.slice(14, 16)}00.export.CSV.zip`;
  });
}

export interface ConflictEvent {
  id: string;
  lat: number;
  lon: number;
  place: string;
  /** 1 country, 2 US state, 3 US city, 4 world city, 5 world state (GDELT ActionGeo_Type). */
  geoType: number;
  root: string;
  code: string;
  addedAt: string;
  url: string;
  mentions: number;
}

/** Parses one events export (tab-separated, 61 columns), keeping physical violence with a mapped place. */
export function parseGdeltEvents(csv: string): { events: ConflictEvent[]; skipped: number } {
  const events: ConflictEvent[] = [];
  let skipped = 0;
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c.length < 61) { skipped++; continue; }
    const root = c[28];
    if (!CONFLICT_ROOTS[root]) continue;
    const lat = Number(c[56]);
    const lon = Number(c[57]);
    const geoType = Number(c[51]);
    const added = /^\d{14}$/.test(c[59]) ? `${c[59].slice(0, 4)}-${c[59].slice(4, 6)}-${c[59].slice(6, 8)}T${c[59].slice(8, 10)}:${c[59].slice(10, 12)}:${c[59].slice(12, 14)}Z` : null;
    const url = c[60].trim();
    if (!c[56] || !c[57] || !isValidLat(lat) || !isValidLon(lon) || !added || !/^https?:\/\/[^\s]{4,2000}$/.test(url)) { skipped++; continue; }
    events.push({ id: c[0].slice(0, 20), lat, lon, place: (cleanText(c[52], 160) ?? '').trim(), geoType, root, code: c[26].slice(0, 4), addedAt: added, url, mentions: Number(c[31]) || 0 });
  }
  return { events, skipped };
}

/**
 * One record per news story (GDELT codes several events from one article): the most specific place wins (a city over a
 * state over a country), then the most mentioned.
 */
export function conflictRecords(events: ConflictEvent[]): GeoRecord[] {
  const specificity = (t: number) => (t === 3 || t === 4 ? 2 : t === 2 || t === 5 ? 1 : 0);
  const best = new Map<string, ConflictEvent>();
  for (const e of events) {
    const prev = best.get(e.url);
    if (!prev || specificity(e.geoType) > specificity(prev.geoType) || (specificity(e.geoType) === specificity(prev.geoType) && e.mentions > prev.mentions)) best.set(e.url, e);
  }
  return [...best.values()].map((e) => {
    let host = '';
    try { host = new URL(e.url).hostname.replace(/^www\./, ''); } catch { /* checked by the parser */ }
    return {
      id: `gdelt-${e.id}`,
      lat: e.lat,
      lon: e.lon,
      altM: null, heading: null, speedKts: null,
      label: `${CONFLICT_ROOTS[e.root]} · ${e.place || 'unnamed place'}`,
      category: e.root,
      observedAt: e.addedAt,
      sourceUrl: e.url,
      source: `GDELT 2.0 (machine-coded from ${host || 'a news report'})`,
      props: {
        cameoCode: e.code, place: e.place || null, newsSource: host || null, mentions: e.mentions,
        placement: specificity(e.geoType) === 2 ? 'city' : specificity(e.geoType) === 1 ? 'state or province (centre)' : 'country (centre)',
      },
    };
  });
}
