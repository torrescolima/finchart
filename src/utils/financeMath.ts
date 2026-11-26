import {
  AnnualPlanRow,
  DcfAssumptions,
  FinancialPlanInputs,
  FinancialPlanOutput,
  StockProfile,
} from '../types/market';

export interface DcfProjectionYear {
  year: number;
  label: string;
  revGrowthPct: number;
  revenue: number;
  ebitMarginPct: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  deltaNwc: number;
  ebitda: number;
  ufcf: number;
  discountFactor: number;
  pvUfcf: number;
}

export interface DcfResult {
  costOfEquityPct: number;
  afterTaxCostOfDebtPct: number;
  waccPct: number;
  years: DcfProjectionYear[];
  sumPvUfcf: number;
  terminalValue: number;
  pvTerminalValue: number;
  terminalValueSharePct: number;
  enterpriseValueM: number;
  netDebtM: number;
  equityValueM: number;
  impliedSharePrice: number;
  upsidePct: number;
  sensitivityWaccAxis: number[];
  sensitivityTermAxis: number[];
  sensitivityMatrix: number[][];
}

export function computeDcfValuation(stock: StockProfile, a: DcfAssumptions): DcfResult {
  const fy25 = stock.annualFinancials[stock.annualFinancials.length - 1];
  const baseRev = fy25.revenue;
  const baseEbitMargin = stock.operatingMargin;

  const costOfEquityPct = a.riskFreeRate + a.beta * a.equityRiskPremium;
  const afterTaxCostOfDebtPct = a.costOfDebt * (1 - a.taxRate / 100);
  const wd = Math.max(0, Math.min(80, a.debtWeight)) / 100;
  const we = 1 - wd;
  const waccPct = Math.max(4.5, we * costOfEquityPct + wd * afterTaxCostOfDebtPct);

  const runForParams = (waccRatePct: number, termParam: number) => {
    const wacc = waccRatePct / 100;
    const years: DcfProjectionYear[] = [];
    let prevRev = baseRev;
    let sumPvUfcf = 0;

    for (let yr = 1; yr <= 5; yr++) {
      const t = (yr - 1) / 4;
      const revGrowthPct = a.revGrowthYr1 + (a.revGrowthYr5 - a.revGrowthYr1) * t;
      const revenue = prevRev * (1 + revGrowthPct / 100);
      const ebitMarginPct = baseEbitMargin + (a.targetEbitMargin - baseEbitMargin) * (yr / 5);
      const ebit = revenue * (ebitMarginPct / 100);
      const nopat = ebit * (1 - a.taxRate / 100);
      const da = revenue * (a.daPctRev / 100);
      const capex = revenue * (a.capexPctRev / 100);
      const deltaNwc = (revenue - prevRev) * (a.nwcPctRevChange / 100);
      const ebitda = ebit + da;
      const ufcf = nopat + da - capex - deltaNwc;
      const discountFactor = 1 / Math.pow(1 + wacc, yr);
      const pvUfcf = ufcf * discountFactor;
      sumPvUfcf += pvUfcf;

      years.push({
        year: 2025 + yr,
        label: `FY${String(25 + yr)}E`,
        revGrowthPct,
        revenue,
        ebitMarginPct,
        ebit,
        nopat,
        da,
        capex,
        deltaNwc,
        ebitda,
        ufcf,
        discountFactor,
        pvUfcf,
      });

      prevRev = revenue;
    }

    const lastYr = years[years.length - 1];
    let terminalValue = 0;
    if (a.terminalMethod === 'perpetuity') {
      const g = Math.min(wacc - 0.01, termParam / 100);
      terminalValue = (lastYr.ufcf * (1 + g)) / Math.max(0.01, wacc - g);
    } else {
      terminalValue = lastYr.ebitda * termParam;
    }

    const pvTerminalValue = terminalValue / Math.pow(1 + wacc, 5);
    const enterpriseValueM = sumPvUfcf + pvTerminalValue;
    const equityValueM = Math.max(0, enterpriseValueM - stock.netDebtM);
    const impliedSharePrice = equityValueM / Math.max(1, stock.sharesOutM);

    return {
      years,
      sumPvUfcf,
      terminalValue,
      pvTerminalValue,
      enterpriseValueM,
      equityValueM,
      impliedSharePrice,
    };
  };

  const baseTermParam = a.terminalMethod === 'perpetuity' ? a.terminalGrowth : a.exitMultiple;
  const primary = runForParams(waccPct, baseTermParam);
  const upsidePct = ((primary.impliedSharePrice - stock.price) / Math.max(0.01, stock.price)) * 100;
  const terminalValueSharePct =
    primary.enterpriseValueM > 0 ? (primary.pvTerminalValue / primary.enterpriseValueM) * 100 : 0;

  // 5x5 Sensitivity Grid
  const waccOffsets = [-1.0, -0.5, 0, 0.5, 1.0];
  const termOffsets =
    a.terminalMethod === 'perpetuity' ? [-0.5, -0.25, 0, 0.25, 0.5] : [-3, -1.5, 0, 1.5, 3];

  const sensitivityWaccAxis = waccOffsets.map((d) => Number(Math.max(4.5, waccPct + d).toFixed(2)));
  const sensitivityTermAxis = termOffsets.map((d) =>
    Number(
      Math.max(a.terminalMethod === 'perpetuity' ? 0.5 : 4, baseTermParam + d).toFixed(
        a.terminalMethod === 'perpetuity' ? 2 : 1
      )
    )
  );

  const sensitivityMatrix = sensitivityWaccAxis.map((w) =>
    sensitivityTermAxis.map((tp) => runForParams(w, tp).impliedSharePrice)
  );

  return {
    costOfEquityPct,
    afterTaxCostOfDebtPct,
    waccPct,
    years: primary.years,
    sumPvUfcf: primary.sumPvUfcf,
    terminalValue: primary.terminalValue,
    pvTerminalValue: primary.pvTerminalValue,
    terminalValueSharePct,
    enterpriseValueM: primary.enterpriseValueM,
    netDebtM: stock.netDebtM,
    equityValueM: primary.equityValueM,
    impliedSharePrice: primary.impliedSharePrice,
    upsidePct,
    sensitivityWaccAxis,
    sensitivityTermAxis,
    sensitivityMatrix,
  };
}

