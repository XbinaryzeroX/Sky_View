// Group 5: floating camera cards, simulated-traffic tags, landslide estimates, rivers setting, new provider keys,
// voice commands (OpenAI transcription) and the worldwide radio directory with its relay guards.
import { describe, expect, it } from 'vitest';
import listFixture from './fixtures/usgs-ground-failure-list.json';
import detailFixture from './fixtures/usgs-ground-failure-us7000tymu.json';
import { CARD_H, CARD_MAX_DISTANCE_M, CARD_W, cameraTag, NEXT_FRAME_COOLDOWN_MS, placeCameraCards, TAG_MAX_DISTANCE_M } from '../src/shared/cameraCards';
import { SIM_STATE_COLOR, simRoad, simTag } from '../src/shared/trafficSim';
import { landslideRecord, landslideRecords, listedLandslideEvents, LANDSLIDE_DETAIL_URL, LANDSLIDE_LIST_URL } from '../src/shared/landslides';
import { parseVoiceCommand } from '../src/shared/voiceCommands';
import { transcriptionBody, createVoiceTranscriber, OPENAI_TRANSCRIBE_URL } from '../src/main/voice';
import { isAudioType, isPrivateAddress, mergeStations, normalizeStations, radioSearchUrls, stationKind, RADIO_API } from '../src/shared/radio';
import { createRadio } from '../src/main/radio';
import { buildCsp, isAllowedRendererUrl } from '../src/shared/remoteHosts';
import { assertAllowedUrl, FeedHttpError, type FetchJson } from '../src/main/feeds/http';
import { DEFAULT_SETTINGS, IPC, ipcArgSchemas } from '../src/shared/ipc';
import { PROVIDERS } from '../src/shared/providers';
import { FETCHERS, type FetchContext } from '../src/main/layers/fetchers';
import { LAYERS } from '../src/shared/layers';
import type { GeoRecord } from '../src/shared/layers';

describe('floating camera cards', () => {
  it('gives the cameras nearest the centre a card, never overlapping, and the rest tags', () => {
    const cams = Array.from({ length: 12 }, (_, i) => ({ id: `cam-${i}`, x: 400 + (i % 4) * 60, y: 300 + Math.floor(i / 4) * 50, hasImage: i !== 0, distM: 300 + i * 10 }));
    const { cards, tags } = placeCameraCards(cams, 1280, 800, 5);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
    expect(cards.some((c) => c.id === 'cam-0')).toBe(false); // no published image, no card
    for (const a of cards) {
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.left + CARD_W).toBeLessThanOrEqual(1280);
      expect(a.top + CARD_H).toBeLessThanOrEqual(800);
      for (const b of cards) if (a !== b) expect(a.left + CARD_W <= b.left || b.left + CARD_W <= a.left || a.top + CARD_H <= b.top || b.top + CARD_H <= a.top).toBe(true);
    }
    expect(tags.length + cards.length).toBe(12);
  });
  it('ignores off-screen cameras, keeps cards clear of reserved panels, and builds tags from ids only', () => {
    const { cards, tags } = placeCameraCards([{ id: 'a', x: -5, y: 10, hasImage: true, distM: 200 }, { id: 'b', x: 600, y: 400, hasImage: true, distM: 200 }], 1200, 800, 5, [{ left: 0, top: 0, right: 1200, bottom: 800 }]);
    // A camera under a panel gets neither a card nor a tag.
    expect(cards).toEqual([]);
    expect(tags).toEqual([]);
    // A panel covering only the card spots leaves the camera as a tag.
    const partial = placeCameraCards([{ id: 'b', x: 600, y: 400, hasImage: true, distM: 200 }], 1200, 800, 5, [{ left: 0, top: 0, right: 1200, bottom: 395 }, { left: 0, top: 405, right: 1200, bottom: 800 }]);
    expect(partial.cards).toEqual([]);
    expect(partial.tags.map((t) => t.id)).toEqual(['b']);
    expect(NEXT_FRAME_COOLDOWN_MS).toBe(3000);
    expect(CARD_MAX_DISTANCE_M).toBeLessThan(TAG_MAX_DISTANCE_M);
    expect(cameraTag('caltrans:D7-ABC-1427')).toBe('CAM-C1427');
    expect(cameraTag('')).toBe('CAM-?');
  });
  it('cards only street-close cameras, pins each directly above its point, and keeps the same cards while they still fit', () => {
    const near = { id: 'near', x: 600, y: 500, hasImage: true, distM: 400 };
    const far = { id: 'far', x: 300, y: 500, hasImage: true, distM: CARD_MAX_DISTANCE_M + 1 };
    const out = { id: 'out', x: 900, y: 500, hasImage: true, distM: TAG_MAX_DISTANCE_M + 1 };
    const r = placeCameraCards([near, far, out], 1200, 800);
    expect(r.cards.map((c) => c.id)).toEqual(['near']);
    expect(r.tags.map((t) => t.id)).toEqual(['far']); // beyond the tag distance nothing is drawn
    const card = r.cards[0];
    expect(card.left + CARD_W / 2).toBe(600); // centred over the camera
    expect(card.top + CARD_H).toBeLessThan(500); // above it, pin pointing down
    // A closer camera arriving does not take the card from one already shown (max 1 card here).
    const closer = { id: 'closer', x: 950, y: 500, hasImage: true, distM: 100 };
    expect(placeCameraCards([near, closer], 1200, 800, 1, [], new Set(['near'])).cards.map((c) => c.id)).toEqual(['near']);
    // No room above (near the top edge): no card, never a card moved to another side.
    expect(placeCameraCards([{ ...near, y: 120 }], 1200, 800).cards).toEqual([]);
  });
});

