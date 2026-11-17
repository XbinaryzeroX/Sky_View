// Group 3: city transit feeds, extra camera regions, nearest-record hand-off, extra satellite groups.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGtfsVehicles, type GtfsFeed } from '../src/shared/gtfsRealtime';
import { mbtaInView, normalizeTransitGtfs, TRANSIT_FEEDS, TRANSIT_MAX_AGE_S, transitFeedsForView } from '../src/shared/transitFeeds';
import { CALGARY_IMAGE_PREFIX, ICELAND_IMAGE_PREFIX, TORONTO_IMAGE_PREFIX, normalizeCalgaryCams, normalizeIcelandCams, normalizeTorontoCams } from '../src/shared/cameraSources';
import { nearestRecord } from '../src/shared/nearest';
import { assertAllowedUrl } from '../src/main/feeds/http';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { RENDERER_REMOTES } from '../src/shared/remoteHosts';
import { ipcArgSchemas, IPC, DEFAULT_SETTINGS } from '../src/shared/ipc';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const feed = (id: string) => TRANSIT_FEEDS.find((f) => f.id === id)!;
type Vehicle = GtfsFeed['vehicles'][number];
const vehicle = (o: Partial<Vehicle>): Vehicle => ({ entityId: 'e', tripId: null, routeId: null, vehicleId: 'v1', label: null, lat: 44.23, lon: -76.5, bearing: null, speedMps: null, timestamp: 1_800_000_000, stopId: null, status: null, ...o });

describe('transit feeds', () => {
  it('lists only allow-listed feeds with an https licence link the app may open', () => {
    expect(TRANSIT_FEEDS.length).toBe(36);
    expect(new Set(TRANSIT_FEEDS.map((f) => f.id)).size).toBe(36);
    for (const f of TRANSIT_FEEDS) {
      expect(() => assertAllowedUrl(f.url), f.id).not.toThrow();
      expect(isAllowedExternalUrl(f.licenseUrl), f.id).toBe(true);
      expect(f.license).not.toMatch(/No licence/i);
    }
    expect(() => assertAllowedUrl('https://data.texas.gov/download/other/file')).toThrow(/Blocked/);
  });
  it('polls only the feeds near a zoomed-in view', () => {
    expect(transitFeedsForView(44.24, -76.57, 20_000).map((f) => f.id)).toEqual(['kingston-transit']);
    expect(transitFeedsForView(60.17, 24.94, 30_000).map((f) => f.id)).toEqual(['hsl-helsinki']);
    expect(transitFeedsForView(0, -150, 30_000)).toEqual([]);
    expect(transitFeedsForView(44.24, -76.57, 5_000_000)).toEqual([]);
    expect(mbtaInView(42.36, -71.06, 20_000)).toBe(true);
    expect(mbtaInView(51.5, -0.1, 20_000)).toBe(false);
  });
  it('reads a real Kingston feed into bus records', () => {
    const gtfs = decodeGtfsVehicles(new Uint8Array(fx('transit-kingston.pb')));
    expect(gtfs.vehicles.length).toBeGreaterThan(3);
    const newest = Math.max(...gtfs.vehicles.map((v) => v.timestamp ?? gtfs.headerTimestamp ?? 0));
    const n = normalizeTransitGtfs(feed('kingston-transit'), gtfs, newest * 1000);
    expect(n.records.length).toBeGreaterThan(0);
    expect(n.records.every((r) => r.category === 'Bus' && r.id.startsWith('kingston-transit:') && r.lat > 44 && r.lat < 44.5)).toBe(true);
    expect(n.records[0].source).toMatch(/City of Kingston/);
  });
  it('leaves out old positions and 0,0, converts km/h feeds, and never guesses the vehicle type of a mixed feed', () => {
    const now = 1_800_000_000_000;
    const gtfs: GtfsFeed = { headerTimestamp: 1_800_000_000, skipped: 0, vehicles: [
      vehicle({ vehicleId: 'a', speedMps: 36 }),
      vehicle({ vehicleId: 'old', timestamp: 1_800_000_000 - TRANSIT_MAX_AGE_S - 5 }),
      vehicle({ vehicleId: 'zero', lat: 0, lon: 0 }),
      vehicle({ vehicleId: 'hdr', timestamp: null }),
    ] };
    const n = normalizeTransitGtfs(feed('tam-montpellier'), gtfs, now);
    expect(n.records.map((r) => r.id)).toEqual(['tam-montpellier:a', 'tam-montpellier:hdr']);
    expect(n.stale).toBe(1);
    expect(n.records[0].speedKts).toBeCloseTo(19.4, 1); // 36 km/h
    expect(n.records[0].category).toBe('Transit');
    expect(n.records[0].props.mode).toMatch(/not stated/);
    expect(n.records[1].props.timeFrom).toBe('feed snapshot');
  });
  it('drops Entur train operators already shown by the Trains layer', () => {
    const gtfs: GtfsFeed = { headerTimestamp: 1_800_000_000, skipped: 0, vehicles: [vehicle({ vehicleId: 't', routeId: 'VYG:Line:L1' }), vehicle({ vehicleId: 'b', routeId: 'RUT:Line:31' })] };
    expect(normalizeTransitGtfs(feed('entur-norway'), gtfs, 1_800_000_000_000).records.map((r) => r.id)).toEqual(['entur-norway:b']);
  });
});