// 5-Class Institutional Asset Allocation Model
// [US Equities, Intl Equities, Fixed Income, Alternatives, Cash]
export const ASSET_CLASS_META = [
  {
    field: 'usEquitiesPct' as const,
    label: 'U.S. Large-Cap Equities',
    shortLabel: 'U.S. Equities',
    expectedReturnPct: 8.8,
    volatilityPct: 15.8,
    color: '#012169',
  },
  {
    field: 'intlEquitiesPct' as const,
    label: 'International & Emerging Equities',
    shortLabel: 'Intl Equities',
    expectedReturnPct: 8.2,
    volatilityPct: 17.6,
    color: '#0052C2',
  },
  {
    field: 'fixedIncomePct' as const,
    label: 'Investment-Grade Fixed Income',
    shortLabel: 'Fixed Income',
    expectedReturnPct: 4.5,
    volatilityPct: 5.6,
    color: '#3B82F6',
  },
  {
    field: 'alternativesPct' as const,
    label: 'Real Estate & Alternatives',
    shortLabel: 'Alternatives',
    expectedReturnPct: 7.4,
    volatilityPct: 12.2,
    color: '#0F8A4B',
  },
  {
    field: 'cashPct' as const,
    label: 'Cash & Treasury Bills',
    shortLabel: 'Cash',
    expectedReturnPct: 3.4,
    volatilityPct: 0.8,
    color: '#94A3B8',
  },
];

const ASSET_RETURNS = [0.088, 0.082, 0.045, 0.074, 0.034];
const ASSET_VOLS = [0.158, 0.176, 0.056, 0.122, 0.008];
const CORR_MATRIX = [
  [1.0, 0.82, 0.12, 0.58, 0.02],
  [0.82, 1.0, 0.14, 0.52, 0.02],
  [0.12, 0.14, 1.0, 0.18, 0.15],
  [0.58, 0.52, 0.18, 1.0, 0.04],
  [0.02, 0.02, 0.15, 0.04, 1.0],
];

function computePortfolioStats(inputs: FinancialPlanInputs): {
  mean: number;
  vol: number;
  sharpe: number;
  var95: number;
} {
  const sum = Math.max(
    1,
    inputs.usEquitiesPct +
      inputs.intlEquitiesPct +
      inputs.fixedIncomePct +
      inputs.alternativesPct +
      inputs.cashPct
  );
  const w = [
    inputs.usEquitiesPct / sum,
    inputs.intlEquitiesPct / sum,
    inputs.fixedIncomePct / sum,
    inputs.alternativesPct / sum,
    inputs.cashPct / sum,
  ];
  let mean = 0;
  for (let i = 0; i < 5; i++) mean += w[i] * ASSET_RETURNS[i];

  let variance = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      variance += w[i] * w[j] * ASSET_VOLS[i] * ASSET_VOLS[j] * CORR_MATRIX[i][j];
    }
  }
  const vol = Math.sqrt(Math.max(0.0001, variance));
  const rf = 0.04;
  const sharpe = (mean - rf) / Math.max(0.005, vol);
  const var95 = mean - 1.645 * vol;
  return { mean, vol, sharpe, var95 };
}

