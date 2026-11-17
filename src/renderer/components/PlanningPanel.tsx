// Protective planning workspace: choose a place → inspect it in 3D → model coverage → add routes, zones and notes →
// save or export a briefing. It reuses the existing globe, terrain, OSM 3D buildings, map tools, camera layer,
// satellite layer and briefing export. Every figure says where it comes from; nothing is simulated.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerId, LayerSnapshot, GeoRecord } from '../../shared/layers';
import type { SavedLocation, Settings } from '../../shared/types';
import {
  FACILITY_LABEL,
  itemNearSite,
  summarisePasses,
  formatMeters,
  formatShare,
  LIMITATIONS,
  PLAN_ROLES,
  ROLE_KINDS,
  ROLE_LABEL,
  rooftopStudyIsStale,
  coverageObservers,
  SUBJECT_OBSERVER_ID,
  routeMetrics,
  SOURCES,
  type BuildingInfo,
  type PlanObserver,
  type PlanRole,
} from '../../shared/protectivePlan';
import { gridSize, MAX_RADIUS_M, minCellFor, pathCoverage } from '../../shared/viewshed';
import { MAX_ROUTE_SPAN_M, type Maneuver } from '../../shared/routing';
import type { SatellitePassResult } from '../../shared/satellitePasses';
import type { PassRequest } from '../map/satellitePassWorker';
import { ROUTE_COLORS, type Planning } from '../lib/usePlanning';
import { api, type Annotation } from '../lib/api';
import type { ToolMode } from './Globe';

type Step = 'site' | 'coverage' | 'rooftops' | 'buildings' | 'routes' | 'brief';
const STEPS: [Step, string][] = [
  ['site', '1 Site'],
  ['coverage', '2 Area & points'],
  ['rooftops', '3 Rooftops'],
  ['buildings', '4 Buildings'],
  ['routes', '5 Routes'],
  ['brief', '6 Save & brief'],
];

export interface PlanningPanelProps {
  planning: Planning;
  settings: Settings;
  locations: SavedLocation[];
  layerSnaps: Partial<Record<LayerId, LayerSnapshot>>;
  annotations: Annotation[];
  patch(p: Partial<Settings>): void;
  enableLayers(ids: LayerId[]): void;
  viewCenter(): { lat: number; lon: number } | null;
  /** Oblique 3D view of a site, for the plan with this id (dropped if another plan is open when it is ready). */
  flyToSite(lat: number, lon: number, rangeM: number, planId: string): void;
  /** Looks straight down from `heightM` above the ground (plus `aboveGroundM`, e.g. a floor's height). */
  flyAbove(lat: number, lon: number, heightM: number, planId: string, aboveGroundM?: number): void;
  setTool(t: ToolMode): void;
  selectRecord(layer: LayerId, id: string): void;
  coverageImage(): string | null;
  /** Camera flight along a route; `onEnd` reports how it ended. */
  flyAlong(points: [number, number][], mode: 'walk' | 'drive', onEnd: (why: 'done' | 'cancelled' | 'replaced') => void): void;
  stopFlyAlong(): void;
  /** Close view of one point (a direction step). */
  focusPoint(lat: number, lon: number): void;
}

const num = (v: string, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const x = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 111_320;
  return Math.hypot(x, y);
}
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'unknown');

function Legend({ site }: { site: boolean }) {
  if (site)
    return (
      <div className="plan-legend small" aria-label="Coverage legend">
        <span><i className="sw lit" /> Clear sight line (brighter near a point and where two or more see it)</span>
        <span><i className="sw edge" /> Dashed magenta edge: limit of view</span>
        <span><i className="sw unk" /> Grey hatching: unknown (no data)</span>
        <span>Unlit inside the rings: blocked by mapped terrain or buildings</span>
      </div>
    );
  return (
    <div className="plan-legend small" aria-label="Coverage legend">
      <span><i className="sw c1" /> Clear sight line from one point</span>
      <span><i className="sw c2" /> Clear from two or more</span>
      <span><i className="sw gap" /> Blocked by mapped terrain or buildings</span>
      <span><i className="sw unk" /> Unknown (no data)</span>
    </div>
  );
}

