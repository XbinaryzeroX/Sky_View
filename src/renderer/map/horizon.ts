import { Cartesian3, Cartographic, Ellipsoid } from 'cesium';

const scratchCarto = new Cartographic();
const scratchPoint = new Cartesian3();

/**
 * Point to use for the far-side-of-the-earth test. Vehicles on Google 3D tiles can sit below the WGS84 ellipsoid
 * (local sea level is up to ~107 m under it, e.g. −33 m at New York), and Cesium's ellipsoid occluder treats such
 * points as hidden from every angle; they are tested at the ellipsoid surface instead (drawing is unchanged).
 * Returns `p` itself when it is at or above the surface; otherwise a shared scratch point (use it immediately).
 */
export function horizonPoint(p: Cartesian3): Cartesian3 {
  const c = Ellipsoid.WGS84.cartesianToCartographic(p, scratchCarto);
  if (!c || c.height >= 1) return p;
  return Cartesian3.fromRadians(c.longitude, c.latitude, 1, Ellipsoid.WGS84, scratchPoint);
}
