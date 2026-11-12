import { describe, expect, it } from 'vitest';
import { parseCoordinates } from '../src/shared/geo';

describe('existing horizontal coordinate navigation', () => {
  it.each([
    ['35.687, 139.7495', 35.687, 139.7495], ['-33.87 151.21', -33.87, 151.21],
    ['+10, +180', 10, 180], ['−10 −180', -10, -180], ['-.5, .25', -0.5, 0.25],
    ['90,180', 90, 180], ['-90,-180', -90, -180],
  ] as const)('preserves plain decimal coordinates %s, including the date line', (input, lat, lon) => {
    expect(parseCoordinates(input)).toEqual({ lat, lon });
  });

  it.each([
    ['geo:48.2010,16.3695,183', 48.201, 16.3695],
    ['geo:48.2010,16.3695,183;crs=wgs84;u=5', 48.201, 16.3695],
    ['GEO:90,-180;CRS=WGS84', 90, -180],
    ['geo:-90,180,-12.5;u=0', -90, 180],
    ['geo:66,30;u=6.500;FOo=this%2dthat', 66, 30],
    ['geo:1,2;crs=wgs84;foo;bar=one:two', 1, 2],
  ] as const)('validates RFC5870 URI %s and returns horizontal coordinates only', (input, lat, lon) => {
    expect(parseCoordinates(input)).toEqual({ lat, lon });
  });

  it.each([
    'geo:1,2;crs=anything', 'geo:1,2;crs=gcj02', 'geo:1,2;crs=',
    'geo:1,2;crs=wgs84;crs=wgs84', 'geo:1,2;u=1;crs=wgs84',
    'geo:1,2;foo=bar;u=1', 'geo:1,2;u=1;u=2', 'geo:1,2;u=-1',
    'geo:1,2;u=+1', 'geo:1,2;u=1e3', 'geo:1,2;u=', 'geo:1,2;u',
    'geo:1 2', 'geo:1, 2', 'geo:+1,2', 'geo:−1,2', 'geo:1,2,',
    'geo:1,2,1e3', 'geo:1,2;', 'geo:1,2;foo=%GG', 'geo:1,2;foo=',
    'geo:1,2?q=Somewhere', 'geo:1,2#map', 'geo:91,2', 'geo:1,181',
    'geo:1,2,' + '9'.repeat(400),
  ])('rejects invalid or unsupported geo URI %s without guessing a CRS/position', (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });

  it.each([
    '1,2;crs=wgs84', '1,2;anything', '1,2,3', '48,2 16,3', '48,2,16,3',
    '91 0', '0 -181', 'Infinity,0', 'NaN 0', '0x10 0', '1e2 0', 'Denver',
  ])('rejects plain suffixes, ambiguous decimal-comma values and invalid positions: %s', (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });
});
