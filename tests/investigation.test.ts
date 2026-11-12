import { describe, expect, it, vi } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { AppCore } from '../src/main/core';
import { createHandlers, dispatch, type PlatformServices } from '../src/main/handlers';
import { LayerManager } from '../src/main/layers/manager';
import type { FetchJson } from '../src/main/feeds/http';
import { DEFAULT_SETTINGS, IPC, savedViewSchema, sceneSchema, validateIpcArgs, type SavedView, type Scene } from '../src/shared/ipc';
import { investigationSchema, needsSurfaceChoice, type Investigation } from '../src/shared/investigation';
import type { AnnotationDocument } from '../src/shared/geojsonAnnotations';
import catalog from '../src/renderer/data/gibsCatalog.json';
import { fixture, tempDbPath } from './helpers';

const at = '2026-11-11T16:00:00.123Z';
const camera = { lat: -34, lon: 180, heightM: 25000, heading: 0.2, pitch: -1.1 };
const area = fixture<{ annotation: AnnotationDocument }>('area-watch-backend.json').annotation;
function investigation(mode: 'live' | 'recorded' = 'recorded'): Investigation {
  return { version: 1, clock: mode === 'live' ? { mode } : { mode, t: at }, selection: { kind: 'alert', id: 'urn:oid:2.49.0.1.840.0.fixture' }, severityFilter: ['Extreme', 'Severe'], alertsAffectingOnly: true, quakesNearLocationsOnly: true, quakeWindow: 'hour', quakeMinMagnitude: 1, layers: { alerts: true, quakes: true, locations: false, radii: false, boundaries: true }, sceneMode: '2d', dataOpen: true, hudOn: false, showAirports: false, imagery: { product: `${catalog.products[0].category}|${catalog.products[0].id}`, date: '2026-11-10', compare: true, compareDate: '2026-10-31', opacity: 0.4, split: 0.3 } };
}
function view(extra: Partial<SavedView> = {}): SavedView {
  return { id: 'saved-view', name: '東京 南 · civil', camera, basemap: 'atlas', layersEnabled: [], createdAt: at, ...extra };
}
function scene(mode: 'live' | 'recorded' = 'recorded'): Scene {
  return { format: 'atlas-watch-scene', version: 2, createdAt: at, camera, basemap: 'streets', terrainEnabled: false, layersEnabled: ['metar'], visualMode: 'noir', annotations: [], views: [], investigation: investigation(mode) };
}
function legacy(): Scene {
  return { format: 'atlas-watch-scene', version: 1, createdAt: at, camera, basemap: 'atlas', terrainEnabled: true, layersEnabled: [], visualMode: 'normal', annotations: [], views: [view()] };
}
function harness() {
  const path = tempDbPath(); const store = new AtlasStore(path);
  store.saveSettings({ ...DEFAULT_SETTINGS, zoneLookupEnabled: false, quakeWindow: 'week', quakeMinMagnitude: 4.5, marketWatchlist: ['PRESERVED'], orgName: 'Private organization', homeLat: 12, homeLon: 33 });
  let time = at;
  const fetchRecent = vi.fn(async () => ({ quakes: [], skipped: 0, sourceUpdatedAt: at, feedKey: 'all_hour' }));
  const changed = vi.fn();
  const core = new AppCore({ store, now: () => new Date(time), onChange: changed, quakeSource: { name: 'unused fixture', fetchRecent }, alertSource: { name: 'unused fixture', fetchActiveAlerts: async () => ({ alerts: [], skipped: 0, sourceUpdatedAt: null }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) } });
  core.init(); changed.mockClear();
  return { path, store, core, changed, fetchRecent, advance: () => { time = '2026-11-11T16:01:00.456Z'; }, close: () => { core.stop(); store.close(); } };
}

