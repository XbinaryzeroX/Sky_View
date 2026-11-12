/// <reference lib="webworker" />
import { predictSatellitePasses, type PassObserver } from '../../shared/satellitePasses';

export interface PassRequest { tle: [string, string]; observer: PassObserver; startMs: number; thresholdDeg: number }
self.onmessage = (event: MessageEvent<PassRequest>) => {
  const q = event.data;
  try { self.postMessage({ ok: true, result: predictSatellitePasses(q.tle, q.observer, q.startMs, q.thresholdDeg) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Satellite prediction failed.' }); }
};
