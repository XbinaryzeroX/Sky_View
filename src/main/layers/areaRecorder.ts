// Watch-area recording: while the app runs, keeps polling one watch area (even when the view is elsewhere) and stores
// what it sees for replay: aircraft and military-aircraft fixes, ship fixes from the AISStream socket, and snapshots
// of GPS accuracy cells and conflict reports. Polls are slower than the live layers and share their rate-limit
// pauses, so recording never adds a burst of requests to a publisher. Only observations are stored; nothing is
// extrapolated.

import type { GeoRecord, LayerId, ViewState } from '../../shared/layers';
import type { Settings } from '../../shared/types';
import { inBox, watchArea, watchAreaBox, type AreaRecordingStatus, type RecordTask, type WatchArea } from '../../shared/watchAreas';
export type { AreaRecordingStatus, RecordTask };
import type { FetchJson, FetchText } from '../feeds/http';
import type { AtlasStore } from '../store';
import { FETCHERS, type FetchResult, type SourceState } from './fetchers';

/** Seconds between polls per task. Measured against the live layers: aircraft 20–60 s, GNSS 120 s, conflicts 900 s. */
export const RECORD_INTERVAL_S: Record<RecordTask, number> = { aircraft: 90, aircraftMil: 120, vessels: 60, gnss: 180, conflicts: 900 };
const ERROR_PAUSE_MS = 5 * 60_000;


export interface AreaRecorderDeps {
  store: AtlasStore;
  fetchJson: FetchJson;
  fetchText: FetchText;
  getSettings: () => Settings;
  userAgent: () => string;
  /** Rate-limit and cache state shared with the live layer of the same provider. */
  sources: (id: LayerId) => SourceState;
  isLayerOn: (id: LayerId) => boolean;
  /** The live layer's current records, used instead of a second request when that layer is already polling. */
  liveRecords: (id: LayerId) => GeoRecord[];
  /** Positions from the AISStream socket, or null when no key is saved. */
  aisRecords: () => GeoRecord[] | null;
  onChange: () => void;
  now?: () => Date;
  log?: (m: string) => void;
  /** Replaced in tests. */
  fetchers?: Partial<Record<LayerId, (ctx: Parameters<(typeof FETCHERS)['aircraft']>[0]) => Promise<FetchResult>>>;
}

export function areaView(a: WatchArea): ViewState {
  return { lat: a.lat, lon: a.lon, heightM: a.radiusKm * 2500, bbox: watchAreaBox(a) };
}

export class AreaRecorder {
  private timers = new Map<RecordTask, ReturnType<typeof setTimeout>>();
  private pausedUntil = new Map<RecordTask, number>();
  private area: WatchArea | null = null;
  private running = false;
  status: AreaRecordingStatus = { areaId: null, areaName: null, startedAt: null, tasks: {} };
  private readonly now: () => Date;

  constructor(private readonly d: AreaRecorderDeps) {
    this.now = d.now ?? (() => new Date());
  }

  start(): void {
    this.running = true;
    this.sync();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** The box the AISStream socket should also subscribe to, or null. */
  box(): [number, number, number, number] | null {
    return this.running && this.area ? watchAreaBox(this.area) : null;
  }

  /** Call after settings change. */
  sync(): void {
    const id = this.d.getSettings().recordAreaId;
    const next = this.running && id ? watchArea(id) : null;
    if (next?.id === this.area?.id) return;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pausedUntil.clear();
    this.area = next;
    this.status = next ? { areaId: next.id, areaName: next.name, startedAt: this.now().toISOString(), tasks: {} } : { areaId: null, areaName: null, startedAt: null, tasks: {} };
    if (next) (Object.keys(RECORD_INTERVAL_S) as RecordTask[]).forEach((task, i) => this.arm(task, 2_000 + i * 3_000));
    this.d.onChange();
  }

  private arm(task: RecordTask, delayMs: number): void {
    if (!this.running || !this.area) return;
    const area = this.area;
    this.timers.set(task, setTimeout(() => {
      this.timers.delete(task);
      if (this.area !== area) return;
      void this.run(task, area).finally(() => this.arm(task, RECORD_INTERVAL_S[task] * 1000));
    }, delayMs));
  }

  /** One poll of one task. Public for tests. */
  async run(task: RecordTask, area: WatchArea): Promise<void> {
    const now = this.now();
    if ((this.pausedUntil.get(task) ?? 0) > now.getTime()) return;
    const box = watchAreaBox(area);
    try {
      const records = (await this.collect(task, area, now)).filter((r) => inBox(box, r.lat, r.lon));
      // Recording was stopped or moved to another area while this poll was in flight.
      if (this.running && this.area?.id !== area.id) return;
      const at = now.toISOString();
      const retention = this.d.getSettings().trackRetentionHours;
      if (task === 'gnss' || task === 'conflicts') {
        if (!this.d.store.recordLayerFrame(task, area.id, at, records, retention)) throw new Error('Snapshot too large to record');
      } else {
        const pts = records.filter((r) => r.observedAt).map((r) => ({ rid: r.id, t: r.observedAt!, lat: r.lat, lon: r.lon, alt: r.altM, heading: r.heading, ground: typeof r.props.onGround === 'boolean' ? r.props.onGround : null }));
        this.d.store.addTrackPoints(task, pts);
      }
      this.status.tasks[task] = { at, ok: true, count: records.length, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A publisher pause is already waited out by the shared backoff; other errors pause this feed for a while.
      if (!/asked to wait/.test(msg)) this.pausedUntil.set(task, now.getTime() + ERROR_PAUSE_MS);
      this.status.tasks[task] = { at: now.toISOString(), ok: false, count: 0, error: msg.slice(0, 200) };
      this.d.log?.(`[recording] ${task}: ${msg}`);
    }
    this.d.onChange();
  }

  private async collect(task: RecordTask, area: WatchArea, now: Date): Promise<GeoRecord[]> {
    if (task === 'vessels') {
      const ais = this.d.aisRecords();
      if (!ais) throw new Error('Ships need an AISStream key in Providers');
      return ais;
    }
    // Conflicts and military aircraft are worldwide lists: reuse the live layer's copy when it is already polling.
    if ((task === 'conflicts' || task === 'aircraftMil') && this.d.isLayerOn(task)) return this.d.liveRecords(task);
    const sourcesFor: LayerId = task === 'gnss' ? 'aircraft' : task;
    const adsb = this.d.sources('aircraft').backoff.get('api.adsb.lol');
    if (task !== 'conflicts' && adsb && adsb.until > now.getTime()) throw new Error(`adsb.lol asked to wait until ${new Date(adsb.until).toISOString()}`);
    const fetcher = this.d.fetchers?.[task] ?? FETCHERS[task];
    const res = await fetcher({
      view: areaView(area),
      settings: this.d.getSettings(),
      fetchJson: this.d.fetchJson,
      fetchText: this.d.fetchText,
      userAgent: this.d.userAgent(),
      store: this.d.store,
      localReceiverUrl: null,
      sources: task === 'conflicts' ? undefined : this.d.sources(sourcesFor),
      clock: () => this.now().getTime(),
      now,
    });
    if (res.failure) throw new Error(res.failure);
    // An incomplete reply with nothing in it is not "no aircraft": the area was simply not covered this time.
    if (res.incomplete && res.records.length === 0) throw new Error(res.incomplete.error);
    return res.records;
  }
}
