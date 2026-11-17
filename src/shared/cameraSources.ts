// Camera catalogs added in v0.7: official open-data publishers whose terms allow use in a commercial app
// (with attribution). Each normalizer keeps only cameras with a position and, where images are shown in the
// app, an image URL on the publisher's own image host (the renderer may load nothing else).
//
//   TfL JamCams (London)         Transport for London open data (based on the UK Open Government Licence);
//                                attribution "Powered by TfL Open Data".
//   Hong Kong Transport Dept.    DATA.GOV.HK terms (commercial use allowed, attribution to the Government).
//   DriveBC (British Columbia)   Open Government Licence – British Columbia; some cameras carry an extra credit.
//   Québec 511 (MTMD)            Données Québec dataset under CC BY 4.0. Its catalog links each camera to the
//                                Québec 511 viewer page (no image file), so these cameras open that page.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import { cleanText } from './normalize';
import type { Normalized } from './layerNormalize';

export const TFL_IMAGE_PREFIX = 'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';
export const HK_IMAGE_PREFIX = 'https://tdcctv.data.one.gov.hk/';
export const DRIVEBC_IMAGE_PREFIX = 'https://www.drivebc.ca/images/';
export const QUEBEC_VIEWER_PREFIX = 'https://www.quebec511.info/Carte/Fenetres/FenetreVideo.html?id=';

const camera = (r: Omit<GeoRecord, 'altM' | 'heading' | 'speedKts' | 'category' | 'observedAt'>): GeoRecord => ({
  altM: null,
  heading: null,
  speedKts: null,
  category: 'Traffic camera',
  observedAt: null,
  ...r,
});

/** A published coordinate: a finite number or a non-empty numeric string (a missing value is not 0). */
const coordinate = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const position = (lat: unknown, lon: unknown): { lat: number; lon: number } | null => {
  const la = coordinate(lat);
  const lo = coordinate(lon);
  return la !== null && lo !== null && isValidLat(la) && isValidLon(lo) && !(la === 0 && lo === 0) ? { lat: la, lon: lo } : null;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** TfL JamCams: `GET https://api.tfl.gov.uk/Place/Type/JamCam`. Only cameras marked available. */
export function normalizeTflJamCams(body: unknown): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected TfL JamCam response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    // One malformed entry is skipped; it must not cost the publisher's other cameras.
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const c = raw;
    const props = new Map<string, unknown>();
    if (Array.isArray(c.additionalProperties)) for (const p of c.additionalProperties as unknown[]) if (isObject(p) && typeof p.key === 'string') props.set(p.key, p.value);
    const id = cleanText(c.id, 60);
    const at = position(c.lat, c.lon);
    const url = typeof props.get('imageUrl') === 'string' ? (props.get('imageUrl') as string) : '';
    if (!id || !/^JamCams_[0-9.]+$/.test(id) || !at || String(props.get('available')) !== 'true' || !url.startsWith(TFL_IMAGE_PREFIX) || !/^[0-9.]+\.jpg$/.test(url.slice(TFL_IMAGE_PREFIX.length))) {
      skipped++;
      continue;
    }
    records.push(
      camera({
        id: `tfl-${id.slice('JamCams_'.length)}`,
        ...at,
        label: cleanText(c.commonName, 120) ?? 'TfL JamCam',
        sourceUrl: 'https://tfl.gov.uk/traffic/status/',
        source: 'TfL JamCams (Powered by TfL Open Data)',
        props: { publisher: 'Transport for London (Powered by TfL Open Data)', country: 'United Kingdom', locality: 'London', view: cleanText(props.get('view'), 40), streamUrl: null, mediaType: 'still', updateFrequencyMin: 5 },
        imageUrl: url,
      }),
    );
  }
  return { records, skipped, sourceUpdatedAt: null };
}

function xmlText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

