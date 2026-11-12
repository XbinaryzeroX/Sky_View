import { trackState } from './aircraft';
import { isValidLat, isValidLon } from './geo';
import type { GeoRecord, LayerId } from './layers';

export type TrackingMode = 'follow' | 'cockpit';
export const COCKPIT_CONTACT_RANGE_M = 75000;

/** A camera direction needs a recent airborne observation; do not invent attitude from a snapshot. */
export function cockpitUnavailable(layer: LayerId, record: GeoRecord | null | undefined, now = Date.now()): string | null {
  if (layer !== 'aircraft' && layer !== 'aircraftMil') return 'Cockpit perspective is available for aircraft.';
  if (!record) return 'The aircraft is no longer in the loaded data.';
  if (!isValidLat(record.lat) || !isValidLon(record.lon)) return 'The aircraft position is unavailable.';
  if (!record.observedAt || !Number.isFinite(Date.parse(record.observedAt)) || Date.parse(record.observedAt) > now + 5000) return 'A valid observation time is required.';
  if (record.props.snapshot === true) return 'Worldwide snapshots do not support cockpit perspective.';
  if (trackState(record, now) !== 'fresh') return 'The aircraft report is stale; refresh the live source before entering cockpit perspective.';
  if (record.props.onGround === true) return 'Cockpit perspective requires an airborne aircraft.';
  if (record.altM === null || !Number.isFinite(record.altM)) return 'The aircraft altitude is not reported.';
  if (record.heading === null || !Number.isFinite(record.heading) || record.heading < 0 || record.heading > 360) return 'The aircraft direction is not reported.';
  return null;
}
