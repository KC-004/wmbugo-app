---
review: rubric (good-spine checklist)
target: ../ARCHITECTURE-SPINE.md (draft, 2026-11-07)
inputs: ../.memlog.md, prds/prd-wmbugo-app-2026-11-01/prd.md (v1.3.5)
date: 2026-11-07
---

# Rubric review — wmbugo app architecture spine

**Verdict:** The domain core is strong: the paradigm, the money and sign rules, the single pipeline, the post-commit effects and the build flavors are sharp and enforceable. The operational and security envelope is not ready. The threat model, encryption of files at rest, backup and restore, migrations over time, crash diagnostics, the Android SDK envelope and the multi-runtime writer guarantee are silent or underspecified. These gaps must be closed before epics are cut.

**Counts:** critical 0 · high 9 · medium 8 · low 5

## What works

- AD-1/AD-2 make the core boundary checkable at compile time (no RN/Drizzle dependency in `packages/core`, Node-only tests).
- AD-4 states its invariants concretely and keeps side effects strictly post-commit. This prevents the FIN-026 "alerts fire once, after the write" class of bugs.
- AD-5 settles the PRD §11.2 sign convention outright (GATE-07 input) and removes the most likely cross-story divergence.
- AD-6 and AD-9 close the "second SMS path" and "source posts directly" divergences.
- AD-15 and AD-16 turn SEC-002 into an automated build failure, not just a policy.
- Version honesty: RN 0.88.x is verified with a date; everything else is explicitly marked as pinned in the M1 spike.

## Findings

### High

**H1 — Threat model and key-loss recovery missing (§17, GATE-04, AD-8)**
- *Problem:* PRD §17 says "Architecture must document threat model, assumptions, encryption/auth design, recovery limits and internal audit invariants before implementation". The §25 checklist marks it "owned by `bmad-architecture`" and unchecked. The spine has no threat model. AD-8 also leaves open what happens when the Keystore entry is lost or invalidated (device credential reset, OEM Keystore bugs, app data restored without the key). In that case the DB becomes unreadable, and stories will improvise different recovery UX.
- *Fix:* Add a short threat-model section, or a companion file linked from `companions`. It should list each §17 threat with its mitigating AD, the stated assumptions (rooted devices out of scope, after-first-unlock key class), the recovery limits, and an explicit rule for "DB key unavailable": open in safe mode, offer restore from backup, never re-create the DB over the existing file.

**H2 — Encryption of files at rest unspecified (NFR-10, BKP-004, BKP-006, IMP-006, UPI-007, OCR-001)**
- *Problem:* AD-7 and AD-8 cover only the SQLCipher database. NFR-10 also requires attachments to be unreadable before first unlock. Receipt images, raw CSV files kept for 30 days, shared UPI screenshots awaiting parse, the pre-migration safety copy and the pre-restore snapshot are all files. The `FileStore` port appears in the diagram with no rule. OS auto-backup exclusion (BKP-006: `allowBackup`/`dataExtractionRules`) is also not stated. OCR, import, UPI and backup stories will each choose their own storage and encryption.
- *Fix:* Add an AD: every app-owned file goes through `FileStore`, which encrypts with a key derived from or wrapped by the DB key (XChaCha20-Poly1305 or an equivalent named primitive) into app-private storage only. Temp files are encrypted or deleted in a `finally`. Safety copies are encrypted. The manifest sets `allowBackup="false"` plus `dataExtractionRules` excluding everything. The CI permission check also asserts the backup flags.

**H3 — Backup, restore and data migration over time undecided (BKP-001..005, NFR-12, GATE-02 fallback, AD-7)**
- *Problem:* AD-7 decides how migrations run on open. It does not decide:
  - the backup format: an encrypted raw SQLCipher file copy (`sqlcipher_export`) or a logical per-module export
  - how attachments and manifest enter the archive
  - the compatibility window: can schema N restore on N+1, and is N+1 refused on N, with the downgrade policy stated
  - how restore swaps the database while the LedgerWriter and TanStack caches are live
  - how restore stays atomic across a process kill (BKP acceptance)
  - whether `sms_cursor`, learned mappings and review state are carried (the GATE-02 two-package fallback relies on backup → restore)
  - any rule that migrations are forward-only and never destructive (RB0 "irreversible unsafe migration")

  "core.backup owns the format, no tables" leaves every one of these to whichever story arrives first.
- *Fix:* Add an AD covering these points:
  - Archive layout: manifest with app version, schema version, checksum and KDF params; encrypted DB snapshot; encrypted attachments.
  - Restore: write to a staging file, validate, migrate the staging copy, then do an atomic rename while the writer is quiesced, followed by full cache invalidation, with a crash-recovery marker file.
  - Compatibility: newer-schema backups are refused with a clear error.
  - Migrations: additive and forward-only, every migration tested against a fixture DB from each prior released schema.

