---
title: Adversarial review — wmbugo PRD v1.3.2
reviewed: prd.md v1.3.2 (all sections) + addendum.md
previous: review-adversarial-general-v1.3.0.md
date: 2026-11-01
reviewer: adversarial general review (read-only)
---

# Adversarial review — wmbugo PRD v1.3.2

**Verdict:** v1.3.1/v1.3.2 closed most of the earlier double-counting holes. The fixes then opened new ones where they meet each other. The "same reference, opposite direction = reversal" rule turns ordinary own-account UPI transfers into reversals. Credits with no learned type still auto-approve into an expense category. Account discovery, Merge and the retention purge each have a path that leaves a wrong balance or brings rejected money back. Do not freeze until the two critical findings and the high findings on the ledger path (H1–H7) are closed.

**Previous findings:** 21 critical/high re-checked. 18 fixed; 3 partly open (C1, C3, H16).

**New findings:** **2 critical · 11 high · 19 medium · 8 low**

Owner decisions are not argued here: Android-only, solo developer, international launch, no cut list, and 50/30/20 in Phase 1. Every finding is about how the PRD specifies them.

---

## Previous findings re-check (critical and high from v1.3.0)

| ID | Title (short) | Status | Evidence in v1.3.2 / what is left |
|---|---|---|---|
| C1 | Card bills, ATM and own-account moves auto-approved as spend/income | **Partly open** | Debits are fixed: CAP-012 adds transfer choices and makes transfer-like captures ineligible, with acceptance for card-payment wording. Credits are not. CAP-007 still auto-approves a credit with no learned type as "Uncategorised", which is an expense category (see new **C2**). There is still no carve-out for turning an already auto-approved plain IMPS/NEFT debit into a transfer when the matching credit arrives the next day (CAP-010 only pairs with an "opposite-direction **capture**"). The H3 fix also adds a new path (new **C1**). |
| C2 | 50/30/20 Savings double-counts goal contributions | **Fixed** | BDG-009 defines Savings as net transfers, counted once, with the ₹5,000 → ₹5,000 acceptance and the netting acceptance. What is left (SIP debits, Indian "savings account" naming, card bills paid from a savings account) is new **H10**. SCR-18 now contradicts it (new **H9**). |
| C3 | Read-time auto-approve breaks the one-set rule and dedup | **Partly open** | FIN-026(2) is right: "always a write, never derived on read". Rule history, the clock guard and the acceptance are added. But CAP-007 still says eligible captures "**count as confirmed** and are materialized per FIN-026, **so nothing depends on a background job running**". That is the pre-fix read-time wording, and an agent reading CAP-007 alone builds the derived version again (new **H1**). |
| C4 | Manual possible duplicate saved as confirmed | **Fixed** | TXN-012 now saves `needs_review` + `possible_duplicate`, not counted, with GWT and a status-mapping row. |
| C5 | 50/30/20 hero ignores unclassified spend | **Fixed** | §6.3 subtracts Not classified, and the HOM acceptance has worked numbers (₹12,000). |
| H1 | Timezone undefined | **Fixed, with new gaps** | The FIN-002 rule exists. Its own threshold contradicts its example, and period membership is still ambiguous (new **M4**). |
| H2 | Duplicate windows unspecified, Merge undefined | **Fixed, with new gaps** | FIN-027 has windows, an occurrence index and Merge. "Without a shared reference" is ambiguous (new **H5**), and Merge picks the wrong account (new **H6**). |
| H3 | UPI ref dedup swallows reversals | **Fixed, but caused a critical** | The (reference, direction, event type) key and failed-screen rejection are in. The opposite-direction rule now catches own-account transfers (new **C1**). |
| H4 | Auto-approvals teach learning | **Fixed** | LRN-008 plus acceptance. |
| H5 | Balance chain per sender; cards as banks; mask collisions | **Fixed** | SMS-012, CAP-009 and the `account_identifier` unique key are in. The data model still carries a second, unkeyed `account.masked_identifiers[]` (new **M13**). |
| H6 | DLT header normalization | **Fixed** | SMS-010 normalization plus header-variant acceptance. |
| H7 | OCR SDK vs no-outbound | **Fixed** | SEC-002 has no `INTERNET` permission, plus GATE-05 and the Data safety check. There is a manifest-merger trap (new **M14**). |
| H8 | Real receipts vs synthetic fixtures | **Fixed** | §16.3 protocol. Its redaction rule undermines the UPI accuracy measurement (new **M17**). |
| H9 | SMS lost before first unlock | **Fixed** | SEC-001 capture inbox plus GWT. Direct-boot specifics are missing (new **M15**). |
| H10 | Hero period vs budget period | **Fixed** | BDG-002 allows one overall budget, always on the default period. The payday-change transition is a gap (new **M5**). |
| H11 | Refund treatment undefined | **Mostly fixed** | FIN-028 and `refund_of_transaction_id` are in, and FIN-021 is rewritten. BDG-006 and §10 still say "minus **linked** refunds", which contradicts the FIN-028 rule for unlinked refunds (new **M7**). |
| H12 | OCR "always real total"; negatives; tax; tips | **Fixed, with a new trap** | OCR-005 makes the total user-confirmed, allocates tax pro-rata and blocks negative rows. "Items never exceed the total" fires on every discounted receipt (new **H11**). |
| H13 | Auto-approve advances bill rules | **Fixed** | FIN-026(3) plus CAP acceptance. |
| H14 | Currency list vs markets; pre-select; gating | **Fixed** | The list is extended, pre-select uses the device region, currency can change with no transactions, and there is a single gating rule. "Region" itself is undefined (new **M12**). |
| H15 | OCR-010 Reject creates expense | **Fixed** | Attach to it / Keep separate / Discard. |
| H16 | One-package Play assumption has no fallback | **Partly open** | The two-package fallback and cross-package restore are now specified. The gate moved to M1, which is a five-day window in which a Play policy answer cannot be obtained, and the gate is unnecessary given the fallback itself (new **M16**). |

