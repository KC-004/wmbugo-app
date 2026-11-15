---
title: 'Story 5.5: Top categories and 7-day spend charts with View as table'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '56d20cf'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Home shows no picture of where money goes. The user cannot see their top spending categories or the last week's spending, nor read either as a table, nor open the entries behind a bar.

**Approach:** A shared `<BarChart>` (direct labels on every bar, `View as table`, tappable bars and rows, scope label first, Hide amounts aware) used by two registry cards: `top_categories` (up to five refund-net categories, horizontal bars with a 40dp category chip) and `spend_7d` (one vertical bar per day, today labelled, only the days wmbugo has existed). Core adds `homeTopCategories` and `homeSpend7d`.

## Boundaries & Constraints

**Always:** Amounts refund-net and floored at zero, never a minus sign; a category whose refunds exceed its spending is not ranked among spending. `Uncategorised` shows as `Not classified`. 7-day bar of a day equals the Activity day header `Spent` for that day. No trend, arrow or comparison; no zero bars for days before the profile existed (`Since Thu 5 Nov`). No spending: `Nothing spent yet this period.`. Table: one row per bar, header row announced as header, each row one TalkBack node (`Food, 4,200 rupees, 32 percent`), scope read first, choice kept until Home is left. Hidden amounts: no fills, no percentages, labels `₹ ••••`, rows read `amount hidden`. Charts never sit on raw gradient.

**Never:** Insights screens (Epic 7), new native dependencies, edit/reorder/hide of cards (5.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Top categories | 3 categories | bars ranked most first with chip, name, amount; tap opens Activity for the category and period | none spent: empty state |
| Refund over spend | Shopping spent 2,000, refunded 9,000 | not ranked, no negative bar | N/A |
| Six categories | more than five | five shown, share counts all | N/A |
| 7 days | seven days | `Thu`..`Tue`, `Today`, zero days are real zeros; tap opens that day | N/A |
| Young profile | created 3 days ago | only those days, `Since Sun 15 Nov` | N/A |
| Table | tap `View as table` | header row, one node per row, same drill-down; kept until Home is left | N/A |
| Hidden | masked | no fill, no percent column, names and day labels stay | N/A |
| Cross-check | any day | bar equals the Activity day header Spent | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/insights/homeCharts.ts` (new) -- `homeTopCategories` (over `needsWantsSavings` nets and `categoryIdsUnder`), `homeSpend7d` (over the spent queries per day and the profile's first day).
- `apps/mobile/src/shared/ui/BarChart.tsx` (new, shared), `features/home/HomeCards.tsx`, `cardRegistry.ts`, `homeApi.ts`, `HomeScreen.tsx`, `shell/RootNavigator.tsx` (focus), `shared/copy.ts`.

## Tasks & Acceptance

**Execution:**
- [x] core: `homeTopCategories`, `homeSpend7d` and tests (rank, share, five, refund, Not classified, young profile, cross-check with the Activity header)
- [x] shared `<BarChart>`: bars, direct labels, table, toggle, masking, drill-down
- [x] the two cards on the registry, per-card queries and errors, table choice kept until Home is left
- [x] tests for every matrix row; update registry tests

**Acceptance Criteria:**
- Given the matrix rows, when the cards render, then each shows exactly the listed content and no minus sign.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly. Deviation to confirm: the story names Victory Native XL, but it needs Skia, Reanimated and gesture-handler (native dependencies that need a native rebuild and cannot be built or checked on this PC). `<BarChart>` is built from plain views instead, with the same public behaviour, so Epic 7 can reuse it and a charting library can replace the internals later. A refund-heavy category is simply not listed (the optional `₹7,000 back` bar is not shown). The jest `testTimeout` stays at 20 s.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route |
|---|---|---|
| A nonzero bar under half a percent drew nothing (blind, edge) | medium | patched: any spending shows at least a 2% sliver, only zero shows nothing; test |
| A profile dated in the future gave an empty 7-day card; a ranked category could read 0% (edge, blind) | low | patched: the window always includes today; share is at least 1%; tests |
| Chart error and Retry, and refresh on invalidation untested (gap) | medium | patched: tests for both charts |
| View as table reset when drilling down to Activity, against "Home unchanged on Back" (edge) | medium | patched: kept while Home is open, a new Home starts on the bars; focus wiring removed; test |
| Backdated entries before the profile existed are left out of the 7 days | low | rejected: the spec says never show days before wmbugo existed |
| Savings or parent and child double counting; hard-coded Today and Not classified in core; query count; role choices; vertical label fit at large text; empty-card scope caption | low | rejected or deferred: nets are per top-level category, no named harm; label fit at large text stays a phone check |

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest`
- `cd apps/mobile && npx tsc --noEmit && npx jest`
- `npx eslint --max-warnings 0 apps/mobile/src packages/core/src/insights`