export function PlanningPanel(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan;
  const [step, setStep] = useState<Step>('site');
  useEffect(() => {
    if (!plan) setStep('site');
  }, [plan?.id]);
  const photoreal = p.settings.basemap === 'google3d';

  return (
    <div className="planning" role="region" aria-label="Protective planning">
      <p className="muted small">
        Plan a site: choose a place, look at it in 3D, model what can be seen from observation points, mark routes and zones, then save or export a briefing. Plans stay on this computer.
      </p>
      {plan && (
        <div className="seg tabs plan-steps" role="tablist" aria-label="Planning steps">
          {STEPS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={step === id} className={`btn small-btn ${step === id ? 'primary' : ''}`} onClick={() => setStep(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {plan && (
        <label className="field inline small">
          <input type="checkbox" checked={pl.siteLook} onChange={(e) => pl.setSiteLook(e.target.checked)} /> Site view: dark map, lit sight lines, vantage markers and range rings (off: colour classes)
        </label>
      )}
      {pl.pick && (
        <div className="note small" role="status">
          {pl.pick === 'site' ? 'Click the globe to choose the site.' : pl.pick === 'observer' ? 'Click the globe where the observation point stands.' : pl.pick === 'building' ? 'Click a building on the globe.' : pl.pick === 'route-a' ? 'Click the globe where the route starts.' : pl.pick === 'route-b' ? 'Click the globe where the route ends.' : 'Click the globe where the centre of the floor plan belongs.'}{' '}
          <button className="link-btn small" onClick={() => pl.setPick(null)}>Cancel</button>
        </div>
      )}
      {(!plan || step === 'site') && <SiteStep {...p} photoreal={photoreal} />}
      {plan && step === 'coverage' && <CoverageStep {...p} photoreal={photoreal} />}
      {plan && step === 'rooftops' && <RooftopsStep {...p} />}
      {plan && step === 'buildings' && <BuildingsStep {...p} />}
      {plan && step === 'routes' && <RoutesStep {...p} />}
      {plan && step === 'brief' && <BriefStep {...p} />}
    </div>
  );
}

// ------------------------------------------------------------------ 1 Site

function SiteStep(p: PlanningPanelProps & { photoreal: boolean }) {
  const pl = p.planning;
  const plan = pl.plan;
  const [locId, setLocId] = useState('');
  const useCenter = () => {
    const c = p.viewCenter();
    if (!c) return;
    const id = pl.startAt({ name: `Site at ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, lat: c.lat, lon: c.lon, origin: 'search', savedLocationId: null });
    if (id) p.flyToSite(c.lat, c.lon, 600, id);
  };
  const useLocation = () => {
    const l = p.locations.find((x) => x.id === locId);
    if (!l) return;
    const id = pl.startAt({ name: l.name.slice(0, 200), lat: l.lat, lon: l.lon, origin: 'saved-location', savedLocationId: l.id });
    if (id) p.flyToSite(l.lat, l.lon, 600, id);
  };
  return (
    <>
      <div className="diag-sub">{plan ? 'Site' : 'Choose a place'}</div>
      {plan ? (
        <div className="small">
          <label className="field">
            <span>Site name</span>
            <input value={plan.site.name} maxLength={200} onChange={(e) => pl.update((x) => ({ ...x, site: { ...x.site, name: e.target.value || 'Site' } }))} />
          </label>
          <p className="muted">
            {plan.site.lat.toFixed(5)}, {plan.site.lon.toFixed(5)} · chosen {plan.site.origin === 'globe' ? 'on the globe' : plan.site.origin === 'saved-location' ? 'from a saved location' : 'from the map centre'}
          </p>
          <div className="btn-row">
            <button className="btn small-btn primary" onClick={() => p.flyToSite(plan.site.lat, plan.site.lon, Math.max(300, plan.analysis.radiusM * 1.4), plan.id)}>View site in 3D</button>
            <button className="btn small-btn" onClick={() => pl.setPick('site')}>Choose another place</button>
            <button className="btn small-btn" onClick={pl.close}>Close plan</button>
          </div>
          <MoveSubject {...p} />
          <RunCoverage {...p} photoreal={p.photoreal} />
        </div>
      ) : (
        <div className="small">
          <p>Search with the search box at the top of the window, then use the map centre — or click the globe, or use a saved location.</p>
          <div className="btn-row">
            <button className="btn small-btn primary" onClick={() => pl.setPick('site')}>Pick on the globe</button>
            <button className="btn small-btn" onClick={useCenter}>Use map centre</button>
          </div>
          {p.locations.length > 0 && (
            <div className="btn-row">
              <select aria-label="Saved location" value={locId} onChange={(e) => setLocId(e.target.value)}>
                <option value="">Saved location…</option>
                {p.locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button className="btn small-btn" disabled={!locId} onClick={useLocation}>Use</button>
            </div>
          )}
          {pl.plans.length > 0 && (
            <>
              <div className="diag-sub">Saved plans</div>
              <SavedPlans {...p} />
            </>
          )}
        </div>
      )}
      {plan && (
        <>
          <div className="diag-sub">3D site model — what you are looking at</div>
          <ul className="plan-sources small">
            <li>
              <strong>Terrain:</strong> {p.settings.terrainEnabled ? 'on' : 'off'} (display). Analysis always samples terrain. {!p.settings.terrainEnabled && <button className="link-btn small" onClick={() => p.patch({ terrainEnabled: true })}>Turn on</button>}
            </li>
            <li>
              <strong>Buildings:</strong>{' '}
              {p.photoreal ? 'Google Photorealistic 3D (display only — not used in the coverage model).' : p.settings.buildings3d ? 'OpenStreetMap footprints extruded to mapped or estimated heights — simple blocks, not verified 3D models.' : 'off.'}{' '}
              {!p.photoreal && !p.settings.buildings3d && <button className="link-btn small" onClick={() => p.patch({ buildings3d: true })}>Show OSM 3D buildings</button>}
            </li>
            <li className="muted">Where OpenStreetMap has no buildings mapped the ground looks open; that is missing data, not open ground.</li>
            <li>
              <strong>Close-up performance:</strong> {p.settings.renderQuality === 'maximum' ? 'Maximum quality' : 'Balanced quality'}.{' '}
              <button className="link-btn small" onClick={() => p.patch({ renderQuality: p.settings.renderQuality === 'maximum' ? 'balanced' : 'maximum' })}>
                Switch to {p.settings.renderQuality === 'maximum' ? 'balanced' : 'maximum'}
              </button>
            </li>
          </ul>
          <SatellitePassesNearSite key={`${plan.id}|${plan.site.lat}|${plan.site.lon}`} {...p} />
        </>
      )}
    </>
  );
}

function SavedPlans(p: PlanningPanelProps) {
  const pl = p.planning;
  return (
    <ul className="anno-list">
      {pl.plans.map((x) => (
        <li key={x.id}>
          <span className="anno-name">{x.name}</span>
          <span className="muted small">{new Date(x.updatedAt).toLocaleDateString()}</span>
          <button className="link-btn small" onClick={() => { const id = pl.open(x.id); if (id) p.flyToSite(x.site.lat, x.site.lon, Math.max(300, x.analysis.radiusM * 1.4), id); }}>Open</button>
          <button className="link-btn small" onClick={() => { if (window.confirm(`Delete the plan “${x.name}”? This cannot be undone.`)) void pl.remove(x.id); }}>Delete</button>
        </li>
      ))}
    </ul>
  );
}

const PASS_WINDOW_MS = 12 * 3600_000;
const PASS_TIMEOUT_MS = 8000;
type PassSummary = ReturnType<typeof summarisePasses> & { startMs: number; total: number };

/** Predicted passes of satellites already loaded by the Satellites layer (orbit predictions, not imaging). */
function SatellitePassesNearSite(p: PlanningPanelProps) {
  const plan = p.planning.plan!;
  const sats = (p.layerSnaps.satellites?.records ?? []).filter((r): r is GeoRecord & { tle: [string, string] } => !!r.tle).slice(0, 60);
  const [summary, setSummary] = useState<PassSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const workerRef = useRef<Worker | null>(null);
  useEffect(
    () => () => {
      // Clearing the ref makes a computation still waiting on a reply stop at its next check.
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );
  // The list describes a fixed window; once that window is partly over it is said so, not relabelled "next 12 h".
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const compute = async () => {
    workerRef.current?.terminate();
    let worker = new Worker(new URL('../map/satellitePassWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setBusy(true);
    const startMs = Date.now();
    const outcomes: { name: string; result: SatellitePassResult | null }[] = [];
    try {
      for (const s of sats) {
        const w = worker;
        const result = await new Promise<SatellitePassResult | null>((resolve) => {
          const timer = setTimeout(() => resolve(null), PASS_TIMEOUT_MS);
          const done = (r: SatellitePassResult | null) => {
            clearTimeout(timer);
            resolve(r);
          };
          w.onmessage = (e: MessageEvent<{ ok: true; result: SatellitePassResult } | { ok: false; error: string }>) => done(e.data.ok ? e.data.result : null);
          w.onerror = () => done(null);
          w.postMessage({ tle: s.tle, observer: { lat: plan.site.lat, lon: plan.site.lon, heightM: 0 }, startMs, thresholdDeg: 30 } satisfies PassRequest);
        });
        if (workerRef.current !== w) return; // superseded or unmounted
        outcomes.push({ name: s.label, result });
        if (!result) {
          // A failed or timed-out calculation may have left the worker busy or broken: continue with a fresh one.
          w.terminate();
          worker = new Worker(new URL('../map/satellitePassWorker.ts', import.meta.url), { type: 'module' });
          workerRef.current = worker;
        }
      }
      setNow(Date.now());
      setSummary({ ...summarisePasses(outcomes, startMs, PASS_WINDOW_MS), startMs, total: sats.length });
    } finally {
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
      }
    }
  };
  const expired = !!summary && now - summary.startMs >= PASS_WINDOW_MS;
  const aged = !!summary && now - summary.startMs >= 10 * 60_000;
  return (
    <>
      <div className="diag-sub">Predicted satellite passes (12 hours from the calculation)</div>
      {!sats.length ? (
        <p className="small muted">
          Uses the Satellites layer’s loaded orbits. <button className="link-btn small" onClick={() => p.enableLayers(['satellites'])}>Turn on Satellites</button>
        </p>
      ) : (
        <div className="small">
          <button className="btn small-btn" disabled={busy} onClick={() => void compute()}>{busy ? 'Predicting…' : `Predict passes above 30° for ${sats.length} loaded satellites`}</button>
          {summary && (
            <>
              <p className="muted">
                Calculated {new Date(summary.startMs).toLocaleTimeString()} for {new Date(summary.startMs).toLocaleString()} – {new Date(summary.startMs + PASS_WINDOW_MS).toLocaleString()}.
                {expired ? ' This window has ended; predict again.' : aged ? ' Earlier entries may already have passed; predict again for a current list.' : ''}
              </p>
              {summary.ok === 0 ? (
                <p className="err-text">Predictions are unavailable: none of the {summary.total} calculations completed. Reload the Satellites layer and try again.</p>
              ) : (
                <>
                  {summary.failed > 0 && <p className="err-text">Incomplete: {summary.failed} of {summary.total} satellites could not be calculated and are not in this list.</p>}
                  {summary.stale > 0 && <p className="err-text">{summary.stale} of {summary.ok} satellites have orbital elements more than 7 days old; their times (marked “old elements”) can be well off.</p>}
                  {!expired && (summary.rows.length ? (
                    <ul className="plan-list">
                      {summary.rows.map((r, i) => <li key={i}>{new Date(r.peakAt).toLocaleTimeString()} · {r.name} · peak {Math.round(r.maxEl)}°{r.stale ? ' · old elements' : ''}</li>)}
                    </ul>
                  ) : <p className="muted">No pass above 30° predicted in that window for the {summary.ok} satellites that could be calculated.</p>)}
                </>
              )}
            </>
          )}
          <p className="muted">Orbit predictions from published elements. A pass does not mean a satellite is imaging this site; Atlas Watch cannot show live video of arbitrary places.</p>
        </div>
      )}
    </>
  );
}

/** Keyboard alternative to dragging the subject marker: nudge it by a few metres. */
function MoveSubject(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const [stepM, setStepM] = useState(5);
  const nudge = (north: number, east: number) => {
    const lat = Math.max(-85, Math.min(85, plan.site.lat + (north * stepM) / 111_320));
    let lon = plan.site.lon + (east * stepM) / (111_320 * Math.cos((plan.site.lat * Math.PI) / 180));
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    pl.dragTo({ kind: 'site' }, lat, lon, true);
  };
  return (
    <div className="plan-move small" role="group" aria-label="Move the subject">
      <p className="muted">Drag the yellow subject marker on the map, or move it here. Rooftop sight lines follow as it moves; coverage re-runs when you let go.</p>
      <div className="btn-row">
        <button className="btn small-btn" onClick={() => nudge(1, 0)} aria-label={`Move north ${stepM} m`}>N</button>
        <button className="btn small-btn" onClick={() => nudge(0, -1)} aria-label={`Move west ${stepM} m`}>W</button>
        <button className="btn small-btn" onClick={() => nudge(0, 1)} aria-label={`Move east ${stepM} m`}>E</button>
        <button className="btn small-btn" onClick={() => nudge(-1, 0)} aria-label={`Move south ${stepM} m`}>S</button>
        <select aria-label="Step" value={stepM} onChange={(e) => setStepM(Number(e.target.value))}>
          {[1, 5, 10, 25, 50].map((m) => <option key={m} value={m}>{m} m</option>)}
        </select>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2 Coverage

function ObserverRow({ o, p }: { o: PlanObserver; p: PlanningPanelProps }) {
  const pl = p.planning;
  const set = (patch: Partial<PlanObserver>) => pl.update((x) => ({ ...x, observers: x.observers.map((y) => (y.id === o.id ? { ...y, ...patch } : y)) }));
  const r = pl.plan?.lastRun?.perObserver.find((x) => x.id === o.id);
  const a = r?.counts.analysed ?? 0;
  const directional = o.headingDeg !== null;
  return (
    <li className={`plan-obs ${pl.selectedObserverId === o.id ? 'sel' : ''}`} onFocus={() => pl.setSelectedObserverId(o.id)}>
      <div className="field-row">
        <label className="field grow"><span>{o.kind === 'camera' ? 'Camera' : 'Point'}</span><input value={o.name} maxLength={80} onChange={(e) => set({ name: e.target.value || 'Point' })} /></label>
        <label className="field"><span>Height m</span><input type="number" min={0} max={300} step={0.5} value={o.heightM} onChange={(e) => set({ heightM: num(e.target.value, 0, 300, o.heightM) })} title="Eye or lens height above the ground or the mapped roof under the point" /></label>
        <label className="field"><span>Range m</span><input type="number" min={10} max={5000} step={10} value={o.rangeM} onChange={(e) => set({ rangeM: num(e.target.value, 10, 5000, o.rangeM) })} /></label>
      </div>
      <div className="field-row">
        {o.kind === 'observer' && (
          <label className="field inline small"><input type="checkbox" checked={directional} onChange={(e) => set(e.target.checked ? { headingDeg: 0, fovDeg: 90, direction: 'user-estimate' } : { headingDeg: null, fovDeg: null, direction: 'all' })} /> Limit to a direction</label>
        )}
        {directional && (
          <>
            <label className="field"><span>Facing °</span><input type="number" min={0} max={360} value={o.headingDeg ?? 0} onChange={(e) => set({ headingDeg: num(e.target.value, 0, 360, 0), direction: 'user-estimate' })} title="Degrees clockwise from north" /></label>
            <label className="field"><span>Field of view °</span><input type="number" min={1} max={360} value={o.fovDeg ?? 90} onChange={(e) => set({ fovDeg: num(e.target.value, 1, 360, 90) })} /></label>
          </>
        )}
      </div>
      <p className="muted small">
        {o.kind === 'camera' ? `${o.camera ? `${o.camera.source} · ${o.camera.media ?? 'media type not recorded'} · catalogue ${o.camera.catalogueAt ? fmtTime(o.camera.catalogueAt) : 'time not recorded'}. ` : ''}Direction ${o.direction === 'publisher' ? 'from the publisher' : 'is your estimate'}; field of view is your estimate. Height is your estimate.` : directional ? 'Direction is your estimate.' : 'Looks in all directions.'}
        {r && !pl.stale && (r.error ? ` Not modelled: ${r.error}` : a ? ` Last run: visible ${Math.round(((r.counts.visible ?? 0) / a) * 100)}%, blocked ${Math.round(((r.counts.blocked ?? 0) / a) * 100)}%, unknown ${Math.round(((r.counts.unknown ?? 0) / a) * 100)}%.` : '')}
      </p>
      <div className="btn-row">
        <button className="link-btn small" onClick={() => pl.plan && p.flyAbove(o.lat, o.lon, Math.max(150, o.rangeM * 1.2), pl.plan.id)}>Go</button>
        {o.camera && <button className="link-btn small" onClick={() => p.selectRecord('cameras', o.camera!.recordId)}>Open camera</button>}
        <button className="link-btn small" onClick={() => pl.update((x) => ({ ...x, observers: x.observers.filter((y) => y.id !== o.id) }))}>Remove</button>
      </div>
    </li>
  );
}

/** The coverage run: from the subject itself (and any extra points). Shown in step 1 and step 2. */
function RunCoverage(p: PlanningPanelProps & { photoreal: boolean }) {
  const pl = p.planning;
  const plan = pl.plan!;
  const a = plan.analysis;
  const run = plan.lastRun;
  const total = run?.combined.analysed ?? 0;
  const share = (k: string) => (run && total ? (run.combined[k] ?? 0) / total : null);
  const running = pl.analysis.state === 'running';
  const setA = (patch: Partial<typeof a>) => pl.update((x) => ({ ...x, analysis: { ...x.analysis, ...patch } }));
  const subjectRun = !pl.stale ? run?.perObserver.find((r) => r.id === SUBJECT_OBSERVER_ID) : undefined;
  const sa = subjectRun?.counts.analysed ?? 0;
  const points = coverageObservers(plan).length;
  return (
    <>
      <div className="diag-sub">What the subject can see — and what can see it</div>
      <label className="field inline small">
        <input type="checkbox" checked={a.subjectView !== false} onChange={(e) => setA({ subjectView: e.target.checked })} /> Model sight lines from the subject (eye {a.targetHeightM} m) over {formatMeters(a.radiusM)}
      </label>
      {subjectRun && sa > 0 && <p className="small muted">Subject: clear {Math.round(((subjectRun.counts.visible ?? 0) / sa) * 100)}%, blocked {Math.round(((subjectRun.counts.blocked ?? 0) / sa) * 100)}%, unknown {Math.round(((subjectRun.counts.unknown ?? 0) / sa) * 100)}% of the area.{plan.observers.length ? ' Shares below combine it with the extra points.' : ''}</p>}
      <div className="note small">
        OpenStreetMap does not say how complete its buildings are here. The model can only treat ground without a mapped building as open — trees, walls and unmapped buildings are then not accounted for, and lines may be shown as clear that are not.
        <label className="field inline"><input type="checkbox" checked={a.assumeMappedComplete} onChange={(e) => setA({ assumeMappedComplete: e.target.checked })} /> Model ground without mapped buildings as open (recorded in the briefing)</label>
      </div>
      <div className="btn-row">
        <button className="btn small-btn primary" disabled={running || !points || !a.assumeMappedComplete} onClick={() => void pl.run()}>{run ? 'Run again' : 'Model coverage'}</button>
        {running && <button className="btn small-btn" onClick={pl.cancel}>Cancel</button>}
      </div>
      {pl.analysis.state === 'running' && (
        <div className="small" role="status" aria-live="polite">
          {pl.analysis.stage}…
          <div className="plan-progress"><div style={{ width: `${Math.round(pl.analysis.progress * 100)}%` }} /></div>
        </div>
      )}
      {pl.analysis.state === 'error' && <p className="err-text small">{pl.analysis.error}</p>}
      {pl.analysis.state === 'cancelled' && <p className="small muted">Analysis cancelled.</p>}
      {run && (
        <div className="small">
          {pl.stale && <p className="err-text">Inputs changed since this run — run again before relying on it.</p>}
          {!pl.result && <p className="muted">These figures are from the saved run ({fmtTime(run.at)}); run again to see the grid on the map with current data.</p>}
          <table className="plan-table">
            <tbody>
              <tr><th>Clear sight line from one point</th><td>{formatShare(share('covered'))}</td></tr>
              <tr><th>Clear from two or more</th><td>{formatShare(share('overlap'))}</td></tr>
              <tr><th>Blocked (modelled gaps)</th><td>{formatShare(share('gap'))}</td></tr>
              <tr><th>Unknown (no data)</th><td>{formatShare(share('unknown'))}</td></tr>
            </tbody>
          </table>
          <Legend site={pl.siteLook} />
          <p className="muted">“Clear” means nothing in the mapped terrain and OpenStreetMap buildings blocks the line. OpenStreetMap’s completeness here is not known: trees, walls, vehicles and unmapped buildings can block lines shown as clear.</p>
          {pl.result && (
            <div className="field-row">
              <label className="field inline"><input type="checkbox" checked={pl.showCoverage} onChange={(e) => pl.setShowCoverage(e.target.checked)} /> Show on map</label>
              <label className="field grow"><span>Opacity</span><input type="range" min={0.2} max={1} step={0.05} value={pl.coverageOpacity} onChange={(e) => pl.setCoverageOpacity(Number(e.target.value))} /></label>
            </div>
          )}
          {p.photoreal && <p className="note">Google Photorealistic 3D is on: the coverage grid is drawn on the terrain globe, which Photoreal hides. Switch the surface to another imagery to see it.</p>}
          <details className="layer-info">
            <summary>Data used and limitations</summary>
            <p>Terrain: {run.terrain.source} {run.terrain.missingCells ? `(${run.terrain.missingCells} cells had no terrain data → unknown).` : ''}</p>
            <p>Buildings: {run.buildings.source} {run.buildings.tilesLoaded} tiles loaded{run.buildings.tilesFailed ? `, ${run.buildings.tilesFailed} could not be loaded (their area is unknown)` : ''}; {run.buildings.buildingCells.toLocaleString()} building cells.</p>
            <p>{SOURCES.photoreal}</p>
            <ul>{LIMITATIONS.slice(0, 3).map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
        </div>
      )}
    </>
  );
}

function CoverageStep(p: PlanningPanelProps & { photoreal: boolean }) {
  const pl = p.planning;
  const plan = pl.plan!;
  const a = plan.analysis;
  const minCell = minCellFor(a.radiusM);
  const cellM = Math.max(a.cellM, minCell);
  const n = gridSize(a.radiusM, cellM);
  const setA = (patch: Partial<typeof a>) => pl.update((x) => ({ ...x, analysis: { ...x.analysis, ...patch } }));
  return (
    <>
      <div className="diag-sub">Analysis area</div>
      <div className="field-row small">
        <label className="field"><span>Radius m</span><input type="number" min={50} max={MAX_RADIUS_M} step={50} value={a.radiusM} onChange={(e) => setA({ radiusM: num(e.target.value, 50, MAX_RADIUS_M, a.radiusM) })} /></label>
        <label className="field"><span>Cell m</span><input type="number" min={2} max={50} step={1} value={a.cellM} onChange={(e) => setA({ cellM: num(e.target.value, 2, 50, a.cellM) })} title={`At least ${minCell} m for this radius`} /></label>
        <label className="field"><span>Target height m</span><input type="number" min={0} max={50} step={0.1} value={a.targetHeightM} onChange={(e) => setA({ targetHeightM: num(e.target.value, 0, 50, a.targetHeightM) })} title="Height above the surface that must be visible (1.7 m ≈ a standing person)" /></label>
      </div>
      <p className="muted small">{n} × {n} cells of {cellM} m{cellM > a.cellM ? ` (raised from ${a.cellM} m for this radius)` : ''}.</p>

      <div className="diag-sub">Extra observation points and cameras ({plan.observers.length})</div>
      <p className="small muted">The subject (the site marker) is already modelled. Add points only for other places someone watches from: a guard post, a rooftop, a camera.</p>
      <ul className="plan-list">{plan.observers.map((o) => <ObserverRow key={o.id} o={o} p={p} />)}</ul>
      <div className="btn-row">
        <button className="btn small-btn" onClick={() => pl.setPick('observer')}>Add point on the globe</button>
      </div>
      <PublicCameras {...p} />

      <RunCoverage {...p} />
    </>
  );
}

function PublicCameras(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const snap = p.layerSnaps.cameras;
  const [draft, setDraft] = useState<{ rec: GeoRecord; heading: string; fov: string; height: string } | null>(null);
  const near = useMemo(
    () => (snap?.records ?? []).map((r) => ({ r, d: distM(plan.site, r) })).filter((x) => x.d <= Math.max(plan.analysis.radiusM, 500)).sort((a, b) => a.d - b.d).slice(0, 25),
    [snap?.records, plan.site.lat, plan.site.lon, plan.analysis.radiusM],
  );
  if (!p.settings.layersEnabled.includes('cameras'))
    return <p className="small muted">Public traffic cameras near the site come from the Cameras layer. <button className="link-btn small" onClick={() => p.enableLayers(['cameras'])}>Turn on Cameras</button></p>;
  return (
    <div className="small">
      <div className="diag-sub">Public cameras within {formatMeters(Math.max(plan.analysis.radiusM, 500))} ({near.length})</div>
      {!near.length && <p className="muted">None in the loaded camera catalogues here. That reflects published catalogues, not whether cameras exist.</p>}
      <ul className="plan-list">
        {near.map(({ r, d }) => (
          <li key={r.id}>
            {r.label} · {formatMeters(d)} · <span className="muted">{r.source} · {String(r.props.mediaType ?? 'still')}{snap?.status.lastSuccessAt ? ` · catalogue ${fmtTime(snap.status.lastSuccessAt)}` : ''} · direction {r.heading === null ? 'not published' : `${Math.round(r.heading)}° (publisher)`}</span>{' '}
            <button className="link-btn small" onClick={() => p.selectRecord('cameras', r.id)}>View</button>
            <button className="link-btn small" onClick={() => setDraft({ rec: r, heading: r.heading === null ? '' : String(Math.round(r.heading)), fov: '', height: '6' })}>Model coverage…</button>
          </li>
        ))}
      </ul>
      {draft && (
        <div className="note">
          <strong>{draft.rec.label}</strong>: coverage is only modelled with a direction and field of view. {draft.rec.heading === null ? 'The publisher does not supply the direction — enter your own estimate (e.g. from the camera image).' : 'Direction from the publisher; the field of view is your estimate.'}
          <div className="field-row">
            <label className="field"><span>Facing °</span><input type="number" min={0} max={360} value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} /></label>
            <label className="field"><span>Field of view °</span><input type="number" min={1} max={360} value={draft.fov} onChange={(e) => setDraft({ ...draft, fov: e.target.value })} /></label>
            <label className="field"><span>Height m (estimate)</span><input type="number" min={0} max={300} value={draft.height} onChange={(e) => setDraft({ ...draft, height: e.target.value })} /></label>
          </div>
          <div className="btn-row">
            <button
              className="btn small-btn primary"
              disabled={draft.heading.trim() === '' || draft.fov.trim() === '' || !Number.isFinite(Number(draft.heading)) || !Number.isFinite(Number(draft.fov))}
              onClick={() => {
                pl.addObserver(draft.rec.lat, draft.rec.lon, {
                  name: draft.rec.label.slice(0, 80) || 'Camera',
                  kind: 'camera',
                  heightM: num(draft.height, 0, 300, 6),
                  headingDeg: num(draft.heading, 0, 360, 0),
                  fovDeg: num(draft.fov, 1, 360, 60),
                  rangeM: Math.min(300, plan.analysis.radiusM),
                  // Publisher provenance only for the published value left unchanged.
                  direction: draft.rec.heading !== null && Number(draft.heading) === Math.round(draft.rec.heading) ? 'publisher' : 'user-estimate',
                  camera: { recordId: draft.rec.id.slice(0, 200), source: draft.rec.source.slice(0, 200), label: draft.rec.label.slice(0, 200), catalogueAt: snap?.status.lastSuccessAt ?? null, media: String(draft.rec.props.mediaType ?? 'still').slice(0, 40), publishedHeadingDeg: draft.rec.heading === null ? null : Math.min(360, Math.max(0, draft.rec.heading)) },
                });
                setDraft(null);
              }}
            >
              Add camera
            </button>
            <button className="btn small-btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="muted">Live images open in the existing camera viewer, only from publishers already configured. Projecting video onto the 3D scene is not provided: it needs a calibrated camera position, lens and orientation.</p>
    </div>
  );
}

// ------------------------------------------------------------------ 3 Rooftops

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => `${COMPASS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;

function RooftopsStep(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const ow = pl.overwatch;
  const a = plan.analysis;
  const setA = (patch: Partial<typeof a>) => pl.update((x) => ({ ...x, analysis: { ...x.analysis, ...patch } }));
  const ready = ow.state === 'ready' ? ow : null;
  return (
    <>
      <div className="diag-sub">Rooftops with a line of sight to the subject</div>
      <p className="muted small">
        Lists mapped rooftops from which a person could have a clear straight line to the subject (the yellow site marker), using terrain and OpenStreetMap building heights. Drag the marker and the list and outlines update. This finds elevated vantage points to check or cover; it is a geometric estimate, not a threat or safety rating.
      </p>
      <div className="field-row small">
        <label className="field"><span>Subject height m</span><input type="number" min={0} max={50} step={0.1} value={a.targetHeightM} onChange={(e) => setA({ targetHeightM: num(e.target.value, 0, 50, a.targetHeightM) })} title="Eye or head height of the subject above the surface" /></label>
        <label className="field"><span>Eye height on roof m</span><input type="number" min={0.2} max={5} step={0.1} value={pl.roofEyeM} onChange={(e) => pl.setRoofEyeM(num(e.target.value, 0.2, 5, pl.roofEyeM))} title="Height above the roof surface of someone looking out (about 0.4 m lying, 1.5 m standing)" /></label>
        <label className="field inline"><input type="checkbox" checked={pl.overwatchOn} onChange={(e) => pl.setOverwatchOn(e.target.checked)} /> Show on map</label>
      </div>
      {!a.assumeMappedComplete && (
        <div className="note small">
          OpenStreetMap does not say how complete its buildings are here. Rooftops that are not mapped cannot be listed, and ground without a mapped building is treated as open.
          <label className="field inline"><input type="checkbox" checked={a.assumeMappedComplete} onChange={(e) => setA({ assumeMappedComplete: e.target.checked })} /> Model ground without mapped buildings as open (recorded in the briefing)</label>
        </div>
      )}
      {ow.state === 'needs-area' && (
        <div className="small">
          <p className="muted">{ow.reason}</p>
          <button className="btn small-btn primary" disabled={!a.assumeMappedComplete} onClick={() => void pl.loadArea()}>Load site area ({formatMeters(a.radiusM)} radius)</button>
        </div>
      )}
      {ow.state === 'loading' && (
        <div className="small" role="status" aria-live="polite">
          Loading terrain and OpenStreetMap buildings…
          <div className="plan-progress"><div style={{ width: `${Math.round(ow.progress * 100)}%` }} /></div>
        </div>
      )}
      {ow.state === 'running' && <p className="small muted" role="status">Checking rooftops…</p>}
      {ow.state === 'error' && (
        <div className="small">
          <p className="err-text">{ow.error}</p>
          <button className="btn small-btn" onClick={() => void pl.loadArea()}>Try again</button>
        </div>
      )}
      {ow.state === 'off' && <p className="small muted">Turn on “Show on map” to check rooftops.</p>}
      {!ready && plan.rooftops && (
        <p className={`small ${rooftopStudyIsStale(plan) ? 'err-text' : 'muted'}`}>
          Saved list from {new Date(plan.rooftops.at).toLocaleString()}: {plan.rooftops.total} roof{plan.rooftops.total === 1 ? '' : 's'} with a clear line. {rooftopStudyIsStale(plan) ? 'The subject has moved since, so it is marked out of date in the briefing; load the area to recompute.' : 'It is included in the briefing.'}
        </p>
      )}
      {ready && (
        <div className="small" aria-live="polite">
          <p>
            <strong>{ready.result.rooftops.length}</strong> of {ready.result.groupsInRange} mapped roof{ready.result.groupsInRange === 1 ? '' : 's'} in the loaded area {ready.result.rooftops.length === 1 ? 'has' : 'have'} a clear modelled line to the subject
            {ready.result.rooftops.length ? `; the nearest is ${formatMeters(ready.result.rooftops[0].distanceM)} away.` : '.'}
          </p>
          {ready.result.subjectRoofM !== null && <p className="note">The subject marker is on a mapped building, so the subject is modelled standing on its roof ({Math.round(ready.result.subjectRoofM)} m up). Drag it onto the street or open ground to model someone at street level.</p>}
          {ready.result.undetermined > 0 && <p className="err-text">{ready.result.undetermined} roof{ready.result.undetermined === 1 ? '' : 's'} could not be decided because terrain or building data is missing on the way.</p>}
          {ready.result.unknownBuildingCells > 0 && <p className="err-text">Building data was unavailable for {ready.result.unknownBuildingCells.toLocaleString()} cells; roofs there cannot be assessed.</p>}
          {ready.result.error && <p className="err-text">{ready.result.error}</p>}
          {ready.result.rooftops.length > 0 && (
            <table className="plan-table">
              <thead><tr><th>#</th><th>Distance</th><th>Direction</th><th>Roof height</th><th title="Angle from the subject up to the roof">Angle</th><th title="Share of this roof with a clear line">Clear part</th><th /></tr></thead>
              <tbody>
                {ready.result.rooftops.slice(0, 40).map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{formatMeters(r.distanceM)}</td>
                    <td>{compass(r.bearingDeg)}</td>
                    <td>{Math.round(r.heightM)} m</td>
                    <td>{r.elevationDeg >= 0 ? '+' : ''}{Math.round(r.elevationDeg)}°</td>
                    <td>{formatShare(r.visibleCells / r.cells)}</td>
                    <td><button className="link-btn small" onClick={() => p.flyToSite(r.lat, r.lon, 160, plan.id)}>Go</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ready.result.rooftops.length > 40 && <p className="muted">Showing the nearest 40; the map outlines the nearest 60.</p>}
          <p className="muted">
            Outlined in vermillion on the map, with dashed sight lines to the nearest 12. Heights come from OpenStreetMap height or level tags, or a default where none are mapped. Not modelled: parapets, roof structures, trees, glazing, and buildings missing from OpenStreetMap — a roof that is not listed is not shown to be safe. Calculated {new Date(ready.at).toLocaleTimeString()}; saved with the plan and included in the briefing when you save or export.
          </p>
          {p.settings.basemap === 'google3d' && <p className="note">Google Photorealistic 3D is on: outlines are drawn at OpenStreetMap roof heights, which may not match the photoreal mesh.</p>}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ 4 Buildings

function BuildingCard({ b }: { b: BuildingInfo }) {
  const url = `https://www.openstreetmap.org/${b.osmType}/${b.osmId}`;
  const val = (v: string | number | null, unit = '') => (v === null || v === '' ? <span className="muted">not mapped</span> : <>{v}{unit}</>);
  return (
    <div className="note small">
      <strong>{b.name ?? (b.buildingType ? `Building (${b.buildingType})` : 'Building')}</strong>
      {b.match === 'nearest' && <span className="muted"> · nearest mapped building, {Math.round(b.distanceM)} m from the point you clicked</span>}
      {b.match === 'bounds' && <span className="err-text"> · uncertain: only this building’s bounding box could be read ({Math.round(b.distanceM)} m away); the point may not be on it</span>}
      <table className="plan-table">
        <tbody>
          <tr><th>Address</th><td>{val(b.address)}</td></tr>
          <tr><th>Type / use</th><td>{val([b.buildingType, b.use].filter(Boolean).join(' · ') || null)}</td></tr>
          <tr><th>Height</th><td>{b.height ? <>{b.height.value} m <span className="muted">({b.height.source === 'reported' ? 'reported in OSM' : 'estimated: floors × 3 m'})</span></> : val(null)}</td></tr>
          <tr><th>Floors</th><td>{val(b.levels)}{b.minLevel !== null && <span className="muted"> (lowest level {b.minLevel})</span>}</td></tr>
          <tr><th>Footprint</th><td>{b.footprintAreaM2 !== null ? `${b.footprintAreaM2.toLocaleString()} m²` : val(null)}</td></tr>
          <tr><th>Built</th><td>{val(b.startDate)}</td></tr>
          <tr><th>Operator</th><td>{val(b.operator)}{b.operator && <span className="muted"> (community-mapped)</span>}</td></tr>
          <tr><th>Owner</th><td className="muted">Not available — no property-records provider is configured.</td></tr>
          <tr><th>Interior / occupants</th><td className="muted">Not known. Add a floor plan you are authorised to use.</td></tr>
        </tbody>
      </table>
      <p className="muted">
        Source: OpenStreetMap (© contributors, ODbL), last edited {fmtTime(b.lastEditedAt)}, fetched {fmtTime(b.fetchedAt)}.{' '}
        <button className="link-btn small" onClick={() => void api.openExternal(url)}>Open in OpenStreetMap</button>
      </p>
    </div>
  );
}

function BuildingsStep(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="diag-sub">Building information</div>
      <div className="btn-row">
        <button className="btn small-btn primary" disabled={pl.lookup.buildingBusy} onClick={() => pl.setPick('building')}>{pl.lookup.buildingBusy ? 'Looking up…' : 'Inspect a building on the map'}</button>
      </div>
      <p className="muted small">{SOURCES.buildingInfo}</p>
      {pl.lookup.building && <p className="small muted">{pl.lookup.building}</p>}
      {pl.selectedBuilding && <BuildingCard b={pl.selectedBuilding} />}
      {plan.buildings.length > 0 && (
        <>
          <div className="diag-sub">Inspected in this plan ({plan.buildings.length})</div>
          <ul className="plan-list small">
            {plan.buildings.map((b) => (
              <li key={`${b.osmType}${b.osmId}`}>
                <button className="link-btn small" onClick={() => pl.setSelectedBuilding(b)}>{b.name ?? b.address ?? `${b.osmType} ${b.osmId}`}</button>
                <button className="link-btn small" onClick={() => pl.update((x) => ({ ...x, buildings: x.buildings.filter((y) => y !== b) }))}>Remove</button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="diag-sub">Floor plans</div>
      <p className="muted small">Add a floor plan image you are authorised to use, place it on the map and set its scale, rotation and floor. It is shown as you aligned it; the app does not know a building’s interior from imagery.</p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pl.addFloorPlan(f); e.target.value = ''; }} />
      <div className="btn-row">
        <button className="btn small-btn" onClick={() => fileRef.current?.click()}>Add floor plan image…</button>
        {plan.floorPlans.length > 0 && p.settings.buildings3d && <button className="btn small-btn" onClick={() => p.patch({ buildings3d: false })} title="The building blocks around a floor hide it">Hide 3D buildings to see floors</button>}
      </div>
      <ul className="plan-list">
        {plan.floorPlans.map((f) => {
          const set = (patch: Partial<typeof f>) => pl.updateFloorPlan(f.id, patch);
          const unconfirmed = (['scale', 'orientation', 'floor'] as const).filter((k) => !f.confirmed[k]);
          return (
            <li key={f.id} className="plan-obs">
              <div className="field-row small">
                <label className="field grow"><span>Name</span><input value={f.name} maxLength={120} onChange={(e) => set({ name: e.target.value || 'Floor plan' })} /></label>
                <label className="field"><span>Width m</span><input type="number" min={1} max={Math.floor(Math.min(2000, (2000 * f.widthM) / f.heightM))} step={0.5} value={f.widthM} title="The longer side can be at most 2000 m" onChange={(e) => { const maxW = Math.min(2000, (2000 * f.widthM) / f.heightM); const w = num(e.target.value, 1, maxW, f.widthM); set({ widthM: w, heightM: Math.max(1, Math.round(((f.heightM / f.widthM) * w) * 10) / 10) }); }} /></label>
                <label className="field"><span>Rotation °</span><input type="number" min={-180} max={180} value={f.rotationDeg} onChange={(e) => set({ rotationDeg: num(e.target.value, -180, 180, 0) })} /></label>
              </div>
              <div className="field-row small">
                <label className="field"><span>Floor</span><input type="number" min={-10} max={200} value={f.level} onChange={(e) => { const level = Math.round(num(e.target.value, -10, 200, 0)); set({ level, elevationM: level * 3 }); }} /></label>
                <label className="field"><span>Height above ground m</span><input type="number" min={-50} max={1000} step={0.1} value={f.elevationM} onChange={(e) => set({ elevationM: num(e.target.value, -50, 1000, 0) })} /></label>
                <label className="field grow"><span>Opacity</span><input type="range" min={0.1} max={1} step={0.05} value={f.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} /></label>
              </div>
              <div className="field-row small">
                {(['scale', 'orientation', 'floor'] as const).map((k) => (
                  <label key={k} className="field inline"><input type="checkbox" checked={f.confirmed[k]} onChange={(e) => set({ confirmed: { ...f.confirmed, [k]: e.target.checked } })} /> {k} confirmed</label>
                ))}
              </div>
              {unconfirmed.length > 0 && <p className="small err-text">Not confirmed: {unconfirmed.join(', ')}. Check against the real building before relying on it.</p>}
              <div className="btn-row">
                <button className="link-btn small" onClick={() => pl.setPick({ floorPlan: f.id })}>Place centre on map</button>
                <button className="link-btn small" onClick={() => p.flyAbove(f.lat, f.lon, Math.max(60, f.widthM * 1.6), plan.id, f.elevationM)}>View this floor</button>
                <button className="link-btn small" onClick={() => pl.update((x) => ({ ...x, floorPlans: x.floorPlans.filter((y) => y.id !== f.id) }))}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Not provided: importing 3D building models, and converting a 2D plan into 3D rooms. Floor heights are relative to the terrain at the plan’s centre; a plan appears on the map only once that terrain height is known (it is retried if unavailable), and it is not drawn over Google Photoreal 3D.</p>
    </>
  );
}

// ------------------------------------------------------------------ 4 Routes and zones

type RouteSort = 'time' | 'overlook' | 'junctions';

const STEP_GLYPH: Record<Maneuver, string> = {
  depart: '●', straight: '↑', 'slight-left': '↖', 'slight-right': '↗', left: '←', right: '→', 'sharp-left': '↙', 'sharp-right': '↘', 'u-turn': '↶', arrive: '◎',
};

function RoutePlanner(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const r = pl.routes;
  const [sort, setSort] = useState<RouteSort>('time');
  const [flying, setFlying] = useState<number | null>(null);
  const fly = (i: number) => {
    if (flying === i) { p.stopFlyAlong(); return; }
    setFlying(i);
    p.flyAlong(r.options[i].points, r.mode, (why) => setFlying((f) => (f === i && why !== 'replaced' ? null : f)));
  };
  const coverage = (pts: [number, number][]) => (pl.result && !pl.stale ? pathCoverage(pl.result.grid, pl.result.combined, pts) : null);
  const order = r.options.map((o, i) => ({ o, i, ov: r.overlook[i] ?? null }));
  if (sort === 'time') order.sort((x, y) => x.o.minutes - y.o.minutes);
  else if (sort === 'junctions') order.sort((x, y) => x.o.junctions - y.o.junctions);
  else order.sort((x, y) => (x.ov?.overlooked ?? 2) - (y.ov?.overlooked ?? 2));
  const busy = r.state === 'loading' || r.state === 'searching';
  const fmt = (v: { lat: number; lon: number } | null) => (v ? `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}` : 'not set');
  return (
    <>
      <div className="diag-sub">Plan a route</div>
      <p className="muted small">Choose a start and a destination; up to three distinct routes are found on the mapped roads and paths, on this computer. Drag the Start and Destination markers to change them.</p>
      <div className="small plan-route-ends">
        {(['a', 'b'] as const).map((end) => (
          <div key={end} className="route-end">
            <span><strong>{end === 'a' ? 'Start' : 'Destination'}:</strong> {fmt(r[end])}</span>
            <span className="btn-row">
              <button className="btn small-btn" onClick={() => pl.setRouteEnd(end, { lat: plan.site.lat, lon: plan.site.lon })}>Use the site</button>
              <button className="btn small-btn" onClick={() => pl.setPick(end === 'a' ? 'route-a' : 'route-b')}>Pick on map</button>
            </span>
          </div>
        ))}
      </div>
      <div className="btn-row small">
        <select aria-label="Travel mode" value={r.mode} onChange={(e) => pl.setRouteMode(e.target.value as 'walk' | 'drive')}>
          <option value="walk">Walking</option>
          <option value="drive">Driving</option>
        </select>
        <button className="btn small-btn primary" disabled={!r.a || !r.b || busy} onClick={() => void pl.computeRoutes()}>{busy ? (r.state === 'loading' ? 'Loading roads…' : 'Finding routes…') : 'Find routes'}</button>
        {r.options.length > 1 && (
          <select aria-label="Order routes by" value={sort} onChange={(e) => setSort(e.target.value as RouteSort)}>
            <option value="time">Order: quickest</option>
            <option value="overlook">Order: least overlooked</option>
            <option value="junctions">Order: fewest junctions</option>
          </select>
        )}
      </div>
      {r.state === 'loading' && <div className="plan-progress" role="status"><div style={{ width: `${Math.round(r.progress * 100)}%` }} /></div>}
      {r.message && <p className={`small ${r.state === 'error' ? 'err-text' : 'muted'}`}>{r.message}</p>}
      {!r.options.length && plan.routeStudy && <p className="small muted">Saved route study from {new Date(plan.routeStudy.at).toLocaleString()}: {plan.routeStudy.options.length} {plan.routeStudy.mode === 'walk' ? 'walking' : 'driving'} option{plan.routeStudy.options.length === 1 ? '' : 's'}, included in the briefing. Find routes again to see them on the map.</p>}
      {r.options.length > 0 && <p className="small muted">These options and their measures are saved with the plan and included in the briefing when you save or export.</p>}
      {r.roads && r.roads.failed > 0 && <p className="small err-text">{r.roads.failed} of {r.roads.tiles} map tiles with roads could not be loaded; routes there may be missing.</p>}
      {r.options.length > 0 && (
        <>
          <ul className="route-options small" aria-label="Route options">
            {order.map(({ o, i, ov }) => {
              const c = coverage(o.points);
              return (
                <li key={i} className={`route-option ${i === r.selected ? 'sel' : ''}`}>
                  <label className="route-head">
                    <input type="radio" name="route-option" checked={i === r.selected} onChange={() => pl.setRoutes((x) => ({ ...x, selected: i }))} />
                    <span className="route-swatch" style={{ background: ROUTE_COLORS[i % ROUTE_COLORS.length] }} aria-hidden="true" />
                    <strong>Route {i + 1}</strong>
                    <span>{formatMeters(o.lengthM)} · about {Math.max(1, Math.round(o.minutes))} min</span>
                  </label>
                  {o.via.length > 0 && <div className="muted">via {o.via.join(', ')}</div>}
                  <dl className="route-facts">
                    <dt>Major roads</dt><dd>{formatShare(o.majorShare)}</dd>
                    <dt>Junctions</dt><dd>{o.junctions}</dd>
                    <dt title="Share of the route inside the loaded area with a clear line to at least one mapped rooftop within 300 m">Overlooked by roofs</dt>
                    <dd>{ov ? <>{formatShare(ov.overlooked)} · {ov.rooftops} roof{ov.rooftops === 1 ? '' : 's'}{ov.unknown > 0.005 && <span className="muted"> · {formatShare(ov.unknown)} unknown</span>}{ov.outside > 0.005 && <span className="muted"> · {formatShare(ov.outside)} outside the area</span>}</> : <span className="muted">{pl.geoLoaded ? 'checking…' : 'load the site area (step 3)'}</span>}</dd>
                    <dt title="Share of the route seen from your observation points (needs a current coverage run)">Watched by your points</dt>
                    <dd>{c ? <>{formatShare(c.covered)}{c.outside > 0.005 && <span className="muted"> · {formatShare(c.outside)} outside the area</span>}</> : <span className="muted">needs a current coverage run</span>}</dd>
                  </dl>
                  {o.steps.length > 0 && (
                    <details className="route-steps">
                      <summary>Directions ({o.steps.length - 1} step{o.steps.length === 2 ? '' : 's'})</summary>
                      <ol>
                        {o.steps.map((s, k) => (
                          <li key={k}>
                            <button className="link-btn" onClick={() => p.focusPoint(s.lat, s.lon)} title="Show this point on the map">
                              <span className="step-turn" aria-hidden="true">{STEP_GLYPH[s.maneuver]}</span> {s.text}
                            </button>
                            {s.distanceM > 0 && <span className="muted"> · {formatMeters(s.distanceM)}</span>}
                          </li>
                        ))}
                      </ol>
                      <p className="muted">Directions follow the mapped road lines. Turn restrictions, one-way access for walkers and lane rules are not modelled; check signs on the ground.</p>
                    </details>
                  )}
                  <div className="btn-row">
                    <button className="btn small-btn" aria-pressed={flying === i} onClick={() => fly(i)}>{flying === i ? 'Stop flight' : 'Fly along'}</button>
                    <button className="btn small-btn" onClick={() => void pl.adoptRoute(i, 'primary-route')}>Use as primary</button>
                    <button className="btn small-btn" onClick={() => void pl.adoptRoute(i, 'alternate-route')}>Use as alternative</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {(r.options[0].startGapM > 25 || r.options[0].endGapM > 25) && <p className="small muted">The routes start {formatMeters(r.options[0].startGapM)} from the start point and end {formatMeters(r.options[0].endGapM)} from the destination, where they meet the connected mapped network; those stretches are not included.</p>}
          {!pl.geoLoaded && <p className="small muted">“Overlooked” needs the site area: load it in step 3 Rooftops. Only the part of a route inside that area is checked.</p>}
          <p className="muted small">
            These are measures from mapped data to compare options, not a safety rating. Times use fixed speeds per road type ({r.mode === 'walk' ? 'walking 4.8 km/h' : 'driving 15–100 km/h by road class'}) with no traffic, signals or turns. Turn restrictions, access rules, closures and live conditions are not available; roads that cross without a mapped junction (bridges, tunnels) are not joined. Road network: OpenStreetMap via OpenFreeMap map tiles (generalised); ends must be within {MAX_ROUTE_SPAN_M / 1000} km.
          </p>
        </>
      )}
    </>
  );
}

function RoutesStep(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  const [radius, setRadius] = useState(2000);
  // Items that come near the site (any segment within reach, or an area containing it), plus every item already
  // assigned in this plan wherever it is now.
  const reach = Math.max(5000, plan.analysis.radiusM * 3);
  const assigned = new Set(plan.roles.map((r) => r.annotationId));
  const near = p.annotations.filter((a) => assigned.has(a.id) || itemNearSite(plan.site, a, reach));
  const roleOf = new Map(plan.roles.map((r) => [r.annotationId, r]));
  const routes = plan.roles.filter((r) => (r.role === 'primary-route' || r.role === 'alternate-route') && (near.some((a) => a.id === r.annotationId) || (!!r.snapshot && pl.roleChanges.missing.includes(r.annotationId))));
  const fac = plan.facilities;
  return (
    <>
      <RoutePlanner {...p} />
      <div className="diag-sub">Draw with the map tools</div>
      <div className="btn-row">
        <button className="btn small-btn" onClick={() => p.setTool('draw-line')}>Route</button>
        <button className="btn small-btn" onClick={() => p.setTool('draw-area')}>Perimeter / zone</button>
        <button className="btn small-btn" onClick={() => p.setTool('draw-pin')}>Exit / marker</button>
      </div>
      <p className="muted small">Click to add points; double-click to finish. Edit names and colours in Map tools. Then give each item a role below.</p>

      <div className="diag-sub">Items near the site ({near.length})</div>
      {!near.length && <p className="small muted">Nothing drawn near this site yet.</p>}
      <ul className="plan-list small">
        {near.map((a) => {
          const r = roleOf.get(a.id);
          const roles = PLAN_ROLES.filter((x) => ROLE_KINDS[x].includes(a.kind));
          return (
            <li key={a.id}>
              <span className="anno-name" style={{ color: a.color }}>■ {a.name}</span>
              <select aria-label={`Role of ${a.name}`} value={r?.role ?? ''} onChange={(e) => pl.setRole(a.id, (e.target.value || null) as PlanRole | null)}>
                <option value="">No role</option>
                {roles.map((x) => <option key={x} value={x}>{ROLE_LABEL[x]}</option>)}
              </select>
              {r && (r.role === 'primary-route' || r.role === 'alternate-route') && (
                <select aria-label="Travel mode" value={r.mode ?? ''} onChange={(e) => pl.setRole(a.id, r.role, { mode: (e.target.value || null) as 'walk' | 'drive' | null })}>
                  <option value="walk">Walking</option>
                  <option value="drive">Driving</option>
                  <option value="">No estimate</option>
                </select>
              )}
              {r && <input className="anno-name" placeholder="Note" value={r.note} maxLength={500} onChange={(e) => pl.setRole(a.id, r.role, { note: e.target.value })} />}
              {r && pl.roleChanges.changed.includes(a.id) && <span className="err-text"> changed since the plan was saved</span>}
            </li>
          );
        })}
      </ul>

      {pl.roleChanges.missing.length > 0 && (
        <div className="note small">
          <strong>Deleted from the map but kept in this plan</strong> (its saved copy is used in the briefing):
          <ul className="plan-list">
            {plan.roles.filter((r) => pl.roleChanges.missing.includes(r.annotationId)).map((r) => (
              <li key={r.annotationId}>{r.snapshot?.name ?? 'Unnamed item'} · {ROLE_LABEL[r.role]}{!r.snapshot && <span className="err-text"> · no saved copy</span>} <button className="link-btn small" onClick={() => pl.setRole(r.annotationId, null)}>Remove from plan</button></li>
            ))}
          </ul>
        </div>
      )}
      {routes.length > 0 && (
        <>
          <div className="diag-sub">Route comparison</div>
          <table className="plan-table small">
            <thead><tr><th>Route</th><th>Length</th><th>Est. time</th><th>Covered</th><th>Gaps</th><th>Unknown</th><th>Outside</th></tr></thead>
            <tbody>
              {routes.map((r) => {
                const a = p.annotations.find((x) => x.id === r.annotationId) ?? { name: `${r.snapshot!.name} (saved copy)`, points: r.snapshot!.points };
                const m = routeMetrics(a.points, r.mode);
                const c = pl.routeCoverage(r.annotationId);
                return (
                  <tr key={r.annotationId}>
                    <td>{a.name}{r.role === 'primary-route' ? ' (primary)' : ''}</td>
                    <td>{formatMeters(m.lengthM)}</td>
                    <td>{m.minutes === null ? '—' : `${Math.round(m.minutes)} min`}</td>
                    <td>{formatShare(c?.covered)}</td>
                    <td>{formatShare(c?.gap)}</td>
                    <td>{formatShare(c?.unknown)}</td>
                    <td>{formatShare(c?.outside)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Times assume walking 4.8 km/h or driving 30 km/h with no traffic. Road restrictions and closures: not available. Coverage columns need a current coverage run and show the share of each route seen from your observation points — a planning estimate, not a real-time measure of exposure.</p>
        </>
      )}

      <div className="diag-sub">Nearby emergency facilities</div>
      <div className="btn-row small">
        <select aria-label="Search radius" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
          {[1000, 2000, 5000].map((r) => <option key={r} value={r}>{formatMeters(r)}</option>)}
        </select>
        <button className="btn small-btn" disabled={pl.lookup.facilitiesBusy} onClick={() => void pl.loadFacilities(radius)}>{pl.lookup.facilitiesBusy ? 'Looking up…' : 'Look up in OpenStreetMap'}</button>
      </div>
      {pl.lookup.facilities && <p className="small err-text">{pl.lookup.facilities}</p>}
      {fac && (
        <div className="small">
          {fac.items.length ? (
            <ul className="plan-list">
              {[...fac.items].map((f) => ({ f, d: distM(plan.site, f) })).sort((x, y) => x.d - y.d).map(({ f, d }) => (
                <li key={`${f.osmType}${f.osmId}`}>
                  {f.name ?? 'Unnamed'} · {FACILITY_LABEL[f.kind]}{f.emergency ? ' · emergency department (mapped)' : ''} · {formatMeters(d)}{' '}
                  <button className="link-btn small" onClick={() => p.flyAbove(f.lat, f.lon, 800, plan.id)}>Go</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None mapped within {formatMeters(fac.radiusM)}. That is a gap in OpenStreetMap, not proof that none exist.</p>
          )}
          <p className="muted">{SOURCES.facilities} Fetched {fmtTime(fac.fetchedAt)}{fac.truncated ? '; list truncated' : ''}.</p>
        </div>
      )}
      <p className="muted small">Event layouts and evacuation use the exits, assembly points and routes you mark. Crowd or evacuation simulation is not provided.</p>
    </>
  );
}

// ------------------------------------------------------------------ 5 Save and brief

function BriefStep(p: PlanningPanelProps) {
  const pl = p.planning;
  const plan = pl.plan!;
  return (
    <>
      <div className="diag-sub">Plan</div>
      <label className="field small"><span>Plan name</span><input value={plan.name} maxLength={120} onChange={(e) => pl.update((x) => ({ ...x, name: e.target.value || 'Plan' }))} /></label>
      <label className="field small"><span>Notes</span><textarea rows={5} maxLength={10_000} value={plan.notes} onChange={(e) => pl.update((x) => ({ ...x, notes: e.target.value }))} /></label>
      <details className="layer-info small" open={!plan.limitationsAcknowledged}>
        <summary>Limitations of this plan</summary>
        <ul>{LIMITATIONS.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
      <label className="field inline small"><input type="checkbox" checked={plan.limitationsAcknowledged} onChange={(e) => pl.update((x) => ({ ...x, limitationsAcknowledged: e.target.checked }))} /> I understand these limitations</label>
      <div className="btn-row">
        <button className="btn small-btn primary" onClick={() => void pl.save()}>{pl.dirty ? 'Save plan' : 'Saved'}</button>
        <button className="btn small-btn" onClick={() => void pl.exportBriefing('html', p.coverageImage())}>Export briefing (HTML)</button>
        <button className="btn small-btn" onClick={() => void pl.exportBriefing('pdf', p.coverageImage())}>Export PDF</button>
      </div>
      <p className="muted small">
        Saved on this computer only; the briefing includes the site, observation points, the last coverage run, routes, zones, inspected buildings, facilities, floor plans, notes, data sources and limitations.
        A saved plan reopens with its last-run figures; the coverage grid is recomputed with current data when you run it again.
      </p>
      <p className="muted small">Not configured: shared plans, live device locations and external integrations. Nothing in a plan is sent anywhere unless you export it.</p>
      {pl.plans.length > 0 && (
        <>
          <div className="diag-sub">Saved plans</div>
          <SavedPlans {...p} />
        </>
      )}
    </>
  );
}
