import { Cartesian3, Color, Entity, PolygonHierarchy } from 'cesium';
import type { GeoRecord, LayerSnapshot } from '../../shared/layers';
import { SEVERITY_META } from '../lib/format';
import type { AlertSeverity } from '../../shared/types';

/** Each supplied polygon is pickable under its publisher warning's same ID. */
export function warningPolygonEntities(record: GeoRecord, selected: boolean): Entity[] {
  const geometry = record.geometry;
  if (!geometry || geometry.type === 'LineString') return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const severity = record.category && record.category in SEVERITY_META ? record.category as AlertSeverity : 'Unknown';
  const color = Color.fromCssColorString(SEVERITY_META[severity].color);
  const ring = (positions: number[][]) => Cartesian3.fromDegreesArray(positions.flatMap(([lon, lat]) => [lon, lat]));
  return polygons.map(([outer, ...holes], part) => new Entity({
    id: `dwd|${record.id}|${part}`,
    polygon: {
      hierarchy: new PolygonHierarchy(ring(outer), holes.map(hole => new PolygonHierarchy(ring(hole)))),
      material: color.withAlpha(selected ? 0.4 : 0.22), outline: true,
      outlineColor: selected ? Color.WHITE : color, height: 0,
    },
  }));
}

export function warningPickId(entityId: string): string | null {
  if (!entityId.startsWith('dwd|')) return null;
  const last = entityId.lastIndexOf('|');
  return last > 4 && /^\d+$/.test(entityId.slice(last + 1)) ? entityId.slice(4, last) : null;
}

/** A known expiry can hide a retained shape; missing expiry never invents one. */
export function warningMapRecords(snapshot: LayerSnapshot, at = Date.now()): GeoRecord[] {
  const retained = new Set(snapshot.dwdWarnings?.filter(warning => !warning.expires || Date.parse(warning.expires) > at).map(warning => warning.id));
  return snapshot.records.filter(record => !!record.geometry && retained.has(record.id));
}
