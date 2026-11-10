// IPC contract: channel names and runtime validation of every renderer
// request. The main process rejects anything that does not match.

import { z } from 'zod';
import { validateInstance } from './lemmy';
import { MAX_IMPORT_ROWS, MAX_RADIUS_KM } from './csv';
import { LAYER_IDS, type LayerId } from './layers';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  marketProvider: 'twelvedata',
  marketWatchlist: [],
  lemmyInstance: 'https://lemmy.world',
  lemmyDefaultCommunity: '',
  lemmyShowNsfw: false,
  nwsContact: '',
  nwsPollSeconds: 180,
  usgsPollSeconds: 300,
  quakeWindow: 'week',
  quakeMinMagnitude: 2.5,
  quakesNearLocationsOnly: false,
  historyRetentionDays: 30,
  historyMaxRecords: 5000,
  zoneLookupEnabled: true,
  basemap: 'atlas',
  terrainEnabled: true,
  labelsOverlay: true,
  buildings3d: true,
  units: 'metric',
  smoothMotion: true,
  evenOcean: true,
  buildingFacades: true,
  geoLabels: 'standard',
  streetLabels: true,
  labelDensity: 'medium',
  labelSize: 'medium',
  labelLanguage: 'english',
  aircraftLabels: 'hovered',
  vesselLabels: 'hovered',
  favoriteCameras: [],
  aircraftPhotos: false,
  vehicleModels: true,
  worldAircraft: false,
  renderQuality: 'balanced',
  homeLat: null,
  homeLon: null,
  orgName: '',
  layersEnabled: [],
  firmsRegion: 'us',
  satelliteGroups: ['stations', 'visual'],
  trackRetentionHours: 6,
  radarEnabled: false,
  visualMode: 'normal',
  reducedMotion: false,
  aiEnabled: false,
  ollamaPort: 11434,
  ollamaModel: '',
};

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const layerId = z.enum(LAYER_IDS as [LayerId, ...LayerId[]]);
const recordId = z.string().min(1).max(160);
const lat = z.number().finite().min(-90).max(90);
const lon = z.number().finite().min(-180).max(180);

export const viewStateSchema = z
  .object({
    lat,
    lon,
    heightM: z.number().finite().min(0).max(100_000_000),
    bbox: z.tuple([lon, lat, lon, lat]),
  })
  .strict();

export const cameraSchema = z
  .object({ lat, lon, heightM: z.number().finite().min(1).max(100_000_000), heading: z.number().finite().min(-10).max(10), pitch: z.number().finite().min(-2).max(2) })
  .strict();

export const annotationSchema = z
  .object({
    id,
    kind: z.enum(['pin', 'line', 'area']),
    name: z.string().trim().min(1).max(120),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    points: z.array(z.tuple([lon, lat])).min(1).max(5000),
    visible: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const savedViewSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    camera: cameraSchema,
    basemap: z.string().max(40),
    layersEnabled: z.array(layerId).max(20),
    createdAt: z.string().datetime(),
  })
  .strict();

/** Shareable scene file. Contains no credentials, notes, or saved locations. */
export const sceneSchema = z
  .object({
    format: z.literal('atlas-watch-scene'),
    version: z.literal(1),
    createdAt: z.string().datetime(),
    camera: cameraSchema,
    basemap: z.enum(['atlas', 'streets', 'usgsImageryTopo', 'usgsTopo', 'gibsDaily', 'esri', 'mapbox', 'eox', 'naturalEarth', 'neutral', 'google3d', 'google2d']),
    terrainEnabled: z.boolean(),
    layersEnabled: z.array(layerId).max(20),
    visualMode: z.enum(['normal', 'crt', 'nvg', 'thermal', 'anime', 'noir', 'snow']),
    annotations: z.array(annotationSchema).max(2000),
    views: z.array(savedViewSchema).max(500),
  })
  .strict();

export const watchItemSchema = z
  .object({ kind: z.enum(['aircraft', 'vessel']), id: z.string().min(1).max(40).regex(/^[A-Za-z0-9~_-]+$/), label: z.string().max(80), addedAt: z.string().datetime() })
  .strict();
const docKind = z.enum(['boards', 'people']);

const providerId = z.enum(['twelvedata', 'alphavantage', 'opensky', 'openfreemap', 'esri-imagery', 'mapbox', 'eox', 'ourairports', 'nws', 'usgs-quakes', 'usgs-basemap', 'nasa-gibs', 'terrain-tiles', 'adsblol', 'local-adsb', 'digitraffic', 'aisstream', 'celestrak', 'firms', 'nifc', 'awc', 'nhc', 'nowcoast', 'caltrans', 'fintraffic-cams', 'mbta', 'faa-sua', 'census-geocoder', 'google3d', 'ollama']);

