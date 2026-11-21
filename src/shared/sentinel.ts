// Recent Sentinel-2 imagery for a box the user draws (for example around a fire).
// Scenes are found with the Earth Search STAC API (Element 84, keyless) and read from the Sentinel-2 L2A
// cloud-optimised GeoTIFFs on the AWS Open Data registry (keyless, range requests). The true-colour "visual" file
// is 8-bit RGB, deflate with horizontal differencing, tiled, with overviews at 1/2 … 1/16 (checked 2026-11-17 on
// S2B_11SLT_20261108_0_L2A). Only the tiles under the box are read.
// Data: Copernicus Sentinel data, free and open (Sentinel data legal notice). Earth Search: https://element84.com/earth-search/

import { toUtm, utmZoneFromEpsg, type UtmZone } from './utm';

export const SENTINEL_STAC_URL = 'https://earth-search.aws.element84.com/v1/search';
export const SENTINEL_COG_PREFIX = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/';
export const SENTINEL_CREDIT = 'Contains modified Copernicus Sentinel data (ESA), via Earth Search (Element 84) and AWS Open Data';

/** The largest box: about 55 km across. Bigger boxes would need many full-resolution tiles. */
export const SENTINEL_MAX_SPAN_KM = 55;
export const SENTINEL_MIN_SPAN_KM = 0.5;
/** Longest side of the image made for the box, in pixels. */
export const SENTINEL_MAX_PX = 1600;
/** Tiles read for one image at most (each 0.2–1.5 MB; a 55 km box at 20 m needs about 30 small ones). */
export const SENTINEL_MAX_TILES = 36;
export const SENTINEL_SEARCH_DAYS = 45;

export type Box = [west: number, south: number, east: number, north: number];

export interface SentinelScene {
  id: string;
  datetime: string;
  cloudCover: number | null;
  epsg: number;
  /** Affine transform of the full-resolution image: [res, 0, x0, 0, -res, y0]. */
  transform: [number, number, number, number, number, number];
  shape: [number, number];
  href: string;
  previewHref: string | null;
  platform: string | null;
}

const KM_PER_DEG = 111.32;

/** Box size in kilometres (east–west measured at the box's middle latitude). */
export function boxSpanKm(b: Box): { widthKm: number; heightKm: number } {
  const mid = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  return { widthKm: (b[2] - b[0]) * KM_PER_DEG * Math.cos(mid), heightKm: (b[3] - b[1]) * KM_PER_DEG };
}

/** Why a box cannot be used, or null. Boxes crossing the date line or reaching past ±82° are refused. */
export function boxProblem(b: Box): string | null {
  if (!b.every(Number.isFinite)) return 'The box is not a valid area.';
  if (b[0] >= b[2] || b[1] >= b[3]) return 'Draw the box without crossing the date line.';
  if (b[0] < -180 || b[2] > 180 || b[1] < -82 || b[3] > 82) return 'Sentinel-2 covers land between about 82° south and 82° north.';
  const { widthKm, heightKm } = boxSpanKm(b);
  if (Math.max(widthKm, heightKm) > SENTINEL_MAX_SPAN_KM) return `The box is ${Math.round(Math.max(widthKm, heightKm))} km across; draw one under ${SENTINEL_MAX_SPAN_KM} km.`;
  if (Math.max(widthKm, heightKm) < SENTINEL_MIN_SPAN_KM) return 'The box is too small; draw one at least 500 m across.';
  return null;
}

