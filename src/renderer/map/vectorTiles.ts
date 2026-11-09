// Worldwide streets, water, land use, boundaries, place names and building
// footprints from OpenFreeMap vector tiles (OpenMapTiles schema, OpenStreetMap
// data). OpenFreeMap: free, commercial use allowed, no key, no request limits;
// attribution to OpenMapTiles and OpenStreetMap contributors is required.
//
// Tiles are rasterized client-side into a Cesium imagery provider. Source data
// stops at zoom 14; deeper levels redraw a portion of the zoom-14 tile at higher
// scale, so lines and labels stay sharp (vector overzoom), though no new
// features appear beyond what zoom-14 tiles contain.

import { VectorTile, type VectorTileLayer } from '@mapbox/vector-tile';
import { Credit, Event, GeographicTilingScheme, Rectangle, WebMercatorTilingScheme, type ImageryProvider, type Request } from 'cesium';
import { PbfReader } from 'pbf';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const SOURCE_MAX = 14;
const TILE = 256;

let templatePromise: Promise<string> | null = null;
/** Resolves the current versioned tile URL template from OpenFreeMap's TileJSON. */
export function tileTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = fetch(TILEJSON)
      .then((r) => {
        if (!r.ok) throw new Error(`TileJSON HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { tiles?: unknown }) => {
        const t = Array.isArray(j.tiles) ? j.tiles[0] : null;
        if (typeof t !== 'string' || !t.startsWith('https://tiles.openfreemap.org/')) throw new Error('Unexpected TileJSON');
        return t;
      })
      .catch((e) => {
        templatePromise = null;
        throw e;
      });
  }
  return templatePromise;
}

export interface VectorStats {
  requested: number;
  loaded: number;
  failed: number;
  lastError: string | null;
  lastSuccessAt: string | null;
}
export const vectorStats: VectorStats = { requested: 0, loaded: 0, failed: 0, lastError: null, lastSuccessAt: null };

const cache = new Map<string, Promise<VectorTile>>();
/** Fetches and decodes one source tile (zoom ≤ 14), with a bounded in-memory cache. */
export function loadVectorTile(z: number, x: number, y: number): Promise<VectorTile> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    vectorStats.requested++;
    try {
      const tpl = await tileTemplate();
      const res = await fetch(tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
      vectorStats.loaded++;
      vectorStats.lastSuccessAt = new Date().toISOString();
      return vt;
    } catch (e) {
      vectorStats.failed++;
      vectorStats.lastError = e instanceof Error ? e.message : String(e);
      cache.delete(key);
      throw e;
    }
  })();
  cache.set(key, p);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return p;
}

/** 'context' = overlay plus translucent water, park, built-up and footprint fills, for areas without high-resolution imagery. */
export type VectorStyle = 'map' | 'overlay' | 'context';

interface Palette {
  background: string | null;
  water: string | null;
  landcover: string | null;
  park: string | null;
  landuse: string | null;
  building: string | null;
  roadMajor: string;
  roadMinor: string;
  rail: string;
  boundary: string;
  label: string;
  halo: string;
  waterLabel: string;
}

const PALETTES: Record<VectorStyle, Palette> = {
  map: {
    background: '#1b232c',
    water: '#123a57',
    landcover: '#1d2a24',
    park: '#1e3327',
    landuse: '#222b35',
    building: '#2e3a47',
    roadMajor: '#c9a35a',
    roadMinor: '#5d6b7a',
    rail: '#6b6f78',
    boundary: '#9a8fb5',
    label: '#e8eef4',
    halo: 'rgba(10,16,22,0.9)',
    waterLabel: '#8fc3e6',
  },
  overlay: {
    background: null,
    water: null,
    landcover: null,
    park: null,
    landuse: null,
    building: null,
    roadMajor: 'rgba(255,214,120,0.75)',
    roadMinor: 'rgba(255,255,255,0.45)',
    rail: 'rgba(220,220,230,0.4)',
    boundary: 'rgba(200,180,255,0.7)',
    label: '#ffffff',
    halo: 'rgba(0,0,0,0.85)',
    waterLabel: '#cfe8ff',
  },
  context: {
    background: null,
    water: 'rgba(38,84,138,0.92)',
    landcover: null,
    park: 'rgba(78,128,64,0.38)',
    landuse: 'rgba(168,160,150,0.30)',
    building: 'rgba(214,214,220,0.62)',
    roadMajor: 'rgba(255,214,120,0.8)',
    roadMinor: 'rgba(255,255,255,0.5)',
    rail: 'rgba(220,220,230,0.45)',
    boundary: 'rgba(200,180,255,0.7)',
    label: '#ffffff',
    halo: 'rgba(0,0,0,0.85)',
    waterLabel: '#cfe8ff',
  },
};

const MAJOR = new Set(['motorway', 'trunk', 'primary']);
const MID = new Set(['secondary', 'tertiary']);

function roadWidth(cls: string, z: number): number {
  const base = MAJOR.has(cls) ? 2.2 : MID.has(cls) ? 1.5 : 0.9;
  return base * Math.max(0.6, Math.min(3.2, (z - 8) / 4));
}

/** Rasterizes the visible portion of a source tile into a 256×256 canvas. */
export function drawTile(vt: VectorTile, style: VectorStyle, level: number, sub: { ox: number; oy: number; scale: number }): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(TILE, TILE);
  const g = c.getContext('2d')!;
  const pal = PALETTES[style];
  if (pal.background) {
    g.fillStyle = pal.background;
    g.fillRect(0, 0, TILE, TILE);
  }
  const layer = (name: string): VectorTileLayer | undefined => vt.layers[name];
  const tx = (ext: number) => (v: number) => ((v / ext) * TILE * sub.scale) - sub.ox * TILE;
  const ty = (ext: number) => (v: number) => ((v / ext) * TILE * sub.scale) - sub.oy * TILE;

  const fillLayer = (name: string, color: string | null, filter?: (p: Record<string, unknown>) => boolean) => {
    const l = layer(name);
    if (!l || !color) return;
    const X = tx(l.extent);
    const Y = ty(l.extent);
    g.fillStyle = color;
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (f.type !== 3 || (filter && !filter(f.properties))) continue;
      g.beginPath();
      for (const ring of f.loadGeometry()) {
        ring.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
        g.closePath();
      }
      g.fill('evenodd');
    }
  };
  const strokeLayer = (name: string, pick: (p: Record<string, unknown>) => { color: string; width: number; dash?: number[] } | null) => {
    const l = layer(name);
    if (!l) return;
    const X = tx(l.extent);
    const Y = ty(l.extent);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (f.type !== 2) continue;
      const s = pick(f.properties);
      if (!s) continue;
      g.strokeStyle = s.color;
      g.lineWidth = s.width;
      g.setLineDash(s.dash ?? []);
      g.beginPath();
      for (const line of f.loadGeometry()) line.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
      g.stroke();
    }
    g.setLineDash([]);
  };

  fillLayer('landcover', pal.landcover);
  fillLayer('landuse', pal.landuse, (p) => p.class === 'residential' || p.class === 'industrial' || p.class === 'commercial');
  fillLayer('park', pal.park);
  // Context style: lakes, rivers and reservoirs only; the sea is drawn by the imagery base.
  fillLayer('water', pal.water, style === 'context' ? (p) => p.class !== 'ocean' && level >= 8 : undefined);
  if (level >= 14) fillLayer('building', pal.building);
  strokeLayer('waterway', (p) => (style !== 'overlay' && level >= 9 ? { color: pal.water ?? 'rgba(120,180,230,0.6)', width: p.class === 'river' ? 1.4 : 0.7 } : null));
  strokeLayer('boundary', (p) => (Number(p.admin_level) <= 4 && !p.maritime ? { color: pal.boundary, width: Number(p.admin_level) <= 2 ? 1.4 : 0.8, dash: Number(p.admin_level) <= 2 ? undefined : [4, 3] } : null));
  strokeLayer('transportation', (p) => {
    const cls = String(p.class ?? '');
    if (cls === 'rail' || cls === 'transit') return level >= 12 ? { color: pal.rail, width: 0.8, dash: [3, 3] } : null;
    if (MAJOR.has(cls)) return level >= 6 ? { color: pal.roadMajor, width: roadWidth(cls, level) } : null;
    if (MID.has(cls)) return level >= 10 ? { color: pal.roadMajor, width: roadWidth(cls, level) * 0.75 } : null;
    if (cls === 'minor' || cls === 'service' || cls === 'track' || cls === 'path') return level >= 13 ? { color: pal.roadMinor, width: roadWidth(cls, level) * (cls === 'minor' ? 1 : 0.6) } : null;
    return null;
  });

  // Labels: place names (city/town/village/suburb), water names, major road names.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = (text: string, x: number, y: number, size: number, color: string, weight = 600) => {
    if (x < -40 || x > TILE + 40 || y < -10 || y > TILE + 10) return;
    g.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    g.lineWidth = 3;
    g.strokeStyle = pal.halo;
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };
  const place = layer('place');
  if (place) {
    const X = tx(place.extent);
    const Y = ty(place.extent);
    for (let i = 0; i < place.length; i++) {
      const f = place.feature(i);
      const cls = String(f.properties.class ?? '');
      const name = (f.properties['name:en'] ?? f.properties['name:latin'] ?? f.properties.name) as string | undefined;
      if (!name || f.type !== 1) continue;
      const minLevel = cls === 'country' ? 3 : cls === 'state' ? 5 : cls === 'city' ? 6 : cls === 'town' ? 9 : cls === 'village' ? 11 : cls === 'suburb' || cls === 'quarter' ? 13 : cls === 'neighbourhood' ? 15 : 99;
      if (level < minLevel || level > (cls === 'country' ? 7 : cls === 'state' ? 9 : 22)) continue;
      const size = cls === 'country' ? 13 : cls === 'city' ? 13 : cls === 'state' ? 11 : cls === 'town' ? 12 : 11;
      const p = f.loadGeometry()[0][0];
      label(name, X(p.x), Y(p.y), size, pal.label, cls === 'suburb' || cls === 'neighbourhood' ? 500 : 600);
    }
  }
  const wn = layer('water_name');
  if (wn && level >= 4) {
    const X = tx(wn.extent);
    const Y = ty(wn.extent);
    for (let i = 0; i < wn.length; i++) {
      const f = wn.feature(i);
      const name = (f.properties['name:en'] ?? f.properties.name) as string | undefined;
      if (!name || f.type !== 1) continue;
      const p = f.loadGeometry()[0][0];
      label(name, X(p.x), Y(p.y), 11, pal.waterLabel, 500);
    }
  }
  const tn = layer('transportation_name');
  if (tn && level >= 16) {
    const X = tx(tn.extent);
    const Y = ty(tn.extent);
    const seen = new Set<string>();
    for (let i = 0; i < tn.length; i++) {
      const f = tn.feature(i);
      const name = (f.properties['name:en'] ?? f.properties.name) as string | undefined;
      if (!name || seen.has(name) || f.type !== 2) continue;
      const line = f.loadGeometry()[0];
      if (line.length < 2) continue;
      seen.add(name);
      const mid = line[Math.floor(line.length / 2)];
      label(name, X(mid.x), Y(mid.y), 10, pal.label, 500);
    }
  }
  // Cesium expects imagery bitmaps flipped at creation (see usgsProvider.ts).
  return createImageBitmap(c, { imageOrientation: 'flipY' });
}

/** Cesium imagery provider that renders OpenFreeMap vector tiles. */
/**
 * `plainIn`: for the context style, tiles that intersect any of these rectangles
 * (areas with high-resolution imagery, e.g. USGS in the U.S.) are drawn as the
 * plain overlay, so fills never cover real imagery.
 */
export function createVectorImageryProvider(style: VectorStyle, plainIn: Rectangle[] = []): ImageryProvider {
  const tilingScheme = new WebMercatorTilingScheme();
  const errorEvent = new Event();
  const credit = new Credit('© OpenMapTiles © OpenStreetMap contributors (OpenFreeMap)');
  const provider = {
    tilingScheme,
    rectangle: tilingScheme.rectangle,
    tileWidth: TILE,
    tileHeight: TILE,
    minimumLevel: 0,
    maximumLevel: 19,
    tileDiscardPolicy: undefined,
    errorEvent,
    credit,
    proxy: undefined,
    hasAlphaChannel: style !== 'map',
    getTileCredits: () => [],
    pickFeatures: () => undefined,
    requestImage(x: number, y: number, level: number, _request?: Request) {
      const z = Math.min(level, SOURCE_MAX);
      const shift = level - z;
      const sx = x >> shift;
      const sy = y >> shift;
      const scale = 1 << shift;
      const sub = { ox: x - sx * scale, oy: y - sy * scale, scale };
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const effective: VectorStyle = style === 'context' && plainIn.some((r) => Rectangle.intersection(r, rect)) ? 'overlay' : style;
      return loadVectorTile(z, sx, sy).then((vt) => drawTile(vt, effective, level, sub));
    },
  };
  return provider as unknown as ImageryProvider;
}

/**
 * Ocean mask for a Web Mercator tile (same z/x/y scheme as USGS and GIBS):
 * OpenStreetMap ocean polygons (OpenMapTiles water class "ocean") drawn opaque
 * on a transparent canvas. Lakes, rivers and reservoirs are not included.
 * Returns null when the vector tile cannot be loaded; callers then leave
 * their imagery untouched.
 */
export async function oceanMask(level: number, x: number, y: number): Promise<OffscreenCanvas | null> {
  const z = Math.min(level, SOURCE_MAX);
  const shift = level - z;
  const sx = x >> shift;
  const sy = y >> shift;
  const scale = 1 << shift;
  let vt: VectorTile;
  try {
    vt = await loadVectorTile(z, sx, sy);
  } catch {
    return null;
  }
  const c = new OffscreenCanvas(TILE, TILE);
  const l = vt.layers.water;
  if (!l) return c;
  const g = c.getContext('2d')!;
  const ox = x - sx * scale;
  const oy = y - sy * scale;
  const X = (v: number) => (v / l.extent) * TILE * scale - ox * TILE;
  const Y = (v: number) => (v / l.extent) * TILE * scale - oy * TILE;
  g.fillStyle = '#000';
  for (let i = 0; i < l.length; i++) {
    const f = l.feature(i);
    if (f.type !== 3 || f.properties.class !== 'ocean') continue;
    g.beginPath();
    for (const ring of f.loadGeometry()) {
      ring.forEach((p, k) => (k ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
      g.closePath();
    }
    g.fill('evenodd');
  }
  return c;
}

/**
 * Ocean mask for a tile drawn from vector tiles `extra` zooms deeper (2^extra
 * squared sub-tiles), for a more precise coastline than the tile's own zoom
 * gives. Returns null if any sub-tile fails, so callers can fall back.
 */
export async function oceanMaskFine(level: number, x: number, y: number, extra = 2): Promise<OffscreenCanvas | null> {
  const z = Math.min(SOURCE_MAX, level + extra);
  const k = 2 ** (z - level);
  const c = new OffscreenCanvas(TILE, TILE);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  const span = TILE / k;
  try {
    const tiles = await Promise.all(
      Array.from({ length: k * k }, (_, i) => loadVectorTile(z, x * k + (i % k), y * k + Math.floor(i / k)).then((vt) => ({ vt, i }))),
    );
    for (const { vt, i } of tiles) {
      const l = vt.layers.water;
      if (!l) continue;
      const ox = (i % k) * span;
      const oy = Math.floor(i / k) * span;
      for (let j = 0; j < l.length; j++) {
        const f = l.feature(j);
        if (f.type !== 3 || f.properties.class !== 'ocean') continue;
        g.beginPath();
        for (const ring of f.loadGeometry()) {
          ring.forEach((p, n) => (n ? g.lineTo(ox + (p.x / l.extent) * span, oy + (p.y / l.extent) * span) : g.moveTo(ox + (p.x / l.extent) * span, oy + (p.y / l.extent) * span)));
          g.closePath();
        }
        g.fill('evenodd');
      }
    }
  } catch {
    return null;
  }
  return c;
}

/** Distance from land (metres) within which USGS water imagery is kept. */
export const NEARSHORE_KEEP_M = 1500;

const offshoreCache = new Map<string, Promise<OffscreenCanvas>>();

/**
 * Offshore mask for a Web Mercator tile: opaque where OSM ocean is more than
 * ~NEARSHORE_KEEP_M from any land, transparent near land, with a soft fade
 * between. Used to remove USGS water imagery only offshore, where its coverage
 * ends in ragged patches. Harbors, rivers, bays and beaches keep their real
 * imagery.
 *
 * Distance needs context beyond the tile, so land is drawn for the 3×3 block of
 * vector tiles two zooms up (cached and shared by the 16 tiles inside it).
 * Vector tiles that fail to load count as land, so imagery is kept.
 */
export async function offshoreMask(level: number, x: number, y: number): Promise<OffscreenCanvas | null> {
  const zv = Math.max(0, Math.min(SOURCE_MAX, level - 2));
  const f = 2 ** (level - zv);
  const cx = Math.floor(x / f);
  const cy = Math.floor(y / f);
  const key = `${zv}/${cx}/${cy}`;
  let region = offshoreCache.get(key);
  if (!region) {
    region = buildOffshoreRegion(zv, cx, cy);
    region.catch(() => offshoreCache.delete(key));
    offshoreCache.set(key, region);
    if (offshoreCache.size > 16) offshoreCache.delete(offshoreCache.keys().next().value!);
  }
  let r: OffscreenCanvas;
  try {
    r = await region;
  } catch {
    return null;
  }
  const out = new OffscreenCanvas(TILE, TILE);
  const g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const span = TILE / f;
  g.drawImage(r, TILE + (x - cx * f) * span, TILE + (y - cy * f) * span, span, span, 0, 0, TILE, TILE);
  return out;
}

async function buildOffshoreRegion(z: number, cx: number, cy: number): Promise<OffscreenCanvas> {
  const n = 2 ** z;
  const W = TILE * 3;
  const land = new OffscreenCanvas(W, W);
  const lg = land.getContext('2d')!;
  lg.fillStyle = '#000';
  lg.fillRect(0, 0, W, W);
  lg.globalCompositeOperation = 'destination-out';
  const jobs: Promise<void>[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ty = cy + dy;
      if (ty < 0 || ty >= n) continue;
      const tx = (((cx + dx) % n) + n) % n;
      jobs.push(
        loadVectorTile(z, tx, ty)
          .then((vt) => {
            const l = vt.layers.water;
            if (!l) return;
            const ox = (dx + 1) * TILE;
            const oy = (dy + 1) * TILE;
            for (let i = 0; i < l.length; i++) {
              const ft = l.feature(i);
              if (ft.type !== 3 || ft.properties.class !== 'ocean') continue;
              lg.beginPath();
              for (const ring of ft.loadGeometry()) {
                ring.forEach((p, k) => {
                  const px = ox + (p.x / l.extent) * TILE;
                  const py = oy + (p.y / l.extent) * TILE;
                  if (k) lg.lineTo(px, py);
                  else lg.moveTo(px, py);
                });
                lg.closePath();
              }
              lg.fill('evenodd');
            }
          })
          .catch(() => undefined),
      );
    }
  await Promise.all(jobs);
  // Ground resolution at the tile's latitude.
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (cy + 0.5)) / n)));
  const mpp = (40075016.686 * Math.cos(latRad)) / (TILE * n);
  const sigma = Math.max(0.6, NEARSHORE_KEEP_M / mpp / 2);
  const near = new OffscreenCanvas(W, W);
  const ng = near.getContext('2d', { willReadFrequently: true })!;
  ng.filter = `blur(${Math.min(64, sigma).toFixed(2)}px)`;
  ng.drawImage(land, 0, 0);
  const nd = ng.getImageData(0, 0, W, W);
  const ld = lg.getImageData(0, 0, W, W).data;
  const d = nd.data;
  for (let i = 0; i < d.length; i += 4) {
    const nearLand = Math.min(1, (d[i + 3] / 255) * 6);
    const ocean = 1 - ld[i + 3] / 255;
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.round(255 * ocean * (1 - nearLand));
  }
  ng.putImageData(nd, 0, 0);
  return near;
}

export { GeographicTilingScheme, Rectangle };