Previous medium and low findings: most are addressed (M1–M5, M8–M10, M12–M21, L1, L3, L4, L6, L8, L9). M11 (unallocated vs Not itemised), M9 (widget count wording in the addendum), L2 (presets) and L5 (row states) are still partly open (new **L1–L4**).

---

## CRITICAL

### C1. Own-account UPI transfers are classified as reversals and cancel the debit
**Location:** FIN-027 ("a same-reference item in the opposite direction is a reversal or refund … never a duplicate"), UPI-005, FIN-028, SMS acceptance (reversal cancels debit), vs CAP-010, CAP-012, FLOW-16

**Failure scenario:**
- Priya moves ₹5,000 from HDFC to her ICICI account by UPI.
- Both banks' SMS quote the **same UPI RRN**: HDFC "debited … UPI Ref 4123…" and ICICI "credited … UPI Ref 4123…". That is how UPI references work.
- The pipeline (DEC-29) runs FIN-027 matching first. Same reference, opposite direction, so FIN-028 applies: "a reversal of a failed payment cancels the original debit in the original's period".
- The HDFC debit is cancelled, and the HDFC balance is ₹5,000 too high.
- The ICICI credit is either swallowed as the reversal leg (ICICI ₹5,000 too low) or posted as well (total assets ₹5,000 too high).
- FLOW-16 and CAP-010 never get a chance, because nothing says whether transfer pairing or reversal detection is evaluated first.
- The same problem hits a UPI payment to a **known own wallet**, and the IMP-002 transfer-pair detection on CSV rows with shared references.
- RB0 "no known incorrect account balance" fails on one of the most common Indian money movements.

**Fix:**
- Make the reference rule account-aware:
  - same reference, opposite direction, **same account** → reversal or refund;
  - same reference, opposite direction, **two different owned accounts** (or the credit lands on a known own masked identifier) → transfer pair (FIN-013 / CAP-010);
  - credit on an **unknown** account with the same reference → hold for review, with the transfer choice pre-selected.
- State the evaluation order in DEC-29: transfer pairing before reversal or refund linking.
- Add SMS, UPI and DEDUP fixtures for a same-RRN own-account transfer.

### C2. Unlearned credits still auto-approve, into an expense category
**Location:** CAP-007 ("If no category is learned, it is confirmed as 'Uncategorised' with the `needs_category` flag"), CAT-006 (Uncategorised is a seeded *expense* category with no type and feeds "Not classified"), §6.3 hero, CAP-004, INS-016, BDG-009 pre-fill

**Failure scenario:**
- Arjun's ₹80,000 salary SMS arrives on the 25th from a verified sender, fully parsed, not transfer-like. He has no learned type for this payer yet, so it is CAP-007-eligible.
- At 21:00 it is written as confirmed "Uncategorised". Uncategorised is the expense category with no type, so a literal implementation then does one of two wrong things:
  - (a) books ₹80,000 into the **Not classified** segment, and the 50/30/20 hero subtracts his salary as spending ("Left in budget −₹40,000 · includes ₹80,000 not classified");
  - (b) treats it as income of an unknown kind, which inflates "Kept N%" and, if it lands in Salary, the BDG-009 income pre-fill.
