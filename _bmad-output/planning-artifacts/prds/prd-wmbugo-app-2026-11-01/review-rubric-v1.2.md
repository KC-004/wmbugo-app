# PRD Quality Review — wmbugo IDEA PRD (v1.2.0-draft)

Reviewed: `input/docs/Idea_prd.md` (full document, §0 to Appendix C). No addendum. Review date: 2026-11-01.

## Overall verdict

The core of this PRD is unusually strong. The financial model (§7), the decision register (§2), the named external gates (§24) and the superseded-source list (§23.1) make it decision-ready and correctness-focused in a way most consumer PRDs are not. The risk is in the v1.1/v1.2 edits. The "effortless capture" layer (DEC-21..25, CAP, LRN, SMS-010..014, OCR-009..013) was added as new sections, but the rest of the document was not updated to match. End-of-day auto-approve conflicts with the PRD's own duplicate-counting P0 and "unconfirmed" rules. §11 data model, §13 parity matrix, §4.1 scope list, §3.3 success metrics and §16.2 release criteria do not reflect the new features. "MVP" now quietly means "Phase 1 Android" without saying what iOS gets. Fix the critical auto-approve finding and the five high findings before UX, architecture or story work starts. Most of the fixes are bounded edits, not rethinks.

## Decision-readiness — adequate

The decision register (§2) is the PRD's best asset. Each default has a baseline, a reason or trade-off, and a status, and the v1.1/v1.2 entries say what they supersede (e.g. DEC-01 "supersedes simultaneous launch", DEC-23 "supersedes 'explicit rules only'"). External gates (§24, GATE-01..11) have owner roles and required evidence. The v1.1 impact note honestly states that GATE-02 and GATE-05 "now sit on the Phase 1 critical path". The §8.11 delivery-risk callout names itemized OCR as the first fast-follow candidate. That is the kind of honest de-scoping plan a decision-maker needs.

What it dodges is the tension that v1.2 introduces. DEC-22's reason says "Capture the expense first; reconciliation is secondary". That directly reverses §6.1 principle 4 ("Correctness over delight"), the §7.4 integrity rules and the first P0 in §16.2 ("No known … duplicate confirmed counting"). The PRD never acknowledges the reversal. It also does not decide what the Phase 1 capture experience is if GATE-02 fails: DEC-07 ships "the no-SMS variant", but most of CAP and LRN, SCR-24/27 and FLOW-09 assume SMS. Neither tension has a `[NOTE FOR PM]` or an open question.

### Findings
- **[critical]** End-of-day auto-approve can post duplicate and unverified captures as confirmed, breaking the PRD's own P0 (DEC-22, CAP-007, OCR-011, FIN-024, SMS-003, SMS-005, §7.4, §16.2). CAP-007 excludes from auto-approve only "captures flagged by SMS-011/SMS-012". It does not exclude captures that SMS-005 marks as "ambiguous matches", items carrying the `possible_duplicate` flag (FIN-024), or captures with "unknown parsed values", which SMS-003 says "remain unconfirmed". So an SMS debit for an expense the user already entered manually, or one that matches a scanned bill that OCR-011 "recorded directly as an expense", can be auto-confirmed at end of day as a second expense. OCR-011 also posts unmatched bills directly, with no Approve/Reject. That contradicts DEC-21 ("Approve / Reject is the single interaction for every automated capture") and FLOW-08 ("verify reconciliation → confirm"). DEC-22 also says "verified senders" while CAP-007 says "Unactioned captures", so the scope of auto-approve differs between the two. *Fix:* Add a normative rule to CAP-007: auto-approve applies only to captures from verified senders (as defined in SMS-010) that have no `possible_duplicate` flag, no open review candidate, a fully parsed amount, account and direction, and a non-null category. Everything else stays `needs_review`. Make OCR-011 create a `needs_review` capture with an Approve prompt, or document it as an explicit DEC-21 exception. Add a §7.4 invariant and a §16.2 P0: "Auto-approve never confirms a capture that matches an existing confirmed transaction." Add a `[NOTE FOR PM]` under DEC-22 recording that it trades away the "Correctness over delight" principle, and what limits that trade.
- **[high]** The Phase 1 no-SMS variant's capture experience is undefined (DEC-07, §4.1, CAP, LRN, SCR-24/27, FLOW-09, §1.3 #4). If Play approval is not granted, the headline differentiator "automatic on-device SMS and bill capture" shrinks to OCR plus manual entry. The PRD does not say which CAP items (notification, floating dialog, grouping, auto-approve), LRN items and screens ship in that variant, or whether SMS-014's re-ask card is suppressed. *Fix:* Add a short "No-SMS variant" subsection under §8.16 or §13.1 with a table that marks each CAP, LRN and SCR item as present, adapted (for OCR-only captures) or absent. Add one line to §1.3 #4 stating that the differentiator depends on GATE-02.

