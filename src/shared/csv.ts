// CSV import/export for saved locations: column mapping, validation,
// duplicate detection, and formula-injection-safe export.

import Papa from 'papaparse';
import { geodesicDistanceKm } from './geo';
import type { DuplicateMode, LocationInput, SavedLocation } from './types';

export const LOCATION_FIELDS = ['name', 'latitude', 'longitude', 'category', 'notes', 'radius_km'] as const;
export type LocationField = (typeof LOCATION_FIELDS)[number];
export type ColumnMapping = Partial<Record<LocationField, string>>;

export const DEFAULT_RADIUS_KM = 50;
export const MAX_RADIUS_KM = 2000;
export const MAX_IMPORT_ROWS = 5000;
/** Two locations closer than this (and with the same name, case-insensitive) are duplicates. */
export const DUPLICATE_DISTANCE_M = 25;

const ALIASES: Record<LocationField, string[]> = {
  name: ['name', 'location', 'location name', 'site', 'property', 'title', 'label'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
  category: ['category', 'type', 'group', 'kind'],
  notes: ['notes', 'note', 'description', 'comments', 'comment'],
  radius_km: ['radius_km', 'radius', 'radius (km)', 'monitoring radius', 'monitoring_radius_km', 'radiuskm'],
};

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
  truncated: boolean;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '');
  const res = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const headers = (res.meta.fields ?? []).filter((h) => h.length > 0);
  const errors = res.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`);
  const truncated = res.data.length > MAX_IMPORT_ROWS;
  return { headers, rows: res.data.slice(0, MAX_IMPORT_ROWS), errors, truncated };
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const field of LOCATION_FIELDS) {
    const idx = lower.findIndex((h) => ALIASES[field].includes(h));
    if (idx >= 0) mapping[field] = headers[idx];
  }
  return mapping;
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate-existing' | 'duplicate-in-file';

export interface PreviewRow {
  rowNumber: number; // 1-based data row number (header = row 1, so first data row = 2)
  input: LocationInput | null;
  errors: string[];
  status: RowStatus;
  duplicateOfId: string | null;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (!s) return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function isDuplicateLocation(a: { name: string; lat: number; lon: number }, b: { name: string; lat: number; lon: number }): boolean {
  if (a.name.trim().toLowerCase() !== b.name.trim().toLowerCase()) return false;
  return geodesicDistanceKm(a.lat, a.lon, b.lat, b.lon) * 1000 <= DUPLICATE_DISTANCE_M;
}

/** Validates a single location input. Returns a list of human-readable errors. */
export function validateLocationInput(i: Partial<LocationInput>): string[] {
  const errors: string[] = [];
  if (!i.name || !i.name.trim()) errors.push('Name is required.');
  else if (i.name.length > 120) errors.push('Name must be 120 characters or fewer.');
  if (typeof i.lat !== 'number' || Number.isNaN(i.lat)) errors.push('Latitude is required and must be a number.');
  else if (i.lat < -90 || i.lat > 90) errors.push('Latitude must be between -90 and 90.');
  if (typeof i.lon !== 'number' || Number.isNaN(i.lon)) errors.push('Longitude is required and must be a number.');
  else if (i.lon < -180 || i.lon > 180) errors.push('Longitude must be between -180 and 180.');
  if (typeof i.radiusKm !== 'number' || Number.isNaN(i.radiusKm)) errors.push('Radius must be a number.');
  else if (i.radiusKm <= 0 || i.radiusKm > MAX_RADIUS_KM) errors.push(`Radius must be greater than 0 and at most ${MAX_RADIUS_KM} km.`);
  if (i.category && i.category.length > 60) errors.push('Category must be 60 characters or fewer.');
  if (i.notes && i.notes.length > 2000) errors.push('Notes must be 2000 characters or fewer.');
  return errors;
}

export function buildPreview(parsed: ParsedCsv, mapping: ColumnMapping, existing: SavedLocation[]): PreviewRow[] {
  const out: PreviewRow[] = [];
  const accepted: { name: string; lat: number; lon: number }[] = [];
  parsed.rows.forEach((row, i) => {
    const get = (f: LocationField) => (mapping[f] ? (row[mapping[f]!] ?? '') : '');
    const errors: string[] = [];
    if (!mapping.name) errors.push('No column mapped to name.');
    if (!mapping.latitude) errors.push('No column mapped to latitude.');
    if (!mapping.longitude) errors.push('No column mapped to longitude.');
    const lat = parseNumber(get('latitude'));
    const lon = parseNumber(get('longitude'));
    const radiusRaw = parseNumber(get('radius_km'));
    const input: LocationInput = {
      name: get('name').trim(),
      lat: lat ?? NaN,
      lon: lon ?? NaN,
      category: get('category').trim(),
      notes: get('notes').trim(),
      radiusKm: radiusRaw === null ? DEFAULT_RADIUS_KM : radiusRaw,
    };
    if (errors.length === 0) errors.push(...validateLocationInput(input));
    if (errors.length) {
      out.push({ rowNumber: i + 2, input: null, errors, status: 'invalid', duplicateOfId: null });
      return;
    }
    const dupExisting = existing.find((e) => isDuplicateLocation(e, input));
    if (dupExisting) {
      out.push({ rowNumber: i + 2, input, errors: [], status: 'duplicate-existing', duplicateOfId: dupExisting.id });
      return;
    }
    if (accepted.some((a) => isDuplicateLocation(a, input))) {
      out.push({ rowNumber: i + 2, input, errors: [], status: 'duplicate-in-file', duplicateOfId: null });
      return;
    }
    accepted.push(input);
    out.push({ rowNumber: i + 2, input, errors: [], status: 'valid', duplicateOfId: null });
  });
  return out;
}

export interface ImportPlanItem {
  input: LocationInput;
  action: 'create' | 'update';
  targetId: string | null;
}

/** Decides what to do with each previewed row given the chosen duplicate mode. */
export function planImport(preview: PreviewRow[], mode: DuplicateMode): { items: ImportPlanItem[]; skipped: number } {
  const items: ImportPlanItem[] = [];
  let skipped = 0;
  for (const row of preview) {
    if (!row.input || row.status === 'invalid') {
      skipped++;
      continue;
    }
    if (row.status === 'valid') {
      items.push({ input: row.input, action: 'create', targetId: null });
    } else if (row.status === 'duplicate-existing') {
      if (mode === 'skip') skipped++;
      else if (mode === 'update') items.push({ input: row.input, action: 'update', targetId: row.duplicateOfId });
      else items.push({ input: row.input, action: 'create', targetId: null });
    } else if (row.status === 'duplicate-in-file') {
      if (mode === 'keep') items.push({ input: row.input, action: 'create', targetId: null });
      else skipped++;
    }
  }
  return { items, skipped };
}

/** Neutralizes spreadsheet formula injection for text cells. */
export function safeCsvText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function locationsToCsv(locations: SavedLocation[]): string {
  const rows = locations.map((l) => ({
    name: safeCsvText(l.name),
    latitude: l.lat.toFixed(6),
    longitude: l.lon.toFixed(6),
    category: safeCsvText(l.category),
    notes: safeCsvText(l.notes),
    radius_km: String(l.radiusKm),
  }));
  return Papa.unparse({ fields: [...LOCATION_FIELDS], data: rows.map((r) => LOCATION_FIELDS.map((f) => r[f])) }, { newline: '\r\n' });
}
