// Two view helpers: the tilt switch (straight down or a 35° oblique) and the "global picture" switch, which turns on
// the worldwide layers for a whole-globe look and gives the previous view and layers back when it is switched off.
// Pure rules only; the camera and settings are moved by the renderer.

import type { LayerId } from './layers';

/** Camera pitch for the oblique view: 35° away from straight down (pitch -90° is straight down). */
export const TILT_OBLIQUE_RAD = (-(90 - 35) * Math.PI) / 180;
const STRAIGHT_DOWN_RAD = -Math.PI / 2;
/** Within 10° of straight down counts as "not tilted". */
const NEAR_DOWN_RAD = (10 * Math.PI) / 180;

export function isTilted(pitchRad: number | null | undefined): boolean {
  return typeof pitchRad === 'number' && Number.isFinite(pitchRad) && pitchRad - STRAIGHT_DOWN_RAD > NEAR_DOWN_RAD;
}

/** The pitch the tilt switch goes to from the current one: oblique from (near) straight down, straight down otherwise. */
export function nextTiltPitch(pitchRad: number): number {
  return isTilted(pitchRad) ? STRAIGHT_DOWN_RAD : TILT_OBLIQUE_RAD;
}

/**
 * Layers the global picture turns on: worldwide, keyless, and not tied to the area in view. Earthquakes and U.S.
 * alerts are always on the map already.
 */
export const GLOBAL_PICTURE_LAYERS: LayerId[] = ['aircraftMil', 'satellites', 'cyclones', 'incidents', 'launches', 'conflicts'];

/** Whole-globe camera height, metres. */
export const GLOBAL_PICTURE_HEIGHT_M = 22_000_000;

/** Entering: the layer list with the global ones added, and which of them were added (the rest were already on). */
export function enterGlobalPicture(enabled: readonly string[]): { enabled: string[]; added: LayerId[] } {
  const on = new Set(enabled);
  const added = GLOBAL_PICTURE_LAYERS.filter((id) => !on.has(id));
  return { enabled: [...enabled, ...added], added };
}

/**
 * Leaving: only the layers the switch itself added are turned off again. A layer the user had on before stays on,
 * and anything they switched on or off while the global picture was up is left as they set it.
 */
export function leaveGlobalPicture(enabled: readonly string[], added: readonly string[]): string[] {
  const drop = new Set(added);
  return enabled.filter((id) => !drop.has(id));
}

/** What is kept while the global picture is up, so the exact view and layers can come back (also across a restart). */
export interface GlobalPictureState {
  added: string[];
  camera: { lat: number; lon: number; heightM: number; heading: number; pitch: number } | null;
}

/** Reads a stored state; anything malformed is treated as "not in the global picture". */
export function parseGlobalPictureState(raw: string | null): GlobalPictureState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { added?: unknown; camera?: unknown };
    if (!Array.isArray(v.added) || v.added.length > GLOBAL_PICTURE_LAYERS.length) return null;
    const added = v.added.filter((x): x is string => typeof x === 'string' && (GLOBAL_PICTURE_LAYERS as string[]).includes(x));
    const c = v.camera as Record<string, unknown> | null | undefined;
    const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    const camera = c && num(c.lat) && num(c.lon) && num(c.heightM) && num(c.heading) && num(c.pitch) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && c.heightM > 0
      ? { lat: c.lat, lon: c.lon, heightM: c.heightM, heading: c.heading, pitch: c.pitch }
      : null;
    return { added, camera };
  } catch {
    return null;
  }
}
