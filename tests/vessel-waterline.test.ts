import { Cartesian3, Cartographic, HeightReference } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import type { ModelCandidate } from '../src/renderer/map/vehicleModels';
import type { GeoRecord } from '../src/shared/layers';
import * as geoid from '../src/renderer/map/geoid';

const ship: GeoRecord = { id: 'test-ship', label: 'Test ferry', lat: 60, lon: 25, altM: null, heading: 40,
  speedKts: 0, category: 'Passenger', observedAt: null, source: 'fixture', sourceUrl: null, props: { shipType: 60 } };
function harness() {
  const normal = vi.fn<() => number | undefined>(), photoreal = vi.fn<() => number | undefined>();
  const renderer = Object.create(LayerRenderer.prototype) as LayerRenderer;
  Object.assign(renderer, { widget: { scene: { globe: { getHeight: normal } } }, sel: { layer: 'vessels', id: ship.id },
    models: { variantFailed: () => false }, photoreal: false, photorealSurface: { getHeight: photoreal }, bulk: new Map(),
    sources: new Map(), records: new Map([['vessels', new Map([[ship.id, ship]])]]) });
  const methods = renderer as unknown as { heightFor(layer: 'vessels', r: GeoRecord): number; candidate(layer: 'vessels', r: GeoRecord, p: Cartesian3): ModelCandidate };
  const height = () => methods.heightFor('vessels', ship);
  const candidate = () => methods.candidate('vessels', ship, Cartesian3.fromDegrees(ship.lon, ship.lat, height()));
  const followHeight = () => Cartographic.fromCartesian(renderer.positionFor('vessels', ship.id)!).height;
  return { renderer, normal, photoreal, height, candidate, followHeight };
}
afterEach(() => vi.restoreAllMocks());
describe('AIS display elevation', () => {
  it('follows the displayed lake, sea and changing terrain detail at the same AIS coordinates', () => {
    const h = harness();
    expect(h.height()).toBe(0);
    expect(h.candidate().heightReference).toBe(HeightReference.CLAMP_TO_TERRAIN);
    for (const water of [76, 184, -17, 0]) {
      h.normal.mockReturnValue(water);
      expect(h.height()).toBe(water);
      expect(h.followHeight()).toBeCloseTo(water, 5);
    }
    expect(ship.altM).toBeNull();
    expect(h.photoreal).not.toHaveBeenCalled();
  });

  it('uses local mesh coverage at the ship and the visible terrain beneath mesh gaps', () => {
    const h = harness();
    Object.assign(h.renderer, { photoreal: true });
    vi.spyOn(geoid, 'geoidHeight').mockReturnValue(-32);
    expect(h.height()).toBe(-32);
    expect(h.candidate().heightReference).toBe(HeightReference.CLAMP_TO_TERRAIN);
    h.normal.mockReturnValue(77);
    expect(h.followHeight()).toBeCloseTo(77, 5);
    h.photoreal.mockReturnValue(181);
    h.normal.mockClear();
    expect(h.followHeight()).toBeCloseTo(181, 5);
    expect(h.candidate().heightReference).toBe(HeightReference.CLAMP_TO_3D_TILE);
    expect(h.normal).not.toHaveBeenCalled();
  });
});
