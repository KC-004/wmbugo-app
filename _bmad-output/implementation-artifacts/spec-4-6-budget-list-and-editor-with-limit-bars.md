---
title: 'Story 4.6 - Budget list and editor with limit bars'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'oneshot'
baseline_commit: '714e6c7'
story_key: '4-6-budget-list-and-editor-with-limit-bars'
---

## Intent

Implements the epic's Story 4.6 acceptance criteria (see epics.md): BDG-002 (scopes, one overall budget, labelled overlaps), BDG-003 (display), UX-DR25, FLOW-06.

## Implementation Notes

- Migration 0017 adds `budget.ended_after` (the end date of the last period a budget runs).
- Core `planning/budgetCommands.ts`: `SaveBudget` (budget plus its version 1 target in one transaction, audit, `BudgetsChanged`; errors `AMOUNT_REQUIRED`, `CATEGORY_REQUIRED`, `DATE_RANGE_INVALID`, `DATE_INVALID`, `OVERALL_EXISTS:<id>`; an overall budget always follows the profile period; editing the limit adds a version from the current period) and `UndoSaveBudget`. `BudgetsChanged` is in the event catalogue and invalidates `budgets`, `home` and the new `plan` area.
- `planning/budgetList.ts`: `loadBudgetList` returns each active budget with its period label (`1–30 Nov`, `Weekly · 9–15 Nov`, `Custom · 1–15 Nov`), figures counted from the entries, status, group (Overall, 50/30/20, Categories) and whether a category budget overlaps the overall one. `periodRangeLabel` and `isLocalDate` live in the period service.
- Archiving or merging the only category of a budget ends it after the current period (`endBudgets`), Restore or Undo of the merge runs it again (`reopenBudgets`), and the archive and merge previews say `The Fuel budget ends after this period.` An ended budget leaves the list once its last period is over; its row, targets and past figures are kept.
- Mobile: `shared/ui/LimitBar` (UX-DR25: name and `₹3,400 of ₹4,000` that wrap at large text, an 8dp bar with a tick at the limit, overflow capped at 20% of the track, status line `₹600 left · 12 days left`, `85% used`, warning icon with `Over by ₹740`, `Too early to tell`, a hidden state that keeps the track and day text, a due-soon text for Epic 6, one TalkBack node per row). `features/budgets`: `BudgetsScreen` (SCR-14, on the Plan tab), `BudgetSheet` (For, Only these accounts, Period, Limit, Alert me at, inline errors that keep the input and move focus), `budgetsApi`.
- Tests: core (save, validation, overall rule, edit and undo, list groups and labels, archive and merge ending a budget and Restore reopening it) and mobile (bar geometry and states, status lines without a minus sign, the list, the editor, errors, `Edit it`, Undo).

## Deviation

- `Use 50/30/20` is shown only when a handler is given; Story 4.10 builds the one-tap targets and wires it.
- The overflow past the limit is a solid warning-colour block, not a hatched pattern.
- Tapping a budget row opens the editor; the detail screen with past periods is Story 4.7.
- The editor takes custom dates as typed text (year-month-day), with a hint.
- Not checked on a device with TalkBack.