## Substance over theater — adequate

Most content is earned. The FIN invariants, the INS formulas (INS-015/016 with zero-baseline handling), BDG-008's safe-to-spend formula and §13.2's "No-network claim boundary" are specific to this product and drive behaviour. The NFRs mostly have thresholds (NFR-03..05, NFR-07, NFR-08). The differentiators in §1.3 are backed by requirements.

There is some furniture. §3.1 lists five personas, and none is cited by any decision, flow, FR or metric. §22.1 requires "persona/value" for every story, but the personas give stories nothing to trace to. A few NFRs are adjectives: NFR-06 "aims 60 FPS", NFR-07 "acceptable list scrolling", NFR-11 "appropriate hit target behavior". The vision statement (§1.1) is specific enough: the "without surrendering financial data to a cloud service" clause sets it apart in its category.

### Findings
- **[medium]** Personas don't drive anything (§3.1, §9, §22.1). There are five personas and no persona-to-decision or persona-to-flow links. The "Busy digital spender" is plainly the protagonist of v1.2, but is never named in it. *Fix:* Cut to three or four personas and tag each FLOW and each DEC-21..25 with the persona it serves, or drop the persona element from the §22.1 Definition of Ready.
- **[low]** Some NFRs are adjectives (NFR-06, NFR-07, NFR-11). *Fix:* Replace them with bounds, e.g. "≤1% dropped frames over a 10k-row fling on the reference device", "48dp/44pt minimum target" (already in §6.2, so reference it), and "p95 frame time ≤16.7ms for list scroll".

## Strategic coherence — adequate

There is a clear thesis: private, offline, correct and visual. v1.2 adds a fifth leg, "effortless capture", which follows from §1.2 problem 1 ("Logging every transaction manually is tedious"). Phasing follows the thesis, and the epic sequencing constraint ("ledger/correctness precedes auto-capture", §21) is principled.

The measurement side has not kept up. §3.3 measures onboarding, manual entry speed, invariants, offline use, stability, accessibility and comprehension. Nothing validates the capture thesis, and there are no counter-metrics. The v1.2 impact note says auto-approve "changes the trust model — usability study must confirm users understand auto-approved entries", but that never reaches §3.3 or §16.2's P1 usability criterion. Phase 1 is also no longer a minimum: it now holds the full old MVP plus OCR with itemization, SMS, capture review, learning and a home-screen widget, with only one item (OCR-012) named as a cut candidate.

### Findings
- **[high]** Success metrics and release criteria don't measure effortless capture or its risks (§3.3, §16.2, §24.1 v1.2 impact note 1). *Fix:* Add to §3.3, measured through usability studies or the synthetic fixture corpus to respect the no-telemetry rule:
  - share of captures resolved with zero or one tap
  - category-correction rate falling over a multi-week diary study
  - SMS parse precision and recall on a synthetic Indian bank/UPI SMS corpus
  - OCR total/merchant/date extraction accuracy on a reference bill set

  Add counter-metrics:
  - wrong-category auto-approvals
  - scam-filter false positives on genuine bank SMS
  - users disabling capture notifications

  Add "auto-approved entries understood (≥90%)" to the §16.2 P1 usability line.
