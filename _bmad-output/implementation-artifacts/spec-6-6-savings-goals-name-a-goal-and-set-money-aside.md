---
title: 'Story 6.6: Savings goals: name a goal and set money aside'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '2050763'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** A user cannot name something they are saving for or see money as promised without moving it.

**Approach:** Migration 0024 adds `goal` and `goal_allocation` (planning) and the `GoalsChanged` event (areas goals, plan, home). Use cases `SaveGoal`, `SetAsideForGoal`, `TakeBackFromGoal`, `ChangeGoalState`, `UndoAddGoal`, `UndoGoalAllocation`; queries `loadGoals`, `loadGoalDetail` and `setAsideTotal()` (set aside minus taken back across active and paused goals only), ready for Free to use (6.9). SCR-17 lists goal cards (active and paused, then Done and Archived collapsed) with a detail screen for history and actions. Plan gets a `Goals` row beside `Bills & recurring`.

## Decisions

- `By` is typed as `YYYY-MM`, stored as the first day of that month; a past month is refused (`Error: pick a date from this month on`), except that editing a goal keeps its own month.
- A completed or archived goal keeps every allocation but stops holding set-aside money; restore holds it again. Undo of adding removes an empty goal and archives one that has contributions.
- The progress bar is a plain fill that never overflows and is not drawn when amounts are hidden. The `Moved to savings` marker exists in history now; the allocations themselves arrive in 6.7.
- Setting aside never touches a ledger table (regression test over balances, entries and Home).

## Verification

- `goals.test.ts` (save and refusals, edits, undo, set aside changes no ledger figure, take back and its limit, history, lifecycle and `setAsideTotal`) and `goals.test.tsx` (card text and masking, boat moment, empty state and errors, save and Undo, groups, history markers, amount sheet, lifecycle).
