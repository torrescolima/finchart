import { Check, GripVertical, Moon, Plus, RefreshCw, Search, Star, Sun, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LiveSearchResult, searchLiveTickers } from '../services/marketApi';
import { CustomWatchlist, Sector, StockProfile } from '../types/market';

interface WatchlistSidebarProps {
  stocks: StockProfile[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onReorderWatchlist: (fromSymbol: string, toSymbol: string) => void;
  onAddTickerFromSearch: (item: LiveSearchResult) => Promise<void>;
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  watchlists: CustomWatchlist[];
  activeWatchlistId: string;
  onSelectWatchlist: (id: string) => void;
  onCreateWatchlist: (name: string) => void;
  onDeleteWatchlist: (id: string) => void;
  onToggleSymbolInWatchlist: (watchlistId: string, symbol: string) => void;
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
  onReorderWatchlist,
  onAddTickerFromSearch,
  favorites,
  onToggleFavorite,
  watchlists,
  activeWatchlistId,
  onSelectWatchlist,
  onCreateWatchlist,
  onDeleteWatchlist,
  onToggleSymbolInWatchlist,
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
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');

  // Click-and-hold drag-to-reorder state
  const [draggingSymbol, setDraggingSymbol] = useState<string | null>(null);
  const draggingSymbolRef = useRef<string | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ symbol: string; y: number } | null>(null);
  const justDraggedRef = useRef(false);
  const rowElementsRef = useRef<Record<string, HTMLDivElement | null>>({});

  const existingSet = useMemo(() => new Set(stocks.map((s) => s.symbol)), [stocks]);

