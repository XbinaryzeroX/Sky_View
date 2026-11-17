// Outbound HTTP for the main process. Only fixed, allow-listed hosts can be
// reached; there is no general-purpose URL proxy.

import { validateInstance } from '../../shared/lemmy';
import { isDatedFlightUrl } from '../../shared/flightStatus';
import { isMarketFeedUrl } from '../../shared/markets';
import { CFR_TRACKER_URL, RELIEFWEB_SITUATIONS_URL, UN_NEWS_AID_URL } from '../../shared/conflictReports';
import { keyedCameraApiHosts } from '../../shared/keyedCameras';
import { parseRetryAfter } from '../../shared/retryAfter';
import { deadlineAfter, MAX_DATE_MS } from './timing';
import { DWD_CAP_LIMITS } from '../../shared/dwd';
export const DWD_STATUS_URL = 'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/Z_CAP_C_EDZW_LATEST_PVW_STATUS_PREMIUMDWD_COMMUNEUNION_DE.zip';
export const ALLOWED_HOSTS = new Set([
  'api.twelvedata.com',
  'www.alphavantage.co',
  'api.gdeltproject.org',
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
  // Radio Browser community directory (station search; streams themselves go through the radio relay).
  'de1.api.radio-browser.info',
  'celestrak.org',
  // The Space Devs Launch Library 2: launch schedule and results (launches layer, hourly).
  'll.thespacedevs.com',
  // Traffic flow: Madrid's city sensor file.
  'informo.madrid.es',
  // Bike-share station feeds (GBFS): Bluebikes publishes on its own host.
  'gbfs.bluebikes.com',
  // iNaturalist observations API (wildlife layer).
  'api.inaturalist.org',
  // Street-level photo search: KartaView photo API and the Panoramax meta-catalogue.
  'api.kartaview.org',
  'api.panoramax.xyz',
  // Train positions: operator realtime feeds on their own hosts.
  'api-endpoint.mta.info',
  'gtfsrt.api.translink.com.au',
  'gtfsrt.renfe.com',
  'firms.modaps.eosdis.nasa.gov',
  'aviationweather.gov',
  'www.nhc.noaa.gov',
  'cwwp2.dot.ca.gov',
  'api.tfl.gov.uk',
  'static.data.gov.hk',
  'www.drivebc.ca',
  // Iceland road cameras (Vegagerðin, CC BY 4.0): camera list.
  'gagnaveita.vegagerdin.is',
  'ws.mapserver.transports.gouv.qc.ca',
  'api-v3.mbta.com',
  'geocoding.geo.census.gov',
  // OpenStreetMap Overpass API: building details and emergency facilities for protective planning (free, fair use).
  'overpass-api.de',
  'overpass.private.coffee',
  'tile.googleapis.com',
  'tiles.openfreemap.org',
  'ibasemaps-api.arcgis.com',
  'api.mapbox.com',
  'tiles.maps.eox.at',
  // Keyed camera systems (called only with the customer's own key).
  ...keyedCameraApiHosts(),
]);
/** Multi-tenant hosts are allowed only for specific service paths. */
export const ALLOWED_PREFIXES = [
  // Connection tests of customer keys only (one small request each, run when the user presses Test).
  'https://api.tomtom.com/traffic/map/4/tile/flow/',
  'https://api.cesium.com/v1/me',
  // OpenAI with the customer's key: key check and speech-to-text for voice commands.
  'https://api.openai.com/v1/models',
  'https://api.openai.com/v1/audio/transcriptions',
  // Google Geocoding, only with the customer's own key while Google 3D Tiles are enabled.
  'https://maps.googleapis.com/maps/api/geocode/json?',
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/',
  'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/',
  // NOAA GFS on the Open Data registry (shared S3 host): forecast index files and 10 m wind messages by byte range.
  'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.',
  // Traffic flow on shared open-data hosts: the exact datasets.
  'https://data.cityofnewyork.us/resource/i4gi-tjb9.json',
  'https://resource.data.one.gov.hk/td/traffic-detectors/rawSpeedVol-all.xml',
  'https://static.data.gov.hk/td/traffic-data-strategic-major-roads/info/',
  'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/',
  // Camera lists on shared open-data hosts: the exact datasets.
  'https://data.calgary.ca/resource/k7p9-kppz.json',
  'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json',
  // Transit vehicle positions (GTFS-Realtime), one exact feed address per operator (shared/transitFeeds.ts).
  'https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream',
  'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl',
  'https://gtfs.ovapi.nl/nl/vehiclePositions.pb',
  'https://bustime.ttc.ca/gtfsrt/vehicles',
  'https://www.miapp.ca/GTFS_RT/Vehicle/VehiclePositions.pb',
  'https://opendata.hamilton.ca/GTFS-RT/GTFS_VehiclePositions.pb',
  'https://drtonline.durhamregiontransit.com/gtfsrealtime/VehiclePositions',
  'https://glphprdtmgtfs.glphtrpcloud.com/tmgtfsrealtimewebservice/vehicle/vehiclepositions.pb',
  'https://api.cityofkingston.ca/gtfs-realtime/vehicleupdates.pb',
  'https://www.myridebarrie.ca/gtfs/GTFS_VehiclePositions.pb',
  'https://rtu.york.ca/gtfsrealtime/VehiclePositions',
  'https://opendata.burlington.ca/gtfs-rt/GTFS_VehiclePositions.pb',
  'https://dados.mobilidade.rio/gtfs/realtime/onibus/vehicle-positions',
  'https://dados.mobilidade.rio/gtfs/realtime/brt/vehicle-positions',
  'https://www.zditm.szczecin.pl/storage/gtfs/gtfs-rt-vehicles.pb',
  'https://api.golemio.cz/v2/vehiclepositions/gtfsrt/vehicle_positions.pb',
  'https://bdx.mecatran.com/utw/ws/gtfsfeed/vehicles/bordeaux?apiKey=opendata-bordeaux-metropole-flux-gtfs-rt',
  'https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_vehicle',
  'https://www.ztm.poznan.pl/pl/dla-deweloperow/getGtfsRtFile/?file=vehicle_positions.pb',
  'https://ckan2.multimediagdansk.pl/gtfs-rt?feed=vehiclePositions',
  'https://gtfs.edmonton.ca/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb',
  'https://gtfs.halifax.ca/realtime/Vehicle/VehiclePositions.pb',
  'https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb?operatorIds=48',
  'https://gtfsproxy.e-tam.fr/COMMON/VehiclePosition.pb',
  'https://tpl.actv.it/aut/GTFSRT/vehiclePositions',
  'https://tpl.actv.it/nav/GTFSRT/vehiclePositions',
  'https://open-data.rtd-denver.com/files/gtfs-rt/rtd/VehiclePosition.pb',
  'https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb',
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor/',
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kota-bharu/',
  'https://api.mrn.cityway.fr/dataflow/vehicle-tc-tr/download?provider=TCAR&dataFormat=gtfs-rt',
  'https://feed-rdtpm-toulon.ratpdev.com/VehiclePosition/GTFS-RT',
  'https://opendata.transports-lia.fr/gtfs-rt/VehiclePosition.pb',
  'https://data.filbleu.fr/ws-tr/gtfs-rt/opendata/vehicle-positions',
  'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions',
  // GBFS bike-share feeds on shared operator hosts: only the listed systems' paths.
  'https://gbfs.lyft.com/gbfs/2.3/',
  'https://gbfs.urbansharing.com/oslobysykkel.no/',
  'https://gbfs.urbansharing.com/bergenbysykkel.no/',
  'https://gbfs.urbansharing.com/trondheimbysykkel.no/',
  'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_bs/',
  // ECCC GeoMet: the AQHI observation collection only.
  'https://api.weather.gc.ca/collections/aqhi-observations-realtime/',
  // GDELT 2.0 15-minute event exports.
  'https://data.gdeltproject.org/gdeltv2/',
  // Train feeds on shared hosts: the exact feed paths.
  'https://www3.septa.org/gtfsrt/septarail-pa-us/Vehicle/',
  'https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/',
  'https://rata.digitraffic.fi/api/v1/train-locations/',
  'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions?',
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb/',
  'https://gtfs-rt-files.buscatch.jp/toyama/',
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
let lemmyOrigin: string | null = null;
export function setLemmyInstance(raw: string): void { lemmyOrigin = validateInstance(raw); }
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
  /** Binary request body (multipart uploads); used instead of `body` when set. */
  bytes?: Uint8Array<ArrayBuffer>;
  maxBytes?: number;
  sameOrigin?: boolean;
  rejectRedirects?: boolean;
  providerErrors?: boolean;
}

