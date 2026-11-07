---
title: wmbugo PRD
version: 1.3.6
status: final
created: 2026-10-17
updated: 2026-11-07
---

# wmbugo — PRD

> **Status:** Final (frozen at v1.3.6 for UX, architecture and epics); changes follow §24 change control  
> **Document type:** Comprehensive product requirements / SDD input  
> **Platforms:** Android only in Phase 1. Domain and ledger code stays platform-neutral; iOS build, testing, App Store review and release are Phase 2  
> **Date:** 17 October 2026 (rev. 1 November 2026)  
> **Product:** wmbugo — *where my budget goes*. Private Money, Made Clear  
> **Markets (Phase 1):** India; US and Canada; UK and Europe; Gulf and Southeast Asia. English UI with locale-aware number, date and currency formatting; one currency per user  
> **Phase labels:** **P1** = Phase 1 (Android release). **P1-IN** = Phase 1, India only. **P2** = Phase 2. "MVP" is retired as a label  
> **Authors of original source documents:** Aasil Ahamed and Praveen Kumar KC  
> **Change ownership:** Product owner must approve changes before treating this PRD as frozen  
> **Version:** 1.3.6 (see §24.1 change log). Technical candidates and design rationale: `addendum.md`

## 0. How to use this document in BMAD

This document is intended as the **single consolidated product input** for BMAD's PRD validation, UX design, architecture, and epic/story decomposition. It is **not** a claim that the PRD is already validated or that there are zero implementation unknowns. Each normative statement uses **MUST**, **SHOULD**, or **MAY**. Critical product defaults have been resolved below; external approvals and technical feasibility gates are explicit.

**Source legend:** `[SRC]` = retained from supplied BRD/PRD/FRD/TSD/QA; `[FIX]` = corrected contradictory/unsafe source requirement; `[NEW]` = recommended missing requirement; `[v1.3]` = added or rewritten in v1.3.x; `[v1.3.6]` = aligned with the UX spines in v1.3.6. Source IDs are mapped in §23. Architectural libraries are candidate selections, not immutable product requirements.

**BMAD handoff:** This file is the frozen v1.3 PRD. Next: `bmad-ux` and `bmad-architecture` in parallel, both starting from this file and the capture status mapping in FIN-024/FIN-026; then `bmad-create-epics-and-stories` and `bmad-sprint-planning`. Pass this file's path explicitly to each workflow.

---

## 1. Executive summary

wmbugo is a **private, offline-first personal finance application** that helps an individual understand balances, track income and expenditure, manage budgets, identify recurring costs, and make better spending decisions through **visual, accessible, actionable insights**. It should be useful without registration, internet, or SMS permissions. Phase 1 is an Android release in four market groups (India, US/Canada, UK/Europe, Gulf/SE Asia), one currency per user. Every market gets manual entry, on-device receipt OCR with itemization, CSV import, budgets including a 50/30/20 template, and the home-screen widget. India additionally gets UPI payment-screenshot capture and opt-in SMS transaction detection (subject to Play approval). iOS is built, tested, reviewed and released in Phase 2.

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
4. **Effortless capture:** on-device receipt scanning everywhere, plus UPI screenshot share and (if Google Play approves, GATE-02) automatic SMS capture in India, all confirmed with a single Approve/Reject and learning from every correction; manual entry remains as fallback. Without Play approval the Indian differentiator is receipt scan + UPI share (§13.2).
5. Transparent, explainable insights rather than opaque AI recommendations.
6. **A budgeting method people already know:** the 50/30/20 split (needs, wants, savings) is built in and is the brand's mark (§6.6).

## 2. Product decision register (resolved defaults)

| ID | Decision | Baseline | Reason / trade-off | Status |
|---|---|---|---|---|
| DEC-01 | Platforms | **Android only in Phase 1** (React Native CLI). Domain/ledger code has no platform imports so it carries to iOS; iOS build, testing, App Store review and release in Phase 2 | Solo developer; parallel iOS build doubles work before first launch | Product decision v1.3 (supersedes v1.1 "built in parallel") |
| DEC-02 | Connectivity | Entire financial core usable offline; no account or backend | Privacy and reliability | Retain `[SRC]` |
| DEC-03 | Identity | Guest/local profile only; optional display name, no email/phone | Near-zero onboarding | `[SRC]` expanded |
| DEC-04 | Ledger | Multiple accounts, explicit income/expense/transfer/adjustment, signed ledger postings | Prevent false balances | `[NEW]` mandatory |
| DEC-05 | Currency | **One currency per user**, chosen at onboarding from the supported list; every account uses it. Amounts stored as integer minor units using that currency's ISO 4217 exponent (e.g. paise/cents ×100, JPY ×1, BHD ×1000) | Correctness and manageable scope across four markets | Product decision v1.3 (supersedes INR-only) |
| DEC-06 | Multi-currency | Mixing currencies within one profile is out of scope until Phase 3; the app never converts currencies or fetches rates | Avoid unverified FX rates offline | `[NEW]`, retained |
| DEC-07 | SMS | Android-only opt-in feature in **Phase 1**, behind a policy-gated build variant; if Play approval is not granted by release, Phase 1 ships the no-SMS variant and SMS follows on approval | Core capture pain; store restrictions remain | Product decision v1.1 |
| DEC-08 | iOS automation | No general background SMS interception; manual entry, sharing/paste, document imports, and OCR | Platform limitations | `[FIX]` |
| DEC-09 | Import | User-initiated CSV import is P1; PDF bank statements optional later after parsing-quality validation | Deterministic reviewability | `[NEW]` |
| DEC-10 | Receipts | On-device OCR in **Phase 1** (Android release; iOS implementation validated with iOS release in Phase 2); manual attachment always available as fallback | Reduce manual-entry burden at launch | Product decision v1.1 |
| DEC-11 | Budgets | Persistent definitions; period-scoped calculations; no destructive midnight reset; no rollover by default | Correct accounting | `[FIX]` |
| DEC-12 | Notifications | Local, permission-respecting, individually configurable; no alarm-like repeated spam | Trust | `[NEW]` |
| DEC-13 | Premium | Monetization (free + one-time premium hypothesis) moved to **Phase 2**; Phase 1 ships with all features free and no billing code | Requires store validation and usage evidence | Product decision v1.1 |
| DEC-14 | Backup | User-triggered encrypted local export/import; no automatic wmbugo cloud sync | Data sovereignty / recovery | `[NEW]` |
| DEC-15 | Privacy | No third-party behavioral trackers, ad SDKs, financial-event telemetry, or outbound financial-data transmission | Consistent offline pledge | `[SRC]` |
| DEC-16 | UX | Four tabs (Home, Activity, Insights, Plan) with a centre **＋** button that opens the Add sheet (not a destination). **No drawer**: Accounts icon and Settings hub in the header. Pending captures surface as a Home card ("N to check") plus a dot on Activity; never a numeric badge on a tab or the app icon | One navigation system; review queue visible without guilt pressure | Product decision v1.3 (supersedes five destinations + drawer) |
| DEC-17 | Accessibility | Screen readers, reduced motion, text scaling, non-color cues | Inclusive quality | `[NEW]` |
| DEC-18 | Accounts | Opening balance entered per account with an effective date; balances based on postings | Accurate initial state | `[NEW]` |
| DEC-19 | Credit card | Credit account with outstanding liability, payment as transfer; debt complexity deferred | Do not mislabel card payments as spend | `[NEW]` |
| DEC-20 | Split | One posted transaction may have many category allocation rows whose amounts reconcile | No double count | `[NEW]` |
| DEC-21 | Capture interaction | **Approve / Reject** for categorised captures (SMS, UPI share); typed choices for credits (CAP-004), transfer-like captures (CAP-012) and receipt matches (OCR-010: Attach / Keep separate / Discard); details edited only when the guess is wrong | Frequent dialogs become a chore; users are inconsistent | Product decision v1.2 |
| DEC-22 | Auto-approve | Eligible captures (CAP-007) still pending after the daily cutoff (default **21:00**, configurable, can be disabled) are **written as confirmed** by a best-effort background job or the next app open, whichever is first (FIN-026); until then they are "Waiting" everywhere. A best-effort evening summary lists them. Possible duplicates are never eligible | Capture the expense first, without breaking the no-double-count RB0 | Product decision v1.3 (amends v1.2) |
| DEC-23 | Local learning | App learns merchant / UPI ID / bill item → category automatically from user corrections in Phase 1; learning is local, visible and editable | Effort must fall over time | Product decision v1.2 (superseded the earlier "explicit rules only" wording; now specified in LRN-001–009) |
| DEC-24 | Rejected captures | Rejected captures are retained as `excluded`, shown greyed out, never counted, and can be re-approved for 90 days; after that they are purged and only a tombstone keeps them from coming back (FIN-014) | Reversibility makes one-tap decisions safe | Product decision v1.2 |
| DEC-25 | Home-screen widget | Android home-screen widget (Snap receipt / Add expense / pending count) in Phase 1; not deferrable | Fastest capture entry point, especially without SMS | Product decision v1.2, reaffirmed v1.3 |
| DEC-26 | UPI screenshot share | India: user shares a GPay/PhonePe/Paytm payment-success screenshot to wmbugo; fixed-layout parser extracts amount, payee, time and UPI reference into the same capture dialog | Two-tap capture that works without SMS approval | Product decision v1.3 |
| DEC-27 | Markets | Phase 1 launches in India, US/Canada, UK/Europe and Gulf/SE Asia. SMS (DEC-07) and UPI share (DEC-26) are India-only; other markets capture via receipt scan, manual entry and CSV | International brand and audience from day one | Product decision v1.3 |
| DEC-28 | Language | English-only UI in Phase 1; number, date and currency formats follow the user's region; strings externalized for later translation | Scope control for a solo build | Product decision v1.3 |
| DEC-29 | Shared capture pipeline | Every source (SMS, receipt, UPI screenshot, CSV row, manual) produces a `source_record` that passes through one duplicate-detection and review path before posting | One set of dedup rules; prevents double counting across five capture paths | Product decision v1.3 |
| DEC-30 | 50/30/20 | Expense categories carry a type (need, want); savings is measured from money moved into **savings pots** (ACC-009), including SIP/RD debits; a one-tap template splits income into 50/30/20 targets; a Needs/Wants/Savings view ships in Phase 1 | Known global method; matches the brand mark | Product decision v1.3 (moves INS-020 from Phase 2) |
| DEC-31 | Itemized receipts | Line-item OCR (OCR-012) is Phase 1 and not deferrable; quality floor defined in OCR-005 | Core to the receipt-first experience outside India | Product decision v1.3 (removes v1.2 "first to cut") |
| DEC-32 | Brand and visual system | Name means *where my budget goes*; coin-flip mark; paper-boat illustration; glass on floating surfaces with solid fallback (§6.6) | Premium feel without hurting legibility or low-end performance | Product decision v1.3 |
| DEC-33 | Default period | When a payday is set, Insights and Plan default to the payday cycle; otherwise calendar month. Both tabs always share the same period. A pay cycle is [payday, next payday) in the profile timezone; "last working day" skips weekends; salary-category income arriving up to 3 days before the payday belongs to the cycle that payday starts | Matches how salaried users think; tabs never disagree | Product decision v1.3 |

**External decision gates:** SMS permission approval; actual offline availability/licensing of OCR models on supported device versions; native encryption library security review; app-store in-app purchase treatment; privacy/legal review for every Phase 1 market (India DPDP, EU/UK GDPR, US/Canada, Gulf/SE Asia); Play developer account type (a personal account created after Nov 2023 must run a 14-day, 12-tester closed test before production); signing and store accounts. These cannot be guaranteed by a PRD.

## 3. Users, jobs-to-be-done and scenarios

### 3.1 Personas

- **Busy digital spender:** pays by UPI/card, wants passive or very fast capture and clear category views.
- **Privacy-focused professional:** refuses bank credential sharing, needs on-device processing and recovery controls.
- **Budget-conscious salaried user:** plans by payday, needs category limits and safe-to-spend indicators.
- **Cash/mixed-mode user:** carries cash and bank accounts, needs flexible manual tracking.
- **First-time finance tracker:** needs friendly empty states, onboarding, and explainable metrics.

Named protagonists used in §9 flows: **Priya** (busy digital spender, Bengaluru, pays by UPI, SMS capture), **Arjun** (budget-conscious salaried user, Pune, plans by payday, uses 50/30/20), **Sara** (privacy-focused professional, London, receipt-first, backs up locally), **Ravi** (cash and mixed-mode user, Chennai, cash plus two bank accounts and a card), **Mei** (first-time tracker, Singapore, receipt-first).

Personas apply in every Phase 1 market. The busy digital spender in India is the primary protagonist for capture (CAP, SMS, UPI); outside India the same persona relies on receipt scan, manual entry and CSV. The budget-conscious salaried user is the primary protagonist for Home, Plan and 50/30/20.

### 3.2 Primary jobs

- Within seconds, tell me my known available funds, this month's spend, and budget headroom.
- Record or correct a payment with very little effort.
- Find, filter, and explain any past money movement.
- Know what I spent most on and whether that is rising or falling.
- Anticipate subscriptions, known bills, and budget risk.
- Export or restore my information without needing a service account.

### 3.3 Product success metrics (privacy-respecting)

