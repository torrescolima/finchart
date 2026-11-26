import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calculator,
  Check,
  Compass,
  Minus,
  Moon,
  ShieldCheck,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { PlanTier, WorkspaceTab } from '../types/market';

export interface LandingQuoteItem {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

interface LandingPageProps {
  onLaunchTerminal: (tab?: WorkspaceTab, symbol?: string) => void;
  onSelectPaidPlan: (tier: Exclude<PlanTier, 'free'>) => void;
  onOpenLegal: () => void;
  onSignIn: () => void;
  isSignedIn: boolean;
  userLabel: string | null;
  currentPlanTier: PlanTier;
  isDark: boolean;
  onToggleTheme: () => void;
  sampleQuotes: LandingQuoteItem[];
}

interface ComparisonRow {
  capability: string;
  meridian: string;
  tradingView: string;
  institutional: string;
  meridianHighlight?: boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    capability: 'Monthly Starting Price',
    meridian: '$0 Free · $1 intro / $12 Pro',
    tradingView: '$15 – $60 / mo',
    institutional: '$1,000 – $2,000 / mo',
    meridianHighlight: true,
  },
  {
    capability: 'Multi-Chart Split Layouts & Bar Replay',
    meridian: 'Included (2x / 4x on Pro)',
    tradingView: 'Paid tiers only',
    institutional: 'Included',
  },
  {
    capability: 'Non-Expiring Price Alerts',
    meridian: '3 Free · Unlimited on Pro',
    tradingView: 'Expiring on base tiers',
    institutional: 'Included',
    meridianHighlight: true,
  },
  {
    capability: 'Interactive 5-Year DCF Valuation & WACC Matrix',
    meridian: 'Built-in on all plans',
    tradingView: 'Not included',
    institutional: 'Included',
    meridianHighlight: true,
  },
  {
    capability: 'Earnings Catalyst Calendar & SEC Statements',
    meridian: 'Built-in on all plans',
    tradingView: 'Basic summary only',
    institutional: 'Included',
  },
  {
    capability: 'Portfolio Correlation Matrix & Stress Tests',
    meridian: 'Included on Pro ($12/mo)',
    tradingView: 'Not included',
    institutional: 'Included',
    meridianHighlight: true,
  },
  {
    capability: 'Household Monte Carlo & 529 Education Planner',
    meridian: 'Built-in on all plans',
    tradingView: 'Not included',
    institutional: 'Separate advisor license',
    meridianHighlight: true,
  },
  {
    capability: 'Branded PDF Tear Sheets & Brokerage CSV Sync',
    meridian: 'Advisor ($39/mo)',
    tradingView: 'Not included',
    institutional: 'Included',
  },
];

function formatQuotePrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function LandingPage({
  onLaunchTerminal,
  onSelectPaidPlan,
  onOpenLegal,
  onSignIn,
  isSignedIn,
  userLabel,
  currentPlanTier,
  isDark,
  onToggleTheme,
  sampleQuotes,
}: LandingPageProps) {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0B0F17] text-[#0A1F44] dark:text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 h-16 bg-[#012169] dark:bg-[#07142C] text-white border-b border-[#0052C2]/40 dark:border-slate-800">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-white hover:opacity-90 transition-opacity shrink-0"
          >
            <span className="h-8 w-8 rounded-md bg-[#0052C2] flex items-center justify-center border border-white/15">
              <Compass className="h-4 w-4 text-white" />
            </span>
            <span className="font-semibold tracking-tight text-base">Meridian</span>
          </a>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-blue-100/90"
          >
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#compare" className="hover:text-white transition-colors">
              Compare
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="h-9 w-9 rounded-md border border-white/15 bg-white/5 hover:bg-white/15 flex items-center justify-center text-blue-100 transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {isSignedIn ? (
              <button
                type="button"
                onClick={() => onLaunchTerminal('chart')}
                className="hidden sm:inline-flex items-center h-9 px-3.5 rounded-md border border-white/20 text-xs font-medium text-blue-100 hover:bg-white/10 transition-colors max-w-[160px] truncate"
              >
                {userLabel || 'Signed In'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="hidden sm:inline-flex items-center h-9 px-3.5 rounded-md border border-white/20 text-xs font-medium text-white hover:bg-white/10 transition-colors"
              >
                Sign In
              </button>
            )}

            <button
              type="button"
              onClick={() => onLaunchTerminal('chart')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-white text-[#012169] hover:bg-blue-50 text-xs sm:text-sm font-semibold transition-colors"
            >
              Open Terminal
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero / Proposition */}
        <section className="relative overflow-hidden border-b border-[#D6E2F0] dark:border-slate-800 bg-gradient-to-b from-[#F4F7FB] to-white dark:from-[#0D1524] dark:to-[#0B0F17]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              <div className="lg:col-span-6 space-y-6">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0052C2] dark:text-blue-400">
                  Equity Research · Portfolio Analytics · Wealth Planning
                </p>

                <h1
                  className="font-semibold tracking-tight text-[#012169] dark:text-white leading-[1.08]"
                  style={{ fontSize: 'clamp(2.25rem, 4.1vw, 3.65rem)' }}
                >
                  Institutional charting, valuation, and wealth planning in one terminal.
                </h1>

                <p className="text-base sm:text-lg text-[#3D5678] dark:text-slate-300 leading-relaxed max-w-xl">
                  Analyze live market quotes, screen sectors, inspect SEC fundamentals, build
                  5-year DCF models, and stress-test household retirement plans—all without
                  five-figure terminal contracts.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onLaunchTerminal('chart')}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-[#012169] hover:bg-[#0052C2] dark:bg-[#0052C2] dark:hover:bg-blue-500 text-white text-sm font-semibold transition-colors shadow-sm"
                  >
                    Launch Free Terminal
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectPaidPlan('pro')}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-[#012169]/25 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#012169] dark:text-white hover:border-[#0052C2] hover:text-[#0052C2] dark:hover:border-blue-500 text-sm font-semibold transition-colors"
                  >
                    Start Pro for $1 First Month
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#5A7190] dark:text-slate-400">
                  <span>$0 Individual tier with no card required</span>
                  <span className="hidden sm:inline text-[#D6E2F0] dark:text-slate-700">|</span>
                  <span>Pro Trader: $1 first month, then $12/mo · cancel anytime</span>
                </div>
              </div>

              {/* Hero Visual Showcase + Live Market Tape */}
              <div className="lg:col-span-6 space-y-3">
                <div className="rounded-lg overflow-hidden border border-[#D6E2F0] dark:border-slate-800 bg-[#012169] shadow-xl shadow-[#012169]/10">
                  <img
                    src="/og-meridian.jpg"
                    alt="Meridian Terminal institutional equity research desk displaying candlestick technical analysis"
                    className="w-full aspect-video object-cover block"
                  />
                </div>

                {sampleQuotes.length > 0 && (
                  <div className="rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-[#E8EFF7] dark:border-slate-800">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5A7190] dark:text-slate-400">
                        Live Market Coverage — Click any ticker to open chart
                      </span>
                      <button
                        type="button"
                        onClick={() => onLaunchTerminal('screener')}
                        className="text-[11px] font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                      >
                        Full Screener
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {sampleQuotes.slice(0, 4).map((q) => {
                        const positive = q.changePct >= 0;
                        return (
                          <button
                            key={q.symbol}
                            type="button"
                            onClick={() => onLaunchTerminal('chart', q.symbol)}
                            className="text-left px-2.5 py-2 rounded-md border border-[#E8EFF7] dark:border-slate-800 hover:border-[#0052C2] dark:hover:border-blue-500 bg-[#F9FBFD] dark:bg-slate-900/60 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-[#012169] dark:text-white">
                                {q.symbol}
                              </span>
                              <span
                                className={`text-[11px] font-mono font-semibold ${
                                  positive
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-rose-700 dark:text-rose-400'
                                }`}
                              >
                                {positive ? '+' : ''}
                                {q.changePct.toFixed(2)}%
                              </span>
                            </div>
                            <div className="text-xs font-mono text-[#3D5678] dark:text-slate-300 mt-0.5">
                              ${formatQuotePrice(q.price)}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Mechanism / Asymmetric Capabilities Bento Grid */}
        <section
          id="capabilities"
          className="py-16 lg:py-20 bg-white dark:bg-[#0B0F17] border-b border-[#D6E2F0] dark:border-slate-800"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0052C2] dark:text-blue-400 mb-2">
                Unified Research Architecture
              </p>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#012169] dark:text-white">
                Four connected desks instead of four disconnected subscriptions.
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* 01 - Wide */}
              <article className="lg:col-span-2 rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-[#F9FBFD] dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs font-semibold text-[#0052C2] dark:text-blue-400">
                      01.
                    </span>
                    <BarChart3 className="h-5 w-5 text-[#012169] dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#012169] dark:text-white">
                    Multi-Chart Technical Terminal &amp; Bar Replay
                  </h3>
                  <p className="text-sm text-[#3D5678] dark:text-slate-300 leading-relaxed max-w-2xl">
                    Inspect adjusted OHLCV candlesticks with moving averages, Bollinger Bands,
                    RSI, MACD, drawing annotations, and historical bar replay. Run 2x or 4x
                    synchronized split views and set non-expiring price alerts tied directly to
                    your watchlists.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[#D6E2F0]/80 dark:border-slate-800">
                  <span className="text-xs text-[#5A7190] dark:text-slate-400">
                    Adjusted historical bars · Saved layouts · Live quote sync
                  </span>
                  <button
                    type="button"
                    onClick={() => onLaunchTerminal('chart')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                  >
                    Open Chart Terminal
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>

              {/* 02 - Narrow */}
              <article className="lg:col-span-1 rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs font-semibold text-[#0052C2] dark:text-blue-400">
                      02.
                    </span>
                    <Calculator className="h-5 w-5 text-[#012169] dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#012169] dark:text-white">
                    Fundamentals, Earnings &amp; 5-Year DCF
                  </h3>
                  <p className="text-sm text-[#3D5678] dark:text-slate-300 leading-relaxed">
                    Review multi-year income statements, balance sheets, upcoming earnings dates,
                    and live 5-year unlevered cash flow valuations with WACC and terminal growth
                    sensitivity grids.
                  </p>
                </div>
                <div className="pt-4 border-t border-[#D6E2F0]/80 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => onLaunchTerminal('dcf')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                  >
                    Open DCF Workbench
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>

              {/* 03 - Narrow */}
              <article className="lg:col-span-1 rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs font-semibold text-[#0052C2] dark:text-blue-400">
                      03.
                    </span>
                    <ShieldCheck className="h-5 w-5 text-[#012169] dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#012169] dark:text-white">
                    Portfolio Risk Matrix &amp; Trade Journal
                  </h3>
                  <p className="text-sm text-[#3D5678] dark:text-slate-300 leading-relaxed">
                    Measure pairwise holding correlations, benchmark beta, macro drawdown shocks,
                    and realized expectancy from your trade log—plus local Fidelity, Schwab, or
                    Vanguard CSV import on Advisor.
                  </p>
                </div>
                <div className="pt-4 border-t border-[#D6E2F0]/80 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => onLaunchTerminal('portfolio')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                  >
                    Open Portfolio &amp; Risk
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>

              {/* 04 - Wide */}
              <article className="lg:col-span-2 rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-[#F9FBFD] dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs font-semibold text-[#0052C2] dark:text-blue-400">
                      04.
                    </span>
                    <TrendingUp className="h-5 w-5 text-[#012169] dark:text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-[#012169] dark:text-white">
                    Household Monte Carlo Wealth &amp; 529 Education Planner
                  </h3>
                  <p className="text-sm text-[#3D5678] dark:text-slate-300 leading-relaxed max-w-2xl">
                    Model dual-earner retirement trajectories with Social Security timing,
                    tax-bucket withdrawals, custom asset allocations, and multi-child 529 college
                    funding linked directly to your live equity portfolio value.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[#D6E2F0]/80 dark:border-slate-800">
                  <span className="text-xs text-[#5A7190] dark:text-slate-400">
                    P10 / P50 / P90 simulation paths · CSV schedules · Client PDF reports
                  </span>
                  <button
                    type="button"
                    onClick={() => onLaunchTerminal('planner')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0052C2] dark:text-blue-400 hover:underline"
                  >
                    Open Wealth Planner
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* Proof / Competitive Comparison Table */}
        <section
          id="compare"
          className="py-16 lg:py-20 bg-[#F4F7FB] dark:bg-[#0D1524] border-b border-[#D6E2F0] dark:border-slate-800"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0052C2] dark:text-blue-400 mb-2">
                Side-by-Side Comparison
              </p>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#012169] dark:text-white">
                Built for serious investors who outgrew chart-only apps.
              </h2>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] shadow-sm">
              <table className="w-full min-w-[680px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F9FBFD] dark:bg-slate-900/70">
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider text-[#5A7190] dark:text-slate-400">
                      Capability
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider text-white bg-[#012169] dark:bg-[#0052C2]">
                      Meridian Terminal
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider text-[#3D5678] dark:text-slate-300">
                      Chart-Only Platforms (e.g. TradingView)
                    </th>
                    <th className="py-4 px-5 text-xs font-semibold uppercase tracking-wider text-[#3D5678] dark:text-slate-300">
                      Legacy Institutional (FactSet / Bloomberg)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8EFF7] dark:divide-slate-800 text-sm">
                  {COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.capability}
                      className="hover:bg-[#F9FBFD] dark:hover:bg-slate-900/40 transition-colors"
                    >
                      <td className="py-3.5 px-5 font-medium text-[#0A1F44] dark:text-slate-100">
                        {row.capability}
                      </td>
                      <td className="py-3.5 px-5 font-semibold text-[#012169] dark:text-blue-300 bg-[#012169]/[0.03] dark:bg-[#0052C2]/10">
                        <span className="inline-flex items-center gap-2">
                          <Check className="h-4 w-4 text-[#0052C2] dark:text-blue-400 shrink-0" />
                          {row.meridian}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-[#5A7190] dark:text-slate-400">
                        {row.tradingView === 'Not included' ? (
                          <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
                            <Minus className="h-3.5 w-3.5" />
                            Not included
                          </span>
                        ) : (
                          row.tradingView
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-[#5A7190] dark:text-slate-400">
                        {row.institutional}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Conversion / Transparent 3-Tier Pricing */}
        <section
          id="pricing"
          className="py-16 lg:py-20 bg-white dark:bg-[#0B0F17] border-b border-[#D6E2F0] dark:border-slate-800"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl mb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0052C2] dark:text-blue-400 mb-2">
                Straightforward Plans
              </p>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#012169] dark:text-white">
                Start free. Upgrade to Pro for $1 in your first month.
              </h2>
              <p className="text-sm sm:text-base text-[#3D5678] dark:text-slate-300 mt-2">
                No hidden data add-ons or annual lock-in. Switch or cancel anytime from your
                Stripe billing portal.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
              {/* Individual */}
              <div className="rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#012169] dark:text-white">
                    Individual
                  </h3>
                  <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-1">
                    Core equity research and household financial planning.
                  </p>
                  <div className="mt-5 pb-5 border-b border-[#E8EFF7] dark:border-slate-800">
                    <span className="text-4xl font-semibold tracking-tight text-[#012169] dark:text-white font-mono">
                      $0
                    </span>
                    <span className="text-xs text-[#5A7190] dark:text-slate-400 ml-1.5">
                      / forever
                    </span>
                  </div>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#3D5678] dark:text-slate-300">
                    {[
                      'Single-chart OHLCV terminal & indicators',
                      'Equity screener, heatmap & earnings calendar',
                      'Fundamentals, 5-year DCF & Monte Carlo planner',
                      'Up to 3 active price alerts & 2 custom watchlists',
                      'Up to 10 trade journal entries & 2 saved layouts',
                    ].map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-[#0052C2] dark:text-blue-400 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => onLaunchTerminal('chart')}
                  className="mt-7 w-full py-2.5 px-4 rounded-md border border-[#012169]/30 dark:border-slate-700 text-[#012169] dark:text-white hover:border-[#0052C2] hover:bg-[#F4F7FB] dark:hover:bg-slate-800 text-sm font-semibold transition-colors"
                >
                  {isSignedIn && currentPlanTier === 'free'
                    ? 'Open Your Free Terminal'
                    : 'Launch Free Terminal'}
                </button>
              </div>

              {/* Pro Trader */}
              <div className="rounded-lg border-2 border-[#012169] dark:border-[#0052C2] bg-[#F9FBFD] dark:bg-[#0F1B33] p-6 sm:p-7 flex flex-col justify-between shadow-lg shadow-[#012169]/10">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-[#012169] dark:text-white">
                      Pro Trader
                    </h3>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0052C2] dark:text-blue-300">
                      $1 First Month
                    </span>
                  </div>
                  <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-1">
                    Full multi-chart execution, unlimited alerts &amp; portfolio risk tools.
                  </p>
                  <div className="mt-5 pb-5 border-b border-[#D6E2F0] dark:border-slate-700">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-semibold tracking-tight text-[#012169] dark:text-white font-mono">
                        $1
                      </span>
                      <span className="text-xs text-[#3D5678] dark:text-slate-300 font-medium">
                        first month, then $12 / mo
                      </span>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#0A1F44] dark:text-slate-200">
                    {[
                      'Everything in Individual, plus:',
                      '2x & 4x synchronized multi-chart split views',
                      'Unlimited non-expiring price alerts & watchlists',
                      'Unlimited saved chart layouts & trade journal log',
                      'Portfolio correlation matrix & macro stress tests',
                      'Cloud-synced workspace across devices',
                    ].map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-[#0052C2] dark:text-blue-400 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectPaidPlan('pro')}
                  className="mt-7 w-full py-2.5 px-4 rounded-md bg-[#012169] hover:bg-[#0052C2] dark:bg-[#0052C2] dark:hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                >
                  {currentPlanTier === 'pro' ? 'Manage Pro Plan' : 'Start Pro for $1'}
                </button>
              </div>

              {/* Advisor & Institutional */}
              <div className="rounded-lg border border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#101827] p-6 sm:p-7 flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#012169] dark:text-white">
                    Advisor &amp; Institutional
                  </h3>
                  <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-1">
                    Client-ready reporting and brokerage position imports for RIAs &amp; family
                    offices.
                  </p>
                  <div className="mt-5 pb-5 border-b border-[#E8EFF7] dark:border-slate-800">
                    <span className="text-4xl font-semibold tracking-tight text-[#012169] dark:text-white font-mono">
                      $39
                    </span>
                    <span className="text-xs text-[#5A7190] dark:text-slate-400 ml-1.5">
                      / month
                    </span>
                  </div>
                  <ul className="mt-5 space-y-2.5 text-sm text-[#3D5678] dark:text-slate-300">
                    {[
                      'Everything in Pro Trader, plus:',
                      'Branded PDF Equity Tear Sheets & DCF summaries',
                      'Client-ready Portfolio & Monte Carlo PDF reports',
                      'Local brokerage CSV import (Fidelity, Schwab, Vanguard)',
                      'Priority workspace limits for advisor workflows',
                    ].map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5">
                        <Check className="h-4 w-4 text-[#0052C2] dark:text-blue-400 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectPaidPlan('advisor')}
                  className="mt-7 w-full py-2.5 px-4 rounded-md border border-[#012169] dark:border-blue-500 text-[#012169] dark:text-blue-300 hover:bg-[#012169] hover:text-white dark:hover:bg-[#0052C2] dark:hover:text-white text-sm font-semibold transition-colors"
                >
                  {currentPlanTier === 'advisor' ? 'Manage Advisor Plan' : 'Upgrade to Advisor'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Institutional Footer */}
      <footer className="bg-[#012169] dark:bg-[#07142C] text-blue-100/80 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2 text-white">
              <Compass className="h-4 w-4 text-blue-300" />
              <span className="font-semibold tracking-tight text-sm">Meridian Terminal</span>
            </div>
            <p className="text-xs text-blue-200/75 leading-relaxed">
              Meridian Terminal provides informational and analytical financial software only.
              Market quotes, valuations, and retirement simulations do not constitute personalized
              investment, legal, or tax advice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs font-medium text-blue-100">
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#compare" className="hover:text-white transition-colors">
              Compare
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Pricing
            </a>
            <button
              type="button"
              onClick={onOpenLegal}
              className="hover:text-white transition-colors"
            >
              Terms &amp; Disclosures
            </button>
            <button
              type="button"
              onClick={() => onLaunchTerminal('chart')}
              className="text-white font-semibold hover:underline"
            >
              Open Terminal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
