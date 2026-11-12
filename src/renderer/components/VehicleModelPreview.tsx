import { useEffect, useRef, useState } from 'react';
import { Cartesian3, CesiumWidget, Color, DirectionalLight, HeadingPitchRange, Math as CesiumMath, Matrix4, Model, Transforms } from 'cesium';
import { RotateCcw, RotateCw } from 'lucide-react';
import type { VehicleAppearance } from '../map/vehicleAppearance';
import { modelUrl } from '../map/vehicleModels';

/** The detail card draws the same credited mesh or representative shape as the map. */
export function VehicleModelPreview({ model, title, onError }: { model: VehicleAppearance; title: string; onError(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const rotate = useRef<(degrees: number) => void>(() => {});
  const pointer = useRef<{ id: number; x: number } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let widget: CesiumWidget | undefined;
    let disposed = false;
    const fail = () => { if (!disposed) onError(); };
    try {
      widget = new CesiumWidget(host.current, {
        globe: false, baseLayer: false, skyBox: false, skyAtmosphere: false, scene3DOnly: true,
        shouldAnimate: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
        targetFrameRate: 24, showRenderLoopErrors: false, msaaSamples: 2,
        contextOptions: { webgl: { alpha: true } },
      });
      const scene = widget.scene;
      scene.backgroundColor = Color.TRANSPARENT;
      scene.screenSpaceCameraController.enableInputs = false;
      scene.fog.enabled = false;
      scene.highDynamicRange = false;
      scene.renderError.addEventListener(fail);
      const origin = Cartesian3.fromDegrees(0, 0);
      const target = Cartesian3.fromDegrees(0, 0);
      // Model noses follow local east. Start broadside so the profile reads clearly in a narrow card.
      let heading = 171;
      const aim = (degrees: number) => {
        heading = (heading + degrees) % 360;
        scene.camera.lookAt(target, new HeadingPitchRange(
          CesiumMath.toRadians(heading), CesiumMath.toRadians(-11), Math.max(model.lengthM, model.widthM) * 1.17,
        ));
        scene.light = new DirectionalLight({ direction: Cartesian3.normalize(
          Cartesian3.add(scene.camera.directionWC, new Cartesian3(-0.6, 0, -0.4), new Cartesian3()), new Cartesian3()),
          intensity: 2.2 });
        scene.requestRender();
      };
      rotate.current = aim;
      aim(0);
      const matrix = Transforms.eastNorthUpToFixedFrame(origin);
      Matrix4.multiplyByScale(matrix, new Cartesian3(...model.scale), matrix);
      const source = model.url ? Promise.resolve(model.url) : modelUrl(model.variant, model.spec!);
      source.then(url => disposed ? undefined : Model.fromGltfAsync({ url, modelMatrix: matrix }))
        .then(asset => {
          if (!asset) return;
          if (disposed) { asset.destroy(); return; }
          asset.readyEvent.addEventListener(() => {
            if (disposed) return;
            Cartesian3.clone(asset.boundingSphere.center, target);
            aim(0);
            setReady(true);
          });
          asset.errorEvent.addEventListener(fail);
          scene.primitives.add(asset);
          scene.requestRender();
        }).catch(fail);
    } catch { fail(); }
    return () => {
      disposed = true;
      rotate.current = () => {};
      if (widget && !widget.isDestroyed()) widget.destroy();
    };
  }, [model, onError]);
  return <div className="flight-preview" aria-label={`3D model of ${title}`}>
    <div className="flight-preview-canvas" ref={host} onPointerDown={event => {
      if (event.button !== 0) return;
      pointer.current = { id: event.pointerId, x: event.clientX };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onLostPointerCapture={() => { pointer.current = null; }} onPointerMove={event => {
      const previous = pointer.current;
      if (previous?.id !== event.pointerId) return;
      rotate.current((previous.x - event.clientX) * 0.55);
      previous.x = event.clientX;
    }} />
    {!ready && <span className="flight-preview-loading" role="status">Loading model…</span>}
    {ready && <div className="flight-rotate">
      <button type="button" title="Rotate left" aria-label="Rotate model left" onClick={() => rotate.current(-25)}><RotateCcw size={15}/></button>
      <button type="button" title="Rotate right" aria-label="Rotate model right" onClick={() => rotate.current(25)}><RotateCw size={15}/></button>
    </div>}
  </div>;
}
