import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FinancialPeriod, StockProfile } from '../types/market';
import { formatMillions } from '../utils/financeMath';

interface FundamentalsViewProps {
  stock: StockProfile;
  allStocks: Record<string, StockProfile>;
  onSelectSymbol: (symbol: string) => void;
}

type StatementTab = 'income' | 'balance' | 'cashflow' | 'ratios';
type Cadence = 'annual' | 'quarterly';
type PeerSortKey =
  | 'marketCapB'
  | 'peForward'
  | 'evEbitda'
  | 'evRevenue'
  | 'grossMargin'
  | 'operatingMargin'
  | 'roe'
  | 'revenueGrowthYoy';

interface RowSpec {
  key: string;
  label: string;
  bold?: boolean;
  isPercent?: boolean;
  isEps?: boolean;
  getValue: (p: FinancialPeriod) => number;
}

const INCOME_ROWS: RowSpec[] = [
  { key: 'revenue', label: 'Total Revenue', bold: true, getValue: (p) => p.revenue },
  { key: 'costOfRevenue', label: 'Cost of Revenue', getValue: (p) => p.costOfRevenue },
  { key: 'grossProfit', label: 'Gross Profit', bold: true, getValue: (p) => p.grossProfit },
  {
    key: 'grossMargin',
    label: 'Gross Margin (%)',
    isPercent: true,
    getValue: (p) => (p.grossProfit / Math.max(1, p.revenue)) * 100,
  },
  { key: 'operatingExpenses', label: 'Operating Expenses', getValue: (p) => p.operatingExpenses },
  { key: 'ebit', label: 'Operating Income (EBIT)', bold: true, getValue: (p) => p.ebit },
  {
    key: 'opMargin',
    label: 'Operating Margin (%)',
    isPercent: true,
    getValue: (p) => (p.ebit / Math.max(1, p.revenue)) * 100,
  },
  { key: 'ebitda', label: 'EBITDA', getValue: (p) => p.ebitda },
  { key: 'netIncome', label: 'Net Income', bold: true, getValue: (p) => p.netIncome },
  {
    key: 'netMargin',
    label: 'Net Profit Margin (%)',
    isPercent: true,
    getValue: (p) => (p.netIncome / Math.max(1, p.revenue)) * 100,
  },
  { key: 'eps', label: 'Diluted EPS ($)', bold: true, isEps: true, getValue: (p) => p.eps },
];

const BALANCE_ROWS: RowSpec[] = [
  { key: 'cashAndEquiv', label: 'Cash & Short-Term Investments', getValue: (p) => p.cashAndEquiv },
  { key: 'totalAssets', label: 'Total Assets', bold: true, getValue: (p) => p.totalAssets },
  { key: 'totalDebt', label: 'Total Debt', getValue: (p) => p.totalDebt },
  {
    key: 'netDebt',
    label: 'Net Debt / (Net Cash)',
    getValue: (p) => p.totalDebt - p.cashAndEquiv,
  },
  { key: 'totalLiabilities', label: 'Total Liabilities', getValue: (p) => p.totalLiabilities },
  {
    key: 'shareholdersEquity',
    label: "Total Shareholders' Equity",
    bold: true,
    getValue: (p) => p.shareholdersEquity,
  },
  {
    key: 'debtToEquity',
    label: 'Debt / Equity (%)',
    isPercent: true,
    getValue: (p) => (p.totalDebt / Math.max(1, p.shareholdersEquity)) * 100,
  },
];

const CASHFLOW_ROWS: RowSpec[] = [
  { key: 'operatingCashFlow', label: 'Operating Cash Flow', bold: true, getValue: (p) => p.operatingCashFlow },
  { key: 'capex', label: 'Capital Expenditures', getValue: (p) => -p.capex },
  { key: 'freeCashFlow', label: 'Free Cash Flow', bold: true, getValue: (p) => p.freeCashFlow },
  {
    key: 'fcfMargin',
    label: 'FCF Margin (%)',
    isPercent: true,
    getValue: (p) => (p.freeCashFlow / Math.max(1, p.revenue)) * 100,
  },
  { key: 'dividendsPaid', label: 'Common Dividends Paid', getValue: (p) => -p.dividendsPaid },
  { key: 'shareRepurchases', label: 'Share Repurchases', getValue: (p) => -p.shareRepurchases },
];

