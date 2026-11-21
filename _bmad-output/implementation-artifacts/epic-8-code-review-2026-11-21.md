# Epic 8 code review (2026-11-21)

Target: commits `db4edd0`..`ffb9e42` (stories 8.1 to 8.12), reviewed in four chunks: A (8.1-8.5), B1 (8.6-8.7), B2 (8.8-8.9), C (8.10-8.12).
Layers per chunk: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor (full mode, against each story's spec). 16 reviewer runs, none failed.
Verified by reading the code: LockGate, reauth, rnRestore.writeText, readJournal, erase wiring in startApp, classifyStartupFailure, copy.restore, writer.safeReason, backup entry-name validation.

Result: 6 decision-needed, 21 patch, 11 defer, 5 rejected.

## Decision needed

- [x] [Review][Decision] D1 App lock when the settings read fails or has not finished (8.3). LockGate renders the app uncovered until settings load, and opens unlocked if the read fails. Options: cover until known and treat a failed read as locked (needs a Retry), or keep current behaviour.
- [x] [Review][Decision] D2 Screen lock removed while app lock is on (8.3). `requireReauth` returns false for `unavailable`, so the person cannot turn app lock off or change Lock after, and LockGate cannot unlock. Options: allow turning app lock off when no credential exists, or keep blocked with a clear message.
- [x] [Review][Decision] D3 Safe mode exits (8.12). A transient `quick_check` throw latches safe mode until process restart; Try again exists only for migration, Start fresh only for key-lost, and DATABASE_NEWER_THAN_APP shows "restore" advice. Options: add a re-check on the banner and Try again for unreadable, a Start fresh with a warning for unreadable, and an "update wmbugo" variant.
- [x] [Review][Decision] D4 Disabling write controls in safe mode (8.12). Only Add is disabled; the Epic UX rule says every add, edit and delete control. Options: gate every write control now, or keep the writer refusal and accept the gap.
- [x] [Review][Decision] D5 A photo that is corrupt, missing or changes during a backup (8.7). Today one bad photo fails every backup with a generic message and a missing one is skipped silently. Options: fail with a message naming the problem, or skip and report the count in the result.
- [x] [Review][Decision] D6 Restored data that fails its first start with no safety copy (8.8). The restored database stays and the toast says "Your phone is as it was before". Options: a distinct outcome and message that says the restored data could not be opened and offers Restore again or Diagnostics, or refuse to start the swap without a safety copy.

## Patch

Highest priority (data safety or privacy):

- [x] [Review][Patch] P1 Journal write is not atomic: `writeText` unlinks then moves, a kill between loses the journal and recovery discards staging while live data sits in the safety copy. `readJournal` should fall back to `restore.journal.tmp`. [apps/mobile/src/adapters/backup/rnRestore.ts:49, packages/core/src/backup/restore.ts:104]
- [x] [Review][Patch] P2 A swap failure leaves the writer in maintenance and the live database closed; `swapped = true` is set before `prepareForSwap`/`swap`. Run journal recovery or force a restart, and exit maintenance. [packages/core/src/backup/restore.ts:174-200]
- [x] [Review][Patch] P3 A failure in `finish` (notice write or restart) after a successful swap shows "Your phone is as it was before". Handle it separately and say the restore finished and wmbugo must be reopened. [RestoreFlow.tsx, restoreApi.ts]
- [x] [Review][Patch] P4 An interrupted erase that fails to finish lets startup continue on half-erased data. Stop the start with a failure screen. Also `getLogger()` runs first, so the recovery log line recreates the log directory after it was erased. [apps/mobile/src/adapters/startApp.ts:161-167]
- [x] [Review][Patch] P5 A failed erase leaves maintenance on and the database closed; `restartApp` throwing after a full erase reports failure. Exit maintenance on failure and handle restart failure. Make `Notifier.cancelAll` required. [packages/core/src/backup/erase.ts, eraseApi.ts]
- [x] [Review][Patch] P6 `restoredDatabaseOpens` can open a new empty database when the live file is missing and pass `quick_check`. Check that the file exists first. `verify()` must require exactly one profile and compare accounts in both directions. [rnRestore.ts:476-522]
- [x] [Review][Patch] P7 `restoreOutcome` is overwritten with `none` when `startAppOnce` runs again after a retry, so no toast and no `BackupRestored` announce. Keep the first non-none value. If `recoverRestore` throws, do not open the database. [startApp.ts:169-176]
- [x] [Review][Patch] P8 `LockGate`: `applyHideForAppLock(false)` runs on first mount before settings load and clears the persisted flag; store writes happen during render; a never-settling prompt leaves Unlock dead. Apply only once settings are known, move store writes into an effect, add a prompt timeout. [apps/mobile/src/features/lock/LockGate.tsx:33-106]
- [x] [Review][Patch] P9 Notification privacy: the reader returns the full form when the profile is null or throws (should fail to hidden); budgets ignore `notificationDetail: hidden` and the opt-in; bill reminders are always full; captures pass through unchanged and the hidden capture has no `Review` action; `posted` is never pruned so dismissed notifications are re-posted. [notificationPrivacy.ts, startApp.ts]
- [x] [Review][Patch] P10 Wrong-passphrase refusal lacks "Nothing on this phone changed." [apps/mobile/src/shared/copy.ts:1105]
- [x] [Review][Patch] P11 Privacy copy makes absolute claims ("can't send anything", "Nobody else can read them, including us") against the 8.2 rule. Reword. [copy.ts staysInternet/staysEntries, PERMISSIONS.md]

Backup and restore correctness:

- [x] [Review][Patch] P12 `recordBackupMade` throwing after `commit()` returns `BACKUP_FAILED` for a saved backup; an `openWrite` failure leaves an empty document; add a "preparing" phase with Cancel and poll cancel during the export and digest pass. [runBackup.ts, BackupScreen.tsx]
- [x] [Review][Patch] P13 A newer format version returns `NOT_A_WMBUGO_BACKUP` instead of `BACKUP_TOO_NEW`; reader accepts a manifest with no `db` entry and unbounded sizes; reader memory cap is 1 GiB (lower to the real parameters plus margin); full disk during extract is reported as damaged. [format.ts, reader.ts]
- [x] [Review][Patch] P14 Kotlin: `openRead` leaks its `ParcelFileDescriptor`; `openDecrypted` leaks the stream on failure and reads the IV with a single `read`; no `abortEncrypted` for staging; `restartApp` can lose the launch or exit with no intent. [BackupFilesModule.kt]
- [x] [Review][Patch] P15 Back is not blocked: `App.tsx` mounts `RestoreFlow` without `onBusyChange`, the `checking` step is not busy, `EraseFlow` renders `BackupScreen` without `onBusyChange`, and `SafeModeBanner` has no `BackHandler`. Double tap on Restore can start two runs.
- [x] [Review][Patch] P16 Restore: free-space check ignores staging size and is skipped without a safety copy; the preview line "nothing on this phone changes" shows even when "without a safety copy" is ticked; the `This phone now` card is not refreshed after a backup. [restore.ts, RestoreFlow.tsx]
- [x] [Review][Patch] P17 Weak passphrase passes ("aaaaaaaaaaaa" is Strong enough) and the 12-character rule lives in the UI only. [policy.ts]

Logs, crashes, diagnostics:

- [x] [Review][Patch] P18 Log redaction: `₹5`/`$7` and plain decimals survive `scrubText`; string values on allowed keys (`merchantId`, `reason`) are not constrained; crash message continuation lines and crash frames are not scrubbed; `crashLine` skips frames at export. [logger.ts, crashRecord.ts, diagnostics.ts]
- [x] [Review][Patch] P19 Crash capture: a fatal JS error is recorded asynchronously then the process dies; early crashes race `ensureDir`; non-fatal storms rotate fatal records out of the cap of 20; native `quote` does not escape control characters. [crashHandlers.ts, crashRecord.ts, NativeCrashRecorder.kt]
- [x] [Review][Patch] P20 Diagnostics: `schemaVersion` can print `NaN`; database size should use `RESTORE_LAYOUT.dbPath` plus `-wal`/`-shm` and report "Not available" when missing; the export fallback should disable Save when `report()` fails; `ParserCheck` needs a try/catch; full-screen safe mode never records the start failure code. [adapters/diagnostics.ts, DiagnosticsScreen.tsx]
- [x] [Review][Patch] P21 Tests and hygiene: add tests for `rnRestore`, `rnBackupPlatform`, `backupFiles`, `rnErase`, `saveReport` chunking, `startApp` wiring, `BackupRestored` reminder resync, the safe-mode banner inside `RootNavigator`, native crash JSON fixture; fix the `permissions.test.ts` operator precedence, the tautological assertion at `restore.test.ts:1967`, the unrestored spy in `notifier.test.ts`, the "killed at every step" erase test range, the `PERMISSIONS.md` test file name (`osBackup.test.ts`), the binary `scripts/test-gates.mjs` (add `.gitattributes`), the denylist gate passing on an empty Gradle report, and the orphaned docblock in `keychainKeyStore.ts`.

## Deferred

- [x] [Review][Defer] Device checks: `CipherInputStream` swallowing the GCM tag error on some Android versions; `react-native-libsodium` parity with libsodium-wrappers (known-answer vector); BiometricPrompt weak-biometric behaviour on API 26-29; `.wmbugo.bin` rename by some providers. Settle on the phone.
- [x] [Review][Defer] `startAppOnce` test needs a small refactor to extract the recovery block. Not worth the churn now.
- [x] [Review][Defer] Screen-level test that edit/delete show the safe-mode refusal (depends on D4).
- [x] [Review][Defer] Argon2id runs up to three times (preview, readManifest, extract); the passphrase stays in React state. Revisit after measuring on the phone.
- [x] [Review][Defer] Pure-TypeScript secretstream instead of libsodium on the phone is a disclosed deviation; revisit after measuring speed.
- [x] [Review][Defer] No committed schema-N backup fixture (needs a real SQLCipher export from a device).
- [x] [Review][Defer] Notification library not installed: capture and Review paths, `deliverIntent` and the resume refresh have no caller until Epic 11.
- [x] [Review][Defer] Core `ChangeSetting` accepts `lock_after`/`hide_in_recents` without re-auth; the guard is UI-only. Revisit with the use-case boundary.
- [x] [Review][Defer] Key-derivation and manifest strengthening (separate verifier subkey, header bound as associated data). Format is already shipped to the backup spec.
- [x] [Review][Defer] Time-zone label inconsistency and string handling in the restore notice.
- [x] [Review][Defer] CI symbols upload retention and `if-no-files-found: warn`.

## Rejected

- `Diagnostics reads the wrong writer property`: false. `LedgerWriter.safeReason` exists (`ledgerWriter.ts:112`); only the adapter test's fake uses a different name.
- `Staging entry names can traverse out of staging`: false for the real path. `format.ts` validates entry names (SEC-006); the slice in `rnRestore.openEntry` only sees names that already passed.
- `Unknown secretstream tags are accepted`: low. Only tag 0, 1 and 3 are ever written; the format is authenticated, so an attacker cannot forge a REKEY tag.
- `Log directory flash of unlocked amounts only on cold start`: merged into P8 and D1.
- `Dead \`started\` variable in BackupScreen`: low, folded into P12.

## Decisions (2026-11-21, KCPK)

- D1 fail closed: cover until settings are known; a failed read counts as locked, with Retry. Now patch.
- D2 allow turning app lock off when the phone has no screen lock, and say so. Now patch.
- D3 add all three safe-mode exits: banner re-check, Try again on unreadable, "update wmbugo" variant for a newer database. Now patch.
- D4 keep Add disabled plus the writer refusal; the rest deferred (screen-level refusal test stays deferred).
- D5 skip a bad or missing photo and report the count in the result. Now patch.
- D6 distinct outcome and message when restored data fails its first start with no safety copy. Now patch.

Totals after decisions: 0 decision-needed, 26 patch, 12 defer, 5 rejected.

## Patches applied (branch fix/8-review-findings)

All 26 patches are applied and tested, in five commits on `fix/8-review-findings` (restore and erase safety; app lock and safe mode; notification privacy; backup format, runner and native files; redaction, crash records, diagnostics and tests).

Not done, by choice:
- P21 test for `startAppOnce` wiring stays deferred (needs the small refactor named above).
- Safe mode `unreadable` still has no Start fresh: erasing data that might be recoverable should stay a deliberate step, and D3 asked for three exits (re-check, Try again, update).
- Native pieces (Kotlin changes, the SQLCipher export, BiometricPrompt, recents hiding) compile (`assembleNosmsDebug` passes) but have not been tried on a phone.
