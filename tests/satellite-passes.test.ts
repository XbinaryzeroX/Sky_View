import { describe, expect, it } from 'vitest';
import fixture from './fixtures/satellite-passes.json';
import { predictSatellitePasses, satelliteLookAngles } from '../src/shared/satellitePasses';

const tle = fixture.tle as [string, string];
const observer = fixture.observer;
const start = Date.parse(fixture.startAt);
const closeTime = (actual: string | null, expected: string, toleranceS = 2) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(Date.parse(actual!) - Date.parse(expected))).toBeLessThan(toleranceS * 1000);
};

describe('local satellite passes against independently published ephemeris', () => {
  it('matches both rise/peak/set triples published by Skyfield to within two seconds', () => {
    const result = predictSatellitePasses(tle, observer, start, fixture.thresholdDeg);
    expect(result.passes).toHaveLength(fixture.passes.length);
    result.passes.forEach((pass, i) => {
      closeTime(pass.riseAt, fixture.passes[i].riseAt);
      closeTime(pass.peakAt, fixture.passes[i].peakAt);
      closeTime(pass.setAt, fixture.passes[i].setAt);
      expect(pass.maxElevationDeg).toBeGreaterThan(30);
    });
    expect(result.evaluations).toBeLessThan(10000);
    expect(result.endAt).toBe('2014-01-24T00:00:00.000Z');
  });

  it('matches the separately published observer altitude and azimuth', () => {
    const result = satelliteLookAngles(tle, observer, Date.parse(fixture.lookAngle.at));
    expect(result.elevation).toBeCloseTo(fixture.lookAngle.elevationDeg, 2);
    expect(result.azimuth).toBeCloseTo(fixture.lookAngle.azimuthDeg, 2);
  });

  it('keeps a pass already underway and labels its missing rise rather than inventing it', () => {
    const result = predictSatellitePasses(tle, observer, Date.parse('2014-01-23T06:26:30Z'), 30);
    expect(result.passes[0].riseAt).toBeNull();
    closeTime(result.passes[0].peakAt, fixture.passes[0].peakAt);
    closeTime(result.passes[0].setAt, fixture.passes[0].setAt);
  });

  it('keeps a pass extending past the window and labels its missing set', () => {
    const result = predictSatellitePasses(tle, observer, Date.parse('2014-01-22T06:27:30Z'), 30);
    expect(result.passes.at(-1)?.setAt).toBeNull();
    closeTime(result.passes.at(-1)!.riseAt, fixture.passes[0].riseAt);
    closeTime(result.passes.at(-1)!.peakAt, fixture.passes[0].peakAt);
  });

  it('does not lose a brief grazing pass between two coarse samples', () => {
    const original = predictSatellitePasses(tle, observer, start, 30);
    const threshold = original.passes[0].maxElevationDeg - 0.01;
    const result = predictSatellitePasses(tle, observer, start, threshold);
    const pass = result.passes.find((p) => Math.abs(Date.parse(p.peakAt) - Date.parse(original.passes[0].peakAt)) < 1000);
    expect(pass).toBeDefined();
    expect(Date.parse(pass!.setAt!) - Date.parse(pass!.riseAt!)).toBeLessThan(30_000);
  });

  it('finds a narrow pass in the first or last coarse interval of the window', () => {
    const peak = Date.parse(fixture.passes[0].peakAt);
    for (const startMs of [peak - 7000, peak + 7000 - 86400_000]) {
      // A deliberately high threshold around the independently published peak time leaves a few-second pass.
      const result = predictSatellitePasses(tle, observer, startMs, 54.35);
      const pass = result.passes.find((p) => Math.abs(Date.parse(p.peakAt) - peak) < 2000);
      expect(pass).toBeDefined();
      expect(pass!.riseAt).not.toBeNull();
      expect(pass!.setAt).not.toBeNull();
    }
  });
});

describe('worldwide observers, element age and unavailable states', () => {
  it('handles no passes at the pole without claiming missing coverage', () => {
    const result = predictSatellitePasses(tle, { lat: 90, lon: 0, heightM: 0 }, start, 0);
    expect(result.passes).toEqual([]);
  });

  it('calculates identical observers at +180 and -180 and supports the southern hemisphere', () => {
    const east = predictSatellitePasses(tle, { lat: -17, lon: 180, heightM: 0 }, start, 0);
    const west = predictSatellitePasses(tle, { lat: -17, lon: -180, heightM: 0 }, start, 0);
    expect(east.passes.length).toBeGreaterThan(0);
    expect(east.passes.length).toBe(west.passes.length);
    east.passes.forEach((p, i) => {
      closeTime(p.peakAt, west.passes[i].peakAt, 0.1);
      expect(p.maxElevationDeg).toBeCloseTo(west.passes[i].maxElevationDeg, 6);
    });
  });

  it('warns at seven days and rejects prediction windows more than fourteen days from the elements', () => {
    const result = predictSatellitePasses(tle, observer, Date.parse('2014-01-29T00:00:00Z'), 10);
    expect(result.stale).toBe(true);
    expect(result.elementAgeDays).toBeGreaterThan(7);
    expect(() => predictSatellitePasses(tle, observer, Date.parse('2026-11-11T00:00:00Z'))).toThrow(/14 days/);
    expect(() => predictSatellitePasses(tle, observer, Date.parse('2013-12-20T00:00:00Z'))).toThrow(/14 days/);
  });

  it('rejects bad elements, mismatched satellite identifiers and invalid observers', () => {
    expect(() => predictSatellitePasses(['broken', 'broken'], observer, start)).toThrow(/malformed/);
    expect(() => predictSatellitePasses([tle[0], tle[1].replace('25544', '99999')], observer, start)).toThrow(/malformed/);
    expect(() => predictSatellitePasses([tle[0], tle[1].slice(0, 52) + '        NaN' + tle[1].slice(63)], observer, start)).toThrow(/invalid|malformed/);
    for (const bad of [{ lat: 91, lon: 0, heightM: 0 }, { lat: 0, lon: NaN, heightM: 0 }, { lat: 0, lon: 0, heightM: 11000 }]) {
      expect(() => predictSatellitePasses(tle, bad, start)).toThrow(/latitude/);
    }
    expect(() => predictSatellitePasses(tle, observer, start, 90)).toThrow(/threshold/);
  });

  it('reports a decayed orbit as unavailable instead of returning invented pass times', () => {
    const decayed: [string, string] = [tle[0], tle[1].slice(0, 52) + '25.00000000' + tle[1].slice(63)];
    expect(() => predictSatellitePasses(decayed, observer, start)).toThrow(/decayed/);
  });

  it('distinguishes continuous geostationary elevation from a rise/set event', () => {
    const geo = fixture.geostationaryTle as [string, string];
    // Locate a valid equatorial observer under the fixed orbit using a one-time test-only longitude scan.
    const longitudes = Array.from({ length: 37 }, (_, i) => -180 + i * 10);
    const best = longitudes.map((lon) => ({ lon, elevation: satelliteLookAngles(geo, { lat: 0, lon, heightM: 0 }, start).elevation })).sort((a, b) => b.elevation - a.elevation)[0];
    const result = predictSatellitePasses(geo, { lat: 0, lon: best.lon, heightM: 0 }, start, 10);
    expect(result.passes).toHaveLength(1);
    expect(result.passes[0].riseAt).toBeNull();
    expect(result.passes[0].setAt).toBeNull();
    expect(result.passes[0].maxElevationDeg).toBeGreaterThan(80);
  });
});
