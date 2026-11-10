import { useMemo, useState } from 'react';
import type { AlertSeverity, AppSnapshot, SavedLocation, WeatherAlert } from '../../shared/types';
import { severityRank } from '../../shared/monitoring';
import { SEVERITY_META, SEVERITY_ORDER } from '../lib/format';
import { Empty } from './common';
import type { GlobeLayers } from './Globe';

interface Props {
  mode?: 'all' | 'places' | 'alerts';
  snap: AppSnapshot;
  search: string;
  selectedLocationId: string | null;
  severityFilter: Set<AlertSeverity>;
  onSeverityFilter(s: Set<AlertSeverity>): void;
  layers: GlobeLayers;
  onLayers(l: GlobeLayers): void;
  alertsAffectingOnly: boolean;
  onAlertsAffectingOnly(v: boolean): void;
  onSelectLocation(id: string): void;
  onAdd(): void;
  onImport(): void;
  onExport(): void;
  onSettingsPatch(p: Partial<AppSnapshot['settings']>): void;
  children?: React.ReactNode;
}

export function locationSummary(snap: AppSnapshot, loc: SavedLocation, severityFilter: Set<AlertSeverity>, alertsById: Map<string, WeatherAlert>) {
  const ev = snap.evaluations[loc.id];
  if (!ev) return { inside: 0, top: null as AlertSeverity | null, unknown: 0, quakes: 0, ev };
  const inside = ev.alertsInside.map((m) => alertsById.get(m.alertId)).filter((a): a is WeatherAlert => !!a && severityFilter.has(a.severity));
  const top = inside.reduce<AlertSeverity | null>((acc, a) => (acc === null || severityRank(a.severity) > severityRank(acc) ? a.severity : acc), null);
  return { inside: inside.length, top, unknown: ev.alertsUnknown.length, quakes: ev.quakesNearby.length, ev };
}

