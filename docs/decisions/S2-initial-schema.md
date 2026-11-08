# S2 — Initial schema and migration plan

Status: **designed 2026-11-08 (Story 1.5); GATE-07 finance review pending.**
Inputs: PRD §11.1, AD-3 (ownership), AD-5 (signs), AD-8, [S1](S1-storage-migrations.md) (toolchain), Story 1.4 (money and time primitives).

## 1. Conventions (apply to every table)

| Topic | Rule |
|-------|------|
| Primary keys | `id TEXT PRIMARY KEY`, a UUID v7 string from the core ID generator. **Exceptions (keyed lookup tables, no row identity of their own):** `settings` (`key`), `prompt_state` (`key`), `schema_migration` (`version INTEGER`), `sms_cursor` (singleton, `id` fixed to `'singleton'`), `budget_alert_fired` and `balance_chain` (composite natural keys). The schema-lint test carries this allowlist. |
| Money | `INTEGER`, name ends `_minor`, a safe integer in the profile currency's exponent. **No `REAL` column anywhere.** Non-money integers (counts, sizes, percentages) must not end in `_minor`. |
| Instants | `INTEGER` UTC epoch milliseconds, names end `_at` (or `_at_utc` for `transaction.occurred_at_utc`). |
| Local dates | `TEXT` `YYYY-MM-DD`, names end `_date` or equal `local_date`, `CHECK (length = 10)`. `transaction.local_date` and `timezone_id` are written once at capture and never recomputed. |
| Booleans | `INTEGER` 0/1 with `CHECK (col IN (0,1))`. |
| Enums | `TEXT` with `CHECK (col IN (...))` listing the values below. |
| Lists / maps | `TEXT` holding JSON, name ends `_json` (e.g. `tags_json`, `aliases_json`). Never queried by content. |
| Currency | One per profile. No per-row currency column, except the three optional `foreign_*` columns on `transaction`. |
| Foreign keys | Enforced (`PRAGMA foreign_keys = ON`). Default `ON DELETE RESTRICT`; exceptions are named below. Cross-module references are opaque IDs (AD-3) but still carry the FK so the file stays consistent. |
| Deletion | Ledger rows are never hard-deleted by users: `transaction.removed_at` + `removal_kind`. Only retention jobs and restore replace rows. |
| Names | `snake_case`, singular table names. `transaction` is quoted in SQL (`"transaction"`). |
| `is_synced` | Not stored (no sync in Phase 1). |

## 2. Ownership and migration plan

One migration per story (forward-only, one transaction, safety copy first, recorded in `schema_migration`). A table is created by the first story that needs it; later epics add their tables in their own numbered migrations.

| Migration | Story | Tables created (owner) |
|-----------|-------|------------------------|
| 0001 | 1.6 | `schema_migration` (storage adapter) |
| 0002 | 1.7 | `audit_event`, `outbox` (writer) |
| 0003 | 1.11 | `profile`, `settings`, `prompt_state` (profile) |
| 0004 | 1.12 | `account`, `transaction`, `posting` (ledger) |
| 0005 | 1.13 | `category`, `split` (ledger) |
| later | Epic 2 | `account_identifier` (ledger) — transfer linking and discovery; `auto_approve_rule` and `clock_guard` with the story that first enforces them (profile) |
| later | Epic 3 | `merchant`, `payee`, `learned_mapping` (learning) as search/fixes first need them; `attachment` (ledger) with the first attachment story |
| later | Epic 4 | `budget`, `budget_period`, `budget_alert_fired` (planning) |
| later | Epic 6 | `recurring_rule`, `goal`, `goal_allocation` (planning) |
| later | Epic 9 | `import_batch`, `source_record` (capture) |
| later | Epic 10 | `receipt_item` (ledger) |
| later | Epic 11 | `review_candidate`, `learned_mapping` extensions (capture/learning) |
| later | Epic 12–13 | `sender`, `balance_chain`, `sms_cursor`, `tombstone`, `pending_share` (capture) |
| Phase 2 | — | `automation_rule` |

Rules: a migration may only create or alter tables its story owns; Story 1.13's `category` migration also seeds the default category set; `category.budget_type` exists from its first version (CAT-006). The first-created table set must already contain every index §11.2 requires for that table.

## 3. Tables created in Epic 1

### 3.1 `schema_migration` (storage adapter, migration 0001)

