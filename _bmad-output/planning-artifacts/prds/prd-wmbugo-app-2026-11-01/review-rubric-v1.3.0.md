# PRD Quality Review — wmbugo PRD (v1.3.0, final)

Reviewed: `prd.md` (frontmatter through Appendix C, all 1,323 lines) and `addendum.md`. Prior reviews (`review-rubric-v1.2.md`, `review-rubric-v1.3-draft.md`) were used only to check what is now resolved; every finding below was re-checked against the current text. Review date: 2026-11-01.

Product-owner decisions treated as given, not as defects: Android-only Phase 1, solo developer, four-market international launch with one currency per user, no Phase 1 cut list, 50/30/20 in Phase 1, M3–M5 dated later from measured velocity.

## Overall verdict

v1.3.0 is a strong, decision-ready PRD. The decision register, the named gates with solo-review substitutes, FIN-026's auto-approve materialization rules and the capture status mapping close almost every high finding from the v1.3 draft review. Four real defects remain, and they sit where the product makes its most visible promises. The 50/30/20 Savings formula double-counts "Moved to savings" contributions. The Home hero under a 50/30/20-only setup ignores "Not classified" spending, so "Left in budget" can be overstated. TXN-012 creates a confirmed + `possible_duplicate` state that contradicts FIN-024, the status mapping and the no-double-count P0. And §25 claims Given/When/Then acceptance for every §8 module when ONB, ACC, TXN and BDG still have only prose. All four are small text fixes. They should be made before `bmad-architecture` and story creation copy the contradictions forward.

## Decision-readiness — strong

The decision register (§2, DEC-01..33) remains the best part of the document. Each row states a baseline, a reason and what it supersedes. Trade-offs are stated as decisions: DEC-01 says "parallel iOS build doubles work before first launch", DEC-22 admits the tension with "the no-double-count P0", and DEC-31 removes the v1.2 "first to cut" label explicitly. §24 turns unknowns into owned gates. The "Solo-review risk" table names a concrete substitute check for each self-reviewed gate (e.g. GATE-07 → "FIN invariant property suite green; worked examples … reviewed against fixtures"), which resolves the draft review's self-review finding. §20 now dates M0–M2, gives M1 a window (2026-11-03 → 2026-11-07), maps every P1 epic to a milestone, and says plainly that M3–M5 are "deliberately undated rather than guessed", with a checkpoint at the end of M2. This resolves the draft review's high schedule finding within the owner's constraints.

What a reader still cannot tell is whether the document is approved: three places give three different answers.

### Findings

- **[low]** The approval status contradicts itself (frontmatter, header, §0, §20 M0, §25). Frontmatter says `status: final`, and §0 says "This file is the frozen v1.3 PRD". The header block says "Proposed baseline for stakeholder approval", and §20 M0 (2026-11-02 → 11-07) still lists "approve this PRD" as future work. §25 ticks "Product owner accepts the explicit decision defaults (v1.3 session, 2026-11-01)". *Fix:* Pick one. If the PRD is approved, change the header to "Approved baseline (product owner, 2026-11-01)" and drop "approve this PRD" from M0.
- **[low]** "Absorbed by the staged rollout" still overstates what §20 offers (§4.1 last line, v1.3 impact note 2). §20's stages are feature betas (M3/M4), and M5 launches the no-SMS build to all four market groups at once. With no cut list, schedule pressure is actually absorbed by the undated M3–M5, which §20 states honestly. *Fix:* Reword §4.1 to "Schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope", and make impact note 2 match.

## Substance over theater — strong

Almost everything is product-specific and load-bearing:

- the ISO 4217 exponent rule with exact round-trips (FIN-001, §7.4, §13.0a currency table)
- the OCR-005 "Not itemised" quality floor
- the Latin-script scope with a measured Arabic/Indic category (OCR-007)
- "Left in budget" vs "Free to use" and the goal rule (BDG-008, GOAL-002)
- the §6.7 voice rules ("₹1,240 over budget · 4 days left", never "Inbox")
- glass limited to floating surfaces, with a measured fallback (§6.6, NFR-19)

The brand section is detailed for a PRD, but it is earned: the 50/30/20 pie is the mark, and that forced CAT-006 into the first schema. NFR-07 and NFR-11 now have real bounds. There are five personas, one more than the rubric's comfort line, but each now carries at least one named-protagonist flow (§9), and §3.1 says which areas each persona drives.

