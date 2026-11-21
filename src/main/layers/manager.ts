// Layer scheduling: polls only enabled layers at provider-appropriate
// intervals, refetches viewport layers when the view changes materially,
// backs off on failure, keeps last-known records with their timestamps,
// reconciles additions/updates/removals by stable id, and records observed
// positions for playback. One timer per layer; no duplicate requests.

import type { KeyedCameraId } from '../../shared/keyedCameras';
import { trackState } from '../../shared/aircraft';
import { LAYER_IDS, LAYERS, type GeoRecord, type LayerId, type LayerSnapshot, type LayerStatus, type ViewState } from '../../shared/layers';
import { freshnessOf } from '../../shared/monitoring';
import type { Settings } from '../../shared/types';
import { computeBackoffMs, FeedHttpError, type FetchJson, type FetchText } from '../feeds/http';
import { deadlineAfter, timerDelayUntil } from '../feeds/timing';
import type { AtlasStore } from '../store';
import type { AisStreamClient } from './aisstream';
import { aircraftCoverage, aircraftCoveredBy, aircraftProviderHost, FETCHERS, type FetchResult, type SourceState } from './fetchers';
import { REPLAY_LAYERS, TRACK_MAX_RETENTION_HOURS, TRACK_THIN_AFTER_HOURS, trackPointBudget } from '../../shared/timeline';
import { dwdFreshness, type DwdSource } from './dwdSource';
import { AreaRecorder, type AreaRecordingStatus } from './areaRecorder';

const TRACKED_LAYERS: LayerId[] = [...REPLAY_LAYERS];
const VIEW_REFETCH_MIN_MS: Partial<Record<LayerId, number>> = { aircraft: 8000, metar: 15_000 };

export interface LayerManagerDeps {
  dwd?: DwdSource;
  store: AtlasStore;
  fetchJson: FetchJson;
  fetchText: FetchText;
  getSettings: () => Settings;
  userAgent: () => string;
  localReceiverUrl: () => string | null;
  /** OpenSky API client 'id:secret' from Provider settings, if configured. */
  openskyClient?: () => string | null;
  /** Launch Library 2 token (optional; anonymous allowance when absent). */
  launchToken?: () => string | null;
  /** The customer's saved key for a keyed camera system, or null. */
  cameraKey?: (id: KeyedCameraId) => string | null;
  ais: AisStreamClient | null;
  aisConfigured: () => boolean;
  emit: (id: LayerId) => void;
  /** The watch-area recording started, stopped or finished a poll. */
  onRecordingChange?: () => void;
  now?: () => Date;
  log?: (m: string) => void;
}

function emptyStatus(id: LayerId, enabled: boolean): LayerStatus {
  return { id, enabled, state: 'idle', lastAttemptAt: null, lastSuccessAt: null, sourceUpdatedAt: null, error: null, consecutiveFailures: 0, nextAttemptAt: null, recordCount: 0, skippedRecords: 0, freshness: 'unavailable', note: null };
}

