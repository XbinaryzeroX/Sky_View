import { normalizeOpenSky, OPENSKY_REFRESH_ANON_S, OPENSKY_REFRESH_AUTH_S } from '../../shared/opensky';
import { mergeIncidents, normalizeEonet, normalizeGdacs } from '../../shared/incidents';
// Per-layer fetch functions. URLs come from fixed templates; the only
// variable inputs are validated numbers (view center/bbox) and enum values.

import { aisDimensions, decodePackedEta, type VesselStatic, normalizeAdsb, normalizeArcgisPolygons, normalizeCaltrans, normalizeDigitrafficAis, normalizeFintrafficCams, normalizeFirmsCsv, normalizeMbta, normalizeMetar, normalizeNhc, normalizeNycCams, normalizeTle, WFIGS_PERIMETER_LIMITS, type Normalized } from '../../shared/layerNormalize';
import { LAYERS, type GeoRecord, type LayerId, type ViewState } from '../../shared/layers';
import { createHash } from 'node:crypto';
import type { Settings } from '../../shared/types';
import { computeBackoffMs, FeedHttpError, type FetchJson, type FetchText } from '../feeds/http';
import { deadlineAfter } from '../feeds/timing';
import type { AtlasStore } from '../store';
import { mainGeoidHeight } from '../geoid';
import { normalizeDriveBc, normalizeHongKongCams, normalizeQuebecCams, normalizeTflJamCams } from '../../shared/cameraSources';
import { KEYED_CAMERA_SYSTEMS, keyedCameraRequest, normalizeKeyedCameras, type KeyedCameraId } from '../../shared/keyedCameras';
import type { DwdSource } from './dwdSource';

export interface FetchContext {
  dwd?: DwdSource;
  view: ViewState | null;
  /** OpenSky API client 'id:secret' (optional; anonymous when absent). */
  openskyClient?: string | null;
  /** Saved keys of keyed camera systems (cameras layer only). */
  cameraKey?: (id: KeyedCameraId) => string | null;
  /** Per-source state kept by the layer manager between refreshes (cameras and aircraft providers). */
  sources?: SourceState;
  /** Current time in ms, read again as a refresh proceeds (requests are sequential and can take minutes). Defaults to Date.now. */
  clock?: () => number;
  settings: Settings;
  fetchJson: FetchJson;
  fetchText: FetchText;
  userAgent: string;
  store: AtlasStore;
  localReceiverUrl: string | null;
  now: Date;
}

export interface FetchResult extends Normalized {
  note: string | null;
  /** Aircraft coverage is incomplete: merge usable fixes with last-known data and keep an error visible. */
  incomplete?: { error: string; retryAt: number | null };
  /** Epoch ms at which part of the result falls due (a rate limit ends, a kept catalog ages out), if before the next poll. */
  refreshAt?: number | null;
  /**
   * Set when nothing usable came back. `records` is then still the reconciled set to publish (possibly empty: expired,
   * rejected or removed catalogs must disappear), and the layer reports this as its error.
   */
  failure?: string | null;
}

/** Source state a layer keeps between refreshes. */
export interface SourceState {
  /** Rate-limit deadline per host, with the number of limits in a row (the wait grows with each). */
  backoff: Map<string, { until: number; strikes: number }>;
  /** Last good catalog per source, reused while it is fresh and shown (with a note) while its source fails. */
  cache: Map<string, { at: number; records: GeoRecord[]; skipped: number }>;
}

const NM = 1852;
const VIEW_LIMIT_AIRCRAFT_M = 3_000_000;
const VIEW_LIMIT_METAR_M = 1_500_000;

/** The opted-in remote source for this view; local receiver polling is independent of either host. */
export function aircraftProviderHost(view: ViewState | null, settings: Pick<Settings, 'worldAircraft'>): 'api.adsb.lol' | 'opensky-network.org' {
  return view && view.heightM > VIEW_LIMIT_AIRCRAFT_M && settings.worldAircraft ? 'opensky-network.org' : 'api.adsb.lol';
}

/** Most adsb.lol area queries per refresh when zoomed out (fair use; each area is also cached for a minute). */
export const AIRCRAFT_MAX_AREAS = 12;
const AREA_CACHE_MS = 60_000;
/** Grid spacing (degrees of latitude) so 250 nm circles overlap and cover the area between them. */
const AREA_STEP_DEG = 5.6;
const EARTH_R = 6_371_000;

/**
 * Query plan for aircraft. Close in (≤ 3,000 km camera height) one circle around the view center. Further
 * out, adsb.lol still only answers 250 nm circles (it has no worldwide query), so the visible part of the
 * globe is covered with a fixed grid of circles, nearest to the view center first, up to AIRCRAFT_MAX_AREAS.
 * `partial` is true when the view needs more circles than that.
 */
