// Top-down 2D map silhouettes for aircraft and vessel classes (original simple
// shapes drawn on canvas; no third-party artwork). Shapes point north and are
// rotated on the map by the reported track/heading. Size is bounded in pixels.

import type { AircraftSymbol, VesselSymbol } from '../../shared/vehicleClass';

type Draw = (g: CanvasRenderingContext2D) => void;

// Coordinates in a 64×64 box centred on (0,0), nose/bow toward -y.
const poly = (g: CanvasRenderingContext2D, pts: number[]) => {
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
};
const mirror = (half: number[]) => {
  // half: points on the right side from nose to tail; mirrored for the left side.
  const left: number[] = [];
  for (let i = half.length - 2; i >= 0; i -= 2) left.push(-half[i], half[i + 1]);
  return [...half, ...left];
};
const jet = (span: number, sweep: number, len: number, tail: number, rearEngines = false): Draw => (g) => {
  const L = len / 2;
  poly(g, mirror([0, -L, 3, -L + 6, 3.5, -6, span, -6 + sweep, span, -2 + sweep, 3.5, 4, 3, L - 8, tail, L - 2 + 0, tail, L, 1.5, L - 1, 0, L]));
  if (rearEngines) {
    g.rect(4, L - 16, 3, 7);
    g.rect(-7, L - 16, 3, 7);
  }
};

const AIRCRAFT: Record<AircraftSymbol, Draw> = {
  widebody: jet(29, 13, 58, 11),
  narrowbody: jet(24, 10, 50, 9),
  regional: jet(19, 7, 44, 8, true),
  bizjet: jet(15, 7, 34, 7, true),
  jet: jet(21, 9, 44, 8),
  turboprop: (g) => {
    poly(g, mirror([0, -22, 2.5, -17, 3, -5, 22, -5, 22, -1, 3, 0, 2.5, 15, 8, 18, 8, 21, 0, 21]));
    g.rect(6, -11, 2.5, 8);
    g.rect(-8.5, -11, 2.5, 8);
  },
  light: (g) => poly(g, mirror([0, -15, 2, -12, 2, -7, 17, -7, 17, -3, 2, -3, 1.5, 10, 6, 11, 6, 14, 0, 14])),
  propeller: jet(23, 2, 38, 9),
  seaplane: (g) => { jet(20, 1, 34, 8)(g); g.rect(6, -11, 2, 23); g.rect(-8, -11, 2, 23); },
  poweredlift: (g) => { jet(17, 2, 33, 7)(g); for (const x of [-15,15]) { g.moveTo(x + 8, -3); g.arc(x, -3, 8, 0, Math.PI * 2); } },
  gyroplane: (g) => { g.ellipse(0, -1, 4, 8, 0, 0, Math.PI * 2); g.rect(-15, -3, 30, 2); g.rect(-1, 4, 2, 11); g.rect(-4, 13, 8, 2); },
  glider: (g) => poly(g, mirror([0, -13, 1.5, -10, 1.5, -6, 30, -5, 30, -3, 1.5, -2, 1, 14, 5, 15, 5, 17, 0, 17])),
  helicopter: (g) => {
    g.ellipse(0, -2, 5.5, 9, 0, 0, Math.PI * 2);
    g.rect(-1.2, 6, 2.4, 15);
    g.rect(-4, 19, 8, 2.4);
    g.moveTo(17, -2);
    g.arc(0, -2, 17, 0, Math.PI * 2);
  },
  balloon: (g) => {
    g.arc(0, -3, 11, 0, Math.PI * 2);
    g.rect(-3, 10, 6, 5);
  },
  airship: (g) => { g.ellipse(0, -1, 8, 22, 0, 0, Math.PI * 2); poly(g, [-11, 20, 0, 13, 11, 20]); },
  parachute: (g) => { poly(g, [-20, 0, -14, -9, 0, -13, 14, -9, 20, 0, 0, 10]); g.rect(-2, 9, 4, 6); },
  drone: (g) => {
    poly(g, [0, -6, 6, 0, 0, 6, -6, 0]);
    for (const [x, y] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
      g.moveTo(x + 5, y);
      g.arc(x, y, 5, 0, Math.PI * 2);
    }
  },
  unknown: (g) => poly(g, [0, -16, 11, 12, 0, 6, -11, 12]),
};

