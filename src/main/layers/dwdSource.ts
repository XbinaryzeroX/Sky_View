import { DWD_CAP_LIMITS, dwdStartMs, type DwdStatusResult, type DwdWarning } from '../../shared/dwd';
import { geometryBbox } from '../../shared/geo';
import { LAYERS, type GeoRecord } from '../../shared/layers';
import { staleAfterMs } from '../../shared/monitoring';
import type { Freshness } from '../../shared/types';
import { computeBackoffMs, FeedHttpError, type FetchDwdArchive } from '../feeds/http';
import { deadlineAfter } from '../feeds/timing';
import type { AtlasStore } from '../store';
import { parseDwdStatusZip } from './dwdCap';

const CACHE_KEY = 'dwd:communeunion-de-status:v1';
const PAUSE_KEY = CACHE_KEY + ':pause';
const MAX_BASE64 = 4 * Math.ceil(DWD_CAP_LIMITS.compressedBytes / 3);
const pollMs = LAYERS.dwd.pollSeconds * 1000;

interface SavedArchive {
  zip: string;
  etag: string | null;
  observedAt: string;
  checkedAt: string;
  sourceUpdatedAt: string | null;
}
interface DwdView {
  records: GeoRecord[];
  warnings: DwdWarning[];
  sourceUpdatedAt: string | null;
  checkedAt: string;
  skipped: number;
  note: string;
}

function validEtag(tag: unknown): string | null {
  return typeof tag === 'string' && tag.length <= 256 && /^(?:W\/)?"[!#-~]*"$/.test(tag) ? tag : null;
}
function utcDate(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now) return null;
  const date = new Date(time);
  return value === date.toISOString() || value === date.toUTCString() ? date.toISOString() : null;
}
function mapRecord(warning: DwdWarning): GeoRecord | null {
  if (!warning.geometry) return null;
  const [west, south, east, north] = geometryBbox(warning.geometry);
  return { id: warning.id, lat: (south + north) / 2, lon: (east + west) / 2, label: warning.headline ?? warning.event,
    altM: null, heading: null, speedKts: null, category: warning.severity, observedAt: warning.sent,
    source: warning.source, sourceUrl: warning.sourceUrl, geometry: warning.geometry,
    props: { severity: warning.severity, event: warning.event, expires: warning.expires, geometryStatus: warning.geometryStatus } };
}
export function dwdFreshness(view: DwdView, now: number): Freshness {
  if (!view.sourceUpdatedAt) return 'unavailable';
  const earlier = Math.min(Date.parse(view.checkedAt), Date.parse(view.sourceUpdatedAt));
  if (!Number.isFinite(earlier) || Date.parse(view.checkedAt) > now || Date.parse(view.sourceUpdatedAt) > now) return 'unavailable';
  return now - earlier > staleAfterMs(LAYERS.dwd.pollSeconds) ? 'stale' : 'fresh';
}