export function aircraftQueryPlan(v: ViewState): { centers: { lat: number; lon: number }[]; radiusNm: number; partial: boolean } {
  if (v.heightM <= VIEW_LIMIT_AIRCRAFT_M) return { centers: [{ lat: v.lat, lon: v.lon }], radiusNm: aircraftRadiusNm(v.heightM), partial: false };
  // Angular radius of the visible cap (horizon) from the camera height.
  const horizonDeg = (Math.acos(EARTH_R / (EARTH_R + v.heightM)) * 180) / Math.PI;
  const lat0 = (v.lat * Math.PI) / 180;
  const cands: { lat: number; lon: number; d: number }[] = [];
  for (let lat = -84; lat <= 84; lat += AREA_STEP_DEG) {
    const stepLon = Math.min(120, AREA_STEP_DEG / Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const n = Math.max(1, Math.round(360 / stepLon));
    for (let i = 0; i < n; i++) {
      const lon = -180 + (i + 0.5) * (360 / n);
      const la = (lat * Math.PI) / 180;
      const dl = ((lon - v.lon) * Math.PI) / 180;
      const d = (Math.acos(Math.min(1, Math.sin(lat0) * Math.sin(la) + Math.cos(lat0) * Math.cos(la) * Math.cos(dl))) * 180) / Math.PI;
      if (d <= horizonDeg + 2) cands.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  return { centers: cands.slice(0, AIRCRAFT_MAX_AREAS).map(({ lat, lon }) => ({ lat, lon })), radiusNm: 250, partial: cands.length > AIRCRAFT_MAX_AREAS };
}

const areaCache = new Map<string, { at: number; body: unknown }>();

let openSkyCache: { at: number; authed: boolean; records: GeoRecord[]; skipped: number; time: string | null } | null = null;
let openSkyToken: { token: string; exp: number } | null = null;
/** Worldwide OpenSky snapshot, refetched only after the quota-safe interval. */
async function openSkyWorld(ctx: FetchContext): Promise<{ records: GeoRecord[]; skipped: number; time: string | null; authed: boolean }> {
  const client = ctx.openskyClient?.trim() || null;
  const authed = !!client && client.includes(':');
  const interval = authed ? OPENSKY_REFRESH_AUTH_S : OPENSKY_REFRESH_ANON_S;
  const now = ctx.now.getTime();
  if (openSkyCache && openSkyCache.authed === authed && now - openSkyCache.at < interval * 1000) return openSkyCache;
  const headers: Record<string, string> = { 'User-Agent': ctx.userAgent };
  if (authed) {
    if (!openSkyToken || openSkyToken.exp < now + 60_000) {
      const [id, ...rest] = client!.split(':');
      const res = await ctx.fetchJson('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ctx.userAgent },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(rest.join(':'))}`,
        timeoutMs: 15000,
      });
      const b = res.body as { access_token?: unknown; expires_in?: unknown };
      if (typeof b.access_token !== 'string') throw new Error('OpenSky did not issue a token (check the client id and secret)');
      openSkyToken = { token: b.access_token, exp: now + (Number(b.expires_in) || 1800) * 1000 };
    }
    headers.Authorization = `Bearer ${openSkyToken.token}`;
  }
  const res = await ctx.fetchJson('https://opensky-network.org/api/states/all?extended=1', { headers, timeoutMs: 45000, maxBytes: 30 * 1024 * 1024 });
  const n = normalizeOpenSky(res.body, interval + 180, mainGeoidHeight);
  openSkyCache = { at: now, authed, ...n };
  return openSkyCache;
}

/** Query radius (nautical miles) for an aircraft point query from camera height. */
export function aircraftRadiusNm(heightM: number): number {
  return Math.round(Math.max(25, Math.min(250, (heightM * 0.9) / NM)));
}

const dtHeaders = (ua: string) => ({ 'User-Agent': ua, 'Digitraffic-User': ua, 'Accept-Encoding': 'gzip' });

async function fetchAircraft(ctx: FetchContext): Promise<FetchResult> {
  const out: GeoRecord[] = [];
  let skipped = 0;
  let note: string | null = null;
  let updated: string | null = null;
  const errors: string[] = [];
  const clock = ctx.clock ?? (() => ctx.now.getTime());
  const sources = ctx.sources ?? { backoff: new Map(), cache: new Map() };
  let retryAt: number | null = null;
  const due = (until: number) => { retryAt = Math.max(retryAt ?? 0, until); };
  const blocked = (host: string, label: string): boolean => {
    const limit = sources.backoff.get(host);
    if (!limit || limit.until <= clock()) return false;
    due(limit.until);
    errors.push(`${label}: provider cooldown until ${new Date(limit.until).toISOString()}`);
    return true;
  };
  const failed = (host: string, label: string, error: unknown) => {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof FeedHttpError && (error.status === 429 || error.status === 503 || error.retryAfterSec !== null)) {
      const strikes = (sources.backoff.get(host)?.strikes ?? 0) + 1;
      const wait = Math.max(60_000, computeBackoffMs(strikes, error.retryAfterSec));
      const until = Math.max(sources.backoff.get(host)?.until ?? 0, deadlineAfter(clock(), wait));
      sources.backoff.set(host, { until, strikes });
      due(until);
    }
  };
  const includeUpdated = (time: string | null) => { if (time && (!updated || time < updated)) updated = time; };
  const v = ctx.view;
  if (v && aircraftProviderHost(v, ctx.settings) === 'opensky-network.org') {
    if (!blocked('opensky-network.org', 'OpenSky')) try {
      const w = await openSkyWorld(ctx);
      out.push(...w.records);
      skipped += w.skipped;
      includeUpdated(w.time);
      sources.backoff.delete('opensky-network.org');
      note = `Worldwide snapshot from OpenSky Network: ${w.records.length.toLocaleString()} aircraft, positions from ${w.time ? new Date(w.time).toISOString().slice(11, 16) + ' UTC' : 'the last snapshot'}. Refreshed every ${w.authed ? '90 s (your OpenSky client)' : '15 min (anonymous quota)'}; zoom in below 3,000 km for live adsb.lol positions.`;
    } catch (e) {
      failed('opensky-network.org', 'OpenSky', e);
    }
  } else if (!v) {
    note = 'Waiting for the map view.';
  } else {
    const plan = aircraftQueryPlan(v);
    const multi = plan.centers.length > 1;
    const seenIds = new Map<string, number>();
    let ok = 0;
    // At most three already-started requests settle after a host limit; never start the next batch.
    const limited = blocked('api.adsb.lol', 'adsb.lol');
    for (let i = 0; !limited && i < plan.centers.length; i += 3) {
      await Promise.all(
        plan.centers.slice(i, i + 3).map(async (c) => {
          const url = `https://api.adsb.lol/v2/point/${c.lat.toFixed(4)}/${c.lon.toFixed(4)}/${plan.radiusNm}`;
          try {
            const hit = multi ? areaCache.get(url) : undefined;
            let body: unknown;
            let referenceAt: number;
            if (hit && clock() - hit.at < AREA_CACHE_MS) { body = hit.body; referenceAt = hit.at; }
            else {
              body = (await ctx.fetchJson(url, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 })).body;
              referenceAt = clock();
              if (multi) areaCache.set(url, { at: referenceAt, body });
            }
            const n = normalizeAdsb(body, 'adsb.lol (ODbL)', referenceAt, mainGeoidHeight);
            for (const rec of n.records) {
              if (!seenIds.has(rec.id)) { seenIds.set(rec.id, out.length); out.push(rec); }
              else {
                const previous = seenIds.get(rec.id)!;
                if ((rec.observedAt ?? '') > (out[previous].observedAt ?? '')) out[previous] = rec;
              }
            }
            skipped += n.skipped;
            includeUpdated(n.sourceUpdatedAt);
            ok++;
          } catch (e) {
            failed('api.adsb.lol', 'adsb.lol', e);
          }
        }),
      );
      if ((sources.backoff.get('api.adsb.lol')?.until ?? 0) > clock()) break;
    }
    if ((sources.backoff.get('api.adsb.lol')?.until ?? 0) > clock() && retryAt === null) blocked('api.adsb.lol', 'adsb.lol');
    if (!limited && ok === plan.centers.length) {
      // A military-layer request may have received a newer host limit while this grid was in flight.
      if ((sources.backoff.get('api.adsb.lol')?.until ?? 0) > clock()) blocked('api.adsb.lol', 'adsb.lol');
      else sources.backoff.delete('api.adsb.lol');
    }
    if (areaCache.size > 200) {
      for (const [k, val] of areaCache) if (clock() - val.at > AREA_CACHE_MS) areaCache.delete(k);
      while (areaCache.size > 200) areaCache.delete(areaCache.keys().next().value!);
    }
    note = !multi
      ? `Showing aircraft within ${plan.radiusNm} nm of the view center.`
      : `Showing aircraft in ${ok} areas of 250 nm around the view center${plan.partial ? ' (not the whole visible globe: adsb.lol answers one 250 nm area per request, so the nearest areas are loaded first; zoom in or pan to see others)' : ''}.`;
  }
  if (ctx.localReceiverUrl) {
    const localHost = new URL(ctx.localReceiverUrl).origin;
    if (!blocked(localHost, 'local receiver')) try {
      const res = await ctx.fetchJson(ctx.localReceiverUrl, { timeoutMs: 8000, maxBytes: 20 * 1024 * 1024 });
      const n = normalizeAdsb(res.body, 'Local receiver', clock(), mainGeoidHeight);
      includeUpdated(n.sourceUpdatedAt);
      sources.backoff.delete(localHost);
      const seen = new Map(out.map((r, i) => [r.id, i]));
      for (const rec of n.records) {
        const i = seen.get(rec.id);
        // Prefer the fresher observation of the same ICAO address.
        if (i === undefined) out.push(rec);
        else if ((rec.observedAt ?? '') > (out[i].observedAt ?? '')) out[i] = rec;
      }
      skipped += n.skipped;
    } catch (e) {
      failed(localHost, 'local receiver', e);
    }
  }
  return { records: out, skipped, sourceUpdatedAt: updated, note: errors.length ? `${note ?? ''} Partial: ${errors.join('; ')}`.trim() : note,
    ...(errors.length ? { incomplete: { error: errors.join('; '), retryAt } } : {}) };
}

