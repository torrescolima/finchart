import { Download, Menu } from 'lucide-react';
import { WorkspaceTab } from '../types/market';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onExportCsv: () => void;
  onOpenMobileWatchlist: () => void;
}

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'chart', label: 'Charting' },
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'dcf', label: 'Valuation & DCF' },
  { id: 'planner', label: 'Financial Planner' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onExportCsv,
  onOpenMobileWatchlist,
}: TopBarProps) {
  return (
    <header className="h-14 shrink-0 border-b border-[#00184D] dark:border-slate-800 bg-[#012169] dark:bg-[#0A162E] px-4 lg:px-6 flex items-center justify-between gap-8 text-white">
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

      {/* Zone 2: 4 Clean Single-Line Navigation Links */}
      <nav aria-label="Workspace views" className="flex items-center gap-5 md:gap-7 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
                isActive
                  ? 'text-white'
                  : 'text-blue-200/85 hover:text-white'
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

      {/* Zone 3: 1 Primary Action (+ mobile watchlist drawer button on narrow screens) */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onExportCsv}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-white hover:bg-[#EAF2FD] text-[#012169] dark:bg-[#0052C2] dark:hover:bg-blue-600 dark:text-white transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
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
