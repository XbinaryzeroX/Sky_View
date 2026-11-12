// Optional AISStream.io client (customer API key). One WebSocket at a time,
// subscribed to the current view's bounding box; reconnects with backoff.
// The key is read from the OS credential store and never leaves this process.

import { isValidLat, isValidLon } from '../../shared/geo';
import type { GeoRecord } from '../../shared/layers';
import { cleanText, toIso } from '../../shared/normalize';
import { aisCog, aisDimensions, aisHeading, aisSog, formatEta, shipTypeLabel, type VesselStatic } from '../../shared/layerNormalize';

const URL_AIS = 'wss://stream.aisstream.io/v0/stream';
const TTL_MS = 60 * 60_000;
const STATIC_TTL_MS = 24 * 60 * 60_000;
const MAX_VESSELS = 20000;
const SUBSCRIPTION_INTERVAL_MS = 1000;

export interface AisStatus {
  connected: boolean;
  lastMessageAt: string | null;
  error: string | null;
  vessels: number;
}

type WS = { binaryType?: string; send(d: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onclose: ((e: { code?: number; reason?: string }) => void) | null };

export class AisStreamClient {
  private ws: WS | null = null;
  private bbox: [number, number, number, number] | null = null;
  private vessels = new Map<string, GeoRecord>();
  /** Static/voyage data (message 5 / 24) keyed by MMSI, merged into positions. */
  private statics = new Map<string, { data: VesselStatic; receivedAt: number; sourceAt: number }>();
  private retryMs = 5000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedBbox: [number, number, number, number] | null = null;
  private lastSubscriptionAt = -Infinity;
  private lastPruneAt = -Infinity;
  private stopped = true;
  status: AisStatus = { connected: false, lastMessageAt: null, error: null, vessels: 0 };

  constructor(
    private readonly getKey: () => string | null,
    private readonly onChange: () => void,
    private readonly makeSocket: (url: string) => WS = (u) => new (globalThis as unknown as { WebSocket: new (u: string) => WS }).WebSocket(u),
  ) {}

  start(bbox: [number, number, number, number]): void {
    const [w, s, e, n] = bbox;
    if (!isValidLon(w) || !isValidLon(e) || !isValidLat(s) || !isValidLat(n) || s > n) return;
    this.stopped = false;
    this.bbox = [...bbox];
    // View updates must not bypass a pending reconnect backoff.
    if (!this.ws && !this.retryTimer) this.connect();
    else if (!this.subscribedBbox || bbox.some((v, i) => Math.abs(v - this.subscribedBbox![i]) > 0.05)) this.subscribe();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.cancelSubscription();
    const ws = this.ws;
    this.ws = null;
    // Delayed close/open events from this socket cannot affect a later connection.
    ws?.close();
    this.status = { ...this.status, connected: false };
  }

  records(now: number): GeoRecord[] {
    this.prune(now);
    this.status.vessels = this.vessels.size;
    return [...this.vessels.values()];
  }

  private prune(now: number): void {
    for (const [k, v] of this.vessels) if (now - Date.parse(v.observedAt ?? '') > TTL_MS) this.vessels.delete(k);
    for (const [k, v] of this.statics) if (now - v.receivedAt > STATIC_TTL_MS) this.statics.delete(k);
    this.lastPruneAt = now;
  }

  private cancelSubscription(): void {
    if (this.subscriptionTimer) clearTimeout(this.subscriptionTimer);
    this.subscriptionTimer = null;
    this.subscribedBbox = null;
    this.lastSubscriptionAt = -Infinity;
  }

  private subscribe(): void {
    const key = this.getKey();
    if (!this.ws || !this.status.connected || this.stopped || !key || !this.bbox) return;
    // AISStream closes connections when subscriptions are replaced more than once per second.
    // Keep only the latest view while the replacement is waiting.
    const delay = this.lastSubscriptionAt + SUBSCRIPTION_INTERVAL_MS - Date.now();
    if (delay > 0) {
      if (!this.subscriptionTimer) this.subscriptionTimer = setTimeout(() => {
        this.subscriptionTimer = null;
        this.subscribe();
      }, delay);
      return;
    }
    const [w, s, e, n] = this.bbox;
    const boxes = w <= e ? [[[s, w], [n, e]]] : [[[s, w], [n, 180]], [[s, -180], [n, e]]];
    try {
      this.ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: boxes, FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport'] }));
      this.lastSubscriptionAt = Date.now();
      this.subscribedBbox = [...this.bbox];
    } catch {
      this.status.error = 'AISStream subscription could not be sent';
      this.ws.close();
    }
  }

  private connect(): void {
    if (this.stopped || this.ws) return;
    const key = this.getKey();
    if (!key) {
      this.status = { ...this.status, connected: false, error: 'No AISStream key configured' };
      return;
    }
    let ws: WS;
    try {
      ws = this.makeSocket(URL_AIS);
    } catch {
      this.status.error = 'AISStream connection could not be opened';
      this.onChange();
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    // The provider sends binary UTF-8 JSON. Node's default Blob cannot be passed to Buffer.from.
    ws.binaryType = 'arraybuffer';
    const active = () => this.ws === ws && !this.stopped;
    ws.onopen = () => {
      if (!active()) return;
      this.status = { ...this.status, connected: true, error: null };
      // A WebSocket handshake alone does not mean the API key/subscription was accepted.
      // Keep failure backoff until a usable AIS report actually arrives.
      this.subscribe();
      this.onChange();
    };
    ws.onmessage = (ev) => {
      if (!active()) return;
      try {
        this.handle(JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString('utf8')));
      } catch {
        // ignore malformed message
      }
    };
    ws.onerror = () => {
      if (!active()) return;
      this.status.error = 'AISStream connection error (check the API key)';
      this.onChange();
    };
    ws.onclose = (e) => {
      if (!active()) return;
      this.ws = null;
      this.cancelSubscription();
      this.status = { ...this.status, connected: false, error: this.status.error ?? (e?.reason ? cleanText(e.reason, 200) : `Connection closed (${e?.code ?? '?'})`) };
      this.onChange();
      if (!this.stopped) this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.stopped) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5 * 60_000);
  }

  /** Exposed for tests. */
  handle(msg: unknown): void {
    const m = msg as { MessageType?: unknown; MetaData?: Record<string, unknown>; Message?: Record<string, Record<string, unknown>>; error?: unknown };
    if (typeof m?.error === 'string') {
      this.status.error = cleanText(m.error, 200);
      return;
    }
    const meta = m?.MetaData ?? {};
    const mmsi = typeof meta.MMSI === 'number' && Number.isInteger(meta.MMSI) && meta.MMSI > 0 && meta.MMSI <= 999999999 ? meta.MMSI : null;
    if (mmsi === null) return;
    const id = String(mmsi);
    const type = m.MessageType;
    const body = typeof type === 'string' ? m.Message?.[type] : undefined;
    if (!body || typeof body !== 'object' || body.Valid === false) return;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    if (nowMs - this.lastPruneAt >= 60_000) this.prune(nowMs);
    const reportedAt = toIso(typeof meta.time_utc === 'string' ? meta.time_utc.replace(' +0000 UTC', 'Z').replace(' ', 'T') : null);
    const sourceAt = reportedAt ? Date.parse(reportedAt) : nowMs;
    // A future report must not pin an object in the cache or suppress later real updates.
    if (sourceAt > nowMs + 5 * 60_000) return;
    this.status.lastMessageAt = now;
    const existing = this.vessels.get(id);
    if (type === 'ShipStaticData' || type === 'StaticDataReport') {
      const cached = this.statics.get(id);
      if (cached && sourceAt < cached.sourceAt) return;
      const prev = cached?.data ?? { name: null, shipType: null, destination: null, callSign: null };
      let st: VesselStatic = prev;
      if (type === 'ShipStaticData') {
        const dim = (body.Dimension ?? {}) as Record<string, unknown>;
        const eta = (body.Eta ?? {}) as Record<string, unknown>;
        st = {
          ...prev,
          name: cleanText(body.Name, 60) ?? prev.name,
          shipType: typeof body.Type === 'number' ? body.Type : prev.shipType,
          destination: cleanText(body.Destination, 40) ?? prev.destination,
          callSign: cleanText(body.CallSign, 12) ?? prev.callSign,
          imo: typeof body.ImoNumber === 'number' && body.ImoNumber > 0 ? body.ImoNumber : (prev.imo ?? null),
          draughtM: typeof body.MaximumStaticDraught === 'number' && body.MaximumStaticDraught > 0 ? body.MaximumStaticDraught : (prev.draughtM ?? null),
          etaText: formatEta(Number(eta.Month) || 0, Number(eta.Day) || 0, Number(eta.Hour ?? 24), Number(eta.Minute ?? 60)) ?? prev.etaText ?? null,
          ...(body.Dimension ? aisDimensions(dim.A, dim.B, dim.C, dim.D) : {}),
        };
      } else {
        const a = (body.ReportA ?? {}) as Record<string, unknown>;
        const b = (body.ReportB ?? {}) as Record<string, unknown>;
        const dim = (b.Dimension ?? {}) as Record<string, unknown>;
        const validB = body.ReportB != null && b.Valid !== false;
        st = {
          ...prev,
          name: (a.Valid !== false ? cleanText(a.Name, 60) : null) ?? prev.name,
          shipType: validB && typeof b.ShipType === 'number' ? b.ShipType : prev.shipType,
          callSign: (validB ? cleanText(b.CallSign, 12) : null) ?? prev.callSign,
          ...(validB && b.Dimension ? aisDimensions(dim.A, dim.B, dim.C, dim.D) : {}),
        };
      }
      // Retain useful metadata without allowing a worldwide subscription to grow forever.
      this.statics.delete(id);
      if (this.statics.size >= MAX_VESSELS) this.statics.delete(this.statics.keys().next().value!);
      this.statics.set(id, { data: st, receivedAt: nowMs, sourceAt });
      if (existing) this.vessels.set(id, this.withStatic(existing, st));
      this.retryMs = 5000;
      return;
    }
    if (type !== 'PositionReport' && type !== 'StandardClassBPositionReport' && type !== 'ExtendedClassBPositionReport') return;
    if (nowMs - sourceAt > TTL_MS || (existing && sourceAt <= Date.parse(existing.observedAt ?? ''))) return;
    const lat = body.Latitude;
    const lon = body.Longitude;
    if (!isValidLat(lat) || !isValidLon(lon)) return;
    if (!existing && this.vessels.size >= MAX_VESSELS) return;
    const hdg = aisHeading(body.TrueHeading) ?? aisCog(body.Cog);
    const rec: GeoRecord = {
      id,
      lat,
      lon,
      altM: null,
      heading: hdg,
      speedKts: aisSog(body.Sog),
      label: cleanText(meta.ShipName, 60) ?? existing?.label ?? `MMSI ${mmsi}`,
      category: existing?.category ?? null,
      observedAt: reportedAt ?? now,
      sourceUrl: 'https://aisstream.io/',
      source: 'AISStream.io (customer key)',
      props: { mmsi, courseDeg: aisCog(body.Cog), headingDeg: aisHeading(body.TrueHeading), navStatus: typeof body.NavigationalStatus === 'number' ? body.NavigationalStatus : null },
    };
    const st = this.statics.get(id);
    this.vessels.set(id, st ? this.withStatic(rec, st.data) : rec);
    this.retryMs = 5000;
  }

  private withStatic(r: GeoRecord, st: VesselStatic): GeoRecord {
    return {
      ...r,
      label: st.name ?? r.label,
      category: shipTypeLabel(st.shipType) ?? r.category,
      props: { ...r.props, imo: st.imo ?? null, callSign: st.callSign, destinationReported: st.destination, etaReported: st.etaText ?? null, shipType: st.shipType, lengthM: st.lengthM ?? null, beamM: st.beamM ?? null, draughtM: st.draughtM ?? null },
    };
  }
}
