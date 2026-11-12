import { useEffect, useState } from 'react';
import type { LayerId, LayerSnapshot } from '../../shared/layers';
import { VISUAL_MODE_LABEL, type VisualMode } from '../map/visualModes';
import type { GlobeDiagnostics } from './Globe';
import { warningMapRecords } from '../map/warningGeometry';

/** Heads-up readout: UTC time, camera position/altitude, and live layer counts. Values only; no inferred "intelligence". */
export function Hud({ get, snaps, layersOn, mode, playbackTime, playbackActive }: { get(): GlobeDiagnostics | null; snaps: Partial<Record<LayerId, LayerSnapshot>>; layersOn: LayerId[]; mode: VisualMode; playbackTime: string | null; playbackActive: boolean }) {
  const [d, setD] = useState<GlobeDiagnostics | null>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => {
      setD(get());
      setNow(new Date());
    }, 500);
    return () => clearInterval(t);
  }, [get]);
  const h = d?.cameraHeightM ?? 0;
  const alt = h >= 100_000 ? `${Math.round(h / 1000).toLocaleString()} km` : h >= 1000 ? `${(h / 1000).toFixed(1)} km` : `${Math.round(h)} m`;
  const counts = (playbackActive ? [] : layersOn)
    .map((l) => ({ l, n: l === 'dwd' && snaps.dwd ? warningMapRecords(snaps.dwd).length : snaps[l]?.records.length ?? 0, total: snaps[l]?.status.recordCount ?? 0 }))
    .filter((x) => x.n > 0 || (x.l === 'dwd' && x.total > 0))
    .map(({ l, n, total }) => l === 'dwd' ? `DWD ${n.toLocaleString()} mapped / ${total.toLocaleString()} total` : `${l === 'aircraftMil' ? 'MIL' : l.toUpperCase()} ${n.toLocaleString()}`);
  return (
    <div className="hud" aria-live="off">
      <span>{playbackActive ? playbackTime ? `PLAYBACK ${playbackTime.replace('T', ' ').slice(0, 19)}Z` : 'PLAYBACK' : `${now.toISOString().replace('T', ' ').slice(0, 19)}Z`}</span>
      {d && (
        <span>
          {d.cameraLat.toFixed(4)}°, {d.cameraLon.toFixed(4)}° · ALT {alt}
        </span>
      )}
      {counts.length > 0 && <span>{counts.join(' · ')}</span>}
      {mode !== 'normal' && <span className="hud-mode">{VISUAL_MODE_LABEL[mode]} · visual effect</span>}
    </div>
  );
}
