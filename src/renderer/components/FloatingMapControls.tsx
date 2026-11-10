// Floating map chrome uses only existing Atlas Watch actions.
import { Activity, Camera, ChartNoAxesCombined, Crosshair, History, Keyboard, Layers, MapPin, Maximize, Minus, Navigation, Plus, RotateCcw, Share2, SlidersHorizontal, Sparkles, Star, View, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type LeftMapPanel = 'layers' | 'places' | 'scenes' | null;
interface Props {
  left: LeftMapPanel;
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

export function FloatingPanel({ title, onClose, children, className = '', headerAction }: {
  title: string; onClose(): void; children: ReactNode; className?: string; headerAction?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
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
      <div className="floating-panel-body">{children}</div>
    </section>
  );
}

export function FloatingMapControls(p: Props) {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setHeading(p.getHeading());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [p.getHeading]);
  return (
    <>
      <div className="map-top-left float-pill">
        <Action icon={Layers} label="Layers" onClick={() => p.onLeft('layers')} expanded={p.left === 'layers'} active={p.left === 'layers'} />
      </div>
      <div className="map-top-right float-pill">
        <Action icon={Sparkles} label="Ask AI" onClick={p.onAi} iconOnly />
        <Action icon={SlidersHorizontal} label="Map tools" onClick={p.onTools} expanded={p.toolsOpen} active={p.toolsOpen} iconOnly />
        <Action icon={ChartNoAxesCombined} label="Data" onClick={p.onData} expanded={p.dataOpen} active={p.dataOpen} />
      </div>
      <div className="map-bottom-left">
        <div className="float-pill">
          <Action icon={MapPin} label="Places" onClick={() => p.onLeft('places')} expanded={p.left === 'places'} active={p.left === 'places'} />
        </div>
        <div className="float-pill">
          <Action icon={View} label="Scenes" onClick={() => p.onLeft('scenes')} expanded={p.left === 'scenes'} active={p.left === 'scenes'} />
        </div>
        <div className="float-pill camera-pill">
          <Action icon={Camera} label="Cameras" onClick={p.onCameras} active={p.camerasOn} />
          <button className="link-btn browse-cameras" onClick={p.onBrowseCameras}>Browse all cameras</button>
        </div>
      </div>
      <div className="map-bottom-toolbar float-pill" role="toolbar" aria-label="Map actions">
        <Action icon={Activity} label="Diagnostics" onClick={p.onDiagnostics} active={p.diagnosticsOpen} />
        <Action icon={View} label="HUD" onClick={p.onHud} active={p.hudOn} />
        <span className="map-divider" />
        <Action icon={History} label="Playback / History" onClick={p.onPlayback} active={p.playbackActive} />
        <Action icon={Maximize} label="Kiosk" onClick={p.onKiosk} active={p.kiosk} />
        <span className="map-divider" />
        <Action icon={Camera} label="Screenshot" onClick={p.onScreenshot} />
        <Action icon={Share2} label="Share" onClick={p.onShare} />
        <Action icon={Star} label="Watchlist" onClick={p.onWatchlist} />
      </div>
      <div className="map-zoom-stack float-pill" role="toolbar" aria-label="Map view controls">
        <Action icon={Plus} label="Zoom in" onClick={() => p.onZoom(1)} iconOnly />
        <Action icon={Minus} label="Zoom out" onClick={() => p.onZoom(-1)} iconOnly />
        <Action icon={Navigation} label="North up" onClick={p.onNorth} rotation={heading === null ? 0 : -heading * 180 / Math.PI} iconOnly />
        <Action icon={RotateCcw} label="Reset view" onClick={p.onReset} iconOnly />
        <Action icon={Crosshair} label="Go to home or selected object" onClick={p.onHome} iconOnly />
        <Action icon={Keyboard} label="Keyboard shortcuts" onClick={p.onKeyboard} expanded={p.keyboardOpen} iconOnly />
      </div>
    </>
  );
}