export const locationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).default(''),
  notes: z.string().max(2000).default(''),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().gt(0).max(MAX_RADIUS_KM),
});

export const settingsPatchSchema = z
  .object({
    marketProvider: z.enum(['twelvedata', 'alphavantage']),
    marketWatchlist: z.array(z.string().regex(/^[A-Za-z0-9.:\-/^=]{1,20}$/)).max(50),
    lemmyInstance: z.string().max(253).refine(value => {
      try {
        validateInstance(value);
        return true;
      } catch {
        return false;
      }
    }, 'Invalid Lemmy instance'),
    lemmyDefaultCommunity: z.string().max(150).regex(/^[A-Za-z0-9_.@-]*$/),
    lemmyShowNsfw: z.boolean(),
    // Contact info is optional; restrict to characters that are safe in an HTTP header.
    nwsContact: z.string().max(120).regex(/^[A-Za-z0-9 @._+\-:/()]*$/),
    nwsPollSeconds: z.number().int().min(60).max(3600),
    usgsPollSeconds: z.number().int().min(60).max(3600),
    quakeWindow: z.enum(['hour', 'day', 'week', 'month']),
    quakeMinMagnitude: z.number().finite().min(-1).max(10),
    quakesNearLocationsOnly: z.boolean(),
    historyRetentionDays: z.number().int().min(1).max(365),
    historyMaxRecords: z.number().int().min(100).max(50000),
    zoneLookupEnabled: z.boolean(),
    basemap: z.enum(['atlas', 'streets', 'usgsImageryTopo', 'usgsTopo', 'gibsDaily', 'esri', 'mapbox', 'eox', 'naturalEarth', 'neutral', 'google3d', 'google2d']),
    terrainEnabled: z.boolean(),
    labelsOverlay: z.boolean(),
    buildings3d: z.boolean(),
    units: z.enum(['metric', 'imperial', 'nautical']),
    smoothMotion: z.boolean(),
    evenOcean: z.boolean(),
    buildingFacades: z.boolean(),
    geoLabels: z.enum(['off', 'minimal', 'standard', 'detailed']),
    streetLabels: z.boolean(),
    labelDensity: z.enum(['low', 'medium', 'high']),
    labelSize: z.enum(['small', 'medium', 'large']),
    labelLanguage: z.enum(['english', 'local']),
    aircraftLabels: z.enum(['selected', 'hovered', 'all']),
    vesselLabels: z.enum(['selected', 'hovered', 'all']),
    favoriteCameras: z.array(z.string().max(80)).max(500),
    aircraftPhotos: z.boolean(),
    vehicleModels: z.boolean(),
    worldAircraft: z.boolean(),
    renderQuality: z.enum(['balanced', 'maximum']),
    homeLat: z.number().finite().min(-90).max(90).nullable(),
    homeLon: z.number().finite().min(-180).max(180).nullable(),
    orgName: z.string().max(120),
    layersEnabled: z.array(z.enum(LAYER_IDS as [LayerId, ...LayerId[]])).max(20),
    firmsRegion: z.enum(['us', 'global']),
    satelliteGroups: z.array(z.enum(['stations', 'visual', 'gnss', 'weather', 'science', 'starlink'])).max(6),
    trackRetentionHours: z.number().int().min(1).max(72),
    radarEnabled: z.boolean(),
    visualMode: z.enum(['normal', 'crt', 'nvg', 'thermal', 'anime', 'noir', 'snow']),
    reducedMotion: z.boolean(),
    aiEnabled: z.boolean(),
    ollamaPort: z.number().int().min(1).max(65535),
    ollamaModel: z.string().max(200).regex(/^[A-Za-z0-9._:\/-]*$/),
  })
  .partial()
  .strict();

