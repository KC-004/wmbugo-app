---
title: 'Story 5.1: Home read model, refresh and stale indication'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '52a405a10a5354588cc1dd2adc80c68f4c4c5c5f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Home reads its figures in `homeApi.load()` straight from SQL in the screen layer, has no budget answer, and refreshes only on events. A half-updated or stale figure is invisible, and Story 5.2's hero has nothing to render.

**Approach:** Add a core `homeSummary` query (new `insights` module, read-only) that composes the existing owners' queries into one snapshot; a pure hero presenter; refresh on foreground and date change; an `Updating…` caption and per-card error on the existing Home cards. The 5.2 hero visuals and 5.3 masking are not built here.

## Boundaries & Constraints

**Always:** Integer minor units. `insights` only composes owners' queries (`leftInBudget`, `budgetStatus`, `overviewTotals`/`homeAccounts`, `TO_CHECK_SQL`, period service); no new posting or split aggregation. The presenter never outputs a negative amount or a minus sign. Day counts use the period service. New UI strings go in the copy catalogue. No migration unless the EXPLAIN test shows a table scan on `transaction.local_date`/`status` or `split.category_id` (indexes `transaction_date_idx`, `transaction_status_date_idx`, `split_category_tx_idx` exist).

**Never:** Hero layout, gradient, hide-amounts or new cards (5.2 to 5.6). No edit to an applied migration. No new event types. No amount or text in logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under | overall target 20,000, used 8,140, 12 days to payday | state `under`, `leftMinor` 1,186,000 minor, per day = floor(left ÷ 12) in whole major units | N/A |
| Over | used 22,340 of 20,000 | state `over`, `overMinor` 234,000 positive, no per-day figure, line `5 days to payday` or `5 days left` | N/A |
| Singular | 1 day left | `1 day to payday` / `1 day left` | N/A |
| Types only | 50/30/20 only, Uncategorised spend | `heroMode` `nws_only`, `notClassifiedMinor` > 0 sets flag `notClassified` | N/A |
| No budget | none | `spent_only`, spent figure refund-net | N/A |
| No accounts / not set | none or balance not set | flag `accountsNotSet`; never zero for unknown | N/A |
| Recompute > 300 ms | refetch in flight | old values stay, scope captions read `Updating…`; first load uses skeletons | N/A |
| One card fails | one query rejects | that card only shows `Couldn't load this card` + Retry | rest of Home usable |
| Date change | midnight or period boundary while open, or app resumes | all Home queries invalidated; new period shown | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/insights/homeSummary.ts` (new) -- `homeSummary(q, nowMs)` over a `Querier`; empty `insights/` dir exists, add `index.ts` and export from `packages/core/src/index.ts`.
- `packages/core/src/planning/needsWantsSavings.ts` -- `leftInBudget` (reuse; add the budget's `period` to its `overall`/`types` results, additive) and `needsWantsSavings`.
- `packages/core/src/planning/budgets.ts` -- `budgetStatus` for `daysRemaining`; `budgetStore.readPeriodProfile` for period inputs.
- `packages/core/src/ledger/readModels.ts` -- `SPENT_*_SQL`, `spentMinor`, `homeAccounts`; `ledger/balances.ts` `overviewTotals`.
- `packages/core/src/capture/reviewQueue.ts` -- `TO_CHECK_SQL` (count rows; this is the single definition of "to check").
- `packages/core/src/profile/period.ts` -- `periodFor`, `periodLabel`, `nextPaydayOnOrAfter`, `daysBetween`.
- `apps/mobile/src/features/home/homeApi.ts` -- replace inline SQL with `homeSummary`; `HOME_QUERY_KEY = ['home','summary']`.
- `apps/mobile/src/features/home/heroPresenter.ts` (new) -- pure presenter.
- `apps/mobile/src/features/home/HomeScreen.tsx` -- `Updating…`, per-card error, foreground/date refresh; keep existing cards.
- `apps/mobile/src/shared/queryClient.ts` -- `invalidateForEvent` already maps events to areas; reuse.
- `apps/mobile/src/adapters/appStateScheduler.ts` -- AppState `active` pattern to reuse for resume.
- `apps/mobile/src/features/home/home.test.tsx` -- existing fixtures to extend.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/insights/homeSummary.ts` + `index.ts` + `packages/core/src/index.ts` -- `homeSummary` returning period (start, end, label), `heroMode`, left/used/target/notClassified/refundSurplus, `daysLeft`, `daysToPayday` (payday set only), `spentThisPeriodMinor`, accounts totals with not-set counts, `toCheckCount`
- [x] `packages/core/src/planning/needsWantsSavings.ts` -- add `period` to `leftInBudget` results; keep existing tests passing
- [x] `packages/core/src/insights/homeSummary.test.ts` -- fixtures for under/over/types/none/no-accounts/payday-none; EXPLAIN check on the Home queries; 10,000-record timing log
- [x] `apps/mobile/src/features/home/heroPresenter.ts` + test -- states `under|over|spent_only|loading`, flags, daily-line rule; every string free of `-`/`−`; fast-check property over used/target pairs
- [x] `apps/mobile/src/features/home/homeApi.ts`, `HomeScreen.tsx`, `shared/copy.ts` -- use `homeSummary`; `Updating…` after 300 ms; per-card `ErrorBlock`; invalidate on `AppState` active and when `today` changes while open
- [x] `apps/mobile/src/features/home/home.test.tsx` -- one test per trigger (`TransactionsChanged`, `CapturesSubmitted`, `CapturesRejected`, `AccountsChanged`, `CategoriesChanged`, `BudgetsChanged`, `ProfileChanged`, resume, date change)

