import { describe, expect, it } from 'vitest';
import { buildingAt, facilitiesNear, parseBuildingAt, parseFacilities, parseHeight, OVERPASS_FALLBACK_URL, OVERPASS_URL } from '../src/main/osmSite';
import { assertAllowedUrl, FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { buildPlanBriefing, itemNearSite, LIMITATIONS, newPlan, planExportSchema, planInputsKey, planSchema, routeMetrics, runIsStale, SPEED_KMH, summarisePasses, type ProtectivePlan } from '../src/shared/protectivePlan';
import { gridTiles, rasterizeFootprints, resolveBelowSeaLevel, tileOf } from '../src/shared/siteRaster';
import { cellAt, type Grid } from '../src/shared/viewshed';
import { IPC, validateIpcArgs } from '../src/shared/ipc';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

const site = { name: 'Test site', lat: 60.17, lon: 24.94, origin: 'globe' as const, savedLocationId: null };
const T = new Date('2026-11-12T10:00:00Z');

describe('saved plans', () => {
  it('a new plan is valid, local, and has nothing modelled or acknowledged yet', () => {
    const p = newPlan(site, T);
    expect(planSchema.safeParse(p).success).toBe(true);
    expect(p.lastRun).toBeNull();
    expect(p.limitationsAcknowledged).toBe(false);
    expect(() => validateIpcArgs(IPC.plansPut, [p])).not.toThrow();
  });

  it('refuses cameras without a direction, mismatched direction sources and unknown fields', () => {
    const p = newPlan(site, T);
    const base = { id: 'o1', name: 'Cam', lat: 60.17, lon: 24.94, heightM: 6, kind: 'camera' as const, headingDeg: null, fovDeg: null, rangeM: 200, direction: 'all' as const, camera: null, note: '' };
    expect(planSchema.safeParse({ ...p, observers: [base] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, observers: [{ ...base, headingDeg: 90, fovDeg: 60, direction: 'all' }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, observers: [{ ...base, headingDeg: 90, fovDeg: 60, direction: 'user-estimate' }] }).success).toBe(true);
    expect(planSchema.safeParse({ ...p, extra: 1 }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, observers: [{ ...base, kind: 'observer', headingDeg: 90, fovDeg: null, direction: 'user-estimate' }] }).success).toBe(false);
  });

  it('accepts only embedded images for floor plans (no remote URLs)', () => {
    const p = newPlan(site, T);
    const fp = { id: 'f1', name: 'Ground floor', image: 'data:image/png;base64,iVBORw0KGgo=', lat: 60.17, lon: 24.94, widthM: 40, heightM: 30, rotationDeg: 0, elevationM: 0, level: 0, opacity: 0.8, confirmed: { scale: false, orientation: false, floor: false } };
    expect(planSchema.safeParse({ ...p, floorPlans: [fp] }).success).toBe(true);
    expect(planSchema.safeParse({ ...p, floorPlans: [{ ...fp, image: 'https://evil.example.com/plan.png' }] }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, floorPlans: [{ ...fp, image: 'data:image/svg+xml;base64,PHN2Zz4=' }] }).success).toBe(false);
  });

  it('keeps one role per drawn item and unique observer ids', () => {
    const p = newPlan(site, T);
    const r = { annotationId: 'a1', role: 'perimeter' as const, mode: null, note: '' };
    expect(planSchema.safeParse({ ...p, roles: [r, { ...r, role: 'zone' as const }] }).success).toBe(false);
  });
});

describe('routes', () => {
  it('estimates time only with a chosen mode and a stated speed', () => {
    const pts: [number, number][] = [[24.94, 60.17], [24.94, 60.17 + 4.8 / 111.32]]; // ≈ 4.8 km north
    const walk = routeMetrics(pts, 'walk');
    expect(walk.lengthM).toBeGreaterThan(4700);
    expect(walk.minutes).toBeCloseTo((walk.lengthM / 1000 / SPEED_KMH.walk) * 60, 6);
    expect(routeMetrics(pts, null).minutes).toBeNull();
  });
});

