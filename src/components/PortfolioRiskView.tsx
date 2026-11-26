import { Lock, Plus, Printer, Trash2, Upload } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';
import { getTierLimits } from '../lib/entitlements';
import {
  PlanTier,
  PortfolioHolding,
  StockProfile,
  TradeJournalEntry,
  TradeSide,
} from '../types/market';
import { formatCurrency } from '../utils/financeMath';

interface PortfolioRiskViewProps {
  holdings: PortfolioHolding[];
  stocksMap: Record<string, StockProfile>;
  journal: TradeJournalEntry[];
  planTier: PlanTier;
  onRequireUpgrade: (requiredTier: Exclude<PlanTier, 'free'>, feature: string) => void;
  onAddHolding: (symbol: string, shares: number, avgCost: number) => void;
  onImportHoldings: (imported: Array<{ symbol: string; shares: number; avgCost: number }>) => void;
  onUpdateHolding: (id: string, shares: number, avgCost: number) => void;
  onRemoveHolding: (id: string) => void;
  onAddJournalEntry: (entry: Omit<TradeJournalEntry, 'id' | 'createdAt'>) => void;
  onDeleteJournalEntry: (id: string) => void;
  onCloseJournalEntry: (id: string, exitPrice: number, exitDate: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onPrintPortfolioReport: () => void;
}

type PortfolioSubTab = 'holdings' | 'risk' | 'journal';

const SETUP_TAGS = [
  'Earnings Breakout',
  'VWAP Pullback',
  'Swing Reversal',
  'Value Entry',
  'Momentum Continuation',
  'Macro Hedge',
];

const STRESS_SCENARIOS = [
  { name: '2008 Financial Crisis Shock', marketShockPct: -38.5, note: 'Severe equity drawdown across cyclical & financial beta' },
  { name: '2020 Liquidity Shock', marketShockPct: -30.2, note: 'Rapid volatility spike and broad risk-off selloff' },
  { name: '2022 Rate Hike Cycle', marketShockPct: -21.8, note: 'Multiple compression in long-duration growth stocks' },
  { name: 'Tech Valuation Pullback', marketShockPct: -15.0, note: 'Moderate 15% benchmark correction' },
  { name: 'Soft Landing Expansion', marketShockPct: 16.5, note: 'Earnings acceleration with stable yields' },
];

function computeDailyReturns(stock: StockProfile | undefined): number[] {
  if (!stock || stock.bars.length < 3) return [];
  const returns: number[] = [];
  for (let i = 1; i < stock.bars.length; i++) {
    const prev = stock.bars[i - 1].close;
    const curr = stock.bars[i].close;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  return returns;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

const SYMBOL_CSV_RE = /^[A-Z0-9.\-^]{1,12}$/;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseBrokerageCsv(
  text: string,
  stocksMap: Record<string, StockProfile>
): Array<{ symbol: string; shares: number; avgCost: number }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let headerIdx = -1;
  let symCol = -1;
  let qtyCol = -1;
  let costCol = -1;
  let totalCostCol = -1;
  let priceCol = -1;

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cols = parseCsvLine(lines[i]).map((c) => c.toLowerCase());
    const foundSym = cols.findIndex(
      (c) => c === 'symbol' || c === 'ticker' || c.includes('symbol') || c.includes('ticker')
    );
    const foundQty = cols.findIndex(
      (c) =>
        c === 'shares' ||
        c === 'quantity' ||
        c === 'qty' ||
        c.includes('quantity') ||
        c.includes('shares')
    );
    if (foundSym !== -1 && foundQty !== -1) {
      headerIdx = i;
      symCol = foundSym;
      qtyCol = foundQty;
      costCol = cols.findIndex(
        (c) =>
          c.includes('avg cost') ||
          c.includes('average cost') ||
          c.includes('cost basis per share') ||
          c.includes('cost/share') ||
          c.includes('unit cost')
      );
      totalCostCol = cols.findIndex(
        (c) => c === 'cost basis' || c === 'cost basis total' || c.includes('total cost')
      );
      priceCol = cols.findIndex(
        (c) => c === 'price' || c.includes('last price') || c.includes('market price')
      );
      break;
    }
  }

  if (headerIdx === -1) return [];

  const cleanNum = (raw?: string): number => {
    if (!raw) return NaN;
    const cleaned = raw.replace(/[$,\s%]/g, '');
    return Number(cleaned);
  };

  const results: Array<{ symbol: string; shares: number; avgCost: number }> = [];
  for (let i = headerIdx + 1; i < lines.length && results.length < 200; i++) {
    const cells = parseCsvLine(lines[i]);
    const rawSym = (cells[symCol] ?? '').toUpperCase().replace(/[^A-Z0-9.\-^]/g, '');
    if (!SYMBOL_CSV_RE.test(rawSym) || rawSym === 'CASH' || rawSym === 'USD' || rawSym === 'TOTAL') {
      continue;
    }
    const shares = cleanNum(cells[qtyCol]);
    if (!Number.isFinite(shares) || shares <= 0) continue;

    let avgCost = costCol !== -1 ? cleanNum(cells[costCol]) : NaN;
    if (!Number.isFinite(avgCost) || avgCost <= 0) {
      const totalCost = totalCostCol !== -1 ? cleanNum(cells[totalCostCol]) : NaN;
      if (Number.isFinite(totalCost) && totalCost > 0) {
        avgCost = totalCost / shares;
      }
    }
    if (!Number.isFinite(avgCost) || avgCost <= 0) {
      const csvPrice = priceCol !== -1 ? cleanNum(cells[priceCol]) : NaN;
      avgCost =
        Number.isFinite(csvPrice) && csvPrice > 0
          ? csvPrice
          : stocksMap[rawSym]?.price ?? 100;
    }

    results.push({
      symbol: rawSym,
      shares: Number(shares.toFixed(4)),
      avgCost: Number(avgCost.toFixed(2)),
    });
  }

  return results;
}

export function PortfolioRiskView({
  holdings,
  stocksMap,
  journal,
  planTier,
  onRequireUpgrade,
  onAddHolding,
  onImportHoldings,
  onUpdateHolding,
  onRemoveHolding,
  onAddJournalEntry,
  onDeleteJournalEntry,
  onCloseJournalEntry,
  onSelectSymbol,
  onPrintPortfolioReport,
}: PortfolioRiskViewProps) {
  const [subTab, setSubTab] = useState<PortfolioSubTab>('holdings');
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const tierLimits = useMemo(() => getTierLimits(planTier), [planTier]);

  // Add holding form
  const availableSymbols = useMemo(() => Object.keys(stocksMap).sort(), [stocksMap]);
  const [newPosSymbol, setNewPosSymbol] = useState<string>(availableSymbols[0] || 'AAPL');
  const [newPosShares, setNewPosShares] = useState<string>('25');
  const [newPosCost, setNewPosCost] = useState<string>('');

  // Trade Journal form
  const todayIso = new Date().toISOString().slice(0, 10);
  const [jSymbol, setJSymbol] = useState<string>(availableSymbols[0] || 'AAPL');
  const [jSide, setJSide] = useState<TradeSide>('LONG');
  const [jShares, setJShares] = useState<string>('50');
  const [jEntryPrice, setJEntryPrice] = useState<string>('');
  const [jExitPrice, setJExitPrice] = useState<string>('');
  const [jEntryDate, setJEntryDate] = useState<string>(todayIso);
  const [jExitDate, setJExitDate] = useState<string>('');
  const [jTag, setJTag] = useState<string>(SETUP_TAGS[0]);
  const [jNotes, setJNotes] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('ALL');

  const portfolioAnalytics = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    let weightedBetaSum = 0;
    let annualDividends = 0;

    const rows = holdings.map((h) => {
      const stock = stocksMap[h.symbol];
      const price = stock?.price ?? h.avgCost;
      const value = h.shares * price;
      const cost = h.shares * h.avgCost;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      const beta = stock?.beta ?? 1;
      const divYield = stock?.dividendYield ?? 0;
      const annualDiv = value * (divYield / 100);
      totalValue += value;
      totalCost += cost;
      weightedBetaSum += value * beta;
      annualDividends += annualDiv;

      return {
        holding: h,
        stock,
        price,
        value,
        cost,
        pnl,
        pnlPct,
        beta,
        divYield,
        annualDiv,
        sector: stock?.sector ?? 'Equity',
      };
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const weightedBeta = totalValue > 0 ? weightedBetaSum / totalValue : 1.0;
    const yieldPct = totalValue > 0 ? (annualDividends / totalValue) * 100 : 0;

    const sectorMap = new Map<string, number>();
    for (const r of rows) {
      sectorMap.set(r.sector, (sectorMap.get(r.sector) ?? 0) + r.value);
    }
    const sectors = Array.from(sectorMap.entries())
      .map(([name, value]) => ({
        name,
        value,
        weightPct: totalValue > 0 ? (value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);

    // Quarterly dividend schedule (weighted by standard US payout cadence)
    const quarterlyDivs = [
      { quarter: 'Q1 (Mar)', amount: annualDividends * 0.24 },
      { quarter: 'Q2 (Jun)', amount: annualDividends * 0.25 },
      { quarter: 'Q3 (Sep)', amount: annualDividends * 0.25 },
      { quarter: 'Q4 (Dec)', amount: annualDividends * 0.26 },
    ];

    return {
      rows: rows.sort((a, b) => b.value - a.value),
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPct,
      weightedBeta,
      annualDividends,
      yieldPct,
      sectors,
      quarterlyDivs,
    };
  }, [holdings, stocksMap]);

  // Real historical return correlation matrix across up to 6 largest holdings
  const correlationData = useMemo(() => {
    const topSymbols = portfolioAnalytics.rows.slice(0, 6).map((r) => r.holding.symbol);
    const returnsMap: Record<string, number[]> = {};
    for (const sym of topSymbols) {
      returnsMap[sym] = computeDailyReturns(stocksMap[sym]);
    }
    const matrix = topSymbols.map((rowSym) =>
      topSymbols.map((colSym) =>
        rowSym === colSym ? 1 : pearsonCorrelation(returnsMap[rowSym], returnsMap[colSym])
      )
    );
    return { symbols: topSymbols, matrix };
  }, [portfolioAnalytics.rows, stocksMap]);

  // Trade journal statistics
  const journalStats = useMemo(() => {
    let grossWins = 0;
    let grossLosses = 0;
    let winCount = 0;
    let closedCount = 0;
    let openPnl = 0;

    for (const entry of journal) {
      const direction = entry.side === 'LONG' ? 1 : -1;
      if (entry.exitPrice !== null) {
        closedCount++;
        const pnl = (entry.exitPrice - entry.entryPrice) * entry.shares * direction;
        if (pnl >= 0) {
          winCount++;
          grossWins += pnl;
        } else {
          grossLosses += Math.abs(pnl);
        }
      } else {
        const mark = stocksMap[entry.symbol]?.price ?? entry.entryPrice;
        openPnl += (mark - entry.entryPrice) * entry.shares * direction;
      }
    }

    const netRealized = grossWins - grossLosses;
    const winRatePct = closedCount > 0 ? (winCount / closedCount) * 100 : 0;
    const profitFactor =
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99.9 : 0;
    const expectancy = closedCount > 0 ? netRealized / closedCount : 0;

    return {
      closedCount,
      openCount: journal.length - closedCount,
      netRealized,
      openPnl,
      winRatePct,
      profitFactor,
      expectancy,
    };
  }, [journal, stocksMap]);

  const filteredJournal = useMemo(() => {
    if (tagFilter === 'ALL') return journal;
    return journal.filter((e) => e.setupTag === tagFilter);
  }, [journal, tagFilter]);

  const handleSubmitPosition = (e: React.FormEvent) => {
    e.preventDefault();
    const shares = Number(newPosShares);
    const livePrice = stocksMap[newPosSymbol]?.price ?? 100;
    const cost = newPosCost.trim() ? Number(newPosCost) : livePrice;
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(cost) || cost <= 0) return;
    onAddHolding(newPosSymbol, shares, Number(cost.toFixed(2)));
    setNewPosCost('');
  };

  const handleBrokerageCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseBrokerageCsv(text, stocksMap);
      if (parsed.length === 0) {
        setImportNotice(
          'No positions recognized. Export a holdings CSV with Symbol, Quantity/Shares, and Avg Cost columns (Schwab, Fidelity, IBKR, or generic CSV).'
        );
        return;
      }
      onImportHoldings(parsed);
      setImportNotice(`Imported ${parsed.length} positions from ${file.name}.`);
    } catch {
      setImportNotice('Unable to read the selected CSV file.');
    }
  };

  const handleSubmitJournal = (e: React.FormEvent) => {
    e.preventDefault();
    const shares = Number(jShares);
    const entryPrice = jEntryPrice.trim()
      ? Number(jEntryPrice)
      : stocksMap[jSymbol]?.price ?? 100;
    const exitPrice = jExitPrice.trim() ? Number(jExitPrice) : null;
    if (
      !Number.isFinite(shares) ||
      shares <= 0 ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0
    ) {
      return;
    }
    if (exitPrice !== null && (!Number.isFinite(exitPrice) || exitPrice <= 0)) return;

    onAddJournalEntry({
      symbol: jSymbol,
      side: jSide,
      entryDate: jEntryDate || todayIso,
      exitDate: exitPrice !== null ? jExitDate || todayIso : '',
      entryPrice: Number(entryPrice.toFixed(2)),
      exitPrice: exitPrice !== null ? Number(exitPrice.toFixed(2)) : null,
      shares,
      setupTag: jTag,
      notes: jNotes.trim(),
    });
    setJEntryPrice('');
    setJExitPrice('');
    setJExitDate('');
    setJNotes('');
  };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-5 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Header + Sub-Tab Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#D6E2F0] dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#012169] dark:text-white">
            Portfolio Analytics, Risk &amp; Trade Journal
          </h1>
          <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-0.5">
            Track live holdings, measure beta &amp; historical correlations, run macro stress tests, and audit your trading edge.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md bg-white dark:bg-[#101827] border border-[#D6E2F0] dark:border-slate-800 p-0.5">
            {(
              [
                { id: 'holdings', label: 'Holdings', locked: false },
                { id: 'risk', label: 'Risk & Stress Tests', locked: !tierLimits.riskAnalytics },
                { id: 'journal', label: `Trade Journal (${journal.length})`, locked: false },
              ] as { id: PortfolioSubTab; label: string; locked: boolean }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (t.locked) {
                    onRequireUpgrade(
                      'pro',
                      'Pairwise Correlation Matrix & Macro Stress Tests'
                    );
                    return;
                  }
                  setSubTab(t.id);
                }}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  subTab === t.id
                    ? 'bg-[#012169] text-white dark:bg-[#0052C2]'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                <span>{t.label}</span>
                {t.locked && <Lock className="w-3 h-3 opacity-70" />}
              </button>
            ))}
          </div>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleBrokerageCsvFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => {
              if (!tierLimits.csvBrokerageImport) {
                onRequireUpgrade('advisor', 'Brokerage CSV Statement Import');
                return;
              }
              csvInputRef.current?.click();
            }}
            title={
              tierLimits.csvBrokerageImport
                ? 'Import positions CSV exported from Schwab, Fidelity, Interactive Brokers, or any broker'
                : 'Advisor & Institutional feature: import brokerage holdings CSV'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-[#012169] dark:text-slate-100 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Brokerage CSV</span>
            {!tierLimits.csvBrokerageImport && <Lock className="w-3 h-3 opacity-70" />}
          </button>

          <button
            type="button"
            onClick={onPrintPortfolioReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-[#012169] dark:text-slate-100 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF Summary</span>
            {!tierLimits.pdfReports && <Lock className="w-3 h-3 opacity-70" />}
          </button>
        </div>
      </div>

      {importNotice && (
        <div className="rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#0E131D] px-4 py-2.5 text-xs text-[#012169] dark:text-slate-200 flex items-center justify-between gap-3">
          <span>{importNotice}</span>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="text-[11px] font-medium text-[#5A7190] hover:text-[#012169] dark:text-slate-400 dark:hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top 4-Col Portfolio KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Total Market Value</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {formatCurrency(portfolioAnalytics.totalValue)}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Cost Basis {formatCurrency(portfolioAnalytics.totalCost)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Total Unrealized P&amp;L</div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              portfolioAnalytics.totalPnl >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {portfolioAnalytics.totalPnl >= 0 ? '+' : ''}
            {formatCurrency(portfolioAnalytics.totalPnl)}
          </div>
          <div
            className={`mt-0.5 text-xs font-mono tabular-nums ${
              portfolioAnalytics.totalPnlPct >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {portfolioAnalytics.totalPnlPct >= 0 ? '+' : ''}
            {portfolioAnalytics.totalPnlPct.toFixed(2)}% overall
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Weighted Portfolio Beta</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {portfolioAnalytics.weightedBeta.toFixed(2)}x
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {portfolioAnalytics.weightedBeta > 1.15
              ? 'Growth-tilted sensitivity'
              : portfolioAnalytics.weightedBeta < 0.85
              ? 'Defensive sensitivity'
              : 'Market-aligned sensitivity'}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Est. Annual Dividends</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {formatCurrency(portfolioAnalytics.annualDividends)}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {portfolioAnalytics.yieldPct.toFixed(2)}% portfolio yield
          </div>
        </div>
      </div>

      {/* SUB-TAB 1: HOLDINGS */}
      {subTab === 'holdings' && (
        <div className="space-y-5">
          {/* Quick Add Position Bar */}
          <form
            onSubmit={handleSubmitPosition}
            className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4 flex flex-wrap items-end gap-3"
          >
            <div className="w-36">
              <label className="block text-[11px] font-medium text-[#5A7190] dark:text-slate-400 mb-1">
                Ticker
              </label>
              <select
                value={newPosSymbol}
                onChange={(e) => setNewPosSymbol(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
              >
                {availableSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s} (${stocksMap[s]?.price.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-[11px] font-medium text-[#5A7190] dark:text-slate-400 mb-1">
                Shares
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={newPosShares}
                onChange={(e) => setNewPosShares(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
              />
            </div>
            <div className="w-36">
              <label className="block text-[11px] font-medium text-[#5A7190] dark:text-slate-400 mb-1">
                Avg Cost (blank = live)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={newPosCost}
                onChange={(e) => setNewPosCost(e.target.value)}
                placeholder={stocksMap[newPosSymbol]?.price.toFixed(2) ?? '100.00'}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-[#012169] hover:bg-[#0052C2] text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Position</span>
            </button>
          </form>

          {/* Holdings Table */}
          <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                    <th className="py-2.5 px-4 text-left font-medium">Position</th>
                    <th className="py-2.5 px-3 text-right font-medium">Shares</th>
                    <th className="py-2.5 px-3 text-right font-medium">Avg Cost</th>
                    <th className="py-2.5 px-3 text-right font-medium">Last Price</th>
                    <th className="py-2.5 px-3 text-right font-medium">Market Value</th>
                    <th className="py-2.5 px-3 text-right font-medium">Weight</th>
                    <th className="py-2.5 px-3 text-right font-medium">Unrealized P&amp;L</th>
                    <th className="py-2.5 px-3 text-right font-medium">Est. Div/Yr</th>
                    <th className="py-2.5 px-3 text-right font-medium w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3FA] dark:divide-slate-800/60 font-mono tabular-nums">
                  {portfolioAnalytics.rows.map((r) => {
                    const weight =
                      portfolioAnalytics.totalValue > 0
                        ? (r.value / portfolioAnalytics.totalValue) * 100
                        : 0;
                    return (
                      <tr
                        key={r.holding.id}
                        className="hover:bg-[#F5F9FF] dark:hover:bg-[#141B29] transition-colors"
                      >
                        <td className="py-2.5 px-4 font-sans">
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(r.holding.symbol)}
                            className="text-left hover:underline"
                          >
                            <span className="font-mono font-semibold text-[#012169] dark:text-white mr-2">
                              {r.holding.symbol}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {r.stock?.name ?? r.holding.symbol}
                            </span>
                          </button>
                          <div className="text-[11px] text-slate-400">
                            {r.sector} · Beta {r.beta.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            aria-label={`Shares for ${r.holding.symbol}`}
                            value={r.holding.shares}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v >= 0) {
                                onUpdateHolding(r.holding.id, v, r.holding.avgCost);
                              }
                            }}
                            className="w-20 text-right px-1.5 py-1 rounded border border-transparent hover:border-[#C6D6EA] focus:border-[#0052C2] bg-transparent text-[#0A1F44] dark:text-slate-100"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            aria-label={`Avg cost for ${r.holding.symbol}`}
                            value={r.holding.avgCost}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v > 0) {
                                onUpdateHolding(r.holding.id, r.holding.shares, v);
                              }
                            }}
                            className="w-20 text-right px-1.5 py-1 rounded border border-transparent hover:border-[#C6D6EA] focus:border-[#0052C2] bg-transparent text-[#0A1F44] dark:text-slate-100"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right text-[#0A1F44] dark:text-slate-100">
                          ${r.price.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-[#012169] dark:text-white">
                          {formatCurrency(r.value)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                          {weight.toFixed(1)}%
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-medium ${
                            r.pnl >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {r.pnl >= 0 ? '+' : ''}
                          {formatCurrency(r.pnl)} ({r.pnlPct >= 0 ? '+' : ''}
                          {r.pnlPct.toFixed(1)}%)
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                          {formatCurrency(r.annualDiv)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onRemoveHolding(r.holding.id)}
                            aria-label={`Remove ${r.holding.symbol}`}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {portfolioAnalytics.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center font-sans text-xs text-slate-500">
                        No holdings yet. Add your first position above to activate risk and correlation analytics.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: RISK, CORRELATION & STRESS TESTS */}
      {subTab === 'risk' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Sector Concentration */}
            <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                Sector Exposure &amp; Concentration
              </h2>
              <div className="space-y-2.5">
                {portfolioAnalytics.sectors.map((sec) => (
                  <div key={sec.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#0A1F44] dark:text-slate-200">
                        {sec.name}
                      </span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(sec.value)} · {sec.weightPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#EEF3FA] dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#0052C2] dark:bg-blue-400"
                        style={{ width: `${Math.min(100, sec.weightPct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quarterly Dividend Calendar */}
            <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                  Estimated Quarterly Dividend Income
                </h2>
                <span className="text-xs font-mono tabular-nums text-[#0052C2] dark:text-blue-400">
                  {formatCurrency(portfolioAnalytics.annualDividends)} / yr
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 pt-2">
                {portfolioAnalytics.quarterlyDivs.map((q) => {
                  const maxQ = Math.max(
                    1,
                    ...portfolioAnalytics.quarterlyDivs.map((x) => x.amount)
                  );
                  const heightPct = Math.max(12, Math.round((q.amount / maxQ) * 100));
                  return (
                    <div key={q.quarter} className="flex flex-col items-center gap-2">
                      <div className="h-28 w-full flex items-end justify-center bg-[#F8FAFD] dark:bg-[#141B29] rounded-md p-2 border border-[#E3ECF7] dark:border-slate-800">
                        <div
                          className="w-8 rounded-t bg-[#012169] dark:bg-blue-500 transition-all"
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-mono font-semibold tabular-nums text-[#012169] dark:text-white">
                          {formatCurrency(q.amount)}
                        </div>
                        <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                          {q.quarter}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Historical Return Correlation Matrix */}
          <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                Pairwise Return Correlation Matrix (Top Holdings)
              </h2>
              <p className="text-xs text-[#5A7190] dark:text-slate-400">
                Computed from historical daily close-to-close returns. Values near +1.00 indicate high co-movement risk.
              </p>
            </div>

            {correlationData.symbols.length < 2 ? (
              <p className="text-xs text-slate-500">Add at least two holdings to compute pairwise correlations.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-[#D6E2F0] dark:border-slate-800">
                      <th className="py-2 px-3 text-left text-[#5A7190] dark:text-slate-400">Symbol</th>
                      {correlationData.symbols.map((sym) => (
                        <th key={sym} className="py-2 px-3 text-center font-semibold text-[#012169] dark:text-slate-200">
                          {sym}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationData.symbols.map((rowSym, rIdx) => (
                      <tr key={rowSym} className="border-b border-[#EEF3FA] dark:border-slate-800/60">
                        <td className="py-2 px-3 font-semibold text-[#012169] dark:text-slate-200">
                          {rowSym}
                        </td>
                        {correlationData.matrix[rIdx].map((val, cIdx) => {
                          const cellClass =
                            rIdx === cIdx
                              ? 'bg-[#EAF2FD] dark:bg-blue-950/60 text-[#012169] dark:text-blue-200 font-semibold'
                              : val >= 0.65
                              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                              : val <= 0.15
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-700 dark:text-slate-300';
                          return (
                            <td key={cIdx} className={`py-2 px-3 text-center ${cellClass}`}>
                              {val.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Macro Stress Tests */}
          <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724]">
              <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                Historical Macro Stress Tests (Beta-Adjusted)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#D6E2F0] dark:border-slate-800 text-[#5A7190] dark:text-slate-400">
                    <th className="py-2.5 px-5 text-left font-medium">Scenario</th>
                    <th className="py-2.5 px-3 text-right font-medium">S&amp;P 500 Shock</th>
                    <th className="py-2.5 px-3 text-right font-medium">Est. Portfolio Move</th>
                    <th className="py-2.5 px-3 text-right font-medium">Dollar Impact</th>
                    <th className="py-2.5 px-5 text-right font-medium">Projected Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3FA] dark:divide-slate-800/60 font-mono tabular-nums">
                  {STRESS_SCENARIOS.map((sc) => {
                    const portPct = sc.marketShockPct * portfolioAnalytics.weightedBeta;
                    const dollarImpact = portfolioAnalytics.totalValue * (portPct / 100);
                    const projectedVal = Math.max(0, portfolioAnalytics.totalValue + dollarImpact);
                    const pos = dollarImpact >= 0;
                    return (
                      <tr key={sc.name} className="hover:bg-[#F5F9FF] dark:hover:bg-[#141B29]">
                        <td className="py-3 px-5 font-sans">
                          <div className="font-medium text-[#0A1F44] dark:text-slate-100">{sc.name}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{sc.note}</div>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-300">
                          {sc.marketShockPct >= 0 ? '+' : ''}
                          {sc.marketShockPct.toFixed(1)}%
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-medium ${
                            pos
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {portPct >= 0 ? '+' : ''}
                          {portPct.toFixed(1)}%
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-medium ${
                            pos
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {pos ? '+' : ''}
                          {formatCurrency(dollarImpact)}
                        </td>
                        <td className="py-3 px-5 text-right font-semibold text-[#012169] dark:text-white">
                          {formatCurrency(projectedVal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: TRADE JOURNAL */}
      {subTab === 'journal' && (
        <div className="space-y-5">
          {/* Journal Performance KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
            <div className="p-4">
              <div className="text-xs text-[#5A7190] dark:text-slate-400">Net Realized P&amp;L</div>
              <div
                className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                  journalStats.netRealized >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {journalStats.netRealized >= 0 ? '+' : ''}
                {formatCurrency(journalStats.netRealized)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {journalStats.closedCount} closed · {journalStats.openCount} open
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-[#5A7190] dark:text-slate-400">Win Rate</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
                {journalStats.winRatePct.toFixed(1)}%
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Closed trades only
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-[#5A7190] dark:text-slate-400">Profit Factor</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
                {journalStats.profitFactor.toFixed(2)}x
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Gross profit / gross loss
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-[#5A7190] dark:text-slate-400">Expectancy / Trade</div>
              <div
                className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
                  journalStats.expectancy >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {journalStats.expectancy >= 0 ? '+' : ''}
                {formatCurrency(journalStats.expectancy)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Open P&amp;L: {journalStats.openPnl >= 0 ? '+' : ''}
                {formatCurrency(journalStats.openPnl)}
              </div>
            </div>
          </div>

          {/* Log Trade Form */}
          <form
            onSubmit={handleSubmitJournal}
            className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4 space-y-3"
          >
            <div className="text-sm font-semibold text-[#012169] dark:text-white">
              Log Trade Execution
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Symbol</label>
                <select
                  value={jSymbol}
                  onChange={(e) => setJSymbol(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                >
                  {availableSymbols.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Side</label>
                <select
                  value={jSide}
                  onChange={(e) => setJSide(e.target.value as TradeSide)}
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                >
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Shares</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={jShares}
                  onChange={(e) => setJShares(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Entry Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={jEntryPrice}
                  onChange={(e) => setJEntryPrice(e.target.value)}
                  placeholder={stocksMap[jSymbol]?.price.toFixed(2) ?? '100.00'}
                  className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Exit (blank=open)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={jExitPrice}
                  onChange={(e) => setJExitPrice(e.target.value)}
                  placeholder="Open"
                  className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Entry Date</label>
                <input
                  type="date"
                  value={jEntryDate}
                  onChange={(e) => setJEntryDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#5A7190] dark:text-slate-400 mb-1">Setup Tag</label>
                <select
                  value={jTag}
                  onChange={(e) => setJTag(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
                >
                  {SETUP_TAGS.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={jNotes}
                onChange={(e) => setJNotes(e.target.value)}
                placeholder="Thesis, catalyst, risk plan, or post-trade review notes..."
                className="flex-1 px-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-700 text-[#0A1F44] dark:text-slate-100"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-[#012169] hover:bg-[#0052C2] text-white whitespace-nowrap transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Trade</span>
              </button>
            </div>
          </form>

          {/* Setup Filter + Journal Table */}
          <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                Trade Ledger ({filteredJournal.length})
              </h2>
              <div className="flex flex-wrap items-center gap-1">
                {['ALL', ...SETUP_TAGS].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTagFilter(tag)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap transition-colors ${
                      tagFilter === tag
                        ? 'bg-[#0052C2] text-white'
                        : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                    }`}
                  >
                    {tag === 'ALL' ? 'All Setups' : tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#D6E2F0] dark:border-slate-800 text-[#5A7190] dark:text-slate-400">
                    <th className="py-2.5 px-4 text-left font-medium">Trade</th>
                    <th className="py-2.5 px-3 text-left font-medium">Setup &amp; Notes</th>
                    <th className="py-2.5 px-3 text-right font-medium">Qty</th>
                    <th className="py-2.5 px-3 text-right font-medium">Entry</th>
                    <th className="py-2.5 px-3 text-right font-medium">Exit / Mark</th>
                    <th className="py-2.5 px-3 text-right font-medium">P&amp;L</th>
                    <th className="py-2.5 px-4 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF3FA] dark:divide-slate-800/60 font-mono tabular-nums">
                  {filteredJournal.map((entry) => {
                    const isOpen = entry.exitPrice === null;
                    const mark = isOpen
                      ? stocksMap[entry.symbol]?.price ?? entry.entryPrice
                      : entry.exitPrice!;
                    const dir = entry.side === 'LONG' ? 1 : -1;
                    const pnl = (mark - entry.entryPrice) * entry.shares * dir;
                    const retPct = ((mark - entry.entryPrice) / Math.max(0.01, entry.entryPrice)) * 100 * dir;
                    return (
                      <tr key={entry.id} className="hover:bg-[#F5F9FF] dark:hover:bg-[#141B29]">
                        <td className="py-2.5 px-4 font-sans">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(entry.symbol)}
                              className="font-mono font-semibold text-[#012169] dark:text-white hover:underline"
                            >
                              {entry.symbol}
                            </button>
                            <span
                              className={`text-[11px] font-semibold ${
                                entry.side === 'LONG'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {entry.side}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              · {isOpen ? 'Open' : 'Closed'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {entry.entryDate}
                            {entry.exitDate ? ` → ${entry.exitDate}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-sans max-w-[260px]">
                          <div className="font-medium text-[#0A1F44] dark:text-slate-200">
                            {entry.setupTag}
                          </div>
                          {entry.notes && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {entry.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                          {entry.shares}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                          ${entry.entryPrice.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                          ${mark.toFixed(2)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-medium ${
                            pnl >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {pnl >= 0 ? '+' : ''}
                          {formatCurrency(pnl)} ({retPct >= 0 ? '+' : ''}
                          {retPct.toFixed(1)}%)
                        </td>
                        <td className="py-2.5 px-4 text-right font-sans">
                          <div className="inline-flex items-center gap-2">
                            {isOpen && (
                              <button
                                type="button"
                                onClick={() =>
                                  onCloseJournalEntry(
                                    entry.id,
                                    Number(mark.toFixed(2)),
                                    todayIso
                                  )
                                }
                                className="px-2 py-1 text-[11px] font-medium rounded border border-[#C6D6EA] dark:border-slate-700 text-[#0052C2] dark:text-blue-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 whitespace-nowrap"
                              >
                                Close at Mark
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onDeleteJournalEntry(entry.id)}
                              aria-label={`Delete ${entry.symbol} trade entry`}
                              className="p-1 text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredJournal.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center font-sans text-xs text-slate-500">
                        No trades logged yet. Record your first entry above to track win rate and profit factor.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
