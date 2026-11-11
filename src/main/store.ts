// Local persistence using Node's built-in SQLite (node:sqlite), which ships
// with Electron. No native add-ons to rebuild. Writes are synchronous and
// transactional; the database lives in the user's app-data folder.

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from '../shared/ipc';
import type {
  Earthquake,
  HistoryPage,
  HistoryQuery,
  HistoryRecord,
  HistoryRecordDetail,
  LocationInput,
  LocationZones,
  SavedLocation,
  Settings,
  WeatherAlert,
} from '../shared/types';

const SCHEMA_VERSION = 1;

export interface FeedCacheEntry<T> {
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  payload: T;
}

type Row = Record<string, unknown>;
export type DocTable = 'annotations' | 'saved_views' | 'boards' | 'people';

function rowToHistory(r: Row): HistoryRecord {
  return {
    key: String(r.key),
    kind: r.kind as HistoryRecord['kind'],
    sourceId: String(r.source_id),
    title: String(r.title),
    severity: (r.severity as string | null) ?? null,
    magnitude: (r.magnitude as number | null) ?? null,
    eventTime: (r.event_time as string | null) ?? null,
    sourceUpdated: (r.source_updated as string | null) ?? null,
    firstObservedAt: String(r.first_observed),
    lastObservedAt: String(r.last_observed),
    supersededBy: (r.superseded_by as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lon: (r.lon as number | null) ?? null,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class AtlasStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feed_cache (
        feed TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        source_updated_at TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT,
        magnitude REAL,
        event_time TEXT,
        source_updated TEXT,
        first_observed TEXT NOT NULL,
        last_observed TEXT NOT NULL,
        superseded_by TEXT,
        source_url TEXT,
        lat REAL,
        lon REAL,
        search TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_last_observed ON events(last_observed);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, source_id);
      CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saved_views (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS track_points (
        layer TEXT NOT NULL, rid TEXT NOT NULL, t TEXT NOT NULL,
        lat REAL NOT NULL, lon REAL NOT NULL, alt REAL, heading REAL, ground INTEGER,
        PRIMARY KEY (layer, rid, t)
      );
      CREATE INDEX IF NOT EXISTS idx_track_t ON track_points(t);
    `);
    // Added later: whether an aircraft was reported on the ground (1/0); NULL for older rows and other layers.
    const cols = this.db.prepare('PRAGMA table_info(track_points)').all() as Row[];
    if (!cols.some((c) => c.name === 'ground')) this.db.exec('ALTER TABLE track_points ADD COLUMN ground INTEGER');
    this.db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- generic meta ----------
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteMeta(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }

  // ---------- annotations & saved views (JSON documents) ----------
  listDocs<T>(table: DocTable): T[] {
    return (this.db.prepare(`SELECT data FROM ${table} ORDER BY created_at, id`).all() as Row[]).map((r) => JSON.parse(String(r.data)) as T);
  }

  putDoc(table: DocTable, id: string, data: unknown, createdAt: string): void {
    this.db.prepare(`INSERT INTO ${table}(id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(data), createdAt);
  }

  deleteDoc(table: DocTable, id: string): boolean {
    return Number(this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes) > 0;
  }

  // ---------- recorded track points (observed positions only) ----------
  addTrackPoints(layer: string, pts: { rid: string; t: string; lat: number; lon: number; alt: number | null; heading: number | null; ground?: boolean | null }[]): number {
    if (pts.length === 0) return 0;
    return this.tx(() => {
      const ins = this.db.prepare('INSERT OR IGNORE INTO track_points(layer, rid, t, lat, lon, alt, heading, ground) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      let n = 0;
      for (const p of pts) n += Number(ins.run(layer, p.rid, p.t, p.lat, p.lon, p.alt, p.heading, typeof p.ground === 'boolean' ? (p.ground ? 1 : 0) : null).changes);
      return n;
    });
  }

  trackFor(layer: string, rid: string, limit = 2000): { t: string; lat: number; lon: number; altM: number | null; heading: number | null; onGround: boolean | null }[] {
    return (this.db.prepare('SELECT t, lat, lon, alt, heading, ground FROM track_points WHERE layer = ? AND rid = ? ORDER BY t DESC LIMIT ?').all(layer, rid, limit) as Row[])
      .map((r) => ({ t: String(r.t), lat: Number(r.lat), lon: Number(r.lon), altM: (r.alt as number | null) ?? null, heading: (r.heading as number | null) ?? null, onGround: r.ground === 1 ? true : r.ground === 0 ? false : null }))
      .reverse();
  }

  trackRange(): { oldest: string | null; newest: string | null; points: number } {
    const r = this.db.prepare('SELECT MIN(t) AS o, MAX(t) AS n, COUNT(*) AS c FROM track_points').get() as Row;
    return { oldest: (r.o as string | null) ?? null, newest: (r.n as string | null) ?? null, points: Number(r.c) };
  }

  /** Latest recorded fix per object at or before `t`, no older than `windowMs`. */
  trackSnapshot(layer: string, t: string, windowMs: number): { rid: string; t: string; lat: number; lon: number; altM: number | null; heading: number | null; onGround: boolean | null }[] {
    const from = new Date(Date.parse(t) - windowMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT p.rid, p.t, p.lat, p.lon, p.alt, p.heading, p.ground FROM track_points p
         JOIN (SELECT rid, MAX(t) AS mt FROM track_points WHERE layer = ? AND t <= ? AND t >= ? GROUP BY rid) m
         ON p.rid = m.rid AND p.t = m.mt WHERE p.layer = ?`,
      )
      .all(layer, t, from, layer) as Row[];
    return rows.map((r) => ({ rid: String(r.rid), t: String(r.t), lat: Number(r.lat), lon: Number(r.lon), altM: (r.alt as number | null) ?? null, heading: (r.heading as number | null) ?? null, onGround: r.ground === 1 ? true : r.ground === 0 ? false : null }));
  }

  pruneTracks(retentionHours: number, maxPoints: number, now: Date): number {
    const cutoff = new Date(now.getTime() - retentionHours * 3600_000).toISOString();
    let removed = Number(this.db.prepare('DELETE FROM track_points WHERE t < ?').run(cutoff).changes);
    const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM track_points').get() as Row).n);
    if (count > maxPoints) {
      removed += Number(this.db.prepare('DELETE FROM track_points WHERE rowid IN (SELECT rowid FROM track_points ORDER BY t ASC LIMIT ?)').run(count - maxPoints).changes);
    }
    return removed;
  }

  // ---------- settings ----------
  getSettings(): Settings {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('settings') as Row | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(String(row.value)) as Partial<Settings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(s: Settings): void {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('settings', JSON.stringify(s));
  }

  // ---------- locations ----------
  listLocations(): SavedLocation[] {
    const rows = this.db.prepare('SELECT data FROM locations ORDER BY created_at, id').all() as Row[];
    const out: SavedLocation[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(String(r.data)) as SavedLocation);
      } catch {
        // skip corrupt row
      }
    }
    return out;
  }

  getLocation(id: string): SavedLocation | null {
    const r = this.db.prepare('SELECT data FROM locations WHERE id = ?').get(id) as Row | undefined;
    return r ? (JSON.parse(String(r.data)) as SavedLocation) : null;
  }

  private writeLocation(loc: SavedLocation): void {
    this.db
      .prepare('INSERT INTO locations(id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(loc.id, JSON.stringify(loc), loc.createdAt);
  }

  createLocation(input: LocationInput, now: string, zones: LocationZones): SavedLocation {
    const loc: SavedLocation = {
      id: randomUUID(),
      name: input.name.trim(),
      category: input.category.trim(),
      notes: input.notes,
      lat: input.lat,
      lon: input.lon,
      radiusKm: input.radiusKm,
      createdAt: now,
      updatedAt: now,
      zones,
    };
    this.writeLocation(loc);
    return loc;
  }

  updateLocation(id: string, input: LocationInput, now: string, zonesIfMoved: LocationZones): SavedLocation | null {
    const existing = this.getLocation(id);
    if (!existing) return null;
    const moved = existing.lat !== input.lat || existing.lon !== input.lon;
    const loc: SavedLocation = {
      ...existing,
      name: input.name.trim(),
      category: input.category.trim(),
      notes: input.notes,
      lat: input.lat,
      lon: input.lon,
      radiusKm: input.radiusKm,
      updatedAt: now,
      zones: moved ? zonesIfMoved : existing.zones,
    };
    this.writeLocation(loc);
    return loc;
  }

  setLocationZones(id: string, zones: LocationZones): SavedLocation | null {
    const existing = this.getLocation(id);
    if (!existing) return null;
    const loc = { ...existing, zones };
    this.writeLocation(loc);
    return loc;
  }

  deleteLocation(id: string): boolean {
    const r = this.db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    return Number(r.changes) > 0;
  }

  importLocations(
    items: { input: LocationInput; action: 'create' | 'update'; targetId: string | null }[],
    now: string,
    zones: LocationZones,
  ): { created: number; updated: number; skipped: number } {
    return this.tx(() => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const item of items) {
        if (item.action === 'update' && item.targetId) {
          if (this.updateLocation(item.targetId, item.input, now, zones)) updated++;
          else skipped++;
        } else {
          this.createLocation(item.input, now, zones);
          created++;
        }
      }
      return { created, updated, skipped };
    });
  }

  // ---------- feed cache ----------
  getFeedCache<T>(feed: string): FeedCacheEntry<T> | null {
    const r = this.db.prepare('SELECT fetched_at, source_updated_at, payload FROM feed_cache WHERE feed = ?').get(feed) as Row | undefined;
    if (!r) return null;
    try {
      return { fetchedAt: String(r.fetched_at), sourceUpdatedAt: (r.source_updated_at as string | null) ?? null, payload: JSON.parse(String(r.payload)) as T };
    } catch {
      return null;
    }
  }

  setFeedCache<T>(feed: string, entry: FeedCacheEntry<T>): void {
    this.db
      .prepare(
        'INSERT INTO feed_cache(feed, fetched_at, source_updated_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(feed) DO UPDATE SET fetched_at = excluded.fetched_at, source_updated_at = excluded.source_updated_at, payload = excluded.payload',
      )
      .run(feed, entry.fetchedAt, entry.sourceUpdatedAt, JSON.stringify(entry.payload));
  }

  // ---------- event history ----------
  private upsertEvent(e: {
    key: string;
    kind: string;
    sourceId: string;
    title: string;
    severity: string | null;
    magnitude: number | null;
    eventTime: string | null;
    sourceUpdated: string | null;
    firstObserved: string;
    lastObserved: string;
    sourceUrl: string | null;
    lat: number | null;
    lon: number | null;
    search: string;
    payload: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO events(key, kind, source_id, title, severity, magnitude, event_time, source_updated, first_observed, last_observed, superseded_by, source_url, lat, lon, search, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           title = excluded.title, severity = excluded.severity, magnitude = excluded.magnitude,
           event_time = excluded.event_time, source_updated = excluded.source_updated,
           last_observed = excluded.last_observed, source_url = excluded.source_url,
           lat = excluded.lat, lon = excluded.lon, search = excluded.search, payload = excluded.payload,
           first_observed = MIN(events.first_observed, excluded.first_observed)`,
      )
      .run(
        e.key,
        e.kind,
        e.sourceId,
        e.title,
        e.severity,
        e.magnitude,
        e.eventTime,
        e.sourceUpdated,
        e.firstObserved,
        e.lastObserved,
        e.sourceUrl,
        e.lat,
        e.lon,
        e.search,
        e.payload,
      );
  }

  /** Records alerts observed in a refresh. Older revisions referenced by newer alerts are marked superseded. */
  ingestAlerts(alerts: WeatherAlert[], observedAt: string): void {
    this.tx(() => {
      for (const a of alerts) {
        const center = a.bbox ? { lat: (a.bbox[1] + a.bbox[3]) / 2, lon: ((a.bbox[0] + a.bbox[2]) / 2 + 540) % 360 - 180 } : null;
        this.upsertEvent({
          key: `alert:${a.id}`,
          kind: 'alert',
          sourceId: a.id,
          title: a.headline ?? a.event,
          severity: a.severity,
          magnitude: null,
          eventTime: a.onset ?? a.effective ?? a.sent,
          sourceUpdated: a.sent,
          firstObserved: observedAt,
          lastObserved: observedAt,
          sourceUrl: a.sourceUrl,
          lat: center?.lat ?? null,
          lon: center?.lon ?? null,
          search: `${a.event} ${a.headline ?? ''} ${a.areaDesc ?? ''} ${a.senderName ?? ''} ${a.id}`.toLowerCase(),
          payload: JSON.stringify(a),
        });
      }
      const mark = this.db.prepare('UPDATE events SET superseded_by = ? WHERE key = ? AND (superseded_by IS NULL OR superseded_by != ?)');
      for (const a of alerts) {
        for (const ref of a.references) if (ref !== a.id) mark.run(a.id, `alert:${ref}`, a.id);
      }
    });
  }

  /** Records earthquakes. Records sharing an associated id are merged into the preferred id. */
  ingestQuakes(quakes: Earthquake[], observedAt: string): void {
    this.tx(() => {
      const findAlias = this.db.prepare("SELECT key, first_observed FROM events WHERE kind = 'quake' AND source_id = ?");
      const del = this.db.prepare('DELETE FROM events WHERE key = ?');
      for (const q of quakes) {
        let firstObserved = observedAt;
        for (const alias of q.ids) {
          if (alias === q.id) continue;
          const r = findAlias.get(alias) as Row | undefined;
          if (r) {
            if (String(r.first_observed) < firstObserved) firstObserved = String(r.first_observed);
            del.run(String(r.key));
          }
        }
        this.upsertEvent({
          key: `quake:${q.id}`,
          kind: 'quake',
          sourceId: q.id,
          title: q.title ?? `M${q.mag ?? '?'} ${q.place ?? ''}`.trim(),
          severity: null,
          magnitude: q.mag,
          eventTime: q.time,
          sourceUpdated: q.updated,
          firstObserved,
          lastObserved: observedAt,
          sourceUrl: q.url,
          lat: q.lat,
          lon: q.lon,
          search: `${q.title ?? ''} ${q.place ?? ''} ${q.id} ${q.ids.join(' ')}`.toLowerCase(),
          payload: JSON.stringify(q),
        });
      }
    });
  }

  queryHistory(q: HistoryQuery): HistoryPage {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.kind && q.kind !== 'all') {
      where.push('kind = ?');
      params.push(q.kind);
    }
    if (q.severity && q.severity !== 'all') {
      where.push('severity = ?');
      params.push(q.severity);
    }
    if (typeof q.minMagnitude === 'number') {
      where.push("(kind != 'quake' OR magnitude >= ?)");
      params.push(q.minMagnitude);
    }
    if (q.since) {
      where.push('last_observed >= ?');
      params.push(q.since);
    }
    if (!q.includeSuperseded) where.push('superseded_by IS NULL');
    if (q.text && q.text.trim()) {
      where.push("search LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(q.text.trim().toLowerCase())}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = q.limit ?? 100;
    const offset = q.offset ?? 0;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...params) as Row).n);
    const rows = this.db
      .prepare(
        `SELECT key, kind, source_id, title, severity, magnitude, event_time, source_updated, first_observed, last_observed, superseded_by, source_url, lat, lon
         FROM events ${clause} ORDER BY COALESCE(source_updated, event_time, last_observed) DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[];
    const stats = this.db.prepare('SELECT COUNT(*) AS n, MIN(first_observed) AS oldest FROM events').get() as Row;
    return {
      records: rows.map(rowToHistory),
      total,
      storedTotal: Number(stats.n),
      oldestObservedAt: (stats.oldest as string | null) ?? null,
    };
  }

  getHistory(key: string): HistoryRecordDetail | null {
    const r = this.db.prepare('SELECT * FROM events WHERE key = ?').get(key) as Row | undefined;
    if (!r) return null;
    return { ...rowToHistory(r), payload: JSON.parse(String(r.payload)) };
  }

  clearHistory(): number {
    const r = this.db.prepare('DELETE FROM events').run();
    return Number(r.changes);
  }

  /** Applies retention: drops records not observed within `retentionDays`, then trims to `maxRecords` (oldest observed first). */
  pruneHistory(retentionDays: number, maxRecords: number, now: Date): number {
    const cutoff = new Date(now.getTime() - retentionDays * 86400_000).toISOString();
    let removed = Number(this.db.prepare('DELETE FROM events WHERE last_observed < ?').run(cutoff).changes);
    const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as Row).n);
    if (count > maxRecords) {
      removed += Number(
        this.db
          .prepare('DELETE FROM events WHERE key IN (SELECT key FROM events ORDER BY last_observed ASC, first_observed ASC LIMIT ?)')
          .run(count - maxRecords).changes,
      );
    }
    return removed;
  }
}
