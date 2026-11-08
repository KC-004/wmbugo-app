# wmbugo — IDEA PRD

> **Status:** Proposed baseline for stakeholder approval and BMAD validation  
> **Document type:** Comprehensive product requirements / SDD input  
> **Platforms:** Android and iOS, built in parallel; Android releases in Phase 1, iOS testing/App Store review/release in Phase 2  
> **Date:** 17 October 2026 (rev. 1 November 2026)  
> **Product:** wmbugo — Private Money, Made Clear  
> **Primary locale:** India (English, INR); architecture internationalization-ready  
> **Authors of original source documents:** Aasil Ahamed and Praveen Kumar KC  
> **Change ownership:** Product owner must approve changes before treating this PRD as frozen  
> **Version:** 1.2.0-draft (see §24.1 change log)

## 0. How to use this document in BMAD

This document is intended as the **single consolidated product input** for BMAD's PRD validation, UX design, architecture, and epic/story decomposition. It is **not** a claim that the PRD is already validated or that there are zero implementation unknowns. Each normative statement uses **MUST**, **SHOULD**, or **MAY**. Critical product defaults have been resolved below; external approvals and technical feasibility gates are explicit.

**Source legend:** `[SRC]` = retained from supplied BRD/PRD/FRD/TSD/QA; `[FIX]` = corrected contradictory/unsafe source requirement; `[NEW]` = recommended missing requirement. Source IDs are mapped in §23. Architectural libraries are candidate selections, not immutable product requirements.

**BMAD handoff:** Use this file as reference input; run installed BMAD's `create-prd`/`validate-prd` or equivalent workflow according to its configuration. Generate separate `ux-design-specification.md`, `architecture.md`, and `epics.md`/stories after product review. Do not assume every BMAD version automatically ingests an `inputs/` folder: verify the installed workflow's input path or provide this file path explicitly.

---

## 1. Executive summary

wmbugo is a **private, offline-first personal finance application** that helps an individual understand balances, track income and expenditure, manage budgets, identify recurring costs, and make better spending decisions through **visual, accessible, actionable insights**. It should be useful without registration, internet, or SMS permissions. The Phase 1 Android release includes opt-in SMS transaction detection (subject to Play approval) and on-device receipt OCR; iOS uses shared manual, OCR and user-initiated import mechanisms and is tested, reviewed and released in Phase 2.

### 1.1 Product vision

**Understand where money goes, what remains, and what comes next—in seconds—without surrendering financial data to a cloud service.**

### 1.2 Problems to solve

- Logging every transaction manually is tedious; unrecorded purchases undermine trust.
- Text-heavy finance screens obscure patterns and increase cognitive load.
- People use multiple bank accounts, cash, UPI payment instruments, and cards; simple expense-only tables cannot represent their money correctly.
- Imported, scanned, and automatically detected payments often represent the *same* underlying transaction.
- Calendar-only budgets do not fit every pay cycle, and subscription costs are easy to overlook.
- Financial data is sensitive; users need clear local ownership, export, backup, and recovery.

### 1.3 Differentiators

1. Offline-first as a core behavior, not a temporary disconnected mode.
2. Visual-first dashboard with interactive drill-down and personalizable cards.
3. Trustworthy multi-account ledger with reconciliation and non-duplicating imports.
4. **Effortless capture:** automatic on-device SMS and bill capture confirmed with a single Approve/Reject, learning from every correction; manual entry remains as fallback.
5. Transparent, explainable insights rather than opaque AI recommendations.

## 2. Product decision register (resolved defaults)

| ID | Decision | Baseline | Reason / trade-off | Status |
|---|---|---|---|---|
| DEC-01 | Platforms | Shared codebase built for Android + iOS in parallel; **Android released in Phase 1**; iOS device testing, App Store review and release in Phase 2 | Faster launch with SMS/OCR capture on Android; iOS parity deferred | Product decision v1.1 (supersedes simultaneous launch) |
| DEC-02 | Connectivity | Entire financial core usable offline; no account or backend | Privacy and reliability | Retain `[SRC]` |
| DEC-03 | Identity | Guest/local profile only; optional display name, no email/phone | Near-zero onboarding | `[SRC]` expanded |
| DEC-04 | Ledger | Multiple accounts, explicit income/expense/transfer/adjustment, signed ledger postings | Prevent false balances | `[NEW]` mandatory |
| DEC-05 | Currency | INR initially; all monetary values stored in integer minor units; one reporting currency for v1 | Correctness and manageable scope | `[NEW]` |
| DEC-06 | Multi-currency | Out of scope for launch; data schema must not silently convert currencies | Avoid unverified FX rates offline | `[NEW]` |
| DEC-07 | SMS | Android-only opt-in feature in **Phase 1**, behind a policy-gated build variant; if Play approval is not granted by release, Phase 1 ships the no-SMS variant and SMS follows on approval | Core capture pain; store restrictions remain | Product decision v1.1 |
| DEC-08 | iOS automation | No general background SMS interception; manual entry, sharing/paste, document imports, and OCR | Platform limitations | `[FIX]` |
| DEC-09 | Import | User-initiated CSV import is MVP; PDF bank statements optional later after parsing-quality validation | Deterministic reviewability | `[NEW]` |
| DEC-10 | Receipts | On-device OCR in **Phase 1** (Android release; iOS implementation validated with iOS release in Phase 2); manual attachment always available as fallback | Reduce manual-entry burden at launch | Product decision v1.1 |
| DEC-11 | Budgets | Persistent definitions; period-scoped calculations; no destructive midnight reset; no rollover by default | Correct accounting | `[FIX]` |
| DEC-12 | Notifications | Local, permission-respecting, individually configurable; no alarm-like repeated spam | Trust | `[NEW]` |
| DEC-13 | Premium | Monetization (free + one-time premium hypothesis) moved to **Phase 2**; Phase 1 ships with all features free and no billing code | Requires store validation and usage evidence | Product decision v1.1 |
| DEC-14 | Backup | User-triggered encrypted local export/import; no automatic wmbugo cloud sync | Data sovereignty / recovery | `[NEW]` |
| DEC-15 | Privacy | No third-party behavioral trackers, ad SDKs, financial-event telemetry, or outbound financial-data transmission | Consistent offline pledge | `[SRC]` |
| DEC-16 | UX | Five primary destinations: Home, Activity, Add, Insights, Plan; Settings via header/drawer | Discoverability | `[NEW]` |
| DEC-17 | Accessibility | Screen readers, reduced motion, text scaling, non-color cues | Inclusive quality | `[NEW]` |
| DEC-18 | Accounts | Opening balance entered per account with an effective date; balances based on postings | Accurate initial state | `[NEW]` |
| DEC-19 | Credit card | Credit account with outstanding liability, payment as transfer; debt complexity deferred | Do not mislabel card payments as spend | `[NEW]` |
| DEC-20 | Split | One posted transaction may have many category allocation rows whose amounts reconcile | No double count | `[NEW]` |
| DEC-21 | Capture interaction | **Approve / Reject** is the single interaction for every automated capture (SMS, bill match); details edited only when the guess is wrong | Frequent dialogs become a chore; users are inconsistent | Product decision v1.2 |
| DEC-22 | Auto-approve | Captures from verified senders that the user does not act on are auto-approved at end of day (configurable time, can be disabled) with the guessed category; daily summary lists them | Capture the expense first; reconciliation is secondary | Product decision v1.2 |
| DEC-23 | Local learning | App learns merchant / UPI ID / bill item → category automatically from user corrections in Phase 1; learning is local, visible and editable | Effort must fall over time | Product decision v1.2 (supersedes "explicit rules only" in FIN-025/CAT-005) |
| DEC-24 | Rejected captures | Rejected captures are retained as `excluded`, shown greyed out, never counted, and can be re-approved later | Reversibility makes one-tap decisions safe | Product decision v1.2 |
| DEC-25 | Home-screen widget | Android home-screen widget (Snap bill / Add expense / pending approvals) in Phase 1 | Fastest capture entry point | Product decision v1.2 |

**External decision gates:** SMS permission approval; actual offline availability/licensing of OCR models on supported device versions; native encryption library security review; app-store in-app purchase treatment; jurisdiction-specific privacy/legal review; signing and store accounts. These cannot be guaranteed by a PRD.

## 3. Users, jobs-to-be-done and scenarios

### 3.1 Personas

- **Busy digital spender:** pays by UPI/card, wants passive or very fast capture and clear category views.
- **Privacy-focused professional:** refuses bank credential sharing, needs on-device processing and recovery controls.
- **Budget-conscious salaried user:** plans by payday, needs category limits and safe-to-spend indicators.
- **Cash/mixed-mode user:** carries cash and bank accounts, needs flexible manual tracking.
- **First-time finance tracker:** needs friendly empty states, onboarding, and explainable metrics.

### 3.2 Primary jobs

- Within seconds, tell me my known available funds, this month's spend, and budget headroom.
- Record or correct a payment with very little effort.
- Find, filter, and explain any past money movement.
- Know what I spent most on and whether that is rising or falling.
- Anticipate subscriptions, known bills, and budget risk.
- Export or restore my information without needing a service account.

### 3.3 Product success metrics (privacy-respecting)

No remote event tracking is permitted in v1. Evaluate these through **opt-in usability studies, voluntary anonymized feedback submitted outside the app, and local diagnostics visibly exported by users**—never covert financial telemetry.

| Metric | Initial target | Measurement |
|---|---|---|
| Onboarding time | Median ≤ 2 minutes to first usable Home screen | Moderated study |
| Manual entry | Median ≤ 15 seconds for returning-user expense entry | Usability study |
| Task completion | ≥ 90% first-attempt completion for add/edit/transfer tasks | Study with participants |
| Financial invariants | 100% pass in automated property and reconciliation tests | CI |
| App offline core | 100% required core tasks function without internet | Airplane-mode suite |
| Crash-free release | ≥ 99.5% test-session stability on supported matrix | Local test instrumentation / QA |
| Accessibility | No known blocker on prioritized flows | Manual and automated audit |
| User comprehension | ≥ 90% understand available balance versus budget remaining | Usability study |

