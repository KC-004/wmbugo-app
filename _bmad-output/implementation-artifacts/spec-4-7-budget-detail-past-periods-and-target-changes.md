---
title: 'Story 4.7 - Budget detail, past periods and target changes'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'oneshot'
baseline_commit: 'b6a41a4'
story_key: '4-7-budget-detail-past-periods-and-target-changes'
---

## Intent

Implements the epic's Story 4.7 acceptance criteria (see epics.md): BDG-003 (detail), BDG-005 (past periods queryable), BDG-007, FLOW-06 (budget detail). No migration.

## Implementation Notes

- Core `planning/budgetDetail.ts`: `loadBudgetDetail(q, id, back, nowMs)` for the current period (`back` 0) or an earlier one. It returns the period and label, used, the target version that period had, refund surplus, status (an ended period has 0 days left and no projection), the neighbouring period starts for the switcher, whether the switcher can go back (not before the first target) or forward (never past the current period), an overall budget's floored per-category amounts (they add up to the used figure exactly), and the entries that make the budget up (a refund as money back, a split entry only for its in-scope splits, up to 200). `'missing'` when the budget was deleted.
- `SaveBudget` takes `targetFrom: 'this_period' | 'next_period'`. A changed limit adds a version effective from the current period's start, or from the next period's start from the period service (`NO_NEXT_PERIOD` for a one-off custom range). Past periods keep their version. `readBudgetForEdit` now also returns the current and next period starts so the editor can say `From next period (1 Dec)`.
- `RemoveBudget` soft-removes with audit and `BudgetsChanged`; `RestoreBudget` (Undo) brings it back with its history and rebuilds its period cache; an overall budget cannot come back while another overall budget exists.
- Mobile: `BudgetDetailScreen` (SCR-15) on a new `BudgetDetail` route: name, period with days left, limit bar, `Left ₹X` or `Over by ₹X`, `Projected ₹X by 30 Nov · estimate` (hidden while too early), `Refunds this period: +₹X`, category amounts for an overall budget, the entries as Activity rows (tap opens the transaction), a `‹ Oct` and `Nov ›` switcher, Edit and Delete budget with its confirmation and `Budget deleted · Undo`. Loading shows skeleton rows, no entries says `Nothing counted in this budget yet this period.`, and a budget deleted elsewhere says `This budget was deleted. Nothing was changed.` with `Back to budgets`. The editor asks `Starting this period` or `From next period (1 Dec)` only when the limit changed. A budget row on the list now opens the detail.

## Deviation

- A limit change rebuilds the budget's whole period cache in the same transaction instead of recalculating only the current row; past rows come out identical (tested), because they are derived from the target versions.
- The first target of a new budget starts at the period it was created in, so the switcher cannot go back before that.
- Not checked on a device with TalkBack.
