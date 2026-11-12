import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeArcgisPolygons, WFIGS_PERIMETER_LIMITS } from '../src/shared/layerNormalize';
import { FETCHERS, type FetchContext } from '../src/main/layers/fetchers';
import { FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { LayerManager } from '../src/main/layers/manager';
import { AtlasStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { pointInGeometry } from '../src/shared/geo';
import { tempDbPath } from './helpers';

const raw = JSON.parse(readFileSync(new URL('./fixtures/layers/wfigs-quality.geojson', import.meta.url), 'utf8'));
const feature = (id = 1, properties: Record<string, unknown> = {}, geometry: unknown = raw.features[1].geometry) => ({ type: 'Feature', id, geometry,
  properties: { OBJECTID: id, poly_IncidentName: 'Synthetic perimeter', attr_UniqueFireIdentifier: 'TEST-SAME-INCIDENT', ...properties } });
const collection = (features: unknown[] = [], extra: Record<string, unknown> = {}) => ({ type: 'FeatureCollection', features, ...extra });
const reply = (body: unknown) => ({ status: 200, body });
const context = (fetchJson: FetchJson): FetchContext => ({ settings: DEFAULT_SETTINGS, userAgent: 'AtlasWatch/fixture', now: new Date(),
  store: {} as AtlasStore, view: null, localReceiverUrl: null, fetchJson, fetchText: vi.fn() });
const fetchPerimeters = (fetchJson: FetchJson) => FETCHERS.firePerimeters(context(fetchJson));
const stores: AtlasStore[] = [], managers: LayerManager[] = [];
afterEach(() => { for (const m of managers.splice(0)) m.stop(); for (const s of stores.splice(0)) s.close(); });

describe('NIFC perimeter source normalization', () => {
  it('keeps distinct feature identities for one incident, all multipart geometry and holes verbatim', () => {
    const n = normalizeArcgisPolygons(raw, 'perimeter');
    expect(n).toMatchObject({ skipped: 0, sourceUpdatedAt: null }); expect(n.records).toHaveLength(2);
    expect(n.records.map(r => r.id)).toEqual(['wfigs:global:11111111-1111-1111-1111-111111111111', 'wfigs:global:22222222-2222-2222-2222-222222222222']);
    expect(n.records.map(r => r.props.incidentId)).toEqual(['TEST-SAME-INCIDENT', 'TEST-SAME-INCIDENT']);
    expect(n.records[0].geometry).toEqual(raw.features[0].geometry);
    expect(pointInGeometry(0.5, 0.5, n.records[0].geometry as never)).toBe(true);
    expect(pointInGeometry(1.5, 1.5, n.records[0].geometry as never)).toBe(false);
    expect(pointInGeometry(10.5, 10.5, n.records[0].geometry as never)).toBe(true);
  });
  it('keeps footprint acres separate from incident acres, including supplied zeros and null unknowns', () => {
    const [a, b] = normalizeArcgisPolygons(raw, 'perimeter').records;
    expect(a.props).toMatchObject({ gisAcres: 0, incidentAcres: 25, acres: 25, percentContained: 0, incidentType: 'RX', objectId: 0 });
    expect(b.props).toMatchObject({ gisAcres: 5, incidentAcres: 0, acres: 0, percentContained: 100 });
    expect(a.category).toBe('Prescribed fire perimeter'); expect(b.category).toBe('Wildfire perimeter');
    const unknown = normalizeArcgisPolygons(collection([feature(3, { poly_GISAcres: null, attr_IncidentSize: -1, attr_PercentContained: 101 })]), 'perimeter').records[0];
    expect(unknown.props).toMatchObject({ gisAcres: null, incidentAcres: null, acres: null, percentContained: null, incidentType: null });
    expect(unknown.category).toBe('Fire perimeter');
    expect(normalizeArcgisPolygons(collection([feature(4, { poly_GISAcres: '0', attr_IncidentSize: Infinity, attr_PercentContained: -1 })]), 'perimeter').records[0].props).toMatchObject({ gisAcres: null, incidentAcres: null, percentContained: null });
  });
  it('preserves source edit/capture/discovery dates independently and never substitutes retrieval time', () => {
    const r = normalizeArcgisPolygons(raw, 'perimeter').records[0], p = raw.features[0].properties;
    expect(r.props.dateCurrent).toBe(new Date(p.poly_DateCurrent).toISOString());
    expect(r.props.polygonDateTime).toBe(new Date(p.poly_PolygonDateTime).toISOString());
    expect(r.props.discovered).toBe(new Date(p.attr_FireDiscoveryDateTime).toISOString());
    expect(r.observedAt).toBe(r.props.dateCurrent); expect(r.props.state).toBe('US-CA');
    expect(r.sourceUrl).toBe('https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824');
    const missing = normalizeArcgisPolygons(collection([feature()]), 'perimeter').records[0];
    expect(missing.observedAt).toBeNull(); expect(missing.props.dateCurrent).toBeNull(); expect(missing.props.polygonDateTime).toBeNull();
    const captureOnly = normalizeArcgisPolygons(collection([feature(2, { poly_PolygonDateTime: 0 })]), 'perimeter').records[0];
    expect(captureOnly.observedAt).toBe('1970-01-01T00:00:00.000Z');
  });
  it('prefers stable GlobalID across OBJECTID changes and canonicalizes brace/case spellings', () => {
    const a = feature(1, { GlobalID: '{A1234567-1234-5678-ABCD-123456789ABC}' });
    const b = feature(999, { GlobalID: 'a1234567-1234-5678-abcd-123456789abc' });
    expect(normalizeArcgisPolygons(collection([a]), 'perimeter').records[0].id).toBe(normalizeArcgisPolygons(collection([b]), 'perimeter').records[0].id);
    expect(normalizeArcgisPolygons(collection([feature(0)]), 'perimeter').records[0].id).toBe('wfigs:object:0');
  });
  it('never synthesizes identity from incident names, incident IDs or a geometry center', () => {
    const f = feature(); delete (f as { id?: number }).id; delete (f.properties as { OBJECTID?: number }).OBJECTID;
    expect(normalizeArcgisPolygons(collection([f]), 'perimeter')).toMatchObject({ records: [], skipped: 1 });
    expect(normalizeArcgisPolygons(collection([null, { ...feature(), properties: null }]), 'perimeter')).toMatchObject({ records: [], skipped: 2 });
  });
  it('rejects null/string/nonfinite/out-of-range coordinates without converting them to zero; actual zeros remain', () => {
    for (const position of [[null, 0], [0, null], ['0', 0], [0, Infinity], [181, 0], [0, -91]]) {
      const bad = structuredClone(raw.features[0].geometry); bad.coordinates[1][0][1] = position;
      expect(normalizeArcgisPolygons(collection([feature(1, {}, bad)]), 'perimeter')).toMatchObject({ records: [], skipped: 1 });
    }
    expect(normalizeArcgisPolygons(raw, 'perimeter').records[0].geometry).toEqual(raw.features[0].geometry);
  });
  it('rejects explicit error envelopes, foreign CRS and absent FeatureCollection identity', () => {
    expect(() => normalizeArcgisPolygons(collection([], { error: { code: 500 } }), 'perimeter')).toThrow(/valid GeoJSON/);
    expect(() => normalizeArcgisPolygons({ features: [] }, 'perimeter')).toThrow(/valid GeoJSON/);
    expect(() => normalizeArcgisPolygons(collection([], { crs: { type: 'name', properties: { name: 'EPSG:3857' } } }), 'perimeter')).toThrow(/WGS84/);
    expect(normalizeArcgisPolygons(collection([], { crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::4326' } } }), 'perimeter').records).toEqual([]);
  });
});

describe('NIFC bounded complete paging', () => {
  it('uses source IDs across pages, advances by raw returned features and preserves existing geometry options', async () => {
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(collection([raw.features[0]], { properties: { exceededTransferLimit: true } })))
      .mockResolvedValueOnce(reply(collection([raw.features[1]], { exceededTransferLimit: false })));
    const n = await fetchPerimeters(fetch); expect(n.records).toHaveLength(2); expect(n.skipped).toBe(0);
    expect(n.note).toContain('2 perimeter features'); expect(n.note).toContain('not distinct incident counts');
    const first = new URL(fetch.mock.calls[0][0]), second = new URL(fetch.mock.calls[1][0]);
    expect(first.hostname).toBe('services3.arcgis.com'); expect(first.searchParams.get('outFields')?.split(',')).toEqual(expect.arrayContaining(['OBJECTID', 'GlobalID', 'attr_IncidentTypeCategory']));
    expect(first.searchParams.get('geometryPrecision')).toBe('5'); expect(first.searchParams.get('maxAllowableOffset')).toBe('0.0005'); expect(first.searchParams.get('outSR')).toBe('4326');
    expect(first.searchParams.get('resultRecordCount')).toBe('1000'); expect(second.searchParams.get('resultOffset')).toBe('1');
    expect(fetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 45000, maxBytes: 60 * 1024 * 1024 });
  });
  it('accepts a complete empty reply but not an empty advertised continuation', async () => {
    const n = await fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue(reply(collection()))); expect(n.records).toEqual([]);
    await expect(fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue(reply(collection([], { exceededTransferLimit: true }))))).rejects.toThrow(/continuation/);
  });
  it('rejects repeated feature IDs across pages rather than silently replacing one geometry', async () => {
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(collection([feature()], { exceededTransferLimit: true }))).mockResolvedValueOnce(reply(collection([feature()])));
    await expect(fetchPerimeters(fetch)).rejects.toThrow(/repeated/); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not silently accept the twentieth page while more remain', async () => {
    let id = 0;
    const fetch = vi.fn<FetchJson>(async () => reply(collection([feature(++id)], { exceededTransferLimit: true })));
    await expect(fetchPerimeters(fetch)).rejects.toThrow(/page limit/); expect(fetch).toHaveBeenCalledTimes(WFIGS_PERIMETER_LIMITS.pages);
  });
  it('checks a full page with an omitted continuation flag instead of assuming completeness', async () => {
    const full = collection(Array.from({ length: 1000 }, (_, i) => feature(i)));
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(full)).mockResolvedValueOnce(reply(collection()));
    expect((await fetchPerimeters(fetch)).records).toHaveLength(1000); expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('resultOffset')).toBe('1000');
  });
  it('rejects partial HTTP, skipped features, invalid flags and a failed later page', async () => {
    await expect(fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue({ status: 206, body: collection() }))).rejects.toThrow(/HTTP 200/);
    await expect(fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue(reply(collection([feature(2, {}, null)]))))).rejects.toThrow(/1 feature/);
    await expect(fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue(reply(collection([], { exceededTransferLimit: 'false' }))))).rejects.toThrow(/completeness flag/);
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(collection([feature()], { exceededTransferLimit: true }))).mockRejectedValueOnce(new FeedHttpError('HTTP 503', 503, 60, 'http'));
    await expect(fetchPerimeters(fetch)).rejects.toThrow(/503/);
  });
  it('bounds per-page feature count and cumulative coordinates across otherwise valid pages', async () => {
    await expect(fetchPerimeters(vi.fn<FetchJson>().mockResolvedValue(reply(collection(Array.from({ length: 1001 }, (_, i) => feature(i))))))).rejects.toThrow(/feature limit/);
    const large = { type: 'Polygon', coordinates: [Array.from({ length: 260000 }, () => [0, 0])] };
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(collection([feature(1, {}, large)], { exceededTransferLimit: true })))
      .mockResolvedValueOnce(reply(collection([feature(2, {}, large)])));
    await expect(fetchPerimeters(fetch)).rejects.toThrow(/coordinate limit/); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('leaves the existing airspace adapter options and permissive legacy response shape unchanged', async () => {
    const fetch = vi.fn<FetchJson>().mockResolvedValue(reply({ features: [{ geometry: raw.features[1].geometry, properties: { GLOBAL_ID: 'FAA-ONE', NAME: 'Area' } }] }));
    const n = await FETCHERS.airspace(context(fetch)); expect(n.records[0].id).toBe('FAA-ONE');
    expect(fetch.mock.calls[0][0]).not.toContain('WFIGS'); expect(fetch.mock.calls[0][0]).not.toContain('IncidentTypeCategory');
  });
});

