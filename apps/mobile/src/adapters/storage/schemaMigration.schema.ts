import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Owned by the storage adapter (AD-3). Created by migration 0001. One row per
 * applied migration; `checksum` is the SHA-256 of the migration's SQL text so
 * an edited migration is caught before it can drift a database.
 */
export const schemaMigration = sqliteTable('schema_migration', {
  version: integer('version').primaryKey(),
  tag: text('tag').notNull(),
  checksum: text('checksum').notNull(),
  applied_at: integer('applied_at').notNull(),
});
