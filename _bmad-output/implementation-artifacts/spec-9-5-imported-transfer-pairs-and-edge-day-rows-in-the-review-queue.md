---
title: 'Story 9.5: Imported transfer pairs and edge-day rows in the review queue'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

## Intent

**Problem:** A card payment that left one account and arrived on another must not count as spending plus income, and rows from a half-covered day must be looked at, not doubled or lost.

**Approach:** Core use cases `LinkAsTransfer`, `KeepSeparate`, `LinkEdgeDayRow` and `UndoImportReview` (each stores what it changed on the review candidate, so Undo is exact), then two new review-queue cards, the same choices on the entry detail (the durable path), and the `Check` tag on Activity rows.

## Boundaries & Constraints

**Always:** the transfer is made through `SubmitCapture` (LIR-06) in the same transaction that excludes the legs, so Spent this period and both balances change together; Undo restores both legs, their statuses, sources and the open candidate exactly; hidden amounts mask the spoken sentence.

**Never:** merge anything silently; offer Keep both / Merge on a row whose question is not a duplicate.

## Tasks & Acceptance

- [x] `capture/csv/importReview.ts` -- the four use cases and `EDGE_DAY_ENTRIES_SQL`
- [x] `capture/statusLabel.ts` -- states `possible_transfer` and `partly_covered_day`, both reading `Waiting for you`; `captureStateOf` takes the open reason
- [x] `ledger/readModels.ts`, `ledger/activitySearch.ts`, `ledger/editCommands.ts` -- Activity rows and the Check/Waiting filters know the two new reasons; the entry detail carries `openReview`
- [x] `features/activity/ImportReviewCards.tsx`, `reviewParts.tsx`, `ReviewQueueScreen.tsx`, `reviewApi.ts` -- the cards, their Undo toasts, the durable path on `TransactionDetailScreen`, the one-node spoken sentence
- [x] tests: 11 in `importReview.test.ts` (including a link-then-Undo identity property), 9 in `reviewQueue.test.tsx`, 3 in `transactionDetail.test.tsx`, a row-state case

## Implementation Notes

- `LinkAsTransfer` excludes both legs first, then asks `SubmitCapture` for the transfer, so a balance check sees the money as it will be. The transfer carries one source record of its own (`link-<leg>-<leg>`) besides the two it takes over; Undo deletes it with the transfer.
- `KeepSeparate` also resolves the other leg of a pair that sits inside one file, so nothing is left asking the same question.
- The status label test now allows two states to share a label key (`possible_transfer` and `partly_covered_day` both read `Waiting for you`), as the spec asks; every key is still used.
- `It's already here` on a row with several entries that day asks which one (chips) or to skip the row; with one entry it links at once, with none it skips. From the detail screen it skips (the list of entries is in the review queue).
- A `Check` row from these reasons shows no Keep both / Merge footer; the spoken label says `check it` and not `possible duplicate`.

## Verification

core jest 1,219 and mobile jest 2,647 pass; `tsc` and ESLint clean.
