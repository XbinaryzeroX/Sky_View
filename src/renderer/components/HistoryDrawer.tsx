import { useCallback, useEffect, useState } from 'react';
import type { AlertSeverity, AppSnapshot, HistoryPage, HistoryQuery, HistoryRecordDetail } from '../../shared/types';
import { api, errorText } from '../lib/api';
import { quakeClass, SEVERITY_META, SEVERITY_ORDER } from '../lib/format';
import { Empty, Time } from './common';

interface Props {
  snap: AppSnapshot;
  open: boolean;
  onToggle(): void;
  search: string;
  onOpenRecord(r: HistoryRecordDetail): void;
  onOpenSettings(): void;
}

const PAGE = 100;

export function HistoryDrawer(p: Props) {
  const [kind, setKind] = useState<'all' | 'alert' | 'quake'>('all');
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [minMag, setMinMag] = useState<string>('');
  const [since, setSince] = useState<'all' | '24h' | '7d'>('all');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    const q: HistoryQuery = {
      text: p.search || undefined,
      kind,
      severity: kind === 'quake' ? 'all' : severity,
      minMagnitude: minMag === '' ? null : Number(minMag),
      since: since === 'all' ? null : new Date(Date.now() - (since === '24h' ? 86400_000 : 7 * 86400_000)).toISOString(),
      includeSuperseded,
      limit,
      offset: 0,
    };
    try {
      setPage(await api.queryHistory(q));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [p.search, kind, severity, minMag, since, includeSuperseded, limit]);

  // Reload when filters change, the drawer opens, or feeds refresh.
  useEffect(() => {
    if (p.open) void load();
  }, [p.open, load, p.snap.feeds.nws.lastSuccessAt, p.snap.feeds.usgs.lastSuccessAt]);

  async function open(key: string) {
    try {
      const r = await api.getHistory(key);
      if (r) p.onOpenRecord(r);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function clear() {
    await api.clearHistory();
    setConfirmClear(false);
    void load();
  }

  return (
    <section className={`history ${p.open ? 'open' : ''}`} aria-label="Event history">
      <button className="history-toggle" onClick={p.onToggle} aria-expanded={p.open}>
        <span aria-hidden="true">{p.open ? '▾' : '▸'}</span> Event history
        <span className="muted small">
          {' '}
          — records observed while Atlas Watch was running{page ? ` · ${page.storedTotal} stored` : ''}
        </span>
      </button>
      {p.open && (
        <div className="history-body">
          <div className="history-filters">
            <select aria-label="Record type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">All types</option>
              <option value="alert">Weather alerts</option>
              <option value="quake">Earthquakes</option>
            </select>
            {kind !== 'quake' && (
              <select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="all">Any severity</option>
                {SEVERITY_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            {kind !== 'alert' && (
              <select aria-label="Minimum magnitude" value={minMag} onChange={(e) => setMinMag(e.target.value)}>
                <option value="">Any magnitude</option>
                {[2.5, 3, 4, 4.5, 5, 6].map((m) => (
                  <option key={m} value={m}>
                    M{m}+
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Observed since" value={since} onChange={(e) => setSince(e.target.value as typeof since)}>
              <option value="all">Any time</option>
              <option value="24h">Seen in last 24 h</option>
              <option value="7d">Seen in last 7 days</option>
            </select>
            <label className="small">
              <input type="checkbox" checked={includeSuperseded} onChange={(e) => setIncludeSuperseded(e.target.checked)} /> Include superseded revisions
            </label>
            <span className="spacer" />
            <span className="muted small">
              Retention: {p.snap.settings.historyRetentionDays} days / {p.snap.settings.historyMaxRecords} records ·{' '}
              <button className="link-btn" onClick={p.onOpenSettings}>
                change
              </button>
            </span>
            {confirmClear ? (
              <span className="confirm">
                Delete all stored history?{' '}
                <button className="btn danger small-btn" onClick={() => void clear()}>
                  Delete
                </button>{' '}
                <button className="btn small-btn" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn small-btn" onClick={() => setConfirmClear(true)} disabled={!page || page.storedTotal === 0}>
                Clear history
              </button>
            )}
          </div>
          {error && <div className="error-line">{error}</div>}
          <div className="history-table-wrap">
            {page && page.records.length === 0 ? (
              <Empty>{page.storedTotal === 0 ? 'No records observed yet. History fills as Atlas Watch retrieves feeds while running.' : 'No records match these filters.'}</Empty>
            ) : (
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Record</th>
                    <th>Severity / magnitude</th>
                    <th>Event time</th>
                    <th>Source updated</th>
                    <th>First observed</th>
                    <th>Last observed</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.records.map((r) => {
                    const sevMeta = r.severity && r.severity in SEVERITY_META ? SEVERITY_META[r.severity as AlertSeverity] : null;
                    const qc = r.kind === 'quake' ? quakeClass(r.magnitude) : null;
                    return (
                      <tr key={r.key} className={r.supersededBy ? 'superseded' : ''}>
                        <td>{r.kind === 'alert' ? 'Alert' : 'Quake'}</td>
                        <td>
                          <button className="link-btn" onClick={() => void open(r.key)}>
                            {r.title}
                          </button>
                          {r.supersededBy && <span className="muted small"> (superseded)</span>}
                        </td>
                        <td>
                          {sevMeta && (
                            <span className={`tag ${sevMeta.cls}`}>
                              <span aria-hidden="true">{sevMeta.icon}</span> {r.severity}
                            </span>
                          )}
                          {qc && <span className={`tag ${qc.cls}`}>{qc.label}</span>}
                        </td>
                        <td>
                          <Time iso={r.eventTime} />
                        </td>
                        <td>
                          <Time iso={r.sourceUpdated} />
                        </td>
                        <td>
                          <Time iso={r.firstObservedAt} />
                        </td>
                        <td>
                          <Time iso={r.lastObservedAt} relative />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {page && page.total > page.records.length && (
              <button className="btn load-more" onClick={() => setLimit(limit + PAGE)}>
                Show more ({page.total - page.records.length} remaining)
              </button>
            )}
          </div>
          <p className="muted small history-note">
            This is not a complete archive: Atlas Watch records only what it retrieved while running, within the retention limits.
            {page?.oldestObservedAt ? (
              <>
                {' '}
                Oldest stored observation: <Time iso={page.oldestObservedAt} />.
              </>
            ) : null}
          </p>
        </div>
      )}
    </section>
  );
}
