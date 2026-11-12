// Deliberately bounded subset of RFC 7946 for the existing flat annotation model.
// https://www.rfc-editor.org/rfc/rfc7946 — positions, rings, CRS and Features.
import { pathLengthKm, polygonAreaKm2 } from './geo';

export const GEOJSON_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_STORED_ANNOTATIONS = 2000;
export const GEOJSON_MAX_FEATURES = MAX_STORED_ANNOTATIONS;
export const GEOJSON_MAX_POINTS = 5000;
export const GEOJSON_MAX_TOTAL_POINTS = 20_000;

export interface AnnotationDocument {
  id: string;
  kind: 'pin' | 'line' | 'area';
  name: string;
  color: string;
  points: [number, number][];
  visible: boolean;
  createdAt: string;
}
export type AnnotationInput = Omit<AnnotationDocument, 'id' | 'createdAt'>;
export interface GeoJsonIssue { feature: number; message: string }
export interface GeoJsonPreview {
  candidates: AnnotationInput[];
  rejected: GeoJsonIssue[];
  duplicates: number;
  featureCount: number;
  coordinateCount: number;
}
export interface GeoJsonFilePreview { text: string; preview: GeoJsonPreview }
export interface GeoJsonImportResult extends Omit<GeoJsonPreview, 'candidates'> {
  imported: number;
  annotations: AnnotationDocument[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function noCrs(value: Record<string, unknown>): void {
  if (Object.hasOwn(value, 'crs')) throw new Error('CRS declarations are unsupported. Export WGS84 longitude/latitude GeoJSON without a crs member.');
}
export function assertGeoJsonText(text: string): void {
  if (typeof text !== 'string' || text.length > GEOJSON_MAX_BYTES || new TextEncoder().encode(text).byteLength > GEOJSON_MAX_BYTES)
    throw new Error('GeoJSON is larger than 2 MiB.');
}
function point(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2)
    throw new Error('Only two-dimensional [longitude, latitude] positions are supported; altitude and extra dimensions are not imported.');
  const [lon, lat] = value;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180 || typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90)
    throw new Error('Coordinates must be finite WGS84 longitude (-180…180), latitude (-90…90) numbers, in that order.');
  return [lon === 0 ? 0 : lon, lat === 0 ? 0 : lat];
}
function equal(a: [number, number], b: [number, number]): boolean { return a[0] === b[0] && a[1] === b[1]; }
function positions(value: unknown, minimum: number): [number, number][] {
  if (!Array.isArray(value) || value.length < minimum) throw new Error(`Geometry requires at least ${minimum} positions.`);
  if (value.length > GEOJSON_MAX_POINTS) throw new Error(`Geometry exceeds ${GEOJSON_MAX_POINTS.toLocaleString()} positions.`);
  return value.map(point);
}
function openRing(points: [number, number][]): [number, number][] {
  return points.length > 1 && equal(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
}
function distinct(points: [number, number][]): number { return new Set(points.map(p => JSON.stringify(p))).size; }

export interface AnnotationAreaValidationBudget { remaining: number }
/** Short longitude edges, shared by annotation validation and local area-watch matching. */
export function unwrapAnnotationRing(points: [number, number][]): [number, number][] {
  const unwrapped: [number, number][] = [];
  for (const [original, lat] of points) {
    let lon = original;
    const previous = unwrapped.at(-1)?.[0];
    if (previous !== undefined) { while (lon - previous > 180) lon -= 360; while (lon - previous < -180) lon += 360; }
    unwrapped.push([lon, lat]);
  }
  return unwrapped;
}
function signedArea(points: [number, number][]): number {
  const unwrapped = unwrapAnnotationRing(points), [x, y] = unwrapped[0];
  return unwrapped.reduce((sum, a, i) => { const b = unwrapped[(i + 1) % unwrapped.length]; return sum + (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y); }, 0);
}
function counterClockwise(points: [number, number][]): [number, number][] {
  return signedArea(points) < 0 ? [points[0], ...points.slice(1).reverse()] : points;
}
/** Simple-ring sweep with a hard comparison budget for adversarial overlapping edges. */
function validateArea(points: [number, number][], budget: AnnotationAreaValidationBudget): void {
  if (distinct(points) !== points.length) throw new Error('Polygon exterior repeats a vertex or edge; only simple rings are supported.');
  if (!(polygonAreaKm2(points).areaKm2 > 0) || signedArea(points) === 0) throw new Error('Polygon exterior has zero area.');
  // Match the existing annotation renderer's short date-line edges without changing stored coordinates.
  const unwrapped = unwrapAnnotationRing(points);
  if (distinct(unwrapped) !== unwrapped.length) throw new Error('Polygon exterior repeats an equivalent date-line vertex.');
  if (Math.abs(unwrapped.at(-1)![0] - unwrapped[0][0]) > 180)
    throw new Error('Rings wrapping a pole or the globe are unsupported; split them into simple polygons.');
  const segments = unwrapped.map((a, i) => {
    const b = unwrapped[(i + 1) % unwrapped.length];
    return { a, b, i, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) };
  }).sort((a, b) => a.minX - b.minX);
  const cross = (a: [number, number], b: [number, number], p: [number, number]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  let active: typeof segments = [];
  for (const segment of segments) {
    active = active.filter(other => other.maxX >= segment.minX);
    for (const other of active) {
      if (Math.abs(other.i - segment.i) === 1 || Math.abs(other.i - segment.i) === points.length - 1) continue;
      if (--budget.remaining < 0) throw new Error('Polygon complexity exceeds the bounded intersection check; simplify the ring and try again.');
      if (other.maxY < segment.minY || segment.maxY < other.minY) continue;
      const p = cross(segment.a, segment.b, other.a), q = cross(segment.a, segment.b, other.b);
      const r = cross(other.a, other.b, segment.a), s = cross(other.a, other.b, segment.b);
      if ((p === 0 || q === 0 || Math.sign(p) !== Math.sign(q)) && (r === 0 || s === 0 || Math.sign(r) !== Math.sign(s)))
        throw new Error('Self-intersecting or touching Polygon exterior is unsupported; provide a simple ring.');
    }
    active.push(segment);
  }
}

/** Validate existing flat area points with the same bounded rules as GeoJSON imports/exports. */
export function annotationAreaPoints(value: unknown, budget: AnnotationAreaValidationBudget = { remaining: 1_000_000 }): [number, number][] {
  const points = openRing(positions(value, 3));
  if (distinct(points) < 3) throw new Error('A Polygon requires at least three distinct exterior positions.');
  validateArea(points, budget);
  return points;
}

/** Exact coordinate/name match; ring closure and winding direction are immaterial. */
export function annotationGeometryKey(a: AnnotationInput): string {
  return JSON.stringify([a.kind, a.name, a.kind === 'area' ? counterClockwise(openRing(a.points)) : a.points]);
}

function geometry(value: unknown, budget: AnnotationAreaValidationBudget): { kind: AnnotationDocument['kind']; points: [number, number][]; coordinateCount: number } {
  const g = object(value);
  if (!g) throw new Error('Missing or null geometry is unsupported.');
  noCrs(g);
  switch (g.type) {
    case 'Point': return { kind: 'pin', points: [point(g.coordinates)], coordinateCount: 1 };
    case 'LineString': {
      const points = positions(g.coordinates, 2);
      if (distinct(points) < 2 || !(pathLengthKm(points) > 0)) throw new Error('A line requires at least two geographically distinct positions and nonzero length.');
      return { kind: 'line', points, coordinateCount: points.length };
    }
    case 'Polygon': {
      if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) throw new Error('A Polygon requires one closed exterior ring.');
      if (g.coordinates.length !== 1) throw new Error('Polygon holes are unsupported by annotations; the feature was skipped without flattening its holes.');
      const ring = positions(g.coordinates[0], 4);
      if (!equal(ring[0], ring[ring.length - 1])) throw new Error('Polygon rings must be closed with identical first and last positions.');
      const points = annotationAreaPoints(ring, budget);
      return { kind: 'area', points, coordinateCount: ring.length };
    }
    default: throw new Error('Unsupported geometry. Only Point, LineString and Polygon with one exterior ring are supported; Multi geometries and GeometryCollection are not split or flattened.');
  }
}

