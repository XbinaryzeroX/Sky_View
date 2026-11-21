// What happens when the window's renderer or the GPU process dies: a short local log line (time, process, reason,
// exit code; never coordinates, notes or URLs) and a bounded number of automatic reloads, so a crash while zooming
// brings the map back instead of leaving a blank window. No Electron imports, so the rules are unit-tested.

export const CRASH_LOG_MAX_LINES = 200;
/** At most this many automatic reloads within RELOAD_WINDOW_MS; after that the user is asked instead. */
export const MAX_RELOADS = 3;
export const RELOAD_WINDOW_MS = 5 * 60_000;

export type CrashKind = 'renderer' | 'gpu' | 'unresponsive' | 'webgl';

const clean = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || 'unknown';

export function crashLine(now: Date, kind: CrashKind, reason: string, exitCode: number | null): string {
  return `${now.toISOString()} ${kind} reason=${clean(reason)} exit=${exitCode ?? '-'}`;
}

/**
 * A one-line summary of a JavaScript stack collected from a frozen window: function name and script file with line
 * and column, at most 14 frames. Paths are cut to the file name and anything outside a plain identifier set is
 * dropped, so no query string, coordinate or note can reach the log.
 */
export function stackSummary(raw: string | null | undefined): string {
  if (!raw) return 'stack=unavailable';
  const frames: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*at\s+(?:(.*?)\s+\()?([^()\s]+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const fn = (m[1] ?? '').replace(/[^A-Za-z0-9_$.<>]/g, '').slice(0, 60) || '(anon)';
    const file = (m[2].split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
    frames.push(`${fn}@${file}:${m[3]}:${m[4]}`);
    if (frames.length >= 14) break;
  }
  return frames.length ? `stack=${frames.join(' < ')}` : 'stack=unavailable';
}

/** The log with `line` appended, keeping the newest CRASH_LOG_MAX_LINES lines. */
export function appendCrashLine(existing: string, line: string): string {
  const lines = existing.split(/\r?\n/).filter(Boolean);
  lines.push(line);
  return lines.slice(-CRASH_LOG_MAX_LINES).join('\n') + '\n';
}

/** A renderer that exited on purpose is not a crash; anything else is worth a reload. */
export function shouldRecover(reason: string): boolean {
  return reason !== 'clean-exit';
}

export class ReloadGate {
  private times: number[] = [];

  allow(nowMs: number): boolean {
    this.times = this.times.filter((t) => nowMs - t < RELOAD_WINDOW_MS);
    if (this.times.length >= MAX_RELOADS) return false;
    this.times.push(nowMs);
    return true;
  }
}
