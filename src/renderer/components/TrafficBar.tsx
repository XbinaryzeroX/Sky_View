import { useState } from 'react';
import { ALTITUDE_STOPS, specialCode, type AircraftClass, type AircraftFilter } from '../../shared/aircraft';
import type { GeoRecord } from '../../shared/layers';
import { relativeTime } from '../lib/format';

const CLASSES: { id: AircraftClass; label: string }[] = [
  { id: 'airliner', label: 'Large/heavy' },
  { id: 'light', label: 'Light' },
  { id: 'rotorcraft', label: 'Rotorcraft' },
  { id: 'military', label: 'Military flag' },
  { id: 'ground', label: 'On ground' },
  { id: 'other', label: 'Other/unknown' },
];
const VESSELS = ['cargo', 'tanker', 'passenger', 'fishing', 'other'];
const ALT_OPTIONS = [0, 1000, 5000, 10000, 20000, 30000, 40000, 60000];

/** Altitude legend + filters for aircraft, class filters for vessels, and the special-code panel. */
export function TrafficBar(p: {
  aircraftOn: boolean;
  vesselsOn: boolean;
  filter: AircraftFilter;
  onFilter(f: AircraftFilter): void;
  vesselClasses: string[];
  onVesselClasses(v: string[]): void;
  aircraft: GeoRecord[];
  onSelectAircraft(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [emOpen, setEmOpen] = useState(false);
  const specials = p.aircraft.filter((r) => specialCode(r));
  if (!p.aircraftOn && !p.vesselsOn) return null;
  const grad = `linear-gradient(90deg, ${ALTITUDE_STOPS.map((s, i) => `${s.color} ${(i / (ALTITUDE_STOPS.length - 1)) * 100}%`).join(', ')})`;
  return (
    <div className="traffic-bar">
      {p.aircraftOn && (
        <>
          <div className="alt-legend" title="Aircraft color = reported barometric altitude">
            <span>GND</span>
            <span className="alt-ramp" style={{ background: grad }} />
            <span>FL400+</span>
          </div>
          <button className={`btn small-btn ${open ? 'primary' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
            Filters
          </button>
          <button className={`btn small-btn ${specials.length ? 'danger' : ''}`} onClick={() => setEmOpen(!emOpen)} aria-expanded={emOpen} title="Aircraft reporting 7500/7600/7700 or an emergency status">
            Special codes {specials.length}
          </button>
        </>
      )}
      {open && (
        <div className="traffic-pop">
          {p.aircraftOn && (
            <>
              <div className="diag-sub">Aircraft altitude</div>
              <div className="btn-row">
                <select value={p.filter.minFt} onChange={(e) => p.onFilter({ ...p.filter, minFt: Number(e.target.value) })} aria-label="Minimum altitude">
                  {ALT_OPTIONS.slice(0, -1).map((a) => (
                    <option key={a} value={a}>
                      from {a === 0 ? 'ground' : `${a.toLocaleString()} ft`}
                    </option>
                  ))}
                </select>
                <select value={p.filter.maxFt} onChange={(e) => p.onFilter({ ...p.filter, maxFt: Number(e.target.value) })} aria-label="Maximum altitude">
                  {ALT_OPTIONS.slice(1).map((a) => (
                    <option key={a} value={a}>
                      to {a >= 60000 ? 'any' : `${a.toLocaleString()} ft`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="diag-sub">Aircraft type (from transponder category / database flag)</div>
              <div className="chip-row">
                {CLASSES.map((c) => (
                  <label key={c.id} className="check small">
                    <input
                      type="checkbox"
                      checked={p.filter.classes.includes(c.id)}
                      onChange={(e) => p.onFilter({ ...p.filter, classes: e.target.checked ? [...p.filter.classes, c.id] : p.filter.classes.filter((x) => x !== c.id) })}
                    />{' '}
                    {c.label}
                  </label>
                ))}
              </div>
              <label className="check small">
                <input type="checkbox" checked={p.filter.specialOnly} onChange={(e) => p.onFilter({ ...p.filter, specialOnly: e.target.checked })} /> Only aircraft reporting special codes
              </label>
            </>
          )}
          {p.vesselsOn && (
            <>
              <div className="diag-sub">Vessel type (self-reported over AIS)</div>
              <div className="chip-row">
                {VESSELS.map((v) => (
                  <label key={v} className="check small">
                    <input type="checkbox" checked={p.vesselClasses.includes(v)} onChange={(e) => p.onVesselClasses(e.target.checked ? [...p.vesselClasses, v] : p.vesselClasses.filter((x) => x !== v))} /> {v}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {emOpen && p.aircraftOn && (
        <div className="traffic-pop emergency">
          <div className="diag-sub">Special codes reported ({specials.length})</div>
          <p className="muted small">Transponder reports from loaded aircraft. A code can be set by mistake or briefly; it is not a confirmed incident.</p>
          {specials.length === 0 ? (
            <p className="muted small">None in the loaded data.</p>
          ) : (
            <ul className="rec-list">
              {specials.map((r) => (
                <li key={r.id}>
                  <button className="rec-item" onClick={() => p.onSelectAircraft(r.id)}>
                    <span className="tag sev-extreme">{String(r.props.squawk ?? r.props.emergency)}</span>
                    <span className="rec-title">{r.label}</span>
                    <span className="rec-meta">
                      {specialCode(r)!.label} · reported {relativeTime(r.observedAt)} · {typeof r.props.altitudeFt === 'number' ? `${r.props.altitudeFt.toLocaleString()} ft` : r.props.onGround ? 'ground' : '—'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
