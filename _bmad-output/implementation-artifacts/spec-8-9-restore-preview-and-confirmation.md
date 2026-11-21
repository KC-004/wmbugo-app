---
title: 'Story 8.9: Restore preview and confirmation'
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

**Problem:** The restore engine exists, but there is no way to choose a file, see what is in it next to what is on the phone, and agree to the replacement.

**Approach:** A flow used by Settings › Data and by the Welcome screen: file picker, header check, one passphrase field, a manifest preview card, a checkbox (and a second one when there is no room for a safety copy), the re-authentication guard, a `Restoring…` view, then a restart on Home.

## Boundaries & Constraints

**Always:** every refusal says `Nothing on this phone changed.`; Restore is disabled until the checkbox is ticked; no copy promises a kept safety copy; no typed-word confirmation.

**Never:** no cancel while restoring; nothing is replaced before the last tap.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core: `inspectBackupHeader` (magic and version only, no passphrase), `madeAtLabel`
- [x] mobile: `RestoreFlow`, `restoreApi`, `RestoreNoticeHost`, `restoreNotice` (a file in the private directory read once after the restart), copy
- [x] Settings › Data gains `Restore from backup`; Welcome gains the text button `Restore from a backup`; the flow's busy state blocks Back
- [x] `PassphraseField` can take focus again on a signal (wrong passphrase)
- [x] tests: `restore.test.tsx` (19), Welcome (2), Settings, core helpers (2)

## Implementation Notes

- **From Welcome** the preview says `Nothing yet` for this phone and hides `Back up this phone first`; after the restart the restored profile exists, so onboarding is skipped by the normal route.
- **Back up this phone first** shows the Story 8.7 screen inside the flow and returns to the same confirmation; the picked file and manifest are kept (no second pick).
- **After the restart**, Home toasts `Restored from your 3 Nov backup`; if the restored data failed its start checks and the safety copy was put back, it says `The restore didn't finish. Your phone is as it was before.`
- **Not verified on a device:** the file picker, restoring a real backup made on another phone, the restart, and TalkBack announcing the checkbox state change (the role and `checked` state are set and tested).
- Checks: lint and typecheck clean, core 1,036 tests, mobile 2,433 tests.
