import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  financialPlans,
  portfolioHoldings,
  priceAlerts,
  tradeJournal,
  userPreferences,
} from './schema.ts';
import type {
  CustomWatchlist,
  FinancialPlanInputs,
  PortfolioHolding,
  PriceAlert,
  TradeJournalEntry,
} from '../types/market.ts';

export interface UserWorkspaceRecord {
  hasSavedData: boolean;
  holdings: PortfolioHolding[] | null;
  alerts: PriceAlert[] | null;
  journal: TradeJournalEntry[] | null;
  plan: FinancialPlanInputs | null;
  favorites: string[] | null;
  watchlistOrder: string[] | null;
  watchlists: CustomWatchlist[] | null;
}

export async function getUserWorkspace(userUid: string): Promise<UserWorkspaceRecord> {
  try {
    const [holdingRows, alertRows, journalRows, planRows, prefRows] = await Promise.all([
      db
        .select()
        .from(portfolioHoldings)
        .where(eq(portfolioHoldings.userUid, userUid)),
      db
        .select()
        .from(priceAlerts)
        .where(eq(priceAlerts.userUid, userUid))
        .orderBy(desc(priceAlerts.createdAt)),
      db
        .select()
        .from(tradeJournal)
        .where(eq(tradeJournal.userUid, userUid))
        .orderBy(desc(tradeJournal.createdAt)),
      db
        .select()
        .from(financialPlans)
        .where(eq(financialPlans.userUid, userUid))
        .limit(1),
      db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userUid, userUid))
        .limit(1),
    ]);

    const planRow = planRows[0] ?? null;
    const prefRow = prefRows[0] ?? null;
    const hasSavedData =
      holdingRows.length > 0 ||
      alertRows.length > 0 ||
      journalRows.length > 0 ||
      planRow !== null ||
      prefRow !== null;

    return {
      hasSavedData,
      holdings: hasSavedData
        ? holdingRows.map((row) => ({
            id: row.id,
            symbol: row.symbol,
            shares: row.shares,
            avgCost: row.avgCost,
          }))
        : null,
      alerts: hasSavedData
        ? alertRows.map((row) => ({
            id: row.id,
            symbol: row.symbol,
            condition: row.condition === 'below' ? 'below' : 'above',
            targetPrice: row.targetPrice,
            note: row.note,
            createdAt: row.createdAt,
            triggeredAt: row.triggeredAt ?? null,
          }))
        : null,
      journal: hasSavedData
        ? journalRows.map((row) => ({
            id: row.id,
            symbol: row.symbol,
            side: row.side === 'SHORT' ? 'SHORT' : 'LONG',
            entryDate: row.entryDate,
            exitDate: row.exitDate,
            entryPrice: row.entryPrice,
            exitPrice: row.exitPrice ?? null,
            shares: row.shares,
            setupTag: row.setupTag,
            notes: row.notes,
            createdAt: row.createdAt,
          }))
        : null,
      plan: planRow ? planRow.planJson : null,
      favorites: prefRow ? prefRow.favoritesJson : null,
      watchlistOrder: prefRow ? prefRow.watchlistOrderJson : null,
      watchlists: prefRow?.watchlistsJson ?? null,
    };
  } catch (error) {
    console.error('Failed to fetch user workspace:', error);
    throw new Error('Unable to load saved workspace data.', { cause: error });
  }
}

export async function replaceUserHoldings(
  userUid: string,
  holdings: PortfolioHolding[]
): Promise<PortfolioHolding[]> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(portfolioHoldings)
        .where(eq(portfolioHoldings.userUid, userUid));

      if (holdings.length > 0) {
        const now = new Date();
        await tx.insert(portfolioHoldings).values(
          holdings.map((h) => ({
            id: h.id,
            userUid,
            symbol: h.symbol,
            shares: h.shares,
            avgCost: h.avgCost,
            updatedAt: now,
          }))
        );
      }
    });

    return holdings;
  } catch (error) {
    console.error('Failed to save portfolio holdings:', error);
    throw new Error('Unable to save portfolio holdings.', { cause: error });
  }
}

export async function replaceUserAlerts(
  userUid: string,
  alerts: PriceAlert[]
): Promise<PriceAlert[]> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(priceAlerts).where(eq(priceAlerts.userUid, userUid));

      if (alerts.length > 0) {
        await tx.insert(priceAlerts).values(
          alerts.map((a) => ({
            id: a.id,
            userUid,
            symbol: a.symbol,
            condition: a.condition,
            targetPrice: a.targetPrice,
            note: a.note,
            createdAt: a.createdAt,
            triggeredAt: a.triggeredAt,
          }))
        );
      }
    });

    return alerts;
  } catch (error) {
    console.error('Failed to save price alerts:', error);
    throw new Error('Unable to save price alerts.', { cause: error });
  }
}

export async function replaceUserJournal(
  userUid: string,
  entries: TradeJournalEntry[]
): Promise<TradeJournalEntry[]> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(tradeJournal).where(eq(tradeJournal.userUid, userUid));

      if (entries.length > 0) {
        await tx.insert(tradeJournal).values(
          entries.map((e) => ({
            id: e.id,
            userUid,
            symbol: e.symbol,
            side: e.side,
            entryDate: e.entryDate,
            exitDate: e.exitDate,
            entryPrice: e.entryPrice,
            exitPrice: e.exitPrice,
            shares: e.shares,
            setupTag: e.setupTag,
            notes: e.notes,
            createdAt: e.createdAt,
          }))
        );
      }
    });

    return entries;
  } catch (error) {
    console.error('Failed to save trade journal:', error);
    throw new Error('Unable to save trade journal.', { cause: error });
  }
}

export async function upsertUserFinancialPlan(
  userUid: string,
  plan: FinancialPlanInputs
): Promise<FinancialPlanInputs> {
  try {
    await db
      .insert(financialPlans)
      .values({
        userUid,
        planJson: plan,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: financialPlans.userUid,
        set: {
          planJson: plan,
          updatedAt: new Date(),
        },
      });

    return plan;
  } catch (error) {
    console.error('Failed to save financial plan:', error);
    throw new Error('Unable to save financial plan.', { cause: error });
  }
}

export async function upsertUserPreferences(
  userUid: string,
  favorites: string[],
  watchlistOrder: string[],
  watchlists: CustomWatchlist[]
): Promise<{
  favorites: string[];
  watchlistOrder: string[];
  watchlists: CustomWatchlist[];
}> {
  try {
    await db
      .insert(userPreferences)
      .values({
        userUid,
        favoritesJson: favorites,
        watchlistOrderJson: watchlistOrder,
        watchlistsJson: watchlists,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userUid,
        set: {
          favoritesJson: favorites,
          watchlistOrderJson: watchlistOrder,
          watchlistsJson: watchlists,
          updatedAt: new Date(),
        },
      });

    return { favorites, watchlistOrder, watchlists };
  } catch (error) {
    console.error('Failed to save user preferences:', error);
    throw new Error('Unable to save watchlist preferences.', { cause: error });
  }
}
