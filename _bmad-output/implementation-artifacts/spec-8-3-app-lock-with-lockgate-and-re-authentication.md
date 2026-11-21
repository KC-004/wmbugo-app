---
title: 'Story 8.3: App lock with LockGate and re-authentication'
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

**Problem:** Anyone holding an unlocked phone can open wmbugo and read the finances; the re-authentication guard from Story 3.13 lets every action through.

**Approach:** A device setting `app lock` turned on only after the system BiometricPrompt succeeds; LockGate covers cold starts and returns after `Lock after`, measured on the monotonic clock; a pending-intent queue holds taps while locked; the shared guard asks `Confirm it's you` when app lock is on.

## Boundaries & Constraints

**Always:** app lock is a UI gate only: the database key is not bound to biometrics (AD-9); the tree stays mounted under the gate so the person returns to the same screen and draft.

**Never:** nothing is saved when the prompt is cancelled or the phone has no screen lock; no wall-clock reads for the lock decision.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core: `device.app_lock_enabled`, `device.lock_after` (default 1 minute), `SetAppLock` use case (refused through `ChangeSetting`), `shouldLock`, `createPendingIntentQueue`
- [x] native: `AppLockModule.kt` (BiometricPrompt, device-secure check, elapsed realtime, security settings), `androidx.biometric` dependency, `USE_BIOMETRIC` in the manifest
- [x] mobile: `appLock.ts` adapter, `lockStore`, `LockGate`, `appIntents`, real `requireReauth`, Privacy page controls, summary `App lock on|off`
- [x] allowlist and `PERMISSIONS.md` row for `USE_BIOMETRIC`; `STATES.md` confirm tier
- [x] tests: `appLock.test.ts`, `settings.test.ts`, `lockGate.test.tsx`, `reauth.test.ts`, settings screen tests

## Implementation Notes

- The prompt authenticators follow the story: Android 11+ `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`; Android 8 to 10 `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`. `USE_FINGERPRINT` stays removed from the manifest, so on Android 8 and 9 the device credential is offered rather than the fingerprint (documented in `PERMISSIONS.md`).
- Turning app lock on also turns `Hide wmbugo in recent apps` on; the native `hide_for_app_lock` preference enforces the hiding regardless of that setting (Story 8.2 module).
- `LockGate` queries settings with `retryOnMount: false`: two observers of a failing read looped the App test otherwise.
- `deliverIntent` is the single entry point for taps and deep links. No notification adapter exists yet, so nothing calls it in the app today; the queue is tested through LockGate.
- Known gaps: if the settings read fails while app lock is on, the app opens unlocked (the database is unusable then, and Story 8.12 makes that safe mode); the BiometricPrompt and lockout wording were not run on a device; the amount-free cover is visual, since the tree underneath stays mounted and hidden from accessibility.
- Checks: lint and typecheck clean, core 901 tests, mobile 2,309 tests, Kotlin compiles.
