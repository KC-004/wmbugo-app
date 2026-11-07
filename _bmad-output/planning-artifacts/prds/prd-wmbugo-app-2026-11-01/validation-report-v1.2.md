# Validation Report — wmbugo — PRD v1.2.0-draft

- **PRD:** `input/docs/Idea_prd.md`
- **Rubric:** `C:\Users\KCPK\Documents\projects\wmbugo\wmbugo-app\.claude\skills\bmad-prd\assets\prd-validation-checklist.md`
- **Run at:** 2026-11-01T00:00:00Z
- **Grade:** Poor

## Overall verdict
The core of this PRD is unusually strong. The financial model (§7), the decision register (§2), the named external gates (§24) and the superseded-source list (§23.1) make it decision-ready and correctness-focused in a way most consumer PRDs are not. The risk is in the v1.1/v1.2 edits. The "effortless capture" layer (DEC-21..25, CAP, LRN, SMS-010..014, OCR-009..013) was added as new sections, but the rest of the document was not updated to match. End-of-day auto-approve conflicts with the PRD's own duplicate-counting P0 and "unconfirmed" rules. §11 data model, §13 parity matrix, §4.1 scope list, §3.3 success metrics and §16.2 release criteria do not reflect the new features. "MVP" now quietly means "Phase 1 Android" without saying what iOS gets. Fix the critical auto-approve finding and the five high findings before UX, architecture or story work starts. Most of the fixes are bounded edits, not rethinks.

## Dimension verdicts
- Decision-readiness — adequate
- Substance over theater — adequate
- Strategic coherence — adequate
- Done-ness clarity — thin
- Scope honesty — adequate
- Downstream usability — thin
- Shape fit — adequate

## Findings by severity

### Critical (1)
**[Decision-readiness]** — End-of-day auto-approve can post duplicate and unverified captures as confirmed, breaking the PRD's own P0 (§ DEC-22, CAP-007, OCR-011, FIN-024, SMS-003, SMS-005, §7.4, §16.2)
CAP-007 excludes from auto-approve only "captures flagged by SMS-011/SMS-012". It does not exclude captures that SMS-005 marks as "ambiguous matches", items carrying the `possible_duplicate` flag (FIN-024), or captures with "unknown parsed values", which SMS-003 says "remain unconfirmed". So an SMS debit for an expense the user already entered manually, or one that matches a scanned bill that OCR-011 "recorded directly as an expense", can be auto-confirmed at end of day as a second expense. OCR-011 also posts unmatched bills directly, with no Approve/Reject, contradicting DEC-21 and FLOW-08. DEC-22 says "verified senders" while CAP-007 says "Unactioned captures", so the scope of auto-approve differs between the two.
Fix: Add a normative rule to CAP-007: auto-approve applies only to captures from verified senders (as defined in SMS-010) that have no `possible_duplicate` flag, no open review candidate, a fully parsed amount, account and direction, and a non-null category. Everything else stays `needs_review`. Make OCR-011 create a `needs_review` capture with an Approve prompt, or document it as an explicit DEC-21 exception. Add a §7.4 invariant and a §16.2 P0: "Auto-approve never confirms a capture that matches an existing confirmed transaction." Add a `[NOTE FOR PM]` under DEC-22 recording that it trades away the "Correctness over delight" principle, and what limits that trade.

### High (6)
**[Decision-readiness]** — The Phase 1 no-SMS variant's capture experience is undefined (§ DEC-07, §4.1, CAP, LRN, SCR-24/27, FLOW-09, §1.3 #4)
If Play approval is not granted, the headline differentiator "automatic on-device SMS and bill capture" shrinks to OCR plus manual entry. The PRD does not say which CAP items, LRN items and screens ship in that variant, or whether SMS-014's re-ask card is suppressed.
Fix: Add a short "No-SMS variant" subsection under §8.16 or §13.1 with a table that marks each CAP, LRN and SCR item as present, adapted (for OCR-only captures) or absent. Add one line to §1.3 #4 stating that the differentiator depends on GATE-02.

