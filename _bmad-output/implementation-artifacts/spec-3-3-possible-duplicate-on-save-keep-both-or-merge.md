---
title: 'Story 3.3 - Possible duplicate on save: Keep both or Merge'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '0563b33'
---

## Intent

Implements the epic's Story 3.3 acceptance criteria (see epics.md) and PRD TXN-012 and FIN-027 (Merge).

## Implementation Notes

- Migration `0007_tan_toro` adds `review_candidate.undo_json` (a plain ADD COLUMN): what a resolution changed, so Undo can put every row back.
- Core `capture/resolveDuplicate.ts`:
  - `isAutoApprovable` is false for any entry with an open duplicate candidate (and for one that needs a category); reused by Epic 11.
  - `KeepBoth`: the held entry becomes `confirmed` / `user_approved`, the candidate is resolved, audit and `TransactionsChanged`; both entries count.
  - `MergeDuplicate`: the survivor is the higher source authority (bank/card/UPI evidence 4, CSV 3, receipt 2, manual 1; between equals the already confirmed entry), the other record becomes `excluded` with `removal_kind = excluded` (hidden from Activity, totals and every list) with an audit row; every `source_record` follows the survivor; a receipt's items become the survivor's splits with any extra the bank charged as a `Tip / adjustment` split in the receipt's main category; between two ordinary entries the category is the confirmed entry's unless the user chose (`CATEGORY_REQUIRED` when they differ and none was chosen). The `entryShape` invariant now skips an `excluded` record (it has given its splits away).
  - `UndoDuplicateResolution`: restores both records, postings, splits, source links and the candidate exactly (property test over Keep both and Merge round trips, plus the receipt fixtures).
  - Fixtures from the story: a Rs 2,340 receipt paid with Cash with 14 item splits merged with a Rs 2,340 card SMS leaves one transaction on the card with the 14 splits, Cash not debited and both sources kept; a Rs 1,000 receipt merged with a Rs 1,150 card charge gives Rs 1,150 with a Rs 150 Tip / adjustment split and splits summing to Rs 1,150.
- Activity shows a held entry (`ActivityRow.held`) so the durable path exists; it is never in a day's Spent or any total.
- Mobile: the toast now supports choices. After a save that is a possible duplicate it reads `Looks like this is already recorded` with `Keep both` and `Merge` (10 s minimum like every toast, answers announced to TalkBack). `Keep both` gives `Kept both · Undo`; `Merge` gives `Merged · Undo`, first asking `Which category?` (both as chips, the confirmed entry's first and selected) when they differ. The flagged entry in Activity reads `Possible duplicate — check it` with the same two buttons (shared `useDuplicateChoices`).

## Deviation

- The durable path is the flagged row in Activity, not a transaction detail screen (detail arrives in Story 3.4); the buttons are on the row itself.
- Receipts and card SMS do not exist as sources yet (Epics 9 to 13), so the source-authority merge is proved with core fixtures that write those source records directly.
- The interim Story 3.2 behaviour (a plain Saved toast for a possible duplicate) is replaced by the choices.
- The toast for a possible duplicate has no Undo of the save itself (the story names only Keep both and Merge).

## Not done / open

- Verifying the merged-away record is hidden from Show rejected and Recently deleted waits for those screens (Story 3.13); it is excluded and removed, so the queries that will list them must filter `removal_kind = excluded`.
