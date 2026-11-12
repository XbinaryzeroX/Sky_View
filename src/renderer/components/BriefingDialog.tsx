import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { briefingSourceUrl, type BriefingMode, type BriefingPreview, type BriefingRequest } from '../../shared/briefing';
import type { SavedLocation } from '../../shared/types';
import { api, errorText } from '../lib/api';
import { Modal } from './common';

/** The same bounded latest-request policy is used for mode changes, selections and retries. */
export function createBriefingPreviewLoader(callbacks: {
  read(request: BriefingRequest): Promise<BriefingPreview>;
  pending(key: string): void;
  ready(preview: BriefingPreview, key: string): void;
  failed(error: unknown, key: string): void;
}) {
  let active = true, running = false, generation = 0;
  let queued: { request: BriefingRequest; key: string; generation: number } | null = null;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (active && queued) {
        const next = queued; queued = null;
        try {
          const preview = await callbacks.read(next.request);
          if (active && generation === next.generation) callbacks.ready(preview, next.key);
        } catch (error) {
          if (active && generation === next.generation) callbacks.failed(error, next.key);
        }
      }
    } finally { running = false; }
  }
  return {
    load(request: BriefingRequest, key: string) { if (!active) return; queued = { request, key, generation: ++generation }; callbacks.pending(key); void drain(); },
    cancel() { generation++; queued = null; },
    dispose() { active = false; generation++; queued = null; },
  };
}

const PREVIEW_TAGS = new Set(['section', 'div', 'p', 'h1', 'h2', 'h3', 'strong', 'em', 'small', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'br', 'time']);
const PREVIEW_CLASSES = new Set(['small', 'muted', 'note', 'loc', 'tag', 'sev-Extreme', 'sev-Severe', 'sev-Moderate', 'sev-Minor', 'sev-Unknown']);

/** Main owns the HTML template. Copy only inert printable semantics into React, never raw HTML/styles/scripts. */
export function briefingPreviewNodes(html: string, onLinkError: (message: string) => void, parser?: Pick<DOMParser, 'parseFromString'>): { nodes: ReactNode[]; truncated: boolean } {
  // Only our resource-free main-process template is accepted. Reject resource
  // tags before invoking DOMParser, whose inert documents can still fetch images.
  const body = /<body>([\s\S]*)<\/body>/i.exec(html)?.[1];
  if (body === undefined) throw new Error('Invalid briefing document.');
  for (const match of body.matchAll(/<\/?([a-z][a-z0-9:-]*)\b/gi))
    if (match[1].toLowerCase() !== 'a' && !PREVIEW_TAGS.has(match[1].toLowerCase())) throw new Error('Unsupported briefing content.');
  const document = (parser ?? new DOMParser()).parseFromString(body, 'text/html');
  let count = 0, truncated = false;
  function children(values: NodeListOf<ChildNode>, depth: number): ReactNode[] {
    const result: ReactNode[] = [];
    for (const value of values) {
      if (count >= 20_000) { truncated = true; break; }
      result.push(node(value, depth));
    }
    return result;
  }
  function node(value: Node, depth: number): ReactNode {
    if (++count > 20_000 || depth > 24) { truncated = true; return null; }
    const key = count;
    if (value.nodeType === 3) return value.textContent;
    if (value.nodeType !== 1) return null;
    const element = value as Element, tag = element.tagName.toLowerCase();
    if (tag !== 'a' && !PREVIEW_TAGS.has(tag)) return null;
    const content = children(element.childNodes, depth + 1);
    if (tag === 'a') {
      const url = briefingSourceUrl(element.getAttribute('href'));
      if (!url) return createElement('span', { key }, content);
      return createElement('a', { key, href: url, title: `Open publisher record: ${url}`, onClick: (event: { preventDefault(): void }) => {
        event.preventDefault();
        void api.openExternal(url).then(ok => { if (!ok) onLinkError('The publisher link was blocked. Check the source URL and try again.'); })
          .catch(() => onLinkError('The publisher link could not be opened. Check your default browser and try again.'));
      } }, content);
    }
    const className = (element.getAttribute('class') ?? '').split(/\s+/).filter(value => PREVIEW_CLASSES.has(value)).join(' ');
    const props: { key: number; className?: string; colSpan?: number; rowSpan?: number; dateTime?: string } = { key };
    if (className) props.className = className;
    for (const attribute of ['colspan', 'rowspan'] as const) {
      const number = Number(element.getAttribute(attribute));
      if (Number.isInteger(number) && number >= 1 && number <= 20) props[attribute === 'colspan' ? 'colSpan' : 'rowSpan'] = number;
    }
    if (tag === 'time' && element.getAttribute('datetime')) props.dateTime = element.getAttribute('datetime')!;
    return createElement(tag, props, ...(tag === 'br' ? [] : content));
  }
  return { nodes: children(document.body.childNodes, 0), truncated };
}

