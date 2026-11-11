// Retry scheduling for failed terrain samples (pure, unit-tested; used by LayerRenderer).

/** A failed cell may be requested again this long after its failure. */
export const GROUND_BACKOFF_MS = 60_000;
/** Failures older than this are forgotten (the cell is requested again only if it is needed again). */
export const GROUND_FAILURE_TTL_MS = 5 * 60_000;

/**
 * A failed sample. `woken`: its one retry wake-up has happened (after the back-off), so it no longer schedules
 * wake-ups; `at` still enforces the back-off. A new failure of the same cell is a new entry (woken = false).
 */
export interface GroundFailure {
  at: number;
  woken: boolean;
}

/**
 * Delay until the next wake-up for failures still waiting for theirs (earliest back-off end, plus a second), or
 * null when none is. Removes failures older than GROUND_FAILURE_TTL_MS from `failed`.
 */
export function nextGroundRetryDelay(failed: Map<string, GroundFailure>, now: number): number | null {
  let earliest = Infinity;
  for (const [cell, f] of failed) {
    if (now - f.at > GROUND_FAILURE_TTL_MS) failed.delete(cell);
    else if (!f.woken) earliest = Math.min(earliest, f.at + GROUND_BACKOFF_MS);
  }
  return Number.isFinite(earliest) ? Math.max(1_000, earliest - now + 1_000) : null;
}

/** At a wake-up: every failure whose back-off has ended has now had its retry chance. */
export function markGroundRetriesWoken(failed: Map<string, GroundFailure>, now: number): void {
  for (const f of failed.values()) if (!f.woken && now - f.at >= GROUND_BACKOFF_MS) f.woken = true;
}

/** Latitude limit of the Terrarium terrain source (Web Mercator); there is no ground height poleward of it. */
export const TERRAIN_MAX_LAT = 85.0511287798066;

/** Whether ground heights can be sampled at this latitude (outside it, parked aircraft stay icons on Photoreal). */
export function terrainCoversLatitude(lat: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= TERRAIN_MAX_LAT;
}
