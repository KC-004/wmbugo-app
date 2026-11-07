---
review: adversarial (incompatible-but-compliant unit pairs)
target: ARCHITECTURE-SPINE.md (AD-1..AD-17, draft 2026-11-07)
reviewed: 2026-11-07
counts: { critical: 3, high: 11, medium: 8, low: 3 }
---

# Adversarial review — wmbugo architecture spine

**Method.** For each finding, two units one level down (epics or stories built separately by AI agents) are described. Each follows every AD as written, yet the two cannot work together. Each finding names the AD to add or tighten. References are to the spine (AD-n) and the PRD (v1.3.5).

**Verdict.** The spine fixes the paradigm, money sign and single writer well. But it leaves open where a pending capture lives, how commands from different modules make one atomic change, who defines a "period", and what events and query keys are called. AI agents will fill these gaps differently in each story. Four seams cause most of the findings: the pending-item model, cross-module atomicity, the period function, and the event/invalidation vocabulary. Close those before epics are written.

---

## Critical

### ADV-C1 — Where a "needs_review" item lives, and whether manual entry passes through capture

- **Unit A (capture: SMS/UPI pipeline story).** Follows AD-6: the `post` stage calls a ledger command that creates a `transaction` with `status = needs_review` (FIN-024 puts status on the transaction) and a `review_candidate` pointing at it. Approve calls `ledger.ConfirmTransaction`.
- **Unit B (capture: review queue / auto-approve story).** Reads the sequence diagram's `HoldForReview` and the §11 field `review_candidate.proposed_transaction_id?` as "no ledger row until it is resolved". It keeps the held capture only as `source_record` + `review_candidate`, and Approve creates the transaction.
- **Unit C (ledger: Add sheet story).** Follows AD-1: "UI features call core commands". It calls `ledger.RecordExpense` directly, with no `source_record`, so no FIN-027 duplicate check runs. TXN-012 ("manual entry matching a confirmed item saves as needs_review + possible_duplicate") cannot happen. AD-6 says manual entry enters capture, but nothing stops the UI from calling the ledger command.
- **Why they clash.** A counts pending items as ledger transactions and B counts them as review_candidates, so "N to check", the widget count and the evening summary differ (FIN-024 requires them to be the same set). B's Approve creates a new transaction, while A's Approve updates one in place. Audit rows and `capture_resolution` end up in different places. FIN-027 matching against "existing items" sees different sets.
- **Fix: new AD "Pending-item model".** (1) Every capture, import row and manual entry creates a `transaction` row at intake. `needs_review` is a ledger status, never a capture-only state. `review_candidate` only records why the item is held (duplicate, transfer pair, unknown account, bill match). (2) Ledger commands that create transactions are **internal**. They are callable only from capture's pipeline (`capture.SubmitManualEntry`, `capture.IngestSource`), never from UI. The UI calls capture for every new item. (3) Approve, Reject, Re-approve and Delete are ledger status-transition commands with an allowed-transitions table. Every transition writes `capture_resolution` and an audit row.

### ADV-C2 — No rule for commands that change several modules atomically

- **Unit A (capture: `WriteAutoApprovals`, FIN-026).** Must mark transactions confirmed (ledger), close review candidates (capture), auto-link transfers (ledger + capture) and write audit rows **in one transaction**. AD-4 says every change is "a named command executed … inside one database transaction". The agent nests `ledger.ConfirmTransaction` calls inside its own command and shares the UnitOfWork.
- **Unit B (ledger story).** Also follows AD-4: each ledger command *is* a writer entry point, so it opens its own UoW and publishes its own events after commit. When A calls it, it commits early. The 500 confirmations become 500 transactions with 500 event batches, and BDG-004 "fires exactly once after the commit" breaks.
- **Same pattern elsewhere:** CAP-009 account discovery (ledger account + capture `account_identifier` link + first transaction + opening balance effective just before it). ACC-009/GOAL-002 "Moved to savings" (ledger transfer + planning `goal_allocation`). FIN-027 Merge (ledger transactions + capture `source_record.transaction_id` re-pointing + attachments). REC-009 link (ledger + planning `next_due_at`).
- **Fix: tighten AD-4.** Split *writer commands* (top-level entry points: one UoW, one event batch) from *module operations* (functions that take a `tx` handle, never commit and never publish). Only writer commands may be called from the UI, the scheduler or the pipeline. A writer command may call operations from any module it is allowed to depend on (AD-3 arrows). Events from all operations collect into one batch published after the outer commit. Nested writer commands are forbidden, and the writer checks this at runtime (re-entrancy throws).