**[Strategic coherence]** — Success metrics and release criteria don't measure effortless capture or its risks (§3.3, §16.2, §24.1 v1.2 impact note 1)
§3.3 has nothing that validates the capture thesis and no counter-metrics; the impact note's usability requirement for auto-approve never reaches §3.3 or §16.2.
Fix: Add to §3.3 (via usability studies or the synthetic fixture corpus, respecting no-telemetry): share of captures resolved with zero or one tap; category-correction rate falling over a multi-week diary study; SMS parse precision/recall on a synthetic Indian bank/UPI SMS corpus; OCR total/merchant/date extraction accuracy on a reference bill set. Add counter-metrics: wrong-category auto-approvals; scam-filter false positives on genuine bank SMS; users disabling capture notifications. Add "auto-approved entries understood (≥90%)" to the §16.2 P1 usability line.

**[Done-ness clarity]** — Capture rules have undefined terms and self-contradicting heuristics (§ DEC-22, SMS-010, SMS-011, SMS-012, CAP-007, LRN-003)
(a) "Verified sender"/"unverified sender" are never defined and there is no allow-list source or update mechanism. (b) SMS-011 treats "refund" wording as scam, but SMS-003 requires parsing genuine refund SMS. (c) SMS-012 flags any balance-chain mismatch with no tolerance or reset rule, though gaps are routine. (d) "End of day … configurable time" has no execution guarantee, while §25 forbids always-running background services and REC-003 disclaims exact-time delivery. (e) No category is defined for an auto-approved unknown merchant.
Fix: Add a glossary entry for verified sender (e.g. bundled DLT-header allow-list plus user-confirmed senders). Narrow SMS-011 to link plus claim/KYC/prize wording, or credit plus non-allow-listed sender, and add a "genuine refund SMS is not flagged" test to §16.1 SMS. Give SMS-012 a reset rule. Define auto-approve as "best effort; on next app open any overdue pending captures are processed", and default unknown-merchant auto-approvals to "Uncategorized" in needs-categorization state.

**[Scope honesty]** — The §4.1 Phase 1 scope list omits every v1.2 feature (§4.1 vs §8.16, §8.17, HOM-007, SCR-27..29, WMB-16; §24.1)
Anyone reading §4 as the scope contract would leave out the headline differentiator. The v1.2 "Decisions affected" list also omits §4.
Fix: Add §4.1 bullets for Approve/Reject capture review with floating dialog, end-of-day auto-approve, local learning (merchant, UPI ID, item), rejected-capture retention, the Android home-screen widget and lock-screen approve (opt-in). Add the two "Later" items from the v1.2 impact note to §4.2, and add §4 to the v1.2 change-log row.

**[Downstream usability]** — The §11 data model is not updated for v1.2, and already lacked FIN-020 fields (§11.1 vs FIN-020, FIN-024, CAP-007, LRN-001..005, SMS-011..013, OCR-012)
No entities/fields for learned mappings (with "mixed" flag), payee UPI ID and name, blocked senders, sender allow-list/verified status, per-account last SMS balance, approval provenance, receipt line items, scam-suppressed captures, or SMS re-ask counters. `transaction` lacks `payment_method`, `tags` and source link (FIN-020). `automation_rule` is not marked Phase 2, so it is ambiguous whether LRN mappings live there.
Fix: Add `learned_mapping(id, key_kind[merchant|upi|item], key, category_id, mixed, confirmations, updated_at)`, `payee(upi_id, display_name)`, `sender(id, header, status[allowed|blocked], last_balance_minor?, account_id?)`, `receipt_item(id, attachment_id, transaction_id, name, qty?, amount_minor, split_id)` and `transaction.capture_resolution[user_approved|auto_approved|rejected]` plus `payment_method` and `tags`. State that `automation_rule` is Phase 2 and LRN does not use it. Add §11 to the v1.2 change-log row.

**[Downstream usability]** — The parity matrix and iOS scope ignore v1.2, and "MVP" is ambiguous across platforms (§13, NFR-13, §5.2, §21, §16.2, §25)
§13 has no rows for capture notifications, floating dialog, home-screen widget, lock-screen approve, local learning, OCR-010 bill-match prompts, or SMS scam/sender protections, despite NFR-13. SCR-28 is "MVP" with no platform while LRN is "Phase 1" and CAP "Phase 1 Android". "MVP" is used as a synonym for "Phase 1", so "SCR-xx MVP" is ambiguous about platform.
Fix: Retire "MVP" in favour of "Phase 1 (both platforms built; Android release)", "Phase 1 Android-only" and "Phase 2". Apply to §5.2, §8.9, §21, §16.2 and §25. Add the seven missing rows to §13, each with an iOS behaviour or "N/A + fallback".