The original BRD's >38% day-30 retention aim is an aspirational business metric, **not measurable in an air-gapped production app without an ethically designed opt-in method**.

## 4. Scope and release stages

### 4.1 MVP / Phase 1 — Android release (iOS built in parallel)

- Local no-login onboarding, theme, currency and privacy explanation.
- Accounts: bank, cash, payment wallet, credit card (liability) and optional archive.
- Opening balances and full income/expense/transfer recording; edit, reverse and categorize.
- Account-aware transaction list, search, filters, detail, bulk limited actions.
- Categories/subcategories, emoji-free accessible icon library, editable category colors.
- Home dashboard, core analytics, budget planning, customizable widget visibility/reorder.
- User-initiated CSV import with preview/mapping/deduplication and non-destructive review.
- Encrypted local datastore, app lock option, local notifications, encrypted export/restore.
- Manual recurring entries and bill reminders (automatic inference later).
- Baseline responsive layout, accessibility and full empty/error states.
- Manual receipt image attachment as fallback.
- On-device receipt OCR, itemized receipt parsing and matching to existing transactions.
- Optional Android SMS listener, shipped only in the Play-approved build variant; safe manual alternatives remain.
- Android offline QA, migration/recovery, security and Play Store release criteria.

### 4.2 Phase 2 / enhancement

- iOS device testing, App Store review and iOS release (including iOS OCR validation) to reach Android/iOS parity.
- Monetization: premium packaging if validated; iOS/Android consistent entitlement policy.
- Automatic recurring-payment suggestions, richer forecasts, spending heatmaps and advanced comparison charts.
- Rule-based categorization and customizable automation review thresholds.
- Document statement formats only when a reliable review flow exists.

### 4.3 Phase 3 / future

- Optional multi-currency and reliable rate-source strategy, advanced debt modeling, investment tracking, shared household spaces or optional sync (each requires a separate PRD and privacy reevaluation).
- No speculative AI assistant, bank-login aggregation, or cloud backend is in the present scope.

### 4.4 Explicit out of scope

Cloud identity, server sync, direct bank API integrations, screen scraping of banking apps, credential collection, general iOS SMS access, money movement/payment execution, credit scoring, tax filing, personalized investment advice, advertising/tracking monetization, multi-user collaboration and automatic third-party data upload.

## 5. Functional architecture and screen inventory

### 5.1 Primary navigation

- **Home:** personal financial snapshot; action-based configurable widgets.
- **Activity:** all ledger items, search, filters, review queue, transaction detail.
- **Add:** prominent central action opens entry sheet with Expense / Income / Transfer / Scan / Import. Platform unavailable functions appear with accurate explanatory text, never dead controls.
- **Insights:** chart workspace with a unified period/account/category/source filter model.
- **Plan:** Budgets, Bills & Recurring, Savings Goals, forecasts and upcoming commitments.

**Secondary navigation:** Header access to Accounts and Settings; a mobile drawer or grouped Settings hub may surface Categories & Rules, Automations, Statements & Exports, Backup & Restore, Privacy & Security, Diagnostics, About. Tablet uses navigation rail/sidebar when width allows. Back navigation follows OS conventions, state persists during brief tab changes, deep-linking never bypasses app lock.

### 5.2 Complete screen inventory

| ID | Screen | Required contents / behavior | Stage |
|---|---|---|---|
| SCR-01 | Welcome/privacy | Offline promise, optional onboarding skip | MVP |
| SCR-02 | Setup | Currency INR, payday, theme, defaults | MVP |
| SCR-03 | Create account | Type, name, opening balance, effective date | MVP |
| SCR-04 | Home | Balance, income, expenses, budget, charts, review badge | MVP |
| SCR-05 | Widget edit | Reorder, hide, reset, compact/full cards | MVP |
| SCR-06 | Account list/detail | Balance, activity, archive, account filters | MVP |
| SCR-07 | Activity | Chronology, group headers, search, filter chips | MVP |
| SCR-08 | Transaction detail | Type, account, category, provenance, notes, actions | MVP |
| SCR-09 | Add/edit sheet | Expense/income/transfer, validations, quick categories | MVP |
| SCR-10 | Review queue | Suggested duplicates/import checks, accept/dismiss | MVP |
| SCR-11 | Insight overview | Period picker, KPI summaries, key charts | MVP |
| SCR-12 | Insight drill-down | Interactive filtered chart and source transactions | MVP |
| SCR-13 | Plan hub | Budget cards, bills, savings targets | MVP |
| SCR-14 | Budget list/editor | Amount, scope, period, warnings, status | MVP |
| SCR-15 | Budget detail | Progress, category contributors, history | MVP |
| SCR-16 | Bills/recurring | Schedule, due date, reminders, confirmed status | MVP manual |
| SCR-17 | Savings goals | Goal amount, contributions, progress, optional reserve rules | MVP |
| SCR-18 | Categories | Add/edit/icon/color, inactive archive | MVP |
| SCR-19 | CSV import wizard | Preview, columns, account, duplicate review, commit | MVP |
| SCR-20 | Exports/backup | CSV export, encrypted backup/restore, warnings | MVP |
| SCR-21 | Settings | Locale, theme, security, alert preferences, accessibility | MVP |
| SCR-22 | Diagnostics | Local database/export status, optional permissions help | MVP |
| SCR-23 | Receipt OCR review | Itemization, totals, match existing transaction | MVP |
| SCR-24 | SMS permission/review | Pre-permission explainer ("what we keep" vs crossed-out OTP), status, capture review, OEM help | MVP Android, gated |
| SCR-27 | Capture dialog (floating) | Opens over the current app from a capture notification; category icon grid, batch cards, credit types, block sender | MVP Android |
| SCR-28 | Learned merchants & blocked senders | Edit/forget learned merchant, UPI ID and item categories; unblock senders | MVP |
| SCR-29 | Home-screen widget | Snap bill / Add expense / pending approvals count | MVP Android |
| SCR-25 | Automation rules | Merchant normalization, auto-categorization, exclusions | Phase 2 |
| SCR-26 | Advanced reports | Heatmap, forecasts, period comparisons, PDF export | Phase 2 |

### 5.3 Responsive rules

- Mobile portrait 320–430 logical px is baseline; layouts must adapt to narrow screens and large text.
- Tablet: optional two-pane Activity–Detail, rail and flexible widgets.
- Large-screen devices: preserve alignment and readable chart widths; no horizontal clipping.
- Landscape: keep core tasks usable; respect safe areas, dynamic island/notches, keyboard and gesture regions.

## 6. UX and visual design contract

### 6.1 Principles

1. **Visual before verbose:** strong numerals, bar/ring/sparkline chart, icons and compact statements; explanations available by tap.
2. **Progressive disclosure:** overview → filtered detail → individual transactions.
3. **Financial transparency:** every metric has a formula, period, account scope and drill-down.
4. **Correctness over delight:** never animate stale or approximate data as a confirmed balance.
5. **Trust over pressure:** alerts helpful, adjustable, never guilt-inducing; no dark patterns.
6. **Accessible by default:** color plus icon/text, touch targets, voice labels.
7. **Effortless capture:** the common case is one tap (Approve) or zero taps (auto-approve); every correction teaches the app so it asks less over time; every automated decision is reversible.

### 6.2 Design tokens — initial proposed palette

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg.canvas` | `#F8FAFC` | `#0F172A` | App background |
| `bg.surface` | `#FFFFFF` | `#1E293B` | Cards/sheets |
| `text.primary` | `#0F172A` | `#F8FAFC` | Main values |
| `text.secondary` | `#475569` | `#CBD5E1` | Explanations |
| `accent.primary` | `#0F766E` | `#5EEAD4` | Selection/primary action |
| `semantic.income` | `#15803D` | `#86EFAC` | Positive inflow |
| `semantic.expense` | `#B91C1C` | `#FDA4AF` | Outflow |
| `semantic.transfer` | `#1D4ED8` | `#93C5FD` | Account-to-account |
| `semantic.warning` | `#B45309` | `#FCD34D` | Limits/due soon |
| `semantic.info` | `#6D28D9` | `#C4B5FD` | Recurring or informational |

Tokens are subject to WCAG AA testing (small text ≥4.5:1; non-text UI where applicable ≥3:1). Chart series use perceptually distinct palette, labels, and patterns when necessary; warning/red not used as the only signal. Allow System/Light/Dark and user accent selection after core QA. No arbitrary user-entered colors without contrast validation.

**Core component library:** screen shell, app bar, bottom tabs, tablet rail, expandable grouped drawer, universal amount text, category icon, balance tile, KPI card, progress bar, donut/ring, area/bar charts, segmented control, date range picker, account/category chips, filters sheet, amount keypad, selection sheet, search, transaction row, empty state, skeleton, toast, alert, confirmation dialog, bottom sheet, icon button, privacy shield and error retry.

**Design scale:** 4-point spacing grid, 8–16dp corner radii according to hierarchy, 44pt iOS / 48dp Android minimum preferred primary touch target, dynamic type, reduced-motion animations, meaningful haptics only when enabled; animation duration typically 150–250ms without blocking inputs.

### 6.3 Dashboard composition (initial order)

1. Greeting + date/payday chip + settings/notification controls.
2. Combined known available assets and optional account selector; outstanding credit liabilities explicitly separate.
3. Income and expense cards for chosen period; net cash flow chip.
4. Budget ring: used vs remaining with overspend state and due days.
5. `Safe to spend` card only if its input completeness gate passes; otherwise show *insufficient data*.
6. Category spending ranked horizontal bars with icons.
7. Trend sparkline or 7-day bar.
8. Upcoming bill/subscription, savings goal and review queue.
9. Quick Add visible throughout scroll where practical.

