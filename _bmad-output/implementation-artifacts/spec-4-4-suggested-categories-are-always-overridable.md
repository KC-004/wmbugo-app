---
title: 'Story 4.4 - Suggested categories are always overridable'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'oneshot'
baseline_commit: '570165c'
story_key: '4-4-suggested-categories-are-always-overridable'
---

## Intent

Implements the epic's Story 4.4 acceptance criteria (see epics.md) and PRD CAT-005 (per-transaction override and the correction hook; the rule editor SCR-25 is Phase 2).

## Implementation Notes

- Migration 0014 adds `transaction.category_guessed` (0/1, default 0) and `transaction.category_set_by` (`user` or `suggester`). It backfills the old derived state: `auto_approved` entries with a category become guessed, and every other categorised entry becomes user-set. Do not edit 0014 after it has been installed on a device (the runner refuses a changed checksum).
- Port `CategorySuggester` (`ports/categorySuggester.ts`): `suggest(facts)` returns `{categoryId, reason}` or null; the default `noSuggester` returns null. `createSubmitCapture({ suggester })` builds the pipeline; `SubmitCapture` is the default one. The suggester is asked only for a non-manual entry that arrives with no category (Uncategorised). A suggestion for a missing, archived or wrong-kind category is ignored. A manual save is always `category_set_by = user` and is never asked.
- `EditTransaction` (category changed), `SetSplits` (categories changed) and `BulkRecategorise` set `category_set_by = user` and clear `category_guessed`. `CategoryAssigned` now carries optional `previousCategoryId` and `wasGuessed` (the learning hook); actor comes from the writer (`user`). Edit snapshots carry both fields, so Undo restores the guess exactly (also bulk Undo).
- `ConfirmCategory` (`Looks right`): clears the guess, keeps the category, marks it user-set, emits `CategoryAssigned` with the same category and `wasGuessed = true`. `NOT_GUESSED` when there is nothing to confirm.
- `ApplySuggestion` is the automatic-step entry point (re-classification, later learners): the writer refuses with `CATEGORY_USER_SET` when `category_set_by = user`; otherwise it sets the category as a guess. `MergeDuplicate` never swaps a category on its own (it already required the user's choice when categories differ); the choice it applies is now marked user-set.
- Activity `guessed` row state, the `guessed` filter and the `Recorded · category guessed` status read the new column instead of the old `auto_approved` inference.
- Mobile: transaction detail's Category row opens a category picker (only categories that fit the entry); saving shows `Saved` with Undo. A guessed entry shows `Looks right` under the Category row. A removed, reversed or split entry has no tappable category (split entries change in Split). Settings > Money has no rules entry (tested).

## Deviation

- Approving a pending capture in the review queue no longer clears the guess (it used to, because the guess was inferred from the resolution). The guess clears only when the user confirms or changes the category.
- No real suggester exists yet (Epic 11); the behaviour is tested with a fixture suggester.
- Not checked on a device with TalkBack.
