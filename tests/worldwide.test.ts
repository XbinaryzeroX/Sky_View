import { describe, expect, it } from 'vitest';
import { AisStreamClient } from '../src/main/layers/aisstream';
import { aircraftClass, altitudeColor, classifyAircraftQuery, deadReckon, DEFAULT_AIRCRAFT_FILTER, elevationAngleDeg, passesFilter, specialCode, trackState } from '../src/shared/aircraft';
import { answerQuestion } from '../src/shared/analyst';
import { geodesicDistanceKm } from '../src/shared/geo';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { aisCog, aisDimensions, aisHeading, aisSog, decodePackedEta } from '../src/shared/layerNormalize';
import type { GeoRecord } from '../src/shared/layers';
import { buildCsp, isAllowedRendererUrl } from '../src/shared/remoteHosts';
import { clearNoDataPixels, whiteFraction } from '../src/shared/tilePixels';
import type { AppSnapshot } from '../src/shared/types';
import { fmtAltitudeM, fmtDistanceKm, fmtSpeedKts } from '../src/shared/units';

function ac(over: Partial<GeoRecord> = {}): GeoRecord {
  return {
    id: 'abc123',
    lat: 40,
    lon: -105,
    altM: 10000,
    heading: 90,
    speedKts: 450,
    label: 'TST1',
    category: null,
    observedAt: new Date().toISOString(),
    sourceUrl: null,
    source: 'test',
    props: { altitudeFt: 33000, onGround: false, emitterCategory: 'A3' },
    ...over,
  };
}

describe('USGS no-data pixels', () => {
  it('clears only near-white opaque pixels', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 20, 60, 120, 255, 255, 255, 255, 0, 251, 252, 253, 255]);
    expect(clearNoDataPixels(px)).toBe(2);
    expect([px[3], px[7], px[11], px[15]]).toEqual([0, 255, 0, 0]);
  });
  it('measures the white fraction, ignoring transparent pixels', () => {
    expect(whiteFraction(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]))).toBe(1);
    expect(whiteFraction(new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255]))).toBe(0.5);
  });
});

describe('worldwide map sources', () => {
  it('allows OpenFreeMap always and customer imagery hosts only when configured', () => {
    expect(isAllowedRendererUrl('https://tiles.openfreemap.org/planet/x/14/1/1.pbf', { google3d: false })).toBe(true);
    expect(isAllowedRendererUrl('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/1/0/0', { google3d: false })).toBe(false);
    expect(isAllowedRendererUrl('https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/1/0/0', { google3d: false, esri: true })).toBe(true);
    expect(isAllowedRendererUrl('https://tiles.maps.eox.at/wmts/1.0.0/x', { google3d: false })).toBe(false);
    expect(buildCsp({ google3d: false })).not.toContain('api.mapbox.com');
    expect(buildCsp({ google3d: false, mapbox: true })).toContain('https://api.mapbox.com/v4/mapbox.satellite/');
  });
});

