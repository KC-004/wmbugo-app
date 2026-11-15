---
title: 'Story 5.4: Home cards: things to check, income and expense, budgets and Needs, Wants, Savings'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '53250db5b8a99eca532ce6e2da655d4d82725478'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Under the hero Home is empty. The user cannot see what waits for them, money in and out, how category budgets stand, or how Needs, Wants and Savings are going, and cannot open any of it from Home.

**Approach:** A card registry in `features/home` (stable id, title, visibility rule, sizes, drill-down) that renders, in the default order, `N to check`, `Income and expense`, `Budgets` and `Needs, Wants and Savings` below the hero. Each card reads its own query, so one failing card shows its own error and Retry. Core adds two read queries to `insights`.

## Boundaries & Constraints

**Always:** Cards are `bg-surface`, `rounded.md`, padding 16, no shadow, 12dp apart, with a heading title and a right-aligned `This period` caption (a budget on its own period shows that period on its row). Money renders through `<Amount>`/`LimitBar`, never a minus sign, honouring Hide amounts. `N to check` and the Budgets, Needs/Wants/Savings cards are not rendered when empty (0 to check, no category budgets, no 50/30/20); the Income and expense card shows genuine zeros. The overall budget is never in the Budgets card. Order: highest percent used first. Last card clears the tab bar and the ＋ button. At fontScale ≥ 1.3 Income and Spent stack.

**Never:** Editing, reordering or hiding cards (5.6), charts (5.5), new migrations, new events.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| To check | `toCheckCount` 3 | 48dp row `3 to check`, `Waiting for you`, caret; label `3 to check, Waiting for you, button`; opens the review queue | 0: not rendered |
| Income and expense | income 85,000, spent 8,140 | `Income +₹85,000.00`, `Spent ₹8,140.00`, `Net +₹76,860.00` | no entries: `+₹0.00` and `₹0.00`, `Net ₹0.00` |
| Spending over income | income 5,000, spent 8,200 | `Net ₹3,200.00 out` | N/A |
| Taps | Income / Spent | Activity filtered to income / expense and refund for this period | N/A |
| Budgets | three category budgets | LimitBar rows ordered by percent used, each opens that budget and period | none: not rendered |
| Own period | weekly budget | row shows its own period caption | N/A |
| 50/30/20 | targets exist | Needs, Wants, Savings bars, `Not classified ₹3,000 · Sort it`, opens Plan | none: not rendered |
| One card fails | its query rejects | that card only: `Couldn't load this card` with Retry | others unaffected |
| End of scroll | 320dp, 200% font; 600dp rail | bottom padding clears bar and ＋ | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/insights/homeCards.ts` (new) -- `homeIncomeExpense`, `homeBudgetCards` over `loadBudgetList`, `INCOME_SQL`, `SPENT_*_SQL`.
- `apps/mobile/src/features/home/homeCards.ts` (new, registry), `HomeCards.tsx`, `homeApi.ts`, `HomeScreen.tsx`, `homeNav.ts`.
- `apps/mobile/src/shared/ui/LimitBar.tsx` -- reuse bars and tones (Story 4.6 and 4.11); `features/budgets/BudgetsScreen.tsx` row pattern.
- `apps/mobile/src/features/shell/RootNavigator.tsx` -- review queue and budget detail destinations.

## Tasks & Acceptance

**Execution:**
- [x] core: `homeIncomeExpense`, `homeBudgetCards` and tests
- [x] registry and the four cards with their states, per-card queries and errors
- [x] navigation: review queue, Activity filters, budget and period, Plan
- [x] end-of-scroll padding, headings, TalkBack labels, large text
- [x] tests for every matrix row; update existing Home tests

**Acceptance Criteria:**
- Given the matrix rows, when Home renders, then each card shows exactly the listed content and no minus sign.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly. Core: `insights/homeCards.ts` (`homeIncomeExpense`, `homeBudgetCards`). Mobile: `cardRegistry.ts` (id, title, sizes, drill-down, visibility), `HomeCards.tsx` (four cards, each on its own query under the `home` area so every Home refresh path reaches it), `homeNav.ts` (review queue, budget at its period, Activity filters), end-of-scroll padding `tabBarClearance`, jest `testTimeout` 20 s for the large screen suite. `HomeApi` card loaders are optional so existing Home fakes keep working. The budgets query feeds both the Budgets and the Needs, Wants and Savings cards, so its failure shows one error in the Budgets slot.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route |
|---|---|---|
| Card queries never refreshed (blind, gap) | false in code (the keys sit under the `home` area), real as a test gap | patched: test that an invalidation recomputes both cards |
| A failed refresh replaced good cards with an error, duplicated the Budgets id and put its error out of order (edge, gap, blind) | medium | patched: last good data stays; error only with nothing to show, in registry order; skeleton while loading |
| Budget rows and Income and Spent buttons read only their names; the Net chip was three stops (blind) | medium | patched: one label each from the view model, tests with exact strings |
| Header row could squeeze at large text (edge) | low | patched: wraps |
| Test claims: rail, refund-net, leftover `void writer` (blind, edge) | low | patched: renamed, refund test added |
| Registry fields unused by render; unbounded budgets list; separate nowMs and period recompute; tabBar margin literal; optional loaders hide misconfiguration; cards have no stale marker; stale period on Activity tap across midnight | low | rejected or deferred: the registry is the contract 5.6 builds on, no named harm, hero already shows staleness |

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest`
- `cd apps/mobile && npx tsc --noEmit && npx jest`
- `npx eslint --max-warnings 0 apps/mobile/src packages/core/src/insights`
