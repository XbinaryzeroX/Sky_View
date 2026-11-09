import { describe, expect, it } from 'vitest';
import { AppCore } from '../src/main/core';
import { FeedHttpError } from '../src/main/feeds/http';
import type { AlertSource, QuakeSource } from '../src/main/feeds/sources';
import { AtlasStore } from '../src/main/store';
import { normalizeNwsAlerts, normalizeUsgsFeed } from '../src/shared/normalize';
import type { LocationZones } from '../src/shared/types';
import { fixture, tempDbPath } from './helpers';

class Clock {
  t = Date.parse('2026-11-09T12:00:00Z');
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

function sources(state: { failAlerts?: Error | null; failQuakes?: Error | null; zones?: LocationZones }) {
  const alertSource: AlertSource = {
    name: 'fixture',
    fetchActiveAlerts: async () => {
      if (state.failAlerts) throw state.failAlerts;
      return normalizeNwsAlerts(fixture('nws-alerts.json'));
    },
    fetchPointZones: async (_lat, _lon, now) => state.zones ?? { status: 'resolved', zones: ['forecast/OKZ060'], checkedAt: now, error: null },
  };
  const quakeSource: QuakeSource = {
    name: 'fixture',
    fetchRecent: async (q) => {
      if (state.failQuakes) throw state.failQuakes;
      return { ...normalizeUsgsFeed(fixture('usgs-week.json')), feedKey: `2.5_${q.window}` };
    },
  };
  return { alertSource, quakeSource };
}

describe('feed failures and cached data', () => {
  it('keeps last-known data with its original retrieval time when a refresh fails', async () => {
    const clock = new Clock();
    const st: { failAlerts: Error | null } = { failAlerts: null };
    const core = new AppCore({ store: new AtlasStore(tempDbPath()), ...sources(st), now: clock.now, zoneLookupGapMs: 0 });
    core.init();
    await core.refresh('nws');
    const firstSuccess = core.feeds.nws.lastSuccessAt;
    expect(core.feeds.nws.state).toBe('ok');
    expect(core.alerts.length).toBe(4);

    clock.advance(5 * 60_000);
    st.failAlerts = new FeedHttpError('Network error: offline', null, null, 'network');
    await core.refresh('nws');
    expect(core.feeds.nws.state).toBe('error');
    expect(core.feeds.nws.error).toMatch(/Network unavailable/);
    expect(core.feeds.nws.consecutiveFailures).toBe(1);
    expect(core.feeds.nws.lastSuccessAt).toBe(firstSuccess);
    expect(core.alerts.length).toBe(4);
    expect(core.freshness().nws).toBe('fresh');

    clock.advance(20 * 60_000);
    core.reevaluate();
    expect(core.freshness().nws).toBe('stale');
    expect(core.snapshot().alerts.length).toBe(4);
  });

  it('loads cached data on startup marked as cached with the original timestamp', async () => {
    const path = tempDbPath();
    const clock = new Clock();
    const core1 = new AppCore({ store: new AtlasStore(path), ...sources({}), now: clock.now, zoneLookupGapMs: 0 });
    core1.init();
    await core1.refresh('nws');
    await core1.refresh('usgs');
    const fetchedAt = core1.feeds.nws.lastSuccessAt;

    clock.advance(2 * 3600_000);
    const offline = sources({ failAlerts: new FeedHttpError('x', null, null, 'network'), failQuakes: new FeedHttpError('x', null, null, 'network') });
    const core2 = new AppCore({ store: new AtlasStore(path), ...offline, now: clock.now, zoneLookupGapMs: 0 });
    core2.init();
    expect(core2.feeds.nws.fromCache).toBe(true);
    expect(core2.feeds.nws.lastSuccessAt).toBe(fetchedAt);
    expect(core2.alerts.length).toBe(4);
    expect(core2.freshness().nws).toBe('stale');
    await core2.refresh('nws');
    expect(core2.feeds.nws.fromCache).toBe(true); // still cached; failure must not look like a fresh fetch
    expect(core2.feeds.nws.lastSuccessAt).toBe(fetchedAt);
    expect(core2.snapshot().quakes.length).toBeGreaterThan(0);
  });

  it('reports unavailable (not empty) when there is no data at all', async () => {
    const core = new AppCore({ store: new AtlasStore(tempDbPath()), ...sources({ failAlerts: new Error('boom') }), now: new Clock().now, zoneLookupGapMs: 0 });
    core.init();
    core.createLocation({ name: 'A', category: '', notes: '', lat: 39.74, lon: -104.99, radiusKm: 10 });
    await core.refresh('nws');
    const snap = core.snapshot();
    expect(snap.freshness.nws).toBe('unavailable');
    const ev = Object.values(snap.evaluations)[0];
    expect(ev.nwsFreshness).toBe('unavailable');
    expect(ev.alertsInside).toHaveLength(0);
  });

  it('respects provider rate limiting', async () => {
    const clock = new Clock();
    let calls = 0;
    const src = sources({});
    src.alertSource.fetchActiveAlerts = async () => {
      calls++;
      throw new FeedHttpError('HTTP 429', 429, 30, 'http');
    };
    const core = new AppCore({ store: new AtlasStore(tempDbPath()), ...src, now: clock.now, zoneLookupGapMs: 0 });
    core.init();
    await core.refresh('nws');
    await core.refresh('nws'); // within cool-down: no request
    expect(calls).toBe(1);
    expect(core.feeds.nws.error).toMatch(/Rate limited/);
    clock.advance(31_000);
    await core.refresh('nws');
    expect(calls).toBe(2);
  });
});

describe('location monitoring end to end', () => {
  it('resolves NWS zones, then confirms zone-based alerts for the location', async () => {
    const clock = new Clock();
    const core = new AppCore({ store: new AtlasStore(tempDbPath()), ...sources({}), now: clock.now, zoneLookupGapMs: 0 });
    core.init();
    await core.refresh('nws');
    const tulsa = core.createLocation({ name: 'Tulsa', category: '', notes: '', lat: 36.15, lon: -95.99, radiusKm: 50 });
    // Before zone lookup: the zone-based alert is undeterminable, not "outside"
    expect(core.evaluations[tulsa.id].alertsUnknown.length).toBeGreaterThan(0);
    await core.runZoneQueue();
    const ev = core.evaluations[tulsa.id];
    expect(ev.alertsInside.map((m) => m.alertId)).toEqual(['urn:oid:fixture.zone.1']);
    expect(ev.alertsUnknown).toHaveLength(0);
  });

  it('applies the magnitude filter and per-location radius', async () => {
    const core = new AppCore({ store: new AtlasStore(tempDbPath()), ...sources({}), now: new Clock().now, zoneLookupGapMs: 0 });
    core.init();
    const sf = core.createLocation({ name: 'SF', category: '', notes: '', lat: 37.7749, lon: -122.4194, radiusKm: 20 });
    await core.refresh('usgs');
    expect(core.evaluations[sf.id].quakesNearby.map((q) => q.quakeId)).toEqual(['us7000aaaa']); // deduped
    core.updateSettings({ quakeMinMagnitude: 4.5 });
    expect(core.evaluations[sf.id].quakesNearby).toHaveLength(0);
  });
});
