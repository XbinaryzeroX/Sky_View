// Small pool of terrain decode workers (see terrainWorker.ts). Uses up to half the
// logical CPU cores (2–4), so tile decoding runs in parallel and never blocks the
// map's main thread. Every job has a timeout, and a crashed worker rejects its
// jobs and is replaced, so a tile can never stay "loading" forever. Falls back to
// main-thread decoding if workers cannot start.

type Pending = { resolve(v: unknown): void; reject(e: Error): void; worker: number; timer: ReturnType<typeof setTimeout> };

const JOB_TIMEOUT_MS = 25_000;

class Pool {
  private workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private pending = new Map<number, Pending>();
  readonly ok: boolean;

  constructor() {
    let ok = true;
    try {
      const n = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
      for (let i = 0; i < n; i++) this.workers.push(this.spawn(i));
    } catch {
      ok = false;
    }
    this.ok = ok && this.workers.length > 0;
  }

  private spawn(index: number): Worker {
    const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; data?: unknown; error?: string }>) => this.settle(e.data.id, e.data.ok, e.data.data, e.data.error);
    w.onerror = () => {
      // Reject everything this worker owed and start a fresh one in its place.
      for (const [id, p] of this.pending) if (p.worker === index) this.settle(id, false, undefined, 'worker crashed');
      try {
        w.terminate();
      } catch {
        // already gone
      }
      this.workers[index] = this.spawn(index);
    };
    return w;
  }

  private settle(id: number, ok: boolean, data: unknown, error?: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (ok) p.resolve(data);
    else p.reject(new Error(error ?? 'worker error'));
  }

  run<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    const index = this.next++ % this.workers.length;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, false, undefined, 'worker timeout'), JOB_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, worker: index, timer });
      this.workers[index].postMessage({ ...msg, id }, transfer);
    });
  }
}

let pool: Pool | null = null;
export function terrainPool(): Pool | null {
  if (!pool) pool = new Pool();
  return pool.ok ? pool : null;
}