**H4 — "One serialized writer" is not guaranteed across runtimes and processes (AD-4, AD-9, AD-10, AD-11, AD-14)**
- *Problem:* AD-4's serialization is an in-memory JS queue. Writes can start from several places:
  - the main activity
  - the dialog-styled capture activity (AD-10, possibly its own React host)
  - notification Approve/Reject actions from the shade
  - the headless background job (AD-9, AD-14)
  - widget-triggered actions

  If any of these runs in a second JS runtime or process, or opens a second op-sqlite connection, the single-writer guarantee and the "no duplicate confirmed" invariant fail silently. The spine never states the process or runtime model. The memlog defers headless JS to the spike only for latency.
- *Fix:* Add to AD-4: the app is single-process (no `android:process` on any component). There is exactly one React host and one JS runtime, shared by the activities, headless tasks and notification actions. There is exactly one DB connection owned by the storage adapter. Any native component that needs a write enqueues a job instead of opening the DB. Add a spike check: dialog activity plus headless task share one runtime. Add a test: concurrent commands from two entry points produce serialized commits.

**H5 — Crash and diagnostics without telemetry not designed (AD-17, SET-006, §3.3 crash-free metric, §15 "Database corruption")**
- *Problem:* AD-17 forbids crash SDKs and mandates a redacting Logger, but leaves out:
  - where logs go (a persisted ring buffer? its size and retention, and whether it is encrypted)
  - how JS and native crashes are captured locally (global error handler, `Thread.setDefaultUncaughtExceptionHandler`, ANR detection)
  - the format and redaction preview of the SET-006 sanitized diagnostics export
  - how a beta tester's exported trace is symbolicated: Hermes source maps and the R8 `mapping.txt` must be retained per release
  - how the "≥ 99.5% test-session stability" metric is measured
  - what the app does on DB corruption or failed open (safe mode)
- *Fix:* Add an AD:
  - Logger writes to an encrypted, size-capped local ring buffer.
  - A local crash recorder (JS and native) appends redacted crash records to the same store.
  - Diagnostics export = redacted bundle plus app/schema version, shown in preview before the share sheet.
  - CI archives source maps and `mapping.txt` per versionCode.
  - A failed DB open or migration routes to a safe-mode screen (export diagnostics, restore backup, never auto-wipe).

**H6 — No-SMS build can still ship SMS text and code in the shared JS bundle (AD-15, SMS-015, RB0, §13.0a gating)**
- *Problem:* AD-15 removes SMS permissions and the receiver from `nosms`, but the JS bundle is shared across flavors. SMS screens (SCR-24), Settings rows, the re-ask card and copy would still be inside `nosms`. RB0 and SMS-015 require "no SMS permission, receiver **or SMS-related UI text**". Nothing says how a story decides whether a market feature is visible ("build supports it AND profile region is IN"). Each feature will check the flavor or region differently.
- *Fix:* Add a rule:
  - Market and build capabilities come from one core query (`capabilities()` in `profile`), fed by a build-time constant.
  - SMS UI modules and strings live in a separate entry that Metro includes only for the `sms` flavor (a build-time constant plus dead-code elimination, or a flavor-specific module resolution).
  - The CI permission check also greps the `nosms` bundle and resources for an SMS string list.

**H7 — AD-1 and AD-7 conflict over where financial aggregation lives (AD-1, AD-7, AD-13, §18)**
- *Problem:* AD-1 says every calculation lives in the core. AD-7 allows raw SQL aggregates in the adapter, and the core cannot contain SQL. To meet NFR-05/07 at 10k rows, agents will push sums, period membership, floor-at-zero (BDG-006), refund netting (FIN-028) and the "Not classified" logic into adapter SQL. That reproduces the scattered-business-rules divergence AD-1 exists to prevent, and nothing says what the port surface for aggregates looks like.
- *Fix:* State the split:
  - The Storage port exposes a small fixed set of aggregate primitives (sum and count of confirmed splits or postings grouped by category, account, local_date or type, over a half-open local_date range, with a status filter).
  - All financial rules (floors, netting, eligibility, pro-rating, period computation) are applied in core over those primitives.
  - The adapter SQL must contain no business constants.
  - A contract test suite runs the same aggregate fixtures against the adapter and an in-memory reference implementation.

