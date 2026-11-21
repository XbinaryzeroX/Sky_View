// Zooming into New York with ~9,800 cameras on (reported 2026-11-18 as a crash): the main-thread costs found in the
// profile, and what the app does when its renderer or graphics context dies.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendCrashLine, crashLine, CRASH_LOG_MAX_LINES, MAX_RELOADS, ReloadGate, RELOAD_WINDOW_MS, shouldRecover } from '../src/main/crashRecovery';
import { camerasNear, TAG_MAX_DISTANCE_M } from '../src/shared/cameraCards';

vi.mock('../src/renderer/map/vectorTiles', () => ({ oceanMask: async () => ({ kind: 'mask' }) }));

describe('camera overlay near the viewer', () => {
  it('keeps only cameras within reach of the viewer before any terrain lookup', () => {
    // ~9,800 cameras spread over the world, ten of them in Midtown Manhattan.
    const world = Array.from({ length: 9_800 }, (_, i) => ({ id: `w${i}`, lat: -60 + (i % 120), lon: -180 + ((i * 37) % 360) }));
    const midtown = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, lat: 40.758 + i * 0.002, lon: -73.985 + i * 0.002 }));
    const near = camerasNear([...world, ...midtown], 40.758, -73.985, TAG_MAX_DISTANCE_M);
    expect(near.map((r) => r.id).sort()).toEqual(midtown.map((r) => r.id).sort());
  });

  it('handles the date line and the poles', () => {
    const recs = [{ id: 'east', lat: 0, lon: 179.99 }, { id: 'west', lat: 0, lon: -179.99 }, { id: 'far', lat: 0, lon: 170 }];
    expect(camerasNear(recs, 0, 179.995, 4_000).map((r) => r.id).sort()).toEqual(['east', 'west']);
    const pole = [{ id: 'across', lat: 89.99, lon: 180 }, { id: 'south', lat: 89.9, lon: 0 }];
    expect(camerasNear(pole, 89.99, 0, 4_000).map((r) => r.id)).toEqual(['across']);
    expect(camerasNear([], 40, -74, 4_000)).toEqual([]);
  });
});

describe('USGS shoreline blend', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('feathers the coast with canvas compositing only, never a pixel readback on the main thread', async () => {
    const calls: string[] = [];
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close() {} })));
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext(_kind: string, opts?: { willReadFrequently?: boolean }) {
        if (opts?.willReadFrequently) calls.push('willReadFrequently');
        const ctx = {
          fillStyle: '', filter: '', globalCompositeOperation: 'source-over',
          fillRect() {}, drawImage() { calls.push(`draw:${ctx.globalCompositeOperation}`); },
          getImageData() { calls.push('getImageData'); return { data: new Uint8ClampedArray(256 * 256 * 4) }; },
          putImageData() { calls.push('putImageData'); },
        };
        return ctx;
      }
    });
    const { blendShore } = await import('../src/renderer/map/usgsProvider');
    await blendShore({} as ImageBitmap, 15, 9_650, 12_314);
    expect(calls).not.toContain('getImageData');
    expect(calls).not.toContain('willReadFrequently');
    // Land influence ×4 by two additive draws, then inverted and cut from the photograph.
    expect(calls.filter((c) => c === 'draw:lighter')).toHaveLength(2);
    expect(calls.at(-1)).toBe('draw:destination-out');
  });
});

