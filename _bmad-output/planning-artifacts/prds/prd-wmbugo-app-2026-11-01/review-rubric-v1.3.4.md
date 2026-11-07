# PRD Quality Review — wmbugo PRD (v1.3.4, final)

Reviewed: `prd.md` v1.3.4 (frontmatter through Appendix C, 1,429 lines) and `addendum.md`. `review-rubric-v1.3.2.md` and `review-adversarial-general-v1.3.2.md` were used only to check what is now resolved. Every finding below was re-checked against the current text. Review date: 2026-11-07.

These product-owner decisions are treated as given, not as defects: Android-only Phase 1, a solo developer, international launch (India, US/Canada, UK/Europe, Gulf/SE Asia), one currency per user, no Phase 1 cut list, 50/30/20 in Phase 1 with savings pots, and M3–M5 dates set later from measured velocity.

**Grade: Fair.** No dimension is thin or broken, and there are no critical findings. One high finding (NFR-10 versus capture while the phone is locked) sets the grade by rule.

## Overall verdict

v1.3.4 closes nearly every critical, high and medium finding from the two v1.3.2 reviews. The ledger path now holds:
- same-reference pairs are classified by account;
- unlearned credits wait;
- savings pots carry the Savings bar;
- discovered accounts open just before their transaction;
- the two legs of a card bill make one transfer;
- tombstones stop purged rejections from coming back;
- the CAP-007, SEC-005 and BDG-008 wording now matches FIN-026, and the GOAL rules match too.

What remains is narrower:
- **One undecided product trade-off.** NFR-10 promises data is unreadable on a *locked* device, but SMS capture and the 21:00 background write need the database while the phone is locked. The PRD hands this to an ADR instead of deciding it.
- **Gaps around the v1.3.3/1.3.4 additions:**
  - the `auto_linked` transfer has no label, no undo and no fixed ordering;
  - credit types that are auto-approved have no category mapping;
  - the SMS catch-up has no starting point;
  - one QA suite still describes the old Merge rule;
  - five BDG acceptance cases sit under CAP.

None of this blocks UX. Decide the NFR-10 question, and close the `auto_linked` and credit-mapping gaps, before `bmad-architecture` sets the key and schema design.

## Decision-readiness — adequate

The decision register (§2, DEC-01..33) is still the best part of the PRD. The rows changed in v1.3.3/1.3.4 state their trade-offs:
- DEC-21 now lists typed choices for credits, transfer-like captures and receipt matches;
- DEC-22 states the always-write model;
- DEC-24 gives the 90-day window and the tombstone;
- DEC-30 names savings pots and SIP/RD.

The GATE-02 timing is now consistent across SMS-016, §20 M1 and §24 (decided at M3; the build supports both package outcomes from M1). The FIN-026 (4) loosening/tightening rule is a real decision with its reason ("nothing is approved sooner than the user expected").

One product-level trade-off is still not decided. It is handed to architecture although it changes a privacy promise.

### Findings

- **[high]** NFR-10's "locked device" promise conflicts with capture while the phone is locked, and the PRD hands the choice to an ADR (NFR-10, SEC-001, FIN-026 (3), CAP-007, NFR-16, SET-003).
  - NFR-10: "Database and attachments unreadable from a powered-off **or locked** device without the device credential."
  - The capture path needs the database while the screen is locked:
    - NFR-16 posts a capture notification within 30 s of an SMS, after a duplicate check against the ledger (DEC-29);
    - FIN-026 (3) writes auto-approvals in "a best-effort background job" after 21:00, usually with the phone in a pocket;
    - CAP-007 and SET-003 send the evening summary "only by the background job, right after its auto-approve write commits".
  - On Android, a key usable only while the device is unlocked (an unlocked-device-required Keystore key) makes all three impossible while the phone is locked. A key usable while locked (after first unlock) does not meet NFR-10 as worded.
  - SEC-001 says "The architecture ADR states whether the main database key is authentication-bound and how that meets NFR-10". That asks the ADR to reconcile something that cannot be reconciled. Whichever way it goes, the result is either a weaker privacy promise or capture that works only after unlock, which is the core India flow. That is a product decision, not an architecture one.

  *Fix:* Decide it in the PRD. Either:
  - (a) reword NFR-10 to "unreadable from a powered-off device or one not unlocked since boot", and state in §17 that data on a phone that has been unlocked since boot is protected only by the OS (an accepted risk); or
  - (b) keep NFR-10 and say that capture notifications, the auto-approve write and the evening summary wait until the next unlock. NFR-16 and CAP-007 then change to match.

