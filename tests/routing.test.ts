import { describe, expect, it } from 'vitest';
import { buildRoadGraph, clipLineToTile, joinTJunctions, lonLatToUnits, nearestNodes, routeOptions, ROUTE_EXTENT, shortestPath, unitsToLonLat, type RoadLine } from '../src/shared/routing';

describe('tile clipping', () => {
  it('splits a line at the tile edge so neighbouring tiles meet at the same point', () => {
    // A road from (4000, 100) to (4200, 300) crosses x = 4096 in tile A; tile B (one to the east) sees it at -96.
    const a = clipLineToTile([[4000, 100], [4200, 300]]);
    const b = clipLineToTile([[4000 - ROUTE_EXTENT, 100], [4200 - ROUTE_EXTENT, 300]]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0][1][0]).toBe(ROUTE_EXTENT);
    expect(b[0][0][0]).toBe(0);
    expect(a[0][1][1]).toBeCloseTo(b[0][0][1], 9);
  });

  it('drops pieces wholly in the buffer and keeps inner pieces', () => {
    expect(clipLineToTile([[-50, 10], [-10, 20]])).toEqual([]);
    expect(clipLineToTile([[10, 10], [20, 20], [30, 10]])).toEqual([[[10, 10], [20, 20], [30, 10]]]);
  });

  it('round-trips units and degrees', () => {
    const [x, y] = lonLatToUnits(-0.1276, 51.5072);
    const [lon, lat] = unitsToLonLat(x, y);
    expect(lon).toBeCloseTo(-0.1276, 9);
    expect(lat).toBeCloseTo(51.5072, 9);
  });
});

// A ladder of streets in London (one unit ≈ 0.37 m at zoom 14 / 4096 near 51.5°N, so 1000 units ≈ 370 m):
//   top rail y=0 from x=0..1000, bottom rail y=400, rungs every 200 units.
const [X0, Y0] = lonLatToUnits(-0.13, 51.51);
const P = (x: number, y: number): [number, number] => [X0 + x, Y0 + y];
const ladder = (opts: { topOneway?: -1 | 0 | 1; topClass?: string } = {}): RoadLine[] => [
  { cls: opts.topClass ?? 'primary', subclass: null, oneway: opts.topOneway ?? 0, name: 'Top Street', pts: [P(0, 0), P(200, 0), P(400, 0), P(600, 0), P(800, 0), P(1000, 0)] },
  { cls: 'minor', subclass: null, oneway: 0, name: 'Bottom Street', pts: [P(0, 400), P(200, 400), P(400, 400), P(600, 400), P(800, 400), P(1000, 400)] },
  ...[0, 200, 400, 600, 800, 1000].map((x) => ({ cls: 'minor', subclass: null, oneway: 0 as const, name: `Rung ${x}`, pts: [P(x, 0), P(x, 400)] })),
];
const ll = (x: number, y: number) => {
  const [lon, lat] = unitsToLonLat(...P(x, y));
  return { lat, lon };
};

describe('junction repair', () => {
  it('joins a side road whose end lies on a main road that lost the junction vertex', () => {
    const main: RoadLine = { cls: 'primary', subclass: null, oneway: 0, name: 'Main', pts: [P(0, 0), P(1000, 0)] };
    const side: RoadLine = { cls: 'minor', subclass: null, oneway: 0, name: 'Side', pts: [P(500, 1.5), P(500, 400)] };
    const joined = joinTJunctions([main, side]);
    expect(joined[0]).toHaveLength(3); // a vertex added on the main road
    expect(joined[1][0]).toEqual(joined[0][1]);
    const r = routeOptions(buildRoadGraph([main, side], 'walk'), ll(0, 0), ll(500, 400));
    expect(r.ok).toBe(true);
  });

  it('does not join roads that cross mid-line (a bridge over a road) or ends too far away', () => {
    const under: RoadLine = { cls: 'primary', subclass: null, oneway: 0, name: 'Under', pts: [P(0, 0), P(1000, 0)] };
    const bridge: RoadLine = { cls: 'minor', subclass: null, oneway: 0, name: 'Bridge', pts: [P(500, -400), P(500, 400)] };
    const far: RoadLine = { cls: 'minor', subclass: null, oneway: 0, name: 'Far', pts: [P(700, 20), P(700, 400)] };
    const joined = joinTJunctions([under, bridge, far]);
    expect(joined[0]).toHaveLength(2);
    expect(joined[2][0]).toEqual(far.pts[0]);
    // The bridge end cannot be reached; the search falls back to the nearest connected node and says how far it is.
    const r = routeOptions(buildRoadGraph([under, bridge, far], 'walk'), ll(0, 0), ll(500, 400));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Either way round it uses one road only and reports the unreached distance (about 240 m).
    expect(r.options[0].via).toHaveLength(1);
    expect(r.options[0].startGapM + r.options[0].endGapM).toBeGreaterThan(200);
  });

  it('joins an end near a vertex to that vertex', () => {
    const a: RoadLine = { cls: 'minor', subclass: null, oneway: 0, name: 'A', pts: [P(0, 0), P(300, 0), P(600, 0)] };
    const b: RoadLine = { cls: 'minor', subclass: null, oneway: 0, name: 'B', pts: [P(301, 1), P(301, 300)] };
    const joined = joinTJunctions([a, b]);
    expect(joined[0]).toHaveLength(3);
    expect(joined[1][0]).toEqual(joined[0][1]);
  });
});