- Unlinked refund credits and "From a person" repayments (a friend paying back half a dinner) are auto-approved as income in the same way.
- C1 in v1.3.0 asked for "any credit without a learned type" to be ineligible. That part of the fix was not applied.

**Fix:**
- In CAP-007, make credits eligible only when a credit type (Salary / Refund / From a person / own transfer) has been learned for that payer or sender. Otherwise they stay `needs_review`.
- If the owner wants credits auto-approved anyway, define a separate income-side "Uncategorised income" category and state that it never enters Needs, Wants or Not classified.
- Add a CAP acceptance case: an unlearned salary credit at 21:00 is still Waiting for you, and Left in budget is unchanged.

---

## HIGH

### H1. CAP-007 still describes read-time auto-approve
**Location:** CAP-007 vs FIN-026(2), DEC-22, CAP acceptance

**Scenario:**
- CAP-007: "Eligible captures still pending after the daily cutoff … **count as confirmed** and are materialized per FIN-026, **so nothing depends on a background job running**."
- FIN-026(2): "always a write, never derived on read … stay `needs_review` … until they are written". DEC-22 depends on a best-effort job **or** the next open.
- An agent given the CAP-007 story (WMB-16) implements a selector that counts eligible-past-cutoff items. That brings back every C3 failure: the widget disagrees with Home, the evening summary disagrees with Activity, and late duplicates shrink totals.

**Fix:** Replace the sentence with: "Eligible captures stay `needs_review` until written by FIN-026 (job or next open); nothing counts them before the write."

### H2. A discovered account's opening balance is off by the very transaction that discovered it
**Location:** CAP-009 ("balance before = available balance ± this transaction"), addendum §2, vs FIN-016 ("The opening balance applies at the instant the account is created: a same-day transaction timed earlier than that instant is 'before tracking started'")

**Scenario:**
- An ICICI debit SMS (₹1,200, Avl Bal ₹20,000) arrives at 10:02. Priya taps *Add it* at 13:40.
- CAP-009 sets the opening balance to ₹21,200, which is the balance **before** the debit.
- FIN-016 timestamps the opening at 13:40. The 10:02 debit is earlier, so it is "before tracking started" and does not post.
- The balance shows ₹21,200 against a real ₹20,000.
- Any other ICICI captures still waiting from earlier that day are also silently excluded from the balance.

**Fix:**
- For discovered accounts, set `opening_effective_at` to the instant just before the discovering transaction's `occurred_at`. Alternatively, derive the opening balance as the available balance *after* the transaction and mark that transaction as before tracking.
- Add a GWT case with numbers.

### H3. Auto-approve can post to an account that does not exist yet
**Location:** CAP-007 ("amount, direction and account are fully **parsed**"), CAP-009, FLOW-15

**Scenario:**
- In week 1, Priya gets SMS from three masked accounts and ignores the "New account ••7730 — add it?" prompts.
- The account is *parsed* (••7730), so the captures are eligible. At 21:00 FIN-026 must write `confirmed` postings, and there is no `account_id`.
- Engineer A auto-creates an account, which skips CAP-009's choice and possibly duplicates an existing one that should have been "One of mine". Engineer B crashes the materialization transaction, which blocks every other auto-approval that night. Engineer C posts to the default account, which makes that balance wrong.

**Fix:** Eligibility requires the account to be **resolved** to an owned account, not just parsed. Unresolved captures stay Waiting with the discovery prompt. Add this to the CAP acceptance.

### H4. Card-bill payments are counted twice through the two SMS legs
**Location:** CAP-012 ("when both sides are known they are linked as a transfer"), CAP-010, CAP-009 (card accounts), FIN-011

**Scenario:**
- On the 5th, HDFC Bank sends "₹42,000 debited towards HDFC Credit Card ••1234". This is transfer-like, both sides are known, and it is linked as a transfer, so card dues fall ₹42,000.
- Minutes later the card issuer sends "Payment of ₹42,000 received on your card ••1234". This is a credit on the card, transfer-like by wording, and its other side is a known own account. It is linked as **another** transfer, so dues fall again: ₹84,000 for one payment.
- CAP-010's pairing only runs when the user marks a credit "Moved from my own account". It does not cover two transfer-like captures. Nothing says the second leg must find and merge into the first.

**Fix:**
- Before linking, a transfer-like capture must search for an existing transfer or transfer-like capture (opposite direction, same amount, FIN-027 window, involving the same two accounts) and **attach as the other leg's source record**. It must never create a second transfer.
- Add CAP and DEDUP fixtures with both card-payment SMS.

### H5. "Without a shared reference" can be read two ways; one floods review for every repeat UPI payment
**Location:** FIN-027, IMP-004, TXN acceptance (teas), SMS-005

