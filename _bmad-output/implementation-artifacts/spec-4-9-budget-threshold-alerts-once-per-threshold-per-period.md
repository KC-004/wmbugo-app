---
title: 'Story 4.9 - Budget threshold alerts, once per threshold per period'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'oneshot'
baseline_commit: 'c2a084e'
story_key: '4-9-budget-threshold-alerts-once-per-threshold-per-period'
---

## Intent

Implements the epic's Story 4.9 acceptance criteria (see epics.md): BDG-004, UX-DR79, UX-DR69, FLOW-06. The notification library is not installed yet (decided with the product owner): everything is built behind the `Notifier` port and tested with a fake; the react-native-notify-kit adapter is a later step.

## Implementation Notes

- Migration 0019: `budget_alert_fired(budget_id, period_start, threshold_pct, fired_at)`, primary key on the first three columns. New event `BudgetThresholdCrossed` (budget id, period start, level; never an amount).
- `EvaluateBudgetAlerts` (planning): for every active budget, in the period running today only, finds the alert levels now crossed that were never recorded, records all of them in one transaction and raises one event for the highest. A muted budget records its crossings but raises nothing, so unmuting never back-fires. Running it again does nothing new. Levels are the budget's `alert_rule` (default 75, 90 and 100); a budget at 74% taken to 91% fires one alert for 90% and records 75% too; a refund to 70% then spending to 80% fires no 75% again.
- `budgetAlertHandlers`: `TransactionsChanged` and `BudgetsChanged` re-check (a `TransactionsChanged` flagged `closedPeriodTouched` is skipped, and a change in an ended period can never alert because only the current period is looked at); `BudgetThresholdCrossed` posts through the notifier when it is available and permission is granted. `budgetAlertContent`: `Groceries: 90% used this period`, `Groceries: limit reached this period` at 100%, a lock-screen version `Budget update · Tap to see`, no badge, no amount, a stable notification id (a redelivery replaces rather than duplicates), data to open the budget and period. Wired in `startApp` with each handler guarded so an alert failure never blocks screens.
- `Notifier` port with `unavailableNotifier` as the app's adapter for now (`adapters/notifier.ts`): the first-time ask is offered only when the notifier can post, so nothing asks for a permission it could not use.
- Editor: `Alerts for this budget` switch; turning it off or deselecting every `Alert me at` chip saves the budget muted (`muted` column). After the first budget is saved with alerts on, a sheet asks `Get a heads-up near your limits?` with `Allow notifications` and `Not now`; either answer is recorded in `prompt_state` and never repeats. Denied permission posts nothing but statuses still show.
- Tapping an alert opens SCR-15 for that budget and period: `loadBudgetDetail` accepts a period start, the `BudgetDetail` route takes `periodStart`, and the app subscribes to the notifier's tap events.

## Deviation

- No notification is actually shown on a phone until the notify-kit adapter is added; the system permission prompt is likewise not shown.
- The alert check runs after each ledger or budget change event and looks at all budgets, not only the changed ones (it is cheap and idempotent).
- Not checked on a device with TalkBack.
