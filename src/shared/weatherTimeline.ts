// One history timeline for the observed-weather overlays (radar, lightning density, weather satellites).
// The timeline is "minutes back from the newest frame", in 10-minute steps over four hours (lightning frames end at
// about 4.5 hours, so the whole range stays inside every source). Radar and lightning come
// from NOAA nowCOAST, whose WMS keeps several hours of frames and answers a requested time with its nearest frame
// (capabilities read on 2026-11-15: radar about every 4 minutes for 7 hours, lightning every 15 minutes for 4.5 hours).
// Satellite frames are 10 minutes apart (GIBS) or hourly (EUMETSAT). Everything here is an observation at a past
// time; nothing is interpolated between frames.

export const WEATHER_STEP_MIN = 10;
export const WEATHER_MAX_BACK_MIN = 240;
/** Seconds each frame stays up while playing: tiles for a frame need time to arrive. */
export const WEATHER_PLAY_FRAME_MS = 1500;

const MIN = 60_000;

/** A valid offset: a whole number of steps between 0 (newest) and the maximum. */
export function clampBack(backMin: number): number {
  if (!Number.isFinite(backMin)) return 0;
  return Math.max(0, Math.min(WEATHER_MAX_BACK_MIN, Math.round(backMin / WEATHER_STEP_MIN) * WEATHER_STEP_MIN));
}

/** One step towards the past (+1) or the present (-1). */
export function stepBack(backMin: number, direction: 1 | -1): number {
  return clampBack(backMin + direction * WEATHER_STEP_MIN);
}

/** While playing: the next frame towards the present, wrapping from the newest back to the oldest. */
export function nextPlayFrame(backMin: number): number {
  const b = clampBack(backMin);
  return b === 0 ? WEATHER_MAX_BACK_MIN : b - WEATHER_STEP_MIN;
}

/**
 * The time asked of nowCOAST for an offset: the wall clock minus the offset, floored to the step so that the same
 * frame is requested (and cached) for the whole step. Null for "newest" (no time parameter: the service default).
 */
export function wmsTime(nowMs: number, backMin: number): string | null {
  const b = clampBack(backMin);
  if (b === 0) return null;
  const step = WEATHER_STEP_MIN * MIN;
  return new Date(Math.floor((nowMs - b * MIN) / step) * step).toISOString().replace('.000Z', 'Z');
}

const FRAME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * The satellite frame for an offset, counted back from the newest frame the publisher lists (10-minute frames).
 * Null when there is no newest frame: an unknown frame stays unknown.
 */
export function satFrameBack(latest: string | null, backMin: number): string | null {
  if (!latest || !FRAME.test(latest)) return null;
  const t = Date.parse(latest);
  if (!Number.isFinite(t)) return null;
  return new Date(t - clampBack(backMin) * MIN).toISOString().replace('.000Z', 'Z');
}

/** "Newest" or "40 min before the newest frame". */
export function backLabel(backMin: number): string {
  const b = clampBack(backMin);
  if (b === 0) return 'Newest frames';
  return b % 60 === 0 ? `${b / 60} h before the newest frames` : `${b} min before the newest frames`;
}
