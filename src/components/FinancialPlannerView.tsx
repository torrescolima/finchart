import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MODEL_ALLOCATION_PRESETS,
  PLAN_SCENARIO_PRESETS,
} from '../data/marketData';
import {
  ChildProfile,
  FinancialPlanInputs,
  GoalCategory,
  GoalPriority,
  PlanningGoal,
  PortfolioHolding,
  StockProfile,
} from '../types/market';
import {
  ASSET_CLASS_META,
  formatCompactCurrency,
  formatCurrency,
  runFinancialPlanModel,
} from '../utils/financeMath';

interface FinancialPlannerViewProps {
  plan: FinancialPlanInputs;
  onChangePlan: (next: FinancialPlanInputs) => void;
  holdings: PortfolioHolding[];
  stocksMap: Record<string, StockProfile>;
  onUpdateHolding: (id: string, shares: number, avgCost: number) => void;
  onAddHolding: (symbol: string, shares: number, avgCost: number) => void;
  onRemoveHolding: (id: string) => void;
  onSelectSymbol: (symbol: string) => void;
}

type PlannerSubView = 'projection' | 'goals' | 'allocation' | 'ledger' | 'portfolio';

type AssetField =
  | 'usEquitiesPct'
  | 'intlEquitiesPct'
  | 'fixedIncomePct'
  | 'alternativesPct'
  | 'cashPct';

const ASSET_FIELDS: AssetField[] = [
  'usEquitiesPct',
  'intlEquitiesPct',
  'fixedIncomePct',
  'alternativesPct',
  'cashPct',
];

const GOAL_CATEGORIES: GoalCategory[] = [
  'Home',
  'Education',
  'Travel',
  'Major Purchase',
  'Legacy',
  'Windfall',
];

const GOAL_PRIORITIES: GoalPriority[] = ['Essential', 'Important', 'Aspirational'];

const INPUT_CLS =
  'mt-1 w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white focus:outline-none focus:border-[#0052C2]';

const TEXT_INPUT_CLS =
  'mt-1 w-full px-2.5 py-1.5 text-xs rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white focus:outline-none focus:border-[#0052C2]';

