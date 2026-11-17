import { PlanningOverlay, type PlanOverlayState } from '../map/planningOverlay';
import type { PlanDragTarget } from '../lib/usePlanning';

/** Which plan entity ids can be dragged. */
export function planDragTarget(id: string | null): PlanDragTarget | null {
  if (!id) return null;
  if (id === 'plan|site') return { kind: 'site' };
  if (id.startsWith('plan|obs|')) return { kind: 'observer', id: id.slice(9) };
  if (id === 'plan|route|a' || id === 'plan|route|b') return { kind: 'route', end: id.endsWith('a') ? 'a' : 'b' };
  return null;
}
import { redactCredentialText } from '../../shared/sanitize';
import { lightGlobe, nightLightsLayers, type EarthLighting } from '../map/earthLighting';
import { profAdd } from '../lib/prof';
import { buildImageryLayers, clampDate, gibsProduct, imageryDates, type ImageryState } from '../map/imageryOverlay';
import { imageryHealth, observeImageryRequests } from '../lib/imageryHealth';
import { EUMETSAT_WMS, eumetsatFrameTime, expireFrames, fetchLatestFrame, frameLabel, frameUsable, GEO_SAT_LOOKUP_TIMEOUT_MS, GEO_SAT_MAX_LAT, GEO_SAT_REFRESH_MS, GEO_SATS, tileTemplate, type GeoFrames, type GeoSatId, type GeoSatProduct } from '../../shared/geoSatellite';
import { routeMapSegments, type RouteInfo } from '../../shared/route';
import { airlineRouteBounds } from '../map/airlineRouteView';
import '../lib/cesiumBase';
import {
  PointPrimitiveCollection,
  LabelCollection,
  HorizontalOrigin,
  GeometryInstance,
  PolylineGeometry,
  PolylineColorAppearance,
  Primitive,
  ColorGeometryInstanceAttribute,
  DistanceDisplayConditionGeometryInstanceAttribute,
  RequestScheduler,
  RequestState,
  ArcType,
  SkyAtmosphere,
  SkyBox,
  Cartesian2,
  HeadingPitchRange,
  Matrix4,
  Cartesian3,
  CallbackPositionProperty,
  Cartographic,
  CesiumWidget,
  Color,
  CustomDataSource,
  defined,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  Entity,
  ImageryLayer,
  LabelStyle,
  Math as CMath,
  NearFarScalar,
  PolygonHierarchy,
  Rectangle,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  WebMapServiceImageryProvider,
  PolylineDashMaterialProperty,
  WebMercatorTilingScheme,
  CesiumTerrainProvider,
  IonResource,
  GeographicTilingScheme,
  UrlTemplateImageryProvider,
  Credit,
  createGooglePhotorealistic3DTileset,
  GoogleMaps,
  SceneMode,
  type Cesium3DTileset,
  type PostProcessStage,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { MultiLineString, Position } from 'geojson';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countriesTopo from 'world-atlas/countries-50m.json';
import statesTopo from 'us-atlas/states-10m.json';
import type { Earthquake, SavedLocation, Settings, WeatherAlert } from '../../shared/types';
import type { TimelineFrame } from '../../shared/timeline';
import { quakeClass, SEVERITY_META, prefersReducedMotion } from '../lib/format';
import { BASEMAPS, isBasemapId, labelsOverlayLayer, needsContextFills, imagerySourcesHere, previousUtcDay } from '../map/basemaps';
import { BuildingManager, BUILDINGS_MAX_CAMERA_M, type BuildingStats } from '../map/buildings';
import { historicalBasemap } from '../map/historicalImagery';
import type { ArchiveImage } from '../../shared/satelliteYears';
import { usgsStats } from '../map/usgsProvider';
import { modelStats } from '../map/vehicleModels';
import { packStats } from '../map/modelPack';
import { geoidStats } from '../map/geoid';
import { shouldPreloadHidden, watchPhotorealSurface } from '../map/photorealSurface';
import { applyUpscaleSharpen } from '../map/upscaleSharpen';
import { CameraCards } from './CameraCards';
import { googleRefusal, googleStatus } from '../../shared/googleErrors';
import type { TrailKind, TrailPoint } from '../map/trailHeights';
import { WindOverlay } from '../map/windOverlay';
import { TrafficSim } from '../map/trafficSim';
import type { WindField } from '../../shared/wind';
import { clampBack, satFrameBack, wmsTime } from '../../shared/weatherTimeline';
import { nextTiltPitch } from '../../shared/viewModes';
import { createVectorImageryProvider, vectorStats, type VectorStats } from '../map/vectorTiles';
import { createTerrariumTerrain, seaStats, TERRAIN_INFO, type TerrainStats } from '../map/terrain';
import { LayerRenderer } from '../map/layerRender';
import { warningMapRecords, warningPickId } from '../map/warningGeometry';
import { perimeterPickId } from '../map/perimeterGeometry';
import { attachCockpit, attachPassengerFollow } from '../map/trackingCamera';
import { CameraRestorer, capturedCamera, type CameraRestoreAdapter, type RestoreCameraOptions } from '../map/cameraRestore';
import type { TrackingMode } from '../../shared/trackingCamera';
import { PlaceLabelManager } from '../map/placeLabels';
import type { AircraftFilter } from '../../shared/aircraft';
import { AIRPORTS } from '../data/airports';
import { applyVisualMode } from '../map/visualModes';
import type { LayerId, LayerSnapshot, ViewState } from '../../shared/layers';
import type { Annotation, Camera } from '../lib/api';

export type GlobeSelection = { kind: 'location' | 'alert' | 'quake' | 'airport'; id: string } | { kind: 'record'; layer: LayerId; id: string };

export type ToolMode = 'none' | 'measure-line' | 'measure-area' | 'draw-pin' | 'draw-line' | 'draw-area';

export type PlaybackFrame = TimelineFrame;

export interface GlobeLayers {
  alerts: boolean;
  quakes: boolean;
  locations: boolean;
  radii: boolean;
  boundaries: boolean;
}


/** Closest the camera may get to the ground, metres. */
export const MIN_CAMERA_HEIGHT_M = 100;
/** Maximum tilt, degrees from straight down. */
export const MAX_TILT_DEG = 80;

export interface GlobeDiagnostics {
  routeLegCount: number;
  renderErrors: number;
  lastRenderError: string | null;
  globeShown: boolean | null;
  imageryLayerCount: number | null;
  photorealLoaded: boolean;
  cameraHeightM: number;
  cameraLat: number;
  cameraLon: number;
  tilesPending: number;
  maxRenderedLevel: number | null;
  imageryMaxLevelHere: number;
  imageryAtLimit: boolean;
  imageryErrors: number;
  lastImageryError: string | null;
  basemapSources: { name: string; provider: string; maxLevel: number; bestResolution: string; captureDate: string; coverage: string; terms: string }[];
  terrain: (TerrainStats & typeof TERRAIN_INFO) | null;
  vector: VectorStats & { overlayOn: boolean };
  usgs: { noDataTiles: number; blankTiles: number; imageryTiles: number };
  models: typeof modelStats & { pack: typeof packStats; geoid: typeof geoidStats };
  buildings: BuildingStats & { enabled: boolean; maxCameraM: number };
  geoSat: { enabled: boolean; product: GeoSatProduct; frames: Partial<Record<GeoSatId, string | null>>; checks: number; failedChecks: number; lastError: string | null; layers: number };
  missingRequirement: string | null;
}

export interface GlobeHandle {
  replayMap(kind?: 'alert' | 'quake', id?: string): {
    active: boolean; cursor: string | null; alertCount: number; quakeCount: number;
    positions: [number, number][]; screen: { x: number; y: number } | null;
  } | null;
  getDiagnostics(): GlobeDiagnostics | null;
  focusAirlineRoute(route: RouteInfo): void;
  setView(lat: number, lon: number, heightM: number, pitchDeg?: number): void;
  /** Renderer-only isolation hook; does not persist settings or change provider access. */
  setWaterEffect(enabled: boolean): void;
  /** Coordinates in degrees, orientation in radians; unavailable during a mode morph. */
  getCamera(): Camera | null;
  /** Current screen-center intersection; null while morphing or looking past the globe. */
  getMapCenter(): { lat: number; lon: number } | null;
  /** Window position (CSS pixels) of a point on the ground, for automated checks; null when off screen. */
  toScreen(lat: number, lon: number): { x: number; y: number } | null;
  /** Id of the map entity under a window position (automated checks). */
  pickId(x: number, y: number): string | null;
  setCamera(c: Camera, animate?: boolean): void;
  /** Queues across mount/morph; false if invalid, superseded, cancelled or unmounted. */
  restoreCamera(c: Camera, options?: RestoreCameraOptions): Promise<boolean>;
  flyHome(): void;
  flyRegion(region: 'us' | 'lower48' | 'alaska' | 'hawaii'): void;
  northUp(): void;
  /**
   * Switches between straight down and a 35° oblique around the point at the screen centre, keeping heading and
   * distance. Returns the new pitch (radians), or null when there is nothing to tilt around (2D, or sky at the centre).
   */
  tilt(): number | null;
  focus(lat: number, lon: number, radiusKm?: number, minimumHeightM?: number): void;
  zoom(direction: 1 | -1): void;
  /**
   * Moves the camera along a route ([lon, lat] points), behind and above it, looking ahead. Any click, wheel or Escape
   * ends it. With reduced motion, shows a still overview instead.
   */
  flyAlong(points: [number, number][], mode: 'walk' | 'drive', onEnd?: (why: 'done' | 'cancelled' | 'replaced') => void): void;
  stopFlyAlong(): void;
}

interface Props {
  alerts: WeatherAlert[];
  quakes: Earthquake[];
  locations: SavedLocation[];
  layers: GlobeLayers;
  settings: Settings;
  selection: GlobeSelection | null;
  pickMode: boolean;
  onSelect(sel: GlobeSelection | null): void;
  onPick(lat: number, lon: number): void;
  /** Protective planning: when set, the next click goes here (on the rendered surface: a roof, not the ground behind it). */
  planPick?: ((lat: number, lon: number) => void) | null;
  /** Dragging the plan's subject, points or route ends (final = the button was released). */
  planDrag?: ((target: PlanDragTarget, lat: number, lon: number, final: boolean) => void) | null;
  planOverlay?: PlanOverlayState | null;
  /** Planning site view: dark imagery and dark grey buildings while the planning page is open. */
  siteLook?: boolean;
  onReady(ok: boolean, error?: string): void;
  layerSnaps: Partial<Record<LayerId, LayerSnapshot>>;
  layersOn: LayerId[];
  trail: TrailPoint[] | null;
  /** OpenSky's reported flight path for the selected aircraft (drawn apart from the recorded trail). */
  flightPath?: TrailPoint[] | null;
  /** GFS wind field to animate (wind layer on), or null. */
  windField?: WindField | null;
  /** Colour the wind particles by speed (legend in the Layers panel). */
  windColorBySpeed?: boolean;
  /** Observed-weather history: minutes back from the newest frames (0 = newest). */
  weatherBackMin?: number;
  /** Whose trail it is (sets its vertical reference). */
  trailKind: TrailKind;
  trackedRecord: { layer: LayerId; id: string } | null;
  trackingMode?: TrackingMode;
  passengerSeat: string;
  onInteriorStatus?(status: 'loading' | 'ready' | 'error'): void;
  onTrackingUnavailable?(reason: string): void;
  showOrbitFor: string | null;
  onViewChange(v: ViewState): void;
  tool: ToolMode;
  draftPoints: [number, number][];
  onToolPoint(lon: number, lat: number): void;
  onToolFinish(): void;
  annotations: Annotation[];
  playback: PlaybackFrame | null;
  playbackActive: boolean;
  google3dKey: string | null;
  /** Reported route airports for the selected aircraft (dashed; not the flown path). */
  routeLine?: RouteInfo | null;
  /** Dated NASA GIBS product over the globe, with optional two-date swipe comparison. */
  imagery?: ImageryState;
  archived?: ArchiveImage | null;
  onImagerySplit?(split: number): void;
  imageryKeys: { esri: string | null; mapbox: string | null; google: string | null; ion?: string | null; tomtom?: string | null };
  /** Shown to the user when a customer-credential provider (Google) refuses requests. */
  onProviderError?: (message: string) => void;
  eoxLicensed: boolean;
  aircraftFilter: AircraftFilter;
  vesselClasses: string[];
  showAirports: boolean;
  sceneMode: '3d' | '2d';
  lighting: EarthLighting;
}

const LOC_COLOR = Color.fromCssColorString('#5fd0e6');
const RADIUS_COLOR = Color.fromCssColorString('#5fd0e6').withAlpha(0.55);
const STATE_LINE = Color.fromCssColorString('#9fb3c8').withAlpha(0.55);
const COUNTRY_LINE = Color.fromCssColorString('#7d90a4').withAlpha(0.45);
const HIGHLIGHT = Color.fromCssColorString('#ffffff');

const VIEWS = {
  us: { lon: -122, lat: 42, height: 10_500_000 },
  alaska: { lon: -154, lat: 60, height: 3_400_000 },
};
const RECTS = {
  lower48: Rectangle.fromDegrees(-125.5, 24, -66.5, 49.8),
  hawaii: Rectangle.fromDegrees(-160.6, 18.7, -154.5, 22.5),
};

/**
 * Puts a new frame of an overlay on the map and takes the previous one away only once the new tiles have loaded (or
 * after `maxMs`), so stepping through frames never blanks the overlay. While it waits, its "remove now" function
 * sits in `pending`.
 */
function retireWhenLoaded(w: CesiumWidget, old: ImageryLayer, maxMs: number, pending: Set<() => void>): void {
  let sawLoading = false;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    off();
    clearTimeout(timer);
    pending.delete(finish);
    if (w.isDestroyed()) return;
    if (w.imageryLayers.contains(old)) w.imageryLayers.remove(old, true);
    w.scene.requestRender();
  };
  const off = w.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
    if (n > 0) sawLoading = true;
    else if (sawLoading) finish();
  });
  const timer = setTimeout(finish, maxMs);
  pending.add(finish);
}

