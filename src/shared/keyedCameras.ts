// Camera systems that need a free developer key from the publisher. The customer registers with each publisher
// (accepting its terms) and saves the key in Provider settings; nothing is fetched for a system without a key.
// Keys are stored encrypted (SecretStore) and sent only to that publisher's API host.
//
//   '511' platform (Iteris/IBI "Travel IQ" deployments): GET {host}/api/v2/get/cameras?key=…&format=json.
//       Each camera has Views; each view's Url is a still on the same host: {host}/map/Cctv/{viewId}.
//       Throttled at 10 calls/minute per key; the app makes one call per catalog refresh (every 6 hours).
//   WSDOT (Washington State): GET …/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=…; stills on images.wsdot.wa.gov.
//   Transport for NSW (Australia): GET https://api.transport.nsw.gov.au/v1/live/cameras, header "Authorization: apikey …";
//       GeoJSON; stills on webcams.transport.nsw.gov.au. Creative Commons Attribution.
//   Trafikverket (Sweden): POST https://api.trafikinfo.trafikverket.se/v2/data.json with an XML query carrying the key;
//       stills under api.trafikinfo.trafikverket.se/v2/Images/. Data licensed CC0.

import { isValidLat, isValidLon } from './geo';
import type { GeoRecord } from './layers';
import type { Normalized } from './layerNormalize';
import { cleanText } from './normalize';

export const KEYED_CAMERA_IDS = [
  'cam-on', 'cam-ab', 'cam-sk', 'cam-nb', 'cam-ns', 'cam-nl', 'cam-yt',
  'cam-ga', 'cam-fl', 'cam-az', 'cam-wi', 'cam-id', 'cam-ut', 'cam-la', 'cam-nv', 'cam-ak', 'cam-ct', 'cam-pa', 'cam-ne',
  'cam-wsdot', 'cam-nsw', 'cam-se',
] as const;
export type KeyedCameraId = (typeof KEYED_CAMERA_IDS)[number];

export interface KeyedCameraSystem {
  id: KeyedCameraId;
  name: string;
  kind: '511' | 'wsdot' | 'tfnsw' | 'trafikverket';
  /** API and image origin (no trailing slash). */
  origin: string;
  country: string;
  region: string;
  docsUrl: string;
  signupUrl: string;
  /** What the customer should check about the publisher's terms. */
  termsNote: string;
}

const s511 = (id: KeyedCameraId, name: string, origin: string, country: string, region: string, termsNote = 'Free developer key; by registering you accept the publisher’s terms. Review them for commercial use.'): KeyedCameraSystem => ({
  id,
  name,
  kind: '511',
  origin,
  country,
  region,
  docsUrl: `${origin}/developers/doc`,
  signupUrl: `${origin}/developers/doc`,
  termsNote,
});