export interface FetchJsonResult {
  status: number;
  body: unknown;
}

export type FetchJson = (url: string, opts?: FetchJsonOptions) => Promise<FetchJsonResult>;

export function assertAllowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (isMarketFeedUrl(url)) return url;
  if (isDatedFlightUrl(url)) return url;
  if (url.href === RELIEFWEB_SITUATIONS_URL || url.href === CFR_TRACKER_URL || url.href === UN_NEWS_AID_URL) return url;
  if (url.href === DWD_STATUS_URL) return url;
  if (url.origin === lemmyOrigin && !url.username && !url.password) return url;
  if (url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password) return url;
  if (url.protocol === 'https:' && ALLOWED_PREFIXES.some((p) => url.href.startsWith(p))) return url;
  if (url.protocol === 'http:' && url.hostname === LOOPBACK_HOST) return url;
  if (localReceiverUrl && url.href === new URL(localReceiverUrl).href) return url;
  throw new FeedHttpError(`Blocked request to non-allow-listed host ${url.hostname}`, null, null, 'blocked');
}

// Shared by every main-process caller, including lookups and provider tests. Per-layer scheduling alone
// cannot prevent another workflow from querying the same origin during a publisher-requested pause.
const originCooldowns = new Map<string, { until: number; status: number }>();
const MAX_ORIGIN_COOLDOWNS = 256;
let overflowCooldownUntil = 0;
function checkOriginCooldown(url: URL): void {
  const now = Date.now();
  for (const [origin, limit] of originCooldowns) if (limit.until <= now) originCooldowns.delete(origin);
  if (overflowCooldownUntil > now) throw new FeedHttpError(`Provider pause capacity reached; requests paused until ${new Date(overflowCooldownUntil).toISOString()}`, 503, Math.ceil((overflowCooldownUntil - now) / 1000), 'http');
  const limit = originCooldowns.get(url.origin);
  if (limit) throw new FeedHttpError(`Provider cooldown until ${new Date(limit.until).toISOString()}`, limit.status, Math.ceil((limit.until - now) / 1000), 'http');
  // Do not evict a still-active publisher pause to make room for another origin.
  if (originCooldowns.size >= MAX_ORIGIN_COOLDOWNS) throw new FeedHttpError('Too many paused providers; try again later', 503, 60, 'http');
}

