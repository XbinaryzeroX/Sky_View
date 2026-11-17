import { Axis, BoxGeometry, Cartesian3, Color, ColorGeometryInstanceAttribute, GeometryInstance, Matrix3, Matrix4, Model, PerInstanceColorAppearance, Primitive, type CesiumWidget } from 'cesium';
import { placementMatrix } from './vehicleModels';
import { cabinSeatPoint, DEFAULT_CABIN_SEAT } from '../../shared/passengerSeats';

// Local aircraft coordinates: X forward, Y left, Z up. Openings contain no geometry,
// so the real globe remains visible through them. This is a generic simulated cabin.
type Part = { center: [number, number, number]; size: [number, number, number]; color: string };
export function interiorParts(mode: 'cockpit' | 'passenger'): Part[] {
  const part = (center: Part['center'], size: Part['size'], color: string): Part => ({ center, size, color });
  if (mode === 'cockpit') return [
    part([0, 0, -2], [12, 7, .25], '#29333d'),
    part([0, 0, 2.4], [12, 7, .25], '#27303a'),
    part([-5.5, 0, 0], [.25, 7, 4.5], '#3b4550'),
    part([3.8, 0, -1.25], [1.6, 6.5, 1.2], '#202c37'),
    part([3.0, 0, -.53], [.22, 6.3, .18], '#677987'),
    ...[-2.65, 0, 2.65].map(y => part([4.5, y, .75], [.28, .25, 3.3], '#3a4b59')),
    ...[-3.35, 3.35].map(y => part([0, y, -.9], [9, .25, 1.8], '#384651')),
    ...[-1.8, -.6, .6, 1.8].map(y => part([2.94, y, -.66], [.08, .9, .48], '#16384b')),
    ...[-1.8, -.6, .6, 1.8].map(y => part([2.88, y, -.62], [.05, .55, .04], '#78c9d4')),
  ];
  return [
    part([0, 0, -2], [16, 7, .25], '#8a8981'),
    part([0, 0, 2.5], [16, 7, .25], '#d9d4c9'),
    part([0, 3.5, 0], [16, .25, 4.5], '#d1cbbf'),
    part([-4.7, -3.5, 0], [6.6, .3, 4.5], '#d1cbbf'),
    part([4.7, -3.5, 0], [6.6, .3, 4.5], '#d1cbbf'),
    part([0, -3.5, -1.45], [2.8, .3, 1.1], '#c9c4ba'),
    part([0, -3.5, 1.7], [2.8, .3, 1.2], '#d9d4c9'),
    ...[-1.35, 1.35].map(x => part([x, -3.35, .1], [.25, .25, 2.2], '#eee9de')),
    part([0, -3.35, 1.1], [2.9, .25, .25], '#eee9de'),
    part([0, -3.35, -.9], [2.9, .25, .25], '#eee9de'),
    part([-4, 1, -.6], [1, 2.5, 2.5], '#364b61'),
    part([4, 1, -.6], [1, 2.5, 2.5], '#364b61'),
  ];
}

export type InteriorStatus = 'loading' | 'ready' | 'error';
export function createAircraftInterior(widget: CesiumWidget, mode: 'cockpit' | 'passenger', onStatus: (status: InteriorStatus) => void = () => {}) {
  const instances = interiorParts(mode).map((p, i) => new GeometryInstance({
    id: `interior|${mode}|${i}`,
    geometry: BoxGeometry.fromDimensions({ dimensions: new Cartesian3(...p.size), vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT }),
    modelMatrix: Matrix4.fromTranslation(new Cartesian3(...p.center)),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(p.color)) },
  }));
  const primitive = widget.scene.primitives.add(new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: true, translucent: false, closed: false }), asynchronous: false, releaseGeometryInstances: false }));
  primitive.show = false;
  const axes = Axis as unknown as { Y_UP_TO_Z_UP: Matrix4; Z_UP_TO_X_UP: Matrix4 };
  const convert = Matrix4.multiplyTransformation(axes.Y_UP_TO_Z_UP, axes.Z_UP_TO_X_UP, new Matrix4());
  const rotation = Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(mode === 'cockpit' ? Math.PI : -Math.PI / 2));
  const reference = new Cartesian3(...(mode === 'cockpit' ? [-.65, -5.15, -28.8] : cabinSeatPoint(DEFAULT_CABIN_SEAT)));
  const refLocal = Matrix4.multiplyByPoint(rotation, Matrix4.multiplyByPoint(convert, reference, new Cartesian3()), new Cartesian3());
  const offset = Matrix4.fromTranslation(Cartesian3.negate(refLocal, new Cartesian3()));
  const localModel = Matrix4.multiply(offset, rotation, new Matrix4());
  let model: Model | null = null;
  let closed = false;
  let base = Matrix4.IDENTITY;
  onStatus('loading');
  void Model.fromGltfAsync({ url: `/interior-models/${mode === 'cockpit' ? 'boeing-757-cockpit-fast.glb' : 'airplane-cabin-fast.glb'}`, id: `interior-model|${mode}`, modelMatrix: Matrix4.clone(base), allowPicking: false, backFaceCulling: false, incrementallyLoadTextures: true }).then(loaded => {
    if (closed || widget.isDestroyed()) { loaded.destroy(); return; }
    model = widget.scene.primitives.add(loaded);
    loaded.readyEvent.addEventListener(() => { if (!closed) widget.scene.requestRender(); });
    loaded.texturesReadyEvent.addEventListener(() => { if (!closed) { onStatus('ready'); widget.scene.requestRender(); } });
    loaded.errorEvent.addEventListener(() => { if (!closed) onStatus('error'); });
    widget.scene.requestRender();
  }).catch(() => { if (!closed) onStatus('error'); });
  return {
    update(position: Cartesian3, heading: number, pitch: number, bank: number, seat = DEFAULT_CABIN_SEAT): Cartesian3 {
      placementMatrix(position, heading, pitch, [1, 1, 1], primitive.modelMatrix, bank);
      base = Matrix4.clone(primitive.modelMatrix, new Matrix4());
      if (model) Matrix4.multiply(base, localModel, model.modelMatrix);
      if (mode !== 'passenger' || !model?.ready) return position;
      const raw = new Cartesian3(...cabinSeatPoint(seat));
      const local = Matrix4.multiplyByPoint(localModel, Matrix4.multiplyByPoint(convert, raw, new Cartesian3()), new Cartesian3());
      return Matrix4.multiplyByPoint(base, local, new Cartesian3());
    },
    destroy() { closed = true; if (!widget.isDestroyed()) { widget.scene.primitives.remove(primitive); if (model) widget.scene.primitives.remove(model); } },
  };
}
