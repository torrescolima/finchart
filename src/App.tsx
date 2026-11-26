/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChartTerminal } from './components/ChartTerminal';
import { CommandPalette } from './components/CommandPalette';
import { EarningsCalendarView } from './components/EarningsCalendarView';
import { FinancialPlannerView } from './components/FinancialPlannerView';
import { FundamentalsView } from './components/FundamentalsView';
import { LandingPage } from './components/LandingPage';
import { LegalDisclosuresModal } from './components/LegalDisclosuresModal';
import { PlansBillingModal, type UpgradeContext } from './components/PlansBillingModal';
import { PortfolioRiskView } from './components/PortfolioRiskView';
import { ScreenerHeatmapView } from './components/ScreenerHeatmapView';
import { TopBar } from './components/TopBar';
import { ValuationDcfView } from './components/ValuationDcfView';
import { WatchlistSidebar } from './components/WatchlistSidebar';
import {
  buildCustomStockProfile,
  buildInitialMarketUniverse,
  DEFAULT_FINANCIAL_PLAN,
  getDefaultDcfAssumptions,
  INITIAL_PORTFOLIO,
} from './data/marketData';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getTierLimits, hasTierAccess } from './lib/entitlements';
import { auth, googleAuthProvider } from './lib/firebase';
import {
  acceptAccountTerms,
  confirmBillingSession,
  createBillingCheckout,
  createBillingPortal,
  fetchAccountProfile,
} from './services/accountApi';
import {
  fetchLiveChart,
  fetchLiveQuotes,
  LiveSearchResult,
} from './services/marketApi';
import {
  fetchCloudWorkspace,
  saveCloudAlerts,
  saveCloudFinancialPlan,
  saveCloudHoldings,
  saveCloudJournal,
  saveCloudPreferences,
} from './services/workspaceApi';
import {
  AccountProfile,
  CustomWatchlist,
  DcfAssumptions,
  FinancialPlanInputs,
  PlanTier,
  PortfolioHolding,
  PriceAlert,
  StockProfile,
  TradeJournalEntry,
  WorkspaceTab,
} from './types/market';
import {
  computeDcfValuation,
  downloadCsv,
  runFinancialPlanModel,
} from './utils/financeMath';
import {
  printEquityTearSheet,
  printFinancialPlanReport,
  printPortfolioReport,
} from './utils/pdfReport';

