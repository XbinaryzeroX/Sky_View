// Simulated vehicles moving along the traffic-flow layer's road lines (New York and Paris publish road shapes).
// One point collection, positions advanced each animation frame at each road's measured or assumed speed.
// The dots are an illustration, not tracked cars: see shared/trafficSim.ts. Not pickable, so a click reaches the road.
import '../lib/cesiumBase';
import { Cartesian2, Cartesian3, Cartographic, Color, LabelCollection, LabelStyle, NearFarScalar, PointPrimitiveCollection, SceneTransforms, VerticalOrigin, type Cesium3DTileset, type CesiumWidget, type Label, type PointPrimitive } from 'cesium';
import type { GeoRecord } from '../../shared/layers';
import { initialOffsets, laneOf, laneOffsetM, segmentAt, SIM_STATE_COLOR, simPlan, simTag, type SimPlan } from '../../shared/trafficSim';
import { geoidHeight } from './geoid';
import { reservedBoxes } from '../lib/screenReserve';

interface Road {
  id: string;
  /** Flat [lon, lat, lon, lat, …] in degrees, kept to re-sample heights. */
  lonlat: Float64Array;
  pts: Cartesian3[];
  /** Unit vector to the right of travel for each segment, for the lane offsets. */
  right: Cartesian3[];
  /** Where each point's height came from: 0 a sea-level guess, 1 the globe's terrain, 2 the photoreal surface. */
  seated: Uint8Array;
  cum: Float64Array;
  length: number;
  speed: number;
  offsets: number[];
  /** Sideways offset of each dot's lane, metres. */
  lane: number[];
  dots: PointPrimitive[];
}

/** Above this camera height the dots are too small to read, so they are hidden and not advanced. */
const MAX_VIEW_HEIGHT_M = 60_000;
const DOT = Color.fromCssColorString('#ffffff').withAlpha(0.95);
/** Below this height the nearest dots carry a SIM tag. */
const TAG_HEIGHT_M = 2500;
/** Fewer, wider-spaced tags: 40 tags 90 px apart filled the screen around the BQE (reported 2026-11-23). */
const MAX_TAGS = 10;
const TAG_SPACING_X = 150;
const TAG_SPACING_Y = 60;
const TAG_EVERY_MS = 300;
const OUTLINE = Color.fromCssColorString('#101418');
/** Height above the sampled surface. Small, so the dot reads as on the road rather than above it. */
const LIFT_M = 0.6;
/** Heights are re-sampled for road points within this distance of the camera, a few hundred per pass. */
const SEAT_RADIUS_M = 6_000;
const SEAT_EVERY_MS = 400;
const SEAT_BUDGET = 300;

export class TrafficSim {
  private readonly coll: PointPrimitiveCollection;
  private readonly tags: LabelCollection;
  private tagPool: Label[] = [];
  private lastTags = 0;
  private lastSeat = 0;
  private seatRoad = 0;
  private seatPoint = 0;
  private roads: Road[] = [];
  private surface: Cesium3DTileset | null = null;
  private frame = 0;
  private last = 0;
  private destroyed = false;
  private readonly scratch = new Cartesian3();
  private readonly side = new Cartesian3();
  private readonly carto = new Cartographic();
  plan: SimPlan | null = null;

  constructor(private readonly widget: CesiumWidget, private reduced: boolean) {
    this.coll = widget.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.tags = widget.scene.primitives.add(new LabelCollection()) as LabelCollection;
    this.kick();
  }

  setReduced(reduced: boolean): void { this.reduced = reduced; this.kick(); }

  /**
   * The photoreal 3D mesh when it is showing, else null. Dots used to take their height from the globe's terrain only,
   * and 0 m above the ellipsoid where terrain was not loaded: about 30 m above New York streets (the geoid lies ~32 m
   * below the ellipsoid there) and above the photoreal road surface, so they floated (reported 2026-11-23).
   */
  setSurface(surface: Cesium3DTileset | null): void {
    if (this.surface === surface) return;
    this.surface = surface;
    // Depth-test against the mesh when it is there, so buildings and overpasses hide the dots behind them.
    const depth = surface ? 0 : Number.POSITIVE_INFINITY;
    for (const road of this.roads) {
      road.seated.fill(0);
      for (const d of road.dots) d.disableDepthTestDistance = depth;
    }
    this.seatRoad = 0;
    this.seatPoint = 0;
  }

