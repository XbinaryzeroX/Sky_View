import { describe, expect, it, vi } from 'vitest';
import { cameraMediaAllowed, CameraFocusStore } from '../src/renderer/lib/cameraFocus';

describe('camera board media focus', () => {
  it('suspends a normal details player while the board owns focus, then restores it', () => {
    const focus = new CameraFocusStore();
    expect(cameraMediaAllowed(true, false, focus.snapshot())).toBe(true);
    expect(cameraMediaAllowed(true, true, focus.snapshot())).toBe(false);
    const release = focus.acquireBoard();
    expect(cameraMediaAllowed(true, false, focus.snapshot())).toBe(false);
    expect(cameraMediaAllowed(true, true, focus.snapshot())).toBe(true);
    release();
    expect(cameraMediaAllowed(true, false, focus.snapshot())).toBe(true);
    expect(cameraMediaAllowed(true, true, focus.snapshot())).toBe(false);
  });

  it('does not resume background media until every board lease has been released', () => {
    const focus = new CameraFocusStore();
    const first = focus.acquireBoard();
    const second = focus.acquireBoard();
    first(); first(); // repeated cleanup (including a late callback) is idempotent
    expect(focus.snapshot()).toBe(1);
    expect(cameraMediaAllowed(true, false, focus.snapshot())).toBe(false);
    second(); second();
    expect(focus.snapshot()).toBe(0);
    expect(cameraMediaAllowed(true, false, focus.snapshot())).toBe(true);
  });

  it('disconnects both board and normal media while the document is hidden', () => {
    for (const boards of [0, 1, 2]) {
      expect(cameraMediaAllowed(false, false, boards)).toBe(false);
      expect(cameraMediaAllowed(false, true, boards)).toBe(false);
    }
  });

  it('cleans up focus observers and survives acquire/release/acquire lifecycles', () => {
    const focus = new CameraFocusStore();
    const changed = vi.fn();
    const unsubscribe = focus.subscribe(changed);
    focus.acquireBoard()();
    const release = focus.acquireBoard();
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    release();
    expect(changed).toHaveBeenCalledTimes(3);
    expect(focus.snapshot()).toBe(0);
  });
});
