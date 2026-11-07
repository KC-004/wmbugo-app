# PRD Quality Review — wmbugo PRD (v1.3.2, final)

Reviewed: `prd.md` v1.3.2 (frontmatter through Appendix C, all 1,389 lines) and `addendum.md`. The earlier reviews (`review-rubric-v1.3.0.md`, `review-adversarial-general-v1.3.0.md`) were used only to check what is now resolved. Every finding below was re-checked against the current text. Review date: 2026-11-01.

Product-owner decisions treated as given, not as defects: Android-only Phase 1, solo developer, four-market international launch, one currency per user, no Phase 1 cut list, 50/30/20 in Phase 1, and M3–M5 dated later from measured velocity.

## Overall verdict

v1.3.2 is a strong, decision-ready PRD. All the critical and high findings from the v1.3.0 reviews about double counting and the hero are closed in the text:
- auto-approve is always a write (FIN-026);
- manual duplicates are held, not counted (TXN-012);
- Savings is counted once, as net transfers (BDG-009);
- unclassified spending reduces "Left in budget" (§6.3);
- duplicate matching, refunds, timezone and learning each have their own rule (FIN-027/028, FIN-002, LRN-008).

The remaining risk is of two kinds. The first is semantic: the 50/30/20 Savings bar, which is the brand's mark, measures the wrong thing for the primary Indian persona. In India the everyday bank account is literally a "savings account", and SIP investing cannot be modelled. The second comes from the latest fixes, which left stale or conflicting text around them:
- CAP-007 and FLOW-09 still say eligible captures "count as confirmed" before the FIN-026 write.
- CAP-012 introduces an automatic transfer link that sits outside the FIN-026 contract.
- SET-005 redaction is not reflected in SEC-005 or CAP-001.
- FIN-014 retention contradicts DEC-24 and the status-mapping paragraph.
- BDG-008 contradicts the GOAL acceptance on whether Free to use can go negative.

None of these blocks UX work. Fix the CAP-007/CAP-012 contract text and the Savings definition before `bmad-architecture` freezes the schema.

## Decision-readiness — strong

The decision register (§2, DEC-01..33) is still the strongest section. Each row gives a baseline, a reason, what was given up and what it supersedes. DEC-22 now states the always-write model plainly, and DEC-33 defines the pay cycle down to the early-salary rule. The approval status is now consistent everywhere:
- the header says "Final (frozen at v1.3.2 …)";
- §0 says "frozen v1.3 PRD";
- §20 M0 says "PRD approved and frozen (this version)";
- §25 ticks owner acceptance.

§24 keeps named gates with solo-review substitutes. §20 moves GATE-02 to M1, adds a two-package fallback with a backup→restore migration path, and runs the betas on a Play closed track that also satisfies GATE-13. The one weak spot is that GATE-02 now has two deadlines, and no default if Google does not answer within the five-day M1 window.

### Findings

- **[medium]** GATE-02 has two deadlines and no default if it cannot be resolved in M1 (§20 M1, §24 GATE-02, SMS-016).
  - §20 M1 (2026-11-03 → 11-07) says "resolve GATE-02 … before choosing the application ID and flavor structure", and GATE-02 says "before the application ID is chosen (M1)".
  - SMS-016 still says "GATE-02 must confirm before M3".
  - The answer depends on Play policy interpretation, which is outside the developer's control, while M1 is five working days that also hold the ledger, encryption, migration and pipeline spikes.

  *Fix:* Change SMS-016 to "before M1 (GATE-02)". Add a default to GATE-02: "If not confirmed by end of M1, choose the two-package structure (distinct application IDs) so no later migration is forced."
- **[low]** "Absorbed by the staged rollout" still overstates what §20 offers (§4.1 last line; §24.1 impact notes for v1.3, note 2). This was unchanged from the v1.3.0 review. Schedule pressure actually moves the undated M3–M5, which §20 states honestly. *Fix:* "Schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope."

## Substance over theater — strong

