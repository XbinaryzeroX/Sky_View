// WGS84 longitude/latitude to UTM easting/northing (Transverse Mercator, Krüger series to the third order of n).
// Accurate to well under a millimetre inside a zone, far below a 10 m Sentinel-2 pixel. Formulas: Karney (2011),
// "Transverse Mercator with an accuracy of a few nanometres", J. Geodesy 85, eqs. 7–9, 35.

const A_WGS84 = 6378137;
const F_WGS84 = 1 / 298.257223563;
const K0 = 0.9996;
const N = F_WGS84 / (2 - F_WGS84);
const A_RECT = (A_WGS84 / (1 + N)) * (1 + (N * N) / 4 + (N ** 4) / 64);
const ALPHA = [N / 2 - (2 * N * N) / 3 + (5 * N ** 3) / 16, (13 * N * N) / 48 - (3 * N ** 3) / 5, (61 * N ** 3) / 240];
const E2N = (2 * Math.sqrt(N)) / (1 + N);

export interface UtmZone {
  zone: number;
  south: boolean;
}

/** EPSG:326xx (north) and EPSG:327xx (south) are WGS84 UTM zones. */
export function utmZoneFromEpsg(epsg: number): UtmZone | null {
  if (!Number.isInteger(epsg)) return null;
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

/** Easting and northing in metres for a point, in the given zone (the point may lie outside the zone). */
export function toUtm(lon: number, lat: number, z: UtmZone): [number, number] {
  const phi = (lat * Math.PI) / 180;
  let dl = lon - (z.zone * 6 - 183);
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  const lam = (dl * Math.PI) / 180;
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - E2N * Math.atanh(E2N * s));
  const xi = Math.atan2(t, Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let e = eta, n = xi;
  for (let j = 1; j <= 3; j++) {
    e += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    n += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [500_000 + K0 * A_RECT * e, (z.south ? 10_000_000 : 0) + K0 * A_RECT * n];
}