### Findings

- **[low]** A few adjective bounds and soft targets remain:
  - NFR-06 "aims 60 FPS" and NFR-19 "keep 60 FPS scrolling" give no tolerance, unlike NFR-07's "≥ 95% of frames".
  - §3.3 "Learning effect … falls week over week" has no size threshold.
  - OCR-001 says "compress safely" and OCR-007 says "fails gracefully".
  - §6.6 says the fallback "must look intentional, not degraded".

  *Fix:* Reuse the NFR-07 form for NFR-06/19. Give the learning metric a floor (e.g. "week-3 correction rate ≤ 50% of week 1"). For OCR-001/007, state the observable behavior (max dimension and quality; "manual entry offered within one tap, image kept").

## Strategic coherence — adequate

The thesis is clear and carried through: private, offline, correct, visual, effortless capture, with 50/30/20 as the brand's mark. §3.3 measures the capture thesis per market and names counter-metrics, including "Duplicate confirmed entries = 0". DEC-30/ACC-009 replaced the old "savings as an expense category" with transfers into savings accounts, which resolves the draft review's main coherence finding. The epic sequencing constraint (§21) follows from the correctness thesis.

What holds this dimension at *adequate* is that both numbers the brand promises users ("Left in budget" and the Savings share of the pie) still have formula defects. These are the first figures a 50/30/20 user like Arjun will check.

### Findings

- **[high]** The Savings formula double-counts "Moved to savings" contributions (BDG-009, INS-020, GOAL-002 acceptance, DEC-30, ACC-009).
  - BDG-009 defines Savings as "the sum of transfers into accounts marked *savings* (ACC-009) **plus** goal contributions of type 'Moved to savings' (GOAL-002)". INS-020 repeats "transfers into savings accounts + 'Moved to savings' goal contributions".
  - The GOAL acceptance says a ₹5,000 "Moved to savings" contribution "is one transfer into the savings account, counts toward the 50/30/20 Savings bar". When that account is marked savings, which is the normal case, the same ₹5,000 is counted twice.
  - Nothing says whether transfers *out of* a savings account reduce Savings. A user who moves ₹10,000 in and ₹10,000 back out in the same period shows ₹10,000 saved.

  *Fix:* Define Savings as the **set union by transaction**: "transfers into savings-marked accounts, plus 'Moved to savings' contributions whose transfer lands in an account not marked savings; each transaction counted once". State gross vs net, for example: "net of transfers out of savings accounts in the same period, floored at 0". Add a §16.1 5030 case: "₹5,000 Moved to savings into a savings account → Savings bar +₹5,000, not +₹10,000".

