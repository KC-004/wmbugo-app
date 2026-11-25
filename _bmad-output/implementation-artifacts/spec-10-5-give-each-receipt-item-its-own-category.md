---
title: 'Give each receipt item its own category'
type: 'feature'
created: '2026-11-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b21ceae4749fcb1cde8e69d5a46e2a3f298e0729'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A receipt's items all land in one category, and a misread item cannot be corrected.

**Approach:** Expand `Items (N)` into item rows with a category chip, a TalkBack `Change category` action, edit, remove and add; the allocation reruns; save reports only the items the person chose (event `ReceiptItemCategorised`); the saved entry's detail lists the items read-only.

## Boundaries & Constraints

**Always:** items still following the main category move with it; Add an item only while Not itemised is above zero; an item the person did not choose emits no event.

**Never:** put an amount or a shop in the event; edit saved receipt items (not in this story's built scope, see notes).

</frozen-after-approval>

## Code Map

- `apps/mobile/src/features/receipt/receiptReviewModel.ts`, `ReceiptReviewScreen.tsx` -- item edit, remove, add, category
- `packages/core/src/capture/receipt/saveReceipt.ts`, `writer/events.ts` -- event per chosen item
- `packages/core/src/capture/receipt/readModel.ts`, `apps/mobile/src/features/activity/ReceiptItemsList.tsx` -- detail Items (N)

## Tasks & Acceptance

**Execution:**
- [x] Model, screen, event, read model, detail list, tests

**Acceptance Criteria:**
- Given a Groceries 37.80 / Household 16.20 receipt saved, then spending by category uses those split amounts.

## Implementation Notes

Not built: `Edit items` from the saved entry's detail (it needs an update use case for saved receipt items) and opening the Story 3.7 split editor from the detail was not touched (it already shows a Not itemised split as a grey row). Add an item is only offered for a read-in-progress receipt.

## Spec Change Log

## Review Triage Log