/** Hong Kong Transport Department: `Traffic_Camera_Locations_En.xml` (DATA.GOV.HK). */
export function normalizeHongKongCams(xml: string): Normalized {
  if (typeof xml !== 'string' || !xml.includes('<image-list')) throw new Error('Unexpected Hong Kong camera list');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const block of xml.match(/<image>[\s\S]*?<\/image>/g) ?? []) {
    const key = xmlText(block, 'key');
    const at = position(xmlText(block, 'latitude'), xmlText(block, 'longitude'));
    const url = xmlText(block, 'url') ?? '';
    if (!key || !/^[A-Za-z0-9_-]{2,40}$/.test(key) || !at || url !== `${HK_IMAGE_PREFIX}${key}.JPG`) {
      skipped++;
      continue;
    }
    records.push(
      camera({
        id: `hk-${key}`,
        ...at,
        label: cleanText(xmlText(block, 'description'), 120) ?? `Hong Kong camera ${key}`,
        sourceUrl: 'https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images',
        source: 'Hong Kong Transport Department (DATA.GOV.HK)',
        props: { publisher: 'Transport Department, Hong Kong SAR Government (DATA.GOV.HK)', country: 'Hong Kong', locality: cleanText(xmlText(block, 'district'), 40), streamUrl: null, mediaType: 'still', updateFrequencyMin: 2 },
        imageUrl: url,
      }),
    );
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** DriveBC: `GET https://www.drivebc.ca/api/webcams/`. Cameras that are on and meant to be shown. */
export function normalizeDriveBc(body: unknown): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected DriveBC webcam response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const c = raw;
    const id = typeof c.id === 'number' && Number.isInteger(c.id) && c.id > 0 ? c.id : null;
    const coords = isObject(c.location) ? c.location.coordinates : undefined;
    const at = Array.isArray(coords) ? position(coords[1], coords[0]) : null;
    const display = isObject(c.links) ? c.links.imageDisplay : undefined;
    if (!id || !at || c.is_on !== true || c.should_appear === false || typeof display !== 'string' || !display.startsWith(`/images/${id}.jpg`)) {
      skipped++;
      continue;
    }
    const period = typeof c.update_period_mean === 'number' && c.update_period_mean > 0 ? c.update_period_mean / 60 : 15;
    const credit = cleanText(c.credit, 160);
    records.push(
      camera({
        id: `drivebc-${id}`,
        ...at,
        label: cleanText(c.name, 120) ?? 'DriveBC camera',
        sourceUrl: 'https://www.drivebc.ca/',
        source: 'DriveBC (Open Government Licence – British Columbia)',
        props: {
          publisher: `DriveBC, Government of British Columbia (Open Government Licence – British Columbia)${credit ? `. ${credit}` : ''}`,
          country: 'Canada',
          locality: cleanText(c.region_name, 40),
          description: cleanText(c.caption, 240),
          view: cleanText(c.orientation, 8),
          stale: c.marked_stale === true || c.marked_delayed === true,
          streamUrl: null,
          mediaType: 'still',
          updateFrequencyMin: Math.min(60, Math.max(1, Math.round(period))),
        },
        imageUrl: `${DRIVEBC_IMAGE_PREFIX}${id}.jpg`,
      }),
    );
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Québec 511 cameras (Données Québec WFS, GeoJSON in EPSG:4326). Each opens the Québec 511 viewer page. */
export function normalizeQuebecCams(body: unknown): Normalized {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) throw new Error('Unexpected Québec camera response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of features) {
    const f = raw as { properties?: Record<string, unknown>; geometry?: { type?: unknown; coordinates?: unknown } };
    const p = f?.properties ?? {};
    const id = cleanText(p.IDEcamera, 12);
    const coords = f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    const at = coords ? position(coords[1], coords[0]) : null;
    const viewer = typeof p.URL_FLUX_DONNEE === 'string' ? p.URL_FLUX_DONNEE : '';
    if (!id || !/^\d{1,9}$/.test(id) || !at || viewer !== `${QUEBEC_VIEWER_PREFIX}${id}`) {
      skipped++;
      continue;
    }
    records.push(
      camera({
        id: `qc-${id}`,
        ...at,
        label: cleanText(p.DescriptionLocalisationEn, 120) ?? cleanText(p.DescriptionLocalisationFr, 120) ?? `Québec 511 camera ${id}`,
        sourceUrl: viewer,
        source: 'Québec 511, Ministère des Transports et de la Mobilité durable (CC BY 4.0)',
        props: {
          publisher: 'Québec 511, Ministère des Transports et de la Mobilité durable du Québec (CC BY 4.0)',
          country: 'Canada',
          locality: cleanText(p.NomRegionDiffusion, 60),
          streamUrl: null,
          mediaType: 'viewer',
          viewerName: 'Québec 511',
          updateFrequencyMin: null,
        },
        imageUrl: null,
      }),
    );
  }
  return { records, skipped, sourceUpdatedAt: null };
}

// ---------------------------------------------------------------- added 2026-11-14 (keyless, attribution licences)
//   Vegagerðin (Iceland)   CC BY 4.0 (IRCA terms of use). Several views per station.
//   Open Calgary           Open Government Licence – City of Calgary.
//   City of Toronto        Open Government Licence – Toronto. The list has no image field; the still address is
//                          built from the camera number, as the dataset documents.

export const ICELAND_IMAGE_PREFIX = 'https://www.vegagerdin.is/vgdata/vefmyndavelar/';
export const CALGARY_IMAGE_PREFIX = 'https://trafficcam.calgary.ca/';
export const TORONTO_IMAGE_PREFIX = 'https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/';

