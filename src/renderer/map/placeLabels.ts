import { prof, profAdd } from '../lib/prof';
// Place, water and street labels as screen-space Cesium labels with a real
// label hierarchy and collision handling.
//
// Before (v0.3.x) every place name was drawn into each raster tile. Tiles
// cannot see each other's labels, so names overlapped across tile edges, every
// village appeared at once, and in tilted views distant tiles squeezed their
// text into unreadable bands. Now:
//   * names come from the same OpenMapTiles vector tiles (OpenStreetMap data),
//   * each name has a priority (class, OSM rank, capital status),
//   * zoom (tile level) and camera distance limits decide which classes may show,
//   * a greedy screen-space collision pass keeps the most important names,
//     with a bonus for names already on screen (no flicker),
//   * names below the horizon are hidden, and labels fade in and out.
// Raster tiles no longer contain any text (see vectorTiles.ts drawTile).

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  EllipsoidalOccluder,
  HorizontalOrigin,
  LabelCollection,
  LabelStyle,
  Math as CMath,
  NearFarScalar,
  sampleTerrain,
  SceneTransforms,
  VerticalOrigin,
  type CesiumWidget,
  type Label,
} from 'cesium';
import { loadVectorTile } from './vectorTiles';

export type GeoLabelLevel = 'off' | 'minimal' | 'standard' | 'detailed';
export interface LabelOptions {
  level: GeoLabelLevel;
  streets: boolean;
  density: 'low' | 'medium' | 'high';
  size: 'small' | 'medium' | 'large';
  language: 'english' | 'local';
}
export const DEFAULT_LABEL_OPTIONS: LabelOptions = { level: 'standard', streets: true, density: 'medium', size: 'medium', language: 'english' };

const FONT_STACK = '"Segoe UI", "Microsoft YaHei UI", "Yu Gothic UI", "Malgun Gothic", "Nirmala UI", "Segoe UI Historic", sans-serif';
const MAX_TILES = 24;

type Kind = 'country' | 'state' | 'capital' | 'city' | 'town' | 'village' | 'suburb' | 'neighbourhood' | 'sea' | 'lake' | 'road';

interface Candidate {
  key: string;
  text: string;
  kind: Kind;
  rank: number;
  lon: number;
  lat: number;
}

interface Placed {
  c: Candidate;
  label: Label;
  width: number;
  height: number;
  alpha: number;
  target: number;
  tiles: Set<string>;
}

/** Earliest tile level at which a class may appear, per label level ('off' never). */
const MIN_LEVEL: Record<Exclude<GeoLabelLevel, 'off'>, Partial<Record<Kind, number>>> = {
  minimal: { country: 2, capital: 3, city: 6, sea: 3, town: 11, suburb: 14 },
  standard: { country: 2, state: 4, capital: 3, city: 5, sea: 3, town: 9, lake: 9, suburb: 13, road: 14 },
  detailed: { country: 1, state: 4, capital: 2, city: 4, sea: 3, town: 8, lake: 7, village: 11, suburb: 12, neighbourhood: 14, road: 14 },
};
/** Classes that stop appearing when zoomed in past this level (country names at street level are noise). */
const MAX_LEVEL: Partial<Record<Kind, number>> = { country: 7, state: 9, sea: 10 };
/** Furthest camera distance (km) at which a class is labelled; tilted views keep small names near the camera only. */
const MAX_DIST_KM: Record<Kind, number> = { country: 1e9, state: 4000, capital: 1e9, city: 2500, sea: 1e9, town: 350, lake: 400, village: 70, suburb: 40, neighbourhood: 12, road: 4 };
const BASE_PRIORITY: Record<Kind, number> = { country: 1000, capital: 900, sea: 820, state: 760, city: 700, town: 500, lake: 450, village: 300, suburb: 280, neighbourhood: 180, road: 120 };
const SIZE: Record<Kind, number> = { country: 13, capital: 13, city: 12.5, state: 11, sea: 11.5, town: 11.5, lake: 10.5, village: 10.5, suburb: 10.5, neighbourhood: 10, road: 10 };
const MAX_VISIBLE = { low: 35, medium: 60, high: 110 };