async function fetchAircraftMil(ctx: FetchContext): Promise<FetchResult> {
  const host = 'api.adsb.lol';
  const now = () => ctx.clock?.() ?? ctx.now.getTime();
  const limit = ctx.sources?.backoff.get(host);
  if (limit && limit.until > now()) return { records: [], skipped: 0, sourceUpdatedAt: null,
    note: 'Keeping last-known military-flagged aircraft during the adsb.lol provider cooldown.',
    incomplete: { error: `adsb.lol: provider cooldown until ${new Date(limit.until).toISOString()}`, retryAt: limit.until } };
  try {
    const res = await ctx.fetchJson('https://api.adsb.lol/v2/mil', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 25000 });
    const currentLimit = ctx.sources?.backoff.get(host);
    const normalized = normalizeAdsb(res.body, 'adsb.lol /v2/mil (ODbL)', now(), mainGeoidHeight);
    const note = 'Military flag comes from the adsb.lol aircraft database and may be incomplete or wrong.';
    if (currentLimit && currentLimit.until > now()) return { ...normalized, note,
      incomplete: { error: `adsb.lol: provider cooldown until ${new Date(currentLimit.until).toISOString()}`, retryAt: currentLimit.until } };
    ctx.sources?.backoff.delete(host);
    return { ...normalized, note };
  } catch (error) {
    if (!(error instanceof FeedHttpError) || (error.status !== 429 && error.status !== 503 && error.retryAfterSec === null)) throw error;
    // The grid can establish a longer wait while this military request is already in flight.
    const currentLimit = ctx.sources?.backoff.get(host);
    const strikes = (currentLimit?.strikes ?? 0) + 1;
    const until = Math.max(currentLimit?.until ?? 0, deadlineAfter(now(), Math.max(60_000, computeBackoffMs(strikes, error.retryAfterSec))));
    ctx.sources?.backoff.set(host, { until, strikes });
    return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Keeping last-known military-flagged aircraft while the provider asks the app to wait.',
      incomplete: { error: `adsb.lol: ${error.message}`, retryAt: until } };
  }
}

