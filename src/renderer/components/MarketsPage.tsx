// Market UI: provider requests are explicit or scoped to the mounted page.
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType, type UTCTimestamp } from 'lightweight-charts';
import { ArrowLeft, ArrowUpRight, ArrowDownRight, ChevronRight, Plus, X } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { marketProviderName, moveSummary, rangeSpec, type Candle, type Quote, type MarketRange, type SymbolMatch, type TrendingMarket, type TrendingMarkets } from '../../shared/markets';
import type { PageCtx } from './Pages';
import { ExternalLink, Time } from './common';

type MarketNews = Awaited<ReturnType<typeof api.marketsNews>>;

export function ArticlePreviews({ news }: { news: MarketNews }) {
  return (
    <>
      <p className="muted small">{news.source} · Retrieved <Time iso={news.fetchedAt} relative /></p>
      {news.articles.length ? (
        <ol className="market-news">
          {news.articles.map((article, index) => (
            <li id={'market-headline-' + (index + 1)} key={article.url}>
              <div className="muted small">{article.domain} · <Time iso={article.seenAt} /></div>
              <h4>{article.title}</h4>
              {article.summary
                ? <p className="market-article-summary">{article.summary}</p>
                : <p className="muted small">The source supplied a headline only.</p>}
              <ExternalLink url={article.url}>Read article<span className="sr-only"> — {article.title}</span></ExternalLink>
            </li>
          ))}
        </ol>
      ) : <p className="muted">No recent stories returned for this market.</p>}
    </>
  );
}

function TrendingDetail({ item, back }: { item: TrendingMarket; back(): void }) {
  const [news, setNews] = useState<MarketNews | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let current = true;
    setNews(null);
    setError('');
    void api.marketsNews(item.symbol, item.name, 'trending').then(result => {
      if (current) setNews(result);
    }).catch(error => { if (current) setError(errorText(error)); });
    return () => { current = false; };
  }, [item.symbol, item.name, retry]);

  return (
    <section className="market-browser" aria-label={'Market details for ' + item.symbol}>
      <button className="link-btn market-back" onClick={back}><ArrowLeft size={16} aria-hidden="true" /> Back to trending</button>
      <span className="market-ticker">{item.symbol}</span>
      <h3 className="market-detail-title" ref={heading} tabIndex={-1}>{item.name}</h3>
      <div className="market-detail-figures">
        <MarketFigures item={item} />
        <span>{item.volume.toLocaleString()} shares traded</span>
      </div>
      {item.asOf && <p className="muted small">Market data as of <Time iso={item.asOf} /></p>}
      <h3 className="market-stories-heading">Related news</h3>
      {error ? (
        <div><p className="error" role="alert">{error}</p><button className="btn" onClick={() => setRetry(n => n + 1)}>Retry news</button></div>
      ) : news ? <ArticlePreviews news={news} /> : <p className="muted" role="status">Loading stories for {item.symbol}…</p>}
    </section>
  );
}

const volumeFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const sessionDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'America/New_York' });
function MarketFigures({ item }: { item: TrendingMarket }) {
  return (
    <>
      <span className="market-price">{item.price === null ? '—' : item.price.toLocaleString(undefined, { maximumFractionDigits: 4 })} {item.price !== null && item.currency}</span>
      <span className={item.changePct === null || item.changePct === 0 ? 'muted' : item.changePct > 0 ? 'market-up' : 'market-down'}>
        {item.changePct === null ? '—' : (item.changePct > 0 ? '+' : '') + item.changePct.toFixed(2) + '%'}
      </span>
    </>
  );
}

