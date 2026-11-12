// Map symbol classes for aircraft and vessels.
//
// Fallback order (never a guessed model):
//   1. exact ICAO aircraft type designator  -> known family (e.g. B77W -> wide-body)
//   2. ADS-B emitter category (A1–A7, B1…)  -> broad category
//   3. unknown                              -> generic symbol, labelled unknown
// Vessels use the AIS ship-type code only. AIS cannot tell a container ship from
// a bulk carrier (both are "cargo", 70–79), so no such split is made.
import aircraftTypeShapes from './aircraftTypeShapes.json';

export type AircraftSymbol = 'widebody' | 'narrowbody' | 'regional' | 'turboprop' | 'bizjet' | 'light' | 'jet' | 'propeller' | 'seaplane' | 'helicopter' | 'gyroplane' | 'poweredlift' | 'glider' | 'balloon' | 'airship' | 'parachute' | 'drone' | 'unknown';
export type VesselSymbol = 'cargo' | 'tanker' | 'passenger' | 'highspeed' | 'fishing' | 'tug' | 'sailing' | 'pleasure' | 'pilot' | 'service' | 'workboat' | 'wingInGround' | 'military' | 'unknown';

export interface SymbolClass<T> {
  symbol: T;
  /** What the class was derived from. */
  basis: 'type' | 'category' | 'ais-type' | 'unknown';
  /** Human-readable explanation for the details panel. */
  explain: string;
}

const prefix = (list: string) => list.split(/\s+/).filter(Boolean);
const FAMILIES: [AircraftSymbol, string[]][] = [
  ['widebody', prefix('A30 A310 A33 A34 A35 A38 B74 B76 B77 B78 IL96 MD11 DC10 L101 A3ST BLCF')],
  ['narrowbody', prefix('A318 A319 A320 A321 A19N A20N A21N B73 B37M B38M B39M B3XM B75 MD8 MD9 BCS1 BCS3 C919 T204 B712')],
  ['regional', prefix('CRJ E135 E145 E45X E170 E175 E75 E190 E195 E290 E295 SU95 AJ27 A148 F100 F70 B46 RJ85 RJ1H RJ70 ARJ')],
  ['turboprop', prefix('AT4 AT7 DH8 SF34 SW4 B190 JS31 JS32 JS41 E120 D328 PC12 C208 L410 F50 BE20 BE30 BE9L KODI TBM7 TBM8 TBM9 C130 DHC6 DHC7 AN26 AN24 P180 C212 CN35')],
  ['bizjet', prefix('C25 C510 C525 C550 C55B C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GLEX GL5T GL7T GLF G280 GA5C GA6C GA7C GA8C LJ FA10 FA20 FA50 FA6X FA7X FA8X FA900 F900 F2TH E35L E50P E55P E545 E550 H25B HA4T PRM1 HDJT PC24 SF50 BE40')],
  ['helicopter', prefix('AS50 AS55 AS65 AS32 B06 B407 B412 B429 B505 EC20 EC30 EC35 EC45 EC55 EC75 R22 R44 R66 S76 S92 A109 A119 A139 A169 A189 UH1 H60 BK17 MI8 H135 H145 H160 H175 EH10')],
  ['glider', prefix('GLID ASK2 DG80 LS8 DUOD ARCP')],
  ['light', prefix('C150 C152 C162 C172 C177 C182 C206 C210 P28A P28B P28R P32R PA32 PA34 PA44 PA46 SR20 SR22 DA40 DA42 DA62 BE33 BE35 BE36 BE58 M20P M20T C310 C340 PA18 J3 AA5 RV')],
];

const SYMBOL_NAMES: Record<AircraftSymbol, string> = {
  widebody: 'Wide-body airliner',
  narrowbody: 'Narrow-body airliner',
  regional: 'Regional jet',
  turboprop: 'Turboprop',
  bizjet: 'Business jet',
  light: 'Light aircraft',
  jet: 'Jet aircraft',
  propeller: 'Propeller aircraft',
  seaplane: 'Seaplane / amphibian',
  helicopter: 'Helicopter',
  gyroplane: 'Gyroplane',
  poweredlift: 'Powered-lift aircraft',
  glider: 'Glider',
  balloon: 'Balloon / airship',
  airship: 'Airship',
  parachute: 'Parachute / powered parachute',
  drone: 'Unmanned aircraft',
  unknown: 'Aircraft (type unknown)',
};
export const aircraftSymbolName = (s: AircraftSymbol) => SYMBOL_NAMES[s];