/** Main and preview use the same parser. Only whitelisted annotation properties survive. */
export function previewGeoJsonAnnotations(text: string, existing: readonly AnnotationInput[] = []): GeoJsonPreview {
  assertGeoJsonText(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('The file is not valid GeoJSON JSON.'); }
  const root = object(parsed);
  if (!root) throw new Error('Expected a GeoJSON FeatureCollection, Feature or supported geometry.');
  noCrs(root);
  const collection = root.type === 'FeatureCollection';
  let entries: unknown[];
  if (collection) {
    if (!Array.isArray(root.features)) throw new Error('FeatureCollection.features must be an array.');
    entries = root.features;
  } else entries = [root];
  if (entries.length > GEOJSON_MAX_FEATURES) throw new Error(`At most ${GEOJSON_MAX_FEATURES} features can be imported at once.`);
  const seen = new Set(existing.map(annotationGeometryKey));
  const budget = { remaining: 1_000_000 };
  const result: GeoJsonPreview = { candidates: [], rejected: [], duplicates: 0, featureCount: entries.length, coordinateCount: 0 };
  for (let i = 0; i < entries.length; i++) {
    let candidate: AnnotationInput;
    let count = 0;
    try {
      const entry = object(entries[i]);
      if (!entry) throw new Error('A feature must be an object.');
      if (collection && entry.type !== 'Feature') throw new Error('FeatureCollection entries must be Feature objects, not bare geometries.');
      noCrs(entry);
      const feature = entry.type === 'Feature';
      if (feature && entry.properties !== null && !object(entry.properties)) throw new Error('Feature.properties must be an object or null.');
      const props = feature ? object(entry.properties) : null;
      const g = geometry(feature ? entry.geometry : entry, budget);
      const rawName = props?.name;
      if (rawName !== undefined && (typeof rawName !== 'string' || !rawName.trim() || rawName.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(rawName)))
        throw new Error('Annotation name must be 1–120 characters without control characters.');
      if (props?.color !== undefined && (typeof props.color !== 'string' || !/^#[\da-f]{6}$/i.test(props.color)))
        throw new Error('Annotation color must be a six-digit hex color.');
      if (props?.visible !== undefined && typeof props.visible !== 'boolean') throw new Error('Annotation visible must be a boolean.');
      candidate = { kind: g.kind, points: g.points, name: typeof rawName === 'string' ? rawName.trim() : `Imported ${g.kind === 'pin' ? 'point' : g.kind} ${i + 1}`, color: typeof props?.color === 'string' ? props.color.toLowerCase() : '#ffd166', visible: typeof props?.visible === 'boolean' ? props.visible : true };
      count = g.coordinateCount;
    } catch (error) {
      result.rejected.push({ feature: i + 1, message: error instanceof Error ? error.message : 'Invalid feature.' });
      continue;
    }
    result.coordinateCount += count;
    if (result.coordinateCount > GEOJSON_MAX_TOTAL_POINTS) throw new Error(`The file exceeds ${GEOJSON_MAX_TOTAL_POINTS.toLocaleString()} supported positions in total.`);
    const key = annotationGeometryKey(candidate);
    if (seen.has(key)) result.duplicates++;
    else { seen.add(key); result.candidates.push(candidate); }
  }
  return result;
}

/** Export only existing annotation geometry/name/color/visibility, never generic stored fields. */
export function annotationsToGeoJson(annotations: readonly AnnotationInput[]): string {
  if (annotations.length > MAX_STORED_ANNOTATIONS) throw new Error('Too many stored annotations to export.');
  const budget = { remaining: 1_000_000 };
  let totalPoints = 0;
  const features = annotations.map(a => {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 120 || /[\u0000-\u001f\u007f]/.test(a.name) || !/^#[\da-f]{6}$/i.test(a.color) || typeof a.visible !== 'boolean')
      throw new Error('A stored annotation has invalid name, color or visibility. Correct it before exporting.');
    let g: { type: string; coordinates: unknown };
    let count = 0;
    if (a.kind === 'pin') {
      if (a.points.length !== 1) throw new Error('A pin must contain one position.');
      g = { type: 'Point', coordinates: point(a.points[0]) };
      count = 1;
    } else if (a.kind === 'line') {
      const line = positions(a.points, 2);
      if (distinct(line) < 2 || !(pathLengthKm(line) > 0)) throw new Error('A line requires two geographically distinct positions and nonzero length.');
      g = { type: 'LineString', coordinates: line };
      count = line.length;
    } else if (a.kind === 'area') {
      const ring = counterClockwise(annotationAreaPoints(a.points, budget));
      if (ring.length + 1 > GEOJSON_MAX_POINTS) throw new Error('An exported Polygon exceeds 5,000 positions including closure.');
      g = { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
      count = ring.length + 1;
    } else throw new Error('Unsupported stored annotation kind.');
    totalPoints += count;
    if (totalPoints > GEOJSON_MAX_TOTAL_POINTS) throw new Error('Stored annotations exceed the 20,000-position export limit; export was not written.');
    return { type: 'Feature', properties: { name: a.name, color: a.color, visible: a.visible }, geometry: g };
  });
  const text = JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
  assertGeoJsonText(text);
  return text;
}