describe('renderer and GPU crash recovery', () => {
  it('logs time, process, reason and exit code only, and keeps the newest lines', () => {
    const line = crashLine(new Date('2026-11-18T23:10:00Z'), 'renderer', 'oom C:\\Users\\x\\notes', -536870904);
    expect(line).toBe('2026-11-18T23:10:00.000Z renderer reason=oomCUsersxnotes exit=-536870904');
    let log = '';
    for (let i = 0; i < CRASH_LOG_MAX_LINES + 5; i++) log = appendCrashLine(log, `line ${i}`);
    const lines = log.trim().split('\n');
    expect(lines).toHaveLength(CRASH_LOG_MAX_LINES);
    expect(lines.at(-1)).toBe(`line ${CRASH_LOG_MAX_LINES + 4}`);
  });

  it('reloads a crashed renderer a few times, then stops, and ignores a clean exit', () => {
    expect(shouldRecover('crashed')).toBe(true);
    expect(shouldRecover('oom')).toBe(true);
    expect(shouldRecover('clean-exit')).toBe(false);
    const gate = new ReloadGate();
    const t = Date.parse('2026-11-18T23:00:00Z');
    for (let i = 0; i < MAX_RELOADS; i++) expect(gate.allow(t + i * 1000)).toBe(true);
    expect(gate.allow(t + 10_000)).toBe(false);
    expect(gate.allow(t + RELOAD_WINDOW_MS + 5_000)).toBe(true);
  });
});

describe('3D model sync with thousands of parked aircraft (crash log stack, 2026-11-19)', () => {
  it('asks the terrain for heights only near the camera, a few per sync, and reuses them', async () => {
    const { Cartesian3, Intersect, SceneMode } = await import('cesium');
    const { LayerRenderer } = await import('../src/renderer/map/layerRender');
    const parked = (id: string, lat: number, lon: number) => ({ id, label: id, lat, lon, altM: 0, heading: 0, speedKts: 0, category: null,
      observedAt: new Date().toISOString(), source: 'test', sourceUrl: null, props: { type: 'A320', onGround: true } });
    // 3,000 parked aircraft around the world, 5 at the airport under the camera.
    const recs = [...Array.from({ length: 3_000 }, (_, i) => parked(`w${i}`, -50 + (i % 100), -170 + ((i * 7) % 340))), ...Array.from({ length: 5 }, (_, i) => parked(`n${i}`, 40.64 + i * 0.001, -73.78))];
    const getHeight = vi.fn(() => 4);
    const widget = {
      camera: {
        positionWC: Cartesian3.fromDegrees(-73.78, 40.64, 3_000), directionWC: new Cartesian3(-1, 0, 0), upWC: Cartesian3.UNIT_Z,
        positionCartographic: { longitude: -73.78 * Math.PI / 180, latitude: 40.64 * Math.PI / 180, height: 3_000 },
        frustum: { computeCullingVolume: () => ({ computeVisibility: () => Intersect.INSIDE }) },
      },
      scene: { mode: SceneMode.SCENE3D, requestRender: vi.fn(), globe: { getHeight } },
    };
    const renderer = Object.create(LayerRenderer.prototype) as InstanceType<typeof LayerRenderer>;
    Object.assign(renderer, {
      widget, destroyed: false, smooth: true, photoreal: false, packSettled: true,
      passengerMotions: new Map(), movingPassengers: new Set(), passengerFrame: null,
      records: new Map([['aircraft', new Map(recs.map((r) => [r.id, r]))]]), entities: new Map(), sources: new Map(),
      bulk: new Map([['aircraft', { byId: new Map(recs.map((r) => [r.id, { position: Cartesian3.fromDegrees(r.lon, r.lat, 0) }])), coll: { show: true } }]]),
      staticPoints: new Map(), modelled: new Set(), modelOpts: { enabled: true, budget: 150 }, lastType: new Map(),
      models: { sync: (p: { key: string }[]) => new Set(p.map((c) => c.key)), has: () => false, pendingCount: () => 0 }, sel: { layer: null, id: null },
      cullBehindEarth: () => {},
    });
    const sync = () => (renderer as unknown as { syncModels(): void }).syncModels();
    sync();
    expect(getHeight.mock.calls.length).toBeLessThanOrEqual(16);
    expect(getHeight.mock.calls.length).toBe(5);
    sync(); sync();
    expect(getHeight.mock.calls.length).toBe(5); // reused, not re-read on every sync
  });
});
