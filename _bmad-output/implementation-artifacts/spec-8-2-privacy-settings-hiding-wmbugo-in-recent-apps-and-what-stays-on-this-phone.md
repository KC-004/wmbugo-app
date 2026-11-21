---
title: 'Story 8.2: Privacy settings, hiding wmbugo in recent apps and what stays on this phone'
type: feature
created: '2026-11-21'
status: in-review
route: dispatch
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Settings has no Privacy place; the app switcher shows wmbugo's content; nothing tells the user plainly what stays on the phone.

**Approach:** A Privacy group with a live summary, a Hide amounts switch bound to `SetHideAmounts`, a `Hide wmbugo in recent apps` device setting applied natively (Android 13+ recents screenshot off, 8 to 12 `FLAG_SECURE`) to every activity, and a plain `What stays on this phone` page.

## Boundaries & Constraints

**Always:** the summary is part of the row's spoken label and is built from the parts that exist; no row claims data can never leave the phone.

**Never:** no typed claim of impossibility; no new ledger tables; app lock and notification parts of the summary arrive in 8.3 and 8.5.

</frozen-after-approval>

## Tasks & Acceptance

- [x] `packages/core/src/profile/settings.ts` -- `device.hide_in_recents` setting, `privacySummary`
- [x] `PrivacyModule.kt`, `MainApplication.kt` -- native hiding for every activity, kept in a private preference for cold starts, plus a separate app-lock reason for 8.3
- [x] `recentsPrivacy.ts`, `SettingsBridge.tsx` -- apply when the setting is known
- [x] `SettingsScreen.tsx`, `copy.ts` -- Privacy group, switches, What stays on this phone
- [x] tests in `settings.test.tsx`, `settings.test.ts`, `recentsPrivacy.test.ts`

## Implementation Notes

- The setting key is `device.hide_in_recents` (the `device.` prefix marks settings a restore keeps from this phone, Story 8.8). `ChangeSetting` validates it as a boolean; no migration is needed.
- "Switched on automatically when app lock is turned on" is delivered in 8.3 through the separate native `hide_for_app_lock` preference (`setHideForAppLock`), so turning app lock off does not flip the user's own choice.
- The Privacy summary reads `Amounts shown` or `Amounts hidden`; 8.3 and 8.5 prepend and append their parts through the same function.
- The manual check that the recents snapshot is blank (Android 13+) and that screenshots are blocked (8 to 12) needs a device; not run here. The Kotlin compiles (`compileNosmsDebugKotlin`).
- Checks: lint and typecheck clean, core 892 tests, mobile 2,270 tests.
