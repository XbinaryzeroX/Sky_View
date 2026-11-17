// Worldwide radio: search the Radio Browser directory by name, kind and country, or list stations near the map
// centre, and play one through the app's relay. Scanner and ATC entries are labelled as third-party relays.
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio as RadioIcon, Square } from 'lucide-react';
import { RADIO_KINDS, type RadioKind, type RadioStation } from '../../shared/radio';
import { api, errorText } from '../lib/api';
import { radio, takeRadioIntent, useRadio } from '../lib/radioPlayer';

const KIND_LABEL: Record<RadioKind, string> = { all: 'All', news: 'News & talk', music: 'Music', scanner: 'Scanners', atc: 'Air traffic' };
const STATION_KIND_LABEL = { broadcast: 'Broadcast', scanner: 'Scanner relay', atc: 'ATC relay' } as const;

export function RadioPage({ viewCenter, focus }: { viewCenter(): { lat: number; lon: number } | null; focus(lat: number, lon: number, radiusKm?: number): void }) {
  const first = useRef(takeRadioIntent());
  const [query, setQuery] = useState(first.current?.query ?? '');
  const [kind, setKind] = useState<RadioKind>(first.current?.kind ?? 'all');
  const [country, setCountry] = useState('');
  const [nearMap, setNearMap] = useState(!!first.current?.near);
  const nearFixed = useRef(first.current?.near ?? null);
  const [result, setResult] = useState<{ stations: RadioStation[]; note: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const player = useRadio();

  async function search() {
    const id = ++request.current;
    setBusy(true); setError(null);
    try {
      const c = nearMap ? (nearFixed.current ?? viewCenter()) : null;
      // Only the position: the view object carries more (the IPC schema is strict).
      const near = c ? { lat: c.lat, lon: c.lon } : null;
      const r = await api.radioSearch({ query: query.trim().slice(0, 80), kind, country: /^[A-Z]{2}$/.test(country) ? country : null, near });
      if (id === request.current) setResult(r);
    } catch (e) {
      if (id === request.current) setError(errorText(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => { void search(); }, [kind, nearMap]);

  return (
    <div className="radio-page">
      <form className="radio-search" onSubmit={(e) => { e.preventDefault(); nearFixed.current = null; void search(); }}>
        <input className="view-name" value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} placeholder="Station or city name" aria-label="Station or city name" />
        <input className="view-name radio-country" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="CC" aria-label="Two-letter country code (optional)" title="Two-letter country code, for example GB or JP" />
        <button className="btn small" type="submit" disabled={busy}>Search</button>
      </form>
      <div className="radio-kinds" role="group" aria-label="Kind of station">
        {RADIO_KINDS.map((k) => (
          <button key={k} className={`chip ${kind === k ? 'active' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
        <label className="check small"><input type="checkbox" checked={nearMap} onChange={(e) => { nearFixed.current = null; setNearMap(e.target.checked); }} /> Near the map centre (250 km)</label>
      </div>
      {(kind === 'scanner' || kind === 'atc') && (
        <p className="small muted radio-warning">Scanner and air-traffic entries are relays run by third parties and listed by volunteers. Coverage is patchy, a listed stream may be offline, and listening to police or emergency radio is illegal in some countries (for example the UK and Germany). Check your local law.</p>
      )}
      {busy && <p className="small muted" role="status">Searching the Radio Browser directory…</p>}
      {error && <p className="small error-line" role="alert">{error}</p>}
      {result?.note && <p className="small muted">{result.note}</p>}
      {result && !busy && !result.stations.length && !result.note && <p className="small muted">No stations match. Try another name, kind or country.</p>}
      <ul className="radio-list">
        {result?.stations.map((s) => {
          const current = player.station?.id === s.id;
          return (
            <li key={s.id} className={current ? 'current' : ''}>
              <button className="icon-btn" aria-label={current && player.status !== 'error' ? `Stop ${s.name}` : `Play ${s.name}`} onClick={() => (current && player.status !== 'error' ? radio.stop() : radio.play(s))}>
                {current && player.status !== 'error' ? <Square size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              </button>
              <span className="radio-name">
                <b>{s.name}</b>
                <span className="small muted">
                  {s.kind !== 'broadcast' && <span className="tag">{STATION_KIND_LABEL[s.kind]}</span>} {[s.country, s.codec && s.bitrate ? `${s.codec} ${s.bitrate} kb/s` : s.codec, s.distanceKm !== null ? `${s.distanceKm.toLocaleString()} km away` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {s.lat !== null && s.lon !== null && <button className="link-btn small" onClick={() => focus(s.lat!, s.lon!, 30)}>Map</button>}
            </li>
          );
        })}
      </ul>
      <p className="small muted">Station list: Radio Browser (radio-browser.info, community directory, public domain). Audio comes from each station’s own server through the app; locations are as the station listed them.</p>
    </div>
  );
}

/** Small now-playing bar shown over the map while a station plays. */
export function RadioNowPlaying({ onOpen }: { onOpen(): void }) {
  const p = useRadio();
  if (!p.station) return null;
  return (
    <div className={`radio-now radio-${p.status}`} role="region" aria-label="Radio">
      <RadioIcon size={15} aria-hidden="true" />
      <button className="link-btn radio-now-name" onClick={onOpen} title="Open Radio">{p.station.name}</button>
      <span className="small muted">{p.status === 'loading' ? 'Connecting…' : p.status === 'error' ? p.error : p.station.kind === 'broadcast' ? 'Live' : STATION_KIND_LABEL[p.station.kind]}</span>
      <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => radio.volume(Number(e.target.value))} aria-label="Radio volume" />
      <button className="icon-btn" aria-label="Stop radio" onClick={() => radio.stop()}>{p.status === 'error' ? <Square size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>
    </div>
  );
}