let vesselMeta: { at: number; map: Map<number, VesselStatic> } | null = null;

async function fetchVessels(ctx: FetchContext): Promise<FetchResult> {
  if (!vesselMeta || ctx.now.getTime() - vesselMeta.at > 30 * 60_000) {
    try {
      const res = await ctx.fetchJson('https://meri.digitraffic.fi/api/ais/v1/vessels', { headers: dtHeaders(ctx.userAgent), timeoutMs: 30000 });
      const map = new Map<number, VesselStatic>();
      if (Array.isArray(res.body)) {
        for (const v of res.body as Record<string, unknown>[]) {
          if (typeof v.mmsi === 'number') {
            map.set(v.mmsi, {
              name: typeof v.name === 'string' ? v.name.slice(0, 60).trim() || null : null,
              shipType: typeof v.shipType === 'number' ? v.shipType : null,
              destination: typeof v.destination === 'string' ? v.destination.slice(0, 40).trim() || null : null,
              callSign: typeof v.callSign === 'string' ? v.callSign.slice(0, 12) : null,
              imo: typeof v.imo === 'number' && v.imo > 0 ? v.imo : null,
              // Digitraffic reports draught in 1/10 m.
              draughtM: typeof v.draught === 'number' && v.draught > 0 ? v.draught / 10 : null,
              etaText: decodePackedEta(v.eta),
              ...aisDimensions(v.referencePointA, v.referencePointB, v.referencePointC, v.referencePointD),
            });
          }
        }
      }
      vesselMeta = { at: ctx.now.getTime(), map };
    } catch {
      vesselMeta = vesselMeta ?? { at: 0, map: new Map() };
    }
  }
  const res = await ctx.fetchJson('https://meri.digitraffic.fi/api/ais/v1/locations', { headers: dtHeaders(ctx.userAgent), timeoutMs: 30000 });
  const n = normalizeDigitrafficAis(res.body, vesselMeta.map);
  // The feed returns each vessel's last known position, however old; show only recent reports as live.
  const cutoff = ctx.now.getTime() - 2 * 3600_000;
  const fresh = n.records.filter((r) => r.observedAt && Date.parse(r.observedAt) >= cutoff);
  const hidden = n.records.length - fresh.length;
  return { records: fresh, skipped: n.skipped, sourceUpdatedAt: n.sourceUpdatedAt, note: `Keyless AIS covers Finnish and northern Baltic waters (Fintraffic). ${hidden.toLocaleString()} vessels with no report in the last 2 hours are hidden. Add an AISStream key in Provider settings for your view area.` };
}

const CELESTRAK_GROUPS: Record<string, string> = { stations: 'stations', visual: 'visual', gnss: 'gnss', weather: 'weather', science: 'science', starlink: 'starlink' };

