// Player for authorized public camera feeds.
//
// Media types (from the publisher's catalog, never guessed):
//   'hls'   – live video stream (HTTP Live Streaming), played with hls.js (Apache-2.0)
//             through the browser's Media Source Extensions. Starts muted.
//   'still' – periodically refreshed still image. Never labelled live video.
// The stream is fetched directly from the publisher's own host (allow-listed in
// the Content-Security-Policy); nothing is proxied, re-hosted or recorded.

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { relativeTime } from '../lib/format';

export interface CameraMedia {
  streamUrl: string | null;
  stillUrl: string | null;
  refreshMin: number | null;
  sourceUrl: string | null;
  publisher: string;
}

type State = 'loading' | 'playing' | 'paused' | 'buffering' | 'offline' | 'error' | 'still';

export function CameraPlayer({ media, title }: { media: CameraMedia; title: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(media.streamUrl ? 'loading' : 'still');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const restartsRef = useRef<number[]>([]);
  /** Time of the last advancing playback; used to reset the reconnect budget after good playback. */
  const lastGoodRef = useRef(0);
  const lastRestartRef = useRef(0);
  const [preferStill, setPreferStill] = useState(!media.streamUrl);

  useEffect(() => {
    setPreferStill(!media.streamUrl);
    setState(media.streamUrl ? 'loading' : 'still');
    setError(null);
  }, [media.streamUrl, media.stillUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !media.streamUrl || preferStill) return;
    let hls: Hls | null = null;
    setState('loading');
    setError(null);
    const onPlaying = () => setState('playing');
    const onTime = () => {
      if (!v.paused && v.currentTime > 0) lastGoodRef.current = Date.now();
    };
    v.addEventListener('timeupdate', onTime);
    const onWaiting = () => setState('buffering');
    const onPause = () => setState((s) => (s === 'offline' || s === 'error' ? s : 'paused'));
    v.addEventListener('playing', onPlaying);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('pause', onPause);
    const onVideoError = () => {
      v.dataset.mediaError = `${v.error?.code ?? ''} ${v.error?.message ?? ''}`;
      // Damaged frames in the publisher's stream stop the decoder; reconnect at the live edge with
      // exponential backoff (0.4 s … 8 s). Any 5 s of good playback resets the budget.
      const now = Date.now();
      if (lastGoodRef.current - lastRestartRef.current >= 5000) restartsRef.current = [];
      lastRestartRef.current = now;
      restartsRef.current = [...restartsRef.current.filter((t) => now - t < 120_000), now];
      const n = restartsRef.current.length;
      if (n <= 12) {
        setState('buffering');
        setTimeout(() => setAttempt((x) => x + 1), Math.min(8000, 400 * 2 ** (n - 1)));
      } else fail('error', 'The publisher’s video keeps failing to decode (damaged frames in the stream). Try again later.');
    };
    v.addEventListener('error', onVideoError);
    const fail = (kind: 'offline' | 'error', msg: string) => {
      setState(kind);
      setError(msg);
    };
    if (Hls.isSupported()) {
      const quick = { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 15000, timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 }, errorRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 1000 } };
      hls = new Hls({ lowLatencyMode: false, maxBufferLength: 20, liveSyncDurationCount: 3, manifestLoadPolicy: { default: quick }, playlistLoadPolicy: { default: quick } });
      // Recovery budget: live camera streams hiccup (segment rolled over, brief publisher outage).
      let networkRecoveries = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        v.dataset.lastError = `${data.details} ${data.sourceBufferName ?? ""} ${data.error?.message ?? ""} ${data.mimeType ?? ""}`.trim();
        (window as unknown as { __camErrors?: string[] }).__camErrors = [...((window as unknown as { __camErrors?: string[] }).__camErrors ?? []), `${data.fatal ? "FATAL " : ""}${v.dataset.lastError}`].slice(-12);
        if (!data.fatal) return;
        const code = data.response?.code;
        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
          fail('offline', code === 404 ? 'The publisher reports this stream as unavailable (HTTP 404). The camera may be offline or its stream retired.' : `The stream could not be reached${code ? ` (HTTP ${code})` : ''}.`);
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 3) {
          networkRecoveries++;
          setState('buffering');
          setTimeout(() => hls?.startLoad(), 1500);
          return;
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && restartsRef.current.filter((t) => Date.now() - t < 120_000).length < 30) {
          // Some publisher streams contain damaged frames that Chromium's decoder rejects. Reconnect at the live edge.
          restartsRef.current = [...restartsRef.current, Date.now()].slice(-30);
          setState('buffering');
          hls?.destroy();
          hls = null;
          setTimeout(() => setAttempt((n) => n + 1), 300);
          return;
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) fail('error', 'The publisher’s video keeps failing to decode (damaged frames in the stream). Try again later.');
        else fail('error', `The stream stopped (${data.details}${code ? `, HTTP ${code}` : ''}).`);
        hls?.destroy();
        hls = null;
      });
      hls.loadSource(media.streamUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        v.muted = true;
        void v.play().catch(() => setState('paused'));
      });
    } else fail('error', 'This system cannot play HLS video (Media Source Extensions unavailable).');
    return () => {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('error', onVideoError);
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
    };
  }, [media.streamUrl, attempt, preferStill]);

  const showVideo = !!media.streamUrl && !preferStill && state !== 'offline' && state !== 'error';
  const badge = showVideo ? (state === 'playing' ? 'LIVE VIDEO' : state === 'buffering' ? 'BUFFERING' : state === 'paused' ? 'PAUSED' : 'CONNECTING') : 'STILL IMAGE';
  return (
    <div className="cam-player" ref={boxRef}>
      <div className="cam-stage">
        <span className={`cam-badge ${showVideo && state === 'playing' ? 'live' : ''}`}>{badge}</span>
        {showVideo ? (
          <video ref={videoRef} muted={muted} playsInline aria-label={`Live video: ${title}`} onClick={() => (videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause())} />
        ) : media.stillUrl ? (
          <StillImage url={media.stillUrl} refreshMin={media.refreshMin} title={title} />
        ) : (
          <div className="cam-empty">No image or stream is published for this camera.</div>
        )}
      </div>
      {error && (
        <p className="cam-error" role="status">
          {error} {media.stillUrl ? 'Showing the latest published still image instead.' : ''}
        </p>
      )}
      <div className="btn-row cam-controls">
        {showVideo && (
          <>
            <button className="btn" onClick={() => (videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause())}>
              {state === 'paused' ? 'Play' : 'Pause'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setMuted((m) => !m);
                if (videoRef.current) videoRef.current.muted = !muted;
              }}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
          </>
        )}
        {media.streamUrl && (state === 'offline' || state === 'error') && (
          <button className="btn" onClick={() => { restartsRef.current = []; setAttempt((n) => n + 1); }}>
            Retry stream
          </button>
        )}
        {media.streamUrl && media.stillUrl && state !== 'offline' && state !== 'error' && (
          <button className="btn" onClick={() => setPreferStill((p) => !p)}>
            {preferStill ? 'Live video' : 'Still image'}
          </button>
        )}
        <button className="btn" onClick={() => void boxRef.current?.querySelector('.cam-stage')?.requestFullscreen?.()}>
          Fullscreen
        </button>
        {media.sourceUrl && (
          <a className="btn" href={media.sourceUrl} target="_blank" rel="noreferrer">
            Publisher
          </a>
        )}
      </div>
      <p className="muted small">
        {media.publisher}. {showVideo ? 'Live stream from the publisher; it can lag by several seconds and may drop out.' : 'Published still image; the capture time is set by the publisher and may lag.'}
      </p>
    </div>
  );
}

