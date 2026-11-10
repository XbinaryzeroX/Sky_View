import type { RouteInfo } from '../../shared/route';
import type { VehicleInfo } from '../../shared/vehicleInfo';
// Typed access to the preload bridge.

import type {
  AiAnswer,
  AiStatus,
  AppSnapshot,
  FeedId,
  FeedStatus,
  HistoryPage,
  HistoryQuery,
  HistoryRecordDetail,
  ImportResult,
  LocationInput,
  SavedLocation,
  Settings,
} from '../../shared/types';
import type { GeoRecord, LayerId, LayerSnapshot, TrackPoint, ViewState } from '../../shared/layers';
import type { ProviderId, ProviderState } from '../../shared/providers';

export interface AtlasApi {
  getState(): Promise<AppSnapshot>;
  onState(cb: (snap: AppSnapshot) => void): () => void;
  createLocation(input: LocationInput): Promise<SavedLocation>;
  updateLocation(id: string, input: LocationInput): Promise<SavedLocation>;
  deleteLocation(id: string): Promise<boolean>;
  importLocations(items: { input: LocationInput; action: 'create' | 'update'; targetId: string | null }[]): Promise<ImportResult>;
  exportLocationsCsv(): Promise<string | null>;
  refresh(feed: FeedId | 'all'): Promise<Record<FeedId, FeedStatus>>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  queryHistory(q: HistoryQuery): Promise<HistoryPage>;
  getHistory(key: string): Promise<HistoryRecordDetail | null>;
  clearHistory(): Promise<number>;
  previewBriefing(ids: string[]): Promise<string>;
  exportBriefing(ids: string[], format: 'html' | 'pdf'): Promise<string | null>;
  aiStatus(): Promise<AiStatus>;
  aiAsk(req: { question: string; locationIds: string[] }): Promise<AiAnswer>;
  openExternal(url: string): Promise<boolean>;
  netStats(): Promise<HostNetStats[]>;
  getLayers(): Promise<LayerSnapshot[]>;
  onLayer(cb: (snap: LayerSnapshot) => void): () => void;
  setView(v: ViewState): Promise<boolean>;
  refreshLayer(id: LayerId): Promise<boolean>;
  trackTrail(layer: LayerId, id: string): Promise<TrackPoint[]>;
  trackRange(): Promise<{ oldest: string | null; newest: string | null; points: number }>;
  trackSnapshot(layer: LayerId, t: string): Promise<(TrackPoint & { rid: string })[]>;
  listProviders(): Promise<ProviderState[]>;
  setProviderCredential(id: ProviderId, value: string | null): Promise<ProviderState[]>;
  testProvider(id: ProviderId): Promise<{ ok: boolean; message: string }>;
  providerBrowserKey(id: 'google3d' | 'esri-imagery' | 'mapbox'): Promise<string | null>;
  geocodeAddress(q: string): Promise<{ label: string; lat: number; lon: number }[]>;
  /** Google Geocoding with the customer's Google key (used while Google 3D Tiles are on; their terms require the Google geocoder). */
  geocodeGoogle(q: string): Promise<{ label: string; lat: number; lon: number }[]>;
  listAnnotations(): Promise<Annotation[]>;
  putAnnotation(a: Annotation): Promise<boolean>;
  deleteAnnotation(id: string): Promise<boolean>;
  listViews(): Promise<SavedView[]>;
  putView(v: SavedView): Promise<boolean>;
  deleteView(id: string): Promise<boolean>;
  exportScene(scene: Scene): Promise<string | null>;
  importScene(): Promise<Scene | null>;
  lookupAircraft(q: string): Promise<GeoRecord[]>;
  aircraftNear(lat: number, lon: number, radiusNm: number): Promise<GeoRecord[]>;
  /** Usual route for a callsign from the adsb.lol route database (not a date-specific flight plan). */
  aircraftRoute(callsign: string, lat: number, lon: number): Promise<RouteInfo | null>;
  vehicleInfo(q: { kind: 'aircraft' | 'vessel'; hex?: string; registration?: string; imo?: number }): Promise<VehicleInfo>;
  getWatchlist(): Promise<WatchItem[]>;
  setWatchlist(items: WatchItem[]): Promise<boolean>;
  listDocs<T = Record<string, unknown>>(kind: 'boards' | 'people'): Promise<T[]>;
  putDoc(kind: 'boards' | 'people', doc: { id: string; createdAt: string; [k: string]: unknown }): Promise<boolean>;
  deleteDoc(kind: 'boards' | 'people', id: string): Promise<boolean>;
  setKiosk(on: boolean): Promise<boolean>;
  captureScreenshot(): Promise<string | null>;
}

export interface WatchItem {
  kind: 'aircraft' | 'vessel';
  id: string;
  label: string;
  addedAt: string;
}

export interface Camera {
  lat: number;
  lon: number;
  heightM: number;
  heading: number;
  pitch: number;
}
export interface Annotation {
  id: string;
  kind: 'pin' | 'line' | 'area';
  name: string;
  color: string;
  points: [number, number][];
  visible: boolean;
  createdAt: string;
}
export interface SavedView {
  id: string;
  name: string;
  camera: Camera;
  basemap: string;
  layersEnabled: LayerId[];
  createdAt: string;
}
export interface Scene {
  format: 'atlas-watch-scene';
  version: 1;
  createdAt: string;
  camera: Camera;
  basemap: Settings['basemap'];
  terrainEnabled: boolean;
  layersEnabled: LayerId[];
  visualMode: Settings['visualMode'];
  annotations: Annotation[];
  views: SavedView[];
}

export interface HostNetStats {
  host: string;
  requests: number;
  ok: number;
  failed: number;
  cancelled: number;
  lastStatus: number | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

declare global {
  interface Window {
    atlas: AtlasApi;
    __atlasSmoke?: Record<string, unknown>;
  }
}

export const api: AtlasApi = window.atlas;

/** Strips Electron's "Error invoking remote method ..." prefix for display. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
