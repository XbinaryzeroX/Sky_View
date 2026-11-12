import { randomUUID } from 'node:crypto';
import { areaWatchEventSchema, areaWatchRuleInputSchema, areaWatchSourceUrlSchema, compileAreaWatch, areaWatchMatchesQuake, type AreaWatchRuleInput, type AreaWatchState, type CompiledAreaWatch } from '../shared/areaWatch';
import type { AnnotationDocument } from '../shared/geojsonAnnotations';
import type { Earthquake, QuakeQuery } from '../shared/types';
import type { AreaWatchMatch, AtlasStore, StoredAreaWatchRule } from './store';

export const MAX_ENABLED_WATCH_VERTICES = 20_000;
export const AREA_WATCH_MAX_SOURCE_AGE_MS = 15 * 60_000;
export const AREA_WATCH_MAX_SOURCE_FUTURE_MS = 2 * 60_000;
export const MAX_WATCH_QUAKES_PER_POLL = 10_000;
export const MAX_WATCH_PAIRS_PER_POLL = 100_000;
export const MAX_WATCH_VERTEX_WORK_PER_POLL = 2_000_000;
const MAX_MATCHES_PER_POLL = 1000;
const WINDOW_MS = { hour: 3600_000, day: 86400_000, week: 7 * 86400_000, month: 30 * 86400_000 };
const SEEN_RETENTION_MS = 31 * 86400_000;
const geometryKey = (area: AnnotationDocument): string => JSON.stringify([area.kind, area.points]);
const seenKey = (areaId: string, quakeId: string): string => `${areaId}\0${quakeId}`;

interface PollContext {
  observedAt: string;
  sourceUpdatedAt: string | null;
  feedKey: string;
  expectedFeedKey: string;
  window: QuakeQuery['window'];
}
export interface AnnotationWatchPlan { areaId: string; record: StoredAreaWatchRule | null; remove: boolean; error: string | null }

/** Local evidence only. Cached loads/renderer reevaluations never invoke a poll evaluation. */
export class AreaWatchService {
  private cache = new Map<string, { key: string; area: CompiledAreaWatch }>();
  private transientError: string | null = null;
  private cachedState: AreaWatchState | null = null;
  constructor(private readonly store: AtlasStore) {}

  state(): AreaWatchState {
    if (this.cachedState) return this.cachedState;
    try {
      const state = this.store.areaWatchState();
      if (this.transientError) state.error = this.transientError;
      state.rules.forEach(Object.freeze); state.events.forEach(Object.freeze);
      Object.freeze(state.rules); Object.freeze(state.events);
      this.cachedState = Object.freeze(state);
      return this.cachedState;
    } catch {
      return { rules: [], events: [], lastEvaluatedAt: null, error: 'Area-watch storage is unavailable; no complete local evaluation can be shown.' };
    }
  }

  private fail(message: string): void {
    this.transientError = message.slice(0, 400);
    this.cachedState = null;
    try { this.store.setAreaWatchError(this.transientError); } catch { /* Keep a local failure distinct from provider health. */ }
  }

  private annotations(): Map<string, AnnotationDocument> {
    return new Map(this.store.enabledAreaWatchAnnotations().map(area => [area.id, area]));
  }

  private enforceVertexBudget(input: AreaWatchRuleInput, area: AnnotationDocument): void {
    if (!input.enabled) return;
    const annotations = this.annotations();
    let vertices = area.points.length;
    for (const { rule } of this.store.areaWatchRuleRecords(true)) if (rule.areaId !== input.areaId)
      vertices += annotations.get(rule.areaId)?.points.length ?? 0;
    if (vertices > MAX_ENABLED_WATCH_VERTICES) throw new Error('Enabled area watches exceed the shared 20,000-vertex budget; simplify areas or disable another watch.');
  }

  putRule(value: AreaWatchRuleInput, at: string): void {
    const input = areaWatchRuleInputSchema.parse(value);
    const area = this.store.getAnnotation(input.areaId);
    if (!area) throw new Error('The area annotation no longer exists.');
    compileAreaWatch(area, input);
    this.enforceVertexBudget(input, area);
    const previous = this.store.areaWatchRuleRecord(input.areaId);
    const key = geometryKey(area);
    const rearm = !previous || (!previous.rule.enabled && input.enabled) || previous.rule.minMagnitude !== input.minMagnitude || previous.geometryKey !== key;
    this.store.putAreaWatchRule({ rule: { ...input, createdAt: previous?.rule.createdAt ?? at, updatedAt: at, armedAt: rearm ? at : previous.rule.armedAt }, geometryKey: key });
    this.cache.delete(input.areaId);
    this.transientError = null;
    this.cachedState = null;
  }

