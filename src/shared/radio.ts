// Worldwide internet radio from the Radio Browser community directory (radio-browser.info; directory data is public
// domain). Stations stream from their own servers; the app plays them through its audio relay, looked up only by a
// station id the directory returned. Scanner and ATC entries are third-party relays listed by volunteers.

import { isValidLat, isValidLon } from './geo';
import { cleanText } from './normalize';

export const RADIO_API = 'https://de1.api.radio-browser.info';
export const RADIO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const RADIO_KINDS = ['all', 'news', 'music', 'scanner', 'atc'] as const;
export type RadioKind = (typeof RADIO_KINDS)[number];
export type StationKind = 'broadcast' | 'scanner' | 'atc';

export interface RadioQuery {
  query: string;
  kind: RadioKind;
  country: string | null;
  near: { lat: number; lon: number } | null;
}

export interface RadioStation {
  id: string;
  name: string;
  kind: StationKind;
  country: string | null;
  countryCode: string | null;
  tags: string[];
  codec: string | null;
  bitrate: number | null;
  lat: number | null;
  lon: number | null;
  homepage: string | null;
  /** Kilometres from the map centre when searched near it. */
  distanceKm: number | null;
}

const SCANNER_TAGS = new Set(['scanner', 'police scanner', 'fire scanner', 'police radio', 'emergency services', 'public safety', 'ems', 'dispatch', 'fire rescue']);
const ATC_TAGS = new Set(['atc', 'air traffic control', 'aviation', 'airband', 'air traffic', 'liveatc', 'airport']);

export function stationKind(name: string, tags: string[]): StationKind {
  const n = name.toLowerCase();
  if (tags.some((t) => ATC_TAGS.has(t)) || /\b(atc|air traffic|approach|tower|ground) (control|freq|frequency)\b|\batc\b/.test(n)) return 'atc';
  if (tags.some((t) => SCANNER_TAGS.has(t)) || /\b(scanner|dispatch|police radio|fire rescue|sheriff)\b/.test(n)) return 'scanner';
  return 'broadcast';
}

const base = 'hidebroken=true&order=clickcount&reverse=true';

/** Fixed search URLs for one query (several for scanner and ATC, whose tagging is inconsistent). */
export function radioSearchUrls(q: RadioQuery, limit = 60): string[] {
  const p = new URLSearchParams();
  const text = q.query.trim().slice(0, 80);
  if (q.country && /^[A-Z]{2}$/.test(q.country)) p.set('countrycode', q.country);
  if (q.near && isValidLat(q.near.lat) && isValidLon(q.near.lon)) {
    p.set('geo_lat', q.near.lat.toFixed(3));
    p.set('geo_long', q.near.lon.toFixed(3));
    p.set('geo_distance', '250000');
  }
  p.set('limit', String(limit));
  const url = (extra: Record<string, string>) => {
    const u = new URLSearchParams(p);
    for (const [k, v] of Object.entries(extra)) u.set(k, v);
    return `${RADIO_API}/json/stations/search?${u.toString()}&${base}`;
  };
  if (q.kind === 'scanner') return [url({ tag: 'scanner', ...(text ? { name: text } : {}) }), url({ name: text || 'scanner' }), url({ tag: 'police', ...(text ? { name: text } : {}) }), url({ tag: 'dispatch', ...(text ? { name: text } : {}) })];
  if (q.kind === 'atc') return [url({ tag: 'atc', tagExact: 'true', ...(text ? { name: text } : {}) }), url({ tag: 'aviation', ...(text ? { name: text } : {}) }), url({ name: text ? `${text} atc` : 'atc' }), url({ tag: 'air traffic control' })];
  const tag: Record<string, string> = q.kind === 'news' ? { tag: 'news' } : q.kind === 'music' ? { tag: 'music' } : {};
  return [url({ ...tag, ...(text ? { name: text } : {}) })];
}

/** Directory rows → stations. Video, HLS and non-HTTP streams are skipped; so is anything malformed. */
export function normalizeStations(body: unknown): { stations: RadioStation[]; streams: Map<string, string>; skipped: number } {
  const stations: RadioStation[] = [];
  const streams = new Map<string, string>();
  let skipped = 0;
  for (const row of Array.isArray(body) ? body.slice(0, 500) : []) {
    const r = row as Record<string, unknown>;
    const id = typeof r.stationuuid === 'string' ? r.stationuuid : '';
    const stream = typeof r.url_resolved === 'string' ? r.url_resolved : '';
    const name = cleanText(r.name, 120);
    let protocolOk = false;
    try { const u = new URL(stream); protocolOk = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password; } catch { /* skipped below */ }
    const codec = cleanText(r.codec, 20);
    if (!RADIO_UUID.test(id) || !name || !protocolOk || stream.length > 500 || r.hls === 1 || /\b(720p|1080p|video|tv)\b/i.test(name) || (codec && /^(h264|h265|vp8|vp9|unknown,h264)/i.test(codec))) { skipped++; continue; }
    const tags = String(r.tags ?? '').toLowerCase().split(',').map((t) => t.trim()).filter((t) => t && t.length <= 40).slice(0, 12);
    const lat = typeof r.geo_lat === 'number' && isValidLat(r.geo_lat) ? r.geo_lat : null;
    const lon = typeof r.geo_long === 'number' && isValidLon(r.geo_long) ? r.geo_long : null;
    const homepage = typeof r.homepage === 'string' && /^https?:\/\//.test(r.homepage) && r.homepage.length <= 300 ? r.homepage : null;
    const dist = typeof r.geo_distance === 'number' && Number.isFinite(r.geo_distance) ? Math.round(r.geo_distance / 100) / 10 : null;
    const bitrate = typeof r.bitrate === 'number' && r.bitrate > 0 && r.bitrate < 2000 ? r.bitrate : null;
    streams.set(id, stream);
    stations.push({ id, name, kind: stationKind(name, tags), country: cleanText(r.country, 60), countryCode: typeof r.countrycode === 'string' && /^[A-Z]{2}$/.test(r.countrycode) ? r.countrycode : null, tags, codec, bitrate, lat, lon, homepage, distanceKm: dist });
  }
  return { stations, streams, skipped };
}

/** Merge several replies, keep the requested kind, de-duplicate by id, nearest or most popular first as returned. */
export function mergeStations(lists: RadioStation[][], kind: RadioKind, max = 80): RadioStation[] {
  const seen = new Set<string>();
  const out: RadioStation[] = [];
  for (const s of lists.flat()) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if ((kind === 'scanner' && s.kind !== 'scanner') || (kind === 'atc' && s.kind !== 'atc')) continue;
    out.push(s);
  }
  return out.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || 0).slice(0, max);
}

/** True for addresses a stream must never come from: loopback, private, link-local, CGNAT, multicast and the like. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff') || v6.startsWith('::ffff:') || v6.startsWith('64:ff9b:');
}

/** Response types the relay passes through: audio only (playlists and video are refused). */
export function isAudioType(contentType: string | null): boolean {
  const t = (contentType ?? '').toLowerCase().split(';')[0].trim();
  if (/mpegurl|x-scpls|playlist/.test(t)) return false;
  return t.startsWith('audio/') || t === 'application/ogg' || t === 'application/octet-stream';
}
