# PRD Quality Review — wmbugo PRD (v1.3.0-draft)

Reviewed: `prd.md` (full, frontmatter to Appendix C) and `addendum.md`. Compared against `review-rubric-v1.2.md`. Review date: 2026-11-01.

## Overall verdict

v1.3 resolves the v1.2 critical finding and almost all v1.2 high findings, and it does so with real substance. Auto-approve now has strict eligibility rules (CAP-007), a §7.4 invariant and a §16.2 P0. The no-SMS variant (§13.3), the parity and market matrices (§13.0/§13.0a), success metrics with counter-metrics (§3.3) and the §11 data model are now in place. The decision register remains the PRD's best asset. Three new risks need fixing before UX, architecture and story work:

- **Read-time auto-approve semantics are underspecified.** Moving auto-approve to "derived when data is read" removed the background-job problem, but it leaves history and side effects undefined.
- **The 50/30/20 "Savings" bar conflicts with the ledger.** The brand's own mark depends on a measure that the transfer rules make close to meaningless.
- **The "absorbed by the staged rollout" schedule claim is not backed by §20.** The milestones have no dates after M0 and do not cover several P1 epics, SMS included.

A layer of pre-v1.3 text (§23, Appendix B, SET-003, "widget", "Quick Add") still contradicts the new navigation and badge decisions.

## Decision-readiness — adequate

The decision register (§2) is still excellent. Every v1.3 decision (DEC-26..33) states a baseline, a reason and what it supersedes. DEC-01 states the trade-off plainly ("Solo developer; parallel iOS build doubles work before first launch"). DEC-22 now acknowledges the tension with the no-double-count P0 instead of ignoring it. The external gates gained Play account type (GATE-13) and brand assets (GATE-12). The v1.3 impact notes honestly put GATE-08 on the critical path. The product owner's decision to ship Phase 1 with no cut list is recorded clearly (§4.1, DEC-31, impact note 2).

Where it weakens is the schedule that is supposed to absorb that decision. §4.1 says "Schedule pressure is absorbed by the staged rollout in §20, not by dropping scope". But §20 has no dates after M0/M2, no market-staged rollout (M5 launches all four market groups at once), and no milestone for several committed epics. A decision-maker cannot tell from this PRD when Phase 1 ships, or what slips first when it is late.

### Findings

- **[high]** The schedule cannot absorb a no-cut-list P1 as claimed (§4.1 closing line, §20 M0–M5, §21, impact note 2).
  - M0 "Product freeze (target 2026-11-08)" and M2 "Internal alpha (begins 2026-11-08)" fall on the same date, so M1 (architecture spike, ADRs, encryption and pipeline prototypes) has no time window.
  - M3, M4 and M5 have no target dates or durations, so the schedule cannot be checked.
  - Several committed P1 epics appear in no milestone: WMB-12 SMS (parsing, scam and balance checks, explainer), WMB-02 onboarding, WMB-05 Home, WMB-09 recurring/Plan timeline, WMB-18 internationalization (currency list, formatting, per-market store listings) and the brand/splash work in WMB-01.
  - "Staged rollout" in §20 means feature betas, not a staged market or feature release. M5 ships everything to four market groups together.

  For one developer building three UPI parsers, multi-market itemized OCR, SMS, native widget and dialog modules, glass with fallback, encryption and backup, this is a real delivery risk. The PRD presents it as already handled.
  *Fix:* Give M1–M5 target dates or durations and give M1 a window. Assign every P1 epic (including WMB-02/05/09/12/18) to a milestone. Then either describe what "staged rollout" actually means (e.g. India-first production, other markets at M5+N; or SMS build after the no-SMS launch), or replace the §4.1 sentence with the honest statement: "launch date moves; scope does not". Add a `[NOTE FOR PM]` naming the slip trigger, for example: "if M3 exit is not met by <date>, the launch date is re-baselined".

- **[medium]** Play-side assumptions behind SMS-016 and M5 have not been verified (SMS-016, §20 M1/M5, §13.1, GATE-02, GATE-13).
  - Submitting "the Play SMS permission declaration as early as M1" assumes a declaration can be filed before the SMS feature exists. In practice the declaration goes with a build that declares the permission and shows the core use case, usually with a demo. SMS work is not scheduled in any milestone before M5.
  - M5 ships an "SMS-enabled build in India only" and a no-SMS build elsewhere under what is presumably one package. Whether Play country-targeted releases with different manifests (and a declaration that covers only some countries) are allowed is not stated as a gate.

  *Fix:* Add both to GATE-02/GATE-13 as required evidence. Schedule a minimal SMS-flavor build (enough for the declaration) at M1–M2. Record the fallback if per-country variants are not possible, e.g. ship the SMS flavor worldwide with India-only runtime enablement, or ship no-SMS everywhere until approval.

