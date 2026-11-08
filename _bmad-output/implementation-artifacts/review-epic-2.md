# Epic 2 independent review

Three read-only reviewers (ledger correctness, mobile UI and accessibility, spec-versus-implementation) went over 74ec95f..13aaa51. Everything below was fixed in the review commit unless marked.

## Fixed

| # | Finding | Fix |
|---|---|---|
| L1 | A bank account left out of totals, then changed to a card, vanished from Card dues for good (the switch is refused on cards). | Changing to a card sets it back to counted. |
| L2 | Editing only the card limit restarted "paid" on the statement, so the sheet could ask the user to pay twice. | `statement_set_at` moves only when the statement amount or due date changes. |
| L4 | Moving the tracking date changed the opening transaction without touching or announcing it. | The transaction is touched, its timezone is updated and `TransactionsChanged` is emitted. |
| L5 | Adjust balance dropped a note for any reason but Other, and accepted archived accounts. | The note is kept with every reason; archived accounts are refused (`ACCOUNT_ARCHIVED`). |
| L6 | `RestoreAccount` on an active account reshuffled it. | It does nothing for an active account. |
| L7 | A card changed to another type kept its old statement and limit. | They are cleared. |
| U1 | Panels needed two taps with the keyboard open (account page, accounts list). | `keyboardShouldPersistTaps="handled"`. |
| U2 | Double-tapping Archive, Restore or Delete ran twice (two screens popped, two toasts). | Busy guards; the panel closes first. |
| U3 | A failed Undo (adjust, archive) said nothing. | Checks the result and shows the calm failure toast. |
| U4 | The "more than you owe" note stayed after lowering the amount or switching type. | Shown only for the amount it was raised for, on a transfer. |
| U5 | Archived rows could hide Open and Restore from screen readers. | Added accessibility actions. |
| U6 | Spoken "up"/"down" and the delete failure text were not from the catalogue. | Moved to `copy.ts`. |
| U7 | The account page was blank when no profile could be read. | Shows the error block. |
| S1-S3 | Untested: archiving leaves a needs-review entry alone; In credit on the list; group-header TalkBack label. | Tests added (plus one per fix above). |

## Left as is (decided, not forgotten)

- Paid status counts any transfer onto the card since the statement was entered (a transfer from another card also counts). A heuristic, noted in Story 2.6.
- Net worth leaves a card's credit out (the credit is shown apart, never subtracted from dues).
- `payBillPreset` has unit tests for its two pure helpers but no test against a database; a stored-sort-order collision after Move makes "previous place" approximate.
- Loading, error and Retry states of the accounts list and the account page, and fontScale 1.3 stacking, have no dedicated tests; none was measured on a device.
- The AC's `balance not set` (lower case) versus the catalogue's `Balance not set`: the catalogue form is used everywhere.
- Edit is spread across the list's edit mode and the account page until a single Edit screen exists (disclosed in Stories 2.3, 2.4, 2.8, 2.9).
- Setting the preset draft clears an unrelated Add draft after a preset save (minor).
