import { Cartesian3, Color, Intersect, SceneMode, type Billboard } from 'cesium';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayerRenderer } from '../src/renderer/map/layerRender';
import type { GeoRecord } from '../src/shared/layers';
import type { ModelCandidate } from '../src/renderer/map/vehicleModels';

afterEach(() => vi.useRealTimers());

const START = Date.parse('2026-11-11T14:00:00Z');
function aircraft(props: Record<string, unknown> = {}): GeoRecord {
  return { id: 'abc123', label: 'TST123', lat: 0, lon: 0, altM: 1000, heading: 90, speedKts: 200,
    category: null, observedAt: new Date(START).toISOString(), source: 'test fixture', sourceUrl: null,
    props: { type: 'A320', onGround: false, ...props } };
}

/** Exercise actual renderer aging/culling/model-selection methods without a WebGL context or network. */
function harness(r: GeoRecord, modelsEnabled = false) {
  const billboard = { position: Cartesian3.fromDegrees(r.lon, r.lat, r.altM ?? 0), color: Color.WHITE, show: true } as Billboard;
  const modelSync = vi.fn((picked: ModelCandidate[]) => new Set(picked.map(p => p.key)));
  const widget = {
    camera: {
      positionWC: Cartesian3.fromDegrees(0, 0, 10_000), directionWC: new Cartesian3(-1, 0, 0), upWC: Cartesian3.UNIT_Z,
      positionCartographic: { longitude: 0, latitude: 0, height: 10_000 },
      frustum: { computeCullingVolume: () => ({ computeVisibility: () => Intersect.INSIDE }) },
    },
    scene: { mode: SceneMode.SCENE3D, requestRender: vi.fn() },
  };
  const renderer = Object.create(LayerRenderer.prototype) as LayerRenderer;
  Object.assign(renderer, {
    widget, destroyed: false, smooth: true, photoreal: false, packSettled: modelsEnabled,
    passengerMotions: new Map(), movingPassengers: new Set(), passengerFrame: null,
    records: new Map([['aircraft', new Map([[r.id, r]])]]), entities: new Map(), sources: new Map(),
    bulk: new Map([['aircraft', { byId: new Map([[r.id, billboard]]), coll: { show: true } }]]),
    modelled: new Set(), modelOpts: { enabled: modelsEnabled, budget: 1 }, lastType: new Map(),
    models: { sync: modelSync, has: () => false }, sel: { layer: 'aircraft', id: r.id },
  });
  const internals = renderer as unknown as { tickMotion(): void; syncModels(): void };
  return { renderer, billboard, modelSync, tick: () => internals.tickMotion(), syncModels: () => internals.syncModels() };
}

describe('bulk aircraft age during a provider outage', () => {
  it.each([false, true])('keeps live bulk vehicles/models hidden through replay callbacks, then restores them (entity source exists: %s)', (hasSource) => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const h = harness(aircraft(), true);
    const state = h.renderer as unknown as {
      sources: Map<string, { show: boolean }>;
      bulk: Map<string, { coll: { show: boolean } }>;
    };
    if (hasSource) state.sources.set('aircraft', { show: true });
    h.syncModels();
    expect(h.modelSync.mock.lastCall?.[0].map(candidate => candidate.key)).toEqual(['rec|aircraft|abc123']);
    h.renderer.setVisible('aircraft', false);
    expect(state.bulk.get('aircraft')?.coll.show).toBe(false);
    if (hasSource) expect(state.sources.get('aircraft')?.show).toBe(false);
    expect(h.modelSync.mock.lastCall?.[0]).toEqual([]);
    // Live aging, camera culling and late pack/model-ready callbacks may still run.
    // The collection remains hidden and no live model may be selected by them.
    h.tick(); h.renderer.cullBehindEarth(); h.syncModels();
    expect(state.bulk.get('aircraft')?.coll.show).toBe(false);
    expect(h.modelSync.mock.lastCall?.[0]).toEqual([]);
    h.renderer.setVisible('aircraft', true);
    expect(state.bulk.get('aircraft')?.coll.show).toBe(true);
    expect(h.modelSync.mock.lastCall?.[0].map(candidate => candidate.key)).toEqual(['rec|aircraft|abc123']);
  });

  it('hides the observer aircraft and limits distant symbols only while inside cockpit perspective', () => {
    vi.useFakeTimers(); vi.setSystemTime(START);
    const own = harness(aircraft(), true);
    own.renderer.setInteriorTarget({ layer: 'aircraft', id: 'abc123' });
    expect(own.modelSync.mock.lastCall?.[0]).toEqual([]);
    expect(own.billboard.show).toBe(false);
    own.renderer.setInteriorTarget(null);
    expect(own.modelSync.mock.lastCall?.[0].map(p => p.key)).toEqual(['rec|aircraft|abc123']);
    const distant = harness({ ...aircraft(), lon: 1 });
    distant.tick(); expect(distant.billboard.show).toBe(true);
    distant.renderer.setInteriorTarget({ layer: 'aircraft', id: 'observer' });
    expect(distant.billboard.show).toBe(false);
    distant.renderer.setInteriorTarget(null);
    expect(distant.billboard.show).toBe(true);
  });
  it('dims stale reports and hides expired reports without needing another feed update', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const h = harness(aircraft());
    h.tick();
    expect(h.billboard.color.alpha).toBe(1);
    expect(h.billboard.show).toBe(true);

    vi.setSystemTime(START + 61_000);
    h.tick();
    expect(h.billboard.color.alpha).toBe(0.4);
    expect(h.billboard.show).toBe(true);

    vi.setSystemTime(START + 301_000);
    h.tick();
    expect(h.billboard.show).toBe(false);
    h.renderer.cullBehindEarth(); // panning the map must not revive an expired aircraft
    expect(h.billboard.show).toBe(false);
  });

  it('expires worldwide snapshots at their provider-specific limit without extrapolating them', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const r = aircraft({ snapshot: true, maxAgeS: 1200 });
    const h = harness(r);
    vi.setSystemTime(START + 600_000);
    h.tick();
    expect(h.billboard.color.alpha).toBe(0.4);
    expect(h.billboard.show).toBe(true);
    expect(h.billboard.position).toEqual(Cartesian3.fromDegrees(r.lon, r.lat, r.altM!));
    vi.setSystemTime(START + 1201_000);
    h.tick();
    expect(h.billboard.show).toBe(false);
  });

  it('removes an expired selected model without bringing its billboard back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const h = harness(aircraft(), true);
    h.syncModels();
    expect(h.modelSync.mock.lastCall?.[0].map(p => p.key)).toEqual(['rec|aircraft|abc123']);
    expect(h.billboard.show).toBe(false);
    vi.setSystemTime(START + 301_000);
    h.tick();
    expect(h.modelSync.mock.lastCall?.[0]).toEqual([]);
    expect(h.billboard.show).toBe(false);
  });

  it('keeps the existing far-side globe culling for fresh aircraft', () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const h = harness({ ...aircraft(), lon: 180 });
    h.tick();
    expect(h.billboard.show).toBe(false);
  });
});
