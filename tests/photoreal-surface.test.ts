import { Cartesian3, Ellipsoid, Event, SceneMode, type Cesium3DTileset, type CesiumWidget } from 'cesium';
import { afterEach, expect, it, vi } from 'vitest';
import { watchPhotorealSurface } from '../src/renderer/map/photorealSurface';
import { oceanFocusPixel } from '../src/renderer/map/coastalFocus';
import { Cartographic } from 'cesium';

afterEach(() => vi.useRealTimers());
it('requires coverage at the actual view, retains the globe under gaps, and ignores mesh updates in 2D', () => {
  vi.useFakeTimers();
  const globe = { ellipsoid: Ellipsoid.WGS84, show: true };
  const scene = { globe, canvas: { clientWidth: 800, clientHeight: 600 }, mode: SceneMode.SCENE3D, requestRender: vi.fn(),
    postRender: new Event(), morphStart: new Event(), morphComplete: new Event() };
  let focus = 25, sky = false;
  const camera = { changed: new Event(), moveStart: new Event(), moveEnd: new Event(), positionCartographic: { height: 1300 },
    pickEllipsoid: vi.fn((point: { y: number }) => sky ? undefined : point.y === 300 ? undefined : Cartesian3.fromDegrees(focus,60)) };
  const getHeight = vi.fn((p: { longitude: number }) => p.longitude > 0.5 ? -12 : undefined);
  const tiles = { show: false, getHeight, tileLoad: new Event(), tileUnload: new Event(), allTilesLoaded: new Event() };
  const changed = vi.fn(), stop = watchPhotorealSurface({scene,camera} as unknown as CesiumWidget, tiles as unknown as Cesium3DTileset, changed, async () => false);
  const frame = () => { vi.advanceTimersByTime(300); scene.postRender.raiseEvent(); };
  expect(tiles.show).toBe(true); // root may load, but there is no surface initially at this point
  frame(); frame(); expect(globe.show).toBe(true);
  camera.moveStart.raiseEvent(); focus = 35; frame(); // first valid sample below the horizon
  focus = 25; frame(); expect(globe.show).toBe(true); // stale geography must never switch the surface
  focus = 35; frame(); frame(); expect(globe.show).toBe(true); // retain imagery even for negative mesh elevations
  camera.moveEnd.raiseEvent(); sky = true; frame(); frame(); expect(globe.show).toBe(true);
  expect(changed.mock.calls).toEqual([[true],[false]]);
  scene.mode = SceneMode.SCENE2D; scene.morphComplete.raiseEvent();
  const reads = getHeight.mock.calls.length;
  sky = false; tiles.tileLoad.raiseEvent(); frame(); frame();
  expect(tiles.show).toBe(false); expect(getHeight).toHaveBeenCalledTimes(reads);
  scene.mode = SceneMode.SCENE3D; camera.positionCartographic.height = 60_000; scene.morphComplete.raiseEvent();
  expect(tiles.show).toBe(false);
  stop(); camera.positionCartographic.height = 2000; camera.changed.raiseEvent(); frame();
  expect(tiles.show).toBe(false); expect(changed).toHaveBeenCalledTimes(2);
});