### Medium (8)
**[Substance over theater]** — Personas don't drive anything (§3.1, §9, §22.1)
Five personas with no persona-to-decision or persona-to-flow links; the "Busy digital spender" is the v1.2 protagonist but never named.
Fix: Cut to three or four personas and tag each FLOW and each DEC-21..25 with the persona it serves, or drop the persona element from the §22.1 Definition of Ready.

**[Strategic coherence]** — Phase 1 has no ordered cut list beyond OCR-012 (§4.1, §8.11, §20 M6, WMB-16)
Scope grew twice in one day without re-baselining milestones; M6 doesn't mention WMB-16's capture review, learning and home-screen widget.
Fix: Add a ranked fast-follow list to §4.1 (e.g. OCR-012 itemization → LRN-004 item learning → CAP-005 batch "Apply to all similar" → HOM-007 widget) and add WMB-16 to M6.

**[Done-ness clarity]** — Capture has no accuracy or latency bounds (§12 NFR table, SMS-003, OCR-004)
The only capture NFR is OCR latency (NFR-08); no targets for SMS→notification latency, parse accuracy, OCR field accuracy, or battery/background budget.
Fix: Add NFR-16..19: SMS→notification p95 (e.g. ≤5s when process alive), parse precision/recall on the fixture corpus, OCR total-field accuracy on a reference bill set, and a background CPU/battery budget verified on the GATE-03 device matrix.

**[Done-ness clarity]** — LRN-003's mixed-merchant trigger is fragile and cannot be undone (LRN-003, LRN-005)
"Two or more different categories" means one mis-tap permanently disables auto-categorization for that merchant; no recovery path or threshold.
Fix: Define the trigger over the last N confirmations (e.g. 2 different categories within the last 5), and let users clear the mixed flag in SCR-28.

**[Downstream usability]** — The status model is incomplete for captures (FIN-024, CAP-008, SMS-011, §10, HOM-001, SCR-10, SCR-29)
"Rejected" maps to `excluded`, which TXN-005 also uses for manual entries, making "Show rejected" ambiguous. Scam-blocked items have no status. Unclear whether pending captures, review-queue items and SCR-29 "pending approvals" are the same set.
Fix: State in FIN-024 whether pending captures appear in the review queue and SCR-29 badge. Distinguish rejected from user-excluded via the capture-resolution field. Specify that scam-flagged SMS are not stored, or are stored as a redacted `source_record` with no transaction.

**[Downstream usability]** — Notification content contradicts the privacy default (SEC-005 vs CAP-001, SMS-006)
SEC-005 requires privacy-preserving notification contents by default; CAP-001 requires amount, direction, merchant, account in every capture notification.
Fix: Amend SEC-005: capture notifications show details in the shade but use redacted public versions on the lock screen unless CAP-006 is enabled. Add a §16.1 SEC case for lock-screen redaction.

**[Downstream usability]** — Glossary collisions: "bill", "widget", "Scan/Snap" (§10, REC, OCR-010..013, HOM-001..007, SCR-05, SCR-29, §5.1)
"Bill" means both payable and receipt; "widget" means both Home dashboard card and Android home-screen widget; Add sheet says "Scan" while the widget says "Snap bill".
Fix: Add glossary entries and use one term each: "receipt" for scanned bills, "bill" for payables, "Home card" for dashboard widgets, "home-screen widget" for SCR-29.

**[Downstream usability]** — Flows are stale or missing for v1.2 (FLOW-08, FLOW-09, §9)
FLOW-08 lacks OCR-010's match prompt and OCR-011's default-Cash posting. No flows for re-approving a rejected capture, evening auto-approve summary, managing learned merchants/blocked senders (SCR-28), or home-screen widget entry.
Fix: Update FLOW-08 and add FLOW-13..16 for those paths.

