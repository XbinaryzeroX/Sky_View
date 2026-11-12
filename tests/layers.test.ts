import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, FeedHttpError, isAllowedLocalReceiverUrl, setLocalReceiverUrl, type FetchJson, type FetchText } from '../src/main/feeds/http';
import { AisStreamClient } from '../src/main/layers/aisstream';
import { aircraftRadiusNm } from '../src/main/layers/fetchers';
import { LayerManager, viewMovedEnough } from '../src/main/layers/manager';
import { redactSecrets, SecretStore, type Cipher } from '../src/main/secrets';
import { AtlasStore } from '../src/main/store';
import { parseCoordinates, pathLengthKm, polygonAreaKm2 } from '../src/shared/geo';
import { DEFAULT_SETTINGS, sceneSchema, validateIpcArgs, IPC } from '../src/shared/ipc';
import {
  normalizeAdsb,
  normalizeArcgisPolygons,
  normalizeCaltrans,
  normalizeDigitrafficAis,
  normalizeFirmsCsv,
  normalizeMbta,
  normalizeMetar,
  normalizeNhc,
  normalizeTle,
} from '../src/shared/layerNormalize';
import { buildCsp, isAllowedRendererUrl } from '../src/shared/remoteHosts';
import type { Settings } from '../src/shared/types';
import { tempDbPath } from './helpers';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', 'layers', n), 'utf8');
const fxJson = (n: string) => JSON.parse(fx(n));

describe('aircraft (ADS-B) normalization', () => {
  it('parses adsb.lol records with age, altitude, category and military flag; skips invalid and duplicate ids', () => {
    const n = normalizeAdsb(fxJson('adsb.json'), 'adsb.lol', 0);
    expect(n.records.map((r) => r.id)).toEqual(['a1373d', 'ae2673']);
    expect(n.skipped).toBe(3);
    const dal = n.records[0];
    expect(dal.label).toBe('DAL1732');
    expect(dal.altM).toBeCloseTo(38000 * 0.3048, 1);
    expect(dal.category).toBe('Heavy aircraft');
    expect(dal.observedAt).toBe(new Date(1794212000000 - 2500).toISOString());
    const mil = n.records[1];
    expect(mil.props.militaryFlag).toBe(true);
    expect(mil.props.onGround).toBe(true);
    expect(mil.altM).toBe(0);
  });
  it('keeps altitudes above sea level: GNSS-only (ellipsoid) altitudes are converted with the geoid', () => {
    const body = {
      now: 1794212000,
      ac: [
        { hex: 'aaa001', lat: 40.69, lon: -74.04, alt_baro: 3000, alt_geom: 2900, seen_pos: 0 },
        { hex: 'aaa002', lat: 40.69, lon: -74.04, alt_geom: 3000, seen_pos: 0 },
        { hex: 'aaa003', lat: 40.69, lon: -74.04, alt_baro: 'ground', alt_geom: 120, seen_pos: 0 },
        { hex: 'aaa004', lat: 40.69, lon: -74.04, seen_pos: 0 },
      ],
    };
    const nyc = () => -33; // sea level 33 m below the ellipsoid
    const [baro, geom, ground, none] = normalizeAdsb(body, 'test', 0, nyc).records;
    expect(baro.altM).toBeCloseTo(3000 * 0.3048, 6); // barometric: unchanged
    expect(baro.props.altitudeFt).toBe(3000);
    expect(geom.altM).toBeCloseTo(3000 * 0.3048 + 33, 6); // ellipsoid height − N = height above sea level
    expect(geom.props.altitudeFt).toBe(Math.round((3000 * 0.3048 + 33) / 0.3048));
    expect(ground.altM).toBe(0);
    expect(none.altM).toBeNull();
    // Without the grid: as reported.
    expect(normalizeAdsb(body, 'test', 0).records[1].altM).toBeCloseTo(3000 * 0.3048, 6);
  });
  it('accepts readsb aircraft.json from a local receiver (seconds-based clock)', () => {
    const n = normalizeAdsb(fxJson('readsb.json'), 'Local receiver', 0);
    expect(n.records[0].observedAt).toBe(new Date(1794212000500 - 200).toISOString());
  });
  it('picks a query radius from camera altitude within provider limits', () => {
    expect(aircraftRadiusNm(10_000)).toBe(25);
    expect(aircraftRadiusNm(400_000)).toBe(194);
    expect(aircraftRadiusNm(3_000_000)).toBe(250);
  });
});

