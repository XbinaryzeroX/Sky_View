import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cameraInView, filterCameras } from '../src/shared/cameraDirectory';
import { normalizeQuebecCams, normalizeTflJamCams } from '../src/shared/cameraSources';

const fixture = (file: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'layers', file), 'utf8'));

describe('camera directory viewport', () => {
  it('includes both sides of a date-line view and excludes the opposite hemisphere', () => {
    const bbox: [number, number, number, number] = [170, -30, -170, 30];
    for (const lon of [170, 179, 180, -180, -179, -170]) expect(cameraInView({ lat: 0, lon }, bbox)).toBe(true);
    for (const lon of [0, 169, -169]) expect(cameraInView({ lat: 0, lon }, bbox)).toBe(false);
    expect(cameraInView({ lat: -31, lon: 179 }, bbox)).toBe(false);
  });

  it('handles ordinary, global and exact date-line boundary views', () => {
    expect(cameraInView({ lat: 51.5, lon: -0.1 }, [-1, 51, 1, 52])).toBe(true);
    expect(cameraInView({ lat: 49, lon: -0.1 }, [-1, 51, 1, 52])).toBe(false);
    expect(cameraInView({ lat: -90, lon: 180 }, [-180, -90, 180, 90])).toBe(true);
    expect(cameraInView({ lat: 0, lon: -180 }, [170, -10, 180, 10])).toBe(true);
    expect(cameraInView({ lat: 0, lon: 180 }, [-180, -10, -170, 10])).toBe(true);
  });
});

describe('camera media and combined directory filters', () => {
  const viewers = normalizeQuebecCams(fixture('quebec-cameras.geojson')).records;
  const stills = normalizeTflJamCams(fixture('tfl-jamcams.json')).records;
  const cameras = [...viewers, ...stills];
  const options = { country: 'all', media: 'all' as const, favorites: [], query: '', bbox: null };

  it('keeps official viewer links distinct from embeddable still images', () => {
    expect(viewers.length).toBeGreaterThan(0);
    expect(filterCameras(cameras, { ...options, media: 'viewer' })).toEqual(viewers);
    expect(filterCameras(cameras, { ...options, media: 'still' })).toEqual(stills);
    expect(filterCameras(cameras, { ...options, media: 'hls' })).toEqual([]);
  });

  it('combines favorites, country, Unicode text and viewport without dropping viewer links', () => {
    const camera = viewers[0];
    expect(filterCameras(cameras, { ...options, country: 'Canada', media: 'fav', favorites: [camera.id], query: camera.label.toLocaleUpperCase(), bbox: [-180, -90, 180, 90] })).toEqual([camera]);
    expect(filterCameras(cameras, { ...options, country: 'United Kingdom', media: 'fav', favorites: [camera.id] })).toEqual([]);
  });
});
