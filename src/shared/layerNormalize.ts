// Normalizers for the additional data layers. Remote payloads are untrusted:
// fields are type-checked and length-limited; malformed records are skipped.

import type { LineString, MultiPolygon, Polygon } from 'geojson';
import { isValidLat, isValidLon, sanitizePolygonGeometry } from './geo';
import type { GeoRecord } from './layers';
import { cleanText, toIso } from './normalize';
import { parseAirframeYear } from './vehicleInfo';
import { hasAirlinerProfile } from './airlinerProfile';

export interface Normalized {
  records: GeoRecord[];
  skipped: number;
  sourceUpdatedAt: string | null;
}

/** Perimeter refresh bounds; never silently truncate the published feature set or shape. */
export const WFIGS_PERIMETER_LIMITS = Object.freeze({ pages: 20, pageRecords: 1000, coordinates: 500_000, partsPerFeature: 10_000, ringsPerFeature: 20_000 });

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const FT = 0.3048;

/** ADS-B emitter categories (DO-260B). Reported by the transponder; may be unset or wrong. */
export const EMITTER_CATEGORY: Record<string, string> = {
  A1: 'Light aircraft',
  A2: 'Small aircraft',
  A3: 'Large aircraft',
  A4: 'High-vortex large (e.g. B757)',
  A5: 'Heavy aircraft',
  A6: 'High performance',
  A7: 'Rotorcraft',
  B1: 'Glider/sailplane',
  B2: 'Lighter-than-air',
  B3: 'Parachutist/skydiver',
  B4: 'Ultralight',
  B6: 'Unmanned aerial vehicle',
  B7: 'Space/trans-atmospheric',
  C1: 'Surface emergency vehicle',
  C2: 'Surface service vehicle',
  C3: 'Ground obstruction',
};

/** adsb.lol / readsb aircraft JSON (`ac` array, readsb `aircraft` array). */
/**
 * `geoid` (optional): height of sea level above the WGS84 ellipsoid at a position. Altitudes are kept above sea
 * level (the reference of barometric alt_baro); a report with only alt_geom (GNSS height above the ellipsoid) is
 * converted with it. Without it, alt_geom is used as reported.
 */
