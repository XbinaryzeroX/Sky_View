import { FileText, KeyRound, Settings as SettingsIcon, Bell } from 'lucide-react';
import { EarthLightingPanel } from './components/EarthLightingPanel';
import { loadEarthLighting, type EarthLighting } from './map/earthLighting';
import { FloatingMapControls, FloatingPanel, type LeftMapPanel } from './components/FloatingMapControls';
import { clampDate, gibsProduct, imageryDates, type ImageryState } from './map/imageryOverlay';
import type { RouteInfo } from '../shared/route';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { describeFeedDiff, isAlertCountable, supersededAlertIds } from '../shared/dedupe';
import { monitoringEvidence, severityRank } from '../shared/monitoring';
import { replayDisplayRecords } from '../shared/timeline';
import type { AlertSeverity, AppSnapshot, SavedLocation, Settings } from '../shared/types';
import type { AreaWatchEvent } from '../shared/areaWatch';
import { AiDialog } from './components/AiDialog';
import { BriefingDialog } from './components/BriefingDialog';
import { FreshnessChip, Modal } from './components/common';
import { CsvImportDialog } from './components/CsvImportDialog';
import { DetailsPanel, ReplayDetails, type ReplaySelection, type Selection } from './components/DetailsPanel';
import { Globe, type GlobeHandle, type GlobeLayers, type GlobeSelection } from './components/Globe';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { Hud } from './components/Hud';
import { LayersPanel } from './components/LayersPanel';
import { archiveImage, archiveYears } from '../shared/satelliteYears';
import { archiveCaption, archiveProduct } from './map/historicalImagery';
import { PlaybackBar } from './components/PlaybackBar';
import { ProvidersDialog } from './components/ProvidersDialog';
import { RecordDetails } from './components/RecordDetails';
import { TrackingControls } from './components/TrackingControls';
import type { TrackingMode } from '../shared/trackingCamera';
import { SearchBox } from './components/SearchBox';
import { placeSearchMode } from '../shared/geocoding';
import { ToolsPanel, measurementText } from './components/ToolsPanel';
import { AIRPORTS, NAV, PageView, type PageCtx, type PageId } from './components/Pages';
import { TrafficBar } from './components/TrafficBar';
import { DEFAULT_AIRCRAFT_FILTER, specialCode, type AircraftFilter } from '../shared/aircraft';
import type { SearchResult } from './components/SearchBox';
import type { WatchItem } from './lib/api';
import type { PlaybackFrame, ToolMode } from './components/Globe';
import type { LayerId, LayerSnapshot } from '../shared/layers';
import type { Annotation, Camera, SavedView } from './lib/api';
import type { Investigation } from '../shared/investigation';
import { useScenes } from './lib/useScenes';
import { HistoryDrawer } from './components/HistoryDrawer';
import { LeftPanel } from './components/LeftPanel';
import { LocationForm } from './components/LocationForm';
import { SettingsDialog } from './components/SettingsDialog';
import { ModelCredits } from './components/ModelCredits';
import type { TrailPoint } from './map/trailHeights';
import { api, errorText } from './lib/api';
import { localTime, quakeClass, SEVERITY_META, SEVERITY_ORDER } from './lib/format';

const BASEMAP_CREDIT: Record<string, string> = {
  atlas: 'ESA Ocean Colour CCI and Terra MODIS (2021), ESA WorldCover Sentinel-2 (2021), NASA Blue Marble land (2004), USGS aerial imagery',
  usgsImageryTopo: 'USGS orthoimagery + US Topo (U.S.), NASA Blue Marble elsewhere; not live',
  usgsTopo: 'USGS topographic map (U.S.), NASA Blue Marble elsewhere',
  gibsDaily: 'NASA VIIRS NOAA-20 true color, previous UTC day (GIBS)',
  naturalEarth: 'Natural Earth II relief (bundled, offline, low resolution)',
  neutral: 'neutral',
  streets: '© OpenStreetMap contributors (ODbL), © OpenMapTiles, OpenFreeMap',
  esri: 'Esri World Imagery (Esri, Maxar, Earthstar Geographics) via your ArcGIS key; not live',
  mapbox: '© Mapbox © Maxar via your token; not live',
  eox: 'EOxCloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), your license',
  google3d: 'Google Photorealistic 3D and Atlas satellite imagery (ESA Ocean Colour CCI, WorldCover, NASA and USGS)',
  google2d: 'Google satellite imagery (Google Maps Platform)',
};

type Dialog = { kind: 'providers' } | { kind: 'import' } | { kind: 'settings' } | { kind: 'briefing'; ids: string[]; mode?: 'visit' | 'locations' } | { kind: 'ai' } | { kind: 'delete'; loc: SavedLocation } | null;

