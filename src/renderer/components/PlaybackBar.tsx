import { useEffect, useRef, useState } from 'react';
import type { LayerId } from '../../shared/layers';
import { api } from '../lib/api';
import type { PlaybackFrame } from './Globe';

const LAYERS: LayerId[] = ['aircraft', 'aircraftMil', 'vessels', 'transit'];

/** Replays positions recorded while the app was running. Shows only recorded fixes (no interpolation). */
export function PlaybackBar({ onFrame, onExit }: { onFrame(f: PlaybackFrame | null): void; onExit(): void }) {
  const [range, setRange] = useState<{ oldest: string | null; newest: string | null; points: number } | null>(null);
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [count, setCount] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    void api.trackRange().then((r) => {
      setRange(r);
      if (r.oldest) setT(Date.parse(r.oldest));
    });
    return () => onFrame(null);
  }, []);

  useEffect(() => {
    if (t === null) return;
    const my = ++reqRef.current;
    const iso = new Date(t).toISOString();
    void Promise.all(LAYERS.map((l) => api.trackSnapshot(l, iso).then((pts) => pts.map((p) => ({ ...p, layer: l }))))).then((all) => {
      if (my !== reqRef.current) return;
      const points = all.flat();
      setCount(points.length);
      onFrame({ t: iso, points });
    });
  }, [t]);

  useEffect(() => {
    if (!playing || !range?.newest) return;
    const end = Date.parse(range.newest);
    const id = setInterval(() => {
      setT((cur) => {
        if (cur === null) return cur;
        const next = cur + speed * 1000;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, speed, range?.newest]);

  if (!range) return <div className="playback">Loading recorded tracks…</div>;
  if (!range.oldest || !range.newest || range.points === 0)
    return (
      <div className="playback">
        <span>No recorded movement yet. Turn on Aircraft, Vessels or Transit and leave the app running to record positions.</span>
        <button className="btn small-btn" onClick={onExit}>
          Close
        </button>
      </div>
    );
  const lo = Date.parse(range.oldest);
  const hi = Date.parse(range.newest);
  return (
    <div className="playback" role="region" aria-label="Playback">
      <strong className="pb-label">PLAYBACK · recorded observations, not live</strong>
      <button className="btn small-btn" onClick={() => setPlaying(!playing)}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
        {[10, 30, 60, 300].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <input type="range" min={lo} max={hi} step={1000} value={t ?? lo} onChange={(e) => setT(Number(e.target.value))} aria-label="Playback time" className="pb-range" />
      <span className="mono small">{t ? new Date(t).toISOString().replace('T', ' ').slice(0, 19) : ''}Z</span>
      <span className="muted small">{count} objects (last fix within 5 min)</span>
      <button className="btn small-btn" onClick={onExit}>
        Exit playback
      </button>
    </div>
  );
}
