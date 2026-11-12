// Recorded normalized replies, not reconstructed provider history. Membership intervals
// retain unchanged records without writing the whole feed again at every poll.
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RecordedFeed, TimelineHazards } from '../shared/timeline';
import type { Earthquake, FeedId, WeatherAlert } from '../shared/types';
import { VISIT_EXAMPLES_PER_CHANGE, visitSourceUrl, type VisitBriefing, type VisitChanges, type VisitEndpoint, type VisitFeedBriefing } from '../shared/visitBriefing';

export const TIMELINE_LIMITS = Object.freeze({
  epochs: 20_000,
  revisions: 50_000,
  intervals: 200_000,
  payloadBytes: 64 * 1024 * 1024,
  recordsPerFrame: 10_000,
  bytesPerFrame: 10 * 1024 * 1024,
  bytesPerRevision: 256 * 1024,
});
type Row = Record<string, unknown>;
export interface TimelineRetention { days: number; maxRecords: number }
export interface TimelineObservation {
  feed: FeedId;
  observedAt: string;
  sourceUpdatedAt: string | null;
  scope: string;
  validForMs: number;
  skippedRecords?: number;
  /** Actual source coverage limitation, independent of malformed record count. */
  coverageNote?: string | null;
  records: readonly (WeatherAlert | Earthquake)[];
}
export interface TimelineStats { epochs: number; revisions: number; intervals: number; payloadBytes: number }

function timestamp(value: string): number {
  const ms = Date.parse(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new Error('Timeline time must be a canonical UTC millisecond timestamp.');
  return ms;
}
const reasonText = (value: string): string => value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400);
const empty = <T>(state: 'gap' | 'unknown', reason: string, scope: string | null = null): RecordedFeed<T> => ({ state, observedAt: null, sourceUpdatedAt: null, scope, validUntil: null, reason, records: [] });
const VISIT_META = 'timeline_visit_v1';
const VISIT_UNTRACKED_META = 'timeline_visit_untracked_v1';
type FeedIds = Record<FeedId, number | null>;
interface VisitMarker {
  version: 1;
  current: { id: string; startedAt: string; startEpoch: number };
  previous: { startedAt: string; success: FeedIds; latest: FeedIds } | null;
  resetReason: string | null;
}
interface VisitRevision { payload: string; digest: string; size: number; feed: FeedId; id: string; label: unknown; url: unknown }
interface VisitMember { revision: VisitRevision | null; signature: string }
interface VisitRead { endpoint: VisitEndpoint; epoch: Row | null; blocked: boolean; limits: string[] }
const noChanges = (): VisitChanges => ({ total: null, examples: [], truncated: false });
const unavailableEndpoint = (reason: string): VisitEndpoint => ({ state: 'unavailable', observedAt: null, sourceUpdatedAt: null, scope: null, validUntil: null, recordCount: null, reason });

