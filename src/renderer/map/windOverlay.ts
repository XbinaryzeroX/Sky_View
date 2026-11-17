// Animated wind particles drawn on a canvas over the globe, from a GFS 10 m forecast field. Particles live in
// longitude/latitude, are projected every frame and leave fading trails; the canvas clears whenever the camera moves.
// With reduced motion, a still field of short arrows is drawn instead. A visualization of a forecast: the particle
// paths are illustrations of the wind field, not tracked air parcels.

import '../lib/cesiumBase';
import { Cartesian2, Cartesian3, Math as CMath, SceneMode, SceneTransforms, type CesiumWidget } from 'cesium';
import { sampleWind, WIND_SPEED_BANDS, windSpeedBand, type WindField } from '../../shared/wind';

interface Particle { lon: number; lat: number; age: number; life: number; x: number; y: number; ok: boolean }

const FADE = 0.93;
/** Per-frame step, as a share of camera height, for 1 m/s (10 m/s moves about 4–5% of the view per second at 60 fps). */
const STEP_PER_MS = 8e-6;

export class WindOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private frame = 0;
  private lastCam = '';
  private destroyed = false;
  private readonly onResize = () => this.resize();
  private readonly onVisibility = () => { if (!document.hidden) this.kick(); };

  constructor(private readonly viewer: CesiumWidget, private field: WindField, private reduced: boolean, private readonly count: number, private colorBySpeed = false) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wind-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    const parent = viewer.container as HTMLElement;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.kick();
  }

  setField(field: WindField): void { this.field = field; this.lastCam = ''; this.particles = []; this.kick(); }
  setReduced(reduced: boolean): void { this.reduced = reduced; this.lastCam = ''; this.kick(); }
  setColorBySpeed(on: boolean): void { if (on !== this.colorBySpeed) { this.colorBySpeed = on; this.lastCam = ''; this.kick(); } }

  /** Stroke for a speed: band colour and a slightly thicker line per band, or the plain white that brightens with speed. */
  private stroke(speed: number, dpr: number, plainAlpha: number): void {
    const band = this.colorBySpeed ? windSpeedBand(speed) : -1;
    if (band < 0) {
      this.ctx.strokeStyle = `rgba(235,245,255,${plainAlpha})`;
      this.ctx.lineWidth = 1.3 * dpr;
      return;
    }
    this.ctx.strokeStyle = WIND_SPEED_BANDS[band].color;
    this.ctx.globalAlpha = 0.9;
    this.ctx.lineWidth = (1.2 + band * 0.25) * dpr;
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.remove();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = (this.viewer.container as HTMLElement).getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.lastCam = '';
  }

  private kick(): void {
    cancelAnimationFrame(this.frame);
    if (!this.destroyed) this.frame = requestAnimationFrame(() => this.tick());
  }

  private camKey(): string {
    const c = this.viewer.camera;
    const p = c.positionWC;
    const d = c.directionWC;
    return `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)},${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)},${this.canvas.width}`;
  }

  /** Window position (device pixels) of a surface point, or null when off screen or on the far side of the globe. */
  private project(lon: number, lat: number): { x: number; y: number } | null {
    const scene = this.viewer.scene;
    const world = Cartesian3.fromDegrees(lon, lat, 0);
    const cam = this.viewer.camera.positionWC;
    // Far side of the globe: the point faces away from the camera.
    if (scene.mode === SceneMode.SCENE3D && Cartesian3.dot(world, Cartesian3.subtract(cam, world, new Cartesian3())) <= 0) return null;
    const win = SceneTransforms.worldToWindowCoordinates(scene, world, new Cartesian2());
    if (!win) return null;
    const dpr = window.devicePixelRatio || 1;
    const x = win.x * dpr;
    const y = win.y * dpr;
    if (x < 0 || y < 0 || x > this.canvas.width || y > this.canvas.height) return null;
    return { x, y };
  }

  private spawn(p: Particle): void {
    const dpr = window.devicePixelRatio || 1;
    for (let tries = 0; tries < 4; tries++) {
      const sx = (Math.random() * this.canvas.width) / dpr;
      const sy = (Math.random() * this.canvas.height) / dpr;
      const hit = this.viewer.camera.pickEllipsoid(new Cartesian2(sx, sy));
      if (!hit) continue;
      const c = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(hit);
      p.lon = CMath.toDegrees(c.longitude);
      p.lat = CMath.toDegrees(c.latitude);
      p.age = 0;
      p.life = 40 + Math.floor(Math.random() * 80);
      p.x = sx * dpr;
      p.y = sy * dpr;
      p.ok = true;
      return;
    }
    p.ok = false;
    p.age = 0;
    p.life = 20;
  }

  private tick(): void {
    if (this.destroyed || document.hidden) return;
    const key = this.camKey();
    const moved = key !== this.lastCam;
    this.lastCam = key;
    if (this.reduced) {
      if (moved) this.drawArrows();
      // Re-check the camera at a calm rate; nothing animates.
      setTimeout(() => this.kick(), 250);
      return;
    }
    const ctx = this.ctx;
    if (moved) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    else {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${FADE})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.particles.length !== this.count) {
      this.particles = Array.from({ length: this.count }, () => ({ lon: 0, lat: 0, age: 0, life: 0, x: 0, y: 0, ok: false }));
      for (const p of this.particles) { this.spawn(p); p.age = Math.floor(Math.random() * p.life); }
    }
    const height = Math.max(1000, this.viewer.camera.positionCartographic.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.lineWidth = 1.3 * dpr;
    ctx.lineCap = 'round';
    for (const p of this.particles) {
      if (!p.ok || p.age++ > p.life) { this.spawn(p); continue; }
      const w = sampleWind(this.field, p.lat, p.lon);
      if (!w) { p.ok = false; continue; }
      const speed = Math.hypot(w.u, w.v);
      const stepM = height * STEP_PER_MS * 16;
      const nlat = p.lat + (w.v * stepM) / 111_320;
      const nlon = p.lon + (w.u * stepM) / (111_320 * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180)));
      if (nlat > 89.5 || nlat < -89.5) { p.ok = false; continue; }
      const to = this.project(((nlon + 540) % 360) - 180, nlat);
      if (!to) { p.ok = false; continue; }
      if (!moved) {
        // Brighter for stronger wind; the strength itself is read out in the Layers panel.
        this.stroke(speed, dpr, Math.min(0.9, 0.25 + speed / 20));
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      p.lon = ((nlon + 540) % 360) - 180;
      p.lat = nlat;
      p.x = to.x;
      p.y = to.y;
    }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** Reduced motion: a still grid of arrows pointing where the wind blows, longer for stronger wind. */
  private drawArrows(): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = 'rgba(235,245,255,0.75)';
    ctx.lineWidth = 1.2 * dpr;
    const gap = 56 * dpr;
    for (let y = gap / 2; y < this.canvas.height; y += gap)
      for (let x = gap / 2; x < this.canvas.width; x += gap) {
        const hit = this.viewer.camera.pickEllipsoid(new Cartesian2(x / dpr, y / dpr));
        if (!hit) continue;
        const c = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(hit);
        const lat = CMath.toDegrees(c.latitude);
        const lon = CMath.toDegrees(c.longitude);
        const w = sampleWind(this.field, lat, lon);
        if (!w) continue;
        const speed = Math.hypot(w.u, w.v);
        if (speed < 0.5) continue;
        // Screen direction: project a point a short way downwind.
        const k = 0.05 / Math.max(1, speed);
        const ahead = this.project(lon + (w.u * k) / Math.max(0.05, Math.cos((lat * Math.PI) / 180)), lat + w.v * k);
        if (!ahead) continue;
        this.stroke(speed, dpr, 0.75);
        const ang = Math.atan2(ahead.y - y, ahead.x - x);
        const len = Math.min(gap * 0.8, (8 + speed * 1.6) * dpr);
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang - 0.5) * 5 * dpr, ey - Math.sin(ang - 0.5) * 5 * dpr);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang + 0.5) * 5 * dpr, ey - Math.sin(ang + 0.5) * 5 * dpr);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
  }
}
