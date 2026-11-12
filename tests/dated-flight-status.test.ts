import { describe, expect, it, vi } from 'vitest';
import { createAirlineStatusLookup } from '../src/main/airlineFlightStatus';
import { assertAllowedUrl, fetchJson, type FetchJson } from '../src/main/feeds/http';
import { datedFlightUrl, matchDatedFlight } from '../src/shared/flightStatus';
import { validateIpcArgs, IPC } from '../src/shared/ipc';
import type { GeoRecord } from '../src/shared/layers';

const now = Date.parse('2026-11-11T12:00:00Z');
const record: GeoRecord = { id: 'aabbcc', lat: 50, lon: 2, label: 'BAW117', altM: null, heading: null, speedKts: null,
  category: null, observedAt: '2026-11-11T11:59:55Z', source: 'fixture', sourceUrl: null, props: { callsign: 'BAW117', registration: 'G-TEST' } };
const departure = { airport: { icao: 'EGLL', iata: 'LHR', name: 'Heathrow', municipalityName: 'London',
  location: { lat: 51.47, lon: -0.45 } }, scheduledTime: { utc: '2026-11-11 10:00Z' }, revisedTime: { utc: '2026-11-11 10:14Z' }, quality: ['Live'] };
const arrival = { airport: { icao: 'KJFK', iata: 'JFK', name: 'Kennedy', municipalityName: 'New York' },
  scheduledTime: { utc: '2026-11-11T16:30:00Z' }, revisedTime: { utc: '2026-11-11T16:45:00Z' }, quality: ['Live'] };
const flight = { callSign: 'BAW117', number: 'BA 117', airline: { icao: 'BAW', iata: 'BA', name: 'British Airways' },
  codeshareStatus: 'IsOperator', status: 'EnRoute', isCargo: false, aircraft: { reg: 'GTEST', modeS: 'AABBCC' },
  lastUpdatedUtc: '2026-11-11 11:55Z', departure, arrival };

describe('dated commercial flight status', () => {
  it('separates scheduled, revised and predicted times with source identity and corroborated airframe evidence', () => {
    const status = matchDatedFlight([flight], record, 'BAW117');
    expect(status).toMatchObject({ airline: 'British Airways', flightNumber: 'BA 117', status: 'En route',
      departure: { scheduledUtc: '2026-11-11T10:00:00.000Z', revisedKind: 'actual', differenceMinutes: 14 },
      arrival: { airport: { iata: 'JFK', lat: null }, revisedKind: 'estimated', predictedUtc: null, differenceMinutes: 15 } });
    const approximate = { ...flight, departure: { ...departure, quality: ['Approximate'] } };
    expect(matchDatedFlight([approximate], record, 'BAW117')?.departure.revisedKind).toBe('revised');
    const diverted = { ...flight, status: 'Diverted' };
    expect(matchDatedFlight([diverted], record, 'BAW117')?.arrival.revisedKind).toBe('revised');
  });

  it('withholds another service date, a codeshare, cargo, conflicting identities and ambiguous results', () => {
    for (const result of [[flight, flight], [{ ...flight, callSign: 'BAW118' }], [{ ...flight, isCargo: true }],
      [{ ...flight, codeshareStatus: 'IsCodeshared' }], [{ ...flight, number: 'IB 117' }],
      [{ ...flight, aircraft: {} }], [{ ...flight, aircraft: { modeS: '000001', reg: 'G-TEST' } }],
      [{ ...flight, aircraft: { modeS: 'AABBCC', reg: 'G-OTHER' } }], [{ ...flight, status: 'Canceled' }]]) {
      expect(matchDatedFlight(result, record, 'BAW117')).toBeNull();
    }
    expect(matchDatedFlight([flight], { ...record, observedAt: '2026-11-12T12:00:00Z' }, 'BAW117')).toBeNull();
    expect(() => matchDatedFlight({ response: 'invalid' }, record, 'BAW117')).toThrow(/incomplete/);
  });

  it('issues a single customer-key request, coalesces duplicate clicks and treats no-content as unavailable', async () => {
    const network = vi.fn<FetchJson>().mockResolvedValue({ status: 200, body: [flight] });
    let key: string | null = null, clock = now;
    const lookup = createAirlineStatusLookup(network, id => id === record.id ? record : undefined, () => key, () => clock);
    await expect(lookup('ffffff', 'BAW117')).rejects.toThrow(/current passenger/);
    await expect(lookup(record.id, 'BAW118')).rejects.toThrow(/current passenger/);
    await expect(lookup(record.id, 'BAW117')).rejects.toThrow(/key/);
    expect(network).not.toHaveBeenCalled();
    key = 'QA_FIXTURE_KEY';
    const [one, two] = await Promise.all([lookup(record.id, 'BAW117'), lookup(record.id, 'BAW117')]);
    expect(one?.arrival.airport.iata).toBe('JFK');
    expect(two).toEqual(one);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]).toEqual([datedFlightUrl('BAW117'), expect.objectContaining({
      headers: { 'X-Api-Key': key, Accept: 'application/json' }, sameOrigin: true, rejectRedirects: true })]);
    await lookup(record.id, 'BAW117');
    expect(network).toHaveBeenCalledTimes(1);
    key = 'DIFFERENT_FIXTURE_ACCOUNT';
    await lookup(record.id, 'BAW117');
    expect(network).toHaveBeenCalledTimes(2);
    clock += 61000;
    network.mockResolvedValue({ status: 204, body: null });
    expect(await lookup(record.id, 'BAW117')).toBeNull();
    clock += 300000;
    await expect(lookup(record.id, 'BAW117')).rejects.toThrow(/current passenger/);
    expect(network).toHaveBeenCalledTimes(3);
  });

  it('never reaches paid transport for snapshots, private registrations or flagged aircraft, and refuses redirected calls', async () => {
    const network = vi.fn<FetchJson>();
    const changes: GeoRecord['props'][] = [{ snapshot: true }, { militaryFlag: true }, { callsign: 'N123AB' }];
    for (const change of changes) {
      const lookup = createAirlineStatusLookup(network, () => ({ ...record, props: { ...record.props, ...change } }), () => 'fixture', () => now);
      await expect(lookup(record.id, 'BAW117')).rejects.toThrow(/current passenger/);
    }
    expect(network).not.toHaveBeenCalled();
    const url = datedFlightUrl('BAW117');
    expect(assertAllowedUrl(url).href).toBe(url);
    for (const wrong of [url.replace('BAW117', 'N123AB'), url.replace('callsign/', 'reg/'), url.replace('withFlightPlan=false', 'withFlightPlan=true')]) {
      expect(() => assertAllowedUrl(wrong)).toThrow();
    }
    expect(() => validateIpcArgs(IPC.airlineFlightStatus, [record.id, 'BAW117', 'https://example.org/'])).toThrow();
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: url } }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(fetchJson(url, { rejectRedirects: true })).rejects.toThrow(/redirected/);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
