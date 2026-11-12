import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { supersededAlertIds } from '../src/shared/dedupe';
import { geodesicDistanceKm, pointInGeometry } from '../src/shared/geo';
import { evaluateLocations, freshnessOf, matchAlert } from '../src/shared/monitoring';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import type { FeedStatus, WeatherAlert } from '../src/shared/types';
import { fixture, loc } from './helpers';

const square: Polygon = { type: 'Polygon', coordinates: [[[-105.2, 39.6], [-104.8, 39.6], [-104.8, 39.9], [-105.2, 39.9], [-105.2, 39.6]]] };

function alert(over: Partial<WeatherAlert> = {}): WeatherAlert {
  return {
    id: 'a1',
    sourceUrl: 'https://api.weather.gov/alerts/a1',
    event: 'Test',
    headline: null,
    description: null,
    instruction: null,
    severity: 'Severe',
    urgency: 'Immediate',
    certainty: 'Observed',
    status: 'Actual',
    messageType: 'Alert',
    category: null,
    sent: '2026-11-09T00:00:00.000Z',
    effective: null,
    onset: null,
    expires: '2099-01-01T00:00:00.000Z',
    ends: null,
    senderName: null,
    areaDesc: null,
    affectedZones: [],
    ugc: [],
    same: [],
    references: [],
    geometry: null,
    bbox: null,
    ...over,
  };
}

describe('point-in-polygon', () => {
  it('detects inside, outside, and boundary points', () => {
    expect(pointInGeometry(39.74, -104.99, square)).toBe(true);
    expect(pointInGeometry(40.5, -104.99, square)).toBe(false);
    expect(pointInGeometry(39.6, -105.0, square)).toBe(true); // on edge counts as inside
  });

  it('respects holes in polygons', () => {
    const withHole: Polygon = {
      type: 'Polygon',
      coordinates: [square.coordinates[0], [[-105.05, 39.7], [-104.95, 39.7], [-104.95, 39.8], [-105.05, 39.8], [-105.05, 39.7]]],
    };
    expect(pointInGeometry(39.75, -105.0, withHole)).toBe(false);
    expect(pointInGeometry(39.65, -105.1, withHole)).toBe(true);
  });

  it('handles MultiPolygon', () => {
    const mp = { type: 'MultiPolygon' as const, coordinates: [square.coordinates, [[[-96.1, 36.1], [-95.9, 36.1], [-95.9, 36.2], [-96.1, 36.2], [-96.1, 36.1]]]] };
    expect(pointInGeometry(36.15, -96.0, mp)).toBe(true);
    expect(pointInGeometry(38, -100, mp)).toBe(false);
  });

  it('handles polygons crossing the antimeridian (Aleutians)', () => {
    const aleutian: Polygon = { type: 'Polygon', coordinates: [[[179, 51], [-179, 51], [-179, 53], [179, 53], [179, 51]]] };
    expect(pointInGeometry(52, 179.5, aleutian)).toBe(true);
    expect(pointInGeometry(52, -179.5, aleutian)).toBe(true);
    expect(pointInGeometry(52, 0, aleutian)).toBe(false);
    expect(pointInGeometry(52, -170, aleutian)).toBe(false);
  });
});

