---
title: 'Story 4.5 - Budget rules and the budget-used read model'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'oneshot'
baseline_commit: '3db1ed7'
story_key: '4-5-budget-rules-and-the-budget-used-read-model'
---

## Intent

Implements the epic's Story 4.5 acceptance criteria (see epics.md): BDG-001, BDG-003 (computation), BDG-005, BDG-006, ONB-006 (budget re-aggregation), AD-7. Core and storage only: the budget screens are Stories 4.6 and 4.7.

## Implementation Notes

- Migration 0015 (`planning.schema.ts`): `budget` (scope `overall | category | budget_type | savings`, JSON `scope_category_ids` and `account_ids`, `period_rule` `default | monthly | weekly | custom`, custom dates, `template`, `alert_rule`, `muted`, `created_at`, `removed_at`), `budget_target_version` (budget_id, version, `target_minor`, `effective_from`) and `budget_period` (derived cache with `target_minor` and `shortened`). Money columns end in `_minor`; CHECKs on scope, period rule, custom range and non-negative targets.
- Period service (`profile/period.ts`, the only place that computes boundaries): `weekFor` (first day Mon, Sun or Sat), `calendarMonthFor`, `customPeriod`, `budgetPeriodFor` (a custom range has no period outside its dates), `previousPeriod` (none for a custom range; a pay cycle is the one containing the day before this one starts), and the date helpers `addDays`, `daysBetween`, `periodDays`. `Period.kind` gains `week` and `custom`. An architecture test fails if any file in `src/planning` does date arithmetic.
- `planning/budgets.ts`: `budgetFigures` (`budgetUsed` and `refundSurplus`): confirmed, live expense splits minus refund splits by the entry's own date, subcategories rolled into their parent, each top-level category floored at zero and then summed; needs-review, excluded, reversed, removed entries and transfers never count; overall counts every spending category; account scope uses postings. `budgetStatus`: used, remaining (may be negative internally), percent, days remaining including today, projection (used ÷ days elapsed × days in period, only after 3 days and before the end), and `insufficient-data | on-track | nearing | exceeded`. `targetForPeriod` picks the target version a period had.
- `planning/budgetStore.ts`: `RebuildBudgetPeriods` rebuilds the `budget_period` cache from the period service and the target versions, touching no transaction, split or posting. The app runs it on `ProfileChanged` (`startApp.ts`).
- Tests (`planning/budgets.test.ts`): the November worked example (Shopping 2,000 and a 9,000 refund of an October TV, Food 10,000, 50,000 overall: used 10,000, left 40,000, surplus 7,000, October unchanged), reversal in an ended period, overlapping budgets, every status, a zero target, a one-day range, an ended period, the midnight boundary, the payday-change rebuild with an unchanged ledger fingerprint, and a property test that overall used equals the sum of floored categories and is never negative.

## Deviation

- `exceeded` is reported whatever the day count, so overspending is never hidden behind `insufficient-data` (the story lists `insufficient-data` first).
- A `savings` budget counts no spending yet: money moved to savings goals arrives with Story 4.11.
- No budget can be created in the app yet (Story 4.6), so the rebuild has nothing to rebuild on a real phone until then; its test inserts budgets directly.
- The rebuild writes one audit row (`RebuildBudgetPeriods`); no transaction audit rows are written.