  setRecords(records: readonly GeoRecord[]): void {
    if (this.destroyed) return;
    const previous = new Map<string, number[]>();
    for (const r of this.roads) previous.set(r.id, r.offsets);
    this.coll.removeAll();
    this.tags.removeAll();
    this.tagPool = [];
    this.tagged = [];
    const plan = simPlan(records);
    this.plan = plan;
    const depth = this.surface ? 0 : Number.POSITIVE_INFINITY;
    this.roads = plan.roads.map((road) => {
      const n = road.coords.length;
      const lonlat = new Float64Array(n * 2);
      road.coords.forEach(([lon, lat], i) => { lonlat[i * 2] = lon; lonlat[i * 2 + 1] = lat; });
      const seated = new Uint8Array(n);
      const pts = road.coords.map(([lon, lat], i) => this.seatPoint3(lon, lat, seated, i));
      const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Cartesian3.distance(pts[i - 1], pts[i]);
      const length = cum[n - 1];
      const kept = previous.get(road.id);
      const offsets = kept && kept.length === road.dots ? kept.map((s) => s % length) : initialOffsets(road.id, road.dots, length);
      const lane = offsets.map((_, i) => laneOffsetM(laneOf(road.id, i, road.lanes), road.lanes));
      const tint = SIM_STATE_COLOR[road.state] ? Color.fromCssColorString(SIM_STATE_COLOR[road.state]) : DOT;
      const dots = offsets.map(() => this.coll.add({
        position: pts[0], pixelSize: 5, color: tint, outlineColor: OUTLINE, outlineWidth: 1.5,
        scaleByDistance: new NearFarScalar(300, 1.5, 30_000, 0.6), disableDepthTestDistance: depth,
      }));
      const r: Road = { id: road.id, lonlat, pts, right: [], seated, cum, length, speed: road.speedMps, offsets, lane, dots };
      this.rebuildRight(r);
      return r;
    });
    this.place(0);
    this.kick();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    if (!this.widget.isDestroyed()) {
      this.widget.scene.primitives.remove(this.coll);
      this.widget.scene.primitives.remove(this.tags);
      this.widget.scene.requestRender();
    }
  }

  /** Best available surface height at a road point, recording where it came from. */
  private seatPoint3(lon: number, lat: number, seated: Uint8Array, i: number): Cartesian3 {
    const scene = this.widget.scene;
    Cartographic.fromDegrees(lon, lat, 0, this.carto);
    let h: number | undefined;
    let level = 0;
    if (this.surface) {
      h = this.surface.getHeight(this.carto, scene);
      if (h !== undefined) level = 2;
    }
    if (h === undefined) {
      h = scene.globe.getHeight(this.carto);
      if (h !== undefined) level = 1;
    }
    // Last resort: mean sea level (geoid), never the bare ellipsoid.
    if (h === undefined) h = geoidHeight(lat, lon) ?? 0;
    seated[i] = level;
    return Cartesian3.fromDegrees(lon, lat, h + LIFT_M);
  }

  private rebuildRight(road: Road): void {
    road.right = [];
    for (let k = 0; k + 1 < road.pts.length; k++) {
      const a = road.pts[k], b = road.pts[k + 1];
      const dir = Cartesian3.subtract(b, a, new Cartesian3());
      const up = Cartesian3.normalize(a, new Cartesian3());
      const right = Cartesian3.cross(dir, up, new Cartesian3());
      const len = Cartesian3.magnitude(right);
      road.right.push(len > 1e-6 ? Cartesian3.divideByScalar(right, len, right) : Cartesian3.clone(Cartesian3.ZERO));
    }
  }

  /** Re-samples heights near the camera, a bounded number per pass, as surface tiles finish loading. */
  private reseat(): void {
    const target = this.surface ? 2 : 1;
    const cam = this.widget.scene.camera.positionWC;
    const r2 = SEAT_RADIUS_M * SEAT_RADIUS_M;
    let checked = 0, sampled = 0;
    const total = this.roads.length;
    for (let visited = 0; visited <= total && sampled < SEAT_BUDGET && checked < 20_000; ) {
      const road = this.roads[this.seatRoad];
      if (!road) { this.seatRoad = 0; this.seatPoint = 0; visited++; continue; }
      let changed = false;
      for (; this.seatPoint < road.pts.length && sampled < SEAT_BUDGET; this.seatPoint++) {
        checked++;
        const i = this.seatPoint;
        if (road.seated[i] >= target || Cartesian3.distanceSquared(road.pts[i], cam) > r2) continue;
        sampled++;
        const before = road.seated[i];
        const p = this.seatPoint3(road.lonlat[i * 2], road.lonlat[i * 2 + 1], road.seated, i);
        if (road.seated[i] > before || !Cartesian3.equalsEpsilon(p, road.pts[i], 0, 0.05)) { road.pts[i] = p; changed = true; }
      }
      if (changed) {
        for (let i = 1; i < road.pts.length; i++) road.cum[i] = road.cum[i - 1] + Cartesian3.distance(road.pts[i - 1], road.pts[i]);
        road.length = road.cum[road.pts.length - 1];
        this.rebuildRight(road);
      }
      if (this.seatPoint >= road.pts.length) { this.seatPoint = 0; this.seatRoad = (this.seatRoad + 1) % Math.max(1, total); visited++; }
    }
  }