function linesOf(g: MultiLineString): Position[][] {
  return g.coordinates;
}

/**
 * Boundary lines as ONE static batched primitive (geometry built in Cesium's workers, one draw call).
 * A PolylineCollection with thousands of separate lines re-derived a material key for every line on
 * every frame (≈26 s of main-thread time in a profiled session).
 */
function meshInstances(g: MultiLineString, color: Color, width: number): GeometryInstance[] {
  const out: GeometryInstance[] = [];
  const colorAttr = ColorGeometryInstanceAttribute.fromColor(color);
  // Hidden below ~40 km altitude so outlines do not draw across detailed imagery.
  const ddc = new DistanceDisplayConditionGeometryInstanceAttribute(40_000, Number.MAX_VALUE);
  for (const line of linesOf(g)) {
    if (line.length < 2) continue;
    const flat: number[] = [];
    for (const [lon, lat] of line) flat.push(lon, lat);
    out.push(new GeometryInstance({ geometry: new PolylineGeometry({ positions: Cartesian3.fromDegreesArray(flat), width, vertexFormat: PolylineColorAppearance.VERTEX_FORMAT }), attributes: { color: colorAttr, distanceDisplayCondition: ddc } }));
  }
  return out;
}
function linePrimitive(instances: GeometryInstance[]): Primitive {
  return new Primitive({ geometryInstances: instances, appearance: new PolylineColorAppearance({ translucent: true }), asynchronous: true, releaseGeometryInstances: true, allowPicking: false });
}

function parseEntityId(id: string): GlobeSelection | null {
  const perimeter = perimeterPickId(id);
  if (perimeter) return { kind: 'record', layer: 'firePerimeters', id: perimeter };
  const warning = warningPickId(id);
  if (warning) return { kind: 'record', layer: 'dwd', id: warning };
  const [kind, rest] = [id.slice(0, id.indexOf('|')), id.slice(id.indexOf('|') + 1)];
  if (kind === 'apt') return { kind: 'airport', id: rest };
  if (kind === 'rec' || kind === 'pb') {
    const layer = rest.slice(0, rest.indexOf('|')) as LayerId;
    return { kind: 'record', layer, id: rest.slice(rest.indexOf('|') + 1) };
  }
  if (kind === 'loc' || kind === 'radius') return { kind: 'location', id: rest };
  if (kind === 'quake') return { kind: 'quake', id: rest };
  if (kind === 'alert') return { kind: 'alert', id: rest.slice(0, rest.lastIndexOf('|')) };
  return null;
}

function ringPositions(ring: Position[]): Cartesian3[] {
  const flat: number[] = [];
  for (const [lon, lat] of ring) flat.push(lon, lat);
  return Cartesian3.fromDegreesArray(flat);
}

