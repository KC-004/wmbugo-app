---
title: 'Story 2.3 - Account detail and its timeline'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '379da3c'
---

## Intent

Implements the epic's Story 2.3 acceptance criteria (see epics.md).

## Implementation Notes

- Core `ledger/timeline.ts`: `ACCOUNT_TIMELINE_SQL` (entries that touched one account, newest first, paged by asking for one more than the page), `mapTimelineRows` (a transfer is one row per side, its far end in `accountName`, the signed effect in `signedMinor`; a split entry joins once per split and is read once), `ACCOUNT_START_SQL` (opening balance and tracking start, none when the balance was never set). The opening balance is not in the paged list; it is the footer row, shown once the last page is reached, so it is always last.
- "Before tracking started" is derived on read in SQL for both Activity (`ACTIVITY_SQL` gains one column; `ActivityRow.beforeTracking`) and the timeline. It never changes a balance (Story 2.1's rule) and the entry still counts in that day's Spent.
- Mobile: `ActivityRowView` is the Activity row, now shared by Activity and the timeline. `AccountDetailScreen` + `accountDetailApi`: header (icon in its colour, name, type, balance in `headline` from the same `ACCOUNT_LIST_SQL` figure as the list), `Move money` for assets (cards get theirs in Stories 2.6 and 2.7), day groups, `To Cash` / `From HDFC` on a transfer, `Starting balance ₹30,000 · 1 Nov` footer, empty state (`Nothing recorded on this account yet` + `Add an expense`), `Show earlier entries` paging.
- Add sheet takes a `preset` (kind + account): `Move money` opens as a transfer from this account with an empty amount (an old draft is ignored), `Add an expense` opens as an expense paid from it. `useOpenAdd(opener, preset)`.
- Navigation: `AccountDetail` route above the tabs; a row in the accounts list is now a button that opens it (not while renaming). The query key is `['ledger','account',id,limit]`, so every ledger event refreshes it and both sides of a transfer update without a restart.

## Deviation

- The AC lists `Adjust balance` and `Edit` among the actions. Adjust balance is Story 2.5. Edit (rename, Count in my totals, archive) stays in the accounts list until Stories 2.4 and 2.9 build the account's edit screen; no duplicate is built here.
- Rows are not tappable, as the AC says.
- The timeline reads `limit + 1` rows per page like Activity; a 200-entry account was not measured on a device, only the paging contract is tested.

## Not done / open

- TalkBack reading of the new screen was not checked on a device.
