import { mercatorPixel } from '../../shared/mercator';

const SIDE = 1024;
/** Geographic terrain LODs. Finer terrain retains the full-resolution source and coastline mask. */
export const LAST_OVERVIEW_LEVEL = 5;

let bundledGrid: Promise<Int16Array | null> | undefined;

export function loadTerrainOverview() {
  bundledGrid ??= (async () => {
    const url = new URL('terrain/overview-z2.bin', document.baseURI);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Overview terrain unavailable');
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength !== 8 + SIDE * SIDE * 2 || new TextDecoder().decode(new Uint8Array(bytes, 0, 8)) !== 'AWDEMZ02') {
      throw new Error('Invalid overview terrain');
    }
    return new Int16Array(bytes, 8);
  })().catch(() => null);
  return bundledGrid;
}

/** Sample cell-centered Terrarium pixels from the same grid on both sides of each mesh boundary. */
export function overviewTerrainTile(grid: Int16Array, west: number, east: number, north: number, south: number, size: number) {
  const columns = Array.from({ length: size }, (_, i) => {
    const px = mercatorPixel(west + (east - west) * i / (size - 1), 0, 2).x - 0.5;
    const x0 = Math.floor(px);
    return { left: (x0 + SIDE) % SIDE, right: (x0 + 1 + SIDE) % SIDE, fraction: px - x0 };
  });
  const heights = new Float32Array(size * size);
  const water = new Uint8Array((size - 1) ** 2);
  let wet = 0;
  for (let row = 0; row < size; row++) {
    const lat = north + (south - north) * row / (size - 1);
    const py = Math.max(0, Math.min(SIDE - 1, mercatorPixel(0, lat, 2).y - 0.5));
    const y0 = Math.floor(py), fy = py - y0;
    const top = y0 * SIDE, bottom = Math.min(SIDE - 1, y0 + 1) * SIDE;
    for (let col = 0; col < size; col++) {
      const { left, right, fraction } = columns[col];
      const a = grid[top + left] * (1 - fraction) + grid[top + right] * fraction;
      const b = grid[bottom + left] * (1 - fraction) + grid[bottom + right] * fraction;
      const elevation = a * (1 - fy) + b * fy;
      // This display grid includes bathymetry. At continent scale, use the existing below-sea-level
      // approximation. Local tiles resolve actual coasts using OSM, and ground sampling uses the original DEM.
      const ocean = elevation < -10;
      heights[row * size + col] = ocean ? 0 : elevation;
      if (ocean && row < size - 1 && col < size - 1) {
        water[row * (size - 1) + col] = 255;
        wet++;
      }
    }
  }
  return { heights, water: wet === 0 || wet === water.length ? new Uint8Array([wet ? 255 : 0]) : water };
}