describe('aircraft', () => {
  it('colors by altitude band and grounds as gray', () => {
    expect(altitudeColor(0, true)).toBe('#9aa7b4');
    expect(altitudeColor(45000, false)).toBe('#bb6bd9');
    expect(altitudeColor(10000, false)).toBe('#f2c94c');
  });
  it('labels special codes factually and only for listed codes', () => {
    expect(specialCode(ac({ props: { squawk: '7700' } }))?.label).toMatch(/reported/);
    expect(specialCode(ac({ props: { squawk: '1200' } }))).toBeNull();
    expect(specialCode(ac({ props: { emergency: 'nordo', squawk: '7600' } }))?.code).toBe('nordo');
  });
  it('classifies and filters by altitude and class', () => {
    expect(aircraftClass(ac())).toBe('airliner');
    expect(aircraftClass(ac({ props: { militaryFlag: true } }))).toBe('military');
    expect(passesFilter(ac(), { ...DEFAULT_AIRCRAFT_FILTER, minFt: 30000 })).toBe(true);
    expect(passesFilter(ac(), { ...DEFAULT_AIRCRAFT_FILTER, maxFt: 20000 })).toBe(false);
    expect(passesFilter(ac(), { ...DEFAULT_AIRCRAFT_FILTER, classes: ['light'] })).toBe(false);
    expect(passesFilter(ac(), { ...DEFAULT_AIRCRAFT_FILTER, specialOnly: true })).toBe(false);
  });
  it('marks tracks stale after 60 s and expired after 5 min', () => {
    const now = Date.now();
    expect(trackState(ac({ observedAt: new Date(now - 10_000).toISOString() }), now)).toBe('fresh');
    expect(trackState(ac({ observedAt: new Date(now - 90_000).toISOString() }), now)).toBe('stale');
    expect(trackState(ac({ observedAt: new Date(now - 400_000).toISOString() }), now)).toBe('expired');
  });
  it('dead-reckons at most 45 s and never moves aircraft on the ground', () => {
    const now = Date.now();
    const r = ac({ observedAt: new Date(now - 600_000).toISOString() });
    const p = deadReckon(r, now);
    expect(p.estimatedS).toBe(45);
    // 450 kt for 45 s ≈ 10.4 km
    expect(geodesicDistanceKm(r.lat, r.lon, p.lat, p.lon)).toBeCloseTo(10.4, 0);
    expect(deadReckon(ac({ props: { onGround: true } }), now).estimatedS).toBe(0);
  });
  it('computes elevation angles and validates lookup queries', () => {
    expect(elevationAngleDeg(10, 10000)).toBeGreaterThan(44);
    expect(classifyAircraftQuery('a1b2c3')).toEqual({ kind: 'hex', value: 'a1b2c3' });
    expect(classifyAircraftQuery('UAL123')).toEqual({ kind: 'callsign', value: 'UAL123' });
    expect(classifyAircraftQuery('N123AB')?.kind).toBe('reg');
    expect(classifyAircraftQuery('G-ABCD')?.kind).toBe('reg');
    expect(classifyAircraftQuery('../etc')).toBeNull();
  });
});

describe('AIS encodings and static data', () => {
  it('treats AIS not-available values as missing', () => {
    expect(aisSog(102.3)).toBeNull();
    expect(aisSog(12.5)).toBe(12.5);
    expect(aisCog(360)).toBeNull();
    expect(aisHeading(511)).toBeNull();
    expect(aisDimensions(150, 50, 15, 15)).toEqual({ lengthM: 200, beamM: 30 });
    expect(aisDimensions(0, 0, 0, 0)).toEqual({ lengthM: null, beamM: null });
  });
  it('decodes packed ETA without inventing a year', () => {
    const eta = (11 << 16) | (12 << 11) | (14 << 6) | 30;
    expect(decodePackedEta(eta)).toBe('11-12 14:30 UTC (reported, no year)');
    expect(decodePackedEta(0)).toBeNull();
  });
  it('merges static data into positions by MMSI regardless of message order', () => {
    const c = new AisStreamClient(
      () => 'k',
      () => {},
      () => ({ send() {}, close() {}, onopen: null, onmessage: null, onerror: null, onclose: null }),
    );
    c.handle({ MessageType: 'ShipStaticData', MetaData: { MMSI: 211000001 }, Message: { ShipStaticData: { Name: 'EVER TEST', Type: 71, ImoNumber: 9811000, Destination: 'ROTTERDAM', Dimension: { A: 300, B: 99, C: 30, D: 28 }, Eta: { Month: 11, Day: 12, Hour: 6, Minute: 0 } } } });
    c.handle({ MessageType: 'PositionReport', MetaData: { MMSI: 211000001, time_utc: new Date().toISOString() }, Message: { PositionReport: { Latitude: 51.9, Longitude: 4.0, Sog: 102.3, Cog: 360, TrueHeading: 511 } } });
    const [v] = c.records(Date.now());
    expect(v).toMatchObject({ label: 'EVER TEST', category: 'Cargo', speedKts: null, heading: null });
    expect(v.props).toMatchObject({ imo: 9811000, destinationReported: 'ROTTERDAM', lengthM: 399, beamM: 58 });
    expect(String(v.props.etaReported)).toContain('reported');
  });
});