**Scenario:**
- Priya pays the same tea stall ₹20 by UPI at 09:10 and again at 16:30. Each SMS has its own RRN.
- Reading A: the references differ, so these are different transactions and there is no fuzzy check.
- Reading B: they have no *shared* reference, so the fuzzy rule applies (equal amount, ±1 day, same normalized payee). The second tea becomes `possible_duplicate`, is never auto-approved, and needs a manual check. The daily metro top-up, the auto-rickshaw and the office canteen go the same way.
- The PRD's only identical-purchase acceptance covers **manual** entries (the 10-minute rule). There is none for SMS↔SMS or UPI↔UPI.
- The "≥ 70% resolved with zero or one tap" metric collapses under reading B.

**Fix:**
- State it explicitly: when both items carry references and the references differ, they are **not** duplicates. The fuzzy rule applies only when at least one side has no reference (for example, manual or receipt vs SMS).
- Add DEDUP cases for two same-day UPI payments to the same payee with different RRNs.

### H6. Merge keeps the earliest record, which is often a receipt defaulted to Cash
**Location:** FIN-027 Merge, OCR-011 ("Paid with … Cash only when there is no history"), TXN-012, OCR-012

**Scenario:**
- Sara snaps a Tesco receipt at 18:05. It is a new merchant, so Paid with defaults to **Cash** and Save confirms it, itemized into four categories.
- At 18:07 the card debit arrives by CSV or notification and is flagged `possible_duplicate`. She taps Merge.
- FIN-027 keeps "the earliest confirmed record", which is the Cash receipt. The card charge is excluded.
- Cash balance is £64 too low and card dues are £64 too low.
- The reverse order also fails: merging a receipt into an earlier SMS expense "lets the user choose the category", which collapses the receipt's itemized splits into one category.

**Fix:**
- Define Merge field by field:
  - **account and amount** come from the bank-sourced record (SMS, CSV or UPI) when present;
  - **splits and items** come from the receipt;
  - **merchant** comes from the user's choice;
  - **timestamp** is the earliest.
- Add a GWT case with the receipt first and the card second.

### H7. The retention purge deletes the fingerprints that keep rejected items rejected
**Location:** FIN-014 (rejected captures purged after 90 days; "purged rows keep only a non-financial audit stub (id, kind, date)"), IMP-005 (idempotent re-import via fingerprints), UPI-005, DEC-24

**Scenario:**
- In June, Sara rejects 6 rows from a bank CSV: card payments she had already recorded as transfers.
- In October she imports a "last 6 months" export, which UK banks commonly offer. The purged rows have no `source_record` fingerprint left, so they import again, this time as **confirmed** expenses. Her June spending rises by £1,900 and the past totals she trusted change.
- The same thing happens to a re-shared UPI screenshot after 90 days, and to a "Delete permanently" manual entry whose CSV row is re-imported.
- DEC-24 also still promises rejected captures "can be re-approved later", with no time limit.

**Fix:**
- Purging must keep a **tombstone fingerprint**: a non-financial hash of (source kind, reference/fingerprint, direction) plus `rejected`. Later matches go to review as "You rejected this before", and are never auto-confirmed.
- Update DEC-24 to say "within 90 days".
- Add an IMP acceptance case for re-importing after the purge.

### H8. A dismissed UPI share dialog auto-approves, so a forwarded payment screenshot becomes your spending
**Location:** §13.2 ("a share dialog the user dismisses without saving becomes a pending capture … eligible for auto-approve under CAP-007"), CAP-007 ("or a parsed UPI screenshot"), UPI-002

**Scenario:**
- A friend sends Priya a PhonePe "Paid ₹2,500 to Priya" screenshot on WhatsApp as proof of payment. She shares it to wmbugo out of curiosity and swipes the dialog away.
- The screen is a "Paid" layout, so it is parsed as **her** debit. At 21:00 it is auto-approved as a ₹2,500 expense from her default account.
- The same happens to screenshots shared by mistake, or to old screenshots from the gallery.
- A dismissal is the user saying "not now" or "not this". Treating it as consent, and treating a screenshot as being as trustworthy as a verified bank sender, is backwards.
- The screenshot carries no proof that it came from this device's UPI account. A verified SMS sender does.

**Fix:**
- A dismissed share is `needs_review` and **not** auto-approve-eligible. Alternatively, it is discarded with an Undo toast.
- If screenshots stay eligible at all, require the parsed payer account or VPA to match an owned account or a learned VPA.
- Add a UPI acceptance case: a dismissed screenshot is still Waiting the next morning.

