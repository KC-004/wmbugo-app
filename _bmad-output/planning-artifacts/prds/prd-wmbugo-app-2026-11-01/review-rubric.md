# PRD Quality Review — wmbugo PRD (v1.3.5, final)

Reviewed: `prd.md` v1.3.5 (frontmatter through Appendix C, 1,453 lines) and `addendum.md` (updated 2026-11-07). `review-rubric-v1.3.4.md` was used only to check what is now resolved. Every finding below was re-checked against the current text. Review date: 2026-11-07.

These product-owner decisions are treated as given, not as defects: Android-only Phase 1, a solo developer, international launch (India, US/Canada, UK/Europe, Gulf/SE Asia), one currency per user, no Phase 1 cut list, 50/30/20 in Phase 1 with savings pots, M3–M5 dates set later from measured velocity, and the NFR-10 protection level (powered off, or not unlocked since boot).

**Grade: Excellent.** Every dimension is strong or adequate, and there are no critical or high findings. The four medium findings are wording gaps on the transfer path, the refund/income boundary and the measurement protocol. They are worth closing before stories are written, but none blocks UX or architecture.

## Overall verdict

v1.3.5 closes all 16 v1.3.4 findings (15 fully, 1 partly). The NFR-10 trade-off is now decided in the PRD: SEC-001 and NFR-10 say the same thing, and FIN-026 (3) and CAP-012 agree that auto-linking happens inside the write transaction. The new CAP-004 mapping table, the `sms_cursor` start rule, the BDG-006 floor order and the `learned_mapping` extension each come with acceptance cases. What remains is narrower, and most of it is new wording from the v1.3.5 edits:
- **Auto-linked transfers:** the "Not a transfer" undo can be undone again at the next cutoff, and "two legs, one transfer" conflicts with "auto-approve off → not auto-linked".
- **Refunds in CAT-001:** the seeded "Refunds" *income* category conflicts with FIN-028's "a refund is never income".
- **§16.3 measurement:** it says scoring happens "inside the beta build", but the upload is only in a separate "wmbugo Lab" app.
- **Residual items:** older mechanical items carried forward unchanged.

## Decision-readiness — strong

The decision register (§2, DEC-01..33) remains the PRD's backbone, and the one product-level trade-off left open in v1.3.4 is now decided:
- NFR-10 states the protection level: "unreadable on a device that is powered off or has not been unlocked since it was turned on". It also states the cost: "After the first unlock, wmbugo may read the database while the screen is locked … app lock still guards opening the app".
- SEC-001 records the decision ("this is the NFR-10 protection level (product decision v1.3.5)").

Other trade-offs are also stated as decisions:
- the `sms_cursor` start ("older SMS are never read automatically", with an opt-in, review-only 30-day backfill);
- the floor-first rule for the overall budget (BDG-006);
- the "wmbugo Lab" split (§16.3).

The §20 M2 line now names a fallback that needs no schema ("it starts with the invariant property tests … schema-dependent work waits for the ledger ADR").

### Findings

- **[low]** The accepted residual risk of the NFR-10 choice is not recorded in the threat list (§17, NFR-10). §17 lists "Theft of offline phone/unencrypted backup" but not the case the v1.3.5 decision accepts: a phone that has been unlocked since boot and is then stolen while locked. Its data is protected only by the OS lock screen, not by a wmbugo key. NFR-10 implies this but never names it as an accepted risk. The architecture ADR that §17 requires will need that sentence. *Fix:* Add a §17 bullet: "Locked phone unlocked since boot: data protected by the OS only (accepted, NFR-10 v1.3.5); app lock guards the UI, not the database."

## Substance over theater — strong

The content stays product-specific and grounded in worked numbers. New in v1.3.5:
- Ravi's ₹600/₹450 "Paid me back" case with Arun;
- "Bring in the last 30 days of bank SMS? (42 messages)";
- the two-category floor case (Shopping −₹7,000, Food ₹10,000 → used ₹10,000, Left ₹40,000);
- GOAL cases that now give all three formula inputs.

There is no persona, innovation, NFR or vision theater. No findings.

## Strategic coherence — strong

The thesis holds: private, offline and correct, with low-effort capture and 50/30/20 as the brand mark. v1.3.5 makes the money model more coherent:
- every credit type now has a defined ledger effect (CAP-004 table);
- "Paid me back" reduces spending instead of inflating income, which protects "Kept N%" (INS-016) and the BDG-009 income pre-fill;
- auto-linking is tied to the auto-approve switch, so turning auto-approve off actually stops automation.

