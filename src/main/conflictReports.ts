import { MAX_RSS, readItems, type RssItem } from './feeds/rss';
import { z } from 'zod';
import { isReliefWebReportLink, isUNNewsStoryLink, RELIEFWEB_SITUATIONS_URL, UN_NEWS_AID_URL, type ConflictReport, type ConflictSnapshot } from '../shared/conflictReports';
import { registerFeedLinks } from '../shared/sanitize';
import type { FetchText } from './feeds/http';
import { createBulletinReader } from './publishedBulletins';
import type { AtlasStore } from './store';

const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const source = 'ReliefWeb · UN OCHA';
const coverage = 'Selected humanitarian agencies in ReliefWeb’s 20 latest matching English situation reports, posted in the 30 days before the source check. Countries are the publisher’s filing areas. Report titles may cover an earlier period.';
const reportSchema = z.object({
  id: z.string().max(2048), country: z.string().min(1).max(120), title: z.string().min(1).max(350),
  summary: z.string().min(1).max(450), publishedAt: z.iso.datetime(),
  url: z.string().refine(url => isReliefWebReportLink(url) || isUNNewsStoryLink(url)), source: z.string().min(1).max(300),
}).refine(r => r.id === r.url);
const listSchema = z.array(reportSchema).max(40);
// Limit this view to reports from civilian humanitarian organizations. Event monitors and conflict maps
// can share the same ReliefWeb format and tags, but serve a different purpose.
const agencies = new Set([
  'UN Office for the Coordination of Humanitarian Affairs', 'UN High Commissioner for Refugees', "UN Children's Fund",
  'United Nations Population Fund', 'World Health Organization', 'World Food Programme', 'International Organization for Migration',
  'International Federation of Red Cross and Red Crescent Societies', 'International Committee of the Red Cross',
  'Food and Agriculture Organization of the United Nations', 'Health Cluster', 'Education Cluster', 'Protection Cluster',
  'United Nations Relief and Works Agency for Palestine Refugees in the Near East',
]);
const conflict = /\b(?:armed conflict|ongoing conflict|intensif(?:ied|ying) conflict|conflict[- ](?:related|affected|induced|escalation)|conflict in|civil war|war in|war[- ]affected|ongoing war|hostilities|fighting|armed clashes|intercommunal clashes|communal clashes|ceasefire)\b/i;
const disasterTitle = /\b(?:cholera|dengue|diphtheria|polio|measles|floods?|cyclone|typhoon|earthquake|drought|wildfire|outbreak|weather forecast)\b/i;
const operationalTitle = /\b(?:battle(?:field)?|front[- ]line|troop|weapon|military|strike|drone|force deployment|security incident monitor)\w*\b/i;
const subjects: [RegExp, string][] = [
  [/\b(?:displac\w*|refugees?|fled|uprooted|forced to flee)\b/i, 'displacement'],
  [/\b(?:hunger|food insecur\w*|malnutrition|famine|food shortag\w*|nutrition services?)\b/i, 'food and nutrition needs'],
  [/\b(?:health[- ]care|health (?:services|facilities|response)|medical care|hospital\w*|injuries|injured)\b/i, 'health care'],
  [/\b(?:shelter\w*|housing|homeless\w*)\b/i, 'shelter'],
  [/\b(?:water supplies|safe water|drinking water|sanitation)\b/i, 'water and sanitation'],
  [/\b(?:schools?|education|students?)\b/i, 'education'],
  [/\b(?:humanitarian access|aid (?:access|delivery|deliveries|distribution)|relief distributions?)\b/i, 'access to aid'],
  [/\b(?:civilian protection|protection risks|child protection|family reunification)\b/i, 'civilian protection'],
];
const normCountry = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\b(?:the|of|and)\b/g, '').replace(/[^a-z0-9]/g, '');