async function fetchSatellites(ctx: FetchContext): Promise<FetchResult> {
  const out: GeoRecord[] = [];
  let skipped = 0;
  const notes: string[] = [];
  let oldestFetch: string | null = null;
  for (const g of ctx.settings.satelliteGroups) {
    const group = CELESTRAK_GROUPS[g];
    if (!group) continue;
    const key = `celestrak:${group}`;
    const cached = ctx.store.getFeedCache<string>(key);
    let text = cached?.payload ?? null;
    let fetchedAt = cached?.fetchedAt ?? null;
    // CelesTrak usage policy: at most one download per update (every 2 hours).
    if (!cached || ctx.now.getTime() - Date.parse(cached.fetchedAt) > 2 * 3600_000) {
      try {
        const res = await ctx.fetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 });
        text = res.text;
        fetchedAt = ctx.now.toISOString();
        ctx.store.setFeedCache(key, { fetchedAt, sourceUpdatedAt: null, payload: text });
      } catch (e) {
        if (e instanceof FeedHttpError && e.status === 403 && text) notes.push(`${g}: CelesTrak reports no newer data; using cached elements`);
        else if (text) notes.push(`${g}: refresh failed (${(e as Error).message}); using cached elements from ${fetchedAt}`);
        else throw e;
      }
    }
    if (text) {
      const n = normalizeTle(text, g);
      out.push(...n.records);
      skipped += n.skipped;
      if (fetchedAt && (!oldestFetch || fetchedAt < oldestFetch)) oldestFetch = fetchedAt;
    }
  }
  // De-duplicate objects present in several groups.
  const uniq = [...new Map(out.map((r) => [r.id, r])).values()];
  return { records: uniq, skipped, sourceUpdatedAt: oldestFetch, note: ['Positions are calculated (SGP4) from orbital elements, not observed.', ...notes].join(' ') };
}

async function fetchFires(ctx: FetchContext): Promise<FetchResult> {
  const base = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/';
  const files = ctx.settings.firmsRegion === 'global' ? ['J1_VIIRS_C2_Global_24h.csv'] : ['J1_VIIRS_C2_USA_contiguous_and_Hawaii_24h.csv', 'J1_VIIRS_C2_Alaska_24h.csv'];
  const out: GeoRecord[] = [];
  let skipped = 0;
  let latest: string | null = null;
  for (const file of files) {
    const res = await ctx.fetchText(base + file, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 60000, maxBytes: 30 * 1024 * 1024 });
    const n = normalizeFirmsCsv(res.text, file.replace('J1_VIIRS_C2_', '').replace('_24h.csv', ''));
    out.push(...n.records);
    skipped += n.skipped;
    if (n.sourceUpdatedAt && (!latest || n.sourceUpdatedAt > latest)) latest = n.sourceUpdatedAt;
  }
  return { records: out, skipped, sourceUpdatedAt: latest, note: 'Detections are hot pixels from satellite overpasses; not every detection is a wildfire.' };
}

async function fetchArcgisPaged(ctx: FetchContext, baseQuery: string, kind: 'perimeter' | 'airspace'): Promise<FetchResult> {
  if (kind === 'perimeter') return fetchPerimeterPages(ctx, baseQuery);
  const out: GeoRecord[] = [];
  let skipped = 0;
  for (let offset = 0, page = 0; page < 20; page++) {
    const res = await ctx.fetchJson(`${baseQuery}&resultOffset=${offset}&resultRecordCount=1000`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 60 * 1024 * 1024 });
    const n = normalizeArcgisPolygons(res.body, kind);
    out.push(...n.records);
    skipped += n.skipped;
    const exceeded = (res.body as { properties?: { exceededTransferLimit?: boolean }; exceededTransferLimit?: boolean }).exceededTransferLimit || (res.body as { properties?: { exceededTransferLimit?: boolean } }).properties?.exceededTransferLimit;
    const count = Array.isArray((res.body as { features?: unknown[] }).features) ? (res.body as { features: unknown[] }).features.length : 0;
    if (!exceeded || count === 0) break;
    offset += count;
  }
  return { records: out, skipped, sourceUpdatedAt: null, note: null };
}

/** A partial national perimeter refresh cannot establish removals from the prior complete reply. */
async function fetchPerimeterPages(ctx: FetchContext, baseQuery: string): Promise<FetchResult> {
  const out: GeoRecord[] = [], ids = new Set<string>(); let coordinates = 0;
  for (let offset = 0, page = 0; page < WFIGS_PERIMETER_LIMITS.pages; page++) {
    const res = await ctx.fetchJson(`${baseQuery}&resultOffset=${offset}&resultRecordCount=${WFIGS_PERIMETER_LIMITS.pageRecords}`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 60 * 1024 * 1024 });
    if (res.status !== 200) throw new Error('NIFC did not supply a complete HTTP 200 perimeter reply.');
    const n = normalizeArcgisPolygons(res.body, 'perimeter');
    if (n.skipped) throw new Error(`Incomplete NIFC perimeter reply: ${n.skipped} feature(s) have unsupported geometry or no stable publisher feature ID. Keeping the previous complete snapshot.`);
    for (const record of n.records) {
      if (ids.has(record.id)) throw new Error('Incomplete NIFC perimeter paging: a publisher feature ID repeated. Keeping the previous complete snapshot.');
      ids.add(record.id);
      const g = record.geometry!;
      if (g.type === 'LineString') throw new Error('Unexpected NIFC perimeter geometry.');
      for (const polygon of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const ring of polygon) coordinates += ring.length;
      if (coordinates > WFIGS_PERIMETER_LIMITS.coordinates) throw new Error('Incomplete NIFC perimeter reply: coordinate limit reached. Keeping the previous complete snapshot.');
    }
    out.push(...n.records);
    const body = res.body as { features: unknown[]; exceededTransferLimit?: unknown; properties?: { exceededTransferLimit?: unknown } };
    const flags = [body.exceededTransferLimit, body.properties?.exceededTransferLimit].filter(v => v !== undefined);
    if (flags.some(v => typeof v !== 'boolean')) throw new Error('NIFC returned an invalid paging-completeness flag.');
    const count = body.features.length;
    const more = flags.includes(true) || (flags.length === 0 && count === WFIGS_PERIMETER_LIMITS.pageRecords);
    if (!more) return { records: out, skipped: 0, sourceUpdatedAt: null,
      note: `NIFC WFIGS query completed in ${page + 1} page(s). ${out.length} perimeter features; these are not distinct incident counts. Source polygons retain all supplied parts and holes.` };
    if (!count) throw new Error('Incomplete NIFC perimeter paging: continuation advertised without features. Keeping the previous complete snapshot.');
    offset += count;
  }
  throw new Error('Incomplete NIFC perimeter reply: page limit reached while more features remain. Keeping the previous complete snapshot.');
}

