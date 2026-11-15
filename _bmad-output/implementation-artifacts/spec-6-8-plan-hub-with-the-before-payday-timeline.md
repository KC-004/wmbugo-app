---
title: 'Story 6.8: Plan hub with the "Before payday" timeline'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '4c48f52'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** Plan opens on the budget list, with bills and goals reachable only through temporary rows; nothing says what is already due before payday.

**Approach:** The Plan tab root becomes SCR-13. Core `loadPlanTimeline` returns the period (profile default, `1–30 Nov`, days left, payday or month-end) and the active bills' due dates in it: paid ones in place, `Not seen yet` ones included, older unpaid history left out, paused, ended and removed never listed. The hub shows `Before payday` (`Before month-end` without a payday) with the timeline built on the bill row (leading date, `HDFC · Monthly`, the Story 6.2 status line), the footer `Showing 3 bills you added. Missing EMIs or subscriptions? Add them`, then Budgets (compact: setup and income cards, the 50/30/20 bars, up to three others by percent used, `See all budgets`), Bills & recurring (`3 bills · next: Rent on 5 Dec`) and Goals (up to three, `See all goals`). SCR-14 is pushed from the hub with Back; the temporary Plan rows are gone. No migration.

## Decisions

- Each section runs its own query and fails on its own (`Couldn't load this section` with Retry); the catalogue gives `TransactionsChanged`, `AccountsChanged` and `ProfileChanged` the `plan` area, so the hub recomputes on every event the story lists.
- Setup cards are independent: with nothing set up all three show (Add your rent opens the bill editor pre-filled with Rent, Kind Rent, Housing); each goes once its thing exists; with only bills missing the timeline slot shows `Add upcoming bills`. None can be dismissed.
- Free to use (Story 6.9) will sit above the timeline; nothing of it is in this story.

## Verification

- `planTimeline.test.ts` (period, order, paid in place, not seen yet, active-only counts, no profile) and `plan.test.tsx` (setup cards, pre-filled Rent, budget editor request, timeline rows and footer, month-end wording, sections and links, failing sections, partial setup, hidden amounts).
