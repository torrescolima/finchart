import crypto from 'crypto';
import type { PlanTier, SubscriptionStatus } from '../types/market.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export interface ResolvedStripeCatalog {
  mode: 'live' | 'test' | 'unknown';
  proPriceId: string | null;
  advisorPriceId: string | null;
  introCouponId: string | null;
  webhookUrl: string | null;
  webhookConfigured: boolean;
}

let cachedCatalog: ResolvedStripeCatalog | null = null;
let catalogInitPromise: Promise<ResolvedStripeCatalog | null> | null = null;

function getSecretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key || null;
}

export function isValidStripePriceId(val?: string | null): val is string {
  return Boolean(val && /^price_[A-Za-z0-9_]+$/.test(val.trim()));
}

export function isValidStripeCouponId(val?: string | null): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (/^(sk|rk|pk|whsec)_/i.test(trimmed)) return false;
  return /^[A-Za-z0-9_-]{3,64}$/.test(trimmed);
}

function getEnvPriceId(tier: Exclude<PlanTier, 'free'>): string | null {
  const raw =
    tier === 'pro'
      ? process.env.STRIPE_PRICE_PRO?.trim()
      : process.env.STRIPE_PRICE_ADVISOR?.trim();
  return isValidStripePriceId(raw) ? raw : null;
}

function getEnvIntroCouponId(): string | null {
  const raw = process.env.STRIPE_PRO_INTRO_COUPON?.trim();
  return isValidStripeCouponId(raw) ? raw : null;
}

export function getStripeMode(): 'live' | 'test' | 'unknown' | 'unconfigured' {
  const key = getSecretKey();
  if (!key) return 'unconfigured';
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return 'unknown';
}

export function isStripeConfigured(): boolean {
  const key = getSecretKey();
  if (!key) return false;
  return Boolean(
    getStripePriceIdForTier('pro') || getStripePriceIdForTier('advisor')
  );
}

export function getStripePriceIdForTier(tier: Exclude<PlanTier, 'free'>): string | null {
  const envId = getEnvPriceId(tier);
  if (envId) return envId;
  if (tier === 'pro') {
    return isValidStripePriceId(cachedCatalog?.proPriceId) ? cachedCatalog!.proPriceId : null;
  }
  if (tier === 'advisor') {
    return isValidStripePriceId(cachedCatalog?.advisorPriceId)
      ? cachedCatalog!.advisorPriceId
      : null;
  }
  return null;
}

export function getProIntroCouponId(): string | null {
  const envId = getEnvIntroCouponId();
  if (envId) return envId;
  return isValidStripeCouponId(cachedCatalog?.introCouponId)
    ? cachedCatalog!.introCouponId
    : null;
}

export function resolvePlanTierFromPriceId(priceId?: string | null): PlanTier {
  if (!priceId) return 'free';
  const advisorId = getStripePriceIdForTier('advisor');
  const proId = getStripePriceIdForTier('pro');
  if (advisorId && priceId === advisorId) return 'advisor';
  if (proId && priceId === proId) return 'pro';
  return 'pro';
}

export function normalizeStripeStatus(raw?: string | null): SubscriptionStatus {
  switch (raw) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'none';
  }
}

export function sanitizeRedirectBaseUrl(candidateOrigin?: string | null): string | null {
  const candidates = [process.env.APP_URL?.trim(), candidateOrigin?.trim()].filter(
    (v): v is string => Boolean(v)
  );
  for (const raw of candidates) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.origin;
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

async function stripeGet<T>(endpoint: string): Promise<T> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured.');
  }

  const response = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    const msg = data?.error?.message || `Stripe request failed (${response.status}).`;
    throw new Error(msg);
  }
  return data;
}

async function stripeRequest<T>(
  endpoint: string,
  formParams: Record<string, string>
): Promise<T> {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error('Stripe secret key is not configured.');
  }

  const body = new URLSearchParams(formParams);
  const response = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    const msg = data?.error?.message || `Stripe request failed (${response.status}).`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Idempotently resolves or provisions the Meridian Terminal Stripe catalog:
 *   - Pro Trader ($12/mo recurring)
 *   - Advisor & Institutional ($39/mo recurring)
 *   - Pro First Month $1 Intro Coupon ($11 off once)
 *   - Webhook endpoint pointing to APP_URL/api/billing/webhook (when HTTPS)
 *
 * Explicit env overrides (STRIPE_PRICE_PRO, STRIPE_PRICE_ADVISOR, STRIPE_PRO_INTRO_COUPON)
 * always take precedence when set. Never prints or returns secret keys.
 */