describe('analyst (deterministic)', () => {
  const snap = {
    locations: [],
    alerts: [],
    supersededAlertIds: [],
    quakes: [{ id: 'q1', ids: ['q1'], mag: 5.2, magType: 'mw', place: 'Test', title: 'M5.2', time: '2026-11-09T00:00:00.000Z', updated: '2026-11-09T00:00:00.000Z', lat: 1, lon: 1, depthKm: 10, url: null, status: null, tsunami: false, sig: null, alert: null, eventType: 'earthquake' }],
    feeds: {},
    freshness: { nws: 'fresh', usgs: 'fresh' },
    evaluations: {},
    diffs: {},
    settings: DEFAULT_SETTINGS,
    generatedAt: '',
  } as unknown as AppSnapshot;
  const layers = {
    aircraft: { records: [ac(), ac({ id: 'def456', label: 'LOW1', props: { altitudeFt: 4000 } }), ac({ id: 'eee111', label: 'SQK', props: { altitudeFt: 9000, squawk: '7700' } })], lastSuccessAt: null, freshness: 'fresh' },
    vessels: { records: [{ ...ac({ id: '1', label: 'CARGO A', category: 'Cargo' }), lat: 10, lon: 10 }, { ...ac({ id: '2', label: 'TANK B', category: 'Tanker' }), lat: 50, lon: 50 }], lastSuccessAt: null, freshness: 'fresh' },
  };
  it('filters aircraft by altitude using loaded records only', () => {
    const a = answerQuestion('Which aircraft are above 30,000 feet?', { snap, layers, viewBbox: null })!;
    expect(a.rows.map((r) => r.id)).toEqual(['abc123']);
    expect(a.note).toMatch(/currently loaded/);
  });
  it('limits vessel questions to the current view when asked', () => {
    expect(answerQuestion('Show cargo vessels in this area', { snap, layers, viewBbox: [0, 0, 20, 20] })!.rows.map((r) => r.label)).toEqual(['CARGO A']);
    expect(answerQuestion('Show cargo vessels in this area', { snap, layers, viewBbox: [40, 40, 60, 60] })!.rows).toHaveLength(0);
  });
  it('reports special codes as reports, quakes from the feed, and declines unknown questions', () => {
    expect(answerQuestion('any emergency squawks?', { snap, layers, viewBbox: null })!.note).toMatch(/not a confirmed incident/);
    expect(answerQuestion('earthquakes above magnitude 5', { snap, layers, viewBbox: null })!.rows).toHaveLength(1);
    expect(answerQuestion('what is the meaning of life', { snap, layers, viewBbox: null })).toBeNull();
  });
});

describe('units', () => {
  it('formats distance, altitude and speed', () => {
    expect(fmtDistanceKm(10, 'imperial')).toBe('6.2 mi');
    expect(fmtDistanceKm(18.52, 'nautical')).toBe('10 nm');
    expect(fmtAltitudeM(3048, 'imperial')).toBe('10,000 ft');
    expect(fmtSpeedKts(100, 'metric')).toBe('185 km/h');
  });
});

describe('antimeridian edge repair', () => {
  it('replaces a black right-edge band with the nearest valid column', async () => {
    const { repairRightEdge } = await import('../src/shared/tilePixels');
    const w = 32;
    const h = 4;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const black = x >= 30;
        // JPEG-like noise in the band (up to 30) must still count as dark.
        px.set(black ? [y * 10, 3, 5, 255] : [20, 60, 140, 255], o);
      }
    expect(repairRightEdge(px, w, h)).toBe(3); // 2 dark + 1 transition column
    expect([...px.slice((3 * w + 31) * 4, (3 * w + 31) * 4 + 4)]).toEqual([20, 60, 140, 255]);
    const clean = new Uint8ClampedArray(w * h * 4).fill(100);
    expect(repairRightEdge(clean, w, h)).toBe(0);
    // A wide dark area (real dark imagery) is left alone.
    const wide = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) wide.set(p % w >= 20 ? [0, 0, 0, 255] : [20, 60, 140, 255], p * 4);
    expect(repairRightEdge(wide, w, h)).toBe(0);
  });
});

