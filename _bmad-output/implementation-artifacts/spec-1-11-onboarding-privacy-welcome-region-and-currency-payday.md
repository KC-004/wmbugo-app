---
title: 'Story 1.11 - Onboarding: privacy welcome, region and currency, payday'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'e3e004c'
---

## Intent

Implements the epic's Story 1.11 acceptance criteria (see epics.md).

## Implementation Notes

- Core `profile` module: Phase 1 region table (34 regions, every currency covered; test enforces it), search by country or currency with the detected region pinned first, payday rules and the default period (pay cycle, or calendar month for Not salaried), a pure onboarding state machine (Back keeps answers, Continue disabled until the step is answered), and the `SetUpProfile` use case (one transaction: profile, settings theme=System, the 50/30/20 answer, ProfileChanged; refuses a second profile).
- Migration 0003 (`profile`, `settings`, `prompt_state`) generated from `profile.schema.ts`; the schema lint accepts it.
- Mobile: `OnboardingFlow` (Welcome, region with live preview through `<Amount>`, searchable region picker, payday chips with Other day 1-31, optional 50/30/20 with rough income, Finish), device region from a native method, `App` routes onboarding to Home on success. Nothing is written before Finish; a failed save shows the calm error with "Nothing was saved" and allows another try.
- The 50/30/20 answer is stored as `prompt_state` rows (`budget_503020_yes` / `budget_503020_not_now`); the rough income goes to a `settings` row (`budget.rough_monthly_income_minor`) because `prompt_state` has no value column. No budget is created.
- Tests: zero permission requests in the whole flow (spies on PermissionsAndroid and Linking), no network call, end-to-end through the App, double-tap Finish saves once.

## Verified on the Redmi (release build)

- Migration 3 ran on the existing database and took the first real non-empty safety copy (36,864 bytes, encrypted header).
- Onboarding completed by hand into the shell; after a force-stop the app reopens on Home (`route: home`), so the profile persisted.

## Not done / open

- The "under 2 minutes in airplane mode" moderated run was done by hand but not timed or recorded; the phone was not in airplane mode (the app makes no network call and the release build has no INTERNET permission).
- Device region uses the primary locale's country. Android 14+ regional preferences that differ from the locale are not read; "India with English (US)" works when the locale carries the region (en-IN); a phone set to en-US with an India regional preference would show United States. Needs a LocaleManager-based read when we target that case.
- The region list is virtualised (first screenful), which is fine for 34 rows but means search is the way to reach most of them.

## Review Triage Log

Inline self-review plus device run. Fixed: (1) high - Finish could save twice on a quick double tap (stale state closure); now a ref guard, with a test. (2) medium - my first draft let feature code call the formatter, which the Story 1.9 lint bans; the preview now uses `<Amount>` and `currencySymbol` moved to its own module. (3) low - an invalid income used a type cast hack; replaced by a `clear-budget` action.
