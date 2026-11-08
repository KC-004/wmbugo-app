---
title: 'Story 2.4 - Starting balance and tracking date'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '85504b2'
---

## Intent

Implements the epic's Story 2.4 acceptance criteria (see epics.md). Also folds in a user request made while building it: one consistent top header on every page.

## Implementation Notes

- Core `ledger/accountBalanceCommands.ts`:
  - `SetStartingBalance`: for an account with no balance, the user says what is in it today; the opening is worked out as today's balance minus the postings that count since the account was opened (₹1,550 today with ₹450 of later expenses writes an opening of ₹2,000). One `opening_balance` transaction with one posting, effective at the account's opening instant (its creation time), with audit and `AccountsChanged` + `TransactionsChanged`. A card takes the amount owed (stored negative, AD-5). Zero is valid and clears "not set" without needing a transaction. An account that already has a balance is refused (`ALREADY_SET`); nothing edits an existing opening amount.
  - `ChangeTrackingDate`: moves the opening instant to the start of a local day in the profile timezone (the opening transaction moves with it); the opening amount is unchanged; the audit row carries `trackingFrom` and `trackingTo`; a future date is `DATE_IN_FUTURE`.
- A source-scan test asserts that only those two use cases write `opening_effective_at` on an existing account, so capture, import and migration cannot move it (the AC's "use case registry" test).
- LIR-08 test: after `SetStartingBalance` and a new account with an opening, Spent, income and Activity are all empty.
- Mobile account detail: `Set balance` (a card: `Set amount owed`) opens an inline panel (`What's in it today?` / `How much do you owe today?`, "Rough is fine" hint), `Error: amount required` keeps the input, bad numbers use the existing calm errors. A set account shows `Tracking since 1 Nov` with `Change`, which opens a date field; a future date shows `Error: choose today or an earlier date`. The starting balance row is read-only with `To correct it, use Adjust balance`. After a save the list, Home and the detail refresh through `AccountsChanged`.
- Consistent header: `ScreenHeader` now serves every page. Tabs show title + Accounts + avatar; pages opened from them (Accounts, Add account, Account detail, Settings and its sub-pages) show a Back arrow, the title and any action in the same 64dp row with the same 16dp side padding, so titles and icons no longer shift between pages.

## Deviation

- The AC says `Edit` › `Tracking since`. There is no Edit screen yet, so Tracking since lives on the account detail until Story 2.9 builds one.
- An opening can come out negative for an asset when the user enters less than what was spent since (for example ₹100 today after ₹450 of expenses on ₹0). It is accepted (rough is fine) rather than refused.

## Not done / open

- Date entry is typed (yyyy-mm-dd), not a date picker; the Add sheet does the same.