- **[medium]** Phase 1 has no ordered cut list beyond OCR-012 (§4.1, §8.11 delivery-risk note, §20 M6, WMB-16). The scope grew twice in one day and the milestones were not re-baselined. M6 still reads "on-device receipt OCR and Android SMS" and does not mention WMB-16's capture review, learning and home-screen widget. *Fix:* Add a ranked fast-follow list to §4.1 (e.g. OCR-012 itemization → LRN-004 item learning → CAP-005 batch "Apply to all similar" → HOM-007 widget) and add WMB-16 to M6.

## Done-ness clarity — thin

The ledger FRs are excellent: FIN-022 exact-paise reconciliation, BDG-008 formula, INS-015 baseline rule, the §7.4 acceptance rules and Appendix A's Given/When/Then contract. Most modules end with an **Acceptance** line. The v1.2 capture rules are a different matter. They introduce terms with no definition and heuristics that contradict other FRs, and they have no accuracy or latency bounds. Those are exactly the FRs downstream story creation will lean on hardest. CAP, LRN, OCR, SMS, REC, INS and SET have no **Acceptance** line at all (only ONB, ACC, TXN and BDG do).

### Findings
- **[high]** Capture rules have undefined terms and self-contradicting heuristics (DEC-22, SMS-010, SMS-011, SMS-012, CAP-007, LRN-003):
  - (a) "Verified sender" (DEC-22) and "unverified sender" (SMS-011) are never defined. SMS-010 already drops everything except "registered alphanumeric bank/UPI sender headers", so it is unclear what an *unverified* credit is. There is no stated sender allow-list source or update mechanism.
  - (b) SMS-011 treats "claim/refund/KYC/prize wording" as scam, but SMS-003 requires parsing genuine "refund" SMS, so legitimate refunds would be suppressed.
  - (c) SMS-012 flags any balance-chain mismatch. Gaps are routine (missed SMS, non-SMS debits, multiple cards on one account) and no tolerance or reset rule is given.
  - (d) "End of day … configurable time" (DEC-22, CAP-007) has no execution guarantee, while §25 forbids "mandatory always-running background services" and REC-003 disclaims exact-time delivery. The PRD does not say what happens if the job does not run.
  - (e) The PRD does not say which category an auto-approved unknown merchant gets.

  *Fix:* Add a glossary entry for verified sender, with a defined source such as a bundled DLT-header allow-list plus user-confirmed senders. Narrow SMS-011 to link plus claim/KYC/prize wording, or to credit plus non-allow-listed sender, and add a "genuine refund SMS is not flagged" test to §16.1 SMS. Give SMS-012 a reset rule (one mismatch resets the chain and flags only on large unexplained gaps). Define auto-approve as "best effort; on next app open any overdue pending captures are processed", and default unknown-merchant auto-approvals to "Uncategorized" in needs-categorization state.
- **[medium]** Capture has no accuracy or latency bounds (NFR table §12, SMS-003, OCR-004). The only capture NFR is OCR latency (NFR-08). There is no target for SMS-arrival-to-notification latency, SMS parse accuracy, OCR field accuracy, or battery and background budget. *Fix:* Add NFR-16..19: SMS→notification p95 (e.g. ≤5s when the process is alive), parse precision and recall on the fixture corpus, OCR total-field accuracy on a reference bill set, and a background CPU/battery budget verified on the GATE-03 device matrix.
- **[medium]** LRN-003's mixed-merchant trigger is fragile and cannot be undone (LRN-003, LRN-005). "Two or more different categories" means one mis-tap permanently turns off auto-categorization for that merchant. Neither a recovery path nor a threshold is specified. *Fix:* Define the trigger over the last N confirmations (e.g. 2 different categories within the last 5), and let users clear the mixed flag in SCR-28.
- **[low]** Vague phrasing remains in older FRs: "sensible categories" (CAT-001), "recalculating carefully" (BDG-007), "Detect monthly calendar patterns carefully" (REC-006), "reasonable frequency caps" (SET-003), "fails gracefully" (OCR-007), "compress safely" (OCR-001). *Fix:* Replace each with a checkable rule or a test reference, e.g. REC-006 → "Jan 31 monthly → Feb 28/29 → Mar 31".
- **[low]** Only four modules have **Acceptance** lines (ONB, ACC, TXN, BDG). *Fix:* Add one Acceptance line each to CAP, LRN, SMS and OCR. The §16.1 CAP/LRN suite rows are a good starting point.