describe('simulated traffic look', () => {
  const road = (state: string): GeoRecord => ({ id: 'r1', lat: 40.7, lon: -74, altM: null, heading: null, speedKts: null, label: 'x', category: state, observedAt: null, sourceUrl: null, source: 's', props: { speedKmh: 20 }, geometry: { type: 'LineString', coordinates: [[-74, 40.7], [-74.01, 40.71]] } });
  it('colours dots by the published road state and tags them as simulated', () => {
    expect(simRoad(road('heavy'))?.state).toBe('heavy');
    expect(SIM_STATE_COLOR.stopped).toBe('#D55E00');
    expect(simTag(3, 7)).toMatch(/^SIM-\d{4}$/);
    expect(simTag(3, 7)).not.toMatch(/VEH/);
  });
});

describe('landslide estimates (USGS Ground Failure)', () => {
  it('lists real event ids and builds a labelled model estimate from a real detail reply', () => {
    const { events, skipped } = listedLandslideEvents(listFixture);
    expect(events.length).toBe(25);
    expect(skipped).toBe(0);
    const r = landslideRecord(detailFixture)!;
    expect(r.id).toBe('us7000tymu');
    expect(r.category).toBe('green');
    expect(r.label).toMatch(/^Landslide estimate · M6\.6/);
    expect(r.source).toMatch(/model estimate/);
    expect(String(r.props.mappedNote)).toMatch(/not a report of landslides/);
    expect(r.props.hazardAreaKm2).toBe(0);
    expect(r.sourceUrl).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us7000tymu/ground-failure/summary');
  });
  it('skips malformed or estimate-free replies and keeps the URLs on the allow-list', () => {
    expect(landslideRecord({ id: 'us7000tymu', geometry: { coordinates: [200, 0] }, properties: {} })).toBeNull();
    expect(landslideRecord({ id: '../x', geometry: { coordinates: [1, 1] }, properties: {} })).toBeNull();
    expect(landslideRecords([null, 'x', detailFixture]).records.length).toBe(1);
    expect(() => assertAllowedUrl(LANDSLIDE_LIST_URL('2026-10-17T00:00:00Z'))).not.toThrow();
    expect(() => assertAllowedUrl(LANDSLIDE_DETAIL_URL('us7000tymu'))).not.toThrow();
  });
  it('fetches the list, then only new or updated events, with no network beyond USGS', async () => {
    const urls: string[] = [];
    const fetchJson: FetchJson = async (url) => {
      urls.push(url);
      if (url.includes('producttype=ground-failure')) return { status: 200, body: listFixture };
      if (url.includes('eventid=us7000tymu')) return { status: 200, body: detailFixture };
      throw new FeedHttpError('missing', 404, null, 'http');
    };
    const ctx = { view: null, settings: DEFAULT_SETTINGS, fetchJson, fetchText: async () => { throw new Error('unused'); }, userAgent: 't', store: null as never, localReceiverUrl: null, now: new Date('2026-11-16T12:00:00Z'), clock: () => Date.parse('2026-11-16T12:00:00Z') } as FetchContext;
    const first = await FETCHERS.landslides(ctx);
    expect(first.records.map((r) => r.id)).toEqual(['us7000tymu']);
    expect(first.note).toMatch(/Model estimates, not observed landslides/);
    expect(first.note).toMatch(/could not be loaded/);
    const before = urls.length;
    await FETCHERS.landslides(ctx);
    expect(urls.length - before).toBe(1 + 24); // the loaded event is not asked for again; the failed ones are retried
    expect(LAYERS.landslides.temporal).toBe('calculated');
  });
});

