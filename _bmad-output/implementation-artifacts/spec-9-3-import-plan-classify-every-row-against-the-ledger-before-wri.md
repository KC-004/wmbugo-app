---
title: 'Story 9.3: Import plan: classify every row against the ledger before writing'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

## Intent

**Problem:** Before anything is saved, Sara needs to see which rows are new, which the ledger already has, which might be duplicates and which look like transfers.

**Approach:** `planCsvImport(rows, context)` is pure: it gives every validated row one class (`new`, `already_recorded`, `possible_duplicate`, `transfer_pair`, `held_pair`, `edge_day_review`, `previously_rejected`, `previously_deleted`, `foreign_currency`, `error`) with the evidence. `loadImportPlanContext` reads what the plan needs in a few read-only queries (fingerprints in chunks, confirmed entries around the file's dates, entries on the edge days, tombstones). The existing Story 3.1 matcher does the duplicate, transfer and held-pair decisions; the plan adds the CSV source fingerprint, the in-file transfer pairing, the edge-day rule and the removed-before rules.

## Boundaries & Constraints

**Always:** an exact fingerprint match wins over every other rule, including the edge-day rule; nothing is written; rows of one file never match each other; a row is compared with the few existing entries of its amount (and reference), not with all of them.

**Never:** merge or drop a row silently; convert a foreign amount.

## Tasks & Acceptance

- [x] `capture/csv/plan.ts` -- `csvFingerprint` (reference form, or account + date + direction + amount + description + occurrence), `planCsvImport`, in-file transfer pairing (equal and opposite, different owned accounts, at most two days), edge days, progress every 250 rows
- [x] `capture/csv/planContext.ts` -- `loadImportPlanContext`, `fingerprintsOf` (the numbering 9.4 commits under)
- [x] `capture/csv/plan.test.ts` -- 19 tests: the PRD fixtures (two identical PRET A MANGER rows and the overlapping file; a 200-row file planned twice; bank 500 out and card 500 in; the January rejection purged after 90 days and the May row), every class, a 5,000-row file against 10,000 ledger entries inside 3 s

## Implementation Notes

- The fingerprint a row is planned under is the one `SubmitCapture` receives as `submissionId` in 9.4, so what is committed is exactly what the next plan finds. `fingerprintsOf` and the plan share the numbering.
- A removed entry that is still in the ledger (deleted, rejected or excluded, before its purge) is read through its source fingerprint: `deleted` is `previously_deleted`, `rejected` and `excluded` are `previously_rejected`. A purged one is read through the tombstone hash (the Story 3.12 salted hash).
- `reversal_or_refund_of` from the matcher has no class of its own in this story, so it is a `held_pair` with the Story 3.1 question.
- Only `confirmed` entries are compared by the matcher, as in Story 3.2; entries still waiting for review count only for the edge-day rule (they are on that day).
- A repeated reference inside one file gives two rows the same fingerprint: both are `new` in the plan and 9.4's idempotent commit (`ALREADY_SUBMITTED`) keeps one.
- The account column's `Don't import these rows` rows are not in the plan.
- Matching against entries 3 days either side is the load window; a transfer partner further away is not found (the CSV window is 2 days).

## Verification

core jest passes (19 new, 93 in `capture/csv`); `tsc` and ESLint clean.
