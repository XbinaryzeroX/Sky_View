// One app-wide market service, shared with Provider Settings connection tests.
import type { Settings } from '../shared/types';
import {
  normalizeCandles, normalizeQuote, normalizeSearch, rangeSpec, newsQuery, parseGdelt, buildMarketPrompt,
  equityNewsUrl, MOST_ACTIVE_URL, normalizeMostActive, type Headline,
  type MarketProvider, type MarketRange, type MarketResult, type TrendingMarkets,
} from '../shared/markets';
import { observedFeedUrl, registerFeedLinks } from '../shared/sanitize';
import { MAX_RSS, readItems } from './feeds/rss';
import { fetchJson, fetchText } from './feeds/http';
import { redactSecrets, type SecretStore } from './secrets';
import { getAiStatus, ollamaEndpoint } from './ollama';
import { CredentialService, type Credential } from './credentials';
import type { AtlasStore } from './store';

function previewText(raw: string, limit: number): string {
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
}

/** Keep the publisher's teaser separate from the headline. RSS content is rendered as plain text. */
export function parseEquityNews(xml: string, symbol: string, name: string | null): Headline[] {
  equityNewsUrl(symbol);
  const channel = new RegExp('^Yahoo!? Finance: ' + symbol.replace(/\./g, '\\.') + ' News$', 'i');
  const rows = new Map<string, Headline>();
  for (const item of readItems(xml, channel)) {
    const title = previewText(item.title?.[0] ?? '', 300);
    const summary = previewText(item.description?.[0] ?? '', 450);
    const url = observedFeedUrl(item.link?.[0] ?? '');
    const time = Date.parse(item.pubDate?.[0] ?? '');
    if (!title || !url || !Number.isFinite(time) || rows.has(url.href)) continue;
    rows.set(url.href, { title, summary: summary && summary !== title ? summary : null,
      url: url.href, domain: url.hostname, seenAt: new Date(time).toISOString() });
  }
  // A ticker feed also contains market-wide roundups. Show explicit mentions ahead of those broader stories.
  const words = (value: string) => ' ' + value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  const company = words((name ?? '').replace(/\b(?:class [a-z]|incorporated|corporation|corp|holdings?|inc|limited|ltd|plc|oyj)\b/gi, ' '));
  const ticker = new RegExp('(?:^|[^A-Za-z0-9])' + symbol.replace(/\./g, '\\.') + '(?:$|[^A-Za-z0-9])');
  const mentions = (text: string) => (company.trim().length > 2 && words(text).includes(company)) || ticker.test(text);
  const relevance = (row: Headline) => mentions(row.title) ? 2 : mentions(row.summary ?? '') ? 1 : 0;
  return [...rows.values()].sort((a, b) => relevance(b) - relevance(a) || b.seenAt.localeCompare(a.seenAt)).slice(0, 12);
}

export class MarketService {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private minutes = new Map<MarketProvider, number[]>();
  private newsTail: Promise<unknown> = Promise.resolve();
  private newsAt = 0;
  private newsQueued = 0;
  private alphaTail: Promise<unknown> = Promise.resolve();
  private alphaAt = 0;
  private credentials: CredentialService;

  constructor(
    secrets: SecretStore,
    private settings: () => Settings,
    private store: Pick<AtlasStore, 'getMeta' | 'setMeta'>,
    credentials?: CredentialService,
    /** Alpha Vantage free keys also allow at most one request per second (measured 2026-11-10). */
    private readonly alphaSpacingMs = 1200,
  ) {
    this.credentials = credentials ?? new CredentialService(secrets, store);
  }

  private used(provider: MarketProvider): number {
    return Number(this.store.getMeta(`markets:${provider}:${new Date().toISOString().slice(0, 10)}`)) || 0;
  }

  private reserve(provider: MarketProvider, credential: Credential): void {
    const now = Date.now();
    const minute = (this.minutes.get(provider) ?? []).filter(time => now - time < 60000);
    const daily = this.used(provider);
    const cap = provider === 'twelvedata' ? 800 : 25;
    if (minute.length >= (provider === 'twelvedata' ? 8 : 5) || (credential.source === 'user' && daily >= cap)) {
      throw new Error(`${provider} free-tier limit reached (${daily}/${cap} user-key requests today). Try again later.`);
    }
    // Count attempted network calls, including failed provider tests. Cached results are free.
    if (credential.source === 'builtin') {
      this.credentials.reserveBuiltin(provider);
    } else {
      this.store.setMeta(`markets:${provider}:${new Date().toISOString().slice(0, 10)}`, String(daily + 1));
    }
    minute.push(now);
    this.minutes.set(provider, minute);
  }

