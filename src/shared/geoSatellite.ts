// Geostationary weather-satellite imagery from NASA GIBS (no key, no account).
//
// GOES-West and GOES-East (NOAA) and Himawari-9 (Japan Meteorological Agency) each publish a full-disk frame every
// 10 minutes; GIBS serves them as Web Mercator tiles about 30–60 minutes after the scan. The app asks GIBS for each
// layer's newest frame (WMTS DescribeDomains, a few hundred bytes) every 10 minutes and draws that frame; it never
// guesses a time. GIBS data use: full and open; acknowledgement requested (shown in the credits).
//
// Meteosat (Europe, Africa, the Indian Ocean) is not in GIBS. It comes from EUMETSAT's View Service (WMS) as hourly
// frames only: EUMETSAT states that hourly imagery is no longer subject to licensing, while 15-minute imagery under
// three hours old is licensed for research, education and personal use. The frame drawn is the last full hour that is
// at least 20 minutes old (the service publishes 15-minute frames, so that hour always exists).

export type GeoSatProduct = 'infrared' | 'color';
export type GeoSatId = 'goes-west' | 'goes-east' | 'meteosat-0' | 'meteosat-iodc' | 'himawari';

export interface GeoSatLayer {
  /** GIBS layer identifier, or the EUMETSAT WMS layer name. */
  id: string;
  /** GIBS tile matrix set (GoogleMapsCompatible_LevelN); maxLevel is N. Unused for EUMETSAT. */
  tms: string;
  maxLevel: number;
  title: string;
}

export interface GeoSat {
  id: GeoSatId;
  name: string;
  agency: string;
  /**
   * Longitudes this satellite is drawn for. Neighbouring disks overlap; each is clipped halfway between the
   * satellites (GOES-West | GOES-East at 106.2°W) or at its own disk edge, so the seams never double up.
   */
  west: number;
  east: number;
  /** Where frames come from: NASA GIBS (newest 10-minute frame) or EUMETSAT (hourly frames). */
  source: 'gibs' | 'eumetsat';
  layers: Record<GeoSatProduct, GeoSatLayer>;
}

const ir = (id: string): GeoSatLayer => ({ id, tms: 'GoogleMapsCompatible_Level6', maxLevel: 6, title: 'infrared clouds' });
const color = (id: string, title: string): GeoSatLayer => ({ id, tms: 'GoogleMapsCompatible_Level7', maxLevel: 7, title });

const msg = (id: string, title: string): GeoSatLayer => ({ id, tms: '', maxLevel: 6, title });

/**
 * Seams are halfway between neighbouring sub-satellite points (GOES-West 137.2°W, GOES-East 75.2°W, Meteosat 0°,
 * Meteosat IODC 45.5°E, Himawari 140.7°E), so each area is drawn from the satellite that sees it most directly.
 */
export const GEO_SATS: GeoSat[] = [
  { id: 'goes-west', name: 'GOES-West', agency: 'NOAA', source: 'gibs', west: -180, east: -106.2, layers: { infrared: ir('GOES-West_ABI_Band13_Clean_Infrared'), color: color('GOES-West_ABI_GeoColor', 'GeoColor') } },
  { id: 'goes-east', name: 'GOES-East', agency: 'NOAA', source: 'gibs', west: -106.2, east: -37.6, layers: { infrared: ir('GOES-East_ABI_Band13_Clean_Infrared'), color: color('GOES-East_ABI_GeoColor', 'GeoColor') } },
  // Himawari has no GeoColor product in GIBS: its "true colour" option is the red visible band (daylight only, grey).
  { id: 'meteosat-0', name: 'Meteosat (0°)', agency: 'EUMETSAT', source: 'eumetsat', west: -37.6, east: 22.75, layers: { infrared: msg('msg_fes:ir108', 'infrared 10.8 µm, hourly'), color: msg('msg_fes:rgb_naturalenhncd', 'natural colour, hourly (daylight)') } },
  { id: 'meteosat-iodc', name: 'Meteosat (Indian Ocean)', agency: 'EUMETSAT', source: 'eumetsat', west: 22.75, east: 93.1, layers: { infrared: msg('msg_iodc:ir108', 'infrared 10.8 µm, hourly'), color: msg('msg_iodc:rgb_naturalenhncd', 'natural colour, hourly (daylight)') } },
  { id: 'himawari', name: 'Himawari-9', agency: 'JMA', source: 'gibs', west: 93.1, east: 180, layers: { infrared: ir('Himawari_AHI_Band13_Clean_Infrared'), color: color('Himawari_AHI_Band3_Red_Visible_1km', 'visible (daylight only)') } },
];

export const EUMETSAT_WMS = 'https://view.eumetsat.int/geoserver/wms';

/** The hourly Meteosat frame to draw: the last full hour at least 20 minutes old. */
export function eumetsatFrameTime(nowMs: number): string {
  return new Date(Math.floor((nowMs - 20 * 60_000) / 3_600_000) * 3_600_000).toISOString().replace('.000Z', 'Z');
}

