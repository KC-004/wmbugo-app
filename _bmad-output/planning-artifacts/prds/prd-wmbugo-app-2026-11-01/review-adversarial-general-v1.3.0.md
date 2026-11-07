---
title: Adversarial review — wmbugo PRD v1.3.0
reviewed: prd.md v1.3.0 (all sections) + addendum.md
date: 2026-11-01
reviewer: adversarial general review (read-only)
---

# Adversarial review — wmbugo PRD v1.3.0

**Verdict:** The ledger invariants sound good, but the capture rules that feed them do not hold up. Auto-approve, transfer handling, duplicate detection and the 50/30/20 Savings formula each have a path where money gets counted twice or the "Am I okay?" number is wrong. A coding agent that follows the text literally will ship those paths.

Counts: **5 critical · 16 high · 21 medium · 9 low**

Owner decisions are not argued here: Android-only, solo developer, international launch, no cut list, and 50/30/20 in Phase 1. Every finding is about how the PRD specifies them.

---

## CRITICAL

### C1. Card-bill payments, ATM withdrawals and own-account moves are auto-approved as spending or income
**Location:** CAP-004, CAP-007, CAP-010, FIN-013, FIN-026(3)/(4), FLOW-16, §16.2 P0 "no duplicate confirmed counting"

**Failure scenario:**
- Arjun's HDFC card charges arrive as SMS, are auto-approved, and count as expenses.
- On the 5th his bank sends "Rs 42,000 debited … towards HDFC Credit Card". It is a debit from a verified sender and fully parsed, so it is CAP-007-eligible. The learned category is Bills, or Uncategorised. At 21:00 it is counted as a ₹42,000 expense.
- His spending for the month is now counted twice.
- An ATM withdrawal SMS (FIN-013 says it is a transfer to Cash) is also auto-approved as an expense. The cash he then spends and logs by hand is counted a second time.
- CAP-004 and CAP-010 offer "Moved from my own account" **only on credits**. The debit leg of FLOW-16 has no transfer option, and it may already be materialized as an expense before the credit SMS arrives (NEFT credits can land the next day).
- FIN-026(4) forbids rewriting past totals. Linking the credit tomorrow therefore has to rewrite yesterday's materialized expense, and the PRD never says that is allowed.
- Credits get the same treatment: a salary, a refund or an own-account credit with no learned type is auto-approved as some kind of income, which inflates "Kept N%" and the 50/30/20 income base.

**Fix:**
- Add an auto-approve exclusion to CAP-007. These are never eligible:
  - debits whose parsed text or payee matches card-payment, ATM, self-transfer or own-account patterns, or whose counterparty is a known owned masked account;
  - any credit without a learned type.
- Add "Moved to my own account / Paid my card / Cash withdrawal" choices to debit captures.
- State explicitly that linking a transfer may convert an already-materialized expense, as an audited edit under FIN-014. This is the one carve-out from FIN-026(4).
- Add CAP acceptance cases: a card-bill debit SMS is never counted as expense, and an ATM debit is never counted as expense.

### C2. The 50/30/20 Savings bar double-counts "Moved to savings" goal contributions
**Location:** BDG-009, INS-020, GOAL-002 acceptance

**Failure scenario:**
- BDG-009: "Savings is the sum of transfers into accounts marked savings **plus** goal contributions of type 'Moved to savings'."
- GOAL acceptance: "a ₹5,000 'Moved to savings' contribution … is **one transfer into the savings account**, counts toward the Savings bar."
- A literal implementation sums the transfer (₹5,000) and the goal contribution (₹5,000), so the Savings bar shows ₹10,000. This is the brand-mark feature.
- Further gaps:
  - A "Moved to savings" contribution into an account **not** marked savings is undefined.
  - Moving money back out of savings (savings → current) is undefined: gross or net?
  - Indian users mostly save through SIP and mutual-fund debits. Those are expense debits to a non-account and land in Needs/Wants or Not classified, so the Savings bar is near zero for the core persona.

**Fix:**
- Define Savings once, as **net transfers into savings-marked accounts in the period**. A goal "Moved" contribution is only a tag on that transfer and never adds to the sum.
- Decide whether outflows from savings net off, and say so.
- Add a category type `savings` (or an "investment" account type) so SIP/RD/insurance debits can count toward Savings without becoming expenses.
- Add an acceptance case: a ₹5,000 moved contribution shows ₹5,000 on the Savings bar, not ₹10,000.

### C3. Read-time auto-approve breaks the "one set" rule, duplicate detection and past-total stability
**Location:** FIN-024, FIN-026 (2)/(4)/(5), CAP-007, HOM-007, TXN-008, §6.7

