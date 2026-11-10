---
title: 'Story 3.12 - Retention purge and tombstones'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: '1f28137'
---

## Intent

Implements the epic's Story 3.12 acceptance criteria (see epics.md) and PRD FIN-014, AD-3, AD-6, AD-16.

## Implementation Notes

- Migration 0011 adds `tombstone` (id, fingerprint_hash, outcome deleted or rejected, purged_at): no amount, merchant or text.
- Core `ledger/purge.ts`: `PurgeExpired` removes entries with `removal_kind = deleted` after 30 days and `rejected` or `excluded` after 90 (tested at 29/30 and 89/90 days with the Clock), with postings, splits, source records, candidates and attachments. It returns the attachment file names to delete after the commit. A linked refund of a purged purchase stays, unlinked, in its category and balances do not change. `PurgeEntry` purges one removed entry now (for Story 3.13); a transfer purges as one transaction with both legs. `RunDailyPurge` runs `PurgeExpired` at most once per local day and records the day in the same transaction.
- Fingerprint: (reference, direction, event type) with a reference, else (direction, amount, local date, normalized merchant). The tombstone stores `SHA-256(salt | fingerprint)`; the per-install salt is created on first use and kept in `settings`. Merged-away (`excluded`) entries are purged but leave no tombstone, since no decision was made about the payment.
- `SubmitCapture` now accepts every source kind plus `reference` and `ignoreTombstone`. A non-manual submission matching a tombstone returns `SKIPPED_PREVIOUSLY_REJECTED` or `SKIPPED_PREVIOUSLY_DELETED` (empty transaction id) and writes nothing; `ignoreTombstone` writes it anyway; manual entries are never skipped.
- `Scheduler` port declared in core; the app implements it with app start and resume (`appStateScheduler`) and runs `RunDailyPurge`, then deletes the purged photo files.

## Deviation

- No capture source exists yet, so the skip is exercised through `SubmitCapture` tests with `sourceKind: 'sms'`.
- Audit rows of purged entries stay (they hold ids and flags only).
- The daily run is not timed on a device and has no background trigger.