**H8 — Module ownership has gaps and a missing dependency (AD-3)**
- *Problem:*
  - Missing owners: `category` (CAT-*, need/want type required in the first schema version), `audit_event` (written by FIN-026, FIN-027 merges, ACC-008 and others) and `schema_migration` have no owner.
  - `settings` sits under `profile`, but the budget thresholds and notification preferences inside it belong to planning features.
  - The graph has no `capture → planning` edge, yet capture must read recurring rules for REC-009/CAP-011 ("Rent paid?") and goal tagging for "Moved to savings" (GOAL-002).

  As drawn, stories either violate AD-3 or route around it ad hoc.
- *Fix:* Assign `category` (ledger or a new `catalog` module), make `audit_event` a writer-owned table written only by the LedgerWriter, and add `capture → planning` (queries only). Optionally state that cross-module reads use query functions, and enforce the graph with a lint rule (e.g. `eslint-plugin-boundaries` or `dependency-cruiser`) in CI so the Rule is mechanically enforceable.

**H9 — Android platform envelope silent (minSdk/targetSdk, reference device; GATE-03)**
- *Problem:* No minSdk, targetSdk or compileSdk is decided. These settings determine:
  - the notification runtime permission (API 33)
  - exact-alarm restrictions for the 21:00 job
  - foreground-service and background-start limits for the capture dialog launched from a notification
  - the blur fallback (API < 31, §6.6)
  - Play's target-API requirement

  GATE-03 (device matrix and reference hardware) is assigned to the *mobile architect*, yet the spine defers the device matrix to M5. The M1 open questions already measure against "the reference device".
- *Fix:* Decide minSdk (e.g. 26 or 28) and target/compile SDK (the current Play-required level). Name at least one low/mid reference device for NFR-03..08/16/19 now. Defer only the wider QA matrix to M5. Pin AGP, Gradle, Kotlin, JDK and Node alongside them.

### Medium

**M1 — Background scheduling mechanism unnamed (AD-9, AD-14, NFR-16/18)**
- *Problem:* The Scheduler port has no adapter decision. The options are WorkManager unique work, AlarmManager inexact or exact for the 21:00 cutoff, and a headless JS mechanism. Retention purges (30/90-day FIN-014, IMP-006 raw files, tombstone creation) and the HOM-004 daily recompute of quick-category chips are not listed as scheduled work.
- *Fix:* Name the adapter (e.g. WorkManager unique work running a headless JS task, inexact for the cutoff with app-open as the backstop) and list every scheduled job in AD-14, including purges.

**M2 — Release pipeline partly deferred while CI already builds releases (AD-15, AD-16, Deferred)**
- *Problem:*
  - Signing is deferred to M5, yet AD-16 builds release APKs on every push. Signing config, upload-key custody and backup, and Play App Signing need deciding now.
  - Two flavors in one package (GATE-02 "same package" outcome) need a versionCode scheme.
  - AAB vs APK is undecided.
  - Where the `app.wmbugo.lab` upload code lives is not stated: it needs its own source set or flavor so production can never link it, even with INTERNET stripped.
- *Fix:* Add the signing approach (Play App Signing, upload key stored outside the repo with a CI secret and an offline backup), the versionCode scheme per flavor, AAB for Play, and "lab code lives only in the `lab` flavor source set; CI asserts its classes are absent from release artifacts."

**M3 — Port inventory incomplete; crypto placement contradicts AD-2 (AD-2, AD-8, conventions)**
- *Problem:* `core.backup` encrypts with libsodium Argon2id. Hermes has no WebAssembly, so pure-JS libsodium is either unavailable or too slow for Argon2id. A native binding would violate AD-2. UUID v7 and the 256-bit key need a CSPRNG, and Hermes has no `crypto.getRandomValues` without a polyfill. The following have no port: Crypto/Random, biometric app lock, file picker/share intake, camera.
- *Fix:* Add `Crypto` (KDF, AEAD, random bytes) and `IdGenerator` ports with a Node implementation for tests and a native adapter (name the RN libsodium binding). List the remaining ports or state that UI-only platform APIs (camera, picker, biometrics) may be called from features directly.

**M4 — Split sign for refunds, reversals and adjustments unstated (AD-5, FIN-028, BDG-006)**
- *Problem:* AD-5 says splits "sum to the absolute amount" but not what sign a refund's split carries in its category. Nor does it say how reversals, opening balances and adjustments (which have no category) are represented. Insights and budget stories will net refunds differently.
- *Fix:* State one rule, e.g. "split amounts are positive for spending and negative for refunds and paybacks in the same category; opening_balance and adjustment carry no splits and are excluded from spending by event_type; a reversal carries the negated postings and splits of its original." Add a property test.

