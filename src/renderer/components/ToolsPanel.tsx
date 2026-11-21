import { useMemo, useState } from 'react';
import { pathLengthKm, polygonAreaKm2 } from '../../shared/geo';
import type { Settings } from '../../shared/types';
import type { Annotation, SavedView } from '../lib/api';
import { VISUAL_MODE_LABEL, type VisualMode } from '../map/visualModes';
import type { ToolMode } from './Globe';
import { GeoJsonTools } from './GeoJsonTools';
import { StreetViewAction } from './StreetViewAction';
import { EventFields } from './EventFields';
import { AreaWatchControl, AreaWatchStatus, type AreaWatchControls } from './AreaWatchControl';

interface Props {
  mode?: 'tools' | 'scenes';
  quickViews?: React.ReactNode;
  tool: ToolMode;
  draft: [number, number][];
  onTool(t: ToolMode): void;
  onUndo(): void;
  onFinish(): void;
  onClear(): void;
  annotations: Annotation[];
  onAnnotationChange(a: Annotation): void;
  onAnnotationDelete(id: string): void;
  onAnnotationsImported?(annotations: Annotation[]): void;
  areaWatch?: AreaWatchControls;
  getStreetViewCenter?(): { lat: number; lon: number } | null;
  onFlyTo(lon: number, lat: number): void;
  views: SavedView[];
  sceneBusy?: boolean;
  onSaveView(name: string): Promise<boolean> | void;
  onRestoreView(v: SavedView): void;
  onDeleteView(id: string): void;
  onExportScene(): void;
  onImportScene(): void;
  settings: Settings;
  onPatch(p: Partial<Settings>): void;
  onClose(): void;
  onPlayback(): void;
  playbackActive: boolean;
  /** Director mode: colour for the next drawing. */
  drawColor?: string;
  onDrawColor?(c: string): void;
  /** Annotation whose note editor opens (a note pin just dropped). */
  focusNoteId?: string | null;
  /** Opens Recent imagery (Sentinel-2 for a drawn box). */
  onRecentImagery?(): void;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km (${(km * 0.621371).toFixed(km < 10 ? 2 : 1)} mi)`;
}

export function measurementText(tool: ToolMode, pts: [number, number][]): string | null {
  if (pts.length < 2) return null;
  if (tool === 'measure-area' || tool === 'draw-area' || tool === 'sketch-area') {
    if (pts.length < 3) return `Perimeter so far: ${fmtKm(pathLengthKm(pts))}`;
    const { areaKm2, perimeterKm } = polygonAreaKm2(pts);
    return `Area: ${areaKm2 < 1 ? `${Math.round(areaKm2 * 1e6).toLocaleString()} m²` : `${areaKm2.toFixed(2)} km² (${(areaKm2 * 0.386102).toFixed(2)} mi²)`} · perimeter ${fmtKm(perimeterKm)}`;
  }
  return `Geodesic distance: ${fmtKm(pathLengthKm(pts))}`;
}

const COLORS = ['#ffd166', '#5fd0e6', '#ef476f', '#06d6a0', '#b07be8', '#ffffff'];
const COLOR_NAMES: Record<string, string> = { '#ffd166': 'Yellow', '#5fd0e6': 'Cyan', '#ef476f': 'Red', '#06d6a0': 'Green', '#b07be8': 'Violet', '#ffffff': 'White' };
const HINT: Partial<Record<ToolMode, string>> = {
  'draw-pin': 'Click the globe to drop a pin. Esc cancels.',
  'draw-note': 'Click the globe to drop a note, then write it in the list below. Esc cancels.',
  'sketch-line': 'Press and drag on the globe to sketch a path; release to save. The map holds still while you draw.',
  'sketch-area': 'Press and drag around an area to sketch its outline; release to save.',
};

export function ToolsPanel(p: Props) {
  const [viewName, setViewName] = useState('');
  const annotationRows = useMemo(() => {
    if (p.mode === 'scenes') return [];
    return p.annotations.map((a) => {
      const info = a.kind === 'line' ? fmtKm(pathLengthKm(a.points)) : a.kind === 'area' ? measurementText('measure-area', a.points)?.replace('Area: ', '') : `${a.points[0][1].toFixed(4)}, ${a.points[0][0].toFixed(4)}`;
      return { a, info };
    });
  }, [p.annotations, p.mode]);
  const watchRules = useMemo(() => new Map(p.areaWatch?.state.rules.map((rule) => [rule.areaId, rule])), [p.areaWatch?.state.rules]);
  const matchCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of p.areaWatch?.state.events ?? []) counts.set(event.areaId, (counts.get(event.areaId) ?? 0) + 1);
    return counts;
  }, [p.areaWatch?.state.events]);
  const m = measurementText(p.tool, p.draft);
  const drawing = p.tool.startsWith('draw') || p.tool.startsWith('sketch');
  const freehand = p.tool.startsWith('sketch');
  const toolBtn = (t: ToolMode, label: string) => (
    <button className={`btn small-btn ${p.tool === t ? 'primary' : ''}`} onClick={() => p.onTool(p.tool === t ? 'none' : t)} aria-pressed={p.tool === t}>
      {label}
    </button>
  );
  return (
    <div className={'tools ' + (p.mode === 'scenes' ? 'scenes-panel' : '')} role="region" aria-label={p.mode === 'scenes' ? 'Scenes' : 'Map tools'}>
      <div className="diag-head">
        <strong>{p.mode === 'scenes' ? 'Scenes' : 'Map tools'}</strong>
        <button className="icon-btn" onClick={p.onClose} aria-label={p.mode === 'scenes' ? 'Close Scenes' : 'Close Map tools'}>
          ✕
        </button>
      </div>
      {p.mode !== 'scenes' && <>
      <div className="diag-sub">Measure (geodesic, WGS84)</div>
      <div className="btn-row">
        {toolBtn('measure-line', 'Distance')}
        {toolBtn('measure-area', 'Area')}
      </div>
      <div className="diag-sub">Director mode</div>
      <div className="btn-row">
        {toolBtn('draw-pin', 'Pin')}
        {toolBtn('draw-note', 'Note')}
        {toolBtn('draw-line', 'Line / route')}
        {toolBtn('draw-area', 'Outline')}
      </div>
      <div className="btn-row">
        {toolBtn('sketch-line', 'Sketch path')}
        {toolBtn('sketch-area', 'Sketch outline')}
        {p.onRecentImagery && <button className="btn small-btn" onClick={p.onRecentImagery}>Recent satellite image…</button>}
      </div>
      {p.onDrawColor && (
        <div className="director-colors" role="radiogroup" aria-label="Colour for new drawings">
          {COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={p.drawColor === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} className="director-swatch" style={{ background: c }} onClick={() => p.onDrawColor?.(c)} />
          ))}
        </div>
      )}
      {p.tool !== 'none' && p.tool !== 'draw-box' && (
        <div className="note small">
          {HINT[p.tool] ?? 'Click the globe to add points; double-click or press Finish to complete. Esc cancels.'}
          {m && <div className="measure">{m}</div>}
          {!freehand && <div className="btn-row">
            <button className="btn small-btn" onClick={p.onUndo} disabled={p.draft.length === 0}>
              Undo point
            </button>
            {(drawing || p.tool.startsWith('measure')) && p.tool !== 'draw-pin' && p.tool !== 'draw-note' && (
              <button className="btn small-btn primary" onClick={p.onFinish} disabled={p.draft.length < 2}>
                {drawing ? 'Finish & save' : 'Finish'}
              </button>
            )}
            <button className="btn small-btn" onClick={p.onClear}>
              Clear
            </button>
          </div>}
        </div>
      )}
      {p.annotations.length > 0 && (
        <ul className="anno-list">
          {annotationRows.map(({ a, info }) => {
            return (
              <li key={a.id}>
                <input type="checkbox" checked={a.visible} onChange={(e) => p.onAnnotationChange({ ...a, visible: e.target.checked })} aria-label={`Show ${a.name}`} />
                <select value={a.color} onChange={(e) => p.onAnnotationChange({ ...a, color: e.target.value })} aria-label="Color" className="color-select" style={{ color: a.color }}>
                  {!COLORS.includes(a.color) && <option value={a.color} style={{ color: a.color }}>■ {a.color}</option>}
                  {COLORS.map((c) => (
                    <option key={c} value={c} style={{ color: c }}>
                      ■
                    </option>
                  ))}
                </select>
                <input className="anno-name" value={a.name} maxLength={120} onChange={(e) => p.onAnnotationChange({ ...a, name: e.target.value || 'Untitled' })} aria-label="Annotation name" />
                <span className="muted small">{info}</span>
                {a.source && a.source !== 'user' && <span className="tag small" title={a.source === 'agent' ? 'Added by an AI agent through the agent bridge' : 'Saved from an Ask the planet answer'}>{a.source === 'agent' ? `Agent: ${a.author ?? 'AI'}` : 'Ask'}</span>}
                <button className="link-btn small" onClick={() => p.onFlyTo(a.points[0][0], a.points[0][1])}>
                  Go
                </button>
                <button className="link-btn small" onClick={() => p.onAnnotationDelete(a.id)}>
                  Delete
                </button>
                <details className="anno-note" open={p.focusNoteId === a.id || undefined}>
                  <summary className="small">{a.note ? 'Note' : 'Add note'}</summary>
                  <textarea maxLength={1000} rows={3} value={a.note ?? ''} autoFocus={p.focusNoteId === a.id} aria-label={`Note for ${a.name}`}
                    onChange={(e) => p.onAnnotationChange({ ...a, note: e.target.value || undefined })} />
                </details>
                {(!a.source || a.source === 'user') && <EventFields a={a} onChange={p.onAnnotationChange} />}
                {a.kind === 'area' && p.areaWatch && <AreaWatchControl area={a} controls={p.areaWatch} rule={watchRules.get(a.id)} matchCount={matchCounts.get(a.id) ?? 0} quakeMinMagnitude={p.settings.quakeMinMagnitude} />}
              </li>
            );
          })}
        </ul>
      )}
      {p.areaWatch && p.annotations.some((a) => a.kind === 'area') && <AreaWatchStatus controls={p.areaWatch} quakeWindow={p.settings.quakeWindow} quakeMinMagnitude={p.settings.quakeMinMagnitude} />}
      <GeoJsonTools count={p.annotations.length} onImported={p.onAnnotationsImported} />
      {p.getStreetViewCenter && <StreetViewAction getCenter={p.getStreetViewCenter} />}
      </>}
      {p.mode === 'scenes' && <>
      {p.quickViews}
      <div className="diag-sub">Saved views</div>
      <div className="btn-row">
        <input className="view-name" aria-label="Name this view" placeholder="Name this view" value={viewName} maxLength={120} onChange={(e) => setViewName(e.target.value)} />
        <button
          className="btn small-btn"
          disabled={p.sceneBusy}
          onClick={async () => {
            const saved = await p.onSaveView(viewName.trim() || `View ${p.views.length + 1}`);
            if (saved !== false) setViewName('');
          }}
        >
          Save view
        </button>
      </div>
      {p.views.length > 0 && (
        <ul className="anno-list">
          {p.views.map((v) => (
            <li key={v.id}>
              <button className="link-btn" disabled={p.sceneBusy} onClick={() => p.onRestoreView(v)}>
                {v.name}
              </button>
              <span className="muted small">{v.investigation?.clock.mode === 'recorded'
                ? <time dateTime={v.investigation.clock.t} title={v.investigation.clock.t}>Replay · {new Date(v.investigation.clock.t).toLocaleString()}</time>
                : v.investigation ? 'Live view' : 'Map view'} · {v.layersEnabled.length} layers</span>
              <button className="link-btn small" disabled={p.sceneBusy} onClick={() => p.onDeleteView(v.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="diag-sub">Share</div>
      <div className="btn-row">
        <button className="btn small-btn" disabled={p.sceneBusy} onClick={p.onExportScene}>
          Export scene file…
        </button>
        <button className="btn small-btn" disabled={p.sceneBusy} onClick={p.onImportScene}>
          Import scene file…
        </button>
      </div>
      <p className="muted small">Saved views remember the map, alert and earthquake filters, selected alert or earthquake, Data panel and replay time. Scene files also share your drawings and named views. A recipient needs their own local recordings to replay that time.</p>
      </>}
      {p.mode !== 'scenes' && <>
      <div className="diag-sub">Display style (visual effect only)</div>
      <select value={p.settings.visualMode} onChange={(e) => p.onPatch({ visualMode: e.target.value as VisualMode })} aria-label="Display style">
        {(Object.keys(VISUAL_MODE_LABEL) as VisualMode[]).map((k) => (
          <option key={k} value={k}>
            {VISUAL_MODE_LABEL[k]}
          </option>
        ))}
      </select>
      <p className="muted small">These styles recolor the rendered image. “Thermal-style” maps screen brightness to colors. It is not infrared or temperature data.</p>
      <div className="diag-sub">Playback</div>
      <button className={`btn small-btn ${p.playbackActive ? 'primary' : ''}`} onClick={p.onPlayback}>
        {p.playbackActive ? 'Exit playback' : 'Replay recorded data…'}
      </button>
      <p className="muted small">Movement fixes are retained for {p.settings.trackRetentionHours} h. Recorded alerts and earthquakes use your event-history retention settings.</p>
      </>}
    </div>
  );
}
