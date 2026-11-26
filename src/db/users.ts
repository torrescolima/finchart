import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';
import type { PlanTier, SubscriptionStatus } from '../types/market.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName: string | null = null
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Failed to upsert user record:', error);
    throw new Error('Unable to synchronize user account.', { cause: error });
  }
}

export async function getUserProfile(uid: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to load user profile:', error);
    throw new Error('Unable to load account profile.', { cause: error });
  }
}

export async function acceptUserTerms(uid: string) {
  try {
    const now = new Date();
    const rows = await db
      .update(users)
      .set({
        termsAcceptedAt: now,
        updatedAt: now,
      })
      .where(eq(users.uid, uid))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to record terms acceptance:', error);
    throw new Error('Unable to record terms acceptance.', { cause: error });
  }
}

export async function setUserStripeCustomerId(uid: string, stripeCustomerId: string) {
  try {
    const rows = await db
      .update(users)
      .set({
        stripeCustomerId,
        updatedAt: new Date(),
      })
      .where(eq(users.uid, uid))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to store Stripe customer identifier:', error);
    throw new Error('Unable to link billing customer.', { cause: error });
  }
}

export async function syncUserSubscription(params: {
  uid?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planTier?: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd?: number | null;
}) {
  try {
    const updates: Partial<typeof users.$inferInsert> = {
      subscriptionStatus: params.subscriptionStatus,
      updatedAt: new Date(),
    };

    if (params.planTier) {
      updates.planTier = params.planTier;
    }
    if (params.stripeCustomerId) {
      updates.stripeCustomerId = params.stripeCustomerId;
    }
    if (params.stripeSubscriptionId !== undefined) {
      updates.stripeSubscriptionId = params.stripeSubscriptionId;
    }
    if (params.currentPeriodEnd !== undefined) {
      updates.currentPeriodEnd = params.currentPeriodEnd;
    }

    if (params.uid) {
      const updated = await db
        .update(users)
        .set(updates)
        .where(eq(users.uid, params.uid))
        .returning();
      if (updated.length > 0) return updated[0];
    }

    if (params.stripeCustomerId) {
      const updated = await db
        .update(users)
        .set(updates)
        .where(eq(users.stripeCustomerId, params.stripeCustomerId))
        .returning();
      return updated[0] ?? null;
    }

    return null;
  } catch (error) {
    console.error('Failed to synchronize user subscription:', error);
    throw new Error('Unable to update subscription entitlement.', { cause: error });
  }
}

