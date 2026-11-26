import {
  Bell,
  Briefcase,
  ChevronDown,
  CreditCard,
  Download,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Printer,
  Search,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PlanTier, WorkspaceTab } from '../types/market';

interface TopBarUser {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportCsv: () => void;
  onPrintReport: () => void;
  onOpenCommandPalette: () => void;
  onOpenMobileWatchlist: () => void;
  onOpenPlans: () => void;
  onOpenLegal: () => void;
  planTier: PlanTier;
  user: TopBarUser | null;
  authBusy: boolean;
  activeAlertsCount: number;
  isDark: boolean;
  onToggleTheme: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'chart', label: 'Charting' },
  { id: 'screener', label: 'Screener' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'dcf', label: 'Valuation' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'planner', label: 'Planner' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onExportCsv,
  onPrintReport,
  onOpenCommandPalette,
  onOpenMobileWatchlist,
  onOpenPlans,
  onOpenLegal,
  planTier,
  user,
  authBusy,
  activeAlertsCount,
  isDark,
  onToggleTheme,
  onSignIn,
  onSignOut,
}: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const userLabel =
    user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'Account';

  return (
    <header className="h-14 shrink-0 border-b border-[#00184D] dark:border-slate-800 bg-[#012169] dark:bg-[#0A162E] px-4 lg:px-6 flex items-center justify-between gap-6 text-white">
      {/* Zone 1: Single-line Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => onSelectTab('chart')}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded-sm"
        >
          Meridian
        </button>
      </div>

      {/* Zone 2: Clean Single-Line Navigation Links */}
      <nav aria-label="Workspace views" className="flex items-center gap-4 md:gap-6 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                isActive ? 'text-white' : 'text-blue-200/85 hover:text-white'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white dark:bg-blue-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Quick Search (Cmd+K), Report/Export Menu & Account Menu */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Quick Command Palette (Cmd/Ctrl + K)"
          aria-label="Open command palette"
          className="inline-flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/20 bg-white/5 hover:bg-white/15 text-blue-100 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden xl:inline text-blue-200/90">Search</span>
          <span className="hidden md:inline font-mono text-[10px] text-blue-200/80">⌘K</span>
        </button>

        {/* Export / PDF Report Menu */}
        <div ref={exportRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setExportOpen((v) => !v);
              setAccountOpen(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-white hover:bg-[#EAF2FD] text-[#012169] dark:bg-[#0052C2] dark:hover:bg-blue-600 dark:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
            <ChevronDown className="w-3 h-3 opacity-75" />
          </button>

          {exportOpen && (
            <div className="absolute right-0 mt-1.5 w-52 rounded-md bg-white dark:bg-[#0E131D] border border-[#C6D6EA] dark:border-slate-700 shadow-xl py-1 z-40 text-[#0A1F44] dark:text-slate-100">
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onPrintReport();
                }}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
              >
                <Printer className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                <span>Print / PDF Tear Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExportCsv();
                }}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                <span>Download CSV Data</span>
              </button>
            </div>
          )}
        </div>

        {/* Account Menu or Sign In */}
        {user ? (
          <div ref={accountRef} className="relative pl-1.5 border-l border-white/20">
            <button
              type="button"
              onClick={() => {
                setAccountOpen((v) => !v);
                setExportOpen(false);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/25 text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <span className="max-w-[96px] truncate">{userLabel}</span>
              <ChevronDown className="w-3 h-3 opacity-80" />
            </button>

            {accountOpen && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-md bg-white dark:bg-[#0E131D] border border-[#C6D6EA] dark:border-slate-700 shadow-xl py-1 z-40 text-[#0A1F44] dark:text-slate-100">
                <div className="px-3 py-2 border-b border-[#EEF3FA] dark:border-slate-800">
                  <div className="text-xs font-semibold text-[#012169] dark:text-white truncate">
                    {user.displayName || userLabel}
                  </div>
                  {user.email && (
                    <div className="text-[11px] text-[#5A7190] dark:text-slate-400 truncate">
                      {user.email}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onSelectTab('portfolio');
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                >
                  <Briefcase className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                  <span>Portfolio &amp; Trade Journal</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onSelectTab('chart');
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                    <span>Price Alerts</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#5A7190] dark:text-slate-400">
                    {activeAlertsCount} active
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onOpenPlans();
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                    <span>Plans &amp; Billing</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#0052C2] dark:text-blue-400">
                    {planTier === 'advisor'
                      ? 'Advisor'
                      : planTier === 'pro'
                      ? 'Pro'
                      : 'Free'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onOpenLegal();
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                  <span>Terms &amp; Disclosures</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    onToggleTheme();
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[#EAF2FD] dark:hover:bg-slate-800"
                >
                  {isDark ? (
                    <Sun className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-[#0052C2] dark:text-blue-400" />
                  )}
                  <span>{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                </button>

                <div className="my-1 border-t border-[#EEF3FA] dark:border-slate-800" />

                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    setAccountOpen(false);
                    onSignOut();
                  }}
                  className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignIn}
            disabled={authBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-white/25 text-white hover:bg-white/10 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenMobileWatchlist}
          aria-label="Open watchlist"
          className="lg:hidden p-2 rounded-md text-blue-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
