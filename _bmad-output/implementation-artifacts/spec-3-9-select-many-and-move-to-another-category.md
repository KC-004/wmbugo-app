---
title: 'Story 3.9 - Select many entries and move them to another category'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: '82c7d1c'
---

## Intent

Implements the epic's Story 3.9 acceptance criteria (see epics.md) and PRD TXN-010.

## Implementation Notes

- Core `ledger/bulk.ts`: `BulkRecategorise` moves confirmed, single-category expenses and incomes of the target's kind in one writer transaction: an audit row per entry, one `CategoryAssigned` event (plus `TransactionsChanged`), and a fingerprint check that every amount, date and posting is unchanged (`AMOUNTS_CHANGED` otherwise). Everything else (transfers, splits, refunds, entries still to check, removed, unknown ids, already in the category, wrong kind) is skipped and counted. `UndoBulkRecategorise` returns every moved entry to its previous category in one step. `classifyBulk` drives the preview (single source category or mixed).
- `activityIdsQuery` returns every id that matches the current filters, so Select all covers rows that are not loaded.
- Mobile: `Select` in the Activity header or a long press starts selection; the selection bar (min 56dp) shows `✕`, `N selected`, `Select all` and `Move N to…`; rows show a 24dp checkbox in a 48dp target on a muted background, read as checkboxes with `selected` / `not selected`; hardware Back or `✕` ends it with nothing changed. `Move N to…` opens a category list, then the preview (`Move 14 entries from Other to Transport. Amounts don't change.` or the mixed form, plus the won't-change line) with Confirm, then toast `Moved N to Transport · Undo`.

## Deviation

- The preview reads `Move 14 from Other to Transport.` (the count without the word "entries") to keep one template for the plural; the won't-change line has the epic's wording.
- There is no `selected-background` colour token; selected rows use `bg-muted`.
- Hardware Back handling is wired but not covered by a test.

## Not done / open

- Not checked on a device with TalkBack.
