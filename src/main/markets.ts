// One app-wide market service, shared with Provider Settings connection tests.
import type { Settings } from '../shared/types';
import {
  normalizeCandles, normalizeQuote, normalizeSearch, rangeSpec, newsQuery, parseGdelt, buildMarketPrompt,
  type MarketProvider, type MarketRange, type MarketResult,
} from '../shared/markets';
import { registerFeedLinks } from '../shared/sanitize';
import { fetchJson, fetchText } from './feeds/http';
import { redactSecrets, type SecretStore } from './secrets';
import { getAiStatus, ollamaEndpoint } from './ollama';
import { CredentialService, type Credential } from './credentials';
import type { AtlasStore } from './store';

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

  news(symbol: string, name: string | null) {
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
        return { articles, fetchedAt: new Date().toISOString() };
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
