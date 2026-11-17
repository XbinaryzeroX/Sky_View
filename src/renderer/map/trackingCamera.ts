import { CallbackPositionProperty, Cartesian3, Cartographic, Color, HeadingPitchRange, Math as CMath, Matrix4, OrthographicOffCenterFrustum, SceneMode, TrackingReferenceFrame, type CesiumWidget } from 'cesium';
import { cockpitUnavailable } from '../../shared/trackingCamera';
import type { GeoRecord, LayerId } from '../../shared/layers';
import { createAircraftInterior } from './aircraftInterior';
import type { InteriorStatus } from './aircraftInterior';

/** Track the same visible position used by the aircraft renderer, retaining Cesium's orbit and zoom controls. */
export function attachPassengerFollow(widget: CesiumWidget, position: () => Cartesian3 | undefined,
  reportView: () => void, onUnavailable: (reason: string) => void): () => void {
  const { scene } = widget;
  const unavailable = 'Follow ended because the flight is no longer visible in the current aircraft layer.';
  if (!position()) {
    onUnavailable(unavailable);
    return () => {};
  }
  widget.camera.cancelFlight();
  // CesiumWidget updates its EntityView on later ticks only when a visualizer supplies a bounding sphere.
  // A stand-alone Entity with just a position can acquire the flight once and then leave the camera behind.
  const anchor = widget.entities.add({
    id: 'atlas-passenger-follow',
    position: new CallbackPositionProperty(position, false),
    point: { pixelSize: 1, color: Color.TRANSPARENT, outlineColor: Color.TRANSPARENT },
    viewFrom: new Cartesian3(0, -2500, 1200),
    trackingReferenceFrame: TrackingReferenceFrame.ENU,
  });
  const acquire = () => {
    const camera = widget.camera;
    // EntityView ignores viewFrom in 2D and carries the old map center into the new reference frame.
    // Center it once, preserving the user's map zoom. Further ticks carry that center with the flight.
    if (scene.mode === SceneMode.SCENE2D && camera.frustum instanceof OrthographicOffCenterFrustum) {
      const target = position();
      const { left, right } = camera.frustum;
      if (target && left !== undefined && right !== undefined && right > left) {
        camera.lookAt(target, new HeadingPitchRange(camera.heading, -CMath.PI_OVER_TWO, right - left));
      }
    }
    widget.trackedEntity = anchor;
    scene.requestRender();
  };
  const removeMorph = scene.morphComplete.addEventListener(acquire);
  let lastViewAt = -Infinity;
  let disposed = false;
  const removeFrame = scene.postRender.addEventListener(() => {
    if (scene.mode === SceneMode.MORPHING) return;
    if (widget.trackedEntity !== anchor || !position()) {
      const reason = widget.trackedEntity === anchor ? unavailable : 'Follow ended when the camera changed views.';
      dispose();
      onUnavailable(reason);
      return;
    }
    // A constantly moving camera can go minutes without a moveEnd. Keep the ordinary area poll centered.
    const now = performance.now();
    if (now - lastViewAt >= 20_000 && !Matrix4.equals(widget.camera.transform, Matrix4.IDENTITY)) {
      lastViewAt = now;
      reportView();
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    removeFrame();
    removeMorph();
    if (widget.isDestroyed()) return;
    if (widget.trackedEntity === anchor) widget.trackedEntity = undefined;
    widget.entities.remove(anchor);
    scene.requestRender();
  };
  if (scene.mode !== SceneMode.MORPHING) acquire();
  return dispose;
}

interface CockpitSource {
  layer: LayerId;
  record(): GeoRecord | null | undefined;
  position(): Cartesian3 | undefined;
  heading?(): number | null | undefined;
  attitude?(): { pitch: number; bank: number } | undefined;
  seat?(): string;
  interiorStatus?(status: InteriorStatus): void;
  hideOwnVehicle(hidden: boolean): void;
}

/** Camera on the displayed position. The limited look angles and estimated attitude are visual simulations. */
export function attachCockpit(widget: CesiumWidget, source: CockpitSource, onUnavailable: (reason: string) => void, mode: 'cockpit' | 'passenger' = 'cockpit'): () => void {
  const camera = widget.camera;
  const scene = widget.scene;
  if (scene.mode !== SceneMode.SCENE3D) { onUnavailable('Cockpit perspective requires a settled 3D scene.'); return () => {}; }
  const controller = scene.screenSpaceCameraController;
  const previous = {
    position: Cartesian3.clone(camera.positionWC), direction: Cartesian3.clone(camera.directionWC), up: Cartesian3.clone(camera.upWC),
    inputs: controller.enableInputs, minimumZoom: controller.minimumZoomDistance, maximumTilt: controller.maximumTiltAngle,
    near: camera.frustum?.near,
  };
  widget.trackedEntity = undefined;
  camera.cancelFlight();
  camera.lookAtTransform(Matrix4.IDENTITY);
  controller.enableInputs = false;
  controller.minimumZoomDistance = 1;
  controller.maximumTiltAngle = CMath.PI_OVER_TWO;
  if (camera.frustum) camera.frustum.near = .05;
  source.hideOwnVehicle(true);
  const interior = scene.primitives ? createAircraftInterior(widget, mode, source.interiorStatus) : null;
  let disposed = false;
  let lastUpdate = -Infinity;
  let yaw = 0;
  let pitch = 0;
  let aircraftPitch = 0;
  let dragging: { id: number; x: number; y: number } | null = null;
  const canvas = scene.canvas;
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas?.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const nextYaw = yaw + (event.clientX - dragging.x) * 0.004;
    yaw = mode === 'passenger' ? CMath.negativePiToPi(nextYaw) : CMath.clamp(nextYaw, -CMath.toRadians(50), CMath.toRadians(50));
    const pitchLimit = CMath.toRadians(mode === 'passenger' ? 80 : 35);
    pitch = CMath.clamp(pitch - (event.clientY - dragging.y) * 0.004, -pitchLimit, pitchLimit);
    dragging.x = event.clientX; dragging.y = event.clientY;
    scene.requestRender();
  };
  const up = (event: PointerEvent) => { if (dragging?.id === event.pointerId) dragging = null; };
  canvas?.addEventListener('pointerdown', down);
  canvas?.addEventListener('pointermove', move);
  canvas?.addEventListener('pointerup', up);
  canvas?.addEventListener('pointercancel', up);
  let removeTick = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    removeTick();
    interior?.destroy();
    canvas?.removeEventListener('pointerdown', down);
    canvas?.removeEventListener('pointermove', move);
    canvas?.removeEventListener('pointerup', up);
    canvas?.removeEventListener('pointercancel', up);
    source.hideOwnVehicle(false);
    if (widget.isDestroyed()) return;
    controller.enableInputs = previous.inputs;
    controller.minimumZoomDistance = previous.minimumZoom;
    controller.maximumTiltAngle = previous.maximumTilt;
    if (camera.frustum && previous.near !== undefined) camera.frustum.near = previous.near;
    // Cesium forbids lookAtTransform while morphing. A changed scene mode owns its new camera projection.
    if (scene.mode === SceneMode.SCENE3D) {
      camera.lookAtTransform(Matrix4.IDENTITY);
      camera.setView({ destination: previous.position, orientation: { direction: previous.direction, up: previous.up } });
    }
    scene.requestRender();
  };
  const fail = (reason: string) => { dispose(); onUnavailable(reason); };
  const update = () => {
    if (disposed || widget.isDestroyed()) return;
    if (scene.mode !== SceneMode.SCENE3D) { fail('Cockpit perspective requires 3D mode.'); return; }
    const now = Date.now();
    if (now - lastUpdate < 16) { scene.requestRender(); return; }
    const elapsed = Number.isFinite(lastUpdate) ? Math.max(0, Math.min((now - lastUpdate) / 1000, 1)) : 0;
    lastUpdate = now;
    const record = source.record();
    const reason = cockpitUnavailable(source.layer, record, now);
    if (reason) { fail(reason); return; }
    const position = source.position();
    if (!position) { fail('The aircraft is filtered out or no longer visible in its layer.'); return; }
    const cartographic = Cartographic.fromCartesian(position);
    const ground = scene.globe.getHeight(cartographic);
    if (ground !== undefined && cartographic.height <= ground + 10) {
      fail('Reported aircraft height is too close to the loaded terrain for cockpit perspective.'); return;
    }
    const attitude = source.attitude?.() ?? { pitch: 0, bank: 0 };
    aircraftPitch += (attitude.pitch - aircraftPitch) * (1 - Math.exp(-elapsed / 1.5));
    const relative = (mode === 'passenger' ? CMath.PI_OVER_TWO : 0) + yaw;
    const heading = CMath.toRadians(source.heading?.() ?? record!.heading!);
    const eye = interior?.update(position, heading, aircraftPitch, attitude.bank, source.seat?.()) ?? position;
    camera.setView({ destination: eye, orientation: {
      heading: heading + relative,
      pitch: CMath.toRadians(-5) + pitch + aircraftPitch * Math.cos(relative) - attitude.bank * Math.sin(relative),
      roll: attitude.bank * Math.cos(relative) + aircraftPitch * Math.sin(relative),
    } });
    scene.requestRender();
  };
  removeTick = scene.preRender.addEventListener(update);
  update();
  return dispose;
}
