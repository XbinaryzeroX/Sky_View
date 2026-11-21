// Floating camera cards over the map: when zoomed in, the published stills of the nearest public cameras float above
// their positions with leader lines down to the camera, and other cameras in view carry a small tag. Pictures are
// the publisher's latest still, reloaded at the publisher's interval; nothing here is live video or analysis.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cartesian3, Cartographic, EllipsoidalOccluder, SceneTransforms, type CesiumWidget } from 'cesium';
import { CARD_H, CARD_W, cameraTag, camerasNear, NEXT_FRAME_COOLDOWN_MS, placeCameraCards, TAG_MAX_DISTANCE_M, type PlacedCard, type ScreenCamera } from '../../shared/cameraCards';
import { Maximize2, RefreshCw } from 'lucide-react';
import type { GeoRecord } from '../../shared/layers';
import { refreshedImageUrl } from '../lib/cameraRecovery';
import { relativeTime } from '../lib/format';

interface Props {
  widget: CesiumWidget | null;
  records: GeoRecord[];
  enabled: boolean;
  onOpen(id: string): void;
}

const UPDATE_MS = 16;
/** Terrain height lookups per update; the rest wait a frame (each one is a ray pick against the loaded tiles). */
const HEIGHT_LOOKUPS_PER_UPDATE = 24;

export function CameraCards({ widget, records, enabled, onOpen }: Props) {
  const [layout, setLayout] = useState<{ cards: PlacedCard[]; tags: ScreenCamera[] }>({ cards: [], tags: [] });
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const shown = useRef<Set<string>>(new Set());
  const groundCache = useRef(new Map<string, number>());
  useEffect(() => { groundCache.current.clear(); }, [records]);

  useEffect(() => {
    if (!widget || !enabled) { setLayout({ cards: [], tags: [] }); return; }
    const scene = widget.scene;
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      pending = undefined;
      last = performance.now();
      const here = widget.camera.positionCartographic;
      const height = here.height;
      if (height > TAG_MAX_DISTANCE_M) { shown.current = new Set(); setLayout((l) => (l.cards.length || l.tags.length ? { cards: [], tags: [] } : l)); return; }
      const canvas = scene.canvas;
      const eye = widget.camera.positionWC;
      // Horizon test from the camera position (an ellipsoid-radius shortcut fails at street height in mid-latitudes).
      const occluder = new EllipsoidalOccluder(scene.globe.ellipsoid, eye);
      const cams: ScreenCamera[] = [];
      let lookups = 0;
      for (const r of camerasNear(recordsRef.current, here.latitude * 180 / Math.PI, here.longitude * 180 / Math.PI, TAG_MAX_DISTANCE_M)) {
        // The camera's point on the street: loaded ground height, kept per camera so the anchor does not wobble.
        let ground = groundCache.current.get(r.id);
        if (ground === undefined && lookups < HEIGHT_LOOKUPS_PER_UPDATE) {
          lookups++;
          const h = scene.globe.getHeight(Cartographic.fromDegrees(r.lon, r.lat));
          if (h !== undefined) { ground = h; groundCache.current.set(r.id, h); }
        }
        const world = Cartesian3.fromDegrees(r.lon, r.lat, ground ?? 0);
        const distM = Cartesian3.distance(world, eye);
        if (distM > TAG_MAX_DISTANCE_M || !occluder.isPointVisible(world)) continue;
        const p = SceneTransforms.worldToWindowCoordinates(scene, world);
        if (p) cams.push({ id: r.id, x: p.x, y: p.y, hasImage: !!r.imageUrl, distM });
      }
      // Keep cards and tags off the floating panels (Layers, details, tools) so they never cover them.
      const box = canvas.getBoundingClientRect();
      const reserved = [...document.querySelectorAll('.floating-panel, .right-panel, .float-pill, .voice-control, .ask-planet, .radio-now, .hud')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - box.left - 8, top: r.top - box.top - 8, right: r.right - box.left + 8, bottom: r.bottom - box.top + 8 };
      }).filter((r) => r.right > r.left && r.bottom > r.top);
      const next = placeCameraCards(cams, canvas.clientWidth, canvas.clientHeight, undefined, reserved, shown.current);
      shown.current = new Set(next.cards.map((c) => c.id));
      setLayout(next);
    };
    // Every rendered frame, so cards stay on their street while the map moves instead of trailing behind it.
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(update, Math.max(0, UPDATE_MS - (performance.now() - last)));
    };
    const off = scene.postRender.addEventListener(schedule);
    update();
    return () => { off(); clearTimeout(pending); };
  }, [widget, enabled]);

  useEffect(() => { widget?.scene.requestRender(); }, [records, widget]);

  if (!enabled || (!layout.cards.length && !layout.tags.length)) return null;
  return (
    <div className="camera-cards" aria-label="Cameras in view">
      <svg className="camera-card-lines" aria-hidden="true">
        {layout.cards.map((c) => {
          return (
            <g key={c.id}>
              {/* A pin from the card straight down to the camera's point on the street. */}
              <line x1={c.x} y1={c.top + CARD_H} x2={c.x} y2={c.y} />
              <circle cx={c.x} cy={c.y} r={4} />
            </g>
          );
        })}
      </svg>
      {layout.tags.map((t) => (
        <button key={t.id} className="camera-tag" style={{ left: t.x + 8, top: t.y - 9 }} onClick={() => onOpen(t.id)} title={byId.get(t.id)?.label}>
          {cameraTag(t.id)}
        </button>
      ))}
      {layout.cards.map((c) => {
        const r = byId.get(c.id);
        return r ? <CameraCard key={c.id} record={r} card={c} onOpen={onOpen} /> : null;
      })}
    </div>
  );
}

