# Epic 8 Context: Privacy, security and backup

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users lock the app, keep amounts hidden from the app switcher and lock screen, make an encrypted backup with a passphrase, restore it safely on this or a new phone, manage or erase their data, and can rely on the app being provably unable to send anything anywhere. A fault in the data must never turn into lost entries: the app enters a read-only safe mode instead.

## Stories

- Story 8.1: Redacted logs, local crash records and the no-network guarantee
- Story 8.2: Privacy settings, hiding wmbugo in recent apps and what stays on this phone
- Story 8.3: App lock with LockGate and re-authentication
- Story 8.4: Offer app lock once after the first saved entry
- Story 8.5: Notification privacy: hidden form and notification detail
- Story 8.6: Encrypted backup format in core
- Story 8.7: Make a backup with a passphrase
- Story 8.8: RestoreBackup in maintenance mode
- Story 8.9: Restore preview and confirmation
- Story 8.10: Diagnostics with a preview before anything is exported
- Story 8.11: Storage, retention and erase all data
- Story 8.12: Safe mode when the data can't be opened safely

## Requirements & Constraints

- No analytics, crash-reporting, ads, attribution or network SDK; no INTERNET or ACCESS_NETWORK_STATE permission; every permission on the release allowlist is documented in PERMISSIONS.md with feature, rationale, denied behaviour and revocation handling.
- Logs and crash records never hold money, merchants, notes, account identifiers, UPI IDs, SMS text or image data; free text is scrubbed; logs rotate at 1 MiB with one previous file; crash records capped at 20; nothing written to shared storage.
- Hide amounts, app lock and notification detail decide what notifications and the widget may show. Capture notifications hidden form is `New payment to check`, no amounts.
- Backups are one encrypted file needing a passphrase; a bad, tampered or newer file is rejected with a typed error before anything changes; restore either completes or leaves the phone as it was (NFR-12).
- Backup, restore, diagnostics and erase files leave the app only through the Android save dialog or file picker (no storage permission).
- Sensitive actions (delete permanently, app lock off, change Lock after, restore, erase) go through the shared re-auth guard, a no-op when app lock is off.

## Technical Decisions

- Database key: random 256-bit key in Keystore, not bound to biometrics; app lock is a UI gate only. Backups use a separate passphrase-derived key (libsodium Argon2id + XChaCha20-Poly1305 secretstream), behind a `Crypto` port with a mobile libsodium adapter and `libsodium-wrappers` for Node tests.
- Restore runs through the writer in maintenance mode: stage, verify, migrate forward, re-key, atomic swap journalled in `restore.journal`, safety copy until next successful start. Restore works across `app.wmbugo` and `app.wmbugo.sms`. `BackupRestored` event invalidates queries and reschedules reminders.
- All notifications go through the Notifier port; the pure core `decideNotificationForm` picks hidden or full. Settings gain `notification_detail` and `full_notifications_opt_in` via a migration and a `SetNotificationPrivacy` use case.
- Every command is a use case: one writer transaction, audit row, outbox event. Never edit an applied migration; add a new one. Safe mode makes the writer refuse every use case with `SAFE_MODE`.
- No `console.log` in shipped code; logging goes only through the redacting Logger port (existing `createRedactingLogger` and `createFileLogSink` in `packages/core/src/shared`).

## UX & Interaction Patterns

- Settings gains Privacy, Data and Help groups with live summaries read as part of the row label. LockGate covers everything with the coin mark and an Unlock button, hides the tree from accessibility, and returns the user to the exact screen and sheet draft (FLOW-12). Passphrase field is shared (Show toggle, live polite hint, no recovery). Restore confirmation shows backup beside this phone, a checkbox, and re-auth. Safe-mode banner disables every add, edit and delete control.

## Cross-Story Dependencies

- 8.2 introduces the Privacy group that 8.3 and 8.5 extend; 8.3's re-auth guard is used by 8.8/8.9/8.11; 8.4 depends on 8.3's enable flow.
- 8.6 (format) precedes 8.7 (backup), 8.8 (restore) and 8.9 (restore UI). 8.1's redaction test is re-run against the 8.10 export. 8.11's erase is reused by 8.12's `Start fresh`; 8.12 links to 8.7, 8.9 and 8.10.
