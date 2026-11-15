# Epic 6 Context: Plan: bills, goals, Free to use

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user lists known bills and subscriptions, sees each one coming before payday, gets a quiet reminder, and links the payment so the bill advances exactly once. They save for goals either by setting money aside (nothing moves) or by moving money into a savings pot. Plan opens on a "Before payday" timeline topped by Free to use, an honest estimate that names one next step instead of a number when an input is missing. Bills and goals never touch balances, spending or Left in budget.

## Stories

- Story 6.1: Bill rules and due dates in core
- Story 6.2: Bills & Recurring: add, edit, pause and end a bill
- Story 6.3: Link a payment to a bill ("Rent paid? Yes, link it")
- Story 6.4: Subscriptions filter with monthly cost and past charges
- Story 6.5: Bill reminders with a just-in-time permission ask
- Story 6.6: Savings goals: name a goal and set money aside
- Story 6.7: Moved to savings, goal progress and pace
- Story 6.8: Plan hub with the "Before payday" timeline
- Story 6.9: Free to use: the honest estimate on Plan
- Story 6.10: Home cards: Coming up and Savings goal

## Requirements & Constraints

- Planned bills and set-aside money never change balances, In accounts, Card dues, Spent, budget used, leftInBudget, needsWantsSavings or homeSummary (regression-tested). They only feed Plan's timeline and Free to use.
- Due dates keep the anchor day; a short month falls on its last day. `nextDue` is derived, never a stored counter. A payment row is unique per (rule, due date) and per transaction.
- Amounts are integer minor units, shown amounts never use a minus sign. Free to use = min(leftInBudget, availableAssets - billsReserved - setAside), no floor, shown as `Short by` when negative; when an input is missing, one next step is shown, never a number.
- Reminders are inexact, ~09:00 local, never contain amounts, no badge, max 3 non-capture notifications a day (bills claim slots before budget alerts), asked for just in time and once.
- Amounts hide with the Story 5.3 mask; each row is one TalkBack node; nothing truncates at 320dp x 200% text.

## Technical Decisions

- New planning-owned tables (`recurring_rule`, `recurring_payment`, later `goal`, `goal_allocation`); `_minor` suffix, no real columns; schema lint passes; one migration per story that needs one; never edit an applied migration.
- Every command is a use case: one writer transaction, audit row, outbox event (`RecurringChanged`, `GoalsChanged`) added to the event catalogue with areas (bills, plan, home / goals, plan, home). Query invalidation goes through the catalogue.
- Pure core functions (`occurrences`, `planBillReminders`, `goalProgress`, `freeToUse`) with property/fixture tests; today comes from the Clock port in the profile timezone; periods only from the period service.
- Transfers into a goal's savings pot write the goal allocation in the same writer transaction as the capture transfer (capture to planning command).

## UX & Interaction Patterns

- Bill rows and goal cards reuse the Activity row pattern, the limit bar, the KPI tile and the Home card registry; empty states and setup cards use the UX-DR50/58 patterns; undo toasts on every command; no confetti.

## Cross-Story Dependencies

- 6.2 to 6.5 build on 6.1; 6.4 and 6.5 extend the 6.2 editor and list; 6.7 depends on 6.6 and the capture pipeline (3.2); 6.8 hosts SCR-14/16/17; 6.9 needs 6.1, 6.6 and 4.11; 6.10 registers Home cards on the 5.4/5.6 registry.
