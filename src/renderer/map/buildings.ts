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
  stats: BuildingStats = { tilesLoaded: 0, buildingsDrawn: 0, lastError: null, visible: false };

  constructor(private readonly widget: CesiumWidget) {
    // Lit (not flat) buildings: a light that stays above and slightly behind the
    // camera, so roofs read brightest and walls get distinct shades from any
    // viewing angle or time of day. Globe lighting is off, so only lit
    // primitives (these buildings) are affected.
    const light = new DirectionalLight({ direction: new Cartesian3(0, 0, -1), intensity: LIGHT_INTENSITY });
    widget.scene.light = light;
    const down = new Cartesian3();
    const dir = new Cartesian3();
    widget.scene.preRender.addEventListener((scene) => {
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

  /** Switches stylized window façades on or off; loaded tiles are rebuilt. */
  setFacades(on: boolean): void {
    if (on === this.facades) return;
    this.facades = on;
    const keys = [...this.tiles.keys()];
    for (const ps of this.tiles.values()) for (const p of ps ?? []) this.widget.scene.primitives.remove(p);
    this.tiles.clear();
    this.stats.buildingsDrawn = 0;
    for (const k of keys) void this.load(k);
  }

  /** Called when the camera settles. Loads the 3×3 block of zoom-14 tiles around the view center. */
  update(lat: number, lon: number, heightAboveGroundM: number): void {
    const visible = this.enabled && heightAboveGroundM < BUILDINGS_MAX_CAMERA_M;
    this.stats.visible = visible;
    for (const ps of this.tiles.values()) for (const p of ps ?? []) p.show = visible;
    if (!visible) {
      this.widget.scene.requestRender();
      return;
    }
    const [cx, cy] = tileXY(lat, lon);
    const want = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want.add(`${cx + dx}/${cy + dy}`);
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
      // Base elevation: one terrain sample at the tile center (buildings on steep slopes may float or sink slightly).
      const [clon, clat] = toLonLat(tx, ty, layer.extent / 2, layer.extent / 2, layer.extent);
      let base = 0;
      try {
        const [s] = await sampleTerrain(this.widget.terrainProvider, 13, [Cartographic.fromDegrees(clon, clat)]);
        base = Number.isFinite(s.height) ? s.height : 0;
      } catch {
        base = 0;
      }
      const instances: GeometryInstance[] = [];
      const facades = this.facades ? new FacadeBatch() : null;
      for (let i = 0; i < layer.length && instances.length < MAX_PER_TILE; i++) {
        const f = layer.feature(i);
        if (f.type !== 3 || f.properties.hide_3d === true) continue;
        const h = Number(f.properties.render_height ?? 0);
        const minH = Number(f.properties.render_min_height ?? 0);
        if (!(h > 0)) continue;
        for (const poly of classifyRings(f.loadGeometry())) {
          const rings = poly.map((ring) => ring.map((p) => toLonLat(tx, ty, p.x, p.y, layer.extent)));
          if (rings[0].length < 4) continue;
          const toPos = (r: [number, number][]) => Cartesian3.fromDegreesArray(r.flat());
          const t = Math.min(1, h / 150);
          const tint = buildingColor(f.properties.colour);
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
        }
      }
      if (!this.tiles.has(key) || instances.length === 0) return;
      const prims = [new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true, releaseGeometryInstances: true })];
      const walls = facades?.build();
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
