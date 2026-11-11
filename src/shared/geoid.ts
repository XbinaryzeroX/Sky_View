// Geoid (local mean sea level) heights from the EGM96 grid built by scripts/make-geoid.mjs.
// N = height of mean sea level above the WGS84 ellipsoid: an ellipsoid height = height above sea level + N.
// Needed where the scene is drawn at true ellipsoid heights (Google Photorealistic 3D tiles); the app's own
// globe puts its sea at height 0. Source: EGM96, derived from work by NGA (public domain).

export interface GeoidGrid {
  width: number;
  height: number;
  lon0: number;
  lat0: number;
  /** Grid spacing in degrees (same in both directions). */
  step: number;
  /** Metres per stored unit. */
  scale: number;
  data: Int16Array;
}

const MAGIC = 'AWGEOID1';
const HEADER = 48;

/** Parses an "AWGEOID1" grid (format: scripts/make-geoid.mjs). Throws on anything that is not a complete global grid. */
export function parseGeoid(input: ArrayBuffer | Uint8Array): GeoidGrid {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER) throw new Error('geoid grid is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== MAGIC) throw new Error('not a geoid grid');
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const lon0 = view.getFloat64(16, true);
  const lat0 = view.getFloat64(24, true);
  const step = view.getFloat64(32, true);
  const scale = view.getFloat32(40, true);
  // Every header number must be finite and sane (NaN would slip through the comparisons below).
  const finite = [lon0, lat0, step, scale].every(Number.isFinite);
  if (!finite || !(step > 0) || !(scale > 0) || scale > 1 || Math.abs(lon0) > 360 || width < 2 || height < 2 || width > 10_000 || height > 10_000) throw new Error('geoid grid header is invalid');
  // Global coverage: columns wrap around 360°, rows run from 90° to −90°.
  if (Math.abs(width * step - 360) > 1e-6 || Math.abs(lat0 - 90) > 1e-6 || Math.abs(lat0 - (height - 1) * step + 90) > 1e-6) throw new Error('geoid grid is not global');
  if (bytes.length !== HEADER + width * height * 2) throw new Error('geoid grid has the wrong size');
  const data = new Int16Array(width * height);
  for (let k = 0; k < data.length; k++) data[k] = view.getInt16(HEADER + k * 2, true);
  return { width, height, lon0, lat0, step, scale, data };
}

/** Geoid height N in metres at a position (bilinear; longitude wraps, latitude clamps). */
export function undulation(g: GeoidGrid, lat: number, lon: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0;
  const x = ((((lon - g.lon0) / g.step) % g.width) + g.width) % g.width;
  const y = Math.min(g.height - 1, Math.max(0, (g.lat0 - lat) / g.step));
  const i0 = Math.min(g.width - 1, Math.floor(x));
  const j0 = Math.floor(y);
  const i1 = (i0 + 1) % g.width;
  const j1 = Math.min(g.height - 1, j0 + 1);
  const fx = x - i0;
  const fy = y - j0;
  const v = (i: number, j: number) => g.data[j * g.width + i] * g.scale;
  return (v(i0, j0) * (1 - fx) + v(i1, j0) * fx) * (1 - fy) + (v(i0, j1) * (1 - fx) + v(i1, j1) * fx) * fy;
}
