import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LAYERS, type LayerId } from '../src/shared/layers';
import { WATCH_AREAS, WATCH_LAYERS, watchArea, withWatchLayers } from '../src/shared/watchAreas';

vi.mock('../src/renderer/lib/api', () => ({ api: {}, errorText: (e: unknown) => String(e) }));

describe('Watch areas', () => {
  it('turns on real layers only, once each, keeping what is already on', () => {
    for (const id of WATCH_LAYERS) expect(LAYERS[id]).toBeDefined();
    expect(withWatchLayers(['fires', 'aircraft'] as LayerId[])).toEqual(['fires', 'aircraft', 'aircraftMil', 'vessels', 'gnss', 'conflicts', 'milSites']);
  });
  it('has valid places, including the Strait of Hormuz', () => {
    const h = watchArea('hormuz')!;
    expect(h.name).toBe('Strait of Hormuz');
    expect(h.lat).toBeGreaterThan(25.5);
    expect(h.lat).toBeLessThan(27.5);
    expect(h.lon).toBeGreaterThan(55.5);
    expect(h.lon).toBeLessThan(57.5);
    expect(new Set(WATCH_AREAS.map((a) => a.id)).size).toBe(WATCH_AREAS.length);
    for (const a of WATCH_AREAS) {
      expect(Math.abs(a.lat)).toBeLessThanOrEqual(85);
      expect(Math.abs(a.lon)).toBeLessThanOrEqual(180);
      expect(a.coverageNote.length).toBeGreaterThan(10);
    }
    expect(watchArea('nowhere')).toBeNull();
  });
});

describe('Ask drop-down', () => {
  it('starts closed: a button only, no question box over the map', async () => {
    const { AskPlanet } = await import('../src/renderer/components/AskPlanet');
    const html = renderToStaticMarkup(createElement(AskPlanet, { view: () => null, onMarks: () => {}, onFocus: () => {}, onSave: () => {} }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Ask AI');
    expect(html).not.toContain('<input');
  });
});
