---
status: final
stepsCompleted: [1, 2, 3, 4]
storiesEpicsDone: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/prd.md
  - _bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-wmbugo-app-2026-11-07/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-wmbugo-app-2026-11-07/EXPERIENCE.md
---

# wmbugo-app - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for wmbugo-app, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

Requirement IDs are the PRD's own stable IDs (FIN-, ONB-, TXN-, …); LIR-01..11 label the PRD §7.4 ledger integrity rules; RB0-n / RB1-n label the §16.2 release blockers.

## Requirements Inventory

### Functional Requirements


#### 7. Core financial model (FIN)

- FIN-001 [P1]: Amounts are stored as signed integer minor units using the profile currency's stored ISO 4217 exponent (IDR/HUF stored as whole units), formatted by region through one shared formatter, with NaN/infinity/overflow/excess-decimal input rejected (keypad blocks, never rounds silently) and no floating-point currency persistence.
- FIN-002 [P1]: Each transaction stores a UTC instant plus its capture-time timezone and a fixed `local_date` that never re-groups; periods, payday cycles and the auto-approve cutoff use the profile timezone; period membership uses `local_date`; date-only CSV rows are taken as written in the profile timezone; DST never moves a transaction's day; a device-vs-profile timezone difference ≥ 2 h for > 24 h prompts once to switch, applied from the next day only on Yes.
- FIN-003 [P1]: The domain distinguishes expense, income, transfer, opening_balance, adjustment, refund and reversal and retains intent and provenance in storage even when the UI simplifies types.
- FIN-010 [P1]: Accounts are typed cash, bank, payment wallet, savings pot or credit-card liability, each with stable ID, name, icon, palette colour (defaulted by type), profile currency, opening balance + effective date or "balance not set", active/archive status and optional masked identifiers held in `account_identifier`.
- FIN-011 [P1]: Asset balance = opening balance + net asset postings; card outstanding = opening liability + charges − payments − credits, shown as money owed and never mixed into assets as a negative cash balance.
- FIN-012 [P1]: The known-funds value sums only included asset accounts and never counts credit limit as available money; optional net worth (assets − known liabilities) is separately labelled.
- FIN-013 [P1]: Transfers between owned accounts create balanced atomic postings and never count as income or expense; cash withdrawal and card bill payment are transfers when both accounts are modelled.
- FIN-014 [P1]: Edits/reversals update postings, analytics and budgets atomically; manual deletes are soft with undo and purged after 30 days (Settings → Data → Recently deleted, Restore / Delete permanently), rejected captures and excluded import rows are kept 90 days under Show rejected then purged; purges leave only a salted-hash tombstone (fingerprint, outcome, date) that makes later matching imports/captures skip as "previously rejected/deleted" with per-row "Import anyway"; permanently deleting one transfer leg deletes both after a warning; deleting a refunded purchase keeps the refund unlinked.
- FIN-015 [P1]: Archived accounts preserve history and balances, accounts with postings cannot be hard-deleted, and balance corrections are explicit auditable adjustments.
- FIN-016 [P1]: Transactions dated before an account's opening instant appear in Activity/Insights tagged "before tracking started" (derived, not stored) but never change that account's balance; the opening date never moves automatically.
- FIN-020 [P1]: Each transaction carries id, type, status, integer amount, currency, effective_at, created/updated_at, posting links, category splits, merchant/payee, payment method, optional reference/notes/tags, source metadata and optional attachment link.
- FIN-021 [P1]: Expenses decrease assets or increase liabilities, income increases assets, payments to a card/liability are transfers, and refunds/reversals follow FIN-028 and are never income.
- FIN-022 [P1]: A transaction's category allocations sum exactly to its categorisable amount, a receipt total equals items + tax/fees − discounts/adjustments in exact minor units, and missing OCR items become an explicit "Not itemised" split row.
- FIN-023 [P1]: A reimbursement can be recorded as a refund/recovery linked to the original expense, with both net and gross views offered and no recovery subtracted twice.
- FIN-024 [P1]: Status values are draft, needs_review, confirmed, excluded, reversed plus a derived possible_duplicate flag; only confirmed non-excluded items count in headline totals; captures record `capture_resolution` (user_approved/auto_approved/auto_linked/rejected); pending captures, review queue and widget count are the same `needs_review` set; rejected captures are restorable to confirmed atomically; scam SMS create no transaction (at most a redacted source_record); the capture-status mapping table and user labels (Recorded, Recorded · category guessed, Recorded · needs a category, Recorded · linked as transfer, Waiting for you, Possible duplicate — check it, Looks like a scam — not added, Rejected) are the shared UX/architecture contract.
- FIN-025 [P1]: Merchant normalization is editable and keeps original source strings, and user corrections supersede auto-categorization via local learning (LRN).
- FIN-026 [P1]: Auto-approve is always a database write, never derived on read: eligible captures stay needs_review/"Waiting for you" everywhere until the first of a best-effort background job or next app open/resume after the profile-timezone cutoff writes them in one transaction as confirmed/auto_approved with audit rows (transfer auto-linking inside the same transaction), budget alerts run once after commit, no bill linking or learning occurs, settings are versioned (loosening applies immediately, tightening from the next day, past days never re-evaluated), ineligible-before-write captures stay pending, and a clock guard (wall time, elapsed since boot, boot count; reboot trust window 30 days; stored latest time capped at now + 1 day) prevents early approval.
- FIN-027 [P1]: Duplicate matching keys on (reference, direction, event type); opposite-direction same-reference items are classified by account (same account → reversal/refund, different owned account → linked transfer, unknown → held for review); differing references are never duplicates; reference-less items match on equal amount, ±1 day and normalized merchant (receipts also match a same-day same-merchant charge 0–30% higher); manual same-amount same-merchant entries flag only within 10 minutes; CSV rows never match rows from the same file and use an occurrence index per (date, amount, description); partial edge days go to review; Merge takes account/amount/time by source authority (bank/card/UPI > CSV > receipt > manual), items from the receipt, a "Tip / adjustment" split for differences, keeps all sources and excludes the merged-away record with an audit row; transfer-pairing windows are ±3 days (captures) and ±2 days (CSV).
- FIN-028 [P1]: A refund links to its original when known, reduces spending in the refund's own period in the original's (or chosen) category and its Needs/Wants type, and is never income or "Kept" income; a reversal of a failed payment cancels the debit in the original period even if closed, without re-firing that period's alerts.
- LIR-01 [P1] (§7.4, no PRD ID): For any internal transfer, the combined owned-asset posting sum is zero (excluding explicit fees).
- LIR-02 [P1] (§7.4): Every split's allocation sum equals the categorisable amount exactly.
- LIR-03 [P1] (§7.4): Importing the same file twice never duplicates confirmed entries.
- LIR-04 [P1] (§7.4): OCR of an existing SMS/manual expense never automatically creates a second confirmed expense.
- LIR-05 [P1] (§7.4): Auto-approve never confirms a capture flagged possible_duplicate, with an open review candidate, or matching an existing confirmed transaction.
- LIR-06 [P1] (§7.4): Every capture source reaches the ledger only through the shared pipeline (DEC-29); no source posts directly.
- LIR-07 [P1] (§7.4): Amounts round-trip exactly store → format → parse for every supported currency exponent.
- LIR-08 [P1] (§7.4): Opening balances and adjustments are distinguishable from income in charts.
- LIR-09 [P1] (§7.4): Expenses, refunds, reversals and card payments reconcile across charts and accounts.
- LIR-10 [P1] (§7.4): Large-value and repeated edits introduce no rounding drift.
- LIR-11 [P1] (§7.4): All ledger mutations are transactional with integrity validation and rollback.

#### 8.1 Onboarding (ONB)

- ONB-001 [P1]: The app opens and is usable without registration, phone number, email or network.
- ONB-002 [P1]: First-use flow (target < 2 min) is Welcome/privacy (three facts) → region and currency pre-selected from device region and explicitly confirmed → one optional account with approximate balance → payday chip (1st / last day / last working day / other / not salaried) → optional "Try 50/30/20?" → Home, with theme following the system.
- ONB-003 [P1]: Skipping the account is allowed and Home then shows "balance not configured" instead of implying accuracy.
- ONB-004 [P1]: Permission prompts are contextual and just-in-time; SMS/photo/notification permissions are never required for onboarding.
- ONB-005 [P1]: There is no upfront tutorial; one contextual tip is shown the first time each event occurs (first Home view, first capture, first budget) and tips never insert data.
- ONB-006 [P1]: Settings allow later changes, and changing the budget period triggers re-aggregation without mutating transactions.
- ONB-007 [P1]: Onboarding never asks for more than one account; further accounts come from capture discovery or manual add.
- ONB-008 [P1]: App lock is offered exactly once, after the first saved entry, never during onboarding and never again after dismissal.

#### 8.2 Accounts (ACC)

- ACC-001 [P1]: Users can create, rename, reorder, hide/archive and view accounts.
- ACC-002 [P1]: Each account has a configurable opening balance/date, an account-level timeline and an account-local reconciliation adjustment with a reason.
- ACC-003 [P1]: A credit card shows ledger-derived outstanding, optional user-entered statement due amount and date, and optional limit, without implying a bank connection.
- ACC-004 [P1]: Closing/archiving warns about nonzero balances or pending transfers and retains history.
- ACC-005 [P1]: Eligible asset accounts can be included/excluded from overview totals with an explicit label.
- ACC-006 [P1]: The accounts list groups "Money you have" and "Money you owe", never summed unless net worth is enabled, and totals excluding "balance not set" accounts say so ("+1 account not set").
- ACC-007 [P1]: Cards offer "Pay card bill", opening the Add sheet as a Transfer from a chosen asset account with amount = statement due if entered, else outstanding; Home "Card dues" always means outstanding.
- ACC-008 [P1]: A rough opening balance is corrected only via "Adjust balance" (explicit adjustment posting), never by editing the original amount.
- ACC-009 [P1]: Savings pots (SIP, RD, PPF, emergency fund) are optional-balance destinations; money moved in is a transfer counted as 50/30/20 Savings; everyday bank accounts are never pots; pots with a balance count in "In accounts" unless excluded, pots without one show as "Saved & invested" totals.

#### 8.3 Transactions (TXN)

- TXN-001 [P1]: The centre ＋ Add sheet offers Expense / Income / Transfer plus Snap receipt and (India) Share from UPI app; CSV import lives in Settings → Data only.
- TXN-002 [P1]: The expense form is amount-first with keypad open, quick-category chips (most-used, recalculated ≤ once/day, never reordered while open), account defaulted to the last used with that category, optional merchant/date/note/payment method/receipt, Save closes with Undo toast and "Save & add another" keeps it open.
- TXN-003 [P1]: The income form captures amount, destination account, income category/source and optional note.
- TXN-004 [P1]: The transfer form requires distinct from/to accounts, amount, date/time and optional fee as a separate expense, rejects self-transfer, and only warns on insufficient funds unless the user enables strict balance enforcement.
- TXN-005 [P1]: Users can edit, duplicate-as-new, reverse and undo, with "Delete" for manual entries and "Reject · Not mine" for captured entries and no deceptive irreversible action.
- TXN-006 [P1]: Activity groups by date with direction icon/colour, merchant, category, amount, account and status (unsigned expenses, "+" income/refunds, no minus sign); day headers show read-model "Spent" = confirmed expenses − refunds that day floored at 0 (excluding transfers, income, pending, reversed, rejected); rows render the defined states (confirmed, guessed, needs a category, waiting, waiting for currency amount, possible duplicate, transfer, refund, reversed, before tracking started, rejected).
- TXN-007 [P1]: Activity supports local indexed full-text search, combinable filters, sort (newest/oldest/highest/merchant) and virtualized pagination.
- TXN-008 [P1]: The review queue is exactly the needs_review set (ambiguous imports, suspected duplicates, pending captures) with confirm/link/exclude/correct actions; confirmed needs_category items are listed separately under "Add a category" and not counted in "N to check".
- TXN-009 [P1]: Split editing enforces exact sum reconciliation with an unallocated placeholder that blocks Save; a receipt's "Not itemised" amount is a split to seeded Uncategorised (`unparsed = true`), not unallocated.
- TXN-010 [P1]: Bulk recategorization of confirmed transactions requires preview and undo and never changes amounts.
- TXN-011 [P1]: Receipts and source metadata survive edits without duplicate attachments, and users can explicitly detach/delete images.
- TXN-012 [P1]: A manual entry matching a confirmed item is saved (never blocked) as needs_review + possible_duplicate, uncounted, never auto-approved, with toast "Looks like this is already recorded — Keep both / Merge" and a review-queue entry.
- TXN-013 [P1]: A capture/receipt/import in a non-profile currency is never auto-approved; review shows the foreign amount and requires the user to enter the profile-currency amount; the foreign amount is kept as metadata and no exchange rate is fetched or suggested.

#### 8.4 Categories (CAT)

- CAT-001 [P1]: Seed expense categories (Food & Drinks, Groceries, Transport, Housing, Bills & Utilities, Shopping, Healthcare, Entertainment, Education, Travel, Personal Care, Family, Other, plus Uncategorised) and income categories (Salary, Freelance, From people, Gifts, Interest, Refunds).
- CAT-002 [P1]: Users can add/rename/reorder/archive categories and subcategories, choose a library icon, and choose a colour only from the 12-hue category palette (seeded categories pre-assigned; no free colour entry).
- CAT-003 [P1]: Category kinds block using expense-only categories on income unless the category is explicitly switched to mixed use.
- CAT-004 [P1]: Archive/merge requires a remap preview, preserves history and original source metadata, and leaves past period totals unchanged.
- CAT-005 [P1; rule editor Phase 2]: Automated category suggestions are overridable per transaction and learning from corrections is P1; the user-authored rule editor (SCR-25) is Phase 2.
- CAT-006 [P1]: Every expense category has an editable type need/want (seeded defaults) present from the first schema version; Uncategorised, "Not itemised" amounts and untyped categories form a fourth "Not classified" segment; saving is never an expense category.

#### 8.5 Budgets (BDG)

- BDG-001 [P1]: Budgets are persistent rules with monthly, weekly, custom-range or payday-aligned periods, and nothing resets ledger balances at period boundaries.
- BDG-002 [P1]: Budgets are overall or category/account-scoped, overlapping budgets are never combined unlabelled, at most one overall budget exists on the default period (second creation offers edit), and a payday change ends the current cycle the day before the new payday with a pro-rated "shortened cycle" target, switching Home/Insights/Plan/overall/50/30/20 together.
- BDG-003 [P1]: Budgets show used, remaining, percentage, days remaining, projected spend and status (on-track, nearing limit, exceeded, insufficient-data).
- BDG-004 [P1]: Threshold alerts at configurable percentages (default 75/90/100) with per-budget mute fire only the highest crossed threshold per change and each threshold at most once per budget per period (`budget_alert_fired`).
- BDG-005 [P1; optional rollover Future]: No rollover by default, prior periods stay queryable and period switching derives from transaction dates; optional rollover is future and never implicit.
- BDG-006 [P1]: Budget used = confirmed expenses − refunds in the period excluding transfers, floored at zero per category first and then summed for overall and Needs/Wants, with refund surplus shown separately as "Refunds this period: +₹X" and never increasing Left in budget or Free to use; Insights totals stay exact.
- BDG-007 [P1]: Target edits apply now (recalculating only the current period) or from next period, preserving historical target versions.
- BDG-008 [P1]: Free to use (Plan only) = min(Left in budget, included assets − upcoming bills − set-aside goal money), negative shown as "Short by ₹X", labelled an estimate; when no budget/50/30/20 it shows "Not enough information yet · Set a limit →", when no included account "… · Add an account →", never a number or checklist; bills/goals never gate it.
- BDG-009 [P1]: One tap creates editable 50/30/20 targets from a user-entered (pre-filled from last period's salary) income, offers an update when income differs > 10%; Needs/Wants = confirmed expenses by type; Savings = net money moved into savings pots (can be negative, pot-to-pot nets zero, set-aside excluded, goal tag counted once); overall and type budgets are labelled separately and never summed.

#### 8.6 Recurring and bills (REC)

- REC-001 [P1]: Users create manual recurring rules with title, expected amount, cadence (weekly/monthly/quarterly/annual/custom), account, next due date, category, kind, end/pause state and optional notification.
- REC-002 [P1]: Planned bills are distinct from confirmed transactions and never affect balances or expense totals (only the Plan timeline and Free to use).
- REC-003 [P1]: Bill reminders are local scheduled notifications requiring permission, with no guaranteed exact-time delivery.
- REC-004 [P1]: A confirmed linked payment advances the next occurrence exactly once (re-linking refused), and cancellations preserve history.
- REC-005 [Phase 2]: Automatic recurrence inference produces "suspected" candidates with confidence/explanation, never auto-confirmed.
- REC-006 [P1]: Monthly rules keep their anchor day, falling on the last day of shorter months, never on a fixed 28–31-day interval.
- REC-007 [Phase 2; P1 manual kind]: Suggested-subscription classification with permanent/temporary rejection is Phase 2; in P1 the user sets each rule's kind manually.
- REC-008 [P1]: Bills & Recurring has a Subscriptions filter with labelled monthly-equivalent total and past charges per subscription (timeline chart is Phase 2, INS-022).
- REC-009 [P1 (IN-sourced)]: A capture matching a user bill rule (payee, amount tolerance, near due date) asks "Rent paid? [Yes, link it]" and Yes links and advances the rule once.
- REC-010 [P1]: The Plan timeline lists only user-added bills and says so ("Showing 3 bills you added…").

#### 8.7 Savings goals (GOAL)

- GOAL-001 [P1]: Goals have name, target amount, optional due date, icon, 12-hue palette colour and optional assigned account.
- GOAL-002 [P1]: Contributions are visibly either "Set aside" (virtual; no spend, no balance change, does not reduce Left in budget, reduces Free to use) or "Moved to savings" (a single transfer into a pot, counted once in Savings).
- GOAL-003 [P1]: Goals show progress, remaining amount, and pace/projected completion only when adequate data exists.
- GOAL-004 [P1]: Edit/pause/complete/archive preserves allocations; over-allocating set-aside money is allowed with a "This leaves you short by ₹X" warning and money is never counted free twice.

#### 8.8 Home and widget (HOM)

- HOM-001 [P1]: Home shows, in order, the "Am I okay?" hero (Left in budget per §6.3 rules incl. 50/30/20-only form and "Over budget ₹X" unsigned state; In accounts and Card dues never summed), "N to check" (only when pending), income/expense, per-category budgets, Needs/Wants/Savings, top categories, 7-day spend, coming up, savings goal.
- HOM-002 [P1]: Home cards show icons plus semantic colour and values, and every supported card navigates to filtered detail.
- HOM-003 [P1]: Users can reorder, hide, show, resize where supported and restore Home card layout.
- HOM-004 [P1]: Home cards refresh on transaction, settings, period change and foreground resume, and indicate stale/partial data while recomputing.
- HOM-005 [P1]: Every financial value shows its timeframe and account scope, and charts never fabricate history.
- HOM-006 [P1]: The centre ＋ stays visible on every tab without covering navigation or accessibility controls.
- HOM-007 [P1]: The Android home-screen widget offers Snap receipt, Add expense and "N to check" text (only when N > 0, never a launcher badge), respects app lock, and shows no amounts unless enabled and app lock is off.
- HOM-008 [P1]: The hero's hide-amounts eye masks every amount with one tap and the state persists across restarts.

#### 8.9 Insights (INS)

- INS-001 [P1]: Insights support the §6.5 date presets and cross-filtering by account, category, merchant, type, tags and source.
- INS-002 [P1]: Charts provide accessible numeric summaries, screen-reader table alternatives and drill-down to contributing transactions.
- INS-003 [P1]: Aggregations use only confirmed events and posted allocations and exclude transfers and unconfirmed import candidates from spending unless explicitly requested.
- INS-004 [P1]: Comparisons are like-for-like, comparing a partial period with the same number of days from the start of the previous period (pay-cycle day N), never the whole previous period.
- INS-005 [P1]: Values are in profile currency with inclusive-start/exclusive-end intervals, correct timezones and documented sign/refund treatment.
- INS-006 [P1]: Empty/minimal data shows safe prompts instead of false insights, and users can export the underlying data.
- INS-007 [P1]: Insights is one scrolling view ordered by question (Where did it go? / Is it going up? / Who got it? / Am I on track?) and every chart has "View as table".
- INS-010 [P1]: Expense trend line/area chart of confirmed net spending per day/week/month.
- INS-011 [P1]: Income vs expense grouped bars with inflow, outflow and net cash flow per period.
- INS-012 [P1]: Category distribution donut + ranked bars of category allocations over the eligible total, with refund-surplus categories shown as "₹X back" at zero.
- INS-013 [P1]: Category budget progress bars showing used/target, overage and remaining.
- INS-014 [P1]: Top merchants ranked bars of net spending by normalized merchant.
- INS-015 [P1]: Spending change tiles compute (current − previous)/|previous| only when previous ≠ 0, otherwise "No baseline yet".
- INS-016 [P1]: "Kept N%" gauge = (income − expenses)/income when income > 0, labelled as cash-flow surplus; zero income shows "No income recorded".
- INS-017 [Phase 2]: Payment-methods donut with unknown shown separately.
- INS-018 [Phase 2]: Day-of-month spending heatmap with legend and exact values.
- INS-019 [Phase 2]: Fixed vs variable stacked bars by user rules.
- INS-020 [P1]: Needs/Wants/Savings view (SCR-30) shows three bars against 50/30/20 or custom targets per BDG-009, with drill-down and no moral labelling.
- INS-021 [Phase 2]: Projected month-end forecast band with uncertainty label.
- INS-022 [Phase 2]: Subscription timeline of expected vs actual payments.
- INS-023 [Phase 2]: Transaction frequency histogram.
- INS-024 [Phase 2]: Year-on-year monthly comparison with missing data explicit.
- INS-025 [P1]: Savings-goal progress rings of explicit allocations versus target.

#### 8.10 CSV import/export (IMP)

- IMP-001 [P1]: CSV import reads a user-picked local file, detects encoding (UTF-8, UTF-16, Windows-1252, ISO-8859-1) with override, supports comma/semicolon/tab, quoted fields and decimal commas, with correctable delimiter/header/date/amount detection.
- IMP-002 [P1]: Import previews 20+ rows and maps account, date/time, description, debit/credit or signed amount (per-mapping "flip sign"), currency, merchant and reference, isolates unsupported currency, and proposes equal opposite-sign rows within ±2 days across owned accounts as transfer pairs for review.
- IMP-003 [P1]: Dates, numbers, balance sign and duplicate candidates are validated before commit, and every ambiguous row is marked for review.
- IMP-004 [P1]: Rows match the existing ledger per FIN-027 (reference + direction, else amount/±1 day/merchant to review, never silently merged), and identical rows in a file stay distinct via occurrence index.
- IMP-005 [P1]: Import commits atomically in batches of ≤ 500 rows, resumes from the next batch after interruption, reports bad rows individually with retry/export-error, and re-imports are idempotent.
- IMP-006 [P1]: Raw imported files are kept 30 days by default (configurable: delete immediately / 30 days / keep), parsed fingerprints are kept, nothing is uploaded.
- IMP-007 [P1]: Exports provide transaction CSV and account summary CSV with period/filter context, timezone and schema metadata, masked identifiers as configured, and formula-injection escaping.
- IMP-008 [Phase 2]: PDF reports with visual summary, chart alternatives and correct account scope.

#### 8.11 Receipt OCR (OCR)

- OCR-001 [P1]: Receipts are attached via OS picker or camera (with permission), stored only as a compressed copy (≤ 2,048 px long edge, JPEG q85) with source provenance.
- OCR-002 [P1]: OCR runs fully on-device with a bundled model (no first-use download), working offline from install, and shows an honest error if the model is absent.
- OCR-003 [P1]: Line grouping uses the true midpoint (top + bottom)/2, line order, adaptive tolerance, multi-column detection and region number locale.
- OCR-004 [P1]: OCR extracts merchant, date, currency, subtotal, tax, fee, discount, total and line items with prices, with per-field uncertainty.
- OCR-005 [P1]: Every parsed field is correctable; the total must be user-confirmed when low-confidence; items + tax/fees − discounts below the total yields a grey "Not itemised" (Uncategorised) row, above it is a mismatch to fix, never a negative row; tax/fees/whole-bill discounts allocate pro-rata to items with rounding remainder on the largest item; review shows category totals first with Items (N) collapsed.
- OCR-006 [P1]: On a probable match the scan offers attaching to the existing transaction first, avoiding double spend.
- OCR-007 [P1]: Parse failure opens manual entry in one tap with the image attached; Phase 1 scope is Latin script and Western Arabic numerals (totals in Western numerals still read on Arabic/Indic receipts).
- OCR-008 [P1]: OCR shows progress and cancellation and targets p95 ≤ 5 s for standard single-page receipts on reference hardware (no fixed 3 s promise).
- OCR-009 [P1]: OCR entry points are the Snap receipt chip, long-press ＋, gallery pick in the Add flow, the widget, and shared non-UPI images; automatic photo detection is not required.
- OCR-010 [P1]: A probable match prompts "Matches ₹X … at time" with Attach to it / Keep separate / Discard (no Approve/Reject wording), never auto-attaching.
- OCR-011 [P1]: An unmatched receipt is saved as confirmed on the user's Save, with an editable Paid-with chip defaulting to the account last used at that merchant (Cash if none), low-confidence date defaulting to today with a non-blocking warning, and a later matching capture flagged possible_duplicate for Merge / Keep separate.
- OCR-012 [P1]: Each receipt line item can carry its own category feeding per-category reports via splits, with item categories learned (LRN-004).
- OCR-013 [P1 (IN-sourced)]: Capture notifications for mixed-category merchants offer "Snap receipt to split", opening the camera and linking the result to that entry.
- OCR-014 [P1]: "Reading receipt…" shows the photo with scan line, items appearing, an "N of M items" count and Cancel; reduced motion shows only a progress bar.

#### 8.12 SMS ingestion (SMS) — India, approved `sms` build only

- SMS-001 [P1-IN/SMS]: SMS detection exists only in a build with verified Play eligibility/approval; builds without approval declare no SMS permission or receiver.
- SMS-002 [P1-IN/SMS]: A contextual disclosure states message categories accessed, fields retained, local-only processing and how to disable before requesting only necessary permissions.
- SMS-003 [P1-IN/SMS]: The parser extracts debit, credit, refund, reversal and transfer indicators, currency, amount, merchant, reference, masked account and timestamp, leaving unknown values unconfirmed.
- SMS-004 [P1-IN/SMS]: SMS is processed on-device, never transmitted; raw bodies are never stored after parsing (only parsed fields and a redacted preview) and non-financial messages are never ingested.
- SMS-005 [P1-IN/SMS]: SMS captures reconcile against confirmed transactions, imports and OCR, with ambiguous matches sent to review.
- SMS-006 [P1-IN/SMS]: Notification quick-classification respects consent/notification rules and alert rates are configurable.
- SMS-007 [P1-IN/SMS]: OEM diagnostics report only verifiable permission and background state with help text, never claiming permanent daemons or auto-start bypasses.
- SMS-008 [P1-IN/SMS]: Denial, revocation or Play rejection leaves the app fully functional, with no accessibility/notification/clipboard scraping substitutes.
- SMS-009 [P1-IN/SMS]: Automated tests use consented synthetic fixtures; no real financial data in repo or logs.
- SMS-010 [P1-IN/SMS]: Debit and credit SMS are parsed only from verified senders (normalized DLT entity on the bundled allow-list or user-confirmed; normalization strips operator prefix and category suffix, e.g. VM-HDFCBK-S → HDFCBK); phone-number senders are never transactions and OTPs are never retained.
- SMS-011 [P1-IN/SMS]: Only non-verified senders can be scam-flagged (link + claim/KYC/prize wording, or any phone-number transaction text), showing "This looks like a scam — not added" and never posting; well-formed unlisted DLT senders go to SMS-017 instead; verified senders are never scam-flagged.
- SMS-012 [P1-IN/SMS]: A balance chain per (normalized sender, mask), excluding card "Avl Lmt", compares available balances in occurrence order allowing intervening transactions, tolerates and resets on a first mismatch, flags only a second consecutive mismatch, and resets after a user confirms a flagged capture or 7 days without SMS.
- SMS-013 [P1-IN/SMS]: Every capture notification/dialog offers "Not a transaction · Block sender", and blocked senders are listed and unblockable in SCR-28.
- SMS-014 [P1-IN/SMS]: The SCR-24 explainer precedes the OS prompt; after "Not now" the app re-asks at most twice, ≥ 7 days apart, via a dismissible value-triggered Home card (e.g. 5th manual entry), then only via Settings.
- SMS-015 [P1-IN/SMS]: The no-SMS build and non-India profiles contain no SMS UI, setting, prompt or text at all (no "coming soon", no greyed rows).
- SMS-016 [P1-IN/SMS]: The Play SMS declaration is submitted at M3 with an internal-track `sms` build, the privacy policy is published at M1, and the build supports both GATE-02 package outcomes from M1.
- SMS-017 [P1-IN/SMS]: A transaction SMS (debit or credit) from a well-formed unlisted DLT header prompts "New sender X? [It's my bank] [Ignore]"; It's my bank marks it user_confirmed and the capture waits (never auto-approved); Ignore rejects it.

#### 8.13 Settings and notifications (SET)

- SET-001 [P1]: Appearance settings cover theme System/Light/Dark (teal only, no accent picker), number format, text scaling and haptics/reduced motion.
- SET-002 [P1]: Finance settings cover region/currency (changeable only while no transactions exist; otherwise blocked with export + new profile path), timezone, first day of week, default period, payday, default account, budget thresholds and missing-data policy.
- SET-003 [P1]: Notifications are per-type opt-in with snooze/mute; caps are one alert per budget threshold per period, grouped capture notifications, ≤ 1 evening summary/day (sent only after the auto-approve write commits), ≤ 3 other notifications/day (bills before budgets, overflow merged into "N more reminders"), and no numeric app badge.
- SET-004 [P1]: Data settings cover encrypted backup/restore, CSV export, storage use, retention and a double-confirmed data wipe.
- SET-005 [P1]: Privacy settings cover app lock (biometric/PIN), app-switcher blur, privacy explanations and hide amounts, which applies at once to app, widget and notifications; with app lock on, capture notifications use the hidden form and the widget never shows amounts.
- SET-006 [P1]: Diagnostics show local version/schema/storage/permission status and non-sensitive test parsers, and export sanitised diagnostics only after preview and consent.
- SET-007 [P1]: Help provides offline FAQ, accessible glossary, "how totals are calculated" and about/licensing.

#### 8.14 Backup and migration (BKP)

- BKP-001 [P1]: Backup exports a versioned encrypted file (database, attachments, settings, manifest, checksum) protected by a user passphrase, explaining recovery implications.
- BKP-002 [P1]: Restore validates format/version/checksum, obtains credentials, previews effects with "If something goes wrong during restore, nothing on this phone changes." and a "Back up this phone first" link, requires the "I understand this replaces…" tick (plus re-auth with app lock), takes a pre-restore safety snapshot (warning and explicit confirmation if free space < 2× DB size), never promises a lasting safety copy, and commits atomically.
- BKP-003 [P1]: A wrong passphrase, corrupt or incompatible file never overwrites working data and shows an actionable error.
- BKP-004 [P1]: Backup/restore leaves no unencrypted temporary artifacts in public folders.
- BKP-005 [P1]: Versioned migrations run transactionally with forward-compatible read policy and safe failure recovery, and restored older backups migrate with matching balances.
- BKP-006 [P1]: OS cloud/device backup excludes wmbugo database and attachments (`allowBackup=false` + data-extraction rules), and user-initiated file-provider export behaviour is documented.
- BKP-007 [P1]: Export to external providers is user-initiated and the privacy UI explains it may leave the device.

#### 8.15 Security and privacy (SEC)

- SEC-001 [P1; SMS catch-up P1-IN/SMS]: Financial records and attachments are stored in authenticated encrypted-at-rest storage with device-protected keys (no hardcoded keys), key available after first unlock; SMS catch-up reads the inbox from `sms_cursor` after first unlock and every start, deduplicates by fingerprint, stores nothing pre-unlock, starts the cursor at consent, offers a one-time 30-day backfill to review (never auto-approved), and keeps the cursor across restore.
- SEC-002 [P1]: The release build declares no INTERNET permission (explicitly stripped, release check fails the build if present), the airplane-mode suite runs on the release build, no analytics/ads/telemetry SDKs, and a proxy audit shows no outbound requests.
- SEC-003 [P1]: Only minimum permissions are requested, with contextual rationale, graceful denial and OS revocation.
- SEC-004 [P1]: App lock uses biometric/OS-backed auth with device passcode fallback and re-locks on resume after a configurable timeout.
- SEC-005 [P1]: The app switcher hides values; capture notifications use a hidden form ("New payment to check", Review only, unlock required) on the lock screen, with app lock on, or with hide amounts on unless the user opts in to full notifications; Approve/Reject appear only on the full form; non-capture notifications never show amounts on the lock screen.
- SEC-006 [P1]: Imports/restores validate file type, size, path injection, corrupted data and malicious archives, and exports escape spreadsheet formulas.
- SEC-007 [P1]: Logs and crash diagnostics redact SMS, amounts, account identifiers, images and notes.
- SEC-008 [P1]: Data deletion states its scope and irreversible-loss warning, and encrypted backups are separate user copies.
- SEC-009 [P1]: Consent, disclosures and store privacy labels accurately match actual build behaviour, with legal review before publication.

#### 8.16 Capture review (CAP)

- CAP-001 [P1 (IN-sourced)]: Each automated capture posts a notification (amount, direction, merchant, account, guessed category) with Approve / Reject working from the shade on the full form only; the hidden form offers only Review (SEC-005).
- CAP-002 [P1]: Tapping a capture notification (or share) opens SCR-27 as a bottom sheet in a dialog-styled activity over the dimmed current app, without draw-over-other-apps permission.
- CAP-003 [P1]: The dialog shows a category icon grid ordered by merchant history then overall frequency; one tap saves and closes; long-press opens subcategories; unknown merchants collect details in the dialog.
- CAP-004 [P1 (IN-sourced)]: Credit captures offer Salary (income/Salary), From a person (income/From people), Paid me back (refund, chosen category, learned per person), Refund (refund, learned category or waits) and Moved from my own account (transfer), learned per payer.
- CAP-005 [P1 (IN-sourced)]: Multiple pending captures collapse into one updating grouped notification ("3 new transactions · ₹1,240") and the dialog shows swipeable cards with "Apply to all similar".
- CAP-006 [P1 (IN-sourced)]: Lock-screen Approve/Reject is an opt-in setting, off by default.
- CAP-007 [P1 (IN-sourced)]: Auto-approve eligibility requires verified-sender SMS (UPI screenshots never), fully parsed amount/direction, resolved account, no possible_duplicate/open candidate, no SMS-011/012 flag, not transfer-like, profile currency; unlearned debits confirm as Uncategorised + needs_category; credits only with a learned type (and category for refunds); eligible captures are written after the cutoff per FIN-026; the evening summary ("Today: N recorded · Tap to review", up to 5 merchant-first lines + "+N more", count only when hidden) is sent only by the background job after its write.
- CAP-008 [P1]: Rejected captures appear greyed behind an off-by-default "Show rejected" filter for 90 days and their status can be changed from detail.
- CAP-009 [P1 (IN-sourced)]: A capture from an unknown mask prompts "New account ••7730 (Bank) — [Add it] [It's one of mine]" with type pre-selected from wording; Add it derives opening balance from SMS available balance effective just before the transaction (cards: dues "not set", limit never a balance); One of mine links (sender, mask) permanently.
- CAP-010 [P1 (IN-sourced)]: A "Moved from my own account" credit offers account chips, pre-selects an opposite-direction same-amount owned-account capture within the window, and links them as one transfer.
- CAP-011 [P1 (IN-sourced)]: A capture matching a bill rule offers "Rent paid? [Yes, link it]" (REC-009).
- CAP-012 [P1 (IN-sourced)]: Debit captures offer Moved to my own account, Paid card bill, Cash withdrawal (auto-creating a "balance not set" Cash account with optional starting-cash tip) and Saved / invested, learned per payee/mandate; transfer-like captures are never auto-approved as expense/income; matching debit/credit legs (same amount, ±3 days) form one transfer with both sources; auto-linking only with auto-approve on, inside the FIN-026 write, when the other account is certain, labelled "Recorded · linked as transfer" with a "Not a transfer" undo.

#### 8.17 Local learning (LRN)

- LRN-001 [P1]: After the user categorizes a merchant, later captures from it are pre-categorized and the notification shows the guess with Change.
- LRN-002 [P1 (IN-sourced)]: When an SMS lacks a merchant, learning keys on the payee UPI ID and the user can name the payee once.
- LRN-003 [P1]: A merchant with ≥ 2 different categories within its last 5 user confirmations is marked mixed, stops auto-categorizing and offers its past categories as one-tap choices; the flag is clearable in SCR-28.
- LRN-004 [P1]: Receipt line items learn categories per item name.
- LRN-005 [P1]: The dialog shows "Remember for this merchant" (default on) and SCR-28 lists all learned mappings with edit/forget.
- LRN-006 [P1]: All learning is on-device, never transmitted, included in encrypted backups, and never changes amounts.
- LRN-007 [P1]: The app learns the payment account per merchant (receipt Paid with) and per category (Add sheet default).
- LRN-008 [P1]: Only user actions teach; auto-approvals never count as confirmations for LRN-001–007 or the LRN-003 window.
- LRN-009 [P1]: Merchant keys are normalized before learning/matching (lowercase, trim, collapse whitespace, strip gateway prefixes and trailing reference/city codes).
- LRN-010 [P1 (IN-sourced)]: The credit type (and refund category) is learned per payer/sender, and credits from a payer without a learned type are never auto-approved.

#### 8.18 UPI screenshot share (UPI) — India

- UPI-001 [P1-IN]: wmbugo appears in the Android image share sheet and parses GPay/PhonePe/Paytm success screens on-device with fixed per-app layout parsers, rejecting pending/failed/declined screens with "This payment didn't go through — nothing added".
- UPI-002 [P1-IN]: The parser extracts amount, direction, payee/payer, UPI ID, bank and mask when shown, timestamp and UPI reference, leaving unknown fields unconfirmed.
- UPI-003 [P1-IN]: The result opens the SCR-27 capture dialog with history-ordered category grid, "Paid from" chip (with "+ New account") and Save; received-money screens offer CAP-004 choices.
- UPI-004 [P1-IN]: A shared image that is not a recognised UPI screen falls back to the receipt OCR flow.
- UPI-005 [P1-IN]: UPI reference + direction + event type is the strongest duplicate key (same screenshot twice or matching CSV row never creates a second entry), and opposite-direction same-reference items are classified per FIN-027.
- UPI-006 [P1-IN]: A share received while app lock is on is queued and delivered to the dialog after unlock, never lost.
- UPI-007 [P1-IN]: Screenshots are neither uploaded nor kept after parsing unless the user attaches them.
- UPI-008 [P1-IN]: A UPI capture is confirmed only by the user's Save; a dialog closed without saving leaves it waiting in review, never auto-approved.

#### ID coverage check

Grep of the PRD for `[A-Z]{2,5}-[0-9]{2,3}` found 201 functional-requirement IDs (FIN 19, ONB 8, ACC 9, TXN 13, CAT 6, BDG 9, REC 10, GOAL 4, HOM 8, INS 23, IMP 8, OCR 14, SMS 17, SET 7, BKP 7, SEC 9, CAP 12, LRN 10, UPI 8); all 201 appear above. Plus 11 §7.4 ledger integrity rules given derived labels LIR-01–11 (no PRD ID).

IDs intentionally not listed as FRs:
- DEC-01–33 (decision register): product decisions whose content is already expressed in the FRs/NFRs that implement them; reference for traceability, not separate stories.
- SCR-01–31 (screen inventory): design screens, traced via FRs and UX spines. SCR-25 (automation rules) and SCR-26 (advanced reports) are Phase 2.
- FLOW-01–18: end-to-end UX flows (story/E2E test scenarios), not requirements.
- WMB-01–18: epic IDs from §21 (WMB-13 and WMB-15 are Phase 2).
- GATE-01–13: listed under NFR section below.
- FR-CLK-001/002, REQ-CLK-06, TC-CLK-504, FR-SUB-003: superseded source IDs (§23.1).
- AD-10: architecture decision reference; UTF-16: encoding name (false positive).

### NonFunctional Requirements


#### NFRs (§12)

- NFR-01: Every core financial task works fully in Airplane Mode after install — verified by the E2E offline suite run on the release build.
- NFR-02: Zero unsolicited outbound financial data and no app-owned remote processing — proxy inspection and dependency review.
- NFR-03: Screen navigation median < 300 ms under defined reference data/device load.
- NFR-04: Manual entry Save confirmation p95 < 500 ms after validation for ordinary local writes on reference devices.
- NFR-05: Home visible within p95 2 s warm start with 10k ledger records on the reference device.
- NFR-06: ≥ 95% of animation frames at 60 FPS with no stall > 100 ms; analytics/OCR never on the UI thread.
- NFR-07: With 10k transactions, list scrolling ≥ 95% frames at 60 FPS with no dropped-frame burst > 100 ms; indexed search p95 < 500 ms.
- NFR-08: Receipt OCR p95 ≤ 5 s on benchmark single-page receipts on reference hardware; failure/timeout escape always works.
- NFR-09: All financial mutations atomic; 0 invariant violations across regression and property suites (CI).
- NFR-10: Database and attachments unreadable on a powered-off or not-yet-unlocked-since-boot device without the device credential; backups unreadable without the passphrase (§17 threat model, rooted excluded); after first unlock the DB may be read while screen-locked for capture/auto-approve.
- NFR-11: TalkBack labels on every control; usable at 200% font scale; WCAG AA contrast (4.5:1 text, 3:1 non-text); reduced motion honoured; touch targets ≥ 48 dp.
- NFR-12: Crash/restart during import, backup or migration leaves a consistent database and recoverable UI (fault injection).
- NFR-13: A clear Android/iOS parity matrix and market availability matrix exist for platform/market-specific features (release review).
- NFR-14: Zero mandatory recurring server/API costs for core operation (store/device/support costs not represented as zero).
- NFR-15: No personal financial data collected for telemetry; opt-in research clearly scoped.
- NFR-16: SMS received → capture notification p95 ≤ 5 s with app process alive, ≤ 30 s when killed (India, approved build).
- NFR-17: Parsing accuracy meets §3.3: SMS precision ≥ 98% / recall ≥ 95% on amount, direction, account (fixture corpus); UPI screenshot ≥ 98% correct amount and reference per app layout; receipt total/merchant/date ≥ 90% on the four-market reference set; scam filter 0 false positives on ≥ 10-bank template corpus.
- NFR-18: Capture background work stays within a battery/CPU budget set per GATE-03 reference device; no always-running service.
- NFR-19: Glass surfaces ≥ 95% frames at 60 FPS with no stall > 100 ms while scrolling on reference mid-range devices; otherwise `glass.fallback` (also on API < 31, battery saver, animator scale 0); text on glass ≥ 4.5:1.
- NFR-20: Splash (system + in-app) adds ≤ 1 s before Home within the NFR-05 budget and ends when the database is ready, never on a timer.

Benchmarks are engineering targets on GATE-03 reference devices; no requirement that all DB work fits a 16 ms frame.

#### Release-blocking criteria (§16.2)

- RB0-1: No known incorrect account balance, duplicate confirmed counting, monetary rounding error, data loss in normal paths, or irreversible unsafe migration.
- RB0-2: All P1 flows work in Airplane Mode on Android in every Phase 1 market.
- RB0-3: Auto-approve never confirms a capture matching an existing confirmed transaction, flagged possible_duplicate, or incompletely parsed.
- RB0-4: No-SMS builds contain no SMS permission, receiver or SMS-related UI text.
- RB0-5: Privacy policy and store disclosures reviewed for every Phase 1 market (GATE-08).
- RB0-6: Backup/restore tested end to end, including wrong password and corruption.
- RB0-7: Security and Play permission review completed for actual release builds; shipped variant matches the SMS approval outcome.
- RB0-8: OCR never auto-creates a second confirmed expense for an existing SMS/manual/imported transaction.
- RB0-9: Core accessibility blockers eliminated; financial state never conveyed only by colour.
- RB1-1: Performance objectives verified on reference devices (exceptions accepted by product owner).
- RB1-2: Usability study validates Home comprehension (Left in budget vs Free to use), expense add, transfer, budget drill-down and auto-approved entry comprehension ≥ 90%.

#### Gates constraining implementation (§24; product owner holds every role unless noted)

- GATE-01 (Product owner): Signed-off P1 scope and personas; Phase 1 free with no billing code.
- GATE-02 (Android release/policy owner): SMS permission eligibility and, by M3, whether India-only SMS can coexist with no-SMS in one package; else two-package fallback with backup→restore migration path; declaration approval or disabled variant.
- GATE-03 (Mobile architect): Device/OS support matrix and reference performance hardware (needed by all NFR benchmarks).
- GATE-04 (Security engineer): Encrypted DB library/key management and backup format/threat model; evidence = ADR threat-model checklist, dependency audit, proxy test, AI-assisted security review before each beta.
- GATE-05 (Mobile/OCR engineer): OCR stack proven fully offline in a build without INTERNET, licence compatible with no data collection, Phase 1 script coverage.
- GATE-06 (UX lead): Screens, tokens, wireframes (UX spines, done) plus M4 guerrilla usability results (≥ 5 participants).
- GATE-07 (Finance domain reviewer): Posting sign convention, refunds, liabilities, budget formulas and fixtures; evidence = FIN invariant suite green and worked examples reviewed against fixtures.
- GATE-08 (Compliance/release, external paid reviewer): Privacy policy and store disclosures for India DPDP, EU/UK GDPR, US/Canada, Gulf/SE Asia; Data safety form matches SDK behaviour; §16.3 reference-set protocol reviewed before collection at M3 and before Play submission.
- GATE-09 (QA lead): Device matrix, benchmark methodology, regression evidence; RB0 list automated where possible, device-matrix run recorded.
- GATE-10 (BMAD workflow owner): Workflow input path, PRD validation, story traceability (§16.4 IDs on every story).
- GATE-11 (Commerce owner) [Phase 2]: Premium packaging and local entitlement strategy.
- GATE-12 (Brand/motion): Final logo SVGs, monochrome/notification icons and production coin-flip motion asset (needed by WMB-01 at M4).
- GATE-13 (Release owner): Play developer account type confirmed and closed-test plan (≥ 12 testers, ≥ 14 days) if required.

### Additional Requirements


Source: ARCHITECTURE-SPINE.md (final, 2026-11-07, AD-1..AD-19) + .memlog.md. "Depends on" names what must exist first.

**Starter / Epic 1 Story 1:**

- **Starter (AD-2, Stack, Conventions)**: Initialise the project with the React Native CLI template (React Native 0.88.x, **New Architecture on, Hermes on**), TypeScript **strict**, inside a **pnpm workspace with `node-linker=hoisted`** (pnpm only; no npm/yarn lockfiles). Workspace contains `packages/core` (pure TS, builds and tests in plain Node, no `react-native`/Drizzle/op-sqlite dependency) and `apps/mobile` (RN app depending on `core`; never the reverse). Depends on: nothing; this is the first story.
- **Starter (AD-17)**: Android config in the starter: applicationId `app.wmbugo`, minSdk 26, targetSdk 36, compileSdk 36; Gradle product flavors `nosms` and `sms` created from day one; debug keeps `INTERNET` for Metro only. Depends on: Starter scaffold.
- **Starter (Structural Seed)**: Create the folder skeleton: `packages/core/src/{ports,usecases,writer,ledger,capture,learning,planning,insights,profile,backup,shared}` and `apps/mobile/src/{features,shared,adapters}`, `apps/mobile/android/`. Depends on: Starter scaffold.
- **Starter (AD-18)**: GitHub Actions pipeline on every push: lint, typecheck, core tests (Jest in Node), release build; local pre-push hook runs core tests. Permission-allowlist and encrypted-DB checks are added as soon as their subjects exist (see below). Depends on: Starter scaffold; repo pushed to GitHub.
- **Starter (Conventions)**: ESLint rules in place from the start: no `console.log` in shipped code; `packages/core` may not import `react-native`, Drizzle or op-sqlite (compiler/lint enforced). Depends on: Starter scaffold.

#### Repo and module layout

- **AD-1**: All financial rules, calculations, validations and decisions (balances, totals, eligibility, periods) live in `packages/core`; adapters only translate between ports and platform; UI features call core use cases and queries only. Depends on: Starter.
- **AD-2**: The `core` → `mobile` dependency direction is compiler-enforced; `packages/core` compiles and tests without any RN library installed. Fallback (if Metro + pnpm fails in spike): single app + lint boundary rule. Depends on: Starter, Metro/pnpm spike.
- **AD-3**: Core is split into modules `ledger`, `capture`, `learning`, `planning`, `insights` (read-only), `profile`, `backup`, plus `writer` infrastructure; each module owns its tables and Drizzle schema files per the ownership table (e.g. ledger: account, account_identifier, transaction, posting, split, category, attachment, receipt_item; capture: source_record, review_candidate, sender, balance_chain, sms_cursor, tombstone, import_batch, pending_share; learning: learned_mapping, payee, merchant; planning: budget, budget_period, budget_alert_fired, recurring_rule, goal, goal_allocation; profile: profile, settings, auto_approve_rule, clock_guard, prompt_state, period service; writer: audit_event, outbox; storage adapter: schema_migration). Other modules read only via the owner's queries and change data only via the owner's commands from a use case. Dependency direction: capture→learning/planning/ledger; learning→ledger; planning→ledger; insights→ledger/planning; all→profile; nothing depends on capture or insights. Cross-module joins only in insights queries or use cases. Depends on: Starter skeleton.
- **Conventions (Feature code)**: Anything used by two or more features moves to `apps/mobile/src/shared`; never copied. UI features organised as `home, activity, add, insights, plan, settings, capture-dialog, onboarding, sms (sms flavor only), upi-share`.

#### Stack versions

- **Stack**: Pin in the lockfile at init: React Native 0.88.x; op-sqlite 19.x with SQLCipher; Drizzle ORM + drizzle-kit 0.45.x stable (not 1.0 RC); react-native-keychain latest stable; react-native-notify-kit latest stable (replaces archived Notifee; no Firebase); VisionCamera current stable major (agents follow that major's docs); TanStack Query, Zustand, React Navigation, libsodium binding, fast-check, Jest, Maestro, TypeScript latest stable at init. OCR: ML Kit text recognition 16.0.1 bundled or PaddleOCR/ONNX Runtime, chosen in M1. CI: GitHub Actions. Depends on: Starter.

#### Builds, flavors and permissions

- **AD-17**: SMS feature code lives in modules excluded at build time from the `nosms` bundle; UPI-share code ships in both flavors, enabled at runtime only for region IN (no SMS code or strings in `nosms` JS or native). Depends on: flavors (Starter); nosms bundle-exclusion spike.
- **AD-17**: Release builds checked in CI against a **permission allowlist**: no `INTERNET`, no `ACCESS_NETWORK_STATE`; SMS permissions only in `sms`; library-added permissions removed via `tools:node="remove"`. Check runs on every push. Depends on: CI pipeline, flavors.
- **AD-17**: `sms` flavor packaged in-package or as `app.wmbugo.sms` per GATE-02 at M3; the measurement app is `app.wmbugo.lab`, never under the production ID.
- **AD-9**: `allowBackup=false` and data-extraction rules exclude all app data from OS auto-backup and device transfer. Depends on: Starter Android config.

#### Encrypted database, keys and files

- **AD-8**: SQLite via op-sqlite built with SQLCipher (flag in `apps/mobile/package.json`); on open the adapter checks `PRAGMA cipher_version` and refuses to run without SQLCipher. CI adds an encrypted-database check. Depends on: Starter, Storage/UnitOfWork port, KeyStore adapter, op-sqlite/Drizzle spike.
- **AD-9**: On first launch generate a random 256-bit DB key, stored via the KeyStore port (react-native-keychain / Android Keystore), available after first unlock since boot, not bound to biometrics/PIN; app lock is a UI gate only; key never logged, backed up or exported. Depends on: KeyStore port.
- **AD-9**: Every stored file (receipt images, raw CSV copies, pending shares, safety copies) lives in app-private storage, encrypted with a file key derived from the DB key (FileStore port); file written before the referencing row commits; an orphan sweep deletes unreferenced files. Depends on: DB key, FileStore port.
- **AD-9**: If the Keystore key is lost, data is recoverable only from backup; the app prompts for backups accordingly. Depends on: backup (AD-10).
- **AD-8 (Drizzle)**: Schema defined with Drizzle in each owner module's schema files (in the storage adapter); the core never imports Drizzle or SQL. Adapter SQL may filter/join/group/sum only by core-supplied inputs (period bounds, statuses, eligibility). Depends on: AD-3 ownership.

#### Migrations

- **AD-8**: drizzle-kit generates numbered migrations, bundled via Metro/Babel `.sql` loading (drizzle-kit `driver: 'expo'`), run forward-only in one transaction on open, after a safety copy; tracked in `schema_migration`. Depends on: op-sqlite/Drizzle spike.
- **AD-8**: The **initial schema** is produced by the M1 schema spike from PRD §11.1 and the spine; afterwards one migration per story that needs it. Depends on: AD-3, AD-5, schema spike.

#### Writer, UnitOfWork, outbox, event catalogue

- **AD-4**: Every data change is a named use case (verb: `SubmitCapture`, `ApproveCapture`, `WriteAutoApprovals`, `ImportCsvBatch`, `PurgeExpired`, `RestoreBackup`, ...). A single `LedgerWriter` runs one use case at a time inside one `BEGIN IMMEDIATE` transaction (UnitOfWork port); a use case may call several modules' commands with the same UnitOfWork. Depends on: Storage/UnitOfWork port + adapter.
- **AD-4**: Invariants asserted before commit: transfer postings sum to 0; splits sum to categorisable amount; no duplicate confirmed item; all amounts safe integers. Depends on: LedgerWriter, AD-5 model, property tests.
- **AD-4**: Every audit row (`audit_event`) and every **outbox** event is written in the same transaction; after commit events are delivered at least once; handlers are idempotent on event ID; a handler that changes data runs as its own use case. Depends on: LedgerWriter.
- **AD-4**: The DB is opened only by the main app process; capture dialog, headless jobs and notification actions run in that process and enqueue on the same writer; the widget never opens the DB.
- **Event catalogue**: Events (past tense, each with actor `user | auto | system`) and their invalidated query areas come only from the catalogue: `TransactionsChanged` (ledger, budgets, insights, home, widget); `CapturesSubmitted`/`CapturesAutoApproved`/`CapturesRejected` (captures, ledger, home, widget); `TransferLinked`/`TransferUnlinked` (ledger, captures); `CategoryAssigned` (ledger, learning; teaches learning when actor=user); `BudgetThresholdCrossed` (budgets, notifications; emitted by planning's handler of `TransactionsChanged`); `ProfileChanged` (everything period-based, notifications, widget); `BackupRestored` (all). Adding an event updates the catalogue. Depends on: outbox.

#### Money, periods, ledger model

- **AD-5**: `signed_amount_minor` positive = money into the account, negative = out, for every account type; card balance negative while owed ("Card dues" shows its negation); internal transfer postings sum to 0; expense/income = one posting on the user's account with categories carried by splits summing to the absolute amount; opening balance = one posting with `posting_kind = opening_balance`; corrections `posting_kind = adjustment`; integer minor units using the profile currency exponent (IDR/HUF whole units). Depends on: `Money` type (core/shared).
- **AD-7**: The `profile` period service is the only code converting a `local_date` to a period (calendar month, pay cycle with last-working-day and early-salary rules, shortened cycle after payday change, previous comparable period); budgets, insights and hero all ask it. Depends on: Clock port, profile module.

#### Query layer

- **AD-15**: Screens read only through core query functions (nouns, e.g. `homeHero`) cached with TanStack Query (`networkMode: 'always'`); outbox events invalidate only the matching query keys per the catalogue. Depends on: core queries, outbox/event catalogue.
- **AD-15**: Zustand holds transient UI state only (open sheets, selection, Add-sheet draft); never money, derived totals or persistent preferences (hide amounts is a profile setting). Depends on: Starter.

#### Clock, Scheduler, threading

- **AD-16**: All time comes from the Clock port (UTC epoch ms + profile timezone; clock guard per FIN-026(6)); no direct `Date.now()` in core. Depends on: ports.
- **AD-16**: Scheduled work (auto-approve write, SMS catch-up, daily purge) is requested through the Scheduler port and runs as writer use cases. Depends on: LedgerWriter, Scheduler adapter.
- **AD-16**: DB calls use op-sqlite async API; OCR/image processing on native threads; nothing heavier than rendering on the JS thread; splash ends when DB key is loaded and the first Home query returns. Depends on: storage adapter, Home query.

#### Capture pipeline

- **AD-6**: Every new entry (SMS, UPI screenshot, receipt, CSV row, manual entry) goes through `SubmitCapture`: parse → normalize → match (FIN-027) → classify (eligibility, learning suggestion) → create ledger transaction with status `needs_review` or `confirmed`. Waiting items are `needs_review` ledger transactions excluded from totals; capture owns source/review details; status changes only via ledger commands from capture use cases. Every stage idempotent on the source fingerprint. Depends on: LedgerWriter, ledger module, learning, planning (read), profile.
- **AD-6**: Auto-approval and auto-linking only in `WriteAutoApprovals` (FIN-026); learning taught only by outbox events with actor `user`. Depends on: outbox, Scheduler.
- **AD-6/AD-3**: CSV import is `ImportCsvBatch` (import_batch); tombstones for every source incl. manual; purge via `PurgeExpired`. Depends on: SubmitCapture.
- **AD-11**: In `sms` flavor a Kotlin receiver stores/parses nothing; it enqueues a unique background job running SMS catch-up (SmsInbox port, from `sms_cursor`) through `SubmitCapture`; same job serves live SMS, post-unlock catch-up, reboot and missed broadcasts; safe to rerun. Raw SMS bodies never persisted. Depends on: SubmitCapture, Scheduler, sms flavor, SMS-latency spike.
- **AD-12**: A share received while locked is stored as an encrypted `pending_share` and submitted after unlock. Depends on: FileStore encryption, SubmitCapture.

#### Capture dialog, widget, notifications

- **AD-12**: The floating capture dialog is a React Native screen in a dialog-styled Android activity in the main process, reusing the shared capture card; native Kotlin only if the spike measures open time > ~400 ms. Depends on: shared capture card, writer, dialog spike.
- **AD-12**: The widget renders only a snapshot (to-check count; amounts-allowed flag from profile settings) written by an outbox handler after every commit via the WidgetSnapshot port; it never reads the DB or computes counts. Library (react-native-android-widget vs Glance) chosen in spike. Depends on: outbox, widget spike.
- **AD-13**: All notifications go through the Notifier port (react-native-notify-kit); the core decides content and hidden/full form from profile settings (app lock, hide amounts, lock-screen opt-in); evening summary emitted only by `WriteAutoApprovals` after commit; no push, no Firebase. Depends on: outbox, profile settings.

#### Receipt OCR

- **AD-14**: The OcrEngine port returns positioned text blocks; receipt parsing, reconciliation and allocation live in core. Engine chosen in M1 spike: ML Kit 16.0.1 bundled (Google transport/telemetry libs excluded) vs PaddleOCR via ONNX Runtime; winner must read receipts in airplane mode in a release build without `INTERNET`, carry no telemetry library, and have a written Play Data-safety rationale (GATE-05). Depends on: OCR spike, permission allowlist, VisionCamera.

#### Backup and restore

- **AD-10**: A backup is one encrypted archive (DB export, attachments, settings, manifest with schema version, checksum, app ID), encrypted with a passphrase-derived key (libsodium Argon2id + XChaCha20-Poly1305). Depends on: storage, FileStore.
- **AD-10**: `RestoreBackup` runs in maintenance mode: writer paused; decrypt + verify into staging; migrate forward; re-encrypt with device keys; atomic swap keeping the pre-restore safety copy until successful restart; older schemas always migrated, newer refused with an actionable message; works across `app.wmbugo` ↔ `app.wmbugo.sms`; afterwards rebuild widget snapshot, query caches, sms_cursor. Depends on: migrations, writer, backup format.

#### Logging, diagnostics, safe mode

- **AD-19**: No analytics, crash-reporting, ads or network SDKs. All logging via the redacting Logger port into a size-capped local log in app-private storage. Depends on: Logger port (early; used by everything).
- **AD-19**: Crashes captured locally (redacted), leaving the device only via Diagnostics export with preview and consent (SET-006); JS source maps and native symbols kept as CI artifacts per release. Depends on: Logger, CI.
- **AD-19**: If the DB cannot be opened or fails its integrity check, the app enters safe mode: no writes; offers restore and export. Depends on: storage adapter, backup.

#### Testing gates

- **AD-18**: Core invariant property tests (fast-check) are written **before** the features they protect (money, signs, transfers sum 0, splits sum, dedup, periods) and pass on every push. Depends on: core `Money`/ledger model, Jest in core.
- **AD-18**: Jest unit tests for core run in plain Node in CI and pre-push.
- **AD-18**: Before each beta/release: airplane-mode Maestro E2E suite on the release build and performance checks (NFR-03..08, 19, 20) on reference devices (assumed: developer's phone + one budget phone on Android 8–10; confirm models in M1). Depends on: release build, reference devices.
- **AD-18**: Phase 1 device testing is Android only; no iOS builds or device tests until Phase 2.

#### Verification gates (AD-18 summary)

- **AD-18**: Every push: lint, typecheck, core tests (incl. property suite), release build, permission allowlist check, encrypted-DB check. Pre-push: core tests. Pre-beta/release: Maestro airplane-mode E2E + perf on reference devices with release build.

#### Conventions

- **Conventions (IDs)**: UUID v7 strings for every record.
- **Conventions (Money)**: `Money` = integer minor units (JS number, `Number.isSafeInteger` asserted at core boundaries) + profile exponent; fields end in `Minor`; never floats or formatted strings in core.
- **Conventions (Time)**: Instants as UTC epoch ms; transactions also carry `local_date` (`YYYY-MM-DD`) and timezone.
- **Conventions (Errors)**: Expected failures return typed `Result` with a named code (e.g. `SPLITS_DONT_SUM`); exceptions only for bugs; UI maps codes to copy (PRD §6.7).
- **Conventions (Naming)**: Use cases are verbs, events past tense, queries nouns.
- **Conventions (Formatting)**: All display formatting through one shared Intl-based locale formatter in `apps/mobile/src/shared`; screens never format numbers.
- **Conventions (Logging)**: No `console.log` in shipped code; Logger port only.
- **Conventions (Package manager)**: pnpm only, `node-linker=hoisted`.

#### Spikes to schedule early (M1 gates; block only dependent stories)

- **Spike S1 — Storage/migrations (AD-8)**: op-sqlite 19.x + SQLCipher flag location in pnpm workspace, `cipher_version` check, Drizzle 0.45.x op-sqlite driver, drizzle-kit `driver: 'expo'`, Metro/Babel `.sql` migration bundling; also confirms Metro + pnpm hoisted workspace (AD-2 fallback). Blocks: all persistence.
- **Spike S2 — Initial schema (AD-8)**: Produce initial Drizzle schema from PRD §11.1 + ownership table. Depends on S1.
- **Spike S3 — OCR engine (AD-14, GATE-05)**: ML Kit vs PaddleOCR/ONNX on accuracy + privacy, airplane mode, no INTERNET, Data-safety rationale.
- **Spike S4 — SMS latency (AD-11, NFR-16)**: live SMS → notification through background job (5 s alive / 30 s killed); confirm headless JS path.
- **Spike S5 — Capture dialog open time (AD-12)**: RN dialog activity vs ~400 ms threshold.
- **Spike S6 — Widget library (AD-12)**: react-native-android-widget vs Glance.
- **Spike S7 — nosms bundle exclusion (AD-17)**: build-time exclusion of SMS modules from `nosms` JS bundle and native code.
- **Spike S8 — Reference devices (AD-18, GATE-03)**: confirm device models.

#### Dependency order (critical path)

1. Starter scaffold (RN CLI, New Arch, Hermes, TS strict, pnpm hoisted workspace, flavors, CI) →
2. Core shared primitives + ports (Money, Result, UUID v7, Clock, Logger, KeyStore, Storage/UnitOfWork, FileStore) + fast-check property suite →
3. Encrypted storage adapter + migrations + initial schema (S1, S2) →
4. LedgerWriter/UnitOfWork + audit + outbox + event catalogue →
5. Ledger + profile (period service) modules → SubmitCapture pipeline → query layer (TanStack) → features, dialog, widget, notifications, backup.

### UX Design Requirements


Source contract: `ux-wmbugo-app-2026-11-07/DESIGN.md` (visuals/tokens) and `EXPERIENCE.md` (IA/behaviour/states/a11y/journeys). The spines win over mockups (`mockups/key-home.html`, `mockups/key-activity.html`, `mockups/key-capture-batch.html`), which are illustrations used as visual reference for acceptance. All tokens live in `src/shared`; no UI kit. "FR" references are PRD IDs where obvious; SCR-xx are PRD screen IDs.

#### A. Design tokens and theming

- **UX-DR1: Theme infrastructure and mode switching.** Implement a typed token module in `src/shared` exposing every DESIGN.md `colors` token with light and `-dark` values, resolved by the active theme: System / Light / Dark (Settings › You). Teal only: no accent picker, tokens named by role. AC: switching theme re-renders all screens without restart; System follows the OS setting live; no screen uses a hex literal outside the token module (lint rule or grep check); no accent-theme option exists. [DESIGN › Colors; EXPERIENCE › Foundation, Deviations] (FR: SET-001)
- **UX-DR2: Core and semantic colour tokens.** Implement `bg-canvas`, `bg-surface`, `bg-muted`, `text-primary`, `text-secondary`, `accent-primary`, `semantic-income/expense/transfer/warning/info`, `border-hairline`, `scrim` with exact light/dark hex from DESIGN.md. Enforce usage rules: expense row amounts are unsigned `text-primary` (never `semantic-expense`); `semantic-expense` only for outflow chart series with legend text; `semantic-transfer` only for the transfer icon tint (never amount text); `semantic-warning` always paired with icon + text; not-itemised amounts use `text-secondary`. AC: unit test asserts every hex; contrast test asserts listed pairs (e.g. text-primary on canvas 17.06:1, accent on white 5.47:1, text-secondary on surface 7.58:1 / 9.85:1) meet ≥4.5:1 text and ≥3:1 non-text. [DESIGN › Colors table]
- **UX-DR3: Gradient token and its constrained uses.** Implement `gradient.brand` (#2DD4BF → #0F766E → #164E63) for splash, logo tile, light-mode Home band, ＋ button (full 135°) and capture header band (132dp); primary buttons use only the deep segment #0F766E → #164E63. AC: no text renders directly on raw gradient (text sits on glass or solid backing); primary-button label contrast ≥5.47:1; white on #2DD4BF end never used for text. [DESIGN › Gradient]
- **UX-DR4: Glass recipe and fallback.** Implement a reusable Glass surface: tint #164E63 + backdrop blur + 1px border #5EEAD4 @22%; light tint 80% (`#164E63CC`), dark tint 62% (`#164E639F`, locked floor, never lower). Solid fallback `glass-fallback` #155665 / `glass-fallback-dark` #1A3C4F with identical layout, used when: API < 31, below the device capability threshold, battery saver on, animator scale 0, reduce transparency on, or glass over photo/receipt imagery. Glass allowed only on hero card, tab bar, Add sheet, capture sheet, small pills; never on lists, Activity rows, widget; never glass-on-glass (sheet footers are solid fallback). AC: each fallback trigger verified on device/emulator; count of glass surfaces per screen ≤ the NFR-19 limit; visual diff against mockups. [DESIGN › Glass; EXPERIENCE › Responsive & Platform] (FR: NFR-19)
- **UX-DR5: Dark-mode glow backdrop cap.** Implement dark backdrop glows `glow-start/mid/end-dark` at ≤45% alpha (locked cap) and enforce the cap for any gradient behind dark glass (Home glows, capture header band). Home dark: no band, three radial glows at (18%,16%) r42%, (88%,26%) r46%, (50%,40%) r55%. AC: glow alpha constant ≤0x72 asserted in test; on-glass-primary ≥7.09:1 over brightest glow. [DESIGN › Glass, components.home-band]
- **UX-DR6: On-glass ink tokens.** Implement `on-glass-primary` #F8FAFC (both modes), `on-glass-secondary` (#F8FAFC light / #CBD5E1 dark), `on-glass-accent` #5EEAD4 and `on-glass-warning` #FCD34D. Rule: on light glass, accent and warning are icons/fills/indicators only, never text; links on glass are `on-glass-primary` + underline or `→`. AC: lint/review checklist; light glass hierarchy expressed by type role not colour; contrast tests per DESIGN Glass table (≥5.08:1 light worst case). [DESIGN › Glass "Ink on glass"]
- **UX-DR7: Needs / Wants / Savings series tokens.** Implement `needs`, `wants`, `savings` light (#0F766E/#14B8A6/#5EEAD4) and dark (#0D9488/#5EEAD4/#CCFBF1). Every N/W/S mark on a light surface gets a 1px `text-secondary` outline; charts use a 2dp `bg-surface` gap between segments, a direct label (name + value + %) on each segment (outside when too small), and patterns in comparison charts (needs solid, wants dotted, savings hatched). AC: chart snapshot tests show outline, gap, labels and patterns in both modes. [DESIGN › Needs / Wants / Savings; EXPERIENCE › Deviations] (FR: addendum §4, FLOW-14)
- **UX-DR8: Category palette (12 `cat-*` hues).** Implement the 12 tokens (rose, pink, fuchsia, indigo, sky, cyan, emerald, lime, olive, brown, stone, slate) light/dark; the colour picker for categories, accounts and goals offers only these 12. Defaults: seed categories per DESIGN table (CAT-001); account types cash→lime, bank→indigo, wallet→sky, savings pot→emerald, credit card→fuchsia; goals→cyan. `Other` is a neutral non-pickable fallback (`text-secondary` icon on `bg-canvas` chip). Category colour never the only signal (icon + name always). AC: picker renders exactly 12 swatches; seed mapping unit test; ≥3:1 vs canvas, surface and own 16% tint in both modes asserted. [DESIGN › Category palette; EXPERIENCE › SCR-18 states] (FR: CAT-001, FIN-010, GOAL-001, SCR-18)
- **UX-DR9: Focus ring and control-boundary tokens.** Implement `focus-ring` (#0F766E / #5EEAD4), `focus-ring-on-glass` #F8FAFC, width 2dp, offset 2dp, and `border-control` (#475569 / #94A3B8) for unselected chips, checkbox boxes and input outlines. AC: a shared FocusRing wrapper is applied to every focusable shared component; ring visible under keyboard, D-pad and Switch Access; uses on-glass variant on glass surfaces. [DESIGN › Colors, Components intro]
- **UX-DR10: Typography – bundled Inter and type scale.** Bundle Inter Regular 400 / Medium 500 / SemiBold 600 only (offline, no network fonts). Implement the 10 roles in sp: display-amount 40/48/600 (−0.5 tracking), headline 28/34/600, title 20/26/600, title-sm 17/24/500, body 16/24/400, body-medium 16/24/500, amount 16/24/600, keypad 28/34/500, label 14/20/500, caption 13/18/400, tag 12/16/500 (floor, never smaller). Sentence case everywhere, no all-caps. AC: font files in the bundle; airplane-mode render test; text style objects unit-tested against the table. [DESIGN › Typography]
- **UX-DR11: Tabular figures on every amount.** Every role rendering money (display-amount, headline, amount, keypad, caption where it shows money, day header) applies `fontFeatureSettings: 'tnum'`. Money strings come only from the shared Intl formatter (symbol, en-IN lakh grouping, decimal comma, 0/2/3 minor digits), never from type styling. AC: a shared `<Amount>` component is the only way to render money; changing values don't jitter (visual test); formatter tests for INR lakh, SGD, EUR comma, JPY 0-digit, 3-digit currencies. [DESIGN › Typography; EXPERIENCE › Foundation] (FR: AD-15 read model)
- **UX-DR12: Spacing, touch and layout tokens.** Implement 4pt scale (1=4 … 12=48dp), gutter 16, margin-mobile 16, touch-min 48, content-max 600, rail-breakpoint 600, focus-ring width/offset. AC: shared layout primitives consume tokens only; scroll views pad their end by tab bar + toast height. [DESIGN › Layout & Spacing]
- **UX-DR13: Radii tokens.** sm 8 (tooltips, skeletons, small inputs), md 12 (cards, buttons, keypad keys, category chips, toasts, setup cards), lg 16 (hero, sheet top corners, widget), full (chips, tags, segmented control, ＋, bars). AC: component snapshot tests reference tokens. [DESIGN › Shapes]
- **UX-DR14: Elevation model.** Tonal hierarchy canvas → surface cards (solid) → glass floating → scrim + sheets. No shadows on cards; exactly one shadow in the app: ＋ button (0 4dp 12dp text-primary @30%). AC: grep/visual check that no other elevation/shadow is set. [DESIGN › Elevation & Depth]
- **UX-DR15: Iconography.** Phosphor library only, outline by default, filled for active tab/selected state (selection = shape change). No emoji anywhere; PRD 👁/⚠ become eye / eye-slash / warning icons. AC: no emoji code points in UI strings (lint); selected states switch icon weight. [DESIGN › Brand & Style; EXPERIENCE › Deviations]
- **UX-DR16: Brand assets.** Coin mark (front w-arrow, back 50/30/20 pie in N/W/S teals), coin-flip Lottie for splash and long-task loader with still pie face for reduced motion; paper-boat illustration (96dp, still frame for reduced motion) used only at empty/relief moments (empty states, `All checked`, goal reached) — never on the calm hero, never the app icon. AC: assets present in bundle; reduced-motion still frames render. [DESIGN › Brand & Style; EXPERIENCE › Open Questions 1] (GATE-12)

#### B. Reusable components (one per component)

- **UX-DR17: Button set.** `button-primary` (deep-segment gradient, white label, rounded.md, min 48dp, label type), `button-primary-disabled` (solid bg-muted, text-secondary ink, outline icon, still focusable, announces `disabled` + reason hint), `button-secondary` (1px accent outline + accent label), `button-secondary-on-footer` (light: on-glass-primary outline+label 7.87:1 on #155665; dark: accent 7.87:1 on #1A3C4F), `button-text` (accent; on glass: on-glass-primary underlined). AC: contrast tests per variant; all ≥48dp; disabled hint read by TalkBack. [DESIGN › Buttons; EXPERIENCE › State Patterns Disabled]
- **UX-DR18: ＋ Add button.** 56dp full-gradient 135° circle, 28dp white plus, 1px glass-border, single app shadow, centred in tab bar (top of rail ≥600dp). Tap opens Add sheet; long-press opens camera (receipt) with equivalent `Snap receipt` custom action. AC: TalkBack label `Add entry` with custom action `Snap receipt`; plus arms ≥3:1. [DESIGN › Tab bar, Gradient; EXPERIENCE › IA] (FR: FLOW-02, FLOW-08)
- **UX-DR19: Glass tab bar.** Home · Activity · ＋ · Insights · Plan; glass surface, 1px top border; inactive outline icon in on-glass-secondary, active filled icon in on-glass-accent + Medium label in on-glass-primary; labels 12/16sp; slot 64dp × 56dp min, 24dp icon, 2dp gap; 64dp row + gesture inset; 8dp on-glass-warning pending dot (no count) on Activity when captures pending. Tab state persists across switches. AC: no numeric badges; pending dot appears/disappears with pending count; TalkBack reads `Activity, tab, 2 of 5, items waiting` (or equivalent state text). [DESIGN › Tab bar; EXPERIENCE › IA]
- **UX-DR20: Navigation rail (≥600dp).** 80dp solid bg-surface rail; ＋ at top, then Home · Activity · Insights · Plan with labels; active = filled accent icon + Medium label. AC: renders at width ≥600dp only; tab bar hidden; keyboard/D-pad navigable with focus rings. [DESIGN › Navigation rail; EXPERIENCE › Responsive]
- **UX-DR21: Screen header.** Per-tab header with screen actions then Accounts icon and avatar (→ SCR-21); Home shows greeting (`title`) + date (`caption`) instead of a title; 64dp min. At fontScale ≥1.3 or when title + actions overflow, splits into two rows: 48dp icon buttons right on row 1, title (wraps, never ellipsised) on row 2; text actions (Activity `Select`) move into a 48dp `More options` overflow. AC: test at 320dp × 200% – no action removed, title not truncated. [DESIGN › Screen header; EXPERIENCE › IA, A11y Large text]
- **UX-DR22: Home band backdrop.** Light only: full-bleed gradient.brand 135°, 4dp below header, 176dp tall, rounded.lg bottom corners, hero overhanging onto canvas. Dark: three capped radial glows (UX-DR5). AC: visual diff vs key-home.html both modes. [DESIGN › components.home-band, Gradient]
- **UX-DR23: Home hero card.** Glass, rounded.lg, padding 16. Anatomy: label · eye/eye-slash 48dp toggle top-right · display-amount (12dp above bar) · hero-bar 8dp · `<spent> of <budget>` caption (8dp below) · daily line `~₹988/day · 12 days left` · 1px divider (on-glass-primary @16%, 12dp margins) · accounts line `In accounts` and `Card dues` side by side 16dp apart (stacked at fontScale ≥1.3), never summed. Implement all states: under budget; over budget (warning icon + `Over budget`, unsigned amount, `N days to payday`); 50/30/20 with unclassified (48dp row `includes ₹X not classified · Sort it`); no budget (`Spent this period`, no bar, 48dp `Set a limit →` underlined); accounts not set (`Set up an account to calculate your balance` / `+1 account not set`, never zero); hidden; loading skeleton; glass fallback. Daily line = Left ÷ days to payday (if set) else days to period end. Tap (except eye) → SCR-15 or budget setup when none. Values fade 150–250ms, never count up; no phrases or illustration in calm state. TalkBack: one merged node built from read model (exact phrasing per EXPERIENCE example; `Over budget by 2,340 rupees`), bar decorative, eye next node `Hide amounts, toggle, off`, `Set a limit` / `Sort` separate 48dp nodes. AC: one test per state table row; 320dp × 200% × `₹1,18,60,000` never ellipsised (cap 1.5×, auto-fit min 28sp). [DESIGN › Home hero card; EXPERIENCE › Component Patterns Home hero, Hero states] (FR: SCR-04, BDG-*, FLOW-01/06/14)
- **UX-DR24: Hero bar (on glass).** 8dp, rounded.full, track on-glass-primary @16%, fill on-glass-primary (light) / on-glass-accent (dark); limit tick 2×14dp on-glass-primary core with 1dp bg-canvas-dark outline and 1dp knockout gap; overflow hatched 45° on-glass-warning 2dp stripes on 4dp pitch over glass-tint base, capped at 20% of track. Hidden when amounts masked (track space kept). AC: fill vs track ≥3.70:1 light / ≥3.43:1 dark; overflow never exceeds 20%; render tests at 50%, 100%, 112%, 300% spent. [DESIGN › hero-bar, Home hero card bar contrast]
- **UX-DR25: Limit bar (solid surface).** 8dp, track bg-muted, fill accent, text-primary 2×14dp tick, hatched semantic-warning overflow capped 20%; status text (caption + 16dp icon) whenever warning tint appears (`Over by ₹X` with warning icon in semantic-warning, `80% used`, `Due in 2 days`). Home budget row: name (label) left, `₹3,400 of ₹4,000` (caption, text-secondary, tnum) right 6dp above bar, status 6dp below. TalkBack reads status text, not the bar. Hidden amounts: bar and percentage not rendered/read; `Over by ₹ ••••` and day statuses stay. Used in SCR-14/15/17/30, Home cards, bill due-soon. AC: state tests (under/80%/over/hidden/due soon). [DESIGN › Limit bar; EXPERIENCE › Other components Limit bar] (FR: BDG-*, GOAL-*, SCR-14/15/17/30)
- **UX-DR26: Card and Home cards.** `card`: bg-surface, rounded.md, padding 16, no shadow; title-sm title + optional right caption scope (`This period`); 12dp between cards. `N to check` card: 48dp row, title-sm count, caption `Waiting for you`, trailing caret, shown only when captures pending → SCR-10. `Edit Home` at the bottom → SCR-05. AC: N to check hidden at 0; TalkBack `3 to check, Waiting for you, button`. [DESIGN › Home cards; EXPERIENCE › IA Home]
- **UX-DR27: KPI tile and Free to use figure.** KPI tile = card + amount role. Free to use: headline figure with estimate label; gate-fail = single tappable 48dp row naming the missing input (`Not enough information yet · Set a limit →` when no budget and no 50/30/20; `· Add an account →` when limit exists but no included account); bills and goals never gate; negative → `Short by ₹X` neutral text-primary; tap figure → "How we worked this out" (Left in budget vs included accounts − upcoming bills − set aside, smaller highlighted). AC: gate truth-table tests; never red. [DESIGN › Other library components; EXPERIENCE › Free to use] (FR: BDG-008, SCR-13, J-BILLS, J-GOAL)
- **UX-DR28: Activity row.** Solid surface, min 64dp, padding 8×16, 12dp gaps; 40dp category-icon-chip; merchant (body-medium); subtitle `Category · Account` (caption, text-secondary) + wrapping status tags (4×6dp gaps); right amount column (amount role, tnum, no wrap). Implement all 11 row states from DESIGN table: confirmed expense (unsigned text-primary), income (`+` semantic-income), refund (Refunds chip; 16dp return icon 4dp left of `+` amount, both income colour), transfer (transfer icon chip, unsigned neutral), guessed, add category, waiting (dashed 1px border-control inset 4dp, 4dp corners), waiting for currency (`currency` tag + dashed + foreign amount `USD 12.99`), possible duplicate (16dp warning icon + `Check` tag in warning), reversed (tag + strikethrough + text-secondary), before tracking, rejected (tag + whole row text-secondary; only with Show rejected). Large text: amount stacks under title right-aligned when fontScale ≥1.3 or amount >40% row width; chip top-aligned and stays 40dp. Behaviour: whole row → SCR-08; `Check` row → SCR-10 (hint `Double-tap to review possible duplicate`); tags not buttons; long-press / `Select` → selection mode; custom actions `Recategorise`, `Delete` with Undo. TalkBack order: merchant → amount with direction → category → account → tags (`possible duplicate, check it`) → date; return icon decorative. AC: snapshot per state at 100% and 200%; no minus sign rendered in any state. [DESIGN › Activity row; EXPERIENCE › Activity row] (FR: TXN-*, SCR-07, FLOW-18)
- **UX-DR29: Category icon chip.** 40dp, rounded.md, cat-* hue @16% background over row surface, 24dp outline icon in the category colour; transfer variant: semantic-transfer icon on bg-canvas chip; Other: text-secondary icon on bg-canvas. In selection mode the chip becomes a checkbox. AC: contrast ≥3:1 vs tint in both modes; variants snapshot. [DESIGN › category-icon-chip, Category palette]
- **UX-DR30: Activity day header.** On bg-canvas, no divider, min 40dp, padding 8×16, 4dp top margin, label type text-secondary tnum. Left `Today · Sat 7 Nov` / `Yesterday · Fri 6 Nov` / `Thu 5 Nov`; right `Spent ₹X` = refund-net (confirmed expenses − refunds that day, floored at ₹0; excludes income, transfers, pending, reversed, rejected; respects active filters), from the read model. Stacked (date then Spent, left-aligned) at fontScale ≥1.3. Masked `Spent ₹ ••••`. TalkBack heading `Thursday 5 November, spent 201 rupees`. AC: computation test (₹1,500 fuel + ₹1,299 refund → ₹201; refund > spend → ₹0). [DESIGN › Activity day header; EXPERIENCE › Activity row, Deviations] (FR: TXN-006, FIN-028, BDG-006)
- **UX-DR31: Status tag pill.** rounded.full, 2×8dp padding, tag type (12sp floor), bg-canvas fill, 1px inset border-hairline, text-secondary; not a button, not focusable separately (read as part of row). Vocabulary: `guessed`, `add category`, `waiting`, `currency`, `Check`, `reversed`, `before tracking`, `rejected`, `mixed`. AC: never below 12sp; snapshot. [DESIGN › Chips status-tag]
- **UX-DR32: Chip family.** Base chip min 32dp, 48dp hit area, rounded.full, label type, 1px border-control unselected, 8dp gaps, 18dp icons; selected = accent fill + white (dark: canvas-dark ink) + filled icon. Variants: quick-category chip (icon + name, ordered by use, one tap selects, account pre-fills from category), account chip, period / days-to-payday chip, Snap receipt / Share from UPI chips (only where available, absent otherwise), `Paid with` / `Paid from` chip. AC: 48dp hit area test; selection conveyed by icon weight + fill; TalkBack role + selected state. [DESIGN › Chips; EXPERIENCE › Quick-category chips]
- **UX-DR33: Filter chip row.** Horizontal scroll above Activity list (48dp row): `Filters · N` button chip (filter icon + count text, not a badge) opens filter sheet; one removable chip per active filter (drawn chip-selected, label + trailing close icon, whole chip removes); `Clear all` when ≥2 filters. After removal focus moves to next chip or `Filters · N`. Filtering never changes Home. TalkBack `Remove filter: HDFC debit`; removal announces `Filter removed. 42 results` (polite). Filtered-empty: `No matches · Clear all`. AC: focus-after-remove test; Home totals unaffected test. [DESIGN › Chips; EXPERIENCE › Filter chip row] (FR: TXN-* search/filter, FLOW-05)
- **UX-DR34: Filter sheet.** Full filter sheet opened from `Filters · N` using the common bottom-sheet anatomy (UX-DR38), including `Show rejected` (90 days). AC: applying returns to Activity with chips reflecting state; Back closes without changes. [EXPERIENCE › IA root stack, FLOW-18] (FR: FLOW-18)
- **UX-DR35: Segmented control.** 40dp visual / 48dp hit, rounded.full, track on-glass-primary @12%, selected on-glass-accent fill + bg-canvas-dark ink + Medium + filled check icon, unselected on-glass-primary. Add sheet: Expense (default) / Income / Transfer; amount and keypad persist across switches; Transfer swaps categories for From → To pickers. Renders as vertical radio list at fontScale ≥1.3. TalkBack radiogroup `Entry type`, radios with `1 of 3`; choosing Transfer announces `Transfer selected. From and To accounts shown`. AC: amount preserved across switches; large-text variant. [DESIGN › Segmented control; EXPERIENCE › Segmented control] (FR: FLOW-03/04)
- **UX-DR36: Amount keypad.** 3×4 keys, min 56dp (grows), keypad type tnum, rounded.md, on-glass-primary ink; digits, locale-aware decimal key, Delete (long-press clears, plus visible `Clear`). Focused on sheet open; hardware number keys and Backspace work. Entered amount is a polite live region read in full (`12 point 50 dollars`); keys labelled `1`…`0`, `decimal point`, `Delete`. Display capped at 1.5× font. Also used for foreign-amount entry. AC: hardware keyboard test; decimal key follows locale and currency minor digits (0/2/3). [DESIGN › keypad-key; EXPERIENCE › Amount keypad] (FR: FLOW-02)
- **UX-DR37: Add sheet.** Common sheet anatomy; opens on Expense with keypad focused; segmented control → quick-category chips (Expense/Income) or From → To pickers (Transfer) → account chip → amount → keypad; sticky solid footer with Save bottom-right (button-primary) and `Save & add another` (keeps sheet open, clears amount). Draft: dismissing with unsaved input (swipe, Back, scrim) keeps an in-memory draft silently (no confirm); reopening restores amount, type, category; Save or `Clear` discards; one draft only; cleared on app lock or process death; never persisted. Inline validation keeps input; focus to first invalid field. Pre-fill modes: Pay card bill (Transfer, From/To, amount = due). Save → close, toast `Saved · Undo`, hero/Activity updated. AC: ~6s end-to-end FLOW-02 path; draft not in DB; draft cleared on lock. [DESIGN › Add sheet; EXPERIENCE › Add sheet, FLOW-02/03/04/17] (FR: SCR-09, FLOW-02/03/04/17)
- **UX-DR38: Bottom sheet base.** Glass body, rounded.lg top, 32×4dp grabber on-glass-secondary @60%, scrim #0F172A99, scrollable content, solid sticky footer (glass-fallback). One sheet at a time (never sheet-over-sheet); swipe down / Back / scrim dismiss; traps focus; on close focus returns to opener; Back closes top sheet first. Motion fade/slide ≤250ms, ≤150ms or none under reduced motion. AC: focus trap and return tests; opening a second sheet replaces, not stacks. [DESIGN › Add sheet anatomy; EXPERIENCE › Interaction Primitives Sheets]
- **UX-DR39: Capture sheet (SCR-27).** Dialog-styled activity hosting a bottom sheet over dimmed host app, 60–70% height (full height at fontScale ≥1.3), glass body. Header band gradient.brand 132dp (≤45% in dark) behind grabber/header/pager; all text over band on-glass-primary in both modes. Header (min 112dp): amount (headline, tnum), merchant (body-medium), account + time caption (`HDFC debit ••4821 · 8:42 pm`); `Later` top-right. Body order: pager (batch) → dots → category grid → `Apply to all similar` → Remember row → auto-approve line; sticky solid footer Reject (button-secondary-on-footer) | Approve (button-primary) equal width, 12dp gap. `Later` / swipe down / Back = decide later (stays pending). Variants rendered as chip rows inside the card: credit types (CAP-004), transfer types / `Moved from my own account` (CAP-012, FLOW-16), account discovery `New account ••7730 (ICICI) — Add it / It's one of mine` (CAP-009, FLOW-15), bill match `Rent paid? Yes, link it` (CAP-011), `Not a transaction · Block sender`, scam notice, new sender, unknown merchant. Target open time ~400ms. AC: each variant renders; band text contrast ≥5.61:1 dark; open-time measurement. [DESIGN › Capture sheet; EXPERIENCE › Capture Surfaces, SCR-27 states] (FR: CAP-002/004/009/011/012, FLOW-09/13/15/16)
- **UX-DR40: Swipe cards (batch capture).** One capture per card; pager `Previous` (left) · `N of M` (label, centre) · `Skip` (right) as 48dp underlined text buttons, plus swipe; 6dp decorative dots, 12dp below. Approve/Reject advance and ignore activation for 500ms after card change. No `Approve all`. Last decision closes sheet with `All checked` + boat (4s, announced; stays until tapped under reduced motion). TalkBack: same moves as custom actions; after decision focus moves to new card heading announcing `Approved Swiggy ₹420. Card 3 of 5: Zomato, 310 rupees, Food guessed`; dots decorative. Under TalkBack/reduced motion card change cross-fades / instant swap. AC: 500ms guard test; announcement string test; no blind approve control. [DESIGN › capture-sheet pager; EXPERIENCE › Swipe cards, Interaction Primitives]
- **UX-DR41: Category grid (on glass).** 4 columns, 8dp gaps; tile full-width × 48dp, rounded.md, on-glass-primary @12%, 24dp outline icon; caption label centred, up to 2 lines with 2-line height reserved; selected = on-glass-accent fill + filled bg-canvas-dark icon + Medium label; 12dp chevron bottom-right for cells with subcategories; long-press or `Choose subcategory` custom action opens them; no cat-* tints on glass. Ordered by merchant history then overall frequency; guessed category pre-selected. Tap = choose and save (single) or advance (batch). TalkBack radiogroup `Category`, cells `Food & Drinks, selected, has subcategories`. AC: ordering test; selected contrast ≥4.85:1. [DESIGN › category-grid-cell; EXPERIENCE › Category icon grid]
- **UX-DR42: Apply to all similar.** button-text on glass (underlined, 48dp), left-aligned directly under grid and above Remember row; rendered only when ≥2 cards in batch share a merchant; applies chosen category to those cards. AC: hidden when no shared merchant; focus order grid → Apply → Remember. [DESIGN › Capture sheet; EXPERIENCE › Swipe cards]
- **UX-DR43: Remember-for-this-merchant toggle.** Full-row 48dp checkbox on glass, default checked, per card; 24dp box 4dp corners, checked on-glass-accent fill + bg-canvas-dark check, unchecked 2px on-glass-primary outline; label body on-glass-primary. TalkBack `Remember for this merchant, checkbox, checked`. Feeds learned merchants (SCR-28). AC: default state per card; learning written only when checked. [DESIGN › remember-toggle; EXPERIENCE › J-LEARN]
- **UX-DR44: Auto-approve line.** `Adds itself at 9:00 pm unless you reject it` (time from settings) caption, on-glass-secondary, under Remember row; shown when auto-approve is on, absent when Off. AC: time string follows Settings › Capture value and locale time format. [DESIGN › Capture sheet; EXPERIENCE › Voice]
- **UX-DR45: Checkbox row.** Full-row 48dp+ target, 24dp box (border-control outline; checked accent fill + check icon), body label wrapping. Used for restore confirmation and selection mode. AC: whole row toggles; TalkBack checkbox role + state. [DESIGN › Checkbox row]
- **UX-DR46: Selection mode and selection bar.** Entered by row long-press or `Select`; selection-bar replaces header (solid, min 56dp): `✕` exit, `N selected` (title-sm), `Select all` (current filtered set), primary `Move N to…` → category picker → preview (`Move N entries from <A> to <B>` or `Move N entries to <B>` when mixed; `Amounts don't change`) → Confirm → toast `Moved 14 to Fuel · Undo` (single-step undo of all). Back exits with no changes. Rows announce `selected` / `not selected`. AC: J-FUEL path test; undo restores all; Back no-op. [DESIGN › Selection bar; EXPERIENCE › Selection mode, J-FUEL] (FR: TXN-010)
- **UX-DR47: Toast with Undo.** Inverse surface (light text-primary bg, #F8FAFC text, #5EEAD4 Undo; dark bg-muted-dark + 1px glass-border), rounded.md, bottom above tab bar; one at a time; Undo on every reversible write (save, delete, reject, recategorise, bulk move, forget, unblock); duration `getRecommendedTimeoutMillis(10000, FLAG_CONTENT_CONTROLS)` never <10s; pauses while touched/focused; under TalkBack persists until next user action; never blocks input; polite live region `Saved. Undo available`. Each Undo has a durable path after dismissal (detail edit, Show rejected, Recently deleted). AC: timing tests; second toast replaces first; contrast values. [DESIGN › Toast; EXPERIENCE › Toast, Interaction Primitives]
- **UX-DR48: One-time tooltip.** Inverse surface, rounded.sm, 8dp pointer, max 280dp, caption, `Got it` 48dp text button; no auto-dismiss; max one per session; never over an open sheet/dialog; inline card under anchor at fontScale ≥1.3; polite announcement and inserted in focus order after anchor, never steals focus; tips never insert data. Triggers: first-view In accounts tip, post-first-save long-press ＋ tip (ONB-005). AC: per-session cap test; suppression while sheet open. [DESIGN › Tooltip; EXPERIENCE › Tooltip, FLOW-01] (FR: ONB-005)
- **UX-DR49: Tab long-press label tooltip.** Long-pressing a tab shows its label at full scale in a tooltip (large-text aid). AC: works at 200% font scale; TalkBack label unaffected. [DESIGN › Typography rule 5]
- **UX-DR50: Empty state.** Centred 96dp paper boat on water (still under reduced motion), one body sentence in text-secondary, one button-primary. Copy per surface: Review queue `You're all caught up · Smooth sailing`; Bills `No bills yet. Rent, phone, subscriptions? · Add a bill`; Goals `No goals yet. Saving for something? · Add a goal`; Learned merchants `Nothing learned yet. Corrections you make with "Remember" show up here.`; Recently deleted `Nothing deleted in the last 30 days`; Activity filtered-empty `No matches · Clear all`. AC: each surface snapshot; never `Nothing here!`. [DESIGN › Empty state; EXPERIENCE › State Patterns]
- **UX-DR51: Inline error / retry pattern.** Inline, never dead end: plain cause + data reassurance (`Nothing was saved`) + Retry + alternative path (`Enter it by hand`, `Pick a photo instead`, `Open settings`); no modal OK-only dialogs; on submit failure focus moves to first invalid field whose label includes error (`Error: amount required`); screen-level errors announced once via assertive live region. AC: shared ErrorBlock component; focus-move test; PRD §15 failure matrix cases mapped. [EXPERIENCE › Error retry, State Patterns Error]
- **UX-DR52: Skeleton loader.** Content-shaped blocks, fill border-hairline, rounded.sm; real values fade in 150–250ms; no spinners in main app; stale/partial recompute labelled, not animated as confirmed. AC: no ActivityIndicator usage in main app (lint). [DESIGN › skeleton; EXPERIENCE › State Patterns Loading]
- **UX-DR53: Coin-flip long-task loader (SCR-31).** Lottie coin flip, progress text (`3 of 14 items`) as polite live region, reassurance line, Cancel where cancellable; failure → inline error pattern; reduced motion → still pie face; OCR scan-line variant (reduced motion → static photo + determinate progress bar). Splash: coin half-flip ending when DB ready. AC: reduced-motion variants; cancel writes nothing. [EXPERIENCE › Coin-flip loader, FLOW-01/08/10] (FR: SCR-31)
- **UX-DR54: Amount mask component.** When hidden: currency symbol + fixed four dots (`₹ ••••`, `S$ ••••`), same role/weight/colour; direction cues kept (`+₹ ••••` income, refund icon, transfer icon); dots hidden from accessibility, node reads `Amount hidden`. Implemented inside the shared `<Amount>` so no screen can bypass it. AC: ₹60 and ₹1,18,60,000 render identical width; TalkBack test. [DESIGN › Amount mask; EXPERIENCE › Privacy]
- **UX-DR55: Home-screen widget 4×1.** Solid surface (no blur), follows system theme, rounded.lg; left headline title-sm (amounts only when enabled and app lock off: `₹11,860 left` / `Over budget ₹2,340` / `Spent this period`; default no amount) + `N to check` caption (hidden at 0); right Snap and Add 48dp icon buttons in accent labelled `Snap receipt`, `Add entry`; both pass LockGate. Headline wording ellipsises, never the amount. No numeric badge. Renders only from snapshot written after each commit. AC: states default / amounts-enabled / lock-on / N=0. [DESIGN › Widget; EXPERIENCE › Capture Surfaces, SCR-29 states] (FR: SCR-29, FLOW-08)
- **UX-DR56: Home-screen widget 4×2.** User-resizable; headline + `N to check` on row 1, Snap and Add as full-width row 2; same content rules; documented as the size for large text (nothing dropped at 200%). AC: 200% font render shows both buttons. [DESIGN › Widget 4×2]
- **UX-DR57: Stepper (CSV wizard, SCR-19).** stepper-header: `Step N of M` (label) heading announced each step + thin limit-bar-style progress without tick + Back; Back never loses input; Cancel anywhere writes nothing; nothing written until `Import N entries`. AC: back/cancel data-integrity tests. [DESIGN › Stepper header; EXPERIENCE › Stepper, FLOW-07] (FR: SCR-19, FLOW-07)
- **UX-DR58: Setup card.** bg-surface, 1px dashed border-control, rounded.md, title-sm + one sentence + button-text; dismissible variant adds 48dp close `Dismiss` (dismissal remembered). Uses: Plan empty (`Add your rent` · `Set one budget` · `Name a goal`, also `Add upcoming bills`), Home SMS re-ask card. AC: dismissal persists across launches. [DESIGN › Setup card; EXPERIENCE › Setup card] (FR: SMS-014, SCR-13)
- **UX-DR59: Split editor.** Rows category + amount; `Left to assign ₹X` polite live region debounced 500ms; `Fill` assigns remainder to focused (or last) row, labelled `Fill: assign ₹X to Groceries`; Save disabled until remainder = 0 but focusable with hint `Assign the remaining ₹X to save`; over-assignment warning icon + `₹X too much`; no silent auto-balance; receipt `Not itemised` is a split row. AC: remainder math tests incl. currency minor units. [EXPERIENCE › Split editor, FLOW-05] (FR: TXN-009)
- **UX-DR60: Settings group row and hub.** SCR-21 six rows (You, Money, Capture, Privacy, Data, Help) each with live one-line summary that is part of the row label (e.g. `SMS on · Auto-approve 21:00`, `App lock on · Amounts shown · Notifications: full`). AC: summaries update live after sub-screen change; TalkBack reads summary. [EXPERIENCE › Settings hub, Settings group row] (FR: SCR-21)
- **UX-DR61: Home card editor (SCR-05).** List with drag handle, `Move up` / `Move down` buttons (also custom actions), `Hide` switch, compact/full where supported; hero pinned first without Hide; `Reset to default` restores PRD order; changes apply on Back. TalkBack `7-day spend hidden` / `Needs, Wants, Savings moved to position 2 of 6`. AC: J-HOMEEDIT path without drag. [EXPERIENCE › Home card editor, J-HOMEEDIT] (FR: SCR-05)
- **UX-DR62: Learned merchants list (SCR-28).** Rows `Swiggy Instamart → Groceries` with `Edit` / `Forget`; `mixed` tag + `Clear mixed`; Blocked senders section (India only) with `Unblock`; Forget/Unblock give Undo toast; search at top when >20 rows. Located under Settings › Capture. AC: Forget removes pre-fill on next capture. [EXPERIENCE › Learned merchants list, J-LEARN, Deviations] (FR: SCR-28)
- **UX-DR63: Restore confirmation.** Preview card (backup date, entries, accounts vs `This phone now`); copy `If something goes wrong during restore, nothing on this phone changes.`; `Back up this phone first` link (opens Backup then returns); checkbox-row `I understand this replaces what's on this phone now` enables Restore; re-auth when lock on; low free space adds `There isn't room to keep a copy of this phone's data while restoring.` + second checkbox `Restore without that copy`. No typed-word confirm. AC: Restore disabled until required boxes ticked; low-space branch. [EXPERIENCE › Restore confirmation, FLOW-10, Deviations] (FR: BKP-002, SCR-20, FLOW-10)
- **UX-DR64: Passphrase field.** Enter + confirm, `Show` toggle (`Show passphrase, toggle`), strength hint (`Strong enough`) and `Passphrases don't match` as polite live regions with icon + text, no-recovery line `We can't recover this. Without it, the backup can't be opened.`; paste and password managers allowed (`password-new` / `password`); wrong passphrase keeps field content. AC: autofill hints set; content kept on failure. [EXPERIENCE › Passphrase field, FLOW-10] (FR: SCR-20)
- **UX-DR65: Charts and View-as-table.** Victory Native XL; every segment directly labelled; never on raw gradient; every chart has `View as table` with tappable rows doing the same drill-down; tap bar/segment → filtered Activity (pushed in Insights stack; Back restores filter/period); <2 comparable points → `No baseline yet`, no trend arrow; net refund surplus → bar at zero with `₹7,000 back` + refund icon, no negative bar, no minus in table; scope label first (`Spent · HDFC only`). TalkBack table rows single nodes (`Food, 4,200 rupees, 32 percent`), header row announced as headers. Hidden amounts: values masked, percentages/fills hidden. AC: FLOW-11 Back-restore test. [DESIGN › Other library components; EXPERIENCE › Charts, FLOW-11] (FR: SCR-11/12, FLOW-11)
- **UX-DR66: Receipt OCR review screen (SCR-23).** Merchant, date with `date?` marker (warning icon + text) when unsure, `Paid with` chip, category totals, `Not itemised` row in grey, `Items (N)` collapsed, low-confidence total requires tap to confirm, match prompt `Matches ₹2,340 HDFC debit 6:12 pm — Attach to it / Keep separate / Discard`. AC: Save blocked until low-confidence total confirmed. [EXPERIENCE › SCR-23 states, FLOW-08] (FR: SCR-23, FLOW-08)
- **UX-DR67: Region/currency onboarding picker (SCR-02).** Pre-filled from device region (`Singapore · S$ SGD`) with live preview `Amounts look like S$1,234.50`; Continue in one tap; `Change` opens searchable list (country or currency code, detected region pinned top); calm note that currency is fixed once entries exist. AC: preview updates live from shared formatter. [EXPERIENCE › FLOW-01] (FR: SCR-02, FLOW-01)

#### C. State patterns, privacy, notifications, outside-app surfaces

- **UX-DR68: Per-screen state coverage.** Every screen implements the PRD §6.4 state set (initial, loading, empty, populated, error, partial/import-review, permission-denied, read-only where relevant, confirmation, success); no offline state is shown (app always offline). AC: per-screen state checklist in story DoD with the per-surface specifics from EXPERIENCE table (SCR-04/05/07/10/13/16/17/18/19/20/22/23/24/27/28/29/31, Recently deleted). [EXPERIENCE › State Patterns]
- **UX-DR69: Permission-denied pattern and just-in-time requests.** Camera, notification and SMS permissions requested only at point of use (never onboarding); denial → inline pattern with feature off and other paths kept (`Enter it by hand`, `Pick a photo instead`, `Open settings`); notifications off → `Notifications are off for wmbugo · Open settings`, in-app statuses still shown. AC: no permission prompt during onboarding; denied-state snapshot per permission. [EXPERIENCE › State Patterns, Notifications, J-NOTIF, FLOW-08/09]
- **UX-DR70: Unknown / not-set values.** Never render an unknown as zero: `+1 account not set`, `balance not set`, `Showing 3 bills you added`. AC: unit tests on read-model presenters for null inputs. [EXPERIENCE › State Patterns Unknown]
- **UX-DR71: Confirmation tiers.** Reversible actions act immediately + Undo toast; irreversible/sensitive (erase, restore, decrypted export, lock change, delete permanently incl. both transfer legs) use checkbox row or confirm sheet with plain consequences + re-auth when lock on; no typed-word confirmations. AC: inventory of destructive actions each mapped to a tier. [EXPERIENCE › State Patterns Confirmation]
- **UX-DR72: Read-only safe mode.** When DB can't open or fails integrity: no writes, offer restore, export and Diagnostics (SCR-22). AC: forced-corruption test shows safe mode with all three paths. [EXPERIENCE › State Patterns Read-only]
- **UX-DR73: Success and relief moments.** Success = toast or inline line; relief moments (queue cleared `All checked`, goal reached) show the boat; no confetti/exclamation marks. AC: snapshot of each relief moment. [EXPERIENCE › State Patterns Success, Voice]
- **UX-DR74: Global hide-amounts mode.** Hero eye toggles masking of every amount on every screen in one tap; remembered across launches (profile setting); forces hidden notification form and no widget amounts. Bars/fills encoding money ratios hidden (layout preserved); ratio text (`85% used`, N/W/S %, chart percent columns) not rendered or announced; counts, days, labels, signs, icons, tags remain; money in status text masked (`Over by ₹ ••••`). AC: screen-by-screen audit test toggling hidden; no percentage visible anywhere while masked. [DESIGN › Amount mask; EXPERIENCE › Privacy & Hidden Amounts]
- **UX-DR75: App lock, LockGate and app-switcher privacy.** Biometric / device credential with timeout on resume; device-credential fallback; app-switcher snapshot obscured; deep links, widget, notifications and share intents pass LockGate; share received while locked queued and delivered after unlock (never lost); unlock returns user to where they were; app lock offered once after first saved entry. AC: FLOW-12 tests; queued-share test. [EXPERIENCE › IA root stack, Privacy, FLOW-12, FLOW-01] (FR: SEC-*, FLOW-12)
- **UX-DR76: Capture notification – full form.** Amount, merchant, account, guessed category + Approve / Reject actions working from the shade with full labels (`Approve ₹420 Swiggy`); states auto-approve time when on; several pending captures group into one updating notification; tap → capture sheet. AC: grouping test; action labels include amount + merchant. [EXPERIENCE › Notifications] (FR: CAP-*, FLOW-09)
- **UX-DR77: Capture notification – hidden form.** `New payment to check`, no amount/merchant/account, only `Review` action, unlock required; used on lock screen, when app lock on, when hide amounts on, or when chosen — unless full notifications opted in (off by default). Lock-screen approve opt-in, off by default. AC: matrix test of the four triggers × opt-in. [EXPERIENCE › Notifications, J-NOTIF, Deviations] (FR: SEC-005)
- **UX-DR78: Evening summary notification.** Collapsed `Today: N recorded · Tap to review`; expanded inbox-style up to 5 lines merchant first (`Swiggy ₹420 · Food & Drinks`) + `+N more`; hidden form count only; sent only after auto-approve write, max one per day; tap → (unlock) Activity filtered to today's auto-approved entries. AC: once-per-day guard; filtered destination test. [EXPERIENCE › Notifications, J-EVENING, Deviations]
- **UX-DR79: Budget threshold and bill reminder notifications.** Threshold: once per threshold per period, neutral wording, never amounts on lock screen, tap → SCR-15 filtered to contributing transactions. Bill reminder: priority over budget alerts, overflow merges into `N more reminders` per SET-003 caps, tap → SCR-16. No numeric app badge anywhere. AC: dedupe and priority tests. [EXPERIENCE › Notifications, FLOW-06, J-BILLS] (FR: SET-003, FLOW-06)
- **UX-DR80: Share target (UPI screenshot).** India only; share of UPI success screenshot → capture sheet pre-filled (amount, payee, time, UPI ref, `Paid from` chip with `+ New account`); duplicate share recognised and adds nothing; dismissed → `Waiting for you`, never auto-approved; unreadable → `Enter it by hand`. AC: duplicate-share test; locked-share queue test. [EXPERIENCE › Capture Surfaces, FLOW-13] (FR: FLOW-13)
- **UX-DR81: SMS explainer and re-ask (SCR-24).** Full-screen explainer `Let wmbugo read bank SMS?` with Reads / Keeps / Never rows, `Turn on` → OS prompt, `Not now`, footer `Turn off anytime in Settings › Capture`, `Learn more` expands field list; India + approved build only (otherwise absent); denied state keeps manual/UPI/receipt; OEM help. Re-ask card after 5th manual entry, once more ≥7 days after first dismissal, then only from Settings › Capture. AC: re-ask eligibility timing tests. [EXPERIENCE › FLOW-09, J-SMS-REASK] (FR: SMS-014, SCR-24)
- **UX-DR82: Capture status vocabulary.** Exact strings `Waiting for you` · `Possible duplicate — check it` · `Looks like a scam — not added` · `Recorded · category guessed` · `Recorded · needs a category` · `Recorded` · `Rejected`; every typed `Result` code maps 1:1 to a copy entry. AC: exhaustive-switch test over Result codes. [EXPERIENCE › Voice] (FR: addendum §3)
- **UX-DR83: Diagnostics (SCR-22) with OEM background help.** Status list (version, schema, storage, permissions, background state with OEM help text); export shows preview and needs consent. AC: export blocked without consent. [EXPERIENCE › SCR-22 states, Privacy, FLOW-09] (FR: SCR-22)

#### D. Accessibility floor

- **UX-DR84: Large-text amount rules.** display-amount, headline, keypad cap maxFontSizeMultiplier 1.5; display-amount and headline then auto-fit to width (min 28sp / 22sp); amounts never ellipsised, clipped or wrapped mid-number; every text container height is a minimum (grows). AC: test matrix 320dp × 200% × `₹1,18,60,000` × hidden × over-budget on hero, Activity, Add sheet, capture sheet, widget. [DESIGN › Typography Large text 1,4,8; EXPERIENCE › A11y Large text]
- **UX-DR85: Large-text layout reflow (C1 set).** At fontScale ≥1.3: Activity amount stacks (also when amount >40% row width); hero In accounts / Card dues stack; day header stacks; screen header two rows with `More options` overflow; segmented control becomes vertical radio list; tooltip becomes inline card; capture sheet goes full height; sticky footers keep Save/Approve/Reject reachable. Tab bar labels cap 1.3× then auto-fit (min 12sp), single line, never dropped; bar grows in height not slot count. AC: one snapshot per rule at 200% matching key-activity.html right frame. [DESIGN › Typography rules 2,3,5,6,7; EXPERIENCE › A11y Large text]
- **UX-DR86: TalkBack merged announcements and labels.** Shared accessibility-label builders in `src/shared` produce: hero merged node; activity row order (merchant → amount with direction → category → account → tags → date); day header heading; amounts in full with direction (`Over budget, 2,340 rupees`, `Income, plus 85,000 rupees`); `~` read `about`; masks read `Amount hidden`; decorative icons/dots/arrows/bars hidden. Every control has role and state. AC: builder unit tests with exact strings from EXPERIENCE; TalkBack manual script per key screen. [EXPERIENCE › Component Patterns TalkBack, A11y Labels]
- **UX-DR87: Live regions and announcements.** Polite live regions: toasts, tips, split remainder, keypad amount, loader progress, filter results, passphrase hints; assertive once for screen-level errors; errors move focus to the field. AC: inventory test that each listed surface sets accessibilityLiveRegion. [EXPERIENCE › A11y Announcements]
- **UX-DR88: Visible focus and focus management.** Focus ring on every focusable control (keyboard, D-pad, Switch Access); focus order follows reading order; scroll views keep focused element clear of tab bar and toast; after sheet close focus returns to opener; Back closes top sheet; capture card change moves focus to new card heading. AC: keyboard traversal test on Home, Activity, Add sheet, capture sheet. [EXPERIENCE › A11y Focus]
- **UX-DR89: 48dp touch targets.** Every control ≥48dp including inline links (48dp rows), whole filter chips, segmented segments, chips (32dp visual + 48dp hit), pager buttons, widget buttons, dismiss buttons. AC: automated hit-rect audit in component tests. [DESIGN › Layout; EXPERIENCE › A11y Touch targets]
- **UX-DR90: Never colour alone.** Overspend = icon + label + tick + hatch; row states = tag text with styling secondary; selection = filled icon/check; N/W/S = labels + patterns + gaps; category = icon + name; warnings always icon + text. AC: greyscale screenshot review of key screens retains all meaning. [EXPERIENCE › A11y Never colour alone; DESIGN › Do's]
- **UX-DR91: Reduced motion.** Honour system animator scale and in-app Reduce motion toggle: coin → still pie face; boat → still frame; OCR scan line → static photo + determinate bar; card change → instant swap + focus move; sheets/toasts → fade ≤150ms or none; hero values instant; `All checked` stays until tapped; animator scale 0 also switches glass to fallback. AC: test with animator scale 0 and in-app toggle separately. [EXPERIENCE › Interaction Primitives Motion, A11y Reduced motion]
- **UX-DR92: Timing and toast accessibility.** Toast timeout via `getRecommendedTimeoutMillis(10000, FLAG_CONTENT_CONTROLS)`, ≥10s, pause on touch/focus, persists under TalkBack until next action; auto-approve stated on every capture and adjustable (time or Off). AC: as UX-DR47 plus Settings › Capture Off hides auto-approve line. [EXPERIENCE › A11y Timing]
- **UX-DR93: Gesture alternatives.** Every gesture has a visible control and custom action: swipe-down sheet = `Later`; swipe cards = `Previous`/`Skip`; long-press ＋ = `Snap receipt` chip + custom action; long-press category cell = chevron + `Choose subcategory`; long-press row = `Select`; drag reorder = `Move up`/`Move down`; long-press Delete = visible `Clear`. AC: each path completable with TalkBack and with Switch Access without gestures. [EXPERIENCE › Interaction Primitives]
- **UX-DR94: Chart accessibility.** `View as table` on every chart; table rows single nodes; header row announced as headers; scope label first. AC: per-chart TalkBack test. [EXPERIENCE › Charts, A11y Charts]

#### E. Responsive, motion, voice/microcopy

- **UX-DR95: Responsive breakpoints.** <600dp (incl. phone landscape): bottom tabs, single column, bottom sheets. ≥600dp: nav rail with ＋ at top, content centred at max 600dp, sheets centred at content width, no two-pane. Respect cutouts, gesture insets, keyboard; Android back gesture closes top sheet first. AC: layout tests at 320, 430, 599, 600, 840dp. [DESIGN › Layout; EXPERIENCE › Responsive & Platform]
- **UX-DR96: Navigation structure.** Root stack LockGate → onboarding (SCR-01–03) → tabs; modals (Add sheet, filter sheet, selection sheets, SCR-31, restore confirmation); per-tab stacks per IA table (e.g. Insights filtered Activity pushed inside Insights stack; Accounts pushed on current tab); no drawer; features unavailable in market/build absent, never "coming soon". AC: navigation tests for each IA row. [EXPERIENCE › IA]
- **UX-DR97: Motion rules.** All transitions 150–250ms, never blocking input; no count-up; values fade in; haptics only when enabled and only on save/approve. AC: animation durations from a shared motion token module. [EXPERIENCE › Interaction Primitives Motion, Haptics]
- **UX-DR98: Banned patterns guard.** No numeric badges (icon, tabs, widget), no "Inbox", no spinners in main app, no modal OK-only dialogs, no typed-word confirmations, no upfront tutorials, no blind Approve all, no emoji, no "coming soon", no pull-to-refresh, no gesture-only paths. AC: lint/grep rules + review checklist. [EXPERIENCE › Interaction Primitives Banned]
- **UX-DR99: No minus signs; money direction copy.** Expenses unsigned; income `+₹85,000`; refunds `+` with return icon; transfers unsigned neutral; overspend `Over budget ₹2,340`; net refund surplus `Shopping · ₹7,000 back` with refund icon (bar at zero); `Short by ₹X` neutral. Formatter never emits a minus. AC: property test – formatter output for any value contains no `-`/`−`; presenter tests for negative inputs. [DESIGN › Activity row; EXPERIENCE › Voice]
- **UX-DR100: Microcopy rules and string catalogue.** Centralised strings honouring PRD §6.7 and the Voice Do/Don't table: `N to check` (never Inbox/badges/`unread`), `~₹988/day · 12 days left` (`~` rough guide), `5 days to payday` when over, `Not enough information yet · Set a limit →`, `All checked`, `Rough is fine`, restore copy, `I understand this replaces…`, `Turn off anytime in Settings › Capture`, `Tired of typing payments? Let wmbugo read bank SMS`, `Couldn't read this receipt. Nothing was saved. · Try again · Enter it by hand`; sentence case; no nudge/guilt copy. AC: string catalogue reviewed against table; snapshot tests use catalogue keys. [EXPERIENCE › Voice and Tone] (FR: PRD §6.7)

#### F. Deviations from PRD needing implementation attention

- **UX-DR101: Overspent hero deviation.** Implement `Over budget` label + unsigned amount + warning icon + days-only time line instead of PRD Appendix B negative Left / `₹1,240 over budget · 4 days left`. AC: no negative value path in hero presenter. [EXPERIENCE › Deviations row 1] (FR: SCR-04 App B)
- **UX-DR102: Light glass deviation.** Light glass = 80% deep-teal tint, not PRD translucent white 18%. AC: token value asserted; PRD follow-up noted. [EXPERIENCE › Deviations row 2] (FR: §6.2/§6.6)
- **UX-DR103: Primary button gradient deviation.** Deep segment only for primary buttons; full gradient only on ＋. [EXPERIENCE › Deviations row 3] (FR: §6.2/§6.6)
- **UX-DR104: No accent themes in Phase 1.** Theme = System/Light/Dark only. [EXPERIENCE › Deviations row 4] (FR: SET-001)
- **UX-DR105: Palette-only colour selection.** Categories, accounts, goals pick from 12 cat-* hues with type defaults (no free colour). [Deviations row 5] (FR: SCR-18, FIN-010, GOAL-001)
- **UX-DR106: N/W/S dark variants.** Add needs-dark/wants-dark/savings-dark. [Deviations row 6] (FR: addendum §4)
- **UX-DR107: Phosphor icons replace emoji glyphs.** [Deviations row 7]
- **UX-DR108: Free-to-use single next step.** Gate fail names one missing required input instead of listing all; bills/goals never gate. [Deviations row 8] (FR: BDG-008)
- **UX-DR109: Evening summary format.** Collapsed `Today: N recorded · Tap to review` + expanded list instead of addendum §3 breakdown. [Deviations row 9] (FR: addendum §3)
- **UX-DR110: Restore copy and checkbox confirm.** No lasting safety-copy promise (AD-10); checkbox + re-auth replaces typed `RESTORE`. [Deviations rows 10–11] (FR: BKP-002, FLOW-10)
- **UX-DR111: Hidden notification text.** `New payment to check` instead of `wmbugo · 1 new transaction`. [Deviations row 12] (FR: SEC-005)
- **UX-DR112: No tablet two-pane.** Rail + centred content only; two-pane deferred to Phase 2. [Deviations row 13] (FR: §5.3)
- **UX-DR113: Capture dialog as bottom sheet.** SCR-27 is a bottom sheet inside a dialog-styled activity, not a floating dialog. [Deviations row 14] (FR: SCR-27, CAP-002, AD-12)
- **UX-DR114: Learned merchants under Settings › Capture.** Move SCR-28 from Money to Capture; Money holds Categories only. [Deviations row 15] (FR: §5.1, SCR-28)
- **UX-DR115: Refund-net day header Spent.** Day header Spent is refund-net, floored at ₹0 (see UX-DR30). [Deviations row 16] (FR: TXN-006, FIN-028, BDG-006)

### FR Coverage Map

- FIN-001: Epic 1 - Integer minor-unit money with exponent-aware shared formatter
- FIN-002: Epic 1 - UTC instant + capture timezone + fixed local_date; timezone-change prompt
- FIN-003: Epic 1 - Domain transaction types with intent and provenance
- FIN-010: Epic 1 - Typed account model (cash, bank, wallet, pot, card liability)
- FIN-011: Epic 2 - Asset balance and card outstanding derivation, never mixed
- FIN-012: Epic 2 - Known funds from included assets; optional labelled net worth
- FIN-013: Epic 2 - Balanced atomic transfers, never income/expense
- FIN-014: Epic 3 - Atomic edits/reversals, soft delete + Recently deleted, purge tombstones
- FIN-015: Epic 2 - Archived accounts keep history; explicit adjustments only
- FIN-016: Epic 2 - "Before tracking started" entries never change balance
- FIN-020: Epic 1 - Transaction record fields
- FIN-021: Epic 1 - Posting sign rules per transaction type
- FIN-022: Epic 3 - Split allocations sum exactly; receipt total and Not itemised row
- FIN-023: Epic 3 - Reimbursement as linked refund/recovery with net and gross views
- FIN-024: Epic 3 - Status model, capture_resolution and shared status vocabulary
- FIN-025: Epic 11 - Editable merchant normalization; corrections drive learning
- FIN-026: Epic 11 - Auto-approve as scheduled DB write with clock guard
- FIN-027: Epic 3 - Duplicate matching, Merge and transfer-pairing rules
- FIN-028: Epic 3 - Refund and failed-payment reversal treatment
- LIR-01: Epic 2 - Internal transfer postings sum to zero
- LIR-02: Epic 3 - Split allocations equal categorisable amount
- LIR-03: Epic 9 - Re-importing a file never duplicates confirmed entries
- LIR-04: Epic 10 - OCR never auto-creates a second confirmed expense
- LIR-05: Epic 11 - Auto-approve never confirms duplicates or open candidates
- LIR-06: Epic 3 - All capture sources reach the ledger only via the shared pipeline
- LIR-07: Epic 1 - Exact store/format/parse round-trip per currency exponent
- LIR-08: Epic 2 - Opening balances/adjustments distinguishable from income
- LIR-09: Epic 3 - Expenses, refunds, reversals, card payments reconcile across views
- LIR-10: Epic 1 - No rounding drift on large or repeated edits
- LIR-11: Epic 1 - Transactional ledger mutations with validation and rollback
- ONB-001: Epic 1 - Usable without registration or network
- ONB-002: Epic 1 - First-use flow: privacy, region/currency, account, payday, 50/30/20
- ONB-003: Epic 1 - Skipped account shows "balance not configured"
- ONB-004: Epic 1 - Just-in-time permission prompts, none in onboarding
- ONB-005: Epic 1 - No tutorial; one contextual tip per first event
- ONB-006: Epic 1 (period change without mutation, Story 1.16), Epic 4 - Later settings changes; budget-period change re-aggregates
- ONB-007: Epic 1 - Onboarding asks for at most one account
- ONB-008: Epic 8 - App lock offered once after first saved entry
- ACC-001: Epic 1 - Create, rename, reorder, archive and view accounts
- ACC-002: Epic 2 - Opening balance/date, account timeline, reconciliation adjustment
- ACC-003: Epic 2 - Credit card outstanding, statement due and limit
- ACC-004: Epic 2 - Archive warnings for nonzero balances/pending transfers
- ACC-005: Epic 2 - Include/exclude accounts from overview totals
- ACC-006: Epic 2 - "Money you have" vs "Money you owe" grouping
- ACC-007: Epic 2 - Pay card bill as a transfer
- ACC-008: Epic 2 - Adjust balance via explicit adjustment posting
- ACC-009: Epic 2 - Savings pots as transfer destinations counted as Savings
- TXN-001: Epic 1 - Centre ＋ Add sheet entry points
- TXN-002: Epic 1 - Amount-first expense form with quick-category chips
- TXN-003: Epic 1 - Income form
- TXN-004: Epic 1 - Transfer form with fee and balance warning
- TXN-005: Epic 3 - Edit, duplicate, reverse, undo, Delete / Reject
- TXN-006: Epic 3 - Activity list by date with refund-net day Spent and row states
- TXN-007: Epic 3 - Search, filters, sort and virtualized pagination
- TXN-008: Epic 3 - Review queue = needs_review set; "Add a category" list
- TXN-009: Epic 3 - Split editor with exact sum reconciliation
- TXN-010: Epic 3 - Bulk recategorization with preview and undo
- TXN-011: Epic 3 - Receipts/source metadata survive edits; detach images
- TXN-012: Epic 3 - Manual duplicate saved as possible_duplicate with Keep both / Merge
- TXN-013: Epic 3 - Foreign-currency items require user-entered profile amount
- CAT-001: Epic 1 (seed data, Story 1.13), Epic 4 - Seed expense and income categories
- CAT-002: Epic 4 - Manage categories with icon and 12-hue palette
- CAT-003: Epic 4 - Category kinds (expense/income/mixed)
- CAT-004: Epic 4 - Archive/merge with remap preview
- CAT-005: Epic 4 - Overridable suggestions (rule editor SCR-25 is Phase 2)
- CAT-006: Epic 1 (type column and seeded defaults, Story 1.13), Epic 4 - Need/want type per category; "Not classified" segment
- BDG-001: Epic 4 - Persistent budget rules with period types incl. payday
- BDG-002: Epic 4 - Budget scopes, single overall budget, payday-change shortened cycle
- BDG-003: Epic 4 - Budget used/remaining/projection/status
- BDG-004: Epic 4 - Threshold alerts fired once per threshold per period
- BDG-005: Epic 4 - No rollover; prior periods queryable (rollover Future)
- BDG-006: Epic 4 - Refund-net budget used floored per category
- BDG-007: Epic 4 - Target edits now or from next period with history
- BDG-008: Epic 6 - Free to use estimate on Plan with single next-step gate
- BDG-009: Epic 4 - One-tap 50/30/20 targets and Needs/Wants/Savings
- REC-001: Epic 6 - Manual recurring bill rules
- REC-002: Epic 6 - Planned bills never affect balances or totals
- REC-003: Epic 6 - Local bill reminder notifications
- REC-004: Epic 6 - Linked payment advances occurrence exactly once
- REC-005: Out of scope — Phase 2 - Automatic recurrence inference
- REC-006: Epic 6 - Monthly anchor day with month-end clamping
- REC-007: Out of scope — Phase 2 - Suggested-subscription classification (P1 manual kind lives in REC-001)
- REC-008: Epic 6 - Subscriptions filter with monthly-equivalent total
- REC-009: Epic 6 - Capture matching a bill rule offers "Rent paid? Yes, link it"
- REC-010: Epic 6 - Plan timeline lists only user-added bills
- GOAL-001: Epic 6 - Goal fields
- GOAL-002: Epic 6 - Set aside vs Moved to savings contributions
- GOAL-003: Epic 6 - Goal progress and pace when data allows
- GOAL-004: Epic 6 - Goal lifecycle; over-allocation warning
- HOM-001: Epic 5 - Home card order and "Am I okay?" hero
- HOM-002: Epic 5 - Home cards with icons, values and drill-down
- HOM-003: Epic 5 - Home card layout customization
- HOM-004: Epic 5 - Home refresh triggers and stale indication
- HOM-005: Epic 5 - Timeframe and scope on every value; no fabricated history
- HOM-006: Epic 1 (＋ in the app shell, Stories 1.10, 1.14), Epic 5 - Centre ＋ always visible
- HOM-007: Epic 11 - Android home-screen widget
- HOM-008: Epic 5 - Hide-amounts eye persisting across restarts
- INS-001: Epic 7 - Date presets and cross-filtering
- INS-002: Epic 7 - Accessible chart summaries, tables and drill-down
- INS-003: Epic 7 - Aggregations from confirmed events only
- INS-004: Epic 7 - Like-for-like partial period comparison
- INS-005: Epic 7 - Currency, interval and timezone correctness
- INS-006: Epic 7 - Safe empty states and data export
- INS-007: Epic 7 - Question-ordered Insights view with View as table
- INS-010: Epic 7 - Expense trend chart
- INS-011: Epic 7 - Income vs expense bars
- INS-012: Epic 7 - Category distribution donut with "₹X back"
- INS-013: Epic 7 - Category budget progress bars
- INS-014: Epic 7 - Top merchants bars
- INS-015: Epic 7 - Spending change tiles with "No baseline yet"
- INS-016: Epic 7 - "Kept N%" gauge
- INS-017: Out of scope — Phase 2 - Payment-methods donut
- INS-018: Out of scope — Phase 2 - Day-of-month heatmap
- INS-019: Out of scope — Phase 2 - Fixed vs variable bars
- INS-020: Epic 7 - Needs/Wants/Savings view
- INS-021: Out of scope — Phase 2 - Month-end forecast band
- INS-022: Out of scope — Phase 2 - Subscription timeline
- INS-023: Out of scope — Phase 2 - Transaction frequency histogram
- INS-024: Out of scope — Phase 2 - Year-on-year comparison
- INS-025: Epic 7 - Savings-goal progress rings
- IMP-001: Epic 9 - CSV file read with encoding/delimiter detection
- IMP-002: Epic 9 - Preview and column mapping; transfer-pair proposals
- IMP-003: Epic 9 - Pre-commit validation; ambiguous rows to review
- IMP-004: Epic 9 - Ledger matching per FIN-027 with occurrence index
- IMP-005: Epic 9 - Atomic resumable batch commit; idempotent re-import
- IMP-006: Epic 9 - Raw file retention policy
- IMP-007: Epic 9 - Transaction and account summary CSV export
- IMP-008: Out of scope — Phase 2 - PDF reports
- OCR-001: Epic 10 - Receipt attach via picker/camera; compressed copy
- OCR-002: Epic 10 - Bundled on-device OCR, offline from install
- OCR-003: Epic 10 - Line grouping and multi-column detection
- OCR-004: Epic 10 - Field and line-item extraction with uncertainty
- OCR-005: Epic 10 - Correctable fields, Not itemised row, pro-rata allocation
- OCR-006: Epic 10 - Offer attach to probable match first
- OCR-007: Epic 10 - Manual fallback on parse failure; Latin script scope
- OCR-008: Epic 10 - Progress, cancel, p95 ≤ 5 s
- OCR-009: Epic 10 - OCR entry points
- OCR-010: Epic 10 - Probable-match prompt: Attach / Keep separate / Discard
- OCR-011: Epic 10 - Unmatched receipt saved confirmed with Paid-with chip
- OCR-012: Epic 10 - Per-item categories via splits
- OCR-013: Epic 10 - "Snap receipt to split" from capture notifications
- OCR-014: Epic 10 - "Reading receipt…" progress screen
- SMS-001: Epic 13 - SMS only in Play-approved sms build
- SMS-002: Epic 13 - Contextual SMS disclosure
- SMS-003: Epic 13 - SMS field extraction
- SMS-004: Epic 13 - On-device processing; raw bodies never stored
- SMS-005: Epic 13 - SMS reconciliation against ledger
- SMS-006: Epic 13 - Notification quick-classification and alert rates
- SMS-007: Epic 13 - Honest OEM background diagnostics
- SMS-008: Epic 13 - App fully functional without SMS
- SMS-009: Epic 13 - Synthetic fixtures only
- SMS-010: Epic 13 - Verified-sender parsing and DLT normalization
- SMS-011: Epic 13 - Scam flagging for non-verified senders
- SMS-012: Epic 13 - Balance-chain mismatch detection
- SMS-013: Epic 13 - Not a transaction · Block sender
- SMS-014: Epic 13 - SCR-24 explainer and limited re-ask
- SMS-015: Epic 13 - No SMS UI in no-SMS build or non-India profiles
- SMS-016: Epic 13 - Play SMS declaration timeline and GATE-02 outcomes
- SMS-017: Epic 13 - New-sender prompt for unlisted DLT headers
- SET-001: Epic 1 - Appearance settings (theme, number format, text, motion)
- SET-002: Epic 1 - Finance settings (region/currency lock, timezone, payday, period)
- SET-003: Epic 6 (bill reminders before budgets, overflow, Story 6.5), Epic 11 - Per-type notification settings and caps
- SET-004: Epic 8 - Data settings: backup/restore, export, storage, wipe
- SET-005: Epic 5 (hide amounts, Story 5.3), Epic 8 - Privacy settings: app lock, blur, hide amounts
- SET-006: Epic 8 - Local diagnostics with consented sanitised export
- SET-007: Epic 14 - Offline help, glossary, "how totals are calculated"
- BKP-001: Epic 8 - Encrypted passphrase-protected backup file
- BKP-002: Epic 8 - Restore preview, confirmation, safety snapshot, atomic commit
- BKP-003: Epic 8 - Bad passphrase/corrupt file never overwrites data
- BKP-004: Epic 8 - No unencrypted temp artifacts
- BKP-005: Epic 8 - Transactional versioned migrations; old backups migrate
- BKP-006: Epic 8 - OS cloud/device backup excluded
- BKP-007: Epic 8 - User-initiated external export with privacy explanation
- SEC-001: Epic 1 - Encrypted-at-rest storage with device keys (SMS catch-up part delivered in Epic 13)
- SEC-002: Epic 1 (release permission allowlist, Story 1.1), Epic 8; also Epics 10, 13 (no-INTERNET OCR, nosms exclusion), verified Epic 14 - No INTERNET permission in release; no telemetry SDKs
- SEC-003: Epic 8 - Minimum permissions with rationale and graceful denial
- SEC-004: Epic 8 - Biometric/OS app lock with resume timeout
- SEC-005: Epic 8 - App-switcher hiding and hidden notification form
- SEC-006: Epic 8 - Import/restore file validation; formula escaping
- SEC-007: Epic 8 - Redacted logs and crash diagnostics
- SEC-008: Epic 8 - Data deletion scope and warnings
- SEC-009: Epic 14 - Consent, disclosures and store labels match build
- CAP-001: Epic 11 - Capture notification with Approve/Reject (full form)
- CAP-002: Epic 11 - Capture sheet in dialog-styled activity
- CAP-003: Epic 11 - History-ordered category grid in capture dialog
- CAP-004: Epic 11 - Credit capture types
- CAP-005: Epic 11 - Grouped notification and swipe cards with Apply to all similar
- CAP-006: Epic 11 - Opt-in lock-screen Approve/Reject
- CAP-007: Epic 11 - Auto-approve eligibility and evening summary
- CAP-008: Epic 11 - Rejected captures behind Show rejected for 90 days
- CAP-009: Epic 11 - Unknown-mask new account prompt
- CAP-010: Epic 11 - Moved-from-own-account transfer linking
- CAP-011: Epic 6 (shared BillMatchPrompt, Story 6.3), Epic 11 - Bill-rule match offer in capture flow
- CAP-012: Epic 11 - Debit transfer-like choices and auto-linking
- LRN-001: Epic 11 - Merchant category learning
- LRN-002: Epic 11 - Payee UPI ID learning key
- LRN-003: Epic 11 - Mixed-merchant detection
- LRN-004: Epic 11 - Receipt item category learning
- LRN-005: Epic 11 - Remember for this merchant + learned mappings list
- LRN-006: Epic 11 - On-device learning included in backups
- LRN-007: Epic 11 - Payment-account learning per merchant/category
- LRN-008: Epic 11 - Only user actions teach
- LRN-009: Epic 11 - Merchant key normalization
- LRN-010: Epic 11 - Credit type learning per payer
- UPI-001: Epic 12 - UPI share target and per-app success-screen parsers
- UPI-002: Epic 12 - UPI field extraction
- UPI-003: Epic 12 - UPI result in capture dialog with Paid from chip
- UPI-004: Epic 12 - Non-UPI image falls back to receipt OCR
- UPI-005: Epic 9 (CSV row matching an existing UPI reference, Story 9.3), Epic 12 - UPI reference as strongest duplicate key
- UPI-006: Epic 12 - Locked share queued until unlock
- UPI-007: Epic 12 - Screenshots not kept unless attached
- UPI-008: Epic 12 - UPI capture confirmed only by user Save

**NFR → Epic(s)** (Epic 14 holds the release-level verification for all NFRs; the epics below build to them):

- NFR-01 (Airplane Mode): Epic 1 (offline by construction), every epic; verified Epic 14
- NFR-02 (no outbound data): Epic 1 (CI permission allowlist), Epic 8, Epic 13 (S7 nosms exclusion); verified Epic 14
- NFR-03 (navigation < 300 ms): Epic 1, Epic 5; verified Epic 14
- NFR-04 (Save p95 < 500 ms): Epic 1; verified Epic 14
- NFR-05 (Home p95 2 s warm): Epic 5; verified Epic 14
- NFR-06 (60 FPS, no UI-thread work): Epic 1, Epic 7, Epic 10; verified Epic 14
- NFR-07 (10k-row scrolling, search p95 < 500 ms): Epic 3; verified Epic 14
- NFR-08 (OCR p95 ≤ 5 s): Epic 10; verified Epic 14
- NFR-09 (atomic mutations, 0 invariant violations): Epic 1 (writer + property suite), Epics 2, 3
- NFR-10 (encrypted at rest; backups need passphrase): Epic 1, Epic 8
- NFR-11 (TalkBack, 200% font, AA contrast, 48 dp): Epic 1 (shared a11y builders), every UI epic; audited Epic 14
- NFR-12 (crash-consistent import/backup/migration): Epic 8, Epic 9
- NFR-13 (parity and market matrices): Epic 14
- NFR-14 (zero recurring server costs): Epic 1 (architecture), Epic 14
- NFR-15 (no telemetry): Epic 8; verified Epic 14
- NFR-16 (SMS → notification latency): Epic 13
- NFR-17 (parsing accuracy): Epic 10 (receipts), Epic 12 (UPI), Epic 13 (SMS, scam filter)
- NFR-18 (capture battery/CPU budget): Epic 13
- NFR-19 (glass 60 FPS + fallback): Epic 1; verified Epic 14
- NFR-20 (splash ≤ 1 s, ends on DB ready): Epic 1; verified Epic 14
- RB0-1..RB0-9, RB1-1, RB1-2 (release blockers): Epic 14 (evidence), built into the epics owning each behaviour
- GATE-01..GATE-13 (GATE-11 Phase 2): Epic 14 (evidence collection); GATE-02 also Epic 13, GATE-03 Epic 1 (S8), GATE-05 Epic 10 (S3), GATE-06/GATE-12 Epic 1, GATE-07 Epics 2–3 (finance fixtures, Stories 2.1, 3.8), GATE-04 Epics 1 and 8 (Stories 1.2, 1.6, 8.6)

**Architecture spikes → Epic**

- S1 Storage/migrations (op-sqlite + SQLCipher + Drizzle, Metro/pnpm): Epic 1
- S2 Initial schema: Epic 1
- S3 OCR engine (GATE-05): Epic 10
- S4 SMS latency (NFR-16): Epic 13
- S5 Capture dialog open time: Epic 11
- S6 Widget library: Epic 11
- S7 nosms bundle exclusion: Epic 13
- S8 Reference devices (GATE-03): Epic 1

Starter scaffold, ports, LedgerWriter/outbox/event catalogue, CI pipeline and permission-allowlist/encrypted-DB checks: Epic 1. SubmitCapture pipeline (AD-6), tombstones and PurgeExpired: Epic 3. Backup/restore (AD-10) and safe mode (AD-19): Epic 8. WriteAutoApprovals, Notifier, widget snapshot (AD-12/13): Epic 11. SMS receiver/catch-up (AD-11): Epic 13.

**UX-DR → Epic(s)**

- UX-DR1–UX-DR16 (tokens, theming, type, spacing, icons, brand assets): Epic 1
- UX-DR17–UX-DR21 (buttons, ＋ button, glass tab bar, navigation rail, screen header): Epic 1
- UX-DR22–UX-DR24 (Home band, hero card, hero bar): Epic 5
- UX-DR25 (limit bar): Epic 4
- UX-DR26 (card and Home cards): Epic 5
- UX-DR27 (KPI tile, Free to use figure): Epic 6
- UX-DR28–UX-DR30 (Activity row, category icon chip, day header): Epic 1 (basic list of saved entries), extended in Epic 3
- UX-DR31 (status tag pill): Epic 3
- UX-DR32 (chip family): Epic 1
- UX-DR33–UX-DR34 (filter chip row, filter sheet): Epic 3
- UX-DR35–UX-DR38 (segmented control, keypad, Add sheet, bottom sheet base): Epic 1
- UX-DR39–UX-DR44 (capture sheet, swipe cards, category grid, Apply to all similar, Remember toggle, auto-approve line): Epic 11 (UX-DR39 bill-match prompt variant first built in Epic 6, Story 6.3)
- UX-DR45–UX-DR46 (checkbox row, selection mode): Epic 3
- UX-DR47–UX-DR52 (toast with Undo, one-time tooltip, tab long-press label, empty state, inline error, skeleton): Epic 1
- UX-DR53 (coin-flip long-task loader): Epic 9 (first long task), reused Epic 10 (OCR scan-line variant)
- UX-DR54 (amount mask): Epic 5
- UX-DR55–UX-DR56 (widgets 4×1 and 4×2): Epic 11
- UX-DR57 (CSV stepper): Epic 9
- UX-DR58 (setup card): Epic 6
- UX-DR59 (split editor): Epic 3
- UX-DR60 (Settings hub and group rows): Epic 1
- UX-DR61 (Home card editor): Epic 5
- UX-DR62 (learned merchants list): Epic 11 (Blocked senders section Epic 13)
- UX-DR63–UX-DR64 (restore confirmation, passphrase field): Epic 8
- UX-DR65 (charts and View as table): Epic 5 (Home charts), Epic 7
- UX-DR66 (receipt OCR review): Epic 10
- UX-DR67 (region/currency picker): Epic 1
- UX-DR68 (per-screen state coverage): Epic 1 (pattern), every UI epic
- UX-DR69 (permission-denied / just-in-time): Epic 4 (first just-in-time notification request, Story 4.9 budget alerts), Epic 6 (bill reminder ask, Story 6.5), Epics 10, 13
- UX-DR70 (unknown / not-set values): Epic 1, Epic 2
- UX-DR71 (confirmation tiers): Epic 3
- UX-DR72 (read-only safe mode): Epic 8
- UX-DR73 (success and relief moments): Epic 3
- UX-DR74 (global hide-amounts): Epic 5
- UX-DR75 (app lock, LockGate, app-switcher privacy): Epic 8
- UX-DR76–UX-DR78 (capture notifications full/hidden, evening summary): Epic 11
- UX-DR79 (budget threshold and bill reminder notifications): Epic 4 (thresholds), Epic 6 (bill reminders)
- UX-DR80 (UPI share target): Epic 12
- UX-DR81 (SMS explainer and re-ask): Epic 13
- UX-DR82 (capture status vocabulary): Epic 3
- UX-DR83 (Diagnostics with OEM help): Epic 8 (OEM background help Epic 13)
- UX-DR84–UX-DR93 (accessibility floor): Epic 1 (shared builders and primitives), applied in every UI epic; audited Epic 14
- UX-DR94 (chart accessibility): Epic 5, Epic 7
- UX-DR95–UX-DR100 (responsive, navigation, motion, banned patterns, direction copy, microcopy catalogue): Epic 1
- UX-DR101 (overspent hero): Epic 5
- UX-DR102–UX-DR107 (light glass, button gradient, no accent themes, palette-only colour, N/W/S dark, Phosphor icons): Epic 1
- UX-DR108 (Free to use single next step): Epic 6
- UX-DR109 (evening summary format): Epic 11
- UX-DR110–UX-DR111 (restore copy/checkbox, hidden notification text): Epic 8
- UX-DR112 (no tablet two-pane): Epic 1
- UX-DR113–UX-DR114 (capture bottom sheet, learned merchants under Capture): Epic 11
- UX-DR115 (refund-net day header Spent): Epic 3

## Epic List

### Epic 1: Private setup and first expense

Users install wmbugo, read the privacy promise, confirm their region and currency, optionally add one account, and record their first expense, income or transfer in about six seconds, fully offline, with everything encrypted on the phone.

**FRs covered:** FIN-001, FIN-002, FIN-003, FIN-010, FIN-020, FIN-021, LIR-07, LIR-10, LIR-11, ONB-001, ONB-002, ONB-003, ONB-004, ONB-005, ONB-007, ACC-001, TXN-001, TXN-002, TXN-003, TXN-004, SET-001, SET-002, SEC-001

**Notes:**
- Story 1 is the starter scaffold (RN CLI 0.88.x, New Architecture, Hermes, TS strict, pnpm hoisted workspace, `packages/core` + `apps/mobile`, `nosms`/`sms` flavors, CI with lint/typecheck/core tests/release build, permission allowlist and encrypted-DB checks).
- Foundation: core primitives and ports (Money, Result, UUID v7, Clock, Logger, KeyStore, Storage/UnitOfWork, FileStore), fast-check property suite written first, encrypted storage + migrations, LedgerWriter + audit + outbox + event catalogue, ledger and profile (period service) modules, query layer.
- Spikes S1 (storage/migrations), S2 (initial schema), S8 (reference devices, GATE-03).
- SEC-001 here covers encryption at rest and keys; its SMS catch-up part ships in Epic 13.
- UX-DR highlights: all tokens and theming (DR1–16, DR102–107, DR112), tab shell, ＋ button, rail, header, Add sheet, keypad, chips, toast, tooltip, empty/error/skeleton patterns, Settings hub, region picker (DR67), accessibility floor builders (DR84–93), microcopy catalogue (DR100).
- Home in this epic is a minimal shell (balance or "balance not configured"); the full Home arrives in Epic 5.

### Epic 2: Accounts and moving money

Users manage all their accounts (bank, cash, wallet, savings pots, credit cards), set and correct opening balances, see what they have versus what they owe, and move money between accounts, including paying a card bill, without it ever counting as spending.

**FRs covered:** FIN-011, FIN-012, FIN-013, FIN-015, FIN-016, LIR-01, LIR-08, ACC-002, ACC-003, ACC-004, ACC-005, ACC-006, ACC-007, ACC-008, ACC-009

**Notes:**
- Depends on Epic 1 (ledger, writer, Add sheet Transfer form).
- Card balance sign convention per AD-5 (negative while owed; "Card dues" shows the negation); GATE-07 finance review fixtures start here.
- UX-DR70 ("+1 account not set", "balance not set").

### Epic 3: Activity: find, fix and check

Users browse, search and filter everything they have recorded, edit, split, delete, restore or reverse entries, handle refunds and reimbursements, and work through a single "N to check" review queue that catches duplicates and foreign-currency items.

**FRs covered:** FIN-014, FIN-022, FIN-023, FIN-024, FIN-027, FIN-028, LIR-02, LIR-06, LIR-09, TXN-005, TXN-006, TXN-007, TXN-008, TXN-009, TXN-010, TXN-011, TXN-012, TXN-013

**Notes:**
- Builds the shared `SubmitCapture` pipeline (AD-6: parse → normalize → match per FIN-027 → classify → ledger), tombstones, `PurgeExpired` and Recently deleted; manual entry is its first source. Epics 9–13 reuse it unchanged.
- Depends on Epics 1–2.
- UX-DR highlights: status tags and capture status vocabulary (DR31, DR82), filter chips and sheet (DR33–34), selection mode (DR45–46), split editor (DR59), confirmation tiers (DR71), relief moments (DR73), refund-net day header (DR115). NFR-07 list performance.

### Epic 4: Categories and budgets

Users shape their categories with Needs/Wants types and set budgets for any period, including payday cycles and a one-tap 50/30/20 split, and get a gentle alert as they approach or pass a limit.

**FRs covered:** ONB-006, CAT-001, CAT-002, CAT-003, CAT-004, CAT-005, CAT-006, BDG-001, BDG-002, BDG-003, BDG-004, BDG-005, BDG-006, BDG-007, BDG-009

**Notes:**
- Depends on Epics 1–3; planning module (budget, budget_period, budget_alert_fired) and the profile period service.
- CAT-005: suggestion override and learning-from-corrections hooks here (learning itself in Epic 11); the rule editor SCR-25 is Phase 2. BDG-005 rollover is Future.
- UX-DR25 limit bar; UX-DR79 budget threshold notifications (first Notifier use); UX-DR69 first just-in-time notification permission ask (Story 4.9).

### Epic 5: Home: "Am I okay?"

Users open the app and see at a glance whether they are okay this period (Left in budget, In accounts, Card dues, things to check, top categories and the last 7 days) on a Home screen they can rearrange and hide amounts on with one tap.

**FRs covered:** HOM-001, HOM-002, HOM-003, HOM-004, HOM-005, HOM-006, HOM-008

**Notes:**
- Hero shows "Left in budget" once Epic 4 exists, otherwise "Spent this period"; Card dues from Epic 2; "N to check" from Epic 3.
- UX-DR highlights: Home band, hero card and bar (DR22–24), Home cards (DR26), amount mask and global hide amounts (DR54, DR74), Home card editor (DR61), first charts (DR65, DR94), overspent hero deviation (DR101). NFR-05 Home warm start.

### Epic 6: Plan: bills, goals, Free to use

Users list their bills and subscriptions with reminders, set savings goals by setting money aside or moving it into a pot, and see an honest "Free to use" estimate on Plan.

**FRs covered:** BDG-008, REC-001, REC-002, REC-003, REC-004, REC-006, REC-008, REC-009, REC-010, GOAL-001, GOAL-002, GOAL-003, GOAL-004

**Notes:**
- Depends on Epics 2 (pots, included assets) and 4 (Left in budget); REC-009 bill linking is exercised once a capture source exists (Epic 11 CAP-011).
- REC-005 and REC-007 are Phase 2 (manual kind only in P1).
- UX-DR highlights: KPI tile / Free to use figure (DR27), setup card (DR58), Free-to-use single next step (DR108), bill reminder notifications (DR79), bill reminder notification ask (DR69; the first notification ask is Story 4.9 in Epic 4).

### Epic 7: Insights

Users understand where their money went, whether spending is rising, who got it and whether they are on track, through accessible charts with tables and drill-down to the exact transactions.

**FRs covered:** INS-001, INS-002, INS-003, INS-004, INS-005, INS-006, INS-007, INS-010, INS-011, INS-012, INS-013, INS-014, INS-015, INS-016, INS-020, INS-025

**Notes:**
- Read-only `insights` module; depends on Epics 1–4 and 6 (goal rings).
- INS-017..019 and INS-021..024 are Phase 2.
- UX-DR65 charts with View as table, UX-DR94 chart accessibility.

### Epic 8: Privacy, security and backup

Users lock the app, keep amounts hidden from the switcher and lock screen, make an encrypted backup with a passphrase, restore it safely on this or a new phone, and manage or erase their data, while the app provably sends nothing anywhere.

**FRs covered:** ONB-008, SET-004, SET-005, SET-006, BKP-001, BKP-002, BKP-003, BKP-004, BKP-005, BKP-006, BKP-007, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008

**Notes:**
- AD-10 backup format (Argon2id + XChaCha20-Poly1305), `RestoreBackup` maintenance mode, AD-19 safe mode, redacting Logger and local crash capture, Diagnostics export with consent.
- Depends on Epics 1–3; restore must also carry capture state added later (sms_cursor, learned mappings), re-verified in Epic 14.
- UX-DR highlights: restore confirmation and passphrase field (DR63–64, DR110), safe mode (DR72), app lock / LockGate (DR75), Diagnostics (DR83), hidden notification text (DR111).

### Epic 9: CSV import and export

Users bring in their bank or card history from a CSV file through a guided wizard without duplicates, and export their transactions and account summaries to CSV.

**FRs covered:** LIR-03, IMP-001, IMP-002, IMP-003, IMP-004, IMP-005, IMP-006, IMP-007

**Notes:**
- `ImportCsvBatch` on the Epic 3 capture pipeline; batches ≤ 500 rows, resumable, idempotent.
- Outside India this is one of the capture sources that unlocks Epic 11.
- IMP-008 PDF reports is Phase 2.
- UX-DR57 stepper, UX-DR53 coin-flip long-task loader (first use).

### Epic 10: Receipt scanning

Users snap or pick a receipt and get merchant, date, total and line items read on the phone, offline, then split it into categories or attach it to an existing entry without double counting.

**FRs covered:** LIR-04, OCR-001, OCR-002, OCR-003, OCR-004, OCR-005, OCR-006, OCR-007, OCR-008, OCR-009, OCR-010, OCR-011, OCR-012, OCR-013, OCR-014

**Notes:**
- Spike S3 OCR engine (ML Kit 16.0.1 bundled vs PaddleOCR/ONNX) closes GATE-05; OcrEngine port with parsing/allocation in core.
- Receipt submits through the Epic 3 pipeline; outside India it is a capture source for Epic 11.
- OCR-013 ("Snap receipt to split" from a capture notification) needs Epic 11 notifications.
- UX-DR66 OCR review screen, UX-DR53 scan-line variant. NFR-08, NFR-17 (receipts).

### Epic 11: Capture review, learning and widget

Users review automatic captures from a notification or a quick bottom sheet over any app, the app learns their categories and accounts per merchant and payer, eligible captures add themselves after the daily cutoff, and a home-screen widget gives one-tap Snap and Add.

**FRs covered:** FIN-025, FIN-026, LIR-05, HOM-007, SET-003, CAP-001, CAP-002, CAP-003, CAP-004, CAP-005, CAP-006, CAP-007, CAP-008, CAP-009, CAP-010, CAP-011, CAP-012, LRN-001, LRN-002, LRN-003, LRN-004, LRN-005, LRN-006, LRN-007, LRN-008, LRN-009, LRN-010

**Notes:**
- Needs a capture source: Epic 12/13 in India, Epics 9/10 elsewhere.
- `WriteAutoApprovals` (FIN-026 clock guard), learning taught only by user-actor events, Notifier full/hidden forms, evening summary, widget snapshot via outbox.
- Spikes S5 (capture dialog open time) and S6 (widget library).
- UX-DR highlights: capture sheet, swipe cards, category grid, Apply to all similar, Remember toggle, auto-approve line (DR39–44), widgets (DR55–56), learned merchants (DR62), capture notifications and evening summary (DR76–78, DR109), bottom-sheet deviation (DR113–114).

### Epic 12: UPI screenshot share (India)

Users in India share a GPay, PhonePe or Paytm success screenshot to wmbugo and get the payment recorded in one tap, with duplicates recognised by UPI reference.

**FRs covered:** UPI-001, UPI-002, UPI-003, UPI-004, UPI-005, UPI-006, UPI-007, UPI-008

**Notes:**
- Uses the Epic 3 pipeline and the Epic 11 capture sheet; locked shares stored as encrypted `pending_share` (AD-12).
- Module excluded from the `nosms` bundle where required (S7, AD-17).
- UX-DR80 share target. NFR-17 (UPI accuracy).

### Epic 13: Bank SMS capture (India, Play-gated)

Users in India who opt in have bank and card SMS turned into captures on the phone within seconds, with scam messages and unknown senders kept out, and the app stays fully usable if SMS access is denied or the build has none.

**FRs covered:** SMS-001, SMS-002, SMS-003, SMS-004, SMS-005, SMS-006, SMS-007, SMS-008, SMS-009, SMS-010, SMS-011, SMS-012, SMS-013, SMS-014, SMS-015, SMS-016, SMS-017

**Notes:**
- Ships only in the `sms` flavor per GATE-02 (Play declaration at M3); Kotlin receiver enqueues the catch-up job (AD-11) through `SubmitCapture`.
- Includes the SEC-001 SMS catch-up part (sms_cursor after first unlock, one-time 30-day backfill to review).
- Spikes S4 (SMS latency, NFR-16) and S7 (nosms bundle exclusion).
- UX-DR81 SMS explainer and re-ask; Blocked senders in UX-DR62; OEM help in UX-DR83. NFR-16, NFR-17 (SMS), NFR-18.

### Epic 14: Launch readiness

Users in every Phase 1 market get a release that has passed accessibility, performance, privacy and store-disclosure checks, with offline help explaining how totals are calculated.

**FRs covered:** SET-007, SEC-009

**Notes:**
- Accessibility audit (NFR-11, RB0-9), performance on the reference device matrix (NFR-03..08, 19, 20; RB1-1), airplane-mode Maestro suite on the release build (NFR-01, RB0-2), proxy audit (NFR-02), parity/market matrices (NFR-13).
- Store listings and privacy disclosures per market (GATE-08, RB0-5), SMS variant matches approval (RB0-4, RB0-7), backup/restore end-to-end incl. corruption (RB0-6), usability study (RB1-2, GATE-06), closed test (GATE-13), GATE-01..13 evidence (GATE-11 Phase 2).

### Out of scope — Phase 2

REC-005, REC-007, INS-017, INS-018, INS-019, INS-021, INS-022, INS-023, INS-024, IMP-008 (plus CAT-005's rule editor SCR-25, BDG-005 optional rollover, GATE-11).


## Epic 1: Private setup and first expense

Mei installs wmbugo, reads the privacy promise, confirms her region and currency, optionally adds one account, and records her first expense, income or transfer in about six seconds, fully offline, with everything encrypted on her phone. The epic also lays the foundations every later epic builds on: the starter workspace and CI gates, exact money and time primitives with their property suite, the encrypted database, the atomic writer with audit and outbox, and the design system, app shell and accessibility primitives.

### Story 1.1: Starter workspace, Android flavors and CI gates

As a developer,
I want the wmbugo repository initialised as a pnpm workspace with a pure-TypeScript core, a React Native app, both Android flavors and CI gates from day one,
So that every later story lands in the agreed structure and every push proves the app still builds offline-safe with no forbidden permissions.

**Acceptance Criteria:**

**Given** a fresh clone
**When** the developer runs `pnpm install`
**Then** dependencies install with `node-linker=hoisted` from a single `pnpm-lock.yaml`
**And** CI fails if a `package-lock.json` or `yarn.lock` exists anywhere in the repo.

**Given** the workspace
**When** it is inspected
**Then** it contains `packages/core` (pure TypeScript, TS strict, Jest in plain Node, no `react-native`, Drizzle or op-sqlite dependency) and `apps/mobile` (React Native CLI template 0.88.x, New Architecture on, Hermes on, TS strict) that depends on `core`, never the reverse
**And** the folder skeleton exists: `packages/core/src/{ports,usecases,writer,ledger,capture,learning,planning,insights,profile,backup,shared}` and `apps/mobile/src/{features,shared,adapters}`.

**Given** a file in `packages/core` that imports `react-native`, `drizzle-orm` or `@op-engineering/op-sqlite`
**When** lint and typecheck run
**Then** both fail with a boundary-rule error
**And** a `console.log` anywhere in shipped code (core or mobile `src`) fails lint.

**Given** the Android project
**When** it is built
**Then** applicationId is `app.wmbugo`, minSdk 26, targetSdk 36, compileSdk 36, and product flavors `nosms` and `sms` both assemble (`assembleNosmsRelease`, `assembleSmsRelease`)
**And** the manifest sets `android:allowBackup="false"` with data-extraction rules excluding all app data from cloud backup and device transfer.

**Given** a release build of either flavor
**When** the CI permission-allowlist check reads the merged manifest
**Then** it fails if `INTERNET`, `ACCESS_NETWORK_STATE` or any permission not on the allowlist is present (library-added permissions removed with `tools:node="remove"`)
**And** the debug build still declares `INTERNET` (Metro only), and no SMS permission appears in either flavor yet.

**Given** any push to GitHub
**When** the GitHub Actions workflow runs
**Then** it executes lint, typecheck, core tests, the nosms release build and the permission-allowlist check, and the run fails if any step fails
**And** a local pre-push hook runs the core tests and blocks the push on failure.

**Given** the mobile app installed on an emulator
**When** it launches
**Then** a placeholder screen renders with no network access required.

**Covers:** AD-2, AD-3 (skeleton), AD-9 (allowBackup), AD-17, AD-18, Conventions (pnpm, logging), NFR-02 (allowlist), NFR-14, SEC-002 (release permission check)

### Story 1.2: Spike S1 — Encrypted storage and migration toolchain

As a developer,
I want a time-boxed proof that op-sqlite with SQLCipher, Drizzle and bundled migrations work inside our pnpm hoisted workspace and Metro,
So that the storage adapter story is built on a confirmed toolchain or on a recorded fallback.

**Acceptance Criteria:**

**Given** a time box of 3 working days on a throwaway branch
**When** the spike ends
**Then** a decision record `docs/decisions/S1-storage-migrations.md` is committed to main stating, for each question, the verified answer or the chosen fallback
**And** spike code is not merged except configuration the record marks as confirmed.

**Given** op-sqlite 19.x in `apps/mobile`
**When** the SQLCipher flag is set in `apps/mobile/package.json` and a release build runs on an emulator
**Then** `PRAGMA cipher_version` returns a non-empty value and the record states the exact flag location that works with `node-linker=hoisted`.

**Given** Drizzle ORM and drizzle-kit 0.45.x (stable, not 1.0 RC)
**When** a sample schema is generated with drizzle-kit `driver: 'expo'` and its `.sql` files are loaded through Metro/Babel in a release build
**Then** the migration applies inside one transaction and a Drizzle insert/select round-trips through the op-sqlite driver
**And** the record lists the exact Metro/Babel configuration used.

**Given** Metro and the hoisted workspace
**When** `apps/mobile` imports a symbol from `packages/core`
**Then** the record confirms it bundles in debug and release, or records the AD-2 fallback (single app + lint boundary rule) and the follow-up change to Story 1.1's layout.

**Given** any question that could not be answered within the time box
**When** the record is written
**Then** it names the blocker, the fallback chosen and the stories it affects (Story 1.6 at minimum).

**Covers:** Spike S1, AD-8, AD-2 (fallback decision), GATE-04 (encrypted-DB library evidence)

### Story 1.3: Spike S8 — Reference devices and benchmark method

As a developer,
I want the reference devices and the benchmark method confirmed and written down,
So that every performance and glass-fallback acceptance criterion in this and later epics is measured on agreed hardware.

**Acceptance Criteria:**

**Given** a time box of 1 working day
**When** the spike ends
**Then** `docs/decisions/S8-reference-devices.md` lists each reference device (model, Android version and API level, SoC, RAM), confirming or replacing the assumption "developer's phone + one budget phone on Android 8–10"
**And** the product owner's GATE-03 sign-off is recorded in the file.

**Given** the confirmed devices
**When** the method section is written
**Then** it defines how NFR-03 (navigation median), NFR-04 (Save p95), NFR-05, NFR-06 and NFR-19 (frame rates, stalls), and NFR-20 (splash) are measured: build type (release), data set size, warm/cold start definition, tool, and number of runs.

**Given** the glass recipe needs a "device capability threshold" (UX-DR4)
**When** the spike ends
**Then** the record states the concrete threshold rule (e.g. API level, RAM or measured frame metric) that switches glass to `glass-fallback`, and which reference device falls on each side.

**Given** the device list is not confirmed within the time box
**When** the record is written
**Then** it states the interim devices used and that benchmark results are provisional until GATE-03 is signed.

**Covers:** Spike S8, GATE-03, AD-18, NFR-03, NFR-04, NFR-06, NFR-19, NFR-20 (measurement basis)

### Story 1.4: Exact money and time primitives with a property suite

As Mei,
I want every amount I type to be stored and shown exactly, in my currency's format, and every entry to stay on the day it happened,
So that I can trust wmbugo's numbers to the last cent.

**Acceptance Criteria:**

**Given** `packages/core/src/shared`
**When** the primitives are implemented
**Then** it exports `Money` (integer `amountMinor` + currency exponent, `Number.isSafeInteger` asserted at core boundaries), a typed `Result<T, Code>` with named codes, a UUID v7 generator, the `Clock` port (UTC epoch ms + profile timezone, fake implementation for tests) and the redacting `Logger` port
**And** core contains no `Date.now()` call (lint rule) and no floating-point money arithmetic.

**Given** the Phase 1 currency table (PRD §13.0a)
**When** a currency is looked up
**Then** its ISO 4217 exponent is returned from a stored table (e.g. INR 2, SGD 2, JPY 0, BHD/KWD/OMR 3) and IDR and HUF are stored as whole units (exponent 0)
**And** an unknown code returns `Result` error `CURRENCY_UNSUPPORTED`.

**Given** keypad input text and a currency exponent
**When** `parseAmountInput` runs
**Then** valid input returns the exact minor units (`12.50` SGD → 1250)
**And** more decimals than the exponent allows returns `EXCESS_DECIMALS` (never rounded), NaN/Infinity/empty returns `AMOUNT_INVALID`, a value beyond `Number.MAX_SAFE_INTEGER` minor units returns `AMOUNT_TOO_LARGE`, and a negative where a magnitude is expected returns `AMOUNT_NEGATIVE`.

**Given** the shared Intl-based formatter in `apps/mobile/src/shared`
**When** it formats amounts
**Then** INR uses lakh grouping (`₹1,18,60,000`), SGD shows `S$1,234.50`, EUR in de-DE shows `1.234,50 €`, JPY shows 0 minor digits and BHD 3
**And** it takes a magnitude plus a direction and never emits `-` or `−` for any input (property test over random safe integers).

**Given** the fast-check property suite in core
**When** it runs on every push
**Then** for every supported exponent and any safe-integer minor amount, store → format → parse returns the original value exactly (LIR-07)
**And** 10,000 random add/subtract edits on large values yield the exact integer sum with no drift (LIR-10), and any operation that would leave the safe-integer range returns `AMOUNT_TOO_LARGE` instead of a wrong number.

**Given** an instant and an IANA timezone
**When** `toLocalDate` runs
**Then** it returns `YYYY-MM-DD` in that zone
**And** a property test across DST transitions (e.g. Europe/London, America/Toronto) shows no instant is assigned to a neighbouring day, and a stored `local_date` is never recomputed from the UTC instant.

**Given** a log call containing an amount, account mask or note
**When** the `Logger` port writes it
**Then** those values are redacted before reaching any sink (unit test).

**Covers:** FIN-001, FIN-002 (time types), LIR-07, LIR-10, NFR-09, AD-5 (Money), AD-16 (Clock), AD-18 (property suite first), AD-19 (Logger port), UX-DR11 (formatter), UX-DR99 (no minus), Conventions (Money, Time, Errors, IDs)

### Story 1.5: Spike S2 — Initial schema and migration plan

As a developer,
I want the initial Drizzle schema designed from PRD §11.1 and the module ownership table, with a plan for which story migrates which tables,
So that tables are created only when a story needs them but always fit one reviewed design.

**Acceptance Criteria:**

**Given** a time box of 2 working days, the confirmed toolchain from Story 1.2 and the Money/time conventions from Story 1.4
**When** the spike ends
**Then** `docs/decisions/S2-initial-schema.md` lists every Phase 1 table with its owning module (AD-3), columns, types, keys, indexes and constraints
**And** the product owner's review (GATE-07 sign convention per AD-5) is recorded.

**Given** the schema design
**When** it is checked
**Then** every money column is `INTEGER` with a name ending `_minor`, no column uses `REAL`, every primary key is a UUID v7 string, instants are UTC epoch ms, `transaction` carries `local_date` (`YYYY-MM-DD`) and `timezone_id`, and `posting.signed_amount_minor` is positive into the account and negative out for every account type
**And** `category.budget_type` (need/want, nullable) is present from the first schema version (CAT-006).

**Given** the migration plan section
**When** it is read
**Then** it assigns each table to the first story that needs it (Epic 1: `schema_migration` 1.6; `audit_event`, `outbox` 1.7; `profile`, `settings`, `prompt_state` 1.11; `account`, `transaction`, `posting` 1.12; `category`, `split` 1.13) and states that later epics add their tables in their own numbered migrations.

**Given** a schema-lint test added to core CI
**When** any Drizzle schema file declares a `real` column or a money column without the `_minor` suffix
**Then** the test fails.

**Covers:** Spike S2, AD-3, AD-5, AD-8 (initial schema), FIN-001 (no float persistence)

### Story 1.6: Encrypted database opens on first launch

As Mei,
I want wmbugo to create an encrypted store on my phone the first time it opens, with no account or network,
So that my financial records are unreadable to anyone who takes my phone before I unlock it.

**Acceptance Criteria:**

**Given** a first launch
**When** the storage adapter starts
**Then** a random 256-bit database key is generated and stored through the `KeyStore` port (react-native-keychain / Android Keystore), available after first unlock since boot and not bound to biometrics
**And** the key is never logged, written to a file, backed up or exported (log and file-system inspection test).

**Given** the key
**When** op-sqlite opens the database with SQLCipher
**Then** the adapter checks `PRAGMA cipher_version` and refuses to continue if it is empty, showing an inline error screen ("wmbugo couldn't open its secure storage. Nothing was changed.") with no writes performed
**And** a CI encrypted-database check fails the build if the release database file header reads `SQLite format 3`.

**Given** bundled drizzle-kit migrations
**When** the database opens
**Then** pending migrations run forward-only inside one transaction after a safety copy of the file, each recorded in `schema_migration`
**And** a migration that throws rolls back fully, the safety copy is kept, and the database is left at its previous version (fault-injection test).

**Given** a cold start on a reference device (Story 1.3)
**When** the app launches
**Then** the splash ends when the key is loaded and the first query (does a profile exist?) returns, never on a timer, adding ≤ 1 s before the first screen
**And** the app routes to onboarding when no profile exists.

**Given** the device is in airplane mode from install
**When** the app is launched
**Then** it opens with no registration, phone number, email or network request.

**Given** the `Logger` port
**When** the file adapter is wired
**Then** logs go to a size-capped file in app-private storage and the `FileStore` port interface is declared in core (its adapter ships with the first stored file in a later epic).

**Covers:** SEC-001 (encryption at rest, device-protected key), NFR-10, NFR-20, NFR-01, ONB-001, AD-8, AD-9, AD-16, AD-18 (encrypted-DB check), AD-19, GATE-04 (key management evidence)

### Story 1.7: Atomic writer with audit trail, outbox and query cache

As Mei,
I want every change I make to be saved completely or not at all, and every screen to refresh from the saved data,
So that a crash or a killed app never leaves half an entry or a stale total.

**Acceptance Criteria:**

**Given** the `UnitOfWork` port and its op-sqlite adapter
**When** a named use case runs through `LedgerWriter`
**Then** it executes alone inside one `BEGIN IMMEDIATE` transaction, and concurrent requests queue and run one at a time in submission order.

**Given** a use case
**When** it commits
**Then** an `audit_event` row (use case, actor `user | auto | system`, entity ids, timestamp) and its catalogue events in `outbox` are written in the same transaction (tables created by this story's migration)
**And** before commit the writer asserts all amounts are safe integers and runs the registered invariant checks; a failing check returns `Result` error `INVARIANT_VIOLATED` and rolls back.

**Given** a use case that throws midway
**When** the writer handles it
**Then** no data, audit or outbox row from it remains (fault-injection test).

**Given** committed outbox events
**When** delivery runs after commit
**Then** each event is delivered at least once, handlers are idempotent on event id, and a handler that changes data runs as its own use case
**And** if the app is killed after commit but before delivery, the events are delivered on next start.

**Given** the event catalogue in core
**When** it is defined
**Then** it contains `TransactionsChanged` and `ProfileChanged` with their invalidated query areas, past-tense names and actor, and adding an event requires a catalogue entry (type-checked).

**Given** TanStack Query in `apps/mobile` (`networkMode: 'always'`) and Zustand for transient UI state
**When** an event is delivered
**Then** only the query keys mapped to that event are invalidated (unit test)
**And** Zustand stores hold no money, totals or persistent preferences (lint/review rule documented in `apps/mobile/src/shared`).

**Covers:** LIR-11, NFR-09, AD-4, AD-15, Event catalogue

### Story 1.8: Design tokens, theming and brand assets

As Mei,
I want wmbugo to look calm and consistent in light and dark mode and to work offline with its own fonts and icons,
So that the app feels trustworthy and readable from the first screen.

**Acceptance Criteria:**

**Given** the typed token module in `apps/mobile/src/shared`
**When** it is built
**Then** it exposes every DESIGN.md colour token with light and `-dark` values (core, semantic, `gradient.brand`, glass tint/border/fallback, glow, on-glass inks, N/W/S incl. dark variants, the 12 `cat-*` hues, `focus-ring`, `border-control`), the 4pt spacing scale, radii (sm 8, md 12, lg 16, full), elevation and motion tokens (150–250 ms)
**And** a unit test asserts every hex against DESIGN.md and a contrast test asserts the listed pairs (e.g. text-primary on canvas 17.06:1, accent on white 5.47:1) meet ≥ 4.5:1 text and ≥ 3:1 non-text.

**Given** the theme provider
**When** the theme is System, Light or Dark
**Then** all screens re-render without restart, System follows the OS setting live, and no accent-theme option exists
**And** a lint/grep check fails if a hex colour literal appears outside the token module.

**Given** the Glass surface component
**When** it renders
**Then** it uses tint `#164E63` at 80% (light) / 62% (dark, floor) with blur and 1px `#5EEAD4` @22% border
**And** it switches to `glass-fallback` / `glass-fallback-dark` with identical layout when API < 31, below the Story 1.3 capability threshold, battery saver is on, animator scale is 0 or reduce transparency is on; each trigger is verified on an emulator, and dark glow alpha is capped at ≤ 45% (asserted).

**Given** type styles
**When** text renders
**Then** bundled Inter 400/500/600 is used (no network fonts; airplane-mode render test), the 11 roles match DESIGN.md sizes in sp (tag 12sp floor), sentence case, and every money role applies `tnum`.

**Given** icons and brand assets
**When** the bundle is inspected
**Then** Phosphor is the only icon library (outline default, filled for selected), a lint rule rejects emoji code points in UI strings, and the coin mark, coin-flip Lottie (placeholder until GATE-12 final asset) with still pie face, and the paper-boat illustration with still frame are bundled.

**Given** the banned-patterns guard
**When** lint runs
**Then** it rejects `ActivityIndicator` in the main app, shadows other than the ＋ button token, numeric badge props, and the strings "Inbox" and "coming soon".

**Covers:** SET-001 (theme), NFR-19, UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6, UX-DR7, UX-DR8, UX-DR9, UX-DR10, UX-DR11, UX-DR12, UX-DR13, UX-DR14, UX-DR15, UX-DR16, UX-DR97, UX-DR98, UX-DR102, UX-DR103, UX-DR104, UX-DR105, UX-DR106, UX-DR107, GATE-06, GATE-12 (placeholder)

### Story 1.9: Shared controls and accessibility primitives

As Mei,
I want every button, chip and amount to be large enough to tap, readable at big text sizes and announced clearly by TalkBack,
So that I can use wmbugo comfortably however I set up my phone.

**Acceptance Criteria:**

**Given** the shared `<Amount>` component
**When** any screen renders money
**Then** it is the only way to render money (lint rule bans formatter calls in feature code), uses the Story 1.4 formatter with `tnum`, renders expenses unsigned, income with `+`, and never a minus sign
**And** display-amount, headline and keypad roles cap `maxFontSizeMultiplier` at 1.5 then auto-fit (min 28sp / 22sp), and `₹1,18,60,000` on an INR profile at 320dp × 200% are never ellipsised, clipped or wrapped mid-number.

**Given** the button set
**When** rendered
**Then** `button-primary` (deep segment #0F766E → #164E63, white label ≥ 5.47:1), `button-primary-disabled` (still focusable, announces "disabled" plus a reason hint), `button-secondary`, `button-secondary-on-footer` and `button-text` exist, each ≥ 48dp, with contrast tests per variant.

**Given** the chip family
**When** rendered
**Then** the base chip is 32dp visual with a 48dp hit area, 1px `border-control` unselected, selected = accent fill + filled icon, with TalkBack role and selected state; variants: quick-category, account, period and `Paid with` / `Paid from`.

**Given** the `FocusRing` wrapper
**When** any shared focusable control receives keyboard, D-pad or Switch Access focus
**Then** a 2dp ring with 2dp offset is visible, using `focus-ring-on-glass` on glass surfaces.

**Given** the accessibility-label builders in `apps/mobile/src/shared`
**When** they build labels
**Then** amounts read in full with direction ("Income, plus 85,000 rupees"), `~` reads "about", decorative icons are hidden, and every control exposes role and state (unit tests with exact strings from EXPERIENCE.md)
**And** a live-region helper provides polite and assertive announcements.

**Given** the component test suite
**When** it runs
**Then** an automated hit-rect audit fails any shared control under 48dp, a greyscale snapshot of each component keeps its meaning (never colour alone), and a `useReducedMotion` hook honours both animator scale 0 and the in-app setting.

**Given** the string catalogue
**When** feature code needs copy
**Then** it reads keys from one catalogue honouring PRD §6.7 and the Voice table (sentence case, no guilt copy), and snapshot tests reference catalogue keys.

**Covers:** NFR-11, UX-DR9, UX-DR11, UX-DR17, UX-DR32, UX-DR84, UX-DR86, UX-DR87, UX-DR88, UX-DR89, UX-DR90, UX-DR91, UX-DR93, UX-DR99, UX-DR100

### Story 1.10: App shell, navigation and feedback patterns

As Mei,
I want a clear tab bar with an always-visible ＋ and consistent loading, empty, error and confirmation feedback,
So that I always know where I am and that my data is safe.

**Acceptance Criteria:**

**Given** the root navigator
**When** the app starts with a profile
**Then** it shows bottom tabs Home · Activity · ＋ · Insights · Plan with per-tab stacks, no drawer, and tab state preserved across switches; Insights and Plan show only their screen header until their epics land (no "coming soon" text)
**And** median tab navigation on a reference device is < 300 ms.

**Given** the glass tab bar below 600dp width
**When** it renders
**Then** inactive tabs show outline icons in `on-glass-secondary`, the active tab a filled `on-glass-accent` icon and Medium label, slots ≥ 64×56dp, labels 12/16sp capped at 1.3× then auto-fit (min 12sp, never dropped), no numeric badges, and long-pressing a tab shows its label in a tooltip
**And** at ≥ 600dp an 80dp solid navigation rail replaces it with ＋ at the top and content centred at max 600dp, with no two-pane layout (layout tests at 320, 430, 599, 600, 840dp).

**Given** the ＋ button
**When** rendered
**Then** it is a 56dp full-gradient 135° circle with the app's only shadow, centred in the tab bar, never covering navigation or accessibility controls, labelled "Add entry" for TalkBack
**And** tapping it opens the bottom sheet host (the Add sheet content arrives in Story 1.13).

**Given** the screen header
**When** a tab renders
**Then** it shows screen actions, then the Accounts icon and avatar (→ Settings); at fontScale ≥ 1.3 or overflow it splits into two rows with the title wrapping, never truncated, at 320dp × 200%.

**Given** the bottom sheet base
**When** a sheet opens
**Then** it has a glass body, grabber, scrim `#0F172A99`, solid sticky footer, traps focus, returns focus to the opener on close, dismisses by swipe, Back or scrim, and opening a second sheet replaces the first instead of stacking.

**Given** the feedback components
**When** used by any screen
**Then** the toast shows one at a time above the tab bar with Undo, stays ≥ 10 s (`getRecommendedTimeoutMillis(10000, FLAG_CONTENT_CONTROLS)`), pauses on touch/focus and persists under TalkBack, announcing politely ("Saved. Undo available")
**And** the one-time tooltip shows at most one per session, never over an open sheet, with a 48dp `Got it`, whose "seen" state is persisted through an injected store (wired to `prompt_state` in Story 1.14); the empty state (boat + one sentence + one primary button), the inline `ErrorBlock` (cause + "Nothing was saved" + Retry + alternative path, focus to first invalid field, assertive once) and the skeleton (no spinners, values fade in 150–250 ms) exist with snapshot tests.

**Given** the per-screen state checklist
**When** a screen story is done
**Then** its Definition of Done includes the PRD §6.4 state set (no offline state shown), documented in `apps/mobile/src/shared/STATES.md`.

**Covers:** HOM-006, NFR-03, NFR-06, UX-DR18, UX-DR19, UX-DR20, UX-DR21, UX-DR38, UX-DR47, UX-DR48, UX-DR49, UX-DR50, UX-DR51, UX-DR52, UX-DR68, UX-DR85, UX-DR92, UX-DR95, UX-DR96, UX-DR112

### Story 1.11: Onboarding — privacy welcome, region and currency, payday

As Mei,
I want to start without signing up, see the privacy promise, confirm my region and currency and say when I'm paid,
So that wmbugo formats my money correctly and measures my periods my way from the first screen.

**Acceptance Criteria:**

**Given** a fresh install with no profile
**When** the app opens
**Then** SCR-01 Welcome shows the three facts in one line (no sign-up, no internet, no bank login) and a primary Continue button, with no tutorial.

**Given** a device whose region is Singapore
**When** SCR-02 opens
**Then** it shows `Singapore · S$ SGD` pre-selected with the live preview `Amounts look like S$1,234.50` from the shared formatter, and Continue confirms in one tap
**And** for a device region of India with language English (US), `India · ₹ INR` is pre-selected and must still be confirmed.

**Given** SCR-02
**When** Mei taps `Change`
**Then** a searchable list (country name or currency code) opens with the detected region pinned at the top, and the preview updates live on selection
**And** a calm note says currency is fixed once entries exist; if the device region is not a Phase 1 market, nothing is pre-selected and Continue stays disabled with a hint until a region is chosen.

**Given** the payday step
**When** Mei picks a chip (1st / Last day / Last working day / Other / Not salaried)
**Then** `Other` asks for a day 1–31, and the default period becomes the pay cycle (or calendar month for Not salaried).

**Given** the optional `Try 50/30/20?` step
**When** Mei answers Yes (entering a rough monthly income) or Not now
**Then** the answer is stored in `prompt_state` for the budgets epic, no budget is created here, and the step is skippable.

**Given** all steps are answered
**When** Mei finishes
**Then** the `SetUpProfile` use case writes `profile` (region ISO code, currency code, stored exponent, locale, device timezone, payday rule) and `settings` (theme = System) in one transaction (the `profile`, `settings` and `prompt_state` tables are created by this story's migration), emits `ProfileChanged`, and Home opens
**And** nothing is written before the last step; Back at any step keeps earlier answers; process death before finishing restarts at Welcome with no profile.

**Given** onboarding is run with a permission-request spy
**When** it completes
**Then** zero permission prompts were requested (SMS, camera, photos, notifications)
**And** a moderated run of the steps in airplane mode completes in under 2 minutes.

**Covers:** ONB-001, ONB-002, ONB-004, FIN-001 (stored exponent), FIN-002 (profile timezone), SET-002 (region/currency, payday), UX-DR67, UX-DR100 (copy)

### Story 1.12: First account and the accounts list

As Mei,
I want to add the account where most of my money is, roughly, or skip it, and later add, rename, reorder and archive accounts,
So that wmbugo knows where my money sits without demanding precision or more than one account up front.

**Acceptance Criteria:**

**Given** onboarding after the region step
**When** SCR-03 "Where's most of your money?" shows
**Then** Mei can pick a type (cash, bank, payment wallet, savings pot, credit card), enter a name, an approximate balance today with the hint `Rough is fine`, or tap Skip; only one account is ever asked for, and the flow continues to payday.

**Given** Mei enters a bank account "DBS" with balance S$3,200
**When** onboarding finishes
**Then** one transaction writes the `account` row (UUID v7, type, name, type-default icon and `cat-*` colour: cash→lime, bank→indigo, wallet→sky, savings pot→emerald, card→fuchsia, profile currency, opening effective at now, status active) and an `opening_balance` transaction with one posting of +320000 minor units (tables `account`, `transaction`, `posting` created by this story's migration)
**And** the `transaction` stores id, event type, status confirmed, amount, UTC instant, `local_date`, timezone, created/updated timestamps, and the event-type enum accepts expense, income, transfer, opening_balance, adjustment, refund and reversal.

**Given** a credit-card account with S$450 owed entered
**When** it is saved
**Then** its opening posting is −45000 (negative while owed, AD-5) and it is never added to asset totals.

**Given** Mei skips the account step, or enters no balance
**When** the account state is read
**Then** no account exists (skip) or the account is stored with `balance_not_set` and no opening posting, and presenters return "not set", never zero.

**Given** the Accounts icon in any tab header
**When** Mei opens the accounts list
**Then** active accounts show icon, name, type and either the ledger-derived balance (opening + postings) or `balance not set`, in her sort order
**And** she can add an account (same form), rename it, reorder with `Move up` / `Move down` (also as TalkBack custom actions), and archive it; archived accounts are hidden from pickers but keep their history.

**Given** an account name that is empty
**When** Mei saves
**Then** inline error `Error: name required` keeps her input and moves focus to the field; nothing is written.

**Covers:** ONB-002 (account step), ONB-003, ONB-007, ACC-001, FIN-003, FIN-010, FIN-020, FIN-021 (opening/liability signs), AD-5, UX-DR8 (account colours), UX-DR70

### Story 1.13: Add sheet — record a first expense in about six seconds

As Mei,
I want to tap ＋, type an amount, tap a category and save,
So that recording a coffee takes seconds and I can undo a mistake immediately.

**Acceptance Criteria:**

**Given** Mei taps ＋
**When** the Add sheet opens
**Then** it shows the segmented control (Expense selected, Income, Transfer) above quick-category chips, account chip, amount and keypad, with the keypad focused; Snap receipt and Share from UPI chips are absent in this build (never shown as disabled or "coming soon"); CSV import is not on the sheet.

**Given** the keypad
**When** Mei types `12.50` on an SGD profile
**Then** the amount reads `S$12.50` as a polite live region ("12 point 50 dollars"); keys are ≥ 56dp, labelled `1`…`0`, `decimal point`, `Delete`; long-press Delete and the visible `Clear` both clear; the decimal key follows locale and is hidden for 0-exponent currencies; a third decimal is blocked, never rounded; hardware number keys and Backspace work.

**Given** the quick-category chips
**When** the sheet opens
**Then** they list expense categories by use count (seed order for a new profile), recalculated at most once a day and never reordered while the sheet is open; `More` opens the full list
**And** the `category` and `split` tables are created by this story's migration with the seeded expense categories (Food & Drinks, Groceries, Transport, Housing, Bills & Utilities, Shopping, Healthcare, Entertainment, Education, Travel, Personal Care, Family, Other, Uncategorised) and income categories (Salary, Freelance, From people, Gifts, Interest, Refunds), each with its DESIGN.md `cat-*` colour and seeded need/want type.

**Given** Mei taps `Food & Drinks`
**When** the account chip fills
**Then** it defaults to the account last used with that category, else the most recently used account, else her only account
**And** when no account exists it defaults to `Cash`, which is created with `balance not set` in the same save.

**Given** amount and category are set
**When** Mei taps Save (bottom-right)
**Then** `RecordManualEntry` writes one confirmed expense transaction (UTC instant, capture timezone, fixed `local_date`), one negative posting on the account and one split equal to the amount, with audit and `TransactionsChanged`, in one transaction, p95 < 500 ms on the reference device
**And** the sheet closes and the toast reads `Saved · Undo`; Undo marks the entry removed (`removal_kind = deleted`, excluded from all totals) with an audit row.

**Given** optional details
**When** Mei expands them
**Then** she can set merchant, date/time (default now), note and payment method before saving.

**Given** Mei taps `Save & add another`
**When** the save commits
**Then** the sheet stays open with the amount cleared and type kept, and a new toast replaces the previous one.

**Given** the amount is empty or zero
**When** Mei taps Save
**Then** inline error `Error: amount required` keeps all other input, focus moves to the amount, and nothing is written.

**Given** Mei dismisses the sheet with input (swipe, Back or scrim)
**When** she reopens ＋
**Then** amount, type and category are restored from an in-memory draft (Zustand only, never persisted, gone after process death); Save or `Clear` discards it.

**As built (reconciled after Epic 1, accepted deviations):** the spoken amount uses the currency's full name ("12 point 50 Singapore dollars"); the merchant is stored as text in `transaction.original_description` until the merchant table exists in the learning epic; Date and time are two typed fields (`YYYY-MM-DD`, `HH:MM`) until a picker library is chosen, and are sent only when edited; the Save row is a fixed bar under the scrolling sheet so Save is always on screen; the third segment (Transfer) is delivered by Story 1.15.

**Covers:** TXN-001, TXN-002, FIN-001, FIN-002, FIN-020, FIN-021, NFR-04, UX-DR32, UX-DR35, UX-DR36, UX-DR37, UX-DR47, UX-DR93, FLOW-02, CAT-001 (seed data), CAT-006 (type column)

### Story 1.14: Home shell and Activity list of saved entries

As Mei,
I want Home to tell me honestly what I've spent this period and what's in my accounts, and Activity to list my entries by day,
So that I can see my first expense reflected straight away.

**Acceptance Criteria:**

**Given** the profile period service in core
**When** it converts a `local_date` to a period
**Then** it supports calendar month and pay cycle (1st, last day, last working day Mon–Fri, day N falling on the last day of shorter months) in the profile timezone, and a property test proves every `local_date` belongs to exactly one period.

**Given** Home with no budget
**When** it renders
**Then** the header shows a greeting and today's date, and the summary card shows `Spent this period` = confirmed expenses − refunds in the current period by `local_date`, floored at zero, with the period scope label, from a core query (no "Set a limit" link until budgets exist)
**And** a confirmed S$12.50 expense saved from the Add sheet appears without restart (via `TransactionsChanged` invalidation).

**Given** the accounts line
**When** Home renders
**Then** it shows `In accounts` (included asset accounts with a balance) and `Card dues` side by side, never summed, stacking at fontScale ≥ 1.3
**And** with no account it reads `Set up an account to calculate your balance` with the action to add one; with an account whose balance is not set, the total adds `+1 account not set`; it never shows zero for an unknown.

**Given** Mei's first Home view
**When** Home appears
**Then** one tooltip anchored to `In accounts` reads "This is money in accounts you've added" with `Got it`, recorded in `prompt_state` and never shown again; tips never insert data.

**Given** Activity with entries
**When** it renders
**Then** rows are grouped under day headers (`Today · Sat 7 Nov`, `Yesterday · Fri 6 Nov`, `Thu 5 Nov`) with right-aligned `Spent S$X` from the read model (confirmed expenses − refunds that day, floored at 0; transfers, income and removed entries excluded)
**And** each row shows the 40dp category icon chip, merchant (or category name), `Category · Account`, and the amount: expenses unsigned in `text-primary`, income `+` in `semantic-income`, transfers with the transfer icon unsigned neutral; no minus sign anywhere.

**Given** TalkBack
**When** Mei explores Activity
**Then** each row reads merchant → amount with direction → category → account → date, day headers are headings ("Thursday 5 November, spent 12 dollars 50 cents"), and at fontScale ≥ 1.3 the amount stacks under the title and the day header stacks.

**Given** Activity with no entries, or Home while loading
**When** it renders
**Then** Activity shows the boat empty state with one sentence and an `Add an expense` button opening the Add sheet, and Home shows skeletons until values fade in.

**As built (reconciled after Epic 1, accepted deviations):** the one-time tip is a card directly under the accounts line (not an arrow popover); Card dues shows only when a card with a known balance exists, so a missing card is never shown as zero; Activity loads 100 entries at a time with a "Show earlier entries" button.

**Covers:** ONB-003, ONB-005, AD-7, HOM-006, UX-DR28, UX-DR29, UX-DR30, UX-DR48, UX-DR50, UX-DR52, UX-DR70, UX-DR86, UX-DR99, FLOW-01 (Home climax), FLOW-02 (climax)

### Story 1.15: Record income and transfers between accounts

As Mei,
I want to record money coming in and money I move between my own accounts from the same Add sheet,
So that my accounts stay right and moving money never looks like spending.

**Acceptance Criteria:**

**Given** the Add sheet with `12.50` typed
**When** Mei switches the segmented control to Income
**Then** the amount is kept, quick chips show income categories, the account chip becomes the destination account, and TalkBack reads the radiogroup "Entry type" with "2 of 3"; at fontScale ≥ 1.3 the control is a vertical radio list.

**Given** an income of S$4,200 to DBS in Salary with an optional note
**When** Mei saves
**Then** one confirmed `income` transaction with a +420000 posting on DBS and a Salary split is written atomically, the toast reads `Saved · Undo`, and Activity shows `+S$4,200` in the income colour, excluded from the day's `Spent`.

**Given** Mei switches to Transfer
**When** the form updates
**Then** categories give way to From → To account pickers, the amount is kept, and TalkBack announces "Transfer selected. From and To accounts shown"; if fewer than two accounts exist, the To picker offers `+ New account`.

**Given** From = DBS, To = Cash, S$200, date/time (default now)
**When** Mei saves
**Then** one `transfer` transaction with postings −20000 on DBS and +20000 on Cash is written, the writer's invariant check asserts the owned-asset postings sum to zero, and it counts as neither income nor expense (Home `Spent this period` unchanged)
**And** Activity shows one transfer row with the transfer icon, unsigned and neutral.

**Given** an optional fee of S$2
**When** the transfer is saved
**Then** the fee is saved in the same commit as a separate confirmed expense from the From account (category chosen, default Other), and only the fee changes `Spent this period`.

**Given** From and To are the same account
**When** Mei saves
**Then** inline error "Choose two different accounts" (code `SAME_ACCOUNT`) keeps the input and nothing is written.

**Given** the amount exceeds the From account's ledger balance
**When** Mei saves with strict balance checking off (default)
**Then** a non-blocking warning states the possible mismatch and the save proceeds on confirm
**And** with `Block transfers above the balance` turned on in Settings › You it is blocked with code `INSUFFICIENT_FUNDS` and the input kept.

**Covers:** TXN-003, TXN-004, FIN-003, FIN-021, LIR-11, UX-DR35, UX-DR37, UX-DR99, FLOW-03, FLOW-04

### Story 1.16: Settings hub with appearance and finance settings

As Mei,
I want to change my theme, number display, motion, payday, period and timezone later, and know when my currency can no longer change,
So that wmbugo keeps fitting how I live without redoing setup.

**Acceptance Criteria:**

**Given** the avatar in any tab header
**When** Mei opens Settings (SCR-21)
**Then** it lists group rows only for groups whose features exist in this build (You in this epic), each with a live one-line summary that is part of its label (e.g. `Payday 1st · Dark`), updating immediately after a change.

**Given** Settings › You › Appearance
**When** Mei changes theme (System / Light / Dark, teal only), number format, haptics or Reduce motion
**Then** the change applies app-wide without restart, the number-format choice is previewed through the shared formatter (`Amounts look like S$1,234.50`), text scaling follows the system setting within the Story 1.9 caps, and Reduce motion switches sheets/toasts to ≤ 150 ms fades and still brand frames.

**Given** Settings › You › Money basics with no transactions recorded
**When** Mei changes region and currency
**Then** the change is saved via `ChangeProfile`, the stored exponent updates, and `ProfileChanged` refreshes every screen.

**Given** at least one transaction exists
**When** Mei tries to change currency
**Then** the change is blocked with the explanation that currency is fixed once entries exist and that another currency needs an export and a new profile; nothing changes.

**Given** Mei changes payday, default period, first day of week or default account
**When** she goes back to Home
**Then** `Spent this period` is recomputed for the new period with no transaction modified (audit shows only a profile change).

**Given** the device timezone differs from the profile timezone by ≥ 2 hours for more than 24 hours (Clock port)
**When** Mei opens the app
**Then** she is asked once, e.g. "You're in Dubai time — use it for your budget days?"; Yes switches the profile timezone from the next day only, No keeps it; the prompt is recorded in `prompt_state` and not repeated
**And** existing transactions keep their `local_date`, and Mei can change the timezone manually in Settings › You.

**Given** Settings › You
**When** Mei turns on `Block transfers above the balance`
**Then** the setting persists across restarts and the transfer form enforces it.

**As built (reconciled after Epic 1, accepted deviations):** Haptics is a stored choice that takes effect when haptic feedback is introduced (nothing vibrates today); First day of the week is stored for the calendar and weekly views that arrive later; any saved amount, including an onboarding opening balance, locks the currency; Reduce motion is applied to sheets and toasts through the shared hook.

**Covers:** SET-001, SET-002, FIN-002 (timezone prompt), ONB-006 (period change, no mutation), AD-7, UX-DR1, UX-DR60, UX-DR91, UX-DR104


## Epic 2: Accounts and moving money

Ravi, Arjun and Priya can see every account they keep (bank, cash, wallet, savings pots and credit cards) split honestly into money they have and money they owe, set or correct a starting balance without rewriting history, look at one account's own timeline, and move money between their accounts, including paying a card bill or putting money into a savings pot, without it ever counting as spending. The epic builds the balance read model and its finance fixtures (GATE-07) that Home, Plan and Insights reuse later.

### Story 2.1: Account balance read model and finance fixtures

As Ravi,
I want every balance, card due and total in wmbugo to be worked out the same way from what I recorded,
So that the figure on Home, in the accounts list and on an account's own page always agree and a card bill never looks like cash I have.

**Acceptance Criteria:**

**Given** the `core.ledger` balance query
**When** it computes an asset account's balance
**Then** the result is the opening-balance posting + adjustment postings + every confirmed, non-removed posting whose effective instant is at or after the account's opening instant, in integer minor units
**And** postings on transactions with status `needs_review`, `excluded` or removed (`removal_kind` set) are ignored.

**Given** a credit-card account (AD-5: balance negative while owed)
**When** the query computes it
**Then** it returns `outstanding_minor` = the negation of the card's ledger balance (opening dues + charges − payments − credits), e.g. opening dues −45000 plus a −20000 charge returns outstanding 65000
**And** a card balance is never returned inside any asset figure, and a card whose ledger balance is above zero returns `in_credit_minor` instead of a negative outstanding.

**Given** a posting dated before its account's opening instant (FIN-016)
**When** balances are computed
**Then** that posting does not change the account's balance, and the query marks the transaction `before_tracking_started = true` for that account (derived on read, never stored)
**And** the transaction still counts in `Spent this period` if it is an expense, because only the balance ignores it.

**Given** this story's migration
**When** it runs
**Then** `account` gains `include_in_totals` (boolean, default true = counted), so every existing and new account counts in totals until the user turns it off (toggle in Story 2.2).

**Given** the overview totals query
**When** it runs
**Then** it returns `in_accounts_minor` = sum of balances of active asset accounts with `include_in_totals` true that have a balance that have a balance (FIN-012), `card_dues_minor` = sum of outstanding on active cards that have a balance, `not_set_count` for assets and for cards separately, and `net_worth_minor` = `in_accounts_minor` − `card_dues_minor`
**And** a credit limit is never added to any figure, and `in_accounts_minor` and `card_dues_minor` are never summed except into `net_worth_minor`.

**Given** an account with `balance_not_set` and no opening posting
**When** any presenter formats it
**Then** it returns the `not set` state, never zero (unit tests on presenters with null inputs: `balance not set`, `+1 account not set`, `+2 accounts not set`, `+1 card not set`).

**Given** the event catalogue
**When** this story lands
**Then** it adds `AccountsChanged` (account created, renamed, reordered, archived, restored, deleted or its settings changed) mapped to the accounts-list, account-detail and Home accounts-line query keys, and Home's accounts line from Story 1.14 now reads from this query (including `include_in_totals` from this story's migration, default counted).

**Given** the fast-check property suite from Story 1.4
**When** it generates random sequences of openings, expenses, incomes, transfers (with and without fees), card charges and card payments across 1–6 accounts
**Then** every account balance equals opening + its applicable postings, every internal transfer's postings sum to exactly 0 excluding the separately recorded fee expense (LIR-01), and no transfer changes the period's income or expense totals (FIN-013).

**Given** the GATE-07 finance fixtures in `packages/core/test/fixtures/finance`
**When** core tests run
**Then** worked examples exist and pass for: bank opening ₹30,000 then adjust to ₹31,200; card ₹8,200 due paid from HDFC; S$200 bank-to-cash transfer with S$2 fee; ₹5,000 into a savings pot; an expense dated before the opening instant
**And** each fixture lists expected balances, `In accounts`, `Card dues`, `Spent this period` and income for the period, for the finance reviewer to sign off.

**Covers:** FIN-011, FIN-012, FIN-013, FIN-016, LIR-01, NFR-09, AD-5, GATE-07, UX-DR70, Event catalogue

### Story 2.2: Accounts list with "Money you have" and "Money you owe"

As Ravi,
I want my accounts list to show what I have and what I owe as two separate groups, with the choice to leave an account out of my totals,
So that a card bill never hides inside my cash and a shared or locked-away account doesn't inflate what I think I can use.

**Acceptance Criteria:**

**Given** Ravi has Cash ₹2,300, HDFC ₹31,200, SBI ₹18,800 and an HDFC Card with ₹4,100 owed
**When** he opens the Accounts icon in any tab header (SCR-06)
**Then** the list shows a `Money you have` group (Cash, HDFC, SBI) with its total `₹52,300` and a `Money you owe` group (HDFC Card `You owe ₹4,100`) with its total `₹4,100`
**And** the two totals are never added together, every amount is unsigned with no minus sign, and the order within each group is his saved order from Story 1.12.

**Given** an asset account with `balance not set`
**When** the list renders
**Then** that row reads `balance not set` and the group total reads `₹52,300 · +1 account not set`; with only not-set accounts the total reads `Not set yet`, never `₹0`.

**Given** an asset account whose ledger balance is below zero (e.g. Cash after more spending than recorded)
**When** it renders
**Then** the row reads `Below zero ₹500` in `text-primary` (never red, never a minus sign) and the group total includes it as a reduction; if the group total itself is below zero it reads `Below zero ₹X`.

**Given** an asset account's edit screen
**When** Ravi turns off `Count in my totals`
**Then** `SetAccountInclusion` saves `include_in_totals` (column from Story 2.1) with audit and `AccountsChanged`, the row shows the label `Not counted in totals`, the group total and Home `In accounts` drop by its balance, and the group total gains the caption `Excludes 1 account`
**And** credit cards do not show the toggle (they always count in `Card dues`).

**Given** the list footer
**When** Ravi turns on `Show net worth` (off by default, stored in `settings`)
**Then** a separate row below both groups reads `Net worth ₹48,200` with the caption `What you have minus what you owe`, using only counted accounts
**And** if what he owes is larger it reads `Net worth: you owe ₹X more than you have`; turning it off removes the row and nothing else changes.

**Given** a card whose outstanding was never entered (`balance not set`)
**When** the list and Home render
**Then** the card row reads `balance not set` and `Card dues` adds `+1 card not set`.

**Given** TalkBack
**When** Ravi explores the list
**Then** group headers are headings that read their total (`Money you have, 52,300 rupees, 1 account not set`), rows read name → type → amount with direction (`HDFC Card, credit card, you owe 4,100 rupees`), the toggle reads `Count in my totals, switch, on`, and rows still offer `Move up` / `Move down` custom actions
**And** at fontScale ≥ 1.3 amounts stack under the account name with no truncation at 320dp × 200%.

**Given** no accounts, loading, or a query error
**When** the list renders
**Then** it shows the boat empty state with `Add an account`, skeleton rows while loading, or the inline `ErrorBlock` with Retry, per the PRD §6.4 state set.

**Covers:** ACC-005, ACC-006, FIN-011, FIN-012, UX-DR68, UX-DR70, UX-DR86, UX-DR99

### Story 2.3: Account detail and its timeline

As Ravi,
I want to open one account and see its balance and every entry that touched it, including each side of my transfers,
So that I can check that account against my passbook or wallet.

**Acceptance Criteria:**

**Given** Ravi taps HDFC in the accounts list
**When** account detail opens
**Then** the header shows the account icon in its colour, name, type and the balance in `headline` (`₹31,200`, or `balance not set`), equal to the Story 2.1 query value
**And** below it are the actions available for this account type (`Move money`, `Adjust balance` and `Edit` for assets; card actions arrive in Stories 2.6 and 2.7).

**Given** HDFC has expenses, income, a transfer to Cash and its opening balance
**When** the timeline renders
**Then** entries touching HDFC are grouped by day (newest first) using the Activity row component, the transfer shows as one leg titled `To Cash` with the transfer icon, unsigned and neutral, and the matching Cash detail shows `From HDFC`
**And** the last row is `Starting balance ₹30,000 · 1 Nov` with no income styling; rows are not tappable in this epic (transaction detail arrives in Epic 3).

**Given** a ₹300 expense dated 5 Nov on Cash, whose opening instant is 7 Nov 10:00
**When** the Cash timeline and Activity render
**Then** the row's subtitle ends with `· Before tracking started`, the Cash balance is unchanged by it, and it still counts in that day's `Spent`
**And** TalkBack appends `before tracking started` after the account name.

**Given** an account with more than 200 entries
**When** Ravi scrolls the timeline
**Then** it pages from the query layer without blocking the UI thread, as the Activity list does.

**Given** account detail
**When** Ravi taps `Move money`
**Then** the Add sheet opens as Transfer with From = this account and the amount empty, and saving behaves exactly as in Story 1.15 (same-account error, mismatch warning, strict blocking if on)
**And** after save, both account details show their leg and both balances update without restart.

**Given** an account with no entries yet
**When** detail opens
**Then** the timeline shows one sentence (`Nothing recorded on this account yet`) and an `Add an expense` button opening the Add sheet with this account pre-selected.

**Covers:** ACC-002 (timeline), FIN-013, FIN-016, LIR-01, FLOW-04 (account legs), UX-DR28, UX-DR68, UX-DR70, UX-DR86

### Story 2.4: Starting balance and tracking date

As Ravi,
I want to give an account its balance later if I skipped it, and choose from which day wmbugo starts tracking it,
So that an account created with `balance not set`, like the Cash wmbugo made for me, can become accurate without retyping old entries.

**Acceptance Criteria:**

**Given** the auto-created Cash with `balance not set`, opened at 7 Nov 10:00, with ₹450 of later expenses
**When** Ravi taps `Set balance` on its detail and enters `What's in it today?` ₹1,550
**Then** `SetStartingBalance` writes one `opening_balance` transaction with one posting (`posting_kind = opening_balance`) effective at the account's opening instant for ₹2,000, so today's balance reads ₹1,550, with audit and `AccountsChanged` in one transaction
**And** `balance not set` and its `+1 account not set` caption disappear from the list and Home.

**Given** an account that already has a starting balance
**When** Ravi views its detail
**Then** `Set balance` is not offered; the starting balance row is read-only with the hint `To correct it, use Adjust balance`, and no use case edits an existing opening amount.

**Given** `Edit` › `Tracking since` on an account
**When** Ravi picks an earlier date (1 Nov)
**Then** `ChangeTrackingDate` moves the account's opening instant to the start of that day in the profile timezone, entries from 1 Nov onwards now count in its balance and lose the `Before tracking started` mark, the opening amount is unchanged, and an audit row records old and new dates
**And** a date in the future is rejected with inline error `Error: choose today or an earlier date`.

**Given** any automatic process (capture, import, migration)
**When** it runs
**Then** it never moves an account's opening instant; only `ChangeTrackingDate` from a user action does (unit test on the use case registry).

**Given** a card created with no amount owed entered
**When** Ravi taps `Set amount owed` and enters ₹4,100
**Then** the opening posting is −410000 per AD-5, and `Card dues` includes ₹4,100.

**Given** the keypad shows an empty or invalid amount
**When** Ravi taps Save
**Then** inline error `Error: amount required` keeps the input and nothing is written; ₹0 is a valid starting balance and is saved as one.

**Given** income and expense queries
**When** they run over a period containing an opening balance
**Then** opening balances are excluded from income, expense and `Spent this period`, and Activity does not list them as income (LIR-08).

**Covers:** ACC-002 (opening balance and date), FIN-015, FIN-016, LIR-08, ONB-003 (later set-up), UX-DR70

### Story 2.5: Adjust balance with a reason

As Ravi,
I want to tell wmbugo what an account really holds today and have the difference recorded as a correction with a reason,
So that my rough starting balance gets fixed without pretending I earned or spent the difference.

**Acceptance Criteria:**

**Given** HDFC with a ₹30,000 rough starting balance and a ledger balance of ₹30,000
**When** Ravi taps `Adjust balance`, enters `Actual balance today` ₹31,200, picks reason `Starting balance was rough` and saves
**Then** `AdjustBalance` writes one `adjustment` transaction dated now with one posting (`posting_kind = adjustment`) of +120000 on HDFC and the reason, with audit and `AccountsChanged`
**And** the original opening posting is unchanged (assert), HDFC reads ₹31,200, and the toast reads `Balance adjusted · Undo`.

**Given** the reason field
**When** the sheet opens
**Then** it offers chips `Starting balance was rough`, `Missed some entries`, `Bank charges or interest`, `Other`; `Other` asks for a short note; a reason is required and Save without one shows inline error `Error: reason required`.

**Given** Ravi enters the same amount as the current balance
**When** he saves
**Then** the sheet shows `Already matches. Nothing to adjust.` and nothing is written.

**Given** Cash reads ₹2,300 and Ravi counts ₹1,900
**When** he adjusts
**Then** the posting is −40000, the sheet preview reads `Adjust down by ₹400` before saving (no minus sign), and `Spent this period` and income are unchanged.

**Given** a card owing ₹4,100 whose statement says ₹4,350
**When** Ravi uses `Adjust balance` and enters `Amount you owe today` ₹4,350
**Then** the posting is −25000 on the card and `Card dues` reads ₹4,350.

**Given** an adjustment exists
**When** Activity and the account timeline render
**Then** the row is titled `Balance adjustment`, subtitle `Adjusted up · HDFC` or `Adjusted down · Cash`, amount unsigned in neutral `text-primary` (never the income or expense colour), excluded from the day's `Spent`, and TalkBack reads `Balance adjustment, up 1,200 rupees, HDFC`
**And** income, expense and cash-flow queries exclude adjustments (LIR-08 unit test).

**Given** an account with `balance not set`
**When** its detail opens
**Then** `Adjust balance` is replaced by `Set balance` (Story 2.4).

**Covers:** ACC-002 (reconciliation adjustment), ACC-008, FIN-015, LIR-08, UX-DR36, UX-DR47, UX-DR99

### Story 2.6: Credit card details: outstanding, statement due and limit

As Arjun,
I want my card page to show what I owe from my own entries, plus the statement amount, due date and limit I copy from my statement,
So that I know what to pay and when without wmbugo pretending to be connected to my bank.

**Acceptance Criteria:**

**Given** Arjun's HDFC Card with ₹12,450 outstanding from the ledger
**When** its detail opens
**Then** the header reads `You owe ₹12,450` with the caption `From your entries in wmbugo`, and the actions are `Pay card bill`, `Adjust balance` and `Edit`.

**Given** `Edit` › `Card details`
**When** Arjun enters `Statement due` ₹8,200, `Due date` 15 Nov and `Limit` ₹1,00,000 (each optional)
**Then** `UpdateCardDetails` stores them on the card (columns added by this story's migration) with audit and `AccountsChanged`
**And** the sheet states `You enter these from your statement. wmbugo isn't connected to your bank.`

**Given** statement details are set
**When** the card detail renders
**Then** it shows `Statement due ₹8,200 · by 15 Nov` and `Limit ₹1,00,000` as separate lines below the outstanding
**And** the limit never appears in `In accounts`, `Money you have`, net worth or any available-money figure (unit test on the totals query).

**Given** payments to the card recorded after the statement was entered add up to at least the statement due
**When** the card detail renders
**Then** the statement line reads `Statement paid · ₹8,200` and it stays until Arjun edits or clears it.

**Given** the due date has passed and the statement is not paid
**When** the card detail renders
**Then** the line reads `Statement due ₹8,200 · was due 15 Nov` in `text-primary` with a warning icon, never red text alone.

**Given** the card's ledger balance is above zero (overpaid)
**When** list and detail render
**Then** it reads `In credit ₹500` in the `Money you owe` group, adds nothing to `Card dues` and nothing to `Money you have`.

**Given** Home's accounts line
**When** it renders
**Then** `Card dues` is always the sum of outstanding, never the statement due amount.

**Given** a statement due or limit field
**When** Arjun enters zero or clears it
**Then** clearing removes the value; a zero limit is rejected with `Error: enter a limit or leave it empty`.

**Covers:** ACC-003, FIN-011, FIN-012, AD-5, UX-DR70, UX-DR86

### Story 2.7: Pay card bill

As Arjun,
I want a `Pay card bill` button on my card that opens a ready-filled transfer,
So that paying my card takes two taps and never counts as spending twice.

**Acceptance Criteria:**

**Given** HDFC Card with statement due ₹8,200 (unpaid) and outstanding ₹12,450
**When** Arjun taps `Pay card bill` on the card detail or its row in `Money you owe`
**Then** the Add sheet opens as Transfer with To = HDFC Card (locked), amount ₹8,200, and From = the asset account last used to pay this card, else the default account from Settings, else the most recently used active asset account
**And** with no statement due entered, or once it reads `Statement paid`, the amount is the outstanding ₹12,450.

**Given** From = HDFC ₹31,200
**When** Arjun saves
**Then** one `transfer` transaction is written with postings −820000 on HDFC and +820000 on the card, the writer invariant confirms they sum to 0, `Card dues` falls by ₹8,200, HDFC falls by ₹8,200, `Spent this period` is unchanged, and income is unchanged
**And** Activity shows one transfer row `HDFC → HDFC Card`, unsigned and neutral, and the toast reads `Saved · Undo`.

**Given** Arjun edits the amount to ₹15,000 (above the outstanding)
**When** he saves
**Then** a non-blocking note reads `This is more than you owe. The extra shows as credit on the card.` and the save proceeds on confirm.

**Given** the amount exceeds HDFC's ledger balance
**When** he saves
**Then** the Story 1.15 behaviour applies: a mismatch warning (default) or `INSUFFICIENT_FUNDS` blocking when `Block transfers above the balance` is on.

**Given** the card shows `You owe ₹0` and no statement due
**When** Arjun taps `Pay card bill`
**Then** the sheet opens with the amount empty and the hint `Nothing owed on this card right now`.

**Given** Arjun has no active asset account
**When** he taps `Pay card bill`
**Then** the From picker offers `+ New account`, and nothing is saved until From is set (`Error: choose where the money came from`).

**Given** Arjun's everyday HDFC "Savings Account" is a bank account, not a savings pot
**When** he pays the card bill from it
**Then** nothing is counted as money saved (Story 2.8 query unchanged).

**Covers:** ACC-007, FIN-013, FIN-021, LIR-01, FLOW-17, FLOW-04, UX-DR37

### Story 2.8: Savings pots

As Arjun,
I want to keep my SIP, RD, PPF or emergency fund as savings pots that I move money into, with or without a known balance,
So that money I put aside shows up as saved, not spent, and never as cash I can use unless I want it to.

**Acceptance Criteria:**

**Given** the account type picker (add or edit)
**When** Arjun selects `Savings pot`
**Then** the hint reads `For SIPs, RDs, PPF or an emergency fund. Not your everyday bank account, even if the bank calls it a savings account.`, the balance field is optional with `Leave empty if the value changes with the market`, and the default colour is `cat-emerald`.

**Given** pot "SIP – Axis MF" with no balance and pot "Emergency fund" with ₹40,000
**When** the accounts list renders
**Then** `Emergency fund` sits in `Money you have` and counts in `In accounts` unless `Count in my totals` is off
**And** `SIP – Axis MF` shows under a `Saved & invested` sub-heading inside `Money you have` as `₹5,000 moved in`, is not counted in `In accounts` and does not add `+1 account not set`.

**Given** Arjun transfers ₹5,000 from HDFC to `SIP – Axis MF` (Add sheet Transfer or `Move money`)
**When** he saves
**Then** it is one balanced `transfer`, `Spent this period` and income are unchanged, and the pot's `moved in` total rises by ₹5,000
**And** the core query `savingsMovedIn(period)` returns ₹5,000 for the period (transfers into pots from non-pot accounts minus transfers out of pots to non-pot accounts; pot-to-pot moves count zero), ready for the 50/30/20 Savings share in Epic 4.

**Given** a transfer from HDFC to Cash, or a card bill paid from HDFC
**When** `savingsMovedIn` runs
**Then** it is unchanged, because neither account is a pot.

**Given** Arjun withdraws ₹2,000 from `Emergency fund` to HDFC
**When** he saves
**Then** the pot balance drops by ₹2,000 and `savingsMovedIn` for the period falls by ₹2,000; when the net for a period is below zero the query returns it exactly, and any display of it floors at `₹0`, never showing a minus sign.

**Given** an account's edit screen
**When** Arjun changes its type
**Then** asset types (cash, bank, wallet, savings pot) can be switched with audit and `AccountsChanged`, while switching between an asset type and credit card is blocked once entries exist with `This account has entries. Add a new card instead.`

**Given** TalkBack
**When** a pot row without a balance is read
**Then** it reads `SIP – Axis MF, savings pot, 5,000 rupees moved in, not counted in your totals`.

**Covers:** ACC-009, ACC-005, FIN-012, FIN-013, LIR-01, UX-DR8, UX-DR70

### Story 2.9: Archive, restore and delete accounts safely

As Ravi,
I want a clear warning before I archive an account that still holds money or has something pending, and a way to bring it back,
So that closing my old SBI account never loses history or quietly changes my totals.

**Acceptance Criteria:**

**Given** SBI with a ₹1,200 balance
**When** Ravi taps `Archive` on its detail
**Then** a confirmation reads `SBI still has ₹1,200. Archiving keeps its history but stops counting it in your totals.` with `Adjust balance first` (opens Story 2.5's sheet) and `Archive anyway`
**And** for a card the text reads `You still owe ₹4,100 on HDFC Card. …`; an account at zero shows a plain `Archive SBI?` confirmation.

**Given** an entry touching the account has status `needs_review`
**When** Ravi archives it
**Then** the confirmation adds `1 entry on this account is waiting for you.` and archiving leaves that entry untouched (it stays in its queue).

**Given** Ravi confirms
**When** `ArchiveAccount` runs
**Then** the account's status becomes archived with audit and `AccountsChanged`, it leaves pickers, both groups and `In accounts` / `Card dues`, and its past entries stay in Activity and in every period total exactly as before
**And** if it was the default account in Settings › You, the default falls back to `None` and the Add sheet uses its normal defaulting.

**Given** archived accounts exist
**When** the accounts list renders
**Then** a collapsed `Archived (1)` row at the bottom opens them read-only with their final balance and timeline, and `Restore` returns one to active in its previous group and position.

**Given** an account with no transactions or postings at all (e.g. created by mistake)
**When** Ravi opens its `Edit`
**Then** `Delete account` is offered and, after `Delete SBI? This can't be undone.`, removes it with an audit row.

**Given** an account with any posting, including an opening balance
**When** Ravi opens its `Edit`
**Then** `Delete account` is absent and the hint reads `Accounts with entries can't be deleted. Archive keeps their history.`; `DeleteAccount` called directly returns `ACCOUNT_HAS_POSTINGS` and writes nothing (unit test).

**Given** an archived account is the remembered account for a category
**When** Ravi picks that category in the Add sheet
**Then** the account chip skips the archived account and uses the next default from Story 1.13.

**Covers:** ACC-004, FIN-015, UX-DR68, UX-DR86


## Epic 3: Activity: find, fix and check

Ravi, Priya and Mei can find any entry they have recorded, open it, and fix it: edit, split, recategorise in bulk, record a refund, reimbursement or failed payment, delete it and get it back. One review queue holds everything that still needs a decision: possible duplicates, foreign-currency items and pending captures. The epic adds the shared `SubmitCapture` pipeline (AD-6) with the FIN-027 duplicate rules, and manual entry becomes its first source; Epics 9–13 reuse it unchanged. It also adds tombstones, `PurgeExpired` and the Recently deleted / Show rejected recovery paths.

### Story 3.1: Duplicate matching rules in core

As Priya,
I want wmbugo to recognise the same payment reported twice, and never merge two real payments into one,
So that my spending is counted once however many ways a payment reaches the app.

**Acceptance Criteria:**

**Given** the `core.capture` matcher (pure TypeScript, no storage, no RN imports)
**When** it compares a new item with existing items
**Then** it returns a typed `MatchOutcome` union: `no_match`, `duplicate_of(id)`, `possible_duplicate_of(id)`, `reversal_or_refund_of(id)`, `transfer_pair_with(id)`, `held_pair(id, question)` or `previously_removed` (the tombstone case, used from Story 3.12)
**And** the result depends only on its inputs, so the same inputs always give the same result (property test).

**Given** two items that both carry a reference
**When** reference, direction and event type are all equal
**Then** the outcome is `duplicate_of`
**And** when the references differ the outcome is never a duplicate or possible duplicate, whatever the amount, date or merchant. Example: two ₹20 UPI payments to the same tea stall on consecutive days with different UPI references both return `no_match` (property test: differing references never match).

**Given** a same-reference item in the opposite direction
**When** the credit lands in the same account the debit left, or its text says reversed, refund or failed
**Then** the outcome is `reversal_or_refund_of`; if it lands in a different owned account the outcome is `transfer_pair_with`; if the credit's account is unknown the outcome is `held_pair` with the question `Reversal, or a transfer between your accounts?`.

**Given** at least one item has no reference
**When** the amounts are equal, the `local_date`s are within ±1 day and the normalized merchants are equal
**Then** the outcome is `possible_duplicate_of`
**And** a receipt also matches a card or bank charge from the same merchant on the same day that is 0–30% higher (₹1,000 receipt vs ₹1,150 charge matches; ₹1,000 vs ₹1,301 does not)
**And** an item with no merchant is never fuzzy-matched.

**Given** two manual entries of the same amount at the same merchant
**When** they were entered within 10 minutes of each other
**Then** the second is `possible_duplicate_of` the first
**And** two genuine ₹20 teas entered 40 minutes apart both return `no_match`.

**Given** CSV rows (used by Epic 9)
**When** they are matched
**Then** rows from the same file are never matched against each other or against rows already committed from that file, identical rows get an occurrence index within their (date, amount, description) group so the Nth identical row is distinct, and rows on a partly covered first or last day return `held_pair`/review instead of being skipped or added.

**Given** a debit and a credit on two different owned accounts with equal amounts
**When** transfer pairing runs
**Then** pairs are proposed within ±3 days for captures and ±2 days for CSV rows, even when their references differ, and duplicate matching keeps its ±1 day window.

**Given** the merchant normalizer (LRN-009 rule; learning reuses it in Epic 11)
**When** it normalizes `SWIGGY*BLR 8821`, `Swiggy` and `SWIGGY  ORDER 4410`
**Then** all three return `swiggy` (lowercase, trim, collapse whitespace, strip gateway prefixes and trailing reference numbers or city codes).

**Given** the fast-check suite (AD-18)
**When** core tests run
**Then** dedup properties pass: matching is symmetric for duplicates, differing references never match, same-file CSV rows never match, and the PRD §8.3 / §8.8 worked examples pass as fixtures.

**Covers:** FIN-027, AD-6 (match stage), AD-18 (dedup property tests)

### Story 3.2: Shared capture pipeline with manual entry as its first source

As Priya,
I want every entry I add to go through the same checks before it reaches my records,
So that later sources such as bank SMS, receipts and CSV can never get round the duplicate rules.

**Acceptance Criteria:**

**Given** the `SubmitCapture` use case
**When** a source input is submitted
**Then** it runs parse → normalize → match (Story 3.1) → classify → create a ledger transaction with status `needs_review` or `confirmed`, inside one `LedgerWriter` transaction with audit and outbox rows
**And** the `source_record` and `review_candidate` tables are created by this story's migration (owner: capture), every created transaction has at least one `source_record`, and a `source_record` row for an Add-sheet save has `source_kind = manual`.

**Given** a manual save
**When** the user taps Save
**Then** a submission id (UUID v7) is generated and used as the source fingerprint, and submitting the same id again (e.g. a retry after the app was killed) returns the existing transaction with result `ALREADY_SUBMITTED` and writes nothing.

**Given** the status model
**When** this story's migration runs
**Then** `transaction.status` accepts `draft`, `needs_review`, `confirmed`, `excluded`, `reversed`, and the columns `capture_resolution` (`user_approved | auto_approved | auto_linked | rejected`, nullable) and `needs_category` exist
**And** `possible_duplicate` is never stored: it is derived from an open `review_candidate` with reason `duplicate`.

**Given** the totals and balance queries from Stories 1.14 and 2.1
**When** a `needs_review` or `excluded` transaction exists
**Then** it is excluded from `Spent this period`, day `Spent`, balances, `In accounts` and `Card dues` (regression tests).

**Given** the Add sheet (Expense, Income, Transfer with optional fee), `Move money` and `Pay card bill`
**When** the user saves
**Then** the save goes through `SubmitCapture` with `source_kind = manual`; `RecordManualEntry` is removed and its tests are pointed at the new path; a transfer and its fee are submitted in one call and committed together
**And** behaviour from Stories 1.13, 1.15 and 2.7 is unchanged: a non-matching save is `confirmed` with `capture_resolution = user_approved`, the toast reads `Saved · Undo`, Undo marks `removal_kind = deleted`, and save p95 stays < 500 ms on the reference device.

**Given** a manual save that the matcher reports as `possible_duplicate_of` a confirmed item
**When** it commits
**Then** it is saved (never blocked) as `needs_review` with an open `review_candidate` (reason `duplicate`, the matched transaction id), it is not counted in any total, and the result code `POSSIBLE_DUPLICATE` is returned to the Add sheet (its toast and choices arrive in Story 3.3; until then the toast reads `Saved · Undo`).

**Given** opening balances (Story 2.4) and balance adjustments (Story 2.5)
**When** they are written
**Then** they keep their own use cases, because they are corrections, not new entries.

**Given** the LIR-06 architecture test
**When** core tests run
**Then** the test fails if any use case other than `SubmitCapture` calls the ledger's create-entry command, or if any adapter or feature module imports it.

**Given** the capture status vocabulary
**When** `captureStatusLabel(state)` maps a stored state to a catalogue key
**Then** an exhaustive switch covers every state and every capture `Result` code, giving exactly `Recorded`, `Recorded · category guessed`, `Recorded · needs a category`, `Recorded · linked as transfer`, `Waiting for you`, `Possible duplicate — check it`, `Looks like a scam — not added`, `Rejected` (test fails when a state or code is added without copy)
**And** the event catalogue gains `CapturesSubmitted` / `CapturesRejected` (captures, ledger, home, widget).

**Covers:** LIR-06, FIN-024, TXN-012 (save path), AD-4, AD-6, UX-DR82, Event catalogue

### Story 3.3: Possible duplicate on save: Keep both or Merge

As Priya,
I want a clear choice when an entry I type looks like one already recorded,
So that I can keep a real second payment or combine the two without counting anything twice.

**Acceptance Criteria:**

**Given** a confirmed ₹450 Swiggy entry at 13:05
**When** Priya manually enters ₹450 at Swiggy at 13:10
**Then** the new entry is saved as `needs_review` + possible duplicate, is not counted, and the toast reads `Looks like this is already recorded` with actions `Keep both` and `Merge`, staying at least 10 s like every toast
**And** the entry is never auto-approved: the core eligibility predicate `isAutoApprovable` returns false for any entry with an open duplicate candidate (unit test, reused by Epic 11).

**Given** the toast
**When** Priya taps `Keep both`
**Then** `KeepBoth` sets the entry `confirmed` (`user_approved`), resolves the candidate, writes audit, and both entries count; the toast reads `Kept both · Undo`.

**Given** the toast
**When** Priya taps `Merge`
**Then** `MergeDuplicate` produces one transaction: account, amount and time come from the higher source authority (bank/card/UPI > CSV > receipt > manual; between two manual entries the already confirmed one wins), items and splits from a receipt when present, and the category from the confirmed entry
**And** every `source_record` and attachment of both records points to the survivor, the merged-away record becomes `excluded` with `removal_kind = excluded` and an audit row, it is hidden everywhere (including Show rejected and Recently deleted), and the toast reads `Merged · Undo`.

**Given** the two records have different categories
**When** Priya taps `Merge`
**Then** a sheet asks `Which category?` with both categories as chips, defaulting to the confirmed entry's, before the merge is written.

**Given** core merge fixtures
**When** core tests run
**Then** a ₹2,340 receipt marked Paid with Cash with 14 item splits merged with a ₹2,340 card SMS leaves one transaction on the card account with the 14 splits, Cash unchanged and both sources kept
**And** a ₹1,000 restaurant receipt merged with a ₹1,150 card charge gives ₹1,150 with a ₹150 `Tip / adjustment` split in the receipt's main category, and the writer invariant confirms splits sum to ₹1,150.

**Given** `Merged · Undo` or `Kept both · Undo`
**When** Priya taps Undo
**Then** both records, their statuses, splits, sources and the open candidate return exactly to their state before the choice (property test on round-trip).

**Given** the toast has gone
**When** Priya later opens the flagged entry from Activity
**Then** its detail shows the line `Possible duplicate — check it` with the same `Keep both` and `Merge` buttons (durable path).

**Covers:** TXN-012, FIN-027 (Merge), FIN-024, LIR-09 (no double count), UX-DR71 (reversible tier)

### Story 3.4: Transaction detail: edit, duplicate, delete or reject

As Ravi,
I want to open any entry, see everything about it and change or remove it safely,
So that a mistake is a two-tap fix and nothing disappears without a way back.

**Acceptance Criteria:**

**Given** Activity or an account timeline (Story 2.3)
**When** Ravi taps a row
**Then** transaction detail (SCR-08) opens. Its layout is built from existing patterns because the UX spec does not define it: a header with the category icon chip, merchant (or category) title and the amount in `headline` with direction (unsigned expense, `+` income, transfer neutral); then label/value rows `Type`, `Date`, `Account` (or `From` → `To`), `Category`, `Merchant`, `Note`, `Payment method`, `Status` (Story 3.2 vocabulary) and `Source` (`Added by you · 7 Nov, 9:12 pm`); then actions `Edit`, `Duplicate` and `Delete` or `Reject · Not mine`
**And** TalkBack reads the header as one node (`Swiggy, spent 450 rupees, Food & Drinks, HDFC debit`) and every action is a 48dp button.

**Given** `Edit`
**When** Ravi changes amount, category, account, date, merchant or note and saves
**Then** the Add sheet opens in edit mode with the type fixed, and `EditTransaction` updates the transaction, its postings and its single split in one writer transaction with an audit row holding old and new values, emitting `TransactionsChanged` (and `CategoryAssigned` with actor `user` when the category changed)
**And** Home `Spent this period`, day `Spent`, balances and account timelines reflect the change without restart, and the toast `Saved · Undo` restores every previous value exactly.

**Given** an edit with an empty amount, or a transfer edited to the same account on both sides
**When** Ravi saves
**Then** inline `Error: amount required` or `Choose two different accounts` (`SAME_ACCOUNT`) keeps the input and nothing is written.

**Given** `Duplicate`
**When** Ravi taps it on a ₹60 Metro expense
**Then** the Add sheet opens with amount, type, category, account, merchant and note copied and date/time set to now, and saving goes through `SubmitCapture`; the 10-minute manual duplicate rule is not applied against the entry it was copied from.

**Given** a manual entry
**When** Ravi taps `Delete`
**Then** it is soft-removed immediately (`status = excluded`, `removal_kind = deleted`, `removed_at` set), excluded from every total and list, and the toast reads `Deleted · Undo`; Undo restores it exactly
**And** the TalkBack custom actions `Recategorise` and `Delete` on Activity rows do the same with the same toasts.

**Given** a captured entry (`source_kind` other than `manual`, tested with a core fixture until capture sources ship)
**When** Ravi opens it
**Then** the remove action reads `Reject · Not mine`, which sets `status = excluded`, `capture_resolution = rejected`, `removal_kind = rejected`, and shows `Rejected · Undo`; the word `Delete` never appears for captured entries.

**Given** an entry that another action removed while detail was open
**When** Ravi taps `Edit` or `Delete`
**Then** the inline error reads `This entry was removed. Nothing was changed.` and nothing is written.

**Covers:** TXN-005 (edit, duplicate-as-new, delete/reject, undo), FIN-014 (atomic edits, soft delete with undo), FIN-024 (Reject · Not mine), UX-DR28 (row tap, custom actions), UX-DR71 (reversible tier), FLOW-05 (detail)

### Story 3.5: Activity rows in every state and the refund-net day header

As Priya,
I want each Activity row to show at a glance whether it is recorded, guessed, waiting, a possible duplicate, a refund or reversed, and each day to show what I really spent,
So that I can trust the list without opening every entry.

**Acceptance Criteria:**

**Given** the Activity row component from Story 1.14
**When** it renders each of the 11 row states
**Then** each matches the DESIGN.md table: confirmed expense (unsigned `text-primary`), income (`+₹85,000` in `semantic-income`), refund (Refunds chip; 16dp return icon 4dp left of `+₹1,299`, both income colour), transfer (transfer icon chip, unsigned neutral), guessed (`guessed` tag), needs a category (`add category` tag), waiting (`waiting` tag + 1px dashed `border-control` outline inset 4dp, 4dp corners), waiting for currency (`currency` tag + dashed outline + `USD 12.99` in the amount column), possible duplicate (16dp warning icon + `Check` tag in `semantic-warning`), reversed (`reversed` tag, title and amount struck through, `text-secondary`) and before tracking started (`before tracking` tag, replacing the Story 2.3 subtitle suffix)
**And** snapshot tests cover every state at 100% and 200% font scale, and a test asserts no minus sign is rendered in any state.

**Given** status tag pills
**When** they render
**Then** they are `rounded.full`, 2×8dp padding, tag type never below 12sp, `bg-canvas` fill with a 1px `border-hairline` inset, `text-secondary`, wrap after the subtitle with 4×6dp gaps, and are not buttons and not separately focusable.

**Given** TalkBack
**When** a row is read
**Then** the order is merchant → amount with direction (`spent 420 rupees`, `refund, plus 1,299 rupees`, `transfer 5,000 rupees`, `USD 12.99, waiting for currency`) → category → account → tags (`Check` read as `possible duplicate, check it`) → date; the return icon is decorative, and a `Check` row has the hint `Double-tap to review possible duplicate`.

**Given** a day with a confirmed ₹1,500 fuel expense, a ₹1,299 refund, a ₹5,000 transfer, ₹85,000 salary and a ₹300 entry still waiting
**When** Activity renders that day
**Then** the header reads `Spent ₹201`; a day whose only entry is a ₹1,299 refund reads `Spent ₹0`
**And** the value comes from the core read model `activityDays(filter)` (confirmed expenses − refunds that day, floored at 0; transfers, income, pending, possible duplicates, reversed and removed excluded), never summed in a component, and the filter argument is honoured (unit test with an account filter).

**Given** any `needs_review` entry exists
**When** the tab bar renders
**Then** the Activity tab shows a small dot with no count, labelled for TalkBack `Activity, entries to check`, and the dot disappears when none remain.

**Given** a `Check` row
**When** Priya taps it
**Then** its detail opens with the `Possible duplicate — check it` line and `Keep both` / `Merge` (Story 3.3).

**Given** 10,000 transactions on the reference device
**When** Priya scrolls Activity
**Then** the list is virtualized with keyset pages of 100 rows from the query layer, and ≥ 95% of frames render at 60 FPS with no dropped-frame burst over 100 ms (measured with the Story 1.3 method).

**Covers:** TXN-006, FIN-024 (labels), FIN-028 (day header), NFR-07 (scrolling), UX-DR28, UX-DR29, UX-DR30, UX-DR31, UX-DR82, UX-DR115

### Story 3.6: Search, filters and sort in Activity

As Ravi,
I want to search and combine filters in Activity and sort the results,
So that I can find last month's petrol or every HDFC entry in seconds.

**Acceptance Criteria:**

**Given** the Activity header
**When** Ravi taps Search
**Then** a search field replaces the title (placeholder `Search merchant, note, category or amount`) with a `Clear` button; results update as he types (300 ms debounce); Back closes search and clears the text. The search pattern is built from the standard header and text-field patterns because the UX spec does not detail it.

**Given** the search index
**When** any transaction is created, edited or removed
**Then** an SQLite FTS5 index over merchant, original description, note, category name and account name is updated in the same writer transaction, and a numeric query such as `450` also matches entries of exactly ₹450
**And** with 10,000 transactions, search p95 < 500 ms on the reference device.

**Given** the filter chip row (48dp) above the list
**When** it renders
**Then** it shows `Filters · N` (filter icon + count text, not a badge), then one removable chip per active filter (`Last 7 days`, `HDFC debit`) drawn as `chip-selected` with a trailing close icon where the whole chip removes it, then `Clear all` when two or more filters are active
**And** after a removal focus moves to the next chip or `Filters · N`, and TalkBack announces `Filter removed. 42 results` (chip label `Remove filter: HDFC debit`).

**Given** `Filters · N`
**When** the filter sheet opens (common bottom-sheet anatomy; contents chosen here because the UX spec only names the sheet)
**Then** it offers `Date` (This period, Last 7 days, Last 30 days, Custom range), `Accounts` (multi-select, archived accounts under `Archived`), `Categories` (multi-select), `Type` (Expense, Income, Transfer, Refund), `Status` (Waiting for you, Possible duplicate, Needs a category, Guessed, Reversed), `Amount` (From / To), a `Show rejected` switch with the caption `Rejected captures from the last 90 days`, and `Sort` (Newest first (default), Oldest first, Highest amount, Merchant A–Z), with footer `Reset` and primary `Show N results`
**And** applying returns to Activity with chips matching the sheet, and Back or swipe closes without changes.

**Given** active filters or a search
**When** day headers render
**Then** `Spent` covers only the listed entries (a category filter counts only the matching split amounts), and every total shown equals the refund-net sum of the listed records.

**Given** sort `Highest amount` or `Merchant A–Z`
**When** the list renders
**Then** day headers are replaced by a flat list with the date in each row's subtitle, and no `Spent` header is shown.

**Given** filters that match nothing
**When** the list renders
**Then** it shows `No matches · Clear all`, and `Clear all` resets filters and search.

**Given** any filter
**When** Ravi goes to Home
**Then** Home totals are unchanged (test), and the filter state lives only in transient UI state for the Activity stack (kept across tab switches, gone after process death).

**Covers:** TXN-007, NFR-07 (search), UX-DR33, UX-DR34, FLOW-05 (find), FLOW-18 (Show rejected switch)

### Story 3.7: Split one entry across categories

As Ravi,
I want to split a BigBasket bill between Groceries and Personal Care and have wmbugo make sure the parts add up exactly,
So that my category totals are right to the paisa.

**Acceptance Criteria:**

**Given** the detail of a confirmed ₹1,264 BigBasket expense in Groceries
**When** Ravi taps `Split`
**Then** the split editor opens as a bottom sheet with one row (Groceries, amount empty), `Add a row`, and `Left to assign ₹1,264` as a polite live region debounced 500 ms.

**Given** rows Groceries ₹1,000 and Personal Care (empty, focused)
**When** Ravi taps `Fill`
**Then** ₹264 is assigned to the focused row (or the last row if none is focused), the button is labelled `Fill: assign ₹264 to Personal Care`, and `Left to assign ₹0` is announced.

**Given** a remainder other than zero
**When** the editor renders
**Then** Save is disabled but focusable with the hint `Assign the remaining ₹X to save`; when rows exceed the total a warning icon and `₹X too much` show; nothing is ever balanced automatically.

**Given** the rows sum exactly
**When** Ravi saves
**Then** `SetSplits` replaces the splits in one writer transaction with audit and `TransactionsChanged`, the writer invariant confirms the splits equal the categorisable amount, and the toast reads `Saved · Undo`
**And** a direct call whose splits don't sum returns `SPLITS_DONT_SUM` and writes nothing (unit test).

**Given** a split entry
**When** Activity renders it
**Then** the subtitle reads `Groceries + 1 more · HDFC debit`, and category totals and filtered day `Spent` use each split's own amount.

**Given** Ravi edits the amount of a split entry from ₹1,264 to ₹1,300
**When** he saves the amount
**Then** the split editor opens with `Left to assign ₹36` and the amount change commits only together with balanced splits.

**Given** Ravi removes rows until one remains
**When** he saves
**Then** the entry has a single split for the full amount.

**Given** remainder maths
**When** core tests run
**Then** allocation tests pass in integer minor units for INR (2 digits), JPY (0 digits) and KWD (3 digits), and the property "splits sum to the categorisable amount" holds (LIR-02)
**And** `reconcileReceiptTotal` returns items + tax + fees − discounts − adjustments in exact minor units, and any shortfall becomes a split flagged `not_itemised` to the seeded Uncategorised category, which the editor shows as a grey `Not itemised` row counted as assigned, not as `Left to assign` (fixture now; receipts arrive in Epic 10).

**Covers:** TXN-009, FIN-022, LIR-02, UX-DR59, FLOW-05 (split)

### Story 3.8: Refunds, reimbursements and failed payments

As Ravi,
I want to record money I got back, or a payment that failed, against the original entry,
So that my spending drops by the right amount in the right period and a refund never looks like income.

**Acceptance Criteria:**

**Given** the detail of a confirmed ₹1,500 Transport expense (fuel) dated 28 Oct, in last period
**When** Ravi taps `Record a refund`, keeps the default amount (what is still refundable, here ₹1,500), changes it to ₹1,299 and saves on 5 Nov
**Then** a `refund` transaction is submitted through `SubmitCapture` with `refund_of_transaction_id`, a +129900 posting on the original's account and a split in Transport, with the toast `Refund saved · Undo`
**And** the refund reduces `Spent this period` for the current period (the refund's own period), leaves the 28 Oct period unchanged, reduces the Transport category total, and is never counted as income.

**Given** a refund amount larger than what is left to refund
**When** Ravi saves
**Then** inline `Error: only ₹1,500 is left to refund` keeps his input and nothing is written.

**Given** the Add sheet Income form
**When** Ravi picks the `Refunds` chip
**Then** a `Refund for` category picker appears (default Other) and the save is stored as an unlinked `refund` in that category, never as income.

**Given** a ₹2,400 dinner paid by Ravi
**When** he taps `Got paid back` and records ₹1,200
**Then** it is stored as a linked recovery (`refund` with `recovery_kind = reimbursement`), and the original's detail shows `You paid ₹2,400 · Paid back ₹1,200 · Your share ₹1,200`
**And** the core query `spendingTotals(period, view)` returns net ₹1,200 and gross ₹2,400, and a property test proves no recovery is subtracted twice.

**Given** a confirmed ₹450 Swiggy expense whose payment failed
**When** Ravi taps `Reverse` (caption `For a payment that failed or bounced`)
**Then** `ReverseTransaction` writes a `reversal` with a +45000 posting on the same account, sets the original to `reversed` with `reversed_by_id`, removes it from spending in its own period even if that period has ended, and shows `Reversed · Undo`
**And** the original row shows the `reversed` state with its detail reading `Reversed on 8 Nov`; the reversal is not a separate Activity row but appears in the account timeline as `Reversal · Swiggy`, neutral, and the account balance nets to unchanged.

**Given** a reversal or its Undo touches an ended period
**When** `TransactionsChanged` is emitted
**Then** the event carries `closedPeriodTouched = true`, and the event catalogue documents that budget threshold handlers never fire for it.

**Given** the GATE-07 fixtures
**When** core tests run
**Then** a property test over random expenses, refunds, reversals, transfers and card payments proves that Activity filtered totals, category totals, Home `Spent this period` (all before the display floor) and account balances reconcile, card payments never count as spending, and refunds never count as income (LIR-09).

**Covers:** FIN-028, FIN-023, LIR-09, TXN-005 (reverse), FIN-021, GATE-07

### Story 3.9: Select many entries and move them to another category

As Ravi,
I want to select all my HP Petrol entries and move them to Transport in one go, with a preview and an undo,
So that fixing months of wrong categories takes seconds and never touches amounts.

**Acceptance Criteria:**

**Given** Activity
**When** Ravi long-presses a row or taps `Select` in the header
**Then** selection mode starts: the selection bar (solid, min 56dp) replaces the header with `✕`, `1 selected` (`title-sm`), `Select all` and primary `Move 1 to…`, and each row's category chip becomes a 24dp checkbox in a 48dp row target, with selected rows on `selected-background`
**And** TalkBack reads rows as checkboxes with `selected` / `not selected`.

**Given** Ravi has searched `HP Petrol` (14 entries in Other)
**When** he taps `Select all`
**Then** all 14 entries of the current filtered set are selected, including rows not yet loaded, and the bar reads `14 selected`.

**Given** `Move 14 to…` → category picker → Transport
**When** the preview appears
**Then** it reads `Move 14 entries from Other to Transport. Amounts don't change.` (or `Move 14 entries to Transport. Amounts don't change.` when the sources are mixed) with `Confirm`.

**Given** the selection includes transfers, split entries, refunds or entries not yet confirmed
**When** the preview appears
**Then** it adds `2 entries won't change: transfers, splits, refunds or entries still to check.` and only confirmed single-category expenses and incomes are moved.

**Given** Confirm
**When** `BulkRecategorise` runs
**Then** it changes only the category of each entry in one writer transaction with an audit row per entry and one `CategoryAssigned` event with actor `user`, asserts every amount and posting is unchanged, exits selection mode and shows `Moved 14 to Transport · Undo`.

**Given** `Undo`
**When** Ravi taps it
**Then** all 14 entries return to their previous categories in one step.

**Given** selection mode
**When** Ravi presses Back or `✕`
**Then** selection ends with nothing changed.

**Covers:** TXN-010, UX-DR45, UX-DR46, UX-DR29 (checkbox chip), UX-DR71 (reversible tier), J-FUEL

### Story 3.10: Review queue: one list of everything to check

As Priya,
I want one place that shows every entry waiting for my decision, with the evidence side by side,
So that I can clear them quickly and know that nothing uncertain is in my totals.

**Acceptance Criteria:**

**Given** `needs_review` entries
**When** Priya taps a row tagged `Check`, `waiting` or `currency` in Activity
**Then** the review queue (SCR-10) opens scrolled to that item, listing exactly the `needs_review` set (core query `toCheck`, also the source of the Activity tab dot and, later, Home's `N to check` and the widget), newest first, under a heading `3 to check`.

**Given** a possible duplicate
**When** it renders
**Then** a side-by-side card shows `This entry` and `Already recorded` with amount, date and time, merchant, account, category and source (`Added by you`, `Bank SMS`, `Receipt`, `CSV import`), and the actions `Keep both`, `Merge` (Story 3.3) and `Delete` (manual) or `Reject · Not mine` (captured)
**And** at fontScale ≥ 1.3 the two columns stack.

**Given** a pending capture (core fixture until capture sources ship)
**When** it renders
**Then** it offers `Approve`, `Edit` and `Reject · Not mine`; `ApproveCapture` sets `confirmed` with `capture_resolution = user_approved` (reused by Epic 11).

**Given** a capture, receipt or CSV row in a currency other than the profile currency
**When** `SubmitCapture` classifies it
**Then** it is stored `needs_review` with `foreign_amount_minor`, `foreign_currency` and `foreign_currency_exponent` (added by this story's migration), no profile amount and no posting, and it is never auto-approvable
**And** its review item shows `USD 12.99`, a keypad labelled `Amount charged in ₹` and `Confirm`, disabled with the hint `Enter the amount in ₹ to confirm` until an amount is entered; no exchange rate is fetched or suggested; on Confirm the profile amount and posting are written and the foreign amount stays as source metadata.

**Given** a held pair from Story 3.1
**When** it renders
**Then** it asks `Reversal, or a transfer between your accounts?` with the choices `Reversal or refund` and `Transfer between my accounts`, and the choice is written in one transaction.

**Given** confirmed entries with `needs_category`
**When** the queue renders
**Then** they are listed in a separate section `Add a category` below the to-check items, choosing a category clears the flag, and they are never counted in `N to check`.

**Given** Priya resolves the last to-check item
**When** the queue empties
**Then** `All checked` shows with the paper boat for 4 s and is announced (under reduced motion: a still frame until tapped), with no confetti or exclamation mark
**And** opening an empty queue shows the boat with `You're all caught up · Smooth sailing`.

**Given** any action in the queue
**When** it commits
**Then** it shows a toast with Undo, and `Spent this period`, balances and the tab dot update without restart.

**Covers:** TXN-008, TXN-013, FIN-024 (needs_review set, capture_resolution), FIN-027 (held pairs), UX-DR73, UX-DR50 (review copy), UX-DR82

### Story 3.11: Receipt photos and source details survive edits

As Mei,
I want to attach a photo of a receipt to an entry, see where the entry came from, and remove the photo if I choose,
So that my evidence stays with the entry however often I edit it.

**Acceptance Criteria:**

**Given** a transaction detail
**When** Mei taps `Add receipt photo`
**Then** the Android Photo Picker opens (no storage or camera permission is requested; permission-spy test), and the chosen image is written encrypted to app-private storage through the `FileStore` adapter (file key derived from the DB key) before the `attachment` row (created by this story's migration, with digest) commits
**And** a thumbnail appears on the detail; tapping it opens a full-screen viewer.

**Given** the same image (same digest) is chosen again for that entry
**When** it would be attached
**Then** `This photo is already attached` shows and nothing is duplicated.

**Given** an entry with a photo and its sources
**When** Mei edits the amount, category, date or splits, or the entry is merged
**Then** every attachment and `source_record` stays linked (a merge carries all of them to the survivor, deduplicated by digest), and the original source text stays read-only as `As recorded: SWIGGY*BLR 8821` when present.

**Given** the `Source` section
**When** it renders
**Then** it lists every source with its kind and time (`Added by you · 7 Nov, 9:12 pm`, `Bank SMS`, `UPI screenshot`, `Receipt`, `CSV import`).

**Given** `Remove photo`
**When** Mei taps it
**Then** a confirm sheet reads `Remove this photo? It will be deleted from this phone.` with `Remove photo`; on confirm the row is deleted, the file is deleted after commit, and the entry is unchanged otherwise.

**Given** an app kill between file write and row commit
**When** the app next starts
**Then** the orphan sweep deletes the unreferenced file.

**Covers:** TXN-011, TXN-002 (receipt attachment), AD-9 (FileStore adapter, orphan sweep), UX-DR71 (confirm tier)

### Story 3.12: Retention purge and tombstones

As Priya,
I want deleted and rejected entries to be removed for good after their keeping period, while wmbugo still remembers not to bring them back,
So that my phone doesn't keep old data forever and a rejected payment doesn't reappear from the next import.

**Acceptance Criteria:**

**Given** the `PurgeExpired` use case and the Clock port
**When** it runs
**Then** it permanently removes entries with `removal_kind = deleted` more than 30 days after `removed_at`, and entries with `removal_kind` `rejected` or `excluded` more than 90 days after, with their postings, splits, source records, candidates and attachments (files deleted after commit)
**And** an entry deleted 29 days ago or rejected 89 days ago is kept (Clock-driven tests at the boundaries).

**Given** each purged entry
**When** it is removed
**Then** one `tombstone` row (created by this story's migration) keeps only a salted SHA-256 hash of its duplicate fingerprint, the outcome (`deleted` or `rejected`) and the purge date, with no amount, merchant or text; the salt is generated per install and stored in `settings`
**And** the fingerprint is (reference, direction, event type) when a reference exists, else (direction, amount, `local_date`, normalized merchant).

**Given** a purged purchase that had a linked refund
**When** it is purged
**Then** the refund stays as an unlinked refund in its category and balances stay consistent.

**Given** a later non-manual submission whose fingerprint matches a tombstone
**When** `SubmitCapture` matches it
**Then** it is skipped with `SKIPPED_PREVIOUSLY_REJECTED` or `SKIPPED_PREVIOUSLY_DELETED` and nothing is written, unless it is submitted with `ignoreTombstone = true` (used by Epic 9's per-row `Import anyway`)
**And** manual entries are never skipped by a tombstone.

**Given** the Scheduler port (declared in core by this story)
**When** the app starts or resumes
**Then** `PurgeExpired` runs at most once per local day as a writer use case; a background trigger can be added later without changing the use case.

**Given** a single entry to delete permanently now
**When** the purge command is called for it
**Then** it purges just that entry with the same tombstone rule (used by Story 3.13), and a transfer purges as one transaction with both legs.

**Covers:** FIN-014 (retention, tombstones, linked items), AD-6/AD-3 (tombstones for every source, PurgeExpired), AD-16 (Scheduler port)

### Story 3.13: Recently deleted, Show rejected and Delete permanently

As Ravi,
I want to find an entry I deleted by mistake a week ago and bring it back, or remove something for good,
So that missing the Undo toast never costs me data.

**Acceptance Criteria:**

**Given** Settings
**When** it renders
**Then** a `Data` group row now exists (shown because Recently deleted exists), and Settings › Data › `Recently deleted` lists manual entries deleted in the last 30 days, most recent first, each showing merchant, amount, original date and `23 days left`
**And** with none it shows the boat with `Nothing deleted in the last 30 days`.

**Given** Ravi deleted a ₹3,200 cash entry dated 30 Oct and missed the Undo toast
**When** he taps `Restore` on it
**Then** it returns with its original date, the Cash balance and `Spent` update without restart, and the toast reads `Restored · Undo`.

**Given** `Delete permanently`
**When** Ravi taps it
**Then** a confirm sheet (common bottom-sheet anatomy; layout chosen here because the UX spec does not detail it) states the consequence in plain words (`Delete this entry permanently? This can't be undone.`) with primary `Delete permanently` and `Cancel`; no typed-word confirmation
**And** for a transfer it adds `This is part of a transfer — both sides will be deleted`, for a purchase with a refund `Its refund will stay, unlinked.`, and on confirm the Story 3.12 purge runs for it and leaves a tombstone.

**Given** the `Show rejected` filter (Story 3.6) is on
**When** Activity renders
**Then** rejected captures from the last 90 days show with the `rejected` tag and the whole row in `text-secondary`; deleted manual entries never show there.

**Given** Priya opens a rejected capture (core fixture until capture sources ship)
**When** she taps `Restore`
**Then** `RestoreRejected` sets it `confirmed` with `capture_resolution = user_approved` in one transaction, balances and totals update at once, and the toast reads `Restored · Undo`
**And** the same detail offers `Delete permanently` with the confirm sheet above.

**Given** any irreversible action (delete permanently)
**When** it is confirmed
**Then** it passes the shared re-authentication guard, which asks to unlock only when app lock is on (a no-op until Epic 8)
**And** `apps/mobile/src/shared/STATES.md` lists every destructive action in this epic with its tier (reversible + Undo: delete, reject, merge, keep both, reverse, refund, split, recategorise, bulk move, restore; confirm sheet: delete permanently, remove photo).

**Covers:** FIN-014 (Recently deleted, Show rejected, Delete permanently), FIN-024 (restore rejected), UX-DR71, J-RESTORE-DELETED, FLOW-18


## Epic 4: Categories and budgets

Ravi shapes his categories (names, icons, palette colours, subcategories, Need/Want types, expense/income/mixed kinds, archive and merge with a preview) without ever changing an amount, and Arjun sets budgets for any period, including his pay cycle and a one-tap 50/30/20 split, sees honest used / left / status figures that respect refunds, and gets one calm alert per threshold per period as he nears or passes a limit. The epic adds the `planning` module's budget tables, extends the profile period service (AD-7) and delivers the read models (`budgetUsed`, `leftInBudget`, Needs/Wants/Savings) that Home (Epic 5), Plan's Free to use (Epic 6) and Insights (Epic 7) consume.

### Story 4.1: Categories screen — add, edit, reorder, icons, palette colours and Need/Want type

As Ravi,
I want to add a Fuel category with its own icon, a colour from the app's palette and a Need type, and tidy the order of my categories,
So that my spending is grouped the way I think about it.

**Acceptance Criteria:**

**Given** Settings (Story 1.16)
**When** this story lands
**Then** the hub gains the `Money` group row with the live summary `14 categories` (count of active expense categories, including Uncategorised, on a fresh profile), opening SCR-18 Categories
**And** SCR-18 shows a segmented control `Spending` / `Income`, then the categories in their sort order, each row with its 40dp icon chip (icon in its `cat-*` colour on the 16% tint), name, and for spending categories a caption `Need`, `Want` or `Not classified`; subcategories are indented under their parent; the header action is `Add category`.

**Given** the seeded categories from Story 1.13
**When** SCR-18 opens on a fresh profile
**Then** each seed shows its DESIGN.md default colour (e.g. Food & Drinks `cat-rose`, Transport `cat-sky`, Housing `cat-brown`) and its seeded type (Housing, Groceries, Bills & Utilities, Healthcare, Transport, Education → `Need`; Food & Drinks, Shopping, Entertainment, Travel, Personal Care → `Want`; Family and Other → `Not classified`)
**And** `Other` uses the neutral fallback chip (`text-secondary` icon on `bg-canvas`), and `Uncategorised` shows the caption `Not classified` with no edit controls for type, kind, colour or name (it is the system fallback for "needs a category" and "Not itemised" amounts).

**Given** Ravi taps `Add category` on the Spending segment (J-FUEL step 1)
**When** the category sheet opens
**Then** it shows `Name` (focused, max 30 characters), `Icon` (a searchable Phosphor outline grid), `Colour` (exactly the 12 `cat-*` swatches, no free colour entry and no hex field, each swatch a 48dp radio labelled with its colour name), `Type` (`Need` / `Want` / `Not set`, default `Not set` with the caption `Not set counts as Not classified in 50/30/20`) and `Subcategory of` (optional, top-level spending categories only)
**And** saving `Fuel`, gas-pump icon, `cat-olive`, `Need` writes one `category` row via the `SaveCategory` use case with an audit row and a `CategoriesChanged` event (added to the event catalogue, invalidating category pickers, Activity, budgets and insights), closes the sheet and shows the toast `Fuel added`.

**Given** a subcategory
**When** Ravi picks `Subcategory of: Transport`
**Then** colour and type default to the parent's (both editable), the kind is always the parent's, and the `Subcategory of` list never offers a subcategory (one level only).

**Given** a name that matches an existing active category of the same kind, ignoring case and surrounding spaces, or an empty name
**When** Ravi taps Save
**Then** the inline error reads `Error: you already have a category called Fuel` or `Error: name required`, focus moves to `Name`, all other input is kept and nothing is written.

**Given** an existing category
**When** Ravi opens it and changes its name, icon, colour or type and saves
**Then** the change applies by id everywhere (Activity rows, pickers, filters) without touching any transaction or split, and the audit row holds the old and new values.

**Given** the seeded `Food & Drinks` of type Want with spending in October and November
**When** Ravi changes its type to Need
**Then** the core query `spendingByBudgetType(period)` moves that spending from Wants to Needs for every period, past and current, and no transaction amount, split or posting changes (property test).

**Given** SCR-18
**When** Ravi drags a row by its handle, or uses the `Move up` / `Move down` buttons or TalkBack custom actions
**Then** `sort_order` is saved on drop, TalkBack announces `Fuel moved to position 4 of 15`, subcategories move with their parent, and the new order is used by the Add sheet `More` list and as the tie-breaker for quick-category chips.

**Covers:** CAT-001, CAT-002, CAT-006, J-FUEL (category creation), Event catalogue

### Story 4.2: Category kinds — spending, income or both

As Ravi,
I want a spending category to stay out of my income unless I deliberately allow both,
So that a salary never ends up filed under Groceries by mistake.

**Acceptance Criteria:**

**Given** the category sheet from Story 4.1
**When** Ravi edits a top-level category
**Then** it shows `Used for` with `Spending`, `Income` or `Both` (stored as `kind` = `expense | income | mixed`), seeds keep their kind (spending seeds `expense`, income seeds `income`), and `Type` is shown only when `Used for` is `Spending` or `Both`.

**Given** the Add sheet Income form, the transaction editor (Story 3.4) or the split editor (Story 3.7) on an income entry
**When** the category picker opens
**Then** it lists only `income` and `mixed` categories; on an expense entry it lists only `expense` and `mixed` categories
**And** the Story 3.8 `Refund for` picker keeps listing spending categories, because a refund reduces spending and is never income.

**Given** a direct core call that assigns an `expense` category to an income split (or an `income` category to an expense split)
**When** the writer validates it
**Then** it returns `CATEGORY_KIND_MISMATCH` and writes nothing (unit test for `SubmitCapture`, `EditTransaction`, `SetSplits` and `BulkRecategorise`)
**And** in Story 3.9's bulk move, entries whose type doesn't fit the chosen category are counted in the `won't change` line, which reads `2 entries won't change: transfers, splits, refunds, entries still to check or entries that don't fit this category.`

**Given** `Freelance` (income) switched to `Both`
**When** Ravi saves
**Then** it appears in both pickers, its spending counts by its type (default `Not set`) and its income counts as income, and its kind change is audited with `CategoriesChanged`.

**Given** a `Both` category with 3 income entries
**When** Ravi tries to switch it to `Spending`
**Then** the inline error reads `3 income entries use this category. Move them to another category first.` and nothing changes; with no entries of the other type the switch saves.

**Given** a subcategory
**When** its parent's kind changes
**Then** the subcategory's kind changes with it in the same writer transaction.

**Covers:** CAT-003

### Story 4.3: Archive and merge categories with a remap preview

As Ravi,
I want to retire or merge categories I no longer use and see exactly which entries move before anything changes,
So that my history stays intact and my past totals don't shift.

**Acceptance Criteria:**

**Given** a category with no entries and no subcategories, other than `Uncategorised` and `Other`
**When** Ravi opens it
**Then** the actions are `Archive` and `Delete`; Delete removes it after the confirmation `Delete Fuel? No entries use it.` with `Delete` / `Cancel`, and the toast reads `Deleted Fuel · Undo`.

**Given** `Fuel` with 40 confirmed entries
**When** Ravi taps `Archive`
**Then** a preview sheet reads `40 entries use Fuel.` with the choice `Keep them in Fuel` (default) or `Move them to another category`, and lists all 40 entries (date, merchant, amount, paged as in Activity)
**And** `Delete` is not offered while entries exist (`archive instead of delete`).

**Given** `Keep them in Fuel` → `Archive`
**When** `ArchiveCategory` runs
**Then** Fuel gets `archived = true` in one writer transaction with audit and `CategoriesChanged`; it disappears from every picker and quick chip, stays on its 40 entries, stays available in the Activity `Categories` filter under `Archived`, and every period's totals are unchanged
**And** SCR-18 lists it under a collapsed `Archived` section with `Restore`, which returns it to pickers in its old position.

**Given** `Move them to another category` → `Transport`, or the action `Merge into…` → `Transport`
**When** the preview renders
**Then** it reads `Move 40 entries from Fuel to Transport. Amounts don't change. Totals for past periods stay the same.` and, when the two categories have different types, adds `Fuel is a Need and Transport is a Want, so these entries count as Wants from now on, in every period.`, with `Confirm`.

**Given** Confirm
**When** `MergeCategory` runs
**Then** in one writer transaction every split in Fuel (including splits of split entries, refunds and entries still to check) is re-pointed to Transport, an audit row per entry stores the original category id and name, Fuel is archived, and `CategoryAssigned` (actor `user`) and `CategoriesChanged` are emitted
**And** the writer asserts every amount and posting is unchanged, the overall spending total of every period is unchanged (property test), each transaction's `source_record` metadata is untouched, and transaction detail shows `Originally Fuel` in its Source section
**And** the toast reads `Moved 40 to Transport · Undo`; Undo restores every split and un-archives Fuel in one step.

**Given** a parent category with subcategories
**When** Ravi archives or merges it
**Then** the preview counts the entries of the parent and its subcategories (`52 entries use Transport and its 2 subcategories.`), subcategories are archived (or merged) with it, and a merge target can't be the category itself or one of its own subcategories.

**Given** `Uncategorised` or `Other`
**When** Ravi opens it
**Then** no Archive, Merge or Delete action is shown, because they are system fallbacks.

**Covers:** CAT-004

### Story 4.4: Suggested categories are always overridable

As Ravi,
I want any category the app filled in for me to be clearly marked and easy to change on that one entry,
So that a wrong guess never sticks and my correction always wins.

**Acceptance Criteria:**

**Given** the `classify` stage of `SubmitCapture` (Story 3.2)
**When** this story lands
**Then** it calls a `CategorySuggester` port returning `{categoryId, reason}` or nothing; the default adapter returns nothing (manual saves never get a suggestion), and learning (Epic 11) will provide the real adapter
**And** a suggestion is written with `category_guessed = true` on the transaction (migration in this story; the state behind the Story 3.5 `guessed` tag and the `Recorded · category guessed` label), tested with a fixture suggester.

**Given** a guessed entry (fixture) open in transaction detail
**When** Ravi taps the `Category` row and picks `Groceries`
**Then** `EditTransaction` saves the new category, clears `category_guessed`, emits `CategoryAssigned` with actor `user` whose payload carries `previous_category_id` and `was_guessed = true` (the learning-from-corrections hook), and the toast reads `Saved · Undo`
**And** the `guessed` tag disappears from the Activity row.

**Given** a guessed entry that Ravi agrees with
**When** he opens detail
**Then** a `Looks right` button next to the category clears `category_guessed` without changing the category and emits `CategoryAssigned` (actor `user`, `was_guessed = true`, same category).

**Given** an entry whose category was last set by the user
**When** any later automatic step runs on it (re-classification, duplicate merge per Story 3.3, a re-submitted source)
**Then** its category is never replaced (`category_set_by = user` is checked by the writer; regression test with a fixture suggester that returns a different category).

**Given** Settings › Money
**When** it renders
**Then** it shows no rules entry, because the rule editor (SCR-25) is Phase 2.

**Covers:** CAT-005 (per-transaction override and correction hook; rule editor SCR-25 Phase 2)

### Story 4.5: Budget rules and the budget-used read model

As Arjun,
I want budgets that are lasting rules measured over my chosen period and counted exactly from what I recorded,
So that a new month or pay cycle never wipes anything and a refund lowers what I've used without ever inflating what's left.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the `planning` module owns `budget` (id, name, scope `overall | category | budget_type | savings`, `scope_category_ids`, `scope_budget_type`, optional `account_ids`, `period_rule` `default | monthly | weekly | custom`, custom start/end dates, `template` nullable, `alert_rule`, `muted`, created/removed timestamps), `budget_target_version` (budget_id, version, `target_minor`, `effective_from` period start) and `budget_period` (derived cache: budget_id, start_date, end_date, target_minor, shortened flag), all money as `_minor` integers.

**Given** the profile period service (AD-7, Story 1.14)
**When** this story extends it
**Then** it also returns weekly periods starting on the profile's first day of week, calendar months, and one-off custom ranges (inclusive dates; outside the range the budget has no current period), plus `previousPeriod(period)`; no planning code computes a boundary itself (architecture test).

**Given** the core query `budgetUsed(budget, period)`
**When** it runs
**Then** used = confirmed, non-removed expense splits in scope with `local_date` in the period, minus refund splits in scope in the period (linked or categorised, FIN-028), excluding transfers, card payments, `needs_review`, excluded and reversed entries; subcategories roll into their parent, each top-level category is floored at ₹0 first, and the floored values are summed (BDG-006)
**And** an overall budget counts every spending category including Uncategorised and `Not itemised` splits; an account-scoped budget counts only entries posted on its accounts.

**Given** November: Shopping ₹2,000 spent and a ₹9,000 refund for an October TV, Food ₹10,000, and a ₹50,000 overall budget
**When** `budgetUsed` and `refundSurplus` run
**Then** Shopping used is ₹0, overall used is ₹10,000, Left in budget is ₹40,000, `refundSurplus` returns ₹7,000 for display as `Refunds this period: +₹7,000`, and October's totals are unchanged.

**Given** `budgetStatus(budget, period, today)`
**When** it runs
**Then** it returns used, remaining (target − used, may go below zero internally and is shown only as `Over by ₹X`), percentage used, days remaining including today, projected spend (used ÷ days elapsed × days in period, labelled an estimate) and status: `insufficient-data` while fewer than 3 days of the period have passed, `exceeded` when used > target, `nearing` when used ≥ the budget's lowest alert threshold (default 75%) or projected spend > target, otherwise `on-track`
**And** unit tests cover each status, a zero target, a 1-day custom range and a period that ended (days remaining 0, no projection).

**Given** the app is closed across midnight on a period boundary
**When** it reopens
**Then** the previous and the new period's records are unchanged, nothing is reset or zeroed, the new period starts at ₹0 used with no rollover, and `budgetStatus` for any past period still returns that period's figures with the target version it had (BDG-005).

**Given** Arjun changes default period, payday or first day of week in Settings (Story 1.16)
**When** `ProfileChanged` is handled
**Then** `budget_period` rows are rebuilt from the period service and every budget figure is re-aggregated from transaction dates, with no transaction, split or posting modified (audit shows only the profile change).

**Given** the GATE-07 finance fixtures
**When** core tests run
**Then** worked budget examples (refund in a later period, refund surplus, reversal of an ended-period payment, overlapping overall and category budgets) pass, and a property test proves overall used equals the sum of floored category amounts and never goes below zero.

**Covers:** BDG-001, BDG-003 (computation), BDG-005, BDG-006, ONB-006 (budget re-aggregation), AD-7

### Story 4.6: Budget list and editor with limit bars

As Arjun,
I want to add a budget for everything or for chosen categories, pick its period and alert levels, and see every budget's progress as a clear bar,
So that I know at a glance where I stand on each limit.

**Acceptance Criteria:**

**Given** the Plan tab (an empty header since Story 1.10)
**When** this story lands
**Then** Plan shows SCR-14 Budgets until the Plan hub arrives in Epic 6; with no budgets it shows the boat empty state `No budgets yet. Set one limit for this period.` with primary `Add budget` and secondary `Use 50/30/20`.

**Given** `Add budget`
**When** the editor sheet opens
**Then** it shows `For` (`Everything` / `Some categories`; the category multi-picker lists active spending and mixed categories with subcategories), optional `Only these accounts`, `Period` (`Each pay cycle` or `Each month` per the profile default, `Monthly`, `Weekly`, `Custom dates`), `Limit` (amount keypad), and `Alert me at` chips `50%`, `75%`, `80%`, `90%`, `100%` with `75%`, `90%` and `100%` preselected
**And** for `Everything` the period is fixed to the default period with the caption `An overall budget always follows your pay cycle` (or `your month` when not salaried).

**Given** valid input
**When** Arjun saves a ₹6,000 monthly Groceries budget
**Then** `SaveBudget` writes the budget and its version 1 target in one writer transaction with audit and a `BudgetsChanged` event (added to the catalogue; invalidates budgets, Home and Plan), and the toast reads `Budget saved · Undo`.

**Given** an empty or zero limit, `Some categories` with none chosen, or custom dates whose end is before the start
**When** Arjun saves
**Then** the inline error reads `Error: amount required`, `Error: choose at least one category` or `Error: end date is before start date`, focus moves to that field, input is kept and nothing is written.

**Given** an overall budget already exists
**When** Arjun picks `Everything` in a new budget
**Then** the sheet reads `You already have an overall budget.` with `Edit it` (opens the existing one) and nothing new is created (BDG-002).

**Given** budgets of different kinds
**When** SCR-14 renders
**Then** it groups them under `Overall`, `50/30/20` and `Categories`, never shows a total that adds groups together, and labels each budget with its period (`1–30 Nov`, `Weekly · 2–8 Nov`, `Custom · 1–15 Nov`); a category budget that overlaps the overall budget shows the caption `Also counted in your overall budget`.

**Given** each budget row
**When** it renders
**Then** it uses the limit bar (UX-DR25): name left, `₹3,400 of ₹4,000` right (caption, `text-secondary`, tnum) 6dp above an 8dp bar (track `bg-muted`, fill `accent-primary`, 2×14dp `text-primary` tick at the limit, hatched `semantic-warning` overflow capped at 20%), and a status line 6dp below: `₹600 left · 12 days left` (on-track), `85% used` (nearing), warning icon + `Over by ₹740` in `semantic-warning` (exceeded) or `Too early to tell` (insufficient data); no minus sign anywhere
**And** TalkBack reads one node per row from the read model (`Groceries, 3,400 of 4,000 rupees, 85% used, 12 days left`), never the bar.

**Given** the limit bar component
**When** its state tests run
**Then** under, 80%, over (overflow capped at 20% of the track), hidden (bar and percentage not rendered or read, track space kept, `Over by ₹ ••••` and day text kept) and due-soon (`Due in 2 days`, for Epic 6 bills) states pass, at 320dp × 200% the amount text wraps below the name and is never truncated.

**Given** a category budget whose only category is archived or merged (Story 4.3)
**When** the archive or merge preview renders
**Then** it adds `The Fuel budget ends after this period.` and on Confirm the budget's last period is the current one; it stays visible in history.

**Covers:** BDG-002 (scopes, one overall budget, labelled overlaps), BDG-003 (display), UX-DR25, FLOW-06 (add budget, live progress)

### Story 4.7: Budget detail, past periods and target changes

As Arjun,
I want to open a budget, see the entries that make it up and earlier periods, and change its limit now or from next period,
So that I understand any number and history never rewrites itself.

**Acceptance Criteria:**

**Given** a budget row on SCR-14
**When** Arjun taps it
**Then** SCR-15 opens with the budget name, period label (`1–30 Nov · 12 days left`), the limit bar and status from Story 4.6, `Left ₹11,860` (or `Over by ₹2,340`), `Projected ₹23,400 by 30 Nov · estimate` (hidden while `insufficient-data`), `Refunds this period: +₹X` when the refund surplus is above zero, and the contributing entries for this budget and period as Activity rows (refunds shown as money back), each opening transaction detail.

**Given** an overall budget
**When** SCR-15 renders
**Then** above the entries it lists each category's floored amount for the period, and their sum equals the used figure exactly.

**Given** the period switcher `‹ Oct` / `Dec ›`
**When** Arjun goes back to October
**Then** SCR-15 shows October's used, its target version, status and entries derived from transaction dates, and `›` is disabled on the current period (no future periods).

**Given** a ₹50,000 overall budget with ₹20,000 used on the 15th
**When** Arjun edits the limit to ₹45,000 and chooses `Starting this period`
**Then** a new `budget_target_version` effective from this period's start is written, this period shows `₹25,000 left`, and every past period keeps ₹50,000 (BDG-007)
**And** choosing `From next period (1 Dec)` instead keeps this period at ₹50,000 and applies ₹45,000 from 1 December.

**Given** a target change `Starting this period`
**When** it commits
**Then** only the current period's `budget_period` row is recalculated, the version and `BudgetsChanged` event are written in one writer transaction with audit, and SCR-14 and SCR-15 refresh without restart.

**Given** `Delete budget`
**When** Arjun confirms `Delete the Groceries budget? Your entries don't change.`
**Then** the budget is soft-removed with audit and `BudgetsChanged`, disappears from SCR-14, and the toast `Budget deleted · Undo` restores it with its history.

**Given** SCR-15 states
**When** the budget has no entries this period, is loading, or the budget was deleted elsewhere
**Then** it shows `Nothing counted in this budget yet this period.`, skeleton rows, or the inline error `This budget was deleted. Nothing was changed.` with `Back to budgets`.

**Covers:** BDG-003 (detail), BDG-005 (past periods queryable), BDG-007, FLOW-06 (budget detail)

### Story 4.8: Changing payday mid-cycle — the shortened cycle

As Arjun,
I want a payday change to end my current cycle cleanly with a fair, pro-rated limit,
So that my budgets, Home, Insights and Plan all switch to the new cycle together.

**Acceptance Criteria:**

**Given** payday on the 1st, a ₹50,000 overall budget, and today is 10 November
**When** Arjun changes payday to the 25th in Settings › You
**Then** a confirmation reads `Your current cycle will end on 24 Nov. Budgets for 1–24 Nov are adjusted to match.` with `Change payday` / `Cancel`; Cancel changes nothing.

**Given** he confirms
**When** `ChangeProfile` commits
**Then** the period service returns 1–24 November as a shortened cycle and 25 November–24 December as the next cycle; `budget_period` for 1–24 November holds the pro-rated target ₹40,000 (₹50,000 × 24 ÷ 30, rounded half-up to the minor unit) labelled `Shortened cycle`, and 25 November–24 December holds ₹50,000
**And** every budget on the default period (overall, 50/30/20 type budgets and default-period category budgets) is pro-rated the same way, while weekly, monthly and custom category budgets keep their own periods.

**Given** the shortened cycle
**When** SCR-14, SCR-15 and the period label on Home render
**Then** they all show `1–24 Nov · Shortened cycle`, and any query that asks the period service (Home `Spent this period`, budgets) uses the same dates (cross-module test).

**Given** the next occurrence of the new payday is today
**When** Arjun confirms
**Then** the current cycle ends yesterday as a shortened cycle and the new cycle starts today.

**Given** the next occurrence of the new payday falls after the current cycle's normal end (e.g. payday 1st changed to the 5th on 28 November)
**When** Arjun confirms
**Then** the current cycle ends as planned on 30 November, 1–4 December is a shortened cycle with a pro-rated target, and the new cycle starts on 5 December; no cycle is ever longer than a normal one.

**Given** the change
**When** it is audited
**Then** no transaction, split or posting changes, past periods keep their dates and targets, and a property test proves every `local_date` still belongs to exactly one period.

**Covers:** BDG-002 (payday change, shortened cycle), ONB-006 (period change re-aggregation), AD-7

### Story 4.9: Budget threshold alerts, once per threshold per period

As Arjun,
I want one calm heads-up when a budget crosses an alert level, and never the same one twice in a period,
So that I can adjust in time without being nagged.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** `budget_alert_fired(budget_id, period_start, threshold_pct, fired_at)` exists with a unique key on the first three columns.

**Given** planning's handler of `TransactionsChanged` (and of `BudgetsChanged` for target edits effective now)
**When** a change raises a budget's used percentage in the current period
**Then** it finds the highest crossed threshold with no `budget_alert_fired` row, records it and every lower crossed threshold as fired in one use case, and emits exactly one `BudgetThresholdCrossed` for the highest
**And** the handler is idempotent on the event id (redelivery fires nothing new).

**Given** a Groceries budget at 74%
**When** one expense takes it to 91%
**Then** exactly one alert fires, for 90%; if a refund later drops it to 70% and spending takes it back to 80%, no 75% alert fires again this period (BDG-004 acceptance).

**Given** a `TransactionsChanged` event with `closedPeriodTouched = true` (Story 3.8), or a change dated in an ended period
**When** the handler runs
**Then** no alert fires for that period (test: October alerts fired, a reversal on 2 November cancels a 30 October payment, October totals correct, no October alert).

**Given** `BudgetThresholdCrossed`
**When** the notification is built through the Notifier port (react-native-notify-kit adapter, first use in this story, on a `Budget alerts` channel)
**Then** the content never contains an amount: `Groceries: 90% used this period`, `Groceries: limit reached this period` at 100%, with a lock-screen public version `Budget update · Tap to see`, no numeric app badge, and neutral wording (no "overspent", no exclamation)
**And** tapping it opens SCR-15 for that budget and period showing its contributing entries.

**Given** the budget editor (Story 4.6)
**When** Arjun turns off `Alerts for this budget` (or deselects all `Alert me at` chips)
**Then** that budget is muted: thresholds are still recorded as crossed so unmuting never back-fires them, and no notification is posted.

**Given** Arjun saves his first budget with alerts on and notification permission has never been asked
**When** the save commits
**Then** a sheet asks `Get a heads-up near your limits?` with `Allow notifications` (system prompt) and `Not now`; the ask is recorded in `prompt_state` and never repeated
**And** when permission is denied, no notification is posted, SCR-14/15 statuses still show `85% used` / `Over by ₹X`, and no further nag appears.

**Covers:** BDG-004, UX-DR79 (budget thresholds), UX-DR69 (first just-in-time notification ask), FLOW-06 (threshold notification → detail)

### Story 4.10: One-tap 50/30/20 targets

As Arjun,
I want to turn my income into Needs, Wants and Savings targets in one tap,
So that I can use a budgeting method I already know without setting up three budgets by hand.

**Acceptance Criteria:**

**Given** SCR-14 with no 50/30/20 template
**When** Arjun taps `Use 50/30/20`
**Then** a sheet asks `Your monthly income` (or `Your income per pay cycle` when salaried), pre-filled from the last full period's confirmed Salary income when there is any, otherwise from the onboarding `Try 50/30/20?` answer in `prompt_state` (Story 1.11), otherwise empty, with the caption `You can change these later`.

**Given** the onboarding answer was Yes with ₹80,000
**When** Arjun first opens Plan after this story lands
**Then** SCR-14 shows a setup card `You wanted to try 50/30/20` with one action `Set it up`, which opens the same sheet pre-filled with ₹80,000; dismissing the card is remembered and nothing is created until he confirms.

**Given** an income of ₹80,000
**When** the sheet previews and Arjun taps `Create targets`
**Then** it shows editable rows `Needs ₹40,000`, `Wants ₹24,000`, `Savings ₹16,000` and `CreateFiftyThirtyTwenty` writes three budgets on the default period (`budget_type` need, `budget_type` want, `savings`) with `template = 50_30_20`, the income figure stored on the template, audit and `BudgetsChanged`, with the toast `50/30/20 targets created · Undo` (BDG-009 acceptance)
**And** splits of an income that isn't divisible exactly (e.g. ₹80,000.01) are allocated in integer minor units so the three targets sum exactly to the income.

**Given** Arjun edits a preview row to `Needs ₹42,000`
**When** he creates the targets
**Then** the edited values are saved as typed, the rows are not forced to sum to the income, and the caption reads `Targets add up to ₹82,000 of ₹80,000 income`.

**Given** an empty or zero income
**When** Arjun taps `Create targets`
**Then** the inline error reads `Error: income required` and nothing is written.

**Given** a 50/30/20 template already exists
**When** Arjun taps `Use 50/30/20` again
**Then** the sheet reads `You already use 50/30/20.` with `Edit targets`, and no second set is created.

**Given** both an overall budget and the template exist
**When** SCR-14 renders
**Then** the `Overall` and `50/30/20` groups are labelled separately and no figure adds the overall target to the type targets.

**Covers:** BDG-009 (template creation), FLOW-14 (set up, incl. acting on the Story 1.11 onboarding answer)

### Story 4.11: Needs, Wants and Savings progress and Left in budget

As Arjun,
I want to see how my Needs, Wants and Savings are doing against my 50/30/20 targets and drill into any of them,
So that I know where my money is going without anything being left out.

**Acceptance Criteria:**

**Given** the core query `needsWantsSavings(period)`
**When** it runs
**Then** Needs and Wants = confirmed spending of categories of that type, refund-net and floored at ₹0 per category first (BDG-006); `Not classified` = Uncategorised, `Not itemised` splits and spending in categories with no type; Savings = `savingsMovedIn(period)` from Story 2.8 (pot-to-pot nets zero, withdrawals reduce it, set-aside goal money and spending excluded); type changes from Story 4.1 move spending between Needs and Wants for every period with no amount changes.

**Given** a 50/30/20 template
**When** SCR-14 renders its `50/30/20` group
**Then** it shows limit bars `Needs`, `Wants` and `Savings` with values (`₹22,000 of ₹40,000`) in the N/W/S colours (DESIGN.md `needs` / `wants` / `savings`, 1px `text-secondary` outline on light surfaces), plus a `Not classified ₹3,000 · Sort it` row when above ₹0 that opens Activity filtered to those entries for the period
**And** the Savings bar never shows warning tint or `Over by`: above its target it reads `₹18,000 of ₹16,000 · target reached`, and a net outflow shows `₹0` (never a minus sign) with the caption `More moved out than in this period`; no bar uses moral labels.

**Given** Arjun taps the Needs bar
**When** the drill-down opens
**Then** it lists the Need categories with their floored amounts for the period (summing to the bar), each opening Activity filtered to that category and period; the Savings bar lists the transfers into and out of savings pots for the period.

**Given** the core query `leftInBudget(period)` for Home (Epic 5) and Free to use (Epic 6)
**When** an overall budget exists
**Then** it returns target − used of the overall budget with `refundSurplus` separate
**And** with only 50/30/20 it returns (Needs + Wants targets) − (Needs + Wants + Not classified used) with `notClassifiedMinor` for the note `includes ₹X not classified · Sort it`; with neither it returns `none` so callers fall back to `Spent this period` (test: targets ₹40,000 Needs+Wants, ₹25,000 spent, ₹3,000 Uncategorised → ₹12,000 with ₹3,000 not classified).

**Given** a template based on ₹80,000 and the last full period's confirmed Salary is ₹90,000 (more than 10% different)
**When** Arjun opens Plan in the new period
**Then** a card reads `Your income changed — update 50/30/20 to ₹90,000?` with `Update` and `Keep ₹80,000`; nothing changes until he taps `Update`, which writes new target versions starting this period (past periods keep theirs), and either choice hides the card until the next period
**And** a difference of 10% or less shows no card.

**Covers:** BDG-009 (Needs/Wants/Savings measurement, income-change offer), CAT-006 (Not classified segment), BDG-006 (type floors), FLOW-14 (bars and drill-down)


## Epic 5: Home: "Am I okay?"

Arjun opens wmbugo and, before he scrolls, knows whether he is okay this period: how much is left in his budget (or, honestly, how far over he is), what is in his accounts and what he owes on cards, whether anything is waiting for him, and where his money went this period and over the last seven days. Every value says which period and accounts it covers, refreshes by itself when anything changes, and can be masked everywhere with one tap that Sara's phone remembers. Arjun can reorder and hide Home cards so his own key answers sit above the fold. The epic builds on the Story 1.14 Home shell, the Story 2.1 overview totals, the Story 3.10 `toCheck` set and the Story 4.5 / 4.11 budget read models; it adds no ledger tables and changes no amounts.

### Story 5.1: Home read model, refresh and stale indication

As Arjun,
I want every figure on Home to come from one consistent snapshot that updates by itself whenever something changes,
So that I never look at an out-of-date or half-updated answer to "Am I okay?".

**Acceptance Criteria:**

**Given** the core query `homeSummary(today)` in the `insights` module (read-only, AD-3)
**When** it runs
**Then** it returns, for the profile's default period from the period service: the period (start, end, label such as `1–30 Nov` or `1–24 Nov · Shortened cycle`), `heroMode` (`overall | nws_only | spent_only`) from `leftInBudget(period)` (Story 4.11), `leftMinor`, `usedMinor`, `targetMinor`, `notClassifiedMinor`, `refundSurplusMinor` (Story 4.5), `daysLeft` (days remaining including today, from `budgetStatus`), `daysToPayday` (when a payday is set), `spentThisPeriodMinor` (Story 1.14), `in_accounts_minor`, `card_dues_minor` and the not-set counts (Story 2.1) and `toCheckCount` (Story 3.10)
**And** all money is integer minor units and the query composes the owners' queries only (no new aggregation of postings or splits).

**Given** the hero presenter (pure function in `apps/mobile/src/features/home`)
**When** it maps `homeSummary` to a view model
**Then** it returns one of the states `under`, `over`, `spent_only`, `loading` plus the flags `notClassified` (nws_only and `notClassifiedMinor` > 0) and `accountsNotSet`
**And** `over` is chosen when `usedMinor` > `targetMinor`, carrying `overMinor` = used − target as a positive value; the presenter has no code path that outputs a negative amount or a minus sign (unit test asserting every state's strings contain no `-` or `−`, and a property test over random used/target pairs) (UX-DR101).

**Given** the daily line
**When** the state is `under`
**Then** the per-day figure = `leftMinor` ÷ `daysToPayday` when a payday is set, otherwise ÷ `daysLeft`, rounded down to the whole major unit (₹11,860 ÷ 12 → `~₹988/day · 12 days left`; S$413.50 ÷ 9 → `~S$45/day · 9 days left`)
**And** in the `over` state no per-day figure is produced: the line is `5 days to payday` when a payday is set, otherwise `5 days left`, and `1 day to payday` / `1 day left` in the singular.

**Given** Home is mounted
**When** any of `TransactionsChanged`, `Captures*`, `AccountsChanged`, `CategoriesChanged`, `BudgetsChanged`, `ProfileChanged` or `BackupRestored` is emitted, the app returns to the foreground, or the device date changes (midnight or a period boundary while open)
**Then** `homeSummary` and every Home card query are invalidated and recomputed without restart (one test per trigger), and a period boundary crossed while backgrounded shows the new period on resume with nothing reset in the old one.

**Given** a recompute is in progress
**When** it takes longer than 300 ms
**Then** the previous values stay on screen and each affected card's scope caption (and the hero's period chip) reads `Updating…` until the new values fade in (150–250 ms, never a count-up); the first load uses skeletons instead
**And** when one card's query fails, only that card shows the inline `ErrorBlock` `Couldn't load this card` with `Retry`, the rest of Home stays usable, and nothing is shown as zero.

**Given** the Story 1.3 measurement method on the reference device with 10,000 ledger records
**When** Home opens from a warm start
**Then** the hero and first card are visible within p95 2 s (NFR-05), achieved by indexes on `transaction.local_date`/status and `split.category_id` added by this story as a ledger-module migration where the query plan needs them (EXPLAIN check in a test), and the benchmark is recorded in CI artefacts.

**Covers:** HOM-001 (hero read model), HOM-004, NFR-05, UX-DR101, UX-DR68 (SCR-04 loading/error/partial)

### Story 5.2: The "Am I okay?" hero card

As Arjun,
I want a single calm card at the top of Home that tells me what is left in my budget, or exactly how far over I am, with my accounts and card dues beside it,
So that I can answer "Am I okay?" in one glance without doing any maths.

**Acceptance Criteria:**

**Given** Home in light mode
**When** it renders
**Then** a full-bleed `gradient.brand` 135° band starts 4dp below the header, is 176dp tall with `rounded.lg` bottom corners, and the glass hero (`hero-card`: `rounded.lg`, padding 16, 1px `glass-border`) overhangs its lower edge onto the canvas
**And** in dark mode there is no band, only the three radial glows capped at 45% alpha (UX-DR5); a visual diff against `mockups/key-home.html` passes in both modes, and the glass fallback (Story 1.8 triggers) keeps identical layout.

**Given** the header
**When** Home renders
**Then** it keeps the Story 1.14 greeting and date and adds a period chip (`1–30 Nov`, or `1–24 Nov · Shortened cycle` per Story 4.8) so the hero's timeframe is always visible.

**Given** an overall budget of ₹20,000 with ₹8,140 used, 12 days left, In accounts ₹52,300 and Card dues ₹4,100
**When** the hero renders (state `under`)
**Then** top-down it shows the label `Left in budget`, the eye button top-right (48dp), `₹11,860` in `display-amount` (tnum) 12dp above the 8dp hero bar filled to 40.7%, the caption `₹8,140 of ₹20,000` 8dp below, the daily line `~₹988/day · 12 days left`, a 1px divider (`on-glass-primary` @16%, 12dp margins) and the accounts line `In accounts ₹52,300` and `Card dues ₹4,100` side by side 16dp apart, never summed
**And** no phrase, emoji or illustration appears anywhere on the calm hero (numbers only).

**Given** an overall budget of ₹20,000 with ₹22,340 used and payday in 5 days
**When** the hero renders (state `over`)
**Then** a 20dp warning icon in `on-glass-warning` precedes the label `Over budget`, the amount reads `₹2,340` with no minus sign, the caption reads `₹22,340 of ₹20,000`, the time line reads `5 days to payday` with no per-day figure, and no nudge or guilt copy appears.

**Given** the hero bar (UX-DR24)
**When** it renders
**Then** it is 8dp `rounded.full`, track `on-glass-primary` @16%, fill `on-glass-primary` (light) / `on-glass-accent` (dark), with a 2×14dp limit tick (`on-glass-primary` core, 1dp `bg-canvas-dark` outline, 1dp knockout gap) at the limit
**And** above the limit the fill stops at the tick and a 45° hatched overflow (`on-glass-warning` 2dp stripes on 4dp pitch over a `glass-tint` base) is drawn, its width = (used − target) ÷ target of the track, capped at 20% of the track; render tests at 50%, 100%, 112% and 300% spent show the 300% overflow at exactly 20%, and contrast tests assert fill vs track ≥ 3.70:1 light / ≥ 3.43:1 dark.

**Given** only 50/30/20 targets (Needs + Wants ₹40,000), ₹25,000 Needs + Wants spent and ₹3,000 Uncategorised
**When** the hero renders
**Then** it shows `Left in budget` `₹12,000` with the bar and caption against ₹40,000, plus a 48dp row `includes ₹3,000 not classified · Sort it` whose `Sort it` opens Activity filtered to the not-classified entries for the period (Story 4.11)
**And** the row is absent when the not-classified amount is ₹0.

**Given** no overall budget and no 50/30/20 targets (category budgets only, or none)
**When** the hero renders
**Then** it shows `Spent this period` with the refund-net spent amount, no bar, no daily line, and a 48dp underlined row `Set a limit →` in `on-glass-primary` that opens the budget editor (Story 4.6) with scope `Overall` preselected.

**Given** the accounts line
**When** no account exists, or an included account or card has `balance not set`
**Then** it reads `Set up an account to calculate your balance` (with the add-account action) or appends `+1 account not set` / `+1 card not set` to the known total, and never shows a zero for an unknown (tests for each of the four budget × accounts states in the EXPERIENCE Hero states table).

**Given** Arjun taps the hero anywhere except the eye, `Set a limit` or `Sort it`
**When** the navigation completes
**Then** it opens SCR-15 for the overall budget and current period, SCR-30 Needs / Wants / Savings when only 50/30/20 is set, or the budget editor when there is no budget, within the NFR-03 median of 300 ms.

**Given** TalkBack
**When** focus reaches the hero
**Then** it is one merged node built by the shared label builder from the view model, e.g. `Left in budget, 11,860 rupees. Spent 8,140 of 20,000. About 988 rupees per day, 12 days left. In accounts 52,300 rupees. Card dues 4,100 rupees. Double-tap for budget details`, and over budget it starts `Over budget by 2,340 rupees` and reads `5 days to payday`
**And** the bar and arrows are decorative, the eye is the next node (`Hide amounts, toggle, off`), and `Set a limit` and `Sort 3,000 rupees of unclassified spending` are separate 48dp nodes (exact-string unit tests).

**Given** a 320dp screen at 200% font scale with `₹1,18,60,000` left, in both the under and over states
**When** the hero renders
**Then** the amount caps at 1.5× and auto-fits down to 28sp, is never ellipsised, clipped or wrapped mid-number, `In accounts` and `Card dues` stack vertically (fontScale ≥ 1.3), and the card grows in height rather than truncating.

**Given** the loading state or a value change
**When** values arrive
**Then** skeleton blocks are replaced by values that fade in over 150–250 ms (instant under reduced motion), never counting up.

**Covers:** HOM-001 (hero, In accounts and Card dues never summed), HOM-005 (hero period chip), NFR-03, UX-DR22, UX-DR23, UX-DR24, UX-DR101, UX-DR86 (hero merged node), FLOW-06 (Home hero live progress), FLOW-14 (hero 50/30/20 form)

### Story 5.3: Hide amounts with one tap

As Sara,
I want to tap the eye on the hero and have every amount in the app masked until I tap it again, even after I close the app,
So that I can open wmbugo on the train or at work without anyone reading my finances.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the `profile` module's `settings` gains `hide_amounts` (boolean, default false), changed only via the `SetHideAmounts` use case with audit and `ProfileChanged`, and exposed to the UI through a `useAmountsHidden()` hook (Settings › Privacy in Epic 8 binds the same setting).

**Given** the hero eye (48dp, `on-glass-primary`)
**When** Sara taps it
**Then** every amount on every screen switches to the mask in the same frame, the icon becomes eye-slash, TalkBack reads the eye as `Hide amounts, toggle, on` and announces `Amounts hidden` (politely; `Amounts shown` when turned off)
**And** after force-closing and reopening the app, Home and every other screen are still masked (persistence test).

**Given** the shared `<Amount>` component (Story 1.9)
**When** amounts are hidden
**Then** it renders the currency symbol + exactly four dots (`₹ ••••`, `S$ ••••`) in the same type role, weight and colour, keeps direction cues (`+₹ ••••` in `semantic-income`, refund icon, transfer icon), hides the dots from accessibility and labels the node `Amount hidden`
**And** a snapshot test proves ₹60 and ₹1,18,60,000 render at identical width, and the existing lint rule still bans formatting money outside `<Amount>` so no screen can bypass the mask.

**Given** the hero while masked
**When** it renders
**Then** the label is unchanged, the headline reads `₹ ••••`, the caption `₹ •••• of ₹ ••••`, the daily line `~₹ ••••/day · 12 days left` (or `5 days to payday` unchanged when over), the accounts line `In accounts ₹ ••••` and `Card dues ₹ ••••`, and the hero bar, tick and overflow are not drawn while their track space is kept (layout-shift test: identical card height masked and unmasked)
**And** the TalkBack merged node reads `Left in budget, amount hidden. …` with every figure read as `amount hidden`, and an over-budget hero still reads `Over budget, amount hidden`.

**Given** any bar, fill or text that encodes a ratio of money (limit bars from Story 4.6, Needs / Wants / Savings bars, `85% used`, segment percentages)
**When** amounts are hidden
**Then** bars and fills are not rendered (track space kept), percentage text is not rendered or announced and its line collapses, while counts (`3 to check`), days (`12 days left`, `Due in 2 days`), labels, signs and icons stay, and money inside status text is masked (`Over by ₹ ••••`).

**Given** an audit test that toggles hide amounts on and walks every screen built so far (Home, Activity, transaction detail, Add sheet amounts already saved, accounts list and detail, review queue, categories, budgets list and detail, Needs / Wants / Savings)
**When** it inspects the rendered tree
**Then** no digit-bearing money string and no `%` glyph derived from money is visible anywhere, and no TalkBack label contains a money value
**And** the Add sheet keypad still shows what Sara is typing (entry is never masked), and budget notifications keep their amount-free wording from Story 4.9.

**Covers:** HOM-008, SET-005 (hide amounts, app scope), UX-DR54, UX-DR74

### Story 5.4: Home cards — things to check, income and expense, budgets and Needs / Wants / Savings

As Arjun,
I want cards under the hero that show what is waiting for me, money in and out this period, my category budgets and my 50/30/20 progress, each opening its details,
So that I can see the rest of my picture and act on it without hunting through tabs.

**Acceptance Criteria:**

**Given** the Home card registry in `apps/mobile/src/features/home`
**When** Home renders
**Then** cards render below the hero in the PRD §6.3 default order `N to check` → `income_expense` → `budgets` → `nws` (later cards are appended by later stories), each a `card` (`bg-surface`, `rounded.md`, padding 16, no shadow, 12dp apart, 16dp below the hero) with a `title-sm` title and a right-aligned `caption` scope `This period`
**And** each registry entry declares a stable id, title, visibility rule, supported sizes and its drill-down target, so later stories add cards without changing Home.

**Given** `toCheckCount` = 3
**When** Home renders
**Then** directly under the hero a 48dp card row shows `3 to check` (`title-sm`), the caption `Waiting for you` and a trailing caret, opening SCR-10; TalkBack reads `3 to check, Waiting for you, button`
**And** at 0 the card is not rendered at all (no empty card, no `0 to check`), confirmed entries that only need a category are never counted, and the count updates without restart when the queue changes.

**Given** the Income and expense card
**When** it renders for the period
**Then** it shows `Income +₹85,000` (`semantic-income`) and `Spent ₹8,140` (refund-net, same figure as Story 1.14) side by side, and a net chip `Net +₹76,860` when income exceeds spending, `Net ₹3,200 out` when spending exceeds income and `Net ₹0` when equal; no minus sign anywhere, transfers and card payments counted in neither
**And** tapping `Income` opens Activity filtered to Type `Income` and This period, and tapping `Spent` opens Activity filtered to Type `Expense` and `Refund` for This period (Story 3.6 filters; Back returns to Home).

**Given** at least one category budget on any period
**When** the Budgets card renders
**Then** each budget is a limit-bar row (UX-DR25 from Story 4.6): name left, `₹3,400 of ₹4,000` right, status below (`85% used`, warning icon + `Over by ₹600`, `₹2,600 left · 12 days left`), ordered by percentage used, highest first, each row opening SCR-15 for that budget and period
**And** a budget on a non-default period shows its own scope caption on the row (`This week`, `1–15 Dec`), the overall budget never appears here (it lives in the hero), and with no category budgets the card is not rendered.

**Given** 50/30/20 targets exist
**When** the Needs, Wants, Savings card renders
**Then** it reuses the Story 4.11 bars (N/W/S colours, values `₹22,000 of ₹40,000`, Savings never in warning tint) and the `Not classified ₹3,000 · Sort it` row when above ₹0, and tapping it opens SCR-30
**And** without 50/30/20 targets the card is not rendered.

**Given** a period with no confirmed entries yet
**When** Home renders
**Then** the Income and expense card shows `Income +₹0` and `Spent ₹0` (genuinely zero for a known period), and no card invents values or a trend.

**Given** the end of the Home scroll
**When** Arjun scrolls to the last card
**Then** bottom padding keeps the last card and every control fully above the tab bar and the ＋ button (layout test at 320dp × 200% and on a 600dp rail), and the ＋ never overlaps a card control or a TalkBack focus target (HOM-006).

**Given** TalkBack and large text
**When** Arjun explores the cards
**Then** card titles are headings, each money value reads in full with direction (`Income, plus 85,000 rupees`), the scope caption is read after the title, and at fontScale ≥ 1.3 the Income and Spent figures stack and budget rows let the amount wrap below the name without truncation.

**Covers:** HOM-001 (N to check, income and expense, per-category budgets, Needs/Wants/Savings), HOM-002, HOM-005 (card scope labels), HOM-006, UX-DR26, UX-DR68 (SCR-04 needs review), FLOW-14 (Home N/W/S)

### Story 5.5: Top categories and 7-day spend charts with View as table

As Arjun,
I want to see my top spending categories this period and my last seven days of spending as simple charts I can also read as a table,
So that I know where my money is going and can tap straight through to the entries behind any bar.

**Acceptance Criteria:**

**Given** the first chart in the app
**When** this story lands
**Then** a shared `<BarChart>` built on Victory Native XL lives in `apps/mobile/src/shared` with direct labels on every bar, a `View as table` toggle (48dp text button), tappable bars and table rows that run the same drill-down, a scope label rendered first, and it is never placed on raw gradient (Insights in Epic 7 reuses it).

**Given** the Top categories card (`top_categories`)
**When** it renders for the period
**Then** it shows up to 5 categories ranked by refund-net spending (top-level categories, floored at ₹0 per category as in Story 4.5), each a horizontal bar with the 40dp category icon chip, the category name and `₹4,200` as a direct label, with `Not classified` ranked like any category
**And** tapping a bar or its table row opens Activity filtered to that category and This period, and Back returns to Home with Home unchanged.

**Given** a category whose refunds this period exceed its spending (e.g. Shopping ₹2,000 spent, ₹9,000 refunded)
**When** the Top categories card renders
**Then** that category is not ranked among spending and, if shown, its bar sits at zero with the label `₹7,000 back` and the refund icon; no negative bar and no minus sign appear in the chart or its table.

**Given** the 7-day spend card (`spend_7d`)
**When** it renders
**Then** it shows one vertical bar per day for the last 7 days including today (`Sun` … `Sat`, today labelled `Today`), each the refund-net confirmed spending of that `local_date`, floored at ₹0, matching the Activity day header `Spent` for the same day (cross-check test), with scope label `Last 7 days`, and tapping a bar opens Activity filtered to that day.

**Given** a profile created 3 days ago
**When** the 7-day spend card renders
**Then** it shows only the days since the profile's first day with the caption `Since Thu 5 Nov`, never zero bars for days before wmbugo existed, and days with no spending after that show a ₹0 bar (genuinely zero)
**And** neither chart shows a trend arrow or comparison, and with no spending yet in the period the Top categories card shows the empty state `Nothing spent yet this period.` instead of an empty chart.

**Given** `View as table`
**When** Arjun switches a chart to its table
**Then** the table lists one row per bar with name, amount and share of the period's spending (`Food, ₹4,200, 32%`), the header row is announced as headers, each row is a single TalkBack node (`Food, 4,200 rupees, 32 percent`), the scope label is read first (`Top categories · This period`), and the choice is kept for that card until Home is left.

**Given** amounts are hidden (Story 5.3)
**When** either chart renders
**Then** bar fills and percentages are not rendered (axes, labels and day names stay), direct labels and table values read `₹ ••••` / `Amount hidden`, and the percent column is not rendered.

**Covers:** HOM-001 (top categories, 7-day spend), HOM-002 (chart drill-down), HOM-005 (no fabricated history), UX-DR65 (Home charts), UX-DR94 (Home charts)

### Story 5.6: Edit Home — reorder, hide, resize and reset cards

As Arjun,
I want to move my Needs, Wants and Savings card up under the hero and switch off cards I don't use,
So that Home opens with my own key answers above the fold.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** `settings` gains `home_layout` (JSON list of `{cardId, hidden, size}` in display order, default null = PRD order), written only by the `SaveHomeLayout` use case with audit and `ProfileChanged`.

**Given** the bottom of Home
**When** Arjun scrolls past the last card
**Then** a 48dp `Edit Home` text button opens SCR-05 Home card editor.

**Given** SCR-05
**When** it renders
**Then** it lists `Am I okay?` pinned first with no drag handle, no `Move` buttons and no `Hide` switch, followed by every registered card in the saved order (`Income and expense`, `Budgets`, `Needs, Wants, Savings`, `Top categories`, `7-day spend`), each row with a drag handle, `Move up` / `Move down` 48dp buttons (also exposed as TalkBack custom actions), a `Hide` switch and, for `Budgets` and `Top categories`, a `Compact` / `Full` choice
**And** `N to check` is not listed: it always appears directly under the hero when something is waiting; hidden cards stay in the list with their switch on and the caption `Hidden`.

**Given** Arjun uses `Move up` on `Needs, Wants, Savings` until it sits under the hero, and switches on `Hide` for `7-day spend`
**When** each change happens
**Then** TalkBack announces `Needs, Wants, Savings moved to position 2 of 6` and `7-day spend hidden`, `Move up` is disabled (focusable, with the hint `Already at the top`) on the first movable row and `Move down` on the last
**And** the same result is reachable by drag with the handle; the J-HOMEEDIT path is tested without drag.

**Given** Arjun presses Back
**When** SCR-05 closes
**Then** the layout is saved in one writer transaction and Home immediately shows the hero, then `Needs, Wants, Savings`, with `7-day spend` absent; the layout survives restart
**And** if nothing changed, nothing is written.

**Given** `Compact` on Budgets or Top categories
**When** Home renders
**Then** compact Budgets shows the 3 budgets with the highest percentage used plus `See all budgets` (→ SCR-14), compact Top categories shows the top 3; `Full` shows all budgets and the top 5.

**Given** `Reset to default`
**When** Arjun taps it
**Then** the list returns to the PRD §6.3 order with every card shown at its default size, the toast `Home reset · Undo` appears, and Undo restores the previous layout.

**Given** a card id that is in the registry but not in the saved layout (a card added by a later release)
**When** Home or SCR-05 renders
**Then** that card is shown at its default PRD position relative to the cards around it, and a saved id that no longer exists is ignored without error.

**Given** a card whose visibility rule is false (e.g. Needs, Wants, Savings without 50/30/20 targets)
**When** SCR-05 renders
**Then** it is still listed and orderable with the caption `Shows when you use 50/30/20`, so the layout is ready when it applies.

**Covers:** HOM-003, UX-DR61, J-HOMEEDIT, UX-DR68 (SCR-05 states)


## Epic 6: Plan: bills, goals, Free to use

Arjun lists the bills and subscriptions he already knows about (rent, EMIs, phone, streaming) and sees each one coming before payday, gets a reminder before it is due, and links the payment when it happens so the bill moves to its next date exactly once. He saves for a Goa trip by either setting money aside (nothing moves, it just stops counting as free) or moving it into a savings pot, and sees honest progress. Plan opens on a "Before payday" timeline topped by **Free to use**, an estimate that is never a guess: when a required input is missing it names the one next step instead of a number. Bills and goals never touch balances, spending or Left in budget. The epic builds on Stories 2.1 and 2.8 (balances, included accounts, savings pots, `savingsMovedIn`), 3.2 and 3.4 (`SubmitCapture`, transaction detail), 3.12 (Scheduler port), 4.6–4.11 (budgets, `leftInBudget`, Notifier, first notification ask) and 5.4/5.6 (Home card registry and editor). The capture sheet's `Rent paid? Yes, link it` is wired in Epic 11 (CAP-011) on top of the matcher and prompt built here.

### Story 6.1: Bill rules and due dates in core

As Arjun,
I want wmbugo to know my rent is due on the 5th every month, and to work out every due date correctly even in short months,
So that every screen that shows a bill agrees on when it is due and whether it is paid.

**Acceptance Criteria:**

**Given** this story's migration (owner: planning)
**When** it runs
**Then** `recurring_rule` exists with `id`, `title`, `expected_amount_minor`, `cadence` (`weekly | monthly | quarterly | annual | custom`), `custom_every` (1–99) and `custom_unit` (`days | weeks | months`) for custom, `anchor_date` (the first due `local_date`), `account_id` (opaque ledger ref), `category_id` (opaque ref), `kind` (`subscription | rent | emi | utility | other`), `paid_to` (nullable text), `ends_on` (nullable), `paused_at` (nullable), `ended_at` (nullable), `removed_at` (nullable), and `recurring_payment(rule_id, due_date, payment_kind linked|marked, transaction_id nullable, recorded_at)` with unique keys on (`rule_id`, `due_date`) and on `transaction_id` where not null
**And** the AD-3 ownership table lists `recurring_payment` under planning, and the schema lint (Story 1.5) passes (`_minor` suffix, no `real` columns).

**Given** the pure core function `occurrences(rule, fromDate, toDate)`
**When** it runs for a monthly rule anchored on 31 January 2027
**Then** it returns 31 Jan, 28 Feb, 31 Mar, 30 Apr, 31 May (the anchor day is kept; a short month falls on its last day; never a fixed 28–31-day step), and for a leap year it returns 29 Feb (REC-006 acceptance)
**And** quarterly anchored on 30 November returns 30 Nov, 28 Feb, 30 May, 30 Aug; annual anchored on 29 Feb 2028 returns 28 Feb 2029 … 29 Feb 2032; weekly steps exactly 7 days; custom `every 10 days` steps exactly 10 days and custom `every 2 months` keeps the anchor day like monthly (property test: every result for monthly-based cadences is either the anchor day or the last day of a month shorter than it).

**Given** the planning query `billOccurrences(fromDate, toDate)`
**When** it runs
**Then** it returns, per active rule, each occurrence in the range with `status`: `paid` (a `recurring_payment` row exists), `upcoming` (due after today), `due_soon` (due today to 3 days ahead, with `daysUntilDue`), or `not_seen_yet` (due date passed, no payment row); "today" comes from the Clock port in the profile timezone
**And** paused rules return no occurrences between `paused_at` and resume, ended rules return none after `ended_at` or `ends_on`, and removed rules return none.

**Given** a rule whose 5 Nov occurrence is `not_seen_yet`
**When** the 5 Dec occurrence's due date passes
**Then** the 5 Nov occurrence leaves the current list and stays in the rule's history as `Not marked paid`; it is never marked paid automatically.

**Given** the rule's `nextDue`
**When** it is computed
**Then** it is derived, never stored as a counter: the first occurrence after the latest occurrence that has a payment row, or the first occurrence on or after today when there is none, so recording one payment can advance it by exactly one occurrence (test: two payment rows for the same occurrence are impossible by the unique key).

**Given** the use cases `SaveRecurringRule`, `PauseRecurringRule`, `ResumeRecurringRule`, `EndRecurringRule`, `RemoveRecurringRule`, `MarkBillPaid` and `UnmarkBillPaid`
**When** each commits
**Then** it runs in one writer transaction with an audit row and a `RecurringChanged` event, added to the catalogue with the areas bills, plan and home
**And** resuming a paused rule makes its next due the first anchor occurrence on or after today (missed occurrences while paused are not created as `not_seen_yet`), and `RemoveRecurringRule` is refused with `HAS_PAYMENTS` when any `recurring_payment` exists (it can only be ended, keeping its history).

**Given** an active ₹18,000 rent rule due tomorrow and no payment yet (REC-002)
**When** balances, `In accounts`, `Card dues`, `Spent this period`, day `Spent`, budget used, `leftInBudget`, `needsWantsSavings` and `homeSummary` are computed
**Then** every value is identical to the same fixture without the rule (regression test), because a planned bill only ever feeds Plan's timeline and Free to use.

**Covers:** REC-001 (rule model), REC-002, REC-004 (advance once, history kept), REC-006, AD-3, Event catalogue

### Story 6.2: Bills & Recurring — add, edit, pause and end a bill

As Arjun,
I want to add my rent, phone and subscriptions as bills with their amount, how often they repeat and when they're next due,
So that I can see what is coming and tick off what I've paid.

**Acceptance Criteria:**

**Given** SCR-16 Bills & Recurring (reached from Plan; until the Plan hub arrives in Story 6.8 it opens from a `Bills` row at the bottom of SCR-14)
**When** Arjun has no bills
**Then** it shows the empty state `No bills yet. Rent, phone, subscriptions?` with the primary `Add a bill` (UX-DR50).

**Given** `Add a bill`
**When** the editor sheet opens
**Then** it shows `Name`, `Amount` (keypad; caption `What you usually pay`), `Repeats` chips `Weekly`, `Monthly` (default), `Every 3 months`, `Yearly`, `Custom` (`Every [N] [days | weeks | months]`), `Next due` (date picker), `From account` (active asset and card accounts, defaulting to the last used), `Category` (defaulting by kind), `Kind` chips `Subscription`, `Rent`, `EMI`, `Utility`, `Other` (manual only; nothing is suggested in P1), `Paid to (optional)` with the caption `Helps us spot the payment`, and `Ends` (`Never` / `On a date`)
**And** choosing a kind pre-selects the category Rent → Housing, EMI and Utility → Bills & Utilities, Subscription → Entertainment, Other → Other, and Arjun can change it.

**Given** Rent, ₹18,000, Monthly, next due 5 Dec, from HDFC
**When** Arjun taps `Save`
**Then** `SaveRecurringRule` writes it with `anchor_date` 5 Dec, the sheet closes, the toast reads `Bill added · Undo`, and Undo removes it
**And** no transaction is created and Home is unchanged.

**Given** an empty name or amount, a zero amount, no next due date, or an end date before the next due date
**When** Arjun saves
**Then** the inline error reads `Error: name required`, `Error: amount required`, `Error: choose a due date` or `Error: end date is before the next due date`, focus moves to that field, input is kept and nothing is written.

**Given** SCR-16 with bills
**When** it renders
**Then** it lists active bills ordered by next due date, then `Paused` and an `Ended` group collapsed at the bottom; each row reuses the Activity row pattern (UX-DR28) because the UX spec does not define bill rows: a 40dp category icon chip, the name, the caption `Monthly · HDFC · Rent`, the expected amount right-aligned (`<Amount>`, tnum), and one status line
**And** the status line reads `Due 5 Dec` (upcoming); `Due in 2 days`, `Due tomorrow` or `Due today` with the limit bar's due-soon status styling (UX-DR25 warning icon + text, no fill bar, because a bill has no spent-of-limit ratio); check icon + `Paid 4 Dec` (paid); `Not seen yet · was due 5 Nov` in `text-secondary`, neutral, with `Mark as paid` (not seen yet); or the tag `Paused`.

**Given** a bill row
**When** Arjun taps it
**Then** the bill detail shows the fields, `Next due 5 Dec`, the history of this rule's occurrences (`Paid 4 Nov · marked by you`, `Not marked paid · 5 Oct`) and the actions `Edit`, `Mark as paid`, `Pause` (or `Resume`), `End this bill` and, only when there is no payment history, `Delete`.

**Given** `Mark as paid` on the 5 Dec occurrence
**When** Arjun confirms `Mark Rent as paid for 5 Dec? This doesn't add an entry.`
**Then** `MarkBillPaid` writes a `marked` payment row, the row shows `Paid · marked by you`, next due becomes 5 Jan, and the toast `Marked as paid · Undo` reverts it; marking the same occurrence again is not offered.

**Given** `Edit` and a change to `Next due`
**When** Arjun saves 7 Dec instead of 5 Dec
**Then** the anchor moves to the 7th from that occurrence on, past payment rows keep their dates, and the toast reads `Bill saved · Undo`.

**Given** `Pause`, `End this bill` or `Delete`
**When** Arjun confirms
**Then** pause shows `Paused` with no due dates until `Resume` (`Rent resumes · next due 5 Jan`); end confirms `End Rent? Its history stays.` and moves it to `Ended`; delete (no history) confirms `Delete Rent?` with the toast `Bill deleted · Undo`; a bill with history shows `Rent has payment history. End it instead to keep it.` and no delete.

**Given** amounts are hidden (Story 5.3), TalkBack or 200% text at 320dp
**When** SCR-16 renders
**Then** amounts read `₹ ••••` while day statuses stay; each row is one node (`Rent, 18,000 rupees, monthly from HDFC, due in 2 days`); amounts wrap below the name, never truncated.

**Covers:** REC-001 (editor, kind, end/pause), REC-002 (no entry created), REC-004 (cancellations preserve history), UX-DR25 (due soon), UX-DR50 (Bills empty), UX-DR70

### Story 6.3: Link a payment to a bill — "Rent paid? Yes, link it"

As Arjun,
I want wmbugo to notice when an entry looks like my rent payment and let me link it with one tap,
So that the bill shows paid and moves to next month without my doing anything twice.

**Acceptance Criteria:**

**Given** the planning query `findBillMatch(transaction)`
**When** it runs for a confirmed or waiting expense
**Then** it returns the best unpaid occurrence of an active rule where the rule's `paid_to` is set and equals the entry's normalized payee or merchant (learning's normalizer), the amount is within ±10% of the expected amount (inclusive), and the entry's `local_date` is within 7 days before or after the due date; with several candidates it picks the nearest due date, then the smallest amount difference
**And** it returns nothing for income, transfers, entries already linked, rules without `paid_to`, or a rule the user dismissed for this entry; it never links anything by itself (auto-approve never links bills, FIN-026).

**Given** monthly rule Rent ₹18,000 due 5 Dec, paid to `Ramesh Kumar`, and a confirmed ₹18,000 expense to Ramesh Kumar on 4 Dec
**When** Arjun opens its transaction detail (SCR-08)
**Then** an inline card under the header reads `Rent paid?` with `Yes, link it` (button-primary) and `Not this one` (button-text), rendered by the shared `BillMatchPrompt` component in `apps/mobile/src/shared` that the capture sheet reuses in Epic 11 (CAP-011)
**And** `Not this one` hides the card for this entry and rule permanently.

**Given** Arjun taps `Yes, link it`
**When** `LinkBillPayment` commits
**Then** it writes a `linked` payment row for the 5 Dec occurrence with the transaction id, an audit row and `RecurringChanged`; SCR-08 shows `Paid Rent for 5 Dec` with `Unlink`; SCR-16 shows `Paid 4 Dec · linked`; next due becomes 5 Jan; the entry's amount, category and status are unchanged
**And** the toast reads `Linked to Rent · Undo` (REC-009 acceptance).

**Given** the same entry or the same occurrence
**When** linking is tried again (retry, double tap, or another rule)
**Then** it is refused with `This entry is already linked to Rent (5 Dec).` or `Rent for 5 Dec is already paid.`, nothing is written, and next due is still 5 Jan, never 5 Feb (REC-004 exactly-once test).

**Given** a `not_seen_yet` or due occurrence on SCR-16
**When** Arjun taps `Link an entry`
**Then** a picker lists confirmed, unlinked expenses within 15 days of the due date, best matches first with the tag `Looks like a match`, with search by merchant or note, and picking one runs `LinkBillPayment`
**And** with none it reads `No entries near 5 Dec. Add the payment first, or mark it as paid.`

**Given** a linked entry that is then deleted, rejected or excluded (Stories 3.4, 3.13)
**When** planning's handler of `TransactionsChanged` runs (idempotent on the event id, as its own use case)
**Then** the payment row is removed, the occurrence returns to unpaid (`Not seen yet` if past due), next due goes back to 5 Dec, and restoring the entry does not relink it silently (the prompt shows again)
**And** `Unlink` on SCR-08 or the bill detail does the same with the toast `Unlinked · Undo`.

**Given** an entry whose amount is edited after linking
**When** it saves
**Then** the link stays; SCR-16 shows the actual paid amount in the history (`Paid ₹18,500 · 4 Dec`).

**Covers:** REC-009, REC-004 (exactly once, re-linking refused), CAP-011 (shared prompt, wired in Epic 11), UX-DR39 (bill-match variant component)

### Story 6.4: Subscriptions filter with monthly cost and past charges

As Arjun,
I want to see all my subscriptions together with what they cost me each month and what I've actually paid,
So that I can decide which ones to cancel.

**Acceptance Criteria:**

**Given** SCR-16
**When** it renders
**Then** a filter chip row (the Activity filter chip pattern) above the list offers `All bills` (default) and `Subscriptions`.

**Given** Netflix ₹649 monthly, Spotify ₹1,189 yearly and a ₹99 weekly cloud plan, all `Subscription`
**When** Arjun picks `Subscriptions`
**Then** a header card shows `₹1,177 a month` with the caption `Monthly equivalent: yearly ÷ 12, weekly × 52 ÷ 12, every 3 months ÷ 3` (REC-008 conversion labelled), and each row adds the caption `₹1,189 a year · about ₹99 a month`
**And** the total is computed in exact minor units and rounded half-up once at the end (custom cadences: every N days × 365 ÷ 12N, every N weeks × 52 ÷ 12N, every N months ÷ N), and paused and ended subscriptions are listed but excluded from the total with the caption `Not counted while paused`.

**Given** a subscription's detail
**When** it renders
**Then** a `Past charges` section lists the entries linked to it (Story 6.3) newest first as Activity rows that open SCR-08, plus `Marked as paid · 5 Oct` rows without an entry, captioned `Charges you linked to this subscription`
**And** with none it reads `No charges linked yet. Link one when it's paid.`; no chart is shown (timeline chart is Phase 2, INS-022).

**Given** no subscriptions
**When** `Subscriptions` is selected
**Then** it reads `No subscriptions yet.` with `Add a bill` opening the editor with `Subscription` preselected, and the header card is not shown.

**Given** amounts are hidden or TalkBack
**When** the filter renders
**Then** the header reads `₹ •••• a month` and is announced `Subscriptions, about 1,177 rupees a month, monthly equivalent` (or `amount hidden`).

**Covers:** REC-008, REC-007 (P1 manual kind only)

### Story 6.5: Bill reminders with a just-in-time permission ask

As Arjun,
I want a quiet reminder the day before rent is due,
So that I never pay late, without wmbugo flooding my notifications.

**Acceptance Criteria:**

**Given** the bill editor (Story 6.2)
**When** this story lands
**Then** it gains `Remind me` chips `Off`, `On the day`, `1 day before` (default for new bills) and `3 days before`, stored on `recurring_rule` by this story's migration, with the caption `Reminders come around 9 am. Your phone may delay them a little.`

**Given** Arjun saves a bill with a reminder on, notification permission is undetermined and the bill reminder ask has never been made
**When** the save commits
**Then** a sheet asks `Get a reminder before bills are due?` with `Allow notifications` (system prompt) and `Not now`; the ask is recorded in `prompt_state` and never repeated (an earlier budget ask from Story 4.9 that was granted means no ask at all)
**And** this is the only place bill reminders request permission; nothing is asked during onboarding.

**Given** permission is denied (now or earlier)
**When** the bill editor or SCR-16 renders
**Then** the `Remind me` row shows the inline `Notifications are off for wmbugo · Open settings` and keeps the chosen setting, no reminder is scheduled, no further nag appears, and Plan and SCR-16 still show `Due in 2 days` / `Due today` (UX-DR69, SET-003 acceptance).

**Given** the pure core planner `planBillReminders(occurrences, settings, today)`
**When** it runs
**Then** it returns reminder slots for the next 14 days at 09:00 profile local time for every unpaid occurrence of an active rule with a reminder, and the Notifier adapter schedules them as inexact trigger notifications on a `Bill reminders` channel (no exact-alarm permission, REC-003)
**And** it is re-run on `RecurringChanged`, `TransactionsChanged` (a linked payment cancels its pending reminder), `ProfileChanged` (timezone), `BackupRestored`, app start and resume, replacing previously scheduled reminders idempotently.

**Given** a reminder fires
**When** it is shown
**Then** it reads `Rent is due tomorrow` (`due today`, `due in 3 days`) with `Tap to see your bills` and never an amount, the lock-screen public version reads `Bill reminder · Tap to see`, there is no numeric badge, and tapping opens SCR-16 scrolled to that bill (after unlock when app lock is on).

**Given** the daily cap of 3 non-capture notifications (SET-003)
**When** 5 bill reminders fall on one day
**Then** the two with the earliest due dates post individually and the third slot is `3 more reminders` opening SCR-16
**And** bill reminders claim the day's slots before budget alerts: when Story 4.9's `BudgetThresholdCrossed` arrives on a day whose slots are taken, it is not posted separately but folded into that day's `N more reminders` notification (updated in place), and its threshold is still recorded as fired (dedupe and priority tests, UX-DR79).

**Given** a bill paid or marked paid before its reminder time, a paused bill, or `Remind me` set to `Off`
**When** the reminder time arrives
**Then** nothing is posted.

**Covers:** REC-003, SET-003 (bills before budgets, overflow, no badge), UX-DR69 (bill reminder ask), UX-DR79 (bill reminders), AD-13, AD-16

### Story 6.6: Savings goals — name a goal and set money aside

As Arjun,
I want to create a Goa trip goal and set ₹5,000 aside for it without moving any money,
So that I can see my progress and stop treating that money as spare.

**Acceptance Criteria:**

**Given** this story's migration (owner: planning)
**When** it runs
**Then** `goal` exists (`id`, `name`, `target_minor`, `due_date` nullable, `icon`, `color` from the 12 `cat-*` tokens, `account_id` nullable opaque ref, `state` `active | paused | completed | archived`, timestamps) and `goal_allocation` (`id`, `goal_id`, `kind` `set_aside | taken_back | moved`, `amount_minor` always positive, `transaction_id` nullable, `local_date`, `created_at`), and the catalogue gains `GoalsChanged` (areas goals, plan, home).

**Given** SCR-17 Goals with no goals (reached from Plan; until Story 6.8 from a `Goals` row at the bottom of SCR-14)
**When** it renders
**Then** it shows the empty state `No goals yet. Saving for something?` with the primary `Add a goal` (UX-DR50).

**Given** `Add a goal`
**When** the editor sheet opens
**Then** it shows `Name`, `Target amount`, `By (optional)` (month and year), `Icon` (Phosphor outline icon grid), `Colour` (exactly the 12 palette swatches, default `cat-cyan`, UX-DR8/UX-DR105) and `Savings account (optional)` (active asset accounts, savings pots first)
**And** an empty name or amount or a past date shows `Error: name required`, `Error: amount required` or `Error: pick a date from this month on`, keeping input and writing nothing.

**Given** Goa trip, ₹30,000, by March 2027
**When** Arjun saves
**Then** `SaveGoal` writes it with audit and `GoalsChanged`, the toast reads `Goal added · Undo`, and SCR-17 shows a goal card: icon chip in its colour, name, the limit bar (UX-DR25, no overflow) with `₹0 of ₹30,000` and the status `₹30,000 to go · by Mar 2027`.

**Given** `Set aside` on the goal
**When** Arjun enters ₹5,000 and confirms
**Then** the sheet's caption reads `The money stays in your account. It just stops counting as free to use.`, `SetAsideForGoal` writes a `set_aside` allocation, the card shows `₹5,000 of ₹30,000` with `₹5,000 set aside`, and the toast reads `₹5,000 set aside for Goa trip · Undo`
**And** account balances, `In accounts`, `Spent this period`, the Savings bar and `leftInBudget` are unchanged (test, GOAL-002 / PRD §8.7 acceptance).

**Given** `Take back` on a goal with ₹5,000 set aside
**When** Arjun takes back ₹2,000
**Then** a `taken_back` allocation is written, the card shows `₹3,000 set aside`, history reads `Taken back ₹2,000 · 9 Nov` (no minus sign), and more than is set aside shows `Error: only ₹5,000 is set aside`.

**Given** the goal detail
**When** it renders
**Then** its history lists each contribution with a visibly different marker: `Set aside` (bookmark icon, tag `Set aside`) versus `Moved to savings` (transfer icon, tag `Moved`, arriving in Story 6.7), so the two kinds are never confused (GOAL-002).

**Given** `Edit`, `Pause`, `Mark complete` or `Archive`
**When** Arjun confirms
**Then** every past allocation is kept and visible; a paused goal shows `Paused` and its set-aside money is still held; completing confirms `Complete Goa trip? The ₹5,000 set aside will count as free to use again.`, and completed or archived goals move to `Done` / `Archived` groups and stop holding set-aside money; `Restore` holds it again
**And** each action writes audit and `GoalsChanged` with an Undo toast.

**Given** a goal's allocations reach its target
**When** the card renders
**Then** it shows the boat relief moment with `Goa trip is fully funded` and `Mark complete` (button-text); no confetti, no exclamation mark (UX-DR73).

**Given** the planning query `setAsideTotal()`
**When** it runs
**Then** it returns set aside minus taken back across active and paused goals only, ready for Free to use.

**Given** amounts are hidden or TalkBack
**When** a goal card renders
**Then** the bar is not drawn and amounts read `₹ ••••`; the card is one node (`Goa trip, 5,000 of 30,000 rupees, 25,000 to go, by March 2027`).

**Covers:** GOAL-001, GOAL-002 (set aside), GOAL-004 (lifecycle preserves allocations), UX-DR8, UX-DR25, UX-DR50 (Goals empty), UX-DR73, UX-DR105

### Story 6.7: Moved to savings, goal progress and pace

As Arjun,
I want to move money into my savings pot for the Goa trip and see whether I'm on track,
So that real saving counts toward my goal once, and I know if March is realistic.

**Acceptance Criteria:**

**Given** `Move to savings` on a goal
**When** it opens
**Then** the Add sheet opens as Transfer with the header chip `For Goa trip`, `To` = the goal's savings account when it is a savings pot, otherwise a picker of savings pots, `From` = the usual asset account, and the keypad focused
**And** with no savings pot it shows `Add a savings pot first` opening the add-account sheet with `Savings pot` preselected (Story 2.8), then returns to the move.

**Given** Arjun moves ₹5,000 from HDFC to `SIP – Axis MF` for Goa trip
**When** he saves
**Then** `SubmitCapture` writes one balanced transfer and, in the same writer transaction, a `moved` goal allocation with that transaction id (capture → planning command, AD-3), emitting `TransactionsChanged` and `GoalsChanged`
**And** the 50/30/20 Savings bar rises by ₹5,000, not ₹10,000, spending is unchanged, and the goal card shows `₹5,000 moved to savings` (PRD §8.7 acceptance).

**Given** the goal already has ₹5,000 set aside
**When** Arjun moves ₹5,000 to savings for it
**Then** the sheet notes `The ₹5,000 set aside for Goa trip moves with it`, the set-aside falls by the moved amount (up to what is set aside) in the same transaction, and goal progress stays ₹5,000, so the money is never counted twice.

**Given** a confirmed transfer into a savings pot that has no goal
**When** Arjun opens its detail (SCR-08)
**Then** it offers `Count toward a goal` (goal picker), writing a `moved` allocation; a tagged transfer shows `For Goa trip` with `Remove`, and one transfer can count toward one goal only.

**Given** a tagged move that is deleted, rejected or still waiting (`needs_review`)
**When** goal progress is computed
**Then** only confirmed, non-removed moves count; planning's handler of `TransactionsChanged` drops the allocation of a removed move and reverses any set-aside it converted (idempotent).

**Given** the planning query `goalProgress(goal)`
**When** it runs
**Then** it returns contributed (set aside held + moved), remaining (`₹25,000 to go`, `₹0` once reached) and, only when there are contributions in at least two different calendar months and the first is 30 or more days old, a pace = contributed ÷ whole months since the first contribution and a projected month = remaining ÷ pace
**And** otherwise the card reads `Not enough history for a pace yet`, and a paused goal shows no pace (GOAL-003).

**Given** a pace of ₹5,000 a month and ₹20,000 to go
**When** the card renders
**Then** it reads `About ₹5,000 a month · done by Mar 2027`; with a `By` date it reads `On track for Mar 2027`, or `At this pace, done by Jun 2027` in neutral `text-secondary` when the projection is later; a passed date reads `Your date has passed · ₹5,000 to go`, never alarm wording.

**Covers:** GOAL-002 (moved to savings, counted once), GOAL-003, GOAL-004 (never counted twice), BDG-009 (goal tag counted once in Savings), FIN-013

### Story 6.8: Plan hub with the "Before payday" timeline

As Arjun,
I want Plan to open on what's coming before payday, with my budgets, bills and goals underneath,
So that one screen tells me what my money is already promised to.

**Acceptance Criteria:**

**Given** the Plan tab
**When** this story lands
**Then** its root becomes SCR-13 Plan hub instead of SCR-14 (Story 4.6); SCR-14, SCR-16 and SCR-17 are pushed from it and Back returns to the hub, and notification deep links (SCR-15, SCR-16) are unchanged
**And** the temporary `Bills` and `Goals` rows on SCR-14 from Stories 6.2 and 6.6 are removed.

**Given** SCR-13 for a salaried profile (payday set)
**When** it renders
**Then** the first section is headed `Before payday` (`Before month-end` without a payday) with the caption `1–30 Nov · 12 days left` from the period service, followed by the timeline; the timeline layout is built from the Activity row and limit-bar status patterns because the UX spec does not define it: one row per bill occurrence from today to the period end (plus `Not seen yet` ones from this period), ordered by due date, each with a leading date label (`Today`, `Tomorrow`, `5 Dec`), the category icon chip, the name, the caption `HDFC · Monthly`, the amount right-aligned and the Story 6.2 status line; paid occurrences stay in place in `text-secondary` with `Paid · linked`; each row opens the bill detail.

**Given** 3 active bills
**When** the timeline renders
**Then** it ends with `Showing 3 bills you added. Missing EMIs or subscriptions? Add them` (`1 bill` singular), where `Add them` opens the bill editor (REC-010), and with active bills but none due before period end it reads `Nothing due before payday` above that line; the timeline never shows bills the user didn't add.

**Given** the hub below the timeline
**When** it renders
**Then** it shows `Budgets` (up to 3 limit-bar rows by percentage used, the 50/30/20 bars when a template exists, `See all budgets` → SCR-14, and the Story 4.10 `You wanted to try 50/30/20` and Story 4.11 income-change cards at the top of this section with unchanged behaviour), `Bills & recurring` (`3 bills · next: Rent on 5 Dec` → SCR-16) and `Goals` (up to 3 goal cards from Story 6.6, `See all goals` → SCR-17), each section title a heading.

**Given** no budgets, no bills and no goals
**When** Plan renders
**Then** it shows three setup cards (UX-DR58: `bg-surface`, 1px dashed `border-control`, `rounded.md`, `title-sm` + one sentence + button-text): `Add your rent` · `See it coming before payday.` · `Add a bill` (opens the bill editor pre-filled Name `Rent`, Kind `Rent`, Monthly, Category Housing); `Set one budget` · `One limit is enough to start.` · `Add budget`; `Name a goal` · `Saving for something? Give it a name.` · `Add a goal`
**And** each card disappears once its thing exists; when only the timeline is empty, it shows the setup card `Add upcoming bills` · `Rent, EMIs, subscriptions: see them before payday.` · `Add a bill` (J-BILLS step 1). These setup cards are not dismissible.

**Given** Arjun adds Rent ₹18,000 due on the 5th from the setup card
**When** the save commits
**Then** the hub refreshes without restart and Rent appears in the `Before payday` timeline (J-BILLS climax, Free to use part in Story 6.9).

**Given** loading, a failing section query, a period boundary while open, or any of `RecurringChanged`, `GoalsChanged`, `BudgetsChanged`, `TransactionsChanged`, `AccountsChanged`, `ProfileChanged`
**When** the hub is shown
**Then** skeleton rows show on first load, only the failing section shows `Couldn't load this section` with `Retry`, and the hub recomputes (the catalogue maps these events to the plan area).

**Given** hidden amounts, TalkBack and 320dp × 200% text
**When** the hub renders
**Then** amounts read `₹ ••••` with dates kept, each timeline row is one node (`5 December, Rent, 18,000 rupees, due in 2 days`), and nothing truncates.

**Covers:** REC-010, REC-002 (timeline only), UX-DR58, SCR-13, J-BILLS (timeline), UX-DR68 (SCR-13 states)

### Story 6.9: Free to use — the honest estimate on Plan

As Arjun,
I want Plan to tell me how much is really free to use before payday after my bills and goals, or exactly what it still needs from me,
So that I can spend without guessing and never see a number I can't trust.

**Acceptance Criteria:**

**Given** the read-only `insights` query `freeToUse(today)`
**When** it runs
**Then** it composes `leftInBudget(period)` (Story 4.11, the same figure Home shows, including the 50/30/20-only form, refund surplus never added), `availableAssets` (a new ledger query: balances of active asset accounts with `Count in my totals` on, not savings pots, that have a balance), `billsReserved` (expected amounts of unpaid occurrences of active rules due from today to the period end, plus this period's `Not seen yet` ones) and `setAsideTotal()` (Story 6.6), and returns `value = min(left, availableAssets − billsReserved − setAside)` with no floor, plus each term
**And** the gate returns `needs_limit` when `leftInBudget` is `none`, otherwise `needs_account` when no active included non-pot asset account has a balance, otherwise `ok`; bills and goals are never part of the gate.

**Given** the PRD fixtures
**When** core tests run
**Then** Left ₹18,000, accounts ₹42,000, bills + set aside ₹30,000 → ₹12,000; Left ₹60,000, accounts ₹50,000, no bills, ₹12,400 set aside → ₹37,600 with balances and Left unchanged; Left ₹60,000, accounts ₹30,000, set aside ₹20,000 then ₹15,000 → `short` ₹5,000; only 50/30/20 → `left` equals `homeSummary.leftMinor` (cross-check); a limit and an account but no bills or goals → gate `ok` (truth-table test over limit × account × bills × goals).

**Given** the gate passes
**When** the top of the Plan hub renders
**Then** above the timeline it shows the KPI tile (UX-DR27): label `Free to use`, the figure in `headline` (tnum) and the caption `Estimate from what you've entered`
**And** a negative value reads `Short by ₹5,000` in neutral `text-primary`, never red, no warning icon, no minus sign.

**Given** no overall budget and no 50/30/20
**When** Plan renders
**Then** in place of the figure a single 48dp row reads `Not enough information yet · Set a limit →` and opens the budget editor with `Overall` preselected; given a limit but no included account with a balance, the row reads `Not enough information yet · Add an account →` and opens the add-account sheet (or the accounts list when accounts exist but none is included or set)
**And** there is never a number, a checklist or more than one step (UX-DR108).

**Given** Arjun taps the figure
**When** the `How we worked this out` sheet opens
**Then** it shows `Left in budget ₹18,000` (with `includes ₹3,000 not classified` when applicable) against `In your accounts ₹42,000` (caption `Accounts in your totals, not savings pots`, plus `+1 account not set` when applicable), `Bills before payday take ₹18,000 (2 bills)`, `Set aside for goals takes ₹12,000` and `Leaves ₹12,000` (no minus signs; `Short by ₹X` when it goes below zero); the smaller side is highlighted with `We use the smaller`, each line opens its source (SCR-15 or SCR-30, SCR-06, SCR-16, SCR-17), and the footer reads `This is an estimate from what you've entered, not a guarantee.`

**Given** J-BILLS: Left in budget ₹60,000, accounts ₹50,000 and no bills or goals (Free to use ₹50,000), and Arjun adds Rent ₹18,000 due before payday
**When** Plan refreshes
**Then** Free to use drops by ₹18,000 to ₹32,000, and once he links the payment (Story 6.3) the bill stops being reserved while the account balance reflects the real payment.

**Given** the Set aside sheet (Story 6.6) while the gate passes
**When** Arjun enters an amount larger than the current Free to use
**Then** a warning icon and `This leaves you short by ₹5,000` appear (polite live region) and `Set aside` stays enabled; after saving, Plan shows `Short by ₹5,000` (GOAL-004 acceptance); when the gate fails no warning is shown
**And** restoring an archived goal shows the same warning when it applies.

**Given** Home
**When** any Home card or the hero renders
**Then** Free to use never appears there (Plan only).

**Given** hidden amounts or TalkBack
**When** the tile renders
**Then** it reads `₹ ••••` / `Short by ₹ ••••`, and TalkBack reads `Free to use, estimate, 12,000 rupees. Double-tap to see how we worked this out` or `Not enough information yet. Set a limit, button`.

**Covers:** BDG-008, GOAL-002 (set aside reduces Free to use), GOAL-004 (over-allocation warning), UX-DR27, UX-DR108, J-BILLS, J-GOAL

### Story 6.10: Home cards — Coming up and Savings goal

As Arjun,
I want Home to show my next bills and my goal's progress,
So that I see what's coming without opening Plan.

**Acceptance Criteria:**

**Given** the Story 5.4 Home card registry
**When** this story lands
**Then** it registers `coming_up` and `savings_goal` after `spend_7d` (PRD §6.3 order), each with title, visibility rule, sizes and drill-down, without changing Home; SCR-05 (Story 5.6) lists them as `Coming up` (caption `Shows when you add a bill` while hidden by its rule) and `Savings goal` (`Shows when you have a goal`).

**Given** at least one active bill
**When** the Coming up card renders
**Then** it is titled `Coming up` with the scope caption `Before payday` (or `Before month-end`) and lists up to 3 unpaid occurrences in the period as compact timeline rows (`Rent · 5 Dec · ₹18,000` with the Story 6.2 status line), then `+2 more` opening Plan, each row opening the bill detail
**And** with nothing due before the period end it reads `Nothing due before payday`; without active bills the card is not rendered.

**Given** at least one active goal
**When** the Savings goal card renders
**Then** it shows the active goal with the nearest `By` date (otherwise the most recently contributed) with its limit bar `₹5,000 of ₹30,000` and `₹25,000 to go`, plus `+1 more goal` opening SCR-17; tapping the goal opens its detail; without active goals the card is not rendered.

**Given** these cards
**When** they render
**Then** neither shows Free to use, the hero is unchanged, and they refresh on `RecurringChanged`, `GoalsChanged` and date change.

**Given** hidden amounts, TalkBack and 320dp × 200% text
**When** they render
**Then** amounts and bars follow Story 5.3, titles are headings, each row is one node, and nothing truncates.

**Covers:** HOM-001 (coming up, savings goal), HOM-002, UX-DR26 (new cards), GOAL-003 (Home form)


## Epic 7: Insights

Arjun opens the Insights tab and, on one scrolling screen ordered by question (Where did it go? · Is it going up? · Who got it? · Am I on track?), sees exactly where his money went for the period he picks, whether spending is rising compared fairly with the same days of the previous period, which merchants got the most and whether his budgets, Needs / Wants / Savings and goals are on track. Every figure states its scope, every chart can be read as a table and tapped through to the exact entries behind it, refund surpluses read `₹X back` with no minus sign, and Back always returns him to the same chart, period and filters (FLOW-11). The epic adds the read-only `insights` query set in core (AD-3: reads ledger, planning and profile only; periods only from the AD-7 period service), the SCR-11 overview and SCR-12 drill-down, and reuses the Story 5.5 `<BarChart>`, the Story 6.9 KPI tile, the Story 4.6 limit bar, the Story 4.11 Needs / Wants / Savings bars, the Story 6.7 `goalProgress` query, the Story 3.6 filter model and the Story 5.3 mask. It adds no ledger tables and changes no amounts. The UX spec defines the charts, drill-down, period behaviour and N/W/S patterns but not the SCR-11 layout; that layout is built from the existing card, KPI tile, filter chip row and section heading patterns, and each story says so where it applies.

### Story 7.1: Insights aggregation core with like-for-like comparisons

As Arjun,
I want every Insights figure to be counted the same exact way from what I've confirmed, for exactly the dates I picked, and compared only with the same days of the previous period,
So that I can trust a number like "↑ 12% vs Oct 1–8" without wondering what it includes.

**Acceptance Criteria:**

**Given** the read-only `insights` module in `packages/core/src/insights` (AD-3)
**When** this story lands
**Then** it exposes pure query functions taking an `InsightsScope` value (`period` from the period service, plus optional filters `accountIds`, `categoryIds`, `merchantKeys`, `types`, `tags`, `sources`), reads only through ledger, planning and profile queries (architecture test: no import of another module's tables, no `capture` import), and asks the AD-7 period service for every boundary (architecture test: no date arithmetic on period boundaries inside `insights`)
**And** every query result carries its `scope` echo (period start, exclusive end, label such as `1–30 Nov` or `1–24 Nov · Shortened cycle`, and the active filters) so every screen can print a scope label without recomputing it.

**Given** eligibility (INS-003)
**When** any spending, income or category query runs
**Then** it counts only `confirmed`, non-removed transactions and their posted category splits; transfers (including card bill payments and moves into savings pots) are never spending or income; `needs_review` (waiting, possible duplicate, waiting for currency), rejected, excluded and reversed entries are never counted; a transfer fee counts as spending; entries tagged `before tracking started` (FIN-016) count like any other confirmed entry
**And** a separate `waitingInScope(scope)` returns the count of `needs_review` entries whose `local_date` falls in the scope, so screens can say what was left out.

**Given** sign and refund treatment (INS-005, BDG-006, FIN-028)
**When** `spendingByCategory(scope)` runs
**Then** each top-level category's net = expense splits − refund splits (linked or categorised) in scope, with subcategories rolled into the parent; the result keeps the exact signed net per category internally, a display amount floored at ₹0 and a `backMinor` (the positive surplus) for categories whose refunds exceed spending; Uncategorised and `Not itemised` splits form one `Not classified` row, ranked like any category
**And** `spendingTotal(scope)` is the exact refund-net sum of all category nets (not floored per category, PRD BDG-006 "Insights totals stay exact"), returned as `spentMinor` when ≥ 0 or as `backMinor` when refunds exceed spending, never as a negative value to a UI caller (type-level: the view type has no signed money field).

**Given** the November fixture: Food ₹10,000 spent; Shopping ₹2,000 spent and a ₹9,000 refund for an October TV; a ₹50,000 overall budget
**When** `spendingByCategory` and `spendingTotal` run for November
**Then** Food is ₹10,000, Shopping is ₹0 with `backMinor` ₹7,000, the total is `spentMinor` ₹3,000, Story 4.5's `budgetUsed` still returns ₹10,000, and October's figures are unchanged (GATE-07 fixture test).

**Given** interval semantics (INS-005)
**When** any query filters by date
**Then** it uses the transaction's `local_date` in the profile timezone with inclusive start and exclusive end internally; a custom range `1–8 Nov` chosen by the user is converted to [1 Nov, 9 Nov) once, by the period service
**And** tests cover an entry at 23:30 local time on the last day of a period (London profile across the BST change and an India profile), a payday cycle with the early-salary rule, a shortened cycle (Story 4.8) and a leap-year February; all money stays integer minor units in the profile currency (no floating point anywhere in `insights`, lint rule).

**Given** `comparableWindow(scope, today)` (INS-004)
**When** the selected period is still running (today inside it)
**Then** the current window is [period start, today + 1 day) of N days and the previous window is the first N days of `previousPeriod(period)` from the period service (for pay cycles, cycle day 1 to day N), capped at the previous period's length; when the selected period has ended, the whole period is compared with the whole previous period
**And** for presets without a natural previous period it uses: `Today` → yesterday; `Yesterday` → the day before; `7 days` → the 7 days before; `Custom` → the same number of days immediately before; `This year` → the same days of last year; `This quarter` → the first N days of the previous quarter.

**Given** `spendingChange(scope, today)` (INS-015)
**When** it runs
**Then** it returns `change = (current − previous) ÷ |previous|` as a whole percent (rounded half away from zero) with direction `up | down | same`, plus the previous window's label (`Oct 1–8`, or `Oct 25–Nov 1` for a pay cycle), only when the previous window's exact refund-net spending ≠ ₹0 and the previous window starts on or after the profile's first day; otherwise it returns `no_baseline`
**And** the PRD fixture (1–8 Nov ₹14,000, 1–8 Oct ₹12,500, today 8 Nov) returns `up`, `12`, `Oct 1–8`, and a test proves the whole of October (₹40,000) is never used as the baseline.

**Given** `kept(scope)` (INS-016)
**When** it runs
**Then** with confirmed income > ₹0 it returns `keptPercent = (income − spent) ÷ income` as a whole percent, where `spent` is the exact refund-net total floored at ₹0 for this ratio (so it never exceeds 100%), and `keptMinor = income − spent` when ≥ 0 or `shortMinor = spent − income` when spending exceeds income (never a negative percent); with zero income it returns `no_income`.

**Given** the GATE-07 finance fixtures and a property suite
**When** core tests run
**Then** for random ledgers the sum of `spendingByCategory` nets equals `spendingTotal`, the sum of per-day nets over a period equals the period total, filtering by an account returns only splits posted on that account, and no query output exposes a negative money value to the UI layer.

**Covers:** INS-003, INS-004, INS-005, INS-015 (formula), INS-016 (formula), AD-3, AD-7

### Story 7.2: Insights overview with the period picker, filters and KPI tiles

As Arjun,
I want the Insights tab to open on my pay cycle with Spent, Income, Spending change and Kept tiles that I can re-scope by period, account, category, merchant, type, tags or source,
So that I can see the headline answer for exactly the slice of my money I care about.

**Acceptance Criteria:**

**Given** the Insights tab
**When** this story lands
**Then** its root becomes SCR-11 Insights overview (replacing the header-only screen from Story 1.10): the standard tab header (title `Insights`, Accounts icon, avatar), a period chip row, the filter chip row, a 2 × 2 grid of KPI tiles and then the question sections, which later stories in this epic register in the order `Where did it go?`, `Is it going up?`, `Who got it?`, `Am I on track?` through an Insights section registry (id, heading, order, visibility rule), so adding a section never changes the overview; a section that has not landed is simply absent (never "coming soon"). The layout is built from the existing card, KPI tile (UX-DR27), filter chip row and heading patterns because the UX spec does not define SCR-11.

**Given** a profile with payday on the 1st and no change made in Insights
**When** SCR-11 opens
**Then** the period chip reads `This pay cycle · 1–30 Nov` (calendar month profile: `This month · 1–30 Nov`; shortened cycle: `This pay cycle · 1–24 Nov · Shortened cycle`), the same default period Plan and Home use (DEC-33).

**Given** the period chip
**When** Arjun taps it
**Then** a bottom sheet (common anatomy) titled `Period` lists the §6.5 presets as radio rows: `This pay cycle` and `Last pay cycle` (only when a payday is set), `Today`, `Yesterday`, `7 days`, `This month`, `Last month`, `This quarter`, `This year`, `Custom`; `This month` is always present so calendar month is one tap away; `Custom` opens a start / end date pair (inclusive, profile timezone) with `Error: end date must be on or after the start` and `Error: pick dates up to today`, keeping input
**And** choosing a preset closes the sheet and every tile and section re-renders for that period with its label updated, and TalkBack announces `Period: Last pay cycle, 1 to 31 October`.

**Given** the selected period and filters
**When** Arjun moves between SCR-11, SCR-12, filtered Activity and SCR-08 inside the Insights stack, or switches tabs and comes back
**Then** they are kept (transient Insights-stack UI state, as Story 3.6 does for Activity), are gone after process death, and a `ProfileChanged` that moves the default period (payday change, Story 4.8) moves a default-period selection to the new period; Home, Plan and Activity are never changed by an Insights selection (test).

**Given** the filter chip row (Story 3.6 pattern: `Filters · N`, one removable chip per active filter, `Clear all` at two or more)
**When** Arjun opens `Filters · N`
**Then** the Insights filter sheet offers `Accounts`, `Categories`, `Merchant` (search over normalized merchants seen in the period), `Type` (`Expense`, `Income`, `Refund`), `Tags` (shown only when at least one entry has a tag) and `Source` (only the sources present in the ledger, e.g. `Added by you`, `CSV import`), with `Reset` and `Apply`; the shared Story 3.6 filter model gains the `merchantKeys`, `tags` and `sources` fields so Activity can apply the same filters on drill-down
**And** waiting and rejected entries cannot be included from Insights (no status filter here), and choosing only `Refund` shows refund totals as money back.

**Given** filters are active
**When** labels render
**Then** every tile and chart scope label names the scope first (`Spent · HDFC only`, `Spent · 2 accounts`, `Spent · HDFC only · Food`), as PRD §6.5 requires.

**Given** the KPI tiles (UX-DR27 tile from Story 6.9: `card` + `amount` role, label, caption)
**When** SCR-11 renders for November (Food ₹10,000, Shopping ₹2,000 with ₹9,000 refunded, Salary ₹85,000)
**Then** `Spent` reads `₹3,000` (exact refund-net total, caption scope) or, when refunds exceed spending overall, `₹7,000 back` with the refund icon and no minus sign; `Income` reads `+₹85,000` in `semantic-income`; `Spending change` reads `↑ 12% vs Oct 1–8` / `↓ 8% vs Oct 1–8` / `No change vs Oct 1–8` in `text-primary` (an increase is never red or labelled bad), or `No baseline yet` with no arrow; `Kept` reads `Kept 96%` with a 270° gauge arc (fill `accent`, track `bg-muted`) and the caption `Cash flow, not savings`
**And** with zero income the Kept tile reads `No income recorded` with no gauge and never `Kept 0%`; when spending exceeds income it reads `Spent ₹3,200 more than came in` with the gauge empty and no minus sign.

**Given** the Kept gauge is a chart
**When** Arjun taps `View as table` on the Kept tile
**Then** it shows the rows `Income`, `Spent`, `Kept` with amounts and the percent, header row announced as headers, each row a single TalkBack node (`Kept, 82,000 rupees, 96 percent`), scope label read first.

**Given** an empty or minimal period (INS-006)
**When** SCR-11 renders
**Then** with no confirmed entries in the period it shows `Nothing recorded for 1–30 Nov yet.` with the button-text `Add an expense` (opens the Add sheet) instead of tiles or charts; a period that starts before the profile's first day shows the caption `wmbugo has entries from Thu 5 Nov` and counts only from then, never showing zeros for days before wmbugo existed
**And** when `waitingInScope` > 0 a 48dp row under the tiles reads `3 waiting entries aren't counted · Review` and opens SCR-10.

**Given** loading, a failing query or a change
**When** SCR-11 is shown
**Then** skeleton tiles show on first load (never a spinner), a failing tile or section alone shows `Couldn't load this` with `Retry` and nothing is shown as zero, and `TransactionsChanged`, `CategoriesChanged`, `BudgetsChanged`, `GoalsChanged`, `AccountsChanged`, `ProfileChanged`, `BackupRestored` and a date change recompute through the catalogue's `insights` area without restart (one test per trigger).

**Given** hidden amounts (Story 5.3), TalkBack and 320dp × 200% text
**When** the tiles render
**Then** amounts read `₹ ••••`, the Kept gauge and every percentage and arrow are not rendered or announced (the tile reads `Kept ₹ ••••`, the change tile keeps only `vs Oct 1–8`), tiles stack in one column at fontScale ≥ 1.3 or width < 360dp without truncation, each tile is one node (`Spending change, up 12 percent versus October 1 to 8`), and the section headings are headings.

**Covers:** INS-001, INS-006 (safe empty prompts), INS-007 (overview and section order), INS-015 (tile, "No baseline yet"), INS-016 (Kept gauge, "No income recorded"), SCR-11, UX-DR27 (Insights tiles), UX-DR68 (SCR-11 states), UX-DR94 (Kept table)

### Story 7.3: Insight drill-down to the exact entries, with explanation and CSV export

As Arjun,
I want to tap any tile, bar or table row and see the entries behind it, how the figure was worked out, and get them out as a CSV,
So that every number in Insights can be checked against my own records and taken elsewhere.

**Acceptance Criteria:**

**Given** a drill-down target (an `InsightsScope` narrowed to the segment: e.g. category Food, or the day 5 Nov, or merchant Swiggy, plus the overview's period and filters)
**When** Arjun taps the `Spent` or `Income` tile (and, from later stories, any chart segment or table row)
**Then** SCR-12 Insight drill-down is pushed inside the Insights stack (UX-DR96) with: a title naming the segment (`Food`), the scope label first (`Spent · 1–30 Nov · HDFC only`), the segment amount in `headline`, a Story 5.5 `<BarChart>` of the segment's refund-net spending per day (per week for periods over 31 days, per month over 92 days) with `View as table`, a `How this is worked out` block, and the contributing entries as Activity rows (Story 3.5) grouped under refund-net day headers
**And** each row opens SCR-08 in the same stack; a `See in Activity` button-text pushes SCR-07 filtered to the same scope (Story 3.6 filters, extended in Story 7.2) inside the Insights stack.

**Given** any drill-down
**When** the contributing entries are listed
**Then** they are exactly the transactions (or split portions, for a category or Needs / Wants target) counted in the segment, and a test asserts their refund-net sum equals the segment value for every segment type built so far (`Spent`, `Income`, per day, per category with a refund, per account filter), PRD §8.9 acceptance.

**Given** `How this is worked out` (PRD §8.9 explainability)
**When** it renders
**Then** it states the formula in words (`Confirmed spending minus refunds. Transfers and entries waiting for you aren't counted.`), the timeframe (`1–30 Nov`), the source count (`From 23 entries`) and, for a comparison, the baseline (`Compared with Oct 1–8: ₹12,500`, or `No baseline yet: nothing was recorded on those days`).

**Given** Arjun is in filtered Activity or SCR-08 reached from Insights
**When** he presses Back (or swipes back) one step at a time
**Then** he returns to SCR-12 and then SCR-11 with the same period, filters, scroll position, chart and `View as table` state as he left them (FLOW-11 Back-restore test on the release build), and the Activity tab's own filters are untouched.

**Given** a segment worth ₹0 or with refunds exceeding spending
**When** SCR-12 renders
**Then** a ₹0 segment shows `Nothing spent here in 1–30 Nov.` with no chart, and a refund-surplus segment shows `Shopping · ₹7,000 back` with the refund icon, its bars at zero labelled `₹7,000 back`, and no minus sign in the chart, its table or the rows.

**Given** `Export as CSV` in the SCR-12 overflow menu (INS-006)
**When** Arjun chooses it
**Then** the Android system save dialog (Storage Access Framework, no network, no app permission) offers `wmbugo-food-2026-11-01-to-2026-11-30.csv`, and the file holds header lines `# Period 2026-11-01 to 2026-11-30 (inclusive)`, `# Filters: Account HDFC; Category Food`, `# Timezone Asia/Kolkata`, `# Currency INR`, `# Schema wmbugo-insights-1`, then one row per contributing entry: `date,merchant,category,account,type,amount,currency,note` with `amount` as an unsigned decimal and `type` carrying direction (`expense`, `refund`, `income`)
**And** any cell starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` (formula-injection escaping, test), a toast reads `Exported 23 entries`, cancelling the dialog writes nothing, and the CSV writer lives in `packages/core/src/shared/csv` so Epic 9's exports reuse it.

**Given** hidden amounts or TalkBack
**When** SCR-12 renders
**Then** amounts, chart fills and percentages follow Story 5.3, `Export as CSV` is still available (the file is the user's own data), the title and `How this is worked out` are headings, and each Activity row keeps its Story 3.5 TalkBack order.

**Covers:** INS-002 (drill-down, explainability), INS-006 (export underlying data), SCR-12, FLOW-11, UX-DR65 (drill-down and Back-restore), UX-DR96 (Insights stack)

### Story 7.4: Where did it go? — category donut and ranked bars

As Arjun,
I want a donut and a ranked list of my spending by category for the period, with refund-heavy categories shown as money back,
So that I can see at a glance where my money went.

**Acceptance Criteria:**

**Given** the Insights section registry
**When** this story lands
**Then** it registers `Where did it go?` as the first section: a `card` with the heading, the scope label first (`Spent by category · 1–30 Nov`), a Victory Native XL donut (on `bg-surface`, never on gradient) and below it the ranked horizontal bars using the Story 5.5 `<BarChart>`.

**Given** `spendingByCategory(scope)` for November (Food ₹10,000, Fuel ₹4,000, Rent ₹18,000, Not classified ₹2,000, Shopping ₹2,000 spent with ₹9,000 refunded)
**When** the section renders
**Then** the ranked bars list every category with a display amount above ₹0 by amount, highest first, each with the 40dp category icon chip in its palette colour, name, `₹18,000` and its share (`53%`) as direct labels, where share = display amount ÷ the sum of display amounts above ₹0 (INS-012 eligible total) so the shares add to 100%
**And** Shopping is listed after them as `Shopping · ₹7,000 back` with the refund icon and its bar at zero labelled `₹7,000 back`, no share and no minus sign; the line under the chart reads `Total spent ₹27,000 · after ₹7,000 back` (the exact Story 7.1 total).

**Given** the donut
**When** it renders
**Then** it shows one segment per category above ₹0 in its palette colour (up to 6; the rest combine into `Other · 4 categories` in `bg-muted` with a 1px `text-secondary` outline), a 2dp `bg-surface` gap between segments, a direct label on every segment (name + %; outside with a leader line when the segment is under 8%), the centre text `4 categories`, and no segment for refund-surplus categories.

**Given** Arjun taps a donut segment, a bar or a table row
**When** the drill-down opens
**Then** SCR-12 (Story 7.3) opens for that category and scope, and `Other` opens SCR-12 listing its categories, each opening its own drill-down.

**Given** `View as table`
**When** Arjun switches
**Then** one table replaces both the donut and the bars with columns `Category`, `Amount`, `Share`, the refund-surplus row reading `Shopping`, `₹7,000 back`, `—`, the header row announced as headers, each row one TalkBack node (`Food, 10,000 rupees, 29 percent`; `Shopping, 7,000 rupees back`) and the scope label read first.

**Given** no spending in scope, or only one category
**When** the section renders
**Then** no spending shows `Nothing spent in 1–30 Nov.` with no chart; one category shows a full ring labelled `Food · 100%` and the single bar.

**Given** hidden amounts, TalkBack and 320dp × 200% text
**When** the section renders
**Then** donut segments, bar fills and every percent are not rendered (category names, icons and order stay), amounts read `₹ ••••`, the donut is one decorative node with `View as table` announced next (PRD §8.9 acceptance), and labels wrap below the name without truncation.

**Covers:** INS-012, INS-007 (Where did it go?), INS-002 (table, drill-down), UX-DR65 (donut, `₹7,000 back`), UX-DR94 (category table)

### Story 7.5: Is it going up? — expense trend and income vs expense

As Arjun,
I want to see how my spending moved through the period and how money in compared with money out over recent periods,
So that I can tell whether my spending is rising without being told it's bad.

**Acceptance Criteria:**

**Given** the Insights section registry
**When** this story lands
**Then** it registers `Is it going up?` after `Where did it go?` with two cards: `Spending over time` and `Money in and out`.

**Given** `spendingTrend(scope, granularity)` in core
**When** it runs
**Then** it returns one bucket per day, week (starting on the profile's first day of week) or month in scope with the exact refund-net confirmed spending of that bucket (`spentMinor`, or `backMinor` when refunds exceed spending), buckets clipped to the profile's first day, and per-day buckets that equal the Activity day header `Spent` whenever that day is not refund-surplus (cross-check test).

**Given** the `Spending over time` card
**When** it renders
**Then** it shows the scope label (`Spent per day · 1–30 Nov`), a segmented control `Day · Week · Month` (UX-DR35) defaulting to Day for periods up to 31 days, Week up to 92 days and Month beyond, with options that would give fewer than 2 buckets omitted, and a Victory Native XL line with a 16%-alpha `accent` area fill on `bg-surface`, a point and direct value label on the highest bucket and on today's bucket, and dates on the x axis
**And** a refund-surplus bucket is plotted at zero with its label `₹1,200 back` and the refund icon, never below the axis.

**Given** fewer than 2 buckets with data (e.g. the profile started today)
**When** the card renders
**Then** it shows no line and no arrow, only `No baseline yet` with the caption `A trend needs at least 2 days of entries.`

**Given** `incomeVsExpense(scope)` in core
**When** it runs
**Then** it returns the selected period and up to 5 previous periods of the same kind from the period service (only periods that end after the profile's first day), each with confirmed income, exact refund-net spending (floored at ₹0 for the bar, surplus as `backMinor`) and net, transfers excluded.

**Given** the `Money in and out` card
**When** it renders for a pay-cycle profile with 3 cycles of history
**Then** it shows 3 groups (`Sep`, `Oct`, `Nov`, labelled by period start month, or `1–7 Nov` for weekly periods), each with an `In` bar in `semantic-income` and an `Out` bar in `semantic-expense`, a legend with the words `In` and `Out`, direct labels `+₹85,000` and `₹27,000`, and under each group `Net +₹58,000`, `Net ₹3,200 out` or `Net ₹0` (Story 5.4 wording, no minus sign)
**And** with only the current period it shows that one group and the caption `Earlier periods show up as you use wmbugo.`

**Given** Arjun taps a trend point, an `In` bar or an `Out` bar, or the matching table row
**When** the drill-down opens
**Then** SCR-12 opens for that bucket's dates (spending) or that period's income, and its list sums to the tapped value.

**Given** `View as table` on either card
**When** Arjun switches
**Then** the trend table lists `Date`, `Spent` per bucket (`₹1,200 back` for surplus buckets) and the in/out table lists `Period`, `In`, `Out`, `Net`, with header rows announced as headers, each row one node (`October, in 85,000 rupees, out 27,000 rupees, net 58,000 rupees kept`) and the scope label first.

**Given** hidden amounts, TalkBack, reduced motion and 320dp × 200% text
**When** the cards render
**Then** the line, area and bar fills are not rendered while axes and dates stay and amounts read `₹ ••••`; charts are decorative nodes followed by `View as table`; there is no draw-in animation under reduced motion; the segmented control becomes a radio list at fontScale ≥ 1.3.

**Covers:** INS-010, INS-011, INS-004 (no trend from fewer than 2 points), INS-007 (Is it going up?), INS-002, UX-DR65 (trend and grouped bars), UX-DR94 (trend and in/out tables)

### Story 7.6: Who got it? — top merchants

As Arjun,
I want a ranked list of the merchants who got most of my money in the period,
So that I can see whether it's Swiggy, Amazon or the petrol pump eating my budget.

**Acceptance Criteria:**

**Given** `spendingByMerchant(scope)` in core
**When** it runs
**Then** it groups eligible expense and refund splits (Story 7.1 rules) by normalized merchant key (the Story 3.1 normalizer, LRN-009 rule), shows the user's display name for the merchant, returns the exact refund-net per merchant floored at ₹0 for display with `backMinor` for surplus, and puts entries with no merchant in one `No merchant` group.

**Given** the Insights section registry
**When** this story lands
**Then** it registers `Who got it?` after `Is it going up?` as a card with the scope label first (`Top merchants · 1–30 Nov`) and the Story 5.5 `<BarChart>` showing the top 10 merchants by display amount, highest first, each bar directly labelled with the merchant name and `₹6,450`, then `No merchant · ₹1,800` after the ranked merchants, then refund-surplus merchants as `Amazon · ₹2,000 back` with the refund icon and the bar at zero
**And** when more than 10 merchants have spending, a `See all 37 merchants` button-text expands the list in place.

**Given** Arjun taps a merchant bar or table row
**When** the drill-down opens
**Then** SCR-12 opens for that merchant and scope, listing the entries whose normalized merchant matches, summing to the bar; `No merchant` opens its entries the same way.

**Given** a merchant filter is active on SCR-11
**When** the section renders
**Then** it shows just that merchant's bar with the scope label `Top merchants · Swiggy only`.

**Given** `View as table`
**When** Arjun switches
**Then** the table lists `Merchant`, `Amount`, `Entries` (count), header row announced as headers, each row one node (`Swiggy, 6,450 rupees, 14 entries`), scope label first.

**Given** no spending in scope
**When** the section renders
**Then** it reads `Nothing spent in 1–30 Nov.` with no chart.

**Given** hidden amounts, TalkBack and 320dp × 200% text
**When** the section renders
**Then** bar fills are not rendered, amounts read `₹ ••••` while merchant names and entry counts stay, and long merchant names wrap to two lines then ellipsise the name only, never the amount.

**Covers:** INS-014, INS-007 (Who got it?), INS-002, UX-DR65 (merchant bars), UX-DR94 (merchant table)

### Story 7.7: Am I on track? — budgets, Needs / Wants / Savings and goal rings

As Arjun,
I want the last section of Insights to show my budgets, my 50/30/20 split and my savings goals for the period I'm looking at,
So that after seeing where my money went I can see whether I'm still on plan.

**Acceptance Criteria:**

**Given** the Insights section registry
**When** this story lands
**Then** it registers `Am I on track?` as the last section with three cards in order: `Budgets`, `Needs, Wants, Savings` and `Goals`, each hidden by its own rule below.

**Given** the selected period is a budget period (the default period, `Last pay cycle` / `Last month` on that default, or a past default period)
**When** the `Budgets` card renders
**Then** it lists the overall budget first, then category budgets ordered by percentage used, highest first, as Story 4.6 limit-bar rows from `budgetStatus` for that period (`₹3,400 of ₹4,000`, `85% used`, warning icon + `Over by ₹600`, or `₹2,600 left`), with the target version that period had (Story 4.5) and a refund surplus shown as `Refunds this period: +₹7,000`; budgets on another period kind (weekly, custom) show their period that overlaps the selection's end with their own scope caption (`This week`)
**And** each row and table row opens SCR-15 for that budget and period pushed in the Insights stack; with no budgets the card is not rendered; for a selection that is not a budget period (`7 days`, `This quarter`, `Custom`) the card reads `Budgets are shown for whole pay cycles or months. Pick one to see them.` with `This pay cycle` as a button-text that switches the period.

**Given** 50/30/20 or custom N/W/S targets and a budget period selected
**When** the `Needs, Wants, Savings` card renders
**Then** it reuses the Story 4.11 bars and query (`needsWantsSavings(period)`: `₹22,000 of ₹40,000`, N/W/S colours with the 1px `text-secondary` outline on light surfaces, Savings never in warning tint, `Not classified ₹3,000 · Sort it`), drawn with the per-series patterns (needs solid, wants dotted, savings hatched) and a 2dp `bg-surface` gap so the series never rely on colour alone, with no moral labels
**And** tapping a bar opens its Story 4.11 drill-down (categories for Needs / Wants, transfers for Savings) pushed in the Insights stack, each category row continuing to SCR-12; without targets the card shows the three amounts without bars plus `No targets set · Try 50/30/20`, which opens the Story 4.10 flow.

**Given** at least one active or paused goal
**When** the `Goals` card renders
**Then** it shows one ring per goal (Victory Native XL arc, 8dp stroke, goal palette colour on a `bg-muted` track, capped at a full ring) from `goalProgress` (Story 6.7: set aside held + moved to savings), with the goal icon in the centre, the name and `₹5,000 of ₹30,000` beneath, and the pace line from Story 6.7 (`About ₹5,000 a month · done by Mar 2027` or `Not enough history for a pace yet`); the scope label reads `Goals · all time` because goals are not period- or filter-scoped
**And** tapping a ring or its table row opens the goal detail (Story 6.6) with its allocation history pushed in the Insights stack; a fully funded goal shows a full ring with `Goa trip is fully funded`; with no active or paused goals the card is not rendered.

**Given** account or category filters are active on SCR-11
**When** this section renders
**Then** budget rows keep their own scope (the budget's categories and accounts, not the SCR-11 filter) and say so with the caption `Budgets use their own categories and accounts`, and the N/W/S and Goals cards show the same caption pattern, so a filtered view never presents a partial budget as the whole.

**Given** `View as table` on each card
**When** Arjun switches
**Then** budgets list `Budget`, `Used`, `Target`, `Status` (`Over by ₹600`, `₹2,600 left`); N/W/S list `Needs`, `Wants`, `Savings`, `Not classified` with amount, target and percent; goals list `Goal`, `Contributed`, `Target`, `To go`; header rows are announced as headers, each row is one node (`Needs, 22,000 of 40,000 rupees, 55 percent`) and the scope label is read first; no minus sign in any table.

**Given** hidden amounts, TalkBack and 320dp × 200% text
**When** the section renders
**Then** limit bars, N/W/S bars and goal rings are not drawn with their space kept, percentages are not rendered or announced, amounts read `₹ ••••` while `Over by ₹ ••••`, pace dates and goal names stay, and rings stack two per row at fontScale ≥ 1.3 without truncation.

**Covers:** INS-013, INS-020, INS-025, INS-007 (Am I on track?), INS-002, UX-DR65 (N/W/S patterns, rings), UX-DR94 (budget, N/W/S and goal tables)

### Story 7.8: Insights accessibility, privacy and performance pass

As Arjun,
I want Insights to stay smooth with years of entries and to work fully with TalkBack, large text and hidden amounts,
So that every chart is usable however I use my phone and never shows my money to someone looking over my shoulder.

**Acceptance Criteria:**

**Given** the Story 1.3 method on the reference devices with 10,000 ledger records spread over 24 months
**When** Insights opens from the tab bar and Arjun scrolls the whole overview and changes the period to `This year`
**Then** the tile skeletons show within the NFR-03 median of 300 ms, ≥ 95% of frames during scroll and chart transitions render at 60 FPS with no stall > 100 ms (NFR-06), and the benchmark is recorded in CI artefacts.

**Given** the `insights` queries
**When** they run
**Then** aggregation happens in SQLite (`GROUP BY` over `local_date`, category, merchant key) through the async database driver, never as a JS loop over transaction rows on the UI thread (test asserting each query issues aggregate SQL and an EXPLAIN check that it uses the Story 5.1 `transaction.local_date` / status and `split.category_id` indexes, adding a `transaction.merchant_key` index as a ledger-module migration if the plan needs it)
**And** each section's query is cached by TanStack Query under the scope key, so changing a filter recomputes only the sections whose key changed, and the chart draws only after its data resolves (no re-render storm: render-count test).

**Given** a TalkBack test per chart (Kept gauge, category donut and bars, spending trend, in/out bars, merchants, budgets, N/W/S, goal rings)
**When** focus reaches each chart
**Then** the scope label is read first, the chart itself is a single summary node (`Spent by category, 1 to 30 November, 4 categories, highest Rent 18,000 rupees`), `View as table` is the next node and announced as a button, and in table mode the header row is read as headers and every row is one node listing every value (PRD §8.9 acceptance)
**And** the question headings are headings so TalkBack heading navigation moves between `Where did it go?`, `Is it going up?`, `Who got it?` and `Am I on track?`.

**Given** an audit test that turns hide amounts on and walks SCR-11 with every section, SCR-12 for each segment type and the Insights-stack Activity
**When** it inspects the rendered tree and accessibility labels
**Then** no money digits, no money-derived `%` glyph, no arrow from `Spending change`, no chart fill, ring or gauge arc is visible or announced, while scope labels, names, dates, counts and `View as table` stay, and turning it off restores everything without reloading data.

**Given** a lint and snapshot sweep of every Insights string, chart label and table cell, including refund-surplus fixtures
**When** it runs
**Then** no `-` or `−` precedes any amount or percent anywhere in Insights (Story 5.1 rule, UX-DR101), every surplus reads `₹X back` with the refund icon, and every chart is drawn on `bg-surface` (never on raw gradient).

**Given** 320dp × 200% text, dark mode and a 600dp navigation rail
**When** SCR-11 and SCR-12 render
**Then** tiles stack, chart direct labels move outside or wrap instead of overlapping, no label truncates a number, the last section stays fully above the tab bar and ＋, contrast of every series against `bg-surface` is ≥ 3:1 in both modes, and every control has a visible focus ring for D-pad and Switch Access.

**Covers:** NFR-06, INS-002 (accessible summaries), INS-007 (View as table on every chart), UX-DR94, UX-DR65 (hidden amounts, never on gradient), UX-DR74 (Insights audit), UX-DR101 (Insights)


## Epic 8: Privacy, security and backup

Users lock the app, keep amounts hidden from the switcher and lock screen, make an encrypted backup with a passphrase, restore it safely on this or a new phone, and manage or erase their data, while the app provably sends nothing anywhere.

### Story 8.1: Redacted logs, local crash records and the no-network guarantee

As Sara,
I want wmbugo's logs and crash records to contain nothing about my money, and the app to be provably unable to send anything anywhere,
So that even the diagnostics I might one day share can't expose my finances.

**Acceptance Criteria:**

**Given** the `Logger` port from Story 1.4 and its file adapter from Story 1.6
**When** this story lands
**Then** every log call takes an event name plus structured fields, and the redactor replaces the value of any field whose key is not on the allowlist in `packages/core/src/shared/logging` (ids, counts, codes, durations, schema and app versions, booleans) with `[redacted]`
**And** free text that reaches the log (error messages, stack-trace messages) is scrubbed: digit runs of 3 or more become `[n]`, anything shaped like an email or UPI ID (`x@y`) becomes `[id]`, and masked account numbers (`••4821`, `XX4821`, `A/c *4821`) become `[acct]`.

**Given** a core test session that logs a fixture entry (amount ₹1,18,600, merchant `Swiggy Instamart`, note `rent for Feb`, account `HDFC ••4821`, UPI ID `sara@okhdfc`, an image path and an SMS-like body)
**When** the log file is read back
**Then** none of those values appear in any form (redaction test), and the same test runs against the Diagnostics export in Story 8.10.

**Given** an uncaught JS error, an unhandled promise rejection or a native uncaught exception
**When** it happens
**Then** a redacted crash record (time, app version, schema version, error type, scrubbed message, stack frames) is written to `crashes/` in app-private storage through the Logger, at most 20 records kept, oldest dropped
**And** nothing is sent anywhere; JS source maps and native symbols for each release build are uploaded as CI artifacts so records can be symbolicated offline.

**Given** the log files
**When** they grow
**Then** they rotate at 1 MiB with one previous file kept (≤ 2 MiB total) in app-private storage, and no log or crash file is ever written to shared or external storage.

**Given** the release build's resolved Gradle dependencies and `pnpm-lock.yaml`
**When** CI runs
**Then** a dependency denylist check fails the build if any analytics, crash-reporting, ads, attribution or network SDK is present (at least Firebase, Crashlytics, Google Analytics / `play-services-measurement`, `datatransport`, Sentry, Bugsnag, AppsFlyer, Adjust, Facebook SDK), alongside the Story 1.1 permission-allowlist check, which still fails on `INTERNET` or `ACCESS_NETWORK_STATE`.

**Given** the permissions the app can request
**When** this story lands
**Then** `apps/mobile/src/shared/PERMISSIONS.md` lists each one (so far `POST_NOTIFICATIONS`) with the feature that needs it, the in-context rationale copy, what still works when it is denied, and how revocation in Android settings is handled
**And** a CI test fails if a permission on the release allowlist has no row in that file, and every runtime request goes through one shared `requestPermission(kind)` helper that is never called during onboarding (permission-spy test).

**Given** notification permission is revoked in Android settings while wmbugo is in the background
**When** the app resumes
**Then** the revoked state is reflected without restart (budget and bill screens show their Story 4.9 / 6.5 denied states) and no crash or prompt occurs.

**Given** a release build on an emulator behind an intercepting proxy
**When** the runbook in `scripts/privacy/proxy-audit` drives onboarding, Add, budgets and bills
**Then** the proxy records zero requests from `app.wmbugo` (the runbook is re-run in Epic 14 for every flow).

**Covers:** SEC-002 (denylist, proxy audit), SEC-003 (permission inventory, graceful revocation), SEC-007, NFR-02, NFR-15, AD-19 (redacting Logger, local crash capture, CI symbols)

### Story 8.2: Privacy settings, hiding wmbugo in recent apps and what stays on this phone

As Sara,
I want one Privacy place in Settings where I control what others can see and read plainly what does and doesn't leave my phone,
So that I'm in control without having to trust a vague promise.

**Acceptance Criteria:**

**Given** Settings (SCR-21)
**When** it renders
**Then** a `Privacy` group row now exists with a live summary that is part of its label, built from the parts that exist (`Amounts shown` in this story; Stories 8.3 and 8.5 prepend `App lock on|off` and append `Notifications: full|hidden`, giving `App lock off · Amounts shown · Notifications: full`), and TalkBack reads the summary with the row.

**Given** Settings › Privacy › `Hide amounts`
**When** Sara toggles it
**Then** it calls the Story 5.3 `SetHideAmounts` use case, so the hero eye, every screen and the row summary (`Amounts hidden`) change at once, and the reverse change from the hero eye updates this switch.

**Given** Settings › Privacy › `Hide wmbugo in recent apps` (default off, device setting `hide_in_recents`; switched on automatically when app lock is turned on, and can still be switched on without app lock)
**When** it is on
**Then** on Android 13+ the activity calls `setRecentsScreenshotEnabled(false)` so the app switcher shows no content, and on Android 8–12 `FLAG_SECURE` is set on the main activity, with the caption `On this phone this also blocks screenshots of wmbugo.` shown only on Android 8–12
**And** with it off, the recents snapshot shows the screen as it was (manual check on one device per branch, recorded in the story's test notes).

**Given** a modal sheet or the Add sheet is open when Sara leaves the app
**When** the switcher is shown
**Then** the same hiding applies (the setting is applied to every activity the app owns, including dialog-styled ones added later).

**Given** Settings › Privacy › `What stays on this phone`
**When** Sara opens it
**Then** it shows plain rows, each with one sentence:
`Your entries and photos` — `Stored encrypted on this phone. Nobody else can read them, including us.`;
`No internet` — `wmbugo has no internet permission, so it can't send anything.`;
`Android backups` — `Your phone's own backup and phone-to-phone transfer don't include wmbugo.`;
`Backup and export files` — `Files you save leave wmbugo. Where you put them, such as a cloud folder, decides who can reach them. Backups stay encrypted with your passphrase.`;
`Diagnostics` — `Only leaves your phone if you export it, after you've seen what's in it.`
**And** no row claims that bytes can never leave the phone under any circumstances.

**Covers:** SET-005 (Privacy group, hide amounts binding, app-switcher blur, privacy explanations), SEC-005 (app switcher hides values), BKP-007 (privacy UI explains external export), UX-DR60 (Privacy summary), UX-DR75 (app-switcher privacy)

### Story 8.3: App lock with LockGate and re-authentication

As Sara,
I want wmbugo to ask for my fingerprint or screen lock when I come back to it after a while,
So that someone picking up my unlocked phone still can't see my finances.

**Acceptance Criteria:**

**Given** Settings › Privacy › `App lock`
**When** Sara turns it on
**Then** the system BiometricPrompt (`Turn on app lock`) appears allowing a strong biometric or the device credential (Android 11+: `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`; Android 8–10: weak biometric with device-credential fallback), and only on success the `SetAppLock` use case stores `app_lock_enabled = true` with an audit row and `ProfileChanged`; the Privacy summary reads `App lock on`
**And** `USE_BIOMETRIC` is added to the release permission allowlist and `PERMISSIONS.md`.

**Given** the phone has no secure screen lock
**When** Sara tries to turn app lock on
**Then** the switch stays off and an inline message reads `Set a screen lock on your phone first.` with `Open settings` (opens Android security settings); nothing is saved.

**Given** app lock is on
**When** Sara picks `Lock after`
**Then** the chips are `Immediately`, `After 1 minute` (default), `After 5 minutes` and `After 15 minutes`, and the time away is measured with the monotonic elapsed-realtime clock so changing the phone's clock cannot skip the lock (test).

**Given** app lock is on
**When** the app cold-starts, or resumes after being in the background longer than `Lock after`
**Then** LockGate covers everything with the coin mark, `wmbugo is locked` and an `Unlock` button, starts the prompt automatically, renders no amount behind it (underlying tree hidden from accessibility), and the app-switcher hiding from Story 8.2 is enforced regardless of the `Hide wmbugo in recent apps` setting
**And** on success Sara returns to exactly the screen, scroll position and open sheet draft she left (FLOW-12 test); dismissing the prompt leaves her on LockGate with `Unlock`; a failed biometric falls back to the device credential; an OS lockout shows the OS message and `Try again`.

**Given** app lock is on and wmbugo is locked
**When** a budget alert (Story 4.9) or bill reminder (Story 6.5) is tapped, or a deep link arrives
**Then** the intent is held in a pending-intent queue, LockGate shows first, and after unlock the intent's destination opens; if unlock is abandoned the intent is dropped without opening anything
**And** the queue is the single entry point later used by the widget, capture notifications and shares (persistent queuing of shares is AD-12, Epic 12).

**Given** the shared re-authentication guard from Story 3.13
**When** app lock is on and a sensitive action is confirmed (delete permanently, turning app lock off, changing `Lock after`, and the restore and erase actions added later in this epic)
**Then** the prompt `Confirm it's you` appears; success performs the action, cancel performs nothing and keeps the screen as it was
**And** with app lock off the guard remains a no-op, and `apps/mobile/src/shared/STATES.md` adds `turn off app lock` to the confirm tier.

**Given** app lock state
**When** the database key is used
**Then** app lock remains a UI gate only: the key stays not bound to biometrics, so scheduled work (purge, reminders) runs while locked, and a change of enrolled fingerprints never locks Sara out (AD-9).

**Covers:** SEC-004, SEC-003 (USE_BIOMETRIC with rationale), SET-005 (app lock), UX-DR75 (LockGate, timeout, fallback, intents pass LockGate, return to where she was), UX-DR71 (re-auth), FLOW-12, AD-9

### Story 8.4: Offer app lock once after the first saved entry

As Mei,
I want wmbugo to suggest locking the app once, right after I've saved something worth protecting,
So that I learn the option exists without being asked during setup or nagged later.

**Acceptance Criteria:**

**Given** a profile with no saved entry and app lock off
**When** Mei saves her first entry (expense, income or transfer) and the Add sheet closes
**Then** after the `Saved · Undo` toast has appeared, a bottom sheet asks `Lock wmbugo with your fingerprint?` (or `Lock wmbugo with your screen lock?` when no biometric is enrolled) with the line `You'll unlock it when you open wmbugo. Change this anytime in Settings › Privacy.`, primary `Turn on app lock` and secondary `Not now`
**And** it never opens over another sheet and never during onboarding (onboarding run shows no such sheet).

**Given** the sheet is shown
**When** it appears
**Then** `prompt_state` records `app_lock_offer = shown` immediately, so it never appears again after `Not now`, Back, swipe-down or process death.

**Given** Mei taps `Turn on app lock`
**When** the Story 8.3 enable flow succeeds
**Then** app lock is on with `After 1 minute` and the toast reads `App lock on`; if she cancels the system prompt, app lock stays off and the offer is still never repeated.

**Given** app lock was already turned on in Settings before the first entry, or the phone has no secure screen lock
**When** the first entry is saved
**Then** no sheet appears; in the no-screen-lock case nothing is recorded and the offer is evaluated again after the next save.

**Given** the first entry is undone from the toast before the sheet appears
**When** the toast's Undo runs
**Then** the offer still appears at most once, on the next saved entry.

**Covers:** ONB-008, UX-DR75 (offered once after first saved entry)

### Story 8.5: Notification privacy — hidden form and notification detail

As Sara,
I want notifications to say `New payment to check` without amounts whenever my app is locked, my amounts are hidden or I choose it,
So that a colleague glancing at my phone in a meeting learns nothing.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** `settings` gains `notification_detail` (`full` | `hidden`, default `full`) and `full_notifications_opt_in` (boolean, default false), changed only via `SetNotificationPrivacy` with audit and `ProfileChanged`.

**Given** the pure core function `decideNotificationForm(kind, settings)` used by the Notifier port for every notification (AD-13)
**When** `kind = capture`
**Then** the shade form is `hidden` if `notification_detail = hidden`, or if (app lock on or hide amounts on) and `full_notifications_opt_in` is false; otherwise `full`
**And** the lock-screen form is always `hidden` unless a `lockScreenApprove` flag is true (parameter defaulting to false; its setting arrives with CAP-006 in Epic 11), and Approve / Reject actions are returned only for a `full` form (matrix test: notification_detail × app lock × hide amounts × opt-in × lock screen).

**Given** a hidden capture notification
**When** the Notifier adapter builds it
**Then** its title is `New payment to check`, it has no amount, merchant, account or category text, its only action is `Review`, and `Review` or a tap opens the app through LockGate, so unlock is required before any amount shows
**And** the template lives in the core string catalogue (never `wmbugo · 1 new transaction`), and a debug-only fixture command posts it so it can be checked on a device before capture sources exist.

**Given** `kind = budget` or `bill`
**When** the notification is built
**Then** the lock-screen public version from Stories 4.9 / 6.5 is always used on the lock screen, and while app lock or hide amounts is on the shade also shows the public wording (`Budget update · Tap to see`) instead of the percentage; bill reminders keep `Rent is due tomorrow`, which carries no money.

**Given** the home-screen widget arrives later
**When** it asks whether it may show amounts
**Then** the core helper `widgetMayShowAmounts(settings)` already returns false whenever app lock or hide amounts is on (unit test).

**Given** Settings › Privacy › `Notification detail`
**When** Sara opens it
**Then** she sees radio rows `Full details` and `Hidden — shows "New payment to check"`, a switch `Show full details even when app lock or hidden amounts is on` (off), and the caption `On the lock screen, payment details stay hidden unless you allow lock-screen approve.`
**And** the Privacy summary ends with `Notifications: full` or `Notifications: hidden` (the effective shade form for captures), and permission off shows `Notifications are off for wmbugo · Open settings` with the setting still editable (J-NOTIF).

**Given** Sara switches to hidden, turns app lock on or hides amounts
**When** `ProfileChanged` is delivered
**Then** any already-posted notification governed by the resolver is re-posted in the new form.

**Covers:** SEC-005 (hidden form, lock-screen rule, non-capture notifications), SET-005 (hide amounts and app lock apply to notifications and widget), UX-DR111, AD-13, J-NOTIF

### Story 8.6: Encrypted backup format in core

As Sara,
I want my backup file to be unreadable without my passphrase and to be rejected cleanly if it is tampered with or isn't a backup at all,
So that a lost or stolen backup file reveals nothing and a bad file can never hurt my data.

**Acceptance Criteria:**

**Given** a `Crypto` port in core (Argon2id key derivation, XChaCha20-Poly1305 secretstream, SHA-256, random bytes) with adapters for the libsodium binding (mobile) and `libsodium-wrappers` (Node tests)
**When** `packages/core/src/backup` writes a backup
**Then** the file is: magic `WMBUGOBK`, format version `1`, Argon2id parameters (opslimit 3, memlimit 64 MiB, stored so they can change later), a 16-byte random salt, a passphrase verifier block and the secretstream header, followed by 64 KiB encrypted chunks, the last tagged FINAL
**And** the plaintext stream is: `manifest.json`, then `db`, then `attachments/<uuid>` entries, each with length and SHA-256.

**Given** the manifest
**When** it is written
**Then** it holds format version, schema version, app ID, app version, created-at (UTC + profile timezone), counts (entries, accounts, photos), each account's derived balance in minor units, every entry's name, size and digest, and a checksum over the whole payload; the `db` entry is a SQLCipher database keyed with a random 256-bit archive key carried only inside the encrypted manifest.

**Given** the reader
**When** it opens a file
**Then** it returns typed `Result` errors: `NOT_A_WMBUGO_BACKUP` (bad magic or unknown format version), `WRONG_PASSPHRASE` (verifier fails), `BACKUP_DAMAGED` (any chunk fails authentication, stream ends without FINAL, digest or checksum mismatch), `BACKUP_TOO_NEW` (schema version above this app's) and `FILE_TOO_LARGE` (over 4 GiB)
**And** `readManifest` decrypts only the manifest, so a preview never extracts the rest.

**Given** malicious payloads (SEC-006)
**When** the reader validates entries
**Then** it rejects absolute paths, `..`, backslashes, duplicate names, names outside `manifest.json` / `db` / `attachments/<uuid>`, declared sizes larger than the remaining stream and totals above the manifest's declared sizes, all as `BACKUP_DAMAGED`, before anything is written outside a staging directory.

**Given** the fast-check property suite
**When** it runs
**Then** write → read round-trips arbitrary manifests and payloads byte-for-byte; flipping any single byte gives `WRONG_PASSPHRASE` (header region) or `BACKUP_DAMAGED`, never success; and a wrong passphrase never yields any plaintext.

**Given** the backup and restore code
**When** it handles plaintext
**Then** plaintext exists only in memory or inside app-private staging that is itself encrypted (SQLCipher with the archive key, or attachments under the device file key), and a lint rule blocks the `backup` module from writing to any path outside the injected staging and output handles.

**Covers:** BKP-001 (format, manifest, checksum), BKP-004, SEC-006 (archive validation; formula escaping already in Story 7.3's shared CSV writer), NFR-10 (backups need the passphrase), AD-10 (format), AD-9 (separate passphrase key), GATE-04 (backup format and threat model evidence)

### Story 8.7: Make a backup with a passphrase

As Sara,
I want to save an encrypted backup of everything to a place I choose, protected by a passphrase only I know,
So that I can get my data back if this phone is lost, reset or replaced.

**Acceptance Criteria:**

**Given** Settings › Data
**When** it renders
**Then** it gains `Back up` and the Data group summary reads `Last backup 3 Nov` (from `settings.last_backup_at`) or `No backup yet`.

**Given** Settings › Data › `Back up` (SCR-20)
**When** it opens
**Then** it explains `A backup is one encrypted file with your entries, accounts, photos and settings. If this phone is lost or reset, it's the only way to get them back.` and shows the shared passphrase field (UX-DR64) built in `apps/mobile/src/shared`: `Passphrase` and `Confirm passphrase`, a `Show` toggle (`Show passphrase, toggle`), paste and password managers allowed (`autoComplete="password-new"`), and the line `We can't recover this. Without it, the backup can't be opened.`

**Given** Sara types a passphrase
**When** it changes
**Then** a polite live region with icon + text reads `Use at least 12 characters` until it has 12 or more characters, then `Strong enough`; `Passphrases don't match` shows while the confirmation differs; `Save backup` stays disabled until both are satisfied.

**Given** `Save backup`
**When** Sara taps it
**Then** the Android system save dialog (Storage Access Framework, no permission) offers `wmbugo-backup-2026-11-08.wmbugo` with the note above it `You choose where it goes. Saved to a cloud folder, it leaves this phone, still encrypted.`
**And** cancelling the dialog writes nothing.

**Given** a chosen location
**When** the backup runs
**Then** the writer queue holds new use cases until the database export finishes (consistent snapshot; held work runs afterwards, nothing rejected), a full-screen progress view (`Making your backup…`, determinate bar, `Cancel`) shows, and only encrypted bytes are written to the chosen document
**And** a file-system test during backup finds no file with a `SQLite format 3` header, JPEG/PNG magic or manifest JSON in public or app-private storage, and staging is deleted afterwards and by a sweep on next start.

**Given** the backup completes
**When** it is saved
**Then** the screen shows `Backup saved` with `1,284 entries · 6 accounts · 42 photos` and `Keep this file somewhere safe. Without the passphrase it can't be opened.`, `last_backup_at` is set, and the Data summary updates.

**Given** `Cancel`, a full destination or a provider error
**When** the backup stops
**Then** the partial document is deleted, the message reads `Couldn't save the backup. Nothing on this phone changed.` with `Try again`, and the passphrase fields keep their content.

**Given** OS backup (BKP-006)
**When** `adb shell bmgr backupnow app.wmbugo` and a device-to-device transfer simulation run on the release build
**Then** neither contains the database, attachments, logs or keys (instrumented test against the Story 1.1 data-extraction rules), and `apps/mobile/src/shared/PERMISSIONS.md` gains a section documenting that user-saved backup and export files leave wmbugo's control.

**Covers:** BKP-001 (user flow, recovery implications), BKP-004, BKP-006 (verification and documentation), BKP-007, SET-004 (backup, last backup summary), UX-DR64, FLOW-10 (backup half), AD-10

### Story 8.8: RestoreBackup in maintenance mode

As Sara,
I want a restore to either finish completely or leave my phone exactly as it was,
So that a wrong file, a wrong passphrase or a crash mid-restore can never cost me my data.

**Acceptance Criteria:**

**Given** the `RestoreBackup` use case and a validated backup with its passphrase
**When** it runs
**Then** the writer enters maintenance mode (other use cases are refused with `MAINTENANCE`, scheduled work is skipped), the archive is decrypted and verified into app-private staging, the staging database is migrated forward with the bundled migrations, then re-keyed with this device's database key and attachments re-encrypted with the device file key.

**Given** the staged result
**When** it is verified before the swap
**Then** `PRAGMA quick_check` passes, the writer's registered invariants pass, and every account's recomputed balance equals the manifest's balance; any failure aborts with `BACKUP_DAMAGED`, deletes staging and leaves the working data untouched.

**Given** enough free space (at least 2× the current database plus attachments size)
**When** the swap happens
**Then** the current database and attachments are moved to a pre-restore safety copy, staging is moved into place by atomic renames recorded step by step in `restore.journal`, and the safety copy is kept only until the next successful start (database opens, `quick_check` passes, first query returns), then deleted.

**Given** less free space than that
**When** the use case is called without `withoutSafetyCopy = true`
**Then** it refuses with `LOW_SPACE_NEEDS_CONFIRMATION` and changes nothing; with the flag it proceeds without a safety copy.

**Given** a wrong passphrase, a damaged or non-wmbugo file, or a newer schema
**When** restore is attempted
**Then** it returns `WRONG_PASSPHRASE`, `BACKUP_DAMAGED`, `NOT_A_WMBUGO_BACKUP` or `BACKUP_TOO_NEW` before any change, and the working database is byte-identical afterwards (test).

**Given** the app is killed at each journal step (fault injection)
**When** it next starts
**Then** before the swap, staging is discarded and the pre-restore data opens intact; after the swap, the restored data opens; if the restored database fails its start checks, the safety copy is put back and the message reads `The restore didn't finish. Your phone is as it was before.` (NFR-12).

**Given** a backup made at schema version N (fixture committed with this story)
**When** it is restored on schema N+1
**Then** migration runs and every account balance matches the source device's, and a backup whose manifest app ID is `app.wmbugo` or `app.wmbugo.sms` restores on either package.

**Given** a successful restore
**When** it commits
**Then** device settings of this phone are kept (`app_lock_enabled`, `Lock after`, `hide_in_recents`) and everything else comes from the backup, all tables in the backup are carried as-is (including tables added by later epics, such as `sms_cursor`), and `BackupRestored` is emitted so every query is invalidated and Story 6.5 reschedules reminders.

**Covers:** BKP-002 (validate, safety snapshot, low-space rule, atomic commit), BKP-003, BKP-005 (forward migration, newer refused, safe failure recovery), NFR-12, AD-10 (RestoreBackup, maintenance mode, across package IDs, rebuild derived state)

### Story 8.9: Restore preview and confirmation

As Sara,
I want to see what's in a backup next to what's on my phone now before anything is replaced,
So that I restore on purpose, knowing exactly what will change.

**Acceptance Criteria:**

**Given** Settings › Data › `Restore from backup`, or a new `Restore from a backup` text button on SCR-01 Welcome
**When** Sara picks a file in the system file picker (Storage Access Framework, no permission)
**Then** its header is checked at once; a non-wmbugo file shows `This isn't a wmbugo backup. Nothing on this phone changed.` and nothing else happens.

**Given** a wmbugo backup
**When** the passphrase screen opens
**Then** it uses the shared passphrase field with one entry (`autoComplete="password"`), `Show` toggle and `Open backup`; a wrong passphrase shows `That passphrase doesn't open this backup.` under the field, moves focus to it and keeps its content.

**Given** a correct passphrase
**When** the manifest is read (progress `Checking your backup…`)
**Then** a damaged file shows `This backup file is damaged, so it can't be restored. Nothing on this phone changed.` and a newer one `This backup was made by a newer version of wmbugo. Update wmbugo, then try again. Nothing on this phone changed.`

**Given** a valid backup
**When** the restore confirmation (modal on the root stack) opens
**Then** a preview card shows `Backup` (`Made 3 Nov 2026, 9:14 pm`, entries, accounts, photos) beside `This phone now` (entries, accounts, photos, or `Nothing yet` from Welcome), the line `If something goes wrong during restore, nothing on this phone changes.`, and a `Back up this phone first` link that opens Story 8.7's Backup and returns here with the selection kept
**And** no copy promises a kept safety copy, and there is no typed-word confirmation.

**Given** the confirmation
**When** the checkbox row `I understand this replaces what's on this phone now` is unticked
**Then** `Restore` is disabled; ticking enables it (TalkBack announces the button state change).

**Given** free space is below 2× the current data size
**When** the confirmation opens
**Then** it adds `There isn't room to keep a copy of this phone's data while restoring.` and a second checkbox row `Restore without that copy`, and `Restore` stays disabled until both are ticked.

**Given** app lock is on
**When** Sara taps `Restore`
**Then** the Story 8.3 guard asks `Confirm it's you`; cancel keeps the confirmation as it was.

**Given** the restore runs
**When** Story 8.8 completes
**Then** a progress view `Restoring…` (no cancel) is followed by the app reopening on Home with the restored numbers and the toast `Restored from your 3 Nov backup`; from Welcome, onboarding is skipped because the restored profile exists.

**Covers:** BKP-002 (credentials, preview, copy, checkbox, re-auth), BKP-003 (actionable errors), UX-DR63, UX-DR64 (restore entry), UX-DR110, FLOW-10, SET-004 (restore)

### Story 8.10: Diagnostics with a preview before anything is exported

As Sara,
I want to see wmbugo's technical status and, if I need help, export a diagnostics file only after reading exactly what's in it,
So that I can get support without handing over my finances.

**Acceptance Criteria:**

**Given** Settings (SCR-21)
**When** it renders
**Then** a `Help` group row now exists (shown because Diagnostics exists; Epic 14 adds the rest of Help), and Settings › Help › `Diagnostics` (SCR-22) opens.

**Given** SCR-22
**When** it renders
**Then** a status list shows app version and flavor (`1.0.0 (nosms)`), database schema version, storage (`Entries and settings 12.4 MB · Photos 38.1 MB · Log 0.6 MB · Free 9.2 GB`), permissions with state (`Notifications: allowed`, `Biometrics: available`), app lock on/off, last backup date, crash records (`1 recorded, 7 Nov`) and safe mode `Off`
**And** it works without the database open (values it can't read show `Not available`), and a `Background capture` slot is reserved for Epic 13's OEM help.

**Given** the `Check a parser` section
**When** no on-device parser is registered in this build
**Then** the section is absent; parsers registered by later epics appear there and run only on sample text typed on the screen, which is never stored or logged.

**Given** `Export diagnostics`
**When** Sara taps it
**Then** a preview screen shows the full text that would be exported (status list, the last 500 redacted log lines and redacted crash records) in a scrollable monospace view, and a checkbox row `I've looked at this and I'm OK sharing it` enables `Save file`
**And** export cannot proceed without the tick (test).

**Given** consent
**When** `Save file` is tapped
**Then** the Android save dialog offers `wmbugo-diagnostics-2026-11-08.txt`, the saved bytes equal the previewed text, cancelling writes nothing, and the Story 8.1 redaction test passes on the exported file (no amounts, merchants, notes, account identifiers, SMS text or image data).

**Covers:** SET-006, SEC-007 (diagnostics export redacted), UX-DR83, AD-19 (export only with preview and consent)

### Story 8.11: Storage, retention and erase all data

As Sara,
I want to see how much space wmbugo uses, how long deleted things are kept, and to erase everything if I choose,
So that I know what's on my phone and can leave without a trace.

**Acceptance Criteria:**

**Given** Settings › Data
**When** it renders
**Then** it shows `Storage` (`Entries and settings 12.4 MB · Photos 38.1 MB · Log 0.6 MB`) and `Keeping deleted things` with `Deleted entries stay in Recently deleted for 30 days. Rejected payments stay 90 days. Then they're removed for good.` (the Story 3.12 rules, read-only), next to the existing `Recently deleted`, `Back up` and `Restore from backup`.

**Given** `Erase all data`
**When** Sara taps it
**Then** a first screen states the scope: `This erases from this phone: all entries, accounts, budgets, bills, goals, categories, photos, settings and the app log.`, `Backup files you saved elsewhere aren't touched. Delete them yourself if you want them gone.` and `This can't be undone.`, with the link `Back up this phone first` (Story 8.7, returning here) and `Continue`.

**Given** `Continue`
**When** the confirm sheet opens
**Then** the checkbox row `I understand everything on this phone will be erased` enables a destructive `Erase everything`, and with app lock on the Story 8.3 guard asks `Confirm it's you` first; `Cancel` or Back at either step changes nothing.

**Given** confirmation
**When** `EraseAllData` runs
**Then** it enters maintenance mode, writes an `erase.marker`, cancels all scheduled and posted notifications, deletes the database, attachments, staging, safety copies, logs and crash records, deletes the Keystore database key, removes the marker, and restarts the app on SCR-01 Welcome
**And** a file-system and Keystore inspection after erase finds no wmbugo data or key (a new key is generated only by the next onboarding, Story 1.6).

**Given** the app is killed during erase
**When** it next starts and finds `erase.marker`
**Then** it finishes the erase before anything else and opens Welcome.

**Given** `apps/mobile/src/shared/STATES.md`
**When** this story lands
**Then** it lists `erase all data` and `restore` as confirm-tier actions with re-auth when app lock is on.

**Covers:** SET-004 (storage use, retention, double-confirmed wipe), SEC-008, UX-DR71 (erase confirm tier)

### Story 8.12: Safe mode when the data can't be opened safely

As Sara,
I want wmbugo to stop changing anything and show me my ways out when its data can't be opened or looks damaged,
So that a fault never turns into lost entries.

**Acceptance Criteria:**

**Given** the database fails to open (SQLCipher rejects the key or reports the file is not a database), fails `PRAGMA quick_check` (run after any migration or restore, and once per day after Home's first frame so the splash is not delayed), or a Story 1.6 migration rolled back
**When** the app detects it
**Then** it enters safe mode: the writer refuses every use case with `SAFE_MODE`, scheduled writes (purge, reminder planning) do not run, and `safe_mode` with its reason is logged (redacted) and shown in Diagnostics.

**Given** safe mode with a readable database
**When** the app renders
**Then** the tabs are browsable read-only under a persistent banner `wmbugo can't safely change your data right now. Your entries are untouched.`, every add, edit and delete control is disabled with that reason, and the banner offers `Restore from backup` (Story 8.9), `Back up what can be read` (Story 8.7 from a read-only connection) and `Diagnostics` (Story 8.10).

**Given** safe mode with an unreadable database
**When** the app starts
**Then** a full-screen safe-mode view shows the same sentence with `Restore from backup` and `Diagnostics`, and `Back up what can be read` is shown disabled with `The data can't be read, so it can't be backed up.`

**Given** a migration that rolled back
**When** safe mode shows
**Then** the message reads `wmbugo couldn't finish updating your data. Nothing was lost.` and `Try again` re-runs the migrations; success leaves safe mode without restart.

**Given** the database file exists but the Keystore key is missing (app data partly cleared or key invalidated)
**When** the app starts
**Then** safe mode shows `This phone's key for wmbugo is gone, so the data here can't be opened. A backup is the only way to get it back.` with `Restore from backup`, `Start fresh` (the Story 8.11 erase flow) and `Diagnostics`.

**Given** a forced-corruption test (bytes flipped in a database page) on the release build
**When** the app starts
**Then** safe mode appears with restore, backup and Diagnostics paths, no write is attempted (writer spy), and a successful restore leaves safe mode and opens Home.

**Covers:** UX-DR72, BKP-005 (safe failure recovery), AD-19 (safe mode), AD-9 (key loss recoverable only from backup), NFR-12


## Epic 9: CSV import and export

Sara brings her bank and card history into wmbugo from a CSV file through a guided, full-screen wizard (Settings › Data › Import CSV): the file is read whatever its encoding or delimiter, columns are guessed and confirmed (or skipped when a saved bank format matches), every row is previewed and validated, possible duplicates are shown side by side, and nothing is written until she taps `Import N entries`. Rows go through the Epic 3 `SubmitCapture` pipeline and FIN-027 matcher unchanged, commit in atomic batches of at most 500 rows that resume after an interruption, and re-importing the same or an overlapping file never adds anything twice. Equal opposite rows on two of her accounts are proposed as one transfer, rows the app removed before are skipped as `Previously rejected` / `Previously deleted` with a per-row `Import anyway`, and the raw file is kept encrypted for 30 days by default. Sara can also export her transactions and an account summary as CSV with period, filter, timezone and schema metadata, masked identifiers only as she chooses and formula-injection escaping, through the Story 7.3 shared CSV writer and the Android system save dialog. The epic adds the `ImportCsvBatch` use case (AD-6/AD-3) and `import_batch` table (owner: capture), and builds the stepper header (UX-DR57) and the coin-flip long-task loader SCR-31 (UX-DR53, first use; Epic 10 adds its OCR scan-line variant).

### Story 9.1: Read any bank CSV file in core

As Sara,
I want wmbugo to read the CSV my bank gives me whatever its encoding, delimiter or number style,
So that I don't have to clean the file up in a spreadsheet before importing it.

**Acceptance Criteria:**

**Given** the `core.capture.csv` reader (pure TypeScript, no React Native imports; Papa Parse sits behind a `CsvTokenizer` port in the adapter, per the addendum stack)
**When** it receives the raw bytes of a file
**Then** it returns a `CsvReadResult` with the detected encoding (`UTF-8`, `UTF-16LE`, `UTF-16BE`, `Windows-1252` or `ISO-8859-1`), delimiter (comma, semicolon or tab), header row index, row count, the first 25 data rows as cells, and a confidence per detection
**And** a UTF-8 or UTF-16 byte-order mark is honoured and stripped, invalid UTF-8 falls back to Windows-1252, and `ISO-8859-1` is chosen over Windows-1252 only when no byte 0x80–0x9F appears (fixture per encoding: `Café`, `Zürich`, `£3.50`, `€12,00` decode correctly).

**Given** a file with quoted fields containing delimiters, doubled quotes and line breaks (`"PRET A MANGER, LONDON"`, `"He said ""hi"""`)
**When** it is read
**Then** each quoted field stays one cell and the row count is unchanged by embedded line breaks.

**Given** a file whose first lines are bank preamble (`Account: 12-34-56 ****4821`, a blank line) before the real header
**When** the header row is detected
**Then** the first row whose cell count equals the dominant cell count and contains no parseable amount is chosen as the header, and the preamble lines are reported but never imported.

**Given** the detected settings
**When** the caller passes overrides (`encoding`, `delimiter`, `headerRow` or `noHeader`)
**Then** the reader re-reads with them and an override always wins over detection (test per override).

**Given** the amount parser `parseCsvAmount(text, numberStyle)`
**When** it parses `-1.234,56` with style `1.234,56`, `1,234.56` and `(1,234.56)` with style `1,234.56`, `£3.50`, `3.50 CR`, `3.50 DR` and `1 234,56`
**Then** it returns exact minor units with a sign (−123456, 123456, −123456, 350, +350, −350, 123456) with no floating-point step (property test: format then parse round-trips for every supported style and currency exponent, reusing the Story 1.4 money primitives)
**And** the number style is detected from the first 25 rows (a comma followed by exactly two digits at the end, with dots before it, means decimal comma), and text such as `12.3.4` or `abc` returns `INVALID_AMOUNT`, never 0.

**Given** the date parser
**When** the first 25 values of a date column are examined
**Then** it detects one of `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD.MM.YYYY`, `DD-MM-YYYY`, `D MMM YYYY` (English month names) with an optional time `HH:mm[:ss]`, and returns `AMBIGUOUS_DATE_FORMAT` with both candidates when every value has day and month ≤ 12
**And** a date-only value becomes a `local_date` exactly as written in the profile timezone with no UTC shift, while a value with a time becomes a UTC instant in the profile timezone with that `local_date` (FIN-002; DST fixture on 26 Oct 2025 Europe/London keeps the written day).

**Given** the PRD German acceptance fixture: a Windows-1252 file with `;` delimiters and the amount `-1.234,56`
**When** it is read with no overrides
**Then** encoding `Windows-1252`, delimiter `;` and style `1.234,56` are detected and the amount parses to −123456 minor units of EUR.

**Given** an empty file, a file with only a header, a binary file (NUL bytes in the first 4 KB) or a file over 20 MB
**When** it is read
**Then** it returns `EMPTY_FILE`, `NO_ROWS`, `NOT_A_CSV` or `FILE_TOO_LARGE` respectively, and nothing is thrown.

**Covers:** IMP-001, FIN-002 (date-only CSV rows), NFR-09 (exact amounts)

### Story 9.2: Column mapping, row validation and saved bank formats in core

As Sara,
I want wmbugo to guess which column is which, check every row before anything is saved, and remember my bank's layout next time,
So that a wrong guess or a bad row is caught early and my second import takes seconds.

**Acceptance Criteria:**

**Given** a `CsvReadResult` from Story 9.1
**When** `guessMapping(header, sampleRows)` runs
**Then** it returns a `CsvMapping` assigning the roles `date`, `time`, `description`, `merchant`, `amount` (signed) or `debit` + `credit`, `currency`, `reference`, `balance`, `category` and `account`, each optional except `date`, `description` and an amount form, from header keywords (case- and accent-insensitive, e.g. `Date`, `Transaction Date`, `Buchungstag`; `Paid out` / `Money out` / `Debit`; `Paid in` / `Money in` / `Credit`; `Amount`, `Betrag`; `Reference`, `Ref`, `Transaction ID`; `Balance`, `Saldo`) and value shapes when headers are missing
**And** it includes `flipSign` (default off), the detected date format and number style, and a per-role confidence; any role can be reassigned or cleared by the caller.

**Given** a mapping and the rows
**When** `normalizeCsvRow(row, mapping, profile)` runs
**Then** each row becomes a `CsvCandidate` with direction (`out` or `in`), unsigned amount in minor units, `local_date` (and instant when a time exists), description text kept as written, normalized merchant (Story 3.1 normalizer, from `merchant` or else `description`), optional reference, optional category name, optional foreign currency, and its 1-based file row number
**And** with `debit` + `credit` columns a value in `debit` is `out` and in `credit` is `in`; with a signed `amount` a negative value is `out`; with `flipSign` on, positive values are `out` (PRD fixture: a card statement listing charges as positive imports them as expenses on the card account).

**Given** the pre-commit validator (IMP-003)
**When** it checks every row
**Then** each row gets either `ok` or one or more row errors with fixed codes and copy: `INVALID_DATE` (`Date "31/02/2026" isn't a real date`), `INVALID_AMOUNT` (`Amount "12.3.4" isn't a number`), `MISSING_AMOUNT` (`No amount in this row`), `BOTH_DEBIT_AND_CREDIT` (`This row has both a debit and a credit`), `UNKNOWN_CURRENCY` (`"XYZ" isn't a currency wmbugo knows`), `UNMAPPED_ACCOUNT` (`No account chosen for "Joint"`)
**And** a row in a known currency other than the profile currency is valid and marked `foreign` (it is imported later as a Story 3.10 currency review item, never converted), and a row error never stops the other rows from validating.

**Given** a mapped `balance` column
**When** the running balance moves the opposite way to the signed amounts on more than half of the consecutive row pairs where it can be checked
**Then** the validator returns the file-level warning `SIGN_LOOKS_REVERSED` (copy: `Amounts look reversed: payments out should lower the balance.` with the action `Flip sign`), and when it agrees on every checkable pair it returns `SIGN_CONFIRMED`
**And** without a balance column no sign warning is raised.

**Given** an `account` column
**When** the mapping is built
**Then** its distinct values (e.g. `Current`, `Joint`) are listed for the caller to map one by one to an existing wmbugo account or to `Don't import these rows`; without an `account` column the whole file is mapped to one chosen account.

**Given** a confirmed import of a file
**When** its mapping is saved as a bank format
**Then** a `csv_format` row (capture-owned, added by this story's migration) stores a header signature (SHA-256 of the normalized header cells and delimiter), the mapping, overrides, `flipSign`, the account choice and a name defaulting to the account name (`Monzo Current`), with no row data
**And** `findSavedFormat(readResult)` returns that format for a later file with the same header signature, and returns nothing when any header cell differs.

**Given** the fast-check suite
**When** core tests run
**Then** normalization is deterministic, `flipSign` applied twice is the identity on direction, and debit/credit and signed-amount mappings of the same statement give identical candidates.

**Covers:** IMP-002 (mapping of account, date/time, description, debit/credit or signed amount, flip sign, currency, merchant, reference; foreign currency isolated), IMP-003 (date, number and balance-sign validation, every bad row marked), FIN-002

### Story 9.3: Import plan: classify every row against the ledger before writing

As Sara,
I want wmbugo to tell me, before it saves anything, which rows are new, which it already has, which might be duplicates and which look like transfers,
So that I decide with the evidence in front of me and nothing is silently merged or dropped.

**Acceptance Criteria:**

**Given** validated `CsvCandidate`s and the read-only ledger and capture queries
**When** `planCsvImport(candidates, context)` runs (pure core, no writes)
**Then** it returns an `ImportPlan` in which every row has exactly one class: `new`, `already_recorded(id)`, `possible_duplicate(id)`, `transfer_pair(rowOrId)`, `held_pair(id)`, `edge_day_review`, `previously_rejected`, `previously_deleted`, `foreign_currency` or `error(codes)`, plus counts per class (test: classes sum to the row count).

**Given** the source fingerprint for a CSV row
**When** it is computed
**Then** a row with a reference uses (reference, direction, event type), and a row without one uses (account, `local_date`, direction, amount, normalized description, occurrence index), where the occurrence index numbers identical rows 1, 2, 3… within their (date, amount, description) group in file order
**And** the PRD fixture passes: two `PRET A MANGER £3.50` rows on 20 Oct with no references are both `new` and neither is flagged; a later overlapping file covering 20–31 Oct gives the same two fingerprints and both rows are `already_recorded`.

**Given** a row whose fingerprint equals an existing `source_record` fingerprint (same file imported again, or an overlapping file)
**When** it is classified
**Then** it is `already_recorded` and counted as a skipped match; an exact fingerprint match always wins over the edge-day rule
**And** the PRD fixture passes: a 200-row bank CSV planned a second time after import gives 200 `already_recorded` and 0 of any other class.

**Given** a row whose reference and direction equal an existing capture's (e.g. a UPI or bank SMS entry, core fixture)
**When** the Story 3.1 matcher returns `duplicate_of`
**Then** the row is `already_recorded(id)` and on commit links its `source_record` to that entry instead of creating one (PRD §8.10 acceptance; UPI-005).

**Given** a reference-less row with the same amount, `local_date` within ±1 day and the same normalized merchant as an existing entry from another source
**When** the matcher returns `possible_duplicate_of`
**Then** the row is `possible_duplicate(id)`; it is never merged automatically, and rows from the same file are never matched against each other or against rows committed from that file (Story 3.1 rule).

**Given** an opposite-direction row of equal amount within ±2 days on a different owned account (an existing entry, or another row of the same file mapped to a different account)
**When** transfer pairing runs
**Then** both are `transfer_pair` and are never planned as an expense plus an income (PRD fixture: bank `£500 CARD PAYMENT` out and card `£500 PAYMENT RECEIVED` in one day apart); a same-reference opposite-direction row whose account is unknown is `held_pair` with the Story 3.1 question.

**Given** the first or last date in the file
**When** the ledger already holds entries on that `local_date` for the same account from any source
**Then** that day's rows that are not exact fingerprint matches are `edge_day_review` (the file may cover only part of that day), and when the ledger holds nothing on that day they are classified normally.

**Given** a row whose fingerprint hashes to a Story 3.12 tombstone
**When** it is classified
**Then** it is `previously_rejected` or `previously_deleted` (PRD fixture: a capture rejected in January and purged after 90 days; the May CSV row with the same bank reference is `previously_rejected`).

**Given** a 5,000-row file on the GATE-03 reference device with 10k ledger entries
**When** the plan is computed
**Then** it completes within 3 s and reports progress every 250 rows to a callback (used by the loader in Story 9.6).

**Covers:** IMP-004, IMP-002 (transfer pairs ±2 days), IMP-003 (duplicate candidates before commit), LIR-03 (fingerprints), FIN-027 (CSV occurrence index, edge days), FIN-014 (tombstones skip as previously rejected/deleted), UPI-005 (matching CSV row)

### Story 9.4: ImportCsvBatch: atomic, resumable, idempotent commit

As Sara,
I want a large import to save in safe chunks that pick up where they stopped if my phone dies,
So that a crash never leaves half an import, a duplicate or a lost row.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** `import_batch` (capture-owned) is created with `id`, `file_digest` (SHA-256 of the raw bytes), `format_id?`, `mapping_json`, `account_id?`, `status` (`planned | importing | paused | completed | abandoned`), `row_count`, `committed_through_row`, `imported_count`, `skipped_count`, `review_count`, `error_count`, `raw_path?`, `retain_until?`, `created_at`, `completed_at?`, and `source_record.import_batch_id` and `source_record.file_row` are populated for every CSV source.

**Given** Sara's confirmed plan with per-row decisions from the wizard
**When** `ImportCsvBatch` starts
**Then** the raw file is copied encrypted to app-private storage through the FileStore port before the `import_batch` row commits (AD-9), with `retain_until` = now + 30 days
**And** each batch of at most 500 rows in file order is one `LedgerWriter` transaction that submits every row through `SubmitCapture` with `source_kind = csv`, writes audit and outbox rows, and advances `committed_through_row` in the same commit.

**Given** each row's class and decision
**When** it is submitted
**Then** `new` rows become `confirmed` with `capture_resolution = user_approved` (`needs_category` when no category column maps to an existing category by name); `already_recorded` rows add a `source_record` to the existing entry or write nothing when the fingerprint already exists (`ALREADY_SUBMITTED`); `possible_duplicate`, `held_pair`, `edge_day_review` and `transfer_pair` rows become `needs_review` with an open `review_candidate` (reasons `duplicate`, `held_pair`, `edge_day`, `transfer_pair`); `foreign_currency` rows follow Story 3.10
**And** rows Sara chose to skip are written as `excluded` entries with their `source_record` (shown under Show rejected for 90 days, then tombstoned by Story 3.12) so a later import skips them, and `previously_rejected` / `previously_deleted` rows write nothing unless `Import anyway` was chosen for that row, which submits with `ignoreTombstone = true`.

**Given** a row that fails at commit (e.g. its account was archived meanwhile)
**When** its batch runs
**Then** the row is recorded as a row error with its file row number and code, the rest of the batch commits, and nothing is silently discarded (PRD fixture: an unparseable date on row 57 is reported, all other rows commit).

**Given** the PRD fixture: a 1,200-row import interrupted after the second batch (fault injection kills the process mid-batch 3)
**When** the app restarts
**Then** `import_batch` shows `paused` with `committed_through_row = 1000`, batch 3 left no partial rows, the database passes the writer invariant checks (NFR-12), and `ResumeCsvImport` re-reads the retained raw copy, verifies `file_digest`, and continues from row 1,001 with no row duplicated.

**Given** a cancel request while importing
**When** the current batch finishes
**Then** the import stops with status `paused`, committed batches stay, and no further batch starts.

**Given** the same file imported again after completion
**When** `ImportCsvBatch` runs
**Then** it creates no new confirmed entries and reports `skipped_count = 200` for the 200-row fixture (LIR-03, idempotency property test over random interruption points).

**Given** a running import
**When** other use cases are enqueued (a manual save, an auto-approval)
**Then** they run between batches on the single writer and are never rejected.

**Covers:** IMP-005, LIR-03, NFR-12 (import), AD-6/AD-3 (`ImportCsvBatch`, `import_batch`), AD-9 (raw copy written before its row), FIN-014 (excluded import rows, `Import anyway`)

### Story 9.5: Imported transfer pairs and edge-day rows in the review queue

As Sara,
I want a payment that left my current account and arrived on my card to be offered as one transfer, and rows from a half-covered day to be shown to me,
So that paying my card is never counted as spending plus income, and nothing on a boundary day is doubled or lost.

**Acceptance Criteria:**

**Given** a `needs_review` entry with an open `transfer_pair` candidate from an import
**When** it renders in the review queue (Story 3.10)
**Then** a side-by-side card shows `Money out` and `Money in` with account, amount, date and source (`CSV import`, or the other entry's source), the question `Same money moving between your accounts?` and the actions `Yes, it's a transfer` and `No, keep them separate`.

**Given** `Yes, it's a transfer`
**When** `LinkAsTransfer` runs
**Then** in one transaction the two legs become one `transfer` transaction with postings on both accounts that sum to zero (writer invariant), both `source_record`s point to it, the leg being replaced (including an already confirmed one from an earlier import) becomes `excluded` with an audit row, the candidate is resolved, `Spent this period` and both balances update without restart, and the toast reads `Linked as transfer · Undo`
**And** Undo restores both legs, their statuses and the open candidate exactly (round-trip property test).

**Given** `No, keep them separate`
**When** Sara taps it
**Then** the imported leg becomes `confirmed` (`user_approved`), the candidate is resolved, both entries count as their own direction, and the toast reads `Kept separate · Undo`.

**Given** a `needs_review` entry with an open `edge_day` candidate
**When** it renders
**Then** the card shows the row, the line `This file only partly covers 20 Oct, so this may already be recorded.`, the entries already recorded on that day for that account, and the actions `Add it` (confirm), `It's already here` (link its source to a chosen entry, or exclude it) and the usual `Edit`.

**Given** the Activity row and the transaction detail
**When** an entry has an open `transfer_pair` or `edge_day` candidate
**Then** the row shows the `Check` tag (Story 3.5 possible-duplicate state) and the detail shows the same question and buttons (durable path), and `captureStatusLabel` maps both to `Waiting for you` (exhaustive-switch test updated).

**Given** TalkBack and fontScale ≥ 1.3
**When** a transfer-pair card renders
**Then** the two columns stack, and the card reads as one node `Possible transfer: 500 pounds out of Monzo Current on 3 Nov, 500 pounds into Amex on 4 Nov` followed by the two buttons.

**Covers:** IMP-002 (transfer pairs sent to review, never expense plus income), FIN-027 (partial edge days to review), IMP-004 (never silently merged)

### Story 9.6: Import wizard: choose a file, confirm columns and preview

As Sara,
I want a step-by-step screen that reads my file, shows me how it understood the columns and lets me check the rows,
So that I can trust what will be imported before anything is saved.

**Acceptance Criteria:**

**Given** Settings › Data
**When** it renders
**Then** it gains `Import CSV` (with the line `From a file your bank or card gives you`), which opens SCR-19 as a full-screen modal; the Add sheet still has no import entry (TXN-001).

**Given** the shared `stepper-header` (UX-DR57, built in `apps/mobile/src/shared`)
**When** any wizard step shows
**Then** it renders `Step N of M` in `label` as a heading announced on arrival, a thin limit-bar-style progress bar without tick (decorative to TalkBack), `Back` (48dp) and `Cancel`
**And** Back returns to the previous step with every choice kept, and Cancel at any step closes the wizard and writes nothing (data-integrity test: no row in any table changes and no file is stored).

**Given** Step 1 of 4 `Choose a file`
**When** Sara taps `Choose file`
**Then** the Android document picker (Storage Access Framework, no storage permission) opens filtered to CSV and text types, and the chosen file is read and planned behind the coin-flip loader.

**Given** the coin-flip loader SCR-31 (UX-DR53, first built here in `apps/mobile/src/shared` as `<LongTaskLoader>`)
**When** a long task runs
**Then** it shows the coin-flip Lottie (Story 1.8 asset), a title (`Reading your file…`), progress text as a polite live region (`250 of 1,200 rows`), a reassurance line (`Nothing is saved yet.`) and `Cancel` when the task can be cancelled
**And** under Reduce motion it shows the still pie face, Cancel stops the task and writes nothing, and a failure switches to the inline error pattern (cause + reassurance + `Try again` + `Choose another file`).

**Given** the file is read
**When** Step 1 shows the result
**Then** a summary reads `statement-nov.csv · 1,200 rows` with `Read as UTF-8 · Comma-separated · Headings on row 1 · Dates like 31/10/2026` and `Change`, which opens a sheet to override encoding, delimiter, heading row (`No heading row` option) and date format; changes re-read the file
**And** an ambiguous date format asks `Dates like 04/05/2026: is that 4 May or 5 April?` with two chips before `Next` enables, and `EMPTY_FILE`, `NO_ROWS`, `NOT_A_CSV`, `FILE_TOO_LARGE` show `This file is empty.`, `This file has headings but no rows.`, `This doesn't look like a CSV file.`, `This file is over 20 MB. Split it and import each part.` with `Choose another file`.

**Given** Step 2 of 4 `Columns`
**When** no saved bank format matches
**Then** the guessed mapping is shown as a confirm screen: one row per role (`Date → "Transaction Date"`, `Description → "Name"`, `Money out → "Paid out"`, `Money in → "Paid in"`, `Reference → not used`) each with `Change` (a picker of the file's columns plus `Not used`), the account picker `Import into` (single account, or `Use the "Account" column` with each value mapped), the switch `Flip sign` with the hint `Turn on if charges show as positive numbers`, and the switch `Remember this layout for next time` (on by default)
**And** `Next` stays disabled with a hint naming what is missing (`Choose the date column`, `Choose an account`) until the required roles and account are set.

**Given** a saved bank format matches the file's headings
**When** Step 1 completes
**Then** the Columns step is skipped and steps become `Step N of 3`, and the preview shows `Using your saved layout for Monzo Current · Change`, which returns to the Columns screen pre-filled.

**Given** Step 3 of 4 (or 2 of 3) `Preview`
**When** it renders
**Then** it lists at least the first 20 rows (all rows when fewer) as compact rows with date, description, account and amount in the Activity convention (money out unsigned, money in `+£` in the income colour, no minus sign), each row with an error showing a warning icon and its error copy, and a header line `1,198 rows ready · 2 with problems`
**And** `SIGN_LOOKS_REVERSED` shows an inline warning with `Flip sign`, which flips and refreshes the preview in place, and `Show only problems` filters to error rows.

**Given** Sara changes the mapping from the preview
**When** she goes Back to Columns, edits and returns
**Then** validation and the plan rerun behind the loader and her earlier choices on other steps are kept.

**Given** TalkBack and 200% text
**When** the wizard is used end to end with TalkBack only
**Then** every control has a role and label, each step heading is announced, preview rows read `Row 57, error: date "31/02/2026" isn't a real date`, and nothing is truncated at 320dp × 200%.

**Covers:** IMP-001 (user-picked file, correctable detection), IMP-002 (preview 20+ rows, mapping, flip sign), IMP-003 (errors shown before commit), UX-DR57, UX-DR53 (first use), SCR-19, SCR-31, FLOW-07 (choose file → map fields → preview), SET-004 (Data group)

### Story 9.7: Import wizard: check matches, import and see the summary

As Sara,
I want to see possible duplicates side by side, decide what happens to them, then import with one tap and see exactly what happened,
So that my history is complete, nothing is counted twice and I know what's left to check.

**Acceptance Criteria:**

**Given** the last step `Check matches` (`Step 4 of 4`, or `3 of 3`)
**When** the plan has rows in `possible_duplicate`, `already_recorded`, `transfer_pair`, `held_pair`, `edge_day_review`, `previously_rejected`, `previously_deleted` or `foreign_currency`
**Then** it shows grouped sections with counts: `Already recorded (12)` (collapsed, read-only: these are skipped or linked), `Possible duplicates (3)`, `Possible transfers (1)`, `Partly covered days (4)`, `Removed before (1)`, `Other currency (2)`; with none of these it shows `Nothing to check. Everything here is new.`

**Given** a possible duplicate
**When** it renders
**Then** a side-by-side card shows `In this file` and `Already recorded` with amount, date, merchant, account, category and source (Story 3.10 layout, stacking at fontScale ≥ 1.3) and a choice of `Check later` (default: imported waiting for review), `Import anyway` (imported as confirmed) and `Skip`.

**Given** a row `previously_rejected` or `previously_deleted`
**When** it renders
**Then** it reads `You removed this before` (`Rejected` or `Deleted`) with the row's date, description and amount, defaults to skipped, and offers `Import anyway` per row (no bulk option).

**Given** the step's footer
**When** it renders
**Then** the primary button reads `Import 1,186 entries` with N = rows that will create or update an entry under the current choices (it updates live as choices change, and the count is announced politely), plus the line `2 rows with problems won't be imported` when errors exist; nothing has been written before this tap.

**Given** `Import N entries`
**When** Sara taps it
**Then** the loader shows `Importing…`, `500 of 1,186 entries` and `Entries already imported stay if you stop.`, with `Stop` which ends after the current batch (Story 9.4) and shows the summary with `Resume`
**And** with `Remember this layout` on, the bank format is saved in the first batch.

**Given** the import completes
**When** the summary shows
**Then** it reads `Imported 1,170 · Skipped 12 already recorded · 4 to check · 2 couldn't be read` with each count as a row, `Review 4 entries` opening the review queue (Story 3.10) and `Done` returning to Settings › Data, and Activity, Home and balances reflect the new entries without restart.

**Given** rows that couldn't be read
**When** Sara opens `2 couldn't be read`
**Then** each row lists its row number and error copy, with `Fix columns and try these rows` (reopens Columns for this file and re-plans only those rows) and `Save these rows as a CSV` (the Story 7.3 shared writer and system save dialog, file `statement-nov-problems.csv` with the original cells and an added `problem` column; cancelling writes nothing).

**Given** an import left `paused` (stopped, or the app was killed)
**When** Sara next opens Settings › Data
**Then** `Import CSV` shows `Import paused · 1,000 of 1,200 rows · Resume`, and `Resume` runs `ResumeCsvImport` behind the loader, then shows the summary of the whole import
**And** choosing the same file again (same digest) offers `Resume this import` instead of starting over, and `Discard the rest` sets it `abandoned` while keeping committed entries.

**Given** the same file is imported again after it completed
**When** the matches step shows
**Then** every row is in `Already recorded`, the button reads `Nothing new to import` (disabled), and `Done` closes the wizard (FLOW-07 retry adds nothing twice).

**Covers:** IMP-004 (side-by-side evidence, never silently merged), IMP-005 (row errors with retry and export, resume UI), IMP-003 (every ambiguous row marked for review), LIR-03, FIN-014 (per-row `Import anyway`), UX-DR57 (nothing written until `Import N entries`), UX-DR53 (import progress, Cancel), FLOW-07 (duplicates → confirm → commit → summary → Review queue), SCR-19

### Story 9.8: Keep or delete imported files

As Sara,
I want to choose how long wmbugo keeps the original files I import,
So that I can trace an entry back to its file, or leave no copy on my phone at all.

**Acceptance Criteria:**

**Given** Settings › Data
**When** it renders
**Then** it gains `Imported files` with the summary `Kept 30 days` (default), `Deleted after import` or `Kept until you delete them`, and the line `Copies stay encrypted on this phone. Nothing is uploaded.`

**Given** `Imported files`
**When** Sara picks `Delete right after import`, `Keep for 30 days` or `Keep until I delete them`
**Then** the choice is saved in `settings` (profile-owned), applies to existing completed imports from now (each `retain_until` is recomputed from its `completed_at`), and the summary updates live.

**Given** `Delete right after import`
**When** an import completes or is discarded
**Then** its raw copy is deleted after the completing commit and `raw_path` is cleared; a `paused` import keeps its copy whatever the setting, because Resume needs it.

**Given** `PurgeExpired` (Story 3.12)
**When** it runs
**Then** it deletes raw copies of completed or abandoned imports whose `retain_until` has passed (files deleted after commit, `raw_path` cleared), keeps `import_batch` rows and every `source_record` fingerprint so re-imports stay idempotent, and a Clock-driven test at 29 and 31 days passes.

**Given** the imports list under `Imported files`
**When** it renders
**Then** it lists each import (`statement-nov.csv · 3 Nov · 1,170 imported · file kept until 3 Dec`, or `file deleted`) with `Delete file now` on any kept file (confirm sheet `Delete this file? Entries you imported from it stay.`), and the entry detail's Source section shows `CSV import · statement-nov.csv · row 57`.

**Given** the orphan sweep (Story 3.11) and a network-traffic check
**When** a copy has no `import_batch` row, or an import runs on the release build
**Then** the orphan is deleted, and no request leaves the device (no `INTERNET` permission, Story 8.1 check).

**Covers:** IMP-006, AD-9 (raw CSV copies encrypted, orphan sweep), SET-004 (retention)

### Story 9.9: Export transactions and account summaries as CSV

As Sara,
I want to save my entries or a summary of my accounts as a CSV file with the period and filters written in it,
So that I can use my data in a spreadsheet, keep my own records, or move to a new profile in another currency.

**Acceptance Criteria:**

**Given** Settings › Data
**When** it renders
**Then** it gains `Export CSV`, opening a screen with `What to export` (`Transactions` or `Account summary`), `Period` (`This period`, `Last period`, `This year`, `All time`, `Custom range`; default `All time` for Transactions, `This period` for Account summary), `Accounts` (all by default, multi-select) and the switch `Include account numbers (last 4 digits)` (off by default), and the primary button `Export`.

**Given** `Export`
**When** Sara taps it
**Then** a confirm sheet reads `This file won't be encrypted. Anyone who opens it can read these entries.` with `Export` and `Cancel`, and with app lock on the shared re-authentication guard asks `Confirm it's you` first (UX-DR71 decrypted export); Cancel writes nothing.

**Given** confirmation for `Transactions`
**When** the Android system save dialog (Storage Access Framework) opens
**Then** it offers `wmbugo-transactions-2026-01-01-to-2026-11-08.csv`, and the file, written by the Story 7.3 shared writer in `packages/core/src/shared/csv` (UTF-8 with BOM, comma, CRLF), starts with `# Period 2026-01-01 to 2026-11-08 (inclusive)`, `# Filters: Accounts all` (or the chosen names), `# Timezone Europe/London`, `# Currency GBP`, `# Schema wmbugo-transactions-1`, `# Includes confirmed entries only`
**And** then the header `date,time,merchant,category,account,account_number,type,amount,currency,reference,note,source,entry_id` and one row per confirmed entry (one row per split part with the same `entry_id`; one row per transfer leg with `type` `transfer_out` / `transfer_in`), `amount` unsigned with `type` carrying direction (`expense`, `income`, `refund`, `transfer_out`, `transfer_in`, `adjustment`), `account_number` empty unless the switch is on, and then masked as `••4821`; full account numbers are never stored, so never exported.

**Given** confirmation for `Account summary`
**When** the file is written
**Then** it is `wmbugo-accounts-2026-11-01-to-2026-11-30.csv` with the same metadata lines (`# Schema wmbugo-accounts-1`) and columns `account,type,status,account_number,start_balance,money_in,money_out,end_balance,balance_side,currency`, where balances come from the Story 2.1 read model, are unsigned with `balance_side` `have` or `owe` (cards), and a `balance not set` account has empty balance cells and `balance_side` `not set`, never 0.

**Given** any cell starting with `=`, `+`, `-`, `@`, tab or carriage return (e.g. a note `=HYPERLINK(...)`)
**When** the file is written
**Then** it is prefixed with `'` (PRD §8.10 acceptance, reused writer test), and a 10k-entry export completes within 5 s on the reference device behind the coin-flip loader (`Exporting…`, `4,000 of 10,000 entries`, `Cancel` deletes the partial document).

**Given** the export finishes
**When** the file is saved
**Then** the toast reads `Exported 1,284 entries` (or `Exported 6 accounts`); a provider error shows `Couldn't save the file. Nothing on this phone changed.` with `Try again`; hidden amounts mode does not block export.

**Given** the Story 1.16 currency block
**When** Sara tries to change currency with entries recorded
**Then** the explanation gains the link `Export your entries`, which opens this screen with `Transactions` and `All time` selected.

**Given** `apps/mobile/src/shared/PERMISSIONS.md` and `STATES.md`
**When** this story lands
**Then** PERMISSIONS.md notes that exported CSV files are unencrypted and leave wmbugo's control, and STATES.md lists `export CSV` in the confirm tier with re-auth.

**Covers:** IMP-007, SET-004 (CSV export), SET-002 (export path for a currency change), SEC-006 (formula escaping via shared writer), UX-DR71 (decrypted export confirm + re-auth), UX-DR53 (export progress)


## Epic 10: Receipt scanning

Mei snaps or picks a receipt and wmbugo reads the merchant, date, total and line items on the phone, offline from install, with no download and no network. She sees `Reading receipt…` with a scan line and a `3 of 14 items` count she can cancel at any time. Then she confirms a short review screen: category totals first, `Items (N)` collapsed, a grey `Not itemised` row for anything that wasn't read, an editable `Paid with` chip and a total she must confirm when the read is uncertain. If the receipt probably matches something already recorded, she chooses `Attach to it`, `Keep separate` or `Discard`, so a receipt never creates a second confirmed expense on its own. When parsing fails she is one tap from entering it by hand with the photo kept. The epic starts with Spike S3, which chooses the OCR engine (ML Kit 16.0.1 bundled vs PaddleOCR/ONNX) and records the GATE-05 evidence. It adds the `OcrEngine` adapter (AD-14) with all parsing, reconciliation and allocation in `core`, the `receipt_item` table (owner: ledger), the `AttachReceipt` use case, and the OCR scan-line variant of the Story 9.6 `<LongTaskLoader>`. Receipts submit through the Epic 3 `SubmitCapture` pipeline and FIN-027 matcher unchanged. The widget (Epic 11), capture-notification action (Epic 11) and shared non-UPI images (Epic 12) call the single receipt-scan entry this epic exposes.

### Story 10.1: Spike S3 — OCR engine choice and the synthetic receipt set

As a developer,
I want a time-boxed comparison of ML Kit text recognition 16.0.1 (bundled) and PaddleOCR via ONNX Runtime on accuracy, speed and privacy, with a written decision,
So that receipt scanning is built on an engine proven to work offline in a build without `INTERNET`, and GATE-05 has its evidence.

**Acceptance Criteria:**

**Given** a time box of 4 working days on a throwaway branch
**When** the spike ends
**Then** a decision record `docs/decisions/S3-ocr-engine.md` is committed to main naming the chosen engine, with the evidence for each criterion below for both candidates
**And** spike code is not merged except the `OcrEngine` port and the fixtures that the record marks as confirmed.

**Given** the receipt reference protocol (PRD §16.3: real receipts never enter the repo or CI)
**When** the spike builds its test set
**Then** `fixtures/receipts/synthetic/` holds 40 synthetic or re-typeset receipt images (10 per market group: India, US/Canada, UK/Europe, Gulf/SE Asia), each with a ground-truth JSON (merchant, date, currency, subtotal, tax, fees, discounts, total, items with prices)
**And** the set includes at least 4 receipts with Arabic or Devanagari text and totals in Western numerals, 4 with decimal commas, 4 multi-column layouts, 4 low-contrast or tilted photos, and 2 long receipts of 30 or more lines
**And** no image contains a real person's name, card fragment, phone number or loyalty ID.

**Given** each candidate in a release build of the `nosms` flavor, with `INTERNET` and `ACCESS_NETWORK_STATE` absent from the merged manifest
**When** the 40 images are read on a fresh install with airplane mode on, on each Story 1.3 reference device
**Then** the record states whether the engine read text without any model download, and the per-device p50 and p95 recognition time
**And** it states the APK size added per ABI and the peak memory used on the low-end reference device.

**Given** the Story 8.1 dependency denylist (which includes `datatransport`) and permission allowlist
**When** each candidate's release build is checked
**Then** the record lists every transitive Android dependency, service, receiver and provider the engine adds, and the exact Gradle `exclude` and `tools:node="remove"` entries that remove Google transport and telemetry components (ML Kit)
**And** the record states whether the denylist and allowlist checks pass with recognition still working; an engine that cannot pass both is rejected.

**Given** the parsed output of each candidate
**When** it is scored against the ground truth with a throwaway parser
**Then** the record reports the correct-rate of total, merchant and date per market group (NFR-17 target ≥ 90% overall)
**And** it reports whether Western-numeral totals on the Arabic and Devanagari receipts were read (OCR-007 Phase 1 script scope).

**Given** licensing and store disclosure
**When** the record is written
**Then** it states each candidate's licence and model licence and whether they are compatible with no data collection
**And** it contains the Play Data-safety rationale text for the chosen engine (`Receipt text is read on this phone. No data is collected or shared.`, plus the technical justification).

**Given** the chosen engine
**When** the spike closes
**Then** `packages/core/src/ports/OcrEngine.ts` defines `recognise(image: FileRef, signal: AbortSignal): Promise<OcrResult>`, where `OcrResult` holds the image width and height and blocks of `{ text, box: { left, top, right, bottom } in pixels, confidence: number | null }`, and `OCR_UNAVAILABLE` and `CANCELLED` are typed failures
**And** each of the 40 synthetic images has its recorded `OcrResult` from the chosen engine saved as a JSON fixture in `packages/core/test/fixtures/receipts/` for the core parser tests
**And** the GATE-05 sign-off (Mobile/OCR engineer) is recorded in the file with the date.

**Given** neither candidate passes the airplane, denylist or allowlist criteria within the time box
**When** the record is written
**Then** it names the blocker and the fallback put to the product owner (DEC-10: attach a photo and enter by hand), and it lists the affected stories (10.6 onwards).

**Covers:** Spike S3, GATE-05, AD-14 (engine choice, port), OCR-002 (bundled model, no download, evidence), OCR-007 (script coverage evidence), NFR-08 (first latency evidence), NFR-17 (receipt reference set), SEC-002 (no INTERNET, no telemetry)

### Story 10.2: Read receipt lines and fields in core

As Mei,
I want wmbugo to work out the merchant, date, total, tax, discounts and each item from the text on my receipt, and tell me which parts it isn't sure about,
So that I only check what needs checking.

**Acceptance Criteria:**

**Given** `parseReceipt(ocrResult, { region, profileCurrency })` in `core.capture` (pure TypeScript, no RN imports)
**When** it runs on an `OcrResult`
**Then** it returns either a `ReceiptDraft` or the failure `UNREADABLE`
**And** a `ReceiptDraft` holds `merchant`, `date`, `time`, `currency`, `subtotal`, `taxes[]`, `fees[]`, whole-bill `discounts[]`, `total` and `items[]` (name, amount, an item discount printed under it, line index), plus `unparsedLineCount`, and every field is `{ value, certainty: 'sure' | 'unsure' | 'missing' }`.

**Given** text blocks from the engine
**When** lines are grouped
**Then** each block's vertical midpoint is `(top + bottom) / 2`, and blocks join one line when their midpoints differ by no more than half the median block height (adaptive tolerance), ordered by midpoint then left edge
**And** a regression fixture where `top + bottom / 2` would merge two item lines groups them correctly.

**Given** a multi-column receipt (item name, quantity and price columns, or a price column far to the right)
**When** lines are grouped
**Then** the right-aligned number column is detected from the cluster of block right edges and each price joins the item on its row, including a tilted photo with a slope of up to 5°.

**Given** the profile region
**When** amounts are read
**Then** `1.234,56` is read as 1234.56 in a decimal-comma region (e.g. DE, FR, ES, IT, NL), `1,234.56` and the Indian grouping `1,23,456.00` as written in decimal-point regions, and a value with both separators always takes the last one as the decimal mark
**And** amounts become integer minor units through the Story 1.4 money primitives (JPY 0, INR 2, KWD 3 digits), never floats.

**Given** the field rules
**When** a draft is built
**Then** the total comes from the last amount on a line with a total keyword (`Total`, `Grand total`, `Amount due`, `Net amount`, `Balance due`, `To pay`, `Summe`, `Gesamt`, `Total TTC`, `Totale`, `Importe`, `Totaal`); taxes from `GST`, `CGST`, `SGST`, `IGST`, `VAT`, `MwSt`, `TVA`, `IVA`, `HST`, `Sales tax`; fees from `Service charge`, `Service`, `Delivery`, `Packing`; whole-bill discounts from `Discount`, `Savings`, `Promo`, `Member`, `Rabatt`, `Remise` lines after the items, while a negative amount directly under an item is that item's discount
**And** the merchant is the first mostly-letter line in the top fifth that is not an address, phone, tax-ID or URL line
**And** dates follow the region's order (day-month-year in IN, UK/EU, SG, Gulf; month-day-year in US), and a date that could be read both ways in CA, or any date read with engine confidence below 0.80, is `unsure`.

**Given** uncertainty
**When** certainty is set
**Then** a field is `unsure` when any of its characters has engine confidence below 0.80, when two different total candidates exist, or when the total differs from the subtotal plus tax and fees minus discounts; it is `missing` when not found
**And** a missing total with at least one item is filled with the items sum and marked `unsure`.

**Given** the Phase 1 script scope (OCR-007)
**When** a line is mostly Arabic, Devanagari or other non-Latin letters
**Then** its text is never used as a merchant or item name, but Western-numeral amounts on it are still read (an Arabic receipt with `12.500` on its total line returns that total)
**And** Eastern Arabic or Devanagari digits are not read, so a total printed only in them is `missing`.

**Given** an `OcrResult` with no text, or with no readable amount at all
**When** it is parsed
**Then** the result is `UNREADABLE`.

**Given** the 40 synthetic fixtures from Story 10.1
**When** core tests run
**Then** total, merchant and date are each correct on at least 90% of receipts overall (NFR-17), the result per market group is printed, and the test fails below 90%
**And** the scoring function `scoreReceiptFields(draft, groundTruth)` lives in core so the measurement app (Epic 14) reuses it on testers' phones
**And** parsing the 30-line fixture takes under 50 ms in the Node benchmark.

**Covers:** OCR-003, OCR-004, OCR-007 (Latin script and Western numerals scope), NFR-17 (receipts, synthetic set), AD-14 (parsing in core), FIN-001 (minor units)

### Story 10.3: Reconcile a receipt and allocate tax, fees and discounts in core

As Mei,
I want the parts of my receipt to add up exactly to what I paid, with tax and discounts shared across the items and anything unread shown as `Not itemised`,
So that every category total is right to the cent and nothing is silently lost or invented.

**Acceptance Criteria:**

**Given** `allocateReceipt(draft, itemCategories, mainCategory)` in `core.ledger`, built on Story 3.7's `reconcileReceiptTotal`
**When** it runs
**Then** it returns `{ state: 'reconciled' | 'not_itemised' | 'mismatch', notItemised, mismatch, items: [{ allocatedAmount, categoryId }], categoryTotals }` in exact minor units.

**Given** a discount printed under a specific item
**When** allocation runs
**Then** it reduces only that item.

**Given** tax, service charges, fees and whole-bill discounts
**When** allocation runs
**Then** each is spread over the itemised lines in proportion to their amounts after item discounts, rounded down in minor units, with the remaining minor units added to the largest item (first in line order on a tie), and never spread over the `Not itemised` amount.

**Given** items S$42.00 (Groceries) and S$18.00 (Household), a whole-bill `Member discount –S$6.00` and total S$54.00
**When** allocation runs
**Then** the state is `reconciled` and the category totals are Groceries S$37.80 and Household S$16.20.

**Given** items plus tax and fees minus discounts below the total (a 14-line receipt where 12 lines were read)
**When** allocation runs
**Then** the state is `not_itemised`, the difference is a `Not itemised` amount sent to the seeded Uncategorised category with the Story 3.7 `not_itemised` flag, and saving is allowed.

**Given** items plus tax and fees minus discounts above the total, or a discount larger than its item
**When** allocation runs
**Then** the state is `mismatch` with the excess amount, and no negative item, split or row is ever produced.

**Given** a draft with a total and no items read
**When** allocation runs
**Then** the whole total is one split in the main category, with no `Not itemised` row (the same result as a manual entry).

**Given** the fast-check suite
**When** core tests run
**Then** for any reconciled or not-itemised draft the category totals plus `Not itemised` equal the total exactly, no allocated amount is negative, and `Not itemised` never contains tax, fees or discounts
**And** allocation tests pass for INR (2 digits), JPY (0) and KWD (3), and `toSplits(allocation)` produces splits that pass the writer invariant (LIR-02).

**Covers:** OCR-005 (reconciliation, pro-rata allocation, remainder on largest item, Not itemised, no negative row), OCR-012 (item categories become splits), FIN-022, TXN-009 (Not itemised split), LIR-02

### Story 10.4: Review a read receipt and save it as one expense

As Mei,
I want one screen that shows what was read from my receipt, lets me correct anything and saves it with one tap,
So that a receipt becomes a correct entry with its photo attached.

**Acceptance Criteria:**

**Given** a `ReceiptDraft` and its pending photo (opened from core fixtures in tests and the debug build until the photo flow arrives in Story 10.6)
**When** the receipt review screen (SCR-23) opens
**Then** it shows, top to bottom: the photo thumbnail (tap → full-screen viewer), merchant, date, `Paid with` chip, a category chip row (quick-category chips, UX-DR32), category totals, the grey `Not itemised` row when present, a collapsed `Items (N)` row, the total, and a sticky footer with `Save`
**And** every surface over the photo uses the solid glass fallback (UX-DR4).

**Given** the merchant, date, total, subtotal, tax, fee and discount fields
**When** Mei taps any of them
**Then** she can correct it (text field, date picker, or the Story 1.13 keypad for amounts), and the allocation from Story 10.3 reruns immediately.

**Given** a total that is `unsure` or `missing`
**When** the screen renders
**Then** the total row is highlighted with a warning icon and `Tap to confirm total`, and `Save` is disabled but focusable with the hint `Confirm the total to save`
**And** tapping the total opens the keypad pre-filled with `Confirm`; confirming, with or without a correction, enables `Save`.

**Given** a date that is `unsure` or `missing`
**When** the screen renders
**Then** the date defaults to today when missing (the read date when only unsure), with a warning icon and the text `date?` beside it, and `Save` stays enabled
**And** TalkBack reads it as `Date, 7 Nov, not sure, double tap to change`.

**Given** the `Paid with` chip
**When** the screen opens
**Then** it defaults to the account of Mei's most recent confirmed expense at the same normalized merchant (Story 3.1 normalizer), else `Cash`, and tapping it opens the account picker
**And** when `Cash` is chosen and no Cash account exists, it is created with `balance not set` in the same save (Story 1.13 precedent).

**Given** the category
**When** the screen opens
**Then** the main category defaults to the category of Mei's most recent confirmed expense at that merchant; with no history the main category is `Uncategorised` (Save is never blocked); the saved entry carries the `add category` tag and appears under `Add a category` in the review queue (TXN-008)
**And** every item without its own category takes the main category, and the category totals show one row per category with its amount, largest first.

**Given** a `Not itemised` amount
**When** it renders
**Then** it is a grey row `Not itemised · S$4.00` with the hint `Lines we couldn't read. Counted as Uncategorised.`, and saving with it is normal, not an error.

**Given** a `mismatch` state
**When** it renders
**Then** an inline warning reads `Items add up to S$62.00, more than the total S$54.00. Fix an item, a discount or the total.`, and `Save` is disabled with the hint `Fix the difference to save`.

**Given** a read currency that differs from the profile currency
**When** Mei saves
**Then** the entry follows the Story 3.10 foreign-currency path (`needs_review`, foreign amount kept, never auto-approved, no exchange rate) and the toast reads `Saved · Check the amount in ₹`.

**Given** a complete review
**When** Mei taps `Save`
**Then** `SubmitCapture` runs with `source_kind = receipt`: one `confirmed` expense (`capture_resolution = user_approved`) on the `Paid with` account, one split per category plus the `Not itemised` split, the receipt items in the `receipt_item` table (created by this story's migration, owner ledger: name, amount, item discount, allocated amount, category, line index, transaction id), and the photo moved from pending to an `attachment` row with its digest, all in one writer transaction with audit and `TransactionsChanged`
**And** the date is the receipt's date with its printed time, or 12:00 in the profile timezone when no time was printed (now, when the date is today)
**And** the toast reads `Saved · Undo`, Undo removes the entry with `removal_kind = deleted`, and its detail later offers `Delete` (receipts are user-initiated, never `Reject · Not mine`).

**Given** `SubmitCapture` returns `POSSIBLE_DUPLICATE`
**When** the save commits
**Then** the entry is `needs_review` and not counted, and the Story 3.3 toast with `Keep both` / `Merge` shows (until the match prompt in Story 10.8 asks before saving).

**Given** Mei leaves the review with Back or `Close`
**When** she confirms the sheet `Discard this receipt? Nothing will be saved.` with `Discard`
**Then** nothing is written and the pending photo is deleted; `Keep editing` returns to the review unchanged.

**Given** TalkBack at 200% text on a 320dp screen
**When** the review is used
**Then** every row has a role and label, category totals read `Groceries, 37 dollars 80`, nothing is truncated, and the footer stays visible.

**Covers:** OCR-005 (every field correctable, total confirmed, Not itemised row, category totals first, Items (N) collapsed), OCR-011 (saved confirmed on Save, Paid with default and Cash fallback, date defaults to today with non-blocking warning), UX-DR66, UX-DR32 (`Paid with` chip), UX-DR59 (Not itemised split row), UX-DR4 (no glass over receipt), TXN-013 (foreign receipt), FLOW-08 (review, Save), SCR-23

### Story 10.5: Give each receipt item its own category

As Mei,
I want to open the items on my receipt and give the notebooks a different category from the groceries,
So that my category reports show where the money really went.

**Acceptance Criteria:**

**Given** the review screen with `Items (14)`
**When** Mei taps it
**Then** it expands (state announced `expanded`) to one row per item: name, allocated amount and a category chip, in receipt order, followed by `Subtotal`, `Tax`, `Service charge / fees` and `Discount` rows when present
**And** an item with a printed item discount shows it under the item as `Discount S$1.00`.

**Given** an item row
**When** Mei taps its category chip and chooses `Education`
**Then** that item moves to Education, the allocation reruns, and the category totals at the top regroup (Education appears with its amount) without collapsing the list
**And** a TalkBack custom action `Change category` on each item row does the same.

**Given** an item row
**When** Mei edits its name or amount, or removes it with `Remove item`
**Then** the allocation reruns; a removed item's amount moves to `Not itemised` when the total stays the same, or the state becomes `mismatch` when the items now add up to more than the total.

**Given** a `Not itemised` amount
**When** Mei taps `Add an item` under the items
**Then** she can enter a name, amount and category for a line the reader missed, and the `Not itemised` amount shrinks by that amount (never below zero; a larger amount turns into the Story 10.4 mismatch warning).

**Given** the main category chip changes
**When** Mei selects another chip
**Then** only items still on the main category move; items she changed herself keep their category.

**Given** Mei saves
**When** the entry commits
**Then** each category's total becomes one split and each `receipt_item` keeps its own category, and Insights, budgets and Home spending use the split amounts (regression test: a Groceries S$37.80 / Household S$16.20 receipt adds S$37.80 to the Groceries budget)
**And** one `ReceiptItemCategorised` event per item the user changed is written to the outbox with the normalized item name, category and actor `user` (added to the event catalogue for the item learning in Epic 11).

**Given** a saved receipt entry
**When** Mei opens its detail and taps `Split`
**Then** the Story 3.7 split editor shows the category splits with `Not itemised` as a grey assigned row, and the detail gains `Items (14)` that opens the same item list read-only with `Edit items` returning to the item editor.

**Covers:** OCR-012 (per-item categories via splits, learning event), OCR-005 (every item correctable, category totals regroup), UX-DR59, UX-DR66 (Items (N)), UX-DR93 (custom action), FIN-022

### Story 10.6: Pick a receipt photo and watch it being read

As Mei,
I want to tap `Snap receipt` in the Add sheet, choose a photo of my receipt and watch wmbugo read it, with a way out at any moment,
So that I get a filled-in review in a few seconds, or a quick path to type it myself.

**Acceptance Criteria:**

**Given** the Add sheet on the Expense tab
**When** it renders
**Then** a `Snap receipt` chip (camera icon) is first in the chip row in every market (UX-DR32), and in this story it opens the Android Photo Picker filtered to images (no storage permission; permission-spy test)
**And** the Add sheet draft (Story 1.13) is kept while Mei scans.

**Given** a chosen image
**When** it is taken in
**Then** a native module applies the EXIF orientation, scales it to at most 2,048 px on the long edge, encodes it as JPEG quality 85, removes all EXIF metadata (including location), and writes only that copy encrypted through `FileStore` as a pending file with provenance `photo_picker`; the original is never copied.

**Given** an image whose digest equals an attachment already saved
**When** it is chosen
**Then** `This receipt is already saved` shows with `Open it`, and nothing is read or written.

**Given** the chosen engine's adapter in `apps/mobile/src/adapters/ocr` implementing the Story 10.1 port with the model bundled in the APK
**When** a receipt is read
**Then** recognition and image processing run on native threads (AD-16), and ≥ 95% of frames render at 60 FPS with no stall > 100 ms during the scan (NFR-06).

**Given** reading starts
**When** the `<LongTaskLoader>` from Story 9.6 shows its OCR scan-line variant (SCR-31)
**Then** it shows the photo with a scan line sweeping top to bottom, the title `Reading receipt…`, the reassurance `Nothing is saved yet.` and `Cancel`
**And** once lines are parsed, item names appear one by one under the photo and the progress `3 of 14 items` updates as a polite live region.

**Given** Reduce motion (system animator scale 0 or the in-app toggle)
**When** the loader shows
**Then** the photo is static with a determinate progress bar and no scan line, and the progress text is unchanged (UX-DR91).

**Given** reading is in progress
**When** Mei taps `Cancel` or Back
**Then** recognition is aborted, the pending photo is deleted, nothing is written, and she returns to the Add sheet with her draft.

**Given** the parser returns `UNREADABLE`, or reading takes longer than 20 s
**When** the loader stops
**Then** the inline error pattern reads `Couldn't read this receipt. Nothing was saved.` with `Try again` (reads the same photo again) and `Enter it by hand`
**And** `Enter it by hand` opens the Add sheet on Expense with the photo shown as attached, saving goes through `SubmitCapture` (`source_kind = manual`) with the photo stored as its attachment, and the photo is deleted only if Mei dismisses the sheet without saving.

**Given** the engine reports `OCR_UNAVAILABLE` (model missing or failed to load)
**When** Mei tries to scan
**Then** the error reads `Receipt reading isn't working on this phone. Nothing was saved.` with `Enter it by hand`, and no download is attempted.

**Given** reading succeeds
**When** the draft is ready
**Then** the Story 10.4 review screen opens with the draft and the pending photo.

**Given** a release build on a fresh install with airplane mode on
**When** the Maestro suite picks a synthetic receipt
**Then** the review screen opens with the receipt read and no network request is made.

**Given** the 40 synthetic receipts read 3 times each in a release build on each Story 1.3 reference device
**When** the benchmark runs
**Then** p95 from photo chosen to review screen shown is ≤ 5 s for the standard single-page receipts (NFR-08), and the results are stored in CI artefacts.

**Covers:** OCR-001 (picker, compressed copy only, provenance), OCR-002 (bundled model, offline from install, honest unavailable error), OCR-007 (manual entry in one tap with the photo), OCR-008, OCR-009 (Snap receipt chip, gallery pick in the Add flow), OCR-014, NFR-06, NFR-08, AD-14 (adapter), AD-16, UX-DR53 (OCR scan-line variant), UX-DR51, UX-DR91, UX-DR100 (receipt error string), FLOW-08, SCR-31

### Story 10.7: Snap a receipt with the camera

As Mei,
I want to take a photo of a receipt straight from the ＋ button,
So that scanning a receipt at the checkout takes one long-press.

**Acceptance Criteria:**

**Given** the camera route (VisionCamera, current stable major)
**When** Mei opens it from the `Snap receipt` chip, a long-press on ＋, or the TalkBack custom action `Snap receipt` on ＋ (`Add entry`)
**Then** a full-screen camera opens with a 72dp shutter labelled `Take photo`, `Choose a photo` (opens the Story 10.6 picker path), a `Light` toggle and `Close`
**And** the `Snap receipt` chip now opens the camera instead of the picker.

**Given** a photo is taken
**When** the preview shows
**Then** `Use photo` sends it through the Story 10.6 intake and reading (provenance `camera`), and `Retake` returns to the camera
**And** the camera's temporary file is deleted after intake and nothing is written to the phone's gallery or shared storage.

**Given** camera permission was never asked
**When** the camera route opens for the first time
**Then** the shared `requestPermission('camera')` helper asks then (never during onboarding; permission-spy test), `CAMERA` is added to the release allowlist, and `PERMISSIONS.md` gains its row (feature, in-context reason, what works when denied, revocation handling).

**Given** camera permission is denied
**When** the camera route shows
**Then** the inline pattern reads `Camera is off for wmbugo` with `Pick a photo instead` (opens the picker path) and `Enter it by hand`, plus `Open settings` when Android will no longer show the prompt
**And** there is no repeated prompt, and the Add sheet and picker keep working.

**Given** permission is revoked in Android settings while wmbugo is in the background
**When** Mei returns to the camera
**Then** the denied state shows without a crash or restart.

**Given** app lock is on
**When** the camera opens from ＋ after the timeout
**Then** LockGate is passed first, and the app-switcher snapshot of the camera screen is obscured like the rest of the app.

**Given** Mei closes the camera with `Close` or Back
**When** she returns
**Then** she is back where she started (the Add sheet draft intact, or the tab she long-pressed from), and nothing is written.

**Given** Switch Access with no gestures
**When** Mei scans a receipt end to end
**Then** every step is reachable through visible controls and the ＋ custom action (UX-DR93).

**Covers:** OCR-001 (camera with permission), OCR-009 (long-press ＋, Snap receipt chip), UX-DR18 (long-press ＋ and `Snap receipt` custom action), UX-DR69 (just-in-time camera permission, `Pick a photo instead`), UX-DR93, SEC-003 (permission inventory), FLOW-08 (camera)

### Story 10.8: A receipt that matches an entry: Attach to it, Keep separate or Discard

As Mei,
I want wmbugo to notice when a receipt is for a payment I've already recorded and ask me what to do,
So that the same dinner is never counted twice.

**Acceptance Criteria:**

**Given** a read receipt
**When** the review screen opens
**Then** a dry run of the Story 3.1 matcher (`previewMatch`, no writes) checks it against confirmed and `needs_review` expenses, including the receipt rule (same merchant, same day, a charge 0–30% higher).

**Given** a probable match (a ₹2,340 HDFC debit at 6:12 pm today and a ₹2,340 receipt from the same merchant)
**When** the review renders
**Then** a prompt above the category totals reads `Matches ₹2,340 HDFC debit 6:12 pm` (with the date when not today: `Matches ₹2,340 HDFC debit · 6 Nov, 6:12 pm`) with `Attach to it`, `Keep separate` and `Discard`, and the footer `Save` is replaced by these choices until Mei picks one
**And** the words Approve and Reject never appear, and nothing is attached without her tap.

**Given** two or three probable matches
**When** the prompt renders
**Then** it lists up to 3, nearest amount then nearest time first, each with its own `Attach to it`, followed once by `Keep separate` and `Discard`.

**Given** Mei taps `Attach to it`
**When** `AttachReceipt` (capture use case) commits
**Then** the existing entry keeps its account, amount, time and status, gains the photo as an attachment, a `source_record` with kind `receipt`, the `receipt_item` rows and the receipt's category splits, in one writer transaction with audit and `TransactionsChanged`, and the toast reads `Receipt attached · Undo`
**And** when the charge is higher than the receipt (₹1,150 card charge, ₹1,000 receipt), the difference becomes a `Tip / adjustment` split in the receipt's largest category, as in Story 3.3
**And** Undo restores the entry, its splits and its sources exactly (property test).

**Given** the entry Mei attaches to already has receipt items
**When** she taps `Attach to it`
**Then** a sheet asks `Replace its 14 items with these 12?` with `Replace items` and `Keep current items`; the photo is attached either way.

**Given** Mei taps `Keep separate`
**When** she then taps `Save`
**Then** the receipt is saved as a new `confirmed` expense with `user_approved` and no open duplicate candidate, because she decided, and the toast reads `Saved · Undo`.

**Given** Mei taps `Discard`
**When** it completes
**Then** nothing is written, the pending photo is deleted, and the review closes with the toast `Receipt discarded`.

**Given** the LIR-04 / RB0-8 property test
**When** core tests run on generated ledgers and receipts
**Then** a receipt matching a confirmed SMS, manual or imported expense never results in two confirmed expenses unless `Keep separate` was chosen, and Back, Cancel, process death and failure paths all write nothing.

**Given** a confirmed receipt-only entry (₹2,340, Paid with Cash, 14 items)
**When** a matching card SMS (core fixture) or CSV row (Epic 9) arrives later
**Then** `SubmitCapture` stores it as `needs_review` with an open duplicate candidate, it is never auto-approvable (`isAutoApprovable` false), and the review queue card shows source `Receipt` with `Merge` and `Keep separate` (the Story 3.3 `KeepBoth` command, labelled `Keep separate` whenever one side is a receipt)
**And** `Merge` leaves one entry on the card account with the 14 item splits, the Cash balance unchanged and both sources kept.

**Covers:** OCR-006, OCR-010, OCR-011 (later matching capture flagged possible_duplicate with Merge / Keep separate), LIR-04, RB0-8, FIN-027 (receipt tolerance, Merge), UX-DR66 (match prompt), FLOW-08 (match step)

### Story 10.9: Snap a receipt to split an entry, and one way in for every receipt source

As Mei,
I want to snap the receipt for a supermarket payment that's already recorded and have its items split the entry,
So that a mixed shop is broken into the right categories without being added twice.

**Acceptance Criteria:**

**Given** the detail of a confirmed expense with a merchant and no receipt items
**When** it renders
**Then** it offers `Snap receipt to split` beside `Add receipt photo` (Story 3.11).

**Given** Mei taps `Snap receipt to split`
**When** the camera (Story 10.7) and reading (Story 10.6) complete
**Then** the review opens in attach mode with the header `Splitting ₹2,340 · HDFC debit · 6:12 pm`, no match prompt, and the footer `Attach and split`, which commits through `AttachReceipt` (Story 10.8) with the toast `Receipt attached · Undo`.

**Given** the receipt total is lower than the entry
**When** the review renders
**Then** the line `₹260 will be shown as Tip / adjustment` shows and saving adds that split, as in Story 3.3.

**Given** the receipt total is higher than the entry
**When** the review renders
**Then** the warning `This receipt totals ₹2,600 but the entry is ₹2,340. Check the total, or attach the photo only.` shows with `Attach photo only`, and `Attach and split` is disabled until the total no longer exceeds the entry.

**Given** the entry is removed while Mei is scanning
**When** she taps `Attach and split`
**Then** the inline error `This entry was removed. Nothing was changed.` shows (Story 3.4) and nothing is written.

**Given** the single entry `startReceiptScan({ origin, attachTo?, imageUri? })` with origins `add_sheet`, `plus_long_press`, `entry_detail`, `widget`, `share` and `notification`
**When** it is called
**Then** it passes LockGate, opens the camera (or, with `imageUri`, goes straight to intake and reading), and with `attachTo` runs attach mode; the deep link `wmbugo://receipt/scan?attachTo=<id>` maps to it
**And** a unit test proves each origin reaches the review, so the Epic 11 widget and the capture-notification action `Snap receipt to split`, and the Epic 12 non-UPI share fallback, reuse it without changes.

**Covers:** OCR-013 (Snap receipt to split, links the result to that entry; notification action wired in Epic 11), OCR-009 (single entry for widget and shared images), OCR-006, FLOW-08 (widget Snap path)


## Epic 11: Capture review, learning and widget

Priya reviews automatic captures from a notification or a quick bottom sheet over whatever app she is in, deciding each payment with one tap, or swiping through a batch. wmbugo learns her categories, accounts, credit types and transfer choices per merchant and payer from what she does (never from what it did itself), and shows her everything it learned so she can change or forget it. Eligible captures she leaves alone add themselves after the evening cutoff in one honest database write, followed by one evening summary. A home-screen widget gives one-tap Snap and Add plus `N to check`, without showing amounts unless she allows it.

Epics 12 (UPI share) and 13 (bank SMS) are not built yet, so every capture-source behaviour in this epic is exercised through core fixtures and the debug-only **Capture lab** test source (Story 11.4), plus the real receipt (Epic 10), CSV (Epic 9) and manual (Epic 1/3) sources where they apply. Outside India (PRD §13.0a/§13.2) learning, the widget and the capture sheet code ship in every build; notifications, grouping, auto-approve and the evening summary appear only where an automated capture source exists.

### Story 11.1: Spike S5 — Capture sheet open time in a dialog-styled activity

As Priya,
I want the capture sheet to appear almost instantly when I tap a payment notification,
So that checking a payment over another app never feels slower than ignoring it.

**Acceptance Criteria:**

**Given** a throwaway branch with a dialog-styled Android activity (`CaptureDialogActivity`, theme `Theme.Translucent.NoTitleBar`-based, `excludeFromRecents`, `taskAffinity` separate from the main task) in the main process hosting a React Native root that renders a bottom sheet with a fixture card (header, 4×3 category grid, footer)
**When** it is launched from a test notification's content intent
**Then** it opens over the dimmed current app with no `SYSTEM_ALERT_WINDOW` permission (release permission allowlist check stays green) and Back or swipe-down closes only the sheet, returning to the host app.

**Given** both reference devices from Spike S8 and a release build
**When** time from notification tap to the first frame with the card's amount drawn is measured 30 times each in three states (main process alive and app in background; process alive with the dialog opened before; process killed)
**Then** p50 and p95 for each state are recorded in `docs/spikes/S5-capture-dialog.md` with the method, device models and raw numbers.

**Given** the measured p95 with the process alive
**When** it is ≤ 400 ms on both devices
**Then** the decision recorded is "React Native screen in the dialog activity" (AD-12 default); when it is > 400 ms the decision is a native Kotlin sheet shell that shows the header immediately and mounts the React Native body after, and the record names which parts move to Kotlin
**And** the cold-process figure is recorded with a note on what the sheet shows while the JS runtime starts (a header skeleton, never an empty scrim).

**Given** the spike's conclusions
**When** the story closes
**Then** the ADR section of AD-12 is updated with the decision and threshold used, and Story 11.4 builds on that decision; no production code from the spike is merged except the activity manifest entry and the open-time measurement hook.

**Covers:** S5, AD-12 (dialog open-time decision), CAP-002 (no draw-over permission), UX-DR39 (open-time measurement)

### Story 11.2: Learning core — normalized keys, learned categories and user-only teaching

As Priya,
I want wmbugo to remember the category I give a merchant and suggest it next time, but only from things I chose myself,
So that my effort falls over time and a wrong guess can never teach itself.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the learning module owns `learned_mapping(id, key_kind[merchant|upi_id|item|category|payer|mandate], key, target_kind[category|account|credit_type|transfer_choice], category_id?, account_id?, credit_type?, transfer_target_account_id?, mixed, recent_confirmations, updated_at)` with a unique key on (key_kind, key, target_kind), plus `merchant(id, canonical_name, aliases, archived)` and `payee(id, upi_id?, display_name)`, and `transaction.merchant_id` / `payee_id` are populated for new entries.

**Given** the Story 3.1 normalizer
**When** learning builds a key
**Then** merchant keys use it unchanged (`SWIGGY*BLR 8821`, `Swiggy` and `SWIGGY  ORDER 4410` all key `swiggy`), UPI IDs are lowercased and trimmed (`Ravi.Tea@OKAXIS` → `ravi.tea@okaxis`), and receipt item keys use the same rules on the item name
**And** when an entry has no merchant name but a payee UPI ID, the key is the UPI ID (LRN-002).

**Given** a teaching event delivered by the outbox: `CategoryAssigned` with actor `user` (Story 4.4 edits and `Looks right`, manual saves with a merchant, capture approvals in this epic) or `ReceiptItemCategorised` (Story 10.5)
**When** the learning handler runs (idempotent on the event id)
**Then** it upserts the mapping for that key, appends the category to `recent_confirmations` (kept to the last 5), and sets `mixed = true` when those 5 hold 2 or more different categories
**And** an event with `remember = false` changes nothing, and an event with actor `auto` or `system` is ignored entirely, including for the mixed window (LRN-008).

**Given** a wrong guess (Instamart → Food & Drinks) written by auto-approve five nights in a row (fixture events with actor `auto`)
**When** Priya then changes one Instamart entry to Groceries
**Then** the mapping for `instamart` is Groceries, `recent_confirmations` holds only user choices, and the merchant is not mixed (PRD §8.17 acceptance).

**Given** Swiggy confirmed by Priya as Food & Drinks, Food & Drinks, Groceries
**When** the next Swiggy capture is classified
**Then** the merchant is mixed, the suggester returns no category, and the query `pastCategoriesFor(key)` returns `Food & Drinks`, `Groceries` (most recent first, up to 4) for one-tap choices.

**Given** the `CategorySuggester` port from Story 4.4
**When** this story lands
**Then** its learning adapter replaces the default for non-manual sources: a non-mixed merchant mapping wins, then a UPI ID mapping, else nothing; the result carries `reason = learned_merchant | learned_payee` and sets `category_guessed = true`
**And** manual Add-sheet saves still never receive a suggestion, and a category with `category_set_by = user` is never replaced (Story 4.4 regression test).

**Given** an action that taught a mapping is undone from its toast
**When** the undo commits
**Then** the mapping returns to its state before that event (handler records the prior state keyed by the originating event id; round-trip test).

**Given** the core command `RenameMerchant(merchantId, canonicalName)`
**When** it commits
**Then** the display name changes everywhere the merchant shows, every `transaction.original_description` and `source_record` text stays exactly as received, and the mapping key is unchanged (FIN-025).

**Given** the property and privacy suites
**When** core tests run
**Then** a property test proves no learning operation ever changes an amount, posting or split total; a backup → restore round trip (Story 8.8 fixture) keeps every `learned_mapping`, `merchant` and `payee` row; and the learning module has no port that could send data off the phone (architecture test).

**Covers:** LRN-001 (core pre-categorisation), LRN-002 (UPI ID key), LRN-003 (mixed detection), LRN-004 (item mappings), LRN-006, LRN-008, LRN-009, FIN-025, CAT-005 (learning from corrections), AD-6 (learning taught only by actor `user`)

### Story 11.3: Remembered accounts, items and corrections inside the app

As Priya,
I want the Add sheet and receipt review to pick the account and categories I normally use, and to choose whether a correction should be remembered,
So that the app gets faster for me even before any automatic capture reaches my phone.

**Acceptance Criteria:**

**Given** a confirmed entry saved by Priya with a category and an account
**When** the learning handler runs
**Then** it records the account per category (`key_kind = category`, `target_kind = account`) and, when the entry has a merchant, per merchant (`key_kind = merchant`, `target_kind = account`); auto-approved entries never teach (LRN-008)
**And** the migration backfills both mappings once from existing entries with `capture_resolution` `user_approved` or null (manual), newest first.

**Given** the Add sheet (Story 1.13)
**When** Priya taps `Food & Drinks`
**Then** the account chip defaults to the learned account for that category, else the existing fallbacks (most recently used account, her only account, `Cash`) unchanged.

**Given** the receipt review (Story 10.4)
**When** it opens for `FairPrice`
**Then** `Paid with` defaults to the learned account for `fairprice`, else `Cash`; the main category defaults to the learned merchant category (caption `guessed`), else `Uncategorised`, which never blocks Save
**And** when the merchant is mixed, the main category is `Uncategorised` and the chips of its past categories lead the quick-category row.

**Given** learned item mappings (`notebook` → Education, `milk` → Groceries)
**When** a receipt with those items is read
**Then** each matching item opens with its learned category and the item row caption `guessed`, the category totals regroup accordingly, items Priya changes keep their choice, and saving emits `ReceiptItemCategorised` only for items the user changed (Story 10.5), so a guess she leaves alone never teaches itself.

**Given** transaction detail of an entry with a merchant (SCR-08)
**When** Priya taps the `Category` row
**Then** the category picker shows a full-row checkbox `Remember for this merchant` (checked by default) above its list, and saving emits `CategoryAssigned` with actor `user` and `remember` set from the checkbox
**And** with the box unchecked the entry changes but the mapping does not (J-EVENING step 4).

**Given** TalkBack
**When** the checkbox is focused
**Then** it reads `Remember for this merchant, checkbox, checked`.

**Covers:** LRN-007, LRN-004 (item suggestions in receipt review), LRN-005 (Remember in the app), LRN-008, J-EVENING (fix with Remember)

### Story 11.4: Capture sheet — decide one capture with one tap

As Priya,
I want a payment notification to open a small sheet over the app I'm in, with my likely category already picked,
So that I can confirm or fix the payment in one tap and get back to what I was doing.

**Acceptance Criteria:**

**Given** a debug build
**When** Priya's tester opens Settings › Help › Diagnostics › `Capture lab` (present only in debug builds; a CI check fails if the string or module appears in a release bundle)
**Then** it lists core fixtures (`Debit · known merchant`, `Debit · unknown merchant`, `Debit · UPI ID only`, `Credit`, `Transfer-like debit`, `Unknown account ••7730`, `Possible duplicate`, `Foreign currency`) and `Submit`, which sends the fixture through `SubmitCapture` with `source_kind = sms` and a fixture sender marked verified, and opens the sheet via the same deep link a notification uses
**And** later stories in this epic add their fixtures here; no release code path can create a fixture capture.

**Given** the S5 decision (Story 11.1)
**When** `wmbugo://capture?ids=<id>` is opened
**Then** it passes the LockGate pending-intent queue (Story 8.3), then `CaptureDialogActivity` shows SCR-27 as a bottom sheet at 60–70% of the window height (full height at fontScale ≥ 1.3) over the dimmed host app; p95 open time on the reference devices meets the S5 threshold (perf test recorded in the story notes)
**And** the Story 8.2 recents hiding applies to this activity.

**Given** a waiting ₹420 Swiggy debit on HDFC debit ••4821 at 8:42 pm with Food & Drinks guessed
**When** the sheet renders
**Then** the header band (132 dp `gradient.brand`, ≤ 45% in dark) shows `₹420` (headline, tabular), `Swiggy`, `HDFC debit ••4821 · 8:42 pm` and `Later` top-right, all in `on-glass-primary`; below it the category grid, the `Remember for this merchant` row and a sticky solid footer with `Reject` (button-secondary-on-footer) and `Approve` (button-primary), equal width, 12 dp gap
**And** the band text contrast is ≥ 5.61:1 in dark (screenshot contrast test).

**Given** the category grid
**When** it renders
**Then** it has 4 columns with 8 dp gaps, 48 dp tiles with a 24 dp outline icon and a caption up to 2 lines (2-line height reserved), ordered by this merchant's user-confirmed history then by overall use count (the quick-chip count), the guessed category pre-selected (`on-glass-accent` fill, filled `bg-canvas-dark` icon, Medium label, ≥ 4.85:1), no `cat-*` tints, and a 12 dp chevron on cells with subcategories
**And** TalkBack reads a radiogroup `Category` with cells such as `Food & Drinks, selected, has subcategories` (ordering unit test).

**Given** a single capture
**When** Priya taps `Groceries`
**Then** `ApproveCapture` commits it `confirmed` / `user_approved` in Groceries with `CategoryAssigned` (actor `user`, `remember` from the checkbox), the sheet closes, and TalkBack announces `Approved Swiggy, 420 rupees, Groceries`
**And** long-press on a cell, or its custom action `Choose subcategory`, replaces the grid with that category's subcategories and a `Back to categories` text button; tapping a subcategory saves the same way.

**Given** the footer
**When** Priya taps `Approve` with no category selected on a debit
**Then** it is confirmed as `Uncategorised` with `needs_category` and appears under `Add a category` in the review queue (Story 3.10); when she taps `Reject`, `RejectCapture` sets `excluded` with `capture_resolution = rejected` and `CapturesRejected`, and the entry shows greyed under `Show rejected` for 90 days where its detail offers `Restore` (Story 3.13)
**And** `Later`, swipe down and Back close the sheet writing nothing; the capture stays `Waiting for you` in `N to check`.

**Given** a merchant that is mixed (Story 11.2)
**When** its capture opens
**Then** no cell is pre-selected and the past categories lead the grid with the caption `You've used more than one category here`.

**Given** a debit with no merchant name (`Debit · unknown merchant`) or only a UPI ID
**When** the sheet renders
**Then** a field `Who was this paid to?` (optional, placeholder the UPI ID when present) sits above the grid; a name entered there becomes the merchant, or for a UPI ID the payee's display name once (`Ravi Tea Stall`), used on every later capture from that ID (LRN-002).

**Given** a capture that was decided elsewhere (from the shade, the review queue or another sheet) while this sheet was open
**When** Priya taps a cell or a footer button
**Then** nothing is written and the inline line `Already decided · Recorded` (or `Already decided · Rejected`) replaces the footer with `Close`.

**Covers:** CAP-002, CAP-003, CAP-008, LRN-001 (guess shown pre-selected), LRN-002 (name the payee once), LRN-003 (one-tap past categories), LRN-005 (dialog Remember, default on), UX-DR39 (single, unknown merchant), UX-DR41, UX-DR43, UX-DR113, AD-12, FLOW-18 (Show rejected restore path)

### Story 11.5: Swipe through several captures with Apply to all similar

As Priya,
I want to go through the day's waiting payments one card at a time, applying one choice to repeated merchants,
So that clearing five payments takes five quick taps and I never approve something I didn't look at.

**Acceptance Criteria:**

**Given** four waiting captures opened with `wmbugo://capture?ids=a,b,c,d` (this story adds `Submit batch of 4` to the Capture lab; the grouped notification in Story 11.6 uses the same link)
**When** the sheet opens
**Then** it shows one capture per card, oldest first, with the pager row `Previous` (left) · `2 of 4` (centre, label) · `Skip` (right) as 48 dp underlined text buttons and 6 dp decorative dots 12 dp below, plus horizontal swipe between cards
**And** at the first card `Previous` is disabled, announced `disabled`.

**Given** a card
**When** Priya taps `Approve`, `Reject` or a category cell
**Then** that capture is decided and the next undecided card slides in; for 500 ms after any card change `Approve`, `Reject` and the grid ignore taps (500 ms guard test with a double tap at 120 ms)
**And** there is no `Approve all` control anywhere (UI test asserts its absence).

**Given** `Skip` on the last card while skipped cards remain
**When** it is tapped
**Then** the pager moves to the first undecided card; `Later` closes the sheet leaving every undecided card waiting.

**Given** the batch holds two or more cards with the same normalized merchant (three Swiggy cards)
**When** Priya picks `Groceries` on one of them
**Then** a `Apply to all similar` text button (underlined, 48 dp, left-aligned) shows directly under the grid and above the Remember row, and tapping it pre-selects Groceries on the other undecided Swiggy cards with the inline confirmation `Groceries chosen for 2 more Swiggy cards`; each still needs its own `Approve`
**And** with no shared merchant the button is not rendered, and focus order is grid → `Apply to all similar` → Remember row.

**Given** each card
**When** it renders
**Then** `Remember for this merchant` is per card and checked by default, and only the cards approved with it checked teach (Story 11.2).

**Given** the last undecided card is decided
**When** the commit returns
**Then** the sheet shows `All checked` with the paper boat for 4 s, announced, then closes; under reduced motion the still boat stays until tapped.

**Given** TalkBack
**When** Priya approves card 2 of 5
**Then** focus moves to the new card's heading and announces `Approved Swiggy ₹420. Card 3 of 5: Zomato, 310 rupees, Food guessed`; `Previous`, `Skip`, `Approve` and `Reject` are also custom actions on the card, the dots are decorative, and under TalkBack or reduced motion cards cross-fade or swap instantly (announcement string test).

**Given** a capture in the batch is decided elsewhere meanwhile
**When** the pager reaches it
**Then** it is skipped and `N of M` recounts without it.

**Covers:** CAP-005 (swipeable cards, Apply to all similar), UX-DR40, UX-DR42, UX-DR43 (per card), FLOW-09 (batch), UX-DR73 (All checked)

### Story 11.6: Capture notifications — full and hidden forms, grouped, decided from the shade

As Priya,
I want each captured payment to arrive as a notification I can approve or reject without opening wmbugo, and several payments to collapse into one,
So that I record my day in seconds without a pile of notifications.

**Acceptance Criteria:**

**Given** `CapturesSubmitted` for a capture from an automated source (fixture `sms` in this epic; Epics 12/13 register theirs)
**When** the notification handler runs (idempotent on the event id) and notification permission is granted
**Then** it posts on a `Captures` channel through the Notifier port, with the form chosen by `decideNotificationForm('capture', settings)` (Story 8.5)
**And** with permission denied nothing is posted, the capture still waits in `N to check`, and no permission prompt is shown from background work.

**Given** the full form for one waiting ₹420 Swiggy debit with Food & Drinks guessed
**When** it is posted
**Then** the title reads `₹420 · Swiggy`, the text `HDFC debit ••4821 · Food & Drinks (guessed)`, and the actions are `Approve ₹420 Swiggy`, `Change` and `Reject ₹420 Swiggy`
**And** `Approve` runs `ApproveCapture` with the guessed category (or `Uncategorised` + `needs_category` with no guess) in the main process without opening the app, `Reject` runs `RejectCapture`, and a shade approval teaches like a sheet approval with Remember checked (LRN-008: it is a user action), and `Change` or a tap opens the capture sheet (Story 11.4).

**Given** a capture that cannot be confirmed as shown (a credit without a learned type, a transfer-like debit, an unknown account, a possible duplicate or a foreign-currency capture)
**When** the full form is built
**Then** it offers `Review` and `Reject ₹… <merchant>` only, never `Approve`.

**Given** a mixed merchant capture
**When** the full form is built
**Then** the third action is `Snap receipt to split`, which calls `startReceiptScan({ origin: 'notification', attachTo: id })` (Story 10.9); the attached receipt splits the waiting entry and it stays `Waiting for you` until decided.

**Given** three waiting automated captures of ₹420, ₹310 and ₹510
**When** the third arrives
**Then** the same notification id is updated in place to the grouped form `3 new transactions · ₹1,240` (sum of waiting money out; credits listed but not added) with an inbox-style list of the three, no `Approve all` action, and a tap opens the sheet with all three as swipe cards (Story 11.5)
**And** deciding one from the sheet or the review queue updates the group to `2 new transactions · ₹730`, and at 0 waiting the notification is removed (grouping test).

**Given** the hidden form (lock screen, app lock on, hide amounts on, or `Hidden` chosen, unless full notifications are opted in)
**When** captures are posted
**Then** one capture shows `New payment to check` and several show `3 payments to check`, with no amount, merchant, account or category and only `Review`, which opens the sheet after LockGate (matrix test across the four triggers × opt-in, UX-DR77)
**And** the lock-screen version is always hidden in this story (lock-screen approve arrives in Story 11.11).

**Given** a shade action fails (writer busy past its timeout, or the capture was already decided)
**When** it returns
**Then** the notification is re-posted unchanged for a busy writer, or removed with nothing written for an already decided capture; no error notification is posted.

**Given** TalkBack
**When** the notification is read
**Then** each action label names amount and merchant (`Approve 420 rupees Swiggy`).

**Covers:** CAP-001, CAP-005 (grouped notification), LRN-001 (notification shows the guess with Change), OCR-013 (notification action wired), SET-003 (capture notifications grouped into one), UX-DR76, UX-DR77, SEC-005 (hidden form for captures), AD-13, FLOW-09 (notification step)

### Story 11.7: Money in — Salary, From a person, Paid me back, Refund, learned per payer

As Priya,
I want to say what a credit is in one tap and have wmbugo remember it for that payer,
So that salary is income, a friend's payback reduces my spending, and neither is ever mistaken for the other.

**Acceptance Criteria:**

**Given** a waiting credit capture of ₹65,000 from `ACME PVT LTD` (Capture lab fixture `Credit`)
**When** the sheet opens
**Then** the header reads `+₹65,000` (semantic-income), `ACME PVT LTD`, the account and time, and a chip row `What is this?` offers `Salary`, `From a person`, `Paid me back`, `Refund` and `Moved from my own account`, with `Approve` disabled and the hint `Choose what this is` until a chip is chosen
**And** the expense category grid is not shown until a refund-type chip asks for a category.

**Given** the chip chosen
**When** Priya approves
**Then** `Salary` records `income` in Salary; `From a person` records `income` in From people; `Paid me back` shows the spending grid and records an unlinked `refund` in the chosen category; `Refund` pre-selects the payer's learned refund category or shows the grid with none selected; `Moved from my own account` hands over to the transfer choices (Story 11.8)
**And** refunds reduce spending in the refund's own period and are never counted as income (Story 3.8 rules, regression test).

**Given** `Remember for this payer` (the Remember row's label on credit cards, checked by default)
**When** the credit is approved with it checked
**Then** learning stores `key_kind = payer` → `credit_type` (and the category for `Paid me back` / `Refund`) keyed by the normalized payer name, or the UPI ID when there is no name (LRN-010).

**Given** Ravi once marked a ₹600 UPI credit from Arun as `Paid me back → Food & Drinks`
**When** Arun's ₹450 credit arrives
**Then** the card opens with `Paid me back` and Food & Drinks pre-selected (`guessed`), the full-form notification shows `+₹450 · Arun · Paid me back (guessed)` with `Approve +₹450 Arun`.

**Given** a credit whose payer has no learned type
**When** its notification is built or the review queue renders it
**Then** it offers only `Review` / `Reject`, it is never placed in `Uncategorised` (which is for expenses only), and it stays out of every total until decided.

**Given** a credit from a person with only a UPI ID (`arun@okicici`)
**When** the sheet renders
**Then** `Who sent this?` lets Priya name the payer once, reused for every later credit from that ID.

**Covers:** CAP-004, LRN-010, LRN-002 (payer naming), UX-DR39 (credit-type variant), FIN-028 (refund recorded, never income)

### Story 11.8: Transfers and bills from a capture — own accounts, card bill, cash, savings and "Rent paid?"

As Priya,
I want a payment between my own accounts, a card bill or a cash withdrawal to become one transfer, and a rent payment to tick off my bill,
So that moving my own money never counts as spending and bills move on exactly once.

**Acceptance Criteria:**

**Given** the core predicate `isTransferLike(capture)`
**When** it runs
**Then** it is true when the capture text says card payment, bill payment to a card, ATM or cash withdrawal, or self transfer (keyword list in core with fixtures), or when the other side resolves to a known owned account identifier; fixtures cover `towards credit card payment`, `ATM WDL`, `self transfer` and a plain UPI merchant (false).

**Given** a waiting debit (Capture lab `Transfer-like debit`)
**When** the sheet opens
**Then** a chip row above the grid offers `Moved to my own account`, `Paid card bill`, `Cash withdrawal` and `Saved / invested`, the one implied by the text pre-selected for transfer-like captures (none for others), and choosing one replaces the grid with the matching account chips (own asset accounts, cards, Cash, savings pots)
**And** each choice is learned per payee or mandate (`target_kind = transfer_choice`, e.g. a monthly SIP mandate → `Saved / invested` → Mutual funds pot) when Remember is checked.

**Given** `Cash withdrawal` with no Cash account
**When** Priya approves
**Then** a Cash account is created with `balance not set`, the withdrawal is its first transfer in, and a one-time tip asks `How much cash did you already have? (optional)` with `Add amount` and `Skip` (recorded in `prompt_state`, never repeated).

**Given** an HDFC ₹5,000 debit already recorded or waiting and an ICICI ₹5,000 credit 7 minutes later
**When** Priya picks `Moved from my own account` on the credit
**Then** account chips show her owned accounts with HDFC pre-selected because an opposite-direction same-amount capture exists within ±3 days, and approving runs `LinkTransferLegs`: one confirmed transfer with both `source_record`s and postings summing to 0, the other leg's waiting entry folded into it (not a second entry), `TransferLinked`, and the toast or announcement `Linked as one transfer` (FLOW-16)
**And** neither leg counts as income or expense (regression test), and a second leg arriving after the transfer exists is attached as an additional source instead of creating an entry.

**Given** two cards and a card-payment debit without a mask
**When** `Paid card bill` is chosen
**Then** both cards are offered with none pre-selected and `Approve` is disabled with the hint `Choose the card`.

**Given** a waiting ₹18,000 debit to Ramesh Kumar near the Rent due date (Story 6.3 rule)
**When** the sheet renders
**Then** the shared `BillMatchPrompt` shows `Rent paid?` with `Yes, link it` and `Not this one` inside the card; `Yes, link it` approves the capture and runs `LinkBillPayment` in one writer transaction with the toast or announcement `Linked to Rent`, and `Not this one` hides it for this entry and rule
**And** a capture that is approved without answering keeps the prompt on its transaction detail (Story 6.3), and nothing links automatically.

**Covers:** CAP-010, CAP-011, CAP-012 (user choices, two legs one transfer, learned per payee or mandate), REC-009 (from a capture), UX-DR39 (transfer and bill-match variants), FLOW-16

### Story 11.9: A new account discovered from a capture

As Priya,
I want a payment from an account wmbugo doesn't know to ask whether to add it or link it to one I have,
So that my accounts stay right without my setting them all up first.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the ledger module owns `account_identifier(id, account_id, bank_key, sender_id?, mask, source[sms|upi_screenshot|csv|manual], created_at)` with a unique key on (`bank_key`, `mask`), where `mask` holds only the masked digits shown as `••7730` (never a full account number) and `sender_id` is a nullable reference filled once a verified sender exists
**And** it is carried by backup and restore like any other table, and Stories 12.2 and 13.5 resolve accounts through this table without creating it again.

**Given** a waiting debit of ₹1,200 from sender `ICICI` mask `7730` with the wording `A/c XX7730 debited` and `Avl Bal Rs 24,300.00` (Capture lab `Unknown account ••7730`)
**When** the sheet opens
**Then** a card section reads `New account ••7730 (ICICI)` with `Add it` and `It's one of mine`, the grid is shown, and `Approve` is disabled with the hint `Add or link this account first`
**And** the capture is not eligible for auto-approve and stays `Waiting for you` everywhere until resolved.

**Given** Priya taps `Add it`
**When** the inline form shows
**Then** type chips `Bank account` and `Card` have `Bank account` pre-selected from the wording (`card`, `credit card` wording pre-selects `Card`), the name defaults to `ICICI ••7730` and is editable, and `Add account` creates it with `account_identifier(sender ICICI, mask 7730)`.

**Given** a bank account created from that capture
**When** it is saved
**Then** the opening balance is `₹25,500` (available ₹24,300 plus this ₹1,200 debit) effective 1 ms before the transaction, so the discovering debit is a normal posting that brings the balance to ₹24,300
**And** with no available balance in the text the account is `balance not set`; a `Card` is created with dues `not set`, and an available-limit figure is never used as a balance.

**Given** Priya taps `It's one of mine`
**When** she picks `ICICI Savings`
**Then** (ICICI, 7730) is linked to it permanently; `••7730` from Axis stays a different identifier.

**Given** other waiting captures from the same identifier
**When** it is added or linked
**Then** they resolve to that account in the same commit, and future captures from it never ask again.

**Covers:** CAP-009, FLOW-15, UX-DR39 (account-discovery variant), ACC-001 (account created from a capture), FIN-010 (masked identifiers in `account_identifier`)

### Story 11.10: Auto-approve as one honest write after the cutoff, with a clock guard

As Priya,
I want payments I didn't get to add themselves after 9 pm, exactly as wmbugo said they would and never earlier,
So that my day is recorded without effort and my totals never show something that wasn't really written.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** `auto_approve_rule(version, enabled, cutoff_local, effective_from)` exists with version 1 `enabled = true`, `21:00`, effective from the next profile-local day, and `profile.clock_guard(wall_time, elapsed_since_boot, boot_count)` exists.

**Given** the pure core predicate `isAutoApprovable(capture, ctx)` (extending Story 3.3's)
**When** it runs
**Then** it is true only when all hold: verified-sender automated source (`upi_screenshot` never), amount and direction fully parsed, account resolved, no open `review_candidate` and no match to an existing confirmed transaction, no scam or balance flag, not transfer-like, profile currency; a credit additionally needs a learned type for its payer, and `Paid me back` / `Refund` a learned category
**And** a table-driven test covers each rule failing alone (LIR-05).

**Given** the pure `guardedNow(stored, wall, elapsed, bootCount)`
**When** it runs
**Then** within the same boot it returns stored wall + elapsed difference; after a reboot it trusts the wall clock only when it is ≥ the stored wall time and ≤ 30 days later, otherwise returns `CLOCK_UNTRUSTED`; the stored latest time is capped at now + 1 day
**And** fixtures pass: setting the clock to 21:01 at 15:00 without a reboot approves nothing before the real 21:00; a jump to 2027 then corrected lets auto-approve run normally within one day.

**Given** the `WriteAutoApprovals` use case
**When** it runs (trigger `open`, `resume` or `job`) with a trusted time after a day's cutoff
**Then** in one writer transaction it writes every capture received before that day's cutoff that is still `needs_review` and eligible as `confirmed` / `auto_approved` with an audit row each: a guessed debit keeps `category_guessed = true`, an unlearned debit becomes `Uncategorised` + `needs_category`, a credit takes its learned type; and it emits `CapturesAutoApproved` with actor `auto`
**And** captures received after the cutoff wait for the next day's cutoff, past days missed while the phone was off are written by their own day's rule, and a run with nothing to write commits nothing.

**Given** two transfer legs that pair with certainty (identifiers resolved, one candidate account)
**When** the write runs with auto-approve on
**Then** they are linked inside the same transaction as one transfer with `capture_resolution = auto_linked` and the label `Recorded · linked as transfer`; with more than one possible account they stay waiting with the transfer choices.

**Given** an auto-linked transfer's detail
**When** Priya taps `Not a transfer`
**Then** `UnlinkAutoTransfer` restores both legs to `Waiting for you` with `TransferUnlinked` and the toast `Unlinked · Undo`.

**Given** the write commits
**When** its events are handled
**Then** budget threshold alerts run once after the commit (Story 4.9 handler), no bill is linked (the `Rent paid?` prompt still shows on detail), and learning ignores the actor-`auto` events (LRN-008).

**Given** the rule history
**When** Priya turns auto-approve off at 20:55 with six captures waiting
**Then** at 21:00 all six stay waiting (loosening applies at once); turning it on at 15:00 first applies at tomorrow's cutoff; moving 21:00 to 22:00 at 21:30 after a write leaves written captures recorded; moving it earlier applies from tomorrow; no change re-evaluates a written day (PRD §8.16 fixtures).

**Given** a capture that becomes a possible duplicate before the write
**When** the cutoff passes
**Then** it stays `Waiting for you` and is excluded from totals.

**Given** the app opens or resumes, and the Scheduler port
**When** each runs
**Then** the clock guard is recorded, `WriteAutoApprovals` runs with trigger `open`/`resume`, and a best-effort background job is (re)scheduled for 2 minutes after the next cutoff through the Scheduler adapter (no exact-alarm permission), re-scheduled on rule change, `ProfileChanged` (timezone), `BackupRestored` and boot
**And** before any write, Home, the widget count, Activity and exports all show eligible captures as waiting and outside totals (regression test).

**Covers:** FIN-026, CAP-007 (eligibility, write after cutoff), LIR-05, CAP-012 (auto-linking, Not a transfer), LRN-008, AD-6, AD-16, DEC-22

### Story 11.11: Settings › Capture — auto-approve time, notifications and lock-screen approve

As Sara,
I want one place to choose when payments add themselves, which notifications I get, and how much they show,
So that wmbugo fits my day and never shows a payment on my lock screen unless I allowed it.

**Acceptance Criteria:**

**Given** Settings (SCR-21)
**When** it renders
**Then** a `Capture` group row exists between Money and Privacy with a live summary (`Auto-approve 9:00 pm` / `Auto-approve off` where an automated source exists, otherwise `Notifications`), and opens rows `Auto-approve`, `Notifications` and `Approve from the lock screen`; rows that need an automated capture source show only when the core helper `captureCapabilities(build, region)` allows them (debug builds with the Capture lab: always; release: from Epic 13 onwards).

**Given** `Auto-approve`
**When** Priya opens it
**Then** a switch `Add waiting payments automatically` and a `Time` row (default `9:00 pm`, locale time format through the shared formatter) are shown with the caption `Only payments from verified bank messages, with a known account and no doubts, add themselves.`
**And** a change writes a new `auto_approve_rule` version; loosening shows `Applies now.` and tightening shows `Starts tomorrow at 9:00 pm.`

**Given** auto-approve is on and a capture is currently eligible
**When** the sheet card or its full-form notification renders
**Then** it shows `Adds itself at 9:00 pm unless you reject it` (caption, secondary on-glass ink, under the Remember row; notification text line), the time following the setting and locale; with auto-approve off or an ineligible capture the line is absent.

**Given** `Notifications`
**When** it renders
**Then** it lists switches `Payments to check`, `Evening summary`, `Budget alerts` and `Bill reminders` (each on by default; the first two only where an automated source exists), `Snooze notifications` with chips `1 hour`, `Until 8 am` and `Off`, the `Notification detail` radios moved from Privacy (`Full details` / `Hidden — shows "New payment to check"` and the full-details opt-in switch from Story 8.5), and the caps line `At most one evening summary and three other reminders a day. Payments to check are grouped into one.`
**And** Privacy › `Notification detail` becomes a link row opening this screen, the Privacy summary keeps `Notifications: full|hidden`, and permission off shows `Notifications are off for wmbugo · Open settings` with every setting still editable.

**Given** a muted type or an active snooze
**When** its notification would post
**Then** nothing posts and nothing in the data changes; at snooze end one grouped capture notification posts for captures still waiting, and budget and bill notifications suppressed by the snooze are not back-filled.

**Given** `Approve from the lock screen` (off by default) with the caption `Shows amounts and Approve / Reject on your lock screen.`
**When** Sara turns it on
**Then** `decideNotificationForm` receives `lockScreenApprove = true`, and the lock-screen notification uses the full form with actions only when the shade form is full; with app lock or hide amounts on (and no full-details opt-in) it stays hidden (matrix test from Story 8.5 extended).

**Given** J-NOTIF
**When** Sara picks `Hidden` and moves auto-approve to 10:00 pm
**Then** the next capture shows `New payment to check` with no amount or merchant, and the Capture summary reads `Auto-approve 10:00 pm`.

**Covers:** SET-003 (per-type opt-in, snooze/mute, caps, no badge), CAP-006, UX-DR44, UX-DR114 (Capture group), UX-DR77 (lock-screen approve opt-in), J-NOTIF, DEC-22 (configurable, can be disabled)

### Story 11.12: The evening summary after the auto-approve write

As Priya,
I want one calm evening notification listing what was added for me, that takes me straight to those entries,
So that I can catch a wrong guess in two taps.

**Acceptance Criteria:**

**Given** the background job's `WriteAutoApprovals` (trigger `job`) commits six entries at 21:04
**When** the commit returns
**Then** `WriteAutoApprovals` emits the summary through the Notifier on an `Evening summary` channel: collapsed `Today: 6 recorded · Tap to review`; expanded inbox-style up to 5 lines merchant first (`Swiggy ₹420 · Food & Drinks`, `Metro ₹60 · Needs a category`, `HDFC → ICICI ₹5,000 · Transfer`) and `+1 more`
**And** Home, the widget and Activity show the same six as recorded at that moment (count equality test).

**Given** the write ran on app open or resume, the job did not run that evening, or the write recorded nothing
**When** the evening passes
**Then** no summary is sent.

**Given** a summary already sent for this profile-local day
**When** another job write commits the same day
**Then** no second summary is sent (once-per-day guard in `prompt_state`).

**Given** the hidden form (app lock on, hide amounts on or `Hidden` chosen, without full-details opt-in) or the lock screen
**When** the summary is built
**Then** it reads `Today: 6 recorded · Tap to review` with no list, amounts or merchants.

**Given** Priya taps the summary
**When** LockGate passes
**Then** Activity opens filtered by the chips `Added automatically` and `Today` (a new `Added automatically` filter in the Story 3.6 filter sheet: `capture_resolution` auto_approved or auto_linked), and each row offers detail where she can change the category with `Remember for this merchant` or `Reject · Not mine` with Undo (J-EVENING).

**Given** `Evening summary` is switched off or snoozed (Story 11.11)
**When** the write commits
**Then** no summary posts and the write is unchanged.

**Covers:** CAP-007 (evening summary), SET-003 (≤ 1 evening summary a day, only after the write), UX-DR78, UX-DR109, J-EVENING, AD-13

### Story 11.13: Learned merchants — see, edit and forget what wmbugo learned

As Priya,
I want a list of everything wmbugo has learned from me, with a way to fix or forget each one,
So that I can trust the guesses because I can see where they come from.

**Acceptance Criteria:**

**Given** Settings › Capture
**When** it renders
**Then** a row `Learned merchants` shows the summary `32 merchants learned` and opens SCR-28; in builds and markets with no automated source the Capture group still exists for it (Settings › Money holds Categories only).

**Given** SCR-28 with learned mappings
**When** it renders
**Then** each merchant or payee is a row such as `Swiggy Instamart → Groceries`, with secondary lines for a learned account (`Paid with HDFC debit`) or credit type (`ACME PVT LTD → Salary`) and `Edit` / `Forget` buttons; item mappings appear in a section `Receipt items` (`notebook → Education`)
**And** with more than 20 rows a search field sits at the top, and with none the boat reads `Nothing learned yet. Corrections you make with "Remember" show up here.`

**Given** a mixed merchant
**When** it renders
**Then** it shows the `mixed` tag and `Clear mixed`; clearing keeps the most recent user category as the learned one, empties the 5-confirmation window, and the next capture is guessed again.

**Given** `Edit` on `Swiggy Instamart`
**When** Priya changes the display name to `Instamart` and the category to Groceries
**Then** `RenameMerchant` and `SetLearnedMapping` (actor `user`) commit in one transaction; original source text stays unchanged on every entry (FIN-025), and existing entries keep their categories.

**Given** `Forget` on `Swiggy Instamart → Groceries`
**When** it commits
**Then** the toast reads `Forgotten · Undo`, and the next Instamart capture (Capture lab) has no category pre-filled (PRD §8.17 acceptance); Undo restores the mapping exactly.

**Given** a backup made after learning and restored on another phone (Story 8.8)
**When** SCR-28 opens
**Then** the same rows show (LRN-006).

**Given** India builds with SMS (Epic 13)
**When** SCR-28 renders
**Then** this story leaves an empty `Blocked senders` section slot that renders nothing; its rows and `Unblock` arrive in Epic 13.

**Covers:** LRN-005 (SCR-28 edit/forget), LRN-003 (Clear mixed), LRN-006 (visible, in backups), FIN-025 (editable name, originals kept), UX-DR62, UX-DR114, J-LEARN

### Story 11.14: Spike S6 — Home-screen widget library

As Priya,
I want the home-screen widget to be fast, follow my phone's theme and never leak data,
So that one tap from my home screen is always safe.

**Acceptance Criteria:**

**Given** two prototypes, `react-native-android-widget` and Jetpack Glance, each rendering a 4×1 and 4×2 widget from a snapshot file only
**When** they are evaluated on both reference devices with a release build
**Then** `docs/spikes/S6-widget-library.md` records for each: update latency from snapshot write to visible change, APK size added, follows system theme live, 48 dp buttons at 200% font scale, TalkBack labels, launches intents into the LockGate queue, no database access possible from the widget process, no added permission (allowlist check) and maintenance status of the library.

**Given** the comparison
**When** the story closes
**Then** the chosen library and the `WidgetSnapshot` port shape (`toCheckCount`, `mayShowAmounts`, `headlineKind`, `headlineText?`, `writtenAt`) are recorded in AD-12, and no production widget is merged.

**Covers:** S6, AD-12 (widget library decision, snapshot-only)

### Story 11.15: Home-screen widget — Snap, Add and "N to check"

As Priya,
I want a widget on my home screen to snap a receipt or add an expense in one tap, and to tell me when something is waiting,
So that recording a payment is quicker than unlocking wmbugo and finding the button.

**Acceptance Criteria:**

**Given** the outbox
**When** any event whose catalogue areas include `widget` commits (`TransactionsChanged`, `CapturesSubmitted`, `CapturesAutoApproved`, `CapturesRejected`, `ProfileChanged`, `BackupRestored`)
**Then** a handler writes the snapshot through the `WidgetSnapshot` port: `toCheckCount` from the core `toCheck` query (the same `needs_review` set as the review queue and Home), `mayShowAmounts` from `widgetMayShowAmounts(settings)` (Story 8.5) and the widget setting below, and a pre-formatted headline only when amounts may show; the widget never opens the database or computes anything (architecture test).

**Given** the default settings (amounts off)
**When** the 4×1 widget renders on a solid `bg-surface` (system theme, `rounded.lg`)
**Then** the left headline reads `wmbugo` with the caption `3 to check` when 3 are waiting, and the right holds 48 dp accent icon buttons labelled `Snap receipt` and `Add entry`; at 0 waiting no to-check text is shown and there is never a numeric badge on the widget or launcher icon.

**Given** Settings › Privacy › `Show amounts on the widget` (off by default; disabled with the caption `Turn off app lock to show amounts on the widget.` while app lock is on)
**When** it is on and app lock and hide amounts are off
**Then** the headline follows the hero: `₹11,860 left`, `Over budget ₹2,340` (warning icon, no minus sign) or `Spent this period ₹8,140`; at large text the wording ellipsises, never the amount
**And** turning on app lock or hide amounts removes the amount from the snapshot at once.

**Given** `Snap receipt`, `Add entry` or the to-check text is tapped
**When** the intent arrives
**Then** it passes the LockGate queue; `Snap receipt` calls `startReceiptScan({ origin: 'widget' })` (Story 10.9), `Add entry` opens the Add sheet on Expense, and the to-check text opens the review queue (SCR-10).

**Given** the widget resized to 4×2
**When** it renders at 200% font scale
**Then** headline and `N to check` are on row 1, `Snap receipt` and `Add entry` form a full-width row 2, and nothing is dropped (screenshot test).

**Given** a restore (Story 8.8), a wipe (Story 8.11) or safe mode (Story 8.12)
**When** it completes or starts
**Then** the snapshot is rebuilt, cleared to the default with no count, or left with no count and buttons that open the app's safe-mode screen, respectively.

**Given** states default / amounts enabled / app lock on / N = 0 / outside India
**When** screenshot tests run
**Then** each renders as specified, and outside India `N to check` counts review items such as import duplicates (PRD §13.2).

**Covers:** HOM-007, UX-DR55, UX-DR56, SET-005 (widget amounts), FIN-024 (widget count = needs_review set), AD-12 (snapshot via outbox), DEC-25, FLOW-08 (widget Snap)


## Epic 12: UPI screenshot share (India)

Priya, in India, pays in GPay, PhonePe or Paytm, shares the success screen to wmbugo and gets the payment recorded with one tap on a category, in a capture sheet already filled with the amount, payee, time, UPI reference and the account it was paid from. The same screenshot shared twice, or a bank SMS or CSV row with the same UPI reference, never makes a second entry. A payment that didn't go through is refused, an image that isn't a UPI screen is read as a receipt, and a share received while wmbugo is locked waits, encrypted, until she unlocks. Screenshots are read on the phone and deleted unless she chooses to keep one with the entry, and a UPI capture is only ever confirmed by her own Save — never auto-approved.

The epic builds on the Epic 3 `SubmitCapture` pipeline and FIN-027 matcher (Stories 3.1, 3.2, 3.12), the LockGate pending-intent queue (Story 8.3), the `OcrEngine` adapter and the single receipt-scan entry `startReceiptScan` (Stories 10.6, 10.9), and the Epic 11 capture sheet with its credit, transfer and account-discovery variants and `isAutoApprovable` (Stories 11.4–11.10). UPI-share code lives in `apps/mobile/src/features/upi-share` and the `core.capture` UPI parsers; it never imports SMS code. Per PRD §13.2 and §13.0a it ships in both the `nosms` and `sms` builds and is shown only when `captureCapabilities(build, region)` allows UPI share (profile region `IN`); everywhere else it is absent, never disabled or "coming soon".

### Story 12.1: Read GPay, PhonePe and Paytm payment screens in core

As Priya,
I want wmbugo to read the amount, payee, time and UPI reference from my payment screenshot exactly,
So that a shared screen becomes the right entry without my typing anything.

**Acceptance Criteria:**

**Given** the pure `core.capture` function `parseUpiScreen(blocks, ctx)` (no RN imports), taking the positioned text blocks the `OcrEngine` port returns (Story 10.1) and a context with the profile timezone and the share time
**When** it runs
**Then** it returns a typed union: `upi_payment(fields)`, `upi_not_completed(app, status)`, `upi_unreadable(app, missing)` or `not_upi`
**And** the same blocks always give the same result (property test).

**Given** one fixed-layout parser per app (`gpay`, `phonepe`, `paytm`), each a table of anchor phrases and relative positions kept in core with its fixtures
**When** the blocks contain an app's layout anchors (e.g. the app's reference label such as `UPI transaction ID`, `Transaction ID` / `UTR`, `UPI Ref No`, plus its status line)
**Then** that app's parser is used; when no app's anchors match the result is `not_upi`, and a screen whose anchors match two apps is resolved by the higher anchor score with ties returning `not_upi` (fixture).

**Given** a matched layout
**When** fields are extracted
**Then** `fields` holds amount in minor units (INR, en-IN digits with lakh grouping read correctly: `₹1,18,600` → 11860000), direction (`Paid to` / `Sent to` → debit, `Received from` → credit), payee or payer name, UPI ID when shown (lowercased and trimmed), bank name and masked account when shown (`HDFC Bank ••4821`, `XXXXXX4821` → mask `4821`), timestamp in the profile timezone, the UPI reference (digits only) and the app
**And** each field carries `read` or `not_read`; fields not shown on the screen stay `not_read` and are never guessed (UPI-002 "unknown fields remain unconfirmed").

**Given** the bank name on a screen
**When** it is normalized
**Then** the core bank-key table maps it to the same short key the SMS sender table uses (`HDFC Bank` → `HDFC`, `State Bank of India` → `SBI`, `ICICI Bank` → `ICICI`), and an unlisted bank keeps its normalized name.

**Given** a status line reading `Pending`, `Processing`, `Payment failed`, `Failed` or `Declined`
**When** the screen is parsed
**Then** the result is `upi_not_completed` whatever else was read, and only a success status (`Paid`, `Payment successful`, `Sent`, `Received`, `Money sent`, per app table) can produce `upi_payment`.

**Given** a matched layout where the amount or direction cannot be read
**When** it is parsed
**Then** the result is `upi_unreadable(app, missing)`; a missing payee, UPI ID, bank, mask, time or reference alone never makes it unreadable (the time falls back to the share time, marked `not_read`).

**Given** the synthetic screenshot fixture set in the repo (rendered layouts for each app: paid and received, success, pending, failed and declined, light and dark theme, font scale 1.0 and 1.3, with and without bank/mask, plus restaurant receipts and non-payment screenshots as negatives; no real screenshots ever enter the repo, PRD §16.3)
**When** core tests run in CI on the fixtures' recorded OCR blocks
**Then** amount and UPI reference are correct on ≥ 98% of success fixtures per app layout (NFR-17), every pending/failed/declined fixture is `upi_not_completed`, and every negative fixture is `not_upi` (0 false UPI matches); the per-app scores are written to the CI artefacts.

**Covers:** UPI-001 (fixed per-app parsers for GPay/PhonePe/Paytm, pending/failed/declined rejected), UPI-002, NFR-17 (UPI accuracy), AD-14 (parsing in core on OcrEngine blocks)

### Story 12.2: UPI captures through the shared pipeline — one entry per UPI reference

As Priya,
I want a payment I've already recorded to be recognised when the same UPI reference comes in again,
So that sharing a screenshot twice, or getting the bank SMS or CSV row for it too, never counts it twice.

**Acceptance Criteria:**

**Given** a `upi_payment` result from Story 12.1
**When** `SubmitUpiShare(result)` maps it to a `SubmitCapture` input
**Then** it submits with `source_kind = upi_screenshot`, event type `upi_payment`, `external_reference` = the UPI reference, `parse_complete` = true only when every field was `read`, and a `redacted_preview` built by the Story 8.1 scrubber (UPI IDs, digit runs and masks scrubbed)
**And** the source fingerprint is (UPI reference, direction, event type) when a reference was read, else (direction, amount, `local_date`, normalized payee) — the same rule tombstones use (Story 3.12).

**Given** a new UPI payment with no match
**When** it commits
**Then** it is created as a `needs_review` transaction (`Waiting for you`), excluded from every total, with the learning suggestion from Story 11.2 (payee name, else UPI ID key) and `CapturesSubmitted`; no `upi_screenshot` capture is ever created `confirmed` by the pipeline.

**Given** a screenshot already submitted (same fingerprint)
**When** it is submitted again
**Then** the result is `ALREADY_SUBMITTED` with the existing transaction id and nothing is written (PRD §8.18 acceptance "same screenshot twice").

**Given** an existing bank SMS capture or imported CSV row with the same UPI reference and direction, confirmed or waiting
**When** a UPI share of that payment is submitted
**Then** the matcher returns `duplicate_of(id)` and the share adds a `source_record` (`UPI screenshot`) to that transaction instead of creating one, with result `ALREADY_RECORDED(id)`; the transaction's status, amount and account are unchanged (bank/card source authority, Story 3.3)
**And** the reverse order holds: a CSV row whose reference and direction equal an earlier UPI capture is `already_recorded` (Story 9.3).

**Given** the matched transaction was rejected or deleted and still within its keeping period
**When** the same payment is shared
**Then** the result is `PREVIOUSLY_REJECTED(id)` or `PREVIOUSLY_DELETED(id)` and nothing is written; after purge the tombstone gives `SKIPPED_PREVIOUSLY_REJECTED` / `SKIPPED_PREVIOUSLY_DELETED` (Story 3.12).

**Given** a same-reference item in the opposite direction (e.g. a ₹450 `Received from Ravi Tea Stall` screen with the reference of an earlier ₹450 payment)
**When** it is submitted
**Then** it is never a duplicate: per FIN-027 it becomes `needs_review` with a `review_candidate` of reason `reversal` (same account, or wording refund/reversed/failed), `transfer_pair` (a different owned account) or `held_pair` (account unknown), carrying the linked transaction id.

**Given** a UPI payment without a reference
**When** it is matched
**Then** the Story 3.1 fuzzy rule applies (equal amount, ±1 day, equal normalized payee → `possible_duplicate_of`), and two ₹20 payments to the same UPI ID with different references both return `no_match` (fixture).

**Given** the screen's bank key and mask
**When** the account is resolved
**Then** an `account_identifier(bank key, mask)` (table from Story 11.9) already linked — by an SMS sender or an earlier capture — resolves the account (`HDFC` + `4821` from a screen and from HDFC SMS give the same account); an unknown mask leaves the account unresolved for the Story 11.9 discovery; no bank or mask leaves it unresolved with no discovery prompt.

**Given** `isAutoApprovable` (Story 11.10)
**When** it runs on any `upi_screenshot` capture, including one with a learned category, resolved account and full parse
**Then** it returns false, and a `WriteAutoApprovals` fixture with a waiting ₹3,500 `Paid to Ravi Kumar` share leaves it `Waiting for you` and uncounted after 21:00 (PRD §8.18 acceptance; regression test).

**Given** the debug Capture lab (Story 11.4)
**When** it lists fixtures
**Then** it adds `UPI · paid`, `UPI · received`, `UPI · same reference twice` and `UPI · matches SMS`, submitted through `SubmitUpiShare` and opened via `wmbugo://capture?ids=<id>`.

**Covers:** UPI-005, UPI-008 (never auto-approved), UPI-002 (unconfirmed fields kept as such), FIN-027 (UPI fingerprints, opposite direction), CAP-007 (`upi_screenshot` never eligible), DEC-29, AD-6

### Story 12.3: Share a payment screenshot to wmbugo

As Priya,
I want wmbugo in my phone's share sheet when I share a payment screen,
So that recording a UPI payment is share, tap, done.

**Acceptance Criteria:**

**Given** `captureCapabilities(build, region)` (Story 11.11)
**When** it is evaluated
**Then** it gains `upiShare`, true in both `nosms` and `sms` builds (release and debug) only when the profile region is `IN`
**And** the Android manifest declares `UpiShareActivity` through an activity-alias with an `ACTION_SEND` `image/*` intent-filter, disabled by default and enabled or disabled with `setComponentEnabledSetting` whenever `upiShare` changes (onboarding region, restore, region change), so wmbugo is absent from the share sheet outside India (test for IN and GB profiles).

**Given** the `nosms` release build
**When** CI builds it
**Then** the `upi-share` feature and the UPI parsers are present and the permission allowlist is unchanged (no new permission: the shared image arrives as a content URI with a read grant; permission-spy test), and the `upi-share` module has no import from `sms` (lint rule).

**Given** Priya shares one image from GPay, PhonePe, Paytm or the gallery
**When** wmbugo receives it
**Then** the image is taken in exactly as in Story 10.6 (EXIF orientation applied, ≤ 2,048 px long edge, JPEG 85, all EXIF removed, original never copied), written encrypted through `FileStore` before a `pending_share` row (created by this story's migration, owner capture: id, file id, received_at, origin `share`) commits; only then is the content URI released
**And** a share of several images at once is not offered (single-image filter only).

**Given** the stored share and an unlocked app
**When** it is processed
**Then** `CaptureDialogActivity` opens over the sharing app with the capture sheet header skeleton and the caption `Reading payment screen…` with `Cancel`, the image is read by the `OcrEngine` adapter on a native thread and parsed (Story 12.1), and the `pending_share` row is deleted in the same writer transaction as the result's commit (or on its own when nothing is written); p95 from share tap to filled sheet ≤ 3 s on the reference devices (recorded in story notes).

**Given** a `upi_payment` result
**When** `SubmitUpiShare` returns a new or existing waiting capture
**Then** the sheet shows that capture (Story 11.4 layout, filled by Story 12.4 rules once they land).

**Given** `ALREADY_SUBMITTED` or `ALREADY_RECORDED(id)` on a confirmed entry
**When** the sheet renders
**Then** it reads `This payment is already recorded. Nothing was added.` with `Open it` (entry detail after LockGate) and `Close`; for a still-waiting entry it shows that waiting capture instead, so no second one exists (duplicate-share test).

**Given** `PREVIOUSLY_REJECTED(id)` or `SKIPPED_PREVIOUSLY_REJECTED`
**When** the sheet renders
**Then** it reads `You rejected this payment before. Nothing was added.` with `Show it` (opens the rejected entry where `Restore` exists, Story 3.13) when the entry still exists, and `Close`.

**Given** `upi_not_completed`
**When** the sheet renders
**Then** the inline error pattern reads `This payment didn't go through — nothing added` with `Close`; nothing is written and the image is deleted.

**Given** `upi_unreadable`, or reading takes longer than 10 s
**When** the sheet renders
**Then** it reads `Couldn't read this payment screen. Nothing was saved.` with `Enter it by hand` and `Close`; `Enter it by hand` opens the Add sheet on Expense (Income for a screen read as received), saving through `SubmitCapture` with `source_kind = manual`; the screenshot is not attached and is deleted when the sheet opens.

**Given** `not_upi` (e.g. a photo of a restaurant receipt)
**When** routing runs
**Then** `startReceiptScan({ origin: 'share', imageUri })` (Story 10.9) takes the already-stored image straight to receipt reading and review, with no second intake, and the receipt flow owns the photo from then on (PRD §8.18 acceptance).

**Given** `Cancel` or Back while reading
**When** Priya taps it
**Then** reading stops, nothing is written, and the `pending_share` row and its file are deleted.

**Given** an app kill after the `pending_share` commit and before processing
**When** wmbugo next opens
**Then** the share is processed then, exactly once; the orphan sweep (Story 3.11) deletes any file without a row.

**Covers:** UPI-001 (share-sheet presence, refused pending/failed screens), UPI-004, UPI-007 (no upload, deleted after reading), UX-DR80 (duplicate share adds nothing, unreadable → Enter it by hand), CAP-002 (opened from a share), OCR-009 (shared non-UPI images), AD-12 (`pending_share`), AD-9, AD-17 (UPI-share module, allowlist), FLOW-13

### Story 12.4: The UPI capture sheet — pre-filled, Paid from, one tap to Save

As Priya,
I want the shared payment to open already filled in, with the account it came from picked,
So that one tap on a category saves it, and a payment I leave for later is still there.

**Acceptance Criteria:**

**Given** a waiting debit from PhonePe `Paid ₹450 to Ravi Tea Stall`, UPI ref `431298765012`, 7 Nov 9:12 pm, `HDFC Bank ••4821` linked to `HDFC debit`
**When** the sheet renders
**Then** the header shows `₹450`, `Ravi Tea Stall`, `HDFC debit ••4821 · 9:12 pm`, a caption `UPI ref 431298765012 · PhonePe` below it, and `Later` top-right; the body shows a `Paid from` chip reading `HDFC debit ••4821`, the category grid ordered by this payee's history (Story 11.4), the Remember row, and the footer `Reject` | `Save` (no auto-approve line, since UPI captures never add themselves) (PRD §8.18 acceptance).

**Given** the `Paid from` chip
**When** Priya taps it
**Then** a picker lists her active asset accounts and cards plus `+ New account`, which opens the Story 1.12 account form inline and returns with the new account selected; choosing an account links `(bank key, mask)` to it when the screen showed both, so later shares resolve without asking.

**Given** a screen with a bank and mask not yet known (`ICICI ••7730`)
**When** the sheet renders
**Then** the Story 11.9 section `New account ••7730 (ICICI)` with `Add it` and `It's one of mine` shows, the account is created with `balance not set` (a UPI screen never gives a balance), and `Save` stays disabled with the hint `Add or link this account first`.

**Given** a screen with no bank or mask
**When** the sheet renders
**Then** the chip reads `Paid from · Choose`, pre-selects the account learned for this payee (Story 11.3) when there is one, otherwise nothing, and `Save` is disabled with the hint `Choose where it was paid from` until one is chosen.

**Given** a resolved account and the guessed category
**When** Priya taps a category cell (or `Save` with the guess selected)
**Then** `ApproveCapture` commits it `confirmed` / `user_approved` with `CategoryAssigned` (actor `user`), the sheet closes and TalkBack announces `Saved Ravi Tea Stall, 450 rupees, Food & Drinks`; learning keys on the payee name, else the UPI ID (LRN-002).

**Given** a payee shown only as a UPI ID
**When** the sheet renders
**Then** `Who was this paid to?` (placeholder the UPI ID) names the payee once (Story 11.4).

**Given** a received-money screen (`Received ₹600 from Arun`)
**When** the sheet renders
**Then** the credit variant (Story 11.7) shows `+₹600`, `What is this?` chips and `Who sent this?` for a UPI ID only payer, `Save` disabled until a type is chosen, and `Paid from` is labelled `Received in`.

**Given** a waiting share with an open `reversal`, `transfer_pair` or `held_pair` candidate (Story 12.2)
**When** the sheet renders
**Then** a reversal shows `Refund` pre-selected with the line `Back from ₹450 · Ravi Tea Stall, 7 Nov` and saves a linked refund (Story 3.8); a transfer pair shows `Moved from my own account` with the other account pre-selected and saves through `LinkTransferLegs` (Story 11.8); a held pair asks `Reversal, or a transfer between your accounts?` with those two chips.

**Given** the row `Keep screenshot with this entry` (switch, off by default)
**When** Priya saves with it on
**Then** the screenshot becomes the entry's `attachment` in the same commit (Story 3.11, deduplicated by digest); with it off, or when the sheet closes any other way, the encrypted image is deleted after the commit and never uploaded (UPI-007).

**Given** `Later`, swipe down or Back
**When** the sheet closes without Save
**Then** nothing more is written, the capture stays `Waiting for you` in `N to check`, the review queue and the widget count, is not counted in any total, and is never auto-approved; it can be saved or rejected from the review queue later (no screenshot is offered there).

**Given** `Reject`
**When** Priya taps it
**Then** `RejectCapture` sets it `excluded` / `rejected` (Story 11.4); sharing the same screenshot again then shows `You rejected this payment before. Nothing was added.` (Story 12.3).

**Given** a `upi_screenshot` capture
**When** `CapturesSubmitted` is handled
**Then** no capture notification is posted for it (Priya is already in the sheet), and the Story 11.6 handler test proves `upi_screenshot` is skipped.

**Given** the sheet in dark mode and at fontScale 1.3
**When** screenshot tests run
**Then** band text contrast is ≥ 5.61:1, the sheet is full height, and the UPI ref caption wraps without truncating the reference.

**Covers:** UPI-003, UPI-007 (kept only when attached), UPI-008 (only Save confirms; dismissed → waiting), UPI-005 (opposite direction classified in the sheet), UX-DR80 (pre-filled sheet, `Paid from` with `+ New account`, dismissed → `Waiting for you`), UX-DR32 (`Paid from` chip), UX-DR39 (UPI variant), CAP-004, CAP-009, CAP-012, LRN-002, FLOW-13, FLOW-15 (UPI discovery)

### Story 12.5: A share while wmbugo is locked waits for unlock and is never lost

As Priya,
I want a screenshot I share while wmbugo is locked to be there after I unlock,
So that app lock never costs me a payment I meant to record.

**Acceptance Criteria:**

**Given** app lock is on and wmbugo is locked
**When** Priya shares a payment screenshot
**Then** the image is stored encrypted and the `pending_share` row commits before anything is shown (Story 12.3 intake), no OCR runs and nothing of the image or its contents is displayed, and LockGate (`wmbugo is locked`, `Unlock`) opens over the sharing app with the prompt started automatically (Story 8.3).

**Given** the unlock succeeds
**When** the pending share is delivered
**Then** it is processed exactly as in Story 12.3 and the capture sheet opens with that screenshot's payment (PRD §8.18 acceptance: never dropped).

**Given** Priya dismisses the prompt or the unlock fails
**When** LockGate closes
**Then** the `pending_share` row and file are kept (unlike other queued intents, which Story 8.3 drops), and the next successful unlock of wmbugo, from any entry point, delivers it.

**Given** three shares received while locked
**When** wmbugo is unlocked
**Then** they are processed oldest first; payment screens open together as swipe cards (Story 11.5), and duplicate, not-completed or unreadable results appear as one line each in a summary card such as `1 already recorded · 1 didn't go through` before the cards; a non-UPI image opens receipt reading after the cards are closed.

**Given** the process is killed or the phone reboots with a pending share
**When** wmbugo is next opened and unlocked
**Then** the share is delivered once (idempotent on the `pending_share` id), and the encrypted file is readable only with the database key, which is available after the first unlock since boot (AD-9).

**Given** a backup made while a share is pending
**When** it is created
**Then** `pending_share` rows and files are not included, and a restore or erase all data (Stories 8.8, 8.11) deletes any pending shares.

**Given** app lock is off
**When** a share arrives
**Then** it opens directly with no LockGate, and Story 12.3 behaviour is unchanged.

**Given** the queued-share tests
**When** they run
**Then** they cover locked share → unlock → sheet; abandoned unlock → later unlock → sheet; kill between store and unlock; and three queued shares (UX-DR75 queued-share test).

**Covers:** UPI-006, UX-DR75 (share intents pass LockGate, queued share never lost), UX-DR80 (locked-share queue test), AD-12, AD-9, FLOW-12, FLOW-13

### Story 12.6: Share from UPI app in the Add sheet and the FLOW-13 end-to-end check

As Priya,
I want a way to record a UPI payment from inside wmbugo too, and the whole share flow proven on a real build,
So that I can capture a payment I paid earlier, and I can trust it works offline.

**Acceptance Criteria:**

**Given** the Add sheet on Expense with `captureCapabilities(build, region).upiShare` true
**When** it renders
**Then** a `Share from UPI app` chip sits after `Snap receipt` in the chip row (UX-DR32); with `upiShare` false (any non-IN region) the chip is absent, never disabled or "coming soon" (test for IN and GB profiles).

**Given** Priya taps `Share from UPI app`
**When** the small sheet opens
**Then** it reads `In GPay, PhonePe or Paytm, open the payment and tap Share, then choose wmbugo.` with `Pick a screenshot` (button-primary) and `Close`, and the Add sheet draft is kept.

**Given** `Pick a screenshot`
**When** Priya chooses an image in the Android Photo Picker (no storage permission; permission-spy test)
**Then** it goes through the same intake and routing as a share (Story 12.3) with `pending_share.origin = add_sheet`, and the resulting capture sheet, duplicate message, error or receipt fallback is shown in-app; on Save the Add sheet closes, on any other outcome she returns to the Add sheet with her draft.

**Given** the release `nosms` build on a fresh install with region `IN`, airplane mode on, and the synthetic screenshots on the device
**When** the Maestro suite runs FLOW-13
**Then** it passes: share PhonePe `Paid ₹450 to Ravi Tea Stall` → sheet shows ₹450, payee, time and UPI ref → tap Food & Drinks → entry recorded; share it again → `This payment is already recorded. Nothing was added.`; share a failed screen → `This payment didn't go through — nothing added`; share a restaurant receipt → receipt reading opens; share with app lock on → unlock → sheet; share `Paid ₹3,500 to Ravi Kumar` and press `Later` → after a 21:00 clock-guarded auto-approve run it is still `Waiting for you` and uncounted
**And** no network request is made and no image remains in app storage after the flows that didn't keep one (file-count check).

**Given** the same suite on a region `GB` profile
**When** it checks the share sheet and the Add sheet
**Then** wmbugo is not offered for images and neither chip nor text about UPI appears.

**Covers:** TXN-001 (India `Share from UPI app`), UX-DR32 (Share from UPI chip only where available), UX-DR96 / UX-DR98 (absent, never "coming soon"), UPI-001, UPI-003, UPI-004, UPI-005, UPI-006, UPI-007, UPI-008 (PRD §8.18 acceptance end to end), FLOW-13, AD-18 (airplane-mode E2E)


## Epic 13: Bank SMS capture (India, Play-gated)

Priya, in India, turns on bank SMS capture once, after an explainer that says exactly what wmbugo reads, keeps and never touches, and from then on every debit or credit SMS from her bank becomes a capture notification within seconds — already categorised when wmbugo has learned the merchant — that she approves in one tap or leaves to add itself after the evening cutoff. SMS is read and parsed on the phone and the message body is never stored. Messages from ordinary phone numbers are never transactions, scam-looking messages are flagged and never added, a bank sender wmbugo doesn't know asks `New sender KCOOPB?` before anything counts, a balance that doesn't add up twice in a row is held back for her to check, and a promotional sender can be blocked and later unblocked. SMS that arrive while the phone is rebooting, locked since boot or while wmbugo is killed are picked up exactly once by the catch-up. If she says no, revokes the permission, or Play never approves the feature, the app keeps working exactly as before with manual entry, UPI share and receipts, and the no-SMS build contains no SMS code, permission or text at all.

The epic builds on the `nosms` / `sms` flavors and the permission allowlist (Story 1.1), the FIN-027 matcher, `SubmitCapture` with `source_kind = sms`, tombstones and the Scheduler port (Stories 3.1, 3.2, 3.12), the review queue and Show rejected / Restore (Stories 3.10, 3.13), app lock and LockGate (Story 8.3), the Story 8.1 redacting scrubber, backup/restore across package IDs (Stories 8.7, 8.8), Diagnostics with its reserved `Background capture` slot and `Check a parser` section (Story 8.10), the Epic 11 capture sheet and its variants, notifications, `isAutoApprovable`, `WriteAutoApprovals`, Settings › Capture and the empty `Blocked senders` slot in Learned merchants (Stories 11.2–11.13), and the core bank-key table shared with UPI (Story 12.1). SMS code lives in `apps/mobile/src/features/sms`, the Kotlin receiver in the `sms` flavor source set, and the SMS parsers in the `@wmbugo/core/sms` entry point; per AD-17 only SMS code is excluded from the `nosms` build — UPI share ships in both. Every SMS UI surface is shown only when `captureCapabilities(build, region).sms` is true (`sms` build and profile region `IN`); everywhere else it is absent, never disabled or "coming soon" (SMS-015).

### Story 13.1: Spike S7 — Keep SMS code, strings and permissions out of the no-SMS build

As Priya,
I want the version of wmbugo sold without Play's SMS approval to contain nothing about SMS at all,
So that the app never promises a feature it can't have and Play's reviewer sees no SMS permission or text in that build.

**Acceptance Criteria:**

**Given** a throwaway branch with a stub `apps/mobile/src/features/sms` module (one screen with the string `Let wmbugo read bank SMS?`), a stub `@wmbugo/core/sms` entry point (one exported parser function), and a stub Kotlin `SmsReceiver` in `android/app/src/sms/`
**When** the spike compares two exclusion mechanisms for the JS bundle — (a) a Metro `resolver.resolveRequest` keyed on `WMBUGO_FLAVOR` that resolves `features/sms` and `@wmbugo/core/sms` to empty stubs (`index.nosms.ts`) in `nosms`, and (b) a Babel compile-time constant `__SMS__` with dead-code elimination
**Then** it records in `docs/spikes/S7-nosms-exclusion.md` for each: whether the stub screen string, the parser function name and every import below them are absent from the `nosms` release Hermes bundle (checked by `hbcdump` string table and a plain byte search of `index.android.bundle`), build-time cost, and how a developer could accidentally re-include SMS code
**And** the decision names one mechanism (default (a), because it removes whole modules without relying on minifier behaviour) and is copied into the AD-17 section of the architecture spine.

**Given** the chosen mechanism merged to the main branch with the real (still empty) `features/sms` and `@wmbugo/core/sms` locations
**When** lint runs
**Then** an import of `features/sms` or `@wmbugo/core/sms` from anywhere except `apps/mobile/src/features/sms/**`, the `sms` flavor's feature registration file (`apps/mobile/src/flavor/sms.ts`) and `packages/core/src/capture/sms/**` fails with a boundary-rule error, and `features/upi-share` importing either fails the same way.

**Given** the `sms` flavor's manifest overlay in `android/app/src/sms/AndroidManifest.xml`
**When** the CI permission-allowlist check reads both merged release manifests
**Then** the `sms` release may declare exactly `android.permission.RECEIVE_SMS` and `android.permission.READ_SMS` in addition to the shared allowlist, and the `nosms` release fails the check if it declares either, any `SEND_SMS` / `RECEIVE_MMS` / `RECEIVE_WAP_PUSH`, any receiver for `android.provider.Telephony.SMS_RECEIVED`, or any component whose class name contains `Sms`
**And** both releases fail if they declare `BIND_NOTIFICATION_LISTENER_SERVICE`, `BIND_ACCESSIBILITY_SERVICE`, `SYSTEM_ALERT_WINDOW` or `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and a lint rule fails on any use of `ClipboardManager` listeners or `Clipboard.getString` in shipped code (no scraping substitutes, SMS-008).

**Given** the `nosms` release APK
**When** the new CI step `check-nosms-markers` runs on every push
**Then** it fails if the dex, native libraries, resources or JS bundle contain any marker from `ci/sms-markers.txt` (`READ_SMS`, `RECEIVE_SMS`, `Telephony.Sms`, `SMS_RECEIVED`, `SmsReceiver`, `SmsInbox`, `smsCatchUp`, `@wmbugo/core/sms`, every key of the `sms` string partition, and the user-visible word `SMS` in any string resource or JS string literal)
**And** schema identifiers in `packages/core/src/**/migrations/**` (`sms_cursor`, `sender`, `balance_chain`) are the only allowed exception, because both flavors share one schema so a backup restores across `app.wmbugo` and `app.wmbugo.sms` (Story 8.8); a test proves a release-mode `nosms` bundle has no user-visible string containing `SMS`.

**Given** the central string catalogue (UX-DR100)
**When** this story lands
**Then** a separate partition `apps/mobile/src/features/sms/strings.ts` holds every SMS-specific string and is merged into the catalogue only by the `sms` flavor registration; the existing source label `Bank SMS` (Story 3.10) moves into it, and the `nosms` build shows `Bank message` for a restored entry whose source is `sms` (restore-across-packages fixture), while `Looks like a scam — not added` stays in the shared catalogue (it names no SMS)
**And** the catalogue snapshot test runs per flavor.

**Given** `captureCapabilities(build, region)` (Story 11.11)
**When** it is evaluated
**Then** it gains `sms`, true only in an `sms` build with profile region `IN`; in a `nosms` build the property is the constant `false` and the code path that could make it true is not in the bundle (marker check).

**Covers:** S7, AD-17 (SMS-only exclusion, UPI unaffected, permission allowlist per flavor), SMS-001 (no SMS permission or receiver outside `sms`), SMS-015 (no SMS code, strings or text in `nosms`), SMS-008 (no accessibility, notification-listener, clipboard or overlay substitutes), NFR-02, SEC-002

### Story 13.2: Read bank and card SMS in core

As Priya,
I want wmbugo to read the amount, direction, account, merchant and reference out of my bank's messages exactly, and leave alone anything that isn't a transaction,
So that a bank SMS becomes the right capture and my OTPs and personal messages are never touched.

**Acceptance Criteria:**

**Given** the pure function `parseBankSms(body, ctx)` in `@wmbugo/core/sms` (no RN imports), with a context holding the profile timezone and the message's received time
**When** it runs
**Then** it returns a typed union: `sms_txn(fields)`, `sms_otp`, `sms_not_transaction` or `sms_unreadable(missing)`, and the same input always gives the same result (property test).

**Given** a message containing a one-time-password marker (`OTP`, `one time password`, `verification code`, `is your code`, case-insensitive, per the core table)
**When** it is parsed
**Then** the result is `sms_otp` whatever else it contains, and no field, preview or hash of it is returned (SMS-010: OTPs are never retained).

**Given** a message is transaction-like (a direction word from the core table — `debited`, `spent`, `withdrawn`, `paid`, `sent`, `credited`, `received`, `deposited`, `refund`, `reversed` — and an amount with `Rs`, `Rs.`, `INR`, `₹` or another ISO currency code, and at least one of: a masked account or card, a UPI/IMPS/NEFT reference, or an available balance)
**When** fields are extracted
**Then** `fields` holds: direction (`debit` / `credit`), event indicator (`purchase`, `transfer`, `refund`, `reversal`, `atm`, `card_payment`), amount in minor units (en-IN grouping read correctly: `Rs 1,18,600.50` → 11860050), currency (INR, or the foreign code as written: `USD 12.99 spent on HDFC Card` → USD), merchant or counterparty as written (`at SWIGGY`, `to Ravi Tea Stall`, `VPA ravi.tea@okaxis`), reference digits, masked account (`A/c XX4821`, `A/c *4821`, `Card ending 9911`, `••4821` → `4821`) with kind `account` or `card`, timestamp (date/time in the text, in the profile timezone, else the received time), available balance (`Avl Bal`, `Avl bal`, `Available balance`) and available limit (`Avl Lmt`, `Available limit`) as separate fields
**And** each field carries `read` or `not_read`; nothing missing is guessed (SMS-003 "unknown values remain unconfirmed"), and an available limit is never returned as a balance.

**Given** a transaction-like message where amount or direction cannot be read
**When** it is parsed
**Then** the result is `sms_unreadable(missing)`; a missing merchant, reference, mask or balance alone never makes it unreadable.

**Given** a promotional or informational message (`Pre-approved loan of Rs 5,00,000`, `Your statement is ready`, `Minimum due Rs 2,300 by 15 Nov`, a bank's KYC reminder)
**When** it is parsed
**Then** the result is `sms_not_transaction` (no mask/reference/balance, or a template on the core's informational list), so it is never captured.

**Given** an `sms_txn` result
**When** `redactSmsPreview(body, fields)` builds the preview kept on the source record
**Then** it is at most 120 characters, the amount is replaced by `₹•••`, every digit run of 4 or more and every masked account is replaced by `••••`, every URL by `[link]`, every UPI ID by `[upi]`, and it passes the Story 8.1 scrubber test; the body itself is never returned in any other field (SMS-004).

**Given** the synthetic SMS corpus in `packages/core/src/capture/sms/fixtures/` (written from the published message formats of at least 12 Indian banks and card issuers — HDFC, SBI, ICICI, Axis, Kotak, PNB, Bank of Baroda, Canara, Union Bank, IDFC First, Yes Bank, IndusInd — at least 40 messages each across debit, credit, UPI, IMPS/NEFT, card spend, ATM, card bill payment, refund, reversal, foreign currency, plus OTP, promotional and informational negatives; every name, number, reference and mask is invented, no real message ever enters the repo, and a CI check rejects fixtures containing a 10-digit mobile number pattern or a 12+ digit account number)
**When** core tests run in CI
**Then** precision is ≥ 98% and recall ≥ 95% on amount, direction and account mask over the corpus (NFR-17), every OTP fixture is `sms_otp`, every promotional/informational fixture is `sms_not_transaction`, and the per-bank scores are written to the CI artefacts; the test fails below either threshold.

**Covers:** SMS-003, SMS-004 (parsed fields and redacted preview only), SMS-009 (synthetic fixtures only), SMS-010 (OTPs never retained), NFR-17 (SMS precision/recall), AD-11 (parsing rules only in core, none in Kotlin)

### Story 13.3: Verified senders, unknown bank senders and scam warnings in core

As Priya,
I want wmbugo to trust only messages that really come from my bank, ask me about a bank it doesn't know, and refuse anything that looks like a scam,
So that a fake "you've won" text or a message from a random number can never add money to my records.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the capture module owns `sender(id, normalized_entity, raw_headers, status[allowed|user_confirmed|blocked|unknown], status_before_block?, bank_key?, updated_at)` unique on `normalized_entity`, and `source_record.sender_id` references it (the table exists in both flavors per Story 13.1).

**Given** `normalizeSenderHeader(address)` in `@wmbugo/core/sms`
**When** it runs on `VM-HDFCBK`, `AD-HDFCBK-S`, `JD-HDFCBK`, `BZ-HDFCBK-T` and `hdfcbk`
**Then** all return `{ kind: 'dlt', entity: 'HDFCBK' }` (uppercase; strip a two-letter operator/circle prefix and hyphen; strip a `-S`, `-T`, `-P` or `-G` suffix; the result must match `^[A-Z]{6}$`)
**And** `+919876543210`, `09876543210` and `9876543210` return `{ kind: 'phone' }`, and anything else (5-digit short codes, malformed headers) returns `{ kind: 'other' }` (table test).

**Given** the bundled allow-list `sms-senders.in.json` (normalized entity → bank key, e.g. `HDFCBK` → `HDFC`, `SBIINB` / `SBIPSG` / `ATMSBI` → `SBI`, `ICICIB` → `ICICI`, `AXISBK` → `AXIS`, `KOTAKB` → `KOTAK`; bank keys from the Story 12.1 table) shipped with the app
**When** the app starts after install or update
**Then** `SyncSenderAllowList` upserts each entry as `allowed` with its bank key, never changes a `blocked` or `user_confirmed` row, and records the list version in `settings`; removing an entry in a later list turns an `allowed` row (not a user-confirmed one) into `unknown`.

**Given** the pure `routeSms(senderShape, senderRow, parseResult)`
**When** it runs
**Then** it returns exactly one of `capture(verified)`, `new_sender_prompt(entity)`, `scam(reason)` or `ignore(reason)` by this table (table-driven test, one row per line):
- any sender with `sms_otp` or `sms_not_transaction` → `ignore` (non-financial messages are never ingested)
- a `blocked` sender → `ignore(blocked)`, whatever the text
- DLT sender `allowed` or `user_confirmed` with `sms_txn` or `sms_unreadable` → `capture(verified)`; never `scam`, even with links or `KYC` wording
- DLT sender `unknown` (or not in the table) with `sms_txn` and a link plus claim/KYC/prize wording (`claim`, `prize`, `won`, `lottery`, `reward`, `update KYC`, `KYC pending`, `account will be blocked`, per the core list) → `scam(link_and_claim)`
- DLT sender `unknown` with `sms_txn` and no such wording, debit or credit alike → `new_sender_prompt(entity)`
- `phone` sender with `sms_txn` or `sms_unreadable` → `scam(phone_sender)` (phone-number senders are never transactions)
- `other` sender → `ignore(other_sender)`.

**Given** the PRD §8.12 acceptance fixtures
**When** core tests run
**Then** a 10-digit-number debit text is `scam(phone_sender)`; a verified HDFC refund is `capture` and not a scam; a credit with a link and `claim your prize` from an unknown header is `scam(link_and_claim)`; a `VM-KCOOPB` salary credit with no link is `new_sender_prompt('KCOOPB')`; and `VM-HDFCBK`, `AD-HDFCBK-S`, `JD-HDFCBK` resolve to the same `sender` row.

**Given** a scam-filter corpus of genuine messages from the published templates of at least 10 Indian banks (the Story 13.2 corpus plus their KYC reminders and link-bearing service messages), sent from both their allow-listed headers and, for this test only, from unknown well-formed headers
**When** core tests run in CI
**Then** 0 genuine messages are `scam` (NFR-17 scam filter), and `docs/qa/sms-scam-corpus-review.md` records a reviewer other than the rule author who signed off the corpus before the rules were frozen for the release.

**Covers:** SMS-010 (verified senders, DLT normalization, allow-list stored as normalized entities, phone numbers never transactions), SMS-011 (scam rules only for non-verified senders), SMS-017 (unknown DLT debit or credit → prompt), SMS-013 (blocked senders skipped), SMS-004 (non-financial never ingested), SMS-009, NFR-17 (scam filter 0 false positives)

### Story 13.4: Balance chain per account — tolerate one surprise, flag two in a row

As Priya,
I want wmbugo to notice when the balance in my bank's messages stops adding up, without crying wolf over an EMI it didn't see,
So that a forged or misread message is held for me to check instead of adding itself.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the capture module owns `balance_chain(sender_id, mask, points, consecutive_mismatches, last_sms_at)` keyed on (sender, mask), where `points` keeps the last 10 (occurrence time, available balance in minor units, transaction id) entries in occurrence order.

**Given** the pure `checkBalanceChain(chain, capture, ledgerBetween)`
**When** a capture has an account mask and an available balance (never an available limit; card `Avl Lmt` captures never touch any chain)
**Then** it finds the previous point by occurrence time (not arrival time), computes the expected balance as that point's balance minus debits plus credits of every waiting or confirmed entry on the resolved account occurring after that point up to and including this capture, and returns `match`, `first_mismatch` or `flag`.

**Given** an HDFC ••4821 chain at ₹40,000 and an unannounced ₹1,500 EMI auto-debit (no SMS, no entry)
**When** the next message reads `Rs 500 debited … Avl bal Rs 38,000`
**Then** the result is `first_mismatch`: the capture is not flagged and stays eligible, the chain resets to ₹38,000 and `consecutive_mismatches = 1`
**And** when the following message also mismatches, the result is `flag`: that capture's `source_record.balance_flag = true` and it is not auto-approvable (Story 11.10 predicate), while a match in between resets the count to 0 (PRD §8.12 acceptance).

**Given** a flagged chain
**When** Priya approves a flagged capture, or 7 days pass with no SMS for that (sender, mask)
**Then** the chain resets to that capture's balance (or, after 7 days, to the next message's balance) with `consecutive_mismatches = 0`.

**Given** a message that arrives late with an occurrence time before the chain's latest point
**When** it is checked
**Then** it is compared with its own predecessor, is inserted in order, and does not move the latest point.

**Given** the same mask from two different senders (HDFC ••4821 and Axis ••4821)
**When** both send balances
**Then** they are two chains and never compared with each other.

**Given** the fast-check suite
**When** core tests run
**Then** a chain with every balance consistent never flags; any single injected mismatch never flags; two consecutive injected mismatches always flag; and arrival-order shuffles of the same messages give the same flags.

**Covers:** SMS-012, CAP-007 (balance flag blocks auto-approve), AD-18 (property tests)

### Story 13.5: SMS captures through the shared pipeline — one entry per payment

As Priya,
I want each bank message to become one waiting capture on the right account, matched against what I've already recorded,
So that a payment I typed, scanned, shared or imported is never counted twice because the bank also texted me.

**Acceptance Criteria:**

**Given** a received message `{ address, receivedAt, body }` from the `SmsInbox` port (declared in core by this story)
**When** the use case `SubmitSms(message)` runs
**Then** it normalizes the sender, parses (Story 13.2), routes (Story 13.3) and, for `capture` or `new_sender_prompt`, submits through `SubmitCapture` with `source_kind = sms`, `sender_id`, `external_reference` = the reference, `parse_complete` = true only when every field was `read`, the Story 13.2 redacted preview and `source_received_at`
**And** the body is used only in memory inside this call and is never written to the database, log, crash record or outbox (test asserts no column, log line or event payload contains a fixture body substring of 12+ characters).

**Given** the message identity
**When** the source fingerprint is built
**Then** it is a salted SHA-256 of (normalized sender, `receivedAt` ms, SHA-256 of the body) using the per-install salt from Story 3.12, so the same message submitted again (rerun, catch-up after a live run, backfill) returns `ALREADY_SUBMITTED` and writes nothing; the duplicate fingerprint stays the Story 3.12 rule.

**Given** a new SMS debit or credit with no match
**When** it commits
**Then** it is created `needs_review` (`Waiting for you`) with the Story 11.2 learning suggestion keyed on the merchant, else the UPI ID, and `CapturesSubmitted`; its account is resolved from `account_identifier(bank key of the sender, mask)` (table from Story 11.9) as in Story 12.2, an unknown mask is left for the Story 11.9 discovery with the parsed available balance passed for the opening balance (accounts only; available limit never), and a foreign-currency message follows the Story 3.10 foreign-amount path.

**Given** a `scam` route
**When** it is submitted
**Then** a `source_record` with no transaction (`transaction_id` null), `scam_flag = true`, the sender and the redacted preview is written, result `SCAM_FLAGGED` (catalogue: `Looks like a scam — not added`), `ScamFlagged` is emitted for the notification handler, nothing touches the ledger, and the record is purged after 90 days by `PurgeExpired`.

**Given** a `new_sender_prompt` route
**When** it commits
**Then** the sender row is created `unknown` with the raw header, the capture is `needs_review` with an open `review_candidate` of reason `new_sender`, and `isAutoApprovable` is false for it for its whole life even after the sender becomes `user_confirmed` (SMS-017); later captures from a user-confirmed sender are verified and follow the normal rules.

**Given** an `ignore` route
**When** it returns
**Then** `SubmitSms` writes nothing and returns the ignore reason to its caller.

**Given** an existing confirmed or waiting entry
**When** an SMS is matched (Story 3.1)
**Then** a same-reference, same-direction UPI share, CSV row or earlier SMS gives `duplicate_of(id)` and the SMS is added as a `source_record` to that transaction (`ALREADY_RECORDED(id)`), never a second entry; a matching manual entry or receipt without a reference gives `possible_duplicate_of` and the SMS waits with `Possible duplicate — check it` in the review queue (SMS-005); same-reference opposite-direction items follow FIN-027 (`reversal`, `transfer_pair`, `held_pair`)
**And** when the existing transaction was created by a UPI share, it stays never auto-approvable after the SMS source is attached (UPI-008 regression test).

**Given** `isAutoApprovable` (Story 11.10)
**When** it runs on SMS captures
**Then** it is true only for `allowed` or `user_confirmed` senders (never for the capture that raised the `new_sender` prompt), with no `scam_flag` or `balance_flag`, and every other Story 11.10 rule; a capture from a sender that became `blocked` after it arrived is not eligible (table test extended).

**Given** the Story 13.4 chain check
**When** an SMS capture with an available balance commits
**Then** the chain is updated in the same writer transaction, and a `flag` result sets `balance_flag` on its source record.

**Given** the debug Capture lab (Story 11.4)
**When** it lists fixtures
**Then** it gains `SMS · HDFC debit`, `SMS · unknown bank KCOOPB`, `SMS · scam from phone number`, `SMS · balance mismatch twice`, `SMS · card Avl Lmt ••9911` and `SMS · matches UPI share`, each a synthetic message run through `SubmitSms` via a debug `SmsInbox` fixture adapter, and Story 11.4's direct `source_kind = sms` fixtures switch to `SubmitSms`.

**Covers:** SMS-005, SMS-004 (body never persisted), SMS-003 (unconfirmed fields kept), SMS-010 (only verified senders captured), SMS-011 (scam never posted), SMS-012 (flag wiring), SMS-017 (never auto-approved), CAP-007 (SMS eligibility), CAP-009 (opening balance from available balance, limit never a balance), FIN-027, AD-6, AD-11 (SmsInbox port)

### Story 13.6: Scam notices, new senders and Block sender in the capture sheet and notifications

As Priya,
I want every bank-message capture to tell me plainly when it's a scam or a sender wmbugo doesn't know, and to let me block a sender that isn't sending transactions,
So that I stay in control of what gets read without digging through settings.

**Acceptance Criteria:**

**Given** `CapturesSubmitted` for an `sms` capture
**When** the Story 11.6 handler runs
**Then** `sms` is registered as an automated source, so its notifications follow the Story 11.6 full/hidden forms, grouping and the Story 11.11 per-type switches, snooze and caps exactly; no SMS capture bypasses notification permission, consent or the hidden form (SMS-006).

**Given** a full-form notification for an `sms` capture
**When** it is built
**Then** its actions are `Approve ₹420 Swiggy`, `Reject ₹420 Swiggy` and `Not a transaction` (tapping the notification body still opens the sheet, so `Change` is not needed as an action); for a mixed merchant they are `Approve …`, `Snap receipt to split` and `Not a transaction`; for a capture that cannot be confirmed as shown, `Review`, `Reject …` and `Not a transaction`; `Not a transaction` opens the sheet with the block choice below already shown
**And** the hidden form is unchanged (`Review` only).

**Given** any `sms` capture card in the sheet (single or batch)
**When** it renders
**Then** a text button `Not a transaction · Block sender` (48 dp, underlined) sits below the Remember row; tapping it shows inline `Block HDFCBK? wmbugo will stop reading its messages.` with `Block sender` and `Only reject this`
**And** `Block sender` rejects this capture (`RejectCapture`) and sets the sender `blocked` (keeping `status_before_block`) in one writer transaction with the toast `HDFCBK blocked · Undo`; `Only reject this` rejects without blocking; other waiting captures from that sender stay waiting.

**Given** a `ScamFlagged` event
**When** the handler runs
**Then** it posts on the `Captures` channel a notification titled `Looks like a scam — not added` with the text `From +91 98••• ••210 · Don't tap links in it.` (sender masked to its first 4 and last 3 characters; a DLT header is shown in full), no amount, and a tap opens the sheet's scam notice; scam notifications are grouped with each other, never with captures
**And** in the hidden form it reads `Message not added` with `Review`.

**Given** the scam notice in the sheet
**When** it renders
**Then** the card shows the status `Looks like a scam — not added`, the sender, the redacted preview and the line `wmbugo didn't add anything.`, with `Block sender` and `Close` only — there is no way to add it from here.

**Given** a capture with an open `new_sender` candidate from `VM-KCOOPB`
**When** its card renders
**Then** above the grid a section reads `New sender KCOOPB?` with `It's my bank` and `Ignore`, and `Approve` is disabled with the hint `Is this your bank? Answer above first`; its notification offers `Review` and `Reject …` only
**And** `It's my bank` sets the sender `user_confirmed` and resolves the candidate (the capture keeps waiting for a normal decision and is never auto-approved), and `Ignore` rejects the capture through `RejectCapture` without blocking the sender, so the next message from KCOOPB asks again.

**Given** a capture with `balance_flag`
**When** its card renders
**Then** a caption reads `The balance in this message doesn't match your last HDFC ••4821 message. Check it before approving.`, the auto-approve line is absent, and approving it resets the chain (Story 13.4).

**Given** Settings › Capture › Learned merchants (SCR-28) in a build where `captureCapabilities.sms` is true
**When** blocked senders exist
**Then** the `Blocked senders` slot left by Story 11.13 lists rows such as `HDFCBK · blocked 7 Nov` with `Unblock`; `Unblock` returns the sender to `status_before_block` with the toast `Unblocked · Undo`, messages received while it was blocked are not brought back, and with no blocked senders the section is absent
**And** where `captureCapabilities.sms` is false the section is absent (SCR-28 per PRD §13.2).

**Given** a capture rejected through `Ignore`, `Only reject this` or `Block sender`
**When** Priya opens Activity › Show rejected within 90 days
**Then** it is there greyed with `Restore` (Story 3.13), and restoring it records it `confirmed` / `user_approved` with balances and budgets updated atomically, without changing the sender's status (FLOW-18).

**Given** TalkBack and fontScale 1.3
**When** each new variant renders
**Then** `New sender KCOOPB?` is read as a heading before its two buttons, the scam notice's status is read first, every new string comes from the `sms` partition (Story 13.1), and screenshot tests cover scam notice, new sender, balance caption and block confirm in light and dark.

**Covers:** SMS-006, SMS-011 (scam notice, never posted), SMS-012 (flagged capture held for review), SMS-013 (Not a transaction · Block sender, blocked senders listed and unblockable), SMS-017 (`New sender X? It's my bank / Ignore`), UX-DR39 (scam notice, new sender and Block sender variants), UX-DR62 (Blocked senders section with Unblock and Undo), UX-DR82, FLOW-09, FLOW-18

### Story 13.7: Spike S4 — SMS to notification latency through the background job

As Priya,
I want a payment notification within a few seconds of my bank's SMS, even when wmbugo isn't running,
So that I can approve it while the payment is still on my mind.

**Acceptance Criteria:**

**Given** a spike branch of the `sms` flavor with a Kotlin `SmsReceiver` for `SMS_RECEIVED` that stores and parses nothing and enqueues a WorkManager unique work `sms-catchup` (`ExistingWorkPolicy.APPEND_OR_REPLACE`, expedited with a non-expedited fallback), and a worker that starts a React Native headless JS task (`allowedInForeground = true`, bridgeless / New Architecture) running `SubmitSms` for inbox messages after a stub cursor and posting the Story 11.6 notification
**When** a synthetic HDFC debit SMS is delivered 30 times in each of three states on both Story 1.3 reference devices — app in foreground, process alive in background, process killed (swiped away / `am kill`) — plus 10 times with the screen locked (after first unlock)
**Then** p50 and p95 from SMS received to notification posted per state are recorded in `docs/spikes/S4-sms-latency.md` with the method, device models and raw numbers, against NFR-16 (≤ 5 s alive, ≤ 30 s killed).

**Given** the measured results
**When** headless JS meets both NFR-16 targets
**Then** the decision recorded is "receiver → unique job → headless JS → `SubmitSms`" (AD-11 default); when the killed-process p95 exceeds 30 s the record names the fallback measured on the same branch (a short-lived foreground-service-free Kotlin worker that pre-warms the JS runtime, or posting a hidden-form `New payment to check` notification from Kotlin first and updating it once JS finishes, still with no parsing in Kotlin), and NFR-16 evidence for the chosen path.

**Given** the same branch
**When** the spike runs 50 SMS within 60 seconds and a reboot with 5 SMS received before first unlock
**Then** it records that the unique work never runs two catch-ups at once, every message is handled exactly once, and messages received before first unlock are read only after unlock via the inbox, never via the broadcast (the receiver is not `directBootAware`).

**Given** the spike's conclusions
**When** the story closes
**Then** the AD-11 section of the architecture spine records the decision, its measured numbers and the job's per-run CPU time; no production code is merged except the receiver/worker skeleton and the latency measurement hook.

**Covers:** S4, NFR-16 (evidence), AD-11 (headless JS path confirmed), AD-16

### Story 13.8: The SMS receiver and catch-up job — live, after unlock, after reboot, exactly once

As Priya,
I want every bank SMS to reach wmbugo once — whether my phone was locked, rebooted or wmbugo was closed —
So that I never lose a payment and never get one twice.

**Acceptance Criteria:**

**Given** this story's migration
**When** it runs
**Then** the capture module owns `sms_cursor(last_processed_received_at, last_processed_fingerprint, consent_at, backfill_offered, enabled)`, a single row created by the use case `EnableSmsCapture(now)` (cursor and `consent_at` = now, `enabled = true`, receiver enabled) and switched off by `DisableSmsCapture` (`enabled = false`, receiver disabled, queued catch-up cancelled), both callable in this story from the debug Capture lab and given their UI in Story 13.9; the backup format carries it like any other table (Stories 8.7, 8.8).

**Given** the `sms` flavor and the S4 decision (Story 13.7)
**When** `SMS_RECEIVED` is broadcast while SMS capture is enabled
**Then** `SmsReceiver` reads nothing from the intent, writes nothing, and enqueues the unique `sms-catchup` work; the receiver component is enabled with `setComponentEnabledSetting` only while `sms_cursor.enabled` is true and `captureCapabilities.sms` is true, and is disabled otherwise (test for region change IN → GB and for turn off).

**Given** the `SmsCatchUp` use case (triggers `live`, `app_start`, `post_unlock`, `boot`, `backfill`)
**When** it runs
**Then** it reads the inbox through the `SmsInbox` adapter (`Telephony.Sms.Inbox`, `date > last_processed_received_at`, oldest first, with the same-millisecond tie broken by fingerprint), calls `SubmitSms` per message (Story 13.5), and advances `sms_cursor` in the same writer transaction as each message's result — including `ignore` results — so a crash mid-run resumes after the last committed message and never skips or repeats one (kill-mid-run test)
**And** it processes at most 200 messages per run and re-enqueues itself when more remain.

**Given** the phone rebooted and has not been unlocked
**When** a debit SMS arrives
**Then** nothing is stored (the receiver does not run before first unlock and there is no pre-unlock storage), and after the first unlock the boot hook already used by the Scheduler adapter (Story 11.10) enqueues `sms-catchup` (`post_unlock`), which captures that SMS exactly once (SEC-001 acceptance).

**Given** the database cannot be opened when the job runs (safe mode, Story 8.12, or a restore in maintenance mode)
**When** the job starts
**Then** it exits without touching the inbox cursor, and the next successful app start runs `app_start` catch-up, so nothing is dropped.

**Given** every app start and resume
**When** the database is open
**Then** `SmsCatchUp(app_start)` is enqueued (unique, so it never runs twice in parallel with a live run), which also recovers messages whose broadcast was missed (OEM-killed process, Doze).

**Given** a live run that produces captures
**When** they commit
**Then** `CapturesSubmitted` drives the Story 11.6 / 13.6 notifications; on both reference devices p95 SMS-to-notification is ≤ 5 s with the process alive and ≤ 30 s when killed (device test recorded in the story notes, NFR-16).

**Given** the reference device from Story 1.3 and a 24-hour run with 40 synthetic bank SMS
**When** `dumpsys batterystats` is captured
**Then** wmbugo has no foreground service, no always-running service and no wakelock held over 60 s, each job run uses ≤ 2 s of CPU time at p95, and the battery attributed to wmbugo stays within the GATE-03 budget recorded in the Story 1.3 method file (NFR-18); the numbers are recorded in the story notes.

**Given** the Logger and crash records (Story 8.1)
**When** the job logs
**Then** it logs only counts and result codes (`sms-catchup live: 1 captured, 0 ignored`), never an address, body, amount or preview (redaction test).

**Covers:** AD-11 (receiver stores and parses nothing; one job for live, post-unlock, reboot and missed broadcasts; safe to rerun), SEC-001 (SMS catch-up from `sms_cursor` after first unlock and every start, dedup by fingerprint, nothing pre-unlock, cursor in backups), SMS-004 (bodies never persisted), NFR-16, NFR-18, AD-16

### Story 13.9: Turn on bank SMS — the explainer, the permission, turning it off and the 30-day offer

As Priya,
I want to see exactly what wmbugo will read and keep before Android asks me for SMS access, and to be able to turn it off just as easily,
So that I can say yes with confidence, or no without losing anything.

**Acceptance Criteria:**

**Given** `captureCapabilities.sms` is true and SMS capture has never been offered
**When** Priya reaches Home for the first time after onboarding (or, for an existing profile, at the next app open after this build is installed)
**Then** SCR-24 opens once, full screen; it is never part of onboarding and never shown in a `nosms` build or a non-`IN` profile (UI test per flavor × region), and `prompt_state` records `sms_offer = shown` immediately.

**Given** SCR-24
**When** it renders
**Then** it shows the title `Let wmbugo read bank SMS?`, three rows — `Reads` `Messages from your bank and card companies`, `Keeps` `Amount, merchant, last 4 digits of the account, time, and a short preview with the amount hidden`, `Never` `OTPs, personal messages or links — and nothing leaves this phone` (with the crossed-out OTP icon) — a `Learn more` text button that expands the field list (`Debit or credit · Amount and currency · Merchant or person · Reference number · Account or card ending · Available balance · Date and time`), `Turn on` (button-primary), `Not now`, and the footer `Turn off anytime in Settings › Capture`.

**Given** `Turn on`
**When** Priya taps it
**Then** only now the OS asks for `RECEIVE_SMS` and `READ_SMS` (one SMS permission dialog); on Allow, `EnableSmsCapture` (Story 13.8) sets `consent_at = last_processed_received_at = now` and `enabled = true` and enables the receiver, and older messages are never read automatically.

**Given** the permission was just granted and `backfill_offered` is false
**When** `EnableSmsCapture` commits
**Then** a sheet asks `Bring in the last 30 days of bank SMS?` with `Found 23 bank messages. They'll wait in To check — none add themselves.` (count of transaction-like messages from verified or unknown bank senders in the last 30 days, computed in memory; nothing is stored for the count), `Bring them in` and `No thanks`; either answer sets `backfill_offered = true` and the offer never returns, including after turning SMS off and on
**And** `Bring them in` runs `SmsCatchUp(backfill)` over that window: captures are created `needs_review` with `origin = backfill`, `isAutoApprovable` returns false for them forever, no per-capture or scam notification is posted, and the toast reads `23 brought in · They're in To check`; with 0 found the sheet is not shown.

**Given** `Not now`, Back, or the OS dialog denied
**When** SCR-24 closes or returns
**Then** nothing changes in any other feature; `Not now` records the decline time in `prompt_state` for the re-ask rules (Story 13.10); a denial shows SCR-24's denied state — `SMS access is off. You can still add payments by hand, share UPI screenshots or snap receipts.` with `Enter it by hand` (Add sheet) — and, when Android will no longer show the dialog, `Turn on` becomes `Open settings` (app details settings).

**Given** Settings › Capture with `captureCapabilities.sms` true
**When** it renders
**Then** a first row `Bank SMS` shows `On` or `Off`, the Capture group summary reads `SMS on · Auto-approve 9:00 pm` (or `SMS off · Auto-approve 9:00 pm`, locale time), and the Story 11.11 rows `Auto-approve` and the `Payments to check` / `Evening summary` switches now show in release builds because an automated source exists.

**Given** `Bank SMS` with capture on
**When** it opens
**Then** SCR-24's status state shows `Reading bank SMS`, `Last bank message read 8:42 pm` (or `None yet`), a switch `Read bank SMS` (on), and the line `To remove SMS access completely, Open settings`; turning the switch off runs `DisableSmsCapture` with the toast `Bank SMS off`, keeps every capture already made, and turning it on again starts a new consent (cursor = now; messages received while off are never read)
**And** with capture off, the row opens the explainer again (Settings is always allowed to ask).

**Given** SMS access is revoked in Android settings while capture is on
**When** the app starts or resumes
**Then** `sms_cursor.enabled` becomes false, the receiver is disabled, the `Bank SMS` row reads `Off — SMS access removed`, no prompt, card or notification appears, and manual entry, UPI share, receipts, import and every total keep working (SMS-008 regression suite with permission revoked mid-session).

**Given** a backup with `sms_cursor` restored onto a phone where SMS capture is off
**When** Priya turns it on there
**Then** the catch-up resumes from the restored cursor when it is at most 30 days old (fingerprints skip anything already captured), otherwise from the moment of consent, and the 30-day offer is not shown again when `backfill_offered` was restored true.

**Covers:** SMS-002 (contextual disclosure before the permission), SMS-014 (explainer precedes the OS prompt), SMS-008 (denial or revocation leaves the app fully functional), SMS-015 (absent outside `sms` + `IN`), SEC-001 (cursor from consent, one-time 30-day backfill to review never auto-approved, cursor kept across restore), UX-DR81 (explainer, denied state, Turn off anytime), UX-DR69 (SMS permission just in time, denied pattern), UX-DR60 (`SMS on · Auto-approve` summary), CAP-006 (auto-approve settings available in release), FLOW-09

### Story 13.10: "Tired of typing payments?" — the limited re-ask on Home

As Priya,
I want wmbugo to mention SMS capture again only when it would clearly help me, and at most twice,
So that saying "not now" once doesn't lock me out, and saying it twice means it stops asking.

**Acceptance Criteria:**

**Given** the pure core function `smsReaskState(promptState, manualSavesSince, now)`
**When** it runs
**Then** it returns `none`, `show_first` or `show_second` by these rules (table and clock-fixture tests):
- `show_first` when SCR-24 was answered `Not now` (or denied), SMS capture is off, the first card has not been dismissed, and Priya has saved 5 manual entries (`source_kind = manual`) since that answer
- `show_second` when the first card was dismissed at least 7 days ago, the second has never been dismissed, SMS capture is off, and at least one manual entry was saved after those 7 days
- `none` otherwise, and always `none` once the second card is dismissed, once SMS capture has ever been turned on, or when `captureCapabilities.sms` is false.

**Given** `show_first` or `show_second`
**When** Home renders
**Then** a dismissible setup card (UX-DR58: dashed `border-control` on `bg-surface`) sits above the first Home card with the title `Tired of typing payments?`, the sentence `Let wmbugo read bank SMS`, the text button `See how it works` and a 48 dp close button labelled `Dismiss`; it is not part of the Home card editor, and it stays across launches until acted on.

**Given** the card
**When** Priya taps `Dismiss`
**Then** that card's dismissal and time are recorded in `prompt_state` (`sms_reask`, count, last_shown_at) and it disappears without a toast.

**Given** the card
**When** Priya taps `See how it works`
**Then** SCR-24 opens; `Turn on` + Allow ends all re-asking (her next bank payment arrives as a capture notification, J-SMS-REASK); `Not now`, Back or a denial counts as dismissing that card.

**Given** both cards dismissed
**When** Priya later wants SMS capture
**Then** Settings › Capture › `Bank SMS` still opens the explainer (Story 13.9), and no other surface ever asks again.

**Given** a `nosms` build or a non-`IN` profile with any number of manual entries
**When** Home renders
**Then** no card, string or placeholder about SMS exists (UI test per flavor × region).

**Given** TalkBack
**When** the card is focused
**Then** it reads `Tired of typing payments? Let wmbugo read bank SMS`, then the `See how it works` and `Dismiss` buttons.

**Covers:** SMS-014 (re-ask at most twice, ≥ 7 days apart, value-triggered, then only via Settings), UX-DR81 (re-ask timing), UX-DR58 (dismissible re-ask setup card), UX-DR100 (`Tired of typing payments? Let wmbugo read bank SMS`), J-SMS-REASK

### Story 13.11: Background capture help in Diagnostics, and checking a bank message by hand

As Priya,
I want wmbugo to tell me honestly whether my phone is letting it hear bank messages, and what I can change if captures stop arriving,
So that I can fix a missing capture myself instead of guessing.

**Acceptance Criteria:**

**Given** Settings › Help › Diagnostics (SCR-22) with `captureCapabilities.sms` true
**When** it renders
**Then** the `Background capture` slot reserved by Story 8.10 shows only values the app can verify: `SMS access: allowed | not allowed`, `Bank SMS: on | off`, `Battery optimisation: on | off` (`PowerManager.isIgnoringBatteryOptimizations`), `Background use restricted: yes | no` (`ActivityManager.isBackgroundRestricted`), `App standby: Active | Working set | Frequent | Rare | Restricted` (`UsageStatsManager.getAppStandbyBucket`), `Last bank message read: 7 Nov, 8:42 pm` and `Last catch-up: 7 Nov, 9:05 pm`
**And** with `captureCapabilities.sms` false the slot stays empty and renders nothing.

**Given** any of: battery optimisation on, background restricted, standby `Rare` or `Restricted`, or the last `app_start` catch-up captured a bank message received more than 10 minutes earlier
**When** the slot renders
**Then** a help block reads `Bank messages may arrive late on this phone.` with steps for the phone's manufacturer (`Build.MANUFACTURER`: Xiaomi / Redmi / POCO, Oppo / Realme, Vivo, OnePlus, Samsung, and a generic text for others), each phrased as where to look (`Look for Battery saver › No restrictions for wmbugo`), and a button `Open battery settings` (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, no extra permission)
**And** the copy never claims wmbugo runs all the time, will never miss a message, or can turn on auto-start for her; a string test fails on `always running`, `never miss`, `guaranteed`, `auto-start` or `bypass`.

**Given** the same late-arrival condition
**When** Settings › Capture › `Bank SMS` renders
**Then** it shows the line `Some messages arrived late · Check background settings`, which opens the Diagnostics slot.

**Given** the Story 8.10 `Check a parser` section in an `sms` build
**When** Priya picks `Bank SMS`, enters a sender header and pastes sample text
**Then** it shows the normalized sender, the route (`Would be added`, `Would ask: New sender KCOOPB?`, `Looks like a scam — not added`, `Not a transaction`, `OTP — ignored`) and the parsed fields with `read` / `not read`; the text is never stored, logged or included in a diagnostics export.

**Given** a diagnostics export (Story 8.10)
**When** the preview is built
**Then** it includes the background status values and catch-up counts only, and the Story 8.1 redaction test passes on it (no sender address, SMS text, preview, amount or mask).

**Covers:** SMS-007 (only verifiable permission and background state, honest help text), UX-DR83 (OEM background help in Diagnostics), SMS-009 (no SMS text in diagnostics), FLOW-09 (failure path)

### Story 13.12: Play SMS declaration package, both GATE-02 outcomes, and the FLOW-09 end-to-end check

As Priya,
I want the SMS version of wmbugo to reach me only once Google has approved it, and to keep my data if it ships as a separate app,
So that I get bank SMS capture legitimately, and nothing breaks if it's delayed or refused.

**Acceptance Criteria:**

**Given** the Gradle property `smsPackaging` with values `inPackage` and `separate`
**When** CI builds the `sms` release on every push
**Then** it assembles both: `inPackage` with applicationId `app.wmbugo` and `separate` with `app.wmbugo.sms` (own launcher label `wmbugo`), both passing the Story 13.1 allowlist, and a backup made in either restores in the `nosms` `app.wmbugo` and the other way round with learned mappings, senders, `sms_cursor` and waiting captures intact (Story 8.8 cross-package fixture, GATE-02 fallback path)
**And** the release pipeline refuses to upload an `sms` artifact to any Play track other than internal testing unless `docs/gates/GATE-02.md` records `decision: approved` with the packaging outcome, so an unapproved build never reaches production (SMS-001).

**Given** the Play SMS declaration due at M3
**When** the evidence package in `docs/policy/sms-declaration/` is assembled
**Then** it contains: the permissions requested (`RECEIVE_SMS`, `READ_SMS`) with the core use case `SMS-based money management` and the reason each is needed (live capture; catch-up after reboot and missed broadcasts, and the one-time 30-day import); a screen recording of the internal-track `sms` build showing SCR-24 before the OS prompt, a live bank SMS becoming a notification, Approve, `Turn off anytime in Settings › Capture`, and the denied path; the published privacy policy URL (live since M1) with its SMS section (fields kept, raw body never stored, on-device only, how to turn off); screenshots of SCR-24 and Settings › Capture › `Bank SMS`; and a checklist dated against the current policy page (`support.google.com/googleplay/android-developer/answer/10208820`) re-read on the filing day
**And** the M3 milestone check fails when the internal-track `sms` build version is not the one recorded in the package.

**Given** GATE-02 outcomes
**When** `docs/gates/GATE-02.md` records `approved · inPackage`, `approved · separate`, or `rejected / pending`
**Then** the release checklist names the shipped artifacts for each — `nosms` everywhere plus `sms` to India in one package; `nosms` everywhere plus `app.wmbugo.sms` in India with the backup → restore move documented in Help; or `nosms` only — and no outcome requires a code change (dry-run of each in CI).

**Given** the `sms` release build (`inPackage`) on an emulator with region `IN`, airplane mode on, and synthetic messages injected with `adb emu sms send` (or the debug-only `SmsInbox` fixture adapter where the emulator cannot set an alphanumeric sender)
**When** the Maestro suite runs FLOW-09
**Then** it passes: SCR-24 → `Turn on` → Allow → `No thanks`; `AD-HDFCBK` `Rs 420 debited … at SWIGGY … Avl bal Rs 38,000` → notification within NFR-16 → Approve in Food & Drinks; a 10-digit-number debit text → `Looks like a scam — not added`, nothing added; `VM-KCOOPB` salary credit → `New sender KCOOPB?` → `It's my bank` → credit waits; an unknown ••7730 debit with `Avl bal Rs 23,000` → `Add it` → account opens at ₹25,000 and shows ₹23,000 (FLOW-15); HDFC ₹5,000 debit then ICICI ₹5,000 credit → `Moved from my own account` → one transfer (FLOW-16); a promo sender → `Block sender` → its next message is ignored → `Unblock` in Learned merchants; a rejected capture → Show rejected → `Restore` (FLOW-18); one ignored eligible debit → after a clock-guarded 21:00 run it is recorded and the evening summary shows it; reboot with an SMS received before unlock → after unlock it appears exactly once
**And** no network request is made, and a database dump after the run contains none of the injected message bodies (substring check).

**Given** the `nosms` release APK and the same suite on region `IN` and `GB`
**When** the manifest and every UI string are inspected and the app is used
**Then** no SMS permission, receiver or SMS text exists, Settings › Capture has no `Bank SMS` row, Learned merchants has no Blocked senders section, Home never shows the re-ask card, and manual entry, UPI share (IN), receipts and import all work (PRD §8.12 acceptance, RB0).

**Covers:** SMS-016 (declaration at M3 with an internal-track `sms` build, privacy policy from M1, both GATE-02 outcomes supported), SMS-001 (SMS only in an approved build), SMS-015 (no-SMS build inspected), SMS-008 (rejection leaves the app fully functional), GATE-02, AD-17 (in-package or `app.wmbugo.sms`), NFR-16 (device check), FLOW-09, FLOW-15, FLOW-16, FLOW-18, AD-18 (airplane-mode E2E)


## Epic 14: Launch readiness

Priya, Arjun, Sara, Ravi and Mei, in every Phase 1 market, install a release that has passed the accessibility, performance, money-correctness, privacy and store-disclosure checks, matches its SMS approval outcome, and carries offline help explaining how every total is calculated. The epic does not redo checks already proven inside earlier stories (Story 1.3 reference devices and method, 7.8 Insights performance, 8.1 network audit, 10.1 GATE-05, 13.12 GATE-02 and FLOW-09); it re-runs them as whole-app passes on the actual release builds, closes the NFRs, release blockers (RB0/RB1) and gates that no earlier story owns, and keeps the evidence in one place, `docs/release/`, that the launch decision reads. Stories 14.6 (wmbugo Lab) and 14.8 (usability) are scheduled at M3 and M4 respectively; the rest run before the M5 Play launch.

### Story 14.1: Help — how totals work, glossary, FAQ and about

As Mei,
I want to open Help on my phone, with no internet, and read in plain words how each number on Home and Plan is worked out,
So that I can trust "Left in budget" and "Free to use" and know what the app does with my data.

**Acceptance Criteria:**

**Given** the `Help` group row added by Story 8.10 with only Diagnostics
**When** this story lands
**Then** Settings › Help lists, in order, `How totals work`, `Glossary`, `Questions`, `Diagnostics` and `About`, and the row's live summary reads `How totals work · Glossary · About`
**And** every page is bundled in the app (no web view, no network, no downloaded content) and opens on a fresh install with airplane mode on.

**Given** `How totals work`
**When** Mei opens it
**Then** it has one section each for `Left in budget`, `Spent`, `In accounts`, `Card dues`, `Free to use`, `Needs, Wants and Savings`, `Kept`, and `Waiting, guessed and auto-approved entries`, each giving the rule from PRD §10 in plain words (e.g. Free to use = `the smaller of what's left in your budget, and your included accounts minus upcoming bills and money set aside for goals`), what is never counted (transfers, waiting and possible-duplicate entries, before-tracking entries), and one worked example in the profile currency
**And** the worked examples are computed at render time by the same read-model functions Home and Plan use (Story 2.1, 4.5, 6.9) on a fixed in-memory fixture, so a test fails if a Help example and the real formula disagree.

**Given** the hero card, the Free to use figure on Plan, the N/W/S card and the Kept tile
**When** each one's `How is this worked out?` link (a 48dp text row added to each surface's detail screen) is tapped
**Then** Help opens scrolled to the matching section, and Back returns to the screen that opened it.

**Given** `Glossary`
**When** it opens
**Then** it lists every user-facing term from PRD §10 that appears in the UI (Left in budget, Free to use, Transfer, Refund, Savings pot, Set aside, Bill vs receipt, Waiting for you, Category guessed, Possible duplicate, Before tracking started, Not classified), alphabetically, each term a TalkBack heading followed by its definition
**And** no definition uses a minus sign before an amount, and every example amount follows hide amounts (`₹ ••••`, read `Amount hidden`) when hide amounts is on.

**Given** `Questions`
**When** it opens
**Then** it answers at least: `Does wmbugo send my data anywhere?` (no; the app has no internet permission; export and backup only go where you send them), `What if I lose my phone?` (only your own encrypted backup can bring data back; we can't recover it), `Why is this entry waiting?`, `What does auto-approve do?`, `How do I move to a new phone?` and `Why don't I see SMS or UPI share?` (India-only features, PRD §13.0a)
**And** the `sms` answers appear only where `captureCapabilities` allows SMS, and when `docs/gates/GATE-02.md` records `approved · separate`, a `Moving to wmbugo with SMS` answer describes the backup → restore move (Story 13.12) — the no-SMS build contains no SMS wording at all (Story 13.1 string check still passes).

**Given** `About`
**When** it opens
**Then** it shows the app name, version, build flavor, schema version, the offline privacy promise, the privacy policy URL as plain selectable text (not a link that opens a browser, since there is no network permission), and `Open-source licences`
**And** the licences list is generated at build time from `pnpm-lock.yaml` and the resolved Gradle dependencies (name, version, licence, full licence text, including Inter, Phosphor and the OCR model), and CI fails if any shipped dependency has no licence entry.

**Given** 320dp at 200% text with TalkBack on
**When** each Help page is used
**Then** headings are navigable as headings, no text is cut off, every row and link is a 48dp target, and contrast meets NFR-11.

**Covers:** SET-007, UX-DR60 (Help group), UX-DR68 (Help states), NFR-11 (Help pages), SEC-009 (in-app disclosure matches the build)

### Story 14.2: Every Phase 1 flow in airplane mode, on the release builds, in every market

As Sara,
I want the exact app I install to do everything with airplane mode on, whichever country I set up in,
So that "works fully offline" is a promise the release has proved, not a hope.

**Acceptance Criteria:**

**Given** the `nosms` release APK (signed with the upload key, `INTERNET` absent) on emulators set to API 26 and API 36 with airplane mode on from install
**When** the Maestro release suite in `e2e/release/` runs
**Then** it runs FLOW-01 to FLOW-08, FLOW-10 to FLOW-12, FLOW-14 and FLOW-17 end to end, once per market profile: India (`IN`, INR, en-IN), US (`US`, USD), Canada (`CA`, CAD), UK (`GB`, GBP), Germany (`DE`, EUR, decimal comma), Bahrain (`BH`, BHD, 3 decimals), UAE (`AE`, AED), Indonesia (`ID`, IDR, whole units) and Singapore (`SG`, SGD)
**And** FLOW-13 runs only for `IN` and FLOW-09 runs only on the `sms` build for `IN` (re-using the Story 12.6 and 13.12 suites unchanged), and every flow ends with a Home and Activity assertion that the figures match the expected values from the flow's fixture.

**Given** each non-India market profile
**When** the suite walks the Add sheet, Settings › Capture, Home, the widget and Help
**Then** no UPI, SMS, `Share from UPI app` or re-ask text, chip, row or card exists anywhere (PRD §13.0a: not shown, never "coming soon"), and receipt scan, manual entry and CSV import are each reachable in at most two taps from Home.

**Given** a flow that needs a permission (notifications, camera)
**When** the suite denies it
**Then** the flow's offline alternative completes (bill still shown as due on Plan; receipt picked from Photos instead of the camera) and the run is recorded as passing the denied variant.

**Given** the suite finishes
**When** CI stores the result
**Then** `docs/release/<version>/airplane-suite.md` records the APK SHA-256, the flow × market grid with pass/fail, and the run's CI URL, and a release candidate with any red cell cannot be promoted beyond the internal track (release pipeline check)
**And** the suite also runs on each physical reference device (Story 1.3) for the `IN` and `GB` profiles before each beta, and those runs are recorded in the same file.

**Given** a flow fails only on one market profile
**When** the failure is triaged
**Then** the record names the market, the failing step and the linked issue, and the RB0-2 line in the release checklist stays red until the same suite re-runs green on that APK or a later one.

**Covers:** NFR-01, RB0-2, SEC-002 (airplane suite on the release build), AD-18 (pre-release Maestro E2E), FLOW-01, FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-08, FLOW-10, FLOW-11, FLOW-12, FLOW-14, FLOW-17

### Story 14.3: Money-correctness and data-safety release blockers

As Ravi,
I want proof that the release never shows a wrong balance, never counts a payment twice and never loses my data, even if my phone dies mid-way,
So that I can rely on the numbers and my backups.

**Acceptance Criteria:**

**Given** the FIN, TXN, ACC, BDG, DEDUP, 5030 and INTL property and integration suites from Epics 1–13
**When** the release-blocker job `pnpm release:rb0` runs on the release commit
**Then** it runs every suite with fast-check at 1,000 runs per property (10× the push default) and fails on any invariant violation, so NFR-09's 0 violations is proven at release depth
**And** it fails if any suite listed in PRD §16.1 for P1 has no test file mapped to it in `docs/release/suite-map.md`.

**Given** the GATE-07 worked examples (a transfer, a refund larger than the period's spend, a card payment, a split with tax, a 50/30/20 month with pot-to-pot moves and a mid-cycle payday change) written as fixtures with expected balances, budget used, Left in budget and Free to use
**When** the job runs
**Then** each example's values computed by the read model equal the hand-worked values in `docs/release/gate-07-worked-examples.md` exactly, and the product owner's GATE-07 sign-off with date is recorded in that file (RB0-1: no incorrect balance or rounding error).

**Given** a release build with seeded data (10,000 entries, attachments, learned merchants, waiting captures)
**When** a fault-injection harness kills the process at 20 random points during each of: CSV import commit, backup write, restore, schema migration and the auto-approve write
**Then** after each restart the integrity check passes, balances equal the pre-operation or fully-post-operation values (never in between), the UI opens normally or in safe mode with restore offered, and no attachment or entry is lost (NFR-12, RB0-1 data loss).

**Given** the Story 8.7–8.9 backup and restore
**When** the release suite runs backup → restore across two emulators (same package, and `nosms` → `sms` separate package)
**Then** a correct passphrase restores every account, entry, attachment, learned mapping and setting with matching balances; a wrong passphrase, a truncated file, a file with one flipped byte and a newer-schema file each show their error and leave the existing data untouched (RB0-6).

**Given** fixtures where a capture matches a confirmed entry, is flagged possible duplicate, is incompletely parsed, is transfer-like, or is a UPI screenshot
**When** the auto-approve write runs on the release build after the cutoff
**Then** none of them is confirmed, and each stays waiting (RB0-3); and a receipt matching an existing SMS, manual or imported entry never creates a second confirmed expense without the user's Keep separate (RB0-8, re-run of Story 10.8 on the release build).

**Given** all of the above
**When** the job finishes
**Then** `docs/release/<version>/rb0-correctness.md` records each RB0-1, RB0-3, RB0-6 and RB0-8 line with its evidence link and pass/fail, and any fail blocks promotion of that build.

**Covers:** RB0-1, RB0-3, RB0-6, RB0-8, NFR-09, NFR-12, GATE-07 (release sign-off), LIR-03 (release re-run), BKP-003 (release re-run)

### Story 14.4: Performance on the reference device matrix

As Arjun,
I want the release to open, scroll and save quickly on an ordinary budget phone with years of entries,
So that checking "Am I okay?" never feels slow.

**Acceptance Criteria:**

**Given** the Story 1.3 method and reference devices, the release build, and a synthetic profile of 10,000 ledger records over 24 months (plus a 50,000-record stress profile)
**When** the performance suite `e2e/perf/` runs on each reference device, 20 runs per measure
**Then** `docs/release/<version>/performance.md` records, per device: navigation median between tabs and into detail screens (NFR-03 < 300 ms), Save confirmation p95 (NFR-04 < 500 ms), Home visible p95 on warm start (NFR-05 ≤ 2 s), frame stats during Home, Activity, Plan and the capture sheet (NFR-06 ≥ 95% at 60 FPS, no stall > 100 ms), Activity scroll and search p95 at 10k (NFR-07 ≥ 95% frames, search < 500 ms), receipt OCR p95 on the 40 synthetic receipts (NFR-08 ≤ 5 s), glass surface frames or the fallback switch (NFR-19), and splash time before Home (NFR-20 ≤ 1 s, ends on DB ready)
**And** each figure is shown next to its threshold with pass/fail, and the 50k profile is reported for information only.

**Given** a measure that misses its threshold
**When** it is recorded
**Then** the file lists the measure, the device, the measured value, the cause if known and a proposed fix or exception, and RB1-1 is green only when every miss is either fixed and re-measured or carries the product owner's dated acceptance in the same file.

**Given** a CPU profile during each measured scenario
**When** it is inspected
**Then** no SQL, aggregation, OCR or image work runs on the JS thread (AD-16), and any scenario that does is a fail regardless of the frame figures.

**Given** GATE-09
**When** the device-matrix run is recorded
**Then** `docs/release/device-matrix.md` lists every device and emulator image used (model, API level, RAM), which suites ran on each (airplane suite, performance, accessibility), the APK hash and date, and the product owner's GATE-09 sign-off.

**Covers:** NFR-03, NFR-04, NFR-05, NFR-06, NFR-07, NFR-08, NFR-19, NFR-20, RB1-1, GATE-09, GATE-03 (re-confirmed), AD-18 (pre-release performance)

### Story 14.5: Whole-app accessibility audit

As Ravi, using TalkBack and 200% text,
I want every screen of the release, not just the ones tested so far, to work with my screen reader and large text,
So that I can manage my money without asking anyone for help.

**Acceptance Criteria:**

**Given** the release build and every screen in the SCR inventory that ships in Phase 1, plus the capture sheet, notifications and both widgets
**When** the automated audit (Android Accessibility Test Framework checks in Espresso plus the component-level hit-rect and label tests from Story 1.9) runs on all of them
**Then** it reports zero failures for missing labels, touch targets < 48dp, text contrast < 4.5:1 and non-text contrast < 3:1 in light, dark and `glass.fallback` modes (NFR-11)
**And** the report is stored in `docs/release/<version>/accessibility.md`.

**Given** the UX test matrix 320dp × 200% font × en-IN 9-digit amount (`₹1,18,60,000`) × hidden amounts × over budget
**When** snapshot tests render the hero, Activity, Add sheet, capture sheet, widget, Plan, budget detail, account detail and Settings hub
**Then** no amount is truncated, ellipsised or wrapped mid-number, every primary action stays reachable (sticky footers), the tab bar keeps all four labels and ＋, and each UX-DR85 reflow rule appears as specified.

**Given** a manual TalkBack script per prioritized flow (onboarding, add expense, transfer, pay card bill, budget drill-down, approve a capture, backup, restore, app lock unlock)
**When** the product owner runs it on a reference device with TalkBack and separately with Switch Access and no gestures
**Then** each flow completes, merged hero and row announcements match the EXPERIENCE.md strings, focus returns to the opener after every sheet, and every gesture has its visible or custom-action alternative (UX-DR86, UX-DR88, UX-DR93).

**Given** a greyscale screenshot review of Home over budget, Activity with every row state, the N/W/S card, budgets and Insights
**When** colour is removed
**Then** every financial state (over budget, waiting, possible duplicate, rejected, reversed, refund) is still told by icon, text, tick or pattern (RB0-9: never colour alone).

**Given** system animator scale 0 and, separately, the in-app Reduce motion toggle
**When** the app is used
**Then** the coin, boat, OCR scan line, card changes and sheets follow the UX-DR91 still variants, and glass switches to fallback at animator scale 0.

**Given** any audit finding
**When** it is triaged
**Then** a blocker is any finding that stops a prioritized flow being completed with TalkBack, Switch Access or 200% text, hides a primary action, or conveys a financial state by colour alone; RB0-9 is green only with zero open blockers, and non-blockers are listed with an issue link.

**Covers:** NFR-11, RB0-9, UX-DR84, UX-DR85, UX-DR86, UX-DR87, UX-DR88, UX-DR89, UX-DR90, UX-DR91, UX-DR92, UX-DR93 (whole-app audit)

### Story 14.6: wmbugo Lab — measuring capture accuracy on testers' own phones

As a beta tester in Priya's position,
I want to help measure how well wmbugo reads my real receipts and UPI screens without the images ever leaving my phone,
So that the accuracy claims are proven on real payments while my privacy is kept.

**Acceptance Criteria:**

**Given** the Gradle build
**When** the `lab` variant is assembled
**Then** it has applicationId `app.wmbugo.lab`, launcher label `wmbugo Lab`, a distinct icon tint, and is the only variant allowed `INTERNET`; the release pipeline refuses to upload it to any track of `app.wmbugo` or `app.wmbugo.sms`, and the `nosms`/`sms` allowlist checks are unchanged (AD-17)
**And** it never opens or reads the production app's database.

**Given** the reference-set protocol (PRD §16.3)
**When** a tester first opens wmbugo Lab
**Then** a consent screen states the purpose, what is uploaded (per-field scores and a redacted copy only), where it is stored (encrypted on the developer's machine), retention (at most 12 months or until launch + 3 months, whichever is first) and deletion on request within 30 days, and nothing can be measured until the tester ticks the consent checkbox; consent is recorded with date in the app.

**Given** a receipt photo or UPI screenshot picked in Lab
**When** the production parsers (Epic 10, Epic 12) read it
**Then** the tester sees each field (merchant, date, total; or amount, UPI reference, app layout) with `Right` / `Fix it`, the app stores a per-field score, and the original image stays in Lab's private storage on the phone.

**Given** the tester taps `Send scores`
**When** the upload is prepared
**Then** Lab shows a preview of the redacted copy (payee names, UPI IDs, phone numbers, card fragments and loyalty IDs blacked out by on-device detection, plus manual black-out by the tester) and the scores, and sends them only after confirmation, over an encrypted in-app upload to the developer (never email or chat); the original image is never in the payload (payload test).

**Given** GATE-08 requires the protocol to be reviewed before collection at M3
**When** Lab is first distributed
**Then** `docs/gates/GATE-08.md` records the external reviewer's sign-off of the protocol and consent text dated before the first install, and the distribution step fails without it.

**Given** collected scores
**When** `scripts/lab/score-report` runs on the developer's machine
**Then** it reports receipt total / merchant / date correct-rate per market group (NFR-17 target ≥ 90% overall) and UPI amount and reference correct-rate per app layout (≥ 98%), and the report is stored as release evidence without any image or redacted copy in the repository.

**Covers:** NFR-17 (real-world reference sets), AD-17 (`app.wmbugo.lab`), GATE-08 (protocol review before collection), SEC-009 (Lab consent matches behaviour)

### Story 14.7: Security and Play permission review of the release builds

As Sara,
I want the release I install to have been checked for leaks and unnecessary permissions, and to be the right variant for whether SMS was approved,
So that what wmbugo promises about privacy is true of the exact app on my phone.

**Acceptance Criteria:**

**Given** the release candidates (`nosms`, and `sms` when GATE-02 is approved) as signed AABs
**When** `scripts/release/permission-review` runs on the bundles Play will serve (bundletool universal APK)
**Then** it lists every permission, receiver, service, provider and exported component, compares them to `PERMISSIONS.md` (Story 8.1) and the allowlist, and fails on any difference
**And** for `nosms` it confirms no SMS permission, no SMS receiver, and no SMS string in resources or the JS bundle (RB0-4, re-run of Story 13.1 on the final bundle).

**Given** `docs/gates/GATE-02.md`
**When** the release checklist is generated
**Then** the artifacts listed for upload match the recorded outcome exactly (Story 13.12), and a mismatch — an `sms` artifact without `approved`, or a missing `nosms` artifact — blocks the release (RB0-7).

**Given** the proxy audit runbook from Story 8.1
**When** it is re-run on the release build for every flow in Story 14.2 (onboarding, add, capture from UPI share and receipt, import, export, backup, restore, Diagnostics export) and, for `sms`, a live SMS capture
**Then** the proxy records zero requests initiated by the app, and the result is stored in `docs/release/<version>/proxy-audit.md` (NFR-02, NFR-15).

**Given** GATE-04 solo-review checks
**When** the security review is done before each beta and the release
**Then** `docs/gates/GATE-04.md` records: the architecture threat-model checklist (PRD §17 threats) ticked against current code, the dependency audit (`pnpm audit`, Gradle dependency licences and the denylist result) with no unresolved high or critical item, the proxy audit result, and an AI-assisted security review of the diff since the previous beta with each finding resolved or accepted by the product owner.

**Given** a reference device with seeded data
**When** it is powered off and booted to the lock screen without unlocking, and the app's data directory is pulled with `adb` from a rooted emulator image running the release build (the rooted image is only the test instrument)
**Then** the database and attachments cannot be read without the device credential, and a backup file cannot be opened without its passphrase (NFR-10 verified on the release build; rooted device used only as the test instrument, outside the guarantee).

**Covers:** RB0-4, RB0-7, GATE-04, NFR-02, NFR-10, NFR-15, SEC-002 (release proxy audit), SEC-003 (final permission review)

### Story 14.8: Guerrilla usability study

As Arjun,
I want the people who designed wmbugo to have watched real people use it before launch,
So that I understand straight away what "Left in budget", "Free to use" and an auto-approved entry mean.

**Acceptance Criteria:**

**Given** a closed-beta B build at M4 and a written study plan in `docs/research/usability-m4.md`
**When** participants are recruited
**Then** at least 5 participants take part, at least 2 in India and at least 2 outside India, none involved in building wmbugo, each giving written consent; sessions use a test phone with a synthetic profile, so no participant's real financial data is recorded
**And** no recording leaves the developer's machine and notes contain no participant names.

**Given** the task script
**When** each participant runs it unaided
**Then** it includes: explain the difference between `Left in budget` on Home and `Free to use` on Plan; add an expense; move money between two accounts; open a budget and find the entries behind it; explain what an entry tagged `Recorded · category guessed` (auto-approved) is; and, for non-India participants, set up and save a first itemised receipt
**And** each task is scored success / partial / fail against criteria written before the first session.

**Given** the results
**When** they are written up
**Then** the file reports per task the comprehension or completion rate, the median time for adding an expense (PRD §3.3 target ≤ 15 s for a returning user) and for the receipt task (≤ 3 min for non-India onboarding plus first receipt), and quotes the words participants used
**And** RB1-2 is green when Home comprehension, expense add, transfer, budget drill-down and auto-approved-entry comprehension each reach ≥ 90%.

**Given** a task below 90%
**When** it is triaged
**Then** the fix (copy, layout or Help link) is made in a linked story, and the task is re-run with at least 3 new participants; RB1-2 stays red until the retest reaches ≥ 90% or the product owner records a dated waiver with reasons in the same file.

**Given** the study is complete
**When** GATE-06 is assessed
**Then** `docs/gates/GATE-06.md` records the UX spines as the screens/tokens/wireframes evidence and this study as the usability evidence, with the product owner's sign-off.

**Covers:** RB1-2, GATE-06 (M4 usability results)

### Story 14.9: Privacy policy, Data safety and store listings for every market

As Priya, Sara and Mei,
I want the Play listing and privacy policy in my country to describe exactly what the app I install does,
So that I can decide to trust it before I install.

**Acceptance Criteria:**

**Given** the market availability matrix (PRD §13.0a) and the platform parity matrix (PRD §13.0)
**When** `docs/release/matrices.md` is generated from the same `captureCapabilities` and region table the app uses
**Then** it shows each feature by market group (India, US/Canada, UK/Europe, Gulf/SE Asia) and by build (`nosms`, `sms`) with Android Phase 1 and iOS Phase 2 columns, and a test fails if the generated matrix differs from the app's runtime gating for any region (NFR-13).

**Given** the provisional privacy policy published at M1
**When** the final policy is written
**Then** it covers India (DPDP), EU/UK (GDPR), US/Canada and Gulf/SE Asia; states that the app has no internet permission, collects nothing, and keeps data on the phone; separates app behaviour from user-initiated export, backup and OS mechanisms (PRD §13.3); describes camera, photos, notifications and (in the `sms` section) SMS use; and gives a contact for questions
**And** the external paid reviewer's report and sign-off are recorded in `docs/gates/GATE-08.md` before any production submission (RB0-5), with each finding resolved or recorded with the reviewer's agreement.

**Given** the Play Data safety form
**When** it is filled in
**Then** it declares no data collected and no data shared, matching the Story 14.7 permission review and proxy audit, and a checklist in `docs/release/data-safety.md` maps each answer to its evidence (SEC-009).

**Given** the store listing
**When** it is prepared for each market group
**Then** each has its own short and full description and screenshots taken from the release build in that market's region and currency (e.g. INR with lakh grouping for India, GBP for UK, AED for Gulf, SGD for Singapore); UPI share and SMS capture appear only in the India listing (SMS only when GATE-02 is approved); no listing claims a feature that market's build doesn't show, or says "coming soon"
**And** the listings state the app is free with no in-app purchases (DEC-13), and claim zero ongoing server cost to the user only in the sense that the app needs no account or subscription (NFR-14).

**Given** any change to the release build's permissions, SDKs or features after sign-off
**When** a new release candidate is built
**Then** the release checklist re-opens the Data safety checklist and listing review, and promotion is blocked until they are re-confirmed.

**Covers:** SEC-009, GATE-08 (pre-submission review), RB0-5, NFR-13, NFR-14 (listing claim)

### Story 14.10: Closed test, gate ledger and the Play launch

As Priya,
I want wmbugo to reach the Play Store only after a real closed test and with every release check signed off,
So that the app I install on launch day is the one that was tested.

**Acceptance Criteria:**

**Given** GATE-13
**When** the Play developer account type is confirmed
**Then** `docs/gates/GATE-13.md` records the account type and, if the account is a personal account created after Nov 2023, the closed-test plan: at least 12 testers opted in for at least 14 continuous days on the Play closed testing track, running the real `nosms` release build (never wmbugo Lab), with testers from at least two market groups.

**Given** the closed test runs
**When** it ends
**Then** the file records start and end dates, the daily opted-in tester count (never below 12), the build versions served, and feedback received outside the app; a day with fewer than 12 testers restarts the 14-day count.

**Given** testers export Diagnostics at the end of the closed test (preview and consent, Story 8.10)
**When** local crash records are counted against app sessions
**Then** the crash-free session rate is recorded in `docs/release/<version>/stability.md` and must be ≥ 99.5% on the supported matrix (PRD §3.3), measured without any telemetry.

**Given** the gate ledger `docs/gates/README.md`
**When** the release candidate is assessed
**Then** it lists GATE-01 to GATE-13 (GATE-11 marked Phase 2, not required) each with owner role, evidence file, check used in place of an independent reviewer (PRD §24), status and date, including GATE-01 (P1 scope and personas signed; a CI check confirms no billing or entitlement code or Play Billing dependency) and GATE-10 (every story carries its requirement IDs and the coverage check of the epics shows no uncovered P1 requirement)
**And** the release checklist `docs/release/<version>/checklist.md` lists RB0-1 to RB0-9 and RB1-1, RB1-2, each linked to its evidence from Stories 14.2–14.9 and earlier stories (RB0-8 from Story 10.8 and 14.3).

**Given** any RB0 line red, or any RB1 line red without a dated product-owner waiver, or any required gate not signed
**When** promotion to production is attempted
**Then** the release pipeline refuses it and names the open items.

**Given** everything green
**When** the product owner promotes the build
**Then** the `nosms` build is released to all four market groups and, only if GATE-02 is approved, the `sms` build to India; the APK hashes in production equal those recorded in the evidence files, and the release is tagged with the version and the checklist link.

**Covers:** GATE-13, GATE-01, GATE-10, GATE-12 (final assets confirmed), RB0-1, RB0-2, RB0-3, RB0-4, RB0-5, RB0-6, RB0-7, RB0-8, RB0-9, RB1-1, RB1-2 (release sign-off)
