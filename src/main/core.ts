// Application core: owns feed state, polling, backoff, cache, monitoring
// evaluation, and history ingestion. Independent of Electron so it can be
// exercised in automated tests with injected sources and clock.

import { alertRevisions, computeDiff, dedupeQuakes, quakeRevisions, supersededAlertIds } from '../shared/dedupe';
import { evaluateLocations, freshnessOf } from '../shared/monitoring';
import type {
  AppSnapshot,
  Earthquake,
  FeedDiff,
  FeedId,
  FeedStatus,
  Freshness,
  ImportResult,
  LocationEvaluation,
  LocationInput,
  LocationZones,
  QuakeQuery,
  SavedLocation,
  Settings,
  WeatherAlert,
} from '../shared/types';
import { computeBackoffMs, FeedHttpError } from './feeds/http';
import { usgsFeedKey, type AlertSource, type QuakeSource } from './feeds/sources';
import type { AtlasStore } from './store';

interface QuakeCachePayload {
  feedKey: string;
  quakes: Earthquake[];
}

export interface CoreDeps {
  store: AtlasStore;
  alertSource: AlertSource;
  quakeSource: QuakeSource;
  now?: () => Date;
  onChange?: () => void;
  /** Delay between NWS /points lookups (ms). */
  zoneLookupGapMs?: number;
  log?: (msg: string) => void;
}

function emptyStatus(feed: FeedId): FeedStatus {
  return {
    feed,
    state: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    sourceUpdatedAt: null,
    fromCache: false,
    error: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    recordCount: 0,
    skippedRecords: 0,
  };
}

