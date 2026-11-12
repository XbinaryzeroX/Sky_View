import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RecordedFeed, TimelineFrame, TimelineRange } from '../src/shared/timeline';
import { replayDisplayRecords } from '../src/shared/timeline';

it('uses one consistent map and details identifier for repeated reply members without altering archive evidence', () => {
  const original = { id: 'a', sent: '2026-11-01T12:00:00.000Z', title: 'first' };
  const revised = { ...original, sent: '2026-11-02T12:00:00.000Z', title: 'revision' };
  const other = { ...original, id: 'b' };
  const reply = [original, other, revised, original];
  expect(replayDisplayRecords(reply, r => r.sent)).toEqual([revised, other]);
  expect(reply).toHaveLength(4);
  const unique = [original, other];
  expect(replayDisplayRecords(unique, r => r.sent)).toBe(unique);
});
import { createTimelineCursorLoader, initialTimelineCursor, timelineBounds, PlaybackBar, PlaybackFrameStatus, RecordedFeedStatus } from '../src/renderer/components/PlaybackBar';

vi.mock('../src/renderer/lib/api', () => ({
  api: { timelineRange: vi.fn(), timelineFrame: vi.fn() },
  errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const A = '2026-11-11T16:00:00.123Z', B = '2026-11-11T16:01:00.456Z', C = '2026-11-11T16:02:00.789Z';
const feed = (changes: Partial<RecordedFeed<never>> = {}): RecordedFeed<never> => ({ state: 'unknown', observedAt: null, sourceUpdatedAt: null, scope: null, validUntil: null, reason: null, records: [], ...changes });
const frame = (t: string): TimelineFrame => ({ t, points: [], nws: feed(), usgs: feed() });
const range: TimelineRange = { oldest: A, newest: C, points: 12, nwsFrames: 0, usgsFrames: 0 };
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('bounded shared playback cursor requests', () => {
  it('has one frame request in flight, coalesces intermediate scrubs, and never publishes an old cursor', async () => {
    const first = deferred<TimelineFrame>(), latest = deferred<TimelineFrame>();
    let concurrent = 0, maximum = 0;
    const read = vi.fn(async (t: string) => {
      concurrent++; maximum = Math.max(maximum, concurrent);
      try { return await (t === A ? first.promise : latest.promise); }
      finally { concurrent--; }
    });
    const pending = vi.fn(), ready = vi.fn(), failed = vi.fn();
    const loader = createTimelineCursorLoader({ read, pending, ready, failed });
    loader.seek(A); loader.seek(B); loader.seek(C);
    expect(read.mock.calls).toEqual([[A]]);
    expect(pending.mock.calls).toEqual([[A], [B], [C]]);
    first.resolve(frame(A)); await settle();
    expect(read.mock.calls).toEqual([[A], [C]]);
    expect(ready).not.toHaveBeenCalled();
    latest.resolve(frame(C)); await settle();
    expect(ready.mock.calls).toEqual([[frame(C)]]);
    expect(failed).not.toHaveBeenCalled();
    expect(maximum).toBe(1);
  });

  it('discards an obsolete error and lets only the latest cursor report success', async () => {
    const first = deferred<TimelineFrame>();
    const read = vi.fn((t: string) => t === A ? first.promise : Promise.resolve(frame(C)));
    const ready = vi.fn(), failed = vi.fn();
    const loader = createTimelineCursorLoader({ read, pending: vi.fn(), ready, failed });
    loader.seek(A); loader.seek(C); first.reject(new Error('Old SQLite request failed')); await settle();
    expect(failed).not.toHaveBeenCalled();
    expect(ready.mock.calls).toEqual([[frame(C)]]);
  });

  it.each(['success', 'error'])('drops a late %s after exit and never starts the queued request', async (outcome) => {
    const first = deferred<TimelineFrame>();
    const read = vi.fn(() => first.promise), pending = vi.fn(), ready = vi.fn(), failed = vi.fn();
    const loader = createTimelineCursorLoader({ read, pending, ready, failed });
    loader.seek(A); loader.seek(C); loader.dispose(); loader.seek(B);
    if (outcome === 'success') first.resolve(frame(A)); else first.reject(new Error('Late failure'));
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenCalledTimes(2);
    expect(ready).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });

  it('invalidates cancelled cursors without disabling later explicit seeks', async () => {
    const first = deferred<TimelineFrame>();
    const ready = vi.fn(), failed = vi.fn();
    const read = vi.fn((t: string) => t === A ? first.promise : Promise.resolve(frame(C)));
    const loader = createTimelineCursorLoader({ read, pending: vi.fn(), ready, failed });
    loader.seek(A); loader.seek(B); loader.cancel(); first.resolve(frame(A)); await settle();
    expect(ready).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1);
    loader.seek(C); await settle();
    expect(ready.mock.calls).toEqual([[frame(C)]]);
  });

  it('reports the current failure and supports retrying exactly the same cursor', async () => {
    const error = new Error('Timeline storage unavailable');
    const read = vi.fn<(t: string) => Promise<TimelineFrame>>().mockRejectedValueOnce(error).mockResolvedValueOnce(frame(A));
    const pending = vi.fn(), ready = vi.fn(), failed = vi.fn();
    const loader = createTimelineCursorLoader({ read, pending, ready, failed });
    loader.seek(A); await settle();
    expect(failed.mock.calls).toEqual([[error, A]]);
    loader.seek(A); await settle();
    expect(pending.mock.calls).toEqual([[A], [A]]);
    expect(ready.mock.calls).toEqual([[frame(A)]]);
  });
});

describe('timeline cursor selection and source status', () => {
  it.each([
    { ...range, points: 12, nwsFrames: 0, usgsFrames: 0 },
    { ...range, points: 0, nwsFrames: 2, usgsFrames: 0 },
    { ...range, points: 0, nwsFrames: 0, usgsFrames: 2 },
  ])('opens movement-only or hazard-only retained timelines at their exact oldest millisecond', (value) => {
    expect(initialTimelineCursor(value)).toBe(Date.parse(A));
    expect(timelineBounds(value)).toEqual([Date.parse(A), Date.parse(C)]);
  });

  it('keeps exact History times before/after retained bounds and without any timeline observations', () => {
    const older = '2026-10-01T00:00:00.017Z', future = '2026-12-01T00:00:00.991Z';
    expect(initialTimelineCursor(range, older)).toBe(Date.parse(older));
    expect(initialTimelineCursor(range, future)).toBe(Date.parse(future));
    expect(initialTimelineCursor({ oldest: null, newest: null, points: 0, nwsFrames: 0, usgsFrames: 0 }, older)).toBe(Date.parse(older));
    expect(initialTimelineCursor(range, C)).toBe(Date.parse(C));
  });

  it('does not invent a cursor for invalid History times, empty data or inverted bounds', () => {
    expect(initialTimelineCursor(range, 'invalid')).toBeNull();
    expect(initialTimelineCursor({ ...range, oldest: null, newest: null })).toBeNull();
    expect(timelineBounds({ ...range, oldest: C, newest: A })).toBeNull();
  });

  it('distinguishes recorded empty, partial, stale/gap and unrecorded source states', () => {
    const knownEmpty = text(renderToStaticMarkup(createElement(RecordedFeedStatus, { name: 'NWS', feed: feed({ state: 'recorded', observedAt: A, sourceUpdatedAt: B, scope: 'Active US alerts', validUntil: C }) })));
    expect(knownEmpty).toContain('NWS: recorded empty');
    expect(knownEmpty).toContain('Recorded 2026-11-11 16:00:00.123Z');
    expect(knownEmpty).toContain('Source updated 2026-11-11 16:01:00.456Z');
    expect(knownEmpty).toContain('Scope: Active US alerts');
    const partial = text(renderToStaticMarkup(createElement(RecordedFeedStatus, { name: 'USGS', feed: feed({ state: 'partial', reason: 'Some records were rejected', scope: '2.5_day' }) })));
    expect(partial).toContain('USGS: partial'); expect(partial).toContain('Some records were rejected'); expect(partial).not.toContain('recorded empty');
    const gap = text(renderToStaticMarkup(createElement(RecordedFeedStatus, { name: 'NWS', feed: feed({ state: 'gap', reason: 'The earlier frame became stale' }) })));
    expect(gap).toContain('gap · no valid recorded frame'); expect(gap).toContain('became stale');
    expect(text(renderToStaticMarkup(createElement(RecordedFeedStatus, { name: 'USGS', feed: feed() })))).toContain('USGS: unrecorded at this cursor');
  });

  it('shows actual fix observation times and allows hazard-only replay without claiming movement', () => {
    const withFixes = { ...frame(C), points: [{ layer: 'aircraft' as const, rid: 'fixture', t: A, lat: 35, lon: 139, altM: 1000, heading: null, onGround: false }] };
    const movement = text(renderToStaticMarkup(createElement(PlaybackFrameStatus, { frame: withFixes, movementRecorded: true })));
    expect(movement).toContain('1 movement fix'); expect(movement).toContain('Observed 2026-11-11 16:00:00.123Z');
    const civil = text(renderToStaticMarkup(createElement(PlaybackFrameStatus, { frame: frame(C), movementRecorded: false })));
    expect(civil).toContain('No movement recorded in the retained timeline');
    expect(civil).toContain('NWS: unrecorded'); expect(civil).toContain('USGS: unrecorded');
  });

  it('retains the existing playback region and an exit action during initial asynchronous loading', () => {
    const callback = vi.fn();
    const html = renderToStaticMarkup(createElement(PlaybackBar, { onFrame: callback, onExit: vi.fn() }));
    expect(html).toContain('aria-label="Playback"'); expect(html).toContain('data-playback-phase="range-loading"');
    expect(html).toContain('Exit playback'); expect(html).toContain('Loading recorded timeline…');
    expect(callback).not.toHaveBeenCalled();
  });
});
