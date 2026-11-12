import { isValidLat, isValidLon } from '../shared/geo';
import { cleanText } from '../shared/normalize';

type Match = { label: string; lat: number; lon: number };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Both services publish numeric WGS84 coordinates. A null ordinate must never become zero. */
export function geocodingMatches(provider: 'Google' | 'Census', reply: unknown): Match[] {
  const data = object(reply);
  if (provider === 'Google') {
    if (data.status === 'ZERO_RESULTS') return [];
    if (data.status === 'REQUEST_DENIED') throw new Error('Google refused the search. Check the Geocoding API permissions for your key.');
    if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'OVER_DAILY_LIMIT') throw new Error('Google Geocoding reported a usage limit. Check the quota for your key.');
    if (data.status !== 'OK') throw new Error('Google Geocoding could not complete this search.');
  }
  const rows = provider === 'Google' ? data.results : object(data.result).addressMatches;
  if (!Array.isArray(rows)) throw new Error(`${provider} returned an incomplete geocoding response.`);
  const matches: Match[] = [];
  for (const raw of rows) {
    const row = object(raw);
    const google = provider === 'Google';
    const coordinates = object(google ? object(row.geometry).location : row.coordinates);
    const label = cleanText(google ? row.formatted_address : row.matchedAddress, 200);
    const lat = google ? coordinates.lat : coordinates.y;
    const lon = google ? coordinates.lng : coordinates.x;
    if (label && isValidLat(lat) && isValidLon(lon)) matches.push({ label, lat, lon });
    if (matches.length === 5) break;
  }
  if (rows.length && !matches.length) throw new Error(`${provider} returned matches without a usable address and map position.`);
  return matches;
}
