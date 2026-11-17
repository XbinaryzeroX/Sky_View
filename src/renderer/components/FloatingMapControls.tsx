// Floating map chrome uses only existing Atlas Watch actions.
import { Activity, Camera, ChartNoAxesCombined, Crosshair, Earth, Ellipsis, Gauge, History, Keyboard, LayoutGrid, Layers, MapPin, Maximize, Minus, Navigation, Plus, Rotate3d, RotateCcw, Share2, SlidersHorizontal, Sparkles, Star, SunMoon, View, X, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type LeftMapPanel = 'layers' | 'places' | 'scenes' | 'lighting' | null;
interface Props {
  left: LeftMapPanel;
  solarLighting: boolean;
  onLeft(panel: LeftMapPanel): void;
  dataOpen: boolean;
  onData(): void;
  toolsOpen: boolean;
  onTools(): void;
  onAi(): void;
  onCameras(): void;
  camerasOn: boolean;
  onBrowseCameras(): void;
  diagnosticsOpen: boolean;
  onDiagnostics(): void;
  hudOn: boolean;
  onHud(): void;
  onPlayback(): void;
  playbackActive: boolean;
  kiosk: boolean;
  onKiosk(): void;
  onScreenshot(): void;
  onShare(): void;
  onWatchlist(): void;
  onZoom(direction: 1 | -1): void;
  onNorth(): void;
  getHeading(): number | null;
  /** Straight down or 35° oblique. */
  onTilt(): void;
  getTilted(): boolean;
  /** Worldwide layers and a whole-globe view; switching it off brings the previous view and layers back. */
  globalPicture: boolean;
  onGlobalPicture(): void;
  onReset(): void;
  onHome(): void;
  keyboardOpen: boolean;
  onKeyboard(): void;
}

function Action({ icon: Icon, label, onClick, active, expanded, iconOnly = false, rotation }: {
  icon: LucideIcon; label: string; onClick(): void; active?: boolean; expanded?: boolean; iconOnly?: boolean; rotation?: number;
}) {
  return (
    <button className={'map-action ' + (active ? 'active' : '')} title={label} aria-label={label}
      aria-pressed={active} aria-expanded={expanded} onClick={onClick}>
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" style={rotation === undefined ? undefined : { transform: `rotate(${rotation}deg)` }} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

export function FloatingPanel({ title, onClose, children, className = '', headerAction, scrollResetKey }: {
  title: string; onClose(): void; children: ReactNode; className?: string; headerAction?: ReactNode; scrollResetKey?: unknown;
}) {
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scrollResetKey !== undefined && body.current) body.current.scrollTop = 0; }, [scrollResetKey]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const surface = panel.current;
    return () => {
      if (document.activeElement === document.body || surface?.contains(document.activeElement)) opener?.focus?.();
    };
  }, []);
  return (
    <section ref={panel} className={'floating-panel ' + className} aria-label={title} data-floating-panel>
      <header className="floating-panel-head">
        <strong>{title}</strong>
        {headerAction}
        <button className="icon-btn" title={'Close ' + title} aria-label={'Close ' + title} onClick={onClose}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="floating-panel-body" ref={body}>{children}</div>
    </section>
  );
}

