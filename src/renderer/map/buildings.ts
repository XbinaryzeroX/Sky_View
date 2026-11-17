import { prof, profAdd } from '../lib/prof';
// Extruded OpenStreetMap building footprints (worldwide where mapped) from
// OpenFreeMap zoom-14 vector tiles. Heights use OpenMapTiles render_height:
// from OSM height/levels tags where present, otherwise an estimate. These are
// simple extrusions, NOT photorealistic reconstruction. Optional window
// façades (facades.ts) are decorative and generated, not observed.

import { classifyRings } from '@mapbox/vector-tile';
import {
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  DirectionalLight,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  sampleTerrain,
  type CesiumWidget,
} from 'cesium';
import { FacadeBatch } from './facades';
import { loadVectorTile } from './vectorTiles';

const Z = 14;
const MAX_PER_TILE = 6000;
export const BUILDINGS_MAX_CAMERA_M = 4000;

export interface BuildingStats {
  tilesLoaded: number;
  buildingsDrawn: number;
  lastError: string | null;
  visible: boolean;
  /**
   * How far the per-building ground heights in the last loaded tile differ from the single tile-centre height used
   * before 2026-11-13 (metres): the vertical error that version had. Null until a tile with terrain loads.
   */
  baseSpreadM: { median: number; max: number } | null;
  /** Buildings placed at the tile-centre height because their own ground sample failed. */
  baseFallbacks: number;
}

/** Terrain level for building bases: the terrain source's most detailed level, the one the ground is drawn from. */
export const BUILDING_BASE_LEVEL = 15;

/**
 * Ground sample points for one footprint: its centre plus the corners of its bounding box, so a building on a slope
 * can stand on the lowest of them (its downhill wall reaches the ground instead of floating; the uphill side goes
 * into the terrain, which hides it).
 */
export function footprintSamplePoints(ring: readonly [number, number][]): [number, number][] {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const [lo, la] of ring) {
    w = Math.min(w, lo);
    e = Math.max(e, lo);
    s = Math.min(s, la);
    n = Math.max(n, la);
  }
  // Corners 70% of the way out from the centre, so a sample lands on the plot rather than across the street.
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const k = 0.7;
  return [[cx, cy], [cx - (cx - w) * k, cy - (cy - s) * k], [cx + (e - cx) * k, cy - (cy - s) * k], [cx - (cx - w) * k, cy + (n - cy) * k], [cx + (e - cx) * k, cy + (n - cy) * k]];
}

/** The base height for a building from its samples: the lowest finite one, or the fallback when none is. */
export function buildingBase(samples: readonly number[], fallback: number): { base: number; fallback: boolean } {
  let min = Infinity;
  for (const v of samples) if (Number.isFinite(v) && v < min) min = v;
  return Number.isFinite(min) ? { base: min, fallback: false } : { base: fallback, fallback: true };
}

function tileXY(lat: number, lon: number): [number, number] {
  const n = 2 ** Z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

function toLonLat(tx: number, ty: number, px: number, py: number, ext: number): [number, number] {
  const n = 2 ** Z;
  const lon = ((tx + px / ext) / n) * 360 - 180;
  const yy = (ty + py / ext) / n;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
  return [lon, lat];
}

const DEFAULT_BUILDING = Color.fromCssColorString('#d6dade');
/** Planning site view: dark grey blocks, so lit sight lines and magenta outlines stand out. */
const DARK_BUILDING = Color.fromCssColorString('#3c4047');
/** OSM `building:colour` (OpenMapTiles `colour`) when it is a plain hex color, softened toward gray; otherwise a neutral light gray. */
function buildingColor(raw: unknown): Color {
  if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) return Color.lerp(Color.fromCssColorString(raw), DEFAULT_BUILDING, 0.35, new Color());
  return DEFAULT_BUILDING.clone();
}

/** Shared scene light. Higher values wash out the animated water surface (it reflects the same light). */
const LIGHT_INTENSITY = 1.15;

export class BuildingManager {
  private tiles = new Map<string, Primitive[] | null>();
  private enabled = true;
  private facades = true;
  private dark = false;
  /** Maximum quality: 5×5 tiles, more buildings per tile, visible from higher up. */
  private radius = 1;
  private perTile = MAX_PER_TILE;
  private maxCameraM = BUILDINGS_MAX_CAMERA_M;
  stats: BuildingStats = { tilesLoaded: 0, buildingsDrawn: 0, lastError: null, visible: false, baseSpreadM: null, baseFallbacks: 0 };

