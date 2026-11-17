// 10 m wind forecast field (NOAA GFS, 1° grid) and pure helpers to read it: the newest run, the index lines that locate
// the u/v messages, and bilinear sampling with longitude wrap. A forecast, never an observation.

export interface WindField {
  model: 'GFS 1.0°';
  source: 'NOAA Global Forecast System';
  /** Model run (reference) time and the time the field is valid for (UTC ISO). */
  runTime: string;
  validTime: string;
  forecastHours: number;
  retrievedAt: string;
  ni: number;
  nj: number;
  la1: number;
  lo1: number;
  di: number;
  dj: number;
  /** Eastward and northward wind, m/s, row-major from la1. */
  u: Float32Array;
  v: Float32Array;
}

const HOUR = 3_600_000;
/** GFS runs at 00, 06, 12 and 18 UTC; 1° files are usually all on the bucket about 4 h 30 min later. */
export const GFS_PUBLISH_LAG_MS = 4.5 * HOUR;

/** Runs to try, newest first: the newest one expected to be complete, then three older ones. */
export function gfsCandidateRuns(nowMs: number): Date[] {
  const newest = Math.floor((nowMs - GFS_PUBLISH_LAG_MS) / (6 * HOUR)) * 6 * HOUR;
  return [0, 1, 2, 3].map((k) => new Date(newest - k * 6 * HOUR));
}

/** The 3-hourly forecast step closest to now for a run (0–120 h). */
export function gfsForecastHour(run: Date, nowMs: number): number {
  return Math.max(0, Math.min(120, Math.round((nowMs - run.getTime()) / (3 * HOUR)) * 3));
}

export function gfsFileUrl(run: Date, fh: number): string {
  const d = run.toISOString();
  const ymd = d.slice(0, 4) + d.slice(5, 7) + d.slice(8, 10);
  const hh = d.slice(11, 13);
  return `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.${ymd}/${hh}/atmos/gfs.t${hh}z.pgrb2.1p00.f${String(fh).padStart(3, '0')}`;
}

/** Byte range of the message whose index line names `variable` at 10 m above ground; null when absent. */
export function gribIndexRange(idx: string, variable: 'UGRD' | 'VGRD'): { start: number; end: number | null } | null {
  const lines = idx.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].split(':');
    if (f[3] !== variable || f[4] !== '10 m above ground') continue;
    const start = Number(f[1]);
    if (!Number.isSafeInteger(start) || start < 0) return null;
    const next = lines[i + 1] ? Number(lines[i + 1].split(':')[1]) : NaN;
    return { start, end: Number.isSafeInteger(next) && next > start ? next - 1 : null };
  }
  return null;
}

/** Bilinear u/v at a point (degrees); null outside the grid rows. Longitude wraps across the date line. */
export function sampleWind(f: Pick<WindField, 'ni' | 'nj' | 'la1' | 'lo1' | 'di' | 'dj' | 'u' | 'v'>, lat: number, lon: number): { u: number; v: number } | null {
  const y = (lat - f.la1) / f.dj;
  if (!(y >= 0 && y <= f.nj - 1)) return null;
  let x = (lon - f.lo1) / f.di;
  x = ((x % f.ni) + f.ni) % f.ni;
  const x0 = Math.floor(x);
  const x1 = (x0 + 1) % f.ni;
  const y0 = Math.min(f.nj - 2, Math.floor(y));
  const tx = x - x0;
  const ty = y - y0;
  const at = (arr: Float32Array, xx: number, yy: number) => arr[yy * f.ni + xx];
  const lerp = (arr: Float32Array) =>
    (at(arr, x0, y0) * (1 - tx) + at(arr, x1, y0) * tx) * (1 - ty) + (at(arr, x0, y0 + 1) * (1 - tx) + at(arr, x1, y0 + 1) * tx) * ty;
  return { u: lerp(f.u), v: lerp(f.v) };
}

/** Meteorological direction the wind blows FROM, degrees (0 = from the north). */
export function windFromDeg(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compassPoint(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

/**
 * Speed bands for colouring the wind animation, m/s at 10 m. Lightness rises with speed (viridis-like, so the order
 * survives colour-blindness) and the panel legend names each band; lines also get thicker with speed.
 */
export const WIND_SPEED_BANDS: { below: number; color: string; label: string }[] = [
  { below: 3, color: '#b5c7e8', label: 'under 3 m/s (light)' },
  { below: 8, color: '#5aa9e6', label: '3–8 m/s (gentle to moderate)' },
  { below: 14, color: '#35b779', label: '8–14 m/s (fresh to strong)' },
  { below: 21, color: '#b5de2b', label: '14–21 m/s (near gale to gale)' },
  { below: 28, color: '#fde725', label: '21–28 m/s (strong gale to storm)' },
  { below: Infinity, color: '#ff7f50', label: '28 m/s and over (violent storm, hurricane force)' },
];

/** Index of the band a speed falls in; a speed that is not a number has no band (-1). */
export function windSpeedBand(speedMps: number): number {
  if (!Number.isFinite(speedMps) || speedMps < 0) return -1;
  return WIND_SPEED_BANDS.findIndex((b) => speedMps < b.below);
}