Each card supports tap-to-details (where applicable) and a clear period label. User can hide/reorder supported cards and restore defaults. Data refreshes on database changes, app resume, filter changes and device date change.

### 6.4 Mandatory interaction states

Every screen **MUST** specify in its UX deliverable: `initial`, `loading`, `empty`, `populated`, `error`, `partial/import-review`, `permission-denied`, `read-only` where relevant, `confirmation`, `success`, `offline` (if relevant). Charts with <2 comparable points must not invent trend direction. Missing account information must not be displayed as ₹0 unless genuinely zero.

### 6.5 Navigation and filter behavior

- Selected period persists when navigating Insights subviews; changing global filter updates relevant KPI and chart labels.
- Filtering Activity does not change Home balances unless Home explicitly receives that account/period context.
- Date presets: Today, Yesterday, 7 days, This month, Last month, This quarter, This year, Custom; custom endpoints inclusive in the user's configured timezone.
- Filters: account, type, category/subcategory, merchant, amount range, source, status, payment method and tags (if present).
- Search indexed by merchant, note, category, reference, amount; never send search strings off-device.
- Clear filters and show active-filter count; saved filter presets are Phase 2.

## 7. Core financial model and invariants

### 7.1 Money representation

**FIN-001:** Store amounts in signed **integer minor units** (paise for INR); UI displays locale-formatted rupees. Reject NaN, infinity, overflow, negative input where an absolute magnitude is expected, and >2 decimal places unless explicitly rounded with user confirmation. Never use IEEE floating-point `REAL` for currency persistence.

**FIN-002:** Store transaction effective time as UTC instant plus chosen local timezone/offset for grouping; support date-only items such as planned bills separately. Historical accounting period grouping uses the user's effective timezone setting, with a clearly defined recalculation effect after timezone changes.

**FIN-003:** Distinguish `expense`, `income`, `transfer`, `opening_balance`, `adjustment`, `refund`, and `reversal` in the domain. UI can simplify types, but storage must retain intent and provenance.

### 7.2 Accounts and balances

**FIN-010:** Account types: cash asset, bank asset, payment wallet asset, credit-card liability. Each has stable ID, name, icon/color, currency INR, opening balance and effective date, active/archive status.

**FIN-011:** Asset account balance = opening balance + net asset postings. Credit card outstanding = opening liability + charges - payments - credits; show as money owed, **not** a negative cash balance silently mixed with assets.

**FIN-012:** User-defined known-funds dashboard value is the sum of included **asset** accounts; do not treat credit limit as available money. Net worth may separately calculate assets minus known liabilities, labeled clearly and optional.

**FIN-013:** Transfers between owned accounts create balanced atomic postings; **never** count as earned income or spent expense. Cash withdrawal and paying a card bill are transfers when both accounts are modeled.

**FIN-014:** Editing or reversing a confirmed event updates postings, analytics and budgets atomically. No physical delete without audit/recovery strategy; soft-delete/reversal preferred with user-visible undo.

**FIN-015:** Archived accounts preserve history and balances; accounts with historical postings cannot be hard deleted. Balance corrections are explicit auditable adjustments, never silent replacements.

### 7.3 Transactions, splits, refunds

**FIN-020:** Each transaction includes `id`, `type`, `status`, integer amount, currency, effective_at, created_at, updated_at, account posting links, category splits, merchant/payee, payment method, optional reference/notes/tags, source metadata, and optional attachment link.

**FIN-021:** Expenses decrease assets or increase liabilities; income increases assets or reduces liabilities only where explicitly appropriate; refunds reverse the related outflow and show as refund, not ordinary salary income.

**FIN-022:** Sum of a transaction's category allocations **must equal** its categorisable absolute amount. Parent receipt total must equal sum of items plus taxes/fees minus discounts and adjustments within a documented tolerance (exact paise after rounding allocations). Missing OCR items are handled by explicit *unallocated amount*, never ignored.

**FIN-023:** Reimbursement may be represented as a refund/recovery linked to original expense; show both net and gross filters when possible, avoiding double subtraction.

**FIN-024:** Transaction status values: `draft`, `needs_review`, `confirmed`, `excluded`, `reversed`, plus `possible_duplicate` review flag. Only confirmed non-excluded items contribute to headline totals; provisional review counts shown separately. A captured item awaiting Approve/Reject is `needs_review`; Approve (or end-of-day auto-approve, DEC-22) sets `confirmed`; Reject sets `excluded`. Excluded captures remain visible greyed out and can be switched back to `confirmed`, updating balances atomically (FIN-014).

**FIN-025:** `Merchant` normalization is editable and retains original source strings. User corrections supersede auto-categorization and are learned locally per LRN-001–LRN-006 (visible, editable, never transmitted).

### 7.4 Ledger integrity acceptance rules

- For any internal transfer, combined owned-asset posting sum is zero, ignoring separately explicit fees.
- For any split, allocation sum matches categorisable amount exactly.
- Importing same file twice must not duplicate confirmed entries.
- OCR of an existing SMS/manual expense must not automatically create a second confirmed expense.
- Opening balance and later adjustment must be distinguishable from income in charts.
- Expenses, refunds, reversals, and credit-card payments reconcile across charts and accounts.
- Large-value and repeated edits must not introduce rounding drift.
- All ledger mutations are transactional with integrity validation and rollback.

## 8. Functional requirements — detailed modules

### 8.1 Onboarding and initial configuration (ONB)

- **ONB-001 [SRC]:** App opens without registration, phone number, email, or network.
- **ONB-002 [NEW]:** First-use screens show privacy proposition, optional theme selection, default currency INR, and start-of-budget/payday preference.
- **ONB-003 [NEW]:** Create first account with type, name and opening balance; allow skip, but Home shows *balance not configured* instead of implying financial accuracy.
- **ONB-004 [NEW]:** Permission prompts are contextual and just-in-time; never request SMS/photo/notification permissions as an onboarding requirement.
- **ONB-005 [NEW]:** Show a guided test transaction/visual tutorial without entering fake data into actual finances.
- **ONB-006 [NEW]:** Settings permit later changes; changing budget period triggers reaggregation, not transaction mutation.

**Acceptance:** fresh install in Airplane Mode → usable Home, add account and manual expense; denied permissions → same essential paths; empty-state calls to action complete.

### 8.2 Accounts (ACC)

- **ACC-001:** Create, rename, reorder, hide/archive and view accounts.
- **ACC-002:** Configurable opening balance/date, account-level transaction timeline and account-local reconciliation adjustment with reason.
- **ACC-003:** Credit card shows outstanding, statement due date and optional limit; do not imply an actual bank connection.
- **ACC-004:** On closing/archive warn about nonzero balances or pending transfers; retain history.
- **ACC-005:** Include/exclude eligible account assets from overview while retaining explicit label, preventing misleading totals.

**Acceptance:** account detail total equals ledger-derived balance on every edit, reversal, import and transfer; archived accounts remain searchable.

### 8.3 Transaction CRUD, search and review (TXN)

- **TXN-001:** Quick Add type chooser: Expense / Income / Transfer; user can also attach receipt, scan if supported, or import.
- **TXN-002:** Expense form: numeric amount, account, category, optional merchant, date/time, note, payment method, receipt attachment; default to last appropriate selections when safe.
- **TXN-003:** Income form: amount, destination account, income category/source and optional note.
- **TXN-004:** Transfer form: from + to, distinct accounts, amount, date/time, optional fee as separate expense; reject self transfer and insufficient available funds only if user opts into a balance-enforcement rule (otherwise warn about possible mismatch).
- **TXN-005:** Edit, duplicate-as-new, reverse, exclude and undo; no deceptive irreversible action.
- **TXN-006:** Activity timeline groups by date with direction icon/color, merchant, category, amount, account and status.
- **TXN-007:** Full-text/local indexed search; combinable filter sheet; sort newest/oldest/highest amount/merchant; pagination/virtualization.
- **TXN-008:** Review queue holds ambiguous imports, suspected duplicates and unclassified transactions; user can confirm, link to existing, exclude or correct.
- **TXN-009:** Create split allocations among categories with strict sum reconciliation, including an *unallocated* placeholder while editing.
- **TXN-010:** Bulk recategorization of confirmed transactions requires preview and undo; never silently change finance amounts.
- **TXN-011:** Receipts and source metadata survive edits without duplicate attachments; user can detach/delete images explicitly.

**Acceptance:** first-time and returning flows tested for ≤15-second median expense entry; filtered totals reconcile with underlying records; no double count on status change.

### 8.4 Category management (CAT)

- **CAT-001:** Seed sensible categories: Food & Drinks, Groceries, Transport, Housing, Bills & Utilities, Shopping, Healthcare, Entertainment, Education, Travel, Personal Care, Family, Other; income categories Salary, Freelance, Gifts, Interest, Refunds (refunds still typed distinctly).
- **CAT-002:** User can add/rename/reorder/archive categories and subcategories, choose icon and accessible color.
- **CAT-003:** Category types prevent accidental use of expense-only categories as income without an explicit mixed-use choice.
- **CAT-004:** Archive/merge requires remap preview, history preservation and no destruction of original source metadata.
- **CAT-005:** Default automated category suggestion can be overridden per transaction; automatic learning from corrections is Phase 1 (LRN); a user-authored rule editor (SCR-25) is Phase 2.

### 8.5 Budgets and financial planning (BDG)

- **BDG-001 [FIX]:** Define budgets as persistent rules with monthly, weekly, custom date-range or payday-aligned periods. Do not reset ledger balances at 00:00 on month change.
- **BDG-002:** Budget targets may be overall or scoped to categories and optionally accounts; prevent ambiguous overlapping budgets from being combined into a single total without labeling.
- **BDG-003:** Show used, remaining, percentage, days remaining, projected spend and status: on-track, nearing limit, exceeded, insufficient-data.
- **BDG-004:** Threshold alerts at configurable percentages, suggested defaults 75%, 90%, 100%, with per-budget mute controls and no duplicate alerts.
- **BDG-005 [SRC/FIX]:** No rollover by default; prior budget period records remain queryable, and switching periods is derived from transaction dates. Optional rollover is **future** and must not be implemented implicitly.
- **BDG-006:** Define effect of expenses, refunds, transfers, exclusions, and edits on budget used (expense minus linked refunds; transfers excluded by default).
- **BDG-007:** Allow target edits effective now or next period, preserving historical version information and recalculating carefully.
- **BDG-008:** `safe_to_spend` may appear only if user designates applicable asset accounts and all known obligations; formula: `max(0, min(budget_remaining, included_available_assets - reserved_known_obligations))`; label as *estimate based on entered data*, not a guarantee.

