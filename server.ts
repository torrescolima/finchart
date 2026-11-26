import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  getUserWorkspace,
  replaceUserAlerts,
  replaceUserHoldings,
  replaceUserJournal,
  upsertUserFinancialPlan,
  upsertUserPreferences,
} from './src/db/repository.ts';
import {
  acceptUserTerms,
  getOrCreateUser,
  getUserProfile,
  setUserStripeCustomerId,
  syncUserSubscription,
} from './src/db/users.ts';
import { getTierLimits } from './src/lib/entitlements.ts';
import {
  fetchCommercialChart,
  fetchCommercialEarnings,
  fetchCommercialNews,
  fetchCommercialQuote,
  getActiveMarketDataSourceLabel,
} from './src/lib/marketDataProvider.ts';
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeCustomer,
  ensureStripeCatalog,
  getProIntroCouponId,
  getStripePriceIdForTier,
  isStripeConfigured,
  normalizeStripeStatus,
  resolvePlanTierFromPriceId,
  retrieveStripeCheckoutSession,
  sanitizeRedirectBaseUrl,
  verifyStripeWebhookSignature,
} from './src/lib/stripe.ts';
import type {
  CustomWatchlist,
  FinancialPlanInputs,
  PlanTier,
  PortfolioHolding,
  PriceAlert,
  SubscriptionStatus,
  TradeJournalEntry,
} from './src/types/market.ts';

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

function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || '';
  if (!raw.trim()) return false;
  const normalized = email.trim().toLowerCase();
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

