import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGtfsVehicles } from '../src/shared/gtfsRealtime';
import { kartaviewUrl, normalizeDigitrafficTrains, normalizeKartaview, normalizePanoramax, normalizeRailGtfs, panoramaxUrl, PANORAMAX_PICTURE_PREFIXES, RAIL_FEEDS, railFeedsForView } from '../src/shared/streetRail';
import { aqhiBand, AQHI_URL, BIKE_SYSTEMS, bikeSystemsForView, conflictRecords, gdeltExportUrls, normalizeAqhi, normalizeGbfs, normalizeInaturalist, parseGdeltEvents, wildlifeUrl } from '../src/shared/cityLayers';
import { unzipSingleCsv } from '../src/main/layers/zipSingle';
import { assertAllowedUrl } from '../src/main/feeds/http';
import { RENDERER_REMOTES } from '../src/shared/remoteHosts';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

/** Minimal protobuf writer for hand-made GTFS-RT cases. */
const varint = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
const field = (no: number, wire: number, payload: number[]) => [...varint(no * 8 + wire), ...payload];
const lenField = (no: number, body: number[]) => field(no, 2, [...varint(body.length), ...body]);
const f32 = (x: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [...b]; };
const str = (s: string) => [...new TextEncoder().encode(s)];
const vehicleEntity = (id: string, lat: number, lon: number, ts: number) =>
  lenField(2, [...lenField(1, str(id)), ...lenField(4, [...lenField(2, [...field(1, 5, f32(lat)), ...field(2, 5, f32(lon))]), ...field(5, 0, varint(ts)), ...lenField(8, lenField(2, str(`T${id}`)))])]);

describe('GTFS-Realtime vehicle positions', () => {
  it('decodes real Renfe and Translink feeds to positions in their networks', () => {
    const renfe = decodeGtfsVehicles(bytes('gtfsrt-renfe-ld.pb'));
    expect(renfe.vehicles.length).toBeGreaterThan(100);
    expect(renfe.headerTimestamp).toBe(Date.parse('2026-11-14T14:05:49Z') / 1000);
    for (const v of renfe.vehicles) { expect(v.lat).toBeGreaterThan(27); expect(v.lat).toBeLessThan(44); expect(v.lon).toBeGreaterThan(-19); expect(v.lon).toBeLessThan(5); }
    const seq = decodeGtfsVehicles(bytes('gtfsrt-translink-seq-rail.pb'));
    expect(seq.vehicles.length).toBeGreaterThan(20);
    for (const v of seq.vehicles) { expect(v.lat).toBeGreaterThan(-29); expect(v.lat).toBeLessThan(-26); }
    expect(seq.vehicles[0].routeId).toBe('CLBR-5');
  });

  it('skips a (0, 0) "no fix" vehicle and refuses a truncated message', () => {
    const msg = new Uint8Array([...lenField(1, field(3, 0, varint(1794668746))), ...vehicleEntity('a', 60.17, 24.94, 1794668740), ...vehicleEntity('b', 0, 0, 1794668740)]);
    const r = decodeGtfsVehicles(msg);
    expect(r.vehicles.map((v) => v.entityId)).toEqual(['a']);
    expect(r.vehicles[0].label).toBe('Ta');
    expect(r.skipped).toBe(1);
    expect(() => decodeGtfsVehicles(msg.slice(0, msg.length - 3))).toThrow();
  });

  it('dates by the train report when given, by the feed header otherwise, and drops old positions', () => {
    const feed = RAIL_FEEDS.find((f) => f.id === 'renfe-larga-distancia')!;
    const now = Date.parse('2026-11-14T14:06:00Z');
    const r = normalizeRailGtfs(feed, decodeGtfsVehicles(bytes('gtfsrt-renfe-ld.pb')), now);
    expect(r.records[0].props.timeFrom).toBe('feed snapshot');
    expect(r.records[0].observedAt).toBe('2026-11-14T14:05:49.000Z');
    expect(normalizeRailGtfs(feed, decodeGtfsVehicles(bytes('gtfsrt-renfe-ld.pb')), now + 3_600_000).records).toHaveLength(0);
  });

  it('leaves out replacement buses listed in a train operator feed', () => {
    const vy = RAIL_FEEDS.find((f) => f.id === 'entur-vyg')!;
    const gtfs = { headerTimestamp: 1794668746, skipped: 0, vehicles: [
      { entityId: '1', tripId: 'VYG:ServiceJourney:BUS-823_761640-R', routeId: 'VYG:Line:RE', vehicleId: 'b', label: null, lat: 59.9, lon: 10.7, bearing: null, speedMps: null, timestamp: 1794668740, stopId: null, status: null },
      { entityId: '2', tripId: 'VYG:ServiceJourney:222_443615-R', routeId: 'VYG:Line:R', vehicleId: 't', label: null, lat: 59.9, lon: 10.75, bearing: null, speedMps: null, timestamp: 1794668740, stopId: null, status: null },
    ] };
    const r = normalizeRailGtfs(vy, gtfs, 1794668760_000);
    expect(r.records.map((x) => x.props.trip)).toEqual(['VYG:ServiceJourney:222_443615-R']);
    expect(r.records[0].label).toBe('Vy · VYG:Line:R');
  });

  it('reads Fintraffic train locations and picks feeds by view', () => {
    const feed = RAIL_FEEDS.find((f) => f.id === 'fintraffic-vr')!;
    const r = normalizeDigitrafficTrains(feed, json('digitraffic-train-locations.json'), Date.parse('2026-11-14T15:06:00Z'));
    expect(r.records.length).toBeGreaterThan(5);
    expect(r.records[0].label).toMatch(/^Train \d+$/);
    expect(railFeedsForView(60.17, 24.94, 50_000).map((f) => f.id)).toEqual(['fintraffic-vr']);
    expect(railFeedsForView(30, -40, 2_000_000)).toEqual([]);
    expect(railFeedsForView(60, 20, 10_000_000)).toEqual([]);
  });
});

