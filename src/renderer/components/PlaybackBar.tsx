import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { REPLAY_FIX_WINDOW_MS, type RecordedFeed, type TimelineFrame, type TimelineRange } from '../../shared/timeline';
import { api, errorText } from '../lib/api';
import './playbackBar.css';

type Phase = 'range-loading' | 'loading' | 'ready' | 'empty' | 'error';
interface Props {
  initialCursor?: string | null;
  onCursor?(time: string): void;
  onFrame(frame: TimelineFrame | null): void;
  onExit(): void;
}

/** One IPC in flight, one replaceable pending cursor, no publication after disposal. */
export function createTimelineCursorLoader(callbacks: {
  read(t: string): Promise<TimelineFrame>;
  pending(t: string): void;
  ready(frame: TimelineFrame): void;
  failed(error: unknown, t: string): void;
}) {
  let active = true, running = false, generation = 0;
  let queued: { t: string; generation: number } | null = null;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (active && queued) {
        const request = queued;
        queued = null;
        try {
          const frame = await callbacks.read(request.t);
          if (active && request.generation === generation) callbacks.ready(frame);
        } catch (error) {
          if (active && request.generation === generation) callbacks.failed(error, request.t);
        }
      }
    } finally { running = false; }
  }
  return {
    seek(t: string) {
      if (!active) return;
      queued = { t, generation: ++generation };
      callbacks.pending(t);
      void drain();
    },
    cancel() { generation++; queued = null; },
    dispose() { active = false; generation++; queued = null; },
  };
}

export function timelineBounds(range: TimelineRange | null): [number, number] | null {
  if (!range?.oldest || !range.newest) return null;
  const oldest = Date.parse(range.oldest), newest = Date.parse(range.newest);
  return Number.isFinite(oldest) && Number.isFinite(newest) && oldest <= newest ? [oldest, newest] : null;
}

/** A History cursor is never silently clamped to a different retained time. */
export function initialTimelineCursor(range: TimelineRange, initial?: string | null): number | null {
  if (initial != null) {
    const requested = Date.parse(initial);
    return Number.isFinite(requested) ? requested : null;
  }
  return timelineBounds(range)?.[0] ?? null;
}

function iso(t: number): string { return new Date(t).toISOString(); }
function shownTime(value: string): string { return value.replace('T', ' '); }

export function RecordedFeedStatus({ name, feed }: { name: 'NWS' | 'USGS'; feed: RecordedFeed<unknown> }) {
  const description = feed.state === 'recorded' ? (feed.records.length ? `recorded · ${feed.records.length} records` : 'recorded empty')
    : feed.state === 'partial' ? `partial · ${feed.records.length} records`
      : feed.state === 'gap' ? 'gap · no valid recorded frame' : 'unrecorded at this cursor';
  return <div className={`pb-feed pb-feed-${feed.state}`}>
    <strong>{name}: {description}</strong>
    {feed.observedAt && <span>Recorded <time dateTime={feed.observedAt}>{shownTime(feed.observedAt)}</time></span>}
    {feed.sourceUpdatedAt && <span>Source updated <time dateTime={feed.sourceUpdatedAt}>{shownTime(feed.sourceUpdatedAt)}</time></span>}
    {feed.scope && <span>Scope: {feed.scope}</span>}
    {feed.validUntil && <span>Recorded frame usable through <time dateTime={feed.validUntil}>{shownTime(feed.validUntil)}</time></span>}
    {feed.reason && <span>{feed.reason}</span>}
    {feed.state === 'unknown' && !feed.reason && <span>This feed was not recorded at this cursor.</span>}
  </div>;
}

export function PlaybackFrameStatus({ frame, movementRecorded }: { frame: TimelineFrame; movementRecorded: boolean }) {
  let first: string | null = null, last: string | null = null, oldest = Infinity, newest = -Infinity;
  for (const point of frame.points) {
    const time = Date.parse(point.t);
    if (!Number.isFinite(time)) continue;
    if (time < oldest) { oldest = time; first = point.t; }
    if (time > newest) { newest = time; last = point.t; }
  }
  return <div className="pb-frame-status">
    <p className="muted small">{frame.points.length ? `${frame.points.length} movement ${frame.points.length === 1 ? 'fix' : 'fixes'} (last fix within ${REPLAY_FIX_WINDOW_MS / 60_000} min)`
      : movementRecorded ? 'No recorded movement fix within 5 min of this cursor.' : 'No movement recorded in the retained timeline.'}
      {first && <> Observed <time dateTime={first}>{shownTime(first)}</time>{last && last !== first && <> through <time dateTime={last}>{shownTime(last)}</time></>}.</>}
    </p>
    <div className="pb-feed-status"><RecordedFeedStatus name="NWS" feed={frame.nws} /><RecordedFeedStatus name="USGS" feed={frame.usgs} /></div>
  </div>;
}