- **[high]** With a 50/30/20-only setup, the Home hero ignores "Not classified" spending, so "Left in budget" can be overstated (§6.3 #2, HOM-001, CAT-006, CAP-007, OCR-005, BDG-009).
  - §6.3 says that with only 50/30/20, the hero uses "the Needs + Wants targets against needs + wants spending".
  - CAT-006 puts Uncategorised, any category without a type, and every OCR-005 "Not itemised" amount into a fourth **Not classified** segment, which is neither need nor want.
  - CAP-007 confirms every eligible capture with no learned category as Uncategorised. In a user's first weeks that is most auto-approved captures, and OCR-005 makes "Not itemised" normal on receipts.

  The result is that confirmed spending drops out of the hero's "Left in budget", against principle 4 ("never animate stale or approximate data as a confirmed balance") and principle 8 ("Honest about gaps"). This is the headline "Am I okay?" number for the PRD's primary Home protagonist.
  *Fix:* Define the 50/30/20-only hero as "Needs + Wants targets − (needs + wants + not-classified spending)", or show "+₹N not classified" beside the figure. Add a HOM acceptance case for the 50/30/20-only hero state; HOM has none today.

## Done-ness clarity — adequate

This dimension improved substantially:

- FIN-026 gives auto-approve a five-step materialization contract: timezone, read-time display, a single write with side effects run once, forward-only setting changes, and loss of eligibility.
- CAP, LRN, SMS, OCR, UPI, REC, INS, SET, GOAL, HOM, IMP, BKP and SEC all now carry Given/When/Then acceptance.
- TXN-013 handles foreign-currency input.
- SMS-017 closes the unreachable-sender gap.
- `needs_category` is a flag, and TXN-008 states "N to check" membership.

The draft review's high finding on read-time auto-approve is resolved. Being unforgiving, though: §25 claims more than the document delivers, and one new requirement contradicts the core status contract.

### Findings

- **[high]** TXN-012 creates a state that contradicts FIN-024, the status mapping and the no-double-count P0 (TXN-012, FIN-024, TXN-008, §7.3 status mapping, §7.4, §16.2, §3.3 counter-metrics).
  - TXN-012: a manual entry matching an existing confirmed item "is saved as **confirmed** with the `possible_duplicate` flag and appears in the review queue".
  - FIN-024 and TXN-008 define the review queue as **exactly** the set of `needs_review` items. The status mapping table has no row for `confirmed` + `possible_duplicate`; its "held" row is `needs_review` + `possible_duplicate`, "Counted: No".
  - FIN-024: "Only confirmed non-excluded items contribute to headline totals." So until the user resolves the item, both the original and the new entry are counted. That is the "duplicate confirmed counting" §16.2 calls P0, and it breaks the "Duplicate confirmed entries = 0" counter-metric measured in CI.
  - It is also unclear whether this item counts in "N to check" and the widget pending count.

  *Fix:* Choose one of two options. (a) Save the manual entry as `needs_review` + `possible_duplicate` (excluded from totals, shown as "Possible duplicate — check it") with a visible "Saved — check it" toast, which keeps the "never blocked" intent. Or (b) keep it confirmed, add a mapping-table row "confirmed + possible_duplicate | Yes (provisional) | …", widen FIN-024/TXN-008's set definition to include it, and carve this case out of the §16.2 P0 and the counter-metric explicitly. Option (a) is consistent with everything else. Add a TXN acceptance case either way.

- **[high]** §25's claim that "Every FR module in §8 carries Given/When/Then acceptance criteria" is false, and the gaps sit on thesis-critical requirements (§8.1 ONB, §8.2 ACC, §8.3 TXN, §8.5 BDG, §25 last line, §22.1).
  - ONB (line "fresh install in Airplane Mode → usable Home…"), ACC ("account detail total equals ledger-derived balance…"), TXN ("≤15-second median expense entry…") and BDG ("previous-period and future-period records unaffected…") still have only one-line prose acceptance.
  - As a result, none of these has any acceptance case: BDG-008's Free-to-use gate and "missing inputs listed" (GOAL acceptance covers only the goal subtraction); BDG-009's template, its income basis and the Savings calculation; BDG-004 threshold behavior (only SET acceptance covers it, indirectly); BDG-007 effective-now vs next-period; TXN-012 manual duplicates; TXN-013 foreign currency; TXN-002 per-category account default; ACC-007 Pay card bill; ACC-008 Adjust balance; ACC-009 savings marking; ONB-002/003/008.
  - §16.1 has no rows for TXN-013, SMS-017 or Savings computation either. The 5030 row tests targets and category-type moves, not the transfer-based Savings bar.

  §22.1 says stories without verifiable acceptance are not Ready, so the story writer will have to invent these.
  *Fix:* Convert the four prose lines to Given/When/Then and add at least these cases: Free-to-use gate fails → "not enough information yet" plus listed missing inputs; 50/30/20 template from ₹80,000 income → 40,000/24,000/16,000; transfer to a savings account fills Savings and leaves Spent unchanged; foreign-currency capture → review, never auto-approved, foreign amount kept; Pay card bill → transfer, spending unchanged; Adjust balance → adjustment posting, not income. Add matching §16.1 cells (TXN, SMS, 5030).

- **[medium]** The widget pending count disagrees with the app during the read-time auto-approve window (FIN-024, FIN-026 (2)–(3), HOM-007, SCR-29, CAP-007 evening summary).
  - FIN-024 says the widget's pending count is "all `needs_review` items".
  - FIN-026 (2) says that between the cutoff and the next app open, eligible captures are still stored `needs_review` but *shown* as "Recorded · category guessed" and counted in totals. Materialization happens only "on the first app open or resume".
  - The launcher widget updates without the app being opened. From 21:00 until the next open, it will show those captures as pending ("● 6") while the app and the evening summary call them recorded.

  *Fix:* Define the pending set as "`needs_review` items not currently eligible-past-cutoff (FIN-026 step 2)", and say the widget and the evening summary use the same read-model predicate. Add a CAP case: "after 21:00 with app unopened, widget count excludes eligible captures".

- **[medium]** INS-001's period presets omit the payday cycle, which is the default period (INS-001, DEC-33, §6.5).
  - DEC-33 makes the payday cycle the default for Insights and Plan.
  - §6.5 lists "This pay cycle and Last pay cycle (when a payday is set), Today, Yesterday, 7 days, This month, Last month, This quarter, This year, Custom".
  - INS-001, the Insights requirement itself, lists only "Today, 7 days, This month, Last month, Quarter, Year, Custom".

  A story built from INS-001 will not include the default period. *Fix:* Make INS-001 reference §6.5's preset list instead of restating it.

- **[low]** App lock and notification content are not fully aligned (CAP-001, SEC-005, §5.1 entry points, SEC acceptance 2).
  - With app lock on and the device unlocked, SEC-005 shows the full capture notification (amount, merchant, account), and CAP-001 lets Approve/Reject run "without unlocking" because it "reveals nothing new".
  - §5.1 says capture-notification entry "pass[es] the app lock check first", and SEC acceptance says that with app lock on, "unlock is required before any amount is shown".

  An app-lock user will see amounts in the notification shade. That is a defensible choice, but the PRD should state it as one. *Fix:* Add to SEC-005: "App lock does not redact notifications on an unlocked device; users who want that use the hide-amounts / redacted-notification option", or make notifications redacted whenever app lock is on.

## Scope honesty — strong

The scope sections are honest and explicit:

- §4.1 says outright: "All P1 items are committed; there is no ranked cut list."
- §4.2–4.4 separate Phase 2, Phase 3 and out-of-scope items cleanly.
- §13.0a and §13.2 say exactly what each market and the no-SMS build contain ("no dead controls, no 'coming soon'").
- OCR-007 now states the Phase 1 script scope and makes Arabic/Indic receipts a measured category, which resolves the draft's medium finding.
- The single `[ASSUMPTION]` (SMS-016, Play India-only targeting) is tied to GATE-02 "before M3" and echoed in §25.
- Open UX items are listed in §24 with an owner.

Open-items density is low and appropriate for a green-light PRD.

### Findings

- **[low]** REC-007 and REC-008 have unclear phase and no screen (§8.6, §5.2, INS-022, REC-005).
  - REC-007 ("allow user to reject suggestions permanently or temporarily") only makes sense with REC-005 inference, which is Phase 2.
  - REC-008 ("Subscription page … total monthly-equivalent cost … past charges") has no SCR entry (SCR-16 is "Bills/recurring"), and INS-022 Subscription timeline is P2.
  - Both sit untagged in a P1 module, so story writers will treat them as committed.

  *Fix:* Tag REC-007 as P2. Either tag REC-008 as P2 or fold it into SCR-16 with a P1 scope sentence.
- **[low]** Outside India, most of the capture machinery has no source (§4.1, CAP-001/005/007, §13.2, §13.0a). Auto-approve eligibility requires "a verified sender (SMS-010) or a parsed UPI screenshot", so outside India nothing is ever auto-approved, and the evening summary and grouped capture notifications have nothing to report. §13.2 says this for the no-SMS build, but §4.1 and §13.0a present these as plain P1 for every market. *Fix:* Add a §13.0a row: "Capture notifications, auto-approve, evening summary | Yes | receipt-match prompts only | … | …".
- **[low]** GATE-05 still requires "iOS/Android parity" as Phase 1 evidence (§24), although iOS OCR validation is Phase 2 (DEC-10, §4.2). *Fix:* Mark the iOS part "(Phase 2)".

## Downstream usability — adequate

This PRD feeds UX, architecture and stories, and most of it extracts cleanly:

- every flow has a named protagonist (FLOW-01..18, resolving a long-running finding)
- a shared capture status mapping table explicitly addressed to UX and architecture
- glossary entries for the v1.3 terms
- all cross-references resolve (no dangling FR/SCR/NFR/DEC/GATE/FLOW IDs found)
- the stale Appendix B, SET-003 badges, "Quick Add", FLOW-07 entry point and §23 navigation text from the draft review are all fixed

The §11 model is close but still misses fields that FRs and acceptance cases need.

### Findings

- **[medium]** The §11 data model has gaps against FRs and acceptance cases:
  - `goal` has no `name`, `icon` or `color` (GOAL-001: "target name … icon/color").
  - `account` has no `icon`/`color` (FIN-010), `sort_order` (ACC-001 reorder), `credit_limit` or `statement_due_day` (ACC-003).
  - There is no refund/recovery link: FIN-023 needs "refund … linked to original expense", and BDG-006/§10 define budget used as "expenses minus **linked** refunds". `transaction` has only `reversed_by_id`.
  - There is no link between a recurring rule and the payments that satisfied it. REC-004 needs "advances … exactly once", and the REC acceptance needs "linking the same payment again is refused". `recurring_rule` also lacks a kind (subscription / rent / EMI) for REC-007.
  - There is no store for budget alerts already fired per period. BDG-004 says "no duplicate alerts", and the SET acceptance says "none for 75% is repeated later in the period"; with read-time derivation this state must be persisted.
  - There is no way to represent a bill reservation. GOAL-004 and its acceptance block "the same ₹5,000 … assigned to a goal and reserved for a bill", but only `goal_allocation` exists.
  - `transaction.before_tracking_started` is stored, but FIN-016 makes it derivable from the account's opening date, which ACC-002 lets the user edit. A stored flag will go stale.
  - `import_batch` has no raw-file path or retention deadline (IMP-006, 30-day default).

  *Fix:* Add these fields (`goal.name/icon/color_token`; `account.icon/color_token/sort_order/credit_limit_minor?/statement_due_day?`; `transaction.related_transaction_id?` + `relation_kind[refund_of|recovery_of]`; `recurring_payment(rule_id, transaction_id unique, period_key)`; `recurring_rule.kind`; `budget_alert_fired(budget_id, period_start, threshold)`; `reservation(goal_id?, recurring_rule_id?, amount_minor)` or a bill target on `goal_allocation`; `import_batch.raw_path?, retain_until?`). Mark `before_tracking_started` as derived.

- **[low]** Residual stale or drifting text:
  - §13.2 says "SMS-001..016 … **Absent**", but SMS-017 exists.
  - "Widget(s)" still means Home cards in §4.1 ("customizable widget visibility/reorder"), HOM-004 ("Widgets refresh…") and §5.3 ("flexible widgets"), against HOM-001's own term rule and the §10 glossary.
  - The §10 "Mixed merchant" entry ("assigned 2+ categories") contradicts LRN-003 ("within its last 5 confirmations").
  - SET-005 says "hide-balances toggle" while HOM-008/§6.3 say "hide-amounts".
  - DEC-21 lists automated captures as "(SMS, bill match)" and omits UPI share and receipt matches.
  - §16.1 PLAT ("iOS picker/camera") and UX ("VoiceOver") have no P2 mark.
  - "v1" still stands for release scope in §3.3 ("permitted in v1"), §14, §19 ("release 1"), §20 ("approved PRD v1 requirements") and §23.

  *Fix:* One sweep: SMS-001..017; "Home card(s)" in the three places; glossary "within its last 5 confirmations (LRN-003)"; "hide-amounts"; DEC-21 "(SMS, UPI share, receipt match)"; P2 tags on iOS test items; "Phase 1" for "v1".

## Shape fit — strong

This is a consumer product at the top of a UX → architecture → stories chain, and the PRD has the formality that calls for: named-protagonist flows, a screen inventory, traceable IDs, a test-traceability format (§16.3) and Definition of Ready/Done. Moving technology candidates and UX detail into `addendum.md`, with the rule "the PRD wins on any conflict", keeps the PRD at product level. The addendum agrees with the PRD on the points checked (discovered-account balance formula, capture vocabulary, widget layout, bundled OCR model). Process sections (§0 handoff, §25 checklist, Appendix C) are short and now accurate (Appendix C path fixed). Nothing is over-formalized for a solo build, because the chain-top role justifies the rigor.

No findings.

## Mechanical notes

- **Draft-review status (v1.3-draft → v1.3.0):**
  - **Resolved:** read-time auto-approve semantics (FIN-026); the Savings/ledger conflict (savings via transfers; the formula defect above is new); milestone coverage and M1 window; Play SMS declaration timing (SMS-016 at M3 with a `sms` build) and the per-country assumption under GATE-02; international metrics segmentation; `needs_category` and Uncategorised; the currency list; foreign-currency rule (TXN-013); the sender-confirmation path (SMS-017); hero budget/period rule; OCR script scope; GATE-01; solo-review substitutes; Appendix B, SET-003, Quick Add, FLOW-07 and §23 navigation; §11 recurring/budget/learned-mapping fields; flows for CAP-009/010, ACC-007 and re-approve; flow protagonists; Appendix C path; the §13 subsection order.
  - **Partially resolved:** widget drift; NFR adjectives (NFR-07/11 fixed; NFR-06/19 not); vague phrases (CAT-001, BDG-007, REC-006, SET-003 fixed; OCR-001/007 not); acceptance lines (all modules except ONB/ACC/TXN/BDG).
  - **Unresolved:** ID listing order; `[v1.3]` tag undefined in the §0 legend; DEC-23 stale cross-reference; "v1" overloading; §16.1 PLAT; duplicate §6.3 sentence; no 1.0.0 change-log row; glossary gaps; "5030" suite name; §5.3 "dynamic island"; §2 gate prose duplicating §24.
- **ID continuity:** IDs are unique and every reference resolves. The GATE-04..09 and SCR-27..29 repeats are legitimate second tables (§24 solo-review table, §13.2). Listing order is still out of sequence in many places:
  - FIN-016 before FIN-011; FIN-026 before FIN-025 (§7.2–7.3)
  - TXN-012/013 before TXN-009 (§8.3)
  - REC-009/010 before REC-008 (§8.6)
  - HOM-008 before HOM-007 (§8.8)
  - INS-007 between INS-004 and INS-005, and INS-008/009 do not exist (§8.9)
  - SCR-27..31 before SCR-25/26 (§5.2)
  - WMB-16..18 before WMB-13 (§21)

  ONB and §13 are now in order. *Fix:* Reorder, or add one line under §0: "IDs are stable; new IDs are appended and listed next to related items."
- **Source legend:** `[v1.3]` tags (ONB-002, FIN-026, ACC-006..009, TXN-012/013, CAT-006, BDG-009, REC-009/010, INS-007, OCR-011/014, SMS-015..017, SEC-005, CAP-007/009..011, LRN-007) are not defined in §0's `[SRC]/[FIX]/[NEW]` legend.
- **DEC-23** still says it "supersedes 'explicit rules only' in FIN-025/CAT-005"; neither requirement contains that phrase now.
- **Duplicate sentence (§6.3):** "Each card supports tap-to-details … and a clear period label" appears at the end of the "Safe to spend" paragraph and again at the start of the next one.
- **Label collision:** §16.2 uses "P0/P1" as release priorities, while the header defines "P1 = Phase 1". "P0: All P1 flows work in Airplane Mode" mixes the two. Consider "Blocker/Major" for §16.2.
- **Glossary (§10) gaps:** no entries for capture, auto-approve, daily cutoff, source record, "Not itemised", Uncategorised/Not classified, `needs_category`, savings account (ACC-009) or the 50/30/20 Savings share. The "Account balance" entry does not mention the FIN-016 before-opening-date exclusion.
- **Change log:** there is no 1.0.0 baseline row, although the numbering note names one. The 1.3.0 "Decisions affected" column omits TXN-012/013, SMS-017, FIN-026, ACC-009 and SET-002 (some are named in the change text but not in the affected list).
- **Assumptions Index:** none. There is one inline `[ASSUMPTION]` (SMS-016), and it round-trips to GATE-02 and §25. That is acceptable at this density.
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. Mei carries FLOW-01/02/08, Ravi FLOW-03/04/05, Sara FLOW-07/10/12, Arjun FLOW-06/11/14/17 and Priya FLOW-09/13/15/16/18. The flow set has no non-India receipt-match or CSV-plus-capture dedup flow, though the receipt-first markets rely on both.
- **Required sections:** all present for a chain-top consumer PRD.