describe('bike share', () => {
  const oslo = BIKE_SYSTEMS.find((s) => s.id === 'oslo-bysykkel')!;
  it('joins station information and status from a real Oslo reply', () => {
    const r = normalizeGbfs(json('gbfs-oslo-info.json'), json('gbfs-oslo-status.json'), oslo, Date.parse('2026-11-14T15:10:00Z'));
    expect(r.records).toHaveLength(12);
    const s = r.records[0];
    expect(s.id.startsWith('oslo-bysykkel:')).toBe(true);
    expect(typeof s.props.bikesAvailable).toBe('number');
    expect(['available', 'empty', 'closed']).toContain(s.category);
  });
  it('shows a station without a status report as unknown, not empty', () => {
    const info = json('gbfs-oslo-info.json');
    const r = normalizeGbfs(info, { data: { stations: [] } }, oslo, Date.now());
    expect(r.records.every((x) => x.category === 'unknown' && x.props.bikesAvailable === null)).toBe(true);
  });
  it('loads only systems near a zoomed-in view', () => {
    expect(bikeSystemsForView(59.91, 10.75, 20_000).map((s) => s.id)).toEqual(['oslo-bysykkel']);
    expect(bikeSystemsForView(59.91, 10.75, 2_000_000)).toEqual([]);
    for (const s of BIKE_SYSTEMS) { expect(() => assertAllowedUrl(s.infoUrl)).not.toThrow(); expect(() => assertAllowedUrl(s.statusUrl)).not.toThrow(); expect(isAllowedExternalUrl(s.licenseUrl)).toBe(true); }
    expect(() => assertAllowedUrl('https://gbfs.urbansharing.com/other-city/station_status.json')).toThrow(/Blocked/);
  });
});

describe('wildlife (iNaturalist)', () => {
  it('keeps openly licensed records and marks obscured locations', () => {
    const body = json('inat-v2-observations.json') as { results: Record<string, unknown>[] };
    const r = normalizeInaturalist(body);
    expect(r.records.length).toBe(body.results.length);
    expect(r.records[0].label).toBe('Eurasian Treecreeper');
    expect(r.records[0].sourceUrl).toBe('https://www.inaturalist.org/observations/413963310');
    const mixed = { results: [{ ...body.results[0], license_code: 'cc-by-nc' }, { ...body.results[0], id: 5, geoprivacy: 'obscured' }] };
    const m = normalizeInaturalist(mixed);
    expect(m.skipped).toBe(1);
    expect(m.records[0].props.locationObscured).toBe(true);
  });
  it('asks only for open licences and wildlife groups', () => {
    const url = wildlifeUrl([24.6, 60, 25.3, 60.4], new Date('2026-11-14T12:00:00Z'));
    expect(url).toContain('license=cc0,cc-by,cc-by-sa');
    expect(url).toContain('d1=2026-11-07');
    expect(url).not.toContain('Plantae');
    expect(() => assertAllowedUrl(url)).not.toThrow();
  });
});