async function resolveEffectivePlanTier(
  uid: string,
  email?: string | null
): Promise<PlanTier> {
  if (isOwnerEmail(email)) return 'advisor';
  const record = await getUserProfile(uid);
  if (!record) return 'free';
  const activeSub =
    record.subscriptionStatus === 'active' || record.subscriptionStatus === 'trialing';
  if (!activeSub) return 'free';
  if (record.planTier === 'advisor') return 'advisor';
  if (record.planTier === 'pro') return 'pro';
  return 'free';
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

interface YahooSession {
  cookie: string;
  crumb: string;
  expiresAt: number;
}

let yahooSession: YahooSession | null = null;

async function getYahooSession(forceRefresh = false): Promise<YahooSession | null> {
  if (!forceRefresh && yahooSession && Date.now() < yahooSession.expiresAt) {
    return yahooSession;
  }
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    const rawCookies =
      typeof cookieRes.headers.getSetCookie === 'function'
        ? cookieRes.headers.getSetCookie()
        : [cookieRes.headers.get('set-cookie')].filter((v): v is string => Boolean(v));
    const cookie = rawCookies
      .map((c) => c.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
    if (!cookie) return null;

    const crumbRes = await fetch(`${YAHOO_HOST}/v1/test/getcrumb`, {
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return null;

    yahooSession = {
      cookie,
      crumb,
      expiresAt: Date.now() + 25 * 60_000,
    };
    return yahooSession;
  } catch {
    return null;
  }
}

interface ParsedEarningsEvent {
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

async function fetchYahooEarnings(
  symbol: string,
  session: YahooSession
): Promise<ParsedEarningsEvent | null> {
  const yahooSym = toYahooSymbol(symbol);
  const cacheKey = `earnings:${yahooSym}`;
  const cached = getCached<ParsedEarningsEvent | { empty: true }>(cacheKey);
  if (cached) {
    return 'empty' in cached ? null : cached;
  }

  const url = `${YAHOO_HOST}/v10/finance/quoteSummary/${encodeURIComponent(
    yahooSym
  )}?modules=calendarEvents,earningsHistory&crumb=${encodeURIComponent(session.crumb)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      Cookie: session.cookie,
    },
    signal: AbortSignal.timeout(7000),
  });

  if (response.status === 401 || response.status === 403) {
    yahooSession = null;
    return null;
  }
  if (!response.ok) {
    setCached(cacheKey, { empty: true }, 10 * 60_000);
    return null;
  }

  const json = (await response.json()) as {
    quoteSummary?: {
      result?: Array<{
        calendarEvents?: {
          earnings?: {
            earningsDate?: Array<{ raw?: number; fmt?: string }>;
            isEarningsDateEstimate?: boolean;
            earningsAverage?: { raw?: number };
            earningsLow?: { raw?: number };
            earningsHigh?: { raw?: number };
            revenueAverage?: { raw?: number };
          };
        };
        earningsHistory?: {
          history?: Array<{
            epsActual?: { raw?: number };
            epsEstimate?: { raw?: number };
            surprisePercent?: { raw?: number };
          }>;
        };
      }>;
    };
  };

  const result = json.quoteSummary?.result?.[0];
  const cal = result?.calendarEvents?.earnings;
  const dateList = cal?.earningsDate ?? [];
  const primaryDate = dateList[0];

  if (!primaryDate || typeof primaryDate.raw !== 'number') {
    setCached(cacheKey, { empty: true }, 15 * 60_000);
    return null;
  }

  const tsMs = primaryDate.raw * 1000;
  const formattedDate =
    typeof primaryDate.fmt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(primaryDate.fmt)
      ? primaryDate.fmt
      : new Date(tsMs).toISOString().slice(0, 10);

  const endItem = dateList[1];
  const earningsDateEnd =
    endItem && typeof endItem.fmt === 'string' && endItem.fmt !== formattedDate
      ? endItem.fmt
      : null;

  const history = (result?.earningsHistory?.history ?? []).filter(
    (h) => typeof h.epsActual?.raw === 'number' && typeof h.epsEstimate?.raw === 'number'
  );
  const lastQ = history[history.length - 1];
  const beatCount = history.filter(
    (h) => (h.epsActual?.raw ?? 0) >= (h.epsEstimate?.raw ?? 0)
  ).length;

  const parsed: ParsedEarningsEvent = {
    symbol,
    earningsDate: formattedDate,
    earningsTimestamp: tsMs,
    earningsDateEnd,
    isEstimate: Boolean(cal?.isEarningsDateEstimate),
    epsEstimate:
      typeof cal?.earningsAverage?.raw === 'number'
        ? Number(cal.earningsAverage.raw.toFixed(2))
        : null,
    epsLow:
      typeof cal?.earningsLow?.raw === 'number'
        ? Number(cal.earningsLow.raw.toFixed(2))
        : null,
    epsHigh:
      typeof cal?.earningsHigh?.raw === 'number'
        ? Number(cal.earningsHigh.raw.toFixed(2))
        : null,
    revenueEstimate:
      typeof cal?.revenueAverage?.raw === 'number'
        ? Math.round(cal.revenueAverage.raw)
        : null,
    lastQuarterEpsActual:
      typeof lastQ?.epsActual?.raw === 'number'
        ? Number(lastQ.epsActual.raw.toFixed(2))
        : null,
    lastQuarterEpsEstimate:
      typeof lastQ?.epsEstimate?.raw === 'number'
        ? Number(lastQ.epsEstimate.raw.toFixed(2))
        : null,
    lastQuarterSurprisePct:
      typeof lastQ?.surprisePercent?.raw === 'number'
        ? Number((lastQ.surprisePercent.raw * 100).toFixed(2))
        : null,
    beatCount,
    historyCount: history.length,
  };

  setCached(cacheKey, parsed, 15 * 60_000);
  return parsed;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  // Stripe Webhook MUST be mounted before express.json() so HMAC verification uses the exact raw body
  app.post(
    '/api/billing/webhook',
    express.raw({ type: 'application/json', limit: '512kb' }),
    async (req, res) => {
      try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
          return res.status(503).json({ error: 'Billing webhook is not configured.' });
        }

        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const signature = req.header('stripe-signature');
        if (!verifyStripeWebhookSignature(rawBody, signature, webhookSecret)) {
          return res.status(400).json({ error: 'Invalid webhook signature.' });
        }

        const event = JSON.parse(rawBody.toString('utf8')) as {
          type?: string;
          data?: {
            object?: Record<string, unknown>;
          };
        };

        const obj = event.data?.object ?? {};

        if (event.type === 'checkout.session.completed') {
          const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
          const uid =
            typeof obj.client_reference_id === 'string'
              ? obj.client_reference_id
              : typeof metadata.user_uid === 'string'
              ? metadata.user_uid
              : null;
          const stripeCustomerId =
            typeof obj.customer === 'string' ? obj.customer : null;
          const stripeSubscriptionId =
            typeof obj.subscription === 'string' ? obj.subscription : null;
          const rawTier =
            metadata.plan_tier === 'advisor'
              ? 'advisor'
              : metadata.plan_tier === 'pro'
              ? 'pro'
              : 'pro';

          await syncUserSubscription({
            uid,
            stripeCustomerId,
            stripeSubscriptionId,
            planTier: rawTier,
            subscriptionStatus: 'active',
          });
        } else if (
          event.type === 'customer.subscription.created' ||
          event.type === 'customer.subscription.updated' ||
          event.type === 'customer.subscription.deleted'
        ) {
          const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
          const uid = typeof metadata.user_uid === 'string' ? metadata.user_uid : null;
          const stripeCustomerId =
            typeof obj.customer === 'string' ? obj.customer : null;
          const stripeSubscriptionId = typeof obj.id === 'string' ? obj.id : null;
          const status = normalizeStripeStatus(
            typeof obj.status === 'string' ? obj.status : null
          );
          const periodEndSec =
            typeof obj.current_period_end === 'number' ? obj.current_period_end : null;
          const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)
            ?.data;
          const firstPriceId = items?.[0]?.price?.id ?? null;

          const isEntitled = status === 'active' || status === 'trialing';
          const resolvedTier: PlanTier = isEntitled
            ? metadata.plan_tier === 'advisor' || metadata.plan_tier === 'pro'
              ? (metadata.plan_tier as PlanTier)
              : resolvePlanTierFromPriceId(firstPriceId)
            : 'free';

          await syncUserSubscription({
            uid,
            stripeCustomerId,
            stripeSubscriptionId,
            planTier: resolvedTier,
            subscriptionStatus: status,
            currentPeriodEnd: periodEndSec ? periodEndSec * 1000 : null,
          });
        }

        return res.json({ received: true });
      } catch (error) {
        console.error('Stripe webhook processing error:', error);
        return res.status(400).json({ error: 'Webhook processing failed.' });
      }
    }
  );

  app.use(express.json({ limit: '1mb' }));

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
        symbols.map(async (sym) => {
          const commercial = await fetchCommercialQuote(sym);
          if (commercial && commercial.price > 0) return commercial;
          return fetchYahooChart(sym, '1mo', '1d');
        })
      );

      const quotes: Record<string, ParsedChartResult> = {};
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value && outcome.value.price > 0) {
          quotes[outcome.value.symbol] = outcome.value;
        }
      }

      return res.json({
        source: getActiveMarketDataSourceLabel(),
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

      const commercial = await fetchCommercialChart(symbol, timeframe);
      const data =
        commercial && commercial.bars.length > 0
          ? commercial
          : await fetchYahooChart(symbol, spec.range, spec.interval);

      if (!data || data.bars.length === 0) {
        return res.status(404).json({ error: `No chart data found for ${symbol}.` });
      }

      return res.json({
        source: commercial ? commercial.providerLabel : 'Yahoo Finance',
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

  // Live ticker news headlines from Yahoo Finance (sanitized links)
  app.get('/api/market/news', async (req, res) => {
    try {
      const symbol =
        typeof req.query.symbol === 'string'
          ? req.query.symbol.trim().toUpperCase()
          : '';
      if (!SYMBOL_RE.test(symbol)) {
        return res.status(400).json({ error: 'Invalid ticker symbol.' });
      }

      const cacheKey = `news:${symbol}`;
      const cached = getCached<unknown[]>(cacheKey);
      if (cached) return res.json({ symbol, news: cached });

      const commercialNews = await fetchCommercialNews(symbol);
      if (commercialNews && commercialNews.length > 0) {
        setCached(cacheKey, commercialNews, 300_000);
        return res.json({ symbol, source: 'Finnhub', news: commercialNews });
      }

      const url = `${YAHOO_HOST}/v1/finance/search?q=${encodeURIComponent(
        toYahooSymbol(symbol)
      )}&quotesCount=1&newsCount=8`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        return res.json({ symbol, news: [] });
      }

      const json = (await response.json()) as {
        news?: Array<{
          title?: string;
          publisher?: string;
          link?: string;
          providerPublishTime?: number;
          relatedTickers?: string[];
        }>;
      };

      const news = (json.news ?? [])
        .filter(
          (n) =>
            typeof n.title === 'string' &&
            n.title.trim().length > 0 &&
            typeof n.link === 'string' &&
            n.link.startsWith('https://')
        )
        .slice(0, 8)
        .map((n) => ({
          title: n.title!.trim(),
          publisher: (n.publisher || 'Market Wire').trim(),
          link: n.link!,
          publishedAt:
            typeof n.providerPublishTime === 'number'
              ? n.providerPublishTime * 1000
              : Date.now(),
          relatedTickers: Array.isArray(n.relatedTickers)
            ? n.relatedTickers
                .filter((t): t is string => typeof t === 'string' && SYMBOL_RE.test(t.toUpperCase()))
                .slice(0, 5)
            : [],
        }));

      setCached(cacheKey, news, 300_000);
      return res.json({ symbol, news });
    } catch {
      return res.json({ news: [] });
    }
  });

  // Live upcoming earnings calendar dates for watchlist symbols
  app.get('/api/market/earnings', async (req, res) => {
    try {
      const raw = typeof req.query.symbols === 'string' ? req.query.symbols : '';
      const symbols = Array.from(
        new Set(
          raw
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => SYMBOL_RE.test(s))
        )
      ).slice(0, 30);

      if (symbols.length === 0) {
        return res.status(400).json({ error: 'Provide at least one valid stock symbol.' });
      }

      // Try Finnhub commercial earnings calendar first when configured, then fill missing symbols via Yahoo
      const finnhubSettled = await Promise.allSettled(
        symbols.map((sym) => fetchCommercialEarnings(sym))
      );

      const eventsBySym = new Map<string, ParsedEarningsEvent>();
      let usedCommercial = false;
      for (const outcome of finnhubSettled) {
        if (outcome.status === 'fulfilled' && outcome.value) {
          eventsBySym.set(outcome.value.symbol, outcome.value);
          usedCommercial = true;
        }
      }

      const missingSymbols = symbols.filter((sym) => !eventsBySym.has(sym));
      if (missingSymbols.length > 0) {
        let session = await getYahooSession(false);
        if (!session) {
          session = await getYahooSession(true);
        }
        if (session) {
          const yahooSettled = await Promise.allSettled(
            missingSymbols.map((sym) => fetchYahooEarnings(sym, session!))
          );
          for (const outcome of yahooSettled) {
            if (outcome.status === 'fulfilled' && outcome.value) {
              eventsBySym.set(outcome.value.symbol, outcome.value);
            }
          }
        }
      }

      const events = Array.from(eventsBySym.values()).sort(
        (a, b) => a.earningsTimestamp - b.earningsTimestamp
      );

      return res.json({
        source: usedCommercial ? 'Finnhub' : 'Yahoo Finance',
        asOf: Date.now(),
        events,
      });
    } catch {
      return res.status(502).json({ error: 'Unable to fetch earnings calendar right now.' });
    }
  });

  // Authenticated Cloud SQL workspace routes (strictly scoped to req.user.uid)
  app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const workspace = await getUserWorkspace(uid);
      return res.json(workspace);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load workspace.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace/holdings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawHoldings = req.body?.holdings;
      if (!Array.isArray(rawHoldings) || rawHoldings.length > 500) {
        return res.status(400).json({ error: 'Invalid holdings payload.' });
      }

      const sanitized: PortfolioHolding[] = [];
      const seenIds = new Set<string>();
      for (const item of rawHoldings) {
        if (!item || typeof item !== 'object') {
          return res.status(400).json({ error: 'Invalid holding entry.' });
        }
        const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
        const symbol =
          typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
        const shares = Number(item.shares);
        const avgCost = Number(item.avgCost);
        if (
          !id ||
          seenIds.has(id) ||
          !SYMBOL_RE.test(symbol) ||
          !Number.isFinite(shares) ||
          shares < 0 ||
          !Number.isFinite(avgCost) ||
          avgCost < 0
        ) {
          return res.status(400).json({ error: 'Invalid holding fields.' });
        }
        seenIds.add(id);
        sanitized.push({ id, symbol, shares, avgCost });
      }

      const saved = await replaceUserHoldings(uid, sanitized);
      return res.json({ holdings: saved });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save portfolio holdings.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace/alerts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawAlerts = req.body?.alerts;
      if (!Array.isArray(rawAlerts) || rawAlerts.length > 500) {
        return res.status(400).json({ error: 'Invalid alerts payload.' });
      }

      const sanitized: PriceAlert[] = [];
      const seenIds = new Set<string>();
      for (const item of rawAlerts) {
        if (!item || typeof item !== 'object') {
          return res.status(400).json({ error: 'Invalid alert entry.' });
        }
        const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
        const symbol =
          typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
        const condition =
          item.condition === 'above' || item.condition === 'below'
            ? item.condition
            : null;
        const targetPrice = Number(item.targetPrice);
        const note = typeof item.note === 'string' ? item.note.slice(0, 240) : '';
        const createdAt = Number(item.createdAt);
        const triggeredAt =
          item.triggeredAt === null || item.triggeredAt === undefined
            ? null
            : Number(item.triggeredAt);

        if (
          !id ||
          seenIds.has(id) ||
          !SYMBOL_RE.test(symbol) ||
          !condition ||
          !Number.isFinite(targetPrice) ||
          targetPrice <= 0 ||
          !Number.isFinite(createdAt) ||
          (triggeredAt !== null && !Number.isFinite(triggeredAt))
        ) {
          return res.status(400).json({ error: 'Invalid alert fields.' });
        }
        seenIds.add(id);
        sanitized.push({
          id,
          symbol,
          condition,
          targetPrice,
          note,
          createdAt: Math.round(createdAt),
          triggeredAt: triggeredAt === null ? null : Math.round(triggeredAt),
        });
      }

      const tier = await resolveEffectivePlanTier(uid, req.user?.email);
      const limits = getTierLimits(tier);
      const activeCount = sanitized.filter((a) => a.triggeredAt === null).length;
      if (activeCount > limits.maxActiveAlerts) {
        return res.status(403).json({
          error: `Individual plan supports up to ${limits.maxActiveAlerts} active price alerts. Upgrade to Pro Trader for unlimited alerts.`,
          requiredTier: 'pro',
        });
      }

      const saved = await replaceUserAlerts(uid, sanitized);
      return res.json({ alerts: saved });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save price alerts.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace/plan', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const plan = req.body?.plan as FinancialPlanInputs | undefined;
      if (
        !plan ||
        typeof plan !== 'object' ||
        typeof plan.currentAge !== 'number' ||
        typeof plan.retirementAge !== 'number' ||
        typeof plan.horizonAge !== 'number'
      ) {
        return res.status(400).json({ error: 'Invalid financial plan payload.' });
      }

      const saved = await upsertUserFinancialPlan(uid, plan);
      return res.json({ plan: saved });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save financial plan.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace/journal', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawEntries = req.body?.entries;
      if (!Array.isArray(rawEntries) || rawEntries.length > 1000) {
        return res.status(400).json({ error: 'Invalid trade journal payload.' });
      }

      const sanitized: TradeJournalEntry[] = [];
      const seenIds = new Set<string>();
      for (const item of rawEntries) {
        if (!item || typeof item !== 'object') {
          return res.status(400).json({ error: 'Invalid journal entry.' });
        }
        const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
        const symbol =
          typeof item.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
        const side =
          item.side === 'SHORT' || item.side === 'LONG' ? item.side : null;
        const entryDate =
          typeof item.entryDate === 'string' ? item.entryDate.slice(0, 20) : '';
        const exitDate =
          typeof item.exitDate === 'string' ? item.exitDate.slice(0, 20) : '';
        const entryPrice = Number(item.entryPrice);
        const exitPrice =
          item.exitPrice === null || item.exitPrice === undefined || item.exitPrice === ''
            ? null
            : Number(item.exitPrice);
        const shares = Number(item.shares);
        const setupTag =
          typeof item.setupTag === 'string'
            ? item.setupTag.trim().slice(0, 60) || 'General'
            : 'General';
        const notes = typeof item.notes === 'string' ? item.notes.slice(0, 1000) : '';
        const createdAt = Number(item.createdAt);

        if (
          !id ||
          seenIds.has(id) ||
          !SYMBOL_RE.test(symbol) ||
          !side ||
          !entryDate ||
          !Number.isFinite(entryPrice) ||
          entryPrice <= 0 ||
          (exitPrice !== null && (!Number.isFinite(exitPrice) || exitPrice <= 0)) ||
          !Number.isFinite(shares) ||
          shares <= 0 ||
          !Number.isFinite(createdAt)
        ) {
          return res.status(400).json({ error: 'Invalid trade journal fields.' });
        }
        seenIds.add(id);
        sanitized.push({
          id,
          symbol,
          side,
          entryDate,
          exitDate,
          entryPrice,
          exitPrice,
          shares,
          setupTag,
          notes,
          createdAt: Math.round(createdAt),
        });
      }

      const tier = await resolveEffectivePlanTier(uid, req.user?.email);
      const limits = getTierLimits(tier);
      if (sanitized.length > limits.maxJournalEntries) {
        return res.status(403).json({
          error: `Individual plan supports up to ${limits.maxJournalEntries} trade journal entries. Upgrade to Pro Trader for unlimited entries.`,
          requiredTier: 'pro',
        });
      }

      const saved = await replaceUserJournal(uid, sanitized);
      return res.json({ entries: saved });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save trade journal.';
      return res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace/preferences', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const rawFavorites = req.body?.favorites;
      const rawOrder = req.body?.watchlistOrder;
      const rawWatchlists = req.body?.watchlists;
      if (!Array.isArray(rawFavorites) || !Array.isArray(rawOrder)) {
        return res.status(400).json({ error: 'Invalid preferences payload.' });
      }

      const favorites = rawFavorites
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s))
        .slice(0, 100);

      const watchlistOrder = rawOrder
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => SYMBOL_RE.test(s))
        .slice(0, 150);

      const watchlists: CustomWatchlist[] = Array.isArray(rawWatchlists)
        ? rawWatchlists
            .filter((w): w is CustomWatchlist => Boolean(w && typeof w === 'object'))
            .slice(0, 20)
            .map((w) => ({
              id: typeof w.id === 'string' ? w.id.trim().slice(0, 60) : `wl-${Date.now()}`,
              name: typeof w.name === 'string' ? w.name.trim().slice(0, 40) || 'List' : 'List',
              symbols: Array.isArray(w.symbols)
                ? w.symbols
                    .filter((s): s is string => typeof s === 'string')
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => SYMBOL_RE.test(s))
                    .slice(0, 100)
                : [],
            }))
        : [];

      const tier = await resolveEffectivePlanTier(uid, req.user?.email);
      const limits = getTierLimits(tier);
      if (watchlists.length > limits.maxCustomWatchlists) {
        return res.status(403).json({
          error: `Individual plan supports up to ${limits.maxCustomWatchlists} custom watchlists. Upgrade to Pro Trader for unlimited watchlists.`,
          requiredTier: 'pro',
        });
      }

      const saved = await upsertUserPreferences(uid, favorites, watchlistOrder, watchlists);
      return res.json(saved);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to save watchlist preferences.';
      return res.status(500).json({ error: message });
    }
  });

  // Authenticated Account Profile, Entitlements & Compliance Routes
  app.get('/api/account/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      await ensureStripeCatalog();
      const record =
        (await getUserProfile(user.uid)) ??
        (await getOrCreateUser(user.uid, user.email ?? '', user.displayName ?? null));

      const effectiveTier = await resolveEffectivePlanTier(user.uid, user.email ?? record.email);
      const ownerOverride = isOwnerEmail(user.email ?? record.email);
      const subscriptionStatus: SubscriptionStatus = ownerOverride
        ? 'active'
        : record.subscriptionStatus === 'active' ||
          record.subscriptionStatus === 'trialing' ||
          record.subscriptionStatus === 'past_due' ||
          record.subscriptionStatus === 'canceled'
        ? record.subscriptionStatus
        : 'none';

      return res.json({
        uid: record.uid,
        email: record.email,
        displayName: record.displayName,
        planTier: effectiveTier,
        subscriptionStatus,
        currentPeriodEnd: record.currentPeriodEnd ?? null,
        termsAcceptedAt: record.termsAcceptedAt ? record.termsAcceptedAt.toISOString() : null,
        billingConfigured: isStripeConfigured(),
        marketDataSource: getActiveMarketDataSourceLabel(),
        hasStripeCustomer: Boolean(record.stripeCustomerId),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load account profile.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/account/accept-terms', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const updated = await acceptUserTerms(user.uid);
      return res.json({
        termsAcceptedAt: updated?.termsAcceptedAt
          ? updated.termsAcceptedAt.toISOString()
          : new Date().toISOString(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save terms acceptance.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/billing/checkout', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const tier = req.body?.tier === 'advisor' ? 'advisor' : req.body?.tier === 'pro' ? 'pro' : null;
      if (!tier) {
        return res.status(400).json({ error: 'Choose either the Pro or Advisor plan.' });
      }

      await ensureStripeCatalog();
      const priceId = getStripePriceIdForTier(tier);
      if (!isStripeConfigured() || !priceId) {
        return res.status(503).json({
          billingConfigured: false,
          error:
            'Stripe billing is not yet active in this environment. Configure STRIPE_SECRET_KEY in server secrets to enable live checkout.',
        });
      }

      const baseUrl = sanitizeRedirectBaseUrl(req.header('origin'));
      if (!baseUrl) {
        return res.status(400).json({ error: 'Unable to determine secure return URL.' });
      }

      const record =
        (await getUserProfile(user.uid)) ??
        (await getOrCreateUser(user.uid, user.email ?? '', user.displayName ?? null));

      let customerId = record.stripeCustomerId;
      if (!customerId) {
        const customer = await createStripeCustomer({
          uid: user.uid,
          email: record.email,
          displayName: record.displayName,
        });
        customerId = customer.id;
        await setUserStripeCustomerId(user.uid, customerId);
      }

      const eligibleForIntro =
        tier === 'pro' &&
        record.subscriptionStatus === 'none' &&
        !record.stripeSubscriptionId;
      const introCouponId = eligibleForIntro ? getProIntroCouponId() : null;

      const session = await createStripeCheckoutSession({
        customerId,
        priceId,
        uid: user.uid,
        tier,
        successUrl: `${baseUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/?billing=canceled`,
        introCouponId,
      });

      return res.json({ url: session.url });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start checkout session.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/billing/confirm', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const sessionId =
        typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing checkout session ID.' });
      }

      await ensureStripeCatalog();
      const session = await retrieveStripeCheckoutSession(sessionId);

      // Strict ownership verification against authenticated Firebase user
      const sessionUid = session.client_reference_id || session.metadata?.user_uid || null;
      if (sessionUid !== user.uid) {
        return res.status(403).json({ error: 'Checkout session does not belong to this account.' });
      }

      const paid =
        session.status === 'complete' ||
        session.payment_status === 'paid' ||
        session.payment_status === 'no_payment_required';
      if (!paid) {
        return res.status(400).json({ error: 'Checkout session is not completed yet.' });
      }

      const subObj =
        session.subscription && typeof session.subscription === 'object'
          ? session.subscription
          : null;
      const stripeSubscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : subObj?.id ?? null;
      const stripeCustomerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null;

      const subStatus = subObj?.status
        ? normalizeStripeStatus(subObj.status)
        : 'active';
      const firstPriceId = subObj?.items?.data?.[0]?.price?.id ?? null;
      const metaTier = session.metadata?.plan_tier || subObj?.metadata?.plan_tier;
      const resolvedTier: PlanTier =
        metaTier === 'advisor' || metaTier === 'pro'
          ? metaTier
          : resolvePlanTierFromPriceId(firstPriceId);
      const currentPeriodEnd =
        typeof subObj?.current_period_end === 'number'
          ? subObj.current_period_end * 1000
          : null;

      await syncUserSubscription({
        uid: user.uid,
        stripeCustomerId,
        stripeSubscriptionId,
        planTier: resolvedTier,
        subscriptionStatus: subStatus,
        currentPeriodEnd,
      });

      return res.json({
        planTier: resolvedTier,
        subscriptionStatus: subStatus,
        currentPeriodEnd,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to confirm checkout session.';
      return res.status(400).json({ error: message });
    }
  });

  app.post('/api/billing/portal', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!isStripeConfigured()) {
        return res.status(503).json({
          billingConfigured: false,
          error: 'Stripe billing portal is not configured yet.',
        });
      }

      const record = await getUserProfile(user.uid);
      if (!record?.stripeCustomerId) {
        return res.status(400).json({
          error: 'No active billing profile found yet. Choose a paid plan first.',
        });
      }

      const baseUrl = sanitizeRedirectBaseUrl(req.header('origin'));
      if (!baseUrl) {
        return res.status(400).json({ error: 'Unable to determine secure return URL.' });
      }

      const portal = await createStripeBillingPortalSession({
        customerId: record.stripeCustomerId,
        returnUrl: `${baseUrl}/`,
      });

      return res.json({ url: portal.url });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to open billing portal.';
      return res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  if (!IS_PROD) {
    // Serve a lightweight zero-WebSocket /@vite/client module so styles and modules load
    // cleanly in hosted preview iframes without throwing WebSocket connection errors.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const search = url.slice(pathname.length);
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '');
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
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

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Terminal listening on http://0.0.0.0:${PORT}`);
    void ensureStripeCatalog();
  });
}

startServer();
