// Recent Sentinel-2 imagery for a drawn box: scene search (Earth Search STAC) and a north-up true-colour PNG cut
// from the scene's cloud-optimised GeoTIFF. Only the header and the tiles under the box are downloaded.

import { inflateSync, deflateSync } from 'node:zlib';
import {
  boxProblem, parseStacScenes, parseTiffLevels, planRender, resampleToBox, SENTINEL_STAC_URL, stacSearchBody, undoHorizontalPredictor,
  type Box, type SentinelScene, type TiffLevel,
} from '../shared/sentinel';
import type { FetchBytes, FetchJson } from './feeds/http';

const HEADER_BYTES = 64 * 1024;
const MAX_TILE_BYTES = 6 * 1024 * 1024;

export interface SentinelImage {
  sceneId: string;
  datetime: string;
  cloudCover: number | null;
  box: Box;
  width: number;
  height: number;
  /** Metres on the ground per source pixel used. */
  pixelM: number;
  png: Uint8Array;
}

export class SentinelService {
  /** Scenes from the latest searches, so a render request names a scene by id only. */
  private scenes = new Map<string, SentinelScene>();
  private headers = new Map<string, ReturnType<typeof parseTiffLevels>>();

  constructor(private readonly fetchJson: FetchJson, private readonly fetchBytes: FetchBytes, private readonly userAgent: string) {}

  async search(box: Box, maxCloud: number, now = new Date()): Promise<{ scenes: Omit<SentinelScene, 'transform' | 'shape' | 'href'>[]; skipped: number }> {
    const problem = boxProblem(box);
    if (problem) throw new Error(problem);
    const res = await this.fetchJson(SENTINEL_STAC_URL, {
      method: 'POST',
      body: stacSearchBody(box, now, maxCloud),
      headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json', 'User-Agent': this.userAgent },
      timeoutMs: 30_000,
      maxBytes: 4 * 1024 * 1024,
    });
    const { scenes, skipped } = parseStacScenes(res.body);
    for (const s of scenes) this.scenes.set(s.id, s);
    while (this.scenes.size > 200) this.scenes.delete(this.scenes.keys().next().value as string);
    return { scenes: scenes.map(({ transform: _t, shape: _s, href: _h, ...rest }) => rest), skipped };
  }

  async render(sceneId: string, box: Box): Promise<SentinelImage> {
    const problem = boxProblem(box);
    if (problem) throw new Error(problem);
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error('Search again: that scene is no longer in the list.');
    let header = this.headers.get(scene.id);
    if (!header) {
      const h = await this.fetchBytes(scene.href, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}`, 'User-Agent': this.userAgent }, timeoutMs: 30_000, maxBytes: HEADER_BYTES + 1024 });
      header = parseTiffLevels(h.bytes);
      if (header.compression !== 8 || header.samples !== 3 || header.bits !== 8) throw new Error('This scene is stored in a format the app does not read.');
      this.headers.set(scene.id, header);
      while (this.headers.size > 20) this.headers.delete(this.headers.keys().next().value as string);
    }
    const plan = planRender(scene, header.levels, box);
    if (!plan) throw new Error('The box is outside this scene, or too large for one image.');
    const L: TiffLevel = header.levels[plan.level];
    const tiles = new Map<number, Uint8Array>();
    // A few tiles at a time: the bucket is fast and the box needs at most a couple of dozen.
    for (let i = 0; i < plan.tiles.length; i += 4) {
      await Promise.all(plan.tiles.slice(i, i + 4).map(async (t) => {
        const off = L.offsets[t], len = L.counts[t];
        if (!len) return; // an empty tile has no data
        if (len > MAX_TILE_BYTES) throw new Error('An image tile is larger than expected.');
        const r = await this.fetchBytes(scene.href, { headers: { Range: `bytes=${off}-${off + len - 1}`, 'User-Agent': this.userAgent }, timeoutMs: 45_000, maxBytes: len + 1024 });
        if (r.bytes.length !== len) throw new Error('The image server returned a different part of the file.');
        const raw = new Uint8Array(inflateSync(r.bytes));
        if (raw.length !== L.tileWidth * L.tileHeight * 3) throw new Error('An image tile did not decode to the expected size.');
        if (header!.predictor === 2) undoHorizontalPredictor(raw, L.tileWidth, L.tileHeight, 3);
        tiles.set(t, raw);
      }));
    }
    const rgba = resampleToBox(scene, L, plan, tiles, box);
    return { sceneId: scene.id, datetime: scene.datetime, cloudCover: scene.cloudCover, box, width: plan.outWidth, height: plan.outHeight, pixelM: Math.round(plan.pixelM), png: encodePng(rgba, plan.outWidth, plan.outHeight) };
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal RGBA PNG writer (8-bit, no filtering): enough for one generated image. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const head = new Uint8Array(8);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, data.length);
    const name = new TextEncoder().encode(type);
    head.set(name, 4);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, crc32([name, data]));
    return [head, data, crc];
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(deflateSync(raw))), ...chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
