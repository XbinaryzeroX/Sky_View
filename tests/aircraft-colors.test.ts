// Aircraft colours (requested 2026-11-23): airliners white, military yellow, everything else blue.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_ROLE_COLOR, aircraftColorRole } from '../src/shared/aircraft';
import type { GeoRecord } from '../src/shared/layers';

const plane = (props: Record<string, unknown>): GeoRecord => ({ id: 'a', label: 'X', lat: 0, lon: 0, altM: 3000, heading: 0, speedKts: 300, category: null, observedAt: null, source: 'fixture', sourceUrl: null, props } as GeoRecord);

describe('aircraft colour roles', () => {
  it('colours airliners by type or ADS-B size category, including cargo airliners', () => {
    expect(aircraftColorRole(plane({ type: 'B738' }))).toBe('airliner');
    expect(aircraftColorRole(plane({ type: 'A388' }))).toBe('airliner');
    expect(aircraftColorRole(plane({ type: 'B77L', militaryFlag: false }))).toBe('airliner');
    expect(aircraftColorRole(plane({ emitterCategory: 'A5' }))).toBe('airliner');
  });
  it('colours military by layer, by flag or by fighter type, ahead of size', () => {
    expect(aircraftColorRole(plane({ type: 'B738' }), 'aircraftMil')).toBe('military');
    expect(aircraftColorRole(plane({ type: 'B762', militaryFlag: true }))).toBe('military');
    expect(aircraftColorRole(plane({ type: 'F16' }))).toBe('military');
  });
  it('colours light aircraft, helicopters and unknown types as other', () => {
    expect(aircraftColorRole(plane({ type: 'C172' }))).toBe('other');
    expect(aircraftColorRole(plane({}))).toBe('other');
    expect(AIRCRAFT_ROLE_COLOR).toEqual({ airliner: '#ffffff', military: '#ffd400', other: '#56b4e9' });
  });
});