**M5 — Deferring the "exact schema" conflicts with PRD §11.2; no DB naming convention (Deferred, AD-7)**
- *Problem:* PRD §11.2 requires the exact schema in an architecture ADR before migrations are generated. The spine defers it to "the Drizzle schema in code once created". Without a rule, parallel or AI-generated stories add tables in different files and styles. The PRD and AD-5 use `signed_amount_minor` (snake_case), while the conventions say fields end in `Minor` (camelCase).
- *Fix:* State: one Drizzle schema file per owning module under `adapters/storage/schema/<module>.ts`. SQL columns are snake_case and TS fields camelCase via Drizzle mapping. The first ledger story lands the PRD §11.1 entity set as migration 0001, and later stories only add tables or columns through new migrations. Or record this as an explicit ADR satisfying §11.2.

**M6 — No test strategy for the storage adapter and migrations (AD-16, §16 pyramid, BKP-005)**
- *Problem:* Core tests run in Node, but op-sqlite with SQLCipher does not. The spine doesn't say where the "SQLite integration/migration tests" layer runs: an instrumented device job, an emulator in CI, or better-sqlite3 against the same Drizzle migrations. Migration-from-every-prior-schema and restore tests have no home.
- *Fix:* Decide, for example: adapter contract tests run under better-sqlite3 in Node using the same generated SQL, plus a smaller instrumented suite on an emulator in CI for SQLCipher and op-sqlite specifics. Migration fixture DBs are committed per released schema version.

**M7 — Capability map misses PRD areas (Capability → Architecture Map)**
- *Problem:*
  - Onboarding (ONB, WMB-02) is absent.
  - Categories (CAT, WMB-06) are absent.
  - CSV export with formula escaping (IMP-007, SEC-006) has no home.
  - Diagnostics (SET-006, SCR-22) has no home.
  - App lock and app-switcher blur (SEC-004/005) has no home.
  - Recently deleted/purge (FIN-014) has no home.
  - Internationalization (WMB-18: country table, currency list as config "not a code change", DEC-28 externalized strings) is only partly covered by the formatter convention.
- *Fix:* Add rows mapping each to a module and AD, and add a convention for string externalization and the country/currency table location (core `profile` config data).

**M8 — Stack mostly unpinned; some choices unverified or missing (Stack)**
- *Problem:* Only React Native is verified.
  - op-sqlite's major version is "unverified".
  - react-native-notify-kit is a community fork whose source is blog posts; its maintenance status should be checked.
  - The widget library and the background-job library are not in the Stack at all.
  - Node, JDK, AGP, Gradle and Kotlin are not mentioned.

  Pinning everything "at M1" is acceptable only if the spine records where the pins live.
- *Fix:* Add rows for the widget, background work, libsodium binding and toolchain. State that pins live in `pnpm-lock.yaml`, `.nvmrc`, `gradle/libs.versions.toml` and `packageManager`. Add a spike exit criterion: "Stack table updated with exact versions and a verification date". For notify-kit, record a fallback (a thin native notification module behind the Notifier port).

### Low

**L1 — Full-text search under SQLCipher not in the open questions (TXN-007, NFR-07)**
- *Problem:* Whether op-sqlite's SQLCipher build includes FTS5 is unknown.
- *Fix:* Add it to the M1 spike list, or decide on indexed LIKE over normalized columns.

**L2 — App-lock gating for entry points is not a rule (§5.1, UPI-006, SEC-004)**
- *Problem:* The widget, notification, share intent and deep links each need the lock check and the queued-share behaviour, and each story may implement them differently.
- *Fix:* Add one line to AD-10: every external entry point routes through a single lock gate in the navigation root, and queued shares persist as `source_record`s.

**L3 — Read-model and cache strategy for NFR-05 unstated (§18, `budget_period` cache)**
- *Problem:* Whether aggregates are computed on demand or cached in tables (and who invalidates them) is open.
- *Fix:* State "on demand for Phase 1; cache tables only after a measured NFR-05 miss, owned by the module that owns the source data."

**L4 — Inconsistent AD status markers**
- *Problem:* AD-1..AD-6 carry [ADOPTED], AD-7..AD-17 carry no status, though the memlog records all of them as decisions.
- *Fix:* Mark each AD's status, or mark the ones that hinge on spikes (AD-7, AD-10, AD-12) as provisional.

**L5 — Spine `binds` cites IDs whose coverage isn't traced (frontmatter)**
- *Problem:* `binds` omits ONB-* entirely and includes `CAT-*` and `IMP-*` (export) without corresponding ownership or map rows (see H8, M7).
- *Fix:* Reconcile after fixing H8/M7.

## Deferred list check

- iOS, sync, monetization, Phase 2 analytics, UI design system: safe, since nothing in Phase 1 can diverge on them.
- **Exact schema:** unsafe as worded (M5).
- **Release signing / device matrix:** partly unsafe. Signing affects CI now (M2), and the reference device belongs to this altitude per GATE-03 (H9).
