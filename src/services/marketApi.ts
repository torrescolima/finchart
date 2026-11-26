import { OhlcBar } from '../types/market';

export interface LiveQuotePayload {
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
  bars: OhlcBar[];
}

export interface LiveSearchResult {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  quoteType: string;
  sector: string;
  industry: string;
}

export async function fetchLiveQuotes(
  symbols: string[]
): Promise<{ asOf: number; source: string; quotes: Record<string, LiveQuotePayload> } | null> {
  if (symbols.length === 0) return null;
  try {
    const res = await fetch(
      `/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`
    );
    if (!res.ok) return null;
    return (await res.json()) as {
      asOf: number;
      source: string;
      quotes: Record<string, LiveQuotePayload>;
    };
  } catch {
    return null;
  }
}

export async function fetchLiveChart(
  symbol: string,
  timeframe: string
): Promise<(LiveQuotePayload & { asOf: number; source: string; timeframe: string }) | null> {
  try {
    const res = await fetch(
      `/api/market/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(
        timeframe
      )}`
    );
    if (!res.ok) return null;
    return (await res.json()) as LiveQuotePayload & {
      asOf: number;
      source: string;
      timeframe: string;
    };
  } catch {
    return null;
  }
}

export async function searchLiveTickers(query: string): Promise<LiveSearchResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  try {
    const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: LiveSearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}
