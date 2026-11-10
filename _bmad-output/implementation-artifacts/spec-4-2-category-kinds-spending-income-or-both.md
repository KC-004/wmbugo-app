---
title: 'Story 4.2 - Category kinds: spending, income or both'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: 'b7811de'
story_key: '4-2-category-kinds-spending-income-or-both'
---

## Intent

Implements the epic's Story 4.2 acceptance criteria (see epics.md) and PRD CAT-003.

## Implementation Notes

- Migration 0013 rebuilds `category` so `kind` accepts `mixed` (drizzle table rebuild; the migration runner already switches foreign keys off for rebuilds, as for 0006).
- Core `ledger/categories.ts`: `categoryFits(categoryKind, entryType)`, `kindsOverlap`, `kindsFor`. `SubmitCapture`'s manual entry, `EditTransaction`, `SetSplits` and `BulkRecategorise` use `categoryFits`, so a mismatch is `CATEGORY_KIND_MISMATCH` and writes nothing; bulk counts non-fitting entries in `won't change`. Refund and transfer-fee categories accept `expense` and `mixed`.
- `SaveCategory` now changes a top-level category's kind. Leaving a side that entries use (income: `income` entries; spending: `expense`/`refund` entries, subcategories included) returns `KIND_IN_USE:<side>:<n>` (parsed by `parseKindInUse`) and changes nothing. Subcategories follow their parent in the same transaction; an income parent clears their types. Names are unique across overlapping kinds (a Both name blocks the same name in either list).
- `MoveCategory` takes the list (`segment`) the user is looking at, because a Both category is in both lists.
- Mobile: category sheet has `Used for` (Spending / Income / Both) on top-level categories and hides Type for Income; the Spending and Income lists include Both categories (caption `Also income` / `Also spending`); Add sheet, transaction editor, split editor and review pickers use `categoryFits`. The block message reads `3 income entries use this category. Move them to another category first.`

## Deviation

- The `Refund for` picker already lists spending categories through the expense picker, which now includes Both categories; no separate change.
- `EditTransaction` on an entry that changed type is unchanged (type edits are not part of this story).
- Not checked on a device with TalkBack.
