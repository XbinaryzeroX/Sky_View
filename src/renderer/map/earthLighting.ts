import {
  Cartesian3, Transforms, Credit, DirectionalLight, ImageryLayer, JulianDate,
  Matrix3, Simon1994PlanetaryPositions, SingleTileImageryProvider, type CesiumWidget,
} from 'cesium';
import { gibsImageryProvider, gibsProduct } from './imageryOverlay';

export type EarthLighting = { mode: 'day' | 'now' } | { mode: 'custom'; utc: string };

/** UTC wall time displayed by the controls, independent of the machine's time zone. */
export function utcMinute(date: Date): string { return date.toISOString().slice(0, 16); }

export function validLightingTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const at = new Date(value + ':00Z');
  return Number.isFinite(at.getTime()) && utcMinute(at) === value;
}

export function loadEarthLighting(): EarthLighting {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas.earthLighting') ?? 'null');
    if (saved?.mode === 'now') return { mode: 'now' };
    if (saved?.mode === 'custom' && validLightingTime(saved.utc)) return { mode: 'custom', utc: saved.utc };
  } catch { /* Daylight is also usable without local storage. */ }
  return { mode: 'day' };
}

/** Direction in Earth-fixed coordinates travelled by sunlight at the specified instant. */
export function sunlightDirection(at: Date): Cartesian3 {
  const date = JulianDate.fromDate(at);
  const sun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(date);
  const rotation = Transforms.computeIcrfToCentralBodyFixedMatrix(date)
    ?? Transforms.computeTemeToPseudoFixedMatrix(date);
  Matrix3.multiplyByVector(rotation, sun, sun);
  return Cartesian3.negate(Cartesian3.normalize(sun, sun), sun);
}

export function lightGlobe(widget: CesiumWidget, lighting: EarthLighting): () => void {
  if (lighting.mode === 'day') return () => {};
  const scene = widget.scene;
  const previous = scene.light;
  const at = () => lighting.mode === 'custom' ? new Date(lighting.utc + ':00Z') : new Date();
  const sunlight = new DirectionalLight({ direction: sunlightDirection(at()), intensity: 1 });
  scene.light = sunlight;
  const update = () => {
    Cartesian3.clone(sunlightDirection(at()), sunlight.direction);
    scene.requestRender();
  };
  scene.requestRender();
  const timer = lighting.mode === 'now' ? setInterval(update, 60_000) : undefined;
  return () => {
    clearInterval(timer);
    if (!widget.isDestroyed() && scene.light === sunlight) {
      scene.light = previous;
      scene.requestRender();
    }
  };
}

export function nightLightsLayers(): ImageryLayer[] {
  // Cesium interpolates dayAlpha/nightAlpha per fragment across the solar terminator.
  // The brighter map compensates for the globe shader also dimming the imagery at night.
  const blend = { dayAlpha: 0, nightAlpha: 1, brightness: 2.5 };
  const overview = new SingleTileImageryProvider({
    url: '/black-marble-2016.jpg', tileWidth: 3600, tileHeight: 1800,
    credit: new Credit('City lights: NASA Earth Observatory / Suomi NPP VIIRS, 2016 composite'),
  });
  const layers = [new ImageryLayer(overview, blend)];
  const product = gibsProduct('Nighttime|VIIRS_Black_Marble');
  if (product) layers.push(new ImageryLayer(gibsImageryProvider(product, '2016-01-01'), { ...blend, minimumTerrainLevel: 5 }));
  return layers;
}
