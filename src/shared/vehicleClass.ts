// Map symbol classes for aircraft and vessels.
//
// Fallback order (never a guessed model):
//   1. exact ICAO aircraft type designator  -> known family (e.g. B77W -> wide-body)
//   2. ADS-B emitter category (A1–A7, B1…)  -> broad category
//   3. unknown                              -> generic symbol, labelled unknown
// Vessels use the AIS ship-type code only. AIS cannot tell a container ship from
// a bulk carrier (both are "cargo", 70–79), so no such split is made.

export type AircraftSymbol = 'widebody' | 'narrowbody' | 'regional' | 'turboprop' | 'bizjet' | 'light' | 'helicopter' | 'glider' | 'balloon' | 'drone' | 'unknown';
export type VesselSymbol = 'cargo' | 'tanker' | 'passenger' | 'highspeed' | 'fishing' | 'tug' | 'sailing' | 'pleasure' | 'service' | 'military' | 'unknown';

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
  ['regional', prefix('CRJ E135 E145 E170 E175 E75 E190 E195 E290 E295 SU95 AJ27 F100 F70 RJ85 RJ1H RJ70 ARJ')],
  ['turboprop', prefix('AT4 AT7 DH8 SF34 SW4 B190 JS31 JS32 JS41 E120 D328 PC12 C208 L410 F50 BE20 BE30 BE9L KODI TBM7 TBM8 TBM9 C130 DHC6 DHC7 AN26 AN24 P180 C212 CN35')],
  ['bizjet', prefix('C25 C510 C525 C550 C55B C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GLEX GL5T GL7T GLF G280 LJ FA10 FA20 FA50 FA7X FA8X FA900 F900 F2TH E50P E55P E545 E550 H25B PRM1 HDJT PC24 SF50 BE40')],
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
  helicopter: 'Helicopter',
  glider: 'Glider',
  balloon: 'Balloon / airship',
  drone: 'Unmanned aircraft',
  unknown: 'Aircraft (type unknown)',
};
export const aircraftSymbolName = (s: AircraftSymbol) => SYMBOL_NAMES[s];

const BY_CATEGORY: Record<string, AircraftSymbol> = { A1: 'light', A2: 'turboprop', A3: 'narrowbody', A4: 'narrowbody', A5: 'widebody', A7: 'helicopter', B1: 'glider', B2: 'balloon', B4: 'light', B6: 'drone' };
const CATEGORY_TEXT: Record<string, string> = { A1: 'light (<15.5 t)', A2: 'small (15.5–34 t)', A3: 'large (34–136 t)', A4: 'high-vortex large', A5: 'heavy (>136 t)', A7: 'rotorcraft', B1: 'glider', B2: 'lighter-than-air', B4: 'ultralight', B6: 'unmanned' };

export function classifyAircraft(type: string | null | undefined, emitterCategory: string | null | undefined): SymbolClass<AircraftSymbol> {
  const t = (type ?? '').toUpperCase().trim();
  if (t) {
    for (const [sym, list] of FAMILIES)
      if (list.some((p) => t === p || (p.length >= 2 && t.startsWith(p) && (p.length >= 3 || /\d/.test(t.slice(p.length)) || t.length <= 4))))
        return { symbol: sym, basis: 'type', explain: `${SYMBOL_NAMES[sym]} (from ICAO type ${t})` };
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
  service: 'Pilot, rescue or law-enforcement vessel',
  military: 'Military operations',
  unknown: 'Vessel (type unknown)',
};
export const vesselSymbolName = (s: VesselSymbol) => VESSEL_NAMES[s];

export function classifyVessel(shipType: number | null | undefined): SymbolClass<VesselSymbol> {
  const t = typeof shipType === 'number' ? shipType : null;
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
    : t === 50 || t === 51 || t === 55 ? 'service'
    : t === 35 ? 'military'
    : 'unknown';
  return t === null ? { symbol: 'unknown', basis: 'unknown', explain: 'No AIS ship type reported' } : { symbol: sym, basis: 'ais-type', explain: `${VESSEL_NAMES[sym]} (AIS ship type ${t})` };
}
