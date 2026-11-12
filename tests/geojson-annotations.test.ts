import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { AppCore } from '../src/main/core';
import { createHandlers, dispatch, type PlatformServices } from '../src/main/handlers';
import { AtlasStore } from '../src/main/store';
import { annotationsToGeoJson, assertGeoJsonText, GEOJSON_MAX_BYTES, previewGeoJsonAnnotations, type AnnotationDocument, type GeoJsonFilePreview } from '../src/shared/geojsonAnnotations';
import { IPC, validateIpcArgs } from '../src/shared/ipc';
import { tempDbPath } from './helpers';

const sample = () => readFileSync(join(__dirname, 'fixtures', 'geojson-annotations.json'), 'utf8');
const text = (geometry: unknown, properties: unknown = { name: 'Test' }) => JSON.stringify({ type: 'Feature', geometry, properties });
const point = (coordinates: unknown = [10, -30]) => ({ type: 'Point', coordinates });
const doc = (over: Partial<AnnotationDocument> = {}): AnnotationDocument => ({ id: 'existing-id', kind: 'pin', name: 'Existing', color: '#ffd166', points: [[5, 6]], visible: true, createdAt: '2026-11-11T00:00:00.000Z', ...over });

describe('bounded RFC 7946 annotation subset', () => {
  it('preserves Unicode, south, date-line and boundary positions; reports every skipped feature', () => {
    const result = previewGeoJsonAnnotations(sample());
    expect(result).toMatchObject({ featureCount: 9, duplicates: 1, coordinateCount: 8 });
    expect(result.candidates.map(a => a.kind)).toEqual(['pin', 'line', 'area']);
    expect(result.candidates[0]).toMatchObject({ name: 'ケープタウン / Кейптаун', points: [[18.4241, -33.9249]], color: '#5fd0e6' });
    expect(result.candidates[1].points).toEqual([[179, -10], [-179, -11]]);
    expect(result.candidates[2]).toMatchObject({ points: [[-180, -30], [-179, -30], [-179, -29]], visible: false });
    expect(result.rejected.map(i => i.feature)).toEqual([5, 6, 7, 8, 9]);
    expect(result.rejected[0].message).toMatch(/holes.*without flattening/);
    expect(JSON.stringify(result.candidates)).not.toMatch(/secret|private-source-note|existing-id|apiKey|token|notes/);
  });
  it.each([point(), { type: 'LineString', coordinates: [[-180, -90], [180, 90]] }, { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] }])('accepts bare supported geometry %j', geometry => {
    expect(previewGeoJsonAnnotations(JSON.stringify(geometry)).candidates).toHaveLength(1);
  });
  it.each([[181, 0], [0, -91], ['10', 20], [10], [1, 2, 3], null].map(coordinates => ({ coordinates })))('does not repair invalid positions %j', ({ coordinates }) => {
    const result = previewGeoJsonAnnotations(text(point(coordinates)));
    expect(result.candidates).toEqual([]); expect(result.rejected).toHaveLength(1);
  });
  it.each([
    { type: 'LineString', coordinates: [[0, 0]] },
    { type: 'LineString', coordinates: [[0, 0], [0, 0]] },
    { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [2, 0]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [0, 0], [0, 0]]] },
    { type: 'GeometryCollection', geometries: [] }, null,
  ])('rejects malformed/unsupported geometry without invented positions %j', geometry => {
    expect(previewGeoJsonAnnotations(text(geometry)).rejected).toHaveLength(1);
  });
  it('rejects explicit CRS at collection, feature or geometry level', () => {
    expect(() => previewGeoJsonAnnotations(JSON.stringify({ type: 'FeatureCollection', crs: null, features: [] }))).toThrow(/CRS/);
    expect(previewGeoJsonAnnotations(text({ ...point(), crs: null })).rejected[0].message).toMatch(/CRS/);
  });
  it.each([{ coordinates: [[180, 0], [-180, 0]] }, { coordinates: [[0, 90], [120, 90]] }])('rejects physically zero-length lines %j', ({ coordinates }) => {
    const result = previewGeoJsonAnnotations(text({ type: 'LineString', coordinates }));
    expect(result.candidates).toEqual([]);
    expect(result.rejected[0].message).toMatch(/geographically distinct/);
  });
  it('requires Feature objects inside a FeatureCollection while accepting bare root geometry', () => {
    expect(previewGeoJsonAnnotations(JSON.stringify({ type: 'FeatureCollection', features: [point()] })).rejected[0].message).toMatch(/Feature objects/);
    expect(previewGeoJsonAnnotations(JSON.stringify(point())).candidates).toHaveLength(1);
  });
  it.each([
    [[0, 0], [1, 0], [2, 0], [0, 0]],
    [[0, 1], [1, 1], [2, 1], [0, 1]],
    [[0, 0], [4, 4], [0, 3], [3, 0], [0, 0]],
    [[0, 0], [3, 0], [1, 1], [3, 2], [0, 2], [1, 1], [0, 0]],
    [[180, 0], [-180, 0], [-179, 1], [179, 1], [180, 0]],
  ].map(ring => ({ ring })))('rejects degenerate or self-intersecting exterior %j', ({ ring }) => {
    expect(previewGeoJsonAnnotations(text({ type: 'Polygon', coordinates: [ring] })).rejected).toHaveLength(1);
  });
  it('bounds adversarial overlapping-edge validation and accepts a simple 4,999-vertex ring', () => {
    const ring = Array.from({ length: 4999 }, (_, i) => [Math.cos(i * Math.PI * 2 / 4999), Math.sin(i * Math.PI * 2 / 4999)]);
    ring.push(ring[0]);
    expect(previewGeoJsonAnnotations(text({ type: 'Polygon', coordinates: [ring] })).candidates).toHaveLength(1);
    // Nonadjacent edges deliberately cross; the parser must reject rather than hand this to Cesium.
    const star = Array.from({ length: 4999 }, (_, i) => ring[(i * 2499) % 4999]);
    star.push(star[0]);
    expect(previewGeoJsonAnnotations(text({ type: 'Polygon', coordinates: [star] })).rejected).toHaveLength(1);
  });
  it.each([{ name: '' }, { name: 'a'.repeat(121) }, { name: 'a\nb' }, { color: 'javascript:bad' }, { visible: 'yes' }])('rejects invalid whitelisted properties %j', properties => {
    expect(previewGeoJsonAnnotations(text(point(), properties)).rejected).toHaveLength(1);
  });
  it('enforces actual UTF-8 bytes, feature, per-geometry and aggregate coordinate limits', () => {
    expect(() => assertGeoJsonText('界'.repeat(Math.ceil(GEOJSON_MAX_BYTES / 3)))).toThrow(/2 MiB/);
    expect(() => previewGeoJsonAnnotations(JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 2001 }, () => JSON.parse(text(point()))) }))).toThrow(/2000/);
    expect(previewGeoJsonAnnotations(text({ type: 'LineString', coordinates: Array.from({ length: 5001 }, (_, i) => [i / 100, 0]) })).rejected[0].message).toMatch(/5,000/);
    const lines = Array.from({ length: 5 }, (_, j) => JSON.parse(text({ type: 'LineString', coordinates: Array.from({ length: 5000 }, (_, i) => [i / 100, j]) })));
    expect(() => previewGeoJsonAnnotations(JSON.stringify({ type: 'FeatureCollection', features: lines }))).toThrow(/20,000/);
  });
  it('counts exact name/geometry duplicates against saved and earlier file records', () => {
    const first = previewGeoJsonAnnotations(sample()).candidates[0];
    const result = previewGeoJsonAnnotations(sample(), [first]);
    expect(result.duplicates).toBe(2); expect(result.candidates).toHaveLength(2);
    expect(previewGeoJsonAnnotations(text(point(), { name: 'Different' }), [doc({ points: [[10, -30]] })]).candidates).toHaveLength(1);
  });
  it('exports standard geometry with a closed ring and only three safe properties', () => {
    const candidates = previewGeoJsonAnnotations(sample()).candidates;
    const output = annotationsToGeoJson(candidates.map(a => ({ ...a, notes: 'private', apiKey: 'secret' })));
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe('FeatureCollection');
    expect(parsed.features[2].geometry.coordinates[0]).toHaveLength(4);
    expect(Object.keys(parsed.features[0].properties)).toEqual(['name', 'color', 'visible']);
    expect(output).not.toMatch(/private|secret|apiKey|notes|createdAt|existing-id/);
    expect(previewGeoJsonAnnotations(output).candidates).toEqual(candidates);
    expect(previewGeoJsonAnnotations(output, candidates).duplicates).toBe(3);
  });
  it('exports clockwise sources counterclockwise while retaining duplicate identity and coordinates', () => {
    const source = previewGeoJsonAnnotations(text({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] })).candidates;
    const exported = annotationsToGeoJson(source);
    expect(JSON.parse(exported).features[0].geometry.coordinates[0]).toEqual([[0, 0], [1, 0], [0, 1], [0, 0]]);
    expect(previewGeoJsonAnnotations(exported, source).duplicates).toBe(1);
  });
});

