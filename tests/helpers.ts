import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SavedLocation } from '../src/shared/types';

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as T;
}

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'atlas-test-')), 'test.sqlite');
}

export function loc(over: Partial<SavedLocation> = {}): SavedLocation {
  return {
    id: over.id ?? 'loc1',
    name: 'Test',
    category: '',
    notes: '',
    lat: 39.74,
    lon: -104.99,
    radiusKm: 50,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    zones: { status: 'pending', zones: [], checkedAt: null, error: null },
    ...over,
  };
}
