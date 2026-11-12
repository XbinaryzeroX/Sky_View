import { useEffect, useState } from 'react';
import type { GeoRecord, LayerId } from '../../shared/layers';
import { MAX_EXTRAPOLATION_S, passengerMotionEndMs } from '../../shared/aircraft';
import { cockpitUnavailable, type TrackingMode } from '../../shared/trackingCamera';
import { relativeTime } from '../lib/format';
import './TrackingControls.css';
import { CABIN_ROWS, CABIN_COLUMNS } from '../../shared/passengerSeats';

export function TrackingControls({ target, record, mode, in3d, smoothMotion, blockedReason, passengerSeat, onPassengerSeat, interiorStatus, onMode, onStop }: {
  target: { layer: LayerId; id: string }; record: GeoRecord | null; mode: TrackingMode; in3d: boolean;
  smoothMotion: boolean; blockedReason?: string | null; onMode(mode: TrackingMode): void; onStop(): void;
  passengerSeat: string; onPassengerSeat(seat: string): void;
  interiorStatus: 'loading' | 'ready' | 'error';
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (mode === 'follow') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); onMode('follow');
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [mode, onMode]);
  const unavailable = blockedReason ?? (!in3d ? 'Switch to 3D to use cockpit perspective.' : cockpitUnavailable(target.layer, record, now));
  const motionEnd = smoothMotion && target.layer === 'aircraft' && record ? passengerMotionEndMs(record) : null;
  const estimating = motionEnd !== null && now > motionEnd - MAX_EXTRAPOLATION_S * 1000;
  return <section className="tracking-controls" aria-label="Tracking camera">
    <div><strong>{mode === 'cockpit' ? 'Cockpit view' : mode === 'passenger' ? 'Passenger view' : 'Following'} · {record?.label ?? target.id}</strong>
      <span className="small muted">{target.layer === 'satellites' ? 'Elements' : record?.props.snapshot === true ? 'Snapshot' : 'Last report'} {relativeTime(record?.observedAt ?? null)}</span>
      {mode === 'follow' && estimating && <span className="small">
        {now < motionEnd ? 'Map position estimated from reported speed and track' : 'Estimate paused · waiting for a new position report'}
      </span>}</div>
    <div className="btn-row">
      <button className={`btn ${mode === 'follow' ? 'primary' : ''}`} aria-pressed={mode === 'follow'} onClick={() => onMode('follow')}>Follow</button>
      {(target.layer === 'aircraft' || target.layer === 'aircraftMil') && <button className={`btn ${mode === 'cockpit' ? 'primary' : ''}`} aria-pressed={mode === 'cockpit'} disabled={!!unavailable} title={unavailable ?? 'Forward camera aligned to reported track/heading'} onClick={() => onMode('cockpit')}>Cockpit</button>}
      {(target.layer === 'aircraft' || target.layer === 'aircraftMil') && <button className={`btn ${mode === 'passenger' ? 'primary' : ''}`} aria-pressed={mode === 'passenger'} disabled={!!unavailable} title={unavailable ?? 'Simulated passenger window view'} onClick={() => onMode('passenger')}>Passenger</button>}
      <button className="btn" onClick={onStop}>Stop tracking</button>
    </div>
    {mode !== 'follow' && interiorStatus === 'loading' && <p role="status" className="small">Loading {mode === 'cockpit' ? '757 cockpit' : 'passenger cabin'} model…</p>}
    {mode !== 'follow' && interiorStatus === 'error' && <p role="alert" className="small">Could not load the {mode === 'cockpit' ? '757 cockpit' : 'passenger cabin'} model. Switch to Follow and try again.</p>}
    {mode === 'passenger' && <div className="passenger-seat-map" role="group" aria-label="Choose a simulated seat">
      <span className="small muted">Choose a seat · approximate cabin layout</span>
      {CABIN_ROWS.map(row => <div className="passenger-seat-row" key={row}>{CABIN_COLUMNS.map((col, index) => {
        const seat = `${row}${col}`;
        return <button key={seat} type="button" className={`btn seat-button ${index === 3 ? 'aisle' : ''} ${passengerSeat === seat ? 'primary' : ''}`} aria-label={`Seat ${seat}`} aria-pressed={passengerSeat === seat} onClick={() => onPassengerSeat(seat)}>{seat}</button>;
      })}</div>)}
    </div>}
    {mode !== 'follow' ? <p className="small muted">Generic simulated interior; drag to look around. Tilt is estimated, not reported aircraft attitude. Esc returns to Follow.</p> : unavailable && (target.layer === 'aircraft' || target.layer === 'aircraftMil') ? <p className="small muted">{unavailable}</p> : null}
    {mode === 'cockpit' && <p className="small muted">757 cockpit by VTX · CC BY-NC-SA 4.0</p>}
    {mode === 'passenger' && <p className="small muted">Airplane interior by Newbie99999993 · CC BY 4.0</p>}
  </section>;
}