**Acceptance:** previous-period and future-period records unaffected by app being closed at midnight; timezone change recalculation tested; balances never zeroed by budget rollover.

### 8.6 Recurring payments, subscriptions and bills (REC)

- **REC-001:** Manual recurring rule with merchant/title, expected amount, cadence (weekly, monthly, quarterly, annually or custom), account, next due date, category, end/pause state and optional notification.
- **REC-002:** Mark a bill as planned versus actual confirmed transaction; planned bills do not affect actual balances or expense totals.
- **REC-003:** Scheduled local reminders require permission; do not assume guaranteed exact-time delivery on all platforms.
- **REC-004:** A confirmed linked payment advances the next expected occurrence exactly once; cancellations preserve history.
- **REC-005 [FIX] Phase 2:** Automatic inference from transaction recurrence using time windows, normalized merchants and amount tolerance; produce `suspected` state and confidence/explanation, **not** auto-confirmation.
- **REC-006:** Detect monthly calendar patterns carefully (e.g., Jan 31 → Feb end-of-month) rather than fixed 28–31-day intervals only.
- **REC-007:** Distinguish subscriptions from rent, EMIs or repeated purchases and allow user to reject suggestions permanently or temporarily.
- **REC-008:** Subscription page includes upcoming timeline, total monthly-equivalent cost (conversion clearly labeled), and past charges.

### 8.7 Savings goals (GOAL)

- **GOAL-001:** Create target name, target amount, optional due date, icon/color and optional assigned account.
- **GOAL-002:** Contributions may be virtual earmarks or actual account transfers; UI MUST distinguish them. Virtual allocation does not create spend or alter actual account balance.
- **GOAL-003:** Show progress, remaining amount, current pace and projected completion only when adequate data exists.
- **GOAL-004:** Edit/pause/complete/archive preserves historical allocations; prevent double-counting reserved money across goals and bills.

### 8.8 Home dashboard and widgets (HOM)

- **HOM-001:** Primary widgets: known available funds, current-period income, expenses, net cash flow, budget ring, top categories, 7-day trend, review queue, upcoming bills, savings goal.
- **HOM-002:** Show icons plus semantic color and numerical values; every supported card navigates to filtered detail.
- **HOM-003:** User can reorder, hide, show, choose card size where supported, and restore layout.
- **HOM-004:** Widgets refresh on transaction, settings or period changes, including foreground resume; indicate stale/partial data when recomputation is pending.
- **HOM-005:** Financial values display a timeframe and eligible-account scope; charts display no fabricated history.
- **HOM-006:** Quick Add remains discoverable without covering key navigation/accessibility controls.
- **HOM-007 (Android, Phase 1):** Home-screen widget (SCR-29) with Snap bill, Add expense and pending-approvals count; respects app lock (opening a capture behind lock requires unlock) and shows no amounts unless the user enables it.

### 8.9 Insights and analytics (INS)

**Shared analytics requirements:**

- **INS-001:** Presets Today, 7 days, This month, Last month, Quarter, Year, Custom; cross-filter account, category, merchant, transaction type, tags and source where meaningful.
- **INS-002:** Charts allow accessible numeric summaries, screen-reader data table alternatives and drill-down into contributing transactions.
- **INS-003:** All aggregations use confirmed financial events and posted category allocations; exclude transfers and unconfirmed import candidates from spending unless explicitly requested.
- **INS-004:** Compare like-for-like periods, label partial current period and previous period consistently.
- **INS-005:** Values in INR, inclusive start/exclusive end interval semantics internally, correct dates/timezones, signed and refund treatments documented.
- **INS-006:** Empty/minimal data shows safe prompts rather than false insights. Users can export underlying data.

| ID | Chart / insight | Visualization | Definition / primary interaction | Phase |
|---|---|---|---|---|
| INS-010 | Expense trend | Line/area chart | Confirmed net spending per day/week/month | MVP |
| INS-011 | Income vs expense | Grouped bars | Inflow, outflow, net cash flow by period | MVP |
| INS-012 | Category distribution | Donut + ranked horizontal bars | Category expense allocations divided by eligible total | MVP |
| INS-013 | Category budgets | Progress bars | Budget used/target, overage, remaining | MVP |
| INS-014 | Top merchants | Ranked bars | Net spending by normalized merchant | MVP |
| INS-015 | Spending change | Comparison tiles + directional arrows | `(current - previous) / abs(previous)` only if previous ≠ 0; otherwise “new/no baseline” | MVP |
| INS-016 | Savings rate | Gauge + trend | `(income - expenses) / income` when income > 0; clearly *cash-flow surplus rate*, not formal savings accounting | MVP |
| INS-017 | Payment methods | Donut | Share by tagged payment method; unknown separate | Phase 2 |
| INS-018 | Day-of-month heatmap | Calendar | Spending intensity, legend and exact value detail | Phase 2 |
| INS-019 | Fixed vs variable | Stacked bars | User rules classify; unknown separate | Phase 2 |
| INS-020 | Needs vs wants | Segmented bar | User-configurable tags; no universal moral labeling | Phase 2 |
| INS-021 | Projected month-end | Forecast line/band | Actual-to-date + simple rate projection + known bills; uncertainty label | Phase 2 |
| INS-022 | Subscription timeline | Timeline | Expected due dates and actual matching payments | Phase 2 |
| INS-023 | Transaction frequency | Histogram | Count and size bands of eligible transactions | Phase 2 |
| INS-024 | Year-on-year comparison | Monthly bars | Identical month periods; missing data explicit | Phase 2 |
| INS-025 | Savings-goal progress | Goal rings | Explicitly assigned allocations versus target | MVP |

**Insight cards and explainability:** Every narrative inference must display formula, baseline, source count and timeframe on drill-down. An increase in expenses is not intrinsically “bad.” Forecast accuracy assessed against later actuals in local tests, without collecting private data.

### 8.10 CSV import and statement export (IMP)

- **IMP-001:** File picker reads a local CSV selected by user; supports UTF-8 and common quoted field formats; detect but allow correction of delimiter/header/date/amount mapping.
- **IMP-002:** Preview 20+ rows where available; map account, date/time, description, debit/credit (or signed amount), currency, merchant and reference; refuse or isolate unsupported currency.
- **IMP-003:** Validate date, numeric fields, balance sign and duplicate candidates before commit. Mark every ambiguous row for review.
- **IMP-004:** Match against existing ledger using stable bank reference when available; otherwise fuzzy merchant/date/amount with review, not silent auto-merge.
- **IMP-005:** Import is transactional per manageable batch; partial failures reported by row with retry/export-error options. Re-import same batch must be idempotent.
- **IMP-006:** Raw imported data is kept only as necessary for traceability with configurable deletion of stored source files; no cloud upload.
- **IMP-007:** Exports: transaction CSV and account summary CSV; include period/filter context, timezone, version/schema metadata; hide/mask account identifiers as configured.
- **IMP-008:** PDF reports Phase 2 with visual summary, chart alternatives and correct account scope.

### 8.11 Receipt attachments and OCR (OCR)

- **OCR-001 MVP:** Attach local receipt image/document through OS-controlled picker, optionally camera with permission; compress safely and maintain original source provenance.
- **OCR-002 MVP [SRC]:** Perform character recognition fully on device, with offline-ready model availability confirmed; show unavailable/dependency error honestly when model absent.
- **OCR-003 MVP [FIX]:** Group OCR bounding boxes using true midpoint `(top + bottom)/2`, line-order, adaptive tolerance, multi-column detection and number locale.
- **OCR-004:** Extract merchant, date, currency, subtotal, tax, fee, discount, total, product line items and price; show uncertainty per field.
- **OCR-005:** User can correct every parsed field and split item categories. Parent total reconciles exactly and unallocated discrepancy is explicit.
- **OCR-006:** Receipt scan offers *attach to existing transaction* first on probable match; avoid double-spend.
- **OCR-007:** Image parsing fails gracefully on low contrast, handwritten, tilted, cropped or multilingual receipts; manual fallback available.
- **OCR-008:** Do not assert fixed 3-second completion on every supported device; benchmark target is p95 ≤ 5 seconds for standard single-page printed receipts on defined reference hardware, with cancellation/progress.
- **OCR-009:** Entry points: camera in the Add flow, gallery image pick in the Add flow, and the home-screen widget (HOM-007). Automatic detection of new photos/screenshots is not required.
- **OCR-010:** When a scanned bill probably matches an existing SMS/manual entry, ask with Approve/Reject (e.g. "Matches ₹1,800 HDFC debit at 6:12 pm — attach?"). Approve attaches the bill and its items to that entry; Reject saves it as a separate expense. Never auto-attach silently.
- **OCR-011:** A bill with no match is recorded directly as an expense, defaulting to the Cash account (editable). If a matching SMS arrives later, offer an Approve/Reject merge.
- **OCR-012:** Itemized bills: each line item can carry its own category (e.g. supermarket groceries vs notebooks), feeding per-category weekly/monthly reports via splits (FIN-022). Item categories are learned per LRN-004.
- **OCR-013:** Capture notifications for mixed-category merchants (LRN-003) offer a "Snap bill to split" action that opens the camera and links the result to that entry.

> **Delivery risk:** itemized OCR (OCR-012) and item learning are the hardest Phase 1 items given varied Indian bill layouts. If Phase 1 timing is at risk, they are the first fast-follow candidates; total/merchant/date extraction remains Phase 1.