### ADV-C3 — No single owner for "period" (DEC-33, BDG-002, FIN-002, FIN-028)

- **Unit A (planning: budgets / Left in budget).** Uses `shared/period maths` from the seed and the Consistency Convention "period membership by `local_date`". Computes `[payday, next payday)` from `profile.payday_rule`.
- **Unit B (insights: trends, INS-004 like-for-like).** Also follows the convention and also uses shared period maths. It does not apply the DEC-33 "salary income up to 3 days before payday belongs to the next cycle" rule (a category-dependent exception the convention does not mention). It also does not apply FIN-028 "a reversal counts in the *original's* period". It also does not apply BDG-002's "shortened cycle" after a payday change, because the payday-change date is not stored anywhere both can read. And when FIN-002 moves the profile timezone "from the next day", it uses the new zone for past periods.
- **Why they clash.** DEC-33 requires that Insights and Plan "never disagree", and BDG-008 requires Free to use to use *exactly* Home's Left in budget. Two compliant period functions break both. The convention is wrong as written ("by local_date" has three exceptions). The pure function also lacks inputs (payday history, timezone history).
- **Fix: new AD "Period authority".** One core function `periodOf(transaction, periodSpec)` and one `periodsFor(range)` in `planning` (or `profile`, if insights must not depend on planning for this). They read a stored **period-boundary history** (payday changes with effective date, timezone changes with effective date) owned by `profile`. They encode the salary 3-day rule and the reversal rule. All modules get period boundaries and membership only from these functions. Rewrite the Consistency Conventions row to point to it. `Left in budget` is a planning query (`leftInBudget(period)`). Home and Free to use both call it, and nothing else computes it.

---

## High

### ADV-H1 — `BudgetThresholdCrossed` cannot be emitted by the writer without breaking AD-3

- **Unit A (ledger/writer story)** reads AD-4 literally. `BudgetThresholdCrossed` is a domain event "published only after commit", so the writer computes threshold crossings as part of the command. To do that, ledger reads planning's budgets, which reverses the `planning → ledger` arrow.
- **Unit B (planning story)** treats alerts as a post-commit handler on `TransactionsChanged`. It recomputes usage and writes `budget_alert_fired` in a second writer command.
- **Clash.** Two detection paths, or none. B's second command produces its own events and could trigger further handlers. FIN-028 ("alerts already fired for that period do not fire again" after a reversal into a closed period) and BDG-004 ("only the highest crossed fires per change") depend on which "change" the detector sees.
- **Fix: tighten AD-4.** Ledger emits only ledger facts (`TransactionsChanged {ids, periods/local_dates touched, categories touched, actor}`). Planning owns threshold detection as a post-commit handler. It issues one writer command `RecordBudgetAlerts` that is idempotent on `(budget_id, period_start, threshold_pct)`, and it may fire a notification only after that commit. Handler-issued commands are allowed, but their events must not trigger the same handler again (handler depth is limited to 1).

### ADV-H2 — No event catalog and no names for "changed areas" or query keys

- **Unit A (insights)** names query keys `['insights', 'trend', period]` and listens for area `"transactions"`.
- **Unit B (ledger)** publishes `TransactionRecorded {area: 'ledger'}`.
- **Unit C (profile)** publishes `PaydayChanged` with no area, because it is "settings".
- All three follow AD-4 ("events … name the changed areas") and AD-13 ("invalidate only the query keys of the changed areas"). Insights never refreshes. A payday or timezone change, a currency exponent change, or toggling hide-amounts leaves Home stale (HOM-004 requires refresh on settings and period changes).
- **Fix: new AD "Events and invalidation vocabulary".** Keep a closed, typed `Area` enum in `core/writer` (e.g. `transactions, accounts, captures, budgets, goals, recurring, learning, profile, period`). Every query function declares the areas it reads, and its TanStack key is `[area-set…, queryName, params]`, generated from that declaration, never written by hand. Keep an event catalog file (name, payload type, areas, publisher module). A change to `profile` or `period` invalidates every query that depends on a period. Payloads carry `actor: 'user' | 'auto' | 'import' | 'restore' | 'system'`.