  /** Serializes Alpha Vantage requests so a quote and its chart never hit the per-second burst limit. */
  private spaced<T>(provider: MarketProvider, run: () => Promise<T>): Promise<T> {
    if (provider !== 'alphavantage') return run();
    const next = this.alphaTail.catch(() => {}).then(async () => {
      const wait = this.alphaAt + this.alphaSpacingMs - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      try {
        return await run();
      } finally {
        this.alphaAt = Date.now();
      }
    });
    this.alphaTail = next;
    return next;
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const promise = load().then(value => {
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + ttl, value });
      return value;
    });
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  private async request<T>(
    provider: MarketProvider,
    kind: 'search' | 'quote' | 'candles',
    input: string,
    range: MarketRange | undefined,
    normalize: (raw: unknown, provider: MarketProvider) => T,
  ): Promise<MarketResult<T>> {
    const credential = this.credentials.credentialFor(provider);
    if (!credential) throw new Error('NO_KEY: Markets needs a data provider key. Open Providers to configure one.');
    const key = credential.value;
    const spec = range ? rangeSpec(provider, range) : null;
    const ttl = kind === 'search' ? 86400000 : kind === 'quote' ? 60000 : spec?.intraday ? 300000 : 3600000;
    const cacheKey = `${provider}:${credential.source}:${kind}:${input}:${range ?? ''}:${key}`;
    const result = await this.cached(cacheKey, ttl, async () => {
      const endpoint = kind === 'search' ? 'symbol_search' : kind === 'quote' ? 'quote' : 'time_series';
      const url = new URL(provider === 'twelvedata'
        ? `https://api.twelvedata.com/${endpoint}`
        : 'https://www.alphavantage.co/query');
      url.searchParams.set('apikey', key);
      if (provider === 'twelvedata') {
        url.searchParams.set('symbol', input);
        url.searchParams.set('timezone', 'UTC');
        if (spec) {
          url.searchParams.set('interval', spec.interval);
          url.searchParams.set('outputsize', String(spec.outputsize));
        }
        if (kind === 'search') url.searchParams.set('outputsize', '12');
      } else {
        const fn = kind === 'search' ? 'SYMBOL_SEARCH'
          : kind === 'quote' ? 'GLOBAL_QUOTE'
          : spec?.intraday ? 'TIME_SERIES_INTRADAY'
          : spec?.interval === '1week' ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_DAILY';
        url.searchParams.set('function', fn);
        url.searchParams.set(kind === 'search' ? 'keywords' : 'symbol', input);
        if (spec?.intraday) url.searchParams.set('interval', spec.interval);
        // DAILY full is premium. Weekly history has no outputsize parameter.
        if (fn === 'TIME_SERIES_DAILY' || fn === 'TIME_SERIES_INTRADAY') url.searchParams.set('outputsize', 'compact');
      }
      try {
        // Reserve quota at dispatch (after any Alpha Vantage spacing wait), not at enqueue, so the rolling-minute
        // window and the UTC-day counters reflect when requests actually leave the app.
        const response = await this.spaced(provider, () => {
          this.reserve(provider, credential);
          return fetchJson(url.href, { maxBytes: 8 * 1024 * 1024, providerErrors: true });
        });
        let data = normalize(response.body, provider);
        if (spec && Array.isArray(data) && data.length) {
          const latest = Math.max(...data.map(candle => (candle as { time: number }).time));
          const since = latest - spec.days * 86400;
          data = data.filter(candle => (candle as { time: number }).time >= since) as T;
        }
        return { data, provider, fetchedAt: new Date().toISOString() };
      } catch (error) {
        // User-key failure is final: do not retry with the included key.
        throw new Error(redactSecrets((error as Error).message, [key, encodeURIComponent(key)]));
      }
    });
    const dailyUsed = this.used(provider);
    const warning = credential.source === 'user' && provider === 'alphavantage' && dailyUsed >= 20
      ? `Alpha Vantage: ${dailyUsed} of 25 daily requests used.` : null;
    return { ...result, dailyUsed, warning };
  }

  search(query: string) {
    return this.request(this.settings().marketProvider, 'search', query, undefined, normalizeSearch);
  }

  quote(symbol: string) {
    return this.request(this.settings().marketProvider, 'quote', symbol, undefined, normalizeQuote);
  }

  candles(symbol: string, range: MarketRange) {
    return this.request(this.settings().marketProvider, 'candles', symbol, range, normalizeCandles);
  }

  test(provider: MarketProvider) {
    return this.request(provider, 'quote', provider === 'twelvedata' ? 'AAPL' : 'IBM', undefined, normalizeQuote);
  }

  trending(): Promise<TrendingMarkets> {
    return this.cached('trending:us:volume', 5 * 60_000, async () => {
      const response = await fetchJson(MOST_ACTIVE_URL, { maxBytes: 1024 * 1024, timeoutMs: 10_000, rejectRedirects: true,
        headers: { Accept: 'application/json', 'User-Agent': 'SkyView/0.7.0' } });
      if (response.status !== 200) throw new Error('Yahoo Finance did not return a complete ranking.');
      return { items: normalizeMostActive(response.body), source: 'Yahoo Finance', fetchedAt: new Date().toISOString() };
    });
  }

  async news(symbol: string, name: string | null, selection?: 'trending') {
    if (selection === 'trending') {
      const url = equityNewsUrl(symbol);
      const result = await this.cached('news:yahoo:' + symbol, 15 * 60_000, async () => {
        const response = await fetchText(url, { maxBytes: MAX_RSS, timeoutMs: 10_000, rejectRedirects: true,
          headers: { Accept: 'application/rss+xml, application/xml', 'User-Agent': 'SkyView/0.7.0' } });
        if (response.status !== 200) throw new Error('Yahoo Finance did not return a complete news feed.');
        return { articles: parseEquityNews(response.text, symbol, name), source: 'Yahoo Finance', fetchedAt: new Date().toISOString() };
      });
      registerFeedLinks(result.articles.map(article => article.url));
      return result;
    }
    const query = newsQuery(symbol, name);
    return this.cached(`news:${query}`, 900000, async () => {
      if (this.newsQueued >= 10) throw new Error('GDELT request queue is full; try again shortly.');
      this.newsQueued++;
      const run = this.newsTail.catch(() => {}).then(async () => {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, this.newsAt + 6000 - Date.now())));
        this.newsAt = Date.now();
        const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
        const params = { query, mode: 'artlist', maxrecords: '25', format: 'json', timespan: '3d', sort: 'datedesc' };
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        const load = async () => parseGdelt((await fetchText(url.href, { maxBytes: 2 * 1024 * 1024 })).text);
        const limited = (error: unknown) => /rate limit|429|please limit/i.test((error as Error).message ?? '');
        let articles;
        try {
          articles = await load();
        } catch (error) {
          if (!limited(error)) throw error;
          // GDELT asks for one request every 5 s and sometimes refuses the first one; wait and retry once.
          await new Promise(resolve => setTimeout(resolve, 10000));
          this.newsAt = Date.now();
          try {
            articles = await load();
          } catch (retryError) {
            if (!limited(retryError)) throw retryError;
            throw new Error('The GDELT news index is limiting requests right now. Headlines will load if you reopen this asset in a minute.');
          }
        }
        registerFeedLinks(articles.map(article => article.url));
        return { articles, source: 'GDELT Project', fetchedAt: new Date().toISOString() };
      }).finally(() => { this.newsQueued--; });
      this.newsTail = run;
      return run;
    });
  }

  async explain(symbol: string, headlines: string[], movement: string) {
    const settings = this.settings();
    if (!settings.aiEnabled) throw new Error('Local AI is disabled.');
    const status = await getAiStatus(fetchJson, true, settings.ollamaPort);
    if (!status.reachable || !status.models.includes(settings.ollamaModel)) {
      throw new Error(status.error ?? 'Choose an installed local model in Settings.');
    }
    const prompt = buildMarketPrompt(symbol, headlines, movement);
    const response = await fetchJson(`${ollamaEndpoint(settings.ollamaPort)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ollamaModel,
        stream: false,
        options: { temperature: 0.1 },
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      }),
      timeoutMs: 240000,
      maxBytes: 1024 * 1024,
    });
    const answer = (response.body as { message?: { content?: unknown } }).message?.content;
    if (typeof answer !== 'string') throw new Error('Unexpected Ollama response');
    return answer.split(/\s+/).slice(0, 120).join(' ');
  }
}