- **[low]** The M0/M1/M2 dates overlap (§20). M0 (UX, architecture, epics and sprint plan, 11-02 → 11-07) and the M1 spikes (ledger, encryption, migrations, pipeline, ADRs) share the same five days, and M2 starts "by 2026-11-08", today + 1. That is the owner's call, but no fallback is named if the ADRs (which §11.2 and §25 require "before migrations are generated") are not ready. *Fix:* Add one line: "M2 starts with the invariant property suite, which needs no schema; schema-dependent work waits for the ADR."

## Substance over theater — strong

The content stays product-specific:
- worked numbers in the acceptance cases (₹25,000 opening derived from "Avl bal ₹23,000"; S$37.80 / S$16.20 discount allocation; the ₹40,000 pro-rated shortened cycle);
- a concrete clock guard with `(wall_time, elapsed_since_boot, boot_count)` and a cap of +1 day;
- an `INTERNET`-stripping release check;
- the §16.3 on-device scoring protocol.

The earlier adjective bounds are gone. NFR-06 and NFR-19 now use "≥ 95% of frames at 60 FPS with no stall over 100 ms", OCR-001 states 2,048 px at JPEG quality 85, and §6.6 names the fallback signals and an M4 check. The five personas each drive named flows. No findings.

## Strategic coherence — strong

The thesis holds: private, offline and correct, with low-effort capture and 50/30/20 as the brand mark. The v1.3.2 high finding is fixed:
- the Savings bar is net money moved into savings pots (ACC-009, BDG-009);
- an everyday "Savings Account" is explicitly never a pot;
- SIP/RD debits go through "Saved / invested";
- two acceptance cases cover Arjun's HDFC account and a SIP mandate.

Free to use and Left in budget now share one definition (BDG-008 "`budget_remaining` is exactly Home's **Left in budget** … including the 50/30/20-only form"). The counter-metrics guard the capture thesis. No findings.

## Done-ness clarity — adequate

Coverage improved a lot. Every item on the v1.3.2 list of missing acceptance cases now has a GWT case: account discovery, Cash withdrawal, the cross-zone prompt, the clock guard, Merge, CSV encodings, flip sign, transfer pairs, resume, BDG-007/008/009, the dismissed UPI dialog and the early-salary rule. The new rules also carry their own cases: tombstone re-import, Recently deleted, pair deletion, post-unlock SMS catch-up, the release manifest, the tolerant balance chain and the unknown-sender credit.

Read strictly, though, several v1.3.3/1.3.4 rules are still only partly specified on the money path. One QA suite also contradicts the FR it tests.

### Findings

- **[medium]** `auto_linked` transfers are only half specified (CAP-012, FIN-026 (3), FIN-024, status mapping, §10, ACC-009 acceptance, CAP-007).
  - **Ordering:** CAP-012 links "only in the FIN-026 write step, with an audit row". FIN-026 (3) says "only after that commit do budget threshold alerts (BDG-004) and transfer linking run". One puts the link inside the write transaction and the other after it.
  - **No label or undo:** the status-mapping table and the user-label paragraph have no row for `auto_linked`. §10 "Capture resolution" still lists only "user_approved, auto_approved or rejected". The trigger is wording ("bill payment to a card"), and §6.1 #7 promises "every automated decision is reversible", but no un-link path is stated.
  - **Which account:** the acceptance says "linked as a card payment if the card account exists". It does not say how the card is chosen when the SMS has no mask and the user has two cards.
  - **Settings:** it is not stated whether auto-linking runs when auto-approve is off.
  - **Mixed terms:**
    - The ACC-009 acceptance says the next SIP debit is "learned and **auto-approved** the same way", but CAP-012 says transfer-like captures are "never auto-approved". By CAP-012's definition, a debit to a learned pot is transfer-like.
    - CAP-007 lists "Moved from my own account" as a learnable credit type that makes a credit eligible, but such a credit is transfer-like and therefore never eligible.

  *Fix:*
  - Put the link inside the FIN-026 write transaction and correct FIN-026 (3).
  - Add an `auto_linked` row to the status mapping ("Recorded · linked as transfer") and to §10.
  - State the un-link action ("Not a transfer" → back to Waiting for you).
  - Require the counter-account to be resolved through `account_identifier` (CAP-009); if more than one account could match, it waits.
  - Say whether auto-approve off also stops auto-link.
  - Change the ACC-009 acceptance to "linked automatically (`auto_linked`)", and drop "Moved from my own account" from CAP-007's list of eligible credit types.

