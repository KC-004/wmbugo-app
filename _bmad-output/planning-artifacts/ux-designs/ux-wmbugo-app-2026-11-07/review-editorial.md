# Editorial review: DESIGN.md + EXPERIENCE.md

Run: 2026-11-07 · Lenses: structure, then prose (on top of structure) · Style guide: Microsoft Writing Style Guide · Reader: humans + AI implementers · Model: Reference/Database for both.

Facilitator dispositions (bmad-ux Finalize): apply every finding that changes no decision. Spelling: **British throughout** (matches PRD) — overrides the prose lens's US-spelling suggestion; IDs, token names, and code identifiers unchanged. Serial comma: not adopted (dense spec register preserved). PRESERVE rows kept as-is.

## DESIGN.md — structure

1. MOVE Components › Buttons to top of Components; primitives (Chips, Checkbox row, Segmented control) before composites (hero, activity row, capture sheet).
2. MOVE tab-bar clause from "Other library components" into its own subsection "Tab bar (`tab-bar`, `add-button`)" after Home hero card.
3. CONDENSE Colors › Glass Dark bullet: capture-band ink rule → pointer "The capture-sheet header band follows a stricter ink rule; see Capture sheet." Ratio evidence moves to Capture sheet (single source).
4. MOVE Home hero "Bar contrast (verified)" paragraph below the state table.
5. MOVE Home cards / `N to check` card anatomy from Layout & Spacing into Components ("Home cards (`card`)").
6. QUESTION → ACCEPT: Screen header gets its own Components subsection; Typography rule 6 becomes cross-reference.
7. Typography large-text list stays as the index; component subsections cross-reference (Day header duplicate sentence → reference).
8. QUESTION → ACCEPT: Activity day header refund-net definition condensed to a cross-reference to EXPERIENCE.md.
9. Add sheet heading gets token "(`bottom-sheet`)" + one line of shared sheet anatomy (grabber 32×4dp at 60%, scrim, solid sticky footer).
10. QUESTION → ACCEPT: cut preamble "Exploratory mock" line (decision history; stays in `.working/`).
11. Rules only in Do's and Don'ts get a short clause where they belong (no spinners → Skeleton/Other; no boat as app icon → Brand & Style).
12–13. PRESERVE glass-placement repetition; frontmatter/body token repetition.

## DESIGN.md — prose

- One font-scale notation everywhere: "at `fontScale ≥ 1.3`" (replaces "above 1.3×", "at ≥1.3×").
- Activity row large-text anchor: align with Typography rule 2 ("under the title").
- State once in Layout & Spacing: "Paired values are vertical × horizontal."
- "132dp from the sheet top" → "132dp tall from the sheet top".
- Split the `gradient.brand` "Used on" sentence; Home band specifics as their own sentences.
- Glass fallback conditions rewritten as parallel clauses.
- N/W/S series: "so charts use a 2dp gap…".
- Secondary-ink sentence spelled out once ("in light, hierarchy comes from type role, not ink colour").
- Every contrast ratio names its background (e.g. "5.02:1 on white").
- "Long-press a tab shows…" → "Long-pressing a tab shows…".
- "centred at `{spacing.content-max}` (~600dp)" → "centred at a maximum width of `{spacing.content-max}` (600dp)".
- "additions are marked" → "additions are marked "(added)"".
- Stepper: "Used in the CSV wizard."
- Limit bar: "The solid-surface version of the hero bar, used for…"; "Status text sits beside it…".
- Limit bar status text: "(`caption` with a 16dp icon, in `text-secondary`; in `semantic-warning` with the warning icon when over)".
- Day header: "(older days show the date only, with no `Today` / `Yesterday` prefix)".
- Widget: "(when amounts are enabled on the widget: …; by default: no amount)"; "the headline wording ellipsizes, never the amount".
- "in a glance" → "at a glance".
- Spines-win sentence: "This file and EXPERIENCE.md (the spines) win over any mock, wireframe or import when they conflict."
- "colour and styling reinforce it."
- Overflow: "(stripes vs base 6.32:1)".
- Minor: "(any of the above)"; "The calm state"; "Min 40dp visual height"; "quick-category chip row"; "the whole chip is the tap target"; "Worst backdrop → effective colour"; clarify "exponents 0/2/3" (currency minor-unit digits); clarify "50/30/20 only" state name; make the Do column parallel (imperatives).

