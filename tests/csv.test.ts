import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPreview, guessMapping, locationsToCsv, parseCsv, planImport, safeCsvText, validateLocationInput } from '../src/shared/csv';
import { loc } from './helpers';

describe('CSV parsing and mapping', () => {
  it('auto-maps common header aliases', () => {
    const p = parseCsv('Site,Lat,Lng,Type,Comments,Radius\nA,1,2,X,n,10\n');
    expect(guessMapping(p.headers)).toEqual({ name: 'Site', latitude: 'Lat', longitude: 'Lng', category: 'Type', notes: 'Comments', radius_km: 'Radius' });
  });

  it('strips a UTF-8 BOM and trims headers', () => {
    const p = parseCsv('﻿ name , latitude,longitude\nA,1,2\n');
    expect(p.headers).toEqual(['name', 'latitude', 'longitude']);
  });

  it('parses the documented sample file without errors', () => {
    const text = readFileSync(join(__dirname, '..', 'samples', 'sample-locations.csv'), 'utf8');
    const p = parseCsv(text);
    const preview = buildPreview(p, guessMapping(p.headers), []);
    expect(preview.length).toBe(8);
    expect(preview.every((r) => r.status === 'valid')).toBe(true);
    // Alaska and Hawaii coordinates are accepted
    expect(preview.some((r) => r.input?.name === 'Anchorage Storage' && r.input.lat > 60)).toBe(true);
    expect(preview.some((r) => r.input?.name === 'Hilo Shop' && r.input.lon < -150)).toBe(true);
  });
});

describe('CSV validation', () => {
  const csv = [
    'name,latitude,longitude,radius_km',
    'Good,39.7,-104.9,25',
    ',39.7,-104.9,25', // missing name
    'BadLat,91,-104.9,', // out of range
    'NotNumber,abc,-104.9,',
    'BadRadius,39,-104,0',
    'NoRadius,40,-105,', // defaults
    'Big radius,40,-105,5000',
  ].join('\n');

  it('reports per-row validation errors with row numbers', () => {
    const p = parseCsv(csv);
    const preview = buildPreview(p, guessMapping(p.headers), []);
    const byRow = Object.fromEntries(preview.map((r) => [r.rowNumber, r]));
    expect(byRow[2].status).toBe('valid');
    expect(byRow[3].errors.join(' ')).toMatch(/Name is required/);
    expect(byRow[4].errors.join(' ')).toMatch(/Latitude must be between/);
    expect(byRow[5].errors.join(' ')).toMatch(/Latitude is required and must be a number/);
    expect(byRow[6].errors.join(' ')).toMatch(/Radius must be greater than 0/);
    expect(byRow[7].status).toBe('valid');
    expect(byRow[7].input?.radiusKm).toBe(50);
    expect(byRow[8].status).toBe('invalid');
  });

  it('flags unmapped required columns', () => {
    const p = parseCsv('foo,bar\n1,2\n');
    const preview = buildPreview(p, guessMapping(p.headers), []);
    expect(preview[0].status).toBe('invalid');
    expect(preview[0].errors).toContain('No column mapped to name.');
  });

  it('validateLocationInput rejects NaN and out-of-range values', () => {
    expect(validateLocationInput({ name: 'x', lat: NaN, lon: 0, radiusKm: 1 })).not.toHaveLength(0);
    expect(validateLocationInput({ name: 'x', lat: 0, lon: 181, radiusKm: 1 })).not.toHaveLength(0);
    expect(validateLocationInput({ name: 'x', lat: 0, lon: 0, radiusKm: 1 })).toHaveLength(0);
  });
});

describe('CSV duplicate handling', () => {
  const existing = [loc({ id: 'e1', name: 'Denver Office', lat: 39.7392, lon: -104.9903 })];
  const csv = [
    'name,latitude,longitude',
    'denver office,39.73921,-104.99031', // dup of existing (case-insensitive, ~1 m away)
    'Denver Office,39.80,-104.99', // same name but ~7 km away: not a duplicate
    'Tulsa,36.15,-95.99',
    'Tulsa,36.15,-95.99', // dup within file
  ].join('\n');
  const p = parseCsv(csv);
  const preview = buildPreview(p, guessMapping(p.headers), existing);

  it('classifies duplicates of saved locations and within the file', () => {
    expect(preview.map((r) => r.status)).toEqual(['duplicate-existing', 'valid', 'valid', 'duplicate-in-file']);
    expect(preview[0].duplicateOfId).toBe('e1');
  });

  it('skip mode skips all duplicates', () => {
    const plan = planImport(preview, 'skip');
    expect(plan.items.map((i) => i.action)).toEqual(['create', 'create']);
    expect(plan.skipped).toBe(2);
  });

  it('update mode updates the existing location', () => {
    const plan = planImport(preview, 'update');
    expect(plan.items[0]).toMatchObject({ action: 'update', targetId: 'e1' });
    expect(plan.items).toHaveLength(3);
    expect(plan.skipped).toBe(1);
  });

  it('keep mode imports everything valid', () => {
    const plan = planImport(preview, 'keep');
    expect(plan.items).toHaveLength(4);
    expect(plan.items.every((i) => i.action === 'create')).toBe(true);
  });
});

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas in text cells', () => {
    expect(safeCsvText('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(safeCsvText('@SUM')).toBe(`'@SUM`);
    expect(safeCsvText('Normal')).toBe('Normal');
    const out = locationsToCsv([loc({ name: '=cmd', notes: 'a, "quoted" note', lat: 39.5, lon: -105 })]);
    expect(out.split('\r\n')[0]).toBe('name,latitude,longitude,category,notes,radius_km');
    expect(out).toContain(`'=cmd`);
    expect(out).toContain('"a, ""quoted"" note"');
    expect(out).toContain('-105.000000');
  });

  it('round-trips through import', () => {
    const l = loc({ name: 'Round Trip', category: 'Office', notes: 'n', lat: 61.2181, lon: -149.9003, radiusKm: 150 });
    const p = parseCsv(locationsToCsv([l]));
    const preview = buildPreview(p, guessMapping(p.headers), []);
    expect(preview[0].input).toMatchObject({ name: 'Round Trip', category: 'Office', lat: 61.2181, lon: -149.9003, radiusKm: 150 });
  });
});
