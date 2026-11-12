import { describe, expect, it } from 'vitest';
import fixture from './fixtures/street-view.json';
import { streetViewUrl } from '../src/shared/streetView';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

describe('explicit external Street View links', () => {
  it.each(fixture.valid)('builds an allowed Google viewer URL for $name', ({ lat, lon, viewpoint }) => {
    const raw = streetViewUrl(lat, lon);
    expect(raw).not.toBeNull();
    const url = new URL(raw!);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/maps/@');
    expect([...url.searchParams.entries()]).toEqual([
      ['api', '1'], ['map_action', 'pano'], ['viewpoint', viewpoint],
    ]);
    expect(raw).toContain(encodeURIComponent(viewpoint));
    expect(isAllowedExternalUrl(raw)).toBe(true);
    for (const number of viewpoint.split(',')) expect(number).toMatch(/^-?\d+(?:\.\d{1,6})?$/);
  });

  it.each(fixture.invalid)('rejects $name before rounding or URL creation', ({ lat, lon }) => {
    expect(streetViewUrl(lat, lon)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, undefined, true, {}, [], new Number(35)])('rejects non-finite or non-numeric input %s', (invalid) => {
    expect(streetViewUrl(invalid, 0)).toBeNull();
    expect(streetViewUrl(0, invalid)).toBeNull();
  });

  it('retains antimeridian signs and normalizes rounded negative zero', () => {
    expect(new URL(streetViewUrl(0, 180)!).searchParams.get('viewpoint')).toBe('0,180');
    expect(new URL(streetViewUrl(0, -180)!).searchParams.get('viewpoint')).toBe('0,-180');
    expect(new URL(streetViewUrl(-0, -0.0000001)!).searchParams.get('viewpoint')).toBe('0,0');
  });

  it('keeps existing external-destination protections for lookalike links', () => {
    expect(isAllowedExternalUrl('https://www.google.com.evil.example/maps/@?api=1&map_action=pano')).toBe(false);
    expect(isAllowedExternalUrl('http://www.google.com/maps/@?api=1&map_action=pano')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pass@www.google.com/maps/@?api=1&map_action=pano')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
  });
});
