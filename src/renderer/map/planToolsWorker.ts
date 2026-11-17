/// <reference lib="webworker" />
// Keeps the loaded site geometry and the road graph for protective planning off the main thread, so dragging the
// subject can re-check rooftop sight lines and route options can be compared without freezing the globe.
import { roofGroups, rooftopExposure, routeOverlook, type RoofExposure, type RouteOverlook, type SurfaceGrids } from '../../shared/overwatch';
import { buildRoadGraph, routeOptions, type RoadGraph, type RoadLine, type RouteSearch, type TravelMode } from '../../shared/routing';

export type PlanToolsRequest =
  | { type: 'geometry'; key: string; grids: SurfaceGrids }
  | { type: 'roofs'; id: number; key: string; subject: { lat: number; lon: number; heightM: number }; roofEyeM: number; rangeM: number }
  | { type: 'overlook'; id: number; key: string; routes: [number, number][][]; eyeM: number; roofEyeM: number; rangeM: number }
  | { type: 'roads'; key: string; lines: RoadLine[] }
  | { type: 'routes'; id: number; key: string; mode: TravelMode; a: { lat: number; lon: number }; b: { lat: number; lon: number } };

export type PlanToolsReply =
  | { type: 'roofs'; id: number; result: RoofExposure | null; error: string | null }
  | { type: 'overlook'; id: number; result: RouteOverlook[] | null; error: string | null }
  | { type: 'routes'; id: number; result: RouteSearch | null; nodes: number; error: string | null };

let geo: { key: string; grids: SurfaceGrids; groups: Int32Array } | null = null;
let roads: { key: string; lines: RoadLine[]; graphs: Partial<Record<TravelMode, RoadGraph>> } | null = null;

self.onmessage = (event: MessageEvent<PlanToolsRequest>) => {
  const q = event.data;
  try {
    if (q.type === 'geometry') {
      const groups = new Int32Array(q.grids.grid.n * q.grids.grid.n);
      roofGroups(q.grids.grid, q.grids.buildings, groups);
      geo = { key: q.key, grids: q.grids, groups };
      return;
    }
    if (q.type === 'roofs') {
      if (!geo || geo.key !== q.key) return void post({ type: 'roofs', id: q.id, result: null, error: 'The site geometry is not loaded.' });
      const result = rooftopExposure(geo.grids, q.subject, { roofEyeM: q.roofEyeM, rangeM: q.rangeM, groups: geo.groups });
      self.postMessage({ type: 'roofs', id: q.id, result, error: null } satisfies PlanToolsReply, [result.classes.buffer]);
      return;
    }
    if (q.type === 'overlook') {
      if (!geo || geo.key !== q.key) return void post({ type: 'overlook', id: q.id, result: null, error: 'The site geometry is not loaded.' });
      const g = geo;
      const result = q.routes.map((pts) => routeOverlook(g.grids, pts, { eyeM: q.eyeM, roofEyeM: q.roofEyeM, rangeM: q.rangeM, spacingM: Math.max(10, g.grids.grid.cellM * 3), maxSamples: 120, groups: g.groups }));
      return void post({ type: 'overlook', id: q.id, result, error: null });
    }
    if (q.type === 'roads') {
      roads = { key: q.key, lines: q.lines, graphs: {} };
      return;
    }
    if (!roads || roads.key !== q.key) return void post({ type: 'routes', id: q.id, result: null, nodes: 0, error: 'The road network is not loaded.' });
    // One graph per travel mode for the loaded lines: moving an end point only re-runs the search.
    const g = (roads.graphs[q.mode] ??= buildRoadGraph(roads.lines, q.mode));
    post({ type: 'routes', id: q.id, result: routeOptions(g, q.a, q.b), nodes: g.nodeCount, error: null });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'The calculation failed.';
    if (q.type !== 'geometry' && q.type !== 'roads') post({ type: q.type, id: q.id, result: null, error, ...(q.type === 'routes' ? { nodes: 0 } : {}) } as PlanToolsReply);
  }
};

function post(m: PlanToolsReply): void {
  self.postMessage(m);
}
