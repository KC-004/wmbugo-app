---
title: 'Story 3.4 - Transaction detail: edit, duplicate, delete or reject'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'ed10f4c'
---

## Intent

Implements the epic's Story 3.4 acceptance criteria (see epics.md): open any entry, see everything about it, change or remove it, with a way back.

## Implementation Notes

- Core `capture/snapshot.ts`: `snapshotTx` / `restoreTx` copy and restore one transaction with its postings, splits and source links; Story 3.3's Keep both / Merge now use it too.
- Core `ledger/editCommands.ts`:
  - `EditTransaction`: amount, category, account, date, merchant, note and payment method of an expense or income, or the amount, either side, date and note of a transfer, in one writer transaction (transaction, postings and its single split together), with an audit row naming the fields, `TransactionsChanged`, and `CategoryAssigned` (new catalogue event, actor `user`) when the category changed. It returns the state before; an entry with several splits is not editable here (`NOT_EDITABLE`). Refuses an empty or invalid amount, an unknown or wrong-kind category, an unknown or archived account, `SAME_ACCOUNT`, and a removed entry (`ENTRY_REMOVED`) without writing.
  - `DeleteEntry` (manual only): `status = excluded`, `removal_kind = deleted`, `removed_at` set, out of every total and list; a captured entry returns `USE_REJECT`. `RejectEntry` (captured only): `excluded`, `capture_resolution = rejected`, `removal_kind = rejected`, `CapturesRejected`; a manual entry returns `USE_DELETE`. Opening balances and adjustments are `NOT_REMOVABLE` here.
  - `RestoreTransaction`: Undo for all three; every value goes back exactly (tests compare the table dumps).
  - `TRANSACTION_DETAIL_SQL` / `mapTransactionDetail`: what the page shows.
- `SubmitCapture` accepts `copiedFrom`, so an entry made by Duplicate is never held against the entry it was copied from (but is against another).
- Activity rows carry `captured` (a non-manual source).
- Mobile: transaction detail (new route; tapping a row in Activity or an account timeline opens it): category chip, title, amount in `headline` (unsigned expense, `+` income, transfer neutral), rows Type, Date, Account (or From → To), Category, Merchant, Note, Payment method, Status (the Story 3.2 vocabulary) and Source (`Added by you · 7 Nov, 9:12 pm`); one TalkBack node for the header; actions `Edit`, `Duplicate` and `Delete` (or `Reject · Not mine` for a captured entry, never the word Delete). Delete and Reject toast `Deleted` / `Rejected` with Undo and go back. If the entry was removed meanwhile, Edit and Delete show `This entry was removed. Nothing was changed.` and write nothing.
- The Add sheet has an edit mode (type fixed, no Save & add another, all fields filled, `Saved · Undo` restores the snapshot, inline `Error: amount required`, `Choose two different accounts`, removed-entry message) and a copy mode (amount, category, account, merchant and note copied, date and time now).
- Activity rows now have TalkBack custom actions `Recategorise` (opens the editor) and `Delete` (or `Reject · Not mine`), doing the same as the detail page with the same toasts.

## Deviation

- A transfer edited to the same account on both sides is refused by the core (`SAME_ACCOUNT`, tested); in the sheet the To account moves away by itself when it is chosen as From, so that state cannot be reached from the screen.
- An entry with several splits (Story 3.7) is not editable here; opening and deleting it work.
- "Recategorise" opens the full editor rather than a category-only chooser.

## Not done / open

- Device check of the edit mode keypad and TalkBack actions beyond what the user taps through.
