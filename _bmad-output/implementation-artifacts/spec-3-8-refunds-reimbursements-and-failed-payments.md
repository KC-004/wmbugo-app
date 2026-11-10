---
title: 'Story 3.8 - Refunds, reimbursements and failed payments'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: '6db5de3'
---

## Intent

Implements the epic's Story 3.8 acceptance criteria (see epics.md) and PRD FIN-028, LIR-06, LIR-02.

## Implementation Notes

- Migration 0009 adds `transaction.recovery_kind` ('refund' or 'reimbursement'; null otherwise).
- Core `ledger/refunds.ts`: `createRefund` (only `SubmitCapture` may call it; the architecture test now scans for it) writes a `refund` transaction with a positive posting, one split in the original's category and a link to the original. It refuses more than is left (`EXCEEDS_REFUNDABLE`, `REFUNDABLE_SQL`). An unlinked refund needs an account and defaults to Other. A refund is never income.
- A refund carries its own date, so it reduces the spending of the period it arrives in; the original's period is untouched (tested: 28 Oct expense, 5 Nov refund).
- `ReverseTransaction` / `UndoReversal`: for a failed payment. Writes a `reversal` transaction (opposite posting, same account), marks the original `reversed` and linked by `reversed_by_id`; the account nets to unchanged and Undo restores the original exactly. The balance, timeline and strict-transfer SQL now count `reversed` originals with their reversal. When the original lies in a closed period the `TransactionsChanged` payload carries `closedPeriodTouched: true`; budget threshold handlers must never fire for it.
- `SPENDING_TOTALS_SQL` / `spendingTotals(rows, 'net' | 'gross')`: gross is expenses, net subtracts refunds and reimbursements once. `CATEGORY_TOTALS_SQL` and `RECOVERY_SUMMARY_SQL` back category totals and the detail's recovery lines.
- GATE-07 property test over random expenses, refunds, reimbursements and reversals: balance, Spent and category totals reconcile; nothing becomes income.
- Mobile: detail shows `Record a refund`, `Got paid back`, `Reverse` (caption "For a payment that failed or bounced"); a refund form defaults to the refundable amount and shows `Error: only ₹1,500.00 is left to refund`; toasts `Refund saved` / `Payback saved` / `Reversed` with Undo; the detail shows `You paid`, `Refunded`, `Paid back`, `Your share` and `Reversed on <date>`. Activity lists the `Reversal · Swiggy` row (neutral). The Income form's `Refunds` chip shows a "Refund for" picker (Other by default, or one of the eight most recent refundable expenses) and saves a refund through `SubmitCapture`.

## Deviation

- The refund form always dates the refund now; there is no date picker on it (the Add sheet's date field applies to the Income form path).
- Undo for a saved refund deletes it (a removal, recoverable from the audit trail), not a snapshot restore.
- Reimbursements are only available from the detail ("Got paid back"), not from the Income form.

## Not done / open

- Not checked on a device with TalkBack.
- `pnpm` is blocked by a Device Guard policy in this session, so `pnpm lint`/`typecheck` and the gate script's pnpm cases were not run; eslint, tsc and jest were run directly and are clean (core 451, mobile 854 tests).
