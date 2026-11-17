// Bundled OpenStreetMap infrastructure (data centres; dams and hydropower plants), built by
// scripts/build-infrastructure.mjs. Read like any external input: malformed rows are counted and skipped.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText } from './normalize';

export interface InfrastructureFile {
  built: string;
  fields: string[];
  datacenter: unknown[];
  dam: unknown[];
}

const OSM_TYPES = new Set(['node', 'way', 'relation']);

export function infrastructureRecords(file: InfrastructureFile, kind: 'datacenter' | 'dam'): Normalized {
  const rows = Array.isArray(file?.[kind]) ? file[kind] : [];
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) { skipped++; continue; }
    const [type, id, lat, lon, rawTags] = row as [unknown, unknown, unknown, unknown, unknown];
    if (typeof type !== 'string' || !OSM_TYPES.has(type) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || !isValidLat(lat) || !isValidLon(lon)) { skipped++; continue; }
    const tags = rawTags && typeof rawTags === 'object' ? (rawTags as Record<string, unknown>) : {};
    const t = (k: string) => cleanText(tags[k], 120);
    const name = t('name');
    const operator = t('operator');
    records.push({
      id: `${type}-${id}`,
      lat, lon, altM: null, heading: null, speedKts: null,
      label: name ?? operator ?? (kind === 'datacenter' ? 'Data centre (unnamed)' : 'Dam (unnamed)'),
      category: kind === 'dam' ? (t('plant:source') === 'hydro' || t('power') === 'plant' ? 'hydro' : 'dam') : 'datacenter',
      observedAt: null,
      sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
      source: '© OpenStreetMap contributors (ODbL)',
      props: kind === 'datacenter'
        ? { operator, owner: t('owner'), opened: t('start_date'), levels: t('building:levels'), heightTag: t('height'), position: 'centre of the mapped outline' }
        : { operator, opened: t('start_date'), heightTag: t('height'), plantSource: t('plant:source'), outputTag: t('plant:output:electricity'), position: 'centre of the mapped outline' },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}
