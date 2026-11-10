// Aircraft and vessel identification: exact make/model and a real, credited
// photograph of the same airframe or ship. Only used when the user turns on
// "Aircraft and ship photos" (the identifier is sent to these services).
//
// Sources (checked 2026-11-09, all keyless):
// - adsbdb.com: per-airframe record by ICAO address (manufacturer, exact type
//   variant, registration, registered owner). Open-source service.
// - Wikimedia Commons: files whose title contains the registration (aircraft)
//   or whose page names the IMO number (ships). Each file carries its own
//   license and author, which are shown.
// - airport-data.com: aircraft photo by ICAO address, with photographer credit
//   and a link to the photo page. Used only when Commons has none.
// No photo is ever chosen by type alone: no match means no photo.

export interface AircraftModel {
  manufacturer: string | null;
  /** Exact type/variant as registered, e.g. "A321 231SL". */
  model: string | null;
  icaoType: string | null;
  registration: string | null;
  owner: string | null;
  ownerCountry: string | null;
  source: string;
}

export interface VehiclePhoto {
  url: string;
  /** Page to open for the full photo, author and license. */
  link: string;
  author: string;
  license: string | null;
  title: string | null;
  /** Year the photo was taken, when the file says (liveries change over time). */
  year: number | null;
  source: 'Wikimedia Commons' | 'airport-data.com';
  /** How the photo was matched to this vehicle. */
  matchedBy: string;
}

export interface VehicleInfo {
  model: AircraftModel | null;
  photo: VehiclePhoto | null;
  /** Per-source notes (failures, nothing found), for an honest panel message. */
  notes: string[];
}

const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const stripHtml = (v: unknown, max = 120) => str(typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'") : null, max);

export function parseAdsbdb(body: unknown): AircraftModel | null {
  const a = (body as { response?: { aircraft?: Record<string, unknown> } })?.response?.aircraft;
  if (!a || typeof a !== 'object') return null;
  return {
    manufacturer: str(a.manufacturer, 60),
    model: str(a.type, 60),
    icaoType: str(a.icao_type, 8),
    registration: str(a.registration, 12),
    owner: str(a.registered_owner, 80),
    ownerCountry: str(a.registered_owner_country_name, 60),
    source: 'adsbdb.com',
  };
}

const COMMONS_HOSTS = ['https://upload.wikimedia.org/', 'https://thumb.wikimedia.org/'];

/**
 * Commons search result (generator=search, prop=imageinfo). Takes the
 * best-ranked JPEG photo. `mustContain` (lower case) must appear in the file
 * title when given (aircraft registration).
 */
export function parseCommons(body: unknown, matchedBy: string, mustContain?: string): VehiclePhoto | null {
  const pages = (body as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const list = Object.values(pages) as { index?: number; title?: string; imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; mime?: string; extmetadata?: Record<string, { value?: unknown }> }[] }[];
  list.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  for (const p of list) {
    const i = p.imageinfo?.[0];
    const url = i?.thumburl ?? i?.url;
    if (!i || !url || i.mime !== 'image/jpeg' || !COMMONS_HOSTS.some((h) => url.startsWith(h))) continue;
    const title = str(p.title, 200);
    if (mustContain && !title?.toLowerCase().replace(/[\s_]/g, '').includes(mustContain.toLowerCase().replace(/[\s_]/g, ''))) continue;
    const link = typeof i.descriptionurl === 'string' && i.descriptionurl.startsWith('https://commons.wikimedia.org/') ? i.descriptionurl : 'https://commons.wikimedia.org/';
    return {
      url,
      link,
      author: stripHtml(i.extmetadata?.Artist?.value, 80) ?? 'Unknown author',
      license: stripHtml(i.extmetadata?.LicenseShortName?.value, 40),
      title: title?.replace(/^File:/, '').replace(/\.[a-z]+$/i, '') ?? null,
      year: photoYear(i.extmetadata?.DateTimeOriginal?.value),
      source: 'Wikimedia Commons',
      matchedBy,
    };
  }
  return null;
}

/** First plausible 4-digit year in a Commons date field (may contain HTML). */
export function photoYear(v: unknown): number | null {
  const m = typeof v === 'string' ? /\b(19\d{2}|20\d{2})\b/.exec(v.replace(/<[^>]*>/g, ' ')) : null;
  return m ? Number(m[1]) : null;
}

export function commonsSearchUrl(search: string): string {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: search,
    gsrnamespace: '6',
    gsrlimit: '6',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '640',
    iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal',
  });
  return `https://commons.wikimedia.org/w/api.php?${q}`;
}

/** airport-data.com ac_thumb.json → full-size photo URL with photographer credit. */
export function parseAirportData(body: unknown): VehiclePhoto | null {
  const d = (body as { data?: { image?: unknown; link?: unknown; photographer?: unknown }[] })?.data?.[0];
  const thumb = str(d?.image, 300);
  const link = str(d?.link, 300);
  if (!thumb || !link || !thumb.startsWith('https://airport-data.com/images/aircraft/thumbnails/') || !link.startsWith('https://airport-data.com/aircraft/photo/')) return null;
  const id = /\/(\d{6,12})\.jpg$/.exec(thumb)?.[1];
  return {
    url: id ? `https://image.airport-data.com/aircraft/${id}.jpg` : thumb,
    link,
    author: str(d?.photographer, 80) ?? 'Unknown photographer',
    license: null,
    title: null,
    year: null,
    source: 'airport-data.com',
    matchedBy: 'ICAO address',
  };
}

/** One readable model line, e.g. "Airbus A321-231SL (ICAO A321)". */
export function modelLine(m: AircraftModel | null, fallbackType: string | null): string | null {
  if (m?.model || m?.manufacturer) {
    const mf = m.manufacturer ?? '';
    const model = (m.model ?? '').replace(/^(\S+)\s(\d)/, '$1-$2');
    const full = model.toLowerCase().startsWith(mf.toLowerCase()) ? model : `${mf} ${model}`.trim();
    return m.icaoType ? `${full} (ICAO ${m.icaoType})` : full;
  }
  return fallbackType ? `ICAO type ${fallbackType}` : null;
}
