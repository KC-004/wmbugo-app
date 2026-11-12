---
title: 'Story 4.10 - One-tap 50/30/20 targets'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'oneshot'
baseline_commit: '4fc6912'
story_key: '4-10-one-tap-50-30-20-targets'
---

## Intent

Implements the epic's Story 4.10 acceptance criteria (see epics.md): BDG-009 (template creation), FLOW-14 (set up, including acting on the Story 1.11 onboarding answer).

## Implementation Notes

- Migration 0020 adds `budget.template_income_minor` (the income the template was made from). The template id is `50_30_20`.
- Core `planning/budgetTemplate.ts`: `splitIncome` (Needs and Wants rounded down, Savings takes the remainder, so the three always add up to the income exactly: ₹80,000.01 gives 40,000.00 + 24,000.00 + 16,000.01; property tested). `CreateFiftyThirtyTwenty` writes Needs (`budget_type` need), Wants (`budget_type` want) and Savings (`savings`) on the default period in one transaction with audit and one `BudgetsChanged`; edited targets are saved as typed and not forced to add up; `INCOME_REQUIRED`, `AMOUNT_REQUIRED` and `TEMPLATE_EXISTS` write nothing. `UndoFiftyThirtyTwenty` removes the three together. `ChangeTemplateTargets` (Edit targets) adds a version only for a target that changed, from the current period.
- `loadTemplateState`: whether the template exists and its targets, the income to pre-fill (last full period's confirmed Salary, else the onboarding `Try 50/30/20?` figure, else nothing) and the setup card flag (onboarding Yes, nothing created, not dismissed; dismissal is a `prompt_state` key).
- Mobile: `Use 50/30/20` on the Plan tab (empty state and list). `TemplateSheet`: the income (`Your monthly income`, or `Your income per pay cycle` when salaried) with `You can change these later`, three editable rows (exact split until typed over), the caption `Targets add up to ₹82,000 of ₹80,000 income` when they differ, `Create targets`, `Error: income required`, and the toast `50/30/20 targets created · Undo`. When the template exists the sheet reads `You already use 50/30/20.` with `Edit targets`. The setup card `You wanted to try 50/30/20` has `Set it up` (pre-filled with the onboarding figure) and `Dismiss`. The list groups Overall and 50/30/20 separately and never adds them together.

## Deviation

- Savings shows no progress yet (its spending-side measure arrives with Story 4.11), so its bar reads from zero.
- The `Edit targets` sheet edits the three limits only; the stored income figure is not changed by it.
- Not checked on a device with TalkBack.