### H9. SCR-18 offers a "savings" category type that the rest of the PRD forbids
**Location:** SCR-18 ("category type (need/want/savings)") vs CAT-006 ("Every expense category carries a type: `need` or `want` … Saving is never an expense category"), §10 Category type, §11.1 `budget_type[need|want]`, DEC-30

**Scenario:**
- The UX designer works from the screen inventory and draws a three-way type picker.
- An agent builds the editor from SCR-18 and adds `savings` to the enum. The schema rejects it, or someone widens the schema. A "SIP" category typed savings then counts as an expense *and* feeds the Savings bar, which is the C2 double count over again.

**Fix:** Change SCR-18 to "need/want (expense categories only)". If the owner wants SIPs in Savings, see H10. Do not do it through a category type.

### H10. "Savings account" is a trap name in India, and SIPs still never reach the Savings bar
**Location:** ACC-009 ("e.g. a savings or deposit account"), BDG-009 (transfers in minus transfers out; "can go below zero"), FIN-010 (no investment account type), DEC-30

**Scenario:**
- In India almost every retail account is called a "Savings Account". Arjun marks his HDFC salary account as savings, because it *is* one. From then on:
  - every transfer from it to a wallet reduces Savings;
  - every card-bill payment from it reduces Savings;
  - every move to another account reduces Savings.
- His Savings bar shows −₹38,000 every month, and the brand-mark feature tells him he saves nothing.
- If he correctly leaves it unmarked, his real savings (₹10,000/month SIP debits to a mutual fund, plus an RD) are expense debits to a non-account. They land in Needs, Wants or Not classified, and Savings is ₹0.
- Either way the core Indian persona sees a wrong Savings bar.

**Fix:**
- Rename the flag in the UI to "Money I'm saving (not for spending)" and add onboarding/ACC copy explaining that a bank's "savings account" label does not qualify it.
- Exclude card-bill payments out of a savings-marked account from Savings.
- Add a P1 **Investments / deposits** asset account type (or an "investment" transfer target) so SIP/RD debits can be recorded as transfers into it and count toward Savings without being expenses.
- Add a 5030 acceptance case covering a SIP debit.

### H11. Every discounted receipt trips the "items exceed total" mismatch
**Location:** OCR-005 ("Item amounts never exceed the total — if the parsed items sum to more than the total, the screen flags a mismatch"), FIN-022 ("items plus taxes/fees minus discounts"), OCR-004, §3.3 (≤ 20 s receipt metric)

**Scenario:**
- A Tesco receipt lists items totalling £52.40 and "Clubcard savings −£6.10", for a total of £46.30. Item amounts exceed the total, as they should.
- A literal agent flags a mismatch and forces Sara to "fix the items or the total" on every supermarket receipt in the UK, US and SG, where loyalty prices are everywhere.
- The ≤ 20 s receipt metric and "saving with not-itemised is normal" both fail.
- Discount allocation (line-level vs pro-rata) is also unspecified, while tax has an exact rule.

**Fix:**
- The mismatch check is **(items + tax + fees − discounts) > total**, not items > total.
- Allocate a discount to its line when it is printed under an item; otherwise allocate it pro-rata like tax.
- Add an OCR fixture with a loyalty discount.

---

## MEDIUM

### M1. The clock guard can block auto-approve for days, and "elapsed since boot" is lost on reboot
**Location:** FIN-026(6)

**Scenario:**
- The user's clock jumps to 2027 (a dead CMOS battery or a bad network-time update). The app opens and `last_materialized_at` is recorded as 2027. The clock is corrected.
- "Not earlier than the last time the app recorded" now blocks every write until 2027.
- "Elapsed time since boot" resets on reboot, and the PRD gives no fallback. Two engineers will build different guards.

**Fix:**
- Specify the guard concretely:
  - store `(wall_time, elapsedRealtime, boot_count)` at each open;
  - if boot_count is unchanged, trust the elapsed delta;
  - after a reboot, trust the wall clock only if it is ≥ the stored wall_time and ≤ stored + 30 days; otherwise skip auto-approve until the next open and log it.
- Clamp the high-water mark so it never exceeds now + 1 day.

### M2. Turning auto-approve off at 20:55 still approves today's captures
**Location:** FIN-026(4) ("a change applies from the next day"), CAP acceptance (cutoff move)

**Scenario:**
- Priya disables auto-approve at 20:55 because she wants to check today's six items herself. At 21:00 they are confirmed anyway.
- That is surprising, and it contradicts the "trust over pressure" principle.

**Fix:** Disabling, or moving the cutoff *later*, takes effect immediately for captures not yet written. Only *tightening* changes need versioning. Alternatively, show "Takes effect tomorrow — today's 6 will still be recorded at 21:00" at the moment of change.

