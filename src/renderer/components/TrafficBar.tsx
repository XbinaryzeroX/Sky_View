import { useState } from 'react';
import { AIRCRAFT_ROLE_COLOR, AIRCRAFT_ROLE_LABEL, specialCode, type AircraftClass, type AircraftFilter } from '../../shared/aircraft';
import type { GeoRecord } from '../../shared/layers';
import { relativeTime } from '../lib/format';

const CLASSES: { id: AircraftClass; label: string }[] = [
  { id: 'airliner', label: 'Large/heavy' },
  { id: 'light', label: 'Light' },
  { id: 'rotorcraft', label: 'Rotorcraft' },
  { id: 'fighter', label: 'Fighter / attack jet (type code)' },
  { id: 'military', label: 'Military flag' },
  { id: 'ground', label: 'On ground' },
  { id: 'other', label: 'Other/unknown' },
];
const VESSELS = ['cargo', 'tanker', 'passenger', 'fishing', 'other'];
const ALL_CLASSES = CLASSES.map((c) => c.id);
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
  return (
    <div className="traffic-bar">
      {p.aircraftOn && (
        <>
          <div className="alt-legend" title="Aircraft colour: airliners white (by type or ADS-B size category; includes cargo airliners), military yellow, all others blue. Altitude is in each aircraft's label and details.">
            {(['airliner', 'military', 'other'] as const).map((role) => (
              <span key={role} className="role-key"><i style={{ background: AIRCRAFT_ROLE_COLOR[role] }} aria-hidden="true" />{AIRCRAFT_ROLE_LABEL[role]}</span>
            ))}
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
              <div className="btn-row">
                <button className={`btn small-btn ${p.filter.classes.length === 1 && p.filter.classes[0] === 'fighter' ? 'primary' : ''}`} onClick={() => p.onFilter({ ...p.filter, classes: ['fighter'], minFt: 0, maxFt: 60000, specialOnly: false })}>Fighter jets only</button>
                <button className={`btn small-btn ${p.filter.classes.length === 2 && p.filter.classes.includes('fighter') && p.filter.classes.includes('military') ? 'primary' : ''}`} onClick={() => p.onFilter({ ...p.filter, classes: ['fighter', 'military'], minFt: 0, maxFt: 60000, specialOnly: false })}>All military</button>
                <button className="btn small-btn" onClick={() => p.onFilter({ ...p.filter, classes: ALL_CLASSES, minFt: 0, maxFt: 60000, specialOnly: false })}>Show all</button>
              </div>
              <p className="muted small">Fighters are found by the type code in the receiver network’s aircraft database. Most military jets do not broadcast a position, so this shows only those that do; turn on Military-flagged aircraft for worldwide coverage.</p>
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
              <div className="btn-row">
                <button className={`btn small-btn ${p.vesselClasses.length === 1 && p.vesselClasses[0] === 'tanker' ? 'primary' : ''}`} onClick={() => p.onVesselClasses(['tanker'])}>Tankers only</button>
                <button className="btn small-btn" onClick={() => p.onVesselClasses(VESSELS)}>Show all</button>
              </div>
              <p className="muted small">Tankers are AIS ship types 80–89 (oil, chemical and gas tankers as reported by the ship). Without a key, vessel positions cover Finnish and northern Baltic waters; add a free AISStream key in Providers for the area you are viewing.</p>
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
