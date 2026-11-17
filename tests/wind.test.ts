import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGrib2 } from '../src/shared/grib2';
import { compassPoint, gfsCandidateRuns, gfsFileUrl, gfsForecastHour, gribIndexRange, sampleWind, windFromDeg, type WindField } from '../src/shared/wind';
import { createWindService } from '../src/main/windService';
import { assertAllowedUrl, FeedHttpError, type FetchBytes, type FetchText } from '../src/main/feeds/http';

// Real NOAA GFS 1° messages (run 2026-11-14 06Z, analysis), cut by byte range as the app requests them.
const U = new Uint8Array(readFileSync(new URL('./fixtures/gfs-1p00-ugrd10m.grib2', import.meta.url)));
const V = new Uint8Array(readFileSync(new URL('./fixtures/gfs-1p00-vgrd10m.grib2', import.meta.url)));
const IDX = readFileSync(new URL('./fixtures/gfs-1p00-sample.idx', import.meta.url), 'utf8');

describe('GRIB2 decoding (template 3.0 grid, 5.3 complex packing with spatial differencing)', () => {
  const u = decodeGrib2(U);
  const v = decodeGrib2(V);

  it('reads the grid, times and parameters', () => {
    expect([u.ni, u.nj, u.la1, u.lo1, u.di, u.dj]).toEqual([360, 181, 90, 0, 1, -1]);
    expect(u.refTime).toBe('2026-11-14T06:00:00.000Z');
    expect(u.forecastHours).toBe(0);
    expect([u.discipline, u.category, u.parameter]).toEqual([0, 2, 2]);
    expect([v.category, v.parameter]).toEqual([2, 3]);
    expect(u.values).toHaveLength(65160);
  });

  it('gives physically plausible winds: easterly trades, westerlies in the Southern Ocean, no wild values', () => {
    const at = (f: typeof u, lat: number, lon: number) => f.values[(90 - lat) * 360 + ((lon + 360) % 360)];
    // Averages over a band, so one storm does not decide the test.
    const band = (lat: number) => { let s = 0; for (let lon = 0; lon < 360; lon++) s += at(u, lat, lon); return s / 360; };
    expect(band(10)).toBeLessThan(-2); // trade winds blow from the east
    expect(band(-50)).toBeGreaterThan(4); // westerlies
    for (const f of [u, v]) for (const x of f.values) expect(Math.abs(x)).toBeLessThan(80);
    // A single grid point is the same physical wind in both fields' rows.
    expect(Number.isFinite(at(v, 0, 0))).toBe(true);
  });

  it('refuses what it cannot decode instead of guessing', () => {
    expect(() => decodeGrib2(new Uint8Array(20))).toThrow(/Not a GRIB/);
    const v1 = U.slice();
    v1[7] = 1;
    expect(() => decodeGrib2(v1)).toThrow(/edition 2/);
    // Truncated data section.
    expect(() => decodeGrib2(U.slice(0, U.length - 4000))).toThrow();
    // Packing template changed to 5.0.
    const other = U.slice();
    let p = 16;
    while (other[p + 4] !== 5) p += (other[p] << 24 >>> 0) + (other[p + 1] << 16) + (other[p + 2] << 8) + other[p + 3];
    other[p + 10] = 0;
    expect(() => decodeGrib2(other)).toThrow(/template 5.0/);
  });
});

