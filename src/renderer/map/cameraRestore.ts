import { cameraSchema } from '../../shared/ipc';
import type { Camera } from '../lib/api';

export type CameraMode = '2d' | '3d';
export interface RestoreCameraOptions { mode?: CameraMode; animate?: boolean }
export interface CameraRestoreAdapter {
  mode(): CameraMode | 'morphing' | 'other';
  morphTo(mode: CameraMode): void;
  onMorphComplete(callback: () => void): () => void;
  cancelFlight(): void;
  apply(camera: Camera, animate: boolean, complete: () => void, cancel: () => void): void;
  report(): void;
}
interface Request { camera: Camera; mode: CameraMode; animate: boolean; applying: boolean; resolve(applied: boolean): void }

export function validRestoreCamera(value: unknown): Camera | null {
  const parsed = cameraSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Canonicalize only captured 2D world-wrap longitude; imported coordinates stay strictly validated. */
export function capturedCamera(camera: Camera): Camera | null {
  const lon = camera.lon >= -180 && camera.lon <= 180 ? camera.lon : ((camera.lon + 180) % 360 + 360) % 360 - 180;
  return validRestoreCamera({ ...camera, lon });
}

/** Latest saved camera wins; never apply against Cesium's transient MORPHING frame. */
export class CameraRestorer {
  private adapter: CameraRestoreAdapter | null = null;
  private offMorph: (() => void) | null = null;
  private request: Request | null = null;
  private desiredMode: CameraMode;
  private propMode: CameraMode;
  private unavailable = false;
  constructor(mode: CameraMode) { this.desiredMode = this.propMode = mode; }

  restore(value: unknown, options: RestoreCameraOptions = {}): Promise<boolean> {
    const camera = validRestoreCamera(value);
    if (!camera || this.unavailable || (options.mode !== undefined && options.mode !== '2d' && options.mode !== '3d')) return Promise.resolve(false);
    this.cancel();
    const mode = options.mode ?? this.propMode;
    this.desiredMode = mode;
    return new Promise(resolve => {
      this.request = { camera, mode, animate: options.animate !== false, applying: false, resolve };
      this.pump();
    });
  }

  /** A repeated stale prop does not undo an explicit restore awaiting React's next commit. */
  setMode(mode: CameraMode): void {
    if (mode !== this.propMode) {
      this.propMode = mode;
      if (this.request?.mode !== mode) this.cancel();
      this.desiredMode = mode;
    }
    this.pump();
  }

  attach(adapter: CameraRestoreAdapter): void {
    if (this.adapter) this.detach(this.adapter);
    this.unavailable = false;
    this.adapter = adapter;
    this.offMorph = adapter.onMorphComplete(() => {
      const hadRequest = this.request !== null;
      this.pump();
      // A manual mode change also establishes a newly settled viewport.
      if (!hadRequest && this.adapter === adapter && adapter.mode() !== 'morphing') {
        try { adapter.report(); } catch { /* View reporting is independent from the mode transition. */ }
      }
    });
    this.pump();
  }

  detach(adapter: CameraRestoreAdapter): void {
    if (this.adapter !== adapter) return;
    this.offMorph?.(); this.offMorph = null;
    this.cancel(); this.adapter = null; this.desiredMode = this.propMode;
  }

  fail(): void { this.cancel(); this.unavailable = true; }

  /** Explicit navigation also supersedes an outstanding saved-camera operation. */
  cancel(): void {
    const previous = this.request;
    this.request = null;
    if (!previous) return;
    previous.resolve(false);
    if (previous.applying) {
      try { this.adapter?.cancelFlight(); } catch { /* The superseded operation is already settled. */ }
    }
  }

  private pump(): void {
    const adapter = this.adapter;
    if (!adapter) return;
    try {
      const mode = adapter.mode();
      if (mode === 'morphing') return;
      if (mode !== this.desiredMode) { adapter.morphTo(this.desiredMode); return; }
      const request = this.request;
      if (!request || request.applying) return;
      request.applying = true;
      adapter.cancelFlight();
      adapter.apply(request.camera, request.animate, () => {
        if (this.request !== request || this.adapter !== adapter) return;
        this.request = null;
        request.resolve(true);
        try { adapter.report(); } catch { /* Reporting cannot turn an applied camera into an unresolved restore. */ }
      }, () => {
        if (this.request !== request) return;
        this.request = null; request.resolve(false);
      });
    } catch { this.cancel(); }
  }
}