function humanitarianSummary(title: string, body: string, country: string): string | null {
  const topics = subjects.filter(([pattern]) => pattern.test(title + ' ' + body)).map(([, label]) => label);
  if (!topics.length) return null;
  // A count must describe an outcome and explicitly name the same country. Preserve the publisher's qualifier.
  // This excludes planning targets, subnational figures and numbers from sections about a neighboring country.
  const displaced = /(?:^|[.!?]\s+)((?:(?:More than|About|Nearly|At least|Over|Around|An estimated) )?[\d,.]+(?: (?:million|thousand))? (?:people|children|families) (?:have (?:now )?fled (?:renewed |ongoing )?(?:fighting|hostilities)|(?:are|remain|were) (?:internally )?displaced) (?:in|across) ([\p{L} -]+?))(?=[,.;])/gu;
  for (const match of body.matchAll(displaced)) {
    if (normCountry(match[2]) === normCountry(country)) return match[1] + '.';
  }
  // Describe only explicit developments in the bulletin, without forwarding granular incident locations.
  const impacts: [RegExp, string][] = [
    [/\b(?:disrupted|restricted|blocked|hampered) (?:humanitarian (?:access|operations)|(?:the )?delivery of (?:aid|assistance)|access to (?:aid|services))\b/i, 'disruptions to humanitarian access'],
    [/\b(?:funding (?:shortages?|shortfalls?|cuts|gaps)|shortfalls? in funding)\b/i, 'funding shortfalls'],
    [/\b(?:further|renewed|new|additional) displacement\b/i, 'further displacement'],
    [/\b(?:schools? (?:remain |were |are )?closed|school closures)\b/i, 'school closures'],
    [/\b(?:severely damaged|destroyed) homes\b/i, 'damage to housing'],
  ];
  const list = new Intl.ListFormat('en', { type: 'conjunction' });
  const developments = impacts.filter(([pattern]) => pattern.test(body)).map(([, label]) => label);
  return (developments.length ? 'The report describes ' + list.format(developments.slice(0, 3)) + '. ' : '') +
    'Topics include ' + list.format(topics.slice(0, 5)) + '.';
}

function interpret(item: RssItem, now: number): ConflictReport | null {
  const [url = ''] = item.link ?? [];
  const [title = ''] = item.title ?? [];
  const [posted = ''] = item.pubDate ?? [];
  if (!url || !title || !posted) throw new Error('ReliefWeb returned a report with missing publication metadata.');
  if (!isReliefWebReportLink(url) || title.length > 350 || operationalTitle.test(title)) return null;
  if (!item.category?.includes('Situation Report')) return null;
  const sources = item.author?.filter(a => agencies.has(a));
  if (!sources?.length) return null;
  const date = Date.parse(posted);
  if (!Number.isFinite(date)) throw new Error('ReliefWeb returned an invalid posting date.');
  if (date > now || now - date > MAX_AGE_MS) return null;
  // The URL identifies the primary country: additional RSS country categories may be hosting or donor countries.
  const slug = new URL(url).pathname.split('/')[2];
  const country = item.category.find(c => c.length <= 120 && normCountry(c) === normCountry(slug.replaceAll('-', ' ')));
  if (!country || country === 'World') return null;
  const body = (item.description?.[0] ?? '').replace(/<div\b[^>]*class=["']tag [^"']+["'][^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ').replace(/\s+/gu, ' ').trim().slice(0, 6000);
  if ((!conflict.test(title) && !conflict.test(body.slice(0, 1600))) || (disasterTitle.test(title) && !conflict.test(title))) return null;
  const summary = humanitarianSummary(title, body, country);
  if (!summary) return null;
  return { id: url, country, title, summary, publishedAt: new Date(date).toISOString(), source: sources.join(', ').slice(0, 300), url };
}

export function parseConflictReports(xml: string, now = Date.now()): ConflictReport[] {
  const unique = new Map<string, ConflictReport>();
  for (const item of readItems(xml, /^ReliefWeb\b/)) {
    const report = interpret(item, now);
    if (report) unique.set(report.id, report);
  }
  return [...unique.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 20);
}

// UN News titles aren't tagged by country. Match unambiguous headline names and common publisher spellings.
const locations = new Map<string, string>();
const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  const code = a + b;
  if (['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'].includes(code)) continue;
  const label = regions.of(code);
  if (label) locations.set(label.toLowerCase(), label);
}
for (const [name, label] of Object.entries({ gaza: 'occupied Palestinian territory', 'west bank': 'occupied Palestinian territory',
  palestine: 'occupied Palestinian territory', 'democratic republic of the congo': 'Democratic Republic of the Congo',
  'dr congo': 'Democratic Republic of the Congo', syria: 'Syrian Arab Republic' })) locations.set(name, label);
const escaped = [...locations.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, '\\$&'));
const namesInTitle = new RegExp('\\b(?:' + escaped.join('|') + ')\\b', 'giu');
const newsConflict = /\b(?:war|violent clashes|armed conflict|invasion|hostilities|ceasefire|renewed fighting)\b/i;