/** A single complete STATUS archive, shared by layer polling and Settings' provider test. */
export class DwdSource {
  private loaded = false;
  private saved: SavedArchive | null = null;
  private parsed: DwdStatusResult | null = null;
  private view: DwdView | null = null;
  private nextTransition = 0;
  private viewTime = 0;
  private nextRequest = 0;
  private lastError: Error | null = null;
  private skipValidators = false;
  private pending: Promise<DwdView> | null = null;
  private cacheNote = '';
  constructor(private store: Pick<AtlasStore, 'getMeta' | 'setMeta' | 'deleteMeta'>, private download: FetchDwdArchive,
    private userAgent: () => string, private now: () => Date) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const now = this.now().getTime();
      const pause = Number(this.store.getMeta(PAUSE_KEY));
      if (pause > now && Number.isSafeInteger(pause) && pause <= 8.64e15) {
        this.nextRequest = pause;
        this.lastError = new FeedHttpError('DWD requested a pause before retrying', null, Math.ceil((pause - now) / 1000), 'http');
      }
      const raw = this.store.getMeta(CACHE_KEY);
      if (!raw) return;
      if (raw.length > MAX_BASE64 + 2048) throw new Error('cache size');
      const saved: SavedArchive = JSON.parse(raw);
      if (!saved || typeof saved.zip !== 'string' || saved.zip.length > MAX_BASE64 ||
          utcDate(saved.observedAt, now) !== saved.observedAt || !saved.observedAt ||
          utcDate(saved.checkedAt, now) !== saved.checkedAt || !saved.checkedAt || saved.checkedAt < saved.observedAt ||
          (saved.sourceUpdatedAt !== null && utcDate(saved.sourceUpdatedAt, Date.parse(saved.observedAt)) !== saved.sourceUpdatedAt)) throw new Error('cache metadata');
      const bytes = Buffer.from(saved.zip, 'base64');
      if (bytes.toString('base64') !== saved.zip) throw new Error('cache encoding');
      const parsed = parseDwdStatusZip(bytes, { observedAt: saved.observedAt, sourceUpdatedAt: saved.sourceUpdatedAt });
      if (parsed.completeness !== 'complete') throw new Error('incomplete cache');
      this.saved = { ...saved, etag: validEtag(saved.etag) };
      this.parsed = parsed;
      // After restart check the publisher immediately, subject to any publisher pause.
    } catch {
      this.cacheNote = 'The previous local DWD snapshot could not be read.';
    }
  }

  /** Apply validity times even during an outage. Named areas remain in the list when DWD supplies no polygon. */
  current(): DwdView | null {
    this.load();
    if (!this.saved || !this.parsed) return null;
    const now = this.now().getTime();
    if (this.view && now >= this.viewTime && now < this.nextTransition) return this.view;
    this.viewTime = now;
    this.nextTransition = Infinity;
    const warnings: DwdWarning[] = [];
    const records: GeoRecord[] = [];
    for (const original of this.parsed.warnings) {
      const expires = original.expires ? Date.parse(original.expires) : Infinity;
      if (expires <= now) continue;
      this.nextTransition = Math.min(this.nextTransition, expires);
      const start = dwdStartMs(original.onset, original.effective);
      if (start > now) this.nextTransition = Math.min(this.nextTransition, start);
      const warning = original.timing === 'upcoming' && start <= now ? { ...original, timing: 'active' as const } : original;
      warnings.push(warning);
      const record = mapRecord(warning);
      if (record) records.push(record);
    }
    const partial = warnings.filter(w => w.geometryStatus === 'partial').length;
    const note = [
      `DWD STATUS received ${this.saved.observedAt}. ${warnings.length} unexpired or open-ended bulletins, ${records.length} with map geometry.`,
      partial ? `${partial} with partial geometry.` : '',
      this.saved.sourceUpdatedAt ? '' : 'Publisher update time unavailable.',
      this.cacheNote,
    ].filter(Boolean).join(' ');
    return this.view = { warnings, records, note, skipped: this.parsed.skipped, checkedAt: this.saved.checkedAt, sourceUpdatedAt: this.saved.sourceUpdatedAt };
  }

  refresh(): Promise<DwdView> {
    this.load();
    if (this.pending) return this.pending;
    const now = this.now().getTime();
    if (now < this.nextRequest) {
      if (this.lastError) {
        if (this.lastError instanceof FeedHttpError && this.lastError.retryAfterSec !== null) {
          return Promise.reject(new FeedHttpError(this.lastError.message, this.lastError.status, (this.nextRequest - now) / 1000, this.lastError.kind));
        }
        return Promise.reject(this.lastError);
      }
      const current = this.current();
      if (current) return Promise.resolve(current);
    }
    this.pending = this.request().catch((err: unknown) => {
      const pause = err instanceof FeedHttpError && (err.retryAfterSec !== null || err.status === 429 || err.status === 503);
      const delay = pause ? computeBackoffMs(1, err.retryAfterSec ?? 60) : 30_000;
      this.nextRequest = deadlineAfter(this.now().getTime(), delay);
      this.lastError = err instanceof Error ? err : new Error(String(err));
      if (pause) {
        try { this.store.setMeta(PAUSE_KEY, String(this.nextRequest)); } catch { /* In-memory cooldown still applies. */ }
      }
      throw this.lastError;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  /** Local repaint deadline. Polling and publisher retry deadlines are independent of CAP validity. */
  nextDisplayChange(now: number): number {
    if (!this.view) return Infinity;
    const freshnessDeadline = Math.min(Date.parse(this.view.checkedAt), Date.parse(this.view.sourceUpdatedAt ?? ''))
      + staleAfterMs(LAYERS.dwd.pollSeconds) + 1;
    return Math.min(this.nextTransition, freshnessDeadline > now ? freshnessDeadline : Infinity);
  }

  private async request(): Promise<DwdView> {
    const headers: Record<string, string> = { 'User-Agent': this.userAgent(), Accept: 'application/zip' };
    if (this.saved && !this.skipValidators) {
      if (this.saved.etag) headers['If-None-Match'] = this.saved.etag;
      if (this.saved.sourceUpdatedAt) headers['If-Modified-Since'] = new Date(this.saved.sourceUpdatedAt).toUTCString();
    }
    const reply = await this.download(headers);
    const now = this.now();
    const at = now.toISOString();
    const tag = validEtag(reply.etag);
    const sourceUpdatedAt = utcDate(reply.lastModified, now.getTime());
    if (reply.status === 304) {
      if (!this.saved || !this.parsed || !(headers['If-None-Match'] || headers['If-Modified-Since']) ||
          (reply.etag && this.saved.etag && tag !== this.saved.etag) ||
          (sourceUpdatedAt && this.saved.sourceUpdatedAt && sourceUpdatedAt !== this.saved.sourceUpdatedAt)) {
        this.skipValidators = true;
        throw new Error('DWD returned 304 without a matching complete local archive. The next request will fetch a full copy.');
      }
      this.saved = { ...this.saved, checkedAt: at };
    } else {
      if (!reply.bytes) throw new Error('DWD supplied no STATUS archive.');
      const parsed = parseDwdStatusZip(reply.bytes, { observedAt: at, sourceUpdatedAt });
      if (parsed.completeness !== 'complete') throw new Error(`Incomplete DWD STATUS archive (${parsed.skipped} skipped). ${parsed.notes[0] ?? ''}`.trim());
      if (this.saved?.sourceUpdatedAt && sourceUpdatedAt && sourceUpdatedAt < this.saved.sourceUpdatedAt) throw new Error('DWD returned an older STATUS archive. Keeping the previous snapshot.');
      this.parsed = parsed;
      this.saved = { zip: Buffer.from(reply.bytes).toString('base64'), observedAt: at, checkedAt: at, sourceUpdatedAt, etag: tag };
    }
    this.skipValidators = false;
    this.view = null;
    this.cacheNote = '';
    try {
      this.store.setMeta(CACHE_KEY, JSON.stringify(this.saved));
      this.store.deleteMeta(PAUSE_KEY);
    } catch { this.cacheNote = 'This snapshot could not be saved for restart.'; }
    this.nextRequest = now.getTime() + pollMs;
    this.lastError = null;
    return this.current()!;
  }
}
