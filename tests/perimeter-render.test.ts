import { Cartographic, Color, DataSourceCollection, Event, JulianDate, Math as CMath, type CesiumWidget, type Entity } from 'cesium';
import { describe, expect, it } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { perimeterPickId, perimeterPolygonEntities } from '../src/renderer/map/perimeterGeometry';
import type { GeoRecord } from '../src/shared/layers';

// Deliberately synthetic islands and a hole; no demonstration provider records.
const perimeter = (id = 'fixture|original-fire'): GeoRecord => ({
  id, label: 'Synthetic multipart perimeter', lat: 39.5, lon: -120.5,
  altM: null, heading: null, speedKts: null, category: 'Wildfire perimeter',
  observedAt: '2026-11-11T12:00:00.000Z', source: 'Synthetic test fixture', sourceUrl: null, props: {},
  geometry: { type: 'MultiPolygon', coordinates: [
    [
      [[-121, 39], [-120, 39], [-120, 40], [-121, 40], [-121, 39]],
      [[-120.8, 39.2], [-120.8, 39.4], [-120.6, 39.4], [-120.6, 39.2], [-120.8, 39.2]],
    ],
    [[[-118, 37], [-117, 37], [-117, 38], [-118, 38], [-118, 37]]],
  ] },
});
const at = JulianDate.fromIso8601('2026-11-11T12:00:00.000Z');
const hierarchy = (entity: Entity) => entity.polygon!.hierarchy!.getValue(at);
const coordinate = (position: Parameters<typeof Cartographic.fromCartesian>[0]) => {
  const point = Cartographic.fromCartesian(position);
  return [CMath.toDegrees(point.longitude), CMath.toDegrees(point.latitude)];
};
function harness() {
  const dataSources = new DataSourceCollection();
  const widget = { dataSources, camera: { positionCartographic: { height: 100_000 } },
    scene: { preRender: new Event(), morphComplete: new Event(), requestRender() {} } };
  const renderer = new LayerRenderer(widget as unknown as CesiumWidget);
  return { renderer, dataSources };
}
const opts = { selectedLayer: null, selectedId: null, trackedId: null };

