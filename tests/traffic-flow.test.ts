import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodePolyline, FLOW_SOURCES, flowSourcesForView, madridLocalToIso, normalizeFinlandTms, normalizeHkDetectors, normalizeMadrid, normalizeNycSpeeds,
  normalizeParis, nycLocalToIso, parisHourUrl, parseHkDetectorInfo, stateFromFreeFlowPercent, stateFromSpeedKmh, utm30nToLatLon,
  FINLAND_DATA_URL, FINLAND_STATIONS_URL, HK_INFO_URL, HK_RAW_URL, MADRID_URL, NYC_URL, PARIS_LATEST_URL,
} from '../src/shared/trafficFlow';
import { assertAllowedUrl } from '../src/main/feeds/http';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { LAYERS } from '../src/shared/layers';

const text = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const json = (n: string) => JSON.parse(text(n)) as unknown;
const src = (id: string) => FLOW_SOURCES.find((s) => s.id === id)!;

describe('traffic flow: shared scale', () => {
  it('classes speeds and free-flow shares, and keeps missing readings unknown', () => {
    expect([70, 50, 30, 10, null, -1].map(stateFromSpeedKmh)).toEqual(['free', 'slow', 'heavy', 'stopped', 'unknown', 'unknown']);
    expect([95, 80, 50, 10, 0, null].map(stateFromFreeFlowPercent)).toEqual(['free', 'slow', 'heavy', 'stopped', 'unknown', 'unknown']);
  });
  it('loads only the sources under a zoomed-in view', () => {
    expect(flowSourcesForView(40.75, -73.98, 20_000).map((s) => s.id)).toEqual(['nyc']);
    expect(flowSourcesForView(60.17, 24.94, 50_000).map((s) => s.id)).toEqual(['finland']);
    expect(flowSourcesForView(51.5, -0.12, 50_000)).toEqual([]);
    expect(flowSourcesForView(40.75, -73.98, 5_000_000)).toEqual([]);
  });
  it('is described as measured traffic, never individual vehicles', () => {
    expect(LAYERS.trafficFlow.temporalNote).toMatch(/never individual vehicles/);
    expect(LAYERS.trafficFlow.coverage).toMatch(/only/);
  });
});

describe('New York City DOT speeds', () => {
  it('decodes polylines with their backslashes as code characters (verified against link_points)', () => {
    const rows = json('traffic-nyc.json') as { link_id: string; encoded_poly_line: string; link_name: string }[];
    const cve = rows.find((r) => r.link_name.startsWith('CVE NB GCP'))!;
    const line = decodePolyline(cve.encoded_poly_line);
    expect(line[0][1]).toBeCloseTo(40.78795, 5);
    expect(line.at(-1)![1]).toBeCloseTo(40.74554, 5); // south end at the Grand Central Parkway, not off to the west
  });
  it('never draws a corrupt published shape: falls back to the point list, or drops the link', () => {
    const rows = json('traffic-nyc.json') as Record<string, string>[];
    const base = rows[0];
    // An encoded line that jumps across the globe (as several NYC DOT links do), with a sound but cut-off point list.
    const bad = { ...base, link_id: '7', encoded_poly_line: 'uk}wFtckaM_ibE_seK', link_points: '40.78795,-73.790191 40.78647,-73.78812 40.7862104,-73.787781 40.77273,-' };
    const none = { ...base, link_id: '8', encoded_poly_line: 'uk}wFtckaM_ibE_seK', link_points: '40.7,-74.0 10.0,10.0' };
    const r = normalizeNycSpeeds([bad, none], src('nyc'));
    expect(r.records.map((x) => x.id)).toEqual(['nyc:7']);
    const line = r.records[0].geometry!.type === 'LineString' ? r.records[0].geometry!.coordinates : [];
    expect(line).toHaveLength(3);
    expect(r.records[0].props.geometry).toBe('partial (as published)');
    expect(r.skipped).toBe(1);
  });

  it('shows a link with no reading (status -101, speed 0) as unknown, not stopped', () => {
    const rows = json('traffic-nyc.json') as Record<string, string>[];
    const base = rows[0];
    const r = normalizeNycSpeeds([{ ...base, link_id: '1', speed: '0', travel_time: '0', status: '-101' }, { ...base, link_id: '2', speed: '5', travel_time: '700', status: '0' }], src('nyc'));
    const by = new Map(r.records.map((x) => [x.id, x]));
    expect(by.get('nyc:1')?.category).toBe('unknown');
    expect(by.get('nyc:1')?.props.speedKmh).toBeNull();
    expect(by.get('nyc:2')?.category).toBe('stopped');
  });

  it('keeps the newest reading per link and dates it in UTC', () => {
    const r = normalizeNycSpeeds(json('traffic-nyc.json'), src('nyc'));
    expect(new Set(r.records.map((x) => x.id)).size).toBe(r.records.length);
    expect(r.records.every((x) => x.geometry?.type === 'LineString')).toBe(true);
    expect(nycLocalToIso('2026-11-14T12:37:05.000')).toBe('2026-11-14T17:37:05.000Z'); // EST
    expect(nycLocalToIso('2026-07-01T12:00:00.000')).toBe('2026-07-01T16:00:00.000Z'); // EDT
  });
});

