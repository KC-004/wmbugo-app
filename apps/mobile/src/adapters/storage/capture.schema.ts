import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { transaction } from './ledger.schema';

/**
 * Owned by capture (AD-3). Created by migration 0006 (Story 3.2). Every transaction has at least one source_record
 * (an Add-sheet save has source_kind manual); its fingerprint is what makes a retried submission return the
 * existing transaction instead of writing a second one.
 */
export const sourceRecord = sqliteTable(
  'source_record',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transaction.id),
    source_kind: text('source_kind').notNull(),
    fingerprint: text('fingerprint').notNull(),
    reference: text('reference'),
    created_at: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('source_record_fingerprint_idx').on(t.fingerprint),
    index('source_record_tx_idx').on(t.transaction_id),
    check('source_record_kind_check', sql`${t.source_kind} IN ('manual','upi','sms','receipt','csv','notification','share')`),
  ],
);

/**
 * Something that needs a decision. A possible duplicate is never stored on a transaction: it is derived from an open
 * review_candidate with reason duplicate (Story 3.2).
 */
export const reviewCandidate = sqliteTable(
  'review_candidate',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transaction.id),
    matched_transaction_id: text('matched_transaction_id').references(() => transaction.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    created_at: integer('created_at').notNull(),
    resolved_at: integer('resolved_at'),
  },
  (t) => [
    index('review_candidate_status_idx').on(t.status, t.created_at),
    index('review_candidate_tx_idx').on(t.transaction_id),
    check('review_candidate_reason_check', sql`${t.reason} IN ('duplicate','foreign_currency','pending','other')`),
    check('review_candidate_status_check', sql`${t.status} IN ('open','resolved')`),
  ],
);
