---
title: 'Story 6.7: Moved to savings, goal progress and pace'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '694144d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** Real saving (money moved into a savings pot) does not count toward a goal, and a goal says nothing about whether its date is realistic.

**Approach:** `SubmitCapture` takes an optional `goalId` on a transfer and, in the same writer transaction, calls planning's `tagMoveForGoal`, which writes a `moved` allocation. When the goal has money set aside, the move replaces up to that much (`converted_minor`, migration 0025), so contributed progress stays the same and nothing is counted twice; removing the move gives the set-aside back. A move counts only while its entry is confirmed and not removed; `ReleaseGoalMoves` (on `TransactionsChanged`) drops the allocation of a removed one. Transaction detail offers `Count toward a goal` / `For Goa trip` + `Remove` (`CountTowardGoal`, `RemoveGoalTag`). `goalProgress` gives a pace only with contributions in two calendar months, the first 30+ days old.

## Decisions

- Conversion is stored on the move, not as a separate `taken_back` row, so the unique key on `transaction_id` holds and the history shows only what the user did.
- The Add sheet gets a `goal` preset (header `For Goa trip`, the `moves with it` note, `goalId` passed through); `Move to savings` on the goal opens it with the goal's pot (or the first pot), and with no pot the goal offers `Add a savings pot first` (Accounts).
- Pace lines: `Not enough history for a pace yet`, `About ₹X a month · done by Mar 2027`, `On track for Mar 2027`, `At this pace, done by Jun 2027`, `Your date has passed · ₹X to go`; none for paused, funded or finished goals.

## Verification

- `goalMoves.test.ts` (one transfer plus one allocation, Savings figure up once, conversion and give-back, deleted and waiting moves, refusals roll the transfer back, paused goal, Count toward and Remove, pace rules) and the 6.7 blocks in `goals.test.tsx` and `transfer.test.tsx`.