function CameraCard({ record, card, onOpen }: { record: GeoRecord; card: PlacedCard; onOpen(id: string): void }) {
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [coolUntil, setCoolUntil] = useState(0);
  const [, setNow] = useState(0);
  const [zoom, setZoom] = useState({ scale: 1, x: 50, y: 50 });
  const cooling = coolUntil > Date.now();
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setNow(Date.now()), coolUntil - Date.now() + 20);
    return () => clearTimeout(t);
  }, [coolUntil, cooling]);
  const nextFrame = () => {
    if (Date.now() < coolUntil) return;
    setFailed(false);
    setTick((n) => n + 1);
    setCoolUntil(Date.now() + NEXT_FRAME_COOLDOWN_MS);
  };
  // Mouse wheel over the picture zooms the picture (1× to 4×) around the cursor instead of the map.
  const onWheel = (e: React.WheelEvent<HTMLElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setZoom((z) => ({ scale: Math.min(4, Math.max(1, z.scale * (e.deltaY < 0 ? 1.25 : 0.8))), x, y }));
  };
  const refreshMin = typeof record.props.updateFrequencyMin === 'number' ? record.props.updateFrequencyMin : 2;
  useEffect(() => {
    const t = setInterval(() => { setFailed(false); setTick((n) => n + 1); }, Math.max(60, refreshMin * 60) * 1000);
    return () => clearInterval(t);
  }, [refreshMin]);
  const src = useMemo(() => (record.imageUrl ? refreshedImageUrl(record.imageUrl, `card-${tick}`) : null), [record.imageUrl, tick]);
  const publisher = String(record.props.publisher ?? record.source);
  return (
    <div className="camera-card" style={{ left: card.left, top: card.top, width: CARD_W, height: CARD_H }} onMouseLeave={() => setZoom({ scale: 1, x: 50, y: 50 })}>
      <div className="camera-card-title">
        <span>{record.label}</span>
        <button className="camera-card-btn" onClick={nextFrame} disabled={cooling} aria-label={cooling ? 'Next frame available in a moment' : 'Load the next published frame'} title={cooling ? 'Wait 3 seconds between frames' : 'Next frame'}>
          <RefreshCw size={13} aria-hidden="true" className={cooling ? 'spin-once' : ''} />
        </button>
        <button className="camera-card-btn" onClick={() => onOpen(record.id)} aria-label={`Open camera ${record.label}`} title="Open details"><Maximize2 size={13} aria-hidden="true" /></button>
      </div>
      <div className="camera-card-image" onWheel={onWheel} title="Scroll to zoom the picture">
        {src && !failed
          ? <img src={src} alt={`Latest published still: ${record.label}`} loading="lazy" onLoad={() => setLoadedAt(new Date().toISOString())} onError={() => setFailed(true)}
              style={{ transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.x}% ${zoom.y}%` }} />
          : <span className="camera-card-missing">Image unavailable</span>}
        {zoom.scale > 1 && <span className="camera-card-zoom">{zoom.scale.toFixed(1)}×</span>}
      </div>
      <div className="camera-card-meta">{cameraTag(record.id)} · {publisher} · {loadedAt ? `still loaded ${relativeTime(loadedAt)}` : 'loading still…'}</div>
    </div>
  );
}
