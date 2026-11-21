# Epic 9 Context: CSV import and export

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Sara brings her bank and card history into wmbugo from a CSV file through a guided full-screen wizard, and can export her entries and an account summary as CSV. Reading is tolerant (any encoding, delimiter, number style, date style), nothing is written until she taps `Import N entries`, rows go through the existing capture pipeline and matcher unchanged, imports commit in atomic resumable batches, and importing the same or an overlapping file never adds anything twice.

## Stories

- Story 9.1: Read any bank CSV file in core
- Story 9.2: Column mapping, row validation and saved bank formats in core
- Story 9.3: Import plan: classify every row against the ledger before writing
- Story 9.4: ImportCsvBatch: atomic, resumable, idempotent commit
- Story 9.5: Imported transfer pairs and edge-day rows in the review queue
- Story 9.6: Import wizard: choose a file, confirm columns and preview
- Story 9.7: Import wizard: check matches, import and see the summary
- Story 9.8: Keep or delete imported files
- Story 9.9: Export transactions and account summaries as CSV

## Requirements & Constraints

- Amounts are exact minor units end to end: no floating-point step in parsing, formatting or matching. A text that is not a number is an error (`INVALID_AMOUNT`), never 0.
- A date without a time is a `local_date` exactly as written in the profile timezone, no UTC shift; a date with a time is a UTC instant in the profile timezone with that `local_date`. An ambiguous day/month order is asked, not guessed.
- Every bad row is reported with its 1-based file row number and a fixed code and copy; one bad row never stops the others. Foreign-currency rows are imported as currency review items, never converted.
- Re-importing the same or an overlapping file adds nothing twice (source fingerprints); rows that look like duplicates, transfers or edge-day rows go to review and are never merged silently; rows the person removed before are skipped unless she chooses `Import anyway` per row.
- Import commits in atomic batches of at most 500 rows, each one writer transaction that also advances the resume position; an interrupted import resumes from the next row with nothing duplicated.
- The raw file is kept encrypted in app-private storage (default 30 days, configurable, deleted at once when chosen); no network, no storage permission (system file picker and save dialog only).
- Export writes through the shared CSV writer (UTF-8 with BOM, CRLF, formula-injection escaping), carries period, filter, timezone, currency and schema metadata lines, masks account numbers (last four only, off by default), and asks for a confirm plus re-auth because the file is not encrypted.

## Technical Decisions

- Reading, mapping, validation, planning and the batch commit are pure core (`packages/core`, no React Native imports); Papa Parse sits behind a `CsvTokenizer` port in the mobile adapter. Core owns encoding detection, delimiter and header detection, number and date parsing.
- `ImportCsvBatch` is a use case through `LedgerWriter` (one transaction, audit row, outbox event) that submits each row through the existing `SubmitCapture` pipeline with `source_kind = csv` and the existing matcher. New capture-owned tables: `csv_format` (saved bank layouts, header signature only, no row data) and `import_batch`. Never edit an applied migration; add a new one.
- The existing money primitives (Story 1.4), merchant normalizer (Story 3.1) and shared CSV writer (Story 7.3) are reused, not reimplemented.
- Everything logged stays redacted; no row data, merchant, amount or file name in logs.

## UX & Interaction Patterns

- Settings › Data gains Import CSV, Imported files and Export CSV. The wizard is full-screen with a shared stepper header (`Step N of M`, Back, Cancel) and a coin-flip long-task loader for reading, planning, importing and exporting (still frame under Reduce motion). Preview rows follow the Activity convention (money out unsigned, money in `+` in the income colour). Duplicate and transfer candidates show side by side and stack at large font scale.

## Cross-Story Dependencies

- 9.1 feeds 9.2 (mapping and validation), which feeds 9.3 (plan) and 9.4 (commit). 9.5 adds review-queue cards for what 9.4 writes. 9.6 and 9.7 are the wizard over 9.1 to 9.4. 9.8 adds retention over `import_batch` and `PurgeExpired`. 9.9 is independent of the importer and reuses the Story 7.3 writer.
