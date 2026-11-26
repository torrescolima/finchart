import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { getDefaultDcfAssumptions } from '../data/marketData';
import { DcfAssumptions, StockProfile } from '../types/market';
import { computeDcfValuation, formatMillions } from '../utils/financeMath';

interface ValuationDcfViewProps {
  stock: StockProfile;
  assumptions: DcfAssumptions;
  onChangeAssumptions: (next: DcfAssumptions) => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (val: number) => void;
}

function SliderRow({ label, value, min, max, step, suffix, onChange }: SliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-white">
          {value.toFixed(step < 0.5 ? 2 : 1)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-[#0052C2] cursor-pointer bg-[#DCE6F5] dark:bg-slate-800 rounded-lg"
      />
    </div>
  );
}

export function ValuationDcfView({
  stock,
  assumptions,
  onChangeAssumptions,
}: ValuationDcfViewProps) {
  const result = useMemo(
    () => computeDcfValuation(stock, assumptions),
    [stock, assumptions]
  );

  const applyCase = (mode: 'bear' | 'base' | 'bull') => {
    const base = getDefaultDcfAssumptions(stock);
    if (mode === 'base') {
      onChangeAssumptions(base);
    } else if (mode === 'bear') {
      onChangeAssumptions({
        ...base,
        revGrowthYr1: Math.max(1, Number((base.revGrowthYr1 * 0.65).toFixed(1))),
        revGrowthYr5: Math.max(1.5, Number((base.revGrowthYr5 * 0.65).toFixed(1))),
        targetEbitMargin: Math.max(4, Number((base.targetEbitMargin - 3.5).toFixed(1))),
        terminalGrowth: 2.25,
        exitMultiple: Math.max(8, base.exitMultiple - 3),
        equityRiskPremium: 5.5,
      });
    } else {
      onChangeAssumptions({
        ...base,
        revGrowthYr1: Math.min(45, Number((base.revGrowthYr1 * 1.3).toFixed(1))),
        revGrowthYr5: Math.min(25, Number((base.revGrowthYr5 * 1.35).toFixed(1))),
        targetEbitMargin: Math.min(72, Number((base.targetEbitMargin + 3.0).toFixed(1))),
        terminalGrowth: 3.5,
        exitMultiple: base.exitMultiple + 3,
        equityRiskPremium: 4.5,
      });
    }
  };

  const isUndervalued = result.upsidePct >= 0;

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-6 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Header & Case Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D6E2F0] dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#012169] dark:text-white">
            Discounted Cash Flow Model — {stock.symbol}
          </h1>
          <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-0.5">
            {stock.name} · 5-Year Unlevered Free Cash Flow & WACC Sensitivity Workbench
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md bg-white dark:bg-[#141B29] p-0.5 border border-[#C6D6EA] dark:border-slate-800">
            <button
              type="button"
              onClick={() => applyCase('bear')}
              className="px-3 py-1.5 text-xs font-medium rounded text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors"
            >
              Bear
            </button>
            <button
              type="button"
              onClick={() => applyCase('base')}
              className="px-3 py-1.5 text-xs font-medium rounded text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors"
            >
              Base
            </button>
            <button
              type="button"
              onClick={() => applyCase('bull')}
              className="px-3 py-1.5 text-xs font-medium rounded text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors"
            >
              Bull
            </button>
          </div>

          <button
            type="button"
            onClick={() => applyCase('base')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#C6D6EA] dark:border-slate-800 bg-white dark:bg-[#141B29] text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Valuation Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">Implied Intrinsic Value</div>
          <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
            ${result.impliedSharePrice.toFixed(2)}
          </div>
          <div
            className={`mt-0.5 text-xs font-mono tabular-nums font-semibold ${
              isUndervalued
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {isUndervalued ? '+' : ''}
            {result.upsidePct.toFixed(1)}% vs ${stock.price.toFixed(2)} market
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Implied Enterprise Value</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {formatMillions(result.enterpriseValueM)}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Equity Value {formatMillions(result.equityValueM)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Computed WACC</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {result.waccPct.toFixed(2)}%
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Cost of Equity {result.costOfEquityPct.toFixed(2)}%
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">PV of Terminal Value</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-950 dark:text-white">
            {formatMillions(result.pvTerminalValue)}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {result.terminalValueSharePct.toFixed(1)}% of Enterprise Value
          </div>
        </div>
      </div>

      {/* Main Split: Assumptions Left | Projections & Sensitivity Right */}
      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6 items-start">
        {/* Left Assumptions Panel */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y divide-slate-200 dark:divide-slate-800">
          <div className="p-4 space-y-3.5">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Operating Drivers
            </h2>
            <SliderRow
              label="Year 1 Revenue Growth"
              value={assumptions.revGrowthYr1}
              min={-5}
              max={45}
              step={0.5}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, revGrowthYr1: v })}
            />
            <SliderRow
              label="Year 5 Revenue Growth"
              value={assumptions.revGrowthYr5}
              min={0}
              max={25}
              step={0.5}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, revGrowthYr5: v })}
            />
            <SliderRow
              label="Target EBIT Margin (Yr 5)"
              value={assumptions.targetEbitMargin}
              min={2}
              max={70}
              step={0.5}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, targetEbitMargin: v })}
            />
            <SliderRow
              label="Effective Tax Rate"
              value={assumptions.taxRate}
              min={10}
              max={35}
              step={0.5}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, taxRate: v })}
            />
            <SliderRow
              label="CapEx % of Revenue"
              value={assumptions.capexPctRev}
              min={0.5}
              max={30}
              step={0.5}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, capexPctRev: v })}
            />
          </div>

          <div className="p-4 space-y-3.5">
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Discount Rate (CAPM & WACC)
            </h2>
            <SliderRow
              label="Risk-Free Rate (10Y UST)"
              value={assumptions.riskFreeRate}
              min={2.0}
              max={6.5}
              step={0.25}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, riskFreeRate: v })}
            />
            <SliderRow
              label="Equity Risk Premium"
              value={assumptions.equityRiskPremium}
              min={3.0}
              max={7.5}
              step={0.25}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, equityRiskPremium: v })}
            />
            <SliderRow
              label="Levered Beta"
              value={assumptions.beta}
              min={0.4}
              max={2.4}
              step={0.05}
              suffix="x"
              onChange={(v) => onChangeAssumptions({ ...assumptions, beta: v })}
            />
            <SliderRow
              label="Debt Weight in Capital"
              value={assumptions.debtWeight}
              min={0}
              max={60}
              step={1}
              suffix="%"
              onChange={(v) => onChangeAssumptions({ ...assumptions, debtWeight: v })}
            />
          </div>

          <div className="p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Terminal Value Method
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#141B29] border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onChangeAssumptions({ ...assumptions, terminalMethod: 'perpetuity' })}
                className={`py-1.5 text-xs font-medium rounded transition-colors ${
                  assumptions.terminalMethod === 'perpetuity'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Perpetuity (g)
              </button>
              <button
                type="button"
                onClick={() => onChangeAssumptions({ ...assumptions, terminalMethod: 'multiple' })}
                className={`py-1.5 text-xs font-medium rounded transition-colors ${
                  assumptions.terminalMethod === 'multiple'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                EV / EBITDA
              </button>
            </div>

            {assumptions.terminalMethod === 'perpetuity' ? (
              <SliderRow
                label="Perpetual Growth Rate (g)"
                value={assumptions.terminalGrowth}
                min={1.0}
                max={4.5}
                step={0.25}
                suffix="%"
                onChange={(v) => onChangeAssumptions({ ...assumptions, terminalGrowth: v })}
              />
            ) : (
              <SliderRow
                label="Exit EV / EBITDA Multiple"
                value={assumptions.exitMultiple}
                min={6}
                max={35}
                step={0.5}
                suffix="x"
                onChange={(v) => onChangeAssumptions({ ...assumptions, exitMultiple: v })}
              />
            )}
          </div>
        </div>

        {/* Right Projections & Sensitivity */}
        <div className="space-y-6 min-w-0">
          {/* 5-Year UFCF Projection Grid */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                5-Year Unlevered Free Cash Flow Schedule
              </h2>
              <span className="text-[11px] text-slate-400">USD Millions</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111724] text-slate-500 dark:text-slate-400">
                    <th className="text-left font-medium py-2.5 px-4 min-w-[180px]">Metric</th>
                    {result.years.map((y) => (
                      <th key={y.label} className="text-right font-mono font-medium py-2.5 px-3">
                        {y.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono tabular-nums">
                  <tr>
                    <td className="py-2 px-4 font-sans font-semibold text-slate-900 dark:text-white">
                      Projected Revenue
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right font-semibold text-slate-900 dark:text-white">
                        {Math.round(y.revenue).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                      Revenue Growth (%)
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                        {y.revGrowthPct.toFixed(1)}%
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-700 dark:text-slate-300">
                      Operating Income (EBIT)
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                        {Math.round(y.ebit).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-700 dark:text-slate-300">
                      NOPAT (After-Tax EBIT)
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                        {Math.round(y.nopat).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                      (+) Depreciation & Amort.
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                        {Math.round(y.da).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                      (-) Capital Expenditures
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                        ({Math.round(y.capex).toLocaleString()})
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                      (-) Change in NWC
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                        ({Math.round(y.deltaNwc).toLocaleString()})
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-slate-50/70 dark:bg-slate-900/35">
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-950 dark:text-white">
                      Unlevered Free Cash Flow
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2.5 px-3 text-right font-semibold text-slate-950 dark:text-white">
                        {Math.round(y.ufcf).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 px-4 font-sans text-slate-500 dark:text-slate-400">
                      Discount Factor
                    </td>
                    {result.years.map((y) => (
                      <td key={y.label} className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">
                        {y.discountFactor.toFixed(3)}x
                      </td>
                    ))}
                  </tr>
                  <tr className="bg-blue-50/60 dark:bg-blue-950/25">
                    <td className="py-2.5 px-4 font-sans font-semibold text-blue-800 dark:text-blue-300">
                      Present Value of UFCF
                    </td>
                    {result.years.map((y) => (
                      <td
                        key={y.label}
                        className="py-2.5 px-3 text-right font-semibold text-blue-800 dark:text-blue-300"
                      >
                        {Math.round(y.pvUfcf).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Valuation Bridge + 5x5 Sensitivity Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
            {/* Enterprise-to-Equity Bridge */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4 space-y-2.5 text-xs">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white pb-1 border-b border-slate-200 dark:border-slate-800">
                Valuation Bridge
              </h3>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Sum of PV UFCF (Yr 1–5)</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMillions(result.sumPvUfcf)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">PV of Terminal Value</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {formatMillions(result.pvTerminalValue)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 font-semibold">
                <span className="text-slate-900 dark:text-white">Enterprise Value</span>
                <span className="font-mono tabular-nums text-slate-950 dark:text-white">
                  {formatMillions(result.enterpriseValueM)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Less: Net Debt</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {result.netDebtM >= 0 ? `(${formatMillions(result.netDebtM)})` : `+${formatMillions(-result.netDebtM)}`}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 font-semibold">
                <span className="text-slate-900 dark:text-white">Implied Equity Value</span>
                <span className="font-mono tabular-nums text-slate-950 dark:text-white">
                  {formatMillions(result.equityValueM)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Diluted Shares (M)</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {stock.sharesOutM.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-800 text-sm font-bold">
                <span className="text-slate-950 dark:text-white">Fair Value / Share</span>
                <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                  ${result.impliedSharePrice.toFixed(2)}
                </span>
              </div>
            </div>

            {/* 5x5 Sensitivity Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Sensitivity Matrix — Implied Share Price (WACC vs.{' '}
                  {assumptions.terminalMethod === 'perpetuity' ? 'Terminal Growth' : 'Exit Multiple'})
                </h3>
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  Mkt ${stock.price.toFixed(2)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111724] text-slate-500 dark:text-slate-400">
                      <th className="py-2 px-3 text-left font-sans font-medium">WACC \ Term</th>
                      {result.sensitivityTermAxis.map((tVal, ci) => (
                        <th
                          key={ci}
                          className={`py-2 px-3 text-right font-medium ${
                            ci === 2 ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
                          }`}
                        >
                          {assumptions.terminalMethod === 'perpetuity'
                            ? `${tVal.toFixed(2)}%`
                            : `${tVal.toFixed(1)}x`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {result.sensitivityWaccAxis.map((wVal, ri) => (
                      <tr key={ri}>
                        <td
                          className={`py-2.5 px-3 font-medium bg-slate-50/60 dark:bg-[#111724] ${
                            ri === 2
                              ? 'text-blue-600 dark:text-blue-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {wVal.toFixed(2)}%
                        </td>
                        {result.sensitivityMatrix[ri].map((price, ci) => {
                          const diffPct = ((price - stock.price) / Math.max(0.01, stock.price)) * 100;
                          const isCenter = ri === 2 && ci === 2;
                          const tint =
                            diffPct >= 15
                              ? 'bg-emerald-500/18 text-emerald-800 dark:text-emerald-300'
                              : diffPct >= 0
                              ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-400'
                              : diffPct <= -15
                              ? 'bg-rose-500/18 text-rose-800 dark:text-rose-300'
                              : 'bg-rose-500/8 text-rose-700 dark:text-rose-400';

                          return (
                            <td
                              key={ci}
                              className={`py-2.5 px-3 text-right ${tint} ${
                                isCenter ? 'ring-1 ring-inset ring-blue-500 font-bold' : ''
                              }`}
                            >
                              ${price.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