### 8.12 Optional Android SMS ingestion (SMS, Phase 1, policy gate)

- **SMS-001 [SRC/FIX]:** Android app **may** expose native financial SMS detection *only when Play policy eligibility, permission declaration and approval are verified*. Build/release variants without approved permission MUST NOT declare disallowed SMS permissions in manifest.
- **SMS-002:** Explicit, contextual disclosure states categories of messages accessed, financial fields retained, local-only processing and how to disable; request only necessary permissions after consent.
- **SMS-003:** Parse inbound debit, credit, refund, reversal and account transfer indicators, currency, amount, merchant, reference, masked account and timestamp; unknown parsed values remain unconfirmed.
- **SMS-004:** On-device processing, no transmission of SMS content. Minimize retained raw body, encrypt if retained, define retention period; never ingest nonfinancial messages into user ledger.
- **SMS-005:** Reconcile against user-confirmed transactions, imports and OCR; ambiguous matches go to review queue.
- **SMS-006:** Notification review may provide quick classification but cannot circumvent consent/notification rules; alert rates are configurable.
- **SMS-007:** OEM diagnostics report only verifiable permissions and app background state, with help text. Never claim a permanent daemon or universal auto-start bypass.
- **SMS-008:** Permission denial/revocation/Play rejection leaves app fully functional. No policy-circumventing accessibility, notification, clipboard or SMS scraping substitutes.
- **SMS-009:** Automated tests use consented fixtures; real financial data not embedded in repo or diagnostic logs.
- **SMS-010:** Capture both debit and credit SMS. Parse only messages from registered alphanumeric bank/UPI sender headers (e.g. `XX-HDFCBK`); messages from ordinary phone numbers are never treated as transactions. OTP content is never retained.
- **SMS-011:** Scam warning: a transaction-like SMS containing links or claim/refund/KYC/prize wording, or a credit from an unverified sender, shows "This looks like a scam — not added" and is never posted.
- **SMS-012:** Balance-chain check: when SMS include an available balance, compare with the previous SMS balance for that account; a mismatch flags the capture as suspicious and it is not auto-approved.
- **SMS-013:** Block sender: every capture notification and dialog offers "Not a transaction · Block sender"; blocked senders are listed in SCR-28 and can be unblocked.
- **SMS-014:** Permission onboarding: show the explainer (SCR-24) before the OS prompt. After "Not now", re-ask at most twice, ≥7 days apart, as a dismissible Home card triggered by value (e.g. after the 5th manual entry); afterwards only via Settings. If SMS is unavailable, manual entry and OCR remain the capture paths.

Official policy checkpoint: https://support.google.com/googleplay/android-developer/answer/10208820

### 8.13 Settings, personalization, local notifications (SET)

- **SET-001:** Appearance: System/Light/Dark, optional accent themes, number formatting, text-size/system scaling, haptic/reduced-motion preference.
- **SET-002:** Finance: currency (INR v1), timezone, first day of week, default period, payday, default account, budget thresholds, missing-data policy.
- **SET-003:** Notifications: per-type opt-in, due reminders, budget warnings, unreviewed import/SMS badges; clear snooze/mute controls and reasonable frequency caps.
- **SET-004:** Data: encrypted backup/restore, CSV export, storage use, retention, data wipe with double confirmation.
- **SET-005:** Privacy: app lock biometrics/PIN, blurred background snapshot, privacy explanations, optional hide-balances toggle.
- **SET-006:** Diagnostics: local version/schema/storage/permissions status, non-sensitive test parsers, export sanitised diagnostics with explicit preview and consent.
- **SET-007:** Help: offline FAQ, accessible glossary, simple “how totals are calculated” screens, about/licensing.

### 8.14 Local encrypted backup, restore and migration (BKP)

- **BKP-001:** Export versioned encrypted backup containing database, attachments and settings with manifest and integrity checksum; ask user to set a strong passphrase or platform-safe key strategy and clearly explain recovery implications.
- **BKP-002:** Restore must validate format/version/checksum, obtain credentials, preview effects, create pre-restore safety snapshot if feasible, and commit atomically.
- **BKP-003:** Wrong passphrase/corrupt/incompatible file cannot overwrite working data; show actionable error.
- **BKP-004:** Data copy must not be unencrypted temporary artifacts in public folders; securely manage temp files according to platform capability.
- **BKP-005:** Versioned migrations execute transactionally; support forward-compatible read policy and user-safe failure recovery.
- **BKP-006:** Device backup settings must not silently send sensitive app files to OS cloud backups if strict no-cloud promise is active; configure backup exclusion policies and document user-initiated file-provider export behavior.
- **BKP-007:** Exporting to external file provider is **user-initiated** and may leave device (e.g., OS share sheet); privacy UI must explain this clearly instead of falsely claiming bytes can never leave under any circumstances.

### 8.15 Security and privacy (SEC)

- **SEC-001:** Financial records reside locally in authenticated encrypted-at-rest storage, using verified cryptographic implementation and device-protected key handling; no hardcoded keys.
- **SEC-002:** No mandatory internet calls, cloud analytics, ad trackers or unreviewed SDK telemetry; privacy audit verifies network traffic in representative flows.
- **SEC-003:** Minimum system permissions, contextual rationale, graceful denial, ability to revoke via OS.
- **SEC-004:** App lock option uses biometric/OS-backed mechanism with device passcode fallback consistent with threat model; lock upon resume after configurable timeout.
- **SEC-005:** Hide sensitive values in app switcher and on lock screen; notifications have privacy-preserving contents by default. Exception: the user may opt in (setting, off by default) to show amount and merchant with Approve/Reject on the lock screen (CAP-006).
- **SEC-006:** Validate file types, size, dangerous path injection, spreadsheet formula injection in exports, corrupted data and malicious archive payloads.
- **SEC-007:** Redact SMS, financial amounts, account identifiers, images and notes in logs/crash diagnostics.
- **SEC-008:** Deleting data requires clear scope and irreversible-loss warning; encrypted backups are separate copies.
- **SEC-009:** Consent/disclosure and store privacy labeling must accurately reflect actual build behavior; legal review before publication.

### 8.16 Capture review interaction (CAP, Phase 1 Android)

- **CAP-001:** Each automated capture posts a notification with minimum details — amount, direction, merchant, account, guessed category — and **Approve / Reject** actions. Approve confirms; Reject excludes (DEC-24).
- **CAP-002:** Tapping the notification body opens the floating capture dialog (SCR-27) over the current app. Implement as a dialog-styled activity launched from the notification; do **not** require the draw-over-other-apps permission.
- **CAP-003:** The dialog shows a grid of category icons ordered by this merchant's history, then overall frequency; one tap saves and closes; long-press opens subcategories. Unknown merchants use the same Approve/Reject notification and the dialog collects details.
- **CAP-004:** Credit captures offer income types: Salary, Refund, From a person, Moved from my own account (recorded as a transfer, not income).
- **CAP-005:** Multiple pending captures collapse into one updating grouped notification ("3 new transactions · ₹1,240"); the dialog presents them as swipeable cards and offers "Apply to all similar" for repeated merchants.
- **CAP-006:** Lock-screen Approve/Reject is available as an opt-in setting, off by default (SEC-005).
- **CAP-007:** Unactioned captures auto-approve at end of day per DEC-22, except captures flagged by SMS-011/SMS-012; an evening summary lists auto-approved items with a review link.
- **CAP-008:** Activity shows rejected captures greyed out behind a "Show rejected" filter (off by default); status can be changed later from transaction detail.

### 8.17 Local learning (LRN, Phase 1)

- **LRN-001:** When the user categorizes an unknown merchant (via notification, dialog or app), later captures from that merchant are pre-categorized; the notification shows the result with a Change option.
- **LRN-002:** When an SMS has no merchant name, learn on the payee UPI ID; the user can name the payee once (e.g. "Ravi Tea Stall").
- **LRN-003:** A merchant that has received two or more different categories is marked mixed: the app stops auto-categorizing and offers that merchant's past categories as one-tap choices.
- **LRN-004:** Bill line items learn categories the same way (e.g. notebook → Education, milk → Groceries).
- **LRN-005:** The dialog shows a "Remember for this merchant" toggle (default on); SCR-28 lists everything learned with edit/forget.
- **LRN-006:** All learning is on-device, never transmitted, included in encrypted backup, and never changes amounts — only category suggestions.

## 9. End-to-end UX flows

### FLOW-01: Fresh installation

Welcome → privacy summary → optional theme/payday → create/skip first account → Home empty/populated. At every step the user can go back safely. On skipped account, show “Set up an account to calculate your balance.”

### FLOW-02: Manual expense

Home/Add → choose Expense → amount → category → account → optional merchant/date/details → Save → success + Undo → Home/Activity totals update. If missing required info, inline error retains data; no extra save.

### FLOW-03: Income

Add → Income → amount → destination account → source category → Save → account and net cash flow update; excludes transfers/adjustments.

### FLOW-04: Transfer and credit-card payment

Add → Transfer → source & destination accounts → amount → optional fee → confirmation → atomic postings → Activity displays one linked transfer, account details display both legs, Insights income/expense unaffected except separate fee.

### FLOW-05: Search/edit/split

Activity → filters/search → Detail → edit or split → validate exact paise allocation → Save → derived cards/charts refresh → Undo/reversal path available.

### FLOW-06: Budget

Plan → Add budget → period, categories, target, alert thresholds → live progress → notification on threshold once per period → budget detail filtered contributing transactions.

### FLOW-07: CSV import/reconciliation

Activity/Import → choose file → map fields → preview → possible duplicates → confirm actions → atomic commit → summary of imported/skipped/needs-review → navigate to Review Queue. Retry of same file does not duplicate prior accepted entries.

### FLOW-08: Receipt OCR (Phase 1)