function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const la = Math.max(-85.05, Math.min(85.05, lat));
  const r = (la * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [((x % n) + n) % n, Math.max(0, Math.min(n - 1, y))];
}
function toLonLat(z: number, tx: number, ty: number, px: number, py: number, ext: number): [number, number] {
  const n = 2 ** z;
  const lon = ((tx + px / ext) / n) * 360 - 180;
  const yy = (ty + py / ext) / n;
  return [lon, (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI];
}

function pickName(p: Record<string, unknown>, language: LabelOptions['language']): string | null {
  const v = language === 'english' ? (p['name:en'] ?? p['name:latin'] ?? p.name) : (p.name ?? p['name:latin']);
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null;
}

/** Pure ranking helper (exported for tests): priority of a candidate, higher wins. */
export function labelPriority(kind: Kind, rank: number): number {
  return BASE_PRIORITY[kind] - Math.min(20, Math.max(0, rank)) * 8;
}

/** Pure collision helper (exported for tests): greedy placement of boxes by priority. */
export function placeBoxes<T extends { x: number; y: number; w: number; h: number; p: number }>(items: T[], max: number, pad = 4): Set<T> {
  const placed: T[] = [];
  const out = new Set<T>();
  for (const it of [...items].sort((a, b) => b.p - a.p)) {
    if (placed.length >= max) break;
    const hit = placed.some((o) => Math.abs(o.x - it.x) * 2 < o.w + it.w + pad * 2 && Math.abs(o.y - it.y) * 2 < o.h + it.h + pad * 2);
    if (hit) continue;
    placed.push(it);
    out.add(it);
  }
  return out;
}

export class PlaceLabelManager {
  private readonly labels: LabelCollection;
  private readonly placed = new Map<string, Placed>();
  private readonly tileCands = new Map<string, Candidate[]>();
  private opts: LabelOptions = { ...DEFAULT_LABEL_OPTIONS };
  private level = 3;
  private loadSeq = 0;
  private lastCam = new Cartesian3();
  private lastLayout = 0;
  private animating = false;
  private readonly measure = new OffscreenCanvas(8, 8).getContext('2d')!;
  stats = { candidates: 0, visible: 0, tiles: 0, level: 0 };

  constructor(private readonly widget: CesiumWidget) {
    this.labels = widget.scene.primitives.add(new LabelCollection());
    widget.scene.postRender.addEventListener(() => this.frame());
  }

  setOptions(o: LabelOptions): void {
    const rebuild = o.language !== this.opts.language || o.size !== this.opts.size;
    this.opts = { ...o };
    if (rebuild) {
      this.labels.removeAll();
      this.placed.clear();
      this.tileCands.clear();
    }
    this.refresh();
  }

  /** Reload label tiles for the current view (call when the camera settles). */
  refresh(): void {
    const seq = ++this.loadSeq;
    const w = this.widget;
    if (this.opts.level === 'off') {
      for (const p of this.placed.values()) p.target = 0;
      this.kick();
      return;
    }
    const c = w.camera.positionCartographic;
    const ground = w.scene.globe.getHeight(c) ?? 0;
    const h = Math.max(50, c.height - Math.max(0, ground));
    let z = Math.max(1, Math.min(14, Math.floor(Math.log2(3.0e7 / h))));
    this.level = z;
    const center = w.camera.pickEllipsoid(new Cartesian2(w.scene.canvas.clientWidth / 2, w.scene.canvas.clientHeight / 2));
    const cc = center ? Cartographic.fromCartesian(center) : c;
    const clon = CMath.toDegrees(cc.longitude);
    const clat = CMath.toDegrees(cc.latitude);
    const want = new Set<string>();
    // Near the view center at the full level (3×3), then the visible area at a level that keeps the tile count bounded.
    const [cx, cy] = tileXY(clon, clat, z);
    const n = 2 ** z;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (cy + dy >= 0 && cy + dy < n) want.add(`${z}/${(((cx + dx) % n) + n) % n}/${cy + dy}`);
    const rect = w.camera.computeViewRectangle();
    if (rect) {
      let zz = z;
      for (; zz >= 1; zz--) {
        const [x0, y0] = tileXY(CMath.toDegrees(rect.west), CMath.toDegrees(rect.north), zz);
        const [x1, y1] = tileXY(CMath.toDegrees(rect.east), CMath.toDegrees(rect.south), zz);
        const nn = 2 ** zz;
        const wx = x1 >= x0 ? x1 - x0 + 1 : nn - x0 + x1 + 1;
        if (wx * (y1 - y0 + 1) <= MAX_TILES) {
          for (let i = 0; i < wx; i++) for (let y = y0; y <= y1; y++) want.add(`${zz}/${(x0 + i) % nn}/${y}`);
          break;
        }
      }
    }
    this.stats.level = z;
    this.stats.tiles = want.size;
    void Promise.all(
      [...want].map(async (key) => {
        if (!this.tileCands.has(key)) this.tileCands.set(key, await this.loadTile(key).catch(() => []));
      }),
    ).then(() => {
      if (seq !== this.loadSeq) return;
      this.sync(want);
    });
  }

  private async loadTile(key: string): Promise<Candidate[]> {
    const [z, x, y] = key.split('/').map(Number);
    const vt = await loadVectorTile(z, x, y);
    const tL = performance.now();
    const out: Candidate[] = [];
    const lang = this.opts.language;
    const place = vt.layers.place;
    if (place)
      for (let i = 0; i < place.length; i++) {
        const f = place.feature(i);
        if (f.type !== 1) continue;
        const p = f.properties;
        const text = pickName(p, lang);
        if (!text) continue;
        const cls = String(p.class ?? '');
        const capital = Number(p.capital) === 2;
        const kind: Kind | null =
          cls === 'country' ? 'country' : cls === 'state' || cls === 'province' ? 'state' : cls === 'city' ? (capital ? 'capital' : 'city') : cls === 'town' ? 'town' : cls === 'village' ? 'village' : cls === 'suburb' || cls === 'quarter' || cls === 'borough' ? 'suburb' : cls === 'neighbourhood' ? 'neighbourhood' : null;
        if (!kind) continue;
        const pt = f.loadGeometry()[0][0];
        const [lon, lat] = toLonLat(z, x, y, pt.x, pt.y, place.extent);
        out.push({ key: `${kind}|${text}|${lon.toFixed(2)}|${lat.toFixed(2)}`, text, kind, rank: Number(p.rank ?? 10), lon, lat });
      }
    const wn = vt.layers.water_name;
    if (wn)
      for (let i = 0; i < wn.length; i++) {
        const f = wn.feature(i);
        if (f.type !== 1) continue;
        const text = pickName(f.properties, lang);
        if (!text) continue;
        const cls = String(f.properties.class ?? '');
        const kind: Kind = cls === 'ocean' || cls === 'sea' || cls === 'bay' || cls === 'strait' ? 'sea' : 'lake';
        const pt = f.loadGeometry()[0][0];
        const [lon, lat] = toLonLat(z, x, y, pt.x, pt.y, wn.extent);
        out.push({ key: `${kind}|${text}|${lon.toFixed(1)}|${lat.toFixed(1)}`, text, kind, rank: cls === 'ocean' ? 0 : 5, lon, lat });
      }
    const tn = z >= 14 ? vt.layers.transportation_name : undefined;
    if (tn) {
      const seen = new Set<string>();
      for (let i = 0; i < tn.length; i++) {
        const f = tn.feature(i);
        if (f.type !== 2) continue;
        const text = pickName(f.properties, lang);
        if (!text || seen.has(text)) continue;
        const line = f.loadGeometry()[0];
        if (line.length < 2) continue;
        seen.add(text);
        const cls = String(f.properties.class ?? '');
        const mid = line[Math.floor(line.length / 2)];
        const [lon, lat] = toLonLat(z, x, y, mid.x, mid.y, tn.extent);
        out.push({ key: `road|${text}|${x}|${y}`, text, kind: 'road', rank: cls === 'primary' || cls === 'trunk' || cls === 'motorway' ? 2 : cls === 'secondary' ? 5 : 9, lon, lat });
      }
    }
    profAdd('labels.parse', performance.now() - tL);
    return out;
  }

  private allowed(c: Candidate): boolean {
    if (this.opts.level === 'off') return false;
    if (c.kind === 'road' && !this.opts.streets) return false;
    const min = MIN_LEVEL[this.opts.level][c.kind];
    if (min === undefined || this.level < min) return false;
    if (this.level > (MAX_LEVEL[c.kind] ?? 99)) return false;
    // Large cities earlier than small ones: OSM rank 1–3 cities appear two levels sooner.
    if (c.kind === 'city' && c.rank > 6 && this.level < min + 2) return false;
    return true;
  }

  private sync(want: Set<string>): void {
    prof('labels.sync', () => this.syncImpl(want));
  }
  private syncImpl(want: Set<string>): void {
    const scale = this.opts.size === 'small' ? 0.88 : this.opts.size === 'large' ? 1.18 : 1;
    const active = new Map<string, { c: Candidate; tiles: Set<string> }>();
    for (const key of want)
      for (const c of this.tileCands.get(key) ?? [])
        if (this.allowed(c)) {
          const a = active.get(c.key);
          if (a) a.tiles.add(key);
          else active.set(c.key, { c, tiles: new Set([key]) });
        }
    this.stats.candidates = active.size;
    for (const [k, p] of this.placed)
      if (!active.has(k)) {
        p.target = 0;
        p.tiles = new Set();
      }
    const newOnes: Placed[] = [];
    for (const [k, { c, tiles }] of active) {
      const ex = this.placed.get(k);
      if (ex) {
        ex.tiles = tiles;
        continue;
      }
      const size = SIZE[c.kind] * scale;
      const weight = c.kind === 'country' || c.kind === 'capital' || c.kind === 'city' ? 600 : c.kind === 'state' || c.kind === 'sea' ? 500 : 500;
      const text = c.kind === 'country' || c.kind === 'state' ? c.text.toLocaleUpperCase() : c.text;
      const font = `${c.kind === 'sea' || c.kind === 'lake' ? 'italic ' : ''}${weight} ${size.toFixed(1)}px ${FONT_STACK}`;
      this.measure.font = font;
      const width = this.measure.measureText(text).width + (c.kind === 'country' || c.kind === 'state' ? text.length * 1.2 : 0);
      const color = c.kind === 'sea' || c.kind === 'lake' ? Color.fromCssColorString('#bfe1ff') : c.kind === 'road' ? Color.fromCssColorString('#f3e7c8') : c.kind === 'state' ? Color.fromCssColorString('#d9d2ec') : Color.WHITE;
      const label = this.labels.add({
        position: Cartesian3.fromDegrees(c.lon, c.lat, 0),
        text,
        font,
        fillColor: color.withAlpha(0),
        outlineColor: Color.fromCssColorString('#06090d').withAlpha(0),
        outlineWidth: 2.5,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        // Horizon and globe occlusion are handled in layout(); terrain must not clip names on hillsides.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new NearFarScalar(1e5, 1, 2e7, 0.85),
        show: false,
      });
      const p: Placed = { c, label, width, height: size * 1.35, alpha: 0, target: 0, tiles };
      (label as unknown as { _atlasColor: Color })._atlasColor = color;
      this.placed.set(k, p);
      newOnes.push(p);
    }
    void this.groundHeights(newOnes);
    this.lastLayout = 0;
    this.layout();
  }

  /** Lift labels to the terrain surface so they sit on their place in tilted views. */
  private async groundHeights(items: Placed[]): Promise<void> {
    if (!items.length) return;
    try {
      const carto = items.map((p) => Cartographic.fromDegrees(p.c.lon, p.c.lat));
      // Country-scale labels use overview terrain too. The old minimum of L6
      // pulled remote height and coastline tiles for offscreen place names.
      const res = await sampleTerrain(this.widget.terrainProvider, Math.min(11, this.level), carto);
      res.forEach((r, i) => {
        if (Number.isFinite(r.height) && r.height > 0 && !items[i].label.isDestroyed?.()) items[i].label.position = Cartesian3.fromDegrees(items[i].c.lon, items[i].c.lat, r.height + 15);
      });
      this.kick();
    } catch {
      // keep sea-level positions
    }
  }

  private kick(): void {
    this.lastLayout = 0;
    this.widget.scene.requestRender();
  }

  private frame(): void {
    const cam = this.widget.camera.positionWC;
    const moved = !Cartesian3.equalsEpsilon(cam, this.lastCam, 0, 0.5);
    const now = performance.now();
    if (moved || this.lastLayout === 0) {
      if (now - this.lastLayout > 90) {
        Cartesian3.clone(cam, this.lastCam);
        this.layout();
        this.lastLayout = now;
      } else this.animating = true;
    }
    this.animate();
  }

  /** Screen-space collision and visibility decisions. */
  private layout(): void {
    prof('labels.layout', () => this.layoutImpl());
  }
  private layoutImpl(): void {
    const scene = this.widget.scene;
    const camPos = this.widget.camera.positionWC;
    const occ = new EllipsoidalOccluder(Ellipsoid.WGS84, camPos);
    const W = scene.canvas.clientWidth;
    const H = scene.canvas.clientHeight;
    const items: { x: number; y: number; w: number; h: number; p: number; pl: Placed }[] = [];
    const win = new Cartesian2();
    for (const pl of this.placed.values()) {
      if (pl.target === 0 && !this.allowedNow(pl)) continue;
      if (!this.allowedNow(pl)) {
        pl.target = 0;
        continue;
      }
      const pos = pl.label.position;
      const distKm = Cartesian3.distance(camPos, pos) / 1000;
      if (distKm > MAX_DIST_KM[pl.c.kind] || !occ.isPointVisible(pos) || !SceneTransforms.worldToWindowCoordinates(scene, pos, win)) {
        pl.target = 0;
        continue;
      }
      if (win.x < -40 || win.y < -20 || win.x > W + 40 || win.y > H + 20) {
        pl.target = 0;
        continue;
      }
      const sc = 1 - Math.min(0.15, Math.max(0, (distKm - 100) / 20000) * 0.15);
      items.push({ x: win.x, y: win.y, w: pl.width * sc, h: pl.height * sc, p: labelPriority(pl.c.kind, pl.c.rank) + (pl.target > 0 ? 40 : 0) - distKm * 0.002, pl });
    }
    const max = Math.round(MAX_VISIBLE[this.opts.density] * (this.opts.level === 'minimal' ? 0.5 : this.opts.level === 'detailed' ? 1.25 : 1));
    const keep = placeBoxes(items, max, 5);
    for (const it of items) it.pl.target = keep.has(it) ? 1 : 0;
    this.stats.visible = keep.size;
    this.animating = true;
  }

  private allowedNow(pl: Placed): boolean {
    return this.allowed(pl.c) && pl.tiles.size > 0 && this.opts.level !== 'off';
  }

  private animate(): void {
    if (!this.animating) return;
    let busy = false;
    for (const [k, p] of this.placed) {
      if (p.alpha !== p.target) {
        p.alpha = p.target > p.alpha ? Math.min(1, p.alpha + 0.25) : Math.max(0, p.alpha - 0.34);
        busy = true;
        const base = (p.label as unknown as { _atlasColor: Color })._atlasColor;
        p.label.fillColor = base.withAlpha(p.alpha);
        p.label.outlineColor = Color.fromCssColorString('#06090d').withAlpha(p.alpha * 0.85);
        p.label.show = p.alpha > 0.01;
      }
      // Drop labels that are fully faded and no longer in any loaded tile.
      if (p.alpha === 0 && p.target === 0 && !this.allowedNow(p)) {
        this.labels.remove(p.label);
        this.placed.delete(k);
      }
    }
    this.animating = busy;
    if (busy) this.widget.scene.requestRender();
  }

  destroy(): void {
    this.widget.scene.primitives.remove(this.labels);
    this.placed.clear();
  }
}
