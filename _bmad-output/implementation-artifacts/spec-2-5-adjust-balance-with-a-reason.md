---
title: 'Story 2.5 - Adjust balance with a reason'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'd254250'
---

## Intent

Implements the epic's Story 2.5 acceptance criteria (see epics.md).

## Implementation Notes

- Core `ledger/adjustBalance.ts`: `AdjustBalance` writes one `adjustment` transaction dated now with one `adjustment` posting for the difference between what the user says the account holds (a card: what it owes, stored negative) and the ledger balance, with audit, `TransactionsChanged` and `AccountsChanged` in one transaction. The opening posting is never touched. `NO_CHANGE` when the amount already matches, `BALANCE_NOT_SET` for an account with no balance (it gets Set balance instead), reasons validated against `ADJUST_REASONS` (Starting balance was rough, Missed some entries, Bank charges or interest, Other). The reason is stored as the transaction note (the label, or the user's own text for Other) and the code goes in the audit row. `adjustmentDelta` is the shared pure helper behind the preview.
- Undo is the ordinary `RemoveEntry`; a removed adjustment drops out of the balance.
- `entryShape` gained an adjustment rule: exactly one `adjustment` posting equal to the amount, never zero.
- Activity and the account timeline now include adjustments (`ActivityKind` adds `adjustment`, rows carry `signedMinor`). They are never in a day's Spent, income or cash flow (queries select by event type; unit test).
- Mobile: `AdjustBalancePanel` on the account detail (`Actual balance today` / `Amount you owe today`, live preview `Adjust up by ₹1,200` / `Adjust down by ₹400` / `You owe ₹250 more`, no minus sign, reason chips, a note field for Other, `Error: reason required`, `Already matches. Nothing to adjust.`). Saving shows the toast `Balance adjusted` with Undo. `Adjust balance` shows when a balance is set; otherwise `Set balance` shows (Story 2.4).
- `ActivityRowView`: `Balance adjustment`, subtitle `Adjusted up · HDFC` / `Adjusted down · Cash`, unsigned neutral amount, TalkBack `Balance adjustment, up 1,200 rupees, HDFC`.
- The F1 finance fixture can now use the real use case; its test-only adjust is left in place because it asserts the same balances.

## Deviation

- The panel lives on the account detail (like Set balance), not in a separate sheet.
- Other asks for a note but does not require one.

## Not done / open

- TalkBack reading of the panel was not checked on a device.