Add/Scan → camera/file picker → local OCR → editable extracted merchant/date/line items/totals → find matching existing transaction → attach or create → assign categories → verify reconciliation → confirm.

### FLOW-09: Android SMS (approved feature only)

Explainer (SCR-24) → OS permission → bank SMS arrives from verified sender → local parse, scam/balance checks and dedup → learned category applied → notification with Approve / Reject (grouped if several) → Approve confirms, Reject excludes (greyed, reversible), tap opens floating dialog to edit category/details → ignored items auto-approve at end of day → ledger update. Blocked senders are skipped. At denial or failed parsing, manual entry and OCR remain available.

### FLOW-10: Backup & restore

Settings → Backup → passphrase/target selection → encrypted file export → success plus local warning; Restore → select file → verify and preview → confirm → transactional restore → integrity check → Home.

### FLOW-11: Insight to source

Insights → change period/account/category → chart updates with labels → select bar/segment → filtered Activity → transaction detail → back restores filter selection.

### FLOW-12: Privacy lock

Settings → Enable app lock → OS auth confirmation → lock on configured timeout → unlock or recovery through device authentication; app snapshot obscures sensitive data.

## 10. Calculation and business rules glossary

| Term | Normative meaning |
|---|---|
| Transaction | A recorded economic event with intent, provenance and postings |
| Account balance | Sum of starting balance + applicable postings, by account |
| Known available funds | Sum of included active asset account balances; **not** net worth and not guarantee of actual bank data |
| Income | External inflow categorized as income, excluding transfers/opening/adjustments |
| Expense | Net user spending after related refunds, excluding transfers |
| Cash flow | Income minus expenses for a period; may not equal balance change due to transfers/adjustments |
| Budget used | Confirmed eligible expenses minus linked refunds in budget period |
| Budget remaining | Budget target − budget used; can be negative |
| Percent used | Used / positive target × 100; handle target = 0 separately |
| Safe to spend | Conservative estimate limited by eligible budget headroom and included funds minus reserved obligations |
| Subscription candidate | Heuristic suggestion requiring user confirmation |
| Confirmed recurring rule | User-approved schedule for expected payments, not automatic actual ledger spending |
| Savings goal progress | Assigned money/contributions according to explicit virtual-vs-actual rule |
| Insight baseline | Comparable prior complete/partial period chosen and labeled |
| Review queue | Incomplete/ambiguous entries excluded from definitive analytics until confirmed |
| Pending capture | An automated capture awaiting Approve/Reject; excluded from headline totals until approved or auto-approved |
| Mixed merchant | A merchant the user has assigned 2+ categories; the app offers choices instead of guessing |
| Merchant alias | Locally mapped source name to canonical merchant entity |

**Rounding:** Integer paise; percentages are derived from exact integer totals and rounded only for display; category percentages may sum to 99%/101% due to rounding, and UI should acknowledge/remainder-adjust visually without changing underlying values.

**Period management:** No cron/midnight reset dependency. Aggregations derive from effective transaction dates on demand and are cached/incrementally updated as appropriate. Month change in Home occurs on next render/resume even if OS suspends tasks.

## 11. Data model requirements (logical, architecture to refine)

### 11.1 Entities

- `account(id, name, type, currency, opening_minor, opening_effective_at, include_in_overview, status, timestamps)`
- `transaction(id, event_type, status, amount_minor, currency, occurred_at_utc, local_date, timezone_id, merchant_id?, original_description?, note?, reference?, created_at, updated_at, reversed_by_id?)`
- `posting(id, transaction_id, account_id, direction, signed_amount_minor, posting_kind)`
- `split(id, transaction_id, category_id, amount_minor, memo?)`
- `category(id, parent_id?, name, kind, icon, color_token, sort_order, archived)`
- `merchant(id, canonical_name, aliases, archived)`
- `source_record(id, transaction_id?, source_kind, source_fingerprint, import_batch_id?, confidence?, redacted_preview?, source_received_at)`
- `import_batch(id, file_digest, profile, status, imported_count, error_count, created_at)`
- `budget(id, target_minor, period_rule, scope, effective_from, version, alert_rule)`
- `budget_period(id, budget_id, start_date, end_date, cached_target_minor?, version)` (derived/cache if needed)
- `recurring_rule(id, cadence, amount_minor, merchant_id?, due_rule, status, timezone_id, next_due_at)`
- `goal(id, target_minor, allocated_minor, allocation_mode, due_at?, linked_account_id?, status)`
- `goal_allocation(id, goal_id, transaction_id?, amount_minor, allocation_type, date)`
- `attachment(id, local_encrypted_path, mime_type, size, digest, transaction_id, created_at)`
- `review_candidate(id, source_record_id, proposed_transaction_id?, match_score, reason, status, resolved_at?)`
- `automation_rule(id, kind, predicate, action, priority, enabled)`
- `settings(key, value, version)`, `audit_event(id, kind, entity_id, old/new redacted fields, created_at)`, `schema_migration(version, checksum, applied_at)`

### 11.2 Architecture constraints

- Stable UUID-style identifiers; enforce foreign keys and relationship deletion semantics.
- Index transactions by effective date, account postings by account+transaction, splits by category+transaction, merchant aliases by normalized name, source fingerprints unique where meaningful.
- Single-writer or serialized database transactions for atomic mutations; clear cache invalidation.
- Encrypted database and attachments with key rotation/restore considerations and migration tests.
- Repository boundaries enforce domain invariants regardless of UI input source.
- Do not store `is_synced` if no sync exists; reserve migration path instead.
- Exact schema and signed-posting convention must be specified in architecture ADR before migrations are generated.

## 12. Non-functional requirements (NFR)

| ID | Requirement / target | Verification |
|---|---|---|
| NFR-01 | Core works fully in Airplane Mode after installation/on-device setup | E2E offline suite |
| NFR-02 | No unsolicited outbound financial data; no app-owned remote processing | Proxy inspection and dependency review |
| NFR-03 | Screen navigation median <300ms under defined reference data/device load | Perf instrumentation |
| NFR-04 | Manual entry Save confirmation p95 <500ms after validation for ordinary local writes on reference devices | Benchmark |
| NFR-05 | Home visible within p95 2s warm start on supported reference device for 10k ledger records | Benchmark |
| NFR-06 | UI animation aims 60 FPS; expensive analytics/OCR not executed on UI thread | Profiler |
| NFR-07 | 10k transactions with acceptable list scrolling and search p95 <500ms for indexed queries | Dataset benchmark |
| NFR-08 | Receipt OCR p95 ≤5s on benchmark single-page sample/reference hardware; failure/timeout escape always works | Device test |
| NFR-09 | All financial mutations atomic; invariant violations = 0 across regression/property suites | CI |
| NFR-10 | Data inaccessible on locked device without available platform credentials/backup passphrase under documented threat model | Security tests |
| NFR-11 | VoiceOver/TalkBack, font scaling, high contrast, reduced motion, appropriate hit target behavior | Accessibility audit |
| NFR-12 | Crash/restart during import/backup/migration leaves consistent database and recoverable UI | Fault injection |
| NFR-13 | Clear Android/iOS parity matrix for platform-specific features and permissions | Release review |
| NFR-14 | 0 mandatory recurring server/API costs for core operation; app store, developer membership, support and device costs are not represented as zero | Financial review |
| NFR-15 | Avoid collecting personal financial data for product telemetry; opt-in research clearly scoped | Privacy review |

Benchmarks are **engineering targets**, not universal guarantees; architecture must designate device models/OS versions and iterate based on test evidence. Do not require all database work within a single 16ms frame.

## 13. Privacy, policy and platform parity

| Feature | Android | iOS | Release handling |
|---|---|---|---|
| Manual account/transaction/budget | Yes | Yes | Android Phase 1; iOS Phase 2 |
| Offline charts | Yes | Yes | Android Phase 1; iOS Phase 2 |
| Local file CSV import/export | Yes | Yes | Android Phase 1; iOS Phase 2 |
| Receipt attachment | Yes | Yes | Android Phase 1; iOS Phase 2 |
| On-device OCR | Native local model after validation | Apple Vision/local OCR after validation | Android Phase 1; iOS Phase 2 |
| Passive SMS detection | Only with permission/store approval | Not supported as broad background SMS access | Android Phase 1, approval-gated variant |
| Biometric/PIN lock | OS backed | OS backed | Android Phase 1; iOS Phase 2 |
| Encrypted file backup | Yes | Yes | Android Phase 1; iOS Phase 2 |
| Local scheduled reminder | OS-dependent | OS-dependent | Best effort, no exact guarantee |

### 13.1 Store-policy gate

Android SMS permissions are restricted; `SMS-based money management` appears in Google's exception list **subject to Play review and approval**, not as an automatic entitlement. A Play-ready build without approval must omit restricted permissions and related inactive receivers from its manifest. Recheck the current policy before submission: https://support.google.com/googleplay/android-developer/answer/10208820.

### 13.2 No-network claim boundary

The **wmbugo application core** never requires or initiates a server call for financial tracking. The OS/store may connect for installation, system billing, OS-managed backup or document-provider operations outside wmbugo's internal ledger processing. The app must not imply the broader device can never transmit data; privacy disclosures distinguish app-initiated behavior from user-initiated export and OS mechanisms.

## 14. Roles, permissions and user control

One local device owner; no server users/roles in v1. Optional authenticated app unlock is not cloud authentication. Sensitive changes (erase, restore, change security lock, export decrypted CSV) require confirmation and re-authentication if lock configured. If device is shared, application cannot guarantee isolation from device owner or compromised OS; state limits accurately.

## 15. Error handling and failure recovery matrix

