---
title: 'Story 2.7 - Pay card bill'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'ab447f3'
---

## Intent

Implements the epic's Story 2.7 acceptance criteria (see epics.md).

## Implementation Notes

- No new money use case: paying a card is the existing `RecordTransfer` (Story 1.15), so the writer invariant, the over-balance warning or blocking, undo and the "never spending twice" rule all come for free. A unit test confirms one transfer, Card dues and the payer fall together, and Spent and income do not move.
- Core (`cardDetails.ts`): `LAST_PAYER_SQL` (From side of the newest transfer onto the card), `pickPayerAccount` (last payer, else the Settings default, else the most recently used asset account, else the first asset; none without assets), `payBillAmount` (the unpaid statement, else what is owed, else empty with "nothing owed").
- Mobile: `payBill.tsx` builds the preset and `usePayBill` opens the sheet. `Pay card bill` is a button on the card detail and on a card's row in Money you owe (also a TalkBack action). The Add sheet takes a richer preset (`AddPreset`: From, locked To, starting amount, owed amount, hint). To shows only the card and cannot be changed; From lists asset accounts only. Paying more than is owed shows `This is more than you owe. The extra shows as credit on the card. Tap Save again to continue.` once, then saves. With nothing owed the amount is empty with `Nothing owed on this card right now`. With no asset account, saving shows `Error: choose where the money came from`.
- A savings account that is a bank account is not a savings pot, so paying from it counts as nothing saved (Story 2.8 will read pots only).
- `useOpenAddWith` opens the sheet with a preset chosen at tap time; `useOpenAdd(opener, preset)` keeps its old shape.

## Deviation

- The From picker has no `+ New account` shortcut for the no-asset case: the sheet shows the error and the sheet's usual account chip; adding an account is still from Accounts.

## Not done / open

- TalkBack reading of the sheet in pay mode was not checked on a device.