**Failure scenario:**
- FIN-024 says pending captures, review-queue items and the widget count "are the same set: all `needs_review` items".
- FIN-026(2) says that after the cutoff, eligible items are still **stored** `needs_review` but are **shown as Recorded and counted in totals**.
- So at 21:30, before the app is opened:
  - the widget (reading `needs_review`) shows ● 6, the Home card says "6 to check", and the same six are already inside "Left in budget";
  - the evening summary, built by a scheduled notification, cannot run the read model;
  - CSV export and backups taken in that window write them as `needs_review`.
- Duplicate detection is broken too:
  - The headless SMS receiver is not an "app open", so it does not materialize.
  - A duplicate SMS arriving at 22:00 is checked against "existing confirmed transaction" (§7.4). The derived item is not stored as confirmed, so it is not found.
  - Per FIN-026(5), the original then "stays needs_review". The total the user saw at 21:30 silently shrinks at 22:05.
  - FIN-026(4) promises totals are never rewritten.
- "Eligible captures from before **the cutoff**" never says which cutoff. An agent comparing against today's 21:00 will not count a Monday 18:00 capture until Tuesday 21:00 when the user opens the app on Tuesday morning.
- `auto_approve_rule_effective_from` is a single field. Two rule changes before materialization lose the rule that should apply to yesterday.

**Fix:**
- Make the pending set explicit: pending = `needs_review` AND NOT derived-eligible-past-cutoff. Route the widget, the Home card, the Activity dot, the evening summary and exports through one shared selector.
- Require every write path (headless SMS receiver, notification action, share intent, widget, restore) to run materialization first, inside the same DB transaction, before dedup.
- Specify "the cutoff" as the most recent cutoff instant at or before now, in profile time.
- Keep a rule-history table instead of one field.
- Decide what happens to an already-counted item when a late duplicate arrives. Recommended: it stays counted and the newcomer is the `possible_duplicate`.

### C4. A manual entry flagged as a possible duplicate is saved as confirmed, so it counts twice
**Location:** TXN-012 vs FIN-024, TXN-008, §3.3 counter-metric, §16.2 P0

**Failure scenario:**
- TXN-012: "A manual entry that matches an existing confirmed item is saved **as confirmed** with the `possible_duplicate` flag and appears in the review queue."
- FIN-024: "Only confirmed non-excluded items contribute to headline totals". So both copies are counted until the user acts, which violates the P0 "no duplicate confirmed counting" and the counter-metric "Duplicate confirmed entries = 0".
- FIN-024 also defines the review queue as exactly the `needs_review` set. A confirmed item cannot appear there, so the two sections contradict each other.
- OCR-011 does the opposite for receipts: a later capture is `needs_review` and not counted. Two engineers will build two different duplicate states.

**Fix:**
- Pick one rule. Either the new manual entry is `needs_review` + `possible_duplicate` (not counted, shown with a "Waiting for you" chip), or the P0 is restated as "no duplicate counted after review".
- Extend the FIN-024 queue definition to cover whatever is chosen.
- Add a GWT case for manual-after-SMS and SMS-after-manual.

### C5. "Left in budget" under 50/30/20 leaves out every uncategorised and auto-approved capture
**Location:** §6.3 item 2, CAP-007, CAP-006 (CAT), OCR-005, HOM acceptance

**Failure scenario:**
- With only 50/30/20 set, the hero is "Needs + Wants targets against needs + wants spending".
- Three kinds of spending land in the fourth **Not classified** segment:
  - CAP-007 confirms every capture without a learned category as **Uncategorised**, which in the first weeks is most of them;
  - OCR-005 "Not itemised" amounts;
  - categories with no type.
- That segment is in neither Needs nor Wants, so it never reduces "Left in budget".
- Priya's first two weeks: ₹30,000 of auto-approved UPI spend, hero still near full. The most-watched number in the product says she is fine when she is not.

**Fix:**
- The 50/30/20 hero must use **total confirmed expense** (Needs + Wants + Not classified) against Needs + Wants targets, or show Not classified explicitly as consuming headroom.
- Add an acceptance case: a ₹1,000 auto-approved Uncategorised capture reduces Left in budget by ₹1,000.

---

## HIGH

### H1. The profile timezone is undefined; travel and DST are left to the implementer
**Location:** FIN-002, FIN-026(1), §6.5, §11.1 `profile.timezone_id`, `transaction.timezone_id`, §15 "Date/time change"