describe('alert intersection', () => {
  it('uses polygon geometry when supplied', () => {
    const a = alert({ geometry: square });
    expect(matchAlert(loc({ lat: 39.74, lon: -104.99 }), a)).toEqual({ alertId: 'a1', status: 'inside', method: 'polygon' });
    expect(matchAlert(loc({ lat: 41, lon: -104.99 }), a)).toEqual({ alertId: 'a1', status: 'outside', method: 'polygon' });
  });

  it('does not infer coverage from the polygon center: a point near the centroid of a concave polygon can be outside', () => {
    // U-shaped polygon whose centroid lies in the notch
    const u: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
    expect(matchAlert(loc({ lat: 2, lon: 1.5 }), alert({ geometry: u })).status).toBe('outside');
  });

  it('reports unknown (not outside) when geometry is missing and zones are unknown', () => {
    const a = alert({ affectedZones: ['https://api.weather.gov/zones/forecast/OKZ060'] });
    expect(matchAlert(loc({ zones: { status: 'pending', zones: [], checkedAt: null, error: null } }), a).status).toBe('unknown');
    expect(matchAlert(loc({ zones: { status: 'error', zones: [], checkedAt: null, error: 'x' } }), a).status).toBe('unknown');
    expect(matchAlert(loc({ zones: { status: 'outside_coverage', zones: [], checkedAt: null, error: null } }), a).status).toBe('unknown');
  });

  it('matches zone-based alerts using the location zones', () => {
    const a = alert({ affectedZones: ['https://api.weather.gov/zones/forecast/OKZ060', 'https://api.weather.gov/zones/county/OKC143'] });
    const zones = (z: string[]) => ({ status: 'resolved' as const, zones: z, checkedAt: '2026-11-09T00:00:00Z', error: null });
    expect(matchAlert(loc({ zones: zones(['forecast/OKZ060', 'county/OKC143']) }), a)).toMatchObject({ status: 'inside', method: 'zone' });
    expect(matchAlert(loc({ zones: zones(['forecast/OKZ061', 'county/OKC145']) }), a)).toMatchObject({ status: 'outside', method: 'zone' });
    // Fire coverage alone does not establish the point's forecast/county zones.
    expect(matchAlert(loc({ zones: zones(['fire/OKZ060']) }), a).status).toBe('unknown');
  });

  it('missing geometry with no affected zones stays unknown', () => {
    const a = alert({ affectedZones: [] });
    const l = loc({ zones: { status: 'resolved', zones: ['forecast/OKZ060'], checkedAt: null, error: null } });
    expect(matchAlert(l, a).status).toBe('unknown');
  });
});

describe('evaluateLocations', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('separates confirmed, nonintersecting, and undeterminable alerts and adds a coverage note', () => {
    const alerts = [alert({ id: 'poly', geometry: square, bbox: null }), alert({ id: 'zone', affectedZones: ['https://api.weather.gov/zones/forecast/COZ039'] })];
    const ev = evaluateLocations({ locations: [loc()], alerts, superseded: new Set(), quakes: [], nwsFreshness: 'fresh', usgsFreshness: 'fresh', now }).loc1;
    expect(ev.alertsInside.map((m) => m.alertId)).toEqual(['poly']);
    expect(ev.alertsUnknown.map((m) => m.alertId)).toEqual(['zone']);
    expect(ev.alertsOutsideCount).toBe(0);
    expect(ev.alertCoverageNote).toMatch(/not yet known/);
  });

  it('does not double-count superseded revisions, cancellations, expired, or test alerts', () => {
    const body = fixture('nws-alerts.json');
    const { alerts } = normalizeNwsAlerts(body);
    const sup = supersededAlertIds(alerts);
    expect([...sup]).toEqual(['urn:oid:fixture.zone.0']);
    const extra = [
      alert({ id: 'cancel', messageType: 'Cancel', geometry: square }),
      alert({ id: 'expired', expires: '2026-11-09T11:00:00Z', geometry: square }),
      alert({ id: 'endedButNotExpired', ends: '2026-11-09T11:59:00Z', expires: '2099-01-01T00:00:00Z', geometry: square }),
      alert({ id: 'test', status: 'Test', geometry: square }),
    ];
    const tulsa = loc({ id: 'tulsa', lat: 36.15, lon: -95.99, zones: { status: 'resolved', zones: ['forecast/OKZ060'], checkedAt: null, error: null } });
    const denver = loc({ id: 'denver' });
    const ev = evaluateLocations({ locations: [tulsa, denver], alerts: [...alerts, ...extra], superseded: sup, quakes: [], nwsFreshness: 'fresh', usgsFreshness: 'fresh', now });
    expect(ev.tulsa.alertsInside.map((m) => m.alertId)).toEqual(['urn:oid:fixture.zone.1']);
    expect(ev.denver.alertsInside.map((m) => m.alertId)).toEqual(['urn:oid:fixture.poly.1']);
  });

  it('reports nothing as confirmed when the alert feed is unavailable', () => {
    const ev = evaluateLocations({ locations: [loc()], alerts: [alert({ geometry: square })], superseded: new Set(), quakes: [], nwsFreshness: 'unavailable', usgsFreshness: 'unavailable', now }).loc1;
    expect(ev.alertsInside).toHaveLength(0);
    expect(ev.alertCoverageNote).toMatch(/unavailable/);
  });

  it('keeps evaluating against stale data but flags it', () => {
    const ev = evaluateLocations({ locations: [loc()], alerts: [alert({ geometry: square })], superseded: new Set(), quakes: [], nwsFreshness: 'stale', usgsFreshness: 'fresh', now }).loc1;
    expect(ev.alertsInside).toHaveLength(1);
    expect(ev.alertCoverageNote).toMatch(/stale/);
  });
});

