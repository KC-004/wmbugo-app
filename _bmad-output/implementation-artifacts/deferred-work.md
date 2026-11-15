
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Choose and add a native backdrop-blur library so Glass blurs behind its tint (currently tint and border only).
  evidence: Story 1.8 AC asks for blur; no library is chosen and each adds a native dependency. Decide alongside the S8 glass frame-rate measurement.
- source_spec: `spec-1-8-design-tokens-theming-and-brand-assets.md`
  summary: Replace the placeholder coin-flip Lottie with the final asset (GATE-12).
  evidence: Placeholder shipped on purpose; the AC allows it until GATE-12.
- source_spec: `spec-4-1-categories-screen-add-edit-reorder-icons-palette-colours-and-need-want-type.md`
  summary: SaveCategory should refuse (or define behaviour for) editing an archived category.
  evidence: Review of 4.1: edit path does not check archived; unreachable from the UI until Story 4.3 archives categories.

## Deferred from: code review of Epic 4, chunk A: money, periods, migrations, alerts (2026-11-13)

- **A budget alert is recorded as fired before it is posted** (`planning/budgetAlerts.ts`, `startApp.ts`). If the notifier is unavailable, permission is not granted or `post` throws, the crossing is already in `budget_alert_fired` and is never retried, so a permission granted later delivers nothing for that period. Real today only because `appNotifier` is `unavailableNotifier`. Needs a separate "notified" state (a column and a migration) decided together with the react-native-notify-kit adapter story. Marked medium.
- **A pending next-period limit cannot be cancelled by an edit that equals the latest version** (`SaveBudget` target versions). Editing to the value already in force, with a future version pending, adds nothing. Needs a rule for superseding future versions (decide with Story 4.7 follow-up). Marked low.
- **`reopenBudgets` requires every category of an ended budget to be restored at once** (`planning/budgetStore.ts`). A two-category budget that ended after both were archived stays ended when only one comes back. Marked low; rare.
- **Migration 0018 stamps `category_set_by = 'user'` on every entry with `needs_category = 0`, including transfers and card payments that never had a category.** It cannot be edited now (applied on the dev phone, and the checksum guard forbids it); harmless, because `ApplySuggestion` only acts on single-category expenses and incomes.
- **Missing CHECK constraints** on `category_guessed`, `category_set_by`, `budget_period.target_minor` and scope-versus-field consistency (`budget`). Adding them needs a table rebuild migration. Marked low.

## Deferred from: build of Story 5.1 (2026-11-15)

- source_spec: `spec-5-1-home-read-model-refresh-and-stale-indication.md`
  summary: Assert `refundSurplusMinor`, `period.shortened` and `daysLeft` for a budget on a non-default period in `homeSummary` tests, and test `realHomeApi.load` mapping.
  evidence: Verification-gap review of 5.1: these fields are not rendered until Story 5.2, whose hero is the first consumer; the mapping is thin and was only checked by hand.
- source_spec: `spec-5-1-home-read-model-refresh-and-stale-indication.md`
  summary: Split Home into independent per-card queries so one failing card does not blank the others.
  evidence: 5.1 keeps one combined `home.summary` query; the cards in 5.4 and 5.5 need their own queries to meet the per-card error criterion.
