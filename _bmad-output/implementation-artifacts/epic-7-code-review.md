# Epic 7 code review (Insights, stories 7.1 to 7.8)

Range `1417eb8..d0b84de` on `feat/7-8-insights-a11y-privacy-perf`. Nine independent reviewers over three chunks (core source, mobile source, tests): Blind Hunter, Edge Case Hunter, Verification Gap and Acceptance Auditor where they applied. No layer failed. Severity is the triage verdict, not the reviewers'.

Checks before the review: lint and typecheck clean, core 869 tests, mobile 2,191 tests.

## Decision needed (4)

- **D1. CSV export is the OS share sheet, not the Android save dialog.** The share sheet loses the file name, can hit the Android size limit, and cannot tell "shared" from "dismissed", so the toast can say `Exported N entries` when nothing was saved. The spec wants the Storage Access Framework dialog, which needs a native module. Options: add one, write a cache file and share its URI, or keep the share sheet and fix the toast. (medium)
- **D2. See in Activity drops merchant, tag, source and type filters.** Story 7.2 says the shared Activity filter model gains `merchantKeys`, `tags` and `sources`; it was not done, so those drill-downs open a wider Activity list than the figure. Options: extend `ActivityQuery` and the Activity search, or hide the button for targets Activity cannot filter. (medium)
- **D3. Donut segments and the Needs / Wants / Savings bars do not open anything.** Story 7.4 wants a tap on a donut segment to drill, and 7.7 wants a tap on an N/W/S bar to open its drill-down. The N/W/S drill-down screens do not exist yet. (medium)
- **D4. One failing overview query replaces the whole screen.** Story 7.2 says a failing tile alone shows `Couldn't load this` with Retry. Fixing it means splitting the overview load into one query per tile. (low-medium)

## Patch, confirmed or strongly evidenced (28)

**Correctness**
1. The merchant filter resolves merchant spellings over the selected period only, so a refund whose purchase was earlier is dropped, the baseline and earlier periods miss spellings, and income never matches. Resolve over the whole ledger with the effective merchant (`MERCHANT_SQL`). (medium)
2. `loadInsightsContext` reads the `profile` and `transaction` tables itself and counts rejected or deleted entries when finding the first day. Use ledger and profile queries that look only at confirmed, live entries. (medium)
3. Budgets for a running period anchor on its last day, which is in the future. Clamp the anchor to today so non-default budgets match Plan. (low-medium)
4. The tag filter uses an unescaped `LIKE`, so `_` and `%` act as wildcards. Match with `json_each`. (low)
5. `setPreset` keeps a stale custom range after another preset is picked. (low)
6. A section whose loader returns `null` shows a skeleton forever, with no error or Retry. (medium)
7. The trend keeps a chosen granularity after the period changes and no longer offers it. (low)
8. The Income and Out drill-downs of the same bucket share a title and a CSV file name. (low)
9. The CSV writes a blank amount when formatting fails, writes `note` as always empty, and does not sanitise the `# Filters:` header line. (low-medium)
10. `incomeVsExpense` net ignores a refund surplus. (low)
11. The empty-period prompt hides the waiting-entries row, so entries cannot be reviewed from an otherwise empty period. (low-medium)
12. A failed facet load makes the Filters chip do nothing, and repeated taps stack sheets. A selected value outside the first 30 merchants cannot be unticked. (low)

**Privacy and accessibility (Story 7.8)**
13. The Kept table and the Needs / Wants / Savings table show and announce percentages while amounts are hidden. (high)
14. Chart summary labels (donut, trend, in/out, refund-surplus rows) announce real amounts while hidden. (high)
15. `DrillScreen` does not subscribe to the hidden-amounts state. (medium)
16. Scope labels are marked as headings, adding extra stops to TalkBack heading navigation. (low)
17. The in/out table rows are not tappable. (low)
18. The category table header says `Name` instead of `Category`, and the surplus share cell is empty instead of `—`. (low)
19. A Home-style `Am I on track?` heading can show with an empty body. (low)