  private kick(): void {
    cancelAnimationFrame(this.frame);
    this.last = 0;
    if (!this.destroyed) this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(t: number): void {
    if (this.destroyed || this.widget.isDestroyed()) return;
    const height = this.widget.scene.camera.positionCartographic.height;
    const visible = height < MAX_VIEW_HEIGHT_M && this.roads.length > 0;
    if (this.coll.show !== visible) { this.coll.show = visible; this.widget.scene.requestRender(); }
    if (visible && height < SEAT_RADIUS_M && t - this.lastSeat > SEAT_EVERY_MS) {
      this.lastSeat = t;
      this.reseat();
      if (this.reduced) { this.place(0); this.widget.scene.requestRender(); }
    }
    const tagged = visible && height < TAG_HEIGHT_M;
    if (this.tags.show !== tagged) this.tags.show = tagged;
    if (tagged && t - this.lastTags > (this.reduced ? 2000 : TAG_EVERY_MS)) { this.lastTags = t; this.retag(); }
    if (visible && !this.reduced) {
      // Real time, but a long pause (hidden window) does not make the dots jump.
      const dt = this.last ? Math.min(0.25, (t - this.last) / 1000) : 0;
      this.place(dt);
      this.widget.scene.requestRender();
    }
    this.last = t;
    this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  /** Tags a few dots nearest the screen centre, clear of each other and of camera cards and tags; tags move with their dots between retags. */
  private retag(): void {
    const scene = this.widget.scene;
    const w = scene.canvas.clientWidth, h = scene.canvas.clientHeight;
    const near: { d: number; road: number; dot: number; p: Cartesian3 }[] = [];
    const sp = new Cartesian2();
    this.roads.forEach((road, ri) => road.dots.forEach((dot, di) => {
      const p = SceneTransforms.worldToWindowCoordinates(scene, dot.position, sp);
      if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) return;
      near.push({ d: (p.x - w / 2) ** 2 + (p.y - h / 2) ** 2, road: ri, dot: di, p: Cartesian3.clone(dot.position) });
    }));
    near.sort((a, b) => a.d - b.d);
    const taken = reservedBoxes();
    const chosen: typeof near = [];
    const spots: { x: number; y: number }[] = [];
    for (const c of near) {
      if (chosen.length >= MAX_TAGS) break;
      const p = SceneTransforms.worldToWindowCoordinates(scene, c.p, sp);
      if (!p || spots.some((o) => Math.abs(o.x - p.x) < TAG_SPACING_X && Math.abs(o.y - p.y) < TAG_SPACING_Y)) continue;
      // The label sits up and to the right of its dot (pixelOffset 10, -6; about 70 × 20 px).
      const box = { left: p.x + 6, top: p.y - 30, right: p.x + 84, bottom: p.y };
      if (taken.some((r) => box.left < r.right && r.left < box.right && box.top < r.bottom && r.top < box.bottom)) continue;
      spots.push({ x: p.x, y: p.y });
      chosen.push(c);
    }
    while (this.tagPool.length < chosen.length) {
      this.tagPool.push(this.tags.add({
        position: Cartesian3.ZERO, show: false,
        font: '600 11px ui-monospace, Consolas, monospace', fillColor: Color.fromCssColorString('#ffd9c9'), outlineColor: Color.BLACK, outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE, showBackground: true, backgroundColor: Color.fromCssColorString('#0b0f14').withAlpha(0.7),
        backgroundPadding: new Cartesian2(5, 3), pixelOffset: new Cartesian2(10, -6), verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      }));
    }
    this.tagged = chosen.map((c) => [c.road, c.dot] as [number, number]);
    this.tagPool.forEach((label, i) => {
      const c = chosen[i];
      label.show = !!c;
      if (c) { label.text = simTag(c.road, c.dot); label.position = c.p; }
    });
  }

  private tagged: [number, number][] = [];

  private place(dt: number): void {
    for (const road of this.roads) {
      for (let i = 0; i < road.offsets.length; i++) {
        let s = road.offsets[i] + road.speed * dt;
        if (s >= road.length) s -= road.length * Math.floor(s / road.length);
        road.offsets[i] = s;
        const k = Math.min(segmentAt(road.cum, s), road.pts.length - 2);
        const span = road.cum[k + 1] - road.cum[k];
        const f = span > 0 ? (s - road.cum[k]) / span : 0;
        const p = Cartesian3.lerp(road.pts[k], road.pts[k + 1], f, this.scratch);
        const right = road.right[k];
        if (right && road.lane[i]) Cartesian3.add(p, Cartesian3.multiplyByScalar(right, road.lane[i], this.side), p);
        road.dots[i].position = p;
      }
    }
    if (this.tags.show) this.tagged.forEach(([ri, di], i) => { const dot = this.roads[ri]?.dots[di]; if (dot && this.tagPool[i]) this.tagPool[i].position = dot.position; });
  }
}
