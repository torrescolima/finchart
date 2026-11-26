import {
  DcfAssumptions,
  FinancialPeriod,
  FinancialPlanInputs,
  OhlcBar,
  PortfolioHolding,
  Sector,
  StockProfile,
  Timeframe,
} from '../types/market';

// Deterministic PRNG (Mulberry32) so market series are realistic and stable across reloads
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function generateTradingDays(count: number, endDateStr = '2026-11-25'): string[] {
  const dates: string[] = [];
  const d = new Date(endDateStr + 'T12:00:00Z');
  while (dates.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

function generateOhlcSeries(
  symbol: string,
  targetPrice: number,
  annualVol: number,
  annualDrift: number,
  avgVolume: number,
  days = 520
): OhlcBar[] {
  const rand = mulberry32(hashString(symbol) + 918273);
  const dates = generateTradingDays(days);
  const dt = 1 / 252;
  const dailyVol = annualVol * Math.sqrt(dt);
  const dailyDrift = (annualDrift - 0.5 * annualVol * annualVol) * dt;

  // Generate raw log-price path first, then scale so final close matches targetPrice
  const closes: number[] = [100];
  let regime = 0;
  for (let i = 1; i < days; i++) {
    if (i % 45 === 0) {
      regime = (rand() - 0.48) * 0.0025;
    }
    // Box-Muller normal
    const u1 = Math.max(1e-7, rand());
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // Occasional earnings / macro shock
    const shock = rand() < 0.018 ? (rand() - 0.45) * dailyVol * 3.4 : 0;
    const ret = dailyDrift + regime + dailyVol * z + shock;
    closes.push(closes[i - 1] * Math.exp(ret));
  }

  const scale = targetPrice / closes[closes.length - 1];
  const bars: OhlcBar[] = [];

  for (let i = 0; i < days; i++) {
    const close = Number((closes[i] * scale).toFixed(2));
    const prev = i === 0 ? close * (1 - (rand() - 0.5) * dailyVol) : bars[i - 1].close;
    const gap = (rand() - 0.5) * dailyVol * 0.45;
    const open = Number(Math.max(0.5, prev * (1 + gap)).toFixed(2));
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const upperWick = bodyHigh * Math.abs((rand() * 0.85 + 0.05) * dailyVol);
    const lowerWick = bodyLow * Math.abs((rand() * 0.85 + 0.05) * dailyVol);
    const high = Number((bodyHigh + upperWick).toFixed(2));
    const low = Number(Math.max(0.25, bodyLow - lowerWick).toFixed(2));

    const moveRatio = Math.abs(close - open) / Math.max(0.01, open) / Math.max(0.004, dailyVol);
    const volNoise = 0.65 + rand() * 0.75 + Math.min(2.2, moveRatio * 0.45);
    const volume = Math.round(avgVolume * volNoise);

    bars.push({
      time: dates[i],
      timestamp: new Date(dates[i] + 'T16:00:00Z').getTime(),
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return bars;
}

interface RawStockSeed {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  sector: Sector;
  industry: string;
  hq: string;
  price: number;
  vol: number;
  drift: number;
  avgVolume: number;
  sharesOutM: number;
  peForward: number;
  dividendYield: number;
  beta: number;
  roe: number;
  roic: number;
  rev25M: number;
  revCagr: number; // 4-yr historical CAGR
  grossMargin: number;
  operatingMargin: number;
  daPct: number;
  capexPct: number;
  cashM: number;
  debtM: number;
  equityM: number;
  buybackPctFcf: number;
  description: string;
  peerSymbols: string[];
}

function buildFinancials(seed: RawStockSeed): {
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
} {
  const years = ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'];
  const annual: FinancialPeriod[] = [];
  const rand = mulberry32(hashString(seed.symbol + '_fin'));

  for (let idx = 0; idx < years.length; idx++) {
    const yearsBack = 4 - idx;
    const revFactor = Math.pow(1 + seed.revCagr / 100, -yearsBack);
    const noise = idx === 4 ? 1 : 0.97 + rand() * 0.06;
    const revenue = Math.round(seed.rev25M * revFactor * noise);
    const gmPct = Math.max(12, Math.min(92, seed.grossMargin + (idx - 4) * 0.55 + (rand() - 0.5) * 1.1));
    const omPct = Math.max(6, Math.min(72, seed.operatingMargin + (idx - 4) * 0.45 + (rand() - 0.5) * 1.0));
    const grossProfit = Math.round((revenue * gmPct) / 100);
    const costOfRevenue = revenue - grossProfit;
    const ebit = Math.round((revenue * omPct) / 100);
    const operatingExpenses = Math.max(0, grossProfit - ebit);
    const da = Math.round((revenue * seed.daPct) / 100);
    const ebitda = ebit + da;
    const taxRate = seed.sector === 'Technology' ? 0.165 : seed.sector === 'Energy' ? 0.23 : 0.195;
    const netIncome = Math.round(ebit * (1 - taxRate));
    const sharesAdj = seed.sharesOutM * (1 + yearsBack * 0.012);
    const eps = Number((netIncome / Math.max(1, sharesAdj)).toFixed(2));

    const cashAndEquiv = Math.round(seed.cashM * (0.72 + idx * 0.07 + (rand() - 0.5) * 0.06));
    const totalDebt = Math.round(seed.debtM * (0.85 + idx * 0.038));
    const shareholdersEquity = Math.round(seed.equityM * (0.7 + idx * 0.075));
    const totalLiabilities = Math.round(totalDebt * 1.48 + revenue * 0.14);
    const totalAssets = shareholdersEquity + totalLiabilities;

    const capex = Math.round((revenue * seed.capexPct) / 100);
    const operatingCashFlow = Math.round(netIncome + da * 1.05 + revenue * 0.018);
    const freeCashFlow = operatingCashFlow - capex;
    const dividendsPaid = Math.round(
      (seed.price * seed.sharesOutM * (seed.dividendYield / 100)) * (0.82 + idx * 0.045)
    );
    const shareRepurchases = Math.max(0, Math.round(freeCashFlow * seed.buybackPctFcf));

    annual.push({
      period: years[idx],
      revenue,
      costOfRevenue,
      grossProfit,
      operatingExpenses,
      ebit,
      ebitda,
      netIncome,
      eps,
      cashAndEquiv,
      totalAssets,
      totalDebt,
      totalLiabilities,
      shareholdersEquity,
      operatingCashFlow,
      capex,
      freeCashFlow,
      dividendsPaid,
      shareRepurchases,
    });
  }

  // Quarterly breakdown of FY25 with mild seasonality
  const fy25 = annual[4];
  const qLabels = ['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25'];
  const qWeights = [0.232, 0.244, 0.251, 0.273];
  const quarterly: FinancialPeriod[] = qLabels.map((label, qi) => {
    const w = qWeights[qi];
    const revenue = Math.round(fy25.revenue * w);
    const grossProfit = Math.round(fy25.grossProfit * w);
    const costOfRevenue = revenue - grossProfit;
    const ebit = Math.round(fy25.ebit * w * (0.97 + qi * 0.02));
    const operatingExpenses = Math.max(0, grossProfit - ebit);
    const ebitda = Math.round(fy25.ebitda * w * (0.97 + qi * 0.02));
    const netIncome = Math.round(fy25.netIncome * w * (0.97 + qi * 0.02));
    const eps = Number((netIncome / Math.max(1, seed.sharesOutM)).toFixed(2));
    const operatingCashFlow = Math.round(fy25.operatingCashFlow * w);
    const capex = Math.round(fy25.capex * w);
    return {
      period: label,
      revenue,
      costOfRevenue,
      grossProfit,
      operatingExpenses,
      ebit,
      ebitda,
      netIncome,
      eps,
      cashAndEquiv: Math.round(fy25.cashAndEquiv * (0.92 + qi * 0.028)),
      totalAssets: Math.round(fy25.totalAssets * (0.95 + qi * 0.017)),
      totalDebt: Math.round(fy25.totalDebt * (0.98 + qi * 0.007)),
      totalLiabilities: Math.round(fy25.totalLiabilities * (0.97 + qi * 0.01)),
      shareholdersEquity: Math.round(fy25.shareholdersEquity * (0.94 + qi * 0.02)),
      operatingCashFlow,
      capex,
      freeCashFlow: operatingCashFlow - capex,
      dividendsPaid: Math.round(fy25.dividendsPaid * 0.25),
      shareRepurchases: Math.round(fy25.shareRepurchases * w),
    };
  });

  return { annual, quarterly };
}

const RAW_SEEDS: RawStockSeed[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Consumer Hardware & Ecosystem',
    hq: 'Cupertino, CA',
    price: 234.85,
    vol: 0.23,
    drift: 0.14,
    avgVolume: 48_200_000,
    sharesOutM: 15_115,
    peForward: 28.4,
    dividendYield: 0.44,
    beta: 1.18,
    roe: 147.2,
    roic: 56.4,
    rev25M: 416_200,
    revCagr: 5.8,
    grossMargin: 46.8,
    operatingMargin: 31.9,
    daPct: 2.9,
    capexPct: 2.6,
    cashM: 65_100,
    debtM: 96_800,
    equityM: 62_400,
    buybackPctFcf: 0.78,
    description: 'Designs, manufactures, and markets smartphones, personal computers, wearables, and high-margin digital services.',
    peerSymbols: ['MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'],
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Enterprise Software & Cloud',
    hq: 'Redmond, WA',
    price: 448.60,
    vol: 0.22,
    drift: 0.16,
    avgVolume: 21_400_000,
    sharesOutM: 7_435,
    peForward: 30.2,
    dividendYield: 0.74,
    beta: 0.96,
    roe: 36.8,
    roic: 28.1,
    rev25M: 281_700,
    revCagr: 14.2,
    grossMargin: 69.8,
    operatingMargin: 45.1,
    daPct: 8.6,
    capexPct: 19.5,
    cashM: 78_400,
    debtM: 64_200,
    equityM: 294_500,
    buybackPctFcf: 0.28,
    description: 'Global enterprise software leader spanning Azure cloud infrastructure, Productivity & Business Processes, and personal computing.',
    peerSymbols: ['AAPL', 'GOOGL', 'AMZN', 'NVDA', 'META'],
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Semiconductors & Accelerated Compute',
    hq: 'Santa Clara, CA',
    price: 158.42,
    vol: 0.44,
    drift: 0.34,
    avgVolume: 214_500_000,
    sharesOutM: 24_480,
    peForward: 33.8,
    dividendYield: 0.03,
    beta: 1.66,
    roe: 112.4,
    roic: 78.6,
    rev25M: 168_400,
    revCagr: 58.0,
    grossMargin: 74.6,
    operatingMargin: 61.8,
    daPct: 1.8,
    capexPct: 2.4,
    cashM: 43_800,
    debtM: 9_600,
    equityM: 79_200,
    buybackPctFcf: 0.42,
    description: 'Pioneers GPU architectures, CUDA software platforms, and full-stack data center networking for accelerated computing.',
    peerSymbols: ['MSFT', 'AAPL', 'GOOGL', 'META', 'AMZN'],
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Interactive Media & Cloud',
    hq: 'Mountain View, CA',
    price: 192.15,
    vol: 0.26,
    drift: 0.15,
    avgVolume: 26_700_000,
    sharesOutM: 12_210,
    peForward: 21.1,
    dividendYield: 0.42,
    beta: 1.06,
    roe: 32.4,
    roic: 26.8,
    rev25M: 374_900,
    revCagr: 11.4,
    grossMargin: 58.6,
    operatingMargin: 33.2,
    daPct: 4.5,
    capexPct: 14.2,
    cashM: 95_600,
    debtM: 24_100,
    equityM: 328_000,
    buybackPctFcf: 0.65,
    description: 'Operates Search, YouTube, Android, and Google Cloud Platform across global digital advertising and enterprise workloads.',
    peerSymbols: ['META', 'MSFT', 'AMZN', 'AAPL', 'NVDA'],
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com, Inc.',
    exchange: 'NASDAQ',
    sector: 'Consumer',
    industry: 'E-Commerce & Cloud Infrastructure',
    hq: 'Seattle, WA',
    price: 224.30,
    vol: 0.28,
    drift: 0.18,
    avgVolume: 39_100_000,
    sharesOutM: 10_520,
    peForward: 32.6,
    dividendYield: 0.0,
    beta: 1.19,
    roe: 24.1,
    roic: 15.8,
    rev25M: 682_400,
    revCagr: 11.2,
    grossMargin: 49.4,
    operatingMargin: 11.4,
    daPct: 7.6,
    capexPct: 11.8,
    cashM: 92_400,
    debtM: 131_500,
    equityM: 274_000,
    buybackPctFcf: 0.08,
    description: 'Global commerce, logistics, digital advertising, and Amazon Web Services (AWS) hyperscale cloud provider.',
    peerSymbols: ['MSFT', 'GOOGL', 'COST', 'META', 'AAPL'],
  },
  {
    symbol: 'META',
    name: 'Meta Platforms, Inc.',
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Social Platforms & Digital Media',
    hq: 'Menlo Park, CA',
    price: 618.75,
    vol: 0.32,
    drift: 0.22,
    avgVolume: 14_800_000,
    sharesOutM: 2_525,
    peForward: 24.5,
    dividendYield: 0.32,
    beta: 1.24,
    roe: 35.6,
    roic: 29.4,
    rev25M: 178_200,
    revCagr: 14.8,
    grossMargin: 81.4,
    operatingMargin: 42.6,
    daPct: 9.2,
    capexPct: 22.8,
    cashM: 71_200,
    debtM: 37_900,
    equityM: 176_800,
    buybackPctFcf: 0.54,
    description: 'Operates Family of Apps (Instagram, WhatsApp, Facebook, Threads) and Reality Labs spatial computing hardware.',
    peerSymbols: ['GOOGL', 'MSFT', 'AMZN', 'AAPL', 'NVDA'],
  },
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co.',
    exchange: 'NYSE',
    sector: 'Financials',
    industry: 'Diversified Money Center Bank',
    hq: 'New York, NY',
    price: 254.18,
    vol: 0.21,
    drift: 0.14,
    avgVolume: 8_900_000,
    sharesOutM: 2_820,
    peForward: 13.8,
    dividendYield: 2.04,
    beta: 1.08,
    roe: 17.4,
    roic: 14.2,
    rev25M: 179_800,
    revCagr: 9.8,
    grossMargin: 64.2,
    operatingMargin: 41.2,
    daPct: 2.8,
    capexPct: 2.2,
    cashM: 512_000,
    debtM: 398_000,
    equityM: 344_000,
    buybackPctFcf: 0.35,
    description: 'Leading global financial services firm across Consumer & Community Banking, Corporate & Investment Bank, and Asset Management.',
    peerSymbols: ['BRK.B', 'SPY', 'AAPL', 'MSFT', 'XOM'],
  },
  {
    symbol: 'BRK.B',
    name: 'Berkshire Hathaway Inc.',
    exchange: 'NYSE',
    sector: 'Financials',
    industry: 'Multi-Sector Holding & Insurance',
    hq: 'Omaha, NE',
    price: 472.90,
    vol: 0.16,
    drift: 0.11,
    avgVolume: 3_700_000,
    sharesOutM: 2_155,
    peForward: 21.8,
    dividendYield: 0.0,
    beta: 0.85,
    roe: 14.8,
    roic: 11.9,
    rev25M: 384_500,
    revCagr: 8.2,
    grossMargin: 31.4,
    operatingMargin: 16.8,
    daPct: 3.4,
    capexPct: 4.8,
    cashM: 318_000,
    debtM: 124_000,
    equityM: 628_000,
    buybackPctFcf: 0.24,
    description: 'Diversified holding company spanning property-casualty reinsurance (GEICO), BNSF Railway, Berkshire Hathaway Energy, and industrial manufacturing.',
    peerSymbols: ['JPM', 'COST', 'XOM', 'SPY', 'LLY'],
  },
  {
    symbol: 'LLY',
    name: 'Eli Lilly and Company',
    exchange: 'NYSE',
    sector: 'Healthcare',
    industry: 'Biopharmaceuticals',
    hq: 'Indianapolis, IN',
    price: 892.40,
    vol: 0.29,
    drift: 0.24,
    avgVolume: 3_400_000,
    sharesOutM: 901,
    peForward: 38.5,
    dividendYield: 0.67,
    beta: 0.58,
    roe: 74.2,
    roic: 31.8,
    rev25M: 54_800,
    revCagr: 18.6,
    grossMargin: 81.8,
    operatingMargin: 38.4,
    daPct: 4.2,
    capexPct: 11.4,
    cashM: 4_800,
    debtM: 31_400,
    equityM: 16_900,
    buybackPctFcf: 0.12,
    description: 'Discovers, develops, and markets therapeutics in metabolic health, oncology, immunology, and neuroscience.',
    peerSymbols: ['COST', 'MSFT', 'AAPL', 'BRK.B', 'JPM'],
  },
  {
    symbol: 'XOM',
    name: 'Exxon Mobil Corporation',
    exchange: 'NYSE',
    sector: 'Energy',
    industry: 'Integrated Oil & Gas',
    hq: 'Spring, TX',
    price: 121.65,
    vol: 0.23,
    drift: 0.08,
    avgVolume: 15_900_000,
    sharesOutM: 4_390,
    peForward: 13.4,
    dividendYield: 3.24,
    beta: 0.89,
    roe: 15.2,
    roic: 12.6,
    rev25M: 348_600,
    revCagr: 5.2,
    grossMargin: 24.6,
    operatingMargin: 13.8,
    daPct: 6.1,
    capexPct: 7.4,
    cashM: 28_400,
    debtM: 41_200,
    equityM: 268_000,
    buybackPctFcf: 0.45,
    description: 'Integrated energy producer operating global upstream exploration, downstream refining, chemical manufacturing, and low-carbon solutions.',
    peerSymbols: ['BRK.B', 'JPM', 'COST', 'SPY', 'TSLA'],
  },
  {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    exchange: 'NASDAQ',
    sector: 'Consumer',
    industry: 'Electric Vehicles & Energy Storage',
    hq: 'Austin, TX',
    price: 346.20,
    vol: 0.54,
    drift: 0.19,
    avgVolume: 82_400_000,
    sharesOutM: 3_210,
    peForward: 88.4,
    dividendYield: 0.0,
    beta: 2.12,
    roe: 16.8,
    roic: 12.4,
    rev25M: 108_400,
    revCagr: 18.4,
    grossMargin: 19.2,
    operatingMargin: 10.6,
    daPct: 5.4,
    capexPct: 9.8,
    cashM: 34_600,
    debtM: 12_800,
    equityM: 72_400,
    buybackPctFcf: 0.0,
    description: 'Designs and manufactures electric vehicles, grid-scale battery storage systems, solar hardware, and autonomous driving software.',
    peerSymbols: ['NVDA', 'AMZN', 'AAPL', 'META', 'QQQ'],
  },
  {
    symbol: 'COST',
    name: 'Costco Wholesale Corp.',
    exchange: 'NASDAQ',
    sector: 'Consumer',
    industry: 'Membership Warehouse Retail',
    hq: 'Issaquah, WA',
    price: 948.10,
    vol: 0.19,
    drift: 0.16,
    avgVolume: 1_950_000,
    sharesOutM: 444,
    peForward: 51.2,
    dividendYield: 0.49,
    beta: 0.79,
    roe: 31.4,
    roic: 23.6,
    rev25M: 268_400,
    revCagr: 8.4,
    grossMargin: 12.6,
    operatingMargin: 3.7,
    daPct: 0.9,
    capexPct: 1.8,
    cashM: 11_400,
    debtM: 5_900,
    equityM: 25_600,
    buybackPctFcf: 0.11,
    description: 'Operates membership-based wholesale warehouses offering high-turnover consumer staples, fresh foods, and Kirkland Signature private label.',
    peerSymbols: ['AMZN', 'BRK.B', 'LLY', 'AAPL', 'SPY'],
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    exchange: 'ARCA',
    sector: 'ETF',
    industry: 'U.S. Large-Cap Equity Index',
    hq: 'Boston, MA',
    price: 604.25,
    vol: 0.15,
    drift: 0.11,
    avgVolume: 56_800_000,
    sharesOutM: 995,
    peForward: 21.6,
    dividendYield: 1.24,
    beta: 1.0,
    roe: 22.8,
    roic: 16.4,
    rev25M: 185_000,
    revCagr: 7.4,
    grossMargin: 44.0,
    operatingMargin: 19.5,
    daPct: 4.1,
    capexPct: 5.5,
    cashM: 45_000,
    debtM: 68_000,
    equityM: 152_000,
    buybackPctFcf: 0.32,
    description: 'Tracks the S&P 500 Index of 500 leading U.S. large-cap equities weighted by float-adjusted market capitalization.',
    peerSymbols: ['QQQ', 'BRK.B', 'AAPL', 'MSFT', 'JPM'],
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    exchange: 'NASDAQ',
    sector: 'ETF',
    industry: 'Nasdaq-100 Growth Index',
    hq: 'Atlanta, GA',
    price: 518.90,
    vol: 0.21,
    drift: 0.15,
    avgVolume: 34_200_000,
    sharesOutM: 610,
    peForward: 27.4,
    dividendYield: 0.58,
    beta: 1.18,
    roe: 31.2,
    roic: 22.1,
    rev25M: 162_000,
    revCagr: 12.1,
    grossMargin: 56.2,
    operatingMargin: 27.8,
    daPct: 4.8,
    capexPct: 7.4,
    cashM: 58_000,
    debtM: 42_000,
    equityM: 138_000,
    buybackPctFcf: 0.41,
    description: 'Tracks the Nasdaq-100 Index comprising the 100 largest non-financial companies listed on the Nasdaq Stock Market.',
    peerSymbols: ['SPY', 'MSFT', 'NVDA', 'AAPL', 'GOOGL'],
  },
];

export function buildInitialMarketUniverse(): Record<string, StockProfile> {
  const map: Record<string, StockProfile> = {};

  for (const seed of RAW_SEEDS) {
    const bars = generateOhlcSeries(seed.symbol, seed.price, seed.vol, seed.drift, seed.avgVolume, 520);
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const trailing252 = bars.slice(-252);
    const week52High = Math.max(...trailing252.map((b) => b.high));
    const week52Low = Math.min(...trailing252.map((b) => b.low));

    const { annual, quarterly } = buildFinancials(seed);
    const fy25 = annual[4];
    const fy24 = annual[3];
    const marketCapB = Number(((last.close * seed.sharesOutM) / 1000).toFixed(1));
    const netDebtM = fy25.totalDebt - fy25.cashAndEquiv;
    const evM = marketCapB * 1000 + netDebtM;
    const peTtm = Number((last.close / Math.max(0.01, fy25.eps)).toFixed(1));
    const evEbitda = Number((evM / Math.max(1, fy25.ebitda)).toFixed(1));
    const evRevenue = Number((evM / Math.max(1, fy25.revenue)).toFixed(1));
    const revenueGrowthYoy = Number((((fy25.revenue - fy24.revenue) / Math.max(1, fy24.revenue)) * 100).toFixed(1));

    map[seed.symbol] = {
      symbol: seed.symbol,
      name: seed.name,
      exchange: seed.exchange,
      sector: seed.sector,
      industry: seed.industry,
      hq: seed.hq,
      price: last.close,
      prevClose: prev.close,
      open: last.open,
      dayHigh: last.high,
      dayLow: last.low,
      week52High,
      week52Low,
      volume: last.volume,
      avgVolume: seed.avgVolume,
      marketCapB,
      sharesOutM: seed.sharesOutM,
      peTtm,
      peForward: seed.peForward,
      evEbitda,
      evRevenue,
      dividendYield: seed.dividendYield,
      beta: seed.beta,
      roe: seed.roe,
      roic: seed.roic,
      grossMargin: seed.grossMargin,
      operatingMargin: seed.operatingMargin,
      revenueGrowthYoy,
      netDebtM,
      description: seed.description,
      bars,
      annualFinancials: annual,
      quarterlyFinancials: quarterly,
      peerSymbols: seed.peerSymbols,
    };
  }

  return map;
}

function normalizeSector(raw?: string): Sector {
  const s = (raw || '').toLowerCase();
  if (s.includes('etf') || s.includes('fund')) return 'ETF';
  if (s.includes('financ') || s.includes('bank')) return 'Financials';
  if (s.includes('health') || s.includes('pharma') || s.includes('bio')) return 'Healthcare';
  if (s.includes('energy') || s.includes('oil')) return 'Energy';
  if (s.includes('consumer') || s.includes('retail') || s.includes('auto')) return 'Consumer';
  return 'Technology';
}

export function buildCustomStockProfile(params: {
  symbol: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'ARCA';
  sector?: string;
  industry?: string;
  price: number;
  prevClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  week52High: number;
  week52Low: number;
  volume: number;
  marketTime: number;
  bars: OhlcBar[];
}): StockProfile {
  const sector = normalizeSector(params.sector);
  const price = Math.max(0.01, params.price);
  const sharesOutM = 500;
  const marketCapB = Number(((price * sharesOutM) / 1000).toFixed(1));
  const estRev25M = Math.max(1200, Math.round(marketCapB * 180));
  const seed: RawStockSeed = {
    symbol: params.symbol,
    name: params.name,
    exchange: params.exchange,
    sector,
    industry: params.industry || 'Public Equity',
    hq: 'United States',
    price,
    vol: 0.28,
    drift: 0.1,
    avgVolume: Math.max(100_000, params.volume || 2_000_000),
    sharesOutM,
    peForward: 22.0,
    dividendYield: sector === 'Financials' || sector === 'Energy' ? 2.1 : 0.6,
    beta: 1.1,
    roe: 20.0,
    roic: 14.5,
    rev25M: estRev25M,
    revCagr: 9.5,
    grossMargin: 48.0,
    operatingMargin: 21.0,
    daPct: 4.5,
    capexPct: 5.5,
    cashM: Math.round(estRev25M * 0.25),
    debtM: Math.round(estRev25M * 0.3),
    equityM: Math.round(estRev25M * 0.65),
    buybackPctFcf: 0.25,
    description: `${params.name} (${params.symbol}) live market quote and chart history streamed via Yahoo Finance.`,
    peerSymbols: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'JPM'],
  };
  const { annual, quarterly } = buildFinancials(seed);
  const fy25 = annual[annual.length - 1];
  const netDebtM = fy25.totalDebt - fy25.cashAndEquiv;
  const evM = marketCapB * 1000 + netDebtM;

  return {
    symbol: params.symbol,
    name: params.name,
    exchange: params.exchange,
    sector,
    industry: params.industry || 'Public Equity',
    hq: 'United States',
    price,
    prevClose: params.prevClose || price,
    open: params.open || price,
    dayHigh: params.dayHigh || price,
    dayLow: params.dayLow || price,
    week52High: params.week52High || price,
    week52Low: params.week52Low || price,
    volume: params.volume || 0,
    avgVolume: Math.max(100_000, params.volume || 2_000_000),
    marketCapB,
    sharesOutM,
    peTtm: Number((price / Math.max(0.01, fy25.eps)).toFixed(1)),
    peForward: 22.0,
    evEbitda: Number((evM / Math.max(1, fy25.ebitda)).toFixed(1)),
    evRevenue: Number((evM / Math.max(1, fy25.revenue)).toFixed(1)),
    dividendYield: seed.dividendYield,
    beta: 1.1,
    roe: 20.0,
    roic: 14.5,
    grossMargin: 48.0,
    operatingMargin: 21.0,
    revenueGrowthYoy: 9.5,
    netDebtM,
    description: seed.description,
    bars: params.bars.length > 0 ? params.bars : generateOhlcSeries(params.symbol, price, 0.26, 0.1, 2_000_000, 130),
    annualFinancials: annual,
    quarterlyFinancials: quarterly,
    peerSymbols: seed.peerSymbols,
    isLive: true,
    marketTime: params.marketTime,
  };
}

export function getBarsForTimeframe(bars: OhlcBar[], timeframe: Timeframe): OhlcBar[] {
  if (bars.length === 0) return [];
  if (timeframe === '1D') {
    // Synthesize 78 five-minute intraday bars ending at the latest close
    const last = bars[bars.length - 1];
    const rand = mulberry32(hashString(last.time + '_' + Math.round(last.open * 100)));
    const count = 78;
    const result: OhlcBar[] = [];
    let cur = last.open;
    const stepDrift = (last.close - last.open) / count;
    const rangeAmp = Math.max(last.high - last.low, last.close * 0.008) * 0.14;
    for (let i = 0; i < count; i++) {
      const minutesFromOpen = i * 5;
      const hr = 9 + Math.floor((30 + minutesFromOpen) / 60);
      const min = (30 + minutesFromOpen) % 60;
      const label = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      const open = cur;
      const target =
        i === count - 1
          ? last.close
          : Number(
              Math.max(
                last.low * 0.996,
                Math.min(last.high * 1.004, open + stepDrift + (rand() - 0.5) * rangeAmp)
              ).toFixed(2)
            );
      const high = Number((Math.max(open, target) + rand() * rangeAmp * 0.35).toFixed(2));
      const low = Number(Math.max(0.1, Math.min(open, target) - rand() * rangeAmp * 0.35).toFixed(2));
      // U-shaped intraday volume curve
      const uWeight = 1 + Math.pow((i - count / 2) / (count / 2), 2) * 1.4;
      const volume = Math.round((last.volume / count) * uWeight * (0.7 + rand() * 0.6));
      result.push({
        time: label,
        timestamp: last.timestamp - (count - i) * 300_000,
        open: Number(open.toFixed(2)),
        high,
        low,
        close: target,
        volume,
      });
      cur = target;
    }
    return result;
  }

  const sliceMap: Record<Exclude<Timeframe, '1D'>, number> = {
    '1W': 14,
    '1M': 24,
    '3M': 66,
    '6M': 130,
    '1Y': 252,
    '2Y': 520,
  };
  return bars.slice(-sliceMap[timeframe]);
}

// Technical Indicators
export function computeSMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function computeEMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export function computeBollinger(
  values: number[],
  period = 20,
  mult = 2
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const mid = computeSMA(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - m;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, mid, lower };
}

export function computeVWAP(bars: OhlcBar[]): number[] {
  let cumPV = 0;
  let cumV = 0;
  return bars.map((b) => {
    const typical = (b.high + b.low + b.close) / 3;
    cumPV += typical * b.volume;
    cumV += b.volume;
    return cumV > 0 ? cumPV / cumV : b.close;
  });
}

export function computeRSI(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function computeMACD(values: number[]): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const ema12 = computeEMA(values, 12);
  const ema26 = computeEMA(values, 26);
  const macd: (number | null)[] = values.map((_, i) =>
    ema12[i] !== null && ema26[i] !== null ? ema12[i]! - ema26[i]! : null
  );

  // Compute 9-period EMA on non-null MACD values
  const validStart = macd.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  const hist: (number | null)[] = new Array(values.length).fill(null);

  if (validStart !== -1 && values.length - validStart >= 9) {
    const macdSlice = macd.slice(validStart) as number[];
    const sigSlice = computeEMA(macdSlice, 9);
    for (let i = 0; i < sigSlice.length; i++) {
      const idx = validStart + i;
      signal[idx] = sigSlice[i];
      if (macd[idx] !== null && signal[idx] !== null) {
        hist[idx] = macd[idx]! - signal[idx]!;
      }
    }
  }
  return { macd, signal, hist };
}

export function getDefaultDcfAssumptions(stock: StockProfile): DcfAssumptions {
  const fy25 = stock.annualFinancials[stock.annualFinancials.length - 1];
  const daPct = Number((((fy25.ebitda - fy25.ebit) / Math.max(1, fy25.revenue)) * 100).toFixed(1));
  const capexPct = Number(((fy25.capex / Math.max(1, fy25.revenue)) * 100).toFixed(1));
  const baseGrowth = Math.max(3, Math.min(28, stock.revenueGrowthYoy));
  const totalCapital = Math.max(1, stock.marketCapB * 1000 + fy25.totalDebt);
  const debtWeight = Number(Math.min(45, (fy25.totalDebt / totalCapital) * 100).toFixed(1));

  return {
    revGrowthYr1: Number(baseGrowth.toFixed(1)),
    revGrowthYr5: Number(Math.max(3.5, baseGrowth * 0.55).toFixed(1)),
    targetEbitMargin: Number(Math.min(64, stock.operatingMargin + 1.2).toFixed(1)),
    taxRate: stock.sector === 'Technology' ? 17.5 : 20.0,
    daPctRev: Math.max(1.0, daPct),
    capexPctRev: Math.max(1.5, capexPct),
    nwcPctRevChange: 2.0,
    riskFreeRate: 4.25,
    equityRiskPremium: 5.0,
    beta: stock.beta,
    costOfDebt: 5.4,
    debtWeight,
    terminalMethod: 'perpetuity',
    terminalGrowth: 3.0,
    exitMultiple: Math.max(10, Math.min(28, Math.round(stock.evEbitda * 0.85))),
  };
}

export const INITIAL_PORTFOLIO: PortfolioHolding[] = [
  { id: 'pos-1', symbol: 'MSFT', shares: 165, avgCost: 378.4 },
  { id: 'pos-2', symbol: 'AAPL', shares: 240, avgCost: 196.2 },
  { id: 'pos-3', symbol: 'NVDA', shares: 380, avgCost: 112.5 },
  { id: 'pos-4', symbol: 'SPY', shares: 210, avgCost: 512.0 },
  { id: 'pos-5', symbol: 'JPM', shares: 140, avgCost: 204.8 },
  { id: 'pos-6', symbol: 'GOOGL', shares: 185, avgCost: 161.3 },
];

export const DEFAULT_FINANCIAL_PLAN: FinancialPlanInputs = {
  scenarioName: 'Balanced Growth',
  primaryName: 'Primary',
  currentAge: 36,
  retirementAge: 62,
  horizonAge: 94,
  syncWithPortfolio: true,
  manualStartingCapital: 420_000,
  annualIncome: 195_000,
  annualContribution: 36_000,
  contributionGrowthPct: 3.0,
  annualRetirementSpending: 125_000,
  socialSecurityAnnual: 34_000,
  socialSecurityAge: 67,
  inflationRate: 2.6,
  educationInflationRate: 4.5,
  retirementTaxRate: 18.0,
  safeWithdrawalRate: 4.0,
  usEquitiesPct: 50,
  intlEquitiesPct: 18,
  fixedIncomePct: 22,
  alternativesPct: 5,
  cashPct: 5,
  spouse: {
    enabled: true,
    name: 'Spouse',
    currentAge: 34,
    retirementAge: 60,
    annualIncome: 145_000,
    annualContribution: 24_000,
    socialSecurityAnnual: 28_000,
    socialSecurityAge: 67,
  },
  children: [
    {
      id: 'child-1',
      name: 'Child 1',
      currentAge: 6,
      collegeStartAge: 18,
      collegeYears: 4,
      annualCollegeCost: 38_000,
      existing529Balance: 22_000,
    },
  ],
  goals: [
    {
      id: 'goal-1',
      label: 'Home Upgrade Down Payment',
      category: 'Home',
      priority: 'Essential',
      age: 40,
      durationYears: 1,
      amount: -110_000,
    },
    {
      id: 'goal-2',
      label: 'Annual Family Travel',
      category: 'Travel',
      priority: 'Important',
      age: 62,
      durationYears: 12,
      amount: -12_000,
    },
    {
      id: 'goal-3',
      label: 'Equity Vesting / Bonus Event',
      category: 'Windfall',
      priority: 'Important',
      age: 43,
      durationYears: 1,
      amount: 125_000,
    },
  ],
};

export const PLAN_SCENARIO_PRESETS: Record<string, Partial<FinancialPlanInputs>> = {
  Conservative: {
    scenarioName: 'Conservative',
    retirementAge: 65,
    annualContribution: 28_000,
    annualRetirementSpending: 105_000,
    safeWithdrawalRate: 3.5,
    usEquitiesPct: 30,
    intlEquitiesPct: 10,
    fixedIncomePct: 45,
    alternativesPct: 5,
    cashPct: 10,
  },
  'Balanced Growth': {
    scenarioName: 'Balanced Growth',
    retirementAge: 62,
    annualContribution: 36_000,
    annualRetirementSpending: 125_000,
    safeWithdrawalRate: 4.0,
    usEquitiesPct: 50,
    intlEquitiesPct: 18,
    fixedIncomePct: 22,
    alternativesPct: 5,
    cashPct: 5,
  },
  'Aggressive FIRE': {
    scenarioName: 'Aggressive FIRE',
    retirementAge: 52,
    annualContribution: 58_000,
    annualRetirementSpending: 115_000,
    safeWithdrawalRate: 3.75,
    usEquitiesPct: 62,
    intlEquitiesPct: 23,
    fixedIncomePct: 10,
    alternativesPct: 5,
    cashPct: 0,
  },
};

export const MODEL_ALLOCATION_PRESETS: {
  name: string;
  subtitle: string;
  usEquitiesPct: number;
  intlEquitiesPct: number;
  fixedIncomePct: number;
  alternativesPct: number;
  cashPct: number;
}[] = [
  {
    name: 'Income & Preservation',
    subtitle: '35% Equity / 65% Defensive',
    usEquitiesPct: 25,
    intlEquitiesPct: 10,
    fixedIncomePct: 50,
    alternativesPct: 5,
    cashPct: 10,
  },
  {
    name: 'Moderate Balanced',
    subtitle: '60% Equity / 40% Defensive',
    usEquitiesPct: 44,
    intlEquitiesPct: 16,
    fixedIncomePct: 30,
    alternativesPct: 5,
    cashPct: 5,
  },
  {
    name: 'Growth',
    subtitle: '75% Equity / 25% Defensive',
    usEquitiesPct: 55,
    intlEquitiesPct: 20,
    fixedIncomePct: 17,
    alternativesPct: 5,
    cashPct: 3,
  },
  {
    name: 'All-Equity Growth',
    subtitle: '90% Equity / 10% Alts & Bonds',
    usEquitiesPct: 66,
    intlEquitiesPct: 24,
    fixedIncomePct: 5,
    alternativesPct: 5,
    cashPct: 0,
  },
];
