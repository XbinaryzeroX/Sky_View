import { describe, expect, it } from 'vitest';
import { bundledAirlineRoute, resolvedRouteAirport } from '../src/renderer/lib/passengerRoutes';
import { parseRouteset, publicAirlineCallsign, routeMapSegments } from '../src/shared/route';
import type { GeoRecord } from '../src/shared/layers';

const record: GeoRecord = { id: 'sample', lat: 0, lon: 0, altM: null, heading: null, speedKts: null,
  label: '', category: null, observedAt: null, sourceUrl: null, source: 'fixture', props: { callsign: 'BAW0117 ' } };

describe('passenger airline journeys', () => {
  it('joins the published callsign with the original airport directory, including across the date line', async () => {
    const callsign = publicAirlineCallsign('aircraft', record);
    expect(callsign).toBe('BAW117');
    const atlantic = await bundledAirlineRoute(callsign!);
    expect(atlantic?.airports.map(airport => airport.iata)).toEqual(['LHR', 'JFK']);
    expect(atlantic?.airline).toBe('British Airways');
    expect(atlantic?.flightNumber).toBeUndefined();
    const pacific = await bundledAirlineRoute('ANZ4');
    expect(pacific?.airports.map(airport => airport.iata)).toEqual(['AKL', 'LAX']);
    const [[departure, arrival]] = routeMapSegments(pacific);
    expect(departure[0]).toBeGreaterThan(170);
    expect(arrival[0]).toBeLessThan(-110);
  });

  it('declines snapshots, flagged records, unsupported operators, registrations and partial callsigns', () => {
    expect(publicAirlineCallsign('aircraftMil', record)).toBeNull();
    const exclusions: GeoRecord['props'][] = [{ militaryFlag: true }, { restrictedTracking: true }, { snapshot: true }, { callsign: 'N123AB' }, { callsign: 'XYZ117' }, { callsign: 'BAW117-extra' }];
    for (const additional of exclusions) {
      expect(publicAirlineCallsign('aircraft', { ...record, props: { ...record.props, ...additional } })).toBeNull();
    }
  });

  it('fills missing airport coordinates only for matching airport codes', () => {
    const airport = { icao: 'KJFK', iata: 'JFK', name: null, lat: null, lon: null, country: null, city: null };
    expect(resolvedRouteAirport(airport)).toMatchObject({ lat: expect.any(Number), lon: expect.any(Number) });
    for (const iata of ['LHR', null]) {
      const different = { ...airport, iata };
      expect(resolvedRouteAirport(different)).toBe(different);
    }
  });

  it('frames a date-line crossing through the Pacific and includes the high-latitude curve on the Atlantic leg', async () => {
    const { airlineRouteBounds } = await import('../src/renderer/map/airlineRouteView');
    const pacific = (await bundledAirlineRoute('ANZ4'))!;
    const box = airlineRouteBounds(pacific)!;
    expect(box.west).toBeGreaterThan(box.east);
    expect(box.width).toBeLessThan(Math.PI);
    const atlantic = (await bundledAirlineRoute('BAW117'))!;
    const north = airlineRouteBounds(atlantic)!.north * 180 / Math.PI;
    expect(north).toBeGreaterThan(Math.max(...atlantic.airports.map(a => a.lat!)) + 2);
    expect(airlineRouteBounds({ ...atlantic, plausible: false })).toBeNull();
  });

  it('requires the requested callsign and does not draw across an unknown stop or a rejected route', () => {
    const airports = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].map((icao, i) => ({ icao, lat: i, lon: i }));
    airports[2].lat = 100;
    const reply = [{ callsign: 'BAW117', _airports: airports, plausible: true }];
    expect(parseRouteset(reply, 'BAW118')).toBeNull();
    const route = parseRouteset(reply, 'BAW117')!;
    expect(routeMapSegments(route)).toEqual([[[0, 0], [1, 1]], [[3, 3], [4, 4]]]);
    expect(routeMapSegments({ ...route, plausible: false })).toEqual([]);
    expect(parseRouteset([{ callsign: 'BAW117', _airports: [airports[0], null] }], 'BAW117')).toBeNull();
  });
});
