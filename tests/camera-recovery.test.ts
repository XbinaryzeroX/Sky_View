import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraRecovery, refreshedImageUrl } from '../src/renderer/lib/cameraRecovery';

afterEach(() => vi.useRealTimers());

describe('camera playback recovery lifecycle', () => {
  it('cancels pending stream reconnects when the player is closed or the camera changes', () => {
    vi.useFakeTimers();
    const recovery = new CameraRecovery();
    const reconnect = vi.fn();
    recovery.schedule(reconnect, 300);
    recovery.schedule(reconnect, 1500);
    recovery.dispose();
    vi.advanceTimersByTime(10_000);
    expect(reconnect).not.toHaveBeenCalled();
    expect(recovery.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart an old camera after a new camera has started', () => {
    vi.useFakeTimers();
    const oldCamera = new CameraRecovery();
    const currentCamera = new CameraRecovery();
    const reconnectOld = vi.fn();
    const reconnectCurrent = vi.fn();
    oldCamera.schedule(reconnectOld, 8000);
    oldCamera.dispose();
    oldCamera.schedule(reconnectOld, 300); // a late decoder callback
    currentCamera.schedule(reconnectCurrent, 1500);
    vi.advanceTimersByTime(10_000);
    expect(reconnectOld).not.toHaveBeenCalled();
    expect(reconnectCurrent).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('camera still refresh URLs', () => {
  it('preserves publisher parameters and puts the refresh token before the fragment', () => {
    const url = new URL(refreshedImageUrl('https://camera.example/image.jpg?camera=12#view', 'retry-1'));
    expect(url.searchParams.get('camera')).toBe('12');
    expect(url.searchParams.get('_atlasRefresh')).toBe('retry-1');
    expect(url.hash).toBe('#view');
  });

  it('changes the request on retry without accumulating duplicate refresh parameters', () => {
    const first = refreshedImageUrl('https://camera.example/image.jpg', '1');
    const second = refreshedImageUrl(first, '2');
    expect(second).not.toBe(first);
    expect(new URL(second).searchParams.getAll('_atlasRefresh')).toEqual(['2']);
  });

  it('keeps existing query bytes unchanged rather than re-encoding signed publisher parameters', () => {
    expect(refreshedImageUrl('https://camera.example/still?name=Road%20A&sig=a%2fb%3d', '3'))
      .toBe('https://camera.example/still?name=Road%20A&sig=a%2fb%3d&_atlasRefresh=3');
  });
});
