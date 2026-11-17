// Group 4: observed-weather history timeline, wind speed colours, OpenStreetMap military sites and plate-reader
// locations, tilt and global-picture view rules, and the launch event timeline.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { backLabel, clampBack, nextPlayFrame, satFrameBack, stepBack, WEATHER_MAX_BACK_MIN, wmsTime } from '../src/shared/weatherTimeline';
import { WIND_SPEED_BANDS, windSpeedBand } from '../src/shared/wind';
import { normalizeAlprSites, normalizeMilitarySites, OSM_SITES, osmBlock, osmDirection, osmSiteQuery } from '../src/shared/osmSites';
import { enterGlobalPicture, GLOBAL_PICTURE_LAYERS, isTilted, leaveGlobalPicture, nextTiltPitch, parseGlobalPictureState, TILT_OBLIQUE_RAD } from '../src/shared/viewModes';
import { eventIndexAt, isoDurationSeconds, launchDetailUrl, normalizeLaunchTimeline, replayRange, tClock } from '../src/shared/launchTimeline';
import { createLaunchTimelineLookup } from '../src/main/launchTimelineLookup';
import { clearOsmSiteCache, FETCHERS, type FetchContext } from '../src/main/layers/fetchers';
import { assertAllowedUrl, FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { DEFAULT_SETTINGS, IPC, ipcArgSchemas } from '../src/shared/ipc';
import { LAYERS } from '../src/shared/layers';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
const NOW = Date.parse('2026-11-15T04:07:30Z');

describe('observed-weather history timeline', () => {
  it('keeps offsets on 10-minute steps between newest and two hours back', () => {
    expect(clampBack(37)).toBe(40);
    expect(clampBack(-5)).toBe(0);
    expect(clampBack(999)).toBe(WEATHER_MAX_BACK_MIN);
    expect(clampBack(Number.NaN)).toBe(0);
    expect(stepBack(0, -1)).toBe(0);
    expect(stepBack(110, 1)).toBe(120);
    expect(stepBack(120, 1)).toBe(120);
  });
  it('plays towards the present and wraps from the newest frame to the oldest', () => {
    expect(nextPlayFrame(120)).toBe(110);
    expect(nextPlayFrame(10)).toBe(0);
    expect(nextPlayFrame(0)).toBe(120);
  });
  it('asks nowCOAST for no time at the newest frame and for a floored past time otherwise', () => {
    expect(wmsTime(NOW, 0)).toBeNull();
    expect(wmsTime(NOW, 40)).toBe('2026-11-15T03:20:00Z');
    // The same frame for the whole step, so tiles are cached.
    expect(wmsTime(NOW + 2 * 60_000, 40)).toBe('2026-11-15T03:20:00Z');
    // Across midnight UTC.
    expect(wmsTime(Date.parse('2026-11-15T00:05:00Z'), 30)).toBe('2026-11-14T23:30:00Z');
  });
  it('counts satellite frames back from the newest listed frame and keeps an unknown frame unknown', () => {
    expect(satFrameBack('2026-11-15T03:20:00Z', 0)).toBe('2026-11-15T03:20:00Z');
    expect(satFrameBack('2026-11-15T00:10:00Z', 30)).toBe('2026-11-14T23:40:00Z');
    expect(satFrameBack(null, 30)).toBeNull();
    expect(satFrameBack('yesterday', 30)).toBeNull();
  });
  it('labels the offset in words', () => {
    expect(backLabel(0)).toBe('Newest frames');
    expect(backLabel(40)).toBe('40 min before the newest frames');
    expect(backLabel(120)).toBe('2 h before the newest frames');
  });
});

describe('wind speed colours', () => {
  it('puts each speed in one band and gives an invalid speed none', () => {
    expect(windSpeedBand(0)).toBe(0);
    expect(windSpeedBand(2.99)).toBe(0);
    expect(windSpeedBand(3)).toBe(1);
    expect(windSpeedBand(20.9)).toBe(3);
    expect(windSpeedBand(80)).toBe(WIND_SPEED_BANDS.length - 1);
    expect(windSpeedBand(Number.NaN)).toBe(-1);
    expect(windSpeedBand(-1)).toBe(-1);
  });
  it('has rising limits, a text label per band and a setting that is off by default', () => {
    for (let i = 1; i < WIND_SPEED_BANDS.length; i++) expect(WIND_SPEED_BANDS[i].below).toBeGreaterThan(WIND_SPEED_BANDS[i - 1].below);
    expect(WIND_SPEED_BANDS.every((b) => /m\/s/.test(b.label) && /^#[0-9a-f]{6}$/.test(b.color))).toBe(true);
    expect(new Set(WIND_SPEED_BANDS.map((b) => b.color)).size).toBe(WIND_SPEED_BANDS.length);
    expect(DEFAULT_SETTINGS.windColorBySpeed).toBe(false);
    const schema = ipcArgSchemas[IPC.settingsUpdate];
    expect(schema.safeParse([{ windColorBySpeed: true }]).success).toBe(true);
    expect(schema.safeParse([{ windColorBySpeed: 'yes' }]).success).toBe(false);
  });
});

describe('OpenStreetMap site blocks and queries', () => {
  it('snaps a view to one fixed block and asks nothing when zoomed out or invalid', () => {
    const a = osmBlock('alpr', 33.749, -84.388, 20_000)!;
    const b = osmBlock('alpr', 33.76, -84.4, 30_000)!;
    expect(a.key).toBe(b.key);
    expect([a.south, a.west, a.north, a.east]).toEqual([33.6, -84.6, 33.9, -84.3]);
    expect(osmBlock('alpr', 33.749, -84.388, OSM_SITES.alpr.maxHeightM + 1)).toBeNull();
    expect(osmBlock('military', 38.9, -77, 400_000)!.key).toBe('military:37.5,-78,40.5,-75');
    expect(osmBlock('military', Number.NaN, 0, 1000)).toBeNull();
    expect(osmBlock('military', 91, 0, 1000)).toBeNull();
  });
  it('cuts a block at the date line on the side of the view and at 85° latitude', () => {
    const east = osmBlock('military', 0, 179.6, 100_000)!;
    expect([east.west, east.east]).toEqual([178.5, 180]);
    const west = osmBlock('military', 0, -179.6, 100_000)!;
    expect([west.west, west.east]).toEqual([-180, -178.5]);
    const north = osmBlock('military', 84.9, 10, 100_000)!;
    expect(north.north).toBe(85);
    expect(north.south).toBeLessThan(85);
  });
  it('builds the fixed queries from the block numbers only', () => {
    const b = osmBlock('alpr', 33.749, -84.388, 20_000)!;
    expect(osmSiteQuery('alpr', b)).toBe('[out:json][timeout:25];node["man_made"="surveillance"]["surveillance:type"="ALPR"](33.6,-84.6,33.9,-84.3);out tags 2000;');
    const q = osmSiteQuery('military', osmBlock('military', 38.9, -77, 400_000)!);
    expect(q).toContain('nwr["landuse"="military"](37.5,-78,40.5,-75);');
    expect(q).toMatch(/out center tags 800;$/);
  });
});

describe('military sites (real Overpass sample, Chesapeake area)', () => {
  const sample = (fixture('osm-military-chesapeake.json') as { elements: Record<string, unknown>[] }).elements;
  it('places each object at its point or area centre and names the kind', () => {
    const n = normalizeMilitarySites(sample);
    expect(n.records.length).toBe(sample.length);
    expect(n.skipped).toBe(0);
    const lieber = n.records.find((r) => r.label === 'Lieber Army Reserve Center')!;
    expect(lieber.id).toBe('n368949428');
    expect(lieber.category).toBe('Military land');
    expect(lieber.props.placedAt).toBe('mapped point');
    expect(lieber.sourceUrl).toBe('https://www.openstreetmap.org/node/368949428');
    expect(isAllowedExternalUrl(lieber.sourceUrl!)).toBe(true);
    const way = n.records.find((r) => r.id === 'w41965158')!;
    expect(way.category).toBe('Base');
    expect(way.label).toBe('Base (unnamed)');
    expect(way.props.placedAt).toBe('centre of the mapped area');
    expect(n.records.every((r) => r.lat > 35 && r.lat < 40 && r.lon > -78.5 && r.lon < -74)).toBe(true);
  });
  it('skips objects without a usable position or a military tag, and repeats', () => {
    const n = normalizeMilitarySites([
      sample[0], sample[0],
      { type: 'way', id: 5, tags: { landuse: 'military' } },
      { type: 'node', id: 6, lat: 95, lon: 0, tags: { landuse: 'military' } },
      { type: 'node', id: 7, lat: 1, lon: 1, tags: { amenity: 'cafe' } },
      { type: 'area', id: 8, lat: 1, lon: 1, tags: { landuse: 'military' } },
      null,
    ]);
    expect(n.records.length).toBe(1);
    expect(n.skipped).toBe(5);
    expect(() => normalizeMilitarySites({ remark: 'x' })).toThrow();
  });
});

describe('plate-reader camera locations', () => {
  // Hand-built in the Overpass answer shape with tags as mappers write them: both public Overpass servers were at
  // capacity when the sample was to be taken (2026-11-15), so this is not a recorded answer.
  const sample = [
    { type: 'node', id: 11001, lat: 33.7712, lon: -84.3899, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR', manufacturer: 'Flock Safety', operator: 'Atlanta Police Department', direction: '135', 'camera:mount': 'pole', 'surveillance:zone': 'traffic' } },
    { type: 'node', id: 11002, lat: 33.7801, lon: -84.4102, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR', 'camera:direction': 'NW' } },
    { type: 'node', id: 11003, lat: 33.79, lon: -84.4, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR', direction: 'towards the road' } },
  ];
  it('keeps the location and the device tags, and nothing about vehicles', () => {
    const n = normalizeAlprSites(sample);
    expect(n.records.length).toBe(3);
    expect(n.records[0].label).toBe('Plate reader (Atlanta Police Department)');
    expect(n.records[0].props.manufacturer).toBe('Flock Safety');
    expect(n.records[0].props.facingDeg).toBe(135);
    expect(n.records[1].props.facingDeg).toBe(315);
    // A direction the mapper wrote in words stays unknown rather than becoming a number.
    expect(n.records[2].props.facingDeg).toBeNull();
    expect(n.records[1].label).toBe('Plate reader');
    expect(String(n.records[0].props.mappedNote)).toMatch(/No plate reads/);
    expect(n.records.every((r) => r.heading === null && r.speedKts === null)).toBe(true);
  });
  it('refuses other cameras, areas and bad positions', () => {
    const n = normalizeAlprSites([
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { man_made: 'surveillance', 'surveillance:type': 'camera' } },
      { type: 'way', id: 2, center: { lat: 1, lon: 1 }, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } },
      { type: 'node', id: 3, lat: 1, lon: 200, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } },
      { type: 'node', id: 0, lat: 1, lon: 1, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } },
    ]);
    expect(n.records).toEqual([]);
    expect(n.skipped).toBe(4);
    expect(osmDirection('361')).toBeNull();
    expect(osmDirection('360')).toBe(0);
    expect(osmDirection('s')).toBe(180);
  });
});

describe('OpenStreetMap site layers (fetcher)', () => {
  afterEach(() => clearOsmSiteCache());
  const ctx = (fetchJson: FetchJson, view: FetchContext['view'], clock = NOW): FetchContext => ({
    view, settings: DEFAULT_SETTINGS, sources: { backoff: new Map(), cache: new Map() }, fetchJson,
    fetchText: async () => { throw new Error('not used'); }, userAgent: 'group4 test', store: null as never, localReceiverUrl: null,
    now: new Date(clock), clock: () => clock,
  });
  const atlanta = { lat: 33.749, lon: -84.388, heightM: 20_000, bbox: [-84.5, 33.6, -84.2, 33.9] as [number, number, number, number] };

  it('asks Overpass once per block, reuses the answer for a day, and says an empty area is a gap', async () => {
    let calls = 0;
    const fetchJson: FetchJson = async (url, opts) => {
      calls++;
      expect(url).toBe('https://overpass-api.de/api/interpreter');
      expect(() => assertAllowedUrl(url)).not.toThrow();
      expect(decodeURIComponent(String(opts?.body))).toContain('"surveillance:type"="ALPR"](33.6,-84.6,33.9,-84.3)');
      return { status: 200, body: { elements: [{ type: 'node', id: 9, lat: 33.75, lon: -84.39, tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' } }] } };
    };
    const first = await FETCHERS.alpr(ctx(fetchJson, atlanta));
    expect(first.records.length).toBe(1);
    expect(first.note).toMatch(/1 mapped plate-reader cameras in this area.*incomplete/);
    await FETCHERS.alpr(ctx(fetchJson, { ...atlanta, lat: 33.76 }));
    expect(calls).toBe(1);
    await FETCHERS.alpr(ctx(fetchJson, atlanta, NOW + 25 * 3600_000));
    expect(calls).toBe(2);
    clearOsmSiteCache();
    const empty = await FETCHERS.milSites(ctx(async () => ({ status: 200, body: { elements: [] } }), { ...atlanta, heightM: 300_000 }));
    expect(empty.records).toEqual([]);
    expect(empty.note).toMatch(/gap in the map, not proof/);
  });
  it('asks nothing when zoomed out and keeps a failure a failure', async () => {
    const never: FetchJson = async () => { throw new Error('must not be called'); };
    const high = await FETCHERS.alpr(ctx(never, { ...atlanta, heightM: 500_000 }));
    expect(high.records).toEqual([]);
    expect(high.note).toMatch(/Zoom in \(below about 80 km\)/);
    const busy: FetchJson = async () => { throw new FeedHttpError('HTTP 504', 504, null, 'http'); };
    await expect(FETCHERS.milSites(ctx(busy, { ...atlanta, heightM: 300_000 }))).rejects.toThrow(/busy or unreachable/);
  });
  it('describes both layers as community mapping with stated limits', () => {
    expect(LAYERS.alpr.temporalNote).toMatch(/no plate reads, images or video/);
    expect(LAYERS.milSites.temporalNote).toMatch(/Incomplete/);
    expect(LAYERS.alpr.viewport && LAYERS.milSites.viewport).toBe(true);
    expect(isAllowedExternalUrl(LAYERS.alpr.sourceUrl) && isAllowedExternalUrl(LAYERS.milSites.sourceUrl)).toBe(true);
  });
});

describe('tilt and global picture', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  it('switches between straight down and a 35° oblique', () => {
    expect(isTilted(deg(-90))).toBe(false);
    expect(isTilted(deg(-84))).toBe(false);
    expect(isTilted(deg(-55))).toBe(true);
    expect(isTilted(null)).toBe(false);
    expect(nextTiltPitch(deg(-90))).toBeCloseTo(deg(-55), 10);
    expect(TILT_OBLIQUE_RAD).toBeCloseTo(deg(-55), 10);
    expect(nextTiltPitch(deg(-30))).toBeCloseTo(deg(-90), 10);
  });
  it('adds only the worldwide layers that were off and takes only those away again', () => {
    const before = ['aircraft', 'satellites', 'cameras'];
    const entered = enterGlobalPicture(before);
    expect(entered.added).toEqual(GLOBAL_PICTURE_LAYERS.filter((l) => l !== 'satellites'));
    expect(entered.enabled.slice(0, 3)).toEqual(before);
    // While it was up the user turned cameras off and vessels on: both choices are kept.
    const during = [...entered.enabled.filter((l) => l !== 'cameras'), 'vessels'];
    expect(leaveGlobalPicture(during, entered.added)).toEqual(['aircraft', 'satellites', 'vessels']);
    expect(GLOBAL_PICTURE_LAYERS.every((id) => !LAYERS[id].viewport && /^None/.test(LAYERS[id].auth))).toBe(true);
    expect(ipcArgSchemas[IPC.settingsUpdate].safeParse([{ layersEnabled: entered.enabled }]).success).toBe(true);
  });
  it('reads a stored way back strictly', () => {
    const cam = { lat: 48.85, lon: 2.35, heightM: 3000, heading: 0.4, pitch: -0.9 };
    expect(parseGlobalPictureState(JSON.stringify({ added: ['launches', 'cyclones'], camera: cam }))).toEqual({ added: ['launches', 'cyclones'], camera: cam });
    expect(parseGlobalPictureState(JSON.stringify({ added: ['launches', 'aircraft', 7], camera: { ...cam, lat: 120 } }))).toEqual({ added: ['launches'], camera: null });
    expect(parseGlobalPictureState('{"added":"all"}')).toBeNull();
    expect(parseGlobalPictureState('not json')).toBeNull();
    expect(parseGlobalPictureState(null)).toBeNull();
  });
});

describe('launch event timeline (real Launch Library 2 records)', () => {
  const starship = fixture('launch-detail-starship.json') as { id: string };
  const none = fixture('launch-detail-no-timeline.json') as { id: string };
  it('reads ISO durations and refuses anything else', () => {
    expect(isoDurationSeconds('-PT35M33S')).toBe(-2133);
    expect(isoDurationSeconds('PT1H17M40S')).toBe(4660);
    expect(isoDurationSeconds('P0D')).toBe(0);
    expect(isoDurationSeconds('P1DT2H')).toBe(93_600);
    expect(isoDurationSeconds('PT')).toBeNull();
    expect(isoDurationSeconds('35 minutes')).toBeNull();
    expect(isoDurationSeconds(35)).toBeNull();
  });
  it('orders the published events around liftoff', () => {
    const t = normalizeLaunchTimeline(starship, starship.id, '2026-11-15T04:00:00.000Z');
    expect(t.events.length).toBe(38);
    expect(t.events[0]).toMatchObject({ tSec: -3000, name: 'GO for Prop Load' });
    expect(t.events.find((e) => e.name === 'Liftoff')!.tSec).toBe(0);
    expect(t.events.find((e) => e.name === 'Max-Q')!.tSec).toBe(58);
    expect(t.events.every((e, i) => i === 0 || e.tSec >= t.events[i - 1].tSec)).toBe(true);
    expect(t.net).toBe('2026-11-13T22:47:36.000Z');
    const range = replayRange(t.events)!;
    expect(range.start).toBe(-40); // 10 s before "GO for Launch" at T-30 s
    expect(range.end).toBe(t.events.at(-1)!.tSec);
    expect(eventIndexAt(t.events, -10_000)).toBe(-1);
    expect(t.events[eventIndexAt(t.events, 60)].name).toBe('Max-Q');
    expect(eventIndexAt(t.events, 1e9)).toBe(37);
  });
  it('treats a launch without a published timeline as "none published", and a wrong record as an error', () => {
    const t = normalizeLaunchTimeline(none, none.id, '2026-11-15T04:00:00.000Z');
    expect(t.events).toEqual([]);
    expect(replayRange(t.events)).toBeNull();
    expect(() => normalizeLaunchTimeline(starship, none.id, 'x')).toThrow(/different record/);
    const odd = normalizeLaunchTimeline({ id: none.id, timeline: [{ relative_time: 'P400D', type: { abbrev: 'Far' } }, { relative_time: 'PT5S', type: {} }, 7, { relative_time: 'PT5S', type: { abbrev: 'Ok' } }] }, none.id, 'x');
    expect(odd.events.map((e) => e.name)).toEqual(['Ok']);
  });
  it('formats the clock and builds only the fixed detail address', () => {
    expect(tClock(-2133)).toBe('T-00:35:33');
    expect(tClock(81_154)).toBe('T+22:32:34');
    expect(tClock(0)).toBe('T+00:00:00');
    const url = launchDetailUrl(starship.id);
    expect(url).toBe(`https://ll.thespacedevs.com/2.3.0/launches/${starship.id}/?mode=detailed`);
    expect(() => assertAllowedUrl(url)).not.toThrow();
    expect(() => launchDetailUrl('../previous')).toThrow();
  });
  it('asks once per launch, shares concurrent asks, and words the rate limit', async () => {
    let calls = 0;
    const lookup = createLaunchTimelineLookup(async (url) => { calls++; expect(url).toBe(launchDetailUrl(starship.id)); return { status: 200, body: starship }; }, () => 'test');
    const [a, b] = await Promise.all([lookup(starship.id), lookup(starship.id)]);
    expect(a.events.length).toBe(38);
    expect(b).toBe(a);
    await lookup(starship.id);
    expect(calls).toBe(1);
    const limited = createLaunchTimelineLookup(async () => { throw new FeedHttpError('HTTP 429', 429, 3600, 'http'); }, () => 'test');
    await expect(limited(starship.id)).rejects.toThrow(/15 requests an hour/);
    const gone = createLaunchTimelineLookup(async () => { throw new FeedHttpError('HTTP 404', 404, null, 'http'); }, () => 'test');
    await expect(gone(starship.id)).rejects.toThrow(/no longer lists/);
  });
});
