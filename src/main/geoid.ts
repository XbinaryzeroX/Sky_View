// The sea-level (geoid) grid shipped with the app, read once in the main process so aircraft reports that only
// carry a GNSS altitude (height above the WGS84 ellipsoid) can be converted to height above sea level, the
// reference of barometric altitudes. Without the grid those altitudes are used as reported (as before).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGeoid, undulation, type GeoidGrid } from '../shared/geoid';

let grid: GeoidGrid | null = null;

/** Loads the grid from the built renderer files (packaged app), or the repository's public folder (development). */
export function loadMainGeoid(rendererRoot: string, log: (m: string) => void): void {
  for (const p of [join(rendererRoot, 'geoid', 'egm96-30.bin'), join(rendererRoot, '..', '..', 'public', 'geoid', 'egm96-30.bin')]) {
    try {
      grid = parseGeoid(readFileSync(p));
      return;
    } catch {
      // try the next location
    }
  }
  log('[geoid] sea-level grid not found: GNSS-only aircraft altitudes are used as reported');
}

/** Height of local mean sea level above the WGS84 ellipsoid (metres), or null without the grid. */
export function mainGeoidHeight(lat: number, lon: number): number | null {
  return grid ? undulation(grid, lat, lon) : null;
}
