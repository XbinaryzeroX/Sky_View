// Local, feed-derived earthquake evidence; never an official warning or a hazard forecast.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Polygon } from 'geojson';
import { z } from 'zod';
import { isValidLat, isValidLon } from './geo';
import { annotationAreaPoints, unwrapAnnotationRing, type AnnotationAreaValidationBudget, type AnnotationDocument } from './geojsonAnnotations';
import type { Earthquake } from './types';

export const MAX_AREA_WATCH_RULES = 100;
export const MAX_AREA_WATCH_EVENTS = 500;
export const AREA_WATCH_MIN_MAGNITUDE = -2;
export const AREA_WATCH_MAX_MAGNITUDE = 11;
export const AREA_WATCH_DEFAULT_MIN_MAGNITUDE = 2.5;

const areaId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const magnitude = z.number().finite().min(AREA_WATCH_MIN_MAGNITUDE).max(AREA_WATCH_MAX_MAGNITUDE);
const time = z.string().datetime();
const boundedText = (maximum: number) => z.string().min(1).max(maximum).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are unsupported.');
export const areaWatchRuleInputSchema = z.object({ areaId, minMagnitude: magnitude, enabled: z.boolean() }).strict();
export type AreaWatchRuleInput = z.infer<typeof areaWatchRuleInputSchema>;
export const areaWatchRuleSchema = areaWatchRuleInputSchema.extend({ createdAt: time, updatedAt: time, armedAt: time }).strict();
export type AreaWatchRule = z.infer<typeof areaWatchRuleSchema>;

/** The normalizer's optional publisher link is checked again before retaining evidence. */
export const areaWatchSourceUrlSchema = z.string().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'earthquake.usgs.gov' && url.port === '' && url.username === '' && url.password === '';
  } catch { return false; }
}, 'Expected a publisher-provided HTTPS earthquake.usgs.gov URL.').nullable();
export const areaWatchEventSchema = z.object({
  id: boundedText(320),
  areaId,
  areaName: boundedText(120),
  quakeId: boundedText(160),
  quakeTime: time,
  magnitude,
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  minMagnitude: magnitude,
  detectedAt: time,
  url: areaWatchSourceUrlSchema,
  read: z.boolean(),
}).strict();
export type AreaWatchEvent = z.infer<typeof areaWatchEventSchema>;
export interface AreaWatchState {
  rules: AreaWatchRule[];
  events: AreaWatchEvent[];
  /** Last completed local evaluation, independent of provider fetch success. */
  lastEvaluatedAt: string | null;
  error: string | null;
}

export interface CompiledAreaWatch {
  readonly areaId: string;
  readonly areaName: string;
  readonly minMagnitude: number;
  readonly enabled: boolean;
  readonly vertexCount: number;
  /** [min longitude, min latitude, max longitude, max latitude] in the unwrapped frame. */
  readonly bbox: readonly [number, number, number, number];
  /** A copied closed ring; compile once per rule/geometry revision, not once per quake. */
  readonly geometry: Polygon;
}

/**
 * Reuses the exact bounded simple-ring annotation validator. Flat [longitude, latitude]
 * edges are unwrapped by the shorter date-line direction; they are not geodesic arcs.
 * Holes, Multi geometries, altitude, self-intersection, zero area, pole/globe wraps and
 * vertices at a pole are unsupported. Drawing visibility does not disable a watch rule.
 * Optional shared comparison budget bounds compilation of a batch of changed rules.
 */
export function compileAreaWatch(annotation: AnnotationDocument, input: AreaWatchRuleInput, budget?: AnnotationAreaValidationBudget): CompiledAreaWatch {
  // Persisted rules also carry timestamps; keep IPC input strict while compiling only rule inputs.
  const rule = areaWatchRuleInputSchema.parse({ areaId: input.areaId, minMagnitude: input.minMagnitude, enabled: input.enabled });
  if (!annotation || annotation.kind !== 'area') throw new Error('An area watch requires an existing area annotation.');
  if (annotation.id !== rule.areaId) throw new Error('Area watch rule does not match the annotation ID.');
  const name = boundedText(120).parse(annotation.name);
  const points = annotationAreaPoints(annotation.points, budget);
  if (points.some(([, lat]) => Math.abs(lat) === 90)) throw new Error('Watch areas touching a pole are unsupported; use an area away from the poles.');
  const ring = unwrapAnnotationRing(points);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  if (maxLon - minLon >= 360) throw new Error('A watch area cannot span a full longitude revolution; split it into smaller simple areas.');
  // Freeze copies so later editing the annotation cannot silently change a compiled watch.
  ring.push([...ring[0]]);
  ring.forEach(point => Object.freeze(point));
  Object.freeze(ring);
  const geometry: Polygon = { type: 'Polygon', coordinates: [ring] };
  Object.freeze(geometry.coordinates); Object.freeze(geometry);
  return Object.freeze({ areaId: rule.areaId, areaName: name, minMagnitude: rule.minMagnitude, enabled: rule.enabled, vertexCount: points.length, bbox: Object.freeze([minLon, minLat, maxLon, maxLat] as const), geometry });
}

/** Boundary is included, including equivalent +180/-180 positions. No spatial tolerance. */
export function areaWatchContains(area: CompiledAreaWatch, lat: number, lon: number): boolean {
  if (!isValidLat(lat) || !isValidLon(lon)) return false;
  const [minLon, minLat, maxLon, maxLat] = area.bbox;
  if (lat < minLat || lat > maxLat) return false;
  const unwrappedLon = lon + 360 * Math.round(((minLon + maxLon) / 2 - lon) / 360);
  if (unwrappedLon < minLon || unwrappedLon > maxLon) return false;
  return booleanPointInPolygon([unwrappedLon, lat], area.geometry, { ignoreBoundary: false });
}

/** Occurrence time, event type, activation baseline and persistent dedupe are main's job. */
export function areaWatchMatchesQuake(area: CompiledAreaWatch, quake: Pick<Earthquake, 'lat' | 'lon' | 'mag'>): boolean {
  return area.enabled && typeof quake.mag === 'number' && Number.isFinite(quake.mag) && quake.mag >= AREA_WATCH_MIN_MAGNITUDE && quake.mag <= AREA_WATCH_MAX_MAGNITUDE && quake.mag >= area.minMagnitude && areaWatchContains(area, quake.lat, quake.lon);
}
