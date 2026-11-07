# Source extract for UX: wmbugo

Sources: PRD v1.3.5 (frozen), PRD addendum, ARCHITECTURE-SPINE (2026-11-07). [?] marks something ambiguous.

## 1. Product
wmbugo ("where my budget goes"; store line "Private Money, Made Clear") is a private, offline-first personal finance app for one person. There is no account, no backend and no `INTERNET` permission in release builds. It answers "Am I okay?" in seconds: Left in budget, In accounts, Card dues. It has a multi-account ledger and effortless capture: manual entry, on-device itemized receipt OCR and CSV import everywhere, plus UPI screenshot share and opt-in SMS capture in India. One-tap Approve/Reject confirms captures, which auto-approve after 21:00, and the app learns from corrections. It includes 50/30/20 budgeting, payday-cycle planning and explainable insights (PRD §1, §1.1, §1.3).

## 2. Personas (PRD §3.1)
- Busy digital spender = **Priya** (Bengaluru, UPI, SMS). Primary for capture.
- Privacy-focused professional = **Sara** (London, receipt-first, backups).
- Budget-conscious salaried user = **Arjun** (Pune, payday, 50/30/20). Primary for Home, Plan and 50/30/20.
- Cash/mixed-mode user = **Ravi** (Chennai, cash, 2 banks, card).
- First-time finance tracker = **Mei** (Singapore, receipt-first).

## 3. Form factor and platform
- **Android only in Phase 1.** iOS is Phase 2 (DEC-01). minSdk 26, targetSdk 36 (AD-17).
- Mobile portrait 320–430 px is the baseline. Tablet gets a nav rail and an optional two-pane Activity/Detail. Landscape must stay usable (§5.3).
- Fully offline (DEC-02, NFR-01). No sign-in (DEC-03).
- Permissions are just-in-time, never at onboarding (ONB-004): camera for OCR, notifications, and SMS (India, `sms` flavor only, with an explainer first; SMS-014). No draw-over-apps permission (CAP-002).
- Surfaces outside the app: capture notifications with Approve/Reject (full or hidden form, SEC-005), a floating capture dialog activity (SCR-27), a 4×1 home-screen widget (SCR-29), the share-sheet target (UPI-001), the evening summary notification, the splash and biometric app lock.

## 4. Stack constraints affecting UI
- React Native CLI (New Architecture, Hermes, TS strict). This is **not Expo or Flutter** (addendum §1, Stack).
- React Navigation: root stack (LockGate, onboarding, modals), then bottom tabs, then per-tab stacks. ＋ is a tab-bar button that opens the AddSheet modal.
- Charts: Victory Native XL (Skia) + Reanimated. Glass: Skia backdrop blur or a blur view, with `glass.fallback`. Motion: Lottie coin flip; react-native-bootsplash.
- Forms: react-hook-form + zod. Formatting goes through one shared `Intl` formatter, and screens never format numbers (AD-15, Conventions).
- TanStack Query for reads; Zustand for transient UI state only.
- No UI kit is named (no Material, shadcn or Tailwind). The design system is "owned by the UX specification" (Spine, Deferred).
- Errors come as typed `Result` codes, and the UI maps them to copy.