  constructor(private readonly widget: CesiumWidget) {
    // Lit (not flat) buildings: a light that stays above and slightly behind the
    // camera, so roofs read brightest and walls get distinct shades from any
    // viewing angle in the daylight display. Day/night mode supplies its own solar light.
    const light = new DirectionalLight({ direction: new Cartesian3(0, 0, -1), intensity: LIGHT_INTENSITY });
    widget.scene.light = light;
    const down = new Cartesian3();
    const dir = new Cartesian3();
    widget.scene.preRender.addEventListener((scene) => {
      if (scene.light !== light) return;
      const cam = scene.camera;
      scene.globe.ellipsoid.geodeticSurfaceNormal(cam.positionWC, down);
      Cartesian3.negate(down, down);
      Cartesian3.multiplyByScalar(down, 1.0, dir);
      Cartesian3.add(dir, Cartesian3.multiplyByScalar(cam.directionWC, 0.35, new Cartesian3()), dir);
      Cartesian3.add(dir, Cartesian3.multiplyByScalar(cam.rightWC, 0.45, new Cartesian3()), dir);
      Cartesian3.normalize(dir, light.direction);
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const ps of this.tiles.values()) for (const p of ps ?? []) p.show = on && this.stats.visible;
    this.widget.scene.requestRender();
  }

  /** Rendering quality: 'maximum' loads a 5×5 block of tiles with up to 12,000 buildings each, below 8 km. */
  setQuality(max: boolean): void {
    this.radius = max ? 2 : 1;
    this.perTile = max ? 12000 : MAX_PER_TILE;
    this.maxCameraM = max ? 8000 : BUILDINGS_MAX_CAMERA_M;
  }

  /** Dark site view: uniform dark grey blocks without façades (loaded tiles are rebuilt). */
  setDark(on: boolean): void {
    if (on === this.dark) return;
    this.dark = on;
    this.rebuild();
  }

  /** Switches stylized window façades on or off; loaded tiles are rebuilt. */
  setFacades(on: boolean): void {
    if (on === this.facades) return;
    this.facades = on;
    this.rebuild();
  }

  private rebuild(): void {
    const keys = [...this.tiles.keys()];
    for (const ps of this.tiles.values()) for (const p of ps ?? []) this.widget.scene.primitives.remove(p);
    this.tiles.clear();
    this.stats.buildingsDrawn = 0;
    for (const k of keys) void this.load(k);
  }

  /** Called when the camera settles. Loads the 3×3 block of zoom-14 tiles around the view center. */
  update(lat: number, lon: number, heightAboveGroundM: number): void {
    const visible = this.enabled && heightAboveGroundM < this.maxCameraM;
    this.stats.visible = visible;
    for (const ps of this.tiles.values()) for (const p of ps ?? []) p.show = visible;
    if (!visible) {
      this.widget.scene.requestRender();
      return;
    }
    const [cx, cy] = tileXY(lat, lon);
    const want = new Set<string>();
    for (let dx = -this.radius; dx <= this.radius; dx++) for (let dy = -this.radius; dy <= this.radius; dy++) want.add(`${cx + dx}/${cy + dy}`);
    // Unload distant tiles to bound memory.
    for (const [k, p] of this.tiles) {
      if (!want.has(k)) {
        for (const pr of p ?? []) this.widget.scene.primitives.remove(pr);
        this.tiles.delete(k);
      }
    }
    for (const k of want) if (!this.tiles.has(k)) void this.load(k);
  }

  private async load(key: string): Promise<void> {
    this.tiles.set(key, null);
    const [tx, ty] = key.split('/').map(Number);
    try {
      const vt = await loadVectorTile(Z, tx, ty);
      const layer = vt.layers.building;
      if (!layer || !this.tiles.has(key)) return;
      // Fallback ground height: one sample at the tile centre (used only where a building's own samples fail).
      const [clon, clat] = toLonLat(tx, ty, layer.extent / 2, layer.extent / 2, layer.extent);
      let tileBase = 0;
      try {
        const [s] = await sampleTerrain(this.widget.terrainProvider, BUILDING_BASE_LEVEL, [Cartographic.fromDegrees(clon, clat)]);
        tileBase = Number.isFinite(s.height) ? s.height : 0;
      } catch {
        tileBase = 0;
      }
      // Each building stands on the ground under its own footprint. A z14 tile spans 1–2.5 km; one height for all
      // of it left buildings on slopes floating or buried by tens of metres, which in tilted views shifted them
      // sideways against the imagery.
      const parts: { f: ReturnType<typeof layer.feature>; rings: [number, number][][]; h: number; minH: number }[] = [];
      for (let i = 0; i < layer.length && parts.length < this.perTile; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.hide_3d === true) continue;
        const h = Number(f.properties.render_height ?? 0);
        const minH = Number(f.properties.render_min_height ?? 0);
        if (!(h > 0)) continue;
        for (const poly of classifyRings(f.loadGeometry())) {
          const rings = poly.map((ring) => ring.map((p) => toLonLat(tx, ty, p.x, p.y, layer.extent)));
          if (rings[0].length >= 4) parts.push({ f, rings, h, minH });
        }
      }
      const points = parts.flatMap((p) => footprintSamplePoints(p.rings[0]).map(([lo, la]) => Cartographic.fromDegrees(lo, la)));
      let heights: number[] = [];
      try {
        heights = points.length ? (await sampleTerrain(this.widget.terrainProvider, BUILDING_BASE_LEVEL, points)).map((c) => c.height) : [];
      } catch {
        heights = []; // every building falls back to the tile-centre height
      }
      if (!this.tiles.has(key)) return;
      const tB = performance.now();
      const instances: GeometryInstance[] = [];
      const facades = this.facades && !this.dark ? new FacadeBatch() : null;
      const spread: number[] = [];
      let fallbacks = 0;
      parts.forEach((part, pi) => {
        const { f, rings, h, minH } = part;
        const b = buildingBase(heights.slice(pi * 5, pi * 5 + 5), tileBase);
        const base = b.base;
        if (b.fallback) fallbacks++;
        else spread.push(Math.abs(base - tileBase));
        const toPos = (r: [number, number][]) => Cartesian3.fromDegreesArray(r.flat());
        const t = Math.min(1, h / 150);
        const tint = this.dark ? DARK_BUILDING.clone() : buildingColor(f.properties.colour);
        const hierarchy = new PolygonHierarchy(toPos(rings[0]), rings.slice(1).map((r) => new PolygonHierarchy(toPos(r))));
        if (facades) {
          // Flat roof here; walls (with windows) go into the façade batch.
          instances.push(
            new GeometryInstance({
              geometry: new PolygonGeometry({ polygonHierarchy: hierarchy, height: base + h, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(tint.darken(0.12, new Color())) },
            }),
          );
          for (const r of rings) facades.addRing(r, base + minH, base + h, tint.brighten(t * 0.1, new Color()), base);
        } else {
          instances.push(
            new GeometryInstance({
              geometry: new PolygonGeometry({ polygonHierarchy: hierarchy, height: base + minH, extrudedHeight: base + h, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(tint.brighten(t * 0.15, new Color())) },
            }),
          );
        }
      });
      if (spread.length) {
        spread.sort((a, b) => a - b);
        this.stats.baseSpreadM = { median: Math.round(spread[spread.length >> 1] * 10) / 10, max: Math.round(spread[spread.length - 1] * 10) / 10 };
      }
      this.stats.baseFallbacks += fallbacks;
      profAdd('buildings.geometry', performance.now() - tB);
      if (!this.tiles.has(key) || instances.length === 0) return;
      const prims = [new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true, releaseGeometryInstances: true })];
      const walls = prof('buildings.facades', () => facades?.build());
      if (walls) prims.push(walls);
      for (const prim of prims) {
        prim.show = this.stats.visible && this.enabled;
        this.widget.scene.primitives.add(prim);
      }
      this.tiles.set(key, prims);
      this.stats.tilesLoaded++;
      this.stats.buildingsDrawn += instances.length;
      this.widget.scene.requestRender();
    } catch (e) {
      this.stats.lastError = e instanceof Error ? e.message : String(e);
      this.tiles.delete(key);
    }
  }

  destroy(): void {
    for (const ps of this.tiles.values()) for (const p of ps ?? []) this.widget.scene.primitives.remove(p);
    this.tiles.clear();
  }
}
