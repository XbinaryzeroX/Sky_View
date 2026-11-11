// 3D models for the aircraft and ships nearest the camera (LayerRenderer decides which).
// Each model variant is generated once per session (vehicleMeshes.ts → GLB blob URL);
// Cesium caches the geometry and textures, so instances share GPU memory. Far-away
// vehicles stay as icons, so the number of models is bounded.

import { Cartesian3, Color, HeightReference, Matrix4, Model, ShadowMode, Transforms, type CesiumWidget } from 'cesium';
import { writeGlb } from './glb';
import type { TextureSlot, VehicleModelSpec } from './vehicleMeshes';
import { clearShownModels, setShownModel } from './shownModels';

export interface ModelCandidate {
  /** 'rec|layer|id': also the pick id, so clicking a model selects the vehicle. */
  key: string;
  variant: string;
  /** App-built model (generated on first use); ignored when `url` is set. */
  spec?: () => VehicleModelSpec;
  /** A ready model file instead (model pack), already oriented like the built models. */
  url?: string;
  position: Cartesian3;
  /** Radians clockwise from north. */
  heading: number;
  /** Radians, nose up positive. */
  pitch: number;
  /** [length (forward), width (left), height] scale relative to the built model. */
  scale: [number, number, number];
  ground: boolean;
  selected: boolean;
  /** Smallest on-screen size in pixels (keeps distant models as visible as icons). */
  minimumPixelSize: number;
}

/** Diagnostics (Map diagnostics panel): variants built, models loaded/failed, texture bytes. */
export const modelStats = { variants: 0, loaded: 0, shown: 0, created: 0, removed: 0, flips: 0, failed: 0, textureBytes: [] as number[], lastError: null as string | null };

// ---------------------------------------------------------------- textures