**Failure scenario:** Sara (London) flies to Dubai.
- Engineer A keeps `profile.timezone_id = Europe/London`. Her 23:30 Dubai dinner is grouped on the previous London day, and the 21:00 cutoff fires at 01:00 Dubai time.
- Engineer B follows the device timezone. Day groups and payday-cycle boundaries move under her, and past days re-group.
- FIN-002 promises "a clearly defined recalculation effect after timezone changes" but never defines one. The transaction stores its own `timezone_id`, so it is unclear whether grouping uses the transaction's zone or the profile's.

**Fix:**
- State the rule. Recommended:
  - each transaction's `local_date` is frozen at capture time, in the zone where it happened;
  - periods and the cutoff use the profile zone;
  - the profile zone follows the device only after a user prompt.
- Add GWT cases for a cross-zone trip and a DST change week.

### H2. Duplicate-match rules are unspecified while "0 duplicates" is a P0, and Merge is undefined
**Location:** IMP-004, SMS-005, OCR-006, TXN-012, addendum §2 ("within N minutes"), IMP acceptance, SCR-10

**Failure scenario:**
- The fuzzy window ("amount + time window + merchant fuzzy") has no numbers. One engineer uses ±10 minutes, another ±2 days.
- Two genuine ₹20 teas ten minutes apart are both flagged `possible_duplicate`. Neither is auto-approved, and every tea needs a manual check.
- A CSV with two identical £3.50 Pret rows on the same day and no reference produces the same fingerprint. The second row is skipped on the first import, so real spending is lost.
- "Merge" never says which record survives, whose amount, category and timestamp win, or what happens to attachments and source records.

**Fix:**
- Put concrete match keys and windows in the PRD, per source pair (SMS↔UPI, SMS↔CSV, receipt↔any): reference exact; else amount equal plus a date window plus a merchant similarity threshold.
- Fingerprint CSV rows with an occurrence index, so the Nth identical row in one file is distinct.
- Define Merge: keep the earliest confirmed record and attach the other's source_record and attachments to it; let the user pick the category.
- Add GWT cases for identical legitimate purchases.

### H3. Using the UPI reference as a dedup key swallows failed-payment reversals
**Location:** UPI-005, IMP acceptance ("matching reference links"), FIN-003 `reversal`, addendum §5

**Failure scenario:**
- A UPI payment fails after the debit. The bank SMS "debited ₹2,000 … UPI Ref 4123…" is followed by "₹2,000 reversed/credited … UPI Ref 4123…".
- The rule "same reference = same transaction" links or skips the credit. The debit stays confirmed, and the balance is ₹2,000 too low.
- The same happens with merchant refunds that reuse the original RRN.
- A screenshot of a *pending* or *failed* PhonePe screen parses as a payment.

**Fix:**
- Make the dedup key (reference, direction, event type). A same-ref opposite-direction item becomes a linked reversal or refund (FIN-003), never a duplicate.
- UPI-001 parsers must reject non-success status screens.
- Add these as UPI/SMS fixtures.

### H4. Auto-approved guesses feed learning, so wrong categories reinforce themselves
**Location:** FIN-026(3) ("learning … run exactly once" after materialization), LRN-001, LRN-003, counter-metric "wrong-category auto-approvals ≤ 10%"

**Failure scenario:**
- One wrong guess (Swiggy Instamart → Food) is auto-approved five nights running.
- If materialized auto-approvals count as "confirmations", the last 5 confirmations are all Food. LRN-003's mixed flag never fires, and the error becomes permanent.
- The PRD never says whether `auto_approved` counts as a confirmation for LRN-003 or `recent_confirmations`.

**Fix:**
- Only `user_approved` actions and explicit edits teach. An auto-approval may refresh recency but never adds evidence.
- Add an LRN acceptance case for this.

### H5. One balance chain per sender, cards read as bank accounts, and colliding ••last-4 masks
**Location:** SMS-012, CAP-009, §11.1 `sender(last_balance_minor, account_id)`, FLOW-15, addendum §2

**Failure scenario:**
- SMS-012 checks the balance chain "for that account", but the data model stores `last_balance_minor` on **sender**. HDFCBK sends for a savings account and a credit card, so the chain mismatches on every alternate SMS. Captures are flagged suspicious and never auto-approved.
- Card SMS quote "Avl Lmt" (available credit), not a balance. CAP-009 "Add it" "creates a **bank** account" with opening balance = available limit ± txn, so a liability becomes a ₹2 lakh asset inside "In accounts".
- "It's one of mine" links ••7730 **permanently** across all banks. ICICI ••7730 and an Axis card ••7730 merge.

**Fix:**
- Key the chain on (sender, masked_id).
- Classify "card / A/c" from SMS wording and offer the account type in the Add-it prompt. Never derive an asset balance from an available-limit figure.
- Key masked identifiers by (bank/sender, mask).

