export interface ImageryTileHealth { date: string; requested: number; loaded: number; failed: number; cancelled: number; lastError: string | null }
export interface ImageryHealth { product: string | null; dates: ImageryTileHealth[] }
export interface TileObserver { started(): void; loaded(): void; cancelled(): void; failed(error: unknown): void }

/** One visible dated-imagery selection. This measures requests, not whether a transparent tile contains observations. */
class ImageryHealthStore {
  private state: ImageryHealth = { product: null, dates: [] };
  private listeners = new Set<() => void>();
  private disposeCurrent = () => {};
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.state;
  private emit() { for (const callback of this.listeners) callback(); }

  selection(product: string | null, dates: string[]) {
    this.disposeCurrent();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rows = [...new Set(dates)].slice(0, 2).map((date) => ({ date, requested: 0, loaded: 0, failed: 0, cancelled: 0, lastError: null as string | null }));
    const publish = () => { if (active) { this.state = { product, dates: rows.map((row) => ({ ...row })) }; this.emit(); } };
    const changed = () => { if (active && !timer) timer = setTimeout(() => { timer = null; publish(); }, 500); };
    const dispose = () => { active = false; if (timer) clearTimeout(timer); timer = null; };
    this.disposeCurrent = dispose;
    publish();
    return {
      observer: (date: string): TileObserver => {
        const row = rows.find((value) => value.date === date);
        return {
          started: () => { if (active && row) { row.requested = Math.min(1000000, row.requested + 1); changed(); } },
          loaded: () => { if (active && row) { row.loaded = Math.min(1000000, row.loaded + 1); changed(); } },
          cancelled: () => { if (active && row) { row.cancelled = Math.min(1000000, row.cancelled + 1); changed(); } },
          failed: (error) => {
            if (!active || !row) return;
            row.failed = Math.min(1000000, row.failed + 1);
            const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
            row.lastError = typeof status === 'number' && status >= 100 && status <= 599 ? `HTTP ${status}` : 'Tile request failed';
            changed();
          },
        };
      },
      dispose,
    };
  }
}

export const imageryHealth = new ImageryHealthStore();

/** Preserve Cesium scheduler's undefined result, original payloads and rejected errors; start no extra requests. */
export function observeImageryRequests<Args extends unknown[], Result>(request: (...args: Args) => Result, observer: TileObserver, wasCancelled: (args: Args) => boolean = () => false): (...args: Args) => Result {
  return (...args) => {
    let result: Result;
    try { result = request(...args); }
    catch (error) { observer.started(); observer.failed(error); throw error; }
    if (result === undefined) return result;
    observer.started();
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      return Promise.resolve(result).then((value) => { observer.loaded(); return value; }, (error) => { if (wasCancelled(args)) observer.cancelled(); else observer.failed(error); throw error; }) as Result;
    }
    observer.loaded();
    return result;
  };
}
