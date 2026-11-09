import '../lib/cesiumBase';
import {
  Cartesian2,
  Cartesian3,
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
  Material,
  Math as CMath,
  NearFarScalar,
  PolygonHierarchy,
  PolylineCollection,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  WebMapServiceImageryProvider,
  PolylineDashMaterialProperty,
  WebMercatorTilingScheme,
  createGooglePhotorealistic3DTileset,
  GoogleMaps,
  type Cesium3DTileset,
  type PostProcessStage,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { MultiLineString, Position } from 'geojson';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countriesTopo from 'world-atlas/countries-50m.json';
import statesTopo from 'us-atlas/states-10m.json';
import type { Earthquake, SavedLocation, Settings, WeatherAlert } from '../../shared/types';
import { quakeClass, SEVERITY_META, prefersReducedMotion } from '../lib/format';
import { BASEMAPS, isBasemapId, labelsOverlayLayer, needsContextFills, oceanVeilLayer, isCustomerImagery, previousUtcDay, US_RECTS } from '../map/basemaps';
import { BuildingManager, BUILDINGS_MAX_CAMERA_M, type BuildingStats } from '../map/buildings';
import { usgsStats } from '../map/usgsProvider';
import { vectorStats, type VectorStats } from '../map/vectorTiles';
import { createTerrariumTerrain, TERRAIN_INFO, type TerrainStats } from '../map/terrain';
import { LayerRenderer } from '../map/layerRender';
import type { AircraftFilter } from '../../shared/aircraft';
import airportsData from '../data/airports.json';
import { applyVisualMode } from '../map/visualModes';
import type { LayerId, LayerSnapshot, ViewState } from '../../shared/layers';
import type { Annotation } from '../lib/api';

export type GlobeSelection = { kind: 'location' | 'alert' | 'quake' | 'airport'; id: string } | { kind: 'record'; layer: LayerId; id: string };

export type ToolMode = 'none' | 'measure-line' | 'measure-area' | 'draw-pin' | 'draw-line' | 'draw-area';

export interface PlaybackFrame {
  t: string;
  points: { layer: LayerId; rid: string; lat: number; lon: number; altM: number | null; heading: number | null }[];
}

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
  buildings: BuildingStats & { enabled: boolean; maxCameraM: number };
  missingRequirement: string | null;
}