No remote event tracking is permitted in Phase 1. Evaluate these through **opt-in usability studies, voluntary anonymized feedback submitted outside the app, and local diagnostics visibly exported by users**—never covert financial telemetry.

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
| Auto-approve comprehension | ≥ 90% correctly explain what an auto-approved ("category guessed") entry is | Usability study |
| Effortless capture (India) | ≥ 70% of SMS/UPI captures end with the **correct** amount, account and category after zero or one tap (checked against participants' own records) | Multi-week diary study, India participants |
| Receipt-first capture (all markets) | Median ≤ 20 seconds from Snap receipt to saved, itemized expense | Usability study, participants from each market group |
| Learning effect | Category corrections per 10 captures fall by ≥ 30% from week 1 to week 3 of a diary study, reported separately for India and other markets | Diary study |
| Market onboarding | ≥ 90% of non-India participants complete onboarding and save their first itemized receipt unaided in ≤ 3 minutes | Usability study |
| SMS parsing (India) | Precision ≥ 98% and recall ≥ 95% on amount, direction and account | Synthetic bank/UPI SMS fixture corpus (CI) |
| UPI screenshot parsing (India) | ≥ 98% correct amount and UPI reference per supported app layout | Synthetic screenshot fixtures (CI) |
| Receipt OCR | Total, merchant and date correct on ≥ 90% of a reference receipt set covering all four markets | Reference set (device test) |

**Counter-metrics** (watch that the capture thesis isn't paid for with trust):

| Counter-metric | Threshold | Measurement |
|---|---|---|
| Wrong-category auto-approvals | ≤ 10% of auto-approved entries | Diary study |
| Scam filter false positives | 0 genuine bank SMS flagged in a fixture corpus built from published SMS templates of at least 10 Indian banks, reviewed independently of the rule author | CI |
| Capture notifications disabled | ≤ 20% of study participants turn them off | Diary study |
| Duplicate confirmed entries | 0 | Invariant suite (CI) |

The original BRD's >38% day-30 retention aim is an aspirational business metric, **not measurable in an air-gapped production app without an ethically designed opt-in method**.

## 4. Scope and release stages

### 4.1 Phase 1 (P1) — Android release in four market groups

- Local no-login onboarding: privacy promise, region and currency, one account, payday, optional 50/30/20.
- Accounts: bank, cash, payment wallet, credit card (liability) and optional archive.
- Opening balances and full income/expense/transfer recording; edit, reverse and categorize.
- Account-aware transaction list, search, filters, detail, bulk limited actions.
- Categories/subcategories, emoji-free accessible icon library, category colours chosen from a fixed accessible palette [v1.3.6].
- Home dashboard, core analytics, budget planning, customizable Home card visibility/reorder.
- User-initiated CSV import with preview/mapping/deduplication and non-destructive review.
- Encrypted local datastore, app lock option, local notifications, encrypted export/restore.
- Manual recurring entries and bill reminders (automatic inference later).
- Baseline responsive layout, accessibility and full empty/error states.
- Manual receipt image attachment as fallback.
- On-device receipt OCR, itemized receipt parsing and matching to existing transactions.
- Optional Android SMS listener (India), shipped only in the Play-approved build variant; safe manual alternatives remain.
- UPI payment-screenshot share capture (India, DEC-26).
- One shared capture pipeline with duplicate detection for every source (DEC-29).
- Approve/Reject capture notifications, capture dialog (a bottom sheet over the current app) [v1.3.6], grouped captures, auto-approve after the daily cutoff (DEC-22), rejected-capture retention, lock-screen approve (opt-in).
- Local learning of merchant, UPI ID, receipt item and payment account → category/account.
- Account discovery from captures ("New account ••7730 — add it?").
- Android home-screen widget (DEC-25).
- 50/30/20 category types, template and view (DEC-30).
- Brand, coin-flip mark, boat illustrations and glass visual system with solid fallback (DEC-32).
- Android offline QA, migration/recovery, security and Play Store release criteria for all four market groups.

All P1 items are committed; there is no ranked cut list. Schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope.

### 4.2 Phase 2 / enhancement

- iOS build, device testing, App Store review and iOS release (including iOS OCR validation) to reach Android/iOS parity.
- Stop notifying for a merchant after repeated consistent confirmations; weekly privacy log (from v1.2 impact notes).
- Additional UI languages.
- Tablet two-pane Activity–Detail layout (Phase 1 tablets use the navigation rail with centred content, §5.3) [v1.3.6].
- Monetization: premium packaging if validated; iOS/Android consistent entitlement policy.
- Automatic recurring-payment suggestions, richer forecasts, spending heatmaps and advanced comparison charts.
- Rule-based categorization and customizable automation review thresholds.
- Document statement formats only when a reliable review flow exists.

### 4.3 Phase 3 / future

- Mixing currencies within one profile, with a reliable rate-source strategy, advanced debt modeling, investment tracking, shared household spaces or optional sync (each requires a separate PRD and privacy reevaluation).
- No speculative AI assistant, bank-login aggregation, or cloud backend is in the present scope.

### 4.4 Explicit out of scope

Cloud identity, server sync, direct bank API integrations, screen scraping of banking apps, credential collection, general iOS SMS access, money movement/payment execution, credit scoring, tax filing, personalized investment advice, advertising/tracking monetization, multi-user collaboration and automatic third-party data upload.

## 5. Functional architecture and screen inventory

### 5.1 Primary navigation

Bottom bar: **Home · Activity · [＋] · Insights · Plan**.

- **Home:** "Am I okay?" snapshot; reorderable Home cards; a "N to check" card appears only when captures are pending.
- **Activity:** all ledger items, search, filters, transaction detail; a small dot (no count) when captures are pending; rejected items behind "Show rejected".
- **＋ (centre button, not a destination):** tap opens the Add sheet (amount keypad first, with *Snap receipt* and, in India, *Share from UPI app* chips; Expense / Income / Transfer). Long-press opens the camera. Functions unavailable in the user's market or build are not shown.
- **Insights:** one scrolling view that answers questions in order (where did it go, is it rising, who got it, am I on track), with a shared period/account filter.
- **Plan:** opens on the "Before payday" timeline (or "Before month-end" without a payday), then Budgets (including 50/30/20), Bills & Recurring, and Savings Goals.

**Header (every tab):** Accounts icon; avatar opening the **Settings hub**, grouped as You (payday, period, theme, number format, haptics) · Money (categories) · Capture (SMS capture [India, approved build only], auto-approve time, notifications, lock-screen approve, learned merchants & blocked senders [v1.3.6]) · Privacy (app lock, hide amounts, app-switcher blur) · Data (backup, restore, export CSV, import CSV, storage, wipe) · Help (how totals work, glossary, diagnostics, about). **There is no drawer.**

**Entry points:** app icon, capture notification, home-screen widget and share intent all pass the app lock check first; a share received while locked is queued and delivered after unlock. Tablet uses a navigation rail when width allows. Back navigation follows OS conventions, state persists during brief tab changes, deep-linking never bypasses app lock.

### 5.2 Complete screen inventory

| ID | Screen | Required contents / behavior | Stage |
|---|---|---|---|
| SCR-01 | Welcome/privacy | One-line offline promise: no sign-up, no internet, no bank login | P1 |
| SCR-02 | Setup | Region and currency, payday chip, optional "Try 50/30/20?"; theme follows system | P1 |
| SCR-03 | Create account | Type, name, approximate balance today ("rough is fine"), skip | P1 |
| SCR-04 | Home | "Left in budget" hero (fallback "Spent this period"; over the limit it reads "Over budget ₹X", unsigned, with a warning icon [v1.3.6]), in-accounts and card dues line, hide-amounts eye, "N to check" card when pending, reorderable Home cards | P1 |
| SCR-05 | Home card editor | Reorder, hide, reset, compact/full cards | P1 |
| SCR-06 | Accounts list/detail | "Money you have" and "Money you owe" groups, never summed; "balance not set" accounts flagged; Pay card bill; archive | P1 |
| SCR-07 | Activity | Day groups with refund-net "Spent" totals [v1.3.6], row states per TXN-006, search, filter chips, "Show rejected" | P1 |
| SCR-08 | Transaction detail | Type, account, category, source/provenance, split, notes; Delete (manual) or Reject · Not mine (captured) | P1 |
| SCR-09 | Add sheet | Amount-first keypad, quick-category chips, account defaulted per category, Snap receipt / Share from UPI chips, Save + "Save & add another" | P1 |
| SCR-10 | Review queue | Pending captures, possible duplicates with side-by-side evidence, import checks; merge / keep separate / reject | P1 |
| SCR-11 | Insights overview | Period picker (payday cycle default), scope-labelled KPI tiles, question-ordered sections | P1 |
| SCR-12 | Insight drill-down | Interactive filtered chart, "View as table", source transactions | P1 |
| SCR-13 | Plan hub | "Before payday" timeline with "Free to use", setup cards when empty; Budgets, Bills & Recurring, Goals sections | P1 |
| SCR-14 | Budget list/editor | Amount, scope, period, thresholds, status; 50/30/20 template | P1 |
| SCR-15 | Budget detail | Progress, category contributors, history | P1 |
| SCR-16 | Bills/recurring | Manual rules with kind, due date, reminders, paid status linked from captures; Subscriptions filter with monthly-equivalent total and past charges | P1 |
| SCR-17 | Savings goals | Goal amount, set-aside vs moved contributions, progress | P1 |
| SCR-18 | Categories | Add/edit/icon, colour picked only from the 12-hue category palette (seeded categories pre-assigned) [v1.3.6], category type (need/want), archive | P1 |
| SCR-19 | CSV import wizard | Preview, columns, account, duplicate review, commit | P1 |
| SCR-20 | Exports/backup | CSV export, encrypted backup/restore, warnings | P1 |
| SCR-21 | Settings hub | Grouped You / Money / Capture / Privacy / Data / Help (§5.1) | P1 |
| SCR-22 | Diagnostics | Local database/export status, optional permissions help | P1 |
| SCR-23 | Receipt OCR review | Category totals first, items collapsed, "Not itemised" row, Paid-with chip, match prompt | P1 |
| SCR-24 | SMS permission/review | Pre-permission explainer ("what we keep" vs crossed-out OTP), status, capture review, OEM help | P1-IN, approved build only |
| SCR-27 | Capture dialog (bottom sheet) | A bottom sheet inside the dialog-styled activity (CAP-002), over the dimmed current app, opened from a capture notification or share [v1.3.6]; category icon grid, batch cards, credit types, new-account prompt, block sender | P1 (SMS/UPI sources P1-IN) |
| SCR-28 | Learned merchants & blocked senders | Edit/forget learned merchant, UPI ID, item and payment-account mappings; clear "mixed" flag; unblock senders | P1 |
| SCR-29 | Home-screen widget | Snap receipt / Add expense / "N to check" text; no amounts unless enabled and app lock off | P1 |
| SCR-30 | Needs / Wants / Savings | Three bars against 50/30/20 (or custom) targets for the period, drill-down to categories | P1 |
| SCR-31 | Long-task loader | Coin-flip loader with progress and reassurance copy for restore, import and receipt reading | P1 |
| SCR-25 | Automation rules | Merchant normalization, auto-categorization, exclusions | P2 |
| SCR-26 | Advanced reports | Heatmap, forecasts, period comparisons, PDF export | P2 |

### 5.3 Responsive rules

- Mobile portrait 320–430 logical px is baseline; layouts must adapt to narrow screens and large text.
- Tablet [v1.3.6]: at width ≥ 600dp the bottom tabs become a navigation rail and content is centred at a maximum content width; two-pane Activity–Detail is Phase 2 (§4.2).
- Large-screen devices: preserve alignment and readable chart widths; no horizontal clipping.
- Landscape: keep core tasks usable; respect safe areas, display cutouts, keyboard and gesture regions.

## 6. UX and visual design contract

### 6.1 Principles

1. **Visual before verbose:** strong numerals, bar/ring/sparkline chart, icons and compact statements; explanations available by tap.
2. **Progressive disclosure:** overview → filtered detail → individual transactions.
3. **Financial transparency:** every metric has a formula, period, account scope and drill-down.
4. **Correctness over delight:** never animate stale or approximate data as a confirmed balance. No count-up number animations; loading uses skeletons, and the real value fades in when ready. No spinners in the main app.
5. **Trust over pressure:** alerts helpful, adjustable, never guilt-inducing; no dark patterns.
6. **Accessible by default:** color plus icon/text, touch targets, voice labels.
7. **Effortless capture:** the common case is one tap (Approve) or zero taps (auto-approve); every correction teaches the app so it asks less over time; every automated decision is reversible.
8. **Honest about gaps:** totals and timelines say what they don't know ("+1 account not set", "Showing 3 bills you added"), never imply completeness.
9. **Features appear when useful:** empty sections show setup cards; tips appear the first time something happens, not as an upfront tutorial.

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

Tokens are subject to WCAG AA testing (small text ≥4.5:1; non-text UI where applicable ≥3:1). Chart series use perceptually distinct palette, labels, and patterns when necessary; warning/red not used as the only signal. **Theme [v1.3.6]:** System/Light/Dark; teal is the only accent in Phase 1 (no accent picker); tokens are named by role so accent themes can be added later. No arbitrary user-entered colours: users pick colours only from verified palettes (category colours: see UX [DESIGN.md › Colors › Category palette](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md)).

**Visual system additions (v1.3, revised v1.3.6):** `gradient.brand` (teal `#2DD4BF` → `#0F766E` → deep cyan `#164E63`, used on the logo tile, splash, Home hero card and the centre ＋ button); **primary buttons use only the deep segment** (`#0F766E` → `#164E63`) so their white label meets 4.5:1; `glass.surface` (a **deep-teal tinted** glass in both light and dark mode, with background blur and a 1px light border; gradients behind dark glass are strength-capped) and `glass.fallback` (solid tinted surface, no blur). Tint percentages, verified contrast ratios and fallback hex values: see UX [DESIGN.md › Colors › Gradient and › Glass](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md). See §6.6 for where glass may be used.

**Icons [v1.3.6]:** one icon library with outline and filled weights (outline by default, filled for the active tab or selected state); no emoji anywhere in the UI. The eye and warning marks in this PRD are library icons (eye / eye-slash, warning). See UX [DESIGN.md › Brand & Style](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md).

**Core component library:** screen shell, app bar, bottom tabs with centre ＋ button, tablet rail, Settings hub, glass surface (with fallback), coin-flip loader, boat illustration states, universal amount text, category icon, balance tile, KPI card, progress bar, donut/ring, area/bar charts, segmented control, date range picker, account/category chips, filters sheet, amount keypad, selection sheet, search, transaction row, empty state, skeleton, toast, alert, confirmation dialog, bottom sheet, icon button, privacy shield and error retry.

**Design scale:** 4-point spacing grid, 8–16dp corner radii according to hierarchy, 44pt iOS / 48dp Android minimum preferred primary touch target, dynamic type, reduced-motion animations, meaningful haptics only when enabled; animation duration typically 150–250ms without blocking inputs.

### 6.3 Dashboard composition (initial order)

1. Greeting + date + days-to-payday chip; Accounts icon and avatar (Settings).
2. **Hero ("Am I okay?")**: large **"Left in budget"** for the default period (DEC-33, shared with Insights and Plan). At most one overall budget exists at a time, and it always uses the default period (BDG-002). Budget used: the overall budget if one exists, counting **all** confirmed spending; otherwise, if only 50/30/20 is set, Left in budget = (Needs + Wants targets) − (Needs + Wants + **Not classified** spending), with a note "includes ₹X not classified — sort it" when X > 0; with only category budgets or none, the hero falls back to "Spent this period". Unclassified spending always reduces what is left; it is never left out. Shown with a spent-of-limit bar and days left. **Over the limit [v1.3.6]:** the label becomes **"Over budget"** with a warning icon and the amount **unsigned** ("Over budget ₹2,340", never a minus sign); the bar fills to a limit tick and then a capped overflow segment; the time line shows days only ("5 days to payday"), with no per-day figure and no nudge copy. A smaller line below shows **In accounts** (known funds, labelled "+N account not set" when applicable) and **Card dues**, never summed together; eye-icon hide-amounts toggle (remembered). Without a usable budget the large number is **"Spent this period"** with "Set a limit →". Four hero states (budget/no budget × accounts configured/not) are specified in the UX deliverable.
3. "N to check" card, only when captures are pending.
4. Income and expense for the period; net cash flow chip.
5. Per-category budgets (e.g. "Food 85% · Shopping 40%"); the overall figure lives in the hero.
6. Needs / Wants / Savings (when 50/30/20 is in use).
7. Top categories, ranked bars with icons.
8. 7-day spend.
9. Coming up (bills and subscriptions) and savings goal.

`Safe to spend` is not on Home; it appears on Plan as **"Free to use"** only when its completeness gate passes (BDG-008). Each card has a clear period label.

Each card supports tap-to-details (where applicable) and a clear period label. User can hide/reorder supported cards and restore defaults. Data refreshes on database changes, app resume, filter changes and device date change.

### 6.4 Mandatory interaction states

Every screen **MUST** specify in its UX deliverable: `initial`, `loading`, `empty`, `populated`, `error`, `partial/import-review`, `permission-denied`, `read-only` where relevant, `confirmation`, `success`, `offline` (if relevant). Charts with <2 comparable points must not invent trend direction. Missing account information must not be displayed as zero unless genuinely zero.

### 6.5 Navigation and filter behavior

- Default period (DEC-33): payday cycle when a payday is set, otherwise calendar month; Insights and Plan always share the selected period. Calendar month is one tap away in the period picker.
- Selected period persists when navigating Insights subviews; changing global filter updates relevant KPI and chart labels, and filtered KPIs state their scope (e.g. "Spent · HDFC only").
- Filtering Activity does not change Home balances unless Home explicitly receives that account/period context.
- Date presets: This pay cycle and Last pay cycle (when a payday is set), Today, Yesterday, 7 days, This month, Last month, This quarter, This year, Custom; custom endpoints inclusive in the user's configured timezone.
- Filters: account, type, category/subcategory, merchant, amount range, source, status, payment method and tags (if present).
- Search indexed by merchant, note, category, reference, amount; never send search strings off-device.
- Clear filters and show active-filter count; saved filter presets are Phase 2.

### 6.6 Brand and visual identity

- **Name and tagline:** *wmbugo* stands for **where my budget goes**, used as the tagline in every lockup. Store listing line: *Private Money, Made Clear*.
- **Mark:** a coin on a `gradient.brand` tile. Front: a **w** whose last stroke ends in an up-right arrow (*goes*). Back: a **50/30/20 pie** (needs, wants, savings; *where*). The still app icon shows the pie face. Monochrome Android themed icon and notification small icon are single-colour versions of the pie.
- **Motion:** the coin flips between faces with visible thickness and a reeded edge, then pauses on each face. Used on the splash (Android 12+ system splash plays at most a ~1 s half-flip; the full loop continues in-app) and in SCR-31 long-task loaders. Production asset is a single motion file reused across surfaces (format in `addendum.md`). Reduced motion: no flip; the pie face is shown still.
- **Illustration:** the paper boat on water is the brand illustration for empty states and calm waiting ("You're all caught up", "No transactions yet"). It is never used as the app icon.
- **Glass:** allowed only on floating surfaces: Home hero card, bottom tab bar, Add sheet, capture dialog sheet (SCR-27), small pills. Never on lists, Activity rows or behind small text. **[v1.3.6]** Glass is a deep-teal tint in both light and dark mode (not translucent white), strong enough that text on it meets 4.5:1 over the worst-case backdrop, including white list content scrolling beneath it; any gradient behind dark glass is capped in strength (values: UX [DESIGN.md › Colors › Glass](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md)). Large numbers sit on the darkest, most uniform part of the glass and must meet 4.5:1. `glass.fallback` (solid, no blur) is used on devices without efficient blur support and when battery saver is on, when the system animator duration scale is 0 (Android "remove animations"), or on Android versions without efficient blur (below API 31); the fallback keeps the same layout, hierarchy and contrast as the glass version and is checked in the M4 usability sessions.
- **Gradients:** splash, logo tile, Home hero, centre ＋ button, capture dialog header; primary buttons use only the deep segment of the gradient (§6.2) [v1.3.6]. Charts and text never sit on a gradient without a solid backing.

### 6.7 Voice and copy

- **Calm, not guilty.** Overspending is stated as a fact with the number ("Over budget ₹2,340 · 5 days to payday") [v1.3.6], never as blame ("You overspent!"). No minus signs in the UI: expenses are unsigned, income and refunds carry "+", and the icon and label carry direction. A net figure where refunds exceed spending is shown unsigned with "back" and the refund icon ("Shopping · ₹7,000 back"); in charts its bar sits at zero with a "₹7,000 back" label [v1.3.6]. No red for anything that isn't a real problem; a not-itemised receipt amount is grey.
- **Reassure on reversible actions.** "You can always undo." "Rejected items stay under Show rejected."
- **Lower the bar to start.** "Rough is fine." "Off by a bit? Adjust balance." Setup cards say what to add, not what's missing.
- **Say what we don't know.** "+1 account not set." "Showing 3 bills you added." "Not enough information yet."
- **No pressure vocabulary.** Never "Inbox", never numeric badges, never "You have N unread". Pending items read "N to check".
- **Plain words for money states.** Left in budget, Free to use, Kept, Recorded, Waiting for you. Accounting terms (posting, adjustment, excluded) stay out of the UI except where the user edits them.
- **Celebrate lightly.** Empty states use the boat illustration ("You're all caught up · Smooth sailing").

## 7. Core financial model and invariants

### 7.1 Money representation

**FIN-001:** Store amounts in signed **integer minor units** using the profile currency's ISO 4217 exponent (paise/cents = 2 decimals; JPY = 0; BHD/KWD/OMR = 3); the exponent is stored with the profile, never assumed. UI formats amounts by the user's region (e.g. ₹1,25,000 in India, $125,000 in the US, 125.000 € in Germany) through one shared formatter. Reject NaN, infinity, overflow, negative input where an absolute magnitude is expected, and more decimal places than the currency allows (the keypad blocks them; it never rounds silently). Never use IEEE floating-point `REAL` for currency persistence.

**FIN-002:** Store transaction effective time as UTC instant plus chosen local timezone/offset for grouping; support date-only items such as planned bills separately. **Timezone rule [v1.3]:** each transaction's `local_date` is fixed at capture in the zone where it happened and never re-grouped later. Periods, payday cycles and the auto-approve cutoff use the **profile timezone**. When the device timezone differs from the profile timezone by **2 hours or more for more than 24 hours**, the app asks once "You're in Dubai time — use it for your budget days?"; the profile timezone changes only on Yes, and only from the next day. **Period membership** always uses a transaction's `local_date` (the date where it happened), never its UTC instant re-converted. **Date-only imports** (CSV rows without a time) take their `local_date` as written and are treated as in the profile timezone. Daylight-saving shifts never move a transaction to another day; a cutoff that falls in a skipped hour runs at the next valid time.

**FIN-003:** Distinguish `expense`, `income`, `transfer`, `opening_balance`, `adjustment`, `refund`, and `reversal` in the domain. UI can simplify types, but storage must retain intent and provenance.

### 7.2 Accounts and balances

**FIN-010:** Account types: cash asset, bank asset, payment wallet asset, **savings pot** (savings & investments destination, ACC-009), credit-card liability. Each has stable ID, name, icon and colour (from the 12-hue palette, defaulted by account type; see UX DESIGN.md › Category palette) [v1.3.6], the profile currency (DEC-05), opening balance and effective date (or "balance not set"), active/archive status, and optional masked identifiers (e.g. ••7730, stored per sender in `account_identifier`) used to match captures.

**FIN-016:** Transactions dated before an account's opening date appear in Activity and Insights, marked "before tracking started", but **do not change that account's balance**. The opening balance applies at the instant the account is created (for accounts discovered from a capture, just before the discovering transaction, CAP-009): a same-day transaction timed earlier than that instant is "before tracking started". The opening date is never moved automatically; a wrong opening balance is corrected with an explicit adjustment.

**FIN-011:** Asset account balance = opening balance + net asset postings. Credit card outstanding = opening liability + charges - payments - credits; show as money owed, **not** a negative cash balance silently mixed with assets.

**FIN-012:** User-defined known-funds dashboard value is the sum of included **asset** accounts; do not treat credit limit as available money. Net worth may separately calculate assets minus known liabilities, labeled clearly and optional.

**FIN-013:** Transfers between owned accounts create balanced atomic postings; **never** count as earned income or spent expense. Cash withdrawal and paying a card bill are transfers when both accounts are modeled.

**FIN-014:** Editing or reversing a confirmed event updates postings, analytics and budgets atomically. Deletion is soft by default, with user-visible undo. **Retention [v1.3]:** soft-deleted manual entries are purged permanently 30 days after deletion; rejected captures are kept 90 days (restorable under "Show rejected") and then purged; purged rows keep only a **tombstone**: a salted hash of the item's duplicate fingerprint (FIN-027), its outcome (rejected or deleted) and the date — no amount, merchant or text. A later import or capture matching a tombstone is skipped and reported as "previously rejected" (or "previously deleted"); the import report offers **"Import anyway"** per row so a mistaken rejection can be undone. Import rows excluded in review follow the same 90-day retention and tombstone rule as rejected captures. Deleted manual entries are listed for 30 days under **Settings → Data → Recently deleted**, with **Restore** and **Delete permanently**; rejected captures are listed for 90 days under Activity → "Show rejected", with Restore and Delete permanently. Delete permanently purges immediately after confirmation. **Linked items:** permanently deleting one leg of a transfer shows "This is part of a transfer — both sides will be deleted" and, after confirmation, deletes both legs together; permanently deleting a purchase that has a linked refund removes the link and keeps the refund as an unlinked refund. Purges propagate to the next backup; older backup files are the user's own copies (SEC-008).

**FIN-015:** Archived accounts preserve history and balances; accounts with historical postings cannot be hard deleted. Balance corrections are explicit auditable adjustments, never silent replacements.

### 7.3 Transactions, splits, refunds

**FIN-020:** Each transaction includes `id`, `type`, `status`, integer amount, currency, effective_at, created_at, updated_at, account posting links, category splits, merchant/payee, payment method, optional reference/notes/tags, source metadata, and optional attachment link.

**FIN-021:** Expenses decrease assets or increase liabilities; income increases assets. Payments to a card or other liability are **transfers** (FIN-013), never income or expense. Refunds and reversals follow FIN-028 and show as refund, never as income.

**FIN-022:** Sum of a transaction's category allocations **must equal** its categorisable absolute amount. Parent receipt total must equal sum of items plus taxes/fees minus discounts and adjustments within a documented tolerance (exact minor units after rounding allocations). Missing OCR items are handled by an explicit "Not itemised" split row (TXN-009), never ignored.

**FIN-023:** Reimbursement may be represented as a refund/recovery linked to original expense; always offer both net and gross views, never subtracting the same recovery twice.

**FIN-024:** Transaction status values: `draft`, `needs_review`, `confirmed`, `excluded`, `reversed`, plus `possible_duplicate` review flag. Only confirmed non-excluded items contribute to headline totals; provisional review counts shown separately. A captured item awaiting Approve/Reject is `needs_review`; Approve sets `confirmed`; Reject sets `excluded`. Auto-approve follows FIN-026. Every capture records `capture_resolution` = `user_approved | auto_approved | auto_linked | rejected`, which distinguishes rejected captures from user-excluded manual entries. Pending captures, review-queue items and the widget's pending count are the same set: all `needs_review` items. Excluded captures remain visible greyed out under "Show rejected" and can be switched back to `confirmed`, updating balances atomically (FIN-014). Scam-flagged SMS (SMS-011) create no transaction; at most a redacted `source_record` is kept for the warning.

**FIN-026 [v1.3] Auto-approve materialization:** (1) The cutoff (default 21:00) is in the profile's timezone (FIN-002). (2) Auto-approval is **always a write, never derived on read**. Eligible captures (CAP-007) from before the cutoff stay `needs_review` — "Waiting for you" on every surface (Home, Activity, review queue, widget count, evening summary, exports, duplicate checks) — until they are written. (3) They are written by whichever runs first after the cutoff: a best-effort background job, or the next app open or resume. One database transaction writes them as `confirmed` with `capture_resolution = auto_approved` and an audit row each; transfer auto-linking (CAP-012) happens inside that same transaction; only after the commit do budget threshold alerts (BDG-004) run, exactly once. Auto-approval never links a bill rule (REC-009 still asks) and never teaches learning (LRN-008). (4) Auto-approve settings are versioned (`auto_approve_rule` history). A **loosening** change — turning auto-approve off or moving the cutoff later — applies **immediately** to captures not yet written. A **tightening** change — turning it on or moving the cutoff earlier — applies **from the next day**, so nothing is approved sooner than the user expected. No change ever re-evaluates already-written days or rewrites past totals. (5) A capture that stops being eligible before it is written (e.g. a duplicate arrives) stays `needs_review`. (6) **Clock guard:** at each app open and job run the app stores `(wall_time, elapsed_since_boot, boot_count)`. Within the same boot, time is taken from the elapsed-since-boot difference. After a reboot, the wall clock is trusted only if it is at or after the last stored wall time and no more than 30 days later; otherwise auto-approve is skipped until the next open and the captures simply wait. The stored "latest time" is never allowed to be more than 1 day ahead of the current time, so a bad clock jump cannot block auto-approve for long.

**FIN-027 [v1.3] Duplicate matching:** a duplicate key is (reference, direction, event type) — a same-reference item in the opposite direction is never a duplicate; it is classified by account: if the credit lands in the **same account** the debit left (or its text says reversed, refund or failed), it is a reversal or refund (FIN-028); if it lands in a **different account the user owns**, the two legs are linked as one own-account transfer (FIN-013); if the credit's account is not yet known, the pair is held for review ("Reversal, or a transfer between your accounts?"). If **both** items carry a reference and the references **differ**, they are always distinct and never fuzzy-matched. This rule applies to duplicate matching only: **transfer pairing** (CAP-012, IMP-002) is a different check and pairs a debit and a credit across two owned accounts even when their references differ. Windows differ on purpose: duplicates ±1 day (the same event reported twice), capture transfer legs ±3 days (bank and card SMS can lag), CSV transfer pairs ±2 days (statement posting dates). Only when **at least one** item has no reference (a receipt, a manual entry, a CSV row or SMS without one) are two items possible duplicates when the amount is equal, the dates are within ±1 day, and the merchant/payee matches after normalization (LRN-009); for receipts, a card or bank charge 0–30% above the receipt total from the same merchant on the same day (tips) is also a possible match. Two manual entries of the same amount at the same merchant are only flagged if entered within 10 minutes of each other. **CSV rows:** rows from the same file are never matched against each other, nor against rows already committed from that same file. Identical rows are fingerprinted with an occurrence index **within their (date, amount, description) group**, so the Nth identical row is distinct and lines up on a later re-import. When a file starts or ends partway through a day (its first or last date is only partly covered), that edge day's rows go to review instead of being auto-skipped or auto-added. **Merge** produces one transaction that takes the best of each record by **source authority**: account, amount and time come from bank, card or UPI evidence first, then CSV, then receipt, then manual entry; items and splits come from the receipt; the category is the user's choice; every source record and attachment is kept. If the amounts differ (e.g. a tip), the bank amount wins and the difference becomes a "Tip / adjustment" split in the receipt's main category. The merged-away record is excluded with an audit row.

**FIN-028 [v1.3] Refunds and reversals:** a refund is linked to its original when known (`refund_of_transaction_id`). It reduces spending **in the refund's own period**, in the original's category (or a chosen category if unlinked), and reduces Needs/Wants by that category's type. A refund is never income and never counts in "Kept" income. A reversal of a failed payment cancels the original debit in the original's period, even if that period has ended; budget alerts that already fired for that period do not fire again.

**Capture status mapping** (shared contract for UX and architecture):

| Session vocabulary | Stored state | Counted in totals | User label |
|---|---|---|---|
| pending | `needs_review` | No | Waiting for you |
| held | `needs_review` + `possible_duplicate`, or SMS-011/012 flag, or incomplete parse | No; never auto-approved | Possible duplicate — check it / Waiting for you |
| scam | no transaction; redacted `source_record` | No | Looks like a scam — not added |
| auto-confirmed | `confirmed` + `auto_approved` (written, FIN-026) | Yes | Recorded · category guessed (or Recorded · needs a category) |
| auto-linked transfer | `confirmed` transfer + `auto_linked` | Yes (as a transfer, never spending) | Recorded · linked as transfer (with "Not a transfer") |
| manual possible duplicate | `needs_review` + `possible_duplicate`, manual source | No | Possible duplicate — check it |
| confirmed | `confirmed` + `user_approved` | Yes | Recorded |
| excluded | `excluded` + `rejected` | No | Rejected (greyed, restorable) |

User-facing state labels: **Recorded** (confirmed by user), **Recorded · category guessed** (auto-approved), **Waiting for you** (`needs_review`), **Possible duplicate — check it** (`needs_review` + `possible_duplicate`), **Rejected** (`excluded` capture). A manual entry removed by the user shows the word **Delete**, is soft-removed (`excluded`, hidden everywhere including "Show rejected"), keeps its audit row, offers Undo, and stays in backups made before it is purged (FIN-014).

**FIN-025:** `Merchant` normalization is editable and retains original source strings. User corrections supersede auto-categorization and are learned locally per LRN-001–LRN-010 (visible, editable, never transmitted).

### 7.4 Ledger integrity acceptance rules

- For any internal transfer, combined owned-asset posting sum is zero, ignoring separately explicit fees.
- For any split, allocation sum matches categorisable amount exactly.
- Importing same file twice must not duplicate confirmed entries.
- OCR of an existing SMS/manual expense must not automatically create a second confirmed expense.
- Auto-approve never confirms a capture that is flagged `possible_duplicate`, has an open review candidate, or matches an existing confirmed transaction.
- Every capture source reaches the ledger only through the shared pipeline (DEC-29); no source posts directly.
- Amounts round-trip exactly through store → format → parse for every supported currency exponent.
- Opening balance and later adjustment must be distinguishable from income in charts.
- Expenses, refunds, reversals, and credit-card payments reconcile across charts and accounts.
- Large-value and repeated edits must not introduce rounding drift.
- All ledger mutations are transactional with integrity validation and rollback.

## 8. Functional requirements — detailed modules

### 8.1 Onboarding and initial configuration (ONB)

- **ONB-001 [SRC]:** App opens without registration, phone number, email, or network.
- **ONB-002 [v1.3]:** First-use flow, target under 2 minutes: ① Welcome, which *is* the privacy screen (one line, three facts: no sign-up, no internet, no bank login); ② region and currency (pre-selected from the device region, confirmed by the user; sets formatting and which capture features exist, §13.0a); ③ one account ("Where's most of your money?": type, name, approximate balance today, "rough is fine", skippable); ④ payday chip (1st / last day / last working day / other / not salaried); ⑤ optional "Try 50/30/20?"; → Home. Theme follows the system and is changed in Settings.
- **ONB-003 [NEW]:** Allow skipping the account, but Home shows *balance not configured* instead of implying financial accuracy.
- **ONB-004 [NEW]:** Permission prompts are contextual and just-in-time; never request SMS/photo/notification permissions as an onboarding requirement.
- **ONB-005 [v1.3]:** No upfront tutorial. One contextual tip the first time each thing happens (first Home view: "This is money in accounts you've added"; first capture: "Approve to keep, Reject to ignore — you can always undo"; first budget). Tips never insert data into real finances.
- **ONB-006 [NEW]:** Settings permit later changes; changing budget period triggers reaggregation, not transaction mutation.
- **ONB-007 [v1.3]:** Further accounts are discovered from captures (CAP-009) or added manually; onboarding never asks for more than one.
- **ONB-008 [v1.3]:** App lock is offered once, after the first saved entry ("Lock wmbugo with your fingerprint?"), not during onboarding.

**Acceptance:**
- **Given** a fresh install in airplane mode, **when** the user completes onboarding, **then** Home is usable and an account and a manual expense can be added, all within 2 minutes in a moderated test.
- **Given** a device whose region is India and language is English (US), **when** onboarding reaches step ②, **then** India and INR are pre-selected and the user must confirm them.
- **Given** the user picked USD by mistake and has no transactions, **when** they change currency in Settings, **then** the change is allowed.
- **Given** every permission is denied, **when** the user adds an expense, **then** the same essential paths work.
- **Given** the first saved entry, **when** the sheet closes, **then** the app-lock offer appears once and never again after dismissal.

### 8.2 Accounts (ACC)

- **ACC-001:** Create, rename, reorder, hide/archive and view accounts.
- **ACC-002:** Configurable opening balance/date, account-level transaction timeline and account-local reconciliation adjustment with reason.
- **ACC-003:** Credit card shows **outstanding** (everything currently owed, from the ledger), an optional **statement due** amount and due date entered by the user, and an optional limit; do not imply an actual bank connection.
- **ACC-004:** On closing/archive warn about nonzero balances or pending transfers; retain history.
- **ACC-005:** Include/exclude eligible account assets from overview while retaining explicit label, preventing misleading totals.
- **ACC-006 [v1.3]:** Accounts list groups **Money you have** (assets) and **Money you owe** (cards), never summed into one figure unless the user enables net worth. Totals that exclude an account with "balance not set" say so ("+1 account not set").
- **ACC-007 [v1.3]:** Credit cards offer **Pay card bill**, which opens the Add sheet as a Transfer from a chosen asset account to the card, amount pre-filled with the statement due when entered, otherwise the outstanding. Home "Card dues" always means outstanding.
- **ACC-008 [v1.3]:** A rough opening balance is corrected with "Adjust balance" (an explicit adjustment posting), never by editing the original amount.
- **ACC-009 [v1.3] Savings pots:** a **savings pot** is a destination for money the user is saving or investing (e.g. "SIP – Axis MF", "RD – SBI", "Emergency fund", "PPF"). Its balance is optional ("balance not set" is normal, since market values are not tracked). An everyday bank account is never a savings pot, whatever the bank calls it ("Savings Account" in India is an everyday account). Money moved into a pot is a transfer, never spending, and is what the 50/30/20 Savings share counts (BDG-009). Pots with a known balance count in "In accounts" unless excluded (ACC-005); pots without a balance are shown separately as "Saved & invested" totals of money moved in.

**Acceptance:**
- **Given** any edit, reversal, import or transfer, **when** account detail renders, **then** its total equals the ledger-derived balance; archived accounts remain searchable.
- **Given** a card with ₹8,200 due, **when** the user taps Pay card bill and saves from HDFC, **then** card dues fall by ₹8,200, HDFC falls by ₹8,200, and spending is unchanged (ACC-007).
- **Given** an opening balance of ₹30,000 entered roughly, **when** the user adjusts it to ₹31,200, **then** a +₹1,200 adjustment posting is created and the original opening balance is unchanged (ACC-008).
- **Given** a savings pot "SIP – Axis MF", **when** a ₹5,000 SIP debit SMS from HDFC is captured and the user picks "Saved / invested → SIP – Axis MF", **then** it is recorded as a transfer, Left in budget is unchanged, and the Savings bar rises by ₹5,000; the next month's SIP debit from the same mandate is learned and auto-linked the same way (`auto_linked`) (ACC-009, LRN).
- **Given** Arjun's everyday HDFC "Savings Account", **when** he pays his card bill and withdraws cash from it, **then** the Savings bar is unaffected, because an everyday account is not a savings pot.
- **Given** an expense dated before an account's opening date, **when** saved, **then** it appears in Activity marked "before tracking started" and the balance does not change (FIN-016).

### 8.3 Transaction CRUD, search and review (TXN)

- **TXN-001:** The Add sheet (centre ＋) offers Expense / Income / Transfer plus *Snap receipt* and, in India, *Share from UPI app*. CSV import is in Settings → Data, not on the Add sheet.
- **TXN-002:** Expense form is **amount first**: large amount with keypad open immediately, then one tap on a quick-category chip, then Save. Optional merchant, date/time (default now), note, payment method, receipt attachment. Account defaults to the account last used **with that category**. Quick-category chips are the most-used categories, recalculated at most once a day and never reordered while the sheet is open. After Save the sheet closes with an Undo toast; a secondary **"Save & add another"** keeps it open.
- **TXN-003:** Income form: amount, destination account, income category/source and optional note.
- **TXN-004:** Transfer form: from + to, distinct accounts, amount, date/time, optional fee as separate expense; reject self transfer and insufficient available funds only if user opts into a balance-enforcement rule (otherwise warn about possible mismatch).
- **TXN-005:** Edit, duplicate-as-new, reverse and undo; no deceptive irreversible action. The remove action reads **Delete** for manual entries and **Reject · Not mine** for captured entries (FIN-024).
- **TXN-006 [v1.3.6]:** Activity timeline groups by date with direction icon/colour, merchant, category, amount, account and status; expense amounts are unsigned, income and refunds carry "+", and no minus sign is shown (§6.7). Day headers show **Spent** for that day (for the filtered set when filters are active), **refund-net**: confirmed expenses minus refunds received that day (FIN-028), floored at ₹0 (BDG-006); transfers, income, pending (waiting, possible duplicate), reversed and rejected items are excluded. It is computed by the read model, never summed in UI components. Row states: confirmed (plain), guessed (small "guessed" tag), needs a category (small "add category" tag), waiting (dashed outline), waiting for an amount in your currency (dashed outline with currency tag, TXN-013), possible duplicate (warning row with "Check"), transfer (transfer icon, neutral colour), refund (return icon, shown as money back), reversed (struck through, with the reversal linked), before tracking started (small tag, does not move the balance), and rejected (greyed, only under "Show rejected").
- **TXN-007:** Full-text/local indexed search; combinable filter sheet; sort newest/oldest/highest amount/merchant; pagination/virtualization.
- **TXN-008:** The review queue is exactly the set of `needs_review` items (FIN-024): ambiguous imports, suspected duplicates and pending captures; user can confirm, link to existing, exclude or correct. Confirmed entries carrying the `needs_category` flag are listed separately under "Add a category" and do not count in "N to check".
- **TXN-012 [v1.3]:** A manual entry that matches an existing confirmed item (FIN-027) is saved — the save is never blocked — but as `needs_review` + `possible_duplicate`, so it is **not counted**. The Add sheet's success toast reads "Looks like this is already recorded — Keep both / Merge"; the entry also waits in the review queue. It is never auto-approved. *Keep both* confirms it; *Merge* follows FIN-027.
- **TXN-013 [v1.3]:** A capture, receipt or import row in a currency other than the profile currency is never auto-approved. It opens review showing the foreign amount and currency, and the user enters the amount in the profile currency (e.g. the amount charged on the card); the original foreign amount is kept as source metadata. No exchange rate is fetched or suggested.
- **TXN-009:** Create split allocations among categories with strict sum reconciliation, including an *unallocated* placeholder while editing; Save is blocked while any amount is unallocated. A receipt's "Not itemised" amount is not unallocated: it is a split row to the seeded Uncategorised category (`receipt_item.unparsed = true`).
- **TXN-010:** Bulk recategorization of confirmed transactions requires preview and undo; never silently change finance amounts.
- **TXN-011:** Receipts and source metadata survive edits without duplicate attachments; user can detach/delete images explicitly.

**Acceptance:**
- **Given** a returning user, **when** they add an expense with the Add sheet, **then** median entry time is ≤ 15 seconds in a moderated test (target about 6 seconds).
- **Given** a confirmed ₹450 Swiggy capture at 13:05, **when** the user manually enters ₹450 Swiggy at 13:10, **then** the new entry is saved as "Possible duplicate — check it", is not counted, and the toast offers Keep both / Merge (TXN-012).
- **Given** two genuine ₹20 teas entered 40 minutes apart, **when** both are saved, **then** neither is flagged as a duplicate.
- **Given** two ₹20 UPI payments to the same tea stall on consecutive days with different UPI references, **when** both are captured, **then** neither is flagged as a possible duplicate.
- **Given** a ₹2,340 receipt saved at 13:00 with Paid with Cash and 14 itemized lines, and a ₹2,340 card SMS at 18:00, **when** the user taps Merge, **then** one transaction remains on the card account with the 14 item splits, Cash is unchanged, and both the receipt and the SMS are kept as sources.
- **Given** a ₹1,000 restaurant receipt and a ₹1,150 card charge from the same merchant on the same day, **when** merged, **then** the transaction is ₹1,150 with a ₹150 "Tip / adjustment" split.
- **Given** a receipt in EUR while the profile is GBP, **when** it is saved, **then** it waits for review until the user enters the GBP amount, and the EUR amount is kept as source metadata (TXN-013).
- **Given** any filter, **when** Activity shows a total, **then** it equals the sum of the listed records (for day-header Spent, the refund-net sum floored at ₹0, TXN-006); a status change never double-counts.
- **Given** a day with a confirmed ₹1,500 fuel expense, a ₹1,299 refund received, a ₹5,000 transfer, ₹85,000 salary income and a ₹300 capture still waiting, **when** Activity renders that day, **then** its header reads "Spent ₹201"; **given** a day whose only entry is a ₹1,299 refund, **then** its header reads "Spent ₹0" (TXN-006) [v1.3.6].

### 8.4 Category management (CAT)

- **CAT-001:** Seed categories: Food & Drinks, Groceries, Transport, Housing, Bills & Utilities, Shopping, Healthcare, Entertainment, Education, Travel, Personal Care, Family, Other; income categories Salary, Freelance, From people, Gifts, Interest, Refunds (refunds still typed distinctly).
- **CAT-002 [v1.3.6]:** User can add/rename/reorder/archive categories and subcategories, choose an icon and choose a colour only from the 12-hue accessible category palette; seeded categories come with a pre-assigned colour. Palette values and contrast: see UX [DESIGN.md › Colors › Category palette](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md).
- **CAT-003:** Category types prevent accidental use of expense-only categories as income without an explicit mixed-use choice.
- **CAT-004:** Archive/merge requires remap preview, history preservation and no destruction of original source metadata.
- **CAT-005:** Default automated category suggestion can be overridden per transaction; automatic learning from corrections is Phase 1 (LRN); a user-authored rule editor (SCR-25) is Phase 2.
- **CAT-006 [v1.3]:** Every expense category carries a **type**: `need` or `want`. Seeded categories have defaults (e.g. Housing, Groceries, Bills & Utilities, Healthcare, Transport, Education → need; Food & Drinks, Shopping, Entertainment, Travel, Personal Care → want), all editable. Saving is never an expense category: the Savings share of 50/30/20 is measured from transfers (BDG-009). A seeded **Uncategorised** category has no type; it, OCR-005 "Not itemised" amounts, and any category without a type appear as a fourth **Not classified** segment in the 50/30/20 view. The type is present from the first schema version.

**Acceptance:**
- **Given** a category with 40 confirmed transactions, **when** it is archived and remapped to another category, **then** the preview lists all 40, history keeps the original category name in source metadata, and totals for every past period are unchanged.
- **Given** a seeded "Food & Drinks" category of type `want`, **when** the user changes it to `need`, **then** the Needs/Wants view for every period moves its spending from Wants to Needs and no transaction amount changes.
- **Given** an expense-only category, **when** the user tries to use it on income, **then** the app blocks it unless the category is switched to mixed use.
- **Given** the user adds or edits a category, **when** the colour picker opens, **then** it offers only the 12 category-palette hues and no free colour entry; seeded categories already show their pre-assigned colour (CAT-002) [v1.3.6].

### 8.5 Budgets and financial planning (BDG)

- **BDG-001 [FIX]:** Define budgets as persistent rules with monthly, weekly, custom date-range or payday-aligned periods. Do not reset ledger balances at 00:00 on month change.
- **BDG-002:** Budget targets may be overall or scoped to categories and optionally accounts; prevent ambiguous overlapping budgets from being combined into a single total without labeling. **At most one overall budget** exists at a time, and its period is always the default period (DEC-33); **changing the payday** ends the current cycle on the day before the next occurrence of the new payday and starts the new cycle on that payday; Home, Insights, Plan, the overall budget and the 50/30/20 targets all switch at that same moment. The shortened cycle's targets are pro-rated by days and labelled "shortened cycle". Category budgets may use their own periods and are labelled with them.
- **BDG-003:** Show used, remaining, percentage, days remaining, projected spend and status: on-track, nearing limit, exceeded, insufficient-data.
- **BDG-004:** Threshold alerts at configurable percentages, suggested defaults 75%, 90%, 100%, with per-budget mute controls. When one change crosses several thresholds, only the highest crossed fires. Each threshold fires at most once per budget per period, even if spending drops below it and crosses it again (`budget_alert_fired`).
- **BDG-005 [SRC/FIX]:** No rollover by default; prior budget period records remain queryable, and switching periods is derived from transaction dates. Optional rollover is **future** and must not be implemented implicitly.
- **BDG-006:** Budget used = confirmed expenses minus refunds (linked or categorised, FIN-028) in the period; transfers excluded. **Floor at zero:** a category total, a Needs/Wants bar or a budget's "used" never goes below zero. For the overall budget and Needs/Wants, each category is floored at zero **first** and the floored values are then added, so Home's Left in budget always equals the target minus the visible category bars; any refund surplus is shown beside it as "Refunds this period: +₹X" and never increases Left in budget or Free to use. Insights totals stay exact and include the full refund.
- **BDG-007:** Allow target edits effective now or next period, preserving historical version information; a target change effective now recalculates only the current period, and past periods keep the target they had.
- **BDG-008 [v1.3.6]:** `safe_to_spend` may appear only if user designates applicable asset accounts and all known obligations; formula: `min(budget_remaining, included_available_assets - reserved_known_obligations)` (no floor: a negative result is shown as **"Short by ₹X"** in neutral wording), where `budget_remaining` is exactly Home's **Left in budget** (§6.3), including the 50/30/20-only form, where reserved obligations include upcoming bills in the period and virtual "set aside" goal money; label as *estimate based on entered data*, not a guarantee. When the gate does not pass, Plan shows a single next step, never a checklist of missing inputs and never a number; the step names the missing **required** input: **"Not enough information yet · Set a limit →"** when there is no overall budget and no 50/30/20, or **"Not enough information yet · Add an account →"** when a limit exists but no account is included [v1.3.6]. Bills and goals are optional and never gate Free to use. User-facing name: **Free to use**, shown on Plan only. It is distinct from **Left in budget** (BDG-003 `budget remaining`, shown on Home), which goals never reduce.
- **BDG-009 [v1.3] 50/30/20 template:** one tap creates three targets from a **user-entered** monthly (or payday-cycle) income figure, pre-filled from the last full period's confirmed salary income when available; the user is offered an update when the next period's income differs by more than 10%: needs 50%, wants 30%, savings 20%, editable. **Needs** and **Wants** are confirmed expenses by category type (CAT-006). **Savings** is **net money moved into savings pots** (ACC-009) in the period: moved in minus moved out. SIP, RD and similar debits captured from SMS are recorded via the capture choice **"Saved / invested"** as a transfer into a pot (CAP-012), never as spending. A "Moved to savings" goal contribution (GOAL-002) is a tag on such a transfer and is counted once. Withdrawals from a pot reduce the figure, which can go below zero. Moves between two pots net to zero. Savings is never counted as spending. "Set aside" goal money does not count toward Savings because it hasn't moved. INS-016 "Kept N%" remains the separate cash-flow surplus figure, labelled so it isn't confused with the Savings bar. Offered in onboarding (ONB-002 ⑤) and from Plan. The overall budget and the three type budgets are labelled separately and never added together.

**Acceptance:**
- **Given** the app is closed across midnight on a period boundary, **when** it reopens, **then** previous- and next-period records are unchanged and no balance is zeroed.
- **Given** monthly income of ₹80,000, **when** the user taps "Use 50/30/20", **then** targets of ₹40,000 / ₹24,000 / ₹16,000 are created, each editable (BDG-009).
- **Given** an overall budget exists, **when** the user tries to create a second overall budget, **then** the app offers to edit the existing one instead (BDG-002).
- **Given** a ₹3,000 refund in November for an October purchase in Shopping, **when** budgets render, **then** November's Shopping spending falls by ₹3,000, October is unchanged, and Kept income is unchanged (FIN-028).
- **Given** no overall budget **and** no 50/30/20, **when** Plan renders, **then** Free to use shows "Not enough information yet · Set a limit →" as its single next step, with no checklist and no number (BDG-008) [v1.3.6]; **given** a limit but no included account, **then** the single next step is "Not enough information yet · Add an account →" [v1.3.6]; **given** a limit and an included account but no bills or goals, **then** the gate passes [v1.3.6]; **given** only 50/30/20, **then** Free to use uses the same Left in budget figure Home shows.
- **Given** Sara's profile is London and her pay cycle starts on the 25th, **when** she buys dinner in Dubai at 01:30 local time on the 25th (21:30 on the 24th in London), **then** it belongs to the new cycle starting the 25th; **when** she has been in Dubai for more than 24 hours, **then** the app asks once whether to use Dubai time for budget days.
- **Given** a payday on the 1st, a ₹50,000 overall budget and the user changes payday to the 25th on 10 November, **when** budgets render, **then** the current cycle is 1–24 November with a pro-rated target of ₹40,000 labelled "shortened cycle", the next cycle is 25 November–24 December at ₹50,000, and Home, Insights and Plan show the same dates.
- **Given** ₹2,000 of November Shopping and a ₹9,000 refund in November for an October TV, **when** budgets and bars render, **then** November Shopping shows ₹0 used with "Refunds this period: +₹7,000", Left in budget does not rise by ₹7,000, and Insights shows November Shopping as "Shopping · ₹7,000 back" with the refund icon, its bar at zero labelled "₹7,000 back", and no minus sign [v1.3.6].
- **Given** a ₹50,000 overall budget with Shopping refunds exceeding Shopping spending by ₹7,000 (₹7,000 back) and Food ₹10,000 [v1.3.6], **when** Home renders, **then** budget used is ₹10,000, Left in budget is ₹40,000, and "Refunds this period: +₹7,000" is shown separately.
- **Given** a ₹50,000 overall budget with ₹20,000 spent on the 15th, **when** the user changes the target to ₹45,000 "effective now", **then** this period shows ₹25,000 left and past periods keep ₹50,000; **when** chosen "from next period", **then** this period stays at ₹50,000 (BDG-007).
- **Given** Left in budget ₹18,000, included accounts ₹42,000 and ₹30,000 of upcoming bills and set-aside goals, **when** Plan renders, **then** Free to use shows ₹12,000 (min of ₹18,000 and ₹42,000 − ₹30,000) (BDG-008).
- **Given** 50/30/20 based on ₹80,000 income, **when** the last full period's confirmed salary is ₹90,000 (more than 10% higher), **then** Plan offers "Your income changed — update 50/30/20 to ₹90,000?" and nothing changes until the user accepts (BDG-009).
- **Given** payday on the 1st, **when** a Salary credit arrives on 29 October (within 3 days before 1 November), **then** it belongs to the cycle starting 1 November (DEC-33).
- **Given** budget alerts already fired for October, **when** a reversal on 2 November cancels a 30 October payment, **then** October's totals are corrected and no October alert fires again (FIN-028).

### 8.6 Recurring payments, subscriptions and bills (REC)

- **REC-001:** Manual recurring rule with merchant/title, expected amount, cadence (weekly, monthly, quarterly, annually or custom), account, next due date, category, end/pause state and optional notification.
- **REC-002:** Mark a bill as planned versus actual confirmed transaction; planned bills do not affect actual balances or expense totals.
- **REC-003:** Scheduled local reminders require permission; do not assume guaranteed exact-time delivery on all platforms.
- **REC-004:** A confirmed linked payment advances the next expected occurrence exactly once; cancellations preserve history.
- **REC-005 [FIX] Phase 2:** Automatic inference from transaction recurrence using time windows, normalized merchants and amount tolerance; produce `suspected` state and confidence/explanation, **not** auto-confirmation.
- **REC-006:** Monthly cadences follow calendar months: a rule due on day 29–31 falls on the last day of shorter months (e.g. Jan 31 → Feb 28/29 → Mar 31: the rule keeps its anchor day), never on a fixed 28–31-day interval.
- **REC-007 (P2):** Distinguish suggested subscriptions from rent, EMIs or repeated purchases and allow the user to reject suggestions permanently or temporarily (requires REC-005 detection). In P1, the user sets each rule's kind (subscription, rent, EMI, utility, other) manually.
- **REC-009 [v1.3]:** When a capture matches a user-created bill rule (same payee, amount within tolerance, near the due date), the capture card asks "Rent paid? [Yes, link it]"; Yes links the payment and advances the rule once (REC-004). This is matching against existing rules, not REC-005 inference.
- **REC-010 [v1.3]:** The Plan timeline lists only bills the user has added and says so ("Showing 3 bills you added. Missing EMIs or subscriptions? Add them").
- **REC-008 (P1, in SCR-16):** Bills & Recurring has a **Subscriptions** filter showing total monthly-equivalent cost (conversion clearly labelled, e.g. annual ÷ 12) and past charges per subscription. The subscription timeline chart is Phase 2 (INS-022).

**Acceptance:**
- **Given** a monthly rule "Rent ₹18,000, due 5th", **when** a ₹18,000 debit to the same payee is captured on the 4th and the user taps "Yes, link it", **then** the rule shows paid for this month, next due becomes the 5th of next month, and linking the same payment again is refused.
- **Given** a rule due on the 31st, **when** the month has 30 days (or February), **then** the due date is the last day of that month.
- **Given** a planned bill that is not yet paid, **when** totals are calculated, **then** it affects neither balances nor expenses, only the Plan timeline and Free to use.

### 8.7 Savings goals (GOAL)

- **GOAL-001:** Create target name, target amount, optional due date, icon and colour (from the 12-hue palette; see UX DESIGN.md › Category palette) [v1.3.6] and optional assigned account.
- **GOAL-002:** Contributions may be virtual earmarks ("Set aside") or actual account transfers ("Moved to savings"); UI MUST distinguish them. Virtual allocation does not create spend or alter actual account balance, and does not reduce **Left in budget**; it does reduce **Free to use** (BDG-008).
- **GOAL-003:** Show progress, remaining amount, current pace and projected completion only when adequate data exists.
- **GOAL-004:** Edit/pause/complete/archive preserves historical allocations. "Set aside" money is reserved against **Free to use** (BDG-008); upcoming bills are reserved separately by their due amounts. Setting aside more than is free is allowed with a warning ("This leaves you short by ₹5,000"); Free to use then shows "Short by ₹X". Money is never counted as free twice.

**Acceptance:**
- **Given** Left in budget ₹60,000, included accounts ₹50,000 and no bills (so Free to use is ₹50,000), **when** a goal sets aside ₹12,400, **then** account balances and Left in budget are unchanged and Free to use becomes ₹37,600.
- **Given** a ₹5,000 "Moved to savings" contribution, **when** it is saved, **then** it is one transfer into the savings pot, adds ₹5,000 (not ₹10,000) to the 50/30/20 Savings bar, and is not an expense.
- **Given** ₹5,000 moved into savings and ₹2,000 moved back out in the same period, **when** the Savings bar renders, **then** it shows ₹3,000.
- **Given** Left in budget ₹60,000, included accounts ₹30,000 and no bills (so Free to use is ₹30,000), **when** the user sets aside ₹20,000 for Goa and then ₹15,000 for a phone, **then** the second set-aside shows the warning "This leaves you short by ₹5,000", is allowed, and Plan shows Free to use as "Short by ₹5,000".

### 8.8 Home dashboard and widgets (HOM)

- **HOM-001:** Home cards and order per §6.3: "Am I okay?" hero (Left in budget, In accounts, Card dues), "N to check" (only when pending), income/expense, per-category budgets, Needs/Wants/Savings, top categories, 7-day spend, coming up, savings goal. "Home card" is the term for these; "home-screen widget" means SCR-29 only.
- **HOM-002:** Show icons plus semantic color and numerical values; every supported card navigates to filtered detail.
- **HOM-003:** User can reorder, hide, show, choose card size where supported, and restore layout.
- **HOM-004:** Home cards refresh on transaction, settings or period changes, including foreground resume; indicate stale/partial data when recomputation is pending.
- **HOM-005:** Financial values display a timeframe and eligible-account scope; charts display no fabricated history.
- **HOM-006:** The centre ＋ button stays visible on every tab without covering key navigation/accessibility controls.
- **HOM-008 [v1.3]:** Hide-amounts eye on the hero masks every amount on screen with one tap; the state is remembered (SET-005).
- **HOM-007 (Android, Phase 1):** Home-screen widget (SCR-29) with Snap receipt, Add expense and "N to check" (text, shown only when N > 0; never a numeric badge on the launcher icon); respects app lock (opening a capture behind lock requires unlock) and shows no amounts unless the user enables it and app lock is off (SET-005).

**Acceptance:**
- **Given** an overall budget of ₹50,000 with ₹38,140 spent, **when** Home opens, **then** the hero shows ₹11,860 Left in budget for the default period, and In accounts and Card dues appear on a separate line and are never added together.
- **Given** no budget, **when** Home opens, **then** the hero shows Spent this period and "Set a limit →".
- **Given** an overall budget of ₹20,000 with ₹22,340 spent and payday in 5 days, **when** Home opens, **then** the hero shows a warning icon and "Over budget ₹2,340" (no minus sign), the bar fills to the limit tick with a capped overflow, the caption reads "₹22,340 of ₹20,000", the time line reads "5 days to payday" with no per-day figure, and TalkBack reads "Over budget by 2,340 rupees" (§6.3) [v1.3.6].
- **Given** only 50/30/20 with Needs + Wants targets of ₹40,000, ₹25,000 needs + wants spent and ₹3,000 Uncategorised, **when** Home opens, **then** Left in budget is ₹12,000 with "includes ₹3,000 not classified — sort it".
- **Given** an account with "balance not set", **when** In accounts is shown, **then** it carries "+1 account not set" and never treats that account as zero.
- **Given** the hide-amounts eye toggle is on, **when** the app is closed and reopened, **then** all amounts on Home are still hidden.
- **Given** no items are waiting, **when** the home-screen widget renders, **then** the "N to check" text is hidden; **given** 3 items are waiting, **then** it reads "3 to check" as text, never as a badge on the app icon (HOM-007).

### 8.9 Insights and analytics (INS)

**Shared analytics requirements:**

- **INS-001:** Presets as in §6.5; cross-filter account, category, merchant, transaction type, tags and source where meaningful.
- **INS-002:** Charts allow accessible numeric summaries, screen-reader data table alternatives and drill-down into contributing transactions.
- **INS-003:** All aggregations use confirmed financial events and posted category allocations; exclude transfers and unconfirmed import candidates from spending unless explicitly requested.
- **INS-004:** Compare like-for-like periods, label partial current period and previous period consistently. A partial period is compared with the same number of days from the start of the previous period ("↑ 12% vs Oct 1–8"; for pay cycles, day N of the cycle), never with the whole previous period.
- **INS-007 [v1.3]:** Insights is one scrolling view ordered by question: *Where did it go?* (INS-012), *Is it going up?* (INS-010, INS-011), *Who got it?* (INS-014), *Am I on track?* (INS-013, INS-020, INS-025). Every chart has "View as table" for screen readers (INS-002) as an acceptance criterion.
- **INS-005:** Values in the profile currency, inclusive start/exclusive end interval semantics internally, correct dates/timezones, signed and refund treatments documented.
- **INS-006:** Empty/minimal data shows safe prompts rather than false insights. Users can export underlying data.

| ID | Chart / insight | Visualization | Definition / primary interaction | Phase |
|---|---|---|---|---|
| INS-010 | Expense trend | Line/area chart | Confirmed net spending per day/week/month | P1 |
| INS-011 | Income vs expense | Grouped bars | Inflow, outflow, net cash flow by period | P1 |
| INS-012 | Category distribution | Donut + ranked horizontal bars | Category expense allocations divided by eligible total | P1 |
| INS-013 | Category budgets | Progress bars | Budget used/target, overage, remaining | P1 |
| INS-014 | Top merchants | Ranked bars | Net spending by normalized merchant | P1 |
| INS-015 | Spending change | Comparison tiles + directional arrows | `(current - previous) / abs(previous)` only if previous ≠ 0; otherwise “new/no baseline” | P1 |
| INS-016 | Kept | Gauge + trend | `(income - expenses) / income` when income > 0, labelled **"Kept N%"**; clearly *cash-flow surplus*, not formal savings accounting. With zero income shows "No income recorded", never "Kept 0%" | P1 |
| INS-017 | Payment methods | Donut | Share by tagged payment method; unknown separate | P2 |
| INS-018 | Day-of-month heatmap | Calendar | Spending intensity, legend and exact value detail | P2 |
| INS-019 | Fixed vs variable | Stacked bars | User rules classify; unknown separate | P2 |
| INS-020 | Needs / Wants / Savings | Three progress bars (SCR-30) | Needs and Wants = confirmed expenses by category type (CAT-006); Savings = net money moved into savings pots (including SIP/RD debits), each counted once whether or not tagged to a goal (BDG-009); against 50/30/20 or custom targets; drill-down to categories or transfers; no moral labelling | P1 |
| INS-021 | Projected month-end | Forecast line/band | Actual-to-date + simple rate projection + known bills; uncertainty label | P2 |
| INS-022 | Subscription timeline | Timeline | Expected due dates and actual matching payments | P2 |
| INS-023 | Transaction frequency | Histogram | Count and size bands of eligible transactions | P2 |
| INS-024 | Year-on-year comparison | Monthly bars | Identical month periods; missing data explicit | P2 |
| INS-025 | Savings-goal progress | Goal rings | Explicitly assigned allocations versus target | P1 |

**Insight cards and explainability:** Every narrative inference must display formula, baseline, source count and timeframe on drill-down. An increase in expenses is not intrinsically “bad.” Forecast accuracy assessed against later actuals in local tests, without collecting private data.

**Acceptance:**
- **Given** 1–8 November spending of ₹14,000 and 1–8 October spending of ₹12,500, **when** Insights shows the comparison, **then** it reads "↑ 12% vs Oct 1–8", never a comparison with the whole of October.
- **Given** no data in the previous period, **when** the comparison tile renders, **then** it shows "No baseline yet".
- **Given** any chart segment, **when** the user taps it, **then** Activity opens filtered to exactly the transactions behind that segment, and their sum equals the segment value.
- **Given** TalkBack is on, **when** the user focuses a chart, **then** "View as table" is announced and the table lists every value.
- **Given** November Shopping refunds exceed Shopping spending by ₹7,000, **when** Insights renders, **then** the category reads "Shopping · ₹7,000 back" with the refund icon and its bar sits at zero labelled "₹7,000 back"; no minus sign appears (§6.7) [v1.3.6].

### 8.10 CSV import and statement export (IMP)

- **IMP-001:** File picker reads a local CSV selected by user; detects encoding (UTF-8, UTF-16, Windows-1252, ISO-8859-1) with a manual override; supports comma, semicolon and tab delimiters, quoted fields and decimal commas; detect but allow correction of delimiter/header/date/amount mapping.
- **IMP-002:** Preview 20+ rows where available; map account, date/time, description, debit/credit (or signed amount, with a "flip sign" option per mapping for card statements that show charges as positive), currency, merchant and reference; refuse or isolate unsupported currency. During import, opposite-sign rows of equal amount within ±2 days between two owned accounts are proposed as a transfer pair and sent to review, never imported as an expense plus income.
- **IMP-003:** Validate date, numeric fields, balance sign and duplicate candidates before commit. Mark every ambiguous row for review.
- **IMP-004:** Match against the existing ledger using FIN-027: stable bank or UPI reference with direction when available; otherwise amount, ±1 day and normalized merchant, sent to review, never silently merged. Identical rows within one file are kept as distinct rows (occurrence index).
- **IMP-005:** Each batch of at most 500 rows commits atomically; an interrupted import keeps committed batches and resumes from the next batch on retry; bad rows are skipped and reported by row with retry/export-error options. Re-importing the same file is idempotent (FIN-027 fingerprints).
- **IMP-006:** Raw imported files are kept for 30 days by default for traceability (configurable: delete immediately, 30 days, keep); the parsed source_record fingerprints are kept; no cloud upload.
- **IMP-007:** Exports: transaction CSV and account summary CSV; include period/filter context, timezone, version/schema metadata; hide/mask account identifiers as configured.
- **IMP-008:** PDF reports Phase 2 with visual summary, chart alternatives and correct account scope.

**Acceptance:**
- **Given** a 200-row bank CSV, **when** it is imported twice, **then** the second import creates no new confirmed entries and its summary reports 200 skipped matches.
- **Given** a capture rejected in January and purged after 90 days, **when** a CSV containing the same bank reference is imported in May, **then** the row is skipped and reported as "previously rejected".
- **Given** a CSV with two "PRET A MANGER £3.50" rows on 20 October and no references, **when** imported, **then** both are added and neither is flagged; **when** an overlapping export covering 20–31 October is imported later, **then** both rows are recognised and skipped.
- **Given** a German bank CSV in Windows-1252 with `;` delimiters and amounts like "-1.234,56", **when** imported, **then** the encoding and delimiter are detected and the amount is stored as −€1,234.56.
- **Given** a card statement CSV listing charges as positive numbers, **when** the user turns on "flip sign" for that mapping, **then** charges import as expenses on the card account.
- **Given** a bank CSV row "−£500 CARD PAYMENT" and a card CSV row "+£500 PAYMENT RECEIVED" one day apart, **when** both are imported, **then** they are proposed as one transfer in review, not imported as an expense plus income.
- **Given** a 1,200-row import interrupted after the second batch of 500, **when** the user retries, **then** the 1,000 committed rows are kept, the import resumes from row 1,001, and no row is duplicated.
- **Given** a capture rejected 91 days ago, **when** the user opens Show rejected, **then** it is no longer listed. **Given** a manual entry deleted 10 days ago, **when** the user opens Settings → Data → Recently deleted, **then** it is listed with Restore and Delete permanently. **Given** one leg of an own-account transfer, **when** the user chooses Delete permanently and confirms, **then** both legs are deleted and both balances return to their pre-transfer values.
- **Given** a purchase with a linked refund, **when** the user permanently deletes the purchase and confirms, **then** the purchase is removed, the refund stays as an unlinked refund in its category, and balances stay consistent.
- **Given** a CSV row whose UPI or bank reference matches an existing capture, **when** imported, **then** it links to that entry instead of creating one.
- **Given** row 57 has an unparseable date, **when** the import is committed, **then** the other rows commit, row 57 is reported with its error, and nothing is silently discarded.
- **Given** an export with a cell beginning "=", **when** the CSV is written, **then** the cell is escaped so spreadsheets do not run it as a formula.

### 8.11 Receipt attachments and OCR (OCR)

Terms: **receipt** = a scanned proof of purchase; **bill** = a payable due date (REC). The user-facing action is *Snap receipt*.

- **OCR-001 P1:** Attach local receipt image/document through OS-controlled picker, optionally camera with permission; resize stored images to at most 2,048 px on the long edge at JPEG quality 85, keep only that compressed copy, and record its source provenance.
- **OCR-002 P1 [SRC]:** Perform character recognition fully on device using a model bundled with the app (no first-use download), so it works offline from install; show unavailable/dependency error honestly when model absent.
- **OCR-003 P1 [FIX]:** Group OCR bounding boxes using true midpoint `(top + bottom)/2`, line-order, adaptive tolerance, multi-column detection and number locale (decimal comma and point, per region).
- **OCR-004:** Extract merchant, date, currency, subtotal, tax, fee, discount, total, product line items and price; show uncertainty per field.
- **OCR-005:** User can correct every parsed field and split item categories. Parent total reconciles exactly, and any unparsed amount is an explicit "Not itemised" split row (TXN-009). **Quality floor:** the total is **user-confirmed**: a low-confidence total is highlighted and must be tapped to confirm or corrected before Save. The receipt **reconciles** when items + tax, service charges and fees − discounts = total. If that sum is **below** the total, the difference becomes the "Not itemised" row; if it is **above** the total, it is a mismatch the user fixes (items, discount or total); no negative row is ever created. Tax, fees and whole-bill discounts are spread across itemised lines only, never across the "Not itemised" row. A discount printed under a specific item reduces that item; a whole-bill discount, like tax, service charges and fees, is allocated to items pro-rata by item amount, with any rounding remainder of minor units on the largest item, so category splits always sum exactly to the total. Any line not parsed goes into a grey **"Not itemised"** row that is reported as *Uncategorised* (never silently folded into the main category); saving with a not-itemised amount is normal, not an error. The review screen shows category totals first with *Items (N)* collapsed.
- **OCR-006:** Receipt scan offers *attach to existing transaction* first on probable match; avoid double-spend.
- **OCR-007:** When parsing fails (low contrast, handwritten, tilted, cropped or multilingual receipts), manual entry opens in one tap with the image kept attached; nothing the user captured is lost. **Phase 1 script scope:** Latin-script text and Western Arabic numerals. Arabic, Devanagari and other Indic text is ignored, but totals printed in Western numerals must still be read; such receipts are a measured category in the reference set.
- **OCR-008:** Do not assert fixed 3-second completion on every supported device; benchmark target is p95 ≤ 5 seconds for standard single-page printed receipts on defined reference hardware, with cancellation/progress.
- **OCR-009:** Entry points: camera in the Add flow (Snap receipt chip, or long-press on ＋), gallery image pick in the Add flow, the home-screen widget (HOM-007), and images shared to wmbugo that are not UPI screens (UPI-004). Automatic detection of new photos/screenshots is not required.
- **OCR-010:** When a scanned receipt probably matches an existing entry (FIN-027, including the tip tolerance), ask "Matches ₹1,800 HDFC debit at 6:12 pm" with **Attach to it / Keep separate / Discard**. *Attach* adds the receipt and its items to that entry; *Keep separate* saves a new expense; *Discard* saves nothing. The words Approve/Reject are not used here. Never auto-attach silently.
- **OCR-011 [v1.3]:** A receipt with no match is saved from the review screen (the user's Save is the approval, DEC-21) as a confirmed expense. **Paid with** defaults to the account last used at that merchant (LRN-007), Cash only when there is no history, shown as an editable chip. A low-confidence date defaults to today with a warning, never blocking Save. If a matching capture arrives later, it is flagged `possible_duplicate` (never auto-approved) and the review queue offers Merge / Keep separate.
- **OCR-012:** Itemized bills: each line item can carry its own category (e.g. supermarket groceries vs notebooks), feeding per-category weekly/monthly reports via splits (FIN-022). Item categories are learned per LRN-004.
- **OCR-013:** Capture notifications for mixed-category merchants (LRN-003) offer a "Snap receipt to split" action that opens the camera and links the result to that entry.
- **OCR-014 [v1.3]:** "Reading receipt…" shows the photo with a scan line and items appearing as read, a progress count ("3 of 14 items") and Cancel; reduced motion shows the progress bar only.

> **Delivery risk (v1.3):** itemized OCR across Indian, North American, European and Gulf/SE Asian receipt layouts is the hardest Phase 1 item. It is **not deferrable** (DEC-31); risk is managed by the OCR-005 quality floor and a consented reference receipt set built during the closed beta (§20).

**Acceptance:**
- **Given** a 14-line supermarket receipt where 12 lines parse, **when** the review screen opens, **then** the total equals the printed total, the 2 unparsed lines' amount appears as a grey "Not itemised" row, and Save is enabled.
- **Given** a receipt with items S$42.00 (Groceries) and S$18.00 (Household), a whole-bill "Member discount –S$6.00" and total S$54.00, **when** reviewed, **then** no mismatch is flagged and the splits are Groceries S$37.80 and Household S$16.20.
- **Given** an existing ₹2,340 card debit at 6:12 pm, **when** a ₹2,340 receipt from the same day is scanned, **then** the app asks "Attach to it / Keep separate" and creates no second confirmed expense until the user chooses.
- **Given** a merchant last paid with the HDFC card, **when** a receipt from that merchant has no match, **then** Paid with defaults to the HDFC card.
- **Given** airplane mode on a fresh install, **when** a receipt is scanned, **then** OCR runs without any download.

### 8.12 Optional Android SMS ingestion (SMS, P1-IN, policy gate)

All SMS requirements apply to India only. In other markets and in the no-SMS build, no SMS screen, setting, prompt or text appears anywhere in the app (SMS-015).

- **SMS-001 [SRC/FIX]:** Android app **may** expose native financial SMS detection *only when Play policy eligibility, permission declaration and approval are verified*. Build/release variants without approved permission MUST NOT declare disallowed SMS permissions in manifest.
- **SMS-002:** Explicit, contextual disclosure states categories of messages accessed, financial fields retained, local-only processing and how to disable; request only necessary permissions after consent.
- **SMS-003:** Parse inbound debit, credit, refund, reversal and account transfer indicators, currency, amount, merchant, reference, masked account and timestamp; unknown parsed values remain unconfirmed.
- **SMS-004:** On-device processing, no transmission of SMS content. The raw SMS body is never stored after parsing; only parsed fields and a redacted preview (amount masked, no OTPs, no links) are kept in the source record. Nonfinancial messages are never ingested.
- **SMS-005:** Reconcile against user-confirmed transactions, imports and OCR; ambiguous matches go to review queue.
- **SMS-006:** Notification review may provide quick classification but cannot circumvent consent/notification rules; alert rates are configurable.
- **SMS-007:** OEM diagnostics report only verifiable permissions and app background state, with help text. Never claim a permanent daemon or universal auto-start bypass.
- **SMS-008:** Permission denial/revocation/Play rejection leaves app fully functional. No policy-circumventing accessibility, notification, clipboard or SMS scraping substitutes.
- **SMS-009:** Automated tests use consented fixtures; real financial data not embedded in repo or diagnostic logs.
- **SMS-010:** Capture both debit and credit SMS. Parse only messages from a **verified sender**: a registered alphanumeric DLT header whose **normalized entity** is on the allow-list bundled with the app (updated with app releases) or that the user has confirmed once. Normalization: uppercase, strip the two-letter operator/circle prefix and hyphen (`AD-`, `VM-`, `JD-`, `BZ-` …) and any category suffix (`-S`, `-T`, `-P`, `-G`), leaving the 6-character entity (e.g. `VM-HDFCBK-S` → `HDFCBK`). Allow-list entries and confirmations are stored as normalized entities. Messages from ordinary phone numbers are never treated as transactions. OTP content is never retained.
- **SMS-011:** Scam warning applies only to non-verified senders: a transaction-like SMS from a non-verified sender that contains a link together with claim/KYC/prize wording, or any transaction-like SMS from an ordinary phone number, shows "This looks like a scam — not added" and is never posted. A debit or credit from a well-formed DLT header that is not on the allow-list and has no such wording is **not** a scam: it goes to the SMS-017 prompt. Messages from verified senders are never scam-flagged, even when they contain links or "KYC" reminders.
- **SMS-012:** Balance-chain check, kept per (normalized sender, masked account identifier) — never per sender alone. Card SMS that quote an available *limit* ("Avl Lmt") are not part of any balance chain. When an account SMS includes an available balance, compare it with the previous SMS balance for that same account, in the order the transactions **occurred** (not the order the SMS arrived), allowing for intervening captured or manual transactions. **A first mismatch is tolerated**: it is treated as money that moved without an SMS (auto-debits, interest, charges), the chain quietly resets to the new balance, and the capture stays eligible. Only a **second consecutive mismatch** on the same account flags the capture as suspicious (not auto-approved). The chain also resets after the user confirms a flagged capture or after 7 days without an SMS for that account.
- **SMS-013:** Block sender: every capture notification and dialog offers "Not a transaction · Block sender"; blocked senders are listed in SCR-28 and can be unblocked.
- **SMS-014:** Permission onboarding: show the explainer (SCR-24) before the OS prompt. After "Not now", re-ask at most twice, ≥7 days apart, as a dismissible Home card triggered by value (e.g. after the 5th manual entry); afterwards only via Settings. If SMS is unavailable, manual entry, UPI share and receipt scan remain the capture paths.
- **SMS-015 [v1.3]:** The no-SMS build contains no SMS UI at all (no "coming soon", no greyed row), so the app makes no promise that depends on Play approval and the Play reviewer sees no SMS references in a build without the permission.
- **SMS-016 [v1.3]:** Submit the Play SMS permission declaration at M3, together with an internal-test-track build of the `sms` flavor that demonstrates the core use case; publish the privacy policy at M1. Review time is outside wmbugo's control. **[ASSUMPTION]** Play allows an SMS-enabled release targeted to India alongside a no-SMS release elsewhere for one package (or a separate package is used); GATE-02 is decided at M3, when the declaration is filed; the build supports both outcomes from M1, so no earlier deadline applies.
- **SMS-017 [v1.3] Unknown senders:** a transaction-like SMS from a well-formed DLT header that is not on the allow-list prompts "New sender HDFCBK? [It's my bank] [Ignore]". This applies to **debits and credits alike**. *It's my bank* marks the sender `user_confirmed` and the capture then waits for review like any other; it is never auto-approved. *Ignore* rejects the capture.

Official policy checkpoint: https://support.google.com/googleplay/android-developer/answer/10208820

**Acceptance:**
- **Given** an allow-listed sender `AD-HDFCBK`, **when** a debit SMS arrives, **then** a capture notification appears within NFR-16 limits and no SMS body leaves the device.
- **Given** an SMS from a 10-digit phone number with transaction-like text, **when** it arrives, **then** nothing is captured.
- **Given** a genuine refund SMS from a verified sender, **when** parsed, **then** it is captured as a refund and not flagged as a scam; **given** a credit SMS with a link and "claim your prize", **then** it shows "This looks like a scam — not added".
- **Given** the no-SMS build, **when** the APK manifest and all UI strings are inspected, **then** no SMS permission, receiver or SMS text exists.
- **Given** SMS from `VM-HDFCBK`, `AD-HDFCBK-S` and `JD-HDFCBK`, **when** received, **then** all are recognised as the same verified sender HDFCBK.
- **Given** the user tapped "Not now" on the SMS explainer, **when** they add their 5th manual entry, **then** a dismissible Home card re-asks once; it re-asks at most once more, at least 7 days later, and never again after that except from Settings (SMS-014).
- **Given** a salary credit SMS from `VM-KCOOPB` (a well-formed bank sender not on the allow-list) with no link, **when** received, **then** it is not scam-flagged; the "New sender KCOOPB? It's my bank / Ignore" prompt appears and the credit waits for review.
- **Given** an HDFC balance of ₹40,000 in the last SMS and an unannounced ₹1,500 EMI auto-debit, **when** the next SMS reads "₹500 debited… Avl bal ₹38,000", **then** the capture is not flagged and the chain resets to ₹38,000; **given** the following SMS also mismatches, **then** that capture is flagged as suspicious.
- **Given** a user with only a bank account, **when** an ATM capture of ₹2,000 is marked Cash withdrawal, **then** a Cash account is created with "balance not set", the ₹2,000 is recorded as a transfer from the bank into it, and spending is unchanged.
- **Given** a UPI debit of ₹2,000 followed by "₹2,000 reversed" with the same UPI reference, **when** both are captured, **then** the reversal cancels the debit and the balance is unchanged overall (FIN-028).
- **Given** ₹10,000 debited from HDFC and ₹10,000 credited to the user's ICICI account with the same UPI reference, **when** both are captured, **then** they are linked as one own-account transfer, neither is cancelled, and HDFC falls by ₹10,000 while ICICI rises by ₹10,000.
- **Given** an SMS "₹2,000 debited from A/c ••7730… Avl bal ₹23,000" from an unknown account, **when** the user taps Add it, **then** the account opens at ₹25,000 effective just before the payment, the ₹2,000 is a normal expense on it, and its balance shows ₹23,000.
- **Given** an SMS "₹1,200 spent on HDFC Card ••9911… Avl Lmt ₹1,48,800" from an unknown card, **when** the user taps Add it, **then** the type is pre-selected as card, card dues show "not set", and ₹1,48,800 is never used as a balance.
- **Given** a capture from unknown ••7730 whose "Add it / It's one of mine" prompt is unanswered, **when** 21:00 passes, **then** it stays Waiting for you and is not posted to any account; **given** the user later adds ••7730, **then** that capture and later ones from it follow normal auto-approve rules.
- **Given** a bank SMS "₹8,200 debited towards Credit Card payment" and a card SMS "Payment of ₹8,200 received on Card ••9911" a day apart, **when** both are captured, **then** exactly one ₹8,200 transfer exists, with both SMS as its sources; the bank balance falls by ₹8,200 and card dues fall by ₹8,200.
- **Given** an auto-linked ₹8,200 card payment, **when** the user taps "Not a transfer", **then** the link is undone, both legs return to Waiting for you, and balances revert. **Given** two cards and a "towards card payment" SMS with no card number, **when** 21:00 passes, **then** nothing is linked and the capture waits with the transfer choices. **Given** auto-approve is off, **when** both legs arrive, **then** they are not auto-linked.

### 8.13 Settings, personalization, local notifications (SET)

- **SET-001 [v1.3.6]:** Appearance: theme System/Light/Dark (teal only in Phase 1; accent themes are not offered, §6.2), number formatting, text-size/system scaling, haptic/reduced-motion preference.
- **SET-002:** Finance: region and currency (one per profile, DEC-05; changeable while no transactions exist; after that, blocked in Phase 1 and offered via export + new profile), timezone, first day of week, default period, payday, default account, budget thresholds, missing-data policy.
- **SET-003:** Notifications: per-type opt-in, due reminders, budget warnings, capture notifications and the evening summary; clear snooze/mute controls. Caps: one alert per budget threshold per period; capture notifications grouped into one; at most one evening summary per day; at most 3 other notifications per day, bills before budget alerts, with any overflow merged into one "N more reminders" notification. The evening summary is sent only after the auto-approve write commits (CAP-007) and never changes data. Pending items are signalled in-app by the Home card and Activity dot, never by a numeric app badge.
- **SET-004:** Data: encrypted backup/restore, CSV export, storage use, retention, data wipe with double confirmation.
- **SET-005:** Privacy: app lock biometrics/PIN, blurred background snapshot, privacy explanations, hide-amounts toggle. **Hide amounts** applies everywhere at once: the app, the home-screen widget and notifications. **With app lock on**, capture notifications use the hidden form defined in SEC-005, and the home-screen widget never shows amounts.
- **SET-006:** Diagnostics: local version/schema/storage/permissions status, non-sensitive test parsers, export sanitised diagnostics with explicit preview and consent.
- **SET-007:** Help: offline FAQ, accessible glossary, simple “how totals are calculated” screens, about/licensing.

**Acceptance:**
- **Given** a budget at 74%, **when** an expense takes it to 91%, **then** exactly one alert fires for the 90% threshold and none for 75% is repeated later in the period.
- **Given** notification permission is denied, **when** a bill is due, **then** Plan still shows it as due and the app shows no permission nag more than once.
- **Given** a profile with transactions, **when** the user tries to change currency, **then** the change is blocked with an explanation and the export-and-new-profile path.

### 8.14 Local encrypted backup, restore and migration (BKP)

- **BKP-001:** Export versioned encrypted backup containing database, attachments and settings with manifest and integrity checksum; ask user to set a strong passphrase or platform-safe key strategy and clearly explain recovery implications.
- **BKP-002 [v1.3.6]:** Restore must validate format/version/checksum, obtain credentials, preview effects, create a pre-restore safety snapshot (if free storage is less than twice the database size, warn and require explicit confirmation to restore without one), and commit atomically. Restore copy never promises a lasting safety copy (the snapshot is kept only until the next successful start, architecture AD-10); the preview says **"If something goes wrong during restore, nothing on this phone changes."** and offers a **"Back up this phone first"** link.
- **BKP-003:** Wrong passphrase/corrupt/incompatible file cannot overwrite working data; show actionable error.
- **BKP-004:** Data copy must not be unencrypted temporary artifacts in public folders; securely manage temp files according to platform capability.
- **BKP-005:** Versioned migrations execute transactionally; support forward-compatible read policy and user-safe failure recovery.
- **BKP-006:** Device backup settings must not silently send sensitive app files to OS cloud backups if strict no-cloud promise is active; configure backup exclusion policies and document user-initiated file-provider export behavior.
- **BKP-007:** Exporting to external file provider is **user-initiated** and may leave device (e.g., OS share sheet); privacy UI must explain this clearly instead of falsely claiming bytes can never leave under any circumstances.

**Acceptance:**
- **Given** a backup file, **when** it is restored with the wrong passphrase, **then** current data is untouched and the error says the passphrase is wrong.
- **Given** a restore in progress, **when** the app is killed, **then** on next launch the pre-restore data is intact and usable.
- **Given** a valid backup file, **when** the restore preview opens, **then** it shows "If something goes wrong during restore, nothing on this phone changes." and a "Back up this phone first" link, no copy promises a kept safety copy, and Restore stays disabled until "I understand this replaces what's on this phone now" is ticked (plus re-authentication when app lock is on) (BKP-002, FLOW-10) [v1.3.6].
- **Given** a backup made on schema version N, **when** restored on version N+1, **then** migration runs and every account balance matches the source device.
- **Given** OS auto-backup, **when** the device backs up, **then** no wmbugo database or attachment file is included.

### 8.15 Security and privacy (SEC)

- **SEC-001:** Financial records reside locally in authenticated encrypted-at-rest storage, using verified cryptographic implementation and device-protected key handling; no hardcoded keys. **SMS catch-up [v1.3]:** nothing is stored before the first unlock. After the first unlock following a reboot, and on every app start, wmbugo reads the phone's SMS inbox for messages from verified or unknown bank senders received since the last message it processed (`sms_cursor`) and runs them through the shared pipeline; anything already seen is skipped by fingerprint (FIN-027). SMS that arrive while the database cannot be opened are handled the same way on the next open. Nothing is dropped, and no financial data is kept in weaker pre-unlock storage. This uses the read-SMS permission covered by the same Play declaration (SMS-001). **Starting point:** when SMS capture is first enabled, `sms_cursor` is set to the moment of consent, so older SMS are never read automatically. A one-time offer, "Bring in the last 30 days of bank SMS?", shows a preview count; if accepted, those messages go to the review queue and are never auto-approved. After a backup is restored on a new phone, the restored cursor is kept, so nothing is imported twice. The main database key is available after the first unlock following boot (not bound to each screen unlock), so capture, notifications and the FIN-026 write work while the screen is locked; this is the NFR-10 protection level (product decision v1.3.5).
- **SEC-002:** No mandatory internet calls, cloud analytics, ad trackers or unreviewed SDK telemetry. **The release build does not declare the `INTERNET` permission**, so no library can send data; any SDK that requires network to function is not eligible. Because libraries add `INTERNET` automatically during the build, the release build must **explicitly strip** it, an automated release check must **fail the build** if the permission is present, and the airplane-mode suite (NFR-01) must run on the **release** build, not the developer build (which needs network). A privacy audit additionally verifies network traffic in representative flows, and the Play Data safety form must match actual SDK behaviour (GATE-08).
- **SEC-003:** Minimum system permissions, contextual rationale, graceful denial, ability to revoke via OS.
- **SEC-004:** App lock option uses biometric/OS-backed mechanism with device passcode fallback consistent with threat model; lock upon resume after configurable timeout.
- **SEC-005 [v1.3.6] Notification privacy (single source of truth):** Hide sensitive values in the app switcher. A capture notification has two forms. The **hidden form** ("New payment to check") shows no amount, merchant or account and offers only **Review**, which unlocks and opens the capture. The **full form** shows amount, merchant, account, guessed category and **Approve / Reject**. The hidden form is used on the lock screen, whenever **app lock** is on, and whenever **hide amounts** is on — unless the user has opted in to full notifications (off by default; CAP-006 for the lock screen). Approve/Reject never appear on a hidden notification. Non-capture notifications (budgets, bills) never show amounts on the lock screen.
- **SEC-006:** Validate file types, size, dangerous path injection, spreadsheet formula injection in exports, corrupted data and malicious archive payloads.
- **SEC-007:** Redact SMS, financial amounts, account identifiers, images and notes in logs/crash diagnostics.
- **SEC-008:** Deleting data requires clear scope and irreversible-loss warning; encrypted backups are separate copies.
- **SEC-009:** Consent/disclosure and store privacy labeling must accurately reflect actual build behavior; legal review before publication.

**Acceptance:**
- **Given** representative flows (onboarding, add, capture, backup), **when** network traffic is proxied, **then** wmbugo initiates no outbound request.
- **Given** app lock on, **when** the app is opened from the widget, a notification or a share, **then** unlock is required before any amount is shown.
- **Given** a capture notification, **when** the device is locked and lock-screen approve is off, **then** the lock screen shows only "New payment to check" with a Review action, and no amount, merchant or account [v1.3.6].
- **Given** app lock is on and the phone is unlocked, **when** a capture notification arrives, **then** it shows "New payment to check" with only a Review button and no amount, merchant or account [v1.3.6]; tapping Review asks for unlock before showing the amount.
- **Given** hide amounts is on and app lock is off, **when** a capture notification arrives, **then** it uses the hidden form with only Review (SEC-005).
- **Given** debug and crash logs, **when** inspected after a capture session, **then** they contain no amounts, SMS bodies, account identifiers or notes.
- **Given** the phone rebooted and has not been unlocked, **when** a debit SMS arrives, **then** nothing is stored before unlock, and after the first unlock the SMS is read from the phone's SMS inbox and appears as a capture exactly once (SEC-001).
- **Given** a phone with three years of bank SMS, **when** the user enables SMS capture, **then** no old SMS is read; the offer "Bring in the last 30 days of bank SMS? (42 messages)" appears once, and if accepted all 42 go to review and none is auto-approved.
- **Given** the release APK, **when** its manifest is inspected, **then** it declares no `INTERNET` permission (SEC-002).

### 8.16 Capture review interaction (CAP, P1)

Sources: SMS (P1-IN), UPI screenshot share (P1-IN) and receipt-to-capture matches (P1). All enter through the shared pipeline (DEC-29).

- **CAP-001:** Each automated capture posts a notification with minimum details — amount, direction, merchant, account, guessed category — and **Approve / Reject** actions, using the lock-screen public version defined in SEC-005. Approve confirms; Reject excludes (DEC-24). Approve/Reject appear only on the full form of the notification (SEC-005); when the full form is shown they work from the shade without opening the app. A hidden notification offers only Review, which requires unlock.
- **CAP-002 [v1.3.6]:** Tapping the notification body opens the capture dialog (SCR-27) over the current app, presented as a bottom sheet over the dimmed host app (same structure as the Add sheet). Implement as a dialog-styled activity launched from the notification that hosts the sheet; do **not** require the draw-over-other-apps permission.
- **CAP-003:** The dialog shows a grid of category icons ordered by this merchant's history, then overall frequency; one tap saves and closes; long-press opens subcategories. Unknown merchants use the same Approve/Reject notification and the dialog collects details.
- **CAP-004:** Credit captures offer these types, each recorded as follows:

  | Choice | Recorded as | Category |
  |---|---|---|
  | Salary | `income` | Salary |
  | From a person | `income` | From people (seeded income category) |
  | Paid me back | `refund` (reduces spending, FIN-028) | the spending category the user picks, learned per person |
  | Refund | `refund` (FIN-028) | the category learned for that payer; if none is learned yet, the credit waits and is never auto-approved |
  | Moved from my own account | transfer (FIN-013, CAP-012) | none |

  The type, and for refunds the category, is learned per payer (LRN-010).
- **CAP-012 [v1.3] Transfer-like captures:** debit captures offer **Moved to my own account**, **Paid card bill**, **Cash withdrawal** (to the Cash account; if none exists, one is created on first use with "balance not set", the withdrawal is its first transfer in, and a one-time tip asks "How much cash did you already have? (optional)") and **Saved / invested** (to a savings pot, ACC-009) alongside categories; the choice is learned per payee or mandate (e.g. a monthly SIP). A capture is **transfer-like** when its text says card payment, bill payment to a card, ATM or cash withdrawal, or self-transfer, or when the other side is a known own account or masked identifier. Transfer-like captures are never auto-approved as expense or income. **Two legs, one transfer:** a bank debit "towards card payment" and a card "payment received" credit (or any debit and credit between two owned accounts) with the same amount within ±3 days are matched into **one** transfer; whichever arrives first creates it and the other is attached as an additional source, never a second entry. **Auto-linking** follows the auto-approve rules: it happens only when auto-approve is on, inside the same FIN-026 write transaction, with an audit row and `capture_resolution = auto_linked`, labelled **"Recorded · linked as transfer"**. It links only when the other account is resolved with certainty through `account_identifier` (CAP-009) or a learned choice; if more than one account could match (e.g. two cards and no mask in the SMS), the capture waits with the transfer choices. Every auto-linked transfer offers **"Not a transfer"**, which undoes the link and returns the capture to Waiting for you.
- **CAP-005:** Multiple pending captures collapse into one updating grouped notification ("3 new transactions · ₹1,240"); the dialog presents them as swipeable cards and offers "Apply to all similar" for repeated merchants.
- **CAP-006:** Lock-screen Approve/Reject is available as an opt-in setting, off by default (SEC-005).
- **CAP-007 [v1.3.6]:** A capture is **eligible for auto-approve** only if all hold: it comes from a verified sender (SMS-010) — UPI screenshots are never auto-approved, because a screenshot does not prove the payment was the user's (UPI-008); amount and direction are fully parsed and the account is **resolved** to an existing wmbugo account (its identifier is linked, CAP-009) — a capture from an unknown account stays "Waiting for you" until the user adds or links it; it carries no `possible_duplicate` flag and no open review candidate; it is not flagged by SMS-011 or SMS-012; it is not transfer-like (CAP-012); and it is in the profile currency (TXN-013). **Debits** with no learned category are confirmed as "Uncategorised" with the `needs_category` flag. **Credits** are eligible only when their type (Salary, From a person, Paid me back, Refund — the last two also need a learned category, CAP-004) has been learned — "Moved from my own account" is a transfer and follows CAP-012 auto-linking instead — for that payer or sender (LRN-010); an unknown credit stays "Waiting for you", is never counted anywhere, and is never placed in Uncategorised, which is for expenses only. Eligible captures still pending after the daily cutoff (default 21:00, DEC-22) are written as confirmed per FIN-026 (background job or next app open, whichever is first); until written they stay "Waiting for you" everywhere. Captures arriving after the cutoff roll into the next day. The evening notification (collapsed "Today: N recorded · Tap to review"; expanded, up to 5 entries listed merchant first plus "+N more"; the hidden form shows the count only) is sent **only by the background job, right after its auto-approve write commits**, so its numbers always match Home; if the job does not run that evening, no summary is sent. Everything else stays `needs_review`.
- **CAP-008:** Activity shows rejected captures greyed out behind a "Show rejected" filter (off by default) for 90 days (FIN-014); during that time their status can be changed from transaction detail.
- **CAP-009 [v1.3] Account discovery:** a capture from an unknown masked account (e.g. "A/c ••7730") shows "New account ••7730 (ICICI) — [Add it] [It's one of mine ▾]". The prompt pre-selects the account type from the SMS wording (card vs account) and lets the user change it. *Add it* creates the account; for a bank account the opening balance is derived from the SMS available balance when present (balance before = available balance ± this transaction) and is **effective just before that transaction**, so the discovering transaction is a normal posting on the new account (it counts and moves the balance to the SMS figure); otherwise "balance not set". A card is created with dues "not set"; an available-limit figure is never used as a balance. *One of mine* links the identifier, keyed by (normalized sender, mask), to an existing account permanently — ••7730 from ICICI and ••7730 from Axis are different identifiers.
- **CAP-010 [v1.3] Own-account transfers:** for a credit marked "Moved from my own account" (CAP-004), the dialog offers account chips; if an opposite-direction capture with the same amount from an owned account exists within the matching window, it is pre-selected and the two are linked into one transfer (FIN-013).
- **CAP-011 [v1.3] Bill matching:** a capture matching a bill rule offers "Rent paid? [Yes, link it]" (REC-009).

**Acceptance:**
- **Given** an eligible capture at 18:12 left untouched, **when** the background job runs after 21:00 or the user next opens the app (whichever is first), **then** it is written as confirmed (`auto_approved`) with an audit row, and any budget alert fires once, after the write. **Before** that write, Home, the widget count and exports all show it as waiting and exclude it from totals.
- **Given** an auto-approved ₹18,000 capture near the Rent due date, **when** it is written, **then** Rent is not marked paid; the "Rent paid?" prompt is offered instead.
- **Given** a ₹1,999 debit SMS with "credit card payment" wording, **when** 21:00 passes, **then** it is not auto-approved as an expense; it is linked as a card payment if the card account exists, otherwise it waits with the transfer choices.
- **Given** a first-ever ₹65,000 NEFT credit from ACME PVT LTD left untouched, **when** 21:00 passes, **then** it stays Waiting for you, is not counted as income or spending, and Left in budget is unchanged; **given** the user once marks ACME PVT LTD as Salary, **then** next month's credit from it is auto-approved as Salary income.
- **Given** Ravi once marked a ₹600 UPI credit from his friend Arun as "Paid me back → Food & Drinks", **when** Arun sends ₹450 next week and 21:00 passes, **then** it is auto-approved as a refund that reduces Food & Drinks by ₹450 and is not counted as income. **Given** a first refund credit from AMAZON with no learned category, **when** 21:00 passes, **then** it waits.
- **Given** a capture flagged `possible_duplicate` at 18:12, **when** 21:00 passes, **then** it stays Waiting for you and is excluded from totals.
- **Given** six captures waiting at 20:55, **when** the user turns auto-approve off, **then** at 21:00 all six stay Waiting for you. **Given** the cutoff is 21:00 and captures were already written at 21:00, **when** at 21:30 the user moves the cutoff to 22:00, **then** the written captures stay recorded and later captures follow 22:00 from now. **Given** auto-approve is off, **when** the user turns it on at 15:00, **then** it first applies at tomorrow's cutoff.
- **Given** the background job writes six captures at 21:04, **when** the evening summary arrives, **then** it reads "Today: 6 recorded · Tap to review", its expanded view lists 5 of those entries merchant first with "+1 more" [v1.3.6], and Home shows the same six as recorded; **given** the job did not run, **then** no summary is sent that evening.
- **Given** the phone clock jumped to 2027 at one app open and was then corrected, **when** today's cutoff passes, **then** auto-approve runs normally within at most one day (the stored latest time is capped at now + 1 day). **Given** the user sets the clock forward to 21:01 at 15:00 without a reboot, **then** no capture is auto-approved before the real 21:00.
- Budget, period and timezone cases for this capture flow are listed under §8.5 acceptance.
- **Given** three pending captures, **when** notifications post, **then** they collapse into one grouped notification ("3 new transactions · ₹1,240").
- **Given** a rejected capture, **when** it is restored from Show rejected, **then** balances and budgets update in one step.

### 8.17 Local learning (LRN, Phase 1)

- **LRN-001:** When the user categorizes an unknown merchant (via notification, dialog or app), later captures from that merchant are pre-categorized; the notification shows the result with a Change option.
- **LRN-002:** When an SMS has no merchant name, learn on the payee UPI ID; the user can name the payee once (e.g. "Ravi Tea Stall").
- **LRN-010 [v1.3]:** For incoming money, the app learns the credit type per payer or sender (e.g. "ACME PVT LTD" → Salary) from the user's choice in CAP-004. Until a type is learned for that payer, its credits are never auto-approved (CAP-007).
- **LRN-003:** A merchant that received two or more different categories **within its last 5 confirmations** is marked mixed: the app stops auto-categorizing and offers that merchant's past categories as one-tap choices. The user can clear the mixed flag in SCR-28.
- **LRN-004:** Bill line items learn categories the same way (e.g. notebook → Education, milk → Groceries).
- **LRN-005:** The dialog shows a "Remember for this merchant" toggle (default on); SCR-28 lists everything learned with edit/forget.
- **LRN-006:** All learning is on-device, never transmitted, included in encrypted backup, and never changes amounts — only category and account suggestions.
- **LRN-007 [v1.3]:** The app learns the payment account per merchant (used for receipt "Paid with", OCR-011) and per category (used for the Add sheet default, TXN-002).
- **LRN-008 [v1.3]:** Only user actions teach: a user approval, a category chosen or changed, or an explicit edit. Auto-approvals (`auto_approved`) never count as confirmations for LRN-001–007 or for the LRN-003 mixed window, so a wrong guess cannot reinforce itself.
- **LRN-009 [v1.3]:** Merchant keys are normalized before learning and matching: lowercase, trim, collapse whitespace, strip payment-gateway prefixes and trailing reference numbers or city codes (e.g. "SWIGGY*BLR 8821" → "swiggy").

**Acceptance:**
- **Given** the user categorises "Swiggy" as Food once, **when** the next Swiggy capture arrives, **then** its notification shows Food (guessed) with a Change option.
- **Given** Swiggy confirmed as Food, Food, Groceries within its last 5 confirmations, **when** the next capture arrives, **then** the app does not guess and offers Food and Groceries as one-tap choices.
- **Given** the user forgets a learned mapping in SCR-28, **when** the next capture from that merchant arrives, **then** no category is pre-filled.
- **Given** captures with merchant text "SWIGGY*BLR 8821", "Swiggy" and "SWIGGY  ORDER 4410", **when** learning runs, **then** all normalize to "swiggy" and share one learned category (LRN-009).
- **Given** a wrong guess (Instamart → Food) auto-approved five nights in a row, **when** the next Instamart capture arrives, **then** learning is unchanged by those auto-approvals and the user's single correction to Groceries takes effect (LRN-008).

### 8.18 UPI screenshot share (UPI, P1-IN)

- **UPI-001:** wmbugo appears in the Android share sheet for images. A shared GPay, PhonePe or Paytm payment-success screenshot is parsed on-device by a fixed-layout parser per app. Screens showing a **pending, failed or declined** status are rejected with "This payment didn't go through — nothing added".
- **UPI-002:** Extract amount, direction (paid/received), payee or payer name, UPI ID when shown, bank and masked account when shown, timestamp and **UPI reference number**. Unknown fields remain unconfirmed.
- **UPI-003:** The result opens the same capture dialog as SMS (SCR-27): category grid ordered by history, "Paid from" chip (with "+ New account" when the bank isn't known), Save. Received-money screenshots offer the CAP-004 income choices.
- **UPI-004:** An image that is not a recognised UPI screen falls back to the receipt OCR flow.
- **UPI-005:** The UPI reference, together with direction and event type (FIN-027), is the strongest duplicate key: sharing the same screenshot twice, or importing a bank CSV row with the same reference and direction, never creates a second confirmed entry. A same-reference item in the **opposite** direction is never treated as a duplicate; FIN-027 decides by account whether it is a reversal or refund (same account) or an own-account transfer (different owned account).
- **UPI-006:** A share received while app lock is on is queued and delivered to the dialog after unlock; it is never lost.
- **UPI-007:** No screenshot is uploaded or kept after parsing unless the user attaches it to the transaction.
- **UPI-008 [v1.3]:** A UPI screenshot capture is confirmed only by the user's Save. If the dialog is closed without saving, the capture waits in the review queue and is never auto-approved.

**Acceptance:**
- **Given** a PhonePe "Paid ₹450 to Ravi Tea Stall" screenshot, **when** shared to wmbugo, **then** the capture dialog opens with ₹450, the payee, the time and the UPI reference filled in.
- **Given** the same screenshot is shared again, **when** parsed, **then** it is recognised by UPI reference and no second entry is created.
- **Given** a photo of a restaurant receipt is shared, **when** no UPI layout matches, **then** the receipt OCR flow opens instead.
- **Given** app lock is on, **when** a screenshot is shared, **then** after unlock the capture dialog opens with that screenshot; it is never dropped.
- **Given** a forwarded screenshot "Paid ₹3,500 to Ravi Kumar" is shared and the dialog is closed without saving, **when** 21:00 passes, **then** it stays Waiting for you, is not counted, and is never auto-approved.

## 9. End-to-end UX flows

### FLOW-01: Fresh installation
*Protagonist: Mei, first-time tracker, Singapore (SGD).*

Welcome (privacy promise) → region and currency → one account (or skip) → payday → optional "Try 50/30/20?" → Home empty/populated. At every step the user can go back safely. On skipped account, show “Set up an account to calculate your balance.” After the first saved entry, offer app lock once.

### FLOW-02: Manual expense
*Protagonist: Mei, first-time tracker, Singapore (SGD).*

＋ → amount (keypad open) → tap a quick category → (account pre-filled) → Save → sheet closes with Undo → Home/Activity totals update. Target about 6 seconds for a returning user. "Save & add another" keeps the sheet open for batch entry. If missing required info, inline error retains data; no extra save.

### FLOW-03: Income
*Protagonist: Ravi, cash and mixed-mode user, Chennai (INR).*

Add → Income → amount → destination account → source category → Save → account and net cash flow update; excludes transfers/adjustments.

### FLOW-04: Transfer and credit-card payment
*Protagonist: Ravi, cash and mixed-mode user, Chennai (INR).*

Add → Transfer → source & destination accounts → amount → optional fee → confirmation → atomic postings → Activity displays one linked transfer, account details display both legs, Insights income/expense unaffected except separate fee.

### FLOW-05: Search/edit/split
*Protagonist: Ravi, cash and mixed-mode user, Chennai (INR).*

Activity → filters/search → Detail → edit or split → validate exact minor-unit allocation → Save → derived cards/charts refresh → Undo/reversal path available.

### FLOW-06: Budget
*Protagonist: Arjun, budget-conscious salaried user, Pune (INR).*

Plan → Add budget → period, categories, target, alert thresholds → live progress → notification on threshold once per period → budget detail filtered contributing transactions.

### FLOW-07: CSV import/reconciliation
*Protagonist: Sara, privacy-focused professional, London (GBP).*

Settings → Data → Import CSV → choose file → map fields → preview → possible duplicates → confirm actions → commit in atomic batches (resumable) → summary of imported/skipped/needs-review → navigate to Review Queue. Retry of same file does not duplicate prior accepted entries.

### FLOW-08: Receipt OCR (Phase 1)
*Protagonist: Mei, first-time tracker, Singapore (SGD).*

＋ Snap receipt (or widget, or long-press ＋) → camera/file picker → "Reading receipt…" with Cancel → review screen: merchant, date, Paid with chip, category totals, "Not itemised" row, Items (N) collapsed → if a probable match exists: "Attach to it / Keep separate" → Save.

### FLOW-09: Android SMS (approved feature only)
*Protagonist: Priya, busy digital spender, Bengaluru (INR).*

Explainer (SCR-24) → OS permission → bank SMS arrives from verified sender → local parse, scam/balance checks and dedup → learned category applied → notification with Approve / Reject (grouped if several) → Approve confirms, Reject excludes (greyed, reversible), tap opens the capture dialog (bottom sheet, SCR-27) [v1.3.6] to edit category/details → eligible ignored items are written as confirmed after the cutoff by the background job or next app open (CAP-007, FIN-026) → ledger update. Unknown accounts trigger the "New account — add it?" prompt (CAP-009). Blocked senders are skipped. At denial or failed parsing, manual entry, UPI share and receipt scan remain available.

### FLOW-10: Backup & restore
*Protagonist: Sara, privacy-focused professional, London (GBP).*

Settings → Backup → passphrase/target selection → encrypted file export → success plus local warning; Restore → select file → verify and preview ("If something goes wrong during restore, nothing on this phone changes.", "Back up this phone first" link) → tick "I understand this replaces what's on this phone now" + re-authentication when app lock is on (no typed-word confirmation) [v1.3.6] → transactional restore → integrity check → Home.

### FLOW-11: Insight to source
*Protagonist: Arjun, budget-conscious salaried user, Pune (INR).*

Insights → change period/account/category → chart updates with labels → select bar/segment → filtered Activity → transaction detail → back restores filter selection.

### FLOW-12: Privacy lock
*Protagonist: Sara, privacy-focused professional, London (GBP).*

Settings → Enable app lock → OS auth confirmation → lock on configured timeout → unlock or recovery through device authentication; app snapshot obscures sensitive data.

### FLOW-13: UPI screenshot share (India)
*Protagonist: Priya, busy digital spender, Bengaluru (INR).*

Pay in GPay/PhonePe/Paytm → Share the success screen → wmbugo (app lock check; queued if locked) → parse → capture dialog pre-filled (amount, payee, time, UPI ref) → tap category → Save. Same screenshot shared twice or matching CSV row → recognised by UPI reference, no second entry.

### FLOW-14: 50/30/20 budget
*Protagonist: Arjun, budget-conscious salaried user, Pune (INR).*

Onboarding "Try 50/30/20?" or Plan → Budgets → "Use 50/30/20" → confirm monthly (or payday-cycle) income → three targets created → Home and Plan show Needs / Wants / Savings → tap a bar → categories of that type (Savings: money moved into savings pots) → transactions.

### FLOW-15: Account discovered from a capture (India)
*Protagonist: Priya, busy digital spender, Bengaluru (INR).*

SMS or UPI capture from unknown ••7730 → dialog shows "New account ••7730 (ICICI) — Add it / It's one of mine" → *Add it*: account or card created (type pre-selected from the SMS wording, CAP-009), opening balance derived from the SMS available balance (accounts only) effective just before the capture, or "balance not set" → capture saved to it. *One of mine*: pick an account; ••7730 is linked to it permanently.

### FLOW-16: Own-account transfer from two captures
*Protagonist: Priya, busy digital spender, Bengaluru (INR).*

Debit SMS from HDFC ₹5,000 → credit SMS to ICICI ₹5,000 minutes later → credit dialog offers "Moved from my own account" with HDFC pre-selected → Save → one linked transfer; neither leg counts as income or expense.

### FLOW-17: Pay card bill
*Protagonist: Arjun, budget-conscious salaried user, Pune (INR).*

Accounts → HDFC Card (Money you owe) → Pay card bill → Add sheet opens as Transfer, From: chosen asset account, To: card, amount = statement due if entered, otherwise outstanding (ACC-007) → Save → card due drops, asset balance drops, spending unchanged.

### FLOW-18: Re-approve a rejected capture
*Protagonist: Priya, busy digital spender, Bengaluru (INR).*

Activity → Show rejected (within 90 days of rejection) → greyed item → detail → "Restore" → status `confirmed` (`user_approved`) → balances and budgets update atomically.

## 10. Calculation and business rules glossary

| Term | Normative meaning |
|---|---|
| Transaction | A recorded economic event with intent, provenance and postings |
| Account balance | Sum of starting balance + applicable postings, by account |
| Known available funds | Sum of included active asset account balances; **not** net worth and not guarantee of actual bank data |
| Income | External inflow categorized as income, excluding transfers/opening/adjustments |
| Expense | Net user spending after related refunds, excluding transfers |
| Cash flow | Income minus expenses for a period; may not equal balance change due to transfers/adjustments |
| Budget used | Confirmed eligible expenses minus refunds (linked or categorised) in the budget period, never below zero (BDG-006) |
| Budget remaining | Budget target − budget used; can be negative, in which case the UI shows "Over budget ₹X" with the amount unsigned, never a minus sign (§6.3) [v1.3.6] |
| Percent used | Used / positive target × 100; handle target = 0 separately |
| Safe to spend | Conservative estimate limited by eligible budget headroom and included funds minus reserved obligations |
| Subscription candidate | Heuristic suggestion requiring user confirmation |
| Confirmed recurring rule | User-approved schedule for expected payments, not automatic actual ledger spending |
| Savings goal progress | Assigned money/contributions according to explicit virtual-vs-actual rule |
| Insight baseline | Comparable prior complete/partial period chosen and labeled |
| Review queue | Incomplete/ambiguous entries excluded from definitive analytics until confirmed |
| Pending capture | An automated capture awaiting Approve/Reject; excluded from headline totals until approved or auto-approved |
| Mixed merchant | A merchant given 2 or more different categories within its last 5 user confirmations (LRN-003); the app offers choices instead of guessing |
| Merchant alias | Locally mapped source name to canonical merchant entity |
| Verified sender | A DLT SMS header on the bundled allow-list or confirmed once by the user (SMS-010) |
| Left in budget | Overall budget target − budget used for the current period; with only 50/30/20, (Needs + Wants targets) − (Needs + Wants + Not classified spending) (§6.3); shown on Home and used by Free to use; goals never reduce it |
| Free to use | User-facing name for safe to spend (BDG-008); shown on Plan only |
| Category type | need or want on expense categories (CAT-006); savings comes from money moved into savings pots (BDG-009) |
| Savings pot | A destination for money being saved or invested (SIP, RD, PPF, emergency fund), balance optional; never an everyday bank account (ACC-009) |
| Receipt / bill | Receipt = scanned proof of purchase (OCR); bill = payable due date (REC) |
| Home card / home-screen widget | Home card = card on the Home tab; home-screen widget = Android launcher widget (SCR-29) |
| Capture resolution | How a capture left review: user_approved, auto_approved, auto_linked or rejected |

**Rounding:** Integer minor units of the profile currency; percentages are derived from exact integer totals and rounded only for display; category percentages may sum to 99%/101% due to rounding, and UI should acknowledge/remainder-adjust visually without changing underlying values.

**Period management:** No cron/midnight reset dependency. Aggregations derive from effective transaction dates on demand and are cached/incrementally updated as appropriate. Month change in Home occurs on next render/resume even if OS suspends tasks.

## 11. Data model requirements (logical, architecture to refine)

### 11.1 Entities

- `profile(id, region[ISO 3166 country code], currency_code, currency_exponent, locale, timezone_id, payday_rule?, clock_guard(wall_time, elapsed_since_boot, boot_count), created_at)` (one per install in Phase 1; auto-approve settings live only in `auto_approve_rule`)
- `account(id, name, type[cash|bank|wallet|savings_pot|card], icon, color_token, credit_limit_minor?, statement_due_minor?, statement_due_date?, opening_minor?, opening_effective_at?, balance_not_set, include_in_overview, sort_order, status, timestamps)` — masked identifiers live only in `account_identifier`
- `transaction(id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, merchant_id?, payee_id?, refund_of_transaction_id?, recurring_rule_id?, original_description?, note?, reference?, payment_method?, tags[], capture_resolution?, needs_category, foreign_amount_minor?, foreign_currency?, foreign_currency_exponent?, removed_at?, removal_kind?[deleted|rejected|excluded], created_at, updated_at, reversed_by_id?)`
- "Before tracking started" is **derived** from `local_date` vs the account's `opening_effective_at`, never stored. Goal links are stored only in `goal_allocation` (no `transaction.goal_id`).
- Provenance is many-to-one: every `source_record` points to its transaction (`source_record.transaction_id`), so a merged SMS + receipt + CSV transaction or a two-capture transfer keeps all sources. Amounts are in the single profile currency; there is no per-row currency column.
- `posting(id, transaction_id, account_id, direction, signed_amount_minor, posting_kind)`
- `split(id, transaction_id, category_id, amount_minor, memo?)`
- `category(id, parent_id?, name, kind, budget_type[need|want]?, icon, color_token, sort_order, archived)`
- `merchant(id, canonical_name, aliases, archived)`
- `source_record(id, transaction_id?, source_kind[sms|upi_screenshot|receipt|csv|manual], source_fingerprint, external_reference?, sender_id?, import_batch_id?, confidence?, parse_complete, scam_flag, balance_flag, redacted_preview?, source_received_at)`
- `learned_mapping(id, key_kind[merchant|upi_id|item|category|payer|mandate], key, target_kind[category|account|credit_type|transfer_choice], category_id?, account_id?, credit_type?, transfer_target_account_id?, mixed, recent_confirmations, updated_at)`
- `payee(id, upi_id?, display_name)`
- `sender(id, normalized_entity, raw_headers[], status[allowed|user_confirmed|blocked])`
- `account_identifier(id, sender_id, mask, kind[account|card], account_id)` — unique on (sender_id, mask)
- `balance_chain(sender_id, mask, last_balance_minor, last_balance_at)` — accounts only, never card limits
- `sms_cursor(last_processed_received_at, last_processed_fingerprint, consent_at, backfill_offered)` — where the SMS catch-up resumes; set to the consent moment on first enable (SEC-001)
- `tombstone(fingerprint_hash, outcome[rejected|deleted], purged_at)` — no amount, merchant or text (FIN-014)
- `auto_approve_rule(version, enabled, cutoff_local, effective_from)`
- `budget_alert_fired(budget_id, period_start, threshold_pct, fired_at)`
- `receipt_item(id, attachment_id, transaction_id, name, qty?, amount_minor, split_id?, category_id?, unparsed)`
- `prompt_state(key, count, last_shown_at)` (e.g. SMS re-ask counter, one-time tips)
- `import_batch(id, file_digest, profile, status, imported_count, error_count, raw_path?, retain_until?, created_at)`
- `budget(id, target_minor, period_rule, scope[overall|category|budget_type|savings], scope_ref_id?, account_ids[]?, template?[50_30_20], effective_from, version, alert_rule)`
- `budget_period(id, budget_id, start_date, end_date, cached_target_minor?, version)` (derived/cache if needed)
- `recurring_rule(id, title, kind[subscription|rent|emi|utility|other], cadence, amount_minor, amount_tolerance_minor, merchant_id?, payee_id?, account_id, category_id, due_rule, notify, status[active|paused|ended], end_at?, timezone_id, next_due_at)`
- `goal(id, name, icon, color_token, target_minor, allocation_mode, due_at?, linked_account_id?, status)`
- `goal_allocation(id, goal_id, transaction_id?, amount_minor, allocation_type, date)`
- `attachment(id, local_encrypted_path, mime_type, size, digest, transaction_id, created_at)`
- `review_candidate(id, source_record_id, proposed_transaction_id?, match_score, reason, status, resolved_at?)` — the `possible_duplicate` flag (FIN-024) is derived from an open candidate with reason `duplicate`; it is not stored separately
- `automation_rule(id, kind, predicate, action, priority, enabled)` (Phase 2; local learning in P1 uses `learned_mapping`, not this table)
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
| NFR-01 | Core works fully in Airplane Mode after installation/on-device setup | E2E offline suite, run on the release build |
| NFR-02 | No unsolicited outbound financial data; no app-owned remote processing | Proxy inspection and dependency review |
| NFR-03 | Screen navigation median <300ms under defined reference data/device load | Perf instrumentation |
| NFR-04 | Manual entry Save confirmation p95 <500ms after validation for ordinary local writes on reference devices | Benchmark |
| NFR-05 | Home visible within p95 2s warm start on supported reference device for 10k ledger records | Benchmark |
| NFR-06 | UI animation: ≥ 95% of frames at 60 FPS with no stall over 100 ms; expensive analytics/OCR never run on the UI thread | Profiler |
| NFR-07 | 10k transactions: list scrolling with ≥ 95% of frames at 60 FPS and no dropped-frame bursts > 100 ms; search p95 < 500 ms for indexed queries | Dataset benchmark |
| NFR-08 | Receipt OCR p95 ≤5s on benchmark single-page sample/reference hardware; failure/timeout escape always works | Device test |
| NFR-09 | All financial mutations atomic; invariant violations = 0 across regression/property suites | CI |
| NFR-10 | Database and attachments unreadable on a device that is powered off or has not been unlocked since it was turned on, without the device credential; backups unreadable without the passphrase; under the §17 threat model (rooted devices excluded). After the first unlock, wmbugo may read the database while the screen is locked so capture and the auto-approve write work; app lock still guards opening the app | Security tests |
| NFR-11 | TalkBack labels on every control; layouts usable at 200% font scale; WCAG AA contrast; reduced motion honoured; touch targets ≥ 48 dp | Accessibility audit |
| NFR-12 | Crash/restart during import/backup/migration leaves consistent database and recoverable UI | Fault injection |
| NFR-13 | Clear Android/iOS parity matrix and market availability matrix for platform- and market-specific features (§13) | Release review |
| NFR-14 | 0 mandatory recurring server/API costs for core operation; app store, developer membership, support and device costs are not represented as zero | Financial review |
| NFR-15 | Avoid collecting personal financial data for product telemetry; opt-in research clearly scoped | Privacy review |
| NFR-16 | SMS received → capture notification p95 ≤ 5 s while the app process is alive, and ≤ 30 s when the process was killed (India, approved build) | Device test |
| NFR-17 | SMS and UPI parsing meet the §3.3 precision/recall targets; receipt total/merchant/date accuracy ≥ 90% on the reference set | Fixture corpus (CI) / device test |
| NFR-18 | Background work for capture stays within a battery/CPU budget set per GATE-03 reference device; no always-running service | Device profiling |
| NFR-19 | Glass surfaces: ≥ 95% of frames at 60 FPS with no stall over 100 ms while scrolling on reference mid-range devices; devices that cannot meet this use `glass.fallback` | Profiler |
| NFR-20 | Splash (system + in-app) adds ≤ 1 s before Home within the NFR-05 budget; splash ends when the database is ready, never on a fixed timer | Benchmark |

Benchmarks are **engineering targets**, not universal guarantees; architecture must designate device models/OS versions and iterate based on test evidence. Do not require all database work within a single 16ms frame.

## 13. Privacy, policy and platform parity

### 13.0 Platform parity

| Feature | Android (P1) | iOS (P2) |
|---|---|---|
| Manual account/transaction/budget, 50/30/20 | Yes | Yes |
| Offline charts | Yes | Yes |
| Local file CSV import/export | Yes | Yes |
| Receipt attachment and on-device OCR with itemization | Bundled local model | Apple Vision / local OCR after validation |
| Passive SMS detection (India) | Only with Play approval, approved build | Not supported; fallback: UPI share, receipt scan, manual |
| UPI screenshot share (India) | Share sheet | Share extension, Phase 2 |
| Capture notifications with Approve/Reject | Yes | Phase 2 for shared/receipt captures; no SMS source |
| Capture dialog | Dialog-styled activity hosting a bottom sheet [v1.3.6] | Phase 2: in-app sheet from notification |
| Lock-screen approve (opt-in) | Yes | Phase 2, OS-dependent |
| Local learning | Yes | Yes (Phase 2) |
| Receipt-to-capture match prompts | Yes | Yes (Phase 2) |
| SMS scam/sender protections | Yes (India) | N/A |
| Home-screen widget | Launcher widget | WidgetKit widget, Phase 2 |
| Glass visual system | Blur where supported, otherwise `glass.fallback` | Native blur, Phase 2 |
| Biometric/PIN lock | OS backed | OS backed |
| Encrypted file backup | Yes | Yes |
| Local scheduled reminder | Best effort, no exact guarantee | Best effort, no exact guarantee |

### 13.0a Market availability (Phase 1)

| Capability | India | US/Canada | UK/Europe | Gulf/SE Asia |
|---|---|---|---|---|
| Manual entry, receipt OCR (itemized), CSV import, budgets, 50/30/20, widget, backup | Yes | Yes | Yes | Yes |
| UPI screenshot share | Yes | — | — | — |
| SMS capture | Yes, if Play-approved | — | — | — |
| Currency | INR | USD / CAD | GBP, EUR, CHF, SEK, NOK, DKK, PLN, CZK, HUF | AED, SAR, QAR, BHD, KWD, OMR, SGD, MYR, THB, IDR, PHP, VND |
| Number format | en-IN (lakh grouping) | en-US / en-CA | per region | per region |

Unavailable capabilities are not shown in that market (no dead controls, no "coming soon").

**Phase 1 currency list** (the INTL suite runs against every row):

| Code | Exponent | Default locale |
|---|---|---|
| INR | 2 | en-IN |
| USD | 2 | en-US |
| CAD | 2 | en-CA |
| GBP | 2 | en-GB |
| EUR | 2 | per region (e.g. de-DE, fr-FR, en-IE) |
| AED | 2 | en-AE |
| SAR | 2 | en-SA |
| QAR | 2 | en-QA |
| BHD | 3 | en-BH |
| KWD | 3 | en-KW |
| OMR | 3 | en-OM |
| SGD | 2 | en-SG |
| MYR | 2 | en-MY |
| CHF | 2 | de-CH / fr-CH |
| SEK, NOK, DKK | 2 | sv-SE, nb-NO, da-DK |
| PLN, CZK | 2 | pl-PL, cs-CZ |
| HUF | 0 (whole forints) | hu-HU (English UI) |
| THB | 2 | th-TH (English UI) |
| IDR | 0 (whole rupiah) | id-ID (English UI) |
| PHP | 2 | en-PH |
| VND | 0 | vi-VN (English UI) |

Stored exponent follows ISO 4217, except IDR and HUF, which wmbugo stores, shows and accepts as **whole units** (exponent 0) because decimals are not used in practice; an imported IDR or HUF amount with decimals is rounded to the nearest whole unit with a visible note on that row. **Region and currency are chosen in onboarding step ②**, pre-selected from the device's *region* setting (not its language) and shown for explicit confirmation. Currency can still be changed while the profile holds only onboarding data (no transactions yet). **Region** is the user's country as an ISO 3166 code (e.g. IN, GB, DE, AE, SG), chosen in onboarding; currency, default number format and market group are looked up from a country table. **Feature gating rule:** a market feature (SMS, UPI share) is shown only when the build supports it **and** the profile region is `IN`; nothing else (device language, Play country) decides it.

Adding a currency is a configuration change plus an INTL test row, not a code change.

### 13.1 Store-policy gate

Android SMS permissions are restricted; `SMS-based money management` appears in Google's exception list **subject to Play review and approval**, not as an automatic entitlement. A Play-ready build without approval must omit restricted permissions and related inactive receivers from its manifest. Recheck the current policy before submission: https://support.google.com/googleplay/android-developer/answer/10208820.

### 13.2 No-SMS variant (India without Play approval, and all other markets)

| Item | No-SMS build |
|---|---|
| CAP-001..012 (notifications, dialog, grouping, auto-approve, account discovery, transfer linking, bill matching) | **India no-SMS build:** apply to UPI-share captures; a share dialog the user dismisses without saving is kept as "Waiting for you" (so an interrupted share is not lost) but is **never auto-approved**; only Save confirms it, and it can be rejected from the review queue. **Other markets:** no capture notifications, grouping, evening summary or auto-approve (all entries are user-initiated); the receipt match prompt (OCR-010) is the only capture dialog; the widget shows "N to check" only for review items such as import duplicates |
| LRN-001..010 | Present (learning from manual, receipt and UPI entries) |
| SMS-001..017, SCR-24 | **Absent**, including the SMS-014 re-ask card and any SMS settings or text |
| SCR-27 capture dialog | Present for UPI share (India) and receipt match prompts |
| SCR-28 | Present; blocked-senders section hidden |
| SCR-29 widget | Present; "N to check" counts waiting UPI captures (India) or review items such as import duplicates (other markets) |
| Differentiator (§1.3 #4) | Receipt scan everywhere; plus UPI share in India |

### 13.3 No-network claim boundary

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
| Unsupported platform or market feature | Not shown at all (§13.0a, SMS-015); where the user reaches a related task, offer the available path (e.g. Snap receipt) |

## 16. Quality assurance strategy and acceptance suites

**Test pyramid:** pure financial-domain unit/property tests → SQLite integration/migration tests → React Native component/accessibility tests → Detox/Maestro or appropriate E2E → physical device/manual policy validation. Fixtures contain synthetic data only.

### 16.1 Required suites and representative cases

| Suite | Required cases |
|---|---|
| FIN | transfer conservation; credit card payment; opening balance; refunds; edited splits; reversal; integer minor-unit limits for each currency exponent |
| TXN | add/edit/reverse; interrupted save; form validation; undo; virtualized list and filter correctness |
| ACC | archive with balance; reconcile; account scope; liability presentation |
| BDG | payday period; month boundary app suspended; no rollover; refunds; threshold once/period |
| INS | chart ties to records; previous zero baseline; negative net cash flow; filter composition; no-data states |
| IMP | repeated file; duplicate against manual; date/amount parsing; malformed row; atomic rollback |
| OCR | rows; multi-column; tax/discount; low contrast; duplicate matching; correct midpoint formula |
| SMS | approval build flags; consent; denial; parsing debit/credit; nonfinancial ignored; OEM restrictions; non-bank sender ignored; header variants (AD-/VM-/JD-/BZ- prefixes, -S/-T/-P/-G suffixes) normalize to one entity; scam wording flagged; genuine refund not flagged; balance chain per (sender, mask); card "Avl Lmt" never used as a balance; SMS before first unlock picked up by the post-unlock SMS catch-up, exactly once; blocked sender ignored; re-ask limits |
| CAP | approve/reject from notification (with and without app lock); grouped notification; batch apply-to-similar; auto-approve after cutoff excludes possible duplicates, open review candidates, incomplete parses, transfer-like captures and SMS-011/012 flags; auto-approve written by background job or next open with app killed overnight, consistent across Home, widget, summary and exports; auto-approve never links bills or teaches learning; device clock change does not trigger early auto-approve; reject then re-approve updates balances; lock-screen public version redacted; lock-screen opt-in; new-account discovery; own-account transfer linking; bill-rule matching |
| UPI | each supported app layout; received vs paid; pending/failed screens rejected; same screenshot twice; screenshot then matching CSV row; same-reference reversal linked, not deduplicated; non-UPI image falls back to OCR; share while locked is delivered after unlock |
| INTL | each currency in §13.0a round-trips (exponents 0, 2, 3; IDR/HUF as whole units, decimal imports rounded with a note); region number formats (en-IN lakh, en-US, de-DE decimal comma); receipt parsing with decimal comma; currency pre-selected from device region; feature gating = build AND region India; INTL suite runs on a physical Android device (Hermes), not only in Jest; cross-zone trip and DST week keep local_date; no SMS/UPI UI outside India |
| DEDUP | FIN-027 windows; two genuine identical purchases not flagged; identical CSV rows kept; merge by source authority (FIN-027): receipt-then-card keeps the card account and the receipt items; tip difference becomes a split; manual duplicate held, not counted; tip tolerance on receipts |
| 5030 | template creates three targets; category type changes move spending between bars; overall and type budgets never summed |
| BRAND | splash ends when DB ready; reduced motion shows still coin; `glass.fallback` on API < 31, battery saver and animator scale 0; text contrast on glass ≥ 4.5:1 |
| LRN | merchant learned after first categorization; UPI-ID learning; mixed-merchant choices; item learning; forget entry |
| REC | monthly end-of-month; pause/renew; planned not posted; rejected candidate |
| BKP | wrong key; corrupt file; interrupted restore; migrated version; attachments |
| SEC | encrypted storage; app snapshot privacy; exported CSV warnings; no third-party network requests |
| UX | TalkBack (VoiceOver P2); dynamic type; reduced motion; text contrast; touch targets; tab/deep-link navigation |
| PERF | 10k/50k synthetic items; startup; search; chart updates; background restoration |
| PLAT | Android permission policy variant; notification denial; app lifecycle; iOS picker/camera (P2) |

### 16.2 Minimum release-blocking criteria

Release priorities below are **RB0** (blocks release) and **RB1** (must be verified or explicitly waived by the product owner). They are not phase labels.

- **RB0:** No known incorrect account balance, duplicate confirmed counting, monetary rounding error, data loss in normal paths, or irreversible unsafe migration.
- **RB0:** All P1 flows work in Airplane Mode on Android in every Phase 1 market (iOS equivalent is a Phase 2 release criterion).
- **RB0:** Auto-approve never confirms a capture that matches an existing confirmed transaction, is flagged `possible_duplicate`, or is incompletely parsed.
- **RB0:** No-SMS builds contain no SMS permission, receiver or SMS-related UI text.
- **RB0:** Privacy policy and store disclosures reviewed for every Phase 1 market (GATE-08).
- **RB0:** Backup/restore tested end to end, including wrong password and corruption.
- **RB0:** Security and Play permission review completed for actual Phase 1 release builds; the shipped variant matches the SMS approval outcome (App Store review in Phase 2).
- **RB0:** OCR never auto-creates a second confirmed expense for an existing SMS/manual/imported transaction.
- **RB0:** Core accessibility blockers eliminated; financial state never conveyed only by color.
- **RB1:** Performance objectives verified on reference devices; documented exceptions accepted by product owner.
- **RB1:** Usability study validates Home comprehension ("Left in budget" vs "Free to use"), expense addition, account transfer, budget drill-down, and auto-approved entry comprehension (≥ 90%).

### 16.3 Reference-set protocol (real receipts and screenshots)

Real receipts and UPI screenshots collected from beta testers are **not fixtures** and never enter the repository or CI. Rules:
- Written consent per contributor, explaining purpose, storage and deletion.
- **Accuracy is measured on the tester's own phone**, inside the beta build, before anything leaves it: the parser runs on the receipt or screenshot, the tester confirms or corrects each field, and the app records a per-field score. Only the scores and a **redacted copy** (payee names, UPI IDs, phone numbers, card fragments and loyalty IDs blacked out) are uploaded, through an **encrypted in-app upload** to the developer — never email or chat apps. The upload exists only in a **separate measurement app with its own package ID** (e.g. "wmbugo Lab"), installed only by consenting testers (sideloaded or on its own test track) and never published under the production ID. The Play closed testing track for betas A and B runs the real no-internet build, so the 14-day closed test and the Play Data safety form match the release exactly (SEC-002, GATE-08, GATE-13). The original image never leaves the tester's phone.
- Stored encrypted outside the repository, on the developer's machine only; retained at most 12 months or until Phase 1 launch + 3 months, whichever is first; deleted on request within 30 days.
- The uploaded scores are the accuracy evidence for §3.3; CI runs only on synthetic or re-typeset receipts and synthetic screenshots.
- The protocol is covered by a GATE-08 privacy review **before collection starts at M3** (in addition to the review before Play submission).

### 16.4 Test traceability format

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

Original BRD: free core and $9.99 one-time local-license premium including receipt itemization, recurring detection and PDF reports. Preserve this **as a hypothesis**, not an implementation instruction for Phase 1. **Monetization is Phase 2 (DEC-13):** Phase 1 contains no billing or entitlement code, and features shipped free in Phase 1 (including SMS capture and OCR) must not be retroactively paywalled without a product decision entry. Decide price region, tax, store fee, restore-purchase behavior, offline cached entitlement, premium feature parity and what functionality must remain free **after** usability and store billing feasibility review. The base ledger, data export/backup, privacy and security must never be trapped behind a paywall that prevents users accessing their own information.

## 20. Dependencies, milestones and implementation order

**Team:** one developer working with AI coding agents; every gate owner role in §24 is the product owner unless an external reviewer is named (GATE-08 requires a paid external privacy review).

1. **M0 Product freeze (2026-11-02 → 2026-11-07):** PRD approved and frozen (this version); UX (`bmad-ux`) and architecture (`bmad-architecture`) produced in parallel from the frozen PRD and the capture status mapping (FIN-024/FIN-026); epics, stories and sprint plan ready.
2. **M1 Architecture spike and policy start (inside the same week, 2026-11-03 → 2026-11-07):** prototype the integer minor-unit ledger, encryption, safe migrations, the shared capture pipeline and OS capabilities; produce ADRs. **Publish a provisional privacy policy page** (marked provisional; replaced by the GATE-08-reviewed version before production submission); confirm Play account type (GATE-13); **choose the base application ID now and set up the build so either GATE-02 outcome works** (the no-SMS app is the main package everywhere; the `sms` edition can ship in the same package or as a separate package with its own ID); ask Play support about India-only SMS targeting, without waiting for the answer.
3. **M2 Internal alpha (started by 2026-11-08 on the developer's phone):** it starts with the invariant property tests, which need no schema; schema-dependent work waits for the ledger ADR (§11.2). Invariant property tests first, then ledger, accounts, manual entry, capture-pipeline skeleton, encrypted storage. Exit: zero invariant violations.
4. **M3 Closed beta A:** UPI share, receipt OCR with itemization, home-screen widget, Approve/Reject, learning; the `sms` flavor on an internal test track and the **Play SMS declaration submitted** with it (SMS-016). Exit: duplicate-detection suite green; reference receipt and screenshot sets collected under the **reference-set protocol** (§16.3).
5. **M4 Closed beta B:** budgets incl. 50/30/20, goals, Insights, CSV import, backup/restore, glass visual system and fallback. Exit: §16.2 RB0 list green; guerrilla usability sessions (≥5 participants) done.
6. **M5 Play launch (Phase 1):** no-SMS build in all four market groups; SMS-enabled build in India only if approved. Closed betas A and B run on a Play **closed testing track** with at least 12 testers for at least 14 days, which also satisfies the new-personal-account requirement (GATE-13).
7. **M6 Phase 2:** iOS build, testing, App Store review and release; monetization; subscription inference and advanced charts.

**Dates for M3–M5** are set at sprint planning from the alpha's measured velocity, and revisited at a checkpoint at the end of M2. Until then they are deliberately undated rather than guessed.

**Epic → milestone map** (every P1 epic has a stage):

| Milestone | Epics |
|---|---|
| M2 Internal alpha | WMB-03 Ledger and accounts · WMB-04 Activity and review (manual entry, edit, delete) · WMB-10 encrypted DB + app lock · WMB-01 shell (tabs, ＋, header, Settings hub skeleton) · WMB-18 currency exponents and region formatting |
| M3 Closed beta A | WMB-16 Capture review and learning · WMB-17 UPI share · WMB-11 Receipt OCR · home-screen widget (WMB-16) · WMB-12 SMS in the `sms` flavor (internal track only until approved) · WMB-02 Onboarding |
| M4 Closed beta B | WMB-05 Home (hero states, cards) · WMB-06 Categories/budgets incl. 50/30/20 · WMB-09 Recurring/goals + Plan timeline · WMB-08 Insights · WMB-07 Import/export · WMB-10 backup/restore + diagnostics · WMB-01 glass, fallback, coin-flip loader, boat states (GATE-12 assets) |
| M5 Play launch | WMB-14 QA, device matrix, store listings per market · WMB-18 per-market listings and privacy disclosures (GATE-08) |

No automatic code replacement or rewrite is mandated. An implementation audit maps reusable current code to the approved PRD requirements and identifies migrations, refactors and removals.

## 21. BMAD epics and recommended vertical slices

| Epic | Definition | Sample slices | Phase |
|---|---|---|---|
| WMB-01 | Design system and shell | tokens incl. gradient/glass + fallback → tab bar with centre ＋ → header + Settings hub → tablet rail → UI states → coin-flip loader and boat illustrations | P1 |
| WMB-02 | Onboarding and preferences | privacy → region/currency → one account → payday → 50/30/20 offer → just-in-time tips | P1 |
| WMB-03 | Ledger and accounts | invariant property suite → schema (currency exponent, category type) → posting engine → account balance → transfer/adjustment → account discovery | P1 |
| WMB-04 | Activity and review | add sheet → edit/delete → search → splits → review queue | P1 |
| WMB-05 | Home | hero states → Home cards → card editor | P1 |
| WMB-06 | Categories/budgets | category CRUD + type → budget rules → 50/30/20 template → thresholds → period detail | P1 |
| WMB-07 | Local import/export | CSV mapping → preview → dedup via shared pipeline → atomic commit → export | P1 |
| WMB-08 | Insights | aggregation → filters → question-ordered charts → Needs/Wants/Savings → drill-down → comparisons | P1 |
| WMB-09 | Recurring/goals | manual rule → Plan timeline → reminders → bill matching → goal allocations | P1 |
| WMB-10 | Privacy/security/backup | encrypted DB → app lock → encrypted export/restore → diagnostics | P1 |
| WMB-11 | Receipt OCR | scan → parse → itemize with quality floor → correction → split → match to existing | P1 (Android); iOS validation P2 |
| WMB-12 | Android SMS automation | policy gate → explainer/consent → verified senders → parse → scam/balance checks → block sender → reconcile → diagnostic | P1-IN, conditional on Play approval |
| WMB-16 | Capture review and learning | shared capture pipeline → Approve/Reject notification → capture dialog (bottom sheet) → grouped/batch → auto-approve write (job or next open) → account discovery → learning → home-screen widget | P1 |
| WMB-17 | UPI screenshot share | share intent + lock queue → per-app parsers → capture dialog → UPI-reference dedup | P1-IN |
| WMB-18 | Internationalization | currency list + exponents → region formatting → market feature availability → per-market store listings | P1 |
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
- No unresolved RB0 contradiction with architecture or PRD.

### 22.2 Definition of Done

- Code implemented to approved design/domain contract on target platform(s).
- Unit + integration + E2E acceptance evidence; local-data invariants pass.
- Empty/loading/error/permission states implemented and accessibility reviewed.
- No unsafe logs/network transmission; security review as applicable.
- Performance checked against reference devices.
- Migrations and rollback/recovery tested when storage changes.
- Source of truth documentation and story traceability updated; reviewed by owner.

## 23. Source document reconciliation and provenance

The five user-provided baseline documents, dated June 2026, are the historical source of the product premise, privacy boundaries, original implementation choices and testing scenarios. This PRD intentionally expands and corrects them.

| Original source | Original key points `[SRC]` | PRD v1 treatment |
|---|---|---|
| Business Requirements Document (BRD) | Offline device-first, privacy, $0 server core, free/one-time premium, platform distinction | Retain offline promise and business hypothesis; correct platform parity and licensing dependencies |
| Product Requirements Document (PRD) | No-account onboarding, SMS, receipt OCR, recurring trends, 4 tabs, two themes, dashboard | Expand to full finance experience; four tabs plus centre ＋ (v1.3); gate SMS; OCR and gated SMS in Phase 1 (v1.1) |
| Functional Requirements Document (FRD) | SMS broadcast parsing, on-device item OCR, strict month reset, 28–31-day repeat pattern, live widget updating | Replace destructive reset; broaden cadence; add reconcile and real accounting rules |
| Technical Specification Document (TSD) | RN CLI, JSI storage, `expenses`/`expense_items`, local libraries, OCR geometric logic | Make technology candidate; replace `REAL`, introduce postings, fix midpoint and simplify assumptions |
| QA Test Plan | Six scenarios for SMS, OCR, month change, subscription, air gap | Retain as regression seed; add correctness/security/UX/backup/platform suites |

### 23.1 Superseded source requirements (explicit)

- `FR-CLK-001`, `REQ-CLK-06`, `TC-CLK-504`: *physical midnight reset/archival* replaced with persistent ledgers and period-based read models. No balances reset.
- `FR-CLK-002`: *mandatory non-rollover* retained as default budget behavior only, not deletion/reset of target definitions.
- `FR-SUB-003`, TSD recurrence heuristic: no auto-confirmed active subscriptions based solely on two matches.
- TSD `expenses.amount REAL`: integer minor units in relational postings.
- TSD OCR midpoint `top + bottom / 2`: fixed to `(top + bottom) / 2`.
- PRD four-tab nav: v1.0 replaced it with five destinations; v1.3 returns to four tabs with a centre ＋ button and a header Settings hub (DEC-16).
- FRD 16ms all calculations target: replaced with task-specific performance budgets and non-blocking computation.
- SMS persistent low-level background interception requirement: conditional on platform rules and user consent; not assumed always available.
- TSD `is_synced`: removed from v1 product logic (no sync).

## 24. Explicit assumptions, remaining external validations and change control

This PRD strives to be **implementation-ready and internally comprehensive**, but “no gaps” cannot be truthfully guaranteed without review. The following items are **not hidden unknowns**; they are named gates with owners and required outputs.

| Gate | Owner role | Required evidence before dependent work/release |
|---|---|---|
| GATE-01 | Product owner | Sign off P1 scope and personas; Phase 1 is free with no billing code (DEC-13); premium positioning is GATE-11, Phase 2 |
| GATE-02 | Android release/policy owner | Current SMS permission eligibility; **by M3 (when the SMS declaration is filed)**, whether an India-only SMS release can coexist with a no-SMS release in one package. Fallback if not: two packages (no-SMS everywhere; SMS edition in India), with a cross-package path for Indian users via encrypted backup → restore that carries learned mappings, senders and review state; declaration approval or disabled variant |
| GATE-03 | Mobile architect | Device/OS support matrix and reference performance hardware |
| GATE-04 | Security engineer | Encrypted DB library/key management, file backup format/threat model |
| GATE-05 | Mobile/OCR engineer | Confirm the chosen OCR stack works fully offline in a build **without the `INTERNET` permission** (SEC-002), its licence terms are compatible with no data collection, Phase 1 script coverage (OCR-007); iOS/Android parity is Phase 2 evidence |
| GATE-06 | UX lead | Screens, component tokens, full wireframes, usability results |
| GATE-07 | Finance domain reviewer | Posting sign convention, refunds, liabilities, budget formulas and test fixtures |
| GATE-08 | Compliance/release | Accurate privacy policy and store disclosures reviewed for India (DPDP), EU/UK (GDPR), US/Canada and Gulf/SE Asia; Play Data safety form matches actual SDK behaviour; the §16.3 reference-set protocol; external paid review before Play submission |
| GATE-09 | QA lead | Device matrix, benchmark methodology, regression evidence |
| GATE-10 | BMAD workflow owner | Installed workflow input path, PRD validation, story traceability |
| GATE-11 | Commerce owner | Premium packaging and local entitlement strategy, if enabled |
| GATE-12 | Brand/motion | Final logo SVGs, monochrome and notification icons, and the production coin-flip motion asset |
| GATE-13 | Release owner | Play developer account type confirmed; closed-test plan if required |

**Solo-review risk (accepted by the product owner, v1.3):** with one person holding every owner role, self-review is unavoidable. Each gate therefore names a concrete check that doesn't depend on judgment alone:

| Gate | Check used in place of an independent reviewer |
|---|---|
| GATE-04 Security | Threat-model checklist in the architecture ADR; dependency audit; network-traffic proxy test of representative flows (SEC-002); AI-assisted security review of the diff before each beta |
| GATE-06 UX | Guerrilla usability sessions (≥5 participants) in M4 |
| GATE-07 Finance | FIN invariant property suite (§16.1) green; worked examples for transfers, refunds, card payments, 50/30/20 reviewed against fixtures |
| GATE-08 Compliance | External paid privacy-policy review (the one gate not self-reviewed) |
| GATE-09 QA | §16.2 RB0 list automated where possible; device matrix run recorded |

**UX design [v1.3.6]:** the items previously listed here as open (CSV import wizard detail, backup/restore screens, SMS permission explainer copy and layout, empty/error/permission-denied states for every screen (§6.4), widget layouts, evening summary layout) are designed in the UX spines: [DESIGN.md](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md) (visual contract), [EXPERIENCE.md](../../ux-designs/ux-wmbugo-app-2026-11-07/EXPERIENCE.md) (behaviour, state patterns, flows) and the approved key-screen mockups in [mockups/](../../ux-designs/ux-wmbugo-app-2026-11-07/mockups/). The spines win over any mock when they conflict. **GATE-06 evidence** (screens, component tokens, wireframes) lives in that folder (`_bmad-output/planning-artifacts/ux-designs/ux-wmbugo-app-2026-11-07/`); usability results remain due from the M4 guerrilla sessions.

**Change control:** Any material decision modifying offline privacy, money model, included features, platform behavior or monetization requires a new ADR/product decision entry, PRD version increment and downstream UX/architecture/story impact review.

### 24.1 Change log

| Version | Date | Change | Decisions affected |
|---|---|---|---|
| 1.1.0-draft | 1 Nov 2026 | Receipt OCR and Android SMS ingestion moved from Phase 2 to Phase 1 (SMS remains Play-approval gated with a no-SMS fallback variant). iOS device testing, App Store review and iOS release moved to Phase 2 (iOS still built in parallel). Monetization moved to Phase 2. | DEC-01, DEC-07, DEC-10, DEC-13; §4, §5.2, §8.11–8.12, §13, §16.2, §19, §20, §21 |
| 1.2.0-draft | 1 Nov 2026 | "Effortless capture" from brainstorming session (`_bmad-output/brainstorming/brainstorm-sms-ocr-capture-2026-11-01/`): Approve/Reject as universal capture interaction, end-of-day auto-approve, local learning moved to Phase 1, rejected captures retained, floating capture dialog, scam/sender protections, permission explainer and re-ask policy, OCR entry points and itemization, Android home-screen widget, lock-screen approve opt-in. | DEC-21–DEC-25; FIN-024, FIN-025, CAT-005, HOM-007, OCR-009–013, SMS-010–014, SEC-005; new §8.16 CAP, §8.17 LRN; SCR-27–29; WMB-16 |
| 1.3.0 | 1 Nov 2026 | Product session plus review fixes (FIN-026 auto-approve materialization; Savings via transfers, ACC-009; epic→milestone map; currency list; TXN-012/013; SMS-017; §6.7 voice and copy; Given/When/Then acceptance for every §8 module; concrete NFR-07/11 and caps; named protagonists per flow). Party-mode product session: Android-only Phase 1 (solo developer); international launch in four market groups with one currency per user and ISO 4217 exponents; English-only UI; navigation with centre ＋ and no drawer; onboarding rewrite; "Am I okay?" Home hero; Plan "Before payday" timeline; payday-cycle default period; shared capture pipeline; auto-approve fixed (read-time, 21:00, never duplicates); UPI screenshot share; itemized OCR non-deferrable with quality floor; OCR-011 learned account; account discovery and transfer linking; Delete vs Reject wording; 50/30/20 in Phase 1; brand and glass visual system. Also fixes v1.2 validation findings: scope list, data model, parity and market matrices, no-SMS variant, success metrics and counter-metrics, verified-sender definition, SMS-011/012 rules, LRN-003 window, SEC-005 vs CAP-001, glossary collisions, "MVP" label retired. | DEC-01, DEC-05, DEC-16, DEC-22, DEC-25–DEC-33; §1, §3.3, §4, §5, §6 (new §6.6), FIN-001, FIN-010, FIN-016, FIN-024, §7.4, ONB, ACC-006–008, TXN-002/005/006, CAT-006, BDG-008/009, REC-009/010, GOAL-002, HOM, INS-004/007/016/020, OCR-002/005/009/011/014, SMS-010–016, SEC-005, CAP-001/007/009–011, LRN-003/007, new §8.18 UPI, FLOW-01/02/08/09/13/14, §10, §11, NFR-13/16–20, §13 (13.0, 13.0a, 13.2), §16, §20, §21 (WMB-17, WMB-18), §24 (GATE-08, 12, 13) |
| 1.3.1 | 1 Nov 2026 | Validation fixes (v1.3.0 graded Poor: 5 critical, 20 high). Savings = net transfers into savings accounts, counted once; manual duplicates held, not counted; Home hero counts unclassified spending; auto-approve is always a write (job or next open), never derived on read, settings versioned; transfer-like captures never auto-approved as spending (CAP-012); timezone rule; duplicate-match windows, CSV occurrence index and Merge (FIN-027); refunds and reversals (FIN-028); learning only from user actions (LRN-008), merchant normalization (LRN-009); SMS header normalization and per-account balance chain; account identifiers keyed by sender; capture inbox before first unlock; release build without INTERNET permission; OCR total user-confirmed, tax pro-rata, tip tolerance, no negative rows; OCR-010 Attach / Keep separate / Discard; UPI failed screens rejected, reversals linked; one overall budget on the default period; currency list extended and region-based pre-select; feature gating rule; GATE-02 at M1 with two-package fallback; §16.3 reference-set protocol; acceptance for ONB, ACC, TXN, BDG. | DEC-22; FIN-002, FIN-021, FIN-024, FIN-026, new FIN-027, FIN-028; TXN-012; BDG-002, BDG-009; GOAL acceptance; §6.3; CAP-007, new CAP-012; LRN-008/009; SMS-010, SMS-012; CAP-009; SEC-001, SEC-002; OCR-005, OCR-010; UPI-001, UPI-005; IMP-004; INS-001, INS-020; ONB-002; SET-002; §11; §13.0a; §16.1, new §16.3; §20 M1/M3; GATE-02, GATE-05, GATE-08 |
| 1.3.2 | 1 Nov 2026 | Medium and low validation fixes: resumable atomic-batch import, CSV encodings, sign flip and transfer pairs; pay-cycle definition, last working day, early salary rule, user-entered 50/30/20 income base; raw SMS bodies never stored; retention (soft deletes purged after 30 days, rejected captures after 90, Delete permanently); outside-India capture scope and dismissed UPI dialogs; app lock and hide-amounts across notifications and widget; widget shows "N to check" text, never a numeric badge; highest-threshold-only budget alerts and notification overflow; recurrence anchor day; clock guard for auto-approve; scam rule limited to non-verified senders; card outstanding vs statement due; opening balance applies at an instant; unallocated vs Not itemised; measurable success metrics, NFR-10/16; Android glass fallback signals; seven Activity row states; Play closed track for betas; provisional privacy policy at M1; RB0/RB1 release priorities; data-model provenance and fields; status line and source legend. | DEC-16, DEC-23, DEC-33; FIN-014, FIN-016, FIN-026; TXN-006, TXN-009; ACC-003, ACC-007; BDG-004, BDG-009; GOAL-004; REC-006; HOM-004, HOM-007; IMP-001, IMP-002, IMP-005; INS-004; SMS-004, SMS-011; SET-003, SET-005; §3.3; §6.6; §11; §12; §13.2; §16; §20 |
| 1.3.3 | 7 Nov 2026 | Gap-by-gap resolution of the v1.3.2 validation (2 critical, 12 high), decided with the product owner: same-reference pairs classified by account (reversal vs own-account transfer); unknown credits wait until their type is learned (LRN-010), Uncategorised is expense-only; auto-approve wording aligned with FIN-026; savings pots replace the savings-account flag, SIP/RD via "Saved / invested"; discovered accounts open just before the discovering transaction; auto-approve requires a resolved account; card-bill legs pair into one transfer (auto_linked); different references are never duplicates; Merge by source authority with tip split; tombstones keep purged rejections from returning; UPI screenshots never auto-approved (UPI-008); receipts reconcile with discounts; GATE-02 decided at M3 with a build that supports both package outcomes. | DEC-24, DEC-30; FIN-010, FIN-016, FIN-014, FIN-024, FIN-027; ACC-009; BDG-009; CAP-007, CAP-009, CAP-012; LRN-010; OCR-005; UPI-005, UPI-008; INS-020; SCR-18; FLOW-09, FLOW-14; SMS-016; §10; §11; §13.2; §20 M1; GATE-02 |
| 1.3.4 | 7 Nov 2026 | Medium and low findings from the v1.3.2 validation, decided one by one with the product owner: Free to use uses Home's Left in budget (incl. 50/30/20-only) and can go negative ("Short by"); hidden notifications show only Review (SEC-005 single source); loosening auto-approve changes apply now, tightening tomorrow; evening summary sent only after the write; bounded clock guard; timezone prompt at 2 h+ and period membership by local date; payday change ends the cycle early with pro-rated targets; refunds floored at zero with surplus shown; unlisted bank senders prompt instead of scam-flagging; Cash account created on first Cash withdrawal; IDR/HUF as whole units; region = ISO country code; INTERNET permission stripped and checked, airplane suite on release; post-unlock SMS catch-up replaces the pre-unlock inbox; reference-set accuracy measured on testers' phones; same-file CSV rows never matched; tolerant balance chain; Recently deleted list and pair deletion; data-model cleanup; added acceptance checks; REC-007 to P2 and subscriptions inside SCR-16; concrete NFR-06/19, OCR-001/007 and fallback values; full wording sweep of PRD and addendum. | BDG-002, BDG-006, BDG-008, GOAL-004, SEC-001, SEC-002, SEC-005, CAP-001, CAP-008, CAP-012, FIN-002, FIN-010, FIN-014, FIN-022, FIN-025, FIN-026, FIN-027, FIN-028, SET-003, SET-005, SMS-011, SMS-012, SMS-017, OCR-001, OCR-005, OCR-007, REC-007, REC-008, INS-001, TXN-006, DEC-21, NFR-01, NFR-06, NFR-19; §6.6; §10; §11; §13.0a; §13.2; §16.3; FLOW-15, FLOW-17, FLOW-18; GATE-05 |
| 1.3.5 | 7 Nov 2026 | Fixes from the v1.3.4 rubric check (graded Fair: 1 high, 9 medium, 6 low), decided with the product owner: NFR-10 protection = powered off or not unlocked since boot, database available after first unlock so capture works while the screen is locked; auto-linked transfers follow auto-approve, labelled "Recorded · linked as transfer" with "Not a transfer" undo, only when the other account is certain; CAP-004 credit-type mapping with new "From people" category and "Paid me back"; SMS catch-up starts at consent with optional 30-day backfill to review; overall budget floors each category first; separate "wmbugo Lab" measurement app, Play closed track runs the real build; DEDUP suite row, goal acceptance inputs, learned_mapping for credit types and transfer choices, budget cases moved to §8.5, M2 start without schema, "Import anyway" and excluded-row retention, OCR-005 mismatch direction, transfer pairing vs duplicates, six more acceptance checks, addendum aligned. | NFR-10; SEC-001; CAP-004, CAP-007, CAP-012; FIN-014, FIN-026, FIN-027; BDG-006; CAT-001; OCR-005; §10; §11; §16.1; §16.3; §20 M2; acceptance in §8.5, §8.8, §8.10, §8.12, §8.15, §8.17 |
| 1.3.6 | 7 Nov 2026 | Alignment with the UX spines (`ux-wmbugo-app-2026-11-07` DESIGN.md / EXPERIENCE.md, "Deviations from PRD", 16 rows): overspent hero reads "Over budget ₹X" unsigned with a warning icon, days-only time line, no minus signs in the UI; glass is deep-teal tinted in light mode too, gradient capped behind dark glass; primary buttons use the deep gradient segment, ＋ keeps the full gradient; teal only in Phase 1 (no accent themes); category colours only from a 12-hue palette; N/W/S dark variants (addendum); one icon library, no emoji; Free to use gate-fail shows one next step "Not enough information yet · Set a limit →"; evening summary "Today: N recorded · Tap to review" with expandable list; restore copy no longer promises a lasting safety copy, checkbox confirmation instead of typed word; hidden notification reads "New payment to check"; tablet two-pane moved to Phase 2; capture dialog is a bottom sheet in the dialog-styled activity; Learned merchants & blocked senders under Settings › Capture; Activity day-header Spent is refund-net, floored at ₹0. Follow-up decisions: a net refund surplus shows unsigned as "₹X back" with the refund icon (bar at zero in charts), never with a minus sign; the Free to use gate-fail step names the missing required input ("Set a limit →" or "Add an account →"), bills and goals never gate. Visual values are pointers to UX DESIGN.md. §24 open UX items replaced by a pointer to the spines (GATE-06 evidence); §25 states item ticked. Account (FIN-010) and goal (GOAL-001) colours also come from the 12-hue palette. | None (non-material per change control). Rows: §4.1, §4.2, §5.1, §5.2 SCR-04/07/18/27, §5.3, §6.2, §6.3, §6.6, §6.7, TXN-006, CAT-002, BDG-008, SET-001, BKP-002, SEC-005, CAP-002, CAP-007, FLOW-09, FLOW-10, §10, §13.0, §21 WMB-16, §24, §25, Appendix B; acceptance in §8.3, §8.4, §8.5, §8.8, §8.9, §8.14, §8.15, §8.16; addendum §3, §4 |

Version numbering: the document was originally labelled 2.0.0-draft; it is the first PRD for wmbugo and is renumbered as v1 (1.0.0 baseline, 1.1.0, 1.2.0, 1.3.0).

**Impact notes for v1.3.6:** UX: the PRD now matches the UX spines; no UX rework. Architecture: AD-10 (pre-restore copy kept only until the next successful start) is unaffected; the restore copy was changed to match it. Epics: not yet created, so nothing to re-plan.

**Impact notes for v1.3:** (1) International scope multiplies receipt layouts, privacy jurisdictions and store listings; GATE-08 is now on the critical path. (2) With no cut list, schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope. (3) The logo promises 50/30/20, so CAT-006 types must exist in the first schema version. (4) Glass must never cost legibility or frame rate; the fallback is a first-class design, not an afterthought.

**Impact notes for v1.2:** (1) Auto-approve and learning change the trust model — usability study must confirm users understand auto-approved entries. (2) Itemized OCR is the top Phase 1 delivery risk (see §8.11 note; no longer deferrable as of v1.3). (3) Later, not Phase 1: stop notifying a merchant after repeated consistent confirmations; weekly privacy log. Dropped: amount-band category guessing.

**Impact notes for v1.1:** (1) GATE-02 (SMS Play approval) and GATE-05 (offline OCR model) now sit on the Phase 1 critical path. (2) The Phase 1 launch is no longer Android/iOS simultaneous; the parity matrix (§13) records iOS as Phase 2. (3) GATE-11 (commerce) is not required for Phase 1.

## 25. PRD acceptance checklist (status at v1.3 freeze)

- [x] All core user roles/jobs and success metrics defined (§3, with counter-metrics and per-market segmentation).
- [x] Feature scope divided into P1, P1-IN, Phase 2, future and out-of-scope (§4, §13.0a).
- [x] Every screen has its design interaction states — designed by `bmad-ux` in [EXPERIENCE.md › State Patterns](../../ux-designs/ux-wmbugo-app-2026-11-07/EXPERIENCE.md) and [DESIGN.md › Components](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md) (§6.4, §24) [v1.3.6].
- [x] Every financial operation has exact integer monetary semantics and negative cases (§7, currency exponents in §13.0a).
- [x] Transfers, splits, refunds, imports, opening balances and liabilities reconcile (§7.4).
- [x] Every chart/metric defines eligible transactions, formula, period and drill-down (§8.9).
- [x] Global navigation, settings, filters, Home cards, theme and accessibility documented (§5, §6).
- [x] Offline-first works without credentials, network, permissions or SMS approval (NFR-01, §13.2).
- [x] Android SMS gated correctly; iOS fallback behavior defined (§8.12, §13.0); one Play assumption open under GATE-02.
- [x] Local OCR, CSV imports, backups and restore include review/error paths (§8.10, §8.11, §8.14, §15).
- [ ] Security threat model documented — **owned by `bmad-architecture`** (§17, GATE-04).
- [x] No destructive midnight reset or mandatory always-running background services (§10, FIN-026).
- [x] QA suites cover accounting correctness, data protection, failure recovery, UX, platform and market parity (§16).
- [x] Product owner accepts the explicit decision defaults and release gates (v1.3 session, 2026-11-01).
- [ ] Architecture ADRs resolve library/encryption/database specifics prior to code generation — **owned by `bmad-architecture`**.

Every FR module in §8 carries Given/When/Then acceptance criteria; stories inherit and extend them (§16.4, §22.1).

---

## Appendix A — Sample story acceptance contract

**Story WMB-04-03: Duplicate source reconciliation**  
**Requirement trace:** `TXN-008`, `IMP-004`, `FIN-024`, `SMS-005`, `OCR-006`  
**Screens:** `SCR-10`, `SCR-19`, `SCR-23`, `SCR-24`  
**Value:** Avoid counted-twice expenditure.

1. **Given** a confirmed ₹450 restaurant purchase exists, **when** a CSV row with matching reference is imported, **then** the row is associated with the existing event and no second confirmed expense is created.
2. **Given** a receipt and an existing expense share amount, merchant and date but have no unique reference, **when** reviewed, **then** candidate match rationale is shown and user chooses Attach to it / Keep separate / Discard (OCR-010).
3. **Given** a previous import was committed, **when** identical batch is re-imported, **then** recognized rows remain idempotent and a review summary reports skipped matches.
4. **Given** conflicting evidence, **when** system cannot decide confidently, **then** no silent merge and candidate remains outside confirmed totals until reviewed.
5. **Given** import is interrupted, **when** app resumes, **then** no partial inconsistent ledger postings exist.

## Appendix B — Sample UX state contract

**Screen:** Home (`SCR-04`)

| State | Expected behavior |
|---|---|
| Fresh install | Privacy-friendly welcome and Set up account / Add expense CTA |
| No account | Balances labeled “not configured”; no misleading zero |
| Zero real activity | Budget setup suggestions and chart empty states |
| Loaded, budget set | Hero: Left in budget + spent bar; In accounts / Card dues line; Home cards |
| Loaded, no budget | Hero: Spent this period + "Set a limit →" |
| Needs review | "N to check" card and a dot on Activity (no count badge); pending amounts excluded from totals |
| Overspent [v1.3.6] | Warning icon + label "Over budget" + unsigned amount ("Over budget ₹2,340", no minus sign); bar to the limit tick, then a capped overflow; time line in days only ("5 days to payday"); neutral wording, no guilt copy |
| Amounts hidden | All amounts masked after the eye toggle, state remembered |
| Corrupt datastore | Safe-mode recovery guidance; do not overwrite data |
| App background/resume | Obscure sensitive snapshot if lock enabled, recompute period |

## Appendix C — Where this PRD lives

- Current PRD: `_bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/prd.md` (this file) with `addendum.md`, `.memlog.md` and review files alongside.
- Previous version (v1.2, raw input): `input/docs/Idea_prd.md`. Superseded wherever the two disagree.
- The original BRD/FRD/TSD/QA source PDFs referenced in §23 are not in the repository.