export function stacSearchBody(b: Box, now: Date, maxCloud: number): string {
  const from = new Date(now.getTime() - SENTINEL_SEARCH_DAYS * 86_400_000).toISOString();
  return JSON.stringify({
    collections: ['sentinel-2-l2a'],
    bbox: b.map((v) => Number(v.toFixed(6))),
    datetime: `${from}/${now.toISOString()}`,
    limit: 20,
    query: { 'eo:cloud_cover': { lt: Math.max(1, Math.min(100, Math.round(maxCloud))) } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    fields: { include: ['id', 'bbox', 'properties.datetime', 'properties.eo:cloud_cover', 'properties.proj:epsg', 'properties.proj:code', 'properties.platform', 'assets.visual', 'assets.thumbnail'], exclude: ['links'] },
  });
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Scenes from a STAC search reply. Files outside the Sentinel-2 COG bucket are refused. */
export function parseStacScenes(body: unknown): { scenes: SentinelScene[]; skipped: number } {
  const b = obj(body);
  if (!b || !Array.isArray(b.features)) throw new Error('Unexpected reply from Earth Search');
  const scenes: SentinelScene[] = [];
  let skipped = 0;
  for (const f of b.features) {
    const fo = obj(f);
    const p = obj(fo?.properties);
    const visual = obj(obj(fo?.assets)?.visual);
    const thumb = obj(obj(fo?.assets)?.thumbnail);
    const id = typeof fo?.id === 'string' && /^[A-Za-z0-9_]{5,80}$/.test(fo.id) ? fo.id : null;
    const epsgRaw = p?.['proj:epsg'] ?? (typeof p?.['proj:code'] === 'string' ? Number(String(p['proj:code']).replace('EPSG:', '')) : null);
    const epsg = typeof epsgRaw === 'number' ? epsgRaw : null;
    const transform = visual?.['proj:transform'];
    const shape = visual?.['proj:shape'];
    const href = typeof visual?.href === 'string' && visual.href.startsWith(SENTINEL_COG_PREFIX) && visual.href.endsWith('/TCI.tif') ? visual.href : null;
    const datetime = typeof p?.datetime === 'string' && Number.isFinite(Date.parse(p.datetime)) ? new Date(Date.parse(p.datetime)).toISOString() : null;
    const okTransform = Array.isArray(transform) && transform.length >= 6 && transform.slice(0, 6).every((v) => typeof v === 'number' && Number.isFinite(v)) && transform[0] > 0 && transform[4] < 0;
    const okShape = Array.isArray(shape) && shape.length === 2 && shape.every((v) => Number.isInteger(v) && v > 0 && v <= 20_000);
    if (!id || !epsg || !utmZoneFromEpsg(epsg) || !href || !datetime || !okTransform || !okShape) { skipped++; continue; }
    const cc = p?.['eo:cloud_cover'];
    const prev = typeof thumb?.href === 'string' && thumb.href.startsWith(SENTINEL_COG_PREFIX) ? thumb.href : null;
    scenes.push({
      id,
      datetime,
      cloudCover: typeof cc === 'number' && Number.isFinite(cc) ? Math.round(cc * 10) / 10 : null,
      epsg,
      transform: transform.slice(0, 6) as SentinelScene['transform'],
      shape: shape as [number, number],
      href,
      previewHref: prev,
      platform: typeof p?.platform === 'string' ? p.platform.slice(0, 20) : null,
    });
  }
  return { scenes, skipped };
}

/** One overview level of the file as read from its header. */
export interface TiffLevel {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  offsets: number[];
  counts: number[];
}

export interface RenderPlan {
  level: number;
  /** Size of one pixel of that level in metres. */
  pixelM: number;
  outWidth: number;
  outHeight: number;
  /** Tile indexes (row-major) to read. */
  tiles: number[];
  zone: UtmZone;
}

/** Corner and edge points of a box in the scene's projection. */
function boxUtm(b: Box, zone: UtmZone): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    if (i !== 0 && i !== 4 && j !== 0 && j !== 4) continue;
    pts.push(toUtm(b[0] + ((b[2] - b[0]) * i) / 4, b[1] + ((b[3] - b[1]) * j) / 4, zone));
  }
  return pts;
}

/**
 * Picks the coarsest overview that still gives about one source pixel per output pixel, the output size (same
 * ground distance per pixel east–west and north–south) and the tiles under the box. Null when the box misses the
 * scene or would need too many tiles.
 */
export function planRender(scene: SentinelScene, levels: TiffLevel[], b: Box, maxPx = SENTINEL_MAX_PX): RenderPlan | null {
  const zone = utmZoneFromEpsg(scene.epsg);
  if (!zone || levels.length === 0) return null;
  const [res, , x0, , , y0] = scene.transform;
  const extentX = res * scene.shape[1];
  const pts = boxUtm(b, zone);
  const minE = Math.min(...pts.map((p) => p[0])), maxE = Math.max(...pts.map((p) => p[0]));
  const minN = Math.min(...pts.map((p) => p[1])), maxN = Math.max(...pts.map((p) => p[1]));
  if (maxE < x0 || minE > x0 + extentX || maxN < y0 - res * scene.shape[0] || minN > y0) return null;
  const { widthKm, heightKm } = boxSpanKm(b);
  const longestM = Math.max(widthKm, heightKm) * 1000;
  let level = 0;
  while (level < levels.length - 1 && longestM / (extentX / levels[level + 1].width) >= maxPx) level++;
  const L = levels[level];
  const pixelM = extentX / L.width;
  const scale = Math.min(1, maxPx / (longestM / pixelM));
  const outWidth = Math.max(16, Math.round(((widthKm * 1000) / pixelM) * scale));
  const outHeight = Math.max(16, Math.round(((heightKm * 1000) / pixelM) * scale));
  const col0 = Math.max(0, Math.floor((minE - x0) / pixelM)), col1 = Math.min(L.width - 1, Math.floor((maxE - x0) / pixelM));
  const row0 = Math.max(0, Math.floor((y0 - maxN) / pixelM)), row1 = Math.min(L.height - 1, Math.floor((y0 - minN) / pixelM));
  const across = Math.ceil(L.width / L.tileWidth);
  const tiles: number[] = [];
  for (let ty = Math.floor(row0 / L.tileHeight); ty <= Math.floor(row1 / L.tileHeight); ty++)
    for (let tx = Math.floor(col0 / L.tileWidth); tx <= Math.floor(col1 / L.tileWidth); tx++) tiles.push(ty * across + tx);
  if (tiles.length === 0 || tiles.length > SENTINEL_MAX_TILES) return null;
  return { level, pixelM, outWidth, outHeight, tiles, zone };
}