function StillImage({ url, refreshMin, title }: { url: string; refreshMin: number | null; title: string }) {
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), Math.max(60, (refreshMin ?? 2) * 60) * 1000);
    return () => clearInterval(t);
  }, [refreshMin]);
  const src = `${url}${url.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 60000)}-${tick}`;
  if (err) return <div className="cam-empty">The publisher’s image could not be loaded (camera offline or image unavailable).</div>;
  return (
    <>
      <img
        src={src}
        alt={`Latest published still: ${title}`}
        onLoad={() => {
          setErr(false);
          setLoadedAt(new Date().toISOString());
        }}
        onError={() => setErr(true)}
      />
      <span className="cam-time">Loaded {relativeTime(loadedAt)}</span>
    </>
  );
}

/** Camera media from a camera record's properties. */
export function cameraMedia(r: { imageUrl?: string | null; sourceUrl?: string | null; source: string; props: Record<string, unknown> }): CameraMedia {
  return {
    streamUrl: typeof r.props.streamUrl === 'string' ? r.props.streamUrl : null,
    stillUrl: r.imageUrl ?? null,
    refreshMin: typeof r.props.updateFrequencyMin === 'number' ? r.props.updateFrequencyMin : null,
    sourceUrl: r.sourceUrl ?? null,
    publisher: String(r.props.publisher ?? r.source),
  };
}