The counter-metrics (wrong-category auto-approvals ≤ 10%, duplicate confirmed entries = 0) still guard the capture bet. No findings.

## Done-ness clarity — adequate

Coverage is now broad. Every v1.3.4 acceptance gap has a GWT case:
- hide-amounts notification (§8.15);
- Delete permanently with a linked refund (§8.10);
- a reversal in a closed period not re-firing alerts (§8.5);
- the SMS-014 re-ask limits;
- the widget's "N to check" text (§8.8);
- LRN-009 normalization;
- the auto-linked undo, the two-card wait, auto-approve off;
- the SMS backfill;
- the overall-budget floor.

Read strictly, the v1.3.5 transfer wording still leaves two behaviours on the money path open, and one acceptance case contradicts its FR.

### Findings

- **[medium]** Auto-linked transfers: the undo can be undone again, and pairing versus auto-linking is contradictory (CAP-012, §8.12 acceptance, CAP-007 acceptance, FIN-027, LRN-008).
  - **Undo loop:** "Not a transfer … undoes the link and returns the capture to Waiting for you" (CAP-012). The capture is still transfer-like by its text ("card payment") and its account is still resolved. Read literally, the next FIN-026 write auto-links it again, which defeats §6.1 #7 ("every automated decision is reversible"). Nothing says that "Not a transfer" teaches or pins the choice, and LRN-008 lists only `auto_approved`, not `auto_linked`, as never teaching.
  - **Pairing versus auto-linking:** CAP-012 says without condition "whichever arrives first creates it and the other is attached as an additional source, never a second entry". The §8.12 case "Given auto-approve is off, when both legs arrive, then they are not auto-linked" does not say whether the two legs still pair into one *waiting* transfer or stay as two waiting items. It also does not say whether the pairing creates a `confirmed` or a `needs_review` transfer before the cutoff. FIN-027's same-reference "linked as one own-account transfer" (acceptance: "HDFC falls by ₹10,000 while ICICI rises") has the same gap.
  - **Stale acceptance:** the CAP-007 acceptance still says the ₹1,999 card-payment debit "is linked as a card payment **if the card account exists**". CAP-012 now requires the account to be "resolved with certainty through `account_identifier` (CAP-009) or a learned choice". Merely having a card is neither.

  *Fix:*
  - State that "Not a transfer" records the user's choice for that capture (and teaches per payee/mandate), so that capture is never auto-linked again.
  - Add `auto_linked` to LRN-008's "never teaches" list.
  - State that leg pairing always happens and produces one `needs_review` transfer (one review item), and that only the confirmation waits for auto-approve or the user.
  - Change the CAP-007 case to "if the card is identified through its mask or a learned choice".

- **[medium]** The §16.3 measurement location contradicts itself ("inside the beta build" versus "wmbugo Lab").
  - §16.3 says accuracy "is measured on the tester's own phone, **inside the beta build** … the app records a per-field score. Only the scores and a redacted copy … are uploaded".
  - In the next sentences: "The upload exists only in a **separate measurement app with its own package ID** (e.g. "wmbugo Lab")", and "The Play closed testing track … runs the real no-internet build".
  - If scoring happens in the closed-track build, the scores and redacted copies need a path to Lab, either inter-app transfer or export. That is a data-leaving-the-app path that SEC-002, GATE-08 and the Data safety form have not considered. If scoring happens in Lab, "inside the beta build" is stale.
  - This is the evidence path for the §3.3 OCR and UPI targets and the M3 exit criterion, and GATE-08 must review it "before collection starts at M3".

  *Fix:* Say "inside wmbugo Lab": Lab bundles the same parsers, testers snap or share the receipt into Lab, and nothing passes between the two apps. Add that Lab carries its own privacy notice and Data safety entry if it is distributed on a Play track.

- **[low]** The SMS catch-up is unbounded on re-enable and after long gaps (SEC-001, `sms_cursor`). The cursor rule covers first enable and restore. It does not cover:
  - SMS capture turned off and turned back on months later: the cursor resumes from the old position and reads every message in between;
  - a restore long after the backup was made;
  - an app that has not been opened for months (the background job does not run).

  In each case, eligible messages are auto-approved into past periods. The 30-day backfill is review-only, but this backlog is not. *Fix:* Treat a gap of more than 30 days (or a re-enable) like the first enable: move the cursor forward and offer a review-only backfill.