function TrendingBrowser() {
  const [ranking, setRanking] = useState<TrendingMarkets | null>(null);
  const [selected, setSelected] = useState<TrendingMarket | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const restoreFocus = useRef<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    let current = true;
    setError('');
    void api.marketsTrending().then(result => { if (current) setRanking(result); })
      .catch(error => { if (current) setError(errorText(error)); });
    return () => { current = false; };
  }, [retry]);
  useEffect(() => {
    if (selected || !restoreFocus.current) return;
    const buttons = list.current?.querySelectorAll('button');
    Array.from(buttons ?? []).find(button => button.dataset.symbol === restoreFocus.current)?.focus();
    restoreFocus.current = null;
  }, [selected]);

  if (selected) return (
    <TrendingDetail key={selected.symbol} item={selected}
      back={() => { restoreFocus.current = selected.symbol; setSelected(null); }} />
  );
  return (
    <section className="market-browser" aria-label="Trending markets">
      <h3>Most active U.S. stocks</h3>
      <p className="muted">Ranked by shares traded in the latest reported session.</p>
      {error ? (
        <div><p className="error" role="alert">{error}</p><button className="btn" onClick={() => setRetry(n => n + 1)}>Retry ranking</button></div>
      ) : !ranking ? <p className="muted" role="status">Loading the market ranking…</p> : (
        <>
          <p className="muted small">{ranking.source} · Retrieved <Time iso={ranking.fetchedAt} relative /></p>
          {ranking.items.length ? (
            <>
              <div className="market-list-head market-columns" aria-hidden="true">
                <span>Stock</span><span>Price</span><span>Change</span><span>Volume</span>
              </div>
              <ol className="market-ranking" ref={list}>
                {ranking.items.map(item => (
                  <li key={item.symbol}>
                    <button className="market-columns" data-symbol={item.symbol} onClick={() => setSelected(item)}>
                      <span className="market-identity"><span className="sr-only">View news for </span><b>{item.symbol}</b><span className="muted">{item.name}</span></span>
                      <MarketFigures item={item} />
                      <span className="market-volume" title={item.volume.toLocaleString() + ' shares'}>
                        {volumeFormat.format(item.volume)}<span className="sr-only"> shares traded</span>
                        {item.asOf && <time className="muted small" dateTime={item.asOf}>{sessionDate.format(new Date(item.asOf))}</time>}
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : <p className="muted">The source returned no ranked stocks.</p>}
        </>
      )}
    </section>
  );
}

function PriceChart({ candles, line }: { candles: Candle[]; line: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = createChart(element.current, {
      autoSize: true,
      height: 340,
      layout: { background: { type: ColorType.Solid, color: '#111820' }, textColor: '#b5c2d0', attributionLogo: true },
      grid: { vertLines: { color: '#1b2632' }, horzLines: { color: '#1b2632' } },
      timeScale: { timeVisible: true },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
    });
    const series = line ? chart.addSeries(LineSeries, { color: '#74cada' }) : chart.addSeries(CandlestickSeries, {
      upColor: '#83d6a1', downColor: '#ff9690', wickUpColor: '#83d6a1', wickDownColor: '#ff9690', borderVisible: false,
    });
    series.setData(candles.map(candle => line
      ? { time: candle.time as UTCTimestamp, value: candle.close } : { ...candle, time: candle.time as UTCTimestamp }));
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, color: '#426878' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(candles.filter(candle => candle.volume !== null).map(candle => ({
      time: candle.time as UTCTimestamp, value: candle.volume!, color: candle.close >= candle.open ? '#385e4b' : '#684744',
    })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, line]);
  return <div ref={element} className="market-chart" aria-label="Price chart with volume" />;
}

export function MarketsPage({ ctx }: { ctx: PageCtx }) {
  const [view, setView] = useState<'trending' | 'watchlist'>('trending');
  return (
    <>
      <div className="page-head market-page-head">
        <h2>Markets</h2>
        <div className="seg" role="group" aria-label="Market view">
          <button className="btn" aria-pressed={view === 'trending'} onClick={() => setView('trending')}>Trending</button>
          <button className="btn" aria-pressed={view === 'watchlist'} onClick={() => setView('watchlist')}>Watchlist</button>
        </div>
      </div>
      {view === 'trending' ? <TrendingBrowser /> : <MarketWatchlist ctx={ctx} />}
    </>
  );
}

function MarketWatchlist({ ctx }: { ctx: PageCtx }) {
  const settings = ctx.snap.settings;
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SymbolMatch[]>([]);
  const [selected, setSelected] = useState(settings.marketWatchlist[0] ?? '');
  const [range, setRange] = useState<MarketRange>('1M');
  const [line, setLine] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [prices, setPrices] = useState<Record<string, Quote>>({});
  const [candles, setCandles] = useState<Candle[]>([]);
  const [news, setNews] = useState<MarketNews | null>(null);
  const [error, setError] = useState('');
  const [newsError, setNewsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [warning, setWarning] = useState('');
  const [ai, setAi] = useState(false);
  const [answer, setAnswer] = useState('');
  // Changes whenever the asset, range or provider changes; an AI answer for an older generation is discarded.
  const explainGeneration = useRef(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const mounted = useRef(true);
  const selectedLoad = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Bumped on provider change; search results from another provider's symbol namespace are discarded.
  const searchGeneration = useRef(0);

  useEffect(() => {
    let alive = true;
    searchGeneration.current++;
    setMatches([]);
    setSearchBusy(false);
    const check = () => {
      setConfigured(null);
      setPrices({});
      void api.listProviders().then(providers => {
        if (alive) setConfigured(providers.find(provider => provider.id === settings.marketProvider)?.configured ?? false);
      }).catch(error => { if (alive) setError(errorText(error)); });
    };
    check();
    window.addEventListener('atlas-providers-changed', check);
    return () => {
      alive = false;
      window.removeEventListener('atlas-providers-changed', check);
    };
  }, [settings.marketProvider]);

  useEffect(() => {
    let alive = true;
    setAi(false);
    if (settings.aiEnabled) {
      void api.aiStatus().then(status => { if (alive) setAi(status.reachable); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [settings.aiEnabled, settings.ollamaPort, settings.ollamaModel]);

  // Explicit searches conserve the daily free-tier quota.
  const search = async () => {
    const generation = searchGeneration.current;
    const current = () => mounted.current && generation === searchGeneration.current;
    setSearchBusy(true);
    setError('');
    try {
      const result = await api.marketsSearch(query);
      if (current()) {
        setMatches(result.data);
        setWarning(result.warning ?? '');
      }
    } catch (error) {
      if (current()) setError(errorText(error));
    } finally {
      if (current()) setSearchBusy(false);
    }
  };

  useEffect(() => {
    if (!configured || !selected) return;
    let alive = true;
    setBusy(true);
    setError('');
    setCandles([]);
    setQuote(null);
    setNews(null);
    setNewsError('');
    setAnswer('');
    explainGeneration.current++;
    setAiBusy(false);
    selectedLoad.current = (async () => {
      try {
        const result = await api.marketsQuote(selected);
        if (!alive) return;
        setQuote(result.data);
        setPrices(old => ({ ...old, [selected]: result.data }));
        setWarning(result.warning ?? '');
        void api.marketsNews(selected, result.data.name).then(news => {
          if (alive) setNews(news);
        }).catch(error => { if (alive) setNewsError(errorText(error)); });
        const series = await api.marketsCandles(selected, range);
        if (alive) {
          setCandles(series.data);
          setWarning(series.warning ?? result.warning ?? '');
        }
      } catch (error) {
        if (alive) setError(errorText(error));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [configured, selected, range, settings.marketProvider]);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    setSkipped([]);
    // Best-effort prefetch only; selecting an asset always gives explicit error feedback.
    const symbols = settings.marketWatchlist.filter(symbol => symbol !== selected);
    void (async () => {
      await selectedLoad.current;
      for (let index = 0; index < symbols.length; index++) {
        if (!alive) return;
        const symbol = symbols[index];
        try {
          const result = await api.marketsQuote(symbol);
          if (alive) {
            setPrices(prices => ({ ...prices, [symbol]: result.data }));
            if (result.warning) setWarning(result.warning);
          }
        } catch (error) {
          if (alive) {
            const message = errorText(error);
            if (/free-tier limit|built-in allowance|rate.limit|429/i.test(message)) setSkipped(symbols.slice(index));
            else setError(message);
          }
          break;
        }
      }
    })();
    return () => { alive = false; };
  }, [configured, settings.marketProvider, settings.marketWatchlist.join('|')]);

  const weekly = rangeSpec(settings.marketProvider, range).interval === '1week';
  const movement = moveSummary(candles, weekly ? 'week' : 'session');
  const provider = marketProviderName(settings.marketProvider);
  const notLoaded = skipped.filter(symbol => !prices[symbol]).length;

  const remove = (symbol: string) => {
    const list = settings.marketWatchlist.filter(item => item !== symbol);
    ctx.patch({ marketWatchlist: list });
    if (selected === symbol) setSelected(list[0] ?? '');
  };

  const summarize = () => {
    const generation = explainGeneration.current;
    const current = () => mounted.current && generation === explainGeneration.current;
    setAiBusy(true);
    setAnswer('');
    void api.marketsExplain(selected, news?.articles.map(article => article.title) ?? [], movement).then(answer => {
      if (current()) setAnswer(answer);
    }).catch(error => {
      if (current()) setNewsError(errorText(error));
    }).finally(() => { if (current()) setAiBusy(false); });
  };

  return (
    <>
      {error && configured !== true && <p className="error" role="alert">{error}</p>}
      <div className="page-head">
        <h3>Market watchlist</h3>
        <select aria-label="Market provider" value={settings.marketProvider}
          onChange={event => ctx.patch({ marketProvider: event.target.value as typeof settings.marketProvider })}>
          <option value="twelvedata">Twelve Data</option>
          <option value="alphavantage">Alpha Vantage</option>
        </select>
      </div>
      {configured === false ? (
        <div className="note">
          <h3>Watchlist prices need a provider key</h3>
          <p>Add a key for {provider} in Providers to search symbols and load charts.</p>
          {settings.marketWatchlist.length > 0 && <p>Saved symbols · {settings.marketWatchlist.join(', ')}</p>}
          <button className="btn" onClick={ctx.openProviders}>Open Providers</button>{' '}
          <ExternalLink url={settings.marketProvider === 'twelvedata' ? 'https://twelvedata.com/docs' : 'https://www.alphavantage.co/documentation/'}>
            Provider docs
          </ExternalLink>
        </div>
      ) : configured === null ? <p role="status">Checking provider setup…</p> : (
        <div className="markets-layout">
          <aside className="market-watch">
            <form className="field-row" onSubmit={event => { event.preventDefault(); void search(); }}>
              <input aria-label="Search symbols" placeholder="Find an asset" value={query} maxLength={80}
                onChange={event => setQuery(event.target.value)} />
              <button className="btn" disabled={!query.trim() || searchBusy}>Search</button>
            </form>
            {searchBusy && <p role="status">Searching…</p>}
            {matches.map(match => (
              <button className="market-search-result" key={match.symbol + '@' + match.exchange} onClick={() => {
                if (!settings.marketWatchlist.includes(match.symbol) && settings.marketWatchlist.length < 50) {
                  ctx.patch({ marketWatchlist: [...settings.marketWatchlist, match.symbol] });
                }
                setSelected(match.symbol);
                setMatches([]);
              }}>
                <Plus size={16} aria-hidden="true" />{match.symbol} · {match.name} <small>{match.exchange}</small>
              </button>
            ))}
            {!settings.marketWatchlist.length && <p className="muted">Search to add an asset to your watchlist. No default symbols are added.</p>}
            {settings.marketWatchlist.map(symbol => {
              const price = prices[symbol];
              return (
                <div key={symbol} className="watch-row">
                  <button className={selected === symbol ? 'selected' : ''} onClick={() => setSelected(symbol)}>
                    <b>{symbol}</b>
                    {price && (
                      <span className={price.change >= 0 ? 'market-up' : 'market-down'}>
                        {price.change >= 0 ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownRight size={16} aria-hidden="true" />}
                        {' '}{price.price.toLocaleString()} · {price.changePct.toFixed(2)}%
                      </span>
                    )}
                  </button>
                  <button className="icon-btn" aria-label={'Remove ' + symbol} onClick={() => remove(symbol)}><X size={16} aria-hidden="true" /></button>
                </div>
              );
            })}
            {notLoaded > 0 && (
              <p className="muted small">Prices for {notLoaded} symbols not loaded to stay within the provider's rate limit; select a symbol to load it.</p>
            )}
          </aside>
          <section className="market-main">
            {warning && <p className="note">{warning}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {!selected ? <p className="muted">Choose an asset to view its chart and recent news.</p> : (
              <>
                <h3>{quote?.name ?? selected} <small className="muted">{selected} {quote?.exchange}</small></h3>
                {quote && (
                  <>
                    <div className={quote.change >= 0 ? 'market-up' : 'market-down'}>
                      {quote.price.toLocaleString()} {quote.currency} · {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePct.toFixed(2)}%)
                    </div>
                    <p className="muted small">As of {new Date(quote.asOf).toLocaleString()} · {provider} · may be delayed</p>
                  </>
                )}
                <div className="field-row market-ranges" role="group" aria-label="Chart range">
                  {(['1D', '5D', '1M', '6M', '1Y', '5Y'] as MarketRange[]).map(item => (
                    <button className={'btn ' + (item === range ? 'primary' : '')} aria-pressed={item === range} key={item} onClick={() => setRange(item)}>
                      {item}
                    </button>
                  ))}
                  <button className="btn" aria-pressed={line} onClick={() => setLine(!line)}>{line ? 'Line' : 'Candlestick'}</button>
                </div>
                {weekly && <p className="muted small">Weekly bars{settings.marketProvider === 'alphavantage' ? ' · free Alpha Vantage history' : ''}</p>}
                {busy ? <div className="market-skeleton" role="status">Loading prices…</div> : candles.length
                  ? <PriceChart candles={candles} line={line} /> : <p>No candles available for this range.</p>}
                <h3>What's moving it</h3>
                <p>{movement}</p>
                {newsError && <p className="error" role="alert">{newsError}</p>}
                {news ? <ArticlePreviews news={news} /> : !newsError && quote && <p className="muted" role="status">Loading related news…</p>}
                {ai && news && news.articles.length > 0 && (
                  <button className="btn" disabled={aiBusy} onClick={summarize}>
                    {aiBusy ? 'Summarizing…' : 'Summarize possible drivers (local AI)'}
                  </button>
                )}
                {answer && (
                  <div className="note">
                    <b>AI summary of the headlines above (local model; may be wrong; not investment advice)</b>
                    <p>{answer.split(/(\[\d+\])/).map((part, index) => {
                      const number = Number(part.match(/^\[(\d+)\]$/)?.[1]);
                      return number && news?.articles[number - 1] ? (
                        <button key={index} className="link-btn"
                          onClick={() => document.getElementById('market-headline-' + number)?.scrollIntoView({ block: 'nearest' })}>{part}</button>
                      ) : part;
                    })}</p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <p className="muted small">Prices from {provider}, may be delayed. Charts: TradingView Lightweight Charts. Not investment advice.</p>
    </>
  );
}
