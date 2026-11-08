---
title: 'Story 1.13 - Add sheet: record a first expense in about six seconds'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'eef05ae'
---

## Intent

Implements the epic's Story 1.13 acceptance criteria (see epics.md).

## Implementation Notes

- Migration 5 (journal index 4) creates `category` and `split` (S2 sections 4.4 and 4.5) and seeds the 14 expense and 6 income categories with their `cat-*` colour, icon and need/want type. `SEED_CATEGORIES` in core is the single source; a test compares the migrated rows with it.
- Core `ledger`: `RecordManualEntry` (one confirmed expense or income, one posting of the right sign, one split equal to the amount, audit + `TransactionsChanged`, in the writer's one transaction; with no account it creates `Cash` with balance not set in the same save), `RemoveEntry` (Undo: `removal_kind = deleted`, audit row), the `entryShape` invariant, default-account rule (last used with the category, else most recently used, else the first), category ranking by use count (seed order for a new profile; recalculated at most once a day and only when the sheet opens), keypad rules (`applyKey`: third decimal blocked not rounded, no decimal for 0-exponent currencies, leading zeros collapse, 12 integer digits max), `instantFromLocal`.
- Account balances now ignore removed entries (`ACCOUNT_LIST_SQL` joins `transaction` and skips `removed_at`).
- Mobile `features/add`: `AddSheet` (Expense/Income segments, quick chips + More, account chip that follows the category until the user picks one, typed amount as a polite live region read as "12 point 50 Singapore dollars", 56dp keypad with locale decimal key, long-press Delete and Clear, hardware number keys and Backspace through a hidden input that keeps the soft keyboard closed, optional merchant/date/time/note/payment method, `Error: amount required` with focus back to the amount, double-tap guard, `Save` and `Save & add another`, toast `Saved` + Undo), `Keypad`, `addApi` (real ledger-backed api and a daily rank cache), `categoryIcons`.
- Draft (amount, type, category) lives in the Zustand `uiStore` only, restored on reopen, discarded by Save and Clear.
- The Add sheet's Save row is a fixed bar under the scrolling content, so Save stays on screen with the keypad open.

## Verified on the Redmi

- Migration 5 applied on the existing database; the Add sheet opens from ＋ with Expense selected, quick chips (Food & Drinks, Groceries, Transport, Housing, Bills & Utilities, Shopping, More), the existing account chip and the keypad. By hand: type 12.50, Food & Drinks, Save (visible in the fixed bar), toast Saved with Undo, Undo all worked.

## Not done / open

- Transfer is not a segment yet and Income entries are recorded but have no screen to see them until Story 1.14; Transfer arrives with Story 1.15 (the epic lists three segments; only Expense and Income exist here).
- Merchant is stored as text in `transaction.original_description` for now; the `merchant` table and `merchant_id` arrive with the learning epic.
- Date and time are two text fields (`YYYY-MM-DD`, `HH:MM`) because no picker library is chosen; they are only sent when edited.
- Spoken amount uses the currency's full name ("Singapore dollars"), not "dollars" as the epic example reads.
- Hardware-key input could only be covered by unit tests (no keyboard attached to the phone).
- The p95 < 500 ms save target was not measured on the device in this story.

## Review Triage Log

Inline self-review plus real-SQL tests plus device. Fixed: (1) high - on the phone the Save buttons sat below the keypad, off screen, which defeats the six-second flow; moved to a fixed bar. (2) medium - the account balance query counted removed entries, so Undo would not have restored the balance; it now skips removed ones (tested). (3) low - copy catalogue rules (all-caps format hints, lower-case spoken label) adjusted.
