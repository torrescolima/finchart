import {
  ArrowRight,
  BarChart3,
  Briefcase,
  Calculator,
  Calendar,
  Compass,
  Download,
  FileText,
  Filter,
  Moon,
  Plus,
  Printer,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LiveSearchResult, searchLiveTickers } from '../services/marketApi';
import { StockProfile, WorkspaceTab } from '../types/market';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  stocks: StockProfile[];
  isDark: boolean;
  onSelectSymbol: (symbol: string) => void;
  onAddRemoteTicker: (item: LiveSearchResult) => Promise<void>;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportCsv: () => void;
  onPrintReport: () => void;
  onToggleTheme: () => void;
}

const VIEW_ACTIONS: { id: WorkspaceTab; label: string; desc: string }[] = [
  { id: 'chart', label: 'Charting Terminal', desc: 'Candlesticks, split charts, indicators & Bar Replay' },
  { id: 'screener', label: 'Equity Screener & Heatmap', desc: 'Filter multiples, RSI(14), and sector heatmap' },
  { id: 'earnings', label: 'Earnings Calendar', desc: 'Upcoming report dates, EPS consensus & volatility catalysts' },
  { id: 'fundamentals', label: 'Fundamentals & Filings', desc: 'Income, Balance Sheet, Cash Flow, News & SEC EDGAR' },
  { id: 'dcf', label: 'Valuation & DCF Model', desc: 'Discounted cash flow & WACC sensitivity matrix' },
  { id: 'portfolio', label: 'Portfolio, Risk & Trade Journal', desc: 'Holdings, correlations, stress tests & trade log' },
  { id: 'planner', label: 'Financial Planner', desc: 'Monte Carlo wealth, spouse, 529 education & goals' },
];

export function CommandPalette({
  open,
  onClose,
  stocks,
  isDark,
  onSelectSymbol,
  onAddRemoteTicker,
  onSelectTab,
  onExportCsv,
  onPrintReport,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<LiveSearchResult[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setRemote([]);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const existingSymbols = useMemo(() => new Set(stocks.map((s) => s.symbol)), [stocks]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 1) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const results = await searchLiveTickers(q);
      if (!cancelled) {
        setRemote(results.filter((r) => !existingSymbols.has(r.symbol)).slice(0, 4));
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, existingSymbols]);

  const matchingStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stocks.slice(0, 6);
    return stocks
      .filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.sector.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [stocks, query]);

  const matchingViews = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return VIEW_ACTIONS;
    return VIEW_ACTIONS.filter(
      (v) => v.label.toLowerCase().includes(q) || v.desc.toLowerCase().includes(q)
    );
  }, [query]);

  if (!open) return null;

  const iconForTab = (tab: WorkspaceTab) => {
    if (tab === 'chart') return <BarChart3 className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    if (tab === 'screener') return <Filter className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    if (tab === 'earnings') return <Calendar className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    if (tab === 'fundamentals') return <FileText className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    if (tab === 'dcf') return <Calculator className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    if (tab === 'portfolio') return <Briefcase className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
    return <Compass className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-[#012169]/45 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white dark:bg-[#0E131D] border border-[#C6D6EA] dark:border-slate-700 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-[#0052C2] dark:text-blue-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to ticker, workspace view, or action..."
            className="flex-1 bg-transparent text-sm text-[#0A1F44] dark:text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 rounded text-slate-400 hover:text-[#012169] dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-[#EEF3FA] dark:divide-slate-800">
          {matchingStocks.length > 0 && (
            <div className="p-2">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5A7190] dark:text-slate-400">
                Securities
              </div>
              {matchingStocks.map((s) => {
                const pct = ((s.price - s.prevClose) / Math.max(0.01, s.prevClose)) * 100;
                return (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => {
                      onSelectSymbol(s.symbol);
                      onClose();
                    }}
                    className="w-full px-2.5 py-2 rounded-md flex items-center justify-between gap-3 text-left hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80 transition-colors"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="font-mono text-xs font-bold text-[#012169] dark:text-white w-14">
                        {s.symbol}
                      </span>
                      <span className="text-xs text-[#334E73] dark:text-slate-300 truncate">
                        {s.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono tabular-nums text-xs shrink-0">
                      <span className="text-[#0A1F44] dark:text-slate-100">${s.price.toFixed(2)}</span>
                      <span
                        className={
                          pct >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }
                      >
                        {pct >= 0 ? '+' : ''}
                        {pct.toFixed(2)}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {remote.length > 0 && (
            <div className="p-2">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5A7190] dark:text-slate-400">
                Add Live Ticker from Market
              </div>
              {remote.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  disabled={adding === item.symbol}
                  onClick={async () => {
                    setAdding(item.symbol);
                    await onAddRemoteTicker(item);
                    setAdding(null);
                    onClose();
                  }}
                  className="w-full px-2.5 py-2 rounded-md flex items-center justify-between gap-3 text-left hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold text-[#012169] dark:text-white w-14">
                      {item.symbol}
                    </span>
                    <span className="text-xs text-[#334E73] dark:text-slate-300 truncate">
                      {item.name}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#0052C2] dark:text-blue-400 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    {adding === item.symbol ? 'Adding...' : 'Add & Chart'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {matchingViews.length > 0 && (
            <div className="p-2">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5A7190] dark:text-slate-400">
                Workspaces
              </div>
              {matchingViews.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(v.id);
                    onClose();
                  }}
                  className="w-full px-2.5 py-2 rounded-md flex items-center justify-between gap-3 text-left hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {iconForTab(v.id)}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#012169] dark:text-white">
                        {v.label}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {v.desc}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          )}

          <div className="p-2">
            <div className="px-2.5 py-1 text-[11px] font-semibold text-[#5A7190] dark:text-slate-400">
              Quick Actions
            </div>
            <button
              type="button"
              onClick={() => {
                onPrintReport();
                onClose();
              }}
              className="w-full px-2.5 py-2 rounded-md flex items-center gap-2.5 text-xs text-[#0A1F44] dark:text-slate-200 hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80"
            >
              <Printer className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />
              <span>Generate Branded PDF Tear Sheet for Active View</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onExportCsv();
                onClose();
              }}
              className="w-full px-2.5 py-2 rounded-md flex items-center gap-2.5 text-xs text-[#0A1F44] dark:text-slate-200 hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80"
            >
              <Download className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />
              <span>Export Active View as CSV</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onToggleTheme();
                onClose();
              }}
              className="w-full px-2.5 py-2 rounded-md flex items-center gap-2.5 text-xs text-[#0A1F44] dark:text-slate-200 hover:bg-[#EAF2FD] dark:hover:bg-slate-800/80"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />
              ) : (
                <Moon className="w-4 h-4 text-[#0052C2] dark:text-blue-400" />
              )}
              <span>Switch to {isDark ? 'Merrill Light' : 'Dark'} Theme</span>
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-t border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex items-center justify-between text-[11px] text-[#5A7190] dark:text-slate-400">
          <span>Press Esc to close</span>
          <span>Shortcut: Cmd/Ctrl + K</span>
        </div>
      </div>
    </div>
  );
}
