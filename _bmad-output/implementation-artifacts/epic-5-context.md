# Epic 5 Context: Home: "Am I okay?"

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Before the user scrolls, Home answers "Am I okay this period?": how much is left in the budget (or, honestly, how far over), what is in accounts and owed on cards, whether anything waits to be checked, and where the money went this period and over the last seven days. Every value says which period and accounts it covers, refreshes by itself when anything changes, can be masked everywhere with one persistent tap, and lets the user reorder and hide cards. The epic builds on the existing Home shell, the account overview totals, the review-queue `toCheck` set and the budget read models; it adds no ledger tables and changes no amounts.

## Stories

- Story 5.1: Home read model, refresh and stale indication
- Story 5.2: The "Am I okay?" hero card
- Story 5.3: Hide amounts with one tap
- Story 5.4: Home cards: things to check, income and expense, budgets and net worth
- Story 5.5: Top categories and 7-day spend charts with view-as-table
- Story 5.6: Edit Home: reorder, hide, resize and reset cards

## Requirements & Constraints

- One consistent snapshot feeds Home; no screen computes balances, totals or periods itself.
- Money is integer minor units; shown amounts never use a minus sign ("Over budget", "Over by"). In accounts and Card dues are never summed. An unknown balance is never shown as zero.
- Every Home value carries its scope (period or accounts) as a caption; during a recompute longer than 300 ms the old values stay with an `Updating…` caption, the first load uses skeletons, and values fade in (never count up). A failing card shows its own inline error with Retry and nothing else breaks.
- Warm-start Home shows the hero and first card within p95 2 s on the reference device with 10,000 records.
- Hide amounts is a persistent profile setting masking every amount app-wide through the shared amount component; ratio-of-money bars and percentages are hidden too, counts and days stay.
- Accessibility: the hero is one merged TalkBack node built from the view model; large fonts stack and grow instead of truncating.

## Technical Decisions

- `homeSummary(today)` lives in the read-only `insights` module and composes owners' queries only (period service, budget read models, account overview, review queue); no new aggregation of postings or splits.
- The hero presenter is a pure function in `apps/mobile/src/features/home` returning a state (`under`, `over`, `spent_only`, `loading`) and flags; it has no path that outputs a negative amount.
- Refresh goes through the outbox event catalogue: events invalidate the matching TanStack Query areas (`home`, `budgets`, `ledger`, ...). Home also refreshes on foreground and on a date or period change while open.
- Any new index needed for the read model ships as a ledger-module migration (one migration per story; never edit an applied migration).
- Hide amounts is a `profile` setting changed only by a named use case with audit and `ProfileChanged`.

## UX & Interaction Patterns

- Hero: gradient band with an overhanging glass card (light), glows only (dark); tapping the hero opens the budget detail; the eye button toggles masking.
- Loading uses skeleton tiles; errors are per-card; masked amounts render the currency symbol plus four dots in the same type role.

## Cross-Story Dependencies

- 5.2 to 5.6 depend on the 5.1 read model and refresh behaviour; 5.3's setting is also bound by Settings in Epic 8.
- Depends on Epic 4 budget read models (`leftInBudget`, `budgetStatus`), Epic 2 overview totals and Epic 3's `toCheck` count.
- Epic 6 adds Home cards (Coming up, Savings goal) and Epic 11 the widget, both through the same invalidation catalogue.