describe('perimeter refresh reconciliation', () => {
  it('retains prior complete members and their time after malformed or truncated replies, then accepts a real empty set', async () => {
    let now = Date.parse('2026-11-12T00:00:00Z');
    const fetch = vi.fn<FetchJson>().mockResolvedValueOnce(reply(collection([feature(7)])))
      .mockResolvedValueOnce(reply(collection([feature(99), feature(100, {}, null)])))
      .mockResolvedValueOnce(reply(collection([], { exceededTransferLimit: true })))
      .mockResolvedValueOnce(reply(collection()));
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    const m = new LayerManager({ store, fetchJson: fetch, fetchText: vi.fn(), getSettings: () => ({ ...DEFAULT_SETTINGS, layersEnabled: ['firePerimeters'] }),
      userAgent: () => 'AtlasWatch/fixture', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: vi.fn(), now: () => new Date(now) }); managers.push(m);
    await m.refresh('firePerimeters'); const original = m.snapshot('firePerimeters');
    now += 1000; await m.refresh('firePerimeters');
    expect(m.snapshot('firePerimeters')).toMatchObject({ records: original.records, status: { state: 'error', lastSuccessAt: original.status.lastSuccessAt, recordCount: 1 } });
    expect(m.snapshot('firePerimeters').records.map(r => r.id)).toEqual(['wfigs:object:7']);
    now += 1000; await m.refresh('firePerimeters');
    expect(m.snapshot('firePerimeters')).toMatchObject({ records: original.records, status: { state: 'error', lastSuccessAt: original.status.lastSuccessAt } });
    now += 1000; await m.refresh('firePerimeters');
    expect(m.snapshot('firePerimeters')).toMatchObject({ records: [], status: { state: 'ok', recordCount: 0, lastSuccessAt: new Date(now).toISOString() } });
  });
  it('leaves the first unavailable perimeter reply without a successful observation', async () => {
    const store = new AtlasStore(tempDbPath()); stores.push(store);
    const m = new LayerManager({ store, fetchJson: vi.fn<FetchJson>().mockResolvedValue(reply(collection([], { error: { code: 500 } }))), fetchText: vi.fn(),
      getSettings: () => ({ ...DEFAULT_SETTINGS, layersEnabled: ['firePerimeters'] }), userAgent: () => 'AtlasWatch/fixture', localReceiverUrl: () => null,
      ais: null, aisConfigured: () => false, emit: vi.fn() }); managers.push(m);
    await m.refresh('firePerimeters');
    expect(m.snapshot('firePerimeters')).toMatchObject({ records: [], status: { state: 'error', recordCount: 0, lastSuccessAt: null, freshness: 'unavailable' } });
  });
});
