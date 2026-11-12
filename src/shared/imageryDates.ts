// NASA GIBS WMTS DescribeDomains lists actual available dates/ranges for one product.
// It is much smaller than GetCapabilities and retains gaps and historical end dates.
// https://nasa-gibs.github.io/gibs-api-docs/access-basics/#time-dimension
import { readCapped } from './geoSatellite';
import { MAX_DATE_MS, parseRetryAfter } from './retryAfter';

export interface ImageryDateRange {
  start: string;
  end: string;
  step: number;
  unit: 'D' | 'M' | 'Y';
}
export interface ImageryDates { ranges: ImageryDateRange[]; skipped: number; }
export interface ImageryDateProduct { id: string; tileMatrixSet: string; }
export interface ImageryDatesState {
  state: 'idle' | 'loading' | 'ready' | 'error';
  data: ImageryDates | null;
  checkedAt: string | null;
  error: string | null;
}

const DAY = 86400_000;
export const IMAGERY_DATES_TTL_MS = 60 * 60_000;
export const IMAGERY_DATES_TIMEOUT_MS = 15_000;
export const IMAGERY_DATES_MAX_BYTES = 256 * 1024;
const MAX_PRODUCTS = 32;
const MAX_RANGES = 2000;
const MIN_RETRY_MS = 60_000;
const ID = /^[A-Za-z0-9_-]{1,180}$/;
const EMPTY: ImageryDatesState = Object.freeze({ state: 'idle', data: null, checkedAt: null, error: null });

/** Strict UTC dates, rather than Date.parse's permissive rollover (e.g. February 30). */
export function validImageryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function dateToken(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}(?:T00:00:00Z)?$/.test(text) && validImageryDate(text.slice(0, 10))) return text.slice(0, 10);
  return null;
}

