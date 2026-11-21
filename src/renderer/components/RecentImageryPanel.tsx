// Recent imagery: draw a box (for example around a fire), list the Sentinel-2 passes over it from the last weeks,
// and drape the chosen one on the 3D terrain. Keyless (Earth Search STAC and the AWS Open Data copy of Sentinel-2).
import { useEffect, useRef, useState } from 'react';
import { Cloud, Crosshair, Satellite, SquareDashed, X } from 'lucide-react';
import { boxProblem, boxSpanKm, SENTINEL_SEARCH_DAYS } from '../../shared/sentinel';
import { api, errorText, type SentinelSceneSummary } from '../lib/api';
import { decodeSentinelPng, type SentinelOverlay } from '../map/sentinelOverlay';
import { Time } from './common';

type Box = [number, number, number, number];

interface Props {
  box: Box | null;
  drawing: boolean;
  onDraw(): void;
  /** Box of about 10 km around the selected record, when one is selected. */
  aroundSelection: (() => Box | null) | null;
  onBox(box: Box): void;
  overlay: SentinelOverlay | null;
  onOverlay(o: SentinelOverlay | null): void;
  onClose(): void;
}

export function RecentImageryPanel(p: Props) {
  const [maxCloud, setMaxCloud] = useState(40);
  const [scenes, setScenes] = useState<SentinelSceneSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ id: string; datetime: string; cloud: number | null; pixelM: number } | null>(null);
  const request = useRef(0);
  const problem = p.box ? boxProblem(p.box) : null;

  useEffect(() => {
    // A new box or cloud limit starts a new search; late replies for an older box are ignored.
    const n = ++request.current;
    setScenes(null); setError(null);
    if (!p.box || problem) return;
    setBusy('search');
    api.sentinelSearch(p.box, maxCloud)
      .then((r) => { if (n === request.current) setScenes(r.scenes); })
      .catch((e) => { if (n === request.current) setError(errorText(e)); })
      .finally(() => { if (n === request.current) setBusy(null); });
  }, [p.box?.join(','), maxCloud]);

  async function show(s: SentinelSceneSummary) {
    if (!p.box) return;
    const n = ++request.current;
    setBusy(s.id); setError(null);
    try {
      const img = await api.sentinelRender(s.id, p.box);
      const bitmap = await decodeSentinelPng(img.png);
      if (n !== request.current) return;
      p.onOverlay({ box: img.box, bitmap, opacity: p.overlay?.opacity ?? 1 });
      setShown({ id: s.id, datetime: img.datetime, cloud: img.cloudCover, pixelM: img.pixelM });
    } catch (e) {
      if (n === request.current) setError(errorText(e));
    } finally {
      if (n === request.current) setBusy(null);
    }
  }

  const span = p.box ? boxSpanKm(p.box) : null;
  return (
    <div className="recent-imagery" role="region" aria-label="Recent satellite imagery">
      <div className="diag-head">
        <strong><Satellite size={15} aria-hidden="true" /> Recent imagery</strong>
        <button className="icon-btn" onClick={p.onClose} aria-label="Close recent imagery"><X size={15} aria-hidden="true" /></button>
      </div>
      <p className="muted small">Sentinel-2 true colour at 10 m, from the last {SENTINEL_SEARCH_DAYS} days. Each pass is a few days apart and clouds can hide the ground.</p>
      <div className="btn-row">
        <button className={`btn small-btn ${p.drawing ? 'primary' : ''}`} aria-pressed={p.drawing} onClick={p.onDraw}><SquareDashed size={14} aria-hidden="true" /> Draw a box</button>
        {p.aroundSelection && <button className="btn small-btn" onClick={() => { const b = p.aroundSelection?.(); if (b) p.onBox(b); }}><Crosshair size={14} aria-hidden="true" /> Around selection</button>}
      </div>
      {p.drawing && <p className="note small">Press and drag on the globe to draw the box (up to 55 km across).</p>}
      {p.box && span && <p className="small">Box {span.widthKm.toFixed(1)} × {span.heightKm.toFixed(1)} km</p>}
      {problem && <p className="small warn-text" role="alert">{problem}</p>}
      <label className="field small">
        <span><Cloud size={13} aria-hidden="true" /> Cloud cover under {maxCloud}% (whole scene)</span>
        <input type="range" min={5} max={100} step={5} value={maxCloud} onChange={(e) => setMaxCloud(Number(e.target.value))} />
      </label>
      {busy === 'search' && <p className="muted small" role="status">Searching Earth Search…</p>}
      {error && <p className="small warn-text" role="alert">{error}</p>}
      {scenes && scenes.length === 0 && <p className="muted small">No passes over this box with less than {maxCloud}% cloud in the last {SENTINEL_SEARCH_DAYS} days. Try a higher cloud limit.</p>}
      {scenes && scenes.length > 0 && (
        <ul className="scene-list">
          {scenes.map((s) => (
            <li key={s.id}>
              <button className={`scene-btn ${shown?.id === s.id ? 'active' : ''}`} onClick={() => void show(s)} disabled={!!busy} aria-pressed={shown?.id === s.id}>
                <span><Time iso={s.datetime} /></span>
                <span className="muted">{s.cloudCover === null ? 'cloud unknown' : `${Math.round(s.cloudCover)}% cloud`}{s.platform ? ` · ${s.platform.replace('sentinel-', 'S')}` : ''}</span>
                {busy === s.id && <span className="muted">Loading…</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {p.overlay && shown && (
        <div className="imagery-shown">
          <p className="small">Showing the pass of <Time iso={shown.datetime} /> at {shown.pixelM} m per pixel. Dark areas with no data are left clear.</p>
          <label className="field small">
            <span>Opacity</span>
            <input type="range" min={0.2} max={1} step={0.05} value={p.overlay.opacity} onChange={(e) => p.onOverlay({ ...p.overlay!, opacity: Number(e.target.value) })} />
          </label>
          <button className="btn small-btn" onClick={() => { p.onOverlay(null); setShown(null); }}>Remove image</button>
        </div>
      )}
      <p className="muted small">Contains modified Copernicus Sentinel data, via Earth Search (Element 84) and AWS Open Data.</p>
    </div>
  );
}
