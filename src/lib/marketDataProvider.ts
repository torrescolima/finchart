/**
 * Server-side commercial market data provider abstraction.
 * Reads optional API credentials strictly from process.env:
 *   - POLYGON_API_KEY (Polygon.io / Massive commercial equities OHLCV API)
 *   - FINNHUB_API_KEY (Finnhub commercial real-time quotes, news & earnings API)
 *   - MARKET_DATA_PROVIDER ('auto' | 'polygon' | 'finnhub' | 'yahoo')
 *
 * When both Polygon and Finnhub are configured:
 *   - Historical OHLCV charts prioritize Polygon.io (with Finnhub failover)
 *   - High-frequency watchlist quotes prioritize Finnhub (60 req/min) with Polygon fallback
 *   - Company news & earnings calendar prioritize Finnhub (with Yahoo fallback)
 */

export interface ProviderBar {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderChartResult {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  price: number;
  prevClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  week52High: number;
  week52Low: number;
  volume: number;
  marketTime: number;
  bars: ProviderBar[];
  providerLabel: string;
}

export interface ProviderNewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: number;
  relatedTickers: string[];
}

export interface ProviderEarningsEvent {
  symbol: string;
  earningsDate: string;
  earningsTimestamp: number;
  earningsDateEnd: string | null;
  isEstimate: boolean;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueEstimate: number | null;
  lastQuarterEpsActual: number | null;
  lastQuarterEpsEstimate: number | null;
  lastQuarterSurprisePct: number | null;
  beatCount: number;
  historyCount: number;
}

const POLYGON_HOST = 'https://api.polygon.io';
const FINNHUB_HOST = 'https://finnhub.io/api/v1';
const SYMBOL_SAFE_RE = /^[A-Z0-9.\-^]{1,12}$/;

const providerCache = new Map<string, { expiresAt: number; data: unknown }>();

