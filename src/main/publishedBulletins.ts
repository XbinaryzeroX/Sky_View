import { FeedHttpError } from './feeds/http';
import { deadlineAfter } from './feeds/timing';
import type { AtlasStore } from './store';

interface BulletinCache<T> {
  checkedAt: string | null;
  items: T[];
  nextCheckAt: string;
  error: string | null;
}

type BulletinOptions<T> = {
  store: Pick<AtlasStore, 'getMeta' | 'setMeta'>;
  key: string;
  load(): Promise<T[]>;
  validate(value: unknown): T[] | null;
  refreshMs: number;
  now?: () => number;
};

/** Refresh on read, share overlapping reads, and retain the last successful publication list and retry deadline. */
export function createBulletinReader<T>({ store, key, load, validate, refreshMs, now = Date.now }: BulletinOptions<T>) {
  let cache: BulletinCache<T> | undefined;
  let pending: Promise<BulletinCache<T>> | undefined;
  function restore(): BulletinCache<T> {
    const raw = store.getMeta(key);
    if (raw && raw.length <= 1024 * 1024) {
      try {
        const row = JSON.parse(raw);
        const items = validate(row.items);
        if (items && (row.checkedAt === null || (typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt)))) &&
          typeof row.nextCheckAt === 'string' && Number.isFinite(Date.parse(row.nextCheckAt)) && (row.error === null || typeof row.error === 'string') &&
          (row.checkedAt !== null || !items.length)) {
          return { items, checkedAt: row.checkedAt, nextCheckAt: row.nextCheckAt, error: row.error };
        }
      } catch { /* Unreadable prior state can be replaced by a fresh publisher response. */ }
    }
    return { items: [], checkedAt: null, nextCheckAt: new Date(0).toISOString(), error: null };
  }
  async function refresh(previous: BulletinCache<T>): Promise<BulletinCache<T>> {
    let next: BulletinCache<T>;
    try {
      const items = await load();
      const time = now();
      next = { items, checkedAt: new Date(time).toISOString(), nextCheckAt: new Date(deadlineAfter(time, refreshMs)).toISOString(), error: null };
    } catch (e) {
      const delayMs = Math.max(300_000, e instanceof FeedHttpError && e.retryAfterSec !== null ? 1000 * e.retryAfterSec : 0);
      const message = e instanceof Error ? e.message.slice(0, 220) : 'The publisher request failed.';
      next = { ...previous, nextCheckAt: new Date(deadlineAfter(now(), delayMs)).toISOString(), error: message };
    }
    store.setMeta(key, JSON.stringify(next));
    cache = next;
    return next;
  }
  return (): Promise<BulletinCache<T>> => {
    cache ??= restore();
    if (Date.parse(cache.nextCheckAt) > now()) return Promise.resolve(cache);
    pending ??= refresh(cache).finally(() => { pending = undefined; });
    return pending;
  };
}
