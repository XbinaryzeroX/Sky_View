// Street-level photo points (KartaView, Panoramax) and live train positions (operator GTFS-Realtime feeds and
// Fintraffic's JSON). Fixed request builders and normalizers only; no network here.

import { isValidLat, isValidLon } from './geo';
import type { GtfsFeed } from './gtfsRealtime';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText, toIso } from './normalize';

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const KM_PER_DEG = 111.32;
const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const dLon = ((((bLon - aLon) % 360) + 540) % 360) - 180;
  return Math.hypot((bLat - aLat) * KM_PER_DEG, dLon * KM_PER_DEG * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)));
};

// ---------------------------------------------------------------- street-level photos

/** Photos load only this close in: a city block or two around the view centre. */
export const STREET_PHOTO_MAX_HEIGHT_M = 4000;
/** KartaView accepts at most 500 m. */
export const STREET_PHOTO_RADIUS_M = 500;

export function kartaviewUrl(lat: number, lon: number): string {
  return `https://api.kartaview.org/2.0/photo/?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&radius=${STREET_PHOTO_RADIUS_M}&itemsPerPage=100`;
}

export function panoramaxUrl(lat: number, lon: number): string {
  const dLat = STREET_PHOTO_RADIUS_M / 111_320;
  const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const f = (x: number) => x.toFixed(5);
  return `https://api.panoramax.xyz/api/search?bbox=${f(lon - dLon)},${f(lat - dLat)},${f(lon + dLon)},${f(lat + dLat)}&limit=100`;
}

/** Panoramax instances whose picture files the app may show (the renderer loads images only from these). */
export const PANORAMAX_PICTURE_PREFIXES = [
  'https://panoramax.ign.fr/api/pictures/',
  'https://panoramax.openstreetmap.fr/derivates/',
  // OpenStreetMap France stores most of its pictures in this bucket (seen on 2026-11-14 for 95 of 100 Paris results).
  'https://panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net/derivates/',
];
export const KARTAVIEW_IMAGE_PREFIX = 'https://cdn.kartaview.org/pr:sharp/';

