// Typed access to the preload bridge.

import type { Candle, Quote, SymbolMatch, MarketResult, MarketRange, Headline, TrendingMarkets } from '../../shared/markets';
import type { LemmyPost, LemmyComment, LemmyCommunity } from '../../shared/lemmy';
import type { z } from 'zod';
import type { lemmyWriteSchema } from '../../shared/ipc';
import type { Scene as SharedScene, SavedView as SharedSavedView, AppliedScene, RestoredView } from '../../shared/ipc';
import type { BriefingExportRequest, BriefingPreview, BriefingRequest } from '../../shared/briefing';
import type { RouteInfo } from '../../shared/route';
import type { DatedFlightStatus } from '../../shared/flightStatus';
import type { VehicleInfo } from '../../shared/vehicleInfo';
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
import type { GeoJsonFilePreview, GeoJsonImportResult } from '../../shared/geojsonAnnotations';
import type { AreaWatchRuleInput } from '../../shared/areaWatch';
import type { TimelineRange, TimelineFrame } from '../../shared/timeline';
import type { ConflictSnapshot } from '../../shared/conflictReports';
import type { ConflictAssessments } from '../../shared/conflictAssessments';

export interface AtlasApi {
  conflictReports(): Promise<ConflictSnapshot>;
  conflictAssessments(): Promise<ConflictAssessments>;
  timelineRange(): Promise<TimelineRange>;
  timelineFrame(t: string): Promise<TimelineFrame>;
  marketsTrending(): Promise<TrendingMarkets>;
  marketsSearch(q: string): Promise<MarketResult<SymbolMatch[]>>;
  marketsQuote(s: string): Promise<MarketResult<Quote>>;
  marketsCandles(symbol: string, range: MarketRange): Promise<MarketResult<Candle[]>>;
  marketsNews(symbol: string, name: string | null, selection?: 'trending'): Promise<{ articles: Headline[]; fetchedAt: string; source: string }>;
  marketsExplain(symbol: string, headlines: string[], movement: string): Promise<string>;
  lemmyStatus(): Promise<{ signedIn: boolean; name: string | null }>;
  lemmyLogin(input: { username_or_email: string; password: string; totp_2fa_token?: string }): Promise<boolean>;
  lemmyLogout(): Promise<boolean>;
  lemmyFeed(query: {
    type_: 'All' | 'Local' | 'Subscribed';
    sort: 'Active' | 'Hot' | 'New' | 'TopDay' | 'TopWeek';
    page: number;
    community_name: string;
  }): Promise<{ posts: LemmyPost[]; hasMore: boolean }>;
  lemmyPost(id: number): Promise<{ post: LemmyPost | null; comments: LemmyComment[] }>;
  lemmyCommunities(query: string): Promise<LemmyCommunity[]>;
  lemmyWrite(input: z.infer<typeof lemmyWriteSchema>): Promise<boolean>;
  lemmyImage(url: string): Promise<string>;

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
  previewBriefing(request: BriefingRequest): Promise<BriefingPreview>;
  exportBriefing(request: string[] | BriefingExportRequest, format: 'html' | 'pdf'): Promise<string | null>;
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
  providerBrowserKey(id: 'google3d' | 'google2d' | 'esri-imagery' | 'mapbox'): Promise<string | null>;
  geocodeAddress(q: string): Promise<{ label: string; lat: number; lon: number }[]>;
  /** Google Geocoding with the customer's Google key (used while Google 3D Tiles are on; their terms require the Google geocoder). */
  geocodeGoogle(q: string): Promise<{ label: string; lat: number; lon: number }[]>;
  listAnnotations(): Promise<Annotation[]>;
  putAnnotation(a: Annotation): Promise<boolean>;
  deleteAnnotation(id: string): Promise<boolean>;
  previewAnnotationsGeoJson(): Promise<GeoJsonFilePreview | null>;
  importAnnotationsGeoJson(text: string): Promise<GeoJsonImportResult>;
  exportAnnotationsGeoJson(): Promise<string | null>;
  putAreaWatch(rule: AreaWatchRuleInput): Promise<void>;
  deleteAreaWatch(areaId: string): Promise<void>;
  readAreaWatchEvents(ids: string[]): Promise<void>;
  listViews(): Promise<SavedView[]>;
  putView(v: SavedView): Promise<boolean>;
  deleteView(id: string): Promise<boolean>;
  exportScene(scene: Scene): Promise<string | null>;
  importScene(): Promise<Scene | null>;
  applyScene(scene: Scene, allowMeteredBasemap?: boolean): Promise<AppliedScene>;
  restoreView(id: string, allowMeteredBasemap?: boolean): Promise<RestoredView>;
  lookupAircraft(q: string): Promise<GeoRecord[]>;
  aircraftNear(lat: number, lon: number, radiusNm: number): Promise<GeoRecord[]>;
  /** Usual route for a callsign from the adsb.lol route database (not a date-specific flight plan). */
  aircraftRoute(callsign: string, lat: number, lon: number): Promise<RouteInfo | null>;
  airlineFlightStatus(recordId: string, callsign: string): Promise<DatedFlightStatus | null>;
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
export type SavedView = SharedSavedView;
export type Scene = SharedScene;

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
