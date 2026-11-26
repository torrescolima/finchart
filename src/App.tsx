/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartTerminal } from './components/ChartTerminal';
import { FinancialPlannerView } from './components/FinancialPlannerView';
import { FundamentalsView } from './components/FundamentalsView';
import { TopBar } from './components/TopBar';
import { ValuationDcfView } from './components/ValuationDcfView';
import { WatchlistSidebar } from './components/WatchlistSidebar';
import {
  buildCustomStockProfile,
  buildInitialMarketUniverse,
  DEFAULT_FINANCIAL_PLAN,
  getDefaultDcfAssumptions,
  INITIAL_PORTFOLIO,
} from './data/marketData';
import {
  fetchLiveChart,
  fetchLiveQuotes,
  LiveSearchResult,
} from './services/marketApi';
import {
  DcfAssumptions,
  FinancialPlanInputs,
  PortfolioHolding,
  StockProfile,
  WorkspaceTab,
} from './types/market';
import {
  computeDcfValuation,
  downloadCsv,
  runFinancialPlanModel,
} from './utils/financeMath';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function hydrateFinancialPlan(): FinancialPlanInputs {
  try {
    const rawStr = localStorage.getItem('meridian_plan');
    if (!rawStr) return DEFAULT_FINANCIAL_PLAN;
    const saved = JSON.parse(rawStr) as Partial<FinancialPlanInputs> & {
      equitiesPct?: number;
      milestones?: { id: string; label: string; age: number; amount: number }[];
    };
    if (!saved || typeof saved !== 'object') return DEFAULT_FINANCIAL_PLAN;

    let usEquitiesPct = saved.usEquitiesPct;
    let intlEquitiesPct = saved.intlEquitiesPct;
    if (typeof usEquitiesPct !== 'number' || typeof intlEquitiesPct !== 'number') {
      if (typeof saved.equitiesPct === 'number') {
        usEquitiesPct = Math.round(saved.equitiesPct * 0.72);
        intlEquitiesPct = Math.max(0, Math.round(saved.equitiesPct - usEquitiesPct));
      } else {
        usEquitiesPct = DEFAULT_FINANCIAL_PLAN.usEquitiesPct;
        intlEquitiesPct = DEFAULT_FINANCIAL_PLAN.intlEquitiesPct;
      }
    }

    const migratedGoals = Array.isArray(saved.goals)
      ? saved.goals
      : Array.isArray(saved.milestones)
      ? saved.milestones.map((m) => ({
          id: m.id,
          label: m.label,
          category: (m.amount >= 0 ? 'Windfall' : 'Major Purchase') as FinancialPlanInputs['goals'][number]['category'],
          priority: 'Important' as FinancialPlanInputs['goals'][number]['priority'],
          age: m.age,
          durationYears: 1,
          amount: m.amount,
        }))
      : DEFAULT_FINANCIAL_PLAN.goals;

    return {
      ...DEFAULT_FINANCIAL_PLAN,
      ...saved,
      primaryName: saved.primaryName || DEFAULT_FINANCIAL_PLAN.primaryName,
      educationInflationRate:
        typeof saved.educationInflationRate === 'number'
          ? saved.educationInflationRate
          : DEFAULT_FINANCIAL_PLAN.educationInflationRate,
      usEquitiesPct,
      intlEquitiesPct,
      fixedIncomePct:
        typeof saved.fixedIncomePct === 'number'
          ? saved.fixedIncomePct
          : DEFAULT_FINANCIAL_PLAN.fixedIncomePct,
      alternativesPct:
        typeof saved.alternativesPct === 'number'
          ? saved.alternativesPct
          : DEFAULT_FINANCIAL_PLAN.alternativesPct,
      cashPct:
        typeof saved.cashPct === 'number'
          ? saved.cashPct
          : DEFAULT_FINANCIAL_PLAN.cashPct,
      spouse: {
        ...DEFAULT_FINANCIAL_PLAN.spouse,
        ...(saved.spouse ?? {}),
      },
      children: Array.isArray(saved.children)
        ? saved.children
        : DEFAULT_FINANCIAL_PLAN.children,
      goals: migratedGoals,
    };
  } catch {
    return DEFAULT_FINANCIAL_PLAN;
  }
}

