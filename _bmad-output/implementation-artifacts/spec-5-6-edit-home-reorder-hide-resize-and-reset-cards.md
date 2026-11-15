---
title: 'Story 5.6: Edit Home: reorder, hide, resize and reset cards'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '928a9e4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Home cards sit in one fixed order. A user who lives in Needs, Wants and Savings cannot bring it under the hero, switch off what they never use, or shrink a long list.

**Approach:** One saved layout (`ui.home_layout`: a list of `{cardId, hidden, size}`), written only by `SaveHomeLayout`, drives Home. A pure resolver merges it with the card registry (unknown ids ignored, new cards at their default place). An `Edit Home` button after the last card opens SCR-05, where `Am I okay?` is pinned and every editable card can be moved (handle, Move up, Move down, custom actions), hidden, made Compact or Full, or reset. Back saves once.

## Boundaries & Constraints

**Always:** `Am I okay?` is pinned first with no controls; `N to check` is not listed and always shows directly under the hero when something waits. Hidden cards stay listed with `Hidden`. A card whose rule is false stays listed and orderable with `Shows when you use 50/30/20` (or the budget equivalent). Move up is disabled but focusable on the first row (`Already at the top`), Move down on the last. TalkBack: `Needs, Wants and Savings moved to position 2 of 6`, `7-day spend hidden`. One writer transaction with audit and `ProfileChanged`, saved when the screen closes; nothing is written when nothing changed, and the PRD order is stored as the default. Compact Budgets: three highest percent used plus `See all budgets`; compact Top categories: three. Reset to default returns the PRD order at default sizes with `Home reset · Undo`. A saved id that no longer exists is ignored; a registered card the list lacks goes to its default place.

**Never:** Editing `Am I okay?` or `N to check`; new cards; a migration (the layout is one more JSON settings key); Settings screen entries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | nothing saved | PRD order, every card shown at its default size | N/A |
| Move | Move up on Needs, Wants and Savings until first | announced `moved to position N of 6`; Home shows it under the hero | N/A |
| Hide | Hide on 7-day spend | announced `7-day spend hidden`; row keeps `Hidden`; absent on Home | N/A |
| Back | changed | saved in one call; Home updates; survives restart | save fails: message, can retry |
| Back | unchanged | nothing written | N/A |
| Default again | layout equals PRD order | stored as the default (null) | N/A |
| Compact | Budgets, Top categories | 3 rows each (+ `See all budgets`) | N/A |
| Reset | tap | PRD order at default sizes, toast with Undo | N/A |
| New or removed card | registry differs from saved | new card at default place; gone id ignored | N/A |
| Rule false | no 50/30/20 | still listed and orderable with its caption | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/profile/homeLayout.ts` (new), `settings.ts` (`ui.home_layout`), `settingsCommands.ts` (`SaveHomeLayout`).
- `apps/mobile/src/features/home/cardRegistry.ts` (editable, sizes, edit titles), `HomeCards.tsx` (layout order, hidden, compact), `HomeScreen.tsx` (layout, Edit Home button), `HomeEditScreen.tsx` (new, SCR-05), `homeNav.ts`, `shell/RootNavigator.tsx` (route), `settings/settingsApi.ts` (`saveHomeLayout`).

## Tasks & Acceptance

**Execution:**
- [x] core: layout type, validator, resolver, `SaveHomeLayout` and tests
- [x] Home renders from the layout; compact variants; Edit Home button
- [x] SCR-05: rows, Move up and Move down, custom actions, drag arithmetic, Hide, size, Reset with Undo, save on Back
- [x] tests for every matrix row; update existing Home tests

**Acceptance Criteria:**
- Given the matrix rows, when Home and Edit Home render, then each shows exactly the listed content.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly. No migration: `ui.home_layout` is a JSON key in the settings table like the others. Drag uses a `PanResponder` on the handle with the pure `indexAfterDrag`; every drag result is also reachable with Move up and Move down and the TalkBack actions, and those are what the tests drive. Home's own settings query uses `retryOnMount: false`: without it an unreadable settings read made the app shell loop (found by the App tests). The writer records an audit row for every use case run, so "nothing written" means no settings row, audit entry for settings or event.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route |
|---|---|---|
| Back closed the screen before the save finished, so a failed save lost the edits (blind, edge) | high | patched: Back waits for the save and stays open with the edits when it fails; test with retry |
| The unmount save depended on a changing function and could save a half-edited layout early (blind, edge, gap) | high | patched: unmount reads the latest through a ref and runs only on a real unmount |
| Drag heights were kept by row index and went stale after a move; no termination guard (blind, edge, gap) | medium | patched: heights by card id read in current order; a drag is not cancelled by scrolling |
| TalkBack actions sat on a non-focusable row (blind) | medium | patched: actions on the focusable handle |
| Cards flashed in PRD order before the saved layout loaded; Edit Home was hidden while Home failed (blind, edge) | medium | patched: cards wait for the layout, the button is always shown; tests |
| Compact showed the wrong rows in tests, See all showed with three or fewer (gap, edge) | medium | patched: fixtures in core order, exact ids, table checked, See all only when more exist |
| Undo after Reset discarded later edits; the nothing-changed baseline moved when settings refreshed (edge) | medium | patched with tests |
| Layout entries could carry extra fields; a saved size a card does not support persisted (blind, edge) | low | patched: sanitised on save, clamped on read; tests |
| Hidden cards still fetched; a save refetched all of Home (blind, edge) | low | patched: hidden cards do not load, no refetch after save |
| Edit Home route name untested (gap) | low | patched: test |
| Drag glue untested beyond the arithmetic; multi-device conflicts; copy wording; radiogroup container | low | deferred or rejected: Move up and Move down are the tested path, one device per profile |

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest`
- `cd apps/mobile && npx tsc --noEmit && npx jest`
- `npx eslint --max-warnings 0 apps/mobile packages/core/src`
