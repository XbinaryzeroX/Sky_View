// Top-bar chip while a watch area is recorded in the background: which area, what each feed last recorded, and a
// stop button. Polls the main process every 15 s while shown; the recording itself runs in the main process.
import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { watchArea, type AreaRecordingStatus, type RecordTask } from '../../shared/watchAreas';
import { api } from '../lib/api';

const TASK_LABEL: Record<RecordTask, string> = { aircraft: 'Aircraft', aircraftMil: 'Military aircraft', vessels: 'Ships', gnss: 'GPS accuracy cells', conflicts: 'Conflict reports' };

export function recordingSummary(s: AreaRecordingStatus | null): string {
  if (!s?.areaId) return 'Not recording';
  const lines = (Object.keys(TASK_LABEL) as RecordTask[]).map((t) => {
    const x = s.tasks[t];
    if (!x) return `${TASK_LABEL[t]}: waiting for the first poll`;
    const at = new Date(x.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return x.ok ? `${TASK_LABEL[t]}: ${x.count} at ${at}` : `${TASK_LABEL[t]}: not recorded at ${at} (${x.error ?? 'failed'})`;
  });
  return [`Recording ${s.areaName ?? s.areaId} since ${s.startedAt ? new Date(s.startedAt).toLocaleString() : 'unknown'}`, ...lines].join('\n');
}

export function RecordingChip({ areaId, onStop }: { areaId: string; onStop(): void }) {
  const [status, setStatus] = useState<AreaRecordingStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api.recordingStatus().then((s) => { if (live) setStatus(s); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, [areaId]);
  const failing = status ? Object.values(status.tasks).some((x) => x && !x.ok) : false;
  const name = watchArea(areaId)?.name ?? areaId;
  return (
    <div className={`rec-chip ${failing ? 'rec-partial' : ''}`} role="status" title={recordingSummary(status)}>
      <span className="rec-dot" aria-hidden="true" />
      <span>REC {name}{failing ? ' · partial' : ''}</span>
      <button className="icon-btn" onClick={onStop} aria-label={`Stop recording ${name}`}><Square size={12} aria-hidden="true" /></button>
    </div>
  );
}
