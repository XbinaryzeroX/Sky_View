// Local persistence using Node's built-in SQLite (node:sqlite), which ships
// with Electron. No native add-ons to rebuild. Writes are synchronous and
// transactional; the database lives in the user's app-data folder.

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS, legacySavedViewSchema, savedViewSchema, sceneSchema, type AppliedScene, type RestoredView, type SavedView, type Scene } from '../shared/ipc';
import { needsSurfaceChoice, surfaceSchema, type Investigation } from '../shared/investigation';
import type { AnnotationWatchPlan } from './areaWatches';
import { MAX_STORED_ANNOTATIONS, previewGeoJsonAnnotations, type AnnotationDocument, type GeoJsonImportResult } from '../shared/geojsonAnnotations';
import { areaWatchEventSchema, areaWatchRuleSchema, MAX_AREA_WATCH_EVENTS, MAX_AREA_WATCH_RULES, type AreaWatchEvent, type AreaWatchRule, type AreaWatchState } from '../shared/areaWatch';
import { TimelineArchive, type TimelineObservation, type TimelineStats } from './timeline';
import type { TimelineHazards, TimelineRange } from '../shared/timeline';
import type { VisitBriefing } from '../shared/visitBriefing';
import { readFeedCoverage } from '../shared/monitoring';
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
  FeedCoverage,
} from '../shared/types';

const SCHEMA_VERSION = 1;

export interface FeedCacheEntry<T> {
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  payload: T;
  coverage?: FeedCoverage;
}