export const Globe = forwardRef<GlobeHandle, Props>(function Globe(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<CesiumWidget | null>(null);
  const sourcesRef = useRef<{ alerts: CustomDataSource; quakes: CustomDataSource; locations: CustomDataSource; radii: CustomDataSource } | null>(null);
  const boundariesRef = useRef<Primitive[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState<string | null>(null);
  const basemapLayersRef = useRef<ImageryLayer[]>([]);
  const nightLightsRef = useRef<ImageryLayer[]>([]);
  const imageryErrorsRef = useRef<{ count: number; last: string | null }>({ count: 0, last: null });
  const terrainStatsRef = useRef<TerrainStats | null>(null);
  const tilesPendingRef = useRef(0);
  const layerRendererRef = useRef<LayerRenderer | null>(null);
  const cockpitCleanupRef = useRef<(() => void) | null>(null);
  const passengerFollowRef = useRef<{ id: string; dispose(): void } | null>(null);
  const radarLayerRef = useRef<ImageryLayer | null>(null);
  const lightningLayerRef = useRef<ImageryLayer | null>(null);
  /** Previous radar and lightning frames still on screen while the next one loads. */
  const weatherRetireRef = useRef(new Set<() => void>());
  // Place names drawn over imagery (the last basemap layer when on): weather-satellite frames go below it.
  const labelsLayerRef = useRef<ImageryLayer | null>(null);
  // Keep night imagery above the selected surface and below labels, weather and dated overlays.
  const placeNightLights = (w: CesiumWidget) => {
    const layers = w.imageryLayers;
    let below = basemapLayersRef.current.filter(l => l !== labelsLayerRef.current).at(-1);
    for (const lights of nightLightsRef.current) {
      const anchor = () => below ? layers.indexOf(below) : -1;
      while (layers.indexOf(lights) > anchor() + 1) layers.lower(lights);
      while (layers.indexOf(lights) < anchor()) layers.raise(lights);
      below = lights;
    }
  };
  /** Drawn weather-satellite frame per satellite (key = layer id + frame time). */
  const geoLayersRef = useRef(new Map<GeoSatId, { key: string; layer: ImageryLayer }>());
  /** Previous frames kept on screen until the new frame's tiles have loaded (no blink every 10 minutes). */
  const geoRetiringRef = useRef(new Set<ImageryLayer>());
  /** Timer and listener of each retiring frame, cancelled when it goes or when the globe is torn down. */
  const geoRetireCancelRef = useRef(new Map<ImageryLayer, () => void>());
  const geoStatsRef = useRef({ checks: 0, failedChecks: 0, lastError: null as string | null });
  /** Weather-satellite frames sit above the basemap imagery and below place names and radar. */
  const placeGeoSatLayers = () => {
    const w = widgetRef.current;
    if (!w || w.isDestroyed()) return;
    const c = w.imageryLayers;
    // Layers are only moved (raise/lower), never removed and re-added: removing a layer frees its loaded tiles,
    // which would reload frames already on screen and empty the old frame that covers a swap.
    const retiring = [...geoRetiringRef.current].filter((l) => c.contains(l));
    const current = [...geoLayersRef.current.values()].map((g) => g.layer).filter((l) => c.contains(l) && !geoRetiringRef.current.has(l));
    const order = [...current, ...retiring]; // bottom → top: new frames lowest, retiring frames over them until they go
    const anchor = () => {
      const present = [labelsLayerRef.current, radarLayerRef.current, lightningLayerRef.current].filter((l): l is ImageryLayer => !!l && c.contains(l));
      return present.length ? present.reduce((lo, l) => (c.indexOf(l) < c.indexOf(lo) ? l : lo)) : null;
    };
    // From the top of the block down, each layer goes directly below the one that should be above it
    // (place names / radar for the top one, or the top of the stack when neither is shown).
    for (let i = order.length - 1; i >= 0; i--) {
      const l = order[i];
      const above = i === order.length - 1 ? anchor() : order[i + 1];
      if (!above) {
        if (c.indexOf(l) !== c.length - 1) c.raiseToTop(l);
        continue;
      }
      while (c.indexOf(l) > c.indexOf(above)) c.lower(l);
      while (c.indexOf(l) < c.indexOf(above) - 1) c.raise(l);
    }
  };
  const postStageRef = useRef<PostProcessStage | null>(null);
  const sharpenStageRef = useRef<PostProcessStage | null>(null);
  const photorealStatsRef = useRef({ loaded: 0, failed: 0 });
  const annoSourceRef = useRef<CustomDataSource | null>(null);
  const playbackSourceRef = useRef<CustomDataSource | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);
  const [photorealOn, setPhotorealOn] = useState(false);
  /** Bumped when vehicle heights change (Photoreal on/off, sea-level grid or terrain samples arrive), to re-place playback markers. */
  const [heightsVersion, setHeightsVersion] = useState(0);
  const photorealCleanupRef = useRef<(() => void) | null>(null);
  const reportViewRef = useRef<(() => void) | null>(null);
  const cameraRestoreRef = useRef<CameraRestorer | null>(null);
  if (!cameraRestoreRef.current) cameraRestoreRef.current = new CameraRestorer(props.sceneMode);
  const renderErrorsRef = useRef<{ count: number; last: string | null }>({ count: 0, last: null });
  const placeLabelsRef = useRef<PlaceLabelManager | null>(null);
  const buildingsRef = useRef<BuildingManager | null>(null);
  const [ready, setReady] = useState(false);

  const reduced = prefersReducedMotion(props.settings.reducedMotion);
  const reducedRef = useRef(reduced);
  const flyAlongStopRef = useRef<((why: 'done' | 'cancelled' | 'replaced') => void) | null>(null);
  useEffect(() => () => flyAlongStopRef.current?.('cancelled'), []);
  reducedRef.current = reduced;

  // ----- init -----
  useEffect(() => {
    if (!containerRef.current) return;
    let widget: CesiumWidget;
    try {
      const widgetOptions = {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        // Mesh elevations can lie below ellipsoid zero. Leave room for the lowest EGM96
        // sea levels when Cesium clears the base globe's depth before drawing 3D tiles.
        depthPlaneEllipsoidOffset: -125,
        skyBox: new SkyBox({ sources: {
          positiveX: '/star-sky/px.webp', negativeX: '/star-sky/mx.webp',
          positiveY: '/star-sky/py.webp', negativeY: '/star-sky/my.webp',
          positiveZ: '/star-sky/pz.webp', negativeZ: '/star-sky/mz.webp',
        } }),
        skyAtmosphere: new SkyAtmosphere(),
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        creditContainer: creditRef.current ?? undefined,
        shouldAnimate: false,
        showRenderLoopErrors: false,
        // Ask the browser for the high-performance GPU and skip the costly preserveDrawingBuffer path.
        contextOptions: { webgl: { powerPreference: 'high-performance', alpha: false, antialias: true, preserveDrawingBuffer: false } },
      } satisfies NonNullable<ConstructorParameters<typeof CesiumWidget>[1]> & { depthPlaneEllipsoidOffset: number };
      widget = new CesiumWidget(containerRef.current, widgetOptions);
    } catch (e) {
      cameraRestoreRef.current?.fail();
      const msg = e instanceof Error ? e.message : String(e);
      setFailed(msg);
      propsRef.current.onReady(false, msg);
      return;
    }
    widgetRef.current = widget;
    const scene = widget.scene;
    scene.backgroundColor = Color.fromCssColorString('#0a1017');
    scene.globe.baseColor = Color.fromCssColorString('#1a2733');
    scene.globe.showGroundAtmosphere = false;
    // With the camera-relative light from above (see buildings.ts), land imagery keeps its brightness.
    scene.globe.enableLighting = true;
    scene.globe.dynamicAtmosphereLighting = false;
    scene.globe.lightingFadeOutDistance = 1;
    scene.globe.lightingFadeInDistance = 2;
    // Synthetic ocean highlights obscure coastlines and source imagery. Keep sea-level geometry and water masks.
    scene.globe.showWaterEffect = false;
    scene.fog.enabled = false;
    let frameStart = 0;
    scene.preUpdate.addEventListener(() => (frameStart = performance.now()));
    scene.postRender.addEventListener(() => frameStart && profAdd('cesium.frame', performance.now() - frameStart));
    // A render error stops Cesium's render loop (the globe would freeze). Record it for Diagnostics and restart.
    scene.renderError.addEventListener((_sc: unknown, err: unknown) => {
      const raw = err instanceof Error ? `${err.message} | ${(err.stack ?? '').split('\n').slice(0, 4).join(' | ')}` : String(err);
      const msg = redactCredentialText(raw, [propsRef.current.google3dKey, ...Object.values(propsRef.current.imageryKeys)]);
      renderErrorsRef.current = { count: renderErrorsRef.current.count + 1, last: msg.slice(0, 600) };
      console.error('Cesium render error', msg);
      setTimeout(() => {
        if (!widget.isDestroyed() && renderErrorsRef.current.count < 20) {
          widget.useDefaultRenderLoop = true;
          widget.scene.requestRender();
        }
      }, 250);
    });
    scene.globe.depthTestAgainstTerrain = false;
    // Keep revisited tiles resident and give visible tiles priority over offscreen siblings.
    scene.globe.tileCacheSize = 600;
    scene.globe.preloadSiblings = false;
    scene.globe.loadingDescendantLimit = 20;
    for (const host of ['gibs.earthdata.nasa.gov:443', 'basemap.nationalmap.gov:443', 'tiles.openfreemap.org:443', 's3.amazonaws.com:443']) RequestScheduler.requestsByServer[host] = 24;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.brightnessShift = -0.9;
      scene.skyAtmosphere.saturationShift = -0.15;
      scene.skyAtmosphere.hueShift = 0.02;
    }
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
      tilesPendingRef.current = n;
    });
    scene.screenSpaceCameraController.inertiaSpin = 0.6;
    scene.screenSpaceCameraController.inertiaZoom = 0.5;
    // Close-up limit: 100 m above the ground (0.5 km views are fine). The old 2 km limit made Cesium push
    // the camera back out ("snap back") whenever a zoom or tilt brought it closer.
    scene.screenSpaceCameraController.minimumZoomDistance = MIN_CAMERA_HEIGHT_M;
    // Tilt stops at 80° from straight down (10° above the horizon) instead of swinging past the horizon.
    scene.screenSpaceCameraController.maximumTiltAngle = CMath.toRadians(MAX_TILT_DEG);
    scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;

    // Boundaries (bundled; Natural Earth countries and U.S. Census states).
    const lineSets: Primitive[] = [];
    try {
      const ct = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>;
      lineSets.push(linePrimitive(meshInstances(mesh(ct, ct.objects.countries) as MultiLineString, COUNTRY_LINE, 1)));
      const st = statesTopo as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
      // State lines plus the U.S. coastline / national outline from the nation object.
      lineSets.push(linePrimitive([...meshInstances(mesh(st, st.objects.states, (a, b) => a !== b) as MultiLineString, STATE_LINE, 1.2), ...meshInstances(mesh(st, st.objects.nation) as MultiLineString, STATE_LINE, 1.2)]));
    } catch (e) {
      console.warn('Boundary load failed', e);
    }
    for (const p of lineSets) scene.primitives.add(p);
    boundariesRef.current = lineSets;

    const sources = {
      radii: new CustomDataSource('radii'),
      alerts: new CustomDataSource('alerts'),
      quakes: new CustomDataSource('quakes'),
      locations: new CustomDataSource('locations'),
    };
    void widget.dataSources.add(sources.radii);
    void widget.dataSources.add(sources.alerts);
    void widget.dataSources.add(sources.quakes);
    void widget.dataSources.add(sources.locations);
    sourcesRef.current = sources;
    layerRendererRef.current = new LayerRenderer(widget);
    layerRendererRef.current.onSurfaceHeightsChanged = () => setHeightsVersion((v) => v + 1);
    placeLabelsRef.current = new PlaceLabelManager(widget);
    buildingsRef.current = new BuildingManager(widget);
    annoSourceRef.current = new CustomDataSource('annotations');
    playbackSourceRef.current = new CustomDataSource('playback');
    void widget.dataSources.add(annoSourceRef.current);
    void widget.dataSources.add(playbackSourceRef.current);
    widget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    widget.camera.setView({ destination: Cartesian3.fromDegrees(VIEWS.us.lon, VIEWS.us.lat, VIEWS.us.height) });

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    // Plan dragging: press on the subject, a point or a route end, move, release. The camera does not move meanwhile.
    let drag: { target: PlanDragTarget; last: [number, number] | null; frame: number } | null = null;
    let suppressClickUntil = 0;
    const groundAt = (pos: Cartesian2): [number, number] | null => {
      const ray = widget.camera.getPickRay(pos);
      const cart = (ray && scene.globe.pick(ray, scene)) || widget.camera.pickEllipsoid(pos, scene.globe.ellipsoid);
      if (!cart) return null;
      const c = Cartographic.fromCartesian(cart);
      return [CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)];
    };
    /**
     * The draggable plan item under the cursor, looking through everything stacked there: sight lines and outlines
     * start at or cross the subject marker and would otherwise win the pick, so the marker could not be grabbed.
     */
    const draggableAt = (pos: Cartesian2): PlanDragTarget | null => {
      for (const hit of scene.drillPick(pos, 12, 9, 9)) {
        const t = planDragTarget(defined(hit) && hit.id instanceof Entity ? String(hit.id.id) : null);
        if (t) return t;
      }
      return null;
    };
    const endDrag = (final: boolean) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      cancelAnimationFrame(d.frame);
      scene.screenSpaceCameraController.enableInputs = true;
      scene.canvas.style.cursor = '';
      if (d.last) {
        suppressClickUntil = performance.now() + 350;
        if (final) propsRef.current.planDrag?.(d.target, d.last[1], d.last[0], true);
      }
    };
    handler.setInputAction((m: { position: Cartesian2 }) => {
      const p = propsRef.current;
      if (!p.planDrag || p.planPick || p.pickMode || p.tool !== 'none') return;
      const target = draggableAt(m.position);
      if (!target) return;
      drag = { target, last: null, frame: 0 };
      scene.screenSpaceCameraController.enableInputs = false;
      scene.canvas.style.cursor = 'grabbing';
    }, ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(() => endDrag(true), ScreenSpaceEventType.LEFT_UP);
    const onBlur = () => endDrag(true);
    window.addEventListener('blur', onBlur);
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const p = propsRef.current;
      if (performance.now() < suppressClickUntil) return; // the click that ends a drag selects nothing
      const pickLonLat = (): [number, number] | null => {
        const ray = widget.camera.getPickRay(movement.position);
        const cart = (ray && scene.globe.pick(ray, scene)) || widget.camera.pickEllipsoid(movement.position, scene.globe.ellipsoid);
        if (!cart) return null;
        const c = Cartographic.fromCartesian(cart);
        return [Number(CMath.toDegrees(c.longitude).toFixed(6)), Number(CMath.toDegrees(c.latitude).toFixed(6))];
      };
      if (p.planPick) {
        let ll: [number, number] | null = null;
        if (scene.pickPositionSupported) {
          const pos = scene.pickPosition(movement.position);
          if (pos) {
            const c = Cartographic.fromCartesian(pos);
            if (c) ll = [Number(CMath.toDegrees(c.longitude).toFixed(6)), Number(CMath.toDegrees(c.latitude).toFixed(6))];
          }
        }
        ll ??= pickLonLat();
        if (ll) p.planPick(ll[1], ll[0]);
        return;
      }
      if (p.pickMode) {
        const ll = pickLonLat();
        if (ll) p.onPick(ll[1], ll[0]);
        return;
      }
      if (p.tool !== 'none') {
        const ll = pickLonLat();
        if (ll) p.onToolPoint(ll[0], ll[1]);
        return;
      }
      const picked = scene.pick(movement.position);
      const pid = !defined(picked) ? null : picked.id instanceof Entity ? String(picked.id.id) : typeof picked.id === 'string' && (picked.id.startsWith('apt|') || picked.id.startsWith('rec|')) ? picked.id : null;
      p.onSelect(pid ? parseEntityId(pid) : null);
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => {
      if (propsRef.current.tool !== 'none') propsRef.current.onToolFinish();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // Hover: show the vehicle's label (when "hovered" labels are chosen) and a pointer cursor.
    let lastHover = 0;
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      if (drag) {
        const ll = groundAt(m.endPosition);
        if (!ll) return;
        drag.last = ll;
        // One update per frame, however fast the mouse moves.
        if (!drag.frame) {
          const d = drag;
          d.frame = requestAnimationFrame(() => {
            d.frame = 0;
            if (drag === d && d.last) propsRef.current.planDrag?.(d.target, d.last[1], d.last[0], false);
          });
        }
        return;
      }
      const now = performance.now();
      if (now - lastHover < 80) return;
      lastHover = now;
      const picked = scene.pick(m.endPosition);
      const sel = !defined(picked) ? null : picked.id instanceof Entity ? parseEntityId(String(picked.id.id)) : typeof picked.id === 'string' && (picked.id.startsWith('apt|') || picked.id.startsWith('rec|')) ? parseEntityId(picked.id) : null;
      const rec = sel && sel.kind === 'record' ? { layer: sel.layer, id: sel.id } : null;
      layerRendererRef.current?.setHovered(rec);
      const draggable = !!propsRef.current.planDrag && !propsRef.current.planPick && !!draggableAt(m.endPosition);
      if (propsRef.current.tool === 'none' && !propsRef.current.pickMode && !propsRef.current.planPick) scene.canvas.style.cursor = draggable ? 'grab' : sel ? 'pointer' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // Report the settled view (center, altitude, bounding box) for viewport-based layers.
    const reportView = () => {
      if (widget.isDestroyed() || scene.mode === SceneMode.MORPHING) return;
      const c = widget.camera.positionCartographic;
      const center = widget.camera.pickEllipsoid(new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2), scene.globe.ellipsoid);
      const cc = center ? Cartographic.fromCartesian(center) : c;
      const rect = widget.camera.computeViewRectangle(scene.globe.ellipsoid);
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const bbox: [number, number, number, number] = rect
        ? [CMath.toDegrees(rect.west), CMath.toDegrees(rect.south), CMath.toDegrees(rect.east), CMath.toDegrees(rect.north)].map((v, i) => clamp(v, i % 2 ? -90 : -180, i % 2 ? 90 : 180)) as [number, number, number, number]
        : [-180, -90, 180, 90];
      propsRef.current.onViewChange({ lat: clamp(CMath.toDegrees(cc.latitude), -90, 90), lon: clamp(CMath.toDegrees(cc.longitude), -180, 180), heightM: Math.max(1, c.height), bbox });
      // Buildings load around the view center when the camera is low (height above the terrain surface).
      const ground = scene.globe.getHeight(c) ?? 0;
      buildingsRef.current?.update(CMath.toDegrees(cc.latitude), CMath.toDegrees(cc.longitude), c.height - ground);
      placeLabelsRef.current?.refresh();
    };
    const offMoveEnd = widget.camera.moveEnd.addEventListener(reportView);
    reportViewRef.current = reportView;
    const initialReport = setTimeout(reportView, 500);
    const cameraAdapter: CameraRestoreAdapter = {
      mode: () => scene.mode === SceneMode.MORPHING ? 'morphing' : scene.mode === SceneMode.SCENE2D ? '2d' : scene.mode === SceneMode.SCENE3D ? '3d' : 'other',
      morphTo: (mode) => {
        if (mode === '2d' && cockpitCleanupRef.current) {
          cockpitCleanupRef.current(); cockpitCleanupRef.current = null;
          propsRef.current.onTrackingUnavailable?.('Cockpit perspective ended when switching to 2D.');
        }
        if (mode === '2d') scene.morphTo2D(reducedRef.current ? 0 : 1);
        else scene.morphTo3D(reducedRef.current ? 0 : 1);
        scene.requestRender();
      },
      onMorphComplete: (callback) => scene.morphComplete.addEventListener(callback),
      cancelFlight: () => widget.camera.cancelFlight(),
      apply: (camera, animate, complete, cancel) => {
        if (cockpitCleanupRef.current) {
          cockpitCleanupRef.current(); cockpitCleanupRef.current = null;
          propsRef.current.onTrackingUnavailable?.('Cockpit perspective ended when restoring a saved camera.');
        }
        widget.trackedEntity = undefined;
        const destination = Cartesian3.fromDegrees(camera.lon, camera.lat, camera.heightM);
        const orientation = { heading: camera.heading, pitch: camera.pitch, roll: 0 };
        if (!animate || reducedRef.current) { widget.camera.setView({ destination, orientation }); complete(); }
        else widget.camera.flyTo({ destination, orientation, duration: 1.2, complete, cancel });
        scene.requestRender();
      },
      report: reportView,
    };
    cameraRestoreRef.current?.attach(cameraAdapter);
    setReady(true);

    const ro = new ResizeObserver(() => {
      widget.resize();
      scene.requestRender();
    });
    ro.observe(containerRef.current);
    propsRef.current.onReady(true);

    return () => {
      clearTimeout(initialReport); offMoveEnd();
      cameraRestoreRef.current?.detach(cameraAdapter);
      if (reportViewRef.current === reportView) reportViewRef.current = null;
      ro.disconnect();
      window.removeEventListener('blur', onBlur);
      handler.destroy();
      layerRendererRef.current?.destroy();
      layerRendererRef.current = null;
      buildingsRef.current?.destroy();
      buildingsRef.current = null;
      widget.destroy();
      widgetRef.current = null;
      sourcesRef.current = null;
    };
  }, []);

  // ----- basemap -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    // Remove only basemap layers; overlay layers (radar) are managed separately.
    for (const l of basemapLayersRef.current) w.imageryLayers.remove(l, true);
    const def = props.archived ? historicalBasemap(props.archived) : BASEMAPS[isBasemapId(props.settings.basemap) ? props.settings.basemap : 'atlas'];
    const date = previousUtcDay();
    const layers = def.build({ date, keys: props.imageryKeys, eoxLicensed: props.eoxLicensed });
    // Worldwide place names, roads and boundaries over imagery (OpenStreetMap via OpenFreeMap).
    labelsLayerRef.current = null;
    if (props.settings.labelsOverlay && def.id !== 'streets' && def.id !== 'neutral') {
      labelsLayerRef.current = labelsOverlayLayer(needsContextFills(def.id));
      layers.push(labelsLayerRef.current);
    }
    imageryErrorsRef.current = { count: 0, last: null };
    if (def.id === 'google2d' && props.imageryKeys.google)
      for (const l of layers) l.errorEvent.addEventListener((e: unknown) => propsRef.current.onProviderError?.(googleRefusal('Satellite', e)));
    layers.forEach((layer, i) => {
      w.imageryLayers.add(layer, i);
      const hook = (p: { errorEvent: { addEventListener(cb: (e: { error?: unknown; level?: number }) => void): void } }) =>
        p.errorEvent.addEventListener((e) => {
          imageryErrorsRef.current.count++;
          imageryErrorsRef.current.last = redactCredentialText(`level ${e.level ?? '?'}: ${e.error instanceof Error ? e.error.message : 'tile request failed'}`, Object.values(propsRef.current.imageryKeys));
        });
      if (layer.ready) hook(layer.imageryProvider as never);
      else layer.readyEvent.addEventListener((prov) => hook(prov as never));
    });
    basemapLayersRef.current = layers;
    placeNightLights(w);
    placeGeoSatLayers();
    w.scene.requestRender();
  }, [props.archived, props.settings.basemap, props.settings.labelsOverlay, props.imageryKeys.esri, props.imageryKeys.mapbox, props.imageryKeys.google, props.imageryKeys.ion, props.eoxLicensed, failed]);


  // ----- sun position and the dark hemisphere -----
  const solarLighting = props.lighting.mode !== 'day';
  useEffect(() => {
    const w = widgetRef.current;
    if (w && ready) return lightGlobe(w, props.lighting);
  }, [ready, props.lighting]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready || !solarLighting) return;
    const lights = nightLightsLayers();
    for (const layer of lights) w.imageryLayers.add(layer);
    nightLightsRef.current = lights;
    placeNightLights(w);
    w.scene.requestRender();
    return () => {
      nightLightsRef.current = [];
      if (!w.isDestroyed()) {
        for (const layer of lights) w.imageryLayers.remove(layer, true);
        w.scene.requestRender();
      }
    };
  }, [ready, solarLighting]);

  // ----- 3D buildings (OSM extrusions) -----
  useEffect(() => {
    // The selected photoreal mode owns its buildings, including while its mesh loads.
    buildingsRef.current?.setEnabled(props.settings.buildings3d && props.settings.basemap !== 'google3d');
  }, [props.settings.buildings3d, props.settings.basemap, ready]);

  // Ships and parked aircraft are placed for the app's own globe; tell the vehicle layer when Google's 3D surface is showing.
  useEffect(() => {
    layerRendererRef.current?.setPhotoreal(photorealOn, tilesetRef.current);
  }, [photorealOn, ready]);
  useEffect(() => {
    buildingsRef.current?.setFacades(props.settings.buildingFacades);
  }, [props.settings.buildingFacades, ready]);

  // ----- terrain -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    const ionToken = props.settings.ionTerrain ? props.imageryKeys.ion : null;
    if (props.settings.terrainEnabled && ionToken) {
      // Cesium World Terrain from the customer's ion account; the keyless terrain stays the default.
      terrainStatsRef.current = null;
      let cancelled = false;
      void CesiumTerrainProvider.fromUrl(IonResource.fromAssetId(1, { accessToken: ionToken }), { requestVertexNormals: true })
        .then((p) => { if (!cancelled && !w.isDestroyed()) { w.terrainProvider = p; w.scene.requestRender(); } })
        .catch((e) => {
          imageryErrorsRef.current.last = 'Cesium World Terrain: ' + redactCredentialText(e instanceof Error ? e.message : String(e), [ionToken]);
          imageryErrorsRef.current.count++;
          if (cancelled || w.isDestroyed()) return;
          const t = createTerrariumTerrain();
          terrainStatsRef.current = t.stats;
          w.terrainProvider = t.provider;
          w.scene.requestRender();
        });
      return () => { cancelled = true; };
    } else if (props.settings.terrainEnabled) {
      const t = createTerrariumTerrain();
      terrainStatsRef.current = t.stats;
      w.terrainProvider = t.provider;
    } else {
      terrainStatsRef.current = null;
      w.terrainProvider = new EllipsoidTerrainProvider();
    }
    w.scene.requestRender();
  }, [props.settings.terrainEnabled, props.settings.ionTerrain, props.imageryKeys.ion, failed]);

  // ----- TomTom live traffic flow tiles (customer key, metered per tile) -----
  const tomtomLayerRef = useRef<ImageryLayer | null>(null);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (tomtomLayerRef.current) {
      if (w.imageryLayers.contains(tomtomLayerRef.current)) w.imageryLayers.remove(tomtomLayerRef.current, true);
      tomtomLayerRef.current = null;
    }
    const key = props.settings.tomtomTraffic ? props.imageryKeys.tomtom : null;
    if (key) {
      const layer = new ImageryLayer(new UrlTemplateImageryProvider({
        // relative0: colour by speed relative to free flow (green → red); TomTom refreshes these about every minute.
        url: `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256&thickness=8`,
        tilingScheme: new WebMercatorTilingScheme(), minimumLevel: 3, maximumLevel: 18, credit: new Credit('Traffic © TomTom'),
      }), { minimumTerrainLevel: 3 });
      w.imageryLayers.add(layer);
      tomtomLayerRef.current = layer;
    }
    w.scene.requestRender();
  }, [ready, props.settings.tomtomTraffic, props.imageryKeys.tomtom]);
  // TomTom refreshes flow about once a minute; reload the overlay every 2 minutes while it is on.
  useEffect(() => {
    if (!props.settings.tomtomTraffic || !props.imageryKeys.tomtom) return;
    const t = setInterval(() => {
      const w = widgetRef.current;
      const l = tomtomLayerRef.current;
      if (w && l && w.imageryLayers.contains(l)) { const i = w.imageryLayers.indexOf(l); const fresh = new ImageryLayer(l.imageryProvider, { minimumTerrainLevel: 3 }); w.imageryLayers.add(fresh, i + 1); retireWhenLoaded(w, l, 8000, weatherRetireRef.current); tomtomLayerRef.current = fresh; }
    }, 120_000);
    return () => clearInterval(t);
  }, [props.settings.tomtomTraffic, props.imageryKeys.tomtom]);

  // ----- boundaries visibility -----
  useEffect(() => {
    for (const c of boundariesRef.current) c.show = props.layers.boundaries;
    widgetRef.current?.scene.requestRender();
  }, [props.layers.boundaries]);

  // ----- alerts -----
  useEffect(() => {
    const s = sourcesRef.current;
    if (!s) return;
    s.alerts.entities.suspendEvents();
    s.alerts.entities.removeAll();
    const sel = props.selection;
    for (const a of props.alerts) {
      if (!a.geometry) continue;
      const color = Color.fromCssColorString(SEVERITY_META[a.severity].color);
      const isSel = sel?.kind === 'alert' && sel.id === a.id;
      const polys = a.geometry.type === 'Polygon' ? [a.geometry.coordinates] : a.geometry.coordinates;
      polys.forEach((poly, i) => {
        const [outer, ...holes] = poly;
        s.alerts.entities.add({
          id: `alert|${a.id}|${i}`,
          polygon: {
            hierarchy: new PolygonHierarchy(ringPositions(outer), holes.map((h) => new PolygonHierarchy(ringPositions(h)))),
            material: color.withAlpha(isSel ? 0.4 : 0.2),
            outline: true,
            outlineColor: isSel ? HIGHLIGHT : color.withAlpha(0.9),
            height: 0,
          },
          polyline: isSel ? { positions: ringPositions(outer), width: 3, material: HIGHLIGHT } : undefined,
        });
      });
    }
    s.alerts.entities.resumeEvents();
    s.alerts.show = props.layers.alerts;
    widgetRef.current?.scene.requestRender();
  }, [props.alerts, props.layers.alerts, props.selection]);

  // ----- quakes -----
  useEffect(() => {
    const s = sourcesRef.current;
    if (!s) return;
    s.quakes.entities.suspendEvents();
    s.quakes.entities.removeAll();
    const sel = props.selection;
    for (const q of props.quakes) {
      const meta = quakeClass(q.mag);
      const mag = q.mag ?? 0;
      const isSel = sel?.kind === 'quake' && sel.id === q.id;
      s.quakes.entities.add({
        id: `quake|${q.id}`,
        position: Cartesian3.fromDegrees(q.lon, q.lat),
        point: {
          pixelSize: Math.max(5, Math.min(30, 4 + Math.max(0, mag) * 2.6)) + (isSel ? 4 : 0),
          color: Color.fromCssColorString(meta.color).withAlpha(0.85),
          outlineColor: isSel ? HIGHLIGHT : Color.BLACK.withAlpha(0.7),
          outlineWidth: isSel ? 3 : 1.5,
        },
        label:
          mag >= 4.5 || isSel
            ? {
                text: meta.label,
                font: '600 12px "Segoe UI", sans-serif',
                fillColor: Color.WHITE,
                outlineColor: Color.BLACK,
                outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: VerticalOrigin.BOTTOM,
                pixelOffset: new Cartesian2(0, -14),
                distanceDisplayCondition: new DistanceDisplayCondition(0, isSel ? 4e7 : 5e6),
              }
            : undefined,
      });
    }
    s.quakes.entities.resumeEvents();
    s.quakes.show = props.layers.quakes;
    widgetRef.current?.scene.requestRender();
  }, [props.quakes, props.layers.quakes, props.selection]);

  // ----- locations + radii -----
  useEffect(() => {
    const s = sourcesRef.current;
    if (!s) return;
    s.locations.entities.suspendEvents();
    s.radii.entities.suspendEvents();
    s.locations.entities.removeAll();
    s.radii.entities.removeAll();
    const sel = props.selection;
    for (const l of props.locations) {
      const isSel = sel?.kind === 'location' && sel.id === l.id;
      const pos = Cartesian3.fromDegrees(l.lon, l.lat);
      s.locations.entities.add({
        id: `loc|${l.id}`,
        position: pos,
        point: { pixelSize: isSel ? 14 : 10, color: LOC_COLOR, outlineColor: isSel ? HIGHLIGHT : Color.fromCssColorString('#0a1017'), outlineWidth: isSel ? 3 : 2 },
        label: {
          text: l.name,
          font: `${isSel ? 600 : 500} 13px "Segoe UI", sans-serif`,
          fillColor: Color.fromCssColorString('#e6edf3'),
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0d141c').withAlpha(0.78),
          backgroundPadding: new Cartesian2(6, 3),
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -12),
          scaleByDistance: new NearFarScalar(2e5, 1, 1.5e7, 0.75),
          distanceDisplayCondition: new DistanceDisplayCondition(0, isSel ? 4e7 : 1.4e7),
        },
      });
      s.radii.entities.add({
        id: `radius|${l.id}`,
        position: pos,
        ellipse: {
          semiMajorAxis: l.radiusKm * 1000,
          semiMinorAxis: l.radiusKm * 1000,
          height: 0,
          fill: false,
          outline: true,
          outlineColor: isSel ? HIGHLIGHT.withAlpha(0.8) : RADIUS_COLOR,
        },
      });
    }
    s.locations.entities.resumeEvents();
    s.radii.entities.resumeEvents();
    s.locations.show = props.layers.locations;
    s.radii.show = props.layers.radii && props.layers.locations;
    widgetRef.current?.scene.requestRender();
  }, [props.locations, props.layers.locations, props.layers.radii, props.selection]);

  // ----- data layers -----
  const selRecord = props.selection?.kind === 'record' ? props.selection : null;
  useEffect(() => {
    const lr = layerRendererRef.current;
    if (!lr || !ready) return;
    const live = !props.playbackActive;
    for (const [lid, snap] of Object.entries(props.layerSnaps) as [LayerId, LayerSnapshot][]) {
      const on = live && props.layersOn.includes(lid);
      if (on)
        lr.update(lid, lid === 'dwd' ? warningMapRecords(snap) : snap.records, {
          // The global selection on every layer update (each check also compares the layer); a per-layer null
          // would make the renderer forget an aircraft selection when the vessel layer updates.
          selectedId: selRecord?.id ?? null,
          selectedLayer: selRecord?.layer ?? null,
          trackedId: props.trackedRecord?.id ?? null,
          aircraftFilter: props.aircraftFilter,
          vesselClasses: props.vesselClasses,
          smoothMotion: props.settings.smoothMotion,
          aircraftLabels: props.settings.aircraftLabels,
          vesselLabels: props.settings.vesselLabels,
          vehicleModels: props.settings.vehicleModels,
          modelBudget: props.settings.renderQuality === 'maximum' ? 150 : 60,
        });
      lr.setVisible(lid, on);
    }
  }, [props.layerSnaps, props.layersOn, selRecord?.layer, selRecord?.id, props.playbackActive, ready, props.aircraftFilter, props.vesselClasses, props.settings.smoothMotion, props.settings.aircraftLabels, props.settings.vesselLabels, props.settings.vehicleModels, props.settings.renderQuality]);

  // ----- dated imagery overlay -----
  const imageryLayersRef = useRef<ImageryLayer[]>([]);
  const im = props.imagery;
  const imageryDateRevision = useSyncExternalStore(imageryDates.subscribe, imageryDates.revision);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    for (const l of imageryLayersRef.current) w.imageryLayers.remove(l, true);
    imageryLayersRef.current = im ? buildImageryLayers(im) : [];
    const product = gibsProduct(im?.product ?? null);
    const dates = im && product ? [clampDate(product, im.date), ...(im.compare ? [clampDate(product, im.compareDate)] : [])] : [];
    const health = imageryHealth.selection(im?.product ?? null, dates.filter(Boolean));
    for (const [index, layer] of imageryLayersRef.current.entries()) {
      const provider = layer.imageryProvider;
      provider.requestImage = observeImageryRequests(provider.requestImage.bind(provider), health.observer(dates[index]), (args) => args[3]?.state === RequestState.CANCELLED);
      w.imageryLayers.add(layer);
    }
    w.scene.requestRender();
    return health.dispose;
  }, [ready, im?.product, im?.date, im?.compare, im?.compareDate, im?.opacity, imageryDateRevision, basemapLayersRef.current]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    w.scene.splitPosition = im?.split ?? 0.5;
    w.scene.requestRender();
  }, [ready, im?.split]);

  // ----- reported route (dashed great-circle legs between reported airports) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    const entities = routeMapSegments(props.routeLine).map((points, index) =>
      w.entities.add({
        id: 'airline-route-leg-' + index,
        polyline: {
          positions: Cartesian3.fromDegreesArray(points.flat()),
          width: 3,
          clampToGround: true,
          arcType: ArcType.GEODESIC,
          material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#ffd84a').withAlpha(0.85), dashLength: 18 }),
        },
      }));
    w.scene.requestRender();
    return () => {
      if (w.isDestroyed()) return;
      for (const entity of entities) w.entities.remove(entity);
      w.scene.requestRender();
    };
  }, [props.routeLine, ready]);

  // ----- rendering quality -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    const max = props.settings.renderQuality === 'maximum';
    // Maximum: sharpest terrain/imagery level selection, full device-pixel resolution, 4× MSAA, bigger caches.
    w.scene.globe.maximumScreenSpaceError = max ? 1.2 : 2;
    w.scene.globe.tileCacheSize = max ? 1500 : 600;
    w.useBrowserRecommendedResolution = !max;
    // Below full resolution the scene is drawn with fewer pixels, sharpened, and stretched by the window.
    w.resolutionScale = props.settings.renderScale;
    sharpenStageRef.current = applyUpscaleSharpen(w.scene, sharpenStageRef.current, props.settings.renderScale < 1);
    w.scene.msaaSamples = max ? 4 : 1;
    w.scene.postProcessStages.fxaa.enabled = !max;
    buildingsRef.current?.setQuality(max);
    // Reload buildings and labels for the current view with the new radius and density.
    reportViewRef.current?.();
    const ts = tilesetRef.current;
    if (ts) {
      ts.maximumScreenSpaceError = max ? 6 : 16;
      ts.cacheBytes = max ? 2 * 1024 ** 3 : 512 * 1024 ** 2;
      ts.preloadWhenHidden = propsRef.current.lighting.mode === 'day' && !propsRef.current.archived
        && shouldPreloadHidden(w.camera.positionCartographic.height, w.scene.mode === SceneMode.SCENE3D, max);
    }
    w.scene.requestRender();
  }, [ready, props.settings.renderQuality, props.settings.renderScale]);

  // ----- geographic labels (screen-space, collision-managed) -----
  useEffect(() => {
    if (!ready) return;
    const s = props.settings;
    placeLabelsRef.current?.setOptions({ level: s.geoLabels, streets: s.streetLabels, density: s.labelDensity, size: s.labelSize, language: s.labelLanguage });
  }, [ready, props.settings.geoLabels, props.settings.streetLabels, props.settings.labelDensity, props.settings.labelSize, props.settings.labelLanguage]);

  // ----- airports (bundled OurAirports, public domain) -----
  // Static primitives (not entities): 5,282 airports would otherwise be re-evaluated by the entity
  // system on every frame. Picking still works through the 'apt|ICAO' ids.
  const airportPrimsRef = useRef<{ points: PointPrimitiveCollection; labels: LabelCollection } | null>(null);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (!airportPrimsRef.current) {
      const points = new PointPrimitiveCollection();
      const labels = new LabelCollection();
      const list = AIRPORTS;
      const fill = Color.fromCssColorString('#cfd8e3');
      const ring = Color.fromCssColorString('#0a1017');
      for (const [icao, iata, , la, lo, , , , size] of list) {
        const far = size === 'L' ? 1.5e6 : 4e5;
        const position = Cartesian3.fromDegrees(lo, la);
        const id = 'apt|' + icao;
        points.add({ id, position, pixelSize: size === 'L' ? 7 : 5, color: fill, outlineColor: ring, outlineWidth: 2, distanceDisplayCondition: new DistanceDisplayCondition(0, far) });
        labels.add({ id, position, text: iata || icao, font: '600 11px "Segoe UI", sans-serif', fillColor: fill, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(10, 0), horizontalOrigin: HorizontalOrigin.LEFT, distanceDisplayCondition: new DistanceDisplayCondition(0, far * 0.6) });
      }
      w.scene.primitives.add(points);
      w.scene.primitives.add(labels);
      airportPrimsRef.current = { points, labels };
    }
    airportPrimsRef.current.points.show = props.showAirports;
    airportPrimsRef.current.labels.show = props.showAirports;
    w.scene.requestRender();
  }, [props.showAirports, ready]);

  // ----- map mode (3D globe or 2D map) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    cameraRestoreRef.current?.setMode(props.sceneMode);
  }, [props.sceneMode, ready]);

  useEffect(() => {
    layerRendererRef.current?.showOrbit(props.showOrbitFor);
  }, [props.showOrbitFor, props.layerSnaps.satellites]);

  useEffect(() => {
    layerRendererRef.current?.showTrail(props.trail, props.trailKind, props.trackedRecord ?? null);
  }, [props.trail, props.trailKind, props.trackedRecord?.layer, props.trackedRecord?.id]);
  useEffect(() => {
    layerRendererRef.current?.showFlightPath(props.flightPath ?? null);
  }, [props.flightPath, ready]);

  // ----- camera follow (tracking) -----
  const passengerFollow = useMemo(() => {
    const target = props.trackedRecord;
    return target?.layer === 'aircraft' || target?.layer === 'aircraftMil';
  }, [props.trackedRecord?.layer, props.trackedRecord?.id]);
  useEffect(() => {
    passengerFollowRef.current = null;
    const w = widgetRef.current;
    if (!w || !ready) return;
    const t = props.trackedRecord;
    if (!t) { w.trackedEntity = undefined; return; }
    if (props.trackingMode === 'cockpit' || props.trackingMode === 'passenger') {
      const dispose = attachCockpit(w, {
        layer: t.layer,
        record: () => layerRendererRef.current?.recordFor(t.layer, t.id),
        position: () => layerRendererRef.current?.positionFor(t.layer, t.id),
        heading: () => layerRendererRef.current?.displayedHeadingFor(t.layer, t.id),
        attitude: () => layerRendererRef.current?.displayedAttitudeFor(t.layer, t.id),
        seat: () => propsRef.current.passengerSeat,
        interiorStatus: (status) => propsRef.current.onInteriorStatus?.(status),
        hideOwnVehicle: (hidden) => layerRendererRef.current?.setInteriorTarget(hidden ? t : null),
      }, (reason) => propsRef.current.onTrackingUnavailable?.(reason), props.trackingMode);
      cockpitCleanupRef.current = dispose;
      return () => { dispose(); if (cockpitCleanupRef.current === dispose) cockpitCleanupRef.current = null; };
    }
    if (passengerFollow) {
      cameraRestoreRef.current?.cancel();
      const dispose = attachPassengerFollow(w, () => {
        const lr = layerRendererRef.current;
        return lr?.positionFor(t.layer, t.id);
      }, () => reportViewRef.current?.(), reason => propsRef.current.onTrackingUnavailable?.(reason));
      passengerFollowRef.current = { id: t.id, dispose };
      return dispose;
    }
    // A dedicated anchor survives entity ↔ batched rendering and exposes no provider/network access.
    const anchor = new Entity({
      id: 'atlas-tracking-anchor',
      position: new CallbackPositionProperty(() => layerRendererRef.current?.positionFor(t.layer, t.id), false),
      viewFrom: new Cartesian3(0, -2500, 1200),
    });
    w.trackedEntity = anchor;
    w.scene.requestRender();
    return () => { if (!w.isDestroyed() && w.trackedEntity === anchor) w.trackedEntity = undefined; };
  }, [props.trackedRecord?.layer, props.trackedRecord?.id, props.trackingMode, passengerFollow, ready]);

  // ----- geostationary weather satellites (NASA GIBS): the newest frame is looked up every 10 minutes -----
  const weatherBack = clampBack(props.weatherBackMin ?? 0);
  const geoOn = props.settings.geoSatEnabled;
  const geoProduct: GeoSatProduct = props.settings.geoSatProduct === 'color' ? 'color' : 'infrared';
  const [geoFrames, setGeoFrames] = useState<{ product: GeoSatProduct; times: GeoFrames }>({ product: 'infrared', times: {} });
  useEffect(() => {
    if (!geoOn) return;
    // Frames kept from an earlier session of the layer are judged again now, before any lookup answers.
    setGeoFrames((prev) => {
      const times = expireFrames(prev.times, Date.now());
      return times === prev.times ? prev : { ...prev, times };
    });
    const stop = new AbortController();
    // Each satellite is looked up on its own: a slow answer never holds back the others, and an answer older
    // than the newest request for that satellite is ignored.
    const latestRequest: Partial<Record<GeoSatId, number>> = {};
    const lookup = async (s: (typeof GEO_SATS)[number]) => {
      const mine = (latestRequest[s.id] = (latestRequest[s.id] ?? 0) + 1);
      let time: string | null | undefined;
      let error: string | null = null;
      try {
        // Meteosat is drawn from hourly frames, whose times are known: no lookup request.
        time = s.source === 'eumetsat' ? eumetsatFrameTime(Date.now()) : await fetchLatestFrame(s.layers[geoProduct], Date.now(), { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(GEO_SAT_LOOKUP_TIMEOUT_MS)]) });
      } catch (e) {
        time = undefined;
        error = `${s.name}: ${e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out' : e.message) : 'lookup failed'}`;
      }
      if (stop.signal.aborted || latestRequest[s.id] !== mine) return;
      const st = geoStatsRef.current;
      st.checks++;
      if (error) {
        st.failedChecks++;
        st.lastError = error.slice(0, 300);
      }
      setGeoFrames((prev) => {
        const base = prev.product === geoProduct ? prev.times : {};
        // A failed lookup keeps the frame on screen while it is recent enough; a frame too old is dropped, never stretched.
        const t = time === undefined ? (base[s.id] ?? null) : time;
        return { product: geoProduct, times: { ...base, [s.id]: frameUsable(t, Date.now()) ? t : null } };
      });
    };
    const checkAll = () => {
      for (const s of GEO_SATS) void lookup(s);
    };
    checkAll();
    const poll = setInterval(checkAll, GEO_SAT_REFRESH_MS);
    // Frames expire on their own clock, whatever the network is doing.
    const expiry = setInterval(() => setGeoFrames((prev) => {
      const times = expireFrames(prev.times, Date.now());
      return times === prev.times ? prev : { ...prev, times };
    }), 60_000);
    return () => {
      stop.abort();
      clearInterval(poll);
      clearInterval(expiry);
    };
  }, [geoOn, geoProduct]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    // Preserve source imagery when weather frames are toggled; do not restore synthetic white ocean highlights.
    w.scene.globe.showWaterEffect = false;
    const want = new Map<GeoSatId, { key: string; make: () => ImageryLayer }>();
    if (geoOn && geoFrames.product === geoProduct)
      for (const s of GEO_SATS) {
        const latest = geoFrames.times[s.id] ?? null;
        // Checked at draw time too: frames kept while the layer was off must not come back once they are too old.
        if (!frameUsable(latest, Date.now())) continue;
        // History: counted back from the newest frame (GIBS, 10-minute frames) or from the clock (Meteosat, hourly).
        const time = weatherBack === 0 ? latest : s.source === 'eumetsat' ? eumetsatFrameTime(Date.now() - weatherBack * 60_000) : satFrameBack(latest, weatherBack);
        if (!time) continue;
        const L = s.layers[geoProduct];
        const clip = Rectangle.fromDegrees(s.west, -GEO_SAT_MAX_LAT, s.east, GEO_SAT_MAX_LAT);
        want.set(s.id, {
          key: `${L.id}|${time}`,
          make: () => s.source === 'eumetsat'
            ? new ImageryLayer(
              new WebMapServiceImageryProvider({
                url: EUMETSAT_WMS,
                layers: L.id,
                parameters: { transparent: true, format: 'image/png', styles: '', time },
                tilingScheme: new GeographicTilingScheme(),
                maximumLevel: L.maxLevel,
                credit: new Credit(`${s.name} ${L.title}, ${frameLabel(time)} (© EUMETSAT)`),
              }),
              // The infrared frame is opaque grey with warm ground nearly black; dark pixels are made transparent on
              // the GPU so clouds show over the map, as the GIBS infrared layers do.
              { alpha: 0.85, rectangle: clip, ...(geoProduct === 'infrared' ? { colorToAlpha: Color.BLACK, colorToAlphaThreshold: 0.28 } : {}) },
            )
            : new ImageryLayer(
              new UrlTemplateImageryProvider({
                url: tileTemplate(L, time),
                tilingScheme: new WebMercatorTilingScheme(),
                maximumLevel: L.maxLevel,
                credit: new Credit(`${s.name} ${L.title}, ${frameLabel(time)} (${s.agency} via NASA GIBS)`),
              }),
              { alpha: 0.85, rectangle: clip },
            ),
        });
      }
    const retire = (old: ImageryLayer) => {
      // Keep the previous frame over the new one until the new tiles have loaded (or 20 s at most).
      geoRetiringRef.current.add(old);
      let sawLoading = false;
      const cancel = () => {
        off();
        clearTimeout(timer);
        geoRetireCancelRef.current.delete(old);
      };
      const finish = () => {
        cancel();
        if (!geoRetiringRef.current.delete(old) || w.isDestroyed()) return;
        if (w.imageryLayers.contains(old)) w.imageryLayers.remove(old, true);
        w.scene.requestRender();
      };
      const off = w.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
        if (n > 0) sawLoading = true;
        else if (sawLoading) finish();
      });
      const timer = setTimeout(finish, 20_000);
      geoRetireCancelRef.current.set(old, cancel);
    };
    const cur = geoLayersRef.current;
    for (const [id, g] of [...cur]) {
      if (want.has(id)) continue;
      if (w.imageryLayers.contains(g.layer)) w.imageryLayers.remove(g.layer, true);
      cur.delete(id);
    }
    for (const [id, next] of want) {
      const had = cur.get(id);
      if (had?.key === next.key && w.imageryLayers.contains(had.layer)) continue;
      const layer = next.make();
      w.imageryLayers.add(layer);
      cur.set(id, { key: next.key, layer });
      if (had && w.imageryLayers.contains(had.layer)) retire(had.layer);
    }
    if (!geoOn) {
      for (const c of [...geoRetireCancelRef.current.values()]) c();
      for (const l of geoRetiringRef.current) if (w.imageryLayers.contains(l)) w.imageryLayers.remove(l, true);
      geoRetiringRef.current.clear();
    }
    placeGeoSatLayers();
    w.scene.requestRender();
  }, [geoOn, geoProduct, geoFrames, weatherBack, ready]);
  // On unmount the widget (and its layers) is destroyed elsewhere: only stop pending frame swaps and forget the layers.
  useEffect(
    () => () => {
      for (const c of [...geoRetireCancelRef.current.values()]) c();
      geoRetiringRef.current.clear();
      geoLayersRef.current.clear();
    },
    [],
  );

  // ----- radar overlay (NOAA nowCOAST WMS), refreshed every 5 minutes -----
  const [radarTick, setRadarTick] = useState(0);
  useEffect(() => {
    if (!props.settings.radarEnabled) return;
    const t = setInterval(() => setRadarTick((n) => n + 1), 5 * 60_000);
    return () => clearInterval(t);
  }, [props.settings.radarEnabled]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    const old = radarLayerRef.current;
    radarLayerRef.current = null;
    if (props.settings.radarEnabled) {
      // A past frame is asked for by time; nowCOAST answers with its nearest frame (about every 4 minutes).
      const time = wmsTime(Date.now(), weatherBack);
      const layer = new ImageryLayer(
        new WebMapServiceImageryProvider({
          url: 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows',
          layers: 'base_reflectivity_mosaic',
          parameters: { transparent: true, format: 'image/png', ...(time ? { time } : { _refresh: String(radarTick) }) },
          tilingScheme: new WebMercatorTilingScheme(),
          maximumLevel: 10,
          credit: time ? `Radar: NOAA nowCOAST (observed base reflectivity, frame nearest ${time.slice(11, 16)} UTC)` : 'Radar: NOAA nowCOAST (observed base reflectivity mosaic)',
        }),
        { alpha: 0.65 },
      );
      w.imageryLayers.add(layer);
      radarLayerRef.current = layer;
    }
    if (old && w.imageryLayers.contains(old)) {
      if (radarLayerRef.current) retireWhenLoaded(w, old, 8000, weatherRetireRef.current);
      else w.imageryLayers.remove(old, true);
    }
    w.scene.requestRender();
  }, [props.settings.radarEnabled, radarTick, weatherBack, props.settings.basemap, ready]);

  // ----- rivers: OpenStreetMap waterways from OpenFreeMap vector tiles, drawn as a glowing overlay -----
  const riversLayerRef = useRef<ImageryLayer | null>(null);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (props.settings.riversEnabled && !riversLayerRef.current) {
      const layer = new ImageryLayer(createVectorImageryProvider('rivers'), { minimumTerrainLevel: 3 });
      w.imageryLayers.add(layer);
      riversLayerRef.current = layer;
    } else if (!props.settings.riversEnabled && riversLayerRef.current) {
      if (w.imageryLayers.contains(riversLayerRef.current)) w.imageryLayers.remove(riversLayerRef.current, true);
      riversLayerRef.current = null;
    }
    w.scene.requestRender();
  }, [ready, props.settings.riversEnabled]);
  // Keep the river overlay above basemap changes.
  useEffect(() => {
    const w = widgetRef.current;
    const l = riversLayerRef.current;
    if (w && l && w.imageryLayers.contains(l)) w.imageryLayers.raiseToTop(l);
  });

  // ----- lightning strike density (NOAA nowCOAST WMS, 15-minute accumulation), refreshed every 5 minutes -----
  const [lightningTick, setLightningTick] = useState(0);
  useEffect(() => {
    if (!props.settings.lightningEnabled) return;
    const t = setInterval(() => setLightningTick((n) => n + 1), 5 * 60_000);
    return () => clearInterval(t);
  }, [props.settings.lightningEnabled]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    const old = lightningLayerRef.current;
    lightningLayerRef.current = null;
    if (old && w.imageryLayers.contains(old)) {
      if (props.settings.lightningEnabled) retireWhenLoaded(w, old, 8000, weatherRetireRef.current);
      else w.imageryLayers.remove(old, true);
    }
    if (props.settings.lightningEnabled) {
      // Past frames are 15 minutes apart; nowCOAST answers a requested time with its nearest frame.
      const time = wmsTime(Date.now(), weatherBack);
      const layer = new ImageryLayer(
        new WebMapServiceImageryProvider({
          url: 'https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows',
          layers: 'ldn_lightning_strike_density',
          parameters: { transparent: true, format: 'image/png', ...(time ? { time } : { _refresh: String(lightningTick) }) },
          tilingScheme: new WebMercatorTilingScheme(),
          // The grid is about 8 km; deeper tiles add requests, not detail.
          maximumLevel: 8,
          credit: 'Lightning: NOAA nowCOAST (NLDN and GLD360 strike density, 15 minutes)',
        }),
        { alpha: 0.8 },
      );
      w.imageryLayers.add(layer);
      lightningLayerRef.current = layer;
    }
    w.scene.requestRender();
  }, [props.settings.lightningEnabled, lightningTick, weatherBack, props.settings.basemap, ready]);
  // Unmount: stop waiting on frames that were being replaced (the widget and its layers are destroyed elsewhere).
  useEffect(() => () => { for (const c of [...weatherRetireRef.current]) c(); weatherRetireRef.current.clear(); }, []);

  // ----- animated wind (GFS forecast) on a canvas over the globe -----
  const windOverlayRef = useRef<WindOverlay | null>(null);
  useEffect(() => {
    const w = widgetRef.current;
    const field = props.windField ?? null;
    if (!w || !field) {
      windOverlayRef.current?.destroy();
      windOverlayRef.current = null;
      return;
    }
    if (windOverlayRef.current) windOverlayRef.current.setField(field);
    else windOverlayRef.current = new WindOverlay(w, field, reducedRef.current, props.settings.renderQuality === 'maximum' ? 3500 : 2200, props.windColorBySpeed === true);
  }, [props.windField, ready]);
  useEffect(() => { windOverlayRef.current?.setColorBySpeed(props.windColorBySpeed === true); }, [props.windColorBySpeed]);
  useEffect(() => { windOverlayRef.current?.setReduced(reduced); }, [reduced]);

  // ----- simulated vehicles on traffic-flow roads (illustration from measured flow) -----
  const trafficSimRef = useRef<TrafficSim | null>(null);
  const simRecords = props.layerSnaps.trafficFlow?.records;
  const simOn = !!props.settings.trafficSimEnabled && props.layersOn.includes('trafficFlow') && !props.playbackActive;
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready || !simOn) {
      trafficSimRef.current?.destroy();
      trafficSimRef.current = null;
      return;
    }
    if (!trafficSimRef.current) trafficSimRef.current = new TrafficSim(w, reducedRef.current);
    trafficSimRef.current.setRecords(simRecords ?? []);
  }, [simOn, simRecords, ready]);
  useEffect(() => { trafficSimRef.current?.setReduced(reduced); }, [reduced]);
  useEffect(() => () => { trafficSimRef.current?.destroy(); trafficSimRef.current = null; }, []);
  useEffect(() => () => { windOverlayRef.current?.destroy(); windOverlayRef.current = null; }, []);

  // ----- visual display modes (post-processing; visual effect only) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    postStageRef.current = applyVisualMode(w.scene, postStageRef.current, props.settings.visualMode);
    w.scene.requestRender();
  }, [props.settings.visualMode, ready]);

  // ----- annotations and in-progress drawing/measurement -----
  useEffect(() => {
    const src = annoSourceRef.current;
    const w = widgetRef.current;
    if (!src || !w) return;
    src.entities.removeAll();
    const lbl = (text: string) => ({ text, font: '600 12px "Segoe UI", sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -12), disableDepthTestDistance: Number.POSITIVE_INFINITY });
    const add = (id: string, kind: 'pin' | 'line' | 'area', pts: [number, number][], color: Color, name: string | null, dashed: boolean) => {
      if (pts.length === 0) return;
      const positions = pts.map(([x, y]) => Cartesian3.fromDegrees(x, y));
      if (kind === 'pin' || pts.length === 1) {
        src.entities.add({ id, position: positions[0], point: { pixelSize: 10, color, outlineColor: Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: name ? lbl(name) : undefined });
        if (kind === 'pin') return;
      }
      const line = kind === 'area' && pts.length > 2 ? [...positions, positions[0]] : positions;
      src.entities.add({ id: id + '|line', polyline: { positions: line, width: 2.5, clampToGround: true, material: dashed ? new PolylineDashMaterialProperty({ color, dashLength: 14 }) : color } });
      if (kind === 'area' && pts.length > 2) src.entities.add({ id: id + '|fill', polygon: { hierarchy: new PolygonHierarchy(positions), material: color.withAlpha(0.18) } });
      if (name) src.entities.add({ id: id + '|label', position: positions[0], label: lbl(name) });
    };
    for (const a of props.annotations) if (a.visible) add('anno|' + a.id, a.kind, a.points, Color.fromCssColorString(a.color), a.name, false);
    if (props.tool !== 'none' && props.draftPoints.length) {
      const kind = props.tool === 'draw-pin' ? 'pin' : props.tool === 'measure-area' || props.tool === 'draw-area' ? 'area' : 'line';
      add('draft', kind, props.draftPoints, Color.fromCssColorString('#ffd166'), null, true);
    }
    w.scene.requestRender();
  }, [props.annotations, props.draftPoints, props.tool]);

  // ----- playback of recorded observations -----
  useEffect(() => {
    const src = playbackSourceRef.current;
    const w = widgetRef.current;
    if (!src || !w) return;
    src.entities.removeAll();
    if (props.playback) {
      for (const p of props.playback.points) {
        src.entities.add({
          id: 'pb|' + p.layer + '|' + p.rid,
          // Same vertical reference as live vehicles (sea level / ground on Google 3D tiles).
          position: Cartesian3.fromDegrees(p.lon, p.lat, layerRendererRef.current?.recordedHeight(p.layer, p) ?? (p.layer.startsWith('aircraft') ? Math.max(0, p.altM ?? 0) : 0)),
          point: { pixelSize: 7, color: Color.TRANSPARENT, outlineColor: Color.fromCssColorString(p.layer === 'vessels' ? '#7fc48d' : p.layer === 'transit' ? '#f2d24a' : '#e9f3fb'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    }
    w.scene.requestRender();
  }, [props.playback, heightsVersion]);

  // During playback the live layers are hidden, so re-place markers when the camera settles somewhere new
  // (their ground heights are only requested near the camera).
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    return w.camera.moveEnd.addEventListener(() => {
      if (propsRef.current.playback) setHeightsVersion((v) => v + 1);
    });
  }, [ready]);

  // The city mesh contains daylight photography. Temporarily keep the loaded tileset hidden
  // while the globe displays night lights, then resume the same Google session on return.
  const presentPhotoreal = (w: CesiumWidget, ts: Cesium3DTileset) => {
    photorealCleanupRef.current?.();
    photorealCleanupRef.current = null;
    if (propsRef.current.lighting.mode === 'day' && !propsRef.current.archived) {
      // The watcher also loads the hidden mesh during the approach (always, at Maximum quality).
      photorealCleanupRef.current = watchPhotorealSurface(w, ts, setPhotorealOn, undefined, undefined, () => propsRef.current.settings.renderQuality === 'maximum');
    } else {
      ts.preloadWhenHidden = false;
      ts.show = false;
      setPhotorealOn(false);
      w.scene.requestRender();
    }
  };
  const archiveSurface = !!props.archived;
  useEffect(() => {
    const w = widgetRef.current;
    if (w && tilesetRef.current) presentPhotoreal(w, tilesetRef.current);
  }, [solarLighting, archiveSurface]);

  // ----- optional Google Photorealistic 3D Tiles (customer key, metered) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    let cancelled = false;
    photorealCleanupRef.current?.();
    photorealCleanupRef.current = null;
    if (tilesetRef.current) {
      w.scene.primitives.remove(tilesetRef.current);
      tilesetRef.current = null;
    }
    w.scene.globe.show = true;
    setPhotorealOn(false);
    if (props.google3dKey) {
      GoogleMaps.defaultApiKey = props.google3dKey;
      const maxQ = propsRef.current.settings.renderQuality === 'maximum';
      // Session cache only (Google's terms do not allow pre-downloading or storing tiles). Flight destinations
      // are preloaded, and the watcher loads the hidden mesh on approach. Maximum quality asks for finer detail
      // and keeps up to 2 GB of tiles in memory.
      void createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: maxQ ? 6 : 16, cacheBytes: maxQ ? 2 * 1024 ** 3 : 512 * 1024 ** 2, preloadFlightDestinations: true, preloadWhenHidden: maxQ })
        .then((ts) => {
          if (cancelled) { ts.destroy(); return; }
          // The root can load while individual tiles are refused (quota, restrictions). If tiles keep
          // failing before any loads, go back to the normal globe instead of showing an empty scene.
          let loaded = 0;
          let failed = 0;
          photorealStatsRef.current = { loaded: 0, failed: 0 };
          ts.tileLoad.addEventListener(() => { loaded++; photorealStatsRef.current.loaded++; });
          ts.tileFailed.addEventListener((e: { message?: string }) => {
            failed++;
            photorealStatsRef.current.failed++;
            imageryErrorsRef.current.last = 'Google 3D Tiles: ' + redactCredentialText(e?.message ?? 'tile failed', [propsRef.current.google3dKey]);
            imageryErrorsRef.current.count++;
            if (loaded === 0 && failed === 3 && tilesetRef.current === ts) {
              photorealCleanupRef.current?.();
              photorealCleanupRef.current = null;
              w.scene.primitives.remove(ts);
              tilesetRef.current = null;
              w.scene.globe.show = true;
              setPhotorealOn(false);
              propsRef.current.onProviderError?.(googleRefusal('Photoreal 3D', new Error(e?.message ?? '')));
              w.scene.requestRender();
            }
          });
          tilesetRef.current = w.scene.primitives.add(ts);
          presentPhotoreal(w, ts);
        })
        .catch((e) => {
          const status = googleStatus(e);
          imageryErrorsRef.current.last = 'Google 3D Tiles: ' + (status ? 'HTTP ' + status : 'no HTTP answer') + ' · ' + redactCredentialText(e instanceof Error ? e.message : String(e), [propsRef.current.google3dKey]);
          imageryErrorsRef.current.count++;
          propsRef.current.onProviderError?.(googleRefusal('Photoreal 3D', e));
        });
    }
    return () => {
      cancelled = true;
      photorealCleanupRef.current?.();
      photorealCleanupRef.current = null;
    };
  }, [props.google3dKey, ready]);

  // ----- pick-mode cursor -----
  useEffect(() => {
    const c = widgetRef.current?.canvas;
    if (c) c.style.cursor = props.pickMode || props.planPick || props.tool !== 'none' ? 'crosshair' : '';
  }, [props.pickMode, props.tool, props.planPick]);

  // ----- protective plan overlay -----
  const planOverlayRef = useRef<PlanningOverlay | null>(null);
  const siteLookRef = useRef(false);
  useEffect(() => {
    const w = widgetRef.current;
    siteLookRef.current = !!props.siteLook;
    buildingsRef.current?.setDark(!!props.siteLook);
    if (!w || w.isDestroyed()) return;
    // Dim and desaturate every imagery layer except the coverage picture; checked each frame so imagery added later
    // (basemap switches, overlays) follows too.
    const apply = () => {
      const dark = siteLookRef.current;
      const layers = w.imageryLayers;
      for (let i = 0; i < layers.length; i++) {
        const l = layers.get(i);
        if ((l as unknown as { atlasPlanCoverage?: boolean }).atlasPlanCoverage) continue;
        const b = dark ? 0.36 : 1;
        const sat = dark ? 0.1 : 1;
        if (l.brightness !== b) l.brightness = b;
        if (l.saturation !== sat) l.saturation = sat;
      }
    };
    const off = w.scene.preRender.addEventListener(apply);
    w.scene.requestRender();
    return off;
  }, [props.siteLook, ready]);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (!props.planOverlay) {
      planOverlayRef.current?.destroy();
      planOverlayRef.current = null;
      return;
    }
    planOverlayRef.current ??= new PlanningOverlay(w);
    planOverlayRef.current.update(props.planOverlay);
  }, [props.planOverlay, ready]);
  useEffect(() => () => {
    planOverlayRef.current?.destroy();
    planOverlayRef.current = null;
  }, []);

  useImperativeHandle(ref, () => {
    const fly = (destination: Cartesian3 | Rectangle) => {
      const w = widgetRef.current;
      if (!w) return;
      cameraRestoreRef.current?.cancel();
      if (passengerFollowRef.current && w.trackedEntity) {
        passengerFollowRef.current.dispose();
        passengerFollowRef.current = null;
        propsRef.current.onTrackingUnavailable?.('Follow ended when you changed the map view.');
      }
      const orientation = { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 };
      if (reducedRef.current) w.camera.setView({ destination, orientation });
      else w.camera.flyTo({ destination, orientation, duration: 1.2 });
      w.scene.requestRender();
    };
    return {
      focusAirlineRoute: route => {
        const w = widgetRef.current;
        const bounds = airlineRouteBounds(route);
        if (!w || !bounds) return;
        if (w.scene.mode === SceneMode.MORPHING) w.scene.completeMorph();
        cockpitCleanupRef.current?.();
        cockpitCleanupRef.current = null;
        w.trackedEntity = undefined;
        fly(bounds);
      },
      replayMap: (kind, id) => {
        const w = widgetRef.current;
        const sources = sourcesRef.current;
        if (!w || !sources) return null;
        const clock = w.clock.currentTime;
        const polygon = kind === 'alert' && id ? sources.alerts.entities.getById(`alert|${id}|0`)?.polygon?.hierarchy?.getValue(clock) as PolygonHierarchy | undefined : undefined;
        const epicenter = kind === 'quake' && id ? sources.quakes.entities.getById('quake|' + id)?.position?.getValue(clock) : undefined;
        const points = epicenter ? [epicenter] : polygon?.positions.slice(0, 8) ?? [];
        const positions: [number, number][] = points.map(point => {
          const c = Cartographic.fromCartesian(point);
          return [CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)];
        });
        const xy = epicenter && w.scene.cartesianToCanvasCoordinates(epicenter);
        const rect = w.canvas.getBoundingClientRect();
        return { active: propsRef.current.playbackActive, cursor: propsRef.current.playback?.t ?? null,
          alertCount: sources.alerts.show ? sources.alerts.entities.values.length : 0, quakeCount: sources.quakes.show ? sources.quakes.entities.values.length : 0,
          positions, screen: xy ? { x: rect.left + xy.x, y: rect.top + xy.y } : null };
      },
      getDiagnostics: () => {
        const w = widgetRef.current;
        if (!w) return null;
        const c = w.camera.positionCartographic;
        const lat = CMath.toDegrees(c.latitude);
        const lon = CMath.toDegrees(c.longitude);
        // Private Cesium field, read-only: levels of tiles drawn this frame (diagnostic only).
        const tiles = (w.scene.globe as unknown as { _surface?: { _tilesToRender?: { level: number }[] } })._surface?._tilesToRender ?? [];
        const maxRenderedLevel = tiles.length ? Math.max(...tiles.map((t) => t.level)) : null;
        let routeLegCount = 0;
        for (let i = 0; ; i++) {
          const line = w.entities.getById('airline-route-leg-' + i)?.polyline;
          if (!line) break;
          const vertices = line.positions?.getValue(w.clock.currentTime) as Cartesian3[] | undefined;
          if (line.show?.getValue(w.clock.currentTime) !== false && vertices) routeLegCount += Math.max(0, vertices.length - 1);
        }
        const def = propsRef.current.archived ? historicalBasemap(propsRef.current.archived) : BASEMAPS[isBasemapId(propsRef.current.settings.basemap) ? propsRef.current.settings.basemap : 'atlas'];
        const here = imagerySourcesHere(def, lon, lat);
        const imageryMaxLevelHere = here.length ? Math.max(...here.map((s) => s.maxLevel)) : 0;
        const ts = terrainStatsRef.current;
        return {
          cameraHeightM: c.height,
          cameraLat: lat,
          cameraLon: lon,
          tilesPending: tilesPendingRef.current,
          maxRenderedLevel,
          imageryMaxLevelHere,
          // Terrain tiles use Web Mercator levels when terrain is on; geographic levels run one lower.
          imageryAtLimit: maxRenderedLevel !== null && imageryMaxLevelHere > 0 && maxRenderedLevel + (ts ? 0 : 1) > imageryMaxLevelHere,
          imageryErrors: imageryErrorsRef.current.count,
          globeShown: widgetRef.current?.scene.globe.show ?? null,
          renderErrors: renderErrorsRef.current.count,
          routeLegCount,
          lastRenderError: renderErrorsRef.current.last,
          imageryLayerCount: widgetRef.current?.imageryLayers.length ?? null,
          photorealLoaded: !!tilesetRef.current,
          // Mesh loading state: drawn or only loading ahead, whether the current view is complete, tiles so far this session.
          photoreal: tilesetRef.current ? { shown: tilesetRef.current.show, preloading: tilesetRef.current.preloadWhenHidden, complete: tilesetRef.current.tilesLoaded, ...photorealStatsRef.current } : null,
          lastImageryError: imageryErrorsRef.current.last,
          basemapSources: def.sources,
          terrain: ts ? { ...TERRAIN_INFO, ...ts } : null,
          vector: { ...vectorStats, overlayOn: propsRef.current.settings.labelsOverlay || def.id === 'streets' },
          usgs: { ...usgsStats },
          models: { ...modelStats, textureBytes: [...modelStats.textureBytes], pack: { ...packStats }, geoid: { ...geoidStats } },
          sea: { ...seaStats, unavailableTiles: [...seaStats.unavailableTiles].slice(-20) },
          buildings: { ...(buildingsRef.current?.stats ?? { tilesLoaded: 0, buildingsDrawn: 0, lastError: null, visible: false, baseSpreadM: null, baseFallbacks: 0 }), enabled: propsRef.current.settings.buildings3d, maxCameraM: BUILDINGS_MAX_CAMERA_M },
          geoSat: { enabled: propsRef.current.settings.geoSatEnabled, product: propsRef.current.settings.geoSatProduct, frames: Object.fromEntries([...geoLayersRef.current].map(([id, g]) => [id, g.key.split('|')[1] ?? null])), ...geoStatsRef.current, layers: geoLayersRef.current.size },
          missingRequirement:
            def.requires === 'esri' && !propsRef.current.imageryKeys.esri
              ? 'Esri World Imagery needs your ArcGIS key (Providers). Showing keyless imagery.'
              : def.requires === 'mapbox' && !propsRef.current.imageryKeys.mapbox
                ? 'Mapbox Satellite needs your token (Providers). Showing keyless imagery.'
                : def.requires === 'cesium' && !propsRef.current.imageryKeys.ion
                  ? 'Bing Maps via Cesium ion needs your Cesium ion token (Providers). Showing keyless imagery.'
                : def.requires === 'eox' && !propsRef.current.eoxLicensed
                  ? 'Sentinel-2 cloudless needs an EOX commercial license confirmation (Providers). Showing keyless imagery.'
                  : def.id === 'google2d' && !propsRef.current.imageryKeys.google
                    ? 'Google Satellite needs your Google key (Providers). Showing keyless imagery.'
                  : def.requires === 'google3d' && def.id === 'google3d' && !propsRef.current.google3dKey
                    ? 'Google 3D Tiles need your Google key (Providers).'
                    : null,
        };
      },
      getCamera: () => {
        const w = widgetRef.current;
        if (!w || w.scene.mode === SceneMode.MORPHING) return null;
        const c = w.camera.positionCartographic;
        return capturedCamera({ lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude), heightM: c.height, heading: w.camera.heading, pitch: w.camera.pitch });
      },
      pickId: (x, y) => {
        const w = widgetRef.current;
        if (!w) return null;
        const r = w.scene.canvas.getBoundingClientRect();
        const picked = w.scene.pick(new Cartesian2(x - r.left, y - r.top));
        return defined(picked) && picked.id instanceof Entity ? String(picked.id.id) : defined(picked) ? '(primitive)' : null;
      },
      toScreen: (lat, lon) => {
        const w = widgetRef.current;
        if (!w) return null;
        const c = Cartographic.fromDegrees(lon, lat);
        const h = w.scene.globe.getHeight(c) ?? 0;
        const p = SceneTransforms.worldToWindowCoordinates(w.scene, Cartesian3.fromDegrees(lon, lat, h));
        if (!p) return null;
        const r = w.scene.canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      getMapCenter: () => {
        const w = widgetRef.current;
        if (!w || w.scene.mode === SceneMode.MORPHING) return null;
        const position = w.camera.pickEllipsoid(new Cartesian2(w.scene.canvas.clientWidth / 2, w.scene.canvas.clientHeight / 2), w.scene.globe.ellipsoid);
        if (!position) return null;
        const center = Cartographic.fromCartesian(position);
        return { lat: CMath.toDegrees(center.latitude), lon: CMath.toDegrees(center.longitude) };
      },
      setCamera: (cam, animate = true) => {
        void cameraRestoreRef.current?.restore(cam, { mode: propsRef.current.sceneMode, animate });
      },
      restoreCamera: (cam, options) => cameraRestoreRef.current?.restore(cam, { ...options, mode: options?.mode ?? propsRef.current.sceneMode }) ?? Promise.resolve(false),
      setView: (lat, lon, heightM, pitchDeg = -90) => {
        void cameraRestoreRef.current?.restore({ lat, lon, heightM, heading: 0, pitch: CMath.toRadians(pitchDeg) }, { mode: propsRef.current.sceneMode, animate: false });
      },
      setWaterEffect: (enabled) => {
        const w = widgetRef.current;
        if (!w) return;
        w.scene.globe.showWaterEffect = enabled;
        w.scene.requestRender();
      },
      flyHome: () => fly(Cartesian3.fromDegrees(VIEWS.us.lon, VIEWS.us.lat, VIEWS.us.height)),
      flyRegion: (r) => {
        if (r === 'us') fly(Cartesian3.fromDegrees(VIEWS.us.lon, VIEWS.us.lat, VIEWS.us.height));
        else if (r === 'alaska') fly(Cartesian3.fromDegrees(VIEWS.alaska.lon, VIEWS.alaska.lat, VIEWS.alaska.height));
        else fly(RECTS[r]);
      },
      northUp: () => {
        const w = widgetRef.current;
        if (!w) return;
        cameraRestoreRef.current?.cancel();
        const c = w.camera;
        c.setView({ destination: c.positionWC.clone(), orientation: { heading: 0, pitch: c.pitch, roll: 0 } });
        w.scene.requestRender();
      },
      tilt: () => {
        const w = widgetRef.current;
        if (!w || w.scene.mode !== SceneMode.SCENE3D) return null;
        const c = w.camera;
        const target = c.pickEllipsoid(new Cartesian2(w.scene.canvas.clientWidth / 2, w.scene.canvas.clientHeight / 2), w.scene.globe.ellipsoid);
        if (!target) return null;
        cameraRestoreRef.current?.cancel();
        const pitch = nextTiltPitch(c.pitch);
        const range = Cartesian3.distance(c.positionWC, target);
        c.lookAt(target, new HeadingPitchRange(c.heading, pitch, range));
        // Release the look-at frame so the mouse controls keep working as before.
        c.lookAtTransform(Matrix4.IDENTITY);
        w.scene.requestRender();
        return pitch;
      },
      focus: (lat, lon, radiusKm, minimumHeightM) => {
        let height = Math.max(minimumHeightM ?? 120_000, (radiusKm ?? 50) * 1000 * 5);
        if (minimumHeightM !== undefined && propsRef.current.settings.terrainEnabled) {
          const ground = widgetRef.current?.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
          height = ground !== undefined && Number.isFinite(ground) ? height + Math.max(0, ground) : Math.max(height, 10_000);
        }
        fly(Cartesian3.fromDegrees(lon, lat, height));
      },
      zoom: (dir) => {
        const w = widgetRef.current;
        if (!w) return;
        cameraRestoreRef.current?.cancel();
        const h = w.camera.positionCartographic.height;
        if (dir > 0) w.camera.zoomIn(h * 0.35);
        else w.camera.zoomOut(h * 0.5);
        w.scene.requestRender();
      },
      flyAlong: (points, mode, onEnd) => {
        const w = widgetRef.current;
        flyAlongStopRef.current?.('replaced');
        if (!w || points.length < 2) { onEnd?.('replaced'); return; }
        cameraRestoreRef.current?.cancel();
        if (passengerFollowRef.current && w.trackedEntity) {
          passengerFollowRef.current.dispose();
          passengerFollowRef.current = null;
        }
        // Cumulative metres along the line.
        const cum = [0];
        for (let i = 1; i < points.length; i++) {
          const [lo0, la0] = points[i - 1];
          const [lo1, la1] = points[i];
          cum.push(cum[i - 1] + Math.hypot((lo1 - lo0) * 111_320 * Math.cos((la0 * Math.PI) / 180), (la1 - la0) * 111_320));
        }
        const total = cum.at(-1)!;
        if (reducedRef.current || total < 1) {
          // Reduced motion: one still overview of the whole route instead of a moving camera.
          const lons = points.map((p) => p[0]);
          const lats = points.map((p) => p[1]);
          const pad = 0.002;
          w.camera.setView({ destination: Rectangle.fromDegrees(Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad) });
          w.scene.requestRender();
          onEnd?.('done');
          return;
        }
        const at = (s: number): [number, number] => {
          const d = Math.max(0, Math.min(total, s));
          let i = 1;
          while (i < cum.length - 1 && cum[i] < d) i++;
          const seg = cum[i] - cum[i - 1] || 1;
          const t = (d - cum[i - 1]) / seg;
          return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
        };
        const ground = (lon: number, lat: number, fallback: number) => w.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? fallback;
        // A drone-like view: behind and above the point, looking ahead along the route.
        const above = mode === 'drive' ? 140 : 70;
        const back = mode === 'drive' ? 220 : 110;
        const ahead = mode === 'drive' ? 160 : 80;
        // Ground speed of the view; long routes are sped up so a flight takes at most about 90 s.
        const speed = Math.max(mode === 'drive' ? 40 : 15, total / 90);
        const start = performance.now();
        let heading: number | null = null;
        let groundH = ground(points[0][0], points[0][1], 0);
        let frame = 0;
        const stop = (why: 'done' | 'cancelled' | 'replaced') => {
          cancelAnimationFrame(frame);
          w.canvas.removeEventListener('pointerdown', onInput);
          w.canvas.removeEventListener('wheel', onInput);
          window.removeEventListener('keydown', onKey);
          if (flyAlongStopRef.current === stop) flyAlongStopRef.current = null;
          onEnd?.(why);
        };
        const onInput = () => stop('cancelled');
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stop('cancelled'); };
        const step = () => {
          if (w.isDestroyed()) return;
          const s = ((performance.now() - start) / 1000) * speed;
          const [lon, lat] = at(s);
          const [alon, alat] = at(s + ahead);
          const r = Math.PI / 180;
          const target = Math.atan2(Math.sin((alon - lon) * r) * Math.cos(alat * r), Math.cos(lat * r) * Math.sin(alat * r) - Math.sin(lat * r) * Math.cos(alat * r) * Math.cos((alon - lon) * r));
          // Ease the heading so junction kinks do not jerk the view.
          heading = heading === null ? target : heading + Math.atan2(Math.sin(target - heading), Math.cos(target - heading)) * 0.08;
          groundH = groundH + (ground(lon, lat, groundH) - groundH) * 0.1;
          const dLat = (-back * Math.cos(heading)) / 111_320;
          const dLon = (-back * Math.sin(heading)) / (111_320 * Math.cos(lat * r));
          w.camera.setView({ destination: Cartesian3.fromDegrees(lon + dLon, lat + dLat, groundH + above), orientation: { heading, pitch: CMath.toRadians(-28), roll: 0 } });
          w.scene.requestRender();
          if (s >= total) { stop('done'); return; }
          frame = requestAnimationFrame(step);
        };
        flyAlongStopRef.current = stop;
        w.canvas.addEventListener('pointerdown', onInput);
        w.canvas.addEventListener('wheel', onInput, { passive: true });
        window.addEventListener('keydown', onKey);
        frame = requestAnimationFrame(step);
      },
      stopFlyAlong: () => flyAlongStopRef.current?.('cancelled'),
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    const w = widgetRef.current;
    if (!w) return;
    const h = w.camera.positionCartographic.height;
    const step = Math.min(0.2, Math.max(0.002, h / 6.4e7));
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        w.camera.rotateRight(step);
        break;
      case 'ArrowRight':
        w.camera.rotateLeft(step);
        break;
      case 'ArrowUp':
        w.camera.rotateDown(step);
        break;
      case 'ArrowDown':
        w.camera.rotateUp(step);
        break;
      case '+':
      case '=':
        w.camera.zoomIn(h * 0.35);
        break;
      case '-':
      case '_':
        w.camera.zoomOut(h * 0.5);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      w.scene.requestRender();
    }
  }

  return (
    <div className="globe-wrap">
      <div
        ref={containerRef}
        className="globe"
        tabIndex={0}
        role="application"
        aria-label="Interactive globe. Use arrow keys to rotate and plus or minus to zoom. Click markers for details."
        onKeyDown={onKeyDown}
      />
      <CameraCards widget={ready ? widgetRef.current : null} records={props.layerSnaps.cameras?.records ?? []}
        enabled={ready && props.layersOn.includes('cameras') && !props.playbackActive}
        onOpen={(id) => props.onSelect({ kind: 'record', layer: 'cameras', id })} />
      {failed && (
        <div className="globe-failed" role="alert">
          <strong>The 3D globe could not start.</strong>
          <p>WebGL may be unavailable on this computer ({failed}). Lists, monitoring, history, and briefings still work.</p>
        </div>
      )}
      {im?.compare && im.product && (
        <div
          className="split-handle"
          style={{ left: `${(im.split ?? 0.5) * 100}%` }}
          role="slider"
          aria-label="Comparison divider: left shows the first date, right the second"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((im.split ?? 0.5) * 100)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') props.onImagerySplit?.(Math.max(0.02, (im.split ?? 0.5) - 0.05));
            if (e.key === 'ArrowRight') props.onImagerySplit?.(Math.min(0.98, (im.split ?? 0.5) + 0.05));
          }}
          onPointerDown={(e) => {
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            const move = (ev: PointerEvent) => props.onImagerySplit?.(Math.min(0.98, Math.max(0.02, (ev.clientX - box.left) / box.width)));
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <span className="split-tag left">{im.date}</span>
          <span className="split-grip" aria-hidden="true">⇔</span>
          <span className="split-tag right">{im.compareDate}</span>
        </div>
      )}
      <div ref={creditRef} className="cesium-credits" aria-hidden="true" />
    </div>
  );
});
