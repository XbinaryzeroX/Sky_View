// Satellite groups the user can switch on, mapped to CelesTrak's GP element sets.
// Group names read from https://celestrak.org/NORAD/elements/ on 2026-11-17. Counts are rough and change weekly.
// Colours follow the Okabe–Ito palette by section; the section name and the label carry the meaning too.

export type SatelliteSection = 'Stations and bright' | 'Navigation' | 'Communications' | 'Earth observation' | 'Science and other';

export interface SatelliteGroupInfo {
  id: string;
  celestrak: string;
  label: string;
  section: SatelliteSection;
  approx: number;
}

export const SATELLITE_GROUPS = [
  { id: 'stations', celestrak: 'stations', label: 'Space stations', section: 'Stations and bright', approx: 30 },
  { id: 'visual', celestrak: 'visual', label: 'Brightest (visible by eye)', section: 'Stations and bright', approx: 160 },
  { id: 'recent', celestrak: 'last-30-days', label: 'Launched in the last 30 days', section: 'Stations and bright', approx: 200 },
  { id: 'gps', celestrak: 'gps-ops', label: 'GPS (U.S.)', section: 'Navigation', approx: 31 },
  { id: 'glonass', celestrak: 'glo-ops', label: 'GLONASS (Russia)', section: 'Navigation', approx: 24 },
  { id: 'galileo', celestrak: 'galileo', label: 'Galileo (EU)', section: 'Navigation', approx: 30 },
  { id: 'beidou', celestrak: 'beidou', label: 'BeiDou (China)', section: 'Navigation', approx: 50 },
  { id: 'sbas', celestrak: 'sbas', label: 'SBAS augmentation', section: 'Navigation', approx: 20 },
  { id: 'gnss', celestrak: 'gnss', label: 'All navigation (GNSS)', section: 'Navigation', approx: 160 },
  { id: 'starlink', celestrak: 'starlink', label: 'Starlink', section: 'Communications', approx: 8000 },
  { id: 'oneweb', celestrak: 'oneweb', label: 'OneWeb', section: 'Communications', approx: 650 },
  { id: 'kuiper', celestrak: 'kuiper', label: 'Amazon Kuiper', section: 'Communications', approx: 150 },
  { id: 'qianfan', celestrak: 'qianfan', label: 'Qianfan (Thousand Sails)', section: 'Communications', approx: 100 },
  { id: 'iridium', celestrak: 'iridium-NEXT', label: 'Iridium NEXT', section: 'Communications', approx: 80 },
  { id: 'telecom', celestrak: 'geo', label: 'Geostationary', section: 'Communications', approx: 550 },
  { id: 'amateur', celestrak: 'amateur', label: 'Amateur radio', section: 'Communications', approx: 100 },
  { id: 'weather', celestrak: 'weather', label: 'Weather', section: 'Earth observation', approx: 70 },
  { id: 'imaging', celestrak: 'resource', label: 'Earth resources', section: 'Earth observation', approx: 200 },
  { id: 'planet', celestrak: 'planet', label: 'Planet imaging', section: 'Earth observation', approx: 200 },
  { id: 'sar', celestrak: 'sar', label: 'Radar imaging (SAR)', section: 'Earth observation', approx: 80 },
  { id: 'science', celestrak: 'science', label: 'Science', section: 'Science and other', approx: 70 },
  { id: 'geodetic', celestrak: 'geodetic', label: 'Geodetic', section: 'Science and other', approx: 20 },
  { id: 'cubesat', celestrak: 'cubesat', label: 'CubeSats', section: 'Science and other', approx: 200 },
  { id: 'military', celestrak: 'military', label: 'Military (publicly catalogued)', section: 'Science and other', approx: 100 },
  { id: 'debris', celestrak: 'fengyun-1c-debris', label: 'Debris: Fengyun-1C breakup', section: 'Science and other', approx: 2000 },
] as const satisfies readonly SatelliteGroupInfo[];

export type SatelliteGroupId = (typeof SATELLITE_GROUPS)[number]['id'];
export const SATELLITE_GROUP_IDS = SATELLITE_GROUPS.map((g) => g.id) as [SatelliteGroupId, ...SatelliteGroupId[]];
export const SATELLITE_SECTIONS: SatelliteSection[] = ['Stations and bright', 'Navigation', 'Communications', 'Earth observation', 'Science and other'];

const SECTION_COLOR: Record<SatelliteSection, string> = {
  'Stations and bright': '#f0e442',
  Navigation: '#009e73',
  Communications: '#56b4e9',
  'Earth observation': '#e69f00',
  'Science and other': '#cc79a7',
};

export function satelliteGroup(id: string | null | undefined): SatelliteGroupInfo | null {
  return SATELLITE_GROUPS.find((g) => g.id === id) ?? null;
}

export function celestrakGroup(id: string): string | null {
  return satelliteGroup(id)?.celestrak ?? null;
}

/** Marker colour for a satellite's group; debris is grey whatever its section. */
export function satelliteColor(id: string | null | undefined): string {
  if (id === 'debris') return '#9aa4b2';
  const g = satelliteGroup(id);
  return g ? SECTION_COLOR[g.section] : '#b9c7f5';
}

export function sectionColor(section: SatelliteSection): string {
  return SECTION_COLOR[section];
}
