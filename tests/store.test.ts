import { describe, expect, it } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import type { LocationZones } from '../src/shared/types';
import { fixture, tempDbPath } from './helpers';

const pending: LocationZones = { status: 'pending', zones: [], checkedAt: null, error: null };
const input = { name: 'Denver Office', category: 'Office', notes: 'n', lat: 39.7392, lon: -104.9903, radiusKm: 75 };

describe('persistence', () => {
  it('keeps locations and settings across restarts', () => {
    const path = tempDbPath();
    const s1 = new AtlasStore(path);
    const a = s1.createLocation(input, '2026-11-09T00:00:00.000Z', pending);
    s1.saveSettings({ ...DEFAULT_SETTINGS, quakeWindow: 'day', nwsContact: 'example.com' });
    s1.close();

    const s2 = new AtlasStore(path);
    const locs = s2.listLocations();
    expect(locs).toHaveLength(1);
    expect(locs[0]).toMatchObject({ id: a.id, name: 'Denver Office', lat: 39.7392, radiusKm: 75 });
    expect(s2.getSettings()).toMatchObject({ quakeWindow: 'day', nwsContact: 'example.com', nwsPollSeconds: DEFAULT_SETTINGS.nwsPollSeconds });
    s2.close();
  });

  it('updates, resets zones when moved, and deletes locations', () => {
    const s = new AtlasStore(tempDbPath());
    const a = s.createLocation(input, 't0', pending);
    s.setLocationZones(a.id, { status: 'resolved', zones: ['forecast/COZ039'], checkedAt: 't1', error: null });
    const renamed = s.updateLocation(a.id, { ...input, name: 'Renamed' }, 't2', pending)!;
    expect(renamed.zones.status).toBe('resolved'); // not moved: keeps zones
    const moved = s.updateLocation(a.id, { ...input, lat: 40 }, 't3', pending)!;
    expect(moved.zones.status).toBe('pending'); // moved: re-lookup
    expect(moved.createdAt).toBe('t0');
    expect(s.deleteLocation(a.id)).toBe(true);
    expect(s.deleteLocation(a.id)).toBe(false);
    expect(s.listLocations()).toHaveLength(0);
  });

  it('imports locations transactionally', () => {
    const s = new AtlasStore(tempDbPath());
    const a = s.createLocation(input, 't0', pending);
    const r = s.importLocations(
      [
        { input: { ...input, notes: 'updated' }, action: 'update', targetId: a.id },
        { input: { ...input, name: 'New' }, action: 'create', targetId: null },
        { input, action: 'update', targetId: 'missing' },
      ],
      't1',
      pending,
    );
    expect(r).toEqual({ created: 1, updated: 1, skipped: 1 });
    expect(s.getLocation(a.id)?.notes).toBe('updated');
  });

  it('stores feed cache with original timestamps', () => {
    const path = tempDbPath();
    const s = new AtlasStore(path);
    s.setFeedCache('nws', { fetchedAt: '2026-11-09T01:02:03.000Z', sourceUpdatedAt: '2026-11-09T01:00:00.000Z', payload: [1, 2, 3] });
    s.close();
    const s2 = new AtlasStore(path);
    expect(s2.getFeedCache('nws')).toEqual({ fetchedAt: '2026-11-09T01:02:03.000Z', sourceUpdatedAt: '2026-11-09T01:00:00.000Z', payload: [1, 2, 3] });
  });
});

describe('event history', () => {
  it('records first observed and last observed, and updates in place', () => {
    const s = new AtlasStore(tempDbPath());
    const { alerts } = normalizeNwsAlerts(fixture('nws-alerts.json'));
    s.ingestAlerts(alerts, '2026-11-09T10:00:00.000Z');
    s.ingestAlerts(alerts, '2026-11-09T10:03:00.000Z');
    const r = s.getHistory('alert:urn:oid:fixture.poly.1')!;
    expect(r.firstObservedAt).toBe('2026-11-09T10:00:00.000Z');
    expect(r.lastObservedAt).toBe('2026-11-09T10:03:00.000Z');
    expect(s.queryHistory({ kind: 'all', includeSuperseded: true }).storedTotal).toBe(alerts.length);
  });

  it('marks superseded alert revisions and hides them by default', () => {
    const s = new AtlasStore(tempDbPath());
    const { alerts } = normalizeNwsAlerts(fixture('nws-alerts.json'));
    s.ingestAlerts(alerts, 't');
    expect(s.getHistory('alert:urn:oid:fixture.zone.0')!.supersededBy).toBe('urn:oid:fixture.zone.1');
    const visible = s.queryHistory({ kind: 'alert' }).records.map((r) => r.sourceId);
    expect(visible).not.toContain('urn:oid:fixture.zone.0');
    expect(s.queryHistory({ kind: 'alert', includeSuperseded: true }).records.map((r) => r.sourceId)).toContain('urn:oid:fixture.zone.0');
  });

  it('merges earthquake records that share an associated id', () => {
    const s = new AtlasStore(tempDbPath());
    const { quakes } = normalizeUsgsFeed(fixture('usgs-week.json'));
    const ci = quakes.find((q) => q.id === 'ci40000001')!;
    const us = quakes.find((q) => q.id === 'us7000aaaa')!;
    s.ingestQuakes([{ ...ci, ids: ['ci40000001'] }], '2026-11-09T09:00:00.000Z');
    s.ingestQuakes([us], '2026-11-09T09:05:00.000Z');
    const page = s.queryHistory({ kind: 'quake' });
    expect(page.records.map((r) => r.sourceId)).toEqual(['us7000aaaa']);
    expect(page.records[0].firstObservedAt).toBe('2026-11-09T09:00:00.000Z');
  });

  it('searches and filters', () => {
    const s = new AtlasStore(tempDbPath());
    s.ingestAlerts(normalizeNwsAlerts(fixture('nws-alerts.json')).alerts, 't');
    s.ingestQuakes(normalizeUsgsFeed(fixture('usgs-week.json')).quakes, 't');
    expect(s.queryHistory({ text: 'thunderstorm' }).records).toHaveLength(1);
    expect(s.queryHistory({ text: '100%_' }).records).toHaveLength(0); // LIKE wildcards escaped
    expect(s.queryHistory({ severity: 'Moderate' }).records.map((r) => r.sourceId)).toEqual(['urn:oid:fixture.zone.1']);
    expect(s.queryHistory({ kind: 'quake', minMagnitude: 5 }).records.map((r) => r.sourceId)).toEqual(['ak0000002']);
  });

  it('applies retention by age and by record count, and clears', () => {
    const s = new AtlasStore(tempDbPath());
    const { alerts } = normalizeNwsAlerts(fixture('nws-alerts.json'));
    s.ingestAlerts(alerts.slice(0, 2), '2026-10-01T00:00:00.000Z');
    s.ingestAlerts(alerts.slice(2), '2026-11-09T00:00:00.000Z');
    const removed = s.pruneHistory(30, 1000, new Date('2026-11-09T12:00:00Z'));
    expect(removed).toBe(2);
    expect(s.queryHistory({ includeSuperseded: true }).storedTotal).toBe(alerts.length - 2);
    s.pruneHistory(30, 1, new Date('2026-11-09T12:00:00Z'));
    expect(s.queryHistory({ includeSuperseded: true }).storedTotal).toBe(1);
    expect(s.clearHistory()).toBe(1);
    expect(s.queryHistory({}).storedTotal).toBe(0);
  });
});
