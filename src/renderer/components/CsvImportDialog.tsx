import { useMemo, useState } from 'react';
import sampleCsv from '../../../samples/sample-locations.csv?raw';
import { buildPreview, guessMapping, LOCATION_FIELDS, parseCsv, planImport, type ColumnMapping, type LocationField, type ParsedCsv } from '../../shared/csv';
import type { DuplicateMode, ImportResult, SavedLocation } from '../../shared/types';
import { api, errorText } from '../lib/api';
import { Modal } from './common';

const FIELD_LABEL: Record<LocationField, string> = {
  name: 'Name *',
  latitude: 'Latitude *',
  longitude: 'Longitude *',
  category: 'Category',
  notes: 'Notes',
  radius_km: 'Radius (km)',
};

const STATUS_LABEL = {
  valid: 'Ready',
  invalid: 'Error',
  'duplicate-existing': 'Duplicate of saved location',
  'duplicate-in-file': 'Duplicate within file',
} as const;

export function CsvImportDialog({ existing, onClose }: { existing: SavedLocation[]; onClose(): void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [mode, setMode] = useState<DuplicateMode>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => (parsed ? buildPreview(parsed, mapping, existing) : []), [parsed, mapping, existing]);
  const plan = useMemo(() => planImport(preview, mode), [preview, mode]);
  const counts = useMemo(() => {
    const c = { valid: 0, invalid: 0, 'duplicate-existing': 0, 'duplicate-in-file': 0 };
    for (const r of preview) c[r.status]++;
    return c;
  }, [preview]);

  function loadText(text: string, name: string) {
    const p = parseCsv(text);
    setParsed(p);
    setMapping(guessMapping(p.headers));
    setFileName(name);
    setResult(null);
    setError(p.headers.length === 0 ? 'No header row found. The first row must contain column names.' : null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setError('File is larger than 5 MB.');
      return;
    }
    loadText(await f.text(), f.name);
  }

  async function doImport() {
    setBusy(true);
    try {
      const r = await api.importLocations(plan.items);
      setResult({ ...r, skipped: r.skipped + plan.skipped });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([sampleCsv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atlas-watch-sample-locations.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const footer = result ? (
    <button className="btn primary" onClick={onClose}>
      Done
    </button>
  ) : (
    <>
      <button className="btn" onClick={onClose}>
        Cancel
      </button>
      <button className="btn primary" onClick={() => void doImport()} disabled={!parsed || plan.items.length === 0 || busy}>
        {busy ? 'Importing…' : `Import ${plan.items.length} location${plan.items.length === 1 ? '' : 's'}`}
      </button>
    </>
  );

  return (
    <Modal title="Import locations from CSV" onClose={onClose} wide footer={footer}>
      {result ? (
        <div className="import-result" role="status">
          <p>
            <strong>Import complete.</strong> {result.created} created, {result.updated} updated, {result.skipped} skipped.
          </p>
        </div>
      ) : (
        <>
          <div className="btn-row">
            <label className="btn primary file-btn">
              Choose CSV file…
              <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
            </label>
            <button className="btn" onClick={() => loadText(sampleCsv, 'sample-locations.csv')}>
              Preview sample file
            </button>
            <button className="btn" onClick={downloadSample}>
              Save sample CSV…
            </button>
            {fileName && <span className="muted small">{fileName}</span>}
          </div>
          <p className="muted small">
            Expected columns: <code>name, latitude, longitude, category, notes, radius_km</code>. Only name, latitude, and longitude are required; radius defaults to 50 km. Nothing is saved until you click
            Import.
          </p>
          {error && <div className="error-line">{error}</div>}
          {parsed && parsed.errors.length > 0 && (
            <details className="note">
              <summary>{parsed.errors.length} CSV parsing warning(s)</summary>
              <ul>
                {parsed.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          {parsed?.truncated && <div className="note">Only the first 5,000 rows are shown and imported.</div>}
          {parsed && parsed.headers.length > 0 && (
            <>
              <h3 className="sub">Column mapping</h3>
              <div className="mapping-grid">
                {LOCATION_FIELDS.map((f) => (
                  <label key={f} className="field">
                    <span>{FIELD_LABEL[f]}</span>
                    <select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                      <option value="">— not mapped —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <h3 className="sub">Preview</h3>
              <div className="import-counts" role="status">
                <span className="tag ok-badge">{counts.valid} ready</span>
                <span className="tag sev-extreme">{counts.invalid} with errors</span>
                <span className="tag sev-moderate">{counts['duplicate-existing']} duplicate of saved</span>
                <span className="tag sev-unknown">{counts['duplicate-in-file']} duplicate in file</span>
              </div>
              <fieldset className="dup-mode">
                <legend>Duplicates of saved locations</legend>
                <label>
                  <input type="radio" name="dup" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Skip
                </label>
                <label>
                  <input type="radio" name="dup" checked={mode === 'update'} onChange={() => setMode('update')} /> Update existing
                </label>
                <label>
                  <input type="radio" name="dup" checked={mode === 'keep'} onChange={() => setMode('keep')} /> Keep both
                </label>
              </fieldset>
              <div className="preview-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Status</th>
                      <th>Name</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th>Category</th>
                      <th>Radius</th>
                      <th>Problems</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 300).map((r) => {
                      const raw = parsed.rows[r.rowNumber - 2];
                      const cell = (f: LocationField) => (mapping[f] ? raw[mapping[f]!] : '');
                      return (
                        <tr key={r.rowNumber} className={`st-${r.status}`}>
                          <td>{r.rowNumber}</td>
                          <td>{STATUS_LABEL[r.status]}</td>
                          <td>{cell('name')}</td>
                          <td>{cell('latitude')}</td>
                          <td>{cell('longitude')}</td>
                          <td>{cell('category')}</td>
                          <td>{r.input?.radiusKm ?? cell('radius_km')}</td>
                          <td className="small">{r.errors.join(' ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.length > 300 && <p className="muted small">Showing the first 300 of {preview.length} rows.</p>}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
