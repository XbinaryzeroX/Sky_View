import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoJsonFilePreview } from '../../shared/geojsonAnnotations';
import { api, errorText, type Annotation } from '../lib/api';
import { Modal } from './common';
import './geoJsonTools.css';

/** File text lives only in this preview; commit always reparses it in main. */
export function GeoJsonTools({ count, onImported }: { count: number; onImported?(annotations: Annotation[]): void }) {
  const [file, setFile] = useState<GeoJsonFilePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptSkips, setAcceptSkips] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function choose() {
    setBusy(true); setError(null); setStatus(null); setFile(null); setAcceptSkips(false);
    try { setFile(await api.previewAnnotationsGeoJson()); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const result = await api.importAnnotationsGeoJson(file.text);
      onImported?.(result.annotations);
      setFile(null);
      setStatus(`Imported ${result.imported} annotation(s). Skipped ${result.duplicates} exact duplicate(s) and ${result.rejected.length} unsupported/invalid feature(s).`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function exportFile() {
    setBusy(true); setError(null); setStatus(null);
    try {
      const path = await api.exportAnnotationsGeoJson();
      if (path) setStatus(`Annotations exported to ${path}`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const skipped = file ? file.preview.duplicates + file.preview.rejected.length : 0;
  return <div className="geojson-tools">
    <div className="diag-sub">GeoJSON annotations</div>
    <div className="btn-row">
      <button className="btn small-btn" onClick={() => void choose()} disabled={busy}>Import GeoJSON…</button>
      <button className="btn small-btn" onClick={() => void exportFile()} disabled={busy || count === 0}>Export annotations…</button>
    </div>
    <p className="muted small">Local files only. Points, lines and simple polygons with one exterior ring; holes, Multi geometries, altitude and CRS declarations are unsupported. Imports add annotations and skip exact geometry/name duplicates. Globe edges follow geodesic paths between vertices; these can differ from straight GeoJSON coordinate segments.</p>
    {status && <p className="small" role="status">{status}</p>}
    {error && !file && <p className="error-line" role="alert">{error}</p>}
    {file && createPortal(<Modal title="Import GeoJSON annotations" wide onClose={() => { if (!busy) { setFile(null); setError(null); } }} footer={<>
      <button className="btn" disabled={busy} onClick={() => { setFile(null); setError(null); }}>Cancel</button>
      <button className="btn primary" disabled={busy || file.preview.candidates.length === 0 || (skipped > 0 && !acceptSkips)} onClick={() => void commit()}>{busy ? 'Importing…' : `Import ${file.preview.candidates.length} valid annotation(s)`}</button>
    </>}>
      <p>Preview only; nothing has been saved. Existing annotations will not be overwritten.</p>
      <p className="note small">WGS84 [longitude, latitude]. Maximum 2 MiB, 2,000 features, 5,000 positions per geometry and 20,000 supported positions per file; 2,000 stored annotations. Lines must have nonzero geographic length. Rings must be closed, simple and have nonzero area; complex or globe-wrapping rings are rejected. Only name, color and visibility are retained; source IDs and all other properties are discarded. Exports use the same file/geometry limits and include annotation geometry and these three properties only, never saved places or notes.</p>
      <p role="status">{file.preview.featureCount} feature(s) · <strong>{file.preview.candidates.length} ready</strong> · {file.preview.duplicates} exact duplicate(s) skipped · {file.preview.rejected.length} rejected</p>
      {file.preview.rejected.length > 0 && <div className="geojson-rejections"><strong>Features that will not be imported</strong><ul>{file.preview.rejected.map(issue => <li key={issue.feature}>Feature {issue.feature}: {issue.message}</li>)}</ul></div>}
      {file.preview.candidates.length > 0 && <div className="geojson-preview"><table><thead><tr><th>Name</th><th>Annotation</th><th>Positions</th></tr></thead><tbody>{file.preview.candidates.map((a, i) => <tr key={i}><td>{a.name}</td><td>{a.kind}</td><td>{a.points.length}</td></tr>)}</tbody></table></div>}
      {skipped > 0 && <label className="geojson-accept"><input type="checkbox" checked={acceptSkips} onChange={e => setAcceptSkips(e.target.checked)} /> Import the valid features only; skip the {skipped} duplicate or rejected feature(s) shown above.</label>}
      {error && <p className="error-line" role="alert">{error}</p>}
    </Modal>, document.body)}
  </div>;
}
