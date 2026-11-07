# Validation Report — wmbugo PRD v1.3.0

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/prd.md`
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Run at:** 2026-11-01
- **Grade:** Poor

## Overall verdict
v1.3.0 is a strong, decision-ready PRD. The decision register, the named gates with solo-review substitutes, FIN-026's auto-approve materialization rules and the capture status mapping close almost every high finding from the v1.3 draft review. Four real defects remain, and they sit where the product makes its most visible promises. The 50/30/20 Savings formula double-counts "Moved to savings" contributions. The Home hero under a 50/30/20-only setup ignores "Not classified" spending, so "Left in budget" can be overstated. TXN-012 creates a confirmed + `possible_duplicate` state that contradicts FIN-024, the status mapping and the no-double-count P0. And §25 claims Given/When/Then acceptance for every §8 module when ONB, ACC, TXN and BDG still have only prose. All four are small text fixes. They should be made before `bmad-architecture` and story creation copy the contradictions forward.

The adversarial reviewer does not accept that picture: the ledger invariants sound good, but the capture rules that feed them do not hold up. It raises 5 critical findings, each a path where money gets counted twice or the "Am I okay?" number is wrong, and says a coding agent that follows the text literally will ship those paths. Card-bill payments, ATM withdrawals and own-account moves are auto-approved as spending or income (C1). Read-time auto-approve breaks the FIN-024 "one set" rule, duplicate detection and past-total stability, because the headless SMS receiver never materializes (C3). Beyond the criticals it surfaces 16 high findings the rubric did not touch: no timezone rule, no numeric duplicate-match windows or Merge semantics, UPI references swallowing failed-payment reversals, auto-approved guesses training the learner, per-sender balance chains and colliding ••last-4 masks, literal DLT header matching, an OCR SDK that may break the "no outbound request" promise, real beta receipts against the synthetic-only fixture rule, SMS lost before first unlock, and refunds with no defined treatment. The two reviewers agree on the core defects: the Savings double count (rubric high, adversarial C2), TXN-012 counting a flagged manual duplicate (rubric high, C4), the 50/30/20-only Home hero leaving out Not-classified spending (rubric high, C5), the widget pending count drifting during the auto-approve window (rubric medium, inside C3), the false §25 Given/When/Then claim, the INS-001 presets, app lock vs notifications, and the self-contradicting approval status.

Grade: Poor, because adversarial critical C4 is confirmed in the PRD text: TXN-012 saves a matching manual entry "as confirmed with the `possible_duplicate` flag" while FIN-024 counts every confirmed non-excluded item in headline totals and defines the review queue as only `needs_review` items, so the duplicate is counted twice (C2 is likewise literal in BDG-009's "plus").

## Dimension verdicts
- Decision-readiness — strong
- Substance over theater — strong
- Strategic coherence — adequate
- Done-ness clarity — adequate
- Scope honesty — strong
- Downstream usability — adequate
- Shape fit — strong

## Findings by severity

### Critical (5)
*Rubric: 0 · Adversarial: 5*

**[Adversarial C1]** — Card-bill payments, ATM withdrawals and own-account moves are auto-approved as spending or income (§ CAP-004, CAP-007, CAP-010, FIN-013, FIN-026(3)/(4), FLOW-16, §16.2 P0)
Arjun's HDFC card charges arrive as SMS, are auto-approved, and count as expenses. On the 5th his bank sends "Rs 42,000 debited … towards HDFC Credit Card": verified sender, fully parsed, CAP-007-eligible. At 21:00 it is counted as a ₹42,000 expense, so his month's spending is counted twice. An ATM withdrawal SMS (a transfer to Cash per FIN-013) is also auto-approved as an expense, and the cash he then spends and logs is counted a second time. CAP-004 and CAP-010 offer "Moved from my own account" only on credits; the debit leg of FLOW-16 has no transfer option and may already be materialized before the credit SMS arrives. FIN-026(4) forbids rewriting past totals, so linking the credit tomorrow has to rewrite yesterday's expense, and the PRD never says that is allowed. Credits get the same treatment: a salary, refund or own-account credit with no learned type is auto-approved as income, inflating "Kept N%" and the 50/30/20 income base.
Fix: Add a CAP-007 exclusion: never eligible are debits matching card-payment, ATM, self-transfer or own-account patterns (or a known owned masked counterparty), and any credit without a learned type. Add "Moved to my own account / Paid my card / Cash withdrawal" choices to debit captures. State that linking a transfer may convert an already-materialized expense as an audited edit under FIN-014, the one carve-out from FIN-026(4). Add CAP acceptance cases: card-bill debit and ATM debit are never counted as expense.

**[Adversarial C2]** — The 50/30/20 Savings bar double-counts "Moved to savings" goal contributions (§ BDG-009, INS-020, GOAL-002 acceptance)
BDG-009: Savings is transfers into savings accounts **plus** "Moved to savings" contributions. GOAL acceptance: a ₹5,000 "Moved to savings" contribution "is one transfer into the savings account, counts toward the Savings bar". A literal implementation sums both and shows ₹10,000 on the brand-mark feature. A Moved contribution into an account not marked savings is undefined; money moved back out of savings is undefined (gross or net?). Indian users mostly save through SIP and mutual-fund debits, which land in Needs/Wants or Not classified, so the Savings bar is near zero for the core persona. Rubric agrees (Strategic coherence, high).
Fix: Define Savings once, as net transfers into savings-marked accounts in the period; a goal "Moved" contribution is only a tag on that transfer. Decide whether outflows net off. Add a `savings` category type or an investment account type so SIP/RD/insurance debits can count. Add an acceptance case: ₹5,000 moved shows ₹5,000, not ₹10,000.

**[Adversarial C3]** — Read-time auto-approve breaks the "one set" rule, duplicate detection and past-total stability (§ FIN-024, FIN-026 (2)/(4)/(5), CAP-007, HOM-007, TXN-008, §6.7)
FIN-024 says pending captures, review queue and widget count "are the same set: all `needs_review` items"; FIN-026(2) says eligible items past the cutoff stay stored `needs_review` but are shown as Recorded and counted. At 21:30 before an app open, the widget shows ● 6, Home says "6 to check", and the same six are inside "Left in budget". The scheduled evening summary cannot run the read model; CSV exports and backups in that window write them as `needs_review`. The headless SMS receiver does not materialize, so a duplicate SMS at 22:00 is checked against confirmed items, does not find the derived one, and per FIN-026(5) the original "stays needs_review": the total the user saw at 21:30 silently shrinks at 22:05, despite FIN-026(4). "The cutoff" is never pinned, so a Monday 18:00 capture may not count until Tuesday 21:00. A single `auto_approve_rule_effective_from` field loses rule history. Rubric partly agrees (widget count, medium).
Fix: Pending = `needs_review` AND NOT derived-eligible-past-cutoff, routed through one shared selector for widget, Home card, Activity dot, evening summary and exports. Every write path (headless SMS receiver, notification action, share intent, widget, restore) runs materialization first, in the same DB transaction, before dedup. Define the cutoff as the most recent cutoff instant at or before now, in profile time. Keep a rule-history table. Decide that an already-counted item stays counted and the late newcomer is the `possible_duplicate`.

**[Adversarial C4]** — A manual entry flagged as a possible duplicate is saved as confirmed, so it counts twice (§ TXN-012 vs FIN-024, TXN-008, §3.3 counter-metric, §16.2 P0)
TXN-012 saves the matching manual entry "as confirmed" with `possible_duplicate` and puts it in the review queue. FIN-024: "Only confirmed non-excluded items contribute to headline totals", so both copies are counted until the user acts, violating the P0 and the "Duplicate confirmed entries = 0" counter-metric. FIN-024 also defines the queue as exactly the `needs_review` set, so a confirmed item cannot appear there. OCR-011 does the opposite for receipts (later capture is `needs_review`, not counted). Two engineers will build two different duplicate states. Rubric agrees (Done-ness clarity, high).
Fix: Pick one rule: the new manual entry is `needs_review` + `possible_duplicate` (not counted, "Waiting for you" chip), or restate the P0 as "no duplicate counted after review". Extend the FIN-024 queue definition to match. Add GWT cases for manual-after-SMS and SMS-after-manual.

**[Adversarial C5]** — "Left in budget" under 50/30/20 leaves out every uncategorised and auto-approved capture (§ §6.3 item 2, CAP-007, CAT-006, OCR-005, HOM acceptance)
With only 50/30/20 set, the hero is "Needs + Wants targets against needs + wants spending". CAP-007's Uncategorised auto-approvals (most of them in the first weeks), OCR-005 "Not itemised" amounts and untyped categories all land in Not classified, which never reduces "Left in budget". Priya's first two weeks: ₹30,000 of auto-approved UPI spend, hero still near full. The most-watched number in the product says she is fine when she is not. Rubric agrees (Strategic coherence, high).
Fix: The 50/30/20 hero uses total confirmed expense (Needs + Wants + Not classified) against Needs + Wants targets, or shows Not classified as consuming headroom. Add an acceptance case: a ₹1,000 auto-approved Uncategorised capture reduces Left in budget by ₹1,000.

### High (20)
*Rubric: 4 · Adversarial: 16*

**[Strategic coherence]** — The Savings formula double-counts "Moved to savings" contributions (§ BDG-009, INS-020, GOAL-002 acceptance, DEC-30, ACC-009)
BDG-009 defines Savings as "the sum of transfers into accounts marked *savings* (ACC-009) **plus** goal contributions of type 'Moved to savings' (GOAL-002)". INS-020 repeats it. The GOAL acceptance says a ₹5,000 "Moved to savings" contribution "is one transfer into the savings account, counts toward the 50/30/20 Savings bar". When that account is marked savings, which is the normal case, the same ₹5,000 is counted twice. Nothing says whether transfers *out of* a savings account reduce Savings: ₹10,000 in and ₹10,000 back out in the same period shows ₹10,000 saved. Also raised by Adversarial C2 (critical).
Fix: Define Savings as the set union by transaction: "transfers into savings-marked accounts, plus 'Moved to savings' contributions whose transfer lands in an account not marked savings; each transaction counted once". State gross vs net (e.g. "net of transfers out of savings accounts in the same period, floored at 0"). Add a §16.1 5030 case: "₹5,000 Moved to savings into a savings account → Savings bar +₹5,000, not +₹10,000".

**[Strategic coherence]** — With a 50/30/20-only setup, the Home hero ignores "Not classified" spending, so "Left in budget" can be overstated (§ §6.3 #2, HOM-001, CAT-006, CAP-007, OCR-005, BDG-009)
§6.3 says that with only 50/30/20, the hero uses "the Needs + Wants targets against needs + wants spending". CAT-006 puts Uncategorised, any untyped category, and every OCR-005 "Not itemised" amount into a fourth **Not classified** segment. CAP-007 confirms every eligible capture with no learned category as Uncategorised, which in a user's first weeks is most auto-approved captures. Confirmed spending drops out of the headline "Am I okay?" number, against principles 4 and 8. Also raised by Adversarial C5 (critical).
Fix: Define the 50/30/20-only hero as "Needs + Wants targets − (needs + wants + not-classified spending)", or show "+₹N not classified" beside the figure. Add a HOM acceptance case for the 50/30/20-only hero state; HOM has none today.

**[Done-ness clarity]** — TXN-012 creates a state that contradicts FIN-024, the status mapping and the no-double-count P0 (§ TXN-012, FIN-024, TXN-008, §7.3 status mapping, §7.4, §16.2, §3.3)
TXN-012: a manual entry matching an existing confirmed item "is saved as **confirmed** with the `possible_duplicate` flag and appears in the review queue". FIN-024 and TXN-008 define the review queue as exactly the set of `needs_review` items, and the status mapping has no row for `confirmed` + `possible_duplicate`. FIN-024: "Only confirmed non-excluded items contribute to headline totals." So both entries are counted until the user resolves the item, which is the duplicate confirmed counting §16.2 calls P0 and breaks the "Duplicate confirmed entries = 0" counter-metric. Also raised by Adversarial C4 (critical).
Fix: Either (a) save the manual entry as `needs_review` + `possible_duplicate` (excluded from totals, "Possible duplicate — check it") with a "Saved — check it" toast, or (b) keep it confirmed, add a mapping row, widen FIN-024/TXN-008 and carve this case out of the §16.2 P0 and the counter-metric explicitly. Option (a) is consistent with everything else. Add a TXN acceptance case either way.

**[Done-ness clarity]** — §25's claim that "Every FR module in §8 carries Given/When/Then acceptance criteria" is false (§ §8.1 ONB, §8.2 ACC, §8.3 TXN, §8.5 BDG, §25, §22.1)
ONB, ACC, TXN and BDG still have only one-line prose acceptance. None of these has an acceptance case: BDG-008's Free-to-use gate and missing inputs; BDG-009's template, income basis and Savings calculation; BDG-004 thresholds; BDG-007 effective-now vs next-period; TXN-012; TXN-013; TXN-002; ACC-007 Pay card bill; ACC-008 Adjust balance; ACC-009 savings marking; ONB-002/003/008. §16.1 has no rows for TXN-013, SMS-017 or Savings computation. §22.1 says stories without verifiable acceptance are not Ready, so the story writer will have to invent these. Also raised by Adversarial M6.
Fix: Convert the four prose lines to Given/When/Then and add at least: Free-to-use gate fails → "not enough information yet" plus missing inputs; 50/30/20 template from ₹80,000 income → 40,000/24,000/16,000; transfer to a savings account fills Savings and leaves Spent unchanged; foreign-currency capture → review, never auto-approved; Pay card bill → transfer, spending unchanged; Adjust balance → adjustment posting, not income. Add matching §16.1 cells (TXN, SMS, 5030).

**[Adversarial H1]** — The profile timezone is undefined; travel and DST are left to the implementer (§ FIN-002, FIN-026(1), §6.5, §11.1 `profile.timezone_id`, `transaction.timezone_id`, §15)
Sara (London) flies to Dubai. Engineer A keeps Europe/London: her 23:30 Dubai dinner lands on the previous London day and the 21:00 cutoff fires at 01:00 Dubai time. Engineer B follows the device: day groups and payday-cycle boundaries move under her and past days re-group. FIN-002 promises "a clearly defined recalculation effect" and never defines one.
Fix: Freeze each transaction's `local_date` at capture time in its zone; periods and cutoff use the profile zone; the profile zone follows the device only after a user prompt. Add GWT cases for a cross-zone trip and a DST week.

**[Adversarial H2]** — Duplicate-match rules are unspecified while "0 duplicates" is a P0, and Merge is undefined (§ IMP-004, SMS-005, OCR-006, TXN-012, addendum §2, IMP acceptance, SCR-10)
"Amount + time window + merchant fuzzy" has no numbers: one engineer uses ±10 minutes, another ±2 days. Two genuine ₹20 teas ten minutes apart are both flagged and never auto-approved. Two identical £3.50 Pret CSV rows with no reference share a fingerprint and the second is skipped, losing real spending. "Merge" never says which record survives or what happens to attachments and source records.
Fix: Put concrete match keys and windows per source pair in the PRD. Fingerprint CSV rows with an occurrence index. Define Merge (keep the earliest confirmed record, attach the other's source_record and attachments, user picks category). Add GWT cases for identical legitimate purchases.

**[Adversarial H3]** — Using the UPI reference as a dedup key swallows failed-payment reversals (§ UPI-005, IMP acceptance, FIN-003, addendum §5)
A failed UPI debit is followed by "₹2,000 reversed/credited … UPI Ref 4123". "Same reference = same transaction" links or skips the credit; the debit stays confirmed and the balance is ₹2,000 too low. Same with merchant refunds reusing the RRN. A pending or failed PhonePe screenshot parses as a payment.
Fix: Key dedup on (reference, direction, event type); a same-ref opposite-direction item becomes a linked reversal or refund. UPI-001 parsers reject non-success screens. Add UPI/SMS fixtures.

**[Adversarial H4]** — Auto-approved guesses feed learning, so wrong categories reinforce themselves (§ FIN-026(3), LRN-001, LRN-003, counter-metric "wrong-category auto-approvals ≤ 10%")
One wrong guess (Swiggy Instamart → Food) auto-approved five nights running fills the last 5 confirmations; LRN-003's mixed flag never fires and the error becomes permanent. The PRD never says whether `auto_approved` counts as a confirmation.
Fix: Only `user_approved` actions and explicit edits teach; auto-approval may refresh recency but never adds evidence. Add an LRN acceptance case.

**[Adversarial H5]** — One balance chain per sender, cards read as bank accounts, and colliding ••last-4 masks (§ SMS-012, CAP-009, §11.1 `sender`, FLOW-15, addendum §2)
`last_balance_minor` lives on sender; HDFCBK sends for a savings account and a card, so the chain mismatches on every alternate SMS and captures are never auto-approved. Card SMS quote "Avl Lmt"; CAP-009 "Add it" creates a bank account with that as balance, turning a liability into a ₹2 lakh asset. "It's one of mine" links ••7730 permanently across all banks, merging ICICI and Axis.
Fix: Key the chain on (sender, masked_id). Classify card vs A/c from SMS wording and offer the account type; never derive an asset balance from an available limit. Key masks by (bank/sender, mask).

**[Adversarial H6]** — Literal DLT header matching will miss most bank SMS (§ SMS-010, SMS-017, §10, addendum §5)
Headers arrive as AD-/VM-/JD-/BZ-HDFCBK, and TRAI's scheme appends -S/-T/-P/-G suffixes. `allowList.includes(sender)` recognises HDFC on one operator only, and SMS-017 nags "New sender HDFCBK?" for every variant.
Fix: Specify normalization (strip the 2-letter prefix and any `-[STPG]` suffix, uppercase, match the 6-character entity); allow-list the normalized entity; add fixtures per variant.

**[Adversarial H7]** — The candidate OCR SDK conflicts with the "no outbound request" acceptance (§ SEC-002 acceptance, NFR-02, DEC-15, addendum §1, §13.3)
ML Kit, even bundled, is governed by terms allowing usage and diagnostic metrics to be sent to Google. The proxy test fails at M4 after OCR is built on it, or the Play Data safety form says "no data collected" while an SDK sends data. The PRD never says whether the release manifest declares `INTERNET`.
Fix: Release build omits `INTERNET`. Add GATE-05 evidence that the OCR stack works and is compliant offline, or pick a fully offline engine. Add "Data safety form matches SDK behaviour" to GATE-08.

**[Adversarial H8]** — Collecting real receipts and UPI screenshots contradicts "synthetic-only fixtures" and captures third-party data (§ §20 M3 exit, §8.11, §16, SMS-009)
Beta screenshots carry payee names, UPI IDs and phone numbers of people who never consented; receipts carry card fragments. The developer becomes a GDPR/DPDP controller not covered by the M1 privacy policy. The synthetic-only repo rule means the reference set cannot live where the accuracy CI metric runs.
Fix: Define a reference-set protocol (consent, redaction, storage outside the repo, retention, deletion) and cover it in GATE-08, or restrict CI to synthetic receipts and run real-set accuracy as an offline documented device test.

**[Adversarial H9]** — SMS captured while locked, or before first unlock after reboot, can be lost (§ SEC-001, SEC-004, NFR-16, SMS-003, addendum)
Before first unlock, credential-encrypted Keystore keys are unavailable; the receiver cannot open the encrypted DB and the debit is dropped. If the DB key is auth-bound for NFR-10, every headless capture fails while locked. NFR-16 only measures "while the app process is alive".
Fix: Require an encrypted append-only capture inbox readable in direct boot or under a non-auth-bound key, drained on next DB open. Add a GWT case for an SMS before first unlock. State whether the DB key is auth-bound.

**[Adversarial H10]** — "Left in budget for the default period" ignores each budget's own period (§ §6.3 item 2, DEC-33, BDG-001/002, BDG-008, HOM acceptance)
Arjun's default period is his payday cycle but his overall budget is monthly; the hero cannot be both. With a weekly and a monthly overall budget (BDG-002 allows it), "the overall budget" is ambiguous. BDG-008 Free to use has no rule when there is no overall budget or its period differs.
Fix: Restrict overall budgets to the default period, or have the hero use and label the budget's own period. Allow one overall budget at a time. Define Free to use with no overall budget (gate fails, "Set a limit").

**[Adversarial H11]** — Refund treatment is undefined across budgets, Needs/Wants, Kept and Insights (§ FIN-021, FIN-023, BDG-006, INS-003/016/020, CAP-004, §10, §11.1)
A November SMS refund for an October purchase: engineers differ on which month's budget it reduces, whether it is income, whether it is in Kept N%, and whether it reduces Wants. §10 says expense is net of refunds but §11 has no refund link, so linked refunds cannot be stored. FIN-021 contradicts FIN-013/DEC-19 on card payments.
Fix: Add `refund_of_transaction_id`. A refund reduces spending in the refund's period, in the original's category; never income, never in Kept. Rewrite FIN-021. Add GWT cases across a period boundary.

**[Adversarial H12]** — The OCR "quality floor" promises the impossible and has no answer for negatives, tax or tips (§ OCR-005, FIN-022, OCR-010, §3.3, §13.0a)
"The total is always the receipt's real total" contradicts the 90% accuracy target; an agent will show no confidence warning. Double-read lines make "Not itemised" negative. US sales tax and VAT all land in Not itemised and skew 50/30/20. Tips mean the card charge never matches the receipt, so receipt and CSV row count twice.
Fix: Total is user-confirmed, low confidence highlighted. Clamp and flag when items exceed the total. Allocate tax and fees pro-rata with a rounding rule. Add a tip tolerance (0–30% above, same merchant and date) routed to review.

**[Adversarial H13]** — Materialization auto-advances bill rules, but REC-009 requires the user's "Yes" (§ FIN-026(3), REC-009, CAP-011)
An eligible ₹18,000 capture near the Rent due date is auto-approved overnight and FIN-026 runs bill-rule advance, marking Rent paid. It was a deposit to a friend. REC-009 requires "Yes, link it"; FIN-026 bypasses it.
Fix: Auto-approve never links a bill; materialization only re-surfaces the "Rent paid?" prompt. Or make the auto-link explicit, labelled, undoable and covered in CAP acceptance.

**[Adversarial H14]** — Market promises exceed the currency list, and region and currency hang on one fragile pre-select (§ §1, DEC-27, §13.0a, ONB-002 ②, SET-002, SMS-015)
"UK and Europe" ships GBP and EUR only; "SE Asia" is SGD and MYR only. An Indian user on an en-US locale gets USD pre-selected, records entries, then cannot change currency (SET-002) and loses SMS/UPI. Build flavor, selected region and Play country can each decide whether SMS/UPI UI is shown; nothing says which wins.
Fix: Narrow the market claims or extend the list. Pre-select from device region, with an explicit confirm. Allow currency change while only onboarding data exists. One gating rule: shown = build supports it AND profile region = India.

**[Adversarial H15]** — "Reject" means "exclude" everywhere except OCR-010, where it creates a second expense (§ OCR-010 vs DEC-21, DEC-24, FIN-024, SCR-23, OCR acceptance)
OCR-010: "Reject saves it as a separate expense"; DEC-24/FIN-024: Reject sets `excluded`. A shared Approve/Reject component excludes the receipt and the user loses it; a build from OCR-010 creates a second confirmed expense under a "Reject" label, exactly the double count users fear.
Fix: Drop Approve/Reject from OCR-010; use "Attach to it / Keep separate" plus "Discard".

**[Adversarial H16]** — The Play "one package, two variants by country" assumption sits on the critical path with no fallback (§ SMS-016 [ASSUMPTION], DEC-07, GATE-02, §20 M3/M5)
If Play does not allow India-only SMS permission in one package, a second package means a second listing, privacy entry and reviews, and migrating Indian no-SMS users. The PRD says nothing about that migration. The application ID is chosen at M1.
Fix: Resolve GATE-02 before choosing the application ID (M1, not M3). Specify the two-package fallback, including cross-package backup/restore and its GWT case.

### Medium (24)
*Rubric: 3 · Adversarial: 21*

**[Done-ness clarity]** — The widget pending count disagrees with the app during the read-time auto-approve window (§ FIN-024, FIN-026 (2)–(3), HOM-007, SCR-29, CAP-007)
FIN-024 says the widget's pending count is "all `needs_review` items". FIN-026 (2) says eligible captures past the cutoff are still stored `needs_review` but shown as "Recorded · category guessed" and counted in totals, materializing only on app open or resume. From 21:00 until the next open, the launcher widget shows them as pending ("● 6") while the app and evening summary call them recorded. Also raised as part of Adversarial C3 (critical).
Fix: Define the pending set as "`needs_review` items not currently eligible-past-cutoff (FIN-026 step 2)", and say the widget and evening summary use the same read-model predicate. Add a CAP case: "after 21:00 with app unopened, widget count excludes eligible captures".

**[Done-ness clarity]** — INS-001's period presets omit the payday cycle, which is the default period (§ INS-001, DEC-33, §6.5)
DEC-33 makes the payday cycle the default for Insights and Plan, and §6.5 lists This/Last pay cycle and Yesterday. INS-001 lists only "Today, 7 days, This month, Last month, Quarter, Year, Custom". A story built from INS-001 will not include the default period. Also raised by Adversarial L2.
Fix: Make INS-001 reference §6.5's preset list instead of restating it.

**[Downstream usability]** — The §11 data model has gaps against FRs and acceptance cases (§ §11)
`goal` has no name/icon/color (GOAL-001). `account` has no icon/color, `sort_order`, `credit_limit` or `statement_due_day` (FIN-010, ACC-001, ACC-003). There is no refund/recovery link (FIN-023, BDG-006), only `reversed_by_id`. No link between a recurring rule and the payments that satisfied it (REC-004 "exactly once"), and no rule kind. No store for budget alerts already fired (BDG-004). No bill reservation (GOAL-004). `transaction.before_tracking_started` is stored but derivable and will go stale (FIN-016, ACC-002). `import_batch` has no raw-file path or retention deadline (IMP-006). Overlaps Adversarial M5 and H11 on the refund link.
Fix: Add `goal.name/icon/color_token`; `account.icon/color_token/sort_order/credit_limit_minor?/statement_due_day?`; `transaction.related_transaction_id?` + `relation_kind[refund_of|recovery_of]`; `recurring_payment(rule_id, transaction_id unique, period_key)`; `recurring_rule.kind`; `budget_alert_fired(budget_id, period_start, threshold)`; `reservation(goal_id?, recurring_rule_id?, amount_minor)`; `import_batch.raw_path?, retain_until?`. Mark `before_tracking_started` as derived.

**[Adversarial M1]** — Import is described as both "atomic" and "partial commit" (§ FLOW-07, Appendix A #5, IMP-005, IMP acceptance)
A 1,200-row import killed after batch 2: it is unclear whether 1,000 rows stay or 0.
Fix: Each batch is atomic; the import is resumable and idempotent; bad rows are skipped and reported. Remove "atomic commit" from FLOW-07.

**[Adversarial M2]** — CSV realities are missing: encodings, sign conventions, transfer detection (§ IMP-001/002/003)
Windows-1252 exports with `;` and decimal commas vs UTF-8-only IMP-001; card CSVs record charges as positive; importing bank and card CSVs creates an expense plus income instead of a transfer.
Fix: Add encoding detection or selection, a per-mapping "flip sign" option, and transfer-pair detection across owned accounts during import.

**[Adversarial M3]** — The payday cycle is undefined at its edges (§ ONB-002 ④, DEC-33, BDG-009, INS-004)
Early salary lands in the previous cycle, so this cycle shows "No income recorded" and 50/30/20 has no base. Inclusive start, INS-004 "same days" semantics and whether the BDG-009 base is entered or actual are all undefined.
Fix: Define the cycle as [payday, next payday) in the profile zone; add "last working day" and an early-income rule; make the 50/30/20 base explicitly entered.

**[Adversarial M4]** — The evening summary and rule changes quietly need background work (§ CAP-007, DEC-22, SET-003)
A 21:00 notification built at schedule time has stale counts; computing at fire time needs a worker the design avoids.
Fix: State that the summary is computed at fire time by WorkManager (best effort) or at next open, and never affects data.

**[Adversarial M5]** — Data-model gaps that contradict features (§ §11.1)
Singular `transaction.source_record_id` loses provenance on merges and CAP-010 transfers; no refund link; `foreign_amount_minor` has no exponent; redundant per-row currency invites divergence.
Fix: Provenance many-to-one via `source_record.transaction_id`; add `foreign_currency_exponent`; drop per-row currency or constrain it.

**[Adversarial M6]** — The claim that every §8 module has Given/When/Then is false (§ §25, §24.1 change log vs §8.1, 8.2, 8.3, 8.5)
ONB, ACC, TXN and BDG acceptance is prose. BDG-009 (50/30/20 maths) has no GWT at all, and that is where C2 lives. Stories inherit nothing testable. Rubric agrees (Done-ness clarity, high).
Fix: Write GWT for ONB, ACC, TXN and BDG, including worked 50/30/20 numbers.

**[Adversarial M7]** — Outside India, the capture pipeline, notifications and auto-approve have nothing to act on (§ §13.2, CAP-001, DEC-22, HOM-007, §3.3)
Elsewhere the only capture is a user-initiated receipt match, so a notification for it is nonsense and the widget count is always 0. In India's no-SMS build, a dismissed UPI share dialog has no defined state. Rubric agrees (Scope honesty, low).
Fix: State per market which CAP items are live; define whether a dismissed share dialog becomes `needs_review` and auto-approvable.

**[Adversarial M8]** — App lock contradicts what notifications and the widget show (§ SEC-005, CAP-001, SEC acceptance, HOM-007, HOM-008)
With app lock on and the device unlocked, notifications show amount and merchant despite "unlock required before any amount is shown"; the widget can show amounts; hide-amounts scope is unclear. Rubric agrees (Done-ness clarity, low).
Fix: With app lock on, notifications use the public version unless opted in; the widget never shows amounts; define hide-amounts scope across app, widget and notifications.

**[Adversarial M9]** — The widget count breaks the "no counts" rule (§ DEC-16, §6.7, HOM-007/SCR-29, addendum)
DEC-16 says "never a count badge" and §6.7 "never numeric badges", while HOM-007/SCR-29 and the addendum show "● count".
Fix: Decide number or dot and amend the rule in one place.

**[Adversarial M10]** — Retention is undefined for SMS bodies, deleted entries and rejected captures (§ SMS-004, FIN-024, FIN-014)
An agent picks "forever". "Delete" never deletes and backups carry it, against user expectation and GDPR/DPDP erasure rights.
Fix: Set numbers (raw SMS body not retained or 7 days; soft-deleted rows purged after N days); add "Delete permanently".

**[Adversarial M11]** — Three names for leftover receipt money (§ OCR-005, FIN-022, TXN-009, CAT-006)
"Not itemised", "unallocated amount" and the editor's "unallocated" placeholder: one engineer splits to Uncategorised, another leaves a remainder, and the split invariant passes for one and fails for the other.
Fix: "Not itemised" is a split row to Uncategorised with `unparsed=true`; "Unallocated" exists only in the editor and blocks Save.

**[Adversarial M12]** — Some metrics and NFRs pass trivially or cannot be tested (§ §3.3, NFR-10, NFR-16)
"≥ 70% resolved with zero or one tap" is met by ignoring everything; "no India-only features encountered" is guaranteed by code; "scam false positives = 0" uses a self-authored corpus; NFR-10 has no threat model; NFR-16 excludes the dead process; the learning metric has no threshold.
Fix: Measure taps on the correct outcome; drop tautological metrics; add a cold-process NFR-16 target; give the learning metric a target.

**[Adversarial M13]** — Budget threshold alert semantics are underspecified (§ BDG-004, SET-003, SET acceptance)
74% → 91% crosses 75 and 90: "exactly one alert" does not say which. Delete and re-add across 90: does it fire again? Four bill reminders against a cap of 3: which drops?
Fix: Fire only the highest threshold crossed, once per period; bills take priority within the cap and overflow merges into one.

**[Adversarial M14]** — End-of-month recurrence can drift (§ REC-006)
A rule due on the 31st goes Jan 31 → Feb 28 → Mar 28 and passes the written acceptance.
Fix: Keep the anchor day; add the GWT case "Feb 28 → Mar 31".

**[Adversarial M15]** — "Widget" is reused for Home cards (§ HOM-004, §4.1, §5.3)
HOM-001 reserves "widget" for SCR-29; an agent reading HOM-004 builds launcher-widget refresh logic. Rubric notes the same drift (Downstream usability, low).
Fix: Replace these uses with "Home cards".

**[Adversarial M16]** — Changing the device clock forces auto-approval (§ §17, FIN-026)
Setting the clock to 21:01 materializes every pending capture irreversibly as `auto_approved`, including items that would have become duplicates.
Fix: Use a monotonic or last-seen-max time guard: materialize only if now ≥ cutoff and now ≥ `last_materialized_at`.

**[Adversarial M17]** — The scam heuristic will flag genuine bank SMS (§ SMS-011)
Indian bank SMS routinely contain links and "KYC" wording; a "link + KYC" rule flags genuine debits.
Fix: Base scam detection on verified sender status first; allow-listed senders are only warned, never scam-flagged.

**[Adversarial M18]** — "Outstanding" and "due" are used interchangeably for cards (§ ACC-003, ACC-007, §6.3)
Unclear whether Pay card bill pre-fills outstanding or statement due, and which one Home "Card dues" shows.
Fix: Pick one and add statement balance as an optional field.

**[Adversarial M19]** — Opening balance effective date: instant or date? (§ FIN-016, DEC-18, ONB-002 ③, §11.1 `opening_effective_at`)
Account created at 15:00; a delayed SMS for 11:00 today arrives. Date vs instant gives an off-by-one balance.
Fix: Opening balance applies at an instant and same-day earlier transactions are "before tracking started", or define it at end of the previous day. Add a GWT case.

**[Adversarial M20]** — No normalization rule for merchant learning keys (§ FIN-025, LRN-001/003)
"SWIGGY*ORDER 8812", "Swiggy" and "Swiggy Instamart" are either one key (wrong mixed flag) or three (nothing learned).
Fix: Specify minimal normalization (case, punctuation, trailing IDs stripped) and a user-editable alias.

**[Adversarial M21]** — FIN-021 contradicts FIN-013 on card payments (§ FIN-021)
"income … reduces liabilities only for … payments to a liability account" reads as card payment = income. An agent builds it that way.
Fix: Rewrite FIN-021 as a posting table per event type (sign, account side, counts in spending or income).

### Low (17)
*Rubric: 8 · Adversarial: 9*

**[Decision-readiness]** — The approval status contradicts itself (§ frontmatter, header, §0, §20 M0, §25)
Frontmatter says `status: final`, and §0 says "This file is the frozen v1.3 PRD". The header block says "Proposed baseline for stakeholder approval", and §20 M0 (2026-11-02 → 11-07) still lists "approve this PRD" as future work. §25 ticks "Product owner accepts the explicit decision defaults (v1.3 session, 2026-11-01)". Also raised by Adversarial L1.
Fix: Pick one. If the PRD is approved, change the header to "Approved baseline (product owner, 2026-11-01)" and drop "approve this PRD" from M0.

**[Decision-readiness]** — "Absorbed by the staged rollout" overstates what §20 offers (§ §4.1 last line, v1.3 impact note 2)
§20's stages are feature betas (M3/M4), and M5 launches the no-SMS build to all four market groups at once. With no cut list, schedule pressure is actually absorbed by the undated M3–M5, which §20 states honestly.
Fix: Reword §4.1 to "Schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope", and make impact note 2 match.

**[Substance over theater]** — A few adjective bounds and soft targets remain (§ NFR-06, NFR-19, §3.3, OCR-001, OCR-007, §6.6)
NFR-06 "aims 60 FPS" and NFR-19 "keep 60 FPS scrolling" give no tolerance, unlike NFR-07's "≥ 95% of frames". §3.3 "Learning effect … falls week over week" has no size threshold. OCR-001 says "compress safely" and OCR-007 says "fails gracefully". §6.6 says the fallback "must look intentional, not degraded". The learning-metric gap is also raised by Adversarial M12.
Fix: Reuse the NFR-07 form for NFR-06/19. Give the learning metric a floor (e.g. "week-3 correction rate ≤ 50% of week 1"). For OCR-001/007, state the observable behavior (max dimension and quality; "manual entry offered within one tap, image kept").

**[Done-ness clarity]** — App lock and notification content are not fully aligned (§ CAP-001, SEC-005, §5.1, SEC acceptance 2)
With app lock on and the device unlocked, SEC-005 shows the full capture notification and CAP-001 lets Approve/Reject run "without unlocking". §5.1 says notification entry passes the app lock check first, and SEC acceptance says "unlock is required before any amount is shown". Defensible, but the PRD should state it as a choice. Also raised by Adversarial M8.
Fix: Add to SEC-005: "App lock does not redact notifications on an unlocked device; users who want that use the hide-amounts / redacted-notification option", or redact notifications whenever app lock is on.

**[Scope honesty]** — REC-007 and REC-008 have unclear phase and no screen (§ §8.6, §5.2, INS-022, REC-005)
REC-007 only makes sense with REC-005 inference, which is Phase 2. REC-008 ("Subscription page …") has no SCR entry, and INS-022 Subscription timeline is P2. Both sit untagged in a P1 module, so story writers will treat them as committed.
Fix: Tag REC-007 as P2. Either tag REC-008 as P2 or fold it into SCR-16 with a P1 scope sentence.

**[Scope honesty]** — Outside India, most of the capture machinery has no source (§ §4.1, CAP-001/005/007, §13.2, §13.0a)
Auto-approve requires "a verified sender (SMS-010) or a parsed UPI screenshot", so outside India nothing is ever auto-approved, and the evening summary and grouped notifications have nothing to report. §13.2 says this for the no-SMS build, but §4.1 and §13.0a present these as plain P1 for every market. Also raised by Adversarial M7.
Fix: Add a §13.0a row: "Capture notifications, auto-approve, evening summary | Yes | receipt-match prompts only | … | …".

**[Scope honesty]** — GATE-05 still requires "iOS/Android parity" as Phase 1 evidence (§ §24, DEC-10, §4.2)
iOS OCR validation is Phase 2.
Fix: Mark the iOS part "(Phase 2)".

**[Downstream usability]** — Residual stale or drifting text (§ §13.2, §4.1, HOM-004, §5.3, §10, SET-005, DEC-21, §16.1, §3.3, §14, §19, §20, §23)
§13.2 says "SMS-001..016 … Absent", but SMS-017 exists. "Widget(s)" still means Home cards in §4.1, HOM-004 and §5.3. The §10 "Mixed merchant" entry contradicts LRN-003. SET-005 says "hide-balances" while HOM-008/§6.3 say "hide-amounts". DEC-21 omits UPI share and receipt matches. §16.1 PLAT ("iOS picker/camera") and UX ("VoiceOver") have no P2 mark. "v1" still stands for release scope in several places. The widget wording and iOS suite items are also raised by Adversarial M15 and L9.
Fix: One sweep: SMS-001..017; "Home card(s)" in the three places; glossary "within its last 5 confirmations (LRN-003)"; "hide-amounts"; DEC-21 "(SMS, UPI share, receipt match)"; P2 tags on iOS test items; "Phase 1" for "v1".

**[Adversarial L1]** — Document status contradicts itself (§ frontmatter vs header vs §0 vs §20 M0)
`status: final`, "Proposed baseline for stakeholder approval", "frozen", and M0 "approve this PRD". Rubric agrees (Decision-readiness, low).
Fix: Pick one.

**[Adversarial L2]** — The presets list differs in two places (§ INS-001 vs §6.5)
INS-001 omits This/Last pay cycle and Yesterday, but DEC-33 makes the pay cycle the default. Rubric raises this at medium (Done-ness clarity).
Fix: Align the two lists.

**[Adversarial L3]** — "Reduce-transparency" is an iOS setting (§ §6.6)
Android has no such switch, so an agent will search for an API that does not exist.
Fix: Name the Android signals: battery saver, animator duration scale 0, no RenderEffect before API 31.

**[Adversarial L4]** — "Recorded · category guessed" is shown when nothing was guessed (§ FIN-024 table, CAP-007)
An Uncategorised `needs_category` auto-approval gets that label even though no category was guessed.
Fix: Add a label such as "Recorded · needs a category".

**[Adversarial L5]** — The "five row states" omit rejected and needs-category rows (§ TXN-006)
Rejected and needs-category rows are not among the listed states.
Fix: Enumerate all row states.

**[Adversarial L6]** — Schedule order is inverted (§ §20 M1, M5)
The privacy policy is published at M1, before the GATE-08 paid review. The 14-day/12-tester closed test sits after M4 instead of running as the M3/M4 closed betas on a Play closed track.
Fix: Run closed betas on a Play closed track to satisfy GATE-13; publish a reviewed policy or mark the M1 policy provisional.

**[Adversarial L7]** — The goal and bill double-reservation acceptance is undefined (§ GOAL-004 acceptance)
There is no reservation object for bills, so the test cannot be written.
Fix: Define what "reserved for a bill" means, or drop the case.

**[Adversarial L8]** — Lakh grouping on Hermes is unverified (§ FIN-001, addendum Formatting)
`Intl.NumberFormat('en-IN')` lakh grouping and `de-DE` formatting under Hermes need a spike; INTL tests may pass in Jest/Node and fail on device.
Fix: Run the INTL suite on device.

**[Adversarial L9]** — The PLAT and UX suites list iOS cases in Phase 1 suites (§ §16.1)
PLAT includes "iOS picker/camera" and UX includes VoiceOver.
Fix: Mark them P2 so Android release gates are not blocked.

## Mechanical notes
- **Draft-review status (v1.3-draft → v1.3.0).** Resolved: read-time auto-approve semantics (FIN-026); the Savings/ledger conflict (the formula defect is new); milestone coverage and M1 window; Play SMS declaration timing and GATE-02 assumption; international metrics segmentation; `needs_category` and Uncategorised; the currency list; TXN-013; SMS-017; hero budget/period rule; OCR script scope; GATE-01; solo-review substitutes; Appendix B, SET-003, Quick Add, FLOW-07 and §23 navigation; §11 recurring/budget/learned-mapping fields; flows for CAP-009/010, ACC-007 and re-approve; flow protagonists; Appendix C path; §13 subsection order. Partially resolved: widget drift; NFR adjectives (NFR-06/19 not); vague phrases (OCR-001/007 not); acceptance lines (all modules except ONB/ACC/TXN/BDG). Unresolved: ID listing order; `[v1.3]` tag undefined in the §0 legend; DEC-23 stale cross-reference; "v1" overloading; §16.1 PLAT; duplicate §6.3 sentence; no 1.0.0 change-log row; glossary gaps; "5030" suite name; §5.3 "dynamic island"; §2 gate prose duplicating §24.
- **ID continuity.** IDs are unique and every reference resolves; GATE-04..09 and SCR-27..29 repeats are legitimate second tables. Listing order is out of sequence: FIN-016 before FIN-011, FIN-026 before FIN-025; TXN-012/013 before TXN-009; REC-009/010 before REC-008; HOM-008 before HOM-007; INS-007 between INS-004 and INS-005 (INS-008/009 do not exist); SCR-27..31 before SCR-25/26; WMB-16..18 before WMB-13. Fix: reorder, or add under §0 "IDs are stable; new IDs are appended and listed next to related items."
- **Source legend.** `[v1.3]` tags (ONB-002, FIN-026, ACC-006..009, TXN-012/013, CAT-006, BDG-009, REC-009/010, INS-007, OCR-011/014, SMS-015..017, SEC-005, CAP-007/009..011, LRN-007) are not defined in §0's `[SRC]/[FIX]/[NEW]` legend.
- **DEC-23** still says it "supersedes 'explicit rules only' in FIN-025/CAT-005"; neither requirement contains that phrase now.
- **Duplicate sentence (§6.3):** "Each card supports tap-to-details … and a clear period label" appears twice.
- **Label collision:** §16.2 uses "P0/P1" as release priorities while the header defines "P1 = Phase 1"; consider "Blocker/Major".
- **Glossary (§10) gaps:** no entries for capture, auto-approve, daily cutoff, source record, "Not itemised", Uncategorised/Not classified, `needs_category`, savings account (ACC-009) or the 50/30/20 Savings share; "Account balance" omits the FIN-016 before-opening-date exclusion.
- **Change log:** no 1.0.0 baseline row; the 1.3.0 "Decisions affected" column omits TXN-012/013, SMS-017, FIN-026, ACC-009 and SET-002.
- **Assumptions Index:** none; the single inline `[ASSUMPTION]` (SMS-016) round-trips to GATE-02 and §25, acceptable at this density.
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. The flow set has no non-India receipt-match or CSV-plus-capture dedup flow, though the receipt-first markets rely on both.
- **Required sections:** all present for a chain-top consumer PRD.

## Reviewer files
- `review-rubric.md`
- `review-adversarial-general.md`