export async function ensureStripeCatalog(): Promise<ResolvedStripeCatalog | null> {
  const secretKey = getSecretKey();
  if (!secretKey) return null;
  if (cachedCatalog) return cachedCatalog;
  if (catalogInitPromise) return catalogInitPromise;

  catalogInitPromise = (async () => {
    try {
      const mode = secretKey.startsWith('sk_live_')
        ? 'live'
        : secretKey.startsWith('sk_test_')
        ? 'test'
        : 'unknown';

      let proPriceId = getEnvPriceId('pro');
      let advisorPriceId = getEnvPriceId('advisor');
      let introCouponId = getEnvIntroCouponId();

      if (!proPriceId || !advisorPriceId) {
        const [productsRes, pricesRes] = await Promise.all([
          stripeGet<{ data?: Array<{ id: string; name: string }> }>('/products?active=true&limit=50'),
          stripeGet<{
            data?: Array<{
              id: string;
              product: string;
              unit_amount: number | null;
              currency: string;
              recurring?: { interval?: string } | null;
            }>;
          }>('/prices?active=true&limit=100'),
        ]);

        const products = productsRes.data ?? [];
        const prices = pricesRes.data ?? [];

        const ensurePlan = async (name: string, description: string, unitAmount: number) => {
          let prod = products.find((p) => p.name === name);
          if (!prod) {
            prod = await stripeRequest<{ id: string; name: string }>('/products', {
              name,
              description,
            });
          }
          let price = prices.find(
            (pr) =>
              pr.product === prod!.id &&
              pr.unit_amount === unitAmount &&
              pr.currency === 'usd' &&
              pr.recurring?.interval === 'month'
          );
          if (!price) {
            price = await stripeRequest<{
              id: string;
              product: string;
              unit_amount: number | null;
              currency: string;
            }>('/prices', {
              product: prod.id,
              unit_amount: String(unitAmount),
              currency: 'usd',
              'recurring[interval]': 'month',
              nickname: `${name} Monthly`,
            });
          }
          return price.id;
        };

        if (!proPriceId) {
          proPriceId = await ensurePlan(
            'Meridian Terminal — Pro Trader',
            'Multi-chart split layouts (2x & 4x), unlimited alerts & journal entries, risk correlation matrix & stress tests.',
            1200
          );
        }

        if (!advisorPriceId) {
          advisorPriceId = await ensurePlan(
            'Meridian Terminal — Advisor & Institutional',
            'Everything in Pro Trader plus branded PDF Equity Tear Sheets, wealth plan PDF reports, and brokerage CSV imports.',
            3900
          );
        }
      }

      if (!introCouponId) {
        const couponsRes = await stripeGet<{
          data?: Array<{
            id: string;
            valid: boolean;
            amount_off: number | null;
            currency: string | null;
            duration: string;
          }>;
        }>('/coupons?limit=50');

        let coupon = (couponsRes.data ?? []).find(
          (c) =>
            c.valid &&
            c.amount_off === 1100 &&
            c.currency === 'usd' &&
            c.duration === 'once'
        );
        if (!coupon) {
          coupon = await stripeRequest<{
            id: string;
            valid: boolean;
            amount_off: number | null;
            currency: string | null;
            duration: string;
          }>('/coupons', {
            name: 'Pro First Month ($1 Intro)',
            amount_off: '1100',
            currency: 'usd',
            duration: 'once',
          });
        }
        introCouponId = coupon.id;
      }

      // Auto-register webhook endpoint when hosted on public HTTPS APP_URL (never log signing secret)
      let webhookUrl: string | null = null;
      const appOrigin = sanitizeRedirectBaseUrl(process.env.APP_URL);
      if (appOrigin && appOrigin.startsWith('https://')) {
        const targetUrl = `${appOrigin}/api/billing/webhook`;
        try {
          const hooksRes = await stripeGet<{
            data?: Array<{ id: string; url: string }>;
          }>('/webhook_endpoints?limit=50');
          const existingHook = (hooksRes.data ?? []).find((h) => h.url === targetUrl);
          if (!existingHook) {
            await stripeRequest<{ id: string; url: string }>('/webhook_endpoints', {
              url: targetUrl,
              'enabled_events[0]': 'checkout.session.completed',
              'enabled_events[1]': 'customer.subscription.created',
              'enabled_events[2]': 'customer.subscription.updated',
              'enabled_events[3]': 'customer.subscription.deleted',
              description: 'Meridian Terminal Subscription Sync',
            });
          }
          webhookUrl = targetUrl;
        } catch (hookErr) {
          console.warn('Stripe webhook endpoint auto-registration skipped:', hookErr);
        }
      }

      cachedCatalog = {
        mode,
        proPriceId,
        advisorPriceId,
        introCouponId,
        webhookUrl,
        webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
      };
      return cachedCatalog;
    } catch (error) {
      console.error('Failed to auto-provision Stripe catalog:', error);
      return null;
    } finally {
      catalogInitPromise = null;
    }
  })();

  return catalogInitPromise;
}

