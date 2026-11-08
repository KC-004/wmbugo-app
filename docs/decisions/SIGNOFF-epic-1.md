# Epic 1 sign-off checklist (GATE-03, GATE-07, GATE-04 evidence)

Status: **ready for sign-off**. Nothing below is signed. Each signature is a person's decision; the evidence is here so it takes minutes, not a meeting.

Prepared 2026-11-08 from the built and tested state of `fix/epic-1-review`.

## GATE-03: reference devices and performance method (Mobile architect / product owner)

Decision record: [S8-reference-devices.md](S8-reference-devices.md).

| Check | Evidence | Result |
|-------|----------|--------|
| Main reference device named | Xiaomi Redmi Note 11 Pro+ 5G, Android 13 / API 33, 6 GB, read over adb | done |
| Budget reference device | Interim: Android 9 emulator. A real budget phone (Android 8 to 10, 3 GB or less, entry SoC) is **not yet named** | **your decision** |
| Method written (conditions, data sets, run counts, pass rules per NFR) | S8 section 3 | done |
| Glass capability rule decided | S8 section 4 (API 31, reported RAM 3,500 MB) | done |
| NFR-04 save p95 under 500 ms on the main device | In-app benchmark `bench.save` on a separate encrypted database with 10,000 entries; result below | see "Measured results" |

Sign here, with a name and a date: `Signed: ____________ / ____________`

If you do not have a budget phone yet, sign with the line "main device only, budget device pending" so the performance targets stay provisional on the budget row.

## GATE-07: posting sign convention and worked examples (Finance domain reviewer)

Decision record: [S2-initial-schema.md](S2-initial-schema.md), section 7 (worked examples).

| Check | Evidence | Result |
|-------|----------|--------|
| Sign convention: a posting is positive into an account and negative out of it, for every account type | `posting_sign_check` constraint in migration 4; `entryShape` and `openingBalanceShape` invariants checked on every write | enforced and tested |
| Expense: one negative posting equal to the amount | `packages/core/src/ledger/entries.test.ts` | green |
| Income: one positive posting | `entries.test.ts` | green |
| Transfer: two postings that sum to zero; neither income nor expense; a fee is a separate expense | `packages/core/src/ledger/transfers.test.ts` | green |
| Card: owed amount stored negative, shown as positive "Card dues", never added into "In accounts" | `ledger.test.ts`, `home.test.ts` | green |
| Opening balance: one posting; `account.opening_minor` always equals it | invariant added after the review; `ledger.test.ts` "opening_minor equals the opening posting" | green |
| Removed entries (Undo) leave every total and balance | `entries.test.ts`, `home.test.ts` | green |
| Refunds, liabilities beyond cards, budget formulas | Not built yet (Epics 2 and 3); the reviewer's examples for these are reviewed then | out of scope for Epic 1 |
| Duplicate column `account.opening_minor` | Decision in S2 section 4.1: keep, guarded by the invariant | **your decision** |

Sign here: `Signed: ____________ / ____________`

## GATE-04 evidence (encrypted storage and CI)

| Check | Evidence | Result |
|-------|----------|--------|
| Database is SQLCipher and the key never leaves the Keystore | Device check: header is not plaintext (`scripts/check-encrypted-db.mjs` on the pulled file), key regeneration refused when a database exists | done on the Redmi |
| CI job that repeats that check on an emulator | `.github/workflows/ci.yml` job `encrypted-db`; its script was run end to end locally on an emulator (see "Measured results") | **needs one run on GitHub** |

## Measured results

### NFR-04 manual-entry save, main reference device (S8 method, section 3)

| Device | Redmi Note 11 Pro+ 5G, Android 13 |
|---|---|
| Build | release, `nosms`, debuggable opt-in (so the log can be read), Hermes, bundled JS |
| Data set | S10k: 10,000 confirmed expenses over 24 months, in a separate encrypted database (own random key) created for the run and deleted afterwards; the user's own database is never opened |
| What is timed | `RecordManualEntry` through the real `LedgerWriter` (transaction, posting, split, audit, outbox, invariants) |
| Runs | 53, the first 3 discarded, 50 measured |
| Result | median **38.3 ms**, p95 **53.9 ms**, worst 55.5 ms |
| Rule | p95 under 500 ms: **pass** (about 9 times under the limit) |