function seededNormalGenerator(seed: number) {
  let a = seed >>> 0;
  const rand = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u1 = Math.max(1e-7, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function runFinancialPlanModel(
  inputs: FinancialPlanInputs,
  portfolioValue: number
): FinancialPlanOutput {
  const startCap = inputs.syncWithPortfolio ? portfolioValue : inputs.manualStartingCapital;
  const { mean, vol, sharpe, var95 } = computePortfolioStats(inputs);
  const currentYear = 2026;
  const totalYears = Math.max(2, inputs.horizonAge - inputs.currentAge);
  const inflation = inputs.inflationRate / 100;
  const edInflation = (inputs.educationInflationRate ?? inputs.inflationRate + 1.8) / 100;
  const taxRate = Math.min(0.5, Math.max(0, inputs.retirementTaxRate / 100));
  const contribGrowth = inputs.contributionGrowthPct / 100;
  const spouse = inputs.spouse;

  // Compute children education outflows per plan year index (y = 1..totalYears)
  // Each child's existing 529 compounds at 6.0% nominal until college start and offsets tuition first.
  const educationOutflowByYear = new Map<number, number>();
  const childSummaries = (inputs.children ?? []).map((child) => {
    const yearsUntilStart = Math.max(0, child.collegeStartAge - child.currentAge);
    const projected529AtStart = child.existing529Balance * Math.pow(1.06, yearsUntilStart);
    let remaining529 = projected529AtStart;
    let totalProjectedCostNominal = 0;
    let netOutOfPocketNominal = 0;

    for (let cy = 0; cy < Math.max(1, child.collegeYears); cy++) {
      const planYearIdx = yearsUntilStart + cy;
      if (planYearIdx < 1 || planYearIdx > totalYears) continue;
      const annualCostNom = child.annualCollegeCost * Math.pow(1 + edInflation, planYearIdx);
      totalProjectedCostNominal += annualCostNom;

      // Remaining 529 earns conservative 3.5% during college years
      if (cy > 0) remaining529 *= 1.035;
      const covered = Math.min(remaining529, annualCostNom);
      remaining529 -= covered;
      const outOfPocket = Math.max(0, annualCostNom - covered);
      netOutOfPocketNominal += outOfPocket;

      if (outOfPocket > 0) {
        educationOutflowByYear.set(
          planYearIdx,
          (educationOutflowByYear.get(planYearIdx) ?? 0) + outOfPocket
        );
      }
    }

    const fundedPct =
      totalProjectedCostNominal > 0
        ? Math.min(100, Math.round((projected529AtStart / totalProjectedCostNominal) * 100))
        : 100;

    return {
      id: child.id,
      name: child.name,
      yearsUntilCollege: yearsUntilStart,
      totalProjectedCostNominal,
      projected529AtStart,
      netOutOfPocketNominal,
      fundedPct,
    };
  });

  // Map recurring & one-time goals by primary age
  const goalFlowByAge = new Map<number, number>();
  for (const g of inputs.goals ?? []) {
    const dur = Math.max(1, Math.round(g.durationYears || 1));
    for (let k = 0; k < dur; k++) {
      const targetAge = g.age + k;
      goalFlowByAge.set(targetAge, (goalFlowByAge.get(targetAge) ?? 0) + g.amount);
    }
  }

  // Helper: cash flow components for a given plan year index y >= 1
  const getYearFlows = (y: number) => {
    const age = inputs.currentAge + y;
    const spouseAge = spouse?.enabled ? spouse.currentAge + y : null;
    const inflFactor = Math.pow(1 + inflation, y);
    const primaryRetired = age > inputs.retirementAge;
    const spouseRetired = spouse?.enabled ? (spouseAge ?? 999) > spouse.retirementAge : true;

    let contribution = 0;
    if (!primaryRetired) {
      contribution += inputs.annualContribution * Math.pow(1 + contribGrowth, y - 1);
    }
    if (spouse?.enabled && !spouseRetired) {
      contribution += spouse.annualContribution * Math.pow(1 + contribGrowth, y - 1);
    }

    let socialSecurity = 0;
    if (age >= inputs.socialSecurityAge) {
      socialSecurity += inputs.socialSecurityAnnual * inflFactor;
    }
    if (spouse?.enabled && spouseAge !== null && spouseAge >= spouse.socialSecurityAge) {
      socialSecurity += spouse.socialSecurityAnnual * inflFactor;
    }

    const educationOutflow = educationOutflowByYear.get(y) ?? 0;
    const goalFlow = (goalFlowByAge.get(age) ?? 0) * inflFactor;

    // Full retirement spending activates once primary retires; if spouse retires first,
    // household still saves from primary's paycheck until primary retires.
    const isSpendingPhase = primaryRetired && spouseRetired;
    const isTransition = primaryRetired !== spouseRetired && spouse?.enabled;

    let spendingNeed = 0;
    if (isSpendingPhase) {
      spendingNeed = inputs.annualRetirementSpending * inflFactor;
    } else if (isTransition && primaryRetired) {
      // Partial retirement transition: 65% of target retirement spend offset by working spouse
      spendingNeed = Math.max(
        0,
        inputs.annualRetirementSpending * 0.65 * inflFactor -
          (spouse?.enabled ? spouse.annualIncome * 0.55 * inflFactor : 0)
      );
    }

    const netSpendingNeed = Math.max(0, spendingNeed - socialSecurity);
    const grossWithdrawalNeeded = netSpendingNeed / Math.max(0.5, 1 - taxRate);

    const phase: 'Accumulation' | 'Transition' | 'Retirement' = isSpendingPhase
      ? 'Retirement'
      : isTransition
      ? 'Transition'
      : 'Accumulation';

    return {
      age,
      spouseAge,
      inflFactor,
      phase,
      contribution,
      educationOutflow,
      goalFlow,
      socialSecurity,
      grossWithdrawalNeeded,
    };
  };

  // Run 350 Monte Carlo trials
  const trials = 350;
  const randNorm = seededNormalGenerator(424242);
  const trialBalancesByYear: number[][] = Array.from({ length: totalYears + 1 }, () =>
    new Array(trials).fill(0)
  );
  let successfulTrials = 0;

  // Track trial solvency at each goal's final year
  const goalEndYearById = new Map<string, number>();
  for (const g of inputs.goals ?? []) {
    const endAge = g.age + Math.max(1, g.durationYears || 1) - 1;
    goalEndYearById.set(g.id, Math.max(0, Math.min(totalYears, endAge - inputs.currentAge)));
  }

  for (let tr = 0; tr < trials; tr++) {
    let bal = startCap;
    trialBalancesByYear[0][tr] = bal;
    for (let y = 1; y <= totalYears; y++) {
      const f = getYearFlows(y);
      const z = randNorm();
      const annualRet = Math.exp((mean - 0.5 * vol * vol) + vol * z) - 1;
      const netFlow = f.contribution + f.goalFlow - f.educationOutflow - f.grossWithdrawalNeeded;
      bal = Math.max(0, (bal + netFlow) * (1 + annualRet));
      trialBalancesByYear[y][tr] = bal;
    }
    if (bal > 0) successfulTrials++;
  }

  // Deterministic expected trajectory + Monte Carlo percentiles
  const rows: AnnualPlanRow[] = [];
  let detBal = startCap;
  let fiAge: number | null = null;
  const fiTargetReal =
    inputs.annualRetirementSpending / Math.max(0.01, inputs.safeWithdrawalRate / 100);

  for (let y = 0; y <= totalYears; y++) {
    const age = inputs.currentAge + y;
    const spouseAge = spouse?.enabled ? spouse.currentAge + y : null;
    const year = currentYear + y;
    const inflFactor = Math.pow(1 + inflation, y);

    const startingBalance = detBal;
    let phase: 'Accumulation' | 'Transition' | 'Retirement' = 'Accumulation';
    let contribution = 0;
    let educationOutflow = 0;
    let goalFlow = 0;
    let socialSecurity = 0;
    let withdrawal = 0;
    let taxesPaid = 0;
    let investmentGrowth = 0;

    if (y > 0) {
      const f = getYearFlows(y);
      phase = f.phase;
      contribution = f.contribution;
      educationOutflow = f.educationOutflow;
      goalFlow = f.goalFlow;
      socialSecurity = f.socialSecurity;
      const availableBeforeWithdrawal = Math.max(0, startingBalance + contribution + Math.max(0, goalFlow));
      withdrawal = Math.min(availableBeforeWithdrawal, f.grossWithdrawalNeeded);
      taxesPaid = withdrawal * taxRate;
      const preGrowth = Math.max(
        0,
        startingBalance + contribution + goalFlow - educationOutflow - withdrawal
      );
      investmentGrowth = preGrowth * mean;
      detBal = preGrowth + investmentGrowth;
    }

    const sortedTrials = [...trialBalancesByYear[y]].sort((a, b) => a - b);
    const p10Nominal = percentile(sortedTrials, 10);
    const p25Nominal = percentile(sortedTrials, 25);
    const p50Nominal = percentile(sortedTrials, 50);
    const p75Nominal = percentile(sortedTrials, 75);
    const p90Nominal = percentile(sortedTrials, 90);

    const endingReal = detBal / inflFactor;
    const p50Real = p50Nominal / inflFactor;
    if (fiAge === null && p50Real >= fiTargetReal) {
      fiAge = age;
    }

    rows.push({
      age,
      spouseAge,
      year,
      phase,
      startingBalance,
      contribution,
      educationOutflow,
      goalFlow,
      socialSecurity,
      withdrawal,
      taxesPaid,
      investmentGrowth,
      endingNominal: detBal,
      endingReal,
      p10Nominal,
      p25Nominal,
      p50Nominal,
      p75Nominal,
      p90Nominal,
      p10Real: p10Nominal / inflFactor,
      p50Real,
      p90Real: p90Nominal / inflFactor,
    });
  }

  // Goal funding probability summaries
  const goalSummaries = (inputs.goals ?? []).map((g) => {
    const dur = Math.max(1, Math.round(g.durationYears || 1));
    const endYearIdx = goalEndYearById.get(g.id) ?? 0;
    const trialsAtGoal = trialBalancesByYear[endYearIdx] ?? [];
    const fundedCount = trialsAtGoal.filter((b) => b > 0).length;
    const fundedProbabilityPct =
      trialsAtGoal.length > 0 ? Math.round((fundedCount / trialsAtGoal.length) * 100) : 100;

    let totalNominalDollars = 0;
    for (let k = 0; k < dur; k++) {
      const yIdx = Math.max(0, g.age + k - inputs.currentAge);
      totalNominalDollars += g.amount * Math.pow(1 + inflation, yIdx);
    }

    return {
      id: g.id,
      label: g.label,
      category: g.category,
      priority: g.priority,
      targetYear: currentYear + Math.max(0, g.age - inputs.currentAge),
      targetAge: g.age,
      durationYears: dur,
      totalTodayDollars: g.amount * dur,
      totalNominalDollars,
      fundedProbabilityPct,
    };
  });

  const retRow =
    rows.find((r) => r.age === inputs.retirementAge) ?? rows[rows.length - 1];
  const lastRow = rows[rows.length - 1];
  const monthlySafeIncomeReal =
    (retRow.p50Real * (inputs.safeWithdrawalRate / 100)) / 12;

  const combinedAnnualContribution =
    inputs.annualContribution + (spouse?.enabled ? spouse.annualContribution : 0);
  const combinedSocialSecurityToday =
    inputs.socialSecurityAnnual + (spouse?.enabled ? spouse.socialSecurityAnnual : 0);

  return {
    startingCapital: startCap,
    expectedReturnPct: Number((mean * 100).toFixed(2)),
    expectedVolatilityPct: Number((vol * 100).toFixed(2)),
    sharpeRatio: Number(sharpe.toFixed(2)),
    var95AnnualPct: Number((var95 * 100).toFixed(1)),
    combinedAnnualContribution,
    combinedSocialSecurityToday,
    rows,
    childSummaries,
    goalSummaries,
    projectedRetirementNominal: retRow.p50Nominal,
    projectedRetirementReal: retRow.p50Real,
    projectedHorizonMedianReal: lastRow.p50Real,
    monthlySafeIncomeReal,
    successProbabilityPct: Math.round((successfulTrials / trials) * 100),
    fiAge,
    fiTargetReal,
  };
}

// Formatting Utilities
export function formatCurrency(value: number, decimals = 0): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  return (
    sign +
    '$' +
    abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatMillions(valM: number): string {
  const sign = valM < 0 ? '-' : '';
  const abs = Math.abs(valM);
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}M`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return String(vol);
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (cell: string | number) => {
    const str = String(cell);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