export function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null);
  useEffect(() => {
    const onLinkError = (event: Event) => setToast(String((event as CustomEvent).detail));
    window.addEventListener('atlas-link-error', onLinkError);
    return () => window.removeEventListener('atlas-link-error', onLinkError);
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [layers, setLayers] = useState<GlobeLayers>({ alerts: true, quakes: true, locations: true, radii: true, boundaries: true });
  const [severityFilter, setSeverityFilter] = useState<Set<AlertSeverity>>(new Set(SEVERITY_ORDER));
  const [alertsAffectingOnly, setAlertsAffectingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<{ existing: SavedLocation | null } | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [layerSnaps, setLayerSnaps] = useState<Partial<Record<LayerId, LayerSnapshot>>>({});
  const [recordSel, setRecordSel] = useState<{ layer: LayerId; id: string } | null>(null);
  const selectCoreSelection = useCallback((next: Selection | null) => {
    setRecordSel(null);
    setSelection(next);
  }, []);
  const [tracked, setTracked] = useState<{ layer: LayerId; id: string } | null>(null);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('follow');
  const [passengerSeat, setPassengerSeat] = useState('1F');
  const [interiorStatus, setInteriorStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [trail, setTrail] = useState<TrailPoint[] | null>(null);
  const [orbitFor, setOrbitFor] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>('none');
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [leftFloat, setLeftFloat] = useState<LeftMapPanel>('layers');
  const [lighting, setLighting] = useState<EarthLighting>(loadEarthLighting);
  useEffect(() => {
    try { localStorage.setItem('atlas.earthLighting', JSON.stringify(lighting)); } catch { /* Session lighting still works. */ }
  }, [lighting]);
  const [dataOpen, setDataOpen] = useState(false);
  const [hudOn, setHudOn] = useState(true);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [playbackMenu, setPlaybackMenu] = useState(false);
  const floatingStack = useRef<string[]>([]);
  const toggleLeft = (panel: LeftMapPanel) => {
    if (playbackOn && panel !== 'scenes' && panel !== 'lighting') exitPlayback();
    setDiagOpen(false);
    setHistoryOpen(false);
    setCreditsOpen(false);
    if (panel === 'scenes') setToolsOpen(false);
    setPage('globe');
    setLeftFloat(current => current === panel ? null : panel);
  };
  const [playbackOn, setPlaybackOn] = useState(false);
  const [rawPlaybackFrame, setPlaybackFrame] = useState<PlaybackFrame | null>(null);
  const playbackFrame = useMemo(() => rawPlaybackFrame && ({
    ...rawPlaybackFrame,
    nws: { ...rawPlaybackFrame.nws, records: replayDisplayRecords(rawPlaybackFrame.nws.records, a => a.sent) },
    usgs: { ...rawPlaybackFrame.usgs, records: replayDisplayRecords(rawPlaybackFrame.usgs.records, q => q.updated) },
  }), [rawPlaybackFrame]);
  const [initialCursor, setInitialCursor] = useState<string | null>(null);
  const [replaySession, setReplaySession] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [replayQuery, setReplayQuery] = useState<Pick<Settings, 'quakeWindow' | 'quakeMinMagnitude'> | null>(null);
  const restoredSelection = useRef<Selection | null>(null);
  const userCameraRestore = useRef(false);
  const [replaySelection, setReplaySelection] = useState<ReplaySelection | null>(null);
  const [google3dKey, setGoogle3dKey] = useState<string | null>(null);
  // Bumped when the Google credential changes in Providers, so the active Photoreal tileset is rebuilt with the newly resolved key.
  const [google3dKeyVersion, setGoogle3dKeyVersion] = useState(0);
  const loadedGoogleVersion = useRef<number | null>(null);
  const [routeLine, setRouteLine] = useState<RouteInfo | null>(null);
  const [imagery, setImagery] = useState<ImageryState>(() => {
    const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    return { product: null, date: y, compare: false, compareDate: new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10), opacity: 1, split: 0.5 };
  });
  const [imageryKeys, setImageryKeys] = useState<{ esri: string | null; mapbox: string | null; google: string | null }>({ esri: null, mapbox: null, google: null });
  const [preserveImageryDates, setPreserveImageryDates] = useState(false);
  const catalogRevision = useSyncExternalStore(imageryDates.subscribe, imageryDates.revision);
  const selectedYear = snap?.settings.imageryYear ?? null;
  const archiveDomain = imageryDates.snapshot(archiveProduct).data;
  const archived = useMemo(() => selectedYear === null ? null : archiveImage(selectedYear, archiveDomain), [selectedYear, archiveDomain]);
  const years = useMemo(() => archiveYears(archiveDomain), [archiveDomain]);
  useEffect(() => {
    if (selectedYear !== null) void imageryDates.load(archiveProduct).catch(() => {});
  }, [selectedYear]);
  const unavailableImageryDates = useMemo(() => {
    const product = preserveImageryDates && gibsProduct(imagery.product);
    if (!product) return [];
    const dates = imagery.compare ? [imagery.date, imagery.compareDate] : [imagery.date];
    return [...new Set(dates.filter(date => !date || clampDate(product, date) !== date))];
  }, [imagery, preserveImageryDates, catalogRevision]);
  useEffect(() => {
    const product = preserveImageryDates && !playbackOn && gibsProduct(imagery.product);
    if (product) void imageryDates.load(product).catch(() => {});
  }, [imagery.product, preserveImageryDates, playbackOn]);
  const changeImagery = (next: ImageryState) => {
    if (next.product !== imagery.product || next.date !== imagery.date || next.compareDate !== imagery.compareDate) setPreserveImageryDates(false);
    setImagery(next);
  };
  const [googleConfigured, setGoogleConfigured] = useState(false);
  // Satellite (Google 2D) and Google geocoding need the user's own key; the included key covers Photoreal 3D only.
  const [googleOwnKey, setGoogleOwnKey] = useState(false);
  const [eoxLicensed, setEoxLicensed] = useState(false);
  const [page, setPage] = useState<PageId>('globe');
  const widePage = NAV.find((entry) => entry.id === page)?.wide === true;

  const [airportSel, setAirportSel] = useState<string | null>(null);
  const [aircraftFilter, setAircraftFilter] = useState<AircraftFilter>(DEFAULT_AIRCRAFT_FILTER);
  const [vesselClasses, setVesselClasses] = useState<string[]>(['cargo', 'tanker', 'passenger', 'fishing', 'other']);
  const [showAirports, setShowAirports] = useState(true);
  const [sceneMode, setSceneMode] = useState<'3d' | '2d'>('3d');
  useEffect(() => { if (sceneMode !== '3d' || playbackOn) setTrackingMode('follow'); }, [sceneMode, playbackOn]);
  const [watchlist, setWatchlistState] = useState<WatchItem[]>([]);
  const [kiosk, setKiosk] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [areaMatchLimit, setAreaMatchLimit] = useState(20);
  const lastViewRef = useRef<{ lat: number; lon: number; bbox: [number, number, number, number] } | null>(null);
  useEffect(() => {
    void api.getWatchlist().then(setWatchlistState);
  }, []);
  useEffect(() => {
    if (!kiosk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setKiosk(false);
        void api.setKiosk(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kiosk]);
  const setWatchlist = useCallback((items: WatchItem[]) => {
    setWatchlistState(items);
    void api.setWatchlist(items);
  }, []);
  const layerSnapsRef = useRef(layerSnaps);
  layerSnapsRef.current = layerSnaps;
  useEffect(() => {
    if (selection && restoredSelection.current === selection && !recordSel) { restoredSelection.current = null; return; }
    if (selection || recordSel) { setDataOpen(true); setToolsOpen(false); setKeyboardOpen(false); }
  }, [selection, recordSel]);
  useEffect(() => { if (diagOpen) { setLeftFloat(null); setPage('globe'); setHistoryOpen(false); } }, [diagOpen]);
  // Any page other than the Globe opens in the left floating slot, so close the overlays that share it.
  useEffect(() => {
    if (page !== 'globe') {
      setDiagOpen(false);
      setCreditsOpen(false);
    }
  }, [page]);
  const exitPlayback = () => {
    setPlaybackOn(false);
    setPlaybackFrame(null);
    setReplaySelection(null);
    setInitialCursor(null);
    setCursor(null);
    setReplayQuery(null);
    setDataOpen(false);
  };
  const startPlayback = (cursor: string | null = null, selected: ReplaySelection | null = null,
    savedQuery?: Pick<Settings, 'quakeWindow' | 'quakeMinMagnitude'>) => {
    setInitialCursor(cursor);
    setCursor(cursor);
    setReplaySession(n => n + 1);
    setReplayQuery(savedQuery ?? (snap ? { quakeWindow: snap.settings.quakeWindow, quakeMinMagnitude: snap.settings.quakeMinMagnitude } : null));
    setPlaybackFrame(null);
    setReplaySelection(selected);
    setPlaybackOn(true);
    setPage('globe');
    setLeftFloat(null);
    setDataOpen(!!selected);
    setToolsOpen(false);
    setDiagOpen(false);
    setPlaybackMenu(false);
    setBellOpen(false);
    setHistoryOpen(false);
    setPickMode(false);
    setTool('none');
  };
  useEffect(() => {
    if (page !== 'globe' && playbackOn) exitPlayback();
  }, [page, playbackOn]);
  useEffect(() => {
    const open = [leftFloat, dataOpen && 'data', toolsOpen && 'tools', diagOpen && 'diagnostics',
      creditsOpen && 'credits', keyboardOpen && 'keyboard', playbackMenu && 'playback-menu', historyOpen && 'history',
      page !== 'globe' && !widePage && 'page', bellOpen && 'notifications'].filter((value): value is string => typeof value === 'string');
    floatingStack.current = [...floatingStack.current.filter(key => open.includes(key)), ...open.filter(key => !floatingStack.current.includes(key))];
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog || form || widePage || !floatingStack.current.length) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const top = floatingStack.current.at(-1);
      if (top === 'notifications') setBellOpen(false);
      else if (top === 'data') setDataOpen(false);
      else if (top === 'tools') { setToolsOpen(false); setTool('none'); setDraft([]); }
      else if (top === 'diagnostics') setDiagOpen(false);
      else if (top === 'credits') setCreditsOpen(false);
      else if (top === 'keyboard') setKeyboardOpen(false);
      else if (top === 'playback-menu') setPlaybackMenu(false);
      else if (top === 'history') setHistoryOpen(false);
      else if (top === 'page') setPage('globe');
      else setLeftFloat(null);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [leftFloat, dataOpen, toolsOpen, diagOpen, creditsOpen, keyboardOpen, playbackMenu, historyOpen, page, widePage, dialog, form, bellOpen]);
  const getDiag = useCallback(() => globeRef.current?.getDiagnostics() ?? null, []);
  const getHeading = useCallback(() => globeRef.current?.getCamera()?.heading ?? null, []);
  useEffect(() => {
    // Main-thread blocking (tasks over 50 ms), read by the performance smoke test.
    try {
      const lt = { count: 0, totalMs: 0, maxMs: 0 };
      (window as unknown as { __atlasLongTasks: unknown }).__atlasLongTasks = lt;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          lt.count++;
          lt.totalMs = Math.round(lt.totalMs + e.duration);
          lt.maxMs = Math.max(lt.maxMs, Math.round(e.duration));
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // longtask timing unavailable
    }
    // Renderer-only camera hooks used by automated smoke tests (no privileged access).
    (window as unknown as { __atlasDebug: unknown }).__atlasDebug = {
      setView: (lat: number, lon: number, h: number, pitch?: number) => globeRef.current?.setView(lat, lon, h, pitch),
      setWaterEffect: (enabled: boolean) => globeRef.current?.setWaterEffect(enabled),
      diag: () => globeRef.current?.getDiagnostics() ?? null,
      replayMap: (kind?: 'alert' | 'quake', id?: string) => globeRef.current?.replayMap(kind, id) ?? null,
      camera: () => globeRef.current?.getCamera() ?? null,
      viewCenter: () => globeRef.current?.getMapCenter() ?? null,
      setSceneMode: (m: '2d' | '3d') => setSceneMode(m),
      setPage: (p: PageId) => setPage(p),
      setImagery: (s: Partial<ImageryState>) => setImagery((x) => ({ ...x, ...s })),
      select: (layer: LayerId, id: string) => setRecordSel({ layer, id }),
      track: (layer: LayerId, id: string) => setTracked({ layer, id }),
      trackingMode: (mode: TrackingMode) => setTrackingMode(mode),
      stopTracking: () => { setTracked(null); setTrackingMode('follow'); },
      records: (layer: LayerId) => (layerSnapsRef.current[layer]?.records ?? []).slice(0, 2000).map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, label: r.label, imageUrl: r.imageUrl ?? null, heading: r.heading, type: typeof r.props.type === 'string' ? r.props.type : null, shipType: typeof r.props.shipType === 'number' ? r.props.shipType : null, onGround: r.props.onGround === true })),
    };
  }, []);
  const globeRef = useRef<GlobeHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const smoke = useRef<Record<string, unknown>>({ globeReady: false, errors: [] as string[] });

  useEffect(() => {
    let mounted = true;
    let receivedUpdate = false;
    const unsub = api.onState((state) => {
      receivedUpdate = true;
      setLoadError(null);
      setSnap(state);
    });
    void api.getState().then((state) => {
      if (mounted && !receivedUpdate) setSnap(state);
    }).catch((error) => {
      if (mounted && !receivedUpdate) setLoadError(errorText(error));
    });
    const onErr = (e: ErrorEvent) => (smoke.current.errors as string[]).push(e.message);
    window.addEventListener('error', onErr);
    return () => {
      mounted = false;
      unsub();
      window.removeEventListener('error', onErr);
    };
  }, []);

  useEffect(() => {
    let unsub = () => {};
    void api.getLayers().then((list) => {
      const m: Partial<Record<LayerId, LayerSnapshot>> = {};
      for (const l of list) m[l.status.id] = l;
      setLayerSnaps(m);
      unsub = api.onLayer((l) => setLayerSnaps((prev) => ({ ...prev, [l.status.id]: l })));
    });
    void api.listAnnotations().then(setAnnotations);
    void api.listViews().then(setViews);
    return () => unsub();
  }, []);

  // Recorded trail for the tracked object, refreshed as new fixes arrive.
  useEffect(() => {
    if (!tracked || tracked.layer === 'satellites') {
      setTrail(null);
      return;
    }
    let current = true;
    void api.trackTrail(tracked.layer, tracked.id).then(pts => {
      if (current) setTrail(pts.map(p => ({ lat: p.lat, lon: p.lon, altM: p.altM, onGround: p.onGround ?? null })));
    }).catch(error => { if (current) { setTrail(null); setToast(errorText(error)); } });
    return () => { current = false; };
  }, [tracked, tracked ? layerSnaps[tracked.layer]?.status.lastSuccessAt : null]);

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail === 'google3d') {
        loadedGoogleVersion.current = null;
        setGoogle3dKey(null);
        setGoogle3dKeyVersion((v) => v + 1);
      }
    };
    window.addEventListener('atlas-providers-changed', onChange);
    return () => window.removeEventListener('atlas-providers-changed', onChange);
  }, []);

  // Google Photorealistic 3D: only when chosen, with the user's key or the included key (one allowance per request).
  const photorealParked = selectedYear !== null || lighting.mode !== 'day';
  useEffect(() => {
    if (snap?.settings.basemap !== ('google3d' as never)) {
      setGoogle3dKey(null);
      loadedGoogleVersion.current = null;
      return;
    }
    if (photorealParked || loadedGoogleVersion.current === google3dKeyVersion) return;
    let current = true;
    void api.providerBrowserKey('google3d').then((k) => {
      if (!current) return;
      if (k) loadedGoogleVersion.current = google3dKeyVersion;
      setGoogle3dKey(k);
      if (!k) setToast('Google Photorealistic 3D needs an included or saved Google Maps key in Providers.');
    }).catch(error => {
      if (!current) return;
      setGoogle3dKey(null);
      setToast(errorText(error));
    });
    return () => { current = false; };
  }, [snap?.settings.basemap, photorealParked, google3dKeyVersion]);

  // Customer imagery credentials are fetched only when the chosen surface needs them (and again after Provider settings closes).
  useEffect(() => {
    const b = selectedYear === null ? snap?.settings.basemap : undefined;
    let current = true;
    void (async () => {
      const esri = b === 'esri' ? await api.providerBrowserKey('esri-imagery') : null;
      const mapbox = b === 'mapbox' ? await api.providerBrowserKey('mapbox') : null;
      const google = b === 'google2d' ? await api.providerBrowserKey('google2d') : null;
      const list = await api.listProviders();
      if (!current) return;
      const eox = b === 'eox' ? list.some((p) => p.id === 'eox' && p.configured) : false;
      setGoogleConfigured(list.some((p) => p.id === 'google3d' && p.configured));
      setGoogleOwnKey(list.some((p) => p.id === 'google3d' && p.credentialSource === 'user'));
      setImageryKeys({ esri, mapbox, google });
      setEoxLicensed(eox);
      if ((b === 'esri' && !esri) || (b === 'mapbox' && !mapbox) || (b === 'eox' && !eox) || (b === 'google2d' && !google)) setToast('That imagery source needs setup in Providers. Showing keyless imagery meanwhile.');
    })().catch(error => {
      if (current) { setImageryKeys({ esri: null, mapbox: null, google: null }); setToast(errorText(error)); }
    });
    return () => { current = false; };
  }, [snap?.settings.basemap, selectedYear, dialog === null]);

  // Restore the last camera view (per-viewer convenience; falls back to the U.S. view).
  const restoredRef = useRef(false);
  const onViewChange = useCallback((v: Parameters<typeof api.setView>[0]) => {
    lastViewRef.current = { lat: v.lat, lon: v.lon, bbox: v.bbox };
    void api.setView(v).catch(() => {});
    try {
      const cam = globeRef.current?.getCamera();
      if (cam && restoredRef.current) localStorage.setItem('atlas.lastCamera', JSON.stringify(cam));
    } catch {
      // storage unavailable
    }
    restoredRef.current = true;
  }, []);

  useEffect(() => {
    if (!snap) return;
    Object.assign(smoke.current, { locations: snap.locations.length, alerts: snap.alerts.length, quakes: snap.quakes.length, nws: snap.feeds.nws.state, usgs: snap.feeds.usgs.state });
    window.__atlasSmoke = smoke.current;
  }, [snap]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Global shortcuts: "/" focuses search; Escape clears selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setDiagOpen((v) => !v);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && !dialog && !form && !typing) {
        if (toolRef.current !== 'none') {
          setTool('none');
          setDraft([]);
        } else {
          setSelection(null);
          setRecordSel(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, form]);
  const toolRef = useRef<ToolMode>('none');
  toolRef.current = tool;

  const patchSettings = useCallback(async (p: Partial<Settings>) => {
    try {
      await api.updateSettings(p);
    } catch (e) {
      setToast(errorText(e));
    }
  }, []);

  const globeAlerts = useMemo(() => {
    if (!snap) return [];
    const sup = new Set(snap.supersededAlertIds);
    const now = Date.now();
    let affecting: Set<string> | null = null;
    if (alertsAffectingOnly) {
      affecting = new Set();
      for (const ev of Object.values(snap.evaluations)) for (const m of ev.alertsInside) affecting.add(m.alertId);
    }
    return snap.alerts.filter((a) => isAlertCountable(a, sup, now) && severityFilter.has(a.severity) && (!affecting || affecting.has(a.id)));
  }, [snap, severityFilter, alertsAffectingOnly]);

  const globeQuakes = useMemo(() => {
    if (!snap) return [];
    if (!snap.settings.quakesNearLocationsOnly) return snap.quakes;
    const near = new Set<string>();
    for (const ev of Object.values(snap.evaluations)) for (const m of ev.quakesNearby) near.add(m.quakeId);
    return snap.quakes.filter((q) => near.has(q.id));
  }, [snap]);

  const globeSelection: GlobeSelection | null = useMemo(() => {
    if (playbackOn) return replaySelection;
    if (recordSel) return { kind: 'record', layer: recordSel.layer, id: recordSel.id };
    if (!selection) return null;
    if (selection.kind === 'areaMatch') return null;
    if (selection.kind === 'history') return { kind: selection.record.kind === 'alert' ? 'alert' : 'quake', id: selection.record.sourceId };
    return selection;
  }, [selection, recordSel, playbackOn, replaySelection]);
  const replayAlerts = useMemo(() => {
    if (!playbackFrame) return [];
    const records = playbackFrame.nws.records;
    const replaced = supersededAlertIds(records);
    const at = Date.parse(playbackFrame.t);
    return records.filter(alert => isAlertCountable(alert, replaced, at) && severityFilter.has(alert.severity));
  }, [playbackFrame, severityFilter]);
  const globeSettings = useMemo(() => {
    if (!snap) return undefined;
    if (archived) return { ...snap.settings, basemap: 'atlas' as const, radarEnabled: false, geoSatEnabled: false, buildings3d: false };
    return playbackOn ? { ...snap.settings, radarEnabled: false, geoSatEnabled: false } : snap.settings;
  }, [playbackOn, snap?.settings, archived]);

  const focusSelection = useCallback(
    (sel: Selection | null) => {
      selectCoreSelection(sel);
      if (!snap || !sel) return;
      if (sel.kind === 'location') {
        const l = snap.locations.find((x) => x.id === sel.id);
        if (l) globeRef.current?.focus(l.lat, l.lon, l.radiusKm);
      }
    },
    [snap, selectCoreSelection],
  );

  const finishTool = async (pts: [number, number][], t: ToolMode) => {
    if (t.startsWith('draw')) {
      const kind = t === 'draw-pin' ? 'pin' : t === 'draw-line' ? 'line' : 'area';
      if ((kind === 'line' && pts.length < 2) || (kind === 'area' && pts.length < 3) || pts.length === 0) return;
      const a: Annotation = { id: crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, ''), kind, name: kind === 'pin' ? 'Pin' : kind === 'line' ? 'Route' : 'Area', color: '#ffd166', points: pts, visible: true, createdAt: new Date().toISOString() };
      try {
        await api.putAnnotation(a);
        setAnnotations((prev) => [...prev, a]);
        setToast(kind === 'pin' ? 'Pin saved' : measurementText(t, pts) ?? 'Saved');
      } catch (e) {
        setToast(errorText(e));
      }
      setDraft([]);
    } else {
      const m = measurementText(t, pts);
      if (m) setToast(m);
    }
  };
  const updateAnnotation = (a: Annotation) => {
    setAnnotations((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    void api.putAnnotation(a).catch((e) => setToast(errorText(e)));
  };
  const markAreaMatchesRead = (ids: string[]) => {
    if (ids.length) void api.readAreaWatchEvents(ids).catch((error) => setToast(errorText(error)));
  };
  const openAreaMatch = (event: AreaWatchEvent) => {
    setPage('globe');
    selectCoreSelection({ kind: 'areaMatch', id: event.id });
    globeRef.current?.focus(event.lat, event.lon, 50);
    setBellOpen(false);
    if (!event.read) markAreaMatchesRead([event.id]);
  };
  const captureInvestigation = () => {
    const camera = globeRef.current?.getCamera();
    if (!camera || !snap) throw new Error('Wait for the map to finish changing modes, then save the view.');
    if (playbackOn && !cursor) throw new Error('Choose a time on the replay timeline before saving.');
    const hazard = playbackOn ? replaySelection : selection?.kind === 'alert' || selection?.kind === 'quake' ? selection : null;
    const investigation: Investigation = {
      version: 1, clock: playbackOn && cursor ? { mode: 'recorded', t: cursor } : { mode: 'live' },
      selection: hazard ? { kind: hazard.kind, id: hazard.id } : null,
      severityFilter: SEVERITY_ORDER.filter(severity => severityFilter.has(severity)),
      alertsAffectingOnly, quakesNearLocationsOnly: snap.settings.quakesNearLocationsOnly,
      quakeMinMagnitude: replayQuery?.quakeMinMagnitude ?? snap.settings.quakeMinMagnitude,
      quakeWindow: replayQuery?.quakeWindow ?? snap.settings.quakeWindow,
      layers: { ...layers }, sceneMode, dataOpen, hudOn, showAirports, imagery: { ...imagery }, imageryYear: selectedYear,
    };
    return {
      camera, investigation,
      basemap: archived ? 'atlas' as const : snap.settings.basemap,
      terrainEnabled: snap.settings.terrainEnabled,
      layersEnabled: snap.settings.layersEnabled as LayerId[],
      visualMode: snap.settings.visualMode,
    };
  };
  const restoreInvestigation = async (camera: Camera, state?: Investigation) => {
    userCameraRestore.current = true;
    setTracked(null);
    setTrackingMode('follow');
    setOrbitFor(null);
    setRouteLine(null);
    setLeftFloat(null);
    setToolsOpen(false);
    if (state) {
      setPage('globe');
      setDiagOpen(false);
      setKeyboardOpen(false);
      setHistoryOpen(false);
      setBellOpen(false);
      setPlaybackMenu(false);
      setCreditsOpen(false);
      setPickMode(false);
      setTool('none');
      setDraft([]);
      setRecordSel(null);
      setSelection(null);
      setSeverityFilter(new Set(state.severityFilter));
      setAlertsAffectingOnly(state.alertsAffectingOnly);
      setLayers(state.layers);
      setHudOn(state.hudOn);
      setShowAirports(state.showAirports);
      setSceneMode(state.sceneMode);
      if (state.imagery) {
        setImagery(state.imagery);
        setPreserveImageryDates(true);
      }
      if (state.clock.mode === 'recorded') startPlayback(state.clock.t, state.selection, { quakeWindow: state.quakeWindow, quakeMinMagnitude: state.quakeMinMagnitude });
      else {
        exitPlayback();
        restoredSelection.current = state.selection;
        selectCoreSelection(state.selection);
      }
      setDataOpen(state.dataOpen);
    }
    return await globeRef.current?.restoreCamera(camera, { mode: state?.sceneMode ?? sceneMode, animate: false }) ?? false;
  };
  const scenes = useScenes({ basemap: archived ? 'atlas' : snap?.settings.basemap, capture: captureInvestigation,
    restore: restoreInvestigation, setAnnotations, setViews, notify: setToast });
  const LAYER_CREDIT: Record<string, string> = {
    aircraft: 'Aircraft: adsb.lol (ODbL)',
    aircraftMil: 'Military flags: adsb.lol (ODbL)',
    vessels: 'AIS: Fintraffic / digitraffic.fi, CC BY 4.0',
    satellites: 'Orbital elements: CelesTrak (positions calculated)',
    fires: 'Fires: NASA FIRMS',
    firePerimeters: 'Perimeters: NIFC WFIGS',
    metar: 'METAR: NOAA AWC',
    dwd: 'German weather warnings: © Deutscher Wetterdienst, CC BY 4.0; CAP polygons converted to GeoJSON',
    cyclones: 'Cyclones: NOAA NHC',
    cameras: 'Cameras: Caltrans; NYC DOT; Fintraffic / digitraffic.fi, CC BY 4.0; Powered by TfL Open Data; Transport Department, Hong Kong SAR (DATA.GOV.HK); DriveBC, Open Government Licence – British Columbia; Québec 511, MTMD, CC BY 4.0',
    transit: 'Transit: MBTA',
    airspace: 'Airspace: FAA',
  };
  const layerCredits = snap
    ? [...(snap.settings.layersEnabled as string[]).map((l) => LAYER_CREDIT[l]).filter(Boolean), ...(snap.settings.radarEnabled ? ['Radar: NOAA nowCOAST'] : []), ...(snap.settings.geoSatEnabled ? ['Weather satellites: NOAA GOES, JMA Himawari; imagery from NASA GIBS (ESDIS)'] : [])].join(' · ')
    : '';
  const allAircraftLoaded = [...new Map([...(layerSnaps.aircraft?.records ?? []), ...(layerSnaps.aircraftMil?.records ?? [])].map((r) => [r.id, r])).values()];
  const notifications = (() => {
    if (!snap) return [];
    const out: { key: string; tag: string; sev: string; title: string; meta: string; go(): void }[] = [];
    for (const r of allAircraftLoaded.filter((x) => specialCode(x)))
      out.push({ key: 'sq-' + r.id, tag: String(r.props.squawk ?? r.props.emergency), sev: 'sev-extreme', title: r.label, meta: specialCode(r)!.label + ' (reported)', go: () => { globeRef.current?.focus(r.lat, r.lon, 30); setRecordSel({ layer: 'aircraft', id: r.id }); } });
    const alertsById = new Map(snap.alerts.map((alert) => [alert.id, alert]));
    for (const place of snap.locations) {
      const matches = snap.evaluations[place.id]?.alertsInside;
      if (!matches?.length) continue;
      const evidence = monitoringEvidence(snap, 'nws', place);
      if (!evidence.usable) continue;
      const top = matches.reduce<AlertSeverity>((severity, match) => {
        const next = alertsById.get(match.alertId)?.severity ?? 'Unknown';
        return severityRank(next) > severityRank(severity) ? next : severity;
      }, 'Unknown');
      const meta = `${matches.length} matched in the ${evidence.current ? 'current' : 'last observed'} NWS reply${evidence.observedAt ? ` · ${evidence.observedAt}` : ''}`;
      out.push({ key: 'loc-' + place.id, tag: 'Alert', sev: SEVERITY_META[top].cls, title: place.name, meta, go: () => { setPage('globe'); selectCoreSelection({ kind: 'location', id: place.id }); } });
    }
    const loaded = new Set([...allAircraftLoaded.map((r) => r.id), ...(layerSnaps.vessels?.records ?? []).map((r) => r.id)]);
    for (const w of watchlist) if (loaded.has(w.id)) out.push({ key: 'w-' + w.id, tag: '★', sev: 'ok-badge', title: w.label, meta: 'Watched object is in the loaded data', go: () => setPage('watchlist') });
    return out;
  })();
  const searchExtra = useCallback(
    (q: string): SearchResult[] => {
      const t = q.trim().toLowerCase();
      if (t.length < 2) return [];
      const out: SearchResult[] = [];
      for (const a of AIRPORTS) {
        if (a[0].toLowerCase() === t || a[1].toLowerCase() === t || (t.length >= 4 && a[2].toLowerCase().includes(t))) {
          out.push({ key: 'apt-' + a[0], label: `${a[2]} (${a[1] || a[0]})`, detail: `Airport · ${a[7]}, ${a[6]}`, onPick: () => { globeRef.current?.focus(a[3], a[4], 8); setAirportSel(a[0]); setPage('airports'); } });
          if (out.length >= 3) break;
        }
      }
      const snaps = layerSnapsRef.current;
      const air = [...(snaps.aircraft?.records ?? []), ...(snaps.aircraftMil?.records ?? [])];
      for (const r of air) {
        if (r.id === t || r.label.toLowerCase().startsWith(t) || String(r.props.registration ?? '').toLowerCase() === t) {
          out.push({ key: 'ac-' + r.id, label: r.label, detail: `Aircraft (loaded) · hex ${r.id}`, onPick: () => { globeRef.current?.focus(r.lat, r.lon, 30); setRecordSel({ layer: 'aircraft', id: r.id }); } });
          if (out.length >= 6) break;
        }
      }
      for (const r of snaps.vessels?.records ?? []) {
        if (r.id === t || r.label.toLowerCase().includes(t) || String(r.props.imo ?? '') === t) {
          out.push({ key: 'v-' + r.id, label: r.label, detail: `Vessel (loaded) · MMSI ${r.id}`, onPick: () => { globeRef.current?.focus(r.lat, r.lon, 10); setRecordSel({ layer: 'vessels', id: r.id }); } });
          if (out.length >= 9) break;
        }
      }
      return out;
    },
    [],
  );
  const pageCtx: PageCtx | null = snap
    ? {
        snap,
        layerSnaps,
        playbackActive: playbackOn,
        patch: (p) => void patchSettings(p),
        selectRecord: (layer, id) => {
          setRecordSel({ layer, id });
          if ((page === 'track' && layer === 'aircraft') || layer === 'dwd' || layer === 'firePerimeters') setPage('globe');
        },
        selectEvent: (kind, id) => {
          selectCoreSelection({ kind, id } as never);
        },
        focus: (la, lo, r) => globeRef.current?.focus(la, lo, r),
        viewCenter: () => lastViewRef.current,
        viewBbox: () => lastViewRef.current?.bbox ?? null,
        watchlist,
        setWatchlist,
        openPlayback: () => startPlayback(),
        openAi: () => setDialog({ kind: 'ai' }),
        openVisitBriefing: () => setDialog({ kind: 'briefing', ids: [], mode: 'visit' }),
        openSettings: () => setDialog({ kind: 'settings' }),
        openProviders: () => setDialog({ kind: 'providers' }),
        toast: setToast,
        enableLayers: (ids) => void patchSettings({ layersEnabled: [...new Set([...(snap.settings.layersEnabled as LayerId[]), ...ids])] as LayerId[] }),
      }
    : null;
  const selectedRecord = recordSel ? (layerSnaps[recordSel.layer]?.records.find((r) => r.id === recordSel.id) ?? null) : null;
  const showFlight = recordSel?.layer === 'aircraft' && selectedRecord?.props.militaryFlag !== true;
  const showRecordFirst = showFlight || recordSel?.layer === 'dwd' || recordSel?.layer === 'firePerimeters';
  const selectedDwdWarning = recordSel?.layer === 'dwd' ? layerSnaps.dwd?.dwdWarnings?.find(warning => warning.id === recordSel.id) ?? null : null;

  if (loadError)
    return (
      <div className="fatal" role="alert">
        Atlas Watch could not start: {loadError}
      </div>
    );
  if (!snap)
    return (
      <div className="fatal" aria-busy="true">
        Loading Atlas Watch…
      </div>
    );

  const categories = [...new Set(snap.locations.map((l) => l.category).filter(Boolean))].sort();
  const areaMatches = snap.areaWatches.events;
  const unreadAreaMatches = areaMatches.filter((event) => !event.read);
  const bellCount = notifications.length + unreadAreaMatches.length;
  const selectedLocationId = selection?.kind === 'location' ? selection.id : null;
  const searchMode = placeSearchMode(snap.settings.basemap, googleOwnKey, selectedYear);
  const zoneOnly = globeAlerts.filter((a) => !a.geometry).length;
  const diffText = (['nws', 'usgs'] as const)
    .map((f) => describeFeedDiff(snap.diffs[f]))
    .filter(Boolean)
    .join(' · ');

  const locationPanel = (<LeftPanel mode={leftFloat === 'places' ? 'places' : 'alerts'}
          snap={snap}
          search={search}
          selectedLocationId={selectedLocationId}
          severityFilter={severityFilter}
          onSeverityFilter={setSeverityFilter}
          layers={layers}
          onLayers={setLayers}
          alertsAffectingOnly={alertsAffectingOnly}
          onAlertsAffectingOnly={setAlertsAffectingOnly}
          onSelectLocation={(id) => focusSelection({ kind: 'location', id })}
          onAdd={() => {
            setPicked(null);
            setForm({ existing: null });
          }}
          onImport={() => setDialog({ kind: 'import' })}
          onExport={async () => {
            try {
              const p = await api.exportLocationsCsv();
              if (p) setToast(`Exported locations to ${p}`);
            } catch (e) {
              setToast(errorText(e));
            }
          }}
          onSettingsPatch={(p) => void patchSettings(p)}
        >
        </LeftPanel>);
  const credits = 'Alerts: NWS/NOAA · Earthquakes: USGS · Surface: ' + (archived ? archiveCaption(archived) : BASEMAP_CREDIT[snap.settings.basemap] ?? 'neutral')

    + (lighting.mode !== 'day' ? ' · City lights: NASA Black Marble, 2016 composite' : '')
    + (snap.settings.labelsOverlay && snap.settings.basemap !== 'streets' ? ' · Labels/roads: © OpenStreetMap contributors, © OpenMapTiles (OpenFreeMap)' : '')
    + (globeSettings?.buildings3d ? ' · Buildings: OpenStreetMap (heights may be estimated)' : '')
    + (snap.settings.terrainEnabled ? ' · Terrain: Mapzen Terrain Tiles (AWS Open Data; 3DEP, SRTM, GMTED, ETOPO1, EU-DEM)' : '')
    + ' · Boundaries: U.S. Census Bureau, Natural Earth · Globe: CesiumJS'
    + (!archived && snap.settings.basemap === ('google3d' as never) ? ' · Sea level on Photoreal 3D: EGM96 geoid, NGA (public domain)' : '')
    + (playbackOn ? [...new Set(playbackFrame?.points.map(fix => LAYER_CREDIT[fix.layer]).filter(Boolean))].map(credit => ' · ' + credit).join('') : layerCredits ? ' · ' + layerCredits : '');
  return (
    <div className={`app ${historyOpen ? 'history-open' : ''} ${kiosk ? 'kiosk' : ''} ${snap.settings.reducedMotion ? 'reduced-motion' : ''} ${playbackOn ? 'playback-active' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <ellipse cx="12" cy="12" rx="4.2" ry="9.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.8 9h18.4M2.8 15h18.4" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="16.5" cy="8" r="2" fill="#e8a33a" />
          </svg>
          <span>Atlas Watch</span>
        </div>
        <div className="seg" role="group" aria-label="Map mode">
          <button className={`btn small-btn ${sceneMode === '2d' ? 'primary' : ''}`} onClick={() => setSceneMode('2d')} aria-pressed={sceneMode === '2d'}>
            2D
          </button>
          <button className={`btn small-btn ${sceneMode === '3d' ? 'primary' : ''}`} onClick={() => setSceneMode('3d')} aria-pressed={sceneMode === '3d'}>
            3D
          </button>
          <button
            className="btn small-btn"
            title="Air-traffic view: aircraft layers, airports and altitude colors (no ATC audio: no authorized audio source is included)"
            onClick={() => {
              if (playbackOn) exitPlayback();
              void patchSettings({ layersEnabled: [...new Set([...(snap.settings.layersEnabled as LayerId[]), 'aircraft', 'aircraftMil'])] as LayerId[] });
              setShowAirports(true);
              setToast('ATC view: aircraft and airports on. Zoom in to load aircraft for an area.');
            }}
          >
            ATC
          </button>
        </div>
        <div className="seg" role="group" aria-label="Google imagery (your key)">
          <button
            className={`btn small-btn ${!archived && snap.settings.basemap === 'google2d' ? 'primary' : ''}`}
            aria-pressed={!archived && snap.settings.basemap === 'google2d'}
            title={googleOwnKey ? 'Google satellite imagery worldwide (your Google key; billed per tile)' : 'Needs your own Google Maps key: opens Providers'}
            onClick={() => {
              if (!googleOwnKey) return setDialog({ kind: 'providers' } as never);
              void patchSettings({ imageryYear: null, basemap: !archived && snap.settings.basemap === 'google2d' ? 'atlas' : 'google2d' });
            }}
          >
            Satellite
          </button>
          <button
            className={`btn small-btn ${!photorealParked && snap.settings.basemap === 'google3d' ? 'primary' : ''}`}
            aria-pressed={!photorealParked && snap.settings.basemap === 'google3d'}
            title={googleConfigured ? 'Google Photorealistic 3D cities (your Google key; billed per session)' : 'Needs your Google Maps key: opens Providers'}
            onClick={() => {
              if (!googleConfigured) return setDialog({ kind: 'providers' } as never);
              setSceneMode('3d');
              if (lighting.mode !== 'day') setLighting({ mode:'day' });
              void patchSettings({ imageryYear: null, basemap: !photorealParked && snap.settings.basemap === 'google3d' ? 'atlas' : 'google3d' });
            }}
          >
            Photoreal 3D
          </button>
        </div>
        <label className="archive-year-control" title={archived ? archiveCaption(archived) : 'Choose the acquisition year of the satellite imagery'}>
          <span>Imagery year</span>
          <select aria-label="Satellite imagery year" value={selectedYear ?? ''} onFocus={() => void imageryDates.load(archiveProduct).catch(() => {})}
            onChange={event => void patchSettings({ imageryYear: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Auto</option>
            {selectedYear !== null && !years.includes(selectedYear) && <option value={selectedYear}>{selectedYear} · unavailable</option>}
            {years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <SearchBox
          mode={searchMode}
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          extra={playbackOn ? undefined : searchExtra}
          onGo={(lat, lon, label, kind) => {
            setPage('globe');
            setTracked(null);
            globeRef.current?.focus(lat, lon, kind === 'address' ? 0.4 : kind === 'coords' ? 2 : 6, 1_500);
            setToast(`Flying to ${label}`);
          }}
        />
        <div className="fresh-group" aria-label="Data freshness">
          <FreshnessChip label={playbackOn ? 'Live NWS' : 'NWS alerts'} status={snap.feeds.nws} freshness={snap.freshness.nws} onRefresh={() => void api.refresh('nws')} />
          <FreshnessChip label={playbackOn ? 'Live USGS' : 'USGS quakes'} status={snap.feeds.usgs} freshness={snap.freshness.usgs} onRefresh={() => void api.refresh('usgs')} />
        </div>
        <div className="bell-wrap">
          <button className={`icon-btn ${bellCount ? 'bell-on' : ''}`} onClick={() => { setAreaMatchLimit(20); setBellOpen(!bellOpen); }} aria-label={`Notifications (${bellCount})`} aria-expanded={bellOpen} title="Notifications">
            <Bell aria-hidden="true" />{bellCount ? <span className="bell-count">{bellCount}</span> : null}
          </button>
          {bellOpen && (
            <div className="bell-pop">
              <div className="diag-sub">{playbackOn ? 'Current notifications' : 'Notifications'}</div>
              {notifications.length === 0 && !areaMatches.length ? <p className="muted small">Nothing needs attention in the loaded data.</p> : null}
              <ul className="rec-list">
                {notifications.map((n) => (
                  <li key={n.key}>
                    <button className="rec-item" onClick={() => { if (playbackOn) exitPlayback(); n.go(); setBellOpen(false); }}>
                      <span className={`tag ${n.sev}`}>{n.tag}</span>
                      <span className="rec-title">{n.title}</span>
                      <span className="rec-meta">{n.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {areaMatches.length > 0 && <>
                <div className="diag-sub">Saved area matches</div>
                {unreadAreaMatches.length > 0 && <button type="button" className="link-btn" onClick={() => markAreaMatchesRead(unreadAreaMatches.map((event) => event.id))}>Mark all area matches read</button>}
                <ul className="rec-list">
                  {areaMatches.slice(0, areaMatchLimit).map((event) => <li key={event.id}>
                    <button className="rec-item" onClick={() => { if (playbackOn) exitPlayback(); openAreaMatch(event); }}>
                      <span className="tag">{event.read ? 'Seen' : 'New'}</span>
                      <span className="rec-title">{event.areaName} · M{event.magnitude}</span>
                      <span className="rec-meta">USGS {event.quakeId} · {localTime(event.quakeTime)}</span>
                    </button>
                  </li>)}
                </ul>
                {areaMatchLimit < areaMatches.length && <button type="button" className="link-btn" onClick={() => setAreaMatchLimit((limit) => limit + 20)}>Show more area matches</button>}
              </>}
            </div>
          )}
        </div>
        <button className="btn" onClick={() => setDialog({ kind: 'providers' })} title="Data providers, credentials and connection tests">
          <KeyRound aria-hidden="true" /> <span className="top-action-label">Providers</span>
        </button>
        <button className="icon-btn" onClick={() => setDialog({ kind: 'settings' })} aria-label="Settings" title="Settings">
          <SettingsIcon aria-hidden="true" />
        </button>
      </header>  <main className="workspace">
        <nav className="nav-rail" aria-label="Sections">
          {NAV.map((n, i) => (
            <span key={n.id}>
              {i > 0 && NAV[i - 1].group !== n.group && <span className="nav-divider" role="separator" aria-label={n.group} />}
              <button className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)} title={n.label} aria-label={n.label} aria-current={page === n.id ? 'page' : undefined}>
                <span className="nav-icon" aria-hidden="true"><n.icon size={18} strokeWidth={1.75} aria-hidden="true" /></span>
                <span className="nav-label" aria-hidden="true">{n.short}</span>
              </button>
            </span>
          ))}
        </nav>

        <section className="center" aria-label="Globe">
          <Globe
            ref={globeRef}
            alerts={playbackOn ? replayAlerts : globeAlerts}
            quakes={playbackOn ? playbackFrame?.usgs.records ?? [] : globeQuakes}
            locations={snap.locations}
            layers={layers}
            settings={globeSettings ?? snap.settings}
            selection={globeSelection}
            pickMode={pickMode}
            onSelect={(s) => {
              if (playbackOn) {
                const record = s?.kind === 'alert' || s?.kind === 'quake' ? { kind: s.kind, id: s.id } : null;
                setReplaySelection(record);
                if (record) setDataOpen(true);
                return;
              }
              if (s) setDataOpen(true);
              if (s?.kind === 'airport') {
                selectCoreSelection(null);
                setAirportSel(s.id);
                setPage('airports');
                return;
              }
              if (s?.kind === 'record') {
                setRecordSel({ layer: s.layer, id: s.id });
                setSelection(null);
              } else {
                selectCoreSelection(s as Selection | null);
              }
            }}
            onPick={(lat, lon) => {
              setPicked({ lat, lon });
              setPickMode(false);
              if (!form) setForm({ existing: null });
            }}
            layerSnaps={layerSnaps}
            layersOn={snap.settings.layersEnabled as LayerId[]}
            trail={playbackOn ? null : trail}
            routeLine={playbackOn ? null : routeLine}
            archived={archived}
            imagery={playbackOn || archived || unavailableImageryDates.length ? undefined : imagery}
            onImagerySplit={(split) => setImagery((s) => ({ ...s, split }))}
            trailKind={tracked?.layer === 'aircraft' || tracked?.layer === 'aircraftMil' ? 'aircraft' : tracked?.layer === 'vessels' ? 'vessel' : 'other'}
            trackedRecord={playbackOn ? null : tracked}
            trackingMode={trackingMode}
            passengerSeat={passengerSeat}
            onInteriorStatus={setInteriorStatus}
            onTrackingUnavailable={(reason) => { setTracked(null); setTrackingMode('follow'); setToast(reason); }}
            showOrbitFor={playbackOn ? null : orbitFor}
            onViewChange={onViewChange}
            tool={tool}
            draftPoints={draft}
            onToolPoint={(lon, lat) => {
              if (tool === 'draw-pin') void finishTool([[lon, lat]], tool);
              else setDraft((d) => [...d, [lon, lat]]);
            }}
            onToolFinish={() => {
              void finishTool(draft, tool);
              if (tool.startsWith('measure')) setTool('none');
            }}
            annotations={annotations}
            playback={playbackOn ? playbackFrame : null}
            playbackActive={playbackOn}
            google3dKey={google3dKey}
            imageryKeys={imageryKeys}
            onProviderError={setToast}
            eoxLicensed={eoxLicensed}
            aircraftFilter={aircraftFilter}
            vesselClasses={vesselClasses}
            showAirports={showAirports}
            sceneMode={sceneMode}
            lighting={lighting}
            onReady={(ok, err) => {
              if (ok) {
                try {
                  const raw = localStorage.getItem('atlas.lastCamera');
                  const cam = raw ? JSON.parse(raw) : null;
                  if (cam && typeof cam.lat === 'number') setTimeout(() => {
                    if (!userCameraRestore.current) globeRef.current?.setCamera(cam, false);
                  }, 0);
                } catch {
                  // ignore
                }
              }
              smoke.current.globeReady = ok;
              if (err) (smoke.current.errors as string[]).push(err);
            }}
          />
          {tracked && !widePage && !playbackOn && <TrackingControls target={tracked} record={layerSnaps[tracked.layer]?.records.find((r) => r.id === tracked.id) ?? null}
            mode={trackingMode} in3d={sceneMode === '3d'} smoothMotion={snap.settings.smoothMotion} blockedReason={playbackOn ? 'Stop recorded playback before using cockpit perspective.' : null}
            passengerSeat={passengerSeat} onPassengerSeat={setPassengerSeat}
            interiorStatus={interiorStatus}
            onMode={setTrackingMode} onStop={() => { setTracked(null); setTrackingMode('follow'); }} />}
          {!widePage && <FloatingMapControls
            left={page === 'globe' ? leftFloat : null} onLeft={toggleLeft}
            solarLighting={lighting.mode !== 'day'}
            dataOpen={dataOpen} onData={() => { setDataOpen(!dataOpen); setToolsOpen(false); setKeyboardOpen(false); }}
            toolsOpen={toolsOpen} onTools={() => { setToolsOpen(!toolsOpen); setDataOpen(false); setKeyboardOpen(false); setHistoryOpen(false); if (leftFloat === 'scenes') setLeftFloat(null); }}
            onAi={() => { if (playbackOn) exitPlayback(); setDialog({ kind: 'ai' }); }}
            camerasOn={snap.settings.layersEnabled.includes('cameras')}
            onCameras={() => void patchSettings({ layersEnabled: snap.settings.layersEnabled.includes('cameras')
              ? snap.settings.layersEnabled.filter(id => id !== 'cameras') : [...snap.settings.layersEnabled, 'cameras'] })}
            onBrowseCameras={() => setPage('cameras')}
            diagnosticsOpen={diagOpen} onDiagnostics={() => setDiagOpen(!diagOpen)}
            hudOn={hudOn} onHud={() => setHudOn(!hudOn)}
            onPlayback={() => setPlaybackMenu(!playbackMenu)} playbackActive={playbackOn || historyOpen}
            kiosk={kiosk} onKiosk={() => {
              if (!kiosk) {
                setPage('globe');
                setLeftFloat(null);
                setDataOpen(false);
                setToolsOpen(false);
                setDiagOpen(false);
                setKeyboardOpen(false);
                setCreditsOpen(false);
                setHistoryOpen(false);
              }
              setKiosk(!kiosk);
              void api.setKiosk(!kiosk);
            }}
            onScreenshot={() => void api.captureScreenshot().then(path => path && setToast('Saved ' + path))}
            onShare={scenes.exportScene} onWatchlist={() => setPage('watchlist')}
            onZoom={direction => globeRef.current?.zoom(direction)} onNorth={() => globeRef.current?.northUp()} getHeading={getHeading}
            onReset={() => globeRef.current?.flyHome()} onHome={() => {
              if (selectedRecord) globeRef.current?.focus(selectedRecord.lat, selectedRecord.lon, 20);
              else if (snap.settings.homeLat !== null && snap.settings.homeLon !== null) globeRef.current?.focus(snap.settings.homeLat, snap.settings.homeLon, 20);
              else setToast('Set a home location in Settings, or select an object.');
            }} keyboardOpen={keyboardOpen} onKeyboard={() => { setKeyboardOpen(!keyboardOpen); setDataOpen(false); setToolsOpen(false); }}
          />}
          {page === 'globe' && leftFloat === 'layers' && !diagOpen && (
            <FloatingPanel className="floating-left floating-layers" title={'Layers \u00b7 ' + (snap.settings.layersEnabled.length + (snap.settings.radarEnabled ? 1 : 0) + (snap.settings.geoSatEnabled ? 1 : 0)) + ' on'}
              onClose={() => setLeftFloat(null)}>
              <LayersPanel settings={snap.settings} snaps={layerSnaps} playbackActive={playbackOn} onPatch={patch => void patchSettings(patch)} imagery={imagery}
                archived={archived} onImagery={changeImagery} preserveImageryDates={preserveImageryDates} airportsOn={showAirports} onAirports={() => setShowAirports(!showAirports)} alertsContent={locationPanel} />
            </FloatingPanel>
          )}
          {page === 'globe' && leftFloat === 'places' && !diagOpen && (
            <FloatingPanel className="floating-left floating-places" title="Places" onClose={() => setLeftFloat(null)}>{locationPanel}</FloatingPanel>
          )}
          {page === 'globe' && leftFloat === 'lighting' && !diagOpen && (
            <FloatingPanel className="floating-left" title="Day/night" onClose={() => setLeftFloat(null)}>
              <EarthLightingPanel lighting={lighting} onChange={setLighting} />
            </FloatingPanel>
          )}
          {dataOpen && !widePage && (
            <FloatingPanel className={`floating-right data-panel${showFlight && !playbackOn ? ' flight-panel' : ''}`} title={playbackOn ? 'Recorded data' : showFlight ? 'Flight details' : 'Data'} onClose={() => setDataOpen(false)}
              scrollResetKey={showRecordFirst ? recordSel : undefined}
              headerAction={!playbackOn && !showFlight && <button className="btn" title="Briefing" onClick={() => setDialog({ kind: 'briefing', ids: selectedLocationId ? [selectedLocationId] : [] })}>
                <FileText size={16} aria-hidden="true" /> Briefing</button>}>
        {playbackOn ? <ReplayDetails frame={playbackFrame} selection={replaySelection} onSelect={setReplaySelection}
          onFocus={(lat, lon, radius) => globeRef.current?.focus(lat, lon, radius)} /> : recordSel ? (
          <aside className="panel right-panel" aria-label="Details">
        {!showRecordFirst && <DetailsPanel
          snap={snap}
          dwdSnapshot={layerSnaps.dwd} dwdEnabled={snap.settings.layersEnabled.includes('dwd')} onSelectDwd={id => setRecordSel({ layer: 'dwd', id })}
          selection={null}
          onSelect={focusSelection}
          onEdit={(loc) => {
            setPicked(null);
            setForm({ existing: loc });
          }}
          onDelete={(loc) => setDialog({ kind: 'delete', loc })}
          onFocus={(lat, lon, r) => globeRef.current?.focus(lat, lon, r)}
          onBriefing={(ids) => setDialog({ kind: 'briefing', ids })}
        />}
            {!showFlight && <button className="link-btn back" onClick={() => setRecordSel(null)}>
              ← Overview
            </button>}
            <RecordDetails
              layer={recordSel.layer}
              record={selectedRecord}
              dwdWarning={selectedDwdWarning}
              layerEnabled={snap.settings.layersEnabled.includes(recordSel.layer)}
              snaps={layerSnaps}
              savedPlaces={snap.locations}
              tracked={tracked?.layer === recordSel.layer && tracked.id === recordSel.id}
              watched={watchlist.some((w) => w.id === recordSel.id && (w.kind === 'vessel') === (recordSel.layer === 'vessels'))}
              onWatch={(on) => {
                const kind = recordSel.layer === 'vessels' ? 'vessel' : 'aircraft';
                if (on) setWatchlist([...watchlist, { kind, id: recordSel.id, label: selectedRecord?.label ?? recordSel.id, addedAt: new Date().toISOString() }]);
                else setWatchlist(watchlist.filter((w) => !(w.kind === kind && w.id === recordSel.id)));
              }}
              orbitShown={orbitFor === recordSel.id && recordSel.layer === 'satellites'}
              onTrack={(on) => { setTrackingMode('follow'); setTracked(on ? recordSel : null); }}
              onOrbit={(on) => setOrbitFor(on ? recordSel.id : null)}
              onSelect={(layer, id) => setRecordSel({ layer, id })}
              onFocus={(lat, lon, r) => globeRef.current?.focus(lat, lon, r)}
              photosEnabled={snap.settings.aircraftPhotos}
              onEnablePhotos={() => void patchSettings({ aircraftPhotos: true })}
              onShowRoute={setRouteLine}
              onOpenProviders={() => setDialog({ kind: 'providers' })}
              onViewRoute={route => { setTracked(null); setTrackingMode('follow'); globeRef.current?.focusAirlineRoute(route); }}
            />
            {showFlight && <button className="link-btn back" onClick={() => setRecordSel(null)}>← Overview</button>}
          </aside>
        ) : (
        <DetailsPanel includeOverview
          snap={snap}
          dwdSnapshot={layerSnaps.dwd} dwdEnabled={snap.settings.layersEnabled.includes('dwd')} onSelectDwd={id => setRecordSel({ layer: 'dwd', id })}
          selection={selection}
          onSelect={focusSelection}
          onEdit={(loc) => {
            setPicked(null);
            setForm({ existing: loc });
          }}
          onDelete={(loc) => setDialog({ kind: 'delete', loc })}
          onFocus={(lat, lon, r) => globeRef.current?.focus(lat, lon, r)}
          onBriefing={(ids) => setDialog({ kind: 'briefing', ids })}
        />
        )}

              <details className="data-legend"><summary>Legend</summary>          <div className="legend" aria-label="Legend">
            <div className="legend-title">Legend</div>
            <div className="legend-row">
              {SEVERITY_ORDER.map((s) => (
                <span key={s} className="legend-item">
                  <span className="swatch" style={{ background: SEVERITY_META[s].color }} aria-hidden="true" />
                  <span aria-hidden="true">{SEVERITY_META[s].icon}</span> {s}
                </span>
              ))}
            </div>
            <div className="legend-row">
              <span className="legend-item">
                <span className="dot" style={{ background: quakeClass(3).color }} /> Quake &lt; M4.5
              </span>
              <span className="legend-item">
                <span className="dot" style={{ background: quakeClass(5).color }} /> M4.5–5.9
              </span>
              <span className="legend-item">
                <span className="dot" style={{ background: quakeClass(6.5).color }} /> M6+
              </span>
              <span className="legend-item">
                <span className="dot loc-dot" /> Saved location
              </span>
            </div>
            <div className="legend-note">
              Marker size scales with magnitude.
              {playbackOn ? ' Recorded alerts without polygons are listed under Recorded data. The basemap, airports, saved places and drawings show current geographic context.' : zoneOnly > 0 && ` ${zoneOnly} zone-based alert(s) have no polygon and are not drawn; they are still evaluated for saved locations.`}
            </div>
          </div>
</details>
              {!playbackOn && diffText && <p className="muted small">Since previous refresh — {diffText}</p>}
            </FloatingPanel>
          )}
          {keyboardOpen && !widePage && (
            <FloatingPanel className="keyboard-panel" title="Keyboard shortcuts" onClose={() => setKeyboardOpen(false)}>
              <ul className="shortcut-list"><li>/ — focus search</li><li>Esc — close the top panel; cancel a map tool or clear selection</li>
                <li>Ctrl+Shift+D — diagnostics</li><li>Arrow keys — rotate the focused globe</li><li>+ / − — zoom the focused globe</li></ul>
            </FloatingPanel>
          )}
          {playbackMenu && !widePage && (
            <FloatingPanel className="playback-menu" title="Playback / History" onClose={() => setPlaybackMenu(false)}>
              <button className="btn" onClick={() => { if (playbackOn) exitPlayback(); else startPlayback(); setPlaybackMenu(false); }}>{playbackOn ? 'Exit playback' : 'Replay recorded data'}</button>
              <button className="btn" onClick={() => { if (playbackOn) exitPlayback(); setHistoryOpen(!historyOpen); setPlaybackMenu(false); setLeftFloat(null); setDataOpen(false); setToolsOpen(false); setDiagOpen(false); setPage('globe'); }}>Event history</button>
            </FloatingPanel>
          )}
          {!playbackOn && <TrafficBar
            aircraftOn={snap.settings.layersEnabled.includes('aircraft') || snap.settings.layersEnabled.includes('aircraftMil')}
            vesselsOn={snap.settings.layersEnabled.includes('vessels')}
            filter={aircraftFilter}
            onFilter={setAircraftFilter}
            vesselClasses={vesselClasses}
            onVesselClasses={setVesselClasses}
            aircraft={allAircraftLoaded}
            onSelectAircraft={(id) => {
              const r = allAircraftLoaded.find((x) => x.id === id);
              if (r) globeRef.current?.focus(r.lat, r.lon, 30);
              setRecordSel({ layer: 'aircraft', id });
            }}
          />}
          {hudOn && <Hud get={getDiag} snaps={layerSnaps} layersOn={playbackOn ? [] : snap.settings.layersEnabled as LayerId[]} mode={snap.settings.visualMode} playbackActive={playbackOn} playbackTime={playbackFrame?.t ?? null} />}
          {!widePage && (toolsOpen || (page === 'globe' && leftFloat === 'scenes' && !diagOpen)) && (
            <ToolsPanel
              mode={toolsOpen ? 'tools' : 'scenes'}
              quickViews={<div className="btn-row" role="group" aria-label="Quick views">
                {(['us', 'lower48', 'alaska', 'hawaii'] as const).map(region => (
                  <button className="btn" key={region} onClick={() => globeRef.current?.flyRegion(region)}>
                    {{us: 'U.S.', lower48: 'Lower 48', alaska: 'Alaska', hawaii: 'Hawaii'}[region]}</button>
                ))}
              </div>}
              tool={tool}
              draft={draft}
              onTool={(t) => {
                setTool(t);
                setDraft([]);
              }}
              onUndo={() => setDraft((d) => d.slice(0, -1))}
              onFinish={() => {
                void finishTool(draft, tool);
                if (tool.startsWith('measure')) setTool('none');
              }}
              onClear={() => setDraft([])}
              annotations={annotations}
              onAnnotationChange={updateAnnotation}
              areaWatch={{
                state: snap.areaWatches,
                usgsStatus: snap.feeds.usgs,
                freshness: snap.freshness.usgs,
                onSave: api.putAreaWatch,
                onRemove: api.deleteAreaWatch,
              }}
              onAnnotationsImported={setAnnotations}
              getStreetViewCenter={() => globeRef.current?.getMapCenter() ?? null}
              onAnnotationDelete={(id) => {
                void api.deleteAnnotation(id).then(() => {
                  setAnnotations((prev) => prev.filter((a) => a.id !== id));
                }).catch((error) => setToast(errorText(error)));
              }}
              onFlyTo={(lon, lat) => globeRef.current?.focus(lat, lon, 2)}
              views={views}
              sceneBusy={scenes.busy}
              onSaveView={scenes.saveView}
              onRestoreView={scenes.restoreView}
              onDeleteView={scenes.deleteView}
              onExportScene={scenes.exportScene}
              onImportScene={scenes.importScene}
              settings={snap.settings}
              onPatch={(p) => void patchSettings(p)}
              onClose={() => {
                setToolsOpen(false);
                if (!toolsOpen) setLeftFloat(null);
                setTool('none');
                setDraft([]);
              }}
              onPlayback={() => playbackOn ? exitPlayback() : startPlayback()}
              playbackActive={playbackOn}
            />
          )}
          {playbackOn && <PlaybackBar key={replaySession} initialCursor={initialCursor} onCursor={setCursor} onFrame={setPlaybackFrame} onExit={exitPlayback} />}
          {!playbackOn && unavailableImageryDates.length > 0 && <div className="pick-banner" role="status">
            Saved imagery date unavailable in the current catalog ({unavailableImageryDates.map(date => date || 'unspecified').join(', ')}). Choose another date in Layers → Imagery.
          </div>}
          {diagOpen && <DiagnosticsPanel get={getDiag} onClose={() => setDiagOpen(false)} />}
          {pickMode && <div className="pick-banner">Click the globe to choose a point · Esc to cancel</div>}
          <footer className="attribution">
            <span tabIndex={0} title={credits}>{credits}</span>
            <button className="link-btn" aria-expanded={creditsOpen} onClick={() => { setCreditsOpen(!creditsOpen); setLeftFloat(null); setDiagOpen(false); setHistoryOpen(false); setPage('globe'); }}>Credits</button>
          </footer>
          {creditsOpen && (
            <FloatingPanel className="credits-panel" title="Credits" onClose={() => setCreditsOpen(false)}>
              <p>{credits}</p>
              <ModelCredits />
            </FloatingPanel>
          )}

        </section>

        {page !== 'globe' && !widePage && (
          <FloatingPanel className="narrow-page page-panel" title={NAV.find(entry => entry.id === page)?.label ?? page} onClose={() => setPage('globe')}>
            <PageView page={page} ctx={pageCtx!} airport={airportSel} />
          </FloatingPanel>
        )}
        {widePage && (
          <section className="wide-page" aria-label={NAV.find((entry) => entry.id === page)?.label}>
            <div className={'wide-page-content ' + (page === 'social' ? 'community-column' : '')}>
              <PageView page={page} ctx={pageCtx!} airport={airportSel} />
            </div>
          </section>
        )}
      </main>

      <HistoryDrawer snap={snap} open={historyOpen} onToggle={() => { if (playbackOn) exitPlayback(); setHistoryOpen(!historyOpen); }}
        search={search} onOpenRecord={(r) => selectCoreSelection({ kind: 'history', record: r })}
        onReplay={(r) => startPlayback(r.lastObservedAt, { kind: r.kind, id: r.sourceId })} onOpenSettings={() => setDialog({ kind: 'settings' })} />

      {form && (
        <LocationForm
          key={form.existing?.id ?? 'new'}
          existing={form.existing}
          categories={categories}
          picked={picked}
          pickMode={pickMode}
          onPickMode={setPickMode}
          onClose={() => {
            setPickMode(false);
            setForm(null);
          }}
          onSaved={(loc) => {
            setForm(null);
            setPickMode(false);
            selectCoreSelection({ kind: 'location', id: loc.id });
            setToast(`Saved “${loc.name}”`);
          }}
        />
      )}
      {dialog?.kind === 'providers' && <ProvidersDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <CsvImportDialog existing={snap.locations} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <SettingsDialog settings={snap.settings} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'briefing' && <BriefingDialog locations={snap.locations} initial={dialog.ids} initialMode={dialog.mode} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'ai' && (
        <AiDialog
          snap={snap}
          selectedLocationId={selectedLocationId}
          onClose={() => setDialog(null)}
          onOpenSettings={() => setDialog({ kind: 'settings' })}
          onSelectRecord={(id) => {
            setDialog(null);
            selectCoreSelection(snap.alerts.some((a) => a.id === id) ? { kind: 'alert', id } : { kind: 'quake', id });
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal
          title="Delete location"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const loc = dialog.loc;
                  setDialog(null);
                  try {
                    await api.deleteLocation(loc.id);
                    setSelection(null);
                    setToast(`Deleted “${loc.name}”`);
                  } catch (e) {
                    setToast(errorText(e));
                  }
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{dialog.loc.name}</strong>? This cannot be undone. Event history is not affected.
          </p>
        </Modal>
      )}
      {scenes.surface && <Modal title="Restore imagery surface" onClose={scenes.cancelSurface}
        footer={<><button className="btn" onClick={scenes.cancelSurface}>Cancel</button>
          <button className="btn" onClick={() => scenes.chooseSurface(false)}>Keep current surface</button>
          <button className="btn primary" onClick={() => scenes.chooseSurface(true)}>Use saved surface</button></>}>
        <p>This view uses {BASEMAP_CREDIT[scenes.surface] ?? scenes.surface}. Switching to this surface can use your provider account or licensed imagery.</p>
      </Modal>}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