describe('GFS run selection and index lines', () => {
  it('picks the newest run expected to be complete, then older ones', () => {
    const runs = gfsCandidateRuns(Date.parse('2026-11-14T11:00:00Z'));
    expect(runs.map((r) => r.toISOString())).toEqual(['2026-11-14T06:00:00.000Z', '2026-11-14T00:00:00.000Z', '2026-11-13T18:00:00.000Z', '2026-11-13T12:00:00.000Z']);
    // Just after a run time the previous run is still the newest complete one.
    expect(gfsCandidateRuns(Date.parse('2026-11-14T06:30:00Z'))[0].toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });

  it('uses the 3-hour forecast step nearest now', () => {
    const run = new Date('2026-11-14T06:00:00Z');
    expect(gfsForecastHour(run, Date.parse('2026-11-14T11:00:00Z'))).toBe(6);
    expect(gfsForecastHour(run, Date.parse('2026-11-14T07:20:00Z'))).toBe(0);
    expect(gfsFileUrl(run, 6)).toBe('https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261114/06/atmos/gfs.t06z.pgrb2.1p00.f006');
  });

  it('finds the 10 m wind byte ranges and ignores other levels', () => {
    expect(gribIndexRange(IDX, 'UGRD')).toEqual({ start: 34554012, end: 34632205 });
    expect(gribIndexRange(IDX, 'VGRD')).toEqual({ start: 34632206, end: 34711003 });
    expect(gribIndexRange('1:0:d=2026111406:UGRD:850 mb:anl:\n', 'UGRD')).toBeNull();
  });

  it('allows only the GFS bucket path on the shared S3 host', () => {
    expect(() => assertAllowedUrl('https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261114/06/atmos/gfs.t06z.pgrb2.1p00.f000.idx')).not.toThrow();
    expect(() => assertAllowedUrl('https://noaa-gfs-bdp-pds.s3.amazonaws.com/other/x')).toThrow(/Blocked/);
    expect(() => assertAllowedUrl('https://some-other-bucket.s3.amazonaws.com/gfs.x')).toThrow(/Blocked/);
  });
});

describe('sampling the field', () => {
  // A 4×3 grid: u = column index, v = -row index; rows run 90, 0, -90 (dj = -90), columns 0, 90, 180, 270.
  const f: Pick<WindField, 'ni' | 'nj' | 'la1' | 'lo1' | 'di' | 'dj' | 'u' | 'v'> = {
    ni: 4, nj: 3, la1: 90, lo1: 0, di: 90, dj: -90,
    u: Float32Array.from([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]),
    v: Float32Array.from([0, 0, 0, 0, -1, -1, -1, -1, -2, -2, -2, -2]),
  };
  it('interpolates bilinearly and wraps across the date line', () => {
    expect(sampleWind(f, 0, 45)!.u).toBeCloseTo(0.5);
    expect(sampleWind(f, 45, 0)!.v).toBeCloseTo(-0.5);
    // Between column 270° (u = 3) and 360° = 0° (u = 0).
    expect(sampleWind(f, 0, -45)!.u).toBeCloseTo(1.5);
    expect(sampleWind(f, 0, 315)!.u).toBeCloseTo(1.5);
    expect(sampleWind(f, -90, 0)).not.toBeNull();
    expect(sampleWind(f, 91, 0)).toBeNull();
  });
  it('states the direction the wind comes from', () => {
    expect(windFromDeg(0, -5)).toBeCloseTo(0); // blowing south = from the north
    expect(windFromDeg(-5, 0)).toBeCloseTo(90); // blowing west = from the east
    expect(compassPoint(windFromDeg(5, 5))).toBe('SW');
  });
});

describe('wind service', () => {
  const now = () => Date.parse('2026-11-14T11:00:00Z');
  const okText: FetchText = async () => ({ status: 200, text: IDX });
  const okBytes: FetchBytes = async (_url, opts) => {
    expect(opts.headers?.Range).toMatch(/^bytes=\d+-\d+$/);
    return { status: 206, bytes: opts.headers!.Range === 'bytes=34554012-34632205' ? U : V };
  };

  it('loads u and v by byte range and dates the field by its run', async () => {
    const urls: string[] = [];
    const wind = createWindService(async (url) => { urls.push(url); return okText(url); }, okBytes, () => 'test', now);
    const r = await wind();
    expect(urls).toEqual(['https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261114/06/atmos/gfs.t06z.pgrb2.1p00.f006.idx']);
    expect(r.staleReason).toBeNull();
    expect(r.field.runTime).toBe('2026-11-14T06:00:00.000Z');
    // The fixture is the analysis (0 h); the service reports the message's own forecast time, not the step it asked for.
    expect(r.field.forecastHours).toBe(0);
    expect(r.field.validTime).toBe('2026-11-14T06:00:00.000Z');
    expect(r.field.u).toHaveLength(65160);
  });

  it('falls back to an older run while the newest is not published', async () => {
    const asked: string[] = [];
    const text: FetchText = async (url) => {
      asked.push(url);
      if (asked.length === 1) throw new FeedHttpError('HTTP 404', 404, null, 'http');
      return okText(url);
    };
    const r = await createWindService(text, okBytes, () => 'test', now)();
    expect(asked[1]).toContain('gfs.20261114/00/');
    expect(r.field.u).toHaveLength(65160);
  });

  it('keeps the last complete field when a later refresh fails, and says so', async () => {
    let t = now();
    let fail = false;
    const wind = createWindService(async (url) => { if (fail) throw new FeedHttpError('Network error', null, null, 'network'); return okText(url); }, okBytes, () => 'test', () => t);
    const first = await wind();
    fail = true;
    t += 2 * 3_600_000;
    const second = await wind();
    expect(second.field).toBe(first.field);
    expect(second.staleReason).toMatch(/latest refresh failed/);
  });

  it('rejects a reply that is not 10 m wind', async () => {
    const wrong: FetchBytes = async () => ({ status: 206, bytes: U });
    await expect(createWindService(okText, wrong, () => 'test', now)()).rejects.toThrow(/not 10 m u\/v wind/);
  });
});
