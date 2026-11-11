import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVEBC_IMAGE_PREFIX, HK_IMAGE_PREFIX, QUEBEC_VIEWER_PREFIX, TFL_IMAGE_PREFIX, normalizeDriveBc, normalizeHongKongCams, normalizeQuebecCams, normalizeTflJamCams } from '../src/shared/cameraSources';
import { isAllowedRendererUrl } from '../src/shared/remoteHosts';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', 'layers', n), 'utf8');
const allowed = (u: string) => isAllowedRendererUrl(u, { google3d: false });

describe('TfL JamCams (London)', () => {
  it('keeps available cameras with TfL S3 stills; skips unavailable ones and foreign image hosts', () => {
    const body = JSON.parse(fx('tfl-jamcams.json')) as Record<string, unknown>[];
    const n = normalizeTflJamCams(body);
    expect(n.records).toHaveLength(2);
    expect(n.skipped).toBe(1); // the fixture's camera marked unavailable
    const c = n.records[0];
    expect(c.id).toMatch(/^tfl-[0-9.]+$/);
    expect(c.imageUrl!.startsWith(TFL_IMAGE_PREFIX)).toBe(true);
    expect(allowed(c.imageUrl!)).toBe(true);
    expect(c.source).toContain('Powered by TfL Open Data');
    expect(c.props.mediaType).toBe('still');
    // An image on another host is refused.
    const evil = structuredClone(body[0]) as { additionalProperties: { key: string; value: string }[] };
    evil.additionalProperties.find((p) => p.key === 'imageUrl')!.value = 'https://evil.example.com/x.jpg';
    expect(normalizeTflJamCams([evil]).records).toHaveLength(0);
    expect(() => normalizeTflJamCams({})).toThrow();
    // Malformed entries are skipped without losing the valid ones.
    const mixed = normalizeTflJamCams([null, 'x', 7, [], body[0], { ...body[1], additionalProperties: [null, 3] }]);
    expect(mixed.records).toHaveLength(1);
    expect(mixed.skipped).toBe(5);
  });
});

describe('Hong Kong Transport Department', () => {
  it('parses the XML list; image must be the camera key on the TD image host', () => {
    const n = normalizeHongKongCams(fx('hk-cameras.xml'));
    expect(n.records).toHaveLength(2);
    const c = n.records[0];
    expect(c.id).toMatch(/^hk-/);
    expect(c.imageUrl).toBe(`${HK_IMAGE_PREFIX}${c.id.slice(3)}.JPG`);
    expect(allowed(c.imageUrl!)).toBe(true);
    expect(c.lat).toBeGreaterThan(22);
    expect(c.lon).toBeGreaterThan(113);
    const bad = '<image-list><image><key>K1</key><latitude>22.3</latitude><longitude>114.1</longitude><url>https://evil.example.com/K1.JPG</url></image>' +
      '<image><key>K2</key><latitude>0</latitude><longitude>0</longitude><url>https://tdcctv.data.one.gov.hk/K2.JPG</url></image>' +
      '<image><key>K3&amp;x</key><latitude>22.3</latitude><longitude>114.1</longitude><url>https://tdcctv.data.one.gov.hk/K3&amp;x.JPG</url></image></image-list>';
    expect(normalizeHongKongCams(bad)).toMatchObject({ records: [], skipped: 3 });
    // A missing or empty coordinate is not 0.
    const gaps = '<image-list><image><key>K4</key><longitude>114.15</longitude><url>https://tdcctv.data.one.gov.hk/K4.JPG</url></image>' +
      '<image><key>K5</key><latitude> </latitude><longitude>114.15</longitude><url>https://tdcctv.data.one.gov.hk/K5.JPG</url></image>' +
      '<image><key>K6</key><latitude>22.3</latitude><longitude>114.15</longitude><url>https://tdcctv.data.one.gov.hk/K6.JPG</url></image></image-list>';
    const g = normalizeHongKongCams(gaps);
    expect(g.records.map((r) => r.id)).toEqual(['hk-K6']);
    expect(g.skipped).toBe(2);
    expect(() => normalizeHongKongCams('<html></html>')).toThrow();
  });
});

describe('DriveBC (British Columbia)', () => {
  it('keeps cameras that are on, builds the www.drivebc.ca still URL, and carries the camera credit', () => {
    const body = JSON.parse(fx('drivebc.json')) as Record<string, unknown>[];
    const n = normalizeDriveBc(body);
    expect(n.records.length).toBe(2);
    expect(n.skipped).toBe(1);
    for (const c of n.records) {
      expect(c.imageUrl).toBe(`${DRIVEBC_IMAGE_PREFIX}${c.id.slice('drivebc-'.length)}.jpg`);
      expect(allowed(c.imageUrl!)).toBe(true);
      expect(c.lon).toBeLessThan(-100);
    }
    expect(n.records.some((c) => String(c.props.publisher).includes('Camera power provided by'))).toBe(true);
    // A display link that does not match the camera id is refused (no arbitrary paths).
    const odd = { ...body[0], links: { imageDisplay: '/images/999999.jpg' } };
    expect(normalizeDriveBc([odd]).records).toHaveLength(0);
    const mixed = normalizeDriveBc([null, 'x', [], body[0], { ...body[1], location: null, links: 5 }]);
    expect(mixed.records).toHaveLength(1);
    expect(mixed.skipped).toBe(4);
  });
});

describe('Québec 511', () => {
  it('links each camera to its Québec 511 viewer page (no image is loaded in the app)', () => {
    const n = normalizeQuebecCams(JSON.parse(fx('quebec-cameras.geojson')));
    expect(n.records).toHaveLength(2);
    const c = n.records[0];
    expect(c.imageUrl).toBeNull();
    expect(c.sourceUrl!.startsWith(QUEBEC_VIEWER_PREFIX)).toBe(true);
    expect(c.props.mediaType).toBe('viewer');
    expect(isAllowedExternalUrl(c.sourceUrl)).toBe(true);
    const wrong = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { IDEcamera: '1', URL_FLUX_DONNEE: 'https://evil.example.com/?id=1' }, geometry: { type: 'Point', coordinates: [-71, 46] } }] };
    expect(normalizeQuebecCams(wrong)).toMatchObject({ records: [], skipped: 1 });
    const noLat = { type: 'FeatureCollection', features: [null, { type: 'Feature', properties: { IDEcamera: '2', URL_FLUX_DONNEE: QUEBEC_VIEWER_PREFIX + '2' }, geometry: { type: 'Point', coordinates: [-71, null] } }] };
    expect(normalizeQuebecCams(noLat)).toMatchObject({ records: [], skipped: 2 });
  });
});
