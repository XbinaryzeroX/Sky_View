// HTML escaping and external-link validation.

import { keyedCameraLinkHosts } from './keyedCameras';
import { isAirlinerReferenceUrl } from './airlinerProfile';
import { airlineStatusPages } from './airlineStatusPages';
import { CFR_TRACKER_URL } from './conflictReports';

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
  'twelvedata.com', 'alphavantage.co', 'gdeltproject.org', 'tradingview.com', 'join-lemmy.org',
  'weather.gov', 'noaa.gov', 'usgs.gov', 'naturalearthdata.com', 'census.gov', 'cesium.com', 'ollama.com',
  'adsb.lol', 'digitraffic.fi', 'celestrak.org', 'nasa.gov', 'arcgis.com', 'aviationweather.gov', 'ca.gov', 'mbta.com',
  'aisstream.io', 'opendata.aws', 'github.com', 'google.com', 'opendatacommons.org', 'creativecommons.org', 'sketchfab.com',
  'tfl.gov.uk', 'data.gov.hk', 'drivebc.ca', 'quebec511.info', 'donneesquebec.ca',
  ...keyedCameraLinkHosts(),
];

// Main-process feed services register exact observed links; this module's renderer
// instance never receives these grants. Bounded to avoid an unbounded URL registry.
const observedLinks = new Set<string>();
const flightStatusLinks = new Set(Object.values(airlineStatusPages).map(([, url]) => url));
flightStatusLinks.add('https://aerodatabox.com/api-spec');
flightStatusLinks.add('https://aerodatabox.com/pricing');
export function observedFeedUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || raw.length > 2048 || !u.hostname.includes('.') || u.hostname.endsWith('.localhost') || u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}
export function registerFeedLinks(links: string[]): void {
  for (const raw of links) {
    const u = observedFeedUrl(raw);
    if (!u) continue;
    if (observedLinks.size >= 2000) observedLinks.delete(observedLinks.values().next().value!);
    observedLinks.add(u.href);
  }
}
/** Only https links to an allow-listed host (or subdomain) are permitted. */
export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (observedLinks.has(url.href) && !url.username && !url.password) return true;
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.href === CFR_TRACKER_URL) return true;
  if (isAirlinerReferenceUrl(url.href) || flightStatusLinks.has(url.href)) return true;
  if (url.origin === 'https://commons.wikimedia.org') return !url.search && /^\/wiki\/File:[^/]+$/i.test(url.pathname);
  if (url.origin === 'https://airport-data.com') return !url.search && /^\/aircraft\/photo\/\d{1,12}(?:\.html)?\/?$/.test(url.pathname);
  const host = url.hostname.toLowerCase();
  if (host === 'dwd.de' || host === 'www.dwd.de' || host === 'opendata.dwd.de') return !url.port;
  return EXTERNAL_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Browser keys necessarily reach tile providers, but must not appear in diagnostics. */
export function redactCredentialText(text: string, values: (string | null | undefined)[] = []): string {
  let output = text;
  for (const value of values) {
    if (value) {
      output = output.split(value).join('[redacted]');
      output = output.split(encodeURIComponent(value)).join('[redacted]');
    }
  }
  return output.replace(/([?&](?:key|apikey|api_key|token)=)[^&\s"']+/gi, '$1[redacted]');
}
