import { useMemo, useRef, useState } from 'react';
import { parseCoordinates } from '../../shared/geo';
import placesData from '../data/places.json';
import { api, errorText } from '../lib/api';

type Place = [string, string, string, number, number, number];
const PLACES = (placesData as unknown as { places: Place[] }).places;

interface Result {
  key: string;
  label: string;
  detail: string;
  lat?: number;
  lon?: number;
  action?: 'address' | 'google';
  onPick?: () => void;
}

/** Keyless search: coordinates / geo: URI, bundled Natural Earth places, then U.S. Census address lookup on request. */
export type SearchResult = Result;

/**
 * `googleGeocoder`: while Google Photorealistic 3D Tiles are shown, Google's terms allow only the Google
 * geocoder, so bundled place names and the Census geocoder are replaced by Google Geocoding (customer key,
 * one request per explicit search, never per keystroke).
 */
export function SearchBox({ value, onChange, onGo, inputRef, extra, googleGeocoder = false }: { value: string; onChange(v: string): void; onGo(lat: number, lon: number, label: string, kind: 'coords' | 'place' | 'address'): void; inputRef: React.RefObject<HTMLInputElement | null>; extra?: (q: string) => Result[]; googleGeocoder?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [addr, setAddr] = useState<{ q: string; results: Result[]; error: string | null; busy: boolean } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const q = value.trim();
    if (q.length < 2) return [];
    const out: Result[] = [];
    const c = parseCoordinates(q);
    if (c) out.push({ key: 'coords', label: `Go to ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`, detail: 'Coordinates (WGS84)', lat: c.lat, lon: c.lon });
    if (extra) out.push(...extra(q));
    if (googleGeocoder) {
      if (!c) out.push({ key: 'google', label: `Search “${q}” with Google`, detail: 'Google Geocoding (your key; billed per search)', action: 'google' });
      return out;
    }
    const lq = q.toLowerCase();
    let n = 0;
    for (const p of PLACES) {
      if (p[0].toLowerCase().startsWith(lq)) {
        out.push({ key: `p-${n}-${p[0]}-${p[3]}`, label: p[0], detail: [p[1], p[2]].filter(Boolean).join(', '), lat: p[3], lon: p[4] });
        if (++n >= 8) break;
      }
    }
    if (!c && q.length >= 5 && /\d/.test(q)) out.push({ key: 'addr', label: `Search U.S. address “${q}”`, detail: 'U.S. Census Geocoder (sends this text to geocoding.geo.census.gov)', action: 'address' });
    return out;
  }, [value, extra, googleGeocoder]);

  const shown = addr && addr.q === value.trim() ? [...results.filter((r) => !r.action), ...addr.results] : results;

  async function choose(r: Result) {
    if (r.onPick) {
      r.onPick();
      setOpen(false);
      return;
    }
    if (r.action) {
      const q = value.trim();
      const google = r.action === 'google';
      setAddr({ q, results: [], error: null, busy: true });
      try {
        const m = google ? await api.geocodeGoogle(q) : await api.geocodeAddress(q);
        setAddr({ q, results: m.map((x, i) => ({ key: `a-${i}`, label: x.label, detail: google ? 'Google Geocoding match' : 'U.S. Census Geocoder match', lat: x.lat, lon: x.lon })), error: m.length ? null : google ? 'No Google match.' : 'No U.S. address match.', busy: false });
      } catch (e) {
        setAddr({ q, results: [], error: errorText(e), busy: false });
      }
      return;
    }
    if (r.lat === undefined || r.lon === undefined) return;
    onGo(r.lat, r.lon, r.label, r.key === 'coords' ? 'coords' : r.key.startsWith('a-') ? 'address' : 'place');
    setOpen(false);
  }

  return (
    <div className="search-wrap" ref={boxRef} onBlur={(e) => !boxRef.current?.contains(e.relatedTarget as Node) && setOpen(false)}>
      <input
        ref={inputRef}
        className="search"
        type="search"
        placeholder="Search places, coordinates, addresses, locations  ( / )"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && shown[active]) {
            e.preventDefault();
            void choose(shown[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        aria-label="Search places, coordinates, U.S. addresses, saved locations and history"
        aria-expanded={open && shown.length > 0}
        role="combobox"
        aria-controls="search-results"
      />
      {open && (shown.length > 0 || addr?.busy || addr?.error) && (
        <ul className="search-results" id="search-results" role="listbox">
          {shown.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button className={i === active ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => void choose(r)}>
                <span>{r.label}</span>
                <span className="muted small">{r.detail}</span>
              </button>
            </li>
          ))}
          {addr?.busy && <li className="muted small pad">{googleGeocoder ? 'Searching Google…' : 'Searching U.S. Census Geocoder…'}</li>}
          {addr?.error && <li className="muted small pad">{addr.error}</li>}
          <li className="muted small pad">{googleGeocoder ? 'Google 3D is on, so place search uses Google Geocoding (required by Google’s terms).' : 'Places: Natural Earth (bundled, no request sent). Filtering saved locations and history uses this text too.'}</li>
        </ul>
      )}
    </div>
  );
}
