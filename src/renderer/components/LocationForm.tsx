import { useEffect, useState } from 'react';
import { DEFAULT_RADIUS_KM, validateLocationInput } from '../../shared/csv';
import type { LocationInput, SavedLocation } from '../../shared/types';
import { api, errorText } from '../lib/api';

interface Props {
  existing: SavedLocation | null;
  categories: string[];
  picked: { lat: number; lon: number } | null;
  pickMode: boolean;
  onPickMode(v: boolean): void;
  onClose(): void;
  onSaved(loc: SavedLocation): void;
}

/** Non-modal side sheet so the globe stays clickable for "pick on globe". */
export function LocationForm(p: Props) {
  const [name, setName] = useState(p.existing?.name ?? '');
  const [category, setCategory] = useState(p.existing?.category ?? '');
  const [notes, setNotes] = useState(p.existing?.notes ?? '');
  const [lat, setLat] = useState(p.existing ? String(p.existing.lat) : '');
  const [lon, setLon] = useState(p.existing ? String(p.existing.lon) : '');
  const [radius, setRadius] = useState(String(p.existing?.radiusKm ?? DEFAULT_RADIUS_KM));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (p.picked) {
      setLat(String(p.picked.lat));
      setLon(String(p.picked.lon));
    }
  }, [p.picked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (p.pickMode) p.onPickMode(false);
        else p.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
    const input: LocationInput = { name: name.trim(), category: category.trim(), notes, lat: num(lat), lon: num(lon), radiusKm: num(radius) };
    const errs = validateLocationInput(input);
    setErrors(errs);
    if (errs.length) return;
    setSaving(true);
    try {
      const saved = p.existing ? await api.updateLocation(p.existing.id, input) : await api.createLocation(input);
      p.onPickMode(false);
      p.onSaved(saved);
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-label={p.existing ? 'Edit location' : 'Add location'}>
      <form onSubmit={save}>
        <header className="modal-head">
          <h2>{p.existing ? 'Edit location' : 'Add location'}</h2>
          <button type="button" className="icon-btn" onClick={p.onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
          </label>
          <label className="field">
            <span>Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} list="category-options" placeholder="e.g. Warehouse, Rental, Office" />
            <datalist id="category-options">
              {p.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Latitude *</span>
              <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="e.g. 39.7392" />
            </label>
            <label className="field">
              <span>Longitude *</span>
              <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" placeholder="e.g. -104.9903" />
            </label>
          </div>
          <button type="button" className={`btn ${p.pickMode ? 'primary' : ''}`} onClick={() => p.onPickMode(!p.pickMode)} aria-pressed={p.pickMode}>
            {p.pickMode ? 'Click the globe to set the point… (Esc to stop)' : '⌖ Pick point on globe'}
          </button>
          <label className="field">
            <span>Monitoring radius (km) *</span>
            <input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" />
            <small className="muted">Used for earthquake proximity. Weather alerts are evaluated at the point itself.</small>
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
          </label>
          {errors.length > 0 && (
            <ul className="error-list" role="alert">
              {errors.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          )}
          <p className="muted small">When NWS zone lookup is on, the coordinates are sent to api.weather.gov once to find the forecast, county, and fire-weather zones for this point.</p>
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn" onClick={p.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save location'}
          </button>
        </footer>
      </form>
    </div>
  );
}
