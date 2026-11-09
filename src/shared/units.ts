// Unit formatting for distances, altitudes and speeds.

export type Units = 'metric' | 'imperial' | 'nautical';

export function fmtDistanceKm(km: number, u: Units): string {
  if (u === 'imperial') return km * 0.621371 < 0.2 ? `${Math.round(km * 3280.84)} ft` : `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`;
  if (u === 'nautical') return `${(km / 1.852).toFixed(km < 18 ? 1 : 0)} nm`;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function fmtAltitudeM(m: number | null, u: Units): string {
  if (m === null) return '—';
  return u === 'metric' ? `${Math.round(m).toLocaleString()} m` : `${Math.round(m / 0.3048).toLocaleString()} ft`;
}

export function fmtSpeedKts(kts: number | null, u: Units): string {
  if (kts === null) return '—';
  if (u === 'metric') return `${Math.round(kts * 1.852)} km/h`;
  if (u === 'imperial') return `${Math.round(kts * 1.15078)} mph`;
  return `${Math.round(kts)} kt`;
}