describe('rivers and TomTom settings', () => {
  it('default off and validate strictly', () => {
    const schema = ipcArgSchemas[IPC.settingsUpdate];
    expect(DEFAULT_SETTINGS.riversEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.tomtomTraffic).toBe(false);
    expect(DEFAULT_SETTINGS.ionTerrain).toBe(false);
    expect(schema.safeParse([{ riversEnabled: true, tomtomTraffic: true, ionTerrain: true, basemap: 'ionBing' }]).success).toBe(true);
    expect(schema.safeParse([{ tomtomTraffic: 'yes' }]).success).toBe(false);
  });
});

describe('new provider keys', () => {
  it('are listed with their cost status, and their map hosts load only when a key is saved', () => {
    const byId = new Map(PROVIDERS.map((p) => [p.id, p]));
    expect(byId.get('tomtom')?.status).toBe('metered');
    expect(byId.get('openai')?.credential?.kind).toBe('secret');
    expect(byId.get('launchlibrary')?.credential?.kind).toBe('secret');
    expect(byId.get('cesium-ion')?.status).toBe('restricted');
    const tile = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative0/5/1/2.png?key=k';
    expect(isAllowedRendererUrl(tile, { google3d: false })).toBe(false);
    expect(isAllowedRendererUrl(tile, { google3d: false, tomtom: true })).toBe(true);
    expect(isAllowedRendererUrl('https://api.tomtom.com/search/2/geocode/x.json', { google3d: false, tomtom: true })).toBe(false);
    expect(isAllowedRendererUrl('https://assets.ion.cesium.com/1/layer.json', { google3d: false })).toBe(false);
    expect(isAllowedRendererUrl('https://assets.ion.cesium.com/1/layer.json', { google3d: false, cesium: true })).toBe(true);
    expect(isAllowedRendererUrl('https://ecn.t2.tiles.virtualearth.net/tiles/a0.jpeg', { google3d: false, cesium: true })).toBe(true);
    expect(isAllowedRendererUrl('https://api.openai.com/v1/models', { google3d: false, tomtom: true, cesium: true })).toBe(false);
  });
  it('lets the main process reach only the exact OpenAI, TomTom and Cesium paths it needs', () => {
    expect(() => assertAllowedUrl(OPENAI_TRANSCRIBE_URL)).not.toThrow();
    expect(() => assertAllowedUrl('https://api.openai.com/v1/models')).not.toThrow();
    expect(() => assertAllowedUrl('https://api.openai.com/v1/chat/completions')).toThrow();
    expect(() => assertAllowedUrl('https://api.cesium.com/v1/me')).not.toThrow();
    expect(() => assertAllowedUrl('https://api.cesium.com/v1/assets/1/endpoint')).toThrow();
  });
});

describe('voice commands', () => {
  it('turns spoken sentences into fixed actions and nothing else', () => {
    expect(parseVoiceCommand('Show me the aircraft.')).toEqual({ kind: 'layer', layer: 'aircraft', on: true });
    expect(parseVoiceCommand('turn off ships')).toEqual({ kind: 'layer', layer: 'vessels', on: false });
    expect(parseVoiceCommand('Show military aircraft')).toEqual({ kind: 'layer', layer: 'aircraftMil', on: true });
    expect(parseVoiceCommand('Go to Paris')).toEqual({ kind: 'go', place: 'paris' });
    expect(parseVoiceCommand('Take me to the Golden Gate Bridge')).toEqual({ kind: 'go', place: 'golden gate bridge' });
    expect(parseVoiceCommand('switch to photorealistic')).toEqual({ kind: 'surface', basemap: 'google3d' });
    expect(parseVoiceCommand('delete all my files')).toEqual({ kind: 'unknown', heard: 'delete all my files' });
    expect(parseVoiceCommand('')).toEqual({ kind: 'unknown', heard: '' });
  });
  it('sends one multipart file to OpenAI and never puts the key in an error', async () => {
    const body = new TextDecoder().decode(transcriptionBody(new Uint8Array([1, 2, 3]), 'audio/webm', 'B'));
    expect(body).toContain('name="model"\r\n\r\nwhisper-1');
    expect(body).toContain('filename="command.webm"\r\nContent-Type: audio/webm');
    expect(body.endsWith('--B--\r\n')).toBe(true);
    let sent: Parameters<FetchJson>[1];
    const ok = createVoiceTranscriber(async (url, opts) => { expect(url).toBe(OPENAI_TRANSCRIBE_URL); sent = opts; return { status: 200, body: { text: ' go to Oslo\u0007 ' } }; }, () => 'sk-secret', () => 'ua');
    expect(await ok(new Uint8Array(500), 'audio/webm')).toEqual({ text: 'go to Oslo' });
    expect(sent!.headers!.Authorization).toBe('Bearer sk-secret');
    expect(sent!.bytes).toBeInstanceOf(Uint8Array);
    const bad = createVoiceTranscriber(async () => { throw new FeedHttpError('HTTP 401 sk-secret', 401, null, 'http'); }, () => 'sk-secret', () => 'ua');
    await expect(bad(new Uint8Array(500), 'audio/webm')).rejects.toThrow(/rejected the key/);
    await bad(new Uint8Array(500), 'audio/webm').catch((e: Error) => expect(e.message).not.toContain('sk-secret'));
    await expect(createVoiceTranscriber(async () => ({ status: 200, body: {} }), () => null, () => 'ua')(new Uint8Array(500), 'audio/webm')).rejects.toThrow(/Add your OpenAI API key/);
    await expect(ok(new Uint8Array(10), 'audio/webm')).rejects.toThrow(/too short/);
  });
});