## Scope honesty — adequate

Out-of-scope (§4.4) and Phase 3 (§4.3) are explicit, and DEC-06/DEC-13 de-scope honestly. §19's rule that Phase 1-free features "must not be retroactively paywalled without a product decision entry" is a good guardrail. The PRD uses named gates instead of `[ASSUMPTION]` tags, which suits a document at this stage. Open-item density is acceptable for a build-input PRD, because the gates carry owners.

The weakness is silent omission after the edits. §4.1 "MVP / Phase 1" was not updated for v1.2: CAP, LRN, the floating dialog, the home-screen widget and lock-screen approve are missing from the scope list, even though they are in §5.2 and §21. The v1.2 impact note lists items deferred to "Later, not Phase 1" (stop notifying consistent merchants, weekly privacy log), but they appear in no phase list.

### Findings
- **[high]** The §4.1 Phase 1 scope list omits every v1.2 feature (§4.1 versus §8.16, §8.17, HOM-007, SCR-27..29, WMB-16; §24.1 v1.2 "Decisions affected" omits §4). Anyone reading §4 as the scope contract would leave out the headline differentiator. *Fix:* Add §4.1 bullets for Approve/Reject capture review with floating dialog, end-of-day auto-approve, local learning (merchant, UPI ID, item), rejected-capture retention, the Android home-screen widget and lock-screen approve (opt-in). Add the two "Later" items from the v1.2 impact note to §4.2, and add §4 to the v1.2 change-log row.
- **[low]** GATE-01 still requires sign-off on "free/premium positioning" for Phase 1 (§24 GATE-01 versus DEC-13, v1.1 impact note 3). *Fix:* Change GATE-01 to "Phase 1 free-only confirmation". Premium positioning belongs to GATE-11.

## Downstream usability — thin

This PRD is chain-top (§0: "single consolidated product input" for UX, architecture and stories), so this dimension matters a lot. Its IDs are disciplined and §16.3 sets a solid traceability format. But architecture will extract §11 and §13, and neither was updated for v1.1 or v1.2. Phase labels mix "MVP", "Phase 1", "MVP Android", "MVP (Android)" and "MVP conditional on Play approval" with no mapping to platforms. Key nouns also collide.

### Findings
- **[high]** The §11 data model is not updated for v1.2, and it already lacked FIN-020 fields (§11.1 versus FIN-020, FIN-024, CAP-007, LRN-001..005, SMS-011..013, OCR-012). There are no entities or fields for:
  - learned merchant, UPI ID and item → category mappings, including the "mixed" flag (LRN-001..004)
  - payee UPI ID and its user-given name (LRN-002)
  - blocked senders (SMS-013, SCR-28)
  - the sender allow-list or verified status
  - per-account last SMS balance for the balance chain (SMS-012)
  - approval provenance (user-approved, auto-approved or rejected), which the evening summary (CAP-007) and the "Show rejected" filter (CAP-008) need
  - receipt line items with name, quantity and price (OCR-012). `split` has only category, amount and memo.
  - scam-suppressed captures, whose persistence is unspecified
  - SMS re-ask counters (SMS-014)

  `transaction` also lacks the `payment_method`, `tags` and source link that FIN-020 requires. `automation_rule` is not marked Phase 2 (SCR-25), so it is ambiguous whether LRN mappings are stored there. *Fix:* Add `learned_mapping(id, key_kind[merchant|upi|item], key, category_id, mixed, confirmations, updated_at)`, `payee(upi_id, display_name)`, `sender(id, header, status[allowed|blocked], last_balance_minor?, account_id?)`, `receipt_item(id, attachment_id, transaction_id, name, qty?, amount_minor, split_id)` and `transaction.capture_resolution[user_approved|auto_approved|rejected]` plus `payment_method` and `tags`. State that `automation_rule` is Phase 2 and LRN does not use it. Add §11 to the v1.2 change-log row.
