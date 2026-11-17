// State for the Protective planning workspace. It lives in App (not in the page) so a plan, its overlay and a
// running analysis survive switching pages. Everything stays on this computer unless the user exports a briefing.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  coverageObservers,
  newPlan,
  PLAN_LIMITS,
  planInputsKey,
  planSchema,
  runIsStale,
  ROLE_KINDS,
  SUBJECT_OBSERVER_ID,
  type BuildingInfo,
  type FloorPlan,
  type PlanObserver,
  type PlanRole,
  type ProtectivePlan,
} from '../../shared/protectivePlan';
import { gridBounds, gridSize, MAX_SOURCE_LAT, minCellFor, pathCoverage, toLocal, type CombinedResult, type Grid, type PathCoverage } from '../../shared/viewshed';
import { roofGroups, type RoofExposure, type RouteOverlook } from '../../shared/overwatch';
import { MAX_ROUTE_SPAN_M, type RouteOption, type TravelMode } from '../../shared/routing';
import { loadSiteGeometry, type SiteGeometry } from '../map/siteGeometry';
import type { PlanOverlayState } from '../map/planningOverlay';
import type { ViewshedMessage, ViewshedRequest } from '../map/viewshedWorker';
import type { PlanToolsReply, PlanToolsRequest } from '../map/planToolsWorker';
import { loadRoadLines, routeTiles } from '../map/roadNetwork';
import { api, errorText, type Annotation } from './api';

export type PlanPick = 'site' | 'observer' | 'building' | 'route-a' | 'route-b' | { floorPlan: string };
/** Something on the map that can be dragged while planning. */
export type PlanDragTarget = { kind: 'site' } | { kind: 'observer'; id: string } | { kind: 'route'; end: 'a' | 'b' };

export type OverwatchState =
  | { state: 'off' }
  | { state: 'needs-area'; reason: string }
  | { state: 'loading'; progress: number }
  | { state: 'running' }
  | { state: 'ready'; result: RoofExposure; subject: { lat: number; lon: number }; at: string }
  | { state: 'error'; error: string };

export interface RoutePlanner {
  a: { lat: number; lon: number } | null;
  b: { lat: number; lon: number } | null;
  mode: TravelMode;
  state: 'idle' | 'loading' | 'searching' | 'ready' | 'error';
  message: string | null;
  progress: number;
  options: RouteOption[];
  /** Drawn line each option was saved as (by "Use as …"). */
  adopted: (string | null)[];
  selected: number;
  /** Rooftop overlook per option (null: not computed, e.g. no site geometry loaded). */
  overlook: (RouteOverlook | null)[];
  roads: { tiles: number; failed: number; nodes: number } | null;
}
const NO_ROUTES: RoutePlanner = { a: null, b: null, mode: 'walk', state: 'idle', message: null, progress: 0, options: [], adopted: [], selected: 0, overlook: [], roads: null };

export interface AnalysisResult {
  grid: Grid;
  combined: CombinedResult;
  rgba: Uint8ClampedArray;
  /** The same picture in the site-view style. */
  rgbaGlow: Uint8ClampedArray;
  info: SiteGeometry['info'];
  at: string;
  /** Plan inputs this result was computed from (to flag a stale result). */
  inputsKey: string;
}
export type AnalysisState =
  | { state: 'idle' }
  | { state: 'running'; stage: string; progress: number }
  | { state: 'error'; error: string }
  | { state: 'cancelled' };

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
/** A plan without its save time, to tell real edits from a save that only stamped updatedAt. */
const content = (p: ProtectivePlan) => JSON.stringify({ ...p, updatedAt: '' });