describe('briefing', () => {
  const p: ProtectivePlan = { ...newPlan({ ...site, name: '<script>alert(1)</script>' }, T), notes: 'Line 1\n<img src=x onerror=alert(1)>' };
  const html = buildPlanBriefing(p, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: '0.8.0' });
  it('escapes every user value and loads nothing remote', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/<link\b/);
  });
  it('states limitations, no-data and unacknowledged status explicitly', () => {
    for (const l of LIMITATIONS) expect(html).toContain(l.slice(0, 40).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    expect(html).toContain('No coverage analysis has been run');
    expect(html).toContain('Emergency facilities were not looked up');
    expect(html).toContain('has not acknowledged');
    expect(html).toContain('not proof of a threat');
  });
  it('the export request is validated before anything is written', () => {
    expect(() => validateIpcArgs(IPC.planExport, [{ plan: p, annotations: [], routes: [], coverageImage: null }, 'html'])).not.toThrow();
    expect(() => validateIpcArgs(IPC.planExport, [{ plan: p, annotations: [], routes: [], coverageImage: 'https://x/y.png' }, 'html'])).toThrow();
    expect(() => validateIpcArgs(IPC.planExport, [{ plan: p, annotations: [], routes: [], coverageImage: null }, 'exe'])).toThrow();
    expect(planExportSchema.safeParse({ plan: p, annotations: [{ id: 'a', kind: 'line', name: 'R', points: [[200, 0]] }], routes: [], coverageImage: null }).success).toBe(false);
  });
});

describe('OpenStreetMap building details', () => {
  // A 20 m × 20 m square around the site centre, and a second building 25 m east.
  const sq = (cx: number, cy: number, h: number) => {
    const dLat = h / 111_320;
    const dLon = h / (111_320 * Math.cos((60.17 * Math.PI) / 180));
    return [
      { lat: cy - dLat, lon: cx - dLon },
      { lat: cy - dLat, lon: cx + dLon },
      { lat: cy + dLat, lon: cx + dLon },
      { lat: cy + dLat, lon: cx - dLon },
      { lat: cy - dLat, lon: cx - dLon },
    ];
  };
  const east = 24.94 + 25 / (111_320 * Math.cos((60.17 * Math.PI) / 180));
  const elements = [
    { type: 'way', id: 11, timestamp: '2025-03-01T12:00:00Z', tags: { building: 'office', name: 'Tower', height: '42 m', 'building:levels': '12', 'addr:housenumber': '5', 'addr:street': 'Main St', 'addr:city': 'Helsinki', owner: 'Someone', operator: 'City' }, geometry: sq(24.94, 60.17, 10) },
    { type: 'way', id: 12, tags: { building: 'yes', 'building:levels': '4' }, geometry: sq(east, 60.17, 5) },
    { type: 'node', id: 13, tags: { building: 'yes' } },
  ];
  it('picks the footprint containing the point and labels reported vs estimated height', () => {
    const b = parseBuildingAt(elements, 60.17, 24.94, T)!;
    expect(b.osmId).toBe(11);
    expect(b.match).toBe('inside');
    expect(b.height).toEqual({ value: 42, source: 'reported' });
    expect(b.levels).toBe(12);
    expect(b.address).toBe('5 Main St, Helsinki');
    expect(b.lastEditedAt).toBe('2025-03-01T12:00:00.000Z');
    expect(JSON.stringify(b)).not.toContain('Someone'); // OSM "owner" tags are not shown as ownership
    // 11 m east of the small building's centre = 6 m outside its 10 m footprint.
    const near = parseBuildingAt(elements, 60.17, east + 11 / (111_320 * Math.cos((60.17 * Math.PI) / 180)), T)!;
    expect(near.osmId).toBe(12);
    expect(near.match).toBe('nearest');
    expect(near.distanceM).toBeCloseTo(6, 0);
    expect(near.height).toEqual({ value: 12, source: 'estimated-from-levels' });
    expect(near.buildingType).toBeNull(); // building=yes is no type information
  });
  it('reports "none" beyond 30 m, never a guess', () => {
    expect(parseBuildingAt(elements, 60.18, 24.94, T)).toBeNull();
    expect(parseBuildingAt([], 60.17, 24.94, T)).toBeNull();
  });
  it('parses OSM heights strictly', () => {
    expect(parseHeight('12')).toBe(12);
    expect(parseHeight('12.5 m')).toBe(12.5);
    expect(parseHeight("40'")).toBe(12.2);
    expect(parseHeight('5 storeys')).toBeNull();
    expect(parseHeight(12)).toBeNull();
  });
  it('queries Overpass by POST with validated coordinates only', async () => {
    const calls: { url: string; body?: string; sameOrigin?: boolean }[] = [];
    const fetchJson: FetchJson = async (url, opts) => {
      calls.push({ url, body: opts?.body, sameOrigin: opts?.sameOrigin });
      return { status: 200, body: { elements } };
    };
    expect((await buildingAt(fetchJson, 'test', 60.17, 24.94, T))?.osmId).toBe(11);
    expect(calls[0].url).toBe(OVERPASS_URL);
    expect(calls[0].sameOrigin).toBe(true);
    expect(decodeURIComponent(calls[0].body!.slice(5))).toContain('around:30,60.170000,24.940000');
    await expect(buildingAt(fetchJson, 'test', 91, 0)).rejects.toThrow();
    await expect(buildingAt(async () => ({ status: 200, body: { remark: 'runtime error: Query timed out' } }), 'test', 60, 24)).rejects.toThrow(/could not complete/);
    await expect(buildingAt(async () => ({ status: 200, body: '<html>' }), 'test', 60, 24)).rejects.toThrow(/unexpected/);
    // An overloaded main instance falls back once to the listed public instance; a refusal does not.
    const seen: string[] = [];
    const busy: FetchJson = async (url) => { seen.push(url); if (url === OVERPASS_URL) throw new FeedHttpError('HTTP 502', 502, null, 'http'); return { status: 200, body: { elements } }; };
    expect((await buildingAt(busy, 'test', 60.17, 24.94, T))?.osmId).toBe(11);
    expect(seen).toEqual([OVERPASS_URL, OVERPASS_FALLBACK_URL]);
    const both: FetchJson = async () => { throw new FeedHttpError('Request timed out after 40s', null, null, 'timeout'); };
    await expect(buildingAt(both, 'test', 60.17, 24.94, T)).rejects.toThrow(/busy or unreachable/);
    const refused: string[] = [];
    const bad: FetchJson = async (url) => { refused.push(url); throw new FeedHttpError('HTTP 400', 400, null, 'http'); };
    await expect(buildingAt(bad, 'test', 60.17, 24.94, T)).rejects.toThrow();
    expect(refused).toEqual([OVERPASS_URL]);
    expect(() => validateIpcArgs(IPC.siteBuilding, [60.17, 24.94])).not.toThrow();
    expect(() => validateIpcArgs(IPC.siteBuilding, ['60.17; drop', 24.94])).toThrow();
  });
});