### H6. Literal DLT header matching will miss most bank SMS
**Location:** SMS-010 (`AD-HDFCBK`), SMS-017, §10 Verified sender, addendum §5

**Failure scenario:**
- Headers arrive as `AD-HDFCBK`, `VM-HDFCBK`, `JD-HDFCBK`, `BZ-HDFCBK` and so on (operator and circle prefixes).
- TRAI's 2024–25 scheme also appends category suffixes (`-S`, `-T`, `-P`, `-G`).
- An agent writing `allowList.includes(sender)` with the PRD's example will recognise HDFC on one operator only. SMS-017 will then nag "New sender HDFCBK?" for every variant.

**Fix:**
- Specify normalization: strip the 2-letter prefix and any `-[STPG]` suffix, uppercase, then match the 6-character entity.
- Allow-list entries are the normalized entity.
- Add fixtures for each header variant.

### H7. The candidate OCR SDK conflicts with the "no outbound request" acceptance
**Location:** SEC-002 acceptance, NFR-02, DEC-15, addendum §1 (ML Kit bundled), §13.3

**Failure scenario:**
- ML Kit, even with the bundled model, is governed by Google terms that allow usage and diagnostic metrics to be sent to Google.
- The proxy test fails at M4 after OCR is built on it. Alternatively, the Play Data safety form is filled as "no data collected" while an SDK sends data, which is a store-policy and GDPR/DPDP disclosure problem.
- Separately, the PRD never says whether the release manifest declares `INTERNET`. Without that, "never initiates" can only be checked by sampling flows.

**Fix:**
- Require the release build to omit the `INTERNET` permission. That gives a structural guarantee and makes any SDK call fail closed.
- Add GATE-05 evidence that the chosen OCR stack works and is compliant without network, or pick a fully offline engine.
- Add "Data safety form matches SDK behaviour" to GATE-08.

### H8. Collecting real receipts and UPI screenshots contradicts "synthetic-only fixtures" and captures third-party data
**Location:** §20 M3 exit ("consented reference receipt and screenshot sets collected"), §8.11 delivery-risk note, §16 ("Fixtures contain synthetic data only"), SMS-009

**Failure scenario:**
- Beta testers' UPI screenshots carry payee names, UPI IDs and phone numbers of people who never consented. Receipts carry card fragments and loyalty IDs.
- The developer becomes a data controller or fiduciary under GDPR and DPDP, which the privacy policy (published at M1) does not cover.
- The repo-and-CI rule says synthetic only, so the reference set cannot live where the accuracy CI metric runs.

**Fix:**
- Define a reference-set protocol: consent text, redaction of third-party identifiers, storage outside the repo, a retention limit, and deletion on request.
- Cover it in the GATE-08 review.
- Alternatively, restrict CI to synthetic or re-typeset receipts and run real-set accuracy as an offline, documented device test.

### H9. SMS captured while the device or app is locked, or before first unlock after reboot, can be lost
**Location:** SEC-001, SEC-004, NFR-16, SMS-003, addendum (SQLCipher key in Keystore)

**Failure scenario:**
- After a reboot, before the user's first unlock, Keystore credential-encrypted keys are unavailable. The SMS receiver cannot open the encrypted DB, and the debit is dropped.
- If the architect binds the DB key to user authentication to satisfy NFR-10, every headless capture fails while the app is locked.
- NFR-16 measures only "while the app process is alive", so tests never see this case.

**Fix:**
- Require an encrypted, append-only capture inbox, readable in direct boot or under a separate non-auth-bound key, that is drained into the ledger on next DB open.
- Add a GWT case: an SMS arriving before first unlock after reboot appears as a capture after unlock.
- State whether the DB key is auth-bound, and reconcile that with NFR-10.

### H10. "Left in budget for the default period" ignores each budget's own period
**Location:** §6.3 item 2, DEC-33, BDG-001/002, BDG-008, HOM acceptance

**Failure scenario:**
- Arjun's default period is his payday cycle (25th–24th), but he created an overall budget with a *monthly* period. The hero cannot be both.
- If he has a weekly and a monthly overall budget (BDG-002 allows it), the PRD never says which one is "the overall budget".
- The BDG-008 Free-to-use formula uses `budget_remaining` with no rule when there is no overall budget, or when it has a different period.

**Fix:**
- Either make the default period the only period an *overall* budget may use, or have the hero use the overall budget's own period and label it.
- Allow at most one overall budget at a time.
- Define Free to use when no overall budget exists (for example, the gate fails with "Set a limit").