- **[medium]** Auto-approved credit types have no mapping to an event type and category (CAP-004, CAP-007, LRN-010, FIN-028, CAT-001, CAT-006).
  - CAP-007 makes a credit eligible once its type ("Salary, Refund, From a person, Moved from my own account") is learned for that payer. It never says what each type becomes:
    - Salary → income, category Salary (presumably).
    - **Refund**: FIN-028 puts an unlinked refund "in a chosen category". An auto-approved refund has none, and Uncategorised is "for expenses only" (CAP-007), so the refund cannot reduce any category.
    - **From a person**: no income category of that name exists (CAT-001 lists Salary, Freelance, Gifts, Interest, Refunds). It could also be a repayment, which should reduce spending rather than count as income.
  - This feeds Kept N% (INS-016) and the BDG-009 income pre-fill.

  *Fix:* Add a mapping table to CAP-004:
  - Salary → `income`, Salary;
  - From a person → `income`, Gifts (or a new "From people" income category);
  - Refund → `refund`, in the category learned for that payer, otherwise it waits;
  - Moved from my own account → transfer (CAP-012).

  State that a Refund credit with no learned category is not eligible. Add one acceptance case for an auto-approved refund.

- **[medium]** The §16.1 DEDUP suite still tests the old Merge rule. The DEDUP row reads "merge keeps earliest record and attaches sources". FIN-027 now merges "by **source authority**: account, amount and time come from bank, card or UPI evidence first …". A test written from the suite would reproduce the v1.3.2 H6 failure (a Cash receipt beats the card charge, so both balances are wrong), and §16.4 makes tests the proof of done. *Fix:* Change the row to "merge by source authority (FIN-027); receipt-then-card keeps the card account and receipt items; tip split".

- **[medium]** The SMS catch-up has no starting point (SEC-001, `sms_cursor`, SMS-014, CAP-009).
  - The catch-up reads the inbox "since the last message it processed (`sms_cursor`)". Nothing defines the cursor on first enable, after a "Not now" followed by enabling months later, or after restoring onto a new phone.
  - A null cursor reads the whole inbox, which can be years of bank SMS. Each unknown sender raises an SMS-017 prompt, and each unknown mask raises a CAP-009 prompt.
  - Once the user adds an account, its backlog becomes eligible. It is auto-approved into past periods as "before tracking started" spending (FIN-016), which rewrites old Insights and budgets.

  *Fix:* On first enable, set `sms_cursor` to the moment consent was given (or offer an explicit, previewed "Import the last 30 days?" that sends everything to review and never auto-approves). After a restore, keep the restored cursor. Add a GWT case.

- **[medium]** BDG-006's zero floor is ambiguous for the overall budget (BDG-006, §6.3, §10 Budget used, CAP acceptance on the ₹9,000 refund).
  - BDG-006: "a category total, a Needs/Wants bar or a budget's 'used' never goes below zero".
  - For the **overall** budget it is not said whether "used" is the floored sum of the categories or the floor of the net sum.
  - Example: Shopping net −₹7,000 and Food +₹10,000. The overall "used" is ₹10,000 (sum of floored categories) or ₹3,000 (floor of the net). Home's hero then shows either ₹40,000 or ₹47,000 left out of ₹50,000.
  - The worked acceptance has only Shopping, so it does not decide this.

  *Fix:* State it. Recommended: floor each category first, then sum, so the hero always equals target − Σ category bars and "Refunds this period" stays a separate line. Add an acceptance case with two categories.

