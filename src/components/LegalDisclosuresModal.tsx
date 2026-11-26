import { CheckCircle2, FileText, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

interface LegalDisclosuresModalProps {
  open: boolean;
  onClose: () => void;
  termsAcceptedAt: string | null;
  onAcceptTerms: () => Promise<void>;
}

type LegalTab = 'disclaimer' | 'terms' | 'privacy';

export function LegalDisclosuresModal({
  open,
  onClose,
  termsAcceptedAt,
  onAcceptTerms,
}: LegalDisclosuresModalProps) {
  const [tab, setTab] = useState<LegalTab>('disclaimer');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const acceptedLabel = termsAcceptedAt
    ? new Date(termsAcceptedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const handleAccept = async () => {
    setSaving(true);
    try {
      await onAcceptTerms();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Legal Disclosures, Terms of Service, and Privacy Policy"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-lg bg-white dark:bg-[#0E131D] border border-[#C6D6EA] dark:border-slate-700 shadow-2xl text-[#0A1F44] dark:text-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-[#012169] dark:bg-[#0A162E] text-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileText className="w-4 h-4 text-blue-200" />
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                Legal Disclosures, Terms &amp; Privacy
              </h2>
              <p className="text-[11px] text-blue-200/85">
                Meridian Terminal · Compliance &amp; Market Data Governance
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal disclosures"
            className="p-1.5 rounded-md text-blue-100 hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-Navigation */}
        <div className="px-6 pt-3 border-b border-[#D6E2F0] dark:border-slate-800 flex items-center gap-5 bg-[#F8FAFD] dark:bg-[#111724] shrink-0">
          {(
            [
              { id: 'disclaimer', label: 'Financial Disclaimer' },
              { id: 'terms', label: 'Terms of Service' },
              { id: 'privacy', label: 'Privacy Policy' },
            ] as { id: LegalTab; label: string }[]
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`pb-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  active
                    ? 'border-[#012169] dark:border-blue-400 text-[#012169] dark:text-white'
                    : 'border-transparent text-[#5A7190] dark:text-slate-400 hover:text-[#012169] dark:hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs leading-relaxed text-[#2B4366] dark:text-slate-300 flex-1">
          {tab === 'disclaimer' && (
            <>
              <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-amber-950 dark:text-amber-200">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong className="font-semibold">Not Investment, Tax, or Legal Advice.</strong>{' '}
                  Meridian Terminal is an analytical software platform provided strictly for informational and research purposes. Nothing displayed in this software—including DCF models, Monte Carlo wealth projections, technical indicators, correlation matrices, or PDF reports—constitutes a solicitation, recommendation, or fiduciary advice to buy, sell, or hold any security.
                </div>
              </div>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                Market Data &amp; Valuation Assumptions
              </h3>
              <p>
                Quotes, historical OHLCV bars, earnings consensus dates, and financial statements are sourced from third-party market data providers and public regulatory filings. Data may be delayed, estimated, or subject to exchange reporting revisions. Users should independently verify prices, execution terms, and corporate filings with their licensed broker-dealer before executing trades.
              </p>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                Simulated Risk &amp; Financial Planning Projections
              </h3>
              <p>
                Monte Carlo retirement simulations, beta-adjusted stress scenarios, and discounted cash flow valuations rely on historical volatility, user-entered assumptions, and simplified tax approximations. Past performance does not guarantee future results, and all investing involves risk of principal loss.
              </p>
            </>
          )}

          {tab === 'terms' && (
            <>
              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                1. License &amp; Permitted Use
              </h3>
              <p>
                Subject to an active subscription or free-tier account in good standing, Meridian Terminal grants a limited, non-exclusive, non-transferable license to access charting, screening, portfolio analytics, and wealth planning tools for your personal or authorized internal advisory workflow. Automated scraping, bulk redistribution of market feeds, or unauthorized credential sharing is prohibited.
              </p>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                2. Subscriptions, Billing &amp; Cancellation
              </h3>
              <p>
                Paid plans (Pro Trader and Advisor &amp; Institutional) are billed monthly in advance through Stripe. You may upgrade, downgrade, or cancel at any time via the Stripe Customer Portal; cancellation takes effect at the end of the current billing period with no further recurring charges.
              </p>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                3. Limitation of Liability
              </h3>
              <p>
                The software is provided &ldquo;as is&rdquo; without warranties of merchantability, fitness for a particular purpose, or uninterrupted availability. Under no circumstances shall the operator be liable for trading losses, missed executions, or indirect damages arising from use of the platform.
              </p>
            </>
          )}

          {tab === 'privacy' && (
            <>
              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                1. Account &amp; Workspace Data
              </h3>
              <p>
                When you sign in with Google via Firebase Authentication, we store your account identifier, email address, display name, subscription entitlement status, and your saved terminal workspace (watchlists, portfolio holdings, price alerts, trade journal entries, and financial plan inputs) in an isolated, encrypted PostgreSQL database scoped strictly to your account.
              </p>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                2. Payment Processing &amp; Brokerage Imports
              </h3>
              <p>
                Payment card details are processed exclusively by Stripe and never touch or reside on our application servers. Brokerage CSV files imported into Portfolio Analytics are parsed locally inside your browser before saving your resulting holdings positions to your private workspace.
              </p>

              <h3 className="text-sm font-semibold text-[#012169] dark:text-white">
                3. Data Ownership &amp; Deletion
              </h3>
              <p>
                We never sell your portfolio holdings, watchlists, or trade journal records to third parties. You may export your data to CSV or PDF at any time and request full account deletion by contacting support.
              </p>
            </>
          )}
        </div>

        {/* Footer Acceptance Bar */}
        <div className="px-6 py-3.5 border-t border-[#D6E2F0] dark:border-slate-800 bg-[#F8FAFD] dark:bg-[#111724] flex flex-wrap items-center justify-between gap-3 shrink-0">
          {acceptedLabel ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>Terms &amp; disclosures acknowledged on {acceptedLabel}</span>
            </div>
          ) : (
            <div className="text-xs text-[#5A7190] dark:text-slate-400">
              Acknowledge these disclosures to record compliance for your account.
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-[#C6D6EA] dark:border-slate-700 text-[#334E73] dark:text-slate-300 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleAccept}
              className="px-4 py-1.5 rounded-md text-xs font-semibold bg-[#012169] hover:bg-[#0052C2] text-white disabled:opacity-50 transition-colors"
            >
              {saving
                ? 'Saving...'
                : acceptedLabel
                ? 'Re-Confirm Terms'
                : 'Accept Terms & Disclosures'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
