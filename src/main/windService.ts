// Loads the 10 m wind forecast from NOAA GFS on the AWS Open Data registry: the index file of the newest complete run,
// then only the u and v messages by byte range (about 80 kB each at 1°). Cached for an hour; a failed refresh keeps
// the last complete field with its own times. Requests happen only while the wind layer is on and asks for data.

import { decodeGrib2 } from '../shared/grib2';
import { gfsCandidateRuns, gfsFileUrl, gfsForecastHour, gribIndexRange, type WindField } from '../shared/wind';
import { FeedHttpError, type FetchBytes, type FetchText } from './feeds/http';

const CACHE_MS = 60 * 60_000;
const MESSAGE_MAX_BYTES = 2 * 1024 * 1024;

export interface WindResult {
  field: WindField;
  /** Set when this is an older field kept because the latest refresh failed. */
  staleReason: string | null;
}

export function createWindService(fetchText: FetchText, fetchBytes: FetchBytes, userAgent: () => string, now: () => number = Date.now) {
  let last: { at: number; field: WindField } | null = null;
  let inflight: Promise<WindResult> | null = null;
  /** After a failure, wait before asking NOAA again (the layer may ask every few minutes). */
  let failedAt = -Infinity;

  async function load(): Promise<WindField> {
    const headers = { 'User-Agent': userAgent() };
    const errors: string[] = [];
    for (const run of gfsCandidateRuns(now())) {
      const fh = gfsForecastHour(run, now());
      const url = gfsFileUrl(run, fh);
      let idx: string;
      try {
        idx = (await fetchText(`${url}.idx`, { headers, timeoutMs: 20000, maxBytes: 512 * 1024 })).text;
      } catch (e) {
        // A run that is not fully published yet answers 403/404 on S3; try the previous one.
        if (e instanceof FeedHttpError && (e.status === 403 || e.status === 404)) { errors.push(`${run.toISOString().slice(0, 13)}Z not published`); continue; }
        throw e;
      }
      const ur = gribIndexRange(idx, 'UGRD');
      const vr = gribIndexRange(idx, 'VGRD');
      if (!ur || !vr || ur.end === null || vr.end === null) { errors.push('index without 10 m wind'); continue; }
      const part = async (r: { start: number; end: number | null }) => {
        if (r.end! - r.start + 1 > MESSAGE_MAX_BYTES) throw new Error('GFS wind message is larger than expected');
        const res = await fetchBytes(url, { headers: { ...headers, Range: `bytes=${r.start}-${r.end}` }, timeoutMs: 30000, maxBytes: MESSAGE_MAX_BYTES });
        if (res.status !== 206) throw new Error('GFS did not answer the byte-range request');
        return decodeGrib2(res.bytes);
      };
      const u = await part(ur);
      const v = await part(vr);
      if (u.category !== 2 || u.parameter !== 2 || v.category !== 2 || v.parameter !== 3) throw new Error('GFS messages are not 10 m u/v wind');
      if (u.ni !== v.ni || u.nj !== v.nj || u.la1 !== v.la1 || u.lo1 !== v.lo1) throw new Error('GFS u and v grids differ');
      const runTime = u.refTime;
      const hours = u.forecastHours ?? fh;
      return {
        model: 'GFS 1.0°', source: 'NOAA Global Forecast System',
        runTime, validTime: new Date(Date.parse(runTime) + hours * 3_600_000).toISOString(), forecastHours: hours,
        retrievedAt: new Date(now()).toISOString(),
        ni: u.ni, nj: u.nj, la1: u.la1, lo1: u.lo1, di: u.di, dj: u.dj, u: u.values, v: v.values,
      };
    }
    throw new Error(`No recent GFS run is available (${errors.join('; ')})`);
  }

  return async function wind(): Promise<WindResult> {
    if (last && now() - last.at < CACHE_MS) return { field: last.field, staleReason: null };
    if (inflight) return inflight;
    if (last && now() - failedAt < 10 * 60_000) return { field: last.field, staleReason: `The latest refresh failed; showing the run from ${last.field.runTime.slice(0, 13)}Z.` };
    inflight = (async () => {
      try {
        const field = await load();
        last = { at: now(), field };
        return { field, staleReason: null };
      } catch (e) {
        failedAt = now();
        if (last) return { field: last.field, staleReason: `The latest refresh failed (${e instanceof Error ? e.message : 'unknown error'}); showing the run from ${last.field.runTime.slice(0, 13)}Z.` };
        throw e;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
