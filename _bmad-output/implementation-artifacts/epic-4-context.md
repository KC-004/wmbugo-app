# Epic 4 Context: Categories and budgets

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users shape their categories (names, icons, 12 palette colours, one level of subcategories, Need/Want types, spending/income/both kinds, archive and merge with a preview) without any amount ever changing. They also set budgets for any period, including the pay cycle and a one-tap 50/30/20 split, and see honest used / left / status figures that respect refunds, with one calm alert per threshold per period. The epic adds the `planning` module's budget tables, extends the profile period service and delivers the read models (`budgetUsed`, `budgetStatus`, `leftInBudget`, `needsWantsSavings`) that Home (Epic 5), Plan's Free to use (Epic 6) and Insights (Epic 7) consume.

## Stories

- Story 4.1: Categories screen — add, edit, reorder, icons, palette colours and Need/Want type
- Story 4.2: Category kinds — spending, income or both
- Story 4.3: Archive and merge categories with a remap preview
- Story 4.4: Suggested categories are always overridable
- Story 4.5: Budget rules and the budget-used read model
- Story 4.6: Budget list and editor with limit bars
- Story 4.7: Budget detail, past periods and target changes
- Story 4.8: Changing payday mid-cycle — the shortened cycle
- Story 4.9: Budget threshold alerts, once per threshold per period
- Story 4.10: One-tap 50/30/20 targets
- Story 4.11: Needs, Wants and Savings progress and Left in budget

## Requirements & Constraints

- Editing or merging categories never changes a transaction amount, split amount or posting; past-period totals stay the same. Writer asserts this and property tests prove it.
- Category names are unique among active categories of the same kind (case and surrounding spaces ignored). `Uncategorised` and `Other` are system fallbacks: no rename, archive, merge, delete or type/kind/colour edit.
- Palette is exactly the 12 `cat-*` colours; no free colour or hex entry. Icons are Phosphor outline only.
- Budgets are lasting rules measured over a period; a new period starts at zero with no rollover and nothing is ever reset. Past periods keep the target version they had.
- Used = confirmed, non-removed expense splits in scope minus refund splits in scope, excluding transfers, card payments, needs-review, excluded and reversed entries. Each top-level category is floored at zero first and then summed. A refund never inflates what is left; the surplus is shown separately.
- One overall budget only. Overlapping category budgets are labelled, never added together. Overall, 50/30/20 and category groups are never summed.
- Shown amounts never use a minus sign: "Over by ₹X". Savings never shows warning or "Over by". Alerts never contain amounts; one alert per threshold per period, never for closed periods.
- Payday, period or first-day-of-week changes rebuild derived `budget_period` rows but modify no transaction.

## Technical Decisions

- `ledger` owns the category table; `planning` owns `budget`, `budget_target_version`, `budget_period` (derived cache) and `budget_alert_fired`. Modules never read each other's tables. One migration per story that needs a table; money columns end in `_minor`.
- All writes go through the `LedgerWriter` named use cases (`SaveCategory`, `ArchiveCategory`, `MergeCategory`, `SaveBudget`, `CreateFiftyThirtyTwenty`, ...), each with an audit row and outbox events in the same transaction. New events (`CategoriesChanged`, `BudgetsChanged`, `CategoryAssigned`, `BudgetThresholdCrossed`) are added to the type-checked catalogue with query-key invalidation maps.
- The profile period service is the only place that converts dates to periods (calendar month, pay cycle, weekly, custom, shortened cycle, `previousPeriod`); planning code must not compute boundaries (architecture test).
- Expected failures are typed `Result` codes (e.g. `CATEGORY_KIND_MISMATCH`) each mapped to a copy-catalogue string. All strings come from the catalogue.
- `category.budget_type` exists from the first schema; changing it re-buckets spending for every period without touching amounts.
- `CategorySuggester` and `Notifier` are ports; default suggester returns nothing. Notifications use the react-native-notify-kit adapter on a `Budget alerts` channel with a public lock-screen version.
- Event handlers are idempotent on event id.

## UX & Interaction Patterns

- Settings hub gains a `Money` group (SCR-18 Categories). Category add/edit is a sheet; one sheet at a time; sticky footer; inline `Error:` messages move focus to the field and keep input.
- Limit bar (UX-DR25): 8dp bar, tick at the limit, hatched overflow capped at 20%, status line below, TalkBack reads one node per row from the read model. Needs/Wants/Savings use their own colours with an outline on light surfaces.
- Toasts with Undo for saves, deletes, merges. Plan tab shows SCR-14 Budgets until the Plan hub (Epic 6).
- Accessibility: 48dp targets, drag-reorder always has Move up/down and TalkBack custom actions; meaning never by colour alone; hide-amounts masks amounts but keeps day text.

## Cross-Story Dependencies

- 4.1 → 4.2 → 4.3 (category sheet and ledger writer). 4.4 depends on Story 3.2's pipeline and 3.5's `guessed` tag.
- 4.5 is the base for 4.6–4.11; 4.8 extends the period service from 4.5; 4.9 needs 4.6's editor and Story 3.8's `closedPeriodTouched`; 4.11 needs 4.10 and Story 2.8's `savingsMovedIn`.
- 4.3 and 4.6 are linked: archiving or merging the only category of a budget ends that budget after the current period.
- Outputs feed Epic 5 (Home), 6 (Plan) and 7 (Insights).