### M3. The evening summary reports "recorded" before anything is written
**Location:** CAP-007, SET-003 ("built when it fires … never changes data"), addendum §3

**Scenario:**
- The summary fires at 21:00 ("Today: 6 recorded · 2 categories guessed"), but the background job has not run, so all six are still `needs_review`.
- Priya opens the notification and sees "6 to check" on Home: two numbers that disagree, on the trust-critical path.

**Fix:** Build the summary only after the materialization write has committed, inside the same job. If the job did not run, word it "6 will be recorded when you open wmbugo".

### M4. The timezone rule contradicts its own example and leaves period membership open
**Location:** FIN-002

**Scenario:**
- The rule prompts only when the device and profile differ by "more than 6 hours". Its own example, "You're in Dubai time", is London→Dubai: 3–4 hours. That trip never prompts, and neither does London→New York (5 h) or Mumbai→London (4.5–5.5 h). The cutoff then fires at 16:00 in New York.
- Is a transaction in a period by its `local_date` (a calendar date compared with period dates), or by its UTC instant converted to the profile zone? A Dubai 01:30 purchase on the 25th (London 21:30 on the 24th) is in different pay cycles under the two readings.
- CSV rows have a date only, and the zone for their `local_date` is unstated.

**Fix:**
- Prompt on any offset difference ≥ 2 h lasting more than 24 h.
- State the rule: period membership uses `local_date`, and date-only imports use the profile zone.
- Fix the example.

### M5. A payday change splits the hero from Insights and leaves gap days
**Location:** BDG-002 ("changing the payday changes the overall budget's period from the next cycle") vs DEC-33 ("Both tabs always share the same period"), §6.3

**Scenario:**
- Arjun changes his payday from the 1st to the 25th on 10 November.
- Insights and Plan switch to the new cycle at once. The overall budget, and so the hero, stays on 1–30 November.
- From 25 to 30 November the hero and Insights describe different windows. Whether 1–24 December or 25 November–24 December is the first new cycle is not said.

**Fix:** Define the transition: the current period runs to the day before the new payday, followed by a short bridging period with a pro-rated target (or no target), and DEC-33's default period changes at the same instant as the overall budget.

### M6. GOAL-004 allows a negative Free to use; BDG-008 clamps it at zero
**Location:** GOAL-004 acceptance ("Free to use … may be negative") vs BDG-008 (`max(0, min(...))`)

**Scenario:** An agent implementing BDG-008 cannot pass the GOAL acceptance test, and an agent implementing the acceptance test breaks the formula.

**Fix:** Pick one. Recommended: drop `max(0, …)` and show a negative value as "Short by ₹X", since the PRD values honesty.

### M7. Unlinked refunds, negative categories and reversals in closed periods
**Location:** BDG-006 and §10 Budget used ("minus **linked** refunds") vs FIN-028 (unlinked refunds reduce a chosen category), FIN-028 reversal "in the original's period"

**Scenario:**
- An agent reading BDG-006 ignores unlinked refunds in budgets, while Insights (FIN-028) subtracts them, so the two disagree.
- A ₹9,000 November refund for an October TV, against ₹2,000 of November Shopping, gives Shopping −₹7,000. That can make the Wants bar negative and inflate Left in budget by ₹7,000.
- A reversal that arrives on the 2nd for a payment on the 30th rewrites last month's totals, after its budget alerts have already fired.

**Fix:**
- Make §10 and BDG-006 read "minus refunds (linked or categorised)".
- State whether a category, Needs or Wants total can go below zero (recommended: no, clamp at zero for the bars and show the surplus refund separately).
- Accept that reversals rewrite the original period, and say that alerts do not re-fire.

### M8. Blind Approve: the notification hides the amount, but the Approve button is live
**Location:** SET-005 ("With app lock on, capture notifications use the redacted public version … even on an unlocked device"), CAP-001 ("Approve/Reject from the notification shade does not require unlocking")

**Scenario:** With app lock on, the shade shows "wmbugo · 1 new transaction [Approve] [Reject]". The user approves something they cannot see, which defeats the point of a one-tap check.

**Fix:** When the redacted version is shown, offer only "Review" (which unlocks the app). Approve/Reject appear only on the full version.

### M9. A credit from a new legitimate bank is scam-flagged, and the sender can never be confirmed through it
**Location:** SMS-011 ("any credit from a non-verified sender"), SMS-017

**Scenario:**
- A cooperative or small-finance bank that is not on the allow-list sends a salary credit. It is shown as "This looks like a scam — not added".
- SMS-017's "It's my bank" prompt is only reachable through a *debit*. Users of these banks lose every credit until they happen to make a debit.

