// What your own receiver (readsb / dump1090 with an SDR) is hearing: the farthest aircraft position heard in each
// 10° bearing sector from the receiver, as an outline. Built only from positions the receiver reported; sectors with
// nothing heard stay at zero range rather than being filled in.
// readsb writes the receiver's position to receiver.json next to aircraft.json when one is configured
// (https://github.com/wiedehopf/readsb/blob/dev/README-json.md).

import { geodesicDistanceKm } from './geo';

export const SDR_SECTORS = 36;

export interface ReceiverInfo { lat: number; lon: number; version: string | null }

export function parseReceiverJson(body: unknown): ReceiverInfo | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const lat = b?.lat, lon = b?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // readsb writes 0,0 when no location is set
  return { lat, lon, version: typeof b?.version === 'string' ? b.version.slice(0, 40) : null };
}

/** The receiver.json beside a configured aircraft.json URL. */
export function receiverJsonUrl(aircraftUrl: string): string | null {
  try {
    const u = new URL(aircraftUrl);
    if (!/\/aircraft\.json$/.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/aircraft\.json$/, 'receiver.json');
    u.search = '';
    return u.href;
  } catch {
    return null;
  }
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Farthest range (km) per sector, merged with an earlier result so the outline grows while the layer is on. */
export function updateCoverage(rx: ReceiverInfo, positions: { lat: number; lon: number }[], previous: number[] | null, maxKm = 650): number[] {
  const out = previous && previous.length === SDR_SECTORS ? previous.slice() : new Array<number>(SDR_SECTORS).fill(0);
  for (const p of positions) {
    const d = geodesicDistanceKm(rx.lat, rx.lon, p.lat, p.lon);
    // Beyond line of sight for ADS-B: a bad position, not reception.
    if (!(d > 0) || d > maxKm) continue;
    const s = Math.floor(bearingDeg(rx.lat, rx.lon, p.lat, p.lon) / (360 / SDR_SECTORS)) % SDR_SECTORS;
    if (d > out[s]) out[s] = d;
  }
  return out;
}

/** Outline points [lon, lat] at each sector's centre bearing (flat-earth offset; ranges are a few hundred km). */
export function coverageRing(rx: ReceiverInfo, ranges: number[]): [number, number][] {
  return ranges.map((km, i) => {
    const b = ((i + 0.5) * (360 / SDR_SECTORS) * Math.PI) / 180;
    const dLat = (km * Math.cos(b)) / 111.32;
    const dLon = (km * Math.sin(b)) / (111.32 * Math.max(0.05, Math.cos((rx.lat * Math.PI) / 180)));
    return [rx.lon + dLon, rx.lat + dLat];
  });
}
