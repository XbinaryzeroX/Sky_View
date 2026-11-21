// Timed event fields for a Director-mode drawing: when it happened (entered in local time, stored in UTC), what kind
// of event it is and where it was reported. A drawing with a time appears in replay from that minute on. The user
// places every event from open reporting; nothing is placed automatically.
import { useState } from 'react';
import type { EventKind } from '../../shared/geojsonAnnotations';
import { localInput } from '../../shared/timeline';
import type { Annotation } from '../lib/api';

export const EVENT_KIND_LABEL: Record<EventKind, string> = { strike: 'Strike', explosion: 'Explosion', closure: 'Airspace or sea closure', incident: 'Incident', other: 'Other event' };

/** A local datetime-local value as a UTC ISO string, or null when it is not a valid time. */
export function eventIsoFromLocal(value: string): string | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Only https links are kept; anything else is refused rather than rewritten. */
export function cleanSourceUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && v.length <= 500 ? u.toString() : null;
  } catch {
    return null;
  }
}

export function EventFields({ a, onChange }: { a: Annotation; onChange(next: Annotation): void }) {
  const [link, setLink] = useState(a.sourceUrl ?? '');
  const badLink = link.trim() !== '' && cleanSourceUrl(link) === null;
  return (
    <details className="anno-note anno-event">
      <summary className="small">{a.eventAt ? `Event · ${EVENT_KIND_LABEL[a.eventKind ?? 'other']}` : 'Mark as a timed event'}</summary>
      <div className="event-fields">
        <label className="field small">
          <span>When it happened (your local time)</span>
          <input type="datetime-local" value={a.eventAt ? localInput(Date.parse(a.eventAt)) : ''}
            onChange={(e) => {
              const iso = eventIsoFromLocal(e.target.value);
              onChange(iso ? { ...a, eventAt: iso, eventKind: a.eventKind ?? 'other' } : { ...a, eventAt: undefined, eventKind: undefined });
            }} />
        </label>
        <label className="field small">
          <span>Kind</span>
          <select value={a.eventKind ?? 'other'} disabled={!a.eventAt} onChange={(e) => onChange({ ...a, eventKind: e.target.value as EventKind })}>
            {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field small">
          <span>Where it was reported (https link)</span>
          <input type="url" value={link} maxLength={500} placeholder="https://…" aria-invalid={badLink || undefined}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => { const u = cleanSourceUrl(link); if (!badLink) onChange({ ...a, sourceUrl: u ?? undefined }); }} />
        </label>
        {badLink && <p className="small warn-text">Use a full https link, or leave it empty.</p>}
        <p className="muted small">Reported, not confirmed. Replay shows this drawing from the time you set.</p>
      </div>
    </details>
  );
}