describe('atomic annotation import and restart preservation', () => {
  it('uses new IDs, preserves existing rows and private saved places, and deduplicates again at commit', () => {
    const path = tempDbPath(); const store = new AtlasStore(path);
    store.putDoc('annotations', 'existing-id', doc(), doc().createdAt);
    const before = store.listDocs('annotations');
    expect(previewGeoJsonAnnotations(sample(), before as AnnotationDocument[]).candidates).toHaveLength(3);
    const first = JSON.parse(sample()).features[0];
    expect(store.importGeoJsonAnnotations(JSON.stringify(first)).imported).toBe(1);
    const result = store.importGeoJsonAnnotations(sample());
    expect(result).toMatchObject({ imported: 2, duplicates: 2 });
    expect(result.annotations.find(a => a.id === 'existing-id')).toEqual(doc());
    expect(result.annotations.filter(a => a.id !== 'existing-id').every(a => a.id !== first.id)).toBe(true);
    expect(JSON.stringify(result.annotations)).not.toMatch(/source-secret|private-source-note|apiKey|token/);
    store.close();
    const reopened = new AtlasStore(path);
    expect(reopened.listDocs('annotations')).toEqual(result.annotations);
    expect(reopened.importGeoJsonAnnotations(sample()).imported).toBe(0);
    reopened.close();
  });
  it('rolls back an earlier successful insert when a later SQLite insert fails', () => {
    const path = tempDbPath(); const store = new AtlasStore(path);
    store.putDoc('annotations', 'keep', doc({ id: 'keep' }), doc().createdAt);
    const setup = new DatabaseSync(path);
    setup.exec(`CREATE TRIGGER reject_test_line BEFORE INSERT ON annotations WHEN json_extract(NEW.data, '$.kind') = 'line' BEGIN SELECT RAISE(ABORT, 'deliberate test failure'); END;`);
    setup.close();
    expect(() => store.importGeoJsonAnnotations(sample())).toThrow(/deliberate test failure/);
    expect(store.listDocs('annotations')).toEqual([doc({ id: 'keep' })]);
    store.close();
  });
  it('rejects an import exceeding stored capacity without partial insertion', () => {
    const store = new AtlasStore(tempDbPath());
    for (let i = 0; i < 1999; i++) store.putDoc('annotations', `a-${i}`, doc({ id: `a-${i}`, name: `Old ${i}` }), doc().createdAt);
    expect(() => store.importGeoJsonAnnotations(sample())).toThrow(/2,000/);
    expect(store.listDocs('annotations')).toHaveLength(1999);
    store.close();
  });
  it('exports and reimports all 2,000 stored pins into a fresh database without the old 200-feature mismatch', () => {
    const source = new AtlasStore(tempDbPath());
    for (let i = 0; i < 2000; i++) {
      const annotation = doc({ id: `pin-${i}`, name: `場所 ${i}`, points: [[i / 20 - 50, -30]] });
      source.putDoc('annotations', annotation.id, annotation, annotation.createdAt);
    }
    const exported = annotationsToGeoJson(source.listDocs<AnnotationDocument>('annotations'));
    expect(previewGeoJsonAnnotations(exported)).toMatchObject({ featureCount: 2000, duplicates: 0, rejected: [] });
    const destination = new AtlasStore(tempDbPath());
    const result = destination.importGeoJsonAnnotations(exported);
    expect(result.imported).toBe(2000);
    expect(result.annotations.map(a => a.name).sort()).toEqual(source.listDocs<AnnotationDocument>('annotations').map(a => a.name).sort());
    expect(destination.importGeoJsonAnnotations(exported)).toMatchObject({ imported: 0, duplicates: 2000 });
    source.close(); destination.close();
  });
});