type Row = Record<string, unknown>;
export type DocTable = 'annotations' | 'saved_views' | 'boards' | 'people' | 'plans';
export interface StoredAreaWatchRule { rule: AreaWatchRule; geometryKey: string }
export interface AreaWatchMatch { event: AreaWatchEvent; aliases: string[] }
export const MAX_AREA_WATCH_SEEN = 50_000;

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
  private readonly timeline: TimelineArchive;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.timeline = new TimelineArchive(this.db);
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
      CREATE TABLE IF NOT EXISTS area_watch_rules (
        area_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
        data TEXT NOT NULL, geometry_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS area_watch_events (
        id TEXT PRIMARY KEY, area_id TEXT NOT NULL REFERENCES area_watch_rules(area_id) ON DELETE CASCADE,
        detected_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_area_watch_event_time ON area_watch_events(detected_at);
      CREATE TABLE IF NOT EXISTS area_watch_seen (
        area_id TEXT NOT NULL REFERENCES area_watch_rules(area_id) ON DELETE CASCADE,
        quake_id TEXT NOT NULL, quake_time TEXT NOT NULL,
        PRIMARY KEY (area_id, quake_id)
      );
      CREATE INDEX IF NOT EXISTS idx_area_watch_seen_time ON area_watch_seen(quake_time);
      CREATE TABLE IF NOT EXISTS saved_views (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
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
    const cacheCols = this.db.prepare('PRAGMA table_info(feed_cache)').all() as Row[];
    if (!cacheCols.some(column => column.name === 'coverage')) this.db.exec('ALTER TABLE feed_cache ADD COLUMN coverage TEXT');
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

  private ensureDocCapacity(table: 'annotations' | 'saved_views', ids: readonly string[], limit: number): void {
    const count = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n);
    const exists = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    const added = [...new Set(ids)].filter(id => !exists.get(id)).length;
    if (added && count + added > limit) throw new Error(`Import would exceed ${limit.toLocaleString()} stored ${table === 'annotations' ? 'annotations' : 'saved views'}. Delete items or import fewer.`);
  }

  putSavedView(value: SavedView): void {
    const view = savedViewSchema.parse(value);
    this.tx(() => {
      this.ensureDocCapacity('saved_views', [view.id], 500);
      this.putDoc('saved_views', view.id, view, view.createdAt);
    });
  }

  private sceneSettings(request: { basemap: string; layersEnabled: Settings['layersEnabled']; terrainEnabled?: boolean; visualMode?: Settings['visualMode']; investigation?: Investigation }, allowMeteredBasemap: boolean): { settings: Settings; warnings: string[]; skippedSurface: Settings['basemap'] | null } {
    const current = this.getSettings();
    const warnings: string[] = [];
    let skippedSurface: Settings['basemap'] | null = null;
    const parsedSurface = surfaceSchema.safeParse(request.basemap);
    let basemap = current.basemap;
    let imageryYear = request.investigation?.imageryYear ?? null;
    if (!parsedSurface.success) {
      warnings.push('The saved surface is unsupported; the current surface was retained.');
      imageryYear ??= current.imageryYear;
    } else if (imageryYear === null) {
      if (needsSurfaceChoice(current.imageryYear == null ? current.basemap : 'atlas', parsedSurface.data) && !allowMeteredBasemap) {
        skippedSurface = parsedSurface.data;
        imageryYear = current.imageryYear;
        warnings.push(`The ${parsedSurface.data} surface requires an explicit choice; the current surface was retained.`);
      } else basemap = parsedSurface.data;
    }
    // An archived scene specifies its own imagery. Keep the user's Auto surface, including its billing choice.
    const settings: Settings = { ...current, basemap, layersEnabled: request.layersEnabled, imageryYear };
    if (request.terrainEnabled !== undefined) settings.terrainEnabled = request.terrainEnabled;
    if (request.visualMode !== undefined) settings.visualMode = request.visualMode;
    if (request.investigation) {
      settings.quakesNearLocationsOnly = request.investigation.quakesNearLocationsOnly;
      if (request.investigation.clock.mode === 'live') {
        settings.quakeWindow = request.investigation.quakeWindow;
        settings.quakeMinMagnitude = request.investigation.quakeMinMagnitude;
      }
    }
    return { settings, warnings, skippedSurface };
  }

  /** Main revalidates the complete file, then merges every document and watch epoch atomically. */
  applyScene(value: Scene, allowMeteredBasemap = false, planWatches?: (annotations: readonly AnnotationDocument[]) => AnnotationWatchPlan[]): AppliedScene {
    const scene = sceneSchema.parse(value);
    return this.tx(() => {
      const annotations = [...new Map(scene.annotations.map(annotation => [annotation.id, annotation])).values()];
      const views = [...new Map(scene.views.map(view => [view.id, view])).values()];
      this.ensureDocCapacity('annotations', annotations.map(annotation => annotation.id), MAX_STORED_ANNOTATIONS);
      this.ensureDocCapacity('saved_views', views.map(view => view.id), 500);
      const plans = planWatches?.(annotations) ?? [];
      // A caller must supply the watch planner when imported IDs already have rules.
      // Otherwise geometry changes could retain a stale activation/compiled shape.
      if (!planWatches && annotations.some(annotation => this.areaWatchRuleRecord(annotation.id)))
        throw new Error('Watched annotations require atomic watch preparation.');
      const result = this.sceneSettings({ ...scene, investigation: scene.version === 2 ? scene.investigation : undefined }, allowMeteredBasemap);
      this.saveSettings(result.settings);
      for (const annotation of annotations) this.putDoc('annotations', annotation.id, annotation, annotation.createdAt);
      for (const plan of plans) {
        if (plan.remove) this.db.prepare('DELETE FROM area_watch_rules WHERE area_id = ?').run(plan.areaId);
        else if (plan.record) this.saveAreaWatchRule(plan.record);
      }
      if (plans.length) this.resetAreaWatchEvaluation();
      const errors = [...new Set(plans.map(plan => plan.error).filter((error): error is string => !!error))];
      if (errors.length) this.setAreaWatchError(errors.join(' '));
      result.warnings.push(...errors);
      for (const view of views) this.putDoc('saved_views', view.id, view, view.createdAt);
      return { ...result, annotations: this.listDocs<AnnotationDocument>('annotations'), views: this.listDocs<SavedView>('saved_views') };
    });
  }

  restoreView(id: string, allowMeteredBasemap = false): RestoredView {
    return this.tx(() => {
      const row = this.db.prepare('SELECT data FROM saved_views WHERE id = ?').get(id) as Row | undefined;
      if (!row) throw new Error('Saved view not found.');
      const raw: unknown = JSON.parse(String(row.data));
      // v1 scene's original view schema preserves legacy rows without adding defaults.
      const parsed = savedViewSchema.safeParse(raw);
      const view: SavedView = parsed.success ? parsed.data : legacySavedViewSchema.parse(raw);
      const result = this.sceneSettings(view, allowMeteredBasemap);
      this.saveSettings(result.settings);
      return { ...result, view };
    });
  }

  /** Reparse/recheck current rows inside one transaction; never trust preview or source IDs. */
  importGeoJsonAnnotations(text: string): GeoJsonImportResult {
    return this.tx(() => {
      const existing = this.listDocs<AnnotationDocument>('annotations');
      const { candidates, ...report } = previewGeoJsonAnnotations(text, existing);
      if (existing.length + candidates.length > MAX_STORED_ANNOTATIONS)
        throw new Error(`Import would exceed ${MAX_STORED_ANNOTATIONS.toLocaleString()} stored annotations. Delete annotations or import fewer features.`);
      const insert = this.db.prepare('INSERT INTO annotations(id, data, created_at) VALUES (?, ?, ?)');
      const createdAt = new Date().toISOString();
      for (const candidate of candidates) {
        const annotation: AnnotationDocument = { ...candidate, id: randomUUID(), createdAt };
        insert.run(annotation.id, JSON.stringify(annotation), createdAt);
      }
      return { ...report, imported: candidates.length, annotations: this.listDocs<AnnotationDocument>('annotations') };
    });
  }

  // ---------- local earthquake area watches (separate from USGS event history) ----------
  areaWatchRuleRecords(enabledOnly = false): StoredAreaWatchRule[] {
    return (this.db.prepare(`SELECT data, geometry_key FROM area_watch_rules ${enabledOnly ? "WHERE json_extract(data, '$.enabled') = 1" : ''} ORDER BY area_id`).all() as Row[])
      .map(row => ({ rule: areaWatchRuleSchema.parse(JSON.parse(String(row.data))), geometryKey: String(row.geometry_key) }));
  }

  areaWatchRuleRecord(areaId: string): StoredAreaWatchRule | null {
    const row = this.db.prepare('SELECT data, geometry_key FROM area_watch_rules WHERE area_id = ?').get(areaId) as Row | undefined;
    return row ? { rule: areaWatchRuleSchema.parse(JSON.parse(String(row.data))), geometryKey: String(row.geometry_key) } : null;
  }

  getAnnotation(id: string): AnnotationDocument | null {
    const row = this.db.prepare('SELECT data FROM annotations WHERE id = ?').get(id) as Row | undefined;
    return row ? JSON.parse(String(row.data)) as AnnotationDocument : null;
  }

  enabledAreaWatchAnnotations(): AnnotationDocument[] {
    return (this.db.prepare("SELECT a.data FROM annotations a JOIN area_watch_rules r ON r.area_id = a.id WHERE json_extract(r.data, '$.enabled') = 1 LIMIT ?").all(MAX_AREA_WATCH_RULES) as Row[])
      .map(row => JSON.parse(String(row.data)) as AnnotationDocument);
  }

  areaWatchState(): AreaWatchState {
    const rules = (this.db.prepare('SELECT data FROM area_watch_rules ORDER BY area_id LIMIT ?').all(MAX_AREA_WATCH_RULES) as Row[])
      .map(row => areaWatchRuleSchema.parse(JSON.parse(String(row.data))));
    const events = (this.db.prepare("SELECT data FROM area_watch_events ORDER BY detected_at DESC, json_extract(data, '$.quakeTime') DESC, id DESC LIMIT ?").all(MAX_AREA_WATCH_EVENTS) as Row[])
      .map(row => areaWatchEventSchema.parse(JSON.parse(String(row.data))));
    return { rules, events, ...this.areaWatchEvaluation() };
  }

  private areaWatchEvaluation(): { lastEvaluatedAt: string | null; error: string | null } {
    const raw = this.getMeta('area_watch_evaluation');
    if (!raw) return { lastEvaluatedAt: null, error: null };
    try {
      const value = JSON.parse(raw);
      if ((value.lastEvaluatedAt === null || (typeof value.lastEvaluatedAt === 'string' && Number.isFinite(Date.parse(value.lastEvaluatedAt)))) && (value.error === null || typeof value.error === 'string'))
        return { lastEvaluatedAt: value.lastEvaluatedAt, error: value.error };
    } catch { /* A damaged local status must not look like a successful evaluation. */ }
    return { lastEvaluatedAt: null, error: 'Stored area-watch evaluation status is invalid.' };
  }

  private resetAreaWatchEvaluation(): void {
    this.setMeta('area_watch_evaluation', JSON.stringify({ lastEvaluatedAt: null, error: null }));
  }

  private saveAreaWatchRule(record: StoredAreaWatchRule): void {
    const rule = areaWatchRuleSchema.parse(record.rule);
    const exists = this.db.prepare('SELECT 1 FROM area_watch_rules WHERE area_id = ?').get(rule.areaId);
    const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM area_watch_rules').get() as Row).n);
    if (!exists && count >= MAX_AREA_WATCH_RULES) throw new Error(`At most ${MAX_AREA_WATCH_RULES} area watches can be stored.`);
    this.db.prepare('INSERT INTO area_watch_rules(area_id, data, geometry_key) VALUES (?, ?, ?) ON CONFLICT(area_id) DO UPDATE SET data = excluded.data, geometry_key = excluded.geometry_key')
      .run(rule.areaId, JSON.stringify(rule), record.geometryKey);
  }

  putAreaWatchRule(record: StoredAreaWatchRule): void { this.tx(() => { this.saveAreaWatchRule(record); this.resetAreaWatchEvaluation(); }); }

  /** Annotation edits and any watch re-arm/invalidation commit together. */
  putAnnotationWithAreaWatch(annotation: AnnotationDocument, record: StoredAreaWatchRule | null, removeRule = false, error?: string): void {
    this.tx(() => {
      this.putDoc('annotations', annotation.id, annotation, annotation.createdAt);
      if (removeRule) this.db.prepare('DELETE FROM area_watch_rules WHERE area_id = ?').run(annotation.id);
      else if (record) this.saveAreaWatchRule(record);
      if (record || removeRule) this.resetAreaWatchEvaluation();
      if (error) this.setAreaWatchError(error);
    });
  }

  deleteAreaWatch(areaId: string): boolean {
    return this.tx(() => {
      const removed = Number(this.db.prepare('DELETE FROM area_watch_rules WHERE area_id = ?').run(areaId).changes) > 0;
      if (removed) this.resetAreaWatchEvaluation();
      return removed;
    });
  }

  deleteAnnotationWithAreaWatch(areaId: string): boolean {
    return this.tx(() => {
      const watched = this.db.prepare('SELECT 1 FROM area_watch_rules WHERE area_id = ?').get(areaId);
      const removed = this.deleteDoc('annotations', areaId);
      if (watched) this.resetAreaWatchEvaluation();
      return removed;
    });
  }

  setAreaWatchError(error: string): void {
    const previous = this.areaWatchEvaluation();
    this.setMeta('area_watch_evaluation', JSON.stringify({ lastEvaluatedAt: previous.lastEvaluatedAt, error: error.slice(0, 400) }));
  }

  pruneAreaWatchSeen(cutoff: string): void { this.db.prepare('DELETE FROM area_watch_seen WHERE quake_time < ?').run(cutoff); }

  areaWatchSeenKeys(): Set<string> {
    return new Set((this.db.prepare('SELECT area_id, quake_id FROM area_watch_seen LIMIT ?').all(MAX_AREA_WATCH_SEEN) as Row[])
      .map(row => `${row.area_id}\0${row.quake_id}`));
  }

  /** Dedup and evidence insertion are atomic, including an alias/preferred-ID change. */
  commitAreaWatchMatches(matches: AreaWatchMatch[], evaluatedAt: string, error: string | null): void {
    this.tx(() => {
      const seen = this.db.prepare('SELECT 1 FROM area_watch_seen WHERE area_id = ? AND quake_id = ?');
      const remember = this.db.prepare('INSERT OR IGNORE INTO area_watch_seen(area_id, quake_id, quake_time) VALUES (?, ?, ?)');
      const insert = this.db.prepare('INSERT INTO area_watch_events(id, area_id, detected_at, data) VALUES (?, ?, ?, ?)');
      let size = Number((this.db.prepare('SELECT COUNT(*) AS n FROM area_watch_seen').get() as Row).n);
      for (const match of matches) {
        const event = areaWatchEventSchema.parse(match.event);
        const aliases = [...new Set([event.quakeId, ...match.aliases])];
        const duplicate = aliases.some(alias => seen.get(event.areaId, alias));
        const missing = aliases.filter(alias => !seen.get(event.areaId, alias));
        if (size + missing.length > MAX_AREA_WATCH_SEEN) throw new Error('Area-watch deduplication capacity reached; remove watches or wait for old observations to expire.');
        for (const alias of missing) remember.run(event.areaId, alias, event.quakeTime);
        size += missing.length;
        if (!duplicate) insert.run(event.id, event.areaId, event.detectedAt, JSON.stringify(event));
      }
      this.db.prepare("DELETE FROM area_watch_events WHERE id IN (SELECT id FROM area_watch_events ORDER BY detected_at DESC, json_extract(data, '$.quakeTime') DESC, id DESC LIMIT -1 OFFSET ?)").run(MAX_AREA_WATCH_EVENTS);
      const previous = this.areaWatchEvaluation();
      this.setMeta('area_watch_evaluation', JSON.stringify({ lastEvaluatedAt: error ? previous.lastEvaluatedAt : evaluatedAt, error }));
    });
  }

  readAreaWatchEvents(ids: readonly string[]): void {
    if (ids.length > MAX_AREA_WATCH_EVENTS) throw new Error('Too many area-watch event IDs.');
    this.tx(() => {
      const get = this.db.prepare('SELECT data FROM area_watch_events WHERE id = ?');
      const put = this.db.prepare('UPDATE area_watch_events SET data = ? WHERE id = ?');
      for (const id of new Set(ids)) {
        const row = get.get(id) as Row | undefined;
        if (row) put.run(JSON.stringify({ ...areaWatchEventSchema.parse(JSON.parse(String(row.data))), read: true }), id);
      }
    });
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

  recordTimelineObservation(observation: TimelineObservation): void {
    const settings = this.getSettings();
    this.timeline.record(observation, { days: settings.historyRetentionDays, maxRecords: settings.historyMaxRecords });
  }

  recordTimelineGap(feed: 'nws' | 'usgs', at: string, scope: string, reason: string): void {
    const settings = this.getSettings();
    this.timeline.gap(feed, at, scope, reason, { days: settings.historyRetentionDays, maxRecords: settings.historyMaxRecords });
  }

  timelineRange(): TimelineRange {
    const tracks = this.trackRange(), feeds = this.timeline.range();
    const times = [tracks.oldest, tracks.newest, feeds.oldest, feeds.newest].filter((time): time is string => time !== null).sort();
    return { oldest: times[0] ?? null, newest: times.at(-1) ?? null, points: tracks.points, nwsFrames: feeds.nwsFrames, usgsFrames: feeds.usgsFrames };
  }

  timelineFrame(t: string): TimelineHazards { return this.timeline.frame(t); }
  timelineStats(): TimelineStats { return this.timeline.stats(); }
  beginVisit(at: string): void { this.timeline.beginVisit(at); }
  visitBriefing(at: string): VisitBriefing { return this.timeline.visitBriefing(at); }

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

  /**
   * Keeps the first fix per object per minute between `fromIso` and `toIso` (older fixes only; recent ones keep their
   * full rate). Returns the number removed.
   */
  thinTracks(fromIso: string, toIso: string): number {
    if (!(fromIso < toIso)) return 0;
    return this.tx(() => Number(this.db.prepare(
      `DELETE FROM track_points WHERE t >= ? AND t < ? AND rowid NOT IN (
         SELECT MIN(rowid) FROM track_points WHERE t >= ? AND t < ? GROUP BY layer, rid, substr(t, 1, 16))`,
    ).run(fromIso, toIso, fromIso, toIso).changes));
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
    const r = this.db.prepare('SELECT fetched_at, source_updated_at, payload, coverage FROM feed_cache WHERE feed = ?').get(feed) as Row | undefined;
    if (!r) return null;
    try {
      const result: FeedCacheEntry<T> = { fetchedAt: String(r.fetched_at), sourceUpdatedAt: (r.source_updated_at as string | null) ?? null, payload: JSON.parse(String(r.payload)) as T };
      if (r.coverage !== null) {
        try { result.coverage = readFeedCoverage(JSON.parse(String(r.coverage))); }
        catch { result.coverage = readFeedCoverage(null); }
      }
      return result;
    } catch {
      return null;
    }
  }

  setFeedCache<T>(feed: string, entry: FeedCacheEntry<T>): void {
    this.db
      .prepare(
        'INSERT INTO feed_cache(feed, fetched_at, source_updated_at, payload, coverage) VALUES (?, ?, ?, ?, ?) ON CONFLICT(feed) DO UPDATE SET fetched_at = excluded.fetched_at, source_updated_at = excluded.source_updated_at, payload = excluded.payload, coverage = excluded.coverage',
      )
      .run(feed, entry.fetchedAt, entry.sourceUpdatedAt, JSON.stringify(entry.payload), entry.coverage === undefined ? null : JSON.stringify(readFeedCoverage(entry.coverage)));
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
    return this.tx(() => {
      const removed = Number(this.db.prepare('DELETE FROM events').run().changes);
      this.timeline.clearWithinTransaction();
      return removed;
    });
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
    this.timeline.prune({ days: retentionDays, maxRecords }, now.toISOString());
    return removed;
  }
}