describe('air quality (AQHI, Canada)', () => {
  it('reads real stations with their observation hour and bands', () => {
    const r = normalizeAqhi(json('eccc-aqhi-latest.json'));
    expect(r.records.length).toBe(15);
    expect(r.records[0].observedAt).toBe('2026-11-14T14:00:00.000Z');
    expect(r.records[0].label).toMatch(/AQHI \d+$/);
    expect(() => assertAllowedUrl(AQHI_URL)).not.toThrow();
  });
  it('uses the published bands and shows above 10 as 10+', () => {
    expect([1, 3.4, 3.6, 6.4, 7, 10.4, 10.6].map(aqhiBand)).toEqual(['low', 'low', 'moderate', 'moderate', 'high', 'high', 'very-high']);
    const r = normalizeAqhi({ features: [{ geometry: { coordinates: [-79, 43.7] }, properties: { location_id: 'X1', location_name_en: 'Toronto', aqhi: 11.2, observation_datetime: '2026-11-14T14:00:00Z' } }] });
    expect(r.records[0].props.aqhiShown).toBe('10+');
  });
});

describe('violence in the news (GDELT)', () => {
  const csv = unzipSingleCsv(bytes('gdelt-20261114144500.export.CSV.zip'), 20 * 1024 * 1024);
  it('reads a real 15-minute export and keeps physical violence with a place', () => {
    const { events } = parseGdeltEvents(csv);
    expect(events.length).toBeGreaterThan(30);
    expect(events.every((e) => ['18', '19', '20'].includes(e.root))).toBe(true);
    expect(events[0].addedAt).toBe('2026-11-14T14:45:00Z');
  });
  it('keeps one point per article, at its most specific place', () => {
    const { events } = parseGdeltEvents(csv);
    const records = conflictRecords(events);
    expect(new Set(records.map((r) => r.sourceUrl)).size).toBe(records.length);
    expect(records.length).toBeLessThan(events.length);
    // This article was coded at a state (New Mexico) and a city ("Isleta", which GDELT placed in Spain: a real coding error).
    const article = records.filter((r) => r.sourceUrl === 'https://www.wgauradio.com/news/national/deb-haaland-breaks/ZH6XLUTYEU7TTBR52KRT2HNKLQ/');
    expect(article).toHaveLength(1);
    expect(article[0].props.placement).toBe('city');
  });
  it('names the export files by 15-minute slot', () => {
    expect(gdeltExportUrls(Date.parse('2026-11-14T15:07:00Z'), 2, 0)).toEqual([
      'https://data.gdeltproject.org/gdeltv2/20261114150000.export.CSV.zip',
      'https://data.gdeltproject.org/gdeltv2/20261114144500.export.CSV.zip',
    ]);
    expect(() => assertAllowedUrl('https://data.gdeltproject.org/gdeltv2/20261114150000.export.CSV.zip')).not.toThrow();
  });
  it('refuses archives that are not one small CSV', () => {
    expect(() => unzipSingleCsv(bytes('gdelt-20261114144500.export.CSV.zip'), 1000)).toThrow(/larger than allowed/);
  });
});

describe('street-level photos', () => {
  it('keeps only blurred KartaView photos on the allowed image path', () => {
    const body = json('kartaview-photos.json') as { result: { data: Record<string, unknown>[] } };
    const r = normalizeKartaview(body);
    // One photo in the sample has no image URL and is skipped.
    expect(r.records.length).toBe(body.result.data.filter((p) => typeof p.imageLthUrl === 'string' && p.imageLthUrl !== '').length);
    expect(r.skipped).toBe(1);
    expect(r.records[0].imageUrl?.startsWith('https://cdn.kartaview.org/pr:sharp/')).toBe(true);
    const unblurred = { result: { data: [{ ...body.result.data[0], autoImgProcessingResult: 'NONE' }] } };
    expect(normalizeKartaview(unblurred).records).toHaveLength(0);
  });
  it('keeps Panoramax pictures only from instances the renderer may load', () => {
    const body = json('panoramax-search.json') as { features: { assets: Record<string, { href: string }> }[] };
    const r = normalizePanoramax(body);
    expect(r.records.length).toBe(body.features.length);
    const foreign = { features: [{ ...body.features[0], assets: { sd: { href: 'https://example.org/x.jpg' } } }] };
    expect(normalizePanoramax(foreign).records).toHaveLength(0);
    for (const p of PANORAMAX_PICTURE_PREFIXES) expect(RENDERER_REMOTES.some((x) => x.prefix === p)).toBe(true);
  });
  it('builds fixed search requests within the service limits', () => {
    expect(kartaviewUrl(51.5007, -0.1246)).toContain('radius=500');
    expect(() => assertAllowedUrl(kartaviewUrl(51.5, -0.12))).not.toThrow();
    expect(() => assertAllowedUrl(panoramaxUrl(48.85, 2.34))).not.toThrow();
  });
});

describe('train feeds', () => {
  it('every feed is allow-listed and links its licence', () => {
    for (const f of RAIL_FEEDS) {
      expect(() => assertAllowedUrl(f.url)).not.toThrow();
      expect(isAllowedExternalUrl(f.licenseUrl)).toBe(true);
    }
    expect(() => assertAllowedUrl('https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb')).toThrow(/Blocked/);
  });
});
