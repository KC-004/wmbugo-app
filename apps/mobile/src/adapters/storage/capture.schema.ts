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
    // What the resolution (Keep both, Merge) changed, so Undo can put every row back exactly. Null while open.
    undo_json: text('undo_json'),
  },
  (t) => [
    index('review_candidate_status_idx').on(t.status, t.created_at),
    index('review_candidate_tx_idx').on(t.transaction_id),
    check('review_candidate_reason_check', sql`${t.reason} IN ('duplicate','foreign_currency','pending','other')`),
    check('review_candidate_status_check', sql`${t.status} IN ('open','resolved')`),
  ],
);

/**
 * A photo attached to an entry (Story 3.11). The image itself is an encrypted file in app-private storage named by
 * the attachment id; this row is what keeps it. Unique per entry and digest, so the same photo cannot attach twice.
 */
export const attachment = sqliteTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    transaction_id: text('transaction_id')
      .notNull()
      .references(() => transaction.id),
    kind: text('kind').notNull().default('receipt'),
    digest: text('digest').notNull(),
    size_bytes: integer('size_bytes').notNull(),
    created_at: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('attachment_tx_digest_idx').on(t.transaction_id, t.digest),
    index('attachment_tx_idx').on(t.transaction_id),
    check('attachment_kind_check', sql`${t.kind} IN ('receipt')`),
  ],
);

/**
 * What wmbugo remembers about an entry after it is purged (Story 3.12): only a salted hash of its duplicate fingerprint,
 * the outcome and the purge date. No amount, merchant or text.
 */
export const tombstone = sqliteTable(
  'tombstone',
  {
    id: text('id').primaryKey(),
    fingerprint_hash: text('fingerprint_hash').notNull(),
    outcome: text('outcome').notNull(),
    purged_at: integer('purged_at').notNull(),
  },
  (t) => [
    index('tombstone_hash_idx').on(t.fingerprint_hash),
    check('tombstone_outcome_check', sql`${t.outcome} IN ('deleted','rejected')`),
  ],
);