| Failure | Required behavior |
|---|---|
| No account configured | Explain missing balance scope, offer create account |
| Invalid amount/date | Inline specific validation, preserve form inputs |
| Insufficient funds | Warn, never silently reject unless user enables strict mode |
| Duplicate detected | Review with side-by-side matching evidence; no double commit |
| OCR unreadable | Manual correction/entry, keep image optional |
| SMS permission denied | Feature off, manual/import unaffected |
| App terminated mid-transaction | Atomic commit or rollback, no partial postings |
| CSV malformed | Row-level errors, editable mapping, no silent discards |
| Encrypted backup wrong password | No data replaced, safe retry |
| Database corruption | Safe-mode restore guidance, non-destructive diagnostics |
| Analytics cache stale | Refresh/compute state, no misleading confirmed value |
| Notification permission denied | In-app bills/budgets still show due statuses |
| Storage exhausted | No partial attachments/imports, readable cleanup advice |
| Date/time change | Recalculate displayed period without deleting history |
| Unsupported platform feature | Explain capability, show available fallback |

## 16. Quality assurance strategy and acceptance suites

**Test pyramid:** pure financial-domain unit/property tests → SQLite integration/migration tests → React Native component/accessibility tests → Detox/Maestro or appropriate E2E → physical device/manual policy validation. Fixtures contain synthetic data only.

### 16.1 Required suites and representative cases

| Suite | Required cases |
|---|---|
| FIN | transfer conservation; credit card payment; opening balance; refunds; edited splits; reversal; integer paise limits |
| TXN | add/edit/reverse; interrupted save; form validation; undo; virtualized list and filter correctness |
| ACC | archive with balance; reconcile; account scope; liability presentation |
| BDG | payday period; month boundary app suspended; no rollover; refunds; threshold once/period |
| INS | chart ties to records; previous zero baseline; negative net cash flow; filter composition; no-data states |
| IMP | repeated file; duplicate against manual; date/amount parsing; malformed row; atomic rollback |
| OCR | rows; multi-column; tax/discount; low contrast; duplicate matching; correct midpoint formula |
| SMS | approval build flags; consent; denial; parsing debit/credit; nonfinancial ignored; OEM restrictions; non-bank sender ignored; scam wording flagged; balance-chain mismatch; blocked sender ignored; re-ask limits |
| CAP | approve/reject from notification; grouped notification; batch apply-to-similar; end-of-day auto-approve excludes flagged items; reject then re-approve updates balances; lock-screen opt-in |
| LRN | merchant learned after first categorization; UPI-ID learning; mixed-merchant choices; item learning; forget entry |
| REC | monthly end-of-month; pause/renew; planned not posted; rejected candidate |
| BKP | wrong key; corrupt file; interrupted restore; migrated version; attachments |
| SEC | encrypted storage; app snapshot privacy; exported CSV warnings; no third-party network requests |
| UX | VoiceOver/TalkBack; dynamic type; reduced motion; text contrast; touch targets; tab/deep-link navigation |
| PERF | 10k/50k synthetic items; startup; search; chart updates; background restoration |
| PLAT | Android permission policy variant; iOS picker/camera; notification denial; app lifecycle |

### 16.2 Minimum release-blocking criteria

- **P0:** No known incorrect account balance, duplicate confirmed counting, monetary rounding error, data loss in normal paths, or irreversible unsafe migration.
- **P0:** All MVP flows work in Airplane Mode on Android (iOS equivalent is a Phase 2 release criterion).
- **P0:** Backup/restore tested end to end, including wrong password and corruption.
- **P0:** Security and Play permission review completed for actual Phase 1 release builds; the shipped variant matches the SMS approval outcome (App Store review in Phase 2).
- **P0:** OCR never auto-creates a second confirmed expense for an existing SMS/manual/imported transaction.
- **P0:** Core accessibility blockers eliminated; financial state never conveyed only by color.
- **P1:** Performance objectives verified on reference devices; documented exceptions accepted by product owner.
- **P1:** Usability study validates Home comprehension, expense addition, account transfer, budget drill-down.

### 16.3 Test traceability format

Every story and test carries IDs: `WMB-<epic>-<story>`, product requirement ID (`FIN-013`, `TXN-008`, etc.), design screen (`SCR-09`), architecture component/ADR, test (`TC-...`), and proof (CI run/device test/evidence). Stories without verifiable acceptance criteria are not Ready.

## 17. Security/data correctness threats to model

- Misclassification of transfer as income/expense.
- Duplicate sources (bank SMS, receipt, CSV and user input).
- Theft of offline phone/unencrypted backup.
- Improper screenshot/notification leakage.
- Malformed or malicious imported files.
- Accidental user wipe/restore over active database.
- OS time and timezone manipulated.
- App background termination and race conditions.
- Encryption key loss or library misconfiguration.
- Compromised rooted/jailbroken device (out of guarantee; warn where meaningful).

Architecture must document threat model, assumptions, encryption/auth design, recovery limits and internal audit invariants before implementation.

## 18. Analytics processing architecture expectations

- Read model for balances and summaries using SQL aggregates/cache, never independently computed conflicting values in UI components.
- Filter-safe domain selectors returning both figure and provenance scope (start/end/account/status).
- Update aggregates incrementally or invalidate after any ledger change.
- Use database transactions for writes and consistent reads for concurrently changing dashboard state.
- Forecasts calculated locally and labeled heuristic with historical sample count and error range where supported.
- Chart interaction semantics (select category/date → filtered Activity) defined in UX spec and tested.

## 19. Monetization and financial constraints

Original BRD: free core and $9.99 one-time local-license premium including receipt itemization, recurring detection and PDF reports. Preserve this **as a hypothesis**, not an implementation instruction for release 1. **Monetization is Phase 2 (DEC-13):** Phase 1 contains no billing or entitlement code, and features shipped free in Phase 1 (including SMS capture and OCR) must not be retroactively paywalled without a product decision entry. Decide price region, tax, store fee, restore-purchase behavior, offline cached entitlement, premium feature parity and what functionality must remain free **after** usability and store billing feasibility review. The base ledger, data export/backup, privacy and security must never be trapped behind a paywall that prevents users accessing their own information.

## 20. Dependencies, milestones and implementation order

1. **M0 Product freeze:** approve PRD, resolve external gate owners, approve UX direction and definition of MVP.
2. **M1 Architecture spike:** prototype integer paise SQLite ledger, data encryption, safe migrations, file import, OS platform capabilities; produce ADRs.
3. **M2 UX validation:** screen map, wireframes, tokens, navigation, dashboard and three critical flows tested with users.
4. **M3 Core ledger vertical slice:** account setup → expense/income/transfer → Activity → accurate Home.
5. **M4 Planning/insights:** category budgets, core charts, recurring manual, goals, drill-down.
6. **M5 Import/security/recovery:** CSV mapping/dedup, encrypted backup/restore, lock, hardening.
7. **M6 Capture automation:** on-device receipt OCR and Android SMS behind policy gate; submit Play SMS declaration early (lead time).
8. **M7 Phase 1 QA and Android launch.**
9. **M8 Phase 2:** iOS device testing, App Store review and iOS release; monetization; sophisticated subscription detection and advanced charts.

No automatic code replacement or rewrite is mandated. An implementation audit maps reusable current code to the approved PRD v1 requirements and identifies migrations, refactors and removals.

## 21. BMAD epics and recommended vertical slices

| Epic | Definition | Sample slices | Phase |
|---|---|---|---|
| WMB-01 | Design system and shell | tokens → bottom tabs → drawer/tablet rail → UI states | MVP |
| WMB-02 | Onboarding and preferences | privacy → account setup → theme → defaults | MVP |
| WMB-03 | Ledger and accounts | schema → posting engine → account balance → transfer/adjustment | MVP |
| WMB-04 | Activity and review | add expense → edit → search → splits → review queue | MVP |
| WMB-05 | Dashboard widgets | balances → budget ring → category bars → widget editor | MVP |
| WMB-06 | Categories/budgets | category CRUD → budget rules → thresholds → period detail | MVP |
| WMB-07 | Local import/export | CSV mapping → preview → dedup → atomic commit → export | MVP |
| WMB-08 | Insights | aggregation → filters → charts → drill-down → comparisons | MVP |
| WMB-09 | Recurring/goals | manual rule → due view → reminders → goal allocations | MVP |
| WMB-10 | Privacy/security/backup | encrypted DB → app lock → encrypted export/restore → diagnostics | MVP |
| WMB-11 | Receipt OCR | scan → parse → correction → split → match to existing | MVP (Android); iOS validation Phase 2 |
| WMB-12 | Android SMS automation | policy gate → explainer/consent → sender filter → parse → scam/balance checks → block sender → reconcile → diagnostic | MVP conditional on Play approval |
| WMB-16 | Capture review and learning | Approve/Reject notification → floating dialog → grouped/batch → auto-approve → merchant/UPI/item learning → home-screen widget | MVP (Android) |
| WMB-13 | Advanced intelligence | subscription inference → forecast → heatmap → rules | Phase 2 |
| WMB-14 | QA, platform parity and release | invariant suite → accessibility → Android device matrix → Play Store (Phase 1); iOS device matrix → App Store (Phase 2) | Cross-cutting |
| WMB-15 | Monetization | entitlement model → store billing → restore purchase → offline cached entitlement | Phase 2 |

**Epic sequencing constraint:** ledger/correctness precedes auto-capture and visual calculations; do not build chart components against invented financial semantics.

## 22. Definition of Ready / Done

### 22.1 Definition of Ready for story implementation

- Requirement ID, persona/value, UI path, expected platform(s), phase and dependencies identified.
- Validated UX mock or described interaction state exists.
- Data invariants and error/recovery paths listed.
- Acceptance criteria use Given/When/Then, with positive, negative and offline cases.
- Security/privacy/permission considerations explicitly covered.
- Tests and measurable completion evidence defined.
- No unresolved P0 contradiction with architecture or PRD.

### 22.2 Definition of Done

- Code implemented to approved design/domain contract on target platform(s).
- Unit + integration + E2E acceptance evidence; local-data invariants pass.
- Empty/loading/error/permission states implemented and accessibility reviewed.
- No unsafe logs/network transmission; security review as applicable.
- Performance checked against reference devices.
- Migrations and rollback/recovery tested when storage changes.
- Source of truth documentation and story traceability updated; reviewed by owner.

