// Markers behind the Earth stay hidden after a refresh swaps in fresh graphics (reported 2026-11-23: new violence
// reports showed through the globe from the far side).
import { Cartesian3, Entity, JulianDate, LabelGraphics, PointGraphics, SceneMode } from 'cesium';
import { describe, expect, it } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';

function harness() {
  const near = new Entity({ id: 'rec|conflicts|near', position: Cartesian3.fromDegrees(0, 0, 0), point: new PointGraphics({ pixelSize: 8 }), label: new LabelGraphics({ text: 'near' }) });
  const far = new Entity({ id: 'rec|conflicts|far', position: Cartesian3.fromDegrees(180, 0, 0), point: new PointGraphics({ pixelSize: 8 }), label: new LabelGraphics({ text: 'far' }) });
  const r = Object.create(LayerRenderer.prototype) as LayerRenderer;
  Object.assign(r, {
    widget: { scene: { mode: SceneMode.SCENE3D }, camera: { positionWC: Cartesian3.fromDegrees(0, 0, 20_000_000) } },
    entities: new Map([['conflicts', new Map([['near', near], ['far', far]])]]),
    sources: new Map(), bulk: new Map(), records: new Map(), modelled: new Set(), interiorTarget: null,
  });
  return { r, near, far };
}
const shown = (e: Entity) => e.point?.show?.getValue(JulianDate.now()) !== false;

describe('markers on the far side of the globe', () => {
  it('stay hidden after a refresh replaces their graphics', () => {
    const { r, near, far } = harness();
    r.cullBehindEarth();
    expect(shown(near)).toBe(true);
    expect(shown(far)).toBe(false);
    // A refresh (new or changed report) takes fresh graphics as a whole; those start out shown.
    far.point = new PointGraphics({ pixelSize: 12 });
    far.label = new LabelGraphics({ text: 'far, updated' });
    r.cullBehindEarth();
    expect(shown(far)).toBe(false);
    expect(far.label?.show?.getValue(JulianDate.now())).toBe(false);
    expect(shown(near)).toBe(true);
  });
});
