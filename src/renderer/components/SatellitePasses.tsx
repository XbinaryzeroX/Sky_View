import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { GeoRecord } from '../../shared/layers';
import type { SavedLocation } from '../../shared/types';
import type { SatellitePassResult } from '../../shared/satellitePasses';
import type { PassRequest } from '../map/satellitePassWorker';
import { relativeTime, utcTime } from '../lib/format';

type Result = { state: 'idle' | 'loading' } | { state: 'error'; error: string } | { state: 'done'; result: SatellitePassResult };

/** Reuses the selected satellite's loaded elements; never fetches a second catalog or invents an observer. */
export function SatellitePasses({ record, savedPlaces = [] }: { record: GeoRecord; savedPlaces?: SavedLocation[] }) {
  const [placeId, setPlaceId] = useState('manual');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [height, setHeight] = useState('0');
  const [threshold, setThreshold] = useState('10');
  const [output, setOutput] = useState<Result>({ state: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const tleKey = record.tle?.join('\n') ?? '';
  const selectedPlace = savedPlaces.find((p) => p.id === placeId);
  const observerKey = selectedPlace ? `${selectedPlace.id}|${selectedPlace.lat}|${selectedPlace.lon}` : `${placeId}|${lat}|${lon}`;
  useEffect(() => {
    clear();
    setOutput({ state: 'idle' });
    return clear;
  }, [record.id, tleKey, observerKey, height, threshold]);

  const calculate = (event: FormEvent) => {
    event.preventDefault();
    clear();
    if (!record.tle) { setOutput({ state: 'error', error: 'No orbital elements are loaded for this satellite.' }); return; }
    if (placeId !== 'manual' && !selectedPlace) { setOutput({ state: 'error', error: 'The saved observer place is no longer available. Choose another place or enter coordinates.' }); return; }
    if ((!selectedPlace && (!lat.trim() || !lon.trim())) || !height.trim()) { setOutput({ state: 'error', error: 'Enter the observer coordinates and elevation.' }); return; }
    const observer = { lat: selectedPlace?.lat ?? Number(lat), lon: selectedPlace?.lon ?? Number(lon), heightM: Number(height) };
    setOutput({ state: 'loading' });
    try {
      const worker = new Worker(new URL('../map/satellitePassWorker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ ok: true; result: SatellitePassResult } | { ok: false; error: string }>) => {
        if (workerRef.current !== worker) return;
        clear();
        setOutput(event.data.ok ? { state: 'done', result: event.data.result } : { state: 'error', error: event.data.error });
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        clear(); setOutput({ state: 'error', error: 'The pass calculator could not start. Retry or reload the app.' });
      };
      timerRef.current = setTimeout(() => {
        if (workerRef.current !== worker) return;
        clear(); setOutput({ state: 'error', error: 'The pass calculation timed out. Retry with fresh orbital elements.' });
      }, 10000);
      worker.postMessage({ tle: record.tle, observer, startMs: Date.now(), thresholdDeg: Number(threshold) } satisfies PassRequest);
    } catch {
      clear(); setOutput({ state: 'error', error: 'The pass calculator is unavailable on this system.' });
    }
  };
  return <section aria-labelledby="satellite-passes-title" aria-busy={output.state === 'loading'}>
    <h3 className="sub" id="satellite-passes-title">Predicted passes · next 24 hours</h3>
    <p className="muted small">Geometric predictions from this satellite’s loaded orbital elements. Above-horizon does not mean visible: sunlight, weather, terrain and buildings are not evaluated.</p>
    <form onSubmit={calculate}>
      <label className="field"><span>Observer</span>
        <select aria-label="Pass observer" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          <option value="manual">Enter coordinates</option>
          {savedPlaces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {placeId === 'manual' ? <div className="field-row">
        <label className="field"><span>Latitude</span><input aria-label="Observer latitude" type="number" step="any" min="-90" max="90" required value={lat} onChange={(e) => setLat(e.target.value)} /></label>
        <label className="field"><span>Longitude</span><input aria-label="Observer longitude" type="number" step="any" min="-180" max="180" required value={lon} onChange={(e) => setLon(e.target.value)} /></label>
      </div> : selectedPlace && <p className="small muted">{selectedPlace.lat.toFixed(5)}, {selectedPlace.lon.toFixed(5)}</p>}
      <label className="field"><span>Observer elevation (m, WGS84)</span><input aria-label="Observer elevation" type="number" step="any" min="-500" max="10000" required value={height} onChange={(e) => setHeight(e.target.value)} /></label>
      <label className="field"><span>Elevation threshold</span><select aria-label="Pass elevation threshold" value={threshold} onChange={(e) => setThreshold(e.target.value)}><option value="0">0° (geometric horizon)</option><option value="10">10°</option><option value="30">30°</option></select></label>
      <div className="btn-row"><button type="submit" className="btn" disabled={!record.tle || output.state === 'loading'}>{output.state === 'loading' ? 'Calculating…' : 'Calculate passes'}</button>
        {output.state === 'loading' && <button type="button" className="btn" onClick={() => { clear(); setOutput({ state: 'idle' }); }}>Cancel</button>}
      </div>
    </form>
    {!record.tle && <p className="muted small">No orbital elements are loaded for this satellite.</p>}
    {output.state === 'error' && <p role="status" className="error-line small">{output.error}</p>}
    {output.state === 'done' && <PassResults result={output.result} />}
  </section>;
}

function PassResults({ result }: { result: SatellitePassResult }) {
  return <div role="status" aria-live="polite">
    <p className="small muted">Calculated {utcTime(result.startAt)} through {utcTime(result.endAt)}. Elements: {utcTime(result.elementEpoch)} ({relativeTime(result.elementEpoch)}). {result.stale ? 'Elements are over 7 days from the prediction start; accuracy may be poor. Refresh the Satellites layer.' : 'Accuracy degrades with element age and orbital maneuvers.'}</p>
    <p className="small muted">Times below are UTC; your computer’s local time is shown underneath. “Peak” is the highest elevation within this 24-hour window.</p>
    {result.passes.length ? <ol className="rec-list">{result.passes.map((pass, i) => <li key={pass.peakAt} className="small">
      <strong>Pass {i + 1} · {pass.maxElevationDeg.toFixed(1)}° maximum</strong>
      <dl className="kvs">
        <PassTime label={`Rise above ${result.thresholdDeg}°`} at={pass.riseAt} missing="Already above threshold at window start" />
        <PassTime label={`Peak · azimuth ${Math.round(pass.peakAzimuthDeg)}°`} at={pass.peakAt} missing="" />
        <PassTime label={`Set below ${result.thresholdDeg}°`} at={pass.setAt} missing="Still above threshold at window end" />
      </dl>
    </li>)}</ol> : <p>No predicted passes above {result.thresholdDeg}° for this observer in this 24-hour window.</p>}
  </div>;
}
function PassTime({ label, at, missing }: { label: string; at: string | null; missing: string }) {
  return <div className="kv"><dt>{label}</dt><dd>{at ? <><time dateTime={at}>{utcTime(at)}</time><br /><span className="muted">{new Date(at).toLocaleString()} local</span></> : missing}</dd></div>;
}