The content stays product-specific and load-bearing:
- SMS header normalization with concrete examples (`VM-HDFCBK-S` → `HDFCBK`, SMS-010);
- the per-(sender, mask) balance chain that excludes "Avl Lmt" (SMS-012);
- the tip tolerance of "0–30% above the receipt total" (FIN-027);
- the capture inbox before first unlock (SEC-001);
- "release build does not declare the `INTERNET` permission" (SEC-002), which is a structural guarantee rather than a promise;
- the §16.3 reference-set protocol, with retention and deletion numbers.

Success metrics now measure the *correct* outcome ("correct amount, account and category after zero or one tap"), and the learning metric has a threshold ("fall by ≥ 30% from week 1 to week 3"). There are five personas, but each drives named flows.

### Findings

- **[low]** A few adjective bounds remain:
  - NFR-06 "UI animation aims 60 FPS" and NFR-19 "keep 60 FPS scrolling" have no tolerance, unlike NFR-07's "≥ 95% of frames".
  - OCR-001 says "compress safely" and OCR-007 says "fails gracefully".
  - §6.6 says the fallback "must look intentional, not degraded".

  *Fix:* Reuse the NFR-07 form for NFR-06 and NFR-19. For OCR-001, state the maximum dimension and quality. For OCR-007, state "manual entry offered within one tap; image kept".

## Strategic coherence — adequate

The thesis is coherent: private, offline, correct, visual, effortless capture, with 50/30/20 as the mark. The v1.3.1 fixes made the two promised numbers arithmetically sound:
- §6.3 subtracts Not classified spending from the hero, and the HOM acceptance checks it: "₹12,000 with 'includes ₹3,000 not classified'".
- BDG-009 counts each savings transfer once and nets withdrawals.

What holds this dimension at *adequate* is that the Savings bar's *definition* does not fit how the primary 50/30/20 protagonist (Arjun, Pune) keeps his money. On Plan, that same user is told to "Set a limit" although he has set one.

### Findings

- **[high]** The Savings bar measures the wrong thing for Indian users (ACC-009, BDG-009, DEC-30, FIN-010, CAT-006, §4.3, SCR-18).
  - ACC-009 invites users to mark "a savings or deposit account". In India the ordinary salary and transaction account is called a savings account (SB A/c), so the natural choice is to mark the everyday account.
  - BDG-009 then makes Savings "transfers in minus transfers out … can go below zero". Every card-bill payment (ACC-007), ATM withdrawal (FIN-013, CAP-012) and wallet top-up from that account is a transfer out, so Arjun's Savings bar sits deeply negative every month. Salary landing in that account is income, not a transfer, so it never counts.
  - The common Indian saving channels (SIP, RD, PPF, insurance) cannot be modelled as transfers. FIN-010 has no investment or deposit account type, and investment tracking is Phase 3 (§4.3). They therefore post as expenses, inflate Needs, Wants or Not classified, and reduce "Left in budget".
  - SCR-18 still lists a category type "need/want/savings", which contradicts CAT-006 ("Saving is never an expense category"). This shows the model is unsettled.

  The result is that the brand-mark figure is wrong for the persona it is built for.
  *Fix:* Pick one.
  - Option (a): add an asset account kind "Savings & investments" (balance optional, "balance not set" allowed). SIP/RD debits become transfers into it, and ACC-009 copy steers users away from marking their everyday account ("Don't mark the account your salary lands in").
  - Option (b): when no account is marked, define Savings as income − (needs + wants + not classified), the cash-flow residual, and label the source.

  Either way, remove "savings" from SCR-18, and add an acceptance case: "salary account not marked; ₹42,000 card bill paid from it → Savings unchanged".
