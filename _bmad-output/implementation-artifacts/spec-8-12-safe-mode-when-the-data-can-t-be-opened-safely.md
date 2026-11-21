---
title: 'Story 8.12: Safe mode when the data can''t be opened safely'
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

**Problem:** A fault in the database could turn into lost entries if the app kept writing.

**Approach:** When the data cannot be opened, or fails `quick_check`, or a migration rolled back, or the Keystore key is gone, wmbugo stops changing anything and shows the ways out: restore, back up what can be read, Diagnostics, Try again, Start fresh.

## Boundaries & Constraints

**Always:** in safe mode the writer refuses every use case with `SAFE_MODE` (scheduled writes go through the same door and stop with it); the reason is a code, logged redacted and shown in Diagnostics.

**Never:** no write is attempted in safe mode; nothing is promised that a restore does not do.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core: `classifyStartupFailure`, `quickCheckPasses`, `integrityCheckDue`, the exact wording constants; writer `setSafeMode` (done in 8.8)
- [x] mobile: `StartupGate` takes `renderError`; `StartFailure` and `SafeModeScreen` (unreadable, key lost, migration); `SafeModeBanner` and a disabled Add button for a readable database; `adapters/safeMode.ts` (classify from the file system and Keystore, enter safe mode, `quick_check` after start and once per local day); restore and erase flows work with no services
- [x] tests: core 6, mobile 12 screens, 6 adapter, App test updated for the new failure screens

## Implementation Notes

- **Retry without a restart:** the gate re-runs the start on `Try again`; success shows the app, so a rolled-back migration leaves safe mode at once.
- **Key lost** is only said when a database file exists and the Keystore answered with no key; a Keystore that could not be asked is `unreadable`, never `lost`.
- **Restore and erase with no database:** `RestoreDb` and `eraseDeps` accept a missing live database; restore then skips carrying device settings and the live-connection close, and `Start fresh` still removes the files and the key.
- **Back up what can be read** in the readable case reuses the Story 8.7 screen; `exclusive` ignores safe mode and `RecordBackupMade` is refused, so the backup completes without writing the last-backup date. In the unreadable case it is shown disabled with the reason.
- **Known gaps, honest:** the story asks for every add, edit and delete control to be disabled with the reason. What is done is the banner on every tab, the Add button disabled with the reason, and the writer refusing every other write, so any other control reports a failed save and nothing is written; the individual edit and delete controls on each screen are not disabled one by one. The forced-corruption test on a release build (flip bytes in a page, watch safe mode appear and a restore recover) is a device test and is not run. The key-lost message wording in a real Keystore-cleared phone is untested.
- Checks: lint and typecheck clean, core 1,061 tests, mobile 2,518 tests, `assembleNosmsDebug` builds, gate self-test 27/27.
