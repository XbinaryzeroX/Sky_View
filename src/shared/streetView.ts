import { isValidLat, isValidLon } from './geo';

/** A browser handoff to Google's closest panorama, never an imagery or coverage request. */
export function streetViewUrl(lat: unknown, lon: unknown): string | null {
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  // Validate before rounding; retain both valid antimeridian endpoints.
  const coordinate = (value: number) => String(Number(value.toFixed(6)));
  const url = new URL('https://www.google.com/maps/@');
  url.searchParams.set('api', '1');
  url.searchParams.set('map_action', 'pano');
  url.searchParams.set('viewpoint', `${coordinate(lat)},${coordinate(lon)}`);
  return url.href;
}
