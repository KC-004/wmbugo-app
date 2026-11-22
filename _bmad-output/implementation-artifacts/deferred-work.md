
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Choose and add a native backdrop-blur library so Glass blurs behind its tint (currently tint and border only).
  evidence: Story 1.8 AC asks for blur; no library is chosen and each adds a native dependency. Decide alongside the S8 glass frame-rate measurement.
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Replace the placeholder coin-flip Lottie with the final asset (GATE-12).
  evidence: Placeholder shipped on purpose; the AC allows it until GATE-12.
- source_spec: `spec-4-1-categories-screen-add-edit-reorder-icons-palette-colours-and-need-want-type.md`
  summary: SaveCategory should refuse (or define behaviour for) editing an archived category.
  evidence: Review of 4.1: edit path does not check archived; unreachable from the UI until Story 4.3 archives categories.

## Deferred from: code review of Epic 4, chunk A: money, periods, migrations, alerts (2026-11-13)

- **A budget alert is recorded as fired before it is posted** (`planning/budgetAlerts.ts`, `startApp.ts`). If the notifier is unavailable, permission is not granted or `post` throws, the crossing is already in `budget_alert_fired` and is never retried, so a permission granted later delivers nothing for that period. Real today only because `appNotifier` is `unavailableNotifier`. Needs a separate "notified" state (a column and a migration) decided together with the react-native-notify-kit adapter story. Marked medium.
- **A pending next-period limit cannot be cancelled by an edit that equals the latest version** (`SaveBudget` target versions). Editing to the value already in force, with a future version pending, adds nothing. Needs a rule for superseding future versions (decide with Story 4.7 follow-up). Marked low.
- **`reopenBudgets` requires every category of an ended budget to be restored at once** (`planning/budgetStore.ts`). A two-category budget that ended after both were archived stays ended when only one comes back. Marked low; rare.
- **Migration 0018 stamps `category_set_by = 'user'` on every entry with `needs_category = 0`, including transfers and card payments that never had a category.** It cannot be edited now (applied on the dev phone, and the checksum guard forbids it); harmless, because `ApplySuggestion` only acts on single-category expenses and incomes.
- **Missing CHECK constraints** on `category_guessed`, `category_set_by`, `budget_period.target_minor` and scope-versus-field consistency (`budget`). Adding them needs a table rebuild migration. Marked low.

## Deferred from: build of Story 5.1 (2026-11-15)

- source_spec: `spec-5-1-home-read-model-refresh-and-stale-indication.md`
  summary: Assert `refundSurplusMinor`, `period.shortened` and `daysLeft` for a budget on a non-default period in `homeSummary` tests, and test `realHomeApi.load` mapping.
  evidence: Verification-gap review of 5.1: these fields are not rendered until Story 5.2, whose hero is the first consumer; the mapping is thin and was only checked by hand.
- source_spec: `spec-5-1-home-read-model-refresh-and-stale-indication.md`
  summary: Split Home into independent per-card queries so one failing card does not blank the others.
  evidence: 5.1 keeps one combined `home.summary` query; the cards in 5.4 and 5.5 need their own queries to meet the per-card error criterion.

## Deferred from: code review of Epic 8 (2026-11-21)
Full list in epic-8-code-review-2026-11-21.md. Summary:
- Device checks: CipherInputStream GCM tag handling, libsodium known-answer parity, BiometricPrompt on API 26-29, provider renaming of .wmbugo files.
- startAppOnce test needs a small refactor.
- Safe-mode refusal shown on edit and delete screens (depends on decision D4).
- Argon2id runs up to three times per restore; measure on the phone.
- Pure-TypeScript secretstream speed on Hermes unmeasured.
- No committed schema-N backup fixture.
- Notification library not installed (Epic 11).
- ChangeSetting re-auth is UI-only.
- Backup key derivation hardening (verifier subkey, header as associated data).
- Restore notice time zone and string handling.
- CI symbols upload retention.

## Deferred from: code review of Epic 9 (2026-11-22)

Graded from the reviewers' reports; only the first group was checked against the code.

- `held_pair` review rows (reversal or transfer?) show as plain Waiting: no filter, read-model or detail support, so there is no way to answer the question. Medium, needs a new UI.
- Reference-based fingerprint has no account in it: two accounts reusing a reference such as `1` collide, and the second row is skipped as already recorded. Unverified.
- No-reference fingerprint counts occurrences within one file, so an overlapping file starting part-way through a day can duplicate. Unverified.
- Resume re-plans against the live ledger: a transfer pair whose first leg was committed earlier loses its partner. Unverified.
- `normalizeHeading` keeps only `[a-z0-9()]`: headings in non-Latin scripts share one layout signature. Unverified.
- Amounts: Indian lakh grouping (`1,23,456.78`), Swiss `1'234.56` and `1 234.56` with a dot decimal are rejected. Dates: no `DD/MM/YY` or `YYYY/MM/DD`.
- Zero amount reads as "No amount in this row"; a skipped row with a bad date still counts as an error; `signWarning` compares across interleaved accounts.
- `readCsv`: an unterminated quote swallows the rest of the file with no warning; UTF-16 odd byte and invalid UTF-8 are altered silently; a bad `headerRow` override can throw.
- `retain_until` is set when the import starts, not when it completes.
- `UndoImportReview` restores whole snapshots and loses later edits; `undo_json` is parsed unguarded.
- `createForeignRow` drops the chosen account and leaves an open candidate on an excluded row.
- `categoriesByName` is keyed by name only: an expense and an income category with one name collide.
- `LinkAsTransfer` and `pairWithinFile` do not compare currencies.
- Export: `All time` and `This year` end today, so future-dated entries are left out; the `time` column uses each entry's own timezone while the header names one; paging has no snapshot; account numbers are never stored so the column is empty.
- Migration 0028 uses `PRAGMA foreign_keys` inside a transaction (no effect); `source_record.import_batch_id`, `import_batch.format_id` and `import_batch.account_id` have no foreign keys.
- Startup wiring (`sweepImportOrphans`, `PauseInterruptedImports`, expired-file removal) has no test: cover it with the phone check or extract it with injected dependencies.
- Phone check: does RNFS `readDir` return the same path string that `save` returned? If not, the orphan sweep deletes every kept copy.
- Phone check: Kotlin `pickCsvDocument`, `createCsvDocument` and `displayNameOf` have only mocked tests.
- Several paused imports: the import flow offers only the newest (`LIMIT 1`); the others can be discarded from Imported files.
- Core export tests do not cover refund, adjustment, reversed or `AMOUNT_NOT_WRITABLE`.

## Deferred from: build of Story 10.1 (2026-11-22)

- source_spec: `spec-10-1-spike-s3-ocr-engine-choice-and-the-synthetic-receipt-set.md`
  summary: Synthetic set is clean: size tilted canvases from the rotated box, cover December and days 28-31, localise item names on Devanagari and Arabic receipts, commit the scorer.
  evidence: Edge-case and verification reviews of 10.1; real-photo accuracy stays unmeasured.
- source_spec: `spec-10-1-spike-s3-ocr-engine-choice-and-the-synthetic-receipt-set.md`
  summary: Story 10.6 must tune ONNX Runtime memory (about 1 GB native heap), choose where the 15.6 MB models live, and re-measure on a release build.
  evidence: docs/decisions/S3-ocr-engine.md sections 6 and 8. The spike harness is kept in the session scratch only.