describe('earthquake distance filtering', () => {
  it('computes geodesic distances accurately', () => {
    // JFK to LAX ≈ 3983 km on WGS84
    expect(geodesicDistanceKm(40.6413, -73.7781, 33.9416, -118.4085)).toBeCloseTo(3983, -1);
    // One degree of latitude at the equator ≈ 110.57 km
    expect(geodesicDistanceKm(0, 0, 1, 0)).toBeCloseTo(110.574, 2);
    // Across the antimeridian
    expect(geodesicDistanceKm(51.5, 179.9, 51.5, -179.9)).toBeLessThan(15);
  });

  it('includes quakes within each location radius, sorted by epicenter distance', () => {
    const { quakes } = normalizeUsgsFeed(fixture('usgs-week.json'));
    const sf = loc({ id: 'sf', lat: 37.7749, lon: -122.4194, radiusKm: 15 });
    const sfSmall = loc({ id: 'sfSmall', lat: 37.7749, lon: -122.4194, radiusKm: 5 });
    const adak = loc({ id: 'adak', lat: 51.88, lon: -176.66, radiusKm: 500 });
    const ev = evaluateLocations({ locations: [sf, sfSmall, adak], alerts: [], superseded: new Set(), quakes, nwsFreshness: 'fresh', usgsFreshness: 'fresh', now: new Date() });
    expect(ev.sf.quakesNearby.length).toBe(2); // both network versions before dedupe
    expect(ev.sf.quakesNearby[0].distanceKm).toBeGreaterThan(9);
    expect(ev.sf.quakesNearby[0].distanceKm).toBeLessThan(10.5);
    expect(ev.sfSmall.quakesNearby).toHaveLength(0);
    // 179.5E is across the antimeridian from Adak (-176.66) and ~270 km away
    expect(ev.adak.quakesNearby.map((q) => q.quakeId)).toEqual(['ak0000002']);
  });
});

describe('feed freshness', () => {
  const base: FeedStatus = { feed: 'nws', state: 'ok', lastAttemptAt: null, lastSuccessAt: null, sourceUpdatedAt: null, fromCache: false, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: 0, skippedRecords: 0 };
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('is unavailable without any successful retrieval', () => {
    expect(freshnessOf(base, 180, now)).toBe('unavailable');
  });
  it('is fresh within the threshold and stale after it', () => {
    expect(freshnessOf({ ...base, lastSuccessAt: '2026-11-09T11:55:00Z' }, 180, now)).toBe('fresh');
    expect(freshnessOf({ ...base, lastSuccessAt: '2026-11-09T11:45:00Z' }, 180, now)).toBe('stale');
    // Longer poll intervals stretch the threshold (3x poll)
    expect(freshnessOf({ ...base, lastSuccessAt: '2026-11-09T11:45:00Z' }, 600, now)).toBe('fresh');
  });
});
