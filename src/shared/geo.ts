// Spatial helpers. Distances use Karney's geodesic algorithms on the WGS84
// ellipsoid (geographiclib). Point-in-polygon follows GeoJSON semantics
// (planar longitude/latitude) via Turf, with antimeridian handling.

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { Geodesic } from 'geographiclib-geodesic';
import type { MultiPolygon, Polygon, Position } from 'geojson';

const WGS84 = Geodesic.WGS84;

/** Geodesic distance between two points in kilometres (WGS84). */
export function geodesicDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = WGS84.Inverse(lat1, lon1, lat2, lon2);
  return (r.s12 ?? NaN) / 1000;
}

export function isValidLat(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}

export function isValidLon(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

function isPosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && isValidLon(p[0]) && isValidLat(p[1]);
}

function isRing(r: unknown): r is Position[] {
  return Array.isArray(r) && r.length >= 4 && r.every(isPosition);
}

/** Validates a GeoJSON Polygon/MultiPolygon. Returns null if invalid or unsupported. */
export function sanitizePolygonGeometry(g: unknown): Polygon | MultiPolygon | null {
  if (!g || typeof g !== 'object') return null;
  const geom = g as { type?: unknown; coordinates?: unknown };
  if (geom.type === 'Polygon') {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length > 0 && c.every(isRing)) {
      return { type: 'Polygon', coordinates: c as Position[][] };
    }
    return null;
  }
  if (geom.type === 'MultiPolygon') {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length > 0 && c.every((poly) => Array.isArray(poly) && poly.length > 0 && poly.every(isRing))) {
      return { type: 'MultiPolygon', coordinates: c as Position[][][] };
    }
    return null;
  }
  return null;
}

function polygonsOf(g: Polygon | MultiPolygon): Position[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

/** Bounding box [minLon, minLat, maxLon, maxLat]. Longitudes may exceed 180 for antimeridian polygons. */
export function geometryBbox(g: Polygon | MultiPolygon): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polygonsOf(normalizeAntimeridian(g))) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** True when the polygon spans more than 180° of longitude, which indicates it crosses the antimeridian. */
export function crossesAntimeridian(g: Polygon | MultiPolygon): boolean {
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (const [lon] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  return maxLon - minLon > 180;
}

/** Shifts negative longitudes by +360 for polygons that cross the antimeridian (e.g. the Aleutians). */
export function normalizeAntimeridian<T extends Polygon | MultiPolygon>(g: T): T {
  if (!crossesAntimeridian(g)) return g;
  const shift = (ring: Position[]) => ring.map(([lon, lat, ...rest]) => [lon < 0 ? lon + 360 : lon, lat, ...rest]);
  if (g.type === 'Polygon') {
    return { type: 'Polygon', coordinates: g.coordinates.map(shift) } as T;
  }
  return { type: 'MultiPolygon', coordinates: (g as MultiPolygon).coordinates.map((p) => p.map(shift)) } as T;
}

/**
 * Point-in-polygon test. Points on the boundary count as inside.
 * Handles polygons crossing the antimeridian.
 */
export function pointInGeometry(lat: number, lon: number, g: Polygon | MultiPolygon, bbox?: [number, number, number, number] | null): boolean {
  const crosses = crossesAntimeridian(g);
  const geom = crosses ? normalizeAntimeridian(g) : g;
  const testLon = crosses && lon < 0 ? lon + 360 : lon;
  const box = bbox ?? geometryBbox(g);
  if (lat < box[1] || lat > box[3]) return false;
  // The exact date-line boundary has two valid WGS84 spellings. A polygon
  // touching that boundary need not cross it, so normalization alone is insufficient.
  const longitudes = !crosses && Math.abs(lon) === 180 ? [testLon, -testLon] : [testLon];
  return longitudes.some(value => value >= box[0] && value <= box[2] && booleanPointInPolygon([value, lat], geom));
}

/** Total geodesic length of a path of [lon, lat] points, in km. */
export function pathLengthKm(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += geodesicDistanceKm(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]);
  return total;
}

/** Geodesic area (km²) and perimeter (km) of a polygon of [lon, lat] points on the WGS84 ellipsoid. */
export function polygonAreaKm2(points: [number, number][]): { areaKm2: number; perimeterKm: number } {
  if (points.length < 3) return { areaKm2: 0, perimeterKm: 0 };
  const poly = WGS84.Polygon(false);
  for (const [lon, lat] of points) poly.AddPoint(lat, lon);
  const r = poly.Compute(false, true);
  return { areaKm2: Math.abs(r.area ?? 0) / 1e6, perimeterKm: (r.perimeter ?? 0) / 1000 };
}

/**
 * Parses typed coordinates: "39.7392, -104.9903", "39.7392 -104.9903", or a
 * WGS84 geo: URI (RFC 5870). Altitude/uncertainty are validated, but this
 * horizontal navigation helper returns latitude/longitude only. Unknown CRS
 * values are never reinterpreted as WGS84. Returns null for invalid input.
 */
export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  if (/^geo:/i.test(s)) {
    const [coordinates, ...parameters] = s.slice(4).split(';');
    m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(-?\d+(?:\.\d+)?))?$/.exec(coordinates);
    if (!m || (m[3] !== undefined && !Number.isFinite(Number(m[3])))) return null;
    let crs = false, uncertainty = false, extensions = false;
    for (let at = 0; at < parameters.length; at++) {
      const parameter = /^([a-z\d-]+)(?:=((?:[a-z\d\-_.!~*'()\[\]:&+$]|%[a-f\d]{2})+))?$/i.exec(parameters[at]);
      if (!parameter) return null;
      const name = parameter[1].toLowerCase(), value = parameter[2];
      if (name === 'crs') {
        if (crs || at !== 0 || value?.toLowerCase() !== 'wgs84') return null;
        crs = true;
      } else if (name === 'u') {
        if (uncertainty || extensions || value === undefined || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) return null;
        uncertainty = true;
      } else extensions = true;
    }
  } else {
    // Decimal pairs permit ordinary pasted Unicode minus signs. Do not apply
    // URI suffix/CRS rules or infer decimal-comma conventions for plain text.
    const decimal = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
    m = new RegExp(`^(${decimal})(?:\\s*,\\s*|\\s+)(${decimal})$`).exec(s.replace(/\u2212/g, '-'));
  }
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return isValidLat(lat) && isValidLon(lon) ? { lat, lon } : null;
}
