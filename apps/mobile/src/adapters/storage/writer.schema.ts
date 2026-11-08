import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Owned by the writer (AD-3). Created by migration 0002 (Story 1.7).
 * `change_json` holds old/new fields with amounts, notes and masks already
 * redacted; `payload_json` holds ids only.
 */
export const auditEvent = sqliteTable(
  'audit_event',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    actor: text('actor').notNull(),
    entity_kind: text('entity_kind').notNull(),
    entity_id: text('entity_id').notNull(),
    change_json: text('change_json').notNull(),
    created_at: integer('created_at').notNull(),
  },
  (t) => [index('audit_event_entity_idx').on(t.entity_kind, t.entity_id, t.created_at), index('audit_event_created_idx').on(t.created_at)],
);

export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    event: text('event').notNull(),
    actor: text('actor').notNull(),
    payload_json: text('payload_json').notNull(),
    created_at: integer('created_at').notNull(),
    delivered_at: integer('delivered_at'),
  },
  (t) => [index('outbox_pending_idx').on(t.delivered_at, t.created_at)],
);