- **[low]** Small acceptance and rule gaps added in v1.3.5:
  - **Saved / invested with no pot:** "Saved / invested" when no savings pot exists has no create-on-first-use rule. "Cash withdrawal" has one in CAP-012.
  - **Mandate key:** the `mandate` key for learned SIP choices is not defined from SMS fields. SMS-003 parses reference, merchant and mask, not a mandate ID.
  - **No auto-linked case in §16.1:** §16.1 has no CAP case for auto-link and undo.

  *Fix:* One line each.

## Scope honesty — strong

The scope is explicit:
- §4.1: no cut list, and dates move instead of scope;
- §13.0a/§13.2 per market and per build;
- §16.3 now says the Play closed track runs the real build, so GATE-13's 14-day test and the GATE-08 Data safety form match the release.

The single `[ASSUMPTION]` (SMS-016) round-trips to GATE-02. Open-item density is low, which suits a frozen PRD. No findings beyond the §16.3 wording issue above.

## Downstream usability — adequate

Most of the PRD extracts cleanly for UX, architecture and stories:
- the budget, period and timezone cases now sit in §8.5, with a cross-reference left in §8.16;
- `learned_mapping` now carries `payer|mandate` keys and `credit_type|transfer_choice` targets;
- `sms_cursor` gains `consent_at` and `backfill_offered`;
- the addendum's eligibility inputs and match rule are current.

One money-semantics contradiction and a few stale label lists remain.

### Findings

- **[medium]** The seeded "Refunds" income category contradicts FIN-028 (CAT-001, CAT-003, FIN-021, FIN-028, CAP-004, TXN-003).
  - CAT-001 seeds "income categories Salary, Freelance, From people, Gifts, Interest, **Refunds** (refunds still typed distinctly)".
  - FIN-028 says "A refund is never income and never counts in 'Kept' income". The v1.3.5 CAP-004 table records every refund as `refund` "in the category learned for that payer", which is a *spending* category.
  - The PRD never says what the "Refunds" income category is for. A user adding Income → Refunds through TXN-003 records `income`, which inflates Kept N% and the BDG-009 pre-fill.
  - Separately, "Paid me back" puts a credit into a spending category. CAT-003 ("prevent accidental use of expense-only categories as income") does not say that a `refund` credit is allowed to use one.

  *Fix:* Remove "Refunds" from the income seeds, or state that choosing it records a `refund` (FIN-028) with a prompt for the spending category. Add to CAT-003: "a `refund` uses expense categories; it is not income".

- **[low]** The new label is missing from three label lists:
  - "Recorded · linked as transfer" is in the status mapping and §10, but not in the FIN-024 "User-facing state labels" paragraph (which also omits "Recorded · needs a category");
  - it is not in TXN-006's row states;
  - it is not in the addendum §3 "Capture status vocabulary".

  UX extracts labels from these lists. *Fix:* Add the label to all three, or have them point to the status mapping table.

- **[low]** The BDG-006 wording "the target minus the **visible** category bars" does not match the overall budget. The overall budget counts "**all** confirmed spending" (§6.3), but Home shows bars only for categories that have a budget (§6.3 item 5). Read literally, unbudgeted categories are left out of the identity. *Fix:* Say "the target minus the sum of every category's floored spending".

- **[low]** Small data-model gaps (§11):
  - `balance_chain` has no field recording that a first mismatch was already tolerated, which SMS-012's "second consecutive mismatch" needs;
  - `tombstone.outcome[rejected|deleted]` has no value for import rows excluded in review, which FIN-014 now tombstones;
  - FIN-014 does not say whether "Import anyway" clears the tombstone, or where excluded import rows are restorable during their 90 days.

  *Fix:* Add `mismatch_count`, an `excluded` outcome, and one sentence each in FIN-014.

## Shape fit — strong

This is a consumer product at the top of a UX → architecture → stories chain, and its formality matches:
- 18 named-protagonist flows;
- a screen inventory;
- the capture status mapping as a shared contract;
- §16.4 traceability;
- Definitions of Ready and Done.

Technology detail stays in the addendum under "the PRD wins on any conflict". No findings.

## Resolved since v1.3.4

**From `review-rubric-v1.3.4.md`: 1 high, 9 medium and 6 low findings.** 15 resolved, 1 partly resolved, 0 open.

