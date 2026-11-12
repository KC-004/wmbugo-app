import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    /** `fifty_thirty_twenty` for the one-tap split (Story 4.10); null otherwise. */
    template: text('template'),
    /** JSON alert thresholds; null means the default (75% and 100%). */
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