describe('OpenStreetMap emergency facilities', () => {
  it('keeps only the listed kinds with valid positions; an empty answer is "none mapped", not an error', () => {
    const f = parseFacilities(
      [
        { type: 'node', id: 1, lat: 60.171, lon: 24.941, tags: { amenity: 'hospital', name: 'General', emergency: 'yes' } },
        { type: 'way', id: 2, center: { lat: 60.172, lon: 24.942 }, tags: { amenity: 'police' } },
        { type: 'node', id: 3, lat: 60.173, lon: 24.943, tags: { amenity: 'cafe' } },
        { type: 'way', id: 4, tags: { amenity: 'fire_station' } }, // no position
        { type: 'node', id: 1, lat: 60.171, lon: 24.941, tags: { amenity: 'hospital' } }, // duplicate
      ],
      2000,
      T,
    );
    expect(f.items.map((i) => i.kind)).toEqual(['hospital', 'police']);
    expect(f.items[0].emergency).toBe(true);
    expect(f.items[1].emergency).toBeNull();
    expect(parseFacilities([], 1000, T).items).toEqual([]);
  });
  it('bounds the radius', async () => {
    const fetchJson: FetchJson = async () => ({ status: 200, body: { elements: [] } });
    await expect(facilitiesNear(fetchJson, 'test', 60, 24, 50_000)).rejects.toThrow();
    expect(() => validateIpcArgs(IPC.siteFacilities, [60, 24, 50_000])).toThrow();
  });
});

