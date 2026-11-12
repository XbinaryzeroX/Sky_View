import type { MultiPolygon, Polygon } from 'geojson';
import type { AlertSeverity } from './types';

export const DWD_CAP_LIMITS = Object.freeze({
  compressedBytes: 2 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024,
  entryBytes: 4 * 1024 * 1024, entries: 2000, areas: 20_000,
  coordinates: 200_000, ringCoordinates: 10_000, xmlDepth: 24,
  xmlNodes: 500_000, textCharacters: 128 * 1024, references: 20_000,
});

/** A message cannot begin before either its effective time or hazard onset. */
export function dwdStartMs(onset: string | null, effective: string | null): number {
  const times = [onset, effective].filter((t): t is string => t !== null).map(Date.parse).filter(Number.isFinite);
  return times.length ? Math.max(...times) : Number.NaN;
}

export interface DwdReference { id: string; identifier: string; sender: string; sent: string }
export interface DwdArea {
  description: string;
  geometry: Polygon | MultiPolygon | null;
  geocodes: { name: string; value: string }[];
  altitudeM: number | null;
  ceilingM: number | null;
}
export interface DwdWarning {
  /** Stable publisher-qualified hash of sender, original CAP identifier and sent time. */
  id: string;
  capIdentifier: string;
  sender: string;
  sent: string;
  status: 'Actual';
  scope: 'Public';
  messageType: 'Alert' | 'Update';
  references: DwdReference[];
  language: 'de-DE' | 'de';
  event: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  severity: AlertSeverity;
  urgency: string;
  certainty: string;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  responseTypes: string[];
  timing: 'active' | 'upcoming' | 'unknown';
  /** Short area-name summary; all original names remain in areas[].description. */
  areaDesc: string;
  areas: DwdArea[];
  geometry: Polygon | MultiPolygon | null;
  geometryStatus: 'complete' | 'partial' | 'unavailable';
  missingAreaCount: number;
  invalidGeometryCount: number;
  geometryNotes: string[];
  source: 'Deutscher Wetterdienst';
  sourceUrl: string;
  license: 'CC BY 4.0';
  country: 'DE';
}

export interface DwdStatusContext {
  observedAt: string;
  /** Publisher HTTP Last-Modified, if available; never guessed from the newest CAP message. */
  sourceUpdatedAt?: string | null;
}
export interface DwdStatusResult {
  warnings: DwdWarning[];
  observedAt: string;
  sourceUpdatedAt: string | null;
  completeness: 'complete' | 'partial';
  totalEntries: number;
  parsedMessages: number;
  skipped: number;
  filtered: { notActual: number; notPublic: number; notGerman: number; expired: number; cancel: number; allClear: number; superseded: number; duplicates: number };
  unlocatedWarnings: number;
  partialGeometryWarnings: number;
  notes: string[];
}
