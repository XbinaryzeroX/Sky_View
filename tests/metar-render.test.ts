import { DataSourceCollection, Event, JulianDate, type CesiumWidget } from 'cesium';
import { expect, it } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import { METAR_COLORS, METAR_UNKNOWN_COLOR } from '../src/renderer/lib/format';
import { normalizeMetar } from '../src/shared/layerNormalize';

it('updates a retained station marker when its reported category changes or goes missing', async () => {
  const dataSources = new DataSourceCollection();
  const widget = { dataSources, camera: { positionCartographic: { height: 100_000 } },
    scene: { preRender: new Event(), morphComplete: new Event(), requestRender() {} } };
  const renderer = new LayerRenderer(widget as unknown as CesiumWidget);
  const report = { icaoId: 'TEST', lon: -170, lat: -20, obsTime: 1_800_000_000 };
  const options = { selectedId: null, selectedLayer: null, trackedId: null };
  try {
    const update = (fltCat: string | null) => renderer.update('metar', normalizeMetar([{ ...report, fltCat }]).records, options);
    update('VFR');
    await Promise.resolve(); // Cesium adds data sources asynchronously.
    const station = dataSources.get(0).entities.getById('rec|metar|TEST')!;
    const color = () => station.point?.color?.getValue(JulianDate.now()).toCssHexString();
    expect(color()).toBe(METAR_COLORS.get('VFR'));
    update('IFR');
    expect(dataSources.get(0).entities.getById(station.id)).toBe(station);
    expect(color()).toBe(METAR_COLORS.get('IFR'));
    update(null);
    expect(color()).toBe(METAR_UNKNOWN_COLOR);
  } finally {
    renderer.destroy();
  }
});
