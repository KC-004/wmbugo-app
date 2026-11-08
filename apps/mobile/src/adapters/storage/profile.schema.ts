import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Owned by the profile module (AD-3). Created by migration 0003 (Story 1.11). One profile row per
 * install; currency changes only while no transaction exists (writer invariant, Story 1.12+).
 */
export const profile = sqliteTable('profile', {
  id: text('id').primaryKey(),
  region: text('region').notNull(),
  currency_code: text('currency_code').notNull(),
  currency_exponent: integer('currency_exponent').notNull(),
  locale: text('locale').notNull(),
  timezone_id: text('timezone_id').notNull(),
  payday_rule: text('payday_rule'),
  payday_day: integer('payday_day'),
  clock_wall_ms: integer('clock_wall_ms'),
  clock_elapsed_ms: integer('clock_elapsed_ms'),
  clock_boot_count: integer('clock_boot_count'),
  created_at: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value_json: text('value_json').notNull(),
  version: integer('version').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const promptState = sqliteTable('prompt_state', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  last_shown_at: integer('last_shown_at'),
});
