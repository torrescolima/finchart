import type { PlanTier } from '../types/market.ts';

export interface TierLimits {
  maxActiveAlerts: number;
  maxCustomWatchlists: number;
  maxJournalEntries: number;
  maxSavedLayouts: number;
  multiChartSplit: boolean;
  riskAnalytics: boolean;
  pdfReports: boolean;
  csvBrokerageImport: boolean;
}

export const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  advisor: 2,
};

export const TIER_LIMITS: Record<PlanTier, TierLimits> = {
  free: {
    maxActiveAlerts: 3,
    maxCustomWatchlists: 2,
    maxJournalEntries: 10,
    maxSavedLayouts: 2,
    multiChartSplit: false,
    riskAnalytics: false,
    pdfReports: false,
    csvBrokerageImport: false,
  },
  pro: {
    maxActiveAlerts: 500,
    maxCustomWatchlists: 20,
    maxJournalEntries: 1000,
    maxSavedLayouts: 50,
    multiChartSplit: true,
    riskAnalytics: true,
    pdfReports: false,
    csvBrokerageImport: false,
  },
  advisor: {
    maxActiveAlerts: 500,
    maxCustomWatchlists: 20,
    maxJournalEntries: 1000,
    maxSavedLayouts: 50,
    multiChartSplit: true,
    riskAnalytics: true,
    pdfReports: true,
    csvBrokerageImport: true,
  },
};

export function hasTierAccess(current: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required];
}

export function getTierLimits(tier: PlanTier): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

export function getTierDisplayName(tier: PlanTier): string {
  if (tier === 'advisor') return 'Advisor & Institutional';
  if (tier === 'pro') return 'Pro Trader';
  return 'Individual';
}