/** Downscales an image file to at most 1600 px and embeds it (JPEG unless PNG is small enough). */
async function embedImage(file: File): Promise<{ url: string; aspect: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image of the floor plan.');
  if (file.size > 40 * 1024 * 1024) throw new Error('That image is larger than 40 MB.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  let url = canvas.toDataURL('image/jpeg', 0.85);
  for (const q of [0.7, 0.55, 0.4]) if (url.length > PLAN_LIMITS.imageChars) url = canvas.toDataURL('image/jpeg', q);
  if (url.length > PLAN_LIMITS.imageChars) throw new Error('The floor plan is too detailed to store; crop it or reduce its size.');
  return { url, aspect: canvas.height / canvas.width };
}

export function usePlanning(deps: { annotations: Annotation[]; notify(msg: string): void; saveAnnotation?(a: Annotation): Promise<boolean> }) {
  const [plans, setPlans] = useState<ProtectivePlan[]>([]);
  const [plan, setPlanState] = useState<ProtectivePlan | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [pick, setPick] = useState<PlanPick | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ state: 'idle' });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [selectedObserverId, setSelectedObserverId] = useState<string | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingInfo | null>(null);
  const [lookup, setLookup] = useState<{ building: string | null; facilities: string | null; buildingBusy: boolean; facilitiesBusy: boolean }>({ building: null, facilities: null, buildingBusy: false, facilitiesBusy: false });
  const [showCoverage, setShowCoverage] = useState(true);
  const [coverageOpacity, setCoverageOpacity] = useState(0.75);
  /** Site view: dark map and buildings, lit sight lines, vantage markers. Off: the colour-class view. */
  const [siteLook, setSiteLook] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /** Bumped whenever the open plan is replaced (new, open, close, delete): pending work for the old one is dropped. */
  const epochRef = useRef(0);
  /** Bumped by every run and every cancel: only the newest run may report progress or results. */
  const runRef = useRef(0);
  const planIdRef = useRef<string | null>(null);
  planIdRef.current = plan?.id ?? null;

  // ---- loaded site geometry (kept after a run, so rooftop checks and route overlook can be recomputed live)
  const toolsRef = useRef<Worker | null>(null);
  const geoRef = useRef<{ key: string; planId: string; grid: Grid; groups: Int32Array; ids: Int32Array; ground: Float32Array; footprints: SiteGeometry['footprints']; roofFootprints: Map<number, number[]> } | null>(null);
  const [geoKey, setGeoKey] = useState<string | null>(null);
  const [overwatchOn, setOverwatchOn] = useState(true);
  const [roofEyeM, setRoofEyeM] = useState(1.5);
  const [overwatch, setOverwatch] = useState<OverwatchState>({ state: 'needs-area', reason: 'Load the site area to check rooftops.' });
  const [routes, setRoutes] = useState<RoutePlanner>(NO_ROUTES);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const reqRef = useRef({ next: 1, roofs: 0, overlook: 0, routes: 0, roofsBusy: false, roofsPending: false });
  const roadsKeyRef = useRef<string | null>(null);
  const [autoRun, setAutoRun] = useState(0);
  const [autoRoutes, setAutoRoutes] = useState(0);

  useEffect(() => {
    void api.listPlans().then(setPlans).catch(() => setPlans([]));
    return () => {
      abortRef.current?.abort();
      workerRef.current?.terminate();
      toolsRef.current?.terminate();
    };
  }, []);

  const update = (fn: (p: ProtectivePlan) => ProtectivePlan) => setPlanState((p) => (p ? fn(p) : p));
  /** Applies a change only if the given plan is still the open one. */
  const updateFor = (id: string, fn: (p: ProtectivePlan) => ProtectivePlan) => setPlanState((p) => (p && p.id === id ? fn(p) : p));
  const annotationsById = useMemo(() => new Map(deps.annotations.map((a) => [a.id, a])), [deps.annotations]);
  const snapshotOf = (a: Annotation) => ({ kind: a.kind, name: a.name.slice(0, 200), points: a.points.slice(0, 5000) });
  /** Items whose map geometry differs from the copy saved in the plan, and items deleted from the map. */
  const roleChanges = useMemo(() => {
    const changed: string[] = [];
    const missing: string[] = [];
    for (const r of plan?.roles ?? []) {
      const a = annotationsById.get(r.annotationId);
      if (!a) missing.push(r.annotationId);
      else if (!r.snapshot || JSON.stringify(snapshotOf(a)) !== JSON.stringify(r.snapshot)) changed.push(r.annotationId);
    }
    return { changed, missing };
  }, [plan?.roles, annotationsById]);
  // Unsaved: the plan itself changed, or a drawn item it uses changed on the map since the plan was saved.
  const dirty = !!plan && (content(plan) !== savedJson || roleChanges.changed.length > 0);
  /** Asks before an unsaved plan is replaced; true when it is fine to continue. */
  const confirmReplace = () => !dirty || !plan || window.confirm(`Discard unsaved changes to “${plan.name}”?`);

  const stopRun = () => {
    runRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  };
  const cancel = () => {
    const wasRunning = !!abortRef.current;
    stopRun();
    if (wasRunning) setAnalysis({ state: 'cancelled' });
  };
  const replacePlan = () => {
    epochRef.current++;
    stopRun();
    // Lookups that belonged to the old plan no longer own the busy flags or messages.
    setLookup({ building: null, facilities: null, buildingBusy: false, facilitiesBusy: false });
    setPick(null);
    geoRef.current = null;
    setGeoKey(null);
    setOverwatch({ state: 'needs-area', reason: 'Load the site area to check rooftops.' });
    setRoutes(NO_ROUTES);
  };

  /** Starts a new plan at a site. Returns its id, or null when the user kept the unsaved plan instead. */
  const startAt = (site: ProtectivePlan['site']): string | null => {
    if (!confirmReplace()) return null;
    replacePlan();
    const p = newPlan(site);
    setPlanState(p);
    setSavedJson(null);
    setResult(null);
    setAnalysis({ state: 'idle' });
    setSelectedBuilding(null);
    setSelectedObserverId(null);
    return p.id;
  };

  const addObserver = (lat: number, lon: number, o: Partial<PlanObserver> = {}) => {
    if (!plan) return;
    if (plan.observers.length >= PLAN_LIMITS.observers) {
      deps.notify(`A plan can have up to ${PLAN_LIMITS.observers} observation points.`);
      return;
    }
    const id = uid('obs');
    const obs: PlanObserver = { id, name: o.name ?? `Point ${plan.observers.length + 1}`, lat, lon, heightM: 1.7, kind: 'observer', headingDeg: null, fovDeg: null, rangeM: Math.min(plan.analysis.radiusM, 5000), direction: 'all', camera: null, note: '', ...o };
    update((p) => ({ ...p, observers: [...p.observers, obs] }));
    setSelectedObserverId(id);
  };

  const inspectBuilding = async (lat: number, lon: number) => {
    const id = planIdRef.current;
    const epoch = epochRef.current;
    if (!id) return;
    setLookup((l) => ({ ...l, buildingBusy: true, building: null }));
    const current = () => epochRef.current === epoch;
    try {
      const b = await api.siteBuilding(lat, lon);
      if (!current()) return;
      setSelectedBuilding(b);
      if (!b) setLookup((l) => ({ ...l, building: 'No building is mapped in OpenStreetMap at or within 30 m of that point. That is a gap in mapped data, not proof that nothing is there.' }));
      else updateFor(id, (p) => ({ ...p, buildings: [b, ...p.buildings.filter((x) => !(x.osmType === b.osmType && x.osmId === b.osmId))].slice(0, PLAN_LIMITS.buildings) }));
    } catch (e) {
      if (current()) setLookup((l) => ({ ...l, building: `Building details unavailable: ${errorText(e)}` }));
    } finally {
      if (current()) setLookup((l) => ({ ...l, buildingBusy: false }));
    }
  };

  /** Called by the globe for a click while a pick is active. */
  const onPick = (lat: number, lon: number) => {
    const kind = pick;
    setPick(null);
    if (kind === 'site') startAt({ name: `Site at ${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, origin: 'globe', savedLocationId: null });
    else if (kind === 'observer') addObserver(lat, lon);
    else if (kind === 'building') void inspectBuilding(lat, lon);
    else if (kind === 'route-a' || kind === 'route-b') {
      setRoutes((r) => ({ ...r, [kind === 'route-a' ? 'a' : 'b']: { lat, lon }, options: [], overlook: [], state: 'idle', message: null }));
      setAutoRoutes((x) => x + 1);
    }
    else if (kind && typeof kind === 'object' && plan) {
      if (planIdRef.current === plan.id) updateFloorPlan(kind.floorPlan, { lat, lon });
    }
  };

  const run = async () => {
    if (!plan) return;
    const observers = coverageObservers(plan);
    if (!observers.length) {
      setAnalysis({ state: 'error', error: 'Turn on the subject’s view or add an observation point (cameras need a direction and field of view).' });
      return;
    }
    stopRun();
    const gen = runRef.current;
    const id = plan.id;
    const live = () => runRef.current === gen && planIdRef.current === id;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!plan.analysis.assumeMappedComplete) {
      setAnalysis({ state: 'error', error: 'Choose how to treat ground without mapped buildings before running (see the box above Run analysis).' });
      return;
    }
    const cellM = Math.max(plan.analysis.cellM, minCellFor(plan.analysis.radiusM));
    const grid: Grid = { lat: plan.site.lat, lon: plan.site.lon, cellM, n: gridSize(plan.analysis.radiusM, cellM) };
    // The terrain and building sources stop at the Web Mercator limit, and the grid cannot cross the 180° meridian.
    const gb = gridBounds(grid);
    if (gb.north > MAX_SOURCE_LAT || gb.south < -MAX_SOURCE_LAT) {
      setAnalysis({ state: 'error', error: 'This area reaches beyond 85° latitude, where the terrain and building sources have no data.' });
      return;
    }
    if (gb.west < -180 || gb.east > 180) {
      setAnalysis({ state: 'error', error: 'This area crosses the 180° meridian, which the analysis grid does not support. Move the site or reduce the radius.' });
      return;
    }
    const key = planInputsKey(plan);
    try {
      setAnalysis({ state: 'running', stage: 'Loading terrain', progress: 0 });
      const geo = await loadSiteGeometry(grid, {
        signal: ctrl.signal,
        onProgress: (p) => live() && setAnalysis({ state: 'running', stage: p.stage === 'terrain' ? 'Loading terrain' : 'Loading OpenStreetMap buildings', progress: (p.stage === 'terrain' ? 0 : 0.45) + (0.45 * p.done) / Math.max(1, p.total) }),
      });
      if (ctrl.signal.aborted || !live()) return;
      adoptGeometry(geo, id);
      setAnalysis({ state: 'running', stage: 'Modelling lines of sight', progress: 0.9 });
      const worker = new Worker(new URL('../map/viewshedWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const msg = await new Promise<Extract<ViewshedMessage, { type: 'done' }>>((resolve, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new DOMException('Analysis cancelled', 'AbortError')));
        worker.onerror = () => reject(new Error('The coverage worker stopped unexpectedly.'));
        worker.onmessage = (e: MessageEvent<ViewshedMessage>) => {
          const m = e.data;
          if (m.type === 'progress') live() && setAnalysis({ state: 'running', stage: `Modelling lines of sight (${m.done}/${m.total})`, progress: 0.9 + (0.1 * m.done) / m.total });
          else if (m.type === 'error') reject(new Error(m.error));
          else resolve(m);
        };
        const req: ViewshedRequest = {
          grid,
          ground: geo.ground,
          buildings: geo.buildings,
          bases: geo.bases,
          observers: observers.map((o) => ({ id: o.id, observer: { lat: o.lat, lon: o.lon, heightM: o.heightM, rangeM: o.rangeM, headingDeg: o.headingDeg, fovDeg: o.fovDeg } })),
          targetHeightM: plan.analysis.targetHeightM,
          footprints: geo.footprints.map((f) => ({ rings: f.rings, heightM: f.heightM, minHeightM: f.minHeightM })),
        };
        worker.postMessage(req, [geo.ground.buffer, geo.buildings.buffer, geo.bases.buffer]);
      });
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (!live()) return;
      const at = new Date().toISOString();
      const combined: CombinedResult = { classes: msg.combined, seenBy: new Uint8Array(0), counts: msg.combinedCounts as CombinedResult['counts'] };
      // Shares, route shares and the picture all come from the traced picture grid (finer than the analysis cells).
      setResult({ grid: msg.pictureGrid, combined, rgba: msg.rgba, rgbaGlow: msg.rgbaGlow, info: geo.info, at, inputsKey: key });
      updateFor(id, (p) => ({
        ...p,
        lastRun: { at, cellM, n: grid.n, terrain: geo.info.terrain, buildings: geo.info.buildings, combined: msg.combinedCounts, perObserver: msg.perObserver.map((r) => ({ id: r.id, counts: r.counts, error: r.error })), inputsKey: key, radiusM: plan.analysis.radiusM, targetHeightM: plan.analysis.targetHeightM },
      }));
      const errs = msg.perObserver.filter((r) => r.error);
      setAnalysis(errs.length ? { state: 'error', error: errs.map((r) => `${r.id === SUBJECT_OBSERVER_ID ? 'Subject' : (plan.observers.find((o) => o.id === r.id)?.name ?? r.id)}: ${r.error}`).join(' · ') } : { state: 'idle' });
    } catch (e) {
      if (!live()) return; // a newer run, a cancel or another plan owns the status now
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) setAnalysis({ state: 'cancelled' });
      else setAnalysis({ state: 'error', error: errorText(e) });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  // ------------------------------------------------------------------ site geometry, rooftops, dragging, routes

  const onToolsReplyRef = useRef<(m: PlanToolsReply) => void>(() => {});
  const tools = (): Worker => {
    if (toolsRef.current) return toolsRef.current;
    const w = new Worker(new URL('../map/planToolsWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<PlanToolsReply>) => onToolsReplyRef.current(e.data);
    w.onerror = () => {
      // A crashed worker loses its geometry and roads: load them again on the next request.
      w.terminate();
      if (toolsRef.current === w) toolsRef.current = null;
      geoRef.current = null;
      roadsKeyRef.current = null;
      reqRef.current.roofsBusy = false;
      setGeoKey(null);
      setOverwatch({ state: 'error', error: 'The rooftop and route calculator stopped unexpectedly. Load the area again.' });
    };
    toolsRef.current = w;
    return w;
  };

  /** Keeps a copy of loaded geometry for live rooftop checks (the coverage worker takes the originals). */
  const adoptGeometry = (geo: SiteGeometry, planId: string) => {
    const key = `${planId}|${geo.grid.lat}|${geo.grid.lon}|${geo.grid.cellM}|${geo.grid.n}|${Date.now()}`;
    const groups = new Int32Array(geo.grid.n * geo.grid.n);
    roofGroups(geo.grid, geo.buildings, groups);
    const roofFootprints = new Map<number, number[]>();
    for (let k = 0; k < groups.length; k++) {
      const g = groups[k];
      const f = geo.ids[k];
      if (g < 0 || f < 0) continue;
      let l = roofFootprints.get(g);
      if (!l) roofFootprints.set(g, (l = []));
      if (!l.includes(f)) l.push(f);
    }
    geoRef.current = { key, planId, grid: geo.grid, groups, ids: geo.ids, ground: geo.ground.slice(), footprints: geo.footprints, roofFootprints };
    tools().postMessage({ type: 'geometry', key, grids: { grid: geo.grid, ground: geo.ground.slice(), buildings: geo.buildings.slice(), bases: geo.bases.slice() } } satisfies PlanToolsRequest);
    setGeoKey(key);
  };

  /** Loads terrain and buildings around the subject without running the coverage model (for rooftop checks). */
  const loadArea = async () => {
    const p = plan;
    if (!p) return;
    if (!p.analysis.assumeMappedComplete) {
      setOverwatch({ state: 'needs-area', reason: 'First choose how to treat ground without mapped buildings (step 2, above Run analysis).' });
      return;
    }
    const cellM = Math.max(p.analysis.cellM, minCellFor(p.analysis.radiusM));
    const grid: Grid = { lat: p.site.lat, lon: p.site.lon, cellM, n: gridSize(p.analysis.radiusM, cellM) };
    const gb = gridBounds(grid);
    if (gb.north > MAX_SOURCE_LAT || gb.south < -MAX_SOURCE_LAT || gb.west < -180 || gb.east > 180) {
      setOverwatch({ state: 'error', error: 'This area reaches beyond 85° latitude or crosses the 180° meridian, where the analysis grid cannot be built.' });
      return;
    }
    const epoch = epochRef.current;
    setOverwatch({ state: 'loading', progress: 0 });
    try {
      const geo = await loadSiteGeometry(grid, { onProgress: (q) => epochRef.current === epoch && setOverwatch({ state: 'loading', progress: (q.stage === 'terrain' ? 0 : 0.5) + (0.5 * q.done) / Math.max(1, q.total) }) });
      if (epochRef.current !== epoch) return;
      adoptGeometry(geo, p.id);
    } catch (e) {
      if (epochRef.current === epoch) setOverwatch({ state: 'error', error: `Site data unavailable: ${errorText(e)}` });
    }
  };

  const subjectInside = (g: { grid: Grid }, lat: number, lon: number) => {
    const o = toLocal(g.grid, lat, lon);
    const half = (g.grid.n * g.grid.cellM) / 2;
    return Math.max(Math.abs(o.x), Math.abs(o.y)) <= half * 0.97;
  };
  const roofSubjectRef = useRef<{ lat: number; lon: number } | null>(null);
  const requestRoofs = () => {
    const g = geoRef.current;
    if (!overwatchOn) return setOverwatch({ state: 'off' });
    if (!plan) return;
    if (!g || g.planId !== plan.id) return setOverwatch((s) => (s.state === 'loading' || s.state === 'error' ? s : { state: 'needs-area', reason: 'Load the site area to check rooftops.' }));
    if (!subjectInside(g, plan.site.lat, plan.site.lon)) return setOverwatch({ state: 'needs-area', reason: 'The subject is outside the loaded area. Load the area around its new position.' });
    const r = reqRef.current;
    if (r.roofsBusy) {
      r.roofsPending = true;
      return;
    }
    r.roofsBusy = true;
    r.roofs = r.next++;
    roofSubjectRef.current = { lat: plan.site.lat, lon: plan.site.lon };
    setOverwatch((s) => (s.state === 'ready' ? s : { state: 'running' }));
    const half = (g.grid.n * g.grid.cellM) / 2;
    tools().postMessage({ type: 'roofs', id: r.roofs, key: g.key, subject: { lat: plan.site.lat, lon: plan.site.lon, heightM: plan.analysis.targetHeightM }, roofEyeM, rangeM: half * 1.5 } satisfies PlanToolsRequest);
  };
  const requestRoofsRef = useRef(requestRoofs);
  requestRoofsRef.current = requestRoofs;
  useEffect(() => requestRoofs(), [geoKey, plan?.id, plan?.site.lat, plan?.site.lon, plan?.analysis.targetHeightM, roofEyeM, overwatchOn]);

  /** Moves the subject, a point, or a route end. While dragging (final = false) only live checks run. */
  const dragTo = (t: PlanDragTarget, lat: number, lon: number, final: boolean) => {
    if (!plan) return;
    const id = plan.id;
    if (t.kind === 'route') {
      setRoutes((r) => ({ ...r, [t.end]: { lat, lon } }));
      if (final) setAutoRoutes((x) => x + 1);
      return;
    }
    if (t.kind === 'site') updateFor(id, (p) => ({ ...p, site: { ...p.site, lat, lon, origin: 'globe', savedLocationId: null } }));
    else updateFor(id, (p) => ({ ...p, observers: p.observers.map((o) => (o.id === t.id ? { ...o, lat, lon } : o)) }));
    if (final) setAutoRun((x) => x + 1);
  };
  // After a drop: re-run coverage when there was a run; otherwise reload the area if the subject left it.
  useEffect(() => {
    if (!autoRun || !plan) return;
    const canRun = plan.analysis.assumeMappedComplete && coverageObservers(plan).length > 0;
    if (canRun && (result || plan.lastRun)) void run();
    else if (geoRef.current && overwatchOn && !subjectInside(geoRef.current, plan.site.lat, plan.site.lon)) void loadArea();
  }, [autoRun]);

  const OVERLOOK_RANGE_M = 300;
  const requestOverlook = (options: RouteOption[], mode: TravelMode) => {
    const g = geoRef.current;
    if (!g || !plan || g.planId !== plan.id || !options.length) return;
    const id = (reqRef.current.overlook = reqRef.current.next++);
    tools().postMessage({ type: 'overlook', id, key: g.key, routes: options.map((o) => o.points), eyeM: mode === 'drive' ? 1.2 : 1.7, roofEyeM, rangeM: OVERLOOK_RANGE_M } satisfies PlanToolsRequest);
  };
  useEffect(() => {
    if (routesRef.current.options.length) requestOverlook(routesRef.current.options, routesRef.current.mode);
  }, [geoKey, roofEyeM]);

  const computeRoutes = async () => {
    const r = routesRef.current;
    if (!r.a || !r.b) return;
    const tiles = routeTiles(r.a, r.b);
    const myId = (reqRef.current.routes = reqRef.current.next++);
    if (!tiles) {
      setRoutes((x) => ({ ...x, state: 'error', message: `The two ends must be within ${MAX_ROUTE_SPAN_M / 1000} km of each other (and not across the 180° meridian).`, options: [], overlook: [] }));
      return;
    }
    const key = tiles.join(',');
    try {
      if (roadsKeyRef.current !== key) {
        setRoutes((x) => ({ ...x, state: 'loading', progress: 0, message: null }));
        const load = await loadRoadLines(tiles, undefined, (d, t) => reqRef.current.routes === myId && setRoutes((x) => ({ ...x, progress: d / t })));
        if (reqRef.current.routes !== myId) return;
        if (!load.lines.length) throw new Error(load.tilesFailed ? 'The map tiles with roads could not be loaded. Check the connection and try again.' : 'No mapped roads or paths here.');
        tools().postMessage({ type: 'roads', key, lines: load.lines } satisfies PlanToolsRequest);
        roadsKeyRef.current = key;
        setRoutes((x) => ({ ...x, roads: { tiles: load.tiles, failed: load.tilesFailed, nodes: 0 } }));
      }
      setRoutes((x) => ({ ...x, state: 'searching', message: null }));
      tools().postMessage({ type: 'routes', id: myId, key, mode: r.mode, a: r.a, b: r.b } satisfies PlanToolsRequest);
    } catch (e) {
      if (reqRef.current.routes === myId) setRoutes((x) => ({ ...x, state: 'error', message: errorText(e), options: [], overlook: [] }));
    }
  };
  useEffect(() => {
    if (autoRoutes) void computeRoutes();
  }, [autoRoutes]);
  const setRouteMode = (mode: TravelMode) => {
    setRoutes((r) => ({ ...r, mode, options: [], overlook: [], state: 'idle' }));
    setAutoRoutes((x) => x + 1);
  };
  const setRouteEnd = (end: 'a' | 'b', at: { lat: number; lon: number } | null) => {
    setRoutes((r) => ({ ...r, [end]: at, options: [], overlook: [], state: 'idle', message: null }));
    setAutoRoutes((x) => x + 1);
  };

  onToolsReplyRef.current = (m) => {
    const r = reqRef.current;
    if (m.type === 'roofs') {
      r.roofsBusy = false;
      if (m.id === r.roofs) {
        if (m.result && roofSubjectRef.current) setOverwatch({ state: 'ready', result: m.result, subject: roofSubjectRef.current, at: new Date().toISOString() });
        else if (m.error) setOverwatch({ state: 'error', error: m.error });
      }
      if (r.roofsPending) {
        r.roofsPending = false;
        requestRoofsRef.current();
      }
      return;
    }
    if (m.type === 'overlook') {
      if (m.id === r.overlook) setRoutes((x) => ({ ...x, overlook: m.result ?? x.options.map(() => null), message: m.error ?? x.message }));
      return;
    }
    if (m.id !== r.routes) return;
    if (!m.result || m.error) {
      if (m.error === 'The road network is not loaded.') roadsKeyRef.current = null;
      setRoutes((x) => ({ ...x, state: 'error', message: m.error ?? 'The route search failed.' }));
      return;
    }
    if (!m.result.ok) {
      const why = {
        'no-start': 'No mapped road or path within 400 m of the start.',
        'no-end': 'No mapped road or path within 400 m of the destination.',
        'no-path': routesRef.current.mode === 'drive' ? 'The mapped roads do not connect these points for driving (one-way streets are respected). Try walking, or move an end.' : 'The mapped paths do not connect these points. Move an end closer to a road.',
        'too-far': `The two ends must be within ${MAX_ROUTE_SPAN_M / 1000} km of each other.`,
      }[m.result.reason];
      setRoutes((x) => ({ ...x, state: 'error', message: why, options: [], overlook: [] }));
      return;
    }
    const options = m.result.options;
    setRoutes((x) => ({ ...x, state: 'ready', message: null, options, adopted: options.map(() => null), selected: 0, overlook: options.map(() => null), roads: x.roads ? { ...x.roads, nodes: m.nodes } : x.roads }));
    requestOverlook(options, routesRef.current.mode);
  };

  /** Saves a route option as a drawn line on the map and gives it a role in this plan. */
  const adoptRoute = async (i: number, role: 'primary-route' | 'alternate-route') => {
    const o = routes.options[i];
    if (!o || !plan || !deps.saveAnnotation) return;
    const step = Math.ceil(o.points.length / 4000);
    const pts = o.points.filter((_, k) => k % step === 0 || k === o.points.length - 1);
    const a: Annotation = {
      id: crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, ''),
      kind: 'line',
      name: `${role === 'primary-route' ? 'Primary' : 'Alternative'} route ${i + 1}${o.via.length ? ` via ${o.via[0]}` : ''}`.slice(0, 120),
      color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      points: pts,
      visible: true,
      createdAt: new Date().toISOString(),
    };
    if (await deps.saveAnnotation(a)) {
      setRole(a.id, role, { mode: routes.mode });
      setRoutes((x) => (x.options[i] === o ? { ...x, adopted: x.options.map((_, k) => (k === i ? a.id : x.adopted[k] ?? null)) } : x));
      deps.notify('Route added to the plan; it is listed under Routes & zones and goes into the briefing when you save.');
    }
  };

  const loadFacilities = async (radiusM: number) => {
    if (!plan) return;
    const id = plan.id;
    const epoch = epochRef.current;
    const current = () => epochRef.current === epoch;
    const { lat, lon } = plan.site;
    setLookup((l) => ({ ...l, facilitiesBusy: true, facilities: null }));
    try {
      const f = await api.siteFacilities(lat, lon, radiusM);
      // Only for the same plan and the same site it was asked for.
      if (current()) updateFor(id, (p) => (p.site.lat === lat && p.site.lon === lon ? { ...p, facilities: f } : p));
    } catch (e) {
      if (current()) setLookup((l) => ({ ...l, facilities: `Emergency facilities unavailable: ${errorText(e)}` }));
    } finally {
      if (current()) setLookup((l) => ({ ...l, facilitiesBusy: false }));
    }
  };

  /** Changes a floor plan; any change to what the user confirmed (scale, orientation/placement, floor) needs confirming again. */
  const updateFloorPlan = (id: string, patch: Partial<FloorPlan>) =>
    update((p) => ({
      ...p,
      floorPlans: p.floorPlans.map((f) => {
        if (f.id !== id) return f;
        const confirmed = { ...f.confirmed, ...(patch.confirmed ?? {}) };
        if (('widthM' in patch && patch.widthM !== f.widthM) || ('heightM' in patch && patch.heightM !== f.heightM)) confirmed.scale = false;
        if (('rotationDeg' in patch && patch.rotationDeg !== f.rotationDeg) || ('lat' in patch && patch.lat !== f.lat) || ('lon' in patch && patch.lon !== f.lon)) confirmed.orientation = false;
        if (('level' in patch && patch.level !== f.level) || ('elevationM' in patch && patch.elevationM !== f.elevationM)) confirmed.floor = false;
        const next = { ...f, ...patch, confirmed };
        // Both sides stay within 1–2000 m (scaled down together, keeping the image's proportions).
        const big = Math.max(next.widthM, next.heightM);
        if (big > 2000) {
          next.widthM = Math.max(1, Math.round((next.widthM * 2000) / big * 10) / 10);
          next.heightM = Math.max(1, Math.round((next.heightM * 2000) / big * 10) / 10);
        }
        return next;
      }),
    }));

  const setRole = (annotationId: string, role: PlanRole | null, extra: { mode?: 'walk' | 'drive' | null; note?: string } = {}) =>
    update((p) => {
      const rest = p.roles.filter((r) => r.annotationId !== annotationId);
      if (!role) return { ...p, roles: rest };
      const prev = p.roles.find((r) => r.annotationId === annotationId);
      const isRoute = role === 'primary-route' || role === 'alternate-route';
      const a = annotationsById.get(annotationId);
      const snapshot = a ? snapshotOf(a) : (prev?.snapshot ?? null);
      return { ...p, roles: [...rest, { annotationId, role, mode: isRoute ? (extra.mode !== undefined ? extra.mode : (prev?.mode ?? 'walk')) : null, note: extra.note ?? prev?.note ?? '', snapshot }] };
    });

  const addFloorPlan = async (file: File) => {
    if (!plan) return;
    if (plan.floorPlans.length >= PLAN_LIMITS.floorPlans) {
      deps.notify(`A plan can hold up to ${PLAN_LIMITS.floorPlans} floor plans.`);
      return;
    }
    const id = plan.id;
    const epoch = epochRef.current;
    try {
      const { url, aspect } = await embedImage(file);
      if (epochRef.current !== epoch) return;
      const widthM = 40;
      const fp: FloorPlan = { id: uid('floor'), name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Floor plan', image: url, lat: plan.site.lat, lon: plan.site.lon, widthM, heightM: Math.min(2000, Math.max(1, Math.round(widthM * aspect * 10) / 10)), rotationDeg: 0, elevationM: 0, level: 0, opacity: 0.85, confirmed: { scale: false, orientation: false, floor: false } };
      updateFor(id, (p) => (p.floorPlans.length >= PLAN_LIMITS.floorPlans ? p : { ...p, floorPlans: [...p.floorPlans, fp] }));
      setPick({ floorPlan: fp.id });
      deps.notify('Click the globe where the centre of the floor plan belongs.');
    } catch (e) {
      deps.notify(errorText(e));
    }
  };

  /**
   * Rooftop and route results to keep with the plan: the current ones when they belong to this plan and its current
   * subject position, otherwise whatever the plan already holds (the briefing then says if that is out of date).
   */
  const studies = (p: ProtectivePlan): Pick<ProtectivePlan, 'rooftops' | 'routeStudy'> => {
    let rooftops = p.rooftops;
    const g = geoRef.current;
    if (overwatchOn && overwatch.state === 'ready' && g && g.planId === p.id && overwatch.subject.lat === p.site.lat && overwatch.subject.lon === p.site.lon) {
      const r = overwatch.result;
      rooftops = {
        at: overwatch.at,
        subject: { lat: p.site.lat, lon: p.site.lon },
        subjectHeightM: p.analysis.targetHeightM,
        roofEyeM,
        subjectRoofM: r.subjectRoofM === null ? null : Math.min(1000, r.subjectRoofM),
        radiusM: Math.min(5000, Math.max(50, (g.grid.n * g.grid.cellM) / 2)),
        cellM: g.grid.cellM,
        groupsInRange: r.groupsInRange,
        undetermined: r.undetermined,
        unknownBuildingCells: r.unknownBuildingCells,
        total: r.rooftops.length,
        items: r.rooftops.slice(0, 60).map((t) => ({ lat: t.lat, lon: t.lon, distanceM: Math.min(20_000, t.distanceM), bearingDeg: Math.min(360, t.bearingDeg), heightM: Math.min(1000, t.heightM), elevationDeg: Math.max(-90, Math.min(90, t.elevationDeg)), clearShare: clamp01(t.cells ? t.visibleCells / t.cells : 0) })),
      };
    }
    let routeStudy = p.routeStudy;
    const r = routes;
    if (r.state === 'ready' && r.options.length && r.a && r.b)
      routeStudy = {
        at: new Date().toISOString(),
        mode: r.mode,
        a: r.a,
        b: r.b,
        roads: { tiles: r.roads?.tiles ?? 0, failed: r.roads?.failed ?? 0 },
        overlookRangeM: OVERLOOK_RANGE_M,
        options: r.options.slice(0, 3).map((o, i) => ({
          lengthM: o.lengthM,
          minutes: o.minutes,
          majorShare: clamp01(o.majorShare),
          junctions: o.junctions,
          via: o.via.slice(0, 3).map((v) => v.slice(0, 80)),
          startGapM: o.startGapM,
          endGapM: o.endGapM,
          overlook: r.overlook[i] ? { overlooked: clamp01(r.overlook[i]!.overlooked), clear: clamp01(r.overlook[i]!.clear), unknown: clamp01(r.overlook[i]!.unknown), outside: clamp01(r.overlook[i]!.outside), rooftops: r.overlook[i]!.rooftops } : null,
          annotationId: r.adopted[i] && p.roles.some((x) => x.annotationId === r.adopted[i]) ? r.adopted[i] : null,
        })),
      };
    return { rooftops, routeStudy };
  };

  const save = async (): Promise<boolean> => {
    if (!plan) return false;
    const next = {
      ...plan,
      ...studies(plan),
      updatedAt: new Date().toISOString(),
      roles: plan.roles.map((r) => {
        const a = annotationsById.get(r.annotationId);
        return a ? { ...r, snapshot: snapshotOf(a) } : r;
      }),
    };
    const check = planSchema.safeParse(next);
    if (!check.success) {
      deps.notify(`The plan cannot be saved: ${check.error.issues[0]?.message ?? 'invalid data'}`);
      return false;
    }
    const id = check.data.id;
    const epoch = epochRef.current;
    try {
      await api.putPlan(check.data);
      if (epochRef.current === epoch) {
        // Stamp the save time without discarding edits made while it was being written.
        setPlanState((p) => (p && p.id === id ? { ...p, updatedAt: check.data.updatedAt, rooftops: check.data.rooftops, routeStudy: check.data.routeStudy, roles: p.roles.map((r) => check.data.roles.find((s) => s.annotationId === r.annotationId && s.role === r.role && s.mode === r.mode && s.note === r.note) ?? r) } : p));
        setSavedJson(content(check.data));
      }
      setPlans((list) => [check.data, ...list.filter((x) => x.id !== check.data.id)]);
      deps.notify(`Saved “${check.data.name}” on this computer.`);
      return true;
    } catch (e) {
      deps.notify(errorText(e));
      return false;
    }
  };

  /** Opens a saved plan. Returns its id, or null when it was not opened (missing, or the user kept the unsaved plan). */
  const open = (id: string): string | null => {
    const p = plans.find((x) => x.id === id);
    if (!p || !confirmReplace()) return null;
    replacePlan();
    setPlanState(p);
    setSavedJson(content(p));
    setResult(null); // results are recomputed with current data, never restored as if current
    setAnalysis({ state: 'idle' });
    setSelectedBuilding(null);
    setSelectedObserverId(null);
    return p.id;
  };

  const remove = async (id: string) => {
    try {
      await api.deletePlan(id);
      setPlans((list) => list.filter((x) => x.id !== id));
      if (planIdRef.current === id) {
        replacePlan();
        setPlanState(null);
        setSavedJson(null);
        setResult(null);
      }
    } catch (e) {
      deps.notify(errorText(e));
    }
  };

  const close = () => {
    if (!confirmReplace()) return;
    replacePlan();
    setPlanState(null);
    setSavedJson(null);
    setResult(null);
    setPick(null);
    setAnalysis({ state: 'idle' });
  };

  /** The grid on screen, or the saved run's figures, no longer match the current inputs. */
  const stale = !!plan && ((!!result && result.inputsKey !== planInputsKey(plan)) || runIsStale(plan));
  const coverageCache = useRef(new WeakMap<object, Map<string, PathCoverage>>());
  const routeCoverage = (annotationId: string): PathCoverage | null => {
    const a = annotationsById.get(annotationId) ?? plan?.roles.find((r) => r.annotationId === annotationId)?.snapshot;
    if (!a || !result || stale || a.kind !== 'line') return null;
    // Cached per result (object identity) and route geometry.
    let byRoute = coverageCache.current.get(result);
    if (!byRoute) coverageCache.current.set(result, (byRoute = new Map()));
    const key = JSON.stringify(a.points);
    let c = byRoute.get(key);
    if (!c) byRoute.set(key, (c = pathCoverage(result.grid, result.combined, a.points)));
    return c;
  };

  const exportBriefing = async (format: 'html' | 'pdf', coverageImage: string | null) => {
    if (!plan) return;
    // Items still on the map use their current geometry; deleted ones use the copy saved in the plan, labelled as such.
    const geometry = (r: ProtectivePlan['roles'][number]) => {
      const a = annotationsById.get(r.annotationId);
      if (a) return snapshotOf(a);
      return r.snapshot ? { ...r.snapshot, name: `${r.snapshot.name} (saved copy; deleted from the map)`.slice(0, 200) } : null;
    };
    const roles = plan.roles.filter((r) => { const g = geometry(r); return !!g && ROLE_KINDS[r.role].includes(g.kind); });
    const planForExport = { ...plan, ...studies(plan), roles };
    const annotations = roles.map((r) => ({ id: r.annotationId, ...geometry(r)! }));
    const lost = plan.roles.length - roles.length;
    if (lost) deps.notify(`${lost} item${lost === 1 ? ' was' : 's were'} deleted from the map before a copy was saved and ${lost === 1 ? 'is' : 'are'} not in the briefing.`);
    const routes = roles
      .filter((r) => r.role === 'primary-route' || r.role === 'alternate-route')
      .map((r) => {
        const c = routeCoverage(r.annotationId);
        return { annotationId: r.annotationId, covered: c?.covered ?? null, gap: c?.gap ?? null, unknown: c?.unknown ?? null, outside: c?.outside ?? null };
      });
    try {
      const saved = await api.exportPlan({ plan: planForExport, annotations, routes, coverageImage: stale ? null : coverageImage }, format);
      if (saved) deps.notify(`Briefing saved to ${saved}`);
    } catch (e) {
      deps.notify(errorText(e));
    }
  };

  const overlay: PlanOverlayState | null = plan
    ? {
        site: { lat: plan.site.lat, lon: plan.site.lon, name: plan.site.name },
        radiusM: plan.analysis.radiusM,
        observers: plan.observers,
        selectedObserverId,
        // A grid computed for other inputs is never drawn next to the current points and radius.
        coverage: result && result.inputsKey === planInputsKey(plan) ? { rgba: siteLook ? result.rgbaGlow : result.rgba, n: result.grid.n, bounds: gridBounds(result.grid) } : null,
        look: siteLook ? 'site' : 'classic',
        coverageOpacity,
        showCoverage,
        floorPlans: plan.floorPlans,
        facilities: plan.facilities?.items ?? [],
        building: selectedBuilding?.footprint ?? null,
        roofs: overwatchOn && overwatch.state === 'ready' && geoRef.current ? roofOverlay(geoRef.current, overwatch.result) : [],
        subjectEye: overwatchOn && overwatch.state === 'ready' && geoRef.current ? subjectEye(geoRef.current, overwatch.subject, plan.analysis.targetHeightM) : null,
        routeOptions: routes.options.map((o, i) => ({ points: o.points, color: ROUTE_COLORS[i % ROUTE_COLORS.length], selected: i === routes.selected })),
        routeEnds: { a: routes.a, b: routes.b },
      }
    : null;

  return {
    plans, plan, dirty, pick, setPick, onPick, analysis, result, stale, selectedObserverId, setSelectedObserverId,
    selectedBuilding, setSelectedBuilding, lookup, showCoverage, setShowCoverage, coverageOpacity, setCoverageOpacity,
    startAt, update, addObserver, run, cancel, inspectBuilding, loadFacilities, setRole, addFloorPlan, updateFloorPlan, save, open, remove, close,
    routeCoverage, exportBriefing, overlay, roleChanges,
    siteLook, setSiteLook,
    overwatch, overwatchOn, setOverwatchOn, roofEyeM, setRoofEyeM, loadArea, geoLoaded: !!geoKey && geoRef.current?.planId === plan?.id, dragTo,
    routes, setRoutes, setRouteMode, setRouteEnd, computeRoutes, adoptRoute,
  };
}
export type Planning = ReturnType<typeof usePlanning>;

/** Shares summed from floating-point lengths can land a hair outside 0–1; the saved plan's schema is strict. */
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Okabe–Ito colours for route options (colour-blind-safe; each option is also numbered). */
export const ROUTE_COLORS = ['#0072B2', '#009E73', '#CC79A7'];

type GeoCache = { grid: Grid; ground: Float32Array; footprints: SiteGeometry['footprints']; roofFootprints: Map<number, number[]> };

/** Outlines (at roof height) of the nearest rooftops with a clear line, for the map. */
function roofOverlay(g: GeoCache, r: RoofExposure): NonNullable<PlanOverlayState['roofs']> {
  return r.rooftops.slice(0, 60).map((t) => ({
    lat: t.lat,
    lon: t.lon,
    groundM: t.groundM,
    heightM: t.heightM,
    distanceM: t.distanceM,
    rings: (g.roofFootprints.get(t.id) ?? [])
      .map((fi) => g.footprints[fi])
      .filter((f) => f && Number.isFinite(f.heightM))
      .slice(0, 16)
      .map((f) => ({ ring: f.ring, heightM: f.heightM })),
  }));
}

/** The subject's eye position (terrain under it from the loaded grid plus its height), or null without terrain. */
function subjectEye(g: GeoCache, s: { lat: number; lon: number }, heightM: number): { lat: number; lon: number; heightM: number } | null {
  const o = toLocal(g.grid, s.lat, s.lon);
  const half = (g.grid.n - 1) / 2;
  const col = Math.round(o.x / g.grid.cellM + half);
  const row = Math.round(half - o.y / g.grid.cellM);
  if (row < 0 || col < 0 || row >= g.grid.n || col >= g.grid.n) return null;
  const ground = g.ground[row * g.grid.n + col];
  return Number.isFinite(ground) ? { lat: s.lat, lon: s.lon, heightM: ground + heightM } : null;
}
