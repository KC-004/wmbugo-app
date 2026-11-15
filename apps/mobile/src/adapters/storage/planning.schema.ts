import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The `planning` module's tables (Story 4.5). Budgets are lasting rules measured over a period; a new period starts at
 * zero and nothing is ever reset. All money columns end in `_minor`. The `ledger` module's tables are never read from
 * here except through the core queries.
 */

export const budget = sqliteTable(
  'budget',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** `overall`, one or more categories, a Need/Want type, or `savings`. */
    scope: text('scope').notNull(),
    /** JSON array of top-level category ids (scope `category`). */
    scope_category_ids: text('scope_category_ids').notNull().default('[]'),
    scope_budget_type: text('scope_budget_type'),
    /** JSON array of account ids; null means every account. */
    account_ids: text('account_ids'),
    /** `default` follows the profile period (pay cycle or calendar month). */
    period_rule: text('period_rule').notNull().default('default'),
    custom_start: text('custom_start'),
    custom_end: text('custom_end'),
    /** `50_30_20` for the one-tap split (Story 4.10); null otherwise. */
    template: text('template'),
    /** The income a 50/30/20 template was made from (Story 4.10), in minor units; null for any other budget. */
    template_income_minor: integer('template_income_minor'),
    /** JSON alert thresholds; null means the default (75%, 90% and 100%). */
    alert_rule: text('alert_rule'),
    muted: integer('muted').notNull().default(0),
    /** The end date of the last period this budget runs: set when its only category is archived or merged (Story 4.3 and 4.6). */
    ended_after: text('ended_after'),
    created_at: integer('created_at').notNull(),
    removed_at: integer('removed_at'),
  },
  (t) => [
    check('budget_scope_check', sql`${t.scope} IN ('overall','category','budget_type','savings')`),
    check('budget_period_rule_check', sql`${t.period_rule} IN ('default','monthly','weekly','custom')`),
    check('budget_type_scope_check', sql`${t.scope_budget_type} IS NULL OR ${t.scope_budget_type} IN ('need','want')`),
    check('budget_custom_range_check', sql`${t.period_rule} <> 'custom' OR (${t.custom_start} IS NOT NULL AND ${t.custom_end} IS NOT NULL AND ${t.custom_start} <= ${t.custom_end})`),
    check('budget_muted_check', sql`${t.muted} IN (0,1)`),
  ],
);

/** The target a budget had from a period start; past periods keep the version they had. */
export const budget_target_version = sqliteTable(
  'budget_target_version',
  {
    budget_id: text('budget_id')
      .notNull()
      .references(() => budget.id),
    version: integer('version').notNull(),
    target_minor: integer('target_minor').notNull(),
    /** The start date of the first period this target applies to. */
    effective_from: text('effective_from').notNull(),
  },
  (t) => [primaryKey({ columns: [t.budget_id, t.version] }), check('budget_target_nonnegative_check', sql`${t.target_minor} >= 0`), index('budget_target_effective_idx').on(t.budget_id, t.effective_from)],
);

/** A cache derived from the period service and the target versions; rebuilt whenever payday or period settings change. */
export const budget_period = sqliteTable(
  'budget_period',
  {
    budget_id: text('budget_id')
      .notNull()
      .references(() => budget.id),
    start_date: text('start_date').notNull(),
    end_date: text('end_date').notNull(),
    target_minor: integer('target_minor').notNull(),
    /** 1 for the cycle shortened by a mid-cycle payday change (Story 4.8). */
    shortened: integer('shortened').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.budget_id, t.start_date] }), check('budget_period_shortened_check', sql`${t.shortened} IN (0,1)`)],
);


/**
 * One row per budget alert level that has been crossed in a period (Story 4.9). The unique key means a level is recorded
 * once per period, so it can fire at most once, even if spending drops and rises again. A muted budget still records its
 * crossings, so turning alerts back on never fires old ones.
 */
