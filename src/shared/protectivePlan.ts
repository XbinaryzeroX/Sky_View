// Protective planning: a saved, local-only plan for one site (observation points, modelled coverage, routes and
// zones drawn with the existing map tools, inspected buildings, nearby emergency facilities, aligned floor plans and
// notes), plus its briefing. Everything the plan records is labelled by origin: observed (published data), modelled
// (computed here from that data), user-entered, or unavailable. Nothing is simulated, and nothing is sent anywhere
// unless the user exports it.
import { z } from 'zod';
import { pathLengthKm } from './geo';
import type { SatellitePassResult } from './satellitePasses';
import { localSegment, toLocal, unwrapLonOffsets } from './viewshed';
import { escapeHtml } from './sanitize';

export const PLAN_LIMITS = { observers: 24, roles: 200, floorPlans: 8, buildings: 30, facilities: 200, notes: 10_000, imageChars: 1_200_000, planChars: 8_000_000 } as const;

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const lat = z.number().finite().min(-90).max(90);
const lon = z.number().finite().min(-180).max(180);
const iso = z.string().datetime();
const text = (max: number) => z.string().max(max);

export const observerSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    lat,
    lon,
    /** Eye or lens height above the surface under it (on a mapped roof: above the roof). */
    heightM: z.number().finite().min(0).max(300),
    kind: z.enum(['observer', 'camera']),
    /** Direction and field of view; null = all directions (only allowed for observers, not cameras). */
    headingDeg: z.number().finite().min(0).max(360).nullable(),
    fovDeg: z.number().finite().min(1).max(360).nullable(),
    rangeM: z.number().finite().min(10).max(5000),
    /** Who supplied the direction: nobody, the user's own estimate, or the camera's publisher. */
    direction: z.enum(['all', 'user-estimate', 'publisher']),
    /** A public camera this point stands for (its feed stays in the existing camera viewer). */
    camera: z
      .object({
        recordId: z.string().min(1).max(200),
        source: text(200),
        label: text(200),
        /** When the publisher's catalogue (position, direction) was last fetched; null = not recorded. */
        catalogueAt: iso.nullable().default(null),
        /** What the publisher offers: still image, stream or viewer link; null = not recorded. */
        media: text(40).nullable().default(null),
        /** Direction as published (degrees), when the publisher supplies one. */
        publishedHeadingDeg: z.number().finite().min(0).max(360).nullable().default(null),
      })
      .strict()
      .nullable(),
    note: text(500),
  })
  .strict()
  .refine((o) => o.kind === 'observer' || (o.headingDeg !== null && o.fovDeg !== null), 'A camera needs a direction and field of view before its coverage can be modelled.')
  .refine((o) => (o.headingDeg === null) === (o.fovDeg === null), 'Direction and field of view go together.')
  .refine((o) => (o.direction === 'all') === (o.headingDeg === null), 'Direction source does not match the direction.');
export type PlanObserver = z.infer<typeof observerSchema>;

export const PLAN_ROLES = ['primary-route', 'alternate-route', 'perimeter', 'zone', 'staging', 'exit', 'assembly', 'note'] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];
export const ROLE_LABEL: Record<PlanRole, string> = {
  'primary-route': 'Primary route',
  'alternate-route': 'Alternative route',
  perimeter: 'Perimeter',
  zone: 'Zone',
  staging: 'Staging area',
  exit: 'Exit (user-supplied)',
  assembly: 'Assembly point (user-supplied)',
  note: 'Note',
};
/** Which drawn annotation kinds a role applies to. */
export const ROLE_KINDS: Record<PlanRole, ('line' | 'area' | 'pin')[]> = {
  'primary-route': ['line'],
  'alternate-route': ['line'],
  perimeter: ['area'],
  zone: ['area'],
  staging: ['area', 'pin'],
  exit: ['pin'],
  assembly: ['pin', 'area'],
  note: ['pin', 'line', 'area'],
};

/** Geometry of a drawn item as it was when the plan was saved (the map item can later change or be deleted). */
export const roleSnapshotSchema = z
  .object({ kind: z.enum(['line', 'area', 'pin']), name: text(200), points: z.array(z.tuple([lon, lat])).min(1).max(5000) })
  .strict();
export const roleSchema = z
  .object({ annotationId: id, role: z.enum(PLAN_ROLES), mode: z.enum(['walk', 'drive']).nullable(), note: text(500), snapshot: roleSnapshotSchema.nullable().default(null) })
  .strict();
export type PlanRoleAssignment = z.infer<typeof roleSchema>;

const imageDataUrl = z
  .string()
  .max(PLAN_LIMITS.imageChars)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'Expected an embedded PNG, JPEG or WebP image.');

export const floorPlanSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    image: imageDataUrl,
    lat,
    lon,
    widthM: z.number().finite().min(1).max(2000),
    heightM: z.number().finite().min(1).max(2000),
    rotationDeg: z.number().finite().min(-180).max(180),
    /** Floor height above the ground at its centre. */
    elevationM: z.number().finite().min(-50).max(1000),
    level: z.number().int().min(-10).max(200),
    opacity: z.number().finite().min(0.1).max(1),
    /** The user confirmed these against the real building; until then the plan is shown as unconfirmed. */
    confirmed: z.object({ scale: z.boolean(), orientation: z.boolean(), floor: z.boolean() }).strict(),
  })
  .strict();
export type FloorPlan = z.infer<typeof floorPlanSchema>;

const sourcedNumber = z.object({ value: z.number().finite(), source: z.enum(['reported', 'estimated-from-levels']) }).strict();
export const buildingInfoSchema = z
  .object({
    osmType: z.enum(['way', 'relation']),
    osmId: z.number().int().positive(),
    /** inside: the point is in the footprint; nearest: closest footprint within 30 m; bounds: only the bounding box is known. */
    match: z.enum(['inside', 'nearest', 'bounds']),
    distanceM: z.number().finite().min(0).max(1000),
    name: text(200).nullable(),
    buildingType: text(80).nullable(),
    use: text(200).nullable(),
    address: text(300).nullable(),
    height: sourcedNumber.nullable(),
    levels: z.number().int().min(0).max(300).nullable(),
    minLevel: z.number().int().min(-20).max(300).nullable(),
    startDate: text(40).nullable(),
    operator: text(200).nullable(),
    footprint: z.array(z.tuple([lon, lat])).max(2000).nullable(),
    footprintAreaM2: z.number().finite().min(0).nullable(),
    lastEditedAt: iso.nullable(),
    fetchedAt: iso,
  })
  .strict();
