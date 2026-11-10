import { useState } from 'react';
import { pathLengthKm, polygonAreaKm2 } from '../../shared/geo';
import type { Settings } from '../../shared/types';
import type { Annotation, SavedView } from '../lib/api';
import { VISUAL_MODE_LABEL, type VisualMode } from '../map/visualModes';
import type { ToolMode } from './Globe';

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
  onFlyTo(lon: number, lat: number): void;
  views: SavedView[];
  onSaveView(name: string): void;
  onRestoreView(v: SavedView): void;
  onDeleteView(id: string): void;
  onExportScene(): void;
  onImportScene(): void;
  settings: Settings;
  onPatch(p: Partial<Settings>): void;
  onClose(): void;
  onPlayback(): void;
  playbackActive: boolean;
}

function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km (${(km * 0.621371).toFixed(km < 10 ? 2 : 1)} mi)`;
}

export function measurementText(tool: ToolMode, pts: [number, number][]): string | null {
  if (pts.length < 2) return null;
  if (tool === 'measure-area' || tool === 'draw-area') {
    if (pts.length < 3) return `Perimeter so far: ${fmtKm(pathLengthKm(pts))}`;
    const { areaKm2, perimeterKm } = polygonAreaKm2(pts);
    return `Area: ${areaKm2 < 1 ? `${Math.round(areaKm2 * 1e6).toLocaleString()} m²` : `${areaKm2.toFixed(2)} km² (${(areaKm2 * 0.386102).toFixed(2)} mi²)`} · perimeter ${fmtKm(perimeterKm)}`;
  }
  return `Geodesic distance: ${fmtKm(pathLengthKm(pts))}`;
}

const COLORS = ['#ffd166', '#5fd0e6', '#ef476f', '#06d6a0', '#b07be8', '#ffffff'];

export function ToolsPanel(p: Props) {
  const [viewName, setViewName] = useState('');
  const m = measurementText(p.tool, p.draft);
  const drawing = p.tool.startsWith('draw');
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
      <div className="diag-sub">Draw annotations</div>
      <div className="btn-row">
        {toolBtn('draw-pin', 'Pin')}
        {toolBtn('draw-line', 'Line / route')}
        {toolBtn('draw-area', 'Area')}
      </div>
      {p.tool !== 'none' && (
        <div className="note small">
          Click the globe to add points{p.tool === 'draw-pin' ? '' : '; double-click or press Finish to complete'}. Esc cancels.
          {m && <div className="measure">{m}</div>}
          <div className="btn-row">
            <button className="btn small-btn" onClick={p.onUndo} disabled={p.draft.length === 0}>
              Undo point
            </button>
            {(drawing || p.tool.startsWith('measure')) && p.tool !== 'draw-pin' && (
              <button className="btn small-btn primary" onClick={p.onFinish} disabled={p.draft.length < 2}>
                {drawing ? 'Finish & save' : 'Finish'}
              </button>
            )}
            <button className="btn small-btn" onClick={p.onClear}>
              Clear
            </button>
          </div>
        </div>
      )}
      {p.annotations.length > 0 && (
        <ul className="anno-list">
          {p.annotations.map((a) => {
            const info = a.kind === 'line' ? fmtKm(pathLengthKm(a.points)) : a.kind === 'area' ? measurementText('measure-area', a.points)?.replace('Area: ', '') : `${a.points[0][1].toFixed(4)}, ${a.points[0][0].toFixed(4)}`;
            return (
              <li key={a.id}>
                <input type="checkbox" checked={a.visible} onChange={(e) => p.onAnnotationChange({ ...a, visible: e.target.checked })} aria-label={`Show ${a.name}`} />
                <select value={a.color} onChange={(e) => p.onAnnotationChange({ ...a, color: e.target.value })} aria-label="Color" className="color-select" style={{ color: a.color }}>
                  {COLORS.map((c) => (
                    <option key={c} value={c} style={{ color: c }}>
                      ■
                    </option>
                  ))}
                </select>
                <input className="anno-name" value={a.name} maxLength={120} onChange={(e) => p.onAnnotationChange({ ...a, name: e.target.value || 'Untitled' })} aria-label="Annotation name" />
                <span className="muted small">{info}</span>
                <button className="link-btn small" onClick={() => p.onFlyTo(a.points[0][0], a.points[0][1])}>
                  Go
                </button>
                <button className="link-btn small" onClick={() => p.onAnnotationDelete(a.id)}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </>}
      {p.mode === 'scenes' && <>
      {p.quickViews}
      <div className="diag-sub">Saved views</div>
      <div className="btn-row">
        <input className="view-name" placeholder="Name this view" value={viewName} maxLength={120} onChange={(e) => setViewName(e.target.value)} />
        <button
          className="btn small-btn"
          onClick={() => {
            p.onSaveView(viewName.trim() || `View ${p.views.length + 1}`);
            setViewName('');
          }}
        >
          Save view
        </button>
      </div>
      {p.views.length > 0 && (
        <ul className="anno-list">
          {p.views.map((v) => (
            <li key={v.id}>
              <button className="link-btn" onClick={() => p.onRestoreView(v)}>
                {v.name}
              </button>
              <span className="muted small">{v.layersEnabled.length} layers</span>
              <button className="link-btn small" onClick={() => p.onDeleteView(v.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="diag-sub">Share</div>
      <div className="btn-row">
        <button className="btn small-btn" onClick={p.onExportScene}>
          Export scene file…
        </button>
        <button className="btn small-btn" onClick={p.onImportScene}>
          Import scene file…
        </button>
      </div>
      <p className="muted small">Scene files hold the camera, map style, layer switches, annotations and saved views. They never include API keys, saved locations or notes.</p>
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
        {p.playbackActive ? 'Exit playback' : 'Replay recorded movement…'}
      </button>
      <p className="muted small">Replays aircraft, vessel and transit positions this app recorded while running (last {p.settings.trackRetentionHours} h). Nothing was recorded while the app was closed.</p>
      </>}
    </div>
  );
}