describe('other layer normalizers', () => {
  it('AIS: merges metadata, falls back to course when heading is unavailable (511)', () => {
    const meta = new Map([[265588910, { name: 'PILOT 151 SE', shipType: 50, destination: 'SANDHAMN', callSign: 'SFC5176' }]]);
    const n = normalizeDigitrafficAis(fxJson('digitraffic-locations.json'), meta);
    expect(n.records).toHaveLength(2);
    expect(n.skipped).toBe(1);
    expect(n.records[0]).toMatchObject({ id: '265588910', label: 'PILOT 151 SE', category: 'Pilot vessel', heading: 146 });
    expect(n.records[1]).toMatchObject({ label: 'MMSI 230000001', heading: 0 });
    expect(n.records[1].props.navStatus).toBe('Moored');
  });
  it('TLE: parses elements and epoch; skips broken entries; marks positions as calculated (no lat/lon claimed)', () => {
    const n = normalizeTle(fx('stations.tle'), 'stations');
    expect(n.records).toHaveLength(1);
    expect(n.skipped).toBeGreaterThan(0);
    expect(n.records[0]).toMatchObject({ id: '25544', label: 'ISS (ZARYA)' });
    expect(n.records[0].tle?.[0].startsWith('1 25544')).toBe(true);
    expect(n.records[0].observedAt?.startsWith('2026-11-08')).toBe(true);
    expect(n.records[0].source).toMatch(/calculated/);
  });
  it('FIRMS: parses detections with UTC acquisition time and stable ids', () => {
    const n = normalizeFirmsCsv(fx('firms.csv'), 'USA');
    expect(n.records).toHaveLength(2);
    expect(n.skipped).toBe(1);
    expect(n.records[0].observedAt).toBe('2026-11-08T21:30:00.000Z');
    expect(n.records[1].observedAt).toBe('2026-11-08T00:09:00.000Z');
    expect(n.records[0].id).toBe('34.12345,-118.54321,2026-11-08T2130,N20');
    expect(n.sourceUpdatedAt).toBe('2026-11-08T21:30:00.000Z');
  });
  it('METAR: parses observations; null (HTTP 204) means no records, not failure', () => {
    const n = normalizeMetar(fxJson('metar.json'));
    expect(n.records).toHaveLength(1);
    expect(n.records[0]).toMatchObject({ id: 'KDEN', category: 'VFR' });
    expect(n.records[0].observedAt).toBe(new Date(1794210000 * 1000).toISOString());
    expect(normalizeMetar(null).records).toEqual([]);
    expect(() => normalizeMetar({ error: 'x' })).toThrow();
  });
  it('NHC: parses storms and drops non-NHC links', () => {
    const n = normalizeNhc(fxJson('nhc.json'));
    expect(n.records[0]).toMatchObject({ id: 'cp042026', label: 'Tropical Storm Pena', lat: 11.4, lon: -157.6 });
    expect(n.records[0].sourceUrl).toMatch(/^https:\/\/www\.nhc\.noaa\.gov\//);
    expect(n.records[0].props.forecastGraphics).toBeNull();
  });
  it('Caltrans: keeps in-service cameras with Caltrans image URLs only; catalog date is not presented as image time', () => {
    const n = normalizeCaltrans(fxJson('caltrans.json'), 1);
    expect(n.records).toHaveLength(1);
    expect(n.skipped).toBe(2);
    expect(n.records[0].imageUrl).toMatch(/^https:\/\/cwwp2\.dot\.ca\.gov\//);
    expect(n.records[0].observedAt).toBeNull();
    expect(n.records[0].props.catalogRecordUpdated).toBe('2026-05-14 20:56:28 (California local time)');
  });
  it('MBTA: resolves route and mode', () => {
    const n = normalizeMbta(fxJson('mbta.json'));
    expect(n.records).toHaveLength(1);
    expect(n.records[0]).toMatchObject({ id: 'G-10057', category: 'Light rail' });
    expect(n.records[0].observedAt).toBe('2026-11-09T06:42:18.000Z');
  });
  it('WFIGS perimeters: polygons with incident facts; missing geometry skipped', () => {
    const n = normalizeArcgisPolygons(fxJson('wfigs.geojson'), 'perimeter');
    expect(n.records).toHaveLength(1);
    expect(n.records[0]).toMatchObject({ id: 'wfigs:object:7', label: 'South Street', props: { incidentId: '2026-UTNWS-200030' } });
    expect(n.records[0].geometry?.type).toBe('Polygon');
    expect(n.records[0].props.percentContained).toBe(100);
  });
});

describe('AISStream message handling', () => {
  it('stores position reports keyed by MMSI and ignores invalid ones', () => {
    const c = new AisStreamClient(() => 'k', () => {}, () => ({ send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null }));
    c.handle({ MessageType: 'PositionReport', MetaData: { MMSI: 123456789, ShipName: 'TEST SHIP ', time_utc: new Date().toISOString() }, Message: { PositionReport: { Latitude: 37.8, Longitude: -122.4, Sog: 10, Cog: 90, TrueHeading: 511 } } });
    c.handle({ MessageType: 'PositionReport', MetaData: { MMSI: 2 }, Message: { PositionReport: { Latitude: 91, Longitude: 0 } } });
    const recs = c.records(Date.now());
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ id: '123456789', label: 'TEST SHIP', heading: 90 });
  });
});

