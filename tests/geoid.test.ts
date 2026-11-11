import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGeoid, undulation } from '../src/shared/geoid';
import { Cartesian3, Ellipsoid, EllipsoidalOccluder } from 'cesium';
import { horizonPoint } from '../src/renderer/map/horizon';
import { trailPointHeight } from '../src/renderer/map/trailHeights';
import { GROUND_BACKOFF_MS, GROUND_FAILURE_TTL_MS, markGroundRetriesWoken, nextGroundRetryDelay, terrainCoversLatitude } from '../src/renderer/map/groundRetry';

const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'geoid', 'egm96-30.bin'));
const grid = parseGeoid(file);

describe('EGM96 sea-level grid shipped with the app', () => {
  it('is a complete global half-degree grid', () => {
    expect(grid.width).toBe(720);
    expect(grid.height).toBe(361);
    expect(grid.step).toBe(0.5);
    expect(grid.lon0).toBe(-180);
    expect(grid.lat0).toBe(90);
    let min = Infinity;
    let max = -Infinity;
    for (const v of grid.data) {
      min = Math.min(min, v * grid.scale);
      max = Math.max(max, v * grid.scale);
    }
    // EGM96's known extremes: about −107 m (Indian Ocean) and +85 m (New Guinea).
    expect(min).toBeGreaterThan(-108);
    expect(min).toBeLessThan(-105);
    expect(max).toBeGreaterThan(84);
    expect(max).toBeLessThan(86);
  });

  it("matches NGA's published EGM96 test points within 0.5 m", () => {
    const tests: [number, number, number][] = [
      [38.628155, 269.779155, -31.628],
      [-14.621217, 305.021114, -2.969],
      [46.874319, 102.448729, -43.575],
      [-23.617446, 133.874712, 15.871],
      [38.625473, 359.9995, 50.066],
      [-0.466744, 0.0023, 17.329],
    ];
    for (const [lat, lon, n] of tests) expect(Math.abs(undulation(grid, lat, lon) - n), `${lat},${lon}`).toBeLessThan(0.5);
  });

  it('gives the sea-level offsets that made ships vanish or float on Photoreal 3D', () => {
    const helsinki = undulation(grid, 60.165, 24.955);
    const newYork = undulation(grid, 40.69, -74.04);
    expect(helsinki).toBeGreaterThan(15); // sea is ~18 m above the ellipsoid: ships at 0 were under Google's water
    expect(helsinki).toBeLessThan(21);
    expect(newYork).toBeLessThan(-30); // ~33 m below: ships at 0 floated above it
    expect(newYork).toBeGreaterThan(-36);
  });

  it('wraps longitude and clamps latitude', () => {
    expect(undulation(grid, 10, -180)).toBeCloseTo(undulation(grid, 10, 180), 6);
    expect(undulation(grid, 10, 179.9)).toBeCloseTo(undulation(grid, 10, -180.1), 6);
    expect(undulation(grid, 10, 370)).toBeCloseTo(undulation(grid, 10, 10), 6);
    expect(undulation(grid, 95, 0)).toBeCloseTo(undulation(grid, 90, 0), 6);
    expect(undulation(grid, -95, 0)).toBeCloseTo(undulation(grid, -90, 0), 6);
    expect(undulation(grid, Number.NaN, 0)).toBe(0);
  });

  it('refuses anything that is not a complete global grid', () => {
    expect(() => parseGeoid(new Uint8Array(10))).toThrow(/too short/);
    const bad = Uint8Array.from(file);
    bad[0] = 0x58;
    expect(() => parseGeoid(bad)).toThrow(/not a geoid grid/);
    expect(() => parseGeoid(file.subarray(0, file.length - 2))).toThrow(/wrong size/);
    const notGlobal = Uint8Array.from(file);
    new DataView(notGlobal.buffer).setFloat64(32, 1, true); // step 1° with 720 columns → 720°
    expect(() => parseGeoid(notGlobal)).toThrow(/not global/);
    const zeroStep = Uint8Array.from(file);
    new DataView(zeroStep.buffer).setFloat64(32, 0, true);
    expect(() => parseGeoid(zeroStep)).toThrow(/header is invalid/);
    // Non-finite or absurd header values (offsets: lon0 16, lat0 24, step 32 as f64; scale 40 as f32).
    const cases: [string, number, number, 'f64' | 'f32'][] = [
      ['NaN lat0', 24, Number.NaN, 'f64'],
      ['NaN lon0', 16, Number.NaN, 'f64'],
      ['infinite lon0', 16, Number.POSITIVE_INFINITY, 'f64'],
      ['infinite step', 32, Number.POSITIVE_INFINITY, 'f64'],
      ['-infinite step', 32, Number.NEGATIVE_INFINITY, 'f64'],
      ['NaN step', 32, Number.NaN, 'f64'],
      ['infinite scale', 40, Number.POSITIVE_INFINITY, 'f32'],
      ['NaN scale', 40, Number.NaN, 'f32'],
      ['huge scale', 40, 1000, 'f32'],
      ['lon0 out of range', 16, 1e6, 'f64'],
    ];
    for (const [name, offset, value, kind] of cases) {
      const b = Uint8Array.from(file);
      const dv = new DataView(b.buffer);
      if (kind === 'f64') dv.setFloat64(offset, value, true);
      else dv.setFloat32(offset, value, true);
      expect(() => parseGeoid(b), name).toThrow(/header is invalid|not global/);
    }
  });
});