const RATIO_ROWS: RowSpec[] = [
  {
    key: 'grossMarginR',
    label: 'Gross Margin (%)',
    isPercent: true,
    getValue: (p) => (p.grossProfit / Math.max(1, p.revenue)) * 100,
  },
  {
    key: 'ebitdaMarginR',
    label: 'EBITDA Margin (%)',
    isPercent: true,
    getValue: (p) => (p.ebitda / Math.max(1, p.revenue)) * 100,
  },
  {
    key: 'opMarginR',
    label: 'Operating Margin (%)',
    isPercent: true,
    getValue: (p) => (p.ebit / Math.max(1, p.revenue)) * 100,
  },
  {
    key: 'fcfConversion',
    label: 'FCF / Net Income Conversion (%)',
    isPercent: true,
    getValue: (p) => (p.freeCashFlow / Math.max(1, p.netIncome)) * 100,
  },
  {
    key: 'roeR',
    label: 'Return on Equity (%)',
    isPercent: true,
    getValue: (p) => (p.netIncome / Math.max(1, p.shareholdersEquity)) * 100,
  },
  {
    key: 'roaR',
    label: 'Return on Assets (%)',
    isPercent: true,
    getValue: (p) => (p.netIncome / Math.max(1, p.totalAssets)) * 100,
  },
];