describe('layer manager', () => {
  function settings(over: Partial<Settings> = {}): Settings {
    return { ...DEFAULT_SETTINGS, ...over };
  }
  it('fetches only enabled layers, keeps last-known data on failure, and reconciles removals', async () => {
    let fail = false;
    let body: unknown = { now: Date.now(), ac: [{ hex: 'abc123', lat: 40, lon: -105, seen_pos: 1 }, { hex: 'abc124', lat: 40.1, lon: -105, seen_pos: 1 }] };
    const calls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      calls.push(url);
      if (fail) throw new FeedHttpError('Network error', null, null, 'network');
      return { status: 200, body };
    };
    const fetchText: FetchText = async () => ({ status: 200, text: '' });
    const s = settings({ layersEnabled: ['aircraft'] });
    const emits: string[] = [];
    const lm = new LayerManager({ store: new AtlasStore(tempDbPath()), fetchJson, fetchText, getSettings: () => s, userAgent: () => 'test', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: (id) => emits.push(id) });
    lm.setView({ lat: 40, lon: -105, heightM: 200_000, bbox: [-106, 39, -104, 41] });
    await new Promise((r) => setTimeout(r, 1300));
    await lm.refresh('aircraft');
    expect(lm.snapshot('aircraft').records.map((r) => r.id)).toEqual(['abc123', 'abc124']);
    expect(calls.every((u) => u.startsWith('https://api.adsb.lol/v2/point/'))).toBe(true);
    // Removal: second fetch omits one aircraft.
    body = { now: Date.now(), ac: [{ hex: 'abc123', lat: 40.2, lon: -105, seen_pos: 0 }] };
    await lm.refresh('aircraft');
    expect(lm.snapshot('aircraft').records.map((r) => r.id)).toEqual(['abc123']);
    const okAt = lm.snapshot('aircraft').status.lastSuccessAt;
    fail = true;
    await lm.refresh('aircraft');
    const st = lm.snapshot('aircraft').status;
    expect(st.state).toBe('error');
    expect(st.lastSuccessAt).toBe(okAt);
    expect(lm.snapshot('aircraft').records).toHaveLength(1);
    expect(lm.snapshot('vessels').status.enabled).toBe(false);
    lm.stop();
  });
  it('records observed track points without duplicates', async () => {
    const store = new AtlasStore(tempDbPath());
    const t = new Date().toISOString();
    expect(store.addTrackPoints('aircraft', [{ rid: 'a', t, lat: 1, lon: 2, alt: 100, heading: 90 }])).toBe(1);
    expect(store.addTrackPoints('aircraft', [{ rid: 'a', t, lat: 1, lon: 2, alt: 100, heading: 90 }])).toBe(0);
    expect(store.trackFor('aircraft', 'a')).toHaveLength(1);
    expect(store.trackSnapshot('aircraft', new Date(Date.parse(t) + 1000).toISOString(), 300_000)).toHaveLength(1);
    expect(store.trackSnapshot('aircraft', new Date(Date.parse(t) + 600_000).toISOString(), 300_000)).toHaveLength(0);
  });
  it('records whether an aircraft was on the ground with each track point', () => {
    const store = new AtlasStore(tempDbPath());
    const t0 = Date.parse('2026-11-11T10:00:00Z');
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    store.addTrackPoints('aircraft', [
      { rid: 'g', t: at(0), lat: 1, lon: 2, alt: 0, heading: 0, ground: true },
      { rid: 'g', t: at(10), lat: 1, lon: 2.01, alt: 150, heading: 0, ground: false },
      { rid: 'g', t: at(20), lat: 1, lon: 2.02, alt: null, heading: 0, ground: false },
      { rid: 'g', t: at(30), lat: 1, lon: 2.03, alt: 300, heading: 0 },
    ]);
    expect(store.trackFor('aircraft', 'g').map((p) => p.onGround)).toEqual([true, false, false, null]);
    // History playback reads the same flag.
    expect(store.trackSnapshot('aircraft', at(5), 60_000)).toEqual([{ rid: 'g', t: at(0), lat: 1, lon: 2, altM: 0, heading: 0, onGround: true }]);
    expect(store.trackSnapshot('aircraft', at(35), 60_000)[0].onGround).toBeNull();
  });
  it('adds the on-ground column to a database recorded before it existed', async () => {
    const path = tempDbPath();
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE track_points (layer TEXT NOT NULL, rid TEXT NOT NULL, t TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, alt REAL, heading REAL, PRIMARY KEY (layer, rid, t));`);
    old.prepare('INSERT INTO track_points VALUES (?, ?, ?, ?, ?, ?, ?)').run('aircraft', 'old', '2026-11-01T00:00:00.000Z', 1, 2, 0, 90);
    old.close();
    const store = new AtlasStore(path);
    expect(store.trackFor('aircraft', 'old')).toEqual([{ t: '2026-11-01T00:00:00.000Z', lat: 1, lon: 2, altM: 0, heading: 90, onGround: null }]);
    store.addTrackPoints('aircraft', [{ rid: 'old', t: '2026-11-01T00:00:10.000Z', lat: 1, lon: 2, alt: 0, heading: 90, ground: true }]);
    expect(store.trackFor('aircraft', 'old').map((p) => p.onGround)).toEqual([null, true]);
    store.close();
    // Opening it again does not try to add the column twice.
    expect(() => new AtlasStore(path).close()).not.toThrow();
  });
  it('treats small camera moves as the same view', () => {
    const a = { lat: 40, lon: -105, heightM: 200_000, bbox: [-106, 39, -104, 41] as [number, number, number, number] };
    expect(viewMovedEnough(null, a)).toBe(true);
    expect(viewMovedEnough(a, { ...a, lat: 40.01 })).toBe(false);
    expect(viewMovedEnough(a, { ...a, lat: 41 })).toBe(true);
    expect(viewMovedEnough(a, { ...a, heightM: 50_000 })).toBe(true);
  });
});

describe('credentials', () => {
  const fakeCipher: Cipher = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`), decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString() };
  it('stores secrets encrypted and never as plaintext', () => {
    const store = new AtlasStore(tempDbPath());
    const secrets = new SecretStore(store, fakeCipher);
    secrets.set('aisstream', 'super-secret-key-123');
    expect(secrets.get('aisstream')).toBe('super-secret-key-123');
    expect(store.getMeta('secret:aisstream')).not.toContain('super-secret-key-123');
    secrets.set('aisstream', null);
    expect(secrets.has('aisstream')).toBe(false);
  });
  it('refuses to store when OS encryption is unavailable', () => {
    const secrets = new SecretStore(new AtlasStore(tempDbPath()), { ...fakeCipher, isEncryptionAvailable: () => false });
    expect(() => secrets.set('google3d', 'AIzaTestKey123456')).toThrow(/credential store/);
  });
  it('redacts keys from messages', () => {
    expect(redactSecrets('failed https://tile.googleapis.com/v1/3dtiles/root.json?key=AIzaSECRET123 (AIzaSECRET123)', ['AIzaSECRET123'])).not.toContain('AIzaSECRET123');
    expect(redactSecrets('GET /x?apikey=abcdef123456&y=1', [])).toBe('GET /x?apikey=[redacted]&y=1');
  });
});