describe('security boundaries', () => {
  it('Overpass is reachable from the main process only; OSM pages open in the browser', () => {
    expect(() => assertAllowedUrl(OVERPASS_URL)).not.toThrow();
    expect(() => assertAllowedUrl(OVERPASS_FALLBACK_URL)).not.toThrow();
    expect(() => assertAllowedUrl('https://evil.example.com/api/interpreter')).toThrow();
    expect(isAllowedExternalUrl('https://www.openstreetmap.org/way/11')).toBe(true);
  });
});

describe('building raster', () => {
  const grid: Grid = { lat: 60.17, lon: 24.94, cellM: 2, n: 41 };
  const m = (dx: number, dy: number): [number, number] => [grid.lon + dx / (111_320 * Math.cos((grid.lat * Math.PI) / 180)), grid.lat + dy / 111_320];
  it('fills a footprint with its height, honours holes and keeps the taller of overlapping buildings', () => {
    const out = new Float32Array(grid.n * grid.n);
    const outer = [m(-10, -10), m(10, -10), m(10, 10), m(-10, 10), m(-10, -10)];
    const hole = [m(-3, -3), m(3, -3), m(3, 3), m(-3, 3), m(-3, -3)];
    const filled = rasterizeFootprints(grid, [{ rings: [outer, hole], heightM: 12 }, { rings: [[m(8, -2), m(16, -2), m(16, 2), m(8, 2), m(8, -2)]], heightM: 30 }], out);
    const at = (dx: number, dy: number) => { const c = cellAt(grid, dx, dy)!; return out[c.row * grid.n + c.col]; };
    expect(filled).toBeGreaterThan(50);
    expect(at(-8, 0)).toBe(12);
    expect(at(0, 0)).toBe(0); // courtyard
    expect(at(9, 0)).toBe(30); // overlap keeps the taller
    expect(at(30, 30)).toBe(0);
    // Unknown cells stay unknown.
    const unk = new Float32Array(grid.n * grid.n).fill(Number.NaN);
    rasterizeFootprints(grid, [{ rings: [outer], heightM: 12 }], unk);
    expect(Number.isNaN(unk[0])).toBe(true);
  });
  it('maps every cell to its web-map tile', () => {
    const { tiles, cellTile } = gridTiles(grid, 14);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(cellTile).toHaveLength(grid.n * grid.n);
    expect(tiles).toContain(tileOf(grid.lat, grid.lon, 14).join('/'));
  });
});