### ADV-H3 — Tables with no owner: `category`, `audit_event`, `settings`, `schema_migration`

- The AD-3 ownership table does not list `category` (§11.1). **Unit A (ledger: splits story)** creates and owns `category`, since splits reference it. **Unit B (planning: 50/30/20 story)** needs `budget_type` (CAT-006) and builds category management in planning. **Unit C (learning)** keeps item categories next to `learned_mapping`. CAT archive/merge (rewriting splits) then has two owners.
- `audit_event` is written by every module, each in its own format (FIN-026 "an audit row each", FIN-014, FIN-027 Merge).
- `settings` is listed under profile, but SET-001's appearance settings are UI-only and could go to Zustand/MMKV instead.
- **Fix: tighten AD-3's table.** `category` → ledger (with `budget_type`; planning reads it). `audit_event` → ledger, with one `appendAudit(kind, entityId, redactedDiff)` operation that other modules call inside their UoW. `schema_migration` → storage adapter. Add a rule: "every table in the Drizzle schema appears in this table; CI fails on a table without an owner tag."

### ADV-H4 — Hide-amounts lives in Zustand, but the core must decide notification and widget forms from it

- **Unit A (home/settings UI)** follows AD-13 literally ("Zustand holds UI-only state (… hide-amounts toggle)") and keeps hide-amounts in Zustand, saved with a UI storage helper.
- **Unit B (capture notifications)** follows AD-11 ("the core decides … hidden or full form, SEC-005") and AD-10 (snapshot has "whether amounts may be shown"). It reads `profile.settings.hide_amounts`, which nobody writes.
- **Clash.** SET-005 says hide-amounts "applies everywhere at once: app, widget, notifications". Notifications and the widget leak amounts while the app hides them. This is a privacy defect.
- **Fix: tighten AD-13 and AD-11.** Hide-amounts, app-lock enabled, full-notification opt-in and lock-screen actions are **profile settings** changed by writer commands. Zustand may only mirror them for rendering. Remove "hide-amounts toggle" from AD-13's Zustand examples.

### ADV-H5 — Opening balance has two representations, and the card opening sign is not set

- **Unit A (accounts story)** stores `account.opening_minor` / `opening_effective_at` (§11.1) and computes balance = opening + postings (FIN-011).
- **Unit B (ledger/transactions story)** follows FIN-003 (`opening_balance` is an event type) and ACC-008. It creates an `opening_balance` transaction with a posting, so balance = sum of postings.
- Together they count the opening balance twice. For cards, A stores `opening_minor` as the positive dues entered ("₹8,200 owed"). B follows AD-5 and posts −8,200. The card balance then flips sign. AD-5 covers postings only.
- **Fix: tighten AD-5.** Choose one representation, e.g. "an opening balance is **only** an `opening_balance` transaction with one posting at `opening_effective_at`; `account` has no amount column; 'balance not set' = no such transaction". Every stored amount (`credit_limit_minor`, `statement_due_minor`) is a positive magnitude and is never a balance. FIN-016 "before tracking started" is derived from that posting's instant.

### ADV-H6 — Ledger rows point "upstream" to modules ledger cannot read