describe('network allow-lists', () => {
  it('main process: allows fixed feed hosts and specific ArcGIS services only', () => {
    expect(() => assertAllowedUrl('https://api.adsb.lol/v2/mil')).not.toThrow();
    expect(() => assertAllowedUrl('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?f=json')).not.toThrow();
    expect(() => assertAllowedUrl('https://services3.arcgis.com/OTHERTENANT/arcgis/rest/services/x')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://user:pw@api.adsb.lol/v2/mil')).toThrow(/Blocked/);
  });
  it('local receiver: only literal private IPv4 addresses and aircraft.json', () => {
    expect(isAllowedLocalReceiverUrl('http://192.168.1.50/tar1090/data/aircraft.json')).toBe(true);
    expect(isAllowedLocalReceiverUrl('http://10.0.0.5:8080/data/aircraft.json')).toBe(true);
    expect(isAllowedLocalReceiverUrl('http://8.8.8.8/data/aircraft.json')).toBe(false);
    expect(isAllowedLocalReceiverUrl('http://receiver.local/data/aircraft.json')).toBe(false);
    expect(isAllowedLocalReceiverUrl('http://192.168.1.50/etc/passwd')).toBe(false);
    expect(() => assertAllowedUrl('http://192.168.1.50/tar1090/data/aircraft.json')).toThrow(/Blocked/);
    setLocalReceiverUrl('http://192.168.1.50/tar1090/data/aircraft.json');
    expect(() => assertAllowedUrl('http://192.168.1.50/tar1090/data/aircraft.json')).not.toThrow();
    expect(() => assertAllowedUrl('http://192.168.1.50/other')).toThrow(/Blocked/);
    setLocalReceiverUrl(null);
  });
  it('renderer: tile hosts only; Google tiles only when configured; CSP mirrors the list', () => {
    expect(isAllowedRendererUrl('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/1/0/0', { google3d: false })).toBe(true);
    expect(isAllowedRendererUrl('https://s3.amazonaws.com/other-bucket/x', { google3d: false })).toBe(false);
    expect(isAllowedRendererUrl('https://tile.googleapis.com/v1/3dtiles/root.json', { google3d: false })).toBe(false);
    expect(isAllowedRendererUrl('https://tile.googleapis.com/v1/3dtiles/root.json', { google3d: true })).toBe(true);
    const csp = buildCsp({ google3d: false });
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain(" 'unsafe-eval'");
    expect(csp).not.toContain('googleapis');
    expect(csp).toContain('https://gibs.earthdata.nasa.gov/wmts/');
  });
});

describe('tools', () => {
  it('measures geodesic length and area', () => {
    expect(pathLengthKm([[0, 0], [1, 0]])).toBeCloseTo(111.32, 1);
    const { areaKm2 } = polygonAreaKm2([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(areaKm2).toBeGreaterThan(12_300);
    expect(areaKm2).toBeLessThan(12_400);
  });
  it('parses coordinates and geo: URIs', () => {
    expect(parseCoordinates('39.7392, -104.9903')).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(parseCoordinates('geo:39.7392,-104.9903')).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(parseCoordinates('61.2 -149.9')).toEqual({ lat: 61.2, lon: -149.9 });
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('Denver')).toBeNull();
  });
  it('scene files are strict: credentials or extra fields are rejected', () => {
    const scene = {
      format: 'atlas-watch-scene',
      version: 1,
      createdAt: new Date().toISOString(),
      camera: { lat: 1, lon: 2, heightM: 1000, heading: 0, pitch: -1.2 },
      basemap: 'atlas',
      terrainEnabled: true,
      layersEnabled: ['aircraft'],
      visualMode: 'normal',
      annotations: [],
      views: [],
    };
    expect(sceneSchema.safeParse(scene).success).toBe(true);
    expect(sceneSchema.safeParse({ ...scene, apiKey: 'AIza...' }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...scene, camera: { ...scene.camera, token: 'x' } }).success).toBe(false);
    expect(() => validateIpcArgs(IPC.sceneExport, [{ ...scene, credentials: { aisstream: 'k' } }])).toThrow();
  });
  it('rejects malformed tool/provider IPC input', () => {
    expect(() => validateIpcArgs(IPC.layersSetView, [{ lat: 100, lon: 0, heightM: 1, bbox: [0, 0, 1, 1] }])).toThrow();
    expect(() => validateIpcArgs(IPC.layersRefresh, ['ships'])).toThrow();
    expect(() => validateIpcArgs(IPC.providersSetCredential, ['openai', 'x'])).toThrow();
    expect(() => validateIpcArgs(IPC.annotationsPut, [{ id: 'a', kind: 'circle', name: 'x', color: '#fff', points: [[0, 0]], visible: true, createdAt: new Date().toISOString() }])).toThrow();
    expect(() => validateIpcArgs(IPC.geocodeAddress, ['x'])).toThrow();
  });
});
