import { describe, expect, it } from 'vitest';
import { buildPlanBriefing, coverageObservers, newPlan, planInputsKey, planSchema, SUBJECT_OBSERVER_ID, type ProtectivePlan } from '../src/shared/protectivePlan';

const T = new Date('2026-11-14T12:00:00Z');
const site = { name: 'Square', lat: 60.16935, lon: 24.95205, origin: 'globe' as const, savedLocationId: null };
const obs = (over: Partial<ProtectivePlan['observers'][number]> = {}): ProtectivePlan['observers'][number] => ({ id: 'obs-1', name: 'Post', lat: 60.17, lon: 24.95, heightM: 1.7, kind: 'observer', headingDeg: null, fovDeg: null, rangeM: 300, direction: 'all', camera: null, note: '', ...over });

describe("the subject's own view", () => {
  it('is modelled by default, from the site marker over the whole radius at the target height', () => {
    const p = newPlan(site, T);
    expect(coverageObservers(p)).toEqual([{ id: SUBJECT_OBSERVER_ID, lat: site.lat, lon: site.lon, heightM: 1.7, rangeM: 400, headingDeg: null, fovDeg: null }]);
  });

  it('comes first, followed by added points that can be modelled; it can be switched off', () => {
    const p = { ...newPlan(site, T), observers: [obs(), obs({ id: 'cam-1', kind: 'camera', headingDeg: 90, fovDeg: 60, direction: 'user-estimate' })] };
    expect(coverageObservers(p).map((o) => o.id)).toEqual([SUBJECT_OBSERVER_ID, 'obs-1', 'cam-1']);
    expect(coverageObservers({ ...p, analysis: { ...p.analysis, subjectView: false } }).map((o) => o.id)).toEqual(['obs-1', 'cam-1']);
  });

  it('is on for plans saved before the setting existed, and its id cannot be used by an added point', () => {
    const old = newPlan(site, T) as unknown as { analysis: Record<string, unknown> };
    delete old.analysis.subjectView;
    expect(planSchema.parse(old).analysis.subjectView).toBe(true);
    expect(planSchema.safeParse({ ...newPlan(site, T), observers: [obs({ id: SUBJECT_OBSERVER_ID })] }).success).toBe(false);
  });

  it('appears in the briefing with its result', () => {
    const p = newPlan(site, T);
    p.analysis.assumeMappedComplete = true;
    const run: ProtectivePlan['lastRun'] = { at: T.toISOString(), cellM: 4, n: 201, terrain: { source: 't', level: 16, missingCells: 0 }, buildings: { source: 'b', tilesLoaded: 4, tilesFailed: 0, buildingCells: 10 }, combined: { covered: 30, overlap: 0, gap: 60, unknown: 10, analysed: 100 }, perObserver: [{ id: SUBJECT_OBSERVER_ID, counts: { visible: 30, blocked: 60, unknown: 10, analysed: 100 }, error: null }], inputsKey: '', radiusM: 400, targetHeightM: 1.7 };
    const html = buildPlanBriefing({ ...p, lastRun: { ...run, inputsKey: planInputsKey(p) } }, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' });
    expect(html).toContain('Subject (site marker)');
    expect(html).toContain('visible 30% · blocked 60% · unknown 10%');
    expect(html).not.toContain('No observation points were added.');
  });
});
