/** Approximate viewpoints in the supplied cabin model, not an aircraft's real seat map. */
export const CABIN_ROWS = [1, 2, 3, 4] as const;
export const CABIN_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const DEFAULT_CABIN_SEAT = '1F';
export function cabinSeatPoint(seat: string): [number, number, number] {
  const match = /^([1-4])([A-F])$/.exec(seat);
  if (!match) return cabinSeatPoint(DEFAULT_CABIN_SEAT);
  const col = CABIN_COLUMNS.indexOf(match[2] as typeof CABIN_COLUMNS[number]);
  return [4.99 - (Number(match[1]) - 1) * .82, 6.35, [-2.15, -1.45, -.75, .75, 1.45, 2.15][col]];
}
