// Validation and normalization of remote feed payloads. Remote content is
// untrusted: every field is type-checked, length-limited, and malformed
// records are skipped and counted rather than crashing the app.

import { geometryBbox, isValidLat, isValidLon, sanitizePolygonGeometry } from './geo';
import type { AlertSeverity, Earthquake, LocationZones, WeatherAlert } from './types';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(v: unknown, max = 4000): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL_CHARS, '').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' && v.length < 64) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function stringArray(v: unknown, maxItems = 2000, maxLen = 300): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (out.length >= maxItems) break;
    const s = cleanText(item, maxLen);
    if (s) out.push(s);
  }
  return out;
}

const SEVERITIES: AlertSeverity[] = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'];

function severityOf(v: unknown): AlertSeverity {
  return SEVERITIES.includes(v as AlertSeverity) ? (v as AlertSeverity) : 'Unknown';
}

const ZONE_URL = /^https:\/\/api\.weather\.gov\/zones\/([a-z]+)\/([A-Z]{2}[CZ]\d{3})$/;

/** Converts an NWS zone URL to a normalized key like "forecast/KSZ039". Returns null for unrecognized input. */
export function zoneKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = ZONE_URL.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface NormalizedAlerts {
  alerts: WeatherAlert[];
  skipped: number;
  sourceUpdatedAt: string | null;
}

/** Parses an NWS /alerts/active GeoJSON response. */
export function normalizeNwsAlerts(body: unknown): NormalizedAlerts {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { features?: unknown }).features)) {
    throw new Error('NWS response is not a GeoJSON FeatureCollection');
  }
  const b = body as { features: unknown[]; updated?: unknown };
  const alerts: WeatherAlert[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const f of b.features) {
    const a = normalizeNwsFeature(f);
    if (!a || seen.has(a.id)) {
      skipped++;
      continue;
    }
    seen.add(a.id);
    alerts.push(a);
  }
  return { alerts, skipped, sourceUpdatedAt: toIso(b.updated) };
}

export function normalizeNwsFeature(f: unknown): WeatherAlert | null {
  if (!f || typeof f !== 'object') return null;
  const feat = f as { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> };
  const p = feat.properties;
  if (!p || typeof p !== 'object') return null;
  const id = cleanText(p.id, 300);
  const event = cleanText(p.event, 200);
  if (!id || !event) return null;
  const geometry = feat.geometry == null ? null : sanitizePolygonGeometry(feat.geometry);
  const geocode = (p.geocode && typeof p.geocode === 'object' ? p.geocode : {}) as Record<string, unknown>;
  const references: string[] = [];
  if (Array.isArray(p.references)) {
    for (const r of p.references) {
      const ident = r && typeof r === 'object' ? cleanText((r as Record<string, unknown>).identifier, 300) : null;
      if (ident) references.push(ident);
    }
  }
  const sourceUrl = typeof feat.id === 'string' && feat.id.startsWith('https://api.weather.gov/') ? feat.id : `https://api.weather.gov/alerts/${encodeURIComponent(id)}`;
  return {
    id,
    sourceUrl,
    event,
    headline: cleanText(p.headline, 600),
    description: cleanText(p.description, 12000),
    instruction: cleanText(p.instruction, 6000),
    severity: severityOf(p.severity),
    urgency: cleanText(p.urgency, 40) ?? 'Unknown',
    certainty: cleanText(p.certainty, 40) ?? 'Unknown',
    status: cleanText(p.status, 40) ?? 'Unknown',
    messageType: cleanText(p.messageType, 40) ?? 'Unknown',
    category: cleanText(p.category, 40),
    sent: toIso(p.sent),
    effective: toIso(p.effective),
    onset: toIso(p.onset),
    expires: toIso(p.expires),
    ends: toIso(p.ends),
    senderName: cleanText(p.senderName, 200),
    areaDesc: cleanText(p.areaDesc, 4000),
    affectedZones: stringArray(p.affectedZones).filter((z) => zoneKeyFromUrl(z) !== null),
    ugc: stringArray(geocode.UGC, 2000, 12),
    same: stringArray(geocode.SAME, 2000, 12),
    references,
    geometry,
    bbox: geometry ? geometryBbox(geometry) : null,
  };
}

export interface NormalizedQuakes {
  quakes: Earthquake[];
  skipped: number;
  sourceUpdatedAt: string | null;
}

/** Parses a USGS summary GeoJSON feed. */
export function normalizeUsgsFeed(body: unknown): NormalizedQuakes {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { features?: unknown }).features)) {
    throw new Error('USGS response is not a GeoJSON FeatureCollection');
  }
  const b = body as { features: unknown[]; metadata?: { generated?: unknown } };
  const quakes: Earthquake[] = [];
  let skipped = 0;
  for (const f of b.features) {
    const q = normalizeUsgsFeature(f);
    if (q) quakes.push(q);
    else skipped++;
  }
  return { quakes, skipped, sourceUpdatedAt: toIso(b.metadata?.generated) };
}

export function normalizeUsgsFeature(f: unknown): Earthquake | null {
  if (!f || typeof f !== 'object') return null;
  const feat = f as { id?: unknown; geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
  const id = cleanText(feat.id, 100);
  const p = feat.properties;
  const coords = feat.geometry?.coordinates;
  if (!id || !p || !Array.isArray(coords)) return null;
  const [lon, lat, depth] = coords as unknown[];
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  const time = toIso(p.time);
  if (!time) return null;
  const ids = new Set<string>([id]);
  if (typeof p.ids === 'string') {
    for (const part of p.ids.split(',')) {
      const s = part.trim();
      if (s && s.length <= 100) ids.add(s);
    }
  }
  const mag = typeof p.mag === 'number' && Number.isFinite(p.mag) ? p.mag : null;
  const url = typeof p.url === 'string' && /^https:\/\/earthquake\.usgs\.gov\//.test(p.url) ? p.url : null;
  return {
    id,
    ids: [...ids],
    mag,
    magType: cleanText(p.magType, 20),
    place: cleanText(p.place, 300),
    title: cleanText(p.title, 300),
    time,
    updated: toIso(p.updated) ?? time,
    lat,
    lon,
    depthKm: typeof depth === 'number' && Number.isFinite(depth) ? depth : null,
    url,
    status: cleanText(p.status, 40),
    tsunami: p.tsunami === 1 || p.tsunami === true,
    sig: typeof p.sig === 'number' && Number.isFinite(p.sig) ? p.sig : null,
    alert: cleanText(p.alert, 20),
    eventType: cleanText(p.type, 60),
  };
}

/** Parses an NWS /points response into the zones that apply to that point. */
export function normalizePointZones(body: unknown, now: string): LocationZones {
  const p = body && typeof body === 'object' ? (body as { properties?: Record<string, unknown> }).properties : undefined;
  if (!p) return { status: 'error', zones: [], checkedAt: now, error: 'Unexpected /points response' };
  const zones = [p.forecastZone, p.county, p.fireWeatherZone].map(zoneKeyFromUrl).filter((z): z is string => z !== null);
  if (zones.length === 0) return { status: 'error', zones: [], checkedAt: now, error: 'No zones in /points response' };
  return { status: 'resolved', zones, checkedAt: now, error: null };
}
