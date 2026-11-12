// IPC request handlers. Every request is validated against the schema for
// its channel before any work happens. No Electron imports here so the
// handlers can be tested directly; platform services are injected.

import type { MarketService } from './markets';
import type { LemmyService } from './lemmy';
import { parseRouteset } from '../shared/route';
import { createAirlineStatusLookup } from './airlineFlightStatus';
import { commonsSearchUrl, parseAdsbdb, parseAirportData, parseCommons, type VehicleInfo } from '../shared/vehicleInfo';
import { buildBriefing, buildVisitBriefing, type BriefingPreview } from '../shared/briefing';
import { randomUUID } from 'node:crypto';
import { LAYER_IDS } from '../shared/layers';
import { locationsToCsv } from '../shared/csv';
import { IPC, isInvokeChannel, IpcValidationError, validateIpcArgs, type InvokeChannel } from '../shared/ipc';
import type { AppCore } from './core';
import { fetchText, type FetchJson } from './feeds/http';
import { createConflictReportsLookup } from './conflictReports';
import { createConflictAssessmentLookup } from './conflictAssessments';
import { askOllama, getAiStatus } from './ollama';
import type { LayerManager } from './layers/manager';
import type { ProviderService } from './providerService';
import { sceneSchema } from '../shared/ipc';
import { classifyAircraftQuery } from '../shared/aircraft';
import { normalizeAdsb } from '../shared/layerNormalize';
import type { AtlasStore } from './store';
import { REPLAY_LAYERS, REPLAY_FIX_WINDOW_MS, type TimelineFrame } from '../shared/timeline';
import { isKeyedCameraId } from '../shared/keyedCameras';
import { mainGeoidHeight } from './geoid';
import { placeSearchMode } from '../shared/geocoding';
import { geocodingMatches } from './geocoding';
import { annotationsToGeoJson, GEOJSON_MAX_BYTES, previewGeoJsonAnnotations, type AnnotationDocument } from '../shared/geojsonAnnotations';

export interface PlatformServices {
  saveTextFile(defaultName: string, filters: { name: string; extensions: string[] }[], content: string): Promise<string | null>;
  savePdfFromHtml(defaultName: string, html: string): Promise<string | null>;
  openExternal(url: string): boolean;
  getNetStats(): unknown;
  openTextFile(filters: { name: string; extensions: string[] }[], maxBytes?: number): Promise<string | null>;
  setKiosk(on: boolean): boolean;
  captureScreenshot(): Promise<string | null>;
  appVersion: string;
}

export interface ExtraServices {
  markets?: MarketService;
  lemmy?: LemmyService;
  layers: LayerManager | null;
  providers: ProviderService | null;
  userAgent?: () => string;
}

export type Handler = (args: unknown[]) => Promise<unknown> | unknown;

/** Session cache of vehicle model/photo lookups (successful ones only). */
const vehicleInfoCache = new Map<string, VehicleInfo>();