// NOAA asks clients to wait between calls and stay below 100 requests/minute.
// Serialize this adapter across refreshes on the same HTTP boundary too; a force
// refresh must not create a burst. Production uses the shared main-process fetchJson.
const metarCadence = new WeakMap<FetchJson, { queue: Promise<void>; lastStart: number | null }>();
async function metarRequest(ctx: FetchContext, url: string) {
  let cadence = metarCadence.get(ctx.fetchJson);
  if (!cadence) metarCadence.set(ctx.fetchJson, (cadence = { queue: Promise.resolve(), lastStart: null }));
  const previous = cadence.queue;
  let release!: () => void;
  cadence.queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    // A wall-clock correction must neither bypass spacing nor create an overflowing timer.
    const now = () => performance.now();
    if (cadence.lastStart !== null) {
      const wait = Math.min(600, Math.max(0, cadence.lastStart + 600 - now()));
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    }
    cadence.lastStart = now();
    return await ctx.fetchJson(url, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
  } finally { release(); }
}

async function fetchMetar(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v || v.heightM > VIEW_LIMIT_METAR_M) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Zoom in below 1,500 km altitude to load weather observations for the view.' };
  const [w, s, e, n] = v.bbox;
  // Ordinary NOAA boxes avoid assuming undocumented west>east wrapping support.
  const longitudeRanges = w <= e ? [[w, e]] : [[w, 180], [-180, e]];
  const records = new Map<string, GeoRecord>();
  let skipped = 0, truncated = 0;
  for (const [west, east] of longitudeRanges) {
    const bbox = [s, west, n, east].map((value) => value.toFixed(3)).join(',');
    // Any failed half rejects the refresh unchanged. LayerManager retains last-known
    // observations and the original FeedHttpError/Retry-After; partial coverage is never 'ok'.
    const res = await metarRequest(ctx, `https://aviationweather.gov/api/data/metar?bbox=${bbox}&format=json`);
    const count = Array.isArray(res.body) ? res.body.length : 0;
    if (count >= 400) truncated++;
    const out = normalizeMetar(Array.isArray(res.body) ? res.body.slice(0, 400) : res.body);
    skipped += out.skipped + Math.max(0, count - 400);
    for (const record of out.records) {
      const previous = records.get(record.id);
      if (!previous || (record.observedAt ?? '') > (previous.observedAt ?? '')) records.set(record.id, record);
    }
  }
  return { records: [...records.values()], skipped, sourceUpdatedAt: null,
    note: truncated ? `NOAA reached the 400-observation limit in ${truncated} of ${longitudeRanges.length} query boxes; results may be truncated. Zoom in for more complete coverage.` : null };
}

/** A camera catalog the cameras layer loads (one request per refresh when it is due). */
interface CameraSource {
  /** Cache key: the source name, plus a fingerprint of the key for keyed systems (a new key is a new catalog). */
  key: string;
  name: string;
  /** Rate limits are kept per host (all Caltrans districts share one). */
  host: string;
  load: () => Promise<Normalized>;
  /** Failure text (never contains a key or a URL). */
  failure: (e: unknown) => string;
  /** Rejected credentials: the last catalog fetched with them is not shown any more. */
  dropCacheOn?: (e: unknown) => boolean;
}

/** A last good catalog older than this is no longer shown when its source fails. */
const CAMERA_CATALOG_KEEP_MS = 24 * 3600_000;
/** Catalogs fetched within this much of each other fall due together (one refresh, not one per catalog). */
const CAMERA_CATALOG_SLACK_MS = 10 * 60_000;

function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

