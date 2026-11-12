import type { RouteAirport, RouteInfo } from '../../shared/route';
import catalog from '../../shared/passengerCarriers.json';
import { AIRPORTS } from '../data/airports';
import additionalAirports from '../data/passenger-route-airports.json';

const airportsByIcao = new Map(AIRPORTS.map(airport => [airport[0], airport]));
type AdditionalAirport = [string, string, string, number, number, string, string];
const additionalByIcao = new Map((additionalAirports as AdditionalAirport[]).map(a => [a[0], a]));
const carriers: Readonly<Record<string, string>> = catalog.carriers;

function airportByIcao(icao: string): RouteAirport {
  const a = airportsByIcao.get(icao);
  if (a) return { icao, iata: a[1] || null, name: a[2], lat: a[3], lon: a[4], country: a[6], city: a[7] || null };
  const extra = additionalByIcao.get(icao);
  return { icao, iata: extra?.[1] || null, name: extra?.[2] || null, lat: extra?.[3] ?? null,
    lon: extra?.[4] ?? null, country: extra?.[5] || null, city: extra?.[6] || null };
}

/** Resolve a missing airport position only when both published identifiers match the local directory. */
export function resolvedRouteAirport(airport: RouteAirport): RouteAirport {
  if ((airport.lat !== null && airport.lon !== null) || !airport.icao || !airport.iata) return airport;
  const local = airportByIcao(airport.icao);
  return local.iata === airport.iata && local.lat !== null && local.lon !== null
    ? { ...airport, lat: local.lat, lon: local.lon, city: airport.city ?? local.city, name: airport.name ?? local.name } : airport;
}

/** Each line of the pinned CC0 catalog contains one exact callsign and its ordered airport codes. */
export async function bundledAirlineRoute(callsign: string): Promise<RouteInfo | null> {
  const airline = carriers[callsign.slice(0, 3)];
  if (!airline || !/^[A-Z]{3}\d[\dA-Z]{0,3}$/.test(callsign)) return null;
  const { default: rows } = await import('../data/passenger-routes.txt?raw');
  const prefix = '\n' + callsign + ',';
  const match = rows.indexOf(prefix);
  if (match < 0) return null;
  const start = match + prefix.length;
  const codes = rows.slice(start, rows.indexOf('\n', start)).trim().split('-');
  const airports = codes.map(airportByIcao);
  return { callsign, airports, airline, plausible: null, source: catalog.source + ' · ' + catalog.published };
}