export const historyQuerySchema = z
  .object({
    text: z.string().max(200).optional(),
    kind: z.enum(['alert', 'quake', 'all']).optional(),
    severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown', 'all']).optional(),
    minMagnitude: z.number().finite().min(-2).max(11).nullable().optional(),
    since: z.string().datetime().nullable().optional(),
    includeSuperseded: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const IPC = {
  marketsSearch: 'markets:search',
  marketsQuote: 'markets:quote',
  marketsCandles: 'markets:candles',
  marketsNews: 'markets:news',
  marketsExplain: 'markets:explain',
  lemmyStatus: 'lemmy:status',
  lemmyLogin: 'lemmy:login',
  lemmyLogout: 'lemmy:logout',
  lemmyFeed: 'lemmy:feed',
  lemmyPost: 'lemmy:post',
  lemmyCommunities: 'lemmy:communities',
  lemmyWrite: 'lemmy:write',
  lemmyImage: 'lemmy:image',
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

/** Argument schemas per invoke channel (tuple of positional arguments). */
const symbol = z.string().regex(/^[A-Za-z0-9.:\-/^=]{1,20}$/);
const positiveId = z.number().int().positive();
export const lemmyWriteSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('post'),
    community_id: positiveId,
    name: z.string().trim().min(1).max(200),
    body: z.string().max(10000),
    url: z.string().max(2048).refine(value => !value || /^https?:\/\//.test(value)),
    nsfw: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal('comment'),
    post_id: positiveId,
    parent_id: positiveId.optional(),
    content: z.string().trim().min(1).max(10000),
  }).strict(),
  ...(['post', 'comment'] as const).map(kind => z.object({
    action: z.literal(kind + '/like'),
    id: positiveId,
    score: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }).strict()),
  ...(['post', 'comment'] as const).map(kind => z.object({
    action: z.literal(kind + '/report'),
    id: positiveId,
    reason: z.string().trim().min(1).max(1000),
  }).strict()),
  z.object({ action: z.literal('user/block'), person_id: positiveId, block: z.literal(true) }).strict(),
  z.object({ action: z.literal('community/block'), community_id: positiveId, block: z.literal(true) }).strict(),
  z.object({ action: z.literal('community/follow'), community_id: positiveId, follow: z.boolean() }).strict(),
]);

