import { LAYER_IDS, LAYERS, TEMPORAL_LABEL, type LayerGroup, type LayerId, type LayerSnapshot } from '../../shared/layers';
import type { Settings } from '../../shared/types';
import { api } from '../lib/api';
import { FRESHNESS_META, relativeTime } from '../lib/format';

const GROUPS: LayerGroup[] = ['Movement', 'Space', 'Hazards', 'Weather', 'Cameras', 'Reference'];

interface Props {
  settings: Settings;
  snaps: Partial<Record<LayerId, LayerSnapshot>>;
  onPatch(p: Partial<Settings>): void;
}

export function LayersPanel({ settings, snaps, onPatch }: Props) {
  const on = new Set(settings.layersEnabled);
  const toggle = (id: LayerId) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPatch({ layersEnabled: LAYER_IDS.filter((l) => next.has(l)) });
  };
  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Data layers</h2>
      </div>
      {GROUPS.map((g) => (
        <div key={g} className="layer-group">
          <div className="layer-group-title">{g}</div>
          {LAYER_IDS.filter((id) => LAYERS[id].group === g).map((id) => {
            const meta = LAYERS[id];
            const st = snaps[id]?.status;
            const enabled = on.has(id);
            const fr = st && enabled ? FRESHNESS_META[st.freshness] : null;
            return (
              <div key={id} className={`layer-row ${enabled ? 'on' : ''}`}>
                <label className="layer-toggle" title={`${meta.temporalNote}\nSource: ${meta.source}\nTerms: ${meta.license}\nCoverage: ${meta.coverage}\nAuth: ${meta.auth}`}>
                  <input type="checkbox" checked={enabled} onChange={() => toggle(id)} />
                  <span className="layer-name">{meta.name}</span>
                  <span className={`temporal t-${meta.temporal}`}>{TEMPORAL_LABEL[meta.temporal]}</span>
                </label>
                {enabled && st && (
                  <div className="layer-status small">
                    {st.state === 'loading' ? (
                      <span className="muted">Loading…</span>
                    ) : st.state === 'error' && !st.lastSuccessAt ? (
                      <span className="err-text">Request failed: {st.error}</span>
                    ) : (
                      <>
                        {fr && (
                          <span className={`mini-chip ${fr.cls}`}>
                            <span aria-hidden="true">{fr.icon}</span> {fr.label}
                          </span>
                        )}{' '}
                        <span>{st.recordCount.toLocaleString()} records</span>
                        <span className="muted"> · fetched {relativeTime(st.lastSuccessAt)}</span>
                        {st.state === 'error' && <div className="err-text">Last refresh failed: {st.error} (showing previous data)</div>}
                      </>
                    )}
                    {st.note && <div className="muted">{st.note}</div>}
                    <button className="link-btn small" onClick={() => void api.refreshLayer(id)}>
                      Refresh
                    </button>
                    {id === 'fires' && (
                      <select className="inline-select" aria-label="Fire detection region" value={settings.firmsRegion} onChange={(e) => onPatch({ firmsRegion: e.target.value as Settings['firmsRegion'] })}>
                        <option value="us">U.S. (CONUS, HI, AK)</option>
                        <option value="global">Global (≈5 MB per refresh)</option>
                      </select>
                    )}
                  </div>
                )}
                {enabled && id === 'satellites' && (
                  <div className="sat-groups small">
                    {(['stations', 'visual', 'gnss', 'weather', 'science', 'starlink'] as const).map((sg) => (
                      <label key={sg}>
                        <input
                          type="checkbox"
                          checked={settings.satelliteGroups.includes(sg)}
                          onChange={(e) => onPatch({ satelliteGroups: e.target.checked ? [...settings.satelliteGroups, sg] : settings.satelliteGroups.filter((x) => x !== sg) })}
                        />{' '}
                        {sg === 'stations' ? 'Space stations' : sg === 'visual' ? 'Brightest' : sg === 'gnss' ? 'GNSS' : sg === 'weather' ? 'Weather' : sg === 'science' ? 'Science' : 'Starlink (≈8,000)'}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {g === 'Weather' && (
            <div className={`layer-row ${settings.radarEnabled ? 'on' : ''}`}>
              <label className="layer-toggle" title="NOAA nowCOAST observed base-reflectivity radar mosaic (CONUS, Alaska, Hawaii, Puerto Rico). Refreshed every 5 minutes while on. Public domain.">
                <input type="checkbox" checked={settings.radarEnabled} onChange={(e) => onPatch({ radarEnabled: e.target.checked })} />
                <span className="layer-name">Weather radar (U.S.)</span>
                <span className="temporal t-delayed">{TEMPORAL_LABEL.delayed}</span>
              </label>
              {settings.radarEnabled && <div className="layer-status small muted">Latest nowCOAST mosaic, typically 5–10 minutes old. Refreshes every 5 min.</div>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
