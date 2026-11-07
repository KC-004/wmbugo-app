---
title: wmbugo PRD v1.3 — addendum
updated: 2026-11-07
---

# wmbugo PRD v1.3 — addendum

Depth from the 2026-11-01 product session that belongs downstream (architecture, UX spec) rather than in the PRD. Nothing here is a requirement; the PRD wins on any conflict.

## 1. Technology candidates (for `bmad-architecture`)

Fixed by the product owner: **React Native CLI**, Android-first, **pnpm**.

| Layer | Candidate | Why |
|---|---|---|
| App | React Native CLI, New Architecture, Hermes, TypeScript `strict` | Decided |
| Domain/ledger | Plain TypeScript package with no `react-native` imports | Testable in isolation; carries to iOS |
| Database | `op-sqlite` built with SQLCipher | JSI speed, encryption at rest (SEC-001), reactive queries |
| DB key | `react-native-keychain` → Android Keystore | No hardcoded keys |
| Navigation | React Navigation: root stack (LockGate, onboarding, modals) → bottom tabs → per-tab stacks | ＋ is a tab-bar button opening the AddSheet modal, not a route |
| UI state | Zustand for UI-only state | Balances always come from the database read model |
| Forms | react-hook-form + zod | Amount and date rules in one place |
| Dates | date-fns + date-fns-tz | FIN-002 timezone grouping |
| Formatting | `Intl.NumberFormat` with the profile locale, in one shared formatter module | DEC-05, FIN-001 |
| Charts | Victory Native XL (Skia) + Reanimated | Performance, reduced-motion support |
| Glass | Skia backdrop blur or a maintained blur view, capped to a few surfaces per screen; `glass.fallback` below a device capability threshold | NFR-19 |
| Camera / OCR | VisionCamera + ML Kit Text Recognition v2, **bundled** model | Offline from install (GATE-05) |
| Notifications | react-native-notify-kit (Notifee was archived in April 2026; this is its maintained, API-compatible fork) | Action buttons, grouping, public versions, headless handlers |
| Backup crypto | libsodium (Argon2id + XChaCha20-Poly1305) | BKP-001 |
| CSV | Papa Parse + document picker | Quoted fields, encodings |
| SMS | Kotlin TurboModule in the `sms` Gradle product flavor only | `nosms` manifest declares nothing (SMS-001) |
| Share intent, capture dialog, widget | Kotlin native modules | See open questions |
| Splash | react-native-bootsplash (Android 12+ SplashScreen API) | Splash ends when DB key and first Home query are ready |
| Motion asset | Lottie (preferred) for the coin flip; AVD half-flip for the system splash | One asset across splash and loaders |
| Tests | Jest + fast-check (property tests), RN Testing Library, Maestro (airplane-mode E2E) | Invariant suite written first |
| Never install | Firebase, Crashlytics, Sentry, any analytics/ads SDK | DEC-15 |

Day-one platform settings: `android:allowBackup="false"` plus data-extraction rules (BKP-006).

**Open questions for architecture**
1. Drizzle ORM (typed schema, generated migrations) vs a thin repository layer with handwritten SQL and numbered migrations. The PRD only requires that ledger writes go through repositories in one transaction.
2. ~~Floating capture dialog in React Native (shared component, warm host) vs a native Kotlin activity (faster cold open).~~ **Resolved [v1.3.6]:** the capture sheet is a bottom sheet inside the dialog-styled activity; see UX `ux-wmbugo-app-2026-11-07/EXPERIENCE.md` (SCR-27, capture sheet). Open time still targets ~400 ms on the reference device.
3. Home-screen widget via `react-native-android-widget` (JSX) vs Kotlin Glance. Spike both.
4. Share received while locked: a pending-intent queue that survives unlock (UPI-006).
5. Whether pnpm needs `node-linker=hoisted` for Metro.

## 2. Ledger notes