describe('route options', () => {
  it('joins lines at shared vertices and finds the quickest route first', () => {
    const g = buildRoadGraph(ladder(), 'drive');
    const r = routeOptions(g, ll(0, 0), ll(1000, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options.length).toBeGreaterThanOrEqual(2);
    const [first, second] = r.options;
    expect(first.via[0]).toBe('Top Street');
    expect(first.majorShare).toBeCloseTo(1, 5);
    expect(second.minutes).toBeGreaterThan(first.minutes);
    expect(first.junctions).toBe(4); // the four inner rungs meet the top street
    expect(first.points[0][0]).toBeCloseTo(ll(0, 0).lon, 8);
  });

  it('respects one-way streets when driving but not when walking', () => {
    const lines = ladder({ topOneway: -1 }); // top street one way, westbound only
    const drive = routeOptions(buildRoadGraph(lines, 'drive'), ll(0, 0), ll(1000, 0));
    const walk = routeOptions(buildRoadGraph(lines, 'walk'), ll(0, 0), ll(1000, 0));
    expect(drive.ok && drive.options[0].via[0]).toBe('Bottom Street');
    expect(walk.ok && walk.options[0].via[0]).toBe('Top Street');
  });

  it('does not walk on motorways or drive on footpaths', () => {
    const lines: RoadLine[] = [
      { cls: 'motorway', subclass: null, oneway: 0, name: 'M1', pts: [P(0, 0), P(1000, 0)] },
      { cls: 'path', subclass: 'footway', oneway: 0, name: null, pts: [P(0, 0), P(0, 400), P(1000, 400), P(1000, 0)] },
    ];
    const walk = routeOptions(buildRoadGraph(lines, 'walk'), ll(0, 0), ll(1000, 0));
    expect(walk.ok && walk.options[0].via).toEqual([]);
    expect(walk.ok && walk.options[0].majorShare).toBe(0);
    const drive = routeOptions(buildRoadGraph(lines, 'drive'), ll(0, 0), ll(1000, 0));
    expect(drive.ok && drive.options[0].via).toEqual(['M1']);
    expect(drive.ok && drive.options).toHaveLength(1); // no other drivable way
  });

  it('says why when there is no road near an end, no connection, or the ends are too far apart', () => {
    const g = buildRoadGraph(ladder(), 'walk');
    expect(routeOptions(g, ll(0, 0), ll(5000, 5000))).toEqual({ ok: false, reason: 'no-end' });
    expect(routeOptions(g, ll(-5000, 0), ll(0, 0))).toEqual({ ok: false, reason: 'no-start' });
    expect(routeOptions(g, { lat: 51.5, lon: -0.13 }, { lat: 51.7, lon: -0.13 })).toEqual({ ok: false, reason: 'too-far' });
    const split = buildRoadGraph([{ cls: 'minor', subclass: null, oneway: 0, name: 'A', pts: [P(0, 0), P(100, 0)] }, { cls: 'minor', subclass: null, oneway: 0, name: 'B', pts: [P(2000, 0), P(2100, 0)] }], 'walk');
    expect(routeOptions(split, ll(0, 0), ll(2100, 0))).toEqual({ ok: false, reason: 'no-path' });
  });

  it('falls back to a connected road when the nearest piece is cut off, and reports how far the route ends from the point', () => {
    // B is a short stub right at the destination with no connection; A reaches within about 55 m.
    const g = buildRoadGraph([{ cls: 'minor', subclass: null, oneway: 0, name: 'A', pts: [P(0, 0), P(100, 0)] }, { cls: 'minor', subclass: null, oneway: 0, name: 'B', pts: [P(250, 0), P(260, 0)] }], 'walk');
    const r = routeOptions(g, ll(0, 0), ll(250, 0));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options[0].via).toEqual(['A']);
    expect(r.options[0].endGapM).toBeGreaterThan(50);
    expect(r.options[0].startGapM).toBeLessThan(0.5);
  });

  it('keeps one copy of a segment drawn twice and finds nodes near a point', () => {
    const g = buildRoadGraph([...ladder(), ladder()[0]], 'walk');
    const once = buildRoadGraph(ladder(), 'walk');
    expect(g.to.length).toBe(once.to.length);
    const near = nearestNodes(g, ll(0, 0).lat, ll(0, 0).lon);
    expect(near[0].distM).toBeLessThan(0.5);
    expect(shortestPath(g, near[0].node, near[0].node)).toEqual([]);
  });
});

