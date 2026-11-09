// Provider Settings backend: credential storage, connection tests, status.
// Tests call each provider's real endpoint with a minimal request and
// report the actual outcome; credentials are redacted from all messages.

import { PROVIDERS, type ProviderId, type ProviderState } from '../shared/providers';
import { FeedHttpError, isAllowedLocalReceiverUrl, setLocalReceiverUrl, type FetchJson, type FetchText } from './feeds/http';
import { redactSecrets, type SecretStore } from './secrets';
import type { AtlasStore } from './store';

export class ProviderService {
  private lastTests = new Map<ProviderId, { ok: boolean; message: string; at: string }>();

  constructor(
    private readonly store: AtlasStore,
    private readonly secrets: SecretStore,
    private readonly fetchJson: FetchJson,
    private readonly fetchText: FetchText,
    private readonly ua: () => string,
    private readonly testWebSocket: (key: string) => Promise<{ ok: boolean; message: string }>,
  ) {
    setLocalReceiverUrl(this.localReceiverUrl());
  }

  ackGiven(id: 'eox'): boolean {
    return this.store.getMeta(`config:${id}-ack`) === 'yes';
  }

  localReceiverUrl(): string | null {
    return this.store.getMeta('config:local-adsb');
  }

  list(): ProviderState[] {
    return PROVIDERS.map((p) => ({
      id: p.id,
      configured: p.credential ? (p.credential.kind === 'url' ? !!this.localReceiverUrl() : p.credential.kind === 'ack' ? this.store.getMeta(`config:${p.id}-ack`) === 'yes' : this.secrets.has(p.id)) : true,
      configValue: p.credential?.kind === 'url' ? this.localReceiverUrl() : null,
      lastTest: this.lastTests.get(p.id) ?? null,
    }));
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
    return this.secrets.get(id);
  }

  async test(id: ProviderId): Promise<{ ok: boolean; message: string }> {
    const headers = { 'User-Agent': this.ua() };
    const secret = this.secrets.get(id);
    let r: { ok: boolean; message: string };
    try {
      r = await this.runTest(id, headers, secret);
    } catch (e) {
      const status = e instanceof FeedHttpError ? e.status : null;
      const msg =
        status === 400 || status === 401 || status === 403
          ? `Rejected by provider (HTTP ${status}). The key may be invalid, not enabled for this API, or restricted.`
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
      case 'aisstream': {
        if (!secret) return { ok: false, message: 'Add your AISStream API key first.' };
        return this.testWebSocket(secret);
      }
      case 'firms': {
        const t = await this.fetchText('https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Alaska_24h.csv', { headers, timeoutMs: 20000 });
        return { ok: true, message: `Connected. Alaska 24 h file has ${Math.max(0, t.text.split('\n').filter(Boolean).length - 1)} detections.` };
      }
      case 'nifc': {
        const b = (await json('https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json')) as { count?: number };
        return { ok: true, message: `Connected. ${b.count ?? '?'} current perimeters.` };
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
        const b = (await json('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1600+Pennsylvania+Ave+NW+Washington+DC&benchmark=Public_AR_Current&format=json')) as { result?: { addressMatches?: unknown[] } };
        return { ok: true, message: `Connected. Test address returned ${b.result?.addressMatches?.length ?? 0} match(es).` };
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
      case 'google3d': {
        if (!secret) return { ok: false, message: 'Add your Google Maps API key first. Requests are billed to your Google Cloud account.' };
        await this.fetchJson(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(secret)}`, { headers, timeoutMs: 15000 });
        return { ok: true, message: 'Key accepted by the Map Tiles API. Note: this test itself counts as a billable root-tile request.' };
      }
      default:
        return { ok: false, message: 'No connection test for this provider.' };
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
