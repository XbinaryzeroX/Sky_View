import { describe, expect, it } from 'vitest';
import { AtlasStore } from '../src/main/store';
import { DEFAULT_SETTINGS, IPC, settingsPatchSchema, validateIpcArgs } from '../src/shared/ipc';
import { localInput, REPLAY_FIX_WINDOW_MS, TRACK_MAX_RETENTION_HOURS, trackPointBudget } from '../src/shared/timeline';
import { tempDbPath } from './helpers';

const at = (iso: string, sec: number) => new Date(Date.parse(iso) + sec * 1000).toISOString();

describe('longer movement history', () => {
  it('allows up to 30 days and a storage limit, and keeps old settings valid', () => {
    expect(DEFAULT_SETTINGS.trackStorageMB).toBe(250);
    expect(() => validateIpcArgs(IPC.settingsUpdate, [{ trackRetentionHours: TRACK_MAX_RETENTION_HOURS, trackStorageMB: 1000 }])).not.toThrow();
    expect(settingsPatchSchema.safeParse({ trackRetentionHours: 721 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ trackStorageMB: 10 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ trackStorageMB: 5000 }).success).toBe(false);
    // A database saved before this change has no trackStorageMB: the default fills it in.
    const store = new AtlasStore(tempDbPath());
    const { trackStorageMB: _unused, ...older } = DEFAULT_SETTINGS;
    void _unused;
    store.saveSettings({ ...older, trackRetentionHours: 48 } as never);
    expect(store.getSettings().trackStorageMB).toBe(250);
    expect(store.getSettings().trackRetentionHours).toBe(48);
  });

  it('turns the storage limit into a point budget from the measured size per fix', () => {
    expect(trackPointBudget(250)).toBe(1_470_588);
    expect(trackPointBudget(1)).toBe(trackPointBudget(20));
    expect(trackPointBudget(Number.NaN)).toBe(trackPointBudget(250));
  });

  it('thins only the given stretch to the first fix per object per minute', () => {
    const store = new AtlasStore(tempDbPath());
    const base = '2026-11-01T10:00:00.000Z';
    const pts = (rid: string, from: number, to: number) => Array.from({ length: (to - from) / 20 }, (_, i) => ({ rid, t: at(base, from + i * 20), lat: 50, lon: 10, alt: 1000, heading: 90, ground: false }));
    // Two aircraft, a fix every 20 s for 3 minutes, then 2 minutes of recent fixes.
    store.addTrackPoints('aircraft', [...pts('a', 0, 180), ...pts('b', 0, 180), ...pts('a', 180, 300)]);
    expect(store.trackRange().points).toBe(9 + 9 + 6);
    const removed = store.thinTracks(base, at(base, 180));
    expect(removed).toBe(12); // 3 kept per aircraft in the thinned stretch
    expect(store.trackFor('aircraft', 'a').map((p) => p.t.slice(11, 19))).toEqual(['10:00:00', '10:01:00', '10:02:00', '10:03:00', '10:03:20', '10:03:40', '10:04:00', '10:04:20', '10:04:40']);
    expect(store.thinTracks(at(base, 180), at(base, 180))).toBe(0);
  });

  it('still replays a thinned stretch: each object has a fix within the replay window', () => {
    const store = new AtlasStore(tempDbPath());
    const base = '2026-11-01T10:00:00.000Z';
    store.addTrackPoints('aircraft', Array.from({ length: 30 }, (_, i) => ({ rid: 'a', t: at(base, i * 20), lat: 50 + i / 100, lon: 10, alt: 1000, heading: 0 })));
    store.thinTracks(base, at(base, 600));
    expect(REPLAY_FIX_WINDOW_MS).toBeGreaterThan(60_000);
    const snap = store.trackSnapshot('aircraft', at(base, 290), REPLAY_FIX_WINDOW_MS);
    expect(snap).toHaveLength(1);
    expect(snap[0].t).toBe(at(base, 240)); // the kept fix for 10:04
  });

  it('removes the oldest fixes first when the budget is reached, whatever the retention', () => {
    const store = new AtlasStore(tempDbPath());
    const now = new Date('2026-11-14T12:00:00Z');
    store.addTrackPoints('vessels', Array.from({ length: 50 }, (_, i) => ({ rid: 'v', t: at('2026-11-14T00:00:00Z', i * 60), lat: 60, lon: 25, alt: null, heading: null })));
    store.pruneTracks(TRACK_MAX_RETENTION_HOURS, 20, now);
    const r = store.trackRange();
    expect(r.points).toBe(20);
    expect(r.oldest).toBe(at('2026-11-14T00:00:00Z', 30 * 60));
  });

  it('formats a local date and time for the playback jump field', () => {
    const ms = new Date(2026, 10, 3, 7, 5, 59).getTime();
    expect(localInput(ms)).toBe('2026-11-03T07:05');
  });
});
