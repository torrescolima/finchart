import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Strict input validation
const SYMBOL_RE = /^[A-Z0-9.\-^]{1,12}$/;
const ALLOWED_TIMEFRAMES: Record<string, { range: string; interval: string }> = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '2Y': { range: '2y', interval: '1d' },
};

const YAHOO_HOST = 'https://query1.finance.yahoo.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number): void {
  if (cache.size > 400) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

function toYahooSymbol(symbol: string): string {
  // Yahoo Finance uses hyphens for share classes (e.g., BRK.B -> BRK-B)
  return symbol.replace(/\./g, '-');
}

function normalizeExchange(raw?: string): 'NASDAQ' | 'NYSE' | 'ARCA' {
  const up = (raw || '').toUpperCase();
  if (up.includes('NYQ') || up.includes('NYSE')) return 'NYSE';
  if (up.includes('PCX') || up.includes('ARCA')) return 'ARCA';
  return 'NASDAQ';
}

interface ParsedBar {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ParsedChartResult {
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
  bars: ParsedBar[];
}

function formatBarTime(epochSec: number, intraday: boolean): string {
  const d = new Date(epochSec * 1000);
  if (intraday) {
    // Format HH:MM in US Eastern
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return d.toISOString().slice(0, 10);
}

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string
): Promise<ParsedChartResult | null> {
  const yahooSym = toYahooSymbol(symbol);
  const cacheKey = `chart:${yahooSym}:${range}:${interval}`;
  const cached = getCached<ParsedChartResult>(cacheKey);
  if (cached) return cached;

  const url = `${YAHOO_HOST}/v8/finance/chart/${encodeURIComponent(
    yahooSym
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return null;

  const json = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = json.chart?.result?.[0];
  if (!result || !result.meta) return null;

  const meta = result.meta;
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];
  const isIntraday = interval.endsWith('m') || interval.endsWith('h');

  const bars: ParsedBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (
      typeof o !== 'number' ||
      typeof h !== 'number' ||
      typeof l !== 'number' ||
      typeof c !== 'number' ||
      !Number.isFinite(c)
    ) {
      continue;
    }
    bars.push({
      time: formatBarTime(timestamps[i], isIntraday),
      timestamp: timestamps[i] * 1000,
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(0, Math.round(typeof volumes[i] === 'number' ? volumes[i]! : 0)),
    });
  }

  const lastBar = bars[bars.length - 1];
  const prevBar = bars.length >= 2 ? bars[bars.length - 2] : undefined;

  const price =
    typeof meta.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice)
      ? Number(meta.regularMarketPrice.toFixed(2))
      : lastBar?.close ?? 0;

  // Prefer official previousClose when available, else chartPreviousClose or prior bar
  const rawPrev =
    typeof meta.previousClose === 'number' && Number.isFinite(meta.previousClose)
      ? meta.previousClose
      : typeof meta.chartPreviousClose === 'number' && Number.isFinite(meta.chartPreviousClose)
      ? meta.chartPreviousClose
      : prevBar?.close ?? price;

  // For multi-day daily queries, chartPreviousClose is the close BEFORE the range start,
  // so use the second-to-last daily bar close as yesterday's close when range !== 1d
  const prevClose =
    range === '1d'
      ? Number(rawPrev.toFixed(2))
      : prevBar
      ? prevBar.close
      : Number(rawPrev.toFixed(2));

  const parsed: ParsedChartResult = {
    symbol,
    name: String(meta.longName || meta.shortName || symbol),
    exchange: normalizeExchange(String(meta.fullExchangeName || meta.exchangeName || '')),
    price,
    prevClose,
    open: lastBar?.open ?? price,
    dayHigh:
      typeof meta.regularMarketDayHigh === 'number'
        ? Number(meta.regularMarketDayHigh.toFixed(2))
        : lastBar?.high ?? price,
    dayLow:
      typeof meta.regularMarketDayLow === 'number'
        ? Number(meta.regularMarketDayLow.toFixed(2))
        : lastBar?.low ?? price,
    week52High:
      typeof meta.fiftyTwoWeekHigh === 'number'
        ? Number(meta.fiftyTwoWeekHigh.toFixed(2))
        : price,
    week52Low:
      typeof meta.fiftyTwoWeekLow === 'number'
        ? Number(meta.fiftyTwoWeekLow.toFixed(2))
        : price,
    volume:
      typeof meta.regularMarketVolume === 'number'
        ? Math.round(meta.regularMarketVolume)
        : lastBar?.volume ?? 0,
    marketTime:
      typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime * 1000 : Date.now(),
    bars,
  };

  setCached(cacheKey, parsed, isIntraday ? 15_000 : 60_000);
  return parsed;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  // Batch real-time quotes + 1M sparkline closes for watchlist
  app.get('/api/market/quotes', async (req, res) => {
    try {
      const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
      const symbols = raw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s))
        .slice(0, 25);

      if (symbols.length === 0) {
        return res.status(400).json({ error: 'Provide at least one valid stock symbol.' });
      }

      const settled = await Promise.allSettled(
        symbols.map((sym) => fetchYahooChart(sym, '1mo', '1d'))
      );

      const quotes: Record<string, ParsedChartResult> = {};
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value && outcome.value.price > 0) {
          quotes[outcome.value.symbol] = outcome.value;
        }
      }

      return res.json({
        source: 'Yahoo Finance',
        asOf: Date.now(),
        quotes,
      });
    } catch {
      return res.status(502).json({ error: 'Unable to fetch market quotes right now.' });
    }
  });

  // Historical OHLCV chart bars for any valid ticker + allowlisted timeframe
  app.get('/api/market/chart', async (req, res) => {
    try {
      const symbol =
        typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
      const timeframe =
        typeof req.query.timeframe === 'string' ? req.query.timeframe.trim().toUpperCase() : '6M';

      if (!SYMBOL_RE.test(symbol)) {
        return res.status(400).json({ error: 'Invalid ticker symbol.' });
      }

      const spec = ALLOWED_TIMEFRAMES[timeframe];
      if (!spec) {
        return res.status(400).json({ error: 'Invalid timeframe.' });
      }

      const data = await fetchYahooChart(symbol, spec.range, spec.interval);
      if (!data || data.bars.length === 0) {
        return res.status(404).json({ error: `No chart data found for ${symbol}.` });
      }

      return res.json({
        source: 'Yahoo Finance',
        asOf: Date.now(),
        timeframe,
        ...data,
      });
    } catch {
      return res.status(502).json({ error: 'Unable to fetch chart history right now.' });
    }
  });

  // Live ticker search so users can add any real equity or ETF to the terminal
  app.get('/api/market/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
      if (q.length < 1) {
        return res.json({ results: [] });
      }

      const cacheKey = `search:${q.toLowerCase()}`;
      const cached = getCached<unknown[]>(cacheKey);
      if (cached) return res.json({ results: cached });

      const url = `${YAHOO_HOST}/v1/finance/search?q=${encodeURIComponent(
        q
      )}&quotesCount=6&newsCount=0`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        return res.json({ results: [] });
      }

      const json = (await response.json()) as {
        quotes?: Array<{
          symbol?: string;
          shortname?: string;
          longname?: string;
          exchDisp?: string;
          quoteType?: string;
          sector?: string;
          industry?: string;
        }>;
      };

      const results = (json.quotes ?? [])
        .filter(
          (item) =>
            item.symbol &&
            SYMBOL_RE.test(item.symbol.toUpperCase()) &&
            (item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
        )
        .map((item) => ({
          symbol: item.symbol!.toUpperCase(),
          name: item.longname || item.shortname || item.symbol!,
          exchange: normalizeExchange(item.exchDisp),
          quoteType: item.quoteType,
          sector: item.sector || (item.quoteType === 'ETF' ? 'ETF' : 'Technology'),
          industry: item.industry || (item.quoteType === 'ETF' ? 'Exchange Traded Fund' : 'Public Equity'),
        }));

      setCached(cacheKey, results, 300_000);
      return res.json({ results });
    } catch {
      return res.json({ results: [] });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Terminal listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
