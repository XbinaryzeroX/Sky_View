import { useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/ipc';
import type { AiStatus, Settings } from '../../shared/types';
import { api, errorText } from '../lib/api';
import { Modal } from './common';
import { BASEMAPS } from '../map/basemaps';

export function SettingsDialog({ settings, onClose }: { settings: Settings; onClose(): void }) {
  const [s, setS] = useState<Settings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS({ ...s, [k]: v });
    setSaved(false);
  };

  async function save() {
    try {
      const patch: Partial<Settings> = {};
      for (const k of Object.keys(s) as (keyof Settings)[]) if (s[k] !== settings[k]) (patch as Record<string, unknown>)[k] = s[k];
      await api.updateSettings(patch);
      setSaved(true);
      setError(null);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function testAi() {
    setTesting(true);
    try {
      // Save AI toggles first so the main process tests the right port.
      await api.updateSettings({ aiEnabled: true, ollamaPort: s.ollamaPort });
      setS({ ...s, aiEnabled: true });
      setAi(await api.aiStatus());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(false);
    }
  }

  const num = (v: string) => (v === '' ? NaN : Number(v));

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          {saved && <span className="muted small">Saved</span>}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save settings
          </button>
        </>
      }
    >
      {error && <div className="error-line">{error}</div>}
      <div className="settings-grid">
        <section>
          <h3 className="sub">Data feeds</h3>
          <label className="field">
            <span>Contact for NWS User-Agent (optional)</span>
            <input value={s.nwsContact} onChange={(e) => set('nwsContact', e.target.value)} placeholder="e.g. yourcompany.com or ops@yourcompany.com" maxLength={120} />
            <small className="muted">NWS asks applications to identify themselves. A website or email lets NWS contact you if there is a problem. It is sent only to api.weather.gov.</small>
          </label>
          <div className="field-row">
            <label className="field">
              <span>NWS refresh (seconds)</span>
              <input type="number" min={60} max={3600} value={s.nwsPollSeconds} onChange={(e) => set('nwsPollSeconds', num(e.target.value))} />
            </label>
            <label className="field">
              <span>USGS refresh (seconds)</span>
              <input type="number" min={60} max={3600} value={s.usgsPollSeconds} onChange={(e) => set('usgsPollSeconds', num(e.target.value))} />
            </label>
          </div>
          <small className="muted">Minimum 60 seconds. Failed requests back off automatically, and provider rate limits are respected.</small>
          <label className="check">
            <input type="checkbox" checked={s.zoneLookupEnabled} onChange={(e) => set('zoneLookupEnabled', e.target.checked)} /> Look up NWS zones for saved locations
          </label>
          <small className="muted">This lets Atlas Watch check alerts that have no polygon. Each location's coordinates are sent to api.weather.gov about once a month. If it is off, those alerts show as “cannot determine”.</small>
        </section>
        <section>
          <h3 className="sub">Event history</h3>
          <div className="field-row">
            <label className="field">
              <span>Keep records for (days)</span>
              <input type="number" min={1} max={365} value={s.historyRetentionDays} onChange={(e) => set('historyRetentionDays', num(e.target.value))} />
            </label>
            <label className="field">
              <span>Maximum records</span>
              <input type="number" min={100} max={50000} value={s.historyMaxRecords} onChange={(e) => set('historyMaxRecords', num(e.target.value))} />
            </label>
          </div>
          <h3 className="sub">Display</h3>
          <label className="field">
            <span>Globe surface</span>
            <select value={s.basemap} onChange={(e) => set('basemap', e.target.value as Settings['basemap'])}>
              {Object.values(BASEMAPS).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <small className="muted">{BASEMAPS[s.basemap]?.description}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.labelsOverlay} onChange={(e) => set('labelsOverlay', e.target.checked)} /> Roads and boundaries over imagery (OpenStreetMap, worldwide)
          </label>
          <h3 className="sub">Labels</h3>
          <div className="field-row">
            <label className="field">
              <span>Place names</span>
              <select value={s.geoLabels} onChange={(e) => set('geoLabels', e.target.value as Settings['geoLabels'])}>
                <option value="off">Off</option>
                <option value="minimal">Minimal (countries, major cities)</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed (villages, neighbourhoods)</option>
              </select>
            </label>
            <label className="field">
              <span>Label density</span>
              <select value={s.labelDensity} onChange={(e) => set('labelDensity', e.target.value as Settings['labelDensity'])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field">
              <span>Text size</span>
              <select value={s.labelSize} onChange={(e) => set('labelSize', e.target.value as Settings['labelSize'])}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Name language</span>
              <select value={s.labelLanguage} onChange={(e) => set('labelLanguage', e.target.value as Settings['labelLanguage'])}>
                <option value="english">English where available</option>
                <option value="local">Local script (e.g. 東京, القاهرة)</option>
              </select>
            </label>
            <label className="field">
              <span>Aircraft labels</span>
              <select value={s.aircraftLabels} onChange={(e) => set('aircraftLabels', e.target.value as Settings['aircraftLabels'])}>
                <option value="selected">Selected only</option>
                <option value="hovered">Selected and hovered</option>
                <option value="all">All visible (nearby)</option>
              </select>
            </label>
            <label className="field">
              <span>Vessel labels</span>
              <select value={s.vesselLabels} onChange={(e) => set('vesselLabels', e.target.value as Settings['vesselLabels'])}>
                <option value="selected">Selected only</option>
                <option value="hovered">Selected and hovered</option>
                <option value="all">All visible (nearby)</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.streetLabels} onChange={(e) => set('streetLabels', e.target.checked)} /> Street names when zoomed in (below about 3 km)
          </label>
          <button
            className="btn"
            type="button"
            onClick={() => {
              for (const k of ['geoLabels', 'streetLabels', 'labelDensity', 'labelSize', 'labelLanguage', 'aircraftLabels', 'vesselLabels'] as const) set(k, DEFAULT_SETTINGS[k] as never);
            }}
          >
            Reset label defaults
          </button>
          <label className="check">
            <input type="checkbox" checked={s.buildings3d} onChange={(e) => set('buildings3d', e.target.checked)} /> 3D buildings below 4 km altitude (OpenStreetMap footprints; heights may be estimated)
          </label>
          <div className="field-row">
            <label className="field">
              <span>Units</span>
              <select value={s.units} onChange={(e) => set('units', e.target.value as Settings['units'])}>
                <option value="metric">Metric (km, m, km/h)</option>
                <option value="imperial">Imperial (mi, ft, mph)</option>
                <option value="nautical">Aviation/marine (nm, ft, kt)</option>
              </select>
            </label>
            <label className="field">
              <span>Organization name (shown on briefings)</span>
              <input value={s.orgName} maxLength={120} onChange={(e) => set('orgName', e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Home latitude (for Near me / overhead)</span>
              <input value={s.homeLat ?? ''} inputMode="decimal" onChange={(e) => set('homeLat', e.target.value === '' ? null : Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Home longitude</span>
              <input value={s.homeLon ?? ''} inputMode="decimal" onChange={(e) => set('homeLon', e.target.value === '' ? null : Number(e.target.value))} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.smoothMotion} onChange={(e) => set('smoothMotion', e.target.checked)} /> Smooth aircraft motion between reports (estimated positions, max 45 s, clearly marked)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.buildingFacades} onChange={(e) => set('buildingFacades', e.target.checked)} /> Stylized window façades on 3D buildings (decorative pattern, not the real building’s windows or floors)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.evenOcean} onChange={(e) => set('evenOcean', e.target.checked)} /> Even out open-ocean water on Google, Esri, Mapbox and EOX imagery (draws one smoothed sea more than 1.5 km offshore)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.terrainEnabled} onChange={(e) => set('terrainEnabled', e.target.checked)} /> 3D terrain (keyless Terrain Tiles on AWS)
          </label>
          <label className="check">
            <input type="checkbox" checked={s.reducedMotion} onChange={(e) => set('reducedMotion', e.target.checked)} /> Reduce motion (no camera fly animations)
          </label>
        </section>
        <section className="span-2">
          <h3 className="sub">Optional local AI (Ollama)</h3>
          <p className="muted small">
            Atlas Watch is fully usable without AI. If you have installed <strong>Ollama</strong> yourself and downloaded a model, Atlas Watch can ask it to explain the computed results. It connects only to this
            computer (127.0.0.1). Models are never downloaded automatically. Local models need a capable CPU/GPU and enough memory. Answers can be wrong; always check the linked source records.
          </p>
          <div className="field-row">
            <label className="check">
              <input type="checkbox" checked={s.aiEnabled} onChange={(e) => set('aiEnabled', e.target.checked)} /> Enable local AI assistant
            </label>
            <label className="field">
              <span>Ollama port on 127.0.0.1</span>
              <input type="number" min={1} max={65535} value={s.ollamaPort} onChange={(e) => set('ollamaPort', num(e.target.value))} />
            </label>
            <button className="btn" onClick={() => void testAi()} disabled={testing}>
              {testing ? 'Checking…' : 'Check connection'}
            </button>
          </div>
          {ai && (
            <div className={ai.reachable ? 'note ok' : 'note'} role="status">
              {ai.reachable ? `Connected to ${ai.endpoint}. ${ai.models.length} model(s) installed.` : `Not connected: ${ai.error}`}
            </div>
          )}
          <label className="field">
            <span>Model</span>
            <select value={s.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)}>
              <option value="">— choose an installed model —</option>
              {[...new Set([...(ai?.models ?? []), ...(s.ollamaModel ? [s.ollamaModel] : [])])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>
    </Modal>
  );
}
