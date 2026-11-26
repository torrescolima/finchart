import { Check, ExternalLink, Lock, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { AccountProfile, PlanTier } from '../types/market';

export interface UpgradeContext {
  feature: string;
  requiredTier: Exclude<PlanTier, 'free'>;
}

interface PlansBillingModalProps {
  open: boolean;
  onClose: () => void;
  isSignedIn: boolean;
  accountProfile: AccountProfile | null;
  upgradeContext?: UpgradeContext | null;
  onSignIn: () => void;
  onStartCheckout: (tier: Exclude<PlanTier, 'free'>) => Promise<{ url?: string; error?: string }>;
  onOpenPortal: () => Promise<{ url?: string; error?: string }>;
  onOpenLegal: () => void;
}

interface PlanSpec {
  id: PlanTier;
  name: string;
  audience: string;
  priceMonthly: string;
  cadence: string;
  subPriceNote?: string;
  ctaLabel?: string;
  highlight?: boolean;
  features: string[];
}

const PLANS: PlanSpec[] = [
  {
    id: 'free',
    name: 'Individual',
    audience: 'For self-directed investors getting started',
    priceMonthly: '$0',
    cadence: 'forever',
    subPriceNote: 'No credit card required',
    features: [
      'Interactive candlestick, hollow, line & area charts',
      'Core technical overlays (SMA, EMA, Bollinger, VWAP, RSI, MACD)',
      'Equity screener, sector heatmap & earnings calendar',
      '5-year DCF valuation & household retirement planner',
      'Up to 3 active price alerts, 2 custom watchlists & 10 journal trades',
    ],
  },
  {
    id: 'pro',
    name: 'Pro Trader',
    audience: 'For active traders and technical analysts',
    priceMonthly: '$1',
    cadence: 'first month',
    subPriceNote: 'Then $12/mo · Cancel anytime',
    ctaLabel: 'Start Pro for $1',
    highlight: true,
    features: [
      'Everything in Individual, with commercial Polygon.io + Finnhub feeds',
      'Multi-chart split layouts (2x and 4x) & unlimited saved templates',
      'Unlimited non-expiring price & earnings catalyst alerts',
      'Unlimited trade journal entries with expectancy & win-rate analytics',
      'Pairwise return correlation matrix & macro stress testing',
    ],
  },
  {
    id: 'advisor',
    name: 'Advisor & Institutional',
    audience: 'For wealth advisors, RIAs, and portfolio managers',
    priceMonthly: '$39',
    cadence: 'per month',
    subPriceNote: 'Client-ready research & reporting',
    ctaLabel: 'Upgrade to Advisor',
    features: [
      'Everything in Pro Trader for client-facing advisory workflows',
      'Branded PDF Equity Tear Sheets & Portfolio Risk summaries',
      'Monte Carlo household wealth & 529 education PDF reports',
      'Brokerage CSV statement import (Schwab, Fidelity, IBKR)',
      'Commercial redistribution compliance & priority desk support',
    ],
  },
];

export function PlansBillingModal({
  open,
  onClose,
  isSignedIn,
  accountProfile,
  upgradeContext = null,
  onSignIn,
  onStartCheckout,
  onOpenPortal,
  onOpenLegal,
}: PlansBillingModalProps) {
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  if (!open) return null;

  const currentTier: PlanTier = accountProfile?.planTier ?? 'free';
  const status = accountProfile?.subscriptionStatus ?? 'none';
  const renewalDate = accountProfile?.currentPeriodEnd
    ? new Date(accountProfile.currentPeriodEnd).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const handleSelectPlan = async (tier: Exclude<PlanTier, 'free'>) => {
    setFeedback(null);
    setCheckoutUrl(null);
    setPortalUrl(null);
    if (!isSignedIn) {
      onSignIn();
      return;
    }
    setBusyTier(tier);
    const res = await onStartCheckout(tier);
    setBusyTier(null);
    if (res.url) {
      setCheckoutUrl(res.url);
    } else if (res.error) {
      setFeedback(res.error);
    }
  };

  const handleManageBilling = async () => {
    setFeedback(null);
    setCheckoutUrl(null);
    setPortalUrl(null);
    setBusyTier('portal');
    const res = await onOpenPortal();
    setBusyTier(null);
    if (res.url) {
      setPortalUrl(res.url);
    } else if (res.error) {
      setFeedback(res.error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Plans and Subscription Billing"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-[#0E131D] border border-[#C6D6EA] dark:border-slate-700 shadow-2xl text-[#0A1F44] dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#D6E2F0] dark:border-slate-800 bg-[#012169] dark:bg-[#0A162E] text-white flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              Meridian Terminal Plans &amp; Billing
            </h2>
            <p className="text-xs text-blue-200/90 mt-0.5">
              Transparent monthly subscriptions powered by Stripe. Cancel or switch tiers anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plans dialog"
            className="p-1.5 rounded-md text-blue-100 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {upgradeContext && (
            <div className="rounded-md border border-[#9EC5FE] dark:border-blue-800 bg-[#EAF2FD] dark:bg-blue-950/40 px-4 py-3 flex items-start gap-2.5 text-xs text-[#012169] dark:text-blue-100">
              <Lock className="w-4 h-4 mt-0.5 shrink-0 text-[#0052C2] dark:text-blue-400" />
              <div>
                <span className="font-semibold">{upgradeContext.feature}</span> requires the{' '}
                <span className="font-semibold">
                  {upgradeContext.requiredTier === 'advisor'
                    ? 'Advisor & Institutional'
                    : 'Pro Trader'}
                </span>{' '}
                plan. Choose a plan below to unlock it immediately.
              </div>
            </div>
          )}

          {/* Active Subscription Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#D6E2F0] dark:border-slate-800 bg-[#F4F7FB] dark:bg-[#121927] px-4 py-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-[#012169] dark:text-white">
                Current Plan:{' '}
                <span className="capitalize">
                  {currentTier === 'free'
                    ? 'Individual (Free)'
                    : currentTier === 'pro'
                    ? 'Pro Trader'
                    : 'Advisor & Institutional'}
                </span>
                {status !== 'none' && (
                  <span className="ml-2 font-normal text-[#5A7190] dark:text-slate-400">
                    · Status: {status}
                    {renewalDate ? ` · Renews ${renewalDate}` : ''}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#5A7190] dark:text-slate-400">
                Active Market Data Source: {accountProfile?.marketDataSource ?? 'Live Preview Feed'}
              </div>
            </div>

            {isSignedIn && accountProfile?.hasStripeCustomer && (
              <button
                type="button"
                disabled={busyTier !== null}
                onClick={handleManageBilling}
                className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[#C6D6EA] dark:border-slate-700 bg-white dark:bg-[#141B29] text-[#012169] dark:text-slate-100 hover:bg-[#EAF2FD] dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {busyTier === 'portal' ? 'Preparing Portal...' : 'Manage Billing & Invoices'}
              </button>
            )}
          </div>

          {/* Secure Redirect Banner (iframe-safe link instead of window.open) */}
          {checkoutUrl && (
            <div className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-emerald-900 dark:text-emerald-200">
                Your Stripe Checkout session is ready. Complete payment on Stripe to activate your subscription immediately.
              </div>
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap"
              >
                <span>Continue to Stripe Checkout</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {portalUrl && (
            <div className="rounded-md border border-[#9EC5FE] dark:border-blue-800 bg-[#EAF2FD] dark:bg-blue-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[#012169] dark:text-blue-200">
                Your Stripe Customer Portal link is ready. Update payment methods, invoices, or cancel anytime.
              </div>
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#012169] hover:bg-[#0052C2] text-white text-xs font-semibold whitespace-nowrap"
              >
                <span>Open Stripe Billing Portal</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {feedback && (
            <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
              {feedback}
            </div>
          )}

          {/* 3-Tier Plan Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLANS.map((plan) => {
              const isCurrent = currentTier === plan.id;
              const isHighlighted = upgradeContext
                ? upgradeContext.requiredTier === plan.id
                : Boolean(plan.highlight);
              return (
                <div
                  key={plan.id}
                  className={`rounded-lg border p-5 flex flex-col justify-between ${
                    isHighlighted
                      ? 'border-[#0052C2] dark:border-blue-500 bg-[#F8FBFF] dark:bg-[#101A2D] shadow-sm ring-1 ring-[#0052C2]/30'
                      : 'border-[#D6E2F0] dark:border-slate-800 bg-white dark:bg-[#0E131D]'
                  }`}
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-bold text-[#012169] dark:text-white">
                        {plan.name}
                      </h3>
                      {plan.highlight && (
                        <span className="text-[11px] font-semibold text-[#0052C2] dark:text-blue-400">
                          Most Popular
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#5A7190] dark:text-slate-400 mt-1">
                      {plan.audience}
                    </p>

                    <div className="mt-4 pb-4 border-b border-[#E3ECF7] dark:border-slate-800">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold font-mono tabular-nums text-[#012169] dark:text-white">
                          {plan.priceMonthly}
                        </span>
                        <span className="text-xs text-[#5A7190] dark:text-slate-400">
                          / {plan.cadence}
                        </span>
                      </div>
                      {plan.subPriceNote && (
                        <div className="mt-1 text-[11px] font-medium text-[#0052C2] dark:text-blue-400">
                          {plan.subPriceNote}
                        </div>
                      )}
                    </div>

                    <ul className="mt-4 space-y-2.5 text-xs text-[#2B4366] dark:text-slate-300">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#0052C2] dark:text-blue-400" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6">
                    {plan.id === 'free' ? (
                      <button
                        type="button"
                        disabled
                        className="w-full py-2 px-3 rounded-md text-xs font-semibold border border-[#C6D6EA] dark:border-slate-700 text-[#5A7190] dark:text-slate-400 bg-[#F4F7FB] dark:bg-slate-900/50 cursor-default"
                      >
                        {isCurrent ? 'Current Plan' : 'Included Free Tier'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isCurrent || busyTier !== null}
                        onClick={() => handleSelectPlan(plan.id as Exclude<PlanTier, 'free'>)}
                        className={`w-full py-2 px-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 ${
                          isCurrent
                            ? 'border border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
                            : plan.highlight
                            ? 'bg-[#012169] hover:bg-[#0052C2] text-white'
                            : 'bg-[#0052C2] hover:bg-[#012169] text-white'
                        }`}
                      >
                        {isCurrent
                          ? 'Active Plan'
                          : busyTier === plan.id
                          ? 'Creating Checkout...'
                          : !isSignedIn
                          ? `Sign In to ${plan.ctaLabel ?? `Select ${plan.name}`}`
                          : plan.ctaLabel ?? `Upgrade to ${plan.name}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Compliance Note */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E3ECF7] dark:border-slate-800 text-[11px] text-[#5A7190] dark:text-slate-400">
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
              <span>
                Subscriptions sync automatically via verified Stripe webhooks. Prices in USD.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLegal();
              }}
              className="text-[#0052C2] dark:text-blue-400 hover:underline font-medium"
            >
              Review Terms, Privacy &amp; Market Data Disclosures
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