export const budget_alert_fired = sqliteTable(
  'budget_alert_fired',
  {
    budget_id: text('budget_id')
      .notNull()
      .references(() => budget.id),
    period_start: text('period_start').notNull(),
    threshold_pct: integer('threshold_pct').notNull(),
    fired_at: integer('fired_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.budget_id, t.period_start, t.threshold_pct] }), check('budget_alert_threshold_check', sql`${t.threshold_pct} > 0`)],
);

/**
 * A bill or subscription the user lists (Story 6.1, REC-001). It is a plan, never a ledger entry: it feeds only Plan's
 * timeline and Free to use. `anchor_date` is the first due date and every later date keeps its day of the month.
 */
export const recurring_rule = sqliteTable(
  'recurring_rule',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    expected_amount_minor: integer('expected_amount_minor').notNull(),
    cadence: text('cadence').notNull(),
    custom_every: integer('custom_every'),
    custom_unit: text('custom_unit'),
    anchor_date: text('anchor_date').notNull(),
    /** Opaque refs into the ledger module. */
    account_id: text('account_id'),
    category_id: text('category_id'),
    kind: text('kind').notNull().default('other'),
    paid_to: text('paid_to'),
    ends_on: text('ends_on'),
    paused_at: integer('paused_at'),
    /** The local date the rule was paused on: no due date from it until it resumes. */
    paused_on: text('paused_on'),
    /** Set on resume: occurrences before this date are never created (missed while paused). */
    resumed_on: text('resumed_on'),
    ended_at: integer('ended_at'),
    /** The local date the rule was ended on: no due date after it. */
    ended_on: text('ended_on'),
    removed_at: integer('removed_at'),
    created_at: integer('created_at').notNull(),
    /** Remind me: days before the due date (0, 1 or 3); null is Off (Story 6.5). */
    remind_days: integer('remind_days'),
  },
  (t) => [
    check('recurring_rule_cadence_check', sql`${t.cadence} IN ('weekly','monthly','quarterly','annual','custom')`),
    check('recurring_rule_kind_check', sql`${t.kind} IN ('subscription','rent','emi','utility','other')`),
    check('recurring_rule_amount_check', sql`${t.expected_amount_minor} > 0`),
    check('recurring_rule_custom_check', sql`(${t.cadence} <> 'custom' AND ${t.custom_every} IS NULL AND ${t.custom_unit} IS NULL) OR (${t.cadence} = 'custom' AND ${t.custom_every} BETWEEN 1 AND 99 AND ${t.custom_unit} IN ('days','weeks','months'))`),
  ],
);

/**
 * That one occurrence of a bill is paid, by a linked entry or marked by the user. The two unique keys make "paid once" a
 * database fact: an occurrence has one payment row, and an entry pays one occurrence.
 */
export const recurring_payment = sqliteTable(
  'recurring_payment',
  {
    rule_id: text('rule_id')
      .notNull()
      .references(() => recurring_rule.id),
    due_date: text('due_date').notNull(),
    payment_kind: text('payment_kind').notNull(),
    transaction_id: text('transaction_id'),
    recorded_at: integer('recorded_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rule_id, t.due_date] }),
    uniqueIndex('recurring_payment_transaction_idx').on(t.transaction_id).where(sql`${t.transaction_id} IS NOT NULL`),
    check('recurring_payment_kind_check', sql`${t.payment_kind} IN ('linked','marked')`),
  ],
);

/** `Not this one`: the bill is never offered as the payment of this entry again (Story 6.3). Keyed by the pair, so it has no id of its own. */
export const recurring_match_dismissed = sqliteTable(
  'recurring_match_dismissed',
  {
    rule_id: text('rule_id')
      .notNull()
      .references(() => recurring_rule.id),
    transaction_id: text('transaction_id').notNull(),
    dismissed_at: integer('dismissed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.rule_id, t.transaction_id] })],
);