function rememberOriginCooldown(url: URL, status: number, retryAfter: number | null): void {
  if (retryAfter === null && status !== 429 && status !== 503) return;
  const until = deadlineAfter(Date.now(), computeBackoffMs(1, retryAfter ?? 60));
  // Distinct origins can already be in flight when the last slot fills. Keep one conservative
  // overflow deadline instead of growing without bound or forgetting a still-active publisher pause.
  if (!originCooldowns.has(url.origin) && originCooldowns.size >= MAX_ORIGIN_COOLDOWNS) {
    overflowCooldownUntil = Math.max(overflowCooldownUntil, until);
    return;
  }
  originCooldowns.set(url.origin, { until: Math.max(originCooldowns.get(url.origin)?.until ?? 0, until), status });
}

/** Shared destination checks, request timeout and publisher cooldown for all feed transports. */
async function fetchResponse(rawUrl: string, opts: FetchJsonOptions, conditionalDwd = false): Promise<Response> {
  let url = assertAllowedUrl(rawUrl);
  const timeoutMs = opts.timeoutMs ?? 20000;
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    checkOriginCooldown(url);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.bytes ?? opts.body,
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
    if (conditionalDwd && res.status === 304) return res;
    if (res.status >= 300 && res.status < 400) {
      if (opts.rejectRedirects) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        rememberOriginCooldown(url, res.status, retryAfter);
        await res.body?.cancel().catch(() => {});
        throw new FeedHttpError('The provider redirected the fixed lookup endpoint.', res.status, retryAfter, 'blocked');
      }
      if (conditionalDwd) {
        await res.body?.cancel().catch(() => {});
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        rememberOriginCooldown(url, res.status, retryAfter);
        throw new FeedHttpError('DWD redirected the fixed STATUS archive', res.status, retryAfter, 'blocked');
      }
      const loc = res.headers.get('location');
      if (!loc) throw new FeedHttpError(`Redirect without location (${res.status})`, res.status, null, 'http');
      const next = assertAllowedUrl(new URL(loc, url).toString());
      if (opts.sameOrigin && next.origin !== new URL(rawUrl).origin) throw new FeedHttpError('Cross-origin redirect blocked', res.status, null, 'blocked');
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      if (retryAfter !== null && retryAfter > 0) {
        rememberOriginCooldown(url, res.status, retryAfter);
        await res.body?.cancel().catch(() => {});
        // Redirect pauses are not 304 cache hits: retry the original request after the stated delay.
        throw new FeedHttpError('Publisher delayed the redirected request', res.status, retryAfter, 'http');
      }
      await res.body?.cancel().catch(() => {});
      url = next;
      continue;
    }
    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      rememberOriginCooldown(url, res.status, retryAfter);
      let message = ('HTTP '+res.status+' '+res.statusText).trim();
      if (opts.providerErrors) {
        try { const body = JSON.parse((await res.text()).slice(0, 8192));
          const detail = body.message ?? body['Error Message'] ?? body.Note ?? body.Information;
          if (typeof detail === 'string') message = detail.slice(0, 2000);
        } catch { /* Keep the honest HTTP status when the error body is not JSON. */ }
      }
      else await res.body?.cancel().catch(() => {});
      throw new FeedHttpError(message, res.status, retryAfter, 'http');
    }
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new FeedHttpError('Response too large', res.status, null, 'parse');
    }
    return res;
  }
  throw new FeedHttpError('Too many redirects', null, null, 'http');
}

