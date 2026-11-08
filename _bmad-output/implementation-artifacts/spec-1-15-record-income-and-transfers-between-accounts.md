---
title: 'Story 1.15 - Record income and transfers between accounts'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '7fbdbea'
---

## Intent

Implements the epic's Story 1.15 acceptance criteria (see epics.md).

## Implementation Notes

- Income already wrote through `RecordManualEntry` (Story 1.13); this story adds the third segment and the screen behaviour: the three segments are a radio group "Entry type" with each option read "Option N of 3" (vertical list at fontScale 1.3), the amount is kept when switching, income categories show, and the account chip reads "Received in".
- Core `RecordTransfer`: one `transfer` transaction with -amount on From and +amount on To (no split), so it is neither income nor expense; `SAME_ACCOUNT`; archived/missing account checks; optional fee saved in the same commit as a separate confirmed expense from From (category chosen, default Other); with the setting `finance.block_transfers_above_balance` on, an amount above From's known asset balance returns `INSUFFICIENT_FUNDS` (an unknown balance is never treated as zero). The `entryShape` invariant now also asserts a transfer is two postings that sum to zero.
- Activity shows a transfer as one row "DBS → Cash" with the transfer icon, unsigned and neutral; it is not in the day's Spent or Home's Spent.
- Add sheet: Transfer shows From and To pickers (To lists the other accounts; with fewer than two accounts it offers `+ New account`, which closes the sheet and opens Accounts), announces "Transfer selected. From and To accounts shown", an optional fee field with fee category chips, inline `Choose two different accounts`, a non-blocking warning when the amount is above the balance on record (the next Save proceeds), and the blocked message from the writer. Undo removes the transfer and its fee.

## Not done / open

- The setting `Block transfers above the balance` is read here but has no switch yet; Story 1.16 adds it to Settings > You (the shared key is `SETTING_BLOCK_TRANSFERS`).
- The To picker lists accounts as chips (no search); fine for a handful of accounts.
- Credit-card payments (transfer into a card) work as ordinary transfers; a card as the From account is never balance-checked.
- Fee text is parsed with the profile's decimals; there is no keypad for it.

## Verified on the Redmi

- A transfer saved from the Add sheet appeared in Activity as one neutral row with no minus sign, and Home Spent this period did not change.
