// Draws data layers on the globe with diff updates (existing entities are
// moved, not recreated), clustering for dense point layers, and SGP4
// propagation for satellites (calculated positions, labeled as such).

import {
  BillboardCollection,
  type Billboard,
  BoundingSphere,
  Intersect,
  Ellipsoid,
  EllipsoidalOccluder,
  SceneMode,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
  DistanceDisplayCondition,
  Entity,
  HorizontalOrigin,
  JulianDate,
  LabelStyle,
  Math as CMath,
  NearFarScalar,
  PolygonHierarchy,
  VerticalOrigin,
  sampleTerrain,
  type CesiumWidget,
} from 'cesium';
import { classifyAircraft, classifyVessel } from '../../shared/vehicleClass';
import { aircraftSymbol, vesselSymbol } from './symbols';
import { eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import type { GeoRecord, LayerId } from '../../shared/layers';
import { altitudeColor, drawnPosition, passesFilter, specialCode, trackState, type AircraftFilter } from '../../shared/aircraft';
import { CLASS_DEFAULTS, VESSEL_DEFAULTS, aircraftShape, aircraftVariant, pitchFromRates, vesselShape } from '../../shared/vehicleDims';
import { buildAircraft, buildVessel } from './vehicleMeshes';
import { VehicleModelLayer, type ModelCandidate } from './vehicleModels';
import { currentModelPack, loadModelPack, packModelUrl } from './modelPack';
import { packForAircraft, packForVessel, packScale } from '../../shared/modelPack';
import { geoidHeight, loadGeoid } from './geoid';
import { createTerrariumTerrain } from './terrain';
import { horizonPoint } from './horizon';
import { trailPointHeight, type TrailKind, type TrailPoint } from './trailHeights';
import { GROUND_BACKOFF_MS, markGroundRetriesWoken, nextGroundRetryDelay, terrainCoversLatitude, type GroundFailure } from './groundRetry';

/** Terrain detail level sampled for parked aircraft on Google 3D tiles (~40 m resolution). */
const GROUND_SAMPLE_LEVEL = 13;

// ---------- glyphs (generated once, data URLs) ----------
const glyphCache = new Map<string, string>();
function glyph(kind: 'plane' | 'ship' | 'camera' | 'storm' | 'sat', fill: string, size = 32): string {
  const key = `${kind}|${fill}|${size}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 1.6;
  const s = size / 32;
  g.beginPath();
  if (kind === 'plane') {
    // Pointing north (up); rotated by heading.
    g.moveTo(0, -13 * s);
    g.lineTo(3 * s, -3 * s);
    g.lineTo(13 * s, 3 * s);
    g.lineTo(13 * s, 6 * s);
    g.lineTo(3 * s, 3 * s);
    g.lineTo(2 * s, 10 * s);
    g.lineTo(6 * s, 13 * s);
    g.lineTo(-6 * s, 13 * s);
    g.lineTo(-2 * s, 10 * s);
    g.lineTo(-3 * s, 3 * s);
    g.lineTo(-13 * s, 6 * s);
    g.lineTo(-13 * s, 3 * s);
    g.lineTo(-3 * s, -3 * s);
    g.closePath();
  } else if (kind === 'ship') {
    g.moveTo(0, -12 * s);
    g.lineTo(5 * s, 0);
    g.lineTo(5 * s, 11 * s);
    g.lineTo(-5 * s, 11 * s);
    g.lineTo(-5 * s, 0);
    g.closePath();
  } else if (kind === 'camera') {
    g.rect(-8 * s, -5 * s, 12 * s, 10 * s);
    g.moveTo(4 * s, -2 * s);
    g.lineTo(9 * s, -5 * s);
    g.lineTo(9 * s, 5 * s);
    g.lineTo(4 * s, 2 * s);
  } else if (kind === 'storm') {
    g.arc(0, 0, 6 * s, 0, Math.PI * 2);
    g.moveTo(6 * s, 0);
    g.quadraticCurveTo(12 * s, -10 * s, 0, -13 * s);
    g.moveTo(-6 * s, 0);
    g.quadraticCurveTo(-12 * s, 10 * s, 0, 13 * s);
  } else {
    g.rect(-3 * s, -3 * s, 6 * s, 6 * s);
    g.rect(-12 * s, -2 * s, 7 * s, 4 * s);
    g.rect(5 * s, -2 * s, 7 * s, 4 * s);
  }
  g.fill();
  g.stroke();
  const url = c.toDataURL();
  glyphCache.set(key, url);
  return url;
}

const C = (css: string) => Color.fromCssColorString(css);

function aircraftColor(r: GeoRecord): string {
  // Color encodes reported altitude (legend: GND → FL400). Special codes are outlined separately.
  return altitudeColor(typeof r.props.altitudeFt === 'number' ? r.props.altitudeFt : null, r.props.onGround === true);
}
function vesselColor(r: GeoRecord): string {
  switch (r.category) {
    case 'Tanker':
      return '#e0715a';
    case 'Cargo':
      return '#7fc48d';
    case 'Passenger':
      return '#6fb6ff';
    case 'Fishing':
      return '#d9c04a';
    default:
      return '#c9d3de';
  }
}
const FLIGHT_CAT: Record<string, string> = { VFR: '#4fc36b', MVFR: '#4f8fe0', IFR: '#e5534b', LIFR: '#c45ad6' };
const TRANSIT: Record<string, string> = { 'Light rail': '#3fae5a', Subway: '#e0a03a', 'Commuter rail': '#a05fc4', Bus: '#f2d24a', Ferry: '#3fa9d6' };

export interface RenderOptions {
  selectedId: string | null;
  selectedLayer: LayerId | null;
  trackedId: string | null;
  aircraftFilter?: AircraftFilter;
  vesselClasses?: string[];
  smoothMotion?: boolean;
  aircraftLabels?: 'selected' | 'hovered' | 'all';
  vesselLabels?: 'selected' | 'hovered' | 'all';
  /** 3D models for the nearest aircraft and ships (Settings → Display). */
  vehicleModels?: boolean;
  /** Maximum number of 3D models at once (higher with Maximum rendering quality). */
  modelBudget?: number;
}

/** 3D models are shown only below this camera height; above it every vehicle is an icon. */
const MODEL_MAX_CAMERA_M = 400_000;
/**
 * Hysteresis so vehicles do not flip between icon and model as positions change every second: a vehicle
 * that already has a model keeps it unless another is clearly closer (its distance counts 30 % less), and
 * it may stay a little beyond the range and the screen edge before switching back to an icon.
 */
const KEEP_DISTANCE_FACTOR = 0.7;
const KEEP_RANGE_FACTOR = 1.3;
const KEEP_EDGE_RADIUS_M = 3000;

/** Above this many records a vehicle layer is drawn as one batched billboard collection. */
const BULK_THRESHOLD = 1500;

export class LayerRenderer {
  private sources = new Map<LayerId, CustomDataSource>();
  private entities = new Map<LayerId, Map<string, Entity>>();
  private satrecs = new Map<string, SatRec>();
  private satTimer: ReturnType<typeof setInterval> | null = null;
  private orbitEntity: Entity | null = null;
  private trailEntity: Entity | null = null;
  private records = new Map<LayerId, Map<string, GeoRecord>>();
  private motionTimer: ReturnType<typeof setInterval> | null = null;
  private bulk = new Map<LayerId, { coll: BillboardCollection; byId: Map<string, Billboard> }>();
  private smooth = true;

  private hovered: { layer: LayerId; id: string } | null = null;
  private sel: { layer: LayerId | null; id: string | null } = { layer: null, id: null };
  private labelModes: { aircraft: 'selected' | 'hovered' | 'all'; vessel: 'selected' | 'hovered' | 'all' } = { aircraft: 'hovered', vessel: 'hovered' };
  private lastCull = 0;
  private readonly cullCam = new Cartesian3();
  private readonly models: VehicleModelLayer;
  private modelled = new Set<string>();
  private modelOpts = { enabled: true, budget: 60 };
  private lastModelSync = 0;
  /**
   * Last reported ICAO type per aircraft key, captured from every update (before filtering or model selection),
   * so a later report without type data keeps the typed model. Bounded: least recently reported first out.
   */
  private lastType = new Map<string, string>();
  private modelSyncTimer: ReturnType<typeof setTimeout> | null = null;
  /** Models wait until the model pack has loaded (or is known to be missing), so no vehicle swaps models at start-up. */
  private packSettled = false;
  /** Set first in destroy(): late callbacks (pack loading, timers, scene events) must not touch the destroyed widget. */
  private destroyed = false;
  /**
   * Google Photorealistic 3D is showing. Its surface is at true WGS84 ellipsoid height, while the app's globe
   * has its sea at height 0; local sea level differs from 0 by up to ~100 m (about +18 m at Helsinki, −33 m at
   * New York). In this mode ships sit at local sea level (EGM96 geoid grid), parked aircraft at terrain height
   * + sea level, and reported altitudes (above sea level) are raised by it. While a vehicle's height is not
   * known yet (grid loading, terrain sample pending) it keeps its icon instead of a 3D model.
   */
  private photoreal = false;
  /** Terrain height above sea level per ~200 m cell, for parked aircraft on Google 3D tiles (sampled once). */
  private groundCache = new Map<string, number>();
  /** Cells queued or being sampled. */
  private groundPending = new Set<string>();
  private groundQueue = new Map<string, Cartographic>();
  /** Cells whose sample failed, and when (retried after a minute, never in a tight loop). */
  private groundFailed = new Map<string, GroundFailure>();
  private groundTimer: ReturnType<typeof setTimeout> | null = null;
  private groundInFlight = false;
  /** One pending re-placement after failed samples' back-off, so they are retried without waiting for another event. */
  private groundRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Terrain source for those samples: its own strict copy of the app's Terrarium terrain, independent of the Terrain
   * display setting (with terrain display off the globe uses a flat ellipsoid, which would report 0 m everywhere).
   * Strict: a missing source tile fails (height unknown → icon, retried) instead of reading as 0 m.
   */
  private groundSampler: ReturnType<typeof createTerrariumTerrain>['provider'] | null = null;
  /** Called after vehicle heights changed (see refreshSurfaceHeights), e.g. to re-place playback markers. */
  onSurfaceHeightsChanged: (() => void) | null = null;
  /** Last trail shown, redrawn when the vertical reference changes. */
  private trailArgs: { points: TrailPoint[]; kind: TrailKind } | null = null;
  private readonly cullDir = new Cartesian3();
  private readonly cullUp = new Cartesian3();

  constructor(private readonly widget: CesiumWidget) {
    // A model becoming ready (or failing) swaps its icon at once, even with a still camera and no data update.
    this.models = new VehicleModelLayer(widget, () => this.requestModelSync(0));
    // Aircraft and vessels on the far side of the earth are hidden (they used to show through the globe).
    widget.scene.preRender.addEventListener(() => {
      if (this.destroyed) return;
      const now = performance.now();
      if (now - this.lastCull < 250) return;
      const cam = widget.camera;
      // Position and orientation both matter: rotating in place changes which vehicles are in view.
      if (Cartesian3.equalsEpsilon(cam.positionWC, this.cullCam, 0, 1) && Cartesian3.equalsEpsilon(cam.directionWC, this.cullDir, 1e-4) && Cartesian3.equalsEpsilon(cam.upWC, this.cullUp, 1e-4)) return;
      this.lastCull = now;
      Cartesian3.clone(cam.positionWC, this.cullCam);
      Cartesian3.clone(cam.directionWC, this.cullDir);
      Cartesian3.clone(cam.upWC, this.cullUp);
      this.cullBehindEarth();
      this.requestModelSync(500);
    });
    widget.scene.morphComplete.addEventListener(() => this.requestModelSync(0));
    void loadModelPack().then(() => {
      if (this.destroyed) return;
      this.packSettled = true;
      this.requestModelSync(0);
    });
    void loadGeoid().then(() => {
      if (this.destroyed) return;
      this.refreshSurfaceHeights();
    });
  }

  setPhotoreal(on: boolean): void {
    if (this.photoreal === on) return;
    this.photoreal = on;
    this.refreshSurfaceHeights();
  }

  /** Re-places icons, the trail and models after the vertical reference changed (Photoreal on/off, sea-level grid or terrain heights arrived). */
  private refreshSurfaceHeights(): void {
    if (this.destroyed) return;
    const now = Date.now();
    for (const lid of ['aircraft', 'aircraftMil', 'vessels'] as LayerId[]) {
      const recs = this.records.get(lid);
      if (!recs) continue;
      const bk = this.bulk.get(lid);
      const ents = this.entities.get(lid);
      for (const [rid, r] of recs) {
        // Only the height changes: each vehicle keeps the horizontal position it is drawn at now.
        const bb = bk?.byId.get(rid);
        if (bb) {
          const p = this.shownAt(lid, r, now, true);
          bb.position = Cartesian3.fromDegrees(p.lon, p.lat, this.heightFor(lid, r, p));
        }
        const e = ents?.get(rid);
        if (e?.position instanceof ConstantPositionProperty) {
          const p = this.shownAt(lid, r, now, false);
          e.position.setValue(Cartesian3.fromDegrees(p.lon, p.lat, this.heightFor(lid, r, p)));
        }
      }
    }
    if (this.trailArgs) this.showTrail(this.trailArgs.points, this.trailArgs.kind);
    this.requestModelSync(0);
    this.widget.scene.requestRender();
    this.onSurfaceHeightsChanged?.();
  }

  /**
   * Height for a recorded observation (history playback marker), with the same vertical reference as live
   * vehicles. Ground samples are requested only near the camera (playback can cover the whole world); a marker
   * whose height is not known (no altitude in the air, ground not sampled) is drawn at sea level, as markers are
   * never hidden by the surface.
   */
  recordedHeight(layer: LayerId, p: TrailPoint): number {
    if (layer !== 'aircraft' && layer !== 'aircraftMil' && layer !== 'vessels') return 0;
    const sea = this.seaLevel(p.lat, p.lon) ?? 0;
    const near = Cartesian3.distance(Cartesian3.fromDegrees(p.lon, p.lat, 0), Cartesian3.fromRadians(this.widget.camera.positionCartographic.longitude, this.widget.camera.positionCartographic.latitude, 0)) <= 100_000;
    return trailPointHeight(p, layer === 'vessels' ? 'vessel' : 'aircraft', this.photoreal, sea, () => this.parkedGround(p.lat, p.lon, near)) ?? sea;
  }

  /** Runs syncModels now if it has not run in the last `minGapMs`, otherwise once the gap has passed (never dropped). */
  private requestModelSync(minGapMs: number): void {
    if (this.destroyed) return;
    const wait = this.lastModelSync + minGapMs - performance.now();
    if (wait <= 0) {
      if (this.modelSyncTimer) clearTimeout(this.modelSyncTimer);
      this.modelSyncTimer = null;
      this.syncModels();
      return;
    }
    if (!this.modelSyncTimer)
      this.modelSyncTimer = setTimeout(() => {
        this.modelSyncTimer = null;
        this.syncModels();
      }, wait);
  }

  /**
   * Picks the vehicles nearest the camera (in view, above the horizon, within range) for 3D models
   * and hides their icons; everything else stays an icon.
   */
  private syncModels(): void {
    if (this.destroyed) return;
    this.lastModelSync = performance.now();
    const scene = this.widget.scene;
    const cam = this.widget.camera;
    const height = cam.positionCartographic.height;
    let picked: ModelCandidate[] = [];
    if (this.packSettled && this.modelOpts.enabled && scene.mode === SceneMode.SCENE3D && height < MODEL_MAX_CAMERA_M) {
      const range = Math.min(600_000, Math.max(40_000, height * 4));
      const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, cam.positionWC);
      const volume = cam.frustum.computeCullingVolume(cam.positionWC, cam.directionWC, cam.upWC);
      // A small margin beyond the screen edge, so models load before a vehicle pans into view.
      const sphere = new BoundingSphere(new Cartesian3(), 800);
      const keepSphere = new BoundingSphere(new Cartesian3(), KEEP_EDGE_RADIUS_M);
      const now = Date.now();
      const julian = JulianDate.now();
      // The camera's ground point, for horizontal distances (see parked aircraft on Google 3D tiles below).
      const camCarto = cam.positionCartographic;
      const camFlat = Cartesian3.fromRadians(camCarto.longitude, camCarto.latitude, 0);
      const scratchFlat = new Cartesian3();
      const near: { d: number; score: number; lid: LayerId; r: GeoRecord; pos: Cartesian3 }[] = [];
      for (const lid of ['aircraft', 'aircraftMil', 'vessels'] as LayerId[]) {
        const recs = this.records.get(lid);
        if (!recs || this.sources.get(lid)?.show === false || this.bulk.get(lid)?.coll.show === false) continue;
        const ents = this.entities.get(lid);
        const bk = this.bulk.get(lid);
        for (const [rid, r] of recs) {
          if (lid !== 'vessels' && trackState(r, now) === 'expired') continue;
          let pos = bk?.byId.get(rid)?.position ?? ents?.get(rid)?.position?.getValue(julian);
          if (!pos) continue;
          if (this.photoreal) {
            // On Google 3D tiles a surface vehicle gets a model only once its true height is known (see `photoreal`);
            // visibility is then tested at that height (a parked aircraft's provisional icon height can be far off).
            if (lid === 'vessels') {
              if (this.seaLevel(r.lat, r.lon) === null) continue;
            } else if (r.props.onGround === true) {
              const ground = this.parkedGround(r.lat, r.lon);
              if (ground === null) {
                // Not sampled yet: request it when the aircraft is within model range horizontally (height ignored,
                // so an airport 2 km up is not rejected for being "off screen" at sea level).
                if (Cartesian3.distance(Cartesian3.fromDegrees(r.lon, r.lat, 0, Ellipsoid.WGS84, scratchFlat), camFlat) <= range) this.parkedGround(r.lat, r.lon, true);
                continue;
              }
              pos = Cartesian3.fromDegrees(r.lon, r.lat, ground);
            }
          } else if (lid !== 'vessels' && r.props.onGround === true) {
            // Icons of parked aircraft sit at sea level; use the loaded terrain height (airports can be 2 km up),
            // re-read on every sync so it improves as terrain tiles arrive.
            const ground = scene.globe.getHeight(Cartographic.fromDegrees(r.lon, r.lat));
            if (ground !== undefined && ground > 1) pos = Cartesian3.fromDegrees(r.lon, r.lat, ground);
          }
          const d = Cartesian3.distance(pos, cam.positionWC);
          const kept = this.models.has('rec|' + lid + '|' + rid);
          if (d > range * (kept ? KEEP_RANGE_FACTOR : 1) || !occluder.isPointVisible(horizonPoint(pos))) continue;
          const test = kept ? keepSphere : sphere;
          test.center = pos;
          if (volume.computeVisibility(test) === Intersect.OUTSIDE) continue;
          near.push({ d, score: kept ? d * KEEP_DISTANCE_FACTOR : d, lid, r, pos: Cartesian3.clone(pos) });
        }
      }
      near.sort((a, b) => a.score - b.score);
      // The selected vehicle always gets a model, within the budget (it takes the last slot if needed).
      const budget = Math.max(1, this.modelOpts.budget);
      const sel = near.find((n) => n.lid === this.sel.layer && n.r.id === this.sel.id);
      let chosen = near.slice(0, budget);
      if (sel && !chosen.includes(sel)) chosen = [...near.slice(0, budget - 1), sel];
      picked = chosen.map(({ lid, r, pos }) => this.candidate(lid, r, pos));
    }
    this.modelled = this.models.sync(picked);
    // Always reconcile: new entities start visible, and icons swap with ready models.
    this.cullBehindEarth();
  }

  private candidate(lid: LayerId, r: GeoRecord, position: Cartesian3): ModelCandidate {
    const key = 'rec|' + lid + '|' + r.id;
    const selected = this.sel.layer === lid && this.sel.id === r.id;
    const heading = r.heading === null ? 0 : CMath.toRadians(r.heading);
    if (lid === 'vessels') {
      const v = vesselShape(typeof r.props.shipType === 'number' ? r.props.shipType : null, r.props.lengthM, r.props.beamM);
      // A real model of this kind of ship when the model pack has one (and it has not failed to load).
      const pm = packForVessel(currentModelPack(), v.cls);
      if (pm && !this.models.variantFailed('pack:' + pm.id))
        return { key, variant: 'pack:' + pm.id, url: packModelUrl(pm), position, heading, pitch: 0, scale: packScale(pm, v.lengthM, v.beamM), ground: false, selected, minimumPixelSize: 34 };
      const d = VESSEL_DEFAULTS[v.cls];
      const sx = v.lengthM / d.lengthM;
      const sy = v.beamM / d.beamM;
      return { key, variant: 'sea:' + v.cls, spec: () => buildVessel(v.cls), position, heading, pitch: 0, scale: [sx, sy, (sx + sy) / 2], ground: false, selected, minimumPixelSize: 34 };
    }
    // A report without type data uses the vehicle's last reported type (avoids a model swap and a flash).
    const type = typeof r.props.type === 'string' && r.props.type ? r.props.type : (this.lastType.get(key) ?? null);
    const shape = aircraftShape(type, r.props.emitterCategory as string | null, lid === 'aircraftMil' || r.props.militaryFlag === true);
    const onGround = r.props.onGround === true;
    const pitch = onGround ? 0 : pitchFromRates(r.props.verticalRateFpm, r.speedKts);
    // On Google 3D tiles parked aircraft get an absolute height (terrain + sea level): the hidden globe can't clamp them.
    const ground = onGround && !this.photoreal;
    // The exact type's real model when the model pack has one; otherwise the app-built model.
    const pm = packForAircraft(currentModelPack(), type, shape.military);
    if (pm && !this.models.variantFailed('pack:' + pm.id))
      return { key, variant: 'pack:' + pm.id, url: packModelUrl(pm), position, heading, pitch, scale: packScale(pm, shape.lengthM, shape.spanM), ground, selected, minimumPixelSize: 44 };
    const d = CLASS_DEFAULTS[shape.cls];
    const sx = shape.lengthM / d.lengthM;
    const sy = shape.spanM / d.spanM;
    return {
      key,
      variant: aircraftVariant(shape),
      spec: () => buildAircraft(shape),
      position,
      heading,
      pitch,
      scale: [sx, sy, sx],
      ground,
      selected,
      minimumPixelSize: 44,
    };
  }

  /** Whether a vehicle's callsign/name label should show (geographic labels are separate, see placeLabels.ts). */
  private labelWanted(lid: LayerId, e: Entity): boolean {
    const rid = String(e.id).split('|').slice(2).join('|');
    if (this.sel.layer === lid && this.sel.id === rid) return true;
    const r = this.records.get(lid)?.get(rid);
    if (r && (lid === 'aircraft' || lid === 'aircraftMil') && specialCode(r)) return true;
    const mode = lid === 'vessels' ? this.labelModes.vessel : this.labelModes.aircraft;
    if (mode === 'all') return true;
    if (mode === 'hovered') return this.hovered?.layer === lid && this.hovered.id === rid;
    return false;
  }

  /** Hover state from the globe's mouse-move picking. */
  setHovered(h: { layer: LayerId; id: string } | null): void {
    if (h?.layer === this.hovered?.layer && h?.id === this.hovered?.id) return;
    const prev = this.hovered;
    this.hovered = h;
    for (const x of [prev, h]) {
      const e = x ? this.entities.get(x.layer)?.get(x.id) : undefined;
      if (e?.billboard) e.billboard.scale = ((x === h ? 1.3 : 1) * (this.sel.layer === x!.layer && this.sel.id === x!.id ? 1.35 : 1)) as never;
    }
    this.cullBehindEarth();
    this.widget.scene.requestRender();
  }

  /** Batched rendering for large vehicle sets; picking uses the same 'rec|layer|id' ids as entities. */
  private updateBulk(id: LayerId, records: GeoRecord[], opts: RenderOptions): void {
    const src = this.sources.get(id);
    if (src && src.entities.values.length) {
      src.entities.removeAll();
      this.entities.get(id)?.clear();
    }
    let b = this.bulk.get(id);
    if (!b) {
      b = { coll: this.widget.scene.primitives.add(new BillboardCollection({ scene: this.widget.scene })) as BillboardCollection, byId: new Map() };
      this.bulk.set(id, b);
    }
    const now = Date.now();
    const keep = new Set<string>();
    const near = id === 'vessels' ? new NearFarScalar(2e4, 1, 3e6, 0.4) : new NearFarScalar(5e4, 1, 8e6, 0.45);
    for (const r of records) {
      keep.add(r.id);
      const sel = opts.selectedLayer === id && opts.selectedId === r.id;
      const position = Cartesian3.fromDegrees(r.lon, r.lat, this.heightFor(id, r));
      const image = this.iconFor(id, r, sel);
      const color = id !== 'vessels' && trackState(r, now) !== 'fresh' ? Color.WHITE.withAlpha(0.55) : Color.WHITE;
      const ex = b.byId.get(r.id);
      if (ex) {
        ex.position = position;
        ex.rotation = this.rotationFor(r);
        if (ex.image !== image) ex.image = image;
        ex.scale = sel ? 1.35 : 1;
        ex.color = color;
        ex.disableDepthTestDistance = this.depthTestFor(id, r);
      } else b.byId.set(r.id, b.coll.add({ id: `rec|${id}|${r.id}`, position, image, rotation: this.rotationFor(r), alignedAxis: Cartesian3.UNIT_Z, scale: sel ? 1.35 : 1, scaleByDistance: near, eyeOffset: new Cartesian3(0, 0, -30), color, disableDepthTestDistance: this.depthTestFor(id, r) }));
    }
    for (const [rid, bb] of b.byId)
      if (!keep.has(rid)) {
        b.coll.remove(bb);
        b.byId.delete(rid);
      }
    this.cullBehindEarth();
    this.widget.scene.requestRender();
  }

  private dropBulk(id: LayerId): void {
    const b = this.bulk.get(id);
    if (!b) return;
    this.widget.scene.primitives.remove(b.coll);
    this.bulk.delete(id);
  }

  /** Hides aircraft/vessel icons and labels that are below the earth's horizon from the camera (3D only). */
  cullBehindEarth(): void {
    const scene = this.widget.scene;
    const in3D = scene.mode === SceneMode.SCENE3D;
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, this.widget.camera.positionWC);
    const now = JulianDate.now();
    for (const lid of ['aircraft', 'aircraftMil', 'vessels'] as LayerId[]) {
      // Icons whose vehicle currently has a 3D model are hidden (labels stay). Bulk billboards are handled
      // first: a layer whose first update was already bulk has no entity map.
      const bk = this.bulk.get(lid);
      if (bk) for (const [rid, bb] of bk.byId) bb.show = (!in3D || occluder.isPointVisible(horizonPoint(bb.position))) && !this.modelled.has('rec|' + lid + '|' + rid);
      const ents = this.entities.get(lid);
      if (!ents) continue;
      for (const e of ents.values()) {
        const p = e.position?.getValue(now);
        const visible = !in3D || !p || occluder.isPointVisible(horizonPoint(p));
        if (e.billboard) e.billboard.show = (visible && !this.modelled.has(String(e.id))) as never;
        if (e.label) e.label.show = (visible && this.labelWanted(lid, e)) as never;
        if (e.point) e.point.show = visible as never;
      }
    }
  }

  private source(id: LayerId): CustomDataSource {
    let s = this.sources.get(id);
    if (!s) {
      s = new CustomDataSource(`layer-${id}`);
      if (id === 'cameras' || id === 'fires' || id === 'metar') {
        s.clustering.enabled = true;
        s.clustering.pixelRange = id === 'fires' ? 18 : 28;
        s.clustering.minimumClusterSize = 4;
        s.clustering.clusterEvent.addEventListener((_ents, cluster) => {
          cluster.label.show = true;
          cluster.label.font = '600 12px "Segoe UI", sans-serif';
          cluster.label.fillColor = Color.WHITE;
          cluster.label.outlineColor = Color.BLACK;
          cluster.label.outlineWidth = 3;
          cluster.label.style = LabelStyle.FILL_AND_OUTLINE;
          cluster.billboard.show = false;
          cluster.point.show = true;
          cluster.point.pixelSize = 18;
          cluster.point.color = id === 'fires' ? C('#e8613a').withAlpha(0.8) : id === 'cameras' ? C('#4fb3c8').withAlpha(0.8) : C('#6b7f93').withAlpha(0.8);
          cluster.point.outlineColor = Color.BLACK;
          cluster.point.outlineWidth = 1;
        });
      }
      void this.widget.dataSources.add(s);
      this.sources.set(id, s);
      this.entities.set(id, new Map());
    }
    return s;
  }

  setVisible(id: LayerId, visible: boolean): void {
    const s = this.sources.get(id);
    const was = s?.show;
    if (s) s.show = visible;
    const bk = this.bulk.get(id);
    if (bk) bk.coll.show = visible;
    if ((id === 'aircraft' || id === 'aircraftMil' || id === 'vessels') && was !== visible) this.syncModels();
    if (id === 'satellites' && !visible) this.stopSatTimer();
    this.widget.scene.requestRender();
  }

  /** Replaces a layer's records, reusing entities by stable id. */
  update(id: LayerId, all: GeoRecord[], opts: RenderOptions): void {
    const now = Date.now();
    let records = all;
    if ((id === 'aircraft' || id === 'aircraftMil') && opts.aircraftFilter) records = all.filter((r) => trackState(r, now) !== 'expired' && passesFilter(r, opts.aircraftFilter!));
    if (id === 'vessels' && opts.vesselClasses) records = all.filter((r) => opts.vesselClasses!.includes(vesselClass(r.category)));
    this.records.set(id, new Map(records.map((r) => [r.id, r])));
    if (id === 'aircraft' || id === 'aircraftMil')
      for (const r of all) {
        // Every report refreshes recency (typed or not), so an aircraft still reporting is never the oldest entry.
        const key = 'rec|' + id + '|' + r.id;
        const type = typeof r.props.type === 'string' && r.props.type ? r.props.type : this.lastType.get(key);
        if (!type) continue;
        this.lastType.delete(key); // re-insert: the Map keeps insertion order, so the least recently reported is first
        this.lastType.set(key, type);
        if (this.lastType.size > 20000) this.lastType.delete(this.lastType.keys().next().value!);
      }
    this.smooth = opts.smoothMotion !== false;
    this.sel = { layer: opts.selectedLayer, id: opts.selectedId };
    if (opts.aircraftLabels) this.labelModes.aircraft = opts.aircraftLabels;
    if (opts.vesselLabels) this.labelModes.vessel = opts.vesselLabels;
    if (opts.vehicleModels !== undefined) this.modelOpts.enabled = opts.vehicleModels;
    if (opts.modelBudget !== undefined) this.modelOpts.budget = opts.modelBudget;
    if ((id === 'aircraft' || id === 'aircraftMil') && !this.motionTimer) this.motionTimer = setInterval(() => this.tickMotion(), 1000);
    // Thousands of aircraft or ships (worldwide views): one batched BillboardCollection instead of entities.
    if ((id === 'aircraft' || id === 'aircraftMil' || id === 'vessels') && records.length > BULK_THRESHOLD) {
      this.updateBulk(id, records, opts);
      this.syncModels();
      return;
    }
    this.dropBulk(id);
    const src = this.source(id);
    const map = this.entities.get(id)!;
    const keep = new Set<string>();
    src.entities.suspendEvents();
    for (const r of records) {
      keep.add(r.id);
      const selected = opts.selectedLayer === id && opts.selectedId === r.id;
      const existing = map.get(r.id);
      if (existing && id !== 'satellites' && !r.geometry) {
        (existing.position as ConstantPositionProperty).setValue(Cartesian3.fromDegrees(r.lon, r.lat, this.heightFor(id, r)));
        if (existing.billboard) {
          existing.billboard.rotation = this.rotationFor(r) as never;
          existing.billboard.scale = (selected ? 1.35 : 1) as never;
          if (id === 'aircraft' || id === 'aircraftMil' || id === 'vessels') {
            existing.billboard.image = this.iconFor(id, r, selected) as never;
            existing.billboard.disableDepthTestDistance = this.depthTestFor(id, r) as never;
          }
        }
        if (existing.label) {
          existing.label.text = r.label as never;
          if (id === 'aircraft' || id === 'aircraftMil' || id === 'vessels') existing.label.disableDepthTestDistance = this.depthTestFor(id, r) as never;
        }
        continue;
      }
      if (existing) src.entities.remove(existing);
      const e = this.create(id, r, selected);
      if (e) {
        src.entities.add(e);
        map.set(r.id, e);
      }
    }
    for (const [rid, e] of map) {
      if (!keep.has(rid)) {
        src.entities.remove(e);
        map.delete(rid);
      }
    }
    src.entities.resumeEvents();
    if (id === 'satellites') this.syncSatellites(records);
    if (id === 'aircraft' || id === 'aircraftMil' || id === 'vessels') this.syncModels();
    this.widget.scene.requestRender();
  }

  /** Moves aircraft along their last reported track for up to 45 s; dims stale tracks. */
  private tickMotion(): void {
    const now = Date.now();
    let changed = false;
    for (const lid of ['aircraft', 'aircraftMil'] as LayerId[]) {
      const ents = this.entities.get(lid);
      const recs = this.records.get(lid);
      const bk = this.bulk.get(lid);
      if (bk && recs)
        for (const [rid, bb] of bk.byId) {
          const r = recs.get(rid);
          if (!r || r.props.snapshot === true) continue;
          const p = this.shownAt(lid, r, now, true);
          bb.position = Cartesian3.fromDegrees(p.lon, p.lat, this.heightFor(lid, r, p));
          changed = true;
        }
      if (!ents || !recs) continue;
      for (const [rid, e] of ents) {
        const r = recs.get(rid);
        if (!r) continue;
        const state = trackState(r, now);
        const p = this.shownAt(lid, r, now, false);
        (e.position as ConstantPositionProperty).setValue(Cartesian3.fromDegrees(p.lon, p.lat, this.heightFor(lid, r, p)));
        if (e.billboard) e.billboard.color = (state === 'fresh' ? Color.WHITE : Color.WHITE.withAlpha(0.4)) as never;
        e.show = state !== 'expired';
        changed = true;
      }
    }
    if (changed) {
      // Moves the 3D models along with the dead-reckoned positions.
      this.syncModels();
      this.widget.scene.requestRender();
    }
  }

  entityFor(id: LayerId, rid: string): Entity | undefined {
    return this.entities.get(id)?.get(rid);
  }

  /**
   * Icons of ships and parked aircraft sit on the surface (the 3D water or ground would cut or hide them, and
   * their height can be approximate while terrain samples load), so they are never depth-tested; airborne
   * aircraft still are. The far side of the earth is culled separately (cullBehindEarth).
   */
  private depthTestFor(id: LayerId, r: GeoRecord): number {
    return id === 'vessels' || ((id === 'aircraft' || id === 'aircraftMil') && r.props.onGround === true) ? Number.POSITIVE_INFINITY : 0;
  }

  /** Height to draw a vehicle at in the current scene (see `photoreal`). */
  /**
   * Where a vehicle is drawn at `now`: aircraft move along their last reported track for up to 45 s when motion
   * smoothing is on (history snapshots on the bulk layer stay at their report); everything else sits at its report.
   */
  private shownAt(id: LayerId, r: GeoRecord, now: number, bulk: boolean): { lat: number; lon: number } {
    return drawnPosition(r, now, { aircraft: id === 'aircraft' || id === 'aircraftMil', smooth: this.smooth, snapshotsStay: bulk });
  }

  /** Height of a vehicle drawn at `at` (default: its reported position); sea level and ground are taken there. */
  private heightFor(id: LayerId, r: GeoRecord, at: { lat: number; lon: number } = r): number {
    const air = id === 'aircraft' || id === 'aircraftMil';
    // Only vehicles follow the scene's vertical reference (and are re-placed when it changes); other layers keep height 0.
    if (!air && id !== 'vessels') return 0;
    const sea = this.seaLevel(at.lat, at.lon) ?? 0;
    // Aircraft are drawn at reported altitude (above sea level) so trails and tracking read correctly in 3D.
    // On Google 3D tiles altitudes below sea level are kept (terrain there can be below sea level too); the app's
    // globe keeps its sea-level floor.
    if (air && r.altM !== null && !r.props.onGround) return this.photoreal ? r.altM + sea : Math.max(0, r.altM);
    if (air && r.props.onGround === true && this.photoreal) return this.parkedGround(at.lat, at.lon) ?? sea;
    return sea;
  }

  /** Local sea level as a height in the current scene: 0 on the app's globe, the geoid height on Google 3D tiles (null until the grid has loaded). */
  private seaLevel(lat: number, lon: number): number | null {
    return this.photoreal ? geoidHeight(lat, lon) : 0;
  }

  /**
   * Ground height for a parked aircraft on Google 3D tiles: terrain height above sea level (sampled once per
   * ~200 m cell from `groundSampler`, which answers while the globe is hidden) + local sea level.
   * null while either is unknown; `request` queues the terrain sample (done only for vehicles near the camera).
   */
  private parkedGround(lat: number, lon: number, request = false): number | null {
    const sea = geoidHeight(lat, lon);
    if (sea === null) return null;
    // The terrain source (Web Mercator) has no data poleward of ±85.05°: no ground height there (the aircraft stays an icon).
    if (!terrainCoversLatitude(lat)) return null;
    const key = `${Math.round(lat * 500)}|${Math.round(lon * 500)}`;
    const terrain = this.groundCache.get(key);
    if (terrain !== undefined) return terrain + sea;
    if (request) this.requestGround(key, lat, lon);
    return null;
  }

  private requestGround(key: string, lat: number, lon: number): void {
    if (this.groundPending.has(key) || Date.now() - (this.groundFailed.get(key)?.at ?? -Infinity) < GROUND_BACKOFF_MS) return;
    this.groundPending.add(key);
    this.groundQueue.set(key, Cartographic.fromDegrees(lon, lat));
    if (!this.groundTimer && !this.groundInFlight) this.groundTimer = setTimeout(() => this.sampleGround(), 50);
  }

  /**
   * One timer for failed cells: it wakes when the earliest back-off ends, re-places vehicles (which requests the
   * still-needed cells again) and re-arms for failures still waiting for their wake-up, e.g. from a later batch.
   */
  private armGroundRetry(): void {
    if (this.destroyed || this.groundRetryTimer) return;
    const delay = nextGroundRetryDelay(this.groundFailed, Date.now());
    if (delay === null) return;
    this.groundRetryTimer = setTimeout(() => {
      this.groundRetryTimer = null;
      if (this.destroyed) return;
      // Each failure gets one wake-up: cells still needed are requested again by the refresh (a new failure
      // schedules a new wake-up); cells no longer needed don't keep the timer (and full refreshes) going.
      markGroundRetriesWoken(this.groundFailed, Date.now());
      this.refreshSurfaceHeights();
      this.armGroundRetry();
    }, delay);
  }

  /** One terrain request for the queued cells (up to 200); when heights arrive, icons and models are re-placed. */
  private sampleGround(): void {
    this.groundTimer = null;
    if (this.destroyed || !this.groundQueue.size) return;
    const batch = [...this.groundQueue].slice(0, 200);
    for (const [k] of batch) this.groundQueue.delete(k);
    this.groundInFlight = true;
    const settle = (heights: (number | undefined)[]) => {
      const now = Date.now();
      batch.forEach(([k], i) => {
        const h = heights[i];
        if (typeof h === 'number' && Number.isFinite(h)) {
          this.groundCache.set(k, h);
          this.groundFailed.delete(k);
        } else this.groundFailed.set(k, { at: now, woken: false });
        this.groundPending.delete(k);
      });
      if (this.groundCache.size > 20_000) this.groundCache.clear();
      if (this.groundFailed.size > 5_000) this.groundFailed.clear();
      this.armGroundRetry();
    };
    this.groundSampler ??= createTerrariumTerrain({ strict: true }).provider;
    sampleTerrain(this.groundSampler, GROUND_SAMPLE_LEVEL, batch.map(([, c]) => c.clone()))
      .then((res) => settle(res.map((c) => c.height)))
      .catch(() => settle([]))
      .finally(() => {
        this.groundInFlight = false;
        if (this.destroyed) return;
        if (this.groundQueue.size) this.groundTimer = setTimeout(() => this.sampleGround(), 50);
        this.refreshSurfaceHeights();
      });
  }

  /** Class silhouette (exact type → family → category → unknown), with a ring when selected. */
  private iconFor(id: LayerId, r: GeoRecord, selected: boolean): string {
    if (id === 'vessels') return vesselSymbol(classifyVessel(typeof r.props.shipType === 'number' ? r.props.shipType : null).symbol, vesselColor(r), 30, selected ? '#ffd84a' : undefined);
    if (id === 'aircraft' || id === 'aircraftMil') return aircraftSymbol(classifyAircraft(r.props.type as string | null, r.props.emitterCategory as string | null).symbol, aircraftColor(r), 40, selected ? '#ffd84a' : undefined);
    return glyph('plane', '#fff');
  }

  private rotationFor(r: GeoRecord): number {
    return r.heading === null ? 0 : -CMath.toRadians(r.heading);
  }

  private create(id: LayerId, r: GeoRecord, selected: boolean): Entity | null {
    const pos = Cartesian3.fromDegrees(r.lon, r.lat, this.heightFor(id, r));
    const base = { id: `rec|${id}|${r.id}`, position: new ConstantPositionProperty(pos) };
    const label = (text: string, far = 2.5e6, offsetY = -16) => ({
      text,
      font: '500 11px "Segoe UI", sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      pixelOffset: new Cartesian2(0, offsetY),
      distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? 5e7 : far),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    switch (id) {
      case 'aircraft':
      case 'aircraftMil':
        return new Entity({
          ...base,
          billboard: {
            image: this.iconFor(id, r, selected),
            rotation: this.rotationFor(r),
            alignedAxis: Cartesian3.UNIT_Z,
            scale: selected ? 1.35 : 1,
            scaleByDistance: new NearFarScalar(5e4, 1, 8e6, 0.45),
            // Airborne: depth-tested (hidden behind 3D buildings and Google 3D tiles). Parked: never (see depthTestFor).
            // The far side of the earth is culled in cullBehindEarth().
            disableDepthTestDistance: this.depthTestFor(id, r),
            eyeOffset: new Cartesian3(0, 0, -30),
          },
          label: { ...label(specialCode(r) ? `${r.label} · ${String(r.props.squawk ?? r.props.emergency)}` : r.label, specialCode(r) ? 4e7 : 4e5), disableDepthTestDistance: this.depthTestFor(id, r), eyeOffset: new Cartesian3(0, 0, -30) },
          point: specialCode(r) ? { pixelSize: 26, color: Color.TRANSPARENT, outlineColor: C('#ff5a4f'), outlineWidth: 2, disableDepthTestDistance: 0 } : undefined,
        });
      case 'vessels':
        return new Entity({
          ...base,
          // At height 0, never depth-tested (see depthTestFor), lifted toward the camera.
          billboard: { image: this.iconFor(id, r, selected), rotation: this.rotationFor(r), alignedAxis: Cartesian3.UNIT_Z, scale: selected ? 1.4 : 1, scaleByDistance: new NearFarScalar(2e4, 1, 3e6, 0.4), disableDepthTestDistance: this.depthTestFor(id, r), eyeOffset: new Cartesian3(0, 0, -60) },
          label: { ...label(r.label, 1.5e5), disableDepthTestDistance: this.depthTestFor(id, r), eyeOffset: new Cartesian3(0, 0, -60) },
        });
      case 'satellites':
        return new Entity({
          id: base.id,
          position: new ConstantPositionProperty(Cartesian3.fromDegrees(0, 0, 400_000)),
          billboard: { image: glyph('sat', r.category === 'stations' ? '#f2c94c' : '#b9c7f5', 24), scale: selected ? 1.3 : 0.8, disableDepthTestDistance: 0 },
          label: label(r.label, r.category === 'stations' ? 4e7 : 6e6),
        });
      case 'fires': {
        const frp = typeof r.props.frpMW === 'number' ? r.props.frpMW : 1;
        return new Entity({ ...base, point: { pixelSize: Math.min(14, 4 + Math.sqrt(frp)), color: C(frp > 50 ? '#ff4b2b' : '#ff9a3c').withAlpha(0.9), outlineColor: Color.BLACK, outlineWidth: 1 } });
      }
      case 'firePerimeters':
      case 'airspace': {
        if (!r.geometry || r.geometry.type === 'LineString') return null;
        const color = id === 'airspace' ? C(r.props.type === 'P' ? '#e5534b' : '#b07be8') : C('#ff6b3d');
        const polys = r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates;
        const ring = polys[0][0];
        const flat = ring.flatMap(([x, y]) => [x, y]);
        return new Entity({
          ...base,
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat), polys[0].slice(1).map((h) => new PolygonHierarchy(Cartesian3.fromDegreesArray(h.flatMap(([x, y]) => [x, y]))))),
            material: color.withAlpha(selected ? 0.35 : id === 'airspace' ? 0.1 : 0.22),
            outline: true,
            outlineColor: selected ? Color.WHITE : color,
            height: 0,
          },
          label: label(r.label, id === 'airspace' ? 6e5 : 1.5e6, 0),
        });
      }
      case 'metar':
        return new Entity({
          ...base,
          point: { pixelSize: 9, color: C(FLIGHT_CAT[r.category ?? ''] ?? '#9aa7b4'), outlineColor: Color.BLACK, outlineWidth: 1 },
          label: label(r.label, 6e5, -10),
        });
      case 'cyclones':
        return new Entity({ ...base, billboard: { image: glyph('storm', '#ff5a4f', 36), scale: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: label(r.label, 4e7, -22) });
      case 'incidents': {
        const lvl = String(r.props.alertLevel ?? '');
        const color = lvl === 'Red' ? '#e5534b' : lvl === 'Orange' ? '#f0883e' : lvl === 'Green' ? '#57ab5a' : '#9fb3c8';
        return new Entity({ ...base, point: { pixelSize: selected ? 14 : 10, color: C(color), outlineColor: Color.BLACK, outlineWidth: 2, disableDepthTestDistance: 0 }, label: label(r.label, 3e6, -12) });
      }
      case 'cameras':
        return new Entity({ ...base, billboard: { image: glyph('camera', '#6fd0e2', 20), scale: selected ? 1.4 : 1 }, label: label(r.label, 4e4) });
      case 'transit':
        return new Entity({ ...base, point: { pixelSize: 8, color: C(TRANSIT[r.category ?? ''] ?? '#cfd8e3'), outlineColor: Color.BLACK, outlineWidth: 1 }, label: label(r.label, 3e4, -10) });
    }
  }

  // ---------- satellites (calculated) ----------
  private syncSatellites(records: GeoRecord[]): void {
    this.satrecs.clear();
    for (const r of records) {
      if (!r.tle) continue;
      try {
        this.satrecs.set(r.id, twoline2satrec(r.tle[0], r.tle[1]));
      } catch {
        // skip bad elements
      }
    }
    this.propagateAll();
    if (!this.satTimer) this.satTimer = setInterval(() => this.propagateAll(), 2000);
  }

  private stopSatTimer(): void {
    if (this.satTimer) clearInterval(this.satTimer);
    this.satTimer = null;
  }

  /** Position of a satellite at `when` from its elements; null if propagation fails (e.g. decayed). */
  satPosition(id: string, when: Date): Cartesian3 | null {
    const rec = this.satrecs.get(id);
    if (!rec) return null;
    const pv = propagate(rec, when);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const geo = eciToGeodetic(pv.position, gstime(when));
    return Cartesian3.fromRadians(geo.longitude, geo.latitude, geo.height * 1000);
  }

  private propagateAll(): void {
    const map = this.entities.get('satellites');
    if (!map) return;
    const now = new Date();
    for (const [rid, e] of map) {
      const p = this.satPosition(rid, now);
      if (p) {
        (e.position as ConstantPositionProperty).setValue(p);
        e.show = true;
      } else e.show = false;
    }
    this.widget.scene.requestRender();
  }

  /** Draws one predicted orbit (≈ 1 revolution) for the selected satellite. */
  showOrbit(id: string | null): void {
    if (this.orbitEntity) {
      this.widget.entities.remove(this.orbitEntity);
      this.orbitEntity = null;
    }
    const rec = id ? this.satrecs.get(id) : null;
    if (!id || !rec) return;
    const periodMin = (2 * Math.PI) / rec.no; // rec.no is rad/min
    const pts: Cartesian3[] = [];
    const t0 = Date.now();
    for (let i = 0; i <= 180; i++) {
      const p = this.satPosition(id, new Date(t0 + (i / 180) * periodMin * 60_000));
      if (p) pts.push(p);
    }
    this.orbitEntity = this.widget.entities.add({
      id: 'orbit|predicted',
      polyline: { positions: pts, width: 1.5, material: C('#b9c7f5').withAlpha(0.7) },
    });
    this.widget.scene.requestRender();
  }

  /** Recorded observed positions for a tracked object (no interpolation). */
  showTrail(points: TrailPoint[] | null, kind: TrailKind): void {
    if (this.trailEntity) {
      this.widget.entities.remove(this.trailEntity);
      this.trailEntity = null;
    }
    this.trailArgs = points && points.length >= 2 ? { points, kind } : null;
    if (!points || points.length < 2) return;
    // Same vertical reference as the vehicle (see `photoreal`); points without a known height are left out.
    const positions: Cartesian3[] = [];
    for (const p of points) {
      const h = trailPointHeight(p, kind, this.photoreal, this.seaLevel(p.lat, p.lon) ?? 0, () => this.parkedGround(p.lat, p.lon, true));
      if (h !== null) positions.push(Cartesian3.fromDegrees(p.lon, p.lat, h));
    }
    if (positions.length < 2) return;
    this.trailEntity = this.widget.entities.add({
      id: 'trail|recorded',
      polyline: {
        positions,
        width: 2,
        material: C('#5fd0e6').withAlpha(0.85),
      },
    });
    this.widget.scene.requestRender();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopSatTimer();
    if (this.motionTimer) clearInterval(this.motionTimer);
    if (this.modelSyncTimer) clearTimeout(this.modelSyncTimer);
    this.modelSyncTimer = null;
    if (this.groundTimer) clearTimeout(this.groundTimer);
    this.groundTimer = null;
    if (this.groundRetryTimer) clearTimeout(this.groundRetryTimer);
    this.groundRetryTimer = null;
    this.models.destroy();
  }
}

export { CallbackPositionProperty, JulianDate };

export type VesselClass = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'other';
export function vesselClass(category: string | null): VesselClass {
  if (category === 'Cargo') return 'cargo';
  if (category === 'Tanker') return 'tanker';
  if (category === 'Passenger') return 'passenger';
  if (category === 'Fishing') return 'fishing';
  return 'other';
}