describe('strict, backwards-compatible civil investigation contract', () => {
  it('keeps original scene and view shapes exact without synthesizing investigation defaults', () => {
    const old = legacy();
    expect(sceneSchema.parse(old)).toEqual(old);
    expect(savedViewSchema.parse(view())).toEqual(view());
    expect('investigation' in savedViewSchema.parse(view())).toBe(false);
    expect('terrainEnabled' in savedViewSchema.parse(view())).toBe(false);
    expect(sceneSchema.parse({ ...old, views: [{ ...view(), basemap: 'legacy-opaque-surface' }] }).views[0].basemap).toBe('legacy-opaque-surface');
  });

  it('retains exact UTC cursor, Unicode, civil IDs and display state through JSON roundtrip', () => {
    const source = { ...scene(), views: [view({ terrainEnabled: false, visualMode: 'thermal', investigation: investigation() })] };
    expect(sceneSchema.parse(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(investigationSchema.parse({ ...investigation('live'), selection: { kind: 'quake', id: 'us7000abcd' } }).clock).toEqual({ mode: 'live' });
  });

  it.each(['2026-11-11T16:00:00Z', '2026-11-11T16:00:00.000+00:00', '2026-02-30T00:00:00.000Z', 'invalid'])('rejects noncanonical or impossible recorded cursor %s', t => {
    expect(investigationSchema.safeParse({ ...investigation(), clock: { mode: 'recorded', t } }).success).toBe(false);
  });

  it('requires v2 context and refuses unknown/private/provider/track context at every boundary', () => {
    const { investigation: _, ...missing } = scene() as Extract<Scene, { version: 2 }>;
    expect(sceneSchema.safeParse(missing).success).toBe(false);
    for (const bad of [
      { ...investigation(), token: 'secret' },
      { ...investigation(), clock: { mode: 'live', t: at } },
      { ...investigation(), selection: { kind: 'aircraft', id: 'ab1234' } },
      { ...investigation(), selection: { kind: 'quake', id: 'https://evil.example/data' } },
      { ...investigation(), layers: { ...investigation().layers, cameras: true } },
      { ...investigation(), imagery: { ...investigation().imagery, product: 'https://evil.example/wmts' } },
      { ...investigation(), imagery: { ...investigation().imagery, accessToken: 'secret' } },
      { ...investigation(), severityFilter: ['Severe', 'Severe'] },
    ]) expect(investigationSchema.safeParse(bad).success).toBe(false);
    expect(sceneSchema.safeParse({ ...scene(), savedLocations: [{ notes: 'private' }] }).success).toBe(false);
    expect(savedViewSchema.safeParse({ ...view(), credential: 'secret' }).success).toBe(false);
  });

  it('validates known product and real calendar dates without guessing current source availability', () => {
    const im = investigation().imagery!;
    expect(investigationSchema.safeParse({ ...investigation(), imagery: { ...im, date: '', compareDate: '2030-01-01' } }).success).toBe(true);
    for (const patch of [{ date: '2026-02-29' }, { opacity: 1.01 }, { split: -0.1 }, { product: 'imaginary|product' }])
      expect(investigationSchema.safeParse({ ...investigation(), imagery: { ...im, ...patch } }).success).toBe(false);
    for (const mag of [-1, 10]) expect(investigationSchema.safeParse({ ...investigation(), quakeMinMagnitude: mag }).success).toBe(true);
    expect(investigationSchema.safeParse({ ...investigation(), quakeMinMagnitude: -1.01 }).success).toBe(false);
  });

  it('validates narrow commit/restore IPC and exact explicit boolean consent', () => {
    expect(validateIpcArgs(IPC.sceneApply, [scene()])).toEqual([scene()]);
    expect(validateIpcArgs(IPC.viewsRestore, ['saved-view', true])).toEqual(['saved-view', true]);
    for (const args of [[scene(), 'yes'], [scene(), { allowMeteredBasemap: true }], [scene(), true, 'extra']])
      expect(() => validateIpcArgs(IPC.sceneApply, args)).toThrow();
    expect(() => validateIpcArgs(IPC.viewsRestore, ['../../file', true])).toThrow();
  });
});

describe('single-transaction scene and named-view persistence', () => {
  it('merges by ID with original last-wins semantics, preserving unrelated local data and settings', () => {
    const h = harness();
    h.core.putAnnotation({ ...area, id: 'unrelated' }); h.store.putSavedView(view({ id: 'unrelated-view' }));
    h.store.setMeta('credential-reference', 'untouched'); h.store.setMeta('watchlist', '["untouched"]');
    h.changed.mockClear();
    const input = { ...scene(), annotations: [{ ...area, name: 'first' }, { ...area, name: 'last' }], views: [view({ name: 'first' }), view({ name: 'last' })] };
    const result = h.core.applyScene(input);
    expect(result.annotations).toHaveLength(2); expect(result.annotations.find(a => a.id === area.id)?.name).toBe('last');
    expect(result.views).toHaveLength(2); expect(result.views.find(v => v.id === 'saved-view')?.name).toBe('last');
    expect(result.settings).toMatchObject({ basemap: 'streets', terrainEnabled: false, visualMode: 'noir', quakeWindow: 'week', quakeMinMagnitude: 4.5, quakesNearLocationsOnly: true, marketWatchlist: ['PRESERVED'], orgName: 'Private organization', homeLat: 12, homeLon: 33 });
    expect(h.store.getMeta('credential-reference')).toBe('untouched'); expect(h.store.getMeta('watchlist')).toBe('["untouched"]');
    expect(h.fetchRecent).not.toHaveBeenCalled(); expect(h.changed).toHaveBeenCalledTimes(1);
    h.close();
  });

  it('persists extended views after restart and retains current optional display settings for a legacy view', () => {
    const h = harness();
    const saved = view({ terrainEnabled: false, visualMode: 'thermal', investigation: investigation() });
    h.store.putSavedView(saved); const path = h.path; h.close();
    const reopened = new AtlasStore(path);
    expect(reopened.restoreView(saved.id).view).toEqual(saved);
    reopened.putDoc('saved_views', 'legacy', view({ id: 'legacy' }), at);
    const result = reopened.restoreView('legacy');
    expect(result.settings.terrainEnabled).toBe(false); expect(result.settings.visualMode).toBe('thermal');
    expect(result.view).toEqual(view({ id: 'legacy' }));
    reopened.putDoc('saved_views', 'unknown', view({ id: 'unknown', basemap: 'legacy-opaque-surface' }), at);
    expect(reopened.restoreView('unknown')).toMatchObject({ settings: { basemap: 'atlas' }, warnings: [expect.stringMatching(/unsupported/)] });
    reopened.close();
  });

  it('updates the live quake query only for a live investigation and not for recorded restore', () => {
    const h = harness();
    const recorded = h.core.applyScene(scene()); expect(recorded.settings.quakeWindow).toBe('week');
    expect(h.fetchRecent).not.toHaveBeenCalled();
    const live = h.core.applyScene(scene('live'));
    expect(live.settings).toMatchObject({ quakeWindow: 'hour', quakeMinMagnitude: 1 });
    expect(h.fetchRecent).toHaveBeenCalledTimes(1);
    h.close();
  });

  it.each(['google3d', 'google2d', 'esri', 'mapbox', 'eox'] as const)('gates %s in main for scene and view restore', basemap => {
    const h = harness(); const input = { ...scene(), basemap };
    expect(needsSurfaceChoice('atlas', basemap)).toBe(true); expect(needsSurfaceChoice(basemap, basemap)).toBe(false);
    const denied = h.core.applyScene(input);
    expect(denied.settings.basemap).toBe('atlas'); expect(denied.skippedSurface).toBe(basemap); expect(denied.warnings[0]).toMatch(/explicit/);
    h.store.putSavedView(view({ basemap }));
    expect(h.core.restoreView('saved-view').settings.basemap).toBe('atlas');
    const allowed = h.core.restoreView('saved-view', true);
    expect(allowed.settings.basemap).toBe(basemap); expect(allowed.skippedSurface).toBeNull();
    expect(h.core.applyScene(input).warnings).toEqual([]); h.close();
  });

  it('restores a historical imagery year and keeps it active when a paid surface change is declined', () => {
    const h = harness();
    const state = { ...investigation('live'), imageryYear: 2020 };
    const archived = h.core.applyScene({ ...scene(), version:2, basemap:'google3d', investigation:state });
    expect(archived.settings).toMatchObject({ basemap:'atlas', imageryYear:2020 });
    expect(archived.skippedSurface).toBeNull();
    const current = { ...scene(), basemap:'google3d' as const };
    expect(h.core.applyScene(current).skippedSurface).toBe('google3d');
    expect(h.store.getSettings().imageryYear).toBe(2020);
    expect(h.core.applyScene(current,true).settings.imageryYear).toBeNull();
    h.close();
  });

  it('rolls back settings, drawings, views and changed watch epoch, then adopts all of them only after success', () => {
    const h = harness();
    for (const id of ['changed-area', 'unrelated-area']) {
      h.core.putAnnotation({ ...area, id }); h.core.putAreaWatch({ areaId: id, minMagnitude: 2.5, enabled: true });
    }
    const before = h.core.snapshot().areaWatches; const oldSettings = h.store.getSettings();
    h.advance(); h.changed.mockClear();
    const edited = { ...area, id: 'changed-area', points: [[-3, -3], [3, -3], [3, 3], [-3, 3]] as [number, number][] };
    const input = { ...scene('live'), annotations: [edited], views: [view({ id: 'abort-view' })] };
    h.store.db.exec("CREATE TRIGGER scene_abort BEFORE INSERT ON saved_views WHEN NEW.id = 'abort-view' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
    expect(() => h.core.applyScene(input)).toThrow(/fixture rollback/);
    expect(h.store.getSettings()).toEqual(oldSettings); expect(h.core.settings).toEqual(oldSettings);
    expect(h.store.getAnnotation('changed-area')).toEqual({ ...area, id: 'changed-area' });
    expect(h.store.areaWatchState()).toEqual(before); expect(h.core.snapshot().areaWatches).toBe(before);
    expect(h.store.listDocs('saved_views')).toEqual([]); expect(h.fetchRecent).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled();
    h.store.db.exec('DROP TRIGGER scene_abort');
    h.core.applyScene(input);
    const after = h.core.snapshot().areaWatches;
    expect(after.rules.find(r => r.areaId === 'changed-area')?.armedAt).toBe('2026-11-11T16:01:00.456Z');
    expect(after.rules.find(r => r.areaId === 'unrelated-area')).toEqual(before.rules.find(r => r.areaId === 'unrelated-area'));
    expect(h.store.getAnnotation('changed-area')).toEqual(edited); expect(h.fetchRecent).toHaveBeenCalledTimes(1);
    h.close();
  });

  it('disables invalid imported watched geometry or removes nonarea rule atomically, preserving unrelated watches', () => {
    const h = harness();
    for (const id of ['invalid', 'nonarea', 'unrelated']) { h.core.putAnnotation({ ...area, id }); h.core.putAreaWatch({ areaId: id, minMagnitude: 2, enabled: true }); }
    const result = h.core.applyScene({ ...scene(), annotations: [{ ...area, id: 'invalid', points: [[0, 0], [1, 0], [2, 0]] }, { ...area, id: 'nonarea', kind: 'pin', points: [[1, 2]] }] });
    expect(h.core.snapshot().areaWatches.rules.find(r => r.areaId === 'invalid')?.enabled).toBe(false);
    expect(h.core.snapshot().areaWatches.rules.find(r => r.areaId === 'nonarea')).toBeUndefined();
    expect(h.core.snapshot().areaWatches.rules.find(r => r.areaId === 'unrelated')?.enabled).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/disabled/); expect(result.warnings.join(' ')).toMatch(/removed/); h.close();
  });

  it('enforces merged capacity before any mutation, while permitting updates at capacity', () => {
    const h = harness();
    for (let i = 0; i < 500; i++) h.store.putDoc('saved_views', `view-${i}`, view({ id: `view-${i}` }), at);
    const before = h.store.getSettings();
    expect(() => h.core.applyScene({ ...scene(), annotations: [area], views: [view()] })).toThrow(/500/);
    expect(h.store.getAnnotation(area.id)).toBeNull(); expect(h.store.getSettings()).toEqual(before);
    h.store.putSavedView(view({ id: 'view-0', name: 'update at capacity' }));
    expect(() => h.store.putSavedView(view())).toThrow(/500/);
    h.close();
  });

  it('revalidates direct commits before writing and isolates existing observer failures after commit', () => {
    const h = harness(); const before = h.store.getSettings();
    expect(() => h.core.applyScene({ ...scene(), credential: 'secret' } as unknown as Scene)).toThrow();
    expect(h.store.getSettings()).toEqual(before);
    h.changed.mockImplementation(() => { throw new Error('fixture observer error'); });
    const result = h.core.applyScene(scene());
    expect(result.settings).toEqual(h.store.getSettings()); expect(h.core.settings).toEqual(result.settings); h.close();
  });

  it('preserves an unchanged unsupported legacy surface through v1 import, v2 export and reimport', () => {
    const h = harness();
    const oldView = view({ basemap: 'historical-unknown' });
    const imported = h.core.applyScene({ ...legacy(), views: [oldView] });
    const v2 = sceneSchema.parse(JSON.parse(JSON.stringify({ ...scene(), views: imported.views })));
    const reimported = h.core.applyScene(v2);
    expect(reimported.views).toEqual([oldView]);
    const restored = h.core.restoreView(oldView.id);
    expect(restored.view).toEqual(oldView); expect(restored.settings.basemap).toBe('streets'); expect(restored.warnings.join(' ')).toMatch(/unsupported/);
    h.close();
  });

  it('starts and stops actual layer scheduling only after committed scene/view restore, warning on synchronization failure', async () => {
    vi.useFakeTimers();
    const h = harness();
    const fetchJson = vi.fn<FetchJson>(async () => ({ status: 200, body: [] }));
    const manager = new LayerManager({ store: h.store, fetchJson, fetchText: async () => ({ status: 200, text: '' }), getSettings: () => h.core.settings, userAgent: () => 'local fixture', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: () => {} });
    const platform: PlatformServices = { openTextFile: async () => null, saveTextFile: async () => null, savePdfFromHtml: async () => null, openExternal: () => false, getNetStats: () => [], setKiosk: () => false, captureScreenshot: async () => null, appVersion: 'test' };
    try {
      manager.setView({ lat: 40, lon: -105, heightM: 100000, bbox: [-106, 39, -104, 41] }); manager.start();
      const handlers = createHandlers(h.core, h.store, fetchJson, platform, { layers: manager, providers: null });
      h.store.db.exec("CREATE TRIGGER provider_abort BEFORE INSERT ON saved_views WHEN NEW.id = 'abort' BEGIN SELECT RAISE(ABORT, 'fixture abort'); END;");
      await expect(dispatch(handlers, IPC.sceneApply, [{ ...scene(), views: [view({ id: 'abort' })] }])).rejects.toThrow(/fixture abort/);
      await vi.advanceTimersByTimeAsync(0); expect(fetchJson).not.toHaveBeenCalled(); expect(manager.snapshot('metar').status.enabled).toBe(false);
      await dispatch(handlers, IPC.sceneApply, [scene()]); await vi.advanceTimersByTimeAsync(0);
      expect(fetchJson).toHaveBeenCalledTimes(1); expect(manager.snapshot('metar').status.enabled).toBe(true);
      h.store.putSavedView(view({ layersEnabled: [] }));
      await dispatch(handlers, IPC.viewsRestore, ['saved-view']);
      expect(manager.snapshot('metar').status.enabled).toBe(false); expect(manager.snapshot('metar').status.nextAttemptAt).toBeNull();
      await vi.advanceTimersByTimeAsync(3600000); expect(fetchJson).toHaveBeenCalledTimes(1);
      vi.spyOn(manager, 'syncEnabled').mockImplementation(() => { throw new Error('fixture sync failure'); });
      const result = await dispatch(handlers, IPC.sceneApply, [scene()]) as { warnings: string[] };
      expect(h.store.getSettings().layersEnabled).toEqual(['metar']); expect(result.warnings.join(' ')).toMatch(/committed.*providers/);
    } finally { manager.stop(); h.close(); vi.restoreAllMocks(); vi.useRealTimers(); }
  });

  it('keeps chooser validation separate from commit and exports only strict scene fields', async () => {
    const h = harness(); let exported = '';
    const platform: PlatformServices = { openTextFile: async () => JSON.stringify(scene()), saveTextFile: async (_name, _filters, text) => { exported = text; return 'local-selected-file.json'; }, savePdfFromHtml: async () => null, openExternal: () => false, getNetStats: () => [], setKiosk: () => false, captureScreenshot: async () => null, appVersion: 'test' };
    const handlers = createHandlers(h.core, h.store, async () => { throw new Error('No network in contract fixture'); }, platform);
    const parsed = await dispatch(handlers, IPC.sceneImport, []);
    expect(parsed).toEqual(scene()); expect(h.store.getSettings().basemap).toBe('atlas'); expect(h.changed).not.toHaveBeenCalled();
    await dispatch(handlers, IPC.sceneApply, [parsed]); expect(h.store.getSettings().basemap).toBe('streets');
    await dispatch(handlers, IPC.sceneExport, [parsed]);
    expect(JSON.parse(exported)).toEqual(scene()); expect(exported).not.toMatch(/Private organization|PRESERVED|credential-reference/);
    await expect(dispatch(handlers, IPC.sceneApply, [{ ...scene(), settings: { homeLat: 1 } }])).rejects.toThrow();
    h.close();
  });
});
