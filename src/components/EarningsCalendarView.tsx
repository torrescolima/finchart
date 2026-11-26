import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bell,
  Download,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchEarningsCalendar } from '../services/marketApi';
import { EarningsEvent, StockProfile } from '../types/market';
import { downloadCsv } from '../utils/financeMath';

interface EarningsCalendarViewProps {
  watchlistName: string;
  watchlistSymbols: string[];
  allStocks: Record<string, StockProfile>;
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  onSelectSymbolForChart: (symbol: string) => void;
  onSelectSymbolForFundamentals: (symbol: string) => void;
  onQuickAlert: (symbol: string, currentPrice: number) => void;
}

type HorizonFilter = 'ALL' | '14D' | '30D' | '90D';
type ScopeFilter = 'watchlist' | 'starred' | 'all';
type SortKey =
  | 'earningsTimestamp'
  | 'symbol'
  | 'price'
  | 'epsEstimate'
  | 'revenueEstimate'
  | 'lastQuarterSurprisePct'
  | 'beta'
  | 'histVolPct';

function formatRevenueUsd(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString('en-US')}`;
}

function compute20dAnnualizedVol(stock: StockProfile | undefined): number {
  if (!stock || stock.bars.length < 6) return 24;
  const slice = stock.bars.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) {
      returns.push(Math.log(slice[i].close / slice[i - 1].close));
    }
  }
  if (returns.length < 3) return 24;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Number((Math.sqrt(variance * 252) * 100).toFixed(1));
}

function formatCountdown(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 0) return `${Math.abs(daysUntil)}d ago`;
  return `In ${daysUntil}d`;
}

export function EarningsCalendarView({
  watchlistName,
  watchlistSymbols,
  allStocks,
  favorites,
  onToggleFavorite,
  onSelectSymbolForChart,
  onSelectSymbolForFundamentals,
  onQuickAlert,
}: EarningsCalendarViewProps) {
  const [scope, setScope] = useState<ScopeFilter>('watchlist');
  const [horizon, setHorizon] = useState<HorizonFilter>('ALL');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('earningsTimestamp');
  const [sortAsc, setSortAsc] = useState(true);
  const [events, setEvents] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);

  const targetSymbols = useMemo(() => {
    if (scope === 'watchlist') return watchlistSymbols;
    if (scope === 'starred') return favorites.filter((s) => Boolean(allStocks[s]));
    return Object.keys(allStocks);
  }, [scope, watchlistSymbols, favorites, allStocks]);

  const symbolKey = useMemo(() => [...targetSymbols].sort().join(','), [targetSymbols]);

  const loadEarnings = useCallback(async () => {
    if (targetSymbols.length === 0) {
      setEvents([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchEarningsCalendar(targetSymbols);
    setLoading(false);
    if (!result) {
      setError('Unable to reach the live earnings calendar right now. Try refreshing shortly.');
      return;
    }
    setEvents(result.events);
    setAsOf(result.asOf);
  }, [symbolKey]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const nowStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [asOf]);

  const enrichedRows = useMemo(() => {
    return events.map((ev) => {
      const stock = allStocks[ev.symbol];
      const eventDayMs = new Date(`${ev.earningsDate}T00:00:00`).getTime();
      const daysUntil = Math.round((eventDayMs - nowStartMs) / 86_400_000);
      const changePct = stock
        ? ((stock.price - stock.prevClose) / Math.max(0.01, stock.prevClose)) * 100
        : 0;
      const histVolPct = compute20dAnnualizedVol(stock);
      return {
        ev,
        stock,
        daysUntil,
        changePct,
        histVolPct,
      };
    });
  }, [events, allStocks, nowStartMs]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrichedRows
      .filter((row) => {
        if (horizon === '14D' && (row.daysUntil < 0 || row.daysUntil > 14)) return false;
        if (horizon === '30D' && (row.daysUntil < 0 || row.daysUntil > 30)) return false;
        if (horizon === '90D' && (row.daysUntil < 0 || row.daysUntil > 90)) return false;
        if (q) {
          const name = row.stock?.name.toLowerCase() ?? '';
          const sector = row.stock?.sector.toLowerCase() ?? '';
          if (
            !row.ev.symbol.toLowerCase().includes(q) &&
            !name.includes(q) &&
            !sector.includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortKey === 'earningsTimestamp') {
          diff = a.ev.earningsTimestamp - b.ev.earningsTimestamp;
        } else if (sortKey === 'symbol') {
          diff = a.ev.symbol.localeCompare(b.ev.symbol);
        } else if (sortKey === 'price') {
          diff = (a.stock?.price ?? 0) - (b.stock?.price ?? 0);
        } else if (sortKey === 'epsEstimate') {
          diff = (a.ev.epsEstimate ?? -9999) - (b.ev.epsEstimate ?? -9999);
        } else if (sortKey === 'revenueEstimate') {
          diff = (a.ev.revenueEstimate ?? -1) - (b.ev.revenueEstimate ?? -1);
        } else if (sortKey === 'lastQuarterSurprisePct') {
          diff = (a.ev.lastQuarterSurprisePct ?? -999) - (b.ev.lastQuarterSurprisePct ?? -999);
        } else if (sortKey === 'beta') {
          diff = (a.stock?.beta ?? 1) - (b.stock?.beta ?? 1);
        } else {
          diff = a.histVolPct - b.histVolPct;
        }
        return sortAsc ? diff : -diff;
      });
  }, [enrichedRows, horizon, query, sortKey, sortAsc]);

  const kpis = useMemo(() => {
    const upcoming = enrichedRows
      .filter((r) => r.daysUntil >= 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    const nextCatalyst = upcoming[0] ?? null;
    const within14 = upcoming.filter((r) => r.daysUntil <= 14).length;
    const within30 = upcoming.filter((r) => r.daysUntil <= 30).length;

    let totalBeats = 0;
    let totalQuarters = 0;
    for (const r of enrichedRows) {
      totalBeats += r.ev.beatCount;
      totalQuarters += r.ev.historyCount;
    }
    const beatRatePct = totalQuarters > 0 ? (totalBeats / totalQuarters) * 100 : 0;

    return { nextCatalyst, within14, within30, beatRatePct, totalQuarters };
  }, [enrichedRows]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === 'earningsTimestamp' || key === 'symbol');
    }
  };

  const handleExportCsv = () => {
    downloadCsv(
      'meridian_earnings_calendar.csv',
      [
        'Report Date',
        'Status',
        'Days Until',
        'Symbol',
        'Company',
        'Last Price ($)',
        'EPS Est ($)',
        'EPS Low ($)',
        'EPS High ($)',
        'Revenue Est ($)',
        'Last Qtr Surprise (%)',
        '4Q Beats',
        'Beta',
        '20D Hist Vol (%)',
      ],
      filteredRows.map((r) => [
        r.ev.earningsDate,
        r.ev.isEstimate ? 'Estimated' : 'Confirmed',
        r.daysUntil,
        r.ev.symbol,
        r.stock?.name ?? r.ev.symbol,
        r.stock ? r.stock.price.toFixed(2) : '',
        r.ev.epsEstimate ?? '',
        r.ev.epsLow ?? '',
        r.ev.epsHigh ?? '',
        r.ev.revenueEstimate ?? '',
        r.ev.lastQuarterSurprisePct ?? '',
        `${r.ev.beatCount}/${r.ev.historyCount}`,
        r.stock ? r.stock.beta.toFixed(2) : '',
        r.histVolPct.toFixed(1),
      ])
    );
  };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-5 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#D6E2F0] dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#012169] dark:text-white">
            Earnings Calendar &amp; Volatility Catalysts
          </h1>
          <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-0.5">
            Live upcoming corporate earnings dates, consensus EPS/revenue estimates, and historical beat rates for{' '}
            <span className="font-semibold text-[#012169] dark:text-slate-200">
              {scope === 'watchlist'
                ? watchlistName
                : scope === 'starred'
                ? 'Starred Tickers'
                : 'All Market'}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadEarnings}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-[#012169] dark:text-slate-100 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Dates</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#012169] hover:bg-[#0052C2] text-white disabled:opacity-50 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Calendar CSV</span>
          </button>
        </div>
      </div>

      {/* 4-Column Catalyst KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Next Upcoming Catalyst</div>
          {kpis.nextCatalyst ? (
            <>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
                {kpis.nextCatalyst.ev.symbol}
                <span className="ml-2 text-sm font-normal text-[#0052C2] dark:text-blue-400">
                  {formatCountdown(kpis.nextCatalyst.daysUntil)}
                </span>
              </div>
              <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {kpis.nextCatalyst.ev.earningsDate} ·{' '}
                {kpis.nextCatalyst.ev.isEstimate ? 'Estimated' : 'Confirmed'}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-xl font-semibold font-mono text-slate-400">—</div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {loading ? 'Loading schedule...' : 'No upcoming dates'}
              </div>
            </>
          )}
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Imminent (Next 14 Days)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {kpis.within14}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            High-priority volatility window
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Near-Term (Next 30 Days)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {kpis.within30}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Scheduled from {targetSymbols.length} watchlist symbols
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Watchlist 4Q Beat Rate</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {kpis.totalQuarters > 0 ? `${kpis.beatRatePct.toFixed(1)}%` : '—'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Across {kpis.totalQuarters} recent quarterly reports
          </div>
        </div>
      </div>

      {/* Filter & Scope Controls */}
      <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md bg-[#F4F7FB] dark:bg-[#141B29] p-0.5 border border-[#D6E2F0] dark:border-slate-800">
            {(
              [
                { id: 'watchlist', label: `Current Watchlist (${watchlistSymbols.length})` },
                { id: 'starred', label: `Starred (${favorites.length})` },
                { id: 'all', label: 'All Universe' },
              ] as { id: ScopeFilter; label: string }[]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  scope === s.id
                    ? 'bg-[#012169] text-white dark:bg-[#0052C2]'
                    : 'text-[#334E73] dark:text-slate-400 hover:text-[#012169] dark:hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-md bg-[#F4F7FB] dark:bg-[#141B29] p-0.5 border border-[#D6E2F0] dark:border-slate-800">
            {(
              [
                { id: 'ALL', label: 'All Dates' },
                { id: '14D', label: '14D' },
                { id: '30D', label: '30D' },
                { id: '90D', label: '90D' },
              ] as { id: HorizonFilter; label: string }[]
            ).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHorizon(h.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  horizon === h.id
                    ? 'bg-white dark:bg-slate-700 text-[#012169] dark:text-white shadow-xs'
                    : 'text-[#5A7190] dark:text-slate-400 hover:text-[#012169] dark:hover:text-white'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol or sector..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100 focus:outline-none focus:border-[#0052C2]"
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 rounded-lg px-4 py-3 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadEarnings}
            className="font-semibold underline ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Earnings Table */}
      <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
            Upcoming Corporate Earnings ({filteredRows.length})
          </h2>
          <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
            ETFs without corporate earnings are automatically excluded · Click any row to open chart
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                <th className="py-2.5 px-3 text-left font-medium w-8" aria-label="Favorite" />
                {(
                  [
                    { key: 'earningsTimestamp', label: 'Report Date', align: 'left' },
                    { key: 'symbol', label: 'Symbol / Company', align: 'left' },
                    { key: 'price', label: 'Last / 1D', align: 'right' },
                    { key: 'epsEstimate', label: 'EPS Est (Range)', align: 'right' },
                    { key: 'revenueEstimate', label: 'Rev Est', align: 'right' },
                    { key: 'lastQuarterSurprisePct', label: 'Last Surprise', align: 'right' },
                    { key: 'beta', label: 'Beta', align: 'right' },
                    { key: 'histVolPct', label: '20D Vol', align: 'right' },
                  ] as { key: SortKey; label: string; align: 'left' | 'right' }[]
                ).map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      className={`py-2.5 px-3 font-medium whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="inline-flex items-center gap-1 hover:text-[#012169] dark:hover:text-white"
                      >
                        <span>{col.label}</span>
                        {active ? (
                          sortAsc ? (
                            <ArrowUp className="w-3 h-3 text-[#0052C2]" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-[#0052C2]" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    </th>
                  );
                })}
                <th className="py-2.5 px-4 text-right font-medium">Catalyst Tools</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF3FA] dark:divide-slate-800/60 font-mono tabular-nums">
              {loading && events.length === 0 && (
                <>
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td colSpan={10} className="py-3.5 px-4">
                        <div className="h-4 w-full rounded bg-slate-100 dark:bg-slate-800/70" />
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {!loading &&
                filteredRows.map((row) => {
                  const { ev, stock, daysUntil, changePct, histVolPct } = row;
                  const isFav = favorites.includes(ev.symbol);
                  const isImminent = daysUntil >= 0 && daysUntil <= 14;
                  const surprise = ev.lastQuarterSurprisePct;

                  return (
                    <tr
                      key={ev.symbol}
                      onClick={() => onSelectSymbolForChart(ev.symbol)}
                      className="cursor-pointer hover:bg-[#F5F9FF] dark:hover:bg-[#141B29] transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(ev.symbol);
                          }}
                          aria-label={`Star ${ev.symbol}`}
                          className={`p-0.5 rounded ${
                            isFav
                              ? 'text-[#0052C2] dark:text-amber-400'
                              : 'text-slate-300 dark:text-slate-600 hover:text-[#0052C2]'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-[#012169] dark:text-white">
                          {ev.earningsDate}
                          {ev.earningsDateEnd ? ` – ${ev.earningsDateEnd.slice(5)}` : ''}
                        </div>
                        <div className="font-sans text-[11px] flex items-center gap-1.5">
                          <span
                            className={
                              isImminent
                                ? 'font-semibold text-amber-700 dark:text-amber-400'
                                : 'text-[#5A7190] dark:text-slate-400'
                            }
                          >
                            {formatCountdown(daysUntil)}
                          </span>
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                            ·
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {ev.isEstimate ? 'Est.' : 'Confirmed'}
                          </span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[#012169] dark:text-white">
                            {ev.symbol}
                          </span>
                          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[165px]">
                            {stock?.name ?? ev.symbol}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {stock?.sector ?? 'Equity'}
                          {ev.historyCount > 0 && ` · ${ev.beatCount}/${ev.historyCount} 4Q beats`}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {stock ? (
                          <>
                            <div className="font-medium text-[#0A1F44] dark:text-slate-100">
                              ${stock.price.toFixed(2)}
                            </div>
                            <div
                              className={`text-[11px] ${
                                changePct >= 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {changePct >= 0 ? '+' : ''}
                              {changePct.toFixed(2)}%
                            </div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="font-medium text-[#0A1F44] dark:text-slate-100">
                          {ev.epsEstimate !== null ? `$${ev.epsEstimate.toFixed(2)}` : '—'}
                        </div>
                        {ev.epsLow !== null && ev.epsHigh !== null && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            ${ev.epsLow.toFixed(2)} – ${ev.epsHigh.toFixed(2)}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatRevenueUsd(ev.revenueEstimate)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {surprise !== null ? (
                          <div>
                            <div
                              className={`font-medium ${
                                surprise >= 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {surprise >= 0 ? '+' : ''}
                              {surprise.toFixed(2)}%
                            </div>
                            {ev.lastQuarterEpsActual !== null &&
                              ev.lastQuarterEpsEstimate !== null && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  ${ev.lastQuarterEpsActual.toFixed(2)} vs $
                                  {ev.lastQuarterEpsEstimate.toFixed(2)}
                                </div>
                              )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {stock ? `${stock.beta.toFixed(2)}x` : '—'}
                      </td>

                      <td
                        className={`py-2.5 px-3 text-right font-medium ${
                          histVolPct >= 40
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {histVolPct.toFixed(1)}%
                      </td>

                      <td className="py-2.5 px-4 text-right font-sans whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {stock && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onQuickAlert(ev.symbol, stock.price);
                              }}
                              title={`Arm +5% pre-earnings price alert for ${ev.symbol}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-[#C6D6EA] dark:border-slate-700 text-[#012169] dark:text-slate-200 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                            >
                              <Bell className="w-3 h-3 text-[#0052C2] dark:text-blue-400" />
                              <span>Alert</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectSymbolForFundamentals(ev.symbol);
                            }}
                            className="px-2 py-1 text-[11px] font-medium rounded border border-[#C6D6EA] dark:border-slate-700 text-[#0052C2] dark:text-blue-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                          >
                            Filings
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-10 text-center font-sans text-xs text-slate-500">
                    No upcoming earnings dates matched your current watchlist and timeframe filter.
                    {horizon !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setHorizon('ALL')}
                        className="ml-2 text-[#0052C2] dark:text-blue-400 font-semibold hover:underline"
                      >
                        Show all upcoming dates
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
