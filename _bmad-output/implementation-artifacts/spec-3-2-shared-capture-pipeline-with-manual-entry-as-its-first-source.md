---
title: 'Story 3.2 - Shared capture pipeline with manual entry as its first source'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '1a6eb58'
---

## Intent

Implements the epic's Story 3.2 acceptance criteria (see epics.md). Every entry the Add sheet saves now goes through one core path that uses the Story 3.1 matcher, so later sources cannot get round the duplicate rules.

## Implementation Notes

- Migration `0006_heavy_yellow_claw` (drizzle-kit): `source_record` (fingerprint unique) and `review_candidate` tables (owner: capture, `capture.schema.ts`), and `transaction.status` now accepts `draft`, `needs_review`, `confirmed`, `excluded`, `reversed`; `capture_resolution` is checked against `user_approved | auto_approved | auto_linked | rejected`. `possible_duplicate` is never stored; it is an open `review_candidate` with reason `duplicate`.
- Migration runner fix: SQLite changes a CHECK by rebuilding the table, and the generated SQL starts with `PRAGMA foreign_keys=OFF`, which does nothing inside the runner's transaction, so on a database that already has rows the rebuild failed with a foreign key error (reproduced). `runMigrations` now switches foreign keys off outside the transaction for such a batch, then runs `PRAGMA foreign_key_check` and switches them back on. A regression test runs the real migrations over a database with a transaction, posting and split.
- Core `capture/submitCapture.ts`: `SubmitCapture` (parse, normalize, match, classify, create) in one writer transaction with audit, a `source_record` (`manual`), an optional `review_candidate`, and `TransactionsChanged` + `CapturesSubmitted`. The same submission id again returns the first save as `ALREADY_SUBMITTED` and writes nothing (the writer still leaves its placeholder audit row for the retry). A transfer and its fee go in one call, each with a source record.
- A manual entry that the matcher calls a possible duplicate (same amount, same merchant, within 10 minutes) is saved, never blocked, as `needs_review` with an open candidate and result `POSSIBLE_DUPLICATE`. It counts in no total (Spent, day Spent, balances, In accounts, Card dues; regression tests). An entry with no merchant is never held; two teas 40 minutes apart are both recorded.
- `RecordManualEntry` and `RecordTransfer` are removed; the ledger keeps `createEntry` and `createTransfer`, which only `SubmitCapture` may call. LIR-06 architecture test scans core and the app: no other module mentions them. Opening balances (2.4) and adjustments (2.5) keep their own use cases. 100 existing test call sites were repointed with a test helper (`testing/capture.ts`).
- `captureStatusLabel` (exhaustive switch over the eight states) and `captureStateOfResult`, `captureStateOf`; the words live in `copy.capture` (`Recorded`, `Recorded · category guessed`, ... `Rejected`); a test fails when a state is added without copy.
- Event catalogue gains `CapturesSubmitted` and `CapturesRejected` (captures, ledger, home, widget).
- Mobile: the Add sheet, Move money and Pay card bill save through `SubmitCapture` with a submission id (UUID v7 from the app's generator) that is kept across a failed attempt and dropped after a success. A `POSSIBLE_DUPLICATE` result still toasts `Saved · Undo` (the Keep both / Merge choices are Story 3.3).

## Deviation

- A retried submission leaves one placeholder audit row (the writer audits every use case); no ledger row, source record or event is written.
- Device check (Redmi, debuggable release): migration `0006` applied on the real database (`startup.ready`, `migrationsApplied: 1`) and the app opened to Home; the NFR-04 benchmark through `SubmitCapture` on 10,000 seeded entries gave median 35.8 ms, p95 60.2 ms, worst 61.4 ms (target 500 ms); two real saves logged 66 ms and 44 ms; the user saved an expense and saw Home and Activity update.

## Not done / open

- `review_candidate` rows are written but nothing reads them yet (Story 3.3 and 3.10).