### H11. Refund treatment is undefined across budgets, Needs/Wants, Kept and Insights
**Location:** FIN-021, FIN-023, BDG-006, INS-003/016/020, CAP-004 ("Refund"), §10 Expense/Budget used, §11.1 (no refund link)

**Failure scenario:**
- A ₹3,000 Amazon refund arrives in November for an October purchase, captured from SMS with no link. Engineers differ on four points:
  - Does it reduce November's Shopping budget, reduce October's, or count as income?
  - Is it in "Kept N%" income?
  - Does it reduce the Wants bar?
- §10 says "Expense = net after related refunds", but the data model has no `refund_of_id`. Only `reversed_by_id` exists, so linked refunds cannot even be stored.
- FIN-021 says income "reduces liabilities only for refunds, reversals and payments to a liability account". That contradicts FIN-013/DEC-19, where card payments are transfers.

**Fix:**
- Add `refund_of_transaction_id`.
- Rule: a refund reduces spending in the **refund's** period, in the original's category (or a chosen category if unlinked). It is never income, never in Kept income, and it reduces Needs/Wants by type.
- Rewrite FIN-021 so card payments are transfers.
- Add GWT cases across a period boundary.

### H12. The OCR "quality floor" promises the impossible and has no answer for negatives, tax or tips
**Location:** OCR-005, FIN-022, OCR-010, §3.3 (receipt total ≥ 90%), §13.0a (US/Canada)

**Failure scenario:**
- "The total is always the receipt's real total" contradicts the 90% accuracy target. An agent will treat the parsed total as authoritative and show no confidence warning.
- OCR double-reads a unit price and a line total, so the items sum to more than the total and "Not itemised" goes **negative**: negative Uncategorised spend.
- US sales tax and EU VAT-inclusive lines: tax is never allocated to item categories. It all lands in Not itemised and Uncategorised, so the 50/30/20 bars are skewed.
- US restaurants: the card charge includes a tip and the receipt total does not. They never "probably match", so the receipt and the later CSV row are counted twice.

**Fix:**
- Replace "always the real total" with "the total is user-confirmed. A low-confidence total is highlighted and must be tapped to confirm".
- Clamp: if items exceed the total, flag a mismatch instead of producing a negative row.
- Allocate tax and fees pro-rata to item categories (state the rounding rule).
- Give match tolerance for tips (for example, the charge is 0–30% above the receipt total, same merchant and date) and send those cases to review.

### H13. Materialization auto-advances bill rules, but REC-009 requires the user's "Yes"
**Location:** FIN-026(3) ("bill-rule advance (REC-004/REC-009) … run"), REC-009, CAP-011

**Failure scenario:**
- An eligible ₹18,000 capture near the Rent due date is auto-approved overnight. FIN-026 runs "bill-rule advance" and marks Rent paid.
- In fact it was a different ₹18,000 payment (a deposit to a friend). REC-009 said linking needs "Yes, link it". FIN-026 bypasses that.

**Fix:**
- Auto-approve never links a bill. Materialization may only *surface* the "Rent paid?" prompt again.
- Alternatively, make any auto-link explicit, labelled and undoable, and add it to the CAP acceptance cases.

### H14. Market promises exceed the currency list, and region and currency are decided by one fragile pre-select
**Location:** §1, DEC-27, §13.0a currency list, ONB-002 ②, SET-002, SMS-015

**Failure scenario:**
- "UK and Europe" ships only GBP and EUR. Swiss, Swedish, Norwegian, Danish, Polish, Czech and Hungarian users cannot use their currency.
- "SE Asia" is SGD and MYR only: no THB, IDR, PHP or VND. IDR and VND are effectively 0-decimal despite ISO, which tests "exponent from ISO" assumptions.
- An Indian user with an `en-US` device locale gets USD pre-selected, records a few entries, and is then blocked from changing currency (SET-002). SMS and UPI features also vanish.
- Three things can decide "is SMS/UPI UI shown": the build flavor, the selected region and the Play country. For an `sms` build user who picks region UK, nothing says which one wins.

**Fix:**
- Either narrow the market claims to the listed currencies, or extend the list (config only, per §13.0a).
- Pre-select currency from the device *region*, not the language locale, and add an explicit confirm step.
- Allow currency change while only onboarding data exists.
- State a single gating rule: feature shown = build supports it AND profile region = India.

### H15. "Reject" means "exclude" everywhere except OCR-010, where it creates a second expense
**Location:** OCR-010 vs DEC-21, DEC-24, FIN-024, SCR-23, OCR acceptance ("Attach to it / Keep separate")

