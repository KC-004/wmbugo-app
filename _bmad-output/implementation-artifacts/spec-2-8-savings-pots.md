---
title: 'Story 2.8 - Savings pots'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '6fdd1ec'
---

## Intent

Implements the epic's Story 2.8 acceptance criteria (see epics.md).

## Implementation Notes

- Core `ledger/savings.ts`: `SAVINGS_MOVED_IN_SQL` (`savingsMovedIn(period)`: transfers from a non-pot into a pot minus transfers from a pot to a non-pot; pot-to-pot, card bills and ordinary moves count zero; exact, can be below zero), `savedDisplay` (floors at zero for display), `ChangeAccountType` (asset types switch freely; asset to or from a card only while the account has no entries, with the opening re-signed so what was typed is what is owed; icon and colour follow the type only when they were still its defaults; audit + `AccountsChanged`; `HAS_ENTRIES` otherwise).
- `ACCOUNT_LIST_SQL` gains `moved_in_minor` (pots only): the per-pot "moved in" the list shows.
- A savings pot with no balance is neither counted in In accounts nor "not set" (`overviewTotals`, `assetTotal`): Home gets no `+1 account not set` for a SIP. `accountLine` gives it a `moved-in` kind (floored at zero). `accountGroups.have.savedRows` holds those pots.
- Mobile: the form shows the pot hint and `Leave empty if the value changes with the market`; the accounts list shows `Saved & invested` inside Money you have with `₹5,000 moved in` (or `Nothing moved in yet`), TalkBack `SIP – Axis MF, savings pot, 5,000 rupees moved in, not counted in your totals`; the detail header reads the same. A pot with a balance sits in Money you have and counts unless Count in my totals is off. In a row's edit mode the account type chips change the type; a blocked change says `This account has entries. Add a new card instead.`
- Moving money into a pot is the existing transfer (Add sheet or Move money); spending and income stay unchanged (tested).

## Deviation

- The type change lives in the row's edit mode (no account Edit screen yet; Story 2.9 area).
- Pots shown under Saved & invested cannot be moved up or down (they are listed after the other accounts); reordering them is not offered.
- Epic 4's 50/30/20 Savings share is not built; `savingsMovedIn` is ready for it.

## Not done / open

- TalkBack reading was not checked on a device.
