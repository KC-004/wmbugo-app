import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Owned by the ledger module (AD-3). Created by migration 0004 (Story 1.12). The `transaction` table is
 * created complete (docs/decisions/S2-initial-schema.md section 4.2) so later stories never rewrite it.
 * Signs (AD-5): a posting is positive into an account and negative out of it, for every account type.
 */
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    icon: text('icon').notNull(),
    color_token: text('color_token').notNull(),
    credit_limit_minor: integer('credit_limit_minor'),
    statement_due_minor: integer('statement_due_minor'),
    statement_due_date: text('statement_due_date'),
    // When the statement details were last entered; payments after it count toward "Statement paid".
    statement_set_at: integer('statement_set_at'),
    // Convenience copy of the opening posting (the posting is the source of truth, AD-5); null when not set.
    opening_minor: integer('opening_minor'),
    opening_effective_at: integer('opening_effective_at'),
    balance_not_set: integer('balance_not_set').notNull().default(0),
    include_in_overview: integer('include_in_overview').notNull().default(1),
    sort_order: integer('sort_order').notNull(),
    status: text('status').notNull().default('active'),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
  },
  (t) => [
    index('account_status_order_idx').on(t.status, t.sort_order),
    check('account_type_check', sql`${t.type} IN ('cash','bank','wallet','savings_pot','card')`),
    check('account_status_check', sql`${t.status} IN ('active','archived')`),
    check('account_flags_check', sql`${t.balance_not_set} IN (0,1) AND ${t.include_in_overview} IN (0,1)`),
    check('account_credit_limit_check', sql`${t.credit_limit_minor} IS NULL OR ${t.credit_limit_minor} >= 0`),
    check('account_balance_known_check', sql`${t.balance_not_set} = 1 OR ${t.opening_minor} IS NOT NULL`),
  ],
);

export const transaction = sqliteTable(
  'transaction',
  {
    id: text('id').primaryKey(),
    event_type: text('event_type').notNull(),
    status: text('status').notNull(),
    amount_minor: integer('amount_minor').notNull(),
    occurred_at_utc: integer('occurred_at_utc').notNull(),
    local_date: text('local_date').notNull(),
    timezone_id: text('timezone_id').notNull(),
    merchant_id: text('merchant_id'),
    payee_id: text('payee_id'),
    refund_of_transaction_id: text('refund_of_transaction_id'),
    recurring_rule_id: text('recurring_rule_id'),
    original_description: text('original_description'),
    note: text('note'),
    reference: text('reference'),
    payment_method: text('payment_method'),
    tags_json: text('tags_json').notNull().default('[]'),
    capture_resolution: text('capture_resolution'),
    needs_category: integer('needs_category').notNull().default(0),
    foreign_amount_minor: integer('foreign_amount_minor'),
    foreign_currency: text('foreign_currency'),
    foreign_currency_exponent: integer('foreign_currency_exponent'),
    removed_at: integer('removed_at'),
    removal_kind: text('removal_kind'),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
    reversed_by_id: text('reversed_by_id'),
  },
  (t) => [
    index('transaction_date_idx').on(t.local_date, t.id),
    index('transaction_status_date_idx').on(t.status, t.local_date),
    index('transaction_removed_idx').on(t.removed_at),
    index('transaction_merchant_idx').on(t.merchant_id),
    index('transaction_refund_idx').on(t.refund_of_transaction_id),
    index('transaction_recurring_idx').on(t.recurring_rule_id),
    check(
      'transaction_event_type_check',
      sql`${t.event_type} IN ('expense','income','transfer','opening_balance','adjustment','refund','reversal')`,
    ),
    check('transaction_status_check', sql`${t.status} IN ('needs_review','confirmed')`),
    check('transaction_amount_check', sql`${t.amount_minor} >= 0`),
    check('transaction_local_date_check', sql`length(${t.local_date}) = 10`),
    check('transaction_removal_check', sql`(${t.removed_at} IS NULL) = (${t.removal_kind} IS NULL)`),
    check(
      'transaction_foreign_check',
      sql`(${t.foreign_amount_minor} IS NULL) = (${t.foreign_currency} IS NULL) AND (${t.foreign_currency} IS NULL) = (${t.foreign_currency_exponent} IS NULL)`,
    ),
  ],
);

export const posting = sqliteTable(
  'posting',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transaction.id),
    account_id: text('account_id')
      .notNull()
      .references(() => account.id),
    direction: text('direction').notNull(),
    signed_amount_minor: integer('signed_amount_minor').notNull(),
    posting_kind: text('posting_kind').notNull().default('normal'),
  },
  (t) => [
    index('posting_account_tx_idx').on(t.account_id, t.transaction_id),
    index('posting_tx_idx').on(t.transaction_id),
    check('posting_direction_check', sql`${t.direction} IN ('in','out')`),
    check('posting_kind_check', sql`${t.posting_kind} IN ('normal','opening_balance','adjustment')`),
    // The direction must agree with the sign: into an account is positive, out of it is negative.
    check(
      'posting_sign_check',
      sql`(${t.direction} = 'in' AND ${t.signed_amount_minor} >= 0) OR (${t.direction} = 'out' AND ${t.signed_amount_minor} <= 0)`,
    ),
  ],
);

/** Created by migration 0004 (journal index 4, Story 1.13) with the seeded categories (CAT-001, CAT-006). */
export const category = sqliteTable(
  'category',
  {
    id: text('id').primaryKey(),
    parent_id: text('parent_id').references((): AnySQLiteColumn => category.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    budget_type: text('budget_type'),
    icon: text('icon').notNull(),
    color_token: text('color_token').notNull(),
    sort_order: integer('sort_order').notNull(),
    archived: integer('archived').notNull().default(0),
  },
  (t) => [
    index('category_parent_order_idx').on(t.parent_id, t.sort_order),
    check('category_kind_check', sql`${t.kind} IN ('expense','income')`),
    check('category_budget_type_check', sql`${t.budget_type} IS NULL OR ${t.budget_type} IN ('need','want')`),
    check('category_archived_check', sql`${t.archived} IN (0,1)`),
  ],
);

export const split = sqliteTable(
  'split',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transaction.id),
    category_id: text('category_id')
      .notNull()
      .references(() => category.id),
    amount_minor: integer('amount_minor').notNull(),
    memo: text('memo'),
  },
  (t) => [
    index('split_category_tx_idx').on(t.category_id, t.transaction_id),
    index('split_tx_idx').on(t.transaction_id),
    check('split_amount_check', sql`${t.amount_minor} >= 0`),
  ],
);
