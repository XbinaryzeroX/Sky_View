export type Axis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
type Points = ArrayLike<number>;
export const AXES: Axis[];
export function axisVector(a: Axis): [number, number, number];
export function extents(points: Points): { min: number[]; max: number[]; size: number[] };
export function detectUp(points: Points, kind?: 'aircraft' | 'ship'): { up: Axis; confidence: number };
export function detectForward(points: Points, kind: 'aircraft' | 'ship', up?: Axis): { forward: Axis; confidence: number };
export function rotationFor(forward: Axis, up: Axis): number[][];
export function applyRotation(R: number[][], p: number[]): number[];
export function normaliseMatrix(
  points: Points,
  forward: Axis,
  up: Axis,
  lengthM: number,
  originY?: number | null,
): { matrix: number[]; scale: number; size: number[]; rotated: Float64Array; min: number[]; max: number[] };
export function waterlineAboveBottom(points: Points, draftM: number): number;
export const MODE: { POINTS: 0; LINES: 1; LINE_LOOP: 2; LINE_STRIP: 3; TRIANGLES: 4; TRIANGLE_STRIP: 5; TRIANGLE_FAN: 6 };
export function triangleList(mode: number, index: (k: number) => number, count: number): Uint32Array | null;
export function orientationDecision(
  entry: { up?: Axis; forward?: Axis },
  upGuess: { up: Axis; confidence: number },
  forwardGuess: { forward: Axis; confidence: number },
): { up: Axis; forward: Axis; confirmed: boolean; confidence: number; review: boolean };