export function imageryDatesUrl(product: ImageryDateProduct): string {
  if (!ID.test(product.id) || !ID.test(product.tileMatrixSet)) throw new Error('Invalid imagery product');
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/${product.id}/default/${product.tileMatrixSet}/all/all.xml`;
}

/** Invalid individual periods are disclosed and skipped; no valid range is stretched across a gap. */
export function parseImageryDates(xml: string): ImageryDates {
  const bad = () => new Error('GIBS returned invalid date availability metadata');
  if (!/<Domains[\s>]/.test(xml) || !/<\/Domains>\s*$/.test(xml)) throw bad();
  const dimensions = [...xml.matchAll(/<DimensionDomain>([\s\S]*?)<\/DimensionDomain>/g)];
  const time = dimensions.find((d) => /<ows:Identifier>\s*time\s*<\/ows:Identifier>/.test(d[1]));
  const domain = time && /<Domain>([^<]*)<\/Domain>|<Domain\s*\/>/.exec(time[1]);
  if (!domain) throw bad();
  const text = (domain[1] ?? '').trim();
  if (!text) return { ranges: [], skipped: 0 };
  const items = text.split(',');
  if (items.length > MAX_RANGES) throw new Error('GIBS returned too many date ranges');
  const ranges: ImageryDateRange[] = [];
  let skipped = 0;
  for (const item of items) {
    const parts = item.trim().split('/');
    const start = dateToken(parts[0] ?? '');
    const end = parts.length === 1 ? start : dateToken(parts[1] ?? '');
    const period = parts.length === 1 ? ['P1D', '1', 'D'] : /^P([1-9]\d{0,4})([DMY])$/.exec(parts[2] ?? '');
    if ((parts.length !== 1 && parts.length !== 3) || !start || !end || start > end || !period) { skipped++; continue; }
    ranges.push({ start, end, step: Number(period[1]), unit: period[2] as 'D' | 'M' | 'Y' });
  }
  if (!ranges.length) throw bad();
  ranges.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { ranges, skipped };
}

function dateAt(range: ImageryDateRange, index: number): string {
  if (range.unit === 'D') return format(day(range.start) + index * range.step * DAY);
  const initial = new Date(day(range.start));
  const months = initial.getUTCFullYear() * 12 + initial.getUTCMonth() + index * range.step * (range.unit === 'Y' ? 12 : 1);
  const year = Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return format(Date.UTC(year, month, Math.min(initial.getUTCDate(), lastDay)));
}

function indexAt(range: ImageryDateRange, target: string): number {
  if (target <= range.start) return 0;
  if (range.unit === 'D') return Math.floor((day(target) - day(range.start)) / (range.step * DAY));
  const start = new Date(day(range.start));
  const value = new Date(day(target));
  const months = (value.getUTCFullYear() - start.getUTCFullYear()) * 12 + value.getUTCMonth() - start.getUTCMonth();
  let index = Math.floor(months / (range.step * (range.unit === 'Y' ? 12 : 1)));
  if (dateAt(range, index) > target) index--;
  return Math.max(0, index);
}

/** Date at/before or at/after target on the actual cadence, never a manufactured day inside a gap. */
export function availableImageryDate(dates: ImageryDates, target: string, direction: 'before' | 'after' | 'nearest' = 'nearest', maximum = new Date().toISOString().slice(0, 10)): string | null {
  if (!validImageryDate(target) || !validImageryDate(maximum)) return null;
  let before: string | null = null;
  let after: string | null = null;
  for (const range of dates.ranges) {
    const end = range.end < maximum ? range.end : maximum;
    if (range.start > end) continue;
    const lastIndex = indexAt(range, end);
    const index = Math.min(lastIndex, indexAt(range, target));
    const lower = dateAt(range, index);
    if (lower <= target && (!before || lower > before)) before = lower;
    const upperIndex = lower >= target ? index : index + 1;
    if (upperIndex <= lastIndex) {
      const upper = dateAt(range, upperIndex);
      if (upper >= target && (!after || upper < after)) after = upper;
    }
  }
  if (direction === 'before') return before;
  if (direction === 'after') return after;
  if (!before) return after;
  if (!after) return before;
  return day(target) - day(before) <= day(after) - day(target) ? before : after;
}

export function adjacentImageryDate(dates: ImageryDates, current: string, direction: -1 | 1, maximum?: string): string | null {
  if (!validImageryDate(current)) return null;
  return availableImageryDate(dates, format(day(current) + direction * DAY), direction < 0 ? 'before' : 'after', maximum);
}

type Entry = { value: ImageryDatesState; lastAttempt: number; nextAttempt: number; failures: number; pending?: Promise<ImageryDatesState> };

/** Small shared session cache, coalesced requests, bounded body and full-exchange timeout. */
export class ImageryDatesClient {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private version = 0;
  private sourceCooldownUntil = 0;
  private sourceFailures = 0;
  private sourceStatus: number | null = null;
  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  revision = () => this.version;
  private emit() { this.version++; for (const listener of this.listeners) listener(); }
  snapshot(product: ImageryDateProduct): ImageryDatesState { return this.entries.get(product.id)?.value ?? EMPTY; }

  load(product: ImageryDateProduct, force = false): Promise<ImageryDatesState> {
    imageryDatesUrl(product); // Validate before accepting a cache key or creating a request.
    let entry = this.entries.get(product.id);
    if (entry?.pending) return entry.pending;
    const now = this.now();
    if (!entry) {
      // Do not evict a live request: its entry will remain the sole coalescing point until completion.
      if (this.entries.size >= MAX_PRODUCTS) {
        const oldest = [...this.entries].find(([, e]) => !e.pending)?.[0];
        if (oldest) this.entries.delete(oldest);
        else return Promise.reject(new Error('Imagery availability requests are busy; try again shortly'));
      }
      entry = { value: EMPTY, lastAttempt: -Infinity, nextAttempt: 0, failures: 0 };
      this.entries.set(product.id, entry);
    }
    // Every product uses this same NASA endpoint. Switching products must not evade its cooldown.
    if (now < this.sourceCooldownUntil) {
      const error = this.pauseMessage();
      if (entry.value.state !== 'error' || entry.value.error !== error) {
        entry.value = { ...entry.value, state: 'error', error };
        entry.nextAttempt = Math.max(entry.nextAttempt, this.sourceCooldownUntil);
        this.emit();
      }
      return Promise.resolve(entry.value);
    }
    if (now < entry.nextAttempt || (!force && entry.value.state === 'ready' && entry.value.checkedAt && now - Date.parse(entry.value.checkedAt) < IMAGERY_DATES_TTL_MS)) return Promise.resolve(entry.value);
    entry.lastAttempt = now;
    entry.nextAttempt = now + MIN_RETRY_MS;
    entry.value = { ...entry.value, state: 'loading', error: null };
    const current = entry;
    current.pending = this.request(product, current).finally(() => { current.pending = undefined; });
    this.emit();
    return current.pending;
  }

  private pauseMessage(): string {
    return `NASA GIBS date checks paused until ${new Date(this.sourceCooldownUntil).toISOString().replace('T', ' ').replace('.000Z', ' UTC')} (HTTP ${this.sourceStatus})`;
  }

  private async request(product: ImageryDateProduct, entry: Entry): Promise<ImageryDatesState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGERY_DATES_TIMEOUT_MS);
    try {
      // Native Window.fetch requires its Window receiver when stored on a client object.
      const response = await this.fetchImpl.call(globalThis, imageryDatesUrl(product), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 429 || response.status === 503) {
          this.sourceFailures++;
          this.sourceStatus = response.status;
          const raw = response.headers.get('retry-after');
          const seconds = parseRetryAfter(raw, this.now());
          const until = seconds === null ? 0 : Math.min(MAX_DATE_MS, this.now() + seconds * 1000);
          const backoff = this.now() + Math.min(IMAGERY_DATES_TTL_MS, MIN_RETRY_MS * 2 ** (this.sourceFailures - 1));
          // Cap only at JavaScript's representable date limit, not before a publisher's stated deadline.
          this.sourceCooldownUntil = Math.min(MAX_DATE_MS, Math.max(this.sourceCooldownUntil, backoff, until));
          entry.nextAttempt = Math.max(entry.nextAttempt, this.sourceCooldownUntil);
        }
        await response.body?.cancel().catch(() => {});
        throw new Error(`GIBS date availability HTTP ${response.status}`);
      }
      const data = parseImageryDates(await readCapped(response, IMAGERY_DATES_MAX_BYTES, controller.signal));
      entry.value = { state: 'ready', data, checkedAt: new Date(this.now()).toISOString(), error: null };
      entry.failures = 0;
      this.sourceFailures = 0;
    } catch (error) {
      entry.failures++;
      entry.nextAttempt = Math.max(entry.nextAttempt, this.now() + Math.min(IMAGERY_DATES_TTL_MS, MIN_RETRY_MS * 2 ** (entry.failures - 1)));
      const message = this.now() < this.sourceCooldownUntil ? this.pauseMessage() : controller.signal.aborted ? 'GIBS date availability timed out' : error instanceof Error ? error.message : 'GIBS date availability failed';
      entry.value = { ...entry.value, state: 'error', error: message.slice(0, 200) };
    } finally {
      clearTimeout(timer);
      this.emit();
    }
    return entry.value;
  }
}