- **[medium]** The GOAL acceptance cases assume which term of the Free to use formula binds (GOAL acceptance 1 and 4, BDG-008, GOAL-002).
  - BDG-008: Free to use = `min(Left in budget, included assets − reserved obligations)`. Set-asides reduce only the second term.
  - GOAL acceptance 1 says Free to use "is ₹12,400 lower" after a ₹12,400 set-aside. GOAL acceptance 4 says a ₹35,000 set-aside against ₹30,000 free shows "Short by ₹5,000".
  - Both hold only when the asset term binds. If Left in budget is the smaller term, Free to use falls by less, or not at all, and the warning "This leaves you short by ₹5,000" is wrong. A literal test fails against a correct formula.

  *Fix:* Give the inputs in both cases (e.g. "Left in budget ₹60,000, included accounts ₹50,000, no bills"). Have GOAL-004's warning compute its shortfall from the formula, not from the earlier Free to use figure.

- **[low]** Tombstones are permanent and silent (FIN-014, IMP acceptance). A tombstone match is "skipped and reported … never re-created". A capture rejected by mistake and purged after 90 days can then never come back through a re-import, and no override is offered. Separately, `removal_kind = excluded` (an import row excluded in review, TXN-008) has no retention or tombstone rule, and the PRD does not say whether a deleted CSV-imported row is a "Delete" or a "Reject". *Fix:* Add "Import anyway" on the per-row skip report. State retention and tombstoning for `excluded` rows, and which remove verb applies to imported rows.
- **[low]** The OCR-005 mismatch rule is implied, not stated. "Only an unreconcilable difference is flagged as a mismatch". The text implies that items + tax − discounts **below** the total is Not itemised and **above** it is a mismatch, but never says so. It also does not say whether tax and discount pro-rata includes the Not itemised row. *Fix:* State both in one sentence.
- **[low]** Residual acceptance gaps (no GWT case):
  - hide-amounts on → hidden notification form (SEC-005);
  - Delete permanently on a purchase with a linked refund (FIN-014);
  - a reversal arriving in a closed period not re-firing alerts (FIN-028);
  - SMS-014 re-ask limits;
  - the widget's "N to check" text and its hiding when N = 0 (HOM-007);
  - LRN-009 normalization.

  *Fix:* Add one GWT case each.

## Scope honesty — strong

The scope is explicit:
- §4.1 "All P1 items are committed; there is no ranked cut list. Schedule pressure moves the M3–M5 dates …", which fixes the old "staged rollout" wording;
- §13.0a/§13.2 per market and per build, now with SMS-001..017, LRN-001..010 and CAP-001..012;
- REC-007 is P2 and REC-008 sits inside SCR-16;
- GATE-05's iOS parity is marked Phase 2.

The single `[ASSUMPTION]` (SMS-016) round-trips to GATE-02 with a fallback. Open-item density is low, which suits a frozen PRD.

### Findings

- **[medium]** The beta-measurement build versus the Play closed track and the Data safety form (§16.3, SEC-002, §20 M3–M5, GATE-08, GATE-13).
  - §16.3 puts an "encrypted in-app upload" in "the separate beta-measurement build". SEC-002 bans `INTERNET` from release builds.
  - §20 runs closed betas A and B, where reference sets are collected, "on a Play **closed testing track** … which also satisfies the new-personal-account requirement (GATE-13)".
  - The PRD does not say whether the measurement build is the one testers get from the closed track, under the production package.
  - If it is, the package distributes a networked build, and the Play Data safety form (GATE-08) may have to declare data collection for the app. That would contradict the "no data collected" listing in every market. The 14-day closed test would also be running a build that differs from release in its network permission.

  *Fix:* State which one applies:
  - (a) the measurement build is a separate package, sideloaded or on its own track, and never under the production ID; or
  - (b) it is under the production ID, and GATE-08 confirms how the Data safety form treats a testing-track build with network access before M3.

## Downstream usability — adequate

Most of the PRD extracts cleanly. The stale-text tail from v1.3.2 is gone from both files:
- FLOW-15 and FLOW-17;
- Appendix A;
- the glossary entries for Mixed merchant and Left in budget;
- the §13.0a currency row;
- the addendum's widget text, ±3-day pairing, "needs a category" and Discard.

