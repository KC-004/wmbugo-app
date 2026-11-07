# Validation Report — wmbugo PRD v1.3.2

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-wmbugo-app-2026-11-01/prd.md`
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Run at:** 2026-11-01
- **Grade:** Poor

## Overall verdict
v1.3.2 is a strong, decision-ready PRD. All the critical and high findings from the v1.3.0 reviews about double counting and the hero are closed in the text: auto-approve is always a write (FIN-026); manual duplicates are held, not counted (TXN-012); Savings is counted once, as net transfers (BDG-009); unclassified spending reduces "Left in budget" (§6.3); and duplicate matching, refunds, timezone and learning each have their own rule (FIN-027/028, FIN-002, LRN-008). The remaining risk is of two kinds. The first is semantic: the 50/30/20 Savings bar, which is the brand's mark, measures the wrong thing for the primary Indian persona, because in India the everyday bank account is literally a "savings account" and SIP investing cannot be modelled. The second comes from the latest fixes, which left stale or conflicting text around them: CAP-007 and FLOW-09 still say eligible captures "count as confirmed" before the FIN-026 write; CAP-012 introduces an automatic transfer link outside the FIN-026 contract; SET-005 redaction is not reflected in SEC-005 or CAP-001; FIN-014 retention contradicts DEC-24 and the status-mapping paragraph; and BDG-008 contradicts the GOAL acceptance on whether Free to use can go negative. None of these blocks UX work. Fix the CAP-007/CAP-012 contract text and the Savings definition before `bmad-architecture` freezes the schema.

The adversarial reviewer says the fixes "closed most of the earlier double-counting holes" and then "opened new ones where they meet each other". Its two criticals are ledger paths: the "same reference, opposite direction = reversal" rule turns ordinary own-account UPI transfers into reversals that cancel the debit (C1), and credits with no learned type still auto-approve, into an expense category (C2). Its eleven highs add more wrong-balance paths the rubric did not raise: a discovered account's opening balance is off by the very transaction that discovered it (H2), auto-approve can post to an account that does not exist yet (H3), a card-bill payment is counted twice through its two SMS legs (H4), "without a shared reference" can flood review for every repeat UPI payment (H5), Merge keeps a receipt defaulted to Cash over the card charge (H6), the 90-day purge deletes the fingerprints that keep rejected items rejected (H7), a dismissed UPI share dialog auto-approves a friend's forwarded screenshot as your spending (H8), and every discounted receipt trips the "items exceed total" mismatch (H11). Its verdict: "Do not freeze until the two critical findings and the high findings on the ledger path (H1–H7) are closed." The two reviewers agree on the stale CAP-007 read-time wording (adversarial H1, rubric medium), unlearned credits being auto-approvable (C2, rubric medium), the Savings bar failing the Indian persona (H10, rubric high) and the forbidden "savings" type in SCR-18 (H9, inside the rubric high), CAP-012 linking outside FIN-026 (H4, rubric medium, from different angles), retention vs DEC-24 and the backup copy (H7 and L6, rubric medium), blind Approve on a redacted notification (M8, rubric medium), Free to use clamping vs the GOAL acceptance (M6, rubric medium), the GATE-02 deadline (M16, rubric medium), the dismissed-UPI-dialog rule (H8, rubric low), the clock guard storage (M1, rubric downstream medium), and the leftover text (unallocated, INS-001 presets, §13.2 SMS-017, the addendum, data-model duplicates). Grade: Poor, because adversarial critical C2 is confirmed in the PRD text: CAP-007 puts no direction condition on auto-approve eligibility and confirms an unlearned capture "as 'Uncategorised'", which CAT-006 defines as a seeded expense-side category that feeds Not classified, so an unlearned salary credit is auto-approved onto the spending side (C1 is equally literal in FIN-027 and UPI-005; the rubric alone would grade Fair).

Progress since v1.3.0: of the 25 critical and high findings in the v1.3.0 report (5 critical, 20 high), 22 are resolved in the text and 3 are partly open. All four rubric highs are closed, and 18 of the 21 adversarial critical/high findings are fixed; the partly open ones are C1 (debits fixed, credits not), C3 (FIN-026 right, CAP-007 wording stale) and H16 (GATE-02 has a fallback but an unreachable deadline). This round finds 2 critical and 12 high, down from 5 and 20, and most of them are new edges created by the v1.3.1/1.3.2 fixes rather than carry-overs.

## Dimension verdicts
- Decision-readiness — strong
- Substance over theater — strong
- Strategic coherence — adequate
- Done-ness clarity — adequate
- Scope honesty — strong
- Downstream usability — adequate
- Shape fit — strong

## Findings by severity

### Critical (2)
*Rubric: 0 · Adversarial: 2*

**[Adversarial C1]** — Own-account UPI transfers are classified as reversals and cancel the debit (§ FIN-027, UPI-005, FIN-028, SMS acceptance vs CAP-010, CAP-012, FLOW-16, DEC-29)
- Priya moves ₹5,000 from HDFC to her ICICI account by UPI. Both banks' SMS quote the **same UPI RRN**. That is how UPI references work.
- The pipeline (DEC-29) runs FIN-027 matching first. Same reference, opposite direction, so FIN-028 applies: "a reversal of a failed payment cancels the original debit in the original's period". The HDFC debit is cancelled and the HDFC balance is ₹5,000 too high.
- The ICICI credit is either swallowed as the reversal leg (ICICI ₹5,000 too low) or posted as well (total assets ₹5,000 too high). FLOW-16 and CAP-010 never get a chance, because nothing says whether transfer pairing or reversal detection is evaluated first.
- The same hits a UPI payment to a known own wallet, and IMP-002 transfer-pair detection on CSV rows with shared references. RB0 "no known incorrect account balance" fails on one of the most common Indian money movements.
- Verified in prd.md: FIN-027 and UPI-005 state the opposite-direction rule with no account condition, and DEC-29 gives no evaluation order.
Fix: Make the reference rule account-aware: same reference, opposite direction, **same account** → reversal or refund; **two different owned accounts** (or a known own masked identifier) → transfer pair (FIN-013 / CAP-010); credit on an **unknown** account → hold for review with the transfer choice pre-selected. State in DEC-29 that transfer pairing runs before reversal/refund linking. Add SMS, UPI and DEDUP fixtures for a same-RRN own-account transfer.

**[Adversarial C2]** — Unlearned credits still auto-approve, into an expense category (§ CAP-007, CAT-006, §6.3 hero, CAP-004, INS-016, BDG-009 pre-fill)
- Arjun's ₹80,000 salary SMS arrives on the 25th from a verified sender, fully parsed, not transfer-like. He has no learned type for this payer yet, so it is CAP-007-eligible.
- At 21:00 it is written as confirmed "Uncategorised". Uncategorised is the expense category with no type, so a literal implementation either (a) books ₹80,000 into **Not classified** and the 50/30/20 hero subtracts his salary as spending ("Left in budget −₹40,000 · includes ₹80,000 not classified"), or (b) treats it as income of an unknown kind, inflating "Kept N%" and, if it lands in Salary, the BDG-009 income pre-fill.
- Unlinked refund credits and "From a person" repayments are auto-approved as income the same way.
- C1 in v1.3.0 asked for "any credit without a learned type" to be ineligible. That part of the fix was not applied.
- Verified in prd.md: CAP-007's eligibility list has no direction condition, and CAT-006 defines Uncategorised as a seeded expense-side category that feeds Not classified. Rubric raises the same gap as a medium.
Fix: In CAP-007, make credits eligible only when a credit type (Salary / Refund / From a person / own transfer) has been learned for that payer. Otherwise they stay `needs_review`. If the owner wants credits auto-approved anyway, define a separate "Uncategorised income" category that never enters Needs, Wants or Not classified. Add a CAP acceptance case: an unlearned salary credit at 21:00 is still Waiting for you, and Left in budget is unchanged.

### High (12)
*Rubric: 1 · Adversarial: 11*

**[Strategic coherence]** — The Savings bar measures the wrong thing for Indian users (§ ACC-009, BDG-009, DEC-30, FIN-010, CAT-006, §4.3, SCR-18)
- ACC-009 invites users to mark "a savings or deposit account". In India the ordinary salary and transaction account is called a savings account (SB A/c), so the natural choice is to mark the everyday account.
- BDG-009 then makes Savings "transfers in minus transfers out … can go below zero". Every card-bill payment (ACC-007), ATM withdrawal (FIN-013, CAP-012) and wallet top-up from that account is a transfer out, so Arjun's Savings bar sits deeply negative every month. Salary landing in that account is income, not a transfer, so it never counts.
- The common Indian saving channels (SIP, RD, PPF, insurance) cannot be modelled as transfers. FIN-010 has no investment or deposit account type, and investment tracking is Phase 3 (§4.3). They therefore post as expenses, inflate Needs, Wants or Not classified, and reduce "Left in budget".
- SCR-18 still lists a category type "need/want/savings", which contradicts CAT-006 ("Saving is never an expense category").
- The result is that the brand-mark figure is wrong for the persona it is built for. Adversarial H9 and H10 agree.
Fix: Pick one. (a) Add an asset account kind "Savings & investments" (balance optional); SIP/RD debits become transfers into it, and ACC-009 copy steers users away from marking their everyday account ("Don't mark the account your salary lands in"). (b) When no account is marked, define Savings as income − (needs + wants + not classified) and label the source. Either way, remove "savings" from SCR-18, and add an acceptance case: "salary account not marked; ₹42,000 card bill paid from it → Savings unchanged".

**[Adversarial H1]** — CAP-007 still describes read-time auto-approve (§ CAP-007 vs FIN-026(2), DEC-22, CAP acceptance)
- CAP-007: "Eligible captures still pending after the daily cutoff … **count as confirmed** and are materialized per FIN-026, **so nothing depends on a background job running**."
- FIN-026(2): "always a write, never derived on read … stay `needs_review` … until they are written". DEC-22 depends on a best-effort job **or** the next open.
- An agent given the CAP-007 story (WMB-16) implements a selector that counts eligible-past-cutoff items. That brings back every C3 failure: the widget disagrees with Home, the evening summary disagrees with Activity, and late duplicates shrink totals.
Fix: Replace the sentence with: "Eligible captures stay `needs_review` until written by FIN-026 (job or next open); nothing counts them before the write."

**[Adversarial H2]** — A discovered account's opening balance is off by the very transaction that discovered it (§ CAP-009, addendum §2 vs FIN-016)
- An ICICI debit SMS (₹1,200, Avl Bal ₹20,000) arrives at 10:02. Priya taps *Add it* at 13:40.
- CAP-009 sets the opening balance to ₹21,200, the balance **before** the debit. FIN-016 timestamps the opening at 13:40, so the 10:02 debit is "before tracking started" and does not post.
- The balance shows ₹21,200 against a real ₹20,000. Any other ICICI captures still waiting from earlier that day are also silently excluded.
Fix: For discovered accounts, set `opening_effective_at` to the instant just before the discovering transaction's `occurred_at`, or derive the opening balance as the available balance *after* the transaction and mark that transaction as before tracking. Add a GWT case with numbers.

**[Adversarial H3]** — Auto-approve can post to an account that does not exist yet (§ CAP-007, CAP-009, FLOW-15)
- In week 1, Priya gets SMS from three masked accounts and ignores the "New account ••7730 — add it?" prompts.
- The account is *parsed* (••7730), so the captures are eligible. At 21:00 FIN-026 must write `confirmed` postings, and there is no `account_id`.
- Engineer A auto-creates an account, skipping CAP-009's choice and possibly duplicating one that should have been "One of mine". Engineer B crashes the materialization transaction, blocking every other auto-approval that night. Engineer C posts to the default account, which makes that balance wrong.
Fix: Eligibility requires the account to be **resolved** to an owned account, not just parsed. Unresolved captures stay Waiting with the discovery prompt. Add this to the CAP acceptance.

**[Adversarial H4]** — Card-bill payments are counted twice through the two SMS legs (§ CAP-012, CAP-010, CAP-009, FIN-011)
- On the 5th, HDFC Bank sends "₹42,000 debited towards HDFC Credit Card ••1234". Transfer-like, both sides known, linked as a transfer: card dues fall ₹42,000.
- Minutes later the issuer sends "Payment of ₹42,000 received on your card ••1234". A credit on the card, transfer-like by wording, other side a known own account. It is linked as **another** transfer, so dues fall again: ₹84,000 for one payment.
- CAP-010's pairing only runs when the user marks a credit "Moved from my own account". Nothing says the second leg must find and merge into the first.
Fix: Before linking, a transfer-like capture must search for an existing transfer or transfer-like capture (opposite direction, same amount, FIN-027 window, same two accounts) and **attach as the other leg's source record**. It must never create a second transfer. Add CAP and DEDUP fixtures with both card-payment SMS.

**[Adversarial H5]** — "Without a shared reference" can be read two ways; one floods review for every repeat UPI payment (§ FIN-027, IMP-004, TXN acceptance, SMS-005)
- Priya pays the same tea stall ₹20 by UPI at 09:10 and again at 16:30. Each SMS has its own RRN.
- Reading A: the references differ, so no fuzzy check. Reading B: they have no *shared* reference, so the fuzzy rule applies and the second tea becomes `possible_duplicate`, never auto-approved. The daily metro top-up, the auto-rickshaw and the office canteen go the same way.
- The only identical-purchase acceptance covers **manual** entries. The "≥ 70% resolved with zero or one tap" metric collapses under reading B.
Fix: State that when both items carry references and the references differ, they are **not** duplicates; the fuzzy rule applies only when at least one side has no reference. Add DEDUP cases for two same-day UPI payments to the same payee with different RRNs.

**[Adversarial H6]** — Merge keeps the earliest record, which is often a receipt defaulted to Cash (§ FIN-027 Merge, OCR-011, TXN-012, OCR-012)
- Sara snaps a Tesco receipt at 18:05. New merchant, so Paid with defaults to **Cash**; Save confirms it, itemized into four categories.
- At 18:07 the card debit arrives and is flagged `possible_duplicate`. She taps Merge. FIN-027 keeps "the earliest confirmed record", the Cash receipt, and the card charge is excluded. Cash balance is £64 too low and card dues are £64 too low.
- The reverse order also fails: merging a receipt into an earlier SMS expense "lets the user choose the category", collapsing the receipt's itemized splits into one category.
Fix: Define Merge field by field: **account and amount** from the bank-sourced record (SMS, CSV or UPI) when present; **splits and items** from the receipt; **merchant** from the user's choice; **timestamp** the earliest. Add a GWT case with the receipt first and the card second.

**[Adversarial H7]** — The retention purge deletes the fingerprints that keep rejected items rejected (§ FIN-014, IMP-005, UPI-005, DEC-24)
- In June, Sara rejects 6 rows from a bank CSV: card payments she had already recorded as transfers.
- In October she imports a "last 6 months" export. The purged rows have no `source_record` fingerprint left, so they import again, this time as **confirmed** expenses. June spending rises by £1,900 and past totals she trusted change.
- The same happens to a re-shared UPI screenshot after 90 days, and to a "Delete permanently" manual entry whose CSV row is re-imported. DEC-24 also still promises rejected captures "can be re-approved later", with no time limit.
Fix: Purging must keep a **tombstone fingerprint**: a non-financial hash of (source kind, reference/fingerprint, direction) plus `rejected`. Later matches go to review as "You rejected this before", never auto-confirmed. Update DEC-24 to "within 90 days". Add an IMP acceptance case for re-importing after the purge.

**[Adversarial H8]** — A dismissed UPI share dialog auto-approves, so a forwarded payment screenshot becomes your spending (§ §13.2, CAP-007, UPI-002)
- A friend sends Priya a PhonePe "Paid ₹2,500 to Priya" screenshot on WhatsApp as proof of payment. She shares it to wmbugo out of curiosity and swipes the dialog away.
- It is a "Paid" layout, so it is parsed as **her** debit. At 21:00 it is auto-approved as a ₹2,500 expense from her default account. The same happens to screenshots shared by mistake, or old ones from the gallery.
- A dismissal is the user saying "not now" or "not this". Treating it as consent, and treating a screenshot as being as trustworthy as a verified bank sender, is backwards. The screenshot carries no proof that it came from this device's UPI account.
Fix: A dismissed share is `needs_review` and **not** auto-approve-eligible, or it is discarded with an Undo toast. If screenshots stay eligible at all, require the parsed payer account or VPA to match an owned account or a learned VPA. Add a UPI acceptance case: a dismissed screenshot is still Waiting the next morning.

**[Adversarial H9]** — SCR-18 offers a "savings" category type that the rest of the PRD forbids (§ SCR-18 vs CAT-006, §10, §11.1 budget_type, DEC-30)
- The UX designer works from the screen inventory and draws a three-way type picker.
- An agent builds the editor from SCR-18 and adds `savings` to the enum. The schema rejects it, or someone widens the schema. A "SIP" category typed savings then counts as an expense *and* feeds the Savings bar: the old C2 double count over again.
Fix: Change SCR-18 to "need/want (expense categories only)". If the owner wants SIPs in Savings, see H10; do not do it through a category type.

**[Adversarial H10]** — "Savings account" is a trap name in India, and SIPs still never reach the Savings bar (§ ACC-009, BDG-009, FIN-010, DEC-30)
- In India almost every retail account is called a "Savings Account". Arjun marks his HDFC salary account as savings, because it *is* one. From then on every wallet transfer, card-bill payment and move to another account reduces Savings.
- His Savings bar shows −₹38,000 every month, and the brand-mark feature tells him he saves nothing.
- If he correctly leaves it unmarked, his real savings (₹10,000/month SIP debits, plus an RD) are expense debits to a non-account. They land in Needs, Wants or Not classified, and Savings is ₹0. Either way the core Indian persona sees a wrong Savings bar.
Fix: Rename the flag in the UI to "Money I'm saving (not for spending)" and explain that a bank's "savings account" label does not qualify it. Exclude card-bill payments out of a savings-marked account from Savings. Add a P1 **Investments / deposits** asset account type (or an "investment" transfer target) so SIP/RD debits count toward Savings without being expenses. Add a 5030 acceptance case covering a SIP debit.

**[Adversarial H11]** — Every discounted receipt trips the "items exceed total" mismatch (§ OCR-005, FIN-022, OCR-004, §3.3)
- A Tesco receipt lists items totalling £52.40 and "Clubcard savings −£6.10", for a total of £46.30. Item amounts exceed the total, as they should.
- A literal agent flags a mismatch and forces Sara to "fix the items or the total" on every supermarket receipt in the UK, US and SG, where loyalty prices are everywhere. The ≤ 20 s receipt metric and "saving with not-itemised is normal" both fail.
- Discount allocation (line-level vs pro-rata) is unspecified, while tax has an exact rule.
Fix: The mismatch check is **(items + tax + fees − discounts) > total**. Allocate a discount to its line when printed under an item; otherwise pro-rata like tax. Add an OCR fixture with a loyalty discount.

### Medium (29)
*Rubric: 10 · Adversarial: 19*

**[Decision-readiness]** — GATE-02 has two deadlines and no default if it cannot be resolved in M1 (§ §20 M1, §24 GATE-02, SMS-016)
- §20 M1 (2026-11-03 → 11-07) says "resolve GATE-02 … before choosing the application ID and flavor structure", and GATE-02 says "before the application ID is chosen (M1)".
- SMS-016 still says "GATE-02 must confirm before M3".
- The answer depends on Play policy interpretation, which is outside the developer's control, while M1 is five working days that also hold the ledger, encryption, migration and pipeline spikes.
Fix: Change SMS-016 to "before M1 (GATE-02)". Add a default to GATE-02: "If not confirmed by end of M1, choose the two-package structure (distinct application IDs) so no later migration is forced."

**[Strategic coherence]** — Free to use tells a 50/30/20-only user to "Set a limit" (§ BDG-008 and its acceptance, §6.3 #2, HOM acceptance)
- The BDG acceptance says: with "no overall budget, … Free to use shows 'not enough information yet — Set a limit'".
- §6.3 gives the same 50/30/20-only user a real "Left in budget" figure, (Needs + Wants targets) − spending.
- BDG-008's `budget_remaining` is never defined for this setup, so Home and Plan disagree about whether a limit exists. This is Arjun's main flow (FLOW-14).
Fix: Define `budget_remaining` in BDG-008 as "the hero's Left in budget (§6.3), including the 50/30/20-only form". Limit the "Set a limit" case to "no overall budget and no 50/30/20".

**[Done-ness clarity]** — CAP-007 and FLOW-09 still describe read-time auto-approval, contradicting FIN-026 (2) (§ CAP-007, FLOW-09, FIN-026, DEC-22)
- FIN-026 (2): "Auto-approval is **always a write, never derived on read** … stay `needs_review` — 'Waiting for you' on every surface … until they are written".
- CAP-007 still says eligible captures pending after the cutoff "**count as confirmed** and are materialized per FIN-026, **so nothing depends on a background job running**".
- FLOW-09 says "eligible ignored items count as confirmed after the cutoff".
- An agent building from CAP-007 can rebuild the derived model that v1.3.1 removed. Adversarial raises this as H1.
Fix: Change CAP-007 to "…are written as confirmed (`auto_approved`) per FIN-026, by a best-effort background job or the next app open; until then they are Waiting for you". Change FLOW-09 to "…are written as confirmed after the cutoff (FIN-026)".

**[Done-ness clarity]** — CAP-012 auto-links transfers outside the FIN-026 contract (§ CAP-012, CAP acceptance, CAP-007, FIN-024, FIN-026 (3), §11 capture_resolution)
- CAP-012: transfer-like captures "are never auto-approved … when both sides are known they are linked as a transfer". The CAP acceptance has this happen "when 21:00 passes … it is linked as a card payment if the card account exists".
- That is an automatic financial write, but CAP-007 excludes transfer-like captures from auto-approve, FIN-026 covers only eligible captures, and `capture_resolution` has no value for it (`user_approved | auto_approved | rejected`).
- Nothing says when the link happens, whether the clock guard and audit row apply, or how the user sees it. The trigger is text matching, so the case needs a visible, reversible state. Adversarial H4 shows the double-link this enables.
Fix: Either make auto-linking a FIN-026 write ("at the cutoff, transfer-like captures whose both sides are known are written as a confirmed transfer with `capture_resolution = auto_linked` and an audit row; label 'Recorded · linked as transfer'"), or require the user's tap. Add the value to §11 and the status-mapping table.

**[Done-ness clarity]** — Auto-approval of credits with no learned type is undefined (§ CAP-007, CAP-004, CAT-006, FIN-028, INS-016)
- CAP-007 allows any direction and confirms an uncategorised capture "as 'Uncategorised' with the `needs_category` flag". Uncategorised is an *expense* category (CAT-006).
- For a credit from a verified sender with no learned type, the PRD does not say whether it becomes income, a refund or a transfer. Income inflates "Kept N%"; FIN-028 says a refund is never income.
- The v1.3.0 adversarial review (C1) asked for "any credit without a learned type" to be ineligible. Only the transfer-like part was adopted. Adversarial raises this as critical C2.
Fix: Add to CAP-007: "a credit is eligible only when its income type (CAP-004) is learned for that payer; otherwise it waits". Add a CAP acceptance case.

**[Done-ness clarity]** — App-lock notification redaction is stated in only one of the three places that govern it (§ SET-005, SEC-005, CAP-001, SEC acceptance)
- SET-005 (v1.3.2): "With app lock on, capture notifications use the redacted public version (no amount or merchant) even on an unlocked device unless the user opts in".
- SEC-005 still says the full details show "only when the device is unlocked", with no app-lock or hide-amounts exception.
- CAP-001 still lets Approve/Reject run from the shade "without unlocking (it … reveals nothing new)". On a redacted notification that is a blind approval (adversarial M8).
- No acceptance case covers notifications under app lock or under hide-amounts.
Fix: Restate the rule once in SEC-005 and reference it from CAP-001 and SET-005. Decide whether a redacted notification shows Approve/Reject at all (recommended: only "Review", which requires unlock). Add GWT cases for an unlocked device with app lock on, and for hide-amounts on.

**[Done-ness clarity]** — Free to use and goal over-assignment contradict each other (§ BDG-008, GOAL-004, GOAL acceptance 4)
- BDG-008's formula is `max(0, min(…))`, so Free to use is never negative.
- The GOAL acceptance says the app "shows Free to use honestly (it may be negative)".
- GOAL-004 says "the same set-aside amount cannot be assigned to two goals", but the acceptance lets the user do it with a warning. Adversarial M6 agrees.
Fix: Pick one: either floor at 0 and block the second set-aside, or allow it and show a negative figure. Align BDG-008, GOAL-004 and the acceptance.

**[Done-ness clarity]** — The v1.3.2 retention rule contradicts older text and has no acceptance (§ FIN-014, DEC-24, FIN-024, §7.3 status-mapping paragraph, CAP-008, FLOW-18, SEC-008)
- FIN-014 now purges soft-deleted manual entries after 30 days and rejected captures after 90 days, adds Delete permanently, and says "purges propagate to the next backup".
- DEC-24, FIN-024 and CAP-008 still promise rejected captures "can be re-approved later" with no time limit.
- The paragraph after the status mapping says a deleted manual entry "keeps its audit row and **backup copy**".
- No GWT case covers the purge, "Show rejected" at day 91, or Delete permanently on an item that is part of a transfer or refund link. Adversarial H7 and L6 agree and add the lost-fingerprint path.
Fix: Add "(for 90 days, FIN-014)" to DEC-24, FIN-024 and CAP-008. Change "backup copy" to "copy in backups made before the purge". Add acceptance cases: "rejected capture at day 91 is gone from Show rejected"; "Delete permanently on a linked transfer removes both legs after confirmation" (or blocks it).

**[Done-ness clarity]** — Many v1.3.1/1.3.2 additions have no GWT case (§ §22.1, CAP-009, CAP-012, FIN-002, FIN-026 (6), FIN-027, IMP-001/002/005, BDG-007/008/009, §13.2, DEC-33)
- §22.1 makes such stories not Ready. These are covered only as §16.1 suite keywords or not at all:
- CAP-009 account discovery (type pre-select, "available limit never used as a balance", (sender, mask) keying); CAP-012 debit choices.
- FIN-002 cross-zone prompt and DST; FIN-026 (6) clock guard; FIN-027 Merge outcome.
- IMP-001 encodings and decimal commas; IMP-002 flip sign and transfer-pair proposal; IMP-005 resume after interruption.
- BDG-007 "effective now vs next period"; BDG-008 with the gate passing; the BDG-009 >10% income update offer.
- §13.2 dismissed UPI share dialog becoming pending and auto-approvable; DEC-33 early-salary rule.
Fix: Add one GWT case for each, using the module's existing style. The worked numbers already exist in the requirement text.

**[Downstream usability]** — The §11 data model has gaps against the v1.3.x FRs (§ §11)
- **Retention (FIN-014):** no `excluded_at` or `deleted_at`, so the 30- and 90-day purges cannot be computed reliably from `updated_at`; a manual Delete and a review-queue exclude are both `excluded` with no `capture_resolution`. Add `removed_at` and `removal_kind[deleted|rejected|excluded]`.
- **CAP-012 auto-link:** no `capture_resolution` value for it.
- **Duplicate auto-approve settings:** `profile.auto_approve_enabled / auto_approve_cutoff_local / auto_approve_rule_effective_from` duplicate the versioned `auto_approve_rule` table. Keep only the table.
- **`transaction.before_tracking_started` is stored**, but FIN-016 makes it derivable from `opening_effective_at`. Mark it derived.
- `account` has no `sort_order` (ACC-001); `import_batch` has no `raw_path?` or `retain_until?` (IMP-006); `recurring_rule` has no `kind` (REC-007).
- **Goal links run both ways:** `transaction.goal_id?` and `goal_allocation.transaction_id?`. Pick one.
- **Clock guard (FIN-026 (6)):** relies on "elapsed time since boot" but stores only `last_materialized_at`. State what is stored across reboots (adversarial M1 agrees).
Fix: Add the listed fields, drop the duplicates, and state the clock-guard storage.

**[Adversarial M1]** — The clock guard can block auto-approve for days, and "elapsed since boot" is lost on reboot (§ FIN-026(6))
- The clock jumps to 2027 (a dead CMOS battery or a bad network-time update); `last_materialized_at` is recorded as 2027; the clock is corrected. "Not earlier than the last time the app recorded" now blocks every write until 2027.
- "Elapsed time since boot" resets on reboot, and the PRD gives no fallback. Two engineers will build different guards.
Fix: Store `(wall_time, elapsedRealtime, boot_count)` at each open; if boot_count is unchanged, trust the elapsed delta; after a reboot, trust the wall clock only if it is ≥ the stored wall_time and ≤ stored + 30 days, otherwise skip auto-approve until the next open and log it. Clamp the high-water mark so it never exceeds now + 1 day.

**[Adversarial M2]** — Turning auto-approve off at 20:55 still approves today's captures (§ FIN-026(4), CAP acceptance)
Priya disables auto-approve at 20:55 because she wants to check today's six items herself. At 21:00 they are confirmed anyway. That is surprising, and it contradicts the "trust over pressure" principle.
Fix: Disabling, or moving the cutoff *later*, takes effect immediately for captures not yet written; only *tightening* changes need versioning. Alternatively, show "Takes effect tomorrow — today's 6 will still be recorded at 21:00".

**[Adversarial M3]** — The evening summary reports "recorded" before anything is written (§ CAP-007, SET-003, addendum §3)
The summary fires at 21:00 ("Today: 6 recorded · 2 categories guessed"), but the background job has not run, so all six are still `needs_review`. Priya opens it and sees "6 to check" on Home: two numbers that disagree, on the trust-critical path.
Fix: Build the summary only after the materialization write has committed, inside the same job. If the job did not run, word it "6 will be recorded when you open wmbugo".

**[Adversarial M4]** — The timezone rule contradicts its own example and leaves period membership open (§ FIN-002)
- The rule prompts only when device and profile differ by "more than 6 hours". Its own example, "You're in Dubai time", is London→Dubai: 3–4 hours. That trip never prompts, nor does London→New York or Mumbai→London. The cutoff then fires at 16:00 in New York.
- Is period membership by `local_date` or by the UTC instant in the profile zone? A Dubai 01:30 purchase on the 25th lands in different pay cycles under the two readings. CSV rows have a date only, and their zone is unstated.
Fix: Prompt on any offset difference ≥ 2 h lasting more than 24 h. Period membership uses `local_date`; date-only imports use the profile zone. Fix the example.

**[Adversarial M5]** — A payday change splits the hero from Insights and leaves gap days (§ BDG-002 vs DEC-33, §6.3)
Arjun changes his payday from the 1st to the 25th on 10 November. Insights and Plan switch at once; the overall budget, and so the hero, stays on 1–30 November. From 25 to 30 November the hero and Insights describe different windows, and the first new cycle is not said.
Fix: Define the transition: the current period runs to the day before the new payday, then a short bridging period with a pro-rated target (or none), and DEC-33's default period changes at the same instant as the overall budget.

**[Adversarial M6]** — GOAL-004 allows a negative Free to use; BDG-008 clamps it at zero (§ GOAL-004 acceptance vs BDG-008)
An agent implementing BDG-008 cannot pass the GOAL acceptance test, and an agent implementing the acceptance test breaks the formula.
Fix: Pick one. Recommended: drop `max(0, …)` and show a negative value as "Short by ₹X", since the PRD values honesty.

**[Adversarial M7]** — Unlinked refunds, negative categories and reversals in closed periods (§ BDG-006, §10 Budget used vs FIN-028)
- An agent reading BDG-006 ("minus **linked** refunds") ignores unlinked refunds in budgets, while Insights (FIN-028) subtracts them, so the two disagree.
- A ₹9,000 November refund for an October TV, against ₹2,000 of November Shopping, gives Shopping −₹7,000, which can make the Wants bar negative and inflate Left in budget by ₹7,000.
- A reversal on the 2nd for a payment on the 30th rewrites last month's totals after its alerts have fired.
Fix: Make §10 and BDG-006 read "minus refunds (linked or categorised)". State whether a category, Needs or Wants total can go below zero (recommended: clamp the bars at zero and show the surplus refund separately). Accept that reversals rewrite the original period, and say that alerts do not re-fire.

**[Adversarial M8]** — Blind Approve: the notification hides the amount, but the Approve button is live (§ SET-005, CAP-001)
With app lock on, the shade shows "wmbugo · 1 new transaction [Approve] [Reject]". The user approves something they cannot see, which defeats the point of a one-tap check.
Fix: When the redacted version is shown, offer only "Review" (which unlocks the app). Approve/Reject appear only on the full version.

**[Adversarial M9]** — A credit from a new legitimate bank is scam-flagged, and the sender can never be confirmed through it (§ SMS-011, SMS-017)
A cooperative or small-finance bank not on the allow-list sends a salary credit; it is shown as "This looks like a scam — not added". SMS-017's "It's my bank" prompt is only reachable through a *debit*, so these users lose every credit until they happen to make a debit.
Fix: A credit from a well-formed DLT header that is not allow-listed and has no link or prize wording gets the SMS-017 prompt and is held (`needs_review`). Only credits with links or claim wording, or from a phone number, are scam-flagged.

**[Adversarial M10]** — "Cash withdrawal (to the Cash account)" assumes a Cash account exists (§ CAP-012, ONB-002 ③, FIN-013)
The user set up only HDFC at onboarding. An ATM SMS arrives and there is no Cash account to link to. The item waits forever ("when both sides are known"), or an agent posts it as an expense.
Fix: Choosing Cash withdrawal creates a Cash account on first use, with "balance not set" or ₹0 starting at that instant. State this.

**[Adversarial M11]** — IDR and HUF hide decimals that are stored, which breaks round-trip and the keypad (§ §13.0a, §7.4, FIN-001)
A CSV row "Rp 12.345,67" is stored as 1234567, displays "Rp 12.346", and parses back as 1234600: the §7.4 invariant fails. Displayed totals stop summing to displayed rows, and it is unclear whether the keypad allows IDR decimals.
Fix: Use a display/entry exponent of 0 for IDR and HUF. Imports with non-zero minor units are rounded with a visible warning, or rejected. The round-trip invariant applies to the display exponent.

**[Adversarial M12]** — "Profile region" is never defined (§ ONB-002 ②, §13.0a, §11.1 profile.region)
One engineer stores a market group ("UK/Europe"), another an ISO country. With a market group, the EUR locale cannot be chosen; with a country, the gating code has to map about 30 countries to "India".
Fix: `region` is an ISO 3166 country code. Market group and default locale are derived from a country table, and the gating rule is `region == "IN"`.

**[Adversarial M13]** — `account.masked_identifiers[]` duplicates `account_identifier` and brings back mask collisions (§ §11.1 account, account_identifier, FIN-010)
An agent matches captures against the convenient array on `account`. ICICI ••7730 and Axis ••7730 collide again (old H5).
Fix: Remove `masked_identifiers[]` from `account`. FIN-010 refers to `account_identifier`.

**[Adversarial M14]** — "No INTERNET permission" will be undone silently by the manifest merger (§ SEC-002, SEC acceptance, addendum §1)
React Native's template and several libraries declare `INTERNET`, and the merger adds them to the release manifest. Debug builds *need* INTERNET for Metro, so every developer test runs with network available; an SDK that quietly needs network works in debug and fails only in release.
Fix: Require `<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>` in the release source set and a CI step that runs `aapt dump permissions` on the release APK. Run the airplane-mode E2E suite (NFR-01) on the **release** variant.

**[Adversarial M15]** — The capture inbox needs Direct Boot specifics the PRD never names (§ SEC-001, §11.1 capture_inbox, NFR-16)
- Before first unlock, only receivers marked `android:directBootAware="true"` get `SMS_RECEIVED`, and only device-protected storage is writable. An agent that does not know this ships a receiver that never fires before unlock.
- "Encrypted … readable without user authentication" needs a key available before unlock, which protects nothing against device theft. There is no inbox retention rule and no dedup rule for an SMS the OS re-delivers after unlock.
Fix: Name a direct-boot-aware receiver, device-protected storage, and a key usable only in direct boot. Drain within N seconds of unlock and delete drained rows. Dedup by SMS fingerprint on drain.

**[Adversarial M16]** — The GATE-02 deadline cannot be met and the gate is unnecessary (§ §20 M1, GATE-02, M2 start)
Play's SMS-declaration eligibility answers take weeks; M2 needs an application ID on 8 November. Either the alpha slips or the gate is self-certified. The stated fallback never changes the **main** package ID anyway.
Fix: Fix the main application ID now as the no-SMS package. Reserve a second ID for a possible SMS edition. Move GATE-02 to "before the M3 SMS declaration".

**[Adversarial M17]** — The reference-set protocol distorts the UPI accuracy it is meant to measure (§ §16.3, §3.3, GATE-08)
Payee names and UPI IDs are exactly the fields UPI-002 extracts. Once redacted, the real-set measurement cannot score payee extraction, and the redaction boxes change the layout the parser depends on. GATE-08's review must also happen *before collection* (M3). How testers transfer files (email, WhatsApp) is not covered, and that is where third-party data actually leaks.
Fix: Measure on the device at collection time, before redaction, and store only results plus redacted copies. Specify an encrypted transfer channel (no chat apps). Schedule the GATE-08 review before M3.

**[Adversarial M18]** — Identical CSV rows meet the fuzzy rule after the first commits (§ FIN-027, IMP-004, IMP-005)
Two Pret £3.50 lines on 20 October: row 1 commits in batch 1, then row 2 is checked against the ledger and becomes `possible_duplicate`. "Kept as distinct rows" does not say whether row 2 is confirmed or held. Overlapping exports can also shift occurrence indices when the file boundary cuts a day in half.
Fix: Rows from the same file are never fuzzy-matched against each other. The occurrence index is per (date, amount, description) group. Rows from a partial first or last day go to review.

**[Adversarial M19]** — The balance chain will flag ordinary days as suspicious (§ SMS-012)
NACH/ECS debits, card auto-pays, interest credits and bank charges often arrive with no SMS, and SMS can arrive out of order. The next SMS balance mismatches, the capture is flagged, and auto-approve is lost on the most routine day. "Allowing for intervening … transactions" has no tolerance and no ordering rule.
Fix: Compare in `occurred_at` order. A mismatch flags only when the difference equals neither this transaction's amount nor zero. A flagged chain resets silently once and flags only a second consecutive mismatch.

### Low (16)
*Rubric: 8 · Adversarial: 8*

**[Decision-readiness]** — "Absorbed by the staged rollout" still overstates what §20 offers (§ §4.1 last line; §24.1 impact notes for v1.3, note 2)
Unchanged from the v1.3.0 review. Schedule pressure actually moves the undated M3–M5, which §20 states honestly.
Fix: "Schedule pressure moves the M3–M5 dates (set at the M2 checkpoint), not scope."

**[Substance over theater]** — A few adjective bounds remain (§ NFR-06, NFR-19, OCR-001, OCR-007, §6.6)
- NFR-06 "UI animation aims 60 FPS" and NFR-19 "keep 60 FPS scrolling" have no tolerance, unlike NFR-07's "≥ 95% of frames".
- OCR-001 says "compress safely" and OCR-007 says "fails gracefully".
- §6.6 says the fallback "must look intentional, not degraded".
Fix: Reuse the NFR-07 form for NFR-06 and NFR-19. For OCR-001, state the maximum dimension and quality. For OCR-007, state "manual entry offered within one tap; image kept".

**[Done-ness clarity]** — INS-001 still diverges from §6.5 (§ INS-001, §6.5)
It says "Presets as in §6.5" but then lists them again without "Yesterday" and with "Quarter, Year" instead of "This quarter, This year". Adversarial L2 agrees.
Fix: Drop the restated list and leave only "Presets as in §6.5".

**[Done-ness clarity]** — The word "unallocated" still conflicts with "Not itemised" (§ FIN-022, OCR-005 vs TXN-009)
TXN-009 says "A receipt's 'Not itemised' amount is not unallocated". FIN-022 still says "Missing OCR items are handled by explicit *unallocated amount*", and OCR-005 says "unallocated discrepancy is explicit". FIN-022 is the invariant source GATE-07 checks fixtures against. Adversarial L1 agrees.
Fix: In FIN-022 and OCR-005, write "a 'Not itemised' split row (TXN-009)".

**[Scope honesty]** — REC-007 and REC-008 still have no phase and no screen (§ §8.6, §5.2, REC-005, INS-022)
REC-007 "reject suggestions" only makes sense with REC-005 inference, which is Phase 2. REC-008's "Subscription page" has no SCR entry, and INS-022 is P2. Unchanged from v1.3.0.
Fix: Tag REC-007 as P2. Either tag REC-008 as P2 or fold it into SCR-16 with a P1 scope sentence.

**[Scope honesty]** — GATE-05 still requires "iOS/Android parity" as Phase 1 evidence (§ §24 GATE-05, DEC-10)
iOS OCR is Phase 2 (DEC-10).
Fix: Mark that part "(Phase 2)".

**[Scope honesty]** — The dismissed-UPI-dialog rule is scoped inconsistently (§ §13.2 CAP row, SCR-29 row, DEC-22)
- The dismissal-becomes-pending rule is stated only for the India **no-SMS** build; the SMS build's behavior is unstated.
- The other-markets text says the widget shows "N to check" only for review items such as import duplicates, while the SCR-29 row says the "pending count reflects UPI/receipt captures".
- Treating a dismissal as implicit approval at 21:00 is a product choice that deserves a line in DEC-22. Adversarial H8 goes further and calls it a high.
Fix: Move the dismissal rule into UPI-003 or CAP-007 so it applies to both India builds. Make the SCR-29 row market-specific.

**[Downstream usability]** — The stale-text sweep is incomplete (§ DEC-21, §13.2, FIN-025, FLOW-15/17, Appendix A, §10, §3.3, §5.3, §13.0a, addendum §2–3)
- DEC-21 lists automated captures as "(SMS, bill match)", omitting UPI share and receipt match.
- §13.2 says "SMS-001..016 … Absent" (SMS-017 exists) and "LRN-001..007 Present" (LRN-008/009 exist). FIN-025 says "per LRN-001–LRN-006".
- FLOW-17 "amount = outstanding" vs ACC-007 statement due; FLOW-15 "bank account created" vs CAP-009 pre-select; Appendix A #2 "attach/create/exclude" vs OCR-010.
- Glossary "Mixed merchant" and "Left in budget" are stale; "v1" still means the release in §3.3, §14, §19, §20 and §23; §5.3 says "dynamic island"; the §13.0a currency row lists 13 codes, the list below has 23.
- Addendum: §3 widget "● count" vs HOM-007 "N to check"; §2 "within N minutes" vs FIN-027 ±1 day; §3 vocabulary lacks "Recorded · needs a category"; the receipt match omits Discard. The 1.3.2 change log claims the widget fix.
Fix: One sweep across the PRD and the addendum.

**[Adversarial L1]** — "Unallocated" is still used for Not itemised (§ FIN-022, TXN-009)
FIN-022 says missing OCR items are "explicit *unallocated amount*". TXN-009 says Not itemised "is not unallocated".
Fix: Reword FIN-022 to refer to the Not itemised split row (TXN-009).

**[Adversarial L2]** — The INS-001 presets still omit Yesterday (§ INS-001)
INS-001 says "as in §6.5" and then lists the presets without Yesterday.
Fix: Delete the inline list.

**[Adversarial L3]** — The "seven row states" are incomplete (§ TXN-006)
TXN-006 omits refund, reversed, "before tracking started" and foreign-currency waiting rows.
Fix: Add them, or call the list "primary states" and specify the rest.

**[Adversarial L4]** — The addendum contradicts the PRD (§ addendum §2, §3)
- The widget is "● count"; the PRD says "N to check" text.
- Own-account pairing is "within N minutes"; FIN-027 says ±1 day.
- The vocabulary lacks "Recorded · needs a category".
Fix: Align the addendum with the PRD.

**[Adversarial L5]** — Data-model leftovers (§ §11.1, FIN-024)
- `profile.auto_approve_rule_effective_from` is redundant with the `auto_approve_rule` table.
- FIN-024 lists `possible_duplicate` as a status flag, while §11.1 derives it from `review_candidate`.
- `goal.allocated_minor` is redundant with `goal_allocation`.
Fix: Drop the stored duplicates.

**[Adversarial L6]** — Deleted manual entries: backup copy vs purge, and an unreachable "Delete permanently" (§ §7.3 status mapping, FIN-014)
The status mapping says a Delete "keeps its audit row and backup copy"; FIN-014 says purges propagate to the next backup. Deleted entries are "hidden everywhere", so a deleted item's own detail screen cannot offer Delete permanently.
Fix: Say "kept in backups until purged (30 days)". Settings → Data → "Recently deleted" lists them.

**[Adversarial L7]** — DEC-21 still promises a single Approve/Reject for every capture (§ DEC-21, CAP-012, CAP-004, OCR-010)
CAP-012 (transfer choices), CAP-004 (credit types) and OCR-010 (Attach/Keep/Discard) all depart from it.
Fix: Amend DEC-21 to "Approve/Reject for categorised captures; typed choices for credits, transfer-like captures and receipt matches".

**[Adversarial L8]** — §13.2 omits SMS-017 (§ §13.2)
The no-SMS table marks SMS-001..016 absent. SMS-017 (the unknown-sender prompt) is not listed.
Fix: SMS-001..017.

## Mechanical notes
- **ID continuity:** IDs are unique and the references checked resolve (including §16.3 and §16.4). Listing order is still out of sequence: FIN-016 before FIN-011 and FIN-026/027/028 before FIN-025; TXN-012/013 before TXN-009; CAP-012 between CAP-004 and CAP-005; REC-009/010 before REC-008; HOM-008 before HOM-007; INS-007 before INS-005 (INS-008/009 do not exist); SCR-27..31 before SCR-25/26; WMB-16..18 before WMB-13. Either reorder, or add under §0: "IDs are stable; new IDs are appended next to related items."
- **Source legend:** `[v1.3]` is now defined in §0. Resolved.
- **DEC-23:** the stale cross-reference is fixed ("now specified in LRN-001–009"). FIN-025 still points to LRN-001–006.
- **§6.3 near-duplicate sentence:** "Each card has a clear period label." is followed directly by "Each card supports tap-to-details … and a clear period label."
- **Release labels:** RB0/RB1 in §16.2 resolve the P0/P1 collision. DEC-22 correctly references "RB0".
- **Glossary (§10) gaps:** no entries for auto-approve or daily cutoff, Not classified, Not itemised, `needs_category`, savings account (ACC-009), Savings share, or Kept. "Mixed merchant" and "Left in budget" are stale.
- **Change log:** still no 1.0.0 baseline row, although the numbering note names one. The 1.3.1 "Decisions affected" column omits CAP-012's effect on FIN-024 and the status mapping.
- **Assumptions Index:** none. The one inline `[ASSUMPTION]` (SMS-016) round-trips to GATE-02 and §25, but its "before M3" deadline conflicts with GATE-02.
- **UJ protagonists:** all 18 flows name a protagonist with market and currency. There is still no non-India flow for a receipt match against an imported CSV row, which the receipt-first markets rely on.
- **Required sections:** all present for a chain-top consumer PRD.

## Reviewer files
- `review-rubric.md`
- `review-adversarial-general.md`