export function createHandlers(core: AppCore, store: AtlasStore, fetchJson: FetchJson, platform: PlatformServices, extra: ExtraServices = { layers: null, providers: null }): Record<InvokeChannel, Handler> {
  const conflicts = createConflictReportsLookup(fetchText, store);
  const conflictAssessments = createConflictAssessmentLookup(fetchText, store);
  const datedStatus = createAirlineStatusLookup(fetchJson, id => {
    const layer = extra.layers?.snapshot('aircraft');
    return layer?.status.enabled ? layer.records.find(record => record.id === id) : undefined;
  }, () => extra.providers?.credentials.userKey('aerodatabox') ?? null);
  // Only main-generated HTML is retained. A renderer may export its reviewed token,
  // never supply HTML. Legacy array calls keep their established return shape.
  const previews = new Map<string, BriefingPreview & { bytes: number; expiresAt: number }>();
  const prunePreviews = () => {
    for (const [id, value] of previews) if (value.expiresAt <= Date.now()) previews.delete(id);
  };
  const retainPreview = (preview: BriefingPreview): BriefingPreview => {
    prunePreviews();
    const bytes = Buffer.byteLength(preview.html, 'utf8');
    if (bytes > 8 * 1024 * 1024 && preview.mode === 'locations')
      return { ...preview, previewId: null, html: '', exportPolicy: 'current-locations' };
    if (bytes > 8 * 1024 * 1024) throw new Error('The visit briefing exceeds the preview limit. Try again after checking the retained source evidence.');
    if (!preview.previewId) throw new Error('A frozen briefing preview requires a valid identifier.');
    while (previews.size >= 4 || [...previews.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 16 * 1024 * 1024)
      previews.delete(previews.keys().next().value!);
    previews.set(preview.previewId, { ...preview, bytes, expiresAt: Date.now() + 10 * 60_000 });
    return preview;
  };
  const syncRestoredLayers = <T extends { settings: { layersEnabled: string[] }; warnings: string[] }>(before: readonly string[], result: T): T => {
    if (before.length !== result.settings.layersEnabled.length || before.some(id => !result.settings.layersEnabled.includes(id))) {
      try { extra.layers?.syncEnabled(); }
      catch { result.warnings.push('The saved state was committed, but layer providers could not be synchronized. Reload the application to refresh them.'); }
    }
    return result;
  };
  const need = <T>(v: T | null | undefined, what: string): T => {
    if (!v) throw new Error(`${what} is not available`);
    return v;
  };
  const h: Record<InvokeChannel, Handler> = {
    [IPC.conflictReports]: (args) => { validateIpcArgs(IPC.conflictReports, args); return conflicts(); },
    [IPC.conflictAssessments]: (args) => { validateIpcArgs(IPC.conflictAssessments, args); return conflictAssessments(); },
    [IPC.marketsTrending]: (args) => {
      validateIpcArgs(IPC.marketsTrending, args);
      return need(extra.markets, 'Markets').trending();
    },
    [IPC.marketsSearch]: (args) => {
      const [query] = validateIpcArgs(IPC.marketsSearch, args);
      return need(extra.markets, 'Markets').search(query);
    },
    [IPC.marketsQuote]: (args) => {
      const [symbol] = validateIpcArgs(IPC.marketsQuote, args);
      return need(extra.markets, 'Markets').quote(symbol);
    },
    [IPC.marketsCandles]: (args) => {
      const [symbol, range] = validateIpcArgs(IPC.marketsCandles, args);
      return need(extra.markets, 'Markets').candles(symbol, range);
    },
    [IPC.marketsNews]: (args) => {
      const [symbol, name, selection] = validateIpcArgs(IPC.marketsNews, args);
      return need(extra.markets, 'Markets').news(symbol, name, selection);
    },
    [IPC.marketsExplain]: (args) => {
      const [symbol, headlines, movement] = validateIpcArgs(IPC.marketsExplain, args);
      return need(extra.markets, 'Markets').explain(symbol, headlines, movement);
    },
    [IPC.lemmyStatus]: (args) => {
      validateIpcArgs(IPC.lemmyStatus, args);
      return need(extra.lemmy, 'Community').status();
    },
    [IPC.lemmyLogin]: (args) => {
      const [input] = validateIpcArgs(IPC.lemmyLogin, args);
      return need(extra.lemmy, 'Community').login(input);
    },
    [IPC.lemmyLogout]: (args) => {
      validateIpcArgs(IPC.lemmyLogout, args);
      return need(extra.lemmy, 'Community').logout();
    },
    [IPC.lemmyFeed]: (args) => {
      const [query] = validateIpcArgs(IPC.lemmyFeed, args);
      return need(extra.lemmy, 'Community').feed(query);
    },
    [IPC.lemmyPost]: (args) => {
      const [id] = validateIpcArgs(IPC.lemmyPost, args);
      return need(extra.lemmy, 'Community').post(id);
    },
    [IPC.lemmyCommunities]: (args) => {
      const [query] = validateIpcArgs(IPC.lemmyCommunities, args);
      return need(extra.lemmy, 'Community').communities(query);
    },
    [IPC.lemmyWrite]: (args) => {
      const [input] = validateIpcArgs(IPC.lemmyWrite, args);
      return need(extra.lemmy, 'Community').write(input);
    },
    [IPC.lemmyImage]: (args) => {
      const [url] = validateIpcArgs(IPC.lemmyImage, args);
      return need(extra.lemmy, 'Community').image(url);
    },
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
      return platform.saveTextFile('atlas-watch-locations.csv', [{ name: 'CSV', extensions: ['csv'] }], `${locationsToCsv(core.locations)}`);
    },
    [IPC.feedsRefresh]: async (a) => {
      const [feed] = validateIpcArgs(IPC.feedsRefresh, a);
      if (feed === 'all') await Promise.all([core.refresh('nws'), core.refresh('usgs')]);
      else await core.refresh(feed);
      return core.snapshot().feeds;
    },
    [IPC.settingsUpdate]: (a) => {
      const [patch] = validateIpcArgs(IPC.settingsUpdate, a);
      if (patch.lemmyInstance) extra.lemmy?.changeInstance(patch.lemmyInstance);
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
      const removed = store.clearHistory();
      for (const [id, preview] of previews) if (preview.mode === 'visit') previews.delete(id);
      return removed;
    },
    [IPC.briefingPreview]: (a) => {
      const [request] = validateIpcArgs(IPC.briefingPreview, a);
      const now = new Date(), snapshot = core.snapshot();
      if (Array.isArray(request)) return buildBriefing(snapshot, { locationIds: request, now, appVersion: platform.appVersion }).html;
      const document = request.mode === 'visit'
        ? buildVisitBriefing(core.visitBriefing(), { now, appVersion: platform.appVersion, organization: snapshot.settings.orgName })
        : buildBriefing(snapshot, { locationIds: request.locationIds, now, appVersion: platform.appVersion });
      return retainPreview({ previewId: randomUUID(), mode: request.mode, generatedAt: now.toISOString(), html: document.html,
        exportPolicy: 'frozen', locationCount: document.locationCount, byteLength: Buffer.byteLength(document.html, 'utf8') });
    },
    [IPC.briefingExport]: async (a) => {
      const [request, format] = validateIpcArgs(IPC.briefingExport, a);
      const now = new Date();
      let html: string, generatedAt = now.toISOString(), mode = 'locations';
      if (Array.isArray(request)) html = buildBriefing(core.snapshot(), { locationIds: request, now, appVersion: platform.appVersion }).html;
      else {
        prunePreviews();
        const preview = previews.get(request.previewId);
        if (!preview) throw new Error('This briefing preview expired. Refresh the preview before exporting.');
        ({ html, generatedAt, mode } = preview);
      }
      const stamp = generatedAt.slice(0, 16).replace(/[:T]/g, '-');
      const name = `atlas-watch-${mode === 'visit' ? 'since-last-visit' : 'briefing'}-${stamp}`;
      if (format === 'pdf') return platform.savePdfFromHtml(`${name}.pdf`, html);
      return platform.saveTextFile(`${name}.html`, [{ name: 'HTML', extensions: ['html'] }], html);
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
      return store.trackSnapshot(lid, t, REPLAY_FIX_WINDOW_MS);
    },
    [IPC.timelineRange]: (a) => {
      validateIpcArgs(IPC.timelineRange, a);
      return store.timelineRange();
    },
    [IPC.timelineFrame]: (a): TimelineFrame => {
      const [t] = validateIpcArgs(IPC.timelineFrame, a);
      const points = REPLAY_LAYERS.flatMap(layer => store.trackSnapshot(layer, t, REPLAY_FIX_WINDOW_MS).map(fix => ({ ...fix, layer })));
      return { t, points, ...store.timelineFrame(t) };
    },
    [IPC.providersList]: (a) => {
      validateIpcArgs(IPC.providersList, a);
      return need(extra.providers, 'Providers').list();
    },
    [IPC.providersSetCredential]: (a) => {
      const [pid, value] = validateIpcArgs(IPC.providersSetCredential, a);
      need(extra.providers, 'Providers').setCredential(pid, value);
      extra.layers?.syncEnabled();
      // A saved or removed camera key takes effect now, even if a refresh with the old key is underway.
      if (isKeyedCameraId(pid)) extra.layers?.credentialsChanged('cameras');
      return need(extra.providers, 'Providers').list();
    },
    [IPC.providersTest]: (a) => {
      const [pid] = validateIpcArgs(IPC.providersTest, a);
      return need(extra.providers, 'Providers').test(pid);
    },
    [IPC.providersBrowserKey]: (a) => {
      const [pid] = validateIpcArgs(IPC.providersBrowserKey, a);
      return need(extra.providers, 'Providers').credentials.browserKey(pid);
    },
    [IPC.geocodeAddress]: async (a) => {
      const [q] = validateIpcArgs(IPC.geocodeAddress, a);
      if (placeSearchMode(core.settings.basemap, false, core.settings.imageryYear) !== 'offline') throw new Error('Select a non-Google basemap to use U.S. Census address search.');
      const res = await fetchJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { timeoutMs: 15000 });
      return geocodingMatches('Census', res.body);
    },
    [IPC.geocodeGoogle]: async (a) => {
      const [q] = validateIpcArgs(IPC.geocodeGoogle, a);
      if (placeSearchMode(core.settings.basemap, true, core.settings.imageryYear) !== 'google') throw new Error('Select Google imagery to use Google place search.');
      // Customer key only; never a fallback key. The key stays in the main process and is not logged.
      const key = need(extra.providers, 'Providers').credentials.userKey('google3d');
      if (!key) throw new Error('Add your Google Maps API key in Providers first.');
      const res = await fetchJson(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`, { timeoutMs: 15000 });
      return geocodingMatches('Google', res.body);
    },
    [IPC.annotationsList]: (a) => {
      validateIpcArgs(IPC.annotationsList, a);
      return store.listDocs('annotations');
    },
    [IPC.annotationsPut]: (a) => {
      const [ann] = validateIpcArgs(IPC.annotationsPut, a);
      core.putAnnotation(ann);
      return true;
    },
    [IPC.annotationsDelete]: (a) => {
      const [aid] = validateIpcArgs(IPC.annotationsDelete, a);
      return core.deleteAnnotation(aid);
    },
    [IPC.annotationsGeoJsonPreview]: async (a) => {
      validateIpcArgs(IPC.annotationsGeoJsonPreview, a);
      const text = await platform.openTextFile([{ name: 'GeoJSON annotations', extensions: ['geojson', 'json'] }], GEOJSON_MAX_BYTES);
      return text === null ? null : { text, preview: previewGeoJsonAnnotations(text, store.listDocs<AnnotationDocument>('annotations')) };
    },
    [IPC.annotationsGeoJsonImport]: (a) => {
      const [text] = validateIpcArgs(IPC.annotationsGeoJsonImport, a);
      return store.importGeoJsonAnnotations(text);
    },
    [IPC.annotationsGeoJsonExport]: async (a) => {
      validateIpcArgs(IPC.annotationsGeoJsonExport, a);
      const text = annotationsToGeoJson(store.listDocs<AnnotationDocument>('annotations'));
      return platform.saveTextFile('atlas-watch-annotations.geojson', [{ name: 'GeoJSON', extensions: ['geojson'] }], text);
    },
    [IPC.areaWatchPut]: (args) => {
      const [rule] = validateIpcArgs(IPC.areaWatchPut, args);
      core.putAreaWatch(rule);
    },
    [IPC.areaWatchDelete]: (args) => {
      const [areaId] = validateIpcArgs(IPC.areaWatchDelete, args);
      core.deleteAreaWatch(areaId);
    },
    [IPC.areaWatchRead]: (args) => {
      const [ids] = validateIpcArgs(IPC.areaWatchRead, args);
      core.readAreaWatchEvents(ids);
    },
    [IPC.viewsList]: (a) => {
      validateIpcArgs(IPC.viewsList, a);
      return store.listDocs('saved_views');
    },
    [IPC.viewsPut]: (a) => {
      const [v] = validateIpcArgs(IPC.viewsPut, a);
      store.putSavedView(v);
      return true;
    },
    [IPC.viewsRestore]: (a) => {
      const [id, allowMeteredBasemap = false] = validateIpcArgs(IPC.viewsRestore, a);
      const before = core.settings.layersEnabled;
      return syncRestoredLayers(before, core.restoreView(id, allowMeteredBasemap));
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
    [IPC.sceneApply]: (a) => {
      const [scene, allowMeteredBasemap = false] = validateIpcArgs(IPC.sceneApply, a);
      const before = core.settings.layersEnabled;
      return syncRestoredLayers(before, core.applyScene(scene, allowMeteredBasemap));
    },
    [IPC.aircraftLookup]: async (a) => {
      const [q] = validateIpcArgs(IPC.aircraftLookup, a);
      const c = classifyAircraftQuery(q);
      if (!c) throw new Error('Enter a callsign (e.g. UAL123), ICAO hex (e.g. a1b2c3) or registration (e.g. N123AB, G-ABCD).');
      const res = await fetchJson(`https://api.adsb.lol/v2/${c.kind}/${encodeURIComponent(c.value)}`, { timeoutMs: 15000 });
      return normalizeAdsb(res.body, 'adsb.lol (ODbL)', Date.now(), mainGeoidHeight).records;
    },
    [IPC.aircraftNear]: async (a) => {
      const [la, lo, r] = validateIpcArgs(IPC.aircraftNear, a);
      const res = await fetchJson(`https://api.adsb.lol/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${r}`, { timeoutMs: 15000 });
      return normalizeAdsb(res.body, 'adsb.lol (ODbL)', Date.now(), mainGeoidHeight).records;
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
            out.model = parseAdsbdb(await get(`https://api.adsbdb.com/v0/aircraft/${q.hex}`), q);
            if (!out.model) out.notes.push('adsbdb.com returned no matching airframe record.');
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
    [IPC.airlineFlightStatus]: (args) => {
      const [recordId, callsign] = validateIpcArgs(IPC.airlineFlightStatus, args);
      return datedStatus(recordId.toLowerCase(), callsign);
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