## 23. Source document reconciliation and provenance

The five user-provided baseline documents, dated June 2026, are the historical source of the product premise, privacy boundaries, original implementation choices and testing scenarios. This PRD v1 intentionally expands and corrects them.

| Original source | Original key points `[SRC]` | PRD v1 treatment |
|---|---|---|
| Business Requirements Document (BRD) | Offline device-first, privacy, $0 server core, free/one-time premium, platform distinction | Retain offline promise and business hypothesis; correct platform parity and licensing dependencies |
| Product Requirements Document (PRD) | No-account onboarding, SMS, receipt OCR, recurring trends, 4 tabs, two themes, dashboard | Expand to full finance experience and five destinations; gate SMS; OCR and gated SMS in Phase 1 (v1.1) |
| Functional Requirements Document (FRD) | SMS broadcast parsing, on-device item OCR, strict month reset, 28–31-day repeat pattern, live widget updating | Replace destructive reset; broaden cadence; add reconcile and real accounting rules |
| Technical Specification Document (TSD) | RN CLI, JSI storage, `expenses`/`expense_items`, local libraries, OCR geometric logic | Make technology candidate; replace `REAL`, introduce postings, fix midpoint and simplify assumptions |
| QA Test Plan | Six scenarios for SMS, OCR, month change, subscription, air gap | Retain as regression seed; add correctness/security/UX/backup/platform suites |

### 23.1 Superseded source requirements (explicit)

- `FR-CLK-001`, `REQ-CLK-06`, `TC-CLK-504`: *physical midnight reset/archival* replaced with persistent ledgers and period-based read models. No balances reset.
- `FR-CLK-002`: *mandatory non-rollover* retained as default budget behavior only, not deletion/reset of target definitions.
- `FR-SUB-003`, TSD recurrence heuristic: no auto-confirmed active subscriptions based solely on two matches.
- TSD `expenses.amount REAL`: integer minor units in relational postings.
- TSD OCR midpoint `top + bottom / 2`: fixed to `(top + bottom) / 2`.
- PRD four-tab nav: replaced with five destinations and secondary Settings.
- FRD 16ms all calculations target: replaced with task-specific performance budgets and non-blocking computation.
- SMS persistent low-level background interception requirement: conditional on platform rules and user consent; not assumed always available.
- TSD `is_synced`: removed from v1 product logic (no sync).

## 24. Explicit assumptions, remaining external validations and change control

This PRD strives to be **implementation-ready and internally comprehensive**, but “no gaps” cannot be truthfully guaranteed without review. The following items are **not hidden unknowns**; they are named gates with owners and required outputs.

| Gate | Owner role | Required evidence before dependent work/release |
|---|---|---|
| GATE-01 | Product owner | Sign off MVP scope, user personas, free/premium positioning |
| GATE-02 | Android release/policy owner | Current SMS permission eligibility, declaration approval or disabled variant |
| GATE-03 | Mobile architect | Device/OS support matrix and reference performance hardware |
| GATE-04 | Security engineer | Encrypted DB library/key management, file backup format/threat model |
| GATE-05 | Mobile/OCR engineer | Confirm offline OCR model availability and iOS/Android parity |
| GATE-06 | UX lead | Screens, component tokens, full wireframes, usability results |
| GATE-07 | Finance domain reviewer | Posting sign convention, refunds, liabilities, budget formulas and test fixtures |
| GATE-08 | Compliance/release | Accurate privacy policy, store disclosures, jurisdictional review |
| GATE-09 | QA lead | Device matrix, benchmark methodology, regression evidence |
| GATE-10 | BMAD workflow owner | Installed workflow input path, PRD validation, story traceability |
| GATE-11 | Commerce owner | Premium packaging and local entitlement strategy, if enabled |

**Change control:** Any material decision modifying offline privacy, money model, included features, platform behavior or monetization requires a new ADR/product decision entry, PRD version increment and downstream UX/architecture/story impact review.

### 24.1 Change log

| Version | Date | Change | Decisions affected |
|---|---|---|---|
| 1.1.0-draft | 1 Nov 2026 | Receipt OCR and Android SMS ingestion moved from Phase 2 to Phase 1 (SMS remains Play-approval gated with a no-SMS fallback variant). iOS device testing, App Store review and iOS release moved to Phase 2 (iOS still built in parallel). Monetization moved to Phase 2. | DEC-01, DEC-07, DEC-10, DEC-13; §4, §5.2, §8.11–8.12, §13, §16.2, §19, §20, §21 |

| 1.2.0-draft | 1 Nov 2026 | "Effortless capture" from brainstorming session (`_bmad-output/brainstorming/brainstorm-sms-ocr-capture-2026-11-01/`): Approve/Reject as universal capture interaction, end-of-day auto-approve, local learning moved to Phase 1, rejected captures retained, floating capture dialog, scam/sender protections, permission explainer and re-ask policy, OCR entry points and itemization, Android home-screen widget, lock-screen approve opt-in. | DEC-21–DEC-25; FIN-024, FIN-025, CAT-005, HOM-007, OCR-009–013, SMS-010–014, SEC-005; new §8.16 CAP, §8.17 LRN; SCR-27–29; WMB-16 |

Version numbering: the document was originally labelled 2.0.0-draft; it is the first PRD for wmbugo and is renumbered as v1 (1.0.0 baseline, 1.1.0, 1.2.0).

**Impact notes for v1.2:** (1) Auto-approve and learning change the trust model — usability study must confirm users understand auto-approved entries. (2) Itemized OCR is the top Phase 1 delivery risk (see §8.11 note). (3) Later, not Phase 1: stop notifying a merchant after repeated consistent confirmations; weekly privacy log. Dropped: amount-band category guessing.

**Impact notes for v1.1:** (1) GATE-02 (SMS Play approval) and GATE-05 (offline OCR model) now sit on the Phase 1 critical path. (2) The Phase 1 launch is no longer Android/iOS simultaneous; the parity matrix (§13) records iOS as Phase 2. (3) GATE-11 (commerce) is not required for Phase 1.

## 25. PRD acceptance checklist (for BMAD validation)

- [ ] All core user roles/jobs and success metrics defined.
- [ ] Feature scope divided into MVP, Phase 2, future and out-of-scope.
- [ ] Every screen has its responsible epic and design interaction states.
- [ ] Every financial operation has exact integer monetary semantics and negative cases.
- [ ] Transfers, splits, refunds, imports, opening balances and liabilities reconcile.
- [ ] Every chart/metric defines eligible transactions, formula, period and drill-down.
- [ ] Global navigation, settings, filters, widgets, theme and accessibility documented.
- [ ] Offline-first works without credentials, network, permissions or SMS approval.
- [ ] Android SMS gated correctly; iOS fallback behavior defined.
- [ ] Local OCR, CSV imports, backups and restore include review/error paths.
- [ ] Security threat model and data retention expectations are traceable.
- [ ] No destructive midnight reset or mandatory always-running background services.
- [ ] QA suites cover accounting correctness, data protection, failure recovery, UX and platform parity.
- [ ] Product owner accepts the explicit decision defaults and release gates.
- [ ] Architecture ADRs resolve library/encryption/database specifics prior to code generation.

---

## Appendix A — Sample story acceptance contract

**Story WMB-04-03: Duplicate source reconciliation**  
**Requirement trace:** `TXN-008`, `IMP-004`, `FIN-024`, `SMS-005`, `OCR-006`  
**Screens:** `SCR-10`, `SCR-19`, `SCR-23`, `SCR-24`  
**Value:** Avoid counted-twice expenditure.

1. **Given** a confirmed ₹450 restaurant purchase exists, **when** a CSV row with matching reference is imported, **then** the row is associated with the existing event and no second confirmed expense is created.
2. **Given** a receipt and an existing expense share amount, merchant and date but have no unique reference, **when** reviewed, **then** candidate match rationale is shown and user chooses attach/create/exclude.
3. **Given** a previous import was committed, **when** identical batch is re-imported, **then** recognized rows remain idempotent and a review summary reports skipped matches.
4. **Given** conflicting evidence, **when** system cannot decide confidently, **then** no silent merge and candidate remains outside confirmed totals until reviewed.
5. **Given** import is interrupted, **when** app resumes, **then** no partial inconsistent ledger postings exist.

## Appendix B — Sample UX state contract

**Screen:** Home (`SCR-04`)

| State | Expected behavior |
|---|---|
| Fresh install | Privacy-friendly welcome and Set up account / Add expense CTA |
| No account | Balances labeled “not configured”; no misleading ₹0 |
| Zero real activity | Budget setup suggestions and chart empty states |
| Loaded | Known funds, period KPI, budget, categories and quick add |
| Needs review | Review badge and excluded provisional amounts |
| Overspent | Warning icon + accessible text + negative remaining value |
| Insufficient forecast data | Suppress safe-to-spend estimate and explain missing inputs |
| Corrupt datastore | Safe-mode recovery guidance; do not overwrite data |
| App background/resume | Obscure sensitive snapshot if lock enabled, recompute period |

## Appendix C — Suggested folder placement

Suggested repository (adjust to your installed BMAD configuration):

```text
wmbugo/
├── inputs/
│   ├── wmbugo_PRD_v1.md
│   └── references/
│       ├── wmbugo_Business_Requirements_Document_BRD.pdf
│       ├── wmbugo_Product_Requirements_Document_PRD.pdf
│       ├── wmbugo_Functional_Requirements_Document_FRD.pdf
│       ├── wmbugo_Technical_Specification_Document_TSD.pdf
│       └── wmbugo_QA_Test_Plan_and_Test_Cases.pdf
└── [BMAD-generated files at configured output paths]
```

**Important:** `inputs/` is a convenient organizational directory, not an assertion that BMAD automatically reads it. Refer to `inputs/wmbugo_PRD_v1.md` explicitly when invoking the appropriate BMAD workflow, and verify the output artifact path in the installed BMAD project config.
