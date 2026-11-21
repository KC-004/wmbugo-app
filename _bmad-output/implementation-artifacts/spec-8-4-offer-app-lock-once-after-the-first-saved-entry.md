---
title: 'Story 8.4: Offer app lock once after the first saved entry'
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

**Problem:** App lock exists but nobody learns about it unless they open Settings.

**Approach:** After the first saved entry, once, a bottom sheet offers app lock. It never appears during onboarding, over another sheet, or again.

## Boundaries & Constraints

**Always:** `prompt_state` records `app_lock_offer` the moment the sheet opens; the enable flow is the Story 8.3 flow.

**Never:** no sheet when app lock is already on, when the phone has no screen lock (nothing recorded), or when the save was undone before the sheet appeared.

</frozen-after-approval>

## Tasks & Acceptance

- [x] `enableAppLock.ts` -- the 8.3 enable flow extracted and shared with Settings
- [x] `AppLockOfferHost.tsx`, `appLockOfferBus.ts` -- the offer lives above the Add sheet (which closes right after a save); a save schedules it after the toast, Undo cancels it
- [x] `AddSheet.tsx` -- schedules after an entry or transfer is saved; not on a failed save, an edit or a possible duplicate
- [x] `RootNavigator.tsx` -- hosts it inside the sheet and toast hosts, so onboarding never mounts it
- [x] tests: `appLockOffer.test.tsx` (8), `add.test.tsx` (2)

## Implementation Notes

- The condition is "never shown", not "exactly one entry": the first save evaluates it, and an Undo before the sheet cancels it without recording, so the next saved entry can offer it. A `Save and add another` save leaves the Add sheet open, so the offer is skipped (never over another sheet) and evaluated again after the next save.
- The sheet title follows `availableKind()`: `fingerprint` for an enrolled strong biometric, `screen lock` when only a credential exists; with neither, nothing appears and nothing is recorded.
- The Story 8.3 enable flow is reused: it needs the system prompt to succeed, saves app lock on with the default `After 1 minute`, turns the app-switcher hiding on, and the toast reads `App lock on`. A cancelled prompt leaves it off and the offer is not repeated.
- Not run on a device. Checks: lint and typecheck clean, mobile 2,324 tests.
