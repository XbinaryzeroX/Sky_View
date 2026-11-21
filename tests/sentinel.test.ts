import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { toUtm, utmZoneFromEpsg } from '../src/shared/utm';
import { boxProblem, parseStacScenes, parseTiffLevels, planRender, resampleToBox, stacSearchBody, undoHorizontalPredictor, type Box, type TiffLevel } from '../src/shared/sentinel';
import { encodePng, SentinelService } from '../src/main/sentinel';
import { assertAllowedUrl } from '../src/main/feeds/http';

const stac = JSON.parse(readFileSync(new URL('./fixtures/earth-search-s2.json', import.meta.url), 'utf8'));
const header = new Uint8Array(readFileSync(new URL('./fixtures/s2-tci-header.bin', import.meta.url)));
const LA: Box = [-118.6, 34.0, -118.4, 34.15];

describe('UTM', () => {
  it('matches a published reference point (CN Tower, zone 17N: 630084 E, 4833439 N)', () => {
    const [e, n] = toUtm(-79.387139, 43.642567, { zone: 17, south: false });
    expect(Math.abs(e - 630084)).toBeLessThan(2);
    expect(Math.abs(n - 4833439)).toBeLessThan(2);
  });
  it('puts the central meridian at 500 km and uses the southern false northing', () => {
    const [e, n] = toUtm(-117, -10, utmZoneFromEpsg(32711)!);
    expect(e).toBeCloseTo(500000, 3);
    expect(n).toBeGreaterThan(8_800_000);
  });
  it('accepts only WGS84 UTM codes', () => {
    expect(utmZoneFromEpsg(32611)).toEqual({ zone: 11, south: false });
    expect(utmZoneFromEpsg(4326)).toBeNull();
  });
});

describe('Earth Search scenes', () => {
  it('reads the published scenes with their projection and true-colour file', () => {
    const { scenes, skipped } = parseStacScenes(stac);
    expect(skipped).toBe(0);
    expect(scenes.map((s) => s.id)).toEqual(['S2C_11SLT_20261113_0_L2A', 'S2B_11SLT_20261108_0_L2A', 'S2A_11SLT_20261105_0_L2A']);
    expect(scenes[1]).toMatchObject({ epsg: 32611, cloudCover: 3, transform: [10, 0, 300000, 0, -10, 3800040], shape: [10980, 10980] });
  });
  it('refuses files outside the Sentinel-2 bucket', () => {
    const bad = structuredClone(stac);
    bad.features[0].assets.visual.href = 'https://evil.example/TCI.tif';
    expect(parseStacScenes(bad).skipped).toBe(1);
  });
  it('asks for recent, mostly clear scenes over the box', () => {
    const body = JSON.parse(stacSearchBody(LA, new Date('2026-11-17T00:00:00Z'), 40));
    expect(body.query['eo:cloud_cover'].lt).toBe(40);
    expect(body.datetime).toBe('2026-10-03T00:00:00.000Z/2026-11-17T00:00:00.000Z');
  });
  it('refuses boxes that are too big, too small or cross the date line', () => {
    expect(boxProblem(LA)).toBeNull();
    expect(boxProblem([-120, 34, -118, 36])).toMatch(/km across/);
    expect(boxProblem([10, 10, 10.001, 10.001])).toMatch(/too small/);
    expect(boxProblem([179.9, 0, -179.9, 0.1])).toMatch(/date line/);
  });
});

describe('cloud-optimised GeoTIFF', () => {
  const tiff = parseTiffLevels(header);
  it('reads the full image and its four overviews from the real header', () => {
    expect(tiff.compression).toBe(8);
    expect(tiff.predictor).toBe(2);
    expect(tiff.samples).toBe(3);
    expect(tiff.levels.map((l) => l.width)).toEqual([10980, 5490, 2745, 1373, 687]);
    expect(tiff.levels[0].tileWidth).toBe(1024);
    expect(tiff.levels[0].offsets).toHaveLength(121);
  });
  it('reads an 18 km box at full 10 m resolution from a few tiles', () => {
    const scene = parseStacScenes(stac).scenes[1];
    const plan = planRender(scene, tiff.levels, LA)!;
    expect(plan.level).toBe(0);
    expect(plan.pixelM).toBe(10);
    expect(plan.tiles.length).toBeLessThanOrEqual(9);
    expect(plan.outWidth).toBe(1600);
  });
  it('uses an overview for a 50 km box so the image stays near 1 600 px', () => {
    const scene = parseStacScenes(stac).scenes[1];
    const plan = planRender(scene, tiff.levels, [-118.9, 33.9, -118.36, 34.3])!;
    expect(plan.level).toBe(1);
    expect(plan.pixelM).toBe(20);
    expect(Math.max(plan.outWidth, plan.outHeight)).toBeLessThanOrEqual(1600);
  });
  it('returns null for a box outside the scene', () => {
    const scene = parseStacScenes(stac).scenes[1];
    expect(planRender(scene, tiff.levels, [2, 48, 2.2, 48.1])).toBeNull();
  });
  it('undoes horizontal differencing', () => {
    const d = new Uint8Array([10, 20, 30, 1, 1, 1, 255, 0, 2]);
    undoHorizontalPredictor(d, 3, 1, 3);
    expect([...d]).toEqual([10, 20, 30, 11, 21, 31, 10, 21, 33]);
  });
  it('leaves no-data and out-of-scene pixels transparent', () => {
    const scene = parseStacScenes(stac).scenes[1];
    const L: TiffLevel = { width: 10980, height: 10980, tileWidth: 1024, tileHeight: 1024, offsets: [], counts: [] };
    const plan = { level: 0, pixelM: 10, outWidth: 4, outHeight: 4, tiles: [], zone: { zone: 11, south: false } };
    const rgba = resampleToBox(scene, L, plan, new Map(), LA);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });
});

describe('PNG writer', () => {
  it('writes a valid header and the pixels', () => {
    const png = encodePng(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]), 2, 1);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatAt = Buffer.from(png).indexOf('IDAT');
    const len = new DataView(png.buffer).getUint32(idatAt - 4);
    expect([...inflateSync(png.slice(idatAt + 4, idatAt + 4 + len))]).toEqual([0, 1, 2, 3, 255, 4, 5, 6, 0]);
  });
});

describe('Sentinel service', () => {
  it('renders only scenes from its own search and reads the header first', async () => {
    const fetchJson = vi.fn(async (_url: string, _opts?: object) => ({ status: 200, body: stac as unknown }));
    const fetchBytes = vi.fn(async (_url: string, _opts: object) => ({ status: 206, bytes: header }));
    const s = new SentinelService(fetchJson, fetchBytes, 'test');
    await expect(s.render('S2B_11SLT_20261108_0_L2A', LA)).rejects.toThrow(/Search again/);
    const r = await s.search(LA, 40, new Date('2026-11-17T00:00:00Z'));
    expect(r.scenes[0]).not.toHaveProperty('href');
    expect(fetchJson.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });
  it('allows only the STAC host and the Sentinel-2 bucket path', () => {
    expect(() => assertAllowedUrl('https://earth-search.aws.element84.com/v1/search')).not.toThrow();
    expect(() => assertAllowedUrl('https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/11/S/LT/2026/11/x/TCI.tif')).not.toThrow();
    expect(() => assertAllowedUrl('https://sentinel-cogs.s3.us-west-2.amazonaws.com/other/x.tif')).toThrow();
  });
});