describe('narrow GeoJSON IPC boundaries', () => {
  function harness() {
    const store = new AtlasStore(tempDbPath());
    const core = new AppCore({ store, alertSource: { name: 'test', fetchActiveAlerts: async () => ({ alerts: [], skipped: 0, sourceUpdatedAt: null }), fetchPointZones: async () => ({ status: 'disabled', zones: [], checkedAt: null, error: null }) }, quakeSource: { name: 'test', fetchRecent: async () => ({ quakes: [], skipped: 0, sourceUpdatedAt: null, feedKey: 'test' }) } });
    const platform: PlatformServices = { saveTextFile: vi.fn(async () => 'annotations.geojson'), openTextFile: vi.fn(async () => sample()), savePdfFromHtml: async () => null, openExternal: () => false, getNetStats: () => [], setKiosk: () => true, captureScreenshot: async () => null, appVersion: 'test' };
    const handlers = createHandlers(core, store, async () => { throw new Error('No network'); }, platform);
    return { store, platform, handlers };
  }
  it('chooses/validates only, then reparses commit and exports stored rows through the existing dialog', async () => {
    const { store, platform, handlers } = harness();
    const preview = await dispatch(handlers, IPC.annotationsGeoJsonPreview, []) as GeoJsonFilePreview;
    expect(preview.preview.candidates).toHaveLength(3);
    expect(platform.openTextFile).toHaveBeenCalledWith([{ name: 'GeoJSON annotations', extensions: ['geojson', 'json'] }], GEOJSON_MAX_BYTES);
    expect(store.listDocs('annotations')).toEqual([]);
    await expect(dispatch(handlers, IPC.annotationsGeoJsonImport, ['{bad'])).rejects.toThrow(/valid GeoJSON/);
    expect(store.listDocs('annotations')).toEqual([]);
    await dispatch(handlers, IPC.annotationsGeoJsonImport, [preview.text]);
    await dispatch(handlers, IPC.annotationsGeoJsonExport, []);
    expect(platform.saveTextFile).toHaveBeenCalledWith('atlas-watch-annotations.geojson', [{ name: 'GeoJSON', extensions: ['geojson'] }], expect.stringContaining('FeatureCollection'));
    store.close();
  });
  it('handles chooser cancellation and rejects arbitrary file paths/objects/oversized UTF-8 before mutation', async () => {
    const { store, platform, handlers } = harness();
    platform.openTextFile = async () => null;
    expect(await dispatch(handlers, IPC.annotationsGeoJsonPreview, [])).toBeNull();
    for (const args of [[{ path: 'C:/private/key' }], ['x', 'extra'], ['界'.repeat(Math.ceil(GEOJSON_MAX_BYTES / 3))]])
      expect(() => validateIpcArgs(IPC.annotationsGeoJsonImport, args)).toThrow();
    await expect(dispatch(handlers, IPC.annotationsGeoJsonPreview, ['C:/private/key'])).rejects.toThrow();
    await expect(dispatch(handlers, IPC.annotationsGeoJsonExport, [{ notes: 'private' }])).rejects.toThrow();
    expect(store.listDocs('annotations')).toEqual([]);
    store.close();
  });
});
