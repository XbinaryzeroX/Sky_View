// Tiny main-thread cost accounting for tile and texture processing.
// Read by the performance smoke test (window.__atlasProf); negligible overhead.

const totals: Record<string, { ms: number; n: number }> = {};
(globalThis as unknown as { __atlasProf: typeof totals }).__atlasProf = totals;

/** Adds a measured main-thread duration under `name`. */
export function profAdd(name: string, ms: number): void {
  const t = (totals[name] ??= { ms: 0, n: 0 });
  t.ms = Math.round((t.ms + ms) * 10) / 10;
  t.n++;
}

/** Times a synchronous block. */
export function prof<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    profAdd(name, performance.now() - t0);
  }
}
