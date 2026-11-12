export const RELIEFWEB_SITUATIONS_URL = 'https://reliefweb.int/updates/rss.xml?advanced-search=%28F10%29_%28L267%29&search=conflict%20OR%20hostilities%20OR%20war';
export const CFR_TRACKER_URL = 'https://www.cfr.org/global-conflict-tracker/dashboard';
export const UN_NEWS_AID_URL = 'https://news.un.org/feed/subscribe/en/news/topic/humanitarian-aid/feed/rss.xml';

export interface ConflictReport {
  id: string;
  country: string;
  title: string;
  summary: string;
  publishedAt: string;
  url: string;
  source: string;
}

export interface ConflictSnapshot {
  checkedAt: string | null;
  nextCheckAt: string;
  error: string | null;
  reports: ConflictReport[];
  source: string;
  coverage: string;
}

export function isReliefWebReportLink(raw: string): boolean {
  return raw.length <= 2048 && /^https:\/\/reliefweb\.int\/report\/[a-z0-9-]+\/[a-z0-9-]+$/.test(raw);
}

export function isUNNewsStoryLink(raw: string): boolean {
  return /^https:\/\/news\.un\.org\/en\/story\/\d{4}\/(?:0[1-9]|1[0-2])\/\d{4,12}$/.test(raw);
}
