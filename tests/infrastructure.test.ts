import { describe, expect, it } from 'vitest';
import infrastructure from '../src/main/data/infrastructure.json';
import { infrastructureRecords, type InfrastructureFile } from '../src/shared/infrastructure';
import { FETCHERS } from '../src/main/layers/fetchers';
import { LAYERS } from '../src/shared/layers';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

const file = infrastructure as unknown as InfrastructureFile;

describe('bundled OpenStreetMap infrastructure', () => {
  it('holds every site from the recorded source extracts, all readable', () => {
    const dc = infrastructureRecords(file, 'datacenter');
    const dams = infrastructureRecords(file, 'dam');
    expect(dc.records).toHaveLength(4352);
    expect(dams.records).toHaveLength(703);
    expect(dc.skipped + dams.skipped).toBe(0);
    expect((file as unknown as { source: Record<string, { sha256: string }> }).source.datacenter.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps no contact details or free-text notes', () => {
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/"(email|phone|fax|contact:[a-z]+|note|fixme|website|description)"/);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
  });

  it('links each site to its OpenStreetMap object', () => {
    const r = infrastructureRecords(file, 'dam').records.find((x) => x.label === 'HE Podlubnik - Centrala')!;
    // Checked against the OSM API on 2026-11-14: relation 19953989 is this plant.
    expect(r.sourceUrl).toBe('https://www.openstreetmap.org/relation/19953989');
    expect(r.category).toBe('hydro');
    expect(isAllowedExternalUrl(r.sourceUrl)).toBe(true);
  });

  it('skips malformed rows instead of trusting the bundle', () => {
    const r = infrastructureRecords({ built: 'x', fields: [], datacenter: [['way', 1, 10, 10, {}], ['area', 2, 0, 0, {}], ['way', -3, 0, 0, {}], ['node', 4, 95, 0, {}], 'x'], dam: [] }, 'datacenter');
    expect(r.records.map((x) => x.id)).toEqual(['way-1']);
    expect(r.skipped).toBe(4);
    expect(r.records[0].label).toBe('Data centre (unnamed)');
  });

  it('serves both layers from the bundle without network access', async () => {
    const ctx = { fetchJson: () => { throw new Error('no network'); }, fetchText: () => { throw new Error('no network'); } } as never;
    expect((await FETCHERS.datacenters(ctx)).records).toHaveLength(4352);
    expect((await FETCHERS.dams(ctx)).records).toHaveLength(703);
    expect(LAYERS.dams.temporal).toBe('static');
    expect(LAYERS.datacenters.coverage).toMatch(/Incomplete/);
  });
});