describe('ocean, poles and Google geocoding', () => {
  it('clears black no-data fill only when it is a real fill, not shadows', async () => {
    const { clearBlackFill } = await import('../src/shared/tilePixels');
    const n = 100;
    const fill = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) fill.set(i < 30 ? [0, 1, 2, 255] : [80, 90, 70, 255], i * 4);
    expect(clearBlackFill(fill)).toBe(30);
    expect(fill[3]).toBe(0);
    expect(fill[30 * 4 + 3]).toBe(255);
    const shadows = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) shadows.set(i < 2 ? [0, 0, 0, 255] : [80, 90, 70, 255], i * 4);
    expect(clearBlackFill(shadows)).toBe(0);
    expect(shadows[3]).toBe(255);
  });

  it('allows the GIBS geographic WMS for polar caps, but not other GIBS paths', () => {
    expect(isAllowedRendererUrl('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap', { google3d: false })).toBe(true);
    expect(isAllowedRendererUrl('https://gibs.earthdata.nasa.gov/other/', { google3d: false })).toBe(false);
  });

  it('lets the main process reach Google Geocoding JSON only', async () => {
    const { assertAllowedUrl } = await import('../src/main/feeds/http');
    expect(() => assertAllowedUrl('https://maps.googleapis.com/maps/api/geocode/json?address=x&key=k')).not.toThrow();
    expect(() => assertAllowedUrl('https://maps.googleapis.com/maps/api/place/json?q=x')).toThrow();
  });
});

describe('geographic terrain resampling helpers', () => {
  it('maps lon/lat to Web Mercator pixels and clamps beyond the Mercator limit', async () => {
    const { mercatorPixel, MERCATOR_MAX_LAT, sourceZoomFor } = await import('../src/shared/mercator');
    expect(mercatorPixel(-180, MERCATOR_MAX_LAT, 0).x).toBeCloseTo(0, 6);
    expect(mercatorPixel(-180, MERCATOR_MAX_LAT, 0).y).toBeCloseTo(0, 3);
    expect(mercatorPixel(0, 0, 1)).toEqual({ x: 256, y: 256 });
    // The pole clamps to the top row instead of producing Infinity.
    expect(mercatorPixel(10, 90, 3).y).toBeCloseTo(0, 3);
    expect(mercatorPixel(10, -90, 3).y).toBeCloseTo(2048, 3);
    // Equator: geographic level L matches Mercator zoom L+1; toward the poles fewer zooms are needed.
    expect(sourceZoomFor(10, 0)).toBe(11);
    expect(sourceZoomFor(10, 60)).toBe(10);
    expect(sourceZoomFor(10, 80)).toBeLessThan(10);
    expect(sourceZoomFor(0, 89)).toBeGreaterThanOrEqual(0);
  });
});

describe('aircraft query plan', () => {
  it('uses one circle close in and a capped grid of 250 nm areas when zoomed out', async () => {
    const { aircraftQueryPlan, AIRCRAFT_MAX_AREAS } = await import('../src/main/layers/fetchers');
    const near = aircraftQueryPlan({ lat: 40.7, lon: -74, heightM: 500_000, bbox: [-80, 35, -68, 46] });
    expect(near.centers).toHaveLength(1);
    const far = aircraftQueryPlan({ lat: 40.7, lon: -74, heightM: 12_000_000, bbox: [-180, -60, 180, 85] });
    expect(far.centers.length).toBe(AIRCRAFT_MAX_AREAS);
    expect(far.partial).toBe(true);
    expect(far.radiusNm).toBe(250);
    // Nearest area first, and every area is on the visible side of the globe.
    const d = (c: { lat: number; lon: number }) => Math.hypot(c.lat - 40.7, (c.lon + 74) * Math.cos((40.7 * Math.PI) / 180));
    expect(d(far.centers[0])).toBeLessThan(6);
  });
});

describe('label hierarchy', () => {
  it('ranks place classes and keeps the most important non-overlapping labels', async () => {
    const { labelPriority, placeBoxes } = await import('../src/renderer/map/placeLabels');
    expect(labelPriority('capital', 1)).toBeGreaterThan(labelPriority('city', 1));
    expect(labelPriority('city', 2)).toBeGreaterThan(labelPriority('town', 2));
    expect(labelPriority('town', 1)).toBeGreaterThan(labelPriority('village', 1));
    const city = { x: 100, y: 100, w: 60, h: 14, p: 700 };
    const village = { x: 110, y: 104, w: 50, h: 12, p: 300 };
    const far = { x: 400, y: 300, w: 50, h: 12, p: 250 };
    const kept = placeBoxes([village, city, far], 10);
    expect(kept.has(city)).toBe(true);
    expect(kept.has(village)).toBe(false);
    expect(kept.has(far)).toBe(true);
    expect(placeBoxes([city, far], 1).size).toBe(1);
  });
});