describe('turn-by-turn steps', () => {
  // Units: x east, y south. From the top-left corner east along Top Street, south down Rung 400, east on Bottom Street.
  it('names each street and the turn onto it', () => {
    const lines: RoadLine[] = [
      { cls: 'primary', subclass: null, oneway: 0, name: 'Top Street', pts: [P(0, 0), P(200, 0), P(400, 0)] },
      { cls: 'minor', subclass: null, oneway: 0, name: 'Rung 400', pts: [P(400, 0), P(400, 400)] },
      { cls: 'minor', subclass: null, oneway: 0, name: 'Bottom Street', pts: [P(400, 400), P(700, 400)] },
    ];
    const r = routeOptions(buildRoadGraph(lines, 'walk'), ll(0, 0), ll(700, 400), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const steps = r.options[0].steps;
    expect(steps.map((s) => s.maneuver)).toEqual(['depart', 'right', 'left', 'arrive']);
    expect(steps.map((s) => s.text)).toEqual(['Start on Top Street', 'Turn right onto Rung 400', 'Turn left onto Bottom Street', 'Arrive at the end point']);
    // Step lengths add up to the route length.
    expect(steps.reduce((a, s) => a + s.distanceM, 0)).toBeCloseTo(r.options[0].lengthM, 3);
    expect(steps[1].lat).toBeCloseTo(ll(400, 0).lat, 9);
  });

  it('merges straight runs of the same street and describes unnamed roads by class', () => {
    const lines: RoadLine[] = [
      { cls: 'primary', subclass: null, oneway: 0, name: 'Top Street', pts: [P(0, 0), P(200, 0)] },
      { cls: 'primary', subclass: null, oneway: 0, name: 'Top Street', pts: [P(200, 0), P(400, 0)] },
      { cls: 'minor', subclass: null, oneway: 0, name: 'Side', pts: [P(200, 0), P(200, 300)] },
      { cls: 'service', subclass: null, oneway: 0, name: null, pts: [P(400, 0), P(400, 20), P(420, 300)] },
    ];
    const r = routeOptions(buildRoadGraph(lines, 'walk'), ll(0, 0), ll(420, 300), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = r.options[0].steps.map((s) => s.text);
    expect(texts[0]).toBe('Start on Top Street');
    expect(texts[1]).toBe('Turn right onto the service road');
    expect(texts).toHaveLength(3);
  });
});

describe('turn-by-turn simplification', () => {
  it('folds a short jog onto another street into the neighbouring step', () => {
    // East on Top Street, a 7 m jog south on Jog Lane, then east on Lower Street.
    const lines: RoadLine[] = [
      { cls: 'minor', subclass: null, oneway: 0, name: 'Top Street', pts: [P(0, 0), P(400, 0)] },
      { cls: 'minor', subclass: null, oneway: 0, name: 'Jog Lane', pts: [P(400, 0), P(400, 20)] },
      { cls: 'minor', subclass: null, oneway: 0, name: 'Lower Street', pts: [P(400, 20), P(800, 20)] },
    ];
    const r = routeOptions(buildRoadGraph(lines, 'walk'), ll(0, 0), ll(800, 20), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const steps = r.options[0].steps;
    expect(steps.every((s) => s.maneuver === 'arrive' || s.distanceM >= 25)).toBe(true);
    expect(steps.map((s) => s.text)).toEqual(['Start on Top Street', 'Continue onto Lower Street', 'Arrive at the end point']);
    expect(steps.reduce((a, s) => a + s.distanceM, 0)).toBeCloseTo(r.options[0].lengthM, 3);
  });
});
