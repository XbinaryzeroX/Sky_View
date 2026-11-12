import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LeftPanel, locationSummary } from '../src/renderer/components/LeftPanel';
import { DetailsPanel } from '../src/renderer/components/DetailsPanel';
import { AppCore } from '../src/main/core';
import { AtlasStore } from '../src/main/store';
import { buildBriefing } from '../src/shared/briefing';
import { evaluateLocations, monitoringEvidence } from '../src/shared/monitoring';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import type { AlertSeverity, AppSnapshot, FeedStatus, Freshness, SavedLocation, WeatherAlert, Earthquake } from '../src/shared/types';
import { fixture, loc, tempDbPath } from './helpers';

vi.mock('../src/renderer/lib/api', () => ({ api: { openExternal: vi.fn() }, errorText: String }));
const AT = '2026-11-11T12:00:00.000Z';
const allSeverities = new Set<AlertSeverity>(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const place = loc({ name: 'Monitoring fixture place', zones: { status: 'resolved', zones: ['forecast/COZ040', 'county/COC001', 'fire/COZ040'], checkedAt: AT, error: null } });
const alert = { ...normalizeNwsAlerts(fixture('nws-alerts.json')).alerts[0], expires: '2099-01-01T00:00:00.000Z', ends: null };
const quake = { ...normalizeUsgsFeed(fixture('usgs-week.json')).quakes[0], lat: place.lat, lon: place.lon, time: AT, updated: AT };
function snapshot(options: {
  nws?: Partial<FeedStatus>; usgs?: Partial<FeedStatus>; freshness?: Partial<Record<'nws' | 'usgs', Freshness>>;
  places?: SavedLocation[]; alerts?: WeatherAlert[]; quakes?: Earthquake[]; missingEvaluation?: boolean;
} = {}): AppSnapshot {
  const status = (feed: 'nws' | 'usgs'): FeedStatus => ({ feed, state: 'ok', lastAttemptAt: AT, lastSuccessAt: AT, sourceUpdatedAt: AT, fromCache: false, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: 0, skippedRecords: 0, scope: feed === 'nws' ? 'active-US' : '2.5_week', coverage: { completeness: 'complete', skippedRecords: 0, note: null }, ...options[feed] });
  const locations = options.places ?? [place], alerts = options.alerts ?? [], quakes = options.quakes ?? [], freshness = { nws: 'fresh', usgs: 'fresh', ...options.freshness } as AppSnapshot['freshness'];
  const snap: AppSnapshot = { locations, alerts, quakes, supersededAlertIds: [], settings: DEFAULT_SETTINGS, freshness, feeds: { nws: status('nws'), usgs: status('usgs') }, generatedAt: AT,
    evaluations: {},
    areaWatches: { rules: [], events: [], lastEvaluatedAt: null, error: null }, diffs: {} };
  if (!options.missingEvaluation) snap.evaluations = evaluateLocations({ locations, alerts, quakes, superseded: new Set(), nwsFreshness: freshness.nws,
    nwsObservedAt: snap.feeds.nws.lastSuccessAt, nwsHistorical: !monitoringEvidence(snap, 'nws').current, nwsCoverage: snap.feeds.nws.coverage,
    usgsFreshness: freshness.usgs, now: new Date(AT) });
  return snap;
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const report = (snap: AppSnapshot) => buildBriefing(snap, { locationIds: snap.locations.map(value => value.id), now: new Date(AT), appVersion: 'test', timeZone: 'UTC' }).html;
const summary = (html: string) => html.match(/<h2>Summary<\/h2><table>([\s\S]*?)<\/table>/)?.[1] ?? '';
function left(snap: AppSnapshot, severityFilter = allSeverities) {
  return renderToStaticMarkup(createElement(LeftPanel, { snap, severityFilter, mode: 'places', search: '', selectedLocationId: null,
    layers: { alerts: true, quakes: true, locations: true, radii: false, boundaries: false }, alertsAffectingOnly: false,
    onSeverityFilter: vi.fn(), onLayers: vi.fn(), onAlertsAffectingOnly: vi.fn(), onSelectLocation: vi.fn(), onAdd: vi.fn(), onImport: vi.fn(), onExport: vi.fn(), onSettingsPatch: vi.fn() }));
}
function details(snap: AppSnapshot, overview = false) {
  return renderToStaticMarkup(createElement(DetailsPanel, { snap, selection: overview ? null : { kind: 'location', id: place.id }, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onFocus: vi.fn(), onBriefing: vi.fn() }));
}

describe('saved-location evidence in existing reports and UI', () => {
  it('keeps the optional German warning section out of default saved-place details', () => {
    expect(details(snapshot())).not.toContain('DWD warnings at this point');
  });
  it('preserves a valid fresh complete zero with established zone coverage', () => {
    const snap = snapshot(), html = report(snap);
    expect(summary(html)).toContain('<td>0</td><td>0</td><td>0 (≤ 50 km)</td>');
    expect(html).toContain('No active alerts confirmed for this point.');
    expect(html).toContain('No earthquakes in the selected feed window within 50 km.');
    expect(plain(left(snap))).toContain('No alerts'); expect(plain(left(snap))).toContain('USGS: 0');
    expect(plain(details(snap))).toContain('None in the current feed window');
    expect(plain(details(snap, true))).toContain('No active alerts confirmed at your saved locations.');
  });

  it('never turns an unqueried offline source or absent evaluation into a numeric zero or green no-alert claim', () => {
    for (const snap of [snapshot({ nws: { lastSuccessAt: null }, usgs: { lastSuccessAt: null }, freshness: { nws: 'unavailable', usgs: 'unavailable' } }), snapshot({ missingEvaluation: true })]) {
      const html = report(snap), ui = left(snap), detail = details(snap);
      expect(summary(html)).not.toMatch(/<td>0(?:<| )/);
      expect(summary(html)).toContain('Unknown');
      expect(html).not.toContain('No active alerts confirmed'); expect(html).not.toContain('No earthquakes in the selected');
      expect(plain(ui)).not.toContain('No alerts'); expect(plain(ui)).toContain('Unknown');
      expect(plain(detail)).toContain('Unknown'); expect(plain(detail)).not.toContain('None in the current feed window');
      expect(plain(details(snap, true))).not.toContain('No active alerts confirmed at your saved locations');
    }
  });

  it('rejects wrong-scope observations even when an old positive evaluation is still present', () => {
    const snap = snapshot({ alerts: [alert], quakes: [quake], nws: { scope: null }, usgs: { scope: 'all_day' } });
    const html = report(snap), detail = plain(details(snap));
    expect(summary(html)).toContain('<td>Unknown</td><td>Unknown</td><td>Unknown');
    expect(html).toContain('No compatible reply establishes the selected source scope');
    expect(html).not.toContain('href="https://api.weather.gov/alerts/');
    expect(detail).not.toContain('Known NWS matches:'); expect(detail).not.toContain('Known USGS matches:');
    expect(plain(left(snap))).toContain('NWS alerts ?');
  });

  it('retains known positive matches from partial replies as qualified lower bounds; partial zero remains unknown', () => {
    const partial: Partial<FeedStatus> = { skippedRecords: 2, coverage: { completeness: 'partial', skippedRecords: 2, note: 'Two malformed source records omitted.' } };
    const empty = snapshot({ nws: partial, usgs: partial }), positive = snapshot({ nws: partial, usgs: partial, alerts: [alert], quakes: [quake] });
    expect(summary(report(empty))).not.toMatch(/<td>0(?:<| )/);
    expect(report(empty)).toContain('does not establish that no alerts apply');
    expect(report(empty)).toContain('does not establish that no earthquakes occurred');
    expect(plain(left(empty))).not.toContain('No alerts');
    expect(plain(details(empty, true))).toContain('Active weather alerts Unknown');
    expect(plain(details(empty, true))).not.toContain('(0 with polygons');
    const html = report(positive), detail = plain(details(positive));
    expect(summary(html)).toContain('≥1 in retrieved subset'); expect(html).toContain('Two malformed source records omitted');
    expect(html).toContain(`href="${alert.sourceUrl}"`); expect(html).toContain(`href="${quake.url}"`);
    expect(detail).toContain('Known NWS matches: ≥1 in retrieved subset'); expect(detail).toContain('Known USGS matches: ≥1 in retrieved subset');
  });

  it.each([
    { name: 'cached', source: { fromCache: true }, freshness: 'fresh' as const, clue: 'local cache' },
    { name: 'failed', source: { state: 'error' as const, error: 'Latest network request failed' }, freshness: 'fresh' as const, clue: 'refresh failed' },
    { name: 'stale', source: {}, freshness: 'stale' as const, clue: 'is stale' },
  ])('labels $name zero as last observed, independently from a current other source', ({ source, freshness, clue }) => {
    const snap = snapshot({ usgs: source, freshness: { usgs: freshness } });
    const html = report(snap), detail = plain(details(snap)), ui = plain(left(snap));
    expect(summary(html)).toContain('<td>0</td><td>0</td><td>0 last observed; current unknown');
    expect(html).toContain(clue); expect(html).not.toContain('No earthquakes in the selected');
    expect(detail).toContain('NWS: current'); expect(detail).toContain('USGS: last observed'); expect(detail).toContain(clue);
    expect(detail).not.toContain('None in the current feed window');
    expect(ui).toContain('No alerts'); expect(ui).toContain('USGS: 0 last observed; current unknown');
  });

  it('keeps historical partial positives explicitly historical instead of bounding the current count', () => {
    const source: Partial<FeedStatus> = { fromCache: true, coverage: { completeness: 'partial', skippedRecords: 1, note: 'A malformed record was skipped.' } };
    const snap = snapshot({ nws: source, usgs: source, alerts: [alert], quakes: [quake] });
    expect(summary(report(snap))).toContain('≥1 in last reply; current unknown');
    expect(plain(details(snap))).toContain('partial, last observed');
    expect(plain(left(snap))).toContain('≥1 in last reply; current unknown');
  });

  it('handles proven outside zone-service coverage without erasing supplied positive polygons', () => {
    const outside = { ...place, zones: { status: 'outside_coverage' as const, zones: [], checkedAt: AT, error: null } };
    const empty = snapshot({ places: [outside] }), positive = snapshot({ places: [outside], alerts: [alert] });
    expect(summary(report(empty))).toContain('Unknown'); expect(plain(left(empty))).not.toContain('No alerts');
    expect(plain(details(empty))).toContain('Outside NWS zone-service coverage');
    expect(report(positive)).toContain(`href="${alert.sourceUrl}"`);
    expect(plain(details(positive))).toContain('Known NWS matches: ≥1 in retrieved subset');
    expect(plain(left(positive))).toContain('NWS alerts: ≥1 in retrieved subset');
  });

  it('does not turn hidden known matches into No alerts when a severity filter excludes them', () => {
    const snap = snapshot({ alerts: [alert] }), selected = new Set<AlertSeverity>(['Minor']);
    const sum = locationSummary(snap, place, selected, new Map(snap.alerts.map(value => [value.id, value])));
    expect(sum.hidden).toBe(1); expect(sum.inside).toBe(0);
    const ui = plain(left(snap, selected));
    expect(ui).toContain('Alerts hidden'); expect(ui).toContain('matches hidden by severity filter'); expect(ui).not.toContain('No alerts');
  });

  it('uses actual AppCore cached provenance after an alert expires and never invents an old zero', async () => {
    const path = tempDbPath();
    let clock = AT;
    const observation = { ...alert, sent: AT, effective: AT, expires: '2026-11-11T12:05:00.000Z' };
    const deps = { now: () => new Date(clock), alertSource: { name: 'explicit lifecycle fixture', fetchActiveAlerts: async () => ({ alerts: [observation], skipped: 0, sourceUpdatedAt: AT }), fetchPointZones: async () => place.zones },
      quakeSource: { name: 'unused fixture', fetchRecent: async () => ({ quakes: [], skipped: 0, sourceUpdatedAt: AT, feedKey: '2.5_week' }) } };
    const firstStore = new AtlasStore(path);
    firstStore.saveSettings({ ...firstStore.getSettings(), zoneLookupEnabled: false });
    firstStore.createLocation({ name: place.name, category: '', notes: '', lat: place.lat, lon: place.lon, radiusKm: place.radiusKm }, AT, place.zones);
    const first = new AppCore({ ...deps, store: firstStore });
    first.init();
    try {
      await first.refresh('nws');
      const current = first.snapshot(), ev = current.evaluations[current.locations[0].id];
      expect(ev).toMatchObject({ nwsObservedAt: AT, nwsLifecycleAt: AT, nwsHistorical: false });
      expect(summary(report(current))).toContain('<td>1</td>');
      const drifted = { ...current, feeds: { ...current.feeds, nws: { ...current.feeds.nws, fromCache: true } } };
      expect(summary(report(drifted))).toContain('Unknown');
      expect(report(drifted)).toContain('awaits recomputation');
    } finally { first.stop(); firstStore.close(); }
    clock = '2026-11-11T12:11:00.000Z';
    const cachedStore = new AtlasStore(path), cached = new AppCore({ ...deps, store: cachedStore });
    cached.init();
    try {
      const snap = cached.snapshot(), ev = snap.evaluations[snap.locations[0].id];
      expect(ev).toMatchObject({ nwsObservedAt: AT, nwsLifecycleAt: AT, nwsHistorical: true });
      expect(ev.alertsInside).toHaveLength(1);
      expect(summary(report(snap))).toContain('1 last observed; current unknown');
      expect(plain(left(snap))).toContain('NWS alerts: 1 last observed; current unknown');
      expect(plain(details(snap, true))).toContain('Active weather alerts 1 last observed; current unknown (1 with polygons, 0 without polygons)');
    } finally { cached.stop(); cachedStore.close(); }
  });
});
