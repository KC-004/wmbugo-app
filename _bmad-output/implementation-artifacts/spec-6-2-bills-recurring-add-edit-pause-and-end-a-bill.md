---
title: 'Story 6.2: Bills & Recurring: add, edit, pause and end a bill'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '10b346f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** Rules exist in core but nobody can add, see or change a bill.

**Approach:** Core view models `loadBillsList` and `loadBillDetail` (status line, next due, history, mark target) feed SCR-16: a list with an empty state, an editor sheet, and a bill detail. A `Bills & recurring` row at the bottom of Plan (SCR-14) opens it until the Plan hub (6.8). No migration.

## Decisions

- Status line comes from the newest occurrence up to 3 days ahead (paid, due soon, not seen yet), else the next due date; paused and ended rows say so. Rows sort by derived next due date.
- Editing Undo re-saves the previous values; delete Undo is `RestoreRecurringRule`; Mark as paid Undo is `UnmarkBillPaid`. End has no Undo (it confirms first and keeps history).
- Dates are typed as `YYYY-MM-DD` (hint `Like 2026-12-05`), the same way the custom budget period is; a kind pre-selects its category by name.
- The account chip defaults to the first active non-pot account (no last-used tracking yet).

## Verification

- `billsList.test.ts` (core) and `bills.test.tsx` (screens: empty state and field errors, save and Undo, custom cadence, list statuses and collapsed groups, mark paid with confirm, hidden amounts, detail actions and history, paused and deleted bills).
- Full mobile and core jest, tsc and eslint pass.
