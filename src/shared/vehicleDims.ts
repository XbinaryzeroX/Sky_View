// Shape and size inputs for the app-built 3D vehicle models (renderer/map/vehicleMeshes.ts).
//
// Aircraft: class from the ICAO type / ADS-B category (vehicleClass.ts), then real
// length and wingspan for common ICAO types (manufacturer figures, rounded), with
// engine count and placement, wing position and tail type. Unknown types use the
// class defaults. Models are representative shapes with generic paint, not
// manufacturer or airline models.
// Vessels: class from the AIS ship type; size from the AIS-reported length and beam
// when present, else a typical size for the class.

import { classifyAircraft, classifyVessel, faaShapeCode, type AircraftSymbol, type VesselSymbol } from './vehicleClass';
import airlinerCharacteristics from './airlinerCharacteristics.json';

export type EngineMount = 'wing' | 'tail' | 'nose' | 'none';

export interface AircraftShape {
  cls: AircraftSymbol;
  lengthM: number;
  spanM: number;
  engines: number;
  mount: EngineMount;
  highWing: boolean;
  tTail: boolean;
  prop: boolean;
  /** A third engine in the tail fin (MD-11, DC-10, Falcon 7X/8X). */
  trijet: boolean;
  /** Visible rotor configuration, where the civil type is documented. */
  rotorBlades?: number;
  tailRotor?: 'ducted' | 'none';
  military: boolean;
}

type Base = Omit<AircraftShape, 'cls' | 'military'>;
const base = (lengthM: number, spanM: number, engines: number, mount: EngineMount, highWing = false, tTail = false, prop = false, trijet = false): Base => ({ lengthM, spanM, engines, mount, highWing, tTail, prop, trijet });

export const CLASS_DEFAULTS: Record<AircraftSymbol, Base> = {
  widebody: base(64, 60, 2, 'wing'),
  narrowbody: base(38, 35, 2, 'wing'),
  regional: base(31, 27, 2, 'wing'),
  turboprop: base(25, 27, 2, 'wing', true, true, true),
  bizjet: base(18, 17, 2, 'tail', false, true),
  light: base(8.3, 11, 1, 'nose', true, false, true),
  jet: base(30, 28, 2, 'wing'),
  propeller: base(21, 27, 2, 'wing', false, false, true),
  seaplane: base(11, 15, 1, 'nose', true, false, true),
  helicopter: base(12, 10.5, 1, 'none'),
  gyroplane: base(5, 8.4, 1, 'none'),
  poweredlift: base(13, 16, 2, 'none', true),
  glider: base(7, 18, 0, 'none', false, true),
  balloon: base(18, 16, 0, 'none'),
  airship: base(46, 13, 2, 'none'),
  parachute: base(4, 11, 0, 'none'),
  drone: base(2, 3, 1, 'nose', false, false, true),
  unknown: base(38, 35, 2, 'wing'),
};

