---
title: 'Story 2.1 - Account balance read model and finance fixtures'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '74ec95f'
---

## Intent

Implements the epic's Story 2.1 acceptance criteria (see epics.md).

## Implementation Notes

- One balance rule for every figure: balance = opening posting + adjustment postings + every confirmed, non-removed ordinary posting at or after the account's opening instant (`ACCOUNT_LIST_SQL`, also used by the strict transfer check). Entries that are `needs_review`, removed, or dated before the opening instant no longer change a balance. An account with no balance set has no opening instant, so nothing is "before" it.
- New core module `ledger/balances.ts`: `cardPosition` (outstanding is the negation of the ledger balance, 45000 dues plus a 20000 charge is 65000; a card above zero is `in-credit`, never a negative outstanding; a settled card owes a plain 0), `overviewTotals` (In accounts, Card dues, cards in credit, not-set counts for assets and cards separately, net worth = In accounts minus Card dues, never summed otherwise; archived accounts and accounts switched out of totals are left out), presenters (`notSetNote`: "+1 account not set", "+2 accounts not set", "+1 card not set"), `beforeTrackingStarted` and `BEFORE_TRACKING_SQL` (derived on read, never stored).
- Home's accounts line now reads the same overview query; a card with no balance shows "Not set" and "+1 card not set" on Card dues instead of vanishing.
- `INCOME_SQL` for period income (a transfer is never income).
- Property suite (fast-check, real SQLite and migrations): random sequences over 1 to 6 accounts of openings, expenses (some dated before the opening), incomes, transfers with and without fees, card charges and card payments; every balance equals opening plus applicable postings, every transfer sums to exactly 0, spending and income totals ignore transfers (a fee is the only spending). It caught a "-0" outstanding on a settled card while this story was written.
- GATE-07 fixtures in `packages/core/test/fixtures/finance` (`fixtures.ts`, `runner.ts`, `finance-fixtures.test.ts`): bank ₹30,000 adjusted to ₹31,200; card ₹8,200 paid from HDFC; S$200 bank-to-cash with a S$2 fee; ₹5,000 into a savings pot; an expense dated before opening; a card charge with a card that has no balance. Each lists the expected balances, In accounts, Card dues, Spent and income. The table is copied into `docs/decisions/SIGNOFF-epic-1.md` for the finance reviewer.

## Deviation

- The AC asks for a migration adding `include_in_totals`. The account table already has this switch from the S2 schema under the name `include_in_overview` (default counted), so no migration was added and the name is kept; the overview query honours it. Story 2.2 adds its toggle.

## Not done / open

- The user-facing Adjust balance with a reason is Story 2.5; the F1 fixture writes the adjustment posting through a test-only use case.
- `AccountsChanged` already maps to the ledger, home and insights areas; the account-detail key arrives with Story 2.3.