export async function createStripeCustomer(params: {
  uid: string;
  email: string;
  displayName?: string | null;
}): Promise<{ id: string }> {
  const payload: Record<string, string> = {
    email: params.email,
    'metadata[user_uid]': params.uid,
  };
  if (params.displayName) {
    payload.name = params.displayName;
  }
  return stripeRequest<{ id: string }>('/customers', payload);
}

export async function createStripeCheckoutSession(params: {
  customerId: string;
  priceId: string;
  uid: string;
  tier: Exclude<PlanTier, 'free'>;
  successUrl: string;
  cancelUrl: string;
  introCouponId?: string | null;
}): Promise<{ id: string; url: string }> {
  const payload: Record<string, string> = {
    mode: 'subscription',
    customer: params.customerId,
    client_reference_id: params.uid,
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    'metadata[user_uid]': params.uid,
    'metadata[plan_tier]': params.tier,
    'subscription_data[metadata][user_uid]': params.uid,
    'subscription_data[metadata][plan_tier]': params.tier,
  };

  if (params.introCouponId) {
    payload['discounts[0][coupon]'] = params.introCouponId;
  } else {
    payload.allow_promotion_codes = 'true';
  }

  return stripeRequest<{ id: string; url: string }>('/checkout/sessions', payload);
}

export interface StripeCheckoutSessionDetail {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  customer?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
  subscription?:
    | string
    | {
        id?: string;
        status?: string;
        current_period_end?: number;
        metadata?: Record<string, string>;
        items?: { data?: Array<{ price?: { id?: string } }> };
      }
    | null;
}

export async function retrieveStripeCheckoutSession(
  sessionId: string
): Promise<StripeCheckoutSessionDetail> {
  const cleaned = sessionId.trim();
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]{8,128}$/.test(cleaned)) {
    throw new Error('Invalid checkout session identifier.');
  }
  return stripeGet<StripeCheckoutSessionDetail>(
    `/checkout/sessions/${encodeURIComponent(cleaned)}?expand[]=subscription`
  );
}

export async function createStripeBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>('/billing_portal/sessions', {
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

/**
 * Verifies a Stripe webhook payload using HMAC-SHA256 and constant-time comparison,
 * enforcing a 5-minute replay window on the signature timestamp.
 */
export function verifyStripeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string,
  toleranceSeconds = 300
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  let timestamp = '';
  const signatures: string[] = [];

  for (const part of signatureHeader.split(',')) {
    const [k, v] = part.split('=');
    const key = k?.trim();
    const val = v?.trim();
    if (!key || !val) continue;
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  }

  if (!timestamp || signatures.length === 0) return false;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expectedHex = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');

  for (const candidateHex of signatures) {
    if (!/^[a-f0-9]+$/i.test(candidateHex)) continue;
    const candidateBuf = Buffer.from(candidateHex, 'hex');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return true;
    }
  }

  return false;
}