  const activeCustomList = useMemo(
    () => watchlists.find((w) => w.id === activeWatchlistId) ?? null,
    [watchlists, activeWatchlistId]
  );

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const customSet = activeCustomList ? new Set(activeCustomList.symbols) : null;
    return stocks.filter((s) => {
      if (customSet && !customSet.has(s.symbol)) return false;
      if (filter === 'STAR' && !favorites.includes(s.symbol)) return false;
      if (filter !== 'ALL' && filter !== 'STAR' && s.sector !== filter) return false;
      if (!q) return true;
      return (
        s.symbol.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q)
      );
    });
  }, [stocks, query, filter, favorites, activeCustomList]);

  // Global pointer listeners for smooth click-and-hold drag reordering
  useEffect(() => {
    const clearHoldTimer = () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const start = pointerStartRef.current;
      if (!start) return;

      // Activate drag immediately once moved >= 6px vertically while holding
      if (!draggingSymbolRef.current && Math.abs(e.clientY - start.y) >= 6) {
        clearHoldTimer();
        draggingSymbolRef.current = start.symbol;
        setDraggingSymbol(start.symbol);
        justDraggedRef.current = true;
      }

      const activeSym = draggingSymbolRef.current;
      if (!activeSym) return;

      // Find which row the pointer is currently over and live-reorder
      for (const s of filteredStocks) {
        if (s.symbol === activeSym) continue;
        const el = rowElementsRef.current[s.symbol];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          onReorderWatchlist(activeSym, s.symbol);
          break;
        }
      }
    };

    const handlePointerUp = () => {
      clearHoldTimer();
      pointerStartRef.current = null;
      if (draggingSymbolRef.current) {
        draggingSymbolRef.current = null;
        setDraggingSymbol(null);
        // Reset click guard on next tick so pointerup doesn't trigger row selection
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      clearHoldTimer();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [filteredStocks, onReorderWatchlist]);

  const startRowPointerDown = (
    e: React.PointerEvent<HTMLElement>,
    symbol: string,
    immediate: boolean
  ) => {
    if (e.button !== 0) return;
    pointerStartRef.current = { symbol, y: e.clientY };
    if (immediate) {
      draggingSymbolRef.current = symbol;
      setDraggingSymbol(symbol);
      justDraggedRef.current = true;
    } else {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        if (pointerStartRef.current?.symbol === symbol) {
          draggingSymbolRef.current = symbol;
          setDraggingSymbol(symbol);
          justDraggedRef.current = true;
        }
      }, 160);
    }
  };

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

        {/* Multi-Watchlist Switcher */}
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Select watchlist"
            value={activeWatchlistId}
            onChange={(e) => onSelectWatchlist(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 text-xs font-medium rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#012169] dark:text-slate-100 focus:outline-none focus:border-[#0052C2]"
          >
            <option value="ALL">All Market ({stocks.length})</option>
            {watchlists.map((wl) => (
              <option key={wl.id} value={wl.id}>
                {wl.name} ({wl.symbols.length})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreatingList((v) => !v)}
            title="New custom watchlist"
            aria-label="New custom watchlist"
            className="p-1.5 rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-[#0052C2] dark:text-blue-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {activeCustomList && (
            <button
              type="button"
              onClick={() => onDeleteWatchlist(activeCustomList.id)}
              title={`Delete ${activeCustomList.name}`}
              aria-label={`Delete ${activeCustomList.name}`}
              className="p-1.5 rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-slate-400 hover:text-rose-600 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {creatingList && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newListName.trim();
              if (!trimmed) return;
              onCreateWatchlist(trimmed);
              setNewListName('');
              setCreatingList(false);
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="List name (e.g. Earnings)..."
              maxLength={32}
              autoFocus
              className="flex-1 px-2 py-1 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#0052C2] text-[#0A1F44] dark:text-slate-100 focus:outline-none"
            />
            <button
              type="submit"
              className="px-2 py-1 text-xs font-semibold rounded-md bg-[#012169] text-white hover:bg-[#0052C2]"
            >
              Save
            </button>
          </form>
        )}

        {activeCustomList && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#334E73] dark:text-slate-300 bg-[#EAF2FD]/70 dark:bg-blue-950/30 px-2 py-1 rounded">
            <span className="truncate">Active ticker: {selectedSymbol}</span>
            <button
              type="button"
              onClick={() => onToggleSymbolInWatchlist(activeCustomList.id, selectedSymbol)}
              className="inline-flex items-center gap-1 font-semibold text-[#0052C2] dark:text-blue-400 hover:underline shrink-0"
            >
              {activeCustomList.symbols.includes(selectedSymbol) ? (
                <>
                  <Check className="w-3 h-3" />
                  <span>In List</span>
                </>
              ) : (
                <>
                  <Plus className="w-3 h-3" />
                  <span>Add {selectedSymbol}</span>
                </>
              )}
            </button>
          </div>
        )}

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
        <span>{draggingSymbol ? `Moving ${draggingSymbol}...` : 'Symbol · Hold to Reorder'}</span>
        <span className="text-center">Trend</span>
        <span className="text-right">Last / Chg</span>
      </div>

      {/* Stock List */}
      <div
        className={`flex-1 overflow-y-auto divide-y divide-[#EEF3FA] dark:divide-slate-800/60 ${
          draggingSymbol ? 'select-none cursor-grabbing' : ''
        }`}
      >
        {filteredStocks.map((stock) => {
          const isSelected = stock.symbol === selectedSymbol;
          const isDraggingThis = stock.symbol === draggingSymbol;
          const isFav = favorites.includes(stock.symbol);
          const change = stock.price - stock.prevClose;
          const changePct = (change / Math.max(0.01, stock.prevClose)) * 100;
          const isUp = change >= 0;
          const spark = stock.bars.slice(-20).map((b) => b.close);

          return (
            <div
              key={stock.symbol}
              ref={(el) => {
                rowElementsRef.current[stock.symbol] = el;
              }}
              onPointerDown={(e) => startRowPointerDown(e, stock.symbol, false)}
              onClick={() => {
                if (justDraggedRef.current) return;
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
              className={`group w-full pl-1.5 pr-3 py-2.5 grid grid-cols-[1fr_auto_74px] items-center gap-1.5 transition-colors select-none touch-none ${
                isDraggingThis
                  ? 'bg-[#DCEAFE] dark:bg-[#0052C2]/30 ring-1 ring-inset ring-[#0052C2] shadow-sm cursor-grabbing relative z-10'
                  : isSelected
                  ? 'bg-[#EAF2FD] dark:bg-blue-950/40 cursor-pointer'
                  : 'hover:bg-[#F5F9FF] dark:hover:bg-[#141B29] cursor-pointer'
              }`}
            >
              <div className="min-w-0 flex items-center gap-1">
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startRowPointerDown(e, stock.symbol, true);
                  }}
                  title="Hold and drag to reorder"
                  className={`p-0.5 rounded shrink-0 transition-colors ${
                    isDraggingThis
                      ? 'text-[#0052C2] dark:text-blue-300 cursor-grabbing'
                      : 'text-slate-300 dark:text-slate-600 group-hover:text-[#0052C2]/70 cursor-grab'
                  }`}
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </span>
                <button
                  type="button"
                  aria-label={isFav ? `Remove ${stock.symbol} from starred` : `Star ${stock.symbol}`}
                  onPointerDown={(e) => e.stopPropagation()}
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
                <div className="min-w-0 pl-0.5">
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