- §11.1 places `transaction.merchant_id/payee_id` (learning's tables), `transaction.recurring_rule_id` (planning's table) and `account_identifier.sender_id` (capture's table, though ledger owns `account_identifier`) in ledger. `possible_duplicate` is derived from capture's `review_candidate`.
- **Unit A (ledger: Activity timeline, TXN-006)** must show merchant name, a "possible duplicate" row state and "Reject · Not mine vs Delete" (which depends on whether the source is a capture). AD-3 forbids ledger from reading learning or capture, so the agent copies the merchant name into `transaction`.
- **Unit B (learning)** renames and merges merchants (FIN-025) and expects Activity to update. INS-014 "Top merchants" is in insights, which cannot read learning either (there is no `insights → learning` arrow).
- **Fix: tighten AD-3.** (a) Move `account_identifier` to capture (it is sender-scoped matching data), or move `sender` to ledger. (b) Allow ledger rows to hold *opaque foreign ids* only. Composite read models (Activity rows, top merchants, to-check list) belong to `insights` (renamed or extended as the read-model module), which may read every module, including capture and learning. Add `insights → capture` and `insights → learning` to the dependency diagram. (c) REC-004 "advance once" is a planning handler on ledger events, not a ledger write to planning.

### ADV-H7 — Restore bypasses the writer, its events and post-restore re-derivation

- **Unit A (backup: restore story)** follows BKP-002 "commit atomically" by swapping the encrypted DB file (re-keyed to this device's key) plus the attachments directory. That is a file operation, not a writer command, so AD-4 gives it no events.
- **Unit B (widget / notifications / scheduler stories)** depend on post-commit handlers to refresh the widget snapshot, reschedule bill reminders (REC-003), reset `sms_cursor` behaviour and refresh queries.
- **Clash.** After a restore, the widget shows the old count, bill reminders for deleted rules still fire, and the restored `clock_guard`/`sms_cursor` from another device or time can block auto-approve or re-ingest SMS (tombstones do protect against the re-ingest).
- **Fix: new AD "Restore".** Restore is a writer-level operation: close the writer, verify, safety-copy, swap, open (migrate if older; refuse if newer), then publish `DataRestored {areas: all}`. Every module registers a `rebuildDerived()` hook that runs in a fixed order: profile → ledger → capture → learning → planning → widget/notifications/scheduler. List the device-local state that is **not** restored (clock_guard, sms_cursor position policy, scheduled jobs, widget snapshot) and set the "restore order" explicitly.

### ADV-H8 — The learning trigger lacks actor provenance and atomicity

- **Unit A (capture dialog story)** teaches learning inside the Approve command by calling `learning.Learn` in the same UoW (AD-3 allows capture → learning).
- **Unit B (learning story)** follows AD-4 ("learning … run[s] only as post-commit event handlers") and listens for `TransactionCategorised`, which is also published by the Activity edit, bulk recategorisation (TXN-010) and Merge.
- **Clash.** Learning happens twice for dialog approvals, so LRN-003's "last 5 confirmations" mixed window fills twice as fast. If the payload carries no actor, B also learns from `auto_approved` writes, which breaks LRN-008. B's handler write is a second transaction, so a crash between the two loses the lesson. That is acceptable only if the spine says so.
- **Fix: tighten AD-4.** Learning updates **only** through its post-commit handler and never inline. Events that change category, account or credit type carry `actor` and `teachable: boolean`. Only `actor = user` with explicit choice is teachable (LRN-008). Bulk recategorisation is teachable once per merchant. State that the lesson is "at-least-once, idempotent on (transaction_id, version)".

### ADV-H9 — Retention purge and tombstones cross ledger and capture with no owner

- FIN-014: soft-deleted manual entries are purged after 30 days and rejected captures after 90 days, leaving a tombstone (capture-owned) of the duplicate fingerprint (computed in capture's normalize stage).
- **Unit A (ledger: delete/undo story)** writes the purge job in ledger. Ledger cannot write `tombstone` or read the fingerprint (AD-3).
- **Unit B (capture: tombstone story)** purges from capture by deleting ledger rows. This is allowed only through ledger commands, which do not exist, so the agent adds `ledger.HardDelete` with no guard. FIN-015 ("accounts with history can't be hard-deleted") and attachment files are then forgotten.
- **Fix: tighten AD-3/AD-6.** Purge is one writer command `PurgeExpired` owned by capture (it owns fingerprints and tombstones). It calls ledger's `purgeTransaction` operation (cascading postings, splits, receipt_items, attachments and their files via FileStore, audit rows → redacted). It runs from the Scheduler and on app open. Every transaction (manual included, per C1) has a `source_record` with a fingerprint, so a tombstone can always be made.

### ADV-H10 — "Single serialized writer" is undefined across Android processes and JS runtimes

- **Unit A (capture dialog, AD-10)** launches a dialog-styled activity. To keep its open time under 400 ms, the agent gives it `android:process=":dialog"` or a separate ReactHost.
- **Unit B (SMS job, AD-9)** runs headless JS from WorkManager. **Unit C (main app)** holds its own `LedgerWriter` instance.
- All of them follow "a single serialized `LedgerWriter`" inside their own runtime. Two or three writers then share one SQLCipher file. Auto-approve can run twice (job and app open at the same time, FIN-026(3) "whichever runs first"), and `SQLITE_BUSY` appears mid-import.
- **Fix: tighten AD-4/AD-14.** One Android process, one JS runtime and one writer instance per process. The dialog activity and headless tasks must run in the main process and share the same ReactHost. Also add a DB-level guard: commands that must run once (`WriteAutoApprovals`, `PurgeExpired`, SMS catch-up) take a lease row in the same UoW and are idempotent on their business key (cutoff date, cursor). Configure WAL and `busy_timeout` in the adapter.

### ADV-H11 — Capture must match bill rules (REC-009 / CAP-011) but cannot read planning

- **Unit A (capture: classify stage)** follows AD-6 and AD-3. There is no `capture → planning` arrow, so it cannot see recurring rules and never asks "Rent paid?".
- **Unit B (planning: recurring story)** implements REC-009 as a post-commit handler that, after a transaction is confirmed, looks for a matching rule. It then has no way to show a prompt in the capture card before the confirmation.
- **Clash.** The feature works in neither place, or an agent adds a planning import in capture against AD-3. FIN-026(3) "auto-approval never links a bill rule" also needs capture's classify stage to know about rule matches.
- **Fix: tighten AD-3.** Either add `capture → planning` (read-only: `matchingBillRules(candidate)`), or define a planning-owned `BillMatcher` port that capture's classify stage calls. Linking is a planning operation (`linkPaymentToRule`, which advances `next_due_at` once, REC-004) composed into the capture command under C2.

---

## Medium

### ADV-M1 — "To-check count" is computed in four places

The widget snapshot handler (AD-10), the Home "N to check" card, the grouped capture notification (CAP-005) and the evening summary each need the count. Each agent writes its own query, and one forgets to exclude `needs_category` (TXN-008), or counts open `review_candidate`s instead of `needs_review` transactions. **Fix:** name one query `toCheck()` → `{count, items}` (owner: the read-model module from H6). AD-10 and AD-11 must call it, and they must not count on their own.

### ADV-M2 — Notification policy state (caps, ordering, merging) has no owner

SET-003 caps (one per threshold per period, at most 3 "other" per day, bills before budget alerts, overflow merged into "N more reminders", evening summary only after the auto-approve commit) need persistent daily counters and a single dispatcher. The budget handler and the recurring-reminder handler each call the Notifier directly (AD-11 allows any core caller). Caps are then enforced per module, or not at all. **Fix:** tighten AD-11 with a core `NotificationPolicy` (owner: profile, or a new `notify` module with a `notification_log` table). Every notification goes through it. Handlers submit *intents*, and the policy applies caps, ordering and privacy form.

### ADV-M3 — CSV import batches vs events, alerts and writer fairness

IMP-005 commits 500 rows per batch. Each batch is a writer command with its own event batch, so BDG-004 "only the highest threshold fires per change" fires once per batch (75% from batch 1, 90% from batch 2…). A 20-batch import also blocks the queue while the capture dialog's Approve waits. "Rows from the same file are never matched against each other" needs `import_batch_id` context across batches. **Fix:** an import is a resumable job of writer commands that yields between batches. Events carry `importBatchId`, and planning delays alert evaluation until `ImportCompleted`. The FIN-027 matching operation takes an `excludeBatchId` parameter.

### ADV-M4 — Image and file lifecycle: OCR captures before a transaction exists

`attachment` (ledger) has a non-null `transaction_id`. The receipt OCR flow (capture) and UPI screenshots (UPI-007: discard unless attached) produce image files before any transaction exists. `import_batch.raw_path` is a capture-owned file. One agent writes images through FileStore at scan time, and another only at Save. Orphan files are never removed, and backup (BKP-001 "attachments") includes or misses them depending on the folder. **Fix:** a FileStore rule covering staging vs committed areas: capture writes to staging, the attach operation moves the file into the ledger-owned store inside the UoW (the file move happens after commit), and the scheduler cleans staging. Backup includes only the committed store and import raw files that are still retained.

### ADV-M5 — Command registry, naming and return shape

The seed puts a "commands registry" in `writer/`, but modules own the commands. Agents define `RecordExpense` in both ledger and capture, return `Result<T>` in one place and `Result<{value, events}>` in another, and register commands either by string or by import. **Fix:** commands are named `<module>.<Verb>` (e.g. `ledger.ConfirmTransaction`), defined in their module and registered by a module manifest. The signature is `(input, ctx:{tx, clock, ids, emit}) → Result<Output, ErrorCode>`. Events are emitted through `ctx.emit` only. Error codes go in one per-module enum.

### ADV-M6 — Two stories generating migrations at once; core vs adapter schema types

AD-7 makes drizzle-kit generate numbered migrations from one schema in `apps/mobile`. Two parallel branches each produce `0007_*.sql` plus a conflicting `meta/_journal.json`. Core modules "own" tables they cannot declare (no Drizzle in core), so each story writes its own core entity type and adapter mapping (e.g. `tags[]` as JSON in one, a join table in another). **Fix:** one schema file per module (`adapters/storage/schema/<module>.ts`). Migrations are generated only on `main` after a rebase (a CI check fails if the journal is not linear). Core entity types in `core/<module>/model.ts` are authoritative, and the adapter has a mapping test per table.

### ADV-M7 — Other modules need to write profile tables but may only read them

Capture's `WriteAutoApprovals` must update `clock_guard` (FIN-026(6)). The SMS re-ask (SMS-014) updates `prompt_state`. CAP-012 one-time tips update `prompt_state`. AD-3 says "every module may read profile", so one agent adds a direct table write (breaks AD-3) and another keeps clock state in memory (breaks the clock guard across job runs). **Fix:** profile exposes operations (`recordClockSample`, `bumpPrompt`) that any module may compose under C2. State that "may read profile" also means "may call profile operations".

### ADV-M8 — Who knows the "schema version" for backup manifests

The core backup module writes the manifest (format and schema version), but the Drizzle migration number exists only in the adapter. One agent hard-codes `SCHEMA_VERSION` in core, and it drifts from the migrations. **Fix:** the storage port exposes `schemaVersion()` and `migrate(from→to)`. The manifest records both `backupFormatVersion` (core) and `schemaVersion` (adapter). Restore refuses a newer schema and migrates an older one (BKP-005).

---

## Low

### ADV-L1 — Which events carry splits

AD-5 says expense and income carry splits that sum to the absolute amount. Refund splits use the original's category (FIN-028). It does not say whether `adjustment`, `opening_balance`, `reversal` and transfers have splits, or whether an adjustment counts toward spending or income. One agent gives adjustments an "Uncategorised" split, so they appear in 50/30/20 "Not classified". **Fix:** add a table to AD-5 listing, for each `event_type`, its posting count, whether it has splits, and how it counts in spending, income and savings.

### ADV-L2 — UUID v7 ids embed time outside the Clock port

`shared/ids` generating UUID v7 with `Date.now()` breaks AD-14, and tests become non-deterministic. **Fix:** the id generator takes its time from `Clock` (inject it through `ctx.ids`).

### ADV-L3 — Money with a foreign exponent

TXN-013 keeps `foreign_amount_minor` with `foreign_currency_exponent`. A shared `Money` type "+ profile exponent" lets an agent format a foreign amount with the profile exponent (JPY shown on an INR profile). **Fix:** `Money` carries its currency code and exponent. Only `ProfileMoney` takes part in arithmetic and invariants.

---

## Suggested spine changes (summary)

| New / tightened | Closes |
| --- | --- |
| New AD "Pending-item model" (every item a transaction at intake; intake only via capture; status-transition table) | C1, M1, H9 |
| AD-4: writer commands vs module operations; one event batch; no nesting; handler depth 1 | C2, H1, H8, H11 |
| New AD "Period authority" + period-boundary history in profile; fix convention row | C3 |
| New AD "Events & invalidation vocabulary" (Area enum, event catalog, generated query keys, `actor`) | H2, H8, M3 |
| AD-3: complete ownership table, owner tag check in CI, read-model module allowed to read all, `capture → planning` (read) | H3, H6, H11, M7 |
| AD-13/AD-11: privacy settings in profile; NotificationPolicy | H4, M2 |
| AD-5: single opening-balance representation; magnitudes vs balances; per-event-type posting/split table | H5, L1 |
| New AD "Restore & derived state" | H7, M8 |
| AD-4/AD-14: one process, one runtime, one writer; run-once leases | H10 |
| AD-7: per-module schema files, linear migration journal | M6 |
| FileStore staging rule | M4 |
| Command contract convention | M5 |
