import { ExternalLink as ExternalIcon, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { AlertSeverity, FeedStatus, Freshness } from '../../shared/types';
import { api } from '../lib/api';
import { FRESHNESS_META, localTime, relativeTime, SEVERITY_META, utcTime } from '../lib/format';

export function SeverityTag({ severity }: { severity: AlertSeverity }) {
  const m = SEVERITY_META[severity];
  return (
    <span className={`tag ${m.cls}`}>
      <span aria-hidden="true">{m.icon}</span> {severity}
    </span>
  );
}

export function Time({ iso, relative = false }: { iso: string | null | undefined; relative?: boolean }) {
  if (!iso) return <span className="muted">—</span>;
  return (
    <time dateTime={iso} title={utcTime(iso)}>
      {relative ? relativeTime(iso) : localTime(iso)}
    </time>
  );
}

export function ExternalLink({ url, children }: { url: string | null; children: ReactNode }) {
  if (!url) return <span className="muted">{children}</span>;
  return (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void api.openExternal(url).then(ok=>{if(!ok)window.dispatchEvent(new CustomEvent('atlas-link-error',{detail:'This link was blocked by external URL validation.'}))});
      }}
      title={url}
    >
      {children} <ExternalIcon size={16} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}

export function FreshnessChip({ label, status, freshness, onRefresh }: { label: string; status: FeedStatus; freshness: Freshness; onRefresh(): void }) {
  const m = FRESHNESS_META[freshness];
  const loading = status.state === 'loading';
  const tip = [
    `${label}: ${m.label}`,
    status.lastSuccessAt ? `Last successful retrieval: ${localTime(status.lastSuccessAt)} (${utcTime(status.lastSuccessAt)})` : 'No successful retrieval yet',
    status.sourceUpdatedAt ? `Source-reported update: ${localTime(status.sourceUpdatedAt)}` : null,
    status.fromCache ? 'Showing data loaded from the local cache (original retrieval time shown).' : null,
    status.error ? `Last error: ${status.error}` : null,
    status.nextAttemptAt && status.state !== 'loading' ? `Next attempt: ${localTime(status.nextAttemptAt)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button className={`fresh-chip ${m.cls} ${status.state === 'error' ? 'has-error' : ''}`} title={tip} onClick={onRefresh} aria-label={`${tip}. Click to refresh.`}>
      <span className="fresh-icon" aria-hidden="true">
        {loading ? '⟳' : m.icon}
      </span>
      <span className="fresh-label">{label}</span>
      <span className="fresh-age">{loading ? 'Updating…' : status.lastSuccessAt ? relativeTime(status.lastSuccessAt) : m.label}</span>
      {status.fromCache && !loading && <span className="fresh-cache">cached</span>}
      {status.state === 'error' && !loading && <span className="fresh-err">retry pending</span>}
    </button>
  );
}

export function Modal({ title, onClose, children, wide = false, footer }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Runs once per open: parent re-renders (e.g. live data updates) must not move focus.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
