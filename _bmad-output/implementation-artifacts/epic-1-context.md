# Epic 1 Context: Private setup and first expense

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A new user installs wmbugo, sees the privacy promise, confirms region and currency, optionally adds one account, and records a first expense, income or transfer in about six seconds, fully offline, with all data encrypted on the phone. The epic also lays the foundations every later epic builds on: the pnpm workspace and CI gates, exact money and time primitives with a property suite, the encrypted database and migrations, the atomic writer with audit and outbox, the design system, the app shell and the accessibility primitives. Home is a minimal shell here; the full Home arrives in Epic 5.

## Stories

- Story 1.1: Starter workspace, Android flavors and CI gates
- Story 1.2: Spike S1 — Encrypted storage and migration toolchain
- Story 1.3: Spike S8 — Reference devices and benchmark method
- Story 1.4: Exact money and time primitives with a property suite
- Story 1.5: Spike S2 — Initial schema and migration plan
- Story 1.6: Encrypted database opens on first launch
- Story 1.7: Atomic writer with audit trail, outbox and query cache
- Story 1.8: Design tokens, theming and brand assets
- Story 1.9: Shared controls and accessibility primitives
- Story 1.10: App shell, navigation and feedback patterns
- Story 1.11: Onboarding — privacy welcome, region and currency, payday
- Story 1.12: First account and the accounts list
- Story 1.13: Add sheet — record a first expense in about six seconds
- Story 1.14: Home shell and Activity list of saved entries
- Story 1.15: Record income and transfers between accounts
- Story 1.16: Settings hub with appearance and finance settings

## Requirements & Constraints

- **Offline and private:** no sign-up, phone number, email or network request, ever. Release builds have no `INTERNET` or `ACCESS_NETWORK_STATE` permission. Onboarding requests zero runtime permissions. No analytics, crash-reporting or ads SDKs.
- **Encryption at rest:** the database is SQLCipher-encrypted with a random 256-bit key held in Android Keystore. The key is available after first unlock and is not bound to biometrics. It is never logged, written to a file, backed up or exported. OS cloud backup and device transfer are disabled.
- **Exact money:** integer minor units only, with the ISO 4217 exponent read from a stored table (IDR/HUF stored as whole units). Excess decimals are rejected, never rounded. No float arithmetic. Store → format → parse round-trips exactly. 10,000 random edits produce zero drift. Overflow returns `AMOUNT_TOO_LARGE`.
- **Dates:** every transaction keeps a fixed `local_date` and timezone from capture time. The `local_date` is never recomputed from the UTC instant. Changing payday, period or timezone never modifies existing transactions.
- **Atomicity:** every save is all-or-nothing, including its audit row and events. Transfer postings must sum to zero.
- **Honesty:** an unknown balance shows "not set", never zero. `In accounts` and `Card dues` are never summed. Transfers count as neither spending nor income.
- **Currency** can change only while no transactions exist.
- **Performance** (measured on the reference devices from 1.3, release build): Save p95 < 500 ms. Median tab navigation < 300 ms. The splash adds ≤ 1 s and ends on data readiness, never on a timer. Onboarding takes < 2 min in airplane mode.

## Technical Decisions

- **Workspace:** pnpm (`node-linker=hoisted`, one lockfile). `packages/core` is pure TypeScript, TS strict, and tested with Jest in plain Node. It has no dependency on react-native, Drizzle or op-sqlite, and lint/typecheck enforce this. `apps/mobile` uses RN CLI 0.88.x (New Architecture, Hermes) and depends on core, never the reverse. If Spike S1 cannot make cross-package Metro bundling work, the fallback is a single app with a lint boundary rule.
- **Hexagonal core:** all financial rules, totals, balances and periods live in core behind ports (Storage/UnitOfWork, KeyStore, Clock, Logger, FileStore). The UI only calls use cases and queries.
- **Module ownership:** `ledger` owns account, transaction, posting, split and category. `profile` owns profile, settings, prompt_state and the period service. `writer` owns audit_event and outbox. The storage adapter owns schema_migration. Modules never read each other's tables. Each table is created by the story that first needs it: 1.6 schema_migration; 1.7 audit_event, outbox; 1.11 profile, settings, prompt_state; 1.12 account, transaction, posting; 1.13 category, split. One migration per story.
- **Signs:** `posting.signed_amount_minor` is positive into an account and negative out of it, for every account type. A card's balance is negative while owed, and "Card dues" displays its negation. An opening balance is one posting with `posting_kind = opening_balance`. Expenses and income are one posting each, with splits summing to the absolute amount.
- **Schema conventions:** money columns are `INTEGER` with names ending in `_minor`, and no `REAL` columns (a schema-lint test enforces this). All IDs are UUID v7. Instants are UTC epoch ms. `category.budget_type` exists from the first schema version.
- **Storage:** op-sqlite 19.x with SQLCipher, plus Drizzle and drizzle-kit 0.45.x (not the 1.0 RC), using the `expo` driver with `.sql` files loaded through Metro/Babel. On open, the adapter checks `PRAGMA cipher_version` and refuses to continue if it is empty. Migrations run forward-only in one transaction, after a safety copy is made. SQL may only filter, join and sum using inputs the core supplies.
- **Writer:** `LedgerWriter` runs one named use case at a time in a `BEGIN IMMEDIATE` transaction. Invariant checks run before commit and return `INVARIANT_VIOLATED` on failure. The audit row and outbox events are written in the same transaction. Delivery is at-least-once, handlers are idempotent on event id, and undelivered events are redelivered on next start.
- **Events:** `TransactionsChanged` and `ProfileChanged` come from a type-checked catalogue. Each event invalidates only its mapped TanStack Query keys (`networkMode: 'always'`).
- **UI state:** Zustand holds transient UI state only (open sheets, the Add draft). It never holds money, totals or persistent preferences.
- **Interim use case:** manual saves use `RecordManualEntry`. This is an accepted temporary deviation from the single `SubmitCapture` pipeline, and Story 3.2 retires it.
- **Errors:** expected failures return a typed `Result` with a named code (e.g. `EXCESS_DECIMALS`, `SAME_ACCOUNT`, `INSUFFICIENT_FUNDS`, `CURRENCY_UNSUPPORTED`). Each code maps to one copy-catalogue entry.
- **Time and logging:** all time comes from the Clock port, and core may not call `Date.now()` (lint rule). All logging goes through the redacting Logger port to a size-capped private file. No `console.log` in shipped code.
- **Periods:** only the profile period service converts a `local_date` to a period (calendar month, or a pay cycle on the 1st, last day, last working day or day N).
- **Android:** applicationId `app.wmbugo`, min/target/compile SDK 26/36/36, flavors `nosms` and `sms` (no SMS permission yet), `allowBackup=false`.
- **CI:** GitHub Actions runs lint, typecheck, core tests, the nosms release build, the permission-allowlist check and the encrypted-DB header check. A pre-push hook runs the core tests. The fast-check property tests are written before the features they protect.