export function normalizeAdsb(body: unknown, source: string, nowMs: number, geoid?: (lat: number, lon: number) => number | null): Normalized {
  const b = body as { ac?: unknown; aircraft?: unknown; now?: unknown };
  const list = Array.isArray(b?.ac) ? b.ac : Array.isArray(b?.aircraft) ? b.aircraft : null;
  if (!list) throw new Error('Aircraft response has no aircraft list');
  const nowRaw = num(b.now);
  // adsb.lol `now` is ms; readsb aircraft.json `now` is seconds.
  const refMs = nowRaw === null ? nowMs : nowRaw > 1e12 ? nowRaw : nowRaw * 1000;
  const reportYear = new Date(refMs).getUTCFullYear();
  const records: GeoRecord[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const raw of list) {
    const a = raw as Record<string, unknown>;
    const hex = cleanText(a?.hex, 12)?.toLowerCase();
    const lat = a?.lat;
    const lon = a?.lon;
    if (!hex || !/^~?[0-9a-f]{6}$/.test(hex) || !isValidLat(lat) || !isValidLon(lon) || seen.has(hex)) {
      skipped++;
      continue;
    }
    seen.add(hex);
    const seenPos = num(a.seen_pos) ?? num(a.seen) ?? 0;
    const onGround = a.alt_baro === 'ground';
    const baroFt = num(a.alt_baro);
    const geomFt = num(a.alt_geom);
    const altM = onGround ? 0 : baroFt !== null ? baroFt * FT : geomFt !== null ? geomFt * FT - (geoid?.(lat, lon) ?? 0) : null;
    const flight = cleanText(a.flight, 12);
    const cat = cleanText(a.category, 3);
    const dbFlags = num(a.dbFlags) ?? 0;
    const type = cleanText(a.t, 8);
    // readsb's optional database metadata is distinct from its position reports.
    // Bits 0, 2 and 3 mark military, PIA and LADD records.
    const publicAirlinerMetadata = (a.year != null || a.ownOp != null) && (dbFlags & 13) === 0 && hasAirlinerProfile(type);
    const groundTrack = num(a.track);
    const trueHeading = num(a.true_heading);
    records.push({
      id: hex,
      lat,
      lon,
      altM,
      heading: groundTrack ?? trueHeading,
      speedKts: num(a.gs),
      label: flight ?? cleanText(a.r, 12) ?? hex.toUpperCase(),
      category: cat && EMITTER_CATEGORY[cat] ? EMITTER_CATEGORY[cat] : null,
      observedAt: new Date(refMs - seenPos * 1000).toISOString(),
      sourceUrl: `https://globe.adsb.lol/?icao=${hex.replace('~', '')}`,
      source,
      props: {
        icao24: hex,
        groundTrackDeg: groundTrack,
        trueHeadingDeg: trueHeading,
        directionSource: groundTrack !== null ? 'ground-track' : trueHeading !== null ? 'true-heading' : null,
        callsign: flight,
        registration: cleanText(a.r, 12),
        type,
        description: cleanText(a.desc, 60),
        airframeYear: publicAirlinerMetadata ? parseAirframeYear(a.year, reportYear) : null,
        ownerOperator: publicAirlinerMetadata ? cleanText(a.ownOp, 100) : null,
        emitterCategory: cat,
        altitudeFt: onGround ? 0 : baroFt ?? (altM === null ? null : Math.round(altM / FT)),
        onGround,
        squawk: cleanText(a.squawk, 4),
        emergency: cleanText(a.emergency, 20),
        militaryFlag: (dbFlags & 1) === 1,
        restrictedTracking: (dbFlags & 12) !== 0,
        positionAgeS: Math.round(seenPos * 10) / 10,
        verticalRateFpm: num(a.baro_rate) ?? num(a.geom_rate),
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: new Date(refMs).toISOString() };
}

export interface VesselStatic {
  name: string | null;
  shipType: number | null;
  destination: string | null;
  callSign: string | null;
  imo?: number | null;
  draughtM?: number | null;
  etaText?: string | null;
  lengthM?: number | null;
  beamM?: number | null;
}

/** AIS "not available" encodings: SOG 102.3 kn, COG 360°, heading 511. */
export function aisSog(v: unknown): number | null {
  const n = num(v);
  return n === null || n >= 102.2 || n < 0 ? null : n;
}
export function aisCog(v: unknown): number | null {
  const n = num(v);
  return n === null || n >= 360 || n < 0 ? null : n;
}
export function aisHeading(v: unknown): number | null {
  const n = num(v);
  return n === null || n >= 360 || n < 0 ? null : n;
}

/** Decodes the packed AIS ETA (month<<16 | day<<11 | hour<<6 | minute). Returns null when not available. */
export function decodePackedEta(eta: unknown): string | null {
  const n = num(eta);
  if (n === null || n <= 0) return null;
  const month = (n >> 16) & 0xf;
  const day = (n >> 11) & 0x1f;
  const hour = (n >> 6) & 0x1f;
  const minute = n & 0x3f;
  return formatEta(month, day, hour, minute);
}
export function formatEta(month: number, day: number, hour: number, minute: number): string | null {
  if (!month || month > 12 || !day || day > 31) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const time = hour < 24 && minute < 60 ? ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC` : '';
  return `${mm}-${dd}${time} (reported, no year)`;
}
/** Hull length and beam from AIS reference-point distances (0 = unknown). */
export function aisDimensions(a: unknown, b: unknown, c: unknown, d: unknown): { lengthM: number | null; beamM: number | null } {
  const [A, B, C, D] = [num(a) ?? 0, num(b) ?? 0, num(c) ?? 0, num(d) ?? 0];
  return { lengthM: A + B > 0 && A + B < 511 ? A + B : null, beamM: C + D > 0 && C + D < 127 ? C + D : null };
}

/** Digitraffic AIS locations (GeoJSON) merged with vessel metadata. */
export function normalizeDigitrafficAis(locations: unknown, metadata: Map<number, VesselStatic>): Normalized {
  const b = locations as { features?: unknown; dataUpdatedTime?: unknown };
  if (!Array.isArray(b?.features)) throw new Error('AIS response is not a FeatureCollection');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const f of b.features) {
    const feat = f as { mmsi?: unknown; geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const mmsi = num(feat?.mmsi);
    const c = feat?.geometry?.coordinates as unknown[] | undefined;
    const p = feat?.properties ?? {};
    if (mmsi === null || !Array.isArray(c) || !isValidLon(c[0]) || !isValidLat(c[1])) {
      skipped++;
      continue;
    }
    const meta = metadata.get(mmsi);
    const heading = aisHeading(p.heading);
    records.push({
      id: String(mmsi),
      lat: c[1] as number,
      lon: c[0] as number,
      altM: null,
      heading: heading ?? aisCog(p.cog),
      speedKts: aisSog(p.sog),
      label: meta?.name ?? `MMSI ${mmsi}`,
      category: shipTypeLabel(meta?.shipType ?? null),
      observedAt: toIso(num(p.timestampExternal)),
      sourceUrl: 'https://www.digitraffic.fi/en/marine-traffic/',
      source: 'Fintraffic / digitraffic.fi (CC BY 4.0)',
      props: {
        mmsi,
        imo: meta?.imo ?? null,
        callSign: meta?.callSign ?? null,
        destinationReported: meta?.destination ?? null,
        etaReported: meta?.etaText ?? null,
        shipType: meta?.shipType ?? null,
        lengthM: meta?.lengthM ?? null,
        beamM: meta?.beamM ?? null,
        draughtM: meta?.draughtM ?? null,
        navStatus: navStatusLabel(num(p.navStat)),
        courseDeg: aisCog(p.cog),
        headingDeg: heading,
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: toIso(b.dataUpdatedTime) };
}

export function shipTypeLabel(t: number | null): string | null {
  if (t === null) return null;
  if (Number.isInteger(t) && t >= 20 && t <= 29) return 'Wing-in-ground craft';
  if (t >= 70 && t <= 79) return 'Cargo';
  if (t >= 80 && t <= 89) return 'Tanker';
  if (t >= 60 && t <= 69) return 'Passenger';
  if (t === 30) return 'Fishing';
  if (t === 31 || t === 32 || t === 52) return 'Towing/tug';
  if (t === 33) return 'Dredging or underwater operations';
  if (t === 34) return 'Diving operations';
  if (t === 35) return 'Military operations';
  if (t === 36) return 'Sailing';
  if (t === 37) return 'Pleasure craft';
  if (t === 50) return 'Pilot vessel';
  if (t === 51) return 'Search and rescue';
  if (t === 53) return 'Port tender';
  if (t === 54) return 'Pollution response';
  if (t === 55) return 'Law enforcement';
  if (t === 58) return 'Medical transport';
  if (t >= 40 && t <= 49) return 'High-speed craft';
  return 'Other';
}

const NAV_STATUS = ['Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught', 'Moored', 'Aground', 'Engaged in fishing', 'Under way sailing'];
export function navStatusLabel(n: number | null): string | null {
  return n === null ? null : (NAV_STATUS[n] ?? 'Not defined');
}

/** CelesTrak TLE text (3-line format). */
export function normalizeTle(text: string, group: string): Normalized {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (let i = 0; i + 2 < lines.length + 1; ) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!l1 || !l2 || !/^1 \d{5}/.test(l1) || !/^2 \d{5}/.test(l2) || l1.length < 69 || l2.length < 69) {
      skipped++;
      i += 1;
      continue;
    }
    const norad = l1.slice(2, 7).trim();
    // Epoch: YYDDD.DDDDDDDD in columns 19-32.
    const yy = Number(l1.slice(18, 20));
    const doy = Number(l1.slice(20, 32));
    const epoch = Number.isFinite(yy) && Number.isFinite(doy) ? new Date(Date.UTC(yy < 57 ? 2000 + yy : 1900 + yy, 0, 1) + (doy - 1) * 86400_000).toISOString() : null;
    records.push({
      id: norad,
      lat: 0,
      lon: 0,
      altM: null,
      heading: null,
      speedKts: null,
      label: cleanText(name, 40) ?? `NORAD ${norad}`,
      category: group,
      observedAt: epoch,
      sourceUrl: `https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}`,
      source: 'CelesTrak (orbital elements); position calculated by SGP4',
      props: { noradId: Number(norad), elementEpoch: epoch, group },
      tle: [l1.slice(0, 69), l2.slice(0, 69)],
    });
    i += 3;
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** NASA FIRMS active fire CSV (VIIRS). */
export function normalizeFirmsCsv(csv: string, region: string): Normalized {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error('Empty FIRMS file');
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (n: string) => header.indexOf(n);
  const iLat = idx('latitude');
  const iLon = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) throw new Error('Unexpected FIRMS columns');
  const records: GeoRecord[] = [];
  let skipped = 0;
  let latest = 0;
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    const t = c[iTime]?.padStart(4, '0');
    const when = Date.parse(`${c[iDate]}T${t?.slice(0, 2)}:${t?.slice(2, 4)}:00Z`);
    if (!isValidLat(lat) || !isValidLon(lon) || Number.isNaN(when)) {
      skipped++;
      continue;
    }
    if (when > latest) latest = when;
    const sat = c[idx('satellite')] ?? '';
    const frp = Number(c[idx('frp')]);
    records.push({
      id: `${lat.toFixed(5)},${lon.toFixed(5)},${c[iDate]}T${t},${sat}`,
      lat,
      lon,
      altM: null,
      heading: null,
      speedKts: null,
      label: `Fire detection${Number.isFinite(frp) ? ` · ${frp.toFixed(1)} MW` : ''}`,
      category: c[idx('daynight')] === 'N' ? 'Night detection' : 'Day detection',
      observedAt: new Date(when).toISOString(),
      sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/map/',
      source: 'NASA FIRMS (VIIRS NOAA-20)',
      props: {
        satellite: sat,
        instrument: c[idx('instrument')] ?? null,
        confidence: c[idx('confidence')] ?? null,
        frpMW: Number.isFinite(frp) ? frp : null,
        brightnessK: Number(c[idx('bright_ti4')]) || null,
        region,
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: latest ? new Date(latest).toISOString() : null };
}

/** ArcGIS GeoJSON feature collection (WFIGS perimeters, FAA SUA). */
export function normalizeArcgisPolygons(body: unknown, kind: 'perimeter' | 'airspace'): Normalized {
  const b = body as { type?: unknown; features?: unknown; error?: unknown; crs?: { type?: unknown; properties?: { name?: unknown } } };
  if (!Array.isArray(b?.features)) throw new Error('Response is not a GeoJSON FeatureCollection');
  if (kind === 'perimeter') {
    if (b.type !== 'FeatureCollection' || b.error != null) throw new Error('NIFC did not supply a valid GeoJSON FeatureCollection.');
    if (b.features.length > WFIGS_PERIMETER_LIMITS.pageRecords) throw new Error('NIFC perimeter page exceeds the feature limit.');
    if (b.crs != null && (b.crs.type !== 'name' || !['urn:ogc:def:crs:EPSG::4326', 'urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'OGC:CRS84'].includes(String(b.crs.properties?.name))))
      throw new Error('NIFC perimeter coordinates are not declared WGS84.');
  }
  const records: GeoRecord[] = [];
  let skipped = 0, coordinates = 0;
  for (const f of b.features) {
    const feat = f as { id?: unknown; geometry?: unknown; properties?: Record<string, unknown> };
    if (kind === 'perimeter') {
      if (!feat || typeof feat !== 'object' || Array.isArray(feat) || !feat.properties || typeof feat.properties !== 'object' || Array.isArray(feat.properties)) { skipped++; continue; }
      // Check lengths before walking untrusted coordinate tuples. Keep every part and every hole.
      const count = perimeterCoordinateCount(feat?.geometry);
      if (count === null) { skipped++; continue; }
      coordinates += count;
      if (coordinates > WFIGS_PERIMETER_LIMITS.coordinates) throw new Error('NIFC perimeter coordinates exceed the query limit.');
    }
    const geom = sanitizePolygonGeometry(feat?.geometry);
    const p = feat?.properties ?? {};
    if (!geom) {
      skipped++;
      continue;
    }
    const c = polygonCenter(geom);
    if (kind === 'perimeter') {
      const identity = perimeterIdentity(feat.id, p);
      if (!identity) { skipped++; continue; }
      const name = cleanText(p.poly_IncidentName, 120) ?? 'Unnamed incident';
      const gisAcres = nonnegative(p.poly_GISAcres), incidentAcres = nonnegative(p.attr_IncidentSize);
      const dateCurrent = toIso(num(p.poly_DateCurrent)), polygonDateTime = toIso(num(p.poly_PolygonDateTime));
      const contained = num(p.attr_PercentContained), incidentType = cleanText(p.attr_IncidentTypeCategory, 20);
      records.push({
        id: identity.id,
        lat: c.lat,
        lon: c.lon,
        altM: null,
        heading: null,
        speedKts: null,
        label: name,
        category: incidentType === 'WF' ? 'Wildfire perimeter' : incidentType === 'RX' ? 'Prescribed fire perimeter' : 'Fire perimeter',
        observedAt: dateCurrent ?? polygonDateTime,
        sourceUrl: 'https://www.arcgis.com/home/item.html?id=d1c32af3212341869b3c810f1a215824',
        source: 'NIFC WFIGS',
        props: {
          // Legacy acres remains for existing callers. GIS footprint and reported incident size are separate facts.
          acres: incidentAcres ?? gisAcres,
          gisAcres,
          incidentAcres,
          incidentType,
          percentContained: contained !== null && contained >= 0 && contained <= 100 ? contained : null,
          incidentId: cleanText(p.attr_UniqueFireIdentifier, 100),
          irwinId: cleanText(p.poly_IRWINID, 100),
          globalId: identity.globalId,
          objectId: identity.objectId,
          dateCurrent,
          polygonDateTime,
          discovered: toIso(num(p.attr_FireDiscoveryDateTime)),
          state: cleanText(p.attr_POOState, 12),
        },
        geometry: geom,
      });
    } else {
      const name = cleanText(p.NAME, 120) ?? 'Special use airspace';
      records.push({
        id: cleanText(p.GLOBAL_ID, 60) ?? String(p.OBJECTID ?? `${c.lat},${c.lon}`),
        lat: c.lat,
        lon: c.lon,
        altM: null,
        heading: null,
        speedKts: null,
        label: name,
        category: p.TYPE_CODE === 'P' ? 'Prohibited area' : 'Restricted area',
        observedAt: null,
        sourceUrl: 'https://adds-faa.opendata.arcgis.com/',
        source: 'FAA Special Use Airspace',
        props: {
          type: cleanText(p.TYPE_CODE, 4),
          upper: [cleanText(p.UPPER_DESC, 20), num(p.UPPER_VAL), cleanText(p.UPPER_UOM, 8)].filter((x) => x !== null && x !== '').join(' ') || null,
          lower: [cleanText(p.LOWER_DESC, 20), num(p.LOWER_VAL), cleanText(p.LOWER_UOM, 8)].filter((x) => x !== null && x !== '').join(' ') || null,
          timesOfUse: cleanText(p.TIMESOFUSE, 200),
          controllingAgency: cleanText(p.CONT_AGENT, 120),
          state: cleanText(p.STATE, 8),
        },
        geometry: geom,
      });
    }
  }
  return { records, skipped, sourceUpdatedAt: null };
}

function nonnegative(value: unknown): number | null { const n = num(value); return n !== null && n >= 0 ? n : null; }
function perimeterIdentity(featureId: unknown, properties: Record<string, unknown>): { id: string; globalId: string | null; objectId: number | null } | null {
  const rawGlobal = properties.GlobalID;
  const globalText = typeof rawGlobal === 'string' && rawGlobal.startsWith('{') && rawGlobal.endsWith('}') ? rawGlobal.slice(1, -1) : rawGlobal;
  const globalId = typeof globalText === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(globalText) ? globalText.toLowerCase() : null;
  const oid = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value
    : typeof value === 'string' && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const objectId = oid(properties.OBJECTID) ?? oid(featureId);
  if (globalId) return { id: `wfigs:global:${globalId}`, globalId, objectId };
  return objectId === null ? null : { id: `wfigs:object:${objectId}`, globalId: null, objectId };
}

/** The entire supplied polygon is accepted or skipped; parts and exclusion rings are never flattened. */
function perimeterCoordinateCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as { type?: unknown; coordinates?: unknown };
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : null;
  if (!polygons?.length || polygons.length > WFIGS_PERIMETER_LIMITS.partsPerFeature) return null;
  let count = 0, rings = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return null;
    rings += polygon.length; if (rings > WFIGS_PERIMETER_LIMITS.ringsPerFeature) return null;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      count += ring.length; if (count > WFIGS_PERIMETER_LIMITS.coordinates) return null;
    }
  }
  return count;
}

function polygonCenter(g: Polygon | MultiPolygon): { lat: number; lon: number } {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

/** AWC METAR JSON. */
export function normalizeMetar(body: unknown): Normalized {
  if (body === null) return { records: [], skipped: 0, sourceUpdatedAt: null };
  if (!Array.isArray(body)) throw new Error('METAR response is not an array');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    const m = raw as Record<string, unknown>;
    const id = cleanText(m?.icaoId, 8);
    if (!id || !isValidLat(m.lat) || !isValidLon(m.lon)) {
      skipped++;
      continue;
    }
    const temp = num(m.temp);
    records.push({
      id,
      lat: m.lat as number,
      lon: m.lon as number,
      altM: num(m.elev),
      heading: num(m.wdir),
      speedKts: num(m.wspd),
      label: `${id}${temp !== null ? ` ${Math.round(temp)}°C` : ''}`,
      category: cleanText(m.fltCat, 6),
      observedAt: toIso(typeof m.obsTime === 'number' ? m.obsTime * 1000 : m.reportTime),
      sourceUrl: `https://aviationweather.gov/data/metar/?ids=${encodeURIComponent(id)}`,
      source: 'NOAA Aviation Weather Center',
      props: {
        station: cleanText(m.name, 80),
        tempC: temp,
        dewpointC: num(m.dewp),
        windDir: typeof m.wdir === 'string' ? m.wdir : num(m.wdir),
        windKt: num(m.wspd),
        gustKt: num(m.wgst),
        visibility: typeof m.visib === 'string' ? cleanText(m.visib, 8) : num(m.visib),
        altimeterHpa: num(m.altim),
        weather: cleanText(m.wxString, 40),
        flightCategory: cleanText(m.fltCat, 6),
        raw: cleanText(m.rawOb, 300),
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** NHC CurrentStorms.json. */
export function normalizeNhc(body: unknown): Normalized {
  const b = body as { activeStorms?: unknown };
  if (!b || !Array.isArray(b.activeStorms)) throw new Error('Unexpected NHC response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of b.activeStorms) {
    const s = raw as Record<string, unknown>;
    const id = cleanText(s?.id, 20);
    const lat = num(s?.latitudeNumeric);
    const lon = num(s?.longitudeNumeric);
    if (!id || !isValidLat(lat) || !isValidLon(lon)) {
      skipped++;
      continue;
    }
    const link = (o: unknown) => {
      const u = o && typeof o === 'object' ? (o as { url?: unknown }).url : null;
      return typeof u === 'string' && /^https:\/\/www\.nhc\.noaa\.gov\//.test(u) ? u : null;
    };
    const cls: Record<string, string> = { TD: 'Tropical Depression', TS: 'Tropical Storm', HU: 'Hurricane', MH: 'Major Hurricane', STD: 'Subtropical Depression', STS: 'Subtropical Storm', PTC: 'Post-tropical Cyclone', TY: 'Typhoon', PC: 'Potential Tropical Cyclone' };
    const c = cleanText(s.classification, 4);
    records.push({
      id,
      lat: lat as number,
      lon: lon as number,
      altM: null,
      heading: num(s.movementDir),
      speedKts: num(s.movementSpeed) !== null ? (num(s.movementSpeed) as number) * 0.868976 : null,
      label: `${c && cls[c] ? cls[c] : (c ?? 'Storm')} ${cleanText(s.name, 40) ?? ''}`.trim(),
      category: c && cls[c] ? cls[c] : c,
      observedAt: toIso(s.lastUpdate),
      sourceUrl: link(s.publicAdvisory) ?? 'https://www.nhc.noaa.gov/',
      source: 'NOAA NHC',
      props: {
        intensityKt: num(Number(s.intensity)),
        pressureMb: num(Number(s.pressure)),
        movementMph: num(s.movementSpeed),
        forecastGraphics: link(s.forecastGraphics),
        binNumber: cleanText(s.binNumber, 8),
      },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Caltrans CCTV district JSON. Only in-service cameras with an image are kept. */
export function normalizeCaltrans(body: unknown, district: number): Normalized {
  const b = body as { data?: unknown };
  if (!Array.isArray(b?.data)) throw new Error('Unexpected Caltrans response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of b.data) {
    const c = (raw as { cctv?: Record<string, unknown> })?.cctv;
    const loc = (c?.location ?? {}) as Record<string, unknown>;
    const img = ((c?.imageData as Record<string, unknown> | undefined)?.static ?? {}) as Record<string, unknown>;
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    const url = typeof img.currentImageURL === 'string' ? img.currentImageURL : '';
    if (!c || c.inService !== 'true' || !isValidLat(lat) || !isValidLon(lon) || !/^https:\/\/cwwp2\.dot\.ca\.gov\/data\/d\d+\/cctv\/image\//.test(url)) {
      skipped++;
      continue;
    }
    const rt = (c.recordTimestamp ?? {}) as Record<string, unknown>;
    const stream = (c.imageData as Record<string, unknown> | undefined)?.streamingVideoURL;
    const streamUrl = typeof stream === 'string' && /^https:\/\/wzmedia\.dot\.ca\.gov\/[A-Za-z0-9_./-]+\.m3u8$/.test(stream) ? stream : null;
    records.push({
      id: `caltrans-d${district}-${cleanText(c.index, 12) ?? `${lat},${lon}`}`,
      lat,
      lon,
      altM: num(Number(loc.elevation)),
      heading: null,
      speedKts: null,
      label: cleanText(loc.locationName, 120) ?? 'Caltrans camera',
      category: 'Traffic camera',
      // The record timestamp describes the catalog entry, not the image; image time is the publisher's.
      observedAt: null,
      sourceUrl: 'https://cwwp2.dot.ca.gov/vm/iframemap.htm',
      source: 'Caltrans CCTV',
      props: {
        route: cleanText(loc.route, 12),
        direction: cleanText(loc.direction, 20),
        county: cleanText(loc.county, 40),
        nearbyPlace: cleanText(loc.nearbyPlace, 60),
        updateFrequencyMin: num(Number(img.currentImageUpdateFrequency)),
        // Caltrans publishes local (Pacific) date/time without a zone; keep it verbatim rather than guess an offset.
        catalogRecordUpdated: rt.recordDate ? `${cleanText(rt.recordDate, 12)} ${cleanText(rt.recordTime, 10) ?? ''} (California local time)`.trim() : null,
        publisher: `Caltrans District ${district}`,
        country: 'United States',
        locality: cleanText(loc.nearbyPlace, 60) ?? cleanText(loc.county, 40),
        // Live HLS stream published by Caltrans for this camera, if any. Its availability is checked when played.
        streamUrl,
        mediaType: streamUrl ? 'hls' : 'still',
      },
      imageUrl: url,
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** Fintraffic weather camera stations (GeoJSON). */
export function normalizeFintrafficCams(body: unknown): Normalized {
  const b = body as { features?: unknown; dataUpdatedTime?: unknown };
  if (!Array.isArray(b?.features)) throw new Error('Unexpected weathercam response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const f of b.features) {
    const feat = f as { id?: unknown; geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const c = feat?.geometry?.coordinates as unknown[] | undefined;
    const p = feat?.properties ?? {};
    const presets = Array.isArray(p.presets) ? (p.presets as Record<string, unknown>[]) : [];
    const preset = presets.find((x) => x.inCollection !== false) ?? presets[0];
    const presetId = cleanText(preset?.id, 20);
    if (!Array.isArray(c) || !isValidLon(c[0]) || !isValidLat(c[1]) || !presetId || !/^[A-Z0-9]+$/.test(presetId)) {
      skipped++;
      continue;
    }
    records.push({
      id: `fintraffic-${cleanText(feat.id, 20) ?? presetId}`,
      lat: c[1] as number,
      lon: c[0] as number,
      altM: null,
      heading: null,
      speedKts: null,
      label: cleanText(p.name, 120) ?? 'Fintraffic weather camera',
      category: 'Road weather camera',
      observedAt: null,
      sourceUrl: 'https://www.digitraffic.fi/en/road-traffic/',
      source: 'Fintraffic / digitraffic.fi (CC BY 4.0)',
      props: { presets: presets.length, publisher: 'Fintraffic', catalogRecordUpdated: toIso(p.dataUpdatedTime), country: 'Finland', locality: null, streamUrl: null, mediaType: 'still', updateFrequencyMin: 10 },
      imageUrl: `https://weathercam.digitraffic.fi/${presetId}.jpg`,
    });
  }
  return { records, skipped, sourceUpdatedAt: toIso(b.dataUpdatedTime) };
}

/** NYC DOT traffic cameras (webcams.nyctmc.org public API): still images refreshed every few seconds by the publisher. */
export function normalizeNycCams(body: unknown): Normalized {
  if (!Array.isArray(body)) throw new Error('Unexpected NYC DOT camera response');
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of body) {
    const c = raw as Record<string, unknown>;
    const id = cleanText(c.id, 40);
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    const url = typeof c.imageUrl === 'string' ? c.imageUrl : '';
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !isValidLat(lat) || !isValidLon(lon) || (lat === 0 && lon === 0) || !url.startsWith('https://webcams.nyctmc.org/api/cameras/') || String(c.isOnline) !== 'true') {
      skipped++;
      continue;
    }
    records.push({
      id: `nycdot-${id}`,
      lat,
      lon,
      altM: null,
      heading: null,
      speedKts: null,
      label: cleanText(c.name, 120) ?? 'NYC DOT camera',
      category: 'Traffic camera',
      observedAt: null,
      sourceUrl: 'https://webcams.nyctmc.org/',
      source: 'NYC DOT traffic cameras',
      props: { publisher: 'New York City DOT', country: 'United States', locality: cleanText(c.area, 40), streamUrl: null, mediaType: 'still', updateFrequencyMin: 1 },
      imageUrl: url,
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

/** MBTA V3 vehicles with included routes. */
export function normalizeMbta(body: unknown): Normalized {
  const b = body as { data?: unknown; included?: unknown };
  if (!Array.isArray(b?.data)) throw new Error('Unexpected MBTA response');
  const routes = new Map<string, { type: number | null; name: string | null }>();
  for (const r of Array.isArray(b.included) ? b.included : []) {
    const rr = r as { id?: unknown; type?: unknown; attributes?: Record<string, unknown> };
    if (rr?.type === 'route' && typeof rr.id === 'string') routes.set(rr.id, { type: num(rr.attributes?.type), name: cleanText(rr.attributes?.short_name, 20) || cleanText(rr.attributes?.long_name, 60) });
  }
  const MODE = ['Light rail', 'Subway', 'Commuter rail', 'Bus', 'Ferry'];
  const records: GeoRecord[] = [];
  let skipped = 0;
  for (const raw of b.data) {
    const v = raw as { id?: unknown; attributes?: Record<string, unknown>; relationships?: { route?: { data?: { id?: unknown } } } };
    const a = v?.attributes ?? {};
    const id = cleanText(v?.id, 40);
    if (!id || !isValidLat(a.latitude) || !isValidLon(a.longitude)) {
      skipped++;
      continue;
    }
    const routeId = cleanText(v.relationships?.route?.data?.id, 40);
    const route = routeId ? routes.get(routeId) : undefined;
    const mode = route?.type !== null && route?.type !== undefined ? (MODE[route.type] ?? 'Transit') : 'Transit';
    records.push({
      id,
      lat: a.latitude as number,
      lon: a.longitude as number,
      altM: null,
      heading: num(a.bearing),
      speedKts: num(a.speed) !== null ? (num(a.speed) as number) * 1.943844 : null,
      label: `${route?.name ?? routeId ?? 'Vehicle'} · ${cleanText(a.label, 20) ?? id}`,
      category: mode,
      observedAt: toIso(a.updated_at),
      sourceUrl: routeId ? `https://www.mbta.com/schedules/${encodeURIComponent(routeId)}` : 'https://www.mbta.com/',
      source: 'MBTA',
      props: { route: routeId, status: cleanText(a.current_status, 30), direction: num(a.direction_id) },
    });
  }
  return { records, skipped, sourceUpdatedAt: null };
}

export type { LineString };
