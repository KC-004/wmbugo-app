-- Story 3.6: the Activity search index (SQLite FTS5). One row per entry: merchant, note, category and account names.
-- It is kept up to date in the same writer transaction as every change (see the writer's indexer). A drizzle
-- custom migration, because drizzle does not model virtual tables.
CREATE VIRTUAL TABLE `activity_search` USING fts5(tx_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');--> statement-breakpoint
INSERT INTO `activity_search` (tx_id, body) SELECT t.id, TRIM(COALESCE(t.original_description, '') || ' ' || COALESCE(t.note, '') || ' ' || COALESCE((SELECT group_concat(c.name, ' ') FROM split s JOIN category c ON c.id = s.category_id WHERE s.transaction_id = t.id), '') || ' ' || COALESCE((SELECT group_concat(a.name, ' ') FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id), '')) FROM `transaction` t WHERE t.event_type IN ('expense', 'income', 'transfer', 'refund');