## UX & Interaction Patterns

- **Visual system:** no UI kit. Typed design tokens live in `apps/mobile/src/shared`, and a lint check bans hex literals elsewhere. Themes are System, Light and Dark, teal only. Glass surfaces switch to `glass-fallback` below API 31, below the capability threshold from Spike S8, under battery saver, at animator scale 0, or with reduce transparency on. Inter is bundled. Phosphor is the only icon set, with no emoji.
- **Money display:** the shared `<Amount>` component is the only way to render money, using the shared Intl formatter (INR lakh grouping and `tnum`). Expenses are unsigned and income shows `+`. No minus sign is ever shown. Amounts are never truncated or wrapped mid-number at 320dp × 200%.
- **Navigation:** bottom tabs Home · Activity · ＋ · Insights · Plan, with per-tab stacks and no drawer. Below 600dp the tab bar is glass; at 600dp and wider it becomes an 80dp rail. ＋ is a 56dp gradient circle with the app's only shadow, and it opens the Add sheet. Each header ends with the Accounts icon and the avatar, which opens Settings.
- **Sheets:** one at a time, never stacked. Each has a sticky footer and traps focus. Swipe, Back or the scrim dismisses it, and focus returns to the opener. **Toast:** one at a time with Undo, shown for at least 10 s, pausing on touch or focus, announced politely. **Feedback states:** one-time tips (at most one per session, stored in `prompt_state`); empty state (boat illustration, one sentence, one button); inline `ErrorBlock` ("Nothing was saved", Retry, plus an alternative path, with focus moved to the field); skeletons that fade values in over 150–250 ms.
- **Accessibility floor:** controls are at least 48dp and keypad keys at least 56dp. Every control has a visible focus ring and exposes role and state in its TalkBack label. Amounts are read in full with direction, and `~` is read as "about". Live regions announce the keypad amount and toasts. Meaning never relies on colour alone. Reduced motion is honoured, both from the system and from the in-app setting.
- **Copy:** all strings come from one catalogue. Calm voice, sentence case, no guilt copy, and "Rough is fine".
- **Banned:** spinners (`ActivityIndicator`), numeric badges, "Inbox", "coming soon", OK-only dialogs, tutorials, pull-to-refresh, and gesture-only paths.
- **Add sheet flow:** Expense/Income/Transfer segments, then quick-category chips, account chip, amount and keypad. Save sits bottom-right, followed by the `Saved · Undo` toast. The draft is restored from memory only. Snap receipt and UPI chips are absent from the sheet entirely, not shown disabled.

## Cross-Story Dependencies

- 1.1 comes first. Spikes 1.2 (S1), 1.3 (S8) and 1.5 (S2) follow it. S1 may force the single-app fallback and rework 1.1's layout (accepted risk).
- 1.2 and 1.4 feed 1.5. 1.5 feeds 1.6. 1.6 feeds 1.7. Every later data story uses 1.7's writer.
- 1.3 sets the reference devices and the glass threshold used by 1.6, 1.8 and 1.10 and by all performance criteria.
- 1.4's formatter is used by 1.8, 1.9, 1.11 and 1.16. 1.8 feeds 1.9, and 1.9 feeds 1.10, which is the base for all screens.
- 1.10's sheet host feeds 1.13. 1.10's tooltip store is wired to `prompt_state` in 1.14.
- 1.11 → 1.12 (account step inside onboarding) → 1.13 → 1.14 → 1.15. The "block transfers above the balance" setting is shared between 1.15 and 1.16.
- Later epics: Epic 3 replaces `RecordManualEntry` with `SubmitCapture`, Epic 4 consumes the 50/30/20 answer stored in `prompt_state`, Epic 5 replaces the Home shell, and Epic 13 completes SEC-001's SMS part.