export const ipcArgSchemas = {
  [IPC.marketsSearch]: z.tuple([z.string().trim().min(1).max(80)]),
  [IPC.marketsQuote]: z.tuple([symbol]),
  [IPC.marketsCandles]: z.tuple([symbol, z.enum(['1D', '5D', '1M', '6M', '1Y', '5Y'])]),
  [IPC.marketsNews]: z.tuple([symbol, z.string().max(200).nullable()]),
  [IPC.marketsExplain]: z.tuple([symbol, z.array(z.string().max(300)).max(25), z.string().max(1500)]),
  [IPC.lemmyStatus]: z.tuple([]),
  [IPC.lemmyLogin]: z.tuple([z.object({
    username_or_email: z.string().min(1).max(200),
    password: z.string().min(1).max(1000),
    totp_2fa_token: z.string().regex(/^\d{6}$/).optional(),
  }).strict()]),
  [IPC.lemmyLogout]: z.tuple([]),
  [IPC.lemmyFeed]: z.tuple([z.object({
    type_: z.enum(['All', 'Local', 'Subscribed']),
    sort: z.enum(['Active', 'Hot', 'New', 'TopDay', 'TopWeek']),
    page: z.number().int().min(1).max(10000),
    community_name: z.string().max(150).regex(/^[A-Za-z0-9_.@-]*$/),
  }).strict()]),
  [IPC.lemmyPost]: z.tuple([positiveId]),
  [IPC.lemmyCommunities]: z.tuple([z.string().max(150)]),
  [IPC.lemmyWrite]: z.tuple([lemmyWriteSchema]),
  [IPC.lemmyImage]: z.tuple([z.string().url().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port;
    } catch {
      return false;
    }
  }, 'HTTPS image URL required')]),
  [IPC.stateGet]: z.tuple([]),
  [IPC.locationCreate]: z.tuple([locationInputSchema]),
  [IPC.locationUpdate]: z.tuple([id, locationInputSchema]),
  [IPC.locationDelete]: z.tuple([id]),
  [IPC.locationImport]: z.tuple([
    z
      .array(
        z.object({
          input: locationInputSchema,
          action: z.enum(['create', 'update']),
          targetId: id.nullable(),
        }),
      )
      .max(MAX_IMPORT_ROWS),
  ]),
  [IPC.locationExportCsv]: z.tuple([]),
  [IPC.feedsRefresh]: z.tuple([z.enum(['nws', 'usgs', 'all'])]),
  [IPC.settingsUpdate]: z.tuple([settingsPatchSchema]),
  [IPC.historyQuery]: z.tuple([historyQuerySchema]),
  [IPC.historyGet]: z.tuple([z.string().min(3).max(320)]),
  [IPC.historyClear]: z.tuple([]),
  [IPC.briefingPreview]: z.tuple([z.array(id).max(5000)]),
  [IPC.briefingExport]: z.tuple([z.array(id).min(1).max(5000), z.enum(['html', 'pdf'])]),
  [IPC.aiStatus]: z.tuple([]),
  [IPC.aiAsk]: z.tuple([
    z
      .object({
        question: z.string().trim().min(1).max(1000),
        locationIds: z.array(id).max(200),
      })
      .strict(),
  ]),
  [IPC.openExternal]: z.tuple([z.string().max(2048)]),
  [IPC.diagNetStats]: z.tuple([]),
  [IPC.layersGet]: z.tuple([]),
  [IPC.layersSetView]: z.tuple([viewStateSchema]),
  [IPC.layersRefresh]: z.tuple([layerId]),
  [IPC.tracksTrail]: z.tuple([layerId, recordId]),
  [IPC.tracksRange]: z.tuple([]),
  [IPC.tracksSnapshot]: z.tuple([layerId, z.string().datetime()]),
  [IPC.providersList]: z.tuple([]),
  [IPC.providersSetCredential]: z.tuple([providerId, z.string().max(500).nullable()]),
  [IPC.providersTest]: z.tuple([providerId]),
  [IPC.providersBrowserKey]: z.tuple([z.enum(['google3d', 'google2d', 'esri-imagery', 'mapbox'])]),
  [IPC.geocodeAddress]: z.tuple([z.string().trim().min(3).max(200)]),
  [IPC.geocodeGoogle]: z.tuple([z.string().trim().min(2).max(200)]),
  [IPC.annotationsList]: z.tuple([]),
  [IPC.annotationsPut]: z.tuple([annotationSchema]),
  [IPC.annotationsDelete]: z.tuple([id]),
  [IPC.viewsList]: z.tuple([]),
  [IPC.viewsPut]: z.tuple([savedViewSchema]),
  [IPC.viewsDelete]: z.tuple([id]),
  [IPC.sceneExport]: z.tuple([sceneSchema]),
  [IPC.sceneImport]: z.tuple([]),
  [IPC.aircraftLookup]: z.tuple([z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/)]),
  [IPC.aircraftNear]: z.tuple([lat, lon, z.number().int().min(1).max(100)]),
  [IPC.vehicleInfo]: z.tuple([
    z.object({
      kind: z.enum(['aircraft', 'vessel']),
      hex: z.string().regex(/^[0-9a-f]{6}$/).optional(),
      registration: z.string().trim().max(12).regex(/^[A-Z0-9-]+$/).optional(),
      imo: z.number().int().min(1000000).max(9999999).optional(),
    }),
  ]),
  [IPC.aircraftRoute]: z.tuple([z.string().trim().min(2).max(8).regex(/^[A-Z0-9]+$/), lat, lon]),
  [IPC.watchlistGet]: z.tuple([]),
  [IPC.watchlistSet]: z.tuple([z.array(watchItemSchema).max(500)]),
  [IPC.docsList]: z.tuple([docKind]),
  [IPC.docsPut]: z.tuple([docKind, z.object({ id, createdAt: z.string().datetime() }).passthrough().refine((d) => JSON.stringify(d).length <= 100_000, 'Document too large')]),
  [IPC.docsDelete]: z.tuple([docKind, id]),
  [IPC.windowKiosk]: z.tuple([z.boolean()]),
  [IPC.captureScreenshot]: z.tuple([]),
} as const;

export type InvokeChannel = keyof typeof ipcArgSchemas;

export class IpcValidationError extends Error {
  constructor(channel: string, detail: string) {
    super(`Invalid arguments for ${channel}: ${detail}`);
    this.name = 'IpcValidationError';
  }
}

/** Validates raw IPC arguments for a channel. Throws IpcValidationError on failure. */
export function validateIpcArgs<C extends InvokeChannel>(channel: C, args: unknown[]): z.infer<(typeof ipcArgSchemas)[C]> {
  const schema = ipcArgSchemas[channel];
  if (!schema) throw new IpcValidationError(String(channel), 'unknown channel');
  const res = schema.safeParse(args);
  if (!res.success) {
    const first = res.error.issues[0];
    throw new IpcValidationError(channel, `${first?.path.join('.') || '(root)'}: ${first?.message ?? 'invalid'}`);
  }
  return res.data as z.infer<(typeof ipcArgSchemas)[C]>;
}

export function isInvokeChannel(c: unknown): c is InvokeChannel {
  return typeof c === 'string' && Object.prototype.hasOwnProperty.call(ipcArgSchemas, c);
}