| Column | Type | Notes |
|--------|------|-------|
| `version` | INTEGER PK | 1, 2, ... |
| `tag` | TEXT NOT NULL | drizzle-kit file tag |
| `checksum` | TEXT NOT NULL | SHA-256 of the SQL text |
| `applied_at` | INTEGER NOT NULL | UTC ms |

### 3.2 `audit_event` (writer, 0002)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID v7 |
| `kind` | TEXT NOT NULL | use-case / event name |
| `actor` | TEXT NOT NULL | `user|auto|system` |
| `entity_kind` | TEXT NOT NULL | e.g. `transaction` |
| `entity_id` | TEXT NOT NULL | opaque reference |
| `change_json` | TEXT NOT NULL | old/new fields with amounts, notes and masks already redacted |
| `created_at` | INTEGER NOT NULL | UTC ms |

Indexes: `(entity_kind, entity_id, created_at)`, `(created_at)`.

### 3.3 `outbox` (writer, 0002)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | event id; handlers are idempotent on it |
| `event` | TEXT NOT NULL | from the type-checked catalogue |
| `actor` | TEXT NOT NULL | `user|auto|system` |
| `payload_json` | TEXT NOT NULL | ids only, no amounts or text |
| `created_at` | INTEGER NOT NULL | |
| `delivered_at` | INTEGER NULL | NULL until every handler succeeded |

Index: `(delivered_at, created_at)` for redelivery on start.

### 3.4 `profile` (profile, 0003) — one row per install

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `region` | TEXT NOT NULL | ISO 3166-1 alpha-2 |
| `currency_code` | TEXT NOT NULL | Phase 1 list |
| `currency_exponent` | INTEGER NOT NULL | 0, 2 or 3 |
| `locale` | TEXT NOT NULL | BCP-47 |
| `timezone_id` | TEXT NOT NULL | IANA |
| `payday_rule` | TEXT NULL | `first|last_day|last_working_day|day_n|none` |
| `payday_day` | INTEGER NULL | 1–31 when `day_n` |
| `clock_wall_ms` | INTEGER NULL | clock guard |
| `clock_elapsed_ms` | INTEGER NULL | |
| `clock_boot_count` | INTEGER NULL | |
| `created_at` | INTEGER NOT NULL | |

Constraint: exactly one row (`CHECK` via fixed id or app-level; writer asserts). `currency_code` and `currency_exponent` change only while no transaction exists (writer invariant).

### 3.5 `settings` and `prompt_state` (profile, 0003)

`settings(key TEXT PK, value_json TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`.
`prompt_state(key TEXT PK, count INTEGER NOT NULL DEFAULT 0, last_shown_at INTEGER NULL)`.

## 4. Ledger tables (0004, 0005)

### 4.1 `account` (ledger, 0004)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `name` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `cash|bank|wallet|savings_pot|card` |
| `icon` | TEXT NOT NULL | Phosphor icon name |
| `color_token` | TEXT NOT NULL | design token name |
| `credit_limit_minor` | INTEGER NULL | cards only |
| `statement_due_minor` | INTEGER NULL | cards only |
| `statement_due_date` | TEXT NULL | `YYYY-MM-DD` |
| `opening_minor` | INTEGER NULL | NULL when `balance_not_set = 1` |
| `opening_effective_at` | INTEGER NULL | |
| `balance_not_set` | INTEGER NOT NULL | 0/1; unknown balance shows "not set", never zero |
| `include_in_overview` | INTEGER NOT NULL | 0/1 |
| `sort_order` | INTEGER NOT NULL | |
| `status` | TEXT NOT NULL | `active|archived` |
| `created_at`, `updated_at` | INTEGER NOT NULL | |

Indexes: `(status, sort_order)`. Checks: `credit_limit_minor >= 0`, `balance_not_set = 1 OR opening_minor IS NOT NULL`.

The opening balance is stored on the account only as a convenience copy of the derived opening posting's amount; the posting with `posting_kind = opening_balance` is the source of truth (AD-5, one representation). **Decision (proposed for GATE-07 sign-off):** keep `opening_minor` as a nullable convenience copy; the `openingBalanceShape` invariant (Story 1.12 follow-up) now checks on every write that it equals the sum of the account's opening postings, so the two cannot drift. Dropping the column stays possible later as a new migration; no reader depends on it.

