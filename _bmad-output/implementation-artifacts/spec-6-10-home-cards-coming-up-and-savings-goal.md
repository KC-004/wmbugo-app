---
title: 'Story 6.10: Home cards: Coming up and Savings goal'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '50b9dc7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** Home shows nothing of the bills coming up or the goal being saved for, so the user has to open Plan to see them.

**Approach:** Two read-only core queries in the insights module, `homeComingUp` (up to three unpaid bills in the period, `+N more`, null without an active bill) and `homeSavingsGoal` (the active goal with the nearest `By` date, else the most recently contributed, `+N more goals`, null without one), both from the Plan hub's planning queries so they cannot disagree. Both cards are registered after `spend_7d` in the Home card registry (Coming up scope `Before payday` or `Before month-end`), each with its own query, so they refresh on `RecurringChanged`, `GoalsChanged` and a date change like every Home card, and Edit Home lists them (`Shows when you add a bill`, `Shows when you have a goal`) with hide and reorder. A row opens the bill's detail, `+N more` opens Plan, the goal opens its detail and `+N more goals` opens Goals.

## Decisions

- Home is unchanged otherwise: the hero, the `N to check` card and the existing cards keep their behaviour; a saved layout without the new ids gets them after `spend_7d`.
- The goal is drawn with the Plan goal card without its outline (`bare`), so the bar, the masking and the one-node reading are identical on both screens. Neither card shows Free to use (a test checks).
- Edit Home's existing tests moved from 5 to 7 editable cards (positions read `of 8`).

## Verification

- `homeBillsGoals.test.ts` (core: none without bills or goals, three soonest unpaid with `+N more` and paid left out, paused or completed goals do not count, nearest date then most recent contribution) and `homeBillsGoals.test.tsx` (registry order and visibility, rows with date, amount and status, scopes, empty wording, masking and the one-node label, goal bar, `+1 more goal`, hidden through Edit Home, no Free to use).
