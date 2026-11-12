import { describe, expect, it, vi } from 'vitest';
import { createConflictReportsLookup, parseConflictReports, parseHumanitarianNews } from '../src/main/conflictReports';
import { assertAllowedUrl, FeedHttpError, type FetchText } from '../src/main/feeds/http';
import { CFR_TRACKER_URL, RELIEFWEB_SITUATIONS_URL, UN_NEWS_AID_URL } from '../src/shared/conflictReports';
import { IPC, validateIpcArgs } from '../src/shared/ipc';
import { isAllowedExternalUrl } from '../src/shared/sanitize';

const t = Date.parse('2026-11-12T00:00:00Z');
const rss = (items: string, channel = 'ReliefWeb - Updates') => '<rss><channel><title>' + channel + '</title>' + items + '</channel></rss>';
const posted = 'Wed, 11 Nov 2026 12:00:00 +0000';
const url = 'https://reliefweb.int/report/yemen/civilian-health-update';
const author = 'World Health Organization';
const sample = (options: Partial<{ title: string; url: string; author: string; body: string; date: string; country: string; category: string }> = {}) => {
  const v = { title: 'Yemen conflict escalation update', url, author, body: 'Ongoing conflict has disrupted humanitarian access. More than 25,000 people remain internally displaced in Yemen.',
    date: posted, country: 'Yemen', category: 'Situation Report', ...options };
  return '<item><title>' + v.title + '</title><link>' + v.url + '</link><author>' + v.author + '</author><description><![CDATA[' + v.body +
    ']]></description><pubDate>' + v.date + '</pubDate><category>' + v.category + '</category><category>Chad</category><category>' + v.country + '</category></item>';
};
const storyUrl = 'https://news.un.org/en/story/2026/11/1234567';
const newsItem = (title = 'Yemen war forces more families from home amid hunger', body = 'More than 25,000 people have now fled renewed fighting in Yemen, according to the UN.') =>
  '<item><title>' + title + '</title><guid>' + storyUrl + '</guid><pubDate>' + posted + '</pubDate><description>' + body + '</description></item>';
const newsFeed = (s = newsItem()) => rss(s, 'UN News - Global perspective Human stories');

describe('current humanitarian publication metadata', () => {
  it('matches the primary country, source and posted time, deduplicates, and distinguishes country outcomes from local targets', () => {
    const [report] = parseConflictReports(rss(sample() + sample()), t);
    expect(report).toMatchObject({ country: 'Yemen', source: author, publishedAt: '2026-11-11T12:00:00.000Z',
      id: url, url, summary: 'More than 25,000 people remain internally displaced in Yemen.' });
    const [local] = parseConflictReports(rss(sample({ body: 'Ongoing conflict has disrupted humanitarian access. More than 25,000 people remain internally displaced in Chad. Aid agencies aim to support 600,000 people in Yemen.' })), t);
    expect(local.summary).toContain('disruptions to humanitarian access');
    expect(local.summary).not.toMatch(/25,000|600,000|Chad/);
    expect(parseConflictReports(rss(sample() + sample()), t)).toHaveLength(1);
  });

  it('rejects secondary-country guesses, tactical monitors, unrelated disasters, generic crises, old or future posts, and untrusted links', () => {
    for (const change of [
      { url: 'https://reliefweb.int/report/cameroon/story' }, { url: 'https://reliefweb.int.evil.example/report/yemen/story' },
      { author: 'Armed Conflict Location &amp; Event Data' }, { title: 'Military deployments in Yemen' },
      { title: 'Yemen cholera outbreak' }, { title: 'School holiday planning', body: 'schools are closed for the holidays.' },
      { date: 'Sat, 10 Oct 2026 09:00:00 +0000' }, { date: 'Fri, 13 Nov 2026 12:00:00 +0000' }, { category: 'Map' },
    ]) expect(parseConflictReports(rss(sample(change)), t)).toEqual([]);
    expect(parseConflictReports(rss(''), t)).toEqual([]);
    for (const document of ['<!DOCTYPE rss><rss/>', '<html>busy</html>', rss('', 'Unexpected publication'), rss(sample()).slice(0, -6)]) {
      expect(() => parseConflictReports(document, t)).toThrow();
    }
  });

  it('uses original UN News story links, unique headline country, date and civilian outcomes', () => {
    const [report] = parseHumanitarianNews(newsFeed(), t);
    expect(report).toMatchObject({ country: 'Yemen', url: storyUrl, source: 'UN News', summary: 'More than 25,000 people have now fled renewed fighting in Yemen.' });
    const south = parseHumanitarianNews(newsFeed(newsItem('South Sudan conflict drives displacement', 'Armed conflict drove further displacement.')), t);
    expect(south[0].country).toBe('South Sudan');
    for (const bad of [
      newsItem('Kenya and Ethiopia humanitarian situation'), newsItem('Sudan budget', 'More schools are receiving funds.'),
      newsItem('Aid reaches Yemen', 'The war on hunger prompted new shelter projects.'),
      newsItem('Military operations in Yemen'), newsItem().replace(storyUrl, 'https://news.un.org/en/other'),
    ]) expect(parseHumanitarianNews(newsFeed(bad), t)).toEqual([]);
  });
});