export function normalizeKartaview(body: unknown): Normalized {
  const data = obj(obj(body)?.result)?.data;
  if (!Array.isArray(data)) throw new Error('KartaView reply has no photo list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of data) {
    const p = obj(raw);
    const id = cleanText(p?.id, 20);
    const lat = num(p?.lat);
    const lon = num(p?.lng);
    const img = typeof p?.imageLthUrl === 'string' && p.imageLthUrl.startsWith(KARTAVIEW_IMAGE_PREFIX) && p.imageLthUrl.length < 600 ? p.imageLthUrl : null;
    // Only photos KartaView has processed for privacy (faces and plates blurred) are shown.
    if (!p || !id || !/^\d+$/.test(id) || lat === null || lon === null || !isValidLat(lat) || !isValidLon(lon) || !img || p.autoImgProcessingResult !== 'BLURRED') { skipped++; continue; }
    const heading = num(p.heading);
    const seq = cleanText(p.sequenceId, 20);
    const taken = cleanText(p.shotDate, 30) ?? cleanText(p.dateAdded, 30);
    records.push({
      id: `kv-${id}`,
      lat, lon, altM: null,
      heading: heading !== null && heading >= 0 && heading < 360 ? heading : null,
      speedKts: null,
      label: 'KartaView photo',
      category: 'kartaview',
      observedAt: taken ? toIso(taken.replace(' ', 'T') + 'Z') : null,
      sourceUrl: seq && /^\d+$/.test(seq) ? `https://kartaview.org/details/${seq}/${cleanText(p.sequenceIndex, 10) ?? 0}` : 'https://kartaview.org/',
      source: '© KartaView contributors, CC BY-SA 4.0',
      imageUrl: img,
      props: { provider: 'KartaView', license: 'CC BY-SA 4.0', headingDeg: heading, privacyBlur: 'faces and plates blurred by KartaView' },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

export function normalizePanoramax(body: unknown): Normalized {
  const features = obj(body)?.features;
  if (!Array.isArray(features)) throw new Error('Panoramax reply has no features');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of features) {
    const f = obj(raw);
    const id = cleanText(f?.id, 60);
    const c = obj(f?.geometry)?.coordinates;
    const p = obj(f?.properties);
    const assets = obj(f?.assets);
    const href = (k: string) => { const h = obj(assets?.[k])?.href; return typeof h === 'string' && h.length < 400 && PANORAMAX_PICTURE_PREFIXES.some((x) => h.startsWith(x)) ? h : null; };
    const img = href('sd') ?? href('thumb');
    // Pictures on other federated instances are not shown: the renderer may load images only from listed hosts.
    if (!f || !id || !/^[0-9a-f-]{36}$/.test(id) || !Array.isArray(c) || !isValidLon(c[0]) || !isValidLat(c[1]) || !img) { skipped++; continue; }
    const az = num(p?.['view:azimuth']);
    const license = cleanText(p?.license, 40);
    const producer = Array.isArray(f.providers) ? cleanText(obj(f.providers[0])?.name, 80) : null;
    records.push({
      id: `px-${id}`,
      lat: c[1] as number, lon: c[0] as number, altM: null,
      heading: az !== null && az >= 0 && az < 360 ? az : null,
      speedKts: null,
      label: 'Panoramax photo',
      category: 'panoramax',
      observedAt: toIso(p?.datetime),
      sourceUrl: `https://api.panoramax.xyz/#focus=pic&pic=${id}`,
      source: `Panoramax${producer ? ` · ${producer}` : ''}${license ? ` · ${license}` : ''}`,
      imageUrl: img,
      props: { provider: 'Panoramax', license: license ?? 'not stated', headingDeg: az, author: producer, privacyBlur: 'blurred by the Panoramax instance' },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

// ---------------------------------------------------------------- live trains

export interface RailFeed {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  radiusKm: number;
  format: 'gtfs-rt' | 'digitraffic-json';
  url: string;
  headers?: Record<string, string>;
  mode: 'rail' | 'tram';
  /** Trips matching this are not trains (Entur lists rail-replacement buses in the train operators' feeds). */
  excludeTrip?: RegExp;
  license: string;
  licenseUrl: string;
  attribution: string;
}

/**
 * Rail-only feeds whose published terms allow this use. Feeds with no published licence, and mixed bus/rail feeds that
 * need a timetable to tell trains from buses, are left out. Terms recorded on 2026-11-14 (God's Eye View's registry was
 * the starting point; each licence link is the operator's).
 */
export const RAIL_FEEDS: RailFeed[] = [
  { id: 'mta-metro-north', name: 'Metro-North', region: 'New York', lat: 41.2, lon: -73.6, radiusKm: 180, format: 'gtfs-rt', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr', mode: 'rail', license: 'MTA Data Feed Terms and Conditions', licenseUrl: 'https://www.mta.info/developers/terms-and-conditions', attribution: 'MTA' },
  { id: 'mta-lirr', name: 'Long Island Rail Road', region: 'New York', lat: 40.75, lon: -73.3, radiusKm: 160, format: 'gtfs-rt', url: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/lirr%2Fgtfs-lirr', mode: 'rail', license: 'MTA Data Feed Terms and Conditions', licenseUrl: 'https://www.mta.info/developers/terms-and-conditions', attribution: 'MTA' },
  { id: 'septa-regional-rail', name: 'SEPTA Regional Rail', region: 'Philadelphia', lat: 40.05, lon: -75.25, radiusKm: 110, format: 'gtfs-rt', url: 'https://www3.septa.org/gtfsrt/septarail-pa-us/Vehicle/rtVehiclePosition.pb', mode: 'rail', license: 'SEPTA Trip Planning Data Agreement', licenseUrl: 'https://www3.septa.org/developer/', attribution: 'SEPTA' },
  { id: 'marc', name: 'MARC', region: 'Baltimore–Washington', lat: 39.1, lon: -77, radiusKm: 140, format: 'gtfs-rt', url: 'https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-vp.pb', mode: 'rail', license: 'MDOT MTA developer feeds', licenseUrl: 'https://www.mta.maryland.gov/developer-resources', attribution: 'Maryland Transit Administration' },
  { id: 'translink-seq-rail', name: 'Queensland Rail (SEQ)', region: 'South East Queensland', lat: -27.47, lon: 153.02, radiusKm: 160, format: 'gtfs-rt', url: 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions/Rail', mode: 'rail', license: 'CC BY 4.0', licenseUrl: 'https://translink.com.au/about-translink/open-data', attribution: 'Translink / Queensland Government' },
  { id: 'translink-seq-tram', name: 'G:link (Gold Coast)', region: 'Gold Coast', lat: -27.98, lon: 153.4, radiusKm: 50, format: 'gtfs-rt', url: 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/VehiclePositions/Tram', mode: 'tram', license: 'CC BY 4.0', licenseUrl: 'https://translink.com.au/about-translink/open-data', attribution: 'Translink / Queensland Government' },
  { id: 'fintraffic-vr', name: 'Finnish trains', region: 'Finland', lat: 63.5, lon: 25.5, radiusKm: 600, format: 'digitraffic-json', url: 'https://rata.digitraffic.fi/api/v1/train-locations/latest/', headers: { 'Digitraffic-User': 'AtlasWatch/rail' }, mode: 'rail', license: 'CC BY 4.0', licenseUrl: 'https://www.digitraffic.fi/en/terms-of-service/', attribution: 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY' },
  { id: 'renfe-larga-distancia', name: 'Renfe long and medium distance', region: 'Spain', lat: 40.2, lon: -3.7, radiusKm: 700, format: 'gtfs-rt', url: 'https://gtfsrt.renfe.com/vehicle_positions_LD.pb', mode: 'rail', license: 'CC BY 4.0', licenseUrl: 'https://data.renfe.com/', attribution: 'Renfe' },
  { id: 'renfe-cercanias', name: 'Renfe Cercanías', region: 'Spain', lat: 40.2, lon: -3.7, radiusKm: 700, format: 'gtfs-rt', url: 'https://gtfsrt.renfe.com/vehicle_positions.pb', mode: 'rail', license: 'CC BY 4.0', licenseUrl: 'https://data.renfe.com/', attribution: 'Renfe' },
  ...(['VYG', 'GOA', 'FLT'] as const).map((code): RailFeed => ({
    id: `entur-${code.toLowerCase()}`, name: code === 'VYG' ? 'Vy' : code === 'GOA' ? 'Go-Ahead Nordic' : 'Flytoget', region: 'Norway',
    lat: code === 'GOA' ? 58.8 : code === 'FLT' ? 59.9 : 61, lon: code === 'GOA' ? 7.5 : code === 'FLT' ? 10.9 : 9.5, radiusKm: code === 'FLT' ? 80 : code === 'GOA' ? 280 : 450,
    format: 'gtfs-rt', url: `https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions?datasource=${code}`, headers: { 'ET-Client-Name': 'atlaswatch-rail' }, mode: 'rail',
    // 11 of 70 Vy vehicles on 2026-11-14 were replacement buses with trip ids like VYG:ServiceJourney:BUS-823_….
    excludeTrip: /:ServiceJourney:BUS-/,
    license: 'NLOD 2.0', licenseUrl: 'https://data.norge.no/nlod/en/2.0', attribution: 'Inneholder data under Norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Entur AS',
  })),
  { id: 'ktmb', name: 'KTMB', region: 'Malaysia', lat: 4, lon: 101.8, radiusKm: 450, format: 'gtfs-rt', url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb/', mode: 'rail', license: 'CC BY 4.0', licenseUrl: 'https://developer.data.gov.my/realtime-api/gtfs-realtime', attribution: 'KTMB, via data.gov.my (Government of Malaysia)' },
  { id: 'jp-manyosen', name: 'Manyōsen', region: 'Toyama, Japan', lat: 36.77, lon: 137.06, radiusKm: 25, format: 'gtfs-rt', url: 'https://gtfs-rt-files.buscatch.jp/toyama/manyo_line/VehiclePositions.pb', mode: 'tram', license: 'CC0 1.0', licenseUrl: 'https://api.gtfs-data.jp/v2/organizations/manyosen/feeds/manyosen', attribution: 'Manyōsen Co., via the GTFS Data Repository (gtfs-data.jp)' },
  { id: 'jp-toyama-tram', name: 'Toyama city tram', region: 'Toyama, Japan', lat: 36.72, lon: 137.21, radiusKm: 25, format: 'gtfs-rt', url: 'https://gtfs-rt-files.buscatch.jp/toyama/chitetsu_tram/VehiclePositions.pb', mode: 'tram', license: 'CC0 1.0', licenseUrl: 'https://api.gtfs-data.jp/v2/organizations/chitetsu/feeds/chitetsushinaidensha', attribution: 'Toyama Chihō Railway, via the GTFS Data Repository (gtfs-data.jp)' },
];

/** Feeds whose area meets the view (centre distance less than the feed reach plus a view-sized margin). */
export function railFeedsForView(lat: number, lon: number, heightM: number): RailFeed[] {
  if (heightM > 6_000_000) return [];
  const margin = Math.min(2500, heightM / 1000);
  return RAIL_FEEDS.filter((f) => distKm(lat, lon, f.lat, f.lon) <= f.radiusKm + margin);
}

/** Positions older than this are not shown as current trains (some feeds freeze while still answering). */
export const RAIL_MAX_AGE_S = 15 * 60;

export function normalizeRailGtfs(feed: RailFeed, gtfs: GtfsFeed, nowMs: number): Normalized & { stale: number } {
  const records: GeoRecord[] = [];
  let stale = 0;
  for (const v of gtfs.vehicles) {
    if (feed.excludeTrip && v.tripId && feed.excludeTrip.test(v.tripId)) continue;
    // Feeds without per-train times are dated by the feed header: the age of the snapshot, not of the fix.
    const t = v.timestamp ?? gtfs.headerTimestamp;
    if (t !== null && nowMs / 1000 - t > RAIL_MAX_AGE_S) { stale++; continue; }
    const key = (v.vehicleId ?? v.tripId ?? v.entityId).slice(0, 60);
    records.push({
      id: `${feed.id}:${key}`.slice(0, 100),
      lat: v.lat, lon: v.lon, altM: null,
      heading: v.bearing,
      speedKts: v.speedMps === null ? null : Math.round(v.speedMps * 1.943844 * 10) / 10,
      label: v.label ? `${feed.name} ${v.label}` : v.routeId ? `${feed.name} · ${v.routeId}` : feed.name,
      category: feed.mode,
      observedAt: t ? new Date(t * 1000).toISOString() : null,
      sourceUrl: feed.licenseUrl,
      source: feed.attribution,
      props: { operator: feed.name, serviceArea: feed.region, route: v.routeId, trip: v.tripId, status: v.status, nextStopId: v.stopId, timeFrom: v.timestamp !== null ? 'train report' : t !== null ? 'feed snapshot' : 'not given', license: feed.license },
    });
  }
  return { records, skipped: gtfs.skipped, sourceUpdatedAt: gtfs.headerTimestamp ? new Date(gtfs.headerTimestamp * 1000).toISOString() : null, stale };
}

/** Fintraffic train-locations/latest: [{trainNumber, departureDate, timestamp, location: {coordinates: [lon, lat]}, speed (km/h)}]. */
export function normalizeDigitrafficTrains(feed: RailFeed, body: unknown, nowMs: number): Normalized & { stale: number } {
  if (!Array.isArray(body)) throw new Error('Fintraffic reply is not a list of trains');
  const records: GeoRecord[] = [];
  let skipped = 0;
  let stale = 0;
  for (const raw of body.slice(0, 5000)) {
    const t = obj(raw);
    const c = obj(t?.location)?.coordinates;
    const n = num(t?.trainNumber);
    const at = toIso(t?.timestamp);
    if (!t || n === null || !Array.isArray(c) || !isValidLon(c[0]) || !isValidLat(c[1]) || !at) { skipped++; continue; }
    if (nowMs - Date.parse(at) > RAIL_MAX_AGE_S * 1000) { stale++; continue; }
    const kmh = num(t.speed);
    records.push({
      id: `${feed.id}:${cleanText(t.departureDate, 12) ?? ''}:${n}`,
      lat: c[1] as number, lon: c[0] as number, altM: null, heading: null,
      speedKts: kmh === null || kmh < 0 ? null : Math.round((kmh / 1.852) * 10) / 10,
      label: `Train ${n}`,
      category: 'rail',
      observedAt: at,
      sourceUrl: feed.licenseUrl,
      source: feed.attribution,
      props: { operator: 'VR (Finland)', serviceArea: feed.region, trainNumber: n, gpsFix: t.isGpsLocation === true, timeFrom: 'train report', license: feed.license },
    });
  }
  return { records, skipped, sourceUpdatedAt: null, stale };
}
