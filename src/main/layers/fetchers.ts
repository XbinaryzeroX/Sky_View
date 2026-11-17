import { normalizeOpenSky, OPENSKY_REFRESH_ANON_S, OPENSKY_REFRESH_AUTH_S } from '../../shared/opensky';
import { mergeIncidents, normalizeEonet, normalizeGdacs } from '../../shared/incidents';
// Per-layer fetch functions. URLs come from fixed templates; the only
// variable inputs are validated numbers (view center/bbox) and enum values.

import { aisDimensions, decodePackedEta, type VesselStatic, normalizeAdsb, normalizeArcgisPolygons, normalizeCaltrans, normalizeDigitrafficAis, normalizeFintrafficCams, normalizeFirmsCsv, normalizeMbta, normalizeMetar, normalizeNhc, normalizeNycCams, normalizeTle, WFIGS_PERIMETER_LIMITS, type Normalized } from '../../shared/layerNormalize';
import { LAYERS, type GeoRecord, type LayerId, type ViewState } from '../../shared/layers';
import { createHash } from 'node:crypto';
import type { Settings } from '../../shared/types';
import { computeBackoffMs, FeedHttpError, fetchBytes as sharedFetchBytes, type FetchBytes, type FetchJson, type FetchText } from '../feeds/http';
import { deadlineAfter } from '../feeds/timing';
import type { AtlasStore } from '../store';
import { mainGeoidHeight } from '../geoid';
import { normalizeCalgaryCams, normalizeDriveBc, normalizeHongKongCams, normalizeIcelandCams, normalizeQuebecCams, normalizeTflJamCams, normalizeTorontoCams } from '../../shared/cameraSources';
import { KEYED_CAMERA_SYSTEMS, keyedCameraRequest, normalizeKeyedCameras, type KeyedCameraId } from '../../shared/keyedCameras';
import type { DwdSource } from './dwdSource';
import { accumulateGnss, gnssCells, normalizeGnssAircraft, pruneGnss, type GnssStore } from '../../shared/gnssIntegrity';
import { launchesUrl, normalizeLaunches } from '../../shared/launches';
import { AQHI_URL, bikeSystemsForView, CONFLICT_WINDOW_MS, conflictRecords, gdeltExportUrls, normalizeAqhi, normalizeGbfs, normalizeInaturalist, parseGdeltEvents, wildlifeUrl, type ConflictEvent } from '../../shared/cityLayers';
import { kartaviewUrl, normalizeDigitrafficTrains, normalizeKartaview, normalizePanoramax, normalizeRailGtfs, panoramaxUrl, railFeedsForView, STREET_PHOTO_MAX_HEIGHT_M } from '../../shared/streetRail';
import { decodeGtfsVehicles } from '../../shared/gtfsRealtime';
import { registerFeedLinks } from '../../shared/sanitize';
import { unzipSingleCsv } from './zipSingle';
import { mbtaInView, normalizeTransitGtfs, TRANSIT_MAX_HEIGHT_M, TRANSIT_MAX_SHOWN, transitFeedsForView } from '../../shared/transitFeeds';
import { FINLAND_DATA_URL, FINLAND_STATIONS_URL, flowSourcesForView, HK_INFO_URL, HK_RAW_URL, MADRID_URL, normalizeFinlandTms, normalizeHkDetectors, normalizeMadrid, normalizeNycSpeeds, normalizeParis, NYC_URL, PARIS_LATEST_URL, parisHourUrl, parseHkDetectorInfo, type FlowSource } from '../../shared/trafficFlow';
import infrastructure from '../data/infrastructure.json';
import cablesData from '../data/cables.json';
import { normalizeAlprSites, normalizeMilitarySites, OSM_SITE_CACHE_BLOCKS, OSM_SITE_CACHE_MS, OSM_SITES, osmBlock, osmSiteQuery, type OsmSiteKind } from '../../shared/osmSites';
import { overpass } from '../osmSite';
import { infrastructureRecords, type InfrastructureFile } from '../../shared/infrastructure';
import { cableRecords, type CablesFile } from '../../shared/cables';
import { LANDSLIDE_DAYS, LANDSLIDE_DETAIL_URL, LANDSLIDE_LIST_URL, LANDSLIDE_MAX_DETAILS, landslideRecords, listedLandslideEvents } from '../../shared/landslides';