- Shared pipeline (DEC-29): `source_record` → match per FIN-027 (reference + direction + event type exact; items with different references are never duplicates; otherwise amount, ±1 day, normalized merchant) → `review_candidate` → posting. Auto-approve eligibility (CAP-007) depends on: source kind (UPI screenshots never auto-approve, UPI-008), sender status, a resolved account (CAP-009), a learned credit type for credits (LRN-010), profile currency (TXN-013), transfer-likeness (CAP-012), open review candidates, SMS-011/012 flags and the versioned cutoff; the write happens in a background job (e.g. WorkManager) or on next open, whichever is first (FIN-026). SMS received before first unlock are picked up after unlock by the SMS catch-up (SEC-001); nothing is stored pre-unlock.
- Own-account transfer pairing: opposite direction, same amount, within ±3 days, two owned accounts (CAP-012); same-reference pairs are classified by account (FIN-027).
- Discovered-account opening balance from SMS: balance before = available balance + debit (or − credit).
- Category `budget_type` must exist in the first migration.

## 3. UX detail from the session (for `bmad-ux`)

- **Capture status vocabulary** (shared contract between UX and architecture): Waiting for you · Possible duplicate — check it · Looks like a scam — not added · Recorded · category guessed · Recorded · needs a category · Recorded · Rejected.
- **Add sheet:** keypad bottom-right Save; chips row above amount; "Save & add another" secondary.
- **Capture dialog:** category grid ordered by merchant history then overall frequency; long-press for subcategories; "Remember for this merchant" (default on); "Not a transaction · Block sender".
- **Receipt review:** Paid-with chip; "date?" with a warning icon when unsure (library icon, no emoji; v1.3.6); matches shown as "Matches ₹2,340 HDFC debit 6:12 pm — Attach to it / Keep separate / Discard".
- **Plan empty state:** three setup cards — Add your rent · Set one budget · Name a goal.
- **Insights:** comparison wording "↑ 12% vs Oct 1–8"; "No baseline yet".
- **Widget:** 4×1 — Snap · Add · "N to check" text (never a numeric badge; HOM-007).
- **Evening summary (v1.3.6):** collapsed "Today: N recorded · Tap to review"; expanded, up to 5 lines merchant first ("Swiggy ₹420 · Food & Drinks") plus "+N more"; hidden form shows the count only. Detail: UX [EXPERIENCE.md › Notifications](../../ux-designs/ux-wmbugo-app-2026-11-07/EXPERIENCE.md).
- **Copy rules:** never "Inbox"; never red for a not-itemised amount; "Off by a bit? Adjust balance".

## 4. Brand exploration record

Design canvas: https://claude.ai/artifact/HRsBiV9MERuf35jBkwnHjv (private; boards for rounds 1–4).

- Directions explored: rising-bars w, split stream, going w, rupee on the move, clear pocket, paper boat, question-mark coin, tracer, coin flip, budget ring, drop & split.
- Rejected and why: padlock/keyhole and pocket (privacy cliché, reads as a shield); question mark (signals confusion); map pin (reads as a delivery app); ₹ coin face (ties an international brand to one currency); boat as app icon (needs explaining at icon size; kept as illustration).
- Final mark: coin flip — front w with up-right arrow, back 50/30/20 pie (needs dark teal `#0F766E`, wants `#14B8A6`, savings `#5EEAD4`; in dark mode the app uses the dark variants `needs-dark` / `wants-dark` / `savings-dark` (v1.3.6), values in UX [DESIGN.md › Colors › Needs / Wants / Savings](../../ux-designs/ux-wmbugo-app-2026-11-07/DESIGN.md)); tile gradient `#2DD4BF → #0F766E → #164E63`; 3D edge with reeding during the flip; flip-then-pause rhythm (~3.6 s loop).
- Noted risk: an up-right arrow can read as "investing"; mitigated by the pie on the reverse.

## 5. Market notes

- Indian bank SMS use TRAI DLT headers (e.g. `AD-HDFCBK`, `VM-ICICIB`); most banks elsewhere send app notifications, not SMS, so SMS capture is India-only.
- UPI success screens (GPay, PhonePe, Paytm) have stable layouts and a UPI reference — the strongest dedup key in Phase 1.
- Play: a personal developer account created after Nov 2023 needs a 14-day closed test with at least 12 testers before production access.
