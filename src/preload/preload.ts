// Preload bridge: exposes a narrow, typed API. The renderer never gets
// ipcRenderer or Node access directly.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// Channel names are duplicated here (not imported) so the sandboxed preload
// bundle stays tiny and dependency-free. Kept in sync with src/shared/ipc.ts
// by tests/ipc.test.ts.
const C = {
  stateGet: 'state:get',
  stateChanged: 'state:changed',
  locationCreate: 'locations:create',
  locationUpdate: 'locations:update',
  locationDelete: 'locations:delete',
  locationImport: 'locations:import',
  locationExportCsv: 'locations:exportCsv',
  feedsRefresh: 'feeds:refresh',
  settingsUpdate: 'settings:update',
  historyQuery: 'history:query',
  historyGet: 'history:get',
  historyClear: 'history:clear',
  briefingPreview: 'briefing:preview',
  briefingExport: 'briefing:export',
  aiStatus: 'ai:status',
  aiAsk: 'ai:ask',
  openExternal: 'shell:openExternal',
  diagNetStats: 'diag:netStats',
  layersGet: 'layers:get',
  layersUpdate: 'layers:update',
  layersSetView: 'layers:setView',
  layersRefresh: 'layers:refresh',
  tracksTrail: 'tracks:trail',
  tracksRange: 'tracks:range',
  tracksSnapshot: 'tracks:snapshot',
  providersList: 'providers:list',
  providersSetCredential: 'providers:setCredential',
  providersTest: 'providers:test',
  providersBrowserKey: 'providers:browserKey',
  geocodeAddress: 'geocode:address',
  geocodeGoogle: 'geocode:google',
  annotationsList: 'annotations:list',
  annotationsPut: 'annotations:put',
  annotationsDelete: 'annotations:delete',
  viewsList: 'views:list',
  viewsPut: 'views:put',
  viewsDelete: 'views:delete',
  sceneExport: 'scene:export',
  sceneImport: 'scene:import',
  aircraftLookup: 'aircraft:lookup',
  aircraftNear: 'aircraft:near',
  aircraftRoute: 'aircraft:route',
  vehicleInfo: 'vehicle:info',
  watchlistGet: 'watchlist:get',
  watchlistSet: 'watchlist:set',
  docsList: 'docs:list',
  docsPut: 'docs:put',
  docsDelete: 'docs:delete',
  windowKiosk: 'window:kiosk',
  captureScreenshot: 'capture:screenshot',
} as const;

