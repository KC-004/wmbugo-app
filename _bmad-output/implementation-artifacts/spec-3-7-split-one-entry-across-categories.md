---
title: 'Story 3.7 - Split one entry across categories'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'oneshot'
baseline_commit: '327c530'
---

## Intent

Implements the epic's Story 3.7 acceptance criteria (see epics.md) and PRD TXN-009, FIN-022, LIR-02.

## Implementation Notes

- Core `ledger/splits.ts`: `SetSplits` replaces an expense's or income's splits in one writer transaction (audit, `TransactionsChanged`, `CategoryAssigned` when the categories change) and returns the state before for Undo. The rows must add up exactly to the amount; a direct call whose rows do not returns `SPLITS_DONT_SUM` and writes nothing. An amount change goes in the same call, so it commits only together with balanced splits (`1,264 -> 1,300` leaves ₹36 to assign until the rows are fixed). One row left is a single split for the full amount. It also refuses no rows, a zero or fractional row, an unknown or wrong-kind category, a transfer and a removed entry. The writer's `entryShape` invariant (splits equal the amount) is the second line of defence (tested with a use case that tries to break it).
- Helpers, all in integer minor units: `leftToAssign`, `remainderOf`, `allocateProportional` (largest remainder; property test that parts always sum to the total, in 2, 0 and 3 decimal currencies), `reconcileReceiptTotal` (items + tax + fees - discounts - adjustments, exact), and `notItemisedSplit` (a shortfall becomes one Uncategorised split flagged `not_itemised`, counted as assigned; fixture now, receipts arrive in Epic 10).
- `EditTransaction` now lets a split entry change its account, date, merchant, note and payment method, but not its amount or category (those go through `SetSplits`; `NOT_EDITABLE`).
- Reads: Activity rows carry `splitCount` and list the largest split's category (`Groceries + 1 more · HDFC`); the detail shows `Groceries + 1 more` and each split with its amount; a category filter and a filtered day's Spent use each split's own amount (Story 3.6 `matchedMinor`).
- Mobile: `Split` on the detail opens the split editor as a sheet: rows (a category chip that opens the category list, and an amount), `Add a row`, `Remove`, `Left to assign ₹1,264` as a polite live region read after 500 ms of quiet, `Fill` (the remainder to the focused row, or the last; labelled `Fill: assign ₹264 to Personal Care`), `₹X too much` with a warning icon, Save disabled but focusable with the hint `Assign the remaining ₹X to save`, and a grey `Not itemised` row that is not editable and counts as assigned. Save toasts `Saved · Undo`. Editing the amount of a split entry in the edit sheet hands over to the split editor with the new total.

## Deviation

- The Fill button is a styled pressable (not the shared Button) so its visible text is `Fill` while its TalkBack label carries the amount and category.
- Spoken amounts in the live region and hint use the spoken form (`264 rupees`), not the symbol.
- Category totals in Insights are not built yet; the per-split amounts are what they will read.

## Not done / open

- Not checked on a device with TalkBack.
