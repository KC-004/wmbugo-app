---
title: 'Story 4.11 - Needs, Wants and Savings progress and Left in budget'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'oneshot'
baseline_commit: 'ce6ee73'
story_key: '4-11-needs-wants-and-savings-progress-and-left-in-budget'
---

## Intent

Implements the epic's Story 4.11 acceptance criteria (see epics.md): BDG-009 (Needs/Wants/Savings measurement, income-change offer), CAT-006 (Not classified), BDG-006 (type floors), FLOW-14 (bars and drill-down). No migration.

## Implementation Notes

- Core `planning/needsWantsSavings.ts`: `needsWantsSavings(period)` (Needs and Wants are confirmed spending by the category's type, refund-net and floored at zero per top-level category first; a subcategory follows its parent's type; Not classified is Uncategorised, categories with no type and Not itemised splits; Savings is `SAVINGS_MOVED_IN_SQL` from Story 2.8, exact, with a display value never below zero). A type change moves spending between Needs and Wants for every period with no amount changed (tested). `leftInBudget(now)`: an overall budget gives target minus used with the refund surplus apart; with only 50/30/20 it gives (Needs + Wants targets) minus (Needs + Wants + Not classified spending) with the Not classified part named (tested with ₹40,000 / ₹25,000 / ₹3,000 giving ₹12,000); with neither it gives `none`.
- `budgetFigures` measures a `savings` budget by money moved into pots (a net withdrawal counts zero); the budget list rows carry the budget type and `savingsMovedMinor`, and the list has a `typeSummary` (Not classified amount, the category ids to filter Activity by, the period). The budget detail lists a Needs or Wants budget's categories with floored amounts (summing to the bar) and each category's member ids, and lists a Savings budget's transfers into and out of pots.
- Template state gains `incomeChange`: when the last full period's confirmed Salary is more than 10% from the template income and the card was not answered for this period (prompt_state key per period start). `ChangeTemplateTargets` takes the new income so Update writes new target versions from this period (past periods keep theirs) and stores the income.
- Mobile: `LimitBar` gains Needs / Wants / Savings tones (the `needs`, `wants`, `savings` colours with a 1px outline on light surfaces) and a Savings mode (no overflow, never a warning, `₹X to go` or `Target reached`, `More moved out than in this period` on a net outflow). `shared/ui/moneyText` is the shared way to put an amount into a string. The Plan list shows the three bars, `Not classified ₹3,000 · Sort it` (opens Activity filtered to those entries for the period) and the `Your income changed — update 50/30/20 to ₹90,000?` card with `Update` and `Keep ₹80,000`. The budget detail category rows open Activity for that category and period.

## Deviation

- Home and Free to use do not call `leftInBudget` yet (Epics 5 and 6); it is tested here.
- A Savings bar shows `₹X to go` below its target (the story only specifies the at-or-above wording).
- Not checked on a device with TalkBack.
