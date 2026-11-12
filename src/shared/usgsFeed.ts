/** Lowest magnitude included by the USGS summary requested for a display filter. */
export function usgsMagnitudeFloor(minMagnitude: number): number | null {
  if (minMagnitude >= 4.5) return 4.5;
  if (minMagnitude >= 2.5) return 2.5;
  if (minMagnitude >= 1) return 1;
  return null;
}