- **Resolved:**
  - NFR-10 versus capture while locked (high): decided in NFR-10 and SEC-001.
  - `auto_linked` half-specified: ordering inside the FIN-026 transaction, status row and §10, "Not a transfer", certain resolution, auto-approve off. The ACC-009 and CAP-007 wording is fixed. New residual gaps are listed above.
  - Credit-type mapping (CAP-004 table, the From people category, Paid me back, refund waits with no learned category, plus acceptance).
  - DEDUP suite row (merge by source authority).
  - `sms_cursor` starting point (consent moment, review-only backfill, restore keeps cursor, GWT). Re-enable and long gaps remain open (low above).
  - BDG-006 overall floor (floor first, then sum, plus a two-category case).
  - GOAL acceptance inputs (both cases give all three inputs).
  - Beta-measurement build versus Play track ("wmbugo Lab" separate package; new wording conflict above).
  - `learned_mapping` extension.
  - Budget and period cases moved to §8.5.
  - M0/M1/M2 overlap (M2 starts without schema).
  - OCR-005 mismatch direction and Not itemised excluded from pro-rata.
  - Residual acceptance gaps (all six cases added).
  - Addendum aligned (date, eligibility inputs, reference rule).
  - Transfer-pair windows versus duplicate rule (FIN-027 explains both).
- **Partly resolved:** Tombstones. "Import anyway" and the 90-day retention for excluded rows were added. Still missing: which remove verb applies to CSV-imported rows, an `excluded` tombstone outcome, and whether "Import anyway" clears the tombstone.

## Mechanical notes

- **ID order** is still out of sequence, with no stability note in §0:
  - FIN-016 before FIN-011, and FIN-026/027/028 before FIN-025;
  - TXN-012/013 before TXN-009;
  - CAP-012 between CAP-004 and CAP-005;
  - LRN-010 between LRN-002 and LRN-003;
  - REC-009/010 before REC-008;
  - HOM-008 before HOM-007;
  - INS-007 before INS-005;
  - SCR-27..31 before SCR-25/26;
  - WMB-16..18 before WMB-13.

  IDs are unique, and every cross-reference checked resolves. *Fix:* Add one line to §0: "IDs are stable; new IDs sit next to related items."
- **Stale cross-reference:** DEC-23 still says "now specified in LRN-001–009"; LRN-010 exists.
- **Glossary (§10):** "Capture resolution" now includes `auto_linked`. There are still no entries for:
  - auto-approve, daily cutoff, Not classified, Not itemised, `needs_category`;
  - Kept, tombstone, Recently deleted, Saved & invested;
  - and, new in v1.3.5, From people and Paid me back.
- **UPI-003 wording:** "Received-money screenshots offer the CAP-004 **income** choices". CAP-004 now includes refund and transfer outcomes, so "credit choices" is the accurate term.
- **"v1" as a release label** remains in §14 ("no server users/roles in v1") and in the §23 column header ("PRD v1 treatment").
- **Header date:** "Date: 17 October 2026 (rev. 1 November 2026)", while the frontmatter says `updated: 2026-11-07`.
- **§6.3 near-duplicate sentence:** "Each card has a clear period label." is still followed by "Each card supports tap-to-details (where applicable) and a clear period label."
- **§16.1 suites lag the FRs:**
  - The CAP row's auto-approve exclusions omit unresolved accounts, unlearned credits, UPI screenshots, foreign currency and auto-link/undo.
  - The 5030 row has no savings-pot, SIP or pot-withdrawal case.
  - The SMS row has no consent-start or backfill case.
- **§11 small items carried forward:**
  - `tombstone` "salted hash" with no stored salt (and how it survives backup and restore);
  - `removal_kind = rejected` duplicates `capture_resolution = rejected`;
  - the type of `auto_approve_rule.effective_from` (it must be a timestamp for loosening changes that "apply immediately");
  - no field for the BDG-009 user-entered income base.
- **Change log:** there is still no 1.0.0 baseline row; the footnote explains the renumbering. The 1.3.5 row is thorough.
- **Assumptions Index:** one inline `[ASSUMPTION]` (SMS-016), round-tripped to GATE-02 and §25. Acceptable at this density.
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. There is still no flow for the auto-linked card payment or for "Paid me back", both new in v1.3.3–1.3.5.
- **Required sections:** all present for a chain-top consumer PRD.