function describeError(e: unknown): string {
  if (e instanceof FeedHttpError) {
    if (e.status === 429) return 'Rate limited by provider (HTTP 429)';
    if (e.kind === 'network') return 'Network unavailable or host unreachable';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

const ZONE_REFRESH_MS = 30 * 86400_000;
const ZONE_ERROR_RETRY_MS = 60 * 60_000;

export class AppCore {
  private readonly store: AtlasStore;
  private readonly alertSource: AlertSource;
  private readonly quakeSource: QuakeSource;
  private readonly now: () => Date;
  private readonly onChange: () => void;
  private readonly zoneGap: number;
  private readonly log: (msg: string) => void;

  settings: Settings;
  locations: SavedLocation[] = [];
  alerts: WeatherAlert[] = [];
  private superseded = new Set<string>();
  private rawQuakes: Earthquake[] = [];
  private quakeFeedKey: string | null = null;
  feeds: Record<FeedId, FeedStatus> = { nws: emptyStatus('nws'), usgs: emptyStatus('usgs') };
  diffs: Partial<Record<FeedId, FeedDiff>> = {};
  evaluations: Record<string, LocationEvaluation> = {};

  private timers: Partial<Record<FeedId, ReturnType<typeof setTimeout>>> = {};
  private inFlight: Partial<Record<FeedId, Promise<void>>> = {};
  private rateLimitedUntil: Partial<Record<FeedId, number>> = {};
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  private zoneQueueRunning = false;
  private running = false;

  constructor(deps: CoreDeps) {
    this.store = deps.store;
    this.alertSource = deps.alertSource;
    this.quakeSource = deps.quakeSource;
    this.now = deps.now ?? (() => new Date());
    this.onChange = deps.onChange ?? (() => {});
    this.zoneGap = deps.zoneLookupGapMs ?? 1100;
    this.log = deps.log ?? (() => {});
    this.settings = this.store.getSettings();
  }

  /** Loads persisted locations and last-known feed data (marked as cached, with original timestamps). */
  init(): void {
    this.locations = this.store.listLocations();
    const nws = this.store.getFeedCache<WeatherAlert[]>('nws');
    if (nws && Array.isArray(nws.payload)) {
      this.alerts = nws.payload;
      this.superseded = supersededAlertIds(this.alerts);
      this.feeds.nws = { ...this.feeds.nws, lastSuccessAt: nws.fetchedAt, sourceUpdatedAt: nws.sourceUpdatedAt, fromCache: true, recordCount: this.alerts.length };
    }
    const usgs = this.store.getFeedCache<QuakeCachePayload>('usgs');
    if (usgs && usgs.payload && Array.isArray(usgs.payload.quakes) && usgs.payload.feedKey === usgsFeedKey(this.quakeQuery())) {
      this.rawQuakes = usgs.payload.quakes;
      this.quakeFeedKey = usgs.payload.feedKey;
      this.feeds.usgs = { ...this.feeds.usgs, lastSuccessAt: usgs.fetchedAt, sourceUpdatedAt: usgs.sourceUpdatedAt, fromCache: true, recordCount: this.rawQuakes.length };
    }
    this.syncZoneStatuses();
    this.reevaluate();
  }

  start(): void {
    this.running = true;
    this.schedule('nws', 0);
    this.schedule('usgs', 0);
    this.freshnessTimer = setInterval(() => this.reevaluate(), 60_000);
    void this.runZoneQueue();
  }

  stop(): void {
    this.running = false;
    for (const t of Object.values(this.timers)) if (t) clearTimeout(t);
    this.timers = {};
    if (this.freshnessTimer) clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
  }

  quakeQuery(): QuakeQuery {
    return { window: this.settings.quakeWindow, minMagnitude: this.settings.quakeMinMagnitude };
  }

  private pollMs(feed: FeedId): number {
    return (feed === 'nws' ? this.settings.nwsPollSeconds : this.settings.usgsPollSeconds) * 1000;
  }

  private schedule(feed: FeedId, delayMs: number): void {
    if (!this.running) return;
    const t = this.timers[feed];
    if (t) clearTimeout(t);
    this.feeds[feed] = { ...this.feeds[feed], nextAttemptAt: new Date(this.now().getTime() + delayMs).toISOString() };
    this.timers[feed] = setTimeout(() => {
      void this.refresh(feed).catch(() => {});
    }, delayMs);
  }

  /** Refreshes a feed. Concurrent calls share one request; rate-limit cool-downs are respected. */
  refresh(feed: FeedId): Promise<void> {
    const existing = this.inFlight[feed];
    if (existing) return existing;
    const until = this.rateLimitedUntil[feed];
    if (until && until > this.now().getTime()) {
      this.feeds[feed] = { ...this.feeds[feed], error: `Rate limited; next attempt after ${new Date(until).toISOString()}` };
      this.emit();
      return Promise.resolve();
    }
    const p = this.doRefresh(feed).finally(() => {
      delete this.inFlight[feed];
    });
    this.inFlight[feed] = p;
    return p;
  }

  private async doRefresh(feed: FeedId): Promise<void> {
    const startedAt = this.now().toISOString();
    this.feeds[feed] = { ...this.feeds[feed], state: 'loading', lastAttemptAt: startedAt };
    this.emit();
    try {
      if (feed === 'nws') await this.fetchAlerts();
      else await this.fetchQuakes();
      const done = this.now().toISOString();
      this.feeds[feed] = { ...this.feeds[feed], state: 'ok', lastSuccessAt: done, fromCache: false, error: null, consecutiveFailures: 0 };
      delete this.rateLimitedUntil[feed];
      this.pruneHistory();
      this.schedule(feed, this.pollMs(feed));
    } catch (e) {
      const failures = this.feeds[feed].consecutiveFailures + 1;
      const retryAfter = e instanceof FeedHttpError ? e.retryAfterSec : null;
      const isRateLimit = e instanceof FeedHttpError && (e.status === 429 || e.status === 503);
      const backoff = computeBackoffMs(failures, isRateLimit ? (retryAfter ?? 60) : retryAfter);
      if (isRateLimit) this.rateLimitedUntil[feed] = this.now().getTime() + backoff;
      // Keep last-known data and its original timestamps; only the status changes.
      this.feeds[feed] = { ...this.feeds[feed], state: 'error', error: describeError(e), consecutiveFailures: failures };
      this.log(`[feeds] ${feed} refresh failed (${failures}): ${describeError(e)}`);
      this.schedule(feed, Math.max(backoff, Math.min(this.pollMs(feed), 30_000)));
    }
    this.reevaluate();
  }

  private async fetchAlerts(): Promise<void> {
    const res = await this.alertSource.fetchActiveAlerts();
    const at = this.now().toISOString();
    const prevAt = this.feeds.nws.lastSuccessAt;
    this.diffs.nws = computeDiff('nws', this.feeds.nws.lastSuccessAt ? alertRevisions(this.alerts) : null, alertRevisions(res.alerts), at, prevAt);
    this.alerts = res.alerts;
    this.superseded = supersededAlertIds(res.alerts);
    this.feeds.nws = { ...this.feeds.nws, sourceUpdatedAt: res.sourceUpdatedAt, recordCount: res.alerts.length, skippedRecords: res.skipped };
    this.store.setFeedCache('nws', { fetchedAt: at, sourceUpdatedAt: res.sourceUpdatedAt, payload: res.alerts });
    this.store.ingestAlerts(res.alerts, at);
  }

  private async fetchQuakes(): Promise<void> {
    const query = this.quakeQuery();
    const res = await this.quakeSource.fetchRecent(query);
    const at = this.now().toISOString();
    const quakes = dedupeQuakes(res.quakes);
    const sameFeed = this.quakeFeedKey === res.feedKey && this.feeds.usgs.lastSuccessAt !== null;
    this.diffs.usgs = computeDiff('usgs', sameFeed ? quakeRevisions(this.rawQuakes) : null, quakeRevisions(quakes), at, sameFeed ? this.feeds.usgs.lastSuccessAt : null);
    this.rawQuakes = quakes;
    this.quakeFeedKey = res.feedKey;
    this.feeds.usgs = { ...this.feeds.usgs, sourceUpdatedAt: res.sourceUpdatedAt, recordCount: quakes.length, skippedRecords: res.skipped };
    this.store.setFeedCache<QuakeCachePayload>('usgs', { fetchedAt: at, sourceUpdatedAt: res.sourceUpdatedAt, payload: { feedKey: res.feedKey, quakes } });
    this.store.ingestQuakes(this.filteredQuakes(), at);
  }

  /** Earthquakes after applying the magnitude filter (the feed may include smaller events). */
  filteredQuakes(): Earthquake[] {
    const min = this.settings.quakeMinMagnitude;
    return this.rawQuakes.filter((q) => (q.mag === null ? min <= 0 : q.mag >= min));
  }

  private pruneHistory(): void {
    try {
      this.store.pruneHistory(this.settings.historyRetentionDays, this.settings.historyMaxRecords, this.now());
    } catch (e) {
      this.log(`[history] prune failed: ${describeError(e)}`);
    }
  }

  freshness(): Record<FeedId, Freshness> {
    const nowMs = this.now().getTime();
    return {
      nws: freshnessOf(this.feeds.nws, this.settings.nwsPollSeconds, nowMs),
      usgs: freshnessOf(this.feeds.usgs, this.settings.usgsPollSeconds, nowMs),
    };
  }

  reevaluate(): void {
    const fr = this.freshness();
    this.evaluations = evaluateLocations({
      locations: this.locations,
      alerts: this.alerts,
      superseded: this.superseded,
      quakes: this.filteredQuakes(),
      nwsFreshness: fr.nws,
      usgsFreshness: fr.usgs,
      now: this.now(),
    });
    this.emit();
  }

  snapshot(): AppSnapshot {
    return {
      locations: this.locations,
      alerts: this.alerts,
      supersededAlertIds: [...this.superseded],
      quakes: this.filteredQuakes(),
      feeds: this.feeds,
      freshness: this.freshness(),
      evaluations: this.evaluations,
      diffs: this.diffs,
      settings: this.settings,
      generatedAt: this.now().toISOString(),
    };
  }

  private emit(): void {
    try {
      this.onChange();
    } catch {
      // listeners must not break the core
    }
  }

  // ---------- locations ----------
  private initialZones(): LocationZones {
    return this.settings.zoneLookupEnabled
      ? { status: 'pending', zones: [], checkedAt: null, error: null }
      : { status: 'disabled', zones: [], checkedAt: null, error: null };
  }

  private afterLocationChange(): void {
    this.locations = this.store.listLocations();
    this.reevaluate();
    void this.runZoneQueue();
  }

  createLocation(input: LocationInput): SavedLocation {
    const loc = this.store.createLocation(input, this.now().toISOString(), this.initialZones());
    this.afterLocationChange();
    return loc;
  }

  updateLocation(id: string, input: LocationInput): SavedLocation {
    const loc = this.store.updateLocation(id, input, this.now().toISOString(), this.initialZones());
    if (!loc) throw new Error('Location not found');
    this.afterLocationChange();
    return loc;
  }

  deleteLocation(id: string): void {
    if (!this.store.deleteLocation(id)) throw new Error('Location not found');
    this.afterLocationChange();
  }

  importLocations(items: { input: LocationInput; action: 'create' | 'update'; targetId: string | null }[]): ImportResult {
    const r = this.store.importLocations(items, this.now().toISOString(), this.initialZones());
    this.afterLocationChange();
    return r;
  }

  // ---------- settings ----------
  updateSettings(patch: Partial<Settings>): Settings {
    const prev = this.settings;
    this.settings = { ...prev, ...patch };
    this.store.saveSettings(this.settings);
    if (prev.zoneLookupEnabled !== this.settings.zoneLookupEnabled) {
      this.syncZoneStatuses();
      this.locations = this.store.listLocations();
      void this.runZoneQueue();
    }
    const quakeChanged = prev.quakeWindow !== this.settings.quakeWindow || prev.quakeMinMagnitude !== this.settings.quakeMinMagnitude;
    if (quakeChanged && usgsFeedKey({ window: prev.quakeWindow, minMagnitude: prev.quakeMinMagnitude }) !== usgsFeedKey(this.quakeQuery())) {
      void this.refresh('usgs').catch(() => {});
    } else if (prev.usgsPollSeconds !== this.settings.usgsPollSeconds && this.feeds.usgs.state !== 'loading') {
      this.schedule('usgs', this.pollMs('usgs'));
    }
    if (prev.nwsPollSeconds !== this.settings.nwsPollSeconds && this.feeds.nws.state !== 'loading') {
      this.schedule('nws', this.pollMs('nws'));
    }
    this.reevaluate();
    return this.settings;
  }

  // ---------- NWS zone lookup ----------
  private syncZoneStatuses(): void {
    for (const loc of this.store.listLocations()) {
      if (!this.settings.zoneLookupEnabled && loc.zones.status === 'pending') {
        this.store.setLocationZones(loc.id, { ...loc.zones, status: 'disabled' });
      } else if (this.settings.zoneLookupEnabled && loc.zones.status === 'disabled') {
        this.store.setLocationZones(loc.id, { ...loc.zones, status: 'pending' });
      }
    }
    this.locations = this.store.listLocations();
  }

  private needsZoneLookup(loc: SavedLocation, nowMs: number): boolean {
    const z = loc.zones;
    if (z.status === 'pending') return true;
    const checked = z.checkedAt ? Date.parse(z.checkedAt) : 0;
    if (z.status === 'error') return nowMs - checked > ZONE_ERROR_RETRY_MS;
    if (z.status === 'resolved' || z.status === 'outside_coverage') return nowMs - checked > ZONE_REFRESH_MS;
    return false;
  }

  /** Resolves NWS zones for saved locations one at a time, spaced to be polite to the API. */
  async runZoneQueue(): Promise<void> {
    if (this.zoneQueueRunning || !this.settings.zoneLookupEnabled) return;
    this.zoneQueueRunning = true;
    try {
      for (;;) {
        if (!this.settings.zoneLookupEnabled) break;
        const nowMs = this.now().getTime();
        const next = this.store.listLocations().find((l) => this.needsZoneLookup(l, nowMs));
        if (!next) break;
        let zones: LocationZones;
        try {
          zones = await this.alertSource.fetchPointZones(next.lat, next.lon, this.now().toISOString());
        } catch (e) {
          zones = { status: 'error', zones: next.zones.zones, checkedAt: this.now().toISOString(), error: describeError(e) };
        }
        // The location may have been moved or deleted while the request was in flight.
        const current = this.store.getLocation(next.id);
        if (current && current.lat === next.lat && current.lon === next.lon) {
          this.store.setLocationZones(next.id, zones);
          this.locations = this.store.listLocations();
          this.reevaluate();
        }
        if (this.zoneGap > 0) await new Promise((r) => setTimeout(r, this.zoneGap));
      }
    } finally {
      this.zoneQueueRunning = false;
    }
  }
}
