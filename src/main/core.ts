// Application core: owns feed state, polling, backoff, cache, monitoring
// evaluation, and history ingestion. Independent of Electron so it can be
// exercised in automated tests with injected sources and clock.

import { alertRevisions, computeDiff, dedupeQuakes, quakeRevisions, supersededAlertIds } from '../shared/dedupe';
import { evaluateLocations, freshnessOf, readFeedCoverage, replyFeedCoverage, staleAfterMs } from '../shared/monitoring';
import type {
  AppSnapshot,
  Earthquake,
  FeedCoverage,
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
import { deadlineAfter, timerDelayUntil } from './feeds/timing';
import { usgsFeedKey, type AlertSource, type QuakeSource } from './feeds/sources';
import type { AtlasStore } from './store';
import { AreaWatchService } from './areaWatches';
import type { AreaWatchRuleInput } from '../shared/areaWatch';
import type { AnnotationDocument } from '../shared/geojsonAnnotations';
import type { AppliedScene, RestoredView, Scene } from '../shared/ipc';
import type { VisitBriefing } from '../shared/visitBriefing';

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
    coverage: readFeedCoverage(null),
    scope: null,
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

function refreshComparisonLimit(previous: FeedStatus, current: FeedCoverage, scope: string, at: string): string | undefined {
  if (current.completeness !== 'complete') return 'The latest reply was partial or its completeness was unknown.';
  if (!previous.lastSuccessAt) return;
  if (previous.scope !== scope) return 'The two replies cover different source queries.';
  if (freshnessOf(previous, 60, Date.parse(at)) === 'unavailable') return 'The earlier observation time is unavailable or outside the comparison period.';
  if (previous.coverage?.completeness !== 'complete') return 'The earlier reply was partial or its completeness was unknown.';
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
  private readonly areaWatchService: AreaWatchService;

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
    this.areaWatchService = new AreaWatchService(this.store);
  }

  /** Loads persisted locations and last-known feed data (marked as cached, with original timestamps). */
  init(): void {
    this.store.beginVisit(this.now().toISOString());
    this.locations = this.store.listLocations();
    const nws = this.store.getFeedCache<WeatherAlert[]>('nws');
    if (nws && Array.isArray(nws.payload)) {
      this.alerts = nws.payload;
      this.superseded = supersededAlertIds(this.alerts);
      const coverage = readFeedCoverage(nws.coverage);
      this.feeds.nws = { ...this.feeds.nws, lastSuccessAt: nws.fetchedAt, sourceUpdatedAt: nws.sourceUpdatedAt, fromCache: true, recordCount: this.alerts.length, coverage, skippedRecords: coverage.skippedRecords ?? 0, scope: 'active-US' };
    }
    const usgs = this.store.getFeedCache<QuakeCachePayload>('usgs');
    if (usgs && usgs.payload && Array.isArray(usgs.payload.quakes) && usgs.payload.feedKey === usgsFeedKey(this.quakeQuery())) {
      this.rawQuakes = usgs.payload.quakes;
      this.quakeFeedKey = usgs.payload.feedKey;
      const coverage = readFeedCoverage(usgs.coverage);
      this.feeds.usgs = { ...this.feeds.usgs, lastSuccessAt: usgs.fetchedAt, sourceUpdatedAt: usgs.sourceUpdatedAt, fromCache: true, recordCount: this.rawQuakes.length, coverage, skippedRecords: coverage.skippedRecords ?? 0, scope: usgs.payload.feedKey };
    } else if (usgs) {
      this.feeds.usgs = { ...this.feeds.usgs, error: 'The saved USGS reply does not establish the selected query; awaiting a compatible successful reply.', scope: typeof usgs.payload?.feedKey === 'string' ? usgs.payload.feedKey : null };
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
    const deadline = Math.max(deadlineAfter(this.now().getTime(), delayMs), this.rateLimitedUntil[feed] ?? 0);
    this.feeds[feed] = { ...this.feeds[feed], nextAttemptAt: new Date(deadline).toISOString() };
    const due = () => {
      if (!this.running) return;
      // Node turns overflowing delays into 1 ms. Re-arm a bounded hop until the true deadline.
      if (this.now().getTime() < deadline) {
        this.timers[feed] = setTimeout(due, timerDelayUntil(deadline, this.now().getTime()));
        return;
      }
      delete this.timers[feed];
      void this.refresh(feed).catch(() => {});
    };
    this.timers[feed] = setTimeout(due, timerDelayUntil(deadline, this.now().getTime()));
  }

  /** Refreshes a feed. Concurrent calls share one request; rate-limit cool-downs are respected. */
  refresh(feed: FeedId): Promise<void> {
    const existing = this.inFlight[feed];
    if (existing) return existing;
    const until = this.rateLimitedUntil[feed];
    if (until && until > this.now().getTime()) {
      this.feeds[feed] = { ...this.feeds[feed], error: `Rate limited; next attempt after ${new Date(until).toISOString()}` };
      this.schedule(feed, until - this.now().getTime());
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
    const requestedScope = this.timelineScope(feed);
    this.feeds[feed] = { ...this.feeds[feed], state: 'loading', lastAttemptAt: startedAt };
    this.reevaluate();
    try {
      const observedAt = feed === 'nws' ? await this.fetchAlerts() : await this.fetchQuakes();
      if (observedAt === null) {
        this.feeds.usgs = { ...this.feeds.usgs, state: 'idle', error: 'The selected USGS feed changed; awaiting a response for the current query.' };
        this.timelineGap('usgs', 'The selected USGS query changed before this reply completed; no current-scope reply was recorded.');
        this.schedule('usgs', 0);
        this.reevaluate();
        return;
      }
      this.feeds[feed] = { ...this.feeds[feed], state: 'ok', lastSuccessAt: observedAt, fromCache: false, error: null, consecutiveFailures: 0 };
      delete this.rateLimitedUntil[feed];
      this.pruneHistory();
      this.schedule(feed, this.pollMs(feed));
    } catch (e) {
      const failures = this.feeds[feed].consecutiveFailures + 1;
      const retryAfter = e instanceof FeedHttpError ? e.retryAfterSec : null;
      const isRateLimit = e instanceof FeedHttpError && (e.status === 429 || e.status === 503);
      const backoff = computeBackoffMs(failures, isRateLimit ? (retryAfter ?? 60) : retryAfter);
      if (isRateLimit || retryAfter !== null) this.rateLimitedUntil[feed] = deadlineAfter(this.now().getTime(), backoff);
      // Keep last-known data and its original timestamps; only the status changes.
      this.feeds[feed] = { ...this.feeds[feed], state: 'error', error: describeError(e), consecutiveFailures: failures };
      this.log(`[feeds] ${feed} refresh failed (${failures}): ${describeError(e)}`);
      this.timelineGap(feed, `Feed refresh failed: ${describeError(e)}${requestedScope !== this.timelineScope(feed) ? ` (request scope ${requestedScope}; selected scope ${this.timelineScope(feed)})` : ''}`);
      this.schedule(feed, Math.max(backoff, Math.min(this.pollMs(feed), 30_000)));
    }
    this.reevaluate();
  }

  private async fetchAlerts(): Promise<string> {
    const res = await this.alertSource.fetchActiveAlerts();
    const at = this.now().toISOString();
    const prevAt = this.feeds.nws.lastSuccessAt;
    const coverage = replyFeedCoverage(res.skipped, res.coverage);
    const limit = refreshComparisonLimit(this.feeds.nws, coverage, 'active-US', at);
    this.diffs.nws = computeDiff('nws', prevAt && !limit ? alertRevisions(this.alerts) : null, limit ? [] : alertRevisions(res.alerts), at, prevAt, limit);
    this.alerts = res.alerts;
    this.superseded = supersededAlertIds(res.alerts);
    this.feeds.nws = { ...this.feeds.nws, sourceUpdatedAt: res.sourceUpdatedAt, recordCount: res.alerts.length, skippedRecords: res.skipped, coverage, scope: 'active-US' };
    this.store.setFeedCache('nws', { fetchedAt: at, sourceUpdatedAt: res.sourceUpdatedAt, payload: res.alerts, coverage });
    this.store.ingestAlerts(res.alerts, at);
    this.timelineObservation('nws', res.alerts, at, res.sourceUpdatedAt, res.skipped, 'active-US', coverage.completeness !== 'complete' ? coverage.note ?? 'Source reply completeness is unknown.' : null);
    return at;
  }

  private async fetchQuakes(): Promise<string | null> {
    const query = this.quakeQuery();
    const res = await this.quakeSource.fetchRecent(query);
    const at = this.now().toISOString();
    if (res.feedKey !== usgsFeedKey(query)) throw new FeedHttpError('USGS response does not match the requested feed.', null, null, 'parse');
    if (res.feedKey !== usgsFeedKey(this.quakeQuery())) {
      this.areaWatchService.defer('The USGS query changed while its request was in flight; area watches await a response for the current feed.');
      return null;
    }
    const quakes = dedupeQuakes(res.quakes);
    const sameFeed = this.quakeFeedKey === res.feedKey && this.feeds.usgs.lastSuccessAt !== null;
    const coverage = replyFeedCoverage(res.skipped, res.coverage);
    const limit = refreshComparisonLimit(this.feeds.usgs, coverage, res.feedKey, at);
    this.diffs.usgs = computeDiff('usgs', sameFeed && !limit ? quakeRevisions(this.rawQuakes) : null, limit ? [] : quakeRevisions(quakes), at, sameFeed ? this.feeds.usgs.lastSuccessAt : null, limit);
    this.rawQuakes = quakes;
    this.quakeFeedKey = res.feedKey;
    this.feeds.usgs = { ...this.feeds.usgs, sourceUpdatedAt: res.sourceUpdatedAt, recordCount: quakes.length, skippedRecords: res.skipped, coverage, scope: res.feedKey };
    this.store.setFeedCache<QuakeCachePayload>('usgs', { fetchedAt: at, sourceUpdatedAt: res.sourceUpdatedAt, payload: { feedKey: res.feedKey, quakes }, coverage });
    this.store.ingestQuakes(this.filteredQuakes(), at);
    // Archive exact normalized reply membership, before local alias/display filtering.
    this.timelineObservation('usgs', res.quakes, at, res.sourceUpdatedAt, res.skipped, res.feedKey, coverage.completeness !== 'complete' ? coverage.note ?? 'Source reply completeness is unknown.' : null);
    this.areaWatchService.evaluate(quakes, { observedAt: at, sourceUpdatedAt: res.sourceUpdatedAt, feedKey: res.feedKey, expectedFeedKey: usgsFeedKey(this.quakeQuery()), window: this.settings.quakeWindow });
    return at;
  }

  /** Earthquakes after applying the magnitude filter (the feed may include smaller events). */
  filteredQuakes(): Earthquake[] {
    if (this.quakeFeedKey !== null && this.quakeFeedKey !== usgsFeedKey(this.quakeQuery())) return [];
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

  private timelineScope(feed: FeedId): string { return feed === 'nws' ? 'active-US' : usgsFeedKey(this.quakeQuery()); }

  private timelineGap(feed: FeedId, reason: string): void {
    try { this.store.recordTimelineGap(feed, this.now().toISOString(), this.timelineScope(feed), reason); }
    catch { this.log('[timeline] gap could not be persisted; retained observations keep their original bounded validity.'); }
  }

  private timelineObservation(feed: FeedId, records: readonly (WeatherAlert | Earthquake)[], at: string, sourceUpdatedAt: string | null, skippedRecords: number, scope = this.timelineScope(feed), coverageNote: string | null = null): void {
    try {
      this.store.recordTimelineObservation({ feed, observedAt: at, sourceUpdatedAt, scope, skippedRecords, coverageNote, records, validForMs: staleAfterMs(feed === 'nws' ? this.settings.nwsPollSeconds : this.settings.usgsPollSeconds) });
    } catch {
      this.log('[timeline] reply archive could not be committed; live feed retrieval remains separate.');
      this.timelineGap(feed, 'A successful reply could not be retained by the local archive.');
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
      nwsObservedAt: this.feeds.nws.lastSuccessAt,
      nwsHistorical: fr.nws !== 'fresh' || this.feeds.nws.fromCache || this.feeds.nws.state !== 'ok' || !!this.feeds.nws.error,
      nwsCoverage: this.feeds.nws.coverage,
      usgsFreshness: fr.usgs,
      now: this.now(),
    });
    this.emit();
  }

  snapshot(): AppSnapshot {
    return {
      areaWatches: this.areaWatchService.state(),
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

  visitBriefing(): VisitBriefing { return this.store.visitBriefing(this.now().toISOString()); }

  private emit(): void {
    try {
      this.onChange();
    } catch {
      // listeners must not break the core
    }
  }

  // ---------- area annotations and local earthquake watches ----------
  putAreaWatch(rule: AreaWatchRuleInput): void {
    this.areaWatchService.putRule(rule, this.now().toISOString());
    this.emit();
  }

  deleteAreaWatch(areaId: string): boolean {
    const removed = this.areaWatchService.deleteRule(areaId);
    this.emit();
    return removed;
  }

  readAreaWatchEvents(ids: readonly string[]): void {
    this.areaWatchService.readEvents(ids);
    this.emit();
  }

  putAnnotation(annotation: AnnotationDocument): void {
    this.areaWatchService.putAnnotation(annotation, this.now().toISOString());
    this.emit();
  }

  deleteAnnotation(id: string): boolean {
    const removed = this.areaWatchService.deleteAnnotation(id);
    this.emit();
    return removed;
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
    const next = { ...this.settings, ...patch };
    this.store.saveSettings(next);
    return this.adoptSettings(next);
  }

  /** Persistence has committed before provider scheduling or renderer notifications. */
  applyScene(scene: Scene, allowMeteredBasemap = false): AppliedScene {
    const at = this.now().toISOString();
    const result = this.store.applyScene(scene, allowMeteredBasemap, annotations => this.areaWatchService.planAnnotationChanges(annotations, at));
    this.areaWatchService.adoptAnnotationCommit(scene.annotations);
    this.adoptCommittedSettings(result.settings, result.warnings);
    return result;
  }

  restoreView(id: string, allowMeteredBasemap = false): RestoredView {
    const result = this.store.restoreView(id, allowMeteredBasemap);
    this.adoptCommittedSettings(result.settings, result.warnings);
    return result;
  }

  private adoptSettings(next: Settings): Settings {
    const prev = this.settings;
    this.settings = next;
    if (prev.zoneLookupEnabled !== this.settings.zoneLookupEnabled) {
      this.syncZoneStatuses();
      this.locations = this.store.listLocations();
      void this.runZoneQueue();
    }
    const quakeChanged = prev.quakeWindow !== this.settings.quakeWindow || prev.quakeMinMagnitude !== this.settings.quakeMinMagnitude;
    if (quakeChanged && usgsFeedKey({ window: prev.quakeWindow, minMagnitude: prev.quakeMinMagnitude }) !== usgsFeedKey(this.quakeQuery())) {
      this.timelineGap('usgs', 'The selected USGS query changed; awaiting its first recorded reply.');
      this.feeds.usgs = { ...this.feeds.usgs, state: 'idle', lastSuccessAt: null, sourceUpdatedAt: null, fromCache: false, recordCount: 0, error: 'The selected USGS feed has not been retrieved yet.' };
      void this.refresh('usgs').catch(() => {});
    } else if (prev.usgsPollSeconds !== this.settings.usgsPollSeconds && this.feeds.usgs.state !== 'loading') {
      this.schedule('usgs', this.pollMs('usgs'));
    }
    if (prev.nwsPollSeconds !== this.settings.nwsPollSeconds && this.feeds.nws.state !== 'loading') {
      this.schedule('nws', this.pollMs('nws'));
    }
    if (prev.historyRetentionDays !== this.settings.historyRetentionDays || prev.historyMaxRecords !== this.settings.historyMaxRecords) this.pruneHistory();
    this.reevaluate();
    return this.settings;
  }

  private adoptCommittedSettings(settings: Settings, warnings: string[]): void {
    try { this.adoptSettings(settings); }
    catch {
      // A renderer observer or local refresh cannot undo a committed SQLite transaction.
      warnings.push('The saved state was committed, but a local refresh failed. Reload the application to refresh its display.');
    }
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