export type BuildingInfo = z.infer<typeof buildingInfoSchema>;

export const FACILITY_KINDS = ['hospital', 'clinic', 'police', 'fire_station', 'ambulance_station', 'assembly_point'] as const;
export const FACILITY_LABEL: Record<(typeof FACILITY_KINDS)[number], string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  police: 'Police',
  fire_station: 'Fire station',
  ambulance_station: 'Ambulance station',
  assembly_point: 'Assembly point (mapped)',
};
export const facilitySchema = z
  .object({
    osmType: z.enum(['node', 'way', 'relation']),
    osmId: z.number().int().positive(),
    kind: z.enum(FACILITY_KINDS),
    name: text(200).nullable(),
    lat,
    lon,
    /** OSM `emergency=yes` on a hospital (24-hour emergency department, as mapped). */
    emergency: z.boolean().nullable(),
  })
  .strict();
export type Facility = z.infer<typeof facilitySchema>;
export const facilitiesSchema = z
  .object({ fetchedAt: iso, radiusM: z.number().finite().min(100).max(5000), items: z.array(facilitySchema).max(PLAN_LIMITS.facilities), truncated: z.boolean() })
  .strict();
export type Facilities = z.infer<typeof facilitiesSchema>;

const counts = z.record(z.string().max(20), z.number().int().min(0));
export const analysisRunSchema = z
  .object({
    at: iso,
    cellM: z.number().finite(),
    n: z.number().int().min(1),
    terrain: z.object({ source: text(600), level: z.number().int(), missingCells: z.number().int().min(0) }).strict(),
    buildings: z.object({ source: text(600), tilesLoaded: z.number().int().min(0), tilesFailed: z.number().int().min(0), buildingCells: z.number().int().min(0) }).strict(),
    combined: counts,
    perObserver: z.array(z.object({ id, counts, error: text(300).nullable() }).strict()).max(PLAN_LIMITS.observers),
    /** planInputsKey() of the plan when this run was made; a different current key means the run is out of date. */
    inputsKey: z.string().max(20_000).default(''),
    /** Analysis radius and target height this run used (null in plans saved before they were recorded). */
    radiusM: z.number().finite().nullable().default(null),
    targetHeightM: z.number().finite().nullable().default(null),
  })
  .strict();
export type AnalysisRun = z.infer<typeof analysisRunSchema>;

/** Rooftops with a modelled clear line to the subject, as computed when the plan was saved or exported. */
export const rooftopStudySchema = z
  .object({
    at: iso,
    subject: z.object({ lat, lon }).strict(),
    subjectHeightM: z.number().finite().min(0).max(50),
    roofEyeM: z.number().finite().min(0).max(10),
    /** Height of the mapped building under the subject (modelled on its roof); null on open ground. */
    subjectRoofM: z.number().finite().min(0).max(1000).nullable(),
    radiusM: z.number().finite().min(50).max(5000),
    cellM: z.number().finite().min(1).max(50),
    groupsInRange: z.number().int().min(0),
    undetermined: z.number().int().min(0),
    unknownBuildingCells: z.number().int().min(0),
    /** All roofs with a clear line (the list below holds the nearest ones). */
    total: z.number().int().min(0),
    items: z
      .array(z.object({ lat, lon, distanceM: z.number().finite().min(0).max(20_000), bearingDeg: z.number().finite().min(0).max(360), heightM: z.number().finite().min(0).max(1000), elevationDeg: z.number().finite().min(-90).max(90), clearShare: z.number().min(0).max(1) }).strict())
      .max(60),
  })
  .strict();
export type RooftopStudy = z.infer<typeof rooftopStudySchema>;