it('uses imagery for a close mapped ocean and rejects stale answers after moving or leaving 3D', async () => {
  vi.useFakeTimers();
  let longitude = 25;
  const globe = { ellipsoid: Ellipsoid.WGS84, show: true };
  const scene = { globe, canvas: { clientWidth: 800, clientHeight: 600 }, mode: SceneMode.SCENE3D, requestRender: vi.fn(),
    postRender: new Event(), morphStart: new Event(), morphComplete: new Event() };
  const camera = { changed: new Event(), moveStart: new Event(), moveEnd: new Event(), positionCartographic: { height: 110 }, pitch: -0.05,
    pickEllipsoid: (p: {y:number}) => Cartesian3.fromDegrees(p.y > 360 ? longitude : 28, 60) };
  const tiles = { show: false, getHeight: vi.fn(() => -22), tileLoad: new Event(), tileUnload: new Event(), allTilesLoaded: new Event() };
  const pending = new Map<number, (value: boolean | null) => void>();
  const deferred = new Set([25,26,27,29].map(lon => oceanFocusPixel(Cartographic.fromDegrees(lon,60))!.x));
  const latitude = oceanFocusPixel(Cartographic.fromDegrees(25,60))!.y;
  const read = vi.fn((p: { x: number; y: number }) => !deferred.has(p.x) || p.y !== latitude ? Promise.resolve(true) :
    new Promise<boolean | null>(resolve => pending.set(p.x,resolve)));
  const offline = vi.fn(async () => false);
  const stop = watchPhotorealSurface({scene,camera} as unknown as CesiumWidget, tiles as unknown as Cesium3DTileset, vi.fn(), read, offline);
  const frame = () => { vi.advanceTimersByTime(300); scene.postRender.raiseEvent(); };
  const resolveAt = (lon: number, value: boolean | null) => pending.get(oceanFocusPixel(Cartographic.fromDegrees(lon,60))!.x)!(value);
  camera.moveStart.raiseEvent(); frame();
  expect(read).toHaveBeenCalledWith(oceanFocusPixel(Cartographic.fromDegrees(25,60)));
  expect(read).toHaveBeenCalledWith(oceanFocusPixel(Cartographic.fromDegrees(28,60)));
  longitude=26; frame();
  resolveAt(26,true); await vi.advanceTimersByTimeAsync(0);
  expect(tiles.show).toBe(false); expect(globe.show).toBe(true);
  resolveAt(25,false); await vi.advanceTimersByTimeAsync(0); expect(tiles.show).toBe(false);
  longitude=27; frame();
  resolveAt(27,null); await vi.advanceTimersByTimeAsync(0);
  expect(tiles.show).toBe(true);
  longitude=29; frame();
  scene.morphStart.raiseEvent(); resolveAt(29,false); await vi.advanceTimersByTimeAsync(0);
  expect(tiles.show).toBe(false); expect(globe.show).toBe(true);
  stop();
});

it('wraps ocean mask longitude at the date line and leaves polar views alone', () => {
  expect(oceanFocusPixel(Cartographic.fromDegrees(180,60))).toEqual(oceanFocusPixel(Cartographic.fromDegrees(-180,60)));
  expect(oceanFocusPixel(Cartographic.fromDegrees(0,86))).toBeNull();
});

it('keeps the photoreal mesh when a close view contains land and water', async () => {
  vi.useFakeTimers();
  const scene = { globe: { ellipsoid: Ellipsoid.WGS84, show: true }, canvas: { clientWidth: 800, clientHeight: 600 },
    mode: SceneMode.SCENE3D, requestRender: vi.fn(), postRender: new Event(), morphStart: new Event(), morphComplete: new Event() };
  const camera = { changed: new Event(), moveStart: new Event(), moveEnd: new Event(), positionCartographic: { height: 800 }, pitch: -0.5,
    pickEllipsoid: (p: { x: number }) => Cartesian3.fromDegrees(p.x < 400 ? -74.02 : -74.00, 40.71) };
  const tiles = { show: false, getHeight: vi.fn(() => 5), tileLoad: new Event(), tileUnload: new Event(), allTilesLoaded: new Event() };
  const water = oceanFocusPixel(Cartographic.fromDegrees(-74.02, 40.71))!;
  const stop = watchPhotorealSurface({ scene, camera } as unknown as CesiumWidget, tiles as unknown as Cesium3DTileset,
    vi.fn(), async point => point.x === water.x, async () => false);
  vi.advanceTimersByTime(300); scene.postRender.raiseEvent();
  await vi.advanceTimersByTimeAsync(0);
  expect(tiles.show).toBe(true);
  stop();
});

it('checks detailed land before hiding a regional city view', async () => {
  vi.useFakeTimers();
  const scene = { globe: { ellipsoid: Ellipsoid.WGS84, show: true }, canvas: { clientWidth: 800, clientHeight: 600 },
    mode: SceneMode.SCENE3D, requestRender: vi.fn(), postRender: new Event(), morphStart: new Event(), morphComplete: new Event() };
  const camera = { changed: new Event(), moveStart: new Event(), moveEnd: new Event(), positionCartographic: { height: 5000 }, pitch: -0.5,
    pickEllipsoid: (p: { x: number }) => Cartesian3.fromDegrees(p.x < 400 ? -74.02 : -74.00, 40.71) };
  const tiles = { show: false, getHeight: vi.fn(() => 5), tileLoad: new Event(), tileUnload: new Event(), allTilesLoaded: new Event() };
  const water = oceanFocusPixel(Cartographic.fromDegrees(-74.02, 40.71))!;
  const stop = watchPhotorealSurface({ scene, camera } as unknown as CesiumWidget, tiles as unknown as Cesium3DTileset,
    vi.fn(), async point => point.x === water.x, async () => true);
  vi.advanceTimersByTime(300); scene.postRender.raiseEvent();
  await vi.advanceTimersByTimeAsync(0);
  expect(tiles.show).toBe(true);
  stop();
});
