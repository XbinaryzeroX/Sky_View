// "Your receiver": what your own SDR (readsb / dump1090) hears, shown under the Aircraft layer when a local receiver
// is set up in Providers. The coverage outline is built from positions the receiver reported while this panel was
// open, and can be drawn on the globe.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Radar } from 'lucide-react';
import type { GeoRecord } from '../../shared/layers';
import { coverageRing, updateCoverage, type ReceiverInfo } from '../../shared/sdrCoverage';
import { geodesicDistanceKm } from '../../shared/geo';
import { api } from '../lib/api';
import { receiverOverlay } from '../lib/receiverOverlay';

const LOCAL_SOURCE = 'Local receiver';

export function ReceiverCoverage({ records }: { records: GeoRecord[] }) {
  const [rx, setRx] = useState<ReceiverInfo | null | 'none'>(null);
  const [show, setShow] = useState(receiverOverlay.get() !== null);
  const ranges = useRef<number[] | null>(null);
  useEffect(() => { void api.sdrReceiver().then((r) => setRx(r ?? 'none')).catch(() => setRx('none')); }, []);
  const local = useMemo(() => records.filter((r) => r.source === LOCAL_SOURCE), [records]);
  const stats = useMemo(() => {
    if (!rx || rx === 'none') return null;
    ranges.current = updateCoverage(rx, local, ranges.current);
    const far = local.reduce((m, r) => Math.max(m, geodesicDistanceKm(rx.lat, rx.lon, r.lat, r.lon)), 0);
    return { far, best: Math.max(0, ...ranges.current), sectors: ranges.current.filter((x) => x > 0).length };
  }, [rx, local]);
  useEffect(() => {
    if (show && rx && rx !== 'none' && ranges.current) receiverOverlay.set(coverageRing(rx, ranges.current));
    else receiverOverlay.set(null);
  }, [show, stats]);
  if (rx === null) return null;
  if (rx === 'none' && local.length === 0) return null;
  return (
    <div className="receiver-box small">
      <strong><Radar size={13} aria-hidden="true" /> Your receiver</strong>
      <p>{local.length.toLocaleString()} aircraft heard by your receiver now{stats ? `; farthest ${Math.round(stats.far)} km` : ''}.</p>
      {rx === 'none'
        ? <p className="muted">The receiver publishes no location (receiver.json), so coverage cannot be drawn.</p>
        : <>
          <p className="muted">Coverage while this panel was open: up to {Math.round(stats?.best ?? 0)} km, in {stats?.sectors ?? 0} of 36 directions. Directions with nothing heard stay empty.</p>
          <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Draw coverage on the globe</label>
        </>}
    </div>
  );
}