async function fetchRaw(rawUrl: string, opts: FetchJsonOptions = {}): Promise<{ status: number; text: string }> {
  const res = await fetchResponse(rawUrl, opts);
  if (opts.maxBytes !== undefined && res.body) {
    const bytes = await readLimitedBody(res.body, opts.maxBytes, res.status);
    return { status: res.status, text: new TextDecoder().decode(bytes) };
  }
  const text = await res.text();
  if (text.length > (opts.maxBytes ?? 40 * 1024 * 1024)) throw new FeedHttpError('Response too large', res.status, null, 'parse');
  return { status: res.status, text };
}

export interface DwdArchiveResponse {
  status: 200 | 304;
  bytes: Uint8Array | null;
  etag: string | null;
  lastModified: string | null;
}
export type FetchDwdArchive = (headers: Record<string, string>) => Promise<DwdArchiveResponse>;

/** Reads only the fixed German complete-status product. Bound the streamed bytes before allocating the ZIP. */
export const fetchDwdArchive: FetchDwdArchive = async (headers) => {
  const maxBytes = DWD_CAP_LIMITS.compressedBytes;
  const res = await fetchResponse(DWD_STATUS_URL, { headers, maxBytes }, true);
  const validators = { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  if (res.status === 304) return { status: 304, bytes: null, ...validators };
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new FeedHttpError('DWD did not supply a complete STATUS archive', res.status, null, 'parse');
  }
  return { status: 200, bytes: await readLimitedBody(res.body, maxBytes, res.status), ...validators };
};

async function readLimitedBody(body: ReadableStream<Uint8Array>, maxBytes: number, status: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FeedHttpError('Response exceeds the download limit', status, null, 'parse');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
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

/** Binary download; maxBytes is required so a reply can never grow without bound. Pass a Range header for partial reads. */
export type FetchBytes = (url: string, opts: FetchJsonOptions & { maxBytes: number }) => Promise<{ status: number; bytes: Uint8Array }>;
export const fetchBytes: FetchBytes = async (url, opts) => {
  const res = await fetchResponse(url, opts);
  if (!res.body) return { status: res.status, bytes: new Uint8Array(0) };
  const bytes = await readLimitedBody(res.body, opts.maxBytes, res.status);
  return { status: res.status, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
};

export type FetchText = (url: string, opts?: FetchJsonOptions) => Promise<{ status: number; text: string }>;
export const fetchText: FetchText = (url, opts) => fetchRaw(url, opts);

/** Exponential backoff with jitter. Respects Retry-After when supplied. */
export function computeBackoffMs(consecutiveFailures: number, retryAfterSec: number | null, random = Math.random): number {
  if (retryAfterSec !== null && !Number.isNaN(retryAfterSec) && retryAfterSec >= 0) return Math.min(MAX_DATE_MS, Math.max(retryAfterSec * 1000, 5000));
  const base = 30_000 * 2 ** Math.max(0, consecutiveFailures - 1);
  const capped = Math.min(base, 30 * 60 * 1000);
  const jitter = 1 + (random() * 0.2 - 0.1);
  return Math.round(capped * jitter);
}