export class TimelineArchive {
  private visit: VisitMarker | null = null;
  private visitError: string | null = null;
  private visitAttemptedAt: string | null = null;
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS timeline_revisions (
        id INTEGER PRIMARY KEY, feed TEXT NOT NULL, digest TEXT NOT NULL,
        payload TEXT NOT NULL, bytes INTEGER NOT NULL, UNIQUE(feed, digest)
      );
      CREATE TABLE IF NOT EXISTS timeline_epochs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, feed TEXT NOT NULL, observed_at TEXT NOT NULL,
        source_updated_at TEXT, scope TEXT NOT NULL, valid_until TEXT,
        state TEXT NOT NULL, reason TEXT, expected_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_epoch_time ON timeline_epochs(feed, observed_at, id);
      CREATE TABLE IF NOT EXISTS timeline_memberships (
        id INTEGER PRIMARY KEY, feed TEXT NOT NULL,
        revision_id INTEGER NOT NULL REFERENCES timeline_revisions(id),
        start_epoch INTEGER NOT NULL, end_epoch INTEGER, copies INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_membership_frame ON timeline_memberships(feed, start_epoch, end_epoch);
      CREATE INDEX IF NOT EXISTS idx_timeline_membership_revision ON timeline_memberships(revision_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_membership_open ON timeline_memberships(feed, revision_id) WHERE end_epoch IS NULL;
    `);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try { const value = work(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  stats(): TimelineStats {
    const revisions = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM timeline_revisions').get() as Row;
    return { epochs: Number((this.db.prepare('SELECT COUNT(*) AS n FROM timeline_epochs').get() as Row).n), revisions: Number(revisions.n), payloadBytes: Number(revisions.b), intervals: Number((this.db.prepare('SELECT COUNT(*) AS n FROM timeline_memberships').get() as Row).n) };
  }

  /** Rotate at startup, rather than shutdown, so abnormal exits and visits with no replies count. */
  beginVisit(at: string): void {
    if (this.visit || this.visitError) return;
    timestamp(at);
    this.visitAttemptedAt = at;
    try {
      const marker = this.transaction(() => {
        const raw = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(VISIT_META) as Row | undefined;
        let previous: VisitMarker['current'] | null = null;
        let resetReason: string | null = null;
        const untracked = this.db.prepare('SELECT 1 FROM meta WHERE key = ?').get(VISIT_UNTRACKED_META);
        if (untracked) resetReason = 'The previous visit could not record reliable run ownership; its observations remain in history but cannot establish a previous-visit baseline.';
        else if (raw) {
          try {
            if (String(raw.value).length > 4096) throw new Error('Oversized marker');
            const value = JSON.parse(String(raw.value));
            if (value.version !== 1 || typeof value.current?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.current.id) || !Number.isSafeInteger(value.current.startEpoch) || value.current.startEpoch < 0) throw new Error('Invalid marker');
            timestamp(value.current.startedAt);
            previous = { id: value.current.id, startedAt: value.current.startedAt, startEpoch: value.current.startEpoch };
          } catch { resetReason = 'The previous visit marker is invalid; earlier archive rows are not assumed to belong to a known app visit.'; }
        }
        // sqlite_sequence survives DELETE/clear-history, unlike MAX(retained id).
        const highWater = Number((this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'timeline_epochs'").get() as Row | undefined)?.seq ?? 0);
        if (!Number.isSafeInteger(highWater) || highWater < 0 || (previous && previous.startEpoch > highWater)) throw new Error('Invalid archive high-water mark');
        const latest = (feed: FeedId, successful: boolean): number | null => {
          const row = this.db.prepare(`SELECT id FROM timeline_epochs WHERE feed = ? AND id > ? AND id <= ? ${successful ? "AND state IN ('recorded', 'partial')" : ''} ORDER BY id DESC LIMIT 1`).get(feed, previous!.startEpoch, highWater) as Row | undefined;
          return row ? Number(row.id) : null;
        };
        const next: VisitMarker = { version: 1, current: { id: randomUUID(), startedAt: at, startEpoch: highWater }, previous: previous ? { startedAt: previous.startedAt, success: { nws: latest('nws', true), usgs: latest('usgs', true) }, latest: { nws: latest('nws', false), usgs: latest('usgs', false) } } : null, resetReason };
        this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(VISIT_META, JSON.stringify(next));
        this.db.prepare('DELETE FROM meta WHERE key = ?').run(VISIT_UNTRACKED_META);
        return next;
      });
      this.visit = marker;
    } catch {
      this.visitError = 'Visit tracking could not be initialized in local storage; no cross-visit comparison can be established.';
      try { this.markUntrackedVisit(); } catch { /* Later reply writes retry this marker atomically with their evidence. */ }
    }
  }

  private markUntrackedVisit(): void {
    if (this.visitError) this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(VISIT_UNTRACKED_META, this.visitAttemptedAt ?? 'unavailable');
  }

  private visitEndpoint(feed: FeedId, success: number | null, latest: number | null, at: string, role: 'previous' | 'current'): VisitRead {
    const last = latest === null ? null : this.db.prepare('SELECT * FROM timeline_epochs WHERE id = ? AND feed = ?').get(latest, feed) as Row | undefined;
    if (success === null) {
      const note = last?.state === 'gap' ? `No successful reply was archived in the ${role} visit. ${reasonText(String(last.reason))}` : `No successful reply was archived in the ${role} visit; cached or legacy data is not a new observation.`;
      return { endpoint: unavailableEndpoint(note), epoch: null, blocked: true, limits: [note] };
    }
    const row = this.db.prepare('SELECT * FROM timeline_epochs WHERE id = ? AND feed = ?').get(success, feed) as Row | undefined;
    if (!row) {
      const note = `The ${role} visit's exact reply is no longer retained (history clearing or retention/storage limits).`;
      return { endpoint: unavailableEndpoint(note), epoch: null, blocked: true, limits: [note] };
    }
    const limits: string[] = [];
    let blocked = false;
    const endpoint: VisitEndpoint = { state: row.state === 'partial' ? 'partial' : 'recorded', observedAt: String(row.observed_at), sourceUpdatedAt: row.source_updated_at as string | null, scope: String(row.scope), validUntil: row.valid_until as string | null, recordCount: Number(row.expected_count), reason: row.reason as string | null };
    try {
      timestamp(endpoint.observedAt!); timestamp(endpoint.validUntil!);
      if (endpoint.sourceUpdatedAt !== null) timestamp(endpoint.sourceUpdatedAt);
      if (!['recorded', 'partial'].includes(String(row.state)) || !Number.isSafeInteger(endpoint.recordCount) || endpoint.recordCount! < 0 || endpoint.recordCount! > TIMELINE_LIMITS.recordsPerFrame || !endpoint.scope || endpoint.scope.length > 160) throw new Error('Invalid endpoint');
    } catch {
      const note = `The ${role} visit's retained reply metadata is invalid; it cannot establish a comparison.`;
      return { endpoint: unavailableEndpoint(note), epoch: null, blocked: true, limits: [note] };
    }
    if (row.state === 'partial') { blocked = true; limits.push(`The ${role} reply is incomplete. ${reasonText(String(row.reason ?? 'Completeness is unavailable.'))}`); }
    if (latest !== null && latest !== success) {
      if (!last) { blocked = true; limits.push(`The ${role} visit's last attempt marker is no longer retained.`); }
      else if (last.state === 'gap') {
        if (endpoint.state !== 'partial') endpoint.state = 'gap';
        limits.push(`The ${role} reply was followed by an unavailable refresh at ${String(last.observed_at)}: ${reasonText(String(last.reason))}`);
        if (last.scope !== row.scope) { blocked = true; limits.push(`The ${role} visit changed source scope to ${String(last.scope)} without a successful reply for that scope.`); }
      } else { blocked = true; limits.push(`The ${role} visit's final observation marker is inconsistent.`); }
    }
    if (endpoint.observedAt! > at) { blocked = true; limits.push(`The ${role} observation is ahead of the local clock.`); }
    if (endpoint.validUntil! < at) {
      if (endpoint.state === 'recorded') endpoint.state = 'expired';
      limits.push(`The ${role} recorded reply's freshness window ended at ${endpoint.validUntil}; endpoint differences do not establish current conditions.`);
    }
    if (limits.length) endpoint.reason = limits.join(' ');
    return { endpoint, epoch: row, blocked, limits };
  }

