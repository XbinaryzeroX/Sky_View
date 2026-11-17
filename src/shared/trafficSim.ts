// Simulated traffic on the traffic-flow layer's road lines: how many dots each road gets and how fast they move.
// No public source gives positions of individual private cars, so this is an illustration built from each road's
// measured (or published) state. Every dot is invented; only the speed, and where published the flow, are measured.
// Roads with an unknown state get no dots, and sources that publish sensor points (no road shape) get none either.
import type { GeoRecord } from './layers';

export interface SimRoad {
  id: string;
  /** [lon, lat] as supplied by the source. Direction of travel is not published, so dots follow the drawn order. */
  coords: [number, number][];
  lengthM: number;
  speedMps: number;
  /** The road's published congestion state (free, slow, heavy, stopped), which colours its dots. */
  state: string;
  /** Simulated vehicles on this road before any thinning. */
  vehicles: number;
  dots: number;
  speedBasis: 'measured' | 'assumed from published state';
  densityBasis: 'from measured flow' | 'assumed for the state';
}

export interface SimPlan {
  roads: SimRoad[];
  vehicles: number;
  dots: number;
  /** Simulated vehicles each dot stands for (1 when every simulated vehicle has its own dot). */
  vehiclesPerDot: number;
}

export const SIM_MAX_DOTS = 12_000;

/** Speeds for sources that publish a state but no speed (Paris), city streets. Assumptions, labelled as such. */
const ASSUMED_KMH: Record<string, number> = { free: 35, slow: 20, heavy: 10, stopped: 3 };
/** Vehicles per km of road (all lanes, one direction) by state, where no flow count is published. Typical values. */
const ASSUMED_PER_KM: Record<string, number> = { free: 20, slow: 35, heavy: 60, stopped: 100 };
/** Upper bound on density from flow / speed, so near-zero speeds do not explode the count. */
const MAX_PER_KM = 150;

const R = 6_371_008.8;
export function lineLengthM(coords: readonly [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dLon = ((((lon2 - lon1) % 360) + 540) % 360) - 180;
    const x = (dLon * Math.PI / 180) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const y = (lat2 - lat1) * Math.PI / 180;
    total += Math.hypot(x, y) * R; // Equirectangular: road segments are short.
  }
  return total;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One road's simulation inputs, or null when the road has no shape or an unknown state. */
export function simRoad(r: GeoRecord): SimRoad | null {
  const state = r.category ?? 'unknown';
  if (!(state in ASSUMED_KMH) || r.geometry?.type !== 'LineString' || r.geometry.coordinates.length < 2) return null;
  const coords = r.geometry.coordinates as [number, number][];
  const lengthM = lineLengthM(coords);
  if (!(lengthM > 5) || lengthM > 50_000) return null;
  const measuredKmh = num(r.props.speedKmh);
  const kmh = measuredKmh !== null && measuredKmh >= 0 ? measuredKmh : ASSUMED_KMH[state];
  const flow = num(r.props.vehiclesPerHour);
  const perKm = flow !== null && flow > 0 ? Math.min(MAX_PER_KM, flow / Math.max(kmh, 3)) : ASSUMED_PER_KM[state];
  const vehicles = Math.max(1, Math.round((perKm * lengthM) / 1000));
  return {
    id: r.id, coords, lengthM, speedMps: kmh / 3.6, state, vehicles, dots: vehicles,
    speedBasis: measuredKmh !== null && measuredKmh >= 0 ? 'measured' : 'assumed from published state',
    densityBasis: flow !== null && flow > 0 ? 'from measured flow' : 'assumed for the state',
  };
}

/** Dot colours by published road state (Okabe–Ito, as the traffic-flow lines), so congestion reads at a glance. */
export const SIM_STATE_COLOR: Record<string, string> = { free: '#56B4E9', slow: '#F0E442', heavy: '#E69F00', stopped: '#D55E00' };

/** Tag for a simulated vehicle. "SIM" so a tag is never mistaken for a tracked or registered vehicle. */
export function simTag(roadIndex: number, dotIndex: number): string {
  return 'SIM-' + String(((roadIndex + 1) * 7919 + dotIndex * 104729) % 10000).padStart(4, '0');
}

/** Roads to animate, thinned evenly when the total would pass `maxDots`. */
export function simPlan(records: readonly GeoRecord[], maxDots = SIM_MAX_DOTS): SimPlan {
  const roads = records.map(simRoad).filter((x): x is SimRoad => x !== null);
  const vehicles = roads.reduce((s, x) => s + x.vehicles, 0);
  const vehiclesPerDot = vehicles > maxDots ? vehicles / maxDots : 1;
  let dots = 0;
  for (const road of roads) {
    road.dots = vehiclesPerDot === 1 ? road.vehicles : Math.max(1, Math.round(road.vehicles / vehiclesPerDot));
    dots += road.dots;
  }
  return { roads, vehicles, dots, vehiclesPerDot };
}

/** Starting offsets (metres along the road): even spacing with a stable jitter, so refreshes do not reshuffle. */
export function initialOffsets(id: string, count: number, lengthM: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const out: number[] = [];
  const gap = lengthM / count;
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    out.push((i + 0.15 + 0.7 * (h / 4294967296)) * gap);
  }
  return out;
}

/** Index of the segment holding distance `s` along a line with cumulative lengths `cum` (cum[0] = 0). */
export function segmentAt(cum: ArrayLike<number>, s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}
