---
title: Reconcile — architecture spine vs PRD v1.3.5 + addendum
spine: ../ARCHITECTURE-SPINE.md (AD-1..AD-17, memlog 2026-11-07T15:27)
inputs: prd.md v1.3.5, addendum.md (2026-11-07)
date: 2026-11-07
scope: cross-cutting gaps only (missing feature detail is not flagged)
---

# Reconcile: spine vs PRD

**Counts:** High 7 · Medium 14 · Low 9

Categories: (a) = PRD requirement with architectural consequence and no AD, convention or Deferred entry; (b) = contradiction; (c) = quiet requirement dropped.

## High

### H1 (a) No AD for backup/restore atomicity, re-keying and restore-time migration
- **PRD:** BKP-001..005, §8.14 acceptance (kill during restore leaves pre-restore data intact; backup from schema N restores on N+1 with matching balances), NFR-12, SEC-001 (restored `sms_cursor` kept), GATE-02 fallback (cross-package migration via backup carrying learned mappings, senders, review state), §11.2 "key rotation/restore considerations".
- **Spine:** AD-8 names the backup crypto only; AD-3 lists `backup` as a module with "no tables" depending on four modules. Nothing says how a restore commits atomically, whether it is a whole-file swap or a replay through owner commands (AD-3 says data changes only through owners' commands and AD-4 says every change goes through the LedgerWriter — a file swap violates both as written), how the restored data is re-encrypted under this device's DB key, where the pre-restore safety snapshot lives, the 2x free-space check, or that a restored older schema runs the AD-7 migrations before use.
- **Fix:** Add an AD "Backup and restore": backup = consistent snapshot (SQLCipher export or VACUUM INTO under a writer pause) + encrypted attachments + manifest (format version, schema version, checksum) sealed with the passphrase key; restore = validate → decrypt to app-private temp → re-key to the device DB key → run migrations on the temp copy → verify invariants → atomic file rename with the safety snapshot kept until first successful open; writer is stopped during restore and the swap is the single documented exception to AD-4. State that restore carries `sms_cursor`, `sender`, `learned_mapping`, tombstones and review state (GATE-02).

### H2 (a) Attachments and other files are outside the encryption and atomicity rules
- **PRD:** NFR-10 ("database **and attachments** unreadable"), §11.2 "encrypted database and attachments", `attachment.local_encrypted_path`, BKP-004 (no unencrypted temp artifacts), OCR-001 (keep only compressed copy), UPI-007 (screenshot not kept unless attached), IMP-006 (raw CSV kept 30 days), §15 "Storage exhausted: no partial attachments/imports".
- **Spine:** AD-7/AD-8 cover only the SQLCipher database. FileStore port exists but no rule for file encryption, key, temp/cache handling (camera, share intent, OCR input, CSV picker copies), or file-vs-row atomicity.
- **Fix:** Add a rule (extend AD-8 or new AD): every file wmbugo persists goes through FileStore, encrypted with a key derived from/held alongside the DB key (e.g. XChaCha20 per-file key), in app-private storage; plaintext only in app-private cache, deleted after use; file written before the DB row, row commit makes it live, orphan sweep on start. Include raw CSV files and receipt images.

### H3 (a) Retention, purge jobs and tombstones have no owner, schedule or cross-module path
- **PRD:** FIN-014 (30-day purge of deleted manual entries, 90-day purge of rejected captures and excluded import rows, tombstone = salted hash + outcome + date, "Import anyway", purges propagate to next backup), DEC-24, IMP-006 (raw file 30-day retention, configurable).
- **Spine:** AD-14 lists scheduled work as auto-approve, evening summary and SMS catch-up only — no purge job. AD-3 puts `tombstone` in `capture`, but purging a deleted **manual** ledger transaction must write a tombstone, and `ledger` may not depend on `capture`. The tombstone **salt** is not placed anywhere; if it is not in the backup, restored tombstones stop matching.
- **Fix:** Add a `PurgeExpired` command (Scheduler + app-open, LedgerWriter, idempotent, Clock-based) that owns ordering: compute fingerprint hash → write tombstone → hard-delete transaction, postings, splits, source records, attachments and files. Either move tombstones to a module both can call or make purge a `capture`-orchestrated command. Store the salt in `profile` and include it in backups. Add retention of `import_batch.raw_path` to the same job.

### H4 (a)(b) CSV import batching and resume do not fit the one-command-one-transaction model
- **PRD:** IMP-005 (batches of ≤500 rows commit atomically; interrupted import keeps committed batches and resumes from the next; idempotent re-import), FIN-027 CSV rules (rows of one file never matched against each other or already-committed rows of that file; occurrence index per (date, amount, description) group; partial edge days go to review), IMP-002 transfer pairing ±2 days within the import, §16.1 IMP "atomic rollback".
- **Spine:** AD-6 treats each source record as passing the pipeline individually; AD-4 makes every change one named command in one transaction. No batch command, no resume cursor on `import_batch`, no "same-file" exclusion in the match stage, no statement on how a 500-row write transaction coexists with the single serialized writer (it blocks manual saves; NFR-04).
- **Fix:** Add to AD-6: an `ImportBatch` command that runs parse→match→classify for up to 500 rows in one LedgerWriter transaction, records `import_batch.next_row` and file digest for resume, and passes a batch context to the match stage (file id for same-file exclusion, occurrence index fingerprint). Allow the writer to interleave short commands between batches.

### H5 (a) Performance budgets NFR-03..08, NFR-18..20 are bound by no AD and gated by nothing
- **PRD:** NFR-03 (nav <300 ms), NFR-04 (save p95 <500 ms), NFR-05 (Home p95 2 s at 10k records), NFR-06 (no OCR/analytics on UI thread), NFR-07 (10k list 60 FPS, search p95 <500 ms), NFR-08, NFR-18 (battery budget), NFR-19 (glass), NFR-20 (splash ends when DB ready, ≤1 s), §11.2 index list, §12 note "architecture must designate device models/OS versions", GATE-03, §16.1 PERF (10k/50k datasets), RB1. Addendum: splash ends when DB key and first Home query are ready.
- **Spine:** Frontmatter claims NFR-01..20, but only NFR-01/09/10/16 have a governing rule. No reference device, no startup sequence (key fetch → open → migrate → first Home query → hide splash), no rule that DB queries use op-sqlite's async/threaded API and OCR runs native off the JS thread, no aggregate/index strategy, no PERF gate in AD-16.
- **Fix:** Add an AD "Performance budget": name the GATE-03 reference device(s) as an M1 output; mandate async DB access off the JS thread, SQL aggregates for every Home/Insights figure with the §11.2 indexes in the first migration, virtualized lists, a defined startup sequence tied to react-native-bootsplash; add a 10k/50k synthetic-dataset benchmark on the reference device to AD-16 before each beta.

### H6 (a) The no-SMS build must contain no SMS text — AD-15 removes only the manifest entries
- **PRD:** SMS-015, RB0 "No-SMS builds contain no SMS permission, receiver **or SMS-related UI text**", §8.12 acceptance ("all UI strings are inspected"), §13.0a feature gating = build supports it **and** region `IN`, §13.2.
- **Spine:** AD-15 strips permissions and receiver per flavor, but the JS bundle is shared; SMS screens, settings and strings (SCR-24, SCR-28 blocked senders, SMS-014 card) would ship in `nosms`. No feature-capability module expresses "build AND region".
- **Fix:** Extend AD-15: flavor-specific JS entry or build-time constant (Babel/Metro define) so SMS feature code and strings are dead-code-eliminated from `nosms`; add a CI check that greps the `nosms` bundle and resources for SMS strings. Add a single core `capabilities(profile, build)` query that every surface uses for market gating.

### H7 (a) Threat model, recovery limits and audit invariants required "before implementation" are absent
- **PRD:** §17 ("Architecture must document threat model, assumptions, encryption/auth design, recovery limits and internal audit invariants before implementation"), GATE-04 check "threat-model checklist in the architecture ADR", §15 (database corruption → safe-mode restore guidance, non-destructive diagnostics), §17 encryption key loss.
- **Spine:** AD-8/AD-17 give key handling and logging only. No threat list, no statement of what happens when the Keystore key is lost or the DB fails to open (safe mode vs wipe), no recovery limits (forgotten backup passphrase = unrecoverable), no rooted-device statement.
- **Fix:** Add a "Threat model and recovery" section or companion: map each §17 threat to the AD that answers it; define a safe-mode start when the DB cannot be opened/decrypted (offer restore from backup, export diagnostics, never auto-wipe); state recovery limits explicitly.

## Medium

### M1 (a) UPI-006 share-while-locked queue is not designed (addendum open question 4 unanswered)
- **PRD:** UPI-006 (queued, delivered after unlock, never lost), §16.1 UPI "share while locked is delivered after unlock", UPI-007, BKP-004.
- **Spine:** AD-10 covers the dialog and widget but not the share intent; AD-8 makes app lock a UI gate only. Not stated whether a share received under app lock (or with the process killed before unlock) is persisted, where the image lives, or how it survives process death.
- **Fix:** Add to AD-10: the share-intent adapter immediately copies the image through FileStore (encrypted, H2) and records a pending `source_record` (status pending-parse) via the writer; the lock gate only defers showing the dialog; pending shares are drained on unlock and on app start. Before first unlock since boot (DB unavailable), state the behavior explicitly.

### M2 (b) Hide-amounts is placed in Zustand, but the PRD makes it a persisted setting that drives core decisions
- **PRD:** SET-005 (hide amounts applies everywhere at once: app, widget and notifications), SEC-005 (hidden notification form when hide amounts is on), §6.3 ("remembered").
- **Spine:** AD-13 lists the hide-amounts toggle as Zustand UI-only state, while AD-10/AD-11 say the core decides widget "amounts allowed" and the notification form.
- **Fix:** Move hide-amounts to `profile.settings`, read by the core for AD-10/AD-11 decisions; Zustand may only mirror it.

### M3 (b) Evening summary trigger is ambiguous against CAP-007
- **PRD:** CAP-007 / SET-003: the summary is sent **only by the background job, right after its auto-approve write commits**; at most one per day; never on app open; if the job doesn't run, no summary.
- **Spine:** AD-4 makes the evening summary a generic post-commit handler (of any commit?); AD-14 lists it as separately scheduled work.
- **Fix:** State: the summary is emitted only by the `CapturesAutoApproved` event when the writer ran inside the scheduled job (origin = background), at most once per profile-local day (persisted marker); app-open writes never send it.

### M4 (a) Post-commit handlers are not durable, yet several must run exactly once
- **PRD:** FIN-026(3) (budget alerts run exactly once after the write), BDG-004 (`budget_alert_fired`), LRN-008 (only user actions teach), §17 app termination and races.
- **Spine:** AD-4 publishes domain events after commit to in-memory handlers. A process kill between commit and handler loses alerts, learning updates and widget snapshot refresh; a retry could double-fire.
- **Fix:** Either write learning updates and `budget_alert_fired` inside the same transaction as the triggering command (pure decisions, recorded in-transaction; only the OS notification post is after commit), or add an outbox table drained idempotently on start. Widget snapshot regenerated on every app start.

### M5 (a)(b) Module ownership table has gaps and a dependency inversion
- **PRD:** §11.1 entities `category`, `audit_event`, `schema_migration`, `transaction.merchant_id/payee_id`; FIN-015/026/027 audit rows.
- **Spine:** AD-3 assigns no owner to `category` or `audit_event`. `merchant` and `payee` are owned by `learning`, but `ledger.transaction` references them while the graph forbids `ledger → learning`. Audit rows are required by the PRD but not an AD-4 writer invariant.
- **Fix:** Assign `category` (ledger or planning), make `audit_event` writer-owned and written by every command that changes status/amount/links; move `merchant`/`payee` identity to `ledger` (learning keeps mappings) or explicitly allow ID-only references across modules.

### M6 (b) Deferred schema contradicts PRD's "ADR before migrations"
- **PRD:** §11.2 ("Exact schema and signed-posting convention must be specified in architecture ADR before migrations are generated"), §20 M2 ("schema-dependent work waits for the ledger ADR"), addendum (`budget_type` in first migration).
- **Spine:** Deferred says exact schema is "owned by the Drizzle schema in code once created". AD-5 fixes the sign convention but §11.1 `posting.direction` alongside `signed_amount_minor` is left unresolved (redundant field that can disagree).
- **Fix:** Either produce a ledger schema ADR (posting/transaction/split/source_record/tombstone tables, keys, uniques, indexes) before M2 schema work, or record a PRD change that the Drizzle schema reviewed against AD-3/AD-5 is that ADR. Decide `posting.direction` (drop or derive).

### M7 (a) Migration safety is partial: forward-compat and failure recovery are missing
- **PRD:** BKP-005 (forward-compatible read policy, user-safe failure recovery), RB0 "no irreversible unsafe migration", NFR-12.
- **Spine:** AD-7 gives transactional migrations plus a pre-migration safety copy. Missing: behavior when the DB/backup is from a **newer** schema (app downgrade / older install restoring), free-space check before the safety copy, retention/cleanup of the copy, and the fact that some SQLite DDL (e.g. `PRAGMA foreign_keys` toggles in table-rebuild migrations drizzle-kit generates) cannot run inside a transaction.
- **Fix:** Extend AD-7: refuse to open a newer schema with a clear message (no write); check space; keep the safety copy until the first successful post-migration open; rule for non-transactional migration steps (run on the copy, then swap).

### M8 (a) Verification gates omit tests the PRD makes release-blocking
- **PRD:** §16 pyramid (SQLite integration/migration tests), §16.1 BKP/IMP/INTL/PERF/UX suites, NFR-12 fault injection, INTL "runs on a physical Android device (Hermes), not only in Jest", NFR-11 accessibility audit.
- **Spine:** AD-16 gates core property tests, build and permission checks, plus Maestro airplane mode. No storage-adapter integration/migration tests, no restore N→N+1 test, no fault-injection for import/restore/migration, no INTL-on-Hermes, no accessibility checks.
- **Fix:** Add these to AD-16 with their cadence (adapter/migration tests in CI via Node SQLite or on-device runner; INTL, PERF, fault injection and TalkBack checks before each beta).

### M9 (a) Query invalidation ignores time-driven changes
- **PRD:** §6.3 ("data refreshes on database changes, app resume, filter changes and device date change"), §15 "Date/time change: recalculate displayed period", FIN-002 timezone prompt, BDG-002 payday change.
- **Spine:** AD-13 invalidates only on post-commit events. Crossing midnight / a pay-cycle boundary, resume, device time or timezone change would leave Home and Plan on the old period.
- **Fix:** Add to AD-13/AD-14: Clock port emits day-rollover, resume and timezone-change signals that invalidate period-scoped query keys.

### M10 (c) "Honest about gaps" has no query contract
- **PRD:** §6.1 #8, §6.4 ("missing account information must not be displayed as zero unless genuinely zero"; charts with <2 points must not invent a trend), FIN-010/016 "balance not set", BDG-008 completeness gate, §6.7 "Say what we don't know".
- **Spine:** AD-4 says reads return value plus scope, but not completeness. Easy for stories to return 0 for "not set".
- **Fix:** Add a convention: query results carry `{value | unknown, scope, gaps[]}` (e.g. accounts not set, insufficient data); UI must not substitute 0 for unknown.

### M11 (a) Single serialized writer across multiple JS runtimes is unaddressed
- **PRD:** NFR-09, §11.2 single-writer, §17 "app background termination and race conditions".
- **Spine:** AD-4's `LedgerWriter` is in-process; AD-9 background jobs (headless JS / WorkManager), AD-10 dialog activity and the main app may run separate JS contexts or overlap with the UI. Serialization across them is not stated.
- **Fix:** State that all hosts share one ReactHost/JS runtime (or that the writer is serialized at the DB level with `BEGIN IMMEDIATE` + busy timeout and idempotent commands), verified in the M1 spike.

### M12 (a) Notification caps and reminder scheduling have no owned state
- **PRD:** SET-003 (one alert per threshold per period; capture notifications grouped; ≤1 evening summary/day; ≤3 other notifications/day, bills before budgets, overflow merged into "N more reminders"), REC-003 (best-effort scheduled bill reminders), DEC-12, CAP-005 grouping.
- **Spine:** AD-11 lets the core decide content/form, but no table or module owns the daily notification budget, and AD-14's scheduled-work list omits bill reminders.
- **Fix:** Give `profile` (or a small `notify` area) a `notification_log` with the cap logic in core; add bill reminders and purge (H3) to AD-14's scheduled work.

### M13 (a) Accessibility and device-capability inputs have no port
- **PRD:** DEC-17, NFR-11, NFR-19, §6.6 `glass.fallback` triggers (below API 31, battery saver, animator duration scale 0, no efficient blur), reduced motion (still coin), §16.1 BRAND.
- **Spine:** UI design system deferred to UX, but these signals are platform reads that need an adapter; none listed among ports/adapters.
- **Fix:** Add a `DeviceCapabilities` adapter in `apps/mobile/shared` (API level, battery saver, animator scale, reduce motion, font scale) exposed as one hook; glass and motion components consume only that.

### M14 (a) OS backup exclusion missing from build rules
- **PRD:** BKP-006, §8.14 acceptance (no DB or attachment in OS auto-backup); addendum: `android:allowBackup="false"` plus data-extraction rules as day-one settings.
- **Spine:** AD-15 covers INTERNET and SMS permissions only.
- **Fix:** Add to AD-15 and the AD-16 APK check: `allowBackup=false`, `dataExtractionRules`/`fullBackupContent` excluding everything.

## Low

### L1 (c) No numeric launcher badge
- **PRD:** DEC-16, §6.7 ("never numeric badges"), SET-003. Android shows notification dots/counts by default per channel.
- **Fix:** AD-11: Notifier adapter creates channels with badges disabled.

### L2 (c) String externalization for later translation
- **PRD:** DEC-28. **Spine:** no convention. **Fix:** add "all user-facing strings in a catalog keyed by id; no literals in components" (also eases H6).

### L3 (a) Stack omits addendum libraries that carry cross-cutting rules
- date-fns + date-fns-tz (FIN-002, Clock port implementation on Hermes), react-hook-form + zod (amount/date rules), Papa Parse, react-native-bootsplash (NFR-20), Lottie, Victory Native XL/Skia. **Fix:** list them or state they are UX/feature choices; at least pin the timezone library behind the Clock port.

### L4 (a) Open Questions drop pnpm/Metro hoisting and the AD-2 fallback
- Addendum Q5 (`node-linker=hoisted`); memlog records a fallback ("single app + lint rule") that the spine omits. **Fix:** add both to Open Questions/AD-2.

### L5 (b) Frontmatter `binds` overstates coverage
- Claims DEC-01..33 and NFR-01..20, but many (NFR-03..08, 11, 18..20; DEC-12, 17, 28) have no governing AD. **Fix:** list only bound IDs or add the missing ADs above.

### L6 (a) Data wipe scope
- **PRD:** SET-004 (wipe with double confirmation), SEC-008. **Fix:** one line: wipe deletes DB, Keystore key, files, widget snapshot, scheduled jobs and notifications.

### L7 (a) Platform privacy hooks for app lock
- **PRD:** SEC-005 / SET-005 (app-switcher snapshot hidden), §14 (re-auth for erase, restore, lock change, decrypted CSV export). **Fix:** AD-8 or AD-10: `FLAG_SECURE`/blur on background via native adapter; sensitive commands require a fresh unlock token from the lock gate.

### L8 (a) UPI screenshot parsing not bound to the OCR port
- **PRD:** UPI-001/004 (fixed-layout parser, fallback to receipt OCR). **Spine:** AD-12 binds OCR-* only. **Fix:** add UPI-001..004 to AD-12 binds; layout parsers live in core on OcrEngine text blocks.

### L9 (a) Consistent reads for dashboards
- **PRD:** §18 ("consistent reads for concurrently changing dashboard state"). **Fix:** AD-13: a multi-figure query (e.g. `homeHero`) reads inside one read transaction.