async function png(canvas: OffscreenCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Fuselage paint: u (x) runs nose → tail, v (y) runs around from the top (0) via left (0.25), bottom (0.5), right (0.75). */
function fuselageTexture(cls: string): OffscreenCanvas {
  const W = 1024;
  const H = 128;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f6f8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d6dade'; // belly
  g.fillRect(0, H * 0.36, W, H * 0.28);
  const rows = [0.215, 0.785];
  const glass = '#1d2733';
  if (cls === 'helicopter' || cls === 'glider') {
    g.fillStyle = glass;
    const end = cls === 'helicopter' ? 0.34 : 0.32;
    g.fillRect(W * (cls === 'helicopter' ? 0 : 0.08), 0, W * (end - (cls === 'helicopter' ? 0 : 0.08)), H * (cls === 'helicopter' ? 0.3 : 0.12));
    g.fillRect(W * (cls === 'helicopter' ? 0 : 0.08), H * (cls === 'helicopter' ? 0.7 : 0.88), W * (end - (cls === 'helicopter' ? 0 : 0.08)), H * 0.3);
    if (cls === 'helicopter') for (const v of rows) g.fillRect(W * 0.36, H * (v - 0.05), W * 0.16, H * 0.1);
    return c;
  }
  g.fillStyle = '#2f8aa3'; // generic accent line (not an airline livery)
  for (const v of [0.285, 0.715]) g.fillRect(0, H * v, W, H * 0.014);
  // Cockpit windows.
  g.fillStyle = glass;
  for (const v of [0.18, 0.82]) {
    g.beginPath();
    g.moveTo(W * 0.03, H * (v - 0.06));
    g.lineTo(W * 0.075, H * (v - 0.07));
    g.lineTo(W * 0.075, H * (v + 0.04));
    g.lineTo(W * 0.035, H * (v + 0.04));
    g.closePath();
    g.fill();
  }
  const count = ({ widebody: 62, narrowbody: 34, regional: 24, turboprop: 16, bizjet: 7, light: 2, drone: 0, unknown: 34 } as Record<string, number>)[cls] ?? 30;
  const u0 = cls === 'light' ? 0.13 : 0.14;
  const u1 = cls === 'light' ? 0.42 : cls === 'bizjet' ? 0.62 : 0.84;
  const pitch = ((u1 - u0) * W) / Math.max(1, count);
  // Slightly oversized so the window line still reads from a few hundred metres away.
  const ww = cls === 'light' ? pitch * 0.8 : cls === 'bizjet' ? pitch * 0.55 : Math.max(5, pitch * 0.62);
  const wh = H * (cls === 'light' ? 0.13 : cls === 'bizjet' ? 0.08 : 0.075);
  for (const v of rows)
    for (let i = 0; i < count; i++) {
      const x = u0 * W + i * pitch + (pitch - ww) / 2;
      g.beginPath();
      g.roundRect(x, H * v - wh / 2, ww, wh, Math.min(ww, wh) / 2.2);
      g.fill();
    }
  // Doors (outlines) fore and aft on airliners.
  if (['widebody', 'narrowbody', 'regional', 'unknown', 'turboprop'].includes(cls)) {
    g.strokeStyle = '#9aa3ab';
    g.lineWidth = 1.5;
    for (const u of [0.115, 0.865]) for (const v of rows) g.strokeRect(W * u, H * (v - 0.07), W * 0.012, H * 0.12);
  }
  return c;
}

/** Superstructure: one window per 3 m bay and 2.8 m deck (the texture repeats). */
function windowsTexture(): OffscreenCanvas {
  const c = new OffscreenCanvas(64, 64);
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef0f1';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1d2933';
  g.fillRect(10, 14, 44, 20);
  g.fillStyle = '#c9ced2';
  g.fillRect(0, 58, 64, 6); // deck edge line
  return c;
}

const textureCache = new Map<string, Promise<Uint8Array>>();
function texture(slot: TextureSlot, key: string): Promise<Uint8Array> {
  const id = `${slot}:${key}`;
  let p = textureCache.get(id);
  if (!p) {
    p = png(slot === 'fuselage' ? fuselageTexture(key) : windowsTexture()).then((bytes) => {
      modelStats.textureBytes.push(bytes.byteLength);
      return bytes;
    });
    textureCache.set(id, p);
  }
  return p;
}

const urlCache = new Map<string, Promise<string>>();
/** GLB blob URL for a model variant, generated once per session. */
export function modelUrl(variant: string, spec: () => VehicleModelSpec): Promise<string> {
  let p = urlCache.get(variant);
  if (!p) {
    p = (async () => {
      const s = spec();
      const images = await Promise.all(s.textures.map((t) => texture(t.slot, t.key)));
      const glb = writeGlb(s.parts, s.materials, images);
      modelStats.variants++;
      return URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    })();
    urlCache.set(variant, p);
    p.catch(() => urlCache.delete(variant));
  }
  return p;
}

// ---------------------------------------------------------------- placement

const scratchEnu = new Matrix4();
const scratchLocal = new Matrix4();

/**
 * World matrix for a model at `position`: built model axes (+X forward, +Y left, +Z up in
 * Cesium's model frame) aligned with the heading/pitch in the local east-north-up frame.
 */
export function placementMatrix(position: Cartesian3, heading: number, pitch: number, scale: [number, number, number], result = new Matrix4()): Matrix4 {
  Transforms.eastNorthUpToFixedFrame(position, undefined, scratchEnu);
  const [sh, ch, sp, cp] = [Math.sin(heading), Math.cos(heading), Math.sin(pitch), Math.cos(pitch)];
  const fwd = [sh * cp, ch * cp, sp]; // east, north, up
  const left = [-ch, sh, 0];
  const up = [fwd[1] * left[2] - fwd[2] * left[1], fwd[2] * left[0] - fwd[0] * left[2], fwd[0] * left[1] - fwd[1] * left[0]];
  const [a, b, c] = scale;
  // Matrix4 constructor takes row-major arguments; columns are forward, left, up.
  Matrix4.clone(new Matrix4(fwd[0] * a, left[0] * b, up[0] * c, 0, fwd[1] * a, left[1] * b, up[1] * c, 0, fwd[2] * a, left[2] * b, up[2] * c, 0, 0, 0, 0, 1), scratchLocal);
  return Matrix4.multiply(scratchEnu, scratchLocal, result);
}

interface Live {
  variant: string;
  model: Model | null;
  /** True only once Cesium has finished processing the model (readyEvent): until then the icon stays. */
  ready: boolean;
  failed: boolean;
  ground: boolean;
}

const SELECTED = Color.fromCssColorString('#ffd84a');

export class VehicleModelLayer {
  private live = new Map<string, Live>();
  /** Variants that failed to build or load: not attempted again this session (no retry loop). */
  private failedVariants = new Set<string>();
  /** When each vehicle last lost its model (flip diagnostics: model → icon → model within 5 s). */
  private removedAt = new Map<string, number>();
  private destroyed = false;

  /** `onReadyChange` runs when a model becomes ready or fails, so icons can be reconciled immediately. */
  constructor(
    private readonly widget: CesiumWidget,
    private readonly onReadyChange: () => void = () => {},
  ) {}

  /** Shows exactly these candidates. Returns the keys whose model is ready (their icons can be hidden). */
  sync(candidates: ModelCandidate[]): Set<string> {
    const want = new Map(candidates.map((c) => [c.key, c]));
    for (const [key, l] of this.live)
      if (!want.has(key) || want.get(key)!.variant !== l.variant) {
        if (l.model) this.widget.scene.primitives.remove(l.model);
        this.live.delete(key);
        setShownModel(key, null);
        modelStats.removed++;
        // Flip diagnostics only track models that were actually displayed.
        if (l.ready) {
          if (this.removedAt.size > 2000) this.removedAt.clear();
          this.removedAt.set(key, performance.now());
        }
      }
    const shown = new Set<string>();
    for (const c of candidates) {
      const l = this.live.get(c.key);
      if (!l) {
        if (!this.failedVariants.has(c.variant)) this.create(c);
        continue;
      }
      if (!l.model || l.failed) continue;
      placementMatrix(c.position, c.heading, c.pitch, c.scale, l.model.modelMatrix);
      if (l.ground !== c.ground) {
        l.model.heightReference = c.ground ? HeightReference.CLAMP_TO_TERRAIN : HeightReference.NONE;
        l.ground = c.ground;
      }
      l.model.silhouetteSize = c.selected ? 2 : 0;
      if (l.ready) shown.add(c.key);
    }
    modelStats.shown = shown.size;
    this.widget.scene.requestRender();
    return shown;
  }

  private fail(key: string, entry: Live, variant: string, error: unknown): void {
    setShownModel(key, null);
    modelStats.failed++;
    modelStats.lastError = String((error as Error)?.message ?? error).slice(0, 300);
    this.failedVariants.add(variant);
    entry.failed = true;
    entry.ready = false;
    if (entry.model) {
      this.widget.scene.primitives.remove(entry.model);
      entry.model = null;
    }
    this.onReadyChange();
  }

  private create(c: ModelCandidate): void {
    const entry: Live = { variant: c.variant, model: null, ready: false, failed: false, ground: c.ground };
    modelStats.created++;
    this.live.set(c.key, entry);
    void (async () => {
      try {
        const url = c.url ?? (c.spec ? await modelUrl(c.variant, c.spec) : null);
        if (!url) throw new Error('model candidate without a model');
        const model = await Model.fromGltfAsync({
          url,
          id: c.key,
          modelMatrix: placementMatrix(c.position, c.heading, c.pitch, c.scale),
          minimumPixelSize: c.minimumPixelSize,
          maximumScale: 400,
          scene: this.widget.scene,
          heightReference: c.ground ? HeightReference.CLAMP_TO_TERRAIN : HeightReference.NONE,
          shadows: ShadowMode.DISABLED,
          silhouetteColor: SELECTED,
          silhouetteSize: c.selected ? 2 : 0,
        });
        if (this.destroyed || this.live.get(c.key) !== entry) {
          model.destroy();
          return;
        }
        // fromGltfAsync resolves before resources are processed; readiness and late failures come as events.
        model.readyEvent.addEventListener(() => {
          if (this.live.get(c.key) !== entry || entry.failed) return;
          entry.ready = true;
          setShownModel(c.key, c.variant);
          modelStats.loaded++;
          // A flip: this vehicle showed a model, lost it, and shows one again within 5 s.
          if (performance.now() - (this.removedAt.get(c.key) ?? -1e9) < 5000) modelStats.flips++;
          this.onReadyChange();
        });
        model.errorEvent.addEventListener((error: unknown) => {
          if (this.live.get(c.key) === entry) this.fail(c.key, entry, c.variant, error);
        });
        entry.model = this.widget.scene.primitives.add(model) as Model;
        this.widget.scene.requestRender();
      } catch (error) {
        // Building or loading failed: the vehicle keeps its icon.
        if (this.live.get(c.key) === entry) this.fail(c.key, entry, c.variant, error);
      }
    })();
  }

  /** Whether a model variant failed this session (callers fall back to another variant). */
  variantFailed(variant: string): boolean {
    return this.failedVariants.has(variant);
  }

  /** Whether this vehicle currently has a model (ready or still loading). */
  has(key: string): boolean {
    const l = this.live.get(key);
    return !!l && !l.failed;
  }

  clear(): void {
    for (const l of this.live.values()) if (l.model) this.widget.scene.primitives.remove(l.model);
    clearShownModels(this.live.keys());
    this.live.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }
}
