# Pass 1 coverage — wmbugo spines (draft, revised 2026-11-07)

Mechanical checks per `references/validate.md` Pass 1, re-run after the revision that applied memlog entries 40–61 (9 J-* journeys, accessibility C1/C2/H1–H9 + mechanical medium/low, restore copy, category palette, accepted assumptions). Contrast verified by script (WCAG 2.x, alpha-composited; CIEDE2000 for palette distinctness).

## Shape
- DESIGN.md sections in canonical order: Brand & Style · Colors · Typography · Layout & Spacing · Elevation & Depth · Shapes · Components · Do's and Don'ts. **Pass.**
- EXPERIENCE.md required defaults all present; Responsive & Platform present (triggered). Invented sections (Capture Surfaces outside the App, Notifications, Privacy & Hidden Amounts, Deviations from PRD, Open Questions) each carry decisions. Inspiration omitted (no reference products in sources). **Pass.**
- Spines-win-on-conflict stated once in each doc. Frontmatter `status: draft`, `updated: 2026-11-07` in both. **Pass.**

## 1. Flow coverage — strong
- PRD §9 FLOW-01..18: all present, verbatim names, PRD protagonist, numbered steps, **Climax** beat, failure path.
- Added memlog journeys J-BILLS, J-GOAL, J-FUEL (SCR-18 + TXN-010), J-LEARN, J-HOMEEDIT, J-NOTIF, J-RESTORE-DELETED, J-SMS-REASK, J-EVENING: each has a PRD §3.1 named protagonist, a `Surfaces:` line, numbered steps, Climax, failure path.
- Note: memlog J-LEARN path says Settings › Capture › Learned merchants; spine follows PRD §5.1 (Money group) and says so inline.
- No misses.

## 2. Token completeness — strong
- 77 distinct `{path.to.token}` references across both docs; **all resolve** (checked by script; only non-match is the literal syntax note).
- 78 colour tokens. Every PRD §6.2 colour plus every addition has a light/dark pair, except single-value-by-design tokens: `gradient-brand-*`, `glass-tint`, `on-glass-primary/accent/warning`, `focus-ring-on-glass`, `scrim` (rationale in Colors).
- Added: `bg-muted(-dark)`, `focus-ring(-dark)`, `focus-ring-on-glass`, `border-control(-dark)`, `needs/wants/savings-dark`, 12 × `cat-*` (+ `-dark`), spacing `focus-ring-width/offset`.
- Contrast stated for every load-bearing pair (Colors table, Glass table, N/W/S table, Category table, hero bar, toast, buttons). Light glass 80%, light fallback, gradient button segment, N/W/S dark now decided and verified.
- Zero `[ASSUMPTION]` tags remain.
- Minor: `tnum` and `maxFontSizeMultiplier` carried as typography `note` (spec has no key).

## 3. Component coverage — adequate
Both sides (visual + behavioural): hero card, limit bar, Activity row, selection mode / selection bar, chips + filter chip row, status tags, category icon grid, capture sheet + swipe cards, Add sheet, segmented control, keypad, checkbox row / restore confirmation, setup card, stepper header / stepper, toast, tooltip, empty state, error retry (inline), widget, nav rail (visual + Responsive), buttons incl. disabled, coin loader, charts, Free to use, Home card editor (behaviour; rows reuse `card` + controls), learned-merchants list (behaviour; rows reuse list styles).

Still missing one or both sides:
- Neither: full filter sheet, search field, period / date-range picker, review-queue duplicate evidence card, account tile + Money-you-have / Money-you-owe groups, receipt review layout (SCR-23).
- Visual only: KPI tile, tab bar (behaviour lives in IA).
- Behaviour only: passphrase field, settings group row, Home card editor row, learned-merchant row (visual inferred from list/row tokens).

## 4. State coverage — adequate
- Global patterns cover initial/loading/empty/populated/error/permission-denied/read-only/confirmation/success/disabled/amounts-hidden; offline declared n/a.
- Hero states table complete.
- Per-surface specifics now for SCR-04, 05, 07, 10, 13, 16, 17, 18, 19, 20, 22, 23, 24, 27, 28, 29, 31 and Recently deleted.
- Thin (global patterns only): SCR-06, 08, 09, 11, 12, 14, 15, 21, 30; onboarding SCR-01–03 error states.

## 5. Visual reference coverage — strong (re-run 2026-11-07, after mock extraction)
- `mockups/`: key-home.html, key-activity.html, key-capture-batch.html (approved; corrected to match spines: refund-net day Spent ₹201, band text primary ink, light Reject on-glass outline 7.87:1, % hidden when masked; 200% frame now draws two-row header + capped tab bar).
- Links: DESIGN.md 14 inline mock links, EXPERIENCE.md 18; every link resolves; each names what it illustrates. `.working/dark-glass-options.html` linked from both. `imports/` empty; `wireframes/` absent. No orphans; no links left to `.working/key-*`.
- "Spines win on conflict with any mock" stated once near the top of each doc.
- Token refs: 81, all resolve (only the literal `path.to.token` syntax note).

## Surface closure
- **Every stated need has a surface:** PRD §3.2 jobs → Home, Add / capture / detail, Activity + Insights, Plan + SCR-16/17, SCR-20. **Pass.**
- **Every surface has a journey:** IA tables now carry a Journeys column. SCR-01–24 and SCR-27–31, Recently deleted, TXN-010, SMS re-ask card, evening summary, bill reminder, share target, widget, splash, LockGate all map to ≥1 flow. SCR-22 Diagnostics maps via FLOW-09's failure path (OEM background help, SMS-007). **Pass.**

## Summary of remaining gaps
1. Component coverage: 6 components with no spec on either side; a few one-sided.
2. State coverage: 9 surfaces and onboarding errors rely on global patterns only.
3. Visual reference: closed (3 key mocks linked). Add sheet and other surfaces remain spine-only by decision.
4. Open Questions (6) in EXPERIENCE.md: mask glyph / hero bar under hidden amounts, Add sheet dismissal, large-text widget 4×2, evening-summary line order, GATE-12 Lottie assets, widget library spike.