**Acceptance Criteria:**
- Given the 5.1 matrix cases, when `homeSummary` and the presenter run, then outputs match the matrix and no string contains a minus sign.
- Given Home is mounted and any listed trigger fires, when it fires, then `homeSummary` and every Home card query are recomputed without restart.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly (no implementation subagent). Files: core `insights/homeSummary.ts` (+ test, index, export), `planning/needsWantsSavings.ts` (adds `period` to `overall`/`types` results; two existing expectations updated), mobile `heroPresenter.ts` (+ test), `useHomeRefresh.ts`, `homeApi.ts`, `HomeScreen.tsx`, `home.test.tsx`, `copy.ts`. No migration: the EXPLAIN tests show the spent, refund and review-queue queries already use `transaction_date_idx` / `transaction_status_date_idx`. Node timing over 10,000 records: about 15-30 ms. Home keeps one combined `['home','summary']` query, so a load failure shows the card error on both existing cards; independent per-card queries arrive with the cards of 5.4-5.5. The Timezone prompt is no longer hidden by a failed Home load. Copy catalogue entries must start with a capital or digit, so day text uses whole-phrase templates.

## Spec Change Log

## Review Triage Log

| # | Finding (layer) | Verdict | Evidence / route |
|---|---|---|---|
| 1 | A failed recompute with data shows old values with no cue or Retry (blind, edge) | medium | Real: `isError` stays true while data is kept. patch: stale-error block + test |
| 2 | Both cards error together; timezone prompt vanishes (blind, edge) | low | One combined query by design; the timezone prompt hiding was real. patch: prompt rendered outside the Reveal. Split queries deferred to 5.4 |
| 3 | Retry never pressed in tests (gap) | medium | patch: press Retry and assert reload and data |
| 4 | Updating tests do not target spent-scope, accounts-updating, label (gap) | low | patch: scoped assertions added |
| 5 | EXPLAIN covers one query, regex unproven (gap, edge) | medium | patch: refunds and review queue added; a test proves the check detects a scan |
| 6 | Under state could emit a negative amount if left < 0 (edge) | low | Cannot occur from one snapshot (left = target - used) but the guard is one expression. patch: Math.max |
| 7 | Unused copy.home.loadError (gap, blind) | low | patch: removed |
| 8 | daysLeft vs daysToPayday bases differ for non-default budget period (edge, blind) | false | Matches the story: per-day = left / daysToPayday when payday set, daysLeft from budgetStatus. Test for the mixed case deferred |
| 9 | refundSurplusMinor, shortened, non-default period unasserted in homeSummary (gap) | low | defer to 5.2, the first consumer |
| 10 | realHomeApi.load mapping untested (gap) | low | defer: thin mapping, phone-checked |
| 11 | Reads not in one snapshot (blind, edge) | low | Rejected: events refetch after commit; fix would add a transaction for a rare skew |
| 12 | TO_CHECK_SQL rows fetched to count (blind, edge) | low | Rejected: the story defines the count over that SQL; queue is small |
| 13 | AppState flaps and 30 s date polling (blind, edge) | low | Rejected: invalidation de-duplicates; a 30 s lag at midnight is acceptable |
| 14 | Exponent fallback, double profile read, optional summary/hero, pluralisation, live region, timing test flake (blind) | low | Rejected: unreachable fallback, 5.2 consumes the fields, no named harm |
| 15 | Mock leakage in tests (blind) | false | afterEach calls jest.restoreAllMocks |
| 16 | Retry from first-load error shows no progress cue (edge) | low | Rejected: card is replaced by skeleton-free error until data arrives; trivial |

## Design Notes

`BackupRestored` is not in the event catalogue until Epic 8; Home already refreshes on every `home` area event, so no trigger test or code is added for it now. The Home card scope captions (period chip on the hero) arrive in 5.2; here `Updating…` replaces the existing scope caption on the spent card and accounts line. The 10,000-record p95 on the reference phone is a manual check with the Story 1.3 method; CI records the Node timing only.

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest` -- expected: pass
- `cd apps/mobile && npx tsc --noEmit && npx jest src/features/home` -- expected: pass
- `npx eslint --max-warnings 0 apps/mobile/src/features/home packages/core/src/insights packages/core/src/planning` -- expected: no output

**Manual checks (if no CLI):**
- On the Redmi: edit an entry and see Home refresh; cold start shows skeletons; reopen after midnight shows the new date.
