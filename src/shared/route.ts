// Reported route for a callsign (adsb.lol /api/0/routeset, backed by a community
// route database). This is the route usually flown under that callsign, checked by
// adsb.lol for plausibility against the current position. It is NOT a filed flight
// plan for today, not a schedule, and says nothing about delays, diversions or
// cancellations.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import catalog from './passengerCarriers.json';

export interface RouteAirport {
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}
export interface RouteInfo {
  callsign: string;
  airports: RouteAirport[];
  plausible: boolean | null;
  source: string;
  airline?: string;
  /** Only set by a source that explicitly supplies a public flight number. */
  flightNumber?: string;
}

/** Match only an identified passenger operator on a current, unflagged civil aircraft record. */
export function publicAirlineCallsign(layer: string, record: GeoRecord): string | null {
  if (layer !== 'aircraft' || record.props.militaryFlag === true || record.props.restrictedTracking === true || record.props.snapshot === true) return null;
  return normalizedPassengerCallsign(record.props.callsign);
}

export function normalizedPassengerCallsign(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim().toUpperCase();
  const match = /^([A-Z]{3})[ \t]*(\d[\dA-Z]{0,4})$/.exec(input);
  if (!match || !Object.hasOwn(catalog.carriers, match[1])) return null;
  // VRS normalizes leading zeros. Retain one zero before a wholly alphabetic suffix.
  const number = match[2].replace(/^0+(?=\d)/, '').replace(/^0+(?=[A-Z])/, '0');
  return /^\d{1,4}[A-Z]{0,2}$/.test(number) && number.length <= 4 ? match[1] + number : null;
}

/** A missing intermediate position breaks the map line; it cannot silently become a direct leg. */
export function routeMapSegments(route: RouteInfo | null | undefined): [number, number][][] {
  if (!route || route.plausible === false) return [];
  const segments: [number, number][][] = [];
  let points: [number, number][] = [];
  for (const airport of route.airports) {
    if (isValidLat(airport.lat) && isValidLon(airport.lon)) {
      points.push([airport.lon, airport.lat]);
    } else {
      if (points.length > 1) segments.push(points);
      points = [];
    }
  }
  if (points.length > 1) segments.push(points);
  return segments;
}

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Parses the routeset response; returns null when no route is known. */
export function parseRouteset(body: unknown, callsign: string): RouteInfo | null {
  const arr = Array.isArray(body) ? body : null;
  const hit = arr?.find((x) => str((x as Record<string, unknown>)?.callsign)?.toUpperCase() === callsign.toUpperCase());
  if (!hit || typeof hit !== 'object') return null;
  const h = hit as Record<string, unknown>;
  const aps = Array.isArray(h._airports) ? h._airports : Array.isArray(h.airports) ? h.airports : [];
  if (aps.length > 10 || aps.some(a => !a || typeof a !== 'object')) return null;
  const airports = (aps as Record<string, unknown>[]).map((a) => ({
    icao: str(a.icao, 4),
    iata: str(a.iata, 3),
    name: str(a.name),
    city: str(a.location),
    country: str(a.countryiso2, 2),
    lat: isValidLat(a.lat) ? a.lat : null,
    lon: isValidLon(a.lon) ? a.lon : null,
  }));
  if (airports.length < 2 || airports.some(a => !a.icao && !a.iata && !a.name)) return null;
  return { callsign: callsign.toUpperCase(), airports, plausible: typeof h.plausible === 'boolean' ? h.plausible : typeof h.plausible === 'number' ? h.plausible > 0 : null, source: 'adsb.lol route database' };
}