const api = {
  getState: () => ipcRenderer.invoke(C.stateGet),
  onState: (cb: (snap: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on(C.stateChanged, listener);
    return () => {
      ipcRenderer.removeListener(C.stateChanged, listener);
    };
  },
  createLocation: (input: unknown) => ipcRenderer.invoke(C.locationCreate, input),
  updateLocation: (id: string, input: unknown) => ipcRenderer.invoke(C.locationUpdate, id, input),
  deleteLocation: (id: string) => ipcRenderer.invoke(C.locationDelete, id),
  importLocations: (items: unknown) => ipcRenderer.invoke(C.locationImport, items),
  exportLocationsCsv: () => ipcRenderer.invoke(C.locationExportCsv),
  refresh: (feed: 'nws' | 'usgs' | 'all') => ipcRenderer.invoke(C.feedsRefresh, feed),
  updateSettings: (patch: unknown) => ipcRenderer.invoke(C.settingsUpdate, patch),
  queryHistory: (q: unknown) => ipcRenderer.invoke(C.historyQuery, q),
  getHistory: (key: string) => ipcRenderer.invoke(C.historyGet, key),
  clearHistory: () => ipcRenderer.invoke(C.historyClear),
  previewBriefing: (ids: string[]) => ipcRenderer.invoke(C.briefingPreview, ids),
  exportBriefing: (ids: string[], format: 'html' | 'pdf') => ipcRenderer.invoke(C.briefingExport, ids, format),
  aiStatus: () => ipcRenderer.invoke(C.aiStatus),
  aiAsk: (req: unknown) => ipcRenderer.invoke(C.aiAsk, req),
  openExternal: (url: string) => ipcRenderer.invoke(C.openExternal, url),
  netStats: () => ipcRenderer.invoke(C.diagNetStats),
  getLayers: () => ipcRenderer.invoke(C.layersGet),
  onLayer: (cb: (snap: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on(C.layersUpdate, listener);
    return () => {
      ipcRenderer.removeListener(C.layersUpdate, listener);
    };
  },
  setView: (v: unknown) => ipcRenderer.invoke(C.layersSetView, v),
  refreshLayer: (id: string) => ipcRenderer.invoke(C.layersRefresh, id),
  trackTrail: (layer: string, id: string) => ipcRenderer.invoke(C.tracksTrail, layer, id),
  trackRange: () => ipcRenderer.invoke(C.tracksRange),
  trackSnapshot: (layer: string, t: string) => ipcRenderer.invoke(C.tracksSnapshot, layer, t),
  listProviders: () => ipcRenderer.invoke(C.providersList),
  setProviderCredential: (id: string, value: string | null) => ipcRenderer.invoke(C.providersSetCredential, id, value),
  testProvider: (id: string) => ipcRenderer.invoke(C.providersTest, id),
  providerBrowserKey: (id: 'google3d' | 'esri-imagery' | 'mapbox') => ipcRenderer.invoke(C.providersBrowserKey, id),
  geocodeAddress: (q: string) => ipcRenderer.invoke(C.geocodeAddress, q),
  geocodeGoogle: (q: string) => ipcRenderer.invoke(C.geocodeGoogle, q),
  listAnnotations: () => ipcRenderer.invoke(C.annotationsList),
  putAnnotation: (a: unknown) => ipcRenderer.invoke(C.annotationsPut, a),
  deleteAnnotation: (id: string) => ipcRenderer.invoke(C.annotationsDelete, id),
  listViews: () => ipcRenderer.invoke(C.viewsList),
  putView: (v: unknown) => ipcRenderer.invoke(C.viewsPut, v),
  deleteView: (id: string) => ipcRenderer.invoke(C.viewsDelete, id),
  exportScene: (scene: unknown) => ipcRenderer.invoke(C.sceneExport, scene),
  importScene: () => ipcRenderer.invoke(C.sceneImport),
  lookupAircraft: (q: string) => ipcRenderer.invoke(C.aircraftLookup, q),
  aircraftNear: (lat: number, lon: number, radiusNm: number) => ipcRenderer.invoke(C.aircraftNear, lat, lon, radiusNm),
  aircraftRoute: (callsign: string, lat: number, lon: number) => ipcRenderer.invoke(C.aircraftRoute, callsign, lat, lon),
  vehicleInfo: (q: { kind: 'aircraft' | 'vessel'; hex?: string; registration?: string; imo?: number }) => ipcRenderer.invoke(C.vehicleInfo, q),
  getWatchlist: () => ipcRenderer.invoke(C.watchlistGet),
  setWatchlist: (items: unknown) => ipcRenderer.invoke(C.watchlistSet, items),
  listDocs: (kind: 'boards' | 'people') => ipcRenderer.invoke(C.docsList, kind),
  putDoc: (kind: 'boards' | 'people', doc: unknown) => ipcRenderer.invoke(C.docsPut, kind, doc),
  deleteDoc: (kind: 'boards' | 'people', id: string) => ipcRenderer.invoke(C.docsDelete, kind, id),
  setKiosk: (on: boolean) => ipcRenderer.invoke(C.windowKiosk, on),
  captureScreenshot: () => ipcRenderer.invoke(C.captureScreenshot),
};

contextBridge.exposeInMainWorld('atlas', api);

export type PreloadApi = typeof api;
export const PRELOAD_CHANNELS = C;
