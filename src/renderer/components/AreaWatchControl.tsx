import { useEffect, useId, useRef, useState } from 'react';
import {
  AREA_WATCH_DEFAULT_MIN_MAGNITUDE, AREA_WATCH_MAX_MAGNITUDE, AREA_WATCH_MIN_MAGNITUDE,
  MAX_AREA_WATCH_RULES, areaWatchRuleInputSchema,
  type AreaWatchRule, type AreaWatchRuleInput, type AreaWatchState,
} from '../../shared/areaWatch';
import type { FeedStatus, Freshness, Settings } from '../../shared/types';
import { usgsMagnitudeFloor } from '../../shared/usgsFeed';
import { errorText, type Annotation } from '../lib/api';
import { utcTime } from '../lib/format';
import './areaWatchControl.css';

/** App owns the snapshot and persistence; this editor never creates another alert channel. */
export interface AreaWatchControls {
  state: AreaWatchState;
  usgsStatus: FeedStatus;
  freshness: Freshness;
  onSave(rule: AreaWatchRuleInput): Promise<void>;
  onRemove(areaId: string): Promise<void>;
}

export function AreaWatchStatus({ controls, quakeWindow, quakeMinMagnitude }: {
  controls: AreaWatchControls; quakeWindow: Settings['quakeWindow']; quakeMinMagnitude: number;
}) {
  const { state, usgsStatus: source, freshness } = controls;
  const floor = usgsMagnitudeFloor(quakeMinMagnitude);
  const sourceState = freshness === 'unavailable' ? 'unavailable' : freshness === 'stale' ? 'stale' : 'fresh';
  return <div className="area-watch-context">
    <p>Local USGS epicenter matches appear in the bell while Sky_View runs. These are not official warnings or estimates of shaking or damage.</p>
    <p>New qualifying earthquakes after activation only; no backfill. Enabling a watch or changing its threshold or area starts a new watch period. Hiding an area outline does not pause its watch.</p>
    <p>Boundary points count. Watch edges are straight in unwrapped longitude/latitude; globe outlines follow geodesic arcs, so widely spaced vertices can differ.</p>
    <p className="small muted">USGS source: past {quakeWindow} · {floor === null ? 'all reported magnitudes' : `M ${floor} and above`} · {sourceState}{source.fromCache ? ' · cached' : ''}.
      {source.lastSuccessAt && <> Last retrieved {utcTime(source.lastSuccessAt)}.</>}
      {source.state === 'loading' && <> Refreshing…</>}
      {source.state === 'error' && <> Refresh failed; matches may be delayed.</>}
      {source.fromCache && <> Cached data does not create new notifications.</>}
    </p>
    {source.error && <p className="error-line small">USGS: {source.error}</p>}
    <p className="small muted">{state.lastEvaluatedAt ? `Last local check: ${utcTime(state.lastEvaluatedAt)}.` : 'Waiting for the first successful local watch check.'}</p>
    {state.error && <p className="error-line small" role="alert">Local watch check failed: {state.error}. Check the next successful USGS refresh.</p>}
  </div>;
}

