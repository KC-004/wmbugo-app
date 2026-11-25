---
title: 'Snap a receipt with the camera'
type: 'feature'
created: '2026-11-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5c158e6'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Receipts can only come from the gallery; the checkout needs one long-press to the camera.

**Approach:** A full-screen VisionCamera route (72dp `Take photo`, `Choose a photo`, `Light`, `Close`, then `Use photo` / `Retake`), opened from the `Snap receipt` chip, a long-press on ＋ or the TalkBack action `Snap receipt`. The camera permission is asked there, the first time. A used photo goes through the Story 10.6 intake and reading with provenance `camera`.

## Boundaries & Constraints

**Always:** the temporary photo is deleted after intake, on Retake and when leaving unused; nothing is written to the gallery; the permission is asked only on this screen; denied leaves the picker and Enter it by hand working.

**Never:** ask for the camera during onboarding; add `INTERNET` or `ACCESS_NETWORK_STATE`.

</frozen-after-approval>

## Code Map

- `adapters/camera/VisionCameraSurface.tsx`, `cameraSurface.ts` -- the real camera behind a seam the screen is tested through
- `features/receipt/ReceiptCameraScreen.tsx` -- controls, permission states, retake / use
- `adapters/permissions.ts` -- kind `camera` (VisionCamera status, loaded on first use)
- `features/shell/AddButton.tsx`, `TabBar.tsx`, `RootNavigator.tsx` -- long-press, custom action, `ReceiptCamera` route; `useOpenAdd.tsx` chip now opens the camera
- `AndroidManifest.xml` (CAMERA; `ACCESS_NETWORK_STATE` removed, it comes from media3), `scripts/android-permission-allowlist.json`, `shared/PERMISSIONS.md` row

## Tasks & Acceptance

**Execution:**
- [x] Camera screen, surface adapter, permission kind, routes, ＋ long-press and action, manifest and inventory, tests

**Acceptance Criteria:**
- Given the camera never asked, when the route first opens, then the system prompt is asked there; when denied, `Camera is off for wmbugo` with `Pick a photo instead`, `Enter it by hand` and `Open settings`.
- Given a taken photo, then `Use photo` reaches the intake with provenance `camera` and the temporary file is deleted.

## Implementation Notes

Added `react-native-vision-camera` 5.2.4 with `react-native-nitro-modules` and `react-native-nitro-image` (pnpm); the nosms debug build and both release manifests build, the permission allowlist (CAMERA only added) and the dependency denylist pass. **Never run on a phone:** the preview, shutter, torch and the system prompt were only tested with a fake surface. Not done: a Switch Access run, the app-switcher snapshot check, and the LockGate-before-camera check on a phone (the route sits inside the existing LockGate stack). `Pick a photo instead` and `Choose a photo` replace the camera with the Story 10.6 scan; the Add sheet is reopened only when the camera was opened from its chip.

## Spec Change Log

## Review Triage Log
