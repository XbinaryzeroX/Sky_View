import { useEffect, useState } from 'react';
import type { SavedLocation } from '../../shared/types';
import { api, errorText } from '../lib/api';
import { Modal } from './common';

export function BriefingDialog({ locations, initial, onClose }: { locations: SavedLocation[]; initial: string[]; onClose(): void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.length ? initial : locations.map((l) => l.id)));
  const [html, setHtml] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .previewBriefing([...selected])
      .then((h) => !cancelled && setHtml(h))
      .catch((e) => !cancelled && setMsg(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  async function exportAs(format: 'html' | 'pdf') {
    setBusy(true);
    setMsg(null);
    try {
      const path = await api.exportBriefing([...selected], format);
      setMsg(path ? `Saved ${format.toUpperCase()} to ${path}` : 'Export cancelled.');
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Location briefing"
      onClose={onClose}
      wide
      footer={
        <>
          {msg && (
            <span className="muted small" role="status">
              {msg}
            </span>
          )}
          <button className="btn" onClick={() => void exportAs('pdf')} disabled={busy || selected.size === 0}>
            Export PDF…
          </button>
          <button className="btn primary" onClick={() => void exportAs('html')} disabled={busy || selected.size === 0}>
            Export HTML…
          </button>
        </>
      }
    >
      <div className="briefing-layout">
        <div className="briefing-picker">
          <div className="btn-row">
            <button className="btn small-btn" onClick={() => setSelected(new Set(locations.map((l) => l.id)))}>
              All
            </button>
            <button className="btn small-btn" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
          {locations.length === 0 && <p className="muted small">Add locations to include them in a briefing.</p>}
          {locations.map((l) => (
            <label key={l.id} className="check">
              <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /> {l.name}
            </label>
          ))}
          <p className="muted small">The briefing is built from deterministic templates (no AI). It includes feed freshness, source links, and coverage limitations.</p>
        </div>
        <iframe className="briefing-preview" title="Briefing preview" sandbox="" srcDoc={html} />
      </div>
    </Modal>
  );
}