**Failure scenario:**
- OCR-010: "Approve attaches … **Reject saves it as a separate expense**."
- DEC-24 and FIN-024: Reject sets `excluded`.
- An agent reusing the shared Approve/Reject component will exclude the receipt, so the user loses it. One building from OCR-010 will create a second confirmed expense with the "Reject" label, which is exactly the double count users fear.

**Fix:**
- Remove Approve/Reject wording from OCR-010. Use "Attach to it / Keep separate" (as in the acceptance and addendum) and a third "Discard".

### H16. The Play "one package, two variants by country" assumption sits on the critical path with no fallback
**Location:** SMS-016 [ASSUMPTION], DEC-07, GATE-02, §20 M3/M5

**Failure scenario:**
- If Play does not allow a different manifest (SMS permission) for India-only distribution in one package, a second package is needed. That means a second listing, a second privacy policy entry, separate reviews, and, if approval arrives after launch, migrating Indian no-SMS users to the other package.
- The PRD says nothing about that migration (backup → restore across packages, the learned senders, the review state).
- The application ID is chosen at M1. Picking wrong is expensive to undo.

**Fix:**
- Resolve GATE-02 before choosing the application ID and flavor structure (M1, not M3).
- Specify the two-package fallback, including the cross-package backup/restore path and its GWT case.

---

## MEDIUM

### M1. Import is described as both "atomic" and "partial commit"
**Location:** FLOW-07 ("atomic commit"), Appendix A #5, IMP-005 (batches of 500; partial failures), IMP acceptance (row 57 fails, other rows commit)

**Scenario:** A 1,200-row import is killed after batch 2. It is unclear whether 1,000 rows stay or 0.

**Fix:** Say "each batch is atomic; the import is resumable and idempotent; bad rows are skipped and reported". Remove "atomic commit" from FLOW-07.

### M2. CSV realities are missing: encodings, sign conventions, transfer detection
**Location:** IMP-001/002/003

**Scenario:**
- European bank exports in Windows-1252 with `;` delimiters and decimal commas are UTF-8-only per IMP-001.
- Card CSVs record charges as positive.
- Importing both the bank CSV (payment to card) and the card CSV (payment received) creates an expense plus income, not a transfer.

**Fix:**
- Add encoding detection or selection.
- Add a per-mapping "flip sign" option.
- Run transfer-pair detection across owned accounts during import and send matches to review.

### M3. The payday cycle is undefined at its edges
**Location:** ONB-002 ④, DEC-33, BDG-009, INS-004

**Scenario:**
- Salary due on the "last day" arrives early because the 31st is a Sunday. It lands in the previous cycle, so this cycle shows "No income recorded" and 50/30/20 has no base.
- Is cycle start inclusive?
- INS-004 "same days of the previous period": does that mean cycle-relative day N or calendar dates?
- Is the BDG-009 income base user-entered (FLOW-14 "confirm … income") or actual? And is it re-derived each cycle?

**Fix:**
- Define the cycle as [payday, next payday) in the profile zone.
- Add a "last working day" option and an "income arriving up to 3 days early belongs to the next cycle" rule.
- Make the 50/30/20 base explicitly entered, with an option to update it when income changes.

### M4. The evening summary and rule changes quietly need background work
**Location:** CAP-007, DEC-22, SET-003

**Scenario:**
- A notification scheduled for 21:00 is built at schedule time, so its counts are stale. Computing them at fire time needs a worker, which the "nothing depends on a background job" design avoids.

**Fix:**
- State that the summary is computed at fire time by WorkManager (best effort), or generated at the next open, and that it never affects data.

### M5. Data-model gaps that contradict features
**Location:** §11.1

**Scenario:**
- `transaction.source_record_id` is singular, so a merged SMS + receipt + CSV transaction, or a CAP-010 two-capture transfer, loses provenance.
- There is no refund link (see H11).
- `foreign_amount_minor` has no stored exponent: is a JPY foreign amount ×1 or ×100?
- `transaction.currency` and `account.currency` are redundant with one currency per profile and invite divergence.

**Fix:**
- Make provenance many-to-one via `source_record.transaction_id` only.
- Add `foreign_currency_exponent`.
- Drop per-row currency, or enforce it with a constraint.

### M6. The claim that every §8 module has Given/When/Then is false
**Location:** §25 last line, §24.1 change log vs §8.1, 8.2, 8.3, 8.5 acceptance

**Scenario:**
- ONB, ACC, TXN and BDG acceptance is prose ("previous-period … unaffected").
- BDG-009 (50/30/20 maths) has no GWT at all, and that is where C2 lives. Stories inherit nothing testable.

**Fix:** Write GWT for ONB, ACC, TXN and BDG, including worked 50/30/20 numbers.

