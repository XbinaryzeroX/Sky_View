import { describe, expect, it } from 'vitest';
import {
  AREA_WATCH_DEFAULT_MIN_MAGNITUDE, AREA_WATCH_MAX_MAGNITUDE, AREA_WATCH_MIN_MAGNITUDE,
  areaWatchContains, areaWatchEventSchema, areaWatchMatchesQuake, areaWatchRuleInputSchema,
  areaWatchRuleSchema, areaWatchSourceUrlSchema, compileAreaWatch, type AreaWatchRuleInput,
} from '../src/shared/areaWatch';
import { previewGeoJsonAnnotations, type AnnotationDocument } from '../src/shared/geojsonAnnotations';

const now = '2026-11-11T12:00:00.000Z';
const square: [number, number][] = [[10, -30], [12, -30], [12, -28], [10, -28]];
const annotation = (points = square, over: Partial<AnnotationDocument> = {}): AnnotationDocument => ({ id: 'area-1', kind: 'area', name: '南 / South', color: '#123456', points, visible: true, createdAt: now, ...over });
const rule = (over: Partial<AreaWatchRuleInput> = {}): AreaWatchRuleInput => ({ areaId: 'area-1', minMagnitude: AREA_WATCH_DEFAULT_MIN_MAGNITUDE, enabled: true, ...over });
const quake = (over: Partial<{ lat: number; lon: number; mag: number | null }> = {}) => ({ lat: -29, lon: 11, mag: 3.1, ...over });