## 5. FR → surfaces
- ONB-001–008: onboarding (Welcome/privacy, region+currency, one account, payday chip, 50/30/20 offer), one-time tips, app-lock offer after the first entry. Screens SCR-01–03.
- ACC-001–009: Accounts list/detail grouped "Money you have" / "Money you owe", Adjust balance, Pay card bill, savings pots, archive. SCR-06.
- TXN-001/002/003/004: Add sheet with amount-first keypad, quick-category chips, Expense/Income/Transfer, Snap/UPI chips, "Save & add another", Undo toast. SCR-09.
- TXN-005/009/011: Transaction detail with edit, split editor, Delete vs "Reject · Not mine", attachments. SCR-08.
- TXN-006/007: Activity with day groups, 11 row states, search, filter sheet, sort, "Show rejected". SCR-07.
- TXN-008/012/013: Review queue with side-by-side duplicate evidence, Merge/Keep both, foreign-amount entry, an "Add a category" list. SCR-10.
- TXN-010: Bulk recategorize with preview and undo.
- CAT-001–006: Categories with icon, colour, need/want type, archive/merge remap preview. SCR-18.
- BDG-001–009: Budget list/editor/detail, threshold alerts, 50/30/20 template, income-change offer, Free to use on Plan. SCR-13–15, SCR-30.
- REC-001–010: Bills & Recurring with a Subscriptions filter, "Rent paid? Yes, link it", Plan timeline copy. SCR-16.
- GOAL-001–004: Savings goals with Set aside vs Moved to savings, and a "short by" warning. SCR-17.
- HOM-001–008: Home hero, Home cards, card editor, hide-amounts eye, widget. SCR-04, SCR-05, SCR-29.
- INS-001–025 (P1 subset): one scrolling Insights view with a period picker, KPI tiles, charts with "View as table", and drill-down to filtered Activity. SCR-11, SCR-12.
- IMP-001–007: CSV import wizard (file, mapping, preview, duplicates, summary) and exports. SCR-19, SCR-20.
- OCR-001–014: camera/picker, "Reading receipt…" with scan line, "3 of 14 items" and Cancel, receipt review (category totals, collapsed items, Not itemised, Paid-with chip, ⚠ date?), and a match prompt (Attach to it / Keep separate / Discard). SCR-23, SCR-31.
- SMS-002/011/013/014/017 (P1-IN): SMS explainer, scam notice, Block sender, re-ask Home card, "New sender X? It's my bank / Ignore". SCR-24.
- SET-001–007: Settings hub (You · Money · Capture · Privacy · Data · Help), notifications config, Recently deleted, Diagnostics, Help/glossary. SCR-21, SCR-22.
- BKP-001–007: backup passphrase, restore preview and confirmation, error states. SCR-20.
- SEC-004/005: app lock, app-switcher blur, hidden vs full notification.
- CAP-001–012: notifications, the floating capture dialog (category grid, long-press subcategories, swipeable batch cards, "Apply to all similar", credit types, transfer choices, account-discovery prompt, "Not a transfer"), lock-screen approve, evening summary. SCR-27.
- LRN-001–010: Learned merchants & blocked senders (edit, forget, clear mixed), "Remember for this merchant" toggle. SCR-28.
- UPI-001–008 (P1-IN): share target, failed-payment notice, prefilled capture dialog, "Paid from" chip, lock queue.

## 6. Named flows (PRD §9)
- FLOW-01 Fresh installation (Mei)
- FLOW-02 Manual expense (Mei), about 6 s
- FLOW-03 Income (Ravi)
- FLOW-04 Transfer and credit-card payment (Ravi)
- FLOW-05 Search/edit/split (Ravi)
- FLOW-06 Budget (Arjun)
- FLOW-07 CSV import/reconciliation (Sara)
- FLOW-08 Receipt OCR (Mei)
- FLOW-09 Android SMS (Priya)
- FLOW-10 Backup & restore (Sara)
- FLOW-11 Insight to source (Arjun)
- FLOW-12 Privacy lock (Sara)
- FLOW-13 UPI screenshot share (Priya)
- FLOW-14 50/30/20 budget (Arjun)
- FLOW-15 Account discovered from a capture (Priya)
- FLOW-16 Own-account transfer from two captures (Priya)
- FLOW-17 Pay card bill (Arjun)
- FLOW-18 Re-approve a rejected capture (Priya)

## 7. NFRs relevant to UX
- **Performance:**
  - Navigation median under 300 ms (NFR-03).
  - Save p95 under 500 ms (NFR-04).
  - Home p95 within 2 s warm start (NFR-05).
  - 60 fps on 95% of frames, including lists of 10k rows and glass (NFR-06, NFR-07, NFR-19).
  - OCR p95 at most 5 s (NFR-08).
  - Splash at most 1 s and ends when the DB is ready (NFR-20).
  - Capture dialog open time threshold about 400 ms.
- **Accessibility:**
  - TalkBack labels on every control, 200% font scale, WCAG AA, reduced motion, 48 dp targets (NFR-11).
  - Never colour alone. Every chart has "View as table".
