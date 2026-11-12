---
title: 'Story 4.3 - Archive and merge categories with a remap preview'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'oneshot'
baseline_commit: '3bea634'
story_key: '4-3-archive-and-merge-categories-with-a-remap-preview'
---

## Intent

Implements the epic's Story 4.3 acceptance criteria (see epics.md) and PRD CAT-004.

## Implementation Notes

- Core `ledger/categoryArchive.ts` (no migration; `category.archived` already exists): `ArchiveCategory` (category and its subcategories, entries stay), `RestoreCategory` (old position kept because `sort_order` is untouched; `NAME_TAKEN` if another active category took the name), `DeleteCategory` / `UndoDeleteCategory` (only when no split at all uses it, deleted entries included, and no subcategory), `MergeCategory` / `UndoMergeCategory`, plus `previewCategory`, `categoryEntriesSql` (paged list), `typeChangeNote`, `mapOriginalCategories`.
- `MergeCategory` re-points every split of the category and its subcategories (split entries, refunds, entries to check, and deleted ones) to the target, archives the merged categories, writes an audit row per entry (`fromCategoryId`, `fromLabel`), and compares a fingerprint of every amount, split amount and posting before and after, returning `AMOUNTS_CHANGED` if anything differs. Events: `TransactionsChanged`, `CategoryAssigned`, `CategoriesChanged`. A property test proves the spending total never changes.
- Target rules: not itself, not its own subcategory, not archived, not `Uncategorised`; every entry type moved must fit the target kind (`CATEGORY_KIND_MISMATCH`). `Uncategorised` and `Other` cannot be archived, merged or deleted (`CATEGORY_READONLY`).
- Audit ids are written without dashes: the log redactor masks a digits-only part of a dashed id.
- Mobile: the category sheet (edit) gains `Archive`, `Merge into…` and, when nothing uses the category, `Delete`. `ArchiveSheet` shows `40 entries use Fuel.` (with subcategories when present), the paged entry list, `Keep them in Fuel` (default) or `Move them to another category`, the exact move sentence, the Need/Want/Not classified note when types differ, and `Confirm`. Toasts: `Archived Fuel`, `Moved 40 to Transport`, `Deleted Fuel`, each with Undo. SCR-18 has a collapsed `Archived (n)` section with `Restore`. The Activity filter lists archived categories under `Archived categories`. Transaction detail shows `Originally Fuel` (from the audit trail; an undone merge no longer counts).

## Deviation

- `The Fuel budget ends after this period.` in the preview is not built: budgets arrive in Stories 4.5 and 4.6, and Story 4.6 has its own acceptance criterion for it.
- `Originally Fuel` is a line under the entry's rows, not inside the Source block.
- Undo of a delete re-creates the category row with its saved fields (no soft-delete column exists).
- Not checked on a device with TalkBack.