§11 is now close to complete:
- `removed_at` and `removal_kind`;
- derived "before tracking started";
- `sort_order`;
- `import_batch.raw_path`/`retain_until`;
- `recurring_rule.kind`;
- goal links in `goal_allocation` only;
- the clock guard;
- `sms_cursor` and `tombstone`;
- auto-approve settings kept only in the history table.

### Findings

- **[medium]** `learned_mapping` cannot hold the v1.3.3 learned decisions (§11.1, LRN-010, CAP-012, LRN-002).
  - `learned_mapping(key_kind[merchant|upi_id|item|category], target_kind[category|account], …)` has no target for a **credit type** (LRN-010: "ACME PVT LTD → Salary") and none for a **transfer choice** per payee or mandate (CAP-012: "the choice is learned per payee or mandate (e.g. a monthly SIP)" → Saved / invested into a given pot).
  - There is no `key_kind` for a payer/sender or a mandate.
  - These two lookups decide credit eligibility and SIP linking, so the architecture will invent its own tables for them.

  *Fix:* Extend the entity to `key_kind[merchant|upi_id|item|category|payer|mandate]` and `target_kind[category|account|credit_type|transfer_choice]`, with `credit_type?` and `transfer_target_account_id?`, or add a separate `learned_flow` entity.

- **[medium]** Five budget and period acceptance cases sit under §8.16 CAP. They are:
  - the payday change and shortened cycle (BDG-002);
  - the refund floor (BDG-006);
  - "effective now vs next period" (BDG-007);
  - the Free to use number (BDG-008);
  - the >10% income offer (BDG-009).

  Sara's cross-zone case (FIN-002) and the early-salary case (DEC-33) are also there. Epics are built per module (§21 WMB-06 Categories/budgets, WMB-09), and §22.1 needs a story's GWT before it is Ready. An agent pulling §8.5 for WMB-06 misses five of its ten cases. *Fix:* Move these cases into §8.5, and the FIN-002/DEC-33 cases into §7 or §8.5. Leave cross-references in §8.16.

- **[low]** The addendum is out of date against v1.3.3/1.3.4:
  - Its frontmatter still says `updated: 2026-11-01`.
  - §2 says "Auto-approve eligibility is a pure function of `source_record` + candidate state + cutoff". Eligibility now also depends on account resolution (CAP-009), the learned credit type (LRN-010), sender status, currency (TXN-013) and source kind (UPI-008).
  - §2's match summary leaves out "different references are never duplicates".

  *Fix:* Update §2's eligibility inputs and match rule, and bump the date.
- **[low]** The transfer-pair windows differ by source. CSV pairs use ±2 days (IMP-002), capture pairs ±3 days (CAP-012, addendum §2), and duplicates ±1 day (FIN-027). Using different values may be intended, but nothing says why, and FIN-027's "If both items carry a reference and the references differ, they are always distinct" can be read as forbidding CAP-012's pairing of a bank debit and a card credit, which have different references. *Fix:* Say that transfer pairing is not duplicate matching and is not limited by the reference rule. Either align the windows or state the reason they differ.

## Shape fit — strong

This is a consumer product at the top of a UX → architecture → stories chain, and its formality matches:
- 18 flows with named protagonists, including market and currency;
- a screen inventory;
- the capture status mapping as a shared UX/architecture contract;
- §16.4 traceability;
- Definitions of Ready and Done.

Technology and UX detail stay in the addendum under "the PRD wins on any conflict". The rigor is justified by the PRD's role at the top of the chain, even for a solo build. No findings.

## Resolved since v1.3.2

