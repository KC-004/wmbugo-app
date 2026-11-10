---
title: 'Story 3.10 - Review queue: one list of everything to check'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: '3c12d96'
---

## Intent

Implements the epic's Story 3.10 acceptance criteria (see epics.md) and PRD TXN-008, TXN-013, FIN-024, FIN-027.

## Implementation Notes

- Core `capture/reviewQueue.ts`: `TO_CHECK_SQL` (the one definition of the `needs_review` set, newest first; its count is the Activity tab dot), `REVIEW_SIDE_SQL` for the "Already recorded" side, `NEEDS_CATEGORY_SQL` (confirmed entries with `needs_category`, never counted), mappers, `sourceWords`. `ApproveCapture` sets `confirmed` with `capture_resolution = user_approved` and closes the open candidate (refuses duplicates: use Keep both / Merge; refuses foreign captures: they need an amount). `ConfirmForeignAmount` writes the profile amount, the posting and the split from the typed amount; the foreign amount stays as source metadata; no rate is fetched. `UndoReviewDecision` restores the snapshot and reopens the candidate. The `entryShape` invariant allows a waiting foreign capture with no posting.
- Mobile: `ReviewQueueScreen` (route `ReviewQueue`, opened by tapping a Check or waiting row in Activity, scrolled to that item) under `N to check`; duplicate cards show This entry / Already recorded side by side (stacked at fontScale 1.3) with Keep both, Merge and Delete or Reject · Not mine; pending captures offer Approve, Edit, Reject · Not mine; foreign items show `USD 12.99`, `Amount charged in ₹`, and Confirm disabled with `Enter the amount in ₹ to confirm`; an `Add a category` section; `All checked` for 4 s after the last item, and the boat with `You're all caught up · Smooth sailing` when empty. Every action toasts with Undo and refreshes the dot and totals.

## Deviation

- The held transfer-or-reversal pair question (Story 3.1) is not built: nothing persists such a pair yet, so there is no item to render.
- Pending and foreign captures are exercised through a core test fixture only; no capture source exists until Epic 11.
- Confirming a foreign amount uses the first active account (there is no account picker on the card yet).
- The Edit action opens the entry's detail.
- Dates on the cards use the device time zone.
- "All checked" is a static boat; no animation or reduced-motion variant yet.

## Not done / open

- Not checked on a device with TalkBack.
