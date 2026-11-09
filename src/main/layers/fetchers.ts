// Per-layer fetch functions. URLs come from fixed templates; the only
// variable inputs are validated numbers (view center/bbox) and enum values.

import { aisDimensions, decodePackedEta, type VesselStatic, normalizeAdsb, normalizeArcgisPolygons, normalizeCaltrans, normalizeDigitrafficAis, normalizeFintrafficCams, normalizeFirmsCsv, normalizeMbta, normalizeMetar, normalizeNhc, normalizeTle, type Normalized } from '../../shared/layerNormalize';
import type { GeoRecord, LayerId, ViewState } from '../../shared/layers';
import type { Settings } from '../../shared/types';
import { FeedHttpError, type FetchJson, type FetchText } from '../feeds/http';
import type { AtlasStore } from '../store';

export interface FetchContext {
  view: ViewState | null;
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
}

const NM = 1852;
const VIEW_LIMIT_AIRCRAFT_M = 3_000_000;
const VIEW_LIMIT_METAR_M = 1_500_000;

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
  const v = ctx.view;
  if (!v || v.heightM > VIEW_LIMIT_AIRCRAFT_M) {
    note = 'Zoom in below 3,000 km altitude to load aircraft (adsb.lol queries are limited to a 250 nm radius).';
  } else {
    const r = aircraftRadiusNm(v.heightM);
    try {
      const res = await ctx.fetchJson(`https://api.adsb.lol/v2/point/${v.lat.toFixed(4)}/${v.lon.toFixed(4)}/${r}`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
      const n = normalizeAdsb(res.body, 'adsb.lol (ODbL)', ctx.now.getTime());
      out.push(...n.records);
      skipped += n.skipped;
      updated = n.sourceUpdatedAt;
      note = `Showing aircraft within ${r} nm of the view center.`;
    } catch (e) {
      errors.push(`adsb.lol: ${(e as Error).message}`);
    }
  }
  if (ctx.localReceiverUrl) {
    try {
      const res = await ctx.fetchJson(ctx.localReceiverUrl, { timeoutMs: 8000, maxBytes: 20 * 1024 * 1024 });
      const n = normalizeAdsb(res.body, 'Local receiver', ctx.now.getTime());
      const seen = new Map(out.map((r, i) => [r.id, i]));
      for (const rec of n.records) {
        const i = seen.get(rec.id);
        // Prefer the fresher observation of the same ICAO address.
        if (i === undefined) out.push(rec);
        else if ((rec.observedAt ?? '') > (out[i].observedAt ?? '')) out[i] = rec;
      }
      skipped += n.skipped;
    } catch (e) {
      errors.push(`local receiver: ${(e as Error).message}`);
    }
  }
  if (errors.length && out.length === 0) throw new Error(errors.join('; '));
  return { records: out, skipped, sourceUpdatedAt: updated, note: errors.length ? `${note ?? ''} Partial: ${errors.join('; ')}`.trim() : note };
}

async function fetchAircraftMil(ctx: FetchContext): Promise<FetchResult> {
  const res = await ctx.fetchJson('https://api.adsb.lol/v2/mil', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 25000 });
  return { ...normalizeAdsb(res.body, 'adsb.lol /v2/mil (ODbL)', ctx.now.getTime()), note: 'Military flag comes from the adsb.lol aircraft database and may be incomplete or wrong.' };
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

async function fetchMetar(ctx: FetchContext): Promise<FetchResult> {
  const v = ctx.view;
  if (!v || v.heightM > VIEW_LIMIT_METAR_M) return { records: [], skipped: 0, sourceUpdatedAt: null, note: 'Zoom in below 1,500 km altitude to load weather observations for the view.' };
  const [w0, s, e0, n] = v.bbox;
  // A view crossing the antimeridian (west > east) is clamped to its western part.
  const w = w0;
  const e = e0 < w0 ? 180 : e0;
  const res = await ctx.fetchJson(`https://aviationweather.gov/api/data/metar?bbox=${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}&format=json`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
  const out = normalizeMetar(res.body);
  return { ...out, note: out.records.length >= 400 ? 'The provider returns at most 400 stations; zoom in for complete coverage.' : null };
}

async function fetchCameras(ctx: FetchContext): Promise<FetchResult> {
  const out: GeoRecord[] = [];
  let skipped = 0;
  const failed: string[] = [];
  for (let d = 1; d <= 12; d++) {
    const dd = String(d).padStart(2, '0');
    try {
      const res = await ctx.fetchJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`, { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 45000, maxBytes: 20 * 1024 * 1024 });
      const n = normalizeCaltrans(res.body, d);
      out.push(...n.records);
      skipped += n.skipped;
    } catch {
      failed.push(`Caltrans D${d}`);
    }
  }
  try {
    const res = await ctx.fetchJson('https://tie.digitraffic.fi/api/weathercam/v1/stations', { headers: dtHeaders(ctx.userAgent), timeoutMs: 30000 });
    const n = normalizeFintrafficCams(res.body);
    out.push(...n.records);
    skipped += n.skipped;
  } catch {
    failed.push('Fintraffic');
  }
  if (out.length === 0) throw new Error(`All camera catalogs failed: ${failed.join(', ')}`);
  return { records: out, skipped, sourceUpdatedAt: null, note: failed.length ? `Unavailable: ${failed.join(', ')}` : 'Images are loaded only when you open a camera.' };
}

export const FETCHERS: Record<LayerId, (ctx: FetchContext) => Promise<FetchResult>> = {
  aircraft: fetchAircraft,
  aircraftMil: fetchAircraftMil,
  vessels: fetchVessels,
  satellites: fetchSatellites,
  fires: fetchFires,
  firePerimeters: (ctx) =>
    fetchArcgisPaged(
      ctx,
      'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,poly_DateCurrent,poly_PolygonDateTime,poly_GISAcres,poly_IRWINID,attr_IncidentSize,attr_PercentContained,attr_FireDiscoveryDateTime,attr_UniqueFireIdentifier,attr_POOState&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0005&f=geojson',
      'perimeter',
    ),
  metar: fetchMetar,
  cyclones: async (ctx) => {
    const res = await ctx.fetchJson('https://www.nhc.noaa.gov/CurrentStorms.json', { headers: { 'User-Agent': ctx.userAgent }, timeoutMs: 20000 });
    const n = normalizeNhc(res.body);
    return { ...n, note: n.records.length === 0 ? 'No active storms in NHC/CPHC basins (request succeeded).' : 'Forecast tracks and cones: open the NHC link on a storm.' };
  },
  cameras: fetchCameras,
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
