---
title: 'Story 8.7: Make a backup with a passphrase'
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

**Problem:** The format exists (8.6) but nobody can make a backup.

**Approach:** Settings › Data › Back up: a passphrase typed twice, Android's save dialog, a writer hold for a consistent snapshot, a determinate progress view with Cancel, and a result that states what was saved.

## Boundaries & Constraints

**Always:** only encrypted bytes reach the chosen document; a failure or cancel deletes the partial document and leaves the phone unchanged; held use cases run afterwards and nothing is rejected.

**Never:** no storage permission; no plain photo or database on disk during a backup.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core: `RecordBackupMade` and `backup.last_backup_at`; `LedgerWriter.exclusive`; `readBackupFacts`; `runBackup` with a `BackupPlatform` port; passphrase, name and summary helpers
- [x] native: `BackupFilesModule.kt` (save dialog, picker, streamed write and read, in-memory photo decryption), registered in `MainApplication`
- [x] mobile: `rnBackupPlatform` (SQLCipher `sqlcipher_export` into a staged database keyed with the archive key), `backupFiles`, `base64`, `PassphraseField`, `BackupScreen`, Settings Data rows and summary, staging sweep at start
- [x] docs and tests: `PERMISSIONS.md` section and `osBackup.test.ts`; core 13 runBackup tests; mobile 10 screen tests, 3 base64, 2 settings

## Implementation Notes

- **The writer hold is `LedgerWriter.exclusive`:** a job on the writer's own queue, so everything submitted earlier finishes, everything submitted meanwhile waits and then runs. Tested with a late write that is not in the snapshot and is not rejected.
- **Counts and balances:** entries exclude opening balances; photos come from the entries actually included; an account whose balance is not set is left out of the balances.
- **Photos never touch the disk in plain form:** the native module decrypts the device-encrypted file into memory and streams it; the GCM tag is checked at the end. The staged database is a SQLCipher file, so no `SQLite format 3` header appears.
- **Native build:** `react-native-libsodium` needed two fixes on Windows: a patch so CMake does not read backslashes in the node_modules path (`patches/react-native-libsodium@1.7.0.patch`), and `allowBuilds` for its postinstall, which unpacks the prebuilt libsodium. `assembleNosmsDebug` now links (exit 0) with the Kotlin modules.
- **Not verified on a device:** the `ATTACH DATABASE ? AS backup KEY ?` plus `sqlcipher_export` call with bound parameters, the save dialog, the streamed write, the speed of the pure-JS secretstream on a phone (the progress view must be tried with a large backup), the file-system search for plain databases, JPEG and manifest text during a backup, and `bmgr backupnow` / device transfer. The static test only proves the exclusion rules.
- Reminders (Story 8.8): `BackupRestored` does not exist yet.
- Checks: lint and typecheck clean, core 1,006 tests, mobile 2,384 tests.
