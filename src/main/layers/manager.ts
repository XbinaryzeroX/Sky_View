// Layer scheduling: polls only enabled layers at provider-appropriate
// intervals, refetches viewport layers when the view changes materially,
// backs off on failure, keeps last-known records with their timestamps,
// reconciles additions/updates/removals by stable id, and records observed
// positions for playback. One timer per layer; no duplicate requests.

import { LAYER_IDS, LAYERS, type GeoRecord, type LayerId, type LayerSnapshot, type LayerStatus, type ViewState } from '../../shared/layers';
import { freshnessOf } from '../../shared/monitoring';
import type { Settings } from '../../shared/types';
import { computeBackoffMs, FeedHttpError, type FetchJson, type FetchText } from '../feeds/http';
import type { AtlasStore } from '../store';
import type { AisStreamClient } from './aisstream';
import { FETCHERS, type FetchResult } from './fetchers';

const TRACKED_LAYERS: LayerId[] = ['aircraft', 'aircraftMil', 'vessels', 'transit'];
const VIEW_REFETCH_MIN_MS: Partial<Record<LayerId, number>> = { aircraft: 8000, metar: 15_000 };

export interface LayerManagerDeps {
  store: AtlasStore;
  fetchJson: FetchJson;
  fetchText: FetchText;
  getSettings: () => Settings;
  userAgent: () => string;
  localReceiverUrl: () => string | null;
  ais: AisStreamClient | null;
  aisConfigured: () => boolean;
  emit: (id: LayerId) => void;
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
  private view: ViewState | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private aisTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly d: LayerManagerDeps) {
    this.now = d.now ?? (() => new Date());
    this.log = d.log ?? (() => {});
    for (const id of LAYER_IDS) this.snaps.set(id, { status: emptyStatus(id, this.isEnabled(id)), records: [] });
  }

  isEnabled(id: LayerId): boolean {
    return this.d.getSettings().layersEnabled.includes(id);
  }

  start(): void {
    this.running = true;
    for (const id of LAYER_IDS) if (this.isEnabled(id)) this.schedule(id, 0);
    this.syncAis();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
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
        this.schedule(id, 0);
      } else if (!on && snap.status.enabled) {
        const t = this.timers.get(id);
        if (t) clearTimeout(t);
        this.timers.delete(id);
        snap.status = { ...snap.status, enabled: false, nextAttemptAt: null };
        this.d.emit(id);
      }
    }
    this.syncAis();
  }

  setView(v: ViewState): void {
    this.view = v;
    if (this.viewTimer) clearTimeout(this.viewTimer);
    // Debounce camera motion; refetch viewport layers once the view settles.
    this.viewTimer = setTimeout(() => {
      for (const id of LAYER_IDS) {
        if (!LAYERS[id].viewport || !this.isEnabled(id)) continue;
        if (!viewMovedEnough(this.lastFetchView.get(id) ?? null, v)) continue;
        const since = this.now().getTime() - (this.lastFetchAt.get(id) ?? 0);
        const min = VIEW_REFETCH_MIN_MS[id] ?? 30_000;
        const st = this.snaps.get(id)!.status;
        // Never bypass failure backoff: keep the later of the backoff time and the view-refetch time.
        const backoffWait = st.consecutiveFailures > 0 && st.nextAttemptAt ? Math.max(0, Date.parse(st.nextAttemptAt) - this.now().getTime()) : 0;
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
    const poll = LAYERS[id].pollSeconds;
    s.status = { ...s.status, freshness: freshnessOf({ ...s.status, feed: 'nws', fromCache: false } as never, Math.min(poll, 3600), this.now().getTime()) };
    return s;
  }

  statuses(): LayerStatus[] {
    return LAYER_IDS.map((id) => this.snapshot(id).status);
  }

  private schedule(id: LayerId, delayMs: number): void {
    if (!this.running || !this.isEnabled(id)) return;
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    const snap = this.snaps.get(id)!;
    snap.status = { ...snap.status, nextAttemptAt: new Date(this.now().getTime() + delayMs).toISOString() };
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.refresh(id).catch(() => {});
      }, delayMs),
    );
  }

  refresh(id: LayerId): Promise<void> {
    const existing = this.inFlight.get(id);
    if (existing) return existing;
    const until = this.rateLimitedUntil.get(id);
    if (until && until > this.now().getTime()) return Promise.resolve();
    const p = this.doRefresh(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, p);
    return p;
  }

  private async doRefresh(id: LayerId): Promise<void> {
    const snap = this.snaps.get(id)!;
    const started = this.now();
    snap.status = { ...snap.status, state: 'loading', lastAttemptAt: started.toISOString() };
    this.d.emit(id);
    const view = this.view;
    try {
      const res: FetchResult = await FETCHERS[id]({
        view,
        settings: this.d.getSettings(),
        fetchJson: this.d.fetchJson,
        fetchText: this.d.fetchText,
        userAgent: this.d.userAgent(),
        store: this.d.store,
        localReceiverUrl: id === 'aircraft' ? this.d.localReceiverUrl() : null,
        now: started,
      });
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
      this.schedule(id, LAYERS[id].pollSeconds * 1000);
    } catch (e) {
      const failures = snap.status.consecutiveFailures + 1;
      const rl = e instanceof FeedHttpError && (e.status === 429 || e.status === 503);
      const backoff = computeBackoffMs(failures, rl ? ((e as FeedHttpError).retryAfterSec ?? 60) : null);
      if (rl) this.rateLimitedUntil.set(id, this.now().getTime() + backoff);
      // Keep last-known records and their original timestamps.
      snap.status = { ...snap.status, state: 'error', error: describe(e), consecutiveFailures: failures };
      this.log(`[layers] ${id} failed (${failures}): ${describe(e)}`);
      this.schedule(id, Math.max(backoff, Math.min(LAYERS[id].pollSeconds * 1000, 30_000)));
    }
    this.d.emit(id);
  }

  private recordTracks(id: LayerId, records: GeoRecord[]): void {
    try {
      const pts = records
        .filter((r) => r.observedAt)
        .map((r) => ({ rid: r.id, t: r.observedAt!, lat: r.lat, lon: r.lon, alt: r.altM, heading: r.heading }));
      this.d.store.addTrackPoints(id, pts);
      const s = this.d.getSettings();
      this.d.store.pruneTracks(s.trackRetentionHours, 400_000, this.now());
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
    const want = this.running && this.isEnabled('vessels') && this.d.aisConfigured() && this.view !== null;
    if (want) {
      ais.start(this.view!.bbox);
      if (!this.aisTimer) {
        // Publish streamed positions every 10 s between Digitraffic polls.
        this.aisTimer = setInterval(() => {
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
