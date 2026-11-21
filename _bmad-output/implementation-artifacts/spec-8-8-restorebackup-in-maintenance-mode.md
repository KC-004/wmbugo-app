---
title: 'Story 8.8: RestoreBackup in maintenance mode'
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

**Problem:** There is a backup file but no safe way back: a wrong file, a wrong passphrase or a crash mid-restore must never cost the person their data.

**Approach:** A restore that stages and verifies first, swaps by journalled atomic renames with a safety copy, and is undone or finished by a recovery step at every start. A maintenance mode in the writer refuses other use cases meanwhile.

## Boundaries & Constraints

**Always:** typed errors before any change; the working data is byte-identical after a refused restore; plaintext only in memory or encrypted staging; device settings (app lock, Lock after, hide in recents) stay from this phone.

**Never:** no swap before `quick_check`, invariants and every account balance match the manifest.

</frozen-after-approval>

## Tasks & Acceptance

- [x] writer: `setMaintenance` (use cases refused with `MAINTENANCE`, `exclusive` still runs), `setSafeMode` (`SAFE_MODE`, used by 8.12)
- [x] core `backup/restore.ts`: ports (`RestoreFs`, `RestoreDb`, `Maintenance`), `restoreBackup`, `recoverRestore`, `AnnounceBackupRestored`, the `BackupRestored` event
- [x] mobile `rnRestore.ts`: file system adapter, staged migrate-then-re-key through `sqlcipher_export`, photos encrypted with the device file key as they arrive, device settings carried, whole-database checks, start checks
- [x] native: `openEncryptedWrite` / `writeEncrypted` / `closeEncrypted` / `restartApp` in `BackupFilesModule`; `startApp` runs `recoverRestore` before the database opens
- [x] tests: 23 restore (including every kill point), 5 writer modes; reminders resync on `BackupRestored`

## Implementation Notes

- **Fault injection is exhaustive:** a freezing file system kills the process after each of the first 40 file operations of a real restore; recovery then runs. With a safety copy the next start always finds either the old data intact or the restored data, never a mixture, and nothing but live data is left behind. Without one, a swap cut short is completed from staging. This found a real bug during writing: rolling back with no safety copy yet would have deleted the live database; recovery now replaces only what reached the safety copy.
- **Journal:** `restore.journal` holds the phase (`swapping`, `swapped`) and the steps done; the swap order is database to safety, photos to safety, staged database in, staged photos in.
- **Refusals** (`WRONG_PASSPHRASE`, `BACKUP_DAMAGED`, `NOT_A_WMBUGO_BACKUP`, `BACKUP_TOO_NEW`, `FILE_TOO_LARGE`) return before maintenance starts and before any file changes. `LOW_SPACE_NEEDS_CONFIRMATION` is returned below twice the live data size unless `withoutSafetyCopy`.
- **Not done / not verified:** the committed schema-N backup fixture (a fixture needs a real SQLCipher export, which only a device or an emulator can produce; the migrate-forward path is covered by `runMigrations`' own tests and the N versus N+1 acceptance test with a fake staged database); the invariants check on a whole database is foreign keys plus one profile, because the writer's invariants only look at touched rows; the whole sequence on a device (rename of a directory with `RNFS.moveFile`, the SQLCipher attach and export with bound keys, closing the live connection before the swap, `restartApp`).
- Checks: lint and typecheck clean, core 1,034 tests, mobile 2,384 tests, Kotlin compiles.
