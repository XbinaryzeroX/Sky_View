import { useEffect, useState } from 'react';
import { api, type HostNetStats } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { GlobeDiagnostics } from './Globe';

function fmtHeight(m: number): string {
  if (m >= 100_000) return `${Math.round(m / 1000).toLocaleString()} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** Developer diagnostics for map rendering and tile networking. Polls once per second while open. */
export function DiagnosticsPanel({ get, onClose }: { get(): GlobeDiagnostics | null; onClose(): void }) {
  const [d, setD] = useState<GlobeDiagnostics | null>(null);
  const [net, setNet] = useState<HostNetStats[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      setD(get());
      try {
        const n = await api.netStats();
        if (alive) setNet(n);
      } catch {
        // ignore
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [get]);

  return (
    <div className="diag" role="region" aria-label="Map diagnostics">
      <div className="diag-head">
        <strong>Map diagnostics</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Close diagnostics">
          ✕
        </button>
      </div>
      {!d ? (
        <p className="muted small">Globe not available.</p>
      ) : (
        <>
          <dl className="diag-kv">
            <dt>Camera altitude</dt>
            <dd>{fmtHeight(d.cameraHeightM)}</dd>
            <dt>Camera position</dt>
            <dd>
              {d.cameraLat.toFixed(4)}, {d.cameraLon.toFixed(4)}
            </dd>
            <dt>Deepest tile level drawn</dt>
            <dd>{d.maxRenderedLevel ?? '—'}</dd>
            <dt>Imagery max level here</dt>
            <dd>{d.imageryMaxLevelHere || '—'}</dd>
            <dt>Tiles pending</dt>
            <dd>{d.tilesPending}</dd>
            <dt>Imagery tile errors</dt>
            <dd>
              {d.imageryErrors}
              {d.lastImageryError ? <span className="muted"> · {d.lastImageryError}</span> : null}
            </dd>
          </dl>
          {d.imageryAtLimit && (
            <div className="note" role="status">
              Imagery is at the maximum detail this provider publishes for this area. Zooming further enlarges the same pixels; it does not add detail.
            </div>
          )}
          <div className="diag-sub">Imagery sources</div>
          {d.basemapSources.length === 0 && <p className="muted small">No imagery (neutral surface).</p>}
          {d.basemapSources.map((s) => (
            <div key={s.name} className="diag-src">
              <div>
                <strong>{s.name}</strong> <span className="muted">· {s.provider}</span>
              </div>
              <div className="muted">
                Coverage: {s.coverage} · max level {s.maxLevel} ({s.bestResolution})
              </div>
              <div className="muted">Capture date: {s.captureDate}</div>
              <div className="muted">Terms: {s.terms}</div>
            </div>
          ))}
          <div className="diag-sub">Terrain</div>
          {d.terrain ? (
            <div className="diag-src">
              <div>
                <strong>{d.terrain.name}</strong> <span className="muted">· {d.terrain.provider}</span>
              </div>
              <div className="muted">
                Source max level {d.terrain.maxLevel}; deepest requested {d.terrain.deepestLevelRequested}
                {d.terrain.deepestLevelRequested > d.terrain.maxLevel ? ' (deeper levels resample level 15, no new detail)' : ''}
              </div>
              <div className="muted">Resolution: {d.terrain.bestResolution}</div>
              <div className="muted">
                Tiles: {d.terrain.loaded} loaded · {d.terrain.inFlight} in flight · {d.terrain.failed} failed · last success {relativeTime(d.terrain.lastSuccessAt)}
                {d.terrain.lastError ? ` · last error: ${d.terrain.lastError}` : ''}
              </div>
            </div>
          ) : (
            <p className="muted small">Terrain off (smooth ellipsoid).</p>
          )}
          {d.missingRequirement && (
            <div className="note" role="status">
              {d.missingRequirement}
            </div>
          )}
          <div className="diag-sub">USGS tile handling</div>
          <p className="muted small">
            {d.usgs.imageryTiles} imagery tiles · {d.usgs.noDataTiles} partial no-data PNG tiles (white made transparent) · {d.usgs.blankTiles} blank white JPEG tiles (outside coverage, made transparent)
          </p>
          <div className="diag-sub">Streets, places and buildings (OpenStreetMap via OpenFreeMap)</div>
          <p className="muted small">
            Overlay {d.vector.overlayOn ? 'on' : 'off'} · vector tiles {d.vector.loaded} loaded / {d.vector.failed} failed · last success {relativeTime(d.vector.lastSuccessAt)}
            {d.vector.lastError ? ` · last error: ${d.vector.lastError}` : ''}
          </p>
          <p className="muted small">
            3D buildings {d.buildings.enabled ? (d.buildings.visible ? 'shown' : `enabled (appear below ${(d.buildings.maxCameraM / 1000).toFixed(0)} km)`) : 'off'} · {d.buildings.buildingsDrawn.toLocaleString()} footprints in {d.buildings.tilesLoaded} tiles · heights from OSM tags where present, otherwise estimated
            {d.buildings.lastError ? ` · last error: ${d.buildings.lastError}` : ''}
          </p>
          <div className="diag-sub">Vehicle 3D models</div>
          <p className="muted small">
            Model pack: {d.models.pack.state === 'ready' ? `${d.models.pack.models} real models${d.models.pack.rejected ? ` (${d.models.pack.rejected} invalid entries skipped)` : ''}` : d.models.pack.state === 'none' ? 'not installed (app-built models only)' : d.models.pack.state === 'error' ? `failed to load (${d.models.pack.error})` : 'loading'} · {d.models.shown} shown · {d.models.loaded} loaded · {d.models.failed} failed
            {d.models.lastError ? ` · last error: ${d.models.lastError}` : ''}
            {' · '}sea-level grid (ship and parked-aircraft heights on Photoreal 3D): {d.models.geoid.state === 'error' ? `failed to load (${d.models.geoid.error}); those vehicles stay icons there` : d.models.geoid.state}
          </p>
          <div className="diag-sub">Network (renderer tile requests)</div>
          <table className="diag-table">
            <thead>
              <tr>
                <th>Host</th>
                <th>Req</th>
                <th>OK</th>
                <th>Fail</th>
                <th>Cancel</th>
                <th>Last success</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {net.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No tile requests yet.
                  </td>
                </tr>
              )}
              {net.map((n) => (
                <tr key={n.host}>
                  <td>{n.host}</td>
                  <td>{n.requests}</td>
                  <td>{n.ok}</td>
                  <td className={n.failed ? 'warn-text' : ''}>{n.failed}</td>
                  <td>{n.cancelled}</td>
                  <td>{relativeTime(n.lastSuccessAt)}</td>
                  <td className="muted">{n.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">HTTP 404 from USGS means “outside coverage or beyond the published level” and is counted as OK. 401/403/429 indicate authentication or quota problems.</p>
        </>
      )}
    </div>
  );
}