function describe(e: unknown): string {
  if (e instanceof FeedHttpError) {
    if (e.status === 401 || e.status === 403) return `Access denied by provider (HTTP ${e.status})`;
    if (e.status === 429) return 'Rate limited by provider (HTTP 429)';
    if (e.kind === 'network') return 'Network unavailable or host unreachable';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Distance between views large enough to warrant a viewport refetch. */
export function viewMovedEnough(a: ViewState | null, b: ViewState): boolean {
  if (!a) return true;
  const scale = Math.max(a.heightM, b.heightM);
  const dLat = Math.abs(a.lat - b.lat) * 111_000;
  const dLon = Math.abs(a.lon - b.lon) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) > scale * 0.25 || Math.abs(Math.log(b.heightM / a.heightM)) > 0.5;
}

export class LayerManager {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private snaps = new Map<LayerId, LayerSnapshot>();
  private timers = new Map<LayerId, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<LayerId, Promise<void>>();
  private lastFetchView = new Map<LayerId, ViewState | null>();
  private lastFetchAt = new Map<LayerId, number>();
  private rateLimitedUntil = new Map<LayerId, number>();
  /** Bumped when credentials a layer uses change; a refresh started under an older value is discarded. */
  private credentialGen = new Map<LayerId, number>();
  /** Layers whose credentials changed while a refresh was in flight: one more refresh runs after it settles. */
  private rerun = new Set<LayerId>();
  /** Per-source catalogs and rate limits (cameras), kept across refreshes. */
  private sourceStates = new Map<LayerId, SourceState>();
  private view: ViewState | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private aisTimer: ReturnType<typeof setInterval> | null = null;
  private dwdDisplayTimer: ReturnType<typeof setTimeout> | undefined;
  private dwdDisplayDeadline = Infinity;
  private running = false;
  private lastAircraftHost: string | null = null;
  private readonly recorder: AreaRecorder;

  constructor(private readonly d: LayerManagerDeps) {
    this.now = d.now ?? (() => new Date());
    this.log = d.log ?? (() => {});
    this.recorder = new AreaRecorder({
      store: d.store, fetchJson: d.fetchJson, fetchText: d.fetchText, getSettings: d.getSettings, userAgent: d.userAgent,
      sources: (id) => this.sourceState(id),
      isLayerOn: (id) => this.isEnabled(id) && this.snaps.get(id)?.status.state === 'ok',
      liveRecords: (id) => this.snaps.get(id)?.records ?? [],
      aisRecords: () => (this.d.ais && this.d.aisConfigured() ? this.d.ais.records(this.now().getTime()) : null),
      onChange: () => d.onRecordingChange?.(),
      now: this.now, log: this.log,
    });
    for (const id of LAYER_IDS) this.snaps.set(id, { status: emptyStatus(id, this.isEnabled(id)), records: [] });
  }

  isEnabled(id: LayerId): boolean {
    return this.d.getSettings().layersEnabled.includes(id);
  }

  start(): void {
    this.running = true;
    for (const id of LAYER_IDS) if (this.isEnabled(id)) this.schedule(id, 0);
    this.recorder.start();
    this.syncAis();
  }

  recordingStatus(): AreaRecordingStatus {
    return this.recorder.status;
  }

  stop(): void {
    this.running = false;
    this.scheduleDwdDisplay(Infinity);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.recorder.stop();
    if (this.viewTimer) clearTimeout(this.viewTimer);
    if (this.aisTimer) clearInterval(this.aisTimer);
    this.aisTimer = null;
    this.d.ais?.stop();
  }

  /** Call after settings.layersEnabled changes. */
  syncEnabled(): void {
    for (const id of LAYER_IDS) {
      const on = this.isEnabled(id);
      const snap = this.snaps.get(id)!;
      if (on && !snap.status.enabled) {
        snap.status = { ...snap.status, enabled: true };
        if (id === 'dwd' && this.inFlight.has(id)) this.rerun.add(id);
        this.schedule(id, 0);
      } else if (!on && snap.status.enabled) {
        const t = this.timers.get(id);
        if (t) clearTimeout(t);
        this.timers.delete(id);
        snap.status = { ...snap.status, enabled: false, nextAttemptAt: null };
        if (id === 'dwd') {
          this.scheduleDwdDisplay(Infinity);
          this.credentialGen.set(id, (this.credentialGen.get(id) ?? 0) + 1);
          snap.status = emptyStatus(id, false);
          snap.records = [];
        }
        this.d.emit(id);
      }
    }
    if (this.isEnabled('aircraft') && this.lastAircraftHost && this.lastAircraftHost !== aircraftProviderHost(this.view, this.d.getSettings())) {
      if (this.inFlight.has('aircraft')) this.rerun.add('aircraft');
      else this.schedule('aircraft', 0);
    }
    this.recorder.sync();
    this.syncAis();
  }

  setView(v: ViewState): void {
    this.view = v;
    if (this.viewTimer) clearTimeout(this.viewTimer);
    // Debounce camera motion; refetch viewport layers once the view settles.
    this.viewTimer = setTimeout(() => {
      for (const id of LAYER_IDS) {
        if (!LAYERS[id].viewport || !this.isEnabled(id)) continue;
        const changedProvider = id === 'aircraft' && this.lastAircraftHost !== aircraftProviderHost(v, this.d.getSettings());
        if (!viewMovedEnough(this.lastFetchView.get(id) ?? null, v) && !changedProvider) continue;
        // Zooming into (or panning within) the area the last aircraft request covered needs no new request: the
        // records are already loaded, and re-asking on every zoom step made adsb.lol rate-limit the app until
        // the traffic expired off the map. The regular poll still refreshes them.
        if (id === 'aircraft' && !changedProvider) {
          const prev = aircraftCoverage(this.lastFetchView.get(id) ?? null, this.d.getSettings());
          const next = aircraftCoverage(v, this.d.getSettings());
          if (prev && next && aircraftCoveredBy(prev, next)) continue;
        }
        if (changedProvider && this.inFlight.has(id)) { this.rerun.add(id); continue; }
        const since = this.now().getTime() - (this.lastFetchAt.get(id) ?? 0);
        const min = changedProvider ? 0 : VIEW_REFETCH_MIN_MS[id] ?? 30_000;
        const st = this.snaps.get(id)!.status;
        // Never bypass failure backoff: keep the later of the backoff time and the view-refetch time.
        const backoffWait = !changedProvider && st.consecutiveFailures > 0 && st.nextAttemptAt ? Math.max(0, Date.parse(st.nextAttemptAt) - this.now().getTime()) : 0;
        this.schedule(id, Math.max(backoffWait, min - since, 0));
      }
      this.syncAis();
    }, 1200);
  }

  getView(): ViewState | null {
    return this.view;
  }

  snapshot(id: LayerId): LayerSnapshot {
    const s = this.snaps.get(id)!;
    if (id === 'dwd') {
      const current = s.status.enabled ? this.d.dwd?.current() : null;
      if (!current) return s;
      const now = this.now().getTime();
      const freshness = dwdFreshness(current, now);
      if (this.running) this.scheduleDwdDisplay(this.d.dwd!.nextDisplayChange(now));
      return { status: { ...s.status, freshness, recordCount: current.warnings.length, skippedRecords: current.skipped,
        lastSuccessAt: current.checkedAt, sourceUpdatedAt: current.sourceUpdatedAt, note: current.note },
        records: current.records, dwdWarnings: current.warnings };
    }
    const poll = LAYERS[id].pollSeconds;
    s.status = { ...s.status, freshness: freshnessOf({ ...s.status, feed: 'nws', fromCache: false } as never, Math.min(poll, 3600), this.now().getTime()) };
    return s;
  }

  statuses(): LayerStatus[] {
    return LAYER_IDS.map((id) => this.snapshot(id).status);
  }

  private scheduleDwdDisplay(deadline: number): void {
    if (deadline === this.dwdDisplayDeadline) return;
    clearTimeout(this.dwdDisplayTimer);
    this.dwdDisplayDeadline = deadline;
    if (Number.isFinite(deadline)) {
      this.dwdDisplayTimer = setTimeout(() => {
        this.dwdDisplayDeadline = Infinity;
        if (this.running && this.isEnabled('dwd')) this.d.emit('dwd');
      }, timerDelayUntil(deadline, this.now().getTime()));
    }
  }

  private schedule(id: LayerId, delayMs: number): void {
    if (!this.running || !this.isEnabled(id)) return;
    const now = this.now().getTime();
    delayMs = Math.max(delayMs, this.cooldownUntil(id) - now);
    const deadline = deadlineAfter(now, delayMs);
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    const snap = this.snaps.get(id)!;
    snap.status = { ...snap.status, nextAttemptAt: new Date(deadline).toISOString() };
    // Node clamps overflowing delays to about 1 ms. Reach a long absolute deadline through bounded hops,
    // while leaving the publisher's actual next-attempt time visible instead of the intermediate hop.
    const arm = () => {
      if (!this.running || !this.isEnabled(id)) return;
      this.timers.set(id, setTimeout(() => {
        this.timers.delete(id);
        if (!this.running || !this.isEnabled(id)) return;
        if (this.now().getTime() < deadline) { arm(); return; }
        void this.refresh(id).catch(() => {});
      }, timerDelayUntil(deadline, this.now().getTime())));
    };
    arm();
  }

  refresh(id: LayerId): Promise<void> {
    if (id === 'dwd' && !this.isEnabled(id)) return Promise.resolve();
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const until = deadlineAfter(this.now().getTime(), this.cooldownUntil(id) - this.now().getTime());
    if (until > this.now().getTime()) {
      const snap = this.snaps.get(id)!;
      if (snap.status.state !== 'error') {
        snap.status = { ...snap.status, state: 'error', error: `Provider cooldown until ${new Date(until).toISOString()}`, consecutiveFailures: Math.max(1, snap.status.consecutiveFailures) };
        this.d.emit(id);
      }
      this.schedule(id, until - this.now().getTime());
      return Promise.resolve();
    }
    const p = this.doRefresh(id).finally(() => {
      this.inFlight.delete(id);
      // Credentials changed mid-refresh: fetch once more with the current ones.
      if (this.rerun.delete(id) && this.isEnabled(id)) void this.refresh(id).catch(() => {});
    });
    this.inFlight.set(id, p);
    return p;
  }

  /**
   * Call after the customer saves or removes a credential the layer uses. A refresh already
   * underway was started with the old value, so its outcome is discarded and one fresh refresh
   * follows it; otherwise a refresh starts now (rate limits are still respected).
   */
  credentialsChanged(id: LayerId): void {
    this.credentialGen.set(id, (this.credentialGen.get(id) ?? 0) + 1);
    if (!this.isEnabled(id)) return;
    if (this.inFlight.has(id)) this.rerun.add(id);
    else void this.refresh(id).catch(() => {});
  }

  private async doRefresh(id: LayerId): Promise<void> {
    const snap = this.snaps.get(id)!;
    const started = this.now();
    const gen = this.credentialGen.get(id) ?? 0;
    const stale = () => (this.credentialGen.get(id) ?? 0) !== gen;
    const before = snap.status.state;
    snap.status = { ...snap.status, state: 'loading', lastAttemptAt: started.toISOString() };
    this.d.emit(id);
    const view = this.view;
    if (id === 'aircraft') this.lastAircraftHost = aircraftProviderHost(view, this.d.getSettings());
    try {
      const res: FetchResult = await FETCHERS[id]({
        dwd: id === 'dwd' ? this.d.dwd : undefined,
        view,
        settings: this.d.getSettings(),
        fetchJson: this.d.fetchJson,
        fetchText: this.d.fetchText,
        userAgent: this.d.userAgent(),
        store: this.d.store,
        localReceiverUrl: id === 'aircraft' ? this.d.localReceiverUrl() : null,
        openskyClient: id === 'aircraft' ? (this.d.openskyClient?.() ?? null) : null,
        launchToken: id === 'launches' ? (this.d.launchToken?.() ?? null) : null,
        cameraKey: id === 'cameras' ? this.d.cameraKey : undefined,
        sources: id === 'cameras' || id === 'aircraft' || id === 'aircraftMil' ? this.sourceState(id) : undefined,
        clock: () => this.now().getTime(),
        now: started,
      });
      if (stale()) {
        // Fetched with credentials that have since changed: never publish it (the queued refresh replaces it).
        if (id !== 'dwd') snap.status = { ...snap.status, state: before };
        this.d.emit(id);
        return;
      }
      if (res.failure) {
        this.publishFailedResult(id, res);
        return;
      }
      if (res.incomplete) {
        this.publishIncompleteAircraft(id, res);
        return;
      }
      let records = res.records;
      if (id === 'vessels' && this.d.ais && this.d.aisConfigured()) records = this.mergeAis(records);
      // Reconcile: the new set replaces the old one (removals handled); ids are stable per provider.
      snap.records = records;
      snap.status = {
        ...snap.status,
        state: 'ok',
        lastSuccessAt: this.now().toISOString(),
        sourceUpdatedAt: res.sourceUpdatedAt,
        error: null,
        consecutiveFailures: 0,
        recordCount: records.length,
        skippedRecords: res.skipped,
        note: res.note,
      };
      this.lastFetchView.set(id, view);
      this.lastFetchAt.set(id, this.now().getTime());
      this.rateLimitedUntil.delete(id);
      if (TRACKED_LAYERS.includes(id)) this.recordTracks(id, records);
      // Part of the result may fall due sooner (a source's rate limit ends): refresh then; due sources only are fetched.
      const soon = res.refreshAt != null ? Math.max(5_000, res.refreshAt - this.now().getTime()) : Infinity;
      this.schedule(id, Math.min(LAYERS[id].pollSeconds * 1000, soon));
    } catch (e) {
      const failures = snap.status.consecutiveFailures + 1;
      const retryAfter = e instanceof FeedHttpError ? e.retryAfterSec : null;
      const rl = e instanceof FeedHttpError && (e.status === 429 || e.status === 503);
      const publisherPause = rl || retryAfter !== null;
      const backoff = computeBackoffMs(failures, rl ? (retryAfter ?? 60) : retryAfter);
      if (publisherPause) this.rateLimitedUntil.set(id, deadlineAfter(this.now().getTime(), backoff));
      if (stale()) {
        // A failure under old credentials says nothing about the new ones; only a rate limit (which is
        // about the host) is kept, and the next attempt waits for it.
        if (id !== 'dwd') snap.status = { ...snap.status, state: before };
        if (publisherPause) this.schedule(id, backoff);
        this.d.emit(id);
        return;
      }
      // Keep last-known records and their original timestamps.
      snap.status = { ...snap.status, state: 'error', error: describe(e), consecutiveFailures: failures };
      this.log(`[layers] ${id} failed (${failures}): ${describe(e)}`);
      this.schedule(id, Math.max(backoff, Math.min(LAYERS[id].pollSeconds * 1000, 30_000)));
    }
    this.d.emit(id);
  }

  /**
   * A fetcher that reconciles its own sources reported that nothing usable came back. Unlike a thrown error (where
   * the last-known records stay), its reconciled records are published, even when empty: catalogs that expired or
   * whose key was rejected or removed must not linger. The layer still shows the error and backs off.
   */
  private publishFailedResult(id: LayerId, res: FetchResult): void {
    const snap = this.snaps.get(id)!;
    const failures = snap.status.consecutiveFailures + 1;
    snap.records = res.records;
    snap.status = { ...snap.status, state: 'error', error: res.failure ?? 'Failed', consecutiveFailures: failures, recordCount: res.records.length, skippedRecords: res.skipped, note: res.note };
    this.log(`[layers] ${id} failed (${failures}): ${res.failure}`);
    this.d.emit(id);
    const backoff = computeBackoffMs(failures, null);
    // Never before a source's rate limit ends (the fetcher would skip that host anyway), never later than the poll.
    const limitEnds = res.refreshAt != null ? res.refreshAt - this.now().getTime() : 0;
    this.schedule(id, Math.min(LAYERS[id].pollSeconds * 1000, Math.max(backoff, limitEnds, Math.min(LAYERS[id].pollSeconds * 1000, 30_000))));
  }

  /** A partial aircraft refresh cannot establish removals in areas/sources that did not answer. */
  private publishIncompleteAircraft(id: LayerId, res: FetchResult): void {
    const snap = this.snaps.get(id)!;
    const now = this.now().getTime();
    const failures = snap.status.consecutiveFailures + 1;
    const merged = new Map(snap.records.map((r) => [r.id, r]));
    for (const record of res.records) {
      const old = merged.get(record.id);
      if (!old || (record.observedAt ?? '') >= (old.observedAt ?? '')) merged.set(record.id, record);
    }
    // Keep original report times; expired observations must not accumulate through repeated partial pans.
    snap.records = [...merged.values()].filter((r) => trackState(r, now) !== 'expired');
    const times = [snap.status.sourceUpdatedAt, res.sourceUpdatedAt].filter((v): v is string => !!v);
    snap.status = { ...snap.status, state: 'error', error: res.incomplete!.error, consecutiveFailures: failures,
      sourceUpdatedAt: times.length ? times.sort()[0] : null, recordCount: snap.records.length, skippedRecords: res.skipped,
      note: `${res.note ?? ''} Keeping last-known observations from sources or areas that did not answer; their report times are unchanged.`.trim() };
    this.recordTracks(id, res.records);
    const limit = res.incomplete!.retryAt ?? 0;
    const localContinues = id === 'aircraft' && !!this.d.localReceiverUrl();
    const delay = localContinues ? LAYERS[id].pollSeconds * 1000 : Math.max(computeBackoffMs(failures, null), limit - now);
    if (limit > now && !localContinues) this.rateLimitedUntil.set(id, deadlineAfter(now, delay));
    // Both aircraft adapters use the same public host. A layer toggle or force-refresh cannot bypass its wait.
    const adsbLimit = this.sourceState('aircraft').backoff.get('api.adsb.lol')?.until ?? 0;
    if (adsbLimit > now) {
      this.rateLimitedUntil.set('aircraftMil', Math.max(this.rateLimitedUntil.get('aircraftMil') ?? 0, adsbLimit));
      if (!this.d.localReceiverUrl()) this.rateLimitedUntil.set('aircraft', Math.max(this.rateLimitedUntil.get('aircraft') ?? 0, adsbLimit));
    }
    this.log(`[layers] ${id} incomplete (${failures}): ${res.incomplete!.error}`);
    this.schedule(id, delay);
    this.d.emit(id);
  }

  private sourceState(id: LayerId): SourceState {
    if (id === 'aircraftMil') id = 'aircraft';
    let s = this.sourceStates.get(id);
    if (!s) this.sourceStates.set(id, (s = { backoff: new Map(), cache: new Map() }));
    return s;
  }

  private cooldownUntil(id: LayerId): number {
    if (id === 'aircraft') {
      if (this.d.localReceiverUrl()) return 0;
      const host = aircraftProviderHost(this.view, this.d.getSettings());
      return this.sourceState(id).backoff.get(host)?.until ?? 0;
    }
    return Math.max(this.rateLimitedUntil.get(id) ?? 0,
      id === 'aircraftMil' ? this.sourceState(id).backoff.get('api.adsb.lol')?.until ?? 0 : 0);
  }

  private tracksPrunedAt = 0;
  private tracksThinnedUntil: string | null = null;

  /**
   * Retention and the storage budget at most once a minute (the point count scans the table); thinning of fixes older
   * than TRACK_THIN_AFTER_HOURS in the stretch not yet thinned, at most every 15 minutes.
   */
  private maintainTracks(): void {
    const now = this.now();
    if (now.getTime() - this.tracksPrunedAt < 60_000) return;
    this.tracksPrunedAt = now.getTime();
    const s = this.d.getSettings();
    this.d.store.pruneTracks(Math.min(TRACK_MAX_RETENTION_HOURS, s.trackRetentionHours), trackPointBudget(s.trackStorageMB), now);
    const until = new Date(now.getTime() - TRACK_THIN_AFTER_HOURS * 3_600_000).toISOString();
    if (this.tracksThinnedUntil && Date.parse(until) - Date.parse(this.tracksThinnedUntil) < 15 * 60_000) return;
    const from = this.tracksThinnedUntil ?? this.d.store.trackRange().oldest;
    if (from) this.d.store.thinTracks(from, until);
    this.tracksThinnedUntil = until;
  }

  private recordTracks(id: LayerId, records: GeoRecord[]): void {
    try {
      const pts = records
        .filter((r) => r.observedAt)
        .map((r) => ({ rid: r.id, t: r.observedAt!, lat: r.lat, lon: r.lon, alt: r.altM, heading: r.heading, ground: typeof r.props.onGround === 'boolean' ? r.props.onGround : null }));
      this.d.store.addTrackPoints(id, pts);
      this.maintainTracks();
    } catch (e) {
      this.log(`[tracks] ${id}: ${describe(e)}`);
    }
  }

  private mergeAis(base: GeoRecord[]): GeoRecord[] {
    const merged = new Map(base.map((r) => [r.id, r]));
    for (const r of this.d.ais!.records(this.now().getTime())) {
      const cur = merged.get(r.id);
      if (!cur || (r.observedAt ?? '') > (cur.observedAt ?? '')) merged.set(r.id, cur ? { ...r, label: r.label.startsWith('MMSI') ? cur.label : r.label, category: cur.category } : r);
    }
    return [...merged.values()];
  }

  /** Starts/stops the AISStream socket to match layer state, key, and zoom. */
  private syncAis(): void {
    const ais = this.d.ais;
    if (!ais) return;
    const area = this.recorder.box();
    const live = this.isEnabled('vessels') && this.view !== null;
    const want = this.running && this.d.aisConfigured() && (live || area !== null);
    if (want) {
      // A recorded watch area is subscribed alongside the view; with the vessel layer off it is the only box.
      if (live) ais.start(this.view!.bbox, area);
      else ais.start(area!);
      if (!this.aisTimer) {
        // Publish streamed positions every 10 s between Digitraffic polls.
        this.aisTimer = setInterval(() => {
          if (!this.isEnabled('vessels')) return;
          const snap = this.snaps.get('vessels')!;
          const base = snap.records.filter((r) => !r.source.startsWith('AISStream'));
          snap.records = this.mergeAis(base);
          snap.status = { ...snap.status, recordCount: snap.records.length };
          this.d.emit('vessels');
        }, 10_000);
      }
    } else {
      ais.stop();
      if (this.aisTimer) clearInterval(this.aisTimer);
      this.aisTimer = null;
    }
  }

  aisStatus() {
    return this.d.ais?.status ?? null;
  }
}