### M7. Outside India, the capture pipeline, notifications and auto-approve have nothing to act on
**Location:** §13.2, CAP-001, DEC-22, HOM-007, §3.3 "Auto-approve comprehension"

**Scenario:**
- In other markets the only "capture" is a user-initiated receipt match in the app. A notification for something the user just did is nonsense.
- The widget's pending count is effectively always 0.
- In India's no-SMS build, the PRD never says whether a UPI-share dialog the user dismisses becomes pending and auto-approvable.

**Fix:**
- State per market which CAP items are live.
- Define "dismissed share dialog = `needs_review`, eligible per CAP-007" (or not).

### M8. App lock contradicts what notifications and the widget show
**Location:** SEC-005, CAP-001, SEC acceptance ("unlock required before any amount is shown"), HOM-007, HOM-008

**Scenario:**
- With app lock on and the device unlocked, the capture notification shows the amount and merchant, which contradicts "unlock required before any amount is shown".
- The widget can show amounts while app lock is on.
- It is unclear whether hide-amounts covers notifications and the widget.

**Fix:**
- When app lock is on, notifications use the public version unless the user explicitly opts in.
- The widget never shows amounts while app lock is on.
- Define hide-amounts scope across the app, widget and notifications.

### M9. The widget count breaks the "no counts" rule
**Location:** DEC-16 ("never a count badge"), §6.7 ("never numeric badges"), HOM-007/SCR-29 ("pending count"), addendum ("● count")

**Fix:** Decide whether the widget shows a number or a dot, and amend the rule in one place.

### M10. Retention is undefined for SMS bodies, deleted entries and rejected captures
**Location:** SMS-004 ("define retention period"), FIN-024 (manual Delete is soft, kept in backups), FIN-014

**Scenario:**
- An agent picks "forever".
- A user's "Delete" never deletes, and backups carry it too. This conflicts with user expectation and with erasure rights in the GDPR/DPDP review.

**Fix:**
- Set numbers: raw SMS body not retained, or 7 days; soft-deleted rows purged after N days.
- Add "Delete permanently" in detail and in the Data settings.

### M11. Three names for leftover receipt money
**Location:** OCR-005 (Not itemised, reported as Uncategorised), FIN-022 (explicit *unallocated amount*), TXN-009 (*unallocated* placeholder while editing), CAT-006

**Scenario:** One engineer creates a split to the Uncategorised category, another leaves an unallocated remainder. The split invariant "allocation sum = amount exactly" passes for one and fails for the other.

**Fix:** "Not itemised" is a split row to the seeded Uncategorised category with `unparsed=true`. "Unallocated" exists only in the editor and blocks Save.

### M12. Some metrics and NFRs pass trivially or cannot be tested
**Location:** §3.3, NFR-10, NFR-16

**Scenario:**
- "≥ 70% resolved with zero or one tap" is met by ignoring everything, since auto-approve is zero taps.
- "Market comprehension: no India-only features encountered" is guaranteed by code, so it measures nothing.
- "Scam false positives = 0 in fixture corpus" is self-authored.
- NFR-10 "inaccessible on locked device" has no stated threat model.
- NFR-16 excludes the dead-process case.
- "Learning effect falls week over week" has no threshold.

**Fix:**
- Measure taps on the *correct* outcome.
- Drop or replace the tautological metrics.
- Add a cold-process NFR-16 target.
- Give the learning metric a target (for example, ≥ 30% fewer corrections by week 3).

### M13. Budget threshold alert semantics are underspecified
**Location:** BDG-004, SET-003 caps, SET acceptance

**Scenario:**
- A jump from 74% to 91% crosses both 75 and 90. "Exactly one alert" does not say which one.
- Deleting an expense (91 → 85) then re-adding it: does 90 fire again?
- Four bill reminders on the same day against a cap of "3 others": which one is dropped?

**Fix:**
- Fire only the highest threshold crossed; once per period, regardless of re-crossing.
- Bills take priority over budget alerts within the cap, and overflow is merged into one.

### M14. End-of-month recurrence can drift
**Location:** REC-006

**Scenario:** A rule due on the 31st goes Jan 31 → Feb 28 → Mar 28. That passes the written acceptance.

**Fix:** Keep the anchor day and add the GWT case "Feb 28 → Mar 31".

### M15. "Widget" is reused for Home cards
**Location:** HOM-004 ("Widgets refresh … foreground resume"), §4.1 ("customizable widget visibility/reorder"), §5.3 ("flexible widgets")

**Scenario:** HOM-001 reserves "widget" for SCR-29. An agent reading HOM-004 builds launcher-widget refresh logic.

**Fix:** Replace these uses with "Home cards".