describe('narrow local area-watch contract', () => {
  it('validates only the rule fields the renderer may choose, without coercion', () => {
    expect(areaWatchRuleInputSchema.parse(rule())).toEqual(rule());
    for (const value of [
      rule({ minMagnitude: NaN }), rule({ minMagnitude: Infinity }),
      rule({ minMagnitude: AREA_WATCH_MIN_MAGNITUDE - 0.1 }), rule({ minMagnitude: AREA_WATCH_MAX_MAGNITUDE + 0.1 }),
      { ...rule(), minMagnitude: '3' }, { ...rule(), enabled: 1 },
      rule({ areaId: '../private' }), rule({ areaId: 'a'.repeat(101) }),
      { ...rule(), armedAt: now }, { ...rule(), points: square }, { ...rule(), url: 'https://example.com' },
    ]) expect(areaWatchRuleInputSchema.safeParse(value).success).toBe(false);
    expect(areaWatchRuleInputSchema.parse(rule({ minMagnitude: AREA_WATCH_MIN_MAGNITUDE })).minMagnitude).toBe(-2);
    expect(areaWatchRuleInputSchema.parse(rule({ minMagnitude: AREA_WATCH_MAX_MAGNITUDE })).minMagnitude).toBe(11);
    expect(areaWatchRuleSchema.parse({ ...rule(), createdAt: now, updatedAt: now, armedAt: now }).armedAt).toBe(now);
    expect(areaWatchRuleSchema.safeParse({ ...rule(), createdAt: now, updatedAt: now }).success).toBe(false);
  });
  it('retains independently bounded evidence, including the threshold and source at detection', () => {
    const evidence = { id: 'evidence-1', areaId: 'area-1', areaName: '南 / South', quakeId: 'us-test', quakeTime: now, magnitude: 3.1, lat: -29, lon: 11, minMagnitude: 2.5, detectedAt: now, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us-test', read: false };
    expect(areaWatchEventSchema.parse(evidence)).toEqual(evidence);
    expect(areaWatchEventSchema.safeParse({ ...evidence, lat: 91 }).success).toBe(false);
    expect(areaWatchEventSchema.safeParse({ ...evidence, magnitude: null }).success).toBe(false);
    expect(areaWatchEventSchema.safeParse({ ...evidence, quakeTime: 'not a date' }).success).toBe(false);
    expect(areaWatchEventSchema.safeParse({ ...evidence, areaName: 'Name\nControl' }).success).toBe(false);
    expect(areaWatchEventSchema.safeParse({ ...evidence, notes: 'private' }).success).toBe(false);
    expect(areaWatchEventSchema.safeParse({ ...evidence, read: undefined }).success).toBe(false);
  });
  it('accepts no external host or credential-bearing link in saved USGS evidence', () => {
    expect(areaWatchSourceUrlSchema.parse(null)).toBeNull();
    expect(areaWatchSourceUrlSchema.parse('https://earthquake.usgs.gov/earthquakes/eventpage/us-test')).toContain('us-test');
    for (const value of [
      'http://earthquake.usgs.gov/earthquakes/eventpage/us-test', 'https://earthquake.usgs.gov.evil.example/event',
      'https://earthquake.usgs.gov@evil.example/event', 'https://user:password@earthquake.usgs.gov/event',
      'https://earthquake.usgs.gov:444/event', 'javascript:alert(1)', 'file:///C:/private',
    ]) expect(areaWatchSourceUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe('compiled area geometry with explicit planar and boundary semantics', () => {
  it('contains known southern-hemisphere interior, edge and vertex positions, excluding exterior points', () => {
    const compiled = compileAreaWatch(annotation(), rule());
    expect(compiled.bbox).toEqual([10, -30, 12, -28]);
    expect(compiled.vertexCount).toBe(4);
    expect(compiled.areaName).toBe('南 / South');
    for (const [lat, lon] of [[-29, 11], [-30, 11], [-28, 11], [-29, 10], [-29, 12], [-30, 10], [-28, 12]])
      expect(areaWatchContains(compiled, lat, lon)).toBe(true);
    for (const [lat, lon] of [[-30.001, 11], [-27.999, 11], [-29, 9.999], [-29, 12.001], [29, 11]])
      expect(areaWatchContains(compiled, lat, lon)).toBe(false);
  });
  it('checks concavity after the precomputed bounds rather than accepting every bbox point', () => {
    const compiled = compileAreaWatch(annotation([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]), rule());
    expect(areaWatchContains(compiled, 0.5, 3)).toBe(true);
    expect(areaWatchContains(compiled, 3, 0.5)).toBe(true);
    expect(areaWatchContains(compiled, 3, 3)).toBe(false);
    expect(areaWatchContains(compiled, 1, 3)).toBe(true);
    expect(areaWatchContains(compiled, 1.00001, 3)).toBe(false);
  });
  it.each([false, true])('uses the short date-line strip in either winding direction (reverse=%s)', reverse => {
    const strip: [number, number][] = [[179, -20], [-179, -20], [-179, -18], [179, -18]];
    const compiled = compileAreaWatch(annotation(reverse ? [...strip].reverse() : strip), rule());
    for (const [lat, lon] of [[-19, 179.5], [-19, -179.5], [-19, 180], [-19, -180], [-20, 180], [-18, -180], [-20, 179]])
      expect(areaWatchContains(compiled, lat, lon)).toBe(true);
    for (const [lat, lon] of [[-19, 0], [-19, 178.9], [-19, -178.9], [-20.001, 180]])
      expect(areaWatchContains(compiled, lat, lon)).toBe(false);
  });
  it('treats equivalent ±180 positions as the same boundary even when the ring does not cross the date line', () => {
    const compiled = compileAreaWatch(annotation([[-180, -30], [-179, -30], [-179, -29], [-180, -29]]), rule());
    expect(areaWatchContains(compiled, -29.5, -180)).toBe(true);
    expect(areaWatchContains(compiled, -29.5, 180)).toBe(true);
  });
  it('uses straight latitude/longitude edges rather than silently testing the bowed geodesic display arc', () => {
    const compiled = compileAreaWatch(annotation([[-40, 60], [40, 60], [40, 65], [-40, 65]]), rule());
    expect(areaWatchContains(compiled, 60, 0)).toBe(true);
    expect(areaWatchContains(compiled, 59.999, 0)).toBe(false);
    expect(areaWatchContains(compiled, 64, 0)).toBe(true);
    expect(areaWatchContains(compiled, 66, 0)).toBe(false);
  });
  it('does not mutate source points, and later source edits cannot alter the compiled area', () => {
    const source = annotation(square.map(p => [...p]));
    const compiled = compileAreaWatch(source, rule());
    expect(source.points).toEqual(square);
    source.points[0][0] = 100;
    source.name = 'Edited';
    expect(areaWatchContains(compiled, -29, 11)).toBe(true);
    expect(compiled.areaName).toBe('南 / South');
    expect(Object.isFrozen(compiled.geometry.coordinates[0][0])).toBe(true);
  });
  it('accepts existing open or explicitly closed rings and ignores drawing visibility', () => {
    const closed = [...square, square[0]];
    expect(compileAreaWatch(annotation(closed, { visible: false }), rule()).vertexCount).toBe(4);
    expect(areaWatchMatchesQuake(compileAreaWatch(annotation(square, { visible: false }), rule()), quake())).toBe(true);
  });
  it('compiles a persisted rule with server-owned timestamps while the renderer input remains strict', () => {
    const persisted = areaWatchRuleSchema.parse({ ...rule(), createdAt: now, updatedAt: now, armedAt: now });
    expect(areaWatchRuleInputSchema.safeParse(persisted).success).toBe(false);
    expect(areaWatchMatchesQuake(compileAreaWatch(annotation(), persisted), quake())).toBe(true);
  });
  it('rejects invalid test positions rather than wrapping or clamping arbitrary coordinates', () => {
    const compiled = compileAreaWatch(annotation(), rule());
    for (const [lat, lon] of [[NaN, 11], [Infinity, 11], [-91, 11], [91, 11], [-29, -181], [-29, 181], [-29, NaN]])
      expect(areaWatchContains(compiled, lat, lon)).toBe(false);
  });
});

describe('watch compilation reuses the supported annotation area validator', () => {
  it.each([
    [[0, 0], [1, 0]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [4, 4], [0, 3], [3, 0]],
    [[0, 0], [3, 0], [1, 1], [3, 2], [0, 2], [1, 1]],
    [[180, 0], [-180, 0], [-179, 1], [179, 1]],
    [[0, 0], [181, 0], [1, 1]],
    [[0, 0], [1, 0], [1, Infinity]],
  ].map(points => ({ points })))('rejects the same malformed or unsupported ring as GeoJSON: $points', ({ points }) => {
    const typed = points as [number, number][];
    expect(() => compileAreaWatch(annotation(typed), rule())).toThrow();
    const imported = previewGeoJsonAnnotations(JSON.stringify({ type: 'Polygon', coordinates: [[...typed, typed[0]]] }));
    expect(imported.candidates).toEqual([]);
    expect(imported.rejected).toHaveLength(1);
  });
  it('does not silently flatten holes, altitude or malformed nested geometry', () => {
    const invalid = [
      [[[0, 0], [1, 0], [0, 1]], [[0.1, 0.1], [0.2, 0.1], [0.1, 0.2]]],
      [[0, 0, 100], [1, 0, 100], [0, 1, 100]],
    ];
    for (const points of invalid) expect(() => compileAreaWatch(annotation(points as unknown as [number, number][]), rule())).toThrow();
  });
  it('rejects non-area annotations, mismatched IDs, pole vertices and wrapping rings explicitly', () => {
    expect(() => compileAreaWatch(annotation(square, { kind: 'line' }), rule())).toThrow(/area annotation/);
    expect(() => compileAreaWatch(annotation(), rule({ areaId: 'another-area' }))).toThrow(/ID/);
    expect(() => compileAreaWatch(annotation([[0, 80], [10, 80], [0, 90]]), rule())).toThrow(/pole/);
    expect(() => compileAreaWatch(annotation([[-120, 80], [0, 81], [120, 80]]), rule())).toThrow(/pole|globe/);
  });
  it('accepts a shared bounded intersection budget for a batch of changed rules', () => {
    expect(() => compileAreaWatch(annotation(), rule(), { remaining: 0 })).toThrow(/bounded intersection/);
    const budget = { remaining: 100 };
    compileAreaWatch(annotation(), rule(), budget);
    expect(budget.remaining).toBeLessThan(100);
  });
});

describe('spatial threshold eligibility only, without fabricating feed or activation semantics', () => {
  it('includes the exact magnitude threshold and rejects missing/invalid magnitudes', () => {
    const compiled = compileAreaWatch(annotation(), rule());
    expect(areaWatchMatchesQuake(compiled, quake({ mag: 2.5 }))).toBe(true);
    for (const mag of [null, NaN, Infinity, 2.499, -3, 12]) expect(areaWatchMatchesQuake(compiled, quake({ mag }))).toBe(false);
    expect(areaWatchMatchesQuake(compiled, quake({ lat: -29, lon: 13 }))).toBe(false);
  });
  it('honors disabled rules and both permitted threshold extremes', () => {
    expect(areaWatchMatchesQuake(compileAreaWatch(annotation(), rule({ enabled: false })), quake())).toBe(false);
    expect(areaWatchMatchesQuake(compileAreaWatch(annotation(), rule({ minMagnitude: -2 })), quake({ mag: -2 }))).toBe(true);
    expect(areaWatchMatchesQuake(compileAreaWatch(annotation(), rule({ minMagnitude: 11 })), quake({ mag: 11 }))).toBe(true);
  });
});
