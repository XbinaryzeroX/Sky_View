import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KEYED_CAMERA_IDS,
  KEYED_CAMERA_SYSTEMS,
  keyedCameraImagePrefixes,
  keyedCameraRequest,
  keyedCameraSystem,
  normalize511Cameras,
  normalizeKeyedCameras,
  normalizeTfnswCameras,
  normalizeTrafikverketCameras,
  normalizeWsdotCameras,
} from '../src/shared/keyedCameras';
import { CAMERA_KEY_PROVIDER_IDS, PROVIDERS } from '../src/shared/providers';
import { isAllowedRendererUrl } from '../src/shared/remoteHosts';
import { isAllowedExternalUrl } from '../src/shared/sanitize';
import { ALLOWED_HOSTS, FeedHttpError, fetchJson as realFetchJson, type FetchJson, type FetchJsonOptions, type FetchText } from '../src/main/feeds/http';
import { FETCHERS, type SourceState } from '../src/main/layers/fetchers';
import { LayerManager } from '../src/main/layers/manager';
import { ProviderService } from '../src/main/providerService';
import { SecretStore, type Cipher } from '../src/main/secrets';
import { AtlasStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/ipc';
import { tempDbPath } from './helpers';
import { IPC, validateIpcArgs } from '../src/shared/ipc';

const sys = (id: string) => keyedCameraSystem(id)!;
const allowedImage = (u: string) => isAllowedRendererUrl(u, { google3d: false });

describe('keyed camera systems: catalog and allow-lists', () => {
  it('has one provider entry per system, on its own tab, accepted by IPC validation', () => {
    expect(KEYED_CAMERA_SYSTEMS.map((s) => s.id)).toEqual([...KEYED_CAMERA_IDS]);
    for (const s of KEYED_CAMERA_SYSTEMS) {
      const p = PROVIDERS.find((x) => x.id === s.id)!;
      expect(p, s.id).toBeTruthy();
      expect(p.credential?.kind).toBe('secret');
      expect(p.status).toBe('free-key');
      expect(CAMERA_KEY_PROVIDER_IDS.has(s.id)).toBe(true);
      expect(() => validateIpcArgs(IPC.providersSetCredential, [s.id, 'abcdef1234567890'])).not.toThrow();
      // Docs and sign-up pages open in the browser; API hosts are reachable from the main process.
      expect(isAllowedExternalUrl(s.docsUrl), s.docsUrl).toBe(true);
      expect(isAllowedExternalUrl(s.signupUrl), s.signupUrl).toBe(true);
      expect(ALLOWED_HOSTS.has(new URL(s.origin).hostname), s.origin).toBe(true);
    }
    expect(() => validateIpcArgs(IPC.providersSetCredential, ['cam-xx', 'abcdef1234567890'])).toThrow();
    for (const prefix of keyedCameraImagePrefixes()) expect(allowedImage(`${prefix}123.jpg`), prefix).toBe(true);
  });

  it('sends each key only to its own system, in the documented place', () => {
    const k = 'k3y/+&"<x>';
    const on = keyedCameraRequest(sys('cam-on'), k);
    expect(on.url).toBe(`https://511on.ca/api/v2/get/cameras?key=${encodeURIComponent(k)}&format=json`);
    expect(on.method).toBe('GET');
    const wa = keyedCameraRequest(sys('cam-wsdot'), k);
    expect(wa.url.startsWith('https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=')).toBe(true);
    expect(wa.url.endsWith(encodeURIComponent(k))).toBe(true);
    const nsw = keyedCameraRequest(sys('cam-nsw'), k);
    expect(nsw.url).toBe('https://api.transport.nsw.gov.au/v1/live/cameras');
    expect(nsw.headers.Authorization).toBe(`apikey ${k}`);
    const se = keyedCameraRequest(sys('cam-se'), k);
    expect(se.method).toBe('POST');
    expect(se.url).toBe('https://api.trafikinfo.trafikverket.se/v2/data.json');
    // The key is XML-escaped inside the query (it cannot break out of the attribute).
    expect(se.body).toContain('authenticationkey="k3y/+&amp;&quot;&lt;x&gt;"');
    expect(se.body).toContain('objecttype="Camera"');
    for (const s of KEYED_CAMERA_SYSTEMS) expect(new URL(keyedCameraRequest(s, k).url).origin).toBe(s.origin);
  });
});

describe('511 platform cameras', () => {
  const body = [
    {
      Id: 455, Source: 'MTO', SourceId: '1', Roadway: 'Highway 407', Direction: 'Eastbound', Latitude: 43.6, Longitude: -79.9, Location: 'Highway 407 East of Bethesda', SortOrder: 0,
      Views: [
        { Id: 815, Url: 'https://511on.ca/map/Cctv/815', Status: 'Enabled', Description: 'Looking East' },
        { Id: 816, Url: 'https://511on.ca/map/Cctv/816', Status: 'Disabled', Description: 'Looking West' },
      ],
    },
    { Id: 456, Roadway: 'X', Latitude: 43.7, Longitude: -79.8, Location: 'Elsewhere', Views: [{ Id: 900, Url: 'https://evil.example.com/map/Cctv/900', Status: 'Enabled' }] },
    { Id: 457, Latitude: null, Longitude: -79.8, Location: 'No position', Views: [{ Id: 901, Url: 'https://511on.ca/map/Cctv/901', Status: 'Enabled' }] },
    { Id: 458, Latitude: 43.8, Longitude: -79.7, Location: 'Wrong view id', Views: [{ Id: 902, Url: 'https://511on.ca/map/Cctv/903', Status: 'Enabled' }] },
    null,
  ];
  it('keeps enabled views whose still is on the system’s own host', () => {
    const n = normalize511Cameras(body, sys('cam-on'));
    expect(n.records).toHaveLength(1);
    expect(n.skipped).toBe(4);
    const c = n.records[0];
    expect(c.id).toBe('cam-on-815');
    expect(c.imageUrl).toBe('https://511on.ca/map/Cctv/815');
    expect(allowedImage(c.imageUrl!)).toBe(true);
    expect(c.label).toBe('Highway 407 East of Bethesda (Looking East)');
    expect(c.source).toBe('Ontario 511');
    // Another system's host is not accepted for Ontario.
    expect(normalize511Cameras([{ ...body[0], Views: [{ Id: 815, Url: 'https://511ga.org/map/Cctv/815', Status: 'Enabled' }] }], sys('cam-on')).records).toHaveLength(0);
    expect(() => normalize511Cameras({ Message: 'Invalid Key' }, sys('cam-on'))).toThrow();
  });
});

describe('WSDOT cameras', () => {
  const body = [
    { CameraID: 9002, CameraLocation: { Description: null, Direction: 'N', Latitude: 47.66, Longitude: -122.32, MilePost: 169, RoadName: 'I-5' }, DisplayLatitude: 47.66, DisplayLongitude: -122.32, ImageURL: 'http://images.wsdot.wa.gov/nw/005vc16900.jpg', IsActive: true, Region: 'NW', Title: 'I-5 at NE 45th St' },
    { CameraID: 9003, CameraLocation: { Latitude: 47.6, Longitude: -122.3 }, ImageURL: 'https://images.wsdot.wa.gov/nw/x.jpg', IsActive: false, Title: 'Inactive' },
    { CameraID: 9004, CameraLocation: { Latitude: 47.6, Longitude: -122.3 }, ImageURL: 'https://evil.example.com/x.jpg', IsActive: true, Title: 'Elsewhere' },
    'junk',
  ];
  it('keeps active cameras with stills on images.wsdot.wa.gov (http upgraded to https)', () => {
    const n = normalizeWsdotCameras(body, sys('cam-wsdot'));
    expect(n.records.map((r) => r.imageUrl)).toEqual(['https://images.wsdot.wa.gov/nw/005vc16900.jpg']);
    expect(n.skipped).toBe(3);
    expect(allowedImage(n.records[0].imageUrl!)).toBe(true);
    expect(n.records[0].label).toBe('I-5 at NE 45th St');
  });
});

describe('Transport for NSW cameras', () => {
  const body = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'cam1', geometry: { type: 'Point', coordinates: [151.21, -33.86] }, properties: { region: 'SYD_MET', title: 'Sydney Harbour Bridge', view: 'Looking north', direction: 'N', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/harbour_bridge_sydney.jpeg' } },
      { type: 'Feature', id: 'cam2', geometry: { type: 'Point', coordinates: [151.2, -33.8] }, properties: { title: 'Elsewhere', href: 'https://evil.example.com/livetraffic-webcams/cameras/x.jpeg' } },
      { type: 'Feature', id: 'cam3', geometry: { type: 'Point', coordinates: [151.2, null] }, properties: { title: 'No position', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/y.jpeg' } },
      null,
    ],
  };
  it('keeps cameras with stills on webcams.transport.nsw.gov.au', () => {
    const n = normalizeTfnswCameras(body, sys('cam-nsw'));
    expect(n.records).toHaveLength(1);
    expect(n.skipped).toBe(3);
    expect(n.records[0].id).toBe('cam-nsw-cam1');
    expect(allowedImage(n.records[0].imageUrl!)).toBe(true);
    expect(n.records[0].lat).toBeLessThan(0);
  });
});

describe('Trafikverket cameras', () => {
  const body = {
    RESPONSE: {
      RESULT: [
        {
          Camera: [
            { Id: 'SE_STA_CAMERA_39635434', Name: 'E4 Södertälje', Geometry: { WGS84: 'POINT (17.62 59.19)' }, PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/RoadConditionCamera_39635434.Jpeg', HasFullSizePhoto: true, Active: true },
            { Id: 'B', Name: 'Elsewhere', Geometry: { WGS84: 'POINT (18 59)' }, PhotoUrl: 'https://evil.example.com/v2/Images/x.jpg', Active: true },
            { Id: 'C', Name: 'Bad geometry', Geometry: { WGS84: 'LINESTRING (1 2, 3 4)' }, PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/c.jpg', Active: true },
            { Id: 'D', Name: 'Inactive', Geometry: { WGS84: 'POINT (18 59)' }, PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/d.jpg', Active: false },
          ],
        },
      ],
    },
  };
  it('parses WKT points and keeps active cameras with stills under /v2/Images/ (full size when available)', () => {
    const n = normalizeTrafikverketCameras(body, sys('cam-se'));
    expect(n.records).toHaveLength(1);
    expect(n.skipped).toBe(3);
    const c = n.records[0];
    expect(c.lat).toBeCloseTo(59.19);
    expect(c.lon).toBeCloseTo(17.62);
    expect(c.imageUrl).toBe('https://api.trafikinfo.trafikverket.se/v2/Images/RoadConditionCamera_39635434.Jpeg?type=fullsize');
    expect(allowedImage(c.imageUrl!)).toBe(true);
    expect(() => normalizeTrafikverketCameras({ RESPONSE: { RESULT: [{ ERROR: { MESSAGE: 'Invalid authentication' } }] } }, sys('cam-se'))).toThrow();
  });
  it('dispatches by system kind', () => {
    expect(normalizeKeyedCameras(sys('cam-se'), body).records).toHaveLength(1);
  });
});

describe('keyed camera credentials never leave their own origin', () => {
  afterEach(() => vi.unstubAllGlobals());
  const k = 'secretkey1234567890';

  it('refuses a redirect to another allow-listed host for URL, header and XML-body keys', async () => {
    for (const id of ['cam-on', 'cam-nsw', 'cam-se', 'cam-wsdot']) {
      const req = keyedCameraRequest(sys(id), k);
      const calls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
        calls.push(String(url));
        return new Response(null, { status: 302, headers: { location: 'https://api.tfl.gov.uk/Place/Type/JamCam' } });
      }));
      await expect(realFetchJson(req.url, { method: req.method, body: req.body, headers: req.headers, sameOrigin: true })).rejects.toMatchObject({ kind: 'blocked' });
      // Only the system's own origin was contacted; the key never went to the redirect target.
      expect(calls.map((c) => new URL(c).origin), id).toEqual([sys(id).origin]);
    }
  });

  it('the camera layer and the provider test both ask for same-origin redirects only', async () => {
    const seen: FetchJsonOptions[] = [];
    const fetchJson: FetchJson = async (url, opts) => {
      if (!url.startsWith('https://api.transport.nsw.gov.au/')) throw new FeedHttpError('Network error', null, null, 'network');
      seen.push(opts ?? {});
      return { status: 200, body: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [151.2, -33.8] }, properties: { title: 'A', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/a.jpeg' } }] } };
    };
    const fetchText: FetchText = async () => {
      throw new FeedHttpError('Network error', null, null, 'network');
    };
    const s = { ...DEFAULT_SETTINGS, layersEnabled: ['cameras' as const] };
    const lm = new LayerManager({ store: new AtlasStore(tempDbPath()), fetchJson, fetchText, getSettings: () => s, userAgent: () => 'test', localReceiverUrl: () => null, cameraKey: (id) => (id === 'cam-nsw' ? k : null), ais: null, aisConfigured: () => false, emit: () => {} });
    await lm.refresh('cameras');
    expect(lm.snapshot('cameras').records.map((r) => r.id)).toEqual(['cam-nsw-a']);

    const cipher: Cipher = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (b) => b.toString() };
    const store = new AtlasStore(tempDbPath());
    const secrets = new SecretStore(store, cipher);
    secrets.set('cam-nsw', k);
    const providers = new ProviderService(store, secrets, fetchJson, fetchText, () => 'test', async () => ({ ok: true, message: '' }));
    expect((await providers.test('cam-nsw')).ok).toBe(true);
    expect(seen).toHaveLength(2);
    for (const o of seen) {
      expect(o.sameOrigin).toBe(true);
      expect(o.headers?.Authorization).toBe(`apikey ${k}`);
    }
  });
});

describe('saving a camera key while the camera layer is refreshing', () => {
  const OLD = 'oldkey1234567890';
  const NEW = 'newkey1234567890';
  const nswBody = (id: string) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', id, geometry: { type: 'Point', coordinates: [151.2, -33.8] }, properties: { title: id, href: `https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/${id}.jpeg` } }] });

  function setup(enabled = true) {
    let key: string | null = OLD;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const keysSent: string[] = [];
    const fetchJson: FetchJson = async (url, opts) => {
      if (!url.startsWith('https://api.transport.nsw.gov.au/')) throw new FeedHttpError('Network error', null, null, 'network');
      const sent = String(opts?.headers?.Authorization).replace('apikey ', '');
      keysSent.push(sent);
      if (sent === OLD) await gate;
      return { status: 200, body: nswBody(sent === OLD ? 'old' : 'new') };
    };
    const fetchText: FetchText = async () => {
      throw new FeedHttpError('Network error', null, null, 'network');
    };
    const s = { ...DEFAULT_SETTINGS, layersEnabled: enabled ? ['cameras' as const] : [] };
    const published: string[] = [];
    const lm: LayerManager = new LayerManager({
      store: new AtlasStore(tempDbPath()),
      fetchJson,
      fetchText,
      getSettings: () => s,
      userAgent: () => 'test',
      localReceiverUrl: () => null,
      cameraKey: (id) => (id === 'cam-nsw' ? key : null),
      ais: null,
      aisConfigured: () => false,
      emit: (id) => {
        if (id === 'cameras') published.push(...lm.snapshot('cameras').records.map((r) => r.id));
      },
    });
    return { lm, keysSent, published, release, setKey: (v: string | null) => (key = v) };
  }

  it('discards the refresh that used the old key and runs one more with the new key', async () => {
    const t = setup();
    const first = t.lm.refresh('cameras');
    await vi.waitFor(() => expect(t.keysSent).toEqual([OLD]));
    t.setKey(NEW);
    t.lm.credentialsChanged('cameras');
    t.lm.credentialsChanged('cameras'); // A second save during the same refresh still queues only one more.
    t.release();
    await first;
    await vi.waitFor(() => expect(t.lm.snapshot('cameras').records.map((r) => r.id)).toEqual(['cam-nsw-new']));
    expect(t.keysSent).toEqual([OLD, NEW]);
    // The old key's cameras were never published, not even briefly.
    expect(t.published).not.toContain('cam-nsw-old');
    expect(t.lm.snapshot('cameras').status.state).toBe('ok');
  });

  it('starts a refresh at once when none is underway, and does nothing for a disabled layer', async () => {
    const t = setup();
    t.setKey(NEW);
    t.lm.credentialsChanged('cameras');
    await vi.waitFor(() => expect(t.lm.snapshot('cameras').records.map((r) => r.id)).toEqual(['cam-nsw-new']));
    const off = setup(false);
    off.setKey(NEW);
    off.lm.credentialsChanged('cameras');
    await new Promise((r) => setTimeout(r, 20));
    expect(off.keysSent).toEqual([]);
  });
});

describe('camera catalogs: per-host rate limits and kept catalogs', () => {
  const NSW = 'https://api.transport.nsw.gov.au/';
  const SE = 'https://api.trafikinfo.trafikverket.se/';
  const nswOk = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [151.2, -33.8] }, properties: { title: 'A', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/a.jpeg' } }] };
  const seOk = { RESPONSE: { RESULT: [{ Camera: [{ Id: 'S1', Name: 'E4', Geometry: { WGS84: 'POINT (17.62 59.19)' }, PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/s1.Jpeg', Active: true }] }] } };

  function harness() {
    const mode = { nsw: 'ok' as 'ok' | 'rejected', se: 'limited' as 'ok' | 'limited' };
    const keys: Record<string, string> = { 'cam-nsw': 'nswkey1234567890', 'cam-se': 'sekey12345678901' };
    const hits: Record<string, number> = {};
    const fetchJson: FetchJson = async (url) => {
      const origin = new URL(url).origin;
      hits[origin] = (hits[origin] ?? 0) + 1;
      if (url.startsWith(NSW)) {
        if (mode.nsw === 'rejected') throw new FeedHttpError('HTTP 401', 401, null, 'http');
        return { status: 200, body: nswOk };
      }
      if (url.startsWith(SE)) {
        if (mode.se === 'limited') throw new FeedHttpError('HTTP 429', 429, 120, 'http');
        return { status: 200, body: seOk };
      }
      throw new FeedHttpError('Network error', null, null, 'network');
    };
    const fetchText: FetchText = async () => {
      throw new FeedHttpError('Network error', null, null, 'network');
    };
    const state: SourceState = { backoff: new Map(), cache: new Map() };
    const run = (at: number) =>
      FETCHERS.cameras({ view: null, settings: DEFAULT_SETTINGS, fetchJson, fetchText, userAgent: 'test', store: null as never, localReceiverUrl: null, cameraKey: (id) => keys[id] ?? null, sources: state, now: new Date(at), clock: () => at });
    return { mode, keys, hits, state, run };
  }
  const T = Date.parse('2026-11-11T12:00:00Z');
  const POLL = 21600 * 1000;
  const ids = (r: { records: { id: string }[] }) => r.records.map((x) => x.id).sort();

  it('waits out a rate limit per host, whatever starts the refresh, and refreshes again when it ends', async () => {
    const h = harness();
    const r1 = await h.run(T);
    expect(ids(r1)).toEqual(['cam-nsw-a']);
    expect(r1.note).toContain('Trafikverket road cameras (Sweden) (rate limited)');
    expect(r1.refreshAt).toBe(T + 120_000); // Retry-After: 120
    expect(h.hits['https://api.trafikinfo.trafikverket.se']).toBe(1);
    // A refresh 30 s later (e.g. a key was saved): no request to the limited host, none for the fresh NSW catalog.
    const r2 = await h.run(T + 30_000);
    expect(ids(r2)).toEqual(['cam-nsw-a']);
    expect(h.hits['https://api.trafikinfo.trafikverket.se']).toBe(1);
    expect(h.hits['https://api.transport.nsw.gov.au']).toBe(1);
    // Once the limit has passed, only the due source is fetched.
    h.mode.se = 'ok';
    const r3 = await h.run(T + 121_000);
    expect(ids(r3)).toEqual(['cam-nsw-a', 'cam-se-S1']);
    expect(h.hits['https://api.trafikinfo.trafikverket.se']).toBe(2);
    expect(h.hits['https://api.transport.nsw.gov.au']).toBe(1);
    expect(h.state.backoff.size).toBe(0);
    expect(r3.refreshAt).toBe(T + POLL - 600_000); // the NSW catalog falls due first (10 min early, so catalogs fetched together fall due together)
  });

  it('shows the last catalog (with a note) while its host is rate limited; never after the key is rejected', async () => {
    const h = harness();
    h.mode.se = 'ok';
    await h.run(T);
    h.mode.se = 'limited';
    const later = await h.run(T + POLL);
    expect(ids(later)).toEqual(['cam-nsw-a', 'cam-se-S1']);
    expect(later.note).toContain('Trafikverket road cameras (Sweden) (rate limited; last catalog shown)');
    expect(h.hits['https://api.transport.nsw.gov.au']).toBe(2); // NSW was due again
    // A rejected key drops that key's catalog at once.
    h.mode.nsw = 'rejected';
    const rejected = await h.run(T + 2 * POLL);
    expect(ids(rejected)).toEqual(['cam-se-S1']);
    expect(rejected.note).toContain('Transport for NSW Live Traffic Cameras (Australia) (key rejected)');
  });

  it('fetches a replaced key at once and forgets catalogs of removed or replaced keys', async () => {
    const h = harness();
    h.mode.se = 'ok';
    await h.run(T);
    expect(h.state.cache.size).toBe(2);
    h.keys['cam-nsw'] = 'otherkey12345678';
    await h.run(T + 1000);
    expect(h.hits['https://api.transport.nsw.gov.au']).toBe(2);
    expect(h.state.cache.size).toBe(2); // the old key's catalog is gone
    delete h.keys['cam-se'];
    const r = await h.run(T + 2000);
    expect(ids(r)).toEqual(['cam-nsw-a']);
    expect(h.state.cache.size).toBe(1);
  });

  it('the layer manager schedules the next refresh for when the rate limit ends', async () => {
    const h = harness();
    const s = { ...DEFAULT_SETTINGS, layersEnabled: ['cameras' as const] };
    const fetchJson: FetchJson = async (url) => {
      if (url.startsWith(NSW)) return { status: 200, body: nswOk };
      if (url.startsWith(SE)) throw new FeedHttpError('HTTP 429', 429, 120, 'http');
      throw new FeedHttpError('Network error', null, null, 'network');
    };
    const lm = new LayerManager({
      store: new AtlasStore(tempDbPath()), fetchJson, fetchText: async () => ({ status: 200, text: '' }), getSettings: () => s, userAgent: () => 'test', localReceiverUrl: () => null,
      cameraKey: (id) => h.keys[id] ?? null, ais: null, aisConfigured: () => false, emit: () => {}, now: () => new Date(T),
    });
    lm.start();
    await vi.waitFor(() => expect(lm.snapshot('cameras').status.state).toBe('ok'));
    expect(lm.snapshot('cameras').status.nextAttemptAt).toBe(new Date(T + 120_000).toISOString());
    lm.stop();
  });
});

describe('camera catalogs: timing and what is published when nothing usable comes back', () => {
  const NSW = 'https://api.transport.nsw.gov.au/';
  const SE = 'https://api.trafikinfo.trafikverket.se/';
  const CALTRANS = 'https://cwwp2.dot.ca.gov/';
  const nswOk = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [151.2, -33.8] }, properties: { title: 'A', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/a.jpeg' } }] };
  const T = Date.parse('2026-11-11T12:00:00Z');
  const H = 3600_000;
  const down = () => new FeedHttpError('Network error', null, null, 'network');
  const fetchText: FetchText = async () => {
    throw down();
  };

  it('measures a rate limit from the answer, after slow earlier requests', async () => {
    let t = T;
    const fetchJson: FetchJson = async (url) => {
      if (url.startsWith(CALTRANS)) {
        t += 15_000; // 12 districts: 3 minutes before the keyed systems are reached
        throw down();
      }
      if (url.startsWith(NSW)) return { status: 200, body: nswOk };
      if (url.startsWith(SE)) throw new FeedHttpError('HTTP 429', 429, 120, 'http');
      throw down();
    };
    const state: SourceState = { backoff: new Map(), cache: new Map() };
    const keys: Record<string, string> = { 'cam-nsw': 'nswkey1234567890', 'cam-se': 'sekey12345678901' };
    const r = await FETCHERS.cameras({ view: null, settings: DEFAULT_SETTINGS, fetchJson, fetchText, userAgent: 'test', store: null as never, localReceiverUrl: null, cameraKey: (id) => keys[id] ?? null, sources: state, now: new Date(T), clock: () => t });
    expect(t).toBe(T + 180_000);
    expect(state.backoff.get('api.trafikinfo.trafikverket.se')?.until).toBe(T + 180_000 + 120_000);
    expect(r.refreshAt).toBe(T + 300_000);
    // The catalog's age is counted from when it arrived.
    expect([...state.cache.values()][0].at).toBe(T + 180_000);
  });

  function managerHarness() {
    let clock = T;
    const mode = { nsw: 'ok' as 'ok' | 'down' | 'rejected' };
    const keys: Record<string, string> = { 'cam-nsw': 'nswkey1234567890' };
    const fetchJson: FetchJson = async (url) => {
      if (!url.startsWith(NSW)) throw down();
      if (mode.nsw === 'down') throw down();
      if (mode.nsw === 'rejected') throw new FeedHttpError('HTTP 401', 401, null, 'http');
      return { status: 200, body: nswOk };
    };
    const s = { ...DEFAULT_SETTINGS, layersEnabled: ['cameras' as const] };
    const lm = new LayerManager({
      store: new AtlasStore(tempDbPath()), fetchJson, fetchText, getSettings: () => s, userAgent: () => 'test', localReceiverUrl: () => null,
      cameraKey: (id) => keys[id] ?? null, ais: null, aisConfigured: () => false, emit: () => {}, now: () => new Date(clock),
    });
    const ids = () => lm.snapshot('cameras').records.map((r) => r.id);
    return { lm, mode, keys, ids, at: (ms: number) => (clock = T + ms), status: () => lm.snapshot('cameras').status };
  }

  it('keeps a failing catalog for at most a day, then removes it even when no source is usable', async () => {
    const h = managerHarness();
    await h.lm.refresh('cameras');
    expect(h.ids()).toEqual(['cam-nsw-a']);
    h.mode.nsw = 'down';
    h.at(7 * H);
    await h.lm.refresh('cameras');
    expect(h.ids()).toEqual(['cam-nsw-a']);
    expect(h.status().note).toContain('(unavailable; last catalog shown)');
    h.at(25 * H);
    await h.lm.refresh('cameras');
    expect(h.ids()).toEqual([]);
    expect(h.status().state).toBe('error');
    expect(h.status().error).toContain('All camera catalogs failed');
  });

  it('removes the cameras of a rejected key at once, even when no other source is usable', async () => {
    const h = managerHarness();
    await h.lm.refresh('cameras');
    h.mode.nsw = 'rejected';
    h.at(7 * H);
    await h.lm.refresh('cameras');
    expect(h.ids()).toEqual([]);
    expect(h.status().state).toBe('error');
    expect(h.status().error).toContain('(key rejected)');
  });

  it('removes the cameras of a removed key at once, even when no other source is usable', async () => {
    const h = managerHarness();
    await h.lm.refresh('cameras');
    expect(h.ids()).toEqual(['cam-nsw-a']);
    delete h.keys['cam-nsw'];
    h.lm.credentialsChanged('cameras');
    await vi.waitFor(() => expect(h.ids()).toEqual([]));
    expect(h.status().state).toBe('error');
  });

  it('a thrown error from other layers still keeps their last-known records', async () => {
    let fail = false;
    const fetchJson: FetchJson = async () => {
      if (fail) throw down();
      return { status: 200, body: { now: Date.now(), ac: [{ hex: 'abc123', lat: 40, lon: -105, seen_pos: 0 }] } };
    };
    const s = { ...DEFAULT_SETTINGS, layersEnabled: ['aircraft' as const] };
    const lm = new LayerManager({ store: new AtlasStore(tempDbPath()), fetchJson, fetchText, getSettings: () => s, userAgent: () => 'test', localReceiverUrl: () => null, ais: null, aisConfigured: () => false, emit: () => {} });
    lm.setView({ lat: 40, lon: -105, heightM: 200_000, bbox: [-106, 39, -104, 41] });
    await lm.refresh('aircraft');
    fail = true;
    await lm.refresh('aircraft');
    expect(lm.snapshot('aircraft').records.map((r) => r.id)).toEqual(['abc123']);
    lm.stop();
  });
});