async function fetchCameras(ctx: FetchContext): Promise<FetchResult> {
  const out: GeoRecord[] = [];
  let skipped = 0;
  const failed: string[] = [];
  // Timing is read per source, when its turn comes and when its answer arrives.
  const clock = ctx.clock ?? (() => Date.now());
  const pollMs = LAYERS.cameras.pollSeconds * 1000;
  const reuseMs = pollMs - CAMERA_CATALOG_SLACK_MS;
  // Without manager state (one-off calls) every source is fetched and nothing is remembered.
  const state: SourceState = ctx.sources ?? { backoff: new Map(), cache: new Map() };
  const plain = (name: string) => () => name;
  const sources: CameraSource[] = [];
  for (let d = 1; d <= 12; d++) {
    const dd = String(d).padStart(2, '0');
    sources.push({
      key: `Caltrans D${d}`, name: `Caltrans D${d}`, host: 'cwwp2.dot.ca.gov', failure: plain(`Caltrans D${d}`),
      load: async () => normalizeCaltrans((await ctx.fetchJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 20 * 1024 * 1024 })).body, d),
    });
  }
  const open: [string, string, () => Promise<Normalized>][] = [
    ['Fintraffic', 'tie.digitraffic.fi', async () => normalizeFintrafficCams((await ctx.fetchJson('https://tie.digitraffic.fi/api/weathercam/v1/stations', { headers: dtHeaders(ctx.userAgent), timeoutMs: 30000 })).body)],
    ['NYC DOT', 'webcams.nyctmc.org', async () => normalizeNycCams((await ctx.fetchJson('https://webcams.nyctmc.org/api/cameras', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 5 * 1024 * 1024 })).body)],
    // Open-data publishers whose terms allow use in a commercial app (see src/shared/cameraSources.ts).
    ['TfL JamCams', 'api.tfl.gov.uk', async () => normalizeTflJamCams((await ctx.fetchJson('https://api.tfl.gov.uk/Place/Type/JamCam', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 10 * 1024 * 1024 })).body)],
    ['Hong Kong Transport Department', 'static.data.gov.hk', async () => normalizeHongKongCams((await ctx.fetchText('https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 10 * 1024 * 1024 })).text)],
    ['DriveBC', 'www.drivebc.ca', async () => normalizeDriveBc((await ctx.fetchJson('https://www.drivebc.ca/api/webcams/', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 60000, maxBytes: 20 * 1024 * 1024 })).body)],
    ['Québec 511', 'ws.mapserver.transports.gouv.qc.ca', async () => normalizeQuebecCams((await ctx.fetchJson('https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:infos_cameras&srsname=EPSG:4326&outputformat=geojson', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 60000, maxBytes: 20 * 1024 * 1024 })).body)],
  ];
  for (const [name, host, load] of open) sources.push({ key: name, name, host, load, failure: plain(name) });
  // Systems the customer saved a key for (each key goes only to its own system's origin, redirects included;
  // errors never include it).
  const rejected = (e: unknown) => e instanceof FeedHttpError && (e.status === 400 || e.status === 401 || e.status === 403);
  for (const sys of KEYED_CAMERA_SYSTEMS) {
    let key: string | null = null;
    try {
      key = ctx.cameraKey?.(sys.id) ?? null;
    } catch {
      failed.push(`${sys.name} (saved key unreadable)`);
      continue;
    }
    if (!key) continue;
    const k = key;
    sources.push({
      key: `${sys.id}:${keyFingerprint(k)}`,
      name: sys.name,
      host: new URL(sys.origin).host,
      load: async () => {
        const req = keyedCameraRequest(sys, k);
        const res = await ctx.fetchJson(req.url, { method: req.method, body: req.body, headers: { ...req.headers, 'User-Agent': ctx.userAgent }, timeoutMs: 60000, maxBytes: 40 * 1024 * 1024, sameOrigin: true });
        return normalizeKeyedCameras(sys, res.body);
      },
      failure: (e) => (rejected(e) ? `${sys.name} (key rejected)` : sys.name),
      dropCacheOn: rejected,
    });
  }

  // Earliest time something should be fetched again: a rate limit expiring, or a kept catalog falling due.
  let refreshAt: number | null = null;
  const due = (t: number) => (refreshAt = refreshAt === null ? t : Math.min(refreshAt, t));
  const keep = (src: CameraSource, why: string): void => {
    const last = state.cache.get(src.key);
    if (last && clock() - last.at < CAMERA_CATALOG_KEEP_MS) {
      out.push(...last.records);
      skipped += last.skipped;
      due(last.at + CAMERA_CATALOG_KEEP_MS);
      failed.push(`${src.name} (${why}; last catalog shown)`);
    } else {
      state.cache.delete(src.key);
      failed.push(why === 'unavailable' ? src.name : `${src.name} (${why})`);
    }
  };
  for (const src of sources) {
    const cached = state.cache.get(src.key);
    // Catalogs change slowly: one fetched within the refresh interval is reused (a refresh triggered by a key
    // change or a rate-limit recovery fetches only what is missing or due).
    if (cached && clock() - cached.at < reuseMs) {
      out.push(...cached.records);
      skipped += cached.skipped;
      due(cached.at + reuseMs);
      continue;
    }
    const held = state.backoff.get(src.host);
    if (held && held.until > clock()) {
      // The host asked us to wait: no request until then, whatever started this refresh.
      due(held.until);
      keep(src, 'rate limited');
      continue;
    }
    try {
      const n = await src.load();
      out.push(...n.records);
      skipped += n.skipped;
      const at = clock();
      state.cache.set(src.key, { at, records: n.records, skipped: n.skipped });
      state.backoff.delete(src.host);
      due(at + reuseMs);
    } catch (e) {
      if (e instanceof FeedHttpError && (e.status === 429 || e.status === 503 || e.retryAfterSec !== null)) {
        const currentLimit = state.backoff.get(src.host);
        const strikes = (currentLimit?.strikes ?? 0) + 1;
        // Measured from the answer, not from the start of the refresh.
        const until = Math.max(currentLimit?.until ?? 0, deadlineAfter(clock(), Math.max(60_000, computeBackoffMs(strikes, e.retryAfterSec))));
        state.backoff.set(src.host, { until, strikes });
        due(until);
        // A rejected key invalidates its old catalog even when the publisher also asks us to wait.
        if (src.dropCacheOn?.(e)) {
          state.cache.delete(src.key);
          failed.push(src.failure(e));
        } else keep(src, 'rate limited');
      } else if (src.dropCacheOn?.(e)) {
        state.cache.delete(src.key);
        failed.push(src.failure(e));
      } else {
        const label = src.failure(e);
        if (label === src.name) keep(src, 'unavailable');
        else failed.push(label);
      }
    }
  }
  // Forget catalogs of sources that are gone (a removed or replaced key).
  const live = new Set(sources.map((s) => s.key));
  for (const k of [...state.cache.keys()]) if (!live.has(k)) state.cache.delete(k);
  const note = failed.length ? `Unavailable: ${failed.join(', ')}` : 'Images are loaded only when you open a camera.';
  // Nothing usable: still publish the (empty) reconciled set, so expired, rejected and removed catalogs disappear.
  const failure = out.length === 0 && failed.length > 0 ? `All camera catalogs failed: ${failed.join(', ')}` : null;
  return { records: out, skipped, sourceUpdatedAt: null, note, refreshAt, failure };
}