function getCache<T>(key: string): T | null {
  const hit = providerCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    providerCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  if (providerCache.size > 600) {
    const oldest = providerCache.keys().next().value;
    if (oldest) providerCache.delete(oldest);
  }
  providerCache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

const TIMEFRAME_DAYS: Record<
  string,
  { days: number; timespan: 'minute' | 'hour' | 'day'; multiplier: number; intraday: boolean }
> = {
  '1D': { days: 2, timespan: 'minute', multiplier: 5, intraday: true },
  '1W': { days: 7, timespan: 'minute', multiplier: 30, intraday: true },
  '1M': { days: 32, timespan: 'day', multiplier: 1, intraday: false },
  '3M': { days: 95, timespan: 'day', multiplier: 1, intraday: false },
  '6M': { days: 185, timespan: 'day', multiplier: 1, intraday: false },
  '1Y': { days: 370, timespan: 'day', multiplier: 1, intraday: false },
  '2Y': { days: 735, timespan: 'day', multiplier: 1, intraday: false },
};

function hasPolygonKey(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

function getProviderPreference(): 'auto' | 'polygon' | 'finnhub' | 'yahoo' {
  const pref = (process.env.MARKET_DATA_PROVIDER || 'auto').trim().toLowerCase();
  if (pref === 'polygon' || pref === 'finnhub' || pref === 'yahoo') return pref;
  return 'auto';
}

export function getActiveMarketDataSourceLabel(): string {
  const pref = getProviderPreference();
  const poly = hasPolygonKey();
  const finn = hasFinnhubKey();

  if (pref === 'yahoo') return 'Yahoo Finance (Preview)';
  if (pref === 'polygon' && poly) return 'Polygon.io Commercial Feed';
  if (pref === 'finnhub' && finn) return 'Finnhub Commercial Feed';
  if (poly && finn) return 'Polygon.io + Finnhub Commercial Feed';
  if (poly) return 'Polygon.io Commercial Feed';
  if (finn) return 'Finnhub Commercial Feed';
  return 'Yahoo Finance (Delayed / Preview)';
}

function formatDateYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatBarTime(epochMs: number, intraday: boolean): string {
  const d = new Date(epochMs);
  if (intraday) {
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return d.toISOString().slice(0, 10);
}

async function fetchPolygonChart(
  symbol: string,
  timeframe: string
): Promise<ProviderChartResult | null> {
  const apiKey = process.env.POLYGON_API_KEY?.trim();
  if (!apiKey) return null;

  const cacheKey = `poly:chart:${symbol}:${timeframe}`;
  const cached = getCache<ProviderChartResult>(cacheKey);
  if (cached) return cached;

  const spec = TIMEFRAME_DAYS[timeframe] ?? TIMEFRAME_DAYS['1M'];
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - spec.days * 86_400_000);
  const polygonSym = symbol.replace(/-/g, '.');

  const url = `${POLYGON_HOST}/v2/aggs/ticker/${encodeURIComponent(
    polygonSym
  )}/range/${spec.multiplier}/${spec.timespan}/${formatDateYmd(fromDate)}/${formatDateYmd(
    toDate
  )}?adjusted=true&sort=asc&limit=500`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const json = (await response.json()) as {
    results?: Array<{
      t?: number;
      o?: number;
      h?: number;
      l?: number;
      c?: number;
      v?: number;
    }>;
  };

  const rawBars = json.results ?? [];
  if (rawBars.length === 0) return null;

  const bars: ProviderBar[] = [];
  for (const r of rawBars) {
    if (
      typeof r.t !== 'number' ||
      typeof r.o !== 'number' ||
      typeof r.h !== 'number' ||
      typeof r.l !== 'number' ||
      typeof r.c !== 'number'
    ) {
      continue;
    }
    bars.push({
      time: formatBarTime(r.t, spec.intraday),
      timestamp: r.t,
      open: Number(r.o.toFixed(2)),
      high: Number(r.h.toFixed(2)),
      low: Number(r.l.toFixed(2)),
      close: Number(r.c.toFixed(2)),
      volume: Math.max(0, Math.round(typeof r.v === 'number' ? r.v : 0)),
    });
  }

  if (bars.length === 0) return null;

  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  const result: ProviderChartResult = {
    symbol,
    name: symbol,
    exchange: 'NASDAQ',
    price: last.close,
    prevClose: prev.close,
    open: last.open,
    dayHigh: last.high,
    dayLow: last.low,
    week52High: Math.max(...highs),
    week52Low: Math.min(...lows),
    volume: last.volume,
    marketTime: last.timestamp,
    bars,
    providerLabel: 'Polygon.io',
  };

  setCache(cacheKey, result, spec.intraday ? 30_000 : 120_000);
  return result;
}

async function fetchFinnhubQuoteOnly(symbol: string): Promise<ProviderChartResult | null> {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  if (!apiKey) return null;

  const cacheKey = `finn:quote:${symbol}`;
  const cached = getCache<ProviderChartResult>(cacheKey);
  if (cached) return cached;

  const quoteRes = await fetch(
    `${FINNHUB_HOST}/quote?symbol=${encodeURIComponent(symbol)}`,
    {
      headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    }
  );
  if (!quoteRes.ok) return null;

  const quote = (await quoteRes.json()) as {
    c?: number;
    pc?: number;
    o?: number;
    h?: number;
    l?: number;
    t?: number;
  };
  if (typeof quote.c !== 'number' || !Number.isFinite(quote.c) || quote.c <= 0) {
    return null;
  }

  // Reuse any cached Polygon 1M bars if available so sparklines stay fresh without extra API calls
  const cachedPoly = getCache<ProviderChartResult>(`poly:chart:${symbol}:1M`);
  const bars = cachedPoly?.bars ?? [];

  const result: ProviderChartResult = {
    symbol,
    name: symbol,
    exchange: 'NASDAQ',
    price: Number(quote.c.toFixed(2)),
    prevClose: Number((quote.pc && quote.pc > 0 ? quote.pc : quote.c).toFixed(2)),
    open: Number((quote.o && quote.o > 0 ? quote.o : quote.c).toFixed(2)),
    dayHigh: Number((quote.h && quote.h > 0 ? quote.h : quote.c).toFixed(2)),
    dayLow: Number((quote.l && quote.l > 0 ? quote.l : quote.c).toFixed(2)),
    week52High: cachedPoly?.week52High ?? Number((quote.h && quote.h > 0 ? quote.h : quote.c).toFixed(2)),
    week52Low: cachedPoly?.week52Low ?? Number((quote.l && quote.l > 0 ? quote.l : quote.c).toFixed(2)),
    volume: cachedPoly?.volume ?? 0,
    marketTime: typeof quote.t === 'number' && quote.t > 0 ? quote.t * 1000 : Date.now(),
    bars,
    providerLabel: 'Finnhub',
  };

  setCache(cacheKey, result, 25_000);
  return result;
}

async function fetchFinnhubChart(
  symbol: string,
  timeframe: string
): Promise<ProviderChartResult | null> {
  const apiKey = process.env.FINNHUB_API_KEY?.trim();
  if (!apiKey) return null;

  const cacheKey = `finn:chart:${symbol}:${timeframe}`;
  const cached = getCache<ProviderChartResult>(cacheKey);
  if (cached) return cached;

  const spec = TIMEFRAME_DAYS[timeframe] ?? TIMEFRAME_DAYS['1M'];
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - spec.days * 86_400;
  const resolution = spec.timespan === 'minute' ? String(spec.multiplier) : 'D';

  const [quoteRes, candleRes] = await Promise.all([
    fetch(`${FINNHUB_HOST}/quote?symbol=${encodeURIComponent(symbol)}`, {
      headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    }),
    fetch(
      `${FINNHUB_HOST}/stock/candle?symbol=${encodeURIComponent(
        symbol
      )}&resolution=${encodeURIComponent(resolution)}&from=${fromSec}&to=${toSec}`,
      {
        headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      }
    ),
  ]);

  if (!quoteRes.ok || !candleRes.ok) return null;

  const quote = (await quoteRes.json()) as {
    c?: number;
    pc?: number;
    o?: number;
    h?: number;
    l?: number;
    t?: number;
  };
  const candle = (await candleRes.json()) as {
    s?: string;
    t?: number[];
    o?: number[];
    h?: number[];
    l?: number[];
    c?: number[];
    v?: number[];
  };

  if (candle.s !== 'ok' || !Array.isArray(candle.t) || candle.t.length === 0) {
    return null;
  }

  const bars: ProviderBar[] = [];
  for (let i = 0; i < candle.t.length; i++) {
    const o = candle.o?.[i];
    const h = candle.h?.[i];
    const l = candle.l?.[i];
    const c = candle.c?.[i];
    if (
      typeof o !== 'number' ||
      typeof h !== 'number' ||
      typeof l !== 'number' ||
      typeof c !== 'number'
    ) {
      continue;
    }
    const tsMs = candle.t[i] * 1000;
    bars.push({
      time: formatBarTime(tsMs, spec.intraday),
      timestamp: tsMs,
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(0, Math.round(candle.v?.[i] ?? 0)),
    });
  }

  if (bars.length === 0) return null;

  const last = bars[bars.length - 1];
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const price = typeof quote.c === 'number' && quote.c > 0 ? quote.c : last.close;

  const result: ProviderChartResult = {
    symbol,
    name: symbol,
    exchange: 'NASDAQ',
    price: Number(price.toFixed(2)),
    prevClose: Number((quote.pc && quote.pc > 0 ? quote.pc : last.close).toFixed(2)),
    open: Number((quote.o && quote.o > 0 ? quote.o : last.open).toFixed(2)),
    dayHigh: Number((quote.h && quote.h > 0 ? quote.h : last.high).toFixed(2)),
    dayLow: Number((quote.l && quote.l > 0 ? quote.l : last.low).toFixed(2)),
    week52High: Math.max(...highs),
    week52Low: Math.min(...lows),
    volume: last.volume,
    marketTime: typeof quote.t === 'number' && quote.t > 0 ? quote.t * 1000 : last.timestamp,
    bars,
    providerLabel: 'Finnhub',
  };

  setCache(cacheKey, result, spec.intraday ? 30_000 : 120_000);
  return result;
}

/**
 * Fetches live watchlist quote using Finnhub first (fast, 60 req/min) when available,
 * falling back to Polygon.io daily aggregates, then returning null for Yahoo fallback.
 */
export async function fetchCommercialQuote(
  symbol: string
): Promise<ProviderChartResult | null> {
  const pref = getProviderPreference();
  if (pref === 'yahoo') return null;

  try {
    if (pref === 'finnhub' && hasFinnhubKey()) {
      return await fetchFinnhubQuoteOnly(symbol);
    }
    if (pref === 'polygon' && hasPolygonKey()) {
      return await fetchPolygonChart(symbol, '1M');
    }

    // Auto mode: prefer Finnhub for fast batch real-time quotes, then Polygon
    if (hasFinnhubKey()) {
      const finn = await fetchFinnhubQuoteOnly(symbol);
      if (finn && finn.price > 0) return finn;
    }
    if (hasPolygonKey()) {
      const poly = await fetchPolygonChart(symbol, '1M');
      if (poly && poly.price > 0) return poly;
    }
  } catch (error) {
    console.warn(`Commercial quote fallback triggered for ${symbol}:`, error);
  }
  return null;
}

/**
 * Fetches OHLCV chart history using Polygon.io first (full adjusted history),
 * with automatic failover to Finnhub, returning null for Yahoo fallback.
 */
export async function fetchCommercialChart(
  symbol: string,
  timeframe: string
): Promise<ProviderChartResult | null> {
  const pref = getProviderPreference();
  if (pref === 'yahoo') return null;

  try {
    if (pref === 'finnhub' && hasFinnhubKey()) {
      return await fetchFinnhubChart(symbol, timeframe);
    }
    if (pref === 'polygon' && hasPolygonKey()) {
      return await fetchPolygonChart(symbol, timeframe);
    }

    // Auto mode: Polygon.io first for deep OHLCV history, Finnhub second
    if (hasPolygonKey()) {
      const poly = await fetchPolygonChart(symbol, timeframe);
      if (poly && poly.bars.length > 0) return poly;
    }
    if (hasFinnhubKey()) {
      const finn = await fetchFinnhubChart(symbol, timeframe);
      if (finn && finn.bars.length > 0) return finn;
    }
  } catch (error) {
    console.warn(`Commercial chart fallback triggered for ${symbol}:`, error);
  }
  return null;
}

/**
 * Fetches company news headlines from Finnhub when FINNHUB_API_KEY is configured.
 */
export async function fetchCommercialNews(
  symbol: string
): Promise<ProviderNewsItem[] | null> {
  if (getProviderPreference() === 'yahoo' || !hasFinnhubKey()) return null;
  const apiKey = process.env.FINNHUB_API_KEY!.trim();

  const cacheKey = `finn:news:${symbol}`;
  const cached = getCache<ProviderNewsItem[]>(cacheKey);
  if (cached) return cached;

  try {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - 30 * 86_400_000);
    const url = `${FINNHUB_HOST}/company-news?symbol=${encodeURIComponent(
      symbol
    )}&from=${formatDateYmd(fromDate)}&to=${formatDateYmd(toDate)}`;

    const res = await fetch(url, {
      headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const raw = (await res.json()) as Array<{
      headline?: string;
      source?: string;
      url?: string;
      datetime?: number;
      related?: string;
    }>;

    if (!Array.isArray(raw) || raw.length === 0) return null;

    const items: ProviderNewsItem[] = raw
      .filter(
        (n) =>
          typeof n.headline === 'string' &&
          n.headline.trim().length > 0 &&
          typeof n.url === 'string' &&
          n.url.startsWith('https://')
      )
      .slice(0, 8)
      .map((n) => ({
        title: n.headline!.trim(),
        publisher: (n.source || 'Finnhub Wire').trim(),
        link: n.url!,
        publishedAt: typeof n.datetime === 'number' ? n.datetime * 1000 : Date.now(),
        relatedTickers: typeof n.related === 'string'
          ? n.related
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter((s) => SYMBOL_SAFE_RE.test(s))
              .slice(0, 5)
          : [symbol],
      }));

    if (items.length === 0) return null;
    setCache(cacheKey, items, 300_000);
    return items;
  } catch {
    return null;
  }
}

/**
 * Fetches upcoming earnings event for a symbol from Finnhub when FINNHUB_API_KEY is configured.
 */
export async function fetchCommercialEarnings(
  symbol: string
): Promise<ProviderEarningsEvent | null> {
  if (getProviderPreference() === 'yahoo' || !hasFinnhubKey()) return null;
  const apiKey = process.env.FINNHUB_API_KEY!.trim();

  const cacheKey = `finn:earnings:${symbol}`;
  const cached = getCache<ProviderEarningsEvent | { empty: true }>(cacheKey);
  if (cached) return 'empty' in cached ? null : cached;

  try {
    const fromDate = new Date(Date.now() - 180 * 86_400_000);
    const toDate = new Date(Date.now() + 180 * 86_400_000);
    const url = `${FINNHUB_HOST}/calendar/earnings?symbol=${encodeURIComponent(
      symbol
    )}&from=${formatDateYmd(fromDate)}&to=${formatDateYmd(toDate)}`;

    const res = await fetch(url, {
      headers: { 'X-Finnhub-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      earningsCalendar?: Array<{
        date?: string;
        epsActual?: number | null;
        epsEstimate?: number | null;
        revenueEstimate?: number | null;
      }>;
    };

    const rows = (json.earningsCalendar ?? []).filter(
      (r) => typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)
    );
    if (rows.length === 0) {
      setCache(cacheKey, { empty: true }, 15 * 60_000);
      return null;
    }

    const todayStr = formatDateYmd(new Date());
    const upcoming = rows
      .filter((r) => r.date! >= todayStr)
      .sort((a, b) => a.date!.localeCompare(b.date!));
    const reported = rows
      .filter(
        (r) =>
          typeof r.epsActual === 'number' && typeof r.epsEstimate === 'number'
      )
      .sort((a, b) => a.date!.localeCompare(b.date!));

    const nextEvt = upcoming[0];
    if (!nextEvt) {
      setCache(cacheKey, { empty: true }, 15 * 60_000);
      return null;
    }

    const lastQ = reported[reported.length - 1];
    const beatCount = reported.filter(
      (r) => (r.epsActual ?? 0) >= (r.epsEstimate ?? 0)
    ).length;
    const lastSurprisePct =
      lastQ &&
      typeof lastQ.epsActual === 'number' &&
      typeof lastQ.epsEstimate === 'number' &&
      Math.abs(lastQ.epsEstimate) > 0.001
        ? Number(
            (((lastQ.epsActual - lastQ.epsEstimate) / Math.abs(lastQ.epsEstimate)) * 100).toFixed(2)
          )
        : null;

    const parsed: ProviderEarningsEvent = {
      symbol,
      earningsDate: nextEvt.date!,
      earningsTimestamp: Date.parse(`${nextEvt.date!}T16:00:00Z`),
      earningsDateEnd: null,
      isEstimate: nextEvt.epsActual === null || nextEvt.epsActual === undefined,
      epsEstimate:
        typeof nextEvt.epsEstimate === 'number'
          ? Number(nextEvt.epsEstimate.toFixed(2))
          : null,
      epsLow: null,
      epsHigh: null,
      revenueEstimate:
        typeof nextEvt.revenueEstimate === 'number'
          ? Math.round(nextEvt.revenueEstimate)
          : null,
      lastQuarterEpsActual:
        typeof lastQ?.epsActual === 'number' ? Number(lastQ.epsActual.toFixed(2)) : null,
      lastQuarterEpsEstimate:
        typeof lastQ?.epsEstimate === 'number' ? Number(lastQ.epsEstimate.toFixed(2)) : null,
      lastQuarterSurprisePct: lastSurprisePct,
      beatCount,
      historyCount: reported.length,
    };

    setCache(cacheKey, parsed, 15 * 60_000);
    return parsed;
  } catch {
    return null;
  }
}
