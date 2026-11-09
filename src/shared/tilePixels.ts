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