describe('wildfire perimeter supplied geometry', () => {
  it('draws every polygon and hole under the original record ID, with one existing center label and unchanged styling', () => {
    const record = perimeter(), parts = perimeterPolygonEntities(record, false);
    expect(parts).toHaveLength(2);
    expect(parts.map(part => perimeterPickId(part.id))).toEqual([record.id, record.id]);
    expect(hierarchy(parts[0]).holes).toHaveLength(1);
    expect(hierarchy(parts[1]).holes).toHaveLength(0);
    expect(coordinate(hierarchy(parts[0]).positions[0])[0]).toBeCloseTo(-121, 9);
    expect(coordinate(hierarchy(parts[0]).holes[0].positions[0])[1]).toBeCloseTo(39.2, 9);
    expect(coordinate(hierarchy(parts[1]).positions[0])[0]).toBeCloseTo(-118, 9);
    expect(parts.filter(part => part.label)).toHaveLength(1);
    expect(parts[0].label!.text!.getValue(at)).toBe(record.label);
    expect(coordinate(parts[0].position!.getValue(at)!)[0]).toBeCloseTo(record.lon, 9);
    expect(coordinate(parts[0].position!.getValue(at)!)[1]).toBeCloseTo(record.lat, 9);
    expect(parts[0].polygon!.material!.getValue(at).color.alpha).toBe(0.22);
    for (const part of perimeterPolygonEntities(record, true)) {
      expect(part.polygon!.material!.getValue(at).color.alpha).toBe(0.35);
      expect(part.polygon!.outlineColor!.getValue(at)).toEqual(Color.WHITE);
    }
    for (const invalid of ['perimeter|', 'perimeter||0', 'perimeter|id|wrong', 'rec|firePerimeters|id', 'dwd|id|0'])
      expect(perimeterPickId(invalid)).toBeNull();
  });

  it('keeps valid parts but never fills an invalid hole or substitutes a point for unavailable geometry', () => {
    const record = perimeter();
    if (record.geometry?.type !== 'MultiPolygon') throw new Error('fixture');
    record.geometry.coordinates[0][1][0][1] = NaN;
    const parts = perimeterPolygonEntities(record, false);
    expect(parts.map(part => part.id)).toEqual([`perimeter|${record.id}|1`]);
    expect(parts[0].label).toBeDefined();
    expect(perimeterPolygonEntities({ ...record, geometry: null }, false)).toEqual([]);
    expect(perimeterPolygonEntities({ ...record, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, false)).toEqual([]);
  });

  it('reconciles records individually: retains unrelated geometry, updates every selected part and removes replaced/deleted parts', async () => {
    const { renderer, dataSources } = harness();
    const first = perimeter(), other = perimeter('other-fixture');
    try {
      renderer.update('firePerimeters', [first, other], opts);
      await Promise.resolve();
      const source = dataSources.get(0), initial = [...source.entities.values];
      expect(initial).toHaveLength(4);
      expect(renderer.entityFor('firePerimeters', first.id)).toBe(initial[0]);
      expect(renderer.recordFor('firePerimeters', first.id)).toBe(first);
      renderer.update('metar', [], opts);
      renderer.update('firePerimeters', [first, other], opts);
      expect(source.entities.values).toEqual(initial);

      renderer.update('firePerimeters', [first, other], { ...opts, selectedLayer: 'firePerimeters', selectedId: first.id });
      expect(source.entities.getById(initial[0].id)).not.toBe(initial[0]);
      expect(source.entities.getById(initial[1].id)).not.toBe(initial[1]);
      expect(source.entities.getById(initial[2].id)).toBe(initial[2]);
      expect(source.entities.getById(initial[3].id)).toBe(initial[3]);
      for (const part of source.entities.values.filter(entity => perimeterPickId(entity.id) === first.id))
        expect(part.polygon!.outlineColor!.getValue(at)).toEqual(Color.WHITE);

      const changed = { ...first, label: 'Updated synthetic perimeter', geometry: { type: 'Polygon' as const, coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]] } };
      renderer.update('firePerimeters', [changed, other], opts);
      expect(source.entities.values).toHaveLength(3);
      expect(source.entities.getById(initial[1].id)).toBeUndefined();
      const replacement = source.entities.getById(initial[0].id)!;
      expect(coordinate(hierarchy(replacement).positions[0])[0]).toBeCloseTo(10, 9);
      expect(replacement.label!.text!.getValue(at)).toBe(changed.label);
      expect(source.entities.getById(initial[2].id)).toBe(initial[2]);
      renderer.update('firePerimeters', [other], opts);
      expect(source.entities.values).toHaveLength(2);
      expect(renderer.entityFor('firePerimeters', first.id)).toBeUndefined();
      expect(renderer.recordFor('firePerimeters', first.id)).toBeUndefined();
      renderer.update('firePerimeters', [{ ...other, geometry: null }], opts);
      expect(source.entities.values).toHaveLength(0);
      expect(renderer.entityFor('firePerimeters', other.id)).toBeUndefined();
      renderer.update('firePerimeters', [], opts);
      expect(source.entities.values).toHaveLength(0);
    } finally { renderer.destroy(); }
  });

  it('keeps all parts hidden during Replay/disabled updates and restores only the latest geometry when enabled', async () => {
    const { renderer, dataSources } = harness();
    try {
      const record = perimeter();
      renderer.update('firePerimeters', [record], opts); await Promise.resolve();
      const source = dataSources.get(0);
      renderer.setVisible('firePerimeters', false);
      renderer.update('firePerimeters', [{ ...record, label: 'Latest retained reply' }], opts);
      expect(source.show).toBe(false);
      expect(source.entities.values).toHaveLength(2);
      renderer.setVisible('firePerimeters', true);
      expect(source.show).toBe(true);
      expect(source.entities.values[0].label!.text!.getValue(at)).toBe('Latest retained reply');
    } finally { renderer.destroy(); }
  });
});
