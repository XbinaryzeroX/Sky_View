// Revision handling: avoid double-counting updated or superseded records.

import type { Earthquake, FeedDiff, FeedId, WeatherAlert } from './types';

/**
 * Returns the ids of alerts in the set that are referenced (updated/replaced)
 * by another alert in the same set. Those older revisions should not be
 * counted as separate active alerts.
 */
export function supersededAlertIds(alerts: WeatherAlert[]): Set<string> {
  const present = new Set(alerts.map((a) => a.id));
  const superseded = new Set<string>();
  for (const a of alerts) {
    for (const ref of a.references) {
      if (ref !== a.id && present.has(ref)) superseded.add(ref);
    }
  }
  return superseded;
}

/** True when an alert should count as currently in effect for monitoring purposes. */
export function isAlertCountable(a: WeatherAlert, superseded: Set<string>, nowMs: number): boolean {
  if (superseded.has(a.id)) return false;
  if (a.messageType === 'Cancel') return false;
  if (a.status !== 'Actual') return false;
  const end = a.ends ?? a.expires;
  if (end && Date.parse(end) <= nowMs) return false;
  return true;
}

/**
 * Collapses earthquakes that share any associated id (the same physical event
 * reported by several networks). Keeps the most recently updated record.
 */
export function dedupeQuakes(quakes: Earthquake[]): Earthquake[] {
  const byAnyId = new Map<string, Earthquake>();
  const result: Earthquake[] = [];
  for (const q of quakes) {
    const existing = q.ids.map((id) => byAnyId.get(id)).find((x) => x !== undefined);
    if (!existing) {
      result.push(q);
      for (const id of q.ids) byAnyId.set(id, q);
      continue;
    }
    const keepNew = Date.parse(q.updated) > Date.parse(existing.updated);
    const winner = keepNew ? q : existing;
    const merged: Earthquake = { ...winner, ids: [...new Set([...existing.ids, ...q.ids])] };
    const idx = result.indexOf(existing);
    result[idx] = merged;
    for (const id of merged.ids) byAnyId.set(id, merged);
  }
  return result;
}

interface Revisioned {
  id: string;
  rev: string;
}

/** Computes added / updated / removed ids between two refreshes. */
export function computeDiff(feed: FeedId, prev: Revisioned[] | null, next: Revisioned[], at: string, previousAt: string | null, unavailableReason?: string): FeedDiff {
  if (unavailableReason) return { feed, at, previousAt, unavailableReason, added: [], updated: [], removed: [] };
  const prevMap = new Map((prev ?? []).map((r) => [r.id, r.rev]));
  const nextMap = new Map(next.map((r) => [r.id, r.rev]));
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  if (prev) {
    for (const [id, rev] of nextMap) {
      if (!prevMap.has(id)) added.push(id);
      else if (prevMap.get(id) !== rev) updated.push(id);
    }
    for (const id of prevMap.keys()) if (!nextMap.has(id)) removed.push(id);
  }
  return { feed, at, added, updated, removed, previousAt };
}

export function describeFeedDiff(diff: FeedDiff | undefined): string | null {
  if (!diff?.previousAt) return null;
  const name = diff.feed === 'nws' ? 'Alerts' : 'Earthquakes';
  if (diff.unavailableReason) return `${name}: change counts unknown`;
  return `${name}: ${diff.added.length} new, ${diff.updated.length} updated, ${diff.removed.length} no longer returned`;
}

export function alertRevisions(alerts: WeatherAlert[]): Revisioned[] {
  return alerts.map((a) => ({ id: a.id, rev: `${a.sent ?? ''}|${a.expires ?? ''}|${a.messageType}` }));
}

export function quakeRevisions(quakes: Earthquake[]): Revisioned[] {
  return quakes.map((q) => ({ id: q.id, rev: q.updated }));
}
