// Earthquake-triggered landslide estimates from the USGS Ground Failure product. For significant earthquakes USGS runs
// a statistical model (Nowicki Jessee et al. 2018) and publishes an alert level, the area likely affected and the
// number of people living there. These are model estimates made within hours of the shaking, not reports of landslides
// that happened, and USGS publishes them only for some earthquakes.

import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { isValidLat, isValidLon } from './geo';
import { cleanText } from './normalize';

export const LANDSLIDE_LIST_URL = (startIso: string) =>
  `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&producttype=ground-failure&starttime=${startIso.slice(0, 10)}&orderby=time&limit=60`;
export const LANDSLIDE_DETAIL_URL = (id: string) => `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(id)}&format=geojson`;
export const LANDSLIDE_EVENT_ID = /^[a-z]{2}[a-z0-9]{6,12}$/;
export const LANDSLIDE_DAYS = 30;
export const LANDSLIDE_MAX_DETAILS = 25;

export type LandslideAlert = 'green' | 'yellow' | 'orange' | 'red';
const ALERTS = new Set(['green', 'yellow', 'orange', 'red']);

/** USGS PAGER-style colours with a word for each, so the level is never colour alone. */
export const LANDSLIDE_ALERT_META: Record<LandslideAlert | 'unknown', { color: string; word: string }> = {
  green: { color: '#3fae5a', word: 'Green (little or no landsliding expected)' },
  yellow: { color: '#f2c94c', word: 'Yellow (localized landsliding possible)' },
  orange: { color: '#f2994a', word: 'Orange (significant landsliding possible)' },
  red: { color: '#eb5757', word: 'Red (extensive landsliding likely)' },
  unknown: { color: '#9aa5b1', word: 'Not stated by USGS' },
};

export interface ListedEvent { id: string; updated: number }

/** Event ids and update times from the list query, newest first, malformed rows skipped. */
export function listedLandslideEvents(body: unknown): { events: ListedEvent[]; skipped: number } {
  const features = (body as { features?: unknown })?.features;
  const events: ListedEvent[] = [];
  let skipped = 0;
  for (const f of Array.isArray(features) ? features : []) {
    const id = (f as { id?: unknown })?.id;
    const updated = (f as { properties?: { updated?: unknown } })?.properties?.updated;
    if (typeof id !== 'string' || !LANDSLIDE_EVENT_ID.test(id) || typeof updated !== 'number' || !Number.isFinite(updated)) { skipped++; continue; }
    events.push({ id, updated });
  }
  return { events, skipped };
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && v !== 'None') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
};

/** One event's detail reply → a record, or null when it has no usable landslide estimate. */
export function landslideRecord(body: unknown): GeoRecord | null {
  const b = body as { id?: unknown; geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
  const id = b?.id;
  const coords = b?.geometry?.coordinates;
  const props = b?.properties;
  if (typeof id !== 'string' || !LANDSLIDE_EVENT_ID.test(id) || !Array.isArray(coords) || !props) return null;
  const [lon, lat] = coords as unknown[];
  if (!isValidLon(lon) || !isValidLat(lat)) return null;
  const products = (props.products as Record<string, unknown> | undefined)?.['ground-failure'];
  const product = Array.isArray(products) ? (products[0] as { properties?: Record<string, unknown>; status?: unknown; updateTime?: unknown }) : null;
  const gf = product?.properties;
  if (!gf || product?.status === 'DELETE') return null;
  const alertRaw = String(gf['landslide-alert'] ?? '').toLowerCase();
  const alert = ALERTS.has(alertRaw) ? (alertRaw as LandslideAlert) : null;
  const areaKm2 = num(gf['landslide-hazard-alert-value']);
  const people = num(gf['landslide-population-alert-value']);
  if (!alert && areaKm2 === null) return null;
  const mag = num(props.mag);
  const place = cleanText(props.place, 120);
  const time = num(props.time);
  const updated = typeof product?.updateTime === 'number' ? product.updateTime : null;
  const box = ['landslide-minimum-latitude', 'landslide-maximum-latitude', 'landslide-minimum-longitude', 'landslide-maximum-longitude'].map((k) => num(gf[k]));
  return {
    id,
    lat, lon, altM: null, heading: null, speedKts: null,
    label: `Landslide estimate${mag !== null ? ` · M${mag.toFixed(1)}` : ''}${place ? ` · ${place}` : ''}`,
    category: alert ?? 'unknown',
    observedAt: time !== null ? new Date(time).toISOString() : null,
    sourceUrl: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}/ground-failure/summary`,
    source: 'USGS Ground Failure (model estimate)',
    props: {
      landslideAlert: LANDSLIDE_ALERT_META[alert ?? 'unknown'].word,
      hazardAreaKm2: areaKm2,
      populationExposed: people,
      magnitude: mag,
      modelledArea: box.every((v) => v !== null) ? `${box[0]!.toFixed(2)}° to ${box[1]!.toFixed(2)}° latitude, ${box[2]!.toFixed(2)}° to ${box[3]!.toFixed(2)}° longitude` : null,
      estimateUpdatedAt: updated !== null ? new Date(updated).toISOString() : null,
      mappedNote: 'A model estimate USGS makes after a significant earthquake, not a report of landslides that happened. The marker is the earthquake epicentre; landslides, if any, would be spread across the modelled area.',
    },
  };
}

export function landslideRecords(details: unknown[]): Normalized {
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const d of details) {
    const r = landslideRecord(d);
    if (r) records.push(r); else skipped++;
  }
  return { records, skipped, sourceUpdatedAt: null };
}