**Fix:** A credit from a well-formed DLT header that is not allow-listed, and has no link or prize wording, gets the SMS-017 prompt and is held (`needs_review`). Only credits that have links or claim wording, or that come from a phone number, are scam-flagged.

### M10. "Cash withdrawal (to the Cash account)" assumes a Cash account exists
**Location:** CAP-012, ONB-002 ③ (one account only), FIN-013

**Scenario:**
- The user set up only HDFC at onboarding. An ATM SMS arrives, and there is no Cash account to link to.
- The item waits forever ("when both sides are known"), or an agent posts it as an expense.

**Fix:** Choosing Cash withdrawal creates a Cash account on first use, with "balance not set" or ₹0 starting at that instant. State this.

### M11. IDR and HUF hide decimals that are stored, which breaks round-trip and the keypad
**Location:** §13.0a ("IDR 2 (stored), shown without decimals"; HUF likewise), §7.4 ("Amounts round-trip exactly through store → format → parse"), FIN-001 (the keypad blocks extra decimals)

**Scenario:**
- A CSV row "Rp 12.345,67" is stored as 1234567. It displays "Rp 12.346", and parsing that back gives 1234600. The §7.4 invariant fails.
- Displayed totals stop summing to the displayed rows.
- It is unclear whether the keypad lets the user type IDR decimals.

**Fix:** Use a *display/entry* exponent of 0 for IDR and HUF. Imports with non-zero minor units are rounded with a visible warning, or rejected. The round-trip invariant applies to the display exponent.

### M12. "Profile region" is never defined
**Location:** ONB-002 ②, §13.0a ("feature shown … profile region is India"; EUR "per region (de-DE, fr-FR, en-IE)"), §11.1 `profile.region`

**Scenario:** One engineer stores a market group ("UK/Europe"), another an ISO country. With a market group, the EUR locale (de-DE vs fr-FR) cannot be chosen. With a country, the gating code has to map about 30 countries to "India".

**Fix:** `region` is an ISO 3166 country code. Market group and default locale are derived from a country table, and the gating rule is `region == "IN"`.

### M13. `account.masked_identifiers[]` duplicates `account_identifier` and brings back mask collisions
**Location:** §11.1 `account(... masked_identifiers[] ...)` and `account_identifier` (unique on sender_id, mask), FIN-010

**Scenario:** An agent matches captures against the convenient array on `account`. ICICI ••7730 and Axis ••7730 collide again (old H5).

**Fix:** Remove `masked_identifiers[]` from `account`. FIN-010 refers to `account_identifier`.

### M14. "No INTERNET permission" will be undone silently by the manifest merger
**Location:** SEC-002, SEC acceptance (release manifest), addendum §1 (ML Kit, Notifee, React Native)

**Scenario:**
- React Native's template and several libraries declare `INTERNET` in their manifests, and the merger adds them to the release manifest.
- Debug builds *need* INTERNET for Metro, so every developer test runs with network available. An SDK that quietly needs network (a lazy model fetch, for example) works in debug and fails only in release.

**Fix:**
- Require `<uses-permission android:name="android.permission.INTERNET" tools:node="remove"/>` in the release source set, and a CI step that runs `aapt dump permissions` on the release APK.
- Run the airplane-mode E2E suite (NFR-01) on the **release** variant.

### M15. The capture inbox needs Direct Boot specifics the PRD never names
**Location:** SEC-001, §11.1 `capture_inbox`, NFR-16

**Scenario:**
- Before first unlock, only receivers marked `android:directBootAware="true"` get `SMS_RECEIVED`, and only device-protected storage is writable. An agent that does not know this ships a receiver that never fires before unlock, and the GWT case fails on device.
- "Encrypted … readable without user authentication" also needs a key that is available before unlock, and that key protects nothing against device theft.
- There is no inbox retention rule, and no dedup rule for the case where the inbox replays an SMS that the OS also delivers again after unlock.

**Fix:**
- Name these explicitly: a direct-boot-aware receiver, device-protected storage, a key that is only usable in direct boot.
- Drain within N seconds of unlock and delete drained rows.
- Dedup by SMS fingerprint on drain.

### M16. The GATE-02 deadline cannot be met and the gate is unnecessary
**Location:** §20 M1 (2026-11-03 → 11-07, "resolve GATE-02 … before choosing the application ID"), GATE-02, M2 starts 2026-11-08

**Scenario:**
- Play's SMS-declaration eligibility answers come from Play policy review or support, which takes weeks. M2 needs an application ID on 8 November.
- Either the alpha slips, or the gate is self-certified.
- The stated fallback ("two packages: no-SMS everywhere; SMS edition in India") never changes the **main** package ID anyway.

