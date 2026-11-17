// Provider Settings backend: credential storage, connection tests, status.
// Tests call each provider's real endpoint with a minimal request and
// report the actual outcome; credentials are redacted from all messages.

import type { MarketService } from './markets';
import { CredentialService, BUILTIN_ALLOWANCES, type BuiltinProvider, type Credential } from './credentials';
import { PROVIDERS, type ProviderId, type ProviderState } from '../shared/providers';
import { isKeyedCameraId, keyedCameraRequest, keyedCameraSystem, normalizeKeyedCameras } from '../shared/keyedCameras';
import { FeedHttpError, isAllowedLocalReceiverUrl, setLocalReceiverUrl, type FetchJson, type FetchText } from './feeds/http';
import { redactSecrets, type SecretStore } from './secrets';
import type { AtlasStore } from './store';
import type { DwdSource } from './layers/dwdSource';
import { cleanText } from '../shared/normalize';
import { geocodingMatches } from './geocoding';

export class ProviderService {
  marketService?: MarketService;
  dwd?: DwdSource;
  readonly credentials: CredentialService;
  private lastTests = new Map<ProviderId, { ok: boolean; message: string; at: string }>();

  constructor(
    private readonly store: AtlasStore,
    private readonly secrets: SecretStore,
    private readonly fetchJson: FetchJson,
    private readonly fetchText: FetchText,
    private readonly ua: () => string,
    private readonly testWebSocket: (key: string) => Promise<{ ok: boolean; message: string }>,
    credentials?: CredentialService,
  ) {
    this.credentials = credentials ?? new CredentialService(secrets, store);
    setLocalReceiverUrl(this.localReceiverUrl());
  }

  ackGiven(id: 'eox'): boolean {
    return this.store.getMeta(`config:${id}-ack`) === 'yes';
  }

  localReceiverUrl(): string | null {
    return this.store.getMeta('config:local-adsb');
  }

  list(): ProviderState[] {
    return PROVIDERS.map((p) => {
      // Resolve once per provider; a credential that cannot be decrypted is reported on its own row
      // (so it can be replaced or removed) instead of failing the whole list. No built-in fallback.
      let credential: Credential | null = null;
      let credentialError: string | null = null;
      try {
        credential = this.credentials.credentialFor(p.id);
      } catch (e) {
        credentialError = (e as Error).message;
      }
      return {
        id: p.id,
        configured: p.credential ? (p.credential.kind === 'url' ? !!this.localReceiverUrl() : p.credential.kind === 'ack' ? this.store.getMeta(`config:${p.id}-ack`) === 'yes' : !!credential) : true,
        credentialSource: credential?.source ?? null,
        credentialError,
        builtinRemaining: p.id in BUILTIN_ALLOWANCES && credential?.source === 'builtin' ? this.credentials.remaining(p.id as BuiltinProvider) : null,
        userConfigured: this.secrets.has(p.id),
        configValue: p.credential?.kind === 'url' ? this.localReceiverUrl() : null,
        lastTest: this.lastTests.get(p.id) ?? null,
      };
    });
  }