export function FundamentalsView({
  stock,
  allStocks,
  onSelectSymbol,
}: FundamentalsViewProps) {
  const [statementTab, setStatementTab] = useState<StatementTab>('income');
  const [cadence, setCadence] = useState<Cadence>('annual');
  const [hoveredPeriodIdx, setHoveredPeriodIdx] = useState<number | null>(null);
  const [peerSortKey, setPeerSortKey] = useState<PeerSortKey>('marketCapB');
  const [peerSortAsc, setPeerSortAsc] = useState(false);

  const periods = cadence === 'annual' ? stock.annualFinancials : stock.quarterlyFinancials;
  const fy25 = stock.annualFinancials[stock.annualFinancials.length - 1];
  const fy24 = stock.annualFinancials[stock.annualFinancials.length - 2];

  const rows = useMemo(() => {
    if (statementTab === 'income') return INCOME_ROWS;
    if (statementTab === 'balance') return BALANCE_ROWS;
    if (statementTab === 'cashflow') return CASHFLOW_ROWS;
    return RATIO_ROWS;
  }, [statementTab]);

  // Peer Comparison list including active stock
  const peerList = useMemo(() => {
    const syms = [stock.symbol, ...stock.peerSymbols.filter((s) => s !== stock.symbol)];
    const items = syms.map((sym) => allStocks[sym]).filter(Boolean);
    return [...items].sort((a, b) => {
      const diff = a[peerSortKey] - b[peerSortKey];
      return peerSortAsc ? diff : -diff;
    });
  }, [stock, allStocks, peerSortKey, peerSortAsc]);

  const peerMedians = useMemo(() => {
    const calcMed = (vals: number[]) => {
      const s = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
    };
    return {
      marketCapB: calcMed(peerList.map((p) => p.marketCapB)),
      peForward: calcMed(peerList.map((p) => p.peForward)),
      evEbitda: calcMed(peerList.map((p) => p.evEbitda)),
      evRevenue: calcMed(peerList.map((p) => p.evRevenue)),
      grossMargin: calcMed(peerList.map((p) => p.grossMargin)),
      operatingMargin: calcMed(peerList.map((p) => p.operatingMargin)),
      roe: calcMed(peerList.map((p) => p.roe)),
      revenueGrowthYoy: calcMed(peerList.map((p) => p.revenueGrowthYoy)),
    };
  }, [peerList]);

  const handleSort = (key: PeerSortKey) => {
    if (peerSortKey === key) setPeerSortAsc((v) => !v);
    else {
      setPeerSortKey(key);
      setPeerSortAsc(false);
    }
  };

  // Multi-period bar + margin SVG chart data
  const maxRev = Math.max(1, ...periods.map((p) => p.revenue));
  const fcfYoy = ((fy25.freeCashFlow - fy24.freeCashFlow) / Math.max(1, fy24.freeCashFlow)) * 100;
  const ebitdaMargin = (fy25.ebitda / Math.max(1, fy25.revenue)) * 100;

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-6 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Company Overview Header */}
      <div className="border-b border-[#D6E2F0] dark:border-slate-800 pb-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-[#012169] dark:text-white">
              {stock.name}
            </h1>
            <span className="text-sm font-mono font-semibold text-[#0052C2] dark:text-blue-400">
              {stock.symbol}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>{stock.exchange}</span>
            <span aria-hidden="true">·</span>
            <span>{stock.sector}</span>
            <span aria-hidden="true">·</span>
            <span>{stock.industry}</span>
            <span aria-hidden="true">·</span>
            <span>{stock.hq}</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed pt-1">
            {stock.description}
          </p>
        </div>

        <div className="shrink-0 font-mono tabular-nums lg:text-right">
          <div className="text-xs font-sans text-slate-500 dark:text-slate-400">Enterprise Value</div>
          <div className="text-lg font-semibold text-slate-950 dark:text-white">
            {formatMillions(stock.marketCapB * 1000 + stock.netDebtM)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Mkt Cap ${stock.marketCapB.toFixed(1)}B · Net Debt {formatMillions(stock.netDebtM)}
          </div>
        </div>
      </div>

      {/* 4-Column Institutional KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Revenue (FY25)</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-[#012169] dark:text-white">
            {formatMillions(fy25.revenue)}
          </div>
          <div
            className={`mt-0.5 text-xs font-mono tabular-nums ${
              stock.revenueGrowthYoy >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {stock.revenueGrowthYoy >= 0 ? '+' : ''}
            {stock.revenueGrowthYoy.toFixed(1)}% YoY
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">EBITDA Margin</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {ebitdaMargin.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            EBITDA {formatMillions(fy25.ebitda)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Free Cash Flow</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {formatMillions(fy25.freeCashFlow)}
          </div>
          <div
            className={`mt-0.5 text-xs font-mono tabular-nums ${
              fcfYoy >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {fcfYoy >= 0 ? '+' : ''}
            {fcfYoy.toFixed(1)}% YoY
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Return on Invested Capital</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {stock.roic.toFixed(1)}%
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            ROE {stock.roe.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Revenue, Net Income & Margin Trajectory Chart */}
      <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
              Revenue, Free Cash Flow & Operating Margin ({cadence === 'annual' ? 'FY21–FY25' : 'FY25 Quarterly'})
            </h2>
            <p className="text-xs text-[#5A7190] dark:text-slate-400">
              Hover any period bar to inspect exact revenue, profitability, and free cash flow conversion.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#5A7190] dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#012169] dark:bg-blue-500 inline-block" />
              Revenue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#0066CC] dark:bg-sky-400 inline-block" />
              Free Cash Flow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-amber-500 inline-block" />
              Operating Margin
            </span>
          </div>
        </div>

        <div className="relative h-56 w-full">
          <svg viewBox="0 0 760 210" className="w-full h-full overflow-visible" role="img" aria-label="Revenue and margin chart">
            {/* Horizontal guidelines */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = 175 - t * 150;
              return (
                <g key={t}>
                  <line
                    x1={56}
                    x2={704}
                    y1={y}
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeWidth="1"
                  />
                  <text
                    x={48}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {formatMillions(maxRev * t)}
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {periods.map((p, i) => {
              const slotW = (704 - 56) / periods.length;
              const cx = 56 + slotW * i + slotW / 2;
              const barW = Math.min(34, slotW * 0.26);
              const revH = (p.revenue / maxRev) * 150;
              const fcfH = Math.max(2, (Math.max(0, p.freeCashFlow) / maxRev) * 150);
              const isHover = hoveredPeriodIdx === i;

              return (
                <g
                  key={p.period}
                  onMouseEnter={() => setHoveredPeriodIdx(i)}
                  onMouseLeave={() => setHoveredPeriodIdx(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={cx - slotW * 0.44}
                    y={16}
                    width={slotW * 0.88}
                    height={165}
                    className={isHover ? 'fill-slate-100/80 dark:fill-slate-800/40' : 'fill-transparent'}
                    rx="4"
                  />
                  <rect
                    x={cx - barW - 2}
                    y={175 - revH}
                    width={barW}
                    height={revH}
                    rx="2"
                    className="fill-[#012169] dark:fill-blue-500 transition-opacity"
                  />
                  <rect
                    x={cx + 2}
                    y={175 - fcfH}
                    width={barW}
                    height={fcfH}
                    rx="2"
                    className="fill-[#0066CC] dark:fill-sky-400 transition-opacity"
                  />
                  <text
                    x={cx}
                    y={196}
                    textAnchor="middle"
                    className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono"
                  >
                    {p.period}
                  </text>
                </g>
              );
            })}

            {/* Operating Margin Line */}
            {(() => {
              const margins = periods.map((p) => (p.ebit / Math.max(1, p.revenue)) * 100);
              const maxM = Math.max(25, ...margins) * 1.15;
              const slotW = (704 - 56) / periods.length;
              const pts = margins.map((m, i) => {
                const x = 56 + slotW * i + slotW / 2;
                const y = 175 - (m / maxM) * 145;
                return { x, y, m };
              });
              const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
              return (
                <g>
                  <path d={d} fill="none" stroke="#F59E0B" strokeWidth="2.2" />
                  {pts.map((pt, idx) => (
                    <g key={idx}>
                      <circle cx={pt.x} cy={pt.y} r="3.5" fill="#F59E0B" />
                      <text
                        x={pt.x}
                        y={pt.y - 9}
                        textAnchor="middle"
                        className="fill-amber-600 dark:fill-amber-400 text-[10px] font-mono font-medium"
                      >
                        {pt.m.toFixed(1)}%
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}
          </svg>

          {hoveredPeriodIdx !== null && periods[hoveredPeriodIdx] && (
            <div className="pointer-events-none absolute top-2 right-2 bg-slate-900 text-slate-100 text-xs font-mono tabular-nums px-3 py-2 rounded-md border border-slate-700 shadow-lg space-y-0.5">
              <div className="font-sans font-semibold text-white">
                {periods[hoveredPeriodIdx].period}
              </div>
              <div>Revenue: {formatMillions(periods[hoveredPeriodIdx].revenue)}</div>
              <div>EBIT: {formatMillions(periods[hoveredPeriodIdx].ebit)}</div>
              <div>FCF: {formatMillions(periods[hoveredPeriodIdx].freeCashFlow)}</div>
              <div>EPS: ${periods[hoveredPeriodIdx].eps.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Institutional Financial Statements Table */}
      <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: 'income', label: 'Income Statement' },
                { id: 'balance', label: 'Balance Sheet' },
                { id: 'cashflow', label: 'Cash Flow' },
                { id: 'ratios', label: 'Profitability Ratios' },
              ] as { id: StatementTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatementTab(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                  statementTab === tab.id
                    ? 'bg-[#0052C2] text-white'
                    : 'text-[#334E73] dark:text-slate-400 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 hidden sm:inline">USD in Millions (except EPS)</span>
            <div className="inline-flex rounded-md bg-slate-100 dark:bg-[#141B29] p-0.5 border border-slate-200 dark:border-slate-800">
              {(['annual', 'quarterly'] as Cadence[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCadence(c)}
                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${
                    cadence === c
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111724] text-slate-500 dark:text-slate-400">
                <th className="text-left font-medium py-2.5 px-4 min-w-[210px]">Line Item</th>
                {periods.map((p) => (
                  <th key={p.period} className="text-right font-mono font-medium py-2.5 px-4">
                    {p.period}
                  </th>
                ))}
                <th className="text-right font-mono font-medium py-2.5 px-4">
                  {cadence === 'annual' ? 'YoY Δ' : 'QoQ Δ'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {rows.map((row) => {
                const latestVal = row.getValue(periods[periods.length - 1]);
                const priorVal = row.getValue(periods[periods.length - 2]);
                const delta = row.isPercent
                  ? latestVal - priorVal
                  : ((latestVal - priorVal) / Math.max(0.01, Math.abs(priorVal))) * 100;

                return (
                  <tr
                    key={row.key}
                    className={`hover:bg-slate-50 dark:hover:bg-[#141B29] transition-colors ${
                      row.bold ? 'bg-slate-50/40 dark:bg-slate-900/25' : ''
                    }`}
                  >
                    <td
                      className={`py-2.5 px-4 ${
                        row.bold
                          ? 'font-semibold text-slate-900 dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {row.label}
                    </td>
                    {periods.map((p) => {
                      const val = row.getValue(p);
                      const formatted = row.isPercent
                        ? `${val.toFixed(1)}%`
                        : row.isEps
                        ? `$${val.toFixed(2)}`
                        : val.toLocaleString('en-US', { maximumFractionDigits: 0 });
                      return (
                        <td
                          key={p.period}
                          className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                            row.bold
                              ? 'font-semibold text-slate-950 dark:text-white'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {formatted}
                        </td>
                      );
                    })}
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-medium ${
                        delta >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {delta.toFixed(1)}
                      {row.isPercent ? ' pp' : '%'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* FactSet Peer Valuation Comps */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Peer Valuation Comps
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any column header to sort or select a peer row to load it in the terminal.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111724] text-slate-500 dark:text-slate-400">
                <th className="text-left font-medium py-2.5 px-4">Company</th>
                {(
                  [
                    { key: 'marketCapB', label: 'Mkt Cap ($B)' },
                    { key: 'peForward', label: 'P/E (Fwd)' },
                    { key: 'evEbitda', label: 'EV/EBITDA' },
                    { key: 'evRevenue', label: 'EV/Rev' },
                    { key: 'grossMargin', label: 'Gross Mgn' },
                    { key: 'operatingMargin', label: 'EBIT Mgn' },
                    { key: 'roe', label: 'ROE' },
                    { key: 'revenueGrowthYoy', label: 'Rev Growth' },
                  ] as { key: PeerSortKey; label: string }[]
                ).map((col) => {
                  const active = peerSortKey === col.key;
                  return (
                    <th key={col.key} className="text-right font-medium py-2.5 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        <span>{col.label}</span>
                        {active ? (
                          peerSortAsc ? (
                            <ArrowUp className="w-3 h-3 text-blue-500" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-blue-500" />
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
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono tabular-nums">
              {peerList.map((peer) => {
                const isSelf = peer.symbol === stock.symbol;
                return (
                  <tr
                    key={peer.symbol}
                    onClick={() => onSelectSymbol(peer.symbol)}
                    className={`cursor-pointer transition-colors ${
                      isSelf
                        ? 'bg-blue-50/70 dark:bg-blue-950/30 font-semibold'
                        : 'hover:bg-slate-50 dark:hover:bg-[#141B29]'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-sans">
                      <span className="font-mono font-semibold text-slate-900 dark:text-white mr-2">
                        {peer.symbol}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">{peer.name}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-900 dark:text-slate-100">
                      ${peer.marketCapB.toFixed(1)}B
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.peForward.toFixed(1)}x
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.evEbitda.toFixed(1)}x
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.evRevenue.toFixed(1)}x
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.grossMargin.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.operatingMargin.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                      {peer.roe.toFixed(1)}%
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        peer.revenueGrowthYoy >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {peer.revenueGrowthYoy >= 0 ? '+' : ''}
                      {peer.revenueGrowthYoy.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}

              {/* Peer Median Row */}
              <tr className="bg-slate-100/80 dark:bg-[#141B29] font-semibold text-slate-900 dark:text-slate-100 border-t-2 border-slate-200 dark:border-slate-700">
                <td className="py-2.5 px-4 font-sans">Peer Group Median</td>
                <td className="py-2.5 px-3 text-right">${peerMedians.marketCapB.toFixed(1)}B</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.peForward.toFixed(1)}x</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.evEbitda.toFixed(1)}x</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.evRevenue.toFixed(1)}x</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.grossMargin.toFixed(1)}%</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.operatingMargin.toFixed(1)}%</td>
                <td className="py-2.5 px-3 text-right">{peerMedians.roe.toFixed(1)}%</td>
                <td className="py-2.5 px-3 text-right">
                  {peerMedians.revenueGrowthYoy >= 0 ? '+' : ''}
                  {peerMedians.revenueGrowthYoy.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