**Fix:** Fix the main application ID now as the no-SMS package. Reserve a second ID for a possible SMS edition. Move GATE-02 to "before the M3 SMS declaration".

### M17. The reference-set protocol distorts the UPI accuracy it is meant to measure
**Location:** §16.3 (third-party identifiers "redacted before storage"), §3.3 (UPI payee and reference accuracy), GATE-08

**Scenario:**
- Payee names and UPI IDs are exactly the fields UPI-002 extracts. Once they are redacted (blacked out), the real-set measurement cannot score payee extraction, and the redaction boxes change the layout the fixed-layout parser depends on.
- GATE-08's paid external review must also happen *before collection* (M3), not only before Play submission, which means a second paid review or an earlier one.
- How testers transfer the files (email, WhatsApp) is not covered, and that is where third-party data actually leaks.

**Fix:**
- Measure on the device at collection time, before redaction, and store only results plus redacted copies.
- Specify a transfer channel (encrypted upload of files to the developer, no chat apps).
- Schedule the GATE-08 review before M3.

### M18. Identical CSV rows meet the fuzzy rule after the first commits
**Location:** FIN-027 (occurrence index; fuzzy rule), IMP-004, IMP-005 batches

**Scenario:**
- Row 1 (two Pret £3.50 lines on 20 October) commits in batch 1. Row 2 is then checked against the ledger: same amount, same date, same merchant, so it is `possible_duplicate`.
- "Kept as distinct rows" says nothing about whether row 2 is confirmed or held.
- Overlapping exports with different date windows can also shift occurrence indices when the file boundary cuts a day in half.

**Fix:**
- Rows from the same file are never fuzzy-matched against each other.
- The occurrence index is computed per (date, amount, description) group.
- When the first or last day of the file is partial, rows from that day go to review.

### M19. The balance chain will flag ordinary days as suspicious
**Location:** SMS-012

**Scenario:**
- NACH/ECS debits, card auto-pays, interest credits and bank charges often arrive with no SMS. SMS can also arrive out of order, during OEM batching.
- The next SMS balance mismatches, the capture is flagged, and auto-approve is lost on the most routine day.
- "Allowing for intervening … transactions" has no tolerance and no ordering rule.

**Fix:**
- Compare in `occurred_at` order, not arrival order.
- A mismatch only flags when the difference equals neither this transaction's amount nor zero.
- A flagged chain resets silently once and flags only a second consecutive mismatch.

---

## LOW

### L1. "Unallocated" is still used for Not itemised
FIN-022 says missing OCR items are "explicit *unallocated amount*". TXN-009 says Not itemised "is not unallocated". **Fix:** Reword FIN-022 to refer to the Not itemised split row (TXN-009).

### L2. The INS-001 presets still omit Yesterday
INS-001 says "as in §6.5" and then lists the presets without Yesterday. **Fix:** Delete the inline list.

### L3. The "seven row states" are incomplete
TXN-006 omits refund, reversed, "before tracking started" and foreign-currency waiting rows. **Fix:** Add them, or call the list "primary states" and specify the rest.

### L4. The addendum contradicts the PRD
- The widget is "● count"; the PRD says "N to check" text.
- Own-account pairing is "within N minutes"; FIN-027 says ±1 day.
- The vocabulary lacks "Recorded · needs a category".

**Fix:** Align the addendum with the PRD.

### L5. Data-model leftovers
- `profile.auto_approve_rule_effective_from` is redundant with the `auto_approve_rule` table.
- FIN-024 lists `possible_duplicate` as a status flag, while §11.1 derives it from `review_candidate`.
- `goal.allocated_minor` is redundant with `goal_allocation`.

**Fix:** Drop the stored duplicates.

### L6. Deleted manual entries: backup copy vs purge, and an unreachable "Delete permanently"
- The status mapping says a Delete "keeps its audit row and backup copy". FIN-014 says purges propagate to the next backup.
- Deleted entries are "hidden everywhere", so a deleted item's own detail screen cannot offer Delete permanently.

**Fix:** Say "kept in backups until purged (30 days)". Settings → Data → "Recently deleted" lists them.

### L7. DEC-21 still promises a single Approve/Reject for every capture
CAP-012 (transfer choices), CAP-004 (credit types) and OCR-010 (Attach/Keep/Discard) all depart from it. **Fix:** Amend DEC-21 to "Approve/Reject for categorised captures; typed choices for credits, transfer-like captures and receipt matches".

### L8. §13.2 omits SMS-017
The no-SMS table marks SMS-001..016 absent. SMS-017 (the unknown-sender prompt) is not listed. **Fix:** SMS-001..017.
