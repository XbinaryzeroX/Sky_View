import { describe, expect, it } from 'vitest';
import { domainUrl, EUMETSAT_WMS, eumetsatFrameTime, expireFrames, fetchLatestFrame, frameLabel, frameUsable, GEO_SAT_LOOKUP_MAX_BYTES, GEO_SAT_MAX_AGE_MS, GEO_SATS, parseLatestFrame, readCapped, tileTemplate } from '../src/shared/geoSatellite';
import { DEFAULT_SETTINGS, IPC, settingsPatchSchema, validateIpcArgs } from '../src/shared/ipc';
import { isAllowedRendererUrl } from '../src/shared/remoteHosts';

// A real DescribeDomains answer from GIBS (2026-11-11), and a multi-range one.
const ONE = "<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><SpaceDomain><BoundingBox minx='-20037508.342789' maxx='20037508.342789' crs='urn:ogc:def:crs:EPSG::3857' miny='-20037508.342789' maxy='20037508.342789'/></SpaceDomain><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-11-11T10:00:00Z/2026-11-11T13:20:00Z/PT10M</Domain><Size>1</Size></DimensionDomain></Domains>";
const MANY = '<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-11-11T08:00:00Z/2026-11-11T09:10:00Z/PT10M,2026-11-11T09:40:00Z,2026-11-11T10:00:00Z/2026-11-11T12:50:00Z/PT10M</Domain></DimensionDomain></Domains>';

describe('weather satellites: newest frame', () => {
  it('reads the newest frame from a DescribeDomains answer', () => {
    expect(parseLatestFrame(ONE)).toBe('2026-11-11T13:20:00Z');
    expect(parseLatestFrame(MANY)).toBe('2026-11-11T12:50:00Z');
  });
  it('returns null only for a well-formed answer listing no frame; anything malformed is a failed lookup', () => {
    expect(parseLatestFrame('<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain></Domain></DimensionDomain></Domains>')).toBeNull();
    expect(parseLatestFrame('<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain/></DimensionDomain></Domains>')).toBeNull();
    expect(() => parseLatestFrame('<Domains></Domains>')).toThrow();
    expect(() => parseLatestFrame('<html>error</html>')).toThrow();
    expect(() => parseLatestFrame(ONE.slice(0, 200))).toThrow(); // truncated
    expect(() => parseLatestFrame('<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-11-11T10:00:00Z/../evil/PT10M</Domain></DimensionDomain></Domains>')).toThrow();
    expect(() => parseLatestFrame('<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-13-45T99:00:00Z</Domain></DimensionDomain></Domains>')).toThrow();
    // Both ends of a range, their order and the period are checked.
    const dom = (d: string) => `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>${d}</Domain></DimensionDomain></Domains>`;
    expect(() => parseLatestFrame(dom('garbage/2026-11-11T13:20:00Z/PT10M'))).toThrow();
    expect(() => parseLatestFrame(dom('2026-11-11T10:00:00Z/2026-11-11T13:20:00Z/not-a-duration'))).toThrow();
    expect(() => parseLatestFrame(dom('2026-11-11T13:20:00Z/2026-11-11T10:00:00Z/PT10M'))).toThrow();
    expect(() => parseLatestFrame(dom('2026-11-11T10:00:00Z/2026-11-11T13:20:00Z'))).toThrow();
    expect(parseLatestFrame(dom('2026-11-11T10:00:00Z/2026-11-11T13:20:00Z/P1D'))).toBe('2026-11-11T13:20:00Z');
    // Only the time dimension counts.
    expect(() => parseLatestFrame('<Domains><DimensionDomain><ows:Identifier>elevation</ows:Identifier><Domain>2026-11-11T10:00:00Z</Domain></DimensionDomain></Domains>')).toThrow();
  });
  it('draws a frame only while it is recent (an outage shows as missing, not as old weather)', () => {
    const now = Date.parse('2026-11-11T14:00:00Z');
    expect(frameUsable('2026-11-11T13:20:00Z', now)).toBe(true);
    expect(frameUsable(new Date(now - GEO_SAT_MAX_AGE_MS - 60_000).toISOString(), now)).toBe(false);
    expect(frameUsable('2026-11-11T15:00:00Z', now)).toBe(false); // from the future
    expect(frameUsable(null, now)).toBe(false);
    expect(frameLabel('2026-11-11T13:20:00Z')).toBe('13:20 UTC');
  });
});

