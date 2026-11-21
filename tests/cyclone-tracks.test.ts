import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dropDuplicateStormPoints, gdacsLabelTime, gdacsTcListUrl, normalizeGdacsTcGeometry, parseGdacsTcList } from '../src/shared/cycloneTracks';
import type { GeoRecord } from '../src/shared/layers';

const list = JSON.parse(readFileSync(new URL('./fixtures/gdacs-tc-list.json', import.meta.url), 'utf8'));
const geometry = JSON.parse(readFileSync(new URL('./fixtures/gdacs-tc-geometry.json', import.meta.url), 'utf8'));

describe('GDACS cyclone list', () => {
  it('keeps only current storms, newest advisory first', () => {
    const { storms } = parseGdacsTcList(list);
    expect(storms.map((s) => s.name)).toEqual(['AKVAN-26', 'XAVIER-26']);
    expect(storms[0]).toMatchObject({ eventId: 1001351, episodeId: 4, advisoryAt: '2026-11-17T12:00:00.000Z', alertLevel: 'Orange' });
    expect(storms[0].geometryUrl).toBe('https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001351&episodeid=4');
  });
  it('rejects a reply that is not an event list', () => {
    expect(() => parseGdacsTcList({ error: 'x' })).toThrow();
  });
  it('asks for the last two weeks', () => {
    expect(gdacsTcListUrl(new Date('2026-11-17T10:00:00Z'))).toContain('fromDate=2026-11-03&toDate=2026-11-17');
  });
});

describe('GDACS storm geometry', () => {
  const storm = parseGdacsTcList(list).storms[0];
  const n = normalizeGdacsTcGeometry(geometry, storm);
  const byKind = (k: string) => n.records.filter((r) => r.props.kind === k);

  it('splits past positions from forecasts at the advisory time', () => {
    const track = byKind('track')[0];
    const forecast = byKind('forecast')[0];
    expect(track.geometry?.type).toBe('LineString');
    expect(track.props.from).toBe('2026-11-16T18:00:00.000Z');
    expect(track.props.to).toBe('2026-11-17T12:00:00.000Z');
    expect(forecast.props.until).toBe('2026-11-20T12:00:00.000Z');
    expect(byKind('forecastPoint')).toHaveLength(6);
    expect(byKind('storm')[0].props).toMatchObject({ pastPositions: 4, forecastPositions: 6 });
  });
  it('keeps the published cone polygon as it is', () => {
    const cone = byKind('cone')[0];
    expect(cone.geometry?.type).toBe('Polygon');
    const src = geometry.features.find((f: { properties: { Class: string } }) => f.properties.Class === 'Poly_Cones');
    expect((cone.geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(src.geometry.coordinates[0].length);
  });
  it('draws no cone or forecast when the file has none', () => {
    const bare = { ...geometry, features: geometry.features.filter((f: { properties: { Class: string } }) => f.properties.Class === 'Point_Centroid') };
    const m = normalizeGdacsTcGeometry(bare, storm);
    expect(m.records.map((r) => r.props.kind)).toEqual(['storm']);
    expect(m.records[0]).toMatchObject({ lat: storm.lat, lon: storm.lon });
  });
});

describe('advisory label times', () => {
  it('reads the day and month in UTC', () => {
    expect(gdacsLabelTime('17/11 12:00 UTC', '2026-11-16T18:00:00.000Z')).toBe('2026-11-17T12:00:00.000Z');
  });
  it('rolls into the new year for a storm that started in December', () => {
    expect(gdacsLabelTime('02/01 06:00 UTC', '2026-12-29T00:00:00.000Z')).toBe('2027-01-02T06:00:00.000Z');
  });
  it('refuses impossible dates', () => {
    expect(gdacsLabelTime('31/02 06:00 UTC', '2026-02-01T00:00:00.000Z')).toBeNull();
    expect(gdacsLabelTime('Centroid', '2026-02-01T00:00:00.000Z')).toBeNull();
  });
});

describe('NHC and GDACS duplicates', () => {
  it('drops the GDACS storm point when NHC lists the same storm, keeping its track', () => {
    const rec = (label: string, kind: string): GeoRecord => ({ id: label + kind, lat: 0, lon: 0, altM: null, heading: null, speedKts: null, label, category: null, observedAt: null, sourceUrl: null, source: 'x', props: { kind } });
    const kept = dropDuplicateStormPoints([rec('Hurricane MELISSA', 'nhc')], [rec('Tropical Storm MELISSA', 'storm'), rec('MELISSA forecast cone', 'cone'), rec('Tropical Storm AKVAN', 'storm')]);
    expect(kept.map((r) => r.label)).toEqual(['MELISSA forecast cone', 'Tropical Storm AKVAN']);
  });
});
