// Hold-to-talk voice commands (customer OpenAI key). Recording starts only while the button is held (or toggled with
// the keyboard), stops after 15 seconds at most, and the clip goes to the main process for transcription. The
// transcript is matched locally against a fixed set of commands; anything else is reported as not understood.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { LAYERS } from '../../shared/layers';
import { parseVoiceCommand, type VoiceAction } from '../../shared/voiceCommands';
import { api, errorText } from '../lib/api';
import { useBundledPlaces } from '../lib/useBundledPlaces';

const MAX_MS = 15_000;
type Phase = 'idle' | 'listening' | 'working' | 'done' | 'error';

function pickMime(): 'audio/webm' | 'audio/ogg' | 'audio/mp4' | null {
  for (const m of ['audio/webm', 'audio/ogg', 'audio/mp4'] as const) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

export function VoiceControl({ onAction, onGo, onQuestion, inline }: { onAction(a: VoiceAction): string | null; onGo(lat: number, lon: number, label: string): void; onQuestion?(text: string): void; inline?: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('Hold to speak');
  const [place, setPlace] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const places = useBundledPlaces(place ?? '', !!place);

  useEffect(() => {
    if (!place || !places) return;
    const best = places.matches[0];
    if (best) { onGo(best.lat, best.lon, best.label); setMessage(`Flying to ${best.label}`); setPhase('done'); }
    else { setMessage(`No bundled place matches “${place}”. Try the search box for addresses.`); setPhase('error'); }
    setPlace(null);
  }, [places, place]);

  useEffect(() => () => { clearTimeout(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    if (rec.current) return;
    const mime = pickMime();
    if (!mime) { setPhase('error'); setMessage('This computer cannot record audio in a supported format.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        rec.current = null;
        clearTimeout(timer.current);
        const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
        if (bytes.length < 200) { setPhase('error'); setMessage('Too short. Hold the button while you speak.'); return; }
        setPhase('working'); setMessage('Transcribing…');
        try {
          const { text } = await api.voiceTranscribe(bytes, mime);
          const action = parseVoiceCommand(text);
          if (action.kind === 'go') { setMessage(`Heard “${text}”. Looking up ${action.place}…`); setPlace(action.place); return; }
          if (action.kind === 'unknown' && onQuestion && text.trim().length > 2) { setPhase('done'); setMessage(`Asking: “${text}”`); onQuestion(text); return; }
          if (action.kind === 'unknown') { setPhase('error'); setMessage(text ? `Heard “${text}”, but that is not a command I know. Try “show aircraft” or “go to Paris”.` : 'Nothing was heard.'); return; }
          const done = onAction(action);
          setPhase('done');
          setMessage(done ?? (action.kind === 'layer' ? `${action.on ? 'Showing' : 'Hiding'} ${LAYERS[action.layer].name}` : 'Done'));
        } catch (e) { setPhase('error'); setMessage(errorText(e)); }
      };
      rec.current = r;
      r.start();
      setPhase('listening'); setMessage('Listening… release to send');
      timer.current = setTimeout(stop, MAX_MS);
    } catch {
      setPhase('error'); setMessage('The microphone is not available or access was refused.');
    }
  }
  function stop() { if (rec.current?.state === 'recording') rec.current.stop(); }

  return (
    <div className={`${inline ? 'voice-inline' : 'voice-control'} voice-${phase}`}>
      <button className="voice-btn" aria-pressed={phase === 'listening'} aria-label={phase === 'listening' ? 'Stop recording and send the voice command' : 'Hold to give a voice command'}
        onPointerDown={(e) => { e.preventDefault(); void start(); }} onPointerUp={stop} onPointerLeave={stop}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); if (phase === 'listening') stop(); else void start(); } }}>
        {phase === 'error' ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
        <span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      </button>
      <span className="voice-msg" role="status" aria-live="polite">{message}</span>
    </div>
  );
}