**Tests**
20. The spinner check cannot fail (it compares a component's source text to a string).
21. Titles promise Retry and skeletons but no test presses Retry or checks a skeleton.
22. The budget-refund fixture test never calls the budget function; the split-entry test has no split; the transfers test creates no transfer.
23. The hidden-amounts tests only check that digits are absent, so an empty render would pass.
24. Tag and source filters, `filterFacets`, past-period monthly and ended budgets, `activityQueryFor` for every target kind, the Insights route wiring in the shell, `shareCsvSaver` and the new BarChart props are untested.
25. The filter-sheet Reset, merchant search and tag selection are untested.
26. The "filter never changes a budget" test would pass if both lists were empty, the performance test uses a wall-clock bound, and the architecture test greps single-quoted source only.
27. The event-refresh test checks only that one loader was called again.
28. `insightsTestKit.tsx` sits in production `src` and uses jest globals.

## Deferred (8)

- Month labels repeat across years, and a quarter or year is labelled with one month name.
- A tiny category can round to a 0% share.
- Queries are not keyed by the day, so the screen can show yesterday's period after midnight.
- Each Insights loader repeats the context and profile reads.
- `BackupRestored` does not exist yet (Epic 8) and cannot invalidate Insights.
- Hard-coded English fragments outside `copy`.
- The trend segmented control does not become a radio list at large text.
- Future-dated entries fall outside the trend buckets.

## Rejected (14)

- Transfer fees not counting as spending: a fee is saved as a separate confirmed expense and the 7.1 test proves it counts.
- Ledger events not invalidating Insights: `TransactionsChanged`, `AccountsChanged`, `ProfileChanged` and `CategoriesChanged` already map to `insights`.
- `This month` showing "not a budget period" when a payday is set: the story ties budgets to the default period.
- A negative previous window giving a contradictory percent: the story says only a window of exactly ₹0 has no baseline.
- Drilling replacing the category filter: the drilled category always lies inside the active filter.
- `same` for a 0% rounded change, dates inclusive at both ends, float division in percentages, date comparisons in `trends` and `drilldown`, magic sentinel string, the `Other` segment holding one category, quadratic day grouping, `filterFacets` comment wording, and the unused copy keys: cosmetic or no named harm.

## Resolution (branch `fix/epic-7-review`)

Checks after the fixes: lint and typecheck clean, core 882 tests, mobile 2,234 tests.

**Fixed:** patches 1 to 19 (merchant filter over the whole ledger and the effective merchant, first day from confirmed live entries, budgets anchored on today for a running period, exact tag match, a normal preset forgets a custom range, null loads become errors with Retry in every section, granularity reset, income and out drills have different titles and file names, CSV carries the note, sanitises its header and refuses a blank amount, in/out net counts a refund surplus, the waiting row stays in an empty period, a failed filter load says so and a second tap is ignored, selected values outside the lists can be unticked, the percent no longer leaks in the Kept and Needs / Wants / Savings tables, chart summaries no longer announce amounts while hidden, the drill-down reacts to Hide amounts, scope labels are not headings, in/out table rows open the period, the category table header says Category and an empty share reads a dash, an empty Am I on track? says so); tests 20 to 27 (a spinner check that can fail, Retry and skeleton states in every section, a real split entry, a real transfer, hidden-amount tests that read every text and label, tag, source and facet queries, a weekly budget in a running and a past period, Activity filters, `activityQueryFor` for every target, the share saver, the filter sheet, the new BarChart props, a stricter architecture test).

**Decisions:** D2 done (Activity now filters by merchant spelling, tag and source). D3 partly: the donut labels open the category and the Needs and Wants bars open their entries in Activity; the Story 4.11 drill-down screens still do not exist. D4 done (a failing figure fails its own tile).

**D1 could not be done as chosen.** React Native's share sheet cannot attach a file on Android, so sharing a cache file also needs a native module. The export now keeps the file name as the share title, reports only a failure, and no longer claims `Exported N entries`. The Android save dialog still needs that native module.

**Not done:** patch 28 (the test kit stays beside the feature, as the other test kits in the repo do); a shell-level test that the Insights tab registers its sections and opens the drill-down; a database-backed test of `realInsightsApi`; an ended-budget case in the past-period test; tests that each of the six events refreshes every Insights loader.
