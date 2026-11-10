// Outbound HTTP for the main process. Only fixed, allow-listed hosts can be
// reached; there is no general-purpose URL proxy.

export const ALLOWED_HOSTS = new Set([
  'api.weather.gov',
  'earthquake.usgs.gov',
  'api.adsb.lol',
  'meri.digitraffic.fi',
  'tie.digitraffic.fi',
  'webcams.nyctmc.org',
  'www.gdacs.org',
  'api.adsbdb.com',
  'commons.wikimedia.org',
  'airport-data.com',
  'opensky-network.org',
  'auth.opensky-network.org',
  'eonet.gsfc.nasa.gov',
  'celestrak.org',
  'firms.modaps.eosdis.nasa.gov',
  'aviationweather.gov',
  'www.nhc.noaa.gov',
  'cwwp2.dot.ca.gov',
  'api-v3.mbta.com',
  'geocoding.geo.census.gov',
  'tile.googleapis.com',
  'tiles.openfreemap.org',
  'ibasemaps-api.arcgis.com',
  'api.mapbox.com',
  'tiles.maps.eox.at',
]);
/** Multi-tenant hosts are allowed only for specific service paths. */
export const ALLOWED_PREFIXES = [
  // Google Geocoding, only with the customer's own key while Google 3D Tiles are enabled.
  'https://maps.googleapis.com/maps/api/geocode/json?',
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/',
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/',
];

const PRIVATE_V4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
/** A user-configured local ADS-B receiver: http(s) to a literal private IPv4 address, aircraft.json path only. */
export function isAllowedLocalReceiverUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && PRIVATE_V4.test(u.hostname) && !u.username && !u.password && /\/aircraft\.json$/.test(u.pathname);
}
let localReceiverUrl: string | null = null;
export function setLocalReceiverUrl(u: string | null): void {
  localReceiverUrl = u && isAllowedLocalReceiverUrl(u) ? u : null;
}
/** Ollama is only ever contacted on the IPv4 loopback address. */
export const LOOPBACK_HOST = '127.0.0.1';

export class FeedHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryAfterSec: number | null,
    public readonly kind: 'network' | 'timeout' | 'http' | 'parse' | 'blocked',
  ) {
    super(message);
    this.name = 'FeedHttpError';
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: 'GET' | 'POST';
  body?: string;
  maxBytes?: number;
}

export interface FetchJsonResult {
  status: number;
  body: unknown;
}

export type FetchJson = (url: string, opts?: FetchJsonOptions) => Promise<FetchJsonResult>;

export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password) return url;
  if (url.protocol === 'https:' && ALLOWED_PREFIXES.some((p) => url.href.startsWith(p))) return url;
  if (url.protocol === 'http:' && url.hostname === LOOPBACK_HOST) return url;
  if (localReceiverUrl && url.href === new URL(localReceiverUrl).href) return url;
  throw new FeedHttpError(`Blocked request to non-allow-listed host ${url.hostname}`, null, null, 'blocked');
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 3600);
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return Math.max(0, Math.min(3600, Math.round((d - Date.now()) / 1000)));
  return null;
}

/** Fetches JSON from an allow-listed URL with a timeout, manual redirect checks, and a size cap. */
async function fetchRaw(rawUrl: string, opts: FetchJsonOptions = {}): Promise<{ status: number; text: string }> {
  let url = assertAllowedUrl(rawUrl);
  const timeoutMs = opts.timeoutMs ?? 20000;
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal,
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new FeedHttpError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, null, null, 'timeout');
      }
      throw new FeedHttpError(`Network error: ${err.message}`, null, null, 'network');
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FeedHttpError(`Redirect without location (${res.status})`, res.status, null, 'http');
      url = assertAllowedUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      throw new FeedHttpError(`HTTP ${res.status} ${res.statusText}`.trim(), res.status, retryAfter, 'http');
    }
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > maxBytes) throw new FeedHttpError('Response too large', res.status, null, 'parse');
    const text = await res.text();
    if (text.length > maxBytes) throw new FeedHttpError('Response too large', res.status, null, 'parse');
    return { status: res.status, text };
  }
  throw new FeedHttpError('Too many redirects', null, null, 'http');
}

export const fetchJson: FetchJson = async (rawUrl, opts = {}) => {
  const r = await fetchRaw(rawUrl, opts);
  // 204 No Content (or an empty body) means "no records", not a failure.
  if (r.status === 204 || r.text.trim() === '') return { status: r.status, body: null };
  try {
    return { status: r.status, body: JSON.parse(r.text) };
  } catch {
    throw new FeedHttpError('Response was not valid JSON', r.status, null, 'parse');
  }
};

export type FetchText = (url: string, opts?: FetchJsonOptions) => Promise<{ status: number; text: string }>;
export const fetchText: FetchText = (url, opts) => fetchRaw(url, opts);

/** Exponential backoff with jitter. Respects Retry-After when supplied. */
export function computeBackoffMs(consecutiveFailures: number, retryAfterSec: number | null, random = Math.random): number {
  if (retryAfterSec !== null) return Math.max(retryAfterSec * 1000, 5000);
  const base = 30_000 * 2 ** Math.max(0, consecutiveFailures - 1);
  const capped = Math.min(base, 30 * 60 * 1000);
  const jitter = 1 + (random() * 0.2 - 0.1);
  return Math.round(capped * jitter);
}