export function AreaWatchControl({ area, controls, rule, matchCount, quakeMinMagnitude }: {
  area: Annotation; controls: AreaWatchControls; rule?: AreaWatchRule; matchCount: number; quakeMinMagnitude: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [minimum, setMinimum] = useState(String(rule?.minMagnitude ?? AREA_WATCH_DEFAULT_MIN_MAGNITUDE));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [operation, setOperation] = useState<'save' | 'remove' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const editorId = useId();
  useEffect(() => {
    setMinimum(String(rule?.minMagnitude ?? AREA_WATCH_DEFAULT_MIN_MAGNITUDE));
    setEnabled(rule?.enabled ?? true);
  }, [area.id, rule?.minMagnitude, rule?.enabled, rule?.updatedAt]);
  const atLimit = !rule && controls.state.rules.length >= MAX_AREA_WATCH_RULES;
  const floor = usgsMagnitudeFloor(quakeMinMagnitude);
  const numericMinimum = minimum.trim() === '' ? NaN : Number(minimum);
  const belowSource = floor !== null && Number.isFinite(numericMinimum) && numericMinimum < floor;
  const savedBelowSource = rule && floor !== null && rule.minMagnitude < floor;

  async function save() {
    if (working.current) return;
    setError(null); setStatus(null);
    const parsed = areaWatchRuleInputSchema.safeParse({ areaId: area.id, minMagnitude: numericMinimum, enabled });
    if (!parsed.success) {
      setError(`Enter a minimum magnitude from ${AREA_WATCH_MIN_MAGNITUDE} to ${AREA_WATCH_MAX_MAGNITUDE}.`);
      return;
    }
    working.current = true; setOperation('save');
    try {
      await controls.onSave(parsed.data);
      setStatus(enabled ? 'Watch saved. New qualifying epicenters will appear in the bell.' : 'Watch saved paused. Enable it to watch new epicenters.');
    } catch (e) {
      setError(`Watch could not be saved: ${errorText(e)}. Try again.`);
    } finally {
      working.current = false; setOperation(null);
    }
  }

  async function remove() {
    if (working.current || !rule) return;
    working.current = true; setOperation('remove'); setError(null); setStatus(null);
    try {
      await controls.onRemove(area.id);
      setExpanded(false);
      setStatus('Watch and its saved notifications removed. The area annotation remains saved.');
    } catch (e) {
      setError(`Watch could not be removed: ${errorText(e)}. Try again.`);
    } finally {
      working.current = false; setOperation(null);
    }
  }

  return <div className="area-watch-control">
    <div className="area-watch-heading">
      <button type="button" className="link-btn small" disabled={operation !== null} aria-expanded={expanded} aria-controls={editorId}
        aria-label={`USGS epicenter watch for ${area.name}`} onClick={() => setExpanded(!expanded)}>
        {rule ? `USGS epicenter watch · ${rule.enabled ? 'Enabled' : 'Paused'} · M ≥ ${rule.minMagnitude}` : 'Watch USGS epicenters…'}
      </button>
      {rule && <span className="small muted">{matchCount} saved {matchCount === 1 ? 'match' : 'matches'}</span>}
      {savedBelowSource && <span className="small muted">Source limited to M {floor} and above</span>}
    </div>
    {expanded && <div id={editorId}>
      {rule && <p className="small muted">{rule.enabled ? 'Watching events occurring since' : 'Paused; last armed'} {utcTime(rule.armedAt)}.</p>}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <fieldset disabled={operation !== null}>
          <label className="area-watch-threshold"><span>Minimum magnitude</span>
            <input type="number" step="any" min={AREA_WATCH_MIN_MAGNITUDE} max={AREA_WATCH_MAX_MAGNITUDE} required value={minimum}
              aria-label={`Minimum earthquake magnitude for ${area.name}`} onChange={(e) => setMinimum(e.target.value)} />
          </label>
          <label className="area-watch-enabled"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
          <div className="btn-row">
            <button type="submit" className="btn small-btn" disabled={atLimit}>{operation === 'save' ? 'Saving…' : rule ? 'Save watch' : 'Add watch'}</button>
            {rule && <button type="button" className="link-btn small" onClick={() => void remove()}>{operation === 'remove' ? 'Removing…' : 'Remove watch'}</button>}
          </div>
        </fieldset>
      </form>
      {belowSource && <p className="note small">The current USGS feed starts at M {floor}. To include smaller events, lower <strong>Min magnitude</strong> in Layers → Live data → Alerts &amp; earthquakes.</p>}
      {atLimit && <p className="note small">The limit is {MAX_AREA_WATCH_RULES} area watches. Remove an existing watch before adding another.</p>}
      {rule && <p className="small muted">Removing this watch or deleting the area removes its saved notifications. USGS recorded history is separate.</p>}
    </div>}
    {status && <p className="small" role="status">{status}</p>}
    {error && <p className="error-line small" role="alert">{error}</p>}
  </div>;
}
