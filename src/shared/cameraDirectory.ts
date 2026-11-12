import type { GeoRecord } from './layers';

export type CameraMediaFilter = 'all' | 'hls' | 'still' | 'viewer' | 'fav';

/** Cesium view bounds use west > east when the view crosses the date line. */
export function cameraInView(camera: Pick<GeoRecord, 'lat' | 'lon'>, [west, south, east, north]: [number, number, number, number]): boolean {
  const longitude = (lon: number) => west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
  // +180 and -180 describe the same meridian, including a view ending exactly there.
  return camera.lat >= south && camera.lat <= north &&
    (longitude(camera.lon) || (Math.abs(camera.lon) === 180 && longitude(-camera.lon)));
}

export function filterCameras(cameras: GeoRecord[], options: { country: string; media: CameraMediaFilter; favorites: string[]; query: string; bbox: [number, number, number, number] | null }): GeoRecord[] {
  const needle = options.query.trim().toLocaleLowerCase();
  const favorites = new Set(options.favorites);
  return cameras.filter((c) =>
    (options.country === 'all' || String(c.props.country) === options.country) &&
    (options.media === 'all' || (options.media === 'fav' ? favorites.has(c.id) : c.props.mediaType === options.media)) &&
    (!options.bbox || cameraInView(c, options.bbox)) &&
    (!needle || `${c.label} ${c.props.locality ?? ''} ${c.props.county ?? ''} ${c.props.route ?? ''} ${c.props.country ?? ''}`.toLocaleLowerCase().includes(needle)),
  );
}
