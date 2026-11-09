import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAlertCountable } from '../shared/dedupe';
import type { AlertSeverity, AppSnapshot, SavedLocation, Settings } from '../shared/types';
import { AiDialog } from './components/AiDialog';
import { BriefingDialog } from './components/BriefingDialog';
import { FreshnessChip, Modal } from './components/common';
import { CsvImportDialog } from './components/CsvImportDialog';
import { DetailsPanel, type Selection } from './components/DetailsPanel';
import { Globe, type GlobeHandle, type GlobeLayers, type GlobeSelection } from './components/Globe';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { Hud } from './components/Hud';
import { LayersPanel } from './components/LayersPanel';
import { PlaybackBar } from './components/PlaybackBar';
import { ProvidersDialog } from './components/ProvidersDialog';
import { RecordDetails } from './components/RecordDetails';
import { SearchBox } from './components/SearchBox';
import { ToolsPanel, measurementText } from './components/ToolsPanel';
import { AIRPORTS, NAV, PageView, type PageCtx, type PageId } from './components/Pages';
import { TrafficBar } from './components/TrafficBar';
import { DEFAULT_AIRCRAFT_FILTER, specialCode, type AircraftFilter } from '../shared/aircraft';
import type { SearchResult } from './components/SearchBox';
import type { WatchItem } from './lib/api';
import type { PlaybackFrame, ToolMode } from './components/Globe';
import type { LayerId, LayerSnapshot } from '../shared/layers';
import type { Annotation, SavedView, Scene } from './lib/api';
import { HistoryDrawer } from './components/HistoryDrawer';
import { LeftPanel } from './components/LeftPanel';
import { LocationForm } from './components/LocationForm';
import { SettingsDialog } from './components/SettingsDialog';
import { api, errorText } from './lib/api';
import { quakeClass, SEVERITY_META, SEVERITY_ORDER } from './lib/format';

const BASEMAP_CREDIT: Record<string, string> = {
  atlas: 'NASA Blue Marble (2004 composite) + USGS The National Map orthoimagery (U.S.); imagery is not live',
  usgsImageryTopo: 'USGS orthoimagery + US Topo (U.S.), NASA Blue Marble elsewhere; not live',
  usgsTopo: 'USGS topographic map (U.S.), NASA Blue Marble elsewhere',
  gibsDaily: 'NASA VIIRS NOAA-20 true color, previous UTC day (GIBS)',
  naturalEarth: 'Natural Earth II relief (bundled, offline, low resolution)',
  neutral: 'neutral',
  streets: '© OpenStreetMap contributors (ODbL), © OpenMapTiles, OpenFreeMap',
  esri: 'Esri World Imagery (Esri, Maxar, Earthstar Geographics) via your ArcGIS key; not live',
  mapbox: '© Mapbox © Maxar via your token; not live',
  eox: 'EOxCloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), your license',
  google3d: 'Google Photorealistic 3D Tiles (your key) over NASA/USGS imagery; not live',
};

type Dialog = { kind: 'providers' } | { kind: 'import' } | { kind: 'settings' } | { kind: 'briefing'; ids: string[] } | { kind: 'ai' } | { kind: 'delete'; loc: SavedLocation } | null;

