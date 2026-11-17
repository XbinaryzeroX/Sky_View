// One audio element for the whole app, so a station keeps playing when the Radio page closes. Streams come only from
// the app's radio relay (app://atlas/radio-stream/<station id>); the renderer never builds a station URL itself.
import { useSyncExternalStore } from 'react';
import type { RadioKind, RadioStation } from '../../shared/radio';

export type RadioState = { station: RadioStation | null; status: 'stopped' | 'loading' | 'playing' | 'error'; volume: number; error: string | null };

let state: RadioState = { station: null, status: 'stopped', volume: 0.8, error: null };
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
const set = (p: Partial<RadioState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('playing', () => set({ status: 'playing', error: null }));
  audio.addEventListener('waiting', () => { if (state.station) set({ status: 'loading' }); });
  audio.addEventListener('error', () => { if (state.station) set({ status: 'error', error: 'The station stopped or sent no audio. Try another station.' }); });
  return audio;
}

export const radio = {
  play(station: RadioStation): void {
    const a = element();
    set({ station, status: 'loading', error: null });
    a.src = `app://atlas/radio-stream/${station.id}`;
    a.volume = state.volume;
    void a.play().catch(() => set({ status: 'error', error: 'The station could not be played.' }));
  },
  stop(): void {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    set({ station: null, status: 'stopped', error: null });
  },
  volume(v: number): void {
    const vol = Math.min(1, Math.max(0, v));
    if (audio) audio.volume = vol;
    set({ volume: vol });
  },
};

export function useRadio(): RadioState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

/** A search another part of the app asks the Radio page to run when it opens (e.g. ATC near an airport). */
let intent: { query: string; kind: RadioKind; near: { lat: number; lon: number } | null } | null = null;
export function setRadioIntent(i: typeof intent): void { intent = i; window.dispatchEvent(new CustomEvent('atlas:open-page', { detail: 'radio' })); }
export function takeRadioIntent(): typeof intent { const i = intent; intent = null; return i; }
