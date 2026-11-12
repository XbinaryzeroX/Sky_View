import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/** A board owns camera-media focus until its last lease is released, including portal transitions. */
export class CameraFocusStore {
  private boards = 0;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.boards;
  acquireBoard(): () => void {
    this.boards++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.boards--;
      this.emit();
    };
  }
  private emit() { for (const listener of this.listeners) listener(); }
}

export const cameraFocus = new CameraFocusStore();

export function cameraMediaAllowed(visible: boolean, boardContext: boolean, boards: number): boolean {
  return visible && (boardContext ? boards > 0 : boards === 0);
}

const pageVisible = () => typeof document === 'undefined' || !document.hidden;
const subscribeVisible = (listener: () => void) => {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};
export function useCameraPageVisible(): boolean {
  return useSyncExternalStore(subscribeVisible, pageVisible, () => true);
}

/** Delay board players until its lease has suspended normal media bodies in the same React commit. */
export function useBoardCameraFocus(): boolean {
  const [owned, setOwned] = useState(false);
  useLayoutEffect(() => {
    const release = cameraFocus.acquireBoard();
    setOwned(true);
    return release;
  }, []);
  return owned;
}
