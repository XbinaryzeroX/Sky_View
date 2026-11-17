// Nearest record to a point, within a limit. Used for "nearest camera" hand-offs from a selected record.
import { geodesicDistanceKm } from './geo';

export function nearestRecord<T extends { lat: number; lon: number }>(lat: number, lon: number, records: readonly T[], maxKm: number): { record: T; distanceKm: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Box test first (longitude degrees shrink towards the poles; wraps at the date line).
  const dLat = maxKm / 110;
  const dLon = Math.min(180, maxKm / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180))));
  let best: { record: T; distanceKm: number } | null = null;
  for (const record of records) {
    if (Math.abs(record.lat - lat) > dLat) continue;
    if (Math.abs((((record.lon - lon) % 360) + 540) % 360 - 180) > dLon) continue;
    const distanceKm = geodesicDistanceKm(lat, lon, record.lat, record.lon);
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) best = { record, distanceKm };
  }
  return best;
}