const share01 = z.number().min(0).max(1);
/** Route options found between two points, with their measures, as they were when the plan was saved or exported. */
export const routeStudySchema = z
  .object({
    at: iso,
    mode: z.enum(['walk', 'drive']),
    a: z.object({ lat, lon }).strict(),
    b: z.object({ lat, lon }).strict(),
    roads: z.object({ tiles: z.number().int().min(0), failed: z.number().int().min(0) }).strict(),
    overlookRangeM: z.number().finite().min(0).max(5000),
    options: z
      .array(
        z
          .object({
            lengthM: z.number().finite().min(0),
            minutes: z.number().finite().min(0),
            majorShare: share01,
            junctions: z.number().int().min(0),
            via: z.array(text(80)).max(3),
            startGapM: z.number().finite().min(0),
            endGapM: z.number().finite().min(0),
            overlook: z.object({ overlooked: share01, clear: share01, unknown: share01, outside: share01, rooftops: z.number().int().min(0) }).strict().nullable(),
            /** The drawn line this option was saved as, if any. */
            annotationId: id.nullable(),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type RouteStudy = z.infer<typeof routeStudySchema>;

/** True when the saved rooftop list was computed for another subject position or height. */
export function rooftopStudyIsStale(p: Pick<ProtectivePlan, 'site' | 'analysis' | 'rooftops'>): boolean {
  const r = p.rooftops;
  return !!r && (Math.abs(r.subject.lat - p.site.lat) > 1e-7 || Math.abs(r.subject.lon - p.site.lon) > 1e-7 || r.subjectHeightM !== p.analysis.targetHeightM);
}

/** Result id of the subject's own view in a coverage run. */
export const SUBJECT_OBSERVER_ID = 'subject';

/**
 * The points a coverage run models: the subject itself (at the site marker, eye at the target height, over the whole
 * analysis radius, all directions) when the plan says so, then every added point that can be modelled (a camera needs a
 * direction and field of view).
 */
export interface CoverageObserver {
  id: string;
  lat: number;
  lon: number;
  heightM: number;
  rangeM: number;
  headingDeg: number | null;
  fovDeg: number | null;
}
export function coverageObservers(p: Pick<ProtectivePlan, 'site' | 'analysis' | 'observers'>): CoverageObserver[] {
  const out: CoverageObserver[] = p.analysis.subjectView === false ? [] : [{ id: SUBJECT_OBSERVER_ID, lat: p.site.lat, lon: p.site.lon, heightM: p.analysis.targetHeightM, rangeM: p.analysis.radiusM, headingDeg: null, fovDeg: null }];
  for (const o of p.observers) if (o.kind === 'observer' || (o.headingDeg !== null && o.fovDeg !== null)) out.push({ id: o.id, lat: o.lat, lon: o.lon, heightM: o.heightM, rangeM: o.rangeM, headingDeg: o.headingDeg, fovDeg: o.fovDeg });
  return out;
}

/** Everything a coverage result depends on (site, analysis settings and each point's geometry). */
export function planInputsKey(p: Pick<ProtectivePlan, 'site' | 'analysis' | 'observers'>): string {
  return JSON.stringify([p.site.lat, p.site.lon, p.analysis, p.observers.map((o) => [o.id, o.lat, o.lon, o.heightM, o.kind, o.headingDeg, o.fovDeg, o.rangeM])]);
}

/** True when the plan has a run that no longer matches its current inputs. */
export function runIsStale(p: ProtectivePlan): boolean {
  return !!p.lastRun && p.lastRun.inputsKey !== planInputsKey(p);
}

export const planSchema = z
  .object({
    version: z.literal(1),
    id,
    name: z.string().trim().min(1).max(120),
    createdAt: iso,
    updatedAt: iso,
    site: z.object({ name: z.string().trim().min(1).max(200), lat, lon, origin: z.enum(['search', 'globe', 'saved-location']), savedLocationId: id.nullable() }).strict(),
    analysis: z
      .object({
        radiusM: z.number().finite().min(50).max(5000),
        cellM: z.number().finite().min(2).max(50),
        targetHeightM: z.number().finite().min(0).max(50),
        /**
         * The user's explicit choice to model ground without mapped buildings as open. OpenStreetMap completeness cannot
         * be established from the data, so without this choice no analysis runs.
         */
        assumeMappedComplete: z.boolean().default(false),
        /**
         * Model coverage from the subject (the site marker) itself, as well as from any added points. On by default:
         * choosing the site is enough to see what it overlooks (and what overlooks it).
         */
        subjectView: z.boolean().default(true),
      })
      .strict(),
    observers: z.array(observerSchema).max(PLAN_LIMITS.observers),
    lastRun: analysisRunSchema.nullable(),
    roles: z.array(roleSchema).max(PLAN_LIMITS.roles),
    floorPlans: z.array(floorPlanSchema).max(PLAN_LIMITS.floorPlans),
    buildings: z.array(buildingInfoSchema).max(PLAN_LIMITS.buildings),
    facilities: facilitiesSchema.nullable(),
    notes: text(PLAN_LIMITS.notes),
    limitationsAcknowledged: z.boolean(),
    /** Added in v0.7: absent in older saved plans. */
    rooftops: rooftopStudySchema.nullable().default(null),
    routeStudy: routeStudySchema.nullable().default(null),
  })
  .strict()
  .refine((p) => JSON.stringify(p).length <= PLAN_LIMITS.planChars, 'Plan too large (floor-plan images take the most space).')
  .refine((p) => new Set(p.observers.map((o) => o.id)).size === p.observers.length, 'Observation point ids must be unique.')
  .refine((p) => p.observers.every((o) => o.id !== SUBJECT_OBSERVER_ID), 'That observation point id is reserved for the subject.')
  .refine((p) => new Set(p.roles.map((r) => r.annotationId)).size === p.roles.length, 'Each drawn item can have one role.');
export type ProtectivePlan = z.infer<typeof planSchema>;

export function newPlan(site: ProtectivePlan['site'], now = new Date()): ProtectivePlan {
  return {
    version: 1,
    id: `plan-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Plan: ${site.name}`.slice(0, 120),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    site,
    analysis: { radiusM: 400, cellM: 4, targetHeightM: 1.7, assumeMappedComplete: false, subjectView: true },
    observers: [],
    lastRun: null,
    roles: [],
    floorPlans: [],
    buildings: [],
    facilities: null,
    notes: '',
    limitationsAcknowledged: false,
    rooftops: null,
    routeStudy: null,
  };
}

// ------------------------------------------------------------------ sources and limitations

export const SOURCES = {
  terrain: 'Terrain Tiles (AWS Open Data; Mapzen/Tilezen terrarium, from SRTM, 3DEP and national datasets): sampled at about 5–10 m spacing; the underlying survey resolution varies by country from about 1 m to 30 m. Below sea level, the mapped sea is modelled at sea level; inland water and land below sea level are unknown.',
  buildings: 'OpenStreetMap building footprints (© OpenStreetMap contributors, ODbL) via OpenFreeMap vector tiles. Heights are from OSM height or levels tags where mapped, otherwise a default estimate; elevated parts (bridges, overhangs) keep the passage under them; buildings missing from OSM are not modelled.',
  photoreal: 'Google Photorealistic 3D Tiles are display only: their mesh is not used in this analysis, so the coverage overlay is drawn on the terrain globe.',
  buildingInfo: 'Building details: OpenStreetMap (community-mapped, © OpenStreetMap contributors, ODbL) via the Overpass API. Coverage and currency vary by place; the last-edited time is shown.',
  facilities: 'Emergency facilities: OpenStreetMap features (hospital, clinic, police, fire station, ambulance station, mapped assembly points) via the Overpass API. Missing entries do not mean a facility does not exist.',
} as const;

export const LIMITATIONS = [
  'Coverage is a geometric line-of-sight model from terrain and mapped building heights. It is a planning estimate, not proof that a place is or is not seen, and not a measure of risk or safety.',
  'Not modelled: vegetation, walls and fences, vehicles, temporary structures, weather, lighting, glass and interiors, and any building missing from OpenStreetMap. These can only reduce real visibility or add blind spots; they are never assumed away.',
  '“Unknown” means the data needed to decide was unavailable. It is not shown as visible and is not a negative result.',
  'Cells on mapped buildings are judged at roof height (plus the target height); an observation point on a mapped building stands on its roof.',
  'Building interiors, occupants and live activity are not known. Floor plans are user-supplied and shown as the user aligned them.',
  'Travel times use an assumed average speed (walking 4.8 km/h, driving 30 km/h) without traffic, closures or road restrictions, which are not available here.',
  'Satellite passes are orbit predictions from published elements. A pass does not mean a satellite is imaging the site.',
  'Ownership and property records are not available: no property-records provider is configured.',
] as const;

// ------------------------------------------------------------------ proximity

/**
 * Whether a drawn item passes within `reach` metres of the site: a vertex or any segment within reach, or an area
 * containing the site. Longitudes are handled like route coverage (continuous across the 180° meridian, on the world
 * copy nearest the site), so a short route on the far side of the world is not "near".
 */
export function itemNearSite(site: { lat: number; lon: number }, item: { kind: 'line' | 'area' | 'pin'; points: [number, number][] }, reach: number): boolean {
  const k = 111_320 * Math.cos((site.lat * Math.PI) / 180);
  const origin = { lat: site.lat, lon: site.lon, cellM: 1, n: 1 };
  for (const [lo, la] of item.points) {
    const p = toLocal(origin, la, lo);
    if (Math.hypot(p.x, p.y) <= reach) return true;
  }
  for (let i = 1; i < item.points.length; i++) {
    const { a: p, b: q } = localSegment(origin, item.points[i - 1], item.points[i]);
    const l2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, -(p.x * (q.x - p.x) + p.y * (q.y - p.y)) / l2)) : 0;
    if (Math.hypot(p.x + t * (q.x - p.x), p.y + t * (q.y - p.y)) <= reach) return true;
  }
  if (item.kind !== 'area' || item.points.length < 3) return false;
  // Containment: the ring unwrapped continuously, tried on the copy it starts on and its two neighbours.
  const off = unwrapLonOffsets(item.points, site.lon);
  for (const shift of [0, -360, 360]) {
    const pts = item.points.map(([, la], i) => [(off[i] + shift) * k, (la - site.lat) * 111_320] as [number, number]);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// ------------------------------------------------------------------ satellite passes

/** Tallies per-satellite outcomes for the site list: passes inside the window, failures and stale orbits are kept apart. */
export function summarisePasses(
  outcomes: { name: string; result: SatellitePassResult | null }[],
  startMs: number,
  windowMs: number,
): { rows: { name: string; peakAt: string; maxEl: number; stale: boolean }[]; ok: number; failed: number; stale: number } {
  const rows: { name: string; peakAt: string; maxEl: number; stale: boolean }[] = [];
  let ok = 0;
  let failed = 0;
  let stale = 0;
  for (const o of outcomes) {
    if (!o.result) {
      failed++;
      continue;
    }
    ok++;
    if (o.result.stale) stale++;
    for (const ps of o.result.passes) {
      const t = Date.parse(ps.peakAt);
      if (t >= startMs && t - startMs < windowMs) rows.push({ name: o.name, peakAt: ps.peakAt, maxEl: ps.maxElevationDeg, stale: o.result.stale });
    }
  }
  rows.sort((a, b) => a.peakAt.localeCompare(b.peakAt));
  return { rows: rows.slice(0, 20), ok, failed, stale };
}

// ------------------------------------------------------------------ routes

export const SPEED_KMH = { walk: 4.8, drive: 30 } as const;

export interface RouteMetrics {
  lengthM: number;
  /** Assumed-speed estimate; null when no mode is chosen. */
  minutes: number | null;
}

export function routeMetrics(points: [number, number][], mode: 'walk' | 'drive' | null): RouteMetrics {
  const lengthM = pathLengthKm(points) * 1000;
  return { lengthM, minutes: mode ? (lengthM / 1000 / SPEED_KMH[mode]) * 60 : null };
}

export function formatMeters(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

export function formatShare(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`;
}

// ------------------------------------------------------------------ briefing

export interface BriefingAnnotation {
  id: string;
  kind: 'line' | 'area' | 'pin';
  name: string;
  points: [number, number][];
}
export interface BriefingRouteRow {
  annotationId: string;
  covered: number | null;
  gap: number | null;
  unknown: number | null;
  outside: number | null;
}
export interface PlanBriefingOptions {
  annotations: BriefingAnnotation[];
  /** Coverage of each route from the last analysis (null when no analysis has run). */
  routes: BriefingRouteRow[];
  /** PNG of the modelled coverage picture (traced finer than the analysis cells), if an analysis has run. */
  coverageImage: string | null;
  generatedAt: Date;
  appVersion: string;
}

const coverageImageSchema = z.string().max(3_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);

export const planExportSchema = z
  .object({
    plan: planSchema,
    annotations: z.array(z.object({ id, kind: z.enum(['line', 'area', 'pin']), name: text(200), points: z.array(z.tuple([lon, lat])).min(1).max(5000) }).strict()).max(PLAN_LIMITS.roles),
    routes: z.array(z.object({ annotationId: id, covered: z.number().min(0).max(1).nullable(), gap: z.number().min(0).max(1).nullable(), unknown: z.number().min(0).max(1).nullable(), outside: z.number().min(0).max(1).nullable() }).strict()).max(PLAN_LIMITS.roles),
    coverageImage: coverageImageSchema.nullable(),
  })
  .strict();
export type PlanExport = z.infer<typeof planExportSchema>;

/**
 * A self-contained SVG of the site (north up, metres around the site): routes, zones and markers with numbered labels,
 * observation points and the analysis radius. Only escaped text and numbers; no scripts or remote references.
 */
export function siteDiagramSvg(plan: ProtectivePlan, items: { n: number; kind: 'line' | 'area' | 'pin'; role: PlanRole; points: [number, number][] }[], roofs: { lat: number; lon: number }[] = []): string {
  const W = 640;
  const H = 480;
  const cos = Math.cos((plan.site.lat * Math.PI) / 180);
  const xy = ([lo, la]: [number, number]) => [unwrapLonOffsets([[lo, la]], plan.site.lon)[0] * 111_320 * cos, (la - plan.site.lat) * 111_320] as [number, number];
  /** A whole item, continuous across the 180° meridian. */
  const path = (points: [number, number][]) => {
    const off = unwrapLonOffsets(points, plan.site.lon);
    return points.map(([, la], i) => [off[i] * 111_320 * cos, (la - plan.site.lat) * 111_320] as [number, number]);
  };
  const pts = [...items.flatMap((i) => path(i.points)), ...plan.observers.map((o) => xy([o.lon, o.lat])), ...roofs.map((r) => xy([r.lon, r.lat]))];
  const r = plan.analysis.radiusM;
  // Frame the analysis area and everything drawn, capped at 5 km around the site.
  let far = r * 1.1;
  for (const [x, y] of pts) far = Math.max(far, Math.abs(x) * 1.08, Math.abs(y) * 1.08);
  const ext = Math.min(5000, far);
  const s = Math.min(W, H) / 2 / ext;
  const P = ([x, y]: [number, number]) => `${(W / 2 + x * s).toFixed(1)},${(H / 2 - y * s).toFixed(1)}`;
  const color: Record<PlanRole, string> = { 'primary-route': '#0072b2', 'alternate-route': '#56b4e9', perimeter: '#d55e00', zone: '#e69f00', staging: '#cc79a7', exit: '#009e73', assembly: '#009e73', note: '#555' };
  const parts: string[] = [];
  parts.push(`<circle cx="${W / 2}" cy="${H / 2}" r="${(r * s).toFixed(1)}" fill="none" stroke="#999" stroke-dasharray="4 3"/>`);
  for (const it of items) {
    const c = color[it.role];
    const p = path(it.points);
    if (it.kind === 'line') parts.push(`<polyline points="${p.map(P).join(' ')}" fill="none" stroke="${c}" stroke-width="${it.role === 'primary-route' ? 3 : 2}"${it.role === 'alternate-route' ? ' stroke-dasharray="6 4"' : ''}/>`);
    else if (it.kind === 'area') parts.push(`<polygon points="${p.map(P).join(' ')}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2"/>`);
    else parts.push(`<circle cx="${P(p[0]).split(',')[0]}" cy="${P(p[0]).split(',')[1]}" r="5" fill="${c}" stroke="#fff"/>`);
    const [lx, ly] = P(p[0]).split(',');
    parts.push(`<text x="${lx}" y="${Number(ly) - 7}" font-size="12" font-weight="700" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${it.n}</text>`);
  }
  for (const o of plan.observers) {
    const [ox, oy] = P(xy([o.lon, o.lat])).split(',');
    parts.push(`<rect x="${Number(ox) - 4}" y="${Number(oy) - 4}" width="8" height="8" fill="${o.kind === 'camera' ? '#cc79a7' : '#56b4e9'}" stroke="#000"/>`);
  }
  // Rooftops with a clear line to the subject: vermillion triangles, numbered as in the rooftop table.
  roofs.forEach((rf, i) => {
    const [rx, ry] = P(xy([rf.lon, rf.lat])).split(',').map(Number);
    parts.push(`<polygon points="${rx},${ry - 6} ${rx - 5},${ry + 4} ${rx + 5},${ry + 4}" fill="#d55e00" stroke="#fff"/>`);
    if (i < 12) parts.push(`<text x="${rx + 6}" y="${ry + 4}" font-size="10" fill="#7a2e00" stroke="#fff" stroke-width="2" paint-order="stroke">R${i + 1}</text>`);
  });
  parts.push(`<circle cx="${W / 2}" cy="${H / 2}" r="6" fill="#ffd166" stroke="#000"/>`);
  // Scale bar (a round length about a fifth of the width) and north arrow.
  const target = (W / 5) / s;
  const bar = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].reduce((b, v) => (v <= target ? v : b), 10);
  parts.push(`<line x1="16" y1="${H - 18}" x2="${16 + bar * s}" y2="${H - 18}" stroke="#000" stroke-width="3"/><text x="16" y="${H - 24}" font-size="11">${bar >= 1000 ? bar / 1000 + ' km' : bar + ' m'}</text>`);
  parts.push(`<text x="${W - 26}" y="22" font-size="14" font-weight="700">N</text><line x1="${W - 21}" y1="28" x2="${W - 21}" y2="52" stroke="#000" stroke-width="2"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="border:1px solid #999;background:#fafafa">${parts.join('')}</svg>`;
}

const fmtTime = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'unknown');
const coord = (la: number, lo: number) => `${la.toFixed(5)}, ${lo.toFixed(5)}`;

/** A self-contained HTML briefing (no scripts, no remote resources). Every value is escaped. */
export function buildPlanBriefing(plan: ProtectivePlan, o: PlanBriefingOptions): string {
  const e = escapeHtml;
  const byId = new Map(o.annotations.map((a) => [a.id, a]));
  const routeCov = new Map(o.routes.map((r) => [r.annotationId, r]));
  const run = plan.lastRun;
  const stale = runIsStale(plan);
  const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const head = (cells: string[]) => `<tr>${cells.map((c) => `<th>${e(c)}</th>`).join('')}</tr>`;
  const section = (title: string, body: string) => `<section><h2>${e(title)}</h2>${body}</section>`;
  const pct = (v: number | null | undefined) => e(formatShare(v));

  const subjectRow = (() => {
    const r = stale ? undefined : run?.perObserver.find((p) => p.id === SUBJECT_OBSERVER_ID);
    if (!r) return '';
    const n = r.counts.analysed ?? 0;
    const result = r.error ? `not modelled: ${r.error}` : n ? `visible ${Math.round(((r.counts.visible ?? 0) / n) * 100)}% · blocked ${Math.round(((r.counts.blocked ?? 0) / n) * 100)}% · unknown ${Math.round(((r.counts.unknown ?? 0) / n) * 100)}%` : 'nothing analysed';
    return row([e(plan.site.name), 'Subject (site marker)', e(coord(plan.site.lat, plan.site.lon)), e(`${run?.targetHeightM ?? plan.analysis.targetHeightM} m (target height)`), 'all directions', e(formatMeters(run?.radiusM ?? plan.analysis.radiusM)), e(result)]);
  })();
  const observers = plan.observers.length || subjectRow
    ? `<table>${head(['Point', 'Type', 'Position', 'Height', 'Direction / field of view', 'Range', 'Modelled result'])}${subjectRow}${plan.observers
        .map((ob) => {
          const r = stale ? undefined : run?.perObserver.find((p) => p.id === ob.id);
          const analysed = r?.counts.analysed ?? 0;
          const result = stale ? 'not current: settings changed after the last run' : !r ? 'not analysed' : r.error ? `not modelled: ${r.error}` : analysed ? `visible ${Math.round(((r.counts.visible ?? 0) / analysed) * 100)}% · blocked ${Math.round(((r.counts.blocked ?? 0) / analysed) * 100)}% · unknown ${Math.round(((r.counts.unknown ?? 0) / analysed) * 100)}%` : 'nothing analysed';
          const dir = ob.headingDeg === null ? 'all directions' : `facing ${Math.round(ob.headingDeg)}° (${ob.direction === 'publisher' ? 'from the publisher' : 'user estimate'}), ${Math.round(ob.fovDeg ?? 0)}° field of view (user estimate)`;
          const cam = ob.camera;
          const camInfo = cam ? ` · ${cam.source} · ${cam.media ?? 'media type not recorded'} · catalogue ${cam.catalogueAt ? fmtTime(cam.catalogueAt) : 'time not recorded'}` : '';
          return row([e(ob.name), e(ob.kind === 'camera' ? `Camera${camInfo}` : 'Observation point'), e(coord(ob.lat, ob.lon)), e(`${ob.heightM} m (user-entered)`), e(dir), e(formatMeters(ob.rangeM)), e(result)]);
        })
        .join('')}</table>`
    : '<p class="muted">No observation points were added.</p>';

  const total = run ? (run.combined.analysed ?? 0) : 0;
  const share = (k: string) => (run && total ? (run.combined[k] ?? 0) / total : null);
  const staleNote = stale ? '<div class="warn"><strong>Out of date.</strong> Observation points or analysis settings changed after this run. The figures below describe the earlier settings, not the plan as it is now; run the analysis again.</div>' : '';
  const coverage = run
    ? `${staleNote}<p>Modelled ${e(fmtTime(run.at))} from terrain and buildings sampled on a ${e(String(run.n))} × ${e(String(run.n))} grid of ${e(String(run.cellM))} m cells; sight lines are traced finer than that, against building outlines${run.radiusM !== null && run.targetHeightM !== null ? ` (radius ${e(formatMeters(run.radiusM))}, target height ${e(String(run.targetHeightM))} m)` : ''}.${stale ? ` The plan’s current settings are radius ${e(formatMeters(plan.analysis.radiusM))}, target height ${e(String(plan.analysis.targetHeightM))} m.` : ''}</p>
      <table>${head(['Clear sight line from one point', 'Clear from two or more', 'Blocked (modelled gaps)', 'Unknown (no data)'])}${row([pct(share('covered')), pct(share('overlap')), pct(share('gap')), pct(share('unknown'))])}</table>
      ${o.coverageImage && !stale ? `<figure><img class="cov" src="${e(o.coverageImage)}" alt="Modelled coverage grid, north up"><figcaption>North up. <span class="k c1"></span> clear from one point · <span class="k c2"></span> two or more · <span class="k gap"></span> blocked (modelled gap) · <span class="k unk"></span> unknown (no data). Uncoloured: not analysed. “Clear” means nothing in the mapped data blocks the line; OpenStreetMap completeness here is not known.</figcaption></figure>` : ''}
      <p><strong>Assumption chosen by the plan author:</strong> ground without mapped buildings was modelled as open. OpenStreetMap completeness here is not known; trees, walls and unmapped buildings can block lines shown as clear.</p>
      <p class="muted">Terrain: ${e(run.terrain.source)} (${e(String(run.terrain.missingCells))} cells without data). Buildings: ${e(run.buildings.source)} (${e(String(run.buildings.tilesLoaded))} tiles loaded, ${e(String(run.buildings.tilesFailed))} unavailable).</p>`
    : '<p class="muted">No coverage analysis has been run for this plan.</p>';

  const roleRows = plan.roles.filter((r) => byId.has(r.annotationId));
  const numbered = roleRows.map((r, i) => ({ n: i + 1, r, a: byId.get(r.annotationId)! }));
  const numberOf = new Map(numbered.map((x) => [x.r.annotationId, x.n]));
  const roofStudy = plan.rooftops;
  const roofStale = rooftopStudyIsStale(plan);
  const diagramRoofs = roofStudy && !roofStale ? roofStudy.items : [];
  const diagram = numbered.length || plan.observers.length || diagramRoofs.length
    ? `<figure>${siteDiagramSvg(plan, numbered.map(({ n, r, a }) => ({ n, kind: a.kind, role: r.role, points: a.points })), diagramRoofs)}<figcaption>Site diagram, north up, metres around the site (yellow). Numbers refer to the lists below; squares are observation points (blue) and cameras (pink); vermillion triangles (R1, R2, …) are rooftops with a modelled clear line to the subject; dashed circle: analysis radius. Shows positions only, not imagery.</figcaption></figure>`
    : '';
  const compass = (deg: number) => `${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
  const rooftops = roofStudy
    ? `${roofStale ? '<div class="warn"><strong>Out of date.</strong> The subject moved or its height changed after this list was computed; it describes the earlier position.</div>' : ''}<p>Computed ${e(fmtTime(roofStudy.at))} for the subject at ${e(coord(roofStudy.subject.lat, roofStudy.subject.lon))}, eye height ${e(String(roofStudy.subjectHeightM))} m; a person on a roof was modelled at the roof edge with eye height ${e(String(roofStudy.roofEyeM))} m. Analysis area ${e(formatMeters(roofStudy.radiusM))} radius, ${e(String(roofStudy.cellM))} m cells.</p>
      <p><strong>${e(String(roofStudy.total))}</strong> of ${e(String(roofStudy.groupsInRange))} mapped roofs in the area have a modelled clear line to the subject.${roofStudy.undetermined ? ` ${e(String(roofStudy.undetermined))} could not be decided (data missing on the way).` : ''}${roofStudy.unknownBuildingCells ? ` Building data was unavailable for ${e(String(roofStudy.unknownBuildingCells))} cells.` : ''}</p>
      ${roofStudy.subjectRoofM !== null ? `<div class="warn">The subject was on a mapped building and was modelled standing on its roof (${e(String(Math.round(roofStudy.subjectRoofM)))} m up), not at street level.</div>` : ''}
      ${roofStudy.items.length ? `<table>${head(['#', 'Distance', 'Direction', 'Roof height', 'Angle from subject', 'Clear part of roof', 'Nearest clear point'])}${roofStudy.items.map((r, i) => row([`R${i + 1}`, e(formatMeters(r.distanceM)), e(compass(r.bearingDeg)), e(`${Math.round(r.heightM)} m`), e(`${r.elevationDeg >= 0 ? '+' : ''}${Math.round(r.elevationDeg)}°`), pct(r.clearShare), e(coord(r.lat, r.lon))])).join('')}</table>${roofStudy.total > roofStudy.items.length ? `<p class="muted">The nearest ${e(String(roofStudy.items.length))} are listed.</p>` : ''}` : ''}
      <p class="muted">A geometric estimate from terrain and OpenStreetMap building heights (mapped or default). Parapets, roof structures, trees, glazing and unmapped buildings are not modelled; a roof that is not listed is not shown to be safe. This lists vantage points to check or cover; it is not a threat assessment.</p>`
    : '<p class="muted">Rooftops were not checked for this plan.</p>';
  const rs = plan.routeStudy;
  const roleName = (id: string | null) => {
    const r = id ? plan.roles.find((x) => x.annotationId === id) : null;
    return r ? ROLE_LABEL[r.role] : '—';
  };
  const routeStudy = rs
    ? `<p>${e(rs.mode === 'walk' ? 'Walking' : 'Driving')} from ${e(coord(rs.a.lat, rs.a.lon))} to ${e(coord(rs.b.lat, rs.b.lon))}, computed ${e(fmtTime(rs.at))} on the OpenStreetMap road network from map tiles (${e(String(rs.roads.tiles))} tiles${rs.roads.failed ? `, <strong>${e(String(rs.roads.failed))} could not be loaded</strong>` : ''}).</p>
      <table>${head(['Option', 'Length', 'Est. time', 'Major roads', 'Junctions', `Overlooked by roofs (≤ ${formatMeters(rs.overlookRangeM)})`, 'Ends off the network', 'In this plan as'])}${rs.options
        .map((op, i) => row([e(`${i + 1}${op.via.length ? ` · via ${op.via.join(', ')}` : ''}`), e(formatMeters(op.lengthM)), e(`${Math.max(1, Math.round(op.minutes))} min`), pct(op.majorShare), e(String(op.junctions)), op.overlook ? `${pct(op.overlook.overlooked)} · ${e(String(op.overlook.rooftops))} roofs${op.overlook.unknown > 0.005 ? ` · ${pct(op.overlook.unknown)} unknown` : ''}${op.overlook.outside > 0.005 ? ` · ${pct(op.overlook.outside)} outside the area` : ''}` : 'not computed', e(`${formatMeters(op.startGapM)} / ${formatMeters(op.endGapM)}`), e(roleName(op.annotationId))]))
        .join('')}</table>
      <p class="muted">Measures for comparing options, not a safety rating. Times use fixed speeds per road type with no traffic, signals or turns; turn restrictions, access rules and closures are not available; roads crossing without a mapped junction are not joined. “Overlooked” is the share of the route inside the analysis area with a clear modelled line to at least one mapped rooftop.</p>`
    : '';
  const coords = (pts: [number, number][]) => {
    const shown = pts.slice(0, 60).map(([lo, la]) => coord(la, lo));
    return e(shown.join(' → ')) + (pts.length > 60 ? e(` … (+${pts.length - 60} more points)`) : '');
  };
  const geometryList = numbered.length
    ? `<table>${head(['#', 'Item', 'Role', 'Points (latitude, longitude)'])}${numbered.map(({ n, r, a }) => row([String(n), e(a.name), e(ROLE_LABEL[r.role]), `<span class="coords">${coords(a.points)}</span>`])).join('')}</table>`
    : '';
  const routes = roleRows.filter((r) => r.role === 'primary-route' || r.role === 'alternate-route');
  const routeStale = stale ? '<p class="muted">Route coverage omitted: the coverage run is out of date.</p>' : '';
  const routeTable = routes.length
    ? `<table>${head(['Route', 'Role', 'Length', 'Est. time (assumed speed)', 'Covered', 'Gaps', 'Unknown', 'Outside analysis', 'Road restrictions', 'Note'])}${routes
        .map((r) => {
          const a = byId.get(r.annotationId)!;
          const m = routeMetrics(a.points, r.mode);
          const c = stale ? undefined : routeCov.get(r.annotationId);
          return row([e(`${numberOf.get(r.annotationId)}. ${a.name}`), e(ROLE_LABEL[r.role]), e(formatMeters(m.lengthM)), e(m.minutes === null ? 'no mode chosen' : `${Math.round(m.minutes)} min ${r.mode === 'walk' ? 'walking' : 'driving'}`), pct(c?.covered), pct(c?.gap), pct(c?.unknown), pct(c?.outside), 'not available', e(r.note || '—')]);
        })
        .join('')}</table>${routeStale}<p class="muted">Coverage along a route is the share of its length in each modelled class from your observation points. It is an estimate, not a real-time measure of exposure.</p>`
    : '<p class="muted">No routes were marked in this plan.</p>';
  const others = roleRows.filter((r) => r.role !== 'primary-route' && r.role !== 'alternate-route');
  const zones = others.length
    ? `<table>${head(['Item', 'Role', 'Where', 'Note'])}${others
        .map((r) => {
          const a = byId.get(r.annotationId)!;
          const p = a.points[0];
          return row([e(`${numberOf.get(r.annotationId)}. ${a.name}`), e(ROLE_LABEL[r.role]), e(coord(p[1], p[0])), e(r.note || '—')]);
        })
        .join('')}</table><p class="muted">Exits, assembly points and zones are user-supplied.</p>`
    : '<p class="muted">No zones or markers were marked.</p>';

  const buildings = plan.buildings.length
    ? `<table>${head(['Building', 'Address', 'Use', 'Height', 'Floors', 'Match', 'Source (OSM, last edited)'])}${plan.buildings
        .map((b) =>
          row([
            e(b.name ?? b.buildingType ?? 'building'),
            e(b.address ?? 'not mapped'),
            e(b.use ?? 'not mapped'),
            e(b.height ? `${b.height.value} m (${b.height.source === 'reported' ? 'reported' : 'estimated from floors'})` : 'not mapped'),
            e(b.levels === null ? 'not mapped' : String(b.levels)),
            e(b.match === 'inside' ? 'point inside footprint' : b.match === 'bounds' ? `bounding box only (${Math.round(b.distanceM)} m), footprint not available` : `nearest, ${Math.round(b.distanceM)} m away`),
            `${e(`https://www.openstreetmap.org/${b.osmType}/${b.osmId}`)} · ${e(fmtTime(b.lastEditedAt))}`,
          ]),
        )
        .join('')}</table><p class="muted">Ownership and property records: not available. Interiors and occupants: not known.</p>`
    : '<p class="muted">No buildings were inspected.</p>';

  const fac = plan.facilities;
  const facilities = fac
    ? fac.items.length
      ? `<table>${head(['Facility', 'Type', 'Position'])}${fac.items.map((f) => row([e(f.name ?? 'unnamed'), e(FACILITY_LABEL[f.kind] + (f.emergency ? ' · emergency department (mapped)' : '')), e(coord(f.lat, f.lon))])).join('')}</table><p class="muted">From OpenStreetMap within ${e(formatMeters(fac.radiusM))}, fetched ${e(fmtTime(fac.fetchedAt))}${fac.truncated ? ' (list truncated)' : ''}. Missing entries do not mean a facility does not exist.</p>`
      : `<p class="muted">None mapped in OpenStreetMap within ${e(formatMeters(fac.radiusM))} (fetched ${e(fmtTime(fac.fetchedAt))}). This is a gap in mapped data, not proof that none exist.</p>`
    : '<p class="muted">Emergency facilities were not looked up.</p>';

  const floorPlans = plan.floorPlans.length
    ? plan.floorPlans
        .map((f) => {
          const unconfirmed = (['scale', 'orientation', 'floor'] as const).filter((k) => !f.confirmed[k]);
          return `<div class="fp"><img src="${e(f.image)}" alt="${e(f.name)}"><p><strong>${e(f.name)}</strong> · centre ${e(coord(f.lat, f.lon))} · level ${e(String(f.level))}, ${e(String(f.elevationM))} m above ground · ${e(`${Math.round(f.widthM)} × ${Math.round(f.heightM)} m`)}, rotated ${e(String(f.rotationDeg))}° · user-supplied${unconfirmed.length ? ` · <strong>not confirmed: ${e(unconfirmed.join(', '))}</strong>` : ' · scale, orientation and floor confirmed by the user'}</p></div>`;
        })
        .join('')
    : '<p class="muted">No floor plans were added.</p>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(plan.name)}</title><style>
body{font:13px/1.45 system-ui,Segoe UI,sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:3px;margin-top:22px}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f3f5}
.muted{color:#555}.cov{width:480px;max-width:100%;border:1px solid #999}.k{display:inline-block;width:10px;height:10px;border:1px solid #777;margin:0 3px}
.c1{background:#56b4e9}.c2{background:#0072b2}.gap{background:#e69f00}.unk{background:repeating-linear-gradient(45deg,#aaa 0 2px,#fff 2px 4px)}
.fp img{max-width:320px;border:1px solid #999}.coords{font-size:11px;word-break:break-all}.warn{background:#fff7e0;border:1px solid #e0c060;padding:8px;margin:8px 0}
</style></head><body>
<h1>${e(plan.name)}</h1>
<p class="muted">Site: ${e(plan.site.name)} (${e(coord(plan.site.lat, plan.site.lon))}) · plan updated ${e(fmtTime(plan.updatedAt))} · briefing generated ${e(fmtTime(o.generatedAt.toISOString()))} · Sky_View ${e(o.appVersion)}</p>
<div class="warn"><strong>Planning estimate.</strong> Modelled coverage, travel times and route shares come from available map data and stated assumptions. They are not real-time information, not proof of a threat and not a guarantee of safety. Unknown means no data, not no risk.</div>
${section('Observation points and cameras', observers)}
${section('Modelled coverage', coverage)}
${diagram ? section('Site diagram', diagram) : ''}
${section('Rooftops with a line of sight to the subject', rooftops)}
${section('Routes', routeTable)}
${routeStudy ? section('Route options considered', routeStudy) : ''}
${section('Zones, exits and markers', zones)}
${geometryList ? section('Geometry of routes, zones and markers', geometryList) : ''}
${section('Buildings inspected', buildings)}
${section('Emergency facilities', facilities)}
${section('Floor plans', floorPlans)}
${section('Notes', plan.notes ? `<p>${e(plan.notes).replace(/\n/g, '<br>')}</p>` : '<p class="muted">No notes.</p>')}
${section('Data sources', `<ul>${Object.values(SOURCES).map((s) => `<li>${e(s)}</li>`).join('')}</ul>`)}
${section('Limitations', `<ul>${LIMITATIONS.map((s) => `<li>${e(s)}</li>`).join('')}</ul>${plan.limitationsAcknowledged ? '<p>The plan author acknowledged these limitations.</p>' : '<p><strong>The plan author has not acknowledged these limitations.</strong></p>'}`)}
</body></html>`;
}