- **i18n:**
  - English-only UI with strings externalized (DEC-28).
  - Region-based number/date/currency formats such as en-IN lakh grouping and de-DE decimal comma.
  - 25+ currencies with exponents 0/2/3. IDR/HUF are whole units (§13.0a).
  - Unavailable market features are hidden, never "coming soon".
- **Privacy UX:** hide-amounts eye (global and remembered), app lock, app-switcher blur, hidden notification form, widget with no amounts by default, diagnostics export with preview and consent.
- **Theme:** System/Light/Dark, with tokens in §6.2. Accent themes come "after core QA" [?].
- **Motion:** 150–250 ms, no count-up animations, skeletons instead of spinners (§6.1 #4).
- **Density:** visual before verbose, with progressive disclosure.
- **States:** every screen needs initial, loading, empty, populated, error, partial/import-review, permission-denied, read-only, confirmation, success and offline (§6.4).

## 8. Brand, visual and tone
- **Palette:** teal palette (`accent.primary` #0F766E / #5EEAD4) plus semantic income, expense, transfer, warning and info colours (§6.2).
- **Gradient:** `gradient.brand` #2DD4BF → #0F766E → #164E63.
- **Glass:** only on floating surfaces (hero, tab bar, Add sheet, capture dialog, pills), with a solid fallback (§6.6).
- **Mark:** a coin with "w↗" on the front and a 50/30/20 pie on the back (needs #0F766E, wants #14B8A6, savings #5EEAD4). It flips on the splash and in loaders.
- **Illustration:** a paper boat for empty and calm states.
- **Scale:** 4-pt grid, radii 8–16 dp.
- **Voice (§6.7):**
  - Calm, not guilty.
  - Reassure on reversible actions.
  - "Rough is fine."
  - Say what we don't know.
  - Never "Inbox" or numeric badges; use "N to check".
  - Plain money words.
  - Celebrate lightly ("Smooth sailing").

## 9. Stakes and domain
Consumer personal finance. The data is highly sensitive, but no money moves and nothing connects to a bank. Correctness is RB0, meaning a wrong balance or a double count blocks release. Privacy law applies: DPDP, GDPR and others (GATE-08). SMS use is gated by Play policy. There is no monetization in Phase 1.

## 10. Out of scope and open UX items
- **Out of scope:** cloud/sync, bank APIs, payments, investment advice, multi-user, iOS (Phase 2), other languages (Phase 2), mixing currencies (Phase 3), rule editor SCR-25 and advanced reports SCR-26 (Phase 2), saved filter presets (Phase 2), rollover (future) (§4).
- **Open UX items named in §24:** CSV wizard detail, backup/restore screens, SMS explainer copy and layout, all empty/error/permission states, widget layouts, evening summary layout. §6.3 also defers the "four hero states" to UX.
- **Architecture spikes that affect UX:** native vs React Native capture dialog, widget library.

## 11. Gaps (questions for UX)
1. What is the exact layout and copy for each of the four hero states, and for the overspent state? The PRD shows a negative value in Appendix B but uses "₹X over budget" wording in §6.7.
2. CAT/§4 asks for an "emoji-free" icon library, yet the PRD uses 👁 and ⚠ glyphs. Should icons replace them?
3. How does glass behave in dark mode? Glass is defined as "translucent white".
4. Are accent themes in Phase 1? SET-001 lists them, but §6.2 says "after core QA".
5. Is the tablet two-pane layout committed or optional? At what breakpoints?
6. What is the structure of the Add sheet for Income/Transfer and for the split editor?
7. What does a filter sheet look like when filters stack many dimensions (§6.5)?
8. How do we visualise the Free to use gate ("missing inputs listed")?
9. What are the visual specs for the 11 Activity row states, and how are they distinguished without colour?
10. What does the floating capture dialog look like for batches, credits and transfers, plus the account-discovery prompt and dialog sizing?
11. What does onboarding look like with 25+ currencies (pickers, search)?
12. Settings hub depth: grouped list vs sub-screens?
13. What is the widget design when amounts are enabled?
14. How should one-time tips be presented (tooltip, card or toast)?
15. Lottie asset specs and the reduced-motion still frames are pending GATE-12.
