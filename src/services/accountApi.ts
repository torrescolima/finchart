import type { AccountProfile, PlanTier } from '../types/market';

async function authFetch<T>(
  url: string,
  idToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(options.headers ?? {}),
    },
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

export function fetchAccountProfile(idToken: string): Promise<AccountProfile> {
  return authFetch<AccountProfile>('/api/account/profile', idToken, {
    method: 'GET',
  });
}

export function acceptAccountTerms(
  idToken: string
): Promise<{ termsAcceptedAt: string }> {
  return authFetch<{ termsAcceptedAt: string }>('/api/account/accept-terms', idToken, {
    method: 'POST',
    body: JSON.stringify({ accepted: true }),
  });
}

export function createBillingCheckout(
  idToken: string,
  tier: Exclude<PlanTier, 'free'>
): Promise<{ url: string }> {
  return authFetch<{ url: string }>('/api/billing/checkout', idToken, {
    method: 'POST',
    body: JSON.stringify({ tier }),
  });
}

export function createBillingPortal(idToken: string): Promise<{ url: string }> {
  return authFetch<{ url: string }>('/api/billing/portal', idToken, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function confirmBillingSession(
  idToken: string,
  sessionId: string
): Promise<{
  planTier: PlanTier;
  subscriptionStatus: AccountProfile['subscriptionStatus'];
  currentPeriodEnd: number | null;
}> {
  return authFetch('/api/billing/confirm', idToken, {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}
