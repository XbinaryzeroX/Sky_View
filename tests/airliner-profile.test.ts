import { describe, expect, it } from 'vitest';
import { airframeAgeLabel, airlinerProfile } from '../src/shared/airlinerProfile';
import { normalizeAdsb } from '../src/shared/layerNormalize';
import { modelLine, parseAdsbdb } from '../src/shared/vehicleInfo';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { airlineStatusPages } from '../src/shared/airlineStatusPages';

describe('aircraft type reference and airframe identity', () => {
  it('keeps the CRJ1000 operator-specific configuration and model history separate from a build year', () => {
    const crj = airlinerProfile(' crjx ');
    expect(crj?.name).toBe('Bombardier CRJ1000');
    expect(crj?.facts).toContainEqual({ label: 'Air Nostrum seating', value: '100' });
    expect(crj?.facts).toContainEqual({ label: 'Model program launched', value: '2007' });
    expect(crj?.sources[0].url).toMatch(/^https:\/\/grupo\.iberia\.com\//);
    expect(airlinerProfile('CRJ9')?.facts).not.toEqual(crj?.facts);
    for (const unresolved of ['CRJ', 'CRJ10', 'A3', '__proto__', null]) expect(airlinerProfile(unresolved)).toBeNull();
  });

  it('preserves different reference wingspans when the aircraft can be configured with or without winglets', () => {
    const facts = airlinerProfile('B738')?.facts;
    expect(facts).toContainEqual({ label: 'Span without winglets', value: '34.3 m' });
    expect(facts).toContainEqual({ label: 'Span with winglets', value: '35.8 m' });
    expect(airlinerProfile('B38M')?.facts.find(fact => fact.label === 'Engines')?.value).toContain('LEAP');
  });

  it('opens the credited reference pages through the desktop link policy', () => {
    for (const code of ['CRJX', 'A20N', 'A359', 'B738', 'B38M', 'B789']) {
      for (const source of airlinerProfile(code)!.sources) expect(isAllowedExternalUrl(source.url)).toBe(true);
    }
    expect(isAllowedExternalUrl('https://www.boeing.com/other')).toBe(false);
    expect(isAllowedExternalUrl('https://www.boeing.com/commercial/787?redirect=somewhere')).toBe(false);
    for (const [, url] of Object.values(airlineStatusPages)) expect(isAllowedExternalUrl(url)).toBe(true);
    expect(isAllowedExternalUrl('https://commons.wikimedia.org/wiki/File:EC-MJQ_CRJ1000_Air_Nostrum_MAD.jpg')).toBe(true);
    expect(isAllowedExternalUrl('https://commons.wikimedia.org/wiki/Help:Contents')).toBe(false);
    expect(isAllowedExternalUrl('https://airport-data.com/aircraft/photo/001790936')).toBe(true);
    expect(isAllowedExternalUrl('https://airport-data.com/aircraft/photo/from-somewhere')).toBe(false);
  });

  it('uses a four-digit manufacture year reported for this airliner and tolerates missing metadata', () => {
    const asOf = new Date('2026-01-01T00:00:00Z');
    const report = { hex: 'abcdef', lat: 1, lon: 2, t: 'CRJX', year: '2012', ownOp: 'Fixture Airline' };
    function props(extra: Record<string, unknown>) {
      return normalizeAdsb({ aircraft: [{ ...report, ...extra }] }, 'fixture', asOf.getTime()).records[0].props;
    }
    expect(props({})).toMatchObject({ airframeYear: 2012, ownerOperator: 'Fixture Airline' });
    expect(airframeAgeLabel(props({}).airframeYear, asOf)).toBe('2012 · about 14 years old');
    for (const year of [null, '2012/13', 2030, true]) expect(airframeAgeLabel(props({ year }).airframeYear, asOf)).toBeNull();
    for (const dbFlags of [1, 4, 8]) expect(props({ dbFlags })).toMatchObject({ airframeYear: null, ownerOperator: null });
  });

  it('requires a matching registry identifier and rejects conflicting registration or Mode S', () => {
    const aircraft = { mode_s: 'ABCDEF', registration: 'N123AB', manufacturer: 'Boeing', type: 'Boeing 737-800', icao_type: 'b738' };
    const read = (overrides: Record<string, unknown>) =>
      parseAdsbdb({ response: { aircraft: { ...aircraft, ...overrides } } }, { hex: 'abcdef', registration: 'n123ab' });
    expect(modelLine(read({}), null)).toBe('Boeing 737-800 (ICAO B738)');
    expect(read({ mode_s: '123456' })).toBeNull();
    expect(read({ registration: 'N987JK' })).toBeNull();
    expect(read({ registration: null, mode_s: null })).toBeNull();
    expect(modelLine(read({ type: null }), null)).toBeNull();
  });
});
