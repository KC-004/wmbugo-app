---
title: 'Story 6.1: Bill rules and due dates in core'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '2ccca92'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** wmbugo has no notion of a bill, so no screen can agree on when rent is due or whether it is paid.

**Approach:** Migration 0021 adds `recurring_rule` and `recurring_payment` (planning). Pure `occurrences` keeps the anchor day (short month: last day) through `addMonthsClamped` in the period service; `billOccurrences` and `nextDue` are derived from rules and payment rows, never stored. Seven use cases write each in one transaction with audit and the new `RecurringChanged` event (areas bills, plan, home).

## Decisions

- Extra columns on `recurring_rule` beyond the epic list: `paused_on`, `resumed_on`, `ended_on` (local dates). A pause gap runs from `paused_on` to `resumed_on`; dates in it never exist, so nothing becomes `not_seen_yet`. Only the latest pause gap is remembered.
- Only the newest past unpaid date is `not_seen_yet`; older unpaid dates are `not_marked_paid` (history).
- `nextDue` is null for paused, ended and removed rules. `RemoveRecurringRule` is refused with `HAS_PAYMENTS`; `RestoreRecurringRule` is the Undo of a remove.
- `LinkBillPayment` and the transaction-driven unlink arrive in Story 6.3; `recurring_payment` already carries the transaction key and its unique index.

## Verification

- `packages/core/src/planning/recurring.test.ts`: leap year, 31 Jan, quarterly, annual 29 Feb, weekly/custom steps, property test, statuses, pause/resume/end/remove, exactly-once marking, unique keys, and a regression that balances, Home summary and left in budget are identical with the rule.
- Core tsc, eslint and full core jest pass.