describe('Fintraffic TMS', () => {
  it('colours each station by its slower direction against free-flow speed', () => {
    const r = normalizeFinlandTms(json('traffic-fi-stations.json'), json('traffic-fi-data.json'), src('finland'));
    expect(r.records.length).toBeGreaterThan(5);
    const one = r.records[0];
    expect(typeof one.props.dir1FreeFlowPercent === 'number' || typeof one.props.dir2FreeFlowPercent === 'number').toBe(true);
    expect(one.lat).toBeGreaterThan(59);
    expect(one.observedAt).not.toBeNull();
  });
});

describe('Hong Kong detectors', () => {
  it('averages valid lanes at each located detector', () => {
    const info = parseHkDetectorInfo(text('traffic-hk-info.csv'));
    expect(info.get('AID01101')?.lat).toBeCloseTo(22.248091, 5);
    const r = normalizeHkDetectors(text('traffic-hk-raw.xml'), info, src('hongkong'));
    expect(r.records.length).toBeGreaterThan(5);
    expect(r.records[0].observedAt).toMatch(/^2026-11-14T19:39:30/); // 03:39:30 on 15 Nov, Hong Kong time
    expect(r.records.every((x) => x.lat > 22 && x.lat < 22.6)).toBe(true);
  });
  it('does not treat a lane with no vehicles as a speed reading', () => {
    const info = parseHkDetectorInfo(text('traffic-hk-info.csv'));
    const lane = (speed: number, volume: number) => `<lane><lane_id>L</lane_id><speed>${speed}</speed><occupancy>0</occupancy><volume>${volume}</volume><s.d.>0</s.d.><valid>Y</valid></lane>`;
    const xml = (lanes: string) => `<raw_speed_volume_list><date>2026-11-15</date><periods><period><period_from>03:39:00</period_from><period_to>03:39:30</period_to><detectors><detector><detector_id>AID01101</detector_id><direction>South East</direction><lanes>${lanes}</lanes></detector></detectors></period></periods></raw_speed_volume_list>`;
    expect(normalizeHkDetectors(xml(lane(70, 0) + lane(70, 0)), info, src('hongkong')).records[0].category).toBe('unknown');
    const mixed = normalizeHkDetectors(xml(lane(70, 0) + lane(15, 3) + lane(25, 1)), info, src('hongkong')).records[0];
    expect(mixed.props.speedKmh).toBe(18); // (15×3 + 25×1) / 4 = 17.5
    expect(mixed.category).toBe('stopped');
  });
});

describe('Madrid sensors', () => {
  it('converts UTM zone 30N to latitude and longitude', () => {
    // Puerta del Sol is about 440,300 E, 4,474,250 N.
    const p = utm30nToLatLon(440300, 4474250);
    expect(p.lat).toBeCloseTo(40.4168, 2);
    expect(p.lon).toBeCloseTo(-3.7038, 2);
  });
  it('reads the level of service and the local file time', () => {
    const r = normalizeMadrid(text('traffic-madrid.xml'), src('madrid'));
    expect(r.records.length).toBe(30);
    expect(r.sourceUpdatedAt).toBe('2026-11-14T19:35:02.000Z');
    expect(madridLocalToIso('01/07/2026 12:00:00')).toBe('2026-07-01T10:00:00.000Z');
    expect(r.records.every((x) => x.lat > 40.2 && x.lat < 40.6 && x.lon > -3.9 && x.lon < -3.5)).toBe(true);
  });
});

describe('Paris counters', () => {
  it('maps the published states, keeping "Inconnu" unknown', () => {
    const r = normalizeParis(json('traffic-paris.json'), src('paris'));
    const by = new Map(r.records.map((x) => [String(x.props.stateReported), x.category]));
    expect(by.get('Fluide')).toBe('free');
    expect(by.get('Saturé')).toBe('heavy');
    expect(by.get('Bloqué')).toBe('stopped');
    expect(by.get('Inconnu')).toBe('unknown');
    expect(() => parisHourUrl("2026-11-13T23:00:00+00:00' OR 1=1")).toThrow();
  });
});

describe('allow-lists', () => {
  it('permits exactly the dataset paths on shared hosts', () => {
    for (const u of [NYC_URL, FINLAND_STATIONS_URL, FINLAND_DATA_URL, HK_RAW_URL, HK_INFO_URL + 'traffic_speed_volume_occ_info.csv', MADRID_URL, PARIS_LATEST_URL, parisHourUrl('2026-11-13T23:00:00+00:00')])
      expect(() => assertAllowedUrl(u)).not.toThrow();
    expect(() => assertAllowedUrl('https://data.cityofnewyork.us/resource/other.json')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/other/records')).toThrow(/Blocked/);
    for (const s of FLOW_SOURCES) expect(isAllowedExternalUrl(s.licenseUrl)).toBe(true);
  });
});
