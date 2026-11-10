---
title: 'Story 3.13 - Recently deleted, Show rejected and Delete permanently'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: '8534def'
---

## Intent

Implements the epic's Story 3.13 acceptance criteria (see epics.md) and PRD FIN-014, FIN-024.

## Implementation Notes

- Core `ledger/recentlyDeleted.ts`: `RECENTLY_DELETED_SQL` (manual entries deleted in the last 30 days, most recent first), `daysLeft` (a started day counts: deleted 7 days ago reads `23 days left`), `RestoreDeleted` (original date kept, balances and Spent follow because the entry counts again) and `RestoreRejected` (confirmed with `capture_resolution = user_approved`), both returning a snapshot for an exact Undo through `RestoreTransaction`. `PURGE_FACTS_SQL` tells the confirm sheet about transfers and refunds. Delete permanently is the Story 3.12 `PurgeEntry` (tombstone included).
- Mobile: Settings gains a `Data` group (Data › Recently deleted); the list shows merchant, amount, original date and days left with Restore (`Restored · Undo`) and Delete permanently; empty: the boat and `Nothing deleted in the last 30 days`. A removed entry's detail (reached from Activity's Show rejected) offers Restore and Delete permanently. The confirm sheet reads `Delete this entry permanently? This can't be undone.`, adds the transfer and refund lines when they apply, and runs the shared `requireReauth` guard (a no-op until Epic 8) before purging. `STATES.md` lists every destructive action in the epic with its tier.
- Show rejected itself (Story 3.6) already lists rejected captures from the last 90 days with the `rejected` tag and never deleted manual entries; a test now covers that against restore.

## Deviation

- Rejected captures are exercised through `SubmitCapture` with a non-manual source kind in tests; no capture source exists until Epic 11.
- The Data row's summary is static text (`Kept for 30 days`).
- Not checked on a device with TalkBack.
