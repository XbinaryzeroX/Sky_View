import type { GeoRecord } from './layers';
import { isValidLat, isValidLon } from './geo';
import { normalizedPassengerCallsign, type RouteAirport } from './route';

export interface FlightMovement {
  airport: RouteAirport;
  scheduledUtc: string | null;
  revisedUtc: string | null;
  predictedUtc: string | null;
  revisedKind: 'actual' | 'estimated' | 'revised';
  differenceMinutes: number | null;
  terminal: string | null;
  gate: string | null;
}
export interface DatedFlightStatus {
  source: string;
  callsign: string;
  flightNumber: string;
  airline: string;
  status: string;
  asOf: string | null;
  departure: FlightMovement;
  arrival: FlightMovement;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (v: unknown, max = 80) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const code = (v: unknown) => typeof v === 'string' ? v.toUpperCase().replace(/[\s-]/g, '') : '';
const statusNames: Record<string, string> = { Unknown: 'Unknown', Expected: 'Expected', EnRoute: 'En route',
  CheckIn: 'Check-in open', Boarding: 'Boarding', GateClosed: 'Gate closed', Departed: 'Departed', Delayed: 'Delayed',
  Approaching: 'Approaching', Arrived: 'Arrived', Canceled: 'Canceled', Diverted: 'Diverted', CanceledUncertain: 'Possible cancellation' };

const directOrigin = 'https://api.aerodatabox.com';
const query = '?withAircraftImage=false&withLocation=false&withFlightPlan=false';
export function datedFlightUrl(callsign: string): string {
  return directOrigin + '/flights/callsign/' + callsign + query;
}
export function isDatedFlightUrl(url: URL): boolean {
  if (url.origin !== directOrigin) return false;
  const callsign = normalizedPassengerCallsign(url.pathname.split('/').at(-1));
  return !!callsign && url.href === datedFlightUrl(callsign);
}

function utc(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const time = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function movement(value: unknown, status: string, arrival: boolean, asOf: string | null): FlightMovement | null {
  const m = object(value), a = object(m.airport), location = object(a.location);
  const icao = code(a.icao), iata = code(a.iata);
  if (!/^[A-Z0-9]{4}$/.test(icao) || !/^[A-Z]{3}$/.test(iata)) return null;
  const airport: RouteAirport = { icao, iata, name: text(a.name), city: text(a.municipalityName),
    country: text(a.countryCode, 2), lat: isValidLat(location.lat) ? location.lat : null,
    lon: isValidLon(location.lon) ? location.lon : null };
  const scheduledUtc = utc(object(m.scheduledTime).utc), revisedUtc = utc(object(m.revisedTime).utc);
  const predictedUtc = utc(object(m.predictedTime).utc);
  // The provider combines actual/estimated into revisedTime. Only a completed live movement
  // supports an actual label. Keep estimates, approximate feeds and diversion states qualified.
  const live = Array.isArray(m.quality) && m.quality.includes('Live') && !m.quality.includes('Approximate');
  const completed = arrival ? status === 'Arrived' : ['Departed', 'EnRoute', 'Approaching', 'Arrived'].includes(status);
  const future = arrival ? ['Expected', 'EnRoute', 'Approaching', 'Departed', 'Boarding', 'GateClosed', 'CheckIn'].includes(status)
                         : ['Expected', 'CheckIn', 'Boarding', 'GateClosed'].includes(status);
  const reportedComplete = live && completed && revisedUtc && asOf && Date.parse(revisedUtc) <= Date.parse(asOf);
  return { airport, scheduledUtc, revisedUtc, predictedUtc, revisedKind: reportedComplete ? 'actual' : future ? 'estimated' : 'revised',
    differenceMinutes: scheduledUtc && revisedUtc ? Math.round((Date.parse(revisedUtc) - Date.parse(scheduledUtc)) / 60000) : null,
    terminal: text(m.terminal, 18), gate: text(m.gate, 18) };
}

/** Resolve only one operating passenger service matching the selected observation and its dated itinerary. */
export function matchDatedFlight(body: unknown, selected: GeoRecord, callsign: string): DatedFlightStatus | null {
  if (!Array.isArray(body)) throw new Error('AeroDataBox returned an incomplete flight-status response.');
  const at = Date.parse(selected.observedAt ?? '');
  if (!Number.isFinite(at)) return null;
  const matches: DatedFlightStatus[] = [];
  for (const v of body) {
    const f = object(v), carrier = object(f.airline), aircraft = object(f.aircraft);
    const status = text(f.status), flightNumber = text(f.number, 16);
    if (normalizedPassengerCallsign(f.callSign) !== callsign || code(carrier.icao) !== callsign.slice(0, 3)
      || f.isCargo !== false || !['IsOperator', 'Unknown'].includes(String(f.codeshareStatus))
      || !status || !Object.hasOwn(statusNames, status) || !flightNumber
      || !/^[A-Z0-9]{2}\s?\d{1,4}[A-Z]?$/.test(flightNumber.toUpperCase())
      || flightNumber.slice(0, 2).toUpperCase() !== code(carrier.iata)) continue;
    const sourceHex = code(aircraft.modeS), sourceTail = code(aircraft.reg), observedTail = code(selected.props.registration);
    if ((sourceHex && sourceHex !== code(selected.id)) || (sourceTail && observedTail && sourceTail !== observedTail)) continue;
    if (!sourceHex && !(sourceTail && observedTail)) continue;
    const asOf = utc(f.lastUpdatedUtc);
    const departure = movement(f.departure, status, false, asOf), arrival = movement(f.arrival, status, true, asOf);
    if (!departure?.scheduledUtc || !arrival?.scheduledUtc || departure.airport.icao === arrival.airport.icao) continue;
    const scheduledStart = Date.parse(departure.scheduledUtc), scheduledEnd = Date.parse(arrival.scheduledUtc);
    if (scheduledStart >= scheduledEnd || scheduledEnd - scheduledStart > 30 * 3600000) continue;
    const start = Date.parse(departure.revisedUtc ?? departure.scheduledUtc);
    const end = Date.parse(arrival.revisedUtc ?? arrival.scheduledUtc);
    const onGround = selected.props.onGround === true;
    if (at < start - (onGround ? 2 * 3600000 : 15 * 60000) || at > end + (onGround ? 90 : 15) * 60000) continue;
    if (!onGround && ['Canceled', 'CanceledUncertain', 'CheckIn', 'Boarding', 'GateClosed'].includes(status)) continue;
    matches.push({ callsign, source: 'AeroDataBox', flightNumber, airline: text(carrier.name) ?? code(carrier.icao),
      status: statusNames[status], asOf, departure, arrival });
  }
  return matches.length === 1 ? matches[0] : null;
}
