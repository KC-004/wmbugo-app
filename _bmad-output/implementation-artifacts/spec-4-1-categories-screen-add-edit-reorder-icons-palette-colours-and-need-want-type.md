---
title: 'Story 4.1 - Categories screen: add, edit, reorder, icons, palette colours and Need/Want type'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: 'cf867af1752828f77d11272387bdbd427ab6981c'
story_key: '4-1-categories-screen-add-edit-reorder-icons-palette-colours-and'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Implements the epic's Story 4.1 acceptance criteria (see epics.md) and PRD CAT-001, CAT-002, CAT-006, J-FUEL (category creation).

</frozen-after-approval>

## Implementation Notes

Plan (decided during investigation, no open questions):

- Core `ledger/categories.ts`: `CATEGORY_COLOURS` (the 12 `cat-*` tokens), `validateCategoryName` (trim, 1-30 chars), `SaveCategory` (add or edit by id; unique among active categories of the same kind, case and spaces ignored; subcategory takes parent's colour/type as defaults and parent's kind; one level only; `Uncategorised` is read-only; `Other` keeps name/kind but its colour stays the neutral fallback), `MoveCategory` (up/down among siblings of the same kind, subcategories travel with their parent), `CategoriesChanged` event in the catalogue (areas ledger, budgets, insights, home), and `spendingByBudgetType(period)` SQL/query so a type change re-buckets every period with no amount touched.
- Migration 0012 (custom): seeded Family and Other get `budget_type = NULL` so they read `Not classified`. `SEED_CATEGORIES` follows.
- Mobile: Settings hub gains the `Money` group (live summary `N categories`) opening SCR-18 Categories inside Settings (segments Spending / Income, rows with 40dp chip, caption Need/Want/Not classified, indented subcategories, `Add category`, Move up / Move down buttons plus TalkBack custom actions). Category sheet: Name, searchable icon grid, 12 colour radios, Type, Subcategory of. Toast `Fuel added`.
- Copy catalogue gets a `categories` block; all strings from it.

## Deviation

- Reordering uses Move up / Move down buttons and TalkBack custom actions only; there is no drag handle (the AC allows any of the three).
- A subcategory's parent is chosen when adding; an existing category cannot be re-parented in this story.
- Review: the independent Blind Hunter subagent layer was skipped (subagents were not authorised for this run); verified by lint, typecheck, 502 core tests and 998 mobile tests. Epic-level independent review still applies at the end of Epic 4.
- Not checked on a device with TalkBack. The Add sheet More list uses the new order through the same sort_order query, but no Add-sheet test was added for it.