export interface GlobeHandle {
  getDiagnostics(): GlobeDiagnostics | null;
  setView(lat: number, lon: number, heightM: number, pitchDeg?: number): void;
  getCamera(): { lat: number; lon: number; heightM: number; heading: number; pitch: number } | null;
  setCamera(c: { lat: number; lon: number; heightM: number; heading: number; pitch: number }, animate?: boolean): void;
  flyHome(): void;
  flyRegion(region: 'us' | 'lower48' | 'alaska' | 'hawaii'): void;
  northUp(): void;
  focus(lat: number, lon: number, radiusKm?: number): void;
  zoom(direction: 1 | -1): void;
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
  onReady(ok: boolean, error?: string): void;
  layerSnaps: Partial<Record<LayerId, LayerSnapshot>>;
  layersOn: LayerId[];
  trail: { lat: number; lon: number; altM: number | null }[] | null;
  trailAirborne: boolean;
  trackedRecord: { layer: LayerId; id: string } | null;
  showOrbitFor: string | null;
  onViewChange(v: ViewState): void;
  tool: ToolMode;
  draftPoints: [number, number][];
  onToolPoint(lon: number, lat: number): void;
  onToolFinish(): void;
  annotations: Annotation[];
  playback: PlaybackFrame | null;
  google3dKey: string | null;
  imageryKeys: { esri: string | null; mapbox: string | null; google: string | null };
  /** Shown to the user when a customer-credential provider (Google) refuses requests. */
  onProviderError?: (message: string) => void;
  eoxLicensed: boolean;
  aircraftFilter: AircraftFilter;
  vesselClasses: string[];
  showAirports: boolean;
  sceneMode: '3d' | '2d';
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

function linesOf(g: MultiLineString): Position[][] {
  return g.coordinates;
}

function addMesh(collection: PolylineCollection, g: MultiLineString, color: Color, width: number) {
  for (const line of linesOf(g)) {
    if (line.length < 2) continue;
    const flat: number[] = [];
    for (const [lon, lat] of line) flat.push(lon, lat);
    // Hidden below ~40 km altitude so outlines do not draw across detailed imagery.
    collection.add({ positions: Cartesian3.fromDegreesArray(flat), width, material: Material.fromType('Color', { color }), distanceDisplayCondition: new DistanceDisplayCondition(40_000, Number.MAX_VALUE) });
  }
}

function parseEntityId(id: string): GlobeSelection | null {
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

/** Plain-language reason when Google refuses a Map Tiles request (status codes only; the key is never shown). */
function googleRefusal(what: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = /(400|401|403|429)/.exec(msg)?.[1];
  const why =
    code === '400' || code === '403'
      ? 'Google refused the key. Check that Map Tiles API is enabled for it, billing is attached, and the key restrictions allow Map Tiles API.'
      : code === '429'
        ? 'Google quota reached for today (your quota cap).'
        : 'Google did not respond.';
  return `Google ${what} unavailable: ${why} Showing keyless imagery.`;
}

export const Globe = forwardRef<GlobeHandle, Props>(function Globe(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const creditRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<CesiumWidget | null>(null);
  const sourcesRef = useRef<{ alerts: CustomDataSource; quakes: CustomDataSource; locations: CustomDataSource; radii: CustomDataSource } | null>(null);
  const boundariesRef = useRef<PolylineCollection[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [failed, setFailed] = useState<string | null>(null);
  const basemapLayersRef = useRef<ImageryLayer[]>([]);
  const imageryErrorsRef = useRef<{ count: number; last: string | null }>({ count: 0, last: null });
  const terrainStatsRef = useRef<TerrainStats | null>(null);
  const tilesPendingRef = useRef(0);
  const layerRendererRef = useRef<LayerRenderer | null>(null);
  const radarLayerRef = useRef<ImageryLayer | null>(null);
  const postStageRef = useRef<PostProcessStage | null>(null);
  const annoSourceRef = useRef<CustomDataSource | null>(null);
  const playbackSourceRef = useRef<CustomDataSource | null>(null);
  const tilesetRef = useRef<Cesium3DTileset | null>(null);
  const [photorealOn, setPhotorealOn] = useState(false);
  const buildingsRef = useRef<BuildingManager | null>(null);
  const [ready, setReady] = useState(false);

  const reduced = prefersReducedMotion(props.settings.reducedMotion);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  // ----- init -----
  useEffect(() => {
    if (!containerRef.current) return;
    let widget: CesiumWidget;
    try {
      widget = new CesiumWidget(containerRef.current, {
        baseLayer: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        skyBox: false,
        skyAtmosphere: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        creditContainer: creditRef.current ?? undefined,
        shouldAnimate: false,
        showRenderLoopErrors: false,
      });
    } catch (e) {
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
    // Lighting is "on" only so Cesium's water shader drops its fixed cyan wave highlight (it scales by
    // 1 − lightingFade). Fade distances of 1–2 m make the lighting fully applied at every distance; with the
    // camera-relative light from above (see buildings.ts) land imagery keeps its brightness.
    scene.globe.enableLighting = true;
    scene.globe.dynamicAtmosphereLighting = false;
    scene.globe.lightingFadeOutDistance = 1;
    scene.globe.lightingFadeInDistance = 2;
    scene.globe.showWaterEffect = true;
    scene.fog.enabled = false;
    scene.globe.depthTestAgainstTerrain = false;
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
    const countries = new PolylineCollection();
    const states = new PolylineCollection();
    try {
      const ct = countriesTopo as unknown as Topology<{ countries: GeometryCollection }>;
      addMesh(countries, mesh(ct, ct.objects.countries) as MultiLineString, COUNTRY_LINE, 1);
      const st = statesTopo as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
      addMesh(states, mesh(st, st.objects.states, (a, b) => a !== b) as MultiLineString, STATE_LINE, 1.2);
      // Coastline / national outline for the U.S. comes from the nation object.
      addMesh(states, mesh(st, st.objects.nation) as MultiLineString, STATE_LINE, 1.2);
    } catch (e) {
      console.warn('Boundary load failed', e);
    }
    scene.primitives.add(countries);
    scene.primitives.add(states);
    boundariesRef.current = [countries, states];

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
    buildingsRef.current = new BuildingManager(widget);
    annoSourceRef.current = new CustomDataSource('annotations');
    playbackSourceRef.current = new CustomDataSource('playback');
    void widget.dataSources.add(annoSourceRef.current);
    void widget.dataSources.add(playbackSourceRef.current);
    widget.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    widget.camera.setView({ destination: Cartesian3.fromDegrees(VIEWS.us.lon, VIEWS.us.lat, VIEWS.us.height) });

    const handler = new ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const p = propsRef.current;
      const pickLonLat = (): [number, number] | null => {
        const ray = widget.camera.getPickRay(movement.position);
        const cart = (ray && scene.globe.pick(ray, scene)) || widget.camera.pickEllipsoid(movement.position, scene.globe.ellipsoid);
        if (!cart) return null;
        const c = Cartographic.fromCartesian(cart);
        return [Number(CMath.toDegrees(c.longitude).toFixed(6)), Number(CMath.toDegrees(c.latitude).toFixed(6))];
      };
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
      if (defined(picked) && picked.id instanceof Entity) {
        const sel = parseEntityId(String(picked.id.id));
        p.onSelect(sel);
      } else {
        p.onSelect(null);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => {
      if (propsRef.current.tool !== 'none') propsRef.current.onToolFinish();
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Report the settled view (center, altitude, bounding box) for viewport-based layers.
    const reportView = () => {
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
    };
    widget.camera.moveEnd.addEventListener(reportView);
    setTimeout(reportView, 500);
    setReady(true);

    const ro = new ResizeObserver(() => {
      widget.resize();
      scene.requestRender();
    });
    ro.observe(containerRef.current);
    propsRef.current.onReady(true);

    return () => {
      ro.disconnect();
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
    const def = BASEMAPS[isBasemapId(props.settings.basemap) ? props.settings.basemap : 'atlas'];
    const date = previousUtcDay();
    const layers = def.build({ date, keys: props.imageryKeys, eoxLicensed: props.eoxLicensed });
    // Worldwide place names, roads and boundaries over imagery (OpenStreetMap via OpenFreeMap).
    if (props.settings.evenOcean && isCustomerImagery(def.id, props.imageryKeys, props.eoxLicensed)) layers.push(oceanVeilLayer());
    if (props.settings.labelsOverlay && def.id !== 'streets' && def.id !== 'neutral') layers.push(labelsOverlayLayer(needsContextFills(def.id, props.imageryKeys, props.eoxLicensed)));
    imageryErrorsRef.current = { count: 0, last: null };
    if (def.id === 'google2d' && props.imageryKeys.google)
      for (const l of layers) l.errorEvent.addEventListener((e: unknown) => propsRef.current.onProviderError?.(googleRefusal('Satellite', e)));
    layers.forEach((layer, i) => {
      w.imageryLayers.add(layer, i);
      const hook = (p: { errorEvent: { addEventListener(cb: (e: { error?: unknown; level?: number }) => void): void } }) =>
        p.errorEvent.addEventListener((e) => {
          imageryErrorsRef.current.count++;
          imageryErrorsRef.current.last = `level ${e.level ?? '?'}: ${e.error instanceof Error ? e.error.message : 'tile request failed'}`;
        });
      if (layer.ready) hook(layer.imageryProvider as never);
      else layer.readyEvent.addEventListener((prov) => hook(prov as never));
    });
    basemapLayersRef.current = layers;
    w.scene.requestRender();
  }, [props.settings.basemap, props.settings.labelsOverlay, props.settings.evenOcean, props.imageryKeys.esri, props.imageryKeys.mapbox, props.imageryKeys.google, props.eoxLicensed, failed]);

  // ----- 3D buildings (OSM extrusions) -----
  useEffect(() => {
    // OSM block buildings are hidden only while Google's photoreal city is actually on screen.
    buildingsRef.current?.setEnabled(props.settings.buildings3d && !photorealOn);
  }, [props.settings.buildings3d, photorealOn, ready]);
  useEffect(() => {
    buildingsRef.current?.setFacades(props.settings.buildingFacades);
  }, [props.settings.buildingFacades, ready]);

  // ----- terrain -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    if (props.settings.terrainEnabled) {
      const t = createTerrariumTerrain();
      terrainStatsRef.current = t.stats;
      w.terrainProvider = t.provider;
    } else {
      terrainStatsRef.current = null;
      w.terrainProvider = new EllipsoidTerrainProvider();
    }
    w.scene.requestRender();
  }, [props.settings.terrainEnabled, failed]);

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
    const live = props.playback === null;
    for (const [lid, snap] of Object.entries(props.layerSnaps) as [LayerId, LayerSnapshot][]) {
      const on = live && props.layersOn.includes(lid);
      if (on)
        lr.update(lid, snap.records, {
          selectedId: selRecord?.layer === lid ? selRecord.id : null,
          selectedLayer: selRecord?.layer ?? null,
          trackedId: props.trackedRecord?.id ?? null,
          aircraftFilter: props.aircraftFilter,
          vesselClasses: props.vesselClasses,
          smoothMotion: props.settings.smoothMotion,
        });
      lr.setVisible(lid, on);
    }
  }, [props.layerSnaps, props.layersOn, selRecord?.layer, selRecord?.id, props.playback === null, ready, props.aircraftFilter, props.vesselClasses, props.settings.smoothMotion]);

  // ----- airports (bundled OurAirports, public domain) -----
  const airportSourceRef = useRef<CustomDataSource | null>(null);
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (!airportSourceRef.current) {
      const src = new CustomDataSource('airports');
      const list = (airportsData as unknown as { airports: [string, string, string, number, number, number | null, string, string, 'L' | 'M'][] }).airports;
      for (const [icao, iata, name, la, lo, , , , size] of list) {
        const far = size === 'L' ? 1.5e6 : 4e5;
        src.entities.add({
          id: 'apt|' + icao,
          position: Cartesian3.fromDegrees(lo, la),
          point: { pixelSize: size === 'L' ? 7 : 5, color: Color.fromCssColorString('#cfd8e3'), outlineColor: Color.fromCssColorString('#0a1017'), outlineWidth: 2, distanceDisplayCondition: new DistanceDisplayCondition(0, far) },
          label: { text: iata || icao, font: '600 11px "Segoe UI", sans-serif', fillColor: Color.fromCssColorString('#cfd8e3'), outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(10, 0), horizontalOrigin: 1 as never, distanceDisplayCondition: new DistanceDisplayCondition(0, far * 0.6) },
          description: name,
        });
      }
      void w.dataSources.add(src);
      airportSourceRef.current = src;
    }
    airportSourceRef.current.show = props.showAirports;
    w.scene.requestRender();
  }, [props.showAirports, ready]);

  // ----- map mode (3D globe or 2D map) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    if (props.sceneMode === '2d') w.scene.morphTo2D(reducedRef.current ? 0 : 1);
    else w.scene.morphTo3D(reducedRef.current ? 0 : 1);
  }, [props.sceneMode, ready]);

  useEffect(() => {
    layerRendererRef.current?.showOrbit(props.showOrbitFor);
  }, [props.showOrbitFor, props.layerSnaps.satellites]);

  useEffect(() => {
    layerRendererRef.current?.showTrail(props.trail, props.trailAirborne);
  }, [props.trail, props.trailAirborne]);

  // ----- camera follow (tracking) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    const t = props.trackedRecord;
    const ent = t ? layerRendererRef.current?.entityFor(t.layer, t.id) : undefined;
    w.trackedEntity = ent ?? undefined;
    w.scene.requestRender();
  }, [props.trackedRecord?.layer, props.trackedRecord?.id, props.layerSnaps]);

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
    if (radarLayerRef.current) {
      w.imageryLayers.remove(radarLayerRef.current, true);
      radarLayerRef.current = null;
    }
    if (props.settings.radarEnabled) {
      const layer = new ImageryLayer(
        new WebMapServiceImageryProvider({
          url: 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows',
          layers: 'base_reflectivity_mosaic',
          parameters: { transparent: true, format: 'image/png', _refresh: String(radarTick) },
          tilingScheme: new WebMercatorTilingScheme(),
          maximumLevel: 10,
          credit: 'Radar: NOAA nowCOAST (observed base reflectivity mosaic)',
        }),
        { alpha: 0.65 },
      );
      w.imageryLayers.add(layer);
      radarLayerRef.current = layer;
    }
    w.scene.requestRender();
  }, [props.settings.radarEnabled, radarTick, props.settings.basemap, ready]);

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
          position: Cartesian3.fromDegrees(p.lon, p.lat, p.layer.startsWith('aircraft') ? Math.max(0, p.altM ?? 0) : 0),
          point: { pixelSize: 7, color: Color.TRANSPARENT, outlineColor: Color.fromCssColorString(p.layer === 'vessels' ? '#7fc48d' : p.layer === 'transit' ? '#f2d24a' : '#e9f3fb'), outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    }
    w.scene.requestRender();
  }, [props.playback]);

  // ----- optional Google Photorealistic 3D Tiles (customer key, metered) -----
  useEffect(() => {
    const w = widgetRef.current;
    if (!w || !ready) return;
    let cancelled = false;
    if (tilesetRef.current) {
      w.scene.primitives.remove(tilesetRef.current);
      tilesetRef.current = null;
    }
    w.scene.globe.show = true;
    setPhotorealOn(false);
    if (props.google3dKey) {
      GoogleMaps.defaultApiKey = props.google3dKey;
      void createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true })
        .then((ts) => {
          if (cancelled) return;
          // The root can load while individual tiles are refused (quota, restrictions). If tiles keep
          // failing before any loads, go back to the normal globe instead of showing an empty scene.
          let loaded = 0;
          let failed = 0;
          ts.tileLoad.addEventListener(() => loaded++);
          ts.tileFailed.addEventListener((e: { message?: string }) => {
            failed++;
            imageryErrorsRef.current.last = 'Google 3D Tiles: ' + (e?.message ?? 'tile failed');
            imageryErrorsRef.current.count++;
            if (loaded === 0 && failed === 3 && tilesetRef.current === ts) {
              w.scene.primitives.remove(ts);
              tilesetRef.current = null;
              w.scene.globe.show = true;
              setPhotorealOn(false);
              propsRef.current.onProviderError?.(googleRefusal('Photoreal 3D', new Error(e?.message ?? '')));
              w.scene.requestRender();
            }
          });
          tilesetRef.current = w.scene.primitives.add(ts);
          w.scene.globe.show = false;
          setPhotorealOn(true);
          w.scene.requestRender();
        })
        .catch((e) => {
          imageryErrorsRef.current.last = 'Google 3D Tiles: ' + (e instanceof Error ? e.message : String(e));
          imageryErrorsRef.current.count++;
          propsRef.current.onProviderError?.(googleRefusal('Photoreal 3D', e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [props.google3dKey, ready]);

  // ----- pick-mode cursor -----
  useEffect(() => {
    const c = widgetRef.current?.canvas;
    if (c) c.style.cursor = props.pickMode || props.tool !== 'none' ? 'crosshair' : '';
  }, [props.pickMode, props.tool]);

  useImperativeHandle(ref, () => {
    const fly = (destination: Cartesian3 | Rectangle) => {
      const w = widgetRef.current;
      if (!w) return;
      const orientation = { heading: 0, pitch: -CMath.PI_OVER_TWO, roll: 0 };
      if (reducedRef.current) w.camera.setView({ destination, orientation });
      else w.camera.flyTo({ destination, orientation, duration: 1.2 });
      w.scene.requestRender();
    };
    return {
      getDiagnostics: () => {
        const w = widgetRef.current;
        if (!w) return null;
        const c = w.camera.positionCartographic;
        const lat = CMath.toDegrees(c.latitude);
        const lon = CMath.toDegrees(c.longitude);
        // Private Cesium field, read-only: levels of tiles drawn this frame (diagnostic only).
        const tiles = (w.scene.globe as unknown as { _surface?: { _tilesToRender?: { level: number }[] } })._surface?._tilesToRender ?? [];
        const maxRenderedLevel = tiles.length ? Math.max(...tiles.map((t) => t.level)) : null;
        const def = BASEMAPS[isBasemapId(propsRef.current.settings.basemap) ? propsRef.current.settings.basemap : 'atlas'];
        const inUs = Object.values(US_RECTS).some((r) => Rectangle.contains(r, Cartographic.fromDegrees(lon, lat)));
        const here = def.sources.filter((s) => s.coverage === 'Global' || s.coverage.startsWith('Global') || inUs);
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
          imageryLayerCount: widgetRef.current?.imageryLayers.length ?? null,
          photorealLoaded: !!tilesetRef.current,
          lastImageryError: imageryErrorsRef.current.last,
          basemapSources: def.sources,
          terrain: ts ? { ...TERRAIN_INFO, ...ts } : null,
          vector: { ...vectorStats, overlayOn: propsRef.current.settings.labelsOverlay || def.id === 'streets' },
          usgs: { ...usgsStats },
          buildings: { ...(buildingsRef.current?.stats ?? { tilesLoaded: 0, buildingsDrawn: 0, lastError: null, visible: false }), enabled: propsRef.current.settings.buildings3d, maxCameraM: BUILDINGS_MAX_CAMERA_M },
          missingRequirement:
            def.requires === 'esri' && !propsRef.current.imageryKeys.esri
              ? 'Esri World Imagery needs your ArcGIS key (Providers). Showing keyless imagery.'
              : def.requires === 'mapbox' && !propsRef.current.imageryKeys.mapbox
                ? 'Mapbox Satellite needs your token (Providers). Showing keyless imagery.'
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
        if (!w) return null;
        const c = w.camera.positionCartographic;
        return { lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude), heightM: c.height, heading: w.camera.heading, pitch: w.camera.pitch };
      },
      setCamera: (cam, animate = true) => {
        const w = widgetRef.current;
        if (!w) return;
        const destination = Cartesian3.fromDegrees(cam.lon, cam.lat, cam.heightM);
        const orientation = { heading: cam.heading, pitch: cam.pitch, roll: 0 };
        if (!animate || reducedRef.current) w.camera.setView({ destination, orientation });
        else w.camera.flyTo({ destination, orientation, duration: 1.2 });
        w.scene.requestRender();
      },
      setView: (lat, lon, heightM, pitchDeg = -90) => {
        const w = widgetRef.current;
        if (!w) return;
        w.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, heightM), orientation: { heading: 0, pitch: CMath.toRadians(pitchDeg), roll: 0 } });
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
        const c = w.camera;
        c.setView({ destination: c.positionWC.clone(), orientation: { heading: 0, pitch: c.pitch, roll: 0 } });
        w.scene.requestRender();
      },
      focus: (lat, lon, radiusKm) => fly(Cartesian3.fromDegrees(lon, lat, Math.max(120_000, (radiusKm ?? 50) * 1000 * 5))),
      zoom: (dir) => {
        const w = widgetRef.current;
        if (!w) return;
        const h = w.camera.positionCartographic.height;
        if (dir > 0) w.camera.zoomIn(h * 0.35);
        else w.camera.zoomOut(h * 0.5);
        w.scene.requestRender();
      },
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
      {failed && (
        <div className="globe-failed" role="alert">
          <strong>The 3D globe could not start.</strong>
          <p>WebGL may be unavailable on this computer ({failed}). Lists, monitoring, history, and briefings still work.</p>
        </div>
      )}
      <div ref={creditRef} className="cesium-credits" aria-hidden="true" />
    </div>
  );
});