const still = { streamUrl: null, mediaType: 'still' } as const;

/** Vegagerðin: `GET https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1` (one row per camera view). */
export function normalizeIcelandCams(body: unknown): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected Vegagerðin camera response');
  const records: GeoRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const c of body.slice(0, 3000)) {
    const at = isObject(c) ? position(c.Breidd, c.Lengd) : null;
    const url = isObject(c) && typeof c.Slod === 'string' ? c.Slod : '';
    const file = url.startsWith(ICELAND_IMAGE_PREFIX) ? url.slice(ICELAND_IMAGE_PREFIX.length) : '';
    if (!isObject(c) || !at || !/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(file) || seen.has(file)) { skipped++; continue; }
    seen.add(file);
    records.push(camera({
      id: `iceland-${file.slice(0, -4)}`,
      ...at,
      label: cleanText(c.Myndavel, 120) ?? 'Road camera',
      sourceUrl: 'https://www.vegagerdin.is/',
      source: 'Icelandic Road and Coastal Administration (Vegagerðin), CC BY 4.0',
      props: { publisher: 'Icelandic Road and Coastal Administration (Vegagerðin), CC BY 4.0', country: 'Iceland', locality: cleanText(c.Vegheiti, 60), description: cleanText(c.Skyring, 240), ...still, updateFrequencyMin: null },
      imageUrl: `${ICELAND_IMAGE_PREFIX}${file}`,
    }));
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Open Calgary dataset k7p9-kppz. The `quadrant` field is Calgary's address grid, not the direction the camera faces. */
export function normalizeCalgaryCams(body: unknown): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected Calgary camera response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const c of body.slice(0, 3000)) {
    const coords = isObject(c) && isObject(c.point) ? c.point.coordinates : undefined;
    const at = Array.isArray(coords) ? position(coords[1], coords[0]) : null;
    const raw = isObject(c) && isObject(c.camera_url) && typeof c.camera_url.url === 'string' ? c.camera_url.url.replace(/^http:\/\//, 'https://') : '';
    const m = /^https:\/\/trafficcam\.calgary\.ca\/(loc\d{1,5}\.jpg)$/.exec(raw);
    if (!isObject(c) || !at || !m) { skipped++; continue; }
    records.push(camera({
      id: `calgary-${m[1].slice(0, -4)}`,
      ...at,
      label: cleanText(c.camera_location, 120) ?? 'Calgary traffic camera',
      sourceUrl: 'https://data.calgary.ca/Transportation-Transit/Traffic-Cameras/k7p9-kppz',
      source: 'City of Calgary (Open Government Licence – City of Calgary)',
      props: { publisher: 'Contains information licensed under the Open Government Licence – City of Calgary', country: 'Canada', locality: 'Calgary', cityQuadrant: cleanText(c.quadrant, 12), ...still, updateFrequencyMin: null },
      imageUrl: `${CALGARY_IMAGE_PREFIX}${m[1]}`,
    }));
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** City of Toronto RESCU list, published as JSONP: `jsonTMCEarthCamerasCallback({"Data":[…]})`. */
export function normalizeTorontoCams(text: string): Normalized {
  const m = /^\s*jsonTMCEarthCamerasCallback\(([\s\S]*)\)\s*;?\s*$/.exec(text);
  let data: unknown;
  try {
    data = (JSON.parse(m ? m[1] : text) as { Data?: unknown }).Data;
  } catch {
    throw new Error('Unexpected Toronto camera response');
  }
  if (!Array.isArray(data)) throw new Error('Unexpected Toronto camera response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const c of data.slice(0, 3000)) {
    const at = isObject(c) ? position(c.Latitude, c.Longitude) : null;
    const number = isObject(c) && typeof c.Number === 'string' && /^\d{1,6}$/.test(c.Number) ? c.Number : null;
    if (!isObject(c) || !at || !number) { skipped++; continue; }
    records.push(camera({
      id: `toronto-${number}`,
      ...at,
      label: cleanText(c.Name, 120) ?? 'Toronto traffic camera',
      sourceUrl: 'https://open.toronto.ca/dataset/traffic-cameras/',
      source: 'City of Toronto (Open Government Licence – Toronto)',
      props: { publisher: 'Contains information licensed under the Open Government Licence – Toronto', country: 'Canada', locality: 'Toronto', roadClass: cleanText(c.Group, 30), ...still, updateFrequencyMin: null },
      imageUrl: `${TORONTO_IMAGE_PREFIX}loc${number}.jpg`,
    }));
  }
  return { records, skipped, sourceUpdatedAt: null };
}
