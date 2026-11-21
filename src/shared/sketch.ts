// Freehand sketches (Director mode): the dragged path is thinned before it is saved, so a long stroke stays a few
// hundred points. Douglas–Peucker in degrees, with longitude scaled by the cosine of the latitude so the tolerance is
// about the same distance east–west and north–south.

export const SKETCH_MAX_POINTS = 1500;

export function simplifyPath(points: [number, number][], toleranceDeg: number): [number, number][] {
  if (points.length <= 2 || !(toleranceDeg > 0)) return points.slice();
  const k = Math.cos(((points.reduce((s, p) => s + p[1], 0) / points.length) * Math.PI) / 180) || 1;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a][0] * k, ay = points[a][1], bx = points[b][0] * k, by = points[b][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = 0;
    for (let i = a + 1; i < b; i++) {
      const px = points[i][0] * k, py = points[i][1];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD > toleranceDeg) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Tolerance from the camera height: about 2 pixels on a typical screen. */
export function sketchTolerance(heightM: number): number {
  return Math.max(1e-6, (heightM / 1500) / 111_320 * 2);
}

/** A drawn box as [west, south, east, north] from two corners. */
export function boxFromCorners(a: [number, number], b: [number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function boxRing(b: [number, number, number, number]): [number, number][] {
  return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
}
