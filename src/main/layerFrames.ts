// Recorded snapshots of area layers (GPS accuracy cells, violence in the news) for replay. A snapshot identical to
// the previous one only moves that row's last-seen time, so an unchanged area costs nothing per poll. Bounded by
// age, row count and total bytes; the oldest rows go first.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { GeoRecord } from '../shared/layers';
import { FRAME_VALID_MS, type FrameLayer, type RecordedLayerFrame } from '../shared/timeline';

export const LAYER_FRAME_LIMITS = Object.freeze({ rows: 20_000, bytes: 96 * 1024 * 1024, recordsPerFrame: 5_000, bytesPerFrame: 2 * 1024 * 1024 });
type Row = Record<string, unknown>;

function unknown(reason: string): RecordedLayerFrame {
  return { state: 'unknown', observedAt: null, lastSeenAt: null, area: null, reason, records: [] };
}

export class LayerFrameArchive {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS layer_frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer TEXT NOT NULL,
        area TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        digest TEXT NOT NULL,
        payload TEXT NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS layer_frames_lookup ON layer_frames(layer, observed_at);
    `);
  }

  /** Returns false when the snapshot was too large to keep (nothing is stored then). */
  record(layer: FrameLayer, area: string, at: string, records: readonly GeoRecord[], retentionHours: number): boolean {
    if (records.length > LAYER_FRAME_LIMITS.recordsPerFrame) return false;
    const payload = JSON.stringify(records);
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > LAYER_FRAME_LIMITS.bytesPerFrame) return false;
    const digest = createHash('sha256').update(area + '\n' + payload).digest('hex');
    this.db.exec('BEGIN');
    try {
      const last = this.db.prepare('SELECT id, digest, last_seen_at FROM layer_frames WHERE layer = ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(layer) as Row | undefined;
      // Unchanged and still contiguous: extend the existing snapshot instead of storing it again.
      const contiguous = last && Date.parse(at) - Date.parse(String(last.last_seen_at)) <= FRAME_VALID_MS[layer];
      if (last && last.digest === digest && contiguous) this.db.prepare('UPDATE layer_frames SET last_seen_at = ? WHERE id = ?').run(at, last.id as number);
      else this.db.prepare('INSERT INTO layer_frames(layer, area, observed_at, last_seen_at, digest, payload, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(layer, area, at, at, digest, payload, bytes);
      this.prune(at, retentionHours);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return true;
  }

  private prune(at: string, retentionHours: number): void {
    const cutoff = new Date(Date.parse(at) - Math.max(1, retentionHours) * 3_600_000).toISOString();
    this.db.prepare('DELETE FROM layer_frames WHERE last_seen_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM layer_frames WHERE id IN (SELECT id FROM layer_frames ORDER BY observed_at DESC, id DESC LIMIT -1 OFFSET ?)').run(LAYER_FRAME_LIMITS.rows);
    let total = Number((this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS b FROM layer_frames').get() as Row).b);
    while (total > LAYER_FRAME_LIMITS.bytes) {
      const old = this.db.prepare('SELECT id, bytes FROM layer_frames ORDER BY observed_at, id LIMIT 1').get() as Row | undefined;
      if (!old) break;
      this.db.prepare('DELETE FROM layer_frames WHERE id = ?').run(old.id as number);
      total -= Number(old.bytes);
    }
  }

  /** The snapshot standing at `t`: the latest one observed at or before it, while still within its validity window. */
  frame(layer: FrameLayer, t: string): RecordedLayerFrame {
    const row = this.db.prepare('SELECT * FROM layer_frames WHERE layer = ? AND observed_at <= ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(layer, t) as Row | undefined;
    if (!row) return unknown('Not recorded at this time. Turn on watch-area recording to keep this layer for replay.');
    const lastSeen = String(row.last_seen_at);
    if (Date.parse(t) - Date.parse(lastSeen) > FRAME_VALID_MS[layer]) return unknown(`Not recorded at this time; the last snapshot was seen at ${lastSeen}.`);
    let records: GeoRecord[] = [];
    try {
      const parsed = JSON.parse(String(row.payload)) as unknown;
      // Stored JSON is checked on read: only objects with an id and finite coordinates are replayed.
      if (Array.isArray(parsed)) records = parsed.filter((r): r is GeoRecord => !!r && typeof r === 'object' && typeof (r as GeoRecord).id === 'string' && Number.isFinite((r as GeoRecord).lat) && Number.isFinite((r as GeoRecord).lon));
    } catch {
      return unknown('The recorded snapshot could not be read.');
    }
    return { state: 'recorded', observedAt: String(row.observed_at), lastSeenAt: lastSeen, area: String(row.area), reason: null, records };
  }

  clear(): void {
    this.db.exec('DELETE FROM layer_frames');
  }
}