  deleteRule(areaId: string): boolean {
    const removed = this.store.deleteAreaWatch(areaId);
    this.cache.delete(areaId);
    this.cachedState = null;
    this.transientError = null;
    return removed;
  }

  /** Pure preparation: scene import can commit drawings and rule epochs in one transaction. */
  planAnnotationChanges(annotations: readonly AnnotationDocument[], at: string): AnnotationWatchPlan[] {
    const incoming = new Map(annotations.map(annotation => [annotation.id, annotation]));
    const plans: AnnotationWatchPlan[] = [];
    const budget = { remaining: 1_000_000 };
    for (const previous of this.store.areaWatchRuleRecords()) {
      const annotation = incoming.get(previous.rule.areaId);
      if (!annotation || previous.geometryKey === geometryKey(annotation)) continue;
      if (annotation.kind !== 'area') {
        plans.push({ areaId: annotation.id, record: null, remove: true, error: 'An area watch was removed because its annotation is no longer an area.' });
        continue;
      }
      let enabled = previous.rule.enabled;
      let error: string | null = null;
      try { compileAreaWatch(annotation, previous.rule, budget); }
      catch { enabled = false; error = 'An area watch was disabled because the edited geometry is invalid or exceeds the shared geometry budget.'; }
      plans.push({ areaId: annotation.id, record: { rule: { ...previous.rule, enabled, updatedAt: at, armedAt: at }, geometryKey: geometryKey(annotation) }, remove: false, error });
    }
    const byId = new Map(plans.map(plan => [plan.areaId, plan]));
    let vertices = 0;
    for (const annotation of this.store.enabledAreaWatchAnnotations()) {
      const plan = byId.get(annotation.id);
      if (plan?.remove || plan?.record?.rule.enabled === false) continue;
      vertices += (incoming.get(annotation.id) ?? annotation).points.length;
    }
    // Only changed watches can be disabled by an import; unrelated rules retain their state/epoch.
    for (const plan of [...plans].reverse()) if (vertices > MAX_ENABLED_WATCH_VERTICES && plan.record?.rule.enabled) {
      plan.record = { ...plan.record, rule: { ...plan.record.rule, enabled: false } };
      plan.error = 'An area watch was disabled because imported geometry exceeds the shared 20,000-vertex budget.';
      vertices -= incoming.get(plan.areaId)!.points.length;
    }
    return plans;
  }

  adoptAnnotationCommit(annotations: readonly AnnotationDocument[]): void {
    for (const annotation of annotations) this.cache.delete(annotation.id);
    this.cachedState = null;
    this.transientError = null;
  }

  /** Keep annotation edits and rule geometry epochs consistent, without rejecting the drawing itself. */
  putAnnotation(annotation: AnnotationDocument, at: string): void {
    const plan = this.planAnnotationChanges([annotation], at)[0];
    this.store.putAnnotationWithAreaWatch(annotation, plan?.record ?? null, plan?.remove ?? false, plan?.error ?? undefined);
    this.adoptAnnotationCommit([annotation]);
  }

  deleteAnnotation(areaId: string): boolean {
    const removed = this.store.deleteAnnotationWithAreaWatch(areaId);
    this.cache.delete(areaId);
    this.cachedState = null;
    this.transientError = null;
    return removed;
  }

  readEvents(ids: readonly string[]): void { this.store.readAreaWatchEvents(ids); this.cachedState = null; }

  defer(message: string): void { this.fail(message); }

  private compiled(record: StoredAreaWatchRule, area: AnnotationDocument, budget: { remaining: number }): CompiledAreaWatch {
    const key = JSON.stringify([record.geometryKey, record.rule.minMagnitude, record.rule.enabled, area.name]);
    const cached = this.cache.get(record.rule.areaId);
    if (cached?.key === key) return cached.area;
    const compiled = compileAreaWatch(area, record.rule, budget);
    this.cache.set(record.rule.areaId, { key, area: compiled });
    return compiled;
  }

  evaluate(quakes: readonly Earthquake[], context: PollContext): void {
    try { this.evaluatePoll(quakes, context); }
    catch (error) {
      this.fail(error instanceof Error && error.message.startsWith('Area-watch deduplication capacity') ? error.message : 'Area-watch evaluation could not be committed. Previous evidence is retained; the successful USGS retrieval is separate from this local failure.');
    }
  }