describe('weather satellites: requests', () => {
  const now = Date.parse('2026-11-11T13:50:43.512Z');
  it('builds GIBS URLs the renderer is allowed to load, for every GIBS satellite and product', () => {
    for (const s of GEO_SATS.filter((x) => x.source === 'gibs'))
      for (const L of Object.values(s.layers)) {
        const d = domainUrl(L, now);
        expect(d).toBe(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/${L.id}/default/${L.tms}/all/2026-11-11T10:50:43Z--2026-11-11T13:50:43Z.xml`);
        const tile = tileTemplate(L, '2026-11-11T13:20:00Z').replace('{z}', '3').replace('{y}', '2').replace('{x}', '1');
        expect(tile).toBe(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${L.id}/default/2026-11-11T13:20:00Z/${L.tms}/3/2/1.png`);
        expect(isAllowedRendererUrl(d, { google3d: false })).toBe(true);
        expect(isAllowedRendererUrl(tile, { google3d: false })).toBe(true);
        expect(L.tms).toBe(`GoogleMapsCompatible_Level${L.maxLevel}`);
      }
  });
  it('refuses a frame time that is not one GIBS lists', () => {
    const L = GEO_SATS[0].layers.infrared;
    expect(() => tileTemplate(L, '../../x')).toThrow();
    expect(() => tileTemplate(L, 'default')).toThrow();
  });
  it('clips neighbouring disks so they meet without overlapping or leaving a gap', () => {
    expect(GEO_SATS.map((s) => s.id)).toEqual(['goes-west', 'goes-east', 'meteosat-0', 'meteosat-iodc', 'himawari']);
    for (let i = 1; i < GEO_SATS.length; i++) expect(GEO_SATS[i].west).toBe(GEO_SATS[i - 1].east);
    expect(GEO_SATS[0].west).toBe(-180);
    expect(GEO_SATS.at(-1)!.east).toBe(180);
    for (const s of GEO_SATS) expect(s.west).toBeLessThan(s.east);
  });
  it('draws Meteosat from hourly EUMETSAT frames only, on the hour and at least 20 minutes old', () => {
    expect(eumetsatFrameTime(Date.parse('2026-11-14T15:41:00Z'))).toBe('2026-11-14T15:00:00Z');
    expect(eumetsatFrameTime(Date.parse('2026-11-14T15:10:00Z'))).toBe('2026-11-14T14:00:00Z');
    expect(eumetsatFrameTime(Date.parse('2026-11-15T00:05:00Z'))).toBe('2026-11-14T23:00:00Z');
    expect(frameUsable(eumetsatFrameTime(Date.now()), Date.now())).toBe(true);
    expect(isAllowedRendererUrl(`${EUMETSAT_WMS}?service=WMS&request=GetMap&layers=msg_fes:ir108`, { google3d: false })).toBe(true);
    expect(isAllowedRendererUrl('https://view.eumetsat.int/other/path', { google3d: false })).toBe(false);
    for (const s of GEO_SATS.filter((x) => x.source === 'eumetsat')) for (const L of Object.values(s.layers)) expect(L.id).toMatch(/^msg_(fes|iodc):(ir108|rgb_naturalenhncd)$/);
  });
});

describe('weather satellites: settings', () => {
  it('is off by default and accepts only the two products', () => {
    expect(DEFAULT_SETTINGS.geoSatEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.geoSatProduct).toBe('infrared');
    expect(() => validateIpcArgs(IPC.settingsUpdate, [{ geoSatEnabled: true, geoSatProduct: 'color' }])).not.toThrow();
    expect(() => validateIpcArgs(IPC.settingsUpdate, [{ geoSatProduct: 'visible' }])).toThrow();
    expect(settingsPatchSchema.safeParse({ geoSatEnabled: 'yes' }).success).toBe(false);
  });
});

describe('weather satellites: bounded lookups', () => {
  const L = GEO_SATS[1].layers.infrared;
  const now = Date.parse('2026-11-11T13:50:00Z');
  it('reads a normal answer and reports HTTP errors', async () => {
    expect(await fetchLatestFrame(L, now, { fetchImpl: async () => new Response(ONE) })).toBe('2026-11-11T13:20:00Z');
    await expect(fetchLatestFrame(L, now, { fetchImpl: async () => new Response('busy', { status: 503 }) })).rejects.toThrow('HTTP 503');
    // An HTTP 200 error page is a failed lookup too (the frame on screen is kept), not "no frame".
    await expect(fetchLatestFrame(L, now, { fetchImpl: async () => new Response('<html>Service unavailable</html>') })).rejects.toThrow('Unexpected answer');
  });
  it('refuses an oversized answer while it streams, and cancels it', async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(16 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(fetchLatestFrame(L, now, { fetchImpl: async () => new Response(endless) })).rejects.toThrow('Response too large');
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(6);
    // A declared length over the cap is refused before reading.
    await expect(readCapped(new Response('x', { headers: { 'content-length': String(GEO_SAT_LOOKUP_MAX_BYTES + 1) } }), GEO_SAT_LOOKUP_MAX_BYTES)).rejects.toThrow('Response too large');
  });
  it('gives up on a body that stalls, once the signal fires', async () => {
    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('<Domains>')); } });
    const signal = AbortSignal.timeout(50);
    // The body sends a few bytes and then nothing: the timeout alone must end the lookup.
    const fetchImpl = (async () => new Response(stalled)) as typeof fetch;
    const t0 = Date.now();
    await expect(fetchLatestFrame(L, now, { fetchImpl, signal })).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('expires frames on its own clock', () => {
    const times = { 'goes-east': '2026-11-11T13:20:00Z', himawari: '2026-11-11T09:00:00Z' } as const;
    const out = expireFrames({ ...times }, now);
    expect(out).toEqual({ 'goes-east': '2026-11-11T13:20:00Z', himawari: null });
    const fresh = { 'goes-east': '2026-11-11T13:20:00Z' };
    expect(expireFrames(fresh, now)).toBe(fresh); // unchanged → same object (no re-render)
  });
});
