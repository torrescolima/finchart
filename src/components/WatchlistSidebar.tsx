import { Moon, Plus, RefreshCw, Search, Star, Sun, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LiveSearchResult, searchLiveTickers } from '../services/marketApi';
import { Sector, StockProfile } from '../types/market';

interface WatchlistSidebarProps {
  stocks: StockProfile[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onAddTickerFromSearch: (item: LiveSearchResult) => Promise<void>;
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  isSyncing: boolean;
  lastSyncedAt: number | null;
  onManualRefresh: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

type FilterKey = 'ALL' | 'STAR' | Sector;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'STAR', label: 'Starred' },
  { key: 'Technology', label: 'Tech' },
  { key: 'Financials', label: 'Finance' },
  { key: 'ETF', label: 'ETF' },
];

function MiniSparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.001, max - min);
  const w = 44;
  const h = 18;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline
        fill="none"
        stroke={positive ? '#0F8A4B' : '#DC2626'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function WatchlistSidebar({
  stocks,
  selectedSymbol,
  onSelectSymbol,
  onAddTickerFromSearch,
  favorites,
  onToggleFavorite,
  autoRefresh,
  onToggleAutoRefresh,
  isSyncing,
  lastSyncedAt,
  onManualRefresh,
  isDark,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
}: WatchlistSidebarProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [remoteMatches, setRemoteMatches] = useState<LiveSearchResult[]>([]);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);

  const existingSet = useMemo(() => new Set(stocks.map((s) => s.symbol)), [stocks]);

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      if (filter === 'STAR' && !favorites.includes(s.symbol)) return false;
      if (filter !== 'ALL' && filter !== 'STAR' && s.sector !== filter) return false;
      if (!q) return true;
      return (
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
      );
    });
  }, [stocks, query, filter, favorites]);

  // Live Yahoo Finance ticker search for adding any symbol not yet in watchlist
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setRemoteMatches([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const results = await searchLiveTickers(q);
      if (!cancelled) {
        setRemoteMatches(results.filter((r) => !existingSet.has(r.symbol)).slice(0, 4));
      }
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, existingSet]);

  const syncedLabel = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Syncing';

  const content = (
    <aside className="w-[280px] shrink-0 h-full flex flex-col border-l border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#0E131D]">
      {/* Search Header */}
      <div className="p-3 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#101827] space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold tracking-wide text-[#012169] dark:text-slate-200">
            Market Watchlist
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {syncedLabel}
            </span>
            <button
              type="button"
              onClick={onManualRefresh}
              disabled={isSyncing}
              title="Refresh live quotes"
              aria-label="Refresh live quotes"
              className="p-1 rounded text-[#0052C2] dark:text-blue-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close watchlist"
              className="lg:hidden p-1 text-slate-400 hover:text-[#012169] dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#0052C2]/70 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter or search any ticker..."
            aria-label="Filter or add ticker"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#0052C2]"
          />
        </div>

        {/* Sector Filter Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-2 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#012169] text-white dark:bg-[#0052C2]'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800/70'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Column Headers */}
      <div className="px-3 py-1.5 border-b border-[#E3ECF7] dark:border-slate-800/80 grid grid-cols-[1fr_auto_76px] gap-2 text-[11px] font-medium text-[#5A7190] dark:text-slate-400 bg-white dark:bg-[#0E131D]">
        <span>Symbol</span>
        <span className="text-center">Trend</span>
        <span className="text-right">Last / Chg</span>
      </div>

      {/* Stock List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#EEF3FA] dark:divide-slate-800/60">
        {filteredStocks.map((stock) => {
          const isSelected = stock.symbol === selectedSymbol;
          const isFav = favorites.includes(stock.symbol);
          const change = stock.price - stock.prevClose;
          const changePct = (change / Math.max(0.01, stock.prevClose)) * 100;
          const isUp = change >= 0;
          const spark = stock.bars.slice(-20).map((b) => b.close);

          return (
            <div
              key={stock.symbol}
              onClick={() => {
                onSelectSymbol(stock.symbol);
                onCloseMobile();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectSymbol(stock.symbol);
                  onCloseMobile();
                }
              }}
              className={`w-full px-3 py-2.5 grid grid-cols-[1fr_auto_76px] items-center gap-2 cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[#EAF2FD] dark:bg-blue-950/40'
                  : 'hover:bg-[#F5F9FF] dark:hover:bg-[#141B29]'
              }`}
            >
              <div className="min-w-0 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={isFav ? `Remove ${stock.symbol} from starred` : `Star ${stock.symbol}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(stock.symbol);
                  }}
                  className={`p-0.5 rounded shrink-0 transition-colors ${
                    isFav
                      ? 'text-[#0052C2] dark:text-amber-400'
                      : 'text-slate-300 dark:text-slate-600 hover:text-[#0052C2]'
                  }`}
                >
                  <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-semibold font-mono tracking-tight ${
                        isSelected
                          ? 'text-[#012169] dark:text-blue-300'
                          : 'text-[#0A1F44] dark:text-slate-100'
                      }`}
                    >
                      {stock.symbol}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#5A7190] dark:text-slate-400 truncate">
                    {stock.name}
                  </div>
                </div>
              </div>

              <MiniSparkline values={spark} positive={isUp} />

              <div className="text-right font-mono tabular-nums">
                <div className="text-xs font-medium text-[#0A1F44] dark:text-slate-100">
                  {stock.price.toFixed(2)}
                </div>
                <div
                  className={`text-[11px] font-medium ${
                    isUp
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {isUp ? '+' : ''}
                  {changePct.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}

        {/* Remote Live Ticker Results (Add Any Real Ticker) */}
        {remoteMatches.length > 0 && (
          <div className="p-2.5 bg-[#F8FAFD] dark:bg-[#101827] space-y-1.5">
            <div className="text-[11px] font-semibold text-[#012169] dark:text-blue-300 px-1">
              Add Live Ticker from Market
            </div>
            {remoteMatches.map((item) => (
              <button
                key={item.symbol}
                type="button"
                disabled={addingSymbol === item.symbol}
                onClick={async () => {
                  setAddingSymbol(item.symbol);
                  await onAddTickerFromSearch(item);
                  setAddingSymbol(null);
                  setQuery('');
                  onCloseMobile();
                }}
                className="w-full px-2 py-2 rounded flex items-center justify-between gap-2 text-left bg-white dark:bg-[#141B29] border border-[#D6E2F0] dark:border-slate-800 hover:border-[#0052C2] transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono font-semibold text-[#012169] dark:text-white">
                    {item.symbol}
                    <span className="ml-1.5 font-sans font-normal text-[10px] text-slate-400">
                      {item.exchange}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.name}
                  </div>
                </div>
                <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#0052C2] dark:text-blue-400 shrink-0">
                  <Plus className="w-3.5 h-3.5" />
                  {addingSymbol === item.symbol ? 'Adding' : 'Add'}
                </span>
              </button>
            ))}
          </div>
        )}

        {filteredStocks.length === 0 && remoteMatches.length === 0 && (
          <div className="p-6 text-center space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No symbols match your filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setFilter('ALL');
              }}
              className="text-xs font-medium text-[#0052C2] dark:text-blue-400 hover:underline"
            >
              Reset filter
            </button>
          </div>
        )}
      </div>

      {/* Utility Footer: Live Sync Toggle & Theme Toggle */}
      <div className="p-2.5 border-t border-[#D6E2F0] dark:border-slate-800 flex items-center justify-between gap-2 bg-[#F8FAFD] dark:bg-[#0B0F17]">
        <button
          type="button"
          onClick={onToggleAutoRefresh}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          <span>{autoRefresh ? 'Auto-Sync: On' : 'Auto-Sync: Off'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Toggle color theme"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          <span>{isDark ? 'Merrill Light' : 'Dark'}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex justify-end">
          <div
            className="fixed inset-0 bg-[#012169]/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{content}</div>
        </div>
      )}
    </>
  );
}