describe('review fixes', () => {
  it('fills exactly the cells whose centres are inside a footprint (no half-cell shift)', () => {
    const g: Grid = { lat: 60.17, lon: 24.94, cellM: 1, n: 21 };
    const half = (g.n - 1) / 2;
    // Footprint from 2.2 to 6.2 cells east of the centre column and ±0.4 rows around the centre row.
    const lonAt = (cells: number) => g.lon + cells / (111_320 * Math.cos((g.lat * Math.PI) / 180));
    const latAt = (cells: number) => g.lat + cells / 111_320;
    const ring: [number, number][] = [[lonAt(2.2), latAt(-0.4)], [lonAt(6.2), latAt(-0.4)], [lonAt(6.2), latAt(0.4)], [lonAt(2.2), latAt(0.4)], [lonAt(2.2), latAt(-0.4)]];
    const out = new Float32Array(g.n * g.n);
    rasterizeFootprints(g, [{ rings: [ring], heightM: 9 }], out);
    const row = half;
    const filled = [...Array(g.n).keys()].filter((c) => out[row * g.n + c] > 0).map((c) => c - half);
    expect(filled).toEqual([3, 4, 5, 6]);
  });
  it('a mapped building without a usable height makes its cells unknown', () => {
    const g: Grid = { lat: 60.17, lon: 24.94, cellM: 2, n: 21 };
    const m = (dx: number, dy: number): [number, number] => [g.lon + dx / (111_320 * Math.cos((g.lat * Math.PI) / 180)), g.lat + dy / 111_320];
    const out = new Float32Array(g.n * g.n);
    rasterizeFootprints(g, [{ rings: [[m(-5, -5), m(5, -5), m(5, 5), m(-5, 5), m(-5, -5)]], heightM: Number.NaN }], out);
    const c = cellAt(g, 0, 0)!;
    expect(Number.isNaN(out[c.row * g.n + c.col])).toBe(true);
  });
  it('a run remembers its inputs; changed settings mark it out of date in the briefing', () => {
    const p = newPlan(site, T);
    const run = { at: T.toISOString(), cellM: 3, n: 41, terrain: { source: 's', level: 16, missingCells: 0 }, buildings: { source: 'b', tilesLoaded: 1, tilesFailed: 0, buildingCells: 10 }, combined: { covered: 10, overlap: 0, gap: 5, unknown: 0, analysed: 15 }, perObserver: [], inputsKey: planInputsKey(p), radiusM: p.analysis.radiusM, targetHeightM: p.analysis.targetHeightM };
    const fresh = { ...p, lastRun: run };
    expect(runIsStale(fresh)).toBe(false);
    const edited = { ...fresh, analysis: { ...fresh.analysis, radiusM: 900 } };
    expect(runIsStale(edited)).toBe(true);
    const html = buildPlanBriefing(edited, { annotations: [], routes: [], coverageImage: 'data:image/png;base64,AAAA', generatedAt: T, appVersion: 'x' });
    expect(html).toContain('Out of date');
    // The run is described with the settings it was made with; the changed settings are named separately.
    expect(html).toContain('(radius 400 m, target height 1.7 m)');
    expect(html).toContain('current settings are radius 900 m, target height 1.7 m');
    expect(html).not.toContain('data:image/png;base64,AAAA'); // the old grid is not shown as if current
    expect(buildPlanBriefing(fresh, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' })).not.toContain('Out of date');
  });
  it('multipolygon buildings: courtyards are not "inside", split outer ways are joined, unreadable geometry is only a bounds match', () => {
    const dLon = (m: number) => m / (111_320 * Math.cos((60.17 * Math.PI) / 180));
    const dLat = (m: number) => m / 111_320;
    const sq = (h: number) => [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([x, y]) => ({ lat: 60.17 + dLat(y), lon: 24.94 + dLon(x) }));
    const outer = sq(20);
    const rel = {
      type: 'relation', id: 21, tags: { building: 'yes', name: 'Block' }, bounds: { minlat: 60.17 - dLat(20), maxlat: 60.17 + dLat(20), minlon: 24.94 - dLon(20), maxlon: 24.94 + dLon(20) },
      // The outer ring arrives split into two ways; the inner ring is a 10 m courtyard around the centre.
      members: [{ type: 'way', role: 'outer', geometry: outer.slice(0, 3) }, { type: 'way', role: 'outer', geometry: outer.slice(2) }, { type: 'way', role: 'inner', geometry: sq(5) }],
    };
    const inCourtyard = parseBuildingAt([rel], 60.17, 24.94, T)!;
    expect(inCourtyard.match).toBe('nearest');
    expect(inCourtyard.distanceM).toBeCloseTo(5, 0);
    const inWing = parseBuildingAt([rel], 60.17, 24.94 + dLon(12), T)!;
    expect(inWing.match).toBe('inside');
    expect(inWing.footprintAreaM2).toBeGreaterThan(1400); // 40×40 − 10×10
    const broken = { ...rel, members: [{ type: 'way', role: 'outer', geometry: outer.slice(0, 3) }] };
    const b = parseBuildingAt([broken], 60.17, 24.94, T)!;
    expect(b.match).toBe('bounds');
    expect(b.footprint).toBeNull();
  });
});

describe('route and zone geometry saved with the plan', () => {
  it('keeps a copy of each assigned item; older plans without copies still load', () => {
    const p = newPlan(site, T);
    const withCopy = { ...p, roles: [{ annotationId: 'a1', role: 'primary-route' as const, mode: 'walk' as const, note: '', snapshot: { kind: 'line' as const, name: 'Route A', points: [[24.94, 60.17], [24.95, 60.17]] as [number, number][] } }] };
    expect(planSchema.safeParse(withCopy).success).toBe(true);
    const legacy = planSchema.parse({ ...p, roles: [{ annotationId: 'a1', role: 'zone', mode: null, note: '' }] });
    expect(legacy.roles[0].snapshot).toBeNull();
    expect(planSchema.safeParse({ ...p, roles: [{ ...withCopy.roles[0], snapshot: { kind: 'line', name: 'x', points: [] } }] }).success).toBe(false);
  });
  it('the briefing uses the given geometry and names a deleted item as a saved copy', () => {
    const p = { ...newPlan(site, T), roles: [{ annotationId: 'a1', role: 'primary-route' as const, mode: 'walk' as const, note: '', snapshot: null }] };
    const html = buildPlanBriefing(p, { annotations: [{ id: 'a1', kind: 'line', name: 'Route A (saved copy; deleted from the map)', points: [[24.94, 60.17], [24.95, 60.17]] }], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' });
    expect(html).toContain('Route A (saved copy; deleted from the map)');
    expect(html).toContain('min walking');
  });
});

describe('briefing geometry', () => {
  it('includes a self-contained site diagram and the coordinates of every routed or zoned item', () => {
    const p = { ...newPlan(site, T), roles: [{ annotationId: 'a1', role: 'perimeter' as const, mode: null, note: '', snapshot: null }, { annotationId: 'a2', role: 'primary-route' as const, mode: 'walk' as const, note: '', snapshot: null }] };
    const html = buildPlanBriefing(p, {
      annotations: [
        { id: 'a1', kind: 'area', name: '<b>Fence</b>', points: [[24.94, 60.17], [24.941, 60.17], [24.941, 60.171], [24.94, 60.17]] },
        { id: 'a2', kind: 'line', name: 'Route A', points: [[24.94, 60.17], [24.945, 60.172]] },
      ],
      routes: [], coverageImage: null, generatedAt: T, appVersion: 'x',
    });
    expect(html).toContain('<svg');
    expect(html).toContain('<polygon');
    expect(html).toContain('<polyline');
    expect(html).toContain('60.17200, 24.94500'); // route end point listed
    expect(html).toContain('1. &lt;b&gt;Fence&lt;/b&gt;');
    expect(html).not.toContain('<b>Fence</b>');
    expect(html).not.toMatch(/<script|href=|xlink/);
  });
});

describe('round 6 fixes', () => {
  it('asks Overpass for buildings containing the point as well as nearby ones', async () => {
    let body = '';
    await buildingAt(async (_u, o) => { body = decodeURIComponent(String(o?.body).slice(5)); return { status: 200, body: { elements: [] } }; }, 'test', 60.17, 24.94, T);
    expect(body).toContain('is_in(60.170000,24.940000)->.a;');
    expect(body).toContain('way(pivot.a)["building"]');
    expect(body).toContain('around:30,60.170000,24.940000');
  });
  it('exports a plan with very many coordinates, route notes, and separate direction / field-of-view provenance', () => {
    const many: [number, number][] = Array.from({ length: 200_000 }, (_, i) => [24.94 + (i % 100) * 1e-5, 60.17 + Math.floor(i / 100) * 1e-6]);
    const p = {
      ...newPlan(site, T),
      roles: [{ annotationId: 'a1', role: 'primary-route' as const, mode: 'walk' as const, note: 'Gate locked after 18:00', snapshot: null }],
      observers: [{ id: 'c1', name: 'Cam', lat: 60.17, lon: 24.94, heightM: 6, kind: 'camera' as const, headingDeg: 90, fovDeg: 60, rangeM: 200, direction: 'publisher' as const, camera: null, note: '' }],
    };
    const html = buildPlanBriefing(p, { annotations: [{ id: 'a1', kind: 'line', name: 'R', points: many }], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' });
    expect(html).toContain('Gate locked after 18:00');
    expect(html).toContain('facing 90° (from the publisher), 60° field of view (user estimate)');
  });
});

describe('round 7 fixes', () => {
  const g: Grid = { lat: 60.17, lon: 24.94, cellM: 2, n: 21 };
  const m = (dx: number, dy: number): [number, number] => [g.lon + dx / (111_320 * Math.cos((g.lat * Math.PI) / 180)), g.lat + dy / 111_320];
  const sq = (h: number) => [m(-h, -h), m(h, -h), m(h, h), m(-h, h), m(-h, -h)];
  const k = (dx: number, dy: number) => { const c = cellAt(g, dx, dy)!; return c.row * g.n + c.col; };
  it('keeps the passage under an elevated part, and stacked parts stay solid from the lowest', () => {
    const out = new Float32Array(g.n * g.n);
    const bases = new Float32Array(g.n * g.n);
    rasterizeFootprints(g, [{ rings: [sq(6)], heightM: 20, minHeightM: 6 }], out, bases);
    expect(out[k(0, 0)]).toBe(20);
    expect(bases[k(0, 0)]).toBe(6);
    const out2 = new Float32Array(g.n * g.n);
    const bases2 = new Float32Array(g.n * g.n);
    rasterizeFootprints(g, [{ rings: [sq(6)], heightM: 50, minHeightM: 10 }, { rings: [sq(8)], heightM: 10, minHeightM: 0 }], out2, bases2);
    expect(out2[k(0, 0)]).toBe(50);
    expect(bases2[k(0, 0)]).toBe(0); // tower on a podium: solid from the ground
  });
  it('below sea level: mapped water is the surface (sea level); anything else is unknown', () => {
    const ground = new Float32Array([-12, -3, 5, -40, 0]);
    const water = new Float32Array([1, 0, 1, Number.NaN, 0]);
    expect(resolveBelowSeaLevel(ground, water)).toBe(1);
    expect(ground[0]).toBe(0); // harbour water → surface
    expect(Number.isNaN(ground[1])).toBe(true); // below sea level, no mapped water → unknown
    expect(ground[2]).toBe(5); // a lake above sea level keeps its surveyed surface
    expect(Number.isNaN(ground[3])).toBe(true); // water data unavailable → unknown
    expect(ground[4]).toBe(0);
  });
});

describe('saved camera provenance', () => {
  it('keeps catalogue time, media type and published direction; older plans load with them unrecorded', () => {
    const p = newPlan(site, T);
    const cam = { id: 'c1', name: 'Cam', lat: 60.17, lon: 24.94, heightM: 6, kind: 'camera' as const, headingDeg: 90, fovDeg: 60, rangeM: 200, direction: 'publisher' as const, note: '', camera: { recordId: 'tfl-1', source: 'TfL JamCams', label: 'A1', catalogueAt: T.toISOString(), media: 'still', publishedHeadingDeg: 90 } };
    const ok = planSchema.parse({ ...p, observers: [cam] });
    const html = buildPlanBriefing(ok, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' });
    expect(html).toContain('TfL JamCams · still · catalogue 2026-11-12 10:00 UTC');
    const legacy = planSchema.parse({ ...p, observers: [{ ...cam, camera: { recordId: 'tfl-1', source: 'TfL JamCams', label: 'A1' } }] });
    expect(legacy.observers[0].camera).toMatchObject({ catalogueAt: null, media: null, publishedHeadingDeg: null });
    expect(buildPlanBriefing(legacy, { annotations: [], routes: [], coverageImage: null, generatedAt: T, appVersion: 'x' })).toContain('catalogue time not recorded');
  });
});

describe('round 10 fixes', () => {
  const g: Grid = { lat: 60.17, lon: 24.94, cellM: 2, n: 21 };
  const m = (dx: number, dy: number): [number, number] => [g.lon + dx / (111_320 * Math.cos((g.lat * Math.PI) / 180)), g.lat + dy / 111_320];
  const sq = (h: number) => [m(-h, -h), m(h, -h), m(h, h), m(-h, h), m(-h, -h)];
  const centre = () => { const c = cellAt(g, 0, 0)!; return c.row * g.n + c.col; };
  it('building parts separated by open space make the cell unknown, whatever order they arrive in', () => {
    for (const order of [[0, 1], [1, 0]]) {
      const parts = [{ rings: [sq(6)], heightM: 3, minHeightM: 0 }, { rings: [sq(6)], heightM: 20, minHeightM: 10 }];
      const out = new Float32Array(g.n * g.n);
      const bases = new Float32Array(g.n * g.n);
      rasterizeFootprints(g, order.map((i) => parts[i]), out, bases);
      expect(Number.isNaN(out[centre()])).toBe(true);
    }
    // A middle part that joins them keeps the stack solid (any order).
    const joined = [{ rings: [sq(6)], heightM: 20, minHeightM: 10 }, { rings: [sq(6)], heightM: 3, minHeightM: 0 }, { rings: [sq(6)], heightM: 10, minHeightM: 3 }];
    const out = new Float32Array(g.n * g.n);
    const bases = new Float32Array(g.n * g.n);
    rasterizeFootprints(g, joined, out, bases);
    expect(out[centre()]).toBe(20);
    expect(bases[centre()]).toBe(0);
  });
  it('items near the site: by vertex, by a passing segment, by containing it; a far date-line route is not near', () => {
    const s = { lat: 60.17, lon: 24.94 };
    const dLon = (mm: number) => mm / (111_320 * Math.cos((60.17 * Math.PI) / 180));
    expect(itemNearSite(s, { kind: 'pin', points: [[24.941, 60.17]] }, 5000)).toBe(true);
    // A route whose ends are 6 km west and east passes through the site.
    expect(itemNearSite(s, { kind: 'line', points: [[24.94 - dLon(6000), 60.17], [24.94 + dLon(6000), 60.17]] }, 400)).toBe(true);
    // An area around the site with every vertex far away.
    const far = 0.2;
    expect(itemNearSite(s, { kind: 'area', points: [[24.94 - far, 60.17 - far], [24.94 + far, 60.17 - far], [24.94 + far, 60.17 + far], [24.94 - far, 60.17 + far]] }, 400)).toBe(true);
    // A short route across the 180° meridian at the site's latitude is on the other side of the world.
    expect(itemNearSite(s, { kind: 'line', points: [[179.99, 60.17], [-179.99, 60.17]] }, 5000)).toBe(false);
    // ... but the same kind of route is near for a site at the date line.
    expect(itemNearSite({ lat: 0, lon: 179.995 }, { kind: 'line', points: [[179.99, 0], [-179.99, 0]] }, 500)).toBe(true);
  });
});

describe('round 13 fixes', () => {
  it('a building with many long use tags is still returned (the description is bounded)', () => {
    const long = (c: string) => c.repeat(58);
    const el = { type: 'way', id: 31, tags: { building: 'yes', amenity: long('a'), shop: long('b'), office: long('c'), tourism: long('d'), 'building:use': long('e') }, geometry: [{ lat: 60.1699, lon: 24.9399 }, { lat: 60.1699, lon: 24.9401 }, { lat: 60.1701, lon: 24.9401 }, { lat: 60.1701, lon: 24.9399 }, { lat: 60.1699, lon: 24.9399 }] };
    const b = parseBuildingAt([el], 60.17, 24.94, T)!;
    expect(b.osmId).toBe(31);
    expect(b.use!.length).toBeLessThanOrEqual(200);
  });
});

describe('satellite pass summary for a site', () => {
  const start = Date.parse('2026-11-13T00:00:00Z');
  const res = (peaks: string[], stale = false) => ({ startAt: '', endAt: '', elementEpoch: '', elementAgeDays: stale ? 9 : 1, stale, thresholdDeg: 30, observer: { lat: 0, lon: 0, heightM: 0 }, evaluations: 1, passes: peaks.map((peakAt) => ({ riseAt: null, peakAt, maxElevationDeg: 55, peakAzimuthDeg: 10, setAt: null })) });
  it('keeps failures and old elements apart from "no passes", and lists only the window', () => {
    const s = summarisePasses(
      [
        { name: 'A', result: res(['2026-11-13T03:00:00.000Z', '2026-11-13T20:00:00.000Z']) }, // second is outside 12 h
        { name: 'B', result: null }, // failed
        { name: 'C', result: res(['2026-11-13T01:00:00.000Z'], true) }, // stale elements
      ],
      start,
      12 * 3600_000,
    );
    expect(s).toMatchObject({ ok: 2, failed: 1, stale: 1 });
    expect(s.rows.map((r) => [r.name, r.stale])).toEqual([['C', true], ['A', false]]);
    const none = summarisePasses([{ name: 'B', result: null }], start, 12 * 3600_000);
    expect(none).toMatchObject({ ok: 0, failed: 1, rows: [] }); // all failed is "unavailable", not "no passes"
  });
});
