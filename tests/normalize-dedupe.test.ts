import { describe, expect, it } from 'vitest';
import { computeDiff, dedupeQuakes } from '../src/shared/dedupe';
import { normalizeNwsAlerts, normalizePointZones, normalizeUsgsFeed, zoneKeyFromUrl } from '../src/shared/normalize';
import { fixture } from './helpers';

describe('NWS normalization', () => {
  const res = normalizeNwsAlerts(fixture('nws-alerts.json'));

  it('keeps valid records and counts malformed ones', () => {
    expect(res.alerts.map((a) => a.id)).toEqual(['urn:oid:fixture.poly.1', 'urn:oid:fixture.zone.1', 'urn:oid:fixture.zone.0', 'urn:oid:fixture.badgeom']);
    expect(res.skipped).toBe(2);
    expect(res.sourceUpdatedAt).toBe('2026-11-09T06:00:00.000Z');
  });

  it('extracts required fields and normalizes timestamps to UTC', () => {
    const a = res.alerts[0];
    expect(a).toMatchObject({ event: 'Severe Thunderstorm Warning', severity: 'Severe', urgency: 'Immediate', messageType: 'Alert', senderName: 'NWS Boulder CO' });
    expect(a.onset).toBe('2026-11-09T12:00:00.000Z');
    expect(a.geometry?.type).toBe('Polygon');
    expect(a.bbox).toEqual([-105.2, 39.6, -104.8, 39.9]);
    expect(a.sourceUrl).toBe('https://api.weather.gov/alerts/urn:oid:fixture.poly.1');
  });

  it('treats invalid geometry as missing rather than fabricating it, and drops foreign zone URLs', () => {
    const bad = res.alerts.find((a) => a.id === 'urn:oid:fixture.badgeom')!;
    expect(bad.geometry).toBeNull();
    expect(bad.severity).toBe('Unknown');
    expect(bad.affectedZones).toEqual(['https://api.weather.gov/zones/forecast/TXZ001']);
  });

  it('extracts revision references', () => {
    expect(res.alerts[1].references).toEqual(['urn:oid:fixture.zone.0']);
  });

  it('rejects non-FeatureCollection bodies', () => {
    expect(() => normalizeNwsAlerts({ error: 'x' })).toThrow();
    expect(() => normalizeNwsAlerts(null)).toThrow();
  });
});

describe('NWS zones', () => {
  it('parses zone keys strictly', () => {
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/forecast/KSZ039')).toBe('forecast/KSZ039');
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/county/KSC005')).toBe('county/KSC005');
    expect(zoneKeyFromUrl('http://api.weather.gov/zones/forecast/KSZ039')).toBeNull();
    expect(zoneKeyFromUrl('https://api.weather.gov/zones/forecast/../x')).toBeNull();
  });

  it('reads forecast, county, and fire zones from a /points response', () => {
    const z = normalizePointZones(
      { properties: { forecastZone: 'https://api.weather.gov/zones/forecast/KSZ039', county: 'https://api.weather.gov/zones/county/KSC005', fireWeatherZone: 'https://api.weather.gov/zones/fire/KSZ039' } },
      '2026-11-09T00:00:00Z',
    );
    expect(z).toMatchObject({ status: 'resolved', zones: ['forecast/KSZ039', 'county/KSC005', 'fire/KSZ039'] });
    expect(normalizePointZones({}, 'x').status).toBe('error');
  });
});

describe('USGS normalization and dedupe', () => {
  const res = normalizeUsgsFeed(fixture('usgs-week.json'));

  it('parses valid events, skips invalid coordinates, and rejects non-USGS links', () => {
    expect(res.quakes.map((q) => q.id)).toEqual(['ci40000001', 'us7000aaaa', 'ak0000002']);
    expect(res.skipped).toBe(1);
    const ak = res.quakes[2];
    expect(ak.url).toBeNull();
    expect(ak.tsunami).toBe(true);
    expect(res.quakes[0]).toMatchObject({ mag: 3.4, depthKm: 8.2, lat: 37.86, lon: -122.4, status: 'reviewed' });
    expect(res.quakes[0].time).toBe(new Date(1794200000000).toISOString());
  });

  it('merges records for the same event reported by multiple networks, keeping the latest update', () => {
    const d = dedupeQuakes(res.quakes);
    expect(d).toHaveLength(2);
    const merged = d.find((q) => q.ids.includes('ci40000001'))!;
    expect(merged.id).toBe('us7000aaaa');
    expect(merged.mag).toBe(3.5);
    expect(merged.ids.sort()).toEqual(['ci40000001', 'us7000aaaa']);
  });
});

describe('refresh diff', () => {
  it('reports added, updated, and removed records', () => {
    const d = computeDiff(
      'usgs',
      [
        { id: 'a', rev: '1' },
        { id: 'b', rev: '1' },
        { id: 'c', rev: '1' },
      ],
      [
        { id: 'a', rev: '1' },
        { id: 'b', rev: '2' },
        { id: 'd', rev: '1' },
      ],
      'now',
      'before',
    );
    expect(d).toMatchObject({ added: ['d'], updated: ['b'], removed: ['c'], previousAt: 'before' });
  });

  it('reports no changes on the first refresh', () => {
    const d = computeDiff('nws', null, [{ id: 'a', rev: '1' }], 'now', null);
    expect(d.added).toEqual([]);
  });
});
