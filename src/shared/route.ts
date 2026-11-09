// Reported route for a callsign (adsb.lol /api/0/routeset, backed by a community
// route database). This is the route usually flown under that callsign, checked by
// adsb.lol for plausibility against the current position. It is NOT a filed flight
// plan for today, not a schedule, and says nothing about delays, diversions or
// cancellations.

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
}

const str = (v: unknown, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const numv = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parses the routeset response; returns null when no route is known. */
export function parseRouteset(body: unknown, callsign: string): RouteInfo | null {
  const arr = Array.isArray(body) ? body : null;
  const hit = arr?.find((x) => str((x as Record<string, unknown>)?.callsign)?.toUpperCase() === callsign.toUpperCase()) ?? arr?.[0];
  if (!hit || typeof hit !== 'object') return null;
  const h = hit as Record<string, unknown>;
  const aps = Array.isArray(h._airports) ? h._airports : Array.isArray(h.airports) ? h.airports : [];
  const airports = (aps as Record<string, unknown>[]).slice(0, 6).map((a) => ({
    icao: str(a.icao, 4),
    iata: str(a.iata, 3),
    name: str(a.name),
    city: str(a.location),
    country: str(a.countryiso2, 2),
    lat: numv(a.lat),
    lon: numv(a.lon),
  }));
  if (airports.length < 2) return null;
  return { callsign: callsign.toUpperCase(), airports, plausible: typeof h.plausible === 'boolean' ? h.plausible : typeof h.plausible === 'number' ? h.plausible > 0 : null, source: 'adsb.lol route database' };
}