- **[high]** The parity matrix and iOS scope ignore v1.2, and "MVP" is ambiguous across platforms (§13, NFR-13, §5.2 Stage column, §21 Phase column, §16.2, §25).
  - §13 has no rows for capture notifications with Approve/Reject, the floating dialog, the home-screen widget (iOS WidgetKit or none?), lock-screen approve, local learning, OCR-010 bill-match prompts, or the SMS scam/sender protections. Yet NFR-13 requires a "Clear Android/iOS parity matrix".
  - SCR-28 is "MVP" with no platform, while LRN is "Phase 1" and CAP is "Phase 1 Android". It is unclear whether iOS in Phase 2 gets learning from manual and OCR entries.
  - "MVP" is used as a synonym for "Phase 1" (§4.1 heading "MVP / Phase 1 — Android release (iOS built in parallel)"). So "SCR-xx MVP" could mean "built for both platforms but released on Android only", or it could mean "Android only".

  *Fix:* Retire "MVP" in favour of explicit labels: "Phase 1 (both platforms built; Android release)", "Phase 1 Android-only" and "Phase 2". Apply them to §5.2, the §8.9 table, §21, §16.2 and §25. Add the seven missing rows to §13, each with an iOS behaviour or "N/A + fallback".
- **[medium]** The status model is incomplete for captures (FIN-024, CAP-008, SMS-011, §10 "Review queue" / "Pending capture", HOM-001, SCR-10, SCR-29).
  - "Rejected" maps to `excluded`, but TXN-005 also lets users exclude manual entries. That makes CAP-008's "Show rejected" filter ambiguous: it is unclear whether it shows all excluded items or only rejected captures.
  - Scam-blocked items ("never posted") have no status.
  - Pending captures (`needs_review`) and review-queue items (SCR-10, HOM-001 "review queue") both appear. SCR-29 shows "pending approvals". The PRD does not say whether these are the same set.

  *Fix:* State in FIN-024 that pending captures appear in the review queue and are counted by the SCR-29 badge, or that they do not. Distinguish rejected from user-excluded through the capture-resolution field above. Specify that scam-flagged SMS are not stored, or are stored as a redacted `source_record` with no transaction.
- **[medium]** Notification content contradicts the privacy default (SEC-005 versus CAP-001, SMS-006). SEC-005 says "notifications have privacy-preserving contents by default", with only the lock-screen opt-in as an exception. CAP-001 requires every capture notification to show "amount, direction, merchant, account". It is unclear whether amounts appear in the unlocked notification shade by default. *Fix:* Amend SEC-005 to say that capture notifications show details in the shade but use redacted public versions on the lock screen unless CAP-006 is enabled. Add a §16.1 SEC case for lock-screen redaction.
- **[medium]** Glossary collisions: "bill", "widget", "Scan/Snap". "Bill" means both a payable (REC, "Bills & Recurring", SCR-16) and a receipt ("Snap bill", "bill match", OCR-010..013, DEC-21). "Widget" means both a Home dashboard card (HOM-001..004, SCR-05 "Widget edit") and an Android home-screen widget (HOM-007, SCR-29, DEC-25). The Add sheet says "Scan" (§5.1) while the widget says "Snap bill". *Fix:* Add glossary entries and use one term each: "receipt" for scanned bills, "bill" for payables, "Home card" for dashboard widgets, "home-screen widget" for SCR-29.
- **[medium]** Flows are stale or missing for v1.2 (FLOW-08, FLOW-09, §9). FLOW-08 does not show OCR-010's Approve/Reject match prompt or OCR-011's default-Cash posting. There are no flows for re-approving a rejected capture, the evening auto-approve summary, managing learned merchants and blocked senders (SCR-28), or the home-screen widget entry. *Fix:* Update FLOW-08 and add FLOW-13..16 for those paths.