describe('far-side culling of vehicles below the ellipsoid', () => {
  it('keeps a ship at New York sea level (33 m under the ellipsoid) visible in a low view, and still culls the far side', () => {
    const n = undulation(grid, 40.69, -74.04);
    const ship = Cartesian3.fromDegrees(-74.04, 40.69, n);
    // The bug: in low views (here 60 m above the water, 2 km away; or with the camera itself under the ellipsoid)
    // Cesium's ellipsoid occluder hides points that sit below the ellipsoid surface.
    for (const camHeight of [n + 60, n + 20, n + 5]) {
      const low = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.fromDegrees(-74.04, 40.672, camHeight));
      expect(low.isPointVisible(ship), `camera ${Math.round(camHeight - n)} m above the water`).toBe(false);
      expect(low.isPointVisible(horizonPoint(ship))).toBe(true);
    }
    // From high above, both are visible.
    const overhead = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.fromDegrees(-74.04, 40.6, 2000));
    expect(overhead.isPointVisible(horizonPoint(ship))).toBe(true);
    // Far side of the earth: still hidden.
    const farSide = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.fromDegrees(105.96, -40.69, 2000));
    expect(farSide.isPointVisible(horizonPoint(ship))).toBe(false);
    // Points above the surface are passed through unchanged.
    const plane = Cartesian3.fromDegrees(-74.04, 40.69, 3000);
    expect(horizonPoint(plane)).toBe(plane);
  });
});

describe('trail point heights', () => {
  const air = (altM: number | null, onGround: boolean | null) => ({ lat: 60, lon: 25, altM, onGround });
  it('puts ground points on the ground, airborne points at altitude + sea level, and leaves out unknown altitudes', () => {
    const ground = () => 73; // Helsinki-Vantaa: 55 m terrain + 18 m sea level
    // Photoreal 3D (sea level 18 m above the ellipsoid).
    expect(trailPointHeight(air(0, true), 'aircraft', true, 18, ground)).toBe(73);
    expect(trailPointHeight(air(0, true), 'aircraft', true, 18, () => null)).toBe(18); // terrain not sampled yet
    expect(trailPointHeight(air(1000, false), 'aircraft', true, 18, ground)).toBe(1018);
    expect(trailPointHeight(air(1000, null), 'aircraft', true, 18, ground)).toBe(1018); // older recording with an altitude
    expect(trailPointHeight(air(null, false), 'aircraft', true, 18, ground)).toBeNull(); // airborne, altitude missing: no invented ground point
    expect(trailPointHeight(air(null, null), 'aircraft', true, 18, ground)).toBeNull();
    expect(trailPointHeight(air(Number.NaN, false), 'aircraft', true, 18, ground)).toBeNull();
    // App globe: as before (ground points and altitudes relative to 0).
    expect(trailPointHeight(air(0, true), 'aircraft', false, 0, ground)).toBe(0);
    expect(trailPointHeight(air(1000, false), 'aircraft', false, 0, ground)).toBe(1000);
    expect(trailPointHeight(air(null, false), 'aircraft', false, 0, ground)).toBeNull();
    // Ships: sea level, whatever was recorded.
    expect(trailPointHeight(air(null, null), 'vessel', true, 18, ground)).toBe(18);
    expect(trailPointHeight(air(null, null), 'vessel', false, 0, ground)).toBe(0);
    // Other trails (transit): 0, as their markers, whatever the scene.
    expect(trailPointHeight(air(500, false), 'other', true, 18, ground)).toBe(0);
    expect(trailPointHeight(air(null, null), 'other', true, 18, ground)).toBe(0);
  });
});

