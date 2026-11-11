// The optional vehicle model pack: real 3D models (Sketchfab, CC0 / CC BY) converted by
// scripts/import-models.mjs into dist/renderer/vehicle-models/. Pure parsing and matching;
// the renderer loads the index (src/renderer/map/modelPack.ts). Vehicles without a matching
// pack model keep the app-built models.

import type { VesselSymbol } from './vehicleClass';

export interface PackModel {
  id: string;
  file: string;
  kind: 'aircraft' | 'ship';
  icao: string[];
  vessel: VesselSymbol | null;
  /** Military paint: used only for military vehicles (and civil models only for civil ones). */
  military: boolean;
  /** Size of the model as stored (metres): length (forward), width (span / beam), height. */
  lengthM: number;
  widthM: number;
  heightM: number;
  title: string;
  author: string;
  license: 'CC0 1.0' | 'CC BY 4.0';
  licenseUrl: string;
  sourceUrl: string;
  tris: number;
}

export interface ModelPack {
  models: PackModel[];
  /** Keyed by `TYPE|mil` or `TYPE|civ`: a type can have one civil and one military model. */
  byIcao: Map<string, PackModel>;
  /** Civil ship models by AIS class. */
  byVessel: Map<VesselSymbol, PackModel>;
  /** Entries dropped by validation. */
  rejected: number;
  /** Why the index as a whole is unusable (wrong version, not a model list, every entry invalid), else null. */
  error: string | null;
}

const icaoKey = (type: string, military: boolean) => `${type}|${military ? 'mil' : 'civ'}`;

const VESSELS: VesselSymbol[] = ['cargo', 'tanker', 'passenger', 'highspeed', 'fishing', 'tug', 'sailing', 'pleasure', 'service', 'military', 'unknown'];
const LICENSE_URL: Record<PackModel['license'], string> = {
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** One index entry, or null when it is invalid. */
function parseEntry(e: unknown): PackModel | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const id = typeof o.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(o.id) ? o.id : null;
  if (!id || o.file !== `${id}.glb`) return null;
  const kind = o.kind === 'aircraft' || o.kind === 'ship' ? o.kind : null;
  const license = o.license === 'CC0 1.0' || o.license === 'CC BY 4.0' ? o.license : null;
  const lengthM = num(o.lengthM, 2, 500);
  const widthM = num(o.widthM, 0.5, 120);
  const heightM = num(o.heightM, 0.3, 120);
  const title = text(o.title, 120);
  const author = text(o.author, 80);
  const source = typeof o.sourceUrl === 'string' && /^https:\/\/sketchfab\.com\/3d-models\/[A-Za-z0-9_-]{1,200}$/.test(o.sourceUrl) ? o.sourceUrl : null;
  if (!kind || !license || !lengthM || !widthM || !heightM || !title || !author || !source) return null;
  const icao = kind === 'aircraft' && Array.isArray(o.icao) ? o.icao.filter((t): t is string => typeof t === 'string' && /^[A-Z0-9]{2,4}$/.test(t)).slice(0, 40) : [];
  const vessel = kind === 'ship' && VESSELS.includes(o.vessel as VesselSymbol) ? (o.vessel as VesselSymbol) : null;
  if (kind === 'aircraft' ? !icao.length : !vessel) return null;
  return { id, file: o.file, kind, icao, vessel, military: o.military === true, lengthM, widthM, heightM, title, author, license, licenseUrl: LICENSE_URL[license], sourceUrl: source, tris: num(o.tris, 0, 5e6) ?? 0 };
}

/**
 * Validates index.json. Invalid entries are dropped and counted (those vehicles keep the built model);
 * an unusable index as a whole sets `error`, so it is reported rather than mistaken for "not installed".
 */
export function parsePackIndex(raw: unknown): ModelPack {
  const out: PackModel[] = [];
  let rejected = 0;
  let error: string | null = null;
  const version = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { version?: unknown }).version : undefined;
  const list = version === 1 ? (raw as { models?: unknown }).models : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) error = 'index.json is not a model index';
  else if (version !== 1) error = `unsupported model index version (${String(version).slice(0, 20)})`;
  else if (!Array.isArray(list)) error = 'index.json has no model list';
  else {
    rejected = Math.max(0, list.length - 200);
    const ids = new Set<string>();
    for (const e of list.slice(0, 200)) {
      const m = parseEntry(e);
      // An id names one model file: a second entry with the same id is rejected (it would share the first one's
      // file, variant and credit while claiming different matches or dimensions).
      if (m && !ids.has(m.id)) {
        ids.add(m.id);
        out.push(m);
      } else rejected++;
    }
    if (!out.length && rejected) error = `all ${rejected} model entries are invalid`;
  }
  const byIcao = new Map<string, PackModel>();
  const byVessel = new Map<VesselSymbol, PackModel>();
  for (const m of out) {
    for (const t of m.icao) if (!byIcao.has(icaoKey(t, m.military))) byIcao.set(icaoKey(t, m.military), m);
    if (m.vessel && !m.military && !byVessel.has(m.vessel)) byVessel.set(m.vessel, m);
  }
  return { models: out, byIcao, byVessel, rejected, error };
}

/** Pack model for an aircraft by its ICAO type with matching paint (military with military, civil with civil), or null. */
export function packForAircraft(pack: ModelPack | null, type: string | null | undefined, military: boolean): PackModel | null {
  if (!pack || !type) return null;
  return pack.byIcao.get(icaoKey(type.trim().toUpperCase(), military)) ?? null;
}

/** Civil pack model for a ship class, or null. Military and unknown ships keep the built model. */
export function packForVessel(pack: ModelPack | null, cls: VesselSymbol): PackModel | null {
  if (!pack || cls === 'military' || cls === 'unknown') return null;
  return pack.byVessel.get(cls) ?? null;
}

/**
 * Instance scale [forward, left, up] taking the stored model to a vehicle of `lengthM` × `widthM`.
 * Width follows the vehicle within ±25 % of the length scale (keeps proportions believable);
 * height uses the geometric mean of the two.
 */
export function packScale(m: PackModel, lengthM: number, widthM: number): [number, number, number] {
  const sx = lengthM / m.lengthM;
  const raw = widthM / m.widthM;
  const sy = Math.min(sx * 1.25, Math.max(sx * 0.75, Number.isFinite(raw) && raw > 0 ? raw : sx));
  return [sx, sy, Math.sqrt(sx * sy)];
}

/** One-line attribution, e.g. for the details panel. */
export function packCredit(m: PackModel): string {
  return `3D model: “${m.title}” by ${m.author} (${m.license}), via Sketchfab`;
}
