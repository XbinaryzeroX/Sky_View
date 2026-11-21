// Ask the planet: a small drop-down at the top of the globe (with the voice button when an OpenAI key is saved).
// It stays closed until clicked, so the map is not covered. The answer comes from the records around the view, and the records it refers to are ringed on the globe.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, MapPinned, Send, Sparkles, X } from 'lucide-react';
import type { AskAnswer, AskMark } from '../../shared/askPlanet';
import { api, errorText } from '../lib/api';

interface Props {
  view(): { lat: number; lon: number; heightM: number } | null;
  onMarks(marks: AskMark[]): void;
  onFocus(m: AskMark): void;
  onSave(answer: AskAnswer, question: string): void;
  /** Voice button, shown inside the bar. */
  voice?: ReactNode;
  /** A question spoken to the voice button arrives here. */
  pending?: string | null;
  onPendingTaken?(): void;
}

export function AskPlanet(p: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; a: AskAnswer } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (expanded) inputRef.current?.focus(); }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  async function ask(question: string) {
    const v = p.view();
    if (!v || question.trim().length < 2) return;
    // Only the fields the main process accepts; the view object also carries the visible box.
    const view = { lat: v.lat, lon: v.lon, heightM: v.heightM };
    setBusy(true); setError(null); setOpen(true);
    try {
      const a = await api.askPlanet(question.trim(), view);
      setAnswer({ question: question.trim(), a });
      p.onMarks(a.marks);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!p.pending) return;
    const text = p.pending;
    p.onPendingTaken?.();
    setQ(text);
    setExpanded(true);
    void ask(text);
  }, [p.pending]);

  const clear = () => { setAnswer(null); setError(null); p.onMarks([]); };
  return (
    <div ref={rootRef} className={`ask-planet ${expanded ? 'ask-expanded' : ''} ${open || answer || error ? 'ask-open' : ''}`}>
      <button type="button" className="ask-trigger" aria-expanded={expanded} aria-controls="ask-dropdown" onClick={() => setExpanded((v) => !v)}>
        <Sparkles size={14} className="ask-icon" aria-hidden="true" />
        <span>Ask AI</span>
        {(answer || busy) && <span className="ask-dot" aria-label={busy ? 'Answer on the way' : 'Answer ready'} />}
        <ChevronDown size={14} className="ask-chevron" aria-hidden="true" />
      </button>
      {expanded && <div id="ask-dropdown" className="ask-dropdown">
      <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        {p.voice}
        <input ref={inputRef} value={q} maxLength={500} placeholder="Ask about the map… e.g. which fires are near the coast?" aria-label="Ask a question about what the map shows"
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => setQ(e.target.value)} />
        <button className="icon-btn" type="submit" disabled={busy || q.trim().length < 2} aria-label="Ask"><Send size={15} aria-hidden="true" /></button>
      </form>
      {(answer || error || busy) && (
        <div className="ask-card" role="status" aria-live="polite">
          <div className="ask-card-head">
            <strong><Sparkles size={14} aria-hidden="true" /> {answer ? answer.question : busy ? 'Asking…' : 'Ask the planet'}</strong>
            {(answer || error) && <button className="icon-btn" onClick={clear} aria-label="Close the answer"><X size={14} aria-hidden="true" /></button>}
          </div>
          {busy && <p className="muted small">Reading the records around the view…</p>}
          {error && <p className="small warn-text">{error}</p>}
          {answer && !busy && <>
            <p className="ask-answer">{answer.a.answer}</p>
            {answer.a.marks.length > 0 && (
              <ul className="ask-marks">
                {answer.a.marks.map((m) => (
                  <li key={m.ref}><button className="link-btn small" onClick={() => p.onFocus(m)}><MapPinned size={12} aria-hidden="true" /> {m.label}{m.note ? ` · ${m.note}` : ''}</button></li>
                ))}
              </ul>
            )}
            <p className="muted small">AI answer from {answer.a.contextCount} records near the view ({answer.a.engine}). It can be wrong; check the records. Rings mark records only, at their own positions.</p>
            {answer.a.marks.length > 0 && <button className="btn small-btn" onClick={() => p.onSave(answer.a, answer.question)}>Save marks to the canvas</button>}
          </>}
        </div>
      )}
      </div>}
    </div>
  );
}
