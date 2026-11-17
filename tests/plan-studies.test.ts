import { describe, expect, it } from 'vitest';
import { buildPlanBriefing, newPlan, planSchema, rooftopStudyIsStale, type ProtectivePlan, type RooftopStudy, type RouteStudy } from '../src/shared/protectivePlan';

const T = new Date('2026-11-13T12:00:00Z');
const site = { name: 'Test', lat: 60.168, lon: 24.942, origin: 'globe' as const, savedLocationId: null };
const roofs = (over: Partial<RooftopStudy> = {}): RooftopStudy => ({
  at: '2026-11-13T11:00:00.000Z',
  subject: { lat: site.lat, lon: site.lon },
  subjectHeightM: 1.7,
  roofEyeM: 1.5,
  subjectRoofM: null,
  radiusM: 300,
  cellM: 4,
  groupsInRange: 120,
  undetermined: 4,
  unknownBuildingCells: 0,
  total: 2,
  items: [
    { lat: 60.1683, lon: 24.942, distanceM: 34, bearingDeg: 2, heightM: 22, elevationDeg: 33, clearShare: 0.6 },
    { lat: 60.168, lon: 24.9435, distanceM: 82, bearingDeg: 91, heightM: 30, elevationDeg: 19, clearShare: 1 },
  ],
  ...over,
});
const routeStudy = (annotationId: string | null = null): RouteStudy => ({
  at: '2026-11-13T11:05:00.000Z',
  mode: 'walk',
  a: { lat: site.lat, lon: site.lon },
  b: { lat: 60.1625, lon: 24.95 },
  roads: { tiles: 12, failed: 1 },
  overlookRangeM: 300,
  options: [
    { lengthM: 1061, minutes: 13.3, majorShare: 0, junctions: 56, via: ['Katariinankatu'], startGapM: 27, endGapM: 14, overlook: { overlooked: 1, clear: 0, unknown: 0, outside: 0.6, rooftops: 70 }, annotationId },
    { lengthM: 1132, minutes: 14.2, majorShare: 0.1, junctions: 38, via: [], startGapM: 27, endGapM: 14, overlook: null, annotationId: null },
  ],
});
const withStudies = (p: ProtectivePlan, extra: Partial<ProtectivePlan>): ProtectivePlan => ({ ...p, ...extra });

describe('saved rooftop and route studies', () => {
  it('opens plans saved before these fields existed', () => {
    const old = { ...newPlan(site, T) } as Record<string, unknown>;
    delete old.rooftops;
    delete old.routeStudy;
    const parsed = planSchema.parse(old);
    expect(parsed.rooftops).toBeNull();
    expect(parsed.routeStudy).toBeNull();
  });

  it('validates the studies strictly and keeps them when saved', () => {
    const p = withStudies(newPlan(site, T), { rooftops: roofs(), routeStudy: routeStudy() });
    expect(planSchema.parse(p).rooftops?.items).toHaveLength(2);
    expect(planSchema.safeParse(withStudies(p, { rooftops: { ...roofs(), items: [{ ...roofs().items[0], clearShare: 2 }] } })).success).toBe(false);
    expect(planSchema.safeParse(withStudies(p, { routeStudy: { ...routeStudy(), extra: 1 } as unknown as RouteStudy })).success).toBe(false);
    expect(planSchema.safeParse(withStudies(p, { routeStudy: { ...routeStudy(), options: [...routeStudy().options, ...routeStudy().options] } })).success).toBe(false);
  });

  it('marks a rooftop list out of date when the subject moved or its height changed', () => {
    const p = withStudies(newPlan(site, T), { rooftops: roofs() });
    expect(rooftopStudyIsStale(p)).toBe(false);
    expect(rooftopStudyIsStale({ ...p, site: { ...p.site, lon: p.site.lon + 0.0001 } })).toBe(true);
    expect(rooftopStudyIsStale({ ...p, analysis: { ...p.analysis, targetHeightM: 1.2 } })).toBe(true);
    expect(rooftopStudyIsStale(newPlan(site, T))).toBe(false);
  });
});

describe('briefing', () => {
  const brief = (p: ProtectivePlan) => buildPlanBriefing(p, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' });

  it('lists the rooftops, puts them on the site diagram, and states the limits', () => {
    const html = brief(withStudies(newPlan(site, T), { rooftops: roofs({ undetermined: 4, unknownBuildingCells: 9 }) }));
    expect(html).toContain('Rooftops with a line of sight to the subject');
    expect(html).toContain('<strong>2</strong> of 120 mapped roofs');
    expect(html).toContain('4 could not be decided');
    expect(html).toContain('unavailable for 9 cells');
    expect(html).toContain('<td>R1</td>');
    expect(html).toContain('E 91°');
    expect(html).toContain('>R2</text>'); // on the diagram
    expect(html).toContain('a roof that is not listed is not shown to be safe');
    expect(html).not.toContain('Out of date');
  });

  it('says when the list is out of date, and leaves it off the diagram', () => {
    const p = withStudies(newPlan(site, T), { rooftops: roofs() });
    const html = brief({ ...p, site: { ...p.site, lat: p.site.lat + 0.001 } });
    expect(html).toContain('Out of date.</strong> The subject moved');
    expect(html).not.toContain('>R1</text>');
  });

  it('says when the subject was modelled on a roof, and when rooftops were not checked', () => {
    expect(brief(withStudies(newPlan(site, T), { rooftops: roofs({ subjectRoofM: 28 }) }))).toContain('standing on its roof (28 m up)');
    expect(brief(newPlan(site, T))).toContain('Rooftops were not checked for this plan.');
  });

  it('lists the route options with their measures and which one the plan uses', () => {
    const p = newPlan(site, T);
    const withRole = withStudies(p, { roles: [{ annotationId: 'r1', role: 'primary-route', mode: 'walk', note: '', snapshot: null }], routeStudy: routeStudy('r1') });
    const html = brief(withRole);
    expect(html).toContain('Route options considered');
    expect(html).toContain('1 · via Katariinankatu');
    expect(html).toContain('100% · 70 roofs · 60% outside the area');
    expect(html).toContain('not computed');
    expect(html).toContain('<strong>1 could not be loaded</strong>');
    expect(html).toContain('Primary route');
    expect(html).toContain('not a safety rating');
    expect(brief(p)).not.toContain('Route options considered');
  });

  it('escapes street names from the map data', () => {
    const rs = routeStudy();
    rs.options[0].via = ['<script>x</script>'];
    const html = brief(withStudies(newPlan(site, T), { routeStudy: rs }));
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });
});