/** Shared recorded cursor: movement fixes and NWS/USGS retrievals, never live substitution. */
export function PlaybackBar({ initialCursor, onCursor, onFrame, onExit }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const center = bar?.closest<HTMLElement>('.center');
    if (!bar || !center) return;
    const resize = () => {
      const inset = Math.ceil(center.getBoundingClientRect().bottom - bar.getBoundingClientRect().top) + 6;
      center.style.setProperty('--replay-panel-inset', inset + 'px');
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(bar);
    observer.observe(center);
    return () => { observer.disconnect(); center.style.removeProperty('--replay-panel-inset'); };
  }, []);
  const [range, setRange] = useState<TimelineRange | null>(null);
  const [t, setT] = useState<number | null>(null);
  const [frame, setFrame] = useState<TimelineFrame | null>(null);
  const [phase, setPhase] = useState<Phase>('range-loading');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const alive = useRef(false), rangeGeneration = useRef(0);
  const rangeRef = useRef<TimelineRange | null>(null), cursorRef = useRef<number | null>(null);
  const initialRef = useRef(initialCursor), handledInitial = useRef(initialCursor);
  const callbacks = useRef({ onCursor, onFrame, onExit });
  const loader = useRef<ReturnType<typeof createTimelineCursorLoader> | null>(null);
  callbacks.current = { onCursor, onFrame, onExit };
  initialRef.current = initialCursor;

  const seek = useCallback((time: number) => {
    cursorRef.current = time; setT(time);
    callbacks.current.onCursor?.(iso(time));
    loader.current?.seek(iso(time));
  }, []);

  const loadRange = useCallback(async () => {
    const request = ++rangeGeneration.current;
    loader.current?.cancel();
    setPhase('range-loading'); setError(null); setFrame(null); callbacks.current.onFrame(null);
    try {
      const result = await api.timelineRange();
      if (!alive.current || request !== rangeGeneration.current) return;
      rangeRef.current = result; setRange(result);
      handledInitial.current = initialRef.current;
      const cursor = initialTimelineCursor(result, initialRef.current);
      if (cursor !== null) seek(cursor);
      else if (initialRef.current != null) {
        cursorRef.current = null; setT(null);
        setPhase('error'); setError('The requested History time is invalid. Choose a retained time to replay.');
      } else setPhase('empty');
    } catch (failure) {
      if (!alive.current || request !== rangeGeneration.current) return;
      setPhase('error'); setError(errorText(failure));
    }
  }, [seek]);

  useEffect(() => {
    alive.current = true;
    loader.current = createTimelineCursorLoader({
      read: (time) => api.timelineFrame(time),
      pending: () => { setPhase('loading'); setError(null); setFrame(null); callbacks.current.onFrame(null); },
      ready: (result) => { setPhase('ready'); setFrame(result); callbacks.current.onFrame(result); },
      failed: (failure) => { setPhase('error'); setError(errorText(failure)); setPlaying(false); setFrame(null); callbacks.current.onFrame(null); },
    });
    void loadRange();
    return () => {
      alive.current = false; rangeGeneration.current++;
      loader.current?.dispose(); loader.current = null;
      callbacks.current.onFrame(null);
    };
  }, [loadRange]);

  useEffect(() => {
    if (!rangeRef.current || initialCursor === handledInitial.current) return;
    handledInitial.current = initialCursor; setPlaying(false);
    const cursor = initialTimelineCursor(rangeRef.current, initialCursor);
    if (cursor !== null) seek(cursor);
    else {
      loader.current?.cancel(); cursorRef.current = null; setT(null); setFrame(null);
      setPhase('error'); setError('The requested History time is invalid. Choose a retained time to replay.'); callbacks.current.onFrame(null);
    }
  }, [initialCursor, seek]);

  useEffect(() => {
    const bounds = timelineBounds(range);
    if (!playing || !bounds || phase !== 'ready') return;
    const timer = setInterval(() => {
      const current = cursorRef.current;
      if (current === null || current < bounds[0] || current > bounds[1]) { setPlaying(false); return; }
      const next = Math.min(current + speed * 1000, bounds[1]);
      seek(next);
      if (next === bounds[1]) setPlaying(false);
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, speed, range, seek, phase]);

  const bounds = timelineBounds(range);
  const initial = initialCursor == null ? null : Date.parse(initialCursor);
  const initialTime = initial !== null && Number.isFinite(initial) ? initial : null;
  const beforeRange = t !== null && bounds && t < bounds[0], afterRange = t !== null && bounds && t > bounds[1];
  const canPlay = !!bounds && bounds[0] < bounds[1] && t !== null && !beforeRange && !afterRange;
  const exit = () => { alive.current = false; loader.current?.dispose(); rangeGeneration.current++; setPlaying(false); callbacks.current.onFrame(null); callbacks.current.onExit(); };
  return <div ref={barRef} className="playback" role="region" aria-label="Playback" data-playback-phase={phase} data-playback-cursor={t === null ? '' : iso(t)}>
    <strong className="pb-label">PLAYBACK · recorded observations, not live</strong>
    <button className="btn small-btn" disabled={!canPlay} onClick={() => {
      if (!playing && bounds && t !== null && t >= bounds[1]) seek(bounds[0]);
      setPlaying(!playing);
    }}>{playing ? 'Pause' : 'Play'}</button>
    <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Playback speed">
      {[10, 30, 60, 300].map((value) => <option key={value} value={value}>{value}×</option>)}
    </select>
    {bounds && <input type="range" min={Math.min(bounds[0], initialTime ?? bounds[0])} max={Math.max(bounds[1], initialTime ?? bounds[1])}
      step={1} value={t ?? bounds[0]} disabled={phase === 'range-loading'} aria-label="Playback time" aria-valuetext={t === null ? 'No cursor selected' : iso(t)} className="pb-range"
      onChange={(event) => { setPlaying(false); seek(Number(event.target.value)); }} />}
    {t !== null && <time className="mono small pb-cursor" dateTime={iso(t)}>{shownTime(iso(t))}</time>}
    <button className="btn small-btn" onClick={exit}>Exit playback</button>
    <div className="pb-status">
      {phase === 'range-loading' && <p className="small" role="status">Loading recorded timeline…</p>}
      {phase === 'loading' && <p className="small" role="status">Loading the recorded frame… Live hazards and movement are hidden.</p>}
      {phase === 'empty' && <p className="small" role="status">No retained timeline observations. Leave Atlas Watch running to record movement and successful NWS/USGS refreshes.</p>}
      {phase === 'error' && <p className="error-line small" role="alert">Recorded replay unavailable: {error}. Live hazards and movement remain hidden. <button className="link-btn" onClick={() => {
        if (range && cursorRef.current !== null) seek(cursorRef.current); else void loadRange();
      }}>Retry</button></p>}
      {(beforeRange || afterRange) && bounds && <p className="note small">This requested cursor is {beforeRange ? 'before' : 'after'} the retained timeline ({shownTime(iso(bounds[0]))} through {shownTime(iso(bounds[1]))}). It has not been moved to another time.</p>}
      {bounds && (beforeRange || afterRange || t === null) && <button className="link-btn small" onClick={() => { setPlaying(false); seek(bounds[0]); }}>Go to earliest recorded time</button>}
      {range && !bounds && t !== null && <p className="note small">No timeline observations are retained. A History record does not establish the full active map at its observation time.</p>}
      {frame && <PlaybackFrameStatus frame={frame} movementRecorded={(range?.points ?? 0) > 0} />}
      {range && <p className="pb-scope muted small">Retained: {range.points} movement points · {range.nwsFrames} NWS frames · {range.usgsFrames} USGS frames. Feeds retain their recorded scope. No interpolation or data is filled in for unrecorded periods.</p>}
    </div>
  </div>;
}