  private visitMembers(feed: FeedId, before: Row, after: Row, checked: Map<number, VisitRevision>): [Map<string, VisitMember> | null, Map<string, VisitMember> | null] {
    const oldId = Number(before.id), newId = Number(after.id);
    // Read a common membership once rather than transferring/parsing its payload twice.
    const rows = this.db.prepare('SELECT r.id, r.feed, r.digest, r.payload, m.start_epoch, m.end_epoch, m.copies FROM timeline_memberships m JOIN timeline_revisions r ON r.id = m.revision_id WHERE m.feed = ? AND ((m.start_epoch <= ? AND (m.end_epoch IS NULL OR m.end_epoch > ?)) OR (m.start_epoch <= ? AND (m.end_epoch IS NULL OR m.end_epoch > ?))) LIMIT ?')
      .all(feed, oldId, oldId, newId, newId, 2 * TIMELINE_LIMITS.recordsPerFrame + 1) as Row[];
    if (rows.length > 2 * TIMELINE_LIMITS.recordsPerFrame) return [null, null];
    const side = (id: number, expected: number) => ({ id, expected, members: 0, bytes: 0, damaged: false, byId: new Map<string, { revision: VisitRevision; digests: string[] }>() });
    const sides = [side(oldId, Number(before.expected_count)), side(newId, Number(after.expected_count))];
    for (const row of rows) {
      const payload = String(row.payload), copies = Number(row.copies), digest = String(row.digest);
      const relevant = sides.filter(side => Number(row.start_epoch) <= side.id && (row.end_epoch === null || Number(row.end_epoch) > side.id));
      let revision: VisitRevision;
      try {
        if (!Number.isSafeInteger(copies) || copies < 1 || row.feed !== feed) throw new Error('Damaged reply membership');
        const known = checked.get(Number(row.id));
        // This cache lives only within this one read; exact payload/digest matches are required.
        if (known && known.payload === payload && known.digest === digest && known.feed === feed) revision = known;
        else {
          const size = Buffer.byteLength(payload, 'utf8');
          if (size > TIMELINE_LIMITS.bytesPerRevision || createHash('sha256').update(payload).digest('hex') !== digest) throw new Error('Damaged reply revision');
          const record = JSON.parse(payload) as Record<string, unknown>;
          if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 300 || /[\u0000-\u001f\u007f]/.test(record.id)) throw new Error('Invalid source identity');
          revision = { payload, digest, size, feed, id: record.id, label: feed === 'nws' ? record.headline ?? record.event : record.title ?? record.place, url: feed === 'nws' ? record.sourceUrl : record.url };
          checked.set(Number(row.id), revision);
        }
      } catch { for (const side of relevant) side.damaged = true; continue; }
      for (const side of relevant) {
        side.members += copies; side.bytes += revision.size * copies;
        if (side.members > TIMELINE_LIMITS.recordsPerFrame || side.bytes > TIMELINE_LIMITS.bytesPerFrame) { side.damaged = true; continue; }
        const previous = side.byId.get(revision.id);
        // Multiplicity belongs to the archived reply. Repeating the same payload does not revise an event.
        if (previous) previous.digests.push(digest);
        else side.byId.set(revision.id, { revision, digests: [digest] });
      }
    }
    const members = (side: typeof sides[number]) => {
      if (side.damaged || side.members !== side.expected) return null;
      const result = new Map<string, VisitMember>();
      for (const [id, value] of side.byId) {
        const single = value.digests.length === 1;
        result.set(id, { revision: single ? value.revision : null, signature: single ? value.digests[0] : value.digests.sort().join('|') });
      }
      return result;
    };
    return [members(sides[0]), members(sides[1])];
  }

  /** Two exact recorded endpoints only; never a claimed complete interval or resolution list. */
  visitBriefing(at: string): VisitBriefing {
    timestamp(at);
    const marker = this.visit;
    const checked = new Map<number, VisitRevision>();
    const feed = (id: FeedId): VisitFeedBriefing => {
      const base = marker?.previous;
      const baseline = base ? this.visitEndpoint(id, base.success[id], base.latest[id], marker!.current.startedAt, 'previous') : { endpoint: unavailableEndpoint(marker?.resetReason ?? 'No earlier tracked app visit exists. Earlier cache/history is not backfilled into a visit.'), epoch: null, blocked: true, limits: [marker?.resetReason ?? 'This is the first tracked app visit.'] };
      const latest = (successful: boolean): number | null => {
        if (!marker) return null;
        const row = this.db.prepare(`SELECT id FROM timeline_epochs WHERE feed = ? AND id > ? ${successful ? "AND state IN ('recorded', 'partial')" : ''} ORDER BY id DESC LIMIT 1`).get(id, marker.current.startEpoch) as Row | undefined;
        return row ? Number(row.id) : null;
      };
      const current = this.visitEndpoint(id, latest(true), latest(false), at, 'current');
      const result: VisitFeedBriefing = { feed: id, status: 'unavailable', baseline: baseline.endpoint, current: current.endpoint, new: noChanges(), updated: noChanges(), noLongerReturned: noChanges(), limits: [...baseline.limits, ...current.limits] };
      if (this.visitError) result.limits.unshift(this.visitError);
      if (!baseline.blocked && !current.blocked && baseline.epoch && current.epoch) {
        if (baseline.endpoint.scope !== current.endpoint.scope) result.limits.push('The two recorded replies use different source scopes; membership changes are not comparable.');
        else {
          const [old, now] = this.visitMembers(id, baseline.epoch, current.epoch, checked);
          if (!old) { result.baseline.state = 'partial'; result.baseline.reason = 'Retained baseline membership or revision integrity is incomplete.'; result.limits.push(result.baseline.reason); }
          if (!now) { result.current.state = 'partial'; result.current.reason = 'Retained current membership or revision integrity is incomplete.'; result.limits.push(result.current.reason); }
          if (old && now) {
            const group = (ids: string[], source: Map<string, VisitMember>): VisitChanges => ({ total: ids.length, examples: ids.sort().slice(0, VISIT_EXAMPLES_PER_CHANGE).map(sourceId => {
              const revision = source.get(sourceId)!.revision;
              if (!revision) return { id: sourceId, label: 'Multiple revisions returned for this identifier', url: null };
              return { id: sourceId, label: reasonText(typeof revision.label === 'string' ? revision.label : sourceId).slice(0, 240), url: visitSourceUrl(id, revision.url) };
            }), truncated: ids.length > VISIT_EXAMPLES_PER_CHANGE });
            result.new = group([...now.keys()].filter(sourceId => !old.has(sourceId)), now);
            result.updated = group([...now.keys()].filter(sourceId => old.has(sourceId) && old.get(sourceId)!.signature !== now.get(sourceId)!.signature), now);
            result.noLongerReturned = group([...old.keys()].filter(sourceId => !now.has(sourceId)), old);
            result.status = result.limits.length ? 'limited' : 'ready';
          }
        }
      }
      return result;
    };
    try {
      return { version: 1, generatedAt: at, sessionStartedAt: marker?.current.startedAt ?? null, previousStartedAt: marker?.previous?.startedAt ?? null, error: this.visitError ?? (!marker ? 'Visit tracking has not been initialized.' : marker.resetReason), feeds: { nws: feed('nws'), usgs: feed('usgs') } };
    } catch {
      const failed = (id: FeedId): VisitFeedBriefing => ({ feed: id, status: 'unavailable', baseline: unavailableEndpoint('Visit comparison storage is unavailable.'), current: unavailableEndpoint('Visit comparison storage is unavailable.'), new: noChanges(), updated: noChanges(), noLongerReturned: noChanges(), limits: ['No complete comparison can be established from local storage.'] });
      return { version: 1, generatedAt: at, sessionStartedAt: marker?.current.startedAt ?? null, previousStartedAt: marker?.previous?.startedAt ?? null, error: 'Visit comparison storage is unavailable.', feeds: { nws: failed('nws'), usgs: failed('usgs') } };
    }
  }

  private checkEpoch(feed: FeedId, at: string): void {
    timestamp(at);
    const latest = this.db.prepare('SELECT observed_at FROM timeline_epochs WHERE feed = ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(feed) as Row | undefined;
    if (latest && String(latest.observed_at) > at) throw new Error('The clock moved backwards; a reply cannot be backfilled into the recorded timeline.');
  }

  private epoch(feed: FeedId, at: string, scope: string, state: string, source: string | null, until: string | null, reason: string | null, count: number): number {
    if (!scope || scope.length > 160) throw new Error('Invalid recorded feed scope.');
    return Number(this.db.prepare('INSERT INTO timeline_epochs(feed, observed_at, source_updated_at, scope, valid_until, state, reason, expected_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(feed, at, source, scope, until, state, reason, count).lastInsertRowid);
  }

  record(observation: TimelineObservation, retention: TimelineRetention): void {
    const atMs = timestamp(observation.observedAt);
    if (!Number.isFinite(observation.validForMs) || observation.validForMs < 0 || observation.validForMs > 3 * 3600_000) throw new Error('Invalid recorded freshness window.');
    if (observation.sourceUpdatedAt !== null) timestamp(observation.sourceUpdatedAt);
    const maximumRecords = TIMELINE_LIMITS.recordsPerFrame;
    const revisionLimit = Math.min(TIMELINE_LIMITS.revisions, Math.max(1, Math.floor(retention.maxRecords)));
    let omission: string | null = null;
    const prepared = new Map<string, { payload: string; bytes: number; copies: number }>();
    let bytes = 0;
    if (observation.records.length > maximumRecords) omission = `Reply has ${observation.records.length} records, exceeding the ${maximumRecords}-record archive/retention limit; no reply members retained.`;
    else for (const record of observation.records) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id) { omission = 'A normalized reply member has no valid identity; no reply members retained.'; break; }
      const payload = JSON.stringify(record);
      if (typeof payload !== 'string') { omission = 'A reply member could not be serialized; no reply members retained.'; break; }
      const size = Buffer.byteLength(payload, 'utf8');
      bytes += size;
      if (size > TIMELINE_LIMITS.bytesPerRevision || bytes > TIMELINE_LIMITS.bytesPerFrame) { omission = 'Reply exceeds the per-record or 10 MiB archive payload limit; no reply members retained.'; break; }
      const digest = createHash('sha256').update(payload).digest('hex');
      const previous = prepared.get(digest);
      if (previous) previous.copies++;
      else prepared.set(digest, { payload, bytes: size, copies: 1 });
    }
    if (!omission && prepared.size > revisionLimit) omission = `Reply needs ${prepared.size} distinct revisions, exceeding the ${revisionLimit}-revision history limit; no reply members retained.`;
    if (omission) prepared.clear();
    const skipped = observation.skippedRecords ?? 0;
    const partial = omission ?? (observation.coverageNote ? reasonText(observation.coverageNote) : null) ?? (!Number.isSafeInteger(skipped) || skipped < 0 ? 'Provider normalization completeness is unavailable; this normalized reply may be incomplete.' : skipped ? `Provider normalization omitted ${skipped} malformed record(s); recorded members are the remaining normalized reply.` : null);
    this.transaction(() => {
      this.markUntrackedVisit();
      this.checkEpoch(observation.feed, observation.observedAt);
      const epoch = this.epoch(observation.feed, observation.observedAt, observation.scope, partial ? 'partial' : 'recorded', observation.sourceUpdatedAt,
        new Date(atMs + observation.validForMs).toISOString(), partial, omission ? 0 : observation.records.length);
      const members = new Map<number, number>();
      const find = this.db.prepare('SELECT id FROM timeline_revisions WHERE feed = ? AND digest = ?');
      const insert = this.db.prepare('INSERT INTO timeline_revisions(feed, digest, payload, bytes) VALUES (?, ?, ?, ?)');
      for (const [digest, record] of prepared) {
        const known = find.get(observation.feed, digest) as Row | undefined;
        const revision = known ? Number(known.id) : Number(insert.run(observation.feed, digest, record.payload, record.bytes).lastInsertRowid);
        members.set(revision, record.copies);
      }
      const active = this.db.prepare('SELECT id, revision_id, copies FROM timeline_memberships WHERE feed = ? AND end_epoch IS NULL').all(observation.feed) as Row[];
      const close = this.db.prepare('UPDATE timeline_memberships SET end_epoch = ? WHERE id = ?');
      for (const row of active) {
        const id = Number(row.revision_id);
        if (members.get(id) === Number(row.copies)) members.delete(id);
        else close.run(epoch, row.id as number);
      }
      const open = this.db.prepare('INSERT INTO timeline_memberships(feed, revision_id, start_epoch, end_epoch, copies) VALUES (?, ?, ?, NULL, ?)');
      for (const [revision, copies] of members) open.run(observation.feed, revision, epoch, copies);
      this.pruneWithinTransaction(retention, observation.observedAt);
    });
  }

  gap(feed: FeedId, at: string, scope: string, reason: string, retention: TimelineRetention): void {
    this.transaction(() => {
      this.markUntrackedVisit();
      this.checkEpoch(feed, at);
      const previous = this.db.prepare('SELECT id, state, scope, reason FROM timeline_epochs WHERE feed = ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(feed) as Row | undefined;
      const note = reasonText(reason);
      // Preserve the first gap boundary; repeated failed polls do not reopen earlier data or grow a log.
      const sameVisit = !this.visit || Number(previous?.id) > this.visit.current.startEpoch;
      if (!(previous?.state === 'gap' && previous.scope === scope && previous.reason === note && sameVisit)) this.epoch(feed, at, scope, 'gap', null, null, note, 0);
      this.pruneWithinTransaction(retention, at);
    });
  }

  private collectUnreferenced(): void {
    for (const feed of ['nws', 'usgs']) {
      const first = this.db.prepare("SELECT MIN(id) AS n FROM timeline_epochs WHERE feed = ? AND state != 'gap'").get(feed) as Row;
      if (first.n === null) this.db.prepare('DELETE FROM timeline_memberships WHERE feed = ?').run(feed);
      else this.db.prepare('DELETE FROM timeline_memberships WHERE feed = ? AND end_epoch IS NOT NULL AND end_epoch <= ?').run(feed, first.n as number);
    }
    this.db.exec('DELETE FROM timeline_revisions WHERE NOT EXISTS (SELECT 1 FROM timeline_memberships m WHERE m.revision_id = timeline_revisions.id)');
  }

  private pruneWithinTransaction(retention: TimelineRetention, at: string): void {
    const cutoff = new Date(timestamp(at) - Math.max(1, Math.min(365, retention.days)) * 86400_000).toISOString();
    this.db.prepare('DELETE FROM timeline_epochs WHERE observed_at < ?').run(cutoff);
    this.db.prepare('DELETE FROM timeline_epochs WHERE id IN (SELECT id FROM timeline_epochs ORDER BY observed_at DESC, id DESC LIMIT -1 OFFSET ?)').run(TIMELINE_LIMITS.epochs);
    this.collectUnreferenced();
    const revisionLimit = Math.min(TIMELINE_LIMITS.revisions, Math.max(1, Math.floor(retention.maxRecords)));
    // Whole epochs are removed, never arbitrary members from an apparently complete reply.
    for (let pass = 0; pass <= Math.ceil(TIMELINE_LIMITS.epochs / 256); pass++) {
      const stats = this.stats();
      if (stats.revisions <= revisionLimit && stats.payloadBytes <= TIMELINE_LIMITS.payloadBytes && stats.intervals <= TIMELINE_LIMITS.intervals) return;
      if (!stats.epochs) throw new Error('Recorded timeline limits could not be satisfied.');
      this.db.prepare('DELETE FROM timeline_epochs WHERE id IN (SELECT id FROM timeline_epochs ORDER BY observed_at, id LIMIT ?)').run(Math.min(256, Math.max(1, stats.epochs - 1)));
      this.collectUnreferenced();
    }
    throw new Error('Recorded timeline pruning exceeded its bounded work budget.');
  }

  prune(retention: TimelineRetention, at: string): void { this.transaction(() => this.pruneWithinTransaction(retention, at)); }

  /** Caller combines this with clearing legacy event rows in its existing transaction. */
  clearWithinTransaction(): void {
    this.db.exec('DELETE FROM timeline_memberships; DELETE FROM timeline_epochs; DELETE FROM timeline_revisions;');
  }

  range(): { oldest: string | null; newest: string | null; nwsFrames: number; usgsFrames: number } {
    const counts = this.db.prepare("SELECT SUM(feed = 'nws' AND state != 'gap') AS nws, SUM(feed = 'usgs' AND state != 'gap') AS usgs FROM timeline_epochs").get() as Row;
    const nwsFrames = Number(counts.nws ?? 0), usgsFrames = Number(counts.usgs ?? 0);
    const span = this.db.prepare('SELECT MIN(observed_at) AS oldest, MAX(observed_at) AS newest FROM timeline_epochs').get() as Row;
    return { oldest: nwsFrames + usgsFrames ? span.oldest as string : null, newest: nwsFrames + usgsFrames ? span.newest as string : null, nwsFrames, usgsFrames };
  }

  private feedFrame<T>(feed: FeedId, at: string): RecordedFeed<T> {
    const epoch = this.db.prepare('SELECT * FROM timeline_epochs WHERE feed = ? AND observed_at <= ? ORDER BY observed_at DESC, id DESC LIMIT 1').get(feed, at) as Row | undefined;
    if (!epoch) return empty('unknown', 'No retained observation was recorded at or before this cursor; recording may not have started, or retention/storage limits removed it.');
    if (epoch.state === 'gap') return empty('gap', `${String(epoch.reason)} Gap recorded at ${String(epoch.observed_at)}.`, String(epoch.scope));
    const next = this.db.prepare('SELECT observed_at FROM timeline_epochs WHERE feed = ? AND (observed_at > ? OR (observed_at = ? AND id > ?)) ORDER BY observed_at, id LIMIT 1').get(feed, epoch.observed_at as string, epoch.observed_at as string, epoch.id as number) as Row | undefined;
    const until = next && String(next.observed_at) < String(epoch.valid_until) ? String(next.observed_at) : String(epoch.valid_until);
    if (at > until) return empty('gap', `The last recorded observation at ${String(epoch.observed_at)} is outside its bounded freshness window ending at ${until}.`, String(epoch.scope));
    const rows = this.db.prepare('SELECT r.payload, m.copies FROM timeline_memberships m JOIN timeline_revisions r ON r.id = m.revision_id WHERE m.feed = ? AND m.start_epoch <= ? AND (m.end_epoch IS NULL OR m.end_epoch > ?) ORDER BY m.id').all(feed, epoch.id as number, epoch.id as number) as Row[];
    const records: T[] = [];
    let damaged = false;
    for (const row of rows) {
      try {
        const copies = Number(row.copies);
        if (!Number.isInteger(copies) || copies < 1 || records.length + copies > TIMELINE_LIMITS.recordsPerFrame) { damaged = true; continue; }
        const record = JSON.parse(String(row.payload)) as T;
        if (!record || typeof record !== 'object' || typeof (record as { id?: unknown }).id !== 'string') { damaged = true; continue; }
        for (let i = 0; i < copies; i++) records.push(record);
      } catch { damaged = true; }
    }
    if (records.length !== Number(epoch.expected_count)) damaged = true;
    return { state: damaged ? 'partial' : epoch.state as 'recorded' | 'partial', observedAt: String(epoch.observed_at), sourceUpdatedAt: epoch.source_updated_at as string | null, scope: String(epoch.scope), validUntil: until, reason: damaged ? 'Some retained reply revisions are missing or malformed; this frame is incomplete.' : epoch.reason as string | null, records };
  }

  frame(at: string): TimelineHazards {
    timestamp(at);
    return { nws: this.feedFrame<WeatherAlert>('nws', at), usgs: this.feedFrame<Earthquake>('usgs', at) };
  }
}
