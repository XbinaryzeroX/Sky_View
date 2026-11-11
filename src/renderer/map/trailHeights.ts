// Heights for recorded trail points (pure, unit-tested); used by LayerRenderer.showTrail.

/** What a trail belongs to: aircraft and ships follow the scene's sea level; other layers (transit) stay at 0. */
export type TrailKind = 'aircraft' | 'vessel' | 'other';

export interface TrailPoint {
  lat: number;
  lon: number;
  /** Reported altitude above sea level (barometric), metres; null when not reported. */
  altM: number | null;
  /** Reported on the ground; null when unknown (older recordings, ships). */
  onGround: boolean | null;
}

/**
 * Height to draw a trail point at, or null to leave it out.
 * - Other layers (e.g. transit): 0, as their markers.
 * - Ships: sea level.
 * - Aircraft reported on the ground: on Google 3D tiles the ground under it (terrain + sea level, from `ground()`;
 *   sea level until that is known), on the app's globe 0 (as its icons).
 * - Aircraft with a reported altitude: altitude + sea level on Google 3D tiles (negative altitudes kept, e.g. Death
 *   Valley); on the app's globe the altitude, floored at 0 as before.
 * - Aircraft in the air (or of unknown state) without an altitude: left out, so no ground-level point is invented.
 * `sea` is local sea level in the current scene (0 on the app's globe).
 */
export function trailPointHeight(p: TrailPoint, kind: TrailKind, photoreal: boolean, sea: number, ground: () => number | null): number | null {
  if (kind === 'other') return 0;
  if (kind === 'vessel') return sea;
  if (p.onGround === true) return photoreal ? (ground() ?? sea) : 0;
  if (p.altM === null || !Number.isFinite(p.altM)) return null;
  // Below sea level is kept on Google 3D tiles (terrain can be lower than sea level); the app's globe keeps its floor at 0.
  return photoreal ? p.altM + sea : Math.max(0, p.altM);
}
