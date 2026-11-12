import { Cartesian2, Cartesian3, Color, ConstantPositionProperty, DistanceDisplayCondition, Entity, HorizontalOrigin, LabelStyle, PolygonHierarchy, VerticalOrigin } from 'cesium';
import type { GeoRecord } from '../../shared/layers';
import { sanitizePolygonGeometry } from '../../shared/geo';

/** Every supplied part remains pickable as the same original wildfire record. */
export function perimeterPolygonEntities(record: GeoRecord, selected: boolean): Entity[] {
  const geometry = record.geometry;
  if (!geometry || geometry.type === 'LineString') return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const color = Color.fromCssColorString('#ff6b3d');
  const ring = (positions: number[][]) => Cartesian3.fromDegreesArray(positions.flatMap(([lon, lat]) => [lon, lat]));
  const parts: Entity[] = [];
  polygons.forEach((coordinates, part) => {
    // Upstream validates GeoJSON. Guard each part here too: an invalid hole
    // must not be silently filled, or prevent other valid parts from drawing.
    if (!sanitizePolygonGeometry({ type: 'Polygon', coordinates })) return;
    const [outer, ...holes] = coordinates;
    parts.push(new Entity({
      id: `perimeter|${record.id}|${part}`,
      position: new ConstantPositionProperty(Cartesian3.fromDegrees(record.lon, record.lat, 0)),
      polygon: {
        hierarchy: new PolygonHierarchy(ring(outer), holes.map(hole => new PolygonHierarchy(ring(hole)))),
        material: color.withAlpha(selected ? 0.35 : 0.22), outline: true,
        outlineColor: selected ? Color.WHITE : color, height: 0,
      },
      // Preserve one label at the adapter's existing center, not one per part.
      label: parts.length ? undefined : {
        text: record.label, font: '500 11px "Segoe UI", sans-serif', fillColor: Color.WHITE,
        outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, 0),
        distanceDisplayCondition: new DistanceDisplayCondition(0, selected ? 5e7 : 1.5e6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  });
  return parts;
}

export function perimeterPickId(entityId: string): string | null {
  if (!entityId.startsWith('perimeter|')) return null;
  const last = entityId.lastIndexOf('|');
  return last > 10 && /^\d+$/.test(entityId.slice(last + 1)) ? entityId.slice(10, last) : null;
}