### 4.2 `transaction` (ledger, 0004)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `event_type` | TEXT NOT NULL | `expense|income|transfer` |
| `status` | TEXT NOT NULL | `needs_review|confirmed` (waiting items are excluded from every total) |
| `amount_minor` | INTEGER NOT NULL | magnitude, `CHECK (>= 0)`; direction comes from `event_type` and postings |
| `occurred_at_utc` | INTEGER NOT NULL | instant |
| `local_date` | TEXT NOT NULL | `YYYY-MM-DD`, set once from capture time |
| `timezone_id` | TEXT NOT NULL | zone at capture |
| `merchant_id` | TEXT NULL | opaque ref (learning) |
| `payee_id` | TEXT NULL | opaque ref (learning) |
| `refund_of_transaction_id` | TEXT NULL | FK `transaction(id)` |
| `recurring_rule_id` | TEXT NULL | opaque ref (planning) |
| `original_description` | TEXT NULL | |
| `note` | TEXT NULL | |
| `reference` | TEXT NULL | |
| `payment_method` | TEXT NULL | |
| `tags_json` | TEXT NOT NULL DEFAULT '[]' | |
| `capture_resolution` | TEXT NULL | |
| `needs_category` | INTEGER NOT NULL | 0/1 |
| `foreign_amount_minor` | INTEGER NULL | with the two columns below, all or none |
| `foreign_currency` | TEXT NULL | |
| `foreign_currency_exponent` | INTEGER NULL | |
| `removed_at` | INTEGER NULL | soft delete |
| `removal_kind` | TEXT NULL | `deleted|rejected|excluded`; set iff `removed_at` set |
| `created_at`, `updated_at` | INTEGER NOT NULL | |
| `reversed_by_id` | TEXT NULL | FK `transaction(id)` |

Indexes: `(local_date, id)`, `(status, local_date)`, `(removed_at)`, `(merchant_id)`, `(refund_of_transaction_id)`, `(recurring_rule_id)`. Epic 1 creates only columns it needs but the **table is created complete** so no later migration rewrites it.

### 4.3 `posting` (ledger, 0004)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `transaction_id` | TEXT NOT NULL | FK `transaction(id)` ON DELETE RESTRICT |
| `account_id` | TEXT NOT NULL | FK `account(id)` |
| `direction` | TEXT NOT NULL | `in|out`, must agree with the sign |
| `signed_amount_minor` | INTEGER NOT NULL | **positive into the account, negative out of it, for every account type** |
| `posting_kind` | TEXT NOT NULL | `normal|opening_balance|adjustment` |

Indexes: `(account_id, transaction_id)`, `(transaction_id)`.
Invariants (writer, before commit): a transfer's postings sum to 0; an expense is one negative posting, income one positive posting; `|signed_amount_minor|` equals `transaction.amount_minor` except for opening/adjustment; a card's balance is the sum of its postings and is negative while money is owed ("Card dues" displays the negation).

### 4.4 `category` (ledger, 0005)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `parent_id` | TEXT NULL | FK `category(id)` |
| `name` | TEXT NOT NULL | |
| `kind` | TEXT NOT NULL | `expense|income` |
| `budget_type` | TEXT NULL | `need|want`; present from the first version (CAT-006) |
| `icon`, `color_token` | TEXT NOT NULL | |
| `sort_order` | INTEGER NOT NULL | |
| `archived` | INTEGER NOT NULL | 0/1 |

Indexes: `(parent_id, sort_order)`.

### 4.5 `split` (ledger, 0005)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `transaction_id` | TEXT NOT NULL | FK `transaction(id)` |
| `category_id` | TEXT NOT NULL | FK `category(id)` |
| `amount_minor` | INTEGER NOT NULL | `CHECK (>= 0)`; splits of one transaction sum to its absolute categorisable amount |
| `memo` | TEXT NULL | |

Indexes: `(category_id, transaction_id)`, `(transaction_id)`.

## 5. Later-epic tables (column lists, to be created by their stories)

Columns follow PRD §11.1 and take the conventions above; each is owned and created as in §2. They are listed here so Epic 1 does not design against a different shape.

