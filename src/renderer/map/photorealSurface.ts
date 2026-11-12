import { Cartesian2, SceneMode, type Cesium3DTileset, type CesiumWidget } from 'cesium';
import { isMappedWater, oceanFocusPixel, regionalWater } from './coastalFocus';

const ENTER_M = 40_000;
const LEAVE_M = 50_000;
const RECHECK_MS = 250;
const CLOSE_WATER_M = 3000;

/** Keep continuous imagery behind partial mesh coverage, and use imagery at ship scale over mapped ocean. */
export function watchPhotorealSurface(widget: CesiumWidget, tiles: Cesium3DTileset, onCovered: (covered: boolean) => void, readWater = isMappedWater, readRegion = regionalWater): () => void {
  const { scene, camera } = widget;
  const screen = new Cartesian2();
  let near = false, covered = false, dirty = true, moving = false, disposed = false;
  let ocean = false, oceanKey = '', oceanRequest = 0;
  let pending: boolean | null = null, nextCheck = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function setCovered(value: boolean) {
    if (covered === value) return;
    covered = value;
    onCovered(value);
    scene.requestRender();
  }
  function invalidate() {
    dirty = true;
    if (!disposed) scene.requestRender();
  }
  function clearFocus() {
    oceanRequest++;
    oceanKey = '';
    ocean = false;
  }
  function updateRange() {
    if (disposed) return;
    near = scene.mode === SceneMode.SCENE3D && camera.positionCartographic.height < (near ? LEAVE_M : ENTER_M);
    // Traverse the mesh on approach; the globe also draws underneath uncovered parts of every tile.
    if (!near) clearFocus();
    tiles.show = near && !ocean;
    if (!near) {
      pending = null;
      setCovered(false);
    }
    invalidate();
  }
  const check = () => {
    if (disposed || !near || (!dirty && !moving)) return;
    const now = performance.now();
    if (now < nextCheck) {
      timer ??= setTimeout(() => { timer = undefined; invalidate(); }, Math.ceil(nextCheck - now));
      return;
    }
    dirty = false;
    nextCheck = now + RECHECK_MS;
    const canvas = scene.canvas;
    screen.x = canvas.clientWidth / 2;
    screen.y = canvas.clientHeight / 2;
    let world = camera.pickEllipsoid(screen, scene.globe.ellipsoid);
    if (!world) {
      // An oblique view can aim above the horizon while the foreground still contains land or water.
      screen.y = canvas.clientHeight * 0.8;
      world = camera.pickEllipsoid(screen, scene.globe.ellipsoid);
    }
    const at = world && scene.globe.ellipsoid.cartesianToCartographic(world);
    // For a nearly horizontal camera the center can hit a distant island; the more useful
    // surface for a close ship view is under the foreground, below the horizon.
    let focus = at;
    if (camera.positionCartographic.height < CLOSE_WATER_M && camera.pitch > -Math.PI / 12) {
      screen.y = canvas.clientHeight * 0.75;
      const foreground = camera.pickEllipsoid(screen, scene.globe.ellipsoid);
      if (foreground) focus = scene.globe.ellipsoid.cartesianToCartographic(foreground);
    }
    const regional = camera.positionCartographic.height >= CLOSE_WATER_M;
    const pixel = focus && oceanFocusPixel(focus);
    if (pixel) {
      const samples = new Map([[pixel.x + '/' + pixel.y, pixel]]);
      const columns = regional ? [0.04, 0.26, 0.5, 0.74, 0.96] : [0.1, 0.5, 0.9];
      const rows = regional ? [0.05, 0.3, 0.55, 0.8, 0.97] : [0.38, 0.68, 0.92];
      for (const fy of rows) for (const fx of columns) {
        screen.x = canvas.clientWidth * fx; screen.y = canvas.clientHeight * fy;
        const point = camera.pickEllipsoid(screen, scene.globe.ellipsoid);
        const sample = point && oceanFocusPixel(scene.globe.ellipsoid.cartesianToCartographic(point));
        if (sample) samples.set(sample.x + '/' + sample.y, sample);
      }
      const footprint = [...samples.values()];
      const precision = regional ? 9 : 2;
      const key = (regional ? 'region:' : 'local:') + footprint.map(p => (p.x >> precision) + '/' + (p.y >> precision)).join(',');
      if (key !== oceanKey) {
        oceanKey = key;
        const request = ++oceanRequest;
        if (regional) { ocean = true; tiles.show = false; setCovered(false); }
        const local = async () => {
          const results = await Promise.all(footprint.map(p => readWater(p).catch(() => null)));
          if (results.some(value => value === true)) return true;
          return results.includes(null) ? readRegion(footprint) : false;
        };
        void (regional ? readRegion(footprint) : local()).catch(() => null).then(value => {
          if (disposed || request !== oceanRequest) return;
          const previouslyOcean = ocean;
          ocean = value !== false;
          tiles.show = near && !ocean;
          // Drop a failed lookup so a later camera or tile event can retry.
          if (value === null) oceanKey = '';
          if (ocean) { pending = null; setCovered(false); }
          if (value !== null || previouslyOcean) invalidate();
        });
      }
    } else if (oceanKey) {
      clearFocus();
      tiles.show = near;
    }
    const current = tiles.show && !!at && Number.isFinite(tiles.getHeight(at, scene));
    if (current === covered) pending = null;
    else if (pending === current) {
      pending = null;
      setCovered(current);
    } else {
      pending = current;
      // Confirm with a fresh center ray next time. This also works in request-render mode with a still camera.
      timer ??= setTimeout(() => { timer = undefined; invalidate(); }, RECHECK_MS);
    }
  };
  const off = [
    scene.postRender.addEventListener(check), camera.changed.addEventListener(updateRange),
    camera.moveStart.addEventListener(() => { moving = true; updateRange(); }),
    camera.moveEnd.addEventListener(() => { moving = false; updateRange(); }),
    scene.morphStart.addEventListener(() => { near = false; clearFocus(); tiles.show = false; pending = null; setCovered(false); }),
    scene.morphComplete.addEventListener(updateRange), tiles.tileLoad.addEventListener(invalidate),
    tiles.tileUnload.addEventListener(invalidate), tiles.allTilesLoaded.addEventListener(invalidate),
  ];
  updateRange();
  return () => {
    disposed = true;
    clearTimeout(timer);
    for (const remove of off) remove();
  };
}