export function parseHumanitarianNews(xml: string, now = Date.now()): ConflictReport[] {
  const rows = new Map<string, ConflictReport>();
  for (const item of readItems(xml, /^UN News\b/)) {
    const [url = ''] = item.guid ?? [];
    const [title = ''] = item.title ?? [];
    const [posted = ''] = item.pubDate ?? [];
    if (!url || !title || !posted) throw new Error('UN News returned an incomplete story.');
    const date = Date.parse(posted);
    if (!Number.isFinite(date)) throw new Error('UN News returned an invalid posting date.');
    if (!isUNNewsStoryLink(url) || title.length > 350 || date > now || now - date > MAX_AGE_MS ||
      operationalTitle.test(title) || /world news in brief|security council live/i.test(title)) continue;
    const countries = new Set([...title.matchAll(namesInTitle)].map(m => locations.get(m[0].toLowerCase())!));
    if (countries.size !== 1) continue;
    const country = [...countries][0];
    const body = (item.description?.[0] ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/gu, ' ').trim();
    if (!newsConflict.test(title + ' ' + body) || /war on (?:poverty|drugs|hunger|disease)/i.test(title + ' ' + body)) continue;
    const summary = humanitarianSummary(title, body, country);
    if (!summary) continue;
    rows.set(url, { id: url, url, title, country, publishedAt: new Date(date).toISOString(), source: 'UN News', summary });
  }
  return [...rows.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 40);
}

export function createConflictReportsLookup(fetchText: FetchText, store: Pick<AtlasStore, 'getMeta' | 'setMeta'>, now = Date.now) {
  function reader(key: string, url: string, parse: (xml: string, now: number) => ConflictReport[]) {
    return createBulletinReader({
      store, now, key, refreshMs: 30 * 60_000, validate: value => listSchema.safeParse(value).data ?? null,
      load: async () => {
        const res = await fetchText(url, { maxBytes: MAX_RSS, timeoutMs: 15_000, rejectRedirects: true,
          headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'AtlasWatch/0.7.0 (humanitarian RSS reader)' } });
        if (res.status !== 200) throw new Error('The publisher did not return a complete RSS feed.');
        return parse(res.text, now());
      },
    });
  }
  const readReliefWeb = reader('conflict_reports_rss_v1', RELIEFWEB_SITUATIONS_URL, parseConflictReports);
  const readNews = reader('conflict_news_rss_v1', UN_NEWS_AID_URL, parseHumanitarianNews);
  return async (): Promise<ConflictSnapshot> => {
    const preferred = await readReliefWeb();
    let snapshot: ConflictSnapshot = { checkedAt: preferred.checkedAt, nextCheckAt: preferred.nextCheckAt,
      error: preferred.error, reports: preferred.items, source, coverage };
    if (preferred.error) {
      const news = await readNews();
      if (!news.error || (news.checkedAt ?? '') > (preferred.checkedAt ?? '')) {
        snapshot = { checkedAt: news.checkedAt, nextCheckAt: news.nextCheckAt, error: news.error, reports: news.items,
          source: 'UN News · Humanitarian Aid', coverage: 'ReliefWeb is unavailable. Showing UN News humanitarian stories posted in the 30 days before the source check, identifying one country in the headline and discussing conflict and civilian needs.' };
      }
      if (news.error) snapshot.error = 'ReliefWeb: ' + preferred.error + ' · UN News: ' + news.error;
      snapshot.nextCheckAt = new Date(Math.min(Date.parse(preferred.nextCheckAt), Date.parse(news.nextCheckAt))).toISOString();
    }
    registerFeedLinks(snapshot.reports.map(r => r.url));
    return snapshot;
  };
}
