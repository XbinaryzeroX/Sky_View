import type { Settings } from './types';

export type PlaceSearchMode = 'offline' | 'google' | 'google-needs-key';

export function placeSearchMode(basemap: Settings['basemap'], hasCustomerKey: boolean, imageryYear?: number | null): PlaceSearchMode {
  if (imageryYear != null || (basemap !== 'google2d' && basemap !== 'google3d')) return 'offline';
  return hasCustomerKey ? 'google' : 'google-needs-key';
}