// [length m, span m, engines?, mount?, highWing?, tTail?, prop?, trijet?]
type Row = [number, number, number?, EngineMount?, boolean?, boolean?, boolean?, boolean?];
const T: Record<string, Row> = {
  // Airbus
  A318: [31.4, 34.1], A319: [33.8, 35.8], A320: [37.6, 35.8], A321: [44.5, 35.8], A19N: [33.8, 35.8], A20N: [37.6, 35.8], A21N: [44.5, 35.8],
  BCS1: [35, 35.1], BCS3: [38.7, 35.1], A332: [58.8, 60.3], A333: [63.7, 60.3], A338: [58.8, 64], A339: [63.7, 64], A343: [63.7, 60.3, 4], A346: [75.4, 63.5, 4],
  A359: [66.8, 64.8], A35K: [73.8, 64.8], A388: [72.7, 79.8, 4], A306: [54.1, 44.8], A310: [46.7, 43.9], A400: [45.1, 42.4, 4, 'wing', true, true, true],
  // Boeing
  B712: [37.8, 28.5, 2, 'tail', false, true], B736: [31.2, 34.3], B737: [33.6, 35.8], B738: [39.5, 35.8], B739: [42.1, 35.8],
  B37M: [35.6, 35.9], B38M: [39.5, 35.9], B39M: [42.2, 35.9], B3XM: [43.8, 35.9], B752: [47.3, 38.1], B753: [54.4, 38.1],
  B762: [48.5, 47.6], B763: [54.9, 47.6], B764: [61.4, 51.9], B772: [63.7, 60.9], B77L: [63.7, 64.8], B773: [73.9, 60.9], B77W: [73.9, 64.8],
  B778: [70.9, 71.8], B779: [76.7, 71.8], B788: [56.7, 60.1], B789: [62.8, 60.1], B78X: [68.3, 60.1], B744: [70.7, 64.4, 4], B748: [76.3, 68.4, 4],
  B74S: [56.3, 59.6, 4], K35R: [41.5, 39.9, 4], P8: [39.5, 37.6], C17: [53, 51.8, 4, 'wing', true, true], E3TF: [46.6, 44.4, 4],
  MD11: [61.6, 51.7, 3, 'wing', false, false, false, true], DC10: [55.5, 50.4, 3, 'wing', false, false, false, true],
  MD82: [45.1, 32.9, 2, 'tail', false, true], MD83: [45.1, 32.9, 2, 'tail', false, true], MD88: [45.1, 32.9, 2, 'tail', false, true],
  MD90: [46.5, 32.9, 2, 'tail', false, true], DC93: [36.4, 28.5, 2, 'tail', false, true],
  // Embraer, Bombardier, Fokker, others (regional)
  E170: [29.9, 26], E75L: [31.7, 28.7], E75S: [31.7, 26], E190: [36.2, 28.7], E195: [38.7, 28.7], E290: [36.2, 33.7], E295: [41.5, 35.1],
  E135: [26.3, 20, 2, 'tail', false, true], E145: [29.9, 20, 2, 'tail', false, true], E45X: [29.9, 21, 2, 'tail', false, true],
  CRJ1: [26.8, 21.2, 2, 'tail', false, true], CRJ2: [26.8, 21.2, 2, 'tail', false, true], CRJ7: [32.5, 23.2, 2, 'tail', false, true],
  CRJ9: [36.2, 24.9, 2, 'tail', false, true], CRJX: [39.1, 26.2, 2, 'tail', false, true], F100: [35.5, 28.1, 2, 'tail', false, true],
  F70: [30.9, 28.1, 2, 'tail', false, true], SU95: [29.9, 27.8], C919: [38.9, 35.8],
  // Turboprops
  AT43: [22.7, 24.6, 2, 'wing', true, true, true], AT45: [22.7, 24.6, 2, 'wing', true, true, true], AT46: [22.7, 24.6, 2, 'wing', true, true, true],
  AT72: [27.2, 27.1, 2, 'wing', true, true, true], AT75: [27.2, 27.1, 2, 'wing', true, true, true], AT76: [27.2, 27.1, 2, 'wing', true, true, true],
  DH8A: [22.3, 25.9, 2, 'wing', true, true, true], DH8C: [25.7, 27.4, 2, 'wing', true, true, true], DH8D: [32.8, 28.4, 2, 'wing', true, true, true],
  SF34: [19.7, 21.4, 2, 'wing', false, false, true], B190: [17.6, 17.7, 2, 'wing', false, true, true], DHC6: [15.8, 19.8, 2, 'wing', true, false, true],
  C208: [11.5, 15.9, 1, 'nose', true, false, true], PC12: [14.4, 16.3, 1, 'nose', false, true, true], TBM9: [10.7, 12.8, 1, 'nose', false, false, true],
  BE20: [13.3, 16.6, 2, 'wing', false, true, true], B350: [14.2, 17.7, 2, 'wing', false, true, true], C130: [29.8, 40.4, 4, 'wing', true, false, true],
  C30J: [29.8, 40.4, 4, 'wing', true, false, true],
  // Business jets
  C25A: [13.4, 15.5, 2, 'tail'], C25B: [15.6, 16.3, 2, 'tail'], C25C: [16.3, 15.5, 2, 'tail'], C510: [12.4, 13.2, 2, 'tail'], C56X: [16, 17.2, 2, 'tail'],
  C68A: [19, 22, 2, 'tail', false, true], C700: [22.3, 21, 2, 'tail', false, true], C750: [22.1, 19.4, 2, 'tail', false, true],
  CL30: [20.9, 19.5, 2, 'tail', false, true], CL35: [20.9, 21, 2, 'tail', false, true], CL60: [20.9, 19.6, 2, 'tail', false, true],
  GLEX: [30.3, 28.7, 2, 'tail', false, true], GL5T: [29.5, 28.7, 2, 'tail', false, true], GL7T: [33.8, 31.7, 2, 'tail', false, true],
  GLF4: [26.9, 23.7, 2, 'tail', false, true], GLF5: [29.4, 28.5, 2, 'tail', false, true], GLF6: [30.4, 30.4, 2, 'tail', false, true],
  G280: [20.3, 19.2, 2, 'tail', false, true], LJ45: [17.7, 14.6, 2, 'tail', false, true], LJ75: [17.7, 15.5, 2, 'tail', false, true],
  E50P: [12.8, 12.3, 2, 'tail', false, true], E55P: [15.6, 16.2, 2, 'tail', false, true], PC24: [16.8, 17, 2, 'tail'], HDJT: [13, 12.1, 2, 'wing', false, false],
  F2TH: [20.2, 21.4, 2, 'tail'], FA7X: [23.2, 26.2, 3, 'tail', false, false, false, true], FA8X: [24.5, 26.3, 3, 'tail', false, false, false, true],
  F900: [20.2, 19.3, 3, 'tail', false, false, false, true], H25B: [15.6, 15.7, 2, 'tail'], SF50: [9.4, 11.8, 1, 'tail'],
  // Light aircraft
  C150: [7.3, 10.2, 1, 'nose', true, false, true], C152: [7.3, 10.1, 1, 'nose', true, false, true], C172: [8.3, 11, 1, 'nose', true, false, true],
  C182: [8.8, 11, 1, 'nose', true, false, true], C206: [8.6, 11, 1, 'nose', true, false, true], C210: [8.6, 11.2, 1, 'nose', true, false, true],
  P28A: [7.3, 10.7, 1, 'nose', false, false, true], P28B: [7.4, 9.1, 1, 'nose', false, false, true], P28R: [7.5, 10.8, 1, 'nose', false, false, true],
  PA32: [8.4, 11, 1, 'nose', false, false, true], PA46: [8.8, 13.1, 1, 'nose', false, false, true], SR20: [7.9, 11.7, 1, 'nose', false, false, true],
  SR22: [7.9, 11.7, 1, 'nose', false, false, true], DA40: [8.1, 11.9, 1, 'nose', false, true, true], DA42: [8.6, 13.4, 2, 'wing', false, true, true],
  BE36: [8.4, 10.2, 1, 'nose', false, false, true], BE58: [9.1, 11.5, 2, 'wing', false, false, true], PA34: [8.7, 11.9, 2, 'wing', false, false, true],
  PA44: [8.4, 11.8, 2, 'wing', false, true, true], C310: [9.7, 11.3, 2, 'wing', false, false, true], M20P: [7.5, 11, 1, 'nose', false, false, true],
  // Helicopters (length = fuselage incl. tail, span = main rotor diameter)
  EC35: [12.2, 10.2], EC45: [13.6, 11], EC30: [10.9, 10.7], AS50: [12.9, 10.7], AS65: [13.7, 11.9], B06: [11.8, 10.2], B407: [12.7, 10.7],
  B412: [17.1, 14], B429: [12.7, 11], A109: [13, 11], A119: [13, 10.8], A139: [16.7, 13.8], A169: [14.6, 12.1], S76: [16, 13.4], S92: [20.9, 17.2],
  R22: [8.8, 7.7], R44: [11.7, 10.1], R66: [11.8, 10.1], H60: [19.8, 16.4],
};

