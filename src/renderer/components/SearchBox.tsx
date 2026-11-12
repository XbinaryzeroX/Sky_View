import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCoordinates } from '../../shared/geo';
import type { PlaceSearchMode } from '../../shared/geocoding';
import { useBundledPlaces } from '../lib/useBundledPlaces';
import { api, errorText } from '../lib/api';

interface Result {
  key: string;
  label: string;
  detail: string;
  lat?: number;
  lon?: number;
  action?: 'address' | 'google';
  onPick?: () => void;
}

export type SearchResult = Result;

export function SearchBox({ value, onChange, onGo, inputRef, extra, mode }: { value: string; onChange(v: string): void; onGo(lat: number, lon: number, label: string, kind: 'coords' | 'place' | 'address'): void; inputRef: React.RefObject<HTMLInputElement | null>; extra?: (q: string) => Result[]; mode: PlaceSearchMode }) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [addr, setAddr] = useState<{ q: string; mode: PlaceSearchMode; results: Result[]; error: string | null; busy: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const pending = useRef<string | null>(null);
  const enterQuery = useRef<string | null>(null);
  const q = value.trim();
  const coordinates = useMemo(() => parseCoordinates(q), [q]);
  const invalidUri = /^geo:/i.test(q) && !coordinates;
  const searchable = q.length >= 2 || /^\p{Script=Han}$/u.test(q);
  const showPopup = open && searchable;
  const needsPlaces = showPopup && mode === 'offline' && !coordinates && !invalidUri;
  const places = useBundledPlaces(q, needsPlaces);
  const loadingPlaces = needsPlaces && !places;
  const response = addr?.q === q && addr.mode === mode ? addr : null;
  // Invalidate provider-specific work without remounting the input while the user is typing.
  useEffect(() => {
    setAddr(null);
    setActiveKey(null);
    pending.current = null;
    enterQuery.current = null;
    return () => { requestId.current++; };
  }, [mode]);

  const shown = useMemo<Result[]>(() => {
    if (!showPopup || invalidUri) return [];
    if (coordinates) return [{ key: 'coords', label: `Go to ${coordinates.lat.toFixed(5)}, ${coordinates.lon.toFixed(5)}`, detail: 'WGS84 horizontal coordinates', ...coordinates }];
    const local = places?.matches ?? [];
    const rows: Result[] = [...(response?.results ?? []), ...local.filter(p => p.exact), ...(extra?.(q) ?? []), ...local.filter(p => !p.exact)];
    if (response?.busy || response?.results.length || q.length > 200) return rows;
    if (mode === 'google' && q.length >= 2) rows.push({ key: 'google', label: `Search “${q}” with Google`, detail: 'Google Maps Geocoding · billed to your key for this search', action: 'google' });
    if (mode === 'offline' && q.length >= 5 && /\d/.test(q)) rows.push({ key: 'addr', label: `Search U.S. address “${q}”`, detail: 'Send this address to the U.S. Census Geocoder', action: 'address' });
    return rows;
  }, [showPopup, invalidUri, coordinates, places, response, extra, q, mode]);
  const active = Math.max(0, shown.findIndex(item => item.key === activeKey));

  function dismiss() {
    setOpen(false);
    setActiveKey(null);
    enterQuery.current = null;
    requestId.current++;
    pending.current = null;
    setAddr(null);
  }

  function navigate(r: Result) {
    if (r.onPick) r.onPick();
    else if (r.lat !== undefined && r.lon !== undefined) onGo(r.lat, r.lon, r.label, r.key === 'coords' ? 'coords' : r.key.startsWith('a-') ? 'address' : 'place');
    dismiss();
  }

  useEffect(() => {
    if (showPopup && !loadingPlaces && enterQuery.current === q) {
      enterQuery.current = null;
      if (shown[0] && !shown[0].action) navigate(shown[0]);
    }
  }, [showPopup, loadingPlaces, shown, q]);
  useEffect(() => {
    if (activeKey && showPopup) boxRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, showPopup]);

  async function choose(r: Result) {
    enterQuery.current = null;
    if (r.action) {
      if (pending.current === q) return;
      pending.current = q;
      const id = ++requestId.current;
      const google = r.action === 'google';
      setAddr({ q, mode, results: [], error: null, busy: true });
      setActiveKey(null);
      try {
        const m = google ? await api.geocodeGoogle(q) : await api.geocodeAddress(q);
        if (requestId.current === id) setAddr({ q, mode, results: m.map((x, i) => ({ key: `a-${i}`, label: x.label, detail: google ? 'Google Maps Geocoding match' : 'U.S. Census Geocoder match', lat: x.lat, lon: x.lon })), error: m.length ? null : google ? 'No Google Maps match.' : 'No U.S. address match.', busy: false });
      } catch (e) {
        if (requestId.current === id) setAddr({ q, mode, results: [], error: errorText(e), busy: false });
      } finally {
        if (requestId.current === id) pending.current = null;
      }
      return;
    }
    navigate(r);
  }

  return (
    <div className="search-wrap" ref={boxRef} onBlur={(e) => !boxRef.current?.contains(e.relatedTarget as Node) && dismiss()}>
      <input
        ref={inputRef}
        className="search"
        type="search"
        maxLength={200}
        placeholder="Search places, coordinates, addresses, locations  ( / )"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          requestId.current++;
          pending.current = null;
          enterQuery.current = null;
          setAddr(null);
          onChange(e.target.value);
          setOpen(true);
          setActiveKey(null);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            enterQuery.current = null;
            setOpen(true);
            const i = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
            setActiveKey(shown[i]?.key ?? null);
          } else if (e.key === 'Enter' && showPopup) {
            e.preventDefault();
            if (loadingPlaces && !activeKey) enterQuery.current = q;
            else if (shown[active]) void choose(shown[active]);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }
        }}
        aria-label="Search places, coordinates, U.S. addresses, saved locations and history"
        aria-expanded={showPopup}
        aria-autocomplete="list"
        aria-activedescendant={showPopup && shown[active] ? `search-option-${active}` : undefined}
        role="combobox"
        aria-controls="search-results"
      />
      {showPopup && (
        <ul className="search-results" id="search-results" role="listbox">
          {shown.map((r, i) => (
            <li key={r.key} role="option" id={`search-option-${i}`} aria-selected={i === active}>
              <button tabIndex={-1} className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(r)}>
                <span dir="auto">{r.label}</span>
                <span className="muted small">{r.detail}</span>
              </button>
            </li>
          ))}
          {invalidUri ? <li className="muted small pad" role="status">Enter a WGS84 geo URI with valid latitude and longitude.</li> : <>
            {loadingPlaces && <li className="muted small pad" role="status">Searching bundled places…</li>}
            {places?.error && <li className="muted small pad" role="status">{places.error}</li>}
            {response?.busy && <li className="muted small pad" role="status">Searching {mode === 'google' ? 'Google Maps' : 'the U.S. Census Geocoder'}…</li>}
            {response?.error && <li className="muted small pad" role="status">{response.error}</li>}
            {mode === 'offline' && !shown.length && !loadingPlaces && !places?.error && !response?.busy && !response?.error && <li className="muted small pad" role="status">No matching bundled place.</li>}
            {mode === 'offline' && !coordinates && <li className="muted small pad">Natural Earth · offline. Add a region or country after a comma to narrow a place name.</li>}
            {mode === 'google-needs-key' && !coordinates && <li className="muted small pad">Google imagery is selected. Add your Google Maps key in Providers for address search, or select a keyless basemap for bundled places.</li>}
          </>}
        </ul>
      )}
    </div>
  );
}
