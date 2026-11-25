---
title: 'A receipt that matches an entry: Attach to it, Keep separate or Discard'
type: 'feature'
created: '2026-11-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2d4824a'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A receipt for a payment that is already recorded would be counted twice.

**Approach:** The review runs a dry run of the Story 3.1 matcher; a probable match shows `Matches ₹2,340 HDFC debit 6:12 pm` with `Attach to it` (per match, up to three), `Keep separate` and `Discard`, and Save is replaced until she picks. `AttachReceipt` adds the photo, a receipt source, the items and the splits to the existing entry in one transaction, with Undo.

## Boundaries & Constraints

**Always:** nothing is attached without a tap; the entry keeps its account, amount, time and status; a charge above the receipt becomes a `Tip / adjustment` split; Back, Cancel and failures write nothing.

**Never:** show the words Approve or Reject on the prompt; create a second confirmed expense without `Keep separate`.

</frozen-after-approval>

## Code Map

- `packages/core/src/capture/receipt/matchReceipt.ts` -- `RECEIPT_MATCH_SQL`, `previewReceiptMatches` (uses `matchItem`, up to 3)
- `packages/core/src/capture/receipt/attachReceipt.ts` -- `AttachReceipt`, `UndoAttachReceipt`
- `packages/core/src/capture/submitCapture.ts` -- `keepSeparate`; the matcher now sees a capture's real source and the 0 to 30% receipt window from both sides
- `packages/core/src/capture/resolveDuplicate.ts` -- Merge moves receipt items with the splits (and Undo moves them back)
- `apps/mobile/src/features/receipt/ReceiptReviewScreen.tsx`, `receiptApi.ts` -- prompt, replace-items sheet, toasts
- `features/activity/HeldRowActions.tsx`, `ReviewQueueScreen.tsx` -- `Keep separate` when one side is a receipt

## Tasks & Acceptance

**Execution:**
- [x] Core preview, `AttachReceipt` and Undo, `keepSeparate`, matcher source mapping, Merge moves items, review prompt, label, tests

**Acceptance Criteria:**
- Given a ₹2,340 receipt and a ₹2,340 HDFC debit from the same shop, the review shows the prompt; `Attach to it` keeps the debit's account, amount, time and status.
- Given a generated mix of sources and times, a receipt never leaves two confirmed expenses unless `Keep separate` was chosen.

## Implementation Notes

Behaviour changes worth knowing: `SubmitCapture` now compares a capture by its real source (bank, card, UPI, SMS count as a charge; manual, receipt, CSV as themselves) and, for a receipt or a charge, looks at amounts within the 0 to 30% window; before, every capture compared as `manual` at the same amount. The property test caught this. A receipt now also matches a manual entry within a day, not only within 10 minutes. Not built: the `Attach photo only` and `Splitting ...` attach mode (Story 10.9 uses `AttachReceipt` with `photoOnly` and `RECEIPT_EXCEEDS_ENTRY`); the receipt thumbnail on the review; a phone check. The undo token lives in memory on the toast: after the toast is gone Undo is no longer offered.

## Spec Change Log

## Review Triage Log
