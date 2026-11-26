export type WorkspaceTab =
  | 'chart'
  | 'screener'
  | 'earnings'
  | 'fundamentals'
  | 'dcf'
  | 'portfolio'
  | 'planner';

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

export interface FibRetracement {
  id: string;
  startIndex: number;
  startPrice: number;
  endIndex: number;
  endPrice: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  note: string;
  createdAt: number;
  triggeredAt: number | null;
}

export type SplitLayoutMode = '1' | '2' | '4';

export interface SavedChartLayout {
  id: string;
  name: string;
  timeframe: Timeframe;
  chartType: ChartType;
  subIndicator: SubIndicator;
  showSma20: boolean;
  showEma50: boolean;
  showEma200: boolean;
  showBollinger: boolean;
  showVwap: boolean;
  splitMode: SplitLayoutMode;
  compareSymbol: string | null;
}

export type TradeSide = 'LONG' | 'SHORT';

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  side: TradeSide;
  entryDate: string; // YYYY-MM-DD
  exitDate: string; // YYYY-MM-DD or '' if open
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  setupTag: string;
  notes: string;
  createdAt: number;
}

export interface CustomWatchlist {
  id: string;
  name: string;
  symbols: string[];
}

export interface TickerNewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: number;
  relatedTickers: string[];
}

export interface EarningsEvent {
  symbol: string;
  earningsDate: string; // YYYY-MM-DD
  earningsTimestamp: number; // ms epoch
  earningsDateEnd: string | null;
  isEstimate: boolean;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueEstimate: number | null;
  lastQuarterEpsActual: number | null;
  lastQuarterEpsEstimate: number | null;
  lastQuarterSurprisePct: number | null;
  beatCount: number;
  historyCount: number;
}

export type PlanTier = 'free' | 'pro' | 'advisor';

export type SubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled';

export interface AccountProfile {
  uid: string;
  email: string;
  displayName: string | null;
  planTier: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: number | null;
  termsAcceptedAt: string | null;
  billingConfigured: boolean;
  marketDataSource: string;
  hasStripeCustomer: boolean;
}



