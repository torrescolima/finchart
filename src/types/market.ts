export type WorkspaceTab = 'chart' | 'fundamentals' | 'dcf' | 'planner';

export type Sector = 'Technology' | 'Financials' | 'Healthcare' | 'Consumer' | 'Energy' | 'ETF';

export interface OhlcBar {
  time: string; // YYYY-MM-DD
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FinancialPeriod {
  period: string; // e.g., 'FY21' or 'Q1 25'
  revenue: number; // $M
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  ebit: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  // Balance Sheet ($M)
  cashAndEquiv: number;
  totalAssets: number;
  totalDebt: number;
  totalLiabilities: number;
  shareholdersEquity: number;
  // Cash Flow ($M)
  operatingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  dividendsPaid: number;
  shareRepurchases: number;
}

export interface StockProfile {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  sector: Sector;
  industry: string;
  hq: string;
  price: number;
  prevClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  week52High: number;
  week52Low: number;
  volume: number;
  avgVolume: number;
  marketCapB: number; // Billions
  sharesOutM: number; // Millions
  peTtm: number;
  peForward: number;
  evEbitda: number;
  evRevenue: number;
  dividendYield: number; // %
  beta: number;
  roe: number; // %
  roic: number; // %
  grossMargin: number; // %
  operatingMargin: number; // %
  revenueGrowthYoy: number; // %
  netDebtM: number; // Millions (negative = net cash)
  description: string;
  bars: OhlcBar[];
  annualFinancials: FinancialPeriod[];
  quarterlyFinancials: FinancialPeriod[];
  peerSymbols: string[];
  isLive?: boolean;
  marketTime?: number;
}

export interface DcfAssumptions {
  revGrowthYr1: number; // %
  revGrowthYr5: number; // %
  targetEbitMargin: number; // %
  taxRate: number; // %
  daPctRev: number; // %
  capexPctRev: number; // %
  nwcPctRevChange: number; // %
  riskFreeRate: number; // %
  equityRiskPremium: number; // %
  beta: number;
  costOfDebt: number; // %
  debtWeight: number; // %
  terminalMethod: 'perpetuity' | 'multiple';
  terminalGrowth: number; // %
  exitMultiple: number; // EV/EBITDA x
}

export interface PortfolioHolding {
  id: string;
  symbol: string;
  shares: number;
  avgCost: number;
}

export interface SpouseProfile {
  enabled: boolean;
  name: string;
  currentAge: number;
  retirementAge: number;
  annualIncome: number;
  annualContribution: number;
  socialSecurityAnnual: number;
  socialSecurityAge: number;
}

export interface ChildProfile {
  id: string;
  name: string;
  currentAge: number;
  collegeStartAge: number;
  collegeYears: number;
  annualCollegeCost: number; // today's dollars
  existing529Balance: number;
}

export type GoalCategory =
  | 'Home'
  | 'Education'
  | 'Travel'
  | 'Major Purchase'
  | 'Legacy'
  | 'Windfall';

export type GoalPriority = 'Essential' | 'Important' | 'Aspirational';

export interface PlanningGoal {
  id: string;
  label: string;
  category: GoalCategory;
  priority: GoalPriority;
  age: number; // primary client's age
  durationYears: number; // 1 = one-time, >1 = recurring annually
  amount: number; // positive = inflow (windfall), negative = outflow (spending goal)
}

export interface FinancialPlanInputs {
  scenarioName: string;
  primaryName: string;
  currentAge: number;
  retirementAge: number;
  horizonAge: number;
  syncWithPortfolio: boolean;
  manualStartingCapital: number;
  annualIncome: number;
  annualContribution: number;
  contributionGrowthPct: number;
  annualRetirementSpending: number; // in today's dollars
  socialSecurityAnnual: number;
  socialSecurityAge: number;
  inflationRate: number;
  educationInflationRate: number;
  retirementTaxRate: number;
  safeWithdrawalRate: number;
  // 5-Class Asset Allocation (sums to 100)
  usEquitiesPct: number;
  intlEquitiesPct: number;
  fixedIncomePct: number;
  alternativesPct: number;
  cashPct: number;
  // Household extensions
  spouse: SpouseProfile;
  children: ChildProfile[];
  goals: PlanningGoal[];
}

export interface AnnualPlanRow {
  age: number;
  spouseAge: number | null;
  year: number;
  phase: 'Accumulation' | 'Transition' | 'Retirement';
  startingBalance: number;
  contribution: number;
  educationOutflow: number;
  goalFlow: number;
  socialSecurity: number;
  withdrawal: number;
  taxesPaid: number;
  investmentGrowth: number;
  endingNominal: number;
  endingReal: number;
  p10Nominal: number;
  p25Nominal: number;
  p50Nominal: number;
  p75Nominal: number;
  p90Nominal: number;
  p10Real: number;
  p50Real: number;
  p90Real: number;
}

export interface ChildEducationSummary {
  id: string;
  name: string;
  yearsUntilCollege: number;
  totalProjectedCostNominal: number;
  projected529AtStart: number;
  netOutOfPocketNominal: number;
  fundedPct: number;
}

export interface GoalFundingSummary {
  id: string;
  label: string;
  category: GoalCategory;
  priority: GoalPriority;
  targetYear: number;
  targetAge: number;
  durationYears: number;
  totalTodayDollars: number;
  totalNominalDollars: number;
  fundedProbabilityPct: number;
}

export interface FinancialPlanOutput {
  startingCapital: number;
  expectedReturnPct: number;
  expectedVolatilityPct: number;
  sharpeRatio: number;
  var95AnnualPct: number;
  combinedAnnualContribution: number;
  combinedSocialSecurityToday: number;
  rows: AnnualPlanRow[];
  childSummaries: ChildEducationSummary[];
  goalSummaries: GoalFundingSummary[];
  projectedRetirementNominal: number;
  projectedRetirementReal: number;
  projectedHorizonMedianReal: number;
  monthlySafeIncomeReal: number;
  successProbabilityPct: number;
  fiAge: number | null;
  fiTargetReal: number;
}

export type ChartType = 'candles' | 'hollow' | 'line' | 'area';
export type Timeframe = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '2Y';
export type SubIndicator = 'volume' | 'rsi' | 'macd';

export interface PriceLine {
  id: string;
  price: number;
  label: string;
}

export interface TrendLine {
  id: string;
  startIndex: number;
  startPrice: number;
  endIndex: number;
  endPrice: number;
}
