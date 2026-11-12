/** Delayed recovery belongs to one playback session; switching cameras disposes all pending work. */
export class CameraRecovery {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  get active(): boolean {
    return !this.disposed;
  }

  schedule(callback: () => void, delayMs: number): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) callback();
    }, delayMs);
    this.timers.add(timer);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}

/** Keep a still-image request stable between refreshes and preserve the publisher's query and fragment. */
export function refreshedImageUrl(url: string, request: string): string {
  const hashAt = url.indexOf('#');
  const base = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : url.slice(hashAt);
  const queryAt = base.indexOf('?');
  const path = queryAt < 0 ? base : base.slice(0, queryAt);
  // Do not re-encode the publisher's query: signed image URLs can depend on its exact bytes.
  const params = queryAt < 0 ? [] : base.slice(queryAt + 1).split('&').filter(p => p && !p.startsWith('_atlasRefresh='));
  return `${path}?${[...params, `_atlasRefresh=${encodeURIComponent(request)}`].join('&')}${fragment}`;
}