/** How often the newest frame is looked up while the layer is on. */
export const GEO_SAT_REFRESH_MS = 10 * 60_000;
/** A satellite whose newest frame is older than this is not drawn (an outage is shown as missing, not as old weather). */
export const GEO_SAT_MAX_AGE_MS = 3 * 3600_000;
/** Disks reach about 81° from the sub-satellite point; tiles beyond this latitude are not requested. */
export const GEO_SAT_MAX_LAT = 81.3;

const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** ISO 8601 period of a time range (GIBS uses PT10M for these layers). */
const PERIOD = /^P(?:\d+D|T\d+[HMS])$/;

const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

/** DescribeDomains request listing a layer's frames in the last GEO_SAT_MAX_AGE_MS (the newest is the last listed). */
export function domainUrl(layer: GeoSatLayer, nowMs: number): string {
  return `${BASE}/1.0.0/${layer.id}/default/${layer.tms}/all/${iso(nowMs - GEO_SAT_MAX_AGE_MS)}--${iso(nowMs)}.xml`;
}

/**
 * Newest frame time in a DescribeDomains answer: the time Domain is a comma-separated list of single times and
 * `start/end/PT10M` ranges. Returns null only for a well-formed answer that lists no frame (none in the window);
 * throws for anything else (an error page, truncated XML, a malformed time), so the caller treats it as a failed
 * lookup and keeps the frame it has.
 */
export function parseLatestFrame(xml: string): string | null {
  const bad = () => new Error('Unexpected answer from GIBS');
  if (!/<Domains[\s>]/.test(xml) || !/<\/Domains>\s*$/.test(xml)) throw bad();
  const dims = [...xml.matchAll(/<DimensionDomain>([\s\S]*?)<\/DimensionDomain>/g)].map((m) => m[1]);
  const time = dims.find((d) => /<ows:Identifier>\s*time\s*<\/ows:Identifier>/.test(d));
  if (!time) throw bad();
  const m = /<Domain>([^<]*)<\/Domain>|<Domain\s*\/>/.exec(time);
  if (!m) throw bad();
  const domain = (m[1] ?? '').trim();
  if (!domain) return null;
  let latest: string | null = null;
  for (const item of domain.split(',')) {
    const parts = item.trim().split('/');
    const valid = (t: string | undefined): t is string => !!t && TIME.test(t) && Number.isFinite(Date.parse(t));
    let end: string;
    if (parts.length === 1 && valid(parts[0])) end = parts[0];
    else if (parts.length === 3 && valid(parts[0]) && valid(parts[1]) && parts[0] <= parts[1] && PERIOD.test(parts[2])) end = parts[1];
    else throw bad();
    if (!latest || end > latest) latest = end;
  }
  return latest;
}

/** Tile URL template ({z}/{y}/{x}) for one frame; the time must be a frame time as GIBS lists it. */
export function tileTemplate(layer: GeoSatLayer, time: string): string {
  if (!TIME.test(time)) throw new Error('Invalid frame time');
  return `${BASE}/${layer.id}/default/${time}/${layer.tms}/{z}/{y}/{x}.png`;
}

/** A lookup that has not finished (headers and body) by then is abandoned. */
export const GEO_SAT_LOOKUP_TIMEOUT_MS = 20_000;
/** DescribeDomains answers are a few hundred bytes; anything over this is refused while it streams. */
export const GEO_SAT_LOOKUP_MAX_BYTES = 64 * 1024;

/** Reads a response body as text, cancelling it as soon as it passes `maxBytes` or the signal fires (a stalled body is cut off). */
export async function readCapped(res: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error('Response too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const stop = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new Error('Lookup abandoned');
      const { done, value } = await reader.read();
      // Cancelling ends a pending read as "done": that is an abandoned answer, not a complete one.
      if (signal?.aborted) throw new Error('Lookup abandoned');
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * Newest frame time of one layer (null when GIBS lists none in the window). The signal must cover the whole
 * exchange: it aborts the request and the body read. Throws on HTTP errors, malformed or oversized answers and aborts.
 */
export async function fetchLatestFrame(layer: GeoSatLayer, nowMs: number, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  const res = await (opts.fetchImpl ?? fetch)(domainUrl(layer, nowMs), { cache: 'no-store', signal: opts.signal });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return parseLatestFrame(await readCapped(res, GEO_SAT_LOOKUP_MAX_BYTES, opts.signal));
}

export type GeoFrames = Partial<Record<GeoSatId, string | null>>;

/** Drops frames that have become too old to draw (same object back when nothing changed). */
export function expireFrames(times: GeoFrames, nowMs: number): GeoFrames {
  let changed = false;
  const out: GeoFrames = {};
  for (const [id, t] of Object.entries(times) as [GeoSatId, string | null][]) {
    const keep = frameUsable(t, nowMs) ? t : null;
    if (keep !== t) changed = true;
    out[id] = keep;
  }
  return changed ? out : times;
}

/** Whether a frame is recent enough to draw. */
export function frameUsable(time: string | null, nowMs: number): time is string {
  if (!time) return false;
  const t = Date.parse(time);
  return Number.isFinite(t) && t <= nowMs + 5 * 60_000 && nowMs - t <= GEO_SAT_MAX_AGE_MS;
}

/** "13:20 UTC" for a frame time. */
export function frameLabel(time: string): string {
  return `${time.slice(11, 16)} UTC`;
}