## Substance over theater — adequate

Most v1.3 content is product-specific and drives behavior:

- the ISO 4217 exponent rule (FIN-001), with exact round-tripping (§7.4)
- the OCR-005 "Not itemised" quality floor
- "Left in budget" vs "Free to use" and the goal rule (BDG-008, GOAL-002)
- the payday-cycle default (DEC-33)
- the "honest about gaps" principle (§6.1 #8, REC-010, ACC-006)
- the glass rules with a measurable fallback (§6.6, NFR-19)

§3.1 now ties personas to areas ("primary protagonist for capture … for Home, Plan and 50/30/20"), which partly resolves the v1.2 persona-theater finding. Brand (§6.6) is detailed for a PRD, but it is load-bearing here: the 50/30/20 pie *is* the mark, and it forced CAT-006 into the first schema.

### Findings

- **[low]** Adjective NFRs remain from v1.2 (NFR-06 "aims 60 FPS", NFR-07 "acceptable list scrolling", NFR-11 "appropriate hit target behavior"). NFR-19 adds "keep 60 FPS scrolling" with no tolerance. *Fix:* Use frame-budget bounds, e.g. "≤1% frames over 16.7 ms during a 10k-row fling on the GATE-03 reference device". For NFR-11, reference the 48dp minimum in §6.2.
- **[low]** Personas are still not carried into flows or the Definition of Ready (§9, §22.1). *Fix:* Prefix each FLOW with its protagonist, e.g. "FLOW-13 (Busy digital spender, India)".

## Strategic coherence — adequate

The thesis is clear: private, offline, correct, visual, effortless capture, with 50/30/20 as the brand idea. §3.3 now measures the capture thesis and names counter-metrics, which resolves a v1.2 high finding. The epic sequencing constraint (§21) still follows from the correctness thesis.

Two new tensions come from v1.3's own decisions. First, the brand's central promise (50/30/20, with "savings" as a third of the pie) is defined on a measure the ledger model mostly excludes. Second, the international launch (DEC-27) broadens the audience, but the capture thesis, metrics and personas are still India-shaped. Outside India the "effortless capture" differentiator is receipt scan plus manual entry, and nothing in §3.3 tells the team whether that is enough.

### Findings

- **[high]** The 50/30/20 "Savings" bar conflicts with the ledger model (DEC-30, CAT-006, BDG-009, INS-020, SCR-30, GOAL-002, FIN-013, INS-016, §6.6).
  - INS-020 defines the bars as "Confirmed spending by category type". Most real saving is a transfer to an owned savings account, or a goal "Moved to savings" (GOAL-002). FIN-013 says transfers "never count as … spent expense". So for most users the Savings bar will read near zero even when they save 20%.
  - The only way to fill it is CAT-006's seeded "Savings & investments" *expense* category. That counts saving as spending, which inflates "Spent", reduces "Left in budget" and distorts INS-010/012.
  - INS-016 "Kept N%" is a second, different savings measure (income − expenses) shown in the same Insights flow. Users get two "savings" numbers that disagree.

  Because the pie is the logo (§6.6), this is the measure users will check first.
  *Fix:* Define Savings for 50/30/20 explicitly. One option is "transfers into accounts or goals marked as savings, plus goal 'Moved to savings' contributions, plus any expense in a savings-type category", with the transfer-based part excluded from Spent. Another is "income − needs − wants" (i.e. Kept), labelled as such. Pick one, state how it relates to INS-016, add a `savings` flag to `account`/`goal` in §11 if needed, and add a §16.1 "5030" case: "a transfer to a savings account fills the Savings bar and does not change Spent".

- **[medium]** The international launch has no success measure and only part of a capture story outside India (DEC-27, §1.3 #4, §3.3, §3.1, §4.1, §13.3).
  - Every §3.3 capture metric ("≥70% of captures resolved with zero or one tap", the learning effect) is unsegmented. In practice only Indian SMS/UPI produce automated captures.
  - §4.1 lists CAP notifications, grouping, the evening summary and auto-approve as plain P1. §13.3 admits that outside India "the capture dialog is reached from receipt matches only", and receipts are user-initiated (OCR-011 Save is the approval). So outside India CAP-001/005/007, the evening summary and the widget pending count do almost nothing.
  - DEC-27's reason ("International brand and audience from day one") names no cost. The costs (four privacy reviews, multi-market receipt layouts, store listings) appear only in impact note 1, and no metric says whether non-India users get value.

  *Fix:* Segment the §3.3 capture metrics by India and other markets, and add one non-India target (e.g. "median ≤ 2 taps per receipt-captured expense", or manual-entry speed). Mark CAP-001/005/007 and the evening summary as effectively P1-IN in §4.1 and §13.0a. Add the cost side to DEC-27's trade-off column.

## Done-ness clarity — adequate

This is a clear improvement on v1.2's "thin":

- CAP-007's eligibility list is concrete.
- SMS-010/011/012 have definitions, a refund exception and chain-reset rules.
- LRN-003 has a window and a recovery path.
- OCR-005 has a quality floor and OCR-011 a default account.
- NFR-16..20 bound capture latency, parse accuracy, battery, glass and splash.
- The §16.1 CAP, UPI, INTL, 5030 and BRAND rows give story writers concrete cases.

The weak spots are where v1.3 changed a mechanism without following its consequences (read-time auto-approve), and where new scope arrived without its enumerations (currency list, "Uncategorised").

### Findings

- **[high]** Read-time auto-approve leaves history, configuration changes and side effects undefined (DEC-22, CAP-007, FIN-024, §11 `profile.auto_approve_cutoff`, BDG-004, REC-004, CAP-011, LRN-001, §11 `audit_event`).
  - FIN-024 says an eligible capture "is treated as confirmed when data is read and is persisted as `confirmed` on next write". It does not say *which* write (any ledger write, or a write to that row), or whether `capture_resolution = auto_approved` is persisted then too.
  - Until it is persisted, the confirmation depends on the current settings. Changing the cutoff from 21:00 to 23:00, or disabling auto-approve (DEC-22 "can be disabled"), would silently un-confirm past days and change historical totals and budgets. That breaks principle 4 and the "no double count on status change" acceptance in §8.3.
  - Effects that normally follow a confirmation have no trigger for a read-derived one:
    - BDG-004 threshold alerts
    - REC-004 "advances the next expected occurrence exactly once"
    - CAP-011/REC-009 bill linking
    - LRN-001 learning
    - the `audit_event` row
  - The cutoff's timezone is not stated (device timezone vs the profile timezone in FIN-002). §11 also has no flag for "auto-approve disabled".

  *Fix:*
  - Specify that the first read after the cutoff materializes eligible captures in one transaction: set `status = confirmed`, `capture_resolution = auto_approved`, `resolved_at`, write the audit event and run confirmation side effects. Reads before materialization show the same result.
  - State that cutoff or enable changes apply only to captures not yet materialized.
  - Define the cutoff in the profile timezone.
  - Add `auto_approve_enabled` to `profile`.
  - Add §16.1 CAP cases: "change cutoff after auto-approve: history unchanged" and "auto-approved capture triggers budget alert once".

- **[medium]** Gaps remain in the status and category model (FIN-024, TXN-008, DEC-29, TXN-002, CAP-007, CAT-001, CAT-006, OCR-005, INS-020, §10 "Review queue").
  - CAP-007 auto-approves with "Uncategorised in a needs-categorization state". FIN-024 has no such state, and §11 has no field for it. It is unclear whether these items appear in the review queue or the "N to check" count.
  - TXN-008 says the review queue holds "unclassified transactions". FIN-024 says the review queue, pending captures and widget count are "the same set: all `needs_review` items". These conflict if unclassified-but-confirmed items exist.
  - CAP-007's last eligibility condition ("has a category (learned, or 'Uncategorised' …)") is always true, so it filters nothing.
  - "Uncategorised" is not in the CAT-001 seed list, and CAT-006 says every expense category has a need/want/savings type. The PRD does not say which bar (if any) Uncategorised and OCR-005 "Not itemised" amounts go into.
  - DEC-29 sends manual entries through dedup "before posting". TXN-002 saves immediately with an Undo toast. Nothing says what happens when a manual entry matches an already confirmed capture: flagged after posting, a blocking prompt, or saved and flagged.

  *Fix:* Add `needs_category` as a flag (not a status) in FIN-024 and §11. Say whether it counts toward "N to check". Reword TXN-008 to match FIN-024. Drop the vacuous CAP-007 condition. Seed "Uncategorised" with no type and show it as a fourth "Not classified" segment in SCR-30. State that a manual entry matching a confirmed item saves as confirmed with `possible_duplicate` and appears in the review queue.

- **[medium]** The supported-currency list is never enumerated, and foreign-currency input is unhandled (DEC-05, FIN-001, §13.0a, SET-002, IMP-002, OCR-004, SMS-003, §16.1 INTL).
  - DEC-05 and §13.0a refer to "the supported list" and "others in the supported list", but no list exists.
  - FIN-001 cites BHD/KWD/OMR (exponent 3), while §13.0a's Gulf row names only AED, SAR, SGD and MYR. It is unclear whether exponent-3 currencies are in Phase 1.
  - With one currency per user, there is no rule for a receipt (OCR-004 extracts "currency"), Indian card SMS (SMS-003 parses "currency") or UPI capture in a different currency. Travellers in Europe and the Gulf hit this often.

  *Fix:* Add a Phase 1 currency table (ISO code, exponent, default locale) to §13.0a or an appendix, and run the INTL suite against every row. Add a rule: "a capture or receipt in a non-profile currency is not auto-approved; it opens review with the foreign amount shown and a required profile-currency amount entered by the user".

- **[medium]** There is no path for a user to confirm a sender (SMS-010, SMS-011, §10 "Verified sender", §11 `sender.status = user_confirmed`). SMS-010 allows senders "confirmed once" by the user, but also says only verified senders are parsed. A DLT header that is not on the allow-list therefore never reaches the user to be confirmed. SMS-011's "credit from a non-verified sender" branch is likewise unreachable as written. *Fix:* Define the unknown-DLT-header path: transaction-like SMS from a well-formed DLT header that is not on the allow-list produce a "New sender HDFCBK? [It's my bank] [Ignore]" prompt and are never auto-approved. Then scope SMS-011's non-verified-credit rule to that path. Add a §16.1 SMS case.

- **[medium]** The Home hero's budget and period are ambiguous (§6.3 #2, SCR-04, BDG-009, DEC-33, §6.5).
  - "Left in budget" for "the current period" does not say which budget. Users may have only category budgets, or only the three 50/30/20 type budgets (BDG-009 says these are "never added together" with the overall budget). Onboarding ⑤ can create the 50/30/20 budgets without any overall budget.
  - DEC-33 gives Insights and Plan the payday cycle but says nothing about Home. The no-budget fallback reads "Spent this month" even when the period is a payday cycle.

  *Fix:* State the hero rule. For example: overall budget if one exists; otherwise needs + wants targets from 50/30/20, labelled "Left for needs & wants"; otherwise "Spent". Also state that Home uses the DEC-33 period, with the label following the period ("Spent this cycle").

- **[low]** Vague phrasing and missing Acceptance lines from v1.2 are still unresolved: CAT-001 "sensible categories", BDG-007 "recalculating carefully", REC-006 "carefully", SET-003 "reasonable frequency caps", OCR-007 "fails gracefully", OCR-001 "compress safely". Only ONB, ACC, TXN and BDG have **Acceptance** lines. CAP, LRN, SMS, OCR, UPI, REC, INS and SET have none. *Fix:* Replace each phrase with a checkable rule. Add one Acceptance line per module, drawn from the §16.1 rows.

## Scope honesty — adequate

§4.1 now matches the feature sections, which resolves a v1.2 high finding. §4.2 indexes the v1.2 "Later" items. §13.3 states exactly what the no-SMS build contains. SMS-015's "no 'coming soon'" rule and §13.0a's "Unavailable capabilities are not shown" are honest product choices. The no-cut-list decision is stated rather than implied. The PRD uses named gates instead of `[ASSUMPTION]` tags, which still works for this PRD.

The main silent omission is about which receipt scripts and languages OCR covers in the markets it now promises.

### Findings

- **[medium]** Receipt OCR coverage across scripts and markets is not stated (DEC-31, OCR-003, OCR-007, §3.3 "Receipt OCR … covering all four markets", §8.11 delivery-risk note, addendum §1 "ML Kit Text Recognition v2, bundled model"). Gulf receipts are often Arabic or bilingual, and some Indian receipts use Devanagari or other Indic scripts. The addendum's candidate is a bundled on-device model, and Latin-script coverage is the safe assumption for such a model. Meanwhile §3.3 sets ≥90% accuracy across all four markets and OCR-007 lists "multilingual" receipts only as a graceful-failure case. *Fix:* State the Phase 1 script scope (e.g. "Latin-script fields; non-Latin text is ignored, and totals must still be read from Latin numerals"). Add Arabic/Indic receipts to the reference set as a measured category. Make script coverage required evidence in GATE-05.
- **[low]** Gates are stale for the v1.3 shape (§24). GATE-01 still asks for sign-off on "free/premium positioning" (left over from v1.2). GATE-05 requires "iOS/Android parity" before Phase 1 work, though iOS is P2. §20 says every gate owner is the product owner, except GATE-08. That makes GATE-07 ("Finance domain reviewer") and GATE-04 ("Security engineer") self-reviews, and the PRD does not say so. *Fix:* Change GATE-01 to "Phase 1 free-only". Mark GATE-05's iOS part as P2. Note under §20 which gates are self-reviewed and what evidence substitutes for an independent review (e.g. the property-test suite for GATE-07).

## Downstream usability — adequate

v1.3 fixed the structural extraction problems from v1.2. §11 now covers learned mappings, payees, senders, receipt items, prompt state and capture resolution, and it marks `automation_rule` as Phase 2. The P1/P1-IN/P2 labels replace "MVP" consistently in §5.2, §8.9 and §21. The glossary resolves the bill/receipt and Home card/home-screen widget collisions.

What remains is a layer of untouched older text that contradicts v1.3 decisions. Anyone extracting from §23, Appendix B or SET-003 will import the old navigation and badge model. §11 also has a few gaps against REC and BDG.

### Findings

- **[medium]** Stale pre-v1.3 text contradicts the new decisions:
  - §23 table ("Expand to full finance experience and five destinations") and §23.1 ("PRD four-tab nav: replaced with five destinations and secondary Settings") contradict DEC-16, which has four tabs and a centre ＋. The source's four tabs are effectively restored.
  - Appendix B (Home state contract) has "Needs review → Review badge" (DEC-16 says "never a count badge"; §6.3 uses the "N to check" card), "Insufficient forecast data → Suppress safe-to-spend estimate" (Free to use is "Plan only", §6.3/BDG-008) and "Loaded → Known funds, period KPI" (the hero is now "Left in budget").
  - SET-003 has "unreviewed import/SMS badges", which contradicts DEC-16 (no badges) and SMS-015 (no SMS text in no-SMS builds).
  - TXN-001 and HOM-006 still say "Quick Add", and TXN-001's "scan if supported, or import" predates the Add sheet in §5.1/SCR-09.
  - FLOW-07 starts at "Activity/Import", but CSV import lives in Settings hub › Data (§5.1).
  - "Widget(s)" still means Home cards in §4.1 ("customizable widget visibility/reorder"), HOM-004 ("Widgets refresh…") and §5.3 ("flexible widgets"), against HOM-001's own term rule.
  - §10 "Mixed merchant" ("assigned 2+ categories") contradicts LRN-003 ("within its last 5 confirmations").
  - §6.5 date presets (adds Yesterday, This quarter) differ from INS-001's.
  - §16.1 PLAT still lists "iOS picker/camera" with no P2 mark.

  *Fix:* Sweep these locations. Rewrite §23/§23.1 to "four tabs + centre ＋, no drawer (DEC-16)". Rebuild Appendix B against §6.3's four hero states. Replace "badges" in SET-003 with "Home card and Activity dot". Use "Home card" everywhere except SCR-29.

- **[medium]** §11 still has gaps against REC, BDG and CAP:
  - `recurring_rule` lacks the fields REC-001 lists (title, account, category, optional notification, end/pause) and the matching keys REC-009 needs (payee/UPI ID, amount tolerance).
  - `budget.scope` has no target reference (which category or budget type) and no account scope (BDG-002).
  - `learned_mapping.key_kind[…|payment_account]` mixes the lookup key with the prediction target. LRN-007 learns an account *per merchant* and *per category*, so a `target_kind` and a separate `key_kind` are needed.
  - FIN-024's `possible_duplicate` flag has no field. It is unclear whether it is derived from an open `review_candidate`.
  - There is no `auto_approve_enabled` (see the done-ness finding).

  *Fix:* Add `recurring_rule(title, account_id, category_id, payee_id?, amount_tolerance_minor, notify, paused, end_at?)`, `budget(scope_ref_id?, account_ids[]?)` and `learned_mapping(key_kind[merchant|upi_id|item|category], target_kind[category|account])`. State that `possible_duplicate` is derived from an open `review_candidate`.

- **[low]** Flows are missing for v1.3 behaviors: account discovery (CAP-009), own-account transfer linking (CAP-010), Pay card bill (ACC-007), re-approving a rejected capture, the evening summary, and SCR-28 management. *Fix:* Add short FLOW-15..19, or point to the UX deliverable explicitly.

## Shape fit — adequate

A consumer product feeding a full UX → architecture → stories chain needs this level of traceable formality, and the PRD has it. Flows stand in for user journeys and still lack protagonists (see substance). Moving technology candidates and UX detail to `addendum.md` with "the PRD wins on any conflict" is a good shape decision that keeps the PRD at product level. Process furniture remains (§0 handoff, §25 checklist, GATE-10, Appendix C).

### Findings

- **[low]** Process furniture and stale paths (§0, Appendix C, GATE-10, §25). Appendix C still points to `inputs/wmbugo_PRD_v1.md`. The real file is `_bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/prd.md`. *Fix:* Delete Appendix C or correct the path. Either tick the §25 items that v1.3 satisfies or label §25 as a reviewer worksheet.

## Mechanical notes

- **v1.2 findings status:**
  - Resolved: critical auto-approve; no-SMS variant; success and counter-metrics; §4.1 scope; §11 data model (mostly); parity and "MVP" retirement; verified sender, SMS-011 refunds, SMS-012 reset, LRN-003 window; SEC-005 vs CAP-001; bill/receipt and widget glossary entries; capture NFRs; v1.2 "Later" items indexed in §4.2; change-log table rendering.
  - Partially resolved: personas; glossary collisions (widget drift remains); flows (FLOW-08 updated, FLOW-13/14 added).
  - Unresolved: NFR adjectives; vague FR phrases; missing Acceptance lines; GATE-01; flow protagonists; Appendix C; DEC-23 stale cross-reference; source-legend consistency; "v1" overloading; §16.1 PLAT; §25 unchecked.
- **ID ordering** is worse than in v1.2. The IDs are unique, but the listing order is not:
  - ONB-007/008 appear before ONB-006 (§8.1).
  - HOM-008 appears before HOM-007 (§8.8).
  - REC-009/010 appear before REC-008 (§8.6).
  - INS-007 sits between INS-004 and INS-005, and INS-008/009 do not exist (§8.9).
  - SCR-27..31 appear before SCR-25/26 (§5.2).
  - WMB-16..18 appear before WMB-13 (§21).
  - §13 subsections run 13.0, 13.0a, 13.1, 13.3, 13.2.

  Either reorder them or add a note that IDs are stable and listing order is by phase.
- **Source-legend tags:** a new `[v1.3]` tag is used (ONB-002, ACC-006..008, CAT-006, BDG-009, OCR-011/014, SMS-015/016, CAP-007/009..011, LRN-007, REC-009/010, INS-007, SEC-005) but is not defined in the §0 legend. Many other requirements carry no tag. Define `[vX.Y]` in the legend or drop the claim that the legend is complete.
- **DEC-23** still says it "supersedes 'explicit rules only' in FIN-025/CAT-005". Neither FIN-025 nor CAT-005 contains that phrase.
- **Duplicate sentence** in §6.3: "Each card supports tap-to-details … and a clear period label" appears at the end of the "Safe to spend" paragraph and again in the following paragraph.
- **"v1" overloaded:** "No remote event tracking is permitted in v1" (§3.3), "no server users/roles in v1" (§14), "approved PRD v1 requirements" (§20) and "PRD v1" (§23). Use "Phase 1" for release scope.
- **Change log:** there is still no 1.0.0 baseline row, although the note names it. The v1.3 "Decisions affected" list omits SET-002 (region/currency, changed), §6.5 (DEC-33 period), TXN-001/HOM-006 (unchanged but should have been), §23 and Appendix B (stale).
- **Glossary gaps (§10):** no entries for capture, auto-approve, daily cutoff, source record, region/market, "Not itemised", "Uncategorised"/needs-categorization, or "Waiting for you". The user-facing state labels (FIN-024) and the addendum's capture status vocabulary should both be cross-referenced in the glossary.
- **§16.1 suite name "5030"** is unusual as an ID. Use "BUD5030" or fold it into BDG.
- **§5.3** "dynamic island/notches" is an iOS-only term in an Android-only P1 section. Mark it P2.
- **§2 "External decision gates" paragraph** duplicates §24's gate table in prose. Keep one and point to it from the other.
- **Assumptions Index:** none. Gates (§24) do the job, and that is acceptable. Inferred items such as the Latin-script OCR scope and Play per-country variants should become gate evidence rather than unstated assumptions.
- **UJ protagonists:** none of FLOW-01..14 names a protagonist.
