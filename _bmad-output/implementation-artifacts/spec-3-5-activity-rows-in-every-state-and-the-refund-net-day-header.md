---
title: 'Story 3.5 - Activity rows in every state and the refund-net day header'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '2dee14b'
---

## Intent

Implements the epic's Story 3.5 acceptance criteria (see epics.md).

## Implementation Notes

- Core read model (`ledger/readModels.ts`): `activitySql(filter)` (an optional account filter honoured for both sides of a transfer; `ACTIVITY_SQL` is the unfiltered form) lists confirmed entries, entries waiting for review and reversed ones; `ActivityRow` carries the flags `held` (possible duplicate), `waiting`, `reversed`, `needsCategory`, `guessed`, `foreign` and `captured`; `rowState` maps them to the states of UX-DR29. `groupByDay` is the one place a day's Spent is computed: confirmed expenses minus refunds that day, floored at 0; transfers, income, waiting, possible duplicates, reversed and removed entries never count. Tests: the story's day (₹1,500 fuel, ₹1,299 refund, ₹5,000 transfer, ₹85,000 salary, ₹300 waiting) reads Spent ₹201; a refund-only day reads ₹0; the account filter limits rows and the day Spent.
- `REVIEW_COUNT_SQL` and `useReviewDot`: the Activity tab shows a small dot with no count while any entry waits, labelled `Activity, entries to check`, and loses it when none remain.
- Row (`ActivityRowView`), every state: confirmed expense, income (`+` in the income colour), refund (decorative 16dp return icon left of `+₹1,299`), transfer (unsigned neutral), `guessed`, `add category`, `waiting` and `currency` (dashed outline inset 4dp, 4dp corners; `USD 12.99` in the amount column for currency), possible duplicate (warning icon and a `Check` tag in the warning colour), `reversed` (title and amount struck through, secondary colour) and `before tracking` (the tag now replaces the Story 2.3 subtitle suffix). Tags are pills (fully rounded, 2 by 8dp, canvas fill, hairline border, wrapping after the subtitle with 4 by 6dp gaps) and are hidden from screen readers.
- TalkBack order: merchant, amount with direction (`spent 420 rupees`, `refund, plus 1,299 rupees`, `transfer 5,000 rupees`, `USD 12.99, waiting for currency`), category, account, tags (`possible duplicate, check it`), date; a Check row has the hint `Double-tap to review possible duplicate`.
- Tests render all 11 states at font scale 1 and 2, assert the TalkBack string and tags for each, and that no minus sign appears (explicit render tests rather than image snapshots).
- A Check row opens its detail, which shows `Possible duplicate — check it` with Keep both and Merge (Story 3.3); the detail read model carries `openDuplicate`.

## Deviation

- Image snapshot tests were replaced by explicit render assertions (text, tags, TalkBack string, styles) for every state at both font scales.
- Activity still pages with "Show earlier entries" over a growing limit (whole days are kept together), not keyset pages with infinite scroll; the 10,000-entry scrolling FPS measurement (Story 1.3 method) was not run. The existing 10,000-entry save benchmark is unaffected.
- `guessed`, `currency` and `reversed` rows exist only when a later source writes them; they are proved with core fixtures and render tests.

## Not done / open

- FPS measurement of Activity scrolling on the reference device (NFR-07).
