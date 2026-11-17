// Simulated vehicles moving along the traffic-flow layer's road lines (New York and Paris publish road shapes).
// One point collection, positions advanced each animation frame at each road's measured or assumed speed.
// The dots are an illustration, not tracked cars: see shared/trafficSim.ts. Not pickable, so a click reaches the road.
import '../lib/cesiumBase';
import { Cartesian2, Cartesian3, Cartographic, Color, LabelCollection, LabelStyle, NearFarScalar, PointPrimitiveCollection, SceneTransforms, VerticalOrigin, type CesiumWidget, type Label, type PointPrimitive } from 'cesium';
import type { GeoRecord } from '../../shared/layers';
import { initialOffsets, segmentAt, SIM_STATE_COLOR, simPlan, simTag, type SimPlan } from '../../shared/trafficSim';

interface Road { id: string; pts: Cartesian3[]; cum: Float64Array; length: number; speed: number; offsets: number[]; dots: PointPrimitive[] }

/** Above this camera height the dots are too small to read, so they are hidden and not advanced. */
const MAX_VIEW_HEIGHT_M = 60_000;
const DOT = Color.fromCssColorString('#ffffff').withAlpha(0.95);
/** Below this height the nearest dots carry a SIM tag. */
const TAG_HEIGHT_M = 4000;
const MAX_TAGS = 40;
const TAG_EVERY_MS = 300;
const OUTLINE = Color.fromCssColorString('#101418');

export class TrafficSim {
  private readonly coll: PointPrimitiveCollection;
  private readonly tags: LabelCollection;
  private tagPool: Label[] = [];
  private lastTags = 0;
  private roads: Road[] = [];
  private frame = 0;
  private last = 0;
  private destroyed = false;
  private readonly scratch = new Cartesian3();
  plan: SimPlan | null = null;

  constructor(private readonly widget: CesiumWidget, private reduced: boolean) {
    this.coll = widget.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
    this.tags = widget.scene.primitives.add(new LabelCollection()) as LabelCollection;
    this.kick();
  }

  setReduced(reduced: boolean): void { this.reduced = reduced; this.kick(); }

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
    const globe = this.widget.scene.globe;
    const carto = new Cartographic();
    this.roads = plan.roads.map((road) => {
      // Surface heights from the loaded terrain, so dots sit on hilly streets; 0 where terrain is not loaded yet.
      const pts = road.coords.map(([lon, lat]) => {
        Cartographic.fromDegrees(lon, lat, 0, carto);
        const h = globe.getHeight(carto) ?? 0;
        return Cartesian3.fromDegrees(lon, lat, h + 1.5);
      });
      const cum = new Float64Array(pts.length);
      for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Cartesian3.distance(pts[i - 1], pts[i]);
      const length = cum[pts.length - 1];
      const kept = previous.get(road.id);
      const offsets = kept && kept.length === road.dots ? kept.map((s) => s % length) : initialOffsets(road.id, road.dots, length);
      const tint = SIM_STATE_COLOR[road.state] ? Color.fromCssColorString(SIM_STATE_COLOR[road.state]) : DOT;
      const dots = offsets.map(() => this.coll.add({
        position: pts[0], pixelSize: 6, color: tint, outlineColor: OUTLINE, outlineWidth: 1.5,
        scaleByDistance: new NearFarScalar(300, 1.6, 30_000, 0.6), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      }));
      return { id: road.id, pts, cum, length, speed: road.speedMps, offsets, dots };
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

  /** Tags the dots nearest the screen centre; tags move with their dots between retags. */
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
    // Keep tags readable: a tag needs a clear box around it, so dense queues show every few vehicles.
    const chosen: typeof near = [];
    const spots: { x: number; y: number }[] = [];
    for (const c of near) {
      if (chosen.length >= MAX_TAGS) break;
      const p = SceneTransforms.worldToWindowCoordinates(scene, c.p, sp);
      if (!p || spots.some((o) => Math.abs(o.x - p.x) < 90 && Math.abs(o.y - p.y) < 30)) continue;
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
        road.dots[i].position = Cartesian3.lerp(road.pts[k], road.pts[k + 1], f, this.scratch);
      }
    }
    if (this.tags.show) this.tagged.forEach(([ri, di], i) => { const dot = this.roads[ri]?.dots[di]; if (dot && this.tagPool[i]) this.tagPool[i].position = dot.position; });
  }
}