  private evaluatePoll(quakes: readonly Earthquake[], context: PollContext): void {
    let records = this.store.areaWatchRuleRecords(true);
    if (!records.length) return;
    const now = Date.parse(context.observedAt), source = context.sourceUpdatedAt ? Date.parse(context.sourceUpdatedAt) : NaN;
    if (context.feedKey !== context.expectedFeedKey) { this.fail('The USGS query changed while its request was in flight; area watches await a response for the current feed.'); return; }
    if (!Number.isFinite(source) || now - source > AREA_WATCH_MAX_SOURCE_AGE_MS || source - now > AREA_WATCH_MAX_SOURCE_FUTURE_MS) {
      this.fail('USGS generation time is missing, over 15 minutes old or over 2 minutes in the future; area watches were not evaluated.'); return;
    }
    const last = this.state().lastEvaluatedAt;
    if (last && now < Date.parse(last)) { this.fail('The local clock moved backwards; area watches await the previous evaluation time.'); return; }
    const annotations = this.annotations();
    // A direct/legacy document write cannot leave a stale compiled polygon active.
    for (const record of records) {
      const area = annotations.get(record.rule.areaId);
      if (!area) { this.fail('An enabled watch has no area annotation; evaluation was not completed.'); return; }
      if (geometryKey(area) !== record.geometryKey) this.putAnnotation(area, context.observedAt);
    }
    records = this.store.areaWatchRuleRecords(true);
    const compileBudget = { remaining: 1_000_000 };
    const areas = records.map(record => ({ record, area: this.compiled(record, annotations.get(record.rule.areaId)!, compileBudget) }));
    if (areas.reduce((sum, item) => sum + item.area.vertexCount, 0) > MAX_ENABLED_WATCH_VERTICES) {
      this.fail('Enabled area watches exceed the shared 20,000-vertex budget; evaluation was not completed.'); return;
    }
    this.store.pruneAreaWatchSeen(new Date(now - SEEN_RETENTION_MS).toISOString());
    const seen = this.store.areaWatchSeenKeys(), matches: AreaWatchMatch[] = [];
    let pairs = 0, vertexWork = 0;
    let partial: string | null = quakes.length > MAX_WATCH_QUAKES_PER_POLL ? 'Area-watch evaluation is partial: the 10,000-record poll limit was reached.' : null;
    outer: for (let i = 0; i < Math.min(quakes.length, MAX_WATCH_QUAKES_PER_POLL); i++) {
      const quake = quakes[i], occurred = Date.parse(quake.time);
      if (quake.eventType !== 'earthquake' || !Number.isFinite(occurred) || occurred > now || occurred < now - WINDOW_MS[context.window] || typeof quake.mag !== 'number' || !Number.isFinite(quake.mag)) continue;
      const aliases = [...new Set([quake.id, ...quake.ids])];
      if (aliases.length > 64 || aliases.some(alias => typeof alias !== 'string' || !alias || alias.length > 160 || /[\u0000-\u001f\u007f]/.test(alias))) {
        partial = 'Area-watch evaluation is partial: unsupported publisher IDs were skipped.'; continue;
      }
      for (const { record, area } of areas) {
        if (occurred <= Date.parse(record.rule.armedAt)) continue;
        if (++pairs > MAX_WATCH_PAIRS_PER_POLL) { partial = 'Area-watch evaluation is partial: the 100,000 candidate-pair work limit was reached.'; break outer; }
        const known = aliases.some(alias => seen.has(seenKey(area.areaId, alias)));
        if (known && aliases.every(alias => seen.has(seenKey(area.areaId, alias)))) continue;
        if (!known) {
          if (quake.mag < area.minMagnitude) continue;
          const [west, south, east, north] = area.bbox;
          const lon = quake.lon + 360 * Math.round(((west + east) / 2 - quake.lon) / 360);
          if (quake.lat < south || quake.lat > north || lon < west || lon > east) continue;
          vertexWork += area.vertexCount;
          if (vertexWork > MAX_WATCH_VERTEX_WORK_PER_POLL) { partial = 'Area-watch evaluation is partial: the 2,000,000-vertex work limit was reached.'; break outer; }
          if (!areaWatchMatchesQuake(area, quake)) continue;
        }
        const url = areaWatchSourceUrlSchema.safeParse(quake.url);
        const event = areaWatchEventSchema.safeParse({ id: randomUUID(), areaId: area.areaId, areaName: area.areaName, quakeId: quake.id, quakeTime: quake.time, magnitude: quake.mag, lat: quake.lat, lon: quake.lon, minMagnitude: area.minMagnitude, detectedAt: context.observedAt, url: url.success ? url.data : null, read: false });
        if (!event.success) continue;
        matches.push({ event: event.data, aliases });
        for (const alias of aliases) seen.add(seenKey(area.areaId, alias));
        if (matches.length >= MAX_MATCHES_PER_POLL) { partial = 'Area-watch evaluation is partial: the 1,000-match commit limit was reached.'; break outer; }
      }
    }
    this.store.commitAreaWatchMatches(matches, context.observedAt, partial);
    this.transientError = null;
    this.cachedState = null;
  }
}