export default function App() {
  const [stocksMap, setStocksMap] = useState<Record<string, StockProfile>>(() =>
    buildInitialMarketUniverse()
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chart');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL');
  const [favorites, setFavorites] = useState<string[]>(() =>
    readStorage('meridian_favorites', ['AAPL', 'MSFT', 'NVDA', 'SPY'])
  );
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() =>
    readStorage('meridian_holdings', INITIAL_PORTFOLIO)
  );
  const [plan, setPlan] = useState<FinancialPlanInputs>(() => hydrateFinancialPlan());
  const [dcfBySymbol, setDcfBySymbol] = useState<Record<string, DcfAssumptions>>({});
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Default to Merrill Lynch crisp white & blue light theme
  const [isDark, setIsDark] = useState<boolean>(() => readStorage('meridian_theme_v2_dark', false));
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const symbolsRef = useRef<string[]>(Object.keys(stocksMap));
  symbolsRef.current = Object.keys(stocksMap);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('meridian_theme_v2_dark', JSON.stringify(isDark));
    } catch {
      // Ignore storage quota errors
    }
  }, [isDark]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_favorites', JSON.stringify(favorites));
    } catch {
      // Ignore
    }
  }, [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_holdings', JSON.stringify(holdings));
    } catch {
      // Ignore
    }
  }, [holdings]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_plan', JSON.stringify(plan));
    } catch {
      // Ignore
    }
  }, [plan]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(null), 2600);
  }, []);

  // Fetch accurate real-time quotes from Yahoo Finance via our Express backend
  const syncLiveQuotes = useCallback(async (showNotification = false) => {
    const syms = symbolsRef.current;
    if (syms.length === 0) return;
    setIsSyncing(true);
    const payload = await fetchLiveQuotes(syms);
    setIsSyncing(false);

    if (!payload || Object.keys(payload.quotes).length === 0) {
      if (showNotification) showToast('Could not reach live market feed');
      return;
    }

    setLastSyncedAt(payload.asOf);
    setStocksMap((prev) => {
      const next: Record<string, StockProfile> = { ...prev };
      for (const [sym, q] of Object.entries(payload.quotes)) {
        const existing = next[sym];
        if (!existing) continue;
        const fy25 = existing.annualFinancials[existing.annualFinancials.length - 1];
        const marketCapB = Number(((q.price * existing.sharesOutM) / 1000).toFixed(1));
        const evM = marketCapB * 1000 + existing.netDebtM;
        const peTtm = fy25 ? Number((q.price / Math.max(0.01, fy25.eps)).toFixed(1)) : existing.peTtm;
        const evEbitda = fy25 ? Number((evM / Math.max(1, fy25.ebitda)).toFixed(1)) : existing.evEbitda;
        const evRevenue = fy25 ? Number((evM / Math.max(1, fy25.revenue)).toFixed(1)) : existing.evRevenue;

        next[sym] = {
          ...existing,
          name: q.name || existing.name,
          exchange: q.exchange || existing.exchange,
          price: q.price,
          prevClose: q.prevClose,
          open: q.open,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          week52High: q.week52High,
          week52Low: q.week52Low,
          volume: q.volume,
          marketCapB,
          peTtm,
          evEbitda,
          evRevenue,
          bars: q.bars.length > 0 ? q.bars : existing.bars,
          isLive: true,
          marketTime: q.marketTime,
        };
      }
      return next;
    });

    if (showNotification) {
      showToast(`Synced ${Object.keys(payload.quotes).length} live quotes from Yahoo Finance`);
    }
  }, [showToast]);

  // Initial sync on mount + periodic 30s live refresh
  useEffect(() => {
    syncLiveQuotes(false);
  }, [syncLiveQuotes]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      syncLiveQuotes(false);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, syncLiveQuotes]);

  const handleAddTickerFromSearch = useCallback(
    async (item: LiveSearchResult) => {
      const sym = item.symbol.toUpperCase();
      if (stocksMap[sym]) {
        setSelectedSymbol(sym);
        return;
      }
      const chart = await fetchLiveChart(sym, '6M');
      if (!chart) {
        showToast(`Unable to load live quote for ${sym}`);
        return;
      }
      const profile = buildCustomStockProfile({
        symbol: sym,
        name: chart.name || item.name,
        exchange: chart.exchange || item.exchange,
        sector: item.sector,
        industry: item.industry,
        price: chart.price,
        prevClose: chart.prevClose,
        open: chart.open,
        dayHigh: chart.dayHigh,
        dayLow: chart.dayLow,
        week52High: chart.week52High,
        week52Low: chart.week52Low,
        volume: chart.volume,
        marketTime: chart.marketTime,
        bars: chart.bars,
      });
      setStocksMap((prev) => ({ [sym]: profile, ...prev }));
      setSelectedSymbol(sym);
      if (activeTab === 'planner') setActiveTab('chart');
      showToast(`Added ${sym} ($${chart.price.toFixed(2)}) to watchlist`);
    },
    [stocksMap, activeTab, showToast]
  );

  const stocksList = useMemo(() => Object.values(stocksMap), [stocksMap]);
  const activeStock = stocksMap[selectedSymbol] ?? stocksList[0];

  const activeDcfAssumptions = useMemo(() => {
    return dcfBySymbol[activeStock.symbol] ?? getDefaultDcfAssumptions(activeStock);
  }, [dcfBySymbol, activeStock]);

  const handleToggleFavorite = (symbol: string) => {
    setFavorites((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const handleAddOrUpdateHolding = (symbol: string, sharesDelta: number, executionPrice: number) => {
    setHoldings((prev) => {
      const existing = prev.find((h) => h.symbol === symbol);
      if (!existing) {
        if (sharesDelta <= 0) return prev;
        return [
          ...prev,
          { id: `pos-${Date.now()}`, symbol, shares: sharesDelta, avgCost: executionPrice },
        ];
      }
      const nextShares = existing.shares + sharesDelta;
      if (nextShares <= 0) {
        return prev.filter((h) => h.id !== existing.id);
      }
      const nextCost =
        sharesDelta > 0
          ? Number(
              (
                (existing.shares * existing.avgCost + sharesDelta * executionPrice) /
                nextShares
              ).toFixed(2)
            )
          : existing.avgCost;
      return prev.map((h) =>
        h.id === existing.id ? { ...h, shares: nextShares, avgCost: nextCost } : h
      );
    });
  };

  const handleUpdateHolding = (id: string, shares: number, avgCost: number) => {
    setHoldings((prev) => prev.map((h) => (h.id === id ? { ...h, shares, avgCost } : h)));
  };

  const handleAddHolding = (symbol: string, shares: number, avgCost: number) => {
    handleAddOrUpdateHolding(symbol, shares, avgCost);
  };

  const handleRemoveHolding = (id: string) => {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  };

  const handleExportCsv = () => {
    if (activeTab === 'chart') {
      downloadCsv(
        `${activeStock.symbol}_ohlcv.csv`,
        ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'],
        activeStock.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume])
      );
      showToast(`Exported ${activeStock.symbol} OHLCV history (CSV)`);
    } else if (activeTab === 'fundamentals') {
      downloadCsv(
        `${activeStock.symbol}_financials.csv`,
        ['Period', 'Revenue ($M)', 'Gross Profit ($M)', 'EBIT ($M)', 'EBITDA ($M)', 'Net Income ($M)', 'EPS ($)', 'Free Cash Flow ($M)'],
        activeStock.annualFinancials.map((f) => [
          f.period,
          f.revenue,
          f.grossProfit,
          f.ebit,
          f.ebitda,
          f.netIncome,
          f.eps,
          f.freeCashFlow,
        ])
      );
      showToast(`Exported ${activeStock.symbol} financial statements (CSV)`);
    } else if (activeTab === 'dcf') {
      const res = computeDcfValuation(activeStock, activeDcfAssumptions);
      downloadCsv(
        `${activeStock.symbol}_dcf_model.csv`,
        ['Year', 'Revenue ($M)', 'Growth (%)', 'EBIT ($M)', 'NOPAT ($M)', 'UFCF ($M)', 'PV of UFCF ($M)'],
        res.years.map((y) => [
          y.label,
          Math.round(y.revenue),
          y.revGrowthPct.toFixed(1),
          Math.round(y.ebit),
          Math.round(y.nopat),
          Math.round(y.ufcf),
          Math.round(y.pvUfcf),
        ])
      );
      showToast(`Exported ${activeStock.symbol} DCF valuation schedule (CSV)`);
    } else {
      const portfolioVal = holdings.reduce(
        (sum, h) => sum + h.shares * (stocksMap[h.symbol]?.price ?? h.avgCost),
        0
      );
      const out = runFinancialPlanModel(plan, portfolioVal);
      downloadCsv(
        'meridian_financial_plan.csv',
        [
          'Age',
          'Spouse Age',
          'Year',
          'Phase',
          'Contribution ($)',
          'Education ($)',
          'Goals ($)',
          'Social Security ($)',
          'Withdrawal ($)',
          'Taxes ($)',
          'Median Nominal ($)',
          'Median Real ($)',
          'P10 Real ($)',
          'P90 Real ($)',
        ],
        out.rows.map((r) => [
          r.age,
          r.spouseAge ?? '',
          r.year,
          r.phase,
          Math.round(r.contribution),
          Math.round(r.educationOutflow),
          Math.round(r.goalFlow),
          Math.round(r.socialSecurity),
          Math.round(r.withdrawal),
          Math.round(r.taxesPaid),
          Math.round(r.p50Nominal),
          Math.round(r.p50Real),
          Math.round(r.p10Real),
          Math.round(r.p90Real),
        ])
      );
      showToast('Exported Financial Plan projection schedule (CSV)');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#F4F7FB] dark:bg-[#0B0F17] text-[#0A1F44] dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportCsv={handleExportCsv}
        onOpenMobileWatchlist={() => setMobileWatchlistOpen(true)}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <main className="flex-1 min-w-0 h-full overflow-hidden">
          {activeTab === 'chart' && (
            <ChartTerminal
              stock={activeStock}
              isDark={isDark}
              holdings={holdings}
              onAddOrUpdateHolding={handleAddOrUpdateHolding}
            />
          )}

          {activeTab === 'fundamentals' && (
            <FundamentalsView
              stock={activeStock}
              allStocks={stocksMap}
              onSelectSymbol={(sym) => setSelectedSymbol(sym)}
            />
          )}

          {activeTab === 'dcf' && (
            <ValuationDcfView
              stock={activeStock}
              assumptions={activeDcfAssumptions}
              onChangeAssumptions={(next) =>
                setDcfBySymbol((prev) => ({ ...prev, [activeStock.symbol]: next }))
              }
            />
          )}

          {activeTab === 'planner' && (
            <FinancialPlannerView
              plan={plan}
              onChangePlan={setPlan}
              holdings={holdings}
              stocksMap={stocksMap}
              onUpdateHolding={handleUpdateHolding}
              onAddHolding={handleAddHolding}
              onRemoveHolding={handleRemoveHolding}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('chart');
              }}
            />
          )}
        </main>

        <WatchlistSidebar
          stocks={stocksList}
          selectedSymbol={activeStock.symbol}
          onSelectSymbol={(sym) => {
            setSelectedSymbol(sym);
            if (activeTab === 'planner') setActiveTab('chart');
          }}
          onAddTickerFromSearch={handleAddTickerFromSearch}
          favorites={favorites}
          onToggleFavorite={handleToggleFavorite}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
          isSyncing={isSyncing}
          lastSyncedAt={lastSyncedAt}
          onManualRefresh={() => syncLiveQuotes(true)}
          isDark={isDark}
          onToggleTheme={() => setIsDark((v) => !v)}
          mobileOpen={mobileWatchlistOpen}
          onCloseMobile={() => setMobileWatchlistOpen(false)}
        />
      </div>

      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-4 left-4 z-50 px-4 py-2.5 rounded-md bg-[#012169] dark:bg-slate-100 text-white dark:text-slate-950 text-xs font-medium shadow-lg border border-[#0052C2] dark:border-slate-300"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