export function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null);
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
  const [tracked, setTracked] = useState<{ layer: LayerId; id: string } | null>(null);
  const [trail, setTrail] = useState<{ lat: number; lon: number; altM: number | null }[] | null>(null);
  const [orbitFor, setOrbitFor] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>('none');
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [playbackOn, setPlaybackOn] = useState(false);
  const [playbackFrame, setPlaybackFrame] = useState<PlaybackFrame | null>(null);
  const [google3dKey, setGoogle3dKey] = useState<string | null>(null);
  const [imageryKeys, setImageryKeys] = useState<{ esri: string | null; mapbox: string | null; google: string | null }>({ esri: null, mapbox: null, google: null });
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [eoxLicensed, setEoxLicensed] = useState(false);
  const [page, setPage] = useState<PageId>('globe');
  const [airportSel, setAirportSel] = useState<string | null>(null);
  const [aircraftFilter, setAircraftFilter] = useState<AircraftFilter>(DEFAULT_AIRCRAFT_FILTER);
  const [vesselClasses, setVesselClasses] = useState<string[]>(['cargo', 'tanker', 'passenger', 'fishing', 'other']);
  const [showAirports, setShowAirports] = useState(true);
  const [sceneMode, setSceneMode] = useState<'3d' | '2d'>('3d');
  const [watchlist, setWatchlistState] = useState<WatchItem[]>([]);
  const [kiosk, setKiosk] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
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
  const getDiag = useCallback(() => globeRef.current?.getDiagnostics() ?? null, []);
  useEffect(() => {
    // Renderer-only camera hooks used by automated smoke tests (no privileged access).
    (window as unknown as { __atlasDebug: unknown }).__atlasDebug = {
      setView: (lat: number, lon: number, h: number, pitch?: number) => globeRef.current?.setView(lat, lon, h, pitch),
      diag: () => globeRef.current?.getDiagnostics() ?? null,
      setSceneMode: (m: '2d' | '3d') => setSceneMode(m),
      select: (layer: LayerId, id: string) => setRecordSel({ layer, id }),
      track: (layer: LayerId, id: string) => setTracked({ layer, id }),
      records: (layer: LayerId) => (layerSnapsRef.current[layer]?.records ?? []).slice(0, 2000).map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, label: r.label, imageUrl: r.imageUrl ?? null })),
    };
  }, []);
  const globeRef = useRef<GlobeHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const smoke = useRef<Record<string, unknown>>({ globeReady: false, errors: [] as string[] });

  useEffect(() => {
    let unsub = () => {};
    api
      .getState()
      .then((s) => {
        setSnap(s);
        unsub = api.onState(setSnap);
      })
      .catch((e) => setLoadError(errorText(e)));
    const onErr = (e: ErrorEvent) => (smoke.current.errors as string[]).push(e.message);
    window.addEventListener('error', onErr);
    return () => {
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
    void api.trackTrail(tracked.layer, tracked.id).then((pts) => setTrail(pts.map((p) => ({ lat: p.lat, lon: p.lon, altM: p.altM }))));
  }, [tracked, tracked ? layerSnaps[tracked.layer]?.status.lastSuccessAt : null]);

  // Google Photorealistic 3D: only when the user chose it and configured their own key.
  useEffect(() => {
    if (snap?.settings.basemap !== ('google3d' as never)) {
      setGoogle3dKey(null);
      return;
    }
    void api.providerBrowserKey('google3d').then((k) => {
      setGoogle3dKey(k);
      if (!k) setToast('Google Photorealistic 3D needs your own Google Maps key (Provider settings). Showing keyless imagery instead.');
    });
  }, [snap?.settings.basemap]);

  // Customer imagery credentials are fetched only when the chosen surface needs them (and again after Provider settings closes).
  useEffect(() => {
    const b = snap?.settings.basemap;
    void (async () => {
      const esri = b === 'esri' ? await api.providerBrowserKey('esri-imagery') : null;
      const mapbox = b === 'mapbox' ? await api.providerBrowserKey('mapbox') : null;
      const google = b === 'google2d' ? await api.providerBrowserKey('google3d') : null;
      const list = await api.listProviders();
      const eox = b === 'eox' ? list.some((p) => p.id === 'eox' && p.configured) : false;
      setGoogleConfigured(list.some((p) => p.id === 'google3d' && p.configured));
      setImageryKeys({ esri, mapbox, google });
      setEoxLicensed(eox);
      if ((b === 'esri' && !esri) || (b === 'mapbox' && !mapbox) || (b === 'eox' && !eox) || (b === 'google2d' && !google)) setToast('That imagery source needs setup in Providers. Showing keyless imagery meanwhile.');
    })();
  }, [snap?.settings.basemap, dialog === null]);

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
    if (recordSel) return { kind: 'record', layer: recordSel.layer, id: recordSel.id };
    if (!selection) return null;
    if (selection.kind === 'history') return { kind: selection.record.kind === 'alert' ? 'alert' : 'quake', id: selection.record.sourceId };
    return selection;
  }, [selection, recordSel]);

  const focusSelection = useCallback(
    (sel: Selection | null) => {
      setSelection(sel);
      if (!snap || !sel) return;
      if (sel.kind === 'location') {
        const l = snap.locations.find((x) => x.id === sel.id);
        if (l) globeRef.current?.focus(l.lat, l.lon, l.radiusKm);
      }
    },
    [snap],
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
  const currentScene = (): Scene | null => {
    const cam = globeRef.current?.getCamera();
    if (!cam || !snap) return null;
    return {
      format: 'atlas-watch-scene',
      version: 1,
      createdAt: new Date().toISOString(),
      camera: cam,
      basemap: snap.settings.basemap,
      terrainEnabled: snap.settings.terrainEnabled,
      layersEnabled: snap.settings.layersEnabled as LayerId[],
      visualMode: snap.settings.visualMode,
      annotations,
      views,
    };
  };
  const applyScene = async (sc: Scene) => {
    await patchSettings({ basemap: sc.basemap, terrainEnabled: sc.terrainEnabled, layersEnabled: sc.layersEnabled, visualMode: sc.visualMode });
    for (const a of sc.annotations) await api.putAnnotation(a);
    for (const v of sc.views) await api.putView(v);
    setAnnotations(await api.listAnnotations());
    setViews(await api.listViews());
    globeRef.current?.setCamera(sc.camera);
  };
  const LAYER_CREDIT: Record<string, string> = {
    aircraft: 'Aircraft: adsb.lol (ODbL)',
    aircraftMil: 'Military flags: adsb.lol (ODbL)',
    vessels: 'AIS: Fintraffic / digitraffic.fi, CC BY 4.0',
    satellites: 'Orbital elements: CelesTrak (positions calculated)',
    fires: 'Fires: NASA FIRMS',
    firePerimeters: 'Perimeters: NIFC WFIGS',
    metar: 'METAR: NOAA AWC',
    cyclones: 'Cyclones: NOAA NHC',
    cameras: 'Cameras: Caltrans; Fintraffic / digitraffic.fi, CC BY 4.0',
    transit: 'Transit: MBTA',
    airspace: 'Airspace: FAA',
  };
  const layerCredits = snap
    ? [...(snap.settings.layersEnabled as string[]).map((l) => LAYER_CREDIT[l]).filter(Boolean), ...(snap.settings.radarEnabled ? ['Radar: NOAA nowCOAST'] : [])].join(' · ')
    : '';
  const allAircraftLoaded = [...new Map([...(layerSnaps.aircraft?.records ?? []), ...(layerSnaps.aircraftMil?.records ?? [])].map((r) => [r.id, r])).values()];
  const notifications = (() => {
    if (!snap) return [];
    const out: { key: string; tag: string; sev: string; title: string; meta: string; go(): void }[] = [];
    for (const r of allAircraftLoaded.filter((x) => specialCode(x)))
      out.push({ key: 'sq-' + r.id, tag: String(r.props.squawk ?? r.props.emergency), sev: 'sev-extreme', title: r.label, meta: specialCode(r)!.label + ' (reported)', go: () => { globeRef.current?.focus(r.lat, r.lon, 30); setRecordSel({ layer: 'aircraft', id: r.id }); } });
    for (const l of snap.locations) {
      const n = snap.evaluations[l.id]?.alertsInside.length ?? 0;
      if (n) out.push({ key: 'loc-' + l.id, tag: 'Alert', sev: 'sev-severe', title: l.name, meta: `${n} active alert(s) at this saved place`, go: () => { setPage('globe'); setSelection({ kind: 'location', id: l.id }); } });
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
        patch: (p) => void patchSettings(p),
        selectRecord: (layer, id) => setRecordSel({ layer, id }),
        selectEvent: (kind, id) => {
          setRecordSel(null);
          setSelection({ kind, id } as never);
        },
        focus: (la, lo, r) => globeRef.current?.focus(la, lo, r),
        viewCenter: () => lastViewRef.current,
        viewBbox: () => lastViewRef.current?.bbox ?? null,
        watchlist,
        setWatchlist,
        openPlayback: () => { setToolsOpen(true); setPlaybackOn(true); },
        openAi: () => setDialog({ kind: 'ai' }),
        openSettings: () => setDialog({ kind: 'settings' }),
        openProviders: () => setDialog({ kind: 'providers' }),
        toast: setToast,
        enableLayers: (ids) => void patchSettings({ layersEnabled: [...new Set([...(snap.settings.layersEnabled as LayerId[]), ...ids])] as LayerId[] }),
      }
    : null;
  const selectedRecord = recordSel ? (layerSnaps[recordSel.layer]?.records.find((r) => r.id === recordSel.id) ?? null) : null;

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
  const selectedLocationId = selection?.kind === 'location' ? selection.id : null;
  const zoneOnly = globeAlerts.filter((a) => !a.geometry).length;
  const diffText = (['nws', 'usgs'] as const)
    .map((f) => {
      const d = snap.diffs[f];
      if (!d || !d.previousAt) return null;
      return `${f === 'nws' ? 'Alerts' : 'Quakes'}: +${d.added.length} new, ${d.updated.length} updated, ${d.removed.length} ended`;
    })
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`app ${historyOpen ? 'history-open' : ''} ${kiosk ? 'kiosk' : ''}`}>
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
        <SearchBox
          googleGeocoder={!!google3dKey || !!imageryKeys.google}
          inputRef={searchRef}
          value={search}
          onChange={setSearch}
          extra={searchExtra}
          onGo={(lat, lon, label, kind) => {
            globeRef.current?.focus(lat, lon, kind === 'address' ? 0.4 : kind === 'coords' ? 2 : 6);
            setToast(`Flying to ${label}`);
          }}
        />
        <div className="fresh-group" aria-label="Data freshness">
          <FreshnessChip label="NWS alerts" status={snap.feeds.nws} freshness={snap.freshness.nws} onRefresh={() => void api.refresh('nws')} />
          <FreshnessChip label="USGS quakes" status={snap.feeds.usgs} freshness={snap.freshness.usgs} onRefresh={() => void api.refresh('usgs')} />
        </div>
        <button className="btn" onClick={() => void api.refresh('all')} title="Refresh both feeds now">
          ⟳ Refresh
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => setDialog({ kind: 'briefing', ids: selectedLocationId ? [selectedLocationId] : [] })}>
          Briefing
        </button>
        <button className="btn" onClick={() => setDialog({ kind: 'ai' })} title={snap.settings.aiEnabled ? 'Ask the local AI' : 'Local AI is optional and turned off'}>
          Ask AI{!snap.settings.aiEnabled && <span className="muted small"> (off)</span>}
        </button>
        <div className="seg" role="group" aria-label="Map mode">
          <button className={`btn small-btn ${sceneMode === '2d' ? 'primary' : ''}`} onClick={() => setSceneMode('2d')} aria-pressed={sceneMode === '2d'}>
            Map
          </button>
          <button className={`btn small-btn ${sceneMode === '3d' ? 'primary' : ''}`} onClick={() => setSceneMode('3d')} aria-pressed={sceneMode === '3d'}>
            3D
          </button>
          <button
            className="btn small-btn"
            title="Air-traffic view: aircraft layers, airports and altitude colors (no ATC audio: no authorized audio source is included)"
            onClick={() => {
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
            className={`btn small-btn ${snap.settings.basemap === 'google2d' ? 'primary' : ''}`}
            aria-pressed={snap.settings.basemap === 'google2d'}
            title={googleConfigured ? 'Google satellite imagery worldwide (your Google key; billed per tile)' : 'Needs your Google Maps key: opens Providers'}
            onClick={() => {
              if (!googleConfigured) return setDialog({ kind: 'providers' } as never);
              void patchSettings({ basemap: snap.settings.basemap === 'google2d' ? 'atlas' : 'google2d' });
            }}
          >
            Satellite
          </button>
          <button
            className={`btn small-btn ${snap.settings.basemap === 'google3d' ? 'primary' : ''}`}
            aria-pressed={snap.settings.basemap === 'google3d'}
            title={googleConfigured ? 'Google Photorealistic 3D cities (your Google key; billed per session)' : 'Needs your Google Maps key: opens Providers'}
            onClick={() => {
              if (!googleConfigured) return setDialog({ kind: 'providers' } as never);
              setSceneMode('3d');
              void patchSettings({ basemap: snap.settings.basemap === 'google3d' ? 'atlas' : 'google3d' });
            }}
          >
            Photoreal 3D
          </button>
        </div>
        <button className="btn" onClick={() => setPage('airports')} title="Airports">
          Airports
        </button>
        <button className="btn" onClick={() => setPage('replays')} title="Recorded movement playback">
          History
        </button>
        <div className="bell-wrap">
          <button className={`icon-btn ${notifications.length ? 'bell-on' : ''}`} onClick={() => setBellOpen(!bellOpen)} aria-label={`Notifications (${notifications.length})`} title="Notifications">
            🔔{notifications.length ? <span className="bell-count">{notifications.length}</span> : null}
          </button>
          {bellOpen && (
            <div className="bell-pop">
              <div className="diag-sub">Notifications</div>
              {notifications.length === 0 ? <p className="muted small">Nothing needs attention in the loaded data.</p> : null}
              <ul className="rec-list">
                {notifications.map((n) => (
                  <li key={n.key}>
                    <button className="rec-item" onClick={() => { n.go(); setBellOpen(false); }}>
                      <span className={`tag ${n.sev}`}>{n.tag}</span>
                      <span className="rec-title">{n.title}</span>
                      <span className="rec-meta">{n.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => setDialog({ kind: 'providers' })} title="Data providers, credentials and connection tests">
          Providers
        </button>
        <button className="icon-btn" onClick={() => setDialog({ kind: 'settings' })} aria-label="Settings" title="Settings">
          ⚙
        </button>
      </header>

      <main className="workspace">
        <nav className="nav-rail" aria-label="Sections">
          {NAV.map((n, i) => (
            <span key={n.id}>
              {i > 0 && NAV[i - 1].group !== n.group && <span className="nav-divider" role="separator" aria-label={n.group} />}
              <button className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)} title={n.label} aria-label={n.label} aria-current={page === n.id ? 'page' : undefined}>
                <span className="nav-icon" aria-hidden="true">{n.icon}</span>
                <span className="nav-label" aria-hidden="true">{n.short}</span>
              </button>
            </span>
          ))}
        </nav>
        {page !== 'globe' ? (
          <aside className="panel left-panel page-panel" aria-label={NAV.find((n) => n.id === page)?.label}>
            <PageView page={page} ctx={pageCtx!} airport={airportSel} />
          </aside>
        ) : (
        <LeftPanel
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
          <LayersPanel settings={snap.settings} snaps={layerSnaps} onPatch={(p) => void patchSettings(p)} />
        </LeftPanel>
        )}

        <section className="center" aria-label="Globe">
          <Globe
            ref={globeRef}
            alerts={globeAlerts}
            quakes={globeQuakes}
            locations={snap.locations}
            layers={layers}
            settings={snap.settings}
            selection={globeSelection}
            pickMode={pickMode}
            onSelect={(s) => {
              if (s?.kind === 'airport') {
                setAirportSel(s.id);
                setPage('airports');
                return;
              }
              if (s?.kind === 'record') {
                setRecordSel({ layer: s.layer, id: s.id });
                setSelection(null);
              } else {
                setRecordSel(null);
                setSelection(s as Selection | null);
              }
            }}
            onPick={(lat, lon) => {
              setPicked({ lat, lon });
              setPickMode(false);
              if (!form) setForm({ existing: null });
            }}
            layerSnaps={layerSnaps}
            layersOn={snap.settings.layersEnabled as LayerId[]}
            trail={trail}
            trailAirborne={tracked?.layer === 'aircraft' || tracked?.layer === 'aircraftMil'}
            trackedRecord={tracked}
            showOrbitFor={orbitFor}
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
            google3dKey={google3dKey}
            imageryKeys={imageryKeys}
            onProviderError={setToast}
            eoxLicensed={eoxLicensed}
            aircraftFilter={aircraftFilter}
            vesselClasses={vesselClasses}
            showAirports={showAirports}
            sceneMode={sceneMode}
            onReady={(ok, err) => {
              if (ok) {
                try {
                  const raw = localStorage.getItem('atlas.lastCamera');
                  const cam = raw ? JSON.parse(raw) : null;
                  if (cam && typeof cam.lat === 'number') setTimeout(() => globeRef.current?.setCamera(cam, false), 0);
                } catch {
                  // ignore
                }
              }
              smoke.current.globeReady = ok;
              if (err) (smoke.current.errors as string[]).push(err);
            }}
          />
          <div className="globe-controls" role="toolbar" aria-label="Globe view controls">
            <button className="btn" onClick={() => globeRef.current?.flyRegion('us')} title="Show all 50 states">
              U.S.
            </button>
            <button className="btn" onClick={() => globeRef.current?.flyRegion('lower48')}>
              Lower 48
            </button>
            <button className="btn" onClick={() => globeRef.current?.flyRegion('alaska')}>
              Alaska
            </button>
            <button className="btn" onClick={() => globeRef.current?.flyRegion('hawaii')}>
              Hawaii
            </button>
            <span className="sep" />
            <button className="btn" onClick={() => globeRef.current?.northUp()} title="Rotate so north is up">
              N↑
            </button>
            <button className="btn" onClick={() => globeRef.current?.flyHome()} title="Reset view">
              Reset
            </button>
            <button className="btn" onClick={() => globeRef.current?.zoom(1)} aria-label="Zoom in">
              +
            </button>
            <button className="btn" onClick={() => globeRef.current?.zoom(-1)} aria-label="Zoom out">
              −
            </button>
            <span className="sep" />
            <button className={`btn ${diagOpen ? 'primary' : ''}`} onClick={() => setDiagOpen(!diagOpen)} aria-pressed={diagOpen} title="Map diagnostics (Ctrl+Shift+D)">
              Diag
            </button>
            <button className={`btn ${toolsOpen ? 'primary' : ''}`} onClick={() => setToolsOpen(!toolsOpen)} aria-pressed={toolsOpen} title="Measure, draw, saved views, scenes, display style, playback">
              Tools
            </button>
            <button className={`btn ${showAirports ? 'primary' : ''}`} onClick={() => setShowAirports(!showAirports)} aria-pressed={showAirports} title="Airport markers (OurAirports)">
              Airports
            </button>
            <button
              className="btn"
              title="Locate: fly to home (Settings) or the selected object"
              onClick={() => {
                const s = snap.settings;
                if (selectedRecord) globeRef.current?.focus(selectedRecord.lat, selectedRecord.lon, 20);
                else if (s.homeLat !== null && s.homeLon !== null) globeRef.current?.focus(s.homeLat, s.homeLon, 20);
                else setToast('Set a home location in Settings, or select an object.');
              }}
            >
              ⌖
            </button>
            <button className="btn" title="Save a PNG screenshot of the window" onClick={() => void api.captureScreenshot().then((p) => p && setToast(`Saved ${p}`))}>
              ⎙
            </button>
            <button
              className={`btn ${kiosk ? 'primary' : ''}`}
              title="Kiosk: full screen, globe only (Esc or button to exit)"
              onClick={() => {
                const on = !kiosk;
                setKiosk(on);
                void api.setKiosk(on);
              }}
            >
              ⛶
            </button>
          </div>
          <TrafficBar
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
          />
          <Hud get={getDiag} snaps={layerSnaps} layersOn={snap.settings.layersEnabled as LayerId[]} mode={snap.settings.visualMode} playbackTime={playbackOn ? (playbackFrame?.t ?? null) : null} />
          {toolsOpen && (
            <ToolsPanel
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
              onAnnotationDelete={(id) => {
                setAnnotations((prev) => prev.filter((a) => a.id !== id));
                void api.deleteAnnotation(id);
              }}
              onFlyTo={(lon, lat) => globeRef.current?.focus(lat, lon, 2)}
              views={views}
              onSaveView={(name) => {
                const cam = globeRef.current?.getCamera();
                if (!cam) return;
                const v: SavedView = { id: crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, ''), name, camera: cam, basemap: snap.settings.basemap, layersEnabled: snap.settings.layersEnabled as LayerId[], createdAt: new Date().toISOString() };
                void api.putView(v).then(() => setViews((prev) => [...prev, v]));
              }}
              onRestoreView={(v) => {
                void patchSettings({ layersEnabled: v.layersEnabled, basemap: v.basemap as never });
                globeRef.current?.setCamera(v.camera);
              }}
              onDeleteView={(id) => {
                setViews((prev) => prev.filter((v) => v.id !== id));
                void api.deleteView(id);
              }}
              onExportScene={async () => {
                const sc = currentScene();
                if (!sc) return;
                try {
                  const p = await api.exportScene(sc);
                  if (p) setToast(`Scene saved to ${p}`);
                } catch (e) {
                  setToast(errorText(e));
                }
              }}
              onImportScene={async () => {
                try {
                  const sc = await api.importScene();
                  if (sc) {
                    await applyScene(sc);
                    setToast('Scene imported');
                  }
                } catch (e) {
                  setToast(errorText(e));
                }
              }}
              settings={snap.settings}
              onPatch={(p) => void patchSettings(p)}
              onClose={() => {
                setToolsOpen(false);
                setTool('none');
                setDraft([]);
              }}
              onPlayback={() => setPlaybackOn(!playbackOn)}
              playbackActive={playbackOn}
            />
          )}
          {playbackOn && <PlaybackBar onFrame={setPlaybackFrame} onExit={() => setPlaybackOn(false)} />}
          {diagOpen && <DiagnosticsPanel get={getDiag} onClose={() => setDiagOpen(false)} />}
          {pickMode && <div className="pick-banner">Click the globe to choose a point · Esc to cancel</div>}
          <div className="legend" aria-label="Legend">
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
              {zoneOnly > 0 && ` ${zoneOnly} zone-based alert(s) have no polygon and are not drawn; they are still evaluated for saved locations.`}
            </div>
          </div>
          <div className="attribution">
            Alerts: NWS/NOAA · Earthquakes: USGS · Surface: {BASEMAP_CREDIT[snap.settings.basemap] ?? 'neutral'}{snap.settings.labelsOverlay && snap.settings.basemap !== 'streets' ? ' · Labels/roads: © OpenStreetMap contributors, © OpenMapTiles (OpenFreeMap)' : ''}{snap.settings.buildings3d ? ' · Buildings: OpenStreetMap (heights may be estimated)' : ''}{snap.settings.terrainEnabled ? ' · Terrain: Mapzen Terrain Tiles (AWS Open Data; 3DEP, SRTM, GMTED, ETOPO1, EU-DEM)' : ''} · Boundaries: U.S. Census Bureau, Natural Earth · Globe: CesiumJS
            {layerCredits && <div>{layerCredits}</div>}
            {diffText && <div className="diff-line">Since previous refresh — {diffText}</div>}
          </div>
        </section>

        {recordSel ? (
          <aside className="panel right-panel" aria-label="Details">
            <button className="link-btn back" onClick={() => setRecordSel(null)}>
              ← Overview
            </button>
            <RecordDetails
              layer={recordSel.layer}
              record={selectedRecord}
              snaps={layerSnaps}
              tracked={tracked?.layer === recordSel.layer && tracked.id === recordSel.id}
              watched={watchlist.some((w) => w.id === recordSel.id && (w.kind === 'vessel') === (recordSel.layer === 'vessels'))}
              onWatch={(on) => {
                const kind = recordSel.layer === 'vessels' ? 'vessel' : 'aircraft';
                if (on) setWatchlist([...watchlist, { kind, id: recordSel.id, label: selectedRecord?.label ?? recordSel.id, addedAt: new Date().toISOString() }]);
                else setWatchlist(watchlist.filter((w) => !(w.kind === kind && w.id === recordSel.id)));
              }}
              orbitShown={orbitFor === recordSel.id && recordSel.layer === 'satellites'}
              onTrack={(on) => setTracked(on ? recordSel : null)}
              onOrbit={(on) => setOrbitFor(on ? recordSel.id : null)}
              onSelect={(layer, id) => setRecordSel({ layer, id })}
              onFocus={(lat, lon, r) => globeRef.current?.focus(lat, lon, r)}
            />
          </aside>
        ) : (
        <DetailsPanel
          snap={snap}
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
      </main>

      <HistoryDrawer snap={snap} open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} search={search} onOpenRecord={(r) => setSelection({ kind: 'history', record: r })} onOpenSettings={() => setDialog({ kind: 'settings' })} />

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
            setSelection({ kind: 'location', id: loc.id });
            setToast(`Saved “${loc.name}”`);
          }}
        />
      )}
      {dialog?.kind === 'providers' && <ProvidersDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <CsvImportDialog existing={snap.locations} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'settings' && <SettingsDialog settings={snap.settings} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'briefing' && <BriefingDialog locations={snap.locations} initial={dialog.ids} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'ai' && (
        <AiDialog
          snap={snap}
          selectedLocationId={selectedLocationId}
          onClose={() => setDialog(null)}
          onOpenSettings={() => setDialog({ kind: 'settings' })}
          onSelectRecord={(id) => {
            setDialog(null);
            setSelection(snap.alerts.some((a) => a.id === id) ? { kind: 'alert', id } : { kind: 'quake', id });
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
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
