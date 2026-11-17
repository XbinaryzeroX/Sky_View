// Bundled OpenStreetMap telecom cables: the shipped file, row validation, labels and the layer wiring.
import { describe, expect, it } from 'vitest';
import cablesData from '../src/main/data/cables.json';
import { FETCHERS } from '../src/main/layers/fetchers';
import { cableRecords, type CablesFile } from '../src/shared/cables';
import { LAYER_GROUPS, LAYER_IDS, LAYERS } from '../src/shared/layers';

const file = cablesData as unknown as CablesFile;

describe('bundled cables', () => {
  it('reads every shipped row and keeps only identity, kind, name, operator, medium and the mapped line', () => {
    const { records, skipped } = cableRecords(file);
    expect(skipped).toBe(0);
    expect(records.length).toBe(file.cables.length);
    expect(records.length).toBeGreaterThan(5000);
    const kinds = new Set(records.map((r) => r.category));
    expect([...kinds].sort()).toEqual(['submarine', 'underground']);
    for (const r of records.slice(0, 200)) {
      expect(r.id).toMatch(/^way-\d+$/);
      expect(r.sourceUrl).toBe(`https://www.openstreetmap.org/way/${r.id.slice(4)}`);
      expect(Object.keys(r.props).sort()).toEqual(['cableKind', 'mappedLengthKm', 'mappedNote', 'medium', 'operator']);
      expect(r.geometry?.type).toBe('LineString');
      expect(r.observedAt).toBeNull();
    }
  });

  it('skips malformed rows and never invents geometry', () => {
    const line = [10, 50, 10.1, 50.1];
    const { records, skipped } = cableRecords({ built: '2026-11-15', osmBase: null, cables: [
      [1, 'submarine', 'A', null, 'fibre', line],
      [2, 'aerial', 'B', null, null, line],
      [3, 'submarine', 'C', null, null, [10, 50]],
      [4, 'submarine', 'D', null, null, [10, 50, 200, 50]],
      [5, 'underground', null, 'Op', null, [10, 50, 10, 95]],
      [0, 'submarine', 'E', null, null, line],
      [6, 'underground', null, null, null, [10, 50, 10.1]],
      'junk', null,
      [7, 'underground', null, null, null, [179.9, -10, -179.9, -10]],
    ] });
    expect(records.map((r) => r.id)).toEqual(['way-1', 'way-7']);
    expect(skipped).toBe(8);
    expect(records[0].geometry).toEqual({ type: 'LineString', coordinates: [[10, 50], [10.1, 50.1]] });
    expect(records[0].props.mappedLengthKm).toBeCloseTo(13.2, 0);
    // A piece that crosses the date line is 22 km long, not most of the way round the world.
    expect(records[1].props.mappedLengthKm).toBeLessThan(30);
    expect(records[1].label).toBe('Underground cable (unnamed)');
  });

  it('is a static bundled layer that says it is incomplete, and works with no network', async () => {
    expect(LAYER_IDS).toContain('cables');
    expect(LAYERS.cables.temporal).toBe('static');
    expect(LAYERS.cables.group).toBe('Infrastructure');
    expect(LAYERS.cables.temporalNote).toMatch(/small part/);
    const result = await FETCHERS.cables({} as never);
    expect(result.records.length).toBe(file.cables.length);
    expect(result.note).toMatch(/Most cables are not mapped/);
  });

  it('puts every layer in one of the listed groups, and every group has a layer', () => {
    for (const id of LAYER_IDS) expect(LAYER_GROUPS).toContain(LAYERS[id].group);
    for (const g of LAYER_GROUPS) expect(LAYER_IDS.some((id) => LAYERS[id].group === g)).toBe(true);
  });
});

describe('layer categories in the Layers panel', () => {
  it('start collapsed, and open when asked', async () => {
    const { vi } = await import('vitest');
    vi.doMock('../src/renderer/lib/api', () => ({ api: {}, errorText: String }));
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LayersPanel } = await import('../src/renderer/components/LayersPanel');
    const { DEFAULT_SETTINGS } = await import('../src/shared/ipc');
    const base = { settings: { ...DEFAULT_SETTINGS, layersEnabled: ['cables' as const] }, snaps: {}, onPatch: () => {}, imagery: {}, onImagery: () => {} } as never;
    const shut = renderToStaticMarkup(createElement(LayersPanel, base));
    const open = renderToStaticMarkup(createElement(LayersPanel, { ...(base as object), groupsOpen: true } as never));
    expect((shut.match(/aria-expanded="false"/g) ?? []).length).toBe(LAYER_GROUPS.length);
    expect(shut).not.toContain('Internet and telecom cables');
    expect(shut).toContain('Infrastructure');
    expect(open).toContain('Internet and telecom cables');
  });
});