export function FinancialPlannerView({
  plan,
  onChangePlan,
  holdings,
  stocksMap,
  onUpdateHolding,
  onAddHolding,
  onRemoveHolding,
  onSelectSymbol,
}: FinancialPlannerViewProps) {
  const [subView, setSubView] = useState<PlannerSubView>('projection');
  const [showRealDollars, setShowRealDollars] = useState(true);
  const [hoveredAgeIdx, setHoveredAgeIdx] = useState<number | null>(null);

  // Add Child form state
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('4');
  const [childCollegeAge, setChildCollegeAge] = useState('18');
  const [childYears, setChildYears] = useState('4');
  const [childAnnualCost, setChildAnnualCost] = useState('38000');
  const [child529, setChild529] = useState('15000');

  // Add Goal form state
  const [goalLabel, setGoalLabel] = useState('');
  const [goalCategory, setGoalCategory] = useState<GoalCategory>('Major Purchase');
  const [goalPriority, setGoalPriority] = useState<GoalPriority>('Important');
  const [goalAge, setGoalAge] = useState(
    String(Math.min(plan.horizonAge - 2, plan.currentAge + 8))
  );
  const [goalDuration, setGoalDuration] = useState('1');
  const [goalFlowType, setGoalFlowType] = useState<'outflow' | 'inflow'>('outflow');
  const [goalAmount, setGoalAmount] = useState('50000');

  // New portfolio holding form
  const availableSymbols = useMemo(() => Object.keys(stocksMap), [stocksMap]);
  const [newSym, setNewSym] = useState(availableSymbols[0] ?? 'AAPL');
  const [newShares, setNewShares] = useState('50');
  const [newCost, setNewCost] = useState('');

  // Portfolio live aggregates
  const portfolioStats = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    let annualDividends = 0;
    const enriched = holdings.map((h) => {
      const s = stocksMap[h.symbol];
      const livePrice = s?.price ?? h.avgCost;
      const marketValue = h.shares * livePrice;
      const costBasis = h.shares * h.avgCost;
      const pnl = marketValue - costBasis;
      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      const divAnnual = marketValue * ((s?.dividendYield ?? 0) / 100);
      totalValue += marketValue;
      totalCost += costBasis;
      annualDividends += divAnnual;
      return {
        ...h,
        livePrice,
        marketValue,
        costBasis,
        pnl,
        pnlPct,
        divAnnual,
        name: s?.name ?? h.symbol,
      };
    });
    return {
      enriched,
      totalValue,
      totalCost,
      totalPnl: totalValue - totalCost,
      totalPnlPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      annualDividends,
    };
  }, [holdings, stocksMap]);

  // Run Monte Carlo & Cash Flow Financial Planning Model
  const output = useMemo(
    () => runFinancialPlanModel(plan, portfolioStats.totalValue),
    [plan, portfolioStats.totalValue]
  );

  // 5-Class Asset Allocation auto-normalizing helper (strictly sums to 100%)
  const updateAllocation = (field: AssetField, nextVal: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
    const otherFields = ASSET_FIELDS.filter((f) => f !== field);
    const otherSum = otherFields.reduce((acc, f) => acc + plan[f], 0);
    const remainder = 100 - clamped;
    const next: FinancialPlanInputs = { ...plan, [field]: clamped };

    if (otherSum === 0) {
      otherFields.forEach((f, idx) => {
        next[f] = idx === 0 ? remainder : 0;
      });
    } else {
      let distributed = 0;
      otherFields.forEach((f, idx) => {
        if (idx === otherFields.length - 1) {
          next[f] = Math.max(0, remainder - distributed);
        } else {
          const share = Math.round((plan[f] / otherSum) * remainder);
          next[f] = share;
          distributed += share;
        }
      });
    }
    onChangePlan(next);
  };

  const updateSpouse = (patch: Partial<FinancialPlanInputs['spouse']>) => {
    onChangePlan({
      ...plan,
      spouse: { ...plan.spouse, ...patch },
    });
  };

  const handleAddChild = () => {
    const ageVal = Math.max(0, Math.min(25, Math.round(Number(childAge) || 0)));
    const startVal = Math.max(ageVal, Math.min(30, Math.round(Number(childCollegeAge) || 18)));
    const yrsVal = Math.max(1, Math.min(8, Math.round(Number(childYears) || 4)));
    const costVal = Math.max(0, Number(childAnnualCost) || 0);
    const bal529 = Math.max(0, Number(child529) || 0);
    const nameVal = childName.trim() || `Child ${plan.children.length + 1}`;

    const nextChild: ChildProfile = {
      id: `child-${Date.now()}`,
      name: nameVal,
      currentAge: ageVal,
      collegeStartAge: startVal,
      collegeYears: yrsVal,
      annualCollegeCost: costVal,
      existing529Balance: bal529,
    };

    onChangePlan({
      ...plan,
      children: [...plan.children, nextChild],
    });
    setChildName('');
  };

  const handleUpdateChild = (id: string, patch: Partial<ChildProfile>) => {
    onChangePlan({
      ...plan,
      children: plan.children.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const handleRemoveChild = (id: string) => {
    onChangePlan({
      ...plan,
      children: plan.children.filter((c) => c.id !== id),
    });
  };

  const handleAddGoal = () => {
    const ageNum = Number(goalAge);
    const durNum = Math.max(1, Math.min(40, Math.round(Number(goalDuration) || 1)));
    const rawAmt = Math.abs(Number(goalAmount) || 0);
    if (!goalLabel.trim() || !Number.isFinite(ageNum) || rawAmt <= 0) return;

    const signedAmount =
      goalCategory === 'Windfall' || goalFlowType === 'inflow' ? rawAmt : -rawAmt;

    const nextGoal: PlanningGoal = {
      id: `goal-${Date.now()}`,
      label: goalLabel.trim(),
      category: goalCategory,
      priority: goalPriority,
      age: Math.max(plan.currentAge + 1, Math.min(plan.horizonAge, Math.round(ageNum))),
      durationYears: durNum,
      amount: signedAmount,
    };

    onChangePlan({
      ...plan,
      goals: [...plan.goals, nextGoal],
    });
    setGoalLabel('');
  };

  const handleRemoveGoal = (id: string) => {
    onChangePlan({
      ...plan,
      goals: plan.goals.filter((g) => g.id !== id),
    });
  };

  const handleAddPortfolioPosition = () => {
    const sh = Number(newShares);
    const s = stocksMap[newSym];
    const cost = newCost.trim() ? Number(newCost) : s?.price ?? 100;
    if (!Number.isFinite(sh) || sh <= 0 || !Number.isFinite(cost) || cost <= 0) return;
    onAddHolding(newSym, sh, cost);
    setNewShares('50');
    setNewCost('');
  };

  // Fan Chart SVG coordinates
  const chartGeom = useMemo(() => {
    const W = 780;
    const H = 310;
    const padL = 68;
    const padR = 20;
    const padT = 22;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const rows = output.rows;
    const maxVal =
      Math.max(100_000, ...rows.map((r) => (showRealDollars ? r.p90Real : r.p90Nominal))) * 1.06;

    const xAt = (i: number) => padL + (i / Math.max(1, rows.length - 1)) * plotW;
    const yAt = (v: number) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;

    const buildLine = (getter: (r: (typeof rows)[number]) => number) =>
      rows
        .map((r, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(getter(r)).toFixed(1)}`)
        .join(' ');

    const buildBand = (
      upper: (r: (typeof rows)[number]) => number,
      lower: (r: (typeof rows)[number]) => number
    ) => {
      const top = rows.map(
        (r, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(upper(r)).toFixed(1)}`
      );
      const bot = [...rows]
        .reverse()
        .map(
          (r, ri) =>
            `L ${xAt(rows.length - 1 - ri).toFixed(1)} ${yAt(lower(r)).toFixed(1)}`
        );
      return [...top, ...bot, 'Z'].join(' ');
    };

    const getP10 = (r: (typeof rows)[number]) => (showRealDollars ? r.p10Real : r.p10Nominal);
    const getP50 = (r: (typeof rows)[number]) => (showRealDollars ? r.p50Real : r.p50Nominal);
    const getP90 = (r: (typeof rows)[number]) => (showRealDollars ? r.p90Real : r.p90Nominal);
    const getDet = (r: (typeof rows)[number]) => (showRealDollars ? r.endingReal : r.endingNominal);

    const retIdx = rows.findIndex((r) => r.age === plan.retirementAge);
    const spouseRetIdx = plan.spouse.enabled
      ? rows.findIndex((r) => r.spouseAge === plan.spouse.retirementAge)
      : -1;

    return {
      W,
      H,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      maxVal,
      xAt,
      yAt,
      band10to90: buildBand(getP90, getP10),
      lineP50: buildLine(getP50),
      lineP10: buildLine(getP10),
      lineP90: buildLine(getP90),
      lineDet: buildLine(getDet),
      retX: retIdx >= 0 ? xAt(retIdx) : null,
      spouseRetX:
        spouseRetIdx >= 0 && spouseRetIdx !== retIdx ? xAt(spouseRetIdx) : null,
    };
  }, [output.rows, showRealDollars, plan.retirementAge, plan.spouse.enabled, plan.spouse.retirementAge]);

  // SVG Donut segments for Asset Allocation Workbench
  const donutSegments = useMemo(() => {
    const r = 68;
    const circumference = 2 * Math.PI * r;
    let cumulativePct = 0;
    return ASSET_CLASS_META.map((meta) => {
      const pct = plan[meta.field];
      const dash = (pct / 100) * circumference;
      const offset = -(cumulativePct / 100) * circumference;
      cumulativePct += pct;
      return {
        ...meta,
        pct,
        dash,
        offset,
        circumference,
        dollars: (pct / 100) * output.startingCapital,
      };
    });
  }, [plan, output.startingCapital]);

  const totalEquityPct = plan.usEquitiesPct + plan.intlEquitiesPct;
  const totalDefensivePct = plan.fixedIncomePct + plan.cashPct;

  const totalEducationCost = useMemo(
    () => output.childSummaries.reduce((acc, c) => acc + c.totalProjectedCostNominal, 0),
    [output.childSummaries]
  );

  const totalEducationOop = useMemo(
    () => output.childSummaries.reduce((acc, c) => acc + c.netOutOfPocketNominal, 0),
    [output.childSummaries]
  );

  const inspectedRow =
    hoveredAgeIdx !== null
      ? output.rows[hoveredAgeIdx]
      : output.rows.find((r) => r.age === plan.retirementAge) ??
        output.rows[output.rows.length - 1];

  const successStatus =
    output.successProbabilityPct >= 85
      ? { label: 'On Track', cls: 'text-emerald-700 dark:text-emerald-400' }
      : output.successProbabilityPct >= 65
      ? { label: 'Moderate Risk', cls: 'text-amber-700 dark:text-amber-400' }
      : { label: 'Underfunded', cls: 'text-rose-700 dark:text-rose-400' };

  return (
    <div className="h-full overflow-y-auto p-5 lg:p-6 space-y-6 bg-[#F4F7FB] dark:bg-[#0B0F17]">
      {/* Header & Scenario Presets */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#D6E2F0] dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#012169] dark:text-white">
            Financial Planning &amp; Monte Carlo Engine
          </h1>
          <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-0.5">
            {plan.spouse.enabled
              ? `Joint Household (${plan.primaryName} & ${plan.spouse.name})`
              : `Individual Plan (${plan.primaryName})`}{' '}
            · {plan.children.length}{' '}
            {plan.children.length === 1 ? 'Child' : 'Children'} · {plan.goals.length} Goals ·
            350-Path Stochastic Simulation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md bg-white dark:bg-[#141B29] p-0.5 border border-[#C6D6EA] dark:border-slate-800">
            {Object.keys(PLAN_SCENARIO_PRESETS).map((name) => {
              const active = plan.scenarioName === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChangePlan({ ...plan, ...PLAN_SCENARIO_PRESETS[name] })}
                  className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#0052C2] text-white'
                      : 'text-[#012169] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4-Column Financial Plan Executive KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y lg:divide-y-0 lg:divide-x divide-[#D6E2F0] dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">
            Median Net Worth at Age {plan.retirementAge}
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
            {formatCompactCurrency(
              showRealDollars ? output.projectedRetirementReal : output.projectedRetirementNominal
            )}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
            {showRealDollars
              ? `Nominal ${formatCompactCurrency(output.projectedRetirementNominal)}`
              : `Today's $ ${formatCompactCurrency(output.projectedRetirementReal)}`}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">
            Safe Monthly Income ({plan.safeWithdrawalRate.toFixed(2)}% SWR)
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
            {formatCurrency(output.monthlySafeIncomeReal, 0)}/mo
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
            Target {formatCurrency(plan.annualRetirementSpending / 12, 0)}/mo · SS{' '}
            {formatCurrency(output.combinedSocialSecurityToday / 12, 0)}/mo
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">
            Monte Carlo Success (Age {plan.horizonAge})
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
            {output.successProbabilityPct}%
          </div>
          <div className={`mt-0.5 text-xs font-medium ${successStatus.cls}`}>
            {successStatus.label} · {output.expectedReturnPct}% E[R] · {output.expectedVolatilityPct}% σ
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-[#5A7190] dark:text-slate-400">
            Financial Independence Age
          </div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
            {output.fiAge !== null ? `Age ${output.fiAge}` : 'Not Reached'}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
            Saving {formatCompactCurrency(output.combinedAnnualContribution)}/yr · FI{' '}
            {formatCompactCurrency(output.fiTargetReal)}
          </div>
        </div>
      </div>

      {/* Main Split: Left Household & Model Inputs | Right Analytical Workbench */}
      <div className="grid grid-cols-1 xl:grid-cols-[356px_1fr] gap-6 items-start">
        {/* Left Control Column */}
        <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] divide-y divide-[#D6E2F0] dark:divide-slate-800">
          {/* Primary Profile & Capital */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                Primary Client &amp; Capital
              </h2>
              <span className="text-[11px] font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
                Start {formatCompactCurrency(output.startingCapital)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block col-span-2">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Primary Name</span>
                <input
                  type="text"
                  value={plan.primaryName}
                  onChange={(e) => onChangePlan({ ...plan, primaryName: e.target.value })}
                  className={TEXT_INPUT_CLS}
                />
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Current Age</span>
                <input
                  type="number"
                  min={18}
                  max={80}
                  value={plan.currentAge}
                  onChange={(e) => {
                    const v = Math.max(
                      18,
                      Math.min(plan.retirementAge - 1, Number(e.target.value) || 18)
                    );
                    onChangePlan({ ...plan, currentAge: v });
                  }}
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Retire Age</span>
                <input
                  type="number"
                  min={plan.currentAge + 1}
                  max={plan.horizonAge - 1}
                  value={plan.retirementAge}
                  onChange={(e) => {
                    const v = Math.max(
                      plan.currentAge + 1,
                      Math.min(plan.horizonAge - 1, Number(e.target.value) || 60)
                    );
                    onChangePlan({ ...plan, retirementAge: v });
                  }}
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Horizon Age</span>
                <input
                  type="number"
                  min={plan.retirementAge + 5}
                  max={105}
                  value={plan.horizonAge}
                  onChange={(e) => {
                    const v = Math.max(
                      plan.retirementAge + 5,
                      Math.min(105, Number(e.target.value) || 92)
                    );
                    onChangePlan({ ...plan, horizonAge: v });
                  }}
                  className={INPUT_CLS}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Primary Savings ($/yr)
                </span>
                <input
                  type="number"
                  step={2000}
                  min={0}
                  value={plan.annualContribution}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      annualContribution: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Primary SS ($/yr)
                </span>
                <input
                  type="number"
                  step={1000}
                  min={0}
                  value={plan.socialSecurityAnnual}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      socialSecurityAnnual: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
            </div>

            <div className="pt-1 space-y-2">
              <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                <span className="text-[#334E73] dark:text-slate-300">
                  Sync Terminal Portfolio ({formatCompactCurrency(portfolioStats.totalValue)})
                </span>
                <input
                  type="checkbox"
                  checked={plan.syncWithPortfolio}
                  onChange={(e) =>
                    onChangePlan({ ...plan, syncWithPortfolio: e.target.checked })
                  }
                  className="accent-[#0052C2] w-4 h-4 rounded"
                />
              </label>

              {!plan.syncWithPortfolio && (
                <label className="block">
                  <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                    Manual Starting Capital ($)
                  </span>
                  <input
                    type="number"
                    step={10000}
                    min={0}
                    value={plan.manualStartingCapital}
                    onChange={(e) =>
                      onChangePlan({
                        ...plan,
                        manualStartingCapital: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className={INPUT_CLS}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Spouse / Partner Section */}
          <div className="p-4 space-y-3">
            <label className="flex items-center justify-between gap-2 cursor-pointer">
              <div>
                <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                  Spouse / Partner
                </h2>
                <p className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  {plan.spouse.enabled
                    ? `Joint savings ${formatCompactCurrency(output.combinedAnnualContribution)}/yr`
                    : 'Enable for joint retirement & Social Security'}
                </p>
              </div>
              <input
                type="checkbox"
                checked={plan.spouse.enabled}
                onChange={(e) => updateSpouse({ enabled: e.target.checked })}
                aria-label="Include spouse or partner"
                className="accent-[#0052C2] w-4 h-4 rounded shrink-0"
              />
            </label>

            {plan.spouse.enabled && (
              <div className="space-y-2.5 pt-1">
                <label className="block">
                  <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                    Spouse Name
                  </span>
                  <input
                    type="text"
                    value={plan.spouse.name}
                    onChange={(e) => updateSpouse({ name: e.target.value })}
                    className={TEXT_INPUT_CLS}
                  />
                </label>

                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">Age</span>
                    <input
                      type="number"
                      min={18}
                      max={85}
                      value={plan.spouse.currentAge}
                      onChange={(e) =>
                        updateSpouse({
                          currentAge: Math.max(18, Math.min(85, Number(e.target.value) || 18)),
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Retire Age
                    </span>
                    <input
                      type="number"
                      min={plan.spouse.currentAge + 1}
                      max={90}
                      value={plan.spouse.retirementAge}
                      onChange={(e) =>
                        updateSpouse({
                          retirementAge: Math.max(
                            plan.spouse.currentAge + 1,
                            Math.min(90, Number(e.target.value) || 62)
                          ),
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      SS Age
                    </span>
                    <input
                      type="number"
                      min={62}
                      max={70}
                      value={plan.spouse.socialSecurityAge}
                      onChange={(e) =>
                        updateSpouse({
                          socialSecurityAge: Math.max(
                            62,
                            Math.min(70, Number(e.target.value) || 67)
                          ),
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Income ($)
                    </span>
                    <input
                      type="number"
                      step={5000}
                      min={0}
                      value={plan.spouse.annualIncome}
                      onChange={(e) =>
                        updateSpouse({ annualIncome: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Savings ($)
                    </span>
                    <input
                      type="number"
                      step={2000}
                      min={0}
                      value={plan.spouse.annualContribution}
                      onChange={(e) =>
                        updateSpouse({
                          annualContribution: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      SS ($/yr)
                    </span>
                    <input
                      type="number"
                      step={1000}
                      min={0}
                      value={plan.spouse.socialSecurityAnnual}
                      onChange={(e) =>
                        updateSpouse({
                          socialSecurityAnnual: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className={INPUT_CLS}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Spending, Taxes & Inflation */}
          <div className="p-4 space-y-3">
            <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
              Household Spending &amp; Macro
            </h2>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Retire Spend ($/yr)
                </span>
                <input
                  type="number"
                  step={2500}
                  min={10000}
                  value={plan.annualRetirementSpending}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      annualRetirementSpending: Math.max(10000, Number(e.target.value) || 10000),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Safe Withdrawal (%)
                </span>
                <input
                  type="number"
                  step={0.25}
                  min={2}
                  max={7}
                  value={plan.safeWithdrawalRate}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      safeWithdrawalRate: Math.max(2, Math.min(7, Number(e.target.value) || 4)),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  General Inflation (%)
                </span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={10}
                  value={plan.inflationRate}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      inflationRate: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  College Inflation (%)
                </span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={12}
                  value={plan.educationInflationRate}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      educationInflationRate: Math.max(
                        0,
                        Math.min(12, Number(e.target.value) || 0)
                      ),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Eff. Tax Rate (%)
                </span>
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={45}
                  value={plan.retirementTaxRate}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      retirementTaxRate: Math.max(0, Math.min(45, Number(e.target.value) || 0)),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#5A7190] dark:text-slate-400">
                  Primary SS Age
                </span>
                <input
                  type="number"
                  min={62}
                  max={70}
                  value={plan.socialSecurityAge}
                  onChange={(e) =>
                    onChangePlan({
                      ...plan,
                      socialSecurityAge: Math.max(62, Math.min(70, Number(e.target.value) || 67)),
                    })
                  }
                  className={INPUT_CLS}
                />
              </label>
            </div>
          </div>

          {/* Children & Goals Quick Overview */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                Children &amp; Financial Goals
              </h2>
              <button
                type="button"
                onClick={() => setSubView('goals')}
                className="text-[11px] font-semibold text-[#0052C2] dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Manage All
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[#334E73] dark:text-slate-300">
                <span>Children Enrolled</span>
                <span className="font-mono tabular-nums font-medium text-[#012169] dark:text-white">
                  {plan.children.length} ({formatCompactCurrency(totalEducationCost)} est.)
                </span>
              </div>
              <div className="flex items-center justify-between text-[#334E73] dark:text-slate-300">
                <span>Active Goals</span>
                <span className="font-mono tabular-nums font-medium text-[#012169] dark:text-white">
                  {plan.goals.length} scheduled
                </span>
              </div>
            </div>
          </div>

          {/* Asset Allocation Compact Summary */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#012169] dark:text-slate-200">
                Asset Allocation Mix
              </h2>
              <button
                type="button"
                onClick={() => setSubView('allocation')}
                className="text-[11px] font-semibold text-[#0052C2] dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Edit Mix
              </button>
            </div>

            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[#E6EFFA] dark:bg-slate-800">
              {ASSET_CLASS_META.map((meta) => (
                <div
                  key={meta.field}
                  style={{ width: `${plan[meta.field]}%`, backgroundColor: meta.color }}
                  title={`${meta.shortLabel}: ${plan[meta.field]}%`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
              <span>
                {totalEquityPct}% Equity · {totalDefensivePct}% Bonds/Cash · {plan.alternativesPct}%
                Alts
              </span>
              <span className="text-[#0052C2] dark:text-blue-400 font-semibold">
                {output.expectedReturnPct}% E[R]
              </span>
            </div>
          </div>
        </div>

        {/* Right Analytical Viewport */}
        <div className="space-y-4 min-w-0">
          {/* Sub-View Switcher + Real/Nominal Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap rounded-md bg-white dark:bg-[#0E131D] p-1 border border-[#C6D6EA] dark:border-slate-800 gap-0.5">
              {(
                [
                  { id: 'projection', label: 'Wealth & Monte Carlo' },
                  {
                    id: 'goals',
                    label: `Children & Goals (${plan.children.length + plan.goals.length})`,
                  },
                  { id: 'allocation', label: 'Asset Allocation' },
                  { id: 'ledger', label: 'Cash Flow Ledger' },
                  { id: 'portfolio', label: `Portfolio (${holdings.length})` },
                ] as { id: PlannerSubView; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubView(tab.id)}
                  className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    subView === tab.id
                      ? 'bg-[#0052C2] text-white'
                      : 'text-[#334E73] dark:text-slate-400 hover:text-[#012169] dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-md bg-white dark:bg-[#0E131D] p-0.5 border border-[#C6D6EA] dark:border-slate-800 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setShowRealDollars(true)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                  showRealDollars
                    ? 'bg-[#012169] text-white dark:bg-slate-700'
                    : 'text-[#5A7190] dark:text-slate-400'
                }`}
              >
                Today&apos;s $ (Real)
              </button>
              <button
                type="button"
                onClick={() => setShowRealDollars(false)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap transition-colors ${
                  !showRealDollars
                    ? 'bg-[#012169] text-white dark:bg-slate-700'
                    : 'text-[#5A7190] dark:text-slate-400'
                }`}
              >
                Nominal $
              </button>
            </div>
          </div>

          {/* SUB-VIEW 1: WEALTH & MONTE CARLO */}
          {subView === 'projection' && (
            <div className="space-y-4">
              <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5 space-y-5">
                {/* Inspected Age Readout Strip */}
                {inspectedRow && (
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-[#D6E2F0] dark:border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#012169] dark:text-white">
                        {plan.primaryName} Age {inspectedRow.age}
                        {inspectedRow.spouseAge !== null
                          ? ` / ${plan.spouse.name} ${inspectedRow.spouseAge}`
                          : ''}{' '}
                        ({inspectedRow.year})
                      </span>
                      <span className="text-[#94A3B8]">·</span>
                      <span className="text-[#5A7190] dark:text-slate-400">
                        {inspectedRow.phase}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums">
                      <div>
                        <span className="text-[#5A7190] dark:text-slate-400 mr-1.5">
                          P10 Downside
                        </span>
                        <span className="text-rose-700 dark:text-rose-400 font-medium">
                          {formatCompactCurrency(
                            showRealDollars ? inspectedRow.p10Real : inspectedRow.p10Nominal
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5A7190] dark:text-slate-400 mr-1.5">
                          P50 Median
                        </span>
                        <span className="text-[#0052C2] dark:text-blue-400 font-semibold">
                          {formatCompactCurrency(
                            showRealDollars ? inspectedRow.p50Real : inspectedRow.p50Nominal
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5A7190] dark:text-slate-400 mr-1.5">
                          P90 Upside
                        </span>
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                          {formatCompactCurrency(
                            showRealDollars ? inspectedRow.p90Real : inspectedRow.p90Nominal
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Monte Carlo Fan Chart SVG */}
                <div className="w-full overflow-hidden">
                  <svg
                    viewBox={`0 0 ${chartGeom.W} ${chartGeom.H}`}
                    className="w-full h-auto select-none"
                    onMouseLeave={() => setHoveredAgeIdx(null)}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const relX = ((e.clientX - rect.left) / rect.width) * chartGeom.W;
                      const t = (relX - chartGeom.padL) / Math.max(1, chartGeom.plotW);
                      const idx = Math.max(
                        0,
                        Math.min(output.rows.length - 1, Math.round(t * (output.rows.length - 1)))
                      );
                      setHoveredAgeIdx(idx);
                    }}
                  >
                    {/* Y Gridlines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                      const val = chartGeom.maxVal * t;
                      const y = chartGeom.yAt(val);
                      return (
                        <g key={t}>
                          <line
                            x1={chartGeom.padL}
                            x2={chartGeom.W - chartGeom.padR}
                            y1={y}
                            y2={y}
                            className="stroke-[#E2ECF7] dark:stroke-slate-800"
                            strokeWidth="1"
                          />
                          <text
                            x={chartGeom.padL - 8}
                            y={y + 3}
                            textAnchor="end"
                            className="fill-[#5A7190] dark:fill-slate-400 text-[10px] font-mono"
                          >
                            {formatCompactCurrency(val)}
                          </text>
                        </g>
                      );
                    })}

                    {/* P10-P90 Shaded Confidence Band */}
                    <path
                      d={chartGeom.band10to90}
                      className="fill-[#0052C2]/12 dark:fill-blue-500/15"
                    />

                    {/* Spouse Retirement Vertical Marker */}
                    {chartGeom.spouseRetX !== null && (
                      <g>
                        <line
                          x1={chartGeom.spouseRetX}
                          x2={chartGeom.spouseRetX}
                          y1={chartGeom.padT}
                          y2={chartGeom.padT + chartGeom.plotH}
                          stroke="#0052C2"
                          strokeDasharray="3 4"
                          strokeWidth="1.2"
                        />
                        <text
                          x={chartGeom.spouseRetX + 5}
                          y={chartGeom.padT + 26}
                          className="fill-[#0052C2] dark:fill-blue-400 text-[10px] font-sans font-medium"
                        >
                          {plan.spouse.name} Retires ({plan.spouse.retirementAge})
                        </text>
                      </g>
                    )}

                    {/* Primary Retirement Age Vertical Marker */}
                    {chartGeom.retX !== null && (
                      <g>
                        <line
                          x1={chartGeom.retX}
                          x2={chartGeom.retX}
                          y1={chartGeom.padT}
                          y2={chartGeom.padT + chartGeom.plotH}
                          stroke="#D97706"
                          strokeDasharray="4 4"
                          strokeWidth="1.3"
                        />
                        <text
                          x={chartGeom.retX + 6}
                          y={chartGeom.padT + 11}
                          className="fill-amber-700 dark:fill-amber-400 text-[10px] font-sans font-semibold"
                        >
                          {plan.primaryName} Retires (Age {plan.retirementAge})
                        </text>
                      </g>
                    )}

                    {/* Percentile Lines */}
                    <path
                      d={chartGeom.lineP90}
                      fill="none"
                      stroke="#0F8A4B"
                      strokeWidth="1.2"
                      strokeDasharray="3 3"
                    />
                    <path
                      d={chartGeom.lineP10}
                      fill="none"
                      stroke="#DC2626"
                      strokeWidth="1.2"
                      strokeDasharray="3 3"
                    />
                    <path
                      d={chartGeom.lineDet}
                      fill="none"
                      stroke="#94A3B8"
                      strokeWidth="1.2"
                      strokeDasharray="2 3"
                    />
                    <path
                      d={chartGeom.lineP50}
                      fill="none"
                      stroke="#0052C2"
                      strokeWidth="2.4"
                    />

                    {/* X-Axis Age Ticks */}
                    {output.rows
                      .filter(
                        (_, idx) => idx === 0 || idx === output.rows.length - 1 || idx % 5 === 0
                      )
                      .map((r) => {
                        const idx = r.age - plan.currentAge;
                        const x = chartGeom.xAt(idx);
                        return (
                          <text
                            key={r.age}
                            x={x}
                            y={chartGeom.H - 10}
                            textAnchor="middle"
                            className="fill-[#5A7190] dark:fill-slate-400 text-[10px] font-mono"
                          >
                            Age {r.age}
                          </text>
                        );
                      })}

                    {/* Active Crosshair */}
                    {hoveredAgeIdx !== null && output.rows[hoveredAgeIdx] && (
                      <g>
                        <line
                          x1={chartGeom.xAt(hoveredAgeIdx)}
                          x2={chartGeom.xAt(hoveredAgeIdx)}
                          y1={chartGeom.padT}
                          y2={chartGeom.padT + chartGeom.plotH}
                          className="stroke-[#5A7190] dark:stroke-slate-500"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                        <circle
                          cx={chartGeom.xAt(hoveredAgeIdx)}
                          cy={chartGeom.yAt(
                            showRealDollars
                              ? output.rows[hoveredAgeIdx].p50Real
                              : output.rows[hoveredAgeIdx].p50Nominal
                          )}
                          r="4.5"
                          fill="#0052C2"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      </g>
                    )}
                  </svg>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-[#5A7190] dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#0052C2] inline-block" />
                    P50 Median
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-2 bg-[#0052C2]/20 inline-block rounded-xs" />
                    P10–P90 Confidence Band
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#0F8A4B] inline-block" />
                    P90 Upside
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-rose-600 inline-block" />
                    P10 Stress Case
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                    Deterministic Mean
                  </span>
                </div>
              </div>

              {/* Compact Household & Goal Health Summary Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#012169] dark:text-white">
                      Education Liability
                    </span>
                    <button
                      type="button"
                      onClick={() => setSubView('goals')}
                      className="text-[11px] font-medium text-[#0052C2] dark:text-blue-400 hover:underline"
                    >
                      Details
                    </button>
                  </div>
                  <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                    {formatCompactCurrency(totalEducationCost)}
                  </div>
                  <div className="mt-0.5 text-xs text-[#5A7190] dark:text-slate-400 font-mono tabular-nums">
                    {plan.children.length}{' '}
                    {plan.children.length === 1 ? 'child' : 'children'} ·{' '}
                    {formatCompactCurrency(totalEducationOop)} net out-of-pocket
                  </div>
                </div>

                <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#012169] dark:text-white">
                      Scheduled Goals
                    </span>
                    <button
                      type="button"
                      onClick={() => setSubView('goals')}
                      className="text-[11px] font-medium text-[#0052C2] dark:text-blue-400 hover:underline"
                    >
                      Edit Goals
                    </button>
                  </div>
                  <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                    {output.goalSummaries.length} Active
                  </div>
                  <div className="mt-0.5 text-xs text-[#5A7190] dark:text-slate-400 font-mono tabular-nums">
                    {output.goalSummaries.length > 0
                      ? `Min ${Math.min(
                          ...output.goalSummaries.map((g) => g.fundedProbabilityPct)
                        )}% Monte Carlo funded`
                      : 'No goals added yet'}
                  </div>
                </div>

                <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#012169] dark:text-white">
                      Portfolio Risk Profile
                    </span>
                    <button
                      type="button"
                      onClick={() => setSubView('allocation')}
                      className="text-[11px] font-medium text-[#0052C2] dark:text-blue-400 hover:underline"
                    >
                      Rebalance
                    </button>
                  </div>
                  <div className="mt-1.5 text-lg font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                    {totalEquityPct}/{totalDefensivePct + plan.alternativesPct} Mix
                  </div>
                  <div className="mt-0.5 text-xs text-[#5A7190] dark:text-slate-400 font-mono tabular-nums">
                    Sharpe {output.sharpeRatio.toFixed(2)} · 95% VaR {output.var95AnnualPct}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUB-VIEW 2: CHILDREN & GOALS */}
          {subView === 'goals' && (
            <div className="space-y-5">
              {/* Children & 529 Education Funding Panel */}
              <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                      Children &amp; 529 Education Funding
                    </h2>
                    <p className="text-xs text-[#5A7190] dark:text-slate-400">
                      Tuition escalates at {plan.educationInflationRate.toFixed(1)}%/yr · Existing
                      529 accounts compound at 6.0% pre-college and offset tuition before portfolio
                      withdrawals
                    </p>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[#012169] dark:text-slate-200">
                    Total Projected: <span className="font-semibold">{formatCompactCurrency(totalEducationCost)}</span>
                  </div>
                </div>

                {/* Children List Table */}
                {plan.children.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                          <th className="text-left py-2.5 px-3 font-sans font-medium">Child</th>
                          <th className="text-right py-2.5 px-2 font-medium">Age</th>
                          <th className="text-right py-2.5 px-2 font-medium">Start Age</th>
                          <th className="text-right py-2.5 px-2 font-medium">Yrs</th>
                          <th className="text-right py-2.5 px-2 font-medium">Cost/Yr Today</th>
                          <th className="text-right py-2.5 px-2 font-medium">529 Balance</th>
                          <th className="text-right py-2.5 px-3 font-medium">Projected Cost</th>
                          <th className="text-right py-2.5 px-3 font-medium">529 Funded</th>
                          <th className="text-right py-2.5 px-3 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EFFA] dark:divide-slate-800/60">
                        {plan.children.map((child) => {
                          const summary = output.childSummaries.find((s) => s.id === child.id);
                          const fundedPct = summary?.fundedPct ?? 0;
                          const fundedCls =
                            fundedPct >= 75
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : fundedPct >= 40
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-700 dark:text-rose-400';

                          return (
                            <tr
                              key={child.id}
                              className="hover:bg-[#F8FBFF] dark:hover:bg-[#141B29]"
                            >
                              <td className="py-2 px-3 font-sans">
                                <input
                                  type="text"
                                  value={child.name}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, { name: e.target.value })
                                  }
                                  aria-label="Child name"
                                  className="w-28 px-2 py-1 text-xs rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  min={0}
                                  max={24}
                                  value={child.currentAge}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, {
                                      currentAge: Math.max(0, Math.min(24, Number(e.target.value) || 0)),
                                    })
                                  }
                                  aria-label={`${child.name} age`}
                                  className="w-14 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  min={16}
                                  max={26}
                                  value={child.collegeStartAge}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, {
                                      collegeStartAge: Math.max(
                                        16,
                                        Math.min(26, Number(e.target.value) || 18)
                                      ),
                                    })
                                  }
                                  aria-label={`${child.name} college start age`}
                                  className="w-14 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  min={1}
                                  max={8}
                                  value={child.collegeYears}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, {
                                      collegeYears: Math.max(1, Math.min(8, Number(e.target.value) || 4)),
                                    })
                                  }
                                  aria-label={`${child.name} college years`}
                                  className="w-12 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  step={2000}
                                  min={0}
                                  value={child.annualCollegeCost}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, {
                                      annualCollegeCost: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  aria-label={`${child.name} annual college cost`}
                                  className="w-24 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-2 text-right">
                                <input
                                  type="number"
                                  step={2500}
                                  min={0}
                                  value={child.existing529Balance}
                                  onChange={(e) =>
                                    handleUpdateChild(child.id, {
                                      existing529Balance: Math.max(0, Number(e.target.value) || 0),
                                    })
                                  }
                                  aria-label={`${child.name} 529 balance`}
                                  className="w-24 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                                />
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-[#012169] dark:text-white">
                                {formatCompactCurrency(summary?.totalProjectedCostNominal ?? 0)}
                              </td>
                              <td className={`py-2 px-3 text-right font-medium ${fundedCls}`}>
                                {fundedPct}% ({formatCompactCurrency(summary?.projected529AtStart ?? 0)})
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveChild(child.id)}
                                  aria-label={`Remove ${child.name}`}
                                  className="p-1 text-[#5A7190] hover:text-rose-600"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-[#5A7190] dark:text-slate-400">
                    No children added. Use the form below to model college tuition and 529 balances.
                  </div>
                )}

                {/* Add Child Inline Form */}
                <div className="p-4 border-t border-[#D6E2F0] dark:border-slate-800 bg-[#F8FBFF] dark:bg-[#111724]">
                  <div className="text-[11px] font-semibold text-[#012169] dark:text-slate-300 mb-2">
                    Add Child / Dependent
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[1.2fr_70px_80px_64px_110px_110px_auto] gap-2 items-end">
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">Name</span>
                      <input
                        type="text"
                        placeholder={`Child ${plan.children.length + 1}`}
                        value={childName}
                        onChange={(e) => setChildName(e.target.value)}
                        className={TEXT_INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">Age</span>
                      <input
                        type="number"
                        min={0}
                        max={24}
                        value={childAge}
                        onChange={(e) => setChildAge(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Start Age
                      </span>
                      <input
                        type="number"
                        min={16}
                        max={26}
                        value={childCollegeAge}
                        onChange={(e) => setChildCollegeAge(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">Yrs</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={childYears}
                        onChange={(e) => setChildYears(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Tuition/Yr ($)
                      </span>
                      <input
                        type="number"
                        step={2000}
                        min={0}
                        value={childAnnualCost}
                        onChange={(e) => setChildAnnualCost(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        529 Bal ($)
                      </span>
                      <input
                        type="number"
                        step={2500}
                        min={0}
                        value={child529}
                        onChange={(e) => setChild529(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAddChild}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1.5 h-[30px] rounded text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white whitespace-nowrap transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Child</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Financial Goals & Monte Carlo Funding Probability */}
              <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                      Financial Goals &amp; Funding Probability
                    </h2>
                    <p className="text-xs text-[#5A7190] dark:text-slate-400">
                      One-time or recurring household goals inflation-indexed to target age and
                      stress-tested across 350 Monte Carlo paths
                    </p>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
                    {plan.goals.length} goals modeled
                  </span>
                </div>

                {output.goalSummaries.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                          <th className="text-left py-2.5 px-4 font-sans font-medium">Goal</th>
                          <th className="text-left py-2.5 px-3 font-sans font-medium">
                            Category · Priority
                          </th>
                          <th className="text-right py-2.5 px-3 font-medium">Target Age / Yr</th>
                          <th className="text-right py-2.5 px-3 font-medium">Duration</th>
                          <th className="text-right py-2.5 px-3 font-medium">Today&apos;s $</th>
                          <th className="text-right py-2.5 px-3 font-medium">Nominal $</th>
                          <th className="text-right py-2.5 px-3 font-medium">MC Funded</th>
                          <th className="text-right py-2.5 px-3 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E6EFFA] dark:divide-slate-800/60">
                        {output.goalSummaries.map((g) => {
                          const isInflow = g.totalTodayDollars >= 0;
                          const probStatus =
                            g.fundedProbabilityPct >= 85
                              ? { text: 'High', cls: 'text-emerald-700 dark:text-emerald-400' }
                              : g.fundedProbabilityPct >= 65
                              ? { text: 'Moderate', cls: 'text-amber-700 dark:text-amber-400' }
                              : { text: 'At Risk', cls: 'text-rose-700 dark:text-rose-400' };

                          return (
                            <tr
                              key={g.id}
                              className="hover:bg-[#F8FBFF] dark:hover:bg-[#141B29]"
                            >
                              <td className="py-2.5 px-4 font-sans font-medium text-[#012169] dark:text-white">
                                {g.label}
                              </td>
                              <td className="py-2.5 px-3 font-sans text-[#5A7190] dark:text-slate-400 whitespace-nowrap">
                                {g.category} ·{' '}
                                <span
                                  className={
                                    g.priority === 'Essential'
                                      ? 'font-semibold text-[#012169] dark:text-slate-200'
                                      : ''
                                  }
                                >
                                  {g.priority}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#0A1F44] dark:text-slate-200 whitespace-nowrap">
                                Age {g.targetAge} · {g.targetYear}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#5A7190] dark:text-slate-400">
                                {g.durationYears === 1 ? 'One-time' : `${g.durationYears} yrs`}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-medium ${
                                  isInflow
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-rose-700 dark:text-rose-400'
                                }`}
                              >
                                {isInflow ? '+' : ''}
                                {formatCompactCurrency(g.totalTodayDollars)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-[#334E73] dark:text-slate-300">
                                {isInflow ? '+' : ''}
                                {formatCompactCurrency(g.totalNominalDollars)}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-semibold ${probStatus.cls}`}>
                                {g.fundedProbabilityPct}% ({probStatus.text})
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveGoal(g.id)}
                                  aria-label={`Delete ${g.label}`}
                                  className="p-1 text-[#5A7190] hover:text-rose-600"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-6 text-center text-xs text-[#5A7190] dark:text-slate-400">
                    No goals scheduled yet. Add a home purchase, travel plan, legacy gift, or
                    expected windfall below.
                  </div>
                )}

                {/* Add Goal Form */}
                <div className="p-4 border-t border-[#D6E2F0] dark:border-slate-800 bg-[#F8FBFF] dark:bg-[#111724]">
                  <div className="text-[11px] font-semibold text-[#012169] dark:text-slate-300 mb-2">
                    Add Financial Goal or Cash Flow Event
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[1.4fr_110px_100px_72px_70px_92px_108px_auto] gap-2 items-end">
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Goal Description
                      </span>
                      <input
                        type="text"
                        placeholder="e.g. Vacation Home"
                        value={goalLabel}
                        onChange={(e) => setGoalLabel(e.target.value)}
                        className={TEXT_INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Category
                      </span>
                      <select
                        value={goalCategory}
                        onChange={(e) => {
                          const cat = e.target.value as GoalCategory;
                          setGoalCategory(cat);
                          if (cat === 'Windfall') setGoalFlowType('inflow');
                        }}
                        className={TEXT_INPUT_CLS}
                      >
                        {GOAL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Priority
                      </span>
                      <select
                        value={goalPriority}
                        onChange={(e) => setGoalPriority(e.target.value as GoalPriority)}
                        className={TEXT_INPUT_CLS}
                      >
                        {GOAL_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Start Age
                      </span>
                      <input
                        type="number"
                        min={plan.currentAge + 1}
                        max={plan.horizonAge}
                        value={goalAge}
                        onChange={(e) => setGoalAge(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Years
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={goalDuration}
                        onChange={(e) => setGoalDuration(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Direction
                      </span>
                      <select
                        value={goalCategory === 'Windfall' ? 'inflow' : goalFlowType}
                        onChange={(e) =>
                          setGoalFlowType(e.target.value as 'outflow' | 'inflow')
                        }
                        className={TEXT_INPUT_CLS}
                      >
                        <option value="outflow">Expense (-)</option>
                        <option value="inflow">Inflow (+)</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#5A7190] dark:text-slate-400">
                        Amount/Yr ($)
                      </span>
                      <input
                        type="number"
                        step={5000}
                        min={1000}
                        value={goalAmount}
                        onChange={(e) => setGoalAmount(e.target.value)}
                        className={INPUT_CLS}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAddGoal}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1.5 h-[30px] rounded text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white whitespace-nowrap transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Goal</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SUB-VIEW 3: ASSET ALLOCATION WORKBENCH */}
          {subView === 'allocation' && (
            <div className="space-y-5">
              {/* Model Portfolio Presets */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {MODEL_ALLOCATION_PRESETS.map((preset) => {
                  const isCurrent =
                    plan.usEquitiesPct === preset.usEquitiesPct &&
                    plan.intlEquitiesPct === preset.intlEquitiesPct &&
                    plan.fixedIncomePct === preset.fixedIncomePct &&
                    plan.alternativesPct === preset.alternativesPct &&
                    plan.cashPct === preset.cashPct;

                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() =>
                        onChangePlan({
                          ...plan,
                          usEquitiesPct: preset.usEquitiesPct,
                          intlEquitiesPct: preset.intlEquitiesPct,
                          fixedIncomePct: preset.fixedIncomePct,
                          alternativesPct: preset.alternativesPct,
                          cashPct: preset.cashPct,
                        })
                      }
                      className={`text-left p-3.5 rounded-lg border transition-colors ${
                        isCurrent
                          ? 'bg-[#EAF2FD] dark:bg-[#0052C2]/20 border-[#0052C2] text-[#012169] dark:text-white'
                          : 'bg-white dark:bg-[#0E131D] border-[#D6E2F0] dark:border-slate-800 hover:border-[#0052C2]/60 text-[#012169] dark:text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{preset.name}</div>
                      <div className="text-[11px] text-[#5A7190] dark:text-slate-400 mt-0.5">
                        {preset.subtitle}
                      </div>
                      <div className="mt-2.5 h-1.5 w-full rounded-full overflow-hidden flex bg-[#E6EFFA] dark:bg-slate-800">
                        <div style={{ width: `${preset.usEquitiesPct}%`, backgroundColor: '#012169' }} />
                        <div style={{ width: `${preset.intlEquitiesPct}%`, backgroundColor: '#0052C2' }} />
                        <div style={{ width: `${preset.fixedIncomePct}%`, backgroundColor: '#3B82F6' }} />
                        <div style={{ width: `${preset.alternativesPct}%`, backgroundColor: '#0F8A4B' }} />
                        <div style={{ width: `${preset.cashPct}%`, backgroundColor: '#94A3B8' }} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Donut Chart + 5-Class Sliders */}
              <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] p-5 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-center">
                {/* Interactive SVG Donut */}
                <div className="flex flex-col items-center">
                  <svg viewBox="0 0 180 180" className="w-48 h-48">
                    <circle
                      cx="90"
                      cy="90"
                      r="68"
                      fill="none"
                      className="stroke-[#E6EFFA] dark:stroke-slate-800"
                      strokeWidth="20"
                    />
                    <g transform="rotate(-90 90 90)">
                      {donutSegments.map((seg) =>
                        seg.pct > 0 ? (
                          <circle
                            key={seg.field}
                            cx="90"
                            cy="90"
                            r="68"
                            fill="none"
                            stroke={seg.color}
                            strokeWidth="20"
                            strokeDasharray={`${seg.dash} ${seg.circumference}`}
                            strokeDashoffset={seg.offset}
                          />
                        ) : null
                      )}
                    </g>
                    <text
                      x="90"
                      y="84"
                      textAnchor="middle"
                      className="fill-[#012169] dark:fill-white text-[18px] font-bold font-mono"
                    >
                      {totalEquityPct}%
                    </text>
                    <text
                      x="90"
                      y="100"
                      textAnchor="middle"
                      className="fill-[#5A7190] dark:fill-slate-400 text-[10px] font-sans"
                    >
                      Total Equities
                    </text>
                    <text
                      x="90"
                      y="114"
                      textAnchor="middle"
                      className="fill-[#0052C2] dark:fill-blue-400 text-[10px] font-mono font-medium"
                    >
                      {100 - totalEquityPct}% Non-Equity
                    </text>
                  </svg>
                </div>

                {/* 5 Auto-Normalizing Asset Class Sliders */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between border-b border-[#D6E2F0] dark:border-slate-800 pb-2">
                    <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                      Target Asset Allocation Weights
                    </h2>
                    <span className="text-xs font-mono tabular-nums text-[#5A7190] dark:text-slate-400">
                      Total:{' '}
                      <span className="font-semibold text-[#012169] dark:text-white">
                        {plan.usEquitiesPct +
                          plan.intlEquitiesPct +
                          plan.fixedIncomePct +
                          plan.alternativesPct +
                          plan.cashPct}
                        %
                      </span>
                    </span>
                  </div>

                  {ASSET_CLASS_META.map((meta) => {
                    const weight = plan[meta.field];
                    const dollars = (weight / 100) * output.startingCapital;
                    return (
                      <div key={meta.field} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 text-[#0A1F44] dark:text-slate-200 font-medium">
                            <span
                              className="w-2.5 h-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: meta.color }}
                            />
                            {meta.label}
                          </span>
                          <div className="flex items-center gap-3 font-mono tabular-nums">
                            <span className="text-[#5A7190] dark:text-slate-400 hidden sm:inline">
                              {formatCompactCurrency(dollars)}
                            </span>
                            <span className="font-semibold text-[#012169] dark:text-white w-10 text-right">
                              {weight}%
                            </span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={weight}
                          onChange={(e) => updateAllocation(meta.field, Number(e.target.value))}
                          className="w-full h-1.5 accent-[#0052C2] cursor-pointer bg-[#DCE8F6] dark:bg-slate-800 rounded-lg"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Risk & Return Attribution Table + Portfolio Analytics */}
              <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#D6E2F0] dark:divide-slate-800 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F8FBFF] dark:bg-[#111724]">
                  <div className="p-3.5">
                    <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Expected Return E[R]
                    </div>
                    <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                      {output.expectedReturnPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Portfolio Volatility (σ)
                    </div>
                    <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                      {output.expectedVolatilityPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      Sharpe Ratio (Rf 4.0%)
                    </div>
                    <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-[#0052C2] dark:text-blue-400">
                      {output.sharpeRatio.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-3.5">
                    <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                      1-in-20 Year Stress (95% VaR)
                    </div>
                    <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-rose-700 dark:text-rose-400">
                      {output.var95AnnualPct > 0 ? '+' : ''}
                      {output.var95AnnualPct.toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                        <th className="text-left py-2.5 px-4 font-sans font-medium">Asset Class</th>
                        <th className="text-right py-2.5 px-3 font-medium">Target Weight</th>
                        <th className="text-right py-2.5 px-3 font-medium">Capital Allocation</th>
                        <th className="text-right py-2.5 px-3 font-medium">Assumed E[R]</th>
                        <th className="text-right py-2.5 px-3 font-medium">Assumed σ</th>
                        <th className="text-right py-2.5 px-4 font-medium">Return Contrib.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EFFA] dark:divide-slate-800/60">
                      {donutSegments.map((seg) => (
                        <tr
                          key={seg.field}
                          className="hover:bg-[#F8FBFF] dark:hover:bg-[#141B29]"
                        >
                          <td className="py-2.5 px-4 font-sans text-[#012169] dark:text-slate-100 font-medium">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-xs shrink-0"
                                style={{ backgroundColor: seg.color }}
                              />
                              {seg.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-[#012169] dark:text-white">
                            {seg.pct}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#334E73] dark:text-slate-300">
                            {formatCurrency(seg.dollars, 0)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-emerald-400">
                            {seg.expectedReturnPct.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#5A7190] dark:text-slate-400">
                            {seg.volatilityPct.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium text-[#0052C2] dark:text-blue-400">
                            +{((seg.pct / 100) * seg.expectedReturnPct).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUB-VIEW 4: ANNUAL CASH FLOW LEDGER */}
          {subView === 'ledger' && (
            <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                  Year-by-Year Household Cash Flow &amp; Balance Schedule
                </h2>
                <span className="text-xs text-[#5A7190] dark:text-slate-400">
                  {output.rows.length} projected years
                </span>
              </div>
              <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                <table className="w-full text-xs border-collapse font-mono tabular-nums">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                      <th className="text-left py-2.5 px-3 font-sans font-medium whitespace-nowrap">
                        {plan.spouse.enabled ? 'Ages / Yr' : 'Age / Yr'}
                      </th>
                      <th className="text-left py-2.5 px-3 font-sans font-medium">Phase</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Savings</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Education</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Goals</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Soc. Sec.</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Withdrawal</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Taxes</th>
                      <th className="text-right py-2.5 px-2.5 font-medium">Growth</th>
                      <th className="text-right py-2.5 px-3 font-medium">
                        Ending ({showRealDollars ? 'Real' : 'Nom'})
                      </th>
                      <th className="text-right py-2.5 px-3 font-medium">P10 Stress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EFFA] dark:divide-slate-800/60">
                    {output.rows.map((row) => (
                      <tr
                        key={row.age}
                        className={`hover:bg-[#F8FBFF] dark:hover:bg-[#141B29] ${
                          row.age === plan.retirementAge
                            ? 'bg-amber-50/80 dark:bg-amber-950/20 font-semibold'
                            : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-[#012169] dark:text-slate-100 whitespace-nowrap">
                          {row.spouseAge !== null ? `${row.age}/${row.spouseAge}` : row.age} ·{' '}
                          {row.year}
                        </td>
                        <td className="py-2 px-3 font-sans text-[#5A7190] dark:text-slate-400">
                          {row.phase}
                        </td>
                        <td className="py-2 px-2.5 text-right text-emerald-700 dark:text-emerald-400">
                          {row.contribution > 0 ? `+${formatCompactCurrency(row.contribution)}` : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right text-rose-700 dark:text-rose-400">
                          {row.educationOutflow > 0
                            ? `-${formatCompactCurrency(row.educationOutflow)}`
                            : '—'}
                        </td>
                        <td
                          className={`py-2 px-2.5 text-right ${
                            row.goalFlow > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : row.goalFlow < 0
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {row.goalFlow !== 0
                            ? `${row.goalFlow > 0 ? '+' : ''}${formatCompactCurrency(row.goalFlow)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right text-[#0052C2] dark:text-blue-400">
                          {row.socialSecurity > 0
                            ? `+${formatCompactCurrency(row.socialSecurity)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right text-rose-700 dark:text-rose-400">
                          {row.withdrawal > 0 ? `-${formatCompactCurrency(row.withdrawal)}` : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right text-[#5A7190] dark:text-slate-400">
                          {row.taxesPaid > 0 ? formatCompactCurrency(row.taxesPaid) : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-right text-[#334E73] dark:text-slate-300">
                          {row.investmentGrowth > 0
                            ? `+${formatCompactCurrency(row.investmentGrowth)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-[#012169] dark:text-white">
                          {formatCompactCurrency(showRealDollars ? row.p50Real : row.p50Nominal)}
                        </td>
                        <td className="py-2 px-3 text-right text-[#5A7190] dark:text-slate-400">
                          {formatCompactCurrency(showRealDollars ? row.p10Real : row.p10Nominal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUB-VIEW 5: PORTFOLIO BRIDGE */}
          {subView === 'portfolio' && (
            <div className="border border-[#D6E2F0] dark:border-slate-800 rounded-lg bg-white dark:bg-[#0E131D] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#D6E2F0] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#012169] dark:text-white">
                    Live Terminal Portfolio Holdings
                  </h2>
                  <p className="text-xs text-[#5A7190] dark:text-slate-400">
                    Total Value {formatCurrency(portfolioStats.totalValue, 2)} · Unrealized P&amp;L{' '}
                    <span
                      className={
                        portfolioStats.totalPnl >= 0
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-rose-700 dark:text-rose-400 font-medium'
                      }
                    >
                      {portfolioStats.totalPnl >= 0 ? '+' : ''}
                      {formatCurrency(portfolioStats.totalPnl, 0)} (
                      {portfolioStats.totalPnlPct.toFixed(1)}%)
                    </span>{' '}
                    · Est. Dividends {formatCurrency(portfolioStats.annualDividends, 0)}/yr
                  </p>
                </div>

                {/* Add Position Inline Bar */}
                <div className="flex items-center gap-1.5">
                  <select
                    value={newSym}
                    onChange={(e) => setNewSym(e.target.value)}
                    aria-label="Select ticker"
                    className="px-2 py-1.5 text-xs font-mono rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                  >
                    {availableSymbols.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    placeholder="Shares"
                    value={newShares}
                    onChange={(e) => setNewShares(e.target.value)}
                    className="w-20 px-2 py-1.5 text-xs font-mono tabular-nums rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                  />
                  <input
                    type="number"
                    step={0.01}
                    placeholder="Avg Cost"
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
                    className="w-24 px-2 py-1.5 text-xs font-mono tabular-nums rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddPortfolioPosition}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold bg-[#0052C2] hover:bg-[#012169] text-white whitespace-nowrap transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {portfolioStats.enriched.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#5A7190] dark:text-slate-400">
                  No holdings in portfolio yet. Add a ticker above or from the Charting view to sync
                  starting capital.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#111724] text-[#5A7190] dark:text-slate-400">
                        <th className="text-left py-2.5 px-4 font-sans font-medium">Ticker</th>
                        <th className="text-right py-2.5 px-3 font-medium">Shares</th>
                        <th className="text-right py-2.5 px-3 font-medium">Avg Cost</th>
                        <th className="text-right py-2.5 px-3 font-medium">Last Price</th>
                        <th className="text-right py-2.5 px-3 font-medium">Market Value</th>
                        <th className="text-right py-2.5 px-3 font-medium">Unrealized P&amp;L</th>
                        <th className="text-right py-2.5 px-3 font-medium">Weight</th>
                        <th className="text-right py-2.5 px-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EFFA] dark:divide-slate-800/60">
                      {portfolioStats.enriched.map((pos) => {
                        const weight =
                          portfolioStats.totalValue > 0
                            ? (pos.marketValue / portfolioStats.totalValue) * 100
                            : 0;
                        return (
                          <tr
                            key={pos.id}
                            className="hover:bg-[#F8FBFF] dark:hover:bg-[#141B29] transition-colors"
                          >
                            <td className="py-2.5 px-4 font-sans">
                              <button
                                type="button"
                                onClick={() => onSelectSymbol(pos.symbol)}
                                className="font-mono font-semibold text-[#0052C2] dark:text-blue-400 hover:underline mr-2"
                              >
                                {pos.symbol}
                              </button>
                              <span className="text-[#5A7190] dark:text-slate-400 hidden sm:inline">
                                {pos.name}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                min={1}
                                value={pos.shares}
                                onChange={(e) =>
                                  onUpdateHolding(
                                    pos.id,
                                    Math.max(1, Number(e.target.value) || 1),
                                    pos.avgCost
                                  )
                                }
                                aria-label={`${pos.symbol} shares`}
                                className="w-20 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step={0.1}
                                min={0.01}
                                value={pos.avgCost}
                                onChange={(e) =>
                                  onUpdateHolding(
                                    pos.id,
                                    pos.shares,
                                    Math.max(0.01, Number(e.target.value) || 1)
                                  )
                                }
                                aria-label={`${pos.symbol} average cost`}
                                className="w-24 text-right px-1.5 py-1 rounded bg-[#F4F7FB] dark:bg-[#141B29] border border-[#C6D6EA] dark:border-slate-800 text-[#0A1F44] dark:text-white"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right text-[#012169] dark:text-slate-100">
                              ${pos.livePrice.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-[#012169] dark:text-white">
                              {formatCurrency(pos.marketValue, 0)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-medium ${
                                pos.pnl >= 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-rose-700 dark:text-rose-400'
                              }`}
                            >
                              {pos.pnl >= 0 ? '+' : ''}
                              {formatCurrency(pos.pnl, 0)} ({pos.pnlPct >= 0 ? '+' : ''}
                              {pos.pnlPct.toFixed(1)}%)
                            </td>
                            <td className="py-2.5 px-3 text-right text-[#5A7190] dark:text-slate-300">
                              {weight.toFixed(1)}%
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => onRemoveHolding(pos.id)}
                                aria-label={`Remove ${pos.symbol}`}
                                className="p-1 text-[#5A7190] hover:text-rose-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