describe('added camera regions', () => {
  const allowed = (u: string) => RENDERER_REMOTES.some((r) => u.startsWith(r.prefix));
  it('Iceland: one camera per view, stills pinned to the publisher directory', () => {
    const body = JSON.parse(fx('cameras-iceland.json').toString('utf8')) as Record<string, unknown>[];
    const n = normalizeIcelandCams([...body, { ...body[0], Slod: 'https://evil.example/x.jpg' }, { ...body[0] }, null]);
    expect(n.records.length).toBe(body.length);
    expect(n.skipped).toBe(3);
    expect(n.records.every((c) => c.imageUrl!.startsWith(ICELAND_IMAGE_PREFIX) && allowed(c.imageUrl!) && c.lat > 62 && c.lat < 67)).toBe(true);
  });
  it('Calgary: upgrades http still links, keeps only the city host, and does not read the quadrant as a direction', () => {
    const body = JSON.parse(fx('cameras-calgary.json').toString('utf8')) as Record<string, unknown>[];
    const http = { ...body[0], camera_url: { url: 'http://trafficcam.calgary.ca/loc7.jpg' } };
    const off = { ...body[0], camera_url: { url: 'https://trafficcam.calgary.ca.evil.example/loc7.jpg' } };
    const n = normalizeCalgaryCams([...body, http, off]);
    expect(n.records.length).toBe(body.length + 1);
    expect(n.skipped).toBe(1);
    expect(n.records.at(-1)!.imageUrl).toBe(`${CALGARY_IMAGE_PREFIX}loc7.jpg`);
    expect(n.records.every((c) => allowed(c.imageUrl!) && c.props.view === undefined)).toBe(true);
  });
  it('Toronto: reads the JSONP list and builds the still address from a digits-only number', () => {
    const n = normalizeTorontoCams(fx('cameras-toronto.jsonp.txt').toString('utf8'));
    expect(n.records.length).toBe(12);
    expect(n.records[0].imageUrl).toBe(`${TORONTO_IMAGE_PREFIX}loc8001.jpg`);
    expect(allowed(n.records[0].imageUrl!)).toBe(true);
    const bad = normalizeTorontoCams('jsonTMCEarthCamerasCallback({"Data":[{"Number":"../x","Name":"n","Latitude":"43.6","Longitude":"-79.4"},{"Number":"12","Name":"n","Latitude":"","Longitude":"-79.4"}]});');
    expect(bad.records).toEqual([]);
    expect(bad.skipped).toBe(2);
    expect(() => normalizeTorontoCams('<html>')).toThrow();
  });
  it('allows the three list addresses and nothing else on the shared hosts', () => {
    for (const u of ['https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', 'https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000', 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/Data/tmcearthcameras.json'])
      expect(() => assertAllowedUrl(u)).not.toThrow();
    expect(() => assertAllowedUrl('https://data.calgary.ca/resource/other.json')).toThrow(/Blocked/);
  });
});

describe('nearest record', () => {
  const cams = [{ id: 'far', lat: 10, lon: 10 }, { id: 'near', lat: 0.1, lon: 179.95 }, { id: 'nearer', lat: 0.05, lon: -179.98 }];
  it('finds the nearest within the limit, across the date line', () => {
    expect(nearestRecord(0, 179.99, cams, 50)?.record.id).toBe('nearer');
    expect(nearestRecord(0, 0, cams, 50)).toBeNull();
    expect(nearestRecord(Number.NaN, 0, cams, 50)).toBeNull();
    expect(nearestRecord(0, 0, [], 50)).toBeNull();
  });
});

describe('satellite groups', () => {
  it('accepts the new groups in settings and still rejects unknown ones', () => {
    const schema = ipcArgSchemas[IPC.settingsUpdate];
    expect(schema.safeParse([{ satelliteGroups: ['stations', 'telecom', 'imaging', 'debris'] }]).success).toBe(true);
    expect(schema.safeParse([{ satelliteGroups: ['everything'] }]).success).toBe(false);
    expect(DEFAULT_SETTINGS.satelliteGroups).toEqual(['stations', 'visual']);
  });
});
