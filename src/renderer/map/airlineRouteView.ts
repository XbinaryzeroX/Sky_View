import { Cartographic, Math as CMath, Rectangle } from 'cesium';
import { Geodesic } from 'geographiclib-geodesic';
import { routeMapSegments, type RouteInfo } from '../../shared/route';

/** Fit the curved airport-to-airport legs, including their latitude extremes and date-line crossings. */
export function airlineRouteBounds(route: RouteInfo): Rectangle | null {
  const extent: Cartographic[] = [];
  for (const segment of routeMapSegments(route)) {
    for (let i = 0; i < segment.length; i++) {
      const [lon, lat] = segment[i];
      extent.push(Cartographic.fromDegrees(lon, lat));
      if (i === 0) continue;
      const [prevLon, prevLat] = segment[i - 1];
      const line = Geodesic.WGS84.InverseLine(prevLat, prevLon, lat, lon);
      const steps = Math.ceil(line.s13 / 400000);
      for (let j = 1; j < steps; j++) {
        const p = line.Position(line.s13 * j / steps);
        if (p.lon2 !== undefined && p.lat2 !== undefined) extent.push(Cartographic.fromDegrees(p.lon2, p.lat2));
      }
    }
  }
  if (!extent.length) return null;
  const box = Rectangle.fromCartographicArray(extent);
  const marginX = Math.max(CMath.toRadians(0.15), box.width * 0.25);
  const marginY = Math.max(CMath.toRadians(0.15), box.height * 0.18);
  const allLongitudes = box.width + 2 * marginX >= CMath.TWO_PI;
  return new Rectangle(
    allLongitudes ? -Math.PI : CMath.negativePiToPi(box.west - marginX),
    Math.max(-CMath.PI_OVER_TWO, box.south - marginY),
    allLongitudes ? Math.PI : CMath.negativePiToPi(box.east + marginX),
    Math.min(CMath.PI_OVER_TWO, box.north + marginY),
  );
}