const hull = (len: number, beam: number, bow: number): Draw => (g) => {
  const L = len / 2;
  poly(g, [0, -L, beam, -L + bow, beam, L - 2, beam - 1.5, L, -beam + 1.5, L, -beam, L - 2, -beam, -L + bow]);
};

const VESSELS: Record<VesselSymbol, Draw> = {
  cargo: (g) => {
    hull(50, 7, 12)(g);
    for (let y = -10; y <= 14; y += 6) g.rect(-5, y, 10, 4);
  },
  tanker: (g) => {
    hull(52, 8, 14)(g);
    g.moveTo(0, -12);
    g.lineTo(0, 18);
  },
  passenger: (g) => {
    hull(46, 8, 10)(g);
    g.rect(-5, -8, 10, 20);
  },
  highspeed: (g) => poly(g, [0, -18, 6, -4, 6, 16, -6, 16, -6, -4]),
  fishing: (g) => {
    hull(28, 6, 8)(g);
    g.moveTo(0, -4);
    g.lineTo(9, -14);
  },
  tug: (g) => {
    hull(24, 7.5, 7)(g);
    g.rect(-4, -3, 8, 6);
  },
  sailing: (g) => {
    hull(28, 5, 10)(g);
    poly(g, [0, -10, 9, 6, 0, 6]);
  },
  pleasure: hull(18, 4.5, 6),
  workboat: (g) => { hull(34, 8, 8)(g); g.rect(-5, -8, 10, 6); g.rect(-5, 10, 10, 2); },
  wingInGround: jet(20, 6, 42, 6),
  pilot: (g) => { hull(28, 6, 9)(g); g.rect(-3, -5, 6, 12); },
  service: (g) => {
    hull(26, 6, 8)(g);
    g.rect(-2, -6, 4, 10);
  },
  military: hull(48, 6.5, 16),
  unknown: (g) => {
    poly(g, [0, -14, 8, -2, 8, 12, -8, 12, -8, -2]);
  },
};

const cache = new Map<string, string>();

function render(draw: Draw, fill: string, size: number, outline = 'rgba(0,0,0,0.85)', ring?: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.scale(size / 64, size / 64);
  if (ring) {
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.strokeStyle = ring;
    g.lineWidth = 3;
    g.stroke();
  }
  g.beginPath();
  draw(g);
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = outline;
  g.stroke();
  g.fillStyle = fill;
  g.fill('nonzero');
  return c.toDataURL();
}

/** Data-URL image of an aircraft silhouette (pointing north). */
export function aircraftSymbol(sym: AircraftSymbol, fill: string, size = 40, highlight?: string): string {
  const key = `a|${sym}|${fill}|${size}|${highlight ?? ''}`;
  let v = cache.get(key);
  if (!v) cache.set(key, (v = render(AIRCRAFT[sym], fill, size, undefined, highlight)));
  return v;
}

/** Data-URL image of a vessel silhouette (bow north). */
export function vesselSymbol(sym: VesselSymbol, fill: string, size = 34, highlight?: string): string {
  const key = `v|${sym}|${fill}|${size}|${highlight ?? ''}`;
  let v = cache.get(key);
  if (!v) cache.set(key, (v = render(VESSELS[sym], fill, size, undefined, highlight)));
  return v;
}

export const AIRCRAFT_SYMBOLS = Object.keys(AIRCRAFT) as AircraftSymbol[];
export const VESSEL_SYMBOLS = Object.keys(VESSELS) as VesselSymbol[];