export function FloatingMapControls(p: Props) {
  const [heading, setHeading] = useState<number | null>(null);
  const [tilted, setTilted] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // The More menu closes on Escape and on a click anywhere else.
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMore(false); };
    const onDown = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [more]);
  useEffect(() => {
    const update = () => { setHeading(p.getHeading()); setTilted(p.getTilted()); };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [p.getHeading, p.getTilted]);
  return (
    <>
      <div className="map-top-left float-pill">
        <Action icon={Layers} label="Layers" onClick={() => p.onLeft('layers')} expanded={p.left === 'layers'} active={p.left === 'layers'} />
        <Action icon={SunMoon} label="Day/night" onClick={() => p.onLeft('lighting')} expanded={p.left === 'lighting'} active={p.solarLighting} />
      </div>
      <div className="map-top-right float-pill">
        <Action icon={Sparkles} label="Ask AI" onClick={p.onAi} iconOnly />
        <Action icon={SlidersHorizontal} label="Map tools" onClick={p.onTools} expanded={p.toolsOpen} active={p.toolsOpen} iconOnly />
        <Action icon={ChartNoAxesCombined} label="Data" onClick={p.onData} expanded={p.dataOpen} active={p.dataOpen} />
      </div>
      <div className="map-bottom-left float-pill" role="toolbar" aria-label="Places, scenes and cameras">
        <Action icon={MapPin} label="Places" onClick={() => p.onLeft('places')} expanded={p.left === 'places'} active={p.left === 'places'} />
        <Action icon={View} label="Scenes" onClick={() => p.onLeft('scenes')} expanded={p.left === 'scenes'} active={p.left === 'scenes'} />
        <span className="map-divider" />
        <Action icon={Camera} label="Cameras on map" onClick={p.onCameras} active={p.camerasOn} iconOnly />
        <Action icon={LayoutGrid} label="Browse all cameras" onClick={p.onBrowseCameras} iconOnly />
      </div>
      <div className="map-bottom-toolbar float-pill" role="toolbar" aria-label="Map actions">
        <Action icon={History} label="Playback / History" onClick={p.onPlayback} active={p.playbackActive} />
        <Action icon={Star} label="Watchlist" onClick={p.onWatchlist} />
        <Action icon={Gauge} label="HUD" onClick={p.onHud} active={p.hudOn} />
        <Action icon={Earth} label={p.globalPicture ? 'Leave global picture' : 'Global picture'} onClick={p.onGlobalPicture} active={p.globalPicture} iconOnly />
        <span className="map-divider" />
        <div className="map-more" ref={moreRef}>
          <Action icon={Ellipsis} label="More" onClick={() => setMore(!more)} expanded={more} active={more || p.diagnosticsOpen || p.kiosk} iconOnly />
          {more && (
            <div className="map-more-menu" role="menu" aria-label="More map actions">
              <button role="menuitem" className="map-action" onClick={() => { setMore(false); p.onScreenshot(); }}><Camera size={16} strokeWidth={1.75} aria-hidden="true" /><span>Screenshot</span></button>
              <button role="menuitem" className="map-action" onClick={() => { setMore(false); p.onShare(); }}><Share2 size={16} strokeWidth={1.75} aria-hidden="true" /><span>Share scene</span></button>
              <button role="menuitem" className={'map-action ' + (p.kiosk ? 'active' : '')} aria-pressed={p.kiosk} onClick={() => { setMore(false); p.onKiosk(); }}><Maximize size={16} strokeWidth={1.75} aria-hidden="true" /><span>Kiosk</span></button>
              <button role="menuitem" className={'map-action ' + (p.diagnosticsOpen ? 'active' : '')} aria-pressed={p.diagnosticsOpen} onClick={() => { setMore(false); p.onDiagnostics(); }}><Activity size={16} strokeWidth={1.75} aria-hidden="true" /><span>Diagnostics</span></button>
            </div>
          )}
        </div>
      </div>
      <div className="map-zoom-stack float-pill" role="toolbar" aria-label="Map view controls">
        <Action icon={Plus} label="Zoom in" onClick={() => p.onZoom(1)} iconOnly />
        <Action icon={Minus} label="Zoom out" onClick={() => p.onZoom(-1)} iconOnly />
        <Action icon={Navigation} label="North up" onClick={p.onNorth} rotation={heading === null ? 0 : -heading * 180 / Math.PI} iconOnly />
        <Action icon={Rotate3d} label={tilted ? 'Look straight down' : 'Tilt view 35°'} onClick={p.onTilt} active={tilted} iconOnly />
        <Action icon={RotateCcw} label="Reset view" onClick={p.onReset} iconOnly />
        <Action icon={Crosshair} label="Go to home or selected object" onClick={p.onHome} iconOnly />
        <Action icon={Keyboard} label="Keyboard shortcuts" onClick={p.onKeyboard} expanded={p.keyboardOpen} iconOnly />
      </div>
    </>
  );
}
