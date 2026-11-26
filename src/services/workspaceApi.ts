import type {
  CustomWatchlist,
  FinancialPlanInputs,
  PortfolioHolding,
  PriceAlert,
  TradeJournalEntry,
} from '../types/market';

export interface CloudWorkspacePayload {
  hasSavedData: boolean;
  holdings: PortfolioHolding[] | null;
  alerts: PriceAlert[] | null;
  journal: TradeJournalEntry[] | null;
  plan: FinancialPlanInputs | null;
  favorites: string[] | null;
  watchlistOrder: string[] | null;
  watchlists: CustomWatchlist[] | null;
}

function authHeaders(idToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchCloudWorkspace(
  idToken: string
): Promise<CloudWorkspacePayload> {
  const res = await fetch('/api/workspace', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to load saved workspace.');
  }
  return (await res.json()) as CloudWorkspacePayload;
}

export async function saveCloudHoldings(
  idToken: string,
  holdings: PortfolioHolding[]
): Promise<void> {
  const res = await fetch('/api/workspace/holdings', {
    method: 'PUT',
    headers: authHeaders(idToken),
    body: JSON.stringify({ holdings }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to save portfolio holdings.');
  }
}

export async function saveCloudAlerts(
  idToken: string,
  alerts: PriceAlert[]
): Promise<void> {
  const res = await fetch('/api/workspace/alerts', {
    method: 'PUT',
    headers: authHeaders(idToken),
    body: JSON.stringify({ alerts }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to save price alerts.');
  }
}

export async function saveCloudJournal(
  idToken: string,
  entries: TradeJournalEntry[]
): Promise<void> {
  const res = await fetch('/api/workspace/journal', {
    method: 'PUT',
    headers: authHeaders(idToken),
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to save trade journal.');
  }
}

export async function saveCloudFinancialPlan(
  idToken: string,
  plan: FinancialPlanInputs
): Promise<void> {
  const res = await fetch('/api/workspace/plan', {
    method: 'PUT',
    headers: authHeaders(idToken),
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to save financial plan.');
  }
}

export async function saveCloudPreferences(
  idToken: string,
  favorites: string[],
  watchlistOrder: string[],
  watchlists: CustomWatchlist[]
): Promise<void> {
  const res = await fetch('/api/workspace/preferences', {
    method: 'PUT',
    headers: authHeaders(idToken),
    body: JSON.stringify({ favorites, watchlistOrder, watchlists }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || 'Unable to save watchlist preferences.');
  }
}
