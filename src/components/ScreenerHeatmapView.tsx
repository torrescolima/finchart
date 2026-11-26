import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, Search, Star, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Sector, StockProfile } from '../types/market';

interface ScreenerHeatmapViewProps {
  stocks: StockProfile[];
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  onSelectSymbolForChart: (symbol: string) => void;
}

type ScreenerSortKey =
  | 'marketCapB'
  | 'price'
  | 'changePct'
  | 'peForward'
  | 'evEbitda'
  | 'revenueGrowthYoy'
  | 'dividendYield'
  | 'rsi14'
  | 'dist52wHighPct';

type PresetId = 'all' | 'growth' | 'value' | 'oversold' | 'dividend';

function computeRsi14(bars: StockProfile['bars']): number {
  if (bars.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  const start = Math.max(1, bars.length - 14);
  for (let i = start; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

interface ScreenerRow {
  stock: StockProfile;
  changePct: number;
  rsi14: number;
  dist52wHighPct: number;
  rangePosPct: number;
}

const SECTORS: ('ALL' | Sector)[] = [
  'ALL',
  'Technology',
  'Financials',
  'Healthcare',
  'Consumer',
  'Energy',
  'ETF',
];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'all', label: 'All Securities' },
  { id: 'growth', label: 'High Growth (>12%)' },
  { id: 'value', label: 'Value (Fwd P/E <22)' },
  { id: 'oversold', label: 'Momentum Pullback (RSI <45)' },
  { id: 'dividend', label: 'Income (Yield >1.5%)' },
];

export function ScreenerHeatmapView({
  stocks,
  favorites,
  onToggleFavorite,
  onSelectSymbolForChart,
}: ScreenerHeatmapViewProps) {
  const [viewMode, setViewMode] = useState<'both' | 'table' | 'heatmap'>('both');
  const [sector, setSector] = useState<'ALL' | Sector>('ALL');
  const [preset, setPreset] = useState<PresetId>('all');
  const [query, setQuery] = useState('');
  const [maxPe, setMaxPe] = useState<number>(120);
  const [minGrowth, setMinGrowth] = useState<number>(-20);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>('marketCapB');
  const [sortAsc, setSortAsc] = useState(false);

  const enriched = useMemo<ScreenerRow[]>(() => {
    return stocks.map((stock) => {
      const changePct =
        ((stock.price - stock.prevClose) / Math.max(0.01, stock.prevClose)) * 100;
      const rsi14 = computeRsi14(stock.bars);
      const dist52wHighPct =
        ((stock.price - stock.week52High) / Math.max(0.01, stock.week52High)) * 100;
      const span = Math.max(0.01, stock.week52High - stock.week52Low);
      const rangePosPct = Math.max(
        0,
        Math.min(100, ((stock.price - stock.week52Low) / span) * 100)
      );
      return { stock, changePct, rsi14, dist52wHighPct, rangePosPct };
    });
  }, [stocks]);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    if (id === 'all') {
      setSector('ALL');
      setMaxPe(120);
      setMinGrowth(-20);
    } else if (id === 'growth') {
      setMaxPe(120);
      setMinGrowth(12);
    } else if (id === 'value') {
      setMaxPe(22);
      setMinGrowth(-20);
    } else if (id === 'oversold') {
      setMaxPe(120);
      setMinGrowth(-20);
    } else if (id === 'dividend') {
      setMaxPe(120);
      setMinGrowth(-20);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched
      .filter((r) => {
        if (sector !== 'ALL' && r.stock.sector !== sector) return false;
        if (r.stock.peForward > maxPe) return false;
        if (r.stock.revenueGrowthYoy < minGrowth) return false;
        if (preset === 'oversold' && r.rsi14 >= 45) return false;
        if (preset === 'dividend' && r.stock.dividendYield < 1.5) return false;
        if (
          q &&
          !r.stock.symbol.toLowerCase().includes(q) &&
          !r.stock.name.toLowerCase().includes(q) &&
          !r.stock.industry.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const getVal = (row: ScreenerRow): number => {
          if (sortKey === 'changePct') return row.changePct;
          if (sortKey === 'rsi14') return row.rsi14;
          if (sortKey === 'dist52wHighPct') return row.dist52wHighPct;
          return row.stock[sortKey];
        };
        const diff = getVal(a) - getVal(b);
        return sortAsc ? diff : -diff;
      });
  }, [enriched, sector, maxPe, minGrowth, preset, query, sortKey, sortAsc]);

  const breadth = useMemo(() => {
    const advancers = enriched.filter((r) => r.changePct > 0).length;
    const decliners = enriched.filter((r) => r.changePct < 0).length;
    const avgChg =
      enriched.reduce((sum, r) => sum + r.changePct, 0) / Math.max(1, enriched.length);
    const avgRsi =
      enriched.reduce((sum, r) => sum + r.rsi14, 0) / Math.max(1, enriched.length);
    return { advancers, decliners, avgChg, avgRsi };
  }, [enriched]);

  const sectorGroups = useMemo(() => {
    const map = new Map<string, ScreenerRow[]>();
    for (const row of filtered) {
      const list = map.get(row.stock.sector) ?? [];
      list.push(row);
      map.set(row.stock.sector, list);
    }
    return Array.from(map.entries()).map(([sec, rows]) => {
      const totalCap = rows.reduce((s, r) => s + Math.max(10, r.stock.marketCapB), 0);
      const avgChange =
        rows.reduce((s, r) => s + r.changePct, 0) / Math.max(1, rows.length);
      return { sector: sec, rows, totalCap, avgChange };
    });
  }, [filtered]);

  const handleSort = (key: ScreenerSortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const getTileTone = (pct: number) => {
    if (pct >= 2.0) return 'bg-emerald-700 text-white border-emerald-800';
    if (pct >= 0.4) return 'bg-emerald-600/90 text-white border-emerald-700';
    if (pct > 0) return 'bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800';
    if (pct <= -2.0) return 'bg-rose-700 text-white border-rose-800';
    if (pct <= -0.4) return 'bg-rose-600/90 text-white border-rose-700';
    if (pct < 0) return 'bg-rose-50 text-rose-900 border-rose-200 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800';
    return 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
  };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-5 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Header & Market Breadth Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#D6E2F0] dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#012169] dark:text-white">
            Equity Screener &amp; Market Heatmap
          </h1>
          <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-0.5">
            Filter live equities by valuation multiples, momentum RSI(14), and growth — click any tile or row to chart immediately.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md bg-white dark:bg-[#101827] border border-[#D6E2F0] dark:border-slate-800 p-0.5">
            {(
              [
                { id: 'both', label: 'Split View', icon: LayoutGrid },
                { id: 'heatmap', label: 'Heatmap', icon: LayoutGrid },
                { id: 'table', label: 'Screener Grid', icon: Table2 },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setViewMode(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  viewMode === opt.id
                    ? 'bg-[#012169] text-white dark:bg-[#0052C2]'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Col Market Breadth KPI Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Matches / Universe</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {filtered.length} / {enriched.length}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Active filter scope
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Market Breadth</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            <span className="text-emerald-700 dark:text-emerald-400">{breadth.advancers} Up</span>
            <span className="text-slate-300 dark:text-slate-600 mx-1.5">/</span>
            <span className="text-rose-600 dark:text-rose-400">{breadth.decliners} Dn</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Advancers vs. decliners
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Equal-Weight Move</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              breadth.avgChg >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {breadth.avgChg >= 0 ? '+' : ''}
            {breadth.avgChg.toFixed(2)}%
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Average session change
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Average RSI (14)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {breadth.avgRsi.toFixed(1)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {breadth.avgRsi >= 65
              ? 'Overbought momentum'
              : breadth.avgRsi <= 38
              ? 'Oversold territory'
              : 'Neutral momentum regime'}
          </div>
        </div>
      </div>

      {/* Institutional Filter & Preset Toolbar */}
      <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  preset === p.id
                    ? 'bg-[#0052C2] text-white'
                    : 'bg-[#F4F7FB] dark:bg-[#141B29] text-[#334E73] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter ticker, company, industry..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-slate-100 focus:outline-none focus:border-[#0052C2]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EEF3FA] dark:border-slate-800/80">
          <div className="flex items-center gap-2">
            <label htmlFor="screener-sector" className="text-xs font-medium text-[#334E73] dark:text-slate-300 shrink-0">
              Sector
            </label>
            <select
              id="screener-sector"
              value={sector}
              onChange={(e) => setSector(e.target.value as 'ALL' | Sector)}
              className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-slate-100"
            >
              {SECTORS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === 'ALL' ? 'All Sectors' : sec}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="screener-pe" className="text-xs font-medium text-[#334E73] dark:text-slate-300 whitespace-nowrap">
              Max Fwd P/E: <span className="font-mono font-semibold text-[#012169] dark:text-white">{maxPe >= 120 ? 'Any' : `${maxPe}x`}</span>
            </label>
            <input
              id="screener-pe"
              type="range"
              min={10}
              max={120}
              step={2}
              value={maxPe}
              onChange={(e) => setMaxPe(Number(e.target.value))}
              className="flex-1 accent-[#0052C2]"
            />
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="screener-growth" className="text-xs font-medium text-[#334E73] dark:text-slate-300 whitespace-nowrap">
              Min YoY Growth: <span className="font-mono font-semibold text-[#012169] dark:text-white">{minGrowth}%</span>
            </label>
            <input
              id="screener-growth"
              type="range"
              min={-20}
              max={50}
              step={2}
              value={minGrowth}
              onChange={(e) => setMinGrowth(Number(e.target.value))}
              className="flex-1 accent-[#0052C2]"
            />
          </div>
        </div>
      </div>

      {/* Sector Market-Cap Weighted Heatmap */}
      {(viewMode === 'both' || viewMode === 'heatmap') && (
        <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
              Sector Heatmap (Sized by Market Cap)
            </h2>
            <span className="text-xs text-[#5A7190] dark:text-slate-400">
              Click any equity tile to open full chart
            </span>
          </div>

          {sectorGroups.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No securities match your active filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sectorGroups.map((grp) => (
                <div
                  key={grp.sector}
                  className="border border-[#E3ECF7] dark:border-slate-800 rounded-md p-2.5 bg-[#F8FAFD] dark:bg-[#111724] space-y-2"
                >
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <span className="font-semibold text-[#012169] dark:text-slate-100">
                      {grp.sector}
                    </span>
                    <span
                      className={`font-mono tabular-nums font-medium ${
                        grp.avgChange >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      Avg {grp.avgChange >= 0 ? '+' : ''}
                      {grp.avgChange.toFixed(2)}%
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {grp.rows.map((row) => {
                      const weight = Math.max(
                        24,
                        Math.min(
                          100,
                          Math.round((Math.max(20, row.stock.marketCapB) / grp.totalCap) * 100)
                        )
                      );
                      return (
                        <button
                          key={row.stock.symbol}
                          type="button"
                          onClick={() => onSelectSymbolForChart(row.stock.symbol)}
                          style={{ flexBasis: `calc(${Math.max(30, weight)}% - 6px)` }}
                          className={`flex-1 min-w-[86px] px-2.5 py-2.5 rounded border text-left transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052C2] ${getTileTone(
                            row.changePct
                          )}`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="font-mono text-xs font-bold tracking-tight">
                              {row.stock.symbol}
                            </span>
                            <span className="font-mono tabular-nums text-[11px] font-semibold">
                              {row.changePct >= 0 ? '+' : ''}
                              {row.changePct.toFixed(2)}%
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] opacity-85 font-mono tabular-nums">
                            <span>${row.stock.price.toFixed(2)}</span>
                            <span>${row.stock.marketCapB.toFixed(0)}B</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* High-Density Institutional Screener Table */}
      {(viewMode === 'both' || viewMode === 'table') && (
        <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
              Screener Results ({filtered.length})
            </h2>
            <span className="text-xs text-[#5A7190] dark:text-slate-400">
              Click any column header to sort
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                  <th className="py-2.5 px-3 text-left font-medium w-8" aria-label="Favorite" />
                  <th className="py-2.5 px-3 text-left font-medium min-w-[180px]">Symbol / Name</th>
                  {(
                    [
                      { key: 'price', label: 'Last' },
                      { key: 'changePct', label: '1D Chg' },
                      { key: 'marketCapB', label: 'Mkt Cap' },
                      { key: 'peForward', label: 'Fwd P/E' },
                      { key: 'evEbitda', label: 'EV/EBITDA' },
                      { key: 'revenueGrowthYoy', label: 'Rev YoY' },
                      { key: 'dividendYield', label: 'Div Yld' },
                      { key: 'rsi14', label: 'RSI (14)' },
                      { key: 'dist52wHighPct', label: '52W Pos' },
                    ] as { key: ScreenerSortKey; label: string }[]
                  ).map((col) => {
                    const active = sortKey === col.key;
                    return (
                      <th key={col.key} className="py-2.5 px-3 text-right font-medium whitespace-nowrap">
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
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF3FA] dark:divide-slate-800/60 font-mono tabular-nums">
                {filtered.map((row) => {
                  const isFav = favorites.includes(row.stock.symbol);
                  const up = row.changePct >= 0;
                  return (
                    <tr
                      key={row.stock.symbol}
                      onClick={() => onSelectSymbolForChart(row.stock.symbol)}
                      className="cursor-pointer hover:bg-[#F5F9FF] dark:hover:bg-[#141B29] transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(row.stock.symbol);
                          }}
                          aria-label={`Toggle star for ${row.stock.symbol}`}
                          className={`p-0.5 rounded ${
                            isFav
                              ? 'text-[#0052C2] dark:text-amber-400'
                              : 'text-slate-300 dark:text-slate-600 hover:text-[#0052C2]'
                          }`}
                        >
                          <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[#012169] dark:text-white">
                            {row.stock.symbol}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                            {row.stock.name}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {row.stock.sector} · {row.stock.industry}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-[#0A1F44] dark:text-slate-100">
                        ${row.stock.price.toFixed(2)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-medium ${
                          up
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {up ? '+' : ''}
                        {row.changePct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        ${row.stock.marketCapB.toFixed(1)}B
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {row.stock.peForward.toFixed(1)}x
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {row.stock.evEbitda.toFixed(1)}x
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right ${
                          row.stock.revenueGrowthYoy >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.stock.revenueGrowthYoy >= 0 ? '+' : ''}
                        {row.stock.revenueGrowthYoy.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                        {row.stock.dividendYield.toFixed(2)}%
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-medium ${
                          row.rsi14 >= 70
                            ? 'text-rose-600 dark:text-rose-400'
                            : row.rsi14 <= 35
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {row.rsi14.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-[#0052C2] dark:bg-blue-400"
                              style={{ width: `${row.rangePosPct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 w-11 text-right">
                            {row.dist52wHighPct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-10 text-center font-sans text-xs text-slate-500">
                      No equities match these criteria. Try widening your P/E or growth filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
