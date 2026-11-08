import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const probe = sqliteTable('probe', {
  id: text('id').primaryKey(),
  amount_minor: integer('amount_minor').notNull(),
  note: text('note'),
});
