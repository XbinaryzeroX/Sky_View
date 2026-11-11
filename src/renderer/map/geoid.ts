// Loads the sea-level (geoid) grid shipped with the app (public/geoid/egm96-30.bin, about 0.5 MB) once.
// While it is loading or if it fails, geoidHeight() returns null and callers keep their safe fallback
// (ships and parked aircraft show as icons on Google 3D tiles); the state is shown in Map diagnostics.

import { parseGeoid, undulation, type GeoidGrid } from '../../shared/geoid';

export const geoidStats = { state: 'loading' as 'loading' | 'ready' | 'error', error: null as string | null };

let grid: GeoidGrid | null = null;
let loading: Promise<GeoidGrid | null> | null = null;

export function loadGeoid(): Promise<GeoidGrid | null> {
  if (!loading)
    loading = (async () => {
      try {
        const res = await fetch(new URL('geoid/egm96-30.bin', document.baseURI));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        grid = parseGeoid(await res.arrayBuffer());
        geoidStats.state = 'ready';
        return grid;
      } catch (e) {
        geoidStats.state = 'error';
        geoidStats.error = String((e as Error)?.message ?? e).slice(0, 200);
        return null;
      }
    })();
  return loading;
}

/** Height of local mean sea level above the WGS84 ellipsoid (metres), or null until the grid is loaded. */
export function geoidHeight(lat: number, lon: number): number | null {
  return grid ? undulation(grid, lat, lon) : null;
}