export interface FetchContext {
  dwd?: DwdSource;
  view: ViewState | null;
  /** OpenSky API client 'id:secret' (optional; anonymous when absent). */
  openskyClient?: string | null;
  /** Launch Library 2 token (launches layer only; anonymous when absent). */
  launchToken?: string | null;
  /** Saved keys of keyed camera systems (cameras layer only). */
  cameraKey?: (id: KeyedCameraId) => string | null;
  /** Per-source state kept by the layer manager between refreshes (cameras and aircraft providers). */
  sources?: SourceState;
  /** Current time in ms, read again as a refresh proceeds (requests are sequential and can take minutes). Defaults to Date.now. */
  clock?: () => number;
  settings: Settings;
  fetchJson: FetchJson;
  fetchText: FetchText;
  /** Binary downloads (GTFS-Realtime, ZIP); bounded by maxBytes. Defaults to the shared fetcher. */
  fetchBytes?: FetchBytes;
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

const CELESTRAK_GROUPS: Record<string, string> = { stations: 'stations', visual: 'visual', gnss: 'gnss', weather: 'weather', science: 'science', starlink: 'starlink', telecom: 'geo', imaging: 'resource', debris: 'fengyun-1c-debris' };

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
    ['Vegagerðin (Iceland)', 'gagnaveita.vegagerdin.is', async () => normalizeIcelandCams((await ctx.fetchJson('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 })).body)],
    ['City of Calgary', 'data.calgary.ca', async () => normalizeCalgaryCams((await ctx.fetchJson('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 })).body)],
    ['City of Toronto', 'opendata.toronto.ca', async () => normalizeTorontoCams((await ctx.fetchText('https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 })).text)],
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

/** Rolling 30-minute integrity observations over the views visited this session (bounded in shared/gnssIntegrity). */
const gnssStore: GnssStore = new Map();
let lastGnssRequest: { key: string; at: number; observedAt: number } | null = null;

async function fetchGnss(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const host = 'api.adsb.lol';
  const limit = ctx.sources?.backoff.get(host);
  const cells = () => gnssCells(pruneGnss(gnssStore, nowMs), new Date(nowMs).toISOString());
  if (limit && limit.until > nowMs) {
    return { records: cells(), skipped: 0, sourceUpdatedAt: null, note: 'Showing the last 30 minutes while adsb.lol asks the app to wait.',
      incomplete: { error: `adsb.lol: provider cooldown until ${new Date(limit.until).toISOString()}`, retryAt: limit.until } };
  }
  // Whole degrees: small pans reuse the same request area.
  const lat = Math.max(-85, Math.min(85, Math.round(v.lat)));
  const lon = ((Math.round(v.lon) + 540) % 360) - 180;
  // Zooming re-runs viewport layers, but this query only depends on the snapped center: ask adsb.lol at most once a minute per point.
  const pointKey = `${lat},${lon}`;
  if (lastGnssRequest && lastGnssRequest.key === pointKey && nowMs - lastGnssRequest.at < 60_000) {
    return { records: cells(), skipped: 0, sourceUpdatedAt: new Date(lastGnssRequest.observedAt).toISOString(), note: 'Same area as the last request less than a minute ago; showing the accumulated cells.' };
  }
  const res = await ctx.fetchJson(`https://api.adsb.lol/v2/point/${lat}/${lon}/250`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
  const body = res.body as { now?: unknown };
  const observedAt = typeof body?.now === 'number' && body.now > 1e12 ? body.now : nowMs;
  const rows = normalizeGnssAircraft(res.body);
  accumulateGnss(gnssStore, rows, nowMs, observedAt);
  lastGnssRequest = { key: pointKey, at: nowMs, observedAt };
  const records = cells();
  const flagged = records.filter((r) => r.category !== 'low').length;
  return { records, skipped: 0, sourceUpdatedAt: new Date(observedAt).toISOString(),
    note: `${rows.length} aircraft with usable accuracy reports in this view; ${records.length} cells with 3 or more aircraft, ${flagged} with low reported accuracy.` };
}

async function fetchLaunches(ctx: FetchContext): Promise<FetchResult> {
  const res = await ctx.fetchJson(launchesUrl(ctx.now), { headers: { 'User-Agent': ctx.userAgent, ...(ctx.launchToken ? { Authorization: `Token ${ctx.launchToken}` } : {}) }, timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 });
  const n = normalizeLaunches(res.body);
  const more = typeof (res.body as { next?: unknown })?.next === 'string';
  return { ...n, note: more ? 'More launches than one page: the latest are not all shown.' : null };
}

/** Runs one request per source and keeps whatever answered; the failures are listed in the note. */
async function eachSource<T>(items: T[], name: (t: T) => string, run: (t: T) => Promise<{ records: GeoRecord[]; skipped: number; extra?: string }>): Promise<{ records: GeoRecord[]; skipped: number; failed: string[]; extras: string[] }> {
  const out = { records: [] as GeoRecord[], skipped: 0, failed: [] as string[], extras: [] as string[] };
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(items.slice(i, i + 4).map(async (t) => {
      try {
        const r = await run(t);
        out.records.push(...r.records);
        out.skipped += r.skipped;
        if (r.extra) out.extras.push(r.extra);
      } catch (e) {
        out.failed.push(`${name(t)} (${e instanceof Error ? e.message : 'failed'})`);
      }
    }));
  }
  return out;
}

async function fetchBikeshare(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const systems = bikeSystemsForView(v.lat, v.lon, v.heightM);
  if (!systems.length) return { records: [], skipped: 0, sourceUpdatedAt: null, note: v.heightM > 400_000 ? 'Zoom in over a covered city to load stations.' : 'No covered bike-share system near this view.' };
  const r = await eachSource(systems, (s) => s.name, async (s) => {
    const headers: Record<string, string> = { 'User-Agent': ctx.userAgent, ...(s.clientIdHeader ? { 'Client-Identifier': 'atlas-watch' } : {}) };
    const [info, status] = await Promise.all([
      ctx.fetchJson(s.infoUrl, { headers, timeoutMs: 20000, maxBytes: 10 * 1024 * 1024 }),
      ctx.fetchJson(s.statusUrl, { headers, timeoutMs: 20000, maxBytes: 10 * 1024 * 1024 }),
    ]);
    return normalizeGbfs(info.body, status.body, s, ctx.now.getTime());
  });
  if (!r.records.length && r.failed.length) throw new Error(r.failed.join('; '));
  return { records: r.records, skipped: r.skipped, sourceUpdatedAt: null, note: `${systems.map((s) => s.name).join(', ')}.${r.failed.length ? ` Unavailable: ${r.failed.join('; ')}` : ''}` };
}

async function fetchWildlife(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  if (v.heightM > 1_500_000) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Zoom in (below about 1,500 km) to load sightings for the view.' };
  // A bbox across the date line is split by iNaturalist's own handling poorly; ask for the side the centre is on.
  let [w, s, e, n] = v.bbox;
  if (w > e) { if (v.lon >= w) e = 180; else w = -180; }
  const res = await ctx.fetchJson(wildlifeUrl([w, s, e, n], ctx.now), { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 });
  const r = normalizeInaturalist(res.body);
  return { ...r, note: `${r.records.length} openly licensed sighting${r.records.length === 1 ? '' : 's'} from the last 7 days in view${r.total && r.total > r.records.length ? ` (the ${r.records.length} most recent of ${r.total.toLocaleString()})` : ''}.` };
}

async function fetchAirQuality(ctx: FetchContext): Promise<FetchResult> {
  const res = await ctx.fetchJson(AQHI_URL, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 10 * 1024 * 1024 });
  return { ...normalizeAqhi(res.body), note: null };
}

/** Rolling 24 h of parsed GDELT files, keyed by file URL; bounded by the window (96 files). */
const gdeltFiles = new Map<string, { at: number; events: ConflictEvent[] }>();
let gdeltNextBackfill = 0;

async function fetchConflicts(ctx: FetchContext): Promise<FetchResult> {
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  for (const [k, f] of gdeltFiles) if (nowMs - f.at > CONFLICT_WINDOW_MS) gdeltFiles.delete(k);
  // The newest file is announced before it can be downloaded: look back a few slots, newest first. On the first run
  // read the last 3 hours (12 files, about 50 kB each); afterwards only files not yet read.
  const wanted = gdeltExportUrls(nowMs, gdeltFiles.size ? 4 : 12, 0).filter((u) => !gdeltFiles.has(u));
  const failed: string[] = [];
  for (const url of wanted) {
    if (nowMs < gdeltNextBackfill && gdeltFiles.size) break;
    try {
      const res = await (ctx.fetchBytes ?? sharedFetchBytes)(url, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 3 * 1024 * 1024 });
      const csv = unzipSingleCsv(res.bytes, 20 * 1024 * 1024);
      const parsed = parseGdeltEvents(csv);
      const stamp = /(\d{14})\.export/.exec(url)?.[1] ?? '';
      const at = Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00Z`);
      gdeltFiles.set(url, { at: Number.isFinite(at) ? at : nowMs, events: parsed.events });
      registerFeedLinks(parsed.events.map((e) => e.url));
    } catch (e) {
      // Not yet published (404) is normal for the newest slot; anything else is reported.
      if (!(e instanceof FeedHttpError && e.status === 404)) failed.push(e instanceof Error ? e.message : 'failed');
      if (e instanceof FeedHttpError && e.status !== 404) { gdeltNextBackfill = nowMs + 5 * 60_000; break; }
    }
  }
  if (!gdeltFiles.size) throw new Error(failed.length ? failed.join('; ') : 'No GDELT event file could be read yet.');
  const records = conflictRecords([...gdeltFiles.values()].flatMap((f) => f.events));
  const oldest = Math.min(...[...gdeltFiles.values()].map((f) => f.at));
  const newest = Math.max(...[...gdeltFiles.values()].map((f) => f.at));
  return { records, skipped: 0, sourceUpdatedAt: new Date(newest).toISOString(),
    note: `${records.length} articles from ${gdeltFiles.size} GDELT updates since ${new Date(oldest).toISOString().slice(11, 16)} UTC.${failed.length ? ` Partial: ${failed.join('; ')}` : ''}` };
}

async function fetchStreetPhotos(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  if (v.heightM > STREET_PHOTO_MAX_HEIGHT_M) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Zoom in to street level (below about 4 km) to find photos near the view centre.' };
  const r = await eachSource(['KartaView', 'Panoramax'] as const, (n) => n, async (n) => {
    const url = n === 'KartaView' ? kartaviewUrl(v.lat, v.lon) : panoramaxUrl(v.lat, v.lon);
    const res = await ctx.fetchJson(url, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
    return n === 'KartaView' ? normalizeKartaview(res.body) : normalizePanoramax(res.body);
  });
  if (!r.records.length && r.failed.length === 2) throw new Error(r.failed.join('; '));
  return { records: r.records, skipped: r.skipped, sourceUpdatedAt: null, note: `${r.records.length} photos within 500 m of the view centre.${r.failed.length ? ` Unavailable: ${r.failed.join('; ')}` : ''}` };
}

async function fetchRail(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const feeds = railFeedsForView(v.lat, v.lon, v.heightM);
  if (!feeds.length) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'No covered train operator in this view. Covered: New York, Philadelphia, Baltimore–Washington, South East Queensland, Finland, Spain, Norway, Malaysia, Toyama.' };
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  let stale = 0;
  const r = await eachSource(feeds, (f) => f.name, async (f) => {
    const headers = { 'User-Agent': ctx.userAgent, ...(f.headers ?? {}) };
    if (f.format === 'digitraffic-json') {
      const res = await ctx.fetchJson(f.url, { headers: { ...headers, 'Accept-Encoding': 'gzip' }, timeoutMs: 20000, maxBytes: 10 * 1024 * 1024 });
      const n = normalizeDigitrafficTrains(f, res.body, nowMs);
      stale += n.stale;
      return n;
    }
    const res = await (ctx.fetchBytes ?? sharedFetchBytes)(f.url, { headers, timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
    const n = normalizeRailGtfs(f, decodeGtfsVehicles(res.bytes), nowMs);
    stale += n.stale;
    return n;
  });
  if (!r.records.length && r.failed.length === feeds.length) throw new Error(r.failed.join('; '));
  return { records: r.records, skipped: r.skipped, sourceUpdatedAt: null,
    note: `${feeds.map((f) => f.name).join(', ')}.${stale ? ` ${stale} positions older than 15 minutes left out.` : ''}${r.failed.length ? ` Unavailable: ${r.failed.join('; ')}` : ''}` };
}

async function fetchTransit(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const feeds = transitFeedsForView(v.lat, v.lon, v.heightM);
  const mbta = mbtaInView(v.lat, v.lon, v.heightM);
  if (!feeds.length && !mbta) return { records: [], skipped: 0, sourceUpdatedAt: null, note: v.heightM > TRANSIT_MAX_HEIGHT_M ? 'Zoom in over a covered city to load its buses, trams and ferries.' : 'No covered transit operator in this view. See Source & coverage for the list.' };
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  let stale = 0;
  type Src = { name: string; run: () => Promise<{ records: GeoRecord[]; skipped: number }> };
  const sources: Src[] = feeds.map((f) => ({ name: f.name, run: async () => {
    const res = await (ctx.fetchBytes ?? sharedFetchBytes)(f.url, { headers: { 'User-Agent': ctx.userAgent, ...(f.headers ?? {}) }, timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
    const n = normalizeTransitGtfs(f, decodeGtfsVehicles(res.bytes), nowMs);
    stale += n.stale;
    return n;
  } }));
  if (mbta) sources.push({ name: 'MBTA', run: async () => {
    const res = await ctx.fetchJson('https://api-v3.mbta.com/vehicles?include=route&fields%5Bvehicle%5D=latitude,longitude,bearing,speed,current_status,updated_at,label,direction_id&fields%5Broute%5D=type,short_name,long_name', {
      headers: { 'User-Agent': ctx.userAgent, Accept: 'application/vnd.api+json' },
      timeoutMs: 20000,
    });
    return normalizeMbta(res.body);
  } });
  const r = await eachSource(sources, (s) => s.name, (s) => s.run());
  if (!r.records.length && r.failed.length === sources.length) throw new Error(r.failed.join('; '));
  // Only what the view can show, nearest the centre first: national feeds carry thousands of vehicles.
  const [w, s, e, n] = v.bbox;
  const pad = Math.min(3, v.heightM / 111_320 / 2);
  const inView = (lat: number, lon: number) => lat >= s - pad && lat <= n + pad && (w <= e ? lon >= w - pad && lon <= e + pad : lon >= w - pad || lon <= e + pad);
  const cos = Math.cos((v.lat * Math.PI) / 180);
  const d2 = (x: GeoRecord) => (x.lat - v.lat) ** 2 + ((((x.lon - v.lon) % 360 + 540) % 360 - 180) * cos) ** 2;
  const seen = r.records.filter((x) => inView(x.lat, x.lon));
  const shown = seen.length > TRANSIT_MAX_SHOWN ? seen.sort((a, b) => d2(a) - d2(b)).slice(0, TRANSIT_MAX_SHOWN) : seen;
  return { records: shown, skipped: r.skipped, sourceUpdatedAt: null,
    note: `${sources.map((s) => s.name).join(', ')}: ${shown.length.toLocaleString()} vehicles in view${seen.length > shown.length ? ` (nearest of ${seen.length.toLocaleString()}; zoom in for the rest)` : ''}.${stale ? ` ${stale} positions older than 10 minutes left out.` : ''}${r.failed.length ? ` Unavailable: ${r.failed.join('; ')}` : ''}` };
}

/** Bundled reference data: no network. Parsed once, checked like any other input. */
let infraCache: { datacenter: ReturnType<typeof infrastructureRecords>; dam: ReturnType<typeof infrastructureRecords> } | null = null;
function bundledInfrastructure(kind: 'datacenter' | 'dam'): FetchResult {
  infraCache ??= { datacenter: infrastructureRecords(infrastructure as unknown as InfrastructureFile, 'datacenter'), dam: infrastructureRecords(infrastructure as unknown as InfrastructureFile, 'dam') };
  const r = infraCache[kind];
  return { ...r, note: `Bundled with the app (built ${(infrastructure as unknown as InfrastructureFile).built}); ${r.records.length.toLocaleString()} sites.` };
}

/** Event details are kept until USGS updates the event, so an hourly refresh asks only for new or changed events. */
const landslideDetails = new Map<string, { updated: number; body: unknown }>();
async function fetchLandslides(ctx: FetchContext): Promise<FetchResult> {
  const nowMs = ctx.clock?.() ?? Date.now();
  const list = await ctx.fetchJson(LANDSLIDE_LIST_URL(new Date(nowMs - LANDSLIDE_DAYS * 86_400_000).toISOString()), { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 });
  const { events, skipped: listSkipped } = listedLandslideEvents(list.body);
  const wanted = events.slice(0, LANDSLIDE_MAX_DETAILS);
  const failed: string[] = [];
  for (const e of wanted) {
    const hit = landslideDetails.get(e.id);
    if (hit && hit.updated === e.updated) continue;
    try {
      const res = await ctx.fetchJson(LANDSLIDE_DETAIL_URL(e.id), { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 });
      landslideDetails.set(e.id, { updated: e.updated, body: res.body });
    } catch {
      failed.push(e.id);
    }
  }
  const keep = new Set(wanted.map((e) => e.id));
  for (const id of landslideDetails.keys()) if (!keep.has(id)) landslideDetails.delete(id);
  const n = landslideRecords(wanted.map((e) => landslideDetails.get(e.id)?.body).filter((b) => b !== undefined));
  const missing = failed.length ? ` ${failed.length} event${failed.length === 1 ? '' : 's'} could not be loaded and ${failed.length === 1 ? 'is' : 'are'} not shown.` : '';
  return { ...n, skipped: n.skipped + listSkipped, note: `${n.records.length} USGS landslide estimates for earthquakes of the last ${LANDSLIDE_DAYS} days${events.length > wanted.length ? ` (newest ${wanted.length} of ${events.length})` : ''}. Model estimates, not observed landslides.${missing}` };
}

let cableCache: ReturnType<typeof cableRecords> | null = null;
function bundledCables(): FetchResult {
  const file = cablesData as unknown as CablesFile;
  cableCache ??= cableRecords(file);
  const under = cableCache.records.filter((r) => r.category === 'submarine').length;
  return { ...cableCache, note: `Bundled with the app: ${under.toLocaleString()} mapped pieces under water and ${(cableCache.records.length - under).toLocaleString()} under ground, as OpenStreetMap stood on ${String(file.osmBase ?? file.built).slice(0, 10)}. Most cables are not mapped.` };
}

/** Per-source replies reused for the source's cache time; reference lists (stations, detectors) for a day. */
const flowCache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, nowMs: number, load: () => Promise<T>): Promise<T> {
  const hit = flowCache.get(key);
  if (hit && nowMs - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  flowCache.set(key, { at: nowMs, value });
  return value;
}

async function fetchTrafficFlow(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const sources = flowSourcesForView(v.lat, v.lon, v.heightM);
  if (!sources.length) return { records: [], skipped: 0, sourceUpdatedAt: null, note: v.heightM > 2_500_000 ? 'Zoom in over New York, Finland, Hong Kong, Madrid or Paris to load traffic flow.' : 'No free traffic-flow source covers this view. Covered: New York City, Finland, Hong Kong, Madrid, Paris.' };
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  const headers = { 'User-Agent': ctx.userAgent };
  const json = (url: string, extra: Record<string, string> = {}) => ctx.fetchJson(url, { headers: { ...headers, ...extra }, timeoutMs: 30000, maxBytes: 20 * 1024 * 1024 }).then((r) => r.body);
  const text = (url: string) => ctx.fetchText(url, { headers, timeoutMs: 30000, maxBytes: 20 * 1024 * 1024 }).then((r) => r.text);
  const run = async (s: FlowSource) => {
    switch (s.id) {
      case 'nyc': return cached('nyc', s.cacheMs, nowMs, async () => normalizeNycSpeeds(await json(NYC_URL), s));
      case 'finland': {
        const dt = { 'Digitraffic-User': 'AtlasWatch/traffic', 'Accept-Encoding': 'gzip' };
        const stations = await cached('fi-stations', 86_400_000, nowMs, () => json(FINLAND_STATIONS_URL, dt));
        return cached('finland', s.cacheMs, nowMs, async () => normalizeFinlandTms(stations, await json(FINLAND_DATA_URL, dt), s));
      }
      case 'hongkong': {
        const info = await cached('hk-info', 86_400_000, nowMs, async () => parseHkDetectorInfo(await text(HK_INFO_URL)));
        return cached('hongkong', s.cacheMs, nowMs, async () => normalizeHkDetectors(await text(HK_RAW_URL), info, s));
      }
      case 'madrid': return cached('madrid', s.cacheMs, nowMs, async () => normalizeMadrid(await text(MADRID_URL), s));
      case 'paris': return cached('paris', s.cacheMs, nowMs, async () => {
        const latest = (await json(PARIS_LATEST_URL)) as { results?: { t?: unknown }[] };
        const t = latest?.results?.[0]?.t;
        if (typeof t !== 'string') throw new Error('Paris did not report its latest hour');
        return normalizeParis(await json(parisHourUrl(t)), s);
      });
    }
  };
  const r = await eachSource(sources, (s) => s.name, run);
  if (!r.records.length && r.failed.length === sources.length) throw new Error(r.failed.join('; '));
  // Only what the view can show: a margin of half the view height around its box.
  const [w, s, e, n] = v.bbox;
  const pad = Math.min(5, v.heightM / 111_320 / 2);
  const inView = (lat: number, lon: number) => lat >= s - pad && lat <= n + pad && (w <= e ? lon >= w - pad && lon <= e + pad : lon >= w - pad || lon <= e + pad);
  const records = r.records.filter((x) => inView(x.lat, x.lon)).slice(0, 12000);
  return { records, skipped: r.skipped, sourceUpdatedAt: null, note: `${sources.map((x) => x.name).join(', ')}: ${records.length.toLocaleString()} road segments or sensors in view.${r.failed.length ? ` Unavailable: ${r.failed.join('; ')}` : ''}` };
}

/** Overpass answers per map block, newest last; a block is asked again only after a day. */
const osmSiteCache = new Map<string, { at: number; records: GeoRecord[]; skipped: number; capped: boolean }>();
export function clearOsmSiteCache(): void { osmSiteCache.clear(); }

async function fetchOsmSites(kind: OsmSiteKind, ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  const what = kind === 'military' ? 'military sites' : 'plate-reader cameras';
  if (!v) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Waiting for the map view.' };
  const block = osmBlock(kind, v.lat, v.lon, v.heightM);
  if (!block) return { records: [], skipped: 0, sourceUpdatedAt: null, note: `Zoom in (below about ${Math.round(OSM_SITES[kind].maxHeightM / 1000)} km) to load mapped ${what} for the area.` };
  const nowMs = ctx.clock?.() ?? ctx.now.getTime();
  let hit = osmSiteCache.get(block.key);
  if (!hit || nowMs - hit.at > OSM_SITE_CACHE_MS) {
    const elements = await overpass(ctx.fetchJson, osmSiteQuery(kind, block), ctx.userAgent);
    const n = kind === 'military' ? normalizeMilitarySites(elements) : normalizeAlprSites(elements);
    hit = { at: nowMs, records: n.records, skipped: n.skipped, capped: elements.length >= OSM_SITES[kind].cap };
    osmSiteCache.delete(block.key);
    osmSiteCache.set(block.key, hit);
    while (osmSiteCache.size > OSM_SITE_CACHE_BLOCKS) osmSiteCache.delete(osmSiteCache.keys().next().value!);
  }
  const count = hit.records.length;
  const note = count
    ? `${count.toLocaleString()} mapped ${what} in this area${hit.capped ? ' (the limit for one area; more are mapped)' : ''}. Community mapping: incomplete.`
    : `No ${what} are mapped in this area. That is a gap in the map, not proof that none exist.`;
  return { records: hit.records, skipped: hit.skipped, sourceUpdatedAt: null, note };
}

export const FETCHERS: Record<LayerId, (ctx: FetchContext) => Promise<FetchResult>> = {
  milSites: (ctx) => fetchOsmSites('military', ctx),
  alpr: (ctx) => fetchOsmSites('alpr', ctx),
  gnss: fetchGnss,
  trafficFlow: fetchTrafficFlow,
  datacenters: async () => bundledInfrastructure('datacenter'),
  dams: async () => bundledInfrastructure('dam'),
  cables: async () => bundledCables(),
  landslides: fetchLandslides,
  rail: fetchRail,
  bikeshare: fetchBikeshare,
  wildlife: fetchWildlife,
  airQuality: fetchAirQuality,
  conflicts: fetchConflicts,
  streetPhotos: fetchStreetPhotos,
  launches: fetchLaunches,
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
  transit: fetchTransit,
  airspace: (ctx) =>
    fetchArcgisPaged(
      ctx,
      "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=TYPE_CODE%20IN%20('P','R')&outFields=GLOBAL_ID,OBJECTID,NAME,TYPE_CODE,UPPER_DESC,UPPER_VAL,UPPER_UOM,LOWER_DESC,LOWER_VAL,LOWER_UOM,TIMESOFUSE,CONT_AGENT,STATE&outSR=4326&geometryPrecision=5&f=geojson",
      'airspace',
    ),
};
