// Playwright renderer-side probe. Read the model or billboard Cesium actually submitted, once per
// rendered frame. This stays in the test process and needs no new app debug or preload interface.
export function installFlightPoseProbe(id) {
  const canvas = document.querySelector('.cesium-widget canvas');
  if (!canvas) throw new Error('Cesium canvas not available');
  // The packaged globe owns the CesiumWidget in a React ref. Looking it up here avoids importing
  // a second Cesium instance or inferring where an aircraft was drawn from the prediction formula.
  let widget;
  for (let el = canvas; el && !widget; el = el.parentElement) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    for (let fiber = el[key]; fiber && !widget; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const ref = hook.memoizedState?.current;
        if (ref?.scene?.postRender && ref?.dataSources && ref.canvas === canvas) { widget = ref; break; }
      }
    }
  }
  if (!widget) throw new Error('Globe widget ref unavailable');
  const scene = widget.scene;
  const primitiveId = 'rec|aircraft|' + id;
  let batch;
  function batchedBillboard() {
    if (batch && !batch.collection.isDestroyed() && batch.collection.contains(batch.point)) return batch.point;
    for (let i = 0; i < scene.primitives.length; i++) {
      const collection = scene.primitives.get(i);
      if (!collection.show || !collection.get || !collection.contains || !Number.isFinite(collection.length)) continue;
      for (let j = 0; j < collection.length; j++) {
        const point = collection.get(j);
        if (point.id === primitiveId && point.position) {
          batch = { collection, point };
          return point;
        }
      }
    }
    return null;
  }
  function read() {
    let target;
    let kind;
    for (let i = 0; i < scene.primitives.length; i++) {
      const item = scene.primitives.get(i);
      if (item.id === primitiveId && item.modelMatrix && item.ready && item.show) {
        const m = item.modelMatrix;
        target = { x: m[12], y: m[13], z: m[14] };
        kind = 'model';
        break;
      }
    }
    if (!target) {
      const source = widget.dataSources.getByName('layer-aircraft')[0];
      const entity = source?.entities.getById(primitiveId);
      if (source?.show && entity?.isShowing && entity.billboard?.show?.getValue(widget.clock.currentTime) !== false) {
        target = entity.position?.getValue(widget.clock.currentTime);
        kind = 'billboard';
      }
    }
    if (!target) {
      const point = batchedBillboard();
      if (point?.show) { target = point.position; kind = 'batched billboard'; }
    }
    if (!target) return null;
    const point = scene.cartesianToCanvasCoordinates(target);
    if (!point) return null;
    const rect = canvas.getBoundingClientRect();
    const carto = scene.globe.ellipsoid.cartesianToCartographic(target);
    const camera = widget.camera.positionWC;
    return { time: performance.now(), kind, sceneMode: scene.mode, x: target.x, y: target.y, z: target.z,
      lat: carto.latitude * 180 / Math.PI, lon: carto.longitude * 180 / Math.PI,
      cx: camera.x, cy: camera.y, cz: camera.z, pageX: rect.left + point.x, pageY: rect.top + point.y,
      centerErrorPx: Math.hypot(point.x - rect.width / 2, point.y - rect.height / 2) };
  }
  window.__qaFlightPose?.dispose();
  const frames = [];
  const off = scene.postRender.addEventListener(() => {
    if (frames.length >= 12000) frames.shift();
    const sample = read();
    if (sample) frames.push(sample);
  });
  const state = () => {
    const camera = widget.camera, entity = widget.dataSources.getByName('layer-aircraft')[0]?.entities.getById(primitiveId);
    const carto = camera.positionCartographic, position = entity?.position?.getValue(widget.clock.currentTime);
    const projected = position && scene.cartesianToCanvasCoordinates(position);
    return { mode: scene.mode, tracked: widget.trackedEntity?.id ?? null, entityVisible: entity?.isShowing,
      lon: carto.longitude * 180 / Math.PI, lat: carto.latitude * 180 / Math.PI, height: carto.height,
      projected: projected && [projected.x, projected.y], width: canvas.clientWidth, heightPixels: canvas.clientHeight,
      frustum: [camera.frustum.left, camera.frustum.right, camera.frustum.top, camera.frustum.bottom] };
  };
  window.__qaFlightPose = { read, state, mark: () => performance.now(), frames: (since = 0) => frames.filter(f => f.time >= since), dispose: off };
}
