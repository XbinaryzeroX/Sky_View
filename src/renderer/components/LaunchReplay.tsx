// Launch event replay for a selected launch: loads the event sequence Launch Library 2 publishes for the mission
// (on request only) and runs a T-minus/T-plus clock through it. The source publishes event times, not a trajectory,
// so nothing is drawn or moved on the map. The clock is a replay of the published sequence, not telemetry.
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { eventIndexAt, LAUNCH_ID, REPLAY_SPEEDS, replayRange, tClock, type LaunchTimeline } from '../../shared/launchTimeline';
import type { GeoRecord } from '../../shared/layers';
import { api, errorText } from '../lib/api';
import { Time } from './common';

type Load = { id: string; state: 'idle' | 'loading' | 'ready' | 'error'; timeline: LaunchTimeline | null; error: string | null };

export function LaunchReplay({ record }: { record: GeoRecord }) {
  const [load, setLoad] = useState<Load>({ id: record.id, state: 'idle', timeline: null, error: null });
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(10);
  const current = useRef(record.id);
  current.current = record.id;
  // A different launch: forget the previous one's timeline and stop the clock.
  useEffect(() => { setLoad({ id: record.id, state: 'idle', timeline: null, error: null }); setPlaying(false); }, [record.id]);

  const view = load.id === record.id ? load : { id: record.id, state: 'idle' as const, timeline: null, error: null };
  const events = view.timeline?.events ?? [];
  const range = replayRange(events);

  useEffect(() => {
    if (!playing || !range) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      setT((v) => {
        const next = v + dt * speed;
        if (next >= range.end) { setPlaying(false); return range.end; }
        return next;
      });
    }, 200);
    return () => clearInterval(timer);
  }, [playing, speed, range?.start, range?.end]);

  if (!LAUNCH_ID.test(record.id)) return null;

  const fetchTimeline = () => {
    const id = record.id;
    setLoad({ id, state: 'loading', timeline: null, error: null });
    api.launchTimeline(id).then(
      (timeline) => {
        // A reply for a launch that is no longer selected is dropped.
        if (current.current !== id) return;
        setLoad({ id, state: 'ready', timeline, error: null });
        const r = replayRange(timeline.events);
        setT(r ? r.start : 0);
      },
      (e) => { if (current.current === id) setLoad({ id, state: 'error', timeline: null, error: errorText(e) }); },
    );
  };

  const at = eventIndexAt(events, t);
  const upcoming = record.category === 'upcoming';
  return (
    <section className="launch-replay" aria-label="Launch event replay">
      <h3 className="sub">Launch event replay</h3>
      {view.state === 'idle' && (
        <>
          <button className="btn small" onClick={fetchTimeline}>Load the event timeline</button>
          <p className="small muted">One request to Launch Library 2 (free allowance: 15 an hour).</p>
        </>
      )}
      {view.state === 'loading' && <p className="small muted" role="status">Loading the event timeline…</p>}
      {view.state === 'error' && (
        <>
          <p className="small error-line" role="alert">Timeline unavailable: {view.error}</p>
          <button className="btn small" onClick={fetchTimeline}>Try again</button>
        </>
      )}
      {view.state === 'ready' && !range && <p className="small muted">Launch Library publishes no event timeline for this launch. That is common outside SpaceX missions; it does not mean nothing happened.</p>}
      {view.state === 'ready' && range && (
        <>
          <div className="launch-replay-clock" role="timer" aria-live="off" aria-label="Replay clock">{tClock(t)}</div>
          <div className="launch-replay-row">
            <button className="btn small" aria-pressed={playing} onClick={() => { if (!playing && t >= range.end) setT(range.start); setPlaying(!playing); }}>
              {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{playing ? 'Pause' : 'Play'}
            </button>
            <button className="icon-btn" title="Back to the start" aria-label="Back to the start" onClick={() => { setPlaying(false); setT(range.start); }}><RotateCcw size={15} aria-hidden="true" /></button>
            <label className="small muted launch-replay-speed">Speed
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {REPLAY_SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </label>
          </div>
          <input type="range" className="launch-replay-scrub" aria-label="Replay position" min={range.start} max={range.end} step={1} value={Math.round(t)}
            aria-valuetext={tClock(t)} onChange={(event) => { setPlaying(false); setT(Number(event.target.value)); }} />
          <ol className="launch-replay-events small">
            {events.map((e, i) => (
              <li key={`${e.tSec}|${e.name}|${i}`} className={i === at ? 'now' : i < at ? 'past' : ''} title={e.description ?? undefined} aria-current={i === at ? 'step' : undefined}>
                <span className="launch-replay-t">{tClock(e.tSec)}</span>
                <span>{i === at ? '▶ ' : i < at ? '✓ ' : ''}{e.name}</span>
              </li>
            ))}
          </ol>
          <p className="small muted">
            {upcoming ? 'Planned sequence for a launch that has not happened yet. ' : 'The sequence Launch Library lists for this mission. '}
            Event times are relative to liftoff as published, not telemetry, and may differ from what happened. No trajectory is published, so nothing moves on the map.
            {view.timeline?.net && <> Liftoff (NET): <Time iso={view.timeline.net} />.</>}
          </p>
        </>
      )}
    </section>
  );
}