Not included in that number: the toast render. Every manual save also logs `save.entry` with the full path to the toast (validation done to toast shown), so the figure can be read from the device log at any time. Run it again with: `adb shell "run-as app.wmbugo touch files/bench-save"`, restart the app, read `bench.save` in `files/logs/wmbugo.log`.

Limits: one device; the interim budget device is an emulator and cannot give valid timings (S8 section 1).

### Scripted checks on an emulator (Android 17 image, API 37)

- `scripts/ci-check-encrypted-db.sh` end to end: install, first launch, pull the database, header check: **OK, encrypted**.
- `scripts/e2e-smoke.mjs`: onboarding, Add sheet typed with the **hardware keyboard** (digits, decimal key, Backspace), Save and the Saved toast, Activity row, Home Spent: **6 of 6 passed**. This job is part of the CI emulator job and has not yet run on GitHub.
- The Redmi refuses injected input even with Xiaomi's "USB debugging (Security settings)" on, so taps and keys on that phone remain manual; everything else above was run on it.

### Standard release builds

`assembleNosmsRelease`, `assembleSmsRelease`, `pnpm check:permissions` and `pnpm check:not-debuggable` pass (the last also fails correctly on a debuggable APK).

## GATE-07 worked examples (Story 2.1), for the finance reviewer

Amounts are shown as the person sees them. "Period" is November 2026. Source: `packages/core/test/fixtures/finance/fixtures.ts`, run by `finance-fixtures.test.ts` against the real ledger.

| # | What was recorded | Balances | In accounts | Card dues | Spent | Income |
|---|-------------------|----------|-------------|-----------|-------|--------|
| F1 | HDFC bank opens at ₹30,000.00, then is adjusted to ₹31,200.00 | HDFC ₹31,200.00 | ₹31,200.00 | none | ₹0.00 | ₹0.00 |
| F2 | HDFC ₹50,000.00; Visa card dues ₹8,200.00; ₹8,200.00 paid from HDFC to Visa | HDFC ₹41,800.00; Visa owes ₹0.00 | ₹41,800.00 | ₹0.00 | ₹0.00 | ₹0.00 |
| F3 | DBS S$1,000.00; Cash S$0.00; S$200.00 DBS to Cash with a S$2.00 fee | DBS S$798.00; Cash S$200.00 | S$998.00 | none | S$2.00 (the fee only) | S$0.00 |
| F4 | HDFC ₹10,000.00; savings pot Holiday ₹0.00; ₹5,000.00 into the pot | HDFC ₹5,000.00; Holiday ₹5,000.00 | ₹10,000.00 | none | ₹0.00 | ₹0.00 |
| F5 | HDFC opens at ₹10,000.00; an expense of ₹300.00 dated two days before it opened | HDFC ₹10,000.00 (the expense is before tracking) | ₹10,000.00 | none | ₹300.00 | ₹0.00 |
| F6 | HDFC ₹20,000.00; Visa dues ₹4,500.00 plus a ₹2,000.00 charge; Amex with no balance set; ₹50,000.00 income to HDFC | HDFC ₹70,000.00; Visa owes ₹6,500.00; Amex not set | ₹70,000.00 | ₹6,500.00 (+1 card not set) | ₹2,000.00 | ₹50,000.00 |

Rules the fixtures encode: a card's ledger balance is negative while owed and "Card dues" shows its negation; a card payment and a savings-pot deposit are transfers, so they are neither spending nor income; In accounts and Card dues are never added together except into net worth; a balance that is not set is never shown as zero; an entry dated before an account's opening instant does not change its balance but still counts as spending.

Reviewer sign-off on these six: `Signed: ____________ / ____________`
