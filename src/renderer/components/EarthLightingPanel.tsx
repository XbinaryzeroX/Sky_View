import { useEffect, useState } from 'react';
import { utcMinute, validLightingTime, type EarthLighting } from '../map/earthLighting';

export function EarthLightingPanel({ lighting, onChange }: { lighting: EarthLighting; onChange(value: EarthLighting): void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const time = lighting.mode === 'custom' ? lighting.utc : utcMinute(now);
  const changeTime = (utc: string) => { if (validLightingTime(utc)) onChange({ mode: 'custom', utc }); };
  const minutes = Number(time.slice(11, 13)) * 60 + Number(time.slice(14));
  return (
    <div className="earth-lighting-panel">
      <div className="seg" role="group" aria-label="Earth lighting">
        <button className={'btn small-btn ' + (lighting.mode === 'day' ? 'primary' : '')} aria-pressed={lighting.mode === 'day'} onClick={() => onChange({ mode:'day' })}>Daylight</button>
        <button className={'btn small-btn ' + (lighting.mode === 'now' ? 'primary' : '')} aria-pressed={lighting.mode === 'now'} onClick={() => onChange({ mode:'now' })}>Current sunlight</button>
        <button className={'btn small-btn ' + (lighting.mode === 'custom' ? 'primary' : '')} aria-pressed={lighting.mode === 'custom'} onClick={() => changeTime(time)}>Choose time</button>
      </div>
      {lighting.mode === 'now' && <p className="small">Sun position at {time.replace('T',' ')} UTC</p>}
      {lighting.mode === 'custom' && <>
        <div className="lighting-inputs">
          <label className="field"><span>Lighting date (UTC)</span><input type="date" value={time.slice(0,10)} onChange={e => changeTime(e.target.value + time.slice(10))} /></label>
          <label className="field"><span>Lighting time (UTC)</span><input type="time" value={time.slice(11)} onChange={e => changeTime(time.slice(0,11) + e.target.value)} /></label>
        </div>
        <input aria-label="Scrub lighting time (UTC)" type="range" min="0" max="1439" step="1" value={minutes}
          onChange={e => {
            const n = Number(e.target.value);
            changeTime(time.slice(0,11) + String(Math.floor(n / 60)).padStart(2,'0') + ':' + String(n % 60).padStart(2,'0'));
          }} />
      </>}
      <p className="small muted">City lights on the dark hemisphere come from NASA’s 2016 Black Marble satellite composite.</p>
    </div>
  );
}
