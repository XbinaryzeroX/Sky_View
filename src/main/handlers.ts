import { parseRouteset } from '../shared/route';
import { commonsSearchUrl, parseAdsbdb, parseAirportData, parseCommons, type VehicleInfo } from '../shared/vehicleInfo';
// IPC request handlers. Every request is validated against the schema for
// its channel before any work happens. No Electron imports here so the
// handlers can be tested directly; platform services are injected.

import { buildBriefing } from '../shared/briefing';
import { LAYER_IDS } from '../shared/layers';
import { locationsToCsv } from '../shared/csv';
import { IPC, isInvokeChannel, IpcValidationError, validateIpcArgs, type InvokeChannel } from '../shared/ipc';
import type { AppCore } from './core';
import type { FetchJson } from './feeds/http';
import { askOllama, getAiStatus } from './ollama';
import type { LayerManager } from './layers/manager';
import type { ProviderService } from './providerService';
import { sceneSchema } from '../shared/ipc';
import { cleanText } from '../shared/normalize';
import { classifyAircraftQuery } from '../shared/aircraft';
import { normalizeAdsb } from '../shared/layerNormalize';
import type { AtlasStore } from './store';

export interface PlatformServices {
  saveTextFile(defaultName: string, filters: { name: string; extensions: string[] }[], content: string): Promise<string | null>;
  savePdfFromHtml(defaultName: string, html: string): Promise<string | null>;
  openExternal(url: string): boolean;
  getNetStats(): unknown;
  openTextFile(filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  setKiosk(on: boolean): boolean;
  captureScreenshot(): Promise<string | null>;
  appVersion: string;
}

export interface ExtraServices {
  layers: LayerManager | null;
  providers: ProviderService | null;
  userAgent?: () => string;
}

export type Handler = (args: unknown[]) => Promise<unknown> | unknown;

/** Session cache of vehicle model/photo lookups (successful ones only). */
const vehicleInfoCache = new Map<string, VehicleInfo>();

export function createHandlers(core: AppCore, store: AtlasStore, fetchJson: FetchJson, platform: PlatformServices, extra: ExtraServices = { layers: null, providers: null }): Record<InvokeChannel, Handler> {
  const need = <T>(v: T | null, what: string): T => {
    if (!v) throw new Error(`${what} is not available`);
    return v;
  };
  const h: Record<InvokeChannel, Handler> = {
    [IPC.stateGet]: (a) => {
      validateIpcArgs(IPC.stateGet, a);
      return core.snapshot();
    },
    [IPC.locationCreate]: (a) => {
      const [input] = validateIpcArgs(IPC.locationCreate, a);
      return core.createLocation(input);
    },
    [IPC.locationUpdate]: (a) => {
      const [id, input] = validateIpcArgs(IPC.locationUpdate, a);
      return core.updateLocation(id, input);
    },
    [IPC.locationDelete]: (a) => {
      const [id] = validateIpcArgs(IPC.locationDelete, a);
      core.deleteLocation(id);
      return true;
    },
    [IPC.locationImport]: (a) => {
      const [items] = validateIpcArgs(IPC.locationImport, a);
      return core.importLocations(items);
    },
    [IPC.locationExportCsv]: async (a) => {
      validateIpcArgs(IPC.locationExportCsv, a);
      return platform.saveTextFile('atlas-watch-locations.csv', [{ name: 'CSV', extensions: ['csv'] }], `﻿${locationsToCsv(core.locations)}`);
    },
    [IPC.feedsRefresh]: async (a) => {
      const [feed] = validateIpcArgs(IPC.feedsRefresh, a);
      if (feed === 'all') await Promise.all([core.refresh('nws'), core.refresh('usgs')]);
      else await core.refresh(feed);
      return core.snapshot().feeds;
    },
    [IPC.settingsUpdate]: (a) => {
      const [patch] = validateIpcArgs(IPC.settingsUpdate, a);
      const r = core.updateSettings(patch);
      if (patch.layersEnabled || patch.firmsRegion || patch.satelliteGroups) {
        extra.layers?.syncEnabled();
        if (patch.firmsRegion && r.layersEnabled.includes('fires')) void extra.layers?.refresh('fires');
        if (patch.satelliteGroups && r.layersEnabled.includes('satellites')) void extra.layers?.refresh('satellites');
      }
      return r;
    },
    [IPC.historyQuery]: (a) => {
      const [q] = validateIpcArgs(IPC.historyQuery, a);
      return store.queryHistory(q);
    },
    [IPC.historyGet]: (a) => {
      const [key] = validateIpcArgs(IPC.historyGet, a);
      if (!/^(alert|quake):/.test(key)) throw new IpcValidationError(IPC.historyGet, 'bad key');
      return store.getHistory(key);
    },
    [IPC.historyClear]: (a) => {
      validateIpcArgs(IPC.historyClear, a);
      return store.clearHistory();
    },
    [IPC.briefingPreview]: (a) => {
      const [ids] = validateIpcArgs(IPC.briefingPreview, a);
      return buildBriefing(core.snapshot(), { locationIds: ids, now: new Date(), appVersion: platform.appVersion }).html;
    },
    [IPC.briefingExport]: async (a) => {
      const [ids, format] = validateIpcArgs(IPC.briefingExport, a);
      const now = new Date();
      const b = buildBriefing(core.snapshot(), { locationIds: ids, now, appVersion: platform.appVersion });
      const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
      if (format === 'pdf') return platform.savePdfFromHtml(`atlas-watch-briefing-${stamp}.pdf`, b.html);
      return platform.saveTextFile(`atlas-watch-briefing-${stamp}.html`, [{ name: 'HTML', extensions: ['html'] }], b.html);
    },
    [IPC.aiStatus]: (a) => {
      validateIpcArgs(IPC.aiStatus, a);
      return getAiStatus(fetchJson, core.settings.aiEnabled, core.settings.ollamaPort);
    },
    [IPC.aiAsk]: (a) => {
      const [req] = validateIpcArgs(IPC.aiAsk, a);
      if (!core.settings.aiEnabled) throw new Error('Local AI is turned off in Settings.');
      if (!core.settings.ollamaModel) throw new Error('Choose a local model in Settings first.');
      return askOllama(fetchJson, core.settings.ollamaPort, core.settings.ollamaModel, core.snapshot(), req.question, req.locationIds, new Date());
    },
    [IPC.diagNetStats]: (a) => {
      validateIpcArgs(IPC.diagNetStats, a);
      return platform.getNetStats();
    },
    [IPC.layersGet]: (a) => {
      validateIpcArgs(IPC.layersGet, a);
      const lm = need(extra.layers, 'Layers');
      return LAYER_IDS.map((lid) => lm.snapshot(lid));
    },
    [IPC.layersSetView]: (a) => {
      const [v] = validateIpcArgs(IPC.layersSetView, a);
      need(extra.layers, 'Layers').setView(v);
      return true;
    },
    [IPC.layersRefresh]: async (a) => {
      const [lid] = validateIpcArgs(IPC.layersRefresh, a);
      await need(extra.layers, 'Layers').refresh(lid);
      return true;
    },
    [IPC.tracksTrail]: (a) => {
      const [lid, rid] = validateIpcArgs(IPC.tracksTrail, a);
      return store.trackFor(lid, rid);
    },
    [IPC.tracksRange]: (a) => {
      validateIpcArgs(IPC.tracksRange, a);
      return store.trackRange();
    },
    [IPC.tracksSnapshot]: (a) => {
      const [lid, t] = validateIpcArgs(IPC.tracksSnapshot, a);
      return store.trackSnapshot(lid, t, 5 * 60_000);
    },
    [IPC.providersList]: (a) => {
      validateIpcArgs(IPC.providersList, a);
      return need(extra.providers, 'Providers').list();
    },
    [IPC.providersSetCredential]: (a) => {
      const [pid, value] = validateIpcArgs(IPC.providersSetCredential, a);
      need(extra.providers, 'Providers').setCredential(pid, value);
      extra.layers?.syncEnabled();
      return need(extra.providers, 'Providers').list();
    },
    [IPC.providersTest]: (a) => {
      const [pid] = validateIpcArgs(IPC.providersTest, a);
      return need(extra.providers, 'Providers').test(pid);
    },
    [IPC.providersBrowserKey]: (a) => {
      const [pid] = validateIpcArgs(IPC.providersBrowserKey, a);
      return need(extra.providers, 'Providers').getSecret(pid);
    },
    [IPC.geocodeAddress]: async (a) => {
      const [q] = validateIpcArgs(IPC.geocodeAddress, a);
      const res = await fetchJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { timeoutMs: 15000 });
      const matches = ((res.body as { result?: { addressMatches?: unknown[] } }).result?.addressMatches ?? []) as { matchedAddress?: unknown; coordinates?: { x?: unknown; y?: unknown } }[];
      return matches
        .slice(0, 5)
        .map((m) => ({ label: cleanText(m.matchedAddress, 200) ?? q, lat: Number(m.coordinates?.y), lon: Number(m.coordinates?.x) }))
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));
    },
    [IPC.geocodeGoogle]: async (a) => {
      const [q] = validateIpcArgs(IPC.geocodeGoogle, a);
      // Customer key only; never a fallback key. The key stays in the main process and is not logged.
      const key = need(extra.providers, 'Providers').getSecret('google3d');
      if (!key) throw new Error('Add your Google Maps API key in Providers first.');
      const res = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`, { timeoutMs: 15000 });
      const body = res.body as { status?: unknown; error_message?: unknown; results?: { formatted_address?: unknown; geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] };
      const status = String(body.status ?? '');
      if (status === 'REQUEST_DENIED') throw new Error('Google refused the request. Enable the Geocoding API for this key in Google Cloud.');
      if (status !== 'OK' && status !== 'ZERO_RESULTS') throw new Error(`Google Geocoding: ${cleanText(status, 40) ?? 'error'}`);
      return (body.results ?? [])
        .slice(0, 5)
        .map((r) => ({ label: cleanText(r.formatted_address, 200) ?? q, lat: Number(r.geometry?.location?.lat), lon: Number(r.geometry?.location?.lng) }))
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));
    },
    [IPC.annotationsList]: (a) => {
      validateIpcArgs(IPC.annotationsList, a);
      return store.listDocs('annotations');
    },
    [IPC.annotationsPut]: (a) => {
      const [ann] = validateIpcArgs(IPC.annotationsPut, a);
      store.putDoc('annotations', ann.id, ann, ann.createdAt);
      return true;
    },
    [IPC.annotationsDelete]: (a) => {
      const [aid] = validateIpcArgs(IPC.annotationsDelete, a);
      return store.deleteDoc('annotations', aid);
    },
    [IPC.viewsList]: (a) => {
      validateIpcArgs(IPC.viewsList, a);
      return store.listDocs('saved_views');
    },
    [IPC.viewsPut]: (a) => {
      const [v] = validateIpcArgs(IPC.viewsPut, a);
      store.putDoc('saved_views', v.id, v, v.createdAt);
      return true;
    },
    [IPC.viewsDelete]: (a) => {
      const [vid] = validateIpcArgs(IPC.viewsDelete, a);
      return store.deleteDoc('saved_views', vid);
    },
    [IPC.sceneExport]: async (a) => {
      const [scene] = validateIpcArgs(IPC.sceneExport, a);
      // Schema is strict: only camera, display, layers, annotations and views can be present (no credentials).
      return platform.saveTextFile(`atlas-watch-scene-${scene.createdAt.slice(0, 10)}.json`, [{ name: 'Atlas Watch scene', extensions: ['json'] }], JSON.stringify(scene, null, 2));
    },
    [IPC.sceneImport]: async (a) => {
      validateIpcArgs(IPC.sceneImport, a);
      const text = await platform.openTextFile([{ name: 'Atlas Watch scene', extensions: ['json'] }]);
      if (text === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('The file is not valid JSON.');
      }
      const r = sceneSchema.safeParse(parsed);
      if (!r.success) throw new Error(`Not a valid Atlas Watch scene: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}`.trim());
      return r.data;
    },
    [IPC.aircraftLookup]: async (a) => {
      const [q] = validateIpcArgs(IPC.aircraftLookup, a);
      const c = classifyAircraftQuery(q);
      if (!c) throw new Error('Enter a callsign (e.g. UAL123), ICAO hex (e.g. a1b2c3) or registration (e.g. N123AB, G-ABCD).');
      const res = await fetchJson(`https://api.adsb.lol/v2/${c.kind}/${encodeURIComponent(c.value)}`, { timeoutMs: 15000 });
      return normalizeAdsb(res.body, 'adsb.lol (ODbL)', Date.now()).records;
    },
    [IPC.aircraftNear]: async (a) => {
      const [la, lo, r] = validateIpcArgs(IPC.aircraftNear, a);
      const res = await fetchJson(`https://api.adsb.lol/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${r}`, { timeoutMs: 15000 });
      return normalizeAdsb(res.body, 'adsb.lol (ODbL)', Date.now()).records;
    },
    [IPC.vehicleInfo]: async (a) => {
      const [q] = validateIpcArgs(IPC.vehicleInfo, a);
      if (!core.settings.aircraftPhotos) throw new Error('Aircraft and ship photos are turned off in Settings.');
      const key = JSON.stringify(q);
      const hit = vehicleInfoCache.get(key);
      if (hit) return hit;
      const headers = { 'User-Agent': extra.userAgent?.() ?? 'AtlasWatch (desktop monitoring app)' };
      const get = async (url: string): Promise<unknown | null> => {
        try {
          return (await fetchJson(url, { headers, timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 })).body;
        } catch (e) {
          if ((e as { status?: number }).status === 404) return null;
          throw e;
        }
      };
      const out: VehicleInfo = { model: null, photo: null, notes: [] };
      if (q.kind === 'aircraft') {
        if (q.hex) {
          try {
            out.model = parseAdsbdb(await get(`https://api.adsbdb.com/v0/aircraft/${q.hex}`));
            if (!out.model) out.notes.push('adsbdb.com has no record of this ICAO address.');
          } catch (e) {
            out.notes.push(`adsbdb.com: ${(e as Error).message}`);
          }
        }
        const reg = q.registration ?? out.model?.registration ?? null;
        if (reg && /^[A-Z0-9-]{3,12}$/.test(reg)) {
          try {
            out.photo = parseCommons(await get(commonsSearchUrl(`intitle:"${reg}" filetype:bitmap`)), `registration ${reg} in the file title`, reg);
          } catch (e) {
            out.notes.push(`Wikimedia Commons: ${(e as Error).message}`);
          }
        }
        if (!out.photo && q.hex) {
          try {
            out.photo = parseAirportData(await get(`https://airport-data.com/api/ac_thumb.json?m=${q.hex.toUpperCase()}&n=1`));
          } catch (e) {
            out.notes.push(`airport-data.com: ${(e as Error).message}`);
          }
        }
      } else if (q.imo) {
        try {
          out.photo = parseCommons(await get(commonsSearchUrl(`"IMO ${q.imo}" filetype:bitmap`)), `IMO number ${q.imo}`);
        } catch (e) {
          out.notes.push(`Wikimedia Commons: ${(e as Error).message}`);
        }
      } else out.notes.push('This vessel reports no IMO number, so no photo can be matched to it.');
      if (!out.notes.some((n) => n.includes(':'))) {
        if (vehicleInfoCache.size > 500) vehicleInfoCache.clear();
        vehicleInfoCache.set(key, out);
      }
      return out;
    },
    [IPC.aircraftRoute]: async (a) => {
      const [cs, la, lo] = validateIpcArgs(IPC.aircraftRoute, a);
      const res = await fetchJson('https://api.adsb.lol/api/0/routeset', { method: 'POST', body: JSON.stringify({ planes: [{ callsign: cs, lat: la, lng: lo }] }), headers: { 'Content-Type': 'application/json' }, timeoutMs: 15000 });
      return parseRouteset(res.body, cs);
    },
    [IPC.watchlistGet]: (a) => {
      validateIpcArgs(IPC.watchlistGet, a);
      try {
        return JSON.parse(store.getMeta('watchlist') ?? '[]');
      } catch {
        return [];
      }
    },
    [IPC.watchlistSet]: (a) => {
      const [items] = validateIpcArgs(IPC.watchlistSet, a);
      store.setMeta('watchlist', JSON.stringify(items));
      return true;
    },
    [IPC.docsList]: (a) => {
      const [kind] = validateIpcArgs(IPC.docsList, a);
      return store.listDocs(kind);
    },
    [IPC.docsPut]: (a) => {
      const [kind, doc] = validateIpcArgs(IPC.docsPut, a);
      store.putDoc(kind, doc.id, doc, doc.createdAt);
      return true;
    },
    [IPC.docsDelete]: (a) => {
      const [kind, did] = validateIpcArgs(IPC.docsDelete, a);
      return store.deleteDoc(kind, did);
    },
    [IPC.windowKiosk]: (a) => {
      const [on] = validateIpcArgs(IPC.windowKiosk, a);
      return platform.setKiosk(on);
    },
    [IPC.captureScreenshot]: (a) => {
      validateIpcArgs(IPC.captureScreenshot, a);
      return platform.captureScreenshot();
    },
    [IPC.openExternal]: (a) => {
      const [url] = validateIpcArgs(IPC.openExternal, a);
      return platform.openExternal(url);
    },
  };
  return h;
}

/** Dispatches a raw request. Unknown channels are rejected. */
export async function dispatch(handlers: Record<InvokeChannel, Handler>, channel: unknown, args: unknown[]): Promise<unknown> {
  if (!isInvokeChannel(channel)) throw new IpcValidationError(String(channel), 'unknown channel');
  return handlers[channel](args);
}