| Table (owner) | Columns beyond `id` | Keys / indexes |
|---------------|--------------------|----------------|
| `account_identifier` (ledger) | `sender_id`, `mask`, `kind` (`account|card`), `account_id` | unique `(sender_id, mask)`; FK `account_id` |
| `attachment` (ledger) | `local_encrypted_path`, `mime_type`, `size_bytes`, `digest`, `transaction_id`, `created_at` | `(transaction_id)`; unique `digest` per transaction |
| `receipt_item` (ledger) | `attachment_id`, `transaction_id`, `name`, `qty` (INTEGER, thousandths), `amount_minor`, `split_id?`, `category_id?`, `unparsed` | `(transaction_id)` |
| `source_record` (capture) | `transaction_id?`, `source_kind` (`sms|upi_screenshot|receipt|csv|manual`), `source_fingerprint`, `external_reference?`, `sender_id?`, `import_batch_id?`, `confidence_pct?`, `parse_complete`, `scam_flag`, `balance_flag`, `redacted_preview?`, `source_received_at` | unique `source_fingerprint` where meaningful; `(transaction_id)` |
| `review_candidate` (capture) | `source_record_id`, `proposed_transaction_id?`, `match_score_pct`, `reason`, `status`, `resolved_at?` | `(status)` |
| `sender`, `balance_chain`, `sms_cursor`, `tombstone`, `import_batch`, `pending_share` (capture) | per PRD §11.1; `last_balance_minor` is money (accounts only, never card limits); tombstone has no amount, merchant or text | `balance_chain` PK `(sender_id, mask)` |
| `learned_mapping`, `payee`, `merchant` (learning) | per PRD §11.1; `merchant.aliases_json`, normalised name column for alias lookup | index on normalised alias name |
| `budget`, `budget_period`, `budget_alert_fired` (planning) | per PRD §11.1; `target_minor`, `cached_target_minor?`; alert PK `(budget_id, period_start_date, threshold_pct)` | |
| `recurring_rule`, `goal`, `goal_allocation` (planning) | per PRD §11.1; `amount_minor`, `amount_tolerance_minor`, `target_minor`; goal links only via `goal_allocation` | |
| `auto_approve_rule` (profile) | `version`, `enabled`, `cutoff_local` (`HH:MM`), `effective_from_date` | |

`tags[]`, `aliases[]`, `raw_headers[]`, `account_ids[]` are stored as `*_json` text.

## 6. Schema-lint test (added to core CI)

`packages/core/src/schema-lint.test.ts` reads every Drizzle schema file under `apps/mobile/src` (and the future adapter schema folder) as text — core never imports Drizzle — and fails when:

1. any column is declared with `real(` (or `numeric(` / `blob` money);
2. a column whose name ends `_amount`, `_balance`, `_limit`, or contains `amount`/`balance`/`target`/`price`/`total` but is an integer and does not end `_minor` (allowlist: `size_bytes`, `threshold_pct`, `match_score_pct`, `confidence_pct`, `qty`);
3. a table's primary key is not `text('id')` and the table is not on the keyed-lookup allowlist from §1.

The test self-checks with small fixture strings that must fail, so it cannot pass vacuously.

## 7. GATE-07 sign-off

Finance domain reviewer review of the posting sign convention, refunds, liabilities and the worked examples below: **pending**. The Story 1.5 acceptance criterion that records the product owner's review is therefore unmet and stays an open item; Stories 1.6, 1.7, 1.11, 1.12 and 1.13 may build against this design, but any change the reviewer requests is a new migration, not a rewrite.

Worked examples for the review (profile currency INR, exponent 2):

| Case | Transaction | Postings |
|------|-------------|----------|
| Expense ₹250.00 from bank A | `expense`, `amount_minor 25000` | A: `-25000` |
| Income ₹50,000.00 into bank A | `income`, `5000000` | A: `+5000000` |
| Transfer ₹1,000.00 A to cash C | `transfer`, `100000` | A: `-100000`, C: `+100000` (sum 0) |
| Card spend ₹800.00 | `expense`, `80000` | card: `-80000` (balance becomes −80000; Card dues ₹800.00) |
| Card payment ₹800.00 from A | `transfer`, `80000` | A: `-80000`, card: `+80000` (card balance 0) |
| Opening balance ₹10,000.00 on A | none user-visible | A: `+1000000`, kind `opening_balance` |
| Card opening dues ₹2,500.00 | none | card: `-250000`, kind `opening_balance` |
| Refund ₹250.00 of the expense above | `income`, `refund_of_transaction_id` set | A: `+25000` |