/**
 * Builds the RGBA image for the box from decoded tiles (each tileWidth × tileHeight × 3 bytes). Each output pixel is
 * the nearest source pixel; pixels outside the scene, or with no data (0,0,0), are transparent. North is up.
 */
export function resampleToBox(scene: SentinelScene, L: TiffLevel, plan: RenderPlan, tiles: Map<number, Uint8Array>, b: Box): Uint8Array {
  const out = new Uint8Array(plan.outWidth * plan.outHeight * 4);
  const [, , x0, , , y0] = scene.transform;
  const across = Math.ceil(L.width / L.tileWidth);
  for (let j = 0; j < plan.outHeight; j++) {
    const lat = b[3] - ((j + 0.5) / plan.outHeight) * (b[3] - b[1]);
    for (let i = 0; i < plan.outWidth; i++) {
      const lon = b[0] + ((i + 0.5) / plan.outWidth) * (b[2] - b[0]);
      const [e, n] = toUtm(lon, lat, plan.zone);
      const col = Math.floor((e - x0) / plan.pixelM), row = Math.floor((y0 - n) / plan.pixelM);
      if (col < 0 || row < 0 || col >= L.width || row >= L.height) continue;
      const t = tiles.get(Math.floor(row / L.tileHeight) * across + Math.floor(col / L.tileWidth));
      if (!t) continue;
      const k = ((row % L.tileHeight) * L.tileWidth + (col % L.tileWidth)) * 3;
      const r = t[k], g = t[k + 1], bl = t[k + 2];
      if (r === 0 && g === 0 && bl === 0) continue;
      const o = (j * plan.outWidth + i) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255;
    }
  }
  return out;
}

/** Undoes TIFF horizontal differencing (predictor 2) for 8-bit interleaved samples, in place. */
export function undoHorizontalPredictor(data: Uint8Array, width: number, height: number, samples: number): void {
  const row = width * samples;
  for (let y = 0; y < height; y++) {
    const base = y * row;
    for (let x = samples; x < row; x++) data[base + x] = (data[base + x] + data[base + x - samples]) & 0xff;
  }
}

/** Reads the image directories of a classic little- or big-endian TIFF header. BigTIFF is refused. */
export function parseTiffLevels(buf: Uint8Array): { levels: TiffLevel[]; compression: number; predictor: number; samples: number; bits: number } {
  if (buf.length < 16) throw new Error('The image header is too short.');
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  if (!le && !(buf[0] === 0x4d && buf[1] === 0x4d)) throw new Error('Not a TIFF file.');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error('Only classic TIFF files are supported.');
  const levels: TiffLevel[] = [];
  let compression = 0, predictor = 1, samples = 0, bits = 0;
  let off = u32(4);
  for (let guard = 0; off && guard < 12; guard++) {
    if (off + 2 > buf.length) throw new Error('The image header is longer than the part read.');
    const n = u16(off);
    if (off + 2 + n * 12 + 4 > buf.length) throw new Error('The image header is longer than the part read.');
    const tags = new Map<number, number[]>();
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = type === 3 ? 2 : type === 4 ? 4 : 0;
      if (!size || count > 100_000) continue;
      const at = count * size <= 4 ? e + 8 : u32(e + 8);
      if (at + count * size > buf.length) throw new Error('The image header is longer than the part read.');
      const vals: number[] = [];
      for (let c = 0; c < count; c++) vals.push(size === 2 ? u16(at + c * 2) : u32(at + c * 4));
      tags.set(tag, vals);
    }
    const one = (t: number) => tags.get(t)?.[0] ?? 0;
    const level: TiffLevel = { width: one(256), height: one(257), tileWidth: one(322), tileHeight: one(323), offsets: tags.get(324) ?? [], counts: tags.get(325) ?? [] };
    if (!level.width || !level.tileWidth || level.offsets.length !== level.counts.length || level.offsets.length !== Math.ceil(level.width / level.tileWidth) * Math.ceil(level.height / level.tileHeight)) throw new Error('The image is not a tiled TIFF.');
    if (levels.length === 0) { compression = one(259); predictor = one(317) || 1; samples = one(277); bits = tags.get(258)?.[0] ?? 0; }
    levels.push(level);
    off = u32(off + 2 + n * 12);
  }
  return { levels, compression, predictor, samples, bits };
}