### Low (6)
**[Substance over theater]** — Some NFRs are adjectives (NFR-06, NFR-07, NFR-11)
"Aims 60 FPS", "acceptable list scrolling", "appropriate hit target behavior" are not testable.
Fix: Replace with bounds, e.g. "≤1% dropped frames over a 10k-row fling on the reference device", "48dp/44pt minimum target" (reference §6.2), and "p95 frame time ≤16.7ms for list scroll".

**[Done-ness clarity]** — Vague phrasing remains in older FRs (CAT-001, BDG-007, REC-006, SET-003, OCR-007, OCR-001)
"Sensible categories", "recalculating carefully", "Detect monthly calendar patterns carefully", "reasonable frequency caps", "fails gracefully", "compress safely".
Fix: Replace each with a checkable rule or test reference, e.g. REC-006 → "Jan 31 monthly → Feb 28/29 → Mar 31".

**[Done-ness clarity]** — Only four modules have Acceptance lines (ONB, ACC, TXN, BDG)
CAP, LRN, OCR, SMS, REC, INS and SET have none.
Fix: Add one Acceptance line each to CAP, LRN, SMS and OCR, starting from the §16.1 CAP/LRN suite rows.

**[Scope honesty]** — GATE-01 still requires sign-off on free/premium positioning for Phase 1 (§24 GATE-01 vs DEC-13, v1.1 impact note 3)
Phase 1 is free-only, so premium positioning is not a Phase 1 gate.
Fix: Change GATE-01 to "Phase 1 free-only confirmation". Premium positioning belongs to GATE-11.

**[Shape fit]** — Flows have no protagonist (§9)
Flows are step sequences without a named user, losing the "who and why".
Fix: Prefix each flow with the persona it serves, e.g. "FLOW-09 (Busy digital spender, Android with SMS approved)". This also resolves the persona-theater finding.

**[Shape fit]** — Process furniture is mixed into product content (§0, Appendix C, GATE-10, §25)
BMAD handoff mechanics sit alongside product content; Appendix C's paths (`inputs/wmbugo_PRD_v1.md`) don't match the real file (`input/docs/Idea_prd.md`).
Fix: Move these to a separate handoff note.

## Mechanical notes
- **Change log table is broken** (§24.1): a blank line separates the 1.1.0 and 1.2.0 rows, so the 1.2.0 row renders as a separate, headerless table. No 1.0.0 baseline row, although the note below names 1.0.0.
- **The v1.2 "Decisions affected" list is incomplete**: omits §1.3, §3.3, §4.1, §6.1 principle 7, §9 FLOW-09, §10 glossary (Pending capture, Mixed merchant), §11, §13 and the §16.1 CAP/LRN/SMS suite rows that *were* added.
- **DEC-23 cross-reference is stale**: neither FIN-025 nor CAT-005 contains "explicit rules only" any more. Reword as "supersedes the pre-v1.2 explicit-rules-only wording".
- **ID ordering**: SCR-27..29 listed before SCR-25..26 (§5.2); WMB-16 sits between WMB-12 and WMB-13 (§21). Reorder or note "ordered by phase".
- **Source-legend tags** (§0: `[SRC]/[FIX]/[NEW]`) are missing on all v1.2 requirements and most older ones. Tag consistently or drop the legend claim.
- **"v1" is overloaded**: PRD version 1.x vs release scope (§3.3, §14). Use "Phase 1/Phase 2" for release scope.
- **Phase labelling**: inline phase tags are inconsistent (REC-005, HOM-007, OCR-001..003); §8.12 says "Phase 1, policy gate" but §5.2 says "MVP Android, gated". Normalize.
- **Glossary gaps** (§10): no entries for capture, verified sender, auto-approve, blocked sender, learned mapping, rejected capture, or home-screen widget vs Home card.
- **§16.1 PLAT** includes "iOS picker/camera" without marking it as a Phase 2 release criterion, unlike §16.2.
- **Assumptions Index**: none; gates (§24) are used instead, which works. The v1.2 impact note's "Later, not Phase 1" and "Dropped" items should still be indexed in §4.2 / §4.4.
- **§25 checklist** is all unchecked. Tick satisfied items or label it a reviewer worksheet.

## Reviewer files
- `review-rubric.md`
