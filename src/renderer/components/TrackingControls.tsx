import { useEffect, useState } from 'react';
import type { GeoRecord, LayerId } from '../../shared/layers';
import { MAX_EXTRAPOLATION_S, passengerMotionEndMs } from '../../shared/aircraft';
import { cockpitUnavailable, type TrackingMode } from '../../shared/trackingCamera';
import { relativeTime } from '../lib/format';
import './TrackingControls.css';

export function TrackingControls({ target, record, mode, in3d, smoothMotion, blockedReason, onMode, onStop }: {
  target: { layer: LayerId; id: string }; record: GeoRecord | null; mode: TrackingMode; in3d: boolean;
  smoothMotion: boolean; blockedReason?: string | null; onMode(mode: TrackingMode): void; onStop(): void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (mode !== 'cockpit') return;
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
    <div><strong>{mode === 'cockpit' ? 'Cockpit perspective' : 'Following'} · {record?.label ?? target.id}</strong>
      <span className="small muted">{target.layer === 'satellites' ? 'Elements' : record?.props.snapshot === true ? 'Snapshot' : 'Last report'} {relativeTime(record?.observedAt ?? null)}</span>
      {mode === 'follow' && estimating && <span className="small">
        {now < motionEnd ? 'Map position estimated from reported speed and track' : 'Estimate paused · waiting for a new position report'}
      </span>}</div>
    <div className="btn-row">
      <button className={`btn ${mode === 'follow' ? 'primary' : ''}`} aria-pressed={mode === 'follow'} onClick={() => onMode('follow')}>Follow</button>
      {(target.layer === 'aircraft' || target.layer === 'aircraftMil') && <button className={`btn ${mode === 'cockpit' ? 'primary' : ''}`} aria-pressed={mode === 'cockpit'} disabled={!!unavailable} title={unavailable ?? 'Forward camera aligned to reported track/heading'} onClick={() => onMode('cockpit')}>Cockpit</button>}
      <button className="btn" onClick={onStop}>Stop tracking</button>
    </div>
    {mode === 'cockpit' ? <p className="small muted">Simulated camera along reported {record?.props.directionSource === 'true-heading' ? 'true heading' : record?.props.directionSource === 'ground-track' ? 'ground track' : 'track/heading'}; fixed pitch and roll. Ground-track estimates stop after 45 s. Aircraft/vessel symbols within 75 km. Esc returns to Follow.</p> : unavailable && (target.layer === 'aircraft' || target.layer === 'aircraftMil') ? <p className="small muted">{unavailable}</p> : null}
  </section>;
}
