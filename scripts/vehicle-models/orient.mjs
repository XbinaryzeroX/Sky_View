// Pure helpers for normalising downloaded 3D models (used by scripts/import-models.mjs, unit-tested).
//
// Sketchfab models come in any orientation and scale. Atlas Watch needs the glTF convention:
// +Z forward (nose / bow), +Y up, +X left, metres. These heuristics detect the forward axis
// from the geometry; a per-model override in the shortlist always wins, and the importer
// renders a preview of every model so a wrong guess is caught before it ships.
//   Aircraft: the vertical fin is the highest part and sits at the tail, centred left-right,
//             so the horizontal axis along which the highest points are most off-centre is the
//             fuselage, and forward is away from them.
//   Ships:    the longest horizontal axis is the length; seen from above, the bow tapers to a
//             point while the stern (transom) stays broad.

export const AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
const IDX = { X: 0, Y: 1, Z: 2 };

export function axisVector(a) {
  const s = a[0] === '-' ? -1 : 1;
  return a[1] === 'X' ? [s, 0, 0] : a[1] === 'Y' ? [0, s, 0] : [0, 0, s];
}

/** Bounds of a flat xyz array. */
export function extents(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = points[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/**
 * Up axis. Aircraft: the smallest extent is the height (span and length are both larger, even for
 * helicopters). Ships can be taller than they are wide, so size alone can't tell beam from height:
 * a hull is mirror-symmetric across its beam but not top to bottom (keel below, superstructure above),
 * so of the two axes other than the length, the less symmetric one is up.
 * The sign is assumed positive. glTF (and Sketchfab's glTF export) is +Y up, so any other answer is
 * returned with low confidence: the importer then holds the model for review instead of shipping it.
 * Returns { up, confidence } (confidence 0..1).
 */
export function detectUp(points, kind = 'aircraft') {
  const { min, max, size } = extents(points);
  let k;
  let confidence;
  if (kind === 'aircraft') {
    const order = [0, 1, 2].sort((a, b) => size[a] - size[b]);
    k = order[0];
    confidence = clamp01((size[order[1]] / (size[k] || 1e-9) - 1.2) / 1);
  } else {
    const len = [0, 1, 2].reduce((a, b) => (size[b] > size[a] ? b : a), 0);
    const [a, b] = [0, 1, 2].filter((x) => x !== len);
    const sa = asymmetry(points, a, min, max);
    const sb = asymmetry(points, b, min, max);
    k = sa >= sb ? a : b;
    confidence = clamp01(Math.abs(sa - sb) / 0.15);
  }
  if (k !== 1) confidence = Math.min(confidence, 0.3);
  return { up: '+' + 'XYZ'[k], confidence };
}

/** 0 for a point distribution that is mirror-symmetric along axis `k`, up to 1 for a one-sided one. */
function asymmetry(points, k, min, max) {
  const bins = 24;
  const h = new Array(bins).fill(0);
  const range = max[k] - min[k] || 1;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) h[Math.min(bins - 1, Math.floor(((points[i * 3 + k] - min[k]) / range) * bins))]++;
  let d = 0;
  for (let i = 0; i < bins / 2; i++) d += Math.abs(h[i] - h[bins - 1 - i]);
  return n ? d / n : 0;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Detects the forward axis (one of ±X, ±Y, ±Z, perpendicular to `up`).
 * Returns { forward, confidence } with confidence in 0..1 (below ~0.4 means a guess: check the preview).
 */
export function detectForward(points, kind, up = '+Y') {
  const u = IDX[up[1]];
  const upSign = up[0] === '-' ? -1 : 1;
  const horiz = [0, 1, 2].filter((k) => k !== u);
  const { min, max, size } = extents(points);
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const n = points.length / 3;
  const hLo = upSign > 0 ? min[u] : -max[u];
  const hRange = size[u] || 1;
  const height = (i) => upSign * points[i * 3 + u] - hLo; // 0 at the lowest point
  if (kind === 'aircraft') {
    // The top 20 % of the height range: on fixed-wing aircraft only the fin reaches up there.
    const cut = hRange * 0.8;
    const sum = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < n; i++)
      if (height(i) >= cut) {
        for (const k of horiz) sum[k] += points[i * 3 + k];
        count++;
      }
    const off = horiz.map((k) => ({ k, rel: count ? (sum[k] / count - centre[k]) / (size[k] / 2 || 1) : 0 }));
    off.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
    const [best, other] = off;
    const confidence = clamp01((Math.abs(best.rel) - Math.abs(other.rel)) / 0.4);
    return { forward: (best.rel > 0 ? '-' : '+') + 'XYZ'[best.k], confidence };
  }
  // Ships: compare the plan-view width of the last 6 % of the length at each end.
  const [a, b] = horiz;
  const len = size[a] >= size[b] ? a : b;
  const wid = len === a ? b : a;
  const band = size[len] * 0.06;
  const ends = { plus: [Infinity, -Infinity], minus: [Infinity, -Infinity] };
  for (let i = 0; i < n; i++) {
    const p = points[i * 3 + len];
    const w = points[i * 3 + wid];
    const e = p >= max[len] - band ? ends.plus : p <= min[len] + band ? ends.minus : null;
    if (!e) continue;
    if (w < e[0]) e[0] = w;
    if (w > e[1]) e[1] = w;
  }
  const width = (e) => (e[1] > e[0] ? e[1] - e[0] : 0);
  const plus = width(ends.plus);
  const minus = width(ends.minus);
  const confidence = clamp01(Math.abs(plus - minus) / (Math.max(plus, minus) || 1) / 0.3);
  return { forward: (plus < minus ? '+' : '-') + 'XYZ'[len], confidence };
}

/**
 * Row-major 3×3 rotation taking source vectors to glTF axes: forward → +Z, up → +Y, left (= up × forward) → +X.
 */
export function rotationFor(forward, up) {
  const f = axisVector(forward);
  const u = axisVector(up);
  const l = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
  if (Math.hypot(...l) < 0.5) throw new Error(`forward ${forward} and up ${up} are not perpendicular`);
  return [l, u, f]; // rows: target X = l·v, Y = u·v, Z = f·v
}

export function applyRotation(R, p) {
  return [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]];
}