describe('retrying failed terrain samples', () => {
  const fail = (at: number) => ({ at, woken: false });
  it('wakes for the earliest back-off, still covers later failures, and forgets old ones', () => {
    const failed = new Map<string, { at: number; woken: boolean }>();
    expect(nextGroundRetryDelay(failed, 0)).toBeNull();
    failed.set('A', fail(0));
    failed.set('B', fail(30_000)); // fails half a minute later, in another batch
    expect(nextGroundRetryDelay(failed, 30_000)).toBe(GROUND_BACKOFF_MS - 30_000 + 1_000); // A first
    // Wake-up at 61 s: A has had its chance; B (back-off not over) still gets one.
    markGroundRetriesWoken(failed, 61_000);
    expect(failed.get('A')!.woken).toBe(true);
    expect(failed.get('B')!.woken).toBe(false);
    expect(nextGroundRetryDelay(failed, 61_000)).toBe(30_000 + GROUND_BACKOFF_MS - 61_000 + 1_000);
    // Wake-up for B; if neither cell is requested again, nothing is scheduled any more (no refresh loop).
    markGroundRetriesWoken(failed, 91_000);
    expect(nextGroundRetryDelay(failed, 91_000)).toBeNull();
    expect(nextGroundRetryDelay(failed, 92_000)).toBeNull();
    // A cell still needed fails again: a new failure gets a new wake-up.
    failed.set('A', fail(95_000));
    expect(nextGroundRetryDelay(failed, 95_000)).toBe(GROUND_BACKOFF_MS + 1_000);
    // Failures older than the time-to-live are dropped.
    expect(nextGroundRetryDelay(failed, 95_000 + GROUND_FAILURE_TTL_MS + 1)).toBeNull();
    expect(failed.size).toBe(0);
  });
});

describe('ground sampling coverage', () => {
  it('samples ground only where the terrain source has data (Web Mercator, ±85.05°)', () => {
    expect(terrainCoversLatitude(60.3)).toBe(true);
    expect(terrainCoversLatitude(-77.85)).toBe(true); // McMurdo
    expect(terrainCoversLatitude(85.05)).toBe(true);
    expect(terrainCoversLatitude(-89.99)).toBe(false); // South Pole: no sampled height (icon), not the ±85° edge row
    expect(terrainCoversLatitude(86)).toBe(false);
    expect(terrainCoversLatitude(Number.NaN)).toBe(false);
  });
});

describe('aircraft below sea level on Photoreal 3D', () => {
  it('keeps negative altitudes (ground at −100 m, climbing through −80 m) instead of jumping to sea level', () => {
    const p = (altM: number | null, onGround: boolean | null) => ({ lat: 36.46, lon: -116.87, altM, onGround });
    const sea = -30; // illustrative local sea level relative to the ellipsoid
    const ground = () => -100 + sea; // terrain −100 m below sea level
    expect(trailPointHeight(p(0, true), 'aircraft', true, sea, ground)).toBe(-130);
    expect(trailPointHeight(p(-80, false), 'aircraft', true, sea, ground)).toBe(-110); // 20 m above that ground
    // The app's globe keeps its sea-level floor, as before.
    expect(trailPointHeight(p(-80, false), 'aircraft', false, 0, ground)).toBe(0);
  });
});
