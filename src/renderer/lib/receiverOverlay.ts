// Shared state for the receiver coverage outline: set by the Layers panel, drawn by the globe.
type Ring = [number, number][] | null;
let ring: Ring = null;
const listeners = new Set<() => void>();

export const receiverOverlay = {
  get: (): Ring => ring,
  set(next: Ring): void {
    ring = next;
    for (const l of listeners) l();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
