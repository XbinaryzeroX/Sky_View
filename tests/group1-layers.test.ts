import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { launchesUrl, launchPhase, normalizeLaunches } from '../src/shared/launches';
import { accumulateGnss, gnssCellKey, gnssCells, gnssLevel, GNSS_STORE_LIMIT, GNSS_WINDOW_MS, normalizeGnssAircraft, pruneGnss, type GnssStore } from '../src/shared/gnssIntegrity';
import { normalizeOpenSkyTrack } from '../src/shared/flightPath';
import { createFlightPathLookup } from '../src/main/flightPathLookup';
import { assertAllowedUrl, FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { LAYER_IDS, LAYERS } from '../src/shared/layers';
import { FETCHERS } from '../src/main/layers/fetchers';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

describe('space launches (Launch Library 2)', () => {
  it('normalizes real records at their pads with the source status', () => {
    const n = normalizeLaunches(fixture('ll2-launches.json'));
    expect(n.skipped).toBe(0);
    expect(n.records).toHaveLength(6);
    const first = n.records[0];
    expect(first.label).toBe('Falcon 9 Block 5 | USSF-481');
    expect([first.lat, first.lon]).toEqual([34.632, -120.611]);
    expect(first.category).toBe('success');
    expect(first.props.launchTime).toBe('2026-10-16T00:01:05.000Z');
    expect(first.props.site).toBe('Vandenberg SFB, CA, USA');
    expect(n.records.some((r) => r.category === 'upcoming')).toBe(true);
  });

  it('never reads an unknown status as a success', () => {
    expect(launchPhase('Go')).toBe('upcoming');
    expect(launchPhase('Partial Failure')).toBe('failure');
    expect(launchPhase('Something new')).toBe('other');
    expect(launchPhase(null)).toBe('other');
  });

  it('skips malformed records and rejects a reply without results', () => {
    const n = normalizeLaunches({ results: [{ id: 'x1', net: '2026-11-01T00:00:00Z', pad: { latitude: 'abc', longitude: 0 } }, { id: 'bad id', net: '2026-11-01T00:00:00Z', pad: { latitude: 1, longitude: 2 } }, null] });
    expect(n.records).toHaveLength(0);
    expect(n.skipped).toBe(3);
    expect(() => normalizeLaunches({ detail: 'throttled' })).toThrow(/no results/);
  });

  it('asks a fixed host for a 30-day-back, 14-day-ahead window', () => {
    const url = launchesUrl(new Date('2026-11-14T09:41:00Z'));
    expect(url).toBe('https://ll.thespacedevs.com/2.3.0/launches/?net__gte=2026-10-15T09:00:00Z&net__lte=2026-11-28T09:00:00Z&ordering=net&limit=100&mode=normal');
    expect(() => assertAllowedUrl(url)).not.toThrow();
    expect(isAllowedExternalUrl('https://thespacedevs.com/llapi')).toBe(true);
  });
});

describe('GPS accuracy anomalies (aircraft-reported NIC/NACp)', () => {
  const ac = (hex: string, lat: number, lon: number, extra: Record<string, unknown> = {}) => ({ hex, lat, lon, type: 'adsb_icao', version: 2, alt_baro: 30000, seen_pos: 2, nic: 8, nac_p: 10, ...extra });

  it('applies the per-aircraft rule and skips what does not qualify', () => {
    const rows = normalizeGnssAircraft({ ac: [
      ac('aaaaa1', 50, 10),
      ac('aaaaa2', 50, 10, { nic: 0, nac_p: 0 }),
      ac('aaaaa3', 50, 10, { nic: 0, nac_p: 10 }), // unknown containment with good accuracy: not degraded
      ac('aaaaa4', 50, 10, { gpsOkBefore: 1794655351, gpsOkLat: 51, gpsOkLon: 11, nic: 0, nac_p: 0 }),
      ac('aaaaa5', 50, 10, { alt_baro: 'ground' }),
      ac('aaaaa6', 50, 10, { version: 0 }),
      ac('aaaaa7', 50, 10, { type: 'tisb_icao' }),
      ac('aaaaa8', 50, 10, { seen_pos: 120 }),
      ac('aaaaa9', 50, 10, { mlat: ['nic', 'nac_p'] }),
    ] });
    expect(rows.map((r) => [r.hex, r.degraded])).toEqual([['aaaaa1', false], ['aaaaa2', true], ['aaaaa3', false], ['aaaaa4', true]]);
    // GPS loss is placed at the last good GNSS position.
    expect([rows[3].lat, rows[3].lon]).toEqual([51, 11]);
    expect(() => normalizeGnssAircraft({})).toThrow();
  });

  it('uses the gpsjam.org score: one degraded aircraft is discounted', () => {
    expect(gnssLevel(50, 1).level).toBe('low');
    expect(gnssLevel(50, 2)).toEqual({ percent: 2, level: 'medium' });
    expect(gnssLevel(20, 4).level).toBe('high');
    expect(gnssLevel(0, 0).level).toBe('low');
  });

  it('leaves sparse cells out (blank means not enough aircraft, not clear) and ages evidence out of the window', () => {
    const store: GnssStore = new Map();
    const t0 = Date.parse('2026-11-14T09:00:00Z');
    const rows = normalizeGnssAircraft({ ac: [ac('bbbbb1', 50.1, 10.1, { nic: 0, nac_p: 0 }), ac('bbbbb2', 50.2, 10.2, { nic: 0, nac_p: 0 }), ac('bbbbb3', 50.3, 10.3), ac('ccccc1', 40.1, 20.1)] });
    accumulateGnss(store, rows, t0);
    const cells = gnssCells(store, new Date(t0).toISOString());
    expect(cells).toHaveLength(1);
    expect(cells[0].category).toBe('high'); // (2 - 1) / 3 = 33%
    expect(cells[0].props).toMatchObject({ aircraft: 3, degraded: 2 });
    expect(cells[0].geometry?.type).toBe('Polygon');
    pruneGnss(store, t0 + GNSS_WINDOW_MS + 1);
    expect(store.size).toBe(0);
  });

  it('dates evidence by the snapshot, so a stale replay adds nothing', () => {
    const store: GnssStore = new Map();
    const now = Date.parse('2026-11-14T09:00:00Z');
    accumulateGnss(store, normalizeGnssAircraft({ ac: [ac('ddddd1', 1, 1)] }), now, now - GNSS_WINDOW_MS - 1000);
    expect(store.size).toBe(0);
  });

  it('keys cells across the date line and at the poles without overflow', () => {
    expect(gnssCellKey(89.9999, 179.9999)).toBe('359:719');
    expect(gnssCellKey(-90, -180)).toBe('0:0');
    expect(gnssCellKey(0.1, 179.9)).not.toBe(gnssCellKey(0.1, -179.9));
  });

  it('bounds the rolling store', () => {
    const store: GnssStore = new Map();
    const now = Date.now();
    for (let i = 0; i < GNSS_STORE_LIMIT + 10; i++) store.set(`h${i}|0:0`, { cell: '0:0', seenAt: now, degradedAt: null });
    pruneGnss(store, now);
    expect(store.size).toBe(GNSS_STORE_LIMIT);
  });
});

describe('OpenSky flight path', () => {
  const body = fixture('opensky-track.json') as { icao24: string; path: unknown[] };

  it('normalizes the reported waypoints in time order', () => {
    const p = normalizeOpenSkyTrack(body, 'c02eb9', '2026-11-14T09:30:00.000Z');
    expect(p.points.length).toBe(body.path.length);
    expect(p.points[0]).toMatchObject({ lat: 37.9474, lon: 23.966, altM: 0, onGround: false });
    expect(p.callsign).toBe('ACA897');
    expect(p.startTime).toBe('2026-11-14T11:22:31.000Z');
    for (let i = 1; i < p.points.length; i++) expect(p.points[i].t > p.points[i - 1].t).toBe(true);
  });

  it('refuses another aircraft’s reply and skips malformed waypoints', () => {
    expect(() => normalizeOpenSkyTrack(body, 'abcdef', 'x')).toThrow(/different aircraft/);
    const p = normalizeOpenSkyTrack({ icao24: 'abcdef', path: [[1, 10, 10, 100, 0, false], [1, 11, 11, 100, 0, false], [2, 95, 0, 0, 0, false], 'x', [3, 12, 12, null, null, null]] }, 'abcdef', 'x');
    expect(p.points).toHaveLength(2);
    expect(p.skipped).toBe(3);
    expect(p.points[1].altM).toBeNull();
  });

  it('asks OpenSky once per aircraft within the cache time and explains refusals', async () => {
    let calls = 0;
    const fetchJson: FetchJson = async (url) => {
      calls++;
      expect(url).toBe('https://opensky-network.org/api/tracks/all?icao24=c02eb9&time=0');
      return { status: 200, body };
    };
    const lookup = createFlightPathLookup(fetchJson, () => 'test');
    await Promise.all([lookup('c02eb9'), lookup('c02eb9')]);
    await lookup('c02eb9');
    expect(calls).toBe(1);
    const missing = createFlightPathLookup(async () => { throw new FeedHttpError('HTTP 404', 404, null, 'http'); }, () => 'test');
    await expect(missing('c02eb9')).rejects.toThrow(/no path for this flight/);
    const limited = createFlightPathLookup(async () => { throw new FeedHttpError('HTTP 429', 429, 3600, 'http'); }, () => 'test');
    await expect(limited('c02eb9')).rejects.toThrow(/asked the app to wait/);
  });
});

describe('layer registry', () => {
  it('has a fetcher, poll interval and stated coverage for every layer, including the new ones', () => {
    for (const id of LAYER_IDS) {
      expect(FETCHERS[id]).toBeTypeOf('function');
      expect(LAYERS[id].pollSeconds).toBeGreaterThan(0);
      expect(LAYERS[id].coverage.length).toBeGreaterThan(10);
    }
    expect(LAYERS.gnss.temporal).toBe('calculated');
    expect(LAYERS.launches.pollSeconds).toBeGreaterThanOrEqual(3600); // anonymous limit: 15 requests per hour
    expect(isAllowedExternalUrl('https://gpsjam.org/faq')).toBe(true);
  });
});