**From `review-rubric-v1.3.2.md`: 1 high and 10 medium findings.** 10 resolved, 1 partly resolved, 0 open.
- **Resolved:**
  - Savings bar for Indian users (high): ACC-009 savings pots, the "Savings Account" exclusion, SIP via "Saved / invested", and SCR-18 is need/want only.
  - GATE-02 had two deadlines: now M3 everywhere, and the build supports both outcomes.
  - Free to use for 50/30/20-only users (BDG-008 = Home's Left in budget).
  - CAP-007/FLOW-09 read-time wording.
  - Unlearned credits (CAP-007, LRN-010). A new mapping gap is listed above.
  - App-lock notification redaction (SEC-005 is the single source; hidden form offers only Review).
  - Free to use negative versus goals ("Short by ₹X" throughout). A new acceptance-input issue is listed above.
  - Retention contradictions (DEC-24/CAP-008 at 90 days, backups wording, Recently deleted, pair deletion, GWT cases).
  - Missing GWT for the v1.3.1/1.3.2 additions (all added).
  - §11 data-model gaps (all nine items).
- **Partly resolved:** CAP-012 auto-link outside FIN-026. It now happens in the write step with `auto_linked`, but the ordering conflict and the missing label and undo remain (medium above).

**From `review-adversarial-general-v1.3.2.md`: 2 critical, 11 high and 19 medium findings.** 31 resolved, 1 partly resolved, 0 open.
- **Resolved:** C1 (same-reference classification by account), C2 (unlearned credits wait), H1, H2, H3, H4, H5, H7, H8, H9, H10, H11, and M1–M19. M15 is resolved by replacing the pre-unlock inbox with the post-unlock catch-up; its new starting-point gap is listed above.
- **Partly resolved:** H6 Merge. The FR (FIN-027 source authority, with a TXN acceptance case) is fixed, but the §16.1 DEDUP suite still says "merge keeps earliest record" (medium above).

**Combined:** 43 critical, high and medium findings. **41 resolved, 2 partly resolved, 0 still open.** Most v1.3.2 low findings are also resolved: INS-001 presets, unallocated vs Not itemised, REC-007/008, GATE-05, adjective bounds, "staged rollout", the addendum contradictions, DEC-21, §13.2 ranges, and the TXN-006 row states. The remaining ones are listed under Mechanical notes.

## Mechanical notes

- **ID order** is still out of sequence, with no stability note:
  - FIN-016 before FIN-011, and FIN-026/027/028 before FIN-025;
  - TXN-012/013 before TXN-009;
  - CAP-012 between CAP-004 and CAP-005;
  - LRN-010 between LRN-002 and LRN-003 (new);
  - REC-009/010 before REC-008;
  - HOM-008 before HOM-007;
  - INS-007 before INS-005;
  - SCR-27..31 before SCR-25/26;
  - WMB-16..18 before WMB-13.

  IDs are unique and every cross-reference checked resolves. *Fix:* Add one line to §0: "IDs are stable; new IDs sit next to related items."
- **Stale cross-reference:** DEC-23 says "now specified in LRN-001–009", but LRN-010 exists. FIN-025 correctly says LRN-001–010.
- **Glossary (§10):**
  - "Capture resolution" omits `auto_linked`.
  - Still no entries for auto-approve or daily cutoff, Not classified, Not itemised, `needs_category`, Kept, tombstone, Recently deleted or Saved & invested.
- **"v1" as a release label** remains in §14 ("no server users/roles in v1") and in the §23 column header ("PRD v1 treatment").
- **Header date:** "Date: 17 October 2026 (rev. 1 November 2026)", while the frontmatter says `updated: 2026-11-07`.
- **§6.3 near-duplicate sentence:** "Each card has a clear period label." is followed directly by "Each card supports tap-to-details (where applicable) and a clear period label."
- **§16.1 suites lag the FRs:**
  - The CAP row's auto-approve exclusions omit unresolved accounts, unlearned credits, UPI screenshots and foreign currency.
  - The 5030 row has no savings-pot, SIP or pot-withdrawal case.
  - The DEDUP row's Merge wording is listed above.
- **§11 small items:**
  - `tombstone` says "salted hash" but no salt is stored or carried through backup and restore.
  - `removal_kind = rejected` duplicates `capture_resolution = rejected`.
  - `auto_approve_rule.effective_from` must be a timestamp for "applies immediately" loosening.
  - The BDG-009 user-entered income base has no field (`budget.template` only).
- **Change log:** there is still no 1.0.0 baseline row. The 1.3.3 and 1.3.4 rows are thorough.
- **Assumptions Index:** one inline `[ASSUMPTION]` (SMS-016), round-tripped to GATE-02 and §25. Acceptable at this density.
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. There is still no non-India flow for matching a receipt against an imported CSV row.
- **Required sections:** all present for a chain-top consumer PRD.
