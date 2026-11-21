---
title: 'Story 9.4: ImportCsvBatch: atomic, resumable, idempotent commit'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

## Intent

**Problem:** A large import must save in safe chunks that pick up where they stopped, so a crash never leaves half an import, a duplicate or a lost row.

**Approach:** `ImportCsvBatch` commits at most 500 planned rows in one `LedgerWriter` transaction, submitting each through the existing `SubmitCapture` and advancing `committed_through_row` in the same commit. `runCsvImport` and `resumeCsvImport` (core, over a `RawFileStore` port) read, validate, plan, keep the encrypted raw copy, then loop the batches; cancel is honoured between batches. A migration adds `import_batch`, `import_row_error`, the batch columns on `source_record`, and the new review reasons.

## Boundaries & Constraints

**Always:** the raw copy is written before the `import_batch` row commits (AD-9); a failing row is recorded with its row number and a code and the rest of the batch commits; a row's fingerprint is the `SubmitCapture` submission id, so a repeat writes nothing; other use cases queue between batches on the single writer.

**Never:** match a CSV row a second time at commit (the plan did it); convert a foreign amount; write a row's text into `import_row_error` or `mapping_json`.

## Tasks & Acceptance

- [x] `apps/mobile/drizzle/0028_import_batch.sql` and `capture.schema.ts` -- `import_batch`, `import_row_error`, `source_record.import_batch_id` / `file_row`, review reasons `transfer_pair`, `held_pair`, `edge_day`
- [x] `capture/submitCapture.ts` -- optional `csv` metadata: review reason, needs-category, excluded, foreign; source record carries batch and row; CSV rows are not matched again
- [x] `capture/csv/import.ts` -- `actionFor`, `StartCsvImport`, `ImportCsvBatch`, `FinishCsvImport`, `PauseInterruptedImports`
- [x] `capture/csv/runImport.ts` -- `RawFileStore` port, `runCsvImport`, `ResumeCsvImport`, `resumeCsvImport`, `readImport`
- [x] `capture/csv/planContext.ts` -- entries from this file's earlier run are not matched against its remaining rows, and do not make its own edge days look partly covered; `Import anyway` fingerprints
- [x] `capture/csv/import.test.ts` -- 21 tests: each class, the PRD fixtures (a bad date on row 57; a 1,200-row import killed in batch 3 paused at row 1,000 and resumed at 1,001; the same file again skips every row; cancel; manual save between batches), a property test over random interruption points

## Implementation Notes

- `committed_through_row` is a file row number. The heading is row 1, so 1,000 data rows end at row 1,001; the spec's "1000" is the data-row count and `imported_count` is 1,000.
- **Income with no category:** there is no `Uncategorised` income category, so an income row with no usable category is filed under `From people` and flagged `needs_category`, which is what puts it in front of the person. An expense row uses `Uncategorised`.
- **Foreign rows** are written as the Story 3.10 shape: `needs_review`, profile amount 0, no posting, the foreign amount and currency on the entry, a split carrying 0, and an open `foreign_currency` candidate. `ConfirmForeignAmount` then confirms them as for any foreign capture.
- **Import anyway** for a row whose removed entry is still in the ledger: that entry holds the fingerprint, so the new entry is committed under `anywayFingerprint(fingerprint)`; the next plan reads it first, so the row then reads as already recorded. A purged entry has only a tombstone, so the original fingerprint is used with `ignoreTombstone`.
- A transfer pair inside the file commits both legs as waiting entries with open `transfer_pair` candidates that point at each other (the second leg points back at the first, and updates the first's candidate). Linking them is Story 9.5.
- `PauseInterruptedImports` is the restart rule (`importing` becomes `paused`); wiring it into app start is part of the wizard stories.
- The `RawFileStore` phone adapter (device-key encrypted copy) is Story 9.6/9.8 work; core is tested with an in-memory store.
- `ImportsChanged` (query area `captures`) is the new event for import start, pause and finish.
- A row that fails the Story 9.2 validation is carried into the batch as an `error` row so its row number and code are written in the same transaction as the rest.

## Verification

core jest passes (1,208 in all, 21 new); `tsc` and ESLint clean; mobile `queryClient` test updated for the new event.
