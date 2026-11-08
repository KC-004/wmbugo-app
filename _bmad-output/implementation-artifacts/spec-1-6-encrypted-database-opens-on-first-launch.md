---
title: 'Story 1.6 - Encrypted database opens on first launch'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'dec0864'
---

## Intent

Implements the epic's Story 1.6 acceptance criteria (see epics.md), using the toolchain decisions in `docs/decisions/S1-storage-migrations.md`.

## Implementation Notes

- Core: ports (KeyStore, SqlDatabase/DatabaseOpener, FileStore), pure SHA-256, migration runner (one transaction, checksums, newer-DB guard), `startStorage` use case, size-capped file log sink.
- Mobile adapters: Keystore via react-native-keychain (AES-GCM, no auth, after first unlock), op-sqlite/SQLCipher opener, private-file adapter (`@dr.pogodin/react-native-fs`), CSPRNG via react-native-get-random-values, startup gate with the exact inline error copy.
- Manifest: library-added USE_BIOMETRIC, USE_FINGERPRINT, WRITE/READ_EXTERNAL_STORAGE removed by name with `tools:node="remove"`; allowlist check passes for both flavors.
- CI: `check-encrypted-db.mjs` (+ gate self-tests) and an emulator job that builds a debuggable release (`-PwmbugoDebuggableRelease`, opt-in), launches it, pulls the database and checks the header. The emulator job itself has not run (needs GitHub).
- Verified on a Redmi Note 11 Pro+ (release, debuggable flag): header is random bytes; key reused across launches; routes to onboarding; log file is redacted JSON lines; cold start 790-900 ms total process-to-first-frame; no INTERNET permission.
- Not verified on device: the safety copy of a non-empty database (first launch has nothing to copy, so it is skipped); Story 1.7's second migration is the first real test. NFR-20 formal measurement waits for the benchmark harness.

## Review Triage Log

Inline self-review plus on-device checks. Findings fixed:
1. high - a missing key with an existing database would have generated and stored a new key, overwriting a good one after a transient Keystore failure and destroying access to the data. Now KEY_UNAVAILABLE and nothing is written (`DatabaseOpener.exists`).
2. medium - a wrong key made the first read throw out of `startStorage`; now DATABASE_OPEN_FAILED, database closed, nothing written.
3. low - safety copy of a brand-new empty database was a 0-byte file; skipped when no migration has been applied.