## EXPERIENCE.md — structure

1. MOVE Capture Surfaces outside the App, Notifications, Privacy & Hidden Amounts to after Accessibility Floor, before Key Flows.
2. Component Patterns: Home hero card, Activity row, Swipe cards become H3 subsections (Use · Behaviour · TalkBack · States); bold **TalkBack:** label everywhere.
3. CONDENSE State Patterns › Amounts hidden row to one line + pointer; full rule only in Privacy & Hidden Amounts.
4. MERGE Capture notification + Lock-screen approve rows into the Notifications table.
5. CONDENSE Component Patterns › Capture sheet row to pointer; drop duplicate "decide later" from Sheets bullet.
6. CONDENSE Foundation form-factor bullet to baseline + pointer to Responsive & Platform.
7. CONDENSE IA large-text header sentence → pointer to Accessibility Floor › Large text.
8. CONDENSE IA outside-surfaces sentence; keep table with lead-in.
9. CUT Interaction Primitives pointer-only bullets (Selection mode, Filter chips).
10. QUESTION → ACCEPT: one-time tip rules move into the Tooltip component row; Interaction Primitives keeps a pointer.
11. CUT Privacy sensitive-actions re-auth sentence (duplicate of State Patterns › Confirmation) → pointer.
12. CONDENSE Accessibility Floor contrast list → "Contrast (all verified ratios): DESIGN.md › Colors."
13. Optional FLOW-10 condense: NOT applied (flow readability kept).
14. J-BILLS steps 5–6 labelled "Later:" so Climax stays the last numbered beat.
15. MOVE Deviations closing "PRD follow-up edits" into Open Questions.
16. Consistent "Failure:" vs "Failure / alt:".
17–19. PRESERVE.

## EXPERIENCE.md — prose

- Capture status vocabulary: each status in code formatting.
- Hidden notification form sentence rewritten with verb + "a `Review` action only"; same fix in Deviations SEC-005 row.
- Overview: "(canonical; where it overrides the PRD, the memlog wins — see Deviations)"; spines-win sentence as in DESIGN.md.
- "Bill reminders take priority over budget alerts" (J-BILLS step 5 + Notifications).
- "Opens when the sheet appears (amount first)."
- "Camera, notification and SMS permissions are requested just in time only."
- "TalkBack announces".
- "overridden by the Hero states table above".
- "(except the eye)"; daily line "when payday is set, otherwise by days to period end".
- Recategorise spelled one way (British, per disposition) in prose; the TalkBack custom-action label likewise `Recategorise`.
- Code-format UI strings in FLOW-08, FLOW-13, FLOW-15, FLOW-18, J-RESTORE-DELETED, IA table.
- Activity row TalkBack list: move "return icon is decorative" note outside the list.
- "a row tagged `Check`".
- "Every screen's spec covers the PRD §6.4 state set".
- "Gate passes → amount with an estimate label."
- "`Apply to all similar` when cards share a merchant".
- "J-* journeys, defined in the memlog, cover surfaces with no PRD flow".
- FLOW-09 step 4: "after the auto-approve time (`9:00 pm` in this example)".
- "Layouts respect display cutouts, gesture insets and the on-screen keyboard."
- Selection-mode preview reconciled as a template: `Move N entries from <Category> to <Category>`, or `Move N entries to <Category>` when sources are mixed; J-FUEL uses the matching instance.
- Minor: "two or more filters active"; "focused row (or the last row)"; clarify subject in Swipe cards "(stays 4s…)"; "taken verbatim from PRD §9"; "when the user switches tabs briefly".
