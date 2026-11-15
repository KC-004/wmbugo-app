---
title: 'Story 5.2: The "Am I okay?" hero card'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '0f2922adaef7adac8d01139a9e0cafc78fab170b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Home shows two plain cards. Story 5.1 produced the snapshot and the hero view model, but nothing draws "Am I okay?": what is left (or how far over), the bar, the daily line, and accounts beside it.

**Approach:** A hero card on a brand band (light) or glows (dark) built from `presentHero`: label, eye button, headline amount, 8dp hero bar with limit tick and hatched overflow, caption, daily line, divider, In accounts and Card dues. The period chip joins the header. Tapping opens the budget. Masking is Story 5.3: the eye is wired to a local toggle only.

## Boundaries & Constraints

**Always:** All numbers and strings come from `homeSummary` / `presentHero`; no money maths in the UI. Amounts render through `<Amount>`; copy through the catalogue; no minus sign anywhere. In accounts and Card dues are never summed; an unknown balance is never zero. Hero bar: 8dp, overflow = (used − target) ÷ target of the track, capped at 20% of the track, fill stops at the tick. No phrase, emoji or illustration on the hero. One merged TalkBack node built from the view model; the eye and the `Set a limit` / `Sort it` rows are separate 48dp nodes. At fontScale ≥ 1.3 accounts stack and the card grows.

**Never:** Persisting or globally applying hide amounts (5.3). Other Home cards (5.4+). New migrations or events. Editing the budget editor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under | overall 20,000, used 8,140, 12 days | `Left in budget` `₹11,860`, bar 40.7%, `₹8,140 of ₹20,000`, `~₹988/day · 12 days to payday`, accounts line | N/A |
| Over | used 22,340 of 20,000, 5 days | warning icon + `Over budget`, `₹2,340`, `₹22,340 of ₹20,000`, `5 days to payday`, no per-day | N/A |
| 50/30/20 only | N+W 40,000, 25,000 + 3,000 not classified | `Left in budget` `₹12,000` + row `includes ₹3,000 not classified · Sort it` | row absent at ₹0 |
| No budget | none | `Spent this period`, no bar, `Set a limit →` opens the editor, Overall preselected | N/A |
| Accounts | none / not set | `Set up an account to calculate your balance`, or known total + `+1 account not set` | never zero |
| Bar overflow | 50%, 100%, 112%, 300% | overflow 0, 0, 12%, exactly 20% of the track; fill ends at the tick | N/A |
| Tap hero | overall / types only / none | opens that budget / the Plan tab / the editor | N/A |
| Large text | 320dp, fontScale 2, ₹1,18,60,000 | amount caps at 1.5×, fits to 28sp, accounts stack | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/insights/homeSummary.ts` -- add `period.title` (chip), `overallBudgetId`, `sortIt` query inputs; `planning/needsWantsSavings.ts` `leftInBudget` overall result gains `budgetId`.
- `apps/mobile/src/features/home/heroPresenter.ts` -- view model (reuse).
- `apps/mobile/src/features/home/HeroCard.tsx`, `HeroBar.tsx`, `HomeBand.tsx`, `heroLabels.ts` (new).
- `apps/mobile/src/features/home/HomeScreen.tsx`, `homeApi.ts` -- compose; chip; navigation callbacks.
- `apps/mobile/src/features/shell/RootNavigator.tsx` -- hero taps: BudgetDetail, Plan tab, editor; Sort it uses `useOpenActivityFilter`.
- `apps/mobile/src/features/budgets/BudgetsScreen.tsx` -- editor open pattern to reuse (`BudgetSheet`, `mode: 'add'`).
- `apps/mobile/src/shared/theme/Glass.tsx`, `ui/Amount.tsx`, `ui/LimitBar.tsx` (`barGeometry`), `features/shell/AddButton.tsx` (svg gradient) -- reuse.

## Tasks & Acceptance

**Execution:**
- [x] core: `homeSummary` gains `period.title`, `overallBudgetId`, `sortIt`; `leftInBudget` overall gains `budgetId`; tests
- [x] `HeroBar.tsx` + pure `heroBarGeometry` -- tick, fill, capped overflow, hatch; render and contrast tests
- [x] `HomeBand.tsx` -- light gradient band (176dp, rounded bottom), dark glows capped at 45% alpha
- [x] `HeroCard.tsx`, `heroLabels.ts` -- the four budget states x accounts states, rows, TalkBack label, large text
- [x] `HomeScreen.tsx`, `homeApi.ts`, `RootNavigator.tsx`, copy -- compose, period chip with `Updating…`, taps and rows
- [x] update Home and Settings tests to the hero; add hero tests for every matrix row

**Acceptance Criteria:**
- Given the matrix rows, when Home renders, then each state shows exactly the listed content and no minus sign.
- Given TalkBack, when focus reaches the hero, then it is one merged node with the exact label, and the eye, `Set a limit` and `Sort it` are separate nodes.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly. New: `HeroCard`, `HeroBar` (+ `heroBarGeometry`), `HomeBand`, `heroLabels`, `homeNav`, `homeTestKit`. `HomeData` now carries only `summary` and `hero` (the 5.1 `scope`, `spentMinor`, `accounts` fields went). `homeSummary` gained `period.title`, `overallBudgetId` and `sortIt`. `Set a limit` sets a store flag that the budget list consumes (opens Overall, or the existing overall budget). Deviations: the not-classified row reads `Includes ...` with a capital (the copy catalogue requires a capital); amounts show two decimals like every other amount. The hero shows the eye as a local toggle until 5.3.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route |
|---|---|---|
| Zero limit and zero spend drew a full bar; NaN draws NaN% (blind, edge, gap) | medium | patched in `heroBarGeometry` with tests |
| Merged label repeats the set-up-account text (blind) | low | patched |
| Stale `Set a limit` request after a failed load; second overall budget (blind, edge) | medium | patched: cleared on error, opens the existing overall budget |
| Hero navigation wiring untested at the navigator boundary (gap) | medium | patched: extracted `homeHeroNav` and tested it |
| Masked TalkBack label and Sort it label unverified; Sort it read a formatted amount (gap) | medium | patched, tests added |
| Unused `showAmounts` copy; duplicated alpha helper (blind) | low | patched |
| Fixed SVG ids collide; theme-blind tick border; second needsWantsSavings query; sortIt only in types mode; hidden is local state; stale budget id; NaN glow alpha; empty-category Sort it | low | rejected or deferred: single instance on Home, spec-defined colours, no named harm; masking is 5.3 |

## Design Notes

The hero replaces the 5.1 Spent card and Accounts line. The glass blur library is still not chosen (Story 1.8), so the hero uses the existing `Glass` tint without blur. Hide-amounts persistence and global masking are 5.3: here the eye toggles a local flag that is passed to `<Amount hidden>`.

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest`
- `cd apps/mobile && npx tsc --noEmit && npx jest`
- `npx eslint --max-warnings 0 apps/mobile/src/features/home packages/core/src/insights packages/core/src/planning`
