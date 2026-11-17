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
//   * names below the horizon are hidden, and labels fade in and out,
//   * text size follows the zoom per class (countries largest when the whole country is in view, cities and towns
//     growing as you approach them), drawn at the largest size and scaled down so it stays sharp,
//   * street names run along their street (rotated to the road on screen, kept upright) and repeat on long roads.
// Raster tiles no longer contain any text (see vectorTiles.ts drawTile).

import {
  BillboardCollection,
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
  sampleTerrain,
  SceneTransforms,
  VerticalOrigin,
  type Billboard,
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

export type Kind = 'country' | 'state' | 'capital' | 'city' | 'town' | 'village' | 'suburb' | 'neighbourhood' | 'sea' | 'lake' | 'road';

interface Candidate {
  key: string;
  text: string;
  kind: Kind;
  rank: number;
  lon: number;
  lat: number;
  /** Streets: a second point along the road, giving the text direction. */
  lon2?: number;
  lat2?: number;
}

interface Placed {
  c: Candidate;
  /** Place and water names are labels; street names are rotated billboards. */
  label: Label | null;
  bb: Billboard | null;
  pos: Cartesian3;
  /** Current screen scale (zoom × distance) and base scale (font drawn at the class's largest size). */
  scale: number;
  base: number;
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
const SIZE: Record<Kind, number> = { country: 13, capital: 13, city: 12.5, state: 11, sea: 11.5, town: 11.5, lake: 10.5, village: 10.5, suburb: 10.5, neighbourhood: 10, road: 11 };
const MAX_VISIBLE = { low: 35, medium: 60, high: 110 };

/**
 * Text scale by class against the continuous zoom level (log2 of 30,000 km over the camera height): [zoom, scale]
 * stops, linear between them and flat beyond. Exported for tests.
 */
export const ZOOM_SCALE: Record<Kind, [number, number][]> = {
  country: [[2, 1.45], [4, 1.25], [6, 1.0], [8, 0.85]],
  state: [[4, 0.95], [6, 1.15], [8, 1.05], [10, 0.9]],
  capital: [[3, 0.9], [6, 1.05], [9, 1.3], [12, 1.45], [15, 1.2]],
  city: [[4, 0.85], [7, 1.0], [10, 1.25], [12, 1.4], [15, 1.15]],
  town: [[8, 0.88], [10, 1.0], [12, 1.2], [14, 1.3], [16, 1.1]],
  village: [[10, 0.88], [12, 1.0], [14, 1.2], [16, 1.1]],
  suburb: [[12, 0.9], [14, 1.08], [16, 1.15]],
  neighbourhood: [[13, 0.9], [15, 1.08]],
  sea: [[2, 1.25], [5, 1.05], [8, 0.95]],
  lake: [[7, 0.9], [11, 1.05], [14, 1.15]],
  road: [[14, 0.95], [16, 1.08], [18, 1.2]],
};
const MAX_SCALE = Object.fromEntries(Object.entries(ZOOM_SCALE).map(([k, s]) => [k, Math.max(...s.map((x) => x[1]))])) as Record<Kind, number>;

/** Interpolated text scale for a class at a continuous zoom level. */
export function zoomScale(kind: Kind, zoom: number): number {
  const s = ZOOM_SCALE[kind];
  if (zoom <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++)
    if (zoom <= s[i][0]) {
      const t = (zoom - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t;
    }
  return s[s.length - 1][1];
}

/** Screen angle (radians, counter-clockwise) that runs text along a direction while keeping it upright. */
export function uprightAngle(dx: number, dyDown: number): number {
  let a = Math.atan2(dyDown, dx); // clockwise on screen, y down
  if (a > Math.PI / 2) a -= Math.PI;
  else if (a < -Math.PI / 2) a += Math.PI;
  return -a;
}

/** Where street names go on a line (tile units): the middle, plus quarter points on long lines. */
export function streetLabelPoints(line: readonly { x: number; y: number }[], longUnits = 900): { at: { x: number; y: number }; next: { x: number; y: number } }[] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    seg.push(d);
    total += d;
  }
  if (!(total > 0)) return [];
  const fractions = total >= longUnits ? [0.2, 0.5, 0.8] : [0.5];
  return fractions.map((f) => {
    let want = f * total;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const t = seg[i] ? Math.min(1, want / seg[i]) : 0;
        const a = line[i];
        const b = line[i + 1];
        return { at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, next: b.x === a.x && b.y === a.y ? { x: b.x + 1, y: b.y } : b };
      }
      want -= seg[i];
    }
    return { at: line[0], next: line[1] };
  });
}

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
  private readonly streets: BillboardCollection;
  private readonly streetImages = new Map<string, HTMLCanvasElement>();
  private zoom = 3;
  private readonly placed = new Map<string, Placed>();
  private readonly tileCands = new Map<string, Candidate[]>();
  private opts: LabelOptions = { ...DEFAULT_LABEL_OPTIONS };
  private level = 3;
  private groundH = 0;
  private loadSeq = 0;
  private lastCam = new Cartesian3();
  private lastLayout = 0;
  private animating = false;
  private readonly measure = new OffscreenCanvas(8, 8).getContext('2d')!;
  stats = { candidates: 0, visible: 0, tiles: 0, level: 0 };

  constructor(private readonly widget: CesiumWidget) {
    this.labels = widget.scene.primitives.add(new LabelCollection());
    this.streets = widget.scene.primitives.add(new BillboardCollection());
    widget.scene.postRender.addEventListener(() => this.frame());
  }

  setOptions(o: LabelOptions): void {
    const rebuild = o.language !== this.opts.language || o.size !== this.opts.size;
    this.opts = { ...o };
    if (rebuild) {
      this.labels.removeAll();
      this.streets.removeAll();
      this.streetImages.clear();
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
    this.groundH = ground;
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
      // Up to three placements per street name per tile; the collision pass keeps the ones that fit.
      const perName = new Map<string, number>();
      for (let i = 0; i < tn.length; i++) {
        const f = tn.feature(i);
        if (f.type !== 2) continue;
        const text = pickName(f.properties, lang);
        if (!text || (perName.get(text) ?? 0) >= 3) continue;
        const cls = String(f.properties.class ?? '');
        const rank = cls === 'primary' || cls === 'trunk' || cls === 'motorway' ? 2 : cls === 'secondary' ? 5 : cls === 'tertiary' ? 7 : 9;
        for (const line of f.loadGeometry()) {
          if (line.length < 2) continue;
          for (const pt of streetLabelPoints(line)) {
            const used = perName.get(text) ?? 0;
            if (used >= 3) break;
            // Skip points in the tile buffer: the neighbouring tile places those.
            if (pt.at.x < 0 || pt.at.y < 0 || pt.at.x > tn.extent || pt.at.y > tn.extent) continue;
            perName.set(text, used + 1);
            const [lon, lat] = toLonLat(z, x, y, pt.at.x, pt.at.y, tn.extent);
            const [lon2, lat2] = toLonLat(z, x, y, pt.next.x, pt.next.y, tn.extent);
            out.push({ key: `road|${text}|${lon.toFixed(5)}|${lat.toFixed(5)}`, text, kind: 'road', rank, lon, lat, lon2, lat2 });
          }
        }
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
      const base = 1 / MAX_SCALE[c.kind];
      const size = SIZE[c.kind] * scale * MAX_SCALE[c.kind];
      const weight = c.kind === 'country' || c.kind === 'capital' || c.kind === 'city' ? 600 : c.kind === 'state' || c.kind === 'sea' ? 500 : 500;
      const text = c.kind === 'country' || c.kind === 'state' ? c.text.toLocaleUpperCase() : c.text;
      const font = `${c.kind === 'sea' || c.kind === 'lake' ? 'italic ' : ''}${weight} ${size.toFixed(1)}px ${FONT_STACK}`;
      this.measure.font = font;
      const width = this.measure.measureText(text).width + (c.kind === 'country' || c.kind === 'state' ? text.length * 1.2 : 0);
      const color = c.kind === 'sea' || c.kind === 'lake' ? Color.fromCssColorString('#bfe1ff') : c.kind === 'road' ? Color.fromCssColorString('#f3e7c8') : c.kind === 'state' ? Color.fromCssColorString('#d9d2ec') : Color.WHITE;
      const pos = Cartesian3.fromDegrees(c.lon, c.lat, 0);
      if (c.kind === 'road') {
        const image = this.streetImage(text, font, color);
        const bb = this.streets.add({ position: pos, image, scale: base, color: Color.WHITE.withAlpha(0), alignedAxis: Cartesian3.ZERO, disableDepthTestDistance: Number.POSITIVE_INFINITY, show: false });
        const p: Placed = { c, label: null, bb, pos, scale: base, base, width: image.width, height: image.height, alpha: 0, target: 0, tiles };
        this.placed.set(k, p);
        newOnes.push(p);
        continue;
      }
      const label = this.labels.add({
        position: pos,
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
        scale: base,
        show: false,
      });
      const p: Placed = { c, label, bb: null, pos, scale: base, base, width, height: size * 1.35, alpha: 0, target: 0, tiles };
      (label as unknown as { _atlasColor: Color })._atlasColor = color;
      this.placed.set(k, p);
      newOnes.push(p);
    }
    void this.groundHeights(newOnes);
    this.lastLayout = 0;
    this.layout();
  }

  /** Street name drawn once per text (outlined, for any background); billboards reuse it. */
  private streetImage(text: string, font: string, color: Color): HTMLCanvasElement {
    const hit = this.streetImages.get(text);
    if (hit) return hit;
    this.measure.font = font;
    const w = Math.ceil(this.measure.measureText(text).width) + 8;
    const fontPx = Number(/([\d.]+)px/.exec(font)?.[1] ?? 12);
    const h = Math.ceil(fontPx * 1.5) + 4;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(6, 9, 13, 0.85)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color.toCssColorString();
    ctx.fillText(text, w / 2, h / 2);
    if (this.streetImages.size > 600) this.streetImages.clear();
    this.streetImages.set(text, canvas);
    return canvas;
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
        if (!Number.isFinite(r.height) || r.height <= 0) return;
        const it = items[i];
        if (this.placed.get(it.c.key) !== it) return; // removed meanwhile
        it.pos = Cartesian3.fromDegrees(it.c.lon, it.c.lat, r.height + (it.bb ? 3 : 15));
        if (it.label) it.label.position = it.pos;
        if (it.bb) it.bb.position = it.pos;
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
    const win2 = new Cartesian2();
    // Continuous zoom from the camera's height above the ground (the same measure that picks the tile level).
    const cam = this.widget.camera.positionCartographic;
    this.zoom = Math.max(0, Math.log2(3.0e7 / Math.max(20, cam.height - Math.max(0, this.groundH))));
    for (const pl of this.placed.values()) {
      if (pl.target === 0 && !this.allowedNow(pl)) continue;
      if (!this.allowedNow(pl)) {
        pl.target = 0;
        continue;
      }
      const pos = pl.pos;
      const distKm = Cartesian3.distance(camPos, pos) / 1000;
      if (distKm > MAX_DIST_KM[pl.c.kind] || !occ.isPointVisible(pos) || !SceneTransforms.worldToWindowCoordinates(scene, pos, win)) {
        pl.target = 0;
        continue;
      }
      if (win.x < -40 || win.y < -20 || win.x > W + 40 || win.y > H + 20) {
        pl.target = 0;
        continue;
      }
      // Zoom sets the size per class; far names in tilted views shrink a little more.
      const sc = zoomScale(pl.c.kind, this.zoom) * (1 - Math.min(0.15, Math.max(0, (distKm - 100) / 20000) * 0.15)) * pl.base;
      if (Math.abs(sc - pl.scale) > 0.004) {
        pl.scale = sc;
        if (pl.label) pl.label.scale = sc;
        if (pl.bb) pl.bb.scale = sc;
      }
      let w = pl.width * sc;
      let h = pl.height * sc;
      if (pl.bb && pl.c.lon2 !== undefined && pl.c.lat2 !== undefined) {
        // Along the street on screen, kept upright; the collision box is the rotated text's bounds.
        if (!SceneTransforms.worldToWindowCoordinates(scene, Cartesian3.fromDegrees(pl.c.lon2, pl.c.lat2, Cartographic.fromCartesian(pos).height), win2)) {
          pl.target = 0;
          continue;
        }
        const rot = uprightAngle(win2.x - win.x, win2.y - win.y);
        pl.bb.rotation = rot;
        const cw = Math.abs(Math.cos(rot));
        const sw = Math.abs(Math.sin(rot));
        [w, h] = [w * cw + h * sw, w * sw + h * cw];
      }
      items.push({ x: win.x, y: win.y, w, h, p: labelPriority(pl.c.kind, pl.c.rank) + (pl.target > 0 ? 40 : 0) - distKm * 0.002, pl });
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
        if (p.label) {
          const base = (p.label as unknown as { _atlasColor: Color })._atlasColor;
          p.label.fillColor = base.withAlpha(p.alpha);
          p.label.outlineColor = Color.fromCssColorString('#06090d').withAlpha(p.alpha * 0.85);
          p.label.show = p.alpha > 0.01;
        }
        if (p.bb) {
          p.bb.color = Color.WHITE.withAlpha(p.alpha);
          p.bb.show = p.alpha > 0.01;
        }
      }
      // Drop labels that are fully faded and no longer in any loaded tile.
      if (p.alpha === 0 && p.target === 0 && !this.allowedNow(p)) {
        if (p.label) this.labels.remove(p.label);
        if (p.bb) this.streets.remove(p.bb);
        this.placed.delete(k);
      }
    }
    this.animating = busy;
    if (busy) this.widget.scene.requestRender();
  }

  destroy(): void {
    this.widget.scene.primitives.remove(this.labels);
    this.widget.scene.primitives.remove(this.streets);
    this.placed.clear();
  }
}
