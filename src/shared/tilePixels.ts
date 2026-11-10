// Pure pixel helpers for USGS no-data handling (see renderer/map/usgsProvider.ts).

/** Makes near-white pixels transparent (USGS no-data fill). Returns the number cleared. */
export function clearNoDataPixels(rgba: Uint8ClampedArray, threshold = 250): number {
  let cleared = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 0 && rgba[i] >= threshold && rgba[i + 1] >= threshold && rgba[i + 2] >= threshold) {
      rgba[i + 3] = 0;
      cleared++;
    }
  }
  return cleared;
}

/** Fraction of opaque pixels that are near-white. */
export function whiteFraction(rgba: Uint8ClampedArray, threshold = 250): number {
  let white = 0;
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    total++;
    if (rgba[i] >= threshold && rgba[i + 1] >= threshold && rgba[i + 2] >= threshold) white++;
  }
  return total === 0 ? 1 : white / total;
}

/** A blank JPEG is small and almost entirely white. Real imagery tiles are far larger. */
export const BLANK_JPEG_MAX_BYTES = 4000;
export const BLANK_WHITE_FRACTION = 0.995;

/**
 * Clears near-black no-data fill. Only acts when such pixels make up at least
 * `minFraction` of the tile, so ordinary dark shadows in real imagery are kept.
 * Returns the number of pixels cleared.
 */
export function clearBlackFill(rgba: Uint8ClampedArray, maxValue = 2, minFraction = 0.05): number {
  let black = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] <= maxValue && rgba[i + 1] <= maxValue && rgba[i + 2] <= maxValue) black++;
  if (black === 0 || black / total < minFraction) return 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] <= maxValue && rgba[i + 1] <= maxValue && rgba[i + 2] <= maxValue) rgba[i + 3] = 0;
  return black;
}

/**
 * Repairs a dark band at the right edge of an RGBA tile (GIBS antimeridian
 * defect). Measured on GIBS BlueMarble tiles: 2-9 trailing columns are near
 * black (JPEG noise up to ~40), with a partly dark transition column.
 *
 * Detection is per tile, by column: a trailing column is "dark" when its mean
 * brightness is under 40% of the mean of a reference strip further inward.
 * At most width/8 columns are treated. One extra transition column is also
 * replaced. Each row is then filled from that row's last good pixel. Returns
 * the number of columns replaced (0 = untouched).
 */
export function repairRightEdge(rgba: Uint8ClampedArray, width: number, height: number): number {
  const maxCols = Math.ceil(width / 8);
  const colMean = (x: number) => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const o = (y * width + x) * 4;
      sum += Math.max(rgba[o], rgba[o + 1], rgba[o + 2]);
    }
    return sum / height;
  };
  let ref = 0;
  let refN = 0;
  for (let x = Math.max(0, width - 2 * maxCols - 4); x < width - maxCols; x++) {
    ref += colMean(x);
    refN++;
  }
  ref = refN ? ref / refN : 0;
  if (ref < 20) return 0; // reference strip is itself dark: nothing to compare against
  let x = width - 1;
  while (x >= width - maxCols && colMean(x) < ref * 0.4) x--;
  const band = width - 1 - x;
  if (band === 0 || band >= maxCols) return 0;
  const good = Math.max(0, x - 1); // also replace one transition column
  for (let y = 0; y < height; y++) {
    const from = (y * width + good) * 4;
    for (let cx = good + 1; cx < width; cx++) {
      const to = (y * width + cx) * 4;
      rgba[to] = rgba[from];
      rgba[to + 1] = rgba[from + 1];
      rgba[to + 2] = rgba[from + 2];
      rgba[to + 3] = rgba[from + 3];
    }
  }
  return width - 1 - good;
}

/**
 * Clears USGS white no-data fill inside a *mixed* JPEG tile (part imagery,
 * part white). Measured 2026-11-09 near Kingston, Ontario: border tiles are
 * 5-11 KB JPEGs whose outside-coverage area is flat white (255) with JPEG
 * ringing along the boundary.
 *
 * Only connected near-white regions (min channel >= 245) that are large
 * (>= minFraction of the tile) and flat (>= 85 % of pixels at 252+) are
 * cleared, so snow, clouds and white roofs in real imagery are kept. The
 * cleared area is then grown by `halo` pixels over light ringing pixels.
 * Returns the number of pixels cleared.
 */
export function clearWhiteFill(rgba: Uint8ClampedArray, width: number, height: number, minFraction = 0.01, halo = 2): number {
  const n = width * height;
  const minC = (p: number) => Math.min(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const label = new Int32Array(n).fill(-1);
  const clear = new Uint8Array(n);
  const stack: number[] = [];
  let comp = 0;
  let cleared = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || rgba[s * 4 + 3] === 0 || minC(s) < 245) continue;
    const members: number[] = [];
    let flat = 0;
    label[s] = comp;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      if (minC(p) >= 252) flat++;
      const x = p % width;
      const y = (p - x) / width;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb) {
        if (q < 0 || label[q] !== -1 || rgba[q * 4 + 3] === 0 || minC(q) < 245) continue;
        label[q] = comp;
        stack.push(q);
      }
    }
    comp++;
    if (members.length >= n * minFraction && flat >= members.length * 0.85) for (const p of members) clear[p] = 1;
  }
  // Grow over the light JPEG ringing that borders the fill.
  for (let r = 0; r < halo; r++) {
    const add: number[] = [];
    for (let p = 0; p < n; p++) {
      if (clear[p] || minC(p) < 170) continue;
      const x = p % width;
      if ((x > 0 && clear[p - 1]) || (x < width - 1 && clear[p + 1]) || (p >= width && clear[p - width]) || (p + width < n && clear[p + width])) add.push(p);
    }
    for (const p of add) clear[p] = 1;
  }
  for (let p = 0; p < n; p++)
    if (clear[p] && rgba[p * 4 + 3] !== 0) {
      rgba[p * 4 + 3] = 0;
      cleared++;
    }
  return cleared;
}

/** Quick probe on a small downscaled copy: does the tile contain a flat white area worth checking? */
export function probeHasWhite(rgba: Uint8ClampedArray, minPixels = 2): boolean {
  let w = 0;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i] >= 250 && rgba[i + 1] >= 250 && rgba[i + 2] >= 250 && ++w >= minPixels) return true;
  return false;
}