### M16. Changing the device clock forces auto-approval
**Location:** §17 ("OS time manipulated"), FIN-026

**Scenario:** Setting the clock to 21:01 materializes every pending capture irreversibly as `auto_approved`, possibly including items that would have become duplicates.

**Fix:** Use a monotonic or last-seen-max time guard. Materialize only if now ≥ cutoff and now ≥ `last_materialized_at`.

### M17. The scam heuristic will flag genuine bank SMS
**Location:** SMS-011

**Scenario:** Indian bank SMS routinely contain links ("Not you? Call/visit hdfcbk.io/…") and the word "KYC" in reminders. A "link + KYC wording" rule flags genuine debits.

**Fix:** Base scam detection on verified sender status first. Allow-listed senders are never scam-flagged, only warned.

### M18. "Outstanding" and "due" are used interchangeably for cards
**Location:** ACC-003, ACC-007, §6.3 "Card dues"

**Scenario:** It is unclear whether Pay card bill pre-fills the total outstanding or the statement due, and whether Card dues on Home is outstanding or due.

**Fix:** Pick one and add statement balance as an optional field.

### M19. Opening balance effective date: instant or date?
**Location:** FIN-016, DEC-18, ONB-002 ③ ("balance today"), §11.1 `opening_effective_at`

**Scenario:** An account is created at 15:00 "today". A delayed SMS for 11:00 today arrives. Whether it changes the balance depends on date versus instant, which gives an off-by-one balance.

**Fix:** The opening balance applies at an instant, and same-day earlier transactions are "before tracking started". Alternatively, define it at end of the previous day. Add a GWT case.

### M20. No normalization rule for merchant learning keys
**Location:** FIN-025, LRN-001/003

**Scenario:**
- "SWIGGY*ORDER 8812", "Swiggy" and "Swiggy Instamart" are either one key, which wrongly triggers the mixed flag, or three, so nothing is learned.

**Fix:** Specify a minimal normalization (case, punctuation, trailing IDs and numbers stripped) and that the alias is user-editable.

### M21. FIN-021 contradicts FIN-013 on card payments
**Location:** FIN-021

**Scenario:** "income … reduces liabilities only for … payments to a liability account" reads as card payment = income-type. An agent builds it that way.

**Fix:** Rewrite FIN-021 with a posting table per event type, covering sign, account side, and whether it counts in spending or income.

---

## LOW

### L1. Document status contradicts itself
**Location:** frontmatter vs header vs §0 vs §20 M0

The frontmatter says `status: final`, the header says "Proposed baseline for stakeholder approval", §0 says "frozen", and §20 M0 says "approve this PRD".

**Fix:** Pick one.

### L2. The presets list differs in two places
**Location:** INS-001 vs §6.5

INS-001 omits This/Last pay cycle and Yesterday, but DEC-33 makes the pay cycle the default.

**Fix:** Align the two lists.

### L3. "Reduce-transparency" is an iOS setting
**Location:** §6.6

Android has no such switch, so an agent will search for an API that does not exist.

**Fix:** Name the Android signals: battery saver, the animator duration scale set to 0, and no RenderEffect support before API 31.

### L4. "Recorded · category guessed" is shown when nothing was guessed
**Location:** FIN-024 table, CAP-007

An Uncategorised `needs_category` auto-approval gets that label even though no category was guessed.

**Fix:** Add a label such as "Recorded · needs a category".

### L5. The "five row states" omit rejected and needs-category rows
**Location:** TXN-006

**Fix:** Enumerate all row states.

### L6. Schedule order is inverted
**Location:** §20 M1, M5

The privacy policy is published at M1, before the GATE-08 paid review. The 14-day/12-tester closed test is placed after M4 instead of being run as the M3/M4 closed betas on a Play closed track.

**Fix:** Run closed betas on a Play closed track so they satisfy GATE-13, and publish a reviewed policy, or mark the M1 policy as provisional.

### L7. The goal and bill double-reservation acceptance is undefined
**Location:** GOAL-004 acceptance

There is no reservation object for bills, so the test cannot be written.

**Fix:** Define what "reserved for a bill" means, or drop the case.

### L8. Lakh grouping on Hermes is unverified
**Location:** FIN-001, addendum Formatting

`Intl.NumberFormat('en-IN')` lakh grouping and `de-DE` formatting under Hermes on Android need a spike. INTL tests may pass in Jest/Node and fail on device.

**Fix:** Run the INTL suite on device.

### L9. The PLAT and UX suites list iOS cases in Phase 1 suites
**Location:** §16.1

PLAT includes "iOS picker/camera" and UX includes VoiceOver.

**Fix:** Mark them P2 so Android release gates are not blocked.