const BY_CATEGORY: Record<string, AircraftSymbol> = { A1: 'light', A2: 'turboprop', A3: 'narrowbody', A4: 'narrowbody', A5: 'widebody', A7: 'helicopter', B1: 'glider', B2: 'balloon', B3: 'parachute', B4: 'light', B6: 'drone' };
const CATEGORY_TEXT: Record<string, string> = { A1: 'light (<15.5 t)', A2: 'small (15.5–34 t)', A3: 'large (34–136 t)', A4: 'high-vortex large', A5: 'heavy (>136 t)', A7: 'rotorcraft', B1: 'glider', B2: 'lighter-than-air', B3: 'parachutist', B4: 'ultralight', B6: 'unmanned' };

const designators: Readonly<Record<string, string>> = aircraftTypeShapes;
/** Pinned FAA designator data, encoded as form, engine count, propulsion and weight group. */
export function faaShapeCode(type: string): string | undefined {
  return Object.hasOwn(designators, type) ? designators[type] : undefined;
}
const specialTypes: Readonly<Record<string, AircraftSymbol>> = {
  BALL: 'balloon', GLID: 'glider', GYRO: 'gyroplane', PARA: 'parachute', SHIP: 'airship', UHEL: 'helicopter', ULAC: 'light',
};
const rotorAndWaterForms: Readonly<Record<string, AircraftSymbol>> = {
  A: 'seaplane', S: 'seaplane', H: 'helicopter', G: 'gyroplane', P: 'poweredlift',
};

export function classifyAircraft(type: string | null | undefined, emitterCategory: string | null | undefined): SymbolClass<AircraftSymbol> {
  const t = (type ?? '').toUpperCase().trim();
  const typed = (symbol: AircraftSymbol): SymbolClass<AircraftSymbol> => ({ symbol, basis: 'type', explain: `${SYMBOL_NAMES[symbol]} (from ICAO type ${t})` });
  if (t) {
    if (Object.hasOwn(specialTypes, t)) return typed(specialTypes[t]);
    const description = faaShapeCode(t);
    if (description && rotorAndWaterForms[description[0]]) return typed(rotorAndWaterForms[description[0]]);
    for (const [sym, list] of FAMILIES)
      if (list.some((p) => t === p || (p.length >= 2 && t.startsWith(p) && (p.length >= 3 || /\d/.test(t.slice(p.length)) || t.length <= 4))))
        return typed(sym);
    if (description) return typed(description[2] === 'J' ? 'jet' : description[2] === 'T' ? 'turboprop' : description.slice(3) === 'S' ? 'light' : 'propeller');
  }
  const c = (emitterCategory ?? '').toUpperCase();
  if (BY_CATEGORY[c]) return { symbol: BY_CATEGORY[c], basis: 'category', explain: `${SYMBOL_NAMES[BY_CATEGORY[c]]} symbol from ADS-B emitter category ${c} (${CATEGORY_TEXT[c]}); exact type not identified` };
  return { symbol: 'unknown', basis: 'unknown', explain: t ? `Type ${t} is not in the symbol registry` : 'No type or category reported' };
}

const VESSEL_NAMES: Record<VesselSymbol, string> = {
  cargo: 'Cargo vessel',
  tanker: 'Tanker',
  passenger: 'Passenger vessel / ferry',
  highspeed: 'High-speed craft',
  fishing: 'Fishing vessel',
  tug: 'Tug / towing',
  sailing: 'Sailing vessel',
  pleasure: 'Pleasure craft',
  pilot: 'Pilot vessel',
  service: 'Rescue or law-enforcement vessel',
  workboat: 'Working / support vessel',
  wingInGround: 'Wing-in-ground craft',
  military: 'Military operations',
  unknown: 'Vessel (type unknown)',
};
export const vesselSymbolName = (s: VesselSymbol) => VESSEL_NAMES[s];

export function classifyVessel(shipType: number | null | undefined): SymbolClass<VesselSymbol> {
  const t = typeof shipType === 'number' && Number.isInteger(shipType) && shipType >= 0 && shipType <= 99 ? shipType : null;
  const sym: VesselSymbol =
    t === null ? 'unknown'
    : t >= 70 && t <= 79 ? 'cargo'
    : t >= 80 && t <= 89 ? 'tanker'
    : t >= 60 && t <= 69 ? 'passenger'
    : t >= 40 && t <= 49 ? 'highspeed'
    : t === 30 ? 'fishing'
    : t === 31 || t === 32 || t === 52 ? 'tug'
    : t === 36 ? 'sailing'
    : t === 37 ? 'pleasure'
    : t === 50 ? 'pilot'
    : t === 51 || t === 55 ? 'service'
    : t === 33 || t === 34 || t === 53 || t === 54 || t === 58 ? 'workboat'
    : t >= 20 && t <= 29 ? 'wingInGround'
    : t === 35 ? 'military'
    : 'unknown';
  return t === null ? { symbol: 'unknown', basis: 'unknown', explain: 'No AIS ship type reported' } : { symbol: sym, basis: 'ais-type', explain: `${VESSEL_NAMES[sym]} (AIS ship type ${t})` };
}
