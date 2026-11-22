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
    // CSV sources only (Story 9.4): the import this row came from and its 1-based row in the file.
    import_batch_id: text('import_batch_id'),
    file_row: integer('file_row'),
  },
  (t) => [
    uniqueIndex('source_record_fingerprint_idx').on(t.fingerprint),
    index('source_record_tx_idx').on(t.transaction_id),
    index('source_record_batch_idx').on(t.import_batch_id),
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
    check('review_candidate_reason_check', sql`${t.reason} IN ('duplicate','foreign_currency','pending','other','transfer_pair','held_pair','edge_day')`),
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

/**
 * A bank's CSV layout, remembered so the next file from the same bank skips the Columns step (Story 9.2). Owned by capture. It
 * holds a hash of the heading cells and the delimiter, the column mapping and the choices made with it: never a row of data, an
 * amount or a description.
 */
export const csvFormat = sqliteTable(
  'csv_format',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    header_signature: text('header_signature').notNull(),
    mapping_json: text('mapping_json').notNull(),
    overrides_json: text('overrides_json').notNull().default('{}'),
    flip_sign: integer('flip_sign').notNull().default(0),
    account_json: text('account_json').notNull().default('{}'),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('csv_format_signature_idx').on(t.header_signature),
    check('csv_format_flip_check', sql`${t.flip_sign} IN (0,1)`),
    check('csv_format_json_check', sql`json_valid(${t.mapping_json}) AND json_valid(${t.overrides_json}) AND json_valid(${t.account_json})`),
  ],
);

/**
 * One CSV import (Story 9.4, AD-6). Owned by capture. `committed_through_row` advances in the same commit as each batch of rows, so
 * a killed import resumes from the next row and nothing is written twice. `mapping_json` holds what a resume needs (the layout, the
 * overrides, the account choice and the per-row decisions): never a row of the file. The raw file is an encrypted copy at `raw_path`.
 */
export const importBatch = sqliteTable(
  'import_batch',
  {
    id: text('id').primaryKey(),
    file_digest: text('file_digest').notNull(),
    format_id: text('format_id'),
    mapping_json: text('mapping_json').notNull(),
    account_id: text('account_id'),
    status: text('status').notNull().default('planned'),
    row_count: integer('row_count').notNull(),
    committed_through_row: integer('committed_through_row').notNull().default(0),
    imported_count: integer('imported_count').notNull().default(0),
    skipped_count: integer('skipped_count').notNull().default(0),
    review_count: integer('review_count').notNull().default(0),
    error_count: integer('error_count').notNull().default(0),
    raw_path: text('raw_path'),
    /** The file's display name as the picker gave it (Story 9.8); shown in the imports list and on an entry's Source line. */
    file_name: text('file_name'),
    retain_until: integer('retain_until'),
    created_at: integer('created_at').notNull(),
    completed_at: integer('completed_at'),
  },
  (t) => [
    index('import_batch_status_idx').on(t.status, t.created_at),
    index('import_batch_digest_idx').on(t.file_digest),
    check('import_batch_status_check', sql`${t.status} IN ('planned','importing','paused','completed','abandoned')`),
    check('import_batch_json_check', sql`json_valid(${t.mapping_json})`),
  ],
);

/** A row that could not be imported (Story 9.4): its row number in the file and a code, never the row's text. */
export const importRowError = sqliteTable(
  'import_row_error',
  {
    id: text('id').primaryKey(),
    import_batch_id: text('import_batch_id')
      .notNull()
      .references(() => importBatch.id),
    file_row: integer('file_row').notNull(),
    code: text('code').notNull(),
    created_at: integer('created_at').notNull(),
  },
  (t) => [index('import_row_error_batch_idx').on(t.import_batch_id, t.file_row)],
);