const CLASS_FALLBACK_SIZE_OK = (n: number) => Number.isFinite(n) && n > 0;
const airlinerSizes: Readonly<Record<string, {lengthM?: number; spanWithTipsM?: number; spanWithoutTipsM?: number}>> = airlinerCharacteristics;
// R44 pilot handbook section 7, MD 520N manufacturer brochure, Airbus H135 product specifications.
const civilRotors: Readonly<Record<string, Pick<AircraftShape, 'rotorBlades' | 'tailRotor'>>> = {
  R44: { rotorBlades: 2 }, MD52: { rotorBlades: 5, tailRotor: 'none' }, EC35: { rotorBlades: 4, tailRotor: 'ducted' },
};

export function aircraftShape(type: string | null | undefined, emitterCategory: string | null | undefined, military = false): AircraftShape {
  const cls = classifyAircraft(type, emitterCategory).symbol;
  const d = CLASS_DEFAULTS[cls];
  const code = type?.trim().toUpperCase() ?? '';
  const rotor = !military && Object.hasOwn(civilRotors, code) ? civilRotors[code] : undefined;
  const row = Object.hasOwn(T, code) ? T[code] : undefined;
  if (!row) {
    const description = faaShapeCode(code);
    if (!description) return { cls, ...d, ...rotor, military };
    const size = Object.hasOwn(airlinerSizes, code) ? airlinerSizes[code] : undefined;
    const engines = Number(description[1]);
    const fixed = ['L', 'A', 'S'].includes(description[0]) && cls !== 'glider';
    const prop = fixed ? description[2] !== 'J' : d.prop;
    const mount = fixed ? (engines === 1 ? (prop ? 'nose' : 'tail') : (engines > 2 || d.mount === 'nose' ? 'wing' : d.mount)) : d.mount;
    const typical = cls === 'jet' ? (description[3] === 'H' || description[3] === 'J' ? CLASS_DEFAULTS.widebody : description[3] === 'S' ? CLASS_DEFAULTS.bizjet : d)
      : cls === 'turboprop' && engines === 1 ? { lengthM: 12, spanM: 15 } : d;
    return { ...d, ...rotor, cls, engines, prop, mount, military, trijet: fixed && engines === 3 && !prop,
      lengthM: size?.lengthM ?? typical.lengthM, spanM: size?.spanWithTipsM ?? size?.spanWithoutTipsM ?? typical.spanM };
  }
  const [lengthM, spanM, engines, mount, highWing, tTail, prop, trijet] = row;
  return {
    ...rotor,
    cls,
    lengthM: CLASS_FALLBACK_SIZE_OK(lengthM) ? lengthM : d.lengthM,
    spanM: CLASS_FALLBACK_SIZE_OK(spanM) ? spanM : d.spanM,
    engines: engines ?? d.engines,
    mount: mount ?? d.mount,
    highWing: highWing ?? d.highWing,
    tTail: tTail ?? (mount === 'tail' ? true : d.tTail),
    prop: prop ?? d.prop,
    trijet: trijet ?? false,
    military,
  };
}

