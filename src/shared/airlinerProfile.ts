import faaCharacteristics from './airlinerCharacteristics.json';
import { icaoTypeName } from './icaoTypes';
export { airframeAgeLabel } from './vehicleInfo';

interface Source { label: string; url: string }
interface Fact { label: string; value: string }
export interface AirlinerProfile { name: string; facts: ReadonlyArray<Fact>; sources: ReadonlyArray<Source> }

interface Characteristics {
  model: string;
  engineCount: number;
  propulsion: string;
  lengthM?: number;
  spanWithTipsM?: number;
  spanWithoutTipsM?: number;
  tailHeightM?: number;
  takeoffKg?: number;
}

const faaSource: Source = { label: 'FAA aircraft characteristics (2024)', url: 'https://www.faa.gov/airports/engineering/aircraft_char_database' };
const crjFleet: Source = { label: 'Iberia / Air Nostrum fleet', url: 'https://grupo.iberia.com/about_us/iberia_fleet/air-nostrum-crj-1000' };
const crjLaunch: Source = { label: 'Bombardier program announcement', url: 'https://www.sec.gov/Archives/edgar/vprr/0702/07023255.pdf' };
const boeingNG: Source = { label: 'Boeing 737NG specifications', url: 'https://www.boeing.com/commercial/737ng' };
const boeingMax: Source = { label: 'Boeing 737 MAX specifications', url: 'https://www.boeing.com/commercial/737max' };
const boeing787: Source = { label: 'Boeing 787 specifications', url: 'https://www.boeing.com/commercial/787' };
const airbusNeoMilestones: Source = { label: 'Airbus delivery milestones', url: 'https://www.airbus.com/en/newsroom/press-releases/2019-10-airbus-marks-its-1000th-a320neo-family-aircraft-delivery' };

interface AdditionalSpecs {
  seats?: string;
  cabin?: string;
  rangeKm?: number;
  engine?: string;
  firstDelivery?: number;
  sources: Source[];
}

const additionalSpecs: Record<string, AdditionalSpecs> = {
  A20N: { seats: '150–180', cabin: 'two classes', rangeKm: 6300, firstDelivery: 2016, sources: [
    { label: 'Airbus A320neo specifications', url: 'https://www.aircraft.airbus.com/en/aircraft/a320-family/a320neo' }, airbusNeoMilestones] },
  A21N: { firstDelivery: 2017, sources: [airbusNeoMilestones] },
  A359: { seats: '332–352', cabin: 'three classes', rangeKm: 15750, sources: [
    { label: 'Airbus A350-900 specifications', url: 'https://www.aircraft.airbus.com/en/aircraft/a350/a350-900' }] },
  B737: { seats: '125–145', rangeKm: 5370, engine: 'CFM56-7B', sources: [boeingNG] },
  B738: { seats: '160–180', rangeKm: 5190, engine: 'CFM56-7B', sources: [boeingNG] },
  B739: { seats: '175–195', rangeKm: 5000, engine: 'CFM56-7B', sources: [boeingNG] },
  B37M: { seats: '135–160', rangeKm: 7040, engine: 'CFM LEAP-1B', sources: [boeingMax] },
  B38M: { seats: '160–180', rangeKm: 6480, engine: 'CFM LEAP-1B', sources: [boeingMax] },
  B39M: { seats: '175–195', rangeKm: 6110, engine: 'CFM LEAP-1B', sources: [boeingMax] },
  B788: { seats: '200–275', rangeKm: 14820, engine: 'GE GEnx-1B or Rolls-Royce Trent 1000', sources: [boeing787] },
  B789: { seats: '250–325', rangeKm: 15370, engine: 'GE GEnx-1B or Rolls-Royce Trent 1000', sources: [boeing787] },
  B78X: { seats: '300–375', rangeKm: 13890, engine: 'GE GEnx-1B or Rolls-Royce Trent 1000', sources: [boeing787] },
};

// The FAA workbook has no CRJX row. These figures describe Air Nostrum's published configuration.
const crj1000: AirlinerProfile = {
  name: 'Bombardier CRJ1000',
  facts: [
    { label: 'Length', value: '39.1 m' }, { label: 'Wingspan', value: '26.1 m' },
    { label: 'Engines', value: '2 × General Electric' }, { label: 'Air Nostrum seating', value: '100' },
    { label: 'Air Nostrum published range', value: '2,761 km' }, { label: 'Model program launched', value: '2007' },
  ],
  sources: [crjFleet, crjLaunch],
};

const faaRows: Readonly<Record<string, Characteristics>> = faaCharacteristics;
const meters = (n: number) => `${n.toLocaleString('en-US')} m`;

const sourceLinks = new Set([faaSource, ...crj1000.sources, ...Object.values(additionalSpecs).flatMap(spec => spec.sources)].map(source => source.url));
export function isAirlinerReferenceUrl(url: string): boolean {
  return sourceLinks.has(url);
}

export function hasAirlinerProfile(typeCode: string | null | undefined): boolean {
  const code = typeCode?.trim().toUpperCase();
  return !!code && (code === 'CRJX' || Object.hasOwn(faaRows, code));
}

/** Exact ICAO designator match. The FAA figures describe a planning configuration for this type. */
export function airlinerProfile(typeCode: string | null | undefined): AirlinerProfile | null {
  const code = typeCode?.trim().toUpperCase();
  if (!code) return null;
  if (code === 'CRJX') return crj1000;
  if (!Object.hasOwn(faaRows, code)) return null;
  const row = faaRows[code];
  const facts: Fact[] = [];
  const detail = additionalSpecs[code];
  if (row.lengthM !== undefined) facts.push({ label: 'Length', value: meters(row.lengthM) });
  if (row.spanWithoutTipsM !== undefined) facts.push({ label: row.spanWithTipsM ? 'Span without winglets' : 'Wingspan', value: meters(row.spanWithoutTipsM) });
  if (row.spanWithTipsM !== undefined) facts.push({ label: 'Span with winglets', value: meters(row.spanWithTipsM) });
  if (row.tailHeightM !== undefined) facts.push({ label: 'Tail height (empty aircraft)', value: meters(row.tailHeightM) });
  facts.push({ label: 'Engines', value: `${row.engineCount} × ${detail?.engine ?? row.propulsion.toLowerCase()}` });
  if (row.takeoffKg !== undefined) facts.push({ label: 'Max takeoff mass (FAA reference)', value: `${row.takeoffKg.toLocaleString('en-US')} kg` });
  if (detail?.seats) facts.push({ label: `Seating (${detail.cabin ?? 'two classes'})`, value: detail.seats });
  if (detail?.rangeKm) facts.push({ label: 'Published model range', value: `Up to ${detail.rangeKm.toLocaleString('en-US')} km` });
  if (detail?.firstDelivery) facts.push({ label: 'First delivery of this model', value: String(detail.firstDelivery) });
  return { name: icaoTypeName(code) ?? row.model, facts, sources: [faaSource, ...(detail?.sources ?? [])] };
}
