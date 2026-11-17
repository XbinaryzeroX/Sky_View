/// <reference lib="webworker" />
// Runs the coverage model off the main thread so the globe never freezes; the page cancels by terminating it.
import { addObserverToDisplay, computeViewshed, displayAccumulator, displayCombined, displayRgba, displayRgbaGlow, toLocal, type Grid, type Observer } from '../../shared/viewshed';
import { fineBuildings, type Footprint } from '../../shared/siteRaster';

export interface ViewshedRequest {
  grid: Grid;
  ground: Float32Array;
  buildings: Float32Array;
  bases: Float32Array;
  observers: { id: string; observer: Observer }[];
  targetHeightM: number;
  /** Building outlines, so sight lines are traced against them at a quarter cell rather than against whole cells. */
  footprints?: Footprint[];
}
export type ViewshedMessage =
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done';
      perObserver: { id: string; counts: Record<string, number>; error: string | null }[];
      /** Combined class per picture pixel, on `pictureGrid`. */
      combined: Uint8Array;
      combinedCounts: Record<string, number>;
      /** The picture (one RGBA pixel per `pictureGrid` cell). */
      rgba: Uint8ClampedArray;
      /** The same picture in the site-view style (only what is seen is lit). */
      rgbaGlow: Uint8ClampedArray;
      pictureGrid: Grid;
    }
  | { type: 'error'; error: string };

self.onmessage = (event: MessageEvent<ViewshedRequest>) => {
  const q = event.data;
  try {
    const per: { id: string; counts: Record<string, number>; error: string | null }[] = [];
    const acc = displayAccumulator(q.grid);
    const fine = q.footprints ? fineBuildings(q.grid, q.buildings, q.footprints) : undefined;
    q.observers.forEach((o, i) => {
      const input = { grid: q.grid, ground: q.ground, buildings: q.buildings, bases: q.bases, observer: o.observer, targetHeightM: q.targetHeightM };
      // The cell model supplies the error message and the fallback for points that cannot be traced.
      const r = computeViewshed(input);
      const counts = addObserverToDisplay(acc, input, r.classes, fine);
      per.push({ id: o.id, counts, error: r.error });
      self.postMessage({ type: 'progress', done: i + 1, total: q.observers.length } satisfies ViewshedMessage);
    });
    // Points that could not be modelled contribute UNKNOWN over their area, so they never turn into gaps.
    const combined = displayCombined(acc);
    const rgba = displayRgba(acc);
    const rgbaGlow = displayRgbaGlow(acc, q.observers.map((o) => ({ ...toLocal(q.grid, o.observer.lat, o.observer.lon), rangeM: o.observer.rangeM })));
    const msg: ViewshedMessage = { type: 'done', perObserver: per, combined: combined.classes, combinedCounts: combined.counts, rgba, rgbaGlow, pictureGrid: acc.pictureGrid };
    self.postMessage(msg, [rgba.buffer, rgbaGlow.buffer, combined.classes.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'Coverage analysis failed.' } satisfies ViewshedMessage);
  }
};