/** Model variant key: everything that changes the geometry (sizes are applied per instance). */
export function aircraftVariant(s: AircraftShape): string {
  const key = ['air', s.cls, s.engines, s.mount, s.highWing ? 'hi' : 'lo', s.tTail ? 't' : 'c', s.prop ? 'p' : 'j', s.trijet ? '3' : '', s.military ? 'mil' : 'civ'].join(':');
  return s.rotorBlades || s.tailRotor ? `${key}:${s.rotorBlades ?? ''}:${s.tailRotor ?? ''}` : key;
}

export interface VesselShape {
  cls: VesselSymbol;
  lengthM: number;
  beamM: number;
  /** True when length/beam came from the vessel's own AIS report. */
  reported: boolean;
}

export const VESSEL_DEFAULTS: Record<VesselSymbol, { lengthM: number; beamM: number }> = {
  cargo: { lengthM: 180, beamM: 28 },
  tanker: { lengthM: 200, beamM: 32 },
  passenger: { lengthM: 160, beamM: 27 },
  highspeed: { lengthM: 40, beamM: 11 },
  fishing: { lengthM: 25, beamM: 7 },
  tug: { lengthM: 30, beamM: 10 },
  sailing: { lengthM: 12, beamM: 4 },
  pleasure: { lengthM: 14, beamM: 4.5 },
  service: { lengthM: 18, beamM: 6 },
  pilot: { lengthM: 17, beamM: 5.2 },
  workboat: { lengthM: 43, beamM: 11 },
  wingInGround: { lengthM: 26, beamM: 18 },
  military: { lengthM: 120, beamM: 15 },
  unknown: { lengthM: 60, beamM: 12 },
};

export function vesselShape(shipType: number | null | undefined, lengthM: unknown, beamM: unknown): VesselShape {
  const cls = classifyVessel(typeof shipType === 'number' ? shipType : null).symbol;
  const d = VESSEL_DEFAULTS[cls];
  const len = typeof lengthM === 'number' && lengthM >= 3 && lengthM <= 460 ? lengthM : null;
  const beam = typeof beamM === 'number' && beamM >= 1 && beamM <= 70 ? beamM : null;
  if (len === null) return { cls, ...d, reported: false };
  // Beam must be plausible for the length; otherwise keep the class's proportion.
  const ratio = d.beamM / d.lengthM;
  // Plausible beam: 1–70 m (checked above) and 5–60 % of the length, bounds inclusive.
  const lo = Math.max(1, 0.05 * len);
  const hi = Math.min(70, 0.6 * len);
  const b = beam !== null && beam >= lo && beam <= hi ? beam : Math.min(hi, Math.max(lo, len * ratio));
  return { cls, lengthM: len, beamM: b, reported: true };
}

/** Climb/descent angle (radians) from vertical rate and ground speed, limited to ±15°. */
export function pitchFromRates(verticalRateFpm: unknown, speedKts: unknown): number {
  if (typeof verticalRateFpm !== 'number' || typeof speedKts !== 'number' || speedKts < 40) return 0;
  const vs = verticalRateFpm * 0.00508; // ft/min → m/s
  const gs = speedKts * 0.514444; // kt → m/s
  const limit = (15 * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, Math.atan2(vs, gs)));
}
