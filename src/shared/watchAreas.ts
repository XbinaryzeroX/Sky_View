// One-click watch areas: fly to a strait or sea and switch on the layers that cover air, sea and conflict activity
// there. Nothing here is a data source of its own; each layer keeps its own source, coverage and labels.

import type { LayerId } from './layers';

export interface WatchArea {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Radius the camera frames, in km. */
  radiusKm: number;
  /** What the layers can and cannot show here, said plainly. */
  coverageNote: string;
}

/** Aircraft (all and military-flagged), ships, GPS accuracy anomalies, violence in the news, mapped military sites. */
export const WATCH_LAYERS: LayerId[] = ['aircraft', 'aircraftMil', 'vessels', 'gnss', 'conflicts', 'milSites'];

export const WATCH_AREAS: WatchArea[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lat: 26.45,
    lon: 56.4,
    radiusKm: 260,
    coverageNote: 'Aircraft come from volunteer receivers, which are sparse over Iran and the Gulf, and military aircraft often fly without ADS-B.',
  },
  {
    id: 'bab-el-mandeb',
    name: 'Bab-el-Mandeb and the southern Red Sea',
    lat: 13.2,
    lon: 43.2,
    radiusKm: 320,
    coverageNote: 'Aircraft come from volunteer receivers, which are sparse over Yemen and Eritrea.',
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait',
    lat: 24.3,
    lon: 119.8,
    radiusKm: 280,
    coverageNote: 'Military aircraft often fly without ADS-B.',
  },
  {
    id: 'black-sea',
    name: 'Black Sea',
    lat: 43.6,
    lon: 34.5,
    radiusKm: 650,
    coverageNote: 'Civil air traffic is closed over much of the area, so few aircraft show.',
  },
];

export type RecordTask = 'aircraft' | 'aircraftMil' | 'vessels' | 'gnss' | 'conflicts';
export interface RecordTaskStatus { at: string; ok: boolean; count: number; error: string | null }
/** What the background recording of a watch area is doing, for the panel that controls it. */
export interface AreaRecordingStatus {
  areaId: string | null;
  areaName: string | null;
  startedAt: string | null;
  tasks: Partial<Record<RecordTask, RecordTaskStatus>>;
}

export const WATCH_AREA_IDS = ['hormuz', 'bab-el-mandeb', 'taiwan-strait', 'black-sea'] as const;

/** [west, south, east, north] around the area: the framed radius, so recording covers what the view shows. */
export function watchAreaBox(a: WatchArea): [number, number, number, number] {
  const dLat = a.radiusKm / 111.32;
  const dLon = a.radiusKm / (111.32 * Math.max(0.2, Math.cos((a.lat * Math.PI) / 180)));
  const wrap = (x: number) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
  return [wrap(a.lon - dLon), Math.max(-85, a.lat - dLat), wrap(a.lon + dLon), Math.min(85, a.lat + dLat)];
}

/** Whether a point lies in a [west, south, east, north] box, including boxes that cross the date line. */
export function inBox(b: [number, number, number, number], lat: number, lon: number): boolean {
  if (lat < b[1] || lat > b[3]) return false;
  return b[0] <= b[2] ? lon >= b[0] && lon <= b[2] : lon >= b[0] || lon <= b[2];
}

export function watchArea(id: string): WatchArea | null {
  return WATCH_AREAS.find((a) => a.id === id) ?? null;
}

/** The layers already on plus the watch layers, without duplicates and in a stable order. */
export function withWatchLayers(on: readonly LayerId[]): LayerId[] {
  return [...new Set([...on, ...WATCH_LAYERS])];
}
