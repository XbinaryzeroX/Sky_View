import { describe, expect, it, vi } from 'vitest';
import { Transforms } from 'cesium';
import { loadEarthLighting, sunlightDirection, validLightingTime } from '../src/renderer/map/earthLighting';

describe('Earth lighting', () => {
  it('accepts UTC minutes and safely restores time preferences from an older or damaged profile', () => {
    expect(validLightingTime('2024-02-29T23:59')).toBe(true);
    for (const value of [null, '2025-02-29T12:00', '2026-11-12T24:00', '2026-11-12T14:00-05:00']) {
      expect(validLightingTime(value)).toBe(false);
    }
    const getItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem });
    try {
      for (const invalid of [null, '{', '{"mode":"custom","utc":"yesterday"}']) {
        getItem.mockReturnValue(invalid);
        expect(loadEarthLighting()).toEqual({mode:'day'});
      }
      const chosen = {mode:'custom',utc:'2024-02-29T23:59'};
      getItem.mockReturnValue(JSON.stringify(chosen));
      expect(loadEarthLighting()).toEqual(chosen);
    } finally { vi.unstubAllGlobals(); }
  });

  it('illuminates opposite longitudes twelve hours apart and tilts toward the summer pole', () => {
    // Exercise the same offline Earth orientation approximation that Cesium uses before EOP data load.
    const fixed = vi.spyOn(Transforms, 'computeIcrfToCentralBodyFixedMatrix').mockReturnValue(undefined);
    try {
      const summer = sunlightDirection(new Date('2025-06-21T12:00Z'));
      const midnight = sunlightDirection(new Date('2025-06-21T00:00Z'));
      const winter = sunlightDirection(new Date('2025-12-21T12:00Z'));
      expect(summer.x).toBeLessThan(-.90);
      expect(midnight.x).toBeGreaterThan(.90);
      expect(summer.z).toBeLessThan(-.38);
      expect(winter.z).toBeGreaterThan(.38);
    } finally { fixed.mockRestore(); }
  });
});