export const KEYED_CAMERA_SYSTEMS: KeyedCameraSystem[] = [
  s511('cam-on', 'Ontario 511', 'https://511on.ca', 'Canada', 'Ontario'),
  s511('cam-ab', 'Alberta 511', 'https://511.alberta.ca', 'Canada', 'Alberta'),
  s511('cam-sk', 'Saskatchewan Highway Hotline', 'https://hotline.gov.sk.ca', 'Canada', 'Saskatchewan'),
  s511('cam-nb', 'New Brunswick 511', 'https://511.gnb.ca', 'Canada', 'New Brunswick'),
  s511('cam-ns', 'Nova Scotia 511', 'https://511.novascotia.ca', 'Canada', 'Nova Scotia'),
  s511('cam-nl', 'Newfoundland and Labrador 511', 'https://511nl.ca', 'Canada', 'Newfoundland and Labrador'),
  s511('cam-yt', 'Yukon 511', 'https://511yukon.ca', 'Canada', 'Yukon'),
  s511('cam-ga', 'Georgia 511', 'https://511ga.org', 'United States', 'Georgia'),
  s511('cam-fl', 'Florida 511', 'https://fl511.com', 'United States', 'Florida'),
  s511('cam-az', 'Arizona 511', 'https://az511.gov', 'United States', 'Arizona'),
  s511('cam-wi', 'Wisconsin 511', 'https://511wi.gov', 'United States', 'Wisconsin'),
  s511('cam-id', 'Idaho 511', 'https://511.idaho.gov', 'United States', 'Idaho'),
  s511('cam-ut', 'UDOT Traffic (Utah)', 'https://udottraffic.utah.gov', 'United States', 'Utah'),
  s511('cam-la', 'Louisiana 511', 'https://511la.org', 'United States', 'Louisiana'),
  s511('cam-nv', 'NVRoads (Nevada)', 'https://www.nvroads.com', 'United States', 'Nevada'),
  s511('cam-ak', 'Alaska 511', 'https://511.alaska.gov', 'United States', 'Alaska'),
  s511('cam-ct', 'CTroads (Connecticut)', 'https://ctroads.org', 'United States', 'Connecticut'),
  s511('cam-pa', '511PA (Pennsylvania)', 'https://www.511pa.com', 'United States', 'Pennsylvania', 'Free developer key. PennDOT governs camera use with its own video-sharing agreement: confirm your use is covered before enabling.'),
  s511('cam-ne', 'New England 511 (Maine, New Hampshire, Vermont)', 'https://newengland511.org', 'United States', 'Maine, New Hampshire, Vermont'),
  {
    id: 'cam-wsdot',
    name: 'WSDOT (Washington State)',
    kind: 'wsdot',
    origin: 'https://wsdot.wa.gov',
    country: 'United States',
    region: 'Washington',
    docsUrl: 'https://wsdot.wa.gov/traffic/api/',
    signupUrl: 'https://wsdot.wa.gov/traffic/api/',
    termsNote: 'Free access code from WSDOT (register an e-mail address). WSDOT publishes no explicit licence for the camera images: review its terms for commercial use.',
  },
  {
    id: 'cam-nsw',
    name: 'Transport for NSW Live Traffic Cameras (Australia)',
    kind: 'tfnsw',
    origin: 'https://api.transport.nsw.gov.au',
    country: 'Australia',
    region: 'New South Wales',
    docsUrl: 'https://opendata.transport.nsw.gov.au/dataset/live-traffic-cameras',
    signupUrl: 'https://opendata.transport.nsw.gov.au/',
    termsNote: 'Free API key from the Transport for NSW Open Data Hub. Data under Creative Commons Attribution; credit Transport for NSW.',
  },
  {
    id: 'cam-se',
    name: 'Trafikverket road cameras (Sweden)',
    kind: 'trafikverket',
    origin: 'https://api.trafikinfo.trafikverket.se',
    country: 'Sweden',
    region: 'Sweden',
    docsUrl: 'https://api.trafikinfo.trafikverket.se/',
    signupUrl: 'https://api.trafikinfo.trafikverket.se/',
    termsNote: 'Free key from Trafikverket (register and accept its API licence). Data licensed CC0.',
  },
];

export function keyedCameraSystem(id: string): KeyedCameraSystem | null {
  return KEYED_CAMERA_SYSTEMS.find((s) => s.id === id) ?? null;
}

export const isKeyedCameraId = (id: string): id is KeyedCameraId => (KEYED_CAMERA_IDS as readonly string[]).includes(id);

/** Image URL prefixes the renderer may load for these systems. */
export function keyedCameraImagePrefixes(): string[] {
  return KEYED_CAMERA_SYSTEMS.map((s) =>
    s.kind === '511' ? `${s.origin}/map/Cctv/` : s.kind === 'wsdot' ? 'https://images.wsdot.wa.gov/' : s.kind === 'tfnsw' ? 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/' : 'https://api.trafikinfo.trafikverket.se/v2/Images/',
  );
}

/** Hosts the main process may call for these systems (API requests). */
export function keyedCameraApiHosts(): string[] {
  return [...new Set(KEYED_CAMERA_SYSTEMS.map((s) => new URL(s.origin).hostname))];
}

/** Hosts of the publishers' documentation and sign-up pages (opened in the browser). */
export function keyedCameraLinkHosts(): string[] {
  return [...new Set(KEYED_CAMERA_SYSTEMS.flatMap((s) => [new URL(s.docsUrl).hostname, new URL(s.signupUrl).hostname]).map((h) => h.replace(/^www\./, '')))];
}