async function fetchIncidents(ctx: FetchContext): Promise<FetchResult> {
  const failed: string[] = [];
  let gd: GeoRecord[] = [];
  let eo: GeoRecord[] = [];
  let skipped = 0;
  try {
    const res = await ctx.fetchJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 10 * 1024 * 1024 });
    const n = normalizeGdacs(res.body);
    gd = n.records;
    skipped += n.skipped;
  } catch (e) {
    failed.push(`GDACS (${(e as Error).message})`);
  }
  try {
    const res = await ctx.fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 10 * 1024 * 1024 });
    const n = normalizeEonet(res.body);
    eo = n.records;
    skipped += n.skipped;
  } catch (e) {
    failed.push(`NASA EONET (${(e as Error).message})`);
  }
  if (!gd.length && !eo.length && failed.length) throw new Error(failed.join('; '));
  const records = mergeIncidents(gd, eo);
  return { records, skipped, sourceUpdatedAt: null, note: `${gd.length} GDACS + ${eo.length} EONET reports, ${records.length} after merging duplicates.${failed.length ? ` Unavailable: ${failed.join('; ')}` : ''}` };
}

export const FETCHERS: Record<LayerId, (ctx: FetchContext) => Promise<FetchResult>> = {
  dwd: async (ctx) => {
    if (!ctx.dwd) throw new Error('DWD warning source unavailable');
    const snapshot = await ctx.dwd.refresh();
    return { ...snapshot, refreshAt: Date.parse(snapshot.checkedAt) + LAYERS.dwd.pollSeconds * 1000 };
  },
  aircraft: fetchAircraft,
  aircraftMil: fetchAircraftMil,
  vessels: fetchVessels,
  satellites: fetchSatellites,
  fires: fetchFires,
  firePerimeters: (ctx) =>
    fetchArcgisPaged(
      ctx,
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=OBJECTID,GlobalID,poly_IncidentName,poly_DateCurrent,poly_PolygonDateTime,poly_GISAcres,poly_IRWINID,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime,attr_UniqueFireIdentifier,attr_POOState,attr_IncidentTypeCategory&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0005&f=geojson',
      'perimeter',
    ),
  metar: fetchMetar,
  cyclones: async (ctx) => {
    const res = await ctx.fetchJson('https://www.nhc.noaa.gov/CurrentStorms.json', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
    const n = normalizeNhc(res.body);
    return { ...n, note: n.records.length === 0 ? 'No active storms in NHC/CPHC basins (request succeeded).' : 'Forecast tracks and cones: open the NHC link on a storm.' };
  },
  cameras: fetchCameras,
  incidents: fetchIncidents,
  transit: async (ctx) => {
    const res = await ctx.fetchJson('https://api-v3.mbta.com/vehicles?include=route&fields%5Bvehicle%5D=latitude,longitude,bearing,speed,current_status,updated_at,label,direction_id&fields%5Broute%5D=type,short_name,long_name', {
      headers: { 'User-Agent': ctx.userAgent, Accept: 'application/vnd.api+json' },
      timeoutMs: 20000,
    });
    return { ...normalizeMbta(res.body), note: null };
  },
  airspace: (ctx) =>
    fetchArcgisPaged(
      ctx,
      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=TYPE_CODE%20IN%20('P','R')&outFields=GLOBAL_ID,OBJECTID,NAME,TYPE_CODE,UPPER_DESC,UPPER_VAL,UPPER_UOM,LOWER_DESC,LOWER_VAL,LOWER_UOM,TIMESOFUSE,CONT_AGENT,STATE&outSR=4326&geometryPrecision=5&f=geojson",
      'airspace',
    ),
};