const DEFAULT_WATCHLISTS: CustomWatchlist[] = [
  { id: 'wl-core', name: 'Core Holdings', symbols: ['AAPL', 'MSFT', 'NVDA', 'JPM', 'SPY'] },
  { id: 'wl-growth', name: 'AI & Mega-Cap', symbols: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META'] },
];

const INITIAL_JOURNAL: TradeJournalEntry[] = [
  {
    id: 'tr-seed-1',
    symbol: 'NVDA',
    side: 'LONG',
    entryDate: '2026-09-14',
    exitDate: '2026-10-18',
    entryPrice: 118.4,
    exitPrice: 136.2,
    shares: 40,
    setupTag: 'Earnings Breakout',
    notes: 'Held above 20-day SMA on strong data-center volume; scaled out near resistance.',
    createdAt: 1790000000000,
  },
  {
    id: 'tr-seed-2',
    symbol: 'MSFT',
    side: 'LONG',
    entryDate: '2026-10-02',
    exitDate: '2026-10-29',
    entryPrice: 422.5,
    exitPrice: 416.8,
    shares: 15,
    setupTag: 'VWAP Pullback',
    notes: 'Stopped below prior swing low after rate spike; disciplined risk cap.',
    createdAt: 1791000000000,
  },
  {
    id: 'tr-seed-3',
    symbol: 'AAPL',
    side: 'LONG',
    entryDate: '2026-11-05',
    exitDate: '',
    entryPrice: 342.0,
    exitPrice: null,
    shares: 25,
    setupTag: 'Value Entry',
    notes: 'Accumulating core position on services margin expansion.',
    createdAt: 1792000000000,
  },
];

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeFinancialPlan(raw: unknown): FinancialPlanInputs {
  try {
    if (!raw || typeof raw !== 'object') return DEFAULT_FINANCIAL_PLAN;
    const saved = raw as Partial<FinancialPlanInputs> & {
      equitiesPct?: number;
      milestones?: { id: string; label: string; age: number; amount: number }[];
    };

    let usEquitiesPct = saved.usEquitiesPct;
    let intlEquitiesPct = saved.intlEquitiesPct;
    if (typeof usEquitiesPct !== 'number' || typeof intlEquitiesPct !== 'number') {
      if (typeof saved.equitiesPct === 'number') {
        usEquitiesPct = Math.round(saved.equitiesPct * 0.72);
        intlEquitiesPct = Math.max(0, Math.round(saved.equitiesPct - usEquitiesPct));
      } else {
        usEquitiesPct = DEFAULT_FINANCIAL_PLAN.usEquitiesPct;
        intlEquitiesPct = DEFAULT_FINANCIAL_PLAN.intlEquitiesPct;
      }
    }

    const migratedGoals = Array.isArray(saved.goals)
      ? saved.goals
      : Array.isArray(saved.milestones)
      ? saved.milestones.map((m) => ({
          id: m.id,
          label: m.label,
          category: (m.amount >= 0 ? 'Windfall' : 'Major Purchase') as FinancialPlanInputs['goals'][number]['category'],
          priority: 'Important' as FinancialPlanInputs['goals'][number]['priority'],
          age: m.age,
          durationYears: 1,
          amount: m.amount,
        }))
      : DEFAULT_FINANCIAL_PLAN.goals;

    return {
      ...DEFAULT_FINANCIAL_PLAN,
      ...saved,
      primaryName: saved.primaryName || DEFAULT_FINANCIAL_PLAN.primaryName,
      educationInflationRate:
        typeof saved.educationInflationRate === 'number'
          ? saved.educationInflationRate
          : DEFAULT_FINANCIAL_PLAN.educationInflationRate,
      usEquitiesPct,
      intlEquitiesPct,
      fixedIncomePct:
        typeof saved.fixedIncomePct === 'number'
          ? saved.fixedIncomePct
          : DEFAULT_FINANCIAL_PLAN.fixedIncomePct,
      alternativesPct:
        typeof saved.alternativesPct === 'number'
          ? saved.alternativesPct
          : DEFAULT_FINANCIAL_PLAN.alternativesPct,
      cashPct:
        typeof saved.cashPct === 'number'
          ? saved.cashPct
          : DEFAULT_FINANCIAL_PLAN.cashPct,
      spouse: {
        ...DEFAULT_FINANCIAL_PLAN.spouse,
        ...(saved.spouse ?? {}),
      },
      children: Array.isArray(saved.children)
        ? saved.children
        : DEFAULT_FINANCIAL_PLAN.children,
      goals: migratedGoals,
    };
  } catch {
    return DEFAULT_FINANCIAL_PLAN;
  }
}

function hydrateFinancialPlan(): FinancialPlanInputs {
  try {
    const rawStr = localStorage.getItem('meridian_plan');
    if (!rawStr) return DEFAULT_FINANCIAL_PLAN;
    return normalizeFinancialPlan(JSON.parse(rawStr));
  } catch {
    return DEFAULT_FINANCIAL_PLAN;
  }
}

export default function App() {
  const [stocksMap, setStocksMap] = useState<Record<string, StockProfile>>(() =>
    buildInitialMarketUniverse()
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chart');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('AAPL');
  const [favorites, setFavorites] = useState<string[]>(() =>
    readStorage('meridian_favorites', ['AAPL', 'MSFT', 'NVDA', 'SPY'])
  );
  const [watchlistOrder, setWatchlistOrder] = useState<string[]>(() =>
    readStorage<string[]>('meridian_watchlist_order_v1', [])
  );
  const [watchlists, setWatchlists] = useState<CustomWatchlist[]>(() =>
    readStorage<CustomWatchlist[]>('meridian_watchlists_v1', DEFAULT_WATCHLISTS)
  );
  const [activeWatchlistId, setActiveWatchlistId] = useState<string>('ALL');
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() =>
    readStorage('meridian_holdings', INITIAL_PORTFOLIO)
  );
  const [journal, setJournal] = useState<TradeJournalEntry[]>(() =>
    readStorage<TradeJournalEntry[]>('meridian_journal_v1', INITIAL_JOURNAL)
  );
  const [plan, setPlan] = useState<FinancialPlanInputs>(() => hydrateFinancialPlan());
  const [alerts, setAlerts] = useState<PriceAlert[]>(() =>
    readStorage<PriceAlert[]>('meridian_alerts_v1', [])
  );
  const [dcfBySymbol, setDcfBySymbol] = useState<Record<string, DcfAssumptions>>({});
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Default to Merrill Lynch crisp white & blue light theme
  const [isDark, setIsDark] = useState<boolean>(() => readStorage('meridian_theme_v2_dark', false));
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'landing' | 'terminal'>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('billing') || params.get('view') === 'terminal') {
        return 'terminal';
      }
      return 'landing';
    } catch {
      return 'landing';
    }
  });
  const [plansModalOpen, setPlansModalOpen] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<UpgradeContext | null>(null);
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [localTermsAcceptedAt, setLocalTermsAcceptedAt] = useState<string | null>(() =>
    readStorage<string | null>('meridian_terms_accepted_v1', null)
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [cloudReadyUid, setCloudReadyUid] = useState<string | null>(null);

  const symbolsRef = useRef<string[]>(Object.keys(stocksMap));
  symbolsRef.current = Object.keys(stocksMap);

  const latestStateRef = useRef({
    holdings,
    alerts,
    journal,
    plan,
    favorites,
    watchlistOrder,
    watchlists,
  });
  latestStateRef.current = {
    holdings,
    alerts,
    journal,
    plan,
    favorites,
    watchlistOrder,
    watchlists,
  };

  const skipNextSyncRef = useRef({
    holdings: false,
    alerts: false,
    journal: false,
    plan: false,
    preferences: false,
  });

  // Global Cmd/Ctrl + K shortcut for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setViewMode('terminal');
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamically synchronize canonical & og:url tags with the active origin
  useEffect(() => {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = cleanUrl;
    const ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (ogUrl) ogUrl.content = cleanUrl;
    const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]');
    if (ogImage) ogImage.content = `${window.location.origin}/og-meridian.jpg`;
    const twitterImage = document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]');
    if (twitterImage) twitterImage.content = `${window.location.origin}/og-meridian.jpg`;
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('meridian_theme_v2_dark', JSON.stringify(isDark));
    } catch {
      // Ignore storage quota errors
    }
  }, [isDark]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_favorites', JSON.stringify(favorites));
    } catch {
      // Ignore
    }
  }, [favorites]);

  useEffect(() => {
    try {
      if (watchlistOrder.length > 0) {
        localStorage.setItem('meridian_watchlist_order_v1', JSON.stringify(watchlistOrder));
      }
    } catch {
      // Ignore
    }
  }, [watchlistOrder]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_holdings', JSON.stringify(holdings));
    } catch {
      // Ignore
    }
  }, [holdings]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_plan', JSON.stringify(plan));
    } catch {
      // Ignore
    }
  }, [plan]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_alerts_v1', JSON.stringify(alerts));
    } catch {
      // Ignore
    }
  }, [alerts]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_journal_v1', JSON.stringify(journal));
    } catch {
      // Ignore
    }
  }, [journal]);

  useEffect(() => {
    try {
      localStorage.setItem('meridian_watchlists_v1', JSON.stringify(watchlists));
    } catch {
      // Ignore
    }
  }, [watchlists]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(null), 2600);
  }, []);

  // Firebase Auth listener + initial Cloud SQL workspace hydration
  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setAuthUser(user);

      if (!user) {
        setCloudReadyUid(null);
        setAccountProfile(null);
        return;
      }

      try {
        const idToken = await user.getIdToken();
        const [remote, profile] = await Promise.all([
          fetchCloudWorkspace(idToken),
          fetchAccountProfile(idToken).catch(() => null),
        ]);
        if (!active) return;

        if (profile) {
          setAccountProfile(profile);
        }

        if (remote.hasSavedData) {
          if (remote.holdings) {
            skipNextSyncRef.current.holdings = true;
            setHoldings(remote.holdings);
          }
          if (remote.alerts) {
            skipNextSyncRef.current.alerts = true;
            setAlerts(remote.alerts);
          }
          if (remote.journal) {
            skipNextSyncRef.current.journal = true;
            setJournal(remote.journal);
          }
          if (remote.plan) {
            skipNextSyncRef.current.plan = true;
            setPlan(normalizeFinancialPlan(remote.plan));
          }
          if (remote.favorites || remote.watchlistOrder || remote.watchlists) {
            skipNextSyncRef.current.preferences = true;
            if (remote.favorites) setFavorites(remote.favorites);
            if (remote.watchlistOrder) setWatchlistOrder(remote.watchlistOrder);
            if (remote.watchlists && remote.watchlists.length > 0) {
              setWatchlists(remote.watchlists);
            }
          }
        } else {
          // Brand-new account: seed current local workspace into account storage
          const current = latestStateRef.current;
          await Promise.all([
            saveCloudHoldings(idToken, current.holdings),
            saveCloudAlerts(idToken, current.alerts),
            saveCloudJournal(idToken, current.journal),
            saveCloudFinancialPlan(idToken, current.plan),
            saveCloudPreferences(
              idToken,
              current.favorites,
              current.watchlistOrder,
              current.watchlists
            ),
          ]);
        }

        if (active) {
          setCloudReadyUid(user.uid);
        }
      } catch (err) {
        console.error('Workspace sync failed on sign-in:', err);
        if (active) {
          showToast('Signed in, but could not load saved workspace right now');
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [showToast]);

  // Capture return query parameter after Stripe Checkout redirect
  const [pendingCheckoutSessionId, setPendingCheckoutSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    const sessionId = params.get('session_id');
    if (billing === 'success') {
      if (sessionId) {
        setPendingCheckoutSessionId(sessionId);
      } else {
        showToast('Subscription checkout completed. Syncing your plan entitlement...');
      }
      window.history.replaceState({}, '', window.location.pathname);
    } else if (billing === 'canceled') {
      showToast('Checkout canceled — no charges were made.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [showToast]);

  // Confirm Stripe Checkout session server-side once authenticated so plan unlocks immediately
  useEffect(() => {
    if (!pendingCheckoutSessionId || !authUser) return;
    let active = true;
    (async () => {
      try {
        const idToken = await authUser.getIdToken();
        const confirmed = await confirmBillingSession(idToken, pendingCheckoutSessionId);
        const refreshed = await fetchAccountProfile(idToken).catch(() => null);
        if (!active) return;
        if (refreshed) {
          setAccountProfile(refreshed);
        } else {
          setAccountProfile((prev) =>
            prev
              ? {
                  ...prev,
                  planTier: confirmed.planTier,
                  subscriptionStatus: confirmed.subscriptionStatus,
                  currentPeriodEnd: confirmed.currentPeriodEnd,
                  hasStripeCustomer: true,
                }
              : prev
          );
        }
        const label =
          confirmed.planTier === 'advisor' ? 'Advisor & Institutional' : 'Pro Trader';
        showToast(`Payment confirmed — your ${label} plan is now active`);
      } catch (err) {
        console.error('Checkout confirmation failed:', err);
        if (active) {
          showToast('Checkout completed; refresh shortly if your plan has not updated yet');
        }
      } finally {
        if (active) setPendingCheckoutSessionId(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [pendingCheckoutSessionId, authUser, showToast]);

  // Debounced persistence of portfolio holdings when signed in
  useEffect(() => {
    if (!authUser || cloudReadyUid !== authUser.uid) return;
    if (skipNextSyncRef.current.holdings) {
      skipNextSyncRef.current.holdings = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await authUser.getIdToken();
        await saveCloudHoldings(idToken, holdings);
      } catch (err) {
        console.error('Failed to persist holdings:', err);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [authUser, cloudReadyUid, holdings]);

  // Debounced persistence of price alerts when signed in
  useEffect(() => {
    if (!authUser || cloudReadyUid !== authUser.uid) return;
    if (skipNextSyncRef.current.alerts) {
      skipNextSyncRef.current.alerts = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await authUser.getIdToken();
        await saveCloudAlerts(idToken, alerts);
      } catch (err) {
        console.error('Failed to persist alerts:', err);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [authUser, cloudReadyUid, alerts]);

  // Debounced persistence of trade journal when signed in
  useEffect(() => {
    if (!authUser || cloudReadyUid !== authUser.uid) return;
    if (skipNextSyncRef.current.journal) {
      skipNextSyncRef.current.journal = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await authUser.getIdToken();
        await saveCloudJournal(idToken, journal);
      } catch (err) {
        console.error('Failed to persist trade journal:', err);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [authUser, cloudReadyUid, journal]);

  // Debounced persistence of financial plan when signed in
  useEffect(() => {
    if (!authUser || cloudReadyUid !== authUser.uid) return;
    if (skipNextSyncRef.current.plan) {
      skipNextSyncRef.current.plan = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await authUser.getIdToken();
        await saveCloudFinancialPlan(idToken, plan);
      } catch (err) {
        console.error('Failed to persist financial plan:', err);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [authUser, cloudReadyUid, plan]);

  // Debounced persistence of favorites, custom watchlists & order when signed in
  useEffect(() => {
    if (!authUser || cloudReadyUid !== authUser.uid) return;
    if (skipNextSyncRef.current.preferences) {
      skipNextSyncRef.current.preferences = false;
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const idToken = await authUser.getIdToken();
        await saveCloudPreferences(idToken, favorites, watchlistOrder, watchlists);
      } catch (err) {
        console.error('Failed to persist watchlist preferences:', err);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [authUser, cloudReadyUid, favorites, watchlistOrder, watchlists]);

  const handleSignIn = useCallback(async () => {
    setAuthBusy(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const name = cred.user.displayName || cred.user.email || 'Account';
      showToast(`Signed in as ${name}`);
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      if (code !== 'auth/popup-closed-by-user') {
        showToast('Sign-in could not be completed');
      }
    } finally {
      setAuthBusy(false);
    }
  }, [showToast]);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
      showToast('Signed out');
    } catch {
      showToast('Unable to sign out right now');
    } finally {
      setAuthBusy(false);
    }
  }, [showToast]);

  const handleStartCheckout = useCallback(
    async (tier: Exclude<PlanTier, 'free'>): Promise<{ url?: string; error?: string }> => {
      if (!authUser) {
        return { error: 'Please sign in first to upgrade your plan.' };
      }
      try {
        const idToken = await authUser.getIdToken();
        const res = await createBillingCheckout(idToken, tier);
        return { url: res.url };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Unable to start checkout right now.',
        };
      }
    },
    [authUser]
  );

  const handleOpenBillingPortal = useCallback(async (): Promise<{
    url?: string;
    error?: string;
  }> => {
    if (!authUser) {
      return { error: 'Please sign in first to manage billing.' };
    }
    try {
      const idToken = await authUser.getIdToken();
      const res = await createBillingPortal(idToken);
      return { url: res.url };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Unable to open billing portal right now.',
      };
    }
  }, [authUser]);

  const handleAcceptTerms = useCallback(async () => {
    const nowIso = new Date().toISOString();
    setLocalTermsAcceptedAt(nowIso);
    try {
      localStorage.setItem('meridian_terms_accepted_v1', JSON.stringify(nowIso));
    } catch {
      // Ignore storage quota errors
    }
    if (authUser) {
      try {
        const idToken = await authUser.getIdToken();
        const res = await acceptAccountTerms(idToken);
        setAccountProfile((prev) =>
          prev ? { ...prev, termsAcceptedAt: res.termsAcceptedAt } : prev
        );
      } catch (err) {
        console.error('Failed to persist terms acceptance:', err);
      }
    }
    showToast('Terms of Service and market data disclosures accepted');
  }, [authUser, showToast]);

  const currentPlanTier: PlanTier = accountProfile?.planTier ?? 'free';
  const tierLimits = useMemo(() => getTierLimits(currentPlanTier), [currentPlanTier]);

  const openUpgradePrompt = useCallback(
    (requiredTier: Exclude<PlanTier, 'free'>, feature: string) => {
      setUpgradeContext({ requiredTier, feature });
      setPlansModalOpen(true);
    },
    []
  );

  const requireTier = useCallback(
    (requiredTier: Exclude<PlanTier, 'free'>, feature: string): boolean => {
      if (hasTierAccess(currentPlanTier, requiredTier)) return true;
      openUpgradePrompt(requiredTier, feature);
      return false;
    },
    [currentPlanTier, openUpgradePrompt]
  );

  // Automatically check never-expiring alerts against latest live prices
  useEffect(() => {
    const triggeredIds = new Set<string>();
    let firstHit: PriceAlert | null = null;

    for (const al of alerts) {
      if (al.triggeredAt) continue;
      const livePrice = stocksMap[al.symbol]?.price;
      if (livePrice === undefined) continue;
      const hit =
        (al.condition === 'above' && livePrice >= al.targetPrice) ||
        (al.condition === 'below' && livePrice <= al.targetPrice);
      if (hit) {
        triggeredIds.add(al.id);
        if (!firstHit) firstHit = al;
      }
    }

    if (triggeredIds.size > 0) {
      const now = Date.now();
      setAlerts((prev) =>
        prev.map((al) => (triggeredIds.has(al.id) ? { ...al, triggeredAt: now } : al))
      );
      if (firstHit) {
        showToast(
          `Price Alert Triggered: ${firstHit.symbol} ${firstHit.condition} $${firstHit.targetPrice.toFixed(2)}`
        );
      }
    }
  }, [stocksMap, alerts, showToast]);

  // Fetch accurate real-time quotes from Yahoo Finance via our Express backend
  const syncLiveQuotes = useCallback(async (showNotification = false) => {
    const syms = symbolsRef.current;
    if (syms.length === 0) return;
    setIsSyncing(true);
    const payload = await fetchLiveQuotes(syms);
    setIsSyncing(false);

    if (!payload || Object.keys(payload.quotes).length === 0) {
      if (showNotification) showToast('Could not reach live market feed');
      return;
    }

    setLastSyncedAt(payload.asOf);
    setStocksMap((prev) => {
      const next: Record<string, StockProfile> = { ...prev };
      for (const [sym, q] of Object.entries(payload.quotes)) {
        const existing = next[sym];
        if (!existing) continue;
        const fy25 = existing.annualFinancials[existing.annualFinancials.length - 1];
        const marketCapB = Number(((q.price * existing.sharesOutM) / 1000).toFixed(1));
        const evM = marketCapB * 1000 + existing.netDebtM;
        const peTtm = fy25 ? Number((q.price / Math.max(0.01, fy25.eps)).toFixed(1)) : existing.peTtm;
        const evEbitda = fy25 ? Number((evM / Math.max(1, fy25.ebitda)).toFixed(1)) : existing.evEbitda;
        const evRevenue = fy25 ? Number((evM / Math.max(1, fy25.revenue)).toFixed(1)) : existing.evRevenue;

        next[sym] = {
          ...existing,
          name: q.name || existing.name,
          exchange: q.exchange || existing.exchange,
          price: q.price,
          prevClose: q.prevClose,
          open: q.open,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          week52High: q.week52High,
          week52Low: q.week52Low,
          volume: q.volume,
          marketCapB,
          peTtm,
          evEbitda,
          evRevenue,
          bars: q.bars.length > 0 ? q.bars : existing.bars,
          isLive: true,
          marketTime: q.marketTime,
        };
      }
      return next;
    });

    if (showNotification) {
      showToast(`Synced ${Object.keys(payload.quotes).length} live quotes from ${payload.source}`);
    }
  }, [showToast]);

  // Initial sync on mount + periodic 30s live refresh
  useEffect(() => {
    syncLiveQuotes(false);
  }, [syncLiveQuotes]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      syncLiveQuotes(false);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, syncLiveQuotes]);

  const handleAddTickerFromSearch = useCallback(
    async (item: LiveSearchResult) => {
      const sym = item.symbol.toUpperCase();
      if (stocksMap[sym]) {
        setSelectedSymbol(sym);
        return;
      }
      const chart = await fetchLiveChart(sym, '6M');
      if (!chart) {
        showToast(`Unable to load live quote for ${sym}`);
        return;
      }
      const profile = buildCustomStockProfile({
        symbol: sym,
        name: chart.name || item.name,
        exchange: chart.exchange || item.exchange,
        sector: item.sector,
        industry: item.industry,
        price: chart.price,
        prevClose: chart.prevClose,
        open: chart.open,
        dayHigh: chart.dayHigh,
        dayLow: chart.dayLow,
        week52High: chart.week52High,
        week52Low: chart.week52Low,
        volume: chart.volume,
        marketTime: chart.marketTime,
        bars: chart.bars,
      });
      setStocksMap((prev) => ({ [sym]: profile, ...prev }));
      setWatchlistOrder((prev) => [sym, ...prev.filter((s) => s !== sym)]);
      setSelectedSymbol(sym);
      if (activeTab === 'planner') setActiveTab('chart');
      showToast(`Added ${sym} ($${chart.price.toFixed(2)}) to watchlist`);
    },
    [stocksMap, activeTab, showToast]
  );

  const stocksList = useMemo(() => {
    const keys = Object.keys(stocksMap);
    if (watchlistOrder.length === 0) return keys.map((k) => stocksMap[k]);
    const ordered: StockProfile[] = [];
    const seen = new Set<string>();
    for (const sym of watchlistOrder) {
      if (stocksMap[sym] && !seen.has(sym)) {
        ordered.push(stocksMap[sym]);
        seen.add(sym);
      }
    }
    for (const sym of keys) {
      if (!seen.has(sym)) {
        ordered.push(stocksMap[sym]);
      }
    }
    return ordered;
  }, [stocksMap, watchlistOrder]);

  const handleReorderWatchlist = useCallback(
    (fromSymbol: string, toSymbol: string) => {
      if (fromSymbol === toSymbol) return;
      setWatchlistOrder((prev) => {
        const allKeys = Object.keys(stocksMap);
        const base =
          prev.length > 0
            ? [...prev.filter((s) => stocksMap[s]), ...allKeys.filter((k) => !prev.includes(k))]
            : allKeys;
        const fromIdx = base.indexOf(fromSymbol);
        const toIdx = base.indexOf(toSymbol);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
        const next = [...base];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    [stocksMap]
  );

  const activeStock = stocksMap[selectedSymbol] ?? stocksList[0];

  const activeDcfAssumptions = useMemo(() => {
    return dcfBySymbol[activeStock.symbol] ?? getDefaultDcfAssumptions(activeStock);
  }, [dcfBySymbol, activeStock]);

  const handleToggleFavorite = (symbol: string) => {
    setFavorites((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const handleAddOrUpdateHolding = (symbol: string, sharesDelta: number, executionPrice: number) => {
    setHoldings((prev) => {
      const existing = prev.find((h) => h.symbol === symbol);
      if (!existing) {
        if (sharesDelta <= 0) return prev;
        return [
          ...prev,
          { id: `pos-${Date.now()}`, symbol, shares: sharesDelta, avgCost: executionPrice },
        ];
      }
      const nextShares = existing.shares + sharesDelta;
      if (nextShares <= 0) {
        return prev.filter((h) => h.id !== existing.id);
      }
      const nextCost =
        sharesDelta > 0
          ? Number(
              (
                (existing.shares * existing.avgCost + sharesDelta * executionPrice) /
                nextShares
              ).toFixed(2)
            )
          : existing.avgCost;
      return prev.map((h) =>
        h.id === existing.id ? { ...h, shares: nextShares, avgCost: nextCost } : h
      );
    });
  };

  const handleUpdateHolding = (id: string, shares: number, avgCost: number) => {
    setHoldings((prev) => prev.map((h) => (h.id === id ? { ...h, shares, avgCost } : h)));
  };

  const handleAddHolding = (symbol: string, shares: number, avgCost: number) => {
    handleAddOrUpdateHolding(symbol, shares, avgCost);
  };

  const handleImportHoldings = (
    imported: Array<{ symbol: string; shares: number; avgCost: number }>
  ) => {
    setHoldings((prev) => {
      const bySymbol = new Map<string, PortfolioHolding>();
      for (const h of prev) {
        bySymbol.set(h.symbol, { ...h });
      }
      imported.forEach((item, idx) => {
        const existing = bySymbol.get(item.symbol);
        if (existing) {
          bySymbol.set(item.symbol, {
            ...existing,
            shares: item.shares,
            avgCost: item.avgCost,
          });
        } else {
          bySymbol.set(item.symbol, {
            id: `pos-csv-${Date.now()}-${idx}`,
            symbol: item.symbol,
            shares: item.shares,
            avgCost: item.avgCost,
          });
        }
      });
      return Array.from(bySymbol.values());
    });
    showToast(`Synced ${imported.length} brokerage positions into Portfolio`);
  };

  const handleRemoveHolding = (id: string) => {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  };

  const handleAddAlert = (
    symbol: string,
    condition: 'above' | 'below',
    targetPrice: number,
    note: string
  ) => {
    const activeCount = alerts.filter((a) => !a.triggeredAt).length;
    if (activeCount >= tierLimits.maxActiveAlerts) {
      openUpgradePrompt(
        'pro',
        `More than ${tierLimits.maxActiveAlerts} active price alerts`
      );
      return;
    }
    setAlerts((prev) => [
      {
        id: `al-${Date.now()}`,
        symbol,
        condition,
        targetPrice,
        note,
        createdAt: Date.now(),
        triggeredAt: null,
      },
      ...prev,
    ]);
    showToast(`Alert armed: ${symbol} ${condition} $${targetPrice.toFixed(2)} (no expiry)`);
  };

  const handleDeleteAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleResetAlert = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, triggeredAt: null } : a)));
  };

  const handleCreateWatchlist = (name: string) => {
    if (watchlists.length >= tierLimits.maxCustomWatchlists) {
      openUpgradePrompt(
        'pro',
        `More than ${tierLimits.maxCustomWatchlists} custom watchlists`
      );
      return;
    }
    const id = `wl-${Date.now()}`;
    setWatchlists((prev) => [...prev, { id, name, symbols: [activeStock.symbol] }]);
    setActiveWatchlistId(id);
    showToast(`Created watchlist "${name}"`);
  };

  const handleDeleteWatchlist = (id: string) => {
    setWatchlists((prev) => prev.filter((w) => w.id !== id));
    if (activeWatchlistId === id) setActiveWatchlistId('ALL');
    showToast('Deleted custom watchlist');
  };

  const handleToggleSymbolInWatchlist = (watchlistId: string, symbol: string) => {
    setWatchlists((prev) =>
      prev.map((w) => {
        if (w.id !== watchlistId) return w;
        const exists = w.symbols.includes(symbol);
        return {
          ...w,
          symbols: exists
            ? w.symbols.filter((s) => s !== symbol)
            : [...w.symbols, symbol],
        };
      })
    );
  };

  const handleAddJournalEntry = (entry: Omit<TradeJournalEntry, 'id' | 'createdAt'>) => {
    if (journal.length >= tierLimits.maxJournalEntries) {
      openUpgradePrompt(
        'pro',
        `More than ${tierLimits.maxJournalEntries} trade journal entries`
      );
      return;
    }
    const next: TradeJournalEntry = {
      ...entry,
      id: `tr-${Date.now()}`,
      createdAt: Date.now(),
    };
    setJournal((prev) => [next, ...prev]);
    showToast(`Logged ${entry.side} ${entry.symbol} in Trade Journal`);
  };

  const handleDeleteJournalEntry = (id: string) => {
    setJournal((prev) => prev.filter((e) => e.id !== id));
  };

  const handleCloseJournalEntry = (id: string, exitPrice: number, exitDate: string) => {
    setJournal((prev) =>
      prev.map((e) => (e.id === id ? { ...e, exitPrice, exitDate } : e))
    );
    showToast(`Closed trade at $${exitPrice.toFixed(2)}`);
  };

  const handlePrintEquityReport = () => {
    if (!requireTier('advisor', 'Branded PDF Equity Tear Sheets')) return;
    const dcfOut = computeDcfValuation(activeStock, activeDcfAssumptions);
    const peers = [
      activeStock,
      ...activeStock.peerSymbols
        .map((s) => stocksMap[s])
        .filter((p): p is StockProfile => Boolean(p)),
    ];
    printEquityTearSheet(activeStock, activeDcfAssumptions, dcfOut, peers);
  };

  const handlePrintPortfolioReport = () => {
    if (!requireTier('advisor', 'Client-Ready Portfolio PDF Reports')) return;
    printPortfolioReport(holdings, stocksMap);
  };

  const handlePrintActiveReport = () => {
    if (!requireTier('advisor', 'Branded Client PDF Reports & Tear Sheets')) return;
    if (activeTab === 'planner') {
      const portfolioVal = holdings.reduce(
        (sum, h) => sum + h.shares * (stocksMap[h.symbol]?.price ?? h.avgCost),
        0
      );
      const out = runFinancialPlanModel(plan, portfolioVal);
      printFinancialPlanReport(plan, out);
    } else if (activeTab === 'portfolio') {
      printPortfolioReport(holdings, stocksMap);
    } else {
      const dcfOut = computeDcfValuation(activeStock, activeDcfAssumptions);
      const peers = [
        activeStock,
        ...activeStock.peerSymbols
          .map((s) => stocksMap[s])
          .filter((p): p is StockProfile => Boolean(p)),
      ];
      printEquityTearSheet(activeStock, activeDcfAssumptions, dcfOut, peers);
    }
  };

  const handleExportCsv = () => {
    if (activeTab === 'chart') {
      downloadCsv(
        `${activeStock.symbol}_ohlcv.csv`,
        ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'],
        activeStock.bars.map((b) => [b.time, b.open, b.high, b.low, b.close, b.volume])
      );
      showToast(`Exported ${activeStock.symbol} OHLCV history (CSV)`);
    } else if (activeTab === 'screener') {
      downloadCsv(
        'meridian_screener.csv',
        ['Symbol', 'Name', 'Sector', 'Price', 'Market Cap ($B)', 'Fwd P/E', 'EV/EBITDA', 'Rev Growth (%)', 'Div Yield (%)'],
        stocksList.map((s) => [
          s.symbol,
          s.name,
          s.sector,
          s.price.toFixed(2),
          s.marketCapB.toFixed(1),
          s.peForward.toFixed(1),
          s.evEbitda.toFixed(1),
          s.revenueGrowthYoy.toFixed(1),
          s.dividendYield.toFixed(2),
        ])
      );
      showToast('Exported Screener universe (CSV)');
    } else if (activeTab === 'portfolio') {
      downloadCsv(
        'meridian_portfolio_holdings.csv',
        ['Symbol', 'Shares', 'Avg Cost ($)', 'Last Price ($)', 'Market Value ($)', 'Unrealized P&L ($)'],
        holdings.map((h) => {
          const price = stocksMap[h.symbol]?.price ?? h.avgCost;
          const mv = h.shares * price;
          const pnl = mv - h.shares * h.avgCost;
          return [h.symbol, h.shares, h.avgCost.toFixed(2), price.toFixed(2), mv.toFixed(2), pnl.toFixed(2)];
        })
      );
      showToast('Exported Portfolio holdings (CSV)');
    } else if (activeTab === 'fundamentals') {
      downloadCsv(
        `${activeStock.symbol}_financials.csv`,
        ['Period', 'Revenue ($M)', 'Gross Profit ($M)', 'EBIT ($M)', 'EBITDA ($M)', 'Net Income ($M)', 'EPS ($)', 'Free Cash Flow ($M)'],
        activeStock.annualFinancials.map((f) => [
          f.period,
          f.revenue,
          f.grossProfit,
          f.ebit,
          f.ebitda,
          f.netIncome,
          f.eps,
          f.freeCashFlow,
        ])
      );
      showToast(`Exported ${activeStock.symbol} financial statements (CSV)`);
    } else if (activeTab === 'dcf') {
      const res = computeDcfValuation(activeStock, activeDcfAssumptions);
      downloadCsv(
        `${activeStock.symbol}_dcf_model.csv`,
        ['Year', 'Revenue ($M)', 'Growth (%)', 'EBIT ($M)', 'NOPAT ($M)', 'UFCF ($M)', 'PV of UFCF ($M)'],
        res.years.map((y) => [
          y.label,
          Math.round(y.revenue),
          y.revGrowthPct.toFixed(1),
          Math.round(y.ebit),
          Math.round(y.nopat),
          Math.round(y.ufcf),
          Math.round(y.pvUfcf),
        ])
      );
      showToast(`Exported ${activeStock.symbol} DCF valuation schedule (CSV)`);
    } else {
      const portfolioVal = holdings.reduce(
        (sum, h) => sum + h.shares * (stocksMap[h.symbol]?.price ?? h.avgCost),
        0
      );
      const out = runFinancialPlanModel(plan, portfolioVal);
      downloadCsv(
        'meridian_financial_plan.csv',
        [
          'Age',
          'Spouse Age',
          'Year',
          'Phase',
          'Contribution ($)',
          'Education ($)',
          'Goals ($)',
          'Social Security ($)',
          'Withdrawal ($)',
          'Taxes ($)',
          'Median Nominal ($)',
          'Median Real ($)',
          'P10 Real ($)',
          'P90 Real ($)',
        ],
        out.rows.map((r) => [
          r.age,
          r.spouseAge ?? '',
          r.year,
          r.phase,
          Math.round(r.contribution),
          Math.round(r.educationOutflow),
          Math.round(r.goalFlow),
          Math.round(r.socialSecurity),
          Math.round(r.withdrawal),
          Math.round(r.taxesPaid),
          Math.round(r.p50Nominal),
          Math.round(r.p50Real),
          Math.round(r.p10Real),
          Math.round(r.p90Real),
        ])
      );
      showToast('Exported Financial Plan projection schedule (CSV)');
    }
  };

  const activeAlertsCount = useMemo(
    () => alerts.filter((a) => !a.triggeredAt).length,
    [alerts]
  );

  const activeWatchlistObj = useMemo(
    () => watchlists.find((w) => w.id === activeWatchlistId) ?? null,
    [watchlists, activeWatchlistId]
  );

  const currentWatchlistName = activeWatchlistObj ? activeWatchlistObj.name : 'All Market';
  const currentWatchlistSymbols = useMemo(
    () =>
      activeWatchlistObj
        ? activeWatchlistObj.symbols.filter((s) => Boolean(stocksMap[s]))
        : stocksList.map((s) => s.symbol),
    [activeWatchlistObj, stocksMap, stocksList]
  );

  const landingQuotes = useMemo(() => {
    const featured = ['AAPL', 'MSFT', 'NVDA', 'SPY'];
    return featured
      .map((sym) => stocksMap[sym])
      .filter((s): s is StockProfile => Boolean(s))
      .map((s) => ({
        symbol: s.symbol,
        name: s.name,
        price: s.price,
        changePct: s.prevClose > 0 ? ((s.price - s.prevClose) / s.prevClose) * 100 : 0,
      }));
  }, [stocksMap]);

  const handleLaunchTerminal = useCallback((tab?: WorkspaceTab, symbol?: string) => {
    if (symbol && stocksMap[symbol]) {
      setSelectedSymbol(symbol);
    }
    if (tab) {
      setActiveTab(tab);
    }
    setViewMode('terminal');
  }, [stocksMap]);

  const sharedModals = (
    <>
      <PlansBillingModal
        open={plansModalOpen}
        onClose={() => {
          setPlansModalOpen(false);
          setUpgradeContext(null);
        }}
        isSignedIn={Boolean(authUser)}
        accountProfile={accountProfile}
        upgradeContext={upgradeContext}
        onSignIn={handleSignIn}
        onStartCheckout={handleStartCheckout}
        onOpenPortal={handleOpenBillingPortal}
        onOpenLegal={() => setLegalModalOpen(true)}
      />

      <LegalDisclosuresModal
        open={legalModalOpen}
        onClose={() => setLegalModalOpen(false)}
        termsAcceptedAt={accountProfile?.termsAcceptedAt ?? localTermsAcceptedAt}
        onAcceptTerms={handleAcceptTerms}
      />

      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-9 left-4 z-50 px-4 py-2.5 rounded-md bg-[#012169] dark:bg-slate-100 text-white dark:text-slate-950 text-xs font-medium shadow-lg border border-[#0052C2] dark:border-slate-300"
        >
          {toastMessage}
        </div>
      )}
    </>
  );

  if (viewMode === 'landing') {
    return (
      <>
        <LandingPage
          onLaunchTerminal={handleLaunchTerminal}
          onSelectPaidPlan={(tier) => {
            setUpgradeContext({
              requiredTier: tier,
              feature:
                tier === 'advisor'
                  ? 'Advisor & Institutional Plan ($39/mo)'
                  : 'Pro Trader ($1 first month, then $12/mo)',
            });
            setPlansModalOpen(true);
          }}
          onOpenLegal={() => setLegalModalOpen(true)}
          onSignIn={handleSignIn}
          isSignedIn={Boolean(authUser)}
          userLabel={authUser?.displayName || authUser?.email || null}
          currentPlanTier={currentPlanTier}
          isDark={isDark}
          onToggleTheme={() => setIsDark((v) => !v)}
          sampleQuotes={landingQuotes}
        />
        {sharedModals}
      </>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#F4F7FB] dark:bg-[#0B0F17] text-[#0A1F44] dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportCsv={handleExportCsv}
        onPrintReport={handlePrintActiveReport}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenMobileWatchlist={() => setMobileWatchlistOpen(true)}
        onOpenPlans={() => {
          setUpgradeContext(null);
          setPlansModalOpen(true);
        }}
        onOpenLegal={() => setLegalModalOpen(true)}
        planTier={currentPlanTier}
        user={
          authUser
            ? {
                displayName: authUser.displayName,
                email: authUser.email,
                photoURL: authUser.photoURL,
              }
            : null
        }
        authBusy={authBusy}
        activeAlertsCount={activeAlertsCount}
        isDark={isDark}
        onToggleTheme={() => setIsDark((v) => !v)}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <main className="flex-1 min-w-0 h-full overflow-hidden">
          {activeTab === 'chart' && (
            <ChartTerminal
              stock={activeStock}
              allStocks={stocksMap}
              isDark={isDark}
              planTier={currentPlanTier}
              onRequireUpgrade={openUpgradePrompt}
              holdings={holdings}
              alerts={alerts}
              onAddAlert={handleAddAlert}
              onDeleteAlert={handleDeleteAlert}
              onResetAlert={handleResetAlert}
              onSelectSymbol={(sym) => setSelectedSymbol(sym)}
              onAddOrUpdateHolding={handleAddOrUpdateHolding}
            />
          )}

          {activeTab === 'screener' && (
            <ScreenerHeatmapView
              stocks={stocksList}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              onSelectSymbolForChart={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('chart');
              }}
            />
          )}

          {activeTab === 'earnings' && (
            <EarningsCalendarView
              watchlistName={currentWatchlistName}
              watchlistSymbols={currentWatchlistSymbols}
              allStocks={stocksMap}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              onSelectSymbolForChart={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('chart');
              }}
              onSelectSymbolForFundamentals={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('fundamentals');
              }}
              onQuickAlert={(sym, currentPrice) => {
                const target = Number((currentPrice * 1.05).toFixed(2));
                handleAddAlert(sym, 'above', target, 'Pre-earnings breakout catalyst');
              }}
            />
          )}

          {activeTab === 'fundamentals' && (
            <FundamentalsView
              stock={activeStock}
              allStocks={stocksMap}
              onSelectSymbol={(sym) => setSelectedSymbol(sym)}
              onPrintTearSheet={handlePrintEquityReport}
            />
          )}

          {activeTab === 'dcf' && (
            <ValuationDcfView
              stock={activeStock}
              assumptions={activeDcfAssumptions}
              onChangeAssumptions={(next) =>
                setDcfBySymbol((prev) => ({ ...prev, [activeStock.symbol]: next }))
              }
            />
          )}

          {activeTab === 'portfolio' && (
            <PortfolioRiskView
              holdings={holdings}
              stocksMap={stocksMap}
              journal={journal}
              planTier={currentPlanTier}
              onRequireUpgrade={openUpgradePrompt}
              onAddHolding={handleAddHolding}
              onImportHoldings={handleImportHoldings}
              onUpdateHolding={handleUpdateHolding}
              onRemoveHolding={handleRemoveHolding}
              onAddJournalEntry={handleAddJournalEntry}
              onDeleteJournalEntry={handleDeleteJournalEntry}
              onCloseJournalEntry={handleCloseJournalEntry}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('chart');
              }}
              onPrintPortfolioReport={handlePrintPortfolioReport}
            />
          )}

          {activeTab === 'planner' && (
            <FinancialPlannerView
              plan={plan}
              onChangePlan={setPlan}
              holdings={holdings}
              stocksMap={stocksMap}
              onUpdateHolding={handleUpdateHolding}
              onAddHolding={handleAddHolding}
              onRemoveHolding={handleRemoveHolding}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setActiveTab('chart');
              }}
            />
          )}
        </main>

        <WatchlistSidebar
          stocks={stocksList}
          selectedSymbol={activeStock.symbol}
          onSelectSymbol={(sym) => {
            setSelectedSymbol(sym);
            if (activeTab === 'planner' || activeTab === 'portfolio' || activeTab === 'screener') {
              setActiveTab('chart');
            }
          }}
          onReorderWatchlist={handleReorderWatchlist}
          onAddTickerFromSearch={handleAddTickerFromSearch}
          favorites={favorites}
          onToggleFavorite={handleToggleFavorite}
          watchlists={watchlists}
          activeWatchlistId={activeWatchlistId}
          onSelectWatchlist={setActiveWatchlistId}
          onCreateWatchlist={handleCreateWatchlist}
          onDeleteWatchlist={handleDeleteWatchlist}
          onToggleSymbolInWatchlist={handleToggleSymbolInWatchlist}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
          isSyncing={isSyncing}
          lastSyncedAt={lastSyncedAt}
          onManualRefresh={() => syncLiveQuotes(true)}
          isDark={isDark}
          onToggleTheme={() => setIsDark((v) => !v)}
          mobileOpen={mobileWatchlistOpen}
          onCloseMobile={() => setMobileWatchlistOpen(false)}
        />
      </div>

      <footer className="h-7 shrink-0 border-t border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#0A101B] px-4 lg:px-6 flex items-center justify-between gap-4 text-[11px] text-[#5A7190] dark:text-slate-400">
        <span className="truncate">
          Meridian Terminal · Informational &amp; analytical software only — not investment advice.
        </span>
        <div className="flex items-center gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('landing')}
            className="hover:text-[#012169] dark:hover:text-white hover:underline whitespace-nowrap"
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => {
              setUpgradeContext(null);
              setPlansModalOpen(true);
            }}
            className="font-medium text-[#0052C2] dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            Plans &amp; Pricing
          </button>
          <button
            type="button"
            onClick={() => setLegalModalOpen(true)}
            className="hover:text-[#012169] dark:hover:text-white hover:underline whitespace-nowrap"
          >
            Terms &amp; Disclosures
          </button>
        </div>
      </footer>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        stocks={stocksList}
        isDark={isDark}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          if (activeTab === 'planner' || activeTab === 'portfolio' || activeTab === 'screener') {
            setActiveTab('chart');
          }
        }}
        onAddRemoteTicker={handleAddTickerFromSearch}
        onSelectTab={setActiveTab}
        onExportCsv={handleExportCsv}
        onPrintReport={handlePrintActiveReport}
        onToggleTheme={() => setIsDark((v) => !v)}
      />

      {sharedModals}
    </div>
  );
}
