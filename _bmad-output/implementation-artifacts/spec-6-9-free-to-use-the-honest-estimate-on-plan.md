---
title: 'Story 6.9: Free to use: the honest estimate on Plan'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'b3455ff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** A user cannot tell how much is really free before payday once bills and savings goals are counted.

**Approach:** Read-only `freeToUse` in the insights module composes Left in budget (the figure Home shows, including the 50/30/20-only form), the balances of active included asset accounts (not savings pots, not cards) that have one, the unpaid bills due from today to the period end plus this period's `Not seen yet` ones, and `setAsideTotal()`: `value = min(left, assets - bills - set aside)` with no floor. The gate is `needs_limit` (no overall budget and no 50/30/20 targets), then `needs_account`, otherwise `ok`; bills and goals never gate it. The Plan hub opens on a KPI tile (`Free to use`, the figure, `Estimate from what you've entered`) or one 48dp row naming the one next step; negative reads `Short by ₹5,000` in neutral text. Tapping the figure opens `How we worked this out` with each line linking to its source and the smaller side marked.

## Decisions

- `shortfallAfterHolding` is the shared check: the Set aside sheet shows `This leaves you short by ₹X` (polite live region) and stays enabled, and restoring a completed or archived goal that holds money shows the same warning in its toast. With the gate failing there is no warning.
- `Add an account` opens the Accounts screen (SCR-06), which has the add-account sheet and the list, instead of opening the sheet directly.
- Free to use appears on Plan only; a test greps Home's sources for it.

## Verification

- `freeToUse.test.ts` (the PRD fixtures: 12,000; 37,600 with balances and Left unchanged; short by 5,000; the paid bill stops reserving; a bill after payday does not; J-BILLS; only 50/30/20 with Left equal to Home; the gate) and the Free to use blocks in `plan.test.tsx` and `goals.test.tsx` (figure, caption, short by without a sign, the two one-step rows, the breakdown and its links, masking and the spoken label, warnings).