describe('bounded refresh and release of original report links', () => {
  function store() {
    const meta = new Map<string, string>();
    return { getMeta: (k: string) => meta.get(k) ?? null, setMeta: (k: string, v: string) => { meta.set(k, v); } };
  }
  it('shares reads, persists publisher cooldown over restart, and shows the independently checked source or the retained list on failure', async () => {
    let clock = t;
    const db = store();
    const fetch = vi.fn<FetchText>().mockResolvedValueOnce({ status: 200, text: rss(sample()) })
      .mockRejectedValueOnce(new FeedHttpError('HTTP 429', 429, 3600, 'http'))
      .mockResolvedValueOnce({ status: 200, text: newsFeed() }).mockRejectedValue(new Error('network unavailable'));
    const first = createConflictReportsLookup(fetch, db, () => clock);
    const [a, b] = await Promise.all([first(), first()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.source).toContain('ReliefWeb');
    expect(isAllowedExternalUrl(a.reports[0].url)).toBe(true);
    clock += 31 * 60000;
    const alternate = await first();
    expect(alternate.error).toBeNull();
    expect(alternate.coverage).toContain('ReliefWeb is unavailable');
    expect(alternate.reports[0].source).toBe('UN News');
    expect(isAllowedExternalUrl(alternate.reports[0].url)).toBe(true);
    expect(fetch.mock.calls.map(c => c[0])).toEqual([RELIEFWEB_SITUATIONS_URL, RELIEFWEB_SITUATIONS_URL, UN_NEWS_AID_URL]);
    const resumed = createConflictReportsLookup(fetch, db, () => clock);
    expect(await resumed()).toEqual(alternate);
    clock += 31 * 60000;
    const unavailable = await resumed();
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(UN_NEWS_AID_URL);
    expect(unavailable.error).toMatch(/429.*network unavailable/);
    expect(unavailable.checkedAt).toBe(alternate.checkedAt);
    expect(unavailable.reports).toEqual(alternate.reports);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('keeps a first-ever double failure unknown and distinguishes a successful empty feed', async () => {
    const fetch = vi.fn<FetchText>().mockRejectedValueOnce(new Error('unavailable')).mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ status: 200, text: rss('') });
    let clock = t;
    const read = createConflictReportsLookup(fetch, store(), () => clock);
    expect(await read()).toMatchObject({ error: expect.stringContaining('unavailable'), checkedAt: null, reports: [] });
    clock += 310000;
    expect(await read()).toMatchObject({ checkedAt: new Date(clock).toISOString(), error: null, reports: [] });
  });
  it('accepts only no-argument IPC and the fixed HTTPS publisher endpoints', () => {
    for (const channel of [IPC.conflictReports, IPC.conflictAssessments]) {
      expect(() => validateIpcArgs(channel, [])).not.toThrow();
      expect(() => validateIpcArgs(channel, ['https://invalid.example'])).toThrow();
    }
    for (const endpoint of [CFR_TRACKER_URL, RELIEFWEB_SITUATIONS_URL, UN_NEWS_AID_URL]) {
      expect(assertAllowedUrl(endpoint).href).toBe(endpoint);
      expect(() => assertAllowedUrl(endpoint + '?more=1')).toThrow(/blocked/i);
    }
    expect(isAllowedExternalUrl(CFR_TRACKER_URL)).toBe(true);
    expect(isAllowedExternalUrl('https://www.cfr.org/global-conflict-tracker/something-else')).toBe(false);
  });
});
