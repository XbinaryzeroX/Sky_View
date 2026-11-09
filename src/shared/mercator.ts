// Web Mercator helpers shared by terrain resampling and tests.

/** Latitude limit of Web Mercator tiles (degrees). */
export const MERCATOR_MAX_LAT = 85.0511287798066;

/** Global pixel position (256-px tiles) of a lon/lat at zoom z. */
export function mercatorPixel(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z * 256;
  const clamped = Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/**
 * Mercator source zoom whose pixel size matches a geographic terrain tile at
 * `level` (65 samples over 180/2^level degrees). A geographic tile has the
 * same longitude width as a Mercator tile one zoom deeper; Mercator pixels
 * shrink with cos(latitude), so fewer zoom levels are needed toward the poles.
 */
export function sourceZoomFor(level: number, latDeg: number): number {
  const c = Math.max(0.02, Math.cos((Math.min(89, Math.abs(latDeg)) * Math.PI) / 180));
  return Math.max(0, level + 1 + Math.round(Math.log2(c)));
}