## Shape fit — adequate

This is a consumer product feeding a full BMAD chain, so a heavy, traceable PRD is the right shape. §9 provides flows instead of user journeys. They are step sequences with no named protagonist, which is acceptable for a UX handoff but loses the "who and why" that would discipline v1.2 choices such as auto-approve defaults. The PRD is not over-formalized: Appendix A and B contracts are useful exemplars. It is somewhat bloated with handoff mechanics: §0, Appendix C, GATE-10 and §25's checklist are process notes rather than product content.

### Findings
- **[low]** Flows have no protagonist (§9). *Fix:* Prefix each flow with the persona it serves, e.g. "FLOW-09 (Busy digital spender, Android with SMS approved)". This also resolves the persona-theater finding.
- **[low]** Process furniture is mixed into product content (§0 BMAD handoff, Appendix C, GATE-10, §25). *Fix:* Move these to a separate handoff note. Appendix C's paths (`inputs/wmbugo_PRD_v1.md`) don't match the real file (`input/docs/Idea_prd.md`) anyway.

## Mechanical notes

- **Change log table is broken** (§24.1): a blank line separates the 1.1.0 and 1.2.0 rows, so in Markdown the 1.2.0 row renders as a separate, headerless table. There is no 1.0.0 baseline row, although the note below the table names 1.0.0.
- **The v1.2 "Decisions affected" list is incomplete**: it omits §1.3, §3.3 (not changed but should have been), §4.1, §6.1 principle 7, §9 FLOW-09, §10 glossary (Pending capture, Mixed merchant), §11 (not changed but should have been), §13 and the §16.1 CAP/LRN/SMS suite rows that *were* added.
- **DEC-23 cross-reference is stale**: it "supersedes 'explicit rules only' in FIN-025/CAT-005", but neither FIN-025 nor CAT-005 contains that phrase any more. Reword as "supersedes the pre-v1.2 explicit-rules-only wording".
- **ID ordering**: SCR-27..29 are listed before SCR-25..26 (§5.2). WMB-16 sits between WMB-12 and WMB-13 (§21). The IDs are unique and contiguous, but the ordering will confuse extraction. Either reorder or note "ordered by phase".
- **Source-legend tags** (§0: `[SRC]/[FIX]/[NEW]`) are missing on all v1.2 requirements (CAP-*, LRN-*, SMS-010..014, OCR-009..013, HOM-007) and on most older ones. Either tag them consistently or drop the legend claim.
- **"v1" is overloaded**: it means PRD version 1.x (§23, §24.1 note) and also release scope ("No remote event tracking is permitted in v1", §3.3; "no server users/roles in v1", §14). Use "Phase 1/Phase 2" for release scope.
- **Phase labelling**: some requirement lines carry inline phase tags (REC-005 "Phase 2", HOM-007 "Android, Phase 1", OCR-001..003 "MVP") and others carry none. The §8.12 heading says "Phase 1, policy gate" but §5.2 says "MVP Android, gated". Normalize to the labels proposed above.
- **Glossary gaps** (§10): there are no entries for capture, verified sender, auto-approve, blocked sender, learned mapping, rejected capture, or home-screen widget versus Home card.
- **§16.1 PLAT** includes "iOS picker/camera" without marking it as a Phase 2 release criterion, unlike the parenthetical in §16.2.
- **Assumptions Index**: none. The PRD uses gates (§24) instead of `[ASSUMPTION]` tags, which works here. The v1.2 impact note's "Later, not Phase 1" and "Dropped" items should still be indexed in §4.2 / §4.4.
- **§25 checklist** is all unchecked. Either tick the items that this version satisfies or label the section as a reviewer worksheet.
