// HTML escaping and external-link validation.

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Hosts whose links the app will open in the user's default browser. */
export const EXTERNAL_LINK_HOSTS = [
  'weather.gov', 'noaa.gov', 'usgs.gov', 'naturalearthdata.com', 'census.gov', 'cesium.com', 'ollama.com',
  'adsb.lol', 'digitraffic.fi', 'celestrak.org', 'nasa.gov', 'arcgis.com', 'aviationweather.gov', 'ca.gov', 'mbta.com',
  'aisstream.io', 'opendata.aws', 'github.com', 'google.com', 'opendatacommons.org', 'creativecommons.org',
];

/** Only https links to an allow-listed host (or subdomain) are permitted. */
export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return EXTERNAL_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