export function LeftPanel(p: Props) {
  const { snap } = p;
  const [category, setCategory] = useState('all');
  const alertsById = useMemo(() => new Map(snap.alerts.map((a) => [a.id, a])), [snap.alerts]);
  const categories = useMemo(() => [...new Set(snap.locations.map((l) => l.category).filter(Boolean))].sort(), [snap.locations]);

  const rows = useMemo(() => {
    const q = p.search.trim().toLowerCase();
    return snap.locations
      .filter((l) => (category === 'all' ? true : l.category === category))
      .filter((l) => !q || `${l.name} ${l.category} ${l.notes}`.toLowerCase().includes(q))
      .map((l) => ({ loc: l, s: locationSummary(snap, l, p.severityFilter, alertsById) }))
      .sort((a, b) => (b.s.top ? severityRank(b.s.top) + 1 : 0) - (a.s.top ? severityRank(a.s.top) + 1 : 0) || a.loc.name.localeCompare(b.loc.name));
  }, [snap, category, p.search, p.severityFilter, alertsById]);

  const toggleSeverity = (s: AlertSeverity) => {
    const next = new Set(p.severityFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    p.onSeverityFilter(next);
  };
  const layer = (k: keyof GlobeLayers) => p.onLayers({ ...p.layers, [k]: !p.layers[k] });
  const affected = rows.filter((r) => r.s.inside > 0).length;

  return (
    <aside className="panel left-panel" aria-label="Saved locations and layers">
      {p.mode !== 'alerts' && <section className="panel-section grow">
        <div className="section-head">
          <h2>Saved locations</h2>
          <span className="count">{snap.locations.length}</span>
        </div>
        <div className="btn-row">
          <button className="btn primary" onClick={p.onAdd}>
            + Add
          </button>
          <button className="btn" onClick={p.onImport}>
            Import CSV
          </button>
          <button className="btn" onClick={p.onExport} disabled={snap.locations.length === 0}>
            Export
          </button>
        </div>
        {categories.length > 0 && (
          <label className="field inline">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        {snap.locations.length > 0 && (
          <div className="muted small summary-line">
            {affected > 0 ? (
              <>
                <strong className="warn-text">{affected}</strong> of {rows.length} shown with confirmed alerts
              </>
            ) : (
              <>{rows.length} shown · none with confirmed alerts</>
            )}
          </div>
        )}
        <ul className="loc-list" role="list">
          {snap.locations.length === 0 && (
            <Empty>
              <p>No saved locations yet.</p>
              <p className="small">Add a property or business location, pick one on the globe, or import a CSV.</p>
            </Empty>
          )}
          {snap.locations.length > 0 && rows.length === 0 && <Empty>No locations match the current filter.</Empty>}
          {rows.map(({ loc, s }) => (
            <li key={loc.id}>
              <button className={`loc-item ${p.selectedLocationId === loc.id ? 'selected' : ''}`} onClick={() => p.onSelectLocation(loc.id)} aria-pressed={p.selectedLocationId === loc.id}>
                <span className="loc-name">{loc.name}</span>
                <span className="loc-meta">
                  {loc.category || 'Uncategorized'} · {loc.radiusKm} km
                </span>
                <span className="loc-badges">
                  {s.ev?.nwsFreshness === 'unavailable' ? (
                    <span className="badge muted-badge" title="Weather alert data unavailable">
                      Alerts ?
                    </span>
                  ) : s.inside > 0 && s.top ? (
                    <span className={`badge ${SEVERITY_META[s.top].cls}`} title={`${s.inside} confirmed alert(s); highest severity ${s.top}`}>
                      <span aria-hidden="true">{SEVERITY_META[s.top].icon}</span> {s.inside} alert{s.inside === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className="badge ok-badge" title="No confirmed alerts at this point">
                      No alerts
                    </span>
                  )}
                  {s.unknown > 0 && (
                    <span className="badge muted-badge" title={`${s.unknown} alert(s) could not be evaluated for this location`}>
                      ? {s.unknown}
                    </span>
                  )}
                  {s.ev?.usgsFreshness !== 'unavailable' && s.quakes > 0 && (
                    <span className="badge quake-badge" title={`${s.quakes} earthquake epicenter(s) within ${loc.radiusKm} km`}>
                      ◎ {s.quakes}
                    </span>
                  )}
                  {(s.ev?.nwsFreshness === 'stale' || s.ev?.usgsFreshness === 'stale') && (
                    <span className="badge stale-badge" title="Based on stale data">
                      stale
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>}

      {p.mode !== 'places' && <section className="panel-section">
        <div className="section-head">
          <h2>Alerts &amp; earthquakes</h2>
        </div>
        <div className="checks">
          <label>
            <input type="checkbox" role="switch" className="layer-switch" checked={p.layers.alerts} onChange={() => layer('alerts')} /> Weather alert polygons
          </label>
          <label>
            <input type="checkbox" role="switch" className="layer-switch" checked={p.layers.quakes} onChange={() => layer('quakes')} /> Earthquakes
          </label>
          <label>
            <input type="checkbox" role="switch" className="layer-switch" checked={p.layers.locations} onChange={() => layer('locations')} /> Saved locations
          </label>
          <label>
            <input type="checkbox" role="switch" className="layer-switch" checked={p.layers.radii} onChange={() => layer('radii')} disabled={!p.layers.locations} /> Monitoring radii
          </label>
          <label>
            <input type="checkbox" role="switch" className="layer-switch" checked={p.layers.boundaries} onChange={() => layer('boundaries')} /> State &amp; country boundaries
          </label>
        </div>
        <fieldset className="sev-filter">
          <legend>Alert severity</legend>
          {SEVERITY_ORDER.map((s) => (
            <label key={s} className={`sev-check ${SEVERITY_META[s].cls}`}>
              <input type="checkbox" checked={p.severityFilter.has(s)} onChange={() => toggleSeverity(s)} />
              <span aria-hidden="true">{SEVERITY_META[s].icon}</span> {s}
            </label>
          ))}
        </fieldset>
        <div className="checks">
          <label>
            <input type="checkbox" checked={p.alertsAffectingOnly} onChange={(e) => p.onAlertsAffectingOnly(e.target.checked)} /> Only alerts affecting saved locations
          </label>
          <label>
            <input type="checkbox" checked={snap.settings.quakesNearLocationsOnly} onChange={(e) => p.onSettingsPatch({ quakesNearLocationsOnly: e.target.checked })} /> Only earthquakes within a location radius
          </label>
        </div>
        <div className="quake-controls">
          <label className="field inline">
            <span>Earthquake window</span>
            <select value={snap.settings.quakeWindow} onChange={(e) => p.onSettingsPatch({ quakeWindow: e.target.value as AppSnapshot['settings']['quakeWindow'] })}>
              <option value="hour">Past hour</option>
              <option value="day">Past day</option>
              <option value="week">Past 7 days</option>
              <option value="month">Past 30 days</option>
            </select>
          </label>
          <label className="field inline">
            <span>Min magnitude</span>
            <select value={String(snap.settings.quakeMinMagnitude)} onChange={(e) => p.onSettingsPatch({ quakeMinMagnitude: Number(e.target.value) })}>
              {[-1, 1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6].map((m) => (
                <option key={m} value={m}>
                  {m === -1 ? 'All' : `M${m}+`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>}
      {p.children}
    </aside>
  );
}