- **[medium]** Free to use tells a 50/30/20-only user to "Set a limit" (BDG-008 and its acceptance, §6.3 #2, HOM acceptance).
  - The BDG acceptance says: with "no overall budget, … Free to use shows 'not enough information yet — Set a limit'".
  - §6.3 gives the same 50/30/20-only user a real "Left in budget" figure, (Needs + Wants targets) − spending.
  - BDG-008's `budget_remaining` is never defined for this setup, so Home and Plan disagree about whether a limit exists. This is Arjun's main flow (FLOW-14).

  *Fix:* Define `budget_remaining` in BDG-008 as "the hero's Left in budget (§6.3), including the 50/30/20-only form". Limit the "Set a limit" case to "no overall budget and no 50/30/20".

## Done-ness clarity — adequate

This dimension improved again. Every §8 module now has Given/When/Then acceptance, so the §25 claim is true. The v1.3.0 high findings are closed:
- TXN-012 is now `needs_review` + `possible_duplicate`, has its own status-mapping row and its own acceptance case.
- ONB, ACC, TXN and BDG carry worked GWT cases (₹80,000 → 40,000/24,000/16,000; Pay card bill; Adjust balance; the cross-period refund).
- FIN-026 gives a six-step contract, including versioned rules and a clock guard.

Being unforgiving, though: the latest fixes left contradictions in the text around them. Several v1.3.1/1.3.2 requirements also have no acceptance case at all.

### Findings

- **[medium]** CAP-007 and FLOW-09 still describe read-time auto-approval, which contradicts FIN-026 (2) (CAP-007, FLOW-09, FIN-026, DEC-22).
  - FIN-026 (2): "Auto-approval is **always a write, never derived on read** … stay `needs_review` — 'Waiting for you' on every surface … until they are written".
  - CAP-007 still says eligible captures pending after the cutoff "**count as confirmed** and are materialized per FIN-026, **so nothing depends on a background job running**".
  - FLOW-09 says "eligible ignored items count as confirmed after the cutoff".

  An agent building from CAP-007, the capture epic's own requirement, can rebuild the derived model that v1.3.1 removed, with the widget/Home mismatch it caused.
  *Fix:* Change CAP-007 to "…are written as confirmed (`auto_approved`) per FIN-026, by a best-effort background job or the next app open; until then they are Waiting for you". Change FLOW-09 to "…are written as confirmed after the cutoff (FIN-026)".
- **[medium]** CAP-012 auto-links transfers outside the FIN-026 contract (CAP-012, CAP acceptance, CAP-007, FIN-024, FIN-026 (3), §11 `capture_resolution`).
  - CAP-012 says transfer-like captures "are never auto-approved … when both sides are known they are linked as a transfer". The CAP acceptance has this happen "when 21:00 passes … it is linked as a card payment if the card account exists".
  - That is an automatic financial write, but CAP-007 excludes transfer-like captures from auto-approve. FIN-026 covers only eligible captures, and `capture_resolution` has no value for it (`user_approved | auto_approved | rejected`).
  - Nothing says when the link happens (on arrival or at the cutoff), whether the clock guard and audit row apply, or how the user sees it. The trigger is text matching ("bill payment to a card"), which is error-prone, so the case needs a visible, reversible state.

  *Fix:* Either make auto-linking a FIN-026 write ("at the cutoff, transfer-like captures whose both sides are known are written as a confirmed transfer with `capture_resolution = auto_linked` and an audit row; label 'Recorded · linked as transfer'"), or require the user's tap. Add the value to §11 and the status-mapping table.
- **[medium]** Auto-approval of credits with no learned type is undefined (CAP-007, CAP-004, CAT-006, FIN-028, INS-016).
  - CAP-007 allows any direction and confirms an uncategorised capture "as 'Uncategorised' with the `needs_category` flag". Uncategorised is an *expense* category (CAT-006).
  - For a credit from a verified sender (salary, refund, money from a person) with no learned type, the PRD does not say whether it becomes income, a refund or a transfer. Income inflates "Kept N%"; FIN-028 says a refund is never income.
  - The v1.3.0 adversarial review (C1) asked for "any credit without a learned type" to be ineligible. Only the transfer-like part was adopted.

  *Fix:* Add to CAP-007: "a credit is eligible only when its income type (CAP-004) is learned for that payer; otherwise it waits". Add a CAP acceptance case.
- **[medium]** App-lock notification redaction is stated in only one of the three places that govern it (SET-005, SEC-005, CAP-001, SEC acceptance).
  - SET-005 (v1.3.2): "With app lock on, capture notifications use the redacted public version (no amount or merchant) even on an unlocked device unless the user opts in". Hide amounts also applies to notifications.
  - SEC-005 still says the full details show "only when the device is unlocked", with no app-lock or hide-amounts exception.
  - CAP-001 still lets Approve/Reject run from the shade "without unlocking (it … reveals nothing new)". On a redacted notification that is a blind approval of an amount the user never saw.
  - No acceptance case covers notifications under app lock or under hide-amounts.

  *Fix:* Restate the rule once in SEC-005 and reference it from CAP-001 and SET-005. Decide whether a redacted notification shows Approve/Reject at all (recommended: only "Review", which requires unlock). Add GWT cases for an unlocked device with app lock on, and for hide-amounts on.
- **[medium]** Free to use and goal over-assignment contradict each other (BDG-008, GOAL-004, GOAL acceptance 4).
  - BDG-008's formula is `max(0, min(…))`, so Free to use is never negative.
  - The GOAL acceptance says the app "shows Free to use honestly (it may be negative)".
  - GOAL-004 says "the same set-aside amount cannot be assigned to two goals", but the acceptance lets the user do it with a warning.

  *Fix:* Pick one: either floor at 0 and block the second set-aside, or allow it and show a negative figure. Align BDG-008, GOAL-004 and the acceptance.
- **[medium]** The v1.3.2 retention rule contradicts older text and has no acceptance (FIN-014, DEC-24, FIN-024, the §7.3 paragraph after the status mapping, CAP-008, FLOW-18, SEC-008).
  - FIN-014 now purges soft-deleted manual entries after 30 days and rejected captures after 90 days, adds Delete permanently, and says "purges propagate to the next backup".
  - DEC-24, FIN-024 and CAP-008 still promise rejected captures "can be re-approved later" with no time limit.
  - The paragraph after the status mapping says a deleted manual entry "keeps its audit row and **backup copy**".
  - No GWT case covers the purge, the "Show rejected" behavior at day 91, or Delete permanently on an item that is part of a transfer or refund link.

  *Fix:* Add "(for 90 days, FIN-014)" to DEC-24, FIN-024 and CAP-008. Change "backup copy" to "copy in backups made before the purge". Add acceptance cases: "rejected capture at day 91 is gone from Show rejected"; "Delete permanently on a linked transfer removes both legs after confirmation" (or blocks it).
- **[medium]** Many v1.3.1/1.3.2 additions have no GWT case. §22.1 makes such stories not Ready. These requirements are covered only as §16.1 suite keywords or not at all:
  - CAP-009 account discovery: the type pre-select, "available limit never used as a balance", and the (sender, mask) keying.
  - CAP-012 debit choices: Moved to my own account and Cash withdrawal.
  - FIN-002 cross-zone prompt and DST behavior.
  - FIN-026 (6) clock guard.
  - FIN-027 Merge outcome.
  - IMP-001 encodings and decimal commas; IMP-002 flip sign and transfer-pair proposal; IMP-005 resume after interruption.
  - BDG-007 "effective now vs next period"; BDG-008 with the gate passing (a computed number); the BDG-009 >10% income update offer.
  - §13.2 dismissed UPI share dialog becoming pending and auto-approvable.
  - DEC-33 early-salary rule.

  *Fix:* Add one GWT case for each, using the module's existing style. The worked numbers already exist in the requirement text.
- **[low]** INS-001 still diverges from §6.5. It says "Presets as in §6.5" but then lists them again without "Yesterday" and with "Quarter, Year" instead of "This quarter, This year". *Fix:* Drop the restated list and leave only "Presets as in §6.5".
- **[low]** The word "unallocated" still conflicts with "Not itemised" (FIN-022, OCR-005 vs TXN-009).
  - TXN-009 now says "A receipt's 'Not itemised' amount is not unallocated: it is a split row to the seeded Uncategorised category".
  - FIN-022 still says "Missing OCR items are handled by explicit *unallocated amount*", and OCR-005 says "unallocated discrepancy is explicit".
  - FIN-022 is the invariant source that GATE-07 checks fixtures against.

  *Fix:* In FIN-022 and OCR-005, write "a 'Not itemised' split row (TXN-009)".

## Scope honesty — strong

Scope is explicit throughout:
- §4.1 says "no ranked cut list".
- §13.0a and §13.2 now state per-market capture behavior. Outside India there are "no capture notifications, grouping, evening summary or auto-approve". This closes the v1.3.0 low finding.
- The feature-gating rule is single and explicit: "build supports it **and** the profile region is India".
- The currency list is extended to match the market claims.
- §16.3 limits real reference data.
- The one `[ASSUMPTION]` (SMS-016) is tied to GATE-02 and its fallback.

Open-item density stays low and is appropriate for a green-light PRD.

### Findings

- **[low]** REC-007 and REC-008 still have no phase and no screen (§8.6, §5.2, REC-005, INS-022).
  - REC-007 "reject suggestions" only makes sense with REC-005 inference, which is Phase 2.
  - REC-008's "Subscription page" has no SCR entry, and INS-022 (Subscription timeline) is P2.

  This was unchanged from the v1.3.0 review. *Fix:* Tag REC-007 as P2. Either tag REC-008 as P2 or fold it into SCR-16 with a P1 scope sentence.
- **[low]** GATE-05 still requires "iOS/Android parity" as Phase 1 evidence (§24), although iOS OCR is Phase 2 (DEC-10). *Fix:* Mark that part "(Phase 2)".
- **[low]** The dismissed-UPI-dialog rule is scoped inconsistently (§13.2 CAP row, SCR-29 row).
  - "A share dialog the user dismisses without saving becomes a pending capture … eligible for auto-approve" is stated only for the India **no-SMS** build. The SMS build's behavior is unstated.
  - In the same table, the other-markets text says the widget shows "N to check" only for review items such as import duplicates, while the SCR-29 row says the "pending count reflects UPI/receipt captures".
  - Treating a dismissal as implicit approval at 21:00 is a product choice that deserves a line in DEC-22.

  *Fix:* Move the dismissal rule into UPI-003 or CAP-007 so it applies to both India builds. Make the SCR-29 row market-specific.

## Downstream usability — adequate

This PRD feeds UX, architecture and stories, and most of it extracts cleanly:
- the status-mapping table now has the "manual possible duplicate" row;
- §11 gained `refund_of_transaction_id`, `auto_approve_rule` history, `budget_alert_fired`, `capture_inbox`, `account_identifier` keyed by (sender, mask), `balance_chain`, goal name/icon/color, account icon/color/savings/credit fields, and many-to-one provenance;
- RB0/RB1 replaces the P0/P1 collision;
- §16.1 marks the iOS cases as P2;
- the glass fallback names Android signals.

The remaining problems are data-model gaps behind the newest FRs, and a stale-text tail that crosses the PRD and the addendum.

### Findings

- **[medium]** The §11 data model has gaps against the v1.3.x FRs:
  - **Retention (FIN-014):** there is no `excluded_at` or `deleted_at`, so the 30-day and 90-day purges cannot be computed reliably from `updated_at`. A manual **Delete** and a review-queue **exclude** of an import row are both `excluded` with no `capture_resolution`, yet one is "hidden everywhere including Show rejected" and the other is not defined. *Add* `removed_at` and `removal_kind[deleted|rejected|excluded]`.
  - **CAP-012 auto-link:** there is no `capture_resolution` value for it (see Done-ness).
  - **Duplicate auto-approve settings:** `profile.auto_approve_enabled / auto_approve_cutoff_local / auto_approve_rule_effective_from` duplicate the versioned `auto_approve_rule` table and will drift. *Keep* only the table.
  - **`transaction.before_tracking_started` is stored**, but FIN-016 makes it derivable from `opening_effective_at`, which ACC-002 lets the user edit. *Mark* it as derived.
  - **`account` has no `sort_order`** (ACC-001 reorder).
  - **`import_batch` has no `raw_path?` or `retain_until?`** (IMP-006, 30-day default).
  - **`recurring_rule` has no `kind`** (REC-007 subscription / rent / EMI).
  - **Goal links run both ways:** `transaction.goal_id?` and `goal_allocation.transaction_id?` both exist. *Pick one.*
  - **Clock guard (FIN-026 (6)):** it relies on "elapsed time since boot" but stores only `last_materialized_at`. State what is stored across reboots.
- **[low]** The stale-text sweep is incomplete:
  - DEC-21 still lists automated captures as "(SMS, bill match)", omitting UPI share and receipt match.
  - §13.2 says "SMS-001..016 … Absent" (SMS-017 exists) and "LRN-001..007 Present" (LRN-008/009 exist).
  - FIN-025 says "per LRN-001–LRN-006".
  - FLOW-17 says "amount = outstanding" but ACC-007 says the statement due when entered.
  - FLOW-15 says "*Add it*: bank account created" but CAP-009 pre-selects card or account.
  - Appendix A #2 says "attach/create/exclude" but OCR-010 says Attach to it / Keep separate / Discard.
  - The glossary says "Mixed merchant: assigned 2+ categories" but LRN-003 says "within its last 5 confirmations".
  - The glossary's "Left in budget" omits the 50/30/20-only formula.
  - "v1" still means the release in §3.3 ("permitted in v1"), §14, §19 ("release 1"), §20 ("approved PRD v1 requirements") and §23.
  - §5.3 says "dynamic island".
  - The currency row in the §13.0a market table lists only the original 13 codes, but the currency list below it has 23.
  - In the addendum:
    - §3 widget still reads "● count", but HOM-007 says "N to check" text;
    - §2 still says "within N minutes", but FIN-027 sets ±1 day;
    - the §3 status vocabulary lacks "Recorded · needs a category";
    - the receipt match omits Discard.

  The PRD wins on conflict, but the 1.3.2 change log claims the widget fix. *Fix:* One sweep across the PRD and the addendum.

## Shape fit — strong

This is a consumer product at the top of a UX → architecture → stories chain, and it has the matching formality:
- named-protagonist flows;
- a screen inventory;
- traceable IDs;
- a test-traceability format (§16.4);
- Definition of Ready and Done;
- a reference-set protocol.

Technology candidates and UX detail stay in `addendum.md` under "the PRD wins on any conflict". Nothing is over-formalized for a solo build, because the chain-top role justifies the rigor.

No findings.

## Resolved since v1.3.0

**From `review-rubric-v1.3.0.md` (high and medium):**
- **Resolved:**
  - Savings double-count (BDG-009 "counted once, as that transfer"; GOAL acceptance "₹5,000 (not ₹10,000)"; netting defined). The definition problem above is new.
  - The hero ignoring Not classified (§6.3 formula plus the HOM acceptance case).
  - TXN-012 confirmed + `possible_duplicate` (now `needs_review`, with a mapping row and an acceptance case).
  - The §25 Given/When/Then claim at module level (ONB, ACC, TXN and BDG now have GWT). Coverage of the newest requirements is the new medium above.
  - Widget count vs app during the auto-approve window (always-write model). Stale CAP-007/FLOW-09 wording remains.
  - Approval status contradiction.
  - Outside-India capture scope (§13.2).
- **Partly resolved:**
  - INS-001 presets (pay cycle added; Yesterday still missing).
  - App lock vs notifications (SET-005 decided; SEC-005 and CAP-001 not aligned).
  - §11 data model (many fields added; gaps listed above).
  - Stale-text sweep (Home cards, hide-amounts, PLAT P2 and DEC-23 fixed; the rest are listed above).
- **Still open (low):** §4.1 "staged rollout" wording; REC-007/008 phase; GATE-05 iOS parity; NFR-06/19 and OCR-001/007 adjectives; ID listing order.

**From `review-adversarial-general-v1.3.0.md` (critical and high):**
- **Resolved:**
  - C2 Savings double count.
  - C3 read-time auto-approve: FIN-026 adds the always-write rule, the profile-timezone cutoff, versioned rules, the clock guard and the duplicate rule. Stale CAP-007 text remains.
  - C4 manual duplicate.
  - C5 hero and Not classified.
  - H1 timezone (FIN-002).
  - H2 match windows and Merge (FIN-027).
  - H3 reference + direction key (FIN-027, UPI-005).
  - H4 learning only from user actions (LRN-008).
  - H5 per-(sender, mask) chain, card limits, identifier keying.
  - H6 DLT normalization (SMS-010).
  - H7 no `INTERNET` permission plus GATE-05 offline evidence.
  - H8 reference-set protocol (§16.3).
  - H9 capture inbox (SEC-001).
  - H10 one overall budget on the default period (BDG-002).
  - H11 refunds (FIN-028, FIN-021, `refund_of_transaction_id`).
  - H12 OCR quality floor, tax pro-rata, tip tolerance (OCR-005, FIN-027).
  - H13 auto-approve never links bills (FIN-026 (3)).
  - H14 currency list, region pre-select, gating rule (§13.0a).
  - H15 OCR-010 wording. Appendix A residue remains.
- **Partly resolved:**
  - C1 card-bill/ATM auto-approval: CAP-012 and the CAP-007 exclusion cover debits. Credits without a learned type are still eligible, and the CAP-012 auto-link write is unspecified.
  - H16 Play package: GATE-02 moved to M1 with a fallback, but SMS-016 still says M3 and there is no default if the gate is unresolved.

## Mechanical notes

- **ID continuity:** IDs are unique and the references checked resolve (including §16.3 reference-set and §16.4 traceability). Listing order is still out of sequence. Either reorder, or add one line under §0: "IDs are stable; new IDs are appended next to related items."
  - FIN-016 before FIN-011, and FIN-026/027/028 before FIN-025 (§7.2–7.3).
  - TXN-012/013 before TXN-009.
  - CAP-012 between CAP-004 and CAP-005.
  - REC-009/010 before REC-008.
  - HOM-008 before HOM-007.
  - INS-007 before INS-005; INS-008/009 do not exist.
  - SCR-27..31 before SCR-25/26.
  - WMB-16..18 before WMB-13.
- **Source legend:** `[v1.3]` is now defined in §0. This is resolved.
- **DEC-23:** the stale cross-reference is fixed ("now specified in LRN-001–009"). FIN-025 still points to LRN-001–006.
- **§6.3 near-duplicate sentence:** "Each card has a clear period label." is followed directly by "Each card supports tap-to-details … and a clear period label."
- **Release labels:** RB0/RB1 in §16.2 resolve the P0/P1 collision. DEC-22 correctly references "RB0".
- **Glossary (§10) gaps:** still no entries for auto-approve or daily cutoff, Not classified, Not itemised, `needs_category`, savings account (ACC-009), Savings share, or Kept. "Mixed merchant" and "Left in budget" are stale (see Downstream).
- **Change log:** there is still no 1.0.0 baseline row, although the numbering note names one. The 1.3.1 and 1.3.2 rows are thorough. The 1.3.1 "Decisions affected" column omits CAP-012's effect on FIN-024 and the status mapping.
- **Assumptions Index:** none. There is one inline `[ASSUMPTION]` (SMS-016), and it round-trips to GATE-02 and §25. That is acceptable at this density, but its "before M3" deadline conflicts with GATE-02 (see Decision-readiness).
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. There is still no non-India flow for a receipt match against an imported CSV row, which the receipt-first markets rely on.
- **Required sections:** all present for a chain-top consumer PRD.