// ------------------------------------------------------------------ requests

/** The catalog request for a system (the key goes only to that system's own API host). */
export function keyedCameraRequest(sys: KeyedCameraSystem, key: string): { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string } {
  switch (sys.kind) {
    case '511':
      return { url: `${sys.origin}/api/v2/get/cameras?key=${encodeURIComponent(key)}&format=json`, method: 'GET', headers: { Accept: 'application/json' } };
    case 'wsdot':
      return { url: `${sys.origin}/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${encodeURIComponent(key)}`, method: 'GET', headers: { Accept: 'application/json' } };
    case 'tfnsw':
      return { url: `${sys.origin}/v1/live/cameras`, method: 'GET', headers: { Accept: 'application/json', Authorization: `apikey ${key}` } };
    case 'trafikverket':
      return {
        url: `${sys.origin}/v2/data.json`,
        method: 'POST',
        headers: { 'Content-Type': 'text/xml', Accept: 'application/json' },
        body: `<REQUEST><LOGIN authenticationkey="${escapeXml(key)}"/><QUERY objecttype="Camera" schemaversion="1" limit="20000"><FILTER><EQ name="Active" value="true"/></FILTER></QUERY></REQUEST>`,
      };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ------------------------------------------------------------------ parsing

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

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

const record = (sys: KeyedCameraSystem, id: string, at: { lat: number; lon: number }, label: string, imageUrl: string, locality: string | null, extra: Record<string, string | number | boolean | null> = {}): GeoRecord => ({
  id: `${sys.id}-${id}`,
  lat: at.lat,
  lon: at.lon,
  altM: null,
  heading: null,
  speedKts: null,
  label,
  category: 'Traffic camera',
  observedAt: null,
  sourceUrl: sys.kind === '511' ? sys.origin : sys.docsUrl,
  source: sys.name,
  props: { publisher: sys.name, country: sys.country, locality: locality ?? sys.region, streamUrl: null, mediaType: 'still', updateFrequencyMin: 5, ...extra },
  imageUrl,
});

/** '511' platform cameras: one record per enabled view whose still is on the system's own host. */
export function normalize511Cameras(body: unknown, sys: KeyedCameraSystem): Normalized {
  if (!Array.isArray(body)) throw new Error(`Unexpected ${sys.name} camera response`);
  const prefix = `${sys.origin}/map/Cctv/`;
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const at = position(raw.Latitude, raw.Longitude);
    const views = Array.isArray(raw.Views) ? raw.Views : [];
    const base = cleanText(raw.Name, 120) ?? cleanText(raw.Location, 120) ?? cleanText(raw.Roadway, 80) ?? `${sys.name} camera`;
    let kept = 0;
    for (const v of views) {
      if (!isObject(v)) continue;
      const viewId = typeof v.Id === 'number' && Number.isInteger(v.Id) && v.Id > 0 ? v.Id : null;
      const url = typeof v.Url === 'string' ? v.Url : '';
      const disabled = typeof v.Status === 'string' && /disabled|inactive|offline/i.test(v.Status);
      if (!at || !viewId || disabled || url !== `${prefix}${viewId}`) continue;
      const desc = cleanText(v.Description, 80);
      records.push(record(sys, String(viewId), at, views.length > 1 && desc ? `${base} (${desc})` : base, url, cleanText(raw.Roadway, 60), { view: cleanText(raw.Direction, 40) }));
      kept++;
    }
    if (!kept) skipped++;
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** WSDOT highway cameras (active ones with a still on images.wsdot.wa.gov; http links upgraded to https). */
export function normalizeWsdotCameras(body: unknown, sys: KeyedCameraSystem): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected WSDOT camera response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const id = typeof raw.CameraID === 'number' && Number.isInteger(raw.CameraID) && raw.CameraID > 0 ? raw.CameraID : null;
    const loc = isObject(raw.CameraLocation) ? raw.CameraLocation : {};
    const at = position(loc.Latitude ?? raw.DisplayLatitude, loc.Longitude ?? raw.DisplayLongitude);
    const url = typeof raw.ImageURL === 'string' ? raw.ImageURL.replace(/^http:\/\//, 'https://') : '';
    if (!id || !at || raw.IsActive !== true || !/^https:\/\/images\.wsdot\.wa\.gov\/[A-Za-z0-9/_.-]+\.(jpg|jpeg|png|gif)$/i.test(url)) {
      skipped++;
      continue;
    }
    records.push(record(sys, String(id), at, cleanText(raw.Title, 120) ?? cleanText(loc.Description, 120) ?? 'WSDOT camera', url, cleanText(loc.RoadName, 60) ?? cleanText(raw.Region, 40), { view: cleanText(loc.Direction, 20) }));
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Transport for NSW live traffic cameras (GeoJSON). */
export function normalizeTfnswCameras(body: unknown, sys: KeyedCameraSystem): Normalized {
  const features = isObject(body) && Array.isArray(body.features) ? body.features : null;
  if (!features) throw new Error('Unexpected Transport for NSW camera response');
  const prefix = 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/';
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of features) {
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const p = isObject(raw.properties) ? raw.properties : {};
    const g = isObject(raw.geometry) ? raw.geometry : {};
    const coords = g.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : null;
    const at = coords ? position(coords[1], coords[0]) : null;
    const url = typeof p.href === 'string' ? p.href : '';
    const file = url.startsWith(prefix) ? url.slice(prefix.length) : '';
    const id = cleanText(typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : file.replace(/\.[a-z]+$/i, ''), 80);
    if (!at || !id || !/^[A-Za-z0-9_.-]+\.(jpe?g|png)$/i.test(file)) {
      skipped++;
      continue;
    }
    records.push(record(sys, id.replace(/[^A-Za-z0-9_.-]/g, '_'), at, cleanText(p.title, 120) ?? 'NSW traffic camera', url, cleanText(p.region, 40), { view: cleanText(p.view, 120) ?? cleanText(p.direction, 40) }));
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Trafikverket cameras: Geometry.WGS84 is "POINT (lon lat)"; stills under /v2/Images/. */
export function normalizeTrafikverketCameras(body: unknown, sys: KeyedCameraSystem): Normalized {
  const result = isObject(body) && isObject(body.RESPONSE) && Array.isArray(body.RESPONSE.RESULT) ? body.RESPONSE.RESULT[0] : null;
  const cams = isObject(result) && Array.isArray(result.Camera) ? result.Camera : null;
  if (!cams) throw new Error('Unexpected Trafikverket camera response');
  const prefix = 'https://api.trafikinfo.trafikverket.se/v2/Images/';
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of cams) {
    if (!isObject(raw)) {
      skipped++;
      continue;
    }
    const id = cleanText(raw.Id, 80);
    const wkt = isObject(raw.Geometry) && typeof raw.Geometry.WGS84 === 'string' ? raw.Geometry.WGS84 : '';
    const m = wkt.match(/^POINT\s*\(\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s*\)$/i);
    const at = m ? position(m[2], m[1]) : null;
    const photo = typeof raw.PhotoUrl === 'string' ? raw.PhotoUrl : '';
    if (!id || !at || raw.Active === false || !photo.startsWith(prefix) || !/^[A-Za-z0-9_.-]+$/.test(photo.slice(prefix.length))) {
      skipped++;
      continue;
    }
    const url = raw.HasFullSizePhoto === true ? `${photo}?type=fullsize` : photo;
    records.push(record(sys, id.replace(/[^A-Za-z0-9_.-]/g, '_'), at, cleanText(raw.Name, 120) ?? 'Trafikverket camera', url, cleanText(raw.Description, 80)));
  }
  return { records, skipped, sourceUpdatedAt: null };
}

export function normalizeKeyedCameras(sys: KeyedCameraSystem, body: unknown): Normalized {
  switch (sys.kind) {
    case '511':
      return normalize511Cameras(body, sys);
    case 'wsdot':
      return normalizeWsdotCameras(body, sys);
    case 'tfnsw':
      return normalizeTfnswCameras(body, sys);
    case 'trafikverket':
      return normalizeTrafikverketCameras(body, sys);
  }
}