function BriefingPreviewDocument({ preview, parsed }: { preview: BriefingPreview; parsed: { nodes: ReactNode[]; truncated: boolean } | null }) {
  return <div className="briefing-preview briefing-document" role="document" aria-label="Briefing preview" tabIndex={0}
    data-briefing-policy={preview.exportPolicy} data-briefing-truncated={parsed?.truncated ? 'true' : 'false'}>
    {preview.exportPolicy === 'current-locations' ? <>
      <h1>Large location briefing</h1>
      <p>{preview.locationCount.toLocaleString()} locations · {(preview.byteLength / 1024 / 1024).toFixed(1)} MiB of report HTML.</p>
      <div className="note">A full preview is unavailable for this large report. Export current data regenerates the location briefing when you export, so it can differ after a feed refresh. Select fewer locations for a fixed, reviewable preview.</div>
    </> : <>
      {parsed?.truncated && <div className="note">Preview shortened for responsiveness. HTML/PDF export contains the complete frozen briefing, including the remaining selected locations and records.</div>}
      {parsed?.nodes}
    </>}
  </div>;
}

export function BriefingDialog({ locations, initial, initialMode, onClose }: {
  locations: SavedLocation[]; initial: string[]; initialMode?: BriefingMode; onClose(): void;
}) {
  const [mode, setMode] = useState<BriefingMode>(initialMode ?? (locations.length ? 'locations' : 'visit'));
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.length ? initial : locations.map(location => location.id)));
  const [stored, setStored] = useState<(BriefingPreview & { requestKey: string }) | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null), [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const alive = useRef(false), exporting = useRef(false);
  const loader = useRef<ReturnType<typeof createBriefingPreviewLoader> | null>(null);
  const selectedIds = [...selected].sort();
  const request: BriefingRequest = mode === 'visit' ? { mode } : { mode, locationIds: selectedIds };
  const requestKey = JSON.stringify(request), currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  const preview = stored?.requestKey === requestKey ? stored : null;
  const rendered = useMemo(() => {
    if (!preview || preview.exportPolicy === 'current-locations') return { parsed: null, error: null };
    try { return { parsed: briefingPreviewNodes(preview.html, setExportError), error: null }; }
    catch { return { parsed: null, error: 'The document could not be rendered. Refresh the preview and try again.' }; }
  }, [preview]);
  const previewError = error ?? rendered.error;

  useEffect(() => {
    alive.current = true;
    loader.current = createBriefingPreviewLoader({
      read: request => api.previewBriefing(request),
      pending: () => { setStored(null); setLoading(true); setError(null); },
      ready: (value, key) => { setStored({ ...value, requestKey: key }); setLoading(false); setError(null); },
      failed: failure => { setStored(null); setLoading(false); setError(errorText(failure)); },
    });
    return () => { alive.current = false; loader.current?.dispose(); loader.current = null; };
  }, []);

  const invalidate = () => { loader.current?.cancel(); setStored(null); setLoading(true); setError(null); setMsg(null); setExportError(null); setRevision(value => value + 1); };
  useEffect(() => { if (initialMode && initialMode !== mode) { invalidate(); setMode(initialMode); } }, [initialMode]);
  useEffect(() => {
    if (mode === 'locations' && selected.size === 0) { loader.current?.cancel(); setStored(null); setLoading(false); setError(null); return; }
    loader.current?.load(request, requestKey);
    return () => loader.current?.cancel();
  }, [requestKey, revision]);

  const refresh = invalidate;
  const toggle = (id: string) => {
    invalidate();
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  async function exportAs(format: 'html' | 'pdf') {
    if (!preview || previewError || loading || exporting.current || (mode === 'locations' && selected.size === 0)) return;
    exporting.current = true; setBusy(true); setMsg(null); setExportError(null);
    const key = requestKey;
    try {
      const path = await api.exportBriefing(preview.exportPolicy === 'current-locations' ? selectedIds : { previewId: preview.previewId! }, format);
      if (alive.current && currentKey.current === key) setMsg(path ? `Saved ${format.toUpperCase()} to ${path}` : 'Export cancelled.');
    } catch (failure) {
      if (alive.current && currentKey.current === key) setExportError(errorText(failure));
    } finally { exporting.current = false; if (alive.current) setBusy(false); }
  }
  const close = () => { alive.current = false; loader.current?.dispose(); onClose(); };
  const disabled = busy || loading || !preview || !!previewError || (mode === 'locations' && selected.size === 0);
  const currentExport = preview?.exportPolicy === 'current-locations';
  return <Modal title={mode === 'visit' ? 'Since last visit briefing' : 'Location briefing'} onClose={close} wide footer={<>
    {msg && <span className="muted small" role="status">{msg}</span>}
    {exportError && <span className="error-line small" role="alert">{exportError} Refresh the preview to try again.</span>}
    <button className="btn" onClick={() => void exportAs('pdf')} disabled={disabled}>{currentExport ? 'Export current PDF…' : 'Export PDF…'}</button>
    <button className="btn primary" onClick={() => void exportAs('html')} disabled={disabled}>{currentExport ? 'Export current HTML…' : 'Export HTML…'}</button>
  </>}>
    <div className="btn-row briefing-modes" role="group" aria-label="Briefing mode">
      <button className={'btn small-btn ' + (mode === 'locations' ? 'primary' : '')} disabled={busy} aria-pressed={mode === 'locations'} onClick={() => { invalidate(); setMode('locations'); }}>Location briefing</button>
      <button className={'btn small-btn ' + (mode === 'visit' ? 'primary' : '')} disabled={busy} aria-pressed={mode === 'visit'} onClick={() => { invalidate(); setMode('visit'); }}>Since last visit</button>
      <button className="link-btn small" disabled={busy || loading} onClick={refresh}>Refresh preview</button>
    </div>
    <p className="muted small">{currentExport ? 'Large reports regenerate current location data at export time.' : 'The preview is fixed while feeds refresh. Exports use this exact captured document; refresh the preview for newer evidence.'}</p>
    <div className={'briefing-layout ' + (mode === 'visit' ? 'briefing-visit' : '')} data-briefing-state={loading ? 'loading' : previewError ? 'error' : preview ? 'ready' : 'empty'}>
      {mode === 'locations' && <div className="briefing-picker">
        <div className="btn-row">
          <button className="btn small-btn" disabled={busy} onClick={() => { invalidate(); setSelected(new Set(locations.map(location => location.id))); }}>All</button>
          <button className="btn small-btn" disabled={busy} onClick={() => { invalidate(); setSelected(new Set()); }}>None</button>
        </div>
        {locations.length === 0 && <p className="muted small">Add locations for a location briefing, or use Since last visit.</p>}
        {locations.map(location => <label key={location.id} className="check"><input type="checkbox" disabled={busy} checked={selected.has(location.id)} onChange={() => toggle(location.id)} /> {location.name}</label>)}
        <p className="muted small">Deterministic templates, source links, freshness and coverage limitations. No AI.</p>
      </div>}
      <div className="briefing-preview-pane">
        {loading ? <p role="status">Loading briefing preview…</p> : previewError ? <div className="note"><p className="error-line" role="alert">Briefing preview failed: {previewError}</p><button className="btn small-btn" onClick={refresh}>Retry preview</button></div>
          : preview ? <BriefingPreviewDocument preview={preview} parsed={rendered.parsed} /> : <p className="muted">Choose at least one location to preview, or use Since last visit.</p>}
        {preview && <p className="muted small">{currentExport ? 'Report size checked' : 'Preview captured'}: <time dateTime={preview.generatedAt}>{preview.generatedAt}</time></p>}
      </div>
    </div>
  </Modal>;
}
