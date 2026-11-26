import { relations } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  CustomWatchlist,
  FinancialPlanInputs,
} from '../types/market.ts';

export const users = pgTable('users', {
  uid: text('uid').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  planTier: text('plan_tier').notNull().default('free'),
  subscriptionStatus: text('subscription_status').notNull().default('none'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  currentPeriodEnd: bigint('current_period_end', { mode: 'number' }),
  termsAcceptedAt: timestamp('terms_accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const portfolioHoldings = pgTable(
  'portfolio_holdings',
  {
    id: text('id').notNull(),
    userUid: text('user_uid')
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    shares: doublePrecision('shares').notNull(),
    avgCost: doublePrecision('avg_cost').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userUid, table.id] })]
);

export const priceAlerts = pgTable(
  'price_alerts',
  {
    id: text('id').notNull(),
    userUid: text('user_uid')
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    condition: text('condition').notNull(), // 'above' | 'below'
    targetPrice: doublePrecision('target_price').notNull(),
    note: text('note').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    triggeredAt: bigint('triggered_at', { mode: 'number' }),
  },
  (table) => [primaryKey({ columns: [table.userUid, table.id] })]
);

export const tradeJournal = pgTable(
  'trade_journal',
  {
    id: text('id').notNull(),
    userUid: text('user_uid')
      .notNull()
      .references(() => users.uid, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    side: text('side').notNull(), // 'LONG' | 'SHORT'
    entryDate: text('entry_date').notNull(),
    exitDate: text('exit_date').notNull().default(''),
    entryPrice: doublePrecision('entry_price').notNull(),
    exitPrice: doublePrecision('exit_price'),
    shares: doublePrecision('shares').notNull(),
    setupTag: text('setup_tag').notNull().default('General'),
    notes: text('notes').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userUid, table.id] })]
);

export const financialPlans = pgTable('financial_plans', {
  userUid: text('user_uid')
    .primaryKey()
    .references(() => users.uid, { onDelete: 'cascade' }),
  planJson: jsonb('plan_json').$type<FinancialPlanInputs>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userPreferences = pgTable('user_preferences', {
  userUid: text('user_uid')
    .primaryKey()
    .references(() => users.uid, { onDelete: 'cascade' }),
  favoritesJson: jsonb('favorites_json').$type<string[]>().notNull(),
  watchlistOrderJson: jsonb('watchlist_order_json').$type<string[]>().notNull(),
  watchlistsJson: jsonb('watchlists_json').$type<CustomWatchlist[]>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  holdings: many(portfolioHoldings),
  alerts: many(priceAlerts),
  journalEntries: many(tradeJournal),
  financialPlan: one(financialPlans, {
    fields: [users.uid],
    references: [financialPlans.userUid],
  }),
  preferences: one(userPreferences, {
    fields: [users.uid],
    references: [userPreferences.userUid],
  }),
}));

export const portfolioHoldingsRelations = relations(portfolioHoldings, ({ one }) => ({
  user: one(users, {
    fields: [portfolioHoldings.userUid],
    references: [users.uid],
  }),
}));

export const priceAlertsRelations = relations(priceAlerts, ({ one }) => ({
  user: one(users, {
    fields: [priceAlerts.userUid],
    references: [users.uid],
  }),
}));

export const tradeJournalRelations = relations(tradeJournal, ({ one }) => ({
  user: one(users, {
    fields: [tradeJournal.userUid],
    references: [users.uid],
  }),
}));

export const financialPlansRelations = relations(financialPlans, ({ one }) => ({
  user: one(users, {
    fields: [financialPlans.userUid],
    references: [users.uid],
  }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userPreferences.userUid],
    references: [users.uid],
  }),
}));
