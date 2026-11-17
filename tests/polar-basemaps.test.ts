import { describe, expect, it, vi } from 'vitest';

// Never contact Google (metered) or any tile host from a test: the provider is replaced by one that never resolves.
vi.mock('cesium', async (original) => ({ ...(await original<typeof import('cesium')>()), Google2DImageryProvider: { fromUrl: () => new Promise(() => {}) } }));
vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in tests')));
import { Math as CMath } from 'cesium';
import { BASEMAPS } from '../src/renderer/map/basemaps';

// Google, Esri, Mapbox and EOX tiles stop at the Web Mercator limit (85.05°). Before the fix the only imagery above it
// was the dark ocean-colour polar reference, which showed as a black disc against those providers' bright blue ocean.
const keys = { google: 'test-key', esri: 'test-key', mapbox: 'test-key' };

describe('poles under keyed Web Mercator basemaps', () => {
  for (const id of ['google2d', 'esri', 'mapbox', 'eox'] as const) {
    it(`${id} has bathymetry caps above 84° under the provider layer`, () => {
      const layers = BASEMAPS[id].build({ date: '2026-11-13', keys, eoxLicensed: true } as never);
      const caps = layers.map((l, i) => ({ i, north: l.rectangle ? CMath.toDegrees(l.rectangle.north) : null, south: l.rectangle ? CMath.toDegrees(l.rectangle.south) : null }))
        .filter((x) => x.south !== null && Math.abs(x.south - 84) < 1e-6);
      expect(caps.length).toBeGreaterThanOrEqual(2); // the bundled cap and the GIBS WMS cap
      expect(caps.every((c) => Math.abs((c.north ?? 0) - 90) < 1e-6)).toBe(true);
      // The provider is the last layer and draws over the caps wherever it has tiles.
      expect(Math.max(...caps.map((c) => c.i))).toBeLessThan(layers.length - 1);
    });
  }
});