/**
 * Normalising transform as a column-major 4×4 (glTF order): rotate into glTF axes, scale so the
 * length (Z extent) is `lengthM`, and move the origin to the centre of the footprint at height
 * `originY` (in rotated, unscaled model units; default: the lowest point).
 * Returns { matrix, scale, size } with `size` = [width, height, length] in metres.
 */
export function normaliseMatrix(points, forward, up, lengthM, originY = null) {
  const R = rotationFor(forward, up);
  const rotated = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const p = applyRotation(R, [points[i], points[i + 1], points[i + 2]]);
    rotated[i] = p[0];
    rotated[i + 1] = p[1];
    rotated[i + 2] = p[2];
  }
  const { min, max, size } = extents(rotated);
  if (!(size[2] > 0)) throw new Error('model has no length');
  const s = lengthM / size[2];
  const o = [(min[0] + max[0]) / 2, originY ?? min[1], (min[2] + max[2]) / 2];
  // M = S · (R · v − o): columns are s·R's columns; translation −s·o.
  const matrix = [
    s * R[0][0], s * R[1][0], s * R[2][0], 0,
    s * R[0][1], s * R[1][1], s * R[2][1], 0,
    s * R[0][2], s * R[1][2], s * R[2][2], 0,
    -s * o[0], -s * o[1], -s * o[2], 1,
  ];
  return { matrix, scale: s, size: [size[0] * s, size[1] * s, size[2] * s], rotated, min, max };
}

/**
 * Waterline for a ship already in glTF axes (+Y up, metres): models cut off at the waterline
 * (flat, full-width bottom) float as they are; full-hull models sink by their draft
 * (`draftM`, capped at 45 % of the model's height). Returns the waterline height above the lowest point.
 */
export function waterlineAboveBottom(points, draftM) {
  const { min, size } = extents(points);
  const band = size[1] * 0.03;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1] > min[1] + band) continue;
    if (points[i] < lo) lo = points[i];
    if (points[i] > hi) hi = points[i];
  }
  const bottomWidth = hi > lo ? hi - lo : 0;
  if (bottomWidth >= size[0] * 0.8) return 0; // cut at the waterline already
  return Math.min(draftM, size[1] * 0.45);
}

// glTF primitive modes.
export const MODE = { POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6 };

/**
 * Triangle list (flat vertex indices) for a surface primitive, following the glTF winding rules:
 * strip triangle i = (v[i], v[i + 1 + i % 2], v[i + 2 - i % 2]); fan triangle i = (v[i + 1], v[i + 2], v[0]).
 * Degenerate triangles (a repeated vertex) are skipped. `index(k)` returns the k-th vertex index
 * (identity when the primitive has no index buffer). Returns null for non-surface modes (points, lines).
 */
export function triangleList(mode, index, count) {
  const out = [];
  const push = (a, b, c) => {
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  };
  if (mode === MODE.TRIANGLES) for (let i = 0; i + 2 < count; i += 3) push(index(i), index(i + 1), index(i + 2));
  else if (mode === MODE.TRIANGLE_STRIP) for (let i = 0; i + 2 < count; i++) push(index(i), index(i + 1 + (i % 2)), index(i + 2 - (i % 2)));
  else if (mode === MODE.TRIANGLE_FAN) for (let i = 0; i + 2 < count; i++) push(index(i + 1), index(i + 2), index(0));
  else return null;
  return Uint32Array.from(out);
}

/**
 * Orientation to use for an import. The heuristics only suggest: a model ships only when its shortlist entry
 * confirms both `forward` and `up` (set after checking the preview), because some cases can't be told apart
 * reliably from geometry (e.g. an upside-down ship is as asymmetric as an upright one).
 */
export function orientationDecision(entry, upGuess, forwardGuess) {
  const up = entry.up ?? upGuess.up;
  const forward = entry.forward ?? forwardGuess.forward;
  const confirmed = !!(entry.up && entry.forward);
  const confidence = Math.min(entry.up ? 1 : upGuess.confidence, entry.forward ? 1 : forwardGuess.confidence);
  return { up, forward, confirmed, confidence, review: !confirmed };
}