  setCredential(id: ProviderId, value: string | null): void {
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p?.credential) throw new Error('This provider does not take a credential.');
    const v = value?.trim() || null;
    if (p.credential.kind === 'ack') {
      if (v === 'yes') this.store.setMeta(`config:${id}-ack`, 'yes');
      else this.store.deleteMeta(`config:${id}-ack`);
      return;
    }
    if (p.credential.kind === 'url') {
      if (v && !isAllowedLocalReceiverUrl(v)) throw new Error('Use an http(s) URL with a literal private IPv4 address ending in /aircraft.json (for example http://192.168.1.50/tar1090/data/aircraft.json).');
      if (v) this.store.setMeta('config:local-adsb', v);
      else this.store.deleteMeta('config:local-adsb');
      setLocalReceiverUrl(v);
      return;
    }
    if (v && (v.length < 8 || v.length > 400 || /\s/.test(v))) throw new Error('That does not look like a valid key.');
    this.secrets.set(id, v);
    this.lastTests.delete(id);
  }

  getSecret(id: ProviderId): string | null {
    return this.credentials.credentialFor(id)?.value ?? null;
  }

  async test(id: ProviderId): Promise<{ ok: boolean; message: string }> {
    const headers = { 'User-Agent': this.ua() };
    const secret = this.credentials.credentialFor(id)?.value ?? null;
    let r: { ok: boolean; message: string };
    try {
      r = await this.runTest(id, headers, secret);
    } catch (e) {
      const status = e instanceof FeedHttpError ? e.status : null;
      const msg =
        status === 400 || status === 401 || status === 403
          ? `Rejected by provider (HTTP ${status}). The key may be invalid, not enabled for this API, or restricted.`
          : status === 404 && id === 'google3d'
            ? 'Google answered "not found" (HTTP 404). Usually the Map Tiles API is not enabled, or billing is not active, in the Google Cloud project that owns this key.'
          : status === 429
            ? 'Rate limited by provider (HTTP 429). Try again later.'
            : e instanceof FeedHttpError && e.kind === 'network'
              ? 'Could not reach the provider (network unavailable or blocked).'
              : (e as Error).message;
      r = { ok: false, message: msg };
    }
    r = { ok: r.ok, message: redactSecrets(r.message, [secret]) };
    this.lastTests.set(id, { ...r, at: new Date().toISOString() });
    return r;
  }

  private async runTest(id: ProviderId, headers: Record<string, string>, secret: string | null): Promise<{ ok: boolean; message: string }> {
    const json = async (url: string, extra: Record<string, string> = {}) => (await this.fetchJson(url, { headers: { ...headers, ...extra }, timeoutMs: 15000 })).body;
    switch (id) {
      case 'dwd': {
        if (!this.dwd) throw new Error('DWD warning source unavailable');
        const view = await this.dwd.refresh();
        return { ok: true, message: `DWD STATUS checked ${view.checkedAt}. ${view.note}` };
      }
      case 'twelvedata':
      case 'alphavantage': {
        if (!this.marketService) throw new Error('Market service unavailable');
        const result = await this.marketService.test(id);
        return {ok: true, message: 'Connected. Quote as of '+result.data.asOf+(result.warning?' '+result.warning:'')};
      }
      case 'nws': {
        const b = (await json('https://api.weather.gov/alerts/active/count', { Accept: 'application/geo+json' })) as { total?: number };
        return { ok: true, message: `Connected. ${b.total ?? '?'} active alerts nationwide.` };
      }
      case 'usgs-quakes': {
        const b = (await json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson')) as { metadata?: { count?: number } };
        return { ok: true, message: `Connected. Feed responded (${b.metadata?.count ?? 0} significant events today).` };
      }
      case 'adsblol': {
        const b = (await json('https://api.adsb.lol/v2/point/40.64/-73.78/10')) as { ac?: unknown[] };
        return { ok: true, message: `Connected. ${b.ac?.length ?? 0} aircraft near JFK right now.` };
      }
      case 'local-adsb': {
        const url = this.localReceiverUrl();
        if (!url) return { ok: false, message: 'Enter your receiver’s aircraft.json URL first.' };
        const b = (await this.fetchJson(url, { timeoutMs: 8000 })).body as { aircraft?: unknown[] };
        return { ok: Array.isArray(b.aircraft), message: Array.isArray(b.aircraft) ? `Connected. Receiver reports ${b.aircraft.length} aircraft.` : 'Responded, but not in readsb/dump1090 aircraft.json format.' };
      }
      case 'digitraffic': {
        const b = (await json('https://meri.digitraffic.fi/api/ais/v1/locations?from=' + (Date.now() - 60_000), { 'Digitraffic-User': this.ua() })) as { features?: unknown[] };
        return { ok: true, message: `Connected. ${b.features?.length ?? 0} vessel positions in the last minute.` };
      }
      case 'opensky': {
        if (secret && secret.includes(':')) {
          const [id, ...rest] = secret.split(':');
          const r = await this.fetchJson('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(rest.join(':'))}`, timeoutMs: 15000 });
          if (typeof (r.body as { access_token?: unknown }).access_token !== 'string') return { ok: false, message: 'OpenSky did not issue a token. Check the client id and secret.' };
          return { ok: true, message: 'OpenSky accepted your API client. Worldwide refresh about every 90 s.' };
        }
        if (secret) return { ok: false, message: 'Enter the client as client_id:client_secret.' };
        await this.fetchJson('https://opensky-network.org/api/states/all?lamin=45.8&lomin=5.9&lamax=47.8&lomax=10.5', { headers, timeoutMs: 20000 });
        return { ok: true, message: 'OpenSky reachable anonymously (one worldwide refresh per 15 min). This test used 1 of your 400 daily credits.' };
      }
      case 'aisstream': {
        if (!secret) return { ok: false, message: 'Add your AISStream API key first.' };
        return this.testWebSocket(secret);
      }
      case 'firms': {
        const t = await this.fetchText('https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Alaska_24h.csv', { headers, timeoutMs: 20000 });
        return { ok: true, message: `Connected. Alaska 24 h file has ${Math.max(0, t.text.split('\n').filter(Boolean).length - 1)} detections.` };
      }
      case 'nifc': {
        const body = await json('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json');
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return { ok: false, message: 'NIFC responded, but did not return a valid perimeter count.' };
        const b = body as { count?: unknown; error?: unknown };
        // ArcGIS reports application errors inside HTTP 200 JSON replies too.
        if (b.error !== undefined && b.error !== null) {
          const error = typeof b.error === 'object' && !Array.isArray(b.error) ? b.error as { code?: unknown; message?: unknown } : null;
          const code = Number.isSafeInteger(error?.code) ? ` (code ${error!.code})` : '';
          const message = cleanText(error?.message, 250);
          return { ok: false, message: `NIFC ArcGIS error${code}${message ? `: ${message}` : '.'}` };
        }
        if (typeof b.count !== 'number' || !Number.isSafeInteger(b.count) || b.count < 0)
          return { ok: false, message: 'NIFC responded, but did not return a valid non-negative integer perimeter count.' };
        return { ok: true, message: `Connected. ${b.count} current perimeters.` };
      }
      case 'awc': {
        const b = (await json('https://aviationweather.gov/api/data/metar?ids=KDEN&format=json')) as unknown[];
        return { ok: true, message: `Connected. ${Array.isArray(b) ? b.length : 0} observation(s) for KDEN.` };
      }
      case 'nhc': {
        const b = (await json('https://www.nhc.noaa.gov/CurrentStorms.json')) as { activeStorms?: unknown[] };
        return { ok: true, message: `Connected. ${b.activeStorms?.length ?? 0} active storm(s).` };
      }
      case 'caltrans': {
        const b = (await json('https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json')) as { data?: unknown[] };
        return { ok: true, message: `Connected. District 3 lists ${b.data?.length ?? 0} cameras.` };
      }
      case 'fintraffic-cams': {
        const b = (await json('https://tie.digitraffic.fi/api/weathercam/v1/stations', { 'Digitraffic-User': this.ua() })) as { features?: unknown[] };
        return { ok: true, message: `Connected. ${b.features?.length ?? 0} camera stations.` };
      }
      case 'mbta': {
        const b = (await json('https://api-v3.mbta.com/vehicles?page%5Blimit%5D=5', { Accept: 'application/vnd.api+json' })) as { data?: unknown[] };
        return { ok: true, message: `Connected. Vehicle feed responded (${b.data?.length ?? 0} sample records).` };
      }
      case 'faa-sua': {
        const b = (await json("https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=TYPE_CODE%20IN%20('P','R')&returnCountOnly=true&f=json")) as { count?: number };
        return { ok: true, message: `Connected. ${b.count ?? '?'} prohibited/restricted areas.` };
      }
      case 'census-geocoder': {
        const body = await json('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600+Pennsylvania+Ave+NW+Washington+DC&benchmark=Public_AR_Current&format=json');
        try {
          const matches = geocodingMatches('Census', body);
          return { ok: true, message: matches.length
            ? `Connected. Validated ${matches.length} usable test-address match(es) with WGS84 coordinates.`
            : 'Connected. Census returned a valid empty address-match list; no navigation position was verified.' };
        } catch (error) {
          return { ok: false, message: `${(error as Error).message} Retry the Census connection test later.` };
        }
      }
      case 'openfreemap': {
        const j = (await json('https://tiles.openfreemap.org/planet')) as { tiles?: string[] };
        return { ok: Array.isArray(j.tiles), message: `Connected. Current planet build: ${(j.tiles?.[0] ?? '').split('/')[4] ?? 'unknown'}.` };
      }
      case 'esri-imagery': {
        if (!secret) return { ok: false, message: 'Add your ArcGIS API key first. Usage beyond the free tier is billed to your Esri account.' };
        const t = await this.fetchText(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json&token=${encodeURIComponent(secret)}`, { headers, timeoutMs: 15000 });
        const err = /"error"/.test(t.text.slice(0, 200));
        return { ok: !err, message: err ? 'Esri rejected the key (invalid, expired, or missing basemap privileges).' : 'Key accepted by Esri World Imagery.' };
      }
      case 'mapbox': {
        if (!secret) return { ok: false, message: 'Add your Mapbox public token first. Usage beyond the free tier is billed to your Mapbox account.' };
        await this.fetchText(`https://api.mapbox.com/v4/mapbox.satellite.json?access_token=${encodeURIComponent(secret)}`, { headers, timeoutMs: 15000 });
        return { ok: true, message: 'Token accepted by Mapbox.' };
      }
      case 'eox': {
        if (!this.ackGiven('eox')) return { ok: false, message: 'Confirm your EOX commercial license first; without it this layer is for non-commercial use only.' };
        await this.fetchText('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/3/3/2.jpg', { headers, timeoutMs: 15000 });
        return { ok: true, message: 'EOX tile service reachable.' };
      }
      case 'tomtom': {
        if (!secret) return { ok: false, message: 'Add your TomTom API key first. Tiles beyond the free tier are billed to your TomTom account.' };
        await this.fetchText(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/2/1/1.png?key=${encodeURIComponent(secret)}&tileSize=256`, { headers, timeoutMs: 15000, maxBytes: 512 * 1024 });
        return { ok: true, message: 'Key accepted by TomTom Traffic. This test counted as one traffic tile.' };
      }
      case 'launchlibrary': {
        if (!secret) return { ok: false, message: 'Add your Launch Library 2 token first, or leave it empty to keep the anonymous allowance.' };
        const b = (await json('https://ll.thespacedevs.com/2.3.0/api-throttle/', { Authorization: `Token ${secret}` })) as { your_request_limit?: number; current_use?: number };
        return { ok: typeof b.your_request_limit === 'number', message: typeof b.your_request_limit === 'number' ? `Token accepted. Allowance: ${b.your_request_limit} requests an hour (${b.current_use ?? '?'} used).` : 'Launch Library answered without an allowance; the token may not be valid.' };
      }
      case 'openai': {
        if (!secret) return { ok: false, message: 'Add your OpenAI API key first. Voice commands are billed to your OpenAI account.' };
        const b = (await json('https://api.openai.com/v1/models', { Authorization: `Bearer ${secret}` })) as { data?: unknown[] };
        return { ok: Array.isArray(b.data), message: 'Key accepted by OpenAI. Listing models is free; voice commands are billed per minute of audio.' };
      }
      case 'cesium-ion': {
        if (!secret) return { ok: false, message: 'Add your Cesium ion access token first.' };
        await this.fetchText('https://api.cesium.com/v1/me', { headers: { ...headers, Authorization: `Bearer ${secret}` }, timeoutMs: 15000, maxBytes: 256 * 1024 });
        return { ok: true, message: 'Token accepted by Cesium ion. Usage counts against your ion plan.' };
      }
      case 'google3d': {
        if (!secret) return { ok: false, message: 'Add your Google Maps API key first. Requests are billed to your Google Cloud account.' };
        if (this.credentials.credentialFor('google3d')?.source === 'builtin') this.credentials.reserveBuiltin('google3d');
        await this.fetchJson(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(secret)}`, { headers, timeoutMs: 15000 });
        return { ok: true, message: 'Key accepted by the Map Tiles API. Note: this test itself counts as a billable root-tile request.' };
      }
      default: {
        const sys = isKeyedCameraId(id) ? keyedCameraSystem(id) : null;
        if (sys) {
          if (!secret) return { ok: false, message: `Add your ${sys.name} key first (free; register on the publisher's developer page).` };
          const req = keyedCameraRequest(sys, secret);
          const res = await this.fetchJson(req.url, { method: req.method, body: req.body, headers: { ...headers, ...req.headers }, timeoutMs: 30000, maxBytes: 40 * 1024 * 1024, sameOrigin: true });
          const n = normalizeKeyedCameras(sys, res.body);
          return { ok: n.records.length > 0, message: n.records.length ? `Key accepted. ${n.records.length.toLocaleString()} camera views listed${n.skipped ? ` (${n.skipped} without a usable image skipped)` : ''}.` : 'Key accepted, but no cameras with a usable image were listed.' };
        }
        return { ok: false, message: 'No connection test for this provider.' };
      }
    }
  }
}

/** Opens an AISStream socket with the key, waits for the first message or error. */
export function makeAisTester(): (key: string) => Promise<{ ok: boolean; message: string }> {
  return (key) =>
    new Promise((resolve) => {
      type WS = { send(d: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: (() => void) | null; onclose: ((e: { code?: number }) => void) | null };
      let done = false;
      const finish = (r: { ok: boolean; message: string }, ws?: WS) => {
        if (done) return;
        done = true;
        try {
          ws?.close();
        } catch {
          // ignore
        }
        resolve(r);
      };
      let ws: WS;
      try {
        ws = new (globalThis as unknown as { WebSocket: new (u: string) => WS }).WebSocket('wss://stream.aisstream.io/v0/stream');
      } catch (e) {
        finish({ ok: false, message: (e as Error).message });
        return;
      }
      const timer = setTimeout(() => finish({ ok: false, message: 'No data within 15 seconds (key may be invalid, or no traffic in the test area).' }, ws), 15000);
      ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[50, -6], [60, 10]]], FilterMessageTypes: ['PositionReport'] }));
      ws.onmessage = (e) => {
        clearTimeout(timer);
        const text = typeof e.data === 'string' ? e.data : '';
        if (/error/i.test(text.slice(0, 100))) finish({ ok: false, message: 'AISStream rejected the request (check the key).' }, ws);
        else finish({ ok: true, message: 'Connected. Receiving AIS messages.' }, ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        finish({ ok: false, message: 'Connection error (check the key and network).' }, ws);
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        finish({ ok: false, message: `Connection closed by AISStream (code ${e?.code ?? '?'}); the key may be invalid.` });
      };
    });
}