describe('worldwide radio', () => {
  const row = (over: Record<string, unknown> = {}) => ({ stationuuid: '9617a958-0601-11e8-ae97-52543be04c81', name: 'BBC World Service', url_resolved: 'https://stream.example.org/live.mp3', tags: 'news,talk', country: 'United Kingdom', countrycode: 'GB', codec: 'MP3', bitrate: 128, hls: 0, geo_lat: 51.5, geo_long: -0.12, geo_distance: 1234.5, homepage: 'https://www.bbc.co.uk/', ...over });
  it('builds fixed directory URLs only', () => {
    const urls = radioSearchUrls({ query: 'jazz & more', kind: 'scanner', country: 'US', near: { lat: 40.7, lon: -74 } });
    expect(urls.length).toBe(4);
    for (const u of urls) {
      expect(u.startsWith(`${RADIO_API}/json/stations/search?`)).toBe(true);
      expect(() => assertAllowedUrl(u)).not.toThrow();
      expect(u).toContain('countrycode=US');
      expect(u).toContain('geo_distance=250000');
    }
    expect(radioSearchUrls({ query: '', kind: 'all', country: 'usa' as never, near: { lat: 99, lon: 0 } })[0]).not.toMatch(/countrycode|geo_lat/);
  });
  it('keeps audio stations, drops video, HLS, bad ids and odd URLs, and labels relays', () => {
    const n = normalizeStations([row(), row({ stationuuid: 'x' }), row({ stationuuid: 'aaaaaaaa-0601-11e8-ae97-52543be04c81', hls: 1 }), row({ stationuuid: 'bbbbbbbb-0601-11e8-ae97-52543be04c81', name: 'News TV (720p)' }),
      row({ stationuuid: 'cccccccc-0601-11e8-ae97-52543be04c81', url_resolved: 'ftp://x/' }), row({ stationuuid: 'dddddddd-0601-11e8-ae97-52543be04c81', url_resolved: 'http://user:pw@x/' }),
      row({ stationuuid: 'eeeeeeee-0601-11e8-ae97-52543be04c81', name: 'County Fire Dispatch', tags: 'fire scanner' })]);
    expect(n.stations.map((s) => s.kind)).toEqual(['broadcast', 'scanner']);
    expect(n.skipped).toBe(5);
    expect(n.stations[0].distanceKm).toBe(1.2);
    expect(stationKind('KJFK Tower', ['atc'])).toBe('atc');
    expect(stationKind('Exclusively The Police', ['the police'])).toBe('broadcast');
    expect(mergeStations([n.stations, n.stations], 'scanner').map((s) => s.name)).toEqual(['County Fire Dispatch']);
  });
  it('refuses private addresses and non-audio replies, and plays only stations a search returned', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.1', '2001:4860::8888']) expect(isPrivateAddress(ip)).toBe(false);
    expect(isAudioType('audio/mpeg')).toBe(true);
    expect(isAudioType('audio/aacp; charset=x')).toBe(true);
    expect(isAudioType('application/ogg')).toBe(true);
    expect(isAudioType('audio/x-mpegurl')).toBe(false);
    expect(isAudioType('text/html')).toBe(false);
    expect(isAudioType('video/mp4')).toBe(false);
    const r = createRadio(async () => { throw new Error('no network in tests'); }, () => 'ua');
    expect((await r.relay('9617a958-0601-11e8-ae97-52543be04c81', null)).status).toBe(404);
    expect((await r.relay('../../etc/passwd', null)).status).toBe(404);
    await expect(r.search({ query: '', kind: 'all', country: null, near: null })).rejects.toThrow(/could not be reached/);
  });
  it('serves the relay from the app origin in the page policy', () => {
    expect(buildCsp({ google3d: false })).toContain("media-src 'self' blob: app://atlas/radio-stream/");
  });
});
